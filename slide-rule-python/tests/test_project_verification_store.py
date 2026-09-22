"""Browser proof is a durable result of the runtime owner, never client input.

Exercise the same admitted/claimed child used by the worker, including a lost
completion reply, source changes and cancellation at the final SQL boundary.
The counter suite proves its declared page behavior; it never unlocks delivery.
"""
from datetime import datetime
from io import BytesIO
import json

from PIL import Image
import pytest

from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.project_verification_gate import REQUIRED_ASSERTIONS, verification_snapshot
from services.project_verification_store import ProjectVerificationStore, MAX_ARTIFACT_BYTES, MAX_PROJECT_ARTIFACT_BYTES
from test_project_runtime_patch_store import runtime, enqueue as enqueue_patch, parent_state, child_transition
from project_build_support import successful_build


def png(color="red"):
    output = BytesIO()
    Image.new("RGB", (3, 3), color).save(output, format="PNG")
    return output.getvalue()


def enqueue(rt, key="verify-1", **kwargs):
    return rt.store.enqueue_runtime_verification(rt.parent.operationId,
        **{"owner_id": "alice", "expected_revision": rt.project.currentRevision,
           "approval_ref": "plan-1", "idempotency_key": key, **kwargs})


def scope(rt):
    return dict(owner_id="alice", lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)


def start(rt, key="verify-1"):
    child = enqueue(rt, key)
    rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation,
        lease_owner=rt.lease.leaseOwner)
    child = child_transition(rt, child, "running")
    records = ProjectVerificationStore(rt.store)
    record = records.begin(child.operationId, **scope(rt))
    return records, record, child


def evidence():
    return [{"id": name, "status": "passed"} for name in sorted(REQUIRED_ASSERTIONS)]


def passed(rt, records, record, **kwargs):
    return records.finish(record.verificationId, **scope(rt),
        **{"status": "passed", "assertions": evidence(), "artifacts": {"page.png": png()},
           "build": successful_build(rt, record), **kwargs})


def test_verify_admission_is_idempotent_scoped_and_immutable_idle_activity(runtime):
    rt = runtime
    assert rt.store.runtime_patch_activity_at(rt.parent.operationId, owner_id="alice") == 0
    child = enqueue(rt)
    assert child == enqueue(rt)
    assert child.kind == "runtime.verify" and child.status == "queued" and child.leaseGeneration is None
    assert rt.store.list_runtime_verifications(rt.parent.operationId, owner_id="alice") == [child]
    assert rt.store.list_runtime_patches(rt.parent.operationId, owner_id="alice") == []
    assert not rt.store.list_runnable_operations()
    accepted = datetime.fromisoformat(child.createdAt).timestamp()
    assert rt.store.runtime_patch_activity_at(rt.parent.operationId, owner_id="alice") == accepted
    rt.store.touch_operation(child.operationId, owner_id="alice")
    assert enqueue(rt).operationId == child.operationId
    assert rt.store.runtime_patch_activity_at(rt.parent.operationId, owner_id="alice") == accepted
    with pytest.raises(ProjectConflict, match="idempotency"):
        enqueue_patch(rt, key="verify-1")
    with pytest.raises(ProjectNotFound):
        enqueue(rt, owner_id="mallory")
    assert rt.store.read_files(rt.project.projectId, owner_id="alice") == rt.files


@pytest.mark.parametrize("change", ["revision", "approval", "suite", "cancel", "syncing", "mount"])
def test_verify_rejects_unready_or_unapproved_source_before_creating_a_child(runtime, change):
    rt, args = runtime, {}
    if change == "revision": args["expected_revision"] = "old"
    if change == "approval": args["approval_ref"] = "old"
    if change == "suite": args["suite_version"] = "application-says-passed"
    if change == "cancel": rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    if change == "syncing": parent_state(rt)
    if change == "mount":
        changed = rt.lease.model_copy(update={"mountedRevision": "other"})
        rt.store._q("update wb_project_lease set payload=$1 where project_id=$2", [changed.model_dump_json(), rt.project.projectId])
    with pytest.raises((ProjectConflict, ValueError)):
        enqueue(rt, **args)
    assert not rt.store.list_runtime_verifications(rt.parent.operationId, owner_id="alice")


def test_generic_operations_cannot_create_or_complete_verification_or_publish_its_source(runtime):
    rt = runtime
    with pytest.raises(ValueError, match="enqueue_required"):
        rt.store.create_operation(rt.project.projectId, owner_id="alice", kind="runtime.verify",
            idempotency_key="fake", expected_revision=rt.project.currentRevision, approval_ref="plan-1")
    records, record, child = start(rt)
    with pytest.raises(ProjectConflict, match="verification_finish_required"):
        child_transition(rt, child, "completed", result={"status": "passed"})
    with pytest.raises(ProjectConflict, match="child_has_no_runtime"):
        rt.store.update_runtime_operation(child.operationId, **scope(rt), expected_status="running",
            status="running", runtime=rt.parent.runtime)
    with pytest.raises(ProjectConflict, match="parent_mismatch"):
        rt.store.advance_runtime_revision(rt.parent.operationId, child.operationId,
            **scope(rt), target_revision=rt.project.currentRevision)
    patch = enqueue_patch(rt)
    rt.store.claim_operation(patch.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    child_transition(rt, patch, "running")
    with pytest.raises(ProjectConflict, match="parent_mismatch"):
        records.begin(patch.operationId, **scope(rt))
    assert records.get(record.verificationId, owner_id="alice").effectiveStatus == "running"


def test_passed_receipt_captures_exact_version_and_persists_separate_authorized_png(runtime):
    rt = runtime
    records, record, child = start(rt)
    revision = rt.store.get_revision(rt.project.projectId, owner_id="alice")
    assert record.revision == revision.revision and record.treeHash == revision.treeHash
    assert record.planRef == "plan-1" and record.specRevision == "spec-1"
    assert record.runtimeId == rt.parent.runtime.runtimeId and record.runtimeOperationId == rt.parent.operationId
    assert record.createdAt == child.createdAt and record.startedAt and record.completedAt is None
    snapshot = passed(rt, records, record)
    assert snapshot.effectiveStatus == "passed" and snapshot.deliveryEligible is False
    assert snapshot.verification.completedAt and snapshot.verification.status == "passed"
    assert set(item.id for item in snapshot.verification.assertions) == REQUIRED_ASSERTIONS
    assert records.for_operation(child.operationId, owner_id="alice") == snapshot
    assert records.latest(rt.project.projectId, owner_id="alice") == snapshot
    final = rt.store.get_operation(child.operationId, owner_id="alice")
    assert final.status == "completed" and final.result["deliveryEligible"] is False
    assert png() not in snapshot.model_dump_json().encode()
    artifact = snapshot.verification.artifactRefs[0]
    assert records.read_artifact(record.verificationId, artifact.artifactId, owner_id="alice") == png()
    for action in [lambda: records.get(record.verificationId, owner_id="mallory"),
                   lambda: records.read_artifact(record.verificationId, artifact.artifactId, owner_id="mallory")]:
        with pytest.raises(ProjectNotFound): action()
    with pytest.raises(ProjectNotFound):
        records.read_artifact(record.verificationId, "png-unknown", owner_id="alice")
    budget = rt.store._q("select reserved_bytes from wb_project_verification_budget")
    assert passed(rt, records, record) == snapshot
    assert rt.store._q("select reserved_bytes from wb_project_verification_budget") == budget
    with pytest.raises(ProjectConflict, match="result_conflict"):
        passed(rt, records, record, artifacts={"page.png": png("blue")})


@pytest.mark.parametrize("invalid", ["missing", "no-png", "failed", "duplicate", "unknown", "not-png", "magic-only", "large", "error"])
def test_passed_requires_real_png_and_every_required_positive_assertion(runtime, invalid):
    rt = runtime
    records, record, child = start(rt)
    args = {}
    if invalid == "missing": args["assertions"] = evidence()[:-1]
    if invalid == "no-png": args["artifacts"] = {}
    if invalid == "failed": args["assertions"] = [{**item, "status": "failed"} for item in evidence()]
    if invalid == "duplicate": args["assertions"] = evidence() + [evidence()[0]]
    if invalid == "unknown": args["assertions"] = [{"id": "trust_model", "status": "passed"}]
    if invalid == "not-png": args["artifacts"] = {"page": b"passed"}
    if invalid == "magic-only": args["artifacts"] = {"page": b"\x89PNG\r\n\x1a\npassed"}
    if invalid == "large": args["artifacts"] = {"page": png() + b"x" * MAX_ARTIFACT_BYTES}
    if invalid == "error": args["error_code"] = "incomplete"
    with pytest.raises(ValueError): passed(rt, records, record, **args)
    assert records.get(record.verificationId, owner_id="alice").effectiveStatus == "running"
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "running"
    assert not rt.store._q("select * from wb_project_verification_artifact")


@pytest.mark.parametrize("invalid", ["missing", "revision", "treeHash", "lockfileHash", "status",
    "installExitCode", "buildExitCode", "outputHash", "outputFileCount", "outputBytes", "serverKind", "boolean-exit"])
def test_passed_rejects_missing_or_unbound_production_build_evidence(runtime, invalid):
    rt = runtime
    records, record, child = start(rt)
    proof = successful_build(rt, record)
    if invalid == "missing": proof = None
    elif invalid == "revision": proof[invalid] = "old-source"
    elif invalid in {"treeHash", "lockfileHash"}: proof[invalid] = "0" * 64
    elif invalid == "status": proof[invalid] = "blocked"
    elif invalid in {"installExitCode", "buildExitCode"}: proof[invalid] = 17
    elif invalid == "outputHash": proof[invalid] = None
    elif invalid in {"outputFileCount", "outputBytes"}: proof[invalid] = 0
    elif invalid == "serverKind": proof[invalid] = "tasks-node"
    else: proof["installExitCode"] = False
    with pytest.raises(ValueError):
        passed(rt, records, record, build=proof)
    assert records.get(record.verificationId, owner_id="alice").effectiveStatus == "running"
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "running"
    assert not rt.store._q("select * from wb_project_verification_artifact")


def test_historical_pass_without_build_is_stale_and_cannot_unlock_delivery(runtime):
    rt = runtime
    records, record, _ = start(rt)
    saved = passed(rt, records, record).verification
    historical = saved.model_copy(update={"build": None})
    revision = rt.store.get_revision(rt.project.projectId, owner_id="alice")
    snapshot = verification_snapshot(historical, revision=revision.revision, tree_hash=revision.treeHash,
        spec_revision=revision.specRevision, plan_ref=revision.planRef, lockfile_hash=saved.build.lockfileHash)
    assert snapshot.effectiveStatus == "stale" and snapshot.deliveryEligible is False


@pytest.mark.parametrize("status,error,assertions", [("blocked", "missing_browser", []),
    ("failed", None, [{"id": "counter_increment", "status": "failed", "detail": "assertion"}]),
    ("cancelled", "user_cancelled", [])])
def test_truthful_outcomes_are_distinct_from_operation_execution_completion(runtime, status, error, assertions):
    rt = runtime
    records, record, child = start(rt)
    if status == "cancelled": rt.store.request_operation_cancel(child.operationId, owner_id="alice")
    snapshot = records.finish(record.verificationId, **scope(rt), status=status,
        assertions=assertions, artifacts={}, error_code=error)
    assert snapshot.effectiveStatus == status and snapshot.deliveryEligible is False
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == ("cancelled" if status == "cancelled" else "completed")


@pytest.mark.parametrize("change", ["revision", "plan", "removed-plan", "spec", "tree", "runner", "suite"])
def test_current_stale_projection_preserves_historical_passed_receipt(runtime, change):
    rt = runtime
    records, record, _ = start(rt)
    original = passed(rt, records, record).verification
    args = dict(revision=original.revision, tree_hash=original.treeHash,
        spec_revision=original.specRevision, plan_ref=original.planRef, lockfile_hash=original.build.lockfileHash)
    changed = original
    if change == "revision": args["revision"] = "new"
    if change == "tree": args["tree_hash"] = "new"
    if change == "spec": args["spec_revision"] = "new"
    if change == "plan": args["plan_ref"] = "new"
    if change == "removed-plan": args["plan_ref"] = None
    if change == "runner": changed = original.model_copy(update={"runnerVersion": "next"})
    if change == "suite": changed = original.model_copy(update={"suiteVersion": "next"})
    projected = verification_snapshot(changed, **args)
    assert projected.effectiveStatus == "stale" and projected.verification.status == "passed"
    assert projected.deliveryEligible is False
    assert records.get(record.verificationId, owner_id="alice", current_plan_ref=None).effectiveStatus == "stale"
    assert records.get(record.verificationId, owner_id="alice").verification == original


def test_lost_completion_reply_reopens_and_reconciles_without_replaying_browser(runtime, monkeypatch):
    rt = runtime
    records, record, child = start(rt)
    real = records.reconcile_operation
    monkeypatch.setattr(records, "reconcile_operation", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("lost_response")))
    with pytest.raises(RuntimeError, match="lost_response"): passed(rt, records, record)
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "running"
    reopened = ProjectStore.from_url(rt.url)
    try:
        persisted = ProjectVerificationStore(reopened)
        assert persisted.for_operation(child.operationId, owner_id="alice").verification.status == "passed"
        result = persisted.reconcile_operation(record.verificationId, **scope(rt))
        assert result.effectiveStatus == "passed"
        assert reopened.get_operation(child.operationId, owner_id="alice").status == "completed"
        assert len(reopened._q("select * from wb_project_verification")) == 1
    finally: reopened.close()


@pytest.mark.parametrize("race", ["parent-cancel", "child-cancel", "lease", "source"])
def test_finish_rechecks_authority_at_final_sql_write(runtime, monkeypatch, race):
    rt = runtime
    records, record, child = start(rt)
    real, injected = rt.store._q, []
    def racing(sql, params=None):
        if sql.startswith("update wb_project_verification set payload=") and not injected:
            injected.append(True)
            if race == "parent-cancel": rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
            elif race == "child-cancel": rt.store.request_operation_cancel(child.operationId, owner_id="alice")
            elif race == "lease":
                rt.store.release_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
            else:
                changed = rt.lease.model_copy(update={"mountedRevision": "different"})
                real("update wb_project_lease set payload=$1 where project_id=$2", [changed.model_dump_json(), rt.project.projectId])
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    with pytest.raises(ProjectConflict): passed(rt, records, record)
    assert injected and records.get(record.verificationId, owner_id="alice").verification.status == "running"
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "running"


@pytest.mark.parametrize("write", ["budget", "artifact"])
def test_cancel_between_check_and_artifact_write_cannot_spend_or_write_after_revocation(runtime, monkeypatch, write):
    rt = runtime
    records, record, _ = start(rt)
    real, injected = rt.store._q, []
    prefix = "update wb_project_verification_budget" if write == "budget" else "insert into wb_project_verification_artifact"
    def racing(sql, params=None):
        if sql.startswith(prefix) and not injected:
            injected.append(True)
            rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    with pytest.raises((ProjectConflict, ValueError)): passed(rt, records, record)
    assert injected and not rt.store._q("select * from wb_project_verification_artifact")
    if write == "budget":
        assert rt.store._q("select reserved_bytes from wb_project_verification_budget")[0]["reserved_bytes"] == 0


def test_artifact_dedup_quota_and_corrupt_read_are_project_bounded(runtime):
    rt = runtime
    records, record, _ = start(rt)
    first = passed(rt, records, record)
    original_budget = rt.store._q("select reserved_bytes from wb_project_verification_budget")[0]["reserved_bytes"]
    _, second, _ = start(rt, "verify-2")
    passed(rt, records, second)
    assert rt.store._q("select reserved_bytes from wb_project_verification_budget")[0]["reserved_bytes"] == original_budget
    assert len(rt.store._q("select * from wb_project_verification_artifact")) == 1
    _, third, _ = start(rt, "verify-3")
    rt.store._q("update wb_project_verification_budget set reserved_bytes=$1", [MAX_PROJECT_ARTIFACT_BYTES])
    with pytest.raises(ValueError, match="artifact_limit"):
        passed(rt, records, third, artifacts={"page": png("blue")})
    rt.store._q("update wb_project_verification_artifact set content=$1", ["corrupt"])
    with pytest.raises(ProjectStoreUnavailable, match="corrupt"):
        records.read_artifact(record.verificationId, first.verification.artifactRefs[0].artifactId, owner_id="alice")


def test_parent_stopping_and_interrupted_child_cleanup_does_not_require_live_approval(runtime):
    rt = runtime
    records, record, child = start(rt)
    child_transition(rt, child, "interrupted")
    parent_state(rt, "stopping")
    rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    result = records.finish(record.verificationId, **scope(rt), status="blocked", assertions=[],
        error_code="browser_verification_interrupted", cleanup=True)
    assert result.verification.status == "blocked" and result.deliveryEligible is False
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "completed"


def test_actual_source_commit_stales_old_receipt_and_reconcile_still_completes_original_child(runtime, monkeypatch):
    rt = runtime
    records, record, child = start(rt)
    original = records.reconcile_operation
    monkeypatch.setattr(records, "reconcile_operation", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("lost")))
    with pytest.raises(RuntimeError): passed(rt, records, record)
    next_revision = rt.store.commit_revision(rt.project.projectId, **scope(rt),
        expected_revision=rt.project.currentRevision, files={**rt.files, "new.txt": "new source"},
        template_version="vite-1", plan_ref="plan-1", spec_revision="spec-1")
    result = original(record.verificationId, **scope(rt))
    assert result.effectiveStatus == "stale" and result.verification.status == "passed"
    assert result.verification.revision != next_revision.revision
    assert rt.store.get_operation(child.operationId, owner_id="alice").status == "completed"


def test_takeover_can_cleanup_but_cannot_finish_old_running_clicks_as_passed(runtime):
    rt = runtime
    records, record, child = start(rt)
    old_scope = scope(rt)
    rt.store.release_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    rt.lease = rt.store.acquire_lease(rt.project.projectId, owner_id="alice", lease_owner="replacement")
    rt.store.claim_operation(rt.parent.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    current = rt.store.get_operation(rt.parent.operationId, owner_id="alice")
    rt.store.update_runtime_operation(current.operationId, **scope(rt), expected_status=current.status, status="running",
        runtime=current.runtime.model_copy(update={"status": "ready", "health": "revision_verified"}))
    claimed = rt.store.claim_operation(child.operationId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    assert claimed.status == "interrupted"
    with pytest.raises(ProjectConflict):
        records.finish(record.verificationId, **old_scope, status="passed", assertions=evidence(), artifacts={"page": png()},
            build=successful_build(rt, record))
    child_transition(rt, child, "running")
    with pytest.raises(ProjectConflict, match="generation_changed"):
        passed(rt, records, record)
    result = records.finish(record.verificationId, **scope(rt), status="blocked", assertions=[], artifacts={},
        error_code="browser_verification_interrupted", cleanup=True)
    assert result.effectiveStatus == "blocked" and result.deliveryEligible is False
    assert not rt.store._q("select * from wb_project_verification_artifact")


@pytest.mark.parametrize("write", ["budget-init", "budget", "artifact"])
@pytest.mark.parametrize("heartbeat", ["lease", "parent"])
def test_healthy_heartbeat_before_evidence_write_retries_confirmed_cas_without_spending_twice(runtime, monkeypatch, write, heartbeat):
    rt = runtime
    records, record, _ = start(rt)
    real, injected = rt.store._q, []
    prefix = {"budget-init": "insert into wb_project_verification_budget", "budget": "update wb_project_verification_budget",
        "artifact": "insert into wb_project_verification_artifact"}[write]
    def racing(sql, params=None):
        if sql.startswith(prefix) and not injected:
            injected.append(True)
            if heartbeat == "lease":
                rt.store.renew_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation,
                    lease_owner=rt.lease.leaseOwner)
            else:
                parent_state(rt, "ready", lastHeartbeat="2026-09-13T00:00:01Z")
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    result = passed(rt, records, record)
    assert injected and result.effectiveStatus == "passed"
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").runtime.status == "ready"
    assert rt.store._q("select reserved_bytes from wb_project_verification_budget")[0]["reserved_bytes"] == len(png())
    assert len(rt.store._q("select * from wb_project_verification_artifact")) == 1


def test_unknown_budget_reply_is_never_automatically_retried(runtime, monkeypatch):
    rt = runtime
    records, record, _ = start(rt)
    real, writes = rt.store._q, []
    def lost_reply(sql, params=None):
        result = real(sql, params)
        if sql.startswith("update wb_project_verification_budget"):
            writes.append(True)
            raise ProjectStoreUnavailable("unknown_reservation_reply")
        return result
    monkeypatch.setattr(rt.store, "_q", lost_reply)
    with pytest.raises(ProjectStoreUnavailable, match="unknown_reservation_reply"):
        passed(rt, records, record)
    assert len(writes) == 1
    assert rt.store._q("select reserved_bytes from wb_project_verification_budget")[0]["reserved_bytes"] == len(png())
    assert records.get(record.verificationId, owner_id="alice").verification.status == "running"
