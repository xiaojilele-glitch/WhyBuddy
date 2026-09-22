# -*- coding: utf-8 -*-
"""从应用快照建工作区会话。

对照 GitHub Codespaces：仓库（应用卡）是本体，Codespace（会话）是一次性
工作区。仓库还在、工作区没了，从仓库再开一台——**不是 fork**，不新开应用。

实现抄本仓 fork 已经跑通的那条（routes/sliderule_full._init_fork_session）：
模型直供重建闭环，``suppress_web_search``，零 LLM。再把 ``pages_json``
写进 ``state.specFirstPages``——不写的话工作台只有模型没有页，点进去像空的。
"""

from __future__ import annotations

import copy
from typing import Any, Optional


def init_working_session_from_app(
    record: dict[str, Any],
    *,
    session_id: str,
    owner_id: Optional[str],
    note: str,
) -> Optional[str]:
    """把应用快照灌进一条新会话并落盘。失败返回错误串，成功返回 None。

    即使闭环证据重建失败，仍然把带页面的会话存下来——否则卡上绑着一个
    打不开的 id，又回到「点卡 404」。
    """
    from models.v5_state import V5SessionState
    from services.mcp_tools import suppress_web_search
    from services.slide_rule_session import save_session
    from services.v5_full_driver import (
        _ensure_runtime_closure_evidence,
        record_model_version,
    )
    from services.v5_llm_generate import set_model_override, set_refine_context
    from services.v5_publish_closure_response import derive_publish_closure_response
    from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response

    model = record.get("model_json") or {}
    pages = record.get("pages_json")
    goal_text = str(record.get("goal") or note or "应用")
    app_id = str(record.get("id") or "")
    err: Optional[str] = None

    state = V5SessionState(
        sessionId=session_id,
        goal={"text": goal_text, "status": "clear", "inherited": True},
        ownerId=owner_id,
    )
    state.runtimePhase = "done"
    if isinstance(pages, dict) and pages.get("pages"):
        state.specFirstPages = copy.deepcopy(pages)

    set_model_override(model)
    set_refine_context(model, note)
    try:
        try:
            with suppress_web_search():
                state = _ensure_runtime_closure_evidence(
                    state, f"reopen:{app_id}", 0
                )
        except Exception as exc:  # noqa: BLE001 — 证据是增强，不许拖垮工作区
            err = str(exc)[:200]
            print(f"[app_working_session] closure init failed: {err}")
        if getattr(state, "specFirstPages", None) is None and isinstance(pages, dict) and pages.get("pages"):
            # 证据重建若把页面冲掉，再盖回去。工作区必须能看见成品。
            state.specFirstPages = copy.deepcopy(pages)
        closure = derive_publish_closure_response(state)
        if closure is not None:
            state.publishClosure = closure
            state.skillRuntimeGraph = derive_skill_runtime_graph_response(state)
            record_model_version(state, closure, note)
        save_session(state)
    finally:
        set_model_override(None)
        set_refine_context(None)
    return err
