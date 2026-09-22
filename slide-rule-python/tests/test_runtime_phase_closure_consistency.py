# -*- coding: utf-8 -*-

from models.v5_state import V5SessionState


def _state(status="clear"):
    return V5SessionState(sessionId="phase-test", goal={"text": "门店巡检", "status": status})


def test_goal_clear_but_closure_blocked_must_not_be_done():
    from services import v5_full_driver as driver

    decide = getattr(driver, "terminal_phase_decision", None)
    assert callable(decide), "最终 phase 仍没有读取 publishClosure.blocked"

    phase, reason = decide(
        _state(),
        {"passed": True},
        {"blocked": True, "topBlockers": [{"code": "CLOSURE_GOAL_RELEVANCE_FAILED"}]},
    )
    assert phase == "awaiting"
    assert reason == "closure_blocked"


def test_non_blocked_closure_and_passed_gate_is_done():
    from services.v5_full_driver import terminal_phase_decision

    phase, reason = terminal_phase_decision(
        _state(), {"passed": True}, {"blocked": False}
    )
    assert phase == "done"
    assert reason is None


def test_missing_closure_is_fail_closed():
    from services.v5_full_driver import terminal_phase_decision

    phase, reason = terminal_phase_decision(_state(), {"passed": True}, None)
    assert phase == "awaiting"
    assert reason == "closure_missing"


def test_terminal_closure_reason_can_be_written_to_session_state():
    from services.v5_full_driver import apply_terminal_phase_decision

    state = _state()
    apply_terminal_phase_decision(
        state,
        {"passed": True},
        {"blocked": True, "topBlockers": [{"code": "CLOSURE_GOAL_RELEVANCE_FAILED"}]},
    )

    assert state.runtimePhase == "awaiting"
    assert state.awaitReason == "closure_blocked"
