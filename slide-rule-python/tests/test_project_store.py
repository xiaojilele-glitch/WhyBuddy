"""Restart, collision and stale-writer checks against a real SQL database.

The second adapter uses HttpSqlGateway's actual parameter encoding and JSON
transport, backed by SQLite for deterministic contract checks. PostgreSQL wire
compatibility is separately smoke-tested when a dedicated test DB is available.
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from sqlalchemy import text

from models.project_runtime import RuntimeInstance
from services import project_store as module
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.sql_gateway import HttpSqlGateway


@pytest.fixture(params=["sql", "http"])
def store(request, tmp_path):
    base = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    if request.param == "sql":
        yield base
    else:
        def respond(req):
            body = json.loads(req.content)
            values = body["params"]
            parts = body["sql"].split("%s")
            sql = "".join(part + (f":p{i}" if i < len(parts) - 1 else "") for i, part in enumerate(parts))
            with base._engine.begin() as conn:
                result = conn.execute(text(sql), {f"p{i}": value for i, value in enumerate(values)})
                rows = [dict(row) for row in result.mappings()] if result.returns_rows else []
            return httpx.Response(200, json={"rows": rows, "truncated": False})
        gateway = HttpSqlGateway("https://project-db.test", "test-only-key")
        gateway._client.close()
        gateway._client = httpx.Client(transport=httpx.MockTransport(respond))
        proxy = ProjectStore(lambda sql, params: gateway.query(sql, params))
        yield proxy
        gateway._client.close()
    base.close()


def create(store, sid="s1", owner="alice"):
    return store.create_project(sid, owner_id=owner, files={"src/main.ts": "original", "package.json": "{}"},
        template_version="vite-1", plan_ref="plan-1")


def commit(store, project, value="updated", **kwargs):
    return store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        files={"src/main.ts": value, "package.json": "{}"}, template_version="vite-1", plan_ref="plan-1", **kwargs)


def operation(store, project, key="call-1"):
    return store.create_operation(project.projectId, owner_id="alice", kind="preview.start", idempotency_key=key,
        expected_revision=project.currentRevision, approval_ref="plan-1", input={"port": 5173})


def test_sources_survive_new_store_and_old_revisions_are_immutable(tmp_path):
    url = f"sqlite:///{tmp_path / 'restart.db'}"
    first = ProjectStore.from_url(url)
    project = create(first)
    revision = commit(first, project)
    first.close()
    second = ProjectStore.from_url(url)
    assert second.get_project(project.projectId, owner_id="alice").currentRevision == revision.revision
    assert second.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "updated"
    assert second.read_files(project.projectId, project.currentRevision, owner_id="alice")["src/main.ts"] == "original"
    second.close()


def test_source_cas_rejects_stale_editor_and_keeps_the_winner(store):
    project = create(store)
    winner = commit(store, project, "winner")
    with pytest.raises(ProjectConflict, match="revision_conflict"):
        commit(store, project, "loser")
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == winner.revision
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "winner"


def test_other_owner_cannot_read_write_lease_or_create_same_session(store):
    project = create(store)
    assert store.get_project_for_session("s1", owner_id="bob") is None
    with pytest.raises(ProjectNotFound):
        create(store, owner="bob")
    with pytest.raises(ProjectNotFound):
        store.get_revision(project.projectId, owner_id="bob")
    with pytest.raises(ProjectNotFound):
        store.acquire_lease(project.projectId, owner_id="bob", lease_owner="worker")
    with pytest.raises(ProjectNotFound):
        store.commit_revision(project.projectId, owner_id="bob", expected_revision=project.currentRevision,
            files={"x": "bad"}, template_version="v", plan_ref="p")


def test_create_is_idempotent_and_never_reinitializes_source(store):
    project = create(store)
    revision = commit(store, project)
    again = create(store)
    assert again.projectId == project.projectId
    assert again.currentRevision == revision.revision


def test_failed_publication_never_exposes_uncommitted_revision(store, monkeypatch):
    project = create(store)
    original = store._q
    def fail_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_publish)
    with pytest.raises(ProjectConflict):
        commit(store, project)
    rows = original("select id from wb_project_revision where project_id=$1", [project.projectId])
    orphan = next(row["id"] for row in rows if row["id"] != project.currentRevision)
    with pytest.raises(ProjectNotFound):
        store.get_revision(project.projectId, orphan, owner_id="alice")
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"


def test_expired_worker_cannot_publish_or_renew_after_takeover(store, monkeypatch):
    project = create(store)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    with pytest.raises(ProjectConflict):
        store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    with pytest.raises(ProjectConflict):
        commit(store, project)
    clock[0] += 11
    new = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    assert new.generation == first.generation + 1
    with pytest.raises(ProjectConflict):
        commit(store, project, lease_generation=first.generation, lease_owner="old")
    with pytest.raises(ProjectConflict):
        store.renew_lease(project.projectId, owner_id="alice", generation=first.generation, lease_owner="old")
    revision = commit(store, project, lease_generation=new.generation, lease_owner="new")
    renewed = store.renew_lease(project.projectId, owner_id="alice", generation=new.generation, lease_owner="new",
        sandbox_id="sandbox-a", mounted_revision=revision.revision)
    assert renewed.mountedRevision == revision.revision
    store.release_lease(project.projectId, owner_id="alice", generation=new.generation, lease_owner="new")
    third = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="third")
    assert third.generation == new.generation + 1
    assert third.sandboxId == "sandbox-a"


def test_append_event_wakes_in_process_waiters(store):
    """通电：写下一条就叫醒 SSE，不许靠浏览器空转 afterSeq。"""
    project = create(store)
    op = operation(store, project)
    woke = []

    def wait():
        woke.append(store.wait_for_events(op.operationId, 1.5))

    worker = threading.Thread(target=wait)
    worker.start()
    deadline = time.time() + 1
    while time.time() < deadline and op.operationId not in module._EVENT_WAITERS:
        time.sleep(0.01)
    store.append_event(op.operationId, owner_id="alice", event_type="runtime.console",
                       payload={"data": "n"})
    worker.join(timeout=2)
    assert woke == [True]


def test_operations_and_events_recover_and_idempotency_detects_changed_input(store):
    project = create(store)
    op = operation(store, project)
    assert operation(store, project).operationId == op.operationId
    with pytest.raises(ProjectConflict, match="idempotency"):
        store.create_operation(project.projectId, owner_id="alice", kind="preview.stop", idempotency_key="call-1",
            expected_revision=project.currentRevision, approval_ref="plan-1")
    running = store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running")
    assert running.status == "running"
    one = store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "你好"})
    assert store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "你好"}) == one
    with pytest.raises(ProjectConflict, match="event_idempotency"):
        store.append_event(op.operationId, owner_id="alice", event_type="log", event_id="chunk-1", payload={"text": "different"})
    two = store.append_event(op.operationId, owner_id="alice", event_type="ready")
    assert [e.seq for e in store.list_events(op.operationId, owner_id="alice", after_seq=1)] == [2]
    assert two.seq == 2
    done = store.transition_operation(op.operationId, owner_id="alice", expected_status="running", status="completed", result={"port": 5173})
    assert done.result == {"port": 5173}
    with pytest.raises(ProjectConflict):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="completed", status="running")
    with pytest.raises(ProjectNotFound):
        store.get_operation(op.operationId, owner_id="bob")
    with pytest.raises(ProjectNotFound):
        store.list_events(op.operationId, owner_id="bob")


def test_stale_worker_cannot_complete_operation_or_emit_evidence(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running",
        lease_generation=lease.generation, lease_owner="old")
    clock[0] += 11
    store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    with pytest.raises(ProjectConflict):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="running", status="completed",
            lease_generation=lease.generation, lease_owner="old")
    with pytest.raises(ProjectConflict):
        store.append_event(op.operationId, owner_id="alice", event_type="passed", lease_generation=lease.generation, lease_owner="old")
    assert store.list_events(op.operationId, owner_id="alice") == []
    assert store.get_operation(op.operationId, owner_id="alice").status == "running"


def test_concurrent_writers_share_cas_and_event_cursor(tmp_path):
    url = f"sqlite:///{tmp_path / 'concurrent.db'}"
    a, b = ProjectStore.from_url(url), ProjectStore.from_url(url)
    project = create(a)
    op = operation(a, project)
    def write_event(index):
        return (a if index % 2 else b).append_event(op.operationId, owner_id="alice", event_type="log", payload={"i": index})
    with ThreadPoolExecutor(max_workers=4) as pool:
        events = list(pool.map(write_event, range(12)))
    assert sorted(e.seq for e in events) == list(range(1, 13))
    assert len({e.payload["i"] for e in b.list_events(op.operationId, owner_id="alice")}) == 12
    a.close()
    b.close()


def test_corrupt_blob_never_restores_as_valid_source(store):
    project = create(store)
    revision = store.get_revision(project.projectId, owner_id="alice")
    store._q("update wb_project_content set content=$1 where hash=$2", ["corrupted", revision.manifest.files[0].sha256])
    with pytest.raises(ProjectStoreUnavailable, match="corrupt"):
        store.read_files(project.projectId, owner_id="alice")


def test_store_failure_never_falls_back_to_memory_or_files(monkeypatch):
    module.reset_project_store()
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("https://broken.test", "test-key"))
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(HttpSqlGateway, "query", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")))
    with pytest.raises(ProjectStoreUnavailable):
        module.get_project_store()
    assert module._cached_store is None
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("", ""))
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", None)
    with pytest.raises(ProjectStoreUnavailable, match="durable_database_required"):
        module.get_project_store()


def test_production_requires_remote_durable_database(monkeypatch):
    module.reset_project_store()
    monkeypatch.setattr(module, "http_api_credentials", lambda: ("", ""))
    monkeypatch.setattr(module.settings, "NODE_ENV", "production")
    monkeypatch.setattr(module.settings, "APP_STORE_DATABASE_URL", "sqlite:///:memory:")
    with pytest.raises(ProjectStoreUnavailable, match="durable_database_required"):
        module.get_project_store()


def test_new_worker_claims_interrupted_operation_before_reconciling(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old", ttl_seconds=10)
    claimed = store.claim_operation(op.operationId, owner_id="alice", lease_owner="old", generation=first.generation)
    assert claimed.status == "queued"
    store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="running",
        result={"remoteProcessId": "42"}, lease_generation=first.generation, lease_owner="old")
    clock[0] += 11
    new = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    recovered = store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation)
    assert recovered.status == "interrupted"
    assert recovered.result == {"remoteProcessId": "42"}
    assert recovered.requestHash == op.requestHash and recovered.input == op.input
    assert store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation) == recovered
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="old", generation=first.generation)
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="interrupted", status="running",
            lease_generation=first.generation, lease_owner="old")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.append_event(op.operationId, owner_id="alice", event_type="done", lease_generation=first.generation, lease_owner="old")
    event = store.append_event(op.operationId, owner_id="alice", event_type="reconciled", payload={"stopped": True},
        lease_generation=new.generation, lease_owner="new")
    assert event.type == "reconciled"
    cancelled = store.transition_operation(op.operationId, owner_id="alice", expected_status="interrupted", status="cancelled",
        lease_generation=new.generation, lease_owner="new")
    assert cancelled.status == "cancelled"
    with pytest.raises(ProjectConflict, match="state_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="new", generation=new.generation)
    with pytest.raises(ProjectNotFound):
        store.claim_operation(op.operationId, owner_id="bob", lease_owner="new", generation=new.generation)


def test_claim_checks_current_lease_again_at_cas(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker", ttl_seconds=10)
    original = store._q
    def expire_before_write(sql, params=None):
        if sql.startswith("update wb_project_operation set"):
            original("update wb_project_lease set expires_at=0 where project_id=$1", [project.projectId])
        return original(sql, params)
    monkeypatch.setattr(store, "_q", expire_before_write)
    with pytest.raises(ProjectConflict, match="state_or_lease_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="worker", generation=lease.generation)
    assert store.get_operation(op.operationId, owner_id="alice").leaseGeneration is None


def test_claim_does_not_overwrite_concurrent_operation_progress(store, monkeypatch):
    project = create(store)
    op = operation(store, project)
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker")
    original = store._q
    def race_before_write(sql, params=None):
        if sql.startswith("update wb_project_operation set"):
            original("update wb_project_operation set rev=rev+1 where id=$1", [op.operationId])
        return original(sql, params)
    monkeypatch.setattr(store, "_q", race_before_write)
    with pytest.raises(ProjectConflict, match="state_or_lease_conflict"):
        store.claim_operation(op.operationId, owner_id="alice", lease_owner="worker", generation=lease.generation)
    assert store.get_operation(op.operationId, owner_id="alice").leaseGeneration is None


def test_release_clears_only_confirmed_runtime_for_the_current_generation(store):
    project = create(store)
    first = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="worker")
    store.renew_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation,
        sandbox_id="sandbox-old", mounted_revision=project.currentRevision, process_refs={"runtime": "42"})
    store.release_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation, clear_runtime=True)
    cleared = store.get_lease(project.projectId, owner_id="alice")
    assert cleared.sandboxId is None and cleared.mountedRevision is None and cleared.processRefs == {}
    second = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    store.renew_lease(project.projectId, owner_id="alice", lease_owner="new", generation=second.generation, sandbox_id="sandbox-new")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        store.release_lease(project.projectId, owner_id="alice", lease_owner="worker", generation=first.generation, clear_runtime=True)
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-new"


@pytest.mark.parametrize("quota", ["revisions", "bytes"])
def test_failed_publications_reserve_quota_before_writing_any_source(store, monkeypatch, quota):
    project = create(store)
    if quota == "revisions":
        monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    else:
        monkeypatch.setattr(module, "MAX_SOURCE_HISTORY_BYTES", 10 + 12)
    original = store._q
    def reject_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", reject_publish)
    with pytest.raises(ProjectConflict):
        commit(store, project, "0123456789")
    before = original("select hash from wb_project_content")
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(store, project, "abcdefghij")
    assert original("select hash from wb_project_content") == before
    budget = original("select * from wb_project_source_budget where project_id=$1", [project.projectId])[0]
    assert budget["reserved_revisions"] == 2 and budget["reserved_bytes"] == 22
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == project.currentRevision


def test_failed_source_upload_keeps_reservation_after_store_restart(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'failed-upload.db'}"
    store = ProjectStore.from_url(url)
    project = create(store)
    monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    original = store._q
    def fail_upload(sql, params=None):
        if sql.startswith("insert into wb_project_content"):
            raise ProjectStoreUnavailable("upload_interrupted")
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_upload)
    with pytest.raises(ProjectStoreUnavailable, match="upload_interrupted"):
        commit(store, project)
    store.close()
    restored = ProjectStore.from_url(url)
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(restored, project)
    assert restored.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"
    restored.close()


def test_history_reservation_is_atomic_across_concurrent_failed_writes(store, monkeypatch):
    project = create(store)
    monkeypatch.setattr(module, "MAX_REVISIONS", 3)
    original = store._q
    def reject_publish(sql, params=None):
        if sql.startswith("update wb_project set"):
            return []
        return original(sql, params)
    monkeypatch.setattr(store, "_q", reject_publish)
    def attempt(index):
        try:
            commit(store, project, f"attempt-{index}")
        except (ProjectConflict, ValueError) as exc:
            return str(exc)
    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(attempt, range(10)))
    assert outcomes.count("project_revision_or_lease_conflict") == 2
    assert outcomes.count("project_history_limit") == 8
    assert len(original("select id from wb_project_revision where project_id=$1", [project.projectId])) == 3


def test_existing_orphan_revisions_count_when_budget_is_initialized(store, monkeypatch):
    project = create(store)
    store._write_revision(project.projectId, {"orphan.ts": "unpublished"}, parent=project.currentRevision,
        template_version="v", plan_ref="p", spec_revision=None)
    store._q("delete from wb_project_source_budget where project_id=$1", [project.projectId])
    monkeypatch.setattr(module, "MAX_REVISIONS", 2)
    with pytest.raises(ValueError, match="project_history_limit"):
        commit(store, project)
    assert store.read_files(project.projectId, owner_id="alice")["src/main.ts"] == "original"


def test_failed_initial_upload_cannot_repeatedly_reinitialize_its_budget(store, monkeypatch):
    monkeypatch.setattr(module, "MAX_REVISIONS", 1)
    original = store._q
    def fail_upload(sql, params=None):
        if sql.startswith("insert into wb_project_content"):
            raise ProjectStoreUnavailable("upload_interrupted")
        return original(sql, params)
    monkeypatch.setattr(store, "_q", fail_upload)
    with pytest.raises(ProjectStoreUnavailable, match="upload_interrupted"):
        create(store)
    monkeypatch.setattr(store, "_q", original)
    with pytest.raises(ValueError, match="project_history_limit"):
        create(store)
    assert store.get_project_for_session("s1", owner_id="alice") is None
    assert store._q("select hash from wb_project_content") == []


def test_invalid_or_unleased_write_does_not_consume_history_budget(store):
    project = create(store)
    store.acquire_lease(project.projectId, owner_id="alice", lease_owner="active")
    with pytest.raises(ProjectConflict, match="lease_lost"):
        commit(store, project)
    with pytest.raises(ValueError, match="invalid_project_path"):
        store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            files={"../escape": "bad"}, template_version="v", plan_ref="p")
    budget = store._q("select * from wb_project_source_budget where project_id=$1", [project.projectId])[0]
    assert budget["reserved_revisions"] == 1 and budget["reserved_bytes"] == 10


def runtime_operation(store, project, key="runtime-1", worker="worker", ttl=120, kind="runtime.start"):
    op = store.create_operation(project.projectId, owner_id="alice", kind=kind,
        idempotency_key=key, expected_revision=project.currentRevision, approval_ref="plan-1")
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner=worker, ttl_seconds=ttl)
    op = store.claim_operation(op.operationId, owner_id="alice", generation=lease.generation, lease_owner=worker)
    runtime = RuntimeInstance(runtimeId="rt-" + op.operationId, workspaceId=lease.workspaceId,
        projectId=project.projectId, revision=project.currentRevision, status="provisioning", port=5173,
        lastHeartbeat=op.updatedAt, expiresAt=2000.0)
    return op, lease, runtime


def runtime_update(store, op, lease, runtime, status="running", **kwargs):
    return store.update_runtime_operation(op.operationId, owner_id="alice", expected_status=op.status,
        status=status, runtime=runtime, lease_generation=lease.generation, lease_owner=lease.leaseOwner, **kwargs)


def runtime_flush(store, op, lease):
    return store.flush_operation_event(op.operationId, owner_id="alice",
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)


def test_runtime_state_and_outbox_are_atomic_and_prior_state_flushes_before_next(store):
    op, lease, runtime = runtime_operation(store, create(store))
    started = runtime_update(store, op, lease, runtime)
    assert started.stateVersion == 1 and started.pendingEvent["payload"]["runtime"]["status"] == "provisioning"
    assert store.list_events(op.operationId, owner_id="alice") == []
    ready = runtime_update(store, started, lease, runtime.model_copy(update={"status": "ready"}))
    assert ready.stateVersion == 2 and ready.pendingEvent is not None
    assert [e.payload["runtime"]["status"] for e in store.list_events(op.operationId, owner_id="alice")] == ["provisioning"]
    event = runtime_flush(store, ready, lease)
    assert event.seq == 2 and event.payload["runtime"]["status"] == "ready"
    assert runtime_flush(store, ready, lease) is None
    snapshot = store.snapshot_operation(op.operationId, owner_id="alice")
    assert snapshot["operation"].pendingEvent is None and snapshot["runtime"].status == "ready" and snapshot["lastSeq"] == 2
    with pytest.raises(ProjectNotFound):
        store.snapshot_operation(op.operationId, owner_id="bob")


def test_runtime_update_keeps_cancel_requested_between_read_and_cas(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    original = store._q
    raced = [False]
    def cancel_before_update(sql, params=None):
        if sql.startswith("update wb_project_operation set") and not raced[0]:
            raced[0] = True
            store.request_operation_cancel(op.operationId, owner_id="alice")
        return original(sql, params)
    monkeypatch.setattr(store, "_q", cancel_before_update)
    updated = runtime_update(store, op, lease, runtime)
    assert updated.cancelRequested is True and updated.runtime == runtime
    assert updated.pendingEvent["payload"]["cancelRequested"] is True
    assert store.request_operation_cancel(op.operationId, owner_id="alice") == updated


def test_runtime_update_keeps_activity_between_read_and_cas(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    original = store._q
    raced = [False]

    def touch_before_update(sql, params=None):
        if sql.startswith("update wb_project_operation set") and not raced[0]:
            raced[0] = True
            store.touch_operation(op.operationId, owner_id="alice")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", touch_before_update)
    updated = runtime_update(store, op, lease, runtime)
    assert updated.lastAccessAt is not None and updated.runtime == runtime
    store.request_operation_cancel(op.operationId, owner_id="alice")
    assert store.touch_operation(op.operationId, owner_id="alice").lastAccessAt == updated.lastAccessAt
    with pytest.raises(ProjectNotFound):
        store.touch_operation(op.operationId, owner_id="bob")


def test_queued_requests_cannot_starve_or_replace_the_recovering_runtime(store):
    project = create(store)
    queued = [store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key=f"queued-{i}", expected_revision=project.currentRevision, approval_ref="plan-1") for i in range(12)]
    active = max(queued, key=lambda operation: operation.operationId)
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old-worker")
    store.claim_operation(active.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    store.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation,
        process_refs={"operationId": active.operationId}, sandbox_id="saved-sandbox")
    store.release_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    runnable = store.list_runnable_operations(limit=1)
    assert [operation.operationId for operation, _ in runnable] == [active.operationId]


def test_cancel_cas_keeps_concurrent_runtime_progress(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    original = store._q
    raced = [False]
    def update_before_cancel(sql, params=None):
        if sql.startswith("update wb_project_operation set") and not raced[0]:
            raced[0] = True
            runtime_update(store, op, lease, runtime)
        return original(sql, params)
    monkeypatch.setattr(store, "_q", update_before_cancel)
    cancelled = store.request_operation_cancel(op.operationId, owner_id="alice")
    assert cancelled.cancelRequested and cancelled.status == "running"
    assert cancelled.runtime == runtime and cancelled.stateVersion == 1 and cancelled.pendingEvent is not None
    with pytest.raises(ProjectNotFound):
        store.request_operation_cancel(op.operationId, owner_id="bob")


def test_flush_cas_does_not_clear_a_replacement_outbox(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    started = runtime_update(store, op, lease, runtime)
    original = store._q
    raced = [False]
    def replace_before_clear(sql, params=None):
        if sql.startswith("update wb_project_operation set") and not raced[0]:
            raced[0] = True
            runtime_flush(store, started, lease)
            runtime_update(store, started, lease, runtime.model_copy(update={"status": "ready"}))
        return original(sql, params)
    monkeypatch.setattr(store, "_q", replace_before_clear)
    first = runtime_flush(store, started, lease)
    current = store.get_operation(op.operationId, owner_id="alice")
    assert first.seq == 1 and current.pendingEvent["payload"]["runtime"]["status"] == "ready"
    assert runtime_flush(store, current, lease).seq == 2
    assert [event.seq for event in store.list_events(op.operationId, owner_id="alice")] == [1, 2]


@pytest.mark.parametrize("kind", ["runtime.start", "runtime.exec"])
def test_recovery_replays_old_outbox_then_records_reconciling_without_losing_cancel(store, monkeypatch, kind):
    project = create(store)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    op, old, runtime = runtime_operation(store, project, worker="old", ttl=10, kind=kind)
    runtime_update(store, op, old, runtime.model_copy(update={"status": "ready", "processId": "42"}))
    store.request_operation_cancel(op.operationId, owner_id="alice")
    clock[0] += 11
    new = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    claimed = store.claim_operation(op.operationId, owner_id="alice", generation=new.generation, lease_owner="new")
    assert claimed.status == "interrupted" and claimed.runtime.status == "reconciling" and claimed.cancelRequested
    assert claimed.runtime.processId == "42" and claimed.stateVersion == 2
    assert [event.payload["runtime"]["status"] for event in store.list_events(op.operationId, owner_id="alice")] == ["ready"]
    runtime_flush(store, claimed, new)
    assert [event.payload["runtime"]["status"] for event in store.list_events(op.operationId, owner_id="alice")] == ["ready", "reconciling"]
    with pytest.raises(ProjectConflict, match="lease_lost"):
        runtime_flush(store, claimed, old)
    with pytest.raises(ProjectConflict):
        runtime_update(store, claimed, old, runtime)


@pytest.mark.parametrize("crash_after_event_insert", [False, True])
@pytest.mark.parametrize("kind", ["runtime.start", "runtime.exec"])
def test_terminal_outbox_survives_database_reopen_and_fenced_takeover(tmp_path, monkeypatch, crash_after_event_insert, kind):
    url = f"sqlite:///{tmp_path / 'runtime-restart.db'}"
    first = ProjectStore.from_url(url)
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    project = create(first)
    op, old, runtime = runtime_operation(first, project, worker="old", ttl=10, kind=kind)
    running = runtime_update(first, op, old, runtime)
    failed = runtime_update(first, running, old, runtime.model_copy(update={"status": "failed", "errorCode": "install_failed"}), status="failed")
    if crash_after_event_insert:
        original = first._q
        def crash_before_clear(sql, params=None):
            if sql.startswith("update wb_project_operation set"):
                raise ProjectStoreUnavailable("simulated_process_exit")
            return original(sql, params)
        monkeypatch.setattr(first, "_q", crash_before_clear)
        with pytest.raises(ProjectStoreUnavailable):
            runtime_flush(first, failed, old)
    first.close()
    clock[0] += 11
    second = ProjectStore.from_url(url)
    runnable = second.list_runnable_operations()
    assert len(runnable) == 1 and runnable[0][0].status == "failed" and runnable[0][1] == "alice"
    new = second.acquire_lease(project.projectId, owner_id="alice", lease_owner="new")
    claimed = second.claim_operation(op.operationId, owner_id="alice", generation=new.generation, lease_owner="new")
    assert claimed.status == "failed" and claimed.pendingEvent is None and claimed.runtime.errorCode == "install_failed"
    snapshot = second.snapshot_operation(op.operationId, owner_id="alice")
    assert snapshot["lastSeq"] == 2 and snapshot["runtime"].status == "failed"
    assert [event.payload["runtime"]["status"] for event in second.list_events(op.operationId, owner_id="alice")] == ["provisioning", "failed"]
    assert second.list_runnable_operations() == []
    assert second.request_operation_cancel(op.operationId, owner_id="alice").cancelRequested is False
    second.close()


def test_runtime_update_rejects_cross_project_and_revision_identity(store):
    op, lease, runtime = runtime_operation(store, create(store))
    for field, value in [("projectId", "other"), ("revision", "old"), ("workspaceId", "other")]:
        with pytest.raises(ProjectConflict, match="runtime_operation_mismatch"):
            runtime_update(store, op, lease, runtime.model_copy(update={field: value}))
    running = runtime_update(store, op, lease, runtime)
    for field, value in [("runtimeId", "other"), ("workspaceId", "other")]:
        with pytest.raises(ProjectConflict, match="runtime_operation_mismatch"):
            runtime_update(store, running, lease, runtime.model_copy(update={field: value}))
    with pytest.raises(ProjectConflict, match="runtime_operation_update_required"):
        store.transition_operation(op.operationId, owner_id="alice", expected_status="running", status="failed",
            lease_generation=lease.generation, lease_owner=lease.leaseOwner)


def test_runtime_same_status_race_cannot_replace_newer_progress(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    running = runtime_update(store, op, lease, runtime)
    runtime_flush(store, running, lease)
    original = store._q
    raced = [False]
    def progress_before_update(sql, params=None):
        if sql.startswith("update wb_project_operation set") and not raced[0]:
            raced[0] = True
            runtime_update(store, running, lease, runtime.model_copy(update={"status": "ready"}))
        return original(sql, params)
    monkeypatch.setattr(store, "_q", progress_before_update)
    with pytest.raises(ProjectConflict, match="state_or_lease_conflict"):
        runtime_update(store, running, lease, runtime.model_copy(update={"status": "installing"}))
    current = store.get_operation(op.operationId, owner_id="alice")
    assert current.runtime.status == "ready" and current.pendingEvent["payload"]["runtime"]["status"] == "ready"


def test_runtime_state_and_outbox_clear_are_fenced_at_database_write(store, monkeypatch):
    op, lease, runtime = runtime_operation(store, create(store))
    running = runtime_update(store, op, lease, runtime)
    original = store._q
    def expire_before_clear(sql, params=None):
        if sql.startswith("update wb_project_operation set"):
            original("update wb_project_lease set expires_at=0 where project_id=$1", [op.projectId])
        return original(sql, params)
    monkeypatch.setattr(store, "_q", expire_before_clear)
    with pytest.raises(ProjectConflict):
        runtime_flush(store, running, lease)
    current = store.get_operation(op.operationId, owner_id="alice")
    assert current.pendingEvent == running.pendingEvent
    assert [event.seq for event in store.list_events(op.operationId, owner_id="alice")] == [1]
    with pytest.raises(ProjectConflict):
        runtime_update(store, running, lease, runtime.model_copy(update={"status": "ready"}))
    assert store.get_operation(op.operationId, owner_id="alice").runtime.status == "provisioning"


def test_runtime_scan_passes_completed_pages_and_busy_projects_to_find_expired_work(store, monkeypatch):
    project = create(store)
    for index in range(105):
        op = store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
            idempotency_key=f"old-{index}", expected_revision=project.currentRevision, approval_ref="plan-1")
        store.transition_operation(op.operationId, owner_id="alice", expected_status="queued", status="failed")
        store._q("update wb_project_operation set id=$1 where id=$2", [f"pop-000-{index:03}", op.operationId])
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    busy, _, _ = runtime_operation(store, create(store, sid="busy"), worker="busy")
    expired, _, _ = runtime_operation(store, create(store, sid="expired"), worker="old", ttl=10)
    clock[0] += 11
    assert [(op.operationId, owner) for op, owner in store.list_runnable_operations(limit=1)] == [(expired.operationId, "alice")]
    assert busy.operationId != expired.operationId


_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_preview_snapshot_is_not_a_verification_receipt(store):
    project = create(store)
    assert store.read_preview_snapshot(project.projectId, owner_id="alice") is None
    store.put_preview_snapshot(
        project.projectId,
        owner_id="alice",
        png=_TINY_PNG,
        revision=project.currentRevision,
        source="browser_view",
    )
    assert store.read_preview_snapshot(project.projectId, owner_id="alice") == _TINY_PNG
    with pytest.raises(ProjectNotFound):
        store.read_preview_snapshot(project.projectId, owner_id="bob")
    with pytest.raises(ValueError, match="preview_snapshot_invalid"):
        store.put_preview_snapshot(
            project.projectId, owner_id="alice", png=b"not-png",
            revision=project.currentRevision, source="browser_view",
        )
    with pytest.raises(ValueError, match="preview_snapshot_source_invalid"):
        store.put_preview_snapshot(
            project.projectId, owner_id="alice", png=_TINY_PNG,
            revision=project.currentRevision, source="project_verify",
        )
    store.put_preview_snapshot(
        project.projectId,
        owner_id="alice",
        png=_TINY_PNG,
        revision="rev-2",
        source="browser_interact",
    )
    assert store.read_preview_snapshot(project.projectId, owner_id="alice") == _TINY_PNG
