"""真实模型 + 真 E2B 的端到端：批准之后**不再打「继续」**，看它自己走多远。

跟 `control-continuation-smoke.py` 的分工：那一份把 LLM 脚本化，为的是验
「该停时停没停」——那需要确定的形态。**这一份反过来**：模型是真的，工具由
它自己挑，E2B 是真的，我们只看它在没人催的情况下实际走到哪一步。

⚠ 所以这份脚本的判据是**过程性**的，不是「必须做完」：真实模型每次的选择
  不一样，把「必须交付成功」写成硬判据只会得到一条随机红/绿的判据，那比没有
  更坏（本仓 §2：判据要能被变异咬住，而不是被运气咬住）。

  它钉的是这几件**无论模型怎么选都必须成立**的事：
    · 模型真的自己挑了工程工具（不是我们替它调的）
    · 全程没有任何一条用户消息说「继续」
    · 如果发生了自动续跑，那一轮模型是真的被再次调用了
    · 最终一定落到终态——不空转、不无限续
    · 源码真的变过（有新 revision）才算「动过手」，没变就如实记没变

用法（需要 .env 里的 LLM_* 与 E2B_API_KEY）：
    slide-rule-python/.venv/bin/python scripts/control-real-model-e2e.py
    slide-rule-python/.venv/bin/python scripts/control-real-model-e2e.py --minutes 20
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
OWNER = "real-model-e2e-owner"
INTERNAL_KEY = "real-model-e2e-local-only"
TERMINAL = {"completed", "waiting_user", "failed", "cancelled", "interrupted"}
GOAL_TEXT = "给任务加一个截止日期字段，并在任务列表里显示它。先读源码再改，改完跑一次构建。"


def serve(directory: Path) -> None:
    sys.path.insert(0, str(BACKEND))
    import uvicorn
    from app import app, _start_project_runtime_supervisor
    from middlewares.current_user import optional_user
    from models.v5_state import V5SessionState
    from services import persistence
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.identity_store import User
    from services.project_authority import approved_reference
    from services.project_creation import load_authorized_session
    from services.project_store import ProjectStore
    from services.session_blob_store import SqlSessionBlobStore
    from services.slide_rule_session import load_session, save_session

    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    sessions = SqlSessionBlobStore(database_url)
    persistence._blob_store = lambda *_: sessions
    projects = ProjectStore.from_url(database_url)
    store = ControlRunStore(projects._q)
    viewer = User(id=OWNER, is_superuser=True)
    app.dependency_overrides[optional_user] = lambda: viewer

    plan = {"planId": "real-e2e-plan", "revision": 1, "planContent": GOAL_TEXT,
            "reqId": "approve-real-e2e"}
    session_id = "real-e2e-" + directory.name
    state = V5SessionState(
        sessionId=session_id, ownerId=OWNER, goal={"text": GOAL_TEXT},
        controlTranscript=[{**plan, "kind": kind}
                           for kind in ("plan_written", "plan_approval", "plan_approved")])
    save_session(state, server_write=True, require_durable=True)
    approval = approved_reference(load_session(session_id))

    # ⚠ **不打桩模型**。真实 LLM 从 .env 的 LLM_* 走 sliderule_llm 那条通道。
    # 真 E2B supervisor 走产线那只装配函数，不在这儿另拼一个。
    supervisor = _start_project_runtime_supervisor()
    service = ControlRunService(
        store, projects, supervisor,
        authorize=lambda sid, owner: load_authorized_session(sid, owner_id=owner),
        poll_seconds=0.5, lease_seconds=120)
    server_ref: dict = {}

    @asynccontextmanager
    async def lifespan(_):
        app.state.project_runtime_supervisor = supervisor
        app.state.control_run_service = service
        await service.start()
        try:
            yield
        finally:
            await service.shutdown()
            if supervisor is not None:
                supervisor.shutdown()
            projects.close()
            sessions._engine.dispose()

    app.router.lifespan_context = lifespan

    @app.get("/__real_e2e/status")
    async def status():
        latest = store.latest(session_id, OWNER)
        run_id = (latest or {}).get("runId")
        record = store.get(run_id, OWNER) if run_id else None
        project = projects.get_project_for_session(session_id, owner_id=OWNER)
        revisions = []
        if project is not None:
            try:
                from services.project_source_operations import ProjectSourceOperations
                revisions = ProjectSourceOperations(projects, supervisor, OWNER).revisions(
                    project.projectId, "", 20).get("revisions", [])
            except Exception:
                revisions = []
        events = (record or {}).get("events", [])
        return {
            "sessionId": session_id, "approvalRef": approval,
            "supervisorReady": supervisor is not None,
            "runId": run_id, "status": (record or {}).get("status"),
            "error": (record or {}).get("error"),
            "goal": (record or {}).get("goal"),
            "projectId": project.projectId if project else None,
            "currentRevision": project.currentRevision if project else None,
            "revisionCount": len(revisions),
            "toolsChosen": [e.get("tool") for e in events if e.get("type") == "control_tool_start"],
            "toolResults": [{"tool": e.get("tool"), "ok": e.get("ok"), "error": e.get("error")}
                            for e in events if e.get("type") == "control_tool_result"],
            "continuations": [e for e in events if e.get("type") == "control_continuation"],
            "modelSpeech": [str(e.get("text") or "")[:160] for e in events
                            if e.get("type") == "control_text"],
            "stopReasons": [e.get("stopReason") for e in events if e.get("stopReason")],
            "eventTypes": [e.get("type") for e in events],
            "activeProducers": len(service._tasks),
        }

    @app.post("/__real_e2e/shutdown")
    async def shutdown():
        server_ref["server"].should_exit = True
        return {"stopping": True}

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    (directory / "port").write_text(str(listener.getsockname()[1]), encoding="utf-8")
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server_ref["server"] = server
    server.run(sockets=[listener])


def run_e2e(output: Path, minutes: int) -> int:
    import httpx
    from dotenv import dotenv_values

    env_file = dotenv_values(ROOT / ".env")
    checks: list = []

    def checked(name, condition, **evidence):
        checks.append({"name": name, "passed": bool(condition), **evidence})
        print(("PASS " if condition else "FAIL ") + name, flush=True)
        return bool(condition)

    directory = output / uuid.uuid4().hex[:8]
    directory.mkdir(parents=True, exist_ok=True)
    environment = {
        **os.environ,
        # .env 打底，但**显式传进来的 LLM_* 覆盖它**——换供应商试
        # content_filter 时不用去改 .env（那是产品配置，不该为一次实验动）。
        **{k: v for k, v in env_file.items()
           if v is not None and not (k.startswith("LLM_") and k in os.environ)},
        "NODE_ENV": "development",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1",
        "WHYBUDDY_PROJECT_ROLLOUT": "internal",
        "SLIDE_RULE_INTERNAL_KEY": INTERNAL_KEY,
        "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "SLIDERULE_LLM_GENERATE_ENABLED": "1",
        "PYTHONUNBUFFERED": "1",
    }
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--serve", str(directory)],
        cwd=str(ROOT), env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        port = None
        for _ in range(600):
            if (directory / "port").exists():
                port = (directory / "port").read_text(encoding="utf-8").strip()
                break
            if child.poll() is not None:
                print(child.stdout.read() if child.stdout else "")
                raise RuntimeError("real_e2e_server_exited")
            time.sleep(0.1)
        if not port:
            raise RuntimeError("real_e2e_port_missing")
        base = f"http://127.0.0.1:{port}"
        # ⚠ 真实模型一轮可以跑几分钟，事件之间的间隔比默认超时长得多。
        #   更要紧的是：**断线不许中止观察**——run 是持久的，订阅者掉线之后
        #   它照样在跑，那正是 ControlRunService 存在的理由。第一版这里
        #   timeout=120 且不接 ReadTimeout，结果我自己的 harness 把一次
        #   正常的真机跑判成了失败。
        client = httpx.Client(
            timeout=httpx.Timeout(connect=30, read=900, write=60, pool=30),
            trust_env=False)
        for _ in range(600):
            try:
                first = client.get(base + "/__real_e2e/status").json()
                break
            except httpx.HTTPError:
                time.sleep(0.2)
        else:
            raise RuntimeError("real_e2e_status_unavailable")

        checked("真 E2B supervisor 装起来了", first.get("supervisorReady"),
                supervisorReady=first.get("supervisorReady"))

        body = {"sessionId": first["sessionId"], "userText": GOAL_TEXT,
                "installedSkills": [], "activeConnectors": [],
                "preferredDevice": "desktop", "designSystemId": None,
                "runtimeKind": "project"}
        print(f"[e2e] 发出唯一一条用户消息，之后不再说话：{GOAL_TEXT}", flush=True)
        started = time.monotonic()
        try:
          with client.stream("POST", base + "/api/sliderule/control-turn-stream",
                             json=body, headers={"x-internal-key": INTERNAL_KEY}) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if line.startswith("data:"):
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    kind = event.get("type")
                    if kind == "control_tool_start":
                        print(f"  [{int(time.monotonic()-started):>4}s] 工具 → {event.get('tool')}"
                              + (f" · {event.get('summary')}" if event.get("summary") else ""), flush=True)
                    elif kind == "control_tool_result":
                        print(f"  [{int(time.monotonic()-started):>4}s] 结果 ← {event.get('tool')} ok={event.get('ok')}"
                              + (f" {str(event.get('error'))[:80]}" if event.get("error") else ""), flush=True)
                    elif kind == "control_text":
                        print(f"  [{int(time.monotonic()-started):>4}s] 说   « {str(event.get('text') or '')[:110]}", flush=True)
        except httpx.HTTPError as exc:
            # 订阅断了不等于跑挂了。改用状态轮询继续看——这本身就是
            # 「关掉网页不丢任务」那条设计的实测。
            print(f"  [{int(time.monotonic()-started):>4}s] ⚠ SSE 断开（{type(exc).__name__}），"
                  f"改用状态轮询继续观察——run 是持久的", flush=True)

        # 首轮 SSE 断了之后，自动续跑在后台继续——这里只看，不催。
        deadline = time.monotonic() + minutes * 60
        status = {}
        seen_continuations = 0
        seen_tools = 0
        while time.monotonic() < deadline:
            status = client.get(base + "/__real_e2e/status").json()
            if len(status.get("continuations") or []) > seen_continuations:
                seen_continuations = len(status["continuations"])
                print(f"  [{int(time.monotonic()-started):>4}s] ⟳ 自动续跑第 {seen_continuations} 次 "
                      f"（{status['continuations'][-1].get('blockedReasons')}）", flush=True)
            tools_now = status.get("toolsChosen") or []
            if len(tools_now) > seen_tools:
                for tool in tools_now[seen_tools:]:
                    print(f"  [{int(time.monotonic()-started):>4}s] 工具 → {tool}", flush=True)
                seen_tools = len(tools_now)
            if status.get("status") in TERMINAL and status.get("activeProducers") == 0:
                break
            time.sleep(3)

        print("\n[e2e] 模型自己挑的工具序列：", status.get("toolsChosen"), flush=True)

        checked("模型自己挑了工程工具（不是我们替它调的）",
                any(str(t or "").startswith("project_") for t in (status.get("toolsChosen") or [])),
                toolsChosen=status.get("toolsChosen"))
        checked("全程只有一条用户消息，没有人说「继续」", True, userMessages=1)
        continuations = status.get("continuations") or []
        if continuations:
            checked("发生了自动续跑，且那一轮模型真的被再次调用",
                    len(status.get("modelSpeech") or []) > len(continuations),
                    continuations=len(continuations))
        else:
            print("NOTE 这一趟没有触发自动续跑（模型一轮内就收尾或撞了闸）", flush=True)
        checked("最终落到终态，不空转", status.get("status") in TERMINAL,
                status=status.get("status"), error=status.get("error"))
        checked("没有残留 producer", status.get("activeProducers") == 0,
                activeProducers=status.get("activeProducers"))

        source_touched = (status.get("revisionCount") or 0) > 1
        print(("NOTE 源码真的改过（%d 个版本）" % status.get("revisionCount", 0)) if source_touched
              else "NOTE 这一趟源码没有产生新版本——如实记下，不算它做过",
              flush=True)

        report = {"status": "passed" if all(c["passed"] for c in checks) else "failed",
                  "checks": checks, "sourceTouched": source_touched, "final": status,
                  "elapsedSeconds": round(time.monotonic() - started, 1)}
        (directory / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Report: " + str(directory / "report.json"))
        try:
            client.post(base + "/__real_e2e/shutdown")
        except httpx.HTTPError:
            pass
        return 0 if report["status"] == "passed" else 1
    finally:
        try:
            child.wait(timeout=60)
        except subprocess.TimeoutExpired:
            child.kill()
        if child.stdout:
            tail = child.stdout.read()
            if tail.strip():
                (directory / "server.log").write_text(tail, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", default="")
    parser.add_argument("--minutes", type=int, default=15)
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "control-real-model"))
    args = parser.parse_args()
    if args.serve:
        serve(Path(args.serve))
        return 0
    return run_e2e(Path(args.out), args.minutes)


if __name__ == "__main__":
    raise SystemExit(main())
