"""Durable patch proposals are commands for the existing runtime lease owner.

The SQL adapter commits each statement independently, just like the HTTP SQL
gateway. Publication may succeed before its reply or child result is saved.
Stable publication IDs recover that gap without publishing another source tree.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from models.project_runtime import RuntimeInstance
from services.project_manifest import canonical_json, content_hash
from services.project_store import MAX_OPERATION_BYTES, ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable


@pytest.fixture
def runtime(tmp_path):
    url = f"sqlite:///{tmp_path / 'runtime-patch.db'}"
    store = ProjectStore.from_url(url)
    files = {"package.json": "{}", "package-lock.json": "{}", "src/App.tsx": "export const title = 'before';"}
    project = store.create_project("s1", owner_id="alice", files=files, template_version="vite-1", plan_ref="plan-1", spec_revision="spec-1")
    parent = store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="start-1", expected_revision=project.currentRevision, approval_ref="plan-1", input={"port": 5173})
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="runtime-owner", ttl_seconds=120)
    store.claim_operation(parent.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = store.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="sb-1", mounted_revision=project.currentRevision,
        process_refs={"operationId": parent.operationId, "server": "43"})
    instance = RuntimeInstance(runtimeId="rt-" + parent.operationId, projectId=project.projectId,
        workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
        processId="43", health="revision_verified", expiresAt=time.time() + 900, lastHeartbeat="2026-09-13T00:00:00Z")
    parent = store.update_runtime_operation(parent.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=instance)
    yield SimpleNamespace(store=store, url=url, project=project, parent=parent, lease=lease, files=files)
    store.close()


def enqueue(rt, *, key="patch-1", **kwargs):
    args = {"owner_id": "alice", "expected_revision": rt.project.currentRevision, "approval_ref": "plan-1",
        "idempotency_key": key, "changes": [{"path": "src/App.tsx", "content": "export const title = 'after';",
            "expectedSha256": content_hash(rt.files["src/App.tsx"])}], **kwargs}
    return rt.store.enqueue_runtime_patch(rt.parent.operationId, **args)


def child_transition(rt, child, status, **kwargs):
    current = rt.store.get_operation(child.operationId, owner_id="alice")
    return rt.store.transition_operation(child.operationId, owner_id="alice", expected_status=current.status,
        status=status, lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner, **kwargs)


def parent_state(rt, status="syncing", result=None, **runtime_changes):
    current = rt.store.get_operation(rt.parent.operationId, owner_id="alice")
    instance = current.runtime.model_copy(update={"status": status,
        "health": "revision_verified" if status == "ready" else "unknown", **runtime_changes})
    return rt.store.update_runtime_operation(current.operationId, owner_id="alice",
        lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner,
        expected_status=current.status, status=current.status, runtime=instance,
        result=current.result if result is None else result)


def begin(rt, child=None):
    child = child or enqueue(rt)
    rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    child = child_transition(rt, child, "running")
    target = rt.store.publication_revision_id(rt.project.projectId, child.operationId)
    parent_state(rt, result={"sourceSync": {"operationId": child.operationId, "baseRevision": child.expectedRevision,
        "targetRevision": target, "phase": "publishing"}})
    return child


def publish(rt, child, **kwargs):
    args = {"owner_id": "alice", "expected_revision": child.expectedRevision,
        "files": {**rt.files, "src/App.tsx": child.input["changes"][0]["content"]},
        "template_version": "vite-1", "plan_ref": "plan-1", "spec_revision": "spec-1",
        "lease_generation": rt.lease.generation, "lease_owner": rt.lease.leaseOwner,
        "publication_id": child.operationId, "runtime_operation_id": rt.parent.operationId, **kwargs}
    return rt.store.commit_revision(rt.project.projectId, **args)


def mount(rt, revision):
    rt.lease = rt.store.renew_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner,
        generation=rt.lease.generation, mounted_revision=revision.revision)


def advance(rt, child, target):
    return rt.store.advance_runtime_revision(rt.parent.operationId, child.operationId, owner_id="alice",
        lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner, target_revision=target)


def test_enqueue_is_durable_readonly_to_runtime_and_duplicate_uses_same_proposal(runtime):
    rt = runtime
    before = rt.store._q("select * from wb_project") + rt.store._q("select * from wb_project_lease")
    child = enqueue(rt)
    duplicate = enqueue(rt)
    assert child == duplicate and child.status == "queued" and child.leaseGeneration is None
    assert child.input["runtimeOperationId"] == rt.parent.operationId
    assert rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice") == [child]
    assert not rt.store.list_runnable_operations()
    assert before == rt.store._q("select * from wb_project") + rt.store._q("select * from wb_project_lease")
    assert rt.store.read_files(rt.project.projectId, owner_id="alice") == rt.files
    rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    assert enqueue(rt) == child
    with pytest.raises(ProjectConflict, match="idempotency"):
        enqueue(rt, changes=[{"path": "other", "content": "different", "expectedSha256": None}])


def test_generic_operation_creation_cannot_bypass_runtime_patch_enqueue_fence(runtime):
    with pytest.raises(ValueError, match="enqueue_required"):
        runtime.store.create_operation(runtime.project.projectId, owner_id="alice", kind="runtime.patch",
            idempotency_key="bypass", expected_revision=runtime.project.currentRevision, approval_ref="plan-1")


def test_child_record_limit_counts_request_metadata_and_result_together(runtime):
    rt = runtime
    changes = [{"path": "src/App.tsx", "content": "", "expectedSha256": content_hash(rt.files["src/App.tsx"])}]
    request = {"kind": "runtime.patch", "expectedRevision": rt.project.currentRevision,
        "approvalRef": "plan-1", "input": {"runtimeOperationId": rt.parent.operationId, "changes": changes}}
    changes[0]["content"] = "x" * (MAX_OPERATION_BYTES - len(canonical_json(request).encode()) - 32)
    assert len(canonical_json(request).encode()) < MAX_OPERATION_BYTES
    with pytest.raises(ValueError, match="record_too_large"):
        enqueue(rt, changes=changes)
    assert not rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice")
    changes[0]["content"] = "x" * (80 * 1024)
    child = begin(rt, enqueue(rt, changes=changes))
    with pytest.raises(ValueError, match="record_too_large"):
        child_transition(rt, child, "running", result={"output": "x" * (60 * 1024)})
    assert rt.store.get_operation(child.operationId, owner_id="alice").result is None
    assert child_transition(rt, child, "failed", result={"errorCode": "bounded_output"}).status == "failed"


def test_admitted_large_utf8_patch_retains_room_for_claim_cancel_and_outcome(runtime):
    rt = runtime
    child = enqueue(rt, changes=[{"path": "src/App.tsx", "content": "好" * (40 * 1024), "expectedSha256": None}])
    rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    rt.store.touch_operation(child.operationId, owner_id="alice")
    rt.store.request_operation_cancel(child.operationId, owner_id="alice")
    terminal = child_transition(rt, child, "cancelled", result={"reason": "x" * 2048})
    assert terminal.cancelRequested and terminal.status == "cancelled"
    assert len(terminal.model_dump_json().encode()) <= MAX_OPERATION_BYTES


def test_runtime_patch_cannot_be_promoted_to_independent_runtime(runtime):
    rt, child = runtime, enqueue(runtime)
    rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    with pytest.raises(ProjectConflict, match="child_has_no_runtime"):
        rt.store.update_runtime_operation(child.operationId, owner_id="alice", lease_generation=rt.lease.generation,
            lease_owner=rt.lease.leaseOwner, expected_status="queued", status="running", runtime=rt.parent.runtime)
    assert rt.store.get_operation(child.operationId, owner_id="alice").runtime is None


@pytest.mark.parametrize("change", ["owner", "head", "plan", "cancel", "runtime-status", "unverified", "mounted", "server", "expired"])
def test_enqueue_requires_actual_ready_owner_and_source_binding(runtime, change):
    rt, args = runtime, {}
    if change == "owner": args["owner_id"] = "mallory"
    if change == "head": args["expected_revision"] = "stale"
    if change == "plan": args["approval_ref"] = "different-plan"
    if change == "cancel": rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    if change == "runtime-status": parent_state(rt, "syncing")
    if change == "unverified": parent_state(rt, "ready", health="unknown")
    if change == "mounted":
        lease = rt.lease.model_copy(update={"mountedRevision": "other"})
        rt.store._q("update wb_project_lease set payload=$1 where project_id=$2", [lease.model_dump_json(), rt.project.projectId])
    if change == "server": parent_state(rt, "ready", processId="999")
    if change == "expired":
        rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation)
    with pytest.raises((ProjectNotFound, ProjectConflict)):
        enqueue(rt, **args)
    assert not rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice")


@pytest.mark.parametrize("race", ["cancel", "lease-payload", "takeover"])
def test_enqueue_insert_rechecks_parent_and_lease_at_sql_boundary(runtime, monkeypatch, race):
    rt, real, injected = runtime, runtime.store._q, []
    def racing(sql, params=None):
        if sql.startswith("insert into wb_project_operation") and " select " in sql and not injected:
            injected.append(True)
            if race == "cancel": rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
            elif race == "lease-payload":
                rt.store.renew_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner,
                    generation=rt.lease.generation, process_refs={"operationId": rt.parent.operationId, "server": "999"})
            else:
                rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation)
                rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="replacement")
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    with pytest.raises(ProjectConflict): enqueue(rt)
    assert injected and not rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice")


def test_concurrent_identical_proposals_have_one_durable_identity(runtime):
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: enqueue(runtime), range(2)))
    assert replies[0].operationId == replies[1].operationId
    assert len(runtime.store.list_runtime_patches(runtime.parent.operationId, owner_id="alice")) == 1


def test_publication_retry_after_database_reopen_reuses_revision_and_budget(runtime):
    rt = runtime
    child = begin(rt)
    revision = publish(rt, child)
    count = rt.store._q("select * from wb_project_source_budget")
    reopened = ProjectStore.from_url(rt.url)
    try:
        retry = SimpleNamespace(**{**rt.__dict__, "store": reopened})
        assert publish(retry, child) == revision
        assert reopened._q("select * from wb_project_source_budget") == count
        assert len(reopened._q("select * from wb_project_revision")) == 2
        assert reopened.get_project(rt.project.projectId, owner_id="alice").revisionCount == 2
    finally:
        reopened.close()


def test_lost_publication_reply_does_not_make_retry_publish_another_revision(runtime, monkeypatch):
    rt, real, failed = runtime, runtime.store._q, []
    child = begin(rt)
    def lost_reply(sql, params=None):
        result = real(sql, params)
        if sql.startswith("update wb_project set current_revision") and result and not failed:
            failed.append(True)
            raise ProjectStoreUnavailable("reply_lost")
        return result
    monkeypatch.setattr(rt.store, "_q", lost_reply)
    with pytest.raises(ProjectStoreUnavailable): publish(rt, child)
    revision = publish(rt, child)
    assert revision.revision == rt.store.publication_revision_id(rt.project.projectId, child.operationId)
    assert len(rt.store._q("select * from wb_project_revision")) == 2


@pytest.mark.parametrize("published", [False, True])
def test_new_runtime_owner_can_recover_staged_or_published_patch_without_duplicate_revision(runtime, monkeypatch, published):
    rt, child = runtime, begin(runtime)
    real = rt.store._q
    if published:
        publish(rt, child)
    else:
        def interrupted(sql, params=None):
            if sql.startswith("update wb_project set current_revision"):
                raise ProjectStoreUnavailable("crash_before_head_write")
            return real(sql, params)
        monkeypatch.setattr(rt.store, "_q", interrupted)
        with pytest.raises(ProjectStoreUnavailable): publish(rt, child)
        monkeypatch.setattr(rt.store, "_q", real)
    budget = rt.store._q("select * from wb_project_source_budget")
    rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation)
    rt.lease = rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="replacement")
    parent = rt.store.claim_operation(rt.parent.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    assert parent.status == "interrupted" and parent.runtime.status == "reconciling"
    rt.store.update_runtime_operation(parent.operationId, owner_id="alice", lease_generation=rt.lease.generation,
        lease_owner=rt.lease.leaseOwner, expected_status="interrupted", status="running",
        runtime=parent.runtime.model_copy(update={"status": "syncing"}), result=parent.result)
    recovered = rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    assert recovered.status == "interrupted"
    child_transition(rt, child, "running", result={"phase": "publishing"})
    revision = publish(rt, child)
    mount(rt, revision)
    advance(rt, child, revision.revision)
    parent_state(rt, "ready")
    assert child_transition(rt, child, "completed").status == "completed"
    assert len(rt.store._q("select * from wb_project_revision")) == 2
    assert rt.store._q("select * from wb_project_source_budget") == budget


def test_publication_heartbeat_cas_conflict_retries_with_same_revision_and_quota(runtime, monkeypatch):
    rt, child, real, renewed = runtime, begin(runtime), runtime.store._q, []
    def heartbeat(sql, params=None):
        if sql.startswith("update wb_project set current_revision") and not renewed:
            renewed.append(True)
            rt.lease = rt.store.renew_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation,
                lease_owner=rt.lease.leaseOwner, ttl_seconds=180)
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", heartbeat)
    with pytest.raises(ProjectConflict): publish(rt, child)
    budget = rt.store._q("select * from wb_project_source_budget")
    revision = publish(rt, child)
    assert revision.revision == rt.store.publication_revision_id(rt.project.projectId, child.operationId)
    assert rt.store._q("select * from wb_project_source_budget") == budget
    assert len(rt.store._q("select * from wb_project_revision")) == 2


@pytest.mark.parametrize("field,value", [("files", {"src/App.tsx": "different"}), ("template_version", "vite-2"),
    ("plan_ref", "plan-2"), ("spec_revision", "spec-2"), ("expected_revision", "different-parent")])
def test_stable_publication_id_cannot_be_reused_for_a_different_contract(runtime, field, value):
    rt, child = runtime, begin(runtime)
    publish(rt, child)
    with pytest.raises(ProjectConflict): publish(rt, child, **{field: value})
    assert len(rt.store._q("select * from wb_project_revision")) == 2


@pytest.mark.parametrize("target", ["parent", "child"])
def test_cancel_between_source_upload_and_head_cas_cannot_publish(runtime, monkeypatch, target):
    rt, child, real, injected = runtime, begin(runtime), runtime.store._q, []
    def cancel_before_cas(sql, params=None):
        if sql.startswith("update wb_project set current_revision") and not injected:
            injected.append(True)
            rt.store.request_operation_cancel(rt.parent.operationId if target == "parent" else child.operationId, owner_id="alice")
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", cancel_before_cas)
    with pytest.raises(ProjectConflict): publish(rt, child)
    assert rt.store.get_project(rt.project.projectId, owner_id="alice").currentRevision == rt.project.currentRevision
    target_id = rt.store.publication_revision_id(rt.project.projectId, child.operationId)
    with pytest.raises(ProjectNotFound): rt.store.get_revision(rt.project.projectId, target_id, owner_id="alice")


def test_generic_runtime_update_cannot_switch_revision_and_advance_preserves_start_request(runtime):
    rt, child = runtime, begin(runtime)
    revision = publish(rt, child)
    with pytest.raises(ProjectConflict, match="runtime_operation_mismatch"):
        parent_state(rt, revision=revision.revision)
    with pytest.raises(ProjectConflict): advance(rt, child, revision.revision)
    mount(rt, revision)
    advanced = advance(rt, child, revision.revision)
    assert advanced.expectedRevision == rt.project.currentRevision
    assert advanced.requestHash == rt.parent.requestHash
    assert advanced.runtime.revision == revision.revision
    assert advanced.runtime.status == "syncing" and advanced.runtime.health == "unknown"
    assert advanced.pendingEvent["payload"]["runtime"]["revision"] == revision.revision
    repeated = advance(rt, child, revision.revision)
    assert repeated.stateVersion == advanced.stateVersion
    ready = parent_state(rt, "ready")
    assert ready.runtime.revision == revision.revision
    completed = child_transition(rt, child, "completed", result={"revision": revision.revision})
    assert completed.status == "completed"


def test_child_cannot_complete_before_runtime_version_and_health_are_confirmed(runtime):
    rt, child = runtime, begin(runtime)
    with pytest.raises(ProjectConflict): child_transition(rt, child, "completed")
    revision = publish(rt, child)
    mount(rt, revision)
    advance(rt, child, revision.revision)
    with pytest.raises(ProjectConflict): child_transition(rt, child, "completed")
    parent_state(rt, "ready")
    assert child_transition(rt, child, "completed").status == "completed"


@pytest.mark.parametrize("boundary,target", [("claim", "parent"), ("transition", "parent"),
    ("transition", "child"), ("advance", "parent"), ("advance", "child"), ("advance", "lease")])
def test_child_progress_and_runtime_switch_are_fenced_at_the_write(runtime, monkeypatch, boundary, target):
    rt, child = runtime, enqueue(runtime)
    if boundary != "claim":
        rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    if boundary == "advance":
        child = child_transition(rt, child, "running")
        target_id = rt.store.publication_revision_id(rt.project.projectId, child.operationId)
        parent_state(rt, result={"sourceSync": {"operationId": child.operationId, "baseRevision": child.expectedRevision,
            "targetRevision": target_id, "phase": "publishing"}})
        revision = publish(rt, child)
        mount(rt, revision)
        rt.store.flush_operation_event(rt.parent.operationId, owner_id="alice", lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    real, injected = rt.store._q, []
    update_id = rt.parent.operationId if boundary == "advance" else child.operationId
    def race(sql, params=None):
        if sql.startswith("update wb_project_operation set payload") and params[1] == update_id and not injected:
            injected.append(True)
            if target == "lease":
                rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation)
                rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="replacement")
            else:
                rt.store.request_operation_cancel(rt.parent.operationId if target == "parent" else child.operationId, owner_id="alice")
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", race)
    with pytest.raises(ProjectConflict):
        if boundary == "claim":
            rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
        elif boundary == "transition": child_transition(rt, child, "running")
        else: advance(rt, child, revision.revision)
    assert injected
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").runtime.revision == rt.project.currentRevision


@pytest.mark.parametrize("terminal", ["cancelled", "failed"])
def test_parent_cancellation_allows_only_fenced_terminal_child_cleanup(runtime, terminal):
    rt, child = runtime, enqueue(runtime)
    rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    with pytest.raises(ProjectConflict): child_transition(rt, child, "running")
    result = child_transition(rt, child, terminal, result={"reason": "parent_cancelled"})
    assert result.status == terminal


@pytest.mark.parametrize("boundary", ["publish", "advance"])
@pytest.mark.parametrize("binding", ["sandbox", "server"])
def test_patch_progress_rechecks_server_binding_but_can_terminalize_after_binding_loss(runtime, boundary, binding):
    rt, child = runtime, begin(runtime)
    if boundary == "advance":
        revision = publish(rt, child)
        mount(rt, revision)
    if binding == "sandbox":
        lease = rt.lease.model_copy(update={"sandboxId": None})
    else:
        lease = rt.lease.model_copy(update={"processRefs": {**rt.lease.processRefs, "server": "other-server"}})
    rt.store._q("update wb_project_lease set payload=$1 where project_id=$2", [lease.model_dump_json(), rt.project.projectId])
    with pytest.raises(ProjectConflict, match="patch_unavailable"):
        if boundary == "publish": publish(rt, child)
        else: advance(rt, child, revision.revision)
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").runtime.revision == rt.project.currentRevision
    if boundary == "publish":
        assert rt.store.get_project(rt.project.projectId, owner_id="alice").currentRevision == rt.project.currentRevision
    assert child_transition(rt, child, "failed", result={"reason": "runtime_binding_lost"}).status == "failed"


def test_old_generation_cannot_claim_child_or_reuse_successful_publication(runtime):
    rt, child = runtime, begin(runtime)
    publish(rt, child)
    rt.store.release_lease(rt.project.projectId, owner_id="alice", lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation)
    rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="replacement")
    with pytest.raises(ProjectConflict): publish(rt, child)
    with pytest.raises(ProjectConflict):
        rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    with pytest.raises(ProjectConflict): child_transition(rt, child, "failed")


def test_parent_listing_cannot_include_other_runtime_proposals_or_be_read_by_other_owner(runtime):
    rt, child = runtime, enqueue(runtime)
    other = rt.store.create_operation(rt.project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="start-other", expected_revision=rt.project.currentRevision, approval_ref="plan-1")
    assert rt.store.list_runtime_patches(other.operationId, owner_id="alice") == []
    assert rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice") == [child]
    with pytest.raises(ProjectNotFound): rt.store.list_runtime_patches(rt.parent.operationId, owner_id="mallory")
