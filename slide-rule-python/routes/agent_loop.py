"""
AgentLoop API router for SlideRule Python control plane bootstrap (task 108).

Mounts /api/agent-loop/* for health and capabilities metadata.
This is bridge mode: Python owns the public surface, worker execution remains bridged (no live Node dep for this bootstrap).
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse, Response

from pydantic import BaseModel
from typing import Any, Dict, Optional
from pathlib import Path

from services.agent_loop_runs import get_agent_loop_run_detail, list_agent_loop_run_summaries
from services.agent_loop_runs import get_agent_loop_queue_overview
from services.agent_loop_paths import resolve_artifact_path
from services.agent_loop_events import (
    build_event_snapshot,
    format_sse_frame,
    iter_agent_loop_sse_frames,
    iter_agent_loop_live_v2_sse_frames,
    iter_agent_loop_v2_sse_frames,
)
from services.agent_loop_event_store import read_events
from services.agent_loop_state_reducer import reduce_run_events
from services.agent_loop_legacy_adapter import read_legacy_events
from services.agent_loop_bridge import (
    build_agent_loop_command,
    execute_agent_loop_command,
    start_agent_loop_background_command,
)
from services.agent_loop_settings import (
    load_agent_loop_settings,
    save_agent_loop_settings,
    get_secret_status,
    sanitize_for_save,
    validate_enums,
)
from services.agent_loop_provider_health import get_provider_health

from middlewares.current_user import CurrentUser

# ── 谁能调这些接口（2026-08-04 补）────────────────────────────────
#
# 这个路由此前**两种守卫都没有**：既不要登录，也不要内部密钥。而它是浏览器
# 直连的（前端 pages/agent-loop/dashboard/agentLoopApi.ts 经 Vite 代理打过来），
# 所以补的是**用户身份**而不是内部密钥——内部密钥是给机器对机器的通道用的，
# 浏览器拿不到也不该拿到。
#
# 只给**写**接口加（跑任务、重跑、取消、改设置）：这几个要么烧钱（真起 LLM
# 任务）、要么改别人正在跑的东西、要么动全局设置。读接口（health/runs/事件流/
# 静态面板）保持匿名可读，跟应用中心"浏览无需登录"的产品规则一致。
#
# ⚠️ 这是"要登录"，不是"是你的才让动"——目前 agent-loop 的运行记录没有
# owner 字段，做不了逐条归属判定。补上归属之前，登录用户之间仍然可以互相
# 取消任务。如实写在这里，不假装它是完整的授权。
from models.agent_loop import AgentLoopSettingsStatus, RouteState

router = APIRouter()

# Dashboard static root for python-owned shell (SlideRule AgentLoop 108)
# Resolved relative to package so tests and server both find assets without VS Code.
_DASHBOARD_STATIC = Path(__file__).resolve().parent.parent / "static" / "agent-loop"


class CommandRequest(BaseModel):
    """Validated input for command endpoints (task/queue/mode).
    Non-secret runtime linkage fields (112) are accepted here so they are not dropped by Pydantic.
    - queuePath: mapped to effective queue for run (affects which queue file the bridged runner loads).
    - fixAgent/reviewAgent/workerMax*/worktreeScope/activeProfile: accepted for client contract + display linkage;
      execution behavior for agents/turns/scope is primarily owned by persisted settings + selected queue's "defaults"
      (load_agent_loop_settings + queue json) at the Node runner layer. Declaring prevents silent ignore.
    """
    task: Optional[str] = None
    queue: Optional[str] = None
    mode: str = "queue"
    dryRun: bool = False
    timeoutMs: Optional[int] = None
    cwd: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    # non-secret runtime options (112 linkage)
    fixAgent: Optional[str] = None
    reviewAgent: Optional[str] = None
    workerMaxTurns: Optional[int] = None
    workerMaxRetries: Optional[int] = None
    worktreeScope: Optional[str] = None
    activeProfile: Optional[str] = None
    queuePath: Optional[str] = None


def _validate_task_id(task: Optional[str]) -> Optional[str]:
    if task is None:
        return None
    t = str(task).strip()
    if not t or "\0" in t or ".." in t:
        raise HTTPException(status_code=400, detail="invalid task id")
    # accept task ids that are paths or .md task files
    if len(t) < 3:
        raise HTTPException(status_code=400, detail="invalid task id")
    return t


def _validate_queue_path(queue: Optional[str]) -> Optional[str]:
    if queue is None:
        return None
    q = str(queue).strip()
    if not q or ".." in q or q.startswith(("/", "\\")) or (len(q) > 1 and q[1] == ":"):
        raise HTTPException(status_code=400, detail="invalid queue path")
    # accept common queue paths under scripts or containing queue
    if not (q.endswith(".json") or "queue" in q.lower() or "scripts/" in q or "run-queue" in q):
        raise HTTPException(status_code=400, detail="invalid queue path")
    return q


def _validate_mode(mode: Optional[str]) -> str:
    allowed = {"queue", "single", "rerun", "task", "dry-run"}
    m = (mode or "queue").strip().lower()
    if m not in allowed:
        raise HTTPException(status_code=400, detail=f"invalid mode value: {mode}")
    return m


@router.get("/health")
async def health():
    """Return backend identity, bridge mode, and status. Task 58: includes observability coverage."""
    return {
        "status": "ok",
        "backend": "sliderule-python",
        "mode": "bridge",
        "version": "agentloop.v1.bootstrap",
        "observability": {"health": True, "provenance": True, "degradedStates": True, "errors": True},
        "source": "python",
    }


@router.get("/capabilities")
async def capabilities():
    """Return supported control-plane features and mark worker execution as bridged."""
    return {
        "features": [
            "health",
            "capabilities",
            "runs.control",
            "tasks.control",
            "provider-health",
        ],
        "workerExecution": "bridged",
        "controlPlane": "python",
        "bridge": True,
    }


@router.get("/provider-health")
async def provider_health():
    """Provider and CLI health (SlideRule AgentLoop 108).

    - Classifies grok/openai/anthropic as ready/missing/skipped/failed.
    - CLI grok/codex include commandPath and version when present.
    - Proxy status included (non-fatal).
    - Redacted output; never leaks keys.
    - Cacheable (use ?force or internal force=True to refresh).
    """
    return get_provider_health()


@router.get("/runs/overview")
async def runs_overview():
    """Overview of AgentLoop runs read from repository run store (state files).

    Returns stable AgentLoopRunSummary list, sorted newest first by runId.
    Empty/missing dir -> [] (no error).
    Corrupt records -> degraded items (full list remains intact).
    """
    summaries = list_agent_loop_run_summaries()
    return [s.model_dump(mode="json") for s in summaries]


@router.get("/queue/overview")
async def queue_overview():
    """Queue overview aligned to the VS Code dashboard queue view.

    Reads the same queue definition / outcomes / landing files that the extension uses.
    """
    return get_agent_loop_queue_overview()


@router.get("/runs/{run_id}")
async def run_detail(run_id: str):
    """Single AgentLoop run detail using existing run artifacts (state, events, reports, logs).

    - 404 for unknown/missing runs (no dir or no readable state.json)
    - Text tails bounded (logs max ~20 lines, reports/events similarly limited)
    - Artifact entries use safe relative identifiers only (e.g. "final-report.json", "*.log", "state.json")
      These can be fetched later by control plane without leaking FS abs paths.
    - No full unbounded logs; no env vars or secrets leaked from artifacts.
    """
    detail = get_agent_loop_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="run not found")
    return detail.model_dump(mode="json")


@router.get("/runs/{run_id}/events/stream")
async def run_events_stream(run_id: str):
    """SSE stream endpoint exposing normalized AgentLoop event snapshots as frames.

    Uses finite snapshot framing (via generator helper) so it is testable without
    long-running worker or wall-clock waits.
    """
    detail = get_agent_loop_run_detail(run_id)
    if detail is None:
        d = {}
    else:
        d = detail.model_dump(mode="json") if hasattr(detail, "model_dump") else (detail if isinstance(detail, dict) else {})
    snap = build_event_snapshot(d)

    def _finite_gen():
        # finite: single frame snapshot; stream code accepts generators per acceptance
        yield format_sse_frame("state", snap)

    return StreamingResponse(_finite_gen(), media_type="text/event-stream")


@router.get("/runs/{run_id}/events/stream/v2")
async def run_events_stream_v2(run_id: str, live: Optional[bool] = False):
    """SSE v2 stream: incremental normalized events (replayed) followed by final reducer snapshot frame.

    Default remains finite replay for deterministic API/tests. Use ?live=1 for long-lived tailing.
    """
    if live and isinstance(run_id, str) and run_id and len(run_id) >= 3:
        return StreamingResponse(
            iter_agent_loop_live_v2_sse_frames(run_id),
            media_type="text/event-stream",
        )

    if not isinstance(run_id, str) or not run_id or len(run_id) < 3:
        evs = []
    else:
        evs = read_events(run_id, limit=1000)
        if not evs:
            evs = read_legacy_events(run_id, limit=1000)

    def _finite_gen():
        for frame in iter_agent_loop_v2_sse_frames(evs):
            yield frame

    return StreamingResponse(_finite_gen(), media_type="text/event-stream")


@router.post("/queue/run")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def start_queue_run(req: CommandRequest, _user: CurrentUser):
    """Start a queue run via bridge. Validates task id, queue path, mode.
    Dry-run returns the exact redacted command without executing.
    Runtime non-secrets from payload (112) are now visible to this layer (no longer dropped by CommandRequest).
    queuePath (if no queue) is mapped to queue_path for build -- this makes active queuePath setting affect executed run.
    fixAgent etc are accepted; backend execution layer owns their application via persisted settings + queue.defaults.
    """
    task = _validate_task_id(req.task)
    # map queuePath -> queue so that runtime queuePath from settings influences the queue file chosen for execution
    effective_queue = req.queue or req.queuePath
    queue = _validate_queue_path(effective_queue)
    mode = _validate_mode(req.mode)
    dry = bool(req.dryRun) or mode == "dry-run"
    queue_run = mode not in ("single", "task")

    build_kwargs: Dict[str, Any] = {
        "queue_run": queue_run,
        "task": task,
        "timeout_ms": req.timeoutMs,
        "cwd": req.cwd,
        "env_overrides": req.env,
    }
    if queue:
        build_kwargs["queue_path"] = queue

    cmd_req = build_agent_loop_command(**build_kwargs)
    receipt = execute_agent_loop_command(cmd_req, dry_run=True) if dry else start_agent_loop_background_command(cmd_req)
    # ensure no raw env returned (per do-not)
    data = receipt.model_dump(mode="json") if hasattr(receipt, "model_dump") else dict(receipt)
    if "env" in data:
        data.pop("env", None)
    if isinstance(data.get("metadata"), dict):
        # keep only safe
        pass
    return data


@router.post("/task/run")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def start_task_run(req: CommandRequest, _user: CurrentUser):
    """Single-task run endpoint. Validates inputs. Dry-run supported.
    Accepts runtime non-secret fields (see CommandRequest) for contract; backend owns most resolution.
    """
    task = _validate_task_id(req.task)
    mode = _validate_mode(req.mode or "single")
    dry = bool(req.dryRun) or mode == "dry-run"
    cmd_req = build_agent_loop_command(
        queue_run=False,
        task=task,
        timeout_ms=req.timeoutMs,
        cwd=req.cwd,
        env_overrides=req.env,
    )
    receipt = execute_agent_loop_command(cmd_req, dry_run=True) if dry else start_agent_loop_background_command(cmd_req)
    data = receipt.model_dump(mode="json") if hasattr(receipt, "model_dump") else dict(receipt)
    data.pop("env", None) if "env" in data else None
    return data


@router.post("/rerun")
# ⚠ `def` 而不是 `async def`——**故意的，别改回去**（2026-08-21）。
# 函数体里跑的是同步的慢活（LLM / 子进程），写成 async 就是整段跑在事件
# 循环那条线程上：真机实测两个人各打一次 intake-judge（单次 7.9s），
# 第三个人的 /api/health 等了 10.5s——空载是 0.0013s。
# 同 /drive-full 头注那条（2026-08-02 同款事故），修法用 FastAPI 官方口径：
# 普通 def 会被丢进 anyio 线程池，而不是直接占住循环。
# 判据：tests/test_routes_do_not_block_event_loop.py（跑真 ASGI 应用量行为，
# 不扫源码——扫描器在这件事上误报过两次）。
def rerun_command(req: CommandRequest, _user: CurrentUser):
    """Rerun via bridge (treated as queue start by default)."""
    task = _validate_task_id(req.task)
    mode = _validate_mode(req.mode or "rerun")
    dry = bool(req.dryRun)
    cmd_req = build_agent_loop_command(
        queue_run=True,
        task=task,
        timeout_ms=req.timeoutMs,
        cwd=req.cwd,
        env_overrides=req.env,
    )
    receipt = execute_agent_loop_command(cmd_req, dry_run=True) if dry else start_agent_loop_background_command(cmd_req)
    data = receipt.model_dump(mode="json") if hasattr(receipt, "model_dump") else dict(receipt)
    data.pop("env", None) if "env" in data else None
    return data


@router.post("/cancel")
async def cancel_command(_user: CurrentUser, req: Optional[CommandRequest] = None):
    """Cancel endpoint returns explicit unsupported/queued-cancel placeholder.
    Never pretends success; no PID killing.
    """
    return {
        "status": "queued-cancel",
        "message": "cancel is a queued-cancel placeholder (unsupported by bridge; no process kill)",
        "exitCode": None,
        "timedOut": False,
    }


# --- Settings API (SlideRule AgentLoop 108) ---

@router.get("/settings")
async def get_settings():
    """Return non-secret effective settings + secret configured status only.
    Never echoes raw keys/secrets.
    """
    nonsec = load_agent_loop_settings()
    secrets = get_secret_status()
    # nonsec already excludes secrets (load does); return as-is for effective
    effective = dict(nonsec)
    redacted = [k for k in secrets.keys()] if any(s.get("configured") for s in secrets.values()) else []
    status = AgentLoopSettingsStatus(
        loaded=True,
        source="nonsecret-file+env-status",
        effective=effective,
        redacted=redacted,
    )
    # merge secret status under keys without values
    payload = status.model_dump(mode="json")
    payload["keys"] = {k: ("configured" if v.get("configured") else "") for k, v in secrets.items()}
    return payload


@router.post("/settings")
async def save_settings(payload: Dict[str, Any], _user: CurrentUser):
    """Save non-secret settings.
    - Skips any secret-like keys (do not write raw keys).
    - Rejects unsupported enum values with 400.
    - Normalizes aliases like injectToWorker.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")
    sanitized = sanitize_for_save(payload)
    ok, err = validate_enums(sanitized)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "invalid enum value")
    saved = save_agent_loop_settings(sanitized)
    # return minimal ack + current
    return {"ok": True, "saved": saved}


# --- Dashboard shell (SlideRule AgentLoop 108) ---
# Served from /api/agent-loop/dashboard (stable route under existing router mount).
# Shell + JS are python-owned files; no CDN, no VS Code extension code.
# Fetches /api/agent-loop/runs/overview (documented, returns [] when empty).
# Empty and error states render via plain fetch + DOM (no acquireVsCodeApi etc).


def _get_dashboard_index_path():
    return _DASHBOARD_STATIC / "index.html"


def _get_dashboard_js_path():
    return _DASHBOARD_STATIC / "agent-loop-dashboard.js"


def _serve_agent_loop_shell():
    """Reusable shell server for dashboard and first-class routes (110)."""
    index_path = _get_dashboard_index_path()
    if index_path.exists():
        try:
            return FileResponse(str(index_path), media_type="text/html")
        except Exception:
            html = index_path.read_text(encoding="utf-8")
            return HTMLResponse(content=html)
    # Fallback minimal shell (still no vscode, still fetches overview, never blocks empty)
    fallback = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentLoop</title></head><body><h1>AgentLoop Dashboard</h1><div id="runs"></div><script src="/api/agent-loop/agent-loop-dashboard.js"></script></body></html>"""
    return HTMLResponse(content=fallback)


@router.get("/dashboard", response_class=HTMLResponse)
async def serve_agent_loop_dashboard():
    """Serve the initial python-owned AgentLoop dashboard shell."""
    return _serve_agent_loop_shell()


@router.get("/", response_class=HTMLResponse)
async def serve_agent_loop_root():
    """Serve AgentLoop shell at /api/agent-loop (110 route support)."""
    return _serve_agent_loop_shell()


@router.get("/agent-loop-dashboard.js")
async def serve_agent_loop_dashboard_js():
    """Serve the companion dashboard JS (vanilla, fetches overview endpoint)."""
    js_path = _get_dashboard_js_path()
    if js_path.exists():
        try:
            return FileResponse(str(js_path), media_type="application/javascript")
        except Exception:
            js = js_path.read_text(encoding="utf-8")
            return HTMLResponse(content=js, media_type="application/javascript")
    # minimal inline so dashboard never 404s the script
    minimal = """(function(){var r=document.getElementById('runs');if(r)r.innerHTML='<p>No runs (fallback).</p>';})();"""
    return Response(content=minimal, media_type="application/javascript")


# Optional alias for /runs (documented overview is /runs/overview but support direct for shell)
@router.get("/runs")
async def runs_list_alias():
    """Alias to documented overview for convenience (shell may use either)."""
    summaries = list_agent_loop_run_summaries()
    return [s.model_dump(mode="json") for s in summaries]


# --- Event read API (SlideRule AgentLoop 110) ---
# Replay and derived snapshot. Prefer native v2 events; fall back to legacy adapter for 108/109 runs.
# All responses redacted (store/adapter) and bounded (limit + reducer determinism).
# Do not remove existing 108/109 run detail endpoints.

@router.get("/runs/{run_id}/events")
async def run_replay_events(run_id: str, limit: Optional[int] = 1000):
    """Replay endpoint for run events.

    - Native .agent-loop/events/<runId>.jsonl when present (redacted by store).
    - Legacy runs served through the compatibility adapter (synthetic v2 events).
    - Responses bounded; limit respected (hard max 1000).
    - Unknown run -> [] (graceful for UI replay).
    """
    if not isinstance(run_id, str) or not run_id or len(run_id) < 3:
        return []
    lim = 1000
    if isinstance(limit, int) and limit >= 0:
        lim = min(limit, 1000)
    evs = read_events(run_id, limit=lim)
    if not evs:
        evs = read_legacy_events(run_id, limit=lim)
    return evs


@router.get("/runs/{run_id}/snapshot")
async def run_snapshot(run_id: str):
    """Snapshot endpoint using the reducer over replay events (or legacy adapted).

    Deterministic: same events list yields identical snapshot.
    Includes flowNodes/edges, gate, reviewVerdict, finalized etc from reducer.
    """
    if not isinstance(run_id, str) or not run_id:
        return {"runId": None, "status": "PENDING", "finalized": False, "gate": None, "reviewVerdict": None}
    evs = read_events(run_id, limit=1000)
    if not evs:
        evs = read_legacy_events(run_id, limit=1000)
    snap = reduce_run_events(evs)
    return snap


@router.get("/runs/{run_id}/artifacts/{artifact_name}")
async def run_artifact(run_id: str, artifact_name: str):
    """Safe explicit artifact subroute for truth routing (111).

    - Derives from artifact index truth in run detail (no placeholder collapse).
    - Uses resolve_artifact_path: rejects traversal, abs paths, leaks no FS.
    - Serves only existing files; 404 for missing (clean degrade).
    - Only semantic resources for this task (report/landing/state) are served; other artifacts (logs/patch) are rejected as 404.
    - Size bound: >2MiB refused (413) to satisfy "Do not fetch unbounded artifact contents".
    - Distinct names yield distinct routes (final-report.md vs final-report.json vs landing.json vs state.json).
    """
    if not isinstance(run_id, str) or not run_id or not isinstance(artifact_name, str) or not artifact_name:
        raise HTTPException(status_code=404, detail="artifact not found")
    p = resolve_artifact_path(run_id, artifact_name)
    if p is None or not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    # Restrict to task semantic resources only (report, landing, state); reject logs/diffs etc to avoid unbounded.
    lname = artifact_name.lower()
    is_semantic = (
        "final-report" in lname or
        (lname.endswith((".md", ".json")) and "report" in lname) or
        "landing" in lname or
        lname == "state.json" or (lname.startswith("state") and lname.endswith(".json"))
    )
    if not is_semantic:
        raise HTTPException(status_code=404, detail="artifact not found")
    # Enforce bounded fetch (hard cap); refuse large even for semantic.
    try:
        size = p.stat().st_size
        if size > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="artifact too large")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="artifact not found")
    lower = artifact_name.lower()
    if lower.endswith(".json"):
        media = "application/json"
    elif lower.endswith(".md"):
        media = "text/markdown"
    elif lower.endswith((".log", ".patch", ".txt")):
        media = "text/plain"
    else:
        media = "application/octet-stream"
    return FileResponse(str(p), media_type=media)


# --- Contract Registry (Foundation task 03, state model hardened task 06) ---
# Python API contract registry for migrated /api surfaces.
# Python is now the source of truth; this endpoint provides runtime contract evidence
# (provenance signals, classifications via RouteState model).
# Node remains thin compat only for listed.
# See docs/backend-python-no-node-api-contracts.md for the static registry.
# Route state model (ACTIVE_NODE_BUSINESS / PYTHON_FIRST_COMPAT / PYTHON_ONLY) introduced here.


class ContractSurface(BaseModel):
    """Pydantic model for a single registered contract surface (registry entry).

    Uses RouteState (introduced task 06) to enforce classification values.
    """
    surface: str
    classification: RouteState
    pythonRoute: str
    provenanceSignal: str


@router.get("/contracts")
async def api_contract_registry():
    """Return the live Python-owned contract registry for no-Node /api cutover.

    Includes formal RouteState model (task 06) under supportedStates and surfaces use
    RouteState values. Callers (direct, proxy, smokes) can assert "source":"python"
    and python backend signals. This hardens the contract verification required by the task.
    """
    surfaces = [
        ContractSurface(
            surface="/health",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/health",
            provenanceSignal="backend:slide-rule-python",
        ),
        ContractSurface(
            surface="/api/agent-loop",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/api/agent-loop/*",
            provenanceSignal="controlPlane:python",
        ),
        ContractSurface(
            surface="/api/sliderule",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/api/sliderule/*",
            provenanceSignal="source:python-rag",
        ),
        ContractSurface(
            surface="/api/blueprint/spec-documents",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/api/blueprint/spec-documents",
            provenanceSignal="python",
        ),
        ContractSurface(
            surface="/api/observability",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/api/observability",
            provenanceSignal="backend:slide-rule-python",
        ),
        ContractSurface(
            surface="/health (with error observability)",
            classification=RouteState.PYTHON_FIRST_COMPAT,
            pythonRoute="/health,/api/health,/ready",
            provenanceSignal="backend:slide-rule-python",
        ),
    ]
    return {
        "registryVersion": "backend-python-no-node.v1",
        "source": "python",
        "backend": "slide-rule-python",
        "routeStateModel": "foundation-deprecation-state-model",
        "introducedByTask": 6,
        "supportedStates": [s.value for s in RouteState],
        "surfaces": [s.model_dump(mode="json") for s in surfaces],
        "denominatorBaseline": 66,
        "pythonOwnedOrCompatCount": 4,
        "observabilityHardenedByTask": 58,
    }
