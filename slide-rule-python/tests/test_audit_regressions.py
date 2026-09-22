"""Regression cases from the grok alignment audit, using production helpers."""
import asyncio
import ast
from pathlib import Path

import pytest
from fastapi import HTTPException

from models.v5_state import CapabilityRun, V5SessionState
from services import rehearsal_control as control
from services.html_bindings import check_bindings, check_coverage, scan_bindings
from services.stage_pairing import StagePairTracker
from services.deliverable_surface import measure_page


MODEL = {"datamodel": {"entities": [{"id": "item", "fields": [{"id": "price"}]}]}}


def test_hidden_or_non_editable_controls_are_not_data_entry_evidence():
    surface = measure_page("p1", '<input type="hidden"><input type="submit"><input readonly>'
                           '<div hidden><textarea></textarea></div><select disabled></select>')
    assert surface.entry == 0
    assert measure_page("p1", '<input><textarea></textarea><select></select>').entry == 3


def waiting_state():
    return V5SessionState(sessionId="audit-question", goal={"text": "inventory"}, runtimePhase="awaiting",
                          awaitReason="control_ask", awaitDetail="Choose",
                          controlTranscript=[{"kind": "ask_user_question", "reqId": "q-1", "text": "Choose"}])


@pytest.mark.parametrize("operation", ["ask", "answer"])
def test_question_storage_failure_keeps_shared_state_unchanged(monkeypatch, operation):
    state = waiting_state()
    before = state.model_dump()
    events = []

    def fail_save(candidate, **kwargs):
        assert candidate is not state
        # ⚠ 2026-09-15：原来这里是 kwargs 全等。上游给 save_session 加了一个
        #   可选的 `expected_control_run`（传 None 等于旧行为，只是把 CAS
        #   期望透传给 save_session_record），全等就红了——而这条判据在乎的
        #   从来不是参数表长什么样，是**这一次保存必须是服务端写且要求落库**。
        #   所以只钉这两个：任一被悄悄改成 False 当场红，新增透传参数放行。
        assert kwargs["server_write"] is True
        assert kwargs["require_durable"] is True
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(control, "save_session", fail_save)

    async def run():
        if operation == "ask":
            async for event in control._park_ask(state, "Another question"):
                events.append(event)
        else:
            await control._stamp_user_answer(state, {}, {"reqId": "q-1", "text": "yes"})

    with pytest.raises(RuntimeError, match="storage unavailable"):
        asyncio.run(run())
    assert state.model_dump() == before
    assert events == []


def test_consumed_question_receipt_cannot_start_another_turn(monkeypatch):
    state = waiting_state()
    state.awaitReason = None
    state.runtimePhase = "idle"
    state.controlTranscript.append({"kind": "user_answer", "reqId": "q-1"})
    monkeypatch.setattr(control, "save_session", lambda candidate, **kw: candidate)
    with pytest.raises(HTTPException) as error:
        asyncio.run(control._stamp_user_answer(state, {}, {"reqId": "q-1", "text": "again"}))
    assert error.value.status_code == 409


def test_concurrent_control_turns_cannot_consume_one_receipt_twice(monkeypatch):
    state = waiting_state()
    monkeypatch.setattr(control, "load_session", lambda sid: state)

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def body(payload, state):
            calls.append(payload)
            entered.set()
            await release.wait()
            yield {"type": "complete"}

        monkeypatch.setattr(control, "_run_control_turn_body", body)

        async def collect():
            payload = {"sessionId": state.sessionId, "userText": "yes", "installedSkills": [],
                       "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
            return [e async for e in control.run_control_turn(payload)]

        first = asyncio.create_task(collect())
        await asyncio.wait_for(entered.wait(), timeout=2)
        try:
            with pytest.raises(HTTPException) as error:
                await asyncio.wait_for(collect(), timeout=0.2)
            assert error.value.status_code == 409
        finally:
            release.set()
            await first
        assert len(calls) == 1
        await collect()
        assert len(calls) == 2

    asyncio.run(run())


@pytest.mark.parametrize("markup", [
    "<SPAN DATA-VALUE='item' DATA-AGGREGATE='sum' DATA-FIELD='price'>0</SPAN>",
    '<span data-value="item" data-aggregate="sum" data-field="price">0</span>',
    '<span data-value=item data-aggregate=sum data-field=price>0</span>',
])
def test_browser_legal_aggregate_binding_is_valid(markup):
    assert check_bindings(markup, MODEL) == []
    assert check_coverage(markup, MODEL) == []
    assert scan_bindings(markup)[0]["attrs"]["field"] == "price"


@pytest.mark.parametrize("wrapper", ["<!--{}-->", "<script>{}</script>", "<template>{}</template>"])
def test_inert_markup_is_not_a_delivered_data_source(wrapper):
    markup = wrapper.format('<span data-value="item" data-aggregate="count">0</span>')
    assert scan_bindings(markup) == []
    assert check_coverage(markup, MODEL)


def test_aggregate_suffix_unsupported_by_browser_is_rejected():
    assert check_bindings('<span data-value="item" data-aggregate="sum:price">0</span>', MODEL)


def test_ledger_duration_has_one_authority():
    row = CapabilityRun.server_record(id="run", turnId="turn", capabilityId="audit", status="success", durationMs=12,
                                     provenance="test.fixture", timing={"durationMs": 99})
    assert row.durationMs == row.timing["durationMs"] == 12


def test_parallel_stage_end_matches_page_instead_of_start_order():
    tracker = StagePairTracker()
    first = {"pageId": "p1", "device": "desktop"}
    second = {"pageId": "p2", "device": "desktop"}
    tracker.note_start("pages", first, now=1)
    tracker.note_start("pages", second, now=2)
    assert tracker.note_end("pages", second)
    assert tracker.active() == first
    assert not tracker.note_end("pages", second)
    assert tracker.close_dangling()[0].event == first


def test_partial_page_delivery_backfills_only_missing_or_changed_content():
    path = Path(__file__).parents[1] / "services/v5_full_driver.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    function = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_fallback_page_events")
    module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    seen = {("desktop", "p1"): ("first", True)}
    env = {"_peek_page_events": lambda: 1, "_note_page_event": lambda: None,
           "_peek_pages_for_fallback": lambda: {"pages": {"p1": "first", "p2": "second"},
                                               "pageBindStatus": {"p1": "bound", "p2": "bound"}},
           "_delivered_pages": seen}
    exec(compile(module, str(path), "exec"), env)

    async def run():
        first = [event async for event in env["_fallback_page_events"]()]
        second = [event async for event in env["_fallback_page_events"]()]
        return first, second

    first, second = asyncio.run(run())
    assert [e["pageId"] for e in first] == ["p2"]
    assert second == []
