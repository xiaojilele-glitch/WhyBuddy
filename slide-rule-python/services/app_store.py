"""
生成应用存储 / Generated App Store —— 把推演出来的应用「设计层」持久化，
作为后续「组建库」的原料仓库。

设计层 = 一个生成应用长啥样：五系统模型 + appbundle + 身份主题 +
FreeformInsight 内容 + 首页设计。这跟"用户在生成出来的 app 里录入的真实
业务行数据"（运行时实例层，现在在前端 localStorage）是两回事，本模块只管
设计层。

后端选择（照 vector_rag / image_client / e2b 同一套"有 key 就用、没 key
诚实兜底"纪律）：
- settings.APP_STORE_DATABASE_URL 填了任意 SQLAlchemy URL（Neon/自建
  Postgres 用 postgresql://…；也接受 sqlite:///data/apps.db 这种本地库）
  → 落库，可查询、可索引、可并发。
- settings.APP_STORE_HTTP_API_URL + APP_STORE_HTTP_API_KEY 指向自定义 HTTPS
  SQL API（例如本仓库的 /db-api）时 → 走 HTTPS 代理，不要求原生 Postgres 协议。
- 不填 → fail-open 回退本地 JSON 文件（APP_STORE_FILE），行为跟"没有 DB"
  时完全一致，不引入新的失败面。

两个后端跑同一套 SQLAlchemy/文件无关的接口，model_json 用可移植的 JSON 类型
（生产落 Postgres 的 JSONB、本地/测试落 SQLite 的 JSON，同一份代码）——所以
本地用 SQLite 就能把落库逻辑全测通，生产换 Neon 连接串零改动。

血缘：每条记录带 root_id（同一应用的所有版本/派生共享）、parent_id（上一版
/派生源）、version。save_app 存原始应用（root=自己·v1）；save_version 存同
一应用的新一版；fork_app 从现有应用分出一条新血缘（新 root·v1·parent 指向源）。
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config.settings import settings

#: ⚠ 2026-08-29：SQL 网关（连接参数 / HttpSqlGateway / 错误形状）抽到了
#:   services/sql_gateway。原因是 identity_store 与 session_blob_store 也要用它们，
#:   于是身份与会话都反过来依赖应用商店——组级两个环。这几样是数据库基础设施，
#:   不是应用商店的业务。同名转出保留：app_store 自己 200 多处调用、以及仓里
#:   按 `from .app_store import HttpSqlGateway` 写的脚本与判据照常有效。
from services.sql_gateway import (  # noqa: F401
    _PREFER_HTTP_ENV,
    _http_api_target_key,
    neon_http_endpoint,
    prefer_neon_http,
    _DOLLAR_TAG_RE,
    _NUMERIC_PLACEHOLDER_RE,
    _NEON_ERROR_FIELDS,
    _scan_numeric_placeholders,
    HttpSqlGateway,
    NeonHttpError,
    _HTTP_API_MAX_ROWS,
    _NEON_HTTP_TIMEOUT_S,
    _PG_IDLE_TX_TIMEOUT_MS,
    _PG_LOCK_TIMEOUT_MS,
    _PG_STATEMENT_TIMEOUT_MS,
    _gateway_http_error,
    _http_gateway_error,
    _neon_http_error,
    _sql_engine_config,
    configure_sqlite_journal,
    http_api_credentials,
    http_api_query_endpoint,
    numeric_to_format,
)




# ── Postgres 服务端超时与初始化预算（2026-08-02 线上事故修复）───────────
#
# 事故：切回 Neon 后 Python 单 worker 被堵死，/api/health 一起超时。这一组值
# 是为了让"卡住"变成"抛异常"——下面那套四级 fail-open 全靠 except 触发，而一条
# 永远不返回的查询什么都不抛，于是一级都不会降。


#: 整个远端后端初始化的墙钟预算，超了就当这一级不可用、降到下一级。
#:
#: **这是最后一道防线，也是唯一不依赖库配合的一道**：上面三个超时要连上库、
#: 且服务端认 options 才生效；连接串自带 options（Neon 用它做端点路由）时它们
#: 压根不会被设上。而初始化本身可能在任何一步慢下来——多地址逐个重试、pooler
#: 冷启动、驱动类型初始化。这条是纯墙钟，谁都拦得住。
#:
#: 12s 的来历：连接握手上限 4s，初始化里最多两次连接（见 _sqlalchemy_backend
#: 已经合并成一次），留一倍余量给建表与补列。
_SQL_INIT_BUDGET_S = 12.0


# ────────────────────────── 缩略图来源 ──────────────────────────
#
# 优先级链，靠前的更可信（完整说明见 AppStoreBackend 的缩略图小节）：
#   shot  —— 真实渲染的截图，就是这个应用本身
#   sheet —— 生成时那张首页参照板，是"应该长这样"的示意
# 都没有 → **应用中心画空态**（antd Empty「暂无预览图」）。
# ⚠ 2026-08-22 前这里写的是"回落活渲染"，那一档已经删了：卡片不再挂真运行时
#   （同屏十几张把主线程堵四秒）。侧栏会话封面**仍有**活渲染那一档，两处不是
#   同一条链，改这里之前先看 client 的 session-thumb.tsx。
PREVIEW_SOURCE_SHOT = "shot"
PREVIEW_SOURCE_SHEET = "sheet"

#: 读取顺序。get_preview(source=None) 与 preview_sources() 都按这个序走，
#: 两处共用同一份定义——分开写就会出现"列表说有 shot、取图却给了 sheet"。
PREVIEW_SOURCE_PRIORITY: tuple[str, ...] = (PREVIEW_SOURCE_SHOT, PREVIEW_SOURCE_SHEET)


def normalize_preview_source(source: Optional[str]) -> str:
    """把外部传进来的来源名归一到已知值；不认识的一律当 sheet。

    宽进严出：这个值会进 SQL 列名选择与文件名，认不出来的值必须落到一个确定
    的槽里，不能让它自己开一个新槽。"""
    key = (source or "").strip().lower()
    return key if key in PREVIEW_SOURCE_PRIORITY else PREVIEW_SOURCE_SHEET


#: 时刻位的分辨率（每秒多少格）。微秒。
#:
#: 不是随手取的最大值，是被一次实测逼出来的：先写的秒级，再改毫秒级，两版都
#: 会让 test_preview_tag_changes_when_the_same_source_is_rewritten 在 JSON
#: 后端上间歇性变红——那个后端的时刻位取自文件 mtime，而背靠背两次 os.replace
#: 落在同一毫秒内是常事。微秒级下两次写之间隔着好几个系统调用，撞不上。
#:
#: 生产上这两次写隔着几十秒，秒级也够用；但一个"只在生产够用、在测试里必然
#: 撞车"的分辨率等于把 flaky 写进了实现。
_PREVIEW_TAG_TICKS_PER_SEC = 1_000_000


def preview_tag(source: str, written_at: Any) -> str:
    """拼缓存标签：`"{来源}.{写入时刻微秒}"`（理由见 preview_sources 的说明）。

    written_at 接受 datetime / epoch 秒 / ISO 字符串 / None——三个后端存的形态
    不一样，解析不出来就退成 0，标签仍然随来源变，只是丢掉"同来源换图"那一档
    灵敏度。
    """
    src = normalize_preview_source(source)
    seconds: Optional[float] = None
    if isinstance(written_at, datetime):
        seconds = written_at.timestamp()
    elif isinstance(written_at, (int, float)):
        seconds = float(written_at)
    elif isinstance(written_at, str) and written_at:
        try:
            seconds = datetime.fromisoformat(written_at.replace("Z", "+00:00")).timestamp()
        except ValueError:
            seconds = None
    stamp = round(seconds * _PREVIEW_TAG_TICKS_PER_SEC) if seconds is not None else 0
    return f"{src}.{max(0, stamp)}"


def preview_source_of(tag: Optional[str]) -> str:
    """从缓存标签里取回来源名。标签为空/形状不对时按 sheet 处理。"""
    return normalize_preview_source((tag or "").split(".", 1)[0])


# ────────────────────────── 记录形状 / 元数据派生 ──────────────────────────

def _new_id() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _int_or_none(value: Any) -> Optional[int]:
    """能转成整数就转，`None` 保持 `None`。⚠ 不许用 `int(x or 0)` 顶替——
    那会把「不知道」写成「0 个」，而这两件事在卡片上是不同的话。"""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _count_or_none(section: Any, key: str) -> Optional[int]:
    """数 `section[key]` 这个数组有多长；这一段缺席或形状不对返回 ``None``。

    ⚠ 缺席返回 ``None`` 而不是 ``0``——见 derive_app_metadata 里那段说明。
    ⚠ 坏形状（不是 dict、值不是 list）一律 ``None``：宁可少认，不可认错。
    """
    if not isinstance(section, dict):
        return None
    items = section.get(key)
    if not isinstance(items, list):
        return None
    return len(items)


def derive_app_metadata(model: dict[str, Any]) -> dict[str, Any]:
    """从生成模型里抽出可查询的元数据（列表/筛选/血缘展示用），不塞进
    model_json 里，避免列表查询要反序列化整个大模型。"""
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    gen_theme = identity.get("generatedTheme") if isinstance(identity.get("generatedTheme"), dict) else {}
    datamodel = model.get("datamodel") or {}
    pages = ((model.get("page") or {}).get("pages")) or []
    return {
        "product_name": str(identity.get("productName") or "")[:120],
        "theme_id": str(identity.get("theme") or "")[:64],
        "theme_label": str((gen_theme or {}).get("label") or "")[:120],
        "device": str(appbundle.get("preferredDevice") or "")[:16],
        "landing_page_ref": str(appbundle.get("landingPageRef") or "")[:64],
        "entity_count": len(datamodel.get("entities") or []),
        "page_count": len(pages),
        # ⚠ 2026-08-22：卡片徽标要「角色 N · AI N」，而摘要里没有，于是前端
        #   为了这两个数把整包（model_json + pages_json）拉了下来——真机首屏
        #   ×30 共 1931 KB。数在这里一次，列表直接带走。
        #
        # ⚠ `None` 与 `0` 是**两件事**，不许混：
        #     None = 这份模型里没有这一段，**数不出来**（存量记录也是 None）
        #     0    = 有这一段，里面确实一个都没有
        #   前端据此决定「不显示这个徽标」还是「显示 0」。返回 0 顶替 None
        #   等于替模型编了一句「这个应用没有角色」。
        "role_count": _count_or_none(model.get("rbac"), "roles"),
        "ai_count": _count_or_none(model.get("aigc"), "capabilities"),
    }


def _as_official(value: Any) -> bool:
    from .app_access import is_official_app

    return is_official_app({"is_official": value})


def _build_record(
    model: dict[str, Any],
    *,
    goal: str,
    session_id: Optional[str],
    gate_passed: bool,
    app_id: str,
    root_id: str,
    parent_id: Optional[str],
    version: int,
    dedup_key: Optional[str] = None,
    owner_id: Optional[str] = None,
    visibility: Optional[str] = None,
    pages_json: Optional[dict[str, Any]] = None,
    is_official: Optional[bool] = None,
    prior_owner_id: Optional[str] = None,
) -> dict[str, Any]:
    from .app_access import Visibility, normalize_visibility

    meta = derive_app_metadata(model)
    if visibility is None:
        vis = Visibility.PRIVATE
    else:
        vis = normalize_visibility(visibility)
    return {
        "id": app_id,
        "root_id": root_id,
        "parent_id": parent_id,
        "version": version,
        "session_id": (session_id or "")[:64] or None,
        "goal": (goal or "")[:2000],
        "gate_passed": bool(gate_passed),
        "dedup_key": (dedup_key or None),
        "created_at": _now_iso(),
        # 归属与可见性（2026-08-02）。owner_id 为 None = 无主的存量应用，
        # 语义在 app_access 里定义：可读、不可写（超管除外）。
        # ⚠ 2026-08-19：新建默认 private，否则一闭环就出现在应用市场。
        # 没传 visibility（None）才走默认；显式 "" 仍走 normalize（存量）。
        "owner_id": (owner_id or None),
        "visibility": vis,
        "is_official": _as_official(is_official),
        "prior_owner_id": (prior_owner_id or None),
        "model_json": model,
        # spec-first 链路画的整页 HTML（{version, pages, navItems, boundPages,
        # failedPages}，形状与会话侧 state.specFirstPages 同源）。None = 这一版
        # 没有页面（老链路产出）——应用中心对这种记录回落区块渲染，不编造。
        "pages_json": pages_json if isinstance(pages_json, dict) and pages_json.get("pages") else None,
        **meta,
    }


def pages_payload_differs(existing: Any, incoming: Any) -> bool:
    """货架上那一版的页面，和这次要落的页面，是不是不一样。

    ## 为什么落库要看页面，而不是只看模型

    `model_signature` 只签模型。而**局部精修的常态是模型六段一字未变、只有页面
    HTML 变了**（加一列、改个排序——实体角色流程都没动）。签名不变 → dedup 命中
    → 走幂等更新 → 上一版的 `pages_json` **被就地覆盖**，而且不产生新版本：

        · 卡片上的 v{N} 少数一次改版
        · 更要命的是**回不去**——旧页面被原地盖掉，血缘里没有那一版，
          哪儿都没存

    会话那一侧早就是对的：`v5_full_driver.record_model_snapshot` 明写
    「模型没变但页面变了，照常记版本」。这里补的就是让落库跟它一个口径——
    不发明第三套规则，采用仓里已经验证过的那一套。

    上游同款口径：turborepo#4572 那条教训（本仓 record_model_snapshot 引的
    也是它）——**影响输出的输入没进键，就会"改了东西还吃旧结果"**；Bazel /
    Turborepo 的内容寻址缓存把"每一个影响产物的输入"都算进 key，输入变了就是
    另一个条目，天然没有失效逻辑可写错。页面就是这里漏掉的那个输入。

    ## 为什么"没带页面"必须判成没变

    这条路上大部分调用**根本不带页面**（重开夹具、纯模型轮、fork、回落老链路）。
    把"没带"当成"变了"，每一次重存都会凭空长出一版——比原来的覆盖更糟。
    所以：只有**真的带了非空页面**且与货架上那份不同，才算变了。
    """
    if not isinstance(incoming, dict):
        return False
    new_pages = incoming.get("pages")
    if not isinstance(new_pages, dict) or not new_pages:
        return False  # 空页面包不算"页面变了"，别为它开一版
    old = existing.get("pages") if isinstance(existing, dict) else None
    old_pages = old if isinstance(old, dict) else {}
    return new_pages != old_pages


def model_signature(session_id: Optional[str], model: dict[str, Any]) -> str:
    """(会话 + 模型内容) 的稳定签名，用作落库幂等键——同一会话反复落同一个
    模型只更新一条记录，不堆重复；模型真变了（精修改了内容）签名就变、落新记录。"""
    import hashlib

    payload = json.dumps(model, ensure_ascii=False, sort_keys=True).encode("utf-8")
    digest = hashlib.sha1(payload).hexdigest()[:16]
    return f"{(session_id or '-')[:40]}:{digest}"


#: 画廊列表要的列。刻意不含 model_json / pages_json——那两列是 jsonb，
#: spec-first 一份 pages_json 约 100KB+，list 一旦 select * 就会把整表
#: 过网，再在 Python 里切 12 条（2026-08-18 应用中心首屏：响应 8KB，
#: 墙钟 3.5–5s，真机走自定义 HTTPS SQL API）。
_LIST_COLUMNS: tuple[str, ...] = (
    "id", "root_id", "parent_id", "version", "session_id", "goal",
    "product_name", "theme_id", "theme_label", "device", "landing_page_ref",
    "entity_count", "page_count", "role_count", "ai_count",
    "gate_passed", "dedup_key", "created_at",
    "owner_id", "visibility", "is_official", "prior_owner_id",
)


def _shelf_outer_sql(shelf: Optional[str]) -> str:
    """列表货架谓词，接在 `where rn = 1` 后面。mine 用 `$3` = owner_id。"""
    if not shelf:
        return ""
    if shelf == "mine":
        return " and owner_id = $3"
    if shelf == "official":
        return " and coalesce(is_official, 0) <> 0"
    if shelf == "market":
        return (
            " and coalesce(visibility, 'public') = 'public'"
            " and coalesce(is_official, 0) = 0"
        )
    return ""


def list_apps_sql(*, latest_per_root: bool = True, shelf: Optional[str] = None) -> str:
    """画廊列表 SQL。``$1`` = limit，``$2`` = offset。

    同 root 内以 version 为准挑最新（created_at 在 dedup 幂等更新时可能
    保留旧值，单靠时间会把 v1 排到 v2 前面）。    卡片之间再按时间倒序，**并列时用 id 决胜**（OFFSET 翻页否则会漏/重）。

    has_pages 用 ``pages_json is not null``，不 ``->`` 取值：Postgres
    判断 NULL 不拆 TOAST，访问 ``->'pages'`` 会把整份 HTML 解出来。
    空壳 ``{"pages": {}}`` 在落库口已经归一成 NULL（见 save）。

    ⚠ 2026-08-18 真机（应用中心 limit=12）：旧句是
    ``select * from generated_app order by version desc, created_at desc``
    无 LIMIT，整表 jsonb 经 /db-api 过网。响应 8KB，墙钟 3.5–5s。
    测试剥注释后再禁这条原文——本段是锚，删掉剥注释自检会红。
    """
    cols = ", ".join(_LIST_COLUMNS)
    has_pages = "(pages_json is not null) as has_pages"
    shelf_sql = _shelf_outer_sql(shelf)
    if latest_per_root:
        return (
            f"select {cols}, has_pages from ("
            f" select {cols}, {has_pages},"
            f" row_number() over ("
            f" partition by coalesce(root_id, id)"
            f" order by version desc, created_at desc, id desc"
            f" ) as rn"
            f" from generated_app"
            f") t where rn = 1{shelf_sql}"
            f" order by created_at desc, id desc"
            f" limit $1 offset $2"
        )
    if shelf_sql:
        return (
            f"select {cols}, {has_pages} from generated_app"
            f" where {shelf_sql[5:]}"
            f" order by version desc, created_at desc, id desc"
            f" limit $1 offset $2"
        )
    return (
        f"select {cols}, {has_pages} from generated_app"
        f" order by version desc, created_at desc, id desc"
        f" limit $1 offset $2"
    )


def _list_summary(row: dict[str, Any], *, has_pages: Optional[bool] = None) -> dict[str, Any]:
    """把一行（可能已经没有 jsonb 列）收成列表摘要。

    不能走 ``_neon_normalize_row``：那条会把缺席的 pages_json 补成
    None，再交给 ``_summary`` 就会把 SQL 算好的 has_pages 抹成 False。
    """
    out = {k: row.get(k) for k in _LIST_COLUMNS}
    ts = out.get("created_at")
    if isinstance(ts, datetime):
        out["created_at"] = ts.isoformat()
    elif isinstance(ts, str) and ts:
        try:
            out["created_at"] = datetime.fromisoformat(ts.replace("Z", "+00:00")).isoformat()
        except ValueError:
            pass
    if has_pages is None:
        pages = row.get("pages_json")
        has_pages = bool(isinstance(pages, dict) and pages.get("pages"))
    out["has_pages"] = bool(has_pages)
    out["is_official"] = _as_official(out.get("is_official"))
    return out


def _list_tiebreak(row: dict[str, Any]) -> tuple[str, str]:
    """created_at 相同时用 id 决胜，否则 OFFSET 翻页会漏一行/重一行。

    Postgres 对并列键的顺序**跨查询不稳定**（open-msupply #12291 同一条）。
    首页真机 12→24→35→48：第三页和前两页叠了一条，唯一卡变成 35，
    前端再 concat 第四页就到 48。JSON 后端必须跟 SQL ``id desc`` 同一把尺子。
    """
    return (str(row.get("created_at") or ""), str(row.get("id") or ""))


def _paginate_latest(
    rows: list[dict[str, Any]], *, limit: int, offset: int, latest_per_root: bool
) -> list[dict[str, Any]]:
    """JSON 文件后端用：已经 slim 过的行在内存里做与 SQL 相同的排序/去重/切片。"""
    rows = sorted(
        rows,
        key=lambda r: (r.get("version") or 0, *_list_tiebreak(r)),
        reverse=True,
    )
    if latest_per_root:
        seen: set[str] = set()
        latest: list[dict[str, Any]] = []
        for r in rows:
            root = r.get("root_id") or r.get("id")
            if root in seen:
                continue
            seen.add(root)
            latest.append(r)
        rows = sorted(latest, key=_list_tiebreak, reverse=True)
    return rows[offset:offset + limit]


def _summary(record: dict[str, Any]) -> dict[str, Any]:
    """列表用摘要——去掉 model_json / pages_json 两个大载荷（后者是整套页面
    HTML，一份约 100KB+），只留可查询/展示字段 + has_pages 一位布尔：前端靠它
    决定这张卡走 HTML 活渲染还是老的区块渲染，不用为了判定去拉完整记录。"""
    out = {k: v for k, v in record.items() if k not in ("model_json", "pages_json")}
    pages = record.get("pages_json")
    out["has_pages"] = bool(isinstance(pages, dict) and pages.get("pages"))
    out["is_official"] = _as_official(out.get("is_official"))
    return out


# ────────────────────────── 后端接口 ──────────────────────────

class AppStoreBackend:
    def save(self, record: dict[str, Any]) -> str:  # pragma: no cover - interface
        raise NotImplementedError

    def get(self, app_id: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def list(
        self,
        *,
        limit: int,
        offset: int,
        latest_per_root: bool,
        shelf: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def versions(self, root_id: str) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def delete(self, app_id: str) -> bool:  # pragma: no cover
        raise NotImplementedError

    def ids_for_root(self, root_id: str) -> list[str]:
        """同一血缘上所有版本的 id。画廊删卡要一次清干净，不能只 select *。"""
        return [str(v.get("id")) for v in self.versions(root_id) if v.get("id")]

    def max_version(self, root_id: str) -> int:
        """这条血缘当前最大的 version；一版都没有回 0。

        ⚠ 存在的理由是**迭代热路上不要拖整条血缘过网**（2026-08-22）。
        `save_version` 只需要一个数（下一版是几），此前却是
        `versions(root_id)` 再 `max(...)`——而 Neon 那边 versions 是
        `select *`，把每一版的 model_json + pages_json 全拉回来。
        实测线上 5 版的血缘：整条 280 KB / 742ms，只取 max(version) 136ms。
        代价随版本数线性长，删卡那条路已经因为同一句 413 过一次
        （2026-08-21 修的是 ids_for_root，没动 versions 本身）。
        撞上 413 的现象是：用户精修完，落库那步 fail-open 被吞掉，
        **应用没存**，只有日志里有一行 "app store save skipped"。

        默认实现仍走 versions()——JSON / SQLite 后端本来就在内存或本地库里，
        没有过网这回事；真正需要覆盖的是走网关的那个后端。
        """
        rows = self.versions(root_id)
        return max((int(v.get("version") or 0) for v in rows), default=0)

    def export_all(self) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    # ── 缩略图 ──────────────────────────────────────────────
    #
    # 为什么单独一张表 / 一份存储，而不是 generated_app 上加一列：
    #   那张 base64 约 1MB。加成一列的话，现有每一条 `select *`（list、get、
    #   find_by_dedup_key、find_latest_by_session、versions、export_all）都会
    #   顺手把它拖出来——应用中心一次列 200 个应用就是 200MB 过网，正好跟这
    #   件事要解决的问题相反。单独存就不存在"哪天谁加了个查询忘了排除它"。
    #
    # 三个方法都是**可选能力**：默认实现是"没有缩略图"，后端不实现也不会崩，
    # 只是应用中心的卡片一律画空态。
    #
    # ## 两个来源，一条优先级链（2026-08-02）
    #
    # 一个应用最多挂两张图，按可信度排：
    #
    #   "shot"  —— 应用真实渲染出来之后截的图。**这就是应用本身**，不是示意；
    #              排第一。由前端在推演收口那次渲染上采集后回传（见
    #              client/src/pages/sliderule/studio-landing-shot.tsx、
    #              client/src/lib/thumb-capture.ts 与 POST /apps/{id}/preview）。
    #   "sheet" —— 生成时给设计 LLM 排版式用的那张首页参照板。是"应该长这样"
    #              的示意图，跟最终渲染可能有出入；排第二，但落库即有。
    #
    # 两个都没有 → 应用中心画空态（antd Empty），侧栏会话封面才回落活渲染。
    #
    # ⚠ 2026-08-23 修注释：上面这段原本写的是"落库那一刻还没有，等到有人第一次
    #   看见这张卡才产生"——那说的是**卡片众包补图**（谁逛市场谁的浏览器顺手采
    #   一张），2026-08-22 连同卡片活渲染一起删了。现在 shot 只在推演收口产生
    #   一次；不经过收口的 fork / 精修拿不到，只能靠 _attach_preview 继承。
    #   照着旧描述排查会得出"再逛一圈市场图就补上了"的错误结论。
    #
    # 两张图**并存**而不是后者覆盖前者：两条产图路径的可用性不一样（收口采集要
    # 浏览器真渲染一遍，参照板要生图三件套齐全），任何一条断了都得有东西可退。
    # ⚠ 实测提醒：线上从没配过生图三件套，2026-08-23 查库 64 个应用 sheet 数为
    #   0——**这条"可退"目前只是设计上的，实际全站只有 shot 一路**。
    #
    # 存储形态选的是「一行两列」，不是「(app_id, source) 复合主键两行」：
    # generated_app_preview 在生产 Neon 里已经有数据，改主键要迁移；加一列是
    # `add column if not exists`，三个后端都能就地升级。代价是将来加第四个来源
    # 要再加一列——而这条链是明确的三级，不打算长。

    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:  # pragma: no cover
        return None

    def get_preview(
        self, app_id: str, *, source: Optional[str] = None
    ) -> Optional[str]:  # pragma: no cover
        """取图。source=None 表示"按优先级取最好的那张"（shot 优先）；
        指名 source 时只取那一张，取不到返回 None（继承逻辑要按来源分别复制）。"""
        return None

    def preview_sources(self) -> dict[str, str]:  # pragma: no cover
        """app_id → 缓存标签，形如 `"shot.1754140000123456"`（来源 + 写入时刻）。

        列表接口靠它给每条摘要打 has_preview / preview_source / preview_tag。
        只取 id、来源与时刻，**不取图**：几千个 36 字符的 id 也就百来 KB，
        而对应的图是几个 GB。

        ## 为什么标签里要带时刻，只带来源不够

        缩略图响应是 `immutable` 强缓存（一条 generated_app 记录不可变，这是
        上一轮改动的性能收益所在）。前端把这个标签拼进 URL 的 `?v=`，图一变
        URL 就变，强缓存才成立。而"图变了"有两种，只认来源会漏掉第二种：

          ① sheet → shot：采集把更可信的那张补上了，来源变了；
          ② shot → shot：新版本先继承了上一版的截图，随后自己的采集到了。
             **来源一个字没变，字节全变了。**

        时刻位把 ② 也盖住了：save_preview 每次都刷 created_at。
        """
        return {}

    def session_app_index(self) -> dict[str, dict[str, Any]]:  # pragma: no cover
        """session_id → 该会话**最新**那版应用的 {app_id, version, device}。

        跟 preview_sources 同一个形状与同一个理由：一次全表索引查询，只取几个
        小列，跟列表长度无关。两者合起来才够回答"这个会话的卡该贴哪张图"。

        ## 为什么需要它（2026-08-24）

        应用中心把「全部会话」和「**一页**应用」合并去重（mergeGalleryItems 按
        session_id 认领）。会话列表是一次拉全的 65 条，应用却是 limit=14 的一页
        ——于是 51 个会话认不到自己的应用，各自摆一张**没有封面**的卡，滚到下
        一页才被真应用卡换掉。真机现象：66 张卡只有 14 张有图，其余全是空占位，
        而库里 68 个应用有 67 张图。

        补上这个索引，会话摘要就能自带 appId + 缩略图三件套，卡片不必等应用那
        一页到货。

        ⚠ 只取 id/version/device 这几个小列，**不取 jsonb**。这张表的
          model_json / pages_json 单行就能到 MB 级，`select *` 过网是本仓
          栽过的老坑（见 list_apps_sql 里 2026-08-18 那段）。

        默认返回空 = 老后端不提供，调用方按「会话没有绑定应用」处理（fail-open：
        缩略图是增强项，不能因为它拿不到就让侧栏和应用中心列不出会话）。
        """
        return {}


# ────────────────────────── JSON 文件后端（兜底）──────────────────────────

class JsonFileAppStore(AppStoreBackend):
    """无 DB 时的兜底：一个 JSON 文件存全部记录（list of record dict）。
    线程锁 + 临时文件原子写，跟 persistence.py 同套纪律。离线可用。"""

    def __init__(self, store_file: Optional[str] = None) -> None:
        self._path = Path(store_file or settings.APP_STORE_FILE)
        self._lock = threading.RLock()

    def _read(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return []
        return data if isinstance(data, list) else []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    def save(self, record: dict[str, Any]) -> str:
        with self._lock:
            rows = self._read()
            rows = [r for r in rows if r.get("id") != record["id"]]  # upsert by id
            rows.append(record)
            self._write(rows)
        return record["id"]

    def get(self, app_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            for r in self._read():
                if r.get("id") == app_id:
                    return r
        return None

    def list(
        self,
        *,
        limit: int,
        offset: int,
        latest_per_root: bool,
        shelf: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._read()
        # 文件后端避不开整文件 parse；立刻 slim 掉两份 jsonb，排序/去重
        # 不再拖着每份 100KB+ 的 HTML。分页语义与 list_apps_sql 对齐。
        from types import SimpleNamespace
        from .app_access import matches_shelf

        summaries = [_summary(r) for r in rows]
        if shelf:
            if shelf == "mine" and not owner_id:
                return []
            viewer = SimpleNamespace(id=owner_id, is_superuser=False, is_active=True) if owner_id else None
            summaries = [r for r in summaries if matches_shelf(r, shelf, viewer)]
        return _paginate_latest(
            summaries,
            limit=limit,
            offset=offset,
            latest_per_root=latest_per_root,
        )

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            rows = [r for r in self._read() if r.get("session_id") == session_id]
        if not rows:
            return None
        rows.sort(key=lambda r: (r.get("version") or 0, r.get("created_at") or ""), reverse=True)
        return rows[0]

    def session_app_index(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            rows = self._read()
        best: dict[str, dict[str, Any]] = {}
        for r in rows:
            sid = str(r.get("session_id") or "")
            if not sid:
                continue
            key = (int(r.get("version") or 0), str(r.get("created_at") or ""))
            prev = best.get(sid)
            # 同一会话可能有多版；挑最新那版，口径与 find_latest_by_session 一致
            # （version 优先、created_at 决胜）——两处漂移的现象是列表里的封面
            # 跟点进去看到的版本对不上。
            if prev is None or key > prev["_key"]:
                best[sid] = {
                    "_key": key,
                    "app_id": str(r.get("id") or ""),
                    "version": int(r.get("version") or 1),
                    "device": str(r.get("device") or ""),
                }
        for v in best.values():
            v.pop("_key", None)
        return best

    def versions(self, root_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._read()
        chain = [r for r in rows if (r.get("root_id") or r.get("id")) == root_id]
        chain.sort(key=lambda r: r.get("version") or 0)
        return [_summary(r) for r in chain]

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
        with self._lock:
            for r in self._read():
                if r.get("dedup_key") == dedup_key:
                    return r
        return None

    def ids_for_root(self, root_id: str) -> list[str]:
        with self._lock:
            rows = self._read()
        rid = str(root_id or "")
        return [
            str(r["id"])
            for r in rows
            if r.get("id") and (str(r.get("id")) == rid or str(r.get("root_id") or r.get("id")) == rid)
        ]

    def delete(self, app_id: str) -> bool:
        with self._lock:
            rows = self._read()
            remaining = [r for r in rows if r.get("id") != app_id]
            if len(remaining) == len(rows):
                return False
            self._write(remaining)
            # 两个来源各是一个文件，都要清——只清 sheet 会留下孤儿截图，
            # 而 preview_sources 是按目录 glob 的，那张孤儿图会让已删除的应用
            # 在列表里继续显示 has_preview。
            for src in PREVIEW_SOURCE_PRIORITY:
                self._preview_path(app_id, src).unlink(missing_ok=True)
        return True

    def export_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()

    # ── 缩略图：一个应用一个 .png 文件 ─────────────────────
    #
    # 不塞进上面那份 JSON：那个文件每次 save 都整份读进来、整份写回去，
    # 混进几十 MB 的 base64 之后每存一个应用都要重写全部图片。一图一文件的
    # 写入代价跟应用数量无关。存 PNG 原始字节而不是 base64，省掉 33% 体积，
    # 顺便还能直接用图片查看器打开排查。
    def _preview_dir(self) -> Path:
        return self._path.parent / (self._path.stem + "-previews")

    def _preview_path(self, app_id: str, source: str = PREVIEW_SOURCE_SHEET) -> Path:
        # app id 是 uuid4().hex，不含路径分隔符；仍然过一道白名单，避免将来
        # 有人换了 id 生成方式就把这里变成路径穿越。
        safe = "".join(c for c in str(app_id) if c.isalnum() or c in "-_")[:64]
        # sheet 保持 `{id}.png` 这个老文件名——已经落盘的图不用搬家；shot 另起
        # `{id}.shot.png`。两者同目录，preview_sources 一次 glob 就能分辨。
        suffix = "" if source == PREVIEW_SOURCE_SHEET else f".{source}"
        return self._preview_dir() / f"{safe or 'unknown'}{suffix}.png"

    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:
        raw = base64.b64decode(png_b64)
        src = normalize_preview_source(source)
        with self._lock:
            path = self._preview_path(app_id, src)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".png.tmp")
            tmp.write_bytes(raw)
            os.replace(tmp, path)

    def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
        wanted = (
            [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
        )
        for src in wanted:
            try:
                return base64.b64encode(
                    self._preview_path(app_id, src).read_bytes()
                ).decode("ascii")
            except OSError:
                continue
        return None

    def preview_sources(self) -> dict[str, str]:
        try:
            paths = list(self._preview_dir().glob("*.png"))
        except OSError:
            return {}
        # app_id → (来源, 该文件 mtime)。文件后端没有 created_at 列，用 mtime
        # 当写入时刻——save_preview 是 os.replace 落盘，mtime 就是那一刻。
        best: dict[str, tuple[str, float]] = {}
        for path in paths:
            stem = path.name[: -len(".png")]
            # `{id}.shot` → shot；`{id}` → sheet。id 本身不含 "."（白名单只留
            # 字母数字与 -_），所以这个切分是无歧义的。
            app_id, _, suffix = stem.partition(".")
            src = normalize_preview_source(suffix) if suffix else PREVIEW_SOURCE_SHEET
            # 未知后缀会被归一成 sheet，可能顶掉真的 sheet；只认恰好等于
            # 已知来源名的后缀，其余文件（.tmp 残留之类）忽略。
            if suffix and suffix != src:
                continue
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0.0
            prev = best.get(app_id)
            if prev is None or PREVIEW_SOURCE_PRIORITY.index(src) < PREVIEW_SOURCE_PRIORITY.index(prev[0]):
                best[app_id] = (src, mtime)
        return {app_id: preview_tag(src, ts) for app_id, (src, ts) in best.items()}


# ────────────────────────── SQLAlchemy 后端（Postgres / SQLite）──────────────



def _sqlalchemy_backend_within_budget(database_url: str) -> AppStoreBackend:
    """给远端后端的初始化套一个墙钟预算（2026-08-02 线上事故修复）。

    ## 为什么需要它

    事故形状：切回 Neon 后 Python 单 worker 被堵死，`/api/health` 一起超时。
    `get_backend` 那套四级 fail-open 全靠 `except` 触发，而**卡住不抛异常**，
    于是一级都不会降——存储层最终还是把主链路吊死了，正是它承诺绝不做的事。

    服务端超时（statement/lock/idle_in_transaction）能兜住大部分，但它们有个
    前提：得先连上库、且服务端认 options。连接串自带 options 时（Neon 用它做
    端点路由，不能覆盖）它们压根设不上；初始化也可能慢在连接之前——多地址逐个
    重试、pooler 冷启动、驱动类型初始化。这条是纯墙钟，不依赖库配合。

    ## 为什么是"丢弃"而不是"杀掉"

    Python 杀不掉一个正在阻塞的线程。所以超预算时不去杀它，而是**放弃等待、
    把结果丢掉**，主流程照常降级到下一级存储。被丢下的那个线程自己会结束
    （每次连接握手有 connect_timeout=4 封顶，工作量是有界的），它只是白干一场。

    这样做是安全的，因为 `_sqlalchemy_backend` 是**纯工厂**：只返回值、不写
    任何模块级状态。晚到的结果没有任何地方可以污染。

    ## 必须是 daemon 线程，不能用 ThreadPoolExecutor

    第一版用的是 ThreadPoolExecutor + future.result(timeout=…)，**写完就被自己
    的测试抓了**：它的工作线程是非守护线程，而 concurrent.futures 注册了一个
    atexit 钩子去 join 它们。于是卡住的初始化线程会挡住**进程退出**——等于把
    "启动卡死"换成了"关停卡死"，部署时更难受（容器停不下来）。

    daemon 线程没有这个问题：解释器退出时直接丢下它，不 join。
    """
    import threading as _threading

    box: dict[str, Any] = {}

    def _run() -> None:
        try:
            box["value"] = _sqlalchemy_backend(database_url)
        except BaseException as exc:  # noqa: BLE001 — 原样带回主线程再抛
            box["error"] = exc

    worker = _threading.Thread(target=_run, name="appstore-init", daemon=True)
    worker.start()
    worker.join(_SQL_INIT_BUDGET_S)
    if worker.is_alive():
        raise TimeoutError(
            f"远端后端初始化超过 {_SQL_INIT_BUDGET_S:g}s 预算，按不可用处理"
        )
    if "error" in box:
        raise box["error"]
    return box["value"]


def _sqlalchemy_backend(database_url: str) -> AppStoreBackend:
    """延迟导入 SQLAlchemy——只在真配了连接串时才 import，没配就完全不碰
    这条依赖（保持"无 DB 也能启动"）。"""
    from sqlalchemy import (
        Boolean, Column, DateTime, Integer, String, Text, and_, create_engine, func, select, JSON,
    )
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.orm import Session, declarative_base
    from sqlalchemy.pool import NullPool

    # 生产 Neon/自建 PG 给的是 postgresql://…，SQLAlchemy + psycopg v3 需要
    # postgresql+psycopg:// 前缀；sqlite://… 原样。只补驱动前缀，不动别的。
    url = re.sub(r"^postgresql://", "postgresql+psycopg://", database_url)
    # 可移植 JSON：Postgres 落 JSONB（可 GIN 索引，组建库拆件用得上），
    # SQLite 落 JSON（本地/测试同一份代码）。
    json_type = JSON().with_variant(JSONB, "postgresql")

    # 用经典 Column 声明风格（不是 2.0 的 Mapped[] 注解）——ORM 模型定义在
    # 函数内（惰性 import：没配 DB 就完全不碰 SQLAlchemy），而 Mapped[] 注解
    # 解析要求类型名在模块级可见，函数内定义会解析失败。Column 风格不走注解
    # 解析，功能完全等价。
    Base = declarative_base()

    class GeneratedApp(Base):
        __tablename__ = "generated_app"
        id = Column(String(36), primary_key=True)
        root_id = Column(String(36), index=True)
        parent_id = Column(String(36), nullable=True)
        version = Column(Integer, default=1)
        session_id = Column(String(64), nullable=True)
        goal = Column(Text, default="")
        product_name = Column(String(120), default="", index=True)
        theme_id = Column(String(64), default="")
        theme_label = Column(String(120), default="")
        device = Column(String(16), default="")
        landing_page_ref = Column(String(64), default="")
        entity_count = Column(Integer, default=0)
        page_count = Column(Integer, default=0)
        # ⚠ 卡片徽标用（2026-08-22）。**nullable，不给 default**：存量记录读出来
        #   必须是 None（=数不出来，前端不显示这个徽标），不是 0（=确实没有角色）。
        #   给了 default=0 就等于替所有老应用编了一句「它没有角色」。
        role_count = Column(Integer, nullable=True)
        ai_count = Column(Integer, nullable=True)
        gate_passed = Column(Boolean, default=False)
        dedup_key = Column(String(80), nullable=True, index=True)
        created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
        # 归属与可见性（2026-08-02）。老库靠 _init 里的 add-column 就地补，
        # create_all 对已存在的表不会加新列。
        owner_id = Column(String(64), nullable=True, index=True)
        visibility = Column(String(16), default="public", index=True)
        is_official = Column(Integer, default=0, index=True)
        prior_owner_id = Column(String(64), nullable=True)
        model_json = Column(json_type)
        # spec-first 整页 HTML（2026-08-14）。老库靠 _init 里的 add-column
        # 就地补；补不上读到 None，等同"这一版没有页面"，前端回落区块渲染。
        pages_json = Column(json_type, nullable=True)

        def to_record(self) -> dict[str, Any]:
            return {
                "id": self.id, "root_id": self.root_id, "parent_id": self.parent_id,
                "version": self.version, "session_id": self.session_id, "goal": self.goal,
                "product_name": self.product_name, "theme_id": self.theme_id,
                "theme_label": self.theme_label, "device": self.device,
                "landing_page_ref": self.landing_page_ref, "entity_count": self.entity_count,
                "page_count": self.page_count,
                "role_count": self.role_count, "ai_count": self.ai_count,
                "gate_passed": self.gate_passed,
                "dedup_key": self.dedup_key,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "owner_id": self.owner_id,
                "visibility": self.visibility or "public",
                "is_official": _as_official(self.is_official),
                "prior_owner_id": self.prior_owner_id,
                "model_json": self.model_json,
                "pages_json": self.pages_json if isinstance(self.pages_json, dict) else None,
            }

    class GeneratedAppPreview(Base):
        """应用中心的卡片缩略图（生成时那张首页参照板）。

        单独一张表的理由见 AppStoreBackend.save_preview 上方那段：约 1MB 的
        base64 挂在 generated_app 上，会被现有每一条 `select *` 顺手拖出来。
        独立表 + 独立查询 = 只有真要图的那一次请求才付这个代价。

        app_id 不设外键：generated_app 是三个后端共建的表（JSON/SQLAlchemy/
        Neon HTTP 各建各的，都是 IF NOT EXISTS），加外键等于要求建表顺序，
        而 Neon HTTP 那份不参与 SQLAlchemy 的 metadata。孤儿行由 delete_app
        显式清理，代价是一张图，不值得为它引入建表顺序依赖。
        """

        __tablename__ = "generated_app_preview"
        app_id = Column(String(36), primary_key=True)
        #: sheet 来源（生成时那张首页参照板）。列名保持不变——生产 Neon 里
        #: 已经有数据，改名就是一次数据迁移。
        png_b64 = Column(Text, default="")
        #: shot 来源（真实渲染的截图）。新增列，老库靠下面的就地 ALTER
        #: 就地补上；补不上时读到的就是 None，等同"没有这张图"。
        shot_png_b64 = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # 连接超时收短 + 先做一次 2s TCP 探针：DB 不可达（网络封端口/连接串错/
    # 服务挂了）时快速失败 → get_backend 捕获后 fail-open 回退 JSON 文件，绝不
    # 让存储层把主链路吊死（真实撞到：沙盒封了 5432；且 Neon pooler 解析成多个
    # IP，psycopg 会逐个重试，不先探针的话超时叠加到十几秒）。sqlite 跳过探针。
    connect_args, engine_kwargs = _sql_engine_config(url, NullPool)
    if url.startswith("postgresql"):
        from sqlalchemy.engine.url import make_url

        parsed = make_url(url)
        if parsed.host:
            import socket

            # 连不上快速失败：只解析 + 试连第一个 IPv4 地址、硬超时 2s——不用
            # create_connection 的多地址轮询（Neon pooler 解析出多个 IP + IPv6，
            # 逐个 2s 会叠成十几秒；沙盒还不支持 IPv6 family）。探针只验端口可达，
            # 真正握手交给 SQLAlchemy。失败 → get_backend 捕获后 fail-open 回退
            # JSON 文件，绝不让存储层把主链路吊死。sqlite 跳过探针。
            infos = socket.getaddrinfo(parsed.host, parsed.port or 5432, socket.AF_INET, socket.SOCK_STREAM)
            if not infos:
                raise OSError(f"no IPv4 address for {parsed.host}")
            fam, typ, proto, _canon, sa = infos[0]
            probe = socket.socket(fam, typ, proto)
            probe.settimeout(2)
            try:
                probe.connect(sa)
            finally:
                probe.close()
    engine = create_engine(url, connect_args=connect_args, **engine_kwargs)
    configure_sqlite_journal(engine)
    # 建表 + 补列**共用一条连接**（2026-08-02 事故修复）。
    #
    # 原来是 create_all(engine) 一条、inspect(engine) 又一条、ALTER 再一条——
    # NullPool 下每次都是**新建连接**。平时无所谓（几十毫秒），但线上撞到的正是
    # "每次连接都慢"：Neon pooler 解析出多个地址、psycopg 逐个试、每个
    # connect_timeout=4s。连接次数在这条路径上是直接乘上去的成本。
    #
    # 合并之后整个初始化只握手一次。
    with engine.begin() as _init_conn:
        Base.metadata.create_all(_init_conn)

    # create_all **只建不改**：表已经存在时它一列都不会补。generated_app_preview
    # 在生产 Neon 与本地 SQLite 里都早有数据，shot_png_b64 这个新列必须自己
    # ALTER 上去，否则所有读写都会撞 UndefinedColumn。
    #
    # 就地补列而不是引 alembic：整个仓库没有迁移框架，为一列引一套版本表 +
    # 迁移目录，运维面比这几行大得多。
    #
    # **先 inspect 再 ALTER，不用 `add column if not exists`**：那个写法只有
    # Postgres 认，SQLite 压根没有这个语法（不是版本问题，是根本不支持），
    # 直接抛 syntax error。inspector 两个后端都认，也顺带避免了"新建的表已经
    # 带这一列"时那句多余的 ALTER。
    #
    # fail-open：补不上就当没有这个来源——读到 None、等同没图，回落 sheet。
    #
    # 跑在上面那条 _init_conn 里，不再另开连接（理由见 create_all 那段）。
    # 等锁上限由 lock_timeout 兜（见 _PG_LOCK_TIMEOUT_MS）：ALTER 要
    # ACCESS EXCLUSIVE，撞上任何一个正在读这张表的连接就会无限等——那正是
    # 把单 worker 堵死的形状。等不到就抛、被这里吞掉，下次启动再补。
        try:
            from sqlalchemy import inspect as _sql_inspect, text as _sql_text

            _cols = {
                c["name"]
                for c in _sql_inspect(_init_conn).get_columns("generated_app_preview")
            }
            if "shot_png_b64" not in _cols:
                _init_conn.execute(
                    _sql_text("alter table generated_app_preview add column shot_png_b64 text")
                )
                print("[app_store] generated_app_preview 补上 shot_png_b64 列")
            # 归属与可见性（2026-08-02）。同理：create_all 对已存在的表不加新列。
            # 补不上时**整个身份/权限功能不可用**，但不影响现有读写——所以仍然
            # 只打日志、不抛：存储层不拖垮主链路，权限判定那边把缺列当"无主 + public"。
            _app_cols = {
                c["name"] for c in _sql_inspect(_init_conn).get_columns("generated_app")
            }
            # pages_json 的列类型分方言：Postgres 用 jsonb（与 ORM 的 JSONB
            # variant 对齐，存 text 的话 psycopg 按 JSON 绑参会报类型不符）；
            # SQLite 用 text（它本来就不强制类型，SQLAlchemy 的 JSON 类型在
            # Python 层做序列化，落什么亲和类型都读得回来）。
            _pages_ddl = (
                "alter table generated_app add column pages_json jsonb"
                if _init_conn.dialect.name == "postgresql"
                else "alter table generated_app add column pages_json text"
            )
            for _col, _ddl in (
                ("owner_id", "alter table generated_app add column owner_id varchar(64)"),
                (
                    "visibility",
                    "alter table generated_app add column visibility varchar(16) default 'public'",
                ),
                ("is_official", "alter table generated_app add column is_official integer default 0"),
                ("prior_owner_id", "alter table generated_app add column prior_owner_id varchar(64)"),
                ("pages_json", _pages_ddl),
                # 卡片徽标（2026-08-22）。不带 default：存量行保持 NULL =「不知道」。
                ("role_count", "alter table generated_app add column role_count integer"),
                ("ai_count", "alter table generated_app add column ai_count integer"),
            ):
                if _col not in _app_cols:
                    _init_conn.execute(_sql_text(_ddl))
                    print(f"[app_store] generated_app 补上 {_col} 列")
            # 显式授权表（把某个应用的读/写权限给某个用户）
            _init_conn.execute(
                _sql_text(
                    "create table if not exists generated_app_grant ("
                    " app_id varchar(36) not null, user_id varchar(64) not null,"
                    " access integer not null, created_at timestamp,"
                    " primary key (app_id, user_id))"
                )
            )
        except Exception as exc:  # noqa: BLE001 — 补不上就当没有这个来源
            print(f"[app_store] 列补齐失败: {str(exc)[:160]}")

    class SqlAppStore(AppStoreBackend):
        def _row_from_record(self, record: dict[str, Any]) -> "GeneratedApp":
            ca = record.get("created_at")
            created = datetime.fromisoformat(ca) if isinstance(ca, str) else datetime.now(timezone.utc)
            return GeneratedApp(
                id=record["id"], root_id=record["root_id"], parent_id=record.get("parent_id"),
                version=int(record.get("version") or 1), session_id=record.get("session_id"),
                goal=record.get("goal") or "", product_name=record.get("product_name") or "",
                theme_id=record.get("theme_id") or "", theme_label=record.get("theme_label") or "",
                device=record.get("device") or "", landing_page_ref=record.get("landing_page_ref") or "",
                entity_count=int(record.get("entity_count") or 0), page_count=int(record.get("page_count") or 0),
                # None 原样传，落 NULL —— `or 0` 会把「不知道」写成「0 个」。
                role_count=_int_or_none(record.get("role_count")),
                ai_count=_int_or_none(record.get("ai_count")),
                gate_passed=bool(record.get("gate_passed")), created_at=created,
                dedup_key=record.get("dedup_key"),
                owner_id=record.get("owner_id"),
                visibility=record.get("visibility") or "public",
                is_official=1 if _as_official(record.get("is_official")) else 0,
                prior_owner_id=record.get("prior_owner_id"),
                model_json=record.get("model_json") or {},
                pages_json=record.get("pages_json"),
            )

        def save(self, record: dict[str, Any]) -> str:
            with Session(engine) as s:
                existing = s.get(GeneratedApp, record["id"])
                if existing is not None:
                    s.delete(existing)
                    s.flush()
                s.add(self._row_from_record(record))
                s.commit()
            return record["id"]

        def get(self, app_id: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.get(GeneratedApp, app_id)
                return row.to_record() if row else None

        def list(
            self,
            *,
            limit: int,
            offset: int,
            latest_per_root: bool,
            shelf: Optional[str] = None,
            owner_id: Optional[str] = None,
        ) -> list[dict[str, Any]]:
            # 只选摘要列 + has_pages。select(GeneratedApp) 会把 model_json /
            # pages_json 整表物化再 Python 切片——跟 Neon HTTP 那条 select *
            # 是同一个坑，limit=12 救不了。
            cols = [getattr(GeneratedApp, name) for name in _LIST_COLUMNS]
            # Postgres JSONB：Python None 落 SQL NULL，IS NOT NULL 不拆 TOAST。
            # SQLite JSON：SQLAlchemy 把 None dumps 成文本 'null'，IS NOT NULL
            # 恒真——2026-08-18 用 IS NOT NULL 时「没页面」的卡 has_pages 全亮。
            if shelf == "mine" and not owner_id:
                return []
            if engine.dialect.name == "sqlite":
                pages_key = func.json_extract(GeneratedApp.pages_json, "$.pages")
                has_pages_col = and_(
                    pages_key.isnot(None),
                    pages_key.notin_(("{}", "[]")),
                ).label("has_pages")
            else:
                has_pages_col = GeneratedApp.pages_json.isnot(None).label("has_pages")
            if latest_per_root:
                rn = func.row_number().over(
                    partition_by=func.coalesce(GeneratedApp.root_id, GeneratedApp.id),
                    order_by=(GeneratedApp.version.desc(), GeneratedApp.created_at.desc()),
                ).label("rn")
                inner = select(*cols, has_pages_col, rn).subquery()
                stmt = (
                    select(*[inner.c[name] for name in _LIST_COLUMNS], inner.c.has_pages)
                    .where(inner.c.rn == 1)
                )
                if shelf == "mine":
                    stmt = stmt.where(inner.c.owner_id == owner_id)
                elif shelf == "official":
                    stmt = stmt.where(func.coalesce(inner.c.is_official, 0) != 0)
                elif shelf == "market":
                    stmt = stmt.where(func.coalesce(inner.c.visibility, "public") == "public")
                    stmt = stmt.where(func.coalesce(inner.c.is_official, 0) == 0)
                stmt = stmt.order_by(inner.c.created_at.desc()).limit(limit).offset(offset)
            else:
                stmt = select(*cols, has_pages_col)
                if shelf == "mine":
                    stmt = stmt.where(GeneratedApp.owner_id == owner_id)
                elif shelf == "official":
                    stmt = stmt.where(func.coalesce(GeneratedApp.is_official, 0) != 0)
                elif shelf == "market":
                    stmt = stmt.where(func.coalesce(GeneratedApp.visibility, "public") == "public")
                    stmt = stmt.where(func.coalesce(GeneratedApp.is_official, 0) == 0)
                stmt = (
                    stmt.order_by(GeneratedApp.version.desc(), GeneratedApp.created_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            with Session(engine) as s:
                mapped = s.execute(stmt).mappings().all()
            return [
                _list_summary(dict(row), has_pages=row["has_pages"]) for row in mapped
            ]

        def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.scalars(
                    select(GeneratedApp).where(GeneratedApp.session_id == session_id)
                    .order_by(GeneratedApp.version.desc(), GeneratedApp.created_at.desc())
                    .limit(1)
                ).first()
                return row.to_record() if row else None

        def versions(self, root_id: str) -> list[dict[str, Any]]:
            with Session(engine) as s:
                rows = list(s.scalars(
                    select(GeneratedApp).where(GeneratedApp.root_id == root_id).order_by(GeneratedApp.version)
                ))
            return [_summary(r.to_record()) for r in rows]

        def max_version(self, root_id: str) -> int:
            # 跟 Neon 那边同一口径：只要一个数（见基类 max_version 的说明）。
            # 本地库不过网，但整条血缘反序列化成 ORM 对象同样是白干。
            from sqlalchemy import func as _sql_func

            with Session(engine) as s:
                got = s.scalar(
                    select(_sql_func.max(GeneratedApp.version)).where(
                        GeneratedApp.root_id == root_id
                    )
                )
            return int(got or 0)

        def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.scalars(
                    select(GeneratedApp).where(GeneratedApp.dedup_key == dedup_key).limit(1)
                ).first()
                return row.to_record() if row else None

        def ids_for_root(self, root_id: str) -> list[str]:
            rid = str(root_id or "")
            with Session(engine) as s:
                rows = s.execute(
                    select(GeneratedApp.id).where(
                        (GeneratedApp.root_id == rid) | (GeneratedApp.id == rid)
                    )
                ).all()
            return [str(row[0]) for row in rows if row[0]]

        def delete(self, app_id: str) -> bool:
            with Session(engine) as s:
                row = s.get(GeneratedApp, app_id)
                if row is None:
                    return False
                s.delete(row)
                shot = s.get(GeneratedAppPreview, app_id)
                if shot is not None:
                    s.delete(shot)
                s.commit()
            return True

        def export_all(self) -> list[dict[str, Any]]:
            with Session(engine) as s:
                return [r.to_record() for r in s.scalars(select(GeneratedApp))]

        # ── 缩略图 ───────────────────────────────────────
        def save_preview(
            self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
        ) -> None:
            col = (
                "shot_png_b64"
                if normalize_preview_source(source) == PREVIEW_SOURCE_SHOT
                else "png_b64"
            )
            # 原地更新那一列，不再 delete + add 整行：两个来源共用一行，删行
            # 会把另一个来源那张图一起抹掉（回传截图时正好会撞上）。
            with Session(engine) as s:
                row = s.get(GeneratedAppPreview, app_id)
                if row is None:
                    row = GeneratedAppPreview(app_id=app_id)
                    s.add(row)
                setattr(row, col, png_b64)
                row.created_at = datetime.now(timezone.utc)
                s.commit()

        def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
            with Session(engine) as s:
                row = s.get(GeneratedAppPreview, app_id)
            if row is None:
                return None
            wanted = (
                [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
            )
            for src in wanted:
                val = row.shot_png_b64 if src == PREVIEW_SOURCE_SHOT else row.png_b64
                if val:
                    return val
            return None

        def session_app_index(self) -> dict[str, dict[str, Any]]:
            # 只 select 四个小列。`select(GeneratedApp)` 会把 model_json /
            # pages_json 整表拉回来——单行就能到 MB 级。
            with Session(engine) as s:
                rows = s.execute(
                    select(
                        GeneratedApp.session_id,
                        GeneratedApp.id,
                        GeneratedApp.version,
                        GeneratedApp.device,
                        GeneratedApp.created_at,
                    ).where(GeneratedApp.session_id.isnot(None))
                ).all()
            best: dict[str, dict[str, Any]] = {}
            for sid, app_id, version, device, created in rows:
                key = (int(version or 0), str(created or ""))
                sid = str(sid or "")
                if not sid:
                    continue
                prev = best.get(sid)
                if prev is None or key > prev["_key"]:
                    best[sid] = {
                        "_key": key,
                        "app_id": str(app_id or ""),
                        "version": int(version or 1),
                        "device": str(device or ""),
                    }
            for v in best.values():
                v.pop("_key", None)
            return best

        def preview_sources(self) -> dict[str, str]:
            # 不 select 图本体——`select(GeneratedAppPreview)` 会把每行两列
            # base64 一起拉出来，那正是这张表拆出去要避免的事。这里只取
            # 主键 + 两个"这一列非空吗"的布尔，跟图多大无关。
            with Session(engine) as s:
                rows = s.execute(
                    select(
                        GeneratedAppPreview.app_id,
                        GeneratedAppPreview.shot_png_b64.isnot(None)
                        & (GeneratedAppPreview.shot_png_b64 != ""),
                        GeneratedAppPreview.png_b64.isnot(None)
                        & (GeneratedAppPreview.png_b64 != ""),
                        GeneratedAppPreview.created_at,
                    )
                ).all()
            best: dict[str, str] = {}
            for app_id, has_shot, has_sheet, written in rows:
                if has_shot:
                    best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHOT, written)
                elif has_sheet:
                    best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHEET, written)
            return best

    return SqlAppStore()


# ─────────────── Neon SQL over HTTP 后端（受限网络：只有 443 出得去）───────────────
#
# 为什么要这条路：Neon 的常规连接走 TCP 5432，但很多环境只放行 HTTPS——
# 无服务器/边缘运行时（Vercel Edge、Cloudflare Workers 那类）没有原始 TCP，
# 受限的容器/沙盒也常只开 443。Neon 官方为此提供 SQL-over-HTTP 端点
# （https://<endpoint-host>/sql，就是官方 JS serverless driver 用的那个），
# 我们这里用同一套协议做一个 Python 侧的薄适配：只依赖已有的 httpx，不引新依赖，
# 也不依赖任何第三方 Neon 库（社区 Python 封装还很小众，不值得押上生产）。
#
# 定位是「TCP 不通时的第二选择」，不是默认路径：能走 TCP 就走 TCP（连接复用、
# 延迟低、事务语义完整）。本后端每条语句一次 HTTPS 往返，够画廊这种低频读写用。









def _neon_normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    """把 HTTP 返回的一行归一化成跟另外两个后端完全一致的记录形状。

    实测（2026-07-26）HTTP 端点的类型映射已经很干净：varchar→str、integer→int、
    boolean→bool、jsonb→dict（自动解析）、NULL→None，都不用动。唯一要修的是
    timestamptz：它给 '2026-07-26 12:34:56+00' 这种带空格的写法，而另外两个后端
    产出的是 isoformat()——不统一的话，画廊排序/相对时间会在不同后端下不一致。

    ⚠ 加字段前必读（2026-07-27 对真库逐类型实测）：端点对 **int8/bigint 和
    numeric 返回的是字符串**，不是数字——`count(*)` 拿到的是 "5" 而非 5。
    本表当前所有数值列都是 integer(int4，返回 int)，且代码里没有 count(*)，
    所以现在是安全的；将来谁加 bigint/numeric 列或写聚合查询，必须在这里
    显式转型，否则 TCP 后端返回 int、HTTP 后端返回 str，同一份数据在两个
    后端下行为不一致（排序、比较、算术全会悄悄错）。
    官方 JS 驱动绕开这个坑的办法是设 `Neon-Raw-Text-Output: true` 全部取
    文本再自己解析——那是因为 JS 的 number 是双精度、int8 会丢精度；Python
    的 int 任意精度，没这个必要，让服务端解析反而省事。"""
    out = dict(row)
    ts = out.get("created_at")
    if isinstance(ts, str) and ts:
        try:
            out["created_at"] = datetime.fromisoformat(ts).isoformat()
        except ValueError:
            pass  # 解析不了就原样留着，不编造时间
    if not isinstance(out.get("model_json"), dict):
        out["model_json"] = out.get("model_json") or {}
    # pages_json 与 model_json 的空语义不同：没有页面就是 None，不造空 dict
    # ——前端拿 {} 会当成"有页面但空"，判定分支就走错了。
    if not isinstance(out.get("pages_json"), dict):
        out["pages_json"] = None
    return out












# 记录字段顺序——INSERT 的列序与占位符序绑定在这里。摘要列与 list 共用
# _LIST_COLUMNS，改字段只改那一处，避免 list 漏列、INSERT 多列。
_NEON_COLUMNS = (*_LIST_COLUMNS, "model_json", "pages_json")

#: jsonb 列——绑参按 JSON 文本传、占位符带 ::jsonb 转型的那几列。
_NEON_JSON_COLUMNS = frozenset({"model_json", "pages_json"})


class NeonHttpAppStore(AppStoreBackend):
    """Neon SQL-over-HTTP 后端。与 SQLAlchemy 后端共用同一张 generated_app 表，
    行为（含 list 的「同 root 按 version 挑最新」语义）与另外两个后端严格对齐。"""

    def __init__(self, database_url: str, endpoint: str) -> None:
        import httpx

        self._endpoint = endpoint
        self._client = httpx.Client(
            timeout=_NEON_HTTP_TIMEOUT_S,
            headers={
                # 端点靠这个头拿到库/角色/密码——凭据只在头里，不进 URL 也不进日志
                "Neon-Connection-String": database_url,
                "Content-Type": "application/json",
            },
        )
        self._ensure_table()

    # ── 底层：一次 HTTPS 往返 ────────────────────────────────
    def _q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        resp = self._client.post(self._endpoint, json={"query": sql, "params": params or []})
        if resp.status_code >= 400:
            # 结构化解析：code/constraint/detail 等字段直接提出来，比截 200 字符
            # 好定位（见 _neon_http_error）。仍然抛异常，fail-open 语义不变。
            raise _neon_http_error(resp)
        return resp.json().get("rows") or []

    def _ensure_table(self) -> None:
        """IF NOT EXISTS：SQLAlchemy 后端可能已经建过同一张表，这里不覆盖它。
        列定义与 SQLAlchemy 模型保持一致，两个后端可以读写同一份数据。"""
        self._q(
            """
            create table if not exists generated_app (
                id varchar(36) primary key,
                root_id varchar(36),
                parent_id varchar(36),
                version integer,
                session_id varchar(64),
                goal text,
                product_name varchar(120),
                theme_id varchar(64),
                theme_label varchar(120),
                device varchar(16),
                landing_page_ref varchar(64),
                entity_count integer,
                page_count integer,
                role_count integer,
                ai_count integer,
                gate_passed boolean,
                dedup_key varchar(80),
                created_at timestamptz,
                model_json jsonb,
                pages_json jsonb
            )
            """
        )
        for col in ("root_id", "product_name", "dedup_key"):
            self._q(f"create index if not exists ix_generated_app_{col} on generated_app ({col})")
        # 缩略图另起一张表（理由见 AppStoreBackend.save_preview 上方）。列定义
        # 与 SQLAlchemy 侧的 GeneratedAppPreview 保持一致，两个后端读写同一份。
        self._q(
            """
            create table if not exists generated_app_preview (
                app_id varchar(36) primary key,
                png_b64 text,
                created_at timestamptz
            )
            """
        )
        # 一行两列、shot 优先（理由见 AppStoreBackend 的缩略图小节）。老库靠
        # 这一句就地补列——上面那句 `create table if not exists` 对已存在的表
        # 什么都不做，新列不会自己长出来。补不上就当没有这个来源，读到 NULL
        # 等同"没图"，回落 sheet。
        self._q("alter table generated_app_preview add column if not exists shot_png_b64 text")
        # 归属与可见性（2026-08-02）：老库靠这两句就地补，上面的
        # `create table if not exists` 对已存在的表什么都不做。
        self._q("alter table generated_app add column if not exists owner_id varchar(64)")
        self._q(
            "alter table generated_app add column if not exists visibility"
            " varchar(16) default 'public'"
        )
        # spec-first 整页 HTML（2026-08-14）：老库就地补列，补不上读到 NULL，
        # 等同"这一版没有页面"，前端回落区块渲染。
        self._q("alter table generated_app add column if not exists pages_json jsonb")
        self._q("alter table generated_app add column if not exists is_official integer default 0")
        self._q("alter table generated_app add column if not exists prior_owner_id varchar(64)")
        # 卡片徽标（2026-08-22）。不带 default：存量行保持 NULL =「不知道」。
        #
        # ⚠ 2026-08-22 线上事故，就是漏了这两句。当天把 role_count / ai_count
        # 加进了 _LIST_COLUMNS、加进了上面 `create table if not exists` 的列
        # 定义、也加进了 SQLAlchemy 那边的补列表——唯独漏了这里。生产的
        # generated_app 早就存在，那句建表对它什么都不做，于是列根本没长出来，
        # 而列表查询已经在 select 它们 → UndefinedColumn → /db-api 回 500，
        # 应用市场整个空掉（前端 fail-open 成空数组，连"我的应用"的筛选项和
        # 设备类型一起消失，看着像三个 bug，其实是这一个）。
        #
        # 这就是 CLAUDE.md 第四条「只改一半必然静默失效」的又一种形态：
        # **SQLAlchemy 补列表 / Neon 补列表是成对的**。
        # test_app_store.py::Test两套补列逻辑必须成对 盯着这一对。
        self._q("alter table generated_app add column if not exists role_count integer")
        self._q("alter table generated_app add column if not exists ai_count integer")
        self._q(
            "create table if not exists generated_app_grant ("
            " app_id varchar(36) not null, user_id varchar(64) not null,"
            " access integer not null, created_at timestamptz,"
            " primary key (app_id, user_id))"
        )

    # ── 接口实现 ────────────────────────────────────────────
    def save(self, record: dict[str, Any]) -> str:
        params: list[Any] = []
        for col in _NEON_COLUMNS:
            val = record.get(col)
            if col in _NEON_JSON_COLUMNS:
                # jsonb 参数按 JSON 文本传，SQL 里再 ::jsonb 转——直接塞 dict 会被
                # 当成未知类型。pages_json 允许"没有"：None 原样传，落 NULL——
                # dumps 成 "{}" 会把"没有页面"变成"有一份空页面"，前端判空就错了。
                if col == "model_json":
                    val = json.dumps(val or {}, ensure_ascii=False)
                else:
                    val = json.dumps(val, ensure_ascii=False) if isinstance(val, dict) else None
            elif col == "version":
                val = int(val or 1)
            elif col in ("entity_count", "page_count"):
                val = int(val or 0)
            elif col in ("role_count", "ai_count"):
                # ⚠ 这里**不能**写 `int(val or 0)`：None 会被写成 0，
                #   「数不出来」就变成了「确实没有」。
                val = _int_or_none(val)
            elif col == "gate_passed":
                val = bool(val)
            elif col == "is_official":
                val = 1 if _as_official(val) else 0
            params.append(val)
        placeholders = ", ".join(
            f"${i + 1}::jsonb" if col in _NEON_JSON_COLUMNS else f"${i + 1}"
            for i, col in enumerate(_NEON_COLUMNS)
        )
        updates = ", ".join(f"{c} = excluded.{c}" for c in _NEON_COLUMNS if c != "id")
        self._q(
            f"insert into generated_app ({', '.join(_NEON_COLUMNS)}) values ({placeholders}) "
            f"on conflict (id) do update set {updates}",
            params,
        )
        return record["id"]

    def get(self, app_id: str) -> Optional[dict[str, Any]]:
        rows = self._q("select * from generated_app where id = $1", [app_id])
        return _neon_normalize_row(rows[0]) if rows else None

    def list(
        self,
        *,
        limit: int,
        offset: int,
        latest_per_root: bool,
        shelf: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        # 2026-08-18：真机走 HttpApiAppStore（本类子类）。旧实现
        # `select * from generated_app` 无 LIMIT，把每份 pages_json
        # （~100KB HTML）经 /db-api 拉回再切片。limit=12 的响应只有
        # 8KB，墙钟却 3.5–5s；网关还为此回过 413。
        # 不走 _neon_normalize_row：它会把没选出的 pages_json 补成
        # None，has_pages 就被 _summary 抹掉。
        if shelf == "mine" and not owner_id:
            return []
        params: list[Any] = [limit, offset]
        if shelf == "mine":
            params.append(owner_id)
        rows = self._q(
            list_apps_sql(latest_per_root=latest_per_root, shelf=shelf),
            params,
        )
        return [_list_summary(r, has_pages=r.get("has_pages")) for r in rows]

    def versions(self, root_id: str) -> list[dict[str, Any]]:
        # ⚠ 不用 `select *`（2026-08-22）：返回值本来就是摘要（_summary 第一件事
        # 就是把 model_json / pages_json 丢掉），而 `select *` 会把每一版那两份
        # jsonb 全拉过网关再丢掉。has_pages 交给 SQL 判 null——理由同
        # list_apps_sql 那段：Postgres 判 NULL 不拆 TOAST，`->` 取值会把整份
        # HTML 解出来。
        cols = ", ".join(_LIST_COLUMNS)
        rows = self._q(
            f"select {cols}, (pages_json is not null) as has_pages"
            " from generated_app where root_id = $1 order by version",
            [root_id],
        )
        return [_list_summary(r, has_pages=r.get("has_pages")) for r in rows]

    def max_version(self, root_id: str) -> int:
        # 迭代热路每轮都走这里（save_version）。一句聚合，不拖血缘。
        rows = self._q(
            "select max(version) as v from generated_app where root_id = $1", [root_id]
        )
        return int((rows[0].get("v") if rows else 0) or 0)

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
        rows = self._q(
            "select * from generated_app where dedup_key = $1 limit 1", [dedup_key]
        )
        return _neon_normalize_row(rows[0]) if rows else None

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        rows = self._q(
            "select * from generated_app where session_id = $1 "
            "order by version desc, created_at desc limit 1",
            [session_id],
        )
        return _neon_normalize_row(rows[0]) if rows else None

    def ids_for_root(self, root_id: str) -> list[str]:
        # 只取 id：versions() 的 select * 会把每版 pages_json 拖过网关，
        # 删卡这条路径会 413，摘针失败、卡还在（2026-08-21）。
        rows = self._q(
            "select id from generated_app where coalesce(root_id, id) = $1",
            [root_id],
        )
        return [str(r["id"]) for r in rows if r.get("id")]

    def delete(self, app_id: str) -> bool:
        rows = self._q("delete from generated_app where id = $1 returning id", [app_id])
        self._q("delete from generated_app_preview where app_id = $1", [app_id])
        return bool(rows)

    def export_all(self) -> list[dict[str, Any]]:
        return [_neon_normalize_row(r) for r in self._q("select * from generated_app")]

    # ── 缩略图 ─────────────────────────────────────────────
    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:
        # 列名从归一后的来源派生，不是拼接调用方传进来的字符串——normalize
        # 只会返回 PREVIEW_SOURCE_PRIORITY 里的值，这里再映射成两个字面量之一，
        # 外部输入到不了 SQL 文本。
        col = (
            "shot_png_b64"
            if normalize_preview_source(source) == PREVIEW_SOURCE_SHOT
            else "png_b64"
        )
        # 只更新自己那一列：两个来源共用一行，`do update set` 把两列都写一遍
        # 会用 NULL 抹掉另一个来源那张图（回传截图时必然撞上）。
        self._q(
            f"insert into generated_app_preview (app_id, {col}, created_at) "
            f"values ($1, $2, $3) on conflict (app_id) do update set "
            f"{col} = excluded.{col}, created_at = excluded.created_at",
            [app_id, png_b64, _now_iso()],
        )

    def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
        rows = self._q(
            "select shot_png_b64, png_b64 from generated_app_preview where app_id = $1",
            [app_id],
        )
        if not rows:
            return None
        row = rows[0]
        wanted = (
            [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
        )
        for src in wanted:
            b64 = row.get("shot_png_b64" if src == PREVIEW_SOURCE_SHOT else "png_b64")
            if isinstance(b64, str) and b64:
                return b64
        return None

    def session_app_index(self) -> dict[str, dict[str, Any]]:
        # ⚠ 列必须逐个写出来，**不许 `select *`**：这张表带 model_json /
        #   pages_json 两列 jsonb，整表过 /db-api 网关是本仓栽过的老坑
        #   （list_apps_sql 里 2026-08-18 那段就是修它）。
        rows = self._q(
            "select session_id, id, version, device, created_at"
            " from generated_app where session_id is not null"
        )
        best: dict[str, dict[str, Any]] = {}
        for r in rows:
            sid = str(r.get("session_id") or "")
            if not sid:
                continue
            key = (int(r.get("version") or 0), str(r.get("created_at") or ""))
            prev = best.get(sid)
            if prev is None or key > prev["_key"]:
                best[sid] = {
                    "_key": key,
                    "app_id": str(r.get("id") or ""),
                    "version": int(r.get("version") or 1),
                    "device": str(r.get("device") or ""),
                }
        for v in best.values():
            v.pop("_key", None)
        return best

    def preview_sources(self) -> dict[str, str]:
        # 不 select 图本体：`select *` 会把每行两列共约 2MB 的 base64 一起过网，
        # 而这里要的只是"哪些应用有图、哪一路的"。判空在库里做完，回来的每行
        # 只有一个 id 加两个布尔。
        rows = self._q(
            "select app_id, created_at, "
            "(shot_png_b64 is not null and shot_png_b64 <> '') as has_shot, "
            "(png_b64 is not null and png_b64 <> '') as has_sheet "
            "from generated_app_preview"
        )
        best: dict[str, str] = {}
        for r in rows:
            app_id = r.get("app_id")
            if not app_id:
                continue
            written = r.get("created_at")
            if r.get("has_shot"):
                best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHOT, written)
            elif r.get("has_sheet"):
                best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHEET, written)
        return best















class HttpApiAppStore(NeonHttpAppStore):
    """自定义 HTTPS SQL API 后端（例如本仓库的 /db-api）。"""

    def __init__(self, api_base_url: str, api_key: str) -> None:
        self._gateway = HttpSqlGateway(api_base_url, api_key)
        self._endpoint = self._gateway.endpoint
        self._ensure_table()

    def _q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        return self._gateway.query(sql, params)


# ────────────────────────── 后端单例选择 ──────────────────────────

_backend_lock = threading.Lock()
_backend_instance: Optional[AppStoreBackend] = None
_backend_signature: Optional[str] = None
# 本进程内已经初始化失败过的 DB URL——不再重试（避免每次 get_backend 都吃一次
# 连接超时）。直接走 JSON 兜底。reset_backend_cache 会一并清空（测试用）。
_failed_db_urls: set[str] = set()
_failed_http_api_targets: set[str] = set()


def _local_sqlite_backend() -> Optional[AppStoreBackend]:
    """本地 SQLite 兜底（2026-07-28）。远端不可用时的第二选择，排在 JSON 之前。

    为什么值得单独一级：JSON 兜底是"整个文件读出来改完再写回去"，没有索引、
    没有事务、并发写只能靠进程内一把锁；SQLite 是真库——同一套 SQLAlchemy
    模型、同样能查能索引，写入是事务性的，进程崩在半路也不会留下半个文件。
    远端挂掉那段时间里产生的应用，落在 SQLite 比落在 JSON 更捞得回来。

    ⚠️ 分叉是真实存在的：远端恢复后，这段时间写进本地的记录不会自动回流，
    两边从此各说各话。这个问题在 JSON 兜底时代就存在，加了 SQLite 只是让
    兜底更好用、并没有解决它。要解决得有一层同步/对账，那是另一件事。
    所以下面的日志把"现在写在哪"讲明白，而不是静默降级。

    配置置空 → 返回 None（跳过这一级）。建库失败（只读文件系统等）也返回
    None，由调用方继续降到 JSON。
    """
    url = (getattr(settings, "APP_STORE_LOCAL_SQLITE", "") or "").strip()
    if not url:
        return None
    try:
        # sqlite:///data/xxx.db → 确保 data/ 存在，否则 SQLAlchemy 直接抛
        prefix = "sqlite:///"
        if url.startswith(prefix):
            Path(url[len(prefix):]).parent.mkdir(parents=True, exist_ok=True)
        return _sqlalchemy_backend(url)
    except Exception as exc:  # noqa: BLE001 — 本地库也建不起来就继续降级
        print(f"[app_store] 本地 SQLite 不可用，继续回退 JSON: {str(exc)[:200]}")
        return None






def _current_signature() -> str:
    remote = (settings.APP_STORE_DATABASE_URL or "").strip()
    http_api_url = (getattr(settings, "APP_STORE_HTTP_API_URL", "") or "").strip()
    http_api_key = (getattr(settings, "APP_STORE_HTTP_API_KEY", "") or "").strip()
    local = (getattr(settings, "APP_STORE_LOCAL_SQLITE", "") or "").strip()
    # 本地库配置也进签名：改了它（比如测试里置空）要能触发重建，否则会一直
    # 拿着上一次的后端单例，改配置像没生效。
    # 通道偏好同理——翻了开关要能重建。
    return (
        f"{remote}|{local}|jsonfile:{settings.APP_STORE_FILE}"
        f"|httpapi:{_http_api_target_key(http_api_url, http_api_key)}"
        f"|http:{int(prefer_neon_http())}"
    )


def get_backend() -> AppStoreBackend:
    """按当前配置返回后端单例，fail-open（2026-07-28 起）：

        自定义 HTTPS SQL API（可选） → 远端 TCP → 远端 SQL over HTTP → 本地 SQLite → 本地 JSON 文件
        └────────────────────────────── 同一个 APP_STORE_DATABASE_URL ──────────────────────────────┘

    优先级的意思是"数据最好落在哪"：
    1. 自定义 HTTPS SQL API 适用于只能跑 HTTPS 的受限环境（例如外部沙盒）；
    2. 远端库（Neon/自建 PG）走 TCP——连接复用、延迟低、事务语义完整；
    3. TCP 不通（受限网络只放行 443、无服务器/边缘运行时没有原始 TCP）且连接
       串指向 Neon 时，改走官方 SQL-over-HTTP 端点。同一个连接串、无需改配置：
       生产照旧走 TCP，受限环境自动降级但**仍然是同一个远端库**，数据不分叉；
    4. 远端整个不可用时落本地 SQLite——真库，能查能索引、写入是事务性的，比
       JSON 那种"整文件读改写"强；
    5. 本地库也建不起来（只读文件系统等）才回 JSON 文件。

    ⚠️ 第 3 级开始数据就和远端分叉了：远端恢复后本地这段时间的记录不会自动
    回流。这在只有 JSON 兜底的时代就存在，加 SQLite 只是让兜底更可用，没有
    解决分叉。所以每次降级都打印"现在写在哪"，不静默。

    签名变了（比如测试里改环境）就重建。任何一级失败都不抛给调用方——存储层
    绝不拖垮主链路。"""
    global _backend_instance, _backend_signature
    with _backend_lock:
        sig = _current_signature()
        if _backend_instance is not None and _backend_signature == sig:
            return _backend_instance
        http_api_url = (getattr(settings, "APP_STORE_HTTP_API_URL", "") or "").strip()
        http_api_key = (getattr(settings, "APP_STORE_HTTP_API_KEY", "") or "").strip()
        if http_api_url:
            http_api_sig = _http_api_target_key(http_api_url, http_api_key)
            if not http_api_key:
                print("[app_store] 设了 APP_STORE_HTTP_API_URL 但没配 APP_STORE_HTTP_API_KEY，忽略这个通道")
            elif http_api_sig not in _failed_http_api_targets:
                try:
                    _backend_instance = HttpApiAppStore(http_api_url, http_api_key)
                    print("[app_store] 直接走自定义 HTTPS SQL API")
                    _backend_signature = sig
                    return _backend_instance
                except Exception as exc:  # noqa: BLE001 — 指定了也可能连不上
                    _failed_http_api_targets.add(http_api_sig)
                    print(
                        f"[app_store] 自定义 HTTPS API 不可用，继续按常规顺序降级: "
                        f"{str(exc)[:200]}"
                    )
        db_url = (settings.APP_STORE_DATABASE_URL or "").strip()
        # 显式指定走 HTTP：跳过 TCP 那一整段（探针 + 多地址逐个试 + 建表补列），
        # 直接用 SQL over HTTP。理由见 prefer_neon_http。
        # 它自己失败了照旧往下降级，不会把人卡在这一级。
        if db_url and db_url not in _failed_db_urls and prefer_neon_http():
            endpoint = neon_http_endpoint(db_url)
            if endpoint:
                try:
                    _backend_instance = NeonHttpAppStore(db_url, endpoint)
                    print(f"[app_store] 按 {_PREFER_HTTP_ENV} 指定，直接走 Neon SQL over HTTP")
                    _backend_signature = sig
                    return _backend_instance
                except Exception as exc:  # noqa: BLE001 — 指定了也可能连不上
                    print(
                        f"[app_store] 指定的 HTTP 通道不可用，继续按常规顺序降级: "
                        f"{str(exc)[:200]}"
                    )
            else:
                print(
                    f"[app_store] 设了 {_PREFER_HTTP_ENV} 但连接串不是 Neon 主机，"
                    f"忽略这个偏好"
                )
        if db_url and db_url not in _failed_db_urls:
            try:
                _backend_instance = _sqlalchemy_backend_within_budget(db_url)
            except Exception as exc:  # noqa: BLE001 — 连不上/驱动缺失时诚实降级
                tcp_err = str(exc)[:200]
                endpoint = neon_http_endpoint(db_url)
                if endpoint:
                    try:
                        _backend_instance = NeonHttpAppStore(db_url, endpoint)
                        print(
                            f"[app_store] TCP 不可用（{tcp_err}），已改走 Neon SQL over HTTP"
                        )
                    except Exception as http_exc:  # noqa: BLE001
                        _failed_db_urls.add(db_url)
                        local = _local_sqlite_backend()
                        print(
                            f"[app_store] 远端两条通道均不可用，改写"
                            f"{'本地 SQLite' if local else 'JSON 文件'}"
                            f"（与远端分叉，恢复后不会自动回流）: "
                            f"TCP={tcp_err} / HTTP={str(http_exc)[:200]}"
                        )
                        _backend_instance = local or JsonFileAppStore()
                else:
                    _failed_db_urls.add(db_url)  # 本进程不再重试这个 URL
                    local = _local_sqlite_backend()
                    print(
                        f"[app_store] 远端 DB 初始化失败，改写"
                        f"{'本地 SQLite' if local else 'JSON 文件'}"
                        f"（与远端分叉，恢复后不会自动回流）: {tcp_err}"
                    )
                    _backend_instance = local or JsonFileAppStore()
        else:
            # 没配远端连接串（或这个 URL 本进程已经失败过）：本地 SQLite 仍然
            # 优于 JSON——没有远端不代表就该退到最弱的那一档。
            _backend_instance = _local_sqlite_backend() or JsonFileAppStore()
        _backend_signature = sig
        return _backend_instance


def reset_backend_cache() -> None:
    """测试用：改了配置后强制下次重建后端（含清空"失败过的 URL"记忆）。"""
    global _backend_instance, _backend_signature
    with _backend_lock:
        _backend_instance = None
        _backend_signature = None
        _failed_db_urls.clear()
        _failed_http_api_targets.clear()


# ────────────────────────── 公开 API ──────────────────────────

def save_app(
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    dedup_key: Optional[str] = None,
    preview_png_b64: Optional[str] = None,
    owner_id: Optional[str] = None,
    visibility: Optional[str] = None,
    pages_json: Optional[dict[str, Any]] = None,
) -> str:
    """存一个新生成的原始应用（root=自己·v1·无 parent）。返回 app id。

    owner_id 为 None = 无主（匿名推演出来的、或存量数据）。语义在 app_access
    里定义：可读、不可写（超管除外）。

    传了 dedup_key 且已有同键记录 → 幂等更新那一条（复用它的 id/root/version，
    刷新 model_json/元数据），不堆重复；用于"同一会话反复落同一个模型"。

    preview_png_b64 是应用中心的卡片缩略图（生成时那张首页参照板，见
    app_preview）。**没传就保留既有的那张**，不清空——这一路上大部分调用
    根本没生成图（重开夹具、纯精修、fork），若按"没传即无图"处理，一次重存
    就会把卡片打回空态。

    pages_json 是 spec-first 链路画的整页 HTML（形状同会话侧
    state.specFirstPages）。幂等更新时**没传就保留既有那份**，纪律与
    preview_png_b64 同款：同一个模型重存（重开夹具等）不带页面是常态，
    按"没传即无页"处理的话，一次重存就把应用中心的卡打回区块渲染。
    """
    backend = get_backend()
    if dedup_key:
        existing = backend.find_by_dedup_key(dedup_key)
        if existing is not None:
            record = _build_record(
                model, goal=goal, session_id=session_id, gate_passed=gate_passed,
                app_id=existing["id"], root_id=existing["root_id"],
                parent_id=existing.get("parent_id"), version=existing.get("version") or 1,
                dedup_key=dedup_key,
                # 幂等更新走这条：**归属与可见性沿用已有记录**。同一会话反复落同
                # 一个模型是常态，若每次都按调用方传的值覆盖，一次匿名重跑就能把
                # 已有主的应用变成无主、把私有变成公开。
                owner_id=existing.get("owner_id") or owner_id,
                visibility=existing.get("visibility") or visibility,
                is_official=existing.get("is_official"),
                prior_owner_id=existing.get("prior_owner_id"),
                pages_json=pages_json if pages_json is not None else existing.get("pages_json"),
            )
            record["created_at"] = existing.get("created_at") or record["created_at"]
            app_id = backend.save(record)
            _attach_preview(backend, app_id, preview_png_b64, inherit_from=None)
            return app_id
    app_id = _new_id()
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=app_id, parent_id=None, version=1, dedup_key=dedup_key,
        owner_id=owner_id, visibility=visibility, pages_json=pages_json,
    )
    saved = backend.save(record)
    _attach_preview(backend, saved, preview_png_b64, inherit_from=None)
    return saved


def _attach_preview(
    backend: AppStoreBackend,
    app_id: str,
    png_b64: Optional[str],
    *,
    inherit_from: Optional[str],
) -> None:
    """给刚落库的这一条挂缩略图。fail-open：挂不上只影响卡片长相，不影响落库。

    png_b64 是这一次生成的**参照板**（sheet 来源）。有就用，没有就从
    inherit_from（上一版 / fork 源）那条继承——副本/新版是个新 app_id，不继承
    的话卡片就是空的，而实际上它跟源长得基本一样，源那张图仍然是诚实的。

    继承**两路都认**（shot / sheet），按 PREVIEW_SOURCE_PRIORITY 取最好的那
    **一张**——不是把两张都复制过来：每张约 1MB，而"两路并存"是为了两条**产图
    路径**互为退路，继承来的副本不承担那个职责。来源标签原样保留：继承来的截图
    仍记为 shot，继承来的参照板仍记为 sheet。形状对标 go-gitea/gitea
    `services/repository/template.go:133`（`opts.Avatar &&
    len(templateRepo.Avatar) > 0`——源有图才把封面复制给副本）。

    ⚠ 2026-08-23：**这里原先明确不继承 shot**，理由是"继承会把自己堵死"——
    继承来的图让 app_has_shot 成立，采集端便不再为它采一张。那条理由只对
    **卡片众包补图**成立（那条路不带 replace，会被 already_has_shot 挡下）。
    2026-08-22 卡片改成只贴图、众包补图整条删掉之后，唯一剩下的采集者是推演
    收口（client 的 studio-landing-shot.tsx，一律带 ?replace=1，见
    routes/sliderule_full.py 的 upload_generated_app_shot：replace 直接跳过
    already_has_shot）——它堵不住。理由消失了，继承就该恢复。

    原设计留的安全网是"参照板继承仍在，卡片始终有图可贴"，而那张网从来不存在：
    参照板要 IMAGE_API_URL / IMAGE_MODEL / IMAGE_API_KEY 三件套齐全才生得出，
    线上从没配过。2026-08-23 查线上库：64 个应用里**有 sheet 的 = 0**，20 张
    图全是 shot。于是 fork / 精修出来的应用继承了个空，众包补图删掉后再也没有
    第二次机会——用户当天指着一个刚 fork 出来的应用问"这不是今天生成的吗，
    怎么没图"，就是这个。

    ⚠ 将来若再加一条**不带 replace** 的采集路径，先想清楚这件事：继承来的 shot
    会让它认为"已经有图了"而跳过。要么让它带 replace，要么给继承来的图另立标记。
    """
    b64 = png_b64
    source = PREVIEW_SOURCE_SHEET
    if not b64 and inherit_from:
        try:
            for candidate in PREVIEW_SOURCE_PRIORITY:
                inherited = backend.get_preview(inherit_from, source=candidate)
                if inherited:
                    b64, source = inherited, candidate
                    break
        except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
            print(f"[app_store] 缩略图继承失败（不影响落库）: {str(exc)[:160]}")
            b64 = None
    if not b64:
        return
    try:
        from .thumb_image import to_webp

        # 参照板来自生图 API，是 PNG base64（实测 805~857KB）。同样只存派生图。
        # 注意：这里压的**只是留给卡片显示的那一份**——设计 LLM 用的那张参照图
        # 走的是内存里的原始 base64，不经过这里，画质不受影响。
        # 继承来的截图早就是 WebP，to_webp 认出来原样返回（见其头注），不会二次
        # 编码掉画质。
        raw = base64.b64decode(b64)
        b64 = base64.b64encode(to_webp(raw)).decode("ascii")
        backend.save_preview(app_id, b64, source=source)
    except Exception as exc:  # noqa: BLE001 — 同上
        print(f"[app_store] 缩略图写入失败（不影响落库）: {str(exc)[:160]}")


def save_app_shot(app_id: str, png_bytes: bytes) -> bool:
    """把一张真实渲染的截图挂到已落库的应用上（采集回传的落点）。

    独立于 _attach_preview：那条路跑在落库事务旁边、参数是"这次生成产出的参照
    板"；这条路是之后由前端回传的，只认 app_id。

    fail-open 返回 bool 而不是抛：截图是增强项，写不进去的正确表现是卡片继续用
    参照板，而不是让回传接口 500。
    """
    if not png_bytes:
        return False
    try:
        from .thumb_image import to_webp

        # 存派生图而不是原图（thumbor/imgproxy 的做法，理由见 thumb_image 头注）：
        # 实测 805KB PNG → 43KB WebP，分辨率一个像素不减。fail-open——转不动就
        # 原样存，卡片照常显示，只是没省下带宽。
        b64 = base64.b64encode(to_webp(png_bytes)).decode("ascii")
        get_backend().save_preview(app_id, b64, source=PREVIEW_SOURCE_SHOT)
        return True
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 截图写入失败: {str(exc)[:160]}")
        return False


def app_has_shot(app_id: str) -> bool:
    """这个应用是不是已经有真实截图了。回传接口用它做幂等——同一张卡可能被多个
    标签页/多次滚动同时采集，重复写只是白费带宽和一次缓存失效。

    fail-open 当成"没有"：查不到就让这次回传照常写，最坏是覆盖一张同样的图。
    """
    try:
        return bool(get_backend().get_preview(app_id, source=PREVIEW_SOURCE_SHOT))
    except Exception:  # noqa: BLE001 — 缩略图是增强项
        return False


def save_app_or_version(
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    preview_png_b64: Optional[str] = None,
    owner_id: Optional[str] = None,
    pages_json: Optional[dict[str, Any]] = None,
) -> str:
    """闭环落库的正确入口（2026-07-27，审查修复）：

    - 模型一字未变（同 dedup_key）→ 幂等更新既有记录；
    - 同一会话、模型有变 → **同 root 的新版本**（save_version，version 递增，
      卡片长出 v2 徽标、版本链可查）；
    - 该会话首次落库 → 新应用（save_app，root=自己·v1）。

    此前闭环路径只调 save_app(dedup_key=会话+模型签名)：模型一变签名就变
    → miss → 每次精修都新建 root——版本链永远不产生（save_version 是全仓
    零调用的死代码），画廊里同一会话堆同名重复卡，v2 徽标恒为死代码。

    pages_json：spec-first 这一轮画的整页 HTML，三条分支都原样传下去
    （幂等更新按"没传保留既有"、新版本按"不继承"，语义各写在各自入口）。
    """
    dedup_key = model_signature(session_id, model)
    backend = get_backend()
    existing_same = backend.find_by_dedup_key(dedup_key)
    # ⚠ 2026-08-24：dedup 命中**不等于**这次没产出新东西。
    #
    #   命中只说明"模型一字未变"，而局部精修的常态恰恰是模型没变、只有页面
    #   HTML 变了。原来这里直接 return save_app（幂等更新），后果有两条，
    #   都不报错：上一版的 pages_json 被就地覆盖（**回不去了**）、v{N} 少数
    #   一次改版。判据补在 pages_payload_differs 的头注里。
    #
    #   拿来比的是**货架上当前那一版**（prior），不是 dedup 命中的那一条——
    #   它可能是血缘里更早的某一版（把页面改回旧样子那种），跟它比会判成
    #   "没变"，而实际交付的与货架上摆着的并不一样。
    #
    #   代价：dedup 命中这条路多一次 find_latest_by_session。这一步前面刚跑完
    #   几分钟的 LLM、后面紧接着要写 100KB+ 的记录，多一次索引读可以忽略。
    prior = backend.find_latest_by_session(session_id) if session_id else None
    if existing_same is not None and not pages_payload_differs(
        (prior or existing_same).get("pages_json"), pages_json
    ):
        return save_app(
            model, goal=goal, session_id=session_id,
            gate_passed=gate_passed, dedup_key=dedup_key,
            preview_png_b64=preview_png_b64, owner_id=owner_id,
            pages_json=pages_json,
        )
    if prior is not None:
        return save_version(
            prior.get("root_id") or prior["id"], prior["id"], model,
            goal=goal or (prior.get("goal") or ""),
            session_id=session_id, gate_passed=gate_passed,
            preview_png_b64=preview_png_b64,
            pages_json=pages_json,
        )
    return save_app(
        model, goal=goal, session_id=session_id,
        gate_passed=gate_passed, dedup_key=dedup_key,
        preview_png_b64=preview_png_b64, owner_id=owner_id,
        pages_json=pages_json,
    )


def save_version(
    root_id: str,
    parent_id: str,
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    preview_png_b64: Optional[str] = None,
    pages_json: Optional[dict[str, Any]] = None,
) -> str:
    """同一应用的新一版（同 root，version 递增）。用于对已有应用精修/重生成。

    缩略图：这一版自己生了图就用自己的，没生就继承上一版那张（见
    _attach_preview）——精修通常不重跑生图，不继承的话每精修一次卡片就掉回
    空态一次。

    ⚠ 2026-08-23：继承从"只继承 sheet"放宽到"shot / sheet 都继承"。旧写法的
      安全网（参照板继承仍在）从来是空的——线上没配生图，全站 sheet 数为 0，
      于是每精修一次就真的掉一次空态。继承来的 shot 不会挡住这一版重新采图：
      收口采集一律带 replace=1。

    pages_json（spec-first 整页 HTML）**不继承上一版**，跟参照板的继承纪律
    相反：开新版本意味着模型变了，上一版的 HTML 是照着旧模型打的孔，挂到
    新版本上就是"东西看着在，其实是旧的"。这一版自己没画页面就落 None，
    应用中心对它诚实回落区块渲染。
    """
    backend = get_backend()
    # ⚠ 只要一个数，别把整条血缘拉回来（见 AppStoreBackend.max_version 的说明）。
    next_version = backend.max_version(root_id) + 1
    app_id = _new_id()
    # 改版是同一条血缘上的新版本：归属与可见性跟着走，不重新协商。
    # 从上一版取（parent 优先，取不到就用同 root 里 version 最大的那条）——
    # 漏了这一步的话，每精修一次就产生一条无主+public 的新记录，
    # 私有应用会在改版时悄悄变公开。
    #
    # parent 取到就**不再查血缘**：正常精修链路上 parent 一定在
    # （save_app_or_version 传的就是上一版的 id），那条 versions() 兜底只在
    # parent 记录被删过的畸形数据上才会走到。
    base = backend.get(parent_id)
    if base is None:
        existing = backend.versions(root_id)
        base = max(existing, key=lambda v: v.get("version") or 0) if existing else None
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=root_id, parent_id=parent_id, version=next_version,
        owner_id=(base or {}).get("owner_id"),
        visibility=(base or {}).get("visibility"),
        is_official=(base or {}).get("is_official"),
        prior_owner_id=(base or {}).get("prior_owner_id"),
        pages_json=pages_json,
    )
    saved = backend.save(record)
    _attach_preview(backend, saved, preview_png_b64, inherit_from=parent_id)
    return saved


def fork_app(
    source_id: str,
    *,
    session_id: Optional[str] = None,
    new_name: Optional[str] = None,
    owner_id: Optional[str] = None,
    visibility: Optional[str] = None,
) -> Optional[str]:
    """从现有应用分出一条新血缘：新 root·v1·parent 指向源，model_json 拷贝一份。
    源不存在返回 None。用于"以某个生成应用为起点，改成一个新应用"。

    - new_name：给副本改名（写进模型身份 appIdentity.productName，product_name
      元数据会自动跟着 re-derive）。对标 Budibase duplicateApp 的"预填 X 副本"——
      避免复刻出同名孪生卡。
    - session_id：不再默认继承源应用的会话（那会导致点开副本却进了源会话）。
      只在显式传入时才带；默认 None = 副本是独立设计快照，不绑任何会话。
    """
    source = get_backend().get(source_id)
    if source is None:
        return None
    import copy

    model = copy.deepcopy(source.get("model_json") or {})
    if new_name and isinstance(model, dict):
        appbundle = model.setdefault("appbundle", {})
        identity = appbundle.setdefault("appIdentity", {})
        identity["productName"] = str(new_name)[:120]
    app_id = _new_id()
    from .app_access import fork_visibility as fork_visibility_of

    record = _build_record(
        model, goal=source.get("goal") or "",
        session_id=session_id,
        gate_passed=bool(source.get("gate_passed")),
        app_id=app_id, root_id=app_id, parent_id=source_id, version=1,
        # 副本归 Fork 的人所有。可见性对标 Gitea GenerateRepository
        # （template.go:85，调用方按 fork_visibility 传入，默认 private），
        # 不是 git fork 那条继承源可见性。官方标记不跟着走。
        owner_id=owner_id,
        visibility=visibility if visibility is not None else fork_visibility_of(source),
        is_official=False,
        prior_owner_id=None,
        pages_json=source.get("pages_json"),
    )
    backend = get_backend()
    saved = backend.save(record)
    # 副本的设计跟源一模一样（model_json 就是拷贝的），源那张图对副本同样诚实。
    _attach_preview(backend, saved, None, inherit_from=source_id)
    return saved


def get_app(app_id: str) -> Optional[dict[str, Any]]:
    return get_backend().get(app_id)


def get_app_preview_png(app_id: str, *, source: Optional[str] = None) -> Optional[bytes]:
    """应用中心卡片缩略图的 PNG 原始字节；没有就 None（调用方 404，卡片画空态）。
    fail-open：存储层出问题也当成"没有图"，不把一张缩略图变成故障。

    source 不传 = 按优先级取最好的那张（shot 优先，见 PREVIEW_SOURCE_PRIORITY）。
    这就是应用中心走的路径——**优先级判定在服务端**，前端不需要知道有几个来源，
    它只管"有图就贴、404 就画空态"。
    """
    try:
        b64 = get_backend().get_preview(app_id, source=source)
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 缩略图读取失败: {str(exc)[:160]}")
        return None
    if not b64:
        return None
    try:
        return base64.b64decode(b64)
    except (ValueError, TypeError):
        return None


def get_session_preview_png(session_id: str, *, source: Optional[str] = None) -> Optional[bytes]:
    """Resolve a trusted generated asset through its owning session.

    The model stores only the semantic ``landing-hero`` reference. Binary data remains in the
    preview store, and the latest immutable app version for the session owns the concrete asset.
    """
    if not str(session_id or "").strip():
        return None
    try:
        record = get_backend().find_latest_by_session(str(session_id))
    except Exception as exc:  # noqa: BLE001 — media is a fail-open enhancement
        print(f"[app_store] 会话主视觉查询失败: {str(exc)[:160]}")
        return None
    app_id = str((record or {}).get("id") or "")
    return get_app_preview_png(app_id, source=source) if app_id else None


def get_latest_app_for_session(session_id: str) -> Optional[dict[str, Any]]:
    """这个会话最新落库的那条应用摘要。推演收口前端靠它拿到 app_id 去回传截图。

    完整记录含 model_json / pages_json，这里只回摘要（与 list_apps 同一套
    _summary + 缩略图三件套）。找不到或存储故障返回 None——截图是增强项，
    调用方 404 即可，不要把收口链路打成 500。
    """
    if not str(session_id or "").strip():
        return None
    try:
        record = get_backend().find_latest_by_session(str(session_id))
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 会话应用查询失败: {str(exc)[:160]}")
        return None
    if not record:
        return None
    return _mark_previews([_summary(record)])[0]


def _mark_previews(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """给一批摘要打上缩略图三件套——前端据此决定这张卡贴哪张图、还是画空态。

      has_preview    有没有图。false → 应用中心画空态；侧栏会话封面回落活渲染
                     （两处不同链，见 client 的 AppsWorkbench / session-thumb）。
      preview_source "shot" / "sheet"，当前用的是哪一路。观测用，也让"这张卡
                     到底贴的什么"在列表接口上直接可见，不用去翻库。
      preview_tag    拼进缩略图 URL `?v=` 的缓存版本位（见 preview_sources）。

    图本身不进摘要（一张约 1MB，列 200 个就是 200MB）。这里只多做一次索引
    查询，跟列表长度无关。fail-open：查不到就当全都没图（卡片画空态），
    不因为一次查询失败让整个列表 500。
    """
    if not rows:
        return rows
    try:
        tags = get_backend().preview_sources()
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 缩略图索引读取失败，本次列表按「无图」处理: {str(exc)[:160]}")
        tags = {}
    for r in rows:
        tag = tags.get(str(r.get("id")))
        r["has_preview"] = bool(tag)
        r["preview_source"] = preview_source_of(tag) if tag else ""
        r["preview_tag"] = tag or ""
    return rows


def session_covers() -> dict[str, dict[str, Any]]:
    """session_id → 该会话最新那版应用的 `{app_id, version, device}` + 缩略图三件套。

    给 `GET /sessions` 用，让会话摘要自带封面信息。字段名与 `_mark_previews`
    给应用摘要打的**完全一致**（has_preview / preview_source / preview_tag），
    前端 `shouldUseSheetThumb` 那一条判定因此不用分两套。

    ⚠ 两套判定漂移是本仓反复踩的形状（列表与单条、生成侧与消费侧）。要改字段名
      就两边一起改，别只改一头——现象是卡片静默不贴图，不报错。

    fail-open：缩略图是增强项。索引查不到就返回空表，会话照常列出来，卡片画空
    态。**不能**因为它把 `GET /sessions` 拖成 500——侧栏和应用中心都靠那条路。
    """
    # ⚠ 两条查询**并发**发，不要串行（2026-08-24）。
    #
    #   它们互不依赖，各自是一次 HTTPS 网关往返 ~140ms。串起来 277ms，并发
    #   145ms —— 真机实测，见下面那条判据。GET /sessions 是侧栏和应用中心共用
    #   的首屏接口，这 130ms 是每次开工作台都要付的。
    #
    #   为什么不合成一条 SQL join：preview_sources 还服务着 /apps 列表
    #   （_mark_previews），合并就要再加一个后端方法 × 四个实现——本仓第四条
    #   说的"同一件事两处实现"，为省一次往返不值得。并发是零新增接口的省法。
    backend = get_backend()
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="session-covers") as pool:
        index_future = pool.submit(backend.session_app_index)
        tags_future = pool.submit(backend.preview_sources)
        try:
            index = index_future.result()
        except Exception as exc:  # noqa: BLE001 — 增强项，自己炸了不许拖垮主链路
            print(f"[app_store] 会话→应用索引读取失败，本次按「会话无绑定应用」处理: {str(exc)[:160]}")
            index = None
        try:
            tags = tags_future.result()
        except Exception as exc:  # noqa: BLE001
            print(f"[app_store] 缩略图索引读取失败，本次会话摘要按「无图」处理: {str(exc)[:160]}")
            tags = {}
    # ⚠ 绑定索引没了就整个放弃（返回空），但**两个 future 都得先 result()**——
    #   提前 return 会让另一条查询变成没人收的异常，日志里只剩一行
    #   "exception was never retrieved"。所以判空放在 with 之后。
    if not index:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for sid, info in index.items():
        app_id = str(info.get("app_id") or "")
        if not app_id:
            continue
        tag = tags.get(app_id)
        out[sid] = {
            "app_id": app_id,
            "version": int(info.get("version") or 1),
            "device": str(info.get("device") or ""),
            "has_preview": bool(tag),
            "preview_source": preview_source_of(tag) if tag else "",
            "preview_tag": tag or "",
        }
    return out


def list_apps(
    *,
    limit: int = 50,
    offset: int = 0,
    latest_per_root: bool = True,
    shelf: Optional[str] = None,
    owner_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """列表（默认每个应用只出最新版），返回摘要（不含 model_json / 缩略图本体）。"""
    return _mark_previews(
        get_backend().list(
            limit=max(1, min(limit, 200)),
            offset=max(0, offset),
            latest_per_root=latest_per_root,
            shelf=shelf,
            owner_id=owner_id,
        )
    )


def patch_app(
    app_id: str,
    *,
    visibility: Optional[str] = None,
    is_official: Optional[bool] = None,
) -> Optional[dict[str, Any]]:
    """改可见性 / 官方归属。完整记录 roundtrip，不丢 model_json。

    官方不是打勾：对标 Gitea transferOwnership，改 owner_id。
    送上官方货架时一并公开——私有官方等于空货架。
    """
    from .app_access import (
        normalize_visibility,
        transfer_from_official,
        transfer_to_official,
    )

    backend = get_backend()
    rec = backend.get(app_id)
    if rec is None:
        return None
    if visibility is not None:
        rec["visibility"] = normalize_visibility(visibility)
    if is_official is not None:
        if is_official:
            rec = transfer_to_official(rec)
        else:
            rec = transfer_from_official(rec)
    backend.save(rec)
    return rec


def update_page_html(app_id: str, page_id: str, html: str) -> Optional[dict[str, Any]]:
    """点选编辑器把单页 HTML 存回去——手动编辑，原地更新，不开新版本。

    ⚠ 别套用 save_app_or_version 那条版本纪律。那条修的是"AI 精修产出了新东西，
    却因为签名没变被判成没变"——自动化链路的静默失效。这里正相反：用户在
    画布里点了保存，是**明确的、单次的手动动作**，不是又推演了一轮，不该在
    版本历史里占一格（这是主动的覆盖，不是把用户没同意的改动悄悄吞掉）。
    只改 pages_json.pages[page_id] 这一个键，model_json、其余页面原样不动。

    只能改**已经存在**的页面 id——这条路径不负责凭空造出一个新页面（没有
    model.page.pages 那一侧的对应条目，会立刻破坏「页面包的键 == 模型页面 id」
    那条不变式，见 page_id_freeze.pages_match_model）。要新增页面得走真正的
    推演，不是手动拼一个 pages_json 键。
    """
    backend = get_backend()
    rec = backend.get(app_id)
    if rec is None:
        return None
    pages_json = rec.get("pages_json")
    if not isinstance(pages_json, dict) or not isinstance(pages_json.get("pages"), dict):
        raise ValueError("no_pages")
    if page_id not in pages_json["pages"]:
        raise ValueError("page_not_found")
    pages_json = {**pages_json, "pages": {**pages_json["pages"], page_id: html}}
    rec = {**rec, "pages_json": pages_json}
    backend.save(rec)
    return rec


def list_versions(root_id: str) -> list[dict[str, Any]]:
    return _mark_previews(get_backend().versions(root_id))


def delete_app(app_id: str) -> bool:
    """从画廊下架一个应用。返回是否真删到（不存在返回 False）。

    ⚠ 2026-08-21：画廊 ``latest_per_root`` 一张卡 = 整条血缘。删卡却只
    ``delete where id=最新版``，v3 没了会话也跟着没了，刷新 ``list_apps``
    把 v2 顶上来——用户看见「我的应用还在」。存储层 ``delete(id)`` 仍是
    单行原语；这里按 root 把同血缘版本和各自缩略图一起清。Fork 是新
    root，不会误伤源应用。

    绑定会话由路由在删卡之后另删（对照 GitHub：删仓库会清 Codespace；
    存储层不跨表级联，避免 JSON/SQLite/Neon 三条后端各写一份）。
    """
    backend = get_backend()
    rec = backend.get(app_id)
    if rec is None:
        return False
    root = str(rec.get("root_id") or rec.get("id") or app_id)
    ids = backend.ids_for_root(root)
    if app_id not in ids:
        ids.append(app_id)
    deleted = False
    for vid in ids:
        if backend.delete(vid):
            deleted = True
    return deleted


def bind_session(app_id: str, session_id: Optional[str]) -> Optional[dict[str, Any]]:
    """把工作区绑到这张卡上。``session_id`` 空 = 解开。"""
    backend = get_backend()
    rec = backend.get(app_id)
    if rec is None:
        return None
    rec["session_id"] = (session_id or "")[:64] or None
    backend.save(rec)
    return rec


def unbind_session(session_id: str) -> int:
    """删工作区之后，仓库不许再指向那台已经没了的机器。

    对照 GitHub Codespaces：删 Codespace 不删仓库，但再点仓库不会跳进
    已经 404 的那台。``app.session_id`` 就是存错了的「当前 Codespace id」，
    会话一删必须摘掉，否则点卡进死会话（2026-08-20）。

    用现成的 find_latest_by_session + save，三条后端不用各加方法。
    同 session 挂了多条版本时循环摘干净。
    """
    sid = str(session_id or "").strip()
    if not sid:
        return 0
    backend = get_backend()
    n = 0
    while n < 64:
        rec = backend.find_latest_by_session(sid)
        if not rec:
            return n
        rec["session_id"] = None
        backend.save(rec)
        n += 1
    return n


def export_all() -> list[dict[str, Any]]:
    """导出全部记录（备份/迁移用）——无论后端在哪，手上永远有一份可迁移真数据。"""
    return get_backend().export_all()
