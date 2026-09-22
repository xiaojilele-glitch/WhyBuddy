"""Factory envelope helper — the only ignition socket for product rehearsals.

⚠ 2026-08-27 从 routes/sliderule_full.py::drive_full_stream 抽出（本 worktree
约 1227–1334，不是设计文档里的旧行号）。抽之前用 grep 确认活路径：
persist-as-authority load_session、set_installed_skills / set_active_connectors /
set_preferred_device_override / set_design_system_override（finally 清空）、
E25 run_registry.start_run、E26 transient_blocked 自动补救恰好一次、
on_complete save_session。

命名字段。helper 不得再解析两套 HTTP payload 形状。
产品路径缺 session_id → 400，没有 anon- 回落。
脚本方言 /drive-full-stream 可 require_session_id=False + fallback_state。

内部 async-for drive_full_v5_session_stream(..., profile=)。
profile="app" 由 rehearse 传入；生成器消费短清单。禁止 HTTP factoryProfile。
控制面 rehearsal_control 只许调本 helper，不许直接调生成器。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from fastapi import HTTPException
from pydantic import ValidationError

from models.v5_state import V5SessionState
from services import app_access
from services.persistence import _checkpoint_dir, _safe_ckpt_token
from services.scope_authority import preferred_device_for_run, plan_execution_authorized, latest_control_plan, approved_plan_instruction
from services.slide_rule_session import load_session, save_session
from services.sliderule_session_sanitizer import sanitize_session_state
from services.v5_full_driver import (
    _stamp_factory_tools_onto_goal,
    drive_full_v5_session_stream,
    transient_blocked_signal,
)
from services.workflow_journal import Journal, journal_scope


def _workflow_journal_path(session_id: str) -> Path:
    """会话级 jsonl。跟 checkpoint 同一目录，中断续跑才能找到。"""
    sid = str(session_id or "").strip()
    if not sid:
        return Path("workflow-journal.jsonl")
    return _checkpoint_dir() / _safe_ckpt_token(sid) / "workflow-journal.jsonl"


def _adopt_owner(state: V5SessionState, viewer: Any) -> V5SessionState:
    if getattr(state, "ownerId", None):
        return state
    owner = str(getattr(viewer, "id", "") or "").strip()
    if owner:
        state.ownerId = owner
    return state


async def start_drive_full_factory_run(
    session_id: str,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    *,
    repair: bool = False,
    profile: Literal["full", "app"] = "full",
    max_loops: int = 10,
    require_session_id: bool = True,
    fallback_state: Optional[Dict[str, Any]] = None,
    viewer: Any = None,
    expected_owner_id: Optional[str] = None,
    reuse_charter: Any = None,
    product_charter: Any = None,
    goal_tools: Optional[Any] = None,
):
    """启动（或附着）一条工厂 run。调用方传入已经拆好的命名字段。

    goal_tools：控制面已经挑好的这一跳。persist-as-authority 会 reload，
    同一 lastTurnId 改 goal.tools 会被守卫挡住（2026-09-02 真机：确认继续
    forced pages，落盘仍是上一跳 spec，工厂又起草一遍 SPEC）。
    """
    from services import run_registry
    from services.device_policy import set_preferred_device_override
    from services.identity_palette_hint import set_design_system_override
    from services.v5_llm_generate import (
        clarifications_from_state,
        set_active_connectors,
        set_clarifications,
        set_approved_plan,
        set_installed_skills,
    )

    sid = str(session_id or "").strip()
    if require_session_id and not sid:
        raise HTTPException(status_code=400, detail="session_id required")

    persisted = await asyncio.to_thread(load_session, sid) if sid else None
    if expected_owner_id is not None and (
        persisted is None or persisted.ownerId != expected_owner_id
    ):
        raise HTTPException(status_code=404, detail="Not found")
    if persisted is not None:
        # A later authorization reload may share the session cache object.
        # Keep the already stamped hop isolated from that read.
        state = persisted.model_copy(deep=True)
        if viewer is not None and not app_access.can_session("drive", state.model_dump(), viewer):
            raise HTTPException(status_code=404, detail="Not found")
        if state.runtimeKind == "project":
            raise HTTPException(status_code=409, detail="project_html_factory_not_supported")
        if not plan_execution_authorized(state):
            raise HTTPException(status_code=409, detail="plan_approval_required")
        wanted = [
            str(item).strip()
            for item in (goal_tools or [])
            if str(item).strip()
        ]
        if wanted:
            # ⚠ 必须在 `_advance_turn_version` / persist 之前盖上。否则
            #   reload 到的上一跳 spec 会被新 lastTurnId 钉死，pages 跳再
            #   也盖不回去。
            #
            # ⚠ 2026-09-03 真机（团子的一天）：这里只写 tools，productSteps
            #   还停在上一跳的 [2]。钟读的是步集，不是工具名——structure
            #   跳 tools 对了、格子仍亮「起草 SPEC」。跟控制面同一把章。
            _stamp_factory_tools_onto_goal(state, wanted)
    elif require_session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    else:
        raise HTTPException(status_code=409, detail="plan_approval_required")

    approved_plan = dict(latest_control_plan(state))
    plan_content = str(approved_plan["planContent"])
    execution_instruction = approved_plan_instruction(state, user_text)

    async def stream_factory():
        from services.product_charter import (
            activate_charter_for_run,
            clear_charter_for_run,
        )

        fresh = await asyncio.to_thread(load_session, sid)
        if fresh is not None and fresh.runtimeKind == "project":
            raise HTTPException(status_code=409, detail="project_html_factory_not_supported")
        if (
            fresh is None or fresh.ownerId != state.ownerId
            or not plan_execution_authorized(fresh)
            or latest_control_plan(fresh) != approved_plan
        ):
            raise HTTPException(status_code=409, detail="plan_approval_required")
        set_installed_skills(installed_skills)
        set_active_connectors(active_connectors)
        # 开工前用户答过的澄清 → 生成提示词的硬约束。**从持久化状态里取**，
        # 不从 HTTP 载荷取：答案是控制面写在 coverageGaps 上的，客户端再传一遍
        # 就是同一件事两处来源（本仓第四条），迟早对不上。
        set_clarifications(clarifications_from_state(state))
        # 设备跟澄清同一口径：goal 上的授予是权威。HTTP 里的 desktop
        # 经常是作曲家默认，不是新的 Permission{decision}。
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        run_device = preferred_device_for_run(
            goal=goal,
            payload_device=preferred_device,
            texts=[plan_content, user_text, str(goal.get("text") or "")],
        )
        set_preferred_device_override(run_device)
        set_design_system_override(design_system_id)
        # 命名字段跟技能/连接器同一形状。传 None 的键等于「信封没带」，
        # 走 state / 账户 reuse_next，不许编成显式 false。
        charter_payload: Dict[str, Any] = {}
        if reuse_charter is not None:
            charter_payload["reuseCharter"] = reuse_charter
        if product_charter is not None:
            charter_payload["productCharter"] = product_charter
        activate_charter_for_run(state, charter_payload)
        journal = Journal.load(_workflow_journal_path(sid)) if sid else Journal()
        try:
            set_approved_plan(plan_content)
            with journal_scope(journal):
                async for event in drive_full_v5_session_stream(
                    state,
                    max_loops=max_loops,
                    user_instruction=execution_instruction,
                    repair=repair,
                    profile=profile,
                ):
                    if (
                        event.get("type") == "complete"
                        and not repair
                        and transient_blocked_signal(state)
                    ):
                        async for repair_event in drive_full_v5_session_stream(
                            state,
                            max_loops=2,
                            user_instruction=execution_instruction,
                            repair=True,
                            profile=profile,
                        ):
                            yield repair_event
                        return
                    yield event
        finally:
            set_installed_skills(None)
            set_active_connectors(None)
            set_clarifications(None)
            set_approved_plan(None)
            set_preferred_device_override(None)
            set_design_system_override(None)
            clear_charter_for_run()

    async def on_complete(event: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(event.get("state"), dict):
            final_state = V5SessionState.server_load(event["state"])
            final_state, _ = sanitize_session_state(final_state)
            final_state = await asyncio.to_thread(save_session, final_state)
            return {**event, "state": final_state.model_dump()}
        return event

    try:
        return await run_registry.start_run(
            sid or f"anon-{id(state)}",
            stream_factory,
            on_complete,
            user_text=user_text,
            owner_id=state.ownerId,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
