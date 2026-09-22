"""E37：闭环重建 fail-closed 兜底（回合结束后 publishClosure 永不为 null）。

用户实测 bug：非演示域推演 19 步"正常完成"，右侧却是一块空看板——闭环
重建环节炸掉（或被空指令早退跳过）时只记 error run、不落闭环产物，
derive_publish_closure_response 返回 None，客户端拿不到任何 blocked 语义。
这里锁两件事：
  1. 闭环重建能力抛异常 → 仍落一个确定性 blocked 闭环（blocker 带真实
     失败原因 CLOSURE_REBUILD_FAILED），fail-closed 而非 fail-silent；
  2. user_instruction 为空但 goal 在场 → 不再静默跳过，照常收口。
"""

from models.v5_state import V5SessionState
from services.v5_full_driver import _ensure_runtime_closure_evidence
from services.v5_publish_closure_response import derive_publish_closure_response


def _state(goal: str, session_id: str) -> V5SessionState:
    return V5SessionState(sessionId=session_id, goal={"text": goal, "status": "needs_refinement"})


def test_executor_crash_yields_blocked_closure_not_null(monkeypatch):
    import services.v5_full_driver as driver

    def _boom(*_args, **_kwargs):
        raise RuntimeError("provider exploded mid-closure")

    monkeypatch.setattr(driver, "execute_v5_capability", _boom)
    state = _state("古风漫剧风单词助手", "t-e37-crash")
    state = _ensure_runtime_closure_evidence(state, "古风漫剧风单词助手", 3)

    closure = derive_publish_closure_response(state)
    assert closure is not None, "闭环重建炸掉后 publishClosure 不允许为 null"
    assert closure["blocked"] is True
    assert closure["evidencePresentCount"] == 0
    codes = {b["code"] for b in closure["topBlockers"]}
    assert "CLOSURE_REBUILD_FAILED" in codes
    rebuild = next(b for b in closure["topBlockers"] if b["code"] == "CLOSURE_REBUILD_FAILED")
    assert "provider exploded" in rebuild["ref"]
    # error run 本身仍如实留档（兜底不遮蔽原始错误）
    err_runs = [
        r for r in state.capabilityRuns
        if (r.get("error") if isinstance(r, dict) else getattr(r, "error", None))
    ]
    assert err_runs, "capability 执行失败必须留 error run"


def test_empty_instruction_falls_back_to_goal(monkeypatch):
    """演示域 + 空指令：此前静默跳过闭环（回合完成却无闭环），现在回落
    goal 原文照常收口——确定性域走冻结夹具，零 LLM。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    # 这条测的是"空指令回落 goal 原文"，用夹具只是取一条零 LLM 的确定性
    # 收口路径。夹具快路径 2026-08-10 起默认关，显式开回来。
    monkeypatch.setenv("SLIDERULE_DEMO_FIXTURE_ENABLED", "1")
    state = _state("采购审批平台", "t-e37-empty-instr")
    state = _ensure_runtime_closure_evidence(state, "", 1)

    closure = derive_publish_closure_response(state)
    assert closure is not None, "空指令不应再静默跳过闭环重建"
    assert closure["blocked"] is False, closure["topBlockers"]
    assert closure["evidencePresentCount"] == 6


def test_no_goal_no_instruction_still_skips():
    """goal 与指令都为空 → 无话题可收口，保持跳过（不硬造闭环）。"""
    state = _state("", "t-e37-nothing")
    state = _ensure_runtime_closure_evidence(state, "", 1)
    assert derive_publish_closure_response(state) is None
