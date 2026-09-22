"""Real E2B lifecycle smoke for the durable worker, with bounded cleanup.

Uses the fixed project saved by project-runtime-smoke as input. The test store
is disposable; credentials are only passed to the host-side E2B provider.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))

from dotenv import dotenv_values


def wait_for(store, operation_id, status, *, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        operation = store.get_operation(operation_id, owner_id="smoke-owner")
        if operation.runtime and operation.runtime.status == status:
            return operation
        if operation.status in {"failed", "cancelled", "completed"}:
            raise RuntimeError(operation.runtime.errorCode or "unexpected_terminal_state")
        time.sleep(1)
    raise RuntimeError("runtime_smoke_timeout")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-db", required=True, type=Path)
    args = parser.parse_args()
    path = ROOT / "artifacts" / "project-lifecycle" / f"{int(time.time())}-{uuid.uuid4().hex[:8]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {"scope": "durable-fixed-project-runtime", "status": "running", "checks": [], "cleanup": []}
    api_key = os.environ.get("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY")
    store, project, provider, workers = None, None, None, []
    url = f"sqlite:///{path.with_suffix('.db').as_posix()}"
    # Current-account checks must resolve the fixed smoke owner in this
    # disposable database. Session/plan authorization remains the declared
    # lifecycle fixture; no real developer account or store is used.
    os.environ.update({"NODE_ENV": "development", "APP_STORE_DATABASE_URL": url,
        "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "", "APP_STORE_NEON_HTTP": "0",
        "SLIDERULE_IDENTITY_SQLITE": url, "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1"})
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.identity_store import get_identity_store
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import ProjectStore
    from services.workspace_provider import WorkspaceHandle

    def passed(name):
        report["checks"].append(name)
        print("PASS " + name, flush=True)

    def worker():
        current = ProjectRuntimeSupervisor(store, lambda: E2BWorkspaceProvider(api_key=api_key),
            authorizer=lambda *args: None, poll_interval=1, lease_ttl=30,
            lifetime_seconds=600, idle_seconds=480)
        current.start()
        workers.append(current)
        return current

    def submit(current, key):
        return current.submit(project.projectId, owner_id="smoke-owner", expected_revision=project.currentRevision,
            approval_ref="internal-fixed-smoke", idempotency_key=key, port=5181)

    try:
        if not api_key:
            report["status"] = "blocked"
            raise RuntimeError("e2b_api_key_missing")
        identity = get_identity_store()
        actor = identity.create("project-lifecycle@internal.test", secrets.token_hex(32),
            is_superuser=True, is_verified=True)
        identity._x.execute("update sliderule_user set id=:p1 where id=:p2", ["smoke-owner", actor.id])
        provider = E2BWorkspaceProvider(api_key=api_key)
        # Read only a project created by the existing bounded fixed-template smoke.
        with sqlite3.connect(f"file:{args.source_db.resolve().as_posix()}?mode=ro", uri=True) as source:
            source_project = json.loads(source.execute("select payload from wb_project limit 1").fetchone()[0])
        source_store = ProjectStore.from_url(f"sqlite:///{args.source_db.resolve().as_posix()}")
        try:
            files = source_store.read_files(source_project["projectId"], source_project["currentRevision"], owner_id="smoke-owner")
        finally:
            source_store.close()
        if json.loads(files["package.json"]).get("name") != "whybuddy-runtime-smoke":
            raise RuntimeError("fixed_smoke_source_required")
        store = ProjectStore.from_url(url)
        project = store.create_project("smoke-" + uuid.uuid4().hex, owner_id="smoke-owner",
            files=files, template_version="vite-smoke-1", plan_ref="internal-fixed-smoke")
        report["revision"] = project.currentRevision
        first = worker()
        operation = submit(first, "first")
        assert submit(first, "first").operationId == operation.operationId
        ready = wait_for(store, operation.operationId, "ready")
        lease = store.get_lease(project.projectId, owner_id="smoke-owner")
        report["firstSandboxId"] = lease.sandboxId
        report["operationId"] = operation.operationId
        passed("idempotent_submission_runs_fixed_vite_project")
        logs = [e for e in store.list_events(operation.operationId, owner_id="smoke-owner") if e.type == "runtime.log"]
        assert any("added" in e.payload["text"] for e in logs)
        passed("background_install_exit_and_logs_are_persisted")
        touched = store.touch_operation(operation.operationId, owner_id="smoke-owner").lastAccessAt
        first.shutdown()
        paused = store.get_operation(operation.operationId, owner_id="smoke-owner")
        assert paused.status == "interrupted" and paused.runtime.status == "reconciling"
        saved_seq = store.snapshot_operation(operation.operationId, owner_id="smoke-owner")["lastSeq"]
        store.close()
        store = ProjectStore.from_url(url)
        second = worker()
        restored = wait_for(store, operation.operationId, "ready")
        new_lease = store.get_lease(project.projectId, owner_id="smoke-owner")
        assert new_lease.sandboxId == lease.sandboxId and restored.runtime.processId == ready.runtime.processId
        assert new_lease.generation > lease.generation
        assert restored.lastAccessAt == touched
        assert store.list_events(operation.operationId, owner_id="smoke-owner", after_seq=saved_seq)
        passed("new_store_and_worker_recover_same_sandbox_pid_and_events")
        second.cancel(operation.operationId, owner_id="smoke-owner")
        stopped = wait_for(store, operation.operationId, "stopped")
        assert stopped.status == "cancelled"
        assert not provider.find_workspaces(workspace_id=lease.workspaceId)
        assert store.read_files(project.projectId, project.currentRevision, owner_id="smoke-owner") == files
        passed("cancel_destroys_remote_instance_and_preserves_source")
        rebuilt_op = submit(second, "rebuild")
        rebuilt = wait_for(store, rebuilt_op.operationId, "ready")
        rebuilt_lease = store.get_lease(project.projectId, owner_id="smoke-owner")
        assert rebuilt_lease.sandboxId != lease.sandboxId and rebuilt.runtime.revision == ready.runtime.revision
        passed("destroyed_workspace_rebuilds_from_durable_revision")
        second.cancel(rebuilt_op.operationId, owner_id="smoke-owner")
        wait_for(store, rebuilt_op.operationId, "stopped")
        second.shutdown()
        third = worker()
        installing_op = submit(third, "cancel-install")
        wait_for(store, installing_op.operationId, "installing")
        deadline = time.monotonic() + 20
        while True:
            installing_lease = store.get_lease(project.projectId, owner_id="smoke-owner")
            install_pid = installing_lease.processRefs.get("install")
            if install_pid:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("install_process_not_registered")
            time.sleep(0.1)
        assert provider.is_process_running(WorkspaceHandle(installing_lease.workspaceId, installing_lease.sandboxId), install_pid)
        third.cancel(installing_op.operationId, owner_id="smoke-owner")
        stopped = wait_for(store, installing_op.operationId, "stopped")
        assert stopped.status == "cancelled"
        assert not provider.find_workspaces(workspace_id=lease.workspaceId)
        passed("cancel_during_real_dependency_install_stops_sandbox")
        report["status"] = "passed"
    except Exception as exc:
        if report["status"] != "blocked":
            report["status"] = "failed"
        report["error"] = str(exc).replace(api_key or "unconfigured-secret", "[redacted]")
        print("FAIL " + report["error"], flush=True)
    finally:
        for current in workers:
            try:
                current.shutdown()
            except Exception:
                report["status"] = "failed"
        if project and store:
            lease = store.get_lease(project.projectId, owner_id="smoke-owner")
            try:
                if lease is not None:
                    for handle in provider.find_workspaces(workspace_id=lease.workspaceId):
                        provider.destroy(handle)
                    report["cleanup"].append({"workspaceId": lease.workspaceId, "status": "destroyed"})
            except Exception:
                report["status"] = "failed"
                report["cleanup"].append({"projectId": project.projectId, "status": "pending"})
        if store is not None:
            store.close()
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report: {path}", flush=True)
    return 0 if report["status"] == "passed" else 2 if report["status"] == "blocked" else 1


if __name__ == "__main__":
    raise SystemExit(main())
