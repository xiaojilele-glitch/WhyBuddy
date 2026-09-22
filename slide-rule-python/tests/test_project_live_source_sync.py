"""Model-facing patches run through the real SQL scanner and session authority.

The provider is shared remote state, so restarting the supervisor proves no
second dispatch. Separate E2B smoke tests execute its actual file IO helper.
"""
import json
import threading
from types import SimpleNamespace

import pytest
from project_actor_support import project_actor

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence, project_creation
from services.project_authority import approved_reference
from services.project_manifest import content_hash
from services.project_runtime import REVISION_FILE
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import ProjectConflict, ProjectStore
from services.project_tools import ProjectTools
from services.session_blob_store import SqlSessionBlobStore
from services.workspace_provider import WorkspaceProviderError
from test_project_runtime_worker import Provider, eventually
from test_project_runtime_patch_store import runtime as patch_store_runtime, begin as begin_stored_patch


class SyncProvider(Provider):
    def __init__(self):
        super().__init__()
        self.syncs = []
        self.before_sync = None

    def sync_files(self, handle, *, expected_files, files):
        self.syncs.append((dict(expected_files), dict(files), threading.current_thread().name))
        if self.before_sync:
            self.before_sync()
        if self.contents != expected_files:
            raise WorkspaceProviderError("e2b_source_sync_conflict")
        self.contents = dict(files)

    def probe(self, handle, port, *, expected_revision):
        return super().probe(handle, port, expected_revision=expected_revision) and json.loads(
            self.contents[REVISION_FILE])["revision"] == expected_revision


@pytest.fixture
def live(tmp_path, monkeypatch, project_actor, request):
    project_actor("alice")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({"sessionId": "session-1", "ownerId": "alice",
        "goal": {"text": "Build a task board", "status": "clear"},
        "controlTranscript": approved_plan_rows()})
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    files = {"package.json": "{}", "package-lock.json": "{}", "src/App.tsx": "First task\n",
             "public/remove.txt": "obsolete"}
    monkeypatch.setattr(project_creation, "load_project_template", lambda: (files.copy(), "test-vite-1"))
    provider, workers = SyncProvider(), []
    def worker():
        options = {"poll_interval": 0.03, "lease_ttl": 1, "lifetime_seconds": 90,
            "idle_seconds": 60, **getattr(request, "param", {})}
        result = ProjectRuntimeSupervisor(store, lambda: provider, **options)
        result.start()
        workers.append(result)
        return result
    supervisor = worker()
    tools = ProjectTools(store, supervisor, "alice")
    approval = approved_reference(state)
    project = tools.execute("project_create", {"approvalRef": approval}, state)
    assert project["ok"], project
    start_args = {"approvalRef": approval, "expectedRevision": project["revision"], "idempotencyKey": "start"}
    started = tools.execute("project_start", start_args, state)
    assert started["ok"], started
    def parent():
        return store.get_operation(started["operationId"], owner_id="alice")
    eventually(lambda: parent().runtime and parent().runtime.status == "ready")
    fixture = SimpleNamespace(store=store, sessions=sessions, state=state, files=files, provider=provider,
        worker=worker, supervisor=supervisor, tools=tools, approval=approval, project=project,
        started=started, start_args=start_args, parent=parent)
    yield fixture
    for instance in workers:
        instance.shutdown()
    store.close()
    sessions._engine.dispose()


def patch_args(live, *, content="Updated task\n", path="src/App.tsx"):
    return {"approvalRef": live.approval, "expectedRevision": live.project["revision"], "changes": [
        {"path": path, "expectedSha256": content_hash(live.files[path]) if path in live.files else None,
         "content": content}]}


def patch(live, args=None):
    result = live.tools.execute("project_patch", args or patch_args(live), live.state)
    assert result["ok"], result
    assert result["kind"] == "runtime.patch"
    return result


def child_done(live, submitted):
    result = live.store.get_operation(submitted["operationId"], owner_id="alice")
    return result if result.status in {"completed", "failed", "cancelled"} else None


def test_running_child_cleanup_does_not_require_lease_expiry_or_takeover(patch_store_runtime):
    from services.project_source_sync import _finish_child
    rt = patch_store_runtime
    child = begin_stored_patch(rt)
    rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    task = SimpleNamespace(store=rt.store, owner_id="alice", original=rt.parent,
        operation_id=rt.parent.operationId, lease=rt.lease)
    _finish_child(task, child, "cancelled", error="user_cancelled")
    saved = rt.store.get_operation(child.operationId, owner_id="alice")
    assert saved.status == "cancelled" and saved.leaseGeneration == rt.lease.generation
    assert saved.result["errorCode"] == "user_cancelled" and saved.result["synchronized"] is False


def test_live_tool_patch_uses_same_owner_process_and_durable_new_revision(live):
    original = live.parent()
    args = patch_args(live)
    args["changes"].extend([
        {"path": "public/remove.txt", "expectedSha256": content_hash("obsolete"), "content": None},
        {"path": "src/new.ts", "expectedSha256": None, "content": "export const n=1"},
    ])
    submitted = patch(live, args)
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "completed", done
    assert done.result["synchronized"] and done.result["sourcePublished"]
    parent = live.parent()
    assert parent.runtime.revision == done.result["revision"] != original.expectedRevision
    assert parent.expectedRevision == original.expectedRevision
    assert parent.requestHash == original.requestHash
    assert parent.runtime.processId == original.runtime.processId
    assert live.provider.created == 1 and len(live.provider.commands) == 2
    assert len(live.provider.syncs) == 1 and live.provider.syncs[0][2] == "project-operation"
    assert live.provider.contents["src/App.tsx"] == "Updated task\n"
    assert "public/remove.txt" not in live.provider.contents
    assert live.store.read_files(parent.projectId, original.expectedRevision, owner_id="alice") == live.files
    lease = live.store.get_lease(parent.projectId, owner_id="alice")
    assert lease.mountedRevision == parent.runtime.revision
    assert live.sessions.load(live.state.sessionId).payload["projectRevision"] == parent.runtime.revision
    assert patch(live, args)["operationId"] == submitted["operationId"]
    assert live.tools.execute("project_start", live.start_args, live.state)["operationId"] == parent.operationId
    receipt = live.tools.execute("project_status", {"operationId": submitted["operationId"]}, live.state)
    assert receipt["synchronized"] and receipt["verification"] == "not_run"
    assert receipt["revision"] == parent.runtime.revision
    assert "sourceSync" not in receipt and "sandboxId" not in json.dumps(receipt)


@pytest.mark.parametrize("case,error", [
    ("hash", "project_file_hash_conflict"), ("config", "project_live_patch_requires_restart"),
    ("reserved", "project_reserved_revision_file"), ("escape", "invalid_project_path"),
])
def test_live_invalid_patch_has_no_publication_or_remote_effect(live, case, error):
    args = patch_args(live)
    if case == "hash":
        args["changes"][0]["expectedSha256"] = "0" * 64
    elif case == "config":
        args = patch_args(live, path="package.json", content="new dependencies")
    else:
        args["changes"][0].update(path=REVISION_FILE if case == "reserved" else "../escape", expectedSha256=None)
    result = live.tools.execute("project_patch", args, live.state)
    assert result == {"ok": False, "error": error}
    assert live.store.get_project(live.project["projectId"], owner_id="alice").currentRevision == live.project["revision"]
    assert live.parent().runtime.status == "ready" and not live.provider.syncs


def test_remote_partial_failure_keeps_published_source_but_cannot_be_ready(live):
    def partial():
        live.provider.contents["src/App.tsx"] = "partial"
        raise WorkspaceProviderError("e2b_source_sync_partial")
    live.provider.before_sync = partial
    submitted = patch(live)
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "failed" and done.result["sourcePublished"]
    assert done.result["synchronized"] is False
    eventually(lambda: live.parent().status == "failed")
    assert live.parent().runtime.health == "unknown"
    assert not live.provider.handles
    assert live.store.read_files(live.project["projectId"], owner_id="alice")["src/App.tsx"] == "Updated task\n"


@pytest.mark.parametrize("gap", ["publishing", "dispatching", "written", "advanced", "completed"])
def test_worker_restart_recovers_publication_but_never_replays_unknown_io(live, monkeypatch, gap):
    original_update = live.store.update_runtime_operation
    original_advance = live.store.advance_runtime_revision
    original_transition = live.store.transition_operation
    interrupted = threading.Event()
    def crash():
        if not interrupted.is_set():
            interrupted.set()
            live.supervisor._stop.set()
            raise ProjectConflict("injected_worker_loss")
    def update(*args, **kwargs):
        result = original_update(*args, **kwargs)
        intent = (kwargs.get("result") or {}).get("sourceSync", {})
        if intent.get("phase") == gap:
            crash()
        return result
    def advance(*args, **kwargs):
        result = original_advance(*args, **kwargs)
        if gap == "advanced":
            crash()
        return result
    def transition(*args, **kwargs):
        result = original_transition(*args, **kwargs)
        if gap == "completed" and result.kind == "runtime.patch" and result.status == "completed":
            crash()
        return result
    monkeypatch.setattr(live.store, "update_runtime_operation", update)
    monkeypatch.setattr(live.store, "advance_runtime_revision", advance)
    monkeypatch.setattr(live.store, "transition_operation", transition)
    submitted = patch(live)
    assert interrupted.wait(6)
    live.supervisor.shutdown()
    before = len(live.provider.syncs)
    second = live.worker()
    done = eventually(lambda: child_done(live, submitted))
    if gap == "dispatching":
        assert done.status == "failed" and done.result["sourcePublished"]
        eventually(lambda: live.parent().status == "failed")
        assert not live.provider.syncs and not live.provider.handles
    else:
        eventually(lambda: live.parent().runtime.status == "ready" and not live.parent().result.get("sourceSync"))
        assert live.store.get_operation(submitted["operationId"], owner_id="alice").status == "completed"
        assert len([a for a, b, _ in live.provider.syncs if a != b]) == 1
        if before:
            assert all(a == b for a, b, _ in live.provider.syncs[before:])
        assert live.provider.created == 1 and len(live.provider.commands) == 2
    second.cancel(live.started["operationId"], owner_id="alice")


def test_queued_child_cancel_keeps_parent_and_source_healthy(live, monkeypatch):
    import services.project_runtime_worker as worker_module
    actual = worker_module.sync_next_source_patch
    allow = threading.Event()
    monkeypatch.setattr(worker_module, "sync_next_source_patch", lambda *a, **k: actual(*a, **k) if allow.is_set() else False)
    submitted = patch(live)
    live.supervisor.cancel(submitted["operationId"], owner_id="alice")
    allow.set()
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "cancelled"
    assert live.parent().runtime.status == "ready" and live.provider.handles
    assert not live.provider.syncs
    assert live.store.get_project(live.project["projectId"], owner_id="alice").currentRevision == live.project["revision"]


def test_competing_queued_patches_do_not_overwrite_the_first_publication(live, monkeypatch):
    import services.project_runtime_worker as worker_module
    actual = worker_module.sync_next_source_patch
    allow = threading.Event()
    monkeypatch.setattr(worker_module, "sync_next_source_patch", lambda *a, **k: actual(*a, **k) if allow.is_set() else False)
    one = patch(live)
    two = patch(live, patch_args(live, content="Competing task"))
    allow.set()
    outcomes = [eventually(lambda item=item: child_done(live, item)) for item in (one, two)]
    assert sorted(item.status for item in outcomes) == ["completed", "failed"]
    failed = next(item for item in outcomes if item.status == "failed")
    assert failed.result["errorCode"] == "project_revision_conflict"
    assert len(live.provider.syncs) == 1
    assert live.parent().runtime.status == "ready"


@pytest.mark.parametrize("boundary", ["queued", "before_commit", "after_commit", "after_sync"])
def test_parent_cancel_never_delivers_patch_success_and_keeps_true_source(live, monkeypatch, boundary):
    import services.project_runtime_worker as worker_module
    original_commit = live.store.commit_revision
    original_sync = live.provider.sync_files
    original_run = worker_module.sync_next_source_patch
    cancelled = threading.Event()
    generation = live.parent().leaseGeneration
    def cancel():
        if not cancelled.is_set():
            cancelled.set()
            live.supervisor.cancel(live.started["operationId"], owner_id="alice")
    def commit(*args, **kwargs):
        if boundary == "before_commit":
            cancel()
        result = original_commit(*args, **kwargs)
        if boundary == "after_commit":
            cancel()
        return result
    def sync(*args, **kwargs):
        result = original_sync(*args, **kwargs)
        if boundary == "after_sync":
            cancel()
        return result
    def run(*args, **kwargs):
        if boundary == "queued" and live.store.list_runtime_patches(live.started["operationId"], owner_id="alice"):
            cancel()
        return original_run(*args, **kwargs)
    monkeypatch.setattr(live.store, "commit_revision", commit)
    monkeypatch.setattr(live.provider, "sync_files", sync)
    monkeypatch.setattr(worker_module, "sync_next_source_patch", run)
    submitted = patch(live)
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "cancelled" and not done.result["synchronized"]
    assert done.result["sourcePublished"] == (boundary in {"after_commit", "after_sync"})
    eventually(lambda: live.parent().status == "cancelled")
    assert live.parent().leaseGeneration == generation
    assert live.parent().runtime.status == "stopped" and not live.provider.handles
    source = live.store.read_files(live.project["projectId"], owner_id="alice")
    assert source["src/App.tsx"] == ("Updated task\n" if done.result["sourcePublished"] else live.files["src/App.tsx"])


def test_revoked_plan_between_queue_and_worker_dispatch_prevents_io(live, monkeypatch):
    import services.project_runtime_worker as worker_module
    actual = worker_module.sync_next_source_patch
    allow = threading.Event()
    monkeypatch.setattr(worker_module, "sync_next_source_patch", lambda *a, **k: actual(*a, **k) if allow.is_set() else False)
    submitted = patch(live)
    row = live.sessions.load(live.state.sessionId)
    live.sessions.save(live.state.sessionId, {**row.payload, "controlTranscript": approved_plan_rows()[:-1]}, expected_rev=row.rev)
    allow.set()
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "failed" and not done.result["sourcePublished"]
    assert not live.provider.syncs
    eventually(lambda: live.parent().status == "failed")
    assert not live.provider.handles


def test_revoked_plan_after_source_publication_prevents_remote_write(live, monkeypatch):
    original = live.store.commit_revision
    def commit(*args, **kwargs):
        result = original(*args, **kwargs)
        row = live.sessions.load(live.state.sessionId)
        live.sessions.save(live.state.sessionId, {**row.payload,
            "controlTranscript": approved_plan_rows()[:-1]}, expected_rev=row.rev)
        return result
    monkeypatch.setattr(live.store, "commit_revision", commit)
    submitted = patch(live)
    done = eventually(lambda: child_done(live, submitted))
    assert done.status == "failed" and done.result["sourcePublished"]
    assert not done.result["synchronized"] and not live.provider.syncs
    eventually(lambda: live.parent().status == "failed")
    assert not live.provider.handles


def test_steady_ready_restart_uses_advanced_revision_and_original_request(live):
    submitted = patch(live)
    assert eventually(lambda: child_done(live, submitted)).status == "completed"
    eventually(lambda: not live.parent().result.get("sourceSync"))
    before = live.parent()
    live.supervisor.shutdown()
    live.worker()
    eventually(lambda: live.parent().runtime.status == "ready")
    assert live.parent().runtime.revision == before.runtime.revision
    assert live.parent().expectedRevision == live.project["revision"]
    assert len(live.provider.syncs) == 1 and live.provider.created == 1


def test_http_start_retry_after_live_patch_returns_original_request(live, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from middlewares.current_user import require_user
    from routes import project_runtime as route
    from services.identity_store import User
    monkeypatch.setattr(route, "get_project_store", lambda: live.store)
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(route.settings, "NODE_ENV", "development")
    app = FastAPI()
    app.include_router(route.router)
    app.state.project_runtime_supervisor = live.supervisor
    app.dependency_overrides[require_user] = lambda: User(id="alice", is_superuser=True)
    submitted = patch(live)
    assert eventually(lambda: child_done(live, submitted)).status == "completed"
    with TestClient(app) as client:
        url = f"/projects/{live.project['projectId']}/runtime/start"
        retried = client.post(url, json=live.start_args)
        assert retried.status_code == 202, retried.text
        assert retried.json()["operation"]["operationId"] == live.started["operationId"]
        assert retried.json()["runtime"]["revision"] == live.parent().runtime.revision
        rejected = client.post(url, json={**live.start_args, "idempotencyKey": "new-stale-request"})
        assert rejected.status_code == 409
        assert rejected.json()["detail"] == "project_revision_conflict"
    assert live.provider.created == 1 and len(live.provider.commands) == 2
