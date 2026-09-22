"""Real E2B failure/repair smoke through the product control HTTP dispatcher.

Tool selection and the approved plan are scripted fixtures; no model inference,
browser acceptance or production identity validation is claimed. Sources,
session persistence, tool dispatch, operations, command exits and logs are real.
Only the fixed checked-in template is uploaded. Every remote resource belongs
to a unique smoke workspace and is reconciled in finally.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=360, help="Maximum seconds per remote command")
    parser.add_argument("--without-key", action="store_true", help="Exercise the blocked preflight without credentials")
    args = parser.parse_args()
    if not 30 <= args.timeout <= 900:
        parser.error("timeout must be between 30 and 900 seconds")
    from dotenv import dotenv_values

    stamp = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    directory = ROOT / "artifacts" / "project-tools" / stamp
    directory.mkdir(parents=True, exist_ok=True)
    report_path = directory / "report.json"
    api_key = None if args.without_key else (os.environ.get("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY"))
    report = {
        "scope": "approved-session-control-http-real-e2b-failure-and-repair", "status": "running",
        "controlTransport": "actual FastAPI control-turn-stream using in-process HTTP",
        "model": "not invoked; forcedTool selection and approved plan are scripted fixtures",
        "identity": "injected development superuser; durable session owner checked by real services",
        "storage": "one isolated SQLite database for sessions, control runs, and projects",
        "execution": "real E2B; checked-in React/TypeScript/Vite template",
        "notCovered": ["live model decisions", "production authentication", "private browser preview",
            "browser behavior", "application business acceptance"],
        "checks": [], "commands": [], "cleanup": [], "sandboxIds": [],
    }
    if not api_key:
        report.update(status="blocked", error="e2b_api_key_missing")
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"BLOCKED e2b_api_key_missing; report: {report_path}")
        return 2

    # Set every persistent/network selector before importing the application.
    # A developer's .env must never direct smoke session writes into a real DB.
    database_url = f"sqlite:///{(directory / 'state.db').as_posix()}"
    internal_key = secrets.token_hex(32)
    os.environ.update({"NODE_ENV": "development", "APP_STORE_DATABASE_URL": database_url,
        "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "", "APP_STORE_NEON_HTTP": "0",
        "APP_STORE_FILE": str(directory / "apps.json"),
        "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "SLIDE_RULE_INTERNAL_KEY": internal_key,
        "SLIDERULE_AUTH_SECRET": secrets.token_hex(32), "SLIDERULE_WEB_SEARCH": "off",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "LLM_API_KEY": ""})

    from fastapi.testclient import TestClient
    from app import app
    from middlewares.current_user import optional_user, require_user
    from models.v5_state import V5SessionState
    from services import persistence
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.identity_store import get_identity_store
    from services.project_authority import approved_reference
    from services.project_creation import load_project_template
    from services.project_manifest import build_manifest
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import get_project_store, reset_project_store
    from services.session_blob_store import SqlSessionBlobStore
    from services.control_run_store import ControlRunStore
    from services.control_run_service import ControlRunService
    from services.project_creation import load_authorized_session

    viewer = get_identity_store().create("project-tools@internal.test", secrets.token_hex(32),
        is_superuser=True, is_verified=True)
    session_id, owner_id = "smoke-tools-" + uuid.uuid4().hex, viewer.id
    store = get_project_store()
    sessions = SqlSessionBlobStore(database_url)
    original_blob_store = persistence._blob_store
    persistence._blob_store = lambda _path=None: sessions
    app.dependency_overrides[optional_user] = lambda: viewer
    app.dependency_overrides[require_user] = lambda: viewer
    provider = E2BWorkspaceProvider(api_key=api_key)
    supervisor = ProjectRuntimeSupervisor(store, lambda: E2BWorkspaceProvider(api_key=api_key),
        max_workers=1, poll_interval=1, lease_ttl=60,
        lifetime_seconds=min(900, args.timeout + 30), idle_seconds=60,
        install_timeout=min(600, args.timeout))
    app.state.project_runtime_supervisor = supervisor
    control = ControlRunService(ControlRunStore(store._q), store, supervisor,
        authorize=lambda sid, owner: load_authorized_session(sid, owner_id=owner))
    # Session writes fence against wb_control_run in the same SQL statement.
    tables = {row["name"] for row in store._q("select name from sqlite_master where type='table'")}
    if not {"sliderule_session", "wb_control_run", "wb_project"} <= tables:
        raise RuntimeError("project_smoke_shared_database_required")
    @asynccontextmanager
    async def lifespan(application):
        application.state.control_run_service = control
        await control.start()
        try:
            yield
        finally:
            await control.shutdown()
    app.router.lifespan_context = lifespan
    client = TestClient(app)
    client.__enter__()
    project_id = None
    operations = []

    def passed(name):
        report["checks"].append({"name": name, "status": "passed"})
        print("PASS " + name, flush=True)

    def tool(name, arguments):
        response = client.post("/api/sliderule/control-turn-stream", headers={"x-internal-key": internal_key}, json={
            "sessionId": session_id, "userText": "Continue the approved internal engineering smoke",
            "installedSkills": [], "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None,
            "forcedTool": name, "toolArgs": arguments,
        })
        if response.status_code != 200:
            raise RuntimeError(f"control_http_{response.status_code}")
        events = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith("data:")]
        results = [event for event in events if event.get("type") == "control_tool_result" and event.get("tool") == name]
        if len(results) != 1 or not results[0].get("ok"):
            code = str(results[0].get("error", "tool_result_missing")) if results else "tool_result_missing"
            raise RuntimeError(name + ":" + code)
        report.setdefault("toolEvents", []).append({"tool": name,
            "eventTypes": [event.get("type") for event in events], "result": results[0]})
        return results[0]

    def remember_sandbox():
        lease = store.get_lease(project_id, owner_id=owner_id)
        if lease and lease.sandboxId and lease.sandboxId not in report["sandboxIds"]:
            report["sandboxIds"].append(lease.sandboxId)
        return lease

    def command(name, revision, expected_exit):
        submitted = tool("project_exec", {"approvalRef": approval, "expectedRevision": revision,
            "idempotencyKey": f"{name}-{len(operations)}", "command": name})
        operation_id = submitted["operationId"]
        operations.append(operation_id)
        started, last_phase = time.monotonic(), None
        while time.monotonic() - started < args.timeout:
            response = client.get(f"/api/sliderule/project-operations/{operation_id}")
            if response.status_code != 200:
                raise RuntimeError(f"operation_snapshot_http_{response.status_code}")
            snapshot = response.json()
            phase = (snapshot.get("runtime") or {}).get("status") or snapshot["operation"]["status"]
            if phase != last_phase:
                print(f"RUN {name}: {phase}", flush=True)
                last_phase = phase
            lease = remember_sandbox()
            if snapshot["operation"]["status"] in {"completed", "failed", "cancelled"}:
                if lease is None or (lease.expiresAt <= time.time() and not lease.sandboxId and not lease.processRefs):
                    break
            time.sleep(1)
        else:
            raise RuntimeError("project_command_smoke_timeout")
        outcome = tool("project_status", {"operationId": operation_id})
        text, seq, offset = "", 0, 0
        for _ in range(100):
            page = tool("project_logs", {"operationId": operation_id, "afterSeq": seq, "offset": offset})
            text += "".join(item["text"] for item in page["logs"])
            if not page["hasMore"]:
                break
            following = (page["nextSeq"], page["nextOffset"])
            if following == (seq, offset):
                raise RuntimeError("project_log_cursor_stalled")
            seq, offset = following
        else:
            raise RuntimeError("project_log_smoke_limit")
        log_path = directory / f"{len(operations):02}-{name}.log"
        log_path.write_text(text.replace(api_key, "[redacted]"), encoding="utf-8")
        record = {"command": name, "operationId": operation_id, "revision": revision,
            "status": outcome["status"], "exitCode": outcome.get("exitCode"),
            "errorCode": outcome.get("errorCode"), "log": log_path.name,
            "durationSeconds": round(time.monotonic() - started, 2)}
        report["commands"].append(record)
        if expected_exit == 0:
            if outcome["status"] != "completed" or outcome.get("exitCode") != 0:
                raise RuntimeError("expected_successful_" + name)
        elif outcome["status"] != "failed" or not isinstance(outcome.get("exitCode"), int) or outcome["exitCode"] == 0:
            raise RuntimeError("expected_real_typecheck_failure")
        return outcome, text

    try:
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            capture_output=True, check=True).stdout.strip()
        report["repositoryHead"] = revision
        source_paths = ["services/project_tools.py", "services/project_tool_contracts.py",
            "services/project_runtime_worker.py", "services/project_creation.py", "services/rehearsal_control.py"]
        report["implementationSha256"] = {path: hashlib.sha256((ROOT / "slide-rule-python" / path).read_bytes()).hexdigest()
            for path in source_paths}
        files, template_version = load_project_template()
        report["templateVersion"] = template_version
        report["templateTreeHash"] = build_manifest(files).treeHash
        report["lockfileSha256"] = hashlib.sha256(files["package-lock.json"].encode()).hexdigest()
        plan = {"planId": "smoke-approved-plan", "revision": 1,
            "planContent": "Create the fixed engineering template. Introduce a TypeScript failure, collect its real logs, repair the source, then run check, test and build in E2B. Do not publish.",
            "reqId": "smoke-plan-approval"}
        state = V5SessionState(sessionId=session_id, ownerId=owner_id,
            goal={"text": "Internal engineering failure and repair smoke", "status": "clear"},
            controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
        saved = persistence.save_session_record(state, server_write=True)
        if not saved.get("ok"):
            raise RuntimeError("smoke_session_persistence_failed")
        approval = approved_reference(state)
        supervisor.start()
        created = tool("project_create", {"approvalRef": approval})
        project_id = created["projectId"]
        report.update(sessionId=session_id, projectId=project_id, initialRevision=created["revision"])
        saved = persistence.load_session_record(session_id)["session"]
        if saved.projectId != project_id or saved.projectRevision != created["revision"] or saved.runtimeKind != "project":
            raise RuntimeError("session_project_binding_missing")
        if store.read_files(project_id, owner_id=owner_id) != files:
            raise RuntimeError("created_template_differs_from_checked_in_source")
        passed("approved_session_creates_exact_template_through_control_http")

        original = tool("project_read", {"path": "src/main.tsx"})
        if original["truncated"]:
            raise RuntimeError("smoke_template_main_exceeds_read_page")
        broken = tool("project_patch", {"approvalRef": approval, "expectedRevision": original["revision"],
            "changes": [{"path": "src/main.tsx", "content": original["content"] + '\nconst smokeTypeError: number = "intentional failure";\n',
                "expectedSha256": original["sha256"]}]})
        report["brokenRevision"] = broken["revision"]
        _failure, error_logs = command("check", broken["revision"], expected_exit=1)
        if "TS2322" not in error_logs or "src/main.tsx" not in error_logs:
            raise RuntimeError("real_typecheck_error_missing_from_tool_logs")
        passed("real_e2b_type_error_returns_nonzero_and_durable_source_location")

        current = tool("project_read", {"path": "src/main.tsx"})
        repaired = tool("project_patch", {"approvalRef": approval, "expectedRevision": broken["revision"],
            "changes": [{"path": "src/main.tsx", "content": original["content"], "expectedSha256": current["sha256"]}]})
        report["repairedRevision"] = repaired["revision"]
        if repaired["revision"] in {created["revision"], broken["revision"]}:
            raise RuntimeError("repair_did_not_produce_distinct_revision")
        passed("repair_saves_new_revision_and_updates_session_projection")
        for name in ("check", "test", "build"):
            _result, logs = command(name, repaired["revision"], expected_exit=0)
            if name == "test" and ("fail 0" not in logs or "pass 2" not in logs):
                raise RuntimeError("real_node_tests_missing")
            if name == "build" and "dist/index.html" not in logs:
                raise RuntimeError("real_vite_build_output_missing")
            passed("repaired_revision_passes_real_" + name)
        persisted = persistence.load_session_record(session_id)["session"]
        if persisted.projectRevision != repaired["revision"] or store.read_files(project_id, owner_id=owner_id) != files:
            raise RuntimeError("repair_source_or_session_projection_mismatch")
        if store.read_files(project_id, broken["revision"], owner_id=owner_id)["src/main.tsx"] == files["src/main.tsx"]:
            raise RuntimeError("broken_revision_was_mutated")
        passed("immutable_failed_revision_and_repaired_sources_remain_recoverable")
        report["status"] = "passed"
    except Exception as exc:
        report.update(status="failed", error=str(exc).replace(api_key, "[redacted]")[:1000])
        print("FAIL " + report["error"], flush=True)
    finally:
        for operation_id in operations:
            try:
                operation = store.get_operation(operation_id, owner_id=owner_id)
                if operation.status not in {"completed", "failed", "cancelled"}:
                    supervisor.cancel(operation_id, owner_id=owner_id)
            except Exception:
                report["status"] = "failed"
        try:
            supervisor.shutdown(timeout=45)
        except Exception:
            report["status"] = "failed"
        if project_id:
            workspace_id = "ws-" + project_id
            try:
                for handle in provider.find_workspaces(workspace_id=workspace_id):
                    provider.destroy(handle)
                remaining = provider.find_workspaces(workspace_id=workspace_id)
                if remaining:
                    raise RuntimeError("remote_cleanup_not_confirmed")
                report["cleanup"].append({"workspaceId": workspace_id, "status": "confirmed_empty"})
            except Exception:
                report["status"] = "failed"
                report["cleanup"].append({"workspaceId": workspace_id, "status": "pending"})
        client.__exit__(None, None, None)
        client.close()
        app.dependency_overrides.pop(optional_user, None)
        app.dependency_overrides.pop(require_user, None)
        persistence._blob_store = original_blob_store
        sessions._engine.dispose()
        reset_project_store()
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False).replace(api_key, "[redacted]"), encoding="utf-8")
        print(f"Report: {report_path}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
