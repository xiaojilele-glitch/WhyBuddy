"""Project approval checks shared by submission and session persistence."""

from __future__ import annotations

import hashlib

from models.v5_state import V5SessionState
from services.scope_authority import latest_control_plan, plan_execution_authorized
from services.project_acceptance import TASK_ACCEPTANCE_PROFILE
from services.project_verification_gate import validate_build_evidence, validate_verification_result


def approved_reference(state: V5SessionState) -> str:
    plan = latest_control_plan(state)
    digest = hashlib.sha256(str(plan.get("planContent", "")).encode("utf-8")).hexdigest()
    return f"{plan.get('planId')}:{plan.get('revision')}:{digest}"


def assert_session_authorized(state: V5SessionState, *, owner_id: str, approval_ref: str) -> None:
    if not owner_id or state.ownerId != owner_id:
        raise PermissionError("project_session_owner_mismatch")
    if not plan_execution_authorized(state) or approved_reference(state) != approval_ref:
        raise PermissionError("project_plan_approval_required")


def verification_with_current_authority(snapshot, authority):
    """Historic evidence cannot carry a revoked or replaced plan's authority."""
    if snapshot is not None and (not plan_execution_authorized(authority)
            or snapshot.verification.planRef != approved_reference(authority)):
        return snapshot.model_copy(update={"effectiveStatus": "stale", "deliveryEligible": False})
    if snapshot is not None:
        record = snapshot.verification
        eligible = (snapshot.effectiveStatus == "passed" and not record.acceptanceRequirements
            and record.suiteVersion == "react-vite-tasks@1"
            and record.specRevision == TASK_ACCEPTANCE_PROFILE and record.build is not None)
        if eligible:
            try:
                # Store snapshots already compare this lock hash with the
                # current immutable manifest. Also bind the typed build to its
                # receipt here, so a copied/corrupt projection cannot skip IO
                # proof just because it contains all required assertions.
                build = validate_build_evidence(record.build, revision=record.revision,
                    tree_hash=record.treeHash, lockfile_hash=record.build.lockfileHash,
                    suite_version=record.suiteVersion)
                validate_verification_result(record.status, record.assertions,
                    artifact_count=len(record.artifactRefs), suite_version=record.suiteVersion,
                    error_code=record.errorCode, build=build)
            except ValueError:
                eligible = False
        return snapshot.model_copy(update={"deliveryEligible": eligible})
    return snapshot


def has_generated_application(state: V5SessionState) -> bool:
    pages = state.specFirstPages or {}
    if pages.get("pages") or state.modelVersions or state.currentModelVersionId:
        return True
    return any(
        artifact.kind in {"app_model", "model", "page", "html", "prototype", "five_system_model"}
        or bool((artifact.payload or {}).get("html"))
        for artifact in state.artifacts
    )
