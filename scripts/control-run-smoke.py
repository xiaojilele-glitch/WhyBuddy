"""Real TCP/SSE control-run smoke with an injected deterministic model.

Run with the repository Python venv. This does not call an LLM or E2B and does
not validate account login. It runs the production HTTP routes, control loop,
durable run service, and SQLite adapters in a separately managed Uvicorn process.
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
OWNER = "control-smoke-owner"
INTERNAL_KEY = "control-smoke-local-only"
TERMINAL = {"completed", "waiting_user", "failed", "cancelled", "interrupted"}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def serve(directory):
    sys.path.insert(0, str(BACKEND))
    import uvicorn
    from app import app
    from middlewares.current_user import optional_user
    from models.v5_state import V5SessionState
    from services import persistence, rehearsal_control
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.identity_store import User
    from services.project_creation import load_authorized_session
    from services.project_store import ProjectStore
    from services.session_blob_store import SqlSessionBlobStore
    from services.slide_rule_session import save_session
    from sliderule_llm.control_client import ControlLlmResult

    # The session CAS checks its producer lease in SQL, so both tables must be
    # visible to the same database connection used for the guarded write.
    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    sessions = SqlSessionBlobStore(database_url)
    persistence._blob_store = lambda *_: sessions
    projects = ProjectStore.from_url(database_url)
    store = ControlRunStore(projects._q)
    tables = {row["name"] for row in projects._q("select name from sqlite_master where type='table'")}
    if not {"sliderule_session", "wb_control_run", "wb_project"} <= tables:
        raise RuntimeError("control_smoke_shared_database_required")
    viewer = User(id=OWNER, is_superuser=True)
    app.dependency_overrides[optional_user] = lambda: viewer
    plan = {"planId": "smoke-plan", "revision": 1, "planContent": "Verify durable control delivery", "reqId": "approve-smoke"}
    session_id = "control-smoke-" + directory.name
    state = V5SessionState(sessionId=session_id, ownerId=OWNER, goal={"text": "Verify durable control delivery"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    save_session(state, server_write=True, require_durable=True)
    release = asyncio.Event()
    model = {"calls": 0, "completed": 0, "cancelled": 0}
    server_ref = {}

    async def scripted_model(*args, **kwargs):
        model["calls"] += 1
        call = model["calls"]
        try:
            if call == 1:
                await release.wait()
            else:
                await asyncio.Future()
            model["completed"] += 1
            return ControlLlmResult(content="Persisted after the TCP subscriber disconnected", tool_calls=[],
                usage={"total_tokens": 0}, finish_reason="stop", model="scripted-control-smoke", latency_ms=0)
        except asyncio.CancelledError:
            model["cancelled"] += 1
            raise

    rehearsal_control._invoke_control_llm = scripted_model
    service = ControlRunService(store, projects, None,
        authorize=lambda sid, owner: load_authorized_session(sid, owner_id=owner),
        poll_seconds=0.03, lease_seconds=3)

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

    @app.get("/__control_smoke/status")
    async def smoke_status():
        return {"sessionId": session_id, "model": model, "activeProducers": len(service._tasks)}

    @app.post("/__control_smoke/release")
    async def smoke_release():
        release.set()
        return {"released": True}

    @app.post("/__control_smoke/shutdown")
    async def smoke_shutdown():
        server_ref["server"].should_exit = True
        return {"stopping": True}

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server_ref["server"] = server
    write_json(directory / "server.json", {"pid": os.getpid(), "port": listener.getsockname()[1], "sessionId": session_id})
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


def wait_for(predicate, description, *, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.04)
    raise AssertionError("Timed out: " + description)


def sse_events(raw):
    return [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith("data:")]


def smoke(output):
    import httpx

    directory = output / (str(int(time.time())) + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True)
    report = {"schemaVersion": 1, "passed": False, "transport": "real TCP HTTP/SSE via child Uvicorn",
        "storage": "one isolated SQLite database for sessions, control runs, and projects", "model": "injected deterministic coroutine",
        "llmInvoked": False, "e2bInvoked": False, "authentication": "injected local smoke owner; login not tested",
        "artifactDirectory": str(directory.relative_to(ROOT)), "checks": [], "cleanup": {"processExited": False}}
    environment = {**os.environ, "SLIDERULE_DISABLE_ENV_HYDRATION": "1", "NODE_ENV": "development",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "SLIDE_RULE_INTERNAL_KEY": INTERNAL_KEY,
        "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "",
        "APP_STORE_DATABASE_URL": f"sqlite:///{(directory / 'state.db').as_posix()}",
        "APP_STORE_LOCAL_SQLITE": f"sqlite:///{(directory / 'state.db').as_posix()}",
        "APP_STORE_FILE": str(directory / "apps.json"),
        "SLIDERULE_IDENTITY_SQLITE": f"sqlite:///{directory / 'identity.db'}",
        "SLIDERULE_WEB_SEARCH": "off", "SLIDERULE_CODE_RUN": "off", "SLIDERULE_AGENTIC_PICK": "off",
        "LLM_API_KEY": "", "OPENAI_API_KEY": "", "E2B_API_KEY": "",
        "SLIDERULE_SESSIONS_FILE": str(directory / "sessions-unused.json"), "PYTHONIOENCODING": "utf-8"}
    process, client = None, None
    failure = None

    def checked(name, condition, **evidence):
        report["checks"].append({"name": name, "passed": bool(condition), **evidence})
        if not condition:
            raise AssertionError(name)

    with (directory / "server.log").open("w", encoding="utf-8") as log:
        try:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve", str(directory)],
                cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            report["serverPid"] = process.pid

            def server_record():
                if process.poll() is not None:
                    raise RuntimeError("Uvicorn exited during startup; inspect server.log")
                path = directory / "server.json"
                if path.exists():
                    try:
                        return json.loads(path.read_text(encoding="utf-8"))
                    except json.JSONDecodeError:
                        pass
                return None

            server = wait_for(server_record, "server socket publication")
            base = f"http://127.0.0.1:{server['port']}"
            report["baseUrl"] = base
            client = httpx.Client(base_url=base, timeout=15, trust_env=False,
                headers={"x-internal-key": INTERNAL_KEY})

            def ready():
                try:
                    response = client.get("/__control_smoke/status", timeout=0.5)
                    return response.json() if response.status_code == 200 else None
                except httpx.HTTPError:
                    return None

            wait_for(ready, "Uvicorn readiness")
            body = {"sessionId": server["sessionId"], "userText": "Continue", "installedSkills": [],
                "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
            stream_path = "/api/sliderule/control-turn-stream"
            headers = {"X-Control-Request-Id": "disconnect-request"}
            with client.stream("POST", stream_path, headers=headers, json=body) as response:
                checked("first SSE accepted", response.status_code == 200, status=response.status_code)
                run_id = response.headers["x-control-run-id"]
                first = next(line for line in response.iter_lines() if line.startswith("data:"))
                checked("first SSE belongs to persisted run", json.loads(first[5:])["controlRunId"] == run_id, runId=run_id)
                wait_for(lambda: client.get("/__control_smoke/status").json()["model"]["calls"] == 1, "first scripted model starts before TCP disconnect")
            observed = client.get(f"/api/sliderule/control-runs/{run_id}").json()
            checked("TCP disconnect leaves producer running", observed["status"] == "running" and not observed["cancelRequested"], snapshot=observed)
            client.post("/__control_smoke/release").raise_for_status()

            def settled(run):
                value = client.get(f"/api/sliderule/control-runs/{run}").json()
                return value if value.get("status") in TERMINAL else None

            completed = wait_for(lambda: settled(run_id), "disconnected run completes")
            checked("background producer completes after disconnect", completed["status"] == "completed", snapshot=completed)
            replay = client.get(f"/api/sliderule/control-runs/{run_id}/stream?afterSeq=0")
            replay.raise_for_status()
            (directory / "replay.sse").write_text(replay.text, encoding="utf-8")
            events = sse_events(replay.text)
            sequenced = [event for event in events if "seq" in event]
            checked("new GET replays original persisted events",
                any(event.get("text") == "Persisted after the TCP subscriber disconnected" for event in events)
                and any(event.get("type") == "complete" for event in events)
                and all(event["controlRunId"] == run_id for event in sequenced),
                eventTypes=[event["type"] for event in events], sequence=[event["seq"] for event in sequenced])
            cursor = sequenced[0]["seq"]
            resumed = sse_events(client.get(f"/api/sliderule/control-runs/{run_id}/stream?afterSeq={cursor}").text)
            checked("afterSeq resumes without repeating prior events",
                [event["seq"] for event in resumed if "seq" in event] == [event["seq"] for event in sequenced if event["seq"] > cursor])
            repeated = client.post(stream_path, headers=headers, json=body)
            repeated.raise_for_status()
            sampled = client.get("/__control_smoke/status").json()["model"]
            checked("same request ID does not resample", repeated.headers["x-control-run-id"] == run_id and sampled["calls"] == 1, model=sampled)
            conflict = client.post(stream_path, headers=headers, json={**body, "userText": "Different request"})
            checked("same request ID rejects a different payload", conflict.status_code == 409, status=conflict.status_code)
            with client.stream("POST", stream_path, headers={"X-Control-Request-Id": "cancel-request"},
                    json={**body, "userText": "Wait for explicit cancellation"}) as response:
                response.raise_for_status()
                cancel_run = response.headers["x-control-run-id"]
                next(line for line in response.iter_lines() if line.startswith("data:"))
            wait_for(lambda: client.get("/__control_smoke/status").json()["model"]["calls"] == 2, "second scripted model starts")
            cancelled_response = client.delete(f"/api/sliderule/control-runs/{cancel_run}")
            cancelled_response.raise_for_status()
            cancelled = wait_for(lambda: settled(cancel_run), "explicit cancellation settles")
            metrics = client.get("/__control_smoke/status").json()
            cancel_events = sse_events(client.get(f"/api/sliderule/control-runs/{cancel_run}/stream").text)
            checked("DELETE cancels the active producer", cancelled["status"] == "cancelled"
                and metrics["model"]["cancelled"] == 1 and metrics["model"]["calls"] == 2,
                snapshot=cancelled, model=metrics["model"])
            checked("cancelled run does not report completion", not any(event.get("type") == "complete" for event in cancel_events))
            wait_for(lambda: client.get("/__control_smoke/status").json()["activeProducers"] == 0, "producer cleanup")
            write_json(directory / "events.json", {"completed": events, "cancelled": cancel_events})
            report["runs"] = {"completed": run_id, "cancelled": cancel_run}
            report["passed"] = True
        except Exception as exc:
            failure = exc
            report["error"] = {"type": type(exc).__name__, "message": str(exc)}
        finally:
            if client is not None:
                try:
                    client.post("/__control_smoke/shutdown", timeout=2)
                except httpx.HTTPError:
                    pass
                client.close()
            if process is not None:
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    report["passed"] = False
                    report["cleanup"]["forcedTermination"] = True
                report["cleanup"].update(processExited=process.poll() is not None, exitCode=process.returncode)
                if process.returncode != 0:
                    report["passed"] = False
            write_json(output / "report.json", report)
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "report": str(output / "report.json"),
        "cleanup": report["cleanup"]}, ensure_ascii=False))
    if failure is not None:
        raise failure
    if not report["passed"]:
        raise RuntimeError("control run smoke cleanup failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "control-run-smoke")
    args = parser.parse_args()
    if args.serve:
        serve(args.serve.resolve())
    else:
        smoke(args.output.resolve())
