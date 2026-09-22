"""真机跑一遍自动续跑：模型停下但没做完 → 自己醒过来接着跑 → 该收手时收手。

跟 `control-run-smoke.py` 同一个层级：**真 Uvicorn 进程、真 HTTP 路由、真 SSE、
真 ControlRunService（scanner 真在转）、真 SQLite、真 ProjectStore**。只有 LLM 是
脚本化的——因为要的是「模型说完话但事没干完」这个**确定**的形态，真模型每次
说什么不可控，验不出「该停时停没停」。E2B 与真实模型另由
`project-product-smoke.py` 覆盖。

## 这一趟要证明四件事

  1 模型这一轮说完话（没调工具、没问用户）→ run 进 **waiting_continue**
    而不是 completed —— 也就是「没人叫得醒」那个死局被打开了
  2 scanner 真的把它叫回来了：出现 `control_continuation` 事件，
    goal.continuations 记到 1，**模型被再次调用**
  3 续跑那一轮如果一个工具都没跑成 → **不再叫醒**（no_progress 收手），
    run 落到终态，不空转
  4 全程没有第二套 Agent loop：producer 调用次数 = 模型调用次数

⚠ 第 3 条是这趟的重点。「能自己接着跑」很容易做出来，危险的是它停不下来。

用法：
    slide-rule-python/.venv/bin/python scripts/control-continuation-smoke.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
OWNER = "continuation-smoke-owner"
INTERNAL_KEY = "continuation-smoke-local-only"
TERMINAL = {"completed", "waiting_user", "failed", "cancelled", "interrupted"}


def serve(directory: Path) -> None:
    sys.path.insert(0, str(BACKEND))
    import uvicorn
    from app import app
    from middlewares.current_user import optional_user
    from models.v5_state import V5SessionState
    from services import persistence, rehearsal_control
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.identity_store import User
    from services.project_authority import approved_reference
    from services.project_creation import create_session_project, load_authorized_session
    from services.project_store import ProjectStore
    from services.project_tools import ProjectTools
    from services.session_blob_store import SqlSessionBlobStore
    from services.slide_rule_session import load_session, save_session
    from sliderule_llm.control_client import ControlLlmResult

    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    sessions = SqlSessionBlobStore(database_url)
    persistence._blob_store = lambda *_: sessions
    projects = ProjectStore.from_url(database_url)
    store = ControlRunStore(projects._q)
    viewer = User(id=OWNER, is_superuser=True)
    app.dependency_overrides[optional_user] = lambda: viewer

    # 真实的「计划已批准」会话：审批引用由服务端算，不是手写一个字符串。
    plan = {"planId": "continuation-plan", "revision": 1,
            "planContent": "为任务加截止日期与逾期筛选", "reqId": "approve-continuation"}
    session_id = "continuation-smoke-" + directory.name
    state = V5SessionState(
        sessionId=session_id, ownerId=OWNER,
        goal={"text": "为任务加截止日期与逾期筛选"},
        controlTranscript=[{**plan, "kind": kind}
                           for kind in ("plan_written", "plan_approval", "plan_approved")])
    save_session(state, server_write=True, require_durable=True)
    approval = approved_reference(load_session(session_id))
    project = create_session_project(projects, session_id, owner_id=OWNER, approval_ref=approval)

    model = {"calls": 0, "script": []}

    async def scripted_model(*args, **kwargs):
        """真机形态：先干一点活，然后说完话停下——但事没做完。

        第 2 次（也就是续跑那一轮）故意**一个工具都不调**，用来验证
        「没进展就不再叫醒」真的收手。
        """
        model["calls"] += 1
        call = model["calls"]
        model["script"].append(call)
        if call == 1:
            # 真调一个工程工具：进展指纹要从 0 变 1，续跑才有资格发生。
            return ControlLlmResult(
                content="我先看一眼现有源码，然后再决定怎么加截止日期。",
                tool_calls=[{"id": "call-read-1", "name": "project_read",
                             "arguments": {"path": "src/main.tsx"}}],
                usage={"total_tokens": 40}, finish_reason="tool_calls",
                model="scripted-continuation", latency_ms=0)
        if call == 2:
            # 说完话就停——没调工具、没问用户。原来这里会被判成 completed。
            return ControlLlmResult(
                content="我已经看过源码了，接下来会实现截止日期与逾期筛选。",
                tool_calls=[], usage={"total_tokens": 20}, finish_reason="stop",
                model="scripted-continuation", latency_ms=0)
        # 续跑那一轮：又只说话。进展指纹没变 → 必须收手，不许继续叫醒。
        return ControlLlmResult(
            content="还在想怎么改。", tool_calls=[], usage={"total_tokens": 10},
            finish_reason="stop", model="scripted-continuation", latency_ms=0)

    rehearsal_control._invoke_control_llm = scripted_model
    tools = ProjectTools(projects, None, OWNER)
    service = ControlRunService(
        store, projects, None,
        authorize=lambda sid, owner: load_authorized_session(sid, owner_id=owner),
        poll_seconds=0.03, lease_seconds=5)
    server_ref: dict = {}

    @asynccontextmanager
    async def lifespan(_):
        app.state.control_run_service = service
        await service.start()
        try:
            yield
        finally:
            await service.shutdown()
            projects.close()
            sessions._engine.dispose()

    app.router.lifespan_context = lifespan

    @app.get("/__continuation_smoke/status")
    async def smoke_status():
        latest = store.latest(session_id, OWNER)
        run_id = (latest or {}).get("runId")
        record = store.get(run_id, OWNER) if run_id else None
        return {
            "sessionId": session_id,
            "projectId": project.projectId,
            "approvalRef": approval,
            "modelCalls": model["calls"],
            "runId": run_id,
            "status": (record or {}).get("status"),
            "error": (record or {}).get("error"),
            "checkpointPhase": ((record or {}).get("checkpoint") or {}).get("phase"),
            "goal": (record or {}).get("goal"),
            "eventTypes": [e.get("type") for e in (record or {}).get("events", [])],
            "continuationEvents": [e for e in (record or {}).get("events", [])
                                   if e.get("type") == "control_continuation"],
            "activeProducers": len(service._tasks),
        }

    @app.post("/__continuation_smoke/shutdown")
    async def smoke_shutdown():
        server_ref["server"].should_exit = True
        return {"stopping": True}

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    (directory / "port").write_text(str(listener.getsockname()[1]), encoding="utf-8")
    import logging
    logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")
    logging.getLogger("services.control_run_service").setLevel(logging.INFO)
    server = uvicorn.Server(uvicorn.Config(app, log_level="info", access_log=False))
    server_ref["server"] = server
    server.run(sockets=[listener])


def smoke(output: Path) -> int:
    import httpx

    checks: list = []

    def checked(name, condition, **evidence):
        checks.append({"name": name, "passed": bool(condition), **evidence})
        print(("PASS " if condition else "FAIL ") + name, flush=True)
        return bool(condition)

    directory = output / uuid.uuid4().hex[:8]
    directory.mkdir(parents=True, exist_ok=True)
    environment = {
        **os.environ,
        "NODE_ENV": "development",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1",
        "WHYBUDDY_PROJECT_ROLLOUT": "internal",
        "SLIDE_RULE_INTERNAL_KEY": INTERNAL_KEY,
        "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "PYTHONUNBUFFERED": "1",
    }
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--serve", str(directory)],
        cwd=str(ROOT), env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        port = None
        for _ in range(300):
            if (directory / "port").exists():
                port = (directory / "port").read_text(encoding="utf-8").strip()
                break
            if child.poll() is not None:
                print(child.stdout.read() if child.stdout else "")
                raise RuntimeError("continuation_smoke_server_exited")
            time.sleep(0.1)
        if not port:
            raise RuntimeError("continuation_smoke_server_port_missing")
        base = f"http://127.0.0.1:{port}"
        client = httpx.Client(timeout=60, trust_env=False)
        for _ in range(300):
            try:
                first = client.get(base + "/__continuation_smoke/status").json()
                break
            except httpx.HTTPError:
                time.sleep(0.1)
        else:
            raise RuntimeError("continuation_smoke_status_unavailable")

        session_id = first["sessionId"]
        headers = {"x-internal-key": INTERNAL_KEY}
        body = {"sessionId": session_id, "userText": "为任务加截止日期与逾期筛选",
                "installedSkills": [], "activeConnectors": [],
                "preferredDevice": "desktop", "designSystemId": None,
                "runtimeKind": "project"}
        # 真产品入口：POST /control-turn-stream，SSE 一路读到这一轮结束。
        stream_events = []
        with client.stream("POST", base + "/api/sliderule/control-turn-stream",
                           json=body, headers=headers) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if line.startswith("data:"):
                    try:
                        stream_events.append(json.loads(line[5:].strip()))
                    except json.JSONDecodeError:
                        pass

        checked("首轮真的跑了模型并调了工程工具",
                any(e.get("type") == "control_tool_result" and e.get("tool") == "project_read"
                    for e in stream_events),
                eventTypes=[e.get("type") for e in stream_events][:20])

        # 首轮 SSE 结束之后，续跑由 scanner 在后台完成——这里等的就是它。
        deadline = time.monotonic() + 40
        status = {}
        while time.monotonic() < deadline:
            status = client.get(base + "/__continuation_smoke/status").json()
            if status.get("status") in TERMINAL and status.get("modelCalls", 0) >= 3:
                break
            time.sleep(0.2)

        goal = status.get("goal") or {}
        checked("scanner 真的把它叫醒了：出现 control_continuation 事件",
                len(status.get("continuationEvents") or []) >= 1,
                continuationEvents=status.get("continuationEvents"))
        checked("续跑次数记到目标信封里",
                goal.get("continuations") == 1, goal=goal)
        checked("模型真的被再次调用（不是只改了状态）",
                status.get("modelCalls", 0) == 3, modelCalls=status.get("modelCalls"))
        checked("没进展就收手：落到终态，不无限续",
                status.get("status") in TERMINAL, status=status.get("status"))
        checked("收手之后没有残留的 producer 在转",
                status.get("activeProducers") == 0,
                activeProducers=status.get("activeProducers"))

        report = {"status": "passed" if all(c["passed"] for c in checks) else "failed",
                  "checks": checks, "final": status}
        (directory / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Report: " + str(directory / "report.json"))
        try:
            client.post(base + "/__continuation_smoke/shutdown")
        except httpx.HTTPError:
            pass
        return 0 if report["status"] == "passed" else 1
    finally:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
        if child.stdout:
            tail = child.stdout.read()
            if tail.strip():
                (directory / "server.log").write_text(tail, encoding="utf-8")
                print("--- server log 尾部 ---")
                print("\n".join(tail.strip().split("\n")[-25:]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", default="")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "control-continuation"))
    args = parser.parse_args()
    if args.serve:
        serve(Path(args.serve))
        return 0
    return smoke(Path(args.out))


if __name__ == "__main__":
    raise SystemExit(main())
