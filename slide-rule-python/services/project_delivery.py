"""Versioned delivery archives from independent evidence, separate from hosting.

The current source/plan and managed acceptance profile are checked on preparation
and on status reads. Historical downloads retain their original evidence and
explicitly report current staleness. A client-supplied closure, a ready preview, or a historical
passed record cannot unlock a current release. Preparing a ZIP does not deploy it.
"""

import io
import json
import zipfile
from datetime import datetime, timezone

from services.project_acceptance import TASK_ACCEPTANCE_PROFILE, TASK_TEMPLATE_VERSION, acceptance_profile
from services.project_authority import approved_reference
from services.project_export import source_archive
from services.project_manifest import canonical_json, content_hash
from services.project_source_operations import ProjectSourceOperations
from services.project_store import ProjectConflict, ProjectNotFound
from services.project_verification_gate import validate_build_evidence, validate_verification_result
from services.project_verification_store import ProjectVerificationStore
from services.scope_authority import plan_execution_authorized


class ProjectDeliveryService:
    def __init__(self, store, owner_id):
        self.store, self.owner_id = store, owner_id
        self.source = ProjectSourceOperations(store, None, owner_id)
        self.records = ProjectVerificationStore(store)
        store._q("create table if not exists wb_project_release (id varchar(80) primary key,project_id varchar(80) not null,idempotency_key varchar(64) not null,created_at varchar(64) not null,payload text not null,unique(project_id,idempotency_key))")

    def _evidence(self, project_id, verification_id=None):
        project, authority = self.source.authority(project_id)
        revision = self.store.get_revision(project_id, owner_id=self.owner_id)
        reasons = []
        if not plan_execution_authorized(authority):
            reasons.append("project_plan_approval_required")
        if revision.templateVersion != TASK_TEMPLATE_VERSION or revision.specRevision != TASK_ACCEPTANCE_PROFILE:
            reasons.append("project_acceptance_profile_not_bound")
        snapshot = (self.records.get(verification_id, owner_id=self.owner_id, current_plan_ref=approved_reference(authority))
            if verification_id else self.records.latest(project_id, owner_id=self.owner_id,
                current_plan_ref=approved_reference(authority)))
        if snapshot is None:
            reasons.append("project_verification_required")
        elif snapshot.verification.projectId != project_id:
            raise ProjectNotFound("project_verification_not_found")
        elif snapshot.effectiveStatus != "passed" or snapshot.verification.suiteVersion != "react-vite-tasks@1":
            reasons.append("project_current_business_verification_required")
        else:
            record = snapshot.verification
            files = self.store.read_files(project_id, revision.revision, owner_id=self.owner_id)
            try:
                build = validate_build_evidence(record.build, revision=revision.revision, tree_hash=revision.treeHash,
                    lockfile_hash=content_hash(files.get("package-lock.json", "")), suite_version=record.suiteVersion)
                validate_verification_result(record.status, record.assertions, artifact_count=len(record.artifactRefs),
                    suite_version=record.suiteVersion, error_code=record.errorCode, build=build)
            except ValueError:
                reasons.append("project_verification_evidence_incomplete")
        return project, authority, revision, snapshot, reasons

    def status(self, project_id):
        project, _authority, revision, snapshot, reasons = self._evidence(project_id)
        extras = snapshot.verification.acceptanceRequirements if snapshot else []
        rows = self.store._q("select payload from wb_project_release where project_id=$1 order by created_at desc,id desc limit 20", [project_id])
        releases = []
        for row in rows:
            saved = json.loads(row["payload"])
            saved["effectiveStatus"] = "ready" if not reasons and saved["revision"] == revision.revision and snapshot and saved["verificationId"] == snapshot.verification.verificationId else "stale"
            releases.append(saved)
        return {"projectId": project.projectId, "revision": revision.revision, "eligible": not reasons,
            "profile": acceptance_profile(extras), "blockedReasons": reasons,
            "verificationId": snapshot.verification.verificationId if snapshot else None,
            "releases": releases, "deployment": {"status": "not_configured", "publicUrl": None}}

    def prepare(self, project_id, *, expected_revision, verification_id, idempotency_key):
        project, authority, revision, snapshot, reasons = self._evidence(project_id, verification_id)
        if revision.revision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        if reasons or snapshot is None:
            raise ProjectConflict(reasons[0] if reasons else "project_verification_required")
        key = content_hash(idempotency_key)
        release_id = "prel-" + content_hash(canonical_json([project_id, key]))[:40]
        evidence = snapshot.verification
        value = {"releaseId": release_id, "projectId": project_id, "revision": revision.revision,
            "treeHash": revision.treeHash, "verificationId": verification_id,
            "profileId": TASK_ACCEPTANCE_PROFILE, "planRef": approved_reference(authority),
            "lockfileHash": evidence.build.lockfileHash, "buildHash": evidence.build.outputHash,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "downloadPath": f"/api/sliderule/projects/{project_id}/releases/{release_id}/download",
            "deployed": False}
        # Publishing this small immutable index does not own a remote execution.
        # Source CAS is checked in the INSERT; historical receipts stay historical.
        self.store._q("insert into wb_project_release(id,project_id,idempotency_key,created_at,payload) "
            "select $1,$2,$3,$4,$5 where exists(select 1 from wb_project where id=$2 and owner_id=$6 and current_revision=$7) "
            "on conflict(project_id,idempotency_key) do nothing",
            [release_id, project_id, key, value["createdAt"], canonical_json(value), self.owner_id, revision.revision])
        rows = self.store._q("select payload from wb_project_release where id=$1 and project_id=$2", [release_id, project_id])
        if not rows:
            raise ProjectConflict("project_revision_conflict")
        actual = json.loads(rows[0]["payload"])
        if any(actual[name] != value[name] for name in ("revision", "verificationId", "profileId", "planRef")):
            raise ProjectConflict("project_idempotency_conflict")
        # A concurrent authority change can leave a historical record, but it
        # cannot be returned as a currently eligible delivery.
        _p, _a, after, _s, reasons = self._evidence(project_id, verification_id)
        if reasons or after.revision != expected_revision:
            raise ProjectConflict("project_delivery_authority_changed")
        return actual

    def download(self, project_id, release_id):
        self.source.authority(project_id)
        rows = self.store._q("select payload from wb_project_release where id=$1 and project_id=$2", [release_id, project_id])
        if not rows:
            raise ProjectNotFound("project_release_not_found")
        release = json.loads(rows[0]["payload"])
        saved = self.store.get_revision(project_id, release["revision"], owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        record = self.records.get(release["verificationId"], owner_id=self.owner_id).verification
        project, _authority, _revision, current, reasons = self._evidence(project_id, release["verificationId"])
        effective_status = "ready" if (not reasons and project.currentRevision == release["revision"]
            and current and current.effectiveStatus == "passed") else "stale"
        data = io.BytesIO(source_archive(files, saved))
        with zipfile.ZipFile(data, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("delivery.json", canonical_json({**release, "profile": acceptance_profile(),
                "verification": record.model_dump(mode="json"), "hostingConfigured": False,
                "currentRevision": project.currentRevision, "effectiveStatus": effective_status,
                "blockedReasons": reasons}))
            archive.writestr("deployment/Dockerfile", "FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY . .\nRUN npm ci --ignore-scripts && npm run build\nENV NODE_ENV=production\nENV WHYBUDDY_APP_DATA_DIR=/data\nEXPOSE 5173\nCMD [\"npm\",\"start\",\"--\",\"--host\",\"0.0.0.0\",\"--port\",\"5173\",\"--static-dir\",\"dist\"]\n")
            archive.writestr("DEPLOYING.md", "# Deploying the task application\n\nBuild deployment/Dockerfile and mount a persistent volume at /data. Configure TLS and an independent domain before public use. Create the application administrator privately before opening public access. Keep database backups outside the container. This archive has not been deployed.\n\nExample: docker build -f deployment/Dockerfile -t whybuddy-task source\n\nRun: docker run --rm -p 127.0.0.1:5173:5173 -v whybuddy-task-data:/data whybuddy-task\n")
        return data.getvalue()
