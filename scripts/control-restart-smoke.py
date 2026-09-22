"""Kill a real control producer and recover its durable state in a new process.

The HTTP routes, control loop, tool dispatcher, stores, and lease scanner are real.
Only the model and crash boundaries are deterministic fixtures. No LLM, E2B, or
login is exercised. Each scenario has one isolated SQLite database, including its
fixture identity, sessions, control runs, and immutable project sources.
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
INTERNAL_KEY = "control-restart-local-fixture"
CALL_ID = "restart-create-project-call"
TERMINAL = {"completed", "waiting_user", "failed", "cancelled", "interrupted"}
SCENARIOS = ("saved-receipt", "missing-receipt", "sampling")


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def wait_for(predicate, description, *, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.04)
    raise AssertionError("Timed out: " + description)


def serve(directory, scenario, instance):
    sys.path.insert(0, str(BACKEND))
    import uvicorn
    from config.settings import settings
    from services.sql_gateway import http_api_credentials

    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    if http_api_credentials() != ("", "") or settings.APP_STORE_DATABASE_URL != database_url:
        raise RuntimeError("restart_smoke_isolated_backend_required")

    from app import app
    from middlewares.current_user import optional_user
    from models.v5_state import V5SessionState
    from services import persistence, rehearsal_control
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.identity_store import get_identity_store
    from services.project_authority import approved_reference
    from services.project_store import ProjectStore
    from services.project_tools import ProjectTools
    from services.session_blob_store import SqlSessionBlobStore
    from services.slide_rule_session import save_session
    from sliderule_llm.control_client import ControlLlmResult

    sessions = SqlSessionBlobStore(database_url)
    persistence._blob_store = lambda *_: sessions
    projects = ProjectStore.from_url(database_url)
    store = ControlRunStore(projects._q)
    identities = get_identity_store()
    viewer = identities.get_by_email("restart-fixture@example.invalid")
    if viewer is None:
        viewer = identities.create("restart-fixture@example.invalid", "unused-fixture-password-hash",
            is_superuser=True, is_verified=True)
    owner = viewer.id
    app.dependency_overrides[optional_user] = lambda: viewer
    session_id = "restart-" + directory.parent.name + "-" + scenario
    if sessions.load(session_id) is None:
        plan = {"planId": "restart-fixture-plan", "revision": 1,
            "planContent": "Create one persistent template project", "reqId": "restart-fixture-approval"}
        state = V5SessionState(sessionId=session_id, ownerId=owner,
            goal={"text": "Create one persistent template project"},
            controlTranscript=[{**plan, "kind": kind}
                for kind in ("plan_written", "plan_approval", "plan_approved")])
        save_session(state, server_write=True, require_durable=True)
    else:
        state = V5SessionState.model_validate(sessions.load(session_id).payload)
    approval = approved_reference(state)
    tables = {row["name"] for row in projects._q("select name from sqlite_master where type='table'")}
    if not {"sliderule_session", "sliderule_user", "wb_control_run", "wb_project"} <= tables:
        raise RuntimeError("restart_smoke_shared_database_required")
    journal_lock = threading.Lock()

    def journal(kind, **payload):
        with journal_lock, (directory / "observations.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"kind": kind, "instance": instance, "pid": os.getpid(),
                "time": time.time(), **payload}, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def boundary(phase):
        write_json(directory / f"boundary-{instance}.json", {"phase": phase, "pid": os.getpid()})

    async def scripted_model(messages, **kwargs):
        receipts = [message for message in messages if message.get("role") == "tool"]
        assistant_ids = [call["id"] for message in messages for call in message.get("tool_calls", [])]
        journal("model", receiptIds=[message["tool_call_id"] for message in receipts],
            assistantIds=assistant_ids,
            receiptResults=[json.loads(message["content"]) for message in receipts])
        if instance == 1 and scenario == "sampling":
            boundary("sampling")
            await asyncio.Future()
        if receipts:
            return ControlLlmResult(content="Recovered the existing project receipt", tool_calls=[],
                usage={"total_tokens": 12}, finish_reason="stop", model="restart-fixture", latency_ms=0)
        return ControlLlmResult(content="", tool_calls=[{"id": CALL_ID, "name": "project_create",
            "arguments": {"approvalRef": approval}}], usage={"total_tokens": 12},
            finish_reason="tool_calls", model="restart-fixture", latency_ms=0)

    rehearsal_control._invoke_control_llm = scripted_model
    actual_execute = ProjectTools.execute

    def observe_execute(adapter, name, args, state):
        journal("tool-dispatch", tool=name)
        return actual_execute(adapter, name, args, state)

    ProjectTools.execute = observe_execute
    actual_append = store.append_event

    def crash_boundary(run_id, worker_id, generation, event):
        # Stop precisely after the real tool committed its source, optionally
        # after its receipt also committed, while the checkpoint is dispatching.
        # The parent kills this whole process. No graceful suspend/release runs.
        if instance == 1 and scenario != "sampling" and event.get("type") == "control_tool_result":
            if scenario == "saved-receipt":
                actual_append(run_id, worker_id, generation, event)
            boundary("dispatching")
            threading.Event().wait(60)
            raise RuntimeError("parent_failed_to_kill_crash_boundary")
        return actual_append(run_id, worker_id, generation, event)

    store.append_event = crash_boundary
    service = ControlRunService(store, projects, None, poll_seconds=0.03, lease_seconds=3)
    server_ref = {}

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

    @app.get("/__restart/status")
    async def status():
        return {"sessionId": session_id, "ownerId": owner, "workerId": service.worker_id,
            "activeProducers": len(service._tasks), "tables": sorted(tables)}

    @app.get("/__restart/inspect/{run_id}")
    async def inspect(run_id: str):
        project = projects.get_project_for_session(session_id, owner_id=owner)
        return {"run": store.get(run_id, owner),
            "project": project.model_dump(mode="json") if project else None,
            "sources": projects.read_files(project.projectId, owner_id=owner) if project else None,
            "session": sessions.load(session_id).payload,
            "projectCount": int(projects._q("select count(*) as n from wb_project")[0]["n"]),
            "revisionCount": int(projects._q("select count(*) as n from wb_project_revision")[0]["n"])}

    @app.post("/__restart/shutdown")
    async def shutdown():
        server_ref["server"].should_exit = True
        return {"stopping": True}

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server_ref["server"] = server
    write_json(directory / f"server-{instance}.json", {"pid": os.getpid(),
        "port": listener.getsockname()[1], "sessionId": session_id})
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


def fixture_environment(directory):
    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    return {**os.environ, "SLIDERULE_DISABLE_ENV_HYDRATION": "1", "NODE_ENV": "development",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "SLIDE_RULE_INTERNAL_KEY": INTERNAL_KEY,
        # Windows may omit empty subprocess environment entries. Keep these
        # present so config fallback cannot hydrate a real gateway from .env.
        "APP_STORE_HTTP_API_URL": " ", "APP_STORE_HTTP_API_KEY": " ",
        "APP_STORE_DATABASE_URL": database_url, "APP_STORE_LOCAL_SQLITE": database_url,
        "SLIDERULE_IDENTITY_SQLITE": database_url, "APP_STORE_FILE": str(directory / "apps.json"),
        "SLIDERULE_SESSIONS_FILE": str(directory / "sessions-unused.json"),
        "SLIDERULE_WEB_SEARCH": "off", "SLIDERULE_CODE_RUN": "off", "SLIDERULE_AGENTIC_PICK": "off",
        "LLM_API_KEY": "", "OPENAI_API_KEY": "", "E2B_API_KEY": "", "PYTHONIOENCODING": "utf-8"}


class Child:
    def __init__(self, directory, scenario, instance):
        self.directory, self.instance = directory, instance
        self.process, self.client, self.port, self.log = None, None, None, None
        self.hard_killed = False
        self.environment = fixture_environment(directory)
        self.command = [sys.executable, str(Path(__file__).resolve()), "--serve", str(directory),
            "--scenario", scenario, "--instance", str(instance)]

    def start(self):
        import httpx
        self.log = (self.directory / f"server-{self.instance}.log").open("w", encoding="utf-8")
        self.process = subprocess.Popen(self.command, cwd=ROOT, env=self.environment,
            stdout=self.log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

        def record():
            if self.process.poll() is not None:
                raise RuntimeError(f"Producer {self.instance} exited during startup; inspect server log")
            path = self.directory / f"server-{self.instance}.json"
            try:
                return read_json(path)
            except (FileNotFoundError, PermissionError):
                # Windows can briefly deny a reader while the child publishes
                # its atomic rename. Retry within the existing startup deadline.
                return None

        descriptor = wait_for(record, "producer socket publication")
        self.port = descriptor["port"]
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{self.port}", timeout=15,
            trust_env=False, headers={"x-internal-key": INTERNAL_KEY})

        def ready():
            try:
                response = self.client.get("/__restart/status", timeout=0.5)
                return response.json() if response.status_code == 200 else None
            except httpx.HTTPError:
                return None

        return wait_for(ready, "producer readiness")

    def kill(self):
        self.process.kill()
        self.process.wait(timeout=5)
        self.hard_killed = True

    def cleanup(self):
        import httpx
        forced = False
        if self.process is not None and self.process.poll() is None:
            if self.client is not None:
                try:
                    self.client.post("/__restart/shutdown", timeout=2)
                except httpx.HTTPError:
                    pass
            try:
                self.process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                forced = True
                self.process.kill()
                self.process.wait(timeout=5)
        if self.client is not None:
            self.client.close()
        if self.log is not None:
            self.log.close()
        port_closed = True
        if self.port is not None:
            with socket.socket() as probe:
                probe.settimeout(0.3)
                port_closed = probe.connect_ex(("127.0.0.1", self.port)) != 0
        return {"instance": self.instance, "pid": self.process.pid if self.process else None,
            "processExited": self.process is None or self.process.poll() is not None,
            "exitCode": self.process.returncode if self.process else None,
            "expectedHardKill": self.hard_killed, "forcedCleanup": forced, "portClosed": port_closed}


def smoke(output, scenarios):
    directory = output / (str(int(time.time())) + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True)
    report = {"schemaVersion": 1, "passed": False,
        "transport": "real TCP HTTP/SSE, killed Uvicorn producer, distinct replacement process",
        "storage": "isolated SQLite; identity/session/control/project tables share one database per scenario",
        "model": "deterministic fixture; crash boundary instrumentation",
        "llmInvoked": False, "e2bInvoked": False, "loginTested": False,
        "artifactDirectory": str(directory), "checks": [], "cleanup": []}
    children, failure = [], None

    def checked(name, condition, **evidence):
        report["checks"].append({"name": name, "passed": bool(condition), **evidence})
        if not condition:
            raise AssertionError(name)

    try:
        for scenario in scenarios:
            case = directory / scenario
            case.mkdir()
            first = Child(case, scenario, 1)
            children.append(first)
            original = first.start()
            body = {"sessionId": original["sessionId"], "userText": "Create the approved project and continue",
                "installedSkills": [], "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
            headers = {"X-Control-Request-Id": scenario + "-request"}
            with first.client.stream("POST", "/api/sliderule/control-turn-stream", json=body, headers=headers) as response:
                response.raise_for_status()
                run_id = response.headers["x-control-run-id"]
                next(line for line in response.iter_lines() if line.startswith("data:"))
            wait_for(lambda: (case / "boundary-1.json").exists(), "actual crash boundary")
            before_response = first.client.get(f"/__restart/inspect/{run_id}")
            before_response.raise_for_status()
            before = before_response.json()
            write_json(case / "before-kill.json", before)
            expected_phase = "sampling" if scenario == "sampling" else "dispatching"
            checked(scenario + ": reached live durable crash boundary",
                before["run"]["checkpoint"]["phase"] == expected_phase and before["run"]["status"] == "running"
                and before["run"]["leaseExpiresAt"] > time.time(), phase=expected_phase, runId=run_id)
            first.kill()
            # This is process death, not ControlRunService.shutdown/suspend.
            import sqlite3
            with sqlite3.connect(case / "state.db") as connection:
                killed = json.loads(connection.execute("select payload from wb_control_run where id=?", [run_id]).fetchone()[0])
            checked(scenario + ": kill leaves original lease and checkpoint in SQL",
                killed["status"] == "running" and killed["leaseOwner"] == original["workerId"]
                and killed["leaseExpiresAt"] > 0 and killed["checkpoint"]["phase"] == expected_phase,
                pid=first.process.pid, exitCode=first.process.returncode, generation=killed["generation"])
            second = Child(case, scenario, 2)
            children.append(second)
            replacement = second.start()

            def settled():
                response = second.client.get(f"/api/sliderule/control-runs/{run_id}")
                response.raise_for_status()
                value = response.json()
                return value if value["status"] in TERMINAL else None

            terminal = wait_for(settled, "replacement reconciles expired producer lease")
            after_response = second.client.get(f"/__restart/inspect/{run_id}")
            after_response.raise_for_status()
            after = after_response.json()
            write_json(case / "after-restart.json", after)
            observations = [json.loads(line) for line in (case / "observations.jsonl").read_text(encoding="utf-8").splitlines()]
            models = [item for item in observations if item["kind"] == "model"]
            dispatches = [item for item in observations if item["kind"] == "tool-dispatch"]
            checked(scenario + ": a new process claims the next lease generation",
                first.process.pid != second.process.pid and replacement["workerId"] != original["workerId"]
                and replacement["ownerId"] == original["ownerId"]
                and after["run"]["generation"] == killed["generation"] + 1
                and after["run"]["leaseOwner"] == replacement["workerId"],
                producerPids=[first.process.pid, second.process.pid], generation=after["run"]["generation"])
            if scenario == "saved-receipt":
                checked(scenario + ": saved receipt resumes with original toolCallId",
                    terminal["status"] == "completed" and len(models) == 2
                    and models[-1]["instance"] == 2 and models[-1]["receiptIds"] == [CALL_ID]
                    and models[-1]["assistantIds"] == [CALL_ID]
                    and models[-1]["receiptResults"][0]["ok"] is True
                    and models[-1]["receiptResults"][0]["projectId"] == before["project"]["projectId"],
                    modelCalls=len(models), receiptIds=models[-1]["receiptIds"], status=terminal["status"])
            else:
                checked(scenario + ": uncertainty interrupts without resampling or completion",
                    terminal["status"] == "interrupted" and terminal["error"] == "control_reconciliation_required"
                    and len(models) == 1 and not any(event.get("type") == "complete" for event in after["run"]["events"]),
                    modelCalls=len(models), status=terminal["status"], error=terminal["error"])
            if scenario != "sampling":
                checked(scenario + ": no duplicate project dispatch, revision, or source write",
                    len(dispatches) == 1 and dispatches[0]["instance"] == 1
                    and dispatches[0]["tool"] == "project_create"
                    and before["project"] == after["project"] and before["sources"] == after["sources"]
                    and after["projectCount"] == before["projectCount"] == 1
                    and after["revisionCount"] == before["revisionCount"] == 1
                    and after["session"]["projectId"] == before["project"]["projectId"],
                    dispatches=len(dispatches), projects=after["projectCount"], revisions=after["revisionCount"])
            else:
                checked(scenario + ": no side effect is invented", not dispatches
                    and before["project"] is None and after["project"] is None
                    and after["projectCount"] == after["revisionCount"] == 0)
            replay = second.client.get(f"/api/sliderule/control-runs/{run_id}/stream?afterSeq=0")
            replay.raise_for_status()
            (case / "replay.sse").write_text(replay.text, encoding="utf-8")
            events = [json.loads(line[5:].strip()) for line in replay.text.splitlines() if line.startswith("data:")]
            sequenced = [event for event in events if "seq" in event]
            checked(scenario + ": real SSE replays the same ordered durable history",
                sequenced == after["run"]["events"]
                and [event["seq"] for event in sequenced] == list(range(1, after["run"]["lastSeq"] + 1))
                and sequenced[:len(before["run"]["events"])] == before["run"]["events"])
            repeated = second.client.post("/api/sliderule/control-turn-stream", json=body, headers=headers)
            repeated.raise_for_status()
            now = [json.loads(line) for line in (case / "observations.jsonl").read_text(encoding="utf-8").splitlines()]
            checked(scenario + ": repeated request attaches without replaying effects",
                repeated.headers["x-control-run-id"] == run_id and now == observations)
            wait_for(lambda: second.client.get("/__restart/status").json()["activeProducers"] == 0,
                "replacement producer finishes")
            for child in (first, second):
                report["cleanup"].append(child.cleanup())
                children.remove(child)
        report["passed"] = True
    except Exception as exc:
        failure = exc
        report["error"] = {"type": type(exc).__name__, "message": str(exc)}
    finally:
        for child in children:
            report["cleanup"].append(child.cleanup())
        if any(not item["processExited"] or not item["portClosed"] or item["forcedCleanup"]
                or (not item["expectedHardKill"] and item["exitCode"] != 0) for item in report["cleanup"]):
            report["passed"] = False
        write_json(directory / "report.json", report)
        write_json(output / "report.json", report)
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]),
        "report": str(directory / "report.json"), "cleanup": report["cleanup"]}, ensure_ascii=False))
    if failure is not None:
        raise failure
    if not report["passed"]:
        raise RuntimeError("control_restart_smoke_cleanup_failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--instance", type=int, choices=(1, 2), help=argparse.SUPPRESS)
    parser.add_argument("--scenario", choices=SCENARIOS)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "control-restart-smoke")
    args = parser.parse_args()
    if args.serve:
        serve(args.serve.resolve(), args.scenario, args.instance)
    else:
        smoke(args.output.resolve(), (args.scenario,) if args.scenario else SCENARIOS)
