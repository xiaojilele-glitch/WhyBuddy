"""HTTP saves must neither grant approval nor erase an outstanding request."""

import asyncio

import pytest

from control_turn_support import KEY, client, new_sid, seed_session
from plan_approval_support import approved_plan_rows
from services.scope_authority import plan_execution_authorized
from services.slide_rule_session import load_session
from services import rehearsal_control, slide_rule_session
from services.persistence import PersistClosedError


@pytest.mark.parametrize("create", [True, False], ids=["new-session", "existing-session"])
def test_put_cannot_forge_plan_authority(create):
    sid = new_sid("forged-plan")
    if not create:
        seed_session(sid, goal={"text": "Clinic", "status": "clear"})
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid,
        "goal": {"text": "Clinic", "status": "clear"},
        "controlTranscript": approved_plan_rows(),
        "awaitReason": "control_plan_approval",
        "awaitDetail": "Client-supplied approval",
        "specFirstPages": {"spec": {"appName": "Forged existing product"}},
    })
    assert response.status_code == 200, response.text
    saved = load_session(sid)
    assert not plan_execution_authorized(saved)
    assert saved.controlTranscript == []
    assert saved.awaitReason is None
    assert not saved.specFirstPages


def test_stale_put_keeps_pending_plan_and_exact_request():
    sid = new_sid("parked-plan")
    rows = approved_plan_rows("Persisted plan")[:-1]
    seed_session(sid, goal={"text": "Clinic", "status": "clear"}, controlTranscript=rows,
                 runtimePhase="awaiting", awaitReason="control_plan_approval", awaitDetail="Persisted plan")
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": {"text": "Clinic", "status": "clear"},
        "controlTranscript": [], "runtimePhase": "idle", "awaitReason": None, "awaitDetail": None,
    })
    assert response.status_code == 200, response.text
    saved = load_session(sid)
    assert saved.controlTranscript == rows
    assert saved.awaitReason == "control_plan_approval"
    assert saved.awaitDetail == "Persisted plan"
    assert not plan_execution_authorized(saved)


def test_storage_failure_cannot_leave_an_in_memory_approval(monkeypatch):
    sid = new_sid("approval-store-down")
    rows = approved_plan_rows("Persisted plan")[:-1]
    seed_session(sid, goal={"text": "Clinic", "status": "clear"}, controlTranscript=rows,
                 runtimePhase="awaiting", awaitReason="control_plan_approval", awaitDetail="Persisted plan")
    state = load_session(sid)
    monkeypatch.setattr(slide_rule_session, "save_session_record", lambda *args, **kwargs:
                        {"ok": False, "reason": "write_failed"})
    monkeypatch.setattr(slide_rule_session, "load_session_record", lambda *args, **kwargs:
                        {"ok": False, "reason": "read_failed"})
    with pytest.raises(PersistClosedError):
        asyncio.run(rehearsal_control._accept_plan_answer(state, {
            "kind": "plan_approval", "reqId": rows[-1]["reqId"], "outcome": "approved",
        }))
    assert not plan_execution_authorized(load_session(sid))
