"""Bounded real E2B contract smoke. No credentials or user source are uploaded.

This checks runtime primitives, not private browser preview or business delivery.
Every sandbox is killed in finally; cleanup failure makes the smoke fail.
"""

import base64
import gzip
import json
import os
from pathlib import Path
import shlex
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))

from dotenv import dotenv_values
import httpx

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_runtime import ProjectRuntimeService
from services.project_store import ProjectStore
from services.workspace_provider import WorkspaceHandle, WorkspaceProviderError


def main():
    api_key = os.environ.get("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY")
    report = {"status": "running", "scope": "fixed-vite-runtime-primitives", "checks": [], "cleanup": []}
    path = ROOT / "artifacts" / "project-runtime" / f"{int(time.time())}-{uuid.uuid4().hex[:8]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not api_key:
        report["status"] = "blocked"
        report["error"] = "e2b_api_key_missing"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"BLOCKED e2b_api_key_missing; report: {path}")
        return 2
    provider = E2BWorkspaceProvider(api_key=api_key)
    handles = []
    store = ProjectStore.from_url(f"sqlite:///{path.with_suffix('.db').as_posix()}")

    def passed(name):
        report["checks"].append({"name": name, "status": "passed"})
        print(f"PASS {name}", flush=True)

    try:
        handle = provider.create(workspace_id="smoke-" + uuid.uuid4().hex, timeout_seconds=900)
        handles.append(handle)
        report["sandboxIds"] = [handle.sandbox_id]
        files = {
            "package.json": json.dumps({"name": "whybuddy-runtime-smoke", "private": True,
                "version": "1.0.0", "type": "module", "scripts": {"dev": "vite"},
                "dependencies": {"vite": "7.3.6", "react": "19.2.1", "react-dom": "19.2.1"}}),
            "index.html": '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
            "src/main.tsx": 'import React from "react"; import {createRoot} from "react-dom/client"; createRoot(document.getElementById("root")!).render(<button onClick={e => e.currentTarget.textContent = "Clicked"}>Runtime smoke</button>);',
        }
        provider.write_files(handle, files)
        symlink_setup = '''import os
outside = "/tmp/whybuddy-smoke-outside.txt"
with open(outside, "w") as stream: stream.write("outside-sentinel")
os.symlink(outside, "linked-file.txt")
os.symlink("/tmp", "linked-directory")
'''
        assert provider.run(handle, "python3 -c " + shlex.quote(symlink_setup)).exit_code == 0
        for name in ("linked-file.txt", "linked-directory/whybuddy-smoke-outside.txt"):
            try:
                provider.write_files(handle, {name: "must-not-write"})
            except WorkspaceProviderError:
                pass
            else:
                raise AssertionError("symlink_write_was_allowed")
        verify_outside = 'from pathlib import Path; assert Path("/tmp/whybuddy-smoke-outside.txt").read_text() == "outside-sentinel"'
        assert provider.run(handle, "python3 -c " + shlex.quote(verify_outside)).exit_code == 0
        passed("symlink_escape_refused_without_changing_target")
        installed = provider.run(handle, "npm install --package-lock-only --ignore-scripts", timeout_seconds=180)
        if installed.exit_code != 0:
            raise WorkspaceProviderError("smoke_lockfile_failed", result=installed)
        lock = provider.run(handle, "node -e " + shlex.quote(
            "process.stdout.write(require('node:zlib').gzipSync(require('node:fs').readFileSync('package-lock.json')).toString('base64'))"), timeout_seconds=20)
        if lock.exit_code != 0 or lock.output_truncated:
            raise WorkspaceProviderError("smoke_lockfile_read_failed", result=lock)
        lockfile = gzip.decompress(base64.b64decode(lock.stdout)).decode("utf-8")
        json.loads(lockfile)
        files["package-lock.json"] = lockfile
        passed("write_and_command_share_project_directory")
        failure = provider.run(handle, "node -e 'console.error(\"expected-smoke-failure\");process.exit(7)'", timeout_seconds=20)
        assert failure.exit_code == 7 and "expected-smoke-failure" in failure.stderr and failure.process_id is None
        passed("nonzero_exit_preserves_real_stderr_without_fake_pid")
        provider.destroy(handle)
        report["cleanup"].append({"sandboxId": handle.sandbox_id, "status": "destroyed"})
        handles.remove(handle)
        project = store.create_project("smoke-session-" + uuid.uuid4().hex, owner_id="smoke-owner",
            files=files, template_version="vite-smoke-1", plan_ref="internal-fixed-smoke")
        report["revision"] = project.currentRevision
        try:
            runtime, descriptor = ProjectRuntimeService(store, provider).start(project.projectId,
                owner_id="smoke-owner", lease_owner="smoke-worker", port=5181)
        finally:
            lease = store.get_lease(project.projectId, owner_id="smoke-owner")
            if lease and lease.sandboxId:
                handle = WorkspaceHandle(lease.workspaceId, lease.sandboxId)
                handles.append(handle)
        assert runtime.status == "ready" and runtime.health == "revision_verified"
        assert descriptor.entryUrl is None
        report["runtimeId"] = runtime.runtimeId
        report["processId"] = runtime.processId
        passed("fixed_vite_start_port_and_revision_health")
        fresh = E2BWorkspaceProvider(api_key=api_key)
        fresh.connect(handle)
        assert fresh.is_process_running(handle, runtime.processId)
        passed("new_provider_reconnects_from_persisted_sandbox_id")
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            response = client.get(fresh.preview_url(handle, runtime.port))
            assert response.status_code in (401, 403, 404), f"public_port_status_{response.status_code}"
            report["publicPortStatus"] = response.status_code
        passed("unauthenticated_public_port_denied")
        fresh.write_files(handle, {"src/main.tsx": files["src/main.tsx"].replace("Runtime smoke", "Updated smoke")})
        command = "node -e " + shlex.quote(f"fetch('http://127.0.0.1:{runtime.port}/src/main.tsx').then(r=>r.text()).then(t=>{{if(!t.includes('Updated smoke'))process.exit(1)}})")
        assert fresh.run(handle, command).exit_code == 0
        passed("vite_serves_source_update")
        fresh.stop(handle, runtime.processId)
        assert not fresh.is_process_running(handle, runtime.processId)
        assert not fresh.probe(handle, runtime.port, expected_revision=project.currentRevision)
        passed("stop_removes_npm_child_server_and_listener")
        report["status"] = "passed"
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc) if isinstance(exc, WorkspaceProviderError) else type(exc).__name__
        if isinstance(exc, WorkspaceProviderError) and exc.result:
            report["command"] = {"exitCode": exc.result.exit_code,
                "stdout": exc.result.stdout.replace(api_key, "[redacted]"),
                "stderr": exc.result.stderr.replace(api_key, "[redacted]")}
        print(f"FAIL {report['error']}", flush=True)
    finally:
        for handle in handles:
            try:
                provider.destroy(handle)
                report["cleanup"].append({"sandboxId": handle.sandbox_id, "status": "destroyed"})
            except Exception:
                report["cleanup"].append({"sandboxId": handle.sandbox_id, "status": "pending"})
                report["status"] = "failed"
        store.close()
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report: {path}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
