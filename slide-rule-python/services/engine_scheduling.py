# -*- coding: utf-8 -*-
"""引擎自己的回合机制：选下一批能力、修复轮选材、提交交付物、记账。

## 为什么这个文件是 2026-08-29 才出现的

这 20 个函数在此之前长在 `slide_rule_session.py` 里，而它们跟"会话读写"没关系。
原因写在它们自己的注释里，一直没人回头看：

    # Moved into allowed file (slide_rule_session.py) for this task to respect
    # Allowed files boundary.
    # implemented inside allowed file slide_rule_session.py to respect boundary
    # (no edit to slide_rule_trust.py)

**是某一轮任务的「可改文件白名单」把它们挤进来的，不是归属。** 一条临时约束
留下的形状，活成了架构里最后一个组间环：`v5_full_driver`（model_core）为了
排程和记账，反过来 import 驱动组的会话文件——`model_core → drive`，
而 `drive → model_core` 本来就成立，于是成环。

## ⚠ 我差点又没拆它，理由是一个错的测量

`docs/欠缺模块清单-对照Claude与Grok-build.md` §28.4 写着不拆，理由是：

> 那 7 个函数又用到同文件里另外 13 个模块级 helper，要动的是 1101 行里的
> 700 多行——那不是搬家，是把这个文件劈成两半。

**700 多行是估的，没数。** 2026-08-29 真去数了一遍（按传递闭包，不是按眼睛扫）：

    引擎侧  20 个函数  541 行   ← 7 个入口 + 13 个 helper，**连续占据文件末尾**
    存储侧  12 个函数  402 行
    两侧共用的 helper：**0 个**
    存储侧调用引擎侧：只有 `drive_reasoning_turn` 一个，而它是编排，本来就该在上面

零重叠。切口在 476 行，是一刀直的。**"劈成两半"是对的，但那两半本来就没长在一起。**

这是本仓第五次「错的测量让我少做该做的事」（前四次见 §29.4 / §30.2）。共同形状：
样本小、没跑真的数据、然后把结论写成陈述句。这次的额外教训是——
**上一版判据自己写了"哪天缠绕解开了这条会红"，而缠绕从来就没有过。**

## 归属

`model_core`。不叫 `capability_*` 是**故意的**：`capability_engine` 是执行引擎
（`slide_rule_executor` + `capability_maps`），这里是排程与记账，两回事。
本仓已经五次栽在「按名字前缀归组」上（`v5_` / `block_` / `app_` / `spec_` /
`model_`，见 §28.3），不给第六次留话柄。

## 方向

    engine_scheduling  →  models.v5_state, slide_rule_interactive_gates   （都在 model_core / models）
    v5_full_driver     →  engine_scheduling                              （组内）
    slide_rule_session →  engine_scheduling                              （drive → model_core，早已声明）

反方向一条都没有：本模块不 import `slide_rule_session`。这正是环被拆掉的原因——
别把这条加回去。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from models.v5_state import (
    Artifact,
    CapabilityRun,
    DependencyEdge,
    ProducedBy,
    ReasoningEvent,
    SlideRuleReplayEvent,
    V5SessionState,
)

from .slide_rule_interactive_gates import open_human_question_gap_count


# --- Error recovery for capability execution (this task) ---
# Per-capability errors must record CapabilityRun with error/timing (and result if partial),
# preserve prior artifacts/runs/ledgers (append-only, no reset), and surface degraded
# without hiding behind outer failed that drops which cap failed.
# Drivers wrap individual cap execution; non-cap crash can still outer-fail.
# Classification (step 1): before this task PYTHON_COMPAT (outer catch, no per-run error), after PYTHON_AUTHORITY.
# No Node fallback.

def record_capability_run_error(
    state: V5SessionState,
    *,
    capabilityId: str,
    turnId: str,
    error: Dict[str, Any],
    roleId: Optional[str] = None,
    timing: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None,
) -> CapabilityRun:
    """Record failed capability execution into capabilityRuns as durable error record.
    Appends only; prior state (artifacts, prior runs, ledgers) left intact.
    Sets no whole-state corruption. Callers decide phase (usually await with degraded detail).
    """
    from datetime import datetime, timezone as _tz
    now_iso = datetime.now(_tz.utc).isoformat()
    t = dict(timing) if timing else {}
    if "startedAt" not in t:
        t["startedAt"] = now_iso
    if "completedAt" not in t:
        t["completedAt"] = now_iso
    run_id = f"run-{turnId}-{capabilityId}"
    run = CapabilityRun.server_record(
        # 这条路径的名字就是"执行炸了"，结局没有第二种可能。
        status="error",
        # 调用方给的 timing 里可能已经带了 durationMs（真机两个路由都带）；
        # server_record 会把顶层和 timing 两处对齐，这里如实透传。
        durationMs=(
            int(t["durationMs"]) if isinstance(t.get("durationMs"), (int, float)) else None
        ),
        provenance="scheduling.error",
        id=run_id,
        capabilityId=capabilityId,
        turnId=turnId,
        inputs=[],
        outputs=[],
        gateResults=[{"gateId": "execution", "status": "failed"}],
        result=result,
        roleId=roleId,
        timing=t,
        error=dict(error) if error else {"code": "capability_error", "message": "unknown failure"},
    )
    runs = getattr(state, "capabilityRuns", None) or []
    runs.append(run)
    state.capabilityRuns = runs
    return run


# --- Browser-visible reasoning events + replay exposure (PYTHON_AUTHORITY for this slice) ---
# Smallest append-only helpers so drive can emit phase/capability progress into durable lists.
# UI can poll GET session or use returned drive state to see incremental events (no freeze).
# Uses existing model kinds (capability_start / capability_complete / replay capability_run etc).
# Phase changes surfaced via runtimePhase + replay "decision" + reasoning "think" for phase markers.
# No Node fallback; events appended before/after key steps + on save paths.

def append_reasoning_event(
    state: V5SessionState,
    *,
    turnId: str,
    capabilityRunId: str,
    capabilityId: str,
    kind: str,
    text: str,
    roleId: Optional[str] = None,
    order: Optional[int] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> ReasoningEvent:
    """Append a ReasoningEvent for browser-visible substeps (capability boundaries + think markers)."""
    events = getattr(state, "reasoningEvents", None) or []
    next_order = order if order is not None else (len(events) + 1)
    ts = datetime.now(timezone.utc).isoformat()
    ev = ReasoningEvent(
        id=f"{capabilityRunId}-ev-{next_order}",
        turnId=turnId,
        capabilityRunId=capabilityRunId,
        capabilityId=capabilityId,
        kind=kind,  # e.g. "capability_start", "capability_complete", "think"
        roleId=roleId,
        text=text,
        refs=None,
        meta=meta,
        order=next_order,
        ts=ts,
    )
    events.append(ev)
    state.reasoningEvents = events
    return ev


def append_replay_event(
    state: V5SessionState,
    *,
    kind: str,
    turnId: Optional[str] = None,
    capabilityId: Optional[str] = None,
    capabilityRunId: Optional[str] = None,
    decisionId: Optional[str] = None,
    conversationId: Optional[str] = None,
) -> SlideRuleReplayEvent:
    """Append SlideRuleReplayEvent (capability_run / decision / conversation) for durable replay log."""
    log = getattr(state, "sessionReplayLog", None) or []
    idx = len(log) + 1
    ts = datetime.now(timezone.utc).isoformat()
    ev = SlideRuleReplayEvent(
        id=f"replay-{state.sessionId}-{idx}",
        sessionId=state.sessionId,
        at=ts,
        kind=kind,
        turnId=turnId,
        capabilityId=capabilityId,
        capabilityRunId=capabilityRunId,
        decisionId=decisionId,
        conversationId=conversationId,
    )
    log.append(ev)
    state.sessionReplayLog = log
    return ev


# --- Python-owned pickNextCapabilities port (V5.2 semantics + fallback rules) ---
# Moved into allowed file (slide_rule_session.py) for this task to respect Allowed files boundary.
# Faithful port of readiness short-circuit, delivery/report prefix, structure intent+exclude,
# keyword routes/risk/report/clarify/visual, stale risk, kind progression, openQ, skip-ev,
# cold+final fallbacks, complex/game extras, dedup+cap<=5.
# Drivers explicitly call this (not plan.selected) so empty reliably means converge.
# No Node fallback.

from typing import Any  # ensure for helpers


def _is_healthy_artifact_py(artifact: Any, stales: set) -> bool:
    if isinstance(artifact, dict):
        tl = artifact.get("trustLevel") or artifact.get("trust_level")
        aid = artifact.get("id")
    else:
        tl = getattr(artifact, "trustLevel", None) or getattr(artifact, "trust_level", None)
        aid = getattr(artifact, "id", None)
    healthy = (tl == "gated_pass" or tl == "audited")
    return healthy and (aid not in stales)


def has_structure_decompose_intent(user_text: str) -> bool:
    if not user_text:
        return False
    if any(k in user_text for k in ["结构", "分解", "decompose"]):
        return True
    lower = user_text.lower()
    if any(k in lower for k in ["树", "拆解"]):
        return True
    if "spec tree" in lower or "tree" in lower.split():
        return True
    return False


def _has_spec_tree_artifact(state: V5SessionState) -> bool:
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    for a in (getattr(state, "artifacts", []) or []):
        if _is_healthy_artifact_py(a, stales):
            kind = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None))
            if kind == "spec_tree" or kind == "spec tree":
                return True
    return False


def _is_delivery_intent(user_text: str) -> bool:
    if not user_text:
        return False
    text = (user_text or "").lower()
    keys = ["handoff", "deliver", "report", "final", "spec", "prompt", "工程", "交付", "报告", "最终", "提示", "文档"]
    return any(k in text for k in keys)


def _is_visual_intent(user_text: str) -> bool:
    if not user_text:
        return False
    t = user_text.lower()
    return "visual" in t or "mermaid" in t or "预览" in t or "效果" in t or "结构图" in t


def _has_grounded_external_evidence_py(state: V5SessionState) -> bool:
    try:
        from .slide_rule_coverage import has_grounded_external_evidence
        return has_grounded_external_evidence(state)
    except Exception:
        # fallback conservative: has any healthy evidence
        stales = set(getattr(state, "staleArtifactIds", []) or [])
        for a in (getattr(state, "artifacts", []) or []):
            if _is_healthy_artifact_py(a, stales):
                kind = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", ""))
                if kind == "evidence":
                    return True
        return False


def _recent_ungrounded_attempts_py(state: V5SessionState, n: int = 3) -> int:
    runs = (getattr(state, "capabilityRuns", []) or [])[-n*2:]
    count = 0
    for r in reversed(runs):
        cid = (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        if "evidence" in cid or "search" in cid:
            count += 1
            if count >= n:
                break
    if not _has_grounded_external_evidence_py(state):
        return min(len(runs), n)
    return 0


def _find_gh_url(lower: str, goal_text: str) -> Optional[str]:
    text = f"{goal_text or ''} {lower}".lower()
    if "github.com" in text or "gitlab.com" in text:
        return "https://github.com/example/repo"
    return None


def _resolve_role_mode(state: V5SessionState, user_text: str) -> str:
    goal = _goal_text(state)
    t = (goal + " " + (user_text or "")).lower()
    if any(k in t for k in ["rpg", "游戏", "multi-agent", "多agent", "多角色", "复杂", "brainstorm"]):
        return "complex"
    gtext = goal or ""
    if len(gtext) > 80:
        return "complex"
    return "single"


def _should_degrade_brainstorm(state: V5SessionState, user_text: str) -> bool:
    return False


def _pick_brainstorm_primers(state: V5SessionState) -> list:
    return [
        {"capabilityId": "critique.generate", "roleId": "产品"},
        {"capabilityId": "synthesis.merge", "roleId": "综合"},
    ]


def _pick_readiness_chain(state: V5SessionState) -> list:
    picks = []
    oq = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    if oq > 0 or not (getattr(state, "artifacts", []) or []):
        if {"capabilityId": "gap.ask", "roleId": "产品"} not in picks:
            picks.append({"capabilityId": "gap.ask", "roleId": "产品"})
        picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})
        if not _has_spec_tree_artifact(state):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})
    return picks


def _needs_readiness_chain(state: V5SessionState, user_text: str) -> bool:
    oq = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    arts = len(getattr(state, "artifacts", []) or [])
    ut = (user_text or "").lower()
    if oq > 0:
        return True
    goal = _goal_text(state)
    vague = (len(goal or "") < 8) or ("模糊" in ut) or ("clarif" in ut) or ("vague" in ut)
    return (oq > 0 or (arts == 0 and vague))


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def pick_next_capabilities(state: V5SessionState, user_text: str) -> list[dict]:
    """Python-owned implementation of pickNextCapabilities with all V5.2 fallback rules."""
    lower = (user_text or "").lower()
    picks: list[dict] = []
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    artifacts = getattr(state, "artifacts", []) or []
    healthy_kinds = set()
    for a in artifacts:
        if _is_healthy_artifact_py(a, stales):
            k = (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None))
            if k:
                healthy_kinds.add(k)
    has_risk = "risk" in healthy_kinds
    has_synth = "synthesis" in healthy_kinds
    has_report = "report" in healthy_kinds
    stale_count = len(stales)
    cap_runs = getattr(state, "capabilityRuns", []) or []
    recent_runs = [(r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) for r in cap_runs[-6:]]
    recent_ledger = [(r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) for r in cap_runs[-4:]]
    open_q_count = open_human_question_gap_count(state) or len(getattr(state, "openQuestions", []) or [])
    ungrounded = _recent_ungrounded_attempts_py(state, 3)
    session_grounded = _has_grounded_external_evidence_py(state)
    should_skip_ev = (not session_grounded and ungrounded >= 2)
    art_count = len([a for a in artifacts if _is_healthy_artifact_py(a, stales)])
    is_cold = art_count == 0 and len(cap_runs) == 0

    role_mode = _resolve_role_mode(state, user_text)

    # readiness short-circuit
    if _needs_readiness_chain(state, user_text):
        rdy = _pick_readiness_chain(state)
        picks = [p for p in rdy if p["capabilityId"] not in [x["capabilityId"] for x in picks]]
        if role_mode == "complex" and not _should_degrade_brainstorm(state, user_text):
            primers = [p for p in _pick_brainstorm_primers(state) if p["capabilityId"] not in [x["capabilityId"] for x in picks]]
            if primers:
                picks = primers + picks
        return picks[:5]

    # delivery after clear
    if _is_delivery_intent(user_text) and (state.goal or {}).get("status") == "clear":
        if not has_report:
            picks.append({"capabilityId": "report.write", "roleId": "综合"})
        if has_structure_decompose_intent(user_text) and not _has_spec_tree_artifact(state):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})
        from .slide_rule_coverage import has_trusted_committed_for_cap as _has_committed
        for cap, role in [
            ("document.draft", "工程"),
            ("traceability.matrix", "综合"),
            ("task.write", "产品"),
            ("instruction.package", "工程"),
            ("outcome.visualize", "架构"),
            ("handoff.package", "工程"),
        ]:
            # 已可信提交的交付能力不重复执行：避免重复产物与无谓的 LLM 调用，
            # 也让 5-cap 限制下多轮"打包交付"能推进到未完成的能力（如 handoff）。
            if _has_committed(state, cap):
                continue
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": role})
        # unified dedup + cap<=5 (addresses review: delivery branch must not bypass final dedup/out[:5];
        # task+comments declare cap<=5 for all paths; now consistent with readiness/visual/final)
        seen = set()
        out = []
        for p in picks:
            key = f"{p['capabilityId']}:{p.get('roleId','')}"
            if key not in seen:
                seen.add(key)
                out.append(p)
        return out[:5]

    # visual
    if _is_visual_intent(user_text):
        vis = []
        if "mermaid" in lower or "结构图" in lower:
            vis.append({"capabilityId": "outcome.visualize", "roleId": "架构"})
        if vis:
            return vis[:5]

    gh = _find_gh_url(lower, _goal_text(state))
    if gh:
        if not any(p["capabilityId"] == "repo.inspect" for p in picks):
            picks.append({"capabilityId": "repo.inspect", "roleId": "工程"})
        if not should_skip_ev and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if "路线" in lower or "route" in lower or "对比" in lower:
        if not any(p["capabilityId"] == "route.generate" for p in picks):
            picks.append({"capabilityId": "route.generate", "roleId": "架构"})
        if not any(p["capabilityId"] == "route.compare" for p in picks):
            picks.append({"capabilityId": "route.compare", "roleId": "工程"})

    if "澄清" in lower or "clarif" in lower or "模糊" in lower:
        if not any(p["capabilityId"] == "intent.clarify" for p in picks):
            picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})

    if "风险" in lower or "安全" in lower or "反驳" in lower:
        if not any(p["capabilityId"] == "risk.analyze" for p in picks):
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
        if not any(p["capabilityId"] == "counter.argue" for p in picks):
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})

    if has_structure_decompose_intent(user_text) and not _has_spec_tree_artifact(state):
        if not any(p["capabilityId"] == "structure.decompose" for p in picks):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})

    if "报告" in lower or "report" in lower or "可行性" in lower or "总结" in lower:
        if not has_risk:
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})
        if not has_synth:
            picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})
        if not has_report:
            picks.append({"capabilityId": "report.write", "roleId": "综合"})

    if "预览" in lower or "效果" in lower or "preview" in lower:
        if not any(p["capabilityId"] == "scenario.simulate" for p in picks):
            picks.append({"capabilityId": "scenario.simulate", "roleId": "工程"})

    if stale_count > 0:
        if not any("risk" in p["capabilityId"] or "argue" in p["capabilityId"] for p in picks):
            picks.append({"capabilityId": "risk.analyze", "roleId": "安全"})
            picks.append({"capabilityId": "counter.argue", "roleId": "挑刺"})

    if has_risk and not has_synth and not has_report:
        if not any(p["capabilityId"] == "synthesis.merge" for p in picks):
            picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if has_synth and not has_report:
        if not any(p["capabilityId"] == "report.write" for p in picks):
            picks.append({"capabilityId": "report.write", "roleId": "综合"})

    if open_q_count > 0:
        if not any(p["capabilityId"] == "intent.clarify" for p in picks):
            picks.append({"capabilityId": "intent.clarify", "roleId": "产品"})
        if not _has_spec_tree_artifact(state) and not any(p["capabilityId"] == "structure.decompose" for p in picks):
            picks.append({"capabilityId": "structure.decompose", "roleId": "架构"})

    if stale_count == 0 and not should_skip_ev:
        avoid = set(recent_ledger)
        if len(picks) < 3 and "evidence.search" not in avoid and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if is_cold and len(picks) < 3:
        for cap, role in [("intent.clarify", "产品"), ("route.generate", "架构"), ("risk.analyze", "安全")]:
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": role})
        if not should_skip_ev and not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})

    if len(picks) == 0:
        avoid = set(recent_runs + recent_ledger)
        if "intent.parse" not in avoid:
            picks.append({"capabilityId": "intent.parse", "roleId": "产品"})
        if not should_skip_ev and "evidence.search" not in avoid:
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if len(picks) == 0:
        picks.append({"capabilityId": "intent.parse", "roleId": "产品"})
        if not should_skip_ev:
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        picks.append({"capabilityId": "synthesis.merge", "roleId": "综合"})

    if role_mode == "complex" and not _should_degrade_brainstorm(state, user_text):
        primers = [p for p in _pick_brainstorm_primers(state) if not any(x["capabilityId"] == p["capabilityId"] for x in picks)]
        if primers:
            picks = primers + picks

    # contract-driven fill: 合约要求但尚未 trusted-committed 的能力必须被选中，
    # 否则启发式规则漏选（如 critique.generate）会导致 max_repeat_guard 死锁（金链路修复）。
    contract = getattr(state, "coverageContract", None)
    contract_reqs = (
        contract.get("requiredCapabilities") if isinstance(contract, dict)
        else getattr(contract, "requiredCapabilities", None)
    ) or []
    if contract_reqs:
        from .slide_rule_coverage import has_trusted_committed_for_cap
        contract_roles = {
            "critique.generate": "挑刺",
            "risk.analyze": "安全",
            "synthesis.merge": "综合",
            "evidence.search": "接地",
            "report.write": "综合",
        }
        for cap in contract_reqs:
            if cap == "report.write":
                continue  # report 收尾由 has_synth/has_report 规则驱动
            if cap == "evidence.search" and should_skip_ev:
                continue
            if has_trusted_committed_for_cap(state, cap):
                continue
            if not any(p["capabilityId"] == cap for p in picks):
                picks.append({"capabilityId": cap, "roleId": contract_roles.get(cap, "agent")})

    # multi agent game
    goal_game = ((_goal_text(state) or "") + " " + (user_text or "")).lower()
    is_game = any(k in goal_game for k in ["rpg", "游戏", "multi-agent", "多agent", "多角色"])
    if is_game and role_mode == "complex":
        if not any(p["capabilityId"] == "evidence.search" for p in picks):
            picks.append({"capabilityId": "evidence.search", "roleId": "接地"})
        for c, r in [("mcp.call", "工程"), ("skill.invoke", "工程"), ("structure.decompose", "架构")]:
            if not any(p["capabilityId"] == c for p in picks):
                picks.append({"capabilityId": c, "roleId": r})

    # dedup + slice
    seen = set()
    out = []
    for p in picks:
        key = f"{p['capabilityId']}:{p.get('roleId','')}"
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out[:5]


_REPAIR_CAP_ROLES = {
    "evidence.search": "接地",
    "risk.analyze": "安全",
    "counter.argue": "挑刺",
    "critique.generate": "挑刺",
    "synthesis.merge": "综合",
    "report.write": "综合",
    "intent.clarify": "产品",
}


def pick_repair_capabilities(state: V5SessionState) -> list[dict]:
    """E26 缺口修复轮选材：只挑「缺什么」，绝不做启发式扩展。

    来源三处（与覆盖门的判定同源，修什么以门说了算）：
      1. 开放的 missing_capability 缺口 → 其 requiredCapabilityId；
      2. 开放的 missing_evidence 缺口 / 接地证据不足 → evidence.search；
      3. 覆盖门报告的 missingCapabilities（合约要求但未可信提交）。
    已 PASS 的产物一概不碰——重跑范围就是门标红的那几项。
    """
    from .slide_rule_coverage import (
        evaluate_coverage_gate,
        has_grounded_external_evidence,
    )

    picks: list[dict] = []
    seen: set[str] = set()

    def _add(cap: Any) -> None:
        cap_id = str(cap or "").strip()
        if cap_id and cap_id not in seen:
            seen.add(cap_id)
            picks.append({
                "capabilityId": cap_id,
                "roleId": _REPAIR_CAP_ROLES.get(cap_id, "agent"),
            })

    for g in getattr(state, "coverageGaps", []) or []:
        status = g.get("status") if isinstance(g, dict) else getattr(g, "status", "open")
        if (status or "open") != "open":
            continue
        kind = g.get("kind") if isinstance(g, dict) else getattr(g, "kind", None)
        if kind == "missing_capability":
            _add(g.get("requiredCapabilityId") if isinstance(g, dict) else getattr(g, "requiredCapabilityId", None))
        elif kind == "missing_evidence":
            _add("evidence.search")

    gate = evaluate_coverage_gate(state)
    for cap in gate.get("missingCapabilities") or []:
        _add(cap)

    if not has_grounded_external_evidence(state):
        _add("evidence.search")

    return picks[:5]


# --- Python-owned commitArtifact (V5.2) ---
# Smallest slice for this task: implemented inside allowed file slide_rule_session.py to respect boundary (no edit to slide_rule_trust.py).
# Provides artifact + run + gateResults (ground gate from content+producedBy, not unconditional) + depGraph updates + ledger record.
# turnId must be passed by caller (full driver uses loop-N, session uses turn_id); no reliance on unset lastTurnId.
# Classification: PYTHON_COMPAT (bypass) -> PYTHON_AUTHORITY for commit semantics in drivers.
# Do not default to trusted.

from typing import Any as _Any, Dict as _Dict, List as _List, Optional as _Optional  # local aliases to avoid shadowing

def commit_artifact(
    state: V5SessionState,
    *,
    id: str,
    kind: str,
    content: str,
    summary: _Optional[str] = None,
    title: _Optional[str] = None,
    provenance: str = "python-rag",
    producedBy: ProducedBy,
    inputArtifactIds: _Optional[_List[str]] = None,
    sources: _Optional[_List[_Any]] = None,
    payload: _Optional[_Dict[str, _Any]] = None,
    turnId: _Optional[str] = None,
) -> tuple[Artifact, CapabilityRun]:
    """Python-owned commitArtifact: creates artifact + run, evaluates gate(s) to justify trustLevel (ground gate based on content+producedBy), records ledger, updates dependencyGraph for traceability.
    Do not default to trusted: gated_pass only if ground gate passes.
    Drivers must pass explicit turnId for full traceability (loop-N or turn); avoids 't' default.
    """
    # ground gate: justified by server execution provenance + non-empty output (not unconditional)
    has_content = bool((content or "").strip() or (summary or "").strip())
    ground_passed = has_content and producedBy is not None
    ground_result: _Dict[str, _Any] = {"gateId": "ground", "status": "passed" if ground_passed else "failed"}
    trust_level = "gated_pass" if ground_passed else "untrusted"
    passed_gates_list: _List[str] = ["ground"] if ground_passed else []

    art = Artifact.server_construct(
        id=id,
        kind=kind,
        provenance=provenance,
        trustLevel=trust_level,
        title=title,
        summary=summary or "",
        content=content,
        producedBy=producedBy,
        payload=payload or ({"sources": sources or []} if sources else None),
        passedGates=passed_gates_list,
    )

    run_id = producedBy.capabilityRunId
    turn = turnId or getattr(state, "lastTurnId", None) or "t"
    run = CapabilityRun.server_record(
        # 产物已经落地并过了接地闸 —— 这条路径只在成功时走到。
        status="success",
        # ⚠ 如实 None：这条是"产物落地顺带记一笔"，**它没有计时**。
        #   编一个 0 会被当成"这一步不花时间"，比留空更骗人。
        durationMs=None,
        provenance="scheduling.commit",
        id=run_id,
        capabilityId=producedBy.capabilityId,
        turnId=turn,
        inputs=list(inputArtifactIds or []),
        outputs=[id],
        gateResults=[ground_result],
        roleId=producedBy.roleId,
    )

    # mutate state: artifacts + runs
    arts = getattr(state, "artifacts", None) or []
    arts.append(art)
    state.artifacts = arts
    runs = getattr(state, "capabilityRuns", None) or []
    runs.append(run)
    state.capabilityRuns = runs

    # dependencyGraph updates: maintain traceable relations (inputs -> output; chain for loops)
    dep_graph = getattr(state, "dependencyGraph", None) or []
    ins = inputArtifactIds or []
    for inp in ins:
        dep_graph.append(DependencyEdge(fromArtifactId=inp, toArtifactId=id, reason="input-to-output"))
    if not ins and len(getattr(state, "artifacts", []) or []) > 1:
        # link to prior artifact to ensure depGraph mutates in multi-cap loops (traceability)
        prev = state.artifacts[-2]
        prev_id = getattr(prev, "id", None) or (prev.get("id") if isinstance(prev, dict) else None)
        if prev_id and prev_id != id:
            dep_graph.append(DependencyEdge(fromArtifactId=prev_id, toArtifactId=id, reason="execution-chain"))
    state.dependencyGraph = dep_graph

    # record ledger for provenance/trust (required for has_trusted_committed + coverage)
    try:
        from .slide_rule_trust import record_provenance_and_trust_ledger
        record_provenance_and_trust_ledger(state, art, run)
    except Exception:
        pass

    return art, run
