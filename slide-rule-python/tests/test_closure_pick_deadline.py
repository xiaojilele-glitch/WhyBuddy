from models.v5_state import V5SessionState
from services.v5_full_driver import ensure_closure_pick_by_deadline


def _state():
    return V5SessionState(
        sessionId="closure-deadline",
        goal={"text": "生成巡检闭环应用", "status": "needs_refinement"},
        runtimePhase="orchestrating",
    )


def test_second_loop_forces_first_closure_into_the_same_parallel_batch():
    picks = [
        {"capabilityId": "evidence.search", "roleId": "综合"},
        {"capabilityId": "synthesis.merge", "roleId": "综合"},
    ]
    result = ensure_closure_pick_by_deadline(_state(), picks, loop_index=1, repair=False)
    assert [item["capabilityId"] for item in result] == [
        "evidence.search",
        "synthesis.merge",
        "appbundle.runtimeClosure",
    ]


def test_closure_deadline_does_not_fire_on_foundation_loop_or_during_repair():
    picks = [{"capabilityId": "evidence.search", "roleId": "综合"}]
    assert ensure_closure_pick_by_deadline(_state(), picks, loop_index=0, repair=False) == picks
    assert ensure_closure_pick_by_deadline(_state(), picks, loop_index=1, repair=True) == picks


def test_closure_deadline_never_duplicates_an_existing_closure_pick():
    picks = [{"capabilityId": "appbundle.runtimeclosure", "roleId": "综合"}]
    result = ensure_closure_pick_by_deadline(_state(), picks, loop_index=4, repair=False)
    assert result == picks


def test_historical_closure_run_does_not_block_a_new_turn_deadline():
    state = _state()
    state.capabilityRuns = [
        {
            "id": "closure-run",
            "capabilityId": "appbundle.runtimeclosure",
            "turnId": "loop-2",
            "status": "failed",
            "outputs": [],
        }
    ]
    picks = [{"capabilityId": "risk.analyze", "roleId": "综合"}]
    result = ensure_closure_pick_by_deadline(state, picks, loop_index=3, repair=False)
    assert [item["capabilityId"] for item in result] == [
        "risk.analyze",
        "appbundle.runtimeClosure",
    ]


def test_closure_deadline_never_retries_after_this_drive_already_attempted_it():
    picks = [{"capabilityId": "risk.analyze", "roleId": "综合"}]
    result = ensure_closure_pick_by_deadline(
        _state(),
        picks,
        loop_index=3,
        repair=False,
        closure_attempted=True,
    )
    assert result == picks
