"""Fixed-suite browser evidence is narrower than product delivery acceptance.

Only the trusted verifier produces these assertions. A document saying passed,
an exit code or a screenshot alone cannot satisfy the suite. Preserve historic
outcomes; project-head and specification changes make their current view stale.
"""
from models.project_runtime import VerificationAssertion, VerificationBuildEvidence, VerificationRecord, VerificationSnapshot

SUITE_VERSION = "react-vite-counter@1"
RUNNER_VERSION = "whybuddy-browser-v1:pw1.61.1"
REQUIRED_ASSERTIONS = frozenset({"heading_visible", "counter_initial", "counter_increment",
    "counter_second_increment", "reload_reset", "no_page_errors", "no_failed_requests"})
SUITE_ASSERTIONS = {SUITE_VERSION: REQUIRED_ASSERTIONS,
    # ⚠ 2026-09-18：reader_login 拆成两条——页面凭据路径 / 独立 API 凭据路径。
    #   原来混在一条里，红了只知道"角色不对"，看不出是哪一侧不对。
    "react-vite-tasks@1": frozenset({"setup_admin", "writer_login", "task_create", "task_edit", "task_filter",
        "task_refresh", "reader_create", "reader_login", "reader_api_session",
        "reader_ui_readonly", "reader_api_forbidden",
        "anonymous_api_forbidden", "no_page_errors", "no_failed_requests"})}


def validate_build_evidence(build, *, revision, tree_hash, lockfile_hash, suite_version):
    if build is None:
        return None
    # model_copy/model_construct deliberately bypass Pydantic validation. The
    # persistence authority revalidates even an internal typed instance.
    checked = VerificationBuildEvidence.model_validate(build.model_dump(mode="python")
        if isinstance(build, VerificationBuildEvidence) else build)
    if (checked.revision != revision or checked.treeHash != tree_hash or checked.lockfileHash != lockfile_hash
            or checked.serverKind != ("tasks-node" if suite_version == "react-vite-tasks@1" else "static-dist")):
        raise ValueError("verification_build_revision_mismatch")
    if checked.status == "passed" and (checked.installExitCode != 0 or checked.buildExitCode != 0
            or checked.outputHash is None or checked.outputFileCount < 2 or checked.outputBytes < 1):
        raise ValueError("verification_build_evidence_incomplete")
    if checked.status == "failed" and not any(code is not None and code != 0
            for code in (checked.installExitCode, checked.buildExitCode)):
        raise ValueError("verification_build_failure_required")
    return checked


def validate_verification_result(status: str, assertions: list, *, artifact_count: int,
                                 suite_version: str, error_code: str | None = None,
                                 build: VerificationBuildEvidence | None = None) -> list[VerificationAssertion]:
    if suite_version not in SUITE_ASSERTIONS:
        raise ValueError("verification_suite_unsupported")
    if status not in {"passed", "failed", "blocked", "cancelled"}:
        raise ValueError("verification_status_invalid")
    if not isinstance(assertions, list) or len(assertions) > 64:
        raise ValueError("verification_assertions_invalid")
    checked = [item if isinstance(item, VerificationAssertion) else VerificationAssertion.model_validate(item) for item in assertions]
    names = [item.id for item in checked]
    required = SUITE_ASSERTIONS[suite_version]
    if len(names) != len(set(names)) or any(name not in required for name in names):
        raise ValueError("verification_assertions_invalid")
    if error_code is not None and (not isinstance(error_code, str) or not 1 <= len(error_code) <= 240):
        raise ValueError("verification_error_invalid")
    if status == "passed" and (set(names) != required or not all(item.status == "passed" for item in checked)
                               or artifact_count < 1 or error_code is not None or build is None or build.status != "passed"):
        raise ValueError("verification_evidence_incomplete")
    if status == "failed" and not any(item.status == "failed" for item in checked) and not (build and build.status == "failed"):
        raise ValueError("verification_failure_evidence_required")
    if status in {"blocked", "cancelled"} and not error_code:
        raise ValueError("verification_error_required")
    return checked


def verification_snapshot(record: VerificationRecord, *, revision: str, tree_hash: str,
                          spec_revision: str | None, plan_ref: str | None,
                          lockfile_hash: str | None) -> VerificationSnapshot:
    evidence_current = True
    try:
        checked = validate_build_evidence(record.build, revision=revision, tree_hash=tree_hash,
            lockfile_hash=lockfile_hash, suite_version=record.suiteVersion)
        if record.status == "passed":
            validate_verification_result(record.status, record.assertions,
                artifact_count=len(record.artifactRefs), suite_version=record.suiteVersion,
                error_code=record.errorCode, build=checked)
    except ValueError:
        evidence_current = False
    stale = (record.revision != revision or record.treeHash != tree_hash
             or record.specRevision != spec_revision or record.planRef != plan_ref
             or record.suiteVersion not in SUITE_ASSERTIONS or record.runnerVersion != RUNNER_VERSION
             or not evidence_current)
    return VerificationSnapshot(verification=record, effectiveStatus="stale" if stale else record.status)
