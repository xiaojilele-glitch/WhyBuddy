"""Project identity and verification cannot be forged through legacy session PUT.

These tests exercise the existing HTTP/save path, including stale driver writes.
Adding a field only to V5SessionState would let the ordinary session update
silently overwrite the server's project pointer or claim a browser verification.
"""

import pytest

from control_turn_support import KEY, client, new_sid, seed_session
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session, save_session
from services import persistence
from services.project_authority import approved_reference


PROJECT_FIELDS = {
    "runtimeKind": "project",
    "projectId": "project-owned",
    "projectRevision": "revision-owned",
}


def bind_project(state, path=None):
    plan = {"planId": "plan-binding", "revision": 1, "planContent": "Create a source project", "reqId": "approve-binding"}
    state = state.model_copy(update={"controlTranscript": [
        {**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")
    ]})
    assert persistence.save_session_record(state, path, server_write=True)["ok"]
    reference = approved_reference(state)
    result = persistence.save_session_record(state.model_copy(update=PROJECT_FIELDS), path,
        server_write=True, project_binding_approval=reference)
    assert result["ok"]
    sink = persistence.get_cache_sink()
    if sink is not None:
        sink(state.sessionId, result["state"])
    return result["state"]


def test_old_sessions_keep_the_html_runtime():
    state = V5SessionState(sessionId="old", goal={})
    assert state.runtimeKind == "html-prototype"
    assert state.projectId is None and state.projectRevision is None


def test_client_put_cannot_claim_a_project_or_browser_success():
    sid = new_sid("project-forgery")
    seed_session(sid)
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": {}, **PROJECT_FIELDS,
        "projectVerification": {"status": "passed"},
    })
    assert response.status_code == 200
    state = load_session(sid)
    assert state.runtimeKind == "html-prototype"
    assert state.projectId is None
    assert "projectVerification" not in state.model_dump()


@pytest.mark.parametrize("incoming", [{}, {
    "runtimeKind": "html-prototype", "projectId": "other-project", "projectRevision": "forged",
}])
def test_client_snapshot_cannot_erase_or_replace_existing_project(incoming):
    sid = new_sid("project-roundtrip")
    state = seed_session(sid)
    state = bind_project(state)
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": state.goal, **incoming,
    })
    assert response.status_code == 200
    stored = load_session(sid)
    assert {key: getattr(stored, key) for key in PROJECT_FIELDS} == PROJECT_FIELDS


def test_late_html_driver_cannot_clear_server_project_reference():
    sid = new_sid("project-stale-driver")
    stale = seed_session(sid).model_copy(deep=True)
    bind_project(stale)
    stale.lastTurnId = "999999"
    save_session(stale, server_write=True, require_durable=True)
    stored = load_session(sid)
    assert {key: getattr(stored, key) for key in PROJECT_FIELDS} == PROJECT_FIELDS


def test_client_put_cannot_create_new_session_with_project_identity():
    sid = new_sid("project-new-forgery")
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": {}, **PROJECT_FIELDS,
    })
    assert response.status_code == 200
    assert load_session(sid).runtimeKind == "html-prototype"
    assert load_session(sid).projectId is None


@pytest.fixture(params=["file", "sql"])
def project_persistence(request, tmp_path, monkeypatch):
    from services import persistence
    from services.session_blob_store import SqlSessionBlobStore

    monkeypatch.chdir(tmp_path)
    database = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}") if request.param == "sql" else None
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: database)
    path = tmp_path / "sessions.json"
    state = V5SessionState(sessionId="project-revisions", ownerId="alice", goal={"text": "current goal"},
        lastTurnId="turn-2")
    state = bind_project(state, path)
    yield persistence, path, state, database
    if database is not None:
        database._engine.dispose()


@pytest.mark.parametrize("changes", [
    {"projectRevision": "revision-obsolete"},
    {"projectId": "another-project", "projectRevision": "another-revision"},
    {"runtimeKind": "html-prototype"},
])
def test_nonempty_server_snapshot_cannot_regress_project_references(project_persistence, changes):
    persistence, path, prior, _database = project_persistence
    stale = prior.model_copy(update={"lastTurnId": "turn-3", **changes})
    assert persistence.save_session_record(stale, path, server_write=True)["ok"]
    stored = persistence.load_session_record(prior.sessionId, path)["session"]
    assert {key: getattr(stored, key) for key in PROJECT_FIELDS} == PROJECT_FIELDS


def test_project_reference_cas_updates_revision_without_rewinding_conversation(project_persistence):
    persistence, path, prior, _database = project_persistence
    updated = prior.model_copy(update={"projectRevision": "revision-next", "lastTurnId": "turn-1", "goal": {"text": "old goal"}})
    assert persistence.save_session_record(updated, path, server_write=True,
        expected_project_revision=prior.projectRevision)["ok"]
    stored = persistence.load_session_record(prior.sessionId, path)["session"]
    assert stored.projectRevision == "revision-next"
    assert stored.lastTurnId == prior.lastTurnId and stored.goal == prior.goal
    with pytest.raises(persistence.PersistClosedError, match="project_revision_conflict"):
        persistence.save_session_record(updated, path, server_write=True, expected_project_revision=prior.projectRevision)
    assert persistence.load_session_record(prior.sessionId, path)["session"].projectRevision == "revision-next"


def test_project_reference_cas_requires_server_identity_and_same_project(project_persistence):
    persistence, path, prior, _database = project_persistence
    updated = prior.model_copy(update={"projectRevision": "revision-next"})
    with pytest.raises(persistence.PersistClosedError, match="project_reference_server_only"):
        persistence.save_session_record(updated, path, expected_project_revision=prior.projectRevision)
    with pytest.raises(persistence.PersistClosedError, match="project_identity_changed"):
        persistence.save_session_record(updated.model_copy(update={"projectId": "another-project"}), path,
            server_write=True, expected_project_revision=prior.projectRevision)
    with pytest.raises(persistence.PersistClosedError, match="session_owner_changed"):
        persistence.save_session_record(updated.model_copy(update={"ownerId": "bob"}), path,
            server_write=True, expected_project_revision=prior.projectRevision)
    assert persistence.load_session_record(prior.sessionId, path)["session"].projectRevision == prior.projectRevision


def test_project_reference_cas_rechecks_after_database_conflict(project_persistence, monkeypatch):
    persistence, path, prior, database = project_persistence
    if database is None:
        pytest.skip("Cross-worker CAS retry is specific to the SQL storage path")
    original = database.save
    raced = False
    def save_winner_then_conflict(session_id, payload, *, expected_rev=None):
        nonlocal raced
        if not raced:
            raced = True
            winner = prior.model_copy(update={"projectRevision": "revision-winner"})
            assert original(session_id, winner.model_dump(), expected_rev=expected_rev)
            return False
        return original(session_id, payload, expected_rev=expected_rev)
    monkeypatch.setattr(database, "save", save_winner_then_conflict)
    with pytest.raises(persistence.PersistClosedError, match="project_revision_conflict"):
        persistence.save_session_record(prior.model_copy(update={"projectRevision": "revision-loser"}), path,
            server_write=True, expected_project_revision=prior.projectRevision)
    assert persistence.load_session_record(prior.sessionId, path)["session"].projectRevision == "revision-winner"


@pytest.mark.parametrize("server_write", [False, True])
def test_ordinary_save_cannot_introduce_first_project_reference(tmp_path, monkeypatch, server_write):
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: None)
    state = V5SessionState(sessionId="unprivileged-binding", ownerId="alice", goal={}, **PROJECT_FIELDS)
    path = tmp_path / "sessions.json"
    assert persistence.save_session_record(state, path, server_write=server_write)["ok"]
    stored = persistence.load_session_record(state.sessionId, path)["session"]
    assert stored.runtimeKind == "html-prototype" and stored.projectId is None
