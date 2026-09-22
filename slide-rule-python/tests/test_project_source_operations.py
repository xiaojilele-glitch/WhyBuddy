"""Exercise HTTP -> current session authority -> real SQL source and history.

Restore must publish a new immutable tree, forks cannot inherit authorization,
and retries must not apply another edit after a lost response. These boundaries
are tested at the workbench entry, rather than by matching source identifiers.
"""

import io
import json
import zipfile
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from routes import project_sources as route
from services import persistence
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_manifest import content_hash
from services.project_store import ProjectStore
from services.scope_authority import plan_execution_authorized
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture
def setup(tmp_path, monkeypatch, request):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    plan = {"planId": "plan1", "revision": 1, "planContent": "Create and edit project", "reqId": "approve1"}
    state = V5SessionState(sessionId="source-session", ownerId="alice", goal={"text": "Tasks"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, state.sessionId, owner_id="alice", approval_ref=approved_reference(state),
        template_id=getattr(request, "param", "react-vite"))
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    with TestClient(app) as client:
        yield SimpleNamespace(store=store, sessions=sessions, project=project, viewer=viewer, client=client,
            url=f"/api/sliderule/projects/{project.projectId}")
    store.close()
    sessions._engine.dispose()


def edit(setup, key="edit-one", *, revision=None, content="export const title = 'Edited';\n"):
    file = setup.client.get(setup.url + "/source/file", params={"path": "src/main.tsx", **({"revision": revision} if revision else {})}).json()
    return setup.client.post(setup.url + "/source/patch", json={"expectedRevision": revision or file["revision"],
        "idempotencyKey": key, "changes": [{"path": file["path"], "expectedSha256": file["sha256"], "content": content}]})


def test_source_edit_restore_history_and_export_use_actual_saved_tree(setup):
    initial = setup.project.currentRevision
    before = setup.store.read_files(setup.project.projectId, owner_id="alice")
    response = edit(setup)
    assert response.status_code == 200, response.text
    edited = response.json()["revision"]
    assert edited != initial and response.json()["status"] == "completed"
    assert persistence.load_session_record(setup.project.sessionId)["session"].projectRevision == edited
    restored = setup.client.post(setup.url + "/restore", json={"expectedRevision": edited,
        "targetRevision": initial, "idempotencyKey": "restore-one"})
    assert restored.status_code == 200, restored.text
    revision = restored.json()["revision"]
    assert revision not in {initial, edited}
    assert setup.store.read_files(setup.project.projectId, owner_id="alice") == before
    rows = setup.client.get(setup.url + "/revisions", params={"limit": 2}).json()
    assert [r["revision"] for r in rows["revisions"]] == [revision, edited]
    assert rows["nextCursor"] == initial
    assert setup.client.get(setup.url + "/revisions", params={"cursor": initial}).json()["nextCursor"] is None
    download = setup.client.get(setup.url + "/export")
    assert download.status_code == 200
    assert download.content == setup.client.get(setup.url + "/export").content
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert archive.read("source/src/main.tsx").decode() == before["src/main.tsx"]
        metadata = json.loads(archive.read("whybuddy-export.json"))
        assert metadata["revision"] == revision and metadata["businessDataIncluded"] is False
        assert not any(".env" in name or "tasks.sqlite" in name for name in archive.namelist())


def test_retry_does_not_duplicate_or_rewind_after_a_later_edit(setup):
    initial = setup.project.currentRevision
    first = edit(setup, revision=initial).json()
    repeated = edit(setup, revision=initial)
    assert repeated.status_code == 200 and repeated.json() == first
    next_revision = edit(setup, key="second", content="export const newer = true;\n").json()["revision"]
    assert edit(setup, revision=initial).json() == first
    assert setup.store.get_project(setup.project.projectId, owner_id="alice").currentRevision == next_revision
    assert edit(setup, revision=initial, content="Different intent").status_code == 409


def test_conflicting_hash_stale_revision_and_secret_path_are_rejected(setup):
    initial = setup.project.currentRevision
    assert edit(setup).status_code == 200
    assert edit(setup, key="stale-intent", revision=initial).status_code == 409
    current = setup.store.get_project(setup.project.projectId, owner_id="alice").currentRevision
    body = {"expectedRevision": current, "idempotencyKey": "bad", "changes": [
        {"path": "src/main.tsx", "expectedSha256": "0" * 64, "content": "bad"}]}
    assert setup.client.post(setup.url + "/source/patch", json=body).status_code == 422
    body["changes"] = [{"path": ".env", "expectedSha256": None, "content": "fake-secret"}]
    assert setup.client.post(setup.url + "/source/patch", json=body).status_code == 422
    assert setup.store.get_project(setup.project.projectId, owner_id="alice").currentRevision == current


@pytest.mark.parametrize("suffix", ["/source", "/source/file?path=src/main.tsx", "/revisions", "/export"])
def test_other_owner_cannot_read_source_or_history_even_if_admin(setup, suffix):
    setup.viewer["id"] = "mallory"
    assert setup.client.get(setup.url + suffix).status_code == 404


def test_revoked_approval_rejects_changes_but_preserves_read_access(setup):
    row = setup.sessions.load(setup.project.sessionId)
    row.payload["controlTranscript"].append({"kind": "plan_exited"})
    assert setup.sessions.save(setup.project.sessionId, row.payload, expected_rev=row.rev)
    assert edit(setup).status_code == 403
    assert setup.client.get(setup.url + "/source").status_code == 200


def test_fork_creates_independent_unapproved_session_and_no_workspace_or_data(setup):
    body = {"revision": setup.project.currentRevision, "idempotencyKey": "fork-one"}
    response = setup.client.post(setup.url + "/fork", json=body)
    assert response.status_code == 201, response.text
    value = response.json()
    assert value == setup.client.post(setup.url + "/fork", json=body).json()
    assert value["projectId"] != setup.project.projectId and value["sessionId"] != setup.project.sessionId
    fork = setup.store.get_project(value["projectId"], owner_id="alice")
    state = persistence.load_session_record(value["sessionId"])["session"]
    assert fork.sourceProjectId == setup.project.projectId and fork.sourceRevision == setup.project.currentRevision
    assert state.projectId == fork.projectId and not plan_execution_authorized(state)
    assert setup.store.get_lease(fork.projectId, owner_id="alice") is None
    assert not setup.store.list_project_operations(fork.projectId, owner_id="alice")
    assert setup.store.read_files(fork.projectId, owner_id="alice") == setup.store.read_files(setup.project.projectId, owner_id="alice")
    assert edit(setup).status_code == 200
    body["revision"] = setup.store.get_project(setup.project.projectId, owner_id="alice").currentRevision
    assert setup.client.post(setup.url + "/fork", json=body).status_code == 409


def test_fork_crash_between_project_and_session_is_repairable(setup, monkeypatch):
    original = persistence.claim_session_record
    monkeypatch.setattr(persistence, "claim_session_record", lambda *_: {"ok": False})
    body = {"revision": setup.project.currentRevision, "idempotencyKey": "fork-crash"}
    assert setup.client.post(setup.url + "/fork", json=body).status_code == 503
    monkeypatch.setattr(persistence, "claim_session_record", original)
    assert setup.client.post(setup.url + "/fork", json=body).status_code == 201


def test_fork_requires_its_own_new_plan_then_can_adopt_source_for_execution(setup):
    body = {"revision": setup.project.currentRevision, "idempotencyKey": "fork-approve"}
    fork = setup.client.post(setup.url + "/fork", json=body).json()
    original = setup.store.get_revision(fork["projectId"], owner_id="alice")
    row = setup.sessions.load(fork["sessionId"])
    new_plan = {"planId": "fork-plan", "revision": 1, "planContent": "Continue this independent fork", "reqId": "fork-approval"}
    row.payload["controlTranscript"].extend([{**new_plan, "kind": kind}
        for kind in ("plan_written", "plan_approval", "plan_approved")])
    assert setup.sessions.save(fork["sessionId"], row.payload, expected_rev=row.rev)
    state = persistence.load_session_record(fork["sessionId"])["session"]
    approval = approved_reference(state)
    result = create_session_project(setup.store, fork["sessionId"], owner_id="alice", approval_ref=approval)
    adopted = setup.store.get_revision(fork["projectId"], owner_id="alice")
    assert result.currentRevision == adopted.revision != original.revision
    assert adopted.treeHash == original.treeHash and adopted.planRef == approval
    assert adopted.parentRevision == original.revision
    assert setup.store.get_lease(fork["projectId"], owner_id="alice").sandboxId is None
    assert setup.store.get_project(setup.project.projectId, owner_id="alice").currentRevision == body["revision"]


def test_rollout_disabled_still_exports_owned_source_but_cannot_edit(setup, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    assert setup.client.get(setup.url + "/source").status_code == 200
    assert setup.client.get(setup.url + "/export").status_code == 200
    assert setup.client.get(setup.url + "/revisions").status_code == 200
    assert edit(setup).status_code == 503
    setup.viewer["id"] = "mallory"
    assert setup.client.get(setup.url + "/source").status_code == 404


def test_unreconciled_sandbox_cannot_be_borrowed_for_stopped_edit(setup):
    lease = setup.store.acquire_lease(setup.project.projectId, owner_id="alice", lease_owner="old")
    setup.store.renew_lease(setup.project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="must-be-reconciled")
    setup.store.release_lease(setup.project.projectId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    assert edit(setup).status_code == 409
