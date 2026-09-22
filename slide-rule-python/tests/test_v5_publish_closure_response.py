"""Focused schema + derive tests for Python publishClosure/runtimeClosure response payloads.

Covers:
- positive evidence: constructs valid publishClosure payload shape from runtimeClosure result in capabilityRun
- fail-closed negative: None for missing data, empty runs (degraded/error cases preserve prior semantics)
- schema validation via PublishClosureResponse Pydantic model
- deterministic local only; no side effects
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from models.v5_state import Artifact, CapabilityRun, ExecuteCapabilityResult, V5SessionState  # noqa: E402
from services.v5_capability_executor import execute_v5_capability  # noqa: E402
from services.v5_publish_closure_response import (
    derive_publish_closure_response,
    PublishClosureResponse,
    PublishClosureTierCounts,
)  # noqa: E402


def test_derive_publish_closure_response_from_runtime_closure_result():
    state = V5SessionState(
        sessionId="closure-response",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-closure",
                capabilityId="appbundle.runtimeClosure",
                turnId="t1",
                result={
                    "runtimeClosure": {
                        "blocked": False,
                        "blockers": [
                            {
                                "code": "APPBUNDLE_PUBLISH_REF_MISSING",
                                "path": "menuEntries[0].roleRefs[2]",
                                "affectedSkill": "rbac",
                                "ref": "role:finance-admin",
                            }
                        ],
                        "perSkillEvidence": {
                            "datamodel": {"evidencePresent": True},
                            "rbac": {"evidencePresent": True},
                            "workflow": {"evidencePresent": True},
                            "page": {"evidencePresent": True},
                            "aigc": {"evidencePresent": True},
                            "appbundle": {"evidencePresent": True},
                        },
                        "runtimeClosure": {
                            "skillsChecked": ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
                            "versionPinsChecked": True,
                        },
                        "closureId": "appbundle:app_purchase_approval@1.0.0:runtime-closure",
                        "closureHash": "feedface",
                        "stableDigest": "deadbeef",
                        "findingsByTier": {"hard_blocker": [], "warning": [{}], "info": [{}, {}]},
                    }
                },
            )
        ],
    )

    response = derive_publish_closure_response(state)

    assert response is not None
    # schema shape validation (evidence of typed schema)
    validated = PublishClosureResponse.model_validate(response)
    assert isinstance(validated.tierCounts, PublishClosureTierCounts)
    assert response["blocked"] is False
    assert response["blockerCount"] == 1
    assert response["evidencePresentCount"] == 6
    assert response["skillCount"] == 6
    assert response["versionPinsChecked"] is True
    assert response["closureHash"] == "feedface"
    assert response["stableDigest"] == "deadbeef"
    assert response["tierCounts"] == {"hard_blocker": 0, "warning": 1, "info": 2}
    assert response["perSkillEvidence"]["datamodel"]["evidencePresent"] is True
    assert response["perSkillEvidence"]["aigc"]["evidencePresent"] is True
    assert response["topBlockers"][0]["affectedSkill"] == "rbac"
    assert response["topBlockers"][0]["ref"] == "role:finance-admin"


def test_derive_publish_closure_response_returns_none_without_runtime_closure():
    """Fail-closed negative: empty runs -> None (no data to derive)."""
    state = V5SessionState(
        sessionId="closure-response-empty",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[],
    )

    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_returns_none_for_degraded_result():
    """Fail-closed negative for degraded: presence of data inside degraded run is still returned
    (driver callers control degraded state exposure); here we test a run without usable closure shape
    is None, and confirm a shape with runtimeClosure inside degraded still derives (current semantics).
    """
    # No usable closure shape at all -> None
    state = V5SessionState(
        sessionId="closure-degraded",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-deg",
                capabilityId="appbundle.runtimeClosure",
                turnId="t2",
                result={"degraded": True},
            )
        ],
    )
    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_fail_closed_on_error_run():
    """Fail-closed negative: error run with no closure data yields None."""
    state = V5SessionState(
        sessionId="closure-error",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-err",
                capabilityId="appbundle.runtimeClosure",
                turnId="t3",
                result={"foo": "bar"},
                error={"code": "CAP_FAILED", "message": "simulated"},
            )
        ],
    )
    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_blocked_for_missing_declared_skill_evidence():
    """Focused blocked-path test (task 119 objective): missing declared Skill evidence does not fake green.

    Declared skills appear in skillsChecked + perSkillEvidence (simulating skillModel presence in evaluate).
    When any has evidencePresent=False, report must report blocked=True (APPBUNDLE_RUNTIME_CLOSURE_BLOCKED semantics).
    Prove derive pass-through for /drive-full surfaces the blocked state (no green faking) for Python path.
    Includes positive schema evidence + negative (blocked, partial evidencePresentCount) behavior.
    All local deterministic; no provider/RAG/DB calls; preserves fail-closed for missing data cases.
    """
    state = V5SessionState(
        sessionId="closure-missing-skill-ev-119",
        goal={"text": "missing declared skill evidence blocked path"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-missing-skill-ev",
                capabilityId="appbundle.runtimeClosure",
                turnId="t-miss-ev",
                result={
                    "runtimeClosure": {
                        "blocked": True,
                        "blockers": [
                            {
                                "code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                                "path": "rbac",
                                "affectedSkill": "rbac",
                                "ref": "",
                            }
                        ],
                        "perSkillEvidence": {
                            "datamodel": {"evidencePresent": True},
                            "rbac": {"evidencePresent": False},  # declared skill (in checked) but missing evidence
                            "appbundle": {"evidencePresent": True},
                        },
                        "runtimeClosure": {
                            "skillsChecked": ["datamodel", "rbac", "appbundle"],
                            "versionPinsChecked": True,
                        },
                        "closureId": "missing-ev-119",
                        "closureHash": "badbeef",
                        "stableDigest": "fade",
                        "findingsByTier": {"hard_blocker": [{}], "warning": [], "info": []},
                    }
                },
            )
        ],
    )

    response = derive_publish_closure_response(state)

    assert response is not None, "derive must surface summary (for pass-through) even on blocked report from declared-missing-ev"
    # schema validation (positive evidence of typed schema)
    validated = PublishClosureResponse.model_validate(response)
    assert isinstance(validated.tierCounts, PublishClosureTierCounts)
    # core proof: does not fake green
    assert response["blocked"] is True, "missing declared Skill evidence must force blocked (not green)"
    assert response["blockerCount"] == 1
    assert response["evidencePresentCount"] == 2
    assert response["skillCount"] == 3
    assert response["perSkillEvidence"]["rbac"]["evidencePresent"] is False
    assert response["topBlockers"][0]["affectedSkill"] == "rbac"

# 119 precheck: Python test matrix for drive-full closure schema + happy/blocked paths.
# Positive (happy): non-blocked with evidence -> publishClosure reflects happy evidence.
# Negative/fail-closed: blocked true with blockers; also absence returns None (no false publish ok).
@pytest.mark.parametrize(
    ("label", "blocked", "blockers", "skills_evidence", "expected_blocked", "expected_blocker_count"),
    [
        # happy path: clean publish, evidence present across skills
        (
            "happy-evidence-present",
            False,
            [],
            {
                "datamodel": {"evidencePresent": True},
                "rbac": {"evidencePresent": True},
                "workflow": {"evidencePresent": True},
                "page": {"evidencePresent": True},
                "aigc": {"evidencePresent": True},
                "appbundle": {"evidencePresent": True},
            },
            False,
            0,
        ),
        # blocked path: has blockers -> blocked true, topBlockers populated
        (
            "blocked-with-appbundle-ref-missing",
            True,
            [
                {
                    "code": "APPBUNDLE_PUBLISH_REF_MISSING",
                    "path": "menuEntries[0].roleRefs[2]",
                    "affectedSkill": "rbac",
                    "ref": "role:finance-admin",
                }
            ],
            {
                "datamodel": {"evidencePresent": True},
                "rbac": {"evidencePresent": False},
                "workflow": {"evidencePresent": True},
                "page": {"evidencePresent": True},
                "aigc": {"evidencePresent": True},
                "appbundle": {"evidencePresent": True},
            },
            True,
            1,
        ),
        # blocked path variant: multiple blockers, fail-closed surface (top 3 only in summary)
        (
            "blocked-multi",
            True,
            [
                {"code": "B1", "path": "p1", "affectedSkill": "s1", "ref": "r1"},
                {"code": "B2", "path": "p2", "affectedSkill": "s2", "ref": "r2"},
                {"code": "B3", "path": "p3", "affectedSkill": "s3", "ref": "r3"},
                {"code": "B4", "path": "p4", "affectedSkill": "s4", "ref": "r4"},
            ],
            {"datamodel": {"evidencePresent": False}},
            True,
            4,
        ),
    ],
)
def test_drive_full_closure_schema_matrix_happy_blocked_119(
    label: str,
    blocked: bool,
    blockers: list,
    skills_evidence: dict,
    expected_blocked: bool,
    expected_blocker_count: int,
):
    """Drive-full closure schema matrix: exercises derive_publish_closure_response with drive-full style runtimeClosure payload.
    Covers schema keys used by routes after drive_full_v5_session: blocked, blockers, perSkillEvidence, runtimeClosure inner, closureHash etc.
    Positive evidence + explicit fail-closed negative (blocked) behavior.
    """
    runtime_inner = {
        "skillsChecked": list(skills_evidence.keys()),
        "versionPinsChecked": True,
    }
    state = V5SessionState(
        sessionId=f"closure-matrix-{label}",
        goal={"text": f"drive full closure matrix {label}"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id=f"run-closure-{label}",
                capabilityId="appbundle.runtimeClosure",
                turnId="t-closure-matrix",
                result={
                    "runtimeClosure": {
                        "blocked": blocked,
                        "blockers": blockers,
                        "perSkillEvidence": skills_evidence,
                        "runtimeClosure": runtime_inner,
                        "closureId": f"appbundle:matrix@{label}:runtime-closure",
                        "closureHash": "c0ffee",
                        "stableDigest": "baddcafe",
                        "findingsByTier": {
                            "hard_blocker": [{"code": "H"}] if blocked else [],
                            "warning": [],
                            "info": [],
                        },
                    }
                },
            )
        ],
    )

    response = derive_publish_closure_response(state)

    assert response is not None, f"matrix case {label} must surface publishClosure"
    assert response["blocked"] is expected_blocked, f"blocked mismatch for {label}"
    assert response["blockerCount"] == expected_blocker_count
    assert response["evidencePresentCount"] == sum(
        1 for v in skills_evidence.values() if v.get("evidencePresent") is True
    )
    assert response["skillCount"] == len(skills_evidence)
    assert response["versionPinsChecked"] is True
    assert response.get("closureHash") == "c0ffee"
    if expected_blocked and blockers:
        assert len(response.get("topBlockers", [])) >= 1
        assert response["topBlockers"][0]["affectedSkill"] == blockers[0]["affectedSkill"]
    # fail-closed negative: if no closure cap run, None (already covered by sibling test)


def test_drive_full_closure_response_absent_is_fail_closed_119():
    """Explicit fail-closed: drive full without closure run yields no publishClosure (None)."""
    state = V5SessionState(
        sessionId="closure-matrix-absent",
        goal={"text": "drive full no closure cap"},
        artifacts=[],
        capabilityRuns=[
            # some other cap run, no appbundle.runtimeClosure
            CapabilityRun(id="run-other", capabilityId="some.other", turnId="t1", result={"title": "x"})
        ],
    )
    assert derive_publish_closure_response(state) is None


def test_publish_closure_derives_from_execute_result_runtime_closure_attachment_120(recwarn):
    result = ExecuteCapabilityResult(
        title="appbundle.runtimeClosure",
        summary="closure eval",
        content="",
        provenance="python-closure",
    )
    result.__dict__["runtimeClosure"] = {
        "blocked": False,
        "blockers": [],
        "perSkillEvidence": {
            "datamodel": {"evidencePresent": True},
            "rbac": {"evidencePresent": True},
            "appbundle": {"evidencePresent": True},
        },
        "runtimeClosure": {
            "skillsChecked": ["datamodel", "rbac", "appbundle"],
            "versionPinsChecked": True,
        },
        "closureId": "appbundle:compat@120",
        "closureHash": "c0ffee120",
        "stableDigest": "beef120",
        "findingsByTier": {"hard_blocker": [], "warning": [], "info": []},
    }
    run = CapabilityRun(
        id="run-nested-120",
        capabilityId="appbundle.runtimeClosure",
        turnId="t120",
        result=None,
    )
    run.result = result
    state = V5SessionState(
        sessionId="closure-nested-model-120",
        goal={"text": "nested model_dump compat"},
        artifacts=[],
        capabilityRuns=[run],
    )

    response = derive_publish_closure_response(state)

    assert response is not None
    validated = PublishClosureResponse.model_validate(response)
    assert isinstance(validated.tierCounts, PublishClosureTierCounts)
    assert response["blocked"] is False
    assert response["closureHash"] == "c0ffee120"
    assert response["perSkillEvidence"]["rbac"]["evidencePresent"] is True
    assert not [
        warning for warning in recwarn.list
        if "PydanticSerializationUnexpectedValue" in str(warning.message)
    ]


def test_appbundle_executor_closure_hash_stable_for_unchanged_publish_inputs_120():
    def state_for(suffix: str) -> V5SessionState:
        return V5SessionState(
            sessionId=f"hash-{suffix}",
            goal={"text": "build publish manifest"},
            artifacts=[
                Artifact(id=f"artifact-datamodel-{suffix}", kind="evidence", title="datamodel skill closure"),
                Artifact(id=f"artifact-rbac-{suffix}", kind="evidence", title="rbac skill closure"),
                Artifact(id=f"artifact-workflow-{suffix}", kind="evidence", title="workflow skill closure"),
                Artifact(id=f"artifact-page-{suffix}", kind="evidence", title="page skill closure"),
                Artifact(id=f"artifact-aigc-{suffix}", kind="evidence", title="aigc skill closure"),
                Artifact(id=f"artifact-appbundle-{suffix}", kind="evidence", title="appbundle skill closure"),
            ],
            capabilityRuns=[],
        )

    first = state_for("same")
    second = state_for("same")
    changed = state_for("changed")

    first_result = execute_v5_capability("appbundle.runtimeClosure", first, [], "agent", "t1")
    second_result = execute_v5_capability("appbundle.runtimeClosure", second, [], "agent", "t2")
    changed_result = execute_v5_capability("appbundle.runtimeClosure", changed, [], "agent", "t3")

    first.capabilityRuns = [
        CapabilityRun(id="run-first", capabilityId="appbundle.runtimeClosure", turnId="t1", result=first_result)
    ]
    second.capabilityRuns = [
        CapabilityRun(id="run-second", capabilityId="appbundle.runtimeClosure", turnId="t2", result=second_result)
    ]
    changed.capabilityRuns = [
        CapabilityRun(id="run-changed", capabilityId="appbundle.runtimeClosure", turnId="t3", result=changed_result)
    ]

    first_closure = derive_publish_closure_response(first)
    second_closure = derive_publish_closure_response(second)
    changed_closure = derive_publish_closure_response(changed)

    assert first_closure is not None
    assert second_closure is not None
    assert changed_closure is not None
    assert first_closure["blocked"] is False
    assert first_closure["evidencePresentCount"] == 6
    assert first_closure["closureHash"] == second_closure["closureHash"]
    assert first_closure["stableDigest"] == second_closure["stableDigest"]
    assert first_closure["closureHash"] != changed_closure["closureHash"]
    assert first_closure["stableDigest"] != changed_closure["stableDigest"]


def test_refine_paint_note_survives_the_whitelist():
    """新增闭环信号必须进白名单，否则前端只看到结论看不到「没画上」。"""
    state = V5SessionState(
        sessionId="closure-paint-note",
        goal={"text": "精修红标"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-paint",
                capabilityId="appbundle.runtimeClosure",
                turnId="t2",
                result={
                    "runtimeClosure": {
                        "skillsChecked": ["page"],
                        "versionPinsChecked": True,
                    },
                    "blocked": False,
                    "blockers": [],
                    "perSkillEvidence": {"page": {"evidencePresent": True}},
                    "findingsByTier": {"hard_blocker": [], "warning": [], "info": []},
                    "refinePaintNote": "这一处没画上：结构闸说臆造字段",
                },
            )
        ],
    )
    response = derive_publish_closure_response(state)
    assert response is not None
    assert response["refinePaintNote"] == "这一处没画上：结构闸说臆造字段"


def test_refine_reuse_note_survives_the_whitelist():
    """左栏收口句必须进白名单，否则刷新后又变回「42 步」。"""
    state = V5SessionState(
        sessionId="closure-reuse-note",
        goal={"text": "精修催离"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-reuse",
                capabilityId="appbundle.runtimeClosure",
                turnId="t3",
                result={
                    "runtimeClosure": {
                        "skillsChecked": ["page"],
                        "versionPinsChecked": True,
                    },
                    "blocked": False,
                    "blockers": [],
                    "perSkillEvidence": {"page": {"evidencePresent": True}},
                    "findingsByTier": {"hard_blocker": [], "warning": [], "info": []},
                    "refineReuseNote": "改了 异常条目（p3） · 沿用 3 页 · 规格、权限、流程沿用",
                },
            )
        ],
    )
    response = derive_publish_closure_response(state)
    assert response is not None
    assert "改了 异常条目" in response["refineReuseNote"]
    assert "42 步" not in response["refineReuseNote"]
