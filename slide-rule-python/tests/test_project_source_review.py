"""Cross-lifecycle source retries and plan changes at the actual model adapter."""
from plan_approval_support import approved_plan_rows
from project_actor_support import project_actor
from services.project_source_operations import ProjectSourceOperations
from test_project_live_source_sync import live, patch_args
from test_project_runtime_worker import eventually


def stop(live):
    live.supervisor.cancel(live.started["operationId"], owner_id="alice")
    eventually(lambda: live.parent().status == "cancelled")
    eventually(lambda: not live.store.get_lease(live.project["projectId"], owner_id="alice").sandboxId)


def request(live, key):
    args = patch_args(live)
    return dict(expected_revision=args["expectedRevision"], idempotency_key=key, changes=args["changes"])


def test_live_source_patch_retry_after_stop_returns_same_operation(live):
    service = ProjectSourceOperations(live.store, live.supervisor, "alice")
    args = request(live, "across-stop")
    first = service.patch(live.project["projectId"], **args)
    eventually(lambda: live.store.get_operation(first["operationId"], owner_id="alice").status == "completed")
    stop(live)
    replay = service.patch(live.project["projectId"], **args)
    assert replay["operationId"] == first["operationId"]
    assert replay["status"] == "completed"


def test_stopped_source_patch_retry_after_start_returns_same_revision(live):
    stop(live)
    service = ProjectSourceOperations(live.store, live.supervisor, "alice")
    args = request(live, "across-start")
    first = service.patch(live.project["projectId"], **args)
    started = live.supervisor.submit(live.project["projectId"], owner_id="alice",
        expected_revision=first["revision"], approval_ref=live.approval, idempotency_key="second-runtime")
    eventually(lambda: (row := live.store.get_operation(started.operationId, owner_id="alice")).runtime
        and row.runtime.status == "ready")
    assert service.patch(live.project["projectId"], **args) == first
    live.supervisor.cancel(started.operationId, owner_id="alice")
    eventually(lambda: live.store.get_operation(started.operationId, owner_id="alice").status == "cancelled")


def test_live_restore_same_tree_is_explicit_noop_without_new_child(live):
    service = ProjectSourceOperations(live.store, live.supervisor, "alice")
    before = live.project["revision"]
    result = service.restore(live.project["projectId"], expected_revision=before,
        target_revision=before, idempotency_key="same-tree")
    assert result == {"projectId": live.project["projectId"], "revision": before,
        "operationId": None, "status": "completed"}
    assert not live.store.list_runtime_patches(live.started["operationId"], owner_id="alice")
    assert live.store.get_project(live.project["projectId"], owner_id="alice").currentRevision == before


def test_model_restore_does_not_rebind_old_tool_call_to_new_approved_plan(live, monkeypatch):
    stop(live)
    service = ProjectSourceOperations(live.store, live.supervisor, "alice")
    current = service.patch(live.project["projectId"], **request(live, "prepare-restore"))["revision"]
    restore = ProjectSourceOperations.restore
    def approve_different_plan_then_restore(self, *args, **kwargs):
        row = live.sessions.load(live.state.sessionId)
        row.payload["controlTranscript"] = approved_plan_rows("Keep the current source; use a different task scope.")
        live.sessions.save(live.state.sessionId, row.payload, expected_rev=row.rev)
        return restore(self, *args, **kwargs)
    monkeypatch.setattr(ProjectSourceOperations, "restore", approve_different_plan_then_restore)
    result = live.tools.execute("project_restore", {"approvalRef": live.approval,
        "expectedRevision": current, "targetRevision": live.project["revision"],
        "idempotencyKey": "old-model-call"}, live.state)
    assert result["ok"] is False
    assert live.store.get_project(live.project["projectId"], owner_id="alice").currentRevision == current
