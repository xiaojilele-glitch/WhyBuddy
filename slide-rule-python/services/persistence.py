"""
Durable SlideRule V5 session store.

The on-disk contract intentionally matches the Node durable pilot:
JSON array entries of ``[sessionId, V5SessionState]``. The reader also accepts
the older Python mapping shape so existing local dev files can be recovered.

## 2026-08-02：会话可以落库了

配了 ``APP_STORE_DATABASE_URL`` 时，会话与应用记录进同一个库（见
``services/session_blob_store``）。动机是线上那个「应用中心 23 个应用、点开
18 个空白页」——应用记录跨机器共享，会话却每台机器一份，指针自然断掉。

**本文件的判定逻辑一行没改**：lastTurnId 单调守卫、replay/reasoning 追加合并、
读不回的条目原样保留，全部照旧。换掉的只是「从哪读 prior、往哪写一条」。

两处顺带的收益：
  · 原来每次保存要把整个存档读出来再整个写回去，一轮推演内持久化好几次；
    现在按条读写。
  · 显式传 ``store_file`` 的调用（测试、逃生口）永远走文件，不受库配置影响。

并发保护从「一把进程锁」升级成「进程锁 + 行级 CAS」：库是共享的，开发机和
服务器是两个进程，光靠进程锁挡不住。CAS 失败就重读重算（见 _MAX_CAS_RETRY）。
"""

import sys
import time
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from pydantic import ValidationError

from models.v5_state import V5SessionState
from services.project_authority import assert_session_authorized, has_generated_application

STORE_FILE = "data/sliderule-sessions.json"
STORE_FILE_ENV = "SLIDERULE_SESSIONS_FILE"
LEGACY_STORE_FILE_ENV = "WHYBUDDY_SESSIONS_FILE"

StorePath = Union[str, os.PathLike[str]]
StoreError = Dict[str, Any]


def _resolve_store_file(store_file: Optional[StorePath] = None) -> Path:
    if store_file is not None:
        return Path(store_file)
    env_file = os.getenv(STORE_FILE_ENV) or os.getenv(LEGACY_STORE_FILE_ENV)
    return Path(env_file or STORE_FILE)


#: /db-api 默认 MAX_BODY_BYTES=4MB（见 deploy/postgres-https-api）。
#: 会话 JSON 再塞进 SQL 参数的 JSON，转义后大约 1.2–1.4 倍。700KB 本体
#: 是留给包裹的余量。过夜那批 413 不是 Neon——进程打的是 miantuan.ai/db-api，
#: 异常前缀 neon http 是 HttpSqlGateway 复用了旧格式化函数。
_PERSIST_BODY_BUDGET = int(os.getenv("SLIDERULE_PERSIST_BODY_BUDGET", "700000"))
_REPLAY_KEEP = 80
_RUNS_KEEP = 24
_ARTIFACTS_KEEP = 40


def _payload_too_large(exc: Exception) -> bool:
    """写库异常是不是「请求体超限」。判据盯语义词（413 / too large），
    不盯网关实现的整句原文——网关换了措辞不该让降级失灵。"""
    msg = str(exc).lower()
    return "413" in msg or "too large" in msg or "payload too large" in msg


def _should_retry_slim(exc: Exception, write_state: V5SessionState) -> bool:
    """超限必削；大包碰上 500/超时也削一档——咖啡馆过夜几乎每轮 neon/db-api
    500，不是 413，只认 413 会让降级整晚不上场。"""
    if _payload_too_large(exc):
        return True
    if _encoded_bytes(write_state) <= _PERSIST_BODY_BUDGET:
        return False
    msg = str(exc).lower()
    return any(m in msg for m in ("500", "timed out", "timeout", "disconnected"))


def _encoded_bytes(state: V5SessionState) -> int:
    try:
        return len(json.dumps(state.model_dump(), ensure_ascii=False, default=str).encode("utf-8"))
    except Exception:  # noqa: BLE001 — 量体积自己不许把写入带崩
        return _PERSIST_BODY_BUDGET + 1


def _strip_version_pages(state: V5SessionState) -> Optional[V5SessionState]:
    """抹掉版本史里的整页 HTML（specFirstPages），其余原样。

    只在落库超限的降级路径上用。没有任何一版带页时返回 None——那说明
    超限不是版本史页面造成的，让调用方走下一档（当前页 / 历史）。
    不动传入的 state：调用方手里那份还要继续当作内存权威用。
    """
    versions = list(getattr(state, "modelVersions", None) or [])
    stripped = []
    changed = False
    for v in versions:
        if isinstance(v, dict) and v.get("specFirstPages"):
            v = {**v, "specFirstPages": None}
            changed = True
        stripped.append(v)
    if not changed:
        return None
    try:
        return state.model_copy(update={"modelVersions": stripped})
    except Exception:  # noqa: BLE001 — 降级自己不许把主写入路径带崩
        return None


def _next_slim(state: V5SessionState) -> Optional[Tuple[V5SessionState, str]]:
    """按增强→观测→旧历史的顺序削一档。削不动返回 None。

    页面是增强类（fail-open）。capabilityRuns/artifacts 是证据，只在前几档
    仍超预算时才裁旧尾——当轮闭环留下，旧轮历史丢掉，总比整包写不进去、
    当轮版本指针被钉死强。
    """
    versions_slim = _strip_version_pages(state)
    if versions_slim is not None:
        return versions_slim, "version_pages"
    if getattr(state, "specFirstPages", None):
        try:
            return state.model_copy(update={"specFirstPages": None}), "current_pages"
        except Exception:  # noqa: BLE001
            return None
    replay = list(getattr(state, "sessionReplayLog", None) or [])
    reas = list(getattr(state, "reasoningEvents", None) or [])
    if len(replay) > _REPLAY_KEEP or len(reas) > _REPLAY_KEEP:
        try:
            return state.model_copy(update={
                "sessionReplayLog": replay[-_REPLAY_KEEP:],
                "reasoningEvents": reas[-_REPLAY_KEEP:],
            }), "replay_trimmed"
        except Exception:  # noqa: BLE001
            return None
    runs = list(getattr(state, "capabilityRuns", None) or [])
    arts = list(getattr(state, "artifacts", None) or [])
    if len(runs) > _RUNS_KEEP or len(arts) > _ARTIFACTS_KEEP:
        try:
            return state.model_copy(update={
                "capabilityRuns": runs[-_RUNS_KEEP:],
                "artifacts": arts[-_ARTIFACTS_KEEP:],
            }), "history_trimmed"
        except Exception:  # noqa: BLE001
            return None
    return None


def _slim_to_budget(state: V5SessionState) -> Tuple[V5SessionState, List[str]]:
    """还没撞网关就按预算预削。过夜那批：抹掉版本史后立刻又 413，
    只等网关拒绝永远慢一拍。"""
    flags: List[str] = []
    write = state
    while _encoded_bytes(write) > _PERSIST_BODY_BUDGET:
        nxt = _next_slim(write)
        if nxt is None:
            break
        write, flag = nxt
        flags.append(flag)
    return write, flags


def _store_error(reason: str, message: str) -> StoreError:
    return {
        "ok": False,
        "error": "store_corrupt",
        "reason": reason,
        "message": message,
    }


def _coerce_state(session_id: str, payload: Any) -> Tuple[Optional[V5SessionState], Optional[StoreError]]:
    if not isinstance(payload, dict):
        return None, _store_error("invalid_shape", f"session {session_id} is not an object")
    raw = {**payload, "sessionId": payload.get("sessionId") or session_id}
    # Round-trip repair: the drive path (interactive gates merge_gap_ask_into_state) may set a
    # partial coverageContract like {"blockingGapIds": [...]} on the in-memory state. That is a
    # legitimate server-produced shape, but CoverageContract requires id/requiredCapabilities, so
    # a persisted session carrying it would fail server_load and poison the whole store read.
    # Fill the missing required fields with neutral defaults so server-written state always reads back.
    contract = raw.get("coverageContract")
    if isinstance(contract, dict) and contract and ("id" not in contract or "requiredCapabilities" not in contract):
        raw["coverageContract"] = {
            "id": contract.get("id") or f"contract-{raw['sessionId']}",
            "requiredCapabilities": contract.get("requiredCapabilities") or [],
            **{k: v for k, v in contract.items() if k not in ("id", "requiredCapabilities")},
        }
    try:
        return V5SessionState.server_load(raw), None
    except (TypeError, ValidationError, ValueError) as error:
        return None, _store_error("invalid_session", str(error).splitlines()[0])


#: 「写完之后把这一份钉进内存缓存」的做法，由**上层注入**。
#:
#: ⚠ 2026-08-29：这里原来是 `from .slide_rule_session import _sessions`——
#:   持久层反过来 import 会话层，是个真的循环依赖
#:   （slide_rule_session 顶层就 import 本模块）。只好把 import 藏进函数体绕开。
#:
#:   抄 grok-build 的做法（§17）：`xai-grok-tools` 定义 `MemoryBackend` /
#:   `TerminalBackend` / `ToolSearchIndex` 这些 trait，由上层 `xai-grok-shell`
#:   去 `impl` 并在运行时注入。依赖箭头始终朝下（shell → tools），
#:   **调用在运行时反向回去**。这里同理：下层只认一个可调用对象，谁来填不管。
#:
#: ⚠ 没人注入时是 None，那一步就**安静地不做**——这是对的：钉缓存是给
#:   `slide_rule_session.load_session` 用的（「内存比库新时把预览交出去」），
#:   那个模块没被加载的话，也没人会去读这份缓存。
#:   但「没注入」不许是悄悄的：判据 test_persistence_cache_sink 钉住
#:   「import slide_rule_session 之后 sink 必须在」。
_CACHE_SINK: Optional[Callable[[str, Any], None]] = None


def set_cache_sink(fn: Optional[Callable[[str, Any], None]]) -> None:
    """上层注入「写完钉缓存」的做法。传 None 摘掉（测试用）。"""
    global _CACHE_SINK
    _CACHE_SINK = fn


def get_cache_sink() -> Optional[Callable[[str, Any], None]]:
    """判据用：确认上层真的注入过。"""
    return _CACHE_SINK


def _monotonic_key(state: V5SessionState) -> tuple:
    """Compute comparable (newer > older) key using ONLY lastTurnId numeric as version.
    This provides the version guard (lastTurnId as monotonic version) for concurrent save protection.
    Timestamp-equivalent ordering for equal lastTurnId uses serialized lock arrival (first commit wins).
    Replay/cap/ledger counts are append-only server history and MUST NOT be used
    to decide full-state clobber (prevents old snapshot with inflated replay count
    from overwriting committed goal/conversation/artifacts/ledgers at same lastTurnId).
    lastTurnId is the authority progression signal for V5.2 guard.
    """
    lt = getattr(state, "lastTurnId", None) or ""
    m = re.search(r"(\d+)", str(lt))
    turn_num = int(m.group(1)) if m else 0
    return (turn_num,)


def _id_set(items: Any) -> set:
    ids = set()
    for it in items or []:
        iid = it.get("id") if isinstance(it, dict) else getattr(it, "id", None)
        if iid:
            ids.add(iid)
    return ids


def _collections_not_shrunk(prior: V5SessionState, incoming: V5SessionState) -> bool:
    """服务端集合一个都没丢：prior 的 artifacts / capabilityRuns 都还在，对话没变短。

    ⚠ 2026-09-04：这段是从 `_is_same_turn_progress` 里原样拆出来的（逐行照搬，
      没有行为改动），因为「没缩水」和「有增长」是两件事，而同轮守卫此前只
      认后者。拆开之后进程内的服务端写入可以只要求前者——见
      `_resolve_write_state` 的 `server_write` 那段头注。
    """
    prior_arts = _id_set(getattr(prior, "artifacts", None))
    inc_arts = _id_set(getattr(incoming, "artifacts", None))
    if not prior_arts.issubset(inc_arts):
        return False
    prior_runs = _id_set(getattr(prior, "capabilityRuns", None))
    inc_runs = _id_set(getattr(incoming, "capabilityRuns", None))
    if not prior_runs.issubset(inc_runs):
        return False
    prior_conv = len(getattr(prior, "conversation", None) or [])
    inc_conv = len(getattr(incoming, "conversation", None) or [])
    if inc_conv < prior_conv:
        return False
    return True


def _is_same_turn_progress(prior: V5SessionState, incoming: V5SessionState) -> bool:
    """Distinguish the driver's own mid-turn incremental saves (legitimate progress at the
    SAME lastTurnId) from stale same-turn snapshots (which must stay blocked).

    drive_reasoning_turn / drive_full persist several times within one turn for browser poll
    visibility (start emit, capability_start, capability_complete/commit, phase decision).
    Those saves are strictly append-only: every server-owned collection of the prior state is
    contained in the incoming state, and at least one collection (artifacts, capabilityRuns,
    conversation, reasoningEvents, sessionReplayLog) has grown. A stale snapshot is missing
    prior committed data (subset check fails), and an equal-content snapshot (no growth) still
    retains the prior core — so review finding 1 (same-turn stale must not clobber goal/
    conversation/artifacts/ledgers) is preserved, while the drive loop's own commits are no
    longer dropped on the reload-after-save path.
    """
    if not _collections_not_shrunk(prior, incoming):
        return False
    prior_arts = _id_set(getattr(prior, "artifacts", None))
    inc_arts = _id_set(getattr(incoming, "artifacts", None))
    prior_runs = _id_set(getattr(prior, "capabilityRuns", None))
    inc_runs = _id_set(getattr(incoming, "capabilityRuns", None))
    prior_conv = len(getattr(prior, "conversation", None) or [])
    inc_conv = len(getattr(incoming, "conversation", None) or [])
    # Strict growth in at least one server-owned collection marks real progress.
    if len(inc_arts) > len(prior_arts) or len(inc_runs) > len(prior_runs) or inc_conv > prior_conv:
        return True
    if _id_set(getattr(incoming, "reasoningEvents", None)) - _id_set(getattr(prior, "reasoningEvents", None)):
        return True
    if _id_set(getattr(incoming, "sessionReplayLog", None)) - _id_set(getattr(prior, "sessionReplayLog", None)):
        return True
    # pendingRuns.completed 增长也是同轮真进展（能力结束落 pending 的那一笔）。
    # 不认的话，artifacts 已在上一笔 persist 进盘、这一笔只加 pending，会被
    # 同轮守卫当成陈旧快照挡掉——崩溃恢复又整轮重跑。
    prior_pending = getattr(prior, "pendingRuns", None) or {}
    inc_pending = getattr(incoming, "pendingRuns", None) or {}
    if isinstance(prior_pending, dict) and isinstance(inc_pending, dict):
        prior_done = {
            c.get("capabilityId")
            for c in (prior_pending.get("completed") or [])
            if isinstance(c, dict) and c.get("capabilityId")
        }
        inc_done = {
            c.get("capabilityId")
            for c in (inc_pending.get("completed") or [])
            if isinstance(c, dict) and c.get("capabilityId")
        }
        if inc_done - prior_done:
            return True
    return False


# Serialized guard lock for save_session_record: ensures read-prior / decide / write is atomic
# wrt other concurrent save calls (addresses concurrent RMW races). Re-read inside lock
# sees prior writers' results. Combined with lastTurnId<= compare this provides version/timestamp-equivalent
# guard (lastTurnId as version; lock order for equal-turn) using existing fields (no extra deps, no schema change).
# SQL saves also publish a local turn checkpoint under this lock. Reentrancy
# lets the database CAS helper retain its own lock for direct callers.
_save_lock = threading.RLock()

# CAS 冲突重试次数。冲突只在「另一个进程/机器刚好写了同一个会话」时发生，
# 重试一次基本就过了；给 3 次是留余量。用尽仍冲突就如实返回错误，不静默丢写入。
_MAX_CAS_RETRY = 3


def _blob_store(store_file: Optional[StorePath] = None):
    """选存储后端。返回 None 表示走文件（本文件下半部分那套实现）。

    显式传了 ``store_file`` 一律走文件：测试和「这台机器就要用这个文件」的
    逃生口都靠这条规则，绝不能被全局库配置改掉行为。
    """
    if store_file is not None:
        return None
    from . import session_blob_store

    store = session_blob_store.get_store()
    if store is not None:
        _import_local_once(store)
    return store


_import_attempted = False


#: 本机文件存档 → 库的自动导入开关。**默认关**（2026-08-13 改）。
#:
#: ## 为什么从"默认开"改成"默认关"
#:
#: 这段原本是一次性的迁移辅助：换到查库那版时，磁盘上原有的会话得搬进去，
#: 否则「数据还在，界面上却没了」。迁移早就完成了，但这段代码一直留着——
#: 于是它从"救命的"变成了"埋雷的"。
#:
#: 2026-08-13 实际炸了一次：本地起了一个进程、加载的是**生产 .env**，
#: 这段就把 data/sliderule-sessions.json 里 21 条**早就清掉的**旧会话
#: 原样推回了生产库。用户在线上又看见了本该没有的数据。
#: 日志里明明白白写着「新增 21 条」，但它长得跟启动噪音一模一样，没人会停下来看。
#:
#: 这个方向天然是危险的：**本地文件是陈旧副本，库才是真相**，而这段代码
#: 让陈旧副本单向地往真相里写。它"只插不改"保护的是"库里已有的那条"，
#: 保护不了"库里已经被删掉的那条"——删除在它眼里跟"还没导入"长得一样。
#:
#: 现在的口径：**一切走库，本地文件不回灌**。真要做一次性迁移，显式打开
#: 这个开关跑一次，别让它常驻在启动路径上。
_LOCAL_IMPORT_ENV = "SLIDERULE_SESSION_LOCAL_IMPORT"


def _local_import_enabled() -> bool:
    from .env_flags import flag

    return flag(_LOCAL_IMPORT_ENV, default=False)


def _import_local_once(store) -> None:
    """把本机文件存档里库中还没有的会话搬进库。**默认不跑**，见上面那段。

    只插不改：库里已有的那条永远更权威（本地文件可能是很旧的副本）。
    """
    global _import_attempted
    if not _local_import_enabled():
        return
    if _import_attempted:
        return
    _import_attempted = True
    try:
        from . import session_blob_store

        local, error = _read_store_file()
        if error or not local:
            return
        session_blob_store.import_local_file_once(
            {sid: state.model_dump() for sid, state in local.items()}
        )
    except Exception as exc:  # noqa: BLE001 — 导入失败不能拖垮启动
        print(f"[persistence] 本机会话导入库失败（不影响运行）: {str(exc)[:200]}")


def _reset_import_flag_for_tests() -> None:
    global _import_attempted
    _import_attempted = False


def _coerce_many(payloads: Dict[str, Any]) -> Dict[str, V5SessionState]:
    """库里读出来的原始 payload → V5SessionState。

    单条读不回就跳过（与文件后端同一条纪律：绝不因一条坏记录毒化整个列表），
    但**不需要**文件后端那套 `_unreadable_by_path` 暂存——库是按条写的，
    没被写到的行原样留在库里，本来就不会丢。
    """
    out: Dict[str, V5SessionState] = {}
    bad: list[str] = []
    for sid, payload in payloads.items():
        state, error = _coerce_state(sid, payload)
        if error:
            bad.append(sid)
            continue
        out[sid] = state
    if bad:
        print(
            f"[persistence] WARN: {len(bad)} 条库内会话读不回、已跳过"
            f"（原样留在库里，未删）: {', '.join(bad[:5])}"
        )
    return out


def _read_store(store_file: Optional[StorePath] = None) -> Tuple[Dict[str, V5SessionState], Optional[StoreError]]:
    """读全量。配了库就读库，否则读文件。"""
    store = _blob_store(store_file)
    if store is not None:
        try:
            return _coerce_many(store.load_all()), None
        except Exception as exc:  # noqa: BLE001 — 库读失败按存档损坏处理，调用方各自兜底
            return {}, _store_error("db_read_failed", str(exc)[:200])
    return _read_store_file(store_file)


def _read_store_file(store_file: Optional[StorePath] = None) -> Tuple[Dict[str, V5SessionState], Optional[StoreError]]:
    path = _resolve_store_file(store_file)
    if not path.exists():
        return {}, None

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else []
    except json.JSONDecodeError as error:
        return {}, _store_error("invalid_json", error.msg)
    except OSError as error:
        return {}, _store_error("read_failed", str(error))

    sessions: Dict[str, V5SessionState] = {}
    unreadable: List[Tuple[str, Any]] = []
    if isinstance(data, list):
        for entry in data:
            if not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[0], str):
                return {}, _store_error("invalid_shape", "expected [sessionId, state] entries")
            state, error = _coerce_state(entry[0], entry[1])
            if error:
                # 单条读不回（旧 schema/字段漂移）：跳过但原样保留（写回时按
                # 原字节带上），绝不因一条坏记录毒化整个存档（实测踩过：一条
                # 旧 marathon 会话让所有增删改查 500）。也绝不静默删除。
                unreadable.append((entry[0], entry[1]))
                continue
            sessions[entry[0]] = state
        _remember_unreadable(path, unreadable)
        return sessions, None

    if isinstance(data, dict):
        for session_id, payload in data.items():
            if not isinstance(session_id, str):
                return {}, _store_error("invalid_shape", "expected string session ids")
            state, error = _coerce_state(session_id, payload)
            if error:
                unreadable.append((session_id, payload))
                continue
            sessions[session_id] = state
        _remember_unreadable(path, unreadable)
        return sessions, None

    return {}, _store_error("invalid_shape", "expected array entries or mapping")


# 读不回的条目按存档路径暂存（进程内），写回时原样带上——保数据不保解析。
_unreadable_by_path: Dict[str, List[Tuple[str, Any]]] = {}


def _remember_unreadable(path: Path, unreadable: List[Tuple[str, Any]]) -> None:
    _unreadable_by_path[str(path)] = unreadable
    if unreadable:
        ids = ", ".join(sid for sid, _ in unreadable[:5])
        print(f"[persistence] WARN: {len(unreadable)} unreadable session(s) skipped, preserved verbatim: {ids}")


def _write_store(sessions: Dict[str, V5SessionState], store_file: Optional[StorePath] = None) -> StoreError:
    path = _resolve_store_file(store_file)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        payload = [[session_id, state.model_dump()] for session_id, state in sessions.items()]
        # 读不回的旧条目原样写回（除非同 id 已被新状态取代），不静默丢数据
        for sid, raw_payload in _unreadable_by_path.get(str(path), []):
            if sid not in sessions:
                payload.append([sid, raw_payload])
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as error:
        return {"ok": False, "error": "persist_failed", "reason": "write_failed", "message": str(error)}
    return {"ok": True, "count": len(sessions)}


# ── 会话活跃时间 sidecar ─────────────────────────────────────────────────────
# 存档条目是 [sessionId, state]，state 模型没有时间字段（加字段会动全量
# schema/version 语义）。侧栏"最近"排序需要 lastActive，用旁路 meta 文件
# （<store>.meta.json：sessionId → {"lastActive": iso}）每次成功落盘时盖章。
# 纯观测元数据：读写全容错，坏了/丢了只影响排序，绝不影响会话数据本身。


def _meta_path(store_file: Optional[StorePath] = None) -> Path:
    path = _resolve_store_file(store_file)
    return path.with_name(path.name + ".meta.json")


def read_session_meta(store_file: Optional[StorePath] = None) -> Dict[str, Dict[str, Any]]:
    """会话的 createdAt / lastActive。

    库后端不用 sidecar 文件——同一行上就有 created_at / last_active 两列，
    每次写入顺带盖章（见 session_blob_store 的 save）。sidecar 那套是文件后端
    的产物：存档条目是 [sessionId, state]，state 模型里没有时间字段。
    """
    store = _blob_store(store_file)
    if store is not None:
        try:
            return store.meta()
        except Exception:  # noqa: BLE001 — 纯观测数据，取不到只影响排序
            return {}
    try:
        raw = json.loads(_meta_path(store_file).read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _stamp_session_meta(session_id: str, store_file: Optional[StorePath] = None) -> None:
    from datetime import datetime, timezone

    try:
        meta = read_session_meta(store_file)
        entry = meta.get(session_id) if isinstance(meta.get(session_id), dict) else {}
        now = datetime.now(timezone.utc).isoformat()
        entry = {**entry, "lastActive": now}
        entry.setdefault("createdAt", now)
        meta[session_id] = entry
        _meta_path(store_file).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _drop_session_meta(session_id: str, store_file: Optional[StorePath] = None) -> None:
    try:
        meta = read_session_meta(store_file)
        if session_id in meta:
            meta.pop(session_id, None)
            _meta_path(store_file).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def load_all(store_file: Optional[StorePath] = None) -> Dict[str, V5SessionState]:
    sessions, error = _read_store(store_file)
    if error:
        return {}
    return sessions


def save_all(sessions: Dict[str, V5SessionState], store_file: Optional[StorePath] = None) -> StoreError:
    return _write_store(sessions, store_file)


class PersistClosedError(Exception):
    """认领 / pending / checkpoint 写失败。归属与证据链不许假装存了。"""

    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        self.message = message
        super().__init__(f"{reason}: {message}" if message else reason)


def _checkpoint_dir(store_file: Optional[StorePath] = None) -> Path:
    return _resolve_store_file(store_file).parent / "checkpoints"


def _safe_ckpt_token(value: str, limit: int = 160) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or ""))[:limit] or "unknown"


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Each writer owns its temporary file; close it before Windows replace.

    2026-09-13: the control loop and source owner reused ``<path>.tmp``.
    One could replace/delete the other's open file, interrupting a valid model
    turn with WinError 32 after the SQL write had already committed.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                prefix=path.name + ".", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, default=str)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _write_turn_checkpoint(state: V5SessionState, store_file: Optional[StorePath] = None) -> Optional[StoreError]:
    """轮级存档 + 父链。抄 LangGraph checkpoint 图纸，不搬框架。

    同一 lastTurnId 覆写同一份文件（一轮内多次 save 只留该轮最新快照）；
    lastTurnId 前进时 parent_id 指向上一轮。写失败返回错误——checkpoint
    是证据链，不许假装存了。
    """
    sid = str(getattr(state, "sessionId", None) or "")
    if not sid:
        return None
    from datetime import datetime, timezone

    turn_id = str(getattr(state, "lastTurnId", None) or "turn-0")
    safe_sid = _safe_ckpt_token(sid)
    safe_turn = _safe_ckpt_token(turn_id, 80)
    ckpt_id = f"ckpt-{safe_sid}-{safe_turn}"
    session_dir = _checkpoint_dir(store_file) / safe_sid
    index_path = session_dir / "index.json"
    parent_id = None
    try:
        if index_path.exists():
            try:
                idx = json.loads(index_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                idx = None
            if isinstance(idx, dict):
                latest = idx.get("latest_id")
                latest_turn = idx.get("turnId")
                if latest and latest_turn != turn_id:
                    parent_id = latest
                elif latest and latest_turn == turn_id:
                    parent_id = idx.get("parent_id")
        payload = {
            "id": ckpt_id,
            "parent_id": parent_id,
            "sessionId": sid,
            "turnId": turn_id,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "state": state.model_dump(),
        }
        _atomic_write_json(session_dir / f"{ckpt_id}.json", payload)
        _atomic_write_json(
            index_path,
            {
                "latest_id": ckpt_id,
                "turnId": turn_id,
                "parent_id": parent_id,
                "sessionId": sid,
            },
        )
    except OSError as error:
        return {
            "ok": False,
            "error": "persist_failed",
            "reason": "checkpoint_write_failed",
            "message": str(error),
            "sessionId": sid,
        }
    return None


def save_session_record(
    state: V5SessionState,
    store_file: Optional[StorePath] = None,
    *,
    server_write: bool = False,
    expected_project_revision: Optional[str] = None,
    project_binding_approval: Optional[str] = None,
    expected_control_run: Optional[Dict[str, Any]] = None,
) -> StoreError:
    # Use lock to serialize the entire read-prior + replay-merge + monotonic compare + write.
    # This ensures that on concurrent saves, each entrant re-reads the *latest* committed
    # prior (after previous writer's atomic replace), then decides using current prior.
    # Replay append-only merge ALWAYS happens from latest prior (server-owned history preserved).
    # Core authoritative fields (goal, conversation, artifacts, ledgers, lastTurnId etc) are
    # protected by lastTurnId (version) + <= compare: same-turn or lower cannot overwrite.
    # counts of replay etc never allow clobber. Fixes review finding 1 (no equal-turn clobber).
    # Serialized lock provides timestamp-equivalent ordering for same lastTurnId.
    store = _blob_store(store_file)
    if store is not None:
        # The SQL helper used to release the process lock before checkpoint IO.
        # A newer source reference could commit and checkpoint, then the older
        # control snapshot overwrote that same turn's local checkpoint. Preserve
        # commit order for local writers without retrying an unknown SQL result.
        with _save_lock:
            result = _save_session_record_db(store, state, server_write=server_write,
                                           expected_project_revision=expected_project_revision,
                                           project_binding_approval=project_binding_approval,
                                           expected_control_run=expected_control_run)
            if result.get("ok"):
                ckpt_state = result.get("state") if isinstance(result.get("state"), V5SessionState) else state
                ckpt_err = _write_turn_checkpoint(ckpt_state, store_file)
                if ckpt_err:
                    return ckpt_err
            return result
    if expected_control_run is not None:
        return {
            "ok": False,
            "error": "persist_failed",
            "reason": "control_fence_requires_durable_store",
            "message": "control-owned session writes require a durable SQL store",
            "sessionId": state.sessionId,
        }
    with _save_lock:
        sessions, error = _read_store_file(store_file)
        if error:
            return error

        prior = sessions.get(state.sessionId)
        write_state = _resolve_write_state(prior, state, server_write=server_write,
                                           expected_project_revision=expected_project_revision,
                                           project_binding_approval=project_binding_approval)
        sessions[write_state.sessionId] = write_state
        result = _write_store(sessions, store_file)
        if not result.get("ok"):
            return result
        ckpt_err = _write_turn_checkpoint(write_state, store_file)
        if ckpt_err:
            return ckpt_err
        _stamp_session_meta(write_state.sessionId, store_file)
        result = {"ok": True, "sessionId": write_state.sessionId}
        if project_binding_approval is not None:
            result["state"] = write_state
        return result


def claim_session_record(
    candidate: V5SessionState, store_file: Optional[StorePath] = None,
) -> StoreError:
    """Atomically insert a new session, or return the existing record unchanged.

    A first stream used to exist before its owner reached durable storage. Two
    viewers could both observe a missing session and attach to that same run.
    Claiming must never use save's merge/retry behavior: a lost insert returns
    the winner, and an unreadable record is not permission to replace it.
    """
    sid = candidate.sessionId

    def failed(error: StoreError) -> StoreError:
        return {**error, "ok": False, "sessionId": sid, "state": None, "created": False}

    def existing(payload: Any) -> StoreError:
        state, error = _coerce_state(sid, payload)
        if error:
            return failed(error)
        if state is None or state.sessionId != sid:
            return failed(_store_error("invalid_session", "Stored session id does not match its key"))
        return {"ok": True, "sessionId": sid, "state": state, "created": False}

    if not isinstance(sid, str) or not sid.strip():
        return failed(_store_error("invalid_session", "A session id is required"))
    try:
        store = _blob_store(store_file)
    except Exception as exc:  # noqa: BLE001 - ownership never falls back on backend failure
        return failed(_store_error("store_unavailable", str(exc)[:200]))

    with _save_lock:
        if store is not None:
            try:
                row = store.load(sid)
            except Exception as exc:  # noqa: BLE001
                return failed(_store_error("db_read_failed", str(exc)[:200]))
            if row is not None:
                return existing(row.payload)
            try:
                inserted = store.save(sid, candidate.model_dump(), expected_rev=None)
            except Exception as exc:  # noqa: BLE001
                return failed({"error": "persist_failed", "reason": "db_write_failed",
                               "message": str(exc)[:200]})
            if not inserted:
                try:
                    winner = store.load(sid)
                except Exception as exc:  # noqa: BLE001
                    return failed(_store_error("db_read_failed", str(exc)[:200]))
                if winner is None:
                    return failed({"error": "persist_failed", "reason": "claim_conflict",
                                   "message": "The winning session could not be read"})
                return existing(winner.payload)
        else:
            path = _resolve_store_file(store_file)
            _unreadable_by_path.pop(str(path), None)
            try:
                sessions, error = _read_store_file(store_file)
            except (OSError, UnicodeError) as exc:
                return failed(_store_error("read_failed", str(exc)[:200]))
            if error:
                return failed(error)
            if any(key == sid for key, _payload in _unreadable_by_path.get(str(path), [])):
                return failed(_store_error("invalid_session", "Existing session cannot be decoded"))
            if sid in sessions:
                return existing(sessions[sid].model_dump())
            sessions[sid] = candidate
            try:
                result = _write_store(sessions, store_file)
            except (OSError, TypeError, ValueError) as exc:
                return failed({"error": "persist_failed", "reason": "write_failed",
                               "message": str(exc)[:200]})
            if not result.get("ok"):
                return failed(result)

        checkpoint_error = _write_turn_checkpoint(candidate, store_file)
        if checkpoint_error:
            return failed(checkpoint_error)
        if store is None:
            _stamp_session_meta(sid, store_file)
        return {"ok": True, "sessionId": sid, "state": candidate, "created": True}


def _resolve_write_state(
    prior: Optional[V5SessionState],
    state: V5SessionState,
    *,
    server_write: bool = False,
    expected_project_revision: Optional[str] = None,
    project_binding_approval: Optional[str] = None,
) -> V5SessionState:
    """决定这次到底该把什么写下去——**判定逻辑的唯一副本**。

    文件后端和库后端都调它。历史上这段是内联在 save_session_record 里的；
    会话落库时抽出来共用，逻辑逐行照搬，没有任何行为改动。

    两件事：
      ① replay / reasoning 事件按 id 追加合并（服务端历史只增不减）；
      ② lastTurnId 单调守卫决定核心字段能不能被覆盖。

    ## server_write：进程内的服务端写入不是「陈旧快照」

    ⚠ 2026-09-04 真机（宠物寄养 / 充电桩，两趟都复现）。同轮守卫要求
      「至少一个服务端集合有增长」才算真进展。**纯标量翻转天生零增长**，
      于是这两笔一直在被静静丢掉，落库日志一个字都不吭：

          in(lt=turn-2 ph=awaiting)      prior(lt=turn-2 ph=orchestrating)  → 写回 orchestrating
          in(lt=turn-1 conf=True)        prior(lt=turn-1 conf=False)        → 写回 False

      前者是驱动器终端块把相位落回 awaiting——连写 5 笔（persist_state、
      控制面 _persist、前端 PUT）全被丢掉，会话在侧栏永远显示「推演中」。
      后者是假设卡「确认继续」：控制面在 :3020 把 assumptionsConfirmed
      置 True 后 `_apersist`，而 `_handoff_factory` 只把 **sessionId** 交给
      工厂、工厂从库里重新加载——库里那笔没落，工厂读回 False，
      刷新页面同一张卡又摊回来。用户报的就是这一条。

      ⚑ 这正是 CLAUDE.md「一之二」那个形状的第三次发作：护栏装在真跑的
        那条路上，条件却在下一层被吃掉。单测全绿，因为单测直接调这个函数
        看返回值，从不看它写没写进库。

    守卫本来要防的是**客户端**回传的轮前快照（见下面 2026-08-27 那几段）。
    进程内的服务端写入手里拿的就是活对象，不存在"少了一截committed 数据"
    ——所以对它们把同轮判据从「有增长」放宽到「没缩水」：prior 的
    artifacts / capabilityRuns 仍是子集、对话没变短，接受这一笔就丢不了东西。
    **低轮次仍然照旧挡住**（那才是真陈旧），客户端 PUT 的判据一个字没动。
    """
    # A late driver must not merge private data into a deleted/recreated ID.
    # Keep this under the same file lock / database CAS loop as every write.
    if prior is not None and prior.ownerId != state.ownerId:
        raise PersistClosedError("session_owner_changed", "Session ownership changed before save")
    project_updates: Optional[Dict[str, Any]] = None
    if project_binding_approval is not None:
        if not server_write:
            raise PersistClosedError("project_reference_server_only", "Only the project service can bind a project")
        if prior is None:
            raise PersistClosedError("project_session_required", "A durable session is required")
        try:
            assert_session_authorized(prior, owner_id=str(state.ownerId or ""), approval_ref=project_binding_approval)
        except PermissionError as exc:
            raise PersistClosedError(str(exc), "The persisted plan no longer authorizes this project") from exc
        if state.runtimeKind != "project" or not state.projectId or not state.projectRevision:
            raise PersistClosedError("project_identity_required", "The project service must supply a complete reference")
        if prior.projectId and prior.projectId != state.projectId:
            raise PersistClosedError("project_identity_changed", "The session already belongs to another project")
        if not prior.projectId and has_generated_application(prior):
            raise PersistClosedError("project_conversion_required", "Existing applications need an explicit conversion")
        if prior.projectId is None:
            project_updates = {"runtimeKind": "project", "projectId": state.projectId,
                               "projectRevision": state.projectRevision}
    # Ordinary saves, including stale server snapshots, cannot introduce a first
    # project pointer. The privileged binding above checks approval inside CAS.
    if prior is None or not prior.projectId:
        state = state.model_copy(update={"runtimeKind": "html-prototype", "projectId": None, "projectRevision": None})
    if expected_project_revision is not None:
        if not server_write:
            raise PersistClosedError("project_reference_server_only", "Only the project service can update the revision")
        if prior is None or not prior.projectId or prior.projectRevision != expected_project_revision:
            raise PersistClosedError("project_revision_conflict", "The session project revision changed before save")
        if state.projectId != prior.projectId or state.runtimeKind != "project" or not state.projectRevision:
            raise PersistClosedError("project_identity_changed", "A revision update cannot replace the session project")
        project_updates = {"runtimeKind": "project", "projectId": prior.projectId,
                           "projectRevision": state.projectRevision}
    if project_binding_approval is not None:
        # A reference update is not a conversation save. A concurrent turn may
        # have changed scalar fields without growing any collection.
        return prior.model_copy(update=project_updates or {})
    # Conversation turns and project versions advance independently. A server
    # driver can carry a nonempty but obsolete revision, even in a newer turn.
    if prior is not None and prior.projectId:
        state = state.model_copy(update={
            "runtimeKind": prior.runtimeKind,
            "projectId": prior.projectId,
            "projectRevision": prior.projectRevision,
        })
    if True:
        # Append-only replay log merge on save (sliderule-python-v52-session-replay-append-only-105)
        # Classification: ... -> PYTHON_COMPAT -> PYTHON_AUTHORITY
        # Read existing replay from durable store and merge (preserve prior + additive new by id);
        # prevents partial/stale/empty replay from client or in-mem snapshot from overwriting server-owned replay.
        # Matches V5.2 append-only intent (no clobber on save); reasoningEvents treated same.
        # Python owns this durability/readback slice; no Node fallback.
        prior_log = list(getattr(prior, "sessionReplayLog", []) or []) if prior else []
        seen = {getattr(e, "id", None) for e in prior_log if getattr(e, "id", None)}
        for ev in (getattr(state, "sessionReplayLog", []) or []):
            eid = getattr(ev, "id", None)
            if eid and eid not in seen:
                prior_log.append(ev)
        # reasoningEvents append-only merge (same server-owned append-only rule)
        prior_reas = list(getattr(prior, "reasoningEvents", []) or []) if prior else []
        seen_r = {getattr(e, "id", None) for e in prior_reas if getattr(e, "id", None)}
        for ev in (getattr(state, "reasoningEvents", []) or []):
            eid = getattr(ev, "id", None)
            if eid and eid not in seen_r:
                prior_reas.append(ev)

        # Produce candidate that carries server-merged replay/reasoning (append-only never loses)
        try:
            merged_logs_state = state.model_copy(update={"sessionReplayLog": prior_log, "reasoningEvents": prior_reas})
        except Exception:
            # fallback: mutate copy of incoming only if needed (rare)
            try:
                state.sessionReplayLog = prior_log  # type: ignore[attr-defined]
                state.reasoningEvents = prior_reas  # type: ignore[attr-defined]
            except Exception:
                pass
            merged_logs_state = state

        # pendingRuns 是服务端 crash-recovery 台账。客户端 PUT 不带这个字段
        # （模型默认 None）或带空 {} 时不许把已落盘的 pending 抹掉——抹掉 =
        # 崩溃恢复又整轮重跑，前几个 LLM 白烧。驱动器写入会带上非空 dict。
        # ⚠ 2026-08-27：第一版对「同 selected、completed 变少」也 restore。
        # skip helper 整批完成后故意 reset completed=[] 再开新台账；下一笔
        # persist（completed=[] 或 [A]，selected 不变）被当成 shrink，旧的
        # all-done 台账写回盘。第二趟崩在 A 之后恢复重烧 A——本 PR 就是为
        # 了停这个。Issue 2 的 PUT 闸是 pop+exclude，不靠这条 restore。
        # 复制失败就抛——fail-closed，不许 except pass 假装保住了。
        prior_pending = getattr(prior, "pendingRuns", None) if prior is not None else None
        if prior_pending is not None:
            inc_pending = getattr(merged_logs_state, "pendingRuns", None)
            if _pending_ledger_blank(inc_pending):
                merged_logs_state = merged_logs_state.model_copy(
                    update={"pendingRuns": prior_pending}
                )

        # 工厂待办：客户端漏带 / 默认 None 不许把已挂账的延后抹掉。
        # ⚠ [] 是驱动器清账，必须落盘——把 [] 当成 blank 会让 bind 永远清不掉。
        prior_todo = getattr(prior, "factoryTodo", None) if prior is not None else None
        if prior_todo:
            inc_todo = getattr(merged_logs_state, "factoryTodo", None)
            if inc_todo is None:
                merged_logs_state = merged_logs_state.model_copy(
                    update={"factoryTodo": prior_todo}
                )

        # 活儿清单：同 factoryTodo，客户端漏带 / 默认 None 不许把清单抹掉。
        # ⚠ [] 是「模型清空了清单」，必须落盘——当成 blank 会让清空永远不生效。
        prior_plan = getattr(prior, "controlTodo", None) if prior is not None else None
        if prior_plan:
            inc_plan = getattr(merged_logs_state, "controlTodo", None)
            if inc_plan is None:
                merged_logs_state = merged_logs_state.model_copy(
                    update={"controlTodo": prior_plan}
                )

        prior_skills = getattr(prior, "controlSkillCache", None) if prior is not None else None
        if prior_skills:
            inc_skills = getattr(merged_logs_state, "controlSkillCache", None)
            if inc_skills is None:
                merged_logs_state = merged_logs_state.model_copy(
                    update={"controlSkillCache": prior_skills}
                )

        prior_subs = getattr(prior, "subagentTasks", None) if prior is not None else None
        if prior_subs:
            inc_subs = getattr(merged_logs_state, "subagentTasks", None)
            if inc_subs is None:
                merged_logs_state = merged_logs_state.model_copy(
                    update={"subagentTasks": prior_subs}
                )

        # Version/timestamp-equivalent guard (sliderule-python-v52-session-concurrency-guard-105):
        # lastTurnId ONLY decides core clobber (goal/conversation/artifacts/ledgers/...).
        # Replay counts etc are excluded from key and from clobber decision (per review finding 1).
        # Under lock + re-read, serialized: inc turn <= prior turn blocks core overwrite (stale cannot clobber);
        # this protects same-lastTurnId concurrent/sequential stale snapshots (later arriver under lock loses for core).
        # Higher turn accepts inc core + merged replay/reasoning logs (append-only always).
        # Equal-turn uses first-under-lock as timestamp order (no later same-turn stale wins).
        # This ensures lower or same-turn snapshot cannot overwrite newer authoritative state.
        # Classification: PYTHON_AUTHORITY. No Node fallback.
        write_state = merged_logs_state
        if prior:
            p_lt = getattr(prior, "lastTurnId", None)
            i_lt = getattr(state, "lastTurnId", None)
            if p_lt and i_lt:
                p_turn = _monotonic_key(prior)[0]
                i_turn = _monotonic_key(state)[0]  # use original incoming turn, not affected by logs
                # Equal-turn saves that are append-only supersets of prior (the drive loop's own
                # incremental persists within one turn) are ACCEPTED as progress; only lower-turn
                # or same-turn non-superset/no-growth snapshots retain the prior core.
                same_turn_ok = _is_same_turn_progress(prior, state) or (
                    server_write and _collections_not_shrunk(prior, state)
                )
                if i_turn < p_turn or (i_turn == p_turn and not same_turn_ok):
                    # lower or stale-equal turn (when version present): retain prior authoritative core fields (prevents same-turn stale clobber);
                    # still carry any newly appended server-owned replay/reasoning from this attempt
                    projection_updates: Dict[str, Any] = {}
                    if getattr(state, "publishClosure", None) is not None:
                        projection_updates["publishClosure"] = getattr(state, "publishClosure", None)
                    if getattr(state, "skillRuntimeGraph", None) is not None:
                        projection_updates["skillRuntimeGraph"] = getattr(state, "skillRuntimeGraph", None)
                    # E29 版本史是服务端专有投影（客户端快照不携带，不得清空）
                    if getattr(state, "modelVersions", None):
                        projection_updates["modelVersions"] = getattr(state, "modelVersions", None)
                        projection_updates["currentModelVersionId"] = getattr(state, "currentModelVersionId", None)
                        # ⚠ 2026-08-29 真机 sr-it-B-072108：**指针动了、页没跟着动。**
                        #   回退路由（routes/sliderule_full._restore_model_version_locked）
                        #   同时改三样：currentModelVersionId、publishClosure、
                        #   specFirstPages。前两样在这份豁免名单里，第三样不在——
                        #   而回退这一笔天生**没有任何集合增长**（_is_same_turn_progress
                        #   实测 False），于是页被退回旧值：UI 显示回到 mv-1、
                        #   右侧还是 mv-2 那五张页，一声不吭。这正是 D8 那个病
                        #   （"显示回到 v1、实际跑的还是 v3"）落在交付物上的版本。
                        #
                        #   ⚠ 只在**指针真的变了**的时候豁免，不是无条件豁免。
                        #   specFirstPages 与上面几个不同：客户端快照**会**带着它
                        #   （useSlideRuleSession 回传 state 时带 specFirstPages），
                        #   无条件豁免等于把"陈旧同轮快照不许 clobber"那道保护
                        #   对交付页开了个口子。而陈旧快照带的是**同一个**指针，
                        #   进不了这个 if——保护不变，只有回退/前进那一笔通过。
                        if getattr(prior, "currentModelVersionId", None) != getattr(
                            state, "currentModelVersionId", None
                        ):
                            projection_updates["specFirstPages"] = getattr(
                                state, "specFirstPages", None
                            )
                    # E13 turnNarrations 是展示投影（同 publishClosure 类）：客户端
                    # 轮末回传时 lastTurnId 与驱动器终持久化相同且核心无增长，
                    # 不豁免会被同轮守卫连快照一起丢掉
                    if getattr(state, "turnNarrations", None):
                        projection_updates["turnNarrations"] = getattr(state, "turnNarrations", None)
                    try:
                        write_state = prior.model_copy(
                            update={
                                "sessionReplayLog": prior_log,
                                "reasoningEvents": prior_reas,
                                **projection_updates,
                            }
                        )
                    except Exception:
                        write_state = prior
        if project_updates is not None:
            write_state = write_state.model_copy(update=project_updates)
        return write_state


def _save_session_record_db(
    store, state: V5SessionState, *, server_write: bool = False,
    expected_project_revision: Optional[str] = None,
    project_binding_approval: Optional[str] = None,
    expected_control_run: Optional[Dict[str, Any]] = None,
) -> StoreError:
    """库后端的写入：读一条 prior → 同一套守卫 → CAS 写回，冲突就重来。

    与文件后端的区别只有原子性来源：文件靠 `_save_lock`（单进程独占文件），
    库靠行级 `rev` 比对（库是共享的，进程锁挡不住另一台机器）。
    判定用的是同一个 `_resolve_write_state`。

    进程锁仍然套在外面——同机多线程冲突在锁里就化解了，不用去库上自旋。
    """
    with _save_lock:
        last_error = "CAS 冲突次数用尽"
        for _ in range(_MAX_CAS_RETRY):
            try:
                row = store.load(state.sessionId)
            except Exception as exc:  # noqa: BLE001
                return _store_error("db_read_failed", str(exc)[:200])

            prior: Optional[V5SessionState] = None
            if row is not None:
                coerced, error = _coerce_state(state.sessionId, row.payload)
                if error:
                    # 库里那条读不回（旧 schema/字段漂移）：当作没有 prior 处理，
                    # 让这次写入把它顶掉。文件后端会把坏条目原样保留，但那是因为
                    # 文件是整体重写、不留就等于删；库是按条写的，这里顶掉的只有
                    # 这一条，而它本来就已经读不出来了。
                    print(
                        f"[persistence] WARN: 库内会话 {state.sessionId} 读不回，"
                        f"本次写入将覆盖它: {error.get('message')}"
                    )
                else:
                    prior = coerced

            write_state = _resolve_write_state(prior, state, server_write=server_write,
                                               expected_project_revision=expected_project_revision,
                                               project_binding_approval=project_binding_approval)
            write_state, degrade_flags = _slim_to_budget(write_state)
            new_payload = write_state.model_dump()

            # 内容没变就别写（对标 django-reversion 的 ignore_duplicates）。
            # 这不是微优化：一轮推演里 save_session 被调 5~8 次，而守卫判定
            # 「这是陈旧快照」时会把 prior 原样写回去——那次写入必然是无效的，
            # 却照样要驮着约 300KB 跑一趟网络（实测单次全量写 129ms）。
            # A control-owned write still must reach the fenced SQL predicate,
            # even when the merged payload is byte-identical. Otherwise a stale
            # worker could return "unchanged" after its lease was taken over.
            if expected_control_run is None and row is not None and store.content_hash(new_payload) == store.content_hash(
                row.payload
            ):
                return {"ok": True, "sessionId": write_state.sessionId, "unchanged": True,
                        "state": write_state}

            try:
                save_kwargs = {"expected_rev": row.rev if row is not None else None}
                if expected_control_run is not None:
                    save_kwargs["expected_control_run"] = expected_control_run
                ok = store.save(write_state.sessionId, new_payload, **save_kwargs)
            except Exception as exc:  # noqa: BLE001
                # ★ 请求体超限 / 大包 500 → 按档位再削一次重写（2026-08-18）。
                #
                # 烘焙店 + 过夜 6 话题：只抹版本史页面不够，当前页 +
                # capabilityRuns + artifacts 仍顶满 /db-api 1MB。失败被
                # 静默吞掉时，驱动器内存里版本涨了，库停在轮初；轮末前端
                # PUT 再用新 lastTurnId 把旧版本钉死。
                if _should_retry_slim(exc, write_state):
                    nxt = _next_slim(write_state)
                    if nxt is not None:
                        slim, flag = nxt
                        try:
                            save_kwargs = {"expected_rev": row.rev if row is not None else None}
                            if expected_control_run is not None:
                                save_kwargs["expected_control_run"] = expected_control_run
                            ok = store.save(slim.sessionId, slim.model_dump(), **save_kwargs)
                        except Exception as exc2:  # noqa: BLE001
                            return {
                                "ok": False,
                                "error": "persist_failed",
                                "reason": "db_write_failed",
                                "message": f"超限降级重写也失败：{str(exc2)[:160]}",
                            }
                        if ok:
                            flags = [*degrade_flags, flag]
                            print(
                                f"[persistence] 会话 {slim.sessionId} 落库超限，"
                                f"已降级 {','.join(flags)}（内存权威未改）",
                                file=sys.stderr,
                                flush=True,
                            )
                            return {
                                "ok": True,
                                "sessionId": slim.sessionId,
                                "state": slim,
                                "degradedVersionPagesStripped": "version_pages" in flags,
                                "degradeFlags": flags,
                            }
                        # 降级写也撞 CAS：走外层重读重算（守卫必须重新过一遍）
                        continue
                return {
                    "ok": False,
                    "error": "persist_failed",
                    "reason": "db_write_failed",
                    "message": str(exc)[:200],
                }
            if ok:
                # 把刚写下去的状态一并返回：调用方（slide_rule_session.save_session）
                # 本来要再 load 一次来对账，而这里手上就是权威结果——省掉的是
                # 每次 save 的第三趟全量往返（实测 264ms → 约 180ms）。
                out: StoreError = {
                    "ok": True,
                    "sessionId": write_state.sessionId,
                    "state": write_state,
                }
                if degrade_flags:
                    out["degradeFlags"] = degrade_flags
                    out["degradedVersionPagesStripped"] = "version_pages" in degrade_flags
                return out
            # 写不进去 = 这一瞬间别人改过同一条。重读重算——注意必须重新过一遍
            # 守卫，不能拿刚才算好的 write_state 硬写，否则就把别人的提交冲掉了。
        return {
            "ok": False,
            "error": "persist_failed",
            "reason": "cas_conflict",
            "message": last_error,
            "sessionId": state.sessionId,
        }


def load_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    store = _blob_store(store_file)
    if store is not None:
        try:
            row = store.load(session_id)
        except Exception as exc:  # noqa: BLE001
            return {**_store_error("db_read_failed", str(exc)[:200]), "sessionId": session_id}
        if row is None:
            return {"ok": False, "error": "not_found", "sessionId": session_id}
        state, error = _coerce_state(session_id, row.payload)
        if error:
            return {**error, "sessionId": session_id}
        return {"ok": True, "sessionId": session_id, "session": state}
    return _load_session_record_file(session_id, store_file)


def _load_session_record_file(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    sessions, error = _read_store_file(store_file)
    if error:
        return {**error, "sessionId": session_id}
    state = sessions.get(session_id)
    if state is None:
        return {"ok": False, "error": "not_found", "sessionId": session_id}
    return {"ok": True, "sessionId": session_id, "session": state}


def _summary_from_state(state: V5SessionState, meta: Dict[str, Any]) -> dict[str, Any]:
    sid = getattr(state, "sessionId", "") or ""
    m = meta.get(sid) if isinstance(meta.get(sid), dict) else {}
    owner = str(getattr(state, "ownerId", None) or "").strip() or None
    goal = state.goal if isinstance(getattr(state, "goal", None), dict) else {}
    return {
        "sessionId": sid,
        "ownerId": owner,
        "goal": goal.get("text", "") if isinstance(goal, dict) else "",
        "createdAt": m.get("createdAt"),
        "lastActive": m.get("lastActive"),
        "artifactCount": len(getattr(state, "artifacts", None) or []),
        "phase": getattr(state, "runtimePhase", None),
    }


def _public_list_item(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "sessionId": summary.get("sessionId") or "",
        "goal": summary.get("goal") or "",
        "createdAt": summary.get("createdAt"),
        "lastActive": summary.get("lastActive"),
        "artifactCount": int(summary.get("artifactCount") or 0),
        "phase": summary.get("phase"),
    }


def _list_session_summaries_raw(
    store_file: Optional[StorePath] = None,
) -> Tuple[Optional[list], Optional[StoreError]]:
    store = _blob_store(store_file)
    if store is not None:
        try:
            return store.list_summaries(), None
        except Exception as exc:  # noqa: BLE001
            return None, _store_error("db_read_failed", str(exc)[:200])
    sessions, error = _read_store_file(store_file)
    if error:
        return None, error
    meta = read_session_meta(store_file)
    return [_summary_from_state(state, meta) for state in sessions.values()], None


def list_session_summaries(store_file: Optional[StorePath] = None) -> list:
    """侧栏列表：带 ownerId 供归属过滤。库后端不 hydrate payload。"""
    rows, error = _list_session_summaries_raw(store_file)
    if error or rows is None:
        return []
    return rows


def session_has_goal(row: Any) -> bool:
    """侧栏「话题」：有目标原文才算一条。

    ⚠ 2026-08-21：点「+ 新会话」会先落一条 idle、goal 为空的壳。侧栏
    `named = sessions.filter(s => goal.trim())` 把它藏掉，管理台按行数
    汇总就会比人看见的多 1。用户表「话题」必须跟这条同一口径。
    """
    return bool(str((row or {}).get("goal") or "").strip())


def list_session_records(store_file: Optional[StorePath] = None) -> StoreError:
    rows, error = _list_session_summaries_raw(store_file)
    if error:
        return error
    return {
        "ok": True,
        "sessions": [_public_list_item(row) for row in (rows or [])],
    }


def delete_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    store = _blob_store(store_file)
    if store is not None:
        try:
            store.delete(session_id)  # 幂等：删不存在的也算成功（G1 契约）
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "error": "persist_failed",
                "reason": "db_delete_failed",
                "message": str(exc)[:200],
                "sessionId": session_id,
            }
        return {"ok": True, "sessionId": session_id}
    sessions, error = _read_store_file(store_file)
    if error:
        return {**error, "sessionId": session_id}
    sessions.pop(session_id, None)
    result = _write_store(sessions, store_file)
    if not result.get("ok"):
        return result
    _drop_session_meta(session_id, store_file)
    return {"ok": True, "sessionId": session_id}


#: 落库慢到这个秒数就打一行。**不是告警，是留痕**——一轮里 persist_state 会被
#: 调十几次，每次都打会把日志淹掉；只在异常慢的时候说话。
_PERSIST_SLOW_SECONDS = float(os.getenv("SLIDERULE_PERSIST_SLOW_SECONDS", "5"))


def persist_state(state: V5SessionState):
    """落库。慢的时候要说话——**此前它是完全静默的**。

    ⚑ 2026-08-14：收尾那 821 秒排查不下去，正是因为这里不吭声。
      代码上只隔三行的 record_model_version 与 publish_closure 之间隔了 821 秒，
      而这三行里唯一会阻塞的就是它（会话载荷 324KB，走远端 HTTPS SQL 网关）。
      "写卡住了" 和 "别处卡住了" 在日志里长得一模一样，只能靠猜——
      这次把它变成一眼可见的。
    """
    _t0 = time.monotonic()
    result: Any = None
    try:
        result = save_session_record(state, server_write=True)
        return result
    finally:
        _took = time.monotonic() - _t0
        _sid = getattr(state, "sessionId", "?")
        # 失败必须出声（2026-08-18）：终局落盘失败被静默吞掉的代价是——
        # 驱动器内存里的 modelVersions/turnNarrations/lastTurnId 改名全部
        # 蒸发，库里停在轮初快照，且日志一行不吭。排查只能靠"库里少了东西"
        # 倒推。与下面慢写警告同一条纪律：写卡住/写失败都要一眼可见。
        if isinstance(result, dict) and not result.get("ok"):
            print(
                f"[persist] 会话 {_sid} 落库失败："
                f"{result.get('reason')}: {str(result.get('message') or '')[:200]}",
                file=sys.stderr,
                flush=True,
            )
        # 驱动器走 persist_state 不经 save_session。库写失败/降级后，
        # GET 若只信库会读到旧指针；把当轮内存钉进缓存，让 load_session
        # 在「内存比库新」时把预览和版本交出去（2026-08-18 过夜）。
        if getattr(state, "sessionId", None) and _CACHE_SINK is not None:
            try:
                _CACHE_SINK(state.sessionId, state)
            except Exception:  # noqa: BLE001 — 缓存留痕不许拖垮写入
                pass
        if _took >= _PERSIST_SLOW_SECONDS:
            print(
                f"[persist] 会话 {_sid} 落库耗时 {_took:.1f}s（超过 {_PERSIST_SLOW_SECONDS:.0f}s 阈值）",
                file=sys.stderr,
                flush=True,
            )


def _pending_ledger_blank(value: Any) -> bool:
    """客户端没带 / 带了空 {} / 非 dict：不能当「清空台账」。"""
    if value is None or not isinstance(value, dict):
        return True
    return not (value.get("selected") or value.get("completed"))


def _pending_selected_ids(selected: Optional[List[Any]]) -> List[str]:
    ids: List[str] = []
    for item in selected or []:
        cap = item if isinstance(item, str) else (item.get("capabilityId") if isinstance(item, dict) else None)
        if cap:
            ids.append(str(cap))
    return ids


def pending_goal_key(state: Any) -> str:
    """pendingRuns 这批活是为**哪个目标**干的。

    崩溃恢复要靠它判"还是同一件活"。不能用 lastTurnId：恢复是一次新的
    drive，`_advance_turn_version` 一进来就把它步进一格，按 turnId 判等于
    把崩溃恢复整个关掉（`_apply_pending_run_skips` 的头注里有这段）。
    """
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    return str(getattr(goal, "text", "") or "").strip()


def record_pending_run(
    state: V5SessionState,
    capability_id: str,
    loop: int = 0,
    selected: Optional[List[Any]] = None,
    status: str = "ok",
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """把刚完成的能力记进 state.pendingRuns（内存）。同一能力不重复记。"""
    pending = getattr(state, "pendingRuns", None)
    if not isinstance(pending, dict):
        pending = {}
    completed = [c for c in (pending.get("completed") or []) if isinstance(c, dict)]
    if not any(c.get("capabilityId") == capability_id for c in completed):
        completed.append({
            "capabilityId": capability_id,
            "runId": run_id or f"run-{loop}-{capability_id}",
            "status": status,
            "loop": loop,
        })
    selected_ids = list(pending.get("selected") or []) or _pending_selected_ids(selected)
    if not selected_ids:
        selected_ids = _pending_selected_ids(selected)
    pending = {
        "turnId": getattr(state, "lastTurnId", None),
        # ⚠ **goal 必须原样带下去。** 这段是把 pendingRuns 整个**重建**，
        #   不认识的键会被静默丢掉——2026-08-27 给台账加"这批活是为哪个目标
        #   干的"时就栽在这里：`_apply_pending_run_skips` 写上了，第一个能力
        #   一完成这里重建一次就没了，于是恢复那趟永远对不上，崩溃恢复整个
        #   失效（前面烧掉的 LLM 全白烧）。
        #   本仓第四条：同一件事两处实现，改一处不报错、只有一半生效。
        "goal": pending.get("goal")
        if pending.get("goal") is not None
        else pending_goal_key(state),
        "loop": loop if pending.get("loop") is None else pending.get("loop"),
        "selected": selected_ids,
        "completed": completed,
    }
    state.pendingRuns = pending
    return pending



