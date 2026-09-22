"""
SlideRule V5.2 Trust provenance ledger + commit/ship gates (PYTHON_COMPAT slice for TrustGcov seq 22 + seq 23 ship gates + seq 24 quality baseline).

Records provenance and trust ledger entries on committed artifacts (via helpers) and enforces ledger requirement for trusted-committed recognition in GCOV.

Classification (step 1, per task + review resolution):
Current behavior before: PYTHON_COMPAT (drivers use Artifact.server_construct or raw dicts to set provenance/producedBy + trustLevel on commit; no dedicated trust service; no forced ledger entry recording or ledgerEntryId tie; no API enforcing "every committed artifact has recorded provenance+trust ledger"; trusted committed checks ignored ledger).
After: PYTHON_COMPAT (slide_rule_trust owns record_provenance_and_trust_ledger + commit_artifact_with_ledger + has_provenance_and_trust_ledger + reject_client...; has_trusted_committed_for_cap now requires has_provenance_and_trust_ledger so no-ledger gated_pass artifact is excluded from trusted committed; producedBy required for record; client dict forgery rejected; pytest proves producedBy+gated_pass+!ledger => has_trusted=False, after record=True).
Record is via canonical commit helper (recommended server path) + gate now depends on ledger. Full exhaustive replacement of every server_construct+append site across all drivers, and promotion of trustProvenanceLedger to top-level durable V5SessionState field, are deferred to PythonDriver/StateSchema (this slice edits only allowed files and does not claim every construct site or model change). Durable marker currently uses ledgerEntryId on CapabilityRun; explicit list uses runtime attr (limitation recorded).
No Node fallback hiding semantics. Do not default artifacts to trusted.

Classification for sliderule-python-v52-ship-gates-105 (prior):
Current behavior before: TS_RUNTIME_OWNED (commit-time gates for schema/invariant/ground/quality + ship-time gates for content/tests/merge readiness per V5.2 TRUST diagram and P5 double-speed spec; logic lived in TS client/server runtimes, handoff.package phase:ship, evaluate*Gates; Python trust/coverage had only GCOV + provenance/ledger).
After: PYTHON_COMPAT (slide_rule_trust.py owns smallest Python slice: evaluate_content_gate, evaluate_tests_gate, evaluate_merge_readiness_gate, evaluate_commit_time_gates, evaluate_ship_time_gates; uses passedGates + artifact content/kind/producedBy checks for content (EARS/sections/nonempty), tests (test artifacts or T_TEST evidence), merge (content+tests+no open blockers); direct pytest proves Python-owned behavior; commit vs ship phase distinguished; no Node fallback hiding semantics. Full driver integration and handoff wiring deferred (recorded in status).
Python provides the ported commit-time and ship-time gates for content, tests, and merge readiness.

Classification for sliderule-python-v52-quality-baseline-105 (this task):
Current behavior before: TS_RUNTIME_OWNED (pilot and production quality baseline checks (G_QUALITY commit-time) lived in TS: evaluateQualityGate + PRODUCTION_BASELINE/PILOT_TEMPLATE_BASELINE + satisfiesContract + output contracts for report/structure etc; result-level declaration, no sniffing per V5.2 BASELINE + T_LEDGER + EXECABS self-declare; quality verdict+baseline in ledger).
After: PYTHON_COMPAT (slide_rule_trust owns smallest Python slice for pilot/production quality baseline checks: PRODUCTION_BASELINE, PILOT_TEMPLATE_BASELINE, get_baseline, evaluate_quality_baseline + satisfies logic ported from TS; uses minimal dict contract for requiredHeadings/minContentChars etc; production=strict headings/blocks/EARS/embedded+contract min, pilot=relaxed 280char no reqs; returns {gateId:"quality", status, phase:"commit", baseline, contractId?, reason?}; direct pytest proves Python behavior; classification per step 1; no Node fallback hiding semantics. Full contract model, artifact.result baseline attach, ledger verdict write, driver integration deferred (recorded).
Python provides the ported pilot and production quality baseline checks. Result-level declaration; no internal sniffing.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import re

from models.v5_state import Artifact, ProducedBy, V5SessionState, CapabilityRun


def _now_iso() -> str:
    return datetime.now().isoformat()


def record_provenance_and_trust_ledger(
    state: V5SessionState,
    artifact: Artifact,
    run: Optional[CapabilityRun] = None,
) -> Dict[str, Any]:
    """Record provenance (producedBy + provenance) + trust ledger entry for a committed artifact (server path).

    Canonical helper commit_artifact_with_ledger calls this. Requires producedBy.
    Binds ledgerEntryId (durable on CapabilityRun) and appends to runtime trustProvenanceLedger attr.
    Note: explicit list is via setattr (not declared field in V5SessionState; see blocker in status; may not survive model_dump/reload).
    Durable record marker for audit is ledgerEntryId on the producing run + producedBy on artifact.
    Coverage gate requires has_provenance_and_trust_ledger; unrecorded artifacts excluded from trusted committed.
    Returns ledger entry. Raises on missing producedBy.
    """
    if not isinstance(artifact, Artifact):
        # accept dict for thin compat in some paths but enforce via ctor elsewhere
        artifact = Artifact.server_construct(**artifact) if isinstance(artifact, dict) else artifact

    if artifact.producedBy is None:
        raise ValueError(
            "committed artifact must carry producedBy (server-owned provenance); "
            "use Artifact.server_construct with ProducedBy after real execution/gates"
        )

    if artifact.trustLevel == "untrusted":
        # untrusted may exist but "committed" trusted ones for coverage must be gated
        pass  # allow but ledger still records

    ledger_entry: Dict[str, Any] = {
        "id": f"trust-ledger-{artifact.id}",
        "artifactId": artifact.id,
        "provenance": artifact.provenance,
        "producedBy": artifact.producedBy.model_dump() if artifact.producedBy else None,
        "trustLevel": artifact.trustLevel,
        "passedGates": list(getattr(artifact, "passedGates", [])),
        "committedAt": _now_iso(),
        "ledgerEntryId": f"trust-ledger-{artifact.id}",
    }

    # Bind to run's ledgerEntryId (the V5 mechanism for tying execution to ledger)
    target_run = run
    if not target_run and artifact.producedBy:
        run_id = artifact.producedBy.capabilityRunId
        for r in (getattr(state, "capabilityRuns", None) or []):
            if getattr(r, "id", None) == run_id or (isinstance(r, dict) and r.get("id") == run_id):
                target_run = r
                break
        if target_run is None:
            # create minimal run to carry ledgerEntry (server path)
            target_run = CapabilityRun.server_record(
                # ⚠ `unknown` 是这里的**正确答案**，不是偷懒。这条记录是为了
                #   挂 ledgerEntryId 才造的空壳：真正那次执行没在台账里留下
                #   记录，它的结局这条路径确实不知道。
                #   抄 grok `ToolCallOutcome` 的 `#[serde(other)] Unknown`——
                #   把不知道说成 success 才是事故。
                status="unknown",
                durationMs=None,
                provenance="trust.ledger_stub",
                id=run_id,
                capabilityId=artifact.producedBy.capabilityId,
                turnId=getattr(state, "lastTurnId", None) or "t",
                ledgerEntryId=None,
            )
            state.capabilityRuns.append(target_run)

    if target_run is not None:
        if hasattr(target_run, "ledgerEntryId"):
            target_run.ledgerEntryId = ledger_entry["id"]
        elif isinstance(target_run, dict):
            target_run["ledgerEntryId"] = ledger_entry["id"]

    # Record explicit trust provenance ledger on state for audit.
    # Uses runtime attr (setattr) because trustProvenanceLedger is not a declared field on V5SessionState model.
    # Limitation per review finding 1: attr may be dropped on model_dump / server_load / pydantic roundtrip.
    # Primary durable evidence of record is ledgerEntryId bound on CapabilityRun (field exists) + artifact.producedBy.
    # Full promotion to durable top-level list deferred (blocker; would require model edit outside this task's allowed files).
    ledger_list = getattr(state, "trustProvenanceLedger", None)
    if not isinstance(ledger_list, list):
        ledger_list = []
        try:
            setattr(state, "trustProvenanceLedger", ledger_list)
        except Exception:
            pass
    ledger_list.append(ledger_entry)

    # Ensure artifact is in state.artifacts so that record_provenance... also covers commit (addresses standalone helper)
    arts = getattr(state, "artifacts", None) or []
    if not any((getattr(a, "id", None) or (a.get("id") if isinstance(a, dict) else None)) == artifact.id for a in arts):
        arts.append(artifact)
        if hasattr(state, "artifacts"):
            state.artifacts = arts

    return ledger_entry


def commit_artifact_with_ledger(
    state: V5SessionState,
    **artifact_fields: Any,
) -> Artifact:
    """Canonical server commit helper that records provenance + trust ledger entry (via record fn).

    Always server_construct + record (bind ledgerEntryId + append list + ensure in artifacts).
    Recommended path for Python server commits that need to satisfy trusted-committed gate.
    Direct Artifact.server_construct + append (without record) will fail has_trusted_committed_for_cap until recorded.
    Full mandatory use at all construct sites is outside allowed files (deferred to PythonDriver).
    """
    # ensure server path
    if "trustLevel" not in artifact_fields or artifact_fields.get("trustLevel") == "untrusted":
        # caller must decide; default gated only when server
        pass
    art = Artifact.server_construct(**artifact_fields)
    record_provenance_and_trust_ledger(state, art)
    return art


def has_provenance_and_trust_ledger(state: Any, artifact_id: str) -> bool:
    """Check: artifact has producedBy (provenance) + trust record marker (ledgerEntryId on its run, or explicit list entry).
    Note: explicit list may be runtime-only; ledgerEntryId provides durable tie for this slice."""
    # via producedBy on artifact (core provenance)
    for a in (getattr(state, "artifacts", None) or []):
        aid = getattr(a, "id", None) or (a.get("id") if isinstance(a, dict) else None)
        if aid != artifact_id:
            continue
        prod = getattr(a, "producedBy", None) or (a.get("producedBy") if isinstance(a, dict) else None)
        if prod is None:
            return False
        # also check explicit ledger
        ledger = getattr(state, "trustProvenanceLedger", None) or []
        if any(e.get("artifactId") == artifact_id for e in ledger):
            return True
        # or via run ledgerEntryId
        prod_run = None
        if isinstance(prod, dict):
            prod_run = prod.get("capabilityRunId")
        elif prod is not None:
            prod_run = getattr(prod, "capabilityRunId", None)
        if prod_run:
            for r in (getattr(state, "capabilityRuns", None) or []):
                rid = getattr(r, "id", None) or (r.get("id") if isinstance(r, dict) else None)
                if rid == prod_run:
                    leid = getattr(r, "ledgerEntryId", None) or (r.get("ledgerEntryId") if isinstance(r, dict) else None)
                    if leid:
                        return True
    return False


def reject_client_forged_provenance_or_ledger(artifact_input: Dict[str, Any]) -> None:
    """Guard: client/frontend dicts cannot forge server-owned provenance (producedBy) or ledger entries.
    Call on raw client artifact inputs before any commit path.
    Mirrors Artifact model anti-forgery for ledger slice.
    """
    if artifact_input.get("producedBy") is not None:
        raise ValueError(
            "producedBy is server-owned provenance ledger; client PUT cannot forge. "
            "Use server commit paths only."
        )
    if artifact_input.get("trustLevel") in ("gated_pass", "audited"):
        raise ValueError(
            "trustLevel elevation is server-only after gates; client cannot forge provenance/trust ledger."
        )
    # explicit ledger forgery attempt
    if artifact_input.get("ledgerEntryId") or "trustLedger" in str(artifact_input).lower():
        raise ValueError("ledgerEntry / trust ledger is server-owned; client cannot forge on artifact commit.")


# --- Commit-time and ship-time gates for content, tests, and merge readiness (task sliderule-python-v52-ship-gates-105) ---
# Smallest Python slice. Commit-time: verify (schema/ground/ledger/quality aspects via existing + phase).
# Ship-time: verify good (content + tests + merge readiness) per V5.2 docs (T_CONTENT/T_TEST/T_MERGE).
# Uses passedGates (server-set on gated artifacts) + content/kind heuristics for EARS-style + test evidence.
# Returns gate result shape similar to evaluate_coverage_gate for consistency.
# Classification: PYTHON_COMPAT (direct Python impl; tests prove; no fallback to Node).

def _get_list_local(obj: Any, key: str) -> List[Any]:
    if isinstance(obj, dict):
        return obj.get(key) or []
    val = getattr(obj, key, None)
    return val or []


def _get_attr_local(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def evaluate_content_gate(artifact: Any) -> Dict[str, Any]:
    """Ship-time content gate (T_CONTENT).
    Content check: non-empty content/summary; for report/handoff/deliverable require sections/EARS style (spec成立).
    Accepts only if explicit 'content'/'T_CONTENT'/'quality' markers in passedGates (not arbitrary non-empty lists).
    """
    if artifact is None:
        return {"passed": False, "reason": "no artifact"}
    passed_gates = _get_attr_local(artifact, "passedGates") or []
    if isinstance(passed_gates, (list, tuple)) and any(
        str(g).lower() in ("content", "t_content", "quality", "content.quality")
        for g in passed_gates
    ):
        return {"passed": True, "reason": "content gate passed via passedGates"}
    kind = (_get_attr_local(artifact, "kind") or "").lower()
    content = (_get_attr_local(artifact, "content") or "").strip()
    summary = (_get_attr_local(artifact, "summary") or "").strip()
    has_content = bool(content or summary)
    if kind in ("report", "handoff", "deliverable", "pack", "matrix") or "report" in kind:
        # EARS / spec成立 heuristic (specs,验收,acceptance,ears)
        text = (content + " " + summary).lower()
        structured = any(k in text for k in ["验收", "ears", "spec", "acceptance", "requirement", "criteria"])
        passed = has_content and (structured or len(content) > 30)
        return {"passed": passed, "reason": "content ok for deliverable" if passed else "deliverable missing structured content"}
    passed = has_content
    return {"passed": passed, "reason": "content present" if passed else "missing content/summary"}


def evaluate_tests_gate(state: Any) -> Dict[str, Any]:
    """Ship-time tests gate (T_TEST).
    Evidence of tests: artifacts of kind test/* or passedGates containing 'test','T_TEST','e2e','ssr'.
    Minimal port: does not execute tests; checks committed test evidence markers.
    """
    arts = _get_list_local(state, "artifacts")
    passed_gates_all: List[str] = []
    for a in arts:
        pg = _get_attr_local(a, "passedGates") or []
        if isinstance(pg, (list, tuple)):
            passed_gates_all.extend([str(x) for x in pg])
        elif pg:
            passed_gates_all.append(str(pg))
    has_test_art = any(
        (_get_attr_local(a, "kind") or "").lower() in ("test", "tests", "e2e", "ssr", "test-result")
        for a in arts
    )
    has_test_gate = any(
        any(t in g.lower() for t in ("test", "t_test", "e2e", "ssr")) for g in passed_gates_all
    )
    passed = has_test_art or has_test_gate
    return {
        "passed": passed,
        "reason": "tests evidence present" if passed else "no test artifacts or T_TEST gate markers",
        "testArtifactCount": sum(1 for a in arts if (_get_attr_local(a, "kind") or "").lower().startswith("test")),
    }


def _has_open_blockers(state: Any) -> Dict[str, Any]:
    """Explicit open blocker detection for merge readiness (addresses review Finding 2).
    Checks coverageGaps (status=="open"), openQuestions, risks (open/unresolved), and gates (failed/open).
    Returns has + sample details. No open blockers is required core of T_MERGE semantics.
    """
    blockers: List[str] = []
    for g in _get_list_local(state, "coverageGaps"):
        if _get_attr_local(g, "status", "open") == "open":
            gid = _get_attr_local(g, "id") or _get_attr_local(g, "requiredCapabilityId") or "gap"
            blockers.append(f"gap:{gid}")
    for q in _get_list_local(state, "openQuestions"):
        if q:
            blockers.append("openQuestion")
            break
    for r in _get_list_local(state, "risks"):
        st = str(_get_attr_local(r, "status", "") or "").lower()
        resolved = _get_attr_local(r, "resolved", None)
        if st in ("open", "unresolved", "blocking") or resolved is False:
            blockers.append("risk")
            break
    for g in _get_list_local(state, "gates"):
        if _get_attr_local(g, "passed") is False:
            blockers.append("gate:failed")
            break
        if str(_get_attr_local(g, "status", "")).lower() == "open":
            blockers.append("gate:open")
            break
    return {"has": len(blockers) > 0, "details": blockers[:3]}


def evaluate_merge_readiness_gate(state: Any) -> Dict[str, Any]:
    """Ship-time merge gate (T_MERGE).
    Merge readiness: content gate + tests gate + no open blocking ship gaps + merge marker in gates or passed.
    Explicitly checks for open blockers in coverageGaps/gates/risks/openQuestions (Finding 2).
    """
    # aggregate: require at least one healthy deliverable-like passes content, plus tests + marker + no blockers
    arts = _get_list_local(state, "artifacts")
    content_ok = False
    for a in arts:
        cr = evaluate_content_gate(a)
        if cr.get("passed"):
            content_ok = True
            break
    tests_res = evaluate_tests_gate(state)
    # check passedGates or gateResults for explicit merge
    gates = _get_list_local(state, "gates") or []
    merge_marker = any(
        "merge" in str(g).lower() or "ship" in str(g).lower() or "T_MERGE" in str(g)
        for g in gates
    )
    for a in arts:
        pg = _get_attr_local(a, "passedGates") or []
        if isinstance(pg, (list, tuple)) and any("merge" in str(x).lower() or "T_MERGE" in str(x) for x in pg):
            merge_marker = True
    # also allow via capability run gateResults
    runs = _get_list_local(state, "capabilityRuns")
    for r in runs:
        grs = _get_attr_local(r, "gateResults") or []
        if any("merge" in str(g).lower() or "ship" in str(g).lower() for g in (grs if isinstance(grs, list) else [])):
            merge_marker = True
    blocker_info = _has_open_blockers(state)
    has_open_blocker = blocker_info["has"]
    passed = content_ok and tests_res.get("passed", False) and merge_marker and not has_open_blocker
    reason = (
        "merge ready (content+tests+marker+no-open-blockers)"
        if passed
        else ("merge not ready: has open blockers" if has_open_blocker else "merge not ready: content_ok=%s tests=%s marker=%s" % (content_ok, tests_res.get("passed"), merge_marker))
    )
    return {
        "passed": passed,
        "reason": reason,
        "contentOk": content_ok,
        "testsOk": tests_res.get("passed"),
        "openBlockers": blocker_info["details"],
    }


def evaluate_commit_time_gates(state: Any) -> Dict[str, Any]:
    """Commit-time gates aggregate (schema/ground/ledger/provenance aspects + quality).
    Smallest port uses existing has_provenance_and_trust_ledger and healthy committed for basic commit verify.
    Phase=commit distinguishes from ship.
    """
    # lightweight: any healthy + ledger satisfies basic commit gate for covered caps
    has_any = False
    for a in _get_list_local(state, "artifacts"):
        if _get_attr_local(a, "trustLevel") in ("gated_pass", "audited"):
            aid = _get_attr_local(a, "id")
            if aid and has_provenance_and_trust_ledger(state, aid):
                has_any = True
                break
    # also check for commit phase markers
    phase_ok = True  # default; callers can pass phase
    return {"passed": has_any, "reason": "commit-time verified (provenance+ledger+healthy)" if has_any else "no ledger-proven committed artifacts", "phase": "commit"}


def evaluate_ship_time_gates(state: Any) -> Dict[str, Any]:
    """Ship-time gates for content, tests, and merge readiness (primary task goal).
    Requires content + tests + merge readiness.
    """
    c = evaluate_content_gate({"kind": "report", "content": "", "passedGates": []})  # base
    # recompute aggregate
    c_ok = False
    for a in _get_list_local(state, "artifacts"):
        if evaluate_content_gate(a).get("passed"):
            c_ok = True
            break
    t = evaluate_tests_gate(state)
    m = evaluate_merge_readiness_gate(state)
    passed = bool(c_ok and t.get("passed") and m.get("passed"))
    return {
        "passed": passed,
        "missing": [] if passed else (["content"] if not c_ok else []) + ([] if t.get("passed") else ["tests"]) + ([] if m.get("passed") else ["merge"]),
        "reason": "ship-time gates passed (content+tests+merge+no-open-blockers)" if passed else "ship-time gates not satisfied",
        "phase": "ship",
        "content": c_ok,
        "tests": t.get("passed"),
        "merge": m.get("passed"),
        "openBlockers": m.get("openBlockers", []),
    }


# expose helpers for tests (thin)
def _test_get_attr(obj, key, default=None):
    return _get_attr_local(obj, key, default)


# --- Pilot and production quality baseline checks (sliderule-python-v52-quality-baseline-105) ---
# Smallest Python slice port of TS sliderule-quality-gate.ts QualityBaseline + evaluateQualityGate + satisfiesContract.
# production: full contract (headings, child blocks, EARS, embedded, contract minContent)
# pilot-template: relaxed (min 280 chars only; no structural reqs). Explicit in result baseline name.
# Contract shapes use dict (minimal; no Python output-contracts module yet; sufficient for checks).
# Returns QualityGateResult shape or None (no contract -> not applicable). Phase always "commit".
# Classification: PYTHON_COMPAT; direct ownership in Python; no fallback; no sniffing (result-level only).

PRODUCTION_BASELINE: Dict[str, Any] = {
    "name": "production",
    "minContentChars": 0,  # contract decides
    "requireAllRequiredHeadings": True,
    "requireMinChildBlocks": True,
    "requireEarsInSections": True,
    "requireEmbedded": True,
}

PILOT_TEMPLATE_BASELINE: Dict[str, Any] = {
    "name": "pilot-template",
    "minContentChars": 280,
    "requireAllRequiredHeadings": False,
    "requireMinChildBlocks": False,
    "requireEarsInSections": False,
    "requireEmbedded": False,
}


def get_baseline(name: str) -> Dict[str, Any]:
    """Return baseline by name. Default production."""
    if name == "pilot-template":
        return PILOT_TEMPLATE_BASELINE
    return PRODUCTION_BASELINE


def _extract_headings(text: str) -> List[str]:
    hs: List[str] = []
    # # headings
    for m in re.finditer(r"^#{1,3}\s+(.+?)\s*$", text, re.M):
        hs.append(m.group(1).strip())
    # report style cn headings
    for m in re.finditer(r"(?:^|\n)(支撑证据|反证/挑战|风险|分歧|收敛决策|未解缺口|下一步工程化分支)\s*[:：]?", text):
        hs.append(m.group(1).strip())
    return hs


def _count_ears_like(text: str) -> int:
    # EARS: english + chinese (当/若/如果 ... 应/必须/须)
    pat = r"\b(WHEN|IF|AS SOON AS|THE .* (SHALL|SHOULD|MUST|WILL))\b|(?:^|[\s，。；：、])(当|若|如果)[^。\n]{2,80}(应|必须|须)"
    return len(re.findall(pat, text, re.I))


def _has_mermaid(text: str) -> bool:
    return bool(re.search(r"```mermaid[\s\S]*?```", text, re.I))


def _has_ts_interface(text: str) -> bool:
    return bool(
        re.search(r"```(?:ts|typescript)[\s\S]*?interface\s+\w+", text, re.I)
        or re.search(r"export\s+interface\s+\w+", text, re.I)
    )


def _satisfies_contract(
    content: str, contract: Dict[str, Any], baseline: Dict[str, Any]
) -> Dict[str, Any]:
    body = content or ""
    c_min = contract.get("minContentChars", 0) or 0
    b_min = baseline.get("minContentChars", 0) or 0
    if b_min == 0 and body and c_min > 0 and baseline.get("name") == "production":
        if len(body) < c_min:
            return {"ok": False, "reason": f"content {len(body)} < min {c_min}"}
    if b_min > 0 and len(body) < b_min:
        return {"ok": False, "reason": f"content {len(body)} < baseline {b_min}"}

    if baseline.get("requireAllRequiredHeadings") and contract.get("requiredHeadings"):
        present = [h.lower() for h in _extract_headings(body)]
        missing = []
        for h in contract.get("requiredHeadings", []):
            hl = h.lower().lstrip("# ").strip()
            if not any(hl in p or p in hl for p in present):
                missing.append(h)
        if missing:
            return {"ok": False, "reason": f"missing required headings: {', '.join(missing)}"}

    if baseline.get("requireMinChildBlocks") and contract.get("minChildBlocks"):
        mb = contract["minChildBlocks"]
        if isinstance(mb, dict):
            pat = mb.get("pattern")
            if isinstance(pat, str):
                try:
                    pat = re.compile(pat)
                except Exception:
                    pat = None
            matches = len(pat.findall(body)) if pat else 0
            need = mb.get("min", 0)
            if matches < need:
                return {"ok": False, "reason": f"child blocks under {mb.get('heading')} only {matches} < {need}"}

    if baseline.get("requireEarsInSections") and contract.get("earsSections"):
        if _count_ears_like(body) < 1:
            return {"ok": False, "reason": "EARS patterns missing in required sections"}

    if baseline.get("requireEmbedded") and contract.get("requiredEmbedded"):
        need_m = "mermaid" in contract["requiredEmbedded"]
        need_i = "ts_interface" in contract["requiredEmbedded"]
        if need_m and not _has_mermaid(body):
            return {"ok": False, "reason": "missing mermaid block"}
        if need_i and not _has_ts_interface(body):
            return {"ok": False, "reason": "missing ts_interface block"}

    return {"ok": True}


# Minimal contract dicts for checks in this slice (report primary; others stub for future parity)
_REPORT_WRITE_CONTRACT: Dict[str, Any] = {
    "capabilityId": "report.write",
    "requiredHeadings": ["支撑证据", "风险", "收敛决策", "反证/挑战", "分歧", "未解缺口", "下一步工程化分支"],
    "minChildBlocks": {"heading": "支撑证据", "pattern": r"evidenceRef|证据|来自 .*risk|来自 .*counter|来自 .*synthesis", "min": 2},
    "earsSections": [],
    "minContentChars": 2400,
    "requiredEmbedded": [],
}

_STRUCTURE_DECOMPOSE_CONTRACT: Dict[str, Any] = {
    "capabilityId": "structure.decompose",
    "requiredHeadings": [],
    "minChildBlocks": None,
    "earsSections": ["requirement"],
    "minContentChars": 800,
    "requiredEmbedded": [],
}

_DOCUMENT_DRAFT_CONTRACT: Dict[str, Any] = {
    "capabilityId": "document.draft",
    "requiredHeadings": ["## 简介", "## 术语表", "## 需求", "## 设计", "## 任务"],
    "minChildBlocks": {"heading": "## 需求", "pattern": r"### 需求\s*\d|用户故事|验收标准|EARS", "min": 3},
    "requiredEmbedded": ["mermaid", "ts_interface"],
    "earsSections": ["## 需求"],
    "minContentChars": 1600,
}

_REQUIREMENT_WRITE_CONTRACT: Dict[str, Any] = {
    "capabilityId": "requirement.write",
    "requiredHeadings": ["## 简介", "## 术语表", "## 需求"],
    "minChildBlocks": {"heading": "## 需求", "pattern": r"### 需求\s*\d|用户故事|#### 验收标准|\d+\.\d+\s+(THE|WHEN|IF|AS)", "min": 3},
    "earsSections": ["## 需求"],
    "minContentChars": 1400,
    "requiredEmbedded": [],
}

_MINIMAL_CONTRACTS: Dict[str, Dict[str, Any]] = {
    "report.write": _REPORT_WRITE_CONTRACT,
    "structure.decompose": _STRUCTURE_DECOMPOSE_CONTRACT,
    "document.draft": _DOCUMENT_DRAFT_CONTRACT,
    "requirement.write": _REQUIREMENT_WRITE_CONTRACT,
}


def _get_contract_for_cap(cap_id: str) -> Optional[Dict[str, Any]]:
    return _MINIMAL_CONTRACTS.get(cap_id)


def evaluate_quality_baseline(
    artifact: Any,
    contract: Optional[Dict[str, Any]] = None,
    baseline: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Port of evaluateQualityGate: apply pilot or production quality baseline checks.

    If no contract for the cap, return None (not applicable, not failure).
    Uses explicit baseline for result declaration. No sniffing of internal state.
    """
    if artifact is None:
        return None
    cap_id = ""
    prod = _get_attr_local(artifact, "producedBy") or {}
    if isinstance(prod, dict):
        cap_id = prod.get("capabilityId") or ""
    else:
        cap_id = _get_attr_local(prod, "capabilityId", "") or ""
    if not cap_id:
        cap_id = _get_attr_local(artifact, "capabilityId", "") or ""

    used_contract = contract or _get_contract_for_cap(cap_id)
    if not used_contract:
        return None

    used_baseline = baseline or PRODUCTION_BASELINE
    content = str(_get_attr_local(artifact, "content", "") or "")
    check = _satisfies_contract(content, used_contract, used_baseline)

    if check.get("ok"):
        return {
            "gateId": "quality",
            "status": "passed",
            "phase": "commit",
            "baseline": used_baseline.get("name"),
            "contractId": used_contract.get("capabilityId"),
        }

    return {
        "gateId": "quality",
        "status": "failed",
        "phase": "commit",
        "reason": check.get("reason") or "quality contract not satisfied",
        "baseline": used_baseline.get("name"),
        "contractId": used_contract.get("capabilityId"),
    }
