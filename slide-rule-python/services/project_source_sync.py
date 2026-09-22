"""Source changes are messages to the existing runtime owner, not new workers.

Like grok's session-owned filesystem toolset, one executor owns the actual IO.
The durable child request keeps before/after source and its result attributable.
Publishing can be recovered by stable identity; an uncertain remote file write
cannot be replayed. A new revision requires a new preview authorization.
"""
from __future__ import annotations

import json
import time

from services.project_creation import sync_session_project
from services.project_manifest import prepare_source_patch
from services.project_runtime import REVISION_FILE
from services.project_store import ProjectConflict
from services.project_tool_contracts import PatchArguments
from services.workspace_provider import WorkspaceProviderError

TERMINAL = {"completed", "cancelled", "failed"}


def _child(task, operation_id):
    if not isinstance(operation_id, str) or not operation_id:
        raise ProjectConflict("project_source_sync_intent_invalid")
    child = task.store.get_operation(operation_id, owner_id=task.owner_id)
    if (child.kind != "runtime.patch" or child.projectId != task.original.projectId
            or child.sessionId != task.original.sessionId
            or child.input.get("runtimeOperationId") != task.operation_id
            or child.approvalRef != task.original.approvalRef):
        raise ProjectConflict("project_patch_runtime_mismatch")
    return child


def _result(task, child, *, synchronized=False, error=None):
    target = task.store.publication_revision_id(child.projectId, child.operationId)
    project = task.store.get_project(child.projectId, owner_id=task.owner_id)
    return {"runtimeOperationId": task.operation_id, "revision": project.currentRevision,
        "parentRevision": child.expectedRevision, "sourcePublished": project.currentRevision == target,
        "synchronized": synchronized, "verification": "not_run", "errorCode": error}


def _finish_child(task, child, status, *, synchronized=False, error=None):
    current = _child(task, child.operationId)
    if current.status in TERMINAL:
        return
    current = task.store.claim_operation(current.operationId, owner_id=task.owner_id,
        lease_owner=task.lease.leaseOwner, generation=task.lease.generation)
    if current.status in {"queued", "interrupted"} and status == "completed":
        current = task.store.transition_operation(current.operationId, owner_id=task.owner_id,
            expected_status=current.status, status="running", lease_generation=task.lease.generation,
            lease_owner=task.lease.leaseOwner)
    task.store.transition_operation(current.operationId, owner_id=task.owner_id,
        expected_status=current.status, status=status,
        result=_result(task, current, synchronized=synchronized, error=error),
        lease_generation=task.lease.generation, lease_owner=task.lease.leaseOwner)


def finish_pending_source_patches(task, *, cancelled: bool, error: str):
    """Run after the parent is stopping, before releasing its sole write lease."""
    for child in task.store.list_runtime_patches(task.operation_id, owner_id=task.owner_id):
        _finish_child(task, child, "cancelled" if cancelled or child.cancelRequested else "failed", error=error)


def authorize_source_recovery(task):
    """A saved publication intent may straddle source CAS and runtime projection."""
    intent = task.result.get("sourceSync")
    if not isinstance(intent, dict):
        raise ProjectConflict("project_source_sync_intent_invalid")
    child = _child(task, intent.get("operationId"))
    target = task.store.publication_revision_id(child.projectId, child.operationId)
    project = task.store.get_project(child.projectId, owner_id=task.owner_id)
    if (intent.get("baseRevision") != child.expectedRevision or intent.get("targetRevision") != target
            or project.currentRevision not in {child.expectedRevision, target}
            or task.runtime.revision not in {child.expectedRevision, target}):
        raise ProjectConflict("project_source_sync_intent_invalid")
    # Use an exact, persisted current source for the existing approval boundary.
    # This does not mutate the parent's originally requested revision.
    candidate = task.operation().model_copy(update={"runtime": None, "expectedRevision": project.currentRevision})
    task.supervisor.authorizer(task.store, candidate, task.owner_id)


def sync_next_source_patch(task, *, recovering=False) -> bool:
    try:
        return _sync_next_source_patch(task, recovering=recovering)
    except ProjectConflict:
        # A cancellation can win the SQL fence immediately before publication.
        # Do not strand it until lease expiry by treating every CAS refusal as
        # lost ownership. Cleanup still starts with a fenced parent state write.
        task.check()
        intent = task.result.get("sourceSync")
        if intent:
            if _child(task, intent.get("operationId")).cancelRequested:
                raise WorkspaceProviderError("project_patch_cancelled") from None
        else:
            pending = task.store.list_runtime_patches(task.operation_id, owner_id=task.owner_id)
            if pending and pending[0].cancelRequested:
                _finish_child(task, pending[0], "cancelled", error="project_patch_cancelled")
                return True
        raise


def _sync_next_source_patch(task, *, recovering=False) -> bool:
    task.check()
    intent = task.result.get("sourceSync")
    if intent:
        child = _child(task, intent["operationId"])
        authorize_source_recovery(task)
    else:
        pending = task.store.list_runtime_patches(task.operation_id, owner_id=task.owner_id)
        if not pending:
            return False
        child = pending[0]
        if child.cancelRequested:
            _finish_child(task, child, "cancelled", error="project_patch_cancelled")
            return True
        if child.expectedRevision != task.runtime.revision:
            _finish_child(task, child, "failed", error="project_revision_conflict")
            return True
        task.supervisor.authorizer(task.store, task.operation(), task.owner_id)

    if child.cancelRequested:
        raise WorkspaceProviderError("project_patch_cancelled")
    if child.status not in TERMINAL:
        child = task.store.claim_operation(child.operationId, owner_id=task.owner_id,
            lease_owner=task.lease.leaseOwner, generation=task.lease.generation)
        if child.status != "running":
            child = task.store.transition_operation(child.operationId, owner_id=task.owner_id,
                expected_status=child.status, status="running", lease_generation=task.lease.generation,
                lease_owner=task.lease.leaseOwner)
    elif child.status != "completed":
        raise WorkspaceProviderError("project_source_sync_child_terminal")

    base = task.store.get_revision(child.projectId, child.expectedRevision, owner_id=task.owner_id)
    before = task.store.read_files(child.projectId, base.revision, owner_id=task.owner_id)
    args = PatchArguments.model_validate({"approvalRef": child.approvalRef,
        "expectedRevision": child.expectedRevision, "changes": child.input["changes"]})
    after, changed = prepare_source_patch(before, [item.model_dump() for item in args.changes], live=True)
    if not intent:
        intent = {"operationId": child.operationId, "baseRevision": base.revision,
            "targetRevision": task.store.publication_revision_id(child.projectId, child.operationId),
            "phase": "publishing"}
        task.result["sourceSync"] = intent
        task.save("syncing")
    if intent["phase"] == "dispatching":
        # The provider may have written a subset before a crash. Neither file IO
        # nor the previous ready state is replayed; the parent cleans up remotely.
        raise WorkspaceProviderError("project_source_sync_uncertain")
    if intent["phase"] not in {"publishing", "written", "verified"}:
        raise WorkspaceProviderError("project_source_sync_phase_invalid")

    def check():
        task.check()
        if _child(task, child.operationId).cancelRequested:
            raise WorkspaceProviderError("project_patch_cancelled")

    target = intent["targetRevision"]
    if intent["phase"] == "publishing":
        check()
        if task.supervisor.preview_runtime is not None:
            task.supervisor.preview_runtime.suspend_for_sync(task)
        check()
        authorize_source_recovery(task)
        revision = task.store.commit_revision(child.projectId, owner_id=task.owner_id,
            expected_revision=base.revision, files=after, template_version=base.templateVersion,
            plan_ref=child.approvalRef, spec_revision=base.specRevision,
            lease_generation=task.lease.generation, lease_owner=task.lease.leaseOwner,
            publication_id=child.operationId, runtime_operation_id=task.operation_id)
        if revision.revision != target:
            raise ProjectConflict("project_source_publication_mismatch")
        check()
        intent["phase"] = "dispatching"
        task.save("syncing")
        check()
        authorize_source_recovery(task)
        task.provider.sync_files(task.handle,
            expected_files={**before, REVISION_FILE: json.dumps({"revision": base.revision})},
            files={**after, REVISION_FILE: json.dumps({"revision": target})})
        check()
        intent["phase"] = "written"
        intent["healthDeadline"] = time.time() + task.supervisor.ready_timeout
        task.save("syncing")
    elif recovering:
        # A completed write is safe to verify, but never to reapply. Equal trees
        # make this provider call a strict hash/type read with no changed files.
        expected = {**after, REVISION_FILE: json.dumps({"revision": target})}
        check()
        authorize_source_recovery(task)
        task.provider.sync_files(task.handle, expected_files=expected, files=expected)

    check()
    task.heartbeat.renew(mounted_revision=target)
    if child.status == "completed":
        if (task.runtime.revision != target or intent["phase"] != "verified"
                or not (child.result or {}).get("synchronized")):
            raise ProjectConflict("project_source_sync_receipt_invalid")
    else:
        advanced = task.store.advance_runtime_revision(task.operation_id, child.operationId,
            owner_id=task.owner_id, lease_generation=task.lease.generation,
            lease_owner=task.lease.leaseOwner, target_revision=target)
        task.runtime = advanced.runtime
    while True:
        check()
        pid = task._process("server")
        if not task.provider.is_process_running(task.handle, pid):
            raise WorkspaceProviderError("project_process_exited")
        if task.provider.probe(task.handle, task.runtime.port, expected_revision=target):
            break
        if time.time() >= intent.get("healthDeadline", 0):
            raise WorkspaceProviderError("project_source_sync_health_failed")
        task.sleep()
    check()
    sync_session_project(task.store, task.original.sessionId, owner_id=task.owner_id,
        approval_ref=child.approvalRef)
    intent["phase"] = "verified"
    task.save("ready")
    check()
    _finish_child(task, child, "completed", synchronized=True)
    task.result["lastSourceSync"] = {"operationId": child.operationId, "revision": target,
        "parentRevision": base.revision, "changedFileCount": len(changed)}
    task.result.pop("sourceSync", None)
    task.save("ready")
    return True
