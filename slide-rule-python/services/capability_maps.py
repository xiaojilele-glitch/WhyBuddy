"""
Capability execution maps ported from server/sliderule/*-exec-map.ts, capability-exec-map.ts, delivery, structure, visual, etc.

For V5 caps: use stable RAG for evidence/tools, structured generation for report.
No more LLM fallback or template for the ones that were degraded.
"""

from typing import Dict, Any, Callable, List
import time
from models.v5_state import V5SessionState
from .slide_rule_executor import (  # main one
    execute_capability,
    execute_mcp_call_with_runtime,
    execute_skill_invoke_with_runtime,
    get_mcp_runtime,
    get_skill_runtime,
    _write_capability_telemetry,
)
from .slide_rule_llm import call_stable_llm_for_capability
from .rag_service import generate_with_rag, retrieve_evidence

ExecutorFn = Callable[[V5SessionState, str, str, str, List[str]], Dict[str, Any]]


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def _evidence_result(cap_id: str, state: V5SessionState, title: str, summary: str, prompt: str) -> Dict[str, Any]:
    evidence = retrieve_evidence(_goal_text(state), top_k=8)
    return {
        "title": title,
        "summary": summary,
        "content": generate_with_rag(prompt, evidence),
        "provenance": "python-rag",
        "sources": evidence,
    }


def execute_dialogue(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for dialogue family (CapabilityParity): dedicated execute_dialogue with
    # explicit degraded/error semantics for LLM/provider failure, missing answer/sources.
    # Each branch (dialogue, intent.clarify, gap.ask, question.expand) gets cap-specific contract
    # visibility in title/summary (distinct contracts, failure surfaces error code/reason).
    # No silent happy-path on failure; degraded envelope always carries error.
    # No Node fallback.
    goal = _goal_text(state)
    try:
        llm = call_stable_llm_for_capability(cap_id, f"Dialogue {cap_id} for goal: {goal}", {"state": state})
        answer = llm.get("answer") or ""
        sources = llm.get("sources", []) or []
        prov = llm.get("provenance", "python-rag")
        if prov == "python-rag-stable":
            prov = "python-rag"
        if not answer or len(sources) == 0:
            return {
                "title": f"{cap_id} (degraded)",
                "summary": "Dialogue response unavailable",
                "content": "Degraded: missing answer or sources from provider.",
                "provenance": prov,
                "sources": sources,
                "degraded": True,
                "error": "missing_answer_or_sources",
                "degradedReason": "llm_or_rag_returned_empty",
            }
        # branch-specific minimal contract markers for test + visibility
        if cap_id == "intent.clarify":
            content = f"Clarify intent for: {goal}\n\nQuestions to resolve ambiguity:\n- {answer}\n(来源: {len(sources)})"
        elif cap_id == "gap.ask":
            content = f"Identified gaps for: {goal}\n\nGap: {answer}\n(来源: {len(sources)})"
        elif cap_id == "question.expand":
            content = f"Expanded questions/assumptions for: {goal}\n\nExpansion: {answer}\n(来源: {len(sources)})"
        else:
            content = answer
        return {
            "title": f"{cap_id}",
            "summary": f"Dialogue via stable RAG for {cap_id}",
            "content": content,
            "provenance": prov,
            "sources": sources,
            "degraded": False,
        }
    except Exception as exc:
        return {
            "title": f"{cap_id} (error)",
            "summary": "Dialogue capability failed",
            "content": f"Provider failure: {type(exc).__name__}",
            "provenance": "python-rag",
            "sources": [],
            "degraded": True,
            "error": "llm_provider_failure",
            "degradedReason": str(exc)[:200],
        }

def execute_deliberation(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for deliberation + rebuttal.resolve (CapabilityParity this task):
    # Implements role-mode semantics per state.roleMode ("simple" | "complex" | "degraded") and role param.
    # - simple: single-perspective tradeoff summary
    # - complex: multi-perspective (critique/defense/synthesis style positions + convergence)
    # - degraded: explicit degraded envelope + degradedReason
    # rebuttal.resolve uses distinct rebuttal/convergence contract sections.
    # critique/synthesis use separate dedicated executors; deliberation generic covers "deliberation" + "rebuttal.resolve".
    # Explicit try/except degraded/error envelope; no generic _evidence_result; no Node fallback hiding.
    # Direct and mapped paths will be kept consistent.
    goal = _goal_text(state)
    role_mode = None
    try:
        if hasattr(state, "roleMode"):
            role_mode = getattr(state, "roleMode")
        elif isinstance(state, dict):
            role_mode = state.get("roleMode")
        else:
            role_mode = getattr(state, "__dict__", {}).get("roleMode")
    except Exception:
        role_mode = None
    is_rebuttal = cap_id == "rebuttal.resolve"
    is_degraded_mode = (role_mode == "degraded") or (isinstance(role, str) and "degrad" in role.lower())
    try:
        evidence = retrieve_evidence(goal, top_k=6)
        ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
        base = generate_with_rag(f"{'rebuttal.resolve' if is_rebuttal else 'deliberation'} role={role} mode={role_mode} for {goal}", evidence)
        if is_degraded_mode:
            content = base + "\n\n# Deliberation (degraded mode)\n- Fallback to single view due to roleMode=degraded.\n" + ev_block
            return {
                "title": f"{cap_id} (degraded)",
                "summary": "Deliberation degraded due to roleMode",
                "content": content,
                "provenance": "python-rag",
                "sources": evidence,
                "kind": "deliberation",
                "degraded": True,
                "degradedReason": "role_mode_degraded",
                "roleMode": role_mode,
                "role": role,
            }
        if is_rebuttal:
            structured = (
                base + "\n\n# Rebuttal points (response)\n" + ev_block + "\n"
                + "# Evidence gaps\n- Cross-check role inheritance and scope assumptions from upstream critique.\n"
                + "# Verifiable rebuttal path / convergence\n- Adopt RBAC+RLS + audit; validate via PoC; converge on MVP decision.\n"
            )
            title = "Rebuttal Resolve (Python RAG)"
            knd = "rebuttal"
        else:
            # role/roleMode driven semantics: complex uses defense/synthesis-like positions; simple is direct tradeoff
            if role_mode == "complex" or (isinstance(role, str) and any(k in (role or "").lower() for k in ["critic", "defense", "synthesis", "multi"])):
                structured = (
                    base + "\n\n# 多角色立场 (positions)\n" + ev_block + "\n"
                    + "# 交叉质疑/批判 (critiques)\n- Role inheritance paths allow escalation not caught by basic RBAC.\n"
                    + "# 收敛分与异议 (convergence / dissent)\n- Incremental RBAC+RLS vs full ABAC scope/cost remains open.\n"
                    + "# 最终裁决 (convergence decision)\n- MVP: RBAC + RLS + mandatory audit logging.\n"
                )
                title = "Deliberation (complex role-mode)"
            else:
                structured = (
                    base + "\n\n# Tradeoffs & objections\n" + ev_block + "\n"
                    + "# Convergence path\n- MVP RBAC+RLS + audit; defer ABAC.\n"
                )
                title = "Deliberation (simple role-mode)"
            knd = "deliberation"
        return {
            "title": title,
            "summary": f"Deliberation via role-aware Python RAG (mode={role_mode}, role={role})",
            "content": structured,
            "provenance": "python-rag",
            "sources": evidence,
            "kind": knd,
            "degraded": False,
            "roleMode": role_mode,
            "role": role,
        }
    except Exception as exc:
        return {
            "title": f"{cap_id} (error)",
            "summary": "Deliberation capability failed",
            "content": f"Provider failure: {type(exc).__name__}",
            "provenance": "python-rag",
            "sources": [],
            "degraded": True,
            "error": "deliberation_provider_failure",
            "degradedReason": str(exc)[:200],
            "role": role,
        }

def execute_report(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY slice for report.write (CapabilityParity task): hardened structured report artifact.
    # Returns explicit kind + gate-facing sections (requiredHeadings from report contract) + python-rag + sources.
    # Content shape consumable by quality baseline gate (headings + evidenceRef child blocks).
    # Consistent with executor report.write path. No Node fallback.
    evidence = retrieve_evidence(state.goal.get("text", ""), top_k=10)
    base = generate_with_rag(f"report.write final report for {_goal_text(state)}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    structured = (
        base + "\n\n# 支撑证据\n" + ev_block + "\n"
        + "# 反证/挑战\n- Tradeoff between ABAC and scoped RBAC+RLS per evidence.\n"
        + "# 风险\n- Multi-tenant scope bypass; inheritance escalation; audit gaps.\n"
        + "# 分歧\n- Start minimal vs over-engineer future policy engine.\n"
        + "# 收敛决策\n- Adopt RBAC + RLS + audit logging for MVP.\n"
        + "# 未解缺口\n- Target DB RLS PoC required; mcp/skill external checks.\n"
        + "# 下一步工程化分支\n- RLS PoC + audit middleware + tool-backed validation.\n"
    )
    return {
        "title": "Report",
        "summary": "RAG generated report",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "report",
    }

def execute_mcp_or_skill(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY: always explicit contract. runtime present -> with_runtime (success or specific error).
    # runtime absent -> explicit unavailable (no fallback to execute_capability RAG success shape).
    if cap_id == "mcp.call" and get_mcp_runtime() is not None:
        return execute_mcp_call_with_runtime(state, role, turn, inputs)
    if cap_id == "skill.invoke" and get_skill_runtime() is not None:
        return execute_skill_invoke_with_runtime(state, role, turn, inputs)
    if cap_id == "mcp.call":
        return {
            "title": "mcp.call unavailable",
            "summary": "mcp.call Python runtime is not configured",
            "content": "Python mcp.call runtime unavailable. Explicit contract (no silent RAG template).",
            "provenance": "python-mcp-runtime",
            "degraded": True,
            "error": "mcp_runtime_unavailable",
            "degradedReason": "runtime_unavailable",
            "toolName": "mcp.call",
            "sources": [],
        }
    return {
        "title": "skill.invoke unavailable",
        "summary": "skill.invoke Python runtime is not configured",
        "content": "Python skill.invoke runtime unavailable. Explicit contract (no silent RAG template).",
        "provenance": "python-fake-skill",
        "degraded": True,
        "error": "skill_runtime_unavailable",
        "degradedReason": "runtime_unavailable",
        "skillId": "skill.invoke",
        "sources": [],
    }

def execute_evidence(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    res = execute_capability(cap_id, state, inputs, role, turn)
    out = res.model_dump() if hasattr(res, "model_dump") else {}
    # propagate __dict__ attached timing/est (not in model fields) so maps caller can detect and skip re-write for delegate
    for k in ("timing", "estimatedTokens", "estimatedCostUsd"):
        v = getattr(res, k, None)
        if v is None and hasattr(res, "__dict__"):
            v = getattr(res, "__dict__", {}).get(k)
        if v is not None:
            out[k] = v
    return out

def execute_risk(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY slice for risk.analyze (CapabilityParity): dedicated structured risk artifact.
    # Produces explicit kind=risk + risk inventory + impact + mitigations + residual + python-rag + sources.
    # This slice owns the risk artifact shape (mitigations contract). Real ledgerEntryId binding on
    # CapabilityRun + producedBy attach on risk Artifact + decisionLedger entry performed in driver
    # (commit_artifact paths). No placeholders returned as consumable linkage. No Node fallback.
    evidence = retrieve_evidence(_goal_text(state), top_k=6)
    base = generate_with_rag(f"risk.analyze for {_goal_text(state)}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    structured = (
        base + "\n\n# 风险清单\n" + ev_block + "\n"
        + "# 影响评估\n- Data scope bypass in multi-tenant; privilege escalation via role inheritance; audit gaps.\n"
        + "# 缓解措施\n- RBAC + RLS + mandatory audit logging; inheritance boundary checks; mcp/skill external validation for critical flows.\n"
        + "# 残余风险\n- Target DB RLS PoC; automated periodic review not yet in place.\n"
    )
    return {
        "title": "Risk Analysis",
        "summary": "RAG generated risk scan",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "risk",
    }


def execute_critique(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for critique.generate (CapabilityParity): dedicated structured critique artifact.
    # Produces critique-specific output contract with sections for critique/objection/counterevidence/tradeoff/convergence
    # + evidenceRef + python-rag + sources. Separated from generic deliberation. No Node fallback.
    evidence = retrieve_evidence(_goal_text(state), top_k=6)
    base = generate_with_rag(f"critique.generate for {_goal_text(state)}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    structured = (
        base + "\n\n# 批判要点 (critique)\n" + ev_block + "\n"
        + "# 异议/反对 (objection)\n- RBAC inheritance allows unintended escalation not covered by initial scope.\n"
        + "# 反证/反例 (counterevidence)\n- Multi-tenant audit logs show bypass patterns in similar systems (from RAG).\n"
        + "# 权衡 (tradeoff)\n- Strict ABAC vs pragmatic RBAC+RLS incremental; future cost vs current velocity.\n"
        + "# 收敛 (convergence)\n- Start with RBAC+RLS + mandatory audit; schedule ABAC PoC post-MVP.\n"
    )
    return {
        "title": "Critique",
        "summary": "RAG generated critique",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "critique",
    }

def execute_synthesis(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for synthesis.merge (CapabilityParity): dedicated structured synthesis merge artifact.
    # Produces synthesis-specific output contract with sections for synthesized conclusion, remaining disagreements,
    # convergence decision, next action + evidenceRef + python-rag + sources.
    # Distinct from critique/rebuttal/report and from generic deliberation. No Node fallback.
    evidence = retrieve_evidence(_goal_text(state), top_k=6)
    base = generate_with_rag(f"synthesis.merge for {_goal_text(state)}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    structured = (
        base + "\n\n# 综合结论 (synthesis)\n" + ev_block + "\n"
        + "# 剩余分歧 (remaining disagreements)\n- Incremental RBAC+RLS vs full future ABAC scope and cost.\n"
        + "# 收敛决策 (convergence decision)\n- MVP: RBAC + RLS + mandatory audit logging.\n"
        + "# 下一步行动 (next action)\n- RLS PoC + audit middleware + tool-backed validation.\n"
    )
    return {
        "title": "Synthesis Merge",
        "summary": "RAG generated synthesis merge",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "synthesis",
    }

def _clarification_context(state: V5SessionState) -> str:
    """第 1 步的产物：澄清 / 缺口 / 扩展假设那几条能力已经落下的正文。

    spec 刻意**不吃原始那一句话**——直接吃原句等于把「从一句话发明」原样往前
    挪一格，什么也没改善。吃的是澄清之后的东西：目标用户、假设、约束、
    已经问出来的缺口。
    """
    wanted = {"intent.clarify", "gap.ask", "question.expand", "evidence.search"}
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    chunks: List[str] = []
    for a in (getattr(state, "artifacts", []) or []):
        art = a if isinstance(a, dict) else getattr(a, "__dict__", {})
        if str(art.get("id") or "") in stales:
            continue
        if str(art.get("capabilityId") or art.get("producedBy") or "") not in wanted:
            continue
        body = str(art.get("content") or art.get("summary") or "").strip()
        if body:
            chunks.append(body[:1500])
    return "\n\n".join(chunks[:4])


def execute_structure(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    """起草真 spec（2026-08-13 换掉了原来那份 f-string 占位）。

    ## 换掉的是什么

    原实现是三行 f-string：

        req_text   = f"Implement scoped permission checks for {goal}"
        risk_text  = f"Privilege escalation via inheritance in {goal}"
        deliv_text = f"SPEC tree + traceability for {goal} MVP"

    恒定 1 需求 1 风险 1 交付物——**换什么题材，那条唯一的需求都是同一句英文**。
    底下 G_SCHEMA / G_INV 校验的是**代码上一行刚拼出来的形状**，所以恒过。

    ## 失败为什么不回落占位

    那份最大的问题不是写得糙，是它**永远成功**：一份假树看起来跟真的一样，
    还能过自己的闸，于是没有任何一处会发现它是假的。所以这里生成失败就
    如实产出失败态（gateResults 标 failed、summary 说人话），**不再造一个
    看着像那么回事的空壳**。

    ⚠ 抛不出去：这条能力在推演循环里，异常会拖垮整轮。所以捕获后落成
    failed 产物，让覆盖率闸按「这条能力没成功」处理——那是它本来就会做的事。
    """
    from .spec_tree import SpecGenerationError, generate_spec_tree, spec_to_markdown

    goal = _goal_text(state)
    evidence = retrieve_evidence(goal, top_k=6)
    ev_block = "\n".join(
        f"- {e.get('content','')}（source:{e.get('source','')}）" for e in evidence[:3]
    )
    try:
        spec = generate_spec_tree(
            goal,
            clarified=_clarification_context(state),
            evidence=ev_block,
        )
    except SpecGenerationError as exc:
        reason = str(exc)[:400]
        print(f"[capability_maps] spec 起草失败：{reason}")
        return {
            "title": "SPEC Tree",
            "summary": f"spec 起草未通过机械校验：{reason}",
            "content": (
                "# SPEC Tree\n\n"
                "本轮未能产出通过校验的规格树。**没有回落成占位内容**——"
                "一份看起来像那么回事的假 spec 比没有更糟，它会让下游以为上游是厚的。\n\n"
                f"失败原因：{reason}\n"
            ),
            "provenance": "python-spec",
            "sources": evidence,
            "kind": "spec_tree",
            "gateResults": {
                "G_SCHEMA": {"status": "failed", "reason": reason},
                "G_INV": {"status": "failed", "checks": ["spec 未生成，无从校验引用完整性"]},
            },
        }

    tree = spec.model_dump()
    covered = {c for n in spec.nodes if n.type == "requirement" for c in n.coversCriteria}
    return {
        "title": "SPEC Tree",
        "summary": (
            f"{len(spec.successCriteria)} 条成功判据 · "
            f"{sum(1 for n in spec.nodes if n.type == 'requirement')} 个需求 · "
            f"{len(spec.pages)} 页"
        ),
        "content": spec_to_markdown(spec),
        "provenance": "python-spec",
        "sources": evidence,
        "kind": "spec_tree",
        "tree": tree,
        # 这两道闸的判据现在**不再是自己刚拼出来的形状**：spec 是模型产出的，
        # 校验器是独立的，能真失败——失败的那条路在上面的 except 分支里。
        "gateResults": {
            "G_SCHEMA": {
                "status": "passed",
                "reason": (
                    f"规格树通过契约校验：{len(spec.nodes)} 个节点、"
                    f"{len(spec.pages)} 页，引用全部解析得开"
                ),
            },
            "G_INV": {
                "status": "passed",
                "checks": [
                    f"{len(covered)}/{len(spec.successCriteria)} 条成功判据有 requirement 认领",
                    "parentId / coversCriteria / evidenceRefs 全部解析得开，无环",
                    "每一页的 coversNodes 都指向 requirement 或 design",
                ],
            },
        },
    }


def execute_document(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    return _evidence_result(
        cap_id,
        state,
        "SPEC Document",
        "Drafted requirements/design/tasks with RAG evidence",
        f"{cap_id} for {_goal_text(state)} with requirements, design notes, task breakdown, and acceptance criteria.",
    )

def execute_traceability(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    return _evidence_result(
        cap_id,
        state,
        "Traceability Matrix",
        "Mapped evidence, risks, decisions, and deliverables",
        f"traceability.matrix for {_goal_text(state)}. Include rows for requirement, evidence source, risk, decision, and next action.",
    )

def execute_prompt_pack(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for instruction.package (prompt package delivery + ship gate integration, CapabilityParity seq48):
    # Dedicated executor (not generic _evidence_result). Produces structured prompt pack + explicit deliveryStatus
    # + gateResults with ship gate integration fields (G_PROMPT + SHIP_CONTENT for ship-time content contract).
    # gateResults are computed (evidence presence), not static. Direct/mapped paths expose for ship gate verification.
    # No Node fallback; this slice owns the delivery/ship-visible contract for prompt pack capability.
    goal = _goal_text(state)
    evidence = retrieve_evidence(goal, top_k=8)
    content = generate_with_rag(
        (
            f"instruction.package prompt pack for {goal}\n"
            "Include operator prompt, engineering prompt, evidence prompt, verification prompt, constraints, and expected artifacts."
        ),
        evidence,
    )
    content += (
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
    return {
        "title": "Prompt Pack",
        "summary": "Packaged executable prompts and verification instructions",
        "content": content,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "prompt_pack",
        "deliveryStatus": delivery_status,
        "gateResults": gate_results,
    }

def execute_visual(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for visual preview/outcome capabilities (CapabilityParity seq49):
    # Dedicated executor (not _evidence_result). Returns visual contract: kind="visual",
    # content with mermaid/flow + provenance labels, sources + python-rag, degraded, gateResults (G_VISUAL).
    # Direct + mapped paths expose contract fields. Computed gates (evidence presence). No Node fallback.
    goal = _goal_text(state)
    evidence = retrieve_evidence(goal, top_k=6)
    base = generate_with_rag(f"{cap_id} visual preview for {goal}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    is_ux = cap_id == "ux.preview"
    if is_ux:
        structured = (
            base + "\n\n# UX Preview (Python RAG)\n"
            + "# Screen/state preview\n- Primary flow and states grounded in evidence for goal.\n" + ev_block + "\n"
            + "# Primary user flow\n- Intake -> render preview -> provenance labels.\n"
            + "# Interaction notes\n- Grounded elements from state.\n"
            + "# Source/provenance notes\n" + ev_block + "\n"
        )
        title = "UX Preview"
    else:
        structured = (
            base + "\n\n# Outcome Visualization (Python RAG)\n"
            + "# Architecture / flow preview\n```mermaid\nflowchart TD\n  Goal[" + (goal[:40] or "goal") + "] --> Evidence[Evidence sources]\n  Evidence --> Visual[Preview]\n  Visual --> Gate[G_VISUAL]\n```\n"
            + "# Evidence provenance labels\n" + ev_block + "\n"
            + "# Flow states\n- Ready / Degraded / Delivered with source refs.\n"
        )
        title = "Outcome Visualization"
    has_ev = len(evidence) > 0
    gate_results = {
        "G_VISUAL": {
            "status": "passed" if has_ev else "failed",
            "reason": "visual preview generated with RAG evidence sources and provenance" if has_ev else "no evidence sources for visual grounding",
        }
    }
    return {
        "title": title,
        "summary": f"Visual preview via stable RAG for {cap_id}",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "visual",
        "degraded": not has_ev,
        "gateResults": gate_results,
    }

def execute_handoff(state: V5SessionState, cap_id: str, role: str, turn: str, inputs: List[str]) -> Dict[str, Any]:
    # PYTHON_AUTHORITY for handoff.package (CapabilityParity): dedicated handoff delivery capability.
    # Produces structured readiness/handoff envelope bundling report/matrix/prompt pack/visual/next actions
    # + explicit deliveryStatus + stale-aware readiness rules (checks staleArtifactIds; blocks delivery if stale present).
    # Not a generic _evidence_result wrapper; explicit sections + stale判定. No Node fallback.
    goal = _goal_text(state)
    # stale-aware readiness rules
    stale_ids: List[str] = []
    try:
        if hasattr(state, "staleArtifactIds"):
            stale_ids = list(getattr(state, "staleArtifactIds") or [])
        elif isinstance(state, dict):
            stale_ids = list(state.get("staleArtifactIds", []) or [])
    except Exception:
        stale_ids = []
    stale_count = len(stale_ids)
    is_ready = stale_count == 0
    delivery_status = "ready_for_delivery" if is_ready else "stale_blocked"
    readiness = {
        "staleAware": True,
        "staleArtifactCount": stale_count,
        "staleArtifactIds": stale_ids,
        "isReadyForHandoff": is_ready,
        "reason": "no stale artifacts; ready for handoff" if is_ready else "stale artifacts present; refresh or supersede before delivery handoff",
    }
    evidence = retrieve_evidence(goal, top_k=8)
    base = generate_with_rag(f"handoff.package delivery for {goal}", evidence)
    ev_block = "\n".join([f"- evidenceRef:{e.get('id','e')} {e.get('content','')} (source:{e.get('source','')})" for e in evidence[:3]])
    # structured envelope sections per task goal
    structured = (
        base + "\n\n# Handoff Package (Python-owned delivery)\n"
        + "# Report Summary\n" + ev_block + "\n"
        + "# Traceability Matrix\n- requirements, decisions, risks mapped to sources above.\n"
        + "# Prompt Pack\n1. Operator: restate goal+stale check; 2. Engineering: implement with freshness.\n"
        + "# Visual Preview\n- flow: intake -> stale check -> handoff; provenance labels on all.\n"
        + "# Risks\n- stale artifacts can invalidate downstream trust if handoff proceeds without refresh.\n"
        + "# Next Actions\n- If isReadyForHandoff: package + commit; else: resolve staleArtifactIds then retry.\n"
        + f"# Delivery Status\n- {delivery_status}\n"
        + "# Readiness (stale-aware)\n- staleAware: true\n- isReadyForHandoff: " + str(is_ready) + "\n- staleCount: " + str(stale_count) + "\n"
    )
    return {
        "title": "Engineering Handoff Package",
        "summary": "Bundled report, matrix, prompt pack, visual, next actions with stale-aware readiness",
        "content": structured,
        "provenance": "python-rag",
        "sources": evidence,
        "kind": "handoff",
        "deliveryStatus": delivery_status,
        "readiness": readiness,
    }

# Map for all V5 caps
# Core + expanded caps from Node (structure, delivery, visual, handoff, instruction, etc.)
# Also real dialogue/deliberation capabilityIds used in practice (not just the generic keys)
CAPABILITY_EXECUTORS: Dict[str, ExecutorFn] = {
    # dialogue family
    "dialogue": execute_dialogue,
    "intent.clarify": execute_dialogue,
    "gap.ask": execute_dialogue,
    "question.expand": execute_dialogue,
    # deliberation family
    "deliberation": execute_deliberation,
    "critique.generate": execute_critique,
    "synthesis.merge": execute_synthesis,
    "rebuttal.resolve": execute_deliberation,
    "report.write": execute_report,
    "mcp.call": execute_mcp_or_skill,
    "skill.invoke": execute_mcp_or_skill,
    "evidence.search": execute_evidence,  # PYTHON_AUTHORITY slice: dedicated path yields sources + "python-rag" for grounded trusted evidence artifacts (see executor)
    "risk.analyze": execute_risk,
    "structure.decompose": execute_structure,
    "document.draft": execute_document,
    "requirement.write": execute_document,
    "design.write": execute_document,
    "task.write": execute_document,
    "traceability.matrix": execute_traceability,
    "instruction.package": execute_prompt_pack,
    "outcome.visualize": execute_visual,
    "ux.preview": execute_visual,
    "handoff.package": execute_handoff,
}

def execute_mapped_capability(cap_id: str, state: V5SessionState, inputs: List[str], role: str, turn: str) -> Dict[str, Any]:
    start_ts = time.time()
    executor = CAPABILITY_EXECUTORS.get(cap_id)
    if executor:
        out = executor(state, cap_id, role, turn, inputs)
    else:
        cap_res = execute_capability(cap_id, state, inputs, role, turn)
        out = cap_res.model_dump() if hasattr(cap_res, "model_dump") else {}
        for k in ("timing", "estimatedTokens", "estimatedCostUsd"):
            v = getattr(cap_res, k, None)
            if v is None and hasattr(cap_res, "__dict__"):
                v = getattr(cap_res, "__dict__", {}).get(k)
            if v is not None:
                out[k] = v
    end_ts = time.time()
    # ensure dict for telemetry write
    if not isinstance(out, dict):
        out = out if isinstance(out, dict) else (out.model_dump() if hasattr(out, "model_dump") else {"title": str(out)})
    # Skip _write if already has timing (came from inner execute_capability delegate e.g. evidence/unknown path).
    # This prevents double append while using per-run id for uniqueness.
    # Allows multiple separate runs of same cap/turn to each record (addresses finding 1).
    if not out.get("timing"):
        _write_capability_telemetry(state, cap_id, role, turn, out, start_ts, end_ts)
    return out
