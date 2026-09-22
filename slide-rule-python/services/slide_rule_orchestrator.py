"""
Dynamic SlideRule V5 orchestrator.

This is still heuristic/RAG-backed, but it is no longer a fixed capability list:
it skips already-produced capabilities, expands delivery/prompt-pack paths for
handoff/report goals, and converges when the current state already has the
required outputs.
"""

from typing import Dict, List, Optional

from models.v5_state import PlanStateProjection, V5SessionState, OrchestratePlanResult
from .rag_service import generate_with_rag, retrieve_evidence


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def _has_capability_output(state: V5SessionState, capability_id: str) -> bool:
    for run in state.capabilityRuns:
        if run.capabilityId == capability_id and run.outputs:
            return True
    for artifact in state.artifacts:
        produced_by = artifact.producedBy or {}
        produced_capability = (
            produced_by.get("capabilityId")
            if isinstance(produced_by, dict)
            else getattr(produced_by, "capabilityId", None)
        )
        # 判据是「这条能力有没有 Python 侧的产出」，不是「产出是不是 RAG 生成的」。
        #
        # 2026-08-13：原来写的是 startswith("python-rag")。structure.decompose 换成
        # 真 spec 生成之后 provenance 变成 "python-spec"，**会静默掉出这个判断**——
        # 表现是调度核认为这条能力从没产出过，于是每一轮都重新排它，无限重跑，
        # 而且不报任何错。这类「按具体取值分支、加一个新取值就悄悄失效」的判断，
        # 跟本仓踩过的几次同型（合法域账本抄四处、手写 uses 声明、pageKinds）。
        if produced_capability == capability_id and artifact.provenance.startswith("python-"):
            return True
    return False


def _goal_requires_delivery(goal: str, user_text: str) -> bool:
    text = f"{goal} {user_text}".lower()
    return any(
        keyword in text
        for keyword in [
            "handoff",
            "deliver",
            "report",
            "final",
            "spec",
            "prompt",
            "工程",
            "交付",
            "报告",
            "最终",
            "提示",
            "文档",
        ]
    )


def _goal_requires_structure(goal: str, user_text: str) -> bool:
    text = f"{goal} {user_text}".lower()
    return any(keyword in text for keyword in ["structure", "decompose", "tree", "spec", "结构", "拆解", "需求树"])


PHASE_BY_CAPABILITY: Dict[str, Dict[str, str]] = {
    "evidence.search": {"id": "phase-grounding", "label": "Grounding"},
    "mcp.call": {"id": "phase-grounding", "label": "Grounding"},
    "skill.invoke": {"id": "phase-grounding", "label": "Grounding"},
    "risk.analyze": {"id": "phase-risk", "label": "Risk review"},
    "counter.argue": {"id": "phase-risk", "label": "Risk review"},
    "critique.generate": {"id": "phase-risk", "label": "Risk review"},
    "rebuttal.resolve": {"id": "phase-risk", "label": "Risk review"},
    "synthesis.merge": {"id": "phase-synthesis", "label": "Synthesis"},
    "structure.decompose": {"id": "phase-structure", "label": "Structure"},
    "document.draft": {"id": "phase-delivery", "label": "Delivery"},
    "traceability.matrix": {"id": "phase-delivery", "label": "Delivery"},
    "task.write": {"id": "phase-delivery", "label": "Delivery"},
    "instruction.package": {"id": "phase-delivery", "label": "Delivery"},
    "outcome.visualize": {"id": "phase-delivery", "label": "Delivery"},
    "handoff.package": {"id": "phase-delivery", "label": "Delivery"},
    "report.write": {"id": "phase-report", "label": "Report"},
}


def _phase_for_capability(capability_id: str) -> Dict[str, str]:
    return PHASE_BY_CAPABILITY.get(
        capability_id,
        {"id": "phase-planning", "label": "Planning"},
    )


def _default_recovery_points(status: str) -> List[dict]:
    if status == "error":
        return [
            {
                "id": "recovery-retry-planner",
                "label": "Retry planner",
                "action": "Retry orchestrate.plan after resolving the planner error.",
                "retryable": True,
            },
            {
                "id": "recovery-node-fallback",
                "label": "Use Node boundary",
                "action": "Keep Node-owned state unchanged and choose the next action from existing state.",
                "retryable": False,
            },
        ]
    if status == "complete":
        return [
            {
                "id": "recovery-replan-if-state-changes",
                "label": "Replan if state changes",
                "action": "Rerun orchestrate.plan only after Node records new artifacts or user intent.",
                "retryable": True,
            }
        ]
    return [
        {
            "id": "recovery-replan-from-node-state",
            "label": "Replan from Node state",
            "action": "Node can rerun orchestrate.plan with unchanged durable state if execution stalls.",
            "retryable": True,
        },
        {
            "id": "recovery-skip-blocked-step",
            "label": "Skip blocked step",
            "action": "Node can drop a blocked projected step and ask Python for a fresh projection.",
            "retryable": True,
        },
    ]


def build_plan_state_projection(
    selected: List[dict],
    converged: bool,
    error: Optional[dict] = None,
) -> PlanStateProjection:
    """Build a read-side planner projection; Node remains state authority."""
    if error:
        return PlanStateProjection(
            status="error",
            phase="error",
            partial=False,
            phases=[
                {
                    "id": "phase-error",
                    "label": "Planner error",
                    "status": "blocked",
                    "stepIds": [],
                }
            ],
            steps=[],
            risks=[
                {
                    "id": "risk-planner-error",
                    "severity": "high",
                    "summary": "Planner failed before producing executable steps.",
                    "mitigation": "Do not treat this response as a complete plan; retry or fall back to Node-owned state.",
                },
                {
                    "id": "risk-projection-boundary",
                    "severity": "medium",
                    "summary": "Projection must not mutate Node-owned session state.",
                    "mitigation": "Keep projection read-only and additive.",
                },
            ],
            recoveryPoints=_default_recovery_points("error"),
            error=error,
        )

    status = "complete" if converged else "partial"
    steps = []
    phase_order: List[str] = []
    phase_map: Dict[str, dict] = {}

    for index, item in enumerate(selected, start=1):
        capability_id = str(item.get("capabilityId", "")).strip()
        role_id = str(item.get("roleId", "")).strip()
        phase = _phase_for_capability(capability_id)
        phase_id = phase["id"]
        step_id = f"step-{index}-{capability_id.replace('.', '-') or 'unknown'}"

        if phase_id not in phase_map:
            phase_order.append(phase_id)
            phase_map[phase_id] = {
                "id": phase_id,
                "label": phase["label"],
                "status": "pending",
                "stepIds": [],
            }
        if index == 1:
            phase_map[phase_id]["status"] = "active"

        phase_map[phase_id]["stepIds"].append(step_id)
        step = {
            "id": step_id,
            "capabilityId": capability_id,
            "roleId": role_id,
            "status": "pending",
            "phaseId": phase_id,
        }
        why = str(item.get("why", "")).strip()
        if why:
            step["why"] = why
        steps.append(step)

    if status == "complete":
        phases = [
            {
                "id": "phase-complete",
                "label": "Plan complete",
                "status": "complete",
                "stepIds": [],
            }
        ]
        phase = "complete"
    else:
        phases = [phase_map[phase_id] for phase_id in phase_order]
        phase = "planning"

    return PlanStateProjection(
        status=status,
        phase=phase,
        partial=status == "partial",
        phases=phases,
        steps=steps,
        risks=[
            {
                "id": "risk-projection-boundary",
                "severity": "medium",
                "summary": "Projection must not mutate Node-owned session state.",
                "mitigation": "Keep projection read-only and let Node own durable state transitions.",
            },
            {
                "id": "risk-partial-plan",
                "severity": "medium" if status == "partial" else "low",
                "summary": "Projected steps are advisory until Node executes and records outputs.",
                "mitigation": "Treat non-converged projections as partial and rerun after each committed capability output.",
            },
        ],
        recoveryPoints=_default_recovery_points(status),
        error=None,
    )


def orchestrate_plan(state: V5SessionState, turn_id: str, user_text: str) -> OrchestratePlanResult:
    goal = _goal_text(state)
    evidence = retrieve_evidence(goal, top_k=4)

    candidates: List[dict] = [
        {"capabilityId": "evidence.search", "roleId": "grounding", "why": "Need external evidence for G-GROUND"},
        {"capabilityId": "risk.analyze", "roleId": "safety", "why": "Risk-bearing goal requires risk scan"},
        {"capabilityId": "mcp.call", "roleId": "engineering", "why": "Use tool-style external evidence"},
        {"capabilityId": "skill.invoke", "roleId": "engineering", "why": "Use skill-style synthesis evidence"},
    ]

    if _goal_requires_structure(goal, user_text):
        candidates.append(
            {"capabilityId": "structure.decompose", "roleId": "architecture", "why": "Goal asks for structure/spec decomposition"}
        )

    if _goal_requires_delivery(goal, user_text):
        candidates.extend(
            [
                {"capabilityId": "document.draft", "roleId": "engineering", "why": "Draft delivery document"},
                {"capabilityId": "traceability.matrix", "roleId": "synthesis", "why": "Map requirements to evidence and risks"},
                {"capabilityId": "task.write", "roleId": "product", "why": "Break report into executable tasks"},
                {"capabilityId": "instruction.package", "roleId": "engineering", "why": "Package executable prompts"},
                {"capabilityId": "outcome.visualize", "roleId": "architecture", "why": "Preview expected outcome and architecture"},
                {"capabilityId": "handoff.package", "roleId": "engineering", "why": "Bundle handoff materials"},
            ]
        )

    candidates.append({"capabilityId": "report.write", "roleId": "synthesis", "why": "Deliver structured final report"})
    selected = [item for item in candidates if not _has_capability_output(state, item["capabilityId"])][:8]
    converged = len(selected) == 0

    rationale = generate_with_rag(
        f"Next SlideRule V5 steps for goal: {goal}. Selected capabilities: {[s['capabilityId'] for s in selected]}",
        evidence,
    )

    return OrchestratePlanResult(
        selected=selected,
        rationale=rationale,
        source="python-rag",
        converged=converged,
        planStateProjection=build_plan_state_projection(selected, converged),
    )
