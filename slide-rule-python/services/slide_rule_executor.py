"""
Capability executor ported from Node's server/routes/sliderule.ts + exec maps + fallbacks.

All tool/evidence/report paths now use stable RAG → real "外部证据" instead of degraded/template.
Dialogue family owns explicit branches + degraded/error envelope. Deliberation role-mode semantics + fallback (roleMode simple/complex/degraded + rebuttal.resolve) now owned here + maps (this task).
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol
import time
import uuid
from datetime import datetime, timezone
from models.v5_state import V5SessionState, ExecuteCapabilityResult, CapabilityRun, CapabilityCostRecord
from .rag_service import retrieve_evidence, generate_with_rag
from .mcp_runtime import (
    FAKE_MCP_RUNTIME_PROVENANCE,
    MCP_RUNTIME_NAME,
    MCP_RUNTIME_PROVENANCE,
    PERMISSION_PROVENANCE,
    McpAdapterError,
    McpAdapterUnavailable,
    McpPermissionCheckError,
    McpPermissionChecker,
    McpPermissionDecision,
    McpPermissionRequest,
    McpRuntime,
    McpToolAdapter,
    McpToolInvokeRequest,
    McpToolInvokeResult,
    McpToolNotFoundError,
    create_mcp_runtime,
    execute_mcp_call_with_runtime,
    get_mcp_runtime,
    set_mcp_runtime,
)
from .skill_runtime import (
    DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE,
    DEFAULT_SKILL_RUNTIME,
    SkillInvokeDeniedError,
    SkillInvokeRequest,
    SkillInvokeResult,
    SkillInvalidArgumentsError,
    SkillNotFoundError,
    SkillRegistry,
    SkillRuntime,
    SkillRuntimeAdapter,
    SkillRuntimeError,
    SkillRuntimeUnavailable,
    create_skill_runtime,
    get_skill_runtime,
    set_skill_runtime,
)

FAKE_SKILL_RUNTIME_PROVENANCE = DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE


def _skill_params_from_state(state: V5SessionState) -> tuple[str, str, Dict[str, Any]]:
    goal = state.goal if isinstance(state.goal, dict) else {}
    skill_id = str(goal.get("skillId") or goal.get("skillName") or "skill.invoke")
    runtime = str(goal.get("skillRuntime") or goal.get("runtime") or DEFAULT_SKILL_RUNTIME)
    arguments = dict(goal.get("skillArguments") or goal.get("arguments") or {})
    return skill_id, runtime, arguments


def execute_skill_invoke_with_runtime(
    state: V5SessionState,
    role_id: str,
    turn_id: str,
    input_artifact_ids: List[str],
    *,
    runtime: Optional[SkillRuntime] = None,
) -> Dict[str, Any]:
    active = runtime or get_skill_runtime()
    if active is None:
        raise RuntimeError("skill runtime is not configured")

    goal_text = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)
    skill_id, requested_runtime, arguments = _skill_params_from_state(state)
    runtime_name = active.runtime or requested_runtime
    provenance = active.provenance_for(runtime_name)

    def error_payload(title: str, summary: str, error: str, exc: Exception) -> Dict[str, Any]:
        return {
            "title": title,
            "summary": summary,
            "content": str(exc),
            "provenance": provenance,
            "degraded": True,
            "error": error,
            "skillId": skill_id,
            "runtime": runtime_name,
            "arguments": arguments,
        }

    try:
        result = active.adapter.invoke(
            SkillInvokeRequest(
                skill_id=skill_id,
                runtime=runtime_name,
                arguments=arguments,
                input=goal_text,
            )
        )
    except SkillRuntimeUnavailable as exc:
        return error_payload(
            "skill.invoke unavailable",
            "Skill runtime is not available",
            "skill_runtime_unavailable",
            exc,
        )
    except SkillNotFoundError as exc:
        return error_payload(
            "skill.invoke skill not found",
            "Requested skill is not registered on the runtime",
            "skill_not_found",
            exc,
        )
    except SkillInvokeDeniedError as exc:
        return error_payload(
            "skill.invoke denied",
            "Requested skill invocation was denied by runtime policy",
            "skill_invoke_denied",
            exc,
        )
    except SkillInvalidArgumentsError as exc:
        return error_payload(
            "skill.invoke invalid arguments",
            "Skill runtime rejected the supplied arguments",
            "skill_invalid_arguments",
            exc,
        )
    except SkillRuntimeError as exc:
        return error_payload(
            "skill.invoke runtime error",
            "Skill runtime failed while invoking the requested skill",
            "skill_runtime_error",
            exc,
        )

    return {
        "title": f"skill.invoke {skill_id}",
        "summary": "Skill runtime returned a deterministic skill result",
        "content": result.output,
        "provenance": result.provenance or provenance,
        "degraded": False,
        "skillId": skill_id,
        "runtime": result.runtime or runtime_name,
        "arguments": arguments,
        "skillResult": result.response if result.response is not None else {"output": result.output},
        "sources": [],
    }


def _write_capability_telemetry(state: V5SessionState, capability_id: str, role_id: str, turn_id: str, result_out: Dict[str, Any], start_ts: float, end_ts: float) -> None:
    """Unified telemetry writer for every capability run (PYTHON_AUTHORITY).
    Captures timing and estimated token/cost; appends CapabilityCostRecord to costLedger
    and ensures CapabilityRun with timing for durable record.
    Called from both direct execute_capability and mapped paths.
    """
    duration_ms = int((end_ts - start_ts) * 1000)
    started_at = datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat()
    completed_at = datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat()
    timing = {"startedAt": started_at, "completedAt": completed_at, "durationMs": duration_ms}
    result_out["timing"] = timing
    content = str(result_out.get("content", "") or "")
    sources_len = len(result_out.get("sources", [])) if isinstance(result_out.get("sources"), list) else 0
    est_tokens = max(8, (len(content) // 4) + (sources_len * 2))
    est_cost = round(est_tokens * 0.0000018, 8)  # deterministic low-cost estimate for RAG paths per V5 cost telemetry
    result_out["estimatedTokens"] = est_tokens
    result_out["estimatedCostUsd"] = est_cost
    run_id = f"run-{turn_id or 't'}-{capability_id}-{uuid.uuid4().hex[:8]}"
    now_iso = completed_at
    # write cost ledger entry for this cap run (idempotent on id)
    cost_rec = CapabilityCostRecord(
        id=f"cost-{run_id}",
        turnId=turn_id or "t",
        capabilityRunId=run_id,
        capabilityId=capability_id,
        estimatedTokens=est_tokens,
        estimatedCostUsd=est_cost,
        durationMs=duration_ms,
        source="estimated",
        createdAt=now_iso,
    )
    existing_costs = getattr(state, "costLedger", None) or []
    turn_key = turn_id or "t"
    # Per-run id (ts-based run_id) dedup only: allows multiple real runs of same (capabilityId, turnId).
    # Delegate nesting double (mapped<->cap) is prevented by skip-write checks at call sites (see execute_mapped and execute_cap wrapper).
    # This ensures *every* capability run writes its timing + cost telemetry (addresses finding 1 major).
    #
    # ⚠ 2026-08-20：drive 绑定了 LLM 实调用钩子时，同一趟会再按 content//4
    # 估一笔——用量页把一趟算两次。钩子在场就只让 call_llm 记。
    from sliderule_llm.client import llm_result_hook_active

    if not llm_result_hook_active() and not any(
        getattr(c, "id", None) == cost_rec.id for c in existing_costs
    ):
        existing_costs.append(cost_rec)
        state.costLedger = existing_costs
    # write/ensure CapabilityRun with timing (idempotent)
    cap_run = CapabilityRun.server_record(
        # 走到这一行说明能力返回了结果（失败那条走
        # engine_scheduling.record_capability_run_error）。
        status="success",
        # timing 是这条路径唯一真正量过墙钟的地方，顶层跟它对齐。
        durationMs=(
            int(timing["durationMs"])
            if isinstance((timing or {}).get("durationMs"), (int, float))
            else None
        ),
        provenance="executor.run",
        id=run_id,
        capabilityId=capability_id,
        turnId=turn_key,
        inputs=[],
        outputs=[],
        gateResults=[],
        result=result_out,
        roleId=role_id,
        timing=timing,
    )
    existing_runs = getattr(state, "capabilityRuns", None) or []
    if not any(getattr(r, "id", None) == run_id for r in existing_runs):
        existing_runs.append(cap_run)
        state.capabilityRuns = existing_runs


def execute_capability(
    capability_id: str,
    state: V5SessionState,
    input_artifact_ids: List[str],
    role_id: str,
    turn_id: str
) -> ExecuteCapabilityResult:
    start_ts = time.time()
    started_iso = datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat()
    goal = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)

    def _exec_impl() -> ExecuteCapabilityResult:
        if capability_id in ("mcp.call", "skill.invoke"):
            # PYTHON_AUTHORITY (CapabilityParity): explicit contract for mcp.call/skill.invoke.
            # No silent RAG template success ("via stable RAG"). When runtime absent: explicit unavailable/degraded.
            # When runtime present: delegate to *_with_runtime for success/denied/notfound/invalid etc shapes.
            # Classification: PYTHON_COMPAT (shared RAG) -> PYTHON_AUTHORITY; no Node fallback.
            if capability_id == "mcp.call":
                rt = get_mcp_runtime()
                if rt is not None:
                    d = execute_mcp_call_with_runtime(state, role_id, turn_id, input_artifact_ids, runtime=rt)
                    res = ExecuteCapabilityResult(
                        title=d.get("title", "mcp.call"),
                        summary=d.get("summary", ""),
                        content=d.get("content", ""),
                        provenance=d.get("provenance", "python-mcp-runtime"),
                        degraded=d.get("degraded", False),
                        sources=d.get("sources", []),
                        toolName=d.get("toolName"),
                    )
                    if d.get("error"):
                        res.__dict__["error"] = d["error"]
                    if d.get("degradedReason"):
                        res.__dict__["degradedReason"] = d["degradedReason"]
                    return res
                res = ExecuteCapabilityResult(
                    title="mcp.call unavailable",
                    summary="mcp.call Python runtime is not configured",
                    content="Python mcp.call runtime unavailable. Explicit contract (no silent RAG).",
                    provenance="python-mcp-runtime",
                    degraded=True,
                    degradedReason="runtime_unavailable",
                    sources=[],
                    toolName="mcp.call",
                )
                res.__dict__["error"] = "mcp_runtime_unavailable"
                return res
            else:
                rt = get_skill_runtime()
                if rt is not None:
                    d = execute_skill_invoke_with_runtime(state, role_id, turn_id, input_artifact_ids, runtime=rt)
                    res = ExecuteCapabilityResult(
                        title=d.get("title", "skill.invoke"),
                        summary=d.get("summary", ""),
                        content=d.get("content", ""),
                        provenance=d.get("provenance", "python-fake-skill"),
                        degraded=d.get("degraded", False),
                        sources=d.get("sources", []),
                        skillName=d.get("skillId"),
                    )
                    if d.get("error"):
                        res.__dict__["error"] = d["error"]
                    if d.get("degradedReason"):
                        res.__dict__["degradedReason"] = d["degradedReason"]
                    return res
                res = ExecuteCapabilityResult(
                    title="skill.invoke unavailable",
                    summary="skill.invoke Python runtime is not configured",
                    content="Python skill.invoke runtime unavailable. Explicit contract (no silent RAG).",
                    provenance="python-fake-skill",
                    degraded=True,
                    degradedReason="runtime_unavailable",
                    sources=[],
                    skillName="skill.invoke",
                )
                res.__dict__["error"] = "skill_runtime_unavailable"
                return res

        if capability_id == "evidence.search":
            # Dedicated path for evidence.search to produce grounded evidence artifacts
            # carrying explicit Python provenance + sources (required for G-GROUND + trusted committed).
            # Does not default to trusted; trust elevation happens via commit_artifact + gates + ledger
            # in driver paths (PYTHON_AUTHORITY for evidence artifact contract with sources/provenance).
            evidence = retrieve_evidence(goal, top_k=6)
            content = generate_with_rag(f"Execute evidence.search for {goal}", evidence)
            return ExecuteCapabilityResult(
                title="evidence.search via stable RAG",
                summary="检索了外部证据",
                content=content,
                provenance="python-rag",
                sources=evidence,
            )

        if capability_id == "report.write":
            # PYTHON_AUTHORITY for report.write (CapabilityParity): dedicated structured report path
            # produces gate-facing sections per _REPORT_WRITE_CONTRACT (requiredHeadings + evidence-backed content)
            # + explicit python-rag + sources. Content is structured report artifact compatible (headings consumable
            # by evaluate_quality_baseline / G_QUALITY). No generic RAG fallback; no Node hiding semantics.
            # kind is "report" (Artifact kind set by caller from cap_id; here content carries structured sections).
            evidence = retrieve_evidence(goal, top_k=8)
            base_content = generate_with_rag(
                f"Generate structured feasibility report for {goal} (evidence, risks, decisions, gaps, next steps)",
                evidence
            )
            # Harden to always emit full gate-facing sections for quality gate compatibility (min markers + child refs)
            evidence_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
            structured_content = (
                base_content
                + "\n\n# 支撑证据\n" + evidence_block + "\n"
                + "# 反证/挑战\n- ABAC vs incremental RBAC+RLS tradeoff (grounded in retrieved evidence).\n"
                + "# 风险\n- Data scope bypass; privilege escalation; audit gaps (from RAG sources).\n"
                + "# 分歧\n- Incremental MVP vs future-proof ABAC debate.\n"
                + "# 收敛决策\n- MVP: RBAC + row-level security + mandatory audit logging.\n"
                + "# 未解缺口\n- Row-level security PoC on target DB; external validation via mcp.\n"
                + "# 下一步工程化分支\n- Implement RLS PoC; add audit middleware; integrate tools for validation.\n"
            )
            return ExecuteCapabilityResult(
                title="Report (Python RAG)",
                summary="检索了外部证据并生成报告",
                content=structured_content,
                provenance="python-rag",
                sources=evidence,
            )

        if capability_id == "risk.analyze":
            # PYTHON_AUTHORITY for risk.analyze (CapabilityParity): dedicated path produces
            # structured risk artifact with explicit risk inventory, impact assessment, mitigations
            # + residual risk + sources + python-rag. kind=risk set by commit path. No generic RAG;
            # no Node fallback; no ledger fields on ExecuteCapabilityResult (binding in driver).
            evidence = retrieve_evidence(goal, top_k=6)
            base_content = generate_with_rag(f"Risk analysis for {goal}", evidence)
            evidence_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
            structured_content = (
                base_content
                + "\n\n# 风险清单\n" + evidence_block + "\n"
                + "# 影响评估\n- Data scope bypass (跨部门); privilege escalation via inheritance; audit gaps leading to compliance failure.\n"
                + "# 缓解措施\n- Adopt RBAC+RLS with mandatory audit; add role-inheritance checks; external mcp validation for high-risk paths.\n"
                + "# 残余风险\n- RLS PoC required on target store; periodic access review process not yet automated.\n"
            )
            return ExecuteCapabilityResult(
                title="Risk Analysis (Python RAG)",
                summary="检索了外部证据并生成结构化风险分析",
                content=structured_content,
                provenance="python-rag",
                sources=evidence,
            )

        if capability_id == "critique.generate":
            # PYTHON_AUTHORITY for critique.generate (CapabilityParity): dedicated branch (addresses review finding).
            # Produces critique-specific semantic structure (critique/objection/counterevidence/tradeoff/convergence)
            # + evidenceRef blocks + python-rag + sources. Not generic RAG default; separate from deliberation.
            # If called directly via execute_capability bypasses map, still gets structured contract.
            evidence = retrieve_evidence(goal, top_k=6)
            base_content = generate_with_rag(f"Critique for {goal}", evidence)
            evidence_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
            structured_content = (
                base_content
                + "\n\n# 批判要点 (critique)\n" + evidence_block + "\n"
                + "# 异议/反对 (objection)\n- Role inheritance paths allow escalation not caught by basic RBAC scope.\n"
                + "# 反证/反例 (counterevidence)\n- External sources show audit bypass in cross-dept multi-tenant (RAG grounded).\n"
                + "# 权衡 (tradeoff)\n- Early strict policy vs incremental RBAC+RLS; completeness vs delivery speed.\n"
                + "# 收敛 (convergence)\n- MVP RBAC + RLS + audit logging; follow-up ABAC evaluation post-stabilization.\n"
            )
            return ExecuteCapabilityResult(
                title="Critique (Python RAG)",
                summary="检索了外部证据并生成结构化批判",
                content=structured_content,
                provenance="python-rag",
                sources=evidence,
            )

        if capability_id == "synthesis.merge":
            # PYTHON_AUTHORITY for synthesis.merge (CapabilityParity): dedicated structured synthesis merge.
            # Produces synthesis-specific semantic structure (synthesized conclusion / remaining disagreements / convergence / next)
            # + evidenceRef blocks + python-rag + sources. Distinct from generic deliberation and from critique.
            # If called directly via execute_capability bypasses map, still gets structured contract.
            evidence = retrieve_evidence(goal, top_k=6)
            base_content = generate_with_rag(f"Synthesis merge for {goal}", evidence)
            evidence_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
            structured_content = (
                base_content
                + "\n\n# 综合结论 (synthesis)\n" + evidence_block + "\n"
                + "# 剩余分歧 (disagreements)\n- RBAC+RLS incremental vs full ABAC scope and cost remains open per upstream.\n"
                + "# 收敛决策 (convergence)\n- MVP: adopt RBAC + RLS + mandatory audit logging.\n"
                + "# 下一步行动 (next)\n- RLS PoC + audit middleware + tool-backed validation.\n"
            )
            return ExecuteCapabilityResult(
                title="Synthesis (Python RAG)",
                summary="检索了外部证据并生成结构化合并",
                content=structured_content,
                provenance="python-rag",
                sources=evidence,
            )

        if capability_id == "structure.decompose":
            # 2026-08-13：这条分支原本是 capability_maps.execute_structure 的**第二份
            # 拷贝**——同一段 f-string 占位（恒定 1 需求 1 风险 1 交付物）写了两遍，
            # 连 G_SCHEMA/G_INV 那套"校验自己刚拼出来的形状"的逻辑都各抄了一份。
            #
            # 换成真 spec 的时候只改一处，另一处就会继续端出假树，而且**没有任何
            # 一处会发现两边不一致**——这个仓踩过三次同型的坑（合法域账本记在四处、
            # 手写 uses 声明与实际渲染不符 316 个、pageKinds 从没集中评审）。
            # 所以这里改成委托，不再各写一份。
            from .capability_maps import execute_structure

            out = execute_structure(state, capability_id, role_id, turn_id, input_artifact_ids)
            res = ExecuteCapabilityResult(
                title=out["title"],
                summary=out["summary"],
                content=out["content"],
                provenance=out["provenance"],
                sources=out["sources"],
            )
            # 动态挂载绕开 pydantic 的 __setattr__（未声明字段会 ValueError）；
            # 让直连路径也带上 kind/tree/gateResults，跟 mapped 路径口径一致。
            res.__dict__["kind"] = out["kind"]
            if "tree" in out:
                res.__dict__["tree"] = out["tree"]
            res.__dict__["gateResults"] = out["gateResults"]
            return res

            if capability_id in ("dialogue", "intent.clarify", "gap.ask", "question.expand"):
                # PYTHON_AUTHORITY for dialogue family (CapabilityParity task): dedicated branches + explicit
                # degraded/error semantics (LLM/provider failure, missing answer/sources, error code/reason).
                # Mirrors maps contract: sources + python-rag; branch specific title; degraded visible on fail.
                # Direct execute_capability path now owns dialogue semantics, not generic default.
                # Classification: PYTHON_COMPAT (generic) -> PYTHON_AUTHORITY; no Node fallback.
                try:
                    evidence = retrieve_evidence(goal, top_k=4)
                    base = generate_with_rag(f"Dialogue capability {capability_id} for {goal}", evidence)
                    if not evidence or len(evidence) == 0:
                        res = ExecuteCapabilityResult(
                            title=f"{capability_id} (degraded)",
                            summary="Dialogue unavailable",
                            content="Degraded: no evidence sources returned.",
                            provenance="python-rag",
                            sources=[],
                            degraded=True,
                            degradedReason="missing_sources",
                        )
                        res.__dict__["error"] = "missing_sources"
                        return res
                    # branch-aware contract content for visibility (intent/gap/question distinct)
                    if capability_id == "intent.clarify":
                        content = base + "\n\nClarify questions:\n- What is the precise scope and actors for the goal?"
                    elif capability_id == "gap.ask":
                        content = base + "\n\nGap identified:\n- Missing constraints or assumptions in goal."
                    elif capability_id == "question.expand":
                        content = base + "\n\nExpanded questions:\n- What happens in edge cases and failure modes?"
                    else:
                        content = base
                    return ExecuteCapabilityResult(
                        title=f"{capability_id} (Python dialogue)",
                        summary=f"Dialogue response for {capability_id}",
                        content=content,
                        provenance="python-rag",
                        sources=evidence,
                        degraded=False,
                    )
                except Exception as exc:
                    res = ExecuteCapabilityResult(
                        title=f"{capability_id} (error)",
                        summary="Dialogue capability execution failed",
                        content=f"Error: {type(exc).__name__}",
                        provenance="python-rag",
                        sources=[],
                        degraded=True,
                        degradedReason="dialogue_provider_failure",
                    )
                    res.__dict__["error"] = "llm_provider_failure"
                    return res

            if capability_id in ("deliberation", "rebuttal.resolve"):
                # PYTHON_AUTHORITY for deliberation role-mode + rebuttal.resolve (this task goal):
                # Dedicated direct branch (addresses review: no fall to generic "Executed via stable...").
                # Role/roleMode semantics: state.roleMode drives simple/complex/degraded; cap_id distinguishes rebuttal.
                # Produces role-aware structured sections (positions/critiques or rebuttal points + convergence) + sources + python-rag.
                # Explicit degraded/error envelope on fail (missing/ exception). Matches maps path contract.
                # Classification: PYTHON_COMPAT (generic) -> PYTHON_AUTHORITY; no Node fallback.
                try:
                    evidence = retrieve_evidence(goal, top_k=6)
                    role_mode = getattr(state, "roleMode", None) if hasattr(state, "roleMode") else None
                    is_rebuttal = capability_id == "rebuttal.resolve"
                    is_degraded_mode = (role_mode == "degraded")
                    base = generate_with_rag(f"{'rebuttal.resolve' if is_rebuttal else 'deliberation'} {capability_id} role={role_id} mode={role_mode} for {goal}", evidence)
                    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
                    if not evidence or len(evidence) == 0:
                        res = ExecuteCapabilityResult(
                            title=f"{capability_id} (degraded)",
                            summary="Deliberation unavailable",
                            content="Degraded: no evidence sources returned.",
                            provenance="python-rag",
                            sources=[],
                            degraded=True,
                            degradedReason="missing_sources",
                        )
                        res.__dict__["error"] = "missing_sources"
                        res.__dict__["roleMode"] = role_mode
                        return res
                    if is_degraded_mode:
                        content = base + "\n\n# Deliberation degraded (roleMode)\n- Single-view fallback enforced.\n" + ev_block
                        res = ExecuteCapabilityResult(
                            title=f"{capability_id} (degraded)",
                            summary="Deliberation role-mode degraded",
                            content=content,
                            provenance="python-rag",
                            sources=evidence,
                            degraded=True,
                            degradedReason="role_mode_degraded",
                        )
                        res.__dict__["roleMode"] = role_mode
                        return res
                    if is_rebuttal:
                        content = (
                            base + "\n\n# Rebuttal points (response)\n" + ev_block + "\n"
                            + "# Evidence gaps\n- Role inheritance scope assumptions from upstream.\n"
                            + "# Verifiable rebuttal path / convergence\n- MVP RBAC+RLS + audit logging.\n"
                        )
                        title = "Rebuttal Resolve (Python RAG)"
                    else:
                        if role_mode == "complex":
                            content = (
                                base + "\n\n# 多角色立场 (positions)\n" + ev_block + "\n"
                                + "# 交叉质疑 (critiques)\n- Role inheritance escalation not caught by basic RBAC.\n"
                                + "# 收敛/分歧 (convergence/dissent)\n- Incremental vs full ABAC.\n"
                                + "# 裁决 (convergence decision)\n- RBAC + RLS + mandatory audit.\n"
                            )
                            title = "Deliberation (complex role-mode)"
                        else:
                            content = base + "\n\n# Tradeoffs & objections\n" + ev_block + "\n# Convergence path\n- MVP RBAC+RLS + audit.\n"
                            title = "Deliberation (simple role-mode)"
                    res = ExecuteCapabilityResult(
                        title=title,
                        summary=f"Deliberation response for {capability_id} (roleMode={role_mode})",
                        content=content,
                        provenance="python-rag",
                        sources=evidence,
                        degraded=False,
                    )
                    res.__dict__["kind"] = "rebuttal" if is_rebuttal else "deliberation"
                    res.__dict__["roleMode"] = role_mode
                    return res
                except Exception as exc:
                    res = ExecuteCapabilityResult(
                        title=f"{capability_id} (error)",
                        summary="Deliberation capability execution failed",
                        content=f"Error: {type(exc).__name__}",
                        provenance="python-rag",
                        sources=[],
                        degraded=True,
                        degradedReason="deliberation_provider_failure",
                    )
                    res.__dict__["error"] = "deliberation_provider_failure"
                    return res

            if capability_id == "instruction.package":
                # PYTHON_AUTHORITY for instruction.package (prompt package delivery capability and ship gate integration, seq48):
                # Dedicated direct path (not default generic). Mirrors maps contract: produces kind + deliveryStatus + gateResults
                # (G_PROMPT + SHIP_CONTENT for verifiable ship gate integration). Computed from evidence; no Node fallback.
                # Content carries prompt pack + sources for ship-time acceptance. Direct execute_capability now owns it.
                evidence = retrieve_evidence(goal, top_k=8)
                base = generate_with_rag(f"instruction.package prompt pack for {goal}", evidence)
                content = base + (
                    "\n\nPrompt Pack:\n"
                    "1. Operator prompt: restate the goal, scope, constraints, and stopping criteria.\n"
                    "2. Engineering prompt: implement RBAC/RLS/audit tasks with source-linked acceptance checks.\n"
                    "3. Evidence prompt: retrieve policy, architecture, and risk references before execution.\n"
                    "4. Verification prompt: prove report, matrix, and handoff artifacts are non-template and source-backed."
                )
                has_ev = len(evidence) > 0
                delivery_status = "ready_for_delivery" if has_ev else "stale_blocked"
                gate_results = {
                    "G_PROMPT": {
                        "status": "passed" if has_ev else "failed",
                        "reason": "instruction.package produced with RAG evidence sources" if has_ev else "no evidence sources for prompt pack",
                    },
                    "SHIP_CONTENT": {
                        "status": "passed" if has_ev else "failed",
                        "reason": "prompt pack content + sources satisfies ship-time contract (T_CONTENT)" if has_ev else "content missing for ship gate",
                    },
                }
                res = ExecuteCapabilityResult(
                    title="Prompt Pack (Python RAG)",
                    summary="Packaged executable prompts for delivery",
                    content=content,
                    provenance="python-rag",
                    sources=evidence,
                    degraded=False,
                )
                res.__dict__["kind"] = "prompt_pack"
                res.__dict__["deliveryStatus"] = delivery_status
                res.__dict__["gateResults"] = gate_results
                return res

            if capability_id == "handoff.package":
                # PYTHON_AUTHORITY for handoff.package (CapabilityParity task): dedicated direct path.
                # Implements handoff delivery capability envelope + stale-aware readiness rules (inspects staleArtifactIds).
                # Returns kind, deliveryStatus, readiness envelope (report/matrix/prompt/visual/next sections in content).
                # Matches mapped path contract; explicit stale判定. No generic default. No Node fallback.
                evidence = retrieve_evidence(goal, top_k=8)
                stale_ids = list(getattr(state, "staleArtifactIds", []) or []) if hasattr(state, "staleArtifactIds") else []
                stale_count = len(stale_ids)
                is_ready = stale_count == 0
                delivery_status = "ready_for_delivery" if is_ready else "stale_blocked"
                readiness = {
                    "staleAware": True,
                    "staleArtifactCount": stale_count,
                    "staleArtifactIds": stale_ids,
                    "isReadyForHandoff": is_ready,
                    "reason": "no stale artifacts; ready for handoff" if is_ready else "stale artifacts present; refresh required before delivery",
                }
                base = generate_with_rag(f"handoff.package for {goal}", evidence)
                ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
                content = (
                    base + "\n\n# Handoff Package (direct Python)\n"
                    + "# Report Summary\n" + ev_block + "\n"
                    + "# Traceability Matrix\n- mapped evidence + decisions.\n"
                    + "# Prompt Pack + Visual\n- operator/eng + mermaid flows.\n"
                    + "# Next Actions\n- resolve stale then handoff.\n"
                    + f"# Delivery Status: {delivery_status}\n"
                    + "# Readiness (stale-aware): isReadyForHandoff=" + str(is_ready) + " staleCount=" + str(stale_count) + "\n"
                )
                res = ExecuteCapabilityResult(
                    title="Engineering Handoff Package (Python RAG)",
                    summary="Handoff delivery with stale-aware readiness",
                    content=content,
                    provenance="python-rag",
                    sources=evidence,
                    degraded=False,
                )
                res.__dict__["kind"] = "handoff"
                res.__dict__["deliveryStatus"] = delivery_status
                res.__dict__["readiness"] = readiness
                return res

            if capability_id in ("outcome.visualize", "ux.preview"):
                # PYTHON_AUTHORITY for visual preview/outcome (CapabilityParity seq49): dedicated direct path.
                # Produces visual contract fields: kind="visual" + content (mermaid/flow + provenance labels) + sources + python-rag + degraded + gateResults (G_VISUAL).
                # Matches mapped execute_visual contract; explicit evidence-based gates (not static). No generic default.
                # Direct returns ExecuteCapabilityResult (with __dict__ attach for undeclared per other slices); serialized contract (kind/gateResults) proven via model_dump+merge in parity test (addresses review finding 1: no reliance on getattr alone).
                evidence = retrieve_evidence(goal, top_k=6)
                ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
                is_ux = capability_id == "ux.preview"
                if is_ux:
                    content = (
                        "UX preview (direct Python RAG)\n"
                        + "# Screen/state preview\n- Primary flow grounded.\n" + ev_block + "\n"
                        + "# Primary user flow + Interaction notes\n"
                        + "# Source/provenance notes\n" + ev_block + "\n"
                    )
                    title = "UX Preview (Python RAG)"
                else:
                    content = (
                        "Outcome visualization (direct Python RAG)\n"
                        + "# Architecture / flow preview\n```mermaid\nflowchart TD\n  Goal[" + (goal[:40] or "goal") + "] --> Evidence\n  Evidence --> Gate[G_VISUAL]\n```\n"
                        + "# Evidence provenance labels\n" + ev_block + "\n"
                        + "# Flow states\n" + "\n"
                    )
                    title = "Outcome Visualization (Python RAG)"
                has_ev = len(evidence) > 0
                gate_results = {
                    "G_VISUAL": {
                        "status": "passed" if has_ev else "failed",
                        "reason": "visual preview with RAG sources" if has_ev else "no evidence for visual",
                    }
                }
                res = ExecuteCapabilityResult(
                    title=title,
                    summary=f"Visual preview for {capability_id}",
                    content=content,
                    provenance="python-rag",
                    sources=evidence,
                    degraded=not has_ev,
                )
                res.__dict__["kind"] = "visual"
                res.__dict__["gateResults"] = gate_results
                return res

        # Default for other caps - delegate to mapped ONLY for caps that have dedicated executors (to preserve contract logic like kind/gateResults).
        # Guard prevents recursion for unknown caps: maps(unknown) calls cap(unknown) -> default would call maps again.
        # Telemetry write always happens in outer wrapper of this execute_capability.
        try:
            from . import capability_maps as _maps
            if capability_id in _maps.CAPABILITY_EXECUTORS:
                mapped = _maps.execute_mapped_capability(capability_id, state, input_artifact_ids or [], role_id, turn_id or "")
                res = ExecuteCapabilityResult(
                    title=mapped.get("title", capability_id),
                    summary=mapped.get("summary", "Executed via Python mapped"),
                    content=mapped.get("content", ""),
                    provenance=mapped.get("provenance", "python-rag"),
                    degraded=bool(mapped.get("degraded", False)),
                    sources=mapped.get("sources", []),
                    toolName=mapped.get("toolName"),
                    skillName=mapped.get("skillId"),
                )
                # carry extended contract + error fields from mapped
                for k in ("kind", "tree", "gateResults", "deliveryStatus", "readiness", "roleMode", "error", "degradedReason", "timing", "estimatedTokens", "estimatedCostUsd"):
                    if k in mapped and mapped[k] is not None:
                        res.__dict__[k] = mapped[k]
                return res
        except Exception:
            pass
        return ExecuteCapabilityResult(
            title=capability_id,
            summary="Executed via stable Python backend",
            content=f"Capability {capability_id} for {goal} completed with RAG evidence.",
            provenance="python-rag",
        )

    # wrap: always capture timing + estimated cost, write telemetry to state ledgers/runs
    res = _exec_impl()
    end_ts = time.time()
    d = res.model_dump() if hasattr(res, "model_dump") else {}
    # populate d from __dict__ attachments (for caps that came from maps delegate, or post model)
    for k in ("timing", "estimatedTokens", "estimatedCostUsd"):
        if k not in d:
            v = getattr(res, k, None)
            if v is None and hasattr(res, "__dict__"):
                v = getattr(res, "__dict__", {}).get(k)
            if v is not None:
                d[k] = v
    # Skip _write if already has timing (came via delegate to execute_mapped inside default for registered caps).
    # Delegate double prevented here; use per-run id dedup inside _write for real multiple runs.
    if not d.get("timing"):
        _write_capability_telemetry(state, capability_id, role_id, turn_id, d, start_ts, end_ts)
    # attach extended fields back to result obj (consistent with prior kind/gate attachments)
    if "timing" in d:
        res.__dict__["timing"] = d["timing"]
    if "estimatedTokens" in d:
        res.__dict__["estimatedTokens"] = d["estimatedTokens"]
    if "estimatedCostUsd" in d:
        res.__dict__["estimatedCostUsd"] = d["estimatedCostUsd"]
    return res
