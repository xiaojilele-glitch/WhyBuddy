"""The real SPEC driver returns its saved decisions to the generic questionnaire.

Mutations that remove the pipeline stop or either driver handback must fail:
downstream generation is observable, and no run pause is released by this test.
"""
from __future__ import annotations

import asyncio

import pytest

from control_turn_support import ControlHarness, new_sid, seed_approved_session, six_fields
from services import spec_first_pipeline as pipeline
from services.slide_rule_session import load_session
from test_spec_assumptions_stream import GOAL, ROWS, _MIN_SPEC


@pytest.fixture
def spec_pipeline(monkeypatch):
    from services import design_language, spec_tree

    calls = []
    monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda *a, **k: {**_MIN_SPEC, "assumptions": ROWS})

    def design(*args, **kwargs):
        calls.append("design")
        raise AssertionError("generation crossed unanswered SPEC decisions")

    monkeypatch.setattr(design_language, "generate_style_brief", design)
    return calls


def test_pipeline_stops_without_a_sink_or_pause_slot(spec_pipeline):
    from services import run_pause

    slot = run_pause.new_slot()
    run_pause.bind(slot)
    try:
        result = pipeline.run_spec_first(GOAL, tools=["spec", "pages", "structure", "bind"])
    finally:
        run_pause.bind(None)
    assert spec_pipeline == []
    assert result["stages"]["assumptionsHeld"]["count"] == len(ROWS)
    assert result["pages"] == {}
    assert slot.pending is None and slot.active is None
    saved = pipeline.take_last_pages()
    assert saved["spec"]["assumptions"] == ROWS
    assert saved["assumptionsConfirmed"] is False


def test_real_driver_hands_saved_spec_to_control_questionnaire(monkeypatch, spec_pipeline):
    from services import drive_full_factory as factory, run_pause, v5_capability_executor as executor, v5_full_driver as driver

    harness = ControlHarness(monkeypatch, live_factory=True)
    monkeypatch.setattr(factory, "drive_full_v5_session_stream", driver.drive_full_v5_session_stream)
    executions = []
    forbidden_calls = []

    def execute(capability, state, role, turn_id):
        executions.append(capability)
        pipeline.run_spec_first(GOAL, tools=["spec", "pages", "structure", "bind"])
        executor._cache_spec_first_pages(state)
        return {"summary": "SPEC saved", "content": "SPEC", "provenance": "python-llm"}

    def forbidden(*args, **kwargs):
        forbidden_calls.append(args)
        raise AssertionError("unanswered SPEC must return without pause/closure work")

    monkeypatch.setattr(driver, "_execute_round_capability", execute)
    monkeypatch.setattr(driver, "_ensure_runtime_closure_evidence", forbidden)
    monkeypatch.setattr(run_pause.PauseGate, "wait", forbidden)
    sid = new_sid("spec-questionnaire")
    seed_approved_session(sid, goal={"text": GOAL, "status": "clear"})
    _, events = harness.post(six_fields(sid, "继续", forcedTool="spec"))
    assert executions == ["factory.spec"]
    assert forbidden_calls == []
    assert spec_pipeline == []
    assert harness.llm_calls == []
    kinds = [e["type"] for e in events]
    assert "factory_complete" in kinds
    assert "spec_assumption" not in kinds and "run_pause_started" not in kinds
    question = next(e for e in events if e["type"] == "control_ask_user")
    assert [q["id"] for q in question["questions"]] == [r["id"] for r in ROWS]
    state = load_session(sid)
    assert state.awaitReason == "control_ask"
    assert state.specFirstPages["spec"]["assumptions"] == ROWS
    assert state.specFirstPages["pages"] == {}
    assert state.controlTranscript[-1]["reqId"] == question["reqId"]
    assert kinds[-1] == "complete"


@pytest.mark.parametrize("stream", [False, True])
def test_both_drivers_stop_existing_unanswered_spec(monkeypatch, stream):
    from services import v5_full_driver as driver

    sid = new_sid("pending-decisions")
    state = seed_approved_session(sid, goal={"text": GOAL, "status": "clear"}, specFirstPages={"spec": {**_MIN_SPEC, "assumptions": ROWS}, "pages": {}})
    calls = []
    monkeypatch.setattr(driver, "_execute_round_capability", lambda *a, **k: calls.append("execute"))
    monkeypatch.setattr(driver, "_ensure_runtime_closure_evidence", lambda *a, **k: calls.append("closure"))
    if stream:
        async def collect():
            return [e async for e in driver.drive_full_v5_session_stream(state, max_loops=1, user_instruction=GOAL)]
        events = asyncio.run(collect())
        assert events[-1]["type"] == "complete"
    else:
        driver.drive_full_v5_session(state, max_loops=1, user_instruction=GOAL)
    assert calls == []
    assert load_session(sid).awaitReason == "user_input"
