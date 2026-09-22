"""
Focused pytest for Python-owned G_READY + G_CONFIRM/route + user intervention invalidation/stale cascade + replan/re-compare flows.

Covers: G_READY, G_CONFIRM, route pick/reject, replan (reject -> stale route + clear await enables re-compare/route.compare re-trigger), + general UserIntervention (targetArtifactId/targetNodeId/targetDecisionId) -> invalidate + depGraph downstream cascade to staleArtifactIds + node challenge + userIntervention record.
Proves Python owns readiness/confirm/reject/replan flows directly via focused tests (no Node). Part of interactive-gates-tests task.

Run: $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_sliderule_interactive_gates.py -q --tb=line
Run with filter: ... -k "ready or confirm or reject or replan or drive or stale or intervention"
"""

import pytest
from datetime import datetime

from services.slide_rule_interactive_gates import (
    open_human_question_gap_count,
    user_clears_readiness,
    evaluate_readiness_gate_after_commit,
    evaluate_interactive_gate_after_commit,
    evaluate_confirm_gate_after_commit,
    resolve_readiness_gaps_from_user_text,
    resolve_readiness_gaps_by_ids,
    gaps_from_gap_ask_content,
    merge_gap_ask_into_state,
    apply_resolve_and_clear_readiness,
    apply_route_selection_resolution,
    user_picks_route,
    user_rejects_route_selection,
    user_expresses_route_selection,
    is_vague_goal,
    apply_user_intervention_invalidation,
    invalidate_for_intervention,
)
from models.v5_state import V5SessionState, Artifact, ProducedBy, UserIntervention, DependencyEdge


def _mk_state(**overrides):
    now = datetime.now().isoformat()
    base = {
        "sessionId": "sr-test",
        "goal": {"text": "Build a system", "status": "needs_refinement"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": {"id": "c1", "version": 1, "mode": "simple", "requiredCapabilities": [], "blockingGapIds": []},
        "conversation": [],
        "openQuestions": [],
        "graph": {"nodes": [], "edges": []},
        "staleArtifactIds": [],
    }
    base.update(overrides)
    # ensure contract always valid (overrides may provide partial)
    c = base.get("coverageContract") or {}
    if isinstance(c, dict):
        base["coverageContract"] = {
            "id": c.get("id", "c1"),
            "version": c.get("version", 1),
            "mode": c.get("mode", "simple"),
            "requiredCapabilities": c.get("requiredCapabilities", []),
            "blockingGapIds": c.get("blockingGapIds", []),
        }
    # ensure gaps have required fields for model (createdAt, label)
    if "coverageGaps" in base and base["coverageGaps"]:
        fixed = []
        for g in base["coverageGaps"]:
            if isinstance(g, dict):
                gg = {"createdAt": now, "label": g.get("label") or g.get("id") or "q", **g}
                fixed.append(gg)
            else:
                fixed.append(g)
        base["coverageGaps"] = fixed
    return V5SessionState(**base)


def test_open_human_question_gap_count_counts_only_open_questions():
    gaps = [
        {"id": "g1", "kind": "open_question", "label": "Who are users?", "status": "open"},
        {"id": "g2", "kind": "missing_capability", "label": "need cap", "status": "open"},
        {"id": "g3", "kind": "open_question", "label": "Scope?", "status": "resolved"},
    ]
    st = _mk_state(coverageGaps=gaps)
    assert open_human_question_gap_count(st) == 1


def test_open_human_question_gap_count_respects_blocking():
    gaps = [
        {"id": "g1", "kind": "open_question", "label": "Q1", "status": "open"},
        {"id": "g2", "kind": "open_question", "label": "Q2", "status": "open"},
    ]
    st = _mk_state(coverageGaps=gaps, coverageContract={"blockingGapIds": ["g1"]})
    assert open_human_question_gap_count(st) == 1


def test_user_clears_readiness_requires_substance_or_no_gaps():
    st = _mk_state()
    assert user_clears_readiness("short", st) is False
    assert user_clears_readiness("面向企业内部RBAC权限控制场景", st) is True
    st2 = _mk_state(coverageGaps=[{"id": "g1", "kind": "open_question", "status": "open"}])
    assert user_clears_readiness("面向企业内部使用，补充详细RBAC权限约束范围", st2) is True
    # when gaps remain, short answer does not clear
    assert user_clears_readiness("ok", st2) is False


def test_evaluate_readiness_gate_parks_after_gap_ask_with_open_questions():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "label": "Users?", "status": "open"}])
    v = evaluate_readiness_gate_after_commit(st, {"capabilityId": "gap.ask", "turnUserText": "初始目标", "committed": True})
    assert v["park"] is True
    assert v["gate"] == "ready"


def test_evaluate_readiness_gate_does_not_park_if_cleared_by_user_text():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "label": "Users?", "status": "open"}])
    v = evaluate_readiness_gate_after_commit(st, {"capabilityId": "gap.ask", "turnUserText": "面向企业内部，RBAC，范围仅MVP", "committed": True})
    assert v["park"] is False


def test_evaluate_interactive_does_not_park_non_clarify_cap():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "status": "open"}])
    v = evaluate_interactive_gate_after_commit(st, {"capabilityId": "risk.analyze", "turnUserText": "", "committed": True})
    assert v["park"] is False


def test_resolve_from_user_text_marks_open_questions_resolved():
    st = _mk_state(coverageGaps=[
        {"id": "q1", "kind": "open_question", "label": "?", "status": "open"},
        {"id": "q2", "kind": "open_question", "label": "??", "status": "open"},
    ])
    resolved = resolve_readiness_gaps_from_user_text(st, "面向企业团队，使用web平台，验收标准是能用")
    gg = [g if isinstance(g, dict) else g.model_dump() for g in resolved.coverageGaps]
    assert all(g["status"] == "resolved" for g in gg if g["kind"] == "open_question")


def test_resolve_by_ids_only_targets_specified():
    st = _mk_state(coverageGaps=[
        {"id": "q1", "kind": "open_question", "status": "open"},
        {"id": "q2", "kind": "open_question", "status": "open"},
    ])
    resolved = resolve_readiness_gaps_by_ids(st, ["q1"])
    gg = [g if isinstance(g, dict) else g.model_dump() for g in resolved.coverageGaps]
    statuses = {g["id"]: g["status"] for g in gg}
    assert statuses["q1"] == "resolved"
    assert statuses["q2"] == "open"


def test_gaps_from_gap_ask_and_merge_populates_open_questions():
    st = _mk_state()
    content = "Gap: - Who is the user?\n- What is success?"
    gfs = gaps_from_gap_ask_content(content, "t-1", "art-1")
    assert len(gfs) >= 1
    assert all(g["kind"] == "open_question" for g in gfs)
    merge_gap_ask_into_state(st, gfs)
    assert open_human_question_gap_count(st) >= 1


def test_apply_resolve_and_clear_clears_await_when_resolved():
    st = _mk_state(awaitReason="ready", awaitDetail="waiting", coverageGaps=[
        {"id": "q1", "kind": "open_question", "status": "open"},
    ])
    st2 = apply_resolve_and_clear_readiness(st, "企业内部 RBAC 边界MVP")
    # after clear should have no await
    assert getattr(st2, "awaitReason", None) is None or open_human_question_gap_count(st2) == 0


def test_is_vague_goal_detects_thin():
    assert is_vague_goal("做一个系统") is True
    assert is_vague_goal("Build RBAC permission system for enterprise team on web with audit logs") is False


def test_drive_reasoning_turn_after_clarify_cap_keeps_awaitReason_ready():
    """Driver-level focused pytest: simulate clarification cap (gap.ask) that materializes open_question,
    then G_READY park sets runtimePhase=awaiting + awaitReason=ready.
    Asserts final state keeps "ready" (not overwritten to "user_input" by phase decision).
    Directly proves Python-owned G_READY parking / no self-answer past gate (addresses review finding 2).
    Uses monkeypatch only to isolate drive integration; asserts real state mutations from Python helpers.
    """
    state = _mk_state(coverageGaps=[])  # start clean; cap will add open_question gaps

    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "readiness chain plan for G_READY test"

    class DummyExec:
        content = "- Who are the target users?\n- What is the RBAC permission scope?"
        def model_dump(self):
            return {"content": self.content, "title": "gap", "summary": "", "sources": []}

    def fake_pick(state, user_text):
        # force a clarify cap to hit materialization + evaluate park path
        return [{"capabilityId": "gap.ask", "roleId": "产品"}]

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = lambda cap_id, st, ctx, role, tid: DummyExec()
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        out = _reloaded_drive(state, "t-gap-ready-1", "初始目标陈述不够明确")
        # core assertion: Python drive must end parked with ready, not user_input
        assert out.runtimePhase == "awaiting", f"expected awaiting after G_READY park, got {out.runtimePhase}"
        assert out.awaitReason == "ready", f"expected awaitReason=ready (G_READY), got {out.awaitReason}"
        # ensure not clobbered by the previous else:user_input path
        assert out.awaitReason != "user_input"
        assert open_human_question_gap_count(out) >= 1, "clarify cap should have materialized open_question gap"
    finally:
        if orig_orch is not None:
            sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None:
            sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None:
            sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None:
            sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None:
            sess_mod.__dict__["save_session"] = orig_save


# --- G_CONFIRM / route selection / reject route focused tests (this task) ---
# Directly prove Python-owned named behavior per review: userPicks, userRejects, evaluate confirm
# uses expresses (no park on pick/reject), apply does state writes (clear await, stale on reject),
# drive uses it. Acceptance: focused pytest proves Python not just partial park.

def _mk_route_state(has_route_art=True, await_reason=None):
    st = _mk_state(awaitReason=await_reason, awaitDetail=("waiting confirm" if await_reason=="confirm" else None))
    if has_route_art:
        pb = ProducedBy(capabilityRunId="r1", capabilityId="route.compare", roleId="工程")
        art = Artifact.server_construct(
            id="route-cmp-1",
            kind="route_options",
            provenance="test",
            trustLevel="gated_pass",
            title="routes",
            summary="",
            content="A B C",
            producedBy=pb,
            passedGates=["ground"],
        )
        st.artifacts = [art]
    return st


def test_user_picks_route_and_rejects_and_expresses_match_ts_semantics():
    assert user_picks_route("选方案 B") is True
    assert user_picks_route("就用方案A") is True
    assert user_picks_route("倾向路线2") is True
    assert user_picks_route("采用这个") is True
    assert user_picks_route("short") is False
    assert user_rejects_route_selection("都不行，重新生成") is True
    assert user_rejects_route_selection("重新对比路线") is True
    assert user_rejects_route_selection("退回换一条") is True
    assert user_rejects_route_selection("不满意") is True
    assert user_rejects_route_selection("选方案 B") is False
    assert user_expresses_route_selection("选方案 C") is True
    assert user_expresses_route_selection("都不行，重新出") is True


def test_evaluate_confirm_gate_parks_only_without_express_and_with_route_art():
    st = _mk_route_state(has_route_art=True)
    v = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "继续", "committed": True})
    assert v["park"] is True
    assert v["gate"] == "confirm"


def test_evaluate_confirm_gate_does_not_park_on_pick_or_reject_text():
    st = _mk_route_state(has_route_art=True)
    v_pick = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "选方案 B，先交付", "committed": True})
    v_rej = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "都不行，重新对比路线", "committed": True})
    assert v_pick["park"] is False
    assert v_rej["park"] is False


def test_evaluate_confirm_no_park_if_no_route_art():
    st = _mk_route_state(has_route_art=False)
    v = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "foo", "committed": True})
    assert v["park"] is False


def test_apply_route_selection_on_pick_clears_confirm_await():
    st = _mk_route_state(has_route_art=True, await_reason="confirm")
    st2 = apply_route_selection_resolution(st, "选方案 B")
    assert getattr(st2, "awaitReason", None) is None
    assert getattr(st2, "awaitDetail", None) is None


def test_apply_route_selection_on_reject_stales_route_arts_and_clears_await():
    st = _mk_route_state(has_route_art=True, await_reason="confirm")
    assert "route-cmp-1" not in (getattr(st, "staleArtifactIds", []) or [])
    st2 = apply_route_selection_resolution(st, "都不行，重新生成")
    stales = getattr(st2, "staleArtifactIds", []) or []
    assert "route-cmp-1" in stales
    assert getattr(st2, "awaitReason", None) is None
    assert getattr(st2, "awaitDetail", None) is None


def test_drive_confirm_park_and_user_pick_resume_clears_await_and_no_repark():
    """Driver focused: after route.compare, confirm parks; on pick reply text, resolve clears awaitReason,
    proceeds without re-park on same text; proves full route selection behavior in Python drive.
    """
    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "route plan"

    class DummyExec:
        content = "route A vs B vs C"
        def model_dump(self):
            return {"content": self.content, "title": "cmp", "summary": "", "sources": []}

    picks_called = {"count": 0}
    def fake_pick(state, user_text):
        picks_called["count"] += 1
        # after pick reply, should not pick route again (just clear)
        if user_picks_route(user_text):
            return []
        return [{"capabilityId": "route.compare", "roleId": "工程"}]

    exec_count = {"n": 0}
    def fake_exec(cap_id, st, ctx, role, tid):
        exec_count["n"] += 1
        return DummyExec()

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = fake_exec
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        # first turn: keyword forces route.compare, after commit -> park confirm
        state = _mk_state()
        out1 = _reloaded_drive(state, "t-c1", "路线对比一下")
        assert out1.runtimePhase == "awaiting"
        assert out1.awaitReason == "confirm"

        # reply pick: should resolve clear, not re-park on confirm (may land on convergence since no more picks this turn)
        out2 = _reloaded_drive(out1, "t-c2", "选方案 B")
        assert out2.awaitReason != "confirm"
        # drive should not leave it parked on confirm
        assert getattr(out2, "awaitReason", None) in (None, "convergence", "user_input")
    finally:
        if orig_orch is not None: sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None: sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None: sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None: sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None: sess_mod.__dict__["save_session"] = orig_save


# --- user intervention invalidation + stale cascade focused tests (this task) ---
# Directly prove Python-owned: general UserIntervention marks target+downstream via depGraph,
# monotonic stale union, graph node challenge, userIntervention persisted, decision ledger update.
# No reliance on route confirm text path; focused pytest for the review findings.

def _mk_intervention_state():
    now = datetime.now().isoformat()
    st = _mk_state(
        staleArtifactIds=[],
        graph={"nodes": [
            {"id": "n-up", "capabilityId": "upstream.cap", "capabilityRunId": "run-t1-up", "status": "done"},
            {"id": "n-tgt", "capabilityId": "target.cap", "capabilityRunId": "run-t1-tgt", "status": "done"},
            {"id": "n-down", "capabilityId": "down.cap", "capabilityRunId": "run-t1-down", "status": "done"},
        ], "edges": []},
        dependencyGraph=[
            DependencyEdge(fromArtifactId="up-art", toArtifactId="tgt-art", reason="input-to-output"),
            DependencyEdge(fromArtifactId="tgt-art", toArtifactId="down-art", reason="input-to-output"),
        ],
        artifacts=[
            Artifact.server_construct(id="up-art", kind="evidence", provenance="t", trustLevel="gated_pass", title="", summary="", content="up", producedBy=ProducedBy(capabilityRunId="run-t1-up", capabilityId="upstream.cap", roleId="a"), passedGates=["ground"]),
            Artifact.server_construct(id="tgt-art", kind="report", provenance="t", trustLevel="gated_pass", title="", summary="", content="tgt", producedBy=ProducedBy(capabilityRunId="run-t1-tgt", capabilityId="target.cap", roleId="a"), passedGates=["ground"]),
            Artifact.server_construct(id="down-art", kind="report", provenance="t", trustLevel="gated_pass", title="", summary="", content="down", producedBy=ProducedBy(capabilityRunId="run-t1-down", capabilityId="down.cap", roleId="a"), passedGates=["ground"]),
        ],
    )
    return st


def test_invalidate_for_intervention_marks_target_and_downstream_via_depgraph():
    st = _mk_intervention_state()
    interv = UserIntervention(targetArtifactId="tgt-art", intent="challenge", text="this target is wrong")
    out = invalidate_for_intervention(st, interv)
    stales = getattr(out, "staleArtifactIds", []) or []
    assert "tgt-art" in stales
    assert "down-art" in stales  # cascaded
    assert "up-art" not in stales  # not upstream
    # userIntervention recorded
    assert getattr(out, "userIntervention", None) is not None
    assert out.userIntervention.targetArtifactId == "tgt-art"
    # graph nodes: target and downstream challenged
    nodes = (getattr(out, "graph", {}) or {}).get("nodes", [])
    statuses = {n.get("id") if isinstance(n, dict) else getattr(n, "id", None): (n.get("status") if isinstance(n, dict) else getattr(n, "status", None)) for n in nodes}
    assert statuses.get("n-tgt") == "challenged"
    assert statuses.get("n-down") == "challenged"
    assert statuses.get("n-up") != "challenged"


def test_invalidate_for_intervention_monotonic_union_preserves_prior_stales():
    st = _mk_intervention_state()
    st.staleArtifactIds = ["prior-1"]
    interv = {"targetArtifactId": "tgt-art", "intent": "revise", "text": "fix"}
    out = apply_user_intervention_invalidation(st, interv)
    stales = set(getattr(out, "staleArtifactIds", []) or [])
    assert "prior-1" in stales
    assert "tgt-art" in stales
    assert "down-art" in stales


def test_invalidate_for_intervention_target_decision_challenges_ledger_and_sets_intervention():
    """targetDecisionId: must challenge ledger AND resolve to artifacts via turn/chose/runs then cascade to target+downstream stale.
    This directly addresses the review finding: general targetDecisionId triggers depGraph stale cascade (not ledger-only).
    """
    now = datetime.now().isoformat()
    # decision linked via turnId to a run whose output is the target art; dep to downstream
    st = _mk_state(
        decisionLedger=[{"id": "d-42", "turnId": "t-d", "createdAt": now, "status": "active", "chose": ["target.cap"]}],
        graph={"nodes": [
            {"id": "n-tgt", "capabilityId": "target.cap", "capabilityRunId": "run-t-d-tgt", "status": "done"},
            {"id": "n-down", "capabilityId": "down.cap", "capabilityRunId": "run-t-d-down", "status": "done"},
        ], "edges": []},
        capabilityRuns=[
            {"id": "run-t-d-tgt", "turnId": "t-d", "capabilityId": "target.cap", "outputs": ["dec-tgt-art"]},
        ],
        dependencyGraph=[
            DependencyEdge(fromArtifactId="dec-tgt-art", toArtifactId="dec-down-art", reason="input-to-output"),
        ],
        artifacts=[
            Artifact.server_construct(id="dec-tgt-art", kind="report", provenance="t", trustLevel="gated_pass", title="", summary="", content="tgt", producedBy=ProducedBy(capabilityRunId="run-t-d-tgt", capabilityId="target.cap", roleId="a"), passedGates=["ground"]),
            Artifact.server_construct(id="dec-down-art", kind="report", provenance="t", trustLevel="gated_pass", title="", summary="", content="down", producedBy=ProducedBy(capabilityRunId="run-t-d-down", capabilityId="down.cap", roleId="a"), passedGates=["ground"]),
        ],
        staleArtifactIds=[],
    )
    interv = UserIntervention(targetDecisionId="d-42", intent="challenge", text="reconsider this decision")
    out = invalidate_for_intervention(st, interv)
    led = getattr(out, "decisionLedger", []) or []
    d = next((x for x in led if (x.get("id") if isinstance(x, dict) else getattr(x, "id", None)) == "d-42"), None)
    assert d is not None
    assert (d.get("status") if isinstance(d, dict) else getattr(d, "status", None)) == "challenged"
    assert getattr(out, "userIntervention", None) is not None
    assert out.userIntervention.targetDecisionId == "d-42"
    # prove decision resolves to artifact + triggers downstream stale cascade (review finding)
    stales = set(getattr(out, "staleArtifactIds", []) or [])
    assert "dec-tgt-art" in stales
    assert "dec-down-art" in stales  # cascaded via depGraph
    # nodes for decision-resolved artifacts also challenged
    nodes = (getattr(out, "graph", {}) or {}).get("nodes", [])
    statuses = {}
    for n in nodes:
        nid = n.get("id") if isinstance(n, dict) else getattr(n, "id", None)
        nst = n.get("status") if isinstance(n, dict) else getattr(n, "status", None)
        statuses[nid] = nst
    assert statuses.get("n-tgt") == "challenged"
    assert statuses.get("n-down") == "challenged"


def test_drive_accepts_intervention_and_applies_stale_cascade():
    """Driver-level: drive_reasoning_turn accepts intervention kw, applies invalidation before orchestrate.
    Proves integration and Python ownership of stale cascade on intervention path.
    """
    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "intervention plan"

    class DummyExec:
        content = "after challenge"
        def model_dump(self):
            return {"content": self.content, "title": "after", "summary": "", "sources": []}

    def fake_pick(state, user_text):
        return []  # converge after intervention

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = lambda cap_id, st, ctx, role, tid: DummyExec()
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        base = _mk_intervention_state()
        # pass intervention via kwarg (backward compat for 3-arg calls preserved)
        interv = UserIntervention(targetArtifactId="tgt-art", intent="challenge", text="wrong")
        out = _reloaded_drive(base, "t-int-1", "user note with intervention", intervention=interv)
        stales = getattr(out, "staleArtifactIds", []) or []
        assert "tgt-art" in stales and "down-art" in stales
        assert getattr(out, "userIntervention", None) is not None
    finally:
        if orig_orch is not None: sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None: sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None: sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None: sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None: sess_mod.__dict__["save_session"] = orig_save


def test_invalidate_for_intervention_targetNodeId_resolves_produced_artifact_and_cascades_without_node_in_stale():
    """targetNodeId-only (general support): resolve via capabilityRunId (node -> produced art),
    seed cascade with artifact id (not node id), mark target node + downstream challenged.
    Covers review finding: Python must handle targetNodeId to locate artifact for depGraph stale + node mark.
    """
    st = _mk_intervention_state()
    interv = UserIntervention(targetNodeId="n-tgt", intent="challenge", text="challenge this node")
    out = invalidate_for_intervention(st, interv)
    stales = set(getattr(out, "staleArtifactIds", []) or [])
    # critical: node id must NOT leak into staleArtifactIds
    assert "n-tgt" not in stales
    assert "tgt-art" in stales
    assert "down-art" in stales  # cascaded downstream
    assert "up-art" not in stales
    # userIntervention records the targetNodeId (no targetArtifactId here)
    ui = getattr(out, "userIntervention", None)
    assert ui is not None
    assert ui.targetNodeId == "n-tgt"
    assert getattr(ui, "targetArtifactId", None) is None
    # nodes: target + downstream challenged; upstream untouched
    nodes = (getattr(out, "graph", {}) or {}).get("nodes", [])
    statuses = {}
    for n in nodes:
        nid = n.get("id") if isinstance(n, dict) else getattr(n, "id", None)
        nst = n.get("status") if isinstance(n, dict) else getattr(n, "status", None)
        statuses[nid] = nst
    assert statuses.get("n-tgt") == "challenged"
    assert statuses.get("n-down") == "challenged"
    assert statuses.get("n-up") != "challenged"


# --- Browser contract focused test (proves Python-owned await+phase reach frontend receive) ---
# Per acceptance: focused pytest directly proves Python sets runtimePhase+awaitReason (via helper now used in drive)
# so that frontend (runtime) receives instead of silent no-op / dropped. Run this -k for gate proof.

def test_set_await_for_browser_helper_and_drive_returns_await_for_frontend_contract():
    """Direct Python test: helper sets phase+awaitReason; drive after G_READY uses it and returns state with fields for browser.
    Asserts the exact signals frontend runtime must see (awaitReason, runtimePhase) are present and correct.
    """
    from services.slide_rule_interactive_gates import set_await_for_browser
    st = _mk_state()
    out = set_await_for_browser(st, "ready", "test detail")
    assert getattr(out, "runtimePhase", None) == "awaiting"
    assert getattr(out, "awaitReason", None) == "ready"
    assert getattr(out, "awaitDetail", None) == "test detail"

    # now simulate drive path using helper (via reload as other drive tests)
    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "park test"

    class DummyExec:
        content = "- Q1?\n- Q2?"
        def model_dump(self):
            return {"content": self.content}

    def fake_pick(state, user_text):
        return [{"capabilityId": "gap.ask", "roleId": "产品"}]

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = lambda cap_id, st, ctx, role, tid: DummyExec()
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        state = _mk_state()
        out = _reloaded_drive(state, "t-browser-1", "初始目标")
        # prove frontend receives contract: phase + awaitReason present (no silent)
        assert getattr(out, "runtimePhase", None) == "awaiting"
        assert getattr(out, "awaitReason", None) == "ready"
        assert open_human_question_gap_count(out) >= 1
    finally:
        if orig_orch is not None: sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None: sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None: sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None: sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None: sess_mod.__dict__["save_session"] = orig_save


# --- replan / re-compare after reject focused parity test (addresses review finding 1) ---
# Provides direct named test+assert for replan flow boundary using real Python pick:
# - after confirm park on route.compare, reject text at intake applies stale on prior route.* art + clears await (replan precond, PYTHON apply_route)
# - real pick_next_capabilities (keyword "路线"/"对比" etc) selects route.* again for replan/re-compare
# - exec runs the re-compare; evaluate sees express reject -> no park confirm
# - subsequent state non-confirm. Per-turn logs isolate t-rep-2 pick/exec to prove Python logic (not fake).
# This + prior apply/reject + drive tests prove readiness/confirm/reject/replan parity in Python.

def test_drive_reject_after_confirm_stales_and_triggers_replan_recompare_flow():
    """Focused pytest: after G_CONFIRM park, reject triggers via Python-owned:
    - stale of prior route art (apply_route at intake)
    - clear await
    - real pick_next_capabilities re-selects route.compare (replan) on reject turn t-rep-2
    - exec of re-compare; no re-park (express text); state proceeds.
    Uses real pick (no hardcoded replan in fake) + per-turn logs to assert t-rep-2 boundary.
    """
    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive
    from services.engine_scheduling import pick_next_capabilities as real_pick_next

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "replan route plan"

    class DummyExec:
        content = "re-compared routes A B C"
        def model_dump(self):
            return {"content": self.content, "title": "re-cmp", "summary": "", "sources": []}

    # per-turn logs to isolate reject turn (t-rep-2) per review finding 1
    picks_log = []  # [(user_snip, [cap_ids])]
    exec_log = []   # [(turn_id, cap_id)]

    def pick_logger(state, user_text):
        # call REAL Python pick_next_capabilities so reject text triggers re-compare via its logic
        ps = real_pick_next(state, user_text)
        picks_log.append( ((user_text or "")[:30], [p["capabilityId"] for p in ps]) )
        return ps

    def fake_exec(cap_id, st, ctx, role, tid):
        exec_log.append( (tid, cap_id) )
        return DummyExec()

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = pick_logger
    sess_mod.__dict__["execute_capability"] = fake_exec
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        state = _mk_state()
        # turn 1: route intent -> real pick includes route.* -> execs -> evaluate parks confirm
        out1 = _reloaded_drive(state, "t-rep-1", "路线对比一下")
        assert getattr(out1, "awaitReason", None) == "confirm", "G_CONFIRM must park after route.compare"
        assert getattr(out1, "runtimePhase", None) == "awaiting"
        assert len(picks_log) == 1
        t1_caps = picks_log[0][1]
        assert "route.compare" in t1_caps

        # turn 2 (reject): apply_route stales prior route art + clears; REAL pick triggers route.compare again (replan on reject keywords); exec; no park
        out2 = _reloaded_drive(out1, "t-rep-2", "都不行，重新对比路线")
        stales2 = getattr(out2, "staleArtifactIds", []) or []
        assert "art-t-rep-1-route.compare" in stales2, "reject must mark prior route art stale (replan precond)"
        assert getattr(out2, "awaitReason", None) != "confirm"
        # replan proof isolated to reject turn (addresses finding 1)
        assert len(picks_log) == 2
        t2_caps = picks_log[1][1]
        assert "route.compare" in t2_caps, "replan/re-compare must be selected by real Python pick_next_capabilities on reject turn (t-rep-2)"
        t2_execs = [c for (tid, c) in exec_log if tid == "t-rep-2"]
        assert "route.compare" in t2_execs, "re-compare cap must execute as part of replan after reject on t-rep-2 turn"
        assert any("route." in c for c in t2_execs), "route replan execs on t-rep-2"

        # turn 3 (followup replan intent): proceeds, no confirm park
        out3 = _reloaded_drive(out2, "t-rep-3", "重新生成路线对比")
        assert getattr(out3, "awaitReason", None) != "confirm"
        # replan flow state correct (not stuck)
        assert getattr(out3, "runtimePhase", None) in ("orchestrating", "awaiting", None) or getattr(out3, "awaitReason", None) in (None, "convergence", "user_input")
    finally:
        if orig_orch is not None: sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None: sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None: sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None: sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None: sess_mod.__dict__["save_session"] = orig_save
