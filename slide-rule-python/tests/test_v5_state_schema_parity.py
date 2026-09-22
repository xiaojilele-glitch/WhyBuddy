"""
Focused pytest for Python-owned V5SessionState schema parity + Artifact contract + CapabilityRun contract + durable V5.2 session golden fixtures.
Tasks: ... + sliderule-python-v52-capability-run-contract-105 + sliderule-python-v52-state-ts-parity-golden-105 (sequence 8/72)
Proves Python directly owns the required TS core fields + ... + full durable V5.2 session state (incl. UserIntervention, currentFocus etc) via golden fixtures proving schema parity for durable V5.2 sessions.
Python authoritative golden fixture (GOLDEN_DURABLE_V52_SESSION) mirrors the TS golden exported from shared/blueprint/v5-reasoning-state.ts; Vitest contract test proves same shape accepted by TS V5SessionState (thin consumer).
Direct pytest asserts loads/roundtrips/legacy + full durable field parity with TS blueprint.
Any Node usage is thin proxy only; tests here are Python baseline.
Python classification for state-ts-parity-golden slice: PYTHON_AUTHORITY.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import Artifact, V5SessionState, GateState, DependencyEdge, AwaitReason, SchedulingDecision, CapabilityCostRecord, FlowBoundaryCheck, StructureGateCheck, SlideRuleReplayEvent, ReasoningEvent, ReasoningEventMeta, ProducedBy, CapabilityRun, UserIntervention  # noqa: E402


def test_v5_session_state_declares_ts_core_fields():
    """Python model must expose the exact core fields listed in task goal."""
    # construct with explicit values
    state = V5SessionState(
        sessionId="parity-001",
        goal={"text": "align schema", "status": "clear"},
        openQuestions=[{"id": "q1", "text": "What is risk?"}],
        evidence=[{"id": "e1", "kind": "evidence", "content": "fact"}],
        decisions=[{"id": "d1", "summary": "choose A"}],
        risks=[{"id": "r1", "severity": "high", "text": "blocker"}],
        gates=[GateState(gateId="ground", kind="precondition", status="passed")],
        dependencyGraph=[DependencyEdge(fromArtifactId="a1", toArtifactId="a2", reason="evidence-for")],
        artifacts=[],
        capabilityRuns=[],
        conversation=[],
    )
    assert isinstance(state.openQuestions, list)
    assert state.openQuestions[0]["id"] == "q1"
    assert isinstance(state.evidence, list) and len(state.evidence) == 1
    assert isinstance(state.decisions, list) and len(state.decisions) == 1
    assert isinstance(state.risks, list) and len(state.risks) == 1
    assert isinstance(state.gates, list) and isinstance(state.gates[0], GateState)
    assert isinstance(state.dependencyGraph, list) and isinstance(state.dependencyGraph[0], DependencyEdge)

    # schema level
    schema = state.model_json_schema()
    props = schema.get("properties", {})
    for field in ["openQuestions", "evidence", "decisions", "risks", "gates", "dependencyGraph"]:
        assert field in props, f"missing core field in Python V5SessionState: {field}"


def test_v5_session_state_core_fields_default_empty_and_roundtrip():
    """Defaults are empty lists; model roundtrips without loss."""
    minimal = V5SessionState(
        sessionId="parity-002",
        goal={"text": "default check", "status": "needs_refinement"},
    )
    assert minimal.openQuestions == []
    assert minimal.evidence == []
    assert minimal.decisions == []
    assert minimal.risks == []
    assert minimal.gates == []
    assert minimal.dependencyGraph == []

    dumped = minimal.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.openQuestions == []
    assert reloaded.gates == []


def test_artifact_defaults_untrusted_no_auto_trust():
    """Artifact must not default to trusted (gated_pass + commit) per requirements."""
    art = Artifact(id="art-parity-1", content="raw evidence")
    assert art.trustLevel == "untrusted"
    assert art.passedGates == []

    # explicit untrusted ok
    art2 = Artifact(id="art-parity-2", trustLevel="untrusted", passedGates=[], content="x")
    assert art2.trustLevel == "untrusted"


def test_v5_state_construct_from_partial_fixtures_still_works():
    """Python state remains compatible with existing partial initializers (compat layer)."""
    # old-style partials used in tests before this task
    partial = V5SessionState(
        sessionId="partial-fixture",
        goal={"text": "old partial", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
    )
    assert partial.openQuestions == []
    assert "openQuestions" in V5SessionState.model_fields
    assert partial.gates == []


def test_v5_session_state_runtime_phase_fields():
    """Python model must declare runtimePhase, await*, lastTurnId, deliveryPhase, roleMode with safe legacy defaults."""
    # explicit values
    state = V5SessionState(
        sessionId="rt-001",
        goal={"text": "runtime phase", "status": "clear"},
        runtimePhase="awaiting",
        awaitReason="coverage",
        awaitDetail="waiting on gaps",
        lastTurnId="turn-42",
        deliveryPhase="shipping",
        roleMode="complex",
    )
    assert state.runtimePhase == "awaiting"
    assert state.awaitReason == "coverage"
    assert state.awaitDetail == "waiting on gaps"
    assert state.lastTurnId == "turn-42"
    assert state.deliveryPhase == "shipping"
    assert state.roleMode == "complex"
    assert isinstance(state.awaitReason, str)  # Literal narrows but runtime str

    # schema level
    schema = state.model_json_schema()
    props = schema.get("properties", {})
    for field in ["runtimePhase", "awaitReason", "awaitDetail", "lastTurnId", "deliveryPhase", "roleMode"]:
        assert field in props, f"missing runtime field in Python V5SessionState: {field}"
    # enum constraints visible in schema
    assert "enum" in props["runtimePhase"] or props["runtimePhase"].get("anyOf")
    assert "enum" in props.get("awaitReason", {}) or any("enum" in (x or {}) for x in props.get("awaitReason", {}).get("anyOf", []))


def test_v5_session_state_runtime_fields_default_none_and_roundtrip():
    """Safe legacy defaults are None (or empty); pre-existing state without fields loads and roundtrips."""
    minimal = V5SessionState(
        sessionId="rt-002",
        goal={"text": "legacy defaults", "status": "needs_refinement"},
    )
    # safe legacy: None means not set / idle compat
    assert minimal.runtimePhase is None
    assert minimal.awaitReason is None
    assert minimal.awaitDetail is None
    assert minimal.lastTurnId is None
    assert minimal.deliveryPhase is None
    assert minimal.roleMode is None

    # roundtrip
    dumped = minimal.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.runtimePhase is None
    assert reloaded.awaitReason is None
    assert "runtimePhase" in V5SessionState.model_fields

    # old dict without keys must still construct (legacy compat)
    old_dict = {
        "sessionId": "legacy-001",
        "goal": {"text": "no runtime fields", "status": "clear"},
        "artifacts": [],
    }
    legacy_state = V5SessionState(**old_dict)
    assert legacy_state.runtimePhase is None
    assert legacy_state.roleMode is None


def test_v5_runtime_fields_validation_enums():
    """Literal enum constraints are enforced (invalid values fail)."""
    import pytest
    with pytest.raises(Exception):
        V5SessionState(
            sessionId="bad-001",
            goal={"text": "bad enum"},
            runtimePhase="invalid_phase",
        )
    with pytest.raises(Exception):
        V5SessionState(
            sessionId="bad-002",
            goal={"text": "bad await"},
            awaitReason="not_a_reason",
        )


def test_v5_session_state_ledger_fields_declare_and_construct():
    """Python V5SessionState must declare the four ledger fields with Pydantic models per task."""
    # explicit ledger entries
    dec = SchedulingDecision(
        id="dec-1",
        turnId="turn-7",
        saw=["capA", "capB"],
        chose=["capA"],
        skipped=[{"capabilityId": "capC", "reason": "budget"}],
        addresses=["gap1"],
        rationale="chose A for coverage",
        alternativesRejected=["capD"],
        createdAt="2026-07-02T00:00:00Z",
        source="local_heuristic",
    )
    cost = CapabilityCostRecord(
        id="cost-1",
        turnId="turn-7",
        capabilityRunId="run-42",
        capabilityId="capA",
        estimatedTokens=1200,
        estimatedCostUsd=0.03,
        durationMs=450,
        source="estimated",
        createdAt="2026-07-02T00:00:01Z",
    )
    flow = FlowBoundaryCheck(
        id="flow-1",
        turnId="turn-7",
        source="brainstorm",
        strippedProtocolNodes=["critiqueX"],
        assertions=["pure"],
        passed=True,
        createdAt="2026-07-02T00:00:02Z",
    )
    struct = StructureGateCheck(
        id="struct-1",
        turnId="turn-7",
        runId="run-42",
        gateId="G_SCHEMA",
        attempt=1,
        status="passed",
        reason="schema ok",
        createdAt="2026-07-02T00:00:03Z",
    )
    state = V5SessionState(
        sessionId="ledger-001",
        goal={"text": "ledger parity", "status": "clear"},
        decisionLedger=[dec],
        costLedger=[cost],
        flowBoundaryLedger=[flow],
        structureGateLedger=[struct],
    )
    assert isinstance(state.decisionLedger, list) and len(state.decisionLedger) == 1
    assert isinstance(state.decisionLedger[0], SchedulingDecision)
    assert state.decisionLedger[0].chose == ["capA"]
    assert isinstance(state.costLedger, list) and isinstance(state.costLedger[0], CapabilityCostRecord)
    assert isinstance(state.flowBoundaryLedger, list) and isinstance(state.flowBoundaryLedger[0], FlowBoundaryCheck)
    assert isinstance(state.structureGateLedger, list) and isinstance(state.structureGateLedger[0], StructureGateCheck)
    assert state.flowBoundaryLedger[0].passed is True
    assert state.structureGateLedger[0].status == "passed"

    # schema level exposure
    schema = state.model_json_schema()
    props = schema.get("properties", {})
    for field in ["decisionLedger", "costLedger", "flowBoundaryLedger", "structureGateLedger"]:
        assert field in props, f"missing ledger field in Python V5SessionState: {field}"
    # model refs visible
    assert "SchedulingDecision" in str(schema) or any("SchedulingDecision" in str(v) for v in props.values())


def test_v5_session_state_ledger_fields_default_empty_and_roundtrip():
    """Ledger lists default empty; full roundtrip preserves values and supports legacy partial states."""
    minimal = V5SessionState(
        sessionId="ledger-002",
        goal={"text": "default ledgers", "status": "needs_refinement"},
    )
    assert minimal.decisionLedger == []
    assert minimal.costLedger == []
    assert minimal.flowBoundaryLedger == []
    assert minimal.structureGateLedger == []

    # explicit empty lists ok
    state2 = V5SessionState(
        sessionId="ledger-003",
        goal={"text": "explicit empty"},
        decisionLedger=[],
        costLedger=[],
        flowBoundaryLedger=[],
        structureGateLedger=[],
    )
    assert state2.decisionLedger == []

    # roundtrip
    dumped = state2.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.decisionLedger == []
    assert reloaded.costLedger == []
    assert "decisionLedger" in V5SessionState.model_fields

    # legacy dict missing ledger keys must construct (persistence compat)
    old_dict = {
        "sessionId": "legacy-ledger-001",
        "goal": {"text": "no ledgers", "status": "clear"},
        "artifacts": [],
        "capabilityRuns": [],
    }
    legacy = V5SessionState(**old_dict)
    assert legacy.decisionLedger == []
    assert legacy.structureGateLedger == []
    assert legacy.costLedger == []


def test_v5_ledger_models_validation_shapes_and_literals():
    """Ledger models enforce required fields, literals, and reject bad values."""
    import pytest
    # valid minimal
    SchedulingDecision(id="d1", turnId="t1", createdAt="2026-01-01")
    FlowBoundaryCheck(id="f1", turnId="t1", source="artifact", passed=False, createdAt="2026-01-01")
    StructureGateCheck(id="s1", turnId="t1", runId="r1", gateId="G_INV", status="failed", createdAt="2026-01-01")
    CapabilityCostRecord(id="c1", turnId="t1", capabilityRunId="rr1", capabilityId="capX", source="server", createdAt="2026-01-01")

    # bad enum on source
    with pytest.raises(Exception):
        FlowBoundaryCheck(
            id="badf", turnId="t", source="invalid", passed=True, createdAt="2026-01-01"
        )
    with pytest.raises(Exception):
        CapabilityCostRecord(
            id="badc", turnId="t", capabilityRunId="r", capabilityId="c", source="badsrc", createdAt="2026-01-01"
        )


def test_v5_session_state_replay_events_declare_and_construct():
    """Python model must expose sessionReplayLog and reasoningEvents with typed models."""
    # construct explicit
    replay = SlideRuleReplayEvent(
        id="replay-1",
        sessionId="sess-9",
        at="2026-07-02T00:00:00Z",
        kind="capability_run",
        turnId="t1",
        capabilityId="evidence.search",
        capabilityRunId="run-7",
    )
    ev = ReasoningEvent(
        id="ev-1",
        turnId="t1",
        capabilityRunId="run-7",
        capabilityId="evidence.search",
        kind="observe",
        text="found 3 facts",
        order=0,
        ts="2026-07-02T00:00:01Z",
        refs=["a1"],
    )
    state = V5SessionState(
        sessionId="replay-001",
        goal={"text": "replay events parity", "status": "clear"},
        sessionReplayLog=[replay],
        reasoningEvents=[ev],
    )
    assert isinstance(state.sessionReplayLog, list) and len(state.sessionReplayLog) == 1
    assert isinstance(state.sessionReplayLog[0], SlideRuleReplayEvent)
    assert state.sessionReplayLog[0].kind == "capability_run"
    assert isinstance(state.reasoningEvents, list) and isinstance(state.reasoningEvents[0], ReasoningEvent)
    assert state.reasoningEvents[0].order == 0
    assert state.reasoningEvents[0].text == "found 3 facts"

    # schema exposure
    schema = state.model_json_schema()
    props = schema.get("properties", {})
    assert "sessionReplayLog" in props
    assert "reasoningEvents" in props
    # model refs
    assert "SlideRuleReplayEvent" in str(schema) or "SlideRuleReplayEvent" in str(props.get("sessionReplayLog", {}))
    assert "ReasoningEvent" in str(schema)


def test_v5_session_state_replay_events_default_empty_and_roundtrip():
    """Defaults empty lists; roundtrip; legacy saved session missing keys still loads."""
    minimal = V5SessionState(
        sessionId="replay-002",
        goal={"text": "default replay", "status": "needs_refinement"},
    )
    assert minimal.sessionReplayLog == []
    assert minimal.reasoningEvents == []

    dumped = minimal.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.sessionReplayLog == []
    assert reloaded.reasoningEvents == []

    # legacy dict without the keys (old saved sessions) must succeed and default
    old_dict = {
        "sessionId": "legacy-replay-001",
        "goal": {"text": "no replay keys", "status": "clear"},
        "artifacts": [],
        "capabilityRuns": [],
    }
    legacy = V5SessionState(**old_dict)
    assert legacy.sessionReplayLog == []
    assert legacy.reasoningEvents == []
    assert "sessionReplayLog" in V5SessionState.model_fields
    assert "reasoningEvents" in V5SessionState.model_fields


def test_v5_replay_reasoning_models_validation():
    """Event models accept valid, reject bad kinds."""
    import pytest
    # valid
    SlideRuleReplayEvent(id="r1", sessionId="s1", at="2026-01-01T00:00:00Z", kind="decision")
    ReasoningEvent(id="e1", turnId="t1", capabilityRunId="c1", capabilityId="x", kind="think", text="hi", order=1, ts="2026-01-01T00:00:00Z")

    # bad kind
    with pytest.raises(Exception):
        SlideRuleReplayEvent(id="bad", sessionId="s", at="2026", kind="bad_kind")
    with pytest.raises(Exception):
        ReasoningEvent(id="bad", turnId="t", capabilityRunId="c", capabilityId="x", kind="invalid", text="x", order=0, ts="2026")


def test_v5_session_state_stale_superseded_declare_and_construct():
    """Python V5SessionState must declare both staleArtifactIds and supersededArtifactIds with separation semantics."""
    # explicit both
    state = V5SessionState(
        sessionId="stale-sup-001",
        goal={"text": "stale vs superseded", "status": "clear"},
        staleArtifactIds=["art-old-1", "art-old-2"],
        supersededArtifactIds=["art-round-digest-42"],
    )
    assert isinstance(state.staleArtifactIds, list) and state.staleArtifactIds == ["art-old-1", "art-old-2"]
    assert isinstance(state.supersededArtifactIds, list) and state.supersededArtifactIds == ["art-round-digest-42"]

    # schema level
    schema = state.model_json_schema()
    props = schema.get("properties", {})
    assert "staleArtifactIds" in props
    assert "supersededArtifactIds" in props


def test_v5_session_state_stale_superseded_defaults_roundtrip_legacy_separation():
    """Defaults empty lists; roundtrip; legacy missing keys -> []; stale and superseded remain distinct and not mixed."""
    # minimal defaults
    minimal = V5SessionState(
        sessionId="stale-sup-002",
        goal={"text": "defaults", "status": "needs_refinement"},
    )
    assert minimal.staleArtifactIds == []
    assert minimal.supersededArtifactIds == []

    # explicit empty ok
    state2 = V5SessionState(
        sessionId="stale-sup-003",
        goal={"text": "explicit empty"},
        staleArtifactIds=[],
        supersededArtifactIds=[],
    )
    assert state2.staleArtifactIds == []
    assert state2.supersededArtifactIds == []

    # roundtrip
    dumped = state2.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.staleArtifactIds == []
    assert reloaded.supersededArtifactIds == []
    assert "staleArtifactIds" in V5SessionState.model_fields
    assert "supersededArtifactIds" in V5SessionState.model_fields

    # legacy dict missing both keys must construct with []
    old_dict = {
        "sessionId": "legacy-stale-sup-001",
        "goal": {"text": "no stale-sup keys", "status": "clear"},
        "artifacts": [],
        "capabilityRuns": [],
    }
    legacy = V5SessionState(**old_dict)
    assert legacy.staleArtifactIds == []
    assert legacy.supersededArtifactIds == []

    # separation: setting one does not affect the other (explicit non-mix)
    separated = V5SessionState(
        sessionId="stale-sup-004",
        goal={"text": "separation"},
        staleArtifactIds=["stale-only"],
        supersededArtifactIds=["superseded-only"],
    )
    assert "stale-only" in separated.staleArtifactIds and "superseded-only" not in separated.staleArtifactIds
    assert "superseded-only" in separated.supersededArtifactIds and "stale-only" not in separated.supersededArtifactIds

    # also test one only present
    stale_only = V5SessionState(
        sessionId="stale-sup-005",
        goal={"text": "stale only"},
        staleArtifactIds=["s1"],
    )
    assert stale_only.staleArtifactIds == ["s1"]
    assert stale_only.supersededArtifactIds == []


# --- Artifact contract focused tests for sliderule-python-v52-artifact-contract-105 ---
# Proves PYTHON_AUTHORITY over producedBy (structured), trustLevel/passedGates, stale, status, payload behavior.
# Covers: structure, payload does not participate in trust gates, stale/status semantics,
# roundtrip (via server_construct for elevated), legacy dict compat (without server fields), and FORGERY REJECTION:
# normal/ordinary input (direct + client dict + V5SessionState) rejects elevated trustLevel + producedBy + non-empty passedGates;
# server_construct/server_load are the only paths (provable server-only boundary per review).


def test_artifact_producedby_structured_and_required_semantics():
    """producedBy must be ProducedBy (structured) or None; matches TS contract; loose dict input coerces via server path only.
    Ordinary client construction rejects producedBy (server-owned); server_construct is required for any producedBy.
    """
    art = Artifact(id="a1", content="x")
    assert art.producedBy is None

    # structured server-owned provenance only via server_construct (even for untrusted)
    pb = ProducedBy(capabilityRunId="run-1-capX", capabilityId="evidence.search", roleId="agent")
    art2 = Artifact.server_construct(id="a2", producedBy=pb, content="y", trustLevel="untrusted")
    assert isinstance(art2.producedBy, ProducedBy)
    assert art2.producedBy.capabilityRunId == "run-1-capX"
    assert art2.producedBy.capabilityId == "evidence.search"

    # schema exposure
    schema = art2.model_json_schema()
    props = schema.get("properties", {})
    assert "producedBy" in props
    # ProducedBy is a nested model ref


def test_artifact_payload_preserved_and_does_not_affect_trust():
    """payload is retained for executor output; does NOT participate in trustLevel/passedGates (per TS R2)."""
    art = Artifact(
        id="a-payload-1",
        content="core",
        payload={"critiques": [{"role": "挑刺", "text": "foo"}], "sources": [{"url": "x"}]},
        trustLevel="untrusted",
        passedGates=[],
    )
    assert art.payload is not None
    assert "critiques" in art.payload
    # trust remains independent
    assert art.trustLevel == "untrusted"
    assert art.passedGates == []

    # even with payload, cannot be trusted without explicit gates+producedBy from server path (enforced by model validator)
    art2 = Artifact(
        id="a-payload-2",
        content="with payload",
        payload={"evidence": "internal"},
        trustLevel="untrusted",
    )
    assert art2.trustLevel == "untrusted"


def test_artifact_stale_and_status_semantics():
    """stale bool + status field have explicit semantics; default safe; do not auto-elevate trust."""
    art = Artifact(id="a-st-1", content="raw")
    assert art.stale is False
    assert art.status == "active"

    art_stale = Artifact(id="a-st-2", content="old", stale=True, status="stale")
    assert art_stale.stale is True
    assert art_stale.status == "stale"
    assert art_stale.trustLevel == "untrusted"  # stale does not imply or change trust

    art_sup = Artifact(id="a-st-3", content="digest", status="superseded", stale=False)
    assert art_sup.status == "superseded"
    assert art_sup.stale is False


def test_artifact_roundtrip_producedby_payload_status_stale():
    """Full Artifact with contract fields roundtrips losslessly; types preserved.
    Trusted (elevated) artifacts use server_construct for creation and trusted reload (persisted server state).
    """
    from models.v5_state import ProducedBy
    orig = Artifact.server_construct(
        id="round-1",
        kind="evidence",
        provenance="python-rag",
        trustLevel="gated_pass",
        passedGates=["ground", "commit"],
        title="t",
        summary="s",
        content="c",
        payload={"k": "v"},
        producedBy=ProducedBy(capabilityRunId="r1", capabilityId="cap1", roleId="r"),
        stale=True,
        status="stale",
    )
    dumped = orig.model_dump()
    # persisted state (server authored) reloads via server_construct (bypasses normal-construction rejection)
    reloaded = Artifact.server_construct(**dumped)
    assert reloaded.id == "round-1"
    assert reloaded.trustLevel == "gated_pass"
    assert reloaded.passedGates == ["ground", "commit"]
    assert isinstance(reloaded.producedBy, ProducedBy)
    assert reloaded.producedBy.capabilityId == "cap1"
    assert reloaded.payload == {"k": "v"}
    assert reloaded.stale is True
    assert reloaded.status == "stale"


def test_artifact_legacy_dict_coerces_and_defaults():
    """Legacy dicts (no server-owned fields, no status, missing keys) construct with defaults.
    producedBy/passedGates (server-owned) from ordinary legacy client dicts are rejected (anti-forgery);
    use server_construct / server_load when server-authored state is loaded.
    """
    old = {
        "id": "legacy-art-1",
        "kind": "risk",
        "content": "legacy",
        # no producedBy, no passedGates (server-owned), no trustLevel, no payload, no stale, no status -> defaults
    }
    art = Artifact(**old)
    assert art.trustLevel == "untrusted"
    assert art.passedGates == []
    assert art.producedBy is None
    assert art.stale is False
    assert art.status == "active"
    assert art.payload is None


def test_artifact_no_auto_trust_and_server_provenance_only():
    """Explicit: server-owned trust/provenance CANNOT be forged by direct construction or client-shaped dict input.
    Normal construction (Artifact(**) / model_validate) ALWAYS rejects:
      - elevated trustLevel (gated_pass/audited)
      - producedBy (server-owned provenance) even at untrusted
      - non-empty passedGates even at untrusted
    Only server_construct succeeds for server-owned values. V5SessionState normal also rejects via nested.
    This proves the anti-forgery directly in Python per review (no hiding behind Node); untrusted remains default-safe.
    """
    import pytest

    # default construction: safe untrusted, no provenance
    art = Artifact(id="no-forge-1", content="client input")
    assert art.trustLevel == "untrusted"
    assert art.passedGates == []
    assert art.producedBy is None

    # direct construct attempt to forge elevated (even with producedBy) MUST be rejected
    with pytest.raises(Exception) as exc1:
        Artifact(
            id="forge-direct-1",
            content="client try",
            trustLevel="gated_pass",
            passedGates=["ground"],
            producedBy=ProducedBy(capabilityRunId="x", capabilityId="y"),
        )
    assert "server-only" in str(exc1.value) or "forgery" in str(exc1.value).lower() or "producedBy" in str(exc1.value) or "passedGates" in str(exc1.value)

    # direct with audited + fields also rejected
    with pytest.raises(Exception) as exc2:
        Artifact(
            id="forge-direct-2",
            content="client try2",
            trustLevel="audited",
            passedGates=["commit"],
            producedBy=ProducedBy(capabilityRunId="x", capabilityId="y"),
        )
    assert "server-only" in str(exc2.value) or "forgery" in str(exc2.value).lower() or "producedBy" in str(exc2.value) or "passedGates" in str(exc2.value)

    # THE KEY FORGERY CASE per review: client-shaped dict providing producedBy + passedGates + elevated is rejected
    forge_dict = {
        "id": "forge-dict-full",
        "content": "from client",
        "trustLevel": "gated_pass",
        "passedGates": ["commit"],
        "producedBy": {"capabilityRunId": "x", "capabilityId": "y"},
    }
    with pytest.raises(Exception) as exc3:
        Artifact(**forge_dict)
    assert "server-only" in str(exc3.value) or "forgery" in str(exc3.value).lower() or "producedBy" in str(exc3.value) or "passedGates" in str(exc3.value)

    # also via model_validate
    with pytest.raises(Exception):
        Artifact.model_validate(forge_dict)

    # NEW: ordinary untrusted input MUST reject producedBy (even without elevating trustLevel)
    with pytest.raises(Exception) as exc_pb:
        Artifact(
            id="forge-untrusted-pb",
            content="client try pb",
            trustLevel="untrusted",
            producedBy=ProducedBy(capabilityRunId="x", capabilityId="y"),
        )
    assert "producedBy" in str(exc_pb.value) or "server-owned" in str(exc_pb.value).lower() or "forgery" in str(exc_pb.value).lower()

    forge_pb_dict = {"id": "forge-pb-dict", "content": "c", "producedBy": {"capabilityRunId": "r", "capabilityId": "c"}}
    with pytest.raises(Exception) as exc_pb2:
        Artifact(**forge_pb_dict)
    assert "producedBy" in str(exc_pb2.value) or "server-owned" in str(exc_pb2.value).lower()

    # NEW: ordinary untrusted input MUST reject non-empty passedGates
    with pytest.raises(Exception) as exc_pg:
        Artifact(
            id="forge-untrusted-pg",
            content="client try pg",
            trustLevel="untrusted",
            passedGates=["ground"],
        )
    assert "passedGates" in str(exc_pg.value) or "server-owned" in str(exc_pg.value).lower() or "forgery" in str(exc_pg.value).lower()

    forge_pg_dict = {"id": "forge-pg-dict", "content": "c", "passedGates": ["commit"]}
    with pytest.raises(Exception):
        Artifact(**forge_pg_dict)

    # server path succeeds (using server-only construct after gates)
    trusted = Artifact.server_construct(
        id="server-1",
        content="server evidence",
        trustLevel="gated_pass",
        passedGates=["ground", "commit"],
        producedBy=ProducedBy(capabilityRunId="srv-run", capabilityId="evidence.search", roleId="接地"),
    )
    assert trusted.trustLevel == "gated_pass"
    assert "ground" in trusted.passedGates
    assert isinstance(trusted.producedBy, ProducedBy)


def test_v5_session_state_server_load_allows_elevated_artifact_roundtrip_but_normal_rejects_forgery():
    """V5SessionState.server_load enables durable persisted state reload for artifacts with gated_pass/audited (context path).
    Normal V5SessionState(**persisted_with_elevated) or direct from client dict MUST still reject producedBy/passedGates/elevated (prevents forgery).
    This resolves the durable state ownership roundtrip while preserving anti-forgery at model boundary.
    """
    import pytest
    # simulate persisted dict with elevated (as would be dumped from prior server session state)
    persisted_with_elevated = {
        "sessionId": "sess-durable-1",
        "goal": {"text": "durable roundtrip", "status": "clear"},
        "artifacts": [{
            "id": "art-gated-1",
            "content": "gated evidence from server",
            "trustLevel": "gated_pass",
            "passedGates": ["ground", "commit"],
            "producedBy": {"capabilityRunId": "run-x", "capabilityId": "cap.ev", "roleId": "agent"},
        }],
        "capabilityRuns": [],
    }

    # normal construction from persisted dict (as client or naive V5SessionState(**) would do) MUST fail
    with pytest.raises(Exception) as exc_norm:
        V5SessionState(**persisted_with_elevated)
    msg = str(exc_norm.value)
    assert "server-only" in msg or "forgery" in msg.lower() or "gated_pass" in msg or "elevated" in msg.lower() or "producedBy" in msg or "passedGates" in msg

    # via model_validate without context also rejects
    with pytest.raises(Exception):
        V5SessionState.model_validate(persisted_with_elevated)

    # also: ordinary V5SessionState input with untrusted artifact carrying producedBy (client forge) is rejected
    client_forge_untr_pb = {
        "sessionId": "sess-client-fg",
        "goal": {"text": "client forge untr pb", "status": "clear"},
        "artifacts": [{
            "id": "art-client-pb",
            "content": "untr with pb",
            "trustLevel": "untrusted",
            "producedBy": {"capabilityRunId": "run-c", "capabilityId": "c.id"},
        }],
        "capabilityRuns": [],
    }
    with pytest.raises(Exception) as exc_v5_pb:
        V5SessionState(**client_forge_untr_pb)
    assert "producedBy" in str(exc_v5_pb.value) or "server-owned" in str(exc_v5_pb.value).lower() or "forgery" in str(exc_v5_pb.value).lower()

    # server_load (with context) succeeds for durable server reload of persisted state
    state = V5SessionState.server_load(persisted_with_elevated)
    assert state.sessionId == "sess-durable-1"
    assert len(state.artifacts) == 1
    assert state.artifacts[0].trustLevel == "gated_pass"
    assert state.artifacts[0].passedGates == ["ground", "commit"]
    assert isinstance(state.artifacts[0].producedBy, ProducedBy)

    # roundtrip via server_load
    re_dumped = state.model_dump()
    re_reloaded = V5SessionState.server_load(re_dumped)
    assert re_reloaded.artifacts[0].id == "art-gated-1"

    # untrusted artifacts still work with normal V5SessionState(**)
    untrusted_dict = {
        "sessionId": "sess-untr-1",
        "goal": {"text": "untrusted"},
        "artifacts": [{"id": "u1", "content": "u", "trustLevel": "untrusted"}],
        "capabilityRuns": [],
    }
    un_re = V5SessionState(**untrusted_dict)
    assert un_re.artifacts[0].trustLevel == "untrusted"


def test_artifact_trustlevel_not_optional_and_passedgates_default_list():
    """Schema hardens: trustLevel is non-optional with default; passedGates is always list."""
    art = Artifact(id="hard-1")
    assert isinstance(art.trustLevel, str)
    assert art.trustLevel == "untrusted"
    assert isinstance(art.passedGates, list)

    # reject bad trust via validation
    import pytest
    with pytest.raises(Exception):
        Artifact(id="bad-t", trustLevel="trusted")  # invalid literal


def test_server_construct_and_server_load_still_enforce_schema_validation():
    """Per review: server_construct / server_load bypass ONLY anti-forgery (producedBy/passedGates/elevated on raw);
    they MUST still reject invalid trustLevel, invalid status, malformed producedBy (missing req fields),
    and non-list passedGates. This proves Python owns the contract validity even for server paths.
    """
    import pytest
    # bad trustLevel literal must reject even via server_construct
    with pytest.raises(Exception) as e1:
        Artifact.server_construct(id="s-bad-tl", content="x", trustLevel="foo")
    # error from pydantic field validation
    assert "trustLevel" in str(e1.value) or "literal" in str(e1.value).lower() or "Input should be" in str(e1.value)

    # bad status literal
    with pytest.raises(Exception) as e2:
        Artifact.server_construct(id="s-bad-st", content="x", status="foo")
    assert "status" in str(e2.value) or "literal" in str(e2.value).lower()

    # producedBy dict missing required capabilityRunId / capabilityId -> submodel validation fails
    with pytest.raises(Exception) as e3:
        Artifact.server_construct(
            id="s-bad-pb",
            content="x",
            producedBy={"roleId": "only"},  # missing both required
            trustLevel="gated_pass",
            passedGates=["ground"],
        )
    pb_err = str(e3.value)
    assert "producedBy" in pb_err or "capabilityRunId" in pb_err or "capabilityId" in pb_err or "field required" in pb_err.lower() or "missing" in pb_err.lower()

    # producedBy with wrong type
    with pytest.raises(Exception) as e4:
        Artifact.server_construct(id="s-bad-pb2", content="x", producedBy="not-a-dict-or-model")
    assert "producedBy" in str(e4.value).lower() or "validation" in str(e4.value).lower()

    # passedGates not a list (must be list)
    with pytest.raises(Exception) as e5:
        Artifact.server_construct(id="s-bad-pg", content="x", passedGates="notlist", trustLevel="gated_pass")
    assert "passedGates" in str(e5.value) or "list" in str(e5.value).lower() or "Input should be a valid list" in str(e5.value)

    # non-empty passedGates with invalid item type? list[str] will accept, but shape bad is caught above; ok

    # For server_load on state: bad shape in nested artifact still fails (context only skips forgery reject)
    bad_state = {
        "sessionId": "s-load-bad",
        "goal": {"text": "x"},
        "artifacts": [{"id": "b1", "content": "b", "trustLevel": "gated_pass", "producedBy": {"capabilityRunId": "r"}, "passedGates": [] }],  # missing capabilityId
        "capabilityRuns": [],
    }
    with pytest.raises(Exception) as e6:
        V5SessionState.server_load(bad_state)
    assert "producedBy" in str(e6.value) or "capabilityId" in str(e6.value) or "field required" in str(e6.value).lower()

    # similarly for bad trust inside via server_load
    bad_tl_state = {
        "sessionId": "s-load-badtl",
        "goal": {"text": "x"},
        "artifacts": [{"id": "b2", "content": "b", "trustLevel": "invalid_tl"}],
        "capabilityRuns": [],
    }
    with pytest.raises(Exception) as e7:
        V5SessionState.server_load(bad_tl_state)
    assert "trustLevel" in str(e7.value) or "literal" in str(e7.value).lower()


# --- Focused CapabilityRun contract tests for sliderule-python-v52-capability-run-contract-105 ---
# Proves Python directly owns inputs/outputs/gateResults/result/timing/error (+ role/ledger for parity).
# Classification: PYTHON_AUTHORITY for this StateSchema slice.
# Tests are Python baseline; Node usage (if any) would be thin proxy/compat only.


def test_capability_run_declares_task_contract_fields():
    """Python CapabilityRun must expose the exact fields named in task goal: inputs, outputs, gateResults, result, timing, error."""
    run = CapabilityRun(
        id="run-105-1",
        capabilityId="evidence.search",
        turnId="t-105",
        inputs=["a1", "a2"],
        outputs=["art-1"],
        gateResults=[{"gateId": "ground", "status": "passed"}],
        result={"title": "ok", "content": "found"},
        timing={"startedAt": "2026-07-02T00:00:00Z", "completedAt": "2026-07-02T00:00:01Z", "durationMs": 1000},
        error=None,
    )
    assert run.id == "run-105-1"
    assert run.capabilityId == "evidence.search"
    assert run.turnId == "t-105"
    assert run.inputs == ["a1", "a2"]
    assert run.outputs == ["art-1"]
    assert isinstance(run.gateResults, list) and run.gateResults[0]["status"] == "passed"
    assert run.result is not None and run.result["title"] == "ok"
    assert run.timing is not None and run.timing["durationMs"] == 1000
    assert run.error is None
    assert run.roleId is None
    assert run.ledgerEntryId is None

    # schema exposure
    schema = run.model_json_schema()
    props = schema.get("properties", {})
    for field in ["inputs", "outputs", "gateResults", "result", "timing", "error"]:
        assert field in props, f"missing task contract field in Python CapabilityRun: {field}"


def test_capability_run_defaults_and_roundtrip():
    """Minimal construct defaults; full roundtrip preserves timing/result/error."""
    minimal = CapabilityRun(id="run-min", capabilityId="risk.analyze", turnId="t-min")
    assert minimal.inputs == []
    assert minimal.outputs == []
    assert minimal.gateResults == []
    assert minimal.result is None
    assert minimal.timing is None
    assert minimal.error is None
    assert minimal.roleId is None

    full = CapabilityRun(
        id="run-full",
        capabilityId="report.write",
        turnId="t-full",
        inputs=["i1"],
        outputs=["o1"],
        gateResults=[{"gateId": "commit", "status": "passed", "reason": "ok"}],
        result={"summary": "done"},
        timing={"startedAt": "2026-07-02T10:00:00Z", "durationMs": 250},
        error={"code": "none"},
        roleId="synthesizer",
        ledgerEntryId="ledger-99",
    )
    dumped = full.model_dump()
    reloaded = CapabilityRun(**dumped)
    assert reloaded.result == {"summary": "done"}
    assert reloaded.timing["durationMs"] == 250
    assert reloaded.error == {"code": "none"}
    assert reloaded.roleId == "synthesizer"
    assert "inputs" in CapabilityRun.model_fields
    assert "timing" in CapabilityRun.model_fields
    assert "error" in CapabilityRun.model_fields


def test_capability_run_legacy_dict_missing_keys_defaults():
    """Legacy dicts without timing/error/result still load with safe defaults (roundtrip compat)."""
    old = {
        "id": "run-legacy",
        "capabilityId": "dialogue.reply",
        "turnId": "t-old",
        "inputs": [],
        "outputs": ["old-art"],
        "gateResults": [],
    }
    run = CapabilityRun(**old)
    assert run.result is None
    assert run.timing is None
    assert run.error is None
    # also via state
    state = V5SessionState(
        sessionId="s-legacy-run",
        goal={"text": "x", "status": "clear"},
        capabilityRuns=[run],
    )
    assert len(state.capabilityRuns) == 1
    assert state.capabilityRuns[0].timing is None


def test_capability_run_with_error_and_timing_constructs():
    """Supports error payload and timing on failed/partial runs."""
    import pytest
    err_run = CapabilityRun(
        id="run-err",
        capabilityId="structure.decompose",
        turnId="t-err",
        inputs=["q1"],
        outputs=[],
        gateResults=[{"gateId": "schema", "status": "failed"}],
        result=None,
        timing={"startedAt": "2026-07-02T11:00:00Z", "completedAt": "2026-07-02T11:00:00.100Z"},
        error={"code": "schema_fail", "message": "invalid structure", "detail": {"issues": 2}},
    )
    assert err_run.error["code"] == "schema_fail"
    assert err_run.timing["startedAt"].startswith("2026")

    # required fields (id, capabilityId, turnId) are enforced
    import pytest
    with pytest.raises(Exception):
        CapabilityRun.model_validate({"capabilityId": "x"})  # missing id/turnId required fields


def test_capability_run_in_state_roundtrips_and_schema():
    """V5SessionState.capabilityRuns list holds full contract including timing/error."""
    state = V5SessionState(
        sessionId="s-caprun-1",
        goal={"text": "test", "status": "clear"},
        capabilityRuns=[
            CapabilityRun(
                id="r1", capabilityId="evidence.search", turnId="t1",
                result={"ok": True},
                timing={"durationMs": 42},
                error=None,
            ),
            CapabilityRun(
                id="r2", capabilityId="risk.analyze", turnId="t1",
                error={"code": "budget", "message": "exceeded"},
            ),
        ],
    )
    assert len(state.capabilityRuns) == 2
    assert state.capabilityRuns[0].result is not None
    assert state.capabilityRuns[1].error["code"] == "budget"

    schema = state.model_json_schema()
    props = schema.get("properties", {})
    cr_prop = props.get("capabilityRuns", {})
    assert "capabilityRuns" in props


# --- Golden durable V5.2 session state fixtures for sliderule-python-v52-state-ts-parity-golden-105 ---
# Task goal: create Python/TS state golden fixtures proving schema parity for durable V5.2 sessions.
# Classification: PYTHON_AUTHORITY. Python owns authoritative GOLDEN_DURABLE_V52_SESSION (mirrors TS export).
# TS golden fixture lives in shared/blueprint/v5-reasoning-state.ts; Vitest/TS contract test (server __tests__) reads the shared golden and validates V5SessionState shape.
# Direct focused pytest proves Python baseline: load, roundtrip, legacy, server_load, schema field presence for all durable V5.2 fields.
# Node/TS is thin contract consumer only.

GOLDEN_DURABLE_V52_SESSION = {
    "sessionId": "durable-golden-001",
    "goal": {"text": "Prove V5.2 durable state parity", "status": "clear"},
    "artifacts": [
        {"id": "art-g1", "kind": "evidence", "content": "fact from python", "trustLevel": "untrusted", "passedGates": []}
    ],
    "capabilityRuns": [
        {
            "id": "run-g1",
            "capabilityId": "evidence.search",
            "turnId": "t-g1",
            "inputs": ["g0"],
            "outputs": ["art-g1"],
            "gateResults": [{"gateId": "ground", "status": "passed"}],
            "result": {"ok": True},
            "timing": {"startedAt": "2026-07-02T00:00:00Z", "completedAt": "2026-07-02T00:00:01Z", "durationMs": 800},
            "error": None,
            "roleId": "researcher",
            "ledgerEntryId": "led-g1",
        }
    ],
    "coverageGaps": [],
    "coverageContract": None,
    "coverageGate": None,
    "graph": {"nodes": [], "edges": []},
    "staleArtifactIds": [],
    "supersededArtifactIds": ["art-old-round"],
    "conversation": [],
    "openQuestions": [{"id": "q-g", "text": "parity?"}],
    "evidence": [{"id": "e-g", "content": "gold"}],
    "decisions": [{"id": "d-g", "summary": "chose python"}],
    "risks": [],
    "gates": [{"gateId": "commit", "kind": "commit", "status": "passed"}],
    "dependencyGraph": [],
    "runtimePhase": "done",
    "awaitReason": None,
    "awaitDetail": None,
    "lastTurnId": "t-g1",
    "deliveryPhase": "shipped",
    "roleMode": "complex",
    "decisionLedger": [],
    "costLedger": [],
    "flowBoundaryLedger": [],
    "structureGateLedger": [],
    "sessionReplayLog": [{"id": "rep-g", "sessionId": "durable-golden-001", "at": "2026-07-02T00:00:01Z", "kind": "capability_run", "turnId": "t-g1"}],
    "reasoningEvents": [],
    "currentFocus": {"nodeId": "n1", "artifactId": "art-g1"},
    "userIntervention": {"intent": "challenge", "text": "why this?", "targetDecisionId": "d-g"},
    "brainstormDegraded": False,
    "escalated": False,
    "projectionDirtyNodeIds": [],
}


def test_durable_v52_session_golden_fixture_declares_and_loads():
    """Golden fixture for durable V5.2 session must load directly in Python model (core of task goal)."""
    state = V5SessionState(**GOLDEN_DURABLE_V52_SESSION)
    assert state.sessionId == "durable-golden-001"
    assert state.goal["status"] == "clear"
    assert len(state.capabilityRuns) == 1
    assert state.capabilityRuns[0].timing is not None
    assert state.supersededArtifactIds == ["art-old-round"]
    assert state.lastTurnId == "t-g1"
    assert state.roleMode == "complex"
    assert state.currentFocus is not None and state.currentFocus["artifactId"] == "art-g1"
    assert isinstance(state.userIntervention, UserIntervention)
    assert state.userIntervention.intent == "challenge"
    assert state.brainstormDegraded is False
    assert state.escalated is False
    assert state.projectionDirtyNodeIds == []


def test_durable_v52_session_golden_roundtrip_preserves_schema():
    """Golden durable session roundtrips losslessly via model_dump + reconstruct; proves durable persistence parity."""
    orig = V5SessionState(**GOLDEN_DURABLE_V52_SESSION)
    dumped = orig.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.sessionId == orig.sessionId
    assert reloaded.capabilityRuns[0].result == {"ok": True}
    assert reloaded.userIntervention is not None and reloaded.userIntervention.text == "why this?"
    assert reloaded.currentFocus["nodeId"] == "n1"
    assert reloaded.reasoningEvents == []
    # schema has all durable fields
    schema = reloaded.model_json_schema()
    props = schema.get("properties", {})
    for f in ["sessionId", "userIntervention", "currentFocus", "brainstormDegraded", "escalated", "projectionDirtyNodeIds", "sessionReplayLog", "supersededArtifactIds"]:
        assert f in props, f"missing durable V5.2 field in Python schema: {f}"


def test_durable_v52_session_golden_legacy_missing_keys_defaults():
    """Legacy durable state missing new keys (currentFocus etc) still loads with defaults; proves compat for persisted V5.2 sessions."""
    legacy = {
        "sessionId": "legacy-durable",
        "goal": {"text": "old", "status": "clear"},
        "artifacts": [],
        "capabilityRuns": [],
        # intentionally no currentFocus, no userIntervention, no booleans, no projectionDirty, no some ledgers etc.
    }
    state = V5SessionState(**legacy)
    assert state.currentFocus is None
    assert state.userIntervention is None
    assert state.brainstormDegraded is False
    assert state.escalated is False
    assert state.projectionDirtyNodeIds == []
    assert state.sessionReplayLog == []
    assert state.supersededArtifactIds == []


def test_durable_v52_session_server_load_golden_with_elevated_and_new_fields():
    """server_load supports durable golden with server-owned artifacts + new durable fields; normal path rejects forgery."""
    import pytest
    persisted = dict(GOLDEN_DURABLE_V52_SESSION)
    persisted["artifacts"] = [{
        "id": "art-gated-g",
        "content": "durable gated",
        "trustLevel": "gated_pass",
        "passedGates": ["ground"],
        "producedBy": {"capabilityRunId": "run-g1", "capabilityId": "evidence.search"},
    }]
    # normal would reject because of elevated producedBy etc
    with pytest.raises(Exception):
        V5SessionState(**persisted)
    # server_load succeeds
    state = V5SessionState.server_load(persisted)
    assert state.sessionId == "durable-golden-001"
    assert state.artifacts[0].trustLevel == "gated_pass"
    assert state.currentFocus is not None


def test_durable_v52_session_schema_parity_with_ts_blueprint():
    """Explicit parity assertion: Python V5SessionState declares the durable fields present in TS V5SessionState interface.
    GOLDEN_DURABLE_V52_SESSION (mirrors TS golden in shared/blueprint) exercises the full set.
    Vitest test on TS side consumes the same golden shape to prove blueprint contract acceptance.
    This completes the Python/TS state golden fixtures requirement.
    """
    schema = V5SessionState.model_json_schema()
    props = schema.get("properties", {})
    # core durable from TS (this task's golden coverage)
    ts_durable_fields = [
        "sessionId", "goal", "artifacts", "conversation", "openQuestions", "evidence", "decisions", "risks",
        "capabilityRuns", "gates", "dependencyGraph", "staleArtifactIds", "supersededArtifactIds",
        "runtimePhase", "deliveryPhase", "roleMode", "lastTurnId", "awaitReason", "awaitDetail",
        "decisionLedger", "coverageContract", "coverageGate", "flowBoundaryLedger", "structureGateLedger",
        "costLedger", "coverageGaps", "sessionReplayLog", "reasoningEvents",
        # additional durable added for full parity
        "currentFocus", "userIntervention", "brainstormDegraded", "escalated", "projectionDirtyNodeIds",
    ]
    for f in ts_durable_fields:
        assert f in props, f"Python V5SessionState missing durable TS field for golden parity: {f}"
    # also UserIntervention model present
    assert "UserIntervention" in str(schema) or any("UserIntervention" in str(v) for v in props.values())


def test_await_reason_includes_control_ask_and_control_scope():
    """M1 停泊必须是展开后的 control_ask / control_scope，禁止复用 ready/user_input/confirm。"""
    from pathlib import Path

    py_src = Path(__file__).resolve().parents[1] / "models" / "v5_state.py"
    ts_src = Path(__file__).resolve().parents[2] / "shared" / "blueprint" / "v5-reasoning-state.ts"
    py_text = py_src.read_text(encoding="utf-8")
    ts_text = ts_src.read_text(encoding="utf-8")
    for token in ('"control_ask"', '"control_scope"'):
        assert token in py_text
        assert token in ts_text
    parked = V5SessionState(
        sessionId="ctl-await-1",
        goal={"text": "x", "status": "needs_refinement"},
        awaitReason="control_ask",
    )
    assert parked.awaitReason == "control_ask"
    parked2 = V5SessionState(
        sessionId="ctl-await-2",
        goal={"text": "x", "status": "needs_refinement"},
        awaitReason="control_scope",
    )
    assert parked2.awaitReason == "control_scope"
    import pytest

    with pytest.raises(Exception):
        V5SessionState(
            sessionId="ctl-await-bad",
            goal={"text": "x", "status": "needs_refinement"},
            awaitReason="control_wait",
        )


def test_control_transcript_defaults_empty_and_legacy_missing_reads_as_empty():
    """controlTranscript 是 schema 字段；老会话缺字段读成 []。"""
    fresh = V5SessionState(
        sessionId="ctl-tr-1",
        goal={"text": "x", "status": "needs_refinement"},
    )
    assert fresh.controlTranscript == []
    schema = V5SessionState.model_json_schema()
    assert "controlTranscript" in schema.get("properties", {})
    legacy = V5SessionState(
        **{
            "sessionId": "ctl-tr-legacy",
            "goal": {"text": "old", "status": "clear"},
            "artifacts": [],
        }
    )
    assert legacy.controlTranscript == []
    dumped = legacy.model_dump()
    reloaded = V5SessionState(**dumped)
    assert reloaded.controlTranscript == []


if __name__ == "__main__":
    # allow direct run
    test_v5_session_state_declares_ts_core_fields()
    test_v5_session_state_core_fields_default_empty_and_roundtrip()
    test_artifact_defaults_untrusted_no_auto_trust()
    test_v5_state_construct_from_partial_fixtures_still_works()
    test_v5_session_state_runtime_phase_fields()
    test_v5_session_state_runtime_fields_default_none_and_roundtrip()
    test_v5_runtime_fields_validation_enums()
    test_v5_session_state_ledger_fields_declare_and_construct()
    test_v5_session_state_ledger_fields_default_empty_and_roundtrip()
    test_v5_ledger_models_validation_shapes_and_literals()
    test_v5_session_state_replay_events_declare_and_construct()
    test_v5_session_state_replay_events_default_empty_and_roundtrip()
    test_v5_replay_reasoning_models_validation()
    test_v5_session_state_stale_superseded_declare_and_construct()
    test_v5_session_state_stale_superseded_defaults_roundtrip_legacy_separation()
    # artifact contract 105
    test_artifact_producedby_structured_and_required_semantics()
    test_artifact_payload_preserved_and_does_not_affect_trust()
    test_artifact_stale_and_status_semantics()
    test_artifact_roundtrip_producedby_payload_status_stale()
    test_artifact_legacy_dict_coerces_and_defaults()
    test_artifact_no_auto_trust_and_server_provenance_only()
    test_artifact_trustlevel_not_optional_and_passedgates_default_list()
    test_v5_session_state_server_load_allows_elevated_artifact_roundtrip_but_normal_rejects_forgery()
    test_server_construct_and_server_load_still_enforce_schema_validation()
    # golden durable V5.2 session fixtures (seq 8)
    test_durable_v52_session_golden_fixture_declares_and_loads()
    test_durable_v52_session_golden_roundtrip_preserves_schema()
    test_durable_v52_session_golden_legacy_missing_keys_defaults()
    test_durable_v52_session_server_load_golden_with_elevated_and_new_fields()
    test_durable_v52_session_schema_parity_with_ts_blueprint()
    print("All parity checks passed.")
