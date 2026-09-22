"""Trusted fixed-revision browser receipts and separately bounded PNG evidence.

The browser runs outside the application sandbox. Only its owning runtime worker
calls begin/finish; HTTP and model tools receive read projections. A receipt is
durable before its child completion, so lost responses reconcile the same proof
instead of replaying potentially mutating browser clicks. Historic proof is never
rewritten merely because its current source/plan projection becomes stale.
"""
from __future__ import annotations

import base64
import hashlib
import re
from datetime import datetime, timezone
from io import BytesIO

from PIL import Image

from models.project_runtime import VerificationArtifactRef, VerificationRecord
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from services.project_verification_gate import RUNNER_VERSION, SUITE_ASSERTIONS, validate_build_evidence, validate_verification_result, verification_snapshot

MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
MAX_PROJECT_ARTIFACT_BYTES = 16 * 1024 * 1024
_UNSET = object()
_TERMINAL = {"passed", "failed", "blocked", "cancelled"}
_DDL = (
    "create table if not exists wb_project_verification (id varchar(80) primary key, operation_id varchar(80) unique not null, project_id varchar(80) not null, lease_generation integer not null, lease_owner varchar(240) not null, rev integer not null, created_at varchar(64) not null, payload text not null)",
    "create index if not exists wb_project_verification_project on wb_project_verification(project_id,created_at)",
    "create table if not exists wb_project_verification_artifact (project_id varchar(80) not null, hash varchar(64) not null, size_bytes integer not null, content text not null, primary key(project_id,hash))",
    "create table if not exists wb_project_verification_budget (project_id varchar(80) primary key, reserved_bytes bigint not null)",
)


def _now():
    return datetime.now(timezone.utc).isoformat()


class ProjectVerificationStore:
    def __init__(self, store):
        self.store = store
        for statement in _DDL:
            self.store._q(statement)

    def _row(self, verification_id, owner_id):
        rows = self.store._q("select v.* from wb_project_verification v join wb_project p on p.id=v.project_id where v.id=$1 and p.owner_id=$2",
            [verification_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_verification_not_found")
        return rows[0]

    def _snapshot(self, record, owner_id, current_plan_ref=_UNSET):
        revision = self.store.get_revision(record.projectId, owner_id=owner_id)
        return verification_snapshot(record, revision=revision.revision, tree_hash=revision.treeHash,
            spec_revision=revision.specRevision,
            lockfile_hash=next((item.sha256 for item in revision.manifest.files if item.path == "package-lock.json"), None),
            plan_ref=revision.planRef if current_plan_ref is _UNSET else current_plan_ref)

    def get(self, verification_id, *, owner_id, current_plan_ref=_UNSET):
        record = VerificationRecord.model_validate_json(self._row(verification_id, owner_id)["payload"])
        return self._snapshot(record, owner_id, current_plan_ref)

    def for_operation(self, child_id, *, owner_id, current_plan_ref=_UNSET):
        child = self.store.get_operation(child_id, owner_id=owner_id)
        rows = self.store._q("select id from wb_project_verification where operation_id=$1 and project_id=$2", [child_id, child.projectId])
        return self.get(rows[0]["id"], owner_id=owner_id, current_plan_ref=current_plan_ref) if rows else None

    def latest(self, project_id, *, owner_id, current_plan_ref=_UNSET):
        self.store.get_project(project_id, owner_id=owner_id)
        rows = self.store._q("select id from wb_project_verification where project_id=$1 order by created_at desc,id desc limit 1", [project_id])
        return self.get(rows[0]["id"], owner_id=owner_id, current_plan_ref=current_plan_ref) if rows else None

    def _context(self, child_id, owner_id, generation, lease_owner, *, cleanup=False, require_running=True):
        child = self.store.get_operation(child_id, owner_id=owner_id)
        context = self.store._runtime_verification_context(child.input.get("runtimeOperationId"), child_id,
            owner_id=owner_id, lease_generation=generation, lease_owner=lease_owner,
            require_claim=True, cleanup=cleanup)
        parent, lease = context["parent"], context["lease"]
        if child.input.get("suiteVersion") not in SUITE_ASSERTIONS:
            raise ValueError("verification_suite_unsupported")
        if require_running and child.status not in ({"running", "interrupted"} if cleanup else {"running"}):
            raise ProjectConflict("verification_operation_not_running")
        if not cleanup and (parent.runtime.status != "ready" or parent.runtime.health != "revision_verified"
                or parent.runtime.revision != child.expectedRevision or context["current_revision"] != child.expectedRevision
                or lease.mountedRevision != child.expectedRevision or (parent.result or {}).get("sourceSync")
                or parent.approvalRef != child.approvalRef):
            raise ProjectConflict("verification_revision_not_ready")
        return context

    def _guard(self, context, params):
        """PG locks the lease and parent; SQLite serializes the whole statement.

        A plain EXISTS uses an old READ COMMITTED snapshot after a row wait.
        Lease SELECT FOR UPDATE and parent direct rev/payload predicates recheck
        ownership and cancellation before a browser receipt can become authority.
        """
        fence = self.store._runtime_patch_fence(context, params)
        if self.store._dialect != "postgresql":
            return "", fence
        index = len(params) + 1
        params.extend([context["project"].projectId, context["generation"], context["lease_owner"],
            context["lease_payload"], context["parent"].operationId, context["parent_rev"], context["parent_payload"],
            context["project_rev"], context["current_revision"], context["child"].operationId,
            context["child_rev"], context["child_payload"]])
        prefix = ("with verification_lease as (select project_id from wb_project_lease "
            f"where project_id=${index} and generation=${index+1} and lease_owner=${index+2} and payload=${index+3} "
            "and expires_at>extract(epoch from clock_timestamp()) for update), "
            "verification_project as (select id from wb_project "
            f"where id=${index} and rev=${index+7} and current_revision=${index+8} "
            "and exists(select 1 from verification_lease) for update), "
            "verification_parent as (update wb_project_operation set rev=rev+1 "
            f"where id=${index+4} and rev=${index+5} and payload=${index+6} "
            "and exists(select 1 from verification_project) and " + fence + " returning id), "
            "verification_child as (select id from wb_project_operation "
            f"where id=${index+9} and rev=${index+10} and payload=${index+11} "
            "and exists(select 1 from verification_parent) for update) ")
        return prefix, "exists(select 1 from verification_child)"

    def begin(self, child_id, *, owner_id, lease_generation, lease_owner):
        for _ in range(3):
            context = self._context(child_id, owner_id, lease_generation, lease_owner)
            prior = self.for_operation(child_id, owner_id=owner_id)
            if prior is not None:
                # A takeover may inspect the old receipt, but must cleanup then
                # finish it blocked; its previous running clicks are not replayed.
                return prior.verification
            child, parent = context["child"], context["parent"]
            revision = self.store.get_revision(child.projectId, child.expectedRevision, owner_id=owner_id)
            record = VerificationRecord(verificationId="pvr-" + hashlib.sha256(child_id.encode()).hexdigest()[:40],
                operationId=child_id, runtimeOperationId=parent.operationId, projectId=child.projectId,
                revision=revision.revision, treeHash=revision.treeHash, runtimeId=parent.runtime.runtimeId,
                specRevision=revision.specRevision, planRef=child.approvalRef, suiteVersion=child.input["suiteVersion"],
                acceptanceRequirements=list(child.input.get("acceptanceRequirements") or []),
                createdAt=child.createdAt, startedAt=_now(), runnerVersion=RUNNER_VERSION)
            params = [record.verificationId, child_id, child.projectId, lease_generation, lease_owner,
                      record.createdAt, record.model_dump_json()]
            prefix, fence = self._guard(context, params)
            rows = self.store._q(prefix + "insert into wb_project_verification(id,operation_id,project_id,lease_generation,lease_owner,rev,created_at,payload) "
                "select $1,$2,$3,$4,$5,1,$6,$7 where " + fence + " on conflict(operation_id) do nothing returning id", params)
            if rows:
                return record
        raise ProjectConflict("verification_state_changed")

    def _artifact_write(self, context, statement, params, *, cleanup):
        for _ in range(3):
            context = self._context(context["child"].operationId, context["owner_id"],
                context["generation"], context["lease_owner"], cleanup=cleanup)
            bound = list(params)
            prefix, fence = self._guard(context, bound)
            # Only a returned zero-row CAS is safe to retry. A transport error
            # might hide a successful reservation and must propagate unchanged.
            rows = self.store._q(prefix + statement.replace("{fence}", fence), bound)
            if rows:
                return rows
            observed = self._context(context["child"].operationId, context["owner_id"],
                context["generation"], context["lease_owner"], cleanup=cleanup)
            own_parent_bump = 1 if self.store._dialect == "postgresql" else 0
            if (observed["parent_rev"] == context["parent_rev"] + own_parent_bump
                    and all(observed[key] == context[key] for key in (
                        "parent_payload", "project_rev", "current_revision", "lease_payload",
                        "generation", "lease_owner", "child_rev", "child_payload"))):
                # The fence was current: this is a real quota limit or an
                # existing content/budget row, not a healthy heartbeat race.
                return rows
        raise ProjectConflict("verification_artifact_state_changed")

    def _artifacts(self, context, artifacts, *, cleanup=False):
        project_id = context["project"].projectId
        if not isinstance(artifacts, dict) or len(artifacts) > 8:
            raise ValueError("verification_artifacts_invalid")
        refs = []
        # Validate the complete input before reserving any storage.
        for label, data in artifacts.items():
            if not isinstance(label, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", label):
                raise ValueError("verification_artifact_label_invalid")
            if not isinstance(data, bytes) or not 9 <= len(data) <= MAX_ARTIFACT_BYTES or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("verification_png_invalid_or_too_large")
            try:
                with Image.open(BytesIO(data)) as picture:
                    if picture.format != "PNG" or picture.width * picture.height > 16_000_000:
                        raise ValueError("invalid_png_dimensions")
                    picture.verify()
                with Image.open(BytesIO(data)) as picture:
                    picture.load()
            except (ValueError, OSError, SyntaxError, Image.DecompressionBombError):
                raise ValueError("verification_png_invalid_or_too_large") from None
            digest = hashlib.sha256(data).hexdigest()
            refs.append(VerificationArtifactRef(artifactId="png-" + digest, sha256=digest, sizeBytes=len(data), label=label))
        for ref in refs:
            present = self.store._q("select size_bytes from wb_project_verification_artifact where project_id=$1 and hash=$2", [project_id, ref.sha256])
            if present:
                continue
            self._artifact_write(context, "insert into wb_project_verification_budget(project_id,reserved_bytes) select $1,0 where {fence} on conflict(project_id) do nothing", [project_id], cleanup=cleanup)
            # A lost upload can conservatively retain a reservation. Retrying
            # must never exceed the project cap through concurrent receipts.
            reserved = self._artifact_write(context, "update wb_project_verification_budget set reserved_bytes=reserved_bytes+$1 where project_id=$2 and reserved_bytes+$1<=$3 and {fence} returning project_id",
                [ref.sizeBytes, project_id, MAX_PROJECT_ARTIFACT_BYTES], cleanup=cleanup)
            if not reserved:
                raise ValueError("verification_project_artifact_limit")
            written = self._artifact_write(context, "insert into wb_project_verification_artifact(project_id,hash,size_bytes,content) select $1,$2,$3,$4 where {fence} on conflict(project_id,hash) do nothing returning hash",
                [project_id, ref.sha256, ref.sizeBytes, base64.b64encode(artifacts[ref.label]).decode("ascii")], cleanup=cleanup)
            if not written and not self.store._q("select hash from wb_project_verification_artifact where project_id=$1 and hash=$2", [project_id, ref.sha256]):
                raise ProjectConflict("verification_artifact_state_changed")
        return refs

    def finish(self, verification_id, *, owner_id, lease_generation, lease_owner,
               status, assertions=None, artifacts=None, error_code=None, cleanup=False, build=None):
        cleanup = cleanup or status in {"blocked", "cancelled"}
        row = self._row(verification_id, owner_id)
        record = VerificationRecord.model_validate_json(row["payload"])
        revision = self.store.get_revision(record.projectId, record.revision, owner_id=owner_id)
        lockfile_hash = next((item.sha256 for item in revision.manifest.files if item.path == "package-lock.json"), None)
        checked_build = validate_build_evidence(build, revision=record.revision, tree_hash=record.treeHash,
            lockfile_hash=lockfile_hash, suite_version=record.suiteVersion)
        if record.status in _TERMINAL:
            if status != record.status or (error_code is not None and error_code != record.errorCode):
                raise ProjectConflict("verification_result_conflict")
            if assertions is not None:
                checked = validate_verification_result(status, assertions, artifact_count=len(record.artifactRefs),
                    suite_version=record.suiteVersion, error_code=record.errorCode, build=record.build)
                if checked != record.assertions:
                    raise ProjectConflict("verification_result_conflict")
            if build is not None and checked_build != record.build:
                raise ProjectConflict("verification_result_conflict")
            if artifacts is not None:
                expected = {ref.label: (ref.sha256, ref.sizeBytes) for ref in record.artifactRefs}
                if (not isinstance(artifacts, dict) or set(artifacts) != set(expected)
                        or any(not isinstance(data, bytes) or (hashlib.sha256(data).hexdigest(), len(data)) != expected[label]
                               for label, data in artifacts.items())):
                    raise ProjectConflict("verification_result_conflict")
            return self.reconcile_operation(verification_id, owner_id=owner_id,
                lease_generation=lease_generation, lease_owner=lease_owner)
        if cleanup and status in {"passed", "failed"}:
            raise ValueError("verification_cleanup_cannot_pass")
        checked = validate_verification_result(status, assertions or [], artifact_count=len(artifacts or {}),
            suite_version=record.suiteVersion, error_code=error_code, build=checked_build)
        context = self._context(record.operationId, owner_id, lease_generation, lease_owner, cleanup=cleanup)
        if not cleanup and (row["lease_generation"] != lease_generation or row["lease_owner"] != lease_owner):
            raise ProjectConflict("verification_attempt_generation_changed")
        refs = self._artifacts(context, artifacts or {}, cleanup=cleanup)
        updated = record.model_copy(update={"status": status, "assertions": checked, "artifactRefs": refs,
            "completedAt": _now(), "errorCode": error_code, "build": checked_build})
        if len(updated.model_dump_json().encode()) > 128 * 1024:
            raise ValueError("verification_record_too_large")
        for _ in range(3):
            context = self._context(record.operationId, owner_id, lease_generation, lease_owner, cleanup=cleanup)
            revision = self.store.get_revision(record.projectId, record.revision, owner_id=owner_id)
            if not cleanup and (context["parent"].runtime.runtimeId != record.runtimeId
                    or context["current_revision"] != record.revision or revision.treeHash != record.treeHash
                    or revision.specRevision != record.specRevision or context["child"].approvalRef != record.planRef
                    or record.runnerVersion != RUNNER_VERSION):
                raise ProjectConflict("verification_revision_changed")
            params = [updated.model_dump_json(), verification_id, row["rev"], row["payload"]]
            prefix, fence = self._guard(context, params)
            saved = self.store._q(prefix + "update wb_project_verification set payload=$1,rev=rev+1 where id=$2 and rev=$3 and payload=$4 and " + fence + " returning id", params)
            if saved:
                return self.reconcile_operation(verification_id, owner_id=owner_id,
                    lease_generation=lease_generation, lease_owner=lease_owner)
        raise ProjectConflict("verification_state_changed")

    def reconcile_operation(self, verification_id, *, owner_id, lease_generation, lease_owner):
        record = VerificationRecord.model_validate_json(self._row(verification_id, owner_id)["payload"])
        if record.status not in _TERMINAL:
            raise ProjectConflict("verification_result_not_terminal")
        for _ in range(3):
            child = self.store.get_operation(record.operationId, owner_id=owner_id)
            terminal = "cancelled" if record.status == "cancelled" else "completed"
            result = {"verificationId": verification_id, "verificationStatus": record.status,
                      "revision": record.revision, "errorCode": record.errorCode, "deliveryEligible": False}
            if child.status in {"completed", "failed", "cancelled"}:
                if child.status != terminal or child.result != result:
                    raise ProjectConflict("verification_operation_terminal_conflict")
                return self._snapshot(record, owner_id)
            context = self._context(record.operationId, owner_id, lease_generation, lease_owner,
                cleanup=True, require_running=False)
            updated = child.model_copy(update={"status": terminal, "result": result, "updatedAt": _now()})
            params = [updated.model_dump_json(), record.operationId, context["child_rev"], context["child_payload"]]
            prefix, fence = self._guard(context, params)
            if self.store._q(prefix + "update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and payload=$4 and " + fence + " returning id", params):
                return self._snapshot(record, owner_id)
        raise ProjectConflict("verification_state_changed")

    def read_artifact(self, verification_id, artifact_id, *, owner_id):
        record = self.get(verification_id, owner_id=owner_id).verification
        ref = next((ref for ref in record.artifactRefs if ref.artifactId == artifact_id), None)
        if ref is None:
            raise ProjectNotFound("verification_artifact_not_found")
        rows = self.store._q("select content,size_bytes from wb_project_verification_artifact where project_id=$1 and hash=$2", [record.projectId, ref.sha256])
        if not rows:
            raise ProjectStoreUnavailable("verification_artifact_missing")
        try:
            data = base64.b64decode(rows[0]["content"], validate=True)
        except ValueError:
            raise ProjectStoreUnavailable("verification_artifact_corrupt") from None
        if len(data) != ref.sizeBytes or len(data) != rows[0]["size_bytes"] or hashlib.sha256(data).hexdigest() != ref.sha256:
            raise ProjectStoreUnavailable("verification_artifact_corrupt")
        return data
