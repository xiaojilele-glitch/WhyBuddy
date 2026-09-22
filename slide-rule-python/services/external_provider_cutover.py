"""External provider cutover readiness (100).

Builds on live smoke diagnostics to provide explicit cutover decision contract.
Outputs per-provider status including degraded.
Never treats config_missing/skipped as ready.
Only performs read-only checks when explicit config present.
Includes "deployed_python_service" to indicate the python backend itself for cutover classification.
"""
import os
import time
from typing import Any, Dict, List, Optional

try:
    from .external_dependency_live_smoke import (
        run_external_dependency_live_smoke,
        _should_skip,
        _get_env,
        _check_qdrant,
        _check_embedding,
        _check_generic,
    )
except Exception:
    # fallback for direct test import path
    from services.external_dependency_live_smoke import (  # type: ignore
        run_external_dependency_live_smoke,
        _should_skip,
        _get_env,
        _check_qdrant,
        _check_embedding,
        _check_generic,
    )


def _check_deployed_python_service(start: float) -> Dict[str, Any]:
    """本进程的装配根装起来了没有。

    ⚠ 2026-08-29 换掉了原来的写法。原来是函数体里 `import app`，成功就 ready。
    两个毛病：方向反的（业务层依赖装配根，grok 那边装配根被依赖数是 0），
    以及**它永远不会红**——uvicorn 用 `app:app` 起的，`sys.modules['app']` 早在了，
    这句 import 拿的是缓存必然成功；而 app 真炸了的话进程根本起不来，没人调得到
    这个接口。现在读装配根自己钉的标记，没装配过就老实说没装配过。
    见 services/composition_root_state.py 模块头。
    """
    dur = int((time.time() - start) * 1000)
    from .composition_root_state import composition_root_ready

    ready = composition_root_ready()
    if ready:
        return {
            "provider": "deployed_python_service",
            "status": "ready",
            "reason": "composition root assembled",
            "duration_ms": dur,
            "metadata": {"probe": "composition_root", **ready},
        }
    return {
        "provider": "deployed_python_service",
        "status": "degraded",
        "reason": "composition root not assembled in this process",
        "duration_ms": dur,
        "metadata": {"probe": "composition_root"},
    }


def run_external_provider_cutover_readiness() -> Dict[str, Any]:
    """Return cutover readiness with support for degraded status.
    Status values supported: ready, config_missing, skipped, failed, timeout, degraded
    """
    base = run_external_dependency_live_smoke()
    checks: List[Dict[str, Any]] = list(base.get("checks", []))

    # augment with deployed_python_service provider
    start = time.time()
    py_check = _check_deployed_python_service(start)
    checks.append(py_check)

    # allow forcing degraded for test coverage via env (non-prod)
    if os.getenv("FORCE_CUTOVER_DEGRADED", "").lower() in ("1", "true"):
        for c in checks:
            if c["provider"] in ("qdrant", "apm"):
                c["status"] = "degraded"
                c["reason"] = "forced degraded for cutover test"

    # recompute counts and overall with degraded awareness
    ready_count = sum(1 for c in checks if c["status"] == "ready")
    missing_count = sum(1 for c in checks if c["status"] == "config_missing")
    skipped_count = sum(1 for c in checks if c["status"] == "skipped")
    problem_count = sum(1 for c in checks if c["status"] in ("failed", "timeout"))
    degraded_count = sum(1 for c in checks if c["status"] == "degraded")

    if degraded_count > 0 or problem_count > 0:
        overall = "degraded"
    elif ready_count > 0 and missing_count == 0 and skipped_count == 0 and problem_count == 0 and degraded_count == 0:
        overall = "ready"
    elif missing_count > 0 and ready_count == 0:
        overall = "config_missing"
    else:
        overall = "partial"

    return {
        "overall": overall,
        "checks": checks,
        "duration_ms": base.get("duration_ms", 0),
        "counts": {
            "ready": ready_count,
            "skipped": skipped_count,
            "config_missing": missing_count,
            "failed_or_timeout": problem_count,
            "degraded": degraded_count,
        },
        "note": "degraded or config_missing or skipped means NOT ready for cutover. Providers with explicit ready can be considered for cutover only if no blockers.",
    }


# expose the statuses for tests/docs
CUTOVER_ALLOWED_STATUSES = ("ready", "config_missing", "skipped", "failed", "timeout", "degraded")
