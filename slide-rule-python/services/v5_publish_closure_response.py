"""Pure schema and derive for publishClosure/runtimeClosure response payloads in Python /drive-full.

Schema matches AppBundleRuntimeClosureReport shape (from TS evaluateAppBundleRuntimeClosure)
with pass-through summary for drive-full response payload:
  {
    blocked, blockerCount, evidencePresentCount, skillCount, versionPinsChecked,
    closureId, closureHash, stableDigest,
    tierCounts: {hard_blocker, warning, info},
    perSkillEvidence, topBlockers
  }

Focus: /drive-full schema + deterministic pass-through. No network/DB/provider calls.
Preserves degraded/error states by returning None (fail-closed).
Missing declared Skill evidence (skill in skillsChecked with evidencePresent=false) yields blocked=true in report (no green fake).
See also derive in routes for drive-full/drive-marathon.
Compatible with client/pages/sliderule/derive-cross-runtime-summary.ts PublishClosureSummary (python side provides authoritative).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from models.v5_state import V5SessionState


class PublishClosureTopBlocker(BaseModel):
    """Typed blocker entry for topBlockers (subset for response payload)."""
    code: str = ""
    path: str = ""
    affectedSkill: Optional[str] = None
    ref: Optional[str] = None


class PublishClosureTierCounts(BaseModel):
    """Typed tier counts for findingsByTier summary."""
    hard_blocker: int = 0
    warning: int = 0
    info: int = 0


class PublishClosureResponse(BaseModel):
    """Typed schema (Pydantic) for the publishClosure response payload returned by /drive-full.

    This is the Python-authored contract for AppBundle publish/runtime closure response.
    Used to validate shape when deriving from capability run results containing runtimeClosure.
    Exported for review, tests, and cross-runtime parity.
    """
    blocked: bool
    blockerCount: int
    evidencePresentCount: int
    skillCount: int
    versionPinsChecked: bool
    closureId: Optional[str] = None
    closureHash: Optional[str] = None
    stableDigest: Optional[str] = None
    tierCounts: PublishClosureTierCounts
    perSkillEvidence: Dict[str, Any] = Field(default_factory=dict)
    topBlockers: List[PublishClosureTopBlocker] = Field(default_factory=list)
    # 判定依据。blocked 只是结论，这两块是过程：
    # goalRelevance 说明「产出对不对得上题」（放行时也留分数，否则通过的那次
    # 完全无痕，事后无从判断关卡是真在起作用还是形同虚设）；
    # runConditions 是本轮的降级审计（K8s Condition 形状，见 run_degradation）。
    goalRelevance: Optional[Dict[str, Any]] = None
    runConditions: List[Dict[str, Any]] = Field(default_factory=list)
    # 交付面可用性（2026-09-06）：页数 / 角色数 / 每页可交互与录入控件 /
    # 未被服务的提交类需求。见 services/deliverable_surface.py。
    # `None` = 本轮没有页面，不归那道闸管（不是"量过了没问题"）。
    deliverableSurface: Optional[Dict[str, Any]] = None
    degradationSummary: str = ""
    # 精修没画上时给对话的那一句。空 = 本轮不是「保住上一版」。
    refinePaintNote: str = ""
    # 精修沿用收口句。空 = 左栏继续用「M 阶段 · N 步」。
    refineReuseNote: str = ""


def _as_dict(value: Any) -> Dict[str, Any]:
    """Adapter for /drive-full: accepts Pydantic model_dump results or plain dicts for capability results
    (and nested runtimeClosure). Supports model or dict pass-through while preserving fail-closed None.
    """
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        try:
            raw_attrs = getattr(value, "__dict__", {})
            exclude_keys = {
                key
                for key, nested in raw_attrs.items()
                if not key.startswith("_")
                and hasattr(nested, "model_dump")
                and not isinstance(nested, dict)
            }
            dumped = value.model_dump(exclude=exclude_keys) if exclude_keys else value.model_dump()
            if not isinstance(dumped, dict):
                dumped = {}
            for key, nested in raw_attrs.items():
                if key.startswith("_") or key in dumped:
                    continue
                dumped[key] = nested
            return dumped
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        return {
            key: nested
            for key, nested in getattr(value, "__dict__", {}).items()
            if not key.startswith("_")
        }
    return {}


def _tier_count(report: Dict[str, Any], tier: str) -> int:
    findings = _as_dict(report.get("findingsByTier")).get(tier)
    return len(findings) if isinstance(findings, list) else 0


def _to_publish_closure_summary(report: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    runtime = _as_dict(report.get("runtimeClosure"))
    if not runtime:
        return None

    per_skill = _as_dict(report.get("perSkillEvidence"))
    skills_checked = runtime.get("skillsChecked")
    if not isinstance(skills_checked, list):
        skills_checked = list(per_skill.keys())

    blockers = report.get("blockers")
    blocker_items = blockers if isinstance(blockers, list) else []
    top_blockers: List[Dict[str, Any]] = []
    for blocker in blocker_items[:3]:
        blocker_dict = _as_dict(blocker)
        top_blockers.append({
            "code": str(blocker_dict.get("code") or ""),
            "path": str(blocker_dict.get("path") or ""),
            "affectedSkill": str(blocker_dict.get("affectedSkill") or ""),
            "ref": str(blocker_dict.get("ref") or ""),
        })

    summary: Dict[str, Any] = {
        "blocked": bool(report.get("blocked")),
        "blockerCount": len(blocker_items),
        "evidencePresentCount": sum(
            1 for item in per_skill.values()
            if _as_dict(item).get("evidencePresent") is True
        ),
        "skillCount": len(skills_checked),
        "versionPinsChecked": bool(runtime.get("versionPinsChecked")),
        "closureId": report.get("closureId"),
        "closureHash": report.get("closureHash"),
        "stableDigest": report.get("stableDigest"),
        "tierCounts": {
            "hard_blocker": _tier_count(report, "hard_blocker"),
            "warning": _tier_count(report, "warning"),
            "info": _tier_count(report, "info"),
        },
        "perSkillEvidence": per_skill,
        "topBlockers": top_blockers,
        # 这是白名单投影：不在这里列出的字段一律被丢掉。新增闭环判定信号时
        # 记得同步加，否则前端只看到结论看不到依据（本次实测就漏过一轮）。
        "goalRelevance": report.get("goalRelevance") or None,
        # ⚠ 这一行不加就等于没做：白名单投影会把 deliverableSurface 静默丢掉，
        #   前端只看到 blocked 却看不到"为什么"——上一轮 goalRelevance 就漏过一次
        #   （见本 dict 上方那句注释）。判据钉在 test_deliverable_surface_gate.py。
        "deliverableSurface": _as_dict(report.get("deliverableSurface")) or None,
        "runConditions": [
            _as_dict(c) for c in (report.get("runConditions") or [])
        ],
        "degradationSummary": str(report.get("degradationSummary") or ""),
        "refinePaintNote": str(report.get("refinePaintNote") or ""),
        "refineReuseNote": str(report.get("refineReuseNote") or ""),
    }
    # Enforce typed schema (positive evidence of schema); raises on shape violation.
    PublishClosureResponse.model_validate(summary)
    return summary


def derive_publish_closure_response(state: V5SessionState) -> Optional[Dict[str, Any]]:
    """Derive publishClosure response payload from drive state.

    Scans reversed capabilityRuns for embedded runtimeClosure report (from appbundle.runtimeClosure cap)
    or direct result shape.

    Returns dict shaped per PublishClosureResponse (or None for fail-closed).
    Deterministic; no external calls.

    Fail-closed rules:
    - If no capabilityRuns or no runtimeClosure data found: return None
    - Degraded/error states in run are not special-filtered here (unlike graph); the presence of
      valid runtimeClosure inside result is what triggers return. Degraded full states are handled
      upstream by driver (e.g. publishClosure may be omitted or partial in caller). Preserves semantics.
    """
    if state is None:
        return None
    for run in reversed(getattr(state, "capabilityRuns", []) or []):
        run_data = _as_dict(run)
        result_raw = None if isinstance(run, dict) else getattr(run, "result", None)
        if result_raw is None:
            result_raw = run_data.get("result")
        result = _as_dict(result_raw)
        for candidate in (
            _as_dict(result.get("runtimeClosure")),
            result,
        ):
            summary = _to_publish_closure_summary(candidate)
            if summary is not None:
                return summary
    return None


# Public exports for typed schema (reviewable symbols)
__all__ = [
    "derive_publish_closure_response",
    "PublishClosureResponse",
    "PublishClosureTopBlocker",
    "PublishClosureTierCounts",
]
