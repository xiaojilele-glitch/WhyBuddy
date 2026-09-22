"""产品宪章 —— 用户自己的行业约束，opt-in 才进推演。

## 为什么有这个文件

WhyBuddy 仓里的 Claude.md / AGENTS.md 是**引擎建造者**的纪律，不是用户
这场推演的先验。2026-08 设计把「跨场记忆」写成 opt-in 产品宪章，就是为了
挡住两种会静默污染用户应用的做法：

  1. 把建造者文档当 system 提示词喂进去（用户的烘焙工坊变成面团自己的
     工程约束）。
  2. 把上一场的五系统模型当 priors 自动灌进下一场（悬空引用、错公司
     RBAC，闸还可能假绿）。

宪章是**约束，不是证据**。缺证据仍是缺；宪章文本不得绕过 `v5_model_gate`，
也不得当成闭环证据。

## 三条硬约束

1. **默认不注入。** `charter_prompt_block()` 在 opt-in 关着时必须返回空串，
   让 spec-first 的 prompt 跟从前逐字节一致。没有勾「下一场沿用」就灌，
   等于自动沿用——正是这条产品判断要消灭的。
2. **只认白名单字段。** industry / terms / defaultRoles / hardCompliance /
   brandConstraints。其余键（尤其 datamodel / rbac / workflow / page /
   aigc / appbundle）一律丢掉。塞进五系统模型不得变成 priors。
3. **persist fail-open，inject fail-closed。** 存失败不许拖垮推演；读不到
   或没打旗，就当没有宪章，不许编一份。

## 这个文件只剩「存取」那一半（2026-08-29）

白名单清洗 / 两个 ContextVar / `charter_prompt_block()` 已搬到叶子
`services.turn_context`（下面按老路径 re-export，调用方不用改）。搬的理由见
那边模块头：`spec_tree` 要拼宪章块，而这个文件属 drive 组、本身又被 drive 调，
`spec_first -> drive` 这条边一口气把三个组间环连在一起。
上面三条硬约束里第 1、2 条现在钉在 turn_context，第 3 条的 persist 半边在这里。

注入点必须是 spec-first / scope_card 真正读上下文的地方
（`spec_tree.build_spec_prompt`、`rehearsal_control._system_prompt`）。
只接在 `v5_llm_generate._build_user_content` 上等于接在不通电的插座——
默认生成路径是 spec-first。
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from . import env_flags as _env_flags

# 请求域那一半（白名单清洗 + 两个 ContextVar + prompt 块）在叶子 turn_context。
# 2026-08-29 搬走的：`spec_tree.build_spec_prompt` 要拼宪章块，而这个文件属
# drive 组、本身又是被 drive 调的，`spec_first -> drive` 这条边一口气把三个
# 组间环连在一起。存取这一半（CharterStore 要查 identity_store）留在这里。
#
# ⚠ 下面这些名字**必须只有一份**。谁哪天在这个文件里"顺手"重新定义
#   `_charter_var` / `_opt_in_var`，set 写 A、get 读 B，宪章就**安静地不进
#   prompt 了**——不报错、不告警，只是用户勾了「下一场沿用」却没生效。
#   判据：tests/test_turn_context_leaf.py::Test宪章读写的是同一个ContextVar
from .turn_context import (  # noqa: F401  （下游按老路径 import，保持可用）
    CHARTER_FIELDS,
    CHARTER_MARKER,
    _FIVE_SYSTEM_KEYS,
    charter_has_content,
    charter_prompt_block,
    clear_charter_for_run,
    normalize_charter,
    set_charter_context,
)

TABLE = "sliderule_product_charter"

_DDL_PG = f"""
create table if not exists {TABLE} (
    scope varchar(16) not null,
    scope_id varchar(80) not null,
    charter_json jsonb,
    reuse_next boolean,
    updated_at timestamptz,
    primary key (scope, scope_id)
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    scope varchar(16) not null,
    scope_id varchar(80) not null,
    charter_json text,
    reuse_next integer,
    updated_at timestamp,
    primary key (scope, scope_id)
)
"""

_store_lock = threading.Lock()
_store: Any = None
_store_ident: Any = None
# persist 失败时的进程内回落。不是第二套库——只是 fail-open 的缓冲。
_MEM: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def factory_charter_kwargs(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """HTTP / 控制面信封 → 工厂命名字段。

    缺键就不要带 `reuse_charter`。带了 `False` 会被当成显式关旗，
    把账户「下一场沿用」清掉——正是 opt-in 这条要消灭的。
    """
    payload = payload if isinstance(payload, dict) else {}
    out: Dict[str, Any] = {}
    if "reuseCharter" in payload or "reuse_charter" in payload:
        flag = payload.get("reuseCharter")
        if flag is None:
            flag = payload.get("reuse_charter")
        out["reuse_charter"] = flag
    charter = payload.get("productCharter") or payload.get("product_charter")
    if charter:
        out["product_charter"] = charter
    return out


def _as_bool(raw: Any) -> Optional[bool]:
    if raw is True or raw is False:
        return raw
    if isinstance(raw, (int, float)) and raw in (0, 1):
        return bool(raw)
    if isinstance(raw, str):
        s = raw.strip().lower()
        # ⚠ 这里是**三态**（None = 没表态），跟 env_flags.parse 的两态不同，
        #   所以只共用词表、不共用函数。
        if s in _env_flags.ON:
            return True
        if s in _env_flags.OFF:
            return False
    return None


class CharterStore:
    """跟 component_preset_store 同一条执行器，不另开数据库。"""

    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._is_sqlite = is_sqlite
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)

    def upsert(
        self, *, scope: str, scope_id: str, charter: Dict[str, str], reuse_next: bool
    ) -> None:
        p = self._x.ph
        payload = json.dumps(charter, ensure_ascii=False)
        flag: Any = (1 if reuse_next else 0) if self._is_sqlite else bool(reuse_next)
        # Keep replacement atomic. The SQL executor commits each execute;
        # DELETE followed by INSERT could lose the prior charter on a failed
        # second statement.
        self._x.execute(
            f"insert into {TABLE} (scope, scope_id, charter_json, reuse_next, updated_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)},{p(5)})"
            f" on conflict (scope, scope_id) do update set"
            f" charter_json = excluded.charter_json, reuse_next = excluded.reuse_next,"
            f" updated_at = excluded.updated_at",
            [scope, scope_id[:80], payload, flag, _now_iso()],
        )

    def load(self, *, scope: str, scope_id: str) -> Dict[str, Any]:
        p = self._x.ph
        rows = self._x.query(
            f"select charter_json, reuse_next from {TABLE}"
            f" where scope = {p(1)} and scope_id = {p(2)}",
            [scope, scope_id[:80]],
        )
        if not rows:
            return {}
        row = rows[0]
        raw = row.get("charter_json")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}
        return {
            "charter": normalize_charter(raw),
            "reuse_next": bool(row.get("reuse_next")),
        }


def get_charter_store() -> Optional[CharterStore]:
    global _store, _store_ident
    try:
        from .identity_store import get_identity_store

        ident = get_identity_store()
    except Exception:  # noqa: BLE001 — persist fail-open
        return None
    with _store_lock:
        if _store is not None and _store_ident is ident:
            return _store
        try:
            _store = CharterStore(ident._x, is_sqlite=ident._is_sqlite)
            _store_ident = ident
            return _store
        except Exception:  # noqa: BLE001
            _store = None
            _store_ident = None
            return None


def reset_charter_cache() -> None:
    """测试用。连同进程内回落一起清。"""
    global _store, _store_ident
    with _store_lock:
        _store = None
        _store_ident = None
    _MEM.clear()
    clear_charter_for_run()


def _mem_key(scope: str, scope_id: str) -> Tuple[str, str]:
    return (str(scope or ""), str(scope_id or "")[:80])


def save_charter(
    *, scope: str, scope_id: str, charter: Dict[str, str], reuse_next: bool
) -> None:
    if not scope_id:
        return
    cleaned = normalize_charter(charter)
    record = {"charter": cleaned, "reuse_next": bool(reuse_next)}
    _MEM[_mem_key(scope, scope_id)] = record
    store = get_charter_store()
    if store is None:
        return
    try:
        store.upsert(
            scope=scope, scope_id=scope_id, charter=cleaned, reuse_next=bool(reuse_next)
        )
    except Exception as exc:  # noqa: BLE001 — persist fail-open
        print(f"[charter] persist failed: {type(exc).__name__}", flush=True)


def load_charter(*, scope: str, scope_id: str) -> Dict[str, Any]:
    if not scope_id:
        return {}
    store = get_charter_store()
    if store is not None:
        try:
            found = store.load(scope=scope, scope_id=scope_id)
            if found:
                return found
        except Exception:  # noqa: BLE001 — inject fail-closed on this channel
            pass
    return dict(_MEM.get(_mem_key(scope, scope_id)) or {})


def _write_state(state: Any, charter: Dict[str, str], opt_in: bool) -> None:
    if state is None:
        return
    try:
        state.productCharter = charter or None
        state.charterReuseNext = bool(opt_in)
    except Exception:  # noqa: BLE001 — 老 state 形状不认这两个字段时别拖垮
        pass


def activate_charter_for_run(state: Any, payload: Optional[Dict[str, Any]] = None) -> None:
    """读 payload / 会话 / 账户，决定本轮要不要把宪章送进 prompt。

    ⚠ 没有 opt-in 旗（payload.reuseCharter / state.charterReuseNext /
      账户 reuse_next）就注入，等于自动沿用上一场——测试必须咬住这条。
    """
    payload = payload if isinstance(payload, dict) else {}
    session_id = str(getattr(state, "sessionId", "") or payload.get("sessionId") or "").strip()
    owner_id = str(getattr(state, "ownerId", "") or payload.get("ownerId") or "").strip()

    incoming = normalize_charter(
        payload.get("productCharter") or payload.get("product_charter")
    )
    if not incoming:
        incoming = normalize_charter(getattr(state, "productCharter", None))

    stored_session = load_charter(scope="session", scope_id=session_id)
    stored_account = (
        load_charter(scope="account", scope_id=owner_id) if owner_id else {}
    )

    explicit = _as_bool(payload.get("reuseCharter"))
    if explicit is None:
        explicit = _as_bool(payload.get("reuse_charter"))

    if explicit is None:
        opt_in = bool(getattr(state, "charterReuseNext", False))
        if not opt_in:
            # 「下一场沿用」落在账户 reuse_next 上。这是旗，不是「库里有文档」。
            opt_in = bool((stored_account or {}).get("reuse_next"))
    else:
        opt_in = explicit

    if not incoming:
        if opt_in:
            incoming = normalize_charter(
                (stored_session or {}).get("charter")
            ) or normalize_charter((stored_account or {}).get("charter"))
        else:
            incoming = normalize_charter((stored_session or {}).get("charter"))

    if incoming and session_id:
        save_charter(
            scope="session",
            scope_id=session_id,
            charter=incoming,
            reuse_next=opt_in,
        )
    if explicit is not None and owner_id:
        # 只在确认按钮带了 reuseCharter 时改账户旗。其它回合缺字段不得把
        # 「下一场沿用」清掉——否则一次问候就把跨场记忆抹了。
        account_charter = incoming or normalize_charter(
            (stored_account or {}).get("charter")
        )
        save_charter(
            scope="account",
            scope_id=owner_id,
            charter=account_charter,
            reuse_next=opt_in,
        )

    _write_state(state, incoming, opt_in)
    set_charter_context(incoming, opt_in=opt_in)
