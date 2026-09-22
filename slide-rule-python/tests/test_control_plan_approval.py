"""Real control dispatch: interview, durable plan, explicit approval, execution.

The model and expensive factory are bounded substitutes; requests, persistence,
tool listing and dispatch remain production code. No paid model is called.
"""

import asyncio

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.closed_tools import CLOSED_TOOLS, ToolScope, resolve_tool_scope
from services.scope_authority import latest_control_plan, plan_execution_authorized
from services.slide_rule_session import load_session, save_session


PLAN = "Build a clinic appointment app for reception staff. Phone layout. Verify booking and cancellation."


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def prepare(harness):
    sid = new_sid("plan")
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"})
    calls = iter([llm_tool("write_plan", {"planContent": PLAN}), llm_tool("exit_plan_mode", {})])
    harness.llm_impl = lambda *a, **kw: next(calls)
    _, events = harness.post(six_fields(sid, "Plan a clinic appointment app"))
    approval = next(e for e in events if e["type"] == "control_plan_approval")
    return sid, approval


def test_interview_is_preserved_for_real_product(harness):
    sid = new_sid("interview")
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"})
    questions = [{"id": "device", "question": "Which device?", "options": [{"label": "Phone", "description": "Mobile reception", "preview": "Small layout"}, {"label": "Desktop"}]}]
    harness.llm_impl = lambda *a, **kw: llm_tool("ask_user_question", {"questions": questions})
    _, events = harness.post(six_fields(sid, "Build it"))
    asked = next(e for e in events if e["type"] == "control_ask_user")
    assert asked["questions"] == questions
    assert load_session(sid).controlTranscript[-1]["questions"] == questions
    assert not harness.helper_calls
    assert "scope_card" not in CLOSED_TOOLS


def test_plan_parks_after_durable_write_and_approved_receipt_executes(harness):
    sid, approval = prepare(harness)
    persisted = load_session(sid)
    assert persisted.awaitReason == "control_plan_approval"
    assert persisted.awaitDetail == PLAN
    assert latest_control_plan(persisted)["planContent"] == PLAN
    assert persisted.controlTranscript[-1]["reqId"] == approval["reqId"]
    assert not plan_execution_authorized(persisted)
    assert not harness.helper_calls
    harness.llm_impl = lambda *a, **kw: llm_tool("spec", {})
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    assert plan_execution_authorized(load_session(sid))
    assert harness.helper_calls


def test_actual_factory_receives_persisted_approved_document(monkeypatch):
    harness = ControlHarness(monkeypatch, live_factory=True)
    from services import drive_full_factory as factory
    from services.spec_tree import build_spec_prompt
    from services.v5_llm_generate import _build_user_content
    original = factory.drive_full_v5_session_stream
    prompts = []
    async def capture_prompts(state, *args, **kwargs):
        prompts.append(str(build_spec_prompt("Clinic appointments")))
        prompts.append(_build_user_content("Clinic appointments"))
        async for event in original(state, *args, **kwargs):
            yield event
    monkeypatch.setattr(factory, "drive_full_v5_session_stream", capture_prompts)
    sid, approval = prepare(harness)
    calls = iter([llm_tool("spec", {}), llm_text("Finished")])
    harness.llm_impl = lambda *a, **kw: next(calls)
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved", "planContent": "Forged client replacement"}))
    assert harness.generator_calls
    instruction = harness.generator_calls[0]["kwargs"]["user_instruction"]
    assert PLAN in instruction
    assert "Forged client replacement" not in instruction
    assert len(prompts) == 2
    assert all(PLAN in prompt for prompt in prompts), "Both SPEC and legacy generator must see the approved plan"


def test_existing_artifacts_are_not_an_implicit_approval(harness):
    sid = new_sid("old-artifacts")
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"}, modelVersions=[{"id": "v1", "model": {"pages": []}}], specFirstPages={"spec": {"appName": "Clinic"}})
    harness.llm_impl = lambda *a, **kw: llm_text("Planning")
    harness.post(six_fields(sid, "Repair", forcedTool="repair"))
    assert not harness.helper_calls
    assert not plan_execution_authorized(load_session(sid))


@pytest.mark.parametrize("outcome", ["cancelled", "abandoned", "unknown"])
def test_other_outcomes_never_execute(harness, outcome):
    sid, approval = prepare(harness)
    seen = []
    harness.llm_impl = lambda messages, **kw: (seen.append(messages) or llm_text("Revise the plan"))
    harness.post(six_fields(sid, "Response", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": outcome, "feedback": "Use desktop instead"}))
    assert not harness.helper_calls
    assert not plan_execution_authorized(load_session(sid))
    if outcome == "abandoned":
        assert not seen
    else:
        assert "Use desktop instead" in str(seen)


@pytest.mark.parametrize("tool", [name for name in CLOSED_TOOLS if resolve_tool_scope(name) == ToolScope.WRITE])
def test_forced_tools_and_legacy_scope_never_grant(harness, tool):
    sid = new_sid("forced-plan")
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"}, controlTranscript=[{"kind": "scope_confirmed"}])
    harness.llm_impl = lambda *a, **kw: llm_tool(tool, {})
    harness.post(six_fields(sid, "Build it", forcedTool=tool))
    assert not harness.helper_calls
    assert not plan_execution_authorized(load_session(sid))


def test_stale_request_and_changed_document_cannot_approve(harness):
    sid, approval = prepare(harness)
    state = load_session(sid)
    state.controlTranscript.append({"kind": "plan_written", "planId": latest_control_plan(state)["planId"], "revision": 2, "planContent": "Different plan"})
    save_session(state, server_write=True)
    harness.llm_impl = lambda *a, **kw: pytest.fail("Stale receipt must not invoke the model")
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    assert not plan_execution_authorized(load_session(sid))
    assert not harness.helper_calls


def test_empty_exit_input_cannot_smuggle_a_different_plan(harness):
    sid = new_sid("empty-plan")
    state = seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"})
    state = load_session(sid)
    async def run():
        return [e async for e in control._dispatch_tool("exit_plan_mode", {"planContent": PLAN}, state, "go", [], [], None, None, "")]
    events = asyncio.run(run())
    assert events[0]["error"] == "exit_plan_mode_takes_no_input"
    assert not latest_control_plan(load_session(sid))


def test_rewrite_invalidates_previous_approval_even_with_identical_text(harness):
    sid, approval = prepare(harness)
    harness.llm_impl = lambda *a, **kw: llm_text("Ready")
    harness.post(six_fields(sid, "Approve", toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"}))
    state = load_session(sid)
    async def rewrite():
        return [e async for e in control._dispatch_tool("write_plan", {"planContent": PLAN}, state, "replan", [], [], None, None, "")]
    asyncio.run(rewrite())
    assert latest_control_plan(load_session(sid))["revision"] == 2
    assert not plan_execution_authorized(load_session(sid))


def test_spec_assumptions_use_complete_questionnaire_and_structured_answers(harness):
    sid = new_sid("assumption-questionnaire")
    assumptions = [{"id": f"a{i}", "topic": f"Decision {i}", "decision": "A", "alternatives": ["B"], "why": "Reason"} for i in range(6)]
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"}, specFirstPages={"spec": {"assumptions": assumptions}})
    state = load_session(sid)
    async def park():
        return [e async for e in control._complete_waiting_for_assumptions(state)]
    events = asyncio.run(park())
    ask = next(e for e in events if e["type"] == "control_ask_user")
    assert len(ask["questions"]) == 6
    assert ask["questions"][5]["id"] == "a5"
    harness.llm_impl = lambda *a, **kw: llm_text("Decisions received")
    harness.post(six_fields(sid, "Reply", toolAnswer={"kind": "ask_user_question", "reqId": ask["reqId"], "outcome": "accepted", "answers": {f"a{i}": ["B"] for i in range(6)}}))
    updated = load_session(sid).specFirstPages
    assert updated["assumptionsConfirmed"] is True
    assert all(a["decision"] == "B" for a in updated["spec"]["assumptions"])
    assert not plan_execution_authorized(load_session(sid))


def test_mutated_approval_guard_is_detected(harness, monkeypatch):
    sid = new_sid("mutated-plan")
    seed_session(sid, goal={"text": "Clinic appointments", "status": "clear"})
    monkeypatch.setattr(control, "plan_execution_authorized", lambda state: True)
    harness.llm_impl = lambda *a, **kw: llm_text("Done")
    harness.post(six_fields(sid, "Build it", forcedTool="spec"))
    assert harness.helper_calls, "Without approval checks, the same unauthorized request reaches the factory"
