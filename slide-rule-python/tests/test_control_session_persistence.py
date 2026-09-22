"""A lease can be lost after the control guard, including during a 413 retry.

Exercise the full session save path against real SQLite tables. Rejecting the
late write must also prevent the old state from becoming the memory authority.
"""

from types import SimpleNamespace

import pytest

from models.v5_state import V5SessionState
from services import persistence, slide_rule_session
from services.control_run_store import ControlRunStore
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture
def owned(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'state.db'}"
    blobs = SqlSessionBlobStore(url)
    projects = ProjectStore.from_url(url)
    controls = ControlRunStore(projects._q)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: blobs)
    monkeypatch.setattr(slide_rule_session, "_sessions", {})
    state = V5SessionState(sessionId="fenced-session", ownerId="owner", goal={"text": "Original"})
    state = slide_rule_session.save_session(state, server_write=True, require_durable=True)
    run = controls.submit(state.sessionId, state.ownerId, "request", {"sessionId": state.sessionId})
    claimed = controls.claim(run["runId"], "old-worker", 120)
    fence = {"runId": run["runId"], "ownerId": state.ownerId,
             "generation": claimed["generation"], "workerId": "old-worker"}

    def takeover():
        controls.suspend(run["runId"], "old-worker", fence["generation"])
        new = controls.claim(run["runId"], "new-worker", 120)
        return {**fence, "generation": new["generation"], "workerId": "new-worker"}

    yield SimpleNamespace(blobs=blobs, state=state, fence=fence, takeover=takeover)
    projects.close()
    blobs._engine.dispose()


@pytest.mark.parametrize("changed", [False, True], ids=["identical", "changed"])
def test_session_save_rejects_stale_lease_even_for_identical_payload(owned, changed):
    state = owned.state
    candidate = state.model_copy(update={"goal": {"text": "Late old worker"}}) if changed else state
    before = owned.blobs.load(state.sessionId)
    new_fence = owned.takeover()
    with pytest.raises(persistence.PersistClosedError):
        slide_rule_session.save_session(candidate, server_write=True, require_durable=True,
                                        expected_control_run=owned.fence)
    after = owned.blobs.load(state.sessionId)
    assert (after.rev, after.payload) == (before.rev, before.payload)
    assert slide_rule_session._sessions[state.sessionId] is state

    current = state.model_copy(update={"goal": {"text": "New owner committed"}})
    saved = slide_rule_session.save_session(current, server_write=True, require_durable=True,
                                           expected_control_run=new_fence)
    assert saved.goal["text"] == "New owner committed"
    assert owned.blobs.load(state.sessionId).payload["goal"] == saved.goal


@pytest.mark.parametrize("lose_lease", [False, True], ids=["owned", "takeover"])
def test_payload_slim_retry_uses_the_same_lease(owned, monkeypatch, lose_lease):
    candidate = owned.state.model_copy(deep=True)
    candidate.goal = {"text": "Changed with pages"}
    candidate.specFirstPages = {"pages": {"p1": "<html>Current</html>"}}
    candidate.modelVersions = [{"id": "v1", "model": {"a": 1},
                                "specFirstPages": {"pages": {"p1": "<html>Past</html>"}}}]
    before = owned.blobs.load(candidate.sessionId)
    real_save = owned.blobs.save
    calls = []

    def oversized_once(sid, payload, **kwargs):
        calls.append((payload, kwargs))
        if len(calls) == 1:
            if lose_lease:
                owned.takeover()
            raise RuntimeError("HTTP 413: request body too large")
        return real_save(sid, payload, **kwargs)

    monkeypatch.setattr(owned.blobs, "save", oversized_once)
    result = persistence.save_session_record(candidate, server_write=True,
                                             expected_control_run=owned.fence)
    assert len(calls) >= 2
    assert not calls[1][0]["modelVersions"][0].get("specFirstPages")
    assert all(kwargs["expected_control_run"] == owned.fence for _, kwargs in calls)
    after = owned.blobs.load(candidate.sessionId)
    if lose_lease:
        assert result["ok"] is False
        assert (after.rev, after.payload) == (before.rev, before.payload)
    else:
        assert result["ok"] is True
        assert result["degradedVersionPagesStripped"] is True
        assert after.payload["goal"]["text"] == "Changed with pages"
    assert candidate.modelVersions[0]["specFirstPages"] is not None


def test_control_owned_write_cannot_fall_back_to_json(owned, tmp_path, monkeypatch):
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: None)
    path = tmp_path / "fallback.json"
    result = persistence.save_session_record(owned.state, store_file=path,
                                             expected_control_run=owned.fence)
    assert result["ok"] is False
    assert result["reason"] == "control_fence_requires_durable_store"
    assert not path.exists()
