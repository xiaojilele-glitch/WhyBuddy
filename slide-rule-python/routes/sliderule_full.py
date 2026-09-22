"""
SlideRule V5 API (full baseline surface).

Mounted as the primary /api/sliderule in app.py.
Uses execute_mapped_capability for execute-capability (core + structure, instruction, handoff, visual etc.).
RAG-backed. Matches the Node delegation contract for V5 paths.

See audit / FINAL_MIGRATION_STATUS.md for exact coverage vs. "all historical caps".
"""

import asyncio
from contextlib import aclosing
from concurrent.futures import ThreadPoolExecutor
import base64
import binascii
import os
import re
import threading
import uuid

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from typing import Dict, Any, List, Optional
from models.v5_state import CapabilityRun, V5SessionState
from middlewares.current_user import CurrentUserOptional
# 顶层 import，别塞函数体（架构闸盯着逃生口，函数体 import 一样算数）。
# gate_health 是 util 叶子；page_edit_guard 在 core（它要 html_bindings 数据洞）。
from services.gate_health import (
    ledger_since as _gate_since,
    record_verdict as _gate_record,
    snapshot as _gate_snapshot,
    summary_line as _gate_summary,
)
from services.page_edit_guard import edit_losses, losses_message
from services import app_access, run_registry
from services.model_version_restore import restore_model_version_locked
from services.scope_authority import plan_execution_authorized, preferred_device_for_run, approved_plan_instruction, latest_control_plan
from services.rehearsal_control import stamp_control_plan_kind
from services.v5_llm_generate import set_approved_plan
from services.slide_rule_session import claim_session, create_session, delete_session, load_session, save_session, drive_reasoning_turn
from services.engine_scheduling import pick_next_capabilities
from services.persistence import PersistClosedError, load_all
from services.slide_rule_marathon import drive_marathon
from services.v5_full_driver import drive_full_v5_session, _result_to_dict
from services.v5_publish_closure_response import derive_publish_closure_response
from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response
from services.sliderule_session_sanitizer import sanitize_session_dict, sanitize_session_state
from services.slide_rule_orchestrator import orchestrate_plan
from services.v5_capability_executor import execute_v5_capability
from services.slide_rule_coverage import author_coverage_contract, evaluate_coverage_gate, reconcile_coverage
from services.capability_maps import execute_mapped_capability
from config.settings import settings
from services.project_access import project_access_enabled
from services.control_run_store import ControlRunConflict, ControlRunUnavailable, ControlRunNotFound
from services.control_run_service import (
    ControlRunService,
    overlay_live_control_phase,
    public_control_run,
)
from services.project_store import get_project_store
from sliderule_llm.capabilities import execute_capability, is_python_native_capability
from sliderule_llm.client import LlmError
from sliderule_llm.evidence import execute_evidence_runtime
from sliderule_llm.config import default_max_tokens

# Standardized Python provenance fields (values + attachment) for browser smokes
# and contract tests (e.g. test_v5_smoke.py). Python is source of truth.
# See foundation task 07. Node thin proxies must forward these verbatim.
PROVENANCE_PYTHON_RAG = "python-rag"
PROVENANCE_PYTHON_FULLPATH = "python-fullpath"
PROVENANCE_PYTHON_LLM = "python-llm"
PYTHON_BACKEND = "python"
STATE_AUTHORITY_PYTHON = "python"

# Delivery capability execution contract (task 14: Move delivery capability execution contracts to Python).
# These delivery caps execute via Python (native LLM when is_python_native_capability true, else mapped).
# Python FastAPI /execute-capability is now the backend API source of truth.
# Node delivery-exec-map.ts + isDeliveryCapability path only for SLIDERULE_V5_BACKEND=legacy thin compat.
DELIVERY_CAP_IDS: set[str] = {
    "document.draft",
    "traceability.matrix",
    "task.write",
    "instruction.package",
    "handoff.package",
}

# Visual capability execution contract (task 15: Move visual capability execution contracts to Python).
# ux.preview / outcome.visualize execute via Python (mapped or native paths in sliderule_full).
# Python FastAPI /execute-capability is the backend API source of truth for visual contract.
# Node visual-exec-map.ts + isVisualCapability only for SLIDERULE_V5_BACKEND=legacy thin compat.
VISUAL_CAP_IDS: set[str] = {
    "ux.preview",
    "outcome.visualize",
}

router = APIRouter(tags=["SlideRule V5 (Full Migration to Python)"])  # prefix handled at include time to avoid double /api/sliderule/api/sliderule/...

_sessions: Dict[str, V5SessionState] = {}  # In prod, use DB like Python knowledge
ORCHESTRATE_PLAN_TIMEOUT_MS_ENV = "SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS"
DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS = 120_000
EXECUTE_CAPABILITY_TIMEOUT_MS_ENV = "SLIDERULE_EXECUTE_CAPABILITY_TIMEOUT_MS"
DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS = 180_000

def _auth(key: Optional[str]):
    # Allow missing key in non-prod for direct frontend dev proxy to Python (vite /api/sliderule -> 9700)
    # Node proxy always injects X-Internal-Key for prod/compat paths. This enables smoke E2E from product UI.
    if key is None or key == "":
        if os.getenv("NODE_ENV", "development") != "production":
            return
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key - Python now owns V5")


def _turn_seq_for_drive_full(value: Optional[str]) -> int:
    if not value:
        return 0
    m = re.search(r"(\d+)", str(value))
    return int(m.group(1)) if m else 0


def _advance_drive_full_turn_id(value: Optional[str]) -> str:
    """Bump server-authored drive-full saves past same-turn client snapshots."""
    return f"turn-{_turn_seq_for_drive_full(value) + 1}-drive-full"


def _planner_timeout_seconds() -> float:
    raw = os.getenv(ORCHESTRATE_PLAN_TIMEOUT_MS_ENV, str(DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS
    return max(timeout_ms, 1) / 1000

def _execute_timeout_seconds() -> float:
    raw = os.getenv(EXECUTE_CAPABILITY_TIMEOUT_MS_ENV, str(DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS
    return max(timeout_ms, 1) / 1000

def _bad_plan_request(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": "invalid_request",
            "reason": "bad_input",
            "message": message,
            "backend": PYTHON_BACKEND,
            "source": "python",
            "provenance": PROVENANCE_PYTHON_RAG,
            "degraded": True,
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


def _evidence_query(payload: Dict[str, Any]) -> str:
    state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
    goal = state.get("goal") if isinstance(state.get("goal"), dict) else {}
    return "\n".join(
        part
        for part in (
            str(goal.get("text", "")),
            str(payload.get("userText", "")),
        )
        if part and str(part).strip()
    )

def _degraded_plan(error_code: str, reason: str, message: str) -> Dict[str, Any]:
    return {
        "selected": [],
        "rationale": "Python orchestrate.plan could not produce a planner result.",
        "source": PROVENANCE_PYTHON_RAG,
        "converged": False,
        "degraded": True,
        "error": error_code,
        "reason": reason,
        "message": message[:300],
        "fallbackAvailable": False,
    }

def _coerce_state_payload(raw_state: Any) -> Dict[str, Any]:
    if not isinstance(raw_state, dict):
        raise ValueError("state must be an object")

    # Frontend session GET returns { state, stateAuthority, provenance, backend }. During local
    # Python-first dev the client can keep that wrapper and merge fresh runtime
    # fields beside it before POST /orchestrate-plan. Python owns the endpoint,
    # so accept the wrapper instead of forcing the browser to special-case it.
    inner = raw_state.get("state")
    if isinstance(inner, dict):
        merged = dict(inner)
        for key, value in raw_state.items():
            if key in {"state", "provenance", "backend"}:
                continue
            merged[key] = value
        return merged

    return raw_state


def _perform_native_execute(payload: Dict[str, Any], cap: str) -> Dict[str, Any]:
    """Sync function offloaded via to_thread for native LLM/RAG execute paths. Returns dict result."""
    if cap == "evidence.search":
        q = _evidence_query(payload)
        ev = execute_evidence_runtime(q)
        res = execute_capability(payload, evidence_retriever=lambda _q: ev)
        res = res if isinstance(res, dict) else dict(res)
        res.update(ev.to_payload_fields())
        return res
    else:
        res = execute_capability(payload)
        return res if isinstance(res, dict) else dict(res)


def _with_approved_plan(state, function, *args, **kwargs):
    """Bind the durable plan in the worker that actually builds the model prompt."""
    set_approved_plan(latest_control_plan(state).get("planContent"))
    try:
        return function(*args, **kwargs)
    finally:
        set_approved_plan(None)


def _perform_mapped_execute(cap: str, state: V5SessionState, input_artifact_ids: List[str], role: str, turn: str) -> Dict[str, Any]:
    """Sync function offloaded via to_thread for mapped capability execution."""
    return execute_mapped_capability(cap, state, input_artifact_ids, role, turn)


async def _run_orchestrate_plan(payload: Any):
    if not isinstance(payload, dict):
        return _bad_plan_request("request body must be an object")
    if "state" not in payload:
        return _bad_plan_request("state is required")
    if not str(payload.get("turnId") or "").strip():
        return _bad_plan_request("turnId is required")

    try:
        # orchestrate-plan may receive state with previously elevated artifacts from prior loop commits.
        # Use server_load for consistency with execute and persisted state handling.
        state = V5SessionState.server_load(_coerce_state_payload(payload["state"]))
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

    # PYTHON_AUTHORITY for pickNextCapabilities: the /orchestrate-plan API must return selected
    # derived from the ported pick semantics + all fallback rules (readiness, delivery, cold,
    # stale, skip-ev, complex/game, etc.), not the orchestrator's internal fixed-candidate list.
    # Drivers already call pick explicitly; now the exposed backend API delegates selected too.
    # rationale stays from orchestrate (for plan text), but selected/converged from pick.
    picks = pick_next_capabilities(state, str(payload.get("userText", "")))
    dumped = result.model_dump()
    dumped["selected"] = picks
    dumped["converged"] = len(picks) == 0
    return dumped

# ── 同步路由为什么写成 `def` 而不是 `async def`（2026-08-10）──────────────
#
# 事故：两台电脑同时开着页面，一台发起推演，另一台**一直转圈**。
#
# 病根不是 worker 数（Dockerfile 里 uvicorn 确实只有 1 个 worker），是这些
# 路由标着 `async def` 却在里面做**同步网络 IO**——会话档走 HTTPS 网关
# （httpx.Client 是阻塞的）。`async def` 的函数体直接跑在事件循环上，一阻塞
# 就是整个进程停摆，所有别人的请求一起排队。
#
# 实测（对着线上库）：
#     GET /sessions 的 load_all()  →  34 条会话、5.2 MB payload、2278 ms
# 2026-08-19：列表改走 list_summaries（库内 JSON 抽取，不把 payload 拉回进程）。
# 点进某一条才 GET /sessions/{sid} 读完整 blob。
#
# 框架本来就给了答案。fastapi/routing.py:344 —
#
#     if is_coroutine:
#         return await dependant.call(**values)          # async def：跑在循环上
#     else:
#         return await run_in_threadpool(dependant.call, **values)   # def：进线程池
#
# 而 starlette 的 `run_in_threadpool` 就是 `anyio.to_thread.run_sync`
# （默认 40 个令牌，本进程实测）。**所以同步路由写成 `def` 才是对的**，
# 写成 `async def` 反而是把它钉死在循环上——FastAPI 文档里"拿不准就用 def"
# 说的正是这件事。
#
# 判据：函数体里**一个 await 都没有** → 一律 `def`。有 await 的（exec_cap /
# drive_full_stream / fork_generated_app）不能改签名，改成在阻塞调用外面套
# `await asyncio.to_thread(...)`。
#
# ⚠ 别顺手加 `--workers`。services/run_registry 模块头明写「单进程内存实现」：
# 多进程下 POST 发起的 run 与 GET /runs/{id}/stream 续播会落到不同进程，
# 断线重连找不到 run，"同会话已有活跃 run 就附着"的防重复也会失效。
# 真要多进程，得先照 vercel/resumable-stream 那套把 run 日志挪到进程外
# （那个库的 README 第一句就是 "Designed for use in serverless environments
# without sticky load balancing"，靠的是 Redis pub/sub——我们抄了它的契约，
# 没抄它的载体）。
@router.get("/sessions")
def list_sess(
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """Thin list for Node thin-proxy compat. Returns slim list shape matching prior Node contract.

    2026-08-06 补归属过滤。此前这条路由**没有 viewer 参数**，直接 load_all()
    全量返回——实测匿名请求能列出全站所有人的会话，连业务目标原文都在里面。
    过滤复用 app_access（会话与应用共用同一套阶梯），不另写条件：列表与单条
    判定漂移是这类系统最常见的泄漏方式。

    ⚠ 2026-08-19：归属过滤之后仍 `load_all()`。侧栏只需要 id / 目标 / 阶段 /
    产物数 / 时间戳，却把每一条会话的整页 HTML 经 HTTPS 网关拉回来
    （34 条 5.2 MB / 2.3s）。完整 blob 只在 GET /sessions/{sid}。
    """
    _auth(x_internal_key)
    from services import app_store
    from services.app_access import session_access, Access
    from services.persistence import list_session_summaries

    # 会话摘要 与 会话→应用封面索引：**并发发**，它们互不依赖。
    #
    # 真机实测（2026-08-24，HTTPS SQL 网关）：摘要 140ms、封面 145ms（它内部
    # 那两条也已经并发）。串行 ~420ms，并发 ~145ms。GET /sessions 是侧栏和应用
    # 中心共用的首屏接口，这一下省的是每次开工作台都要付的时间。
    #
    # ⚠ 封面这条**必须**再兜一层，哪怕 session_covers 自己已经 fail-open：那层
    #   兜的是"后端查询挂了"，兜不住它自己有 bug（形状变了、TypeError）。缩略图
    #   是增强类（本仓第七条），而把 GET /sessions 拖成 500 等于整个工作台白屏，
    #   比没有封面严重得多。
    #
    # ⚠ 摘要那条**不兜**：它是这个接口的正事，拿不到就该如实报错，不能假装
    #   "你没有会话"。增强类 fail-open、主链路 fail-closed，别混（第七条）。
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="sessions-list") as pool:
        summaries_future = pool.submit(list_session_summaries)
        covers_future = pool.submit(app_store.session_covers)
        try:
            covers = covers_future.result()
        except Exception as exc:  # noqa: BLE001 — 增强项，不许拖垮主链路
            print(f"[sessions] 封面索引不可用，本次按「会话无绑定应用」列出: {str(exc)[:160]}")
            covers = {}
        summaries = summaries_future.result()

    items = []
    for summary in summaries:
        if session_access(
            {"sessionId": summary.get("sessionId"), "ownerId": summary.get("ownerId")},
            viewer,
        ) < Access.READ:
            continue
        sid = summary.get("sessionId") or ""
        item = {
            "sessionId": sid,
            "goal": summary.get("goal") or "",
            "createdAt": summary.get("createdAt"),
            "lastActive": summary.get("lastActive"),
            "artifactCount": int(summary.get("artifactCount") or 0),
            "phase": summary.get("phase"),
        }
        # ⚠ 2026-08-24：会话摘要带上 appId + 缩略图三件套。
        #
        # 应用中心把「全部会话」和「**一页**应用」合并去重（mergeGalleryItems 按
        # session_id 认领）。会话是一次拉全的 65 条，应用却是 limit=14 的一页，
        # 于是 51 个会话认不到自己的应用，各摆一张没封面的空卡，滚到下一页才被
        # 真应用卡换掉。真机：66 张卡只有 14 张有图，而库里 67 张图都在。
        #
        # 字段名与应用摘要（_mark_previews）**一模一样**，前端那条
        # shouldUseSheetThumb 不用分两套判定——两套判定漂移是本仓反复踩的形状。
        #
        # ⚠ 归属不用另判：这条会话已经过了上面 session_access >= READ，
        #   而这里给的是**它自己那版应用**的封面，不是别人的货架。
        cover = covers.get(sid)
        if cover:
            item["appId"] = cover["app_id"]
            item["version"] = cover["version"]
            item["device"] = cover["device"]
            item["has_preview"] = cover["has_preview"]
            item["preview_source"] = cover["preview_source"]
            item["preview_tag"] = cover["preview_tag"]
        items.append(item)
    return {"sessions": items}

def _session_payload(state: Any) -> Dict[str, Any]:
    """把会话状态取成 app_access 认识的 payload（dict 或 pydantic 模型都收）。"""
    if isinstance(state, dict):
        return state
    return {
        "sessionId": getattr(state, "sessionId", ""),
        "ownerId": getattr(state, "ownerId", None),
    }


@router.get("/usage")
def usage_summary(
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """用量统计：把当前访问者**读得到的**会话里的 costLedger 聚合成一份账。

    ## 数据从哪来
    每次能力执行都会往 state.costLedger 记一条 CapabilityCostRecord
    （estimatedTokens / estimatedCostUsd / durationMs / source，见
    models/v5_state.py 与 slide_rule_executor._write_capability_telemetry）。
    账一直在记，只是此前**没有任何一个接口把它读出来**——设置面板要展示
    用量，缺的是出口不是台账。

    ## 归属口径与 GET /sessions 完全同一条
    session_access >= READ 才计入。匿名访问者读不到任何会话 → 空账，
    与会话列表"匿名返回空"同一行为，不另发明第二套判定（列表与聚合
    漂移就是泄漏：A 看不见的会话却出现在 A 的账单里）。

    ## 为什么如实带 source
    绝大多数记录是 source="estimated"（len(content)//4 的粗估），不是
    计费口径。前端必须能把「估算」两个字写在脸上——把估算当账单是
    比没有账单更糟的事。
    """
    _auth(x_internal_key)
    from services.app_access import session_access, Access
    from services.cost_ledger import ledger_entries

    states = list((load_all() or {}).values()) or list(_sessions.values())
    totals = {"sessions": 0, "runs": 0, "estimatedTokens": 0,
              "estimatedCostUsd": 0.0, "durationMs": 0}
    by_capability: Dict[str, Dict[str, Any]] = {}
    by_day: Dict[str, Dict[str, Any]] = {}
    by_source: Dict[str, int] = {}
    by_session: Dict[str, Dict[str, Any]] = {}

    for s in states:
        if session_access(_session_payload(s), viewer) < Access.READ:
            continue
        ledger = ledger_entries(s)
        if not ledger:
            continue
        sid = (
            s.get("sessionId")
            if isinstance(s, dict)
            else getattr(s, "sessionId", "")
        )
        raw_goal = (
            s.get("goal") if isinstance(s, dict) else getattr(s, "goal", None)
        )
        g = raw_goal if isinstance(raw_goal, dict) else {}
        goal_text = (g.get("text", "") if isinstance(g, dict) else "")[:60]
        totals["sessions"] += 1
        sess_agg = by_session.setdefault(sid, {
            "sessionId": sid, "goal": goal_text, "runs": 0,
            "estimatedTokens": 0, "estimatedCostUsd": 0.0,
        })
        for rec in ledger:
            r = rec if isinstance(rec, dict) else (
                rec.model_dump() if hasattr(rec, "model_dump") else {}
            )
            tokens = int(r.get("estimatedTokens") or 0)
            cost = float(r.get("estimatedCostUsd") or 0.0)
            duration = int(r.get("durationMs") or 0)
            cap = str(r.get("capabilityId") or "unknown")
            source = str(r.get("source") or "estimated")
            day = str(r.get("createdAt") or "")[:10]

            totals["runs"] += 1
            totals["estimatedTokens"] += tokens
            totals["estimatedCostUsd"] += cost
            totals["durationMs"] += duration
            by_source[source] = by_source.get(source, 0) + 1
            sess_agg["runs"] += 1
            sess_agg["estimatedTokens"] += tokens
            sess_agg["estimatedCostUsd"] += cost

            cap_agg = by_capability.setdefault(cap, {
                "capabilityId": cap, "runs": 0,
                "estimatedTokens": 0, "estimatedCostUsd": 0.0, "durationMs": 0,
            })
            cap_agg["runs"] += 1
            cap_agg["estimatedTokens"] += tokens
            cap_agg["estimatedCostUsd"] += cost
            cap_agg["durationMs"] += duration

            if day:
                day_agg = by_day.setdefault(day, {
                    "date": day, "runs": 0,
                    "estimatedTokens": 0, "estimatedCostUsd": 0.0,
                })
                day_agg["runs"] += 1
                day_agg["estimatedTokens"] += tokens
                day_agg["estimatedCostUsd"] += cost

    return {
        "totals": totals,
        "byCapability": sorted(
            by_capability.values(),
            key=lambda x: (-x["estimatedTokens"], x["capabilityId"]),
        ),
        "byDay": sorted(by_day.values(), key=lambda x: x["date"]),
        "bySource": by_source,
        "bySession": sorted(
            by_session.values(), key=lambda x: -x["estimatedTokens"]
        )[:20],
    }


def _adopt_owner(state, viewer):
    """会话没有归属时，认到当前访问者名下。**每个"从请求体造会话"的地方都要调。**

    ## 为什么要有这么一个函数

    2026-08-06 的方案 B 定了「不让无主会话这个状态存在」，但只堵了
    `POST /sessions` 一条路。实际上从请求体造会话的地方有**四处**：

        POST /sessions        建会话        ← 只有这条设了归属
        PUT  /sessions/{sid}  保存（可建）  ← 没设
        POST /drive-full      推演（可建）  ← 没设
        POST /drive-full-stream            ← 没设

    后三条建出来的会话是无主的，而无主会话 `session_record` 恒判 private、
    `access_for` 只给超管 —— 也就是**建出来就没人读得到**。表现极具误导性：
    请求返回 200，紧接着 GET 同一个 id 返回 404。

    套件里 11 条测试红在这个形状上，红了好几天，因为它看着像鉴权回归。

    ## 为什么不在模型默认值里做

    ownerId 是**请求上下文**的东西，V5SessionState 是纯数据模型，不该去摸
    contextvars。放在路由层、每个入口显式调一次，看得见也搜得到。
    """
    if getattr(state, "ownerId", None):
        return state
    owner = str(getattr(viewer, "id", "") or "").strip()
    if owner:
        state.ownerId = owner
    return state


def _require_session(state: Any, action: str, viewer) -> None:
    """会话动作的统一守卫。

    级别不够抛 404 而不是 403 —— 与 app_access.require 同一取向：403 等于告诉
    对方"这个 id 存在但你没权限"，把 id 的存在性也泄漏出去了。
    """
    # `app_access` 已在模块顶层 import —— 函数体 import 是架构闸盯着的棘轮
    # （`baseline.deferred` 只许变少），别在这里新开一条。
    if not app_access.can_session(action, _session_payload(state), viewer):
        raise HTTPException(404, "Not found")


def _drive_state(payload: Dict[str, Any], viewer) -> V5SessionState:
    """Authorize the server snapshot before any legacy driver can execute.

    2026-09-11: login alone let another user drive a private session, and the
    turn/marathon routes trusted a forged client owner and state. New sessions
    still work, but their owner always comes from the authenticated viewer.
    """
    try:
        raw_state, _ = sanitize_session_dict(_coerce_state_payload(payload.get("state", {})))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc).splitlines()[0] or "invalid_state") from exc
    sid = str(raw_state.get("sessionId") or payload.get("sessionId") or "").strip()
    persisted = (load_session(sid) or _sessions.get(sid)) if sid else None
    if persisted is not None:
        _require_session(persisted, "drive", viewer)
        persisted, _ = sanitize_session_state(persisted)
        if persisted.runtimeKind == "project":
            raise HTTPException(409, "project_html_factory_not_supported")
        if not plan_execution_authorized(persisted):
            raise HTTPException(409, "plan_approval_required")
        return persisted
    raw_state.pop("ownerId", None)
    for key in ("controlTranscript", "controlTodo", "controlSkillCache", "modelVersions", "currentModelVersionId", "capabilityRuns", "specFirstPages", "awaitReason", "awaitDetail"):
        raw_state.pop(key, None)
    if sid:
        raw_state["sessionId"] = sid
    try:
        candidate = _adopt_owner(V5SessionState(**raw_state), viewer)
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc).splitlines()[0] or "invalid_state") from exc
    # A second first turn must see the winner before either driver starts.
    try:
        claimed = claim_session(candidate)
    except PersistClosedError as exc:
        raise HTTPException(503, "session_store_unavailable") from exc
    _require_session(claimed, "drive", viewer)
    if not plan_execution_authorized(claimed):
        raise HTTPException(409, "plan_approval_required")
    return claimed


def _require_run_session(session_id: str, action: str, viewer) -> V5SessionState:
    """`/runs/*` 的归属守卫：按**这个 run 属于哪个会话**判权限。

    ## 事故（2026-09-06 审计，三个端口上实测）

    `/runs/*` 五条此前只有 `_auth(x_internal_key)`，而 `_auth` 在
    `NODE_ENV != production` 下**是 no-op**（它自己的注释写着这是为了让 vite
    直连 Python 的开发代理能跑）。实测不带任何 cookie：

        GET /api/sliderule/runs/active?sessionId=<别人的会话>
            :3000 → 200    :3001 → 200    :9700 → 200
        对照 GET /api/sliderule/sessions/<同一个 id>
                           → 404          （归属判定生效）

    也就是说：会话本体拦住了，**围着它的那圈 run 接口全是敞开的**。
    敞开的不只是读：

        DELETE /runs/{id}         杀掉别人正在跑的推演
        POST   /runs/{id}/hold    把别人的推演停在下一个安全点
        POST   /runs/{id}/release 替别人回答假设卡

    这是本仓反复数到的形状：**主资源装了闸，围着它的附属接口没装**。

    ## 口径与 `_require_session` 完全同一条

    级别不够抛 **404 而不是 403** —— 403 等于告诉对方"这个 id 存在但你没权限"，
    把 run id / session id 的存在性也泄漏出去了（见 app_access.require 头注）。

    动作沿用既有词表，不新造：
        view   读（active / stream）                    → READ
        drive  改这一轮的走向（cancel / hold / release）→ WRITE

    ## ⚠ 会话查不到也拒绝

    查不到就没法判归属，此时"放行"等于默认公开。fail-closed，报同一个 404。
    """
    state = load_session(session_id) or _sessions.get(session_id)
    if state is None:
        raise HTTPException(404, "Not found")
    _require_session(state, action, viewer)
    return state


def _visible_run(run_id: str, action: str, viewer):
    """按 run id 找 run，并按它所属会话判权限。**看不见和不存在都返回 None。**

    ## ⚠ 为什么这里不抛，而是返回 None

    第一版是"找不到返回 None、看不见抛 404"。写完跑判据当场露馅：

        run 不存在        → 200 {"cancelled": false}   （既有契约）
        run 存在但看不见  → 404

    这两个**可区分**，于是它自己变成一个枚举探针——正好把 404-不-403 那条
    纪律（不泄漏 id 的存在性）在同一个接口上又破掉一次。

    所以两种情况在这里合并成同一个 None，由调用方按**它自己既有的**
    "什么也没发生"形状回话：

        cancel / hold / release   200 + false（真机竞态是常态，不是错误）
        stream                    404 {"error": "run_not_found"}

    调用方形状不同没关系，要紧的是**同一个接口上两种情况说同一句话**。
    """
    run = run_registry.get_run(run_id)
    if run is None:
        return None
    session_id = str(getattr(run, "session_id", "") or "")
    state = load_session(session_id) or _sessions.get(session_id)
    if state is None:
        # 查不到会话就没法判归属。fail-closed：此时"放行"等于默认公开。
        return None
    if not app_access.can_session(action, _session_payload(state), viewer):
        return None
    # The session ID can be deleted and reused; old events keep their owner.
    if not app_access.can_session(action, {"ownerId": run.owner_id}, viewer):
        return None
    return run


# ── 副本会话的话题问题：**已经修好了，这里只留教训**（2026-08-06→08-07）──
#
# 现象（用户实测）：「我发布的是从文献到引用的话题，回答的是电动车方面的
# 内容，但是生成的应用又却是对的。」
#
# 真因不在这个文件里：execute_v5_capability 压根没有 user_instruction 这个
# 参数，只读 state.goal。从应用中心 fork 出来的副本 goal.text 继承自源应用，
# 于是各能力按旧话题干活（左侧过程整篇是电动车），而五系统生成走另一条通道
# 吃 user_instruction（右侧应用是对的）。
#
# **修法见 services/v5_capability_executor.compose_capability_topic**（aa284b5）：
# 话题与本轮要求**并存并分别打标签**，不互相顶替——形状照 CrewAI 的
# role_playing/task 与 LangChain v1 的 system/human 两片式。
#
# ## 这里为什么还留着这段
#
# 我在这个文件里试过一版错的修法（adopt_user_goal：本人第一条指令顶掉继承来
# 的话题），实测把生成整个跑没了：
#
#     v5_full_driver._ensure_runtime_closure_evidence:
#         if instruction and instruction != goal_text and current_model:
#             …进入 refine
#         else:
#             return state          ← 什么都不做
#
# `instruction != goal_text` 正是进入 refine 的条件，把话题顶平等于让它永远
# 不成立。实测：推演 23.7 秒返回，goal 变成了新话题而 modelVersions 里仍然
# 只有那份健身房模型。修好了"过程串话题"，代价是"结果根本不生成"。已回退
# （0e0d04a）。
#
# 教训有两条，都不只针对这一处：
#   ① 改判据之前先查**谁在读这个判据**——goal 与 instruction 的"不相等"
#      本身就是一个开关。
#   ② 端到端跑一趟再报"修好了"。这个回归单测抓不到（话题接管确实生效），
#      只有真跑完看 modelVersions 才露馅。
#
# fork 会话的 goal 仍然带 inherited 标记，如实标注"这话题是继承来的"，
# 不改变任何行为。


def _require_login(viewer) -> None:
    """建会话与推演都必须登录。

    2026-08-02 用户裁决"匿名只能查看"时只管了推演；2026-08-06 方案 B 之后
    建会话也走这里——所以名字从 _require_login_to_drive 改成中性的
    _require_login，免得下一个人以为它只跟推演有关。

    为什么在这里拦而不是只靠前端藏按钮：那套 RBAC 后台的字段权限就是只藏了前端、
    后端照样返回全部字段。**前端藏起来的按钮不等于后端拦得住。**

    为什么不是按应用归属判：推演的入口是会话，而新会话此刻还没有对应的应用记录
    （应用是推演到闭环之后才落库的）。所以这一层只管"是不是登录了"，
    针对具体应用的写权限由 app_access 在落库/改版那一侧把关。
    """
    if viewer is None:
        raise HTTPException(
            status_code=401,
            detail="请先登录后再推演",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # 推演闭环时应用会落库（v5_capability_executor），那里距离这里隔着好几层。
    # 用 contextvar 把归属带下去，而不是给沿途十几个函数都加一个参数。
    from services.request_context import set_current_user

    set_current_user(viewer)


def _require_superuser(viewer) -> None:
    """服务器级配置（LLM 通道 override、全量导出）只归平台管理员。

    2026-08-14 审计补：这几条路此前只有 `_auth`（内部密钥），而非生产环境
    密钥可以不带——等于任何能连到端口的人都能改服务端 LLM 通道、拖走全部
    应用记录。判定与 app_access._is_super 同一字段（is_superuser），
    不另发明第二套管理员概念。
    """
    _require_login(viewer)
    if not bool(getattr(viewer, "is_superuser", False)):
        raise HTTPException(status_code=403, detail="需要管理员权限")


@router.post("/sessions")
def create_sess(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    # 建会话必须登录（2026-08-06，用户裁决"方案 B"）。
    #
    # 为什么从源头堵而不是事后定规则：允许匿名建会话就必然产生**无主会话**，
    # 而"无主该给谁看"没有好答案——给所有人看就是泄漏（实测：没登录建的会话，
    # 登录后照样出现在列表里）；只给超管看则游客连自己刚建的那条都读不回来。
    # 不让这个状态存在，比事后给它定规则干净。
    #
    # 代价：游客不能试用。可以接受，因为推演本来就已经要求登录
    # （_require_login_to_drive）——一个建得出来却推不动的会话没有意义。
    _require_login(viewer)
    # 把访问者放进请求上下文，create_session 深处才取得到 ownerId
    # （contextvars，见 services/request_context.py 顶部）。
    #
    # ⚠️ 漏了这两行的后果**不是报错，是会话建出来永远无主** —— 实测踩过：
    # 带着有效 token 建的会话，ownerId 仍然是 None，于是匿名照样读得到、
    # 列得出。归属链路上任何一环断掉都是这个形状：静默地退回"人人可见"。
    from services.request_context import set_current_user

    set_current_user(viewer)

    # ── 客户端自带 sessionId 时必须先查重（2026-08-06，实测出来的劫持漏洞）──
    #
    # 前端是**懒创建**的：newSessionId() 先在本地生成一个 id 就切过去
    # （client/.../SidebarSessions.tsx:32），用户真发第一条消息时才 POST 上来。
    # 所以这条路由必须接受客户端指定 id，不能一律用服务端生成的。
    #
    # 但原来它接受之后**直接覆盖**，实测后果是整条会话被劫走：
    #
    #     受害者建   goal="受害者的机密业务想法"  owner=YkYF…
    #     攻击者拿着同一个 id 发一次 POST      → HTTP 200
    #     受害者再读 goal="攻击者覆盖"          owner=jIKM…（攻击者）
    #
    # 内容被覆盖、归属被改成攻击者的。上一版加的归属判定在这条路上完全没生效
    # ——它只判"建的时候是谁"，没判"这个 id 已经是别人的了"。
    #
    # 修法：id 已存在时不再是"建"，而是"取"。
    #   · 自己的（或超管）→ 原样返回，幂等；前端重发同一个 id 不会丢东西
    #   · 别人的         → 404（不是 403：403 等于承认"这个 id 存在"）
    requested_id = str(payload.get("sessionId") or "").strip()
    if requested_id:
        existing = load_session(requested_id) or _sessions.get(requested_id)
        if existing is not None:
            _require_session(existing, "drive", viewer)
            existing, _changed = sanitize_session_state(existing)
            return {
                "sessionId": existing.sessionId,
                "state": existing.model_dump(),
                "stateAuthority": STATE_AUTHORITY_PYTHON,
                "provenance": PROVENANCE_PYTHON_FULLPATH,
                "backend": PYTHON_BACKEND,
            }

    # ⚠ 2026-09-08 真机（scripts/run_real_topics.py 第一条就撞上）：这里的
    #   兜底曾是字面量 "default"。不带 goal 建的会话于是拿到一个**叫
    #   「default」的产品**——`_has_product_topic` 看它非空又不是确认词，判真，
    #   于是控制面把 scope_card / search_evidence 摆给模型，模型开卡、
    #   自动授予、`capabilityPlan=product-rehearsal tools=spec`：
    #   一句「你好」真去起草了 SPEC（真机 25 秒，事件里连 complete 都没有）。
    #
    #   前端建会话发的是 `{"goal":{"text":""}}`，所以产品路径没踩到；踩到的是
    #   任何**省掉 goal** 的调用方（脚本、集成、以后新写的路由）。占位串放进
    #   语义字段就是这个形状：它不会报错，只会在下游被当成真东西。
    #   空目标要 fail-closed 成空，不是 fail-open 成一个假产品（§7）。
    goal_text = payload.get("goal", {}).get("text", "") or ""
    repaired_payload, _ = sanitize_session_dict({"goal": {"text": goal_text}})
    try:
        state = create_session(repaired_payload.get("goal", {}).get("text", goal_text), requested_id or None)
    except PersistClosedError as exc:
        raise HTTPException(503, "session_store_unavailable") from exc
    _require_session(state, "view", viewer)
    state, changed = sanitize_session_state(state)
    # If sanitize mutated the state, persist via save_session so the authoritative
    # store is consistent. create_session already persisted (guarded per-record
    # save), but that was before the sanitize pass — re-save only when changed.
    if changed:
        state = save_session(state)
    return {"sessionId": state.sessionId, "state": state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.get("/sessions/{sid}")
def get_sess(
    sid: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    state = load_session(sid) or _sessions.get(sid)
    if not state:
        raise HTTPException(404, "Not found")
    _require_session(state, "view", viewer)
    state, changed = sanitize_session_state(state)
    if stamp_control_plan_kind(state):
        changed = True
    if changed:
        # Best-effort persist of the sanitized state so subsequent GETs and the service layer
        # see the corrected version. NOTE: the persistence concurrency guard retains the prior
        # core state for equal lastTurnId (stale-clobber protection), so the write may be a
        # no-op — the GET response must still return the repaired state, not the guard's
        # prior (mojibake) snapshot. Do not reassign from save_session here.
        try:
            save_session(state)
        except PersistClosedError:
            # sanitize 落盘是增强：存档失败不该把 GET 打成 500。
            pass
    presented = state
    try:
        # 叠在落盘之后。写回 orchestrating = abandoned stream 侧栏僵死。
        presented = overlay_live_control_phase(
            state, ControlRunService.observer(get_project_store()).store)
    except Exception:
        presented = state
    return {"state": presented.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

def _cap_turn_narrations(state: V5SessionState) -> None:
    """E13 展示数据封顶。实现与驱动器共用，避免 PUT 一条、drive 一条。"""
    from services.turn_narration import cap_turn_narrations

    cap_turn_narrations(state)


@router.put("/sessions/{sid}")
def save_sess(
    sid: str,
    state: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    # 归属按**库里那条**判，不按客户端传上来的 state 判——否则伪造一个
    # ownerId 就能改别人的会话。这条已存在时必须够 WRITE 才放行。
    _existing = load_session(sid) or _sessions.get(sid)
    if _existing is not None:
        _require_session(_existing, "drive", viewer)
    # Sanitize client PUT body to prevent forging server-owned fields per V5.2 authority.
    # coverageGate, capabilityRuns, artifacts trust and ledgers + sessionReplayLog/reasoningEvents (server append-only) are server-owned only.
    # Load existing (may be server_trusted via load path) and retain/merge those; client updates only safe fields.
    # Normal V5SessionState parse on unsanitized client body would reject elevated artifacts; we sanitize first
    # so full GET state roundtrips are accepted at transport, but server values win.
    # sessionReplayLog / reasoningEvents are append-only server fields (see persistence merge).
    client_input: Dict[str, Any] = dict(state) if isinstance(state, dict) else {}
    client_input, _ = sanitize_session_dict(client_input)
    client_input.pop("coverageGate", None)
    client_input.pop("capabilityRuns", None)
    client_input.pop("decisionLedger", None)
    client_input.pop("costLedger", None)
    client_input.pop("flowBoundaryLedger", None)
    client_input.pop("structureGateLedger", None)
    # Protect server-owned append-only replay from client/stale overwrite (task requirement)
    client_input.pop("sessionReplayLog", None)
    client_input.pop("reasoningEvents", None)
    # 归属是**服务端的**，客户端 PUT 一律不许带（2026-08-09）。
    #
    # 原来它既没被 pop、也不在下面 merge 的 exclude 里，于是两个方向都漏：
    #
    #   带了 ownerId → 客户端能改归属（写权限已判过，但归属不该由请求体决定）
    #   没带 ownerId → **merge 时把服务端那条覆盖成 None，会话静默变无主**
    #
    # 第二条才是要命的：前端每次保存状态都 PUT 一次全量 state，而它的
    # V5SessionState 里 ownerId 默认 None。也就是说**正常使用一次就把归属抹了**，
    # 之后这条会话谁都读不到（无主 = private = 只有超管可见）。
    # 实测：POST 建好（owner=u-test-default）→ PUT 一次 → DELETE 返回 404。
    client_input.pop("ownerId", None)
    # pendingRuns 是服务端 crash-recovery 台账，跟 ownerId 同一类事故：
    # 前端 PUT 全量 state 默认 None / {}，merge setattr 会把已完成的 A/B
    # 抹掉，崩溃恢复再烧一遍 LLM。pop + 下面 exclude，persist restore 是第二闸。
    client_input.pop("pendingRuns", None)
    # 工厂待办跟 pendingRuns 同一类事故：前端 PUT 全量 state 默认 None / []，
    # merge setattr 会把模型刚延后的 bind 抹掉，下一跳合法集里没了。
    client_input.pop("factoryTodo", None)
    # 活儿清单同 factoryTodo：服务端拥有，客户端 PUT 一律不许带。
    client_input.pop("controlTodo", None)
    client_input.pop("controlSkillCache", None)
    client_input.pop("subagentTasks", None)
    for key in ("controlTranscript", "modelVersions", "currentModelVersionId", "specFirstPages", "coverageGaps", "awaitReason", "awaitDetail", "runtimePhase", "runtimeKind", "projectId", "projectRevision", "projectVerification"):
        client_input.pop(key, None)
    # publishClosure is client-side derived evidence projection (from python /drive-full); safe for client contrib roundtrip.
    # Do not pop; allow in V5SessionState parse + updates merge for frontend session store persistence (119).
    # Legacy sessions load with default None (see model).
    # Sanitize artifacts from client: strip server-owned trust fields so parse succeeds; we will not apply client's artifacts list
    if "artifacts" in client_input and isinstance(client_input.get("artifacts"), list):
        safe_arts = []
        for art in client_input["artifacts"]:
            if isinstance(art, dict):
                safe = {k: v for k, v in art.items() if k not in ("trustLevel", "producedBy", "passedGates")}
                safe["trustLevel"] = "untrusted"
                safe["passedGates"] = []
                safe_arts.append(safe)
            else:
                safe_arts.append(art)
        client_input["artifacts"] = safe_arts
    try:
        client_contrib = V5SessionState(**client_input) if client_input else None
    except (ValidationError, TypeError, ValueError) as e:
        raise HTTPException(400, f"invalid session state from client: {str(e).splitlines()[0]}")
    # load existing server state (trusted)
    existing = load_session(sid) or _sessions.get(sid)
    if existing:
        _require_session(existing, "drive", viewer)
        # Concurrency guard for PUT: reject if client claims older lastTurnId than server (stale request must not overwrite newer authoritative state).
        # Returns conflict so caller can reload. Persistence-level guard also protects on save even for direct calls.
        # (Finding 2 resolution)
        if client_contrib:
            def _turn_seq(lt: Optional[str]) -> int:
                if not lt:
                    return 0
                m = re.search(r"(\d+)", str(lt))
                return int(m.group(1)) if m else 0
            inc_seq = _turn_seq(getattr(client_contrib, "lastTurnId", None))
            ex_seq = _turn_seq(getattr(existing, "lastTurnId", None))
            if inc_seq > 0 and ex_seq > 0 and inc_seq < ex_seq:
                raise HTTPException(409, "stale write rejected: incoming lastTurnId older than current server state (concurrent save guard)")
        merged = existing.model_copy(deep=True)
        if client_contrib:
            # apply client-safe updates, exclude server-owned; never take client's artifacts/runs/gate/ledgers/replay
            # publishClosure intentionally NOT excluded: allows roundtrip persist of publish closure evidence into session state.
            # ownerId 在 exclude 里 —— 见上面 pop 那段：不排除的话，一次普通
            # 保存就会把服务端的归属覆盖成 None。
            # lastTurnId / specFirstPages 也是服务端的：过夜实测前端 PUT 带
            # 新 lastTurnId、旧页面/无版本史，落库失败后把旧指针钉死。
            # 409 守卫仍看 client lastTurnId（更旧的请求照样拒），只是合并时不吃。
            # coverageGaps 同理（2026-08-27）：澄清问题由控制面写、答案由控制面
            # 落在缺口上，客户端只读着渲染卡片。不排除的话，推演出错那条
            # catch 里的 persistSession(轮前快照) 会把刚问出来的问题整组抹掉——
            # 卡片凭空消失，用户以为自己看花了眼。跟下面 controlTranscript
            # 是同一个坑的第二次发作。
            # controlTranscript 同样是服务端的（_append_transcript 写，客户端只读）。
            # ⚠ 2026-08-27 评审：不排除的话，一次**陈旧** PUT（比如推演出错那条
            #   catch 里 persistSession(轮前快照)）会把这一轮新写的行整段抹掉，
            #   其中就有 `scope_confirmed`——而 _scope_confirmed 正是靠它判定
            #   范围确认过没有。表现是"刚确认完范围、这轮又失败了，下次 /推演
            #   还弹卡"，而且只在第一场推演之前复现（之后 modelVersions 兜底）。
            updates = client_contrib.model_dump(exclude={"sessionId", "ownerId", "pendingRuns", "factoryTodo", "controlTodo", "controlSkillCache", "subagentTasks", "coverageGate", "capabilityRuns", "artifacts", "decisionLedger", "costLedger", "flowBoundaryLedger", "structureGateLedger", "sessionReplayLog", "reasoningEvents", "modelVersions", "currentModelVersionId", "lastTurnId", "specFirstPages", "controlTranscript", "coverageGaps", "awaitReason", "awaitDetail", "runtimePhase", "runtimeKind", "projectId", "projectRevision"})
            if existing.runtimeKind == "project":
                updates.pop("publishClosure", None)
            for k, v in updates.items():
                if hasattr(merged, k):
                    setattr(merged, k, v)
            old_goal = existing.goal if isinstance(existing.goal, dict) else {}
            new_goal = merged.goal if isinstance(merged.goal, dict) else {}
            if plan_execution_authorized(existing) and any(
                old_goal.get(key) != new_goal.get(key)
                for key in ("text", "preferredDevice", "productArchetype", "designSystemId")
            ):
                merged.controlTranscript = [*merged.controlTranscript, {
                    "id": f"plan-reopen-{os.urandom(12).hex()}",
                    "role": "system", "kind": "plan_entered", "reason": "goal_changed",
                }]
                merged.awaitReason = None
                merged.awaitDetail = None
                merged.runtimePhase = "idle"
            merged.sessionId = sid
        state = merged
    else:
        # ── PUT 建新会话：跟 POST 走同一条规矩（2026-08-09）──────────────
        #
        # 方案 B（2026-08-06）的原话是「不让无主会话这个状态存在」，但那次只堵
        # 了 POST。PUT 这条路一直能建出无主会话，而无主会话**建出来就没人读得
        # 到**——session_record 恒判 private，access_for 里匿名与非所有者都拿
        # 不到 READ，于是只有超管看得见。
        #
        # 表现极其误导：PUT 返回 200 ok，紧接着 GET 同一个 id 返回 404。
        # 套件里 11 条测试红在这个形状上（turnNarrations 4 / 持久化契约 4 /
        # v5 冒烟 3），红了好几天没人能一眼说清是谁的问题。
        #
        # 两件事一起补齐，缺一个洞就还在：
        #   ① 要登录 —— 否则匿名照样能建无主会话
        #   ② 归属写进去 —— 否则登录了建出来的还是无主的（POST 那边踩过同一个
        #      坑，注释就在上面：「漏了这两行的后果不是报错，是会话建出来永远无主」）
        _require_login(viewer)
        if client_contrib:
            client_contrib.sessionId = sid
            state = client_contrib
        else:
            state = V5SessionState(sessionId=sid, goal={"text": "", "status": "needs_refinement"})
        _adopt_owner(state, viewer)
        try:
            state = claim_session(state)
        except PersistClosedError as exc:
            raise HTTPException(503, "session_store_unavailable") from exc
        _require_session(state, "drive", viewer)
    # Use authoritative result from save_session (which delegates to persistence guard + cache reload)
    # instead of the pre-save input state. Ensures route _sessions reflects service-forced authoritative
    # (consistent with "service forces reload authoritative into cache" and load_session behavior).
    # Fixes review finding 2.
    _cap_turn_narrations(state)
    state, _ = sanitize_session_state(state)
    try:
        authoritative = save_session(state)
    except PersistClosedError as exc:
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "reason": exc.reason, "message": exc.message},
        )
    authoritative, _ = sanitize_session_state(authoritative)
    _sessions[sid] = authoritative
    return {"ok": True, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.delete("/sessions/{sid}")
def delete_sess(
    sid: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    _auth(x_internal_key)
    # 删之前先判——实测过匿名 DELETE 别人的会话返回 200 且真删掉了。
    _existing = load_session(sid) or _sessions.get(sid)
    if _existing is not None:
        _require_session(_existing, "delete", viewer)
    result = delete_session(sid)
    _sessions.pop(sid, None)
    # GitHub：删 Codespace 不删仓库，但仓库不再指向已删的那台。
    # 不摘 session_id，点卡就会 GET 死会话 404（2026-08-20）。
    try:
        from services import app_store as _apps
        _apps.unbind_session(sid)
    except Exception as exc:  # noqa: BLE001 — 摘指针失败不能把已删会话变回 500
        print(f"[sliderule_full] unbind_session after delete failed: {exc}")
    if not result.get("ok"):
        if result.get("error") == "not_found":
            return {"ok": True, "sessionId": sid, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}
        return JSONResponse(
            status_code=500,
            content={**result, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND},
        )
    return {**result, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.post("/orchestrate-plan")
async def plan(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    # 2026-08-14 审计补：与 drive-full 同一条门（匿名只能查看，推演类动作
    # 要登录）。此前这条只有内部密钥，非生产环境等于全开。
    _auth(x_internal_key)
    _require_login(viewer)
    res = await _run_orchestrate_plan(payload)
    if isinstance(res, dict):
        res["provenance"] = res.get("provenance") or PROVENANCE_PYTHON_RAG
        res["backend"] = PYTHON_BACKEND
    return res

@router.post("/execute-capability")
async def exec_cap(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    # 2026-08-14 审计补：这条会 save_session（能写库），却连 viewer 都没取。
    # 与 drive-full / orchestrate-plan 同一条门。
    _auth(x_internal_key)
    _require_login(viewer)
    # Both executors and the later save must use the same authorized snapshot.
    state = await asyncio.to_thread(_drive_state, payload, viewer)
    payload = {**payload, "state": state.model_dump(), "userText": approved_plan_instruction(state, str(payload.get("userText") or ""))}
    cap = payload["capabilityId"]
    import time as _time
    t0 = _time.time()
    if is_python_native_capability(cap):
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    _with_approved_plan, state, _perform_native_execute, payload, cap,
                ),
                timeout=_execute_timeout_seconds(),
            )
        except asyncio.TimeoutError:
            dur = int((_time.time() - t0) * 1000)
            err = {"code": "execute_timeout", "message": "execute-capability timed out", "capabilityId": cap}
            from services.engine_scheduling import record_capability_run_error
            record_capability_run_error(
                state,
                capabilityId=cap,
                turnId=payload["turnId"],
                error=err,
                timing={"durationMs": dur},
            )
            await asyncio.to_thread(save_session, state)
            return {
                "error": err,
                "degraded": True,
                "capabilityId": cap,
                "backend": PYTHON_BACKEND,
                "provenance": PROVENANCE_PYTHON_RAG,
            }
        except LlmError as e:
            # record error run first so durable state captures the failure (addresses review: no record before raise)
            dur = int((_time.time() - t0) * 1000)
            err = {"code": "llm_native_failed", "message": str(e)[:200], "capabilityId": cap}
            from services.engine_scheduling import record_capability_run_error
            record_capability_run_error(
                state,
                capabilityId=cap,
                turnId=payload["turnId"],
                error=err,
                timing={"durationMs": dur},
            )
            await asyncio.to_thread(save_session, state)
            raise HTTPException(502, f"python LLM failed for {cap}: {e}")
        dur = int((_time.time() - t0) * 1000)
        run_id = f"run-{payload['turnId']}-{cap}"
        # success path still records run (enriched later); keep prior append for compat
        #
        # ⚠ 2026-09-06：此前是 append 之后再按 `capabilityRuns[-1]` 打耗时补丁。
        #   下标 -1 假定"我刚 append 的一定还在最后"——并发或中间插了别的记录
        #   就把耗时记到别人头上，而且不报错。耗时现在直接进构造，没有第二步。
        state.capabilityRuns.append(
            CapabilityRun.server_record(
                status="success",
                durationMs=dur,
                provenance="route.execute_capability_native_llm",
                id=run_id,
                capabilityId=cap,
                turnId=payload["turnId"],
                outputs=[],
            )
        )
        await asyncio.to_thread(save_session, state)
        result = result if isinstance(result, dict) else dict(result)
        result.setdefault("provenance", PROVENANCE_PYTHON_RAG)
        result["backend"] = PYTHON_BACKEND
        if cap in DELIVERY_CAP_IDS:
            result.setdefault("deliveryContract", "python-native-llm")
        if cap in VISUAL_CAP_IDS:
            result.setdefault("visualContract", "python-native-llm")
        return result
    # Use mapped for all V5 caps - stable RAG (execute-capability semantics owned by Python)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                _with_approved_plan,
                state,
                _perform_mapped_execute,
                cap,
                state,
                payload.get("inputArtifactIds", []),
                payload.get("roleId", "agent"),
                payload["turnId"],
            ),
            timeout=_execute_timeout_seconds(),
        )
    except asyncio.TimeoutError:
        dur = int((_time.time() - t0) * 1000)
        err = {"code": "execute_timeout", "message": "execute-capability timed out", "capabilityId": cap}
        from services.engine_scheduling import record_capability_run_error
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=payload["turnId"],
            error=err,
            roleId=payload.get("roleId"),
            timing={"durationMs": dur},
        )
        await asyncio.to_thread(save_session, state)
        return {
            "error": err,
            "degraded": True,
            "capabilityId": cap,
            "backend": PYTHON_BACKEND,
            "provenance": PROVENANCE_PYTHON_RAG,
        }
    except Exception as map_exc:
        # explicit error record + save for mapped path (review: no error record wrapper)
        dur = int((_time.time() - t0) * 1000)
        err = {"code": "mapped_capability_failed", "message": str(map_exc)[:200], "capabilityId": cap}
        from services.engine_scheduling import record_capability_run_error
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=payload["turnId"],
            error=err,
            roleId=payload.get("roleId"),
            timing={"durationMs": dur},
        )
        await asyncio.to_thread(save_session, state)
        # return degraded envelope so API does not hide; state has the record
        return {
            "error": err,
            "degraded": True,
            "capabilityId": cap,
            "backend": PYTHON_BACKEND,
            "provenance": PROVENANCE_PYTHON_RAG,
        }
    dur = int((_time.time() - t0) * 1000)
    # For tools/evidence, always "introduce" via RAG (covers evidence.search + report.write etc)
    if cap in ["mcp.call", "skill.invoke", "evidence.search", "report.write", "risk.analyze"]:
        result["summary"] = result.get("summary") or "检索了外部证据"
        result["provenance"] = PROVENANCE_PYTHON_RAG
    result = result if isinstance(result, dict) else dict(result)
    result.setdefault("provenance", PROVENANCE_PYTHON_RAG)
    result["backend"] = PYTHON_BACKEND
    if cap in DELIVERY_CAP_IDS:
        result.setdefault("deliveryContract", "python-mapped")
    if cap in VISUAL_CAP_IDS:
        result.setdefault("visualContract", "python-mapped")
    # Update state with run (like Node)
    run_id = f"run-{payload['turnId']}-{cap}"
    # ⚠ 同上：耗时进构造，不再按 `capabilityRuns[-1]` 打补丁。
    state.capabilityRuns.append(
        CapabilityRun.server_record(
            status="success",
            durationMs=dur,
            provenance="route.execute_capability",
            id=run_id,
            capabilityId=cap,
            turnId=payload["turnId"],
            outputs=[],
        )
    )
    await asyncio.to_thread(save_session, state)
    return result

@router.post("/drive-turn")
# `def` 而不是 `async def`——理由与 /drive-full 那条完全相同（见下面那段长注释）：
# drive_reasoning_turn 是同步的重活，写在 async 里会占住事件循环。
def drive(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """Single turn drive (drive_reasoning_turn). Full multi-loop driver authority exposed via /drive-full."""
    _auth(x_internal_key)
    _require_login(viewer)
    state = _drive_state(payload, viewer)
    new_state = _with_approved_plan(state, drive_reasoning_turn, state, payload["turnId"], approved_plan_instruction(state, payload.get("userText", "")))
    # python provenance for turn/drive (covers turn + downstream evidence/report)
    return {"state": new_state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_RAG, "backend": PYTHON_BACKEND}

@router.post("/drive-full")
# ⚠️ 这条路由是 `def` 而不是 `async def`——**故意的，别改回去**（2026-08-02）。
#
# 事故形状：只要有人在推演，整个服务就不响应，连 /api/health 都超时。原因是
# drive_full_v5_session 是**同步**函数（v5_full_driver.py），一趟推演 6~20 分钟
# （实测本次 5 个话题 374~1190s），此前它被直接写在 `async def` 里，于是整段
# 跑在事件循环那条线程上——单 worker 下，事件循环被占住 = 全站失联。
#
# 修法用的是 FastAPI 官方口径，不是自己发明的：
#   "When you declare a path operation function with normal `def` instead of
#    `async def`, it is run in an external threadpool that is then awaited,
#    instead of being called directly (as it would block the server)."
#   —— fastapi.tiangolo.com/async/
# 底层是 Starlette 的 run_in_threadpool → anyio.to_thread.run_sync。
#
# 为什么不用 asyncio.to_thread 手动包一层：能达到同样效果，但要在每个调用点
# 各写一遍、且容易漏（本文件里 LLM/RAG 那几条就是这么写的，而这两条当初正是
# 漏掉的）。函数签名去掉 async 是**声明式**的，漏不掉。
#
# 代价（记下来，别踩）：线程池默认只有 40 个槽（anyio 的
# current_default_thread_limiter），而每趟推演会占住一个槽十几分钟。同时在跑的
# 推演超过 40 个就会开始排队——真到那一天，正确的解法是把推演挪进任务队列，
# 而不是把这个数字调大。
def drive_full(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """Python driver authority for multiple capability loops until stop condition (coverage/empty picks/max_loops).
    Wires drive_full_v5_session as the visible full-path multi-loop API (PYTHON_AUTHORITY).
    Real userText (user instruction) is forwarded so it drives pick/orchestrate/execute/artifacts/GCOV/phase.
    """
    _auth(x_internal_key)
    _require_login(viewer)
    # PYTHON_AUTHORITY: 已持久化的服务端会话是权威起点。客户端 state 经防伪造清洗后
    # 会失去 trustLevel/producedBy/台账（正确的防伪行为），若以它为起点，之前所有
    # trusted-committed 产物会被清零、收敛状态丢失（例如"生成交付物"回合触发不了
    # delivery 分支）。仅在无持久化会话（首轮）时才用清洗后的客户端 state 起步。
    state = _drive_state(payload, viewer)
    max_loops = int(payload.get("max_loops", 10))
    user_text = sanitize_session_dict({"text": payload.get("userText", "") or payload.get("user_text", "")})[0].get("text", "")
    user_text = approved_plan_instruction(state, user_text)
    # 技能库六期"推演注入"：已安装技能进生成契约（setter 内清洗；结束必清空）
    from services.v5_llm_generate import set_active_connectors, set_installed_skills

    set_installed_skills(payload.get("installedSkills"))
    # ⚠ 连接器跟技能是**成对**的两条注入，而同步/流式两条驱动也是一对。
    #   仓里第四条：改一条不改另一条不会报错，只会有一半不生效——而流式
    #   才是前端主路径（身份透传、精修模式都在这上面踩过）。
    set_active_connectors(payload.get("activeConnectors"))
    from services.device_policy import set_preferred_device_override

    goal = dict(state.goal) if isinstance(state.goal, dict) else {}
    set_preferred_device_override(
        preferred_device_for_run(
            goal=goal,
            payload_device=payload.get("preferredDevice")
            or payload.get("preferred_device"),
            texts=[user_text, str(goal.get("text") or "")],
        )
    )
    from services.identity_palette_hint import set_design_system_override

    set_design_system_override(
        payload.get("designSystemId") or payload.get("design_system_id")
    )
    from services.product_charter import activate_charter_for_run, clear_charter_for_run

    activate_charter_for_run(state, payload)
    try:
        new_state = _with_approved_plan(state, drive_full_v5_session, state, max_loops=max_loops, user_instruction=user_text)
    finally:
        set_installed_skills(None)
        set_active_connectors(None)
        set_preferred_device_override(None)
        set_design_system_override(None)
        clear_charter_for_run()
    # Compat (task 119-04): capability results may be Pydantic models (model_dump) or plain dicts.
    # Normalize them to plain dicts BEFORE sanitize/derive/persist so json persistence and the
    # response envelope never see a non-serializable result object.
    for _run in getattr(new_state, "capabilityRuns", []) or []:
        _res = getattr(_run, "result", None)
        if _res is not None and not isinstance(_res, dict):
            _run.result = _result_to_dict(_res)
    new_state, _ = sanitize_session_state(new_state)
    publish_closure = derive_publish_closure_response(new_state)
    skill_graph = derive_skill_runtime_graph_response(new_state)
    new_state.publishClosure = publish_closure
    new_state.skillRuntimeGraph = skill_graph
    # D7 修复（2026-07-27）：非流式路径此前从不记版本快照——精修生效了、
    # modelVersions 却停在旧版（指针指着精修前的 mv-1），回退按钮被
    # already_current 误拒。与流式路径同一时机、同一函数。
    if publish_closure is not None:
        from services.v5_full_driver import record_model_version

        record_model_version(new_state, publish_closure, user_text)
    new_state.lastTurnId = _advance_drive_full_turn_id(getattr(new_state, "lastTurnId", None))
    save_session(new_state)
    return {
        "state": new_state.model_dump(),
        "stateAuthority": STATE_AUTHORITY_PYTHON,
        "provenance": PROVENANCE_PYTHON_FULLPATH,
        "backend": PYTHON_BACKEND,
        "publishClosure": publish_closure,
        "skillRuntimeGraph": skill_graph,
        "closureWarnings": [],
    }

@router.post("/drive-marathon")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def drive_marathon_route(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """Python-owned marathon/budget route.

    This is the production wiring point for BudgetMarathon: frontend/Node callers consume
    the Python decision instead of owning maxTurns/maxRuns/maxRepeat/maxTokens locally.
    """
    _auth(x_internal_key)
    # 2026-08-14 审计补：会落库的推演路必须登录（与 drive-full 的 :920 同款）。
    # 此前只认了归属没设门——匿名跑一轮，_adopt_owner 认不到主体，
    # 造出来的还是无主会话。
    _require_login(viewer)
    # 它把 drive_reasoning_turn 当步进器跑，而那个函数内部会 save_session ——
    # 也就是**这条路会落库**，所以同样得认归属（2026-08-09）。原来这条路由
    # 连 viewer 都没取，无从认起。
    state = _drive_state(payload, viewer)
    seed_text = payload.get("seedText") or payload.get("seed_text") or payload.get("userText") or ""
    seed_text = approved_plan_instruction(state, seed_text)
    budget = payload.get("budget") or {}
    policy = payload.get("policy") or None
    max_rounds = int(payload.get("maxRounds") or payload.get("max_rounds") or 8)
    result = _with_approved_plan(
        state,
        drive_marathon,
        state,
        seed_text,
        budget=budget,
        policy=policy,
        max_rounds=max_rounds,
        drive_step=drive_reasoning_turn,
    )
    final_state = result.get("finalState")
    publish_closure = derive_publish_closure_response(final_state) if isinstance(final_state, V5SessionState) else None
    skill_graph = derive_skill_runtime_graph_response(final_state) if isinstance(final_state, V5SessionState) else None
    return {
        "state": final_state.model_dump() if hasattr(final_state, "model_dump") else final_state,
        "rounds": result.get("rounds") or [],
        "stopReason": result.get("stopReason"),
        "stateAuthority": STATE_AUTHORITY_PYTHON,
        "provenance": PROVENANCE_PYTHON_FULLPATH,
        "backend": PYTHON_BACKEND,
        "budgetAuthority": "python",
        "publishClosure": publish_closure,
        "skillRuntimeGraph": skill_graph,
    }

# GCOV endpoint
@router.post("/coverage")
async def cov(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    # 这条**不落库**：算一遍覆盖门就把结果返回，state 只是入参。造不出无主
    # 会话，所以不用 _adopt_owner（用例里也把它列进豁免并写明这个理由）。
    state = V5SessionState(**payload["state"])
    gate = evaluate_coverage_gate(state)
    return gate


# SSE streaming endpoint — yields live skill-progress events while drive runs.
# Frontend connects with EventSource; each event is a JSON line.
@router.post("/drive-full-stream")
async def drive_full_stream(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """Stream drive-full execution as Server-Sent Events.

    Each event has the shape:  data: <json>\\n\\n
    Event types (see v5_full_driver.drive_full_v5_session_stream):
        phase_change  — runtimePhase transition
        skill_start   — a capability is about to execute (use to highlight thumbnail)
        skill_result  — capability finished (model + optional mermaid)
        publish_closure — final closure evidence
        complete      — final state; stream ends
    """
    _require_login(viewer)
    import json

    _auth(x_internal_key)

    state = await asyncio.to_thread(_drive_state, payload, viewer)
    sid = state.sessionId

    max_loops = int(payload.get("max_loops", 10))
    user_text = sanitize_session_dict(
        {"text": payload.get("userText", "") or payload.get("user_text", "")}
    )[0].get("text", "")
    # E26 缺口修复轮：mode="repair" 时只重跑覆盖门标红的能力（选材见
    # pick_repair_capabilities），已 PASS 产物与五系统模型原样复用。
    repair = str(payload.get("mode") or "").strip().lower() == "repair"

    # 脚本方言：同一份信封 helper（命名字段，不再在这里解析两套 payload）。
    # 产品新烧走 POST /control-turn-stream；本路由保留给脚本/测试。
    # ⚠ 2026-08-27：drive_v5_full_path 定义在 v5_session_driver，产品路由
    # 调用点为零。禁止再 import 当驱动器——那是不通电的插座。
    from services.drive_full_factory import start_drive_full_factory_run
    from services.product_charter import factory_charter_kwargs

    run = await start_drive_full_factory_run(
        sid,
        user_text,
        payload.get("installedSkills"),
        payload.get("activeConnectors"),
        payload.get("preferredDevice") or payload.get("preferred_device"),
        payload.get("designSystemId") or payload.get("design_system_id"),
        repair=repair,
        profile="full",
        max_loops=max_loops,
        require_session_id=False,
        fallback_state=state.model_dump(),
        viewer=viewer,
        expected_owner_id=state.ownerId,
        **factory_charter_kwargs(payload),
    )
    return _run_sse_response(run, since=0)


class _ExclusiveControlResponse(StreamingResponse):
    """A busy session must be rejected before StreamingResponse sends HTTP 200."""

    def __init__(self, *args, turn_reservation, **kwargs):
        super().__init__(*args, **kwargs)
        self.turn_reservation = turn_reservation

    async def __call__(self, scope, receive, send):
        with self.turn_reservation:
            await super().__call__(scope, receive, send)

    async def stream_response(self, send):
        try:
            await super().stream_response(send)
        finally:
            # StreamingResponse's async-for does not close a generator suspended
            # at yield when the browser disconnects. Close in the streaming task
            # so ContextVar tokens and the session reservation unwind together.
            with CancelScope(shield=True):
                await self.body_iterator.aclose()


@router.post("/control-turn-stream")
async def control_turn_stream(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    request: Request,
    x_internal_key: Optional[str] = Header(None),
    x_control_request_id: Optional[str] = Header(None),
):
    """M1 薄控制面。产品新烧唯一点火 HTTP。无 Node twin（catch-all 转发）。"""
    import json

    from services.deliverable_kind import orch_trace
    orch_trace("http-turn", session=str((payload or {}).get("sessionId") or "")[:40])
    _auth(x_internal_key)
    _require_login(viewer)
    from services.rehearsal_control import run_control_turn, validate_control_turn_body, reserve_control_turn

    validate_control_turn_body(payload)
    # Authorize before opening SSE; private and missing IDs have the same 404.
    sid = str(payload.get("sessionId") or "").strip()
    state = await asyncio.to_thread(_require_run_session, sid, "drive", viewer)
    if project_access_enabled(viewer):
        service = _control_service(request, viewer)
        try:
            record = await service.submit(payload, str(viewer.id),
                x_control_request_id if x_control_request_id is not None else uuid.uuid4().hex)
        except ControlRunConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (ControlRunUnavailable, PermissionError) as exc:
            raise HTTPException(503, "control_run_unavailable") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return _control_sse_response(service, record["runId"], str(viewer.id), 0)
    async def event_generator():
        async with aclosing(run_control_turn(payload, authorized_owner_id=state.ownerId,
                reservation_held=True)) as stream:
            async for event in stream:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return _ExclusiveControlResponse(
        event_generator(),
        turn_reservation=reserve_control_turn(sid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _control_service(request, viewer, *, read=False):
    # Rollout rollback blocks new control submissions but must leave an owner
    # able to observe and explicitly stop an already persisted run.
    if not viewer or (not read and not project_access_enabled(viewer)):
        raise HTTPException(404, "Not found")
    service = getattr(request.app.state, "control_run_service", None)
    if service is None and read:
        # Rollout rollback deliberately leaves no producer worker running, but
        # durable control runs must still be observable and explicitly stopped.
        # The observer facade performs no startup/DDL and cannot submit work.
        try:
            service = ControlRunService.observer(get_project_store())
        except Exception as exc:
            raise HTTPException(503, "control_run_unavailable") from exc
    if service is None:
        raise HTTPException(503, "control_run_unavailable")
    return service


def _control_sse_response(service, run_id, owner_id, after_seq):
    import json

    async def events():
        yield "data: " + json.dumps({"type": "control_run_started", "controlRunId": run_id}) + "\n\n"
        async for event in service.subscribe(run_id, owner_id, after_seq):
            yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        "X-Control-Run-Id": run_id,
    })


@router.get("/control-runs/latest")
async def latest_control_run(sessionId: str, request: Request, viewer: CurrentUserOptional,
                             x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    _require_login(viewer)
    await asyncio.to_thread(_require_run_session, sessionId, "drive", viewer)
    service = _control_service(request, viewer, read=True)
    record = await asyncio.to_thread(service.store.latest, sessionId, str(viewer.id))
    return {"run": public_control_run(record) if record else None}


@router.delete("/control-requests/{request_id}")
async def cancel_control_request(request_id: str, sessionId: str, request: Request,
                                 viewer: CurrentUserOptional, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    _require_login(viewer)
    await asyncio.to_thread(_require_run_session, sessionId, "drive", viewer)
    service = _control_service(request, viewer, read=True)
    try:
        record = await asyncio.to_thread(service.store.cancel_request, sessionId, str(viewer.id), request_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"cancelRequested": record["cancelRequested"], "runId": record["runId"]}


async def _owned_control_record(service, run_id, viewer):
    try:
        record = await asyncio.to_thread(service.store.get, run_id, str(viewer.id))
    except ControlRunNotFound as exc:
        raise HTTPException(404, "Not found") from exc
    await asyncio.to_thread(_require_run_session, record["sessionId"], "drive", viewer)
    return record


@router.get("/control-runs/{run_id}")
async def get_control_run(run_id: str, request: Request, viewer: CurrentUserOptional,
                         x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    _require_login(viewer)
    service = _control_service(request, viewer, read=True)
    return public_control_run(await _owned_control_record(service, run_id, viewer))


@router.get("/control-runs/{run_id}/stream")
async def stream_control_run(run_id: str, request: Request, viewer: CurrentUserOptional,
                            afterSeq: int = 0, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    _require_login(viewer)
    service = _control_service(request, viewer, read=True)
    record = await _owned_control_record(service, run_id, viewer)
    if afterSeq < 0 or afterSeq > record["lastSeq"]:
        raise HTTPException(422, "invalid_control_event_cursor")
    return _control_sse_response(service, run_id, str(viewer.id), afterSeq)


@router.delete("/control-runs/{run_id}")
async def cancel_control_run(run_id: str, request: Request, viewer: CurrentUserOptional,
                            x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    _require_login(viewer)
    service = _control_service(request, viewer, read=True)
    await _owned_control_record(service, run_id, viewer)
    return public_control_run(await service.cancel(run_id, str(viewer.id)))


def _run_sse_response(run, since: int) -> StreamingResponse:
    """把 run 日志（自 since 起）+ 实时尾流包成 SSE。`id:` 行遵循
    Last-Event-ID 语义；data 内同样带 seq/runId（既有消费者只解 data 行，
    向后兼容）。断连只是取消本订阅，run 照跑。"""
    import json
    from services import run_registry

    async def event_generator():
        async for event in run_registry.subscribe(run, since):
            yield (
                f"id: {event.get('seq', 0)}\n"
                f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",  # disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.get("/runs/active")
async def runs_active(
    sessionId: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """会话当前活跃 run（刷新回来的客户端据此决定是否续播）。

    ⚠ 归属先判、再查 run（2026-09-06）。这条接口拿的是**调用方给的
      sessionId**，不判归属就等于"给我一个 id 我就告诉你它在不在跑"。
    """
    _auth(x_internal_key)
    _require_run_session(sessionId, "view", viewer)
    run = run_registry.get_active_run(sessionId)
    if run is not None:
        run = _visible_run(run.run_id, "view", viewer)
    return {"active": run.snapshot() if run is not None else None}


@router.get("/gate-health")
async def gate_health(
    x_internal_key: Optional[str] = Header(None),
):
    """各道闸当前的开火情况。

    ⚠ 2026-09-05 加这条的原因：收尾统计只挂在 `run_registry._finish` 上，
      而**三处迭代里有两处不产生 run**——点选编辑和画布是直接 PATCH 页面，
      跑完不经过任何 run 收尾，那两处的 `pageEdit` 闸攒在台账里没人打印，
      要等下一次有人跑推演才顺带露出来。跑迭代批次时就等于看不见。
      读接口跟收尾那行走**同一个** `snapshot()`，不另起一套口径（§4）。
    """
    _auth(x_internal_key)
    rows = _gate_snapshot()
    return {
        "gates": rows,
        "line": _gate_summary(),
        # ⚠ 台账是**进程内存**：uvicorn 一 reload 就归零。没有这个字段，
        #   空清单读起来像「各道闸都没开过火，一切正常」，而实情通常是
        #   「这个进程刚起来」。空≠绿灯。
        "since": _gate_since(),
        "empty": not rows,
    }


@router.get("/runs/{run_id}/stream")
async def run_stream(
    run_id: str,
    viewer: CurrentUserOptional,
    since: int = 0,
    x_internal_key: Optional[str] = Header(None),
):
    """续播：从 since 序号补播事件日志，追平后接实时流。

    ⚠ 这条泄漏面最大：事件流里带着别人的话题、SPEC、逐页 HTML、LLM 增量。
      归属不判等于把整轮推演的全文交给任何知道 run id 的人。
    """
    _auth(x_internal_key)
    run = _visible_run(run_id, "view", viewer)
    if run is None:
        return JSONResponse(status_code=404, content={"error": "run_not_found"})
    return _run_sse_response(run, since=since)


#: 每会话一把回退锁。前端加了 in-flight 闸之后仍要有这一层——闸只挡住
#: "同一个浏览器标签连点"，挡不住多标签/刷新后重放/直接打接口。而回退不是
#: 只读操作：它会重建闭环并写回会话，两个请求交叠就是读改写竞态
#: （2026-08-16 实测：三个并发 POST 全部被接受并各自跑完）。
#:
#: ⚠ 用普通字典而不是 WeakValueDictionary：锁对象本身不该被回收——正在等锁
#:   的请求手里有引用，但"刚放开、下一个还没拿到"那一瞬没有，回收掉就等于没锁。
#:   会话数量级有限，常驻不心疼。
_RESTORE_LOCKS: Dict[str, threading.Lock] = {}
_RESTORE_LOCKS_GUARD = threading.Lock()


def _restore_lock(sid: str) -> threading.Lock:
    with _RESTORE_LOCKS_GUARD:
        lock = _RESTORE_LOCKS.get(sid)
        if lock is None:
            lock = threading.Lock()
            _RESTORE_LOCKS[sid] = lock
        return lock


#: 业务核搬到了 services/model_version_restore（2026-08-29）。
#: ⚠ 这里保留 `_restore_model_version_locked` 这个模块级别名**不是为了好看**：
#:   既有判据 patch 的是「路由模块上的这个属性」（test_restore_serialized 等），
#:   下面的路由体也按模块全局名去查它，别名在，那些 patch 就照常生效。
#:   搬家只该改依赖方向，不该顺手把别人的判据弄红。
_restore_model_version_locked = restore_model_version_locked


@router.post("/sessions/{sid}/model-versions/{version_id}/restore")
def restore_model_version(
    sid: str,
    version_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """E29 版本回退：把历史模型快照置为当前（追加式，不改写历史）。

    快照经 set_model_override 直供生成层（不调 LLM），同一结构闸照常校验，
    闭环/联动图重新推导，随后追加一条「回退」版本记录。

    ⚠ 2026-09-06 补归属。这条是查 `/runs/*` 那五条时**在隔壁发现的同一形状**：
      它连 `viewer` 参数都没有，只有一个开发环境下形同虚设的 `_auth`。
      而它是**写**路径——把别人会话的当前模型换成某个历史版本，并追加一条
      版本记录。比那五条读接口更严重。

      `drive`（WRITE）而不是 `view`：它改会话状态。
      404 不 403，理由同 `_require_session`。
    """
    _auth(x_internal_key)
    _require_run_session(sid, "drive", viewer)
    with _restore_lock(sid):
        return _restore_model_version_locked(sid, version_id)


@router.delete("/runs/{run_id}")
async def run_cancel(
    run_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """显式取消（停止按钮的新语义：真正杀掉服务端推演）。

    ⚠ `drive`（WRITE）而不是 `view`：取消 = 这一轮判死、白烧（真机实测
      publishClosure=null、modelVersions=0）。归属不判 = 任何人都能杀掉
      别人跑了十分钟的推演。
    """
    _auth(x_internal_key)
    if _visible_run(run_id, "drive", viewer) is None:
        # 看不见的 run 与不存在的 run 对外同一形状，不泄漏存在性。
        return {"cancelled": False}
    return {"cancelled": run_registry.cancel_run(run_id)}


@router.post("/runs/{run_id}/hold")
async def run_hold(
    run_id: str,
    viewer: CurrentUserOptional,
    payload: Optional[Dict[str, Any]] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """「先别往下跑」：在下一个安全点停住这一轮，等人拿主意。

    ⚠ 跟 DELETE /runs/{id}（取消）不是同一件事的两个力度：
      取消 = 这一轮判死、白烧（真机实测 publishClosure=null、modelVersions=0）；
      暂停 = 停住等人，答完/超时/没人在场都会接着跑到最后一步，闭环照样绿。

    `nonInteractive` 由调用方给：页面已经关了 / 无头跑的时候传 true，
    超时报的就是"没有操作员"而不是"用户跳过"——那是两个不同的事实。

    ⚠ `drive`（WRITE）：停住别人的推演是改这一轮的走向，不是只读。
    """
    _auth(x_internal_key)
    if _visible_run(run_id, "drive", viewer) is None:
        # 闸不在时本来就返回 held=false（真机竞态是常态，不是错误），
        # 看不见的 run 沿用同一形状。
        return {"held": False}
    body = payload or {}
    held = run_registry.hold_run(
        run_id, non_interactive=bool(body.get("nonInteractive"))
    )
    return {"held": held}


@router.post("/runs/{run_id}/release")
async def run_release(
    run_id: str,
    viewer: CurrentUserOptional,
    payload: Optional[Dict[str, Any]] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """放行：人答了（answer）或明确说"就这样"（skip）。

    ⚠ 闸不在时返回 released=false 而**不是报错**：真机上「答案到得比暂停
      生效还早」是正常竞态（用户手快、或上一步还没跑完），那不是错误。

    ⚠ `drive`（WRITE）：这条是**替人拿主意**——`answer` 会被当成用户对假设卡
      的回答写进推演。归属不判等于任何人都能替别人做决定。
    """
    _auth(x_internal_key)
    if _visible_run(run_id, "drive", viewer) is None:
        return {"released": False}
    body = payload or {}
    released = run_registry.release_run(
        run_id,
        answer=body.get("answer"),
        skip=bool(body.get("skip")),
    )
    return {"released": released}


# ---------------------------------------------------------------------------
# AIGC 能力试跑（浏览器运行时 M2）：拿模型里声明的一项 AI 能力真跑一次 LLM。
# 语义与五系统生成同一诚实边界：flag 关/无 key → fail-closed 结构化诊断，
# 不返回伪造输出；失败原因如实透传（对齐 LLM_GENERATE_DISABLED/FAILED 口径）。
# ---------------------------------------------------------------------------

AIGC_TRYRUN_TIMEOUT_MS_ENV = "SLIDERULE_AIGC_TRYRUN_TIMEOUT_MS"
DEFAULT_AIGC_TRYRUN_TIMEOUT_MS = 60_000


@router.post("/aigc-tryrun")
def aigc_tryrun(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Run one declared AIGC capability against the real LLM channel.

    payload: {capability: {id?, name, inputFields?, outputField?}, inputs: {ref: value},
              goal?, explain?}
    Returns 200 always; honesty is in the body: {ok, output?|code+detail}.
    explain=true（加厚 schema 三期）：请求结构化 {output, confidence, rationale}，
    LLM 没按 JSON 返回时诚实降级为纯文本（不造置信度数字）。
    """
    import time as _time

    from services.llm_error_text import humanize_llm_error
    from services.v5_capability_executor import _llm_generate_enabled
    from services.v5_explainable import EXPLAIN_INSTRUCTION, parse_explained_output
    from sliderule_llm.client import call_llm_with_retry

    _auth(x_internal_key)

    capability = payload.get("capability") or {}
    name = str(capability.get("name") or capability.get("id") or "").strip()
    if not name:
        raise HTTPException(400, "capability.name required")
    inputs: Dict[str, Any] = payload.get("inputs") or {}
    output_field = str(capability.get("outputField") or "").strip()
    goal = str(payload.get("goal") or "").strip()
    explain = bool(payload.get("explain"))

    if not _llm_generate_enabled():
        return {
            "ok": False,
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启（或运行时无 LLM key），"
            "能力试跑不伪造输出",
        }

    filled = "\n".join(f"- {k}：{v}" for k, v in inputs.items() if str(v).strip()) or "（未提供输入值）"
    system = (
        "你是产品排练系统里的一项 AI 能力，正在被试跑验证。"
        "根据能力定义和输入字段值，直接生成该能力的输出内容本身——"
        "不要解释、不要客套、不要 markdown 标题，用简体中文，200 字以内。"
    )
    if explain:
        system += EXPLAIN_INSTRUCTION
    user = (
        (f"产品意图：{goal}\n" if goal else "")
        + f"能力名称：{name}\n"
        + f"输入字段值：\n{filled}\n"
        + (f"输出字段：{output_field}\n" if output_field else "")
        + "请生成这项能力应产出的内容。"
    )

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    started = _time.monotonic()
    try:
        # 瞬时错误（网关 5xx/超时/限流）带退避重试 3 次；非瞬时（鉴权/404）立即失败。
        result = call_llm_with_retry(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_attempts=3,
            backoff_ms=1500,
            temperature=0.4,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        return {
            "ok": False,
            "code": "LLM_GENERATE_FAILED",
            # 展示层人话化：剥 HTML 错误页、5xx 标注瞬时故障（原因仍如实保留）
            "detail": humanize_llm_error(str(exc))[:300],
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }

    elapsed_ms = int((_time.monotonic() - started) * 1000)
    if explain:
        parsed = parse_explained_output(result.content)
        if parsed is not None:
            return {"ok": True, "explained": True, "elapsedMs": elapsed_ms, **parsed}
        # LLM 没按结构化返回 → 原文当输出、不带置信度（诚实降级，不造数字）
        return {"ok": True, "output": result.content, "elapsedMs": elapsed_ms}

    return {
        "ok": True,
        "output": result.content,
        "elapsedMs": elapsed_ms,
    }


@router.post("/prompt-refine")
def prompt_refine(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """输入条「优化提示词」：把一句话应用意图改写成信息更全的推演提示词。

    payload: {text}
    与 /aigc-tryrun 同一诚实契约：HTTP 恒 200，成败在 body：
    {ok, text?|code+detail}；无 LLM 通道时不伪造输出。
    改写只补全维度（实体/流程/角色/页面/AI 能力），必须忠实原意——
    不发明用户没暗示的行业或功能。
    """
    import time as _time

    from services.llm_error_text import humanize_llm_error
    from services.v5_capability_executor import _llm_generate_enabled
    from sliderule_llm.client import call_llm_with_retry

    _auth(x_internal_key)

    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text required")

    if not _llm_generate_enabled():
        return {
            "ok": False,
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启（或运行时无 LLM key），"
            "提示词优化不伪造输出",
        }

    system = (
        "你是产品推演引擎 SlideRule 的提示词优化器。用户会给一句应用意图，"
        "把它改写成一段信息更全的推演提示词：补上应用要服务谁、核心业务对象"
        "（实体）、主业务流程与审批环节、涉及的角色与权限差异、关键页面形态"
        "（列表/看板/日历/仪表盘）、哪些环节需要 AI 能力。"
        "必须忠实用户原意，不发明用户没有暗示的行业或功能；"
        "用简体中文输出一段话（80~150 字），不分点、不解释、不加引号，"
        "直接输出改写后的提示词本身。"
    )

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    started = _time.monotonic()
    try:
        result = call_llm_with_retry(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            max_attempts=3,
            backoff_ms=1500,
            temperature=0.5,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        return {
            "ok": False,
            "code": "LLM_GENERATE_FAILED",
            "detail": humanize_llm_error(str(exc))[:300],
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }

    refined = (result.content or "").strip()
    if not refined:
        return {
            "ok": False,
            "code": "LLM_EMPTY_OUTPUT",
            "detail": "LLM 返回了空内容，提示词未改动",
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }
    return {
        "ok": True,
        "text": refined,
        "elapsedMs": int((_time.monotonic() - started) * 1000),
    }


@router.get("/builtin-examples")
def builtin_examples():
    """官方示例库（E41）：过门冻结模型的摘要投影——真身份、真指标、
    起手意图。没有上架条目就返回空列表（2026-08-14 起数据清空，功能
    保留；上架方式见 services/builtin_examples._EXAMPLE_META）。"""
    from services.builtin_examples import list_builtin_examples

    return {"examples": list_builtin_examples()}


@router.post("/attachments/extract")
async def attachments_extract(
    request: Request,
    name: str = "",
    x_internal_key: Optional[str] = Header(None),
):
    """E31 附件内容提取：图片走视觉 LLM，PDF 走 E2B 沙盒 pypdf（超长再蒸馏）。

    请求：raw bytes body（application/octet-stream）+ ?name=文件名——
    不引 multipart 依赖，前端 fetch 直接把 File 当 body 发。
    与 /aigc-tryrun 同一诚实契约：HTTP 恒 200，成败在 body：
    {ok, kind, context?, chars?, detail}；任何一步失败如实说原因，
    前端退回「仅随消息带文件名」，绝不粉饰成已解析。
    """
    import time as _time

    _auth(x_internal_key)
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "name query param required")
    data = await request.body()

    from services.attachment_extract import extract_attachment

    started = _time.monotonic()
    # 提取是长活（视觉 LLM 实测可到 100s+、沙盒冷启数秒）——丢线程池，
    # 不堵事件循环（SSE 续播/其他会话不受影响）
    result = await asyncio.to_thread(extract_attachment, name, data)
    return {**result, "name": name, "elapsedMs": int((_time.monotonic() - started) * 1000)}


@router.get("/skill-packages")
def skill_packages_list(x_internal_key: Optional[str] = Header(None)):
    """原版技能包清单（技能库四期）：完整 SKILL.md 的轻量元数据（不含正文）。"""
    _auth(x_internal_key)
    from services.v5_skill_packages import list_skill_packages

    items = list_skill_packages()
    return {"count": len(items), "items": items}


@router.post("/skill-package-tryrun")
def skill_package_tryrun(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """按原版 SKILL.md 指令执行一次（技能库四期"装完即用"的真身）。

    payload: {packageId, input}
    与 /aigc-tryrun 同一诚实契约：HTTP 恒 200，成败在 body：
    {ok, output?|code+detail}；无 LLM 通道时不伪造输出。
    """
    import time as _time

    from services.v5_capability_executor import _llm_generate_enabled
    from services.llm_error_text import humanize_llm_error
    from services.v5_skill_packages import build_skill_messages, get_skill_package
    from sliderule_llm.client import call_llm_with_retry

    _auth(x_internal_key)

    package_id = str(payload.get("packageId") or "").strip()
    user_input = str(payload.get("input") or "").strip()
    if not package_id:
        raise HTTPException(400, "packageId required")
    if not user_input:
        raise HTTPException(400, "input required")

    pkg = get_skill_package(package_id)
    if pkg is None:
        return {
            "ok": False,
            "code": "PACKAGE_NOT_FOUND",
            "detail": f"技能包不存在：{package_id}（技能包库可能未采集或该条已按异议下架）",
        }

    if not _llm_generate_enabled():
        return {
            "ok": False,
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启（或运行时无 LLM key），"
            "技能试跑不伪造输出",
        }

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    started = _time.monotonic()
    try:
        # 原版 SKILL.md 全文做 system prompt；产出上限放宽（技能输出普遍比
        # 单能力试跑长——章节草稿/研报段落级别）。瞬时错误带退避重试。
        result = call_llm_with_retry(
            build_skill_messages(pkg, user_input),
            max_attempts=3,
            backoff_ms=1500,
            temperature=0.5,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        return {
            "ok": False,
            "code": "LLM_GENERATE_FAILED",
            "detail": humanize_llm_error(str(exc))[:300],
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }

    return {
        "ok": True,
        "output": result.content,
        "elapsedMs": int((_time.monotonic() - started) * 1000),
    }


@router.post("/aigc-pipeline-tryrun")
def aigc_pipeline_tryrun(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """链路试跑（编排一期）：按 steps 顺序真跑一串能力，字段级传递。

    payload: {
      pipeline: {id?, name?},
      steps: [{id, name, inputFields?, outputField?}, ...],  # 已解析能力对象（客户端按模型展开）
      inputs: {ref: value},   # 首步输入；后续步的衔接字段由上一步输出注入
      goal?: str
    }
    语义：上一步 outputField 的产出注入下一步同 ref 的输入字段（与门禁的
    handoff 校验同一规则）。fail-fast：某步失败即停——下游缺上游产物，
    跑了也是伪造；已完成步骤如实返回。
    Returns 200 always；诚实性在 body：{ok, steps:[{id,name,ok,output?|code+detail,elapsedMs}]}。
    """
    import time as _time

    from services.v5_capability_executor import _llm_generate_enabled
    from sliderule_llm.client import call_llm

    _auth(x_internal_key)

    steps_def = [s for s in (payload.get("steps") or []) if isinstance(s, dict)]
    if len(steps_def) < 2:
        raise HTTPException(400, "pipeline needs at least 2 resolved steps")
    goal = str(payload.get("goal") or "").strip()
    pipeline_name = str((payload.get("pipeline") or {}).get("name") or "").strip()

    if not _llm_generate_enabled():
        return {
            "ok": False,
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启（或运行时无 LLM key），链路试跑不伪造输出",
            "steps": [],
        }

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    carried: Dict[str, Any] = dict(payload.get("inputs") or {})
    step_results: List[Dict[str, Any]] = []
    all_ok = True

    for step in steps_def:
        name = str(step.get("name") or step.get("id") or "").strip() or "未命名能力"
        input_fields = [str(f) for f in (step.get("inputFields") or [])]
        output_field = str(step.get("outputField") or "").strip()
        filled = "\n".join(
            f"- {ref}：{carried[ref]}" for ref in input_fields if str(carried.get(ref, "")).strip()
        ) or "（未提供输入值）"
        system = (
            "你是产品排练系统里一条 AI 能力链中的一步，正在被链路试跑验证。"
            "根据能力定义和输入字段值，直接生成该能力的输出内容本身——"
            "不要解释、不要客套、不要 markdown 标题，用简体中文，200 字以内。"
        )
        user = (
            (f"产品意图：{goal}\n" if goal else "")
            + (f"能力链：{pipeline_name}\n" if pipeline_name else "")
            + f"当前能力：{name}\n"
            + f"输入字段值：\n{filled}\n"
            + (f"输出字段：{output_field}\n" if output_field else "")
            + "请生成这项能力应产出的内容。"
        )
        started = _time.monotonic()
        try:
            result = call_llm(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.4,
                max_tokens=default_max_tokens(),
                timeout_ms=timeout_ms,
            )
        except LlmError as exc:
            step_results.append({
                "id": step.get("id"), "name": name, "ok": False,
                "code": "LLM_GENERATE_FAILED", "detail": str(exc)[:300],
                "elapsedMs": int((_time.monotonic() - started) * 1000),
            })
            all_ok = False
            break
        output = result.content
        step_results.append({
            "id": step.get("id"), "name": name, "ok": True,
            "output": output,
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        })
        # 字段级传递：本步产出注入衔接字段（与门禁 handoff 校验同一规则）
        if output_field:
            carried[output_field] = output

    return {"ok": all_ok, "steps": step_results}


# ---------------------------------------------------------------------------
# 推演 LLM 通道配置（设置中心「推演通道」）：查看/修改/测试真通道。
# 密钥只回掩码；override 持久化在服务端本机 .llm-override.json（gitignored）。
# ---------------------------------------------------------------------------

from services.llm_channel import apply_override_to_env as _llm_apply_override
from services.llm_channel import get_channel_status as _llm_channel_status
from services.llm_channel import set_channel as _llm_channel_set
from services.llm_channel import test_channel as _llm_channel_test

# 启动时恢复持久化 override（.env 已由 app.py 装载，基线在首次应用前快照）
_llm_apply_override()


@router.get("/llm-channel")
def llm_channel_status(x_internal_key: Optional[str] = Header(None)):
    """当前推演通道配置（base/model/密钥掩码 + override 字段清单）。"""
    _auth(x_internal_key)
    return _llm_channel_status()


@router.post("/llm-channel")
def llm_channel_update(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """更新通道 override：非空字符串=覆盖，空串/null=清除回退 .env。

    2026-08-14 审计补：改的是**服务器级** LLM 通道（所有人的推演都走它），
    只归管理员。此前任何人都能把全站的 LLM 指到自己的端点上。
    """
    _auth(x_internal_key)
    _require_superuser(viewer)
    return _llm_channel_set(payload or {})


@router.post("/llm-channel/test")
def llm_channel_test(
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """对真通道发一次极小请求，结果如实返回（不粉饰失败）。

    与更新同一道门：测试会真烧一次 LLM 调用，也不该对匿名开放。
    """
    _auth(x_internal_key)
    _require_superuser(viewer)
    return _llm_channel_test()


# ---------------------------------------------------------------------------
# 生成质量基线（主线观察台）：读 docs/five-system-generation-baseline.json。
# 文件由 eval_five_system_generation.py --json-out 固化；缺失/损坏如实 404。
# ---------------------------------------------------------------------------

from pathlib import Path as _Path

EVAL_BASELINE_PATH = _Path(__file__).resolve().parent.parent.parent / "docs" / "five-system-generation-baseline.json"


@router.get("/eval-baseline")
def eval_baseline(x_internal_key: Optional[str] = Header(None)):
    """机器可读评测基线原文（观察台摘要卡的数据源）。"""
    import json as _json

    _auth(x_internal_key)
    try:
        payload = _json.loads(EVAL_BASELINE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return JSONResponse({"error": "BASELINE_NOT_FOUND"}, status_code=404)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "BASELINE_NOT_FOUND"}, status_code=404)
    return payload


# ---------------------------------------------------------------------------
# 应用缩略图真实截图（2026-07-23 修复）：Node 侧本地 chromium.launch() 在生产
# Alpine 镜像里必然失败（musl libc + @playwright/test 只在 devDependencies，
# `pnpm install --prod` 排除），一直静默回退假占位卡。改到 E2B 沙盒执行
# Playwright（沙盒是 Debian，glibc 兼容），宿主 Node 镜像零 Chromium 依赖。
# Node 的 /sessions/:sessionId/screenshot 路由代理到这里，缓存逻辑仍在 Node。
# ---------------------------------------------------------------------------


@router.post("/sessions/{sid}/e2b-screenshot")
def capture_session_screenshot(
    sid: str,
    device: str = "desktop",
    x_internal_key: Optional[str] = Header(None),
):
    """截图 sid 对应的已闭环应用；不可用/失败 → 404，Node 侧照实转 503。

    开发环境可从本机前端截图，生产环境仍可使用 E2B；两条路径均不可用时
    fail-closed，不生成占位图冒充真实应用截图。
    """
    _auth(x_internal_key)
    from services.app_screenshot import app_screenshot_available, capture_app_screenshot

    if not app_screenshot_available():
        return JSONResponse({"error": "screenshot_unavailable"}, status_code=404)
    authoritative_device = _session_screenshot_device(load_session(sid), device)
    png_bytes = capture_app_screenshot(sid, device=authoritative_device)
    if not png_bytes:
        return JSONResponse({"error": "screenshot_failed"}, status_code=404)
    from fastapi import Response

    response = Response(content=png_bytes, media_type="image/png")
    response.headers["X-Sliderule-Device"] = authoritative_device
    return response


def _session_screenshot_device(
    state: Optional[V5SessionState], requested_device: str = "desktop"
) -> str:
    """Prefer the current persisted model tier and never probe a second tier."""
    model: Optional[Dict[str, Any]] = None
    if state is not None:
        versions = list(getattr(state, "modelVersions", None) or [])
        current_id = str(getattr(state, "currentModelVersionId", "") or "")
        selected = next(
            (
                version
                for version in versions
                if isinstance(version, dict) and version.get("id") == current_id
            ),
            None,
        )
        if selected is None and versions:
            selected = versions[-1]
        if isinstance(selected, dict) and isinstance(selected.get("model"), dict):
            model = selected["model"]

    appbundle = model.get("appbundle") if isinstance(model, dict) else None
    persisted = appbundle.get("preferredDevice") if isinstance(appbundle, dict) else None
    # ⚠ 2026-08-30 夜：只认 desktop/phone，tablet 落盘后截图仍走 1440 桌面。
    # 分叉问 layout_device，不许再手写 `phone if else desktop`。
    from services.archetype_legal import layout_device

    if persisted:
        return layout_device(persisted)
    return layout_device(requested_device)


# ---------------------------------------------------------------------------
# FreeformInsight 自我校验闭环用的临时预览接口（2026-07-24）：generate_freeform_
# block 生成出候选 JSON 后、写入任何 session 之前，想真实渲染一次截图跟参考图
# 比对。候选内容这时还没有 session_id，走不了上面按 session 截图的路子——
# 存一份到内存里给个随机 id，E2B 沙盒里的浏览器拿这个 id 来问内容、渲染。
# 未鉴权（GET，无 x_internal_key 校验）：内容本身是几分钟内过期的一次性预览
# 负载，不是敏感数据，鉴权反而会挡住 E2B 沙盒里浏览器的直接 fetch。
# ---------------------------------------------------------------------------


@router.get("/freeform-preview/{pid}")
def get_freeform_preview(pid: str):
    """按 id 取一份临时预览负载；不存在/已过期 → 404，不伪造内容。"""
    from services.freeform_preview_store import get_preview

    payload = get_preview(pid)
    if payload is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({k: v for k, v in payload.items() if not k.startswith("_")})


@router.get("/freeform-preview/{pid}/media/{asset}")
def get_freeform_preview_media(pid: str, asset: str):
    from services.freeform_preview_store import get_preview

    payload = get_preview(pid)
    encoded = payload.get("_landingHeroB64") if payload and asset == "landing-hero" else None
    if not isinstance(encoded, str) or not encoded:
        return JSONResponse({"error": "not_found"}, status_code=404)
    try:
        png_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return Response(content=png_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# 生成应用存储 / App Store（2026-07-24）——推演出来的应用（设计层）持久化，
# 后续「组建库」的地基。有 APP_STORE_DATABASE_URL 落托管 Postgres，无则回退
# 本地 JSON 文件（见 services/app_store.py）。列表/详情/fork/版本/导出。
# ---------------------------------------------------------------------------


@router.get("/apps")
async def list_generated_apps(
    viewer: CurrentUserOptional,
    limit: int = 50,
    offset: int = 0,
    scope: Optional[str] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """应用画廊列表——默认每个应用只出最新版，摘要不含大模型载荷。

    **同步的库调用必须 to_thread**（2026-08-02 线上事故修复）。这几条路由是
    `async def`，而 uvicorn 只跑一个 worker、一个事件循环；直接在协程里调同步
    的 SQLAlchemy，一次慢查询就把整个事件循环冻住——`/api/health` 与
    `/api/agent-loop/health` 跟着一起超时，"存储层拖垮主链路"的承诺当场作废。
    这正是切回 Neon 后线上观察到的形状。

    本文件里 LLM/RAG/附件解析那几条早就是这么写的（见 asyncio.to_thread 的
    其它调用点），app store 这几条是漏网的。

    ⚠ 2026-08-19：`scope=market|mine|official` 是货架，不是第二套权限。
    不传 scope 保持旧行为（filter_records 之后的全部可见记录），侧栏缩略图
    仍走这条。应用中心三个 tab 必须带 scope，否则超管的「我的应用」又会
    把全站货架混进来。
    """
    _auth(x_internal_key)
    from services import app_store
    from services.app_access import filter_records, matches_shelf, normalize_shelf

    raw = (scope or "").strip().lower()
    shelf = normalize_shelf(scope)
    if raw and raw != "all" and shelf is None:
        raise HTTPException(400, "unknown shelf")
    if shelf == "mine" and viewer is None:
        return {"apps": []}
    owner_id = getattr(viewer, "id", None) if shelf == "mine" else None
    apps = await asyncio.to_thread(
        app_store.list_apps,
        limit=limit,
        offset=offset,
        shelf=shelf,
        owner_id=owner_id,
    )
    # 列表过滤与单条判定共用 app_access 的同一份判定——两套代码漂移是这类系统
    # 最常见的泄露方式（列表少过滤一个条件，私有应用就出现在广场上，而单条打开
    # 是好的，所以没人会报 bug）。见 tests/test_app_access.py 那条穷举测试。
    visible = filter_records(apps, viewer)
    if shelf:
        visible = [row for row in visible if matches_shelf(row, shelf, viewer)]
    return {"apps": visible}


@router.get("/apps/{app_id}")
async def get_generated_app(
    app_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """取一个生成应用的完整记录（含 model_json，可直接重开渲染）。

    同步库调用走 to_thread，理由见 list_generated_apps。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    # 看不见的资源报 404 而不是 403——403 等于确认"这个 id 存在"，
    # 可以被用来枚举别人的私有应用。require 内部已按此实现。
    app_access.require("view", record, viewer)
    return record


@router.patch("/apps/{app_id}")
async def patch_generated_app(
    app_id: str,
    request: Request,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """改可见性（所有者）或官方归属（仅超管）。

    ⚠ 2026-08-19：access 模型里 `set_visibility` 早就在 REQUIRED 里，
    但没有任何路由挂上——前端旋钮装了也是死的。官方不是资源 Owner 就能把
    自己的应用送上官方货架：对标 Gitea 转让，只认 is_superuser，并改 owner_id。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    body: dict[str, Any] = {}
    try:
        raw = await request.json()
        if isinstance(raw, dict):
            body = raw
    except Exception:
        body = {}
    visibility = body.get("visibility") if "visibility" in body else None
    official = body.get("is_official") if "is_official" in body else None
    if visibility is None and official is None:
        raise HTTPException(400, "nothing to patch")
    if visibility is not None:
        app_access.require("set_visibility", record, viewer)
    if official is not None:
        if viewer is None:
            raise HTTPException(401, "请先登录", headers={"WWW-Authenticate": "Bearer"})
        if not bool(getattr(viewer, "is_superuser", False)):
            raise HTTPException(403, "只有超管能把应用移交给官方")
        app_access.require("view", record, viewer)
    patched = await asyncio.to_thread(
        app_store.patch_app,
        app_id,
        visibility=str(visibility) if visibility is not None else None,
        is_official=bool(official) if official is not None else None,
    )
    if patched is None:
        raise HTTPException(404, "app not found")
    return {
        "id": patched.get("id"),
        "visibility": patched.get("visibility"),
        "is_official": bool(patched.get("is_official")),
        "owner_id": patched.get("owner_id"),
        "prior_owner_id": patched.get("prior_owner_id"),
    }


#: 点选编辑器手动存页面 HTML 的体积上限。真实页面实测 30~50KB，留够几倍
#: 余量给手改；跟 _MAX_SHOT_BYTES 同一条纪律——这是手动调用的窄接口，不该
#: 因为漏了上限被拿去当任意大小 blob 存储用。
_MAX_PAGE_HTML_BYTES = 1024 * 1024


@router.patch("/apps/{app_id}/pages/{page_id}")
async def patch_generated_app_page(
    app_id: str,
    page_id: str,
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """点选编辑器：把画布里改好的单页 HTML 存回 pages_json。

    ⚠ 这是**手动、单次**的覆盖，不走 save_app_or_version 那套"要不要开新版本"
    的判定——那套是给 AI 精修用的（判的是"AI 这轮产出的东西跟上一版比变没
    变"）。这里用户已经在画布里明确点了保存，语义上更接近"编辑并存档"，不是
    "又跑了一轮推演"，原地覆盖当前版本即可。真要给手动编辑也留版本历史，
    那是另一个决定，不在这次的范围里。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    app_access.require("revise", record, viewer)

    html = payload.get("html") if isinstance(payload, dict) else None
    if not isinstance(html, str) or not html.strip():
        raise HTTPException(400, "html 不能为空")
    if len(html.encode("utf-8")) > _MAX_PAGE_HTML_BYTES:
        raise HTTPException(413, f"页面 HTML 超过 {_MAX_PAGE_HTML_BYTES} 字节上限")

    # ── 存之前先看一眼这一笔顺手带走了什么（2026-09-05）────────────────
    #
    # 只报不拦（§7）：用户确实可能故意删一段，拿这个去 403 会挡住正当编辑。
    # 但"一次无关的编辑把交付物里的东西悄悄带走"不该没人吭声——真机
    # sr-20260904232526 就是改个标题把整局游戏逻辑（内联 script）存没了，
    # 接口还返回 ok。理由与量法见 services/page_edit_guard 头注。
    _losses: List[Dict[str, Any]] = []
    try:
        # ⚠ 存的是 `pages_json["pages"][page_id]`（见 app_store.update_page_html），
        #   不是 `pages_json[page_id]`。第一版写错了一层，取到的永远是空串，
        #   于是体检永远说"没损失"——一道恒绿的闸比没有闸更糟。
        _pj = (record.get("pages_json") or {}) if isinstance(record, dict) else {}
        _pages_before = _pj.get("pages") if isinstance(_pj, dict) else None
        _cand = _pages_before.get(page_id) if isinstance(_pages_before, dict) else None
        _before = _cand if isinstance(_cand, str) else ""
        if _before:
            _losses = edit_losses(_before, html)
            _gate_record(
                "pageEdit",
                passed=not _losses,
                fingerprint=",".join(sorted(x["kind"] for x in _losses)) or "clean",
                context=str(app_id),
            )
            if _losses:
                print(f"[page-edit] ⚠ {app_id}/{page_id} {losses_message(_losses)}")
    except Exception as _exc:  # noqa: BLE001 — 体检是增强类，不许挡住保存
        print(f"[page-edit] 体检跳过：{str(_exc)[:120]}")

    try:
        updated = await asyncio.to_thread(
            app_store.update_page_html, app_id, page_id, html
        )
    except ValueError as exc:
        code = str(exc)
        if code == "no_pages":
            raise HTTPException(400, "这个应用没有可编辑的页面产物") from exc
        if code == "page_not_found":
            raise HTTPException(404, f"页面 '{page_id}' 不存在于这个应用里") from exc
        raise HTTPException(400, "保存失败") from exc
    if updated is None:
        raise HTTPException(404, "app not found")
    return {
        "id": updated.get("id"),
        "pageId": page_id,
        # 带走了什么如实透出。**接口不许只说 ok**。
        # ⚠ 人话那句一并给出去：措辞只该有一处（§4）。让每个客户端各自拼一遍，
        #   改口径时就得改三处，漏一处就是"只改一半"。
        "losses": _losses,
        "lossesMessage": losses_message(_losses),
        "bytes": len(html.encode("utf-8")),
    }


#: 点选编辑器"✨ AI 编辑"的输入上限。选中的是单个元素，不是整页——
#: 80KB 够装一个很夸张的表格片段了，超过大概率是选错了层级。
_MAX_AI_EDIT_ELEMENT_HTML_BYTES = 80 * 1024
_MAX_AI_EDIT_INSTRUCTION_CHARS = 500


def _strip_markdown_fence(text: str) -> str:
    """LLM 有时会不听话地把 HTML 包一层 ```html ... ``` ——剥掉，不当错误处理。"""
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:html)?\s*|\s*```\s*$", "", t, flags=re.IGNORECASE).strip()
    return t


@router.post("/apps/{app_id}/pages/{page_id}/ai-edit-element")
async def ai_edit_page_element(
    app_id: str,
    page_id: str,
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """点选编辑器的"✨ AI 编辑"按钮：选中元素的 HTML + 一句改法 → LLM 换一份
    改过的 HTML 回来。

    ⚠ **不落库**——这条接口本身没有副作用。跟画布里的"改字/改色/删除"
    一样，AI 编辑完只是把新 HTML 换进画布，用户点右上角"保存修改"才真的
    写进 `pages_json`（走的还是 `update_page_html`，见上面 PATCH 那条）。
    没有这条边界的话，AI 编辑就会绕开"未保存可以撤销/放弃"这条纪律，
    调用方（前端）在拿到返回值之前**必须**过一遍 `sanitizeHtmlFragment`
    （html-app-surface 那份 DOMPurify 白名单的片段版）再塞进 DOM——这里
    回的是 LLM 的原始输出，没有消毒，图省事直接 innerHTML 就是开 XSS 口子。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    app_access.require("revise", record, viewer)

    element_html = payload.get("elementHtml") if isinstance(payload, dict) else None
    instruction = payload.get("instruction") if isinstance(payload, dict) else None
    if not isinstance(element_html, str) or not element_html.strip():
        raise HTTPException(400, "elementHtml 不能为空")
    if not isinstance(instruction, str) or not instruction.strip():
        raise HTTPException(400, "请说清楚想怎么改")
    if len(element_html.encode("utf-8")) > _MAX_AI_EDIT_ELEMENT_HTML_BYTES:
        raise HTTPException(413, f"选中元素超过 {_MAX_AI_EDIT_ELEMENT_HTML_BYTES} 字节上限，选小一点的范围再试")
    if len(instruction) > _MAX_AI_EDIT_INSTRUCTION_CHARS:
        raise HTTPException(400, f"改法说明超过 {_MAX_AI_EDIT_INSTRUCTION_CHARS} 字上限")

    from services.v5_capability_executor import _llm_generate_enabled

    if not _llm_generate_enabled():
        raise HTTPException(503, "AI 编辑没开（SLIDERULE_LLM_GENERATE_ENABLED 未开启）")

    from sliderule_llm.client import LlmError, call_llm
    from sliderule_llm.config import default_max_tokens

    system = (
        "你是网页局部编辑器。用户会给你一个 HTML 元素片段和一句改法要求，"
        "你只输出改完之后这一个元素的完整 HTML（含它自己的标签），"
        "不要输出解释、不要用 markdown 代码块包裹、不要输出多个顶层元素。"
        "尽量保留原有的 class（Tailwind 工具类）风格与体量，"
        "保留原有的 data-field / data-entity / data-record / data-action 等 data-* 属性"
        "（除非用户明确要求删掉这个元素代表的数据绑定）——那些属性是这页面接数据用的，"
        "删了对应的数字/文字会消失。"
    )
    user = f"要改的 HTML：\n{element_html}\n\n改法：{instruction.strip()}"

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    try:
        result = await asyncio.to_thread(
            call_llm,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        raise HTTPException(502, f"AI 编辑失败：{str(exc)[:200]}") from exc

    html = _strip_markdown_fence(result.content)
    if not html.strip():
        raise HTTPException(502, "AI 没有返回内容，换个说法再试试")
    return {"html": html}


@router.post("/apps/{app_id}/pages/{page_id}/ai-edit-block")
async def ai_edit_page_block(
    app_id: str,
    page_id: str,
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """刀 3：只重写**一块**（2026-08-27）。

    跟上面 ai-edit-element 是一对：那条改的是"选中的一个元素"，这条改的是
    "画布上摊开的那一块"。粒度不同，边界一样——**都不落库**，用户在画布里
    点保存才走 PATCH。

    ## 为什么整页 HTML 由前端传上来

    照 ai-edit-element 的口径：这条接口无状态。好处是画布里还没保存的改动
    也能接着改（用户改了 A 块再改 B 块，第二次的 pageHtml 是含 A 改动的那份）。
    从库里读的话，第二次会把 A 的改动悄悄丢掉——不报错，只是白改一遍。

    ## 三道闸，全部 fail-closed

    1. ``slice_block`` —— 这一页没有这块 / 块名重复，直接失败（重名时改哪一块
       都是猜，抄 grok managed_text 的 ``duplicate requested item``）
    2. ``validate_block_body`` —— 新 body 含 ``data-block`` / 标签不平衡 / 带
       ``<script>``，一律打回。**不许**"尽力修一下再落"：标签不平衡会把外层
       的块提前关掉，那一页后半段全被吸进这一块里，闸全绿而页面塌了。
    3. ``replace_block`` —— 只换 body，``before``/``after``（grok 的
       unmanaged_text）一个字节不动

    ⚠ 闭环/证据类 fail-closed，这条属于前者（纪律七）：改块改坏了宁可报错，
      不能端出一份"看着像改过"的页面。

    ⚠ 返回的是 LLM 原始输出拼出来的整页，**没有消毒**。前端塞进 DOM 之前
      必须过 DOMPurify（同 ai-edit-element 那条注释）。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    app_access.require("revise", record, viewer)

    page_html = payload.get("pageHtml") if isinstance(payload, dict) else None
    block_name = payload.get("blockName") if isinstance(payload, dict) else None
    instruction = payload.get("instruction") if isinstance(payload, dict) else None
    if not isinstance(page_html, str) or not page_html.strip():
        raise HTTPException(400, "pageHtml 不能为空")
    if not isinstance(block_name, str) or not block_name.strip():
        raise HTTPException(400, "blockName 不能为空")
    if not isinstance(instruction, str) or not instruction.strip():
        raise HTTPException(400, "请说清楚这一块想怎么改")
    if len(page_html.encode("utf-8")) > _MAX_PAGE_HTML_BYTES:
        raise HTTPException(413, f"页面 HTML 超过 {_MAX_PAGE_HTML_BYTES} 字节上限")
    if len(instruction) > _MAX_AI_EDIT_INSTRUCTION_CHARS:
        raise HTTPException(400, f"改法说明超过 {_MAX_AI_EDIT_INSTRUCTION_CHARS} 字上限")

    from services.page_blocks import (
        BlockEditError,
        replace_block,
        slice_block,
        validate_block_body,
    )

    try:
        cut = slice_block(page_html, block_name)
    except BlockEditError as exc:
        raise HTTPException(400, str(exc)) from exc

    from services.v5_capability_executor import _llm_generate_enabled

    if not _llm_generate_enabled():
        raise HTTPException(503, "AI 编辑没开（SLIDERULE_LLM_GENERATE_ENABLED 未开启）")

    from sliderule_llm.client import LlmError, call_llm
    from sliderule_llm.config import default_max_tokens

    system = (
        "你是网页区块编辑器。用户给你一个区块的**内部** HTML 和一句改法要求，"
        "你只输出改完之后这个区块的内部 HTML。\n"
        "硬性要求：\n"
        "1. 只输出 HTML 本身，不要解释、不要 markdown 代码块。\n"
        "2. **不要输出区块自己的外层标签**——只要里面的内容。\n"
        "3. **绝对不要写 data-block 属性**，写了会把区块边界劫走，整页会塌。\n"
        "4. 标签必须自平衡：每个开标签都要有对应的闭合标签。\n"
        "5. 保留原有的 data-field / data-entity / data-record / data-rows / "
        "data-action 等 data-* 属性——那些是这页面接数据用的，删了对应的"
        "数字和文字会整片消失。\n"
        "6. 尽量沿用原有的 class（Tailwind 工具类）风格与体量。"
    )
    user = (
        f"区块名：{cut['name']}（类型：{cut['kind']}）\n"
        f"区块内部 HTML：\n{cut['body']}\n\n"
        f"改法：{instruction.strip()}"
    )

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    try:
        result = await asyncio.to_thread(
            call_llm,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        raise HTTPException(502, f"AI 改块失败：{str(exc)[:200]}") from exc

    new_body = _strip_markdown_fence(result.content)
    if not new_body.strip():
        raise HTTPException(502, "AI 没有返回内容，换个说法再试试")

    try:
        validate_block_body(new_body, name=block_name)
        merged = replace_block(page_html, block_name, new_body)
    except BlockEditError as exc:
        # fail-closed：宁可报错，不端一份"看着像改过"的页面
        raise HTTPException(422, f"AI 改出来的内容过不了闸：{exc}") from exc

    return {
        "pageId": page_id,
        "blockName": cut["name"],
        "blockHtml": new_body,
        "html": merged,
        # 给判据用：改完只有这一块变，两侧 unmanaged_text 一个字节没动
        "unchangedBytes": len(cut["before"]) + len(cut["after"]),
    }


#: 手动换图搜一次最多等多久。自动画页那条是 3s（fail-open，超时就留占位图，
#: 不能拖慢整轮推演）；这条是用户点了按钮在等，宁可多等两秒也别空手而归——
#: 2026-08-25 实测这条链路上 3s 频繁 ReadTimeout。
_STOCK_SEARCH_TIMEOUT_S = 8.0
_MAX_STOCK_ALT_CHARS = 200


@router.post("/stock-images/search")
async def search_stock_images_for_replacement(
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """画布「换图」：按这张图的 alt 找可以替换的真实图片。

    只读——**不碰 pages_json**。用户从候选里挑一张之后，前端走既有的
    `PATCH /apps/{id}/pages/{pageId}` 落库，跟点选编辑同一条写回路径。

    ⚠ 不是通用取图代理：外呼地址写死 Unsplash Search（没 key 退已校验目录），
      用户能控的只有查询词，所以没有 SSRF 面。候选也只回 images.unsplash.com
      ——已经在 spec_page_html._ALLOWED_HOSTS 里，换进页面之后再跑精修不会被
      「未授权外链」判失败（真机踩过：Unsplash 写进 HTML 整页校验失败）。

    ⚠ 搜不到就如实回空 candidates，**不回落成 placehold.co**。自动画页那条
      回落是对的（不能拖垮推演），这条不行：用户是点了「换图」在等结果，
      给他一张占位图当"成功"就是伪造绿灯。
    """
    _auth(x_internal_key)
    from services.stock_images import search_replacement_images

    alt = payload.get("alt") if isinstance(payload, dict) else None
    src = payload.get("src") if isinstance(payload, dict) else None
    if not isinstance(alt, str) or not alt.strip():
        raise HTTPException(400, "这张图没有 alt 描述，没法按语义搜——请直接粘贴图片地址")
    if len(alt) > _MAX_STOCK_ALT_CHARS:
        raise HTTPException(400, f"alt 超过 {_MAX_STOCK_ALT_CHARS} 字上限")

    result = await asyncio.to_thread(
        search_replacement_images,
        alt.strip(),
        src if isinstance(src, str) else "",
        timeout_s=_STOCK_SEARCH_TIMEOUT_S,
    )
    return {
        "query": result.get("query") or "",
        "aspect": result.get("aspect"),
        "tried": result.get("tried") or [],
        "candidates": result.get("candidates") or [],
    }


#: 单次 HTTP 调用的上限 / 这一整次取数的上限。
#:
#: ⚠ **两个数，不是一个。** 2026-08-25 真机咬出来的：这里原本只有一个 45 秒
#:   并且当成 timeout_s 传下去，结果单次调用可以卡满 45 秒，重试根本轮不上，
#:   一次抖动就是 46 秒白等（并发 6 条稳定复现 2 条卡满，单条只要 1.5 秒）。
_CONNECTOR_CALL_TIMEOUT_S = 12.0
_CONNECTOR_BUDGET_S = 40.0


@router.get("/connectors")
async def list_available_connectors(x_internal_key: Optional[str] = Header(None)):
    """有哪些连接器可用（输入框里 `/` 选择器的数据源）。

    只回**公开信息**：id / 人话名 / 它会落成哪个实体、哪些字段 / 要不要凭据。
    不回任何 key。`available=false` 的也照样列出来并说明缺什么——列表里
    干脆不出现的话，用户只会以为"这个产品没有天气"，而不是"我还没配".
    """
    _auth(x_internal_key)
    from services.connectors import list_connectors

    return {"connectors": list_connectors()}


@router.post("/connectors/{connector_id}/rows")
async def fetch_connector_rows(
    connector_id: str,
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """取一次真数据，落成实体行。

    ⚠ **失败一律 200 + ok:false，不抛 HTTPException。** 这里是故意的：
      前端拿到 502 只能显示"出错了"，而用户需要知道的是"城市认不出"还是
      "数据源超时"——两者的下一步动作完全不同。错误语义要走数据面，
      不是走状态码。

    ⚠ 取不到就是取不到：rows 一定是空数组，**不许**回落成占位行。
      这条跟换图那条同源——用户点了按钮在等，给他假的当"成功"就是伪造绿灯。
      连接器模块自己也守着这一条（services/connectors.fetch_rows），
      这里再守一次是因为**两边都可能被后人改**（仓里第四条：成对的东西）。
    """
    _auth(x_internal_key)
    from services.connectors import fetch_rows

    args = payload.get("args") if isinstance(payload, dict) else None
    result = await asyncio.to_thread(
        fetch_rows,
        connector_id,
        args if isinstance(args, dict) else {},
        timeout_s=_CONNECTOR_CALL_TIMEOUT_S,
        budget_s=_CONNECTOR_BUDGET_S,
    )
    out = result.to_public()
    if not out["ok"]:
        out["rows"] = []
    return out


@router.get("/apps/{app_id}/preview")
async def get_generated_app_preview(
    app_id: str,
    request: Request,
    source: Optional[str] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """应用中心卡片的缩略图 PNG。

    **优先级判定在这一侧**，前端不需要知道有几个来源（完整说明见 app_store 的
    PREVIEW_SOURCE_PRIORITY）：

      shot  —— 应用真实渲染出来之后截的图，就是应用本身；由前端采集后回传，
               见下面的 POST 同名路由
      sheet —— 生成时那张首页参照板，是示意图；落库即有
      都没有 → 404，卡片画空态。这不是错误态，是"这条记录没这份资产"。

    source 可选，指名只要某一路（"shot" / "sheet"）。**只为排查存在**——正常
    路径不传，让服务端挑。指名了但那一路没有图 → 404，不会偷偷回落到另一路，
    否则"指名 shot 拿到 sheet"会让排查得出反向结论。

    强缓存：一条 generated_app 记录不可变（精修产生的是**新** app_id，见
    save_version），第二次进应用中心连请求都不发。**但图本身是可变的**——采集
    回传会把 sheet 换成 shot。所以前端在 URL 上带一个 `?v={preview_tag}`
    （摘要里给的，来源 + 写入时刻），图一变 URL 就变，immutable 才成立。
    这里不读 v，它的全部作用就是当缓存键。
    """
    _auth(x_internal_key)
    from services import app_store

    # 同步库调用走 to_thread，理由见 list_generated_apps。
    data = await asyncio.to_thread(
        app_store.get_app_preview_png,
        app_id,
        source=app_store.normalize_preview_source(source) if source else None,
    )
    if not data:
        raise HTTPException(404, "preview not found")

    from services.thumb_image import client_accepts_webp, sniff_media_type, to_png

    # 按内容报 Content-Type，不写死 image/png：库里存量是 PNG、新写入是 WebP，
    # 报错类型浏览器可能拒绝渲染，CDN 也会缓存错。
    media = sniff_media_type(data)
    # Accept 头协商（thumbor / imgproxy / Next.js Image 同款做法）：不认 WebP 的
    # 客户端现场转回 PNG。WebP 覆盖率 97%+，这条是给极老客户端和抓取工具留的，
    # 不是主路径。转不动就原样给——宁可让客户端拿到一张它可能不认的图，
    # 也不要 500。
    if media == "image/webp" and not client_accepts_webp(request.headers.get("accept")):
        data = await asyncio.to_thread(to_png, data)
        media = sniff_media_type(data)
    return Response(
        content=data,
        media_type=media,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/sessions/{session_id}/preview")
async def get_generated_session_preview(
    session_id: str,
    request: Request,
    source: Optional[str] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """Serve the current session's trusted generated media without exposing a model URL field."""
    _auth(x_internal_key)
    from services import app_store
    from services.thumb_image import client_accepts_webp, sniff_media_type, to_png

    data = await asyncio.to_thread(
        app_store.get_session_preview_png,
        session_id,
        source=app_store.normalize_preview_source(source) if source else None,
    )
    if not data:
        raise HTTPException(404, "preview not found")
    media = sniff_media_type(data)
    if media == "image/webp" and not client_accepts_webp(request.headers.get("accept")):
        data = await asyncio.to_thread(to_png, data)
        media = sniff_media_type(data)
    return Response(
        content=data,
        media_type=media,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/sessions/{session_id}/generated-app")
async def get_session_generated_app(
    session_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """这个会话最新落库的那条应用摘要。

    推演收口前端要 app_id 才能把 html2canvas 的图 POST 回去。列表接口按货架
    分页，用它反查会漏；会话 GET 又不带应用 id。这条只多一次按 session_id
    的查找，载荷是摘要（不含 model_json / pages_json）。
    """
    _auth(x_internal_key)
    from services import app_store

    row = await asyncio.to_thread(app_store.get_latest_app_for_session, session_id)
    if row is None:
        raise HTTPException(404, "app not found")
    full = await asyncio.to_thread(app_store.get_app, str(row.get("id") or ""))
    if full is None:
        raise HTTPException(404, "app not found")
    app_access.require("view", full, viewer)
    return row


#: 回传截图的体积上限。实测一张 1440×810、pixelRatio 2 的应用截图约 325KB；
#: 留到 3MB 是给手机档（720×1280 更高）和复杂页面的余量。超了直接 413——
#: 这是一张缩略图，几 MB 的东西进来只会把列表接口和 Neon 拖慢。
_MAX_SHOT_BYTES = 3 * 1024 * 1024

#: 允许回传的图片格式。采集端出的是 WebP（见 client/src/lib/thumb-capture.ts），
#: 但 canvas.toBlob 对不认识的 type 会静默回落成 PNG，所以两种都得收。
#: 仍然只收这两种：取图路由按内容嗅探报 Content-Type，收进来一个声称是图片的
#: 任意字节流只会让浏览器拿到一张渲染不出来的东西。
_ALLOWED_SHOT_MAGIC = ("image/png", "image/webp")


def _looks_like_image(data: bytes) -> bool:
    """真的按魔数验一遍。

    sniff_media_type 认不出时会**兜底返回 image/png**（为了让历史存量能正常
    显示），所以它不能单独用来做入口校验——不然任意字节流都会被判成 PNG 放进来。
    """
    return data.startswith(b"\x89PNG\r\n\x1a\n") or (
        data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    )


@router.post("/apps/{app_id}/preview")
async def upload_generated_app_shot(
    app_id: str,
    request: Request,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """收前端采集到的应用真实截图（缩略图优先级的第一级）。

    ## 为什么由前端采集，而不是服务端起浏览器

    推演收口那一刻，浏览器本来就要把落地页渲染一遍。既然那次昂贵的渲染已经
    发生了，就地采下来存住，等于「这次渲染是最后一次」。服务端再起一个浏览器
    去渲染同一个东西是纯浪费，还要背上沙盒/容器/无头浏览器那一整套运维面。

    ⚠ 2026-08-23 修注释。这里原本写的是另一套：「应用中心里没有图的卡片本来
      就在活渲染，就地采下来」+「副作用是白赚的：**存量应用也会被自动补上**，
      只要有人在应用中心看见过那张卡，它就有图了」。**那套 2026-08-22 已经
      整个删掉**——卡片改成只贴图、没图画 antd Empty（活渲染同屏十几张把主线程
      堵四秒）。删掉之后：

        · 唯一的采集者是推演收口（client 的 studio-landing-shot.tsx）
        · 存量应用不会再自己长出图（明确取舍，用户 2026-08-22：不补拍）
        · 不经过收口的 fork / 精修拿不到图，只能靠 app_store._attach_preview
          从源那条继承

      照旧注释排查会得出"再逛一圈市场图就补上了"的错误结论——2026-08-23 就是
      这么绕了一圈才找到 fork 没图的真因。

    ## 幂等

    同一个应用可能被多个标签页重复采集。已经有截图就直接跳过（返回
    stored=false），省掉一次写库和一次强缓存失效。

    ⚠ 这道幂等**只挡不带 replace 的采集**。当前唯一的采集者（收口）一律带
      replace=1，所以它实际上谁也没挡住；留着是给将来可能回来的"礼让式"采集
      路径用的。注意与 _attach_preview 的继承合看：继承来的 shot 会让这道
      幂等成立，一条不带 replace 的新采集路径会被它挡下。

    `?replace=1` 给**写者**覆盖已有 shot：推演收口那一次必须换图（这一版跟
    上一版长得不一样）。路过的访客没有写权限，不能把别人采好的图改掉。

    ## 请求体

    原始 PNG / WebP 字节。不用 multipart / base64 JSON——
    一张图一个请求，裸字节最省，也不给解析器留歧义。
    """
    _auth(x_internal_key)
    from services import app_store

    # 同步库调用走 to_thread，理由见 list_generated_apps。
    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    # 2026-08-14 审计补：门槛是 **READ 不是 WRITE**——采集的设计本来就是
    # "谁在应用中心看见这张卡，谁的浏览器顺手把图补上"（见上面的头注），
    # 公共应用的众包补图要保住。挡的是另一半：看不见的私有应用不许被
    # 盲猜 id 塞图（require 对无权者报 404，不确认 id 存在）。
    app_access.require("view", record, viewer)
    replace = (request.query_params.get("replace") or "").strip().lower() in (
        "1", "true", "yes",
    )
    # 覆盖只给写者：推演收口换图是作者的事。路过的访客只能补「还没有 shot」
    # 的卡，不能把别人已经采好的图改掉。
    if replace:
        app_access.require("revise", record, viewer)
    elif await asyncio.to_thread(app_store.app_has_shot, app_id):
        return {"stored": False, "reason": "already_has_shot"}

    body = await request.body()
    if not body:
        raise HTTPException(400, "empty body")
    if len(body) > _MAX_SHOT_BYTES:
        raise HTTPException(413, "screenshot too large")
    from services.thumb_image import sniff_media_type

    if sniff_media_type(body) not in _ALLOWED_SHOT_MAGIC or not _looks_like_image(body):
        raise HTTPException(415, "expected a PNG or WebP image")

    stored = await asyncio.to_thread(app_store.save_app_shot, app_id, body)
    return {"stored": stored, "bytes": len(body)}


@router.get("/apps/{root_id}/versions")
async def list_generated_app_versions(
    root_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """一个应用的改版历史（同 root 的所有版本，按 version 升序，摘要）。

    2026-08-14 审计补：逐条过 filter_records——列表路由 `/apps` 早就过滤了，
    这条改版历史漏了，私有应用的版本链（含名字、话题摘要）拿 root_id 就能枚举。
    摘要字段里 owner_id/visibility 都在（_summary 只去大载荷），直接复用同一份判定。
    """
    _auth(x_internal_key)
    from services import app_store
    from services.app_access import filter_records

    versions = await asyncio.to_thread(app_store.list_versions, root_id)
    return {"versions": filter_records(versions, viewer)}


@router.post("/components/assemble")
async def assemble_component_page(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """组件库的「AI 组装」：现场从区块目录拼一页出来。

    用户要的形状（2026-08-07）：组件库顶部一个按钮，点了之后大模型从**当前
    显示的这些真实组件**里挑、排、绑，出来一个能真录数据的完整页面。

    与推演的区别，两条都重要：

      · 它不建会话、不落库、不进应用中心——组装结果只活在弹层里，关了就没。
        所以这里**不要求登录**：看一眼积木能怎么拼，和"生成一个归你的应用"
        不是一回事。
      · 它不跑五系统，只做"选材 + 排位 + 绑定"这一层。数据模型由调用方给
        （组件库用它自己那份订单夹具），模型不发明实体。

    校验在 services/block_assembler：模型挑错类型/放错槽位/绑不存在的字段
    都会被逐个剔除，剔除原因如实回给前端，不静默吃掉。
    """
    _auth(x_internal_key)
    from services.block_assembler import assemble_page

    page_kind = str(payload.get("pageKind") or "workbench").strip()
    allowed = payload.get("allowedTypes")
    allowed_types = [str(t) for t in allowed] if isinstance(allowed, list) else []
    datamodel = payload.get("datamodel")
    if not isinstance(datamodel, dict) or not datamodel.get("entities"):
        raise HTTPException(400, "datamodel.entities 不能为空——组装需要知道有哪些字段可绑")

    # 组装是一次 LLM 调用，几十秒起步；跑在线程池里，别占着事件循环
    # （fork 那次就是同步跑 11 秒把所有并发请求一起卡住的）。
    return await asyncio.to_thread(assemble_page, page_kind, allowed_types, datamodel)


@router.post("/components/assemble-base")
async def assemble_base_screen_route(
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """从**基础组件**里抽一屏（2026-08-08）。

    与 /components/assemble 的区别，说清楚免得两条路被当成一回事：

      assemble       从业务积木抽。它们有 bindingSchema，能绑实体和字段，
                     组装出来的页面**真能录数据**。
      assemble-base  从 antd / antd-mobile 官方组件抽。它们没有数据契约，
                     render 就是一段官方 demo，所以抽出来的是**结构**
                     ——哪些组件、什么顺序、分几栏；内容仍是示例内容。

    组件清单由前端传（跟 assemble 传 allowedTypes 同一条规矩：从当前显示的
    里面抽），服务端只认清单里的名字。
    """
    _auth(x_internal_key)
    from services.block_assembler import assemble_base_screen

    comps = payload.get("components")
    if not isinstance(comps, list) or not comps:
        raise HTTPException(400, "components 不能为空")
    hint = str(payload.get("industryHint") or "").strip()
    return await asyncio.to_thread(assemble_base_screen, comps, hint)


@router.post("/components/assemble-page")
async def assemble_page_route(
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """五阶段页面装配：意图 → 范式 → 区块 → 实例 → Gate（2026-08-08）。

    替换掉 assemble-base 那条。区别不是提示词调优，是**装配目标**：

      assemble-base  给模型 137 个基础组件的清单，让它选几个排出来。
                     实测产物是"组件示例合集换了个标题"——Menu / Input /
                     Button / Table / Pagination 各占一张等大的卡，
                     内容还是「甲 乙 12 34」。
      assemble-page  模型先说清用户在这一页要干什么，再挑范式，再往范式的
                     区域里填**业务区块**。基础组件一个都不出现——它们由
                     区块自己解析。产出过 Gate 才返回。

    Gate 不过会带着 findings 回喂重来一次；仍不过就如实返回失败与原因，
    **不降级展示一个坏页面**——用户看到坏页面时怪的是产品。
    """
    _auth(x_internal_key)
    from services.page_assembler import assemble_page

    intent = str(payload.get("intent") or "").strip()
    if not intent:
        raise HTTPException(400, "intent 不能为空——说不出这一页是干什么的，装配无从谈起")
    datamodel = payload.get("datamodel")
    if not isinstance(datamodel, dict) or not datamodel.get("entities"):
        raise HTTPException(400, "datamodel.entities 不能为空")
    return await asyncio.to_thread(assemble_page, intent, datamodel)


@router.post("/components/propose-blocks")
async def propose_blocks_route(
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """AI 组装区块：从「还没接进区块」的基础组件里提议下一个该建的区块。

    与 assemble-page 是**两次不同方向的组装**（用户 2026-08-08 定的链路）：

      assemble-page    从现有区块里挑，摆进页面区域  → 产物是数据，直接能渲染
      propose-blocks   从基础组件里挑，定义一个新区块 → 产物是契约，还要人实现

    后者不生成代码，这是查过 GitHub 之后的判断：Ant Design 官方那 29 个
    「区块」(ant-design/pro-blocks) 全是手写 React 源码，`umi block add` 是把
    源码拷进项目的脚手架，不是运行时拼装。区块带逻辑，逻辑就是代码。所以这里
    让模型做的是设计——说出还缺哪个区块、它的契约长什么样。

    基础组件清单由前端传：那份目录是 TSX（每条挂着一个真实 render），搬不到
    Python 侧，让持有 SSOT 的那一边送过来。
    """
    _auth(x_internal_key)
    from services.block_proposer import propose_blocks

    comps = payload.get("baseComponents")
    if not isinstance(comps, list) or not comps:
        raise HTTPException(400, "baseComponents 不能为空")
    return await asyncio.to_thread(propose_blocks, comps)


@router.get("/components/presets")
async def list_component_presets(
    industry: Optional[str] = None,
    x_internal_key: Optional[str] = Header(None),
):
    """模板库：AI 组装攒出来的页面，按行业分。

    不要求登录——这是素材库，不是谁的应用。归属只在 generated_app 那边有意义。
    """
    _auth(x_internal_key)
    from services.component_preset_store import get_preset_store

    store = await asyncio.to_thread(get_preset_store)
    presets = await asyncio.to_thread(store.list, industry=industry)
    industries = await asyncio.to_thread(store.industries)
    return {"presets": presets, "industries": industries}


@router.post("/components/presets")
async def save_component_preset(
    payload: Dict[str, Any],
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """把一次 AI 组装的结果存成模板。

    用户描述的闭环（2026-08-08）：「AI 组装出来的预设，现在就是一个模板了。」
    所以模板是**攒出来的**，不是手写的——组件从十几个长到三五百个的过程中，
    同一个按钮抽出来的东西越来越丰富，模板库跟着长。

    这里**不重新校验积木**：payload 里的 blocks 就是 assemble 刚吐出来、已经
    逐条过完契约的那一份。再验一遍不是更安全，是给了调用方一个"绕过组装直接
    塞任意 blocks"的入口——真要那样，验的也该是同一个 _validate，而不是另写
    一套判据。所以这里只做形状检查，内容信任来源。

    2026-08-14 审计补：要登录——删模板那条早就要（"读公开，写删不是"），
    存这条漏了，匿名可以往公共模板库里无限塞条目。
    """
    _auth(x_internal_key)
    _require_login(viewer)
    from services.component_preset_store import get_preset_store

    blocks = payload.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise HTTPException(400, "blocks 不能为空")
    name = str(payload.get("name") or "").strip() or "组装模板"
    industry = str(payload.get("industry") or "").strip() or "通用"
    page_kind = str(payload.get("pageKind") or "workbench").strip()

    store = await asyncio.to_thread(get_preset_store)
    saved = await asyncio.to_thread(
        store.save, name=name, industry=industry, page_kind=page_kind, blocks=blocks
    )
    return {"ok": True, "preset": saved}


@router.delete("/components/presets/{preset_id}")
async def delete_component_preset(
    preset_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """删模板。攒出来的东西必然有不好的，得能清掉，否则库会越攒越脏。

    要登录：读是公开的（素材给所有人看），写和删不是。
    """
    _auth(x_internal_key)
    _require_login(viewer)
    from services.component_preset_store import get_preset_store

    store = await asyncio.to_thread(get_preset_store)
    await asyncio.to_thread(store.delete, preset_id)
    return {"ok": True}


@router.post("/apps/{app_id}/fork")
async def fork_generated_app(
    app_id: str,
    request: Request,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """以某个生成应用为起点分出一条新血缘（新 root·v1·parent 指向源）。
    可选 body {name}：给副本改名（避免同名孪生卡，对标 Budibase duplicateApp）。

    权限（2026-08-02）：**能看就能 Fork**（Gitea 同款），但必须登录——Fork 产出
    的是一条归属于你的新记录，匿名没有可绑定的主体。

    ⚠️ 副本的可见性对标 Gitea 从模板生成（默认私有），不是继承源。
    从市场复刻一张公开卡不会立刻再上架一份；要上市场在「我的应用」里点公开。
    私有源仍然不得因为复刻变公开（fork_visibility 恒为 private，这条自然成立）。
    """
    _auth(x_internal_key)
    from services import app_store

    source = await asyncio.to_thread(app_store.get_app, app_id)
    if source is None:
        raise HTTPException(404, "source app not found")
    app_access.require("fork", source, viewer)
    if viewer is None:
        # require 已经用 401 挡住匿名（fork 需要 READ，但没有主体可绑定），
        # 这里是防御性的第二道——上面的判定将来若被改动，这条仍然守住。
        raise HTTPException(401, "请先登录后再复刻")

    new_name: Optional[str] = None
    try:
        body = await request.json()
        if isinstance(body, dict) and isinstance(body.get("name"), str) and body["name"].strip():
            new_name = body["name"].strip()
    except Exception:
        pass  # 无 body / 非 JSON → 不改名

    # 2026-07-27 修复（workbench 审查 #1）：fork 出的卡此前是死卡——副本
    # 有意不继承源会话（防"点开副本进了源会话"），但也没有补上"为副本建
    # 新会话"这一步，前端 canOpen 恒 false，点了没反应。现在 fork 时同步
    # 创建一个绑定会话：模型直供重建闭环（restore 同款路径，零 LLM——
    # enrich 层幂等，已有主题/设计原样保留），副本点开即是可运行应用，
    # 且能在自己的会话里继续迭代。
    import uuid as _uuid

    fork_sid = f"sliderule-fork-{_uuid.uuid4().hex[:10]}"
    new_id = app_store.fork_app(
        app_id,
        new_name=new_name,
        session_id=fork_sid,
        owner_id=viewer.id,
        visibility=app_access.fork_visibility(source),
    )
    if new_id is None:
        raise HTTPException(404, "source app not found")

    def _init_fork_session() -> None:
        """给副本建绑定会话。整段跑在线程池里，且不打外网。

        实现抽到 ``app_working_session``：reopen（同一张卡重建工作区）走同一条，
        只改 fork 等于点「继续改」仍是空工作台。
        """
        nonlocal session_error
        from services.app_working_session import init_working_session_from_app

        record = app_store.get_app(new_id) or {}
        session_error = init_working_session_from_app(
            record,
            session_id=fork_sid,
            owner_id=viewer.id,
            note=f"复刻自 {app_id}",
        )

    session_error: Optional[str] = None
    await asyncio.to_thread(_init_fork_session)

    return {"id": new_id, "sessionId": fork_sid, "sessionError": session_error}


@router.post("/apps/{app_id}/reopen")
async def reopen_generated_app(
    app_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """同一张卡上重建工作区。对照 GitHub「create a codespace for this repo」。

    不是 fork：不新开应用、不改血缘。会话还在就复用；没了才从 ``model_json`` /
    ``pages_json`` 灌一条新会话并 ``bind_session``。
    """
    _auth(x_internal_key)
    from services import app_store
    from services.app_working_session import init_working_session_from_app
    import uuid as _uuid

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    app_access.require("reopen", record, viewer)
    if viewer is None:
        raise HTTPException(401, "请先登录后再继续改")

    existing_sid = str(record.get("session_id") or "").strip()
    if existing_sid:
        live = load_session(existing_sid) or _sessions.get(existing_sid)
        if live is not None:
            return {"id": app_id, "sessionId": existing_sid, "reused": True}

    work_sid = f"sliderule-work-{_uuid.uuid4().hex[:10]}"
    session_error: Optional[str] = None

    def _go() -> None:
        nonlocal session_error
        session_error = init_working_session_from_app(
            record,
            session_id=work_sid,
            owner_id=viewer.id,
            note=f"从快照重建工作区 {app_id}",
        )
        app_store.bind_session(app_id, work_sid)

    await asyncio.to_thread(_go)
    return {
        "id": app_id,
        "sessionId": work_sid,
        "sessionError": session_error,
        "reused": False,
    }


@router.delete("/apps/{app_id}")
async def delete_generated_app(
    app_id: str,
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """从画廊移除一个生成应用记录。

    对照 GitHub 删仓库：挂在这张卡上的工作区会话一并删（删得了才删）。
    会话删失败不回滚应用——货架已经下架，孤儿会话用户还能在侧栏自己清。
    """
    _auth(x_internal_key)
    from services import app_store

    record = await asyncio.to_thread(app_store.get_app, app_id)
    if record is None:
        raise HTTPException(404, "app not found")
    app_access.require("delete", record, viewer)
    bound_sid = str(record.get("session_id") or "").strip()
    if not await asyncio.to_thread(app_store.delete_app, app_id):
        raise HTTPException(404, "app not found")
    session_deleted = False
    if bound_sid:
        try:
            existing = load_session(bound_sid) or _sessions.get(bound_sid)
            if existing is not None:
                _require_session(existing, "delete", viewer)
                delete_session(bound_sid)
                _sessions.pop(bound_sid, None)
                session_deleted = True
        except HTTPException:
            session_deleted = False
        except Exception as exc:  # noqa: BLE001
            print(f"[sliderule_full] drop workspace after delete_app failed: {exc}")
    return {"ok": True, "sessionDeleted": session_deleted}


@router.get("/apps-export")
async def export_generated_apps(
    viewer: CurrentUserOptional,
    x_internal_key: Optional[str] = Header(None),
):
    """导出全部应用记录（备份/迁移）——无论后端在哪，手上永远有一份可迁移真数据。

    2026-08-14 审计补：全量导出含**所有人**的私有应用（完整 model_json），
    是管理员的备份工具，不是公共接口。此前匿名一个 GET 就能拖走全库。
    """
    _auth(x_internal_key)
    _require_superuser(viewer)
    from services import app_store

    return {"apps": app_store.export_all()}


# ---------------------------------------------------------------------------
# 入站判定闸门（2026-07-27）
# ---------------------------------------------------------------------------


@router.post("/intake-judge")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def intake_judge_turn(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """判这一轮输入是真需求 / 真迭代，还是闲聊、产品咨询、太模糊。

    第一版只提示不阻断：返回的 action 恒为 proceed|hint，前端据此在输入框
    上方给一句引导，用户永远能"仍然推演"。判定本身 fail-open——出任何问题
    都返回 proceed，闸门坏了不能变成产品坏了。
    """
    _auth(x_internal_key)
    from services.intake_judge import judge_turn

    return {
        "judgement": judge_turn(
            str(payload.get("text") or ""),
            has_app=bool(payload.get("hasApp")),
            app_summary=str(payload.get("appSummary") or ""),
        ).to_dict(),
        "backend": PYTHON_BACKEND,
    }
