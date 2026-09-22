"""
Port of Node's session-driver.ts and mini-session.ts.

⚠ 2026-08-27：drive_v5_full_path 定义点一处、产品路由调用点零。
产品新烧走 POST /control-turn-stream → rehearsal_control → 信封
start_drive_full_factory_run → drive_full_v5_session_stream。
本函数不是产品控制面，禁止再 import 进 sliderule_full 当驱动器——
那是不通电的插座（编码 Agent 那套「再包一层 session-driver」DNA）。
G_READY / G_CONFIRM 活在 /drive-turn（drive_reasoning_turn），
不是本函数，也不是产品流；/drive-turn 是脚本/评测插座，保留。
"""

from models.v5_state import V5SessionState
from .slide_rule_orchestrator import orchestrate_plan
from .v5_capability_executor import execute_v5_capability
from .persistence import persist_state

def drive_v5_full_path(state: V5SessionState, turn_id: str, user_text: str) -> V5SessionState:
    plan = orchestrate_plan(state, turn_id, user_text)
    state.conversation.append({"role": "system", "text": plan.rationale, "turnId": turn_id})

    for sel in plan.selected:
        cap = sel["capabilityId"]
        role = sel.get("roleId", "agent")
        result = execute_v5_capability(cap, state, [], role, turn_id)
        # Create artifact with real evidence
        art_id = f"{turn_id}-{cap}-art"
        state.artifacts.append({
            "id": art_id,
            "kind": "evidence" if "evidence" in cap or "mcp" in cap or "skill" in cap else "report",
            "provenance": "python-rag",
            "trustLevel": "gated_pass",
            "content": result.content,
            "summary": result.summary,
            "producedBy": {"capabilityRunId": f"run-{turn_id}-{cap}", "capabilityId": cap, "roleId": role},
            "sources": result.sources
        })
        state.capabilityRuns.append({
            "id": f"run-{turn_id}-{cap}",
            "capabilityId": cap,
            "turnId": turn_id,
            "outputs": [art_id],
            "gateResults": [{"gateId": "ground", "status": "passed"}],
            "result": result.model_dump()
        })

    persist_state(state)
    return state
