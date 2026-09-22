"""Real E2B source edits through ProjectTools and the durable runtime worker.

The approved plan and tool choices are fixtures. SQL, session authorization,
revision CAS, queued patch ownership, E2B IO, Vite HTTP/HMR, worker restart and
cleanup are real. No browser DOM, live model or business acceptance is claimed.
Only the checked-in template and named smoke fixtures enter the sandbox.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--without-key", action="store_true")
    args = parser.parse_args()
    if not 60 <= args.timeout <= 600:
        parser.error("timeout must be between 60 and 600 seconds")
    from dotenv import dotenv_values

    directory = ROOT / "artifacts/project-source-sync" / f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    directory.mkdir(parents=True)
    report_path = directory / "report.json"
    key = None if args.without_key else os.getenv("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY")
    report = {"status": "running", "scope": "real project tools, SQL worker and single E2B Vite source synchronization",
        "fixtures": ["approved session", "tool selection", "checked-in template and named probe files"],
        "notCovered": ["live model decisions", "browser DOM", "private preview gateway", "business acceptance"],
        "checks": [], "cleanup": [], "syncCalls": [], "sandboxIds": []}

    def persist():
        report_path.write_text(json.dumps(report, indent=2).replace(key, "[redacted]") if key
            else json.dumps(report, indent=2), encoding="utf-8")

    if not key:
        report.update(status="blocked", error="e2b_api_key_missing")
        persist()
        print(f"BLOCKED e2b_api_key_missing; report: {report_path}")
        return 2

    # No developer or deployment database is selected by this smoke.
    database = f"sqlite:///{(directory / 'state.db').as_posix()}"
    os.environ.update({"NODE_ENV": "development", "APP_STORE_DATABASE_URL": database,
        "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "", "APP_STORE_NEON_HTTP": "0",
        "APP_STORE_FILE": str(directory / "apps.json"), "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "SLIDE_RULE_INTERNAL_KEY": secrets.token_hex(32),
        "SLIDERULE_AUTH_SECRET": secrets.token_hex(32), "SLIDERULE_WEB_SEARCH": "off", "LLM_API_KEY": "",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "SLIDERULE_IDENTITY_SQLITE": database})

    from models.v5_state import V5SessionState
    from services import persistence
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.identity_store import get_identity_store
    from services.project_authority import approved_reference
    from services.project_creation import load_project_template
    from services.project_manifest import build_manifest, content_hash
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import ProjectStore
    from services.project_tools import ProjectTools
    from services.session_blob_store import SqlSessionBlobStore
    from services.workspace_provider import WorkspaceHandle, WorkspaceProviderError

    class ObservedProvider(E2BWorkspaceProvider):
        def create(self, **kwargs):
            handle = super().create(**kwargs)
            report["sandboxIds"].append(handle.sandbox_id)
            persist()
            return handle

        def sync_files(self, handle, *, expected_files, files):
            item = {"thread": threading.current_thread().name, "sameTree": expected_files == files}
            report["syncCalls"].append(item)
            try:
                super().sync_files(handle, expected_files=expected_files, files=files)
                item["status"] = "ok"
            except WorkspaceProviderError as exc:
                item.update(status="failed", error=str(exc))
                raise
            finally:
                persist()

    provider = ObservedProvider(api_key=key)
    store = ProjectStore.from_url(database)
    sessions = SqlSessionBlobStore(database)
    previous_blob_store = persistence._blob_store
    persistence._blob_store = lambda *_args: sessions
    identity = get_identity_store()
    actor = identity.create("source-sync@internal.test", secrets.token_hex(32), is_superuser=True, is_verified=True)
    owner, session_id = actor.id, "source-sync-" + uuid.uuid4().hex
    supervisor = None
    project_id = parent_id = None
    state = None
    tools = None

    def checked(name, condition):
        report["checks"].append({"name": name, "passed": bool(condition)})
        persist()
        print(("PASS " if condition else "FAIL ") + name, flush=True)
        if not condition:
            raise AssertionError(name)

    def worker():
        result = ProjectRuntimeSupervisor(store, lambda: provider, max_workers=1,
            poll_interval=0.3, lease_ttl=30, lifetime_seconds=min(900, args.timeout + 180),
            idle_seconds=180, install_timeout=args.timeout, ready_timeout=60)
        result.start()
        return result

    def tool(name, arguments, *, error=None):
        result = tools.execute(name, arguments, state)
        if error is not None:
            checked(name + " rejects " + error, result == {"ok": False, "error": error})
        elif not result.get("ok"):
            raise RuntimeError(name + ":" + result.get("error", "missing_result"))
        return result

    def wait_operation(operation_id, *, ready=False, timeout=60):
        deadline, previous = time.monotonic() + timeout, None
        while time.monotonic() < deadline:
            current = store.get_operation(operation_id, owner_id=owner)
            phase = current.runtime.status if current.runtime else current.status
            if phase != previous:
                print("RUN " + current.kind + ": " + phase, flush=True)
                previous = phase
            if ready and current.runtime and current.runtime.status == "ready":
                return current
            if current.status in {"completed", "failed", "cancelled"}:
                if ready:
                    raise RuntimeError("runtime_not_ready:" + str((current.result or {}).get("errorCode")))
                return current
            time.sleep(0.3)
        raise RuntimeError("source_sync_smoke_timeout")

    def remote_python(source):
        outcome = provider.run(handle, "python3 -I -S -c " + shlex.quote(source), timeout_seconds=20)
        if outcome.exit_code != 0:
            raise RuntimeError("source_sync_remote_assertion_failed")
        return outcome

    try:
        report["repositoryHead"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
            capture_output=True, text=True, check=True).stdout.strip()
        paths = ["project_tools", "project_runtime_worker", "project_source_sync", "project_store", "e2b_workspace_provider"]
        report["implementationSha256"] = {name: hashlib.sha256(
            (ROOT / "slide-rule-python/services" / (name + ".py")).read_bytes()).hexdigest() for name in paths}
        files, version = load_project_template()
        report.update(templateVersion=version, templateTreeHash=build_manifest(files).treeHash)
        plan = {"planId": "source-sync-plan", "revision": 1, "reqId": "source-sync-approval",
            "planContent": "Run the fixed Vite template, edit its sources, observe HMR, recover the worker, and reject source drift."}
        state = V5SessionState(sessionId=session_id, ownerId=owner,
            goal={"text": "Internal live source synchronization smoke", "status": "clear"},
            controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
        checked("approved fixture is durably saved", persistence.save_session_record(state, server_write=True).get("ok"))
        approval = approved_reference(state)
        supervisor = worker()
        tools = ProjectTools(store, supervisor, owner)
        created = tool("project_create", {"approvalRef": approval})
        project_id = created["projectId"]
        seeded = tool("project_patch", {"approvalRef": approval, "expectedRevision": created["revision"],
            "changes": [{"path": "public/remove.txt", "content": "obsolete fixture", "expectedSha256": None}]})
        initial_revision = seeded["revision"]
        started = tool("project_start", {"approvalRef": approval, "expectedRevision": initial_revision, "idempotencyKey": "start"})
        parent_id = started["operationId"]
        initial = wait_operation(parent_id, ready=True, timeout=args.timeout)
        lease = store.get_lease(project_id, owner_id=owner)
        handle = WorkspaceHandle(lease.workspaceId, lease.sandboxId)
        report.update(projectId=project_id, operationId=parent_id, processId=initial.runtime.processId,
            initialRevision=initial_revision, runtimeId=initial.runtime.runtimeId)
        checked("fixed Vite starts with exact revision", provider.probe(handle, 5173, expected_revision=initial_revision))
        remote_python("from pathlib import Path; Path('business.db').write_bytes(b'\\x00fixture-data'); Path('node_modules/.whybuddy-keep').write_text('dependency sentinel')")

        # Node's real WebSocket observes Vite HMR in the private sandbox. This is
        # transport evidence and deliberately does not claim browser rendering.
        hmr = r'''
const fs = require('node:fs');
const path = '/tmp/whybuddy-source-sync-hmr.json';
const diagnostics = {node:process.version, websocket:typeof WebSocket, stage:'starting'};
function note(stage) {
  diagnostics.stage = stage;
  fs.writeFileSync('/tmp/whybuddy-source-sync-hmr-state.json', JSON.stringify(diagnostics));
}
note('fetch-client');
const timer = setTimeout(() => process.exit(2), 120000);
(async () => {
  const client = await (await fetch('http://127.0.0.1:5173/@vite/client')).text();
  await (await fetch('http://127.0.0.1:5173/src/style.css')).text();
  const token = client.match(/const wsToken\s*=\s*["']([^"']+)["']/)?.[1];
  diagnostics.tokenFound = Boolean(token);
  note('connect');
  if (!token) throw new Error('Vite HMR token missing');
  const ws = new WebSocket('ws://127.0.0.1:5173/?token=' + encodeURIComponent(token), 'vite-hmr');
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    note(message.type);
    if (message.type === 'connected') fs.writeFileSync(path, JSON.stringify({connected:true}));
    if (message.type === 'update') {
      fs.writeFileSync(path, JSON.stringify({connected:true, updates:message.updates.map(u => ({type:u.type,path:u.path}))}));
      clearTimeout(timer); ws.close();
    }
  };
  ws.onerror = () => { note('socket-error'); process.exit(3); };
})().catch(error => { diagnostics.error = error.name; note('exception'); process.exit(4); });
'''
        # The default E2B template currently has Node 20, whose built-in client
        # requires this flag. No additional project dependency is installed.
        hmr_process = provider.start_process(handle, "node --experimental-websocket -e " + shlex.quote(hmr), timeout_seconds=130)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            outcome = provider.run(handle, "test -f /tmp/whybuddy-source-sync-hmr.json", timeout_seconds=10)
            if outcome.exit_code == 0:
                break
            time.sleep(0.3)
        else:
            report["hmrDiagnostics"] = json.loads(remote_python(
                "from pathlib import Path; print(Path('/tmp/whybuddy-source-sync-hmr-state.json').read_text())").stdout)
            raise RuntimeError("vite_hmr_observer_did_not_connect")
        checked("real Vite HMR socket is connected", True)

        patch_arguments = {"approvalRef": approval, "expectedRevision": initial_revision, "changes": [
            {"path": "src/main.tsx", "expectedSha256": content_hash(files["src/main.tsx"]),
                "content": files["src/main.tsx"].replace("New Project", "Synchronized Project")},
            {"path": "src/style.css", "expectedSha256": content_hash(files["src/style.css"]),
                "content": files["src/style.css"] + "\n:root { --whybuddy-live-source: synchronized; }\n"},
            {"path": "public/remove.txt", "expectedSha256": content_hash("obsolete fixture"), "content": None},
            {"path": "public/sync.txt", "expectedSha256": None, "content": "added fixture"}]}
        bad = json.loads(json.dumps(patch_arguments))
        bad["changes"][0]["expectedSha256"] = "0" * 64
        tool("project_patch", bad, error="project_file_hash_conflict")
        tool("project_patch", {"approvalRef": approval, "expectedRevision": initial_revision,
            "changes": [{"path": "package.json", "content": "{}", "expectedSha256": content_hash(files["package.json"])}]},
            error="project_live_patch_requires_restart")
        submitted = tool("project_patch", patch_arguments)
        checked("live edit queues a durable child operation", submitted.get("kind") == "runtime.patch")
        done = wait_operation(submitted["operationId"])
        checked("worker synchronizes the saved revision", done.status == "completed" and done.result.get("synchronized")
            and done.result.get("sourcePublished"))
        revision = done.result["revision"]
        report["synchronizedRevision"] = revision
        current = wait_operation(parent_id, ready=True)
        checked("same sandbox process and runtime serve the new version", current.runtime.processId == initial.runtime.processId
            and current.runtime.runtimeId == initial.runtime.runtimeId and current.runtime.revision == revision
            and len(report["sandboxIds"]) == 1 and provider.probe(handle, 5173, expected_revision=revision))
        checked("original patch request is idempotent", tool("project_patch", patch_arguments)["operationId"] == done.operationId)
        remote_python("""import json, urllib.request
from pathlib import Path
assert 'Synchronized Project' in urllib.request.urlopen('http://127.0.0.1:5173/src/main.tsx').read().decode()
assert urllib.request.urlopen('http://127.0.0.1:5173/sync.txt').read() == b'added fixture'
assert not Path('public/remove.txt').exists()
assert Path('business.db').read_bytes() == b'\\x00fixture-data'
assert Path('node_modules/.whybuddy-keep').read_text() == 'dependency sentinel'
""")
        checked("Vite serves edits and additions while deletion preserves runtime data", True)
        deadline = time.monotonic() + 20
        while provider.is_process_running(handle, hmr_process.process_id) and time.monotonic() < deadline:
            time.sleep(0.3)
        hmr_result = provider.process_result(handle, hmr_process.process_id)
        observed = json.loads(remote_python("from pathlib import Path; print(Path('/tmp/whybuddy-source-sync-hmr.json').read_text())").stdout)
        report["hmr"] = observed
        checked("real Vite WebSocket reports the changed CSS module", hmr_result.exit_code == 0 and
            any(item["path"] == "/src/style.css" for item in observed.get("updates", [])))
        receipt = tool("project_status", {"operationId": done.operationId, "waitSeconds": 0})
        checked("status exposes synchronized source without claiming acceptance", receipt.get("revision") == revision
            and receipt.get("verification") == "not_run" and receipt.get("synchronized")
            and "sandboxId" not in json.dumps(receipt))
        checked("old source remains immutable and session follows the new revision",
            store.read_files(project_id, initial_revision, owner_id=owner)["src/main.tsx"] == files["src/main.tsx"]
            and sessions.load(session_id).payload["projectRevision"] == revision)

        supervisor.shutdown()
        supervisor = worker()
        tools = ProjectTools(store, supervisor, owner)
        resumed = wait_operation(parent_id, ready=True)
        checked("worker restart reconnects to the same sandbox and process",
            resumed.runtime.processId == initial.runtime.processId and resumed.runtime.revision == revision
            and len(report["sandboxIds"]) == 1 and provider.probe(handle, 5173, expected_revision=revision))

        # Deliberate out-of-band drift in an unchanged file must fail complete
        # source preflight. Durable proposed source survives remote cleanup.
        remote_python("from pathlib import Path; Path('src/counter.mjs').write_text('unexpected runtime writer')")
        current_source = store.read_files(project_id, owner_id=owner)["src/main.tsx"]
        rejected = tool("project_patch", {"approvalRef": approval, "expectedRevision": revision,
            "changes": [{"path": "src/main.tsx", "expectedSha256": content_hash(current_source),
                "content": current_source + "\n// persisted proposal after conflict\n"}]})
        failure = wait_operation(rejected["operationId"])
        parent_failure = wait_operation(parent_id)
        checked("unchanged-file drift fails synchronization and runtime readiness", failure.status == "failed"
            and failure.result.get("sourcePublished") and failure.result.get("synchronized") is False
            and parent_failure.status == "failed" and parent_failure.runtime.health == "unknown"
            and report["syncCalls"][-1].get("error") == "e2b_source_sync_conflict")
        checked("failed sync preserves recoverable proposed source",
            store.read_files(project_id, owner_id=owner)["src/main.tsx"].endswith("// persisted proposal after conflict\n"))
        checked("all source IO executes in the original worker", all(item["thread"] == "project-operation" for item in report["syncCalls"]))
        report["status"] = "passed"
    except Exception as exc:
        report.update(status="failed", error=str(exc).replace(key, "[redacted]")[:400]
            if isinstance(exc, (AssertionError, RuntimeError, WorkspaceProviderError)) else type(exc).__name__)
        print("FAIL " + report["error"], flush=True)
    finally:
        if supervisor is not None:
            try:
                if parent_id and store.get_operation(parent_id, owner_id=owner).status not in {"completed", "failed", "cancelled"}:
                    supervisor.cancel(parent_id, owner_id=owner)
                supervisor.shutdown(timeout=45)
            except Exception:
                report.update(status="failed", workerCleanup="pending")
        if project_id:
            workspace_id = "ws-" + project_id
            try:
                for remaining in provider.find_workspaces(workspace_id=workspace_id):
                    provider.destroy(remaining)
                empty = not provider.find_workspaces(workspace_id=workspace_id)
                report["cleanup"].append({"workspaceId": workspace_id, "confirmedEmpty": empty})
                if not empty:
                    report["status"] = "failed"
            except Exception:
                report["status"] = "failed"
                report["cleanup"].append({"workspaceId": workspace_id, "status": "pending"})
        persistence._blob_store = previous_blob_store
        sessions._engine.dispose()
        store.close()
        persist()
        print(f"Report: {report_path}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
