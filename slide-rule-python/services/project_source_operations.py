"""Owned source editing, revision recovery and private project forks.

HTTP edits and restore requests reuse the runtime owner's durable patch queue.
A stopped project publishes under the same fenced source lease. Restoring copies
an old tree into a NEW revision; history and old verification cannot rewind.
Forks copy immutable source into a new session with no inherited execution grant,
workspace, application database or verification result.
"""

from __future__ import annotations

import time
import uuid

from models.v5_state import V5SessionState
from services import persistence
from services.control_checkpoint import guard_control_run
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session, sync_session_project
from services.deliverable_kind import idle_office_exec_allows_source_write, operation_left_on_lease
from services.project_manifest import canonical_json, content_hash, prepare_source_patch, source_path
from services.project_store import MAX_REVISIONS, ProjectConflict, ProjectNotFound, ProjectStoreUnavailable


class ProjectSourceOperations:
    def __init__(self, store, supervisor, owner_id):
        self.store, self.supervisor, self.owner_id = store, supervisor, owner_id

    def authority(self, project_id, *, write=False):
        project = self.store.get_project(project_id, owner_id=self.owner_id)
        state = load_authorized_session(project.sessionId, owner_id=self.owner_id)
        if state.projectId != project.projectId or state.runtimeKind != "project":
            raise ProjectConflict("project_session_binding_required")
        if write:
            state = load_authorized_session(project.sessionId, owner_id=self.owner_id,
                approval_ref=approved_reference(state))
        return project, state

    def source(self, project_id, revision=None):
        project, _ = self.authority(project_id)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        return {"projectId": project_id, "revision": saved.revision,
            "currentRevision": project.currentRevision,
            "files": [item.model_dump() for item in saved.manifest.files]}

    def file(self, project_id, path, revision=None):
        self.authority(project_id)
        path = source_path(path)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        return {"projectId": project_id, "revision": saved.revision, "path": path,
            "sha256": content_hash(files[path]), "content": files[path]}

    def revisions(self, project_id, cursor=None, limit=50):
        project, _ = self.authority(project_id)
        current = cursor or project.currentRevision
        entries = []
        for _ in range(min(limit, MAX_REVISIONS)):
            if current is None:
                break
            saved = self.store.get_revision(project_id, current, owner_id=self.owner_id)
            entries.append({key: getattr(saved, key) for key in (
                "revision", "parentRevision", "treeHash", "templateVersion", "createdAt")})
            current = saved.parentRevision
        return {"projectId": project_id, "currentRevision": project.currentRevision,
            "revisions": entries, "nextCursor": current}

    def patch(self, project_id, *, expected_revision, idempotency_key, changes, approval_ref=None):
        project, state = self.authority(project_id, write=True)
        approval = approved_reference(state)
        if approval_ref is not None and approval != approval_ref:
            raise PermissionError("project_plan_approval_required")
        before = self.store.read_files(project_id, expected_revision, owner_id=self.owner_id)
        files, changed = prepare_source_patch(before, changes)
        publication_id = "source-" + content_hash(idempotency_key)
        # A lost HTTP reply can be retried after stop/start. Recover the original
        # outcome BEFORE choosing an execution mode, never enqueue another edit.
        previous = self.store.operation_by_key(project_id, publication_id, owner_id=self.owner_id)
        if previous is not None:
            if (previous.kind != "runtime.patch" or previous.expectedRevision != expected_revision
                    or previous.approvalRef != approval or previous.input.get("changes") != changes):
                raise ProjectConflict("project_idempotency_conflict")
            return {"projectId": project_id, "revision": (previous.result or {}).get("revision"),
                "operationId": previous.operationId, "status": previous.status}
        target_id = self.store.publication_revision_id(project_id, publication_id)
        try:
            prior = self.store.get_revision(project_id, target_id, owner_id=self.owner_id)
        except ProjectNotFound:
            prior = None
        if prior is not None:
            if (prior.parentRevision != expected_revision or prior.planRef != approval
                    or self.store.read_files(project_id, target_id, owner_id=self.owner_id) != files):
                raise ProjectConflict("project_idempotency_conflict")
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=approval)
            return {"projectId": project_id, "revision": prior.revision, "operationId": None, "status": "completed"}
        lease = self.store.get_lease(project_id, owner_id=self.owner_id)
        active = lease is not None and lease.expiresAt > time.time() and lease.processRefs.get("operationId")
        prepare_source_patch(before, changes, live=bool(active))
        guard_control_run()
        if not changes:
            if project.currentRevision != expected_revision:
                raise ProjectConflict("project_revision_conflict")
            return {"projectId": project_id, "revision": expected_revision,
                "operationId": None, "status": "completed"}
        if active:
            if self.supervisor is None or not self.supervisor.running:
                raise ProjectStoreUnavailable("project_worker_unavailable")
            if len(changes) > 64:
                raise ValueError("project_live_patch_requires_restart")
            operation = self.supervisor.submit_patch(lease.processRefs["operationId"],
                owner_id=self.owner_id, expected_revision=expected_revision,
                approval_ref=approval, idempotency_key=publication_id,
                changes=changes)
            result = operation.result or {}
            return {"projectId": project_id, "revision": result.get("revision"),
                "operationId": operation.operationId, "status": operation.status}
        lease = self.store.acquire_lease(project_id, owner_id=self.owner_id,
            lease_owner="source-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            prior = operation_left_on_lease(self.store, lease, self.owner_id)
            if (lease.sandboxId or lease.processRefs) and not idle_office_exec_allows_source_write(lease, prior):
                raise ProjectConflict("project_runtime_reconciliation_required")
            self.authority(project_id, write=True)
            base = self.store.get_revision(project_id, expected_revision, owner_id=self.owner_id)
            publication_id = "source-" + content_hash(idempotency_key)
            target_id = self.store.publication_revision_id(project_id, publication_id)
            try:
                saved = self.store.get_revision(project_id, target_id, owner_id=self.owner_id)
            except ProjectNotFound:
                saved = None
            if saved is not None:
                if (saved.parentRevision != expected_revision or saved.planRef != approval
                        or self.store.read_files(project_id, target_id, owner_id=self.owner_id) != files):
                    raise ProjectConflict("project_idempotency_conflict")
            else:
                guard_control_run()
                load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=approval)
                saved = self.store.commit_revision(project_id, owner_id=self.owner_id,
                    expected_revision=expected_revision, files=files, template_version=base.templateVersion,
                    plan_ref=approval, spec_revision=base.specRevision,
                    lease_generation=lease.generation, lease_owner=lease.leaseOwner,
                    publication_id=publication_id)
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=approval)
            return {"projectId": project_id, "revision": saved.revision,
                "operationId": None, "status": "completed"}
        finally:
            self.store.release_lease(project_id, owner_id=self.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)

    def restore(self, project_id, *, expected_revision, target_revision, idempotency_key, approval_ref=None):
        _project, state = self.authority(project_id, write=True)
        approval = approval_ref or approved_reference(state)
        if approval != approved_reference(state):
            raise PermissionError("project_plan_approval_required")
        before = self.store.read_files(project_id, expected_revision, owner_id=self.owner_id)
        target = self.store.read_files(project_id, target_revision, owner_id=self.owner_id)
        changes = [{"path": path, "expectedSha256": content_hash(before[path]) if path in before else None,
            "content": target.get(path)} for path in sorted(before.keys() | target.keys())
            if before.get(path) != target.get(path)]
        # A changed tree publishes a new revision; an identical tree is an
        # explicit no-op. Never assign currentRevision to a historical snapshot.
        return self.patch(project_id, expected_revision=expected_revision,
            idempotency_key="restore:" + idempotency_key, changes=changes, approval_ref=approval)

    def fork(self, project_id, *, revision, idempotency_key):
        source, state = self.authority(project_id)
        saved = self.store.get_revision(project_id, revision, owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        identity = canonical_json([self.owner_id, project_id, idempotency_key])
        session_id = "project-fork-" + content_hash(identity)[:32]
        fork = self.store.create_project(session_id, owner_id=self.owner_id, files=files,
            template_version=saved.templateVersion, plan_ref="fork:requires-new-approval",
            spec_revision=saved.specRevision, source_project_id=project_id, source_revision=saved.revision)
        if fork.sourceProjectId != project_id or fork.sourceRevision != saved.revision:
            raise ProjectConflict("project_idempotency_conflict")
        # Claim is server-only and insert-only. It neither copies the prior plan
        # approval nor lets a retry overwrite a newer conversation in the fork.
        candidate = V5SessionState(sessionId=session_id, ownerId=self.owner_id,
            goal={"text": str(state.goal.get("text") or "Project fork")},
            runtimeKind="project", projectId=fork.projectId, projectRevision=fork.currentRevision,
            controlTranscript=[{"kind": "project_forked", "sourceProjectId": source.projectId,
                "sourceRevision": saved.revision}], lastTurnId="fork-1")
        claimed = persistence.claim_session_record(candidate)
        if not claimed.get("ok") or not isinstance(claimed.get("state"), V5SessionState):
            raise ProjectStoreUnavailable("project_fork_session_unavailable")
        actual = claimed["state"]
        if actual.ownerId != self.owner_id or actual.projectId != fork.projectId:
            raise ProjectConflict("project_fork_session_conflict")
        return {"projectId": fork.projectId, "sessionId": fork.sessionId,
            "revision": fork.currentRevision}
