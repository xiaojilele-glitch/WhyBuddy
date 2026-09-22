"""
Coverage/GCOV ported from shared/blueprint/sliderule-coverage-gate.ts .

Python owns required capability authoring + gate evaluation for V5.2 GCOV.
Exact port of simple/complex/game rules and hasTrustedCommittedForCap (capabilityRuns + producedBy + gated_pass/audited + !stale).

Classification for sliderule-python-v52-gcov-stale-artifact-block-105:
TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
Python owns blocking of stale artifacts (via staleArtifactIds OR artifact.stale OR artifact.status=="stale")
from satisfying has_trusted_committed_for_cap, has_grounded_external_evidence, count_grounded_trusted_artifacts and coverage gate.
No Node fallback; direct Python enforcement.

Classification for sliderule-python-v52-trust-gate-grounding-105:
Current behavior before this task: PYTHON_COMPAT (is_grounded_evidence_artifact only checked external provenance type; no non-empty content or sources requirement).
After: PYTHON_AUTHORITY (external provenance evidence must have non-empty content/summary AND traceable sources via sources/payload.sources/url/citations/source; _has_nonempty_content and _has_traceable_source helpers added (evidenceSource not treated as traceable source); legacy F1/F2 paths also gated by nonempty; is_grounded/have/count/evaluate now enforce; negative tests prove rejection including evidenceSource label alone; no Node fallback).
Python owns G-GROUND external evidence + sources + non-empty content checks.

Classification for sliderule-python-v52-trust-provenance-ledger-105 (review fix 2):
Current: PYTHON_COMPAT (has_trusted_committed_for_cap checked only producedBy + trustLevel + !stale; ledger helpers existed but standalone/not consulted; no-ledger gated artifacts could satisfy).
After: PYTHON_COMPAT (has_trusted_committed_for_cap now requires has_provenance_and_trust_ledger from slide_rule_trust; missing ledger blocks trusted committed for coverage/GCOV even with producedBy+gated_pass+!stale; commit helper forces record in exercised paths; direct tests prove no-ledger blocks gate. Full durable field + exhaustive wiring of all construct sites deferred (blocker recorded in status); no overclaim of PYTHON_AUTHORITY. No Node fallback.
Python provides ledger requirement enforcement in trusted committed gate for this slice.

Classification for sliderule-python-v52-gcov-put-boundary-tests-105:
Current behavior before: TS_RUNTIME_OWNED (N1 PUT GCOV ledger-only recompute: buildGcovAuthoritativeStateForPut/emptyGcovLedgerShell/sanitizeGoalStatusOnPut lived exclusively in shared/blueprint/sliderule-coverage-gate.ts; Python evaluate_coverage_gate accepted whatever state was passed, allowing potential client-forged capabilityRuns/artifacts/coverageGate to influence gate on PUT path).
After: PYTHON_COMPAT (slide_rule_coverage owns _empty_gcov_ledger_shell + build_gcov_authoritative_state_for_put + sanitize_goal_status_on_put with direct focused pytest proving ledger-only base for recompute + clear guard; however the actual PUT handler path (save) still uses general field exclusion/merge from server load without invoking sanitize_goal_status_on_put; no claim that real PUT sanitization recomputes coverage from server ledger only until call-site wiring). Precise blocker recorded in status: route/service call site not present; rescue patch boundary is explicit call inside PUT save after loading previous server ledger. No Node fallback; smallest slice + tests delivered in allowed scope; ownership of full PUT sanitization recompute boundary deferred.
Python provides the dedicated recompute helper contract for this TrustGcov slice.
"""

from typing import Any, Dict, List, Optional
import re
from datetime import datetime
from models.v5_state import V5SessionState
from services.slide_rule_trust import has_provenance_and_trust_ledger


def _get_list(obj: Any, key: str) -> List[Any]:
    if isinstance(obj, dict):
        return obj.get(key) or []
    val = getattr(obj, key, None)
    return val or []


def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _get_stable_key(g: Any) -> str:
    """Stable key for gap status carry across reconcile, matches TS: cap:ID for capability gaps, 'ev' for missing_evidence."""
    cap = _get_attr(g, "requiredCapabilityId")
    if cap:
        return f"cap:{cap}"
    if _get_attr(g, "kind") == "missing_evidence":
        return "ev"
    return _get_attr(g, "id") or ""


def _is_stale_artifact(artifact: Any, stales: set) -> bool:
    """Block if id in staleArtifactIds list OR per-artifact stale marker or status=stale.
    This enforces the task goal: stale artifacts (via either mechanism) must not satisfy
    trusted committed, grounded evidence or coverage gates.
    """
    aid = _get_attr(artifact, "id")
    if aid in stales:
        return True
    if bool(_get_attr(artifact, "stale", False)):
        return True
    status = _get_attr(artifact, "status", "active") or "active"
    if status == "stale":
        return True
    return False


def _is_healthy_artifact(artifact: Any, stales: set) -> bool:
    tl = _get_attr(artifact, "trustLevel")
    return (tl in ("gated_pass", "audited")) and not _is_stale_artifact(artifact, stales)


def _has_nonempty_content(art: Any) -> bool:
    """Require non-empty content or summary for grounded evidence per task (external evidence + sources + non-empty content)."""
    c = (_get_attr(art, "content") or "").strip()
    s = (_get_attr(art, "summary") or "").strip()
    return bool(c or s)


def _has_traceable_source(art: Any) -> bool:
    """Require traceable source fields: sources list (top or payload), url, citations, or source.
    evidenceSource (legacy label) is NOT treated as a traceable source to prevent only-type-label external evidence from passing.
    This enforces the sources part of G-GROUND for external evidence (review fix for minor finding).
    """
    # top-level sources (as used in some driver dict paths)
    srcs = _get_attr(art, "sources")
    if srcs and isinstance(srcs, (list, tuple)) and len(srcs) > 0:
        return True
    if srcs and not isinstance(srcs, (list, tuple)) and srcs:
        return True
    for k in ("source", "url", "citation", "citations"):
        v = _get_attr(art, k)
        if v and (not isinstance(v, (list, tuple)) or len(v) > 0):
            return True

    payload = _get_attr(art, "payload") or {}
    if isinstance(payload, dict):
        p_srcs = payload.get("sources")
        if p_srcs and isinstance(p_srcs, (list, tuple)) and len(p_srcs) > 0:
            return True
        if p_srcs and not isinstance(p_srcs, (list, tuple)) and p_srcs:
            return True
        if payload.get("source") or payload.get("url") or payload.get("citations"):
            return True
        # deliberately do not treat bare evidenceSource as traceable source (labels like F1/F2 or '会话内综合' are not sufficient)
    return False


def has_trusted_committed_for_cap(state: Any, cap_id: str) -> bool:
    """Port of TS hasTrustedCommittedForCap + ledger enforcement: capabilityRuns + producedBy + healthy + has_provenance_and_trust_ledger.

    Ledger marker required for trusted committed (per task). Missing ledger (even with producedBy+gated+!stale)
    blocks recognition in gate (addresses review). Record via commit helper in exercised paths; direct paths
    without record do not satisfy has_trusted. Full every-committed enforcement deferred (blocker).
    """
    runs = _get_list(state, "capabilityRuns")
    arts = _get_list(state, "artifacts")
    stales = set(_get_list(state, "staleArtifactIds"))
    for run in runs:
        if _get_attr(run, "capabilityId") != cap_id:
            continue
        run_id = _get_attr(run, "id")
        for art in arts:
            prod = _get_attr(art, "producedBy")
            prod_run = None
            if isinstance(prod, dict):
                prod_run = prod.get("capabilityRunId")
            elif prod is not None:
                prod_run = _get_attr(prod, "capabilityRunId")
            aid = _get_attr(art, "id")
            if prod_run == run_id and _is_healthy_artifact(art, stales) and has_provenance_and_trust_ledger(state, aid):
                return True
    return False


def is_external_grounding_provenance(provenance: Optional[str]) -> bool:
    return provenance in (
        "mcp:github",
        "web:search",
        "repo:static",
        "rendered_chart_mcp",
        "rendered_screenshot",
        "python-rag",  # Python RAG authority equivalent for external evidence in this impl
    )


def is_grounded_evidence_artifact(art: Any) -> bool:
    prod = _get_attr(art, "producedBy")
    cap = None
    if isinstance(prod, dict):
        cap = prod.get("capabilityId")
    elif prod is not None:
        cap = _get_attr(prod, "capabilityId")
    is_ev = (cap == "evidence.search") or (_get_attr(art, "kind") == "evidence")
    if not is_ev:
        return False
    prov = _get_attr(art, "provenance")
    if is_external_grounding_provenance(prov):
        if not _has_nonempty_content(art):
            return False
        if not _has_traceable_source(art):
            return False
        return True
    payload = _get_attr(art, "payload") or {}
    if isinstance(payload, dict):
        es = payload.get("evidenceSource")
        if es in ("F1_Github_Source 取数", "F2_Web_Search 取数"):
            # legacy path: still require non-empty to avoid empty fallback counting
            if _has_nonempty_content(art):
                return True
    text = f"{_get_attr(art, 'summary', '')} {_get_attr(art, 'content', '')}"
    if ("F1_Github" in text or "F2_Web_Search" in text) and _has_nonempty_content(art):
        return True
    return False


def has_grounded_external_evidence(state: Any) -> bool:
    stales = set(_get_list(state, "staleArtifactIds"))
    for a in _get_list(state, "artifacts"):
        if not _is_healthy_artifact(a, stales):
            continue
        if is_grounded_evidence_artifact(a):
            return True
    return False


def count_grounded_trusted_artifacts(state: Any) -> int:
    stales = set(_get_list(state, "staleArtifactIds"))
    cnt = 0
    for a in _get_list(state, "artifacts"):
        if not _is_healthy_artifact(a, stales):
            continue
        if is_grounded_evidence_artifact(a):
            cnt += 1
    return cnt


def author_coverage_contract(
    goal_text: str, turn_id: Optional[str] = None
) -> Dict[str, Any]:
    """Exact port of TS authorCoverageContract requiredCapabilities rules.

    simple: only evidence.search + report.write
    complex (risk/safety/audit or resolveRoleMode complex): critique + risk + synthesis + evidence + report
    only game/RPG+complex: + structure.decompose + (intent for extra evidence) + mcp.call + skill.invoke
    """
    t = (goal_text or "").lower()
    # replicate resolveRoleMode(stub, "") || regex from TS author
    is_complex = False
    if re.search(r"辩论|brainstorm|多角色|多\s?agent|multi-?agent|复杂|合规|审计|跨部门|平台化|多模块", t):
        is_complex = True
    if re.search(r"风险|risk|安全|审计|反驳|复杂|complex|rebuttal", t):
        is_complex = True
    # product/build goals default complex (from resolveRoleMode)
    if re.search(
        r"工具|系统|应用|平台|产品|功能|服务|模块|网站|小程序|游戏|引擎|\bapp\b|tool|system|platform|feature|product|service|game|engine",
        t,
    ) and re.search(
        r"做|造|搭建|开发|实现|设计|构建|规划|推演|写|build|design|implement|plan", t
    ):
        is_complex = True

    mode: str = "complex" if is_complex else "simple"
    if is_complex:
        required_capabilities: List[str] = [
            "critique.generate",
            "risk.analyze",
            "synthesis.merge",
            "evidence.search",
            "report.write",
        ]
    else:
        required_capabilities = ["evidence.search", "report.write"]

    goal_for_contract = t
    is_game = bool(re.search(r"rpg|游戏|multi.?agent|多\s?agent|自定义.*游戏", goal_for_contract, re.I))
    if is_game and is_complex:
        if "structure.decompose" not in required_capabilities:
            required_capabilities.append("structure.decompose")
        if required_capabilities.count("evidence.search") < 2:
            required_capabilities.append("evidence.search")
        if "mcp.call" not in required_capabilities:
            required_capabilities.append("mcp.call")
        if "skill.invoke" not in required_capabilities:
            required_capabilities.append("skill.invoke")

    # dedup preserve order (matches TS Set after conditional push)
    seen = set()
    deduped: List[str] = []
    for c in required_capabilities:
        if c not in seen:
            seen.add(c)
            deduped.append(c)
    required_capabilities = deduped

    conditional_capabilities: List[str] = []
    now = datetime.now().isoformat()
    contract_id = f"cov-{turn_id or int(datetime.now().timestamp()*1000)}"
    blocking_gap_ids: List[str] = []

    gaps: List[Dict[str, Any]] = []
    for cap in required_capabilities:
        if cap == "report.write":
            continue
        gap_id = f"gap-{cap}-{turn_id or int(datetime.now().timestamp()*1000)}"
        gap: Dict[str, Any] = {
            "id": gap_id,
            "kind": "missing_capability",
            "label": f"Missing required capability: {cap}",
            "requiredCapabilityId": cap,
            "status": "open",
            "createdAt": now,
        }
        gaps.append(gap)
        blocking_gap_ids.append(gap_id)

    ev_gap_id = f"gap-evidence-{turn_id or int(datetime.now().timestamp()*1000)}"
    ev_gap: Dict[str, Any] = {
        "id": ev_gap_id,
        "kind": "missing_evidence",
        "label": "Missing grounded external evidence (G-GROUND)",
        "status": "open",
        "createdAt": now,
    }
    gaps.append(ev_gap)
    blocking_gap_ids.append(ev_gap_id)

    contract: Dict[str, Any] = {
        "id": contract_id,
        "version": 1,
        "mode": mode,
        "authoredBy": "system",
        "authoredAt": now,
        "frozenAtTurnId": turn_id,
        "requiredCapabilities": required_capabilities,
        "conditionalCapabilities": conditional_capabilities,
        "minEvidencePerRequirement": 1,
        "blockingGapIds": blocking_gap_ids,
    }

    return {"contract": contract, "gaps": gaps}


def evaluate_coverage_gate(
    state: V5SessionState,
    selected: Optional[List[Dict[str, Any]]] = None,
    existing_contract: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Port of TS evaluateCoverageGate (exact match to blueprint snapshot).
    missingCapabilities always computed by calling hasTrustedCommittedForCap for each
    pre-req (no exemption for resolved/waived gap statuses).
    waivedGaps collected for reporting only; they affect openBlocking (thus allBlockingHandled)
    but do not remove reqs from missing or relax grounding/upstream.
    passed requires allBlockingHandled (no open) AND missing.length===0 AND upstreamOk AND
    groundingOk = hasGroundedExternalEvidence(state) strictly.
    """
    selected = selected or []
    contract = existing_contract
    if not contract:
        sc = _get_attr(state, "coverageContract")
        if sc:
            contract = sc if isinstance(sc, dict) else sc.model_dump() if hasattr(sc, "model_dump") else dict(sc)
    if not contract:
        ac = author_coverage_contract(
            _get_attr(_get_attr(state, "goal", {}), "text", ""),
            _get_attr(state, "lastTurnId"),
        )
        contract = ac["contract"]

    gaps = _get_list(state, "coverageGaps")
    blocking_ids = contract.get("blockingGapIds", []) if isinstance(contract, dict) else []
    blocking_gaps = [
        g for g in gaps
        if (_get_attr(g, "id") in blocking_ids)
    ]
    open_blocking = [g for g in blocking_gaps if _get_attr(g, "status", "open") == "open"]
    unresolved_gaps = [_get_attr(g, "id") for g in open_blocking]
    waived_gaps = [
        _get_attr(g, "id") for g in blocking_gaps if _get_attr(g, "status") == "waived"
    ]

    missing: List[str] = []
    pre_reqs = [
        c for c in (contract.get("requiredCapabilities", []) if isinstance(contract, dict) else [])
        if c != "report.write"
    ]
    for req in pre_reqs:
        if not has_trusted_committed_for_cap(state, req):
            missing.append(req)

    has_report_intent = any(
        _get_attr(s, "capabilityId") == "report.write" for s in selected
    )
    grounded_count = count_grounded_trusted_artifacts(state)
    min_grounded = contract.get("minEvidencePerRequirement", 1) if isinstance(contract, dict) else 1
    upstream_ok = True
    if has_report_intent and grounded_count < min_grounded:
        upstream_ok = False

    grounding_ok = has_grounded_external_evidence(state)
    all_blocking_handled = len(open_blocking) == 0
    passed = all_blocking_handled and len(missing) == 0 and upstream_ok and grounding_ok

    reason = (
        f"Coverage sufficient (mode={contract.get('mode') if isinstance(contract,dict) else 'n/a'}, grounded_evidence={grounded_count}, G-GROUND ok)"
        if passed
        else f"Blocking gaps open: {len(unresolved_gaps)}; missing caps: {', '.join(missing) or 'none'}; upstreams ok: {upstream_ok}; G-GROUND: {grounding_ok} (grounded={grounded_count}/{min_grounded})"
    )

    return {
        "passed": passed,
        "missingCapabilities": missing,
        "unresolvedGaps": unresolved_gaps,
        "waivedGaps": waived_gaps,
        "reason": reason,
    }


def resolve_coverage_gaps_from_state(state: V5SessionState) -> V5SessionState:
    """Port of TS resolveCoverageGapsFromState (client/src/lib/sliderule-runtime.ts).

    能力提交且通过信任门后，把对应 missing_capability 缺口置为 resolved；
    接地证据数达到 minEvidencePerRequirement 后关闭 missing_evidence 缺口。
    没有这一步，覆盖门的 open_blocking 永远非零，推演不可能收敛（金链路修复）。
    """
    contract = _get_attr(state, "coverageContract")
    if not contract:
        return state
    if not isinstance(contract, dict):
        contract = contract.model_dump() if hasattr(contract, "model_dump") else dict(contract)
    gaps = _get_list(state, "coverageGaps")
    if not gaps:
        return state
    now = datetime.now().isoformat()
    min_evidence = contract.get("minEvidencePerRequirement", 1) or 1
    grounded_count: Optional[int] = None

    for g in gaps:
        if _get_attr(g, "status", "open") != "open":
            continue
        kind = _get_attr(g, "kind")
        req_cap = _get_attr(g, "requiredCapabilityId")
        if kind == "missing_capability" and req_cap:
            if has_trusted_committed_for_cap(state, req_cap):
                _set_gap(g, status="resolved", updatedAt=now)
                resolved_art = _last_trusted_artifact_for_cap(state, req_cap)
                if resolved_art:
                    _set_gap(g, resolvedByArtifactId=resolved_art)
        elif kind == "missing_evidence":
            if grounded_count is None:
                grounded_count = count_grounded_trusted_artifacts(state)
            if grounded_count >= min_evidence:
                _set_gap(g, status="resolved", updatedAt=now)

    state.coverageGaps = gaps
    return state


def _set_gap(gap: Any, **fields: Any) -> None:
    """往 gap 上写字段。dict 与 CoverageGap 两种形态都支持。

    ## 这里原来是 `except Exception: pass`，改掉了（2026-08-09）

    缺口的 `updatedAt` / `resolvedByArtifactId` 就是从这儿写进去的，而
    `CoverageGap` 当时**没有声明这两个字段**。pydantic v2 对未声明字段的
    setattr 直接抛 `ValueError: "CoverageGap" object has no field "updatedAt"`，
    被那个 `pass` 一口吞掉——于是同一次调用，**gap 是 dict 就写进去了、
    是模型对象就静默丢掉**，两种形态行为不一致，而且丢的那一份没有任何痕迹。

    丢的是审计信息："这个缺口是被哪个产物填上的"。它不报错、不告警、
    也不影响当轮跑通，只在事后追溯时表现为"不知道"。

    字段已补进 `CoverageGap`，所以**现有的每一处写入都不会再抛**。此后再抛
    就只有一个含义：写入方又加了模型没声明的字段，也就是同一个分叉重演。
    那种情况必须当场炸，不能再吞——吞掉的代价上面写着。

    ⚠️ `reconcile_coverage` 在驱动主循环里是**没有 try 包裹**地调用的
    （v5_full_driver.py:942 / :1540），所以这里抛出去会中止整轮推演。
    这是有意的取舍：宁可一次跑崩在分叉发生的那一行，也不要长期悄悄丢审计字段。
    """
    for key, value in fields.items():
        if isinstance(gap, dict):
            gap[key] = value
        else:
            setattr(gap, key, value)


def _last_trusted_artifact_for_cap(state: Any, cap_id: str) -> Optional[str]:
    last_id: Optional[str] = None
    stales = set(_get_list(state, "staleArtifactIds"))
    for art in _get_list(state, "artifacts"):
        prod = _get_attr(art, "producedBy")
        cap = prod.get("capabilityId") if isinstance(prod, dict) else _get_attr(prod, "capabilityId")
        if cap == cap_id and _is_healthy_artifact(art, stales):
            last_id = _get_attr(art, "id")
    return last_id


def reconcile_coverage(state: V5SessionState) -> V5SessionState:
    """Port of TS reconcileCoverageContract (upgrade guard + gap status carry)."""
    goal_text = _get_attr(_get_attr(state, "goal", {}), "text", "") or ""
    turn_id = _get_attr(state, "lastTurnId")
    authored = author_coverage_contract(goal_text, turn_id)
    desired_contract = authored["contract"]
    desired_gaps = authored["gaps"]

    current = _get_attr(state, "coverageContract")
    curr_reqs = (
        current.get("requiredCapabilities", []) if isinstance(current, dict) else []
    )
    needs_upgrade = (
        not current
        or (current.get("mode") if isinstance(current, dict) else None) != desired_contract.get("mode")
        or len(curr_reqs) < len(desired_contract.get("requiredCapabilities", []))
    )
    if not needs_upgrade:
        return state

    now = datetime.now().isoformat()
    existing_gaps = _get_list(state, "coverageGaps")
    existing_by_id: Dict[str, Any] = {}
    existing_by_stable: Dict[str, Any] = {}
    for g in existing_gaps:
        gid = _get_attr(g, "id")
        if gid and gid not in existing_by_id:
            existing_by_id[gid] = g
        sk = _get_stable_key(g)
        if sk and sk not in existing_by_stable:
            existing_by_stable[sk] = g

    merged_gaps: List[Dict[str, Any]] = []
    for dg in desired_gaps:
        gid = dg.get("id")
        prior_by_id = existing_by_id.get(gid) if gid else None
        sk = _get_stable_key(dg)
        prior = prior_by_id or existing_by_stable.get(sk)
        if prior and _get_attr(prior, "status") in ("resolved", "waived"):
            dg = {**dg, "status": _get_attr(prior, "status"), "updatedAt": _get_attr(prior, "updatedAt", now)}
        merged_gaps.append(dg)

    # keep extra prior gaps (defensive; matches TS condition on id or cap; ev handled via stable carry)
    for prior in existing_gaps:
        pid = _get_attr(prior, "id")
        pcap = _get_attr(prior, "requiredCapabilityId")
        if not any(
            (dg.get("id") == pid) or (pcap and dg.get("requiredCapabilityId") == pcap)
            for dg in desired_gaps
        ):
            merged_gaps.append(prior if isinstance(prior, dict) else prior)

    # preserve authoredAt/frozenAt on contract upgrade per TS reconcile
    curr_c = current if isinstance(current, dict) else (current.model_dump() if hasattr(current, "model_dump") else {})
    final_contract = {
        **desired_contract,
        "authoredAt": curr_c.get("authoredAt") or desired_contract.get("authoredAt"),
        "frozenAtTurnId": curr_c.get("frozenAtTurnId") or desired_contract.get("frozenAtTurnId"),
    }

    # assign (dicts acceptable for this slice; model allows)
    state.coverageContract = final_contract
    state.coverageGaps = merged_gaps
    return state


# --- N1 PUT GCOV boundary: recompute coverage from server ledger only (sliderule-python-v52-gcov-put-boundary-tests-105) ---
# Port of TS buildGcovAuthoritativeStateForPut / sanitizeGoalStatusOnPut / emptyGcovLedgerShell from shared/blueprint/sliderule-coverage-gate.ts
# Purpose: PUT sanitization must NEVER trust client-submitted capabilityRuns/artifacts/coverageGate for GCOV.
# Client PUT bodies may forge trustLevel/runs/grounded evidence; authoritative base = previous (server persisted ledger) or empty shell.
# Classification (step 1): TS_RUNTIME_OWNED (PUT gcov recompute logic only in TS) -> PYTHON_AUTHORITY (Python owns the boundary recompute + gate eval on ledger-only base; tests prove directly; no Node fallback)
# This slice adds the dedicated helpers so Python GCOV owns the server-ledger-only semantics for PUT sanitization.
# Routes may call these for coverageGate recompute + status guard; general field sanitize existed prior (SessionAuthority).

def _empty_gcov_ledger_shell(incoming: Any) -> Dict[str, Any]:
    """Empty ledger shell for cold PUT (no previous server state): never carry client runs/artifacts into GCOV."""
    goal_text = ""
    if isinstance(incoming, dict):
        goal_text = _get_attr(incoming, "goal", {}).get("text", "") if isinstance(_get_attr(incoming, "goal"), dict) else ""
    else:
        g = _get_attr(incoming, "goal", {}) or {}
        goal_text = g.get("text", "") if isinstance(g, dict) else ""
    return {
        "sessionId": _get_attr(incoming, "sessionId"),
        "goal": {"text": goal_text or "", "status": "needs_refinement"},
        "graph": _get_attr(incoming, "graph") or {"nodes": [], "edges": []},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
        "coverageGate": None,
        "conversation": [],
        "openQuestions": [],
        "evidence": [],
        "decisions": [],
        "risks": [],
        "gates": [],
        "dependencyGraph": [],
        "staleArtifactIds": [],
    }


def build_gcov_authoritative_state_for_put(incoming: Any, previous: Any = None) -> Dict[str, Any]:
    """N1 PUT boundary: GCOV must read the server-persisted ledger only.
    If no previous (first save or cold), return empty shell (client forges ignored).
    Else return previous (server values for runs, artifacts, gaps, contract).
    Client incoming's capabilityRuns/artifacts/coverage* are discarded for authoritative gcov base.
    """
    if not previous:
        return _empty_gcov_ledger_shell(incoming)
    # return previous as-is when model (getattr friendly for has_* and ledger checks); dict ok too
    if isinstance(previous, dict):
        return previous
    # keep model instance (V5SessionState etc) so downstream getattr + has_provenance_and_trust_ledger work
    # (model_dump would drop runtime ledger attrs and break has_provenance checks on dict state)
    if hasattr(previous, "capabilityRuns") or hasattr(previous, "__dict__"):
        return previous
    # fallback to minimal dict shell copy
    return {k: getattr(previous, k, None) for k in [
        "sessionId", "goal", "graph", "artifacts", "capabilityRuns",
        "coverageGaps", "coverageContract", "coverageGate", "conversation",
        "openQuestions", "evidence", "decisions", "risks", "gates",
        "dependencyGraph", "staleArtifactIds"
    ]}


def sanitize_goal_status_on_put(incoming: Any, previous: Any = None) -> Dict[str, Any]:
    """Recompute GCOV from persisted ledger (server authoritative); reject unauthorized goal.status=clear.
    Uses build_gcov... to force server previous (or empty) for evaluateCoverageGate.
    Sets coverageGate to the recomputed result.
    If client tries to set clear but recomputed not passed, revert to previous or needs_refinement + append guard note.
    """
    gcov_base = build_gcov_authoritative_state_for_put(incoming, previous)
    # evaluate uses gcov_base (ledger) + optional prior contract for compat
    prior_contract = None
    if isinstance(gcov_base, dict):
        prior_contract = gcov_base.get("coverageContract")
    elif gcov_base is not None:
        prior_contract = _get_attr(gcov_base, "coverageContract")
    if not prior_contract and previous is not None:
        if isinstance(previous, dict):
            prior_contract = previous.get("coverageContract")
        else:
            prior_contract = _get_attr(previous, "coverageContract")

    recomputed = evaluate_coverage_gate(gcov_base, [], prior_contract)

    # start from incoming (safe client fields kept) + override the gcov result
    if isinstance(incoming, dict):
        state = dict(incoming)
    else:
        state = incoming.model_dump() if hasattr(incoming, "model_dump") else {k: getattr(incoming, k, None) for k in dir(incoming) if not k.startswith("_")}

    state["coverageGate"] = recomputed

    next_status = None
    goal = state.get("goal") if isinstance(state, dict) else _get_attr(state, "goal")
    if isinstance(goal, dict):
        next_status = goal.get("status")
    else:
        next_status = _get_attr(goal, "status")

    if next_status != "clear":
        return state

    if recomputed.get("passed") is True:
        return state

    # revert
    reverted = "needs_refinement"
    if previous is not None:
        pg = previous.get("goal") if isinstance(previous, dict) else _get_attr(previous, "goal")
        if isinstance(pg, dict):
            reverted = pg.get("status", reverted)
        else:
            reverted = _get_attr(pg, "status", reverted) or reverted

    if isinstance(state.get("goal"), dict):
        state["goal"] = {**state["goal"], "status": reverted}
    else:
        # best effort
        state["goal"] = {"text": (state.get("goal") or {}).get("text", "") if isinstance(state.get("goal"), dict) else "", "status": reverted}

    conv = state.get("conversation") or []
    if not isinstance(conv, list):
        conv = []
    conv.append({
        "id": f"n1-gcov-guard-{int(datetime.now().timestamp()*1000)}",
        "role": "system",
        "text": f"[N1] rejected goal.status=clear — server GCOV.passed=false (PUT trusts persisted ledger only) — reverted to {reverted}",
        "timestamp": datetime.now().isoformat(),
    })
    state["conversation"] = conv
    return state
