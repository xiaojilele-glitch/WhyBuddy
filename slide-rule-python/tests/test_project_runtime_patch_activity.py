"""Accepted edits are activity; reading or retrying the same request is not.

Real model smoke edited at second 54 and was still destroyed at second 60.
The immutable child admission timestamp is the activity record, atomically saved
with the request even on the SQL gateway. Exercise the actual worker idle loop
with real clocks as well as negative durable-store admission boundaries.
"""
from datetime import datetime, timezone
import json
import time

import pytest
from project_actor_support import project_actor

from services.project_manifest import content_hash
from services.project_store import ProjectConflict, ProjectNotFound
from test_project_runtime_patch_store import runtime, enqueue
from test_project_live_source_sync import live, patch, patch_args, child_done
from test_project_runtime_worker import eventually


def activity(rt):
    return rt.store.runtime_patch_activity_at(rt.parent.operationId, owner_id="alice")


def test_activity_comes_from_new_durable_admission_not_polling_or_idempotent_retry(runtime):
    rt = runtime
    assert activity(rt) == 0
    child = enqueue(rt)
    accepted = datetime.fromisoformat(child.createdAt).timestamp()
    assert activity(rt) == accepted
    for _ in range(3):
        rt.store.touch_operation(child.operationId, owner_id="alice")
        rt.store.snapshot_operation(child.operationId, owner_id="alice")
        assert enqueue(rt).operationId == child.operationId
        assert activity(rt) == accepted
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").lastAccessAt is None


@pytest.mark.parametrize("invalid", ["owner", "revision", "approval", "changes", "cancelled-parent"])
def test_rejected_submission_cannot_create_runtime_activity(runtime, invalid):
    rt, arguments = runtime, {}
    if invalid == "owner": arguments["owner_id"] = "mallory"
    elif invalid == "revision": arguments["expected_revision"] = "old-revision"
    elif invalid == "approval": arguments["approval_ref"] = "unapproved-plan"
    elif invalid == "changes": arguments["changes"] = []
    else: rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    with pytest.raises((ProjectConflict, ProjectNotFound, ValueError)):
        enqueue(rt, **arguments)
    assert activity(rt) == 0


def test_other_runtime_patch_and_other_owner_cannot_supply_activity(runtime):
    rt = runtime
    child = enqueue(rt)
    other = rt.store.create_operation(rt.project.projectId, owner_id="alice", kind="runtime.start",
        expected_revision=rt.project.currentRevision, approval_ref="plan-1", idempotency_key="other-runtime")
    assert rt.store.runtime_patch_activity_at(other.operationId, owner_id="alice") == 0
    with pytest.raises(ProjectNotFound):
        rt.store.runtime_patch_activity_at(rt.parent.operationId, owner_id="mallory")
    assert activity(rt) == datetime.fromisoformat(child.createdAt).timestamp()


@pytest.mark.parametrize("invalid", ["future", "before-parent", "missing-zone", "invalid-format"])
def test_invalid_created_at_fails_instead_of_renewing_from_poll_time(runtime, invalid):
    rt, child = runtime, enqueue(runtime)
    stamp = {"future": datetime.fromtimestamp(time.time() + 3600, timezone.utc).isoformat(),
        "before-parent": "2000-01-01T00:00:00+00:00", "missing-zone": "2026-09-13T00:00:00",
        "invalid-format": "not-a-timestamp"}[invalid]
    corrupt = child.model_copy(update={"createdAt": stamp})
    rt.store._q("update wb_project_operation set payload=$1 where id=$2", [corrupt.model_dump_json(), child.operationId])
    with pytest.raises(ValueError, match="patch_activity_invalid"):
        activity(rt)


@pytest.mark.parametrize("live", [{"idle_seconds": 1, "lifetime_seconds": 10}], indirect=True)
def test_completed_live_edit_extends_idle_once_and_repeat_requests_do_not_keep_it_alive(live):
    ready_at = live.parent().result["readyAt"]
    eventually(lambda: time.time() >= ready_at + 0.65)
    arguments = patch_args(live)
    submitted = patch(live, arguments)
    child = eventually(lambda: child_done(live, submitted))
    assert child.status == "completed"
    accepted = datetime.fromisoformat(child.createdAt).timestamp()
    observed_after_original_expiry = False
    while time.time() < accepted + 0.8:
        assert patch(live, arguments)["operationId"] == child.operationId
        live.tools.execute("project_status", {"operationId": child.operationId}, live.state)
        live.tools.execute("project_status", {"operationId": live.started["operationId"]}, live.state)
        assert live.parent().runtime.status == "ready"
        observed_after_original_expiry |= time.time() > ready_at + 1.05
        time.sleep(0.04)
    assert observed_after_original_expiry and live.parent().lastAccessAt is None
    expired = eventually(lambda: live.parent() if live.parent().runtime.status == "expired" else None)
    assert expired.status == "completed" and expired.runtime.errorCode == "runtime_idle_expired"
    assert not live.provider.handles and len(live.provider.syncs) == 1


@pytest.mark.parametrize("live", [{"idle_seconds": 1, "lifetime_seconds": 3}], indirect=True)
def test_new_live_edits_cannot_extend_the_persisted_total_lifetime(live):
    original_end = live.parent().runtime.expiresAt
    completed = 0
    while time.time() < original_end - 0.35:
        current = live.store.get_project(live.project["projectId"], owner_id="alice")
        source = live.store.read_files(current.projectId, owner_id="alice")["src/App.tsx"]
        submitted = patch(live, {"approvalRef": live.approval, "expectedRevision": current.currentRevision,
            "changes": [{"path": "src/App.tsx", "content": source + "// active edit\n", "expectedSha256": content_hash(source)}]})
        assert eventually(lambda: child_done(live, submitted)).status == "completed"
        completed += 1
        assert live.parent().runtime.expiresAt == original_end
        time.sleep(0.3)
    expired = eventually(lambda: live.parent() if live.parent().runtime.status == "expired" else None)
    assert completed >= 3 and expired.runtime.expiresAt == original_end
    assert expired.status == "completed" and expired.runtime.errorCode == "runtime_budget_exhausted"
    assert not live.provider.handles


@pytest.mark.parametrize("live", [{"idle_seconds": 1, "lifetime_seconds": 10}], indirect=True)
@pytest.mark.parametrize("interleave", ["stop-cas", "activity-read", "touch", "touch-read"])
def test_idle_stop_rechecks_activity_at_sql_boundary_without_poisoning_cleanup(live, monkeypatch, interleave):
    """An admitted edit/touch wins over an idle snapshot, including in the CAS gap.

    Patch admission is its own committed SQL INSERT and leaves the parent rev
    unchanged. Inject into the real worker's read/write gap, then require the
    same lease owner to apply it; merely failing the stop or restarting cannot
    satisfy this assertion. The activity-read case catches a count taken too late.
    """
    real_query, real_activity = live.store._q, live.store.runtime_patch_activity_at
    original, injected = live.parent(), []
    lease = live.store.get_lease(original.projectId, owner_id="alice")

    def inject():
        if injected:
            return
        injected.append({})
        if interleave.startswith("touch"):
            injected[0]["touch"] = live.store.touch_operation(original.operationId, owner_id="alice")
        else:
            injected[0].update(patch(live))

    def racing_query(sql, params=None):
        if sql.startswith("update wb_project_operation set payload=") and params:
            candidate = json.loads(params[0])
            cleanup = (candidate.get("result") or {}).get("cleanup") or {}
            if cleanup.get("code") == "runtime_idle_expired" and not injected and not interleave.endswith("read"):
                inject()
        return real_query(sql, params)

    def racing_activity(*args, **kwargs):
        result = real_activity(*args, **kwargs)
        if interleave.endswith("read") and time.time() >= original.result["readyAt"] + 1:
            inject()
        return result

    monkeypatch.setattr(live.store, "_q", racing_query)
    monkeypatch.setattr(live.store, "runtime_patch_activity_at", racing_activity)
    eventually(lambda: injected)
    if interleave.startswith("touch"):
        eventually(lambda: "touch" in injected[0] and time.time() >= injected[0]["touch"].lastAccessAt + 0.2)
    else:
        completed = eventually(lambda: child_done(live, injected[0]) if "operationId" in injected[0] else None)
        assert completed.status == "completed", completed
        assert completed.result["synchronized"] and completed.result["sourcePublished"]
        assert len(live.provider.syncs) == 1
    current = live.parent()
    current_lease = live.store.get_lease(original.projectId, owner_id="alice")
    assert current.status == "running" and current.runtime.status == "ready"
    assert current.runtime.errorCode is None and "cleanup" not in current.result
    assert current.runtime.runtimeId == original.runtime.runtimeId and current.runtime.processId == original.runtime.processId
    assert current_lease.generation == lease.generation and current_lease.sandboxId == lease.sandboxId
    assert live.provider.handles and live.provider.created == 1


@pytest.mark.parametrize("added", ["patch", "other-operation", "other-project"])
def test_idle_sql_count_is_project_scoped_and_conservatively_rechecks_any_new_row(runtime, monkeypatch, added):
    rt, real, inserted = runtime, runtime.store._q, []
    count = rt.store.project_operation_count(rt.project.projectId, owner_id="alice")

    def racing(sql, params=None):
        if sql.startswith("update wb_project_operation set payload=") and params:
            candidate = json.loads(params[0])
            if (candidate.get("runtime") or {}).get("status") == "stopping" and not inserted:
                inserted.append(True)
                if added == "patch":
                    enqueue(rt)
                else:
                    project = rt.project
                    if added == "other-project":
                        project = rt.store.create_project("other-session", owner_id="alice", files=rt.files,
                            template_version="vite-1", plan_ref="plan-1")
                    rt.store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
                        expected_revision=project.currentRevision, approval_ref="plan-1", idempotency_key="new-op")
        return real(sql, params)

    monkeypatch.setattr(rt.store, "_q", racing)
    stopped = rt.store.update_runtime_operation(rt.parent.operationId, owner_id="alice",
        lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner,
        expected_status="running", status="running", runtime=rt.parent.runtime.model_copy(update={"status": "stopping"}),
        idle_operation_count=count, idle_last_access_at=None)
    assert inserted
    assert (stopped is not None) == (added == "other-project")
    assert rt.store.get_operation(rt.parent.operationId, owner_id="alice").runtime.status == (
        "stopping" if added == "other-project" else "ready")
