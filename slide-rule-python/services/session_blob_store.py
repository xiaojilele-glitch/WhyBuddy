"""会话存档的存储后端（2026-08-02）。

## 为什么有这一层

会话原本只落在本机的 `data/sliderule-sessions.json` 里，而应用记录（App Store）
早就进了托管 Postgres。两者生命周期不同，于是出现了这个线上现象：

    应用中心里 23 个应用，点开 18 个是空白页。

因为应用记录是**跨机器共享**的（同一个 Neon 库），会话却是**每台机器一份**。
在开发机上跑出来的应用，`session_id` 指向的会话只存在于开发机的文件里；换台
机器打开，会话查不到，前端 `loadOrCreateSessionState` 就地造一个空会话——
不报错、不提示，看起来就像页面坏了。

这一层把会话也放进同一个库，让「应用 → 会话」这根指针跨机器有效。

## 边界：只换存储，不碰语义

`persistence.py` 里那套 lastTurnId 单调守卫 + replay/reasoning 追加合并是踩
出来的（同轮陈旧快照不得覆盖已提交内容、服务端历史只增不减），**一行都没动**。
本模块只提供五个原语：读一条、读全部、写一条、删一条、列摘要。

顺带修掉一个老问题：原来每次保存都要把**整个存档**读出来再整个写回去
（`_write_store` 遍历所有会话）。一轮推演内会持久化好几次，会话越多越慢。
现在是按条读写。

## 并发：从进程锁改成乐观锁

原来靠 `persistence._save_lock` 一把进程内的锁保证「读 prior → 判定 → 写」
原子。库共享之后这把锁不够了——开发机和服务器是两个进程、两台机器。

所以每行带一个 `rev`：写入时要求 `where rev = 读到的那个 rev`，被别人抢先写
过就写不进去（返回 False），调用方重读重算。进程锁保留（文件后端仍然需要它，
也顺带减少同机自旋）。

⚠️ 已知边界：CAS 只保护「读到的那条」到「写回去」这一段。跨机器同时推演
**同一个会话**仍可能有一方重试后覆盖另一方的核心字段——但那一步会重新过一遍
守卫（lastTurnId 比较 + 追加合并），不会丢服务端历史。真要做到跨机器强一致
需要行锁 + 长事务，那与 HTTP 通道（无状态、每条语句一次往返）不兼容。

## 降级

沿用 App Store 那条验证过的链：远端 TCP → 远端 SQL over HTTP → 本地文件。
没配 `APP_STORE_DATABASE_URL` 时行为与改动前逐字节一致（还是那个 JSON 文件）。

⚠️ 降到文件那一级数据就与远端分叉了，恢复后不会自动回流——跟 App Store 一样，
每次降级都打印「现在写在哪」，不静默。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

TABLE = "sliderule_session"

#: 侧栏 GET /sessions 的瘦查询。⚠ 2026-08-19 白天：`select session_id, payload`
#: 把 5 MB blob 拉过 HTTPS。改成 `payload->>'…'` 之后仍 ~1.6s——Postgres 要
#: 解压 TOAST 才能抽字段。列表列是投影（与 owner_id 同一路子），这条 SQL
#: **不得再出现 payload**。完整 blob 只在 GET /sessions/{sid}。
_LIST_SUMMARY_SQL_PG = f"""
select
  session_id,
  owner_id,
  created_at,
  last_active,
  goal_text,
  runtime_phase as phase,
  coalesce(artifact_count, 0) as artifact_count
from {TABLE}
"""

_LIST_SUMMARY_SQL_SQLITE = f"""
select
  session_id,
  owner_id,
  created_at,
  last_active,
  goal_text,
  runtime_phase as phase,
  coalesce(artifact_count, 0) as artifact_count
from {TABLE}
"""

_LIST_PROJ_COLUMNS = (
    ("goal_text", "text"),
    ("runtime_phase", "varchar(32)"),
    ("artifact_count", "integer"),
)

_BACKFILL_LIST_PROJ_PG = f"""
update {TABLE} set
  goal_text = payload->'goal'->>'text',
  runtime_phase = payload->>'runtimePhase',
  artifact_count = case
    when jsonb_typeof(coalesce(payload->'artifacts', '[]'::jsonb)) = 'array'
    then jsonb_array_length(coalesce(payload->'artifacts', '[]'::jsonb))
    else 0
  end
where artifact_count is null
"""

_BACKFILL_LIST_PROJ_SQLITE = f"""
update {TABLE} set
  goal_text = json_extract(payload, '$.goal.text'),
  runtime_phase = json_extract(payload, '$.runtimePhase'),
  artifact_count = coalesce(json_array_length(json_extract(payload, '$.artifacts')), 0)
where artifact_count is null
"""

# ⚠ 2026-08-21：owner_id 列当初就地补上了，但回填 SQL 只打 artifact_count is null。
# 已经有 artifact_count、payload 里却有 ownerId、列仍是空的那批——超管侧栏
# 靠「无主 = 超管可见」能看见，用户表按 ownerId 汇总话题全是 0。
_BACKFILL_OWNER_PG = f"""
update {TABLE} set
  owner_id = nullif(payload->>'ownerId', '')
where owner_id is null
  and coalesce(payload->>'ownerId', '') <> ''
"""

_BACKFILL_OWNER_SQLITE = f"""
update {TABLE} set
  owner_id = nullif(json_extract(payload, '$.ownerId'), '')
where owner_id is null
  and coalesce(json_extract(payload, '$.ownerId'), '') <> ''
"""

# 与 app_store 共用的连接串；会话和应用落在同一个库是这次改动的全部意义所在。
_DB_URL_ATTR = "APP_STORE_DATABASE_URL"

# 显式回到文件存档的逃生口。设了 SLIDERULE_SESSIONS_FILE（或旧名
# WHYBUDDY_SESSIONS_FILE）就当作「这台机器的会话就要放在这个文件里」，
# 不进库——这两个环境变量本来就是「会话存档在哪」的意思，沿用它的语义。
_FILE_OVERRIDE_ENVS = ("SLIDERULE_SESSIONS_FILE", "WHYBUDDY_SESSIONS_FILE")

#: 会话 UPSERT 是几百 KB 的 JSONB，不是应用库那种百毫秒读。
#: 2026-08-18 咖啡馆 10 轮：客户端把 app_store 的 8s statement_timeout 照抄
#: 过来，语句被 Postgres 掐死，线上 /db-api 回 500（不是 413）。墙钟必须
#: **宽过**语句超时，不然 httpx 先报 timed out，服务端还在写。
#: 30s 对齐 db-api 的 DEFAULT_TIMEOUT_MS。
_BLOB_STATEMENT_TIMEOUT_MS = 30_000
_HTTP_TIMEOUT_S = 45


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _list_projection(payload: dict[str, Any]) -> dict[str, Any]:
    """写入列表列的投影。判定仍读 payload；这些列只给侧栏扫，不当事真相。"""
    summary = _summary_from_payload("", payload if isinstance(payload, dict) else {})
    return {
        "owner": summary["ownerId"],
        "goal": summary["goal"] or "",
        "phase": summary["phase"],
        "n_art": int(summary["artifactCount"] or 0),
    }


def _ensure_list_projection(run_sql, *, is_sqlite: bool) -> None:
    """老表就地补列表列，并从 payload 灌投影。

    增强类：补列 / 回填自己炸了不许拖垮主链路。标题/阶段/产物数只打
    `artifact_count is null` 的行——灌过之后列表查询不再碰 payload。
    owner_id 另走一条：已经有 artifact_count、列却空着的存量行，标题回填
    打不中，超管侧栏仍按无主可见、用户表按列汇总话题全是 0。
    """
    for name, typ in _LIST_PROJ_COLUMNS:
        try:
            if is_sqlite:
                run_sql(f"alter table {TABLE} add column {name} {typ}")
            else:
                run_sql(f"alter table {TABLE} add column if not exists {name} {typ}")
        except Exception:  # noqa: BLE001 — 列已存在
            pass
    try:
        run_sql(_BACKFILL_LIST_PROJ_SQLITE if is_sqlite else _BACKFILL_LIST_PROJ_PG)
    except Exception as exc:  # noqa: BLE001 — 回填失败就让列表缺标题，下次 save 会补
        print(f"[session_store] list projection backfill skipped: {str(exc)[:200]}")
    try:
        run_sql(_BACKFILL_OWNER_SQLITE if is_sqlite else _BACKFILL_OWNER_PG)
    except Exception as exc:  # noqa: BLE001 — 归属回填失败不许拖垮启动
        print(f"[session_store] owner_id backfill skipped: {str(exc)[:200]}")


def _owner_of(payload: dict[str, Any]) -> Optional[str]:
    """从 payload 里取归属，写进 owner_id 列。

    payload 是唯一真相（V5SessionState.ownerId），这里只做投影。空串归一成
    None——SQL 里 `owner_id is null` 与 `owner_id = ''` 是两种情况，让"无主"
    只有一种表示法。
    """
    value = payload.get("ownerId") if isinstance(payload, dict) else None
    text_value = str(value or "").strip()
    return text_value or None


def _stamp_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _summary_from_payload(
    session_id: str,
    payload: dict[str, Any],
    *,
    created: Any = None,
    active: Any = None,
) -> dict[str, Any]:
    goal = payload.get("goal") if isinstance(payload, dict) else {}
    artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
    return {
        "sessionId": session_id,
        "ownerId": _owner_of(payload if isinstance(payload, dict) else {}),
        "goal": goal.get("text", "") if isinstance(goal, dict) else "",
        "createdAt": _stamp_iso(created),
        "lastActive": _stamp_iso(active),
        "artifactCount": len(artifacts) if isinstance(artifacts, list) else 0,
        "phase": payload.get("runtimePhase") if isinstance(payload, dict) else None,
    }


def _cell(row: Any, *keys: str) -> Any:
    if isinstance(row, dict):
        lower = {str(k).lower(): v for k, v in row.items()}
        for key in keys:
            if key in row and row[key] is not None:
                return row[key]
            found = lower.get(key.lower())
            if found is not None:
                return found
        return None
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return _cell(dict(mapping), *keys)
    return None


def row_to_summary(row: Any) -> dict[str, Any]:
    artifacts = _cell(row, "artifact_count", "artifactCount")
    try:
        count = int(artifacts or 0)
    except (TypeError, ValueError):
        count = 0
    owner = _cell(row, "owner_id", "ownerId")
    phase = _cell(row, "phase", "runtimePhase")
    return {
        "sessionId": str(_cell(row, "session_id", "sessionId") or ""),
        "ownerId": str(owner).strip() if owner else None,
        "goal": str(_cell(row, "goal_text", "goal") or ""),
        "createdAt": _stamp_iso(_cell(row, "created_at", "createdAt")),
        "lastActive": _stamp_iso(_cell(row, "last_active", "lastActive")),
        "artifactCount": count,
        "phase": phase,
    }


class BlobRow:
    """一条会话存档：原始 payload + 乐观锁版本号。"""

    __slots__ = ("payload", "rev")

    def __init__(self, payload: dict[str, Any], rev: Optional[int]) -> None:
        self.payload = payload
        self.rev = rev


class SessionBlobStore:
    """会话存档后端接口。

    `rev` 为 None 表示这个后端不做 CAS（文件后端——单进程独占那个文件，
    进程锁已经够了）。此时 `save` 的 `expected_rev` 会被忽略、恒返回 True。
    """

    def load(self, session_id: str) -> Optional[BlobRow]:
        raise NotImplementedError

    def load_all(self) -> Dict[str, dict[str, Any]]:
        raise NotImplementedError

    def meta(self) -> Dict[str, dict[str, Any]]:
        """sessionId → {"createdAt": iso, "lastActive": iso}，纯观测用。"""
        raise NotImplementedError

    def list_summaries(self) -> list[dict[str, Any]]:
        """侧栏列表用的瘦行。默认走 load_all，库后端必须覆盖，禁止把 payload 整列拉回。"""
        out: list[dict[str, Any]] = []
        for sid, payload in self.load_all().items():
            out.append(_summary_from_payload(sid, payload, created=None, active=None))
        return out

    def save(
        self, session_id: str, payload: dict[str, Any], *, expected_rev: Optional[int],
        expected_control_run: Optional[dict[str, Any]] = None,
    ) -> bool:
        """False means CAS/fence conflict; SQL failures propagate to the caller.

        expected_control_run carries runId, ownerId, workerId and generation.
        Both control tables and the session must be in this store's database.
        """
        raise NotImplementedError

    def content_hash(self, payload: dict[str, Any]) -> str:
        """内容指纹，用来跳过「跟库里一模一样」的写入。

        对标 django-reversion 的 `ignore_duplicates`（revisions.py:194——新版本
        与上一版逐字段相同就根本不存）。这里更需要它：一轮推演里 save_session
        会被调 5~8 次，而守卫判定「这是陈旧快照」时会把 prior 原样写回去——
        那次写入 100% 是无效的，却照样要驮着 ~300KB 跑一趟网络。
        """
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()
        ).hexdigest()

    def delete(self, session_id: str) -> bool:
        raise NotImplementedError

    @property
    def label(self) -> str:
        return type(self).__name__


# ────────────────────────── SQL 后端（Postgres / SQLite）──────────────────────────

_DDL_PG = f"""
create table if not exists {TABLE} (
    session_id varchar(128) primary key,
    payload jsonb,
    rev integer not null default 1,
    created_at timestamptz,
    last_active timestamptz,
    owner_id varchar(64),
    goal_text text,
    runtime_phase varchar(32),
    artifact_count integer
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    session_id varchar(128) primary key,
    payload text,
    rev integer not null default 1,
    created_at text,
    last_active text,
    owner_id varchar(64),
    goal_text text,
    runtime_phase varchar(32),
    artifact_count integer
)
"""


def _payload_bind_expr(is_sqlite: bool) -> str:
    """SQLAlchemy text() cannot parse ``:p::jsonb`` as a bound parameter.

    Use SQL-standard cast syntax for Postgres so the bind remains ``:p``.
    """
    return ":p" if is_sqlite else "cast(:p as jsonb)"


def _controlled_save_statement(session_id, payload, expected_rev, fence, *, is_sqlite):
    """Serialize lease takeover and the session CAS in the same SQL statement.

    Postgres MVCC alone does not protect a cross-table EXISTS: lock the control
    row until the session write commits. SQLite serializes writers itself.
    Both transports execute this as one statement, including HTTP SQL.
    """
    if (not isinstance(fence, dict)
            or any(not isinstance(fence.get(key), str) or not fence[key]
                   for key in ("runId", "ownerId", "workerId"))
            or type(fence.get("generation")) is not int or fence["generation"] < 1):
        raise ValueError("invalid_control_session_fence")
    if payload.get("sessionId") != session_id:
        raise ValueError("control_session_id_mismatch")
    if _owner_of(payload) != fence["ownerId"]:
        raise ValueError("control_session_owner_mismatch")
    proj = _list_projection(payload)
    params = [session_id, json.dumps(payload, ensure_ascii=False), _now_iso(),
              proj["owner"], proj["goal"], proj["phase"], proj["n_art"], expected_rev,
              fence["runId"], fence["ownerId"], fence["generation"], fence["workerId"]]
    clock = "(julianday('now') - 2440587.5) * 86400" if is_sqlite else "extract(epoch from clock_timestamp())"
    cancelled = "json_extract(cr.payload, '$.cancelRequested') = 0" if is_sqlite else "cast(cr.payload as jsonb)->>'cancelRequested' = 'false'"
    lock = "" if is_sqlite else " for update of cr"
    materialized = "" if is_sqlite else "materialized "
    cte = (
        f"with owned_control as {materialized}(select cr.id, cr.lease_expires_at from wb_control_run cr "
        "where cr.id=$9 and cr.session_id=$1 and cr.owner_id=$10 "
        "and cr.generation=$11 and cr.lease_owner=$12 and cr.status='running' "
        f"and cr.lease_expires_at > {clock} and {cancelled} "
        "and exists(select 1 from wb_control_session cs where cs.session_id=cr.session_id "
        "and cs.owner_id=cr.owner_id and cs.active_run_id=cr.id) "
        "and not exists(select 1 from wb_control_cancel_request cc where cc.session_id=cr.session_id "
        "and cc.owner_id=cr.owner_id and cc.idempotency_key=cr.idempotency_key)"
        f"{lock}) "
    )
    # 2026-09-12 real PostgreSQL contention: filters can pass before a lock
    # wait, then an unchanged row can outlive its lease while waiting. Check
    # time after locking, including the target session lock on UPDATE.
    owned = f"exists(select 1 from owned_control where lease_expires_at > {clock})"
    blob = "$2" if is_sqlite else "cast($2 as jsonb)"
    if expected_rev is None:
        sql = (f"insert into {TABLE}(session_id,payload,rev,created_at,last_active,owner_id,goal_text,runtime_phase,artifact_count) "
               f"select $1,{blob},1,$3,$3,$4,$5,$6,$7 where cast($8 as integer) is null and {owned} "
               "on conflict(session_id) do nothing returning session_id")
    else:
        owner = "json_extract(payload, '$.ownerId')" if is_sqlite else "payload->>'ownerId'"
        if not is_sqlite:
            cte = cte.rstrip() + (
                f", locked_session as materialized (select s.session_id, oc.lease_expires_at from {TABLE} s "
                "cross join owned_control oc where s.session_id=$1 and s.rev=$8 "
                "and s.payload->>'ownerId'=$10 for update of s) "
            )
            owned = f"exists(select 1 from locked_session where lease_expires_at > {clock})"
        sql = (f"update {TABLE} set payload={blob},rev=rev+1,last_active=$3,owner_id=$4,goal_text=$5,runtime_phase=$6,artifact_count=$7 "
               f"where session_id=$1 and rev=$8 and {owner}=$10 "
               f"and {owned} returning session_id")
    return cte + sql, params


class SqlSessionBlobStore(SessionBlobStore):
    """SQLAlchemy 后端。payload 在 Postgres 上是 jsonb、在 SQLite 上是 text——
    读写两边都归一化成 dict，调用方看不出区别。"""

    def __init__(self, database_url: str) -> None:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        self._text = text
        # 连接参数与 app_store 对齐（pooler 走 NullPool + 关预编译语句缓存）：
        # 同一个库、同样的 PgBouncer 事务模式，参数不一致只会踩同一个坑两次。
        from .sql_gateway import _sql_engine_config, configure_sqlite_journal  # 复用，不重复实现

        connect_args, engine_kwargs = _sql_engine_config(database_url, NullPool)
        self._engine = create_engine(database_url, connect_args=connect_args, **engine_kwargs)
        configure_sqlite_journal(self._engine)
        self._is_sqlite = database_url.startswith("sqlite")
        with self._engine.begin() as conn:
            conn.execute(text(_DDL_SQLITE if self._is_sqlite else _DDL_PG))
            # 老库靠这一句就地补列——上面那句 `create table if not exists` 对
            # 已存在的表什么都不做，新列不会自己长出来（与 app_store 里
            # owner_id/visibility 那两句同一个理由）。SQLite 不支持
            # `if not exists`，重复执行会抛，吞掉即可：抛出来就说明已经有了。
            try:
                if self._is_sqlite:
                    conn.execute(text(f"alter table {TABLE} add column owner_id varchar(64)"))
                else:
                    conn.execute(
                        text(f"alter table {TABLE} add column if not exists owner_id varchar(64)")
                    )
            except Exception:  # noqa: BLE001 — 列已存在
                pass
            _ensure_list_projection(
                lambda sql: conn.execute(text(sql)),
                is_sqlite=self._is_sqlite,
            )

    def _decode(self, raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, (str, bytes)):
            try:
                out = json.loads(raw)
                return out if isinstance(out, dict) else {}
            except (ValueError, TypeError):
                return {}
        return {}

    def _encode(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False)

    def load(self, session_id: str) -> Optional[BlobRow]:
        with self._engine.connect() as conn:
            row = conn.execute(
                self._text(f"select payload, rev from {TABLE} where session_id = :sid"),
                {"sid": session_id},
            ).first()
        if row is None:
            return None
        return BlobRow(self._decode(row[0]), int(row[1]))

    def load_all(self) -> Dict[str, dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(self._text(f"select session_id, payload from {TABLE}")).all()
        return {r[0]: self._decode(r[1]) for r in rows}

    def list_summaries(self) -> list[dict[str, Any]]:
        sql = _LIST_SUMMARY_SQL_SQLITE if self._is_sqlite else _LIST_SUMMARY_SQL_PG
        with self._engine.connect() as conn:
            rows = conn.execute(self._text(sql)).all()
        return [row_to_summary(row) for row in rows]

    def meta(self) -> Dict[str, dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                self._text(f"select session_id, created_at, last_active from {TABLE}")
            ).all()
        out: Dict[str, dict[str, Any]] = {}
        for sid, created, active in rows:
            out[sid] = {
                "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
                "lastActive": active.isoformat() if hasattr(active, "isoformat") else active,
            }
        return out

    def save(
        self, session_id: str, payload: dict[str, Any], *, expected_rev: Optional[int],
        expected_control_run: Optional[dict[str, Any]] = None,
    ) -> bool:
        if expected_control_run is not None:
            sql, params = _controlled_save_statement(session_id, payload, expected_rev,
                                                    expected_control_run, is_sqlite=self._is_sqlite)
            sql = re.sub(r"\$(\d+)", lambda match: ":p" + match.group(1), sql)
            with self._engine.begin() as conn:
                result = conn.execute(self._text(sql), {f"p{i + 1}": value for i, value in enumerate(params)})
                return result.first() is not None
        blob = self._encode(payload)
        payload_expr = _payload_bind_expr(self._is_sqlite)
        now = _now_iso()
        # 列是 payload 的**投影**，不是第二份真相：判定一律读 payload.ownerId
        # （见 app_access.session_record）。写进列只为将来能用 SQL 过滤/建索引，
        # 跟 generated_app 既存 model_json 又存 goal/product_name 一个路子。
        proj = _list_projection(payload)
        binds = {
            "sid": session_id,
            "p": blob,
            "now": now,
            "owner": proj["owner"],
            "goal": proj["goal"],
            "phase": proj["phase"],
            "n_art": proj["n_art"],
        }
        with self._engine.begin() as conn:
            if expected_rev is None:
                # 这条还不存在（或调用方明说不做 CAS）：插入，撞主键说明别人
                # 刚插进去了 —— 按 CAS 失败处理，让调用方重读。
                try:
                    conn.execute(
                        self._text(
                            f"insert into {TABLE} "
                            f"(session_id, payload, rev, created_at, last_active, "
                            f"owner_id, goal_text, runtime_phase, artifact_count) "
                            f"values (:sid, {payload_expr}, 1, :now, :now, "
                            f":owner, :goal, :phase, :n_art)"
                        ),
                        binds,
                    )
                    return True
                except Exception:  # noqa: BLE001 — 唯一键冲突 = 并发插入
                    return False
            result = conn.execute(
                self._text(
                    f"update {TABLE} set payload = {payload_expr}, rev = rev + 1, "
                    f"last_active = :now, owner_id = :owner, goal_text = :goal, "
                    f"runtime_phase = :phase, artifact_count = :n_art "
                    f"where session_id = :sid and rev = :rev"
                ),
                {**binds, "rev": expected_rev},
            )
            return (result.rowcount or 0) > 0

    def delete(self, session_id: str) -> bool:
        with self._engine.begin() as conn:
            result = conn.execute(
                self._text(f"delete from {TABLE} where session_id = :sid"), {"sid": session_id}
            )
        return (result.rowcount or 0) > 0


# ─────────────── Neon SQL over HTTP 后端（受限网络：只有 443 出得去）───────────────


class NeonHttpSessionBlobStore(SessionBlobStore):
    """与 SqlSessionBlobStore 共用同一张表，语义严格对齐。

    存在的理由同 app_store 那一侧：TCP 5432 不通（或慢到堵死单 worker）的环境
    改走官方 SQL-over-HTTP 端点，**仍然是同一个远端库、数据不分叉**。
    """

    def __init__(self, database_url: str, endpoint: str) -> None:
        import httpx

        self._endpoint = endpoint
        self._client = httpx.Client(
            timeout=_HTTP_TIMEOUT_S,
            headers={
                # 凭据只在头里，不进 URL 也不进日志
                "Neon-Connection-String": database_url,
                "Content-Type": "application/json",
            },
        )
        self._q(_DDL_PG)
        # 老库就地补列，理由同 SqlSessionBlobStore.__init__ 里那句。
        # 线上走的就是这条 HTTP 分支，漏了它 = 线上永远没有 owner_id 列。
        self._q(f"alter table {TABLE} add column if not exists owner_id varchar(64)")
        _ensure_list_projection(self._q, is_sqlite=False)

    def _q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        from .sql_gateway import _neon_http_error

        resp = self._client.post(self._endpoint, json={"query": sql, "params": params or []})
        if resp.status_code >= 400:
            raise _neon_http_error(resp)
        return resp.json().get("rows") or []

    def _rows_affected(self, sql: str, params: list[Any]) -> int:
        """HTTP 端点不回 rowcount，用 `returning session_id` 数行数代替。"""
        return len(self._q(sql, params))

    @staticmethod
    def _decode(raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, str):
            try:
                out = json.loads(raw)
                return out if isinstance(out, dict) else {}
            except ValueError:
                return {}
        return {}

    def load(self, session_id: str) -> Optional[BlobRow]:
        rows = self._q(
            f"select payload, rev from {TABLE} where session_id = $1", [session_id]
        )
        if not rows:
            return None
        # ⚠️ integer(int4) 端点返回 int；此处 rev 是 int4，安全。改成 bigint
        # 必须在这里显式 int()——端点对 int8/numeric 返回的是**字符串**
        # （见 app_store._neon_normalize_row 的实测说明）。
        return BlobRow(self._decode(rows[0].get("payload")), int(rows[0].get("rev") or 0))

    def load_all(self) -> Dict[str, dict[str, Any]]:
        rows = self._q(f"select session_id, payload from {TABLE}")
        return {r["session_id"]: self._decode(r.get("payload")) for r in rows}

    def list_summaries(self) -> list[dict[str, Any]]:
        rows = self._q(_LIST_SUMMARY_SQL_PG)
        return [row_to_summary(row) for row in rows]

    def meta(self) -> Dict[str, dict[str, Any]]:
        rows = self._q(f"select session_id, created_at, last_active from {TABLE}")
        out: Dict[str, dict[str, Any]] = {}
        for r in rows:
            out[r["session_id"]] = {
                "createdAt": _iso_or_none(r.get("created_at")),
                "lastActive": _iso_or_none(r.get("last_active")),
            }
        return out

    def save(
        self, session_id: str, payload: dict[str, Any], *, expected_rev: Optional[int],
        expected_control_run: Optional[dict[str, Any]] = None,
    ) -> bool:
        if expected_control_run is not None:
            sql, params = _controlled_save_statement(session_id, payload, expected_rev,
                                                    expected_control_run, is_sqlite=False)
            return self._rows_affected(sql, params) > 0
        blob = json.dumps(payload, ensure_ascii=False)
        now = _now_iso()
        proj = _list_projection(payload)
        if expected_rev is None:
            # on conflict do nothing + returning：撞上了返回 0 行 = CAS 失败
            affected = self._rows_affected(
                f"insert into {TABLE} (session_id, payload, rev, created_at, last_active, "
                f"owner_id, goal_text, runtime_phase, artifact_count) "
                f"values ($1, $2::jsonb, 1, $3, $3, $4, $5, $6, $7) "
                f"on conflict (session_id) do nothing returning session_id",
                [
                    session_id,
                    blob,
                    now,
                    proj["owner"],
                    proj["goal"],
                    proj["phase"],
                    proj["n_art"],
                ],
            )
            return affected > 0
        affected = self._rows_affected(
            f"update {TABLE} set payload = $2::jsonb, rev = rev + 1, last_active = $3, "
            f"owner_id = $5, goal_text = $6, runtime_phase = $7, artifact_count = $8 "
            f"where session_id = $1 and rev = $4 returning session_id",
            [
                session_id,
                blob,
                now,
                expected_rev,
                proj["owner"],
                proj["goal"],
                proj["phase"],
                proj["n_art"],
            ],
        )
        return affected > 0

    def delete(self, session_id: str) -> bool:
        return (
            self._rows_affected(
                f"delete from {TABLE} where session_id = $1 returning session_id", [session_id]
            )
            > 0
        )


def _iso_or_none(value: Any) -> Optional[str]:
    """HTTP 端点的 timestamptz 是 '2026-08-02 10:00:00+00' 这种带空格的写法，
    另外两个后端产出的是 isoformat()——不归一化的话侧栏「最近」排序会因后端而异。"""
    if not isinstance(value, str) or not value:
        return value if value is None else None
    try:
        return datetime.fromisoformat(value).isoformat()
    except ValueError:
        return value


# ────────────────────────── 后端选择 ──────────────────────────

_lock = threading.Lock()
_instance: Optional[SessionBlobStore] = None
_signature: Optional[str] = None
_failed_urls: set[str] = set()


def file_override() -> Optional[str]:
    """显式指定了会话存档文件 → 这台机器不进库。"""
    for env in _FILE_OVERRIDE_ENVS:
        value = (os.getenv(env) or "").strip()
        if value:
            return value
    return None


class HttpApiSessionBlobStore(NeonHttpSessionBlobStore):
    """自定义 HTTPS SQL 网关后端（本仓库的 /db-api）。

    与上面那个共用**同一份 SQL**——包括 `values ($1, $2::jsonb, 1, $3, $3)`
    这条：`$3` 引用了两次（created_at 与 last_active 取同一个时刻）。网关那边
    的 numeric_to_format 会把参数表跟着铺开，所以这里什么都不用改。
    """

    def __init__(self, api_base_url: str, api_key: str) -> None:
        from .sql_gateway import HttpSqlGateway

        self._gateway = HttpSqlGateway(api_base_url, api_key, timeout_s=_HTTP_TIMEOUT_S)
        self._endpoint = self._gateway.endpoint
        self._q(_DDL_PG)
        # 老库就地补列，理由同 SqlSessionBlobStore.__init__ 里那句。
        # 线上走的就是这条 HTTP 分支，漏了它 = 线上永远没有 owner_id 列。
        self._q(f"alter table {TABLE} add column if not exists owner_id varchar(64)")
        _ensure_list_projection(self._q, is_sqlite=False)

    def _q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        return self._gateway.query(
            sql, params, timeout_ms=_BLOB_STATEMENT_TIMEOUT_MS
        )


def _db_url() -> str:
    from config.settings import settings

    return (getattr(settings, _DB_URL_ATTR, "") or "").strip()


def _http_api() -> tuple[str, str]:
    from .sql_gateway import http_api_credentials

    return http_api_credentials()


def _signature_now() -> str:
    from .sql_gateway import _http_api_target_key

    url, key = _http_api()
    return (
        f"{_db_url()}|file:{file_override() or ''}"
        f"|httpapi:{_http_api_target_key(url, key)}"
        f"|http:{int(_prefer_http())}"
    )


def _prefer_http() -> bool:
    from .sql_gateway import prefer_neon_http

    return prefer_neon_http()


def get_store() -> Optional[SessionBlobStore]:
    """返回会话存档的库后端；None = 走文件（调用方回落原有实现）。

    三级降级：远端 TCP → 远端 SQL over HTTP → None（文件）。
    任何一级失败都不抛给调用方——存储层绝不拖垮主链路。
    """
    global _instance, _signature
    with _lock:
        sig = _signature_now()
        if _signature == sig:
            return _instance
        _instance = _build()
        _signature = sig
        return _instance


def _build() -> Optional[SessionBlobStore]:
    override = file_override()
    if override:
        # 不打印——这是显式配置的结果，不是降级
        return None

    # 自定义 HTTPS 网关排在最前：配了它就说明这个环境出不去 5432，下面那段
    # TCP 探测纯属白等。它自己不可用时照旧往下降级，不把人卡在这一级。
    api_url, api_key = _http_api()
    if api_url:
        if not api_key:
            print("[session_store] 设了 APP_STORE_HTTP_API_URL 但没配密钥，忽略这个通道")
        else:
            try:
                store = HttpApiSessionBlobStore(api_url, api_key)
                print("[session_store] 会话存档：自定义 HTTPS SQL 网关")
                return store
            except Exception as exc:  # noqa: BLE001 — 指定了也可能连不上
                print(f"[session_store] HTTPS 网关不可用，继续降级: {str(exc)[:200]}")

    url = _db_url()
    if not url or url in _failed_urls:
        return None

    from .sql_gateway import neon_http_endpoint

    endpoint = neon_http_endpoint(url)

    if _prefer_http() and endpoint:
        try:
            store = NeonHttpSessionBlobStore(url, endpoint)
            print("[session_store] 会话存档：Neon SQL over HTTP（按 APP_STORE_NEON_HTTP 指定）")
            return store
        except Exception as exc:  # noqa: BLE001 — 指定了也可能连不上
            print(f"[session_store] 指定的 HTTP 通道不可用，继续降级: {str(exc)[:200]}")

    try:
        store = SqlSessionBlobStore(url)
        print("[session_store] 会话存档：远端数据库（TCP）")
        return store
    except Exception as exc:  # noqa: BLE001
        tcp_err = str(exc)[:200]

    if endpoint:
        try:
            store = NeonHttpSessionBlobStore(url, endpoint)
            print(f"[session_store] TCP 不可用（{tcp_err}），已改走 Neon SQL over HTTP")
            return store
        except Exception as http_exc:  # noqa: BLE001
            _failed_urls.add(url)
            print(
                f"[session_store] 远端两条通道均不可用，会话改写本地文件"
                f"（与远端分叉，恢复后不会自动回流）: "
                f"TCP={tcp_err} / HTTP={str(http_exc)[:200]}"
            )
            return None

    _failed_urls.add(url)
    print(
        f"[session_store] 远端库不可用，会话改写本地文件"
        f"（与远端分叉，恢复后不会自动回流）: {tcp_err}"
    )
    return None


def reset_cache() -> None:
    """测试用：改了配置后强制下次重建后端。"""
    global _instance, _signature
    with _lock:
        _instance = None
        _signature = None
        _failed_urls.clear()


# ────────────────────────── 一次性导入 ──────────────────────────

_imported_once = False


def import_local_file_once(local_payloads: Dict[str, dict[str, Any]]) -> Tuple[int, int]:
    """把本机文件存档里**库中还没有的**会话搬进库，每进程只跑一次。

    为什么必须有：不做导入的话，升级到这版之后，这台机器原有的会话会**从界面
    上消失**——它们还好端端躺在磁盘上，但读取路径已经改成查库了。那是比原
    问题更糟的表现。

    只插不改（`on conflict do nothing` / CAS 插入失败即跳过）：库里已有的那条
    永远更权威，本地文件可能是很久以前的陈旧副本，绝不能拿它覆盖。

    返回 (导入条数, 跳过条数)。
    """
    global _imported_once
    if _imported_once:
        return (0, 0)
    _imported_once = True

    store = get_store()
    if store is None or not local_payloads:
        return (0, 0)

    try:
        existing = set(store.load_all().keys())
    except Exception as exc:  # noqa: BLE001 — 读不到就别导，下次再说
        print(f"[session_store] 导入前读库失败，跳过本次导入: {str(exc)[:200]}")
        return (0, 0)

    imported = skipped = 0
    for sid, payload in local_payloads.items():
        if sid in existing:
            skipped += 1
            continue
        try:
            if store.save(sid, payload, expected_rev=None):
                imported += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001 — 单条失败不影响其余
            skipped += 1
            print(f"[session_store] 导入会话 {sid} 失败: {str(exc)[:120]}")

    if imported or skipped:
        print(
            f"[session_store] 本机文件存档导入完成：新增 {imported} 条，"
            f"跳过 {skipped} 条（库里已有的不覆盖）"
        )
    return (imported, skipped)


def reset_import_flag_for_tests() -> None:
    global _imported_once
    _imported_once = False
