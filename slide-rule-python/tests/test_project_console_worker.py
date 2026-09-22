"""Install / exec must go through start_console when the provider has a PTY.

2026-09-15: reconstructing `$ cmd` + runtime.log is a log viewer. The live
path types into bash. These tests call the real worker. A fake that only
implements start_process must keep working (existing suites). A fake that
implements start_console must be used for npm ci / npm run, and vite must
still use start_process.
"""

from project_actor_support import project_actor  # noqa: F401 — fixture for imported setups

from services.workspace_provider import ProcessLogChunk, ProcessResult
from test_project_command_worker import command_setup, submit
from test_project_runtime_worker import Provider, eventually, setup, state


class ConsoleProvider(Provider):
    def __init__(self):
        super().__init__()
        self.console_commands = []
        self.console_running = {"90": False, "91": False}
        self.console_output = {
            "90": "user@sb:/home/user/workspace$ npm ci --ignore-scripts\nadded 21 packages\n",
            "91": "user@sb:/home/user/workspace$ npm run check\nactual command output\n",
        }

    def start_console(self, handle, command, *, timeout_seconds=900):
        self.console_commands.append(command)
        pid = "90" if command.startswith("npm ci") else "91"
        return ProcessResult(pid)

    def is_process_running(self, handle, pid):
        if pid in self.console_output:
            return handle.sandbox_id in self.handles and self.console_running.get(pid, False)
        return super().is_process_running(handle, pid)

    def process_result(self, handle, pid):
        if pid in self.console_output:
            return ProcessResult(pid, exit_code=0)
        return super().process_result(handle, pid)

    def read_console(self, handle, pid, *, offset=0):
        content = self.console_output[pid].encode()
        return ProcessLogChunk(content[offset:].decode(), len(content))

    def read_process_logs(self, handle, pid, *, offset=0):
        if pid in self.console_output:
            raise AssertionError("console pid must not use process log files")
        return super().read_process_logs(handle, pid, offset=offset)


def test_exec_types_install_and_command_into_console_not_start_process(command_setup):
    store, project, _, worker, _ = command_setup
    provider = ConsoleProvider()
    worker.provider_factory = lambda: provider
    operation = submit(worker, project)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert provider.console_commands == ["npm ci --ignore-scripts", "npm run check"]
    assert provider.commands == []
    events = store.list_events(operation.operationId, owner_id="alice")
    console = [e for e in events if e.type == "runtime.console"]
    assert console
    assert any("npm run check" in e.payload["data"] for e in console)
    assert not any(e.type == "runtime.log" for e in events)


def test_runtime_start_types_install_but_keeps_vite_on_start_process(setup):
    store, project, _, make_worker, _ = setup
    provider = ConsoleProvider()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    operation = submit_start(worker, project)
    ready = eventually(lambda: state(store, operation, "ready"))
    assert ready.status == "running"
    assert provider.console_commands == ["npm ci --ignore-scripts"]
    assert any("npm run dev" in command for command in provider.commands)
    assert not any(command.startswith("npm ci") for command in provider.commands)
    events = store.list_events(operation.operationId, owner_id="alice")
    assert any(e.type == "runtime.console" and "npm ci" in e.payload["data"] for e in events)
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(store, operation, "stopped"))


def test_process_result_text_is_stored_when_the_console_buffer_is_empty(command_setup):
    """反向：read_console 是空的时，不许把 process_result 里的 stdout 丢掉。

    2026-09-22 FFR6 的回执就是 exitCode 有、excerpt 空、logs []。
    删掉 _persist_process_output，这条红。
    """
    store, project, _, worker, _ = command_setup

    class ResultOnly(ConsoleProvider):
        def read_console(self, handle, pid, *, offset=0):
            return ProcessLogChunk("", offset)

        def process_result(self, handle, pid):
            if pid in self.console_output:
                return ProcessResult(pid, stdout="PING123\n", stderr="Traceback: boom\n", exit_code=0)
            return super().process_result(handle, pid)

    provider = ResultOnly()
    worker.provider_factory = lambda: provider
    operation = submit(worker, project)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    events = store.list_events(operation.operationId, owner_id="alice")
    text = "".join(
        str((e.payload or {}).get("data") or (e.payload or {}).get("text") or "")
        for e in events if e.type in {"runtime.console", "runtime.log"}
    )
    assert "PING123" in text
    assert "Traceback: boom" in text


def test_provider_without_console_keeps_start_process_path(command_setup):
    """反向：没有 start_console 时不许空转，旧 provider 仍走进程文件。"""
    store, project, provider, worker, _ = command_setup
    assert not hasattr(provider, "start_console")
    operation = submit(worker, project)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed"
    assert provider.commands == ["npm ci --ignore-scripts", "npm run check"]
    events = store.list_events(operation.operationId, owner_id="alice")
    assert any(e.type == "runtime.log" for e in events)
    assert not any(e.type == "runtime.console" for e in events)


def submit_start(worker, project, key="request-1"):
    return worker.submit(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key)
