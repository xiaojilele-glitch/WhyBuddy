"""Bounded real provider recovery checks; always destroy created sandboxes."""

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

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.workspace_provider import WorkspaceProviderError


def main():
    api_key = os.environ.get("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY")
    report = {"scope": "managed-process-provider-recovery", "status": "running", "checks": [], "cleanup": []}
    path = ROOT / "artifacts" / "project-runtime" / f"process-{int(time.time())}-{uuid.uuid4().hex[:8]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    handles = []
    provider = None

    def passed(name):
        report["checks"].append({"name": name, "status": "passed"})
        print("PASS " + name, flush=True)

    def wait_stopped(active, handle, pid):
        deadline = time.monotonic() + 30
        while active.is_process_running(handle, pid):
            if time.monotonic() >= deadline:
                raise AssertionError("process_did_not_finish")
            time.sleep(0.2)

    try:
        if not api_key:
            raise WorkspaceProviderError("e2b_api_key_missing")
        provider = E2BWorkspaceProvider(api_key=api_key)
        workspace_id = "process-smoke-" + uuid.uuid4().hex
        handle = provider.create(workspace_id=workspace_id, timeout_seconds=180)
        handles.append(handle)
        report["sandboxIds"] = [handle.sandbox_id]
        provider.write_files(handle, {"smoke.txt": "bounded provider smoke"})
        fresh = E2BWorkspaceProvider(api_key=api_key)
        found = fresh.find_workspaces(workspace_id=workspace_id)
        assert found == [handle]
        assert fresh.find_workspaces(workspace_id=workspace_id + "-absent") == []
        passed("fresh_provider_discovers_only_exact_workspace")

        for code in (0, 7):
            command = f"printf 'exit-{code}-stdout\\n'; printf 'exit-{code}-stderr\\n' >&2; exit {code}"
            process = provider.start_process(handle, command, timeout_seconds=30)
            wait_stopped(provider, handle, process.process_id)
            fresh = E2BWorkspaceProvider(api_key=api_key)
            result = fresh.process_result(handle, process.process_id)
            assert result.exit_code == code
            logs = fresh.read_process_logs(handle, process.process_id)
            assert f"exit-{code}-stdout" in logs.text and f"exit-{code}-stderr" in logs.text
            assert fresh.read_process_logs(handle, process.process_id, offset=logs.next_offset).text == ""
            passed(f"completed_exit_{code}_and_logs_survive_provider_recreation")

        process = provider.start_process(handle, "printf 'first\\n'; sleep 3; printf 'second\\n'; sleep 60 & wait", timeout_seconds=90)
        deadline = time.monotonic() + 15
        cursor = 0
        text = ""
        chunks = []
        while "second" not in text:
            chunk = provider.read_process_logs(handle, process.process_id, offset=cursor)
            assert chunk.next_offset >= cursor
            if chunk.text:
                chunks.append(chunk.text)
                text += chunk.text
            cursor = chunk.next_offset
            if time.monotonic() >= deadline:
                raise AssertionError("incremental_logs_missing")
            time.sleep(0.2)
        assert len(chunks) >= 2 and text == "first\nsecond\n"
        passed("incremental_log_cursors_do_not_repeat_output")
        fresh = E2BWorkspaceProvider(api_key=api_key)
        fresh.stop(handle, process.process_id)
        assert not fresh.is_process_running(handle, process.process_id)
        passed("fresh_provider_stops_wrapper_and_descendants")
        try:
            fresh.process_result(handle, process.process_id)
        except WorkspaceProviderError as exc:
            assert str(exc) == "e2b_process_result_unavailable"
        else:
            raise AssertionError("killed_process_fabricated_completion")
        passed("interrupted_wrapper_does_not_invent_exit_result")

        payload = "x" * 8191 + "\u4e2d\u6587" + "z"
        process = provider.start_process(handle, "python3 -c " + shlex.quote("import sys; sys.stdout.write(" + ascii(payload) + ")"), timeout_seconds=30)
        wait_stopped(provider, handle, process.process_id)
        first = provider.read_process_logs(handle, process.process_id)
        second = provider.read_process_logs(handle, process.process_id, offset=first.next_offset)
        assert first.next_offset == 8191 and first.text + second.text == payload
        passed("unicode_log_boundary_preserves_text_and_byte_cursor")

        process = provider.start_process(handle, "python3 -c 'import sys; sys.stdout.write(\"x\" * (1024 * 1024 + 10000))'", timeout_seconds=30)
        wait_stopped(provider, handle, process.process_id)
        result = provider.process_result(handle, process.process_id)
        assert result.exit_code == 0 and result.output_truncated and len(result.stdout) == 16384
        tail = provider.read_process_logs(handle, process.process_id, offset=1024 * 1024 - 4)
        assert tail.text == "xxxx" and tail.next_offset == 1024 * 1024 and tail.truncated
        passed("bounded_log_drain_allows_large_output_to_complete")
        report["status"] = "passed"
    except Exception as exc:
        report["status"] = "blocked" if str(exc) == "e2b_api_key_missing" else "failed"
        report["error"] = str(exc) if isinstance(exc, (WorkspaceProviderError, AssertionError)) else type(exc).__name__
        if isinstance(exc, WorkspaceProviderError) and exc.result:
            report["command"] = {"exitCode": exc.result.exit_code,
                "stdout": exc.result.stdout.replace(api_key or "[missing]", "[redacted]"),
                "stderr": exc.result.stderr.replace(api_key or "[missing]", "[redacted]")}
        print("FAIL " + report["error"], flush=True)
    finally:
        for handle in handles:
            try:
                provider.destroy(handle)
                report["cleanup"].append({"sandboxId": handle.sandbox_id, "status": "destroyed"})
            except Exception:
                report["status"] = "failed"
                report["cleanup"].append({"sandboxId": handle.sandbox_id, "status": "destroy_failed"})
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print("Report: " + str(path), flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
