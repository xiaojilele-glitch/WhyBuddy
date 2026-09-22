# -*- coding: utf-8 -*-
"""SQL 网关：连接参数、HTTP 网关客户端、错误形状（2026-08-29 从 app_store 抽出来）。

## 为什么单独成模块

`identity_store`（身份）与 `session_blob_store`（会话存档）都要用这套东西——
连接参数、`HttpSqlGateway`、错误格式化。而它们原来长在 `app_store` 里，于是
**身份与会话都反过来依赖应用商店**：

    identity_store     → app_store   （_sql_engine_config / HttpSqlGateway / _neon_http_error）
    session_blob_store → app_store   （_sql_engine_config / HttpSqlGateway / http_api_credentials）

组级看就是 `identity ⇄ app_store`、`drive ⇄ app_store` 两个环。而这几样东西
**根本不是应用商店的业务**——它们是数据库基础设施，谁存东西谁都要用。

抄 grok 的叶子 crate（§17/§19）：共用基础设施切出来，谁都能向下依赖它，
它谁都不依赖回去。

## ⚠ app_store 里保留同名转出

`app_store` 自己的 200 多处调用、以及仓里按 `from .app_store import HttpSqlGateway`
写的脚本与判据（backfill 脚本、架构对账脚本都在用）照常有效。
**搬家只该改依赖方向，不该把别人的调用点弄红。**
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import httpx

from config.settings import settings

_PREFER_HTTP_ENV = "APP_STORE_NEON_HTTP"

#: 编号占位符 `$1`。只在**扫描器判定为普通 SQL 文本**的区段里才替换。
_NUMERIC_PLACEHOLDER_RE = re.compile(r"\$(\d+)")
#: 美元引号块的开头：`$$` 或 `$tag$`（tag 是标识符）。
_DOLLAR_TAG_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")

# Postgres 错误的结构化字段。与官方 JS 驱动 @neondatabase/serverless 的
# httpQuery.ts `errorFields` 对齐（16 项），外加 `neon:retryable`——那一项
# 官方没读，但端点确实会返回（2026-07-27 对真库触发唯一键冲突/语法错误
# /列不存在实测确认），它直接回答"重试有没有意义"，比自己猜错误码靠谱。
_NEON_ERROR_FIELDS = (
    "severity", "code", "detail", "hint", "position", "internalPosition",
    "internalQuery", "where", "schema", "table", "column", "dataType",
    "constraint", "file", "line", "routine", "neon:retryable",
)
def _scan_numeric_placeholders(sql: str) -> tuple[str, list[int]]:
    r"""扫一遍 SQL，返回 (换成 `%s` 的 SQL, 按出现顺序排列的原始序号)。

    序号表是 `numeric_to_format` 重排参数用的——见那边关于 `$3, $3` 的说明。

    ## 为什么是扫描器而不是一条正则

    第一版写的是 `(?<!\$)\$(\d+)`，想用后顾断言避开美元引号块。**它不成立**：
    `$$hello $1 world$$` 里的 `$1` 前面是空格不是 `$`，照样被替换，把字符串
    **内容**改掉了——这类"差不多对"是静默数据损坏，比直接报错糟得多。

    所以改成走一遍：`'...'`（含 `''` 转义）和 `$tag$...$tag$` 两种区段整段
    跳过，只在剩下的普通 SQL 文本里替换。
    """
    out: list[str] = []
    order: list[int] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'":
            # 单引号字符串：'' 是转义的单引号，不算结束
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(sql[i:j])
            i = j
            continue
        if ch == "$":
            m = _DOLLAR_TAG_RE.match(sql, i)
            if m:
                tag = m.group(0)
                close = sql.find(tag, m.end())
                j = n if close < 0 else close + len(tag)
                out.append(sql[i:j])
                i = j
                continue
            m2 = _NUMERIC_PLACEHOLDER_RE.match(sql, i)
            if m2:
                out.append("%s")
                order.append(int(m2.group(1)))
                i = m2.end()
                continue
        out.append(ch)
        i += 1
    return "".join(out), order


#: 单条语句上限。正常查询是百毫秒级（最大的一次是取一张几百 KB 的缩略图），
#: 8s 只用来兜"不正常"，不会误伤。
#:
#: ⚠ 会话档的 JSONB UPSERT 不是百毫秒级。2026-08-18 咖啡馆 10 轮把这条 8s
#: 照抄到会话写入上，Postgres 57014 → 线上 /db-api 回 500，一轮炸十几次。
#: 会话通道自己传更宽的 timeout_ms，这里的 8s 只给应用库/身份库。
_PG_STATEMENT_TIMEOUT_MS = 8_000
#: 等锁上限。专门给 DDL——ALTER TABLE 要 ACCESS EXCLUSIVE 锁，撞上任何一个
#: 正在读这张表的连接就会**无限等**。3s 等不到就放弃，下次启动再补。
_PG_LOCK_TIMEOUT_MS = 3_000
#: 事务里发呆多久自己断。防的是"连接攥着锁不放，把别人全堵住"。
_PG_IDLE_TX_TIMEOUT_MS = 10_000
def _sql_engine_config(url: str, null_pool: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """按后端方言产出 (connect_args, engine_kwargs)——Postgres 走 Neon 最佳
    实践，SQLite 走本地默认。抽成纯函数是为了能离线单测这套配置（不真连库）。

    Neon 最佳实践（连接串是 -pooler 端点 = PgBouncer transaction 模式）：
    - prepare_threshold=None：关掉 psycopg 客户端自动预处理语句。预处理语句活在
      session 层、跨事务不保留，transaction 池并发下会抛 "prepared statement
      does not exist"（psycopg#1151 / Crunchy Data / Neon 官方一致建议）。
    - poolclass=NullPool：用了 Neon 自带 PgBouncer 就别让 SQLAlchemy 再套一层
      连接池（两层打架 + 长连遇 scale-to-zero 挂起变陈旧）。NullPool 每次开新
      连接、用完即还给 PgBouncer，是 SQLAlchemy 官方对"外部池"的推荐。
    - connect_timeout=4：连不上快速失败 → fail-open 回退 JSON。
    - options 里的三个服务端超时（2026-08-02 事故修复，见下）。

    ## 为什么必须有语句级超时

    线上事故：切回 Neon 后 Python 单 worker 被堵死，`/api/health` 一起超时。
    根因之一是**这套四级 fail-open 只兜异常、不兜"卡住"**——降级全靠 except
    触发，而一条永远不返回的查询什么都不抛，于是一级都不会降。

    `connect_timeout` 只管握手那一段；连上之后想跑多久跑多久。三个服务端超时
    补的正是这一段：

      statement_timeout                     单条语句上限
      lock_timeout                          等锁上限——DDL（ALTER TABLE 要
                                            ACCESS EXCLUSIVE）撞上别的连接时
                                            会无限等，这条是专门给它的
      idle_in_transaction_session_timeout   事务里发呆的连接自己断，别攥着锁

    值取得比正常查询宽一个数量级（缩略图那张图几百 KB，正常也就百毫秒级），
    只用来兜"不正常"。超时表现为异常 → 上层照常降级到下一级存储，而不是吊死。

    ⚠️ 连接串自带 options 时**不覆盖**：Neon 用 `options=endpoint%3D...` 做
    端点路由，盖掉会连错库。这种情况下放弃设超时（宁可没有，也不能改坏路由），
    由 get_backend 的墙钟预算兜底。
    """
    connect_args: dict[str, Any] = {}
    engine_kwargs: dict[str, Any] = {"future": True}
    if url.startswith("postgresql"):
        connect_args["connect_timeout"] = 4
        connect_args["prepare_threshold"] = None
        if "options=" not in url:
            connect_args["options"] = (
                f"-c statement_timeout={_PG_STATEMENT_TIMEOUT_MS}"
                f" -c lock_timeout={_PG_LOCK_TIMEOUT_MS}"
                f" -c idle_in_transaction_session_timeout={_PG_IDLE_TX_TIMEOUT_MS}"
            )
        engine_kwargs["poolclass"] = null_pool
    else:
        # 本地 SQLite：无外部池，保留 pre_ping（文件库无 scale-to-zero 问题，无害）。
        engine_kwargs["pool_pre_ping"] = True
    return connect_args, engine_kwargs


def configure_sqlite_journal(engine: Any) -> None:
    """Use WAL before any schema/worker traffic reaches a file-backed SQLite.

    2026-09-13: the full Studio smoke shared one SQLite file between session,
    identity, project/control and app stores. DELETE journal lets a session-list
    cursor prevent another store's commit; that pending writer can then block
    even the control scanner's SELECT. Their cursors were scoped correctly, but
    separate engines do not make SQLite's database-wide reader locks independent.

    Configure the persistent file mode outside a transaction, before consumers
    start. WAL lets readers retain a snapshot while the writer commits. It does
    not admit simultaneous writers, change CAS, retry SQL, loosen durability, or
    increase existing busy timeouts. In-memory SQLite cannot use WAL; PostgreSQL
    is untouched. An unsupported file mode fails initialization explicitly.
    """
    if engine.dialect.name != "sqlite":
        return
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        mode = str(connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()).lower()
        if mode in {"wal", "memory"}:
            return
        mode = str(connection.exec_driver_sql("PRAGMA journal_mode=WAL").scalar_one()).lower()
        if mode != "wal":
            raise RuntimeError("sqlite_wal_unavailable")


_NEON_HTTP_TIMEOUT_S = 15
def http_api_query_endpoint(api_base_url: str) -> Optional[str]:
    """把自定义 HTTPS SQL API 的 base URL 归一成 /v1/query 端点。"""
    base = (api_base_url or "").strip().rstrip("/")
    if not base:
        return None
    if base.endswith("/v1/query"):
        return base
    return f"{base}/v1/query"
class NeonHttpError(RuntimeError):
    """带 Postgres 结构化错误字段的 HTTP 后端异常。

    此前只截响应体前 200 字符，诊断信息虽然在文本里但要靠人眼捞——唯一键
    冲突这种只想知道 `code=23505 constraint=xxx` 的场景，截断还可能正好把
    关键部分切掉。现在按官方驱动同款把字段提出来挂在异常上。

    注意：调用方（get_backend）仍然是 fail-open——出错就降级，不因为拿到了
    结构化字段就改成重试或抛给主链路。这里只提升可诊断性，不动控制流。"""

    def __init__(self, message: str, status: int, fields: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.status = status
        self.fields = fields or {}

    @property
    def code(self) -> Optional[str]:
        return self.fields.get("code") or None

    @property
    def retryable(self) -> Optional[bool]:
        value = self.fields.get("neon:retryable")
        return value if isinstance(value, bool) else None
def _gateway_http_error(resp: Any, *, prefix: str) -> NeonHttpError:
    """把一个失败响应解析成带结构化字段的异常；非 JSON 响应回落到文本截断。"""
    try:
        payload = resp.json()
        if not isinstance(payload, dict):
            raise ValueError("payload not an object")
    except Exception:  # noqa: BLE001 — 网关 5xx 常返回 HTML，回落文本即可
        return NeonHttpError(f"{prefix} {resp.status_code}: {resp.text[:200]}", resp.status_code)
    fields = {k: payload[k] for k in _NEON_ERROR_FIELDS if payload.get(k) not in (None, "")}
    message = str(payload.get("message") or payload.get("detail") or "").strip() or resp.text[:200]
    # 摘要里带上最常用来定位的三项，日志一眼能看出是什么错
    summary = ", ".join(
        f"{k}={fields[k]}" for k in ("code", "constraint", "detail") if k in fields
    )
    text = f"{prefix} {resp.status_code}: {message}" + (f" ({summary})" if summary else "")
    return NeonHttpError(text, resp.status_code, fields)
def _neon_http_error(resp: Any) -> NeonHttpError:
    return _gateway_http_error(resp, prefix="neon http")
def _http_gateway_error(resp: Any) -> NeonHttpError:
    """自定义 /db-api 的错误前缀。

    ⚠ 2026-08-18 过夜清单把 413/500 写成了 Neon 上限。进程打的是
    miantuan.ai/db-api，只是 HttpSqlGateway 复用了 neon http 前缀——
    排查会整晚找错库。判据仍认 413 / too large，不认前缀字面。
    """
    return _gateway_http_error(resp, prefix="db-api http")
def numeric_to_format(
    sql: str, params: Optional[list[Any]] = None
) -> tuple[str, list[Any]]:
    """`$n` 语句 + 参数表 → `%s` 语句 + **重排后**的参数表（2026-08-05）。

    ## 为什么需要这层转换

    `HttpApiAppStore` 继承 NeonHttpAppStore，连 SQL 一起继承——那些 SQL 用的是
    `$1`、`$2`（Neon 的 HTTP 接口按 Postgres 原生扩展协议吃这套）。本仓的
    /db-api 底层是 psycopg，`cur.execute(sql, params)` 走 DB-API 的 `format`
    paramstyle，只认 `%s`。PEP 249 定义了五种 paramstyle，两边各站一头。

    真机症状有迷惑性：**不带参数的语句全过、带参数的全 500**。后端因此
    "初始化成功、列表也读得出来"，一存就炸，看着像权限或建表问题。

    ## 为什么在这里转，而不是把上面的 SQL 改成 `%s`

    那些 SQL 是 NeonHttpAppStore 和 HttpApiAppStore **共用的一份**。改成 `%s`
    会让 Neon 那条路挂掉；给每个后端各写一份则必然分叉——两份 upsert 迟早只改
    一份。转换点收在唯一出口（`HttpSqlGateway.query`）上，共用的部分保持一份。

    ## 一个仍然存在的前提

    转成 format paramstyle 之后，SQL 里的**字面量 `%` 必须写成 `%%`**，否则
    psycopg 会把它当成占位符的开头。本文件现有 SQL 里没有字面量 `%`（查过），
    将来加 `like '%foo%'` 这类语句时要注意——这个函数不替你转义，因为它
    分不清 `%` 是你要的字面量还是别的后端的占位符。

    ## 光换符号是不够的

    `$n` 是**具名**的：同一个参数可以在语句里引用多次，也可以不按顺序引用。
    `%s` 是**位置**的：第 k 个 `%s` 吃第 k 个参数，没有复用一说。

    会话存档的 upsert 就正好踩在这上面：

        values ($1, $2::jsonb, 1, $3, $3)   -- created_at 和 last_active 同一个值

    只换符号会得到 4 个 `%s` 配 3 个参数，psycopg 直接报参数不够。所以扫描器
    额外吐出「每个占位符原本是第几号」，这里照着把参数表铺开：`[a,b,c]` →
    `[a,b,c,c]`。乱序引用（`$2, $1`）同理会被正确换位。

    序号越界（比如 SQL 里写了 `$4` 但只给了 3 个参数）直接抛，不静默补 None：
    那种情况下写进库的是一行错数据，比报错难查得多。
    """
    out_sql, order = _scan_numeric_placeholders(sql)
    src = list(params or [])
    if not order:
        return out_sql, src
    remapped: list[Any] = []
    for idx in order:
        if idx < 1 or idx > len(src):
            raise IndexError(
                f"SQL 引用了 ${idx}，但只传了 {len(src)} 个参数: {out_sql[:120]}"
            )
        remapped.append(src[idx - 1])
    return out_sql, remapped
#: 单次查询最多取多少行。服务端 DB_API_MAX_ROWS 默认封顶 5000，要更多就得先
#: 改服务端；这里对齐它，别请求一个会被静默改小的数。
_HTTP_API_MAX_ROWS = 5000
class HttpSqlGateway:
    """自定义 HTTPS SQL 网关（本仓库的 deploy/postgres-https-api）的薄客户端。

    ## 为什么单独抽一个类

    三个存储——应用库、身份库、会话档——都要走这条通道，而它们的"后端"长得
    完全不一样（一个是 AppStoreBackend 子类，一个是执行器协议，一个是
    SessionBlobStore 子类）。共用的只有"怎么把一条 SQL 送出去"这一件事：
    鉴权头、占位符方言、超时、行数上限、错误映射。抄三份的话，将来网关加个
    字段就得记着改三处——本项目已经在 upsert 上吃过这种分叉的亏。

    ## 截断为什么要抛而不是截断

    服务端拿 `max_rows` 封顶并在响应里给 `truncated`。**少几行不报错**是最难
    查的一类故障：会话列表看着正常，只是"有些会话不见了"。所以这里发现截断
    就抛——真撞上了要么分页要么调服务端上限，两者都得是人做的决定。
    """

    def __init__(
        self,
        api_base_url: str,
        api_key: str,
        *,
        timeout_s: float = _NEON_HTTP_TIMEOUT_S,
    ) -> None:
        import httpx

        endpoint = http_api_query_endpoint(api_base_url)
        token = (api_key or "").strip()
        if not endpoint:
            raise ValueError("HTTPS SQL 网关地址为空（APP_STORE_HTTP_API_URL）")
        if not token:
            raise ValueError("HTTPS SQL 网关密钥为空（APP_STORE_HTTP_API_KEY）")
        self.endpoint = endpoint
        self._client = httpx.Client(
            timeout=timeout_s,
            headers={
                # 凭据只在头里，不进 URL 也不进日志
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    def query(
        self,
        sql: str,
        params: Optional[list[Any]] = None,
        *,
        max_rows: int = _HTTP_API_MAX_ROWS,
        timeout_ms: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        # 占位符方言在这里转，**不改调用方那些 SQL**（2026-08-05）：那些语句是
        # Neon 后端和本通道共用的一份，改了会让 Neon 那条路挂掉。见 numeric_to_format。
        out_sql, out_params = numeric_to_format(sql, params)
        resp = self._client.post(
            self.endpoint,
            json={
                "sql": out_sql,
                "params": out_params,
                "timeout_ms": (
                    _PG_STATEMENT_TIMEOUT_MS if timeout_ms is None else timeout_ms
                ),
                "max_rows": max_rows,
            },
        )
        if resp.status_code >= 400:
            raise _http_gateway_error(resp)
        body = resp.json()
        if body.get("truncated"):
            raise NeonHttpError(
                f"HTTPS SQL 网关在 {max_rows} 行处截断了结果，剩下的没取回来: "
                f"{out_sql[:120]}",
                resp.status_code,
            )
        return body.get("rows") or []
def http_api_credentials() -> tuple[str, str]:
    """三个存储共用的一处读取点：(网关地址, 密钥)，都已 strip。"""
    return (
        (getattr(settings, "APP_STORE_HTTP_API_URL", "") or "").strip(),
        (getattr(settings, "APP_STORE_HTTP_API_KEY", "") or "").strip(),
    )


def neon_http_endpoint(database_url: str) -> Optional[str]:
    """从 Postgres 连接串派生 Neon 的 SQL-over-HTTP 端点；非 Neon 主机返回 None。

    只对 *.neon.tech 生效——别的 Postgres（自建/RDS）没有这个 HTTP 端点，
    盲目拼一个地址去打只会得到一串困惑的连接错误。"""
    try:
        from sqlalchemy.engine.url import make_url

        host = make_url(re.sub(r"^postgresql\+\w+://", "postgresql://", database_url)).host
    except Exception:  # noqa: BLE001 — 连接串解析不了就不是我们能处理的
        return None
    if not host or not host.lower().endswith(".neon.tech"):
        return None
    return f"https://{host}/sql"
def _http_api_target_key(api_base_url: str, api_key: str) -> str:
    digest = hashlib.sha256((api_key or "").encode("utf-8")).hexdigest() if api_key else ""
    return f"{(api_base_url or '').strip()}|{digest}"
def prefer_neon_http() -> bool:
    """是否**跳过 TCP、直接走 Neon SQL over HTTP**（2026-08-02 事故后加）。

    ## 为什么需要一个显式开关

    HTTP 这条通道本来只是兜底：TCP 初始化抛异常了才轮到它。但线上事故的形状恰恰
    是 **TCP "能连上、只是慢得要死"**——探针过、连接最终也建得起来，于是永远走不
    到 HTTP，哪怕在那台机器上 HTTP 明显更稳。

    两条通道实测对比（同一个库、同一份数据）：

      TCP    连接要在 pooler 解析出的 6 个地址里逐个试，每个 connect_timeout=4s，
             最坏单次连接 24s；语句超时得靠 options 传，而连接串自带 options
             （Neon 用它做端点路由）时传不进去。
      HTTP   共享 httpx.Client（keep-alive），**每次查询 15s 硬超时**，
             不存在"卡住不返回"。实测 p50 77ms（就是网络往返）、并发 8 吞吐
             31 条/s，功能与 SQLAlchemy 后端逐项对齐（11 个接口方法全部自实现）。

    默认不开，行为与之前逐字节一致。受这个坑的部署把它打开即可，不用改代码。
    """
    from config.env_flags import flag

    return flag(_PREFER_HTTP_ENV, default=False)
