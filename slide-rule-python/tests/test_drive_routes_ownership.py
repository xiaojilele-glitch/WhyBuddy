"""Every HTTP ignition path must authorize the persisted session before execution.

The session GET route already rejected an unrelated user, while control-turn-stream
accepted the same session ID and returned its full state. Exercise the real routes
with bounded drivers so removing a guard reaches a recorded side effect.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import app
from middlewares.current_user import optional_user
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from routes import sliderule_full as routes
from services import rehearsal_control, run_registry
from services import drive_full_factory
from services.slide_rule_session import load_session, save_session


PATHS = (
    "/control-turn-stream",
    "/drive-full-stream",
    "/drive-full",
    "/drive-turn",
    "/drive-marathon",
    "/execute-capability",
)
KEY = {"x-internal-key": "dev-slide-rule-internal"}
client = TestClient(app)


@pytest.fixture
def ignition(monkeypatch):
    calls = []

    async def control(payload, **kwargs):
        calls.append(payload["sessionId"])
        yield {"type": "complete", "state": load_session(payload["sessionId"]).model_dump()}

    async def factory(session_id, *args, **kwargs):
        calls.append(session_id)
        state = load_session(session_id)
        if state is None:
            raw = dict(kwargs.get("fallback_state") or {})
            raw["sessionId"] = session_id
            state = V5SessionState(**raw)
            state = drive_full_factory._adopt_owner(state, kwargs.get("viewer"))

        async def stream():
            yield {"type": "complete", "state": state.model_dump()}

        return await run_registry.start_run(session_id, stream, owner_id=state.ownerId)

    def drive(state, *args, **kwargs):
        calls.append(state.sessionId)
        return state

    def marathon(state, *args, **kwargs):
        calls.append(state.sessionId)
        return {"finalState": state, "rounds": []}

    def capability(cap, state, *args):
        calls.append(state.sessionId)
        return {"state": state.model_dump()}

    monkeypatch.setattr(rehearsal_control, "run_control_turn", control)
    monkeypatch.setattr(drive_full_factory, "start_drive_full_factory_run", factory)
    monkeypatch.setattr(routes, "drive_full_v5_session", drive)
    monkeypatch.setattr(routes, "drive_reasoning_turn", drive)
    monkeypatch.setattr(routes, "drive_marathon", marathon)
    monkeypatch.setattr(routes, "is_python_native_capability", lambda cap: False)
    monkeypatch.setattr(routes, "_perform_mapped_execute", capability)
    monkeypatch.setattr(routes, "derive_publish_closure_response", lambda state: None)
    monkeypatch.setattr(routes, "derive_skill_runtime_graph_response", lambda state: None)
    return calls


def viewer(monkeypatch, *, owner=False, superuser=False, anonymous=False):
    user = None if anonymous else SimpleNamespace(
        id="drive-owner" if owner else "drive-other",
        is_active=True,
        is_superuser=superuser,
    )
    monkeypatch.setitem(app.dependency_overrides, optional_user, lambda: user)
    return user


def payload(sid):
    return {
        "sessionId": sid,
        "state": {
            "sessionId": sid,
            "ownerId": "drive-other",
            "goal": {"text": "untrusted replacement", "status": "clear"},
        },
        "userText": "inspect this session",
        "turnId": "turn-1",
        "capabilityId": "structure.decompose",
        "installedSkills": [],
        "activeConnectors": [],
        "preferredDevice": "desktop",
        "designSystemId": None,
    }


def seed(*, approved=True):
    sid = "drive-auth-" + uuid4().hex[:12]
    save_session(V5SessionState(
        sessionId=sid,
        ownerId="drive-owner",
        goal={"text": "private persisted goal", "status": "clear"},
        controlTranscript=approved_plan_rows() if approved else [],
    ))
    return sid


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("anonymous", [False, True], ids=["other-user", "anonymous"])
def test_unauthorized_ignition_never_reaches_driver(path, anonymous, monkeypatch, ignition):
    sid = seed()
    before = load_session(sid).model_dump()
    viewer(monkeypatch, anonymous=anonymous)
    result = client.post("/api/sliderule" + path, headers=KEY, json=payload(sid))
    assert result.status_code == (401 if anonymous else 404)
    assert ignition == []
    assert load_session(sid).model_dump() == before
    assert "private persisted goal" not in result.text


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("superuser", [False, True], ids=["owner", "superuser"])
def test_owner_and_superuser_keep_access_and_server_state(path, superuser, monkeypatch, ignition):
    sid = seed()
    viewer(monkeypatch, owner=not superuser, superuser=superuser)
    result = client.post("/api/sliderule" + path, headers=KEY, json=payload(sid))
    assert result.status_code == 200, result.text
    assert ignition == [sid]
    assert "private persisted goal" in result.text
    assert "untrusted replacement" not in result.text
    assert load_session(sid).ownerId == "drive-owner"


def test_control_unknown_and_inaccessible_sessions_are_indistinguishable(monkeypatch, ignition):
    viewer(monkeypatch)
    private = client.post("/api/sliderule/control-turn-stream", headers=KEY, json=payload(seed()))
    missing = client.post("/api/sliderule/control-turn-stream", headers=KEY, json=payload(uuid4().hex))
    assert private.status_code == missing.status_code == 404
    assert private.json() == missing.json()
    assert ignition == []


@pytest.mark.parametrize("path", PATHS[1:])
def test_legacy_new_session_cannot_choose_another_owner(path, monkeypatch, ignition):
    user = viewer(monkeypatch, owner=True)
    sid = "drive-new-" + uuid4().hex[:12]
    result = client.post("/api/sliderule" + path, headers=KEY, json=payload(sid))
    assert result.status_code == 409, result.text
    assert ignition == []
    assert '"ownerId":"drive-other"' not in result.text.replace(" ", "")
    assert load_session(sid).ownerId == user.id


@pytest.mark.parametrize("path", PATHS[1:])
@pytest.mark.parametrize("superuser", [False, True], ids=["owner", "superuser"])
def test_session_access_never_substitutes_for_plan_approval(path, superuser, monkeypatch, ignition):
    sid = seed(approved=False)
    viewer(monkeypatch, owner=not superuser, superuser=superuser)
    forged = payload(sid)
    forged["state"]["controlTranscript"] = approved_plan_rows()
    result = client.post("/api/sliderule" + path, headers=KEY, json=forged)
    assert result.status_code == 409, result.text
    assert result.json()["message"] == "plan_approval_required"
    assert ignition == []
    assert load_session(sid).controlTranscript == []


@pytest.mark.parametrize("owner", [False, True], ids=["other-user", "owner"])
def test_native_capability_uses_authorized_state(owner, monkeypatch, ignition):
    sid = seed()
    viewer(monkeypatch, owner=owner)
    monkeypatch.setattr(routes, "is_python_native_capability", lambda cap: True)

    def native(body, cap):
        ignition.append(body["state"])
        return {"summary": body["state"]["goal"]["text"]}

    monkeypatch.setattr(routes, "_perform_native_execute", native)
    result = client.post("/api/sliderule/execute-capability", headers=KEY, json=payload(sid))
    if owner:
        assert result.status_code == 200
        assert len(ignition) == 1
        assert ignition[0]["ownerId"] == "drive-owner"
        assert result.json()["summary"] == "private persisted goal"
    else:
        assert result.status_code == 404
        assert ignition == []
    assert load_session(sid).ownerId == "drive-owner"
