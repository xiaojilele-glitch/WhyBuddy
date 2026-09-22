"""Exercise the HTTP/iterator boundaries that a helper-only lock test misses."""

import asyncio

import pytest

from control_turn_support import KEY, client, llm_tool, new_sid, seed_approved_session, seed_session, six_fields
from routes.sliderule_full import _ExclusiveControlResponse
from services import rehearsal_control as control, product_charter
from services.hook_events import HookDecision, HookEvent, HookOutcome, clear_hooks, register_hook
from starlette.requests import ClientDisconnect


@pytest.fixture(autouse=True)
def isolate_charter_store(monkeypatch):
    monkeypatch.setattr(product_charter, "get_charter_store", lambda: None)


def test_busy_control_request_is_http_conflict_before_sse_headers(monkeypatch):
    sid = new_sid("control-busy")
    seed_session(sid)
    monkeypatch.setattr(control, "_ACTIVE_CONTROL_TURNS", {sid})
    response = client.post("/api/sliderule/control-turn-stream", headers=KEY, json=six_fields(sid, "go"))
    assert response.status_code == 409
    assert response.json()["message"] == "control_turn_in_progress"
    assert response.headers.get("content-type", "").startswith("application/json")


def test_closing_control_iterator_finishes_context_before_releasing_session(monkeypatch):
    sid = new_sid("control-close")
    state = seed_session(sid)
    payload = six_fields(sid, "go")
    monkeypatch.setattr(control, "load_session", lambda session_id: state)
    cleanup = []

    async def body(payload, state):
        try:
            yield {"type": "control_text", "text": "Started"}
        finally:
            cleanup.append(state.sessionId in control._ACTIVE_CONTROL_TURNS)

    monkeypatch.setattr(control, "_run_control_turn_body", body)

    async def run():
        before = control._CONTROL_PAYLOAD.get()
        stream = control.run_control_turn(payload)
        await anext(stream)
        assert sid in control._ACTIVE_CONTROL_TURNS
        await stream.aclose()
        assert cleanup == [True], "The producer must finish while it still owns the session"
        assert control._CONTROL_PAYLOAD.get() is before
        assert sid not in control._ACTIVE_CONTROL_TURNS

    asyncio.run(run())


def test_closing_a_live_questionnaire_unwinds_the_model_tool_scope(monkeypatch):
    sid = new_sid("question-close")
    seed_session(sid, goal={"text": "Inventory", "status": "clear"})

    async def model(*args, **kwargs):
        return llm_tool("ask_user_question", {"questions": [{"question": "Which device?"}]})

    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        before = control._ACTIVE_TOOL.get()
        stream = control.run_control_turn(six_fields(sid, "Help me plan"))
        event = await anext(stream)
        assert event["type"] == "control_ask_user"
        assert control._ACTIVE_TOOL.get() == "ask_user_question"
        await stream.aclose()
        assert control._ACTIVE_TOOL.get() == before
        assert sid not in control._ACTIVE_CONTROL_TURNS

    asyncio.run(run())


@pytest.mark.parametrize("forced", [False, True], ids=["model", "button"])
def test_closing_factory_handoff_unwinds_dispatch_before_session_release(monkeypatch, forced):
    sid = new_sid("factory-close")
    seed_approved_session(sid, goal={"text": "Inventory", "status": "clear"})
    cleanup = []

    async def model(*args, **kwargs):
        return llm_tool("spec", {})

    async def handoff(*args, **kwargs):
        try:
            yield {"type": "control_handoff_factory", "runId": "bounded-run"}
        finally:
            cleanup.append(sid in control._ACTIVE_CONTROL_TURNS)

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    monkeypatch.setattr(control, "_handoff_factory", handoff)

    async def run():
        before = control._ACTIVE_TOOL.get()
        stream = control.run_control_turn(six_fields(sid, "Build it", **({"forcedTool": "spec"} if forced else {})))
        event = await anext(stream)
        assert event["type"] == "control_handoff_factory"
        await stream.aclose()
        assert cleanup == [True]
        assert control._ACTIVE_TOOL.get() == before
        assert sid not in control._ACTIVE_CONTROL_TURNS

    asyncio.run(run())


def test_pre_tool_ask_stops_dispatch_with_explicit_machine_reason(monkeypatch):
    sid = new_sid("hook-ask")
    state = seed_approved_session(sid, goal={"text": "Inventory", "status": "clear"})
    seen = []
    clear_hooks()
    register_hook(HookEvent.PRE_TOOL_USE, "confirm", lambda payload: HookOutcome(
        decision=HookDecision.ASK, reason="Finance approval required", additional_context="policy-7"
    ))
    monkeypatch.setattr(control, "_handoff_factory", lambda *a, **k: pytest.fail("ASK must stop before handoff"))

    async def run():
        try:
            async for event in control._dispatch_tool("spec", {}, state, "Build", [], [], "desktop", None, "Build"):
                seen.append(event)
        finally:
            clear_hooks()

    asyncio.run(run())
    result = next(e for e in seen if e.get("type") == "control_tool_result")
    assert result["error"] == "hook_approval_required"
    assert result["hookContext"] == ["policy-7"]
    assert not any(e.get("type") == "control_handoff_factory" for e in seen)


def test_sequential_hook_rewrite_is_visible_to_next_policy():
    clear_hooks()
    seen = []
    register_hook(HookEvent.PRE_TOOL_USE, "rewrite", lambda payload: HookOutcome(updated_input={"mode": "safe"}))
    register_hook(HookEvent.PRE_TOOL_USE, "observe", lambda payload: (seen.append(dict(payload)) or None))
    try:
        verdict = control.dispatch_hook(HookEvent.PRE_TOOL_USE, {"mode": "fast"})
    finally:
        clear_hooks()
    assert verdict.updated_input == {"mode": "safe"}
    assert seen == [{"mode": "safe"}]


def test_http_disconnect_closes_producer_before_releasing_reservation(monkeypatch):
    sid = new_sid("control-disconnect")
    state = seed_session(sid)
    monkeypatch.setattr(control, "load_session", lambda session_id: state)
    cleanup = []

    async def body(payload, state):
        try:
            yield {"type": "control_text", "text": "Started"}
        finally:
            await asyncio.sleep(0)
            cleanup.append(sid in control._ACTIVE_CONTROL_TURNS)

    monkeypatch.setattr(control, "_run_control_turn_body", body)

    async def run():
        from contextlib import aclosing

        before = control._CONTROL_PAYLOAD.get()

        async def events():
            async with aclosing(control.run_control_turn(six_fields(sid, "go"), reservation_held=True)) as stream:
                async for event in stream:
                    yield str(event)

        async def send(message):
            if message["type"] == "http.response.body":
                raise OSError("browser disconnected")

        async def receive():
            return {"type": "http.disconnect"}

        response = _ExclusiveControlResponse(events(), turn_reservation=control.reserve_control_turn(sid))
        with pytest.raises(ClientDisconnect):
            await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
        assert cleanup == [True]
        assert control._CONTROL_PAYLOAD.get() is before
        assert sid not in control._ACTIVE_CONTROL_TURNS

    asyncio.run(run())
