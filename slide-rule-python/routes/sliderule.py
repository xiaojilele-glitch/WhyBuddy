"""
SlideRule V5 routes (baseline surface).

Exposes sessions, orchestrate-plan, execute-capability.

The execute-capability now delegates to execute_mapped_capability (capability_maps) for expanded caps
(structure.*, instruction.package, handoff.package, visual, etc.) in addition to core mcp/skill/evidence/report/risk.

Primary mounted surface in app.py is sliderule_full.py which also uses the mapped executor.
This is the thin Python V5 baseline; full historical Node cap parity + real vector RAG still in progress.
"""

import asyncio
import os

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from typing import Dict, Any, Optional
from models.v5_state import V5SessionState, ExecuteCapabilityResult, OrchestratePlanResult
from services.slide_rule_orchestrator import orchestrate_plan
from services.capability_maps import execute_mapped_capability
from config.settings import settings
from sliderule_llm.capabilities import execute_capability, is_python_native_capability
from sliderule_llm.client import LlmError
from sliderule_llm.evidence import execute_evidence_runtime

router = APIRouter()

# In-memory session store (migrate to DB like original Python project)
_sessions: Dict[str, V5SessionState] = {}
ORCHESTRATE_PLAN_TIMEOUT_MS_ENV = "SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS"
DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS = 120_000

def _check_internal_key(key: Optional[str]):
    if settings.is_development:
        return
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid internal key for SlideRule calls")

def _planner_timeout_seconds() -> float:
    raw = os.getenv(ORCHESTRATE_PLAN_TIMEOUT_MS_ENV, str(DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS
    return max(timeout_ms, 1) / 1000

def _bad_plan_request(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": "invalid_request",
            "reason": "bad_input",
            "message": message,
        },
    )

def _is_config_missing_error(error: Exception) -> bool:
    message = str(error).lower()
    return isinstance(error, LlmError) and (
        "not configured" in message
        or "no api_key" in message
        or "no api key" in message
        or "no provider chain" in message
    )

def _degraded_plan(error_code: str, reason: str, message: str) -> Dict[str, Any]:
    return {
        "selected": [],
        "rationale": "Python orchestrate.plan could not produce a planner result.",
        "source": "python-rag",
        "converged": False,
        "degraded": True,
        "error": error_code,
        "reason": reason,
        "message": message[:300],
        "fallbackAvailable": False,
    }

def _evidence_query(payload: Dict[str, Any]) -> str:
    state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
    goal = state.get("goal") if isinstance(state.get("goal"), dict) else {}
    return "\n".join(
        part
        for part in (
            str(goal.get("text") or "").strip(),
            str(payload.get("userText") or "").strip(),
        )
        if part
    )

async def _run_orchestrate_plan(payload: Any):
    if not isinstance(payload, dict):
        return _bad_plan_request("request body must be an object")
    if "state" not in payload:
        return _bad_plan_request("state is required")
    if not str(payload.get("turnId") or "").strip():
        return _bad_plan_request("turnId is required")

    try:
        state = V5SessionState(**payload["state"])
    except (TypeError, ValidationError, ValueError) as error:
        return _bad_plan_request(f"state is invalid: {str(error).splitlines()[0]}")

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                orchestrate_plan,
                state,
                str(payload["turnId"]),
                str(payload.get("userText", "")),
            ),
            timeout=_planner_timeout_seconds(),
        )
    except asyncio.TimeoutError:
        return _degraded_plan(
            "planner_timeout",
            "timeout",
            "Python orchestrate.plan timed out before producing a plan.",
        )
    except Exception as error:
        if _is_config_missing_error(error):
            return _degraded_plan("planner_config_missing", "config_missing", str(error))
        return _degraded_plan("planner_error", "runtime_error", str(error))

    return result.model_dump()

@router.post("/sessions")
async def create_or_update_session(state: V5SessionState, x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    _sessions[state.sessionId] = state
    return {"ok": True, "sessionId": state.sessionId}

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    if session_id not in _sessions:
        raise HTTPException(404, "Session not found")
    return {"state": _sessions[session_id].model_dump()}

@router.post("/orchestrate-plan")
async def do_orchestrate(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    return await _run_orchestrate_plan(payload)

@router.post("/execute-capability")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def do_execute(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    cap_id = payload["capabilityId"]
    # Migrated-for-real caps (intent.clarify, ...) run on the REAL LLM brain (sliderule_llm).
    # On LLM failure we 502 so the Node side falls back to its own path — we never silently
    # return canned/stub output for a cap that's supposed to be really migrated.
    if is_python_native_capability(cap_id):
        try:
            if cap_id == "evidence.search":
                evidence_result = execute_evidence_runtime(_evidence_query(payload))
                result = execute_capability(
                    payload,
                    evidence_retriever=lambda _query: evidence_result,
                )
                result.update(evidence_result.to_payload_fields())
                return result
            return execute_capability(payload)
        except LlmError as e:
            raise HTTPException(502, f"python LLM failed for {cap_id}: {e}")
    # Not yet migrated → existing mapped path (still stub until its slice lands).
    state = V5SessionState(**payload["state"])
    return execute_mapped_capability(
        cap_id,
        state,
        payload.get("inputArtifactIds", []),
        payload.get("roleId", "agent"),
        payload["turnId"],
    )

# Add more endpoints (list sessions, etc.) as full migration progresses.
