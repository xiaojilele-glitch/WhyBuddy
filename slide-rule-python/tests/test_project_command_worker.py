"""Actual durable dispatch and recovery for fixed project commands."""

import threading
import time

import pytest
from project_actor_support import project_actor

from models.v5_state import V5SessionState
from services import persistence
from services.project_authority import approved_reference
from services.project_runtime_worker import ProjectRuntimeSupervisor, authorize_operation
from services.project_store import ProjectConflict, ProjectStore
from services.workspace_provider import ProcessLogChunk, ProcessResult, WorkspaceProviderError
from test_project_runtime_worker import Provider, eventually, setup, state


class CommandProvider(Provider):
    command_code = 0
    command_running = False
    missing_command_pid = False

    def start_process(self, handle, command, **kwargs):
        if command.startswith("npm ci"):
            return super().start_process(handle, command, **kwargs)
        self.commands.append(command)
        return ProcessResult(None if self.missing_command_pid else "44")

    def process_result(self, handle, pid):
        if pid == "44":
            return ProcessResult(pid, exit_code=self.command_code)
        return super().process_result(handle, pid)

    def is_process_running(self, handle, pid):
        if pid == "44":
            return handle.sandbox_id in self.handles and self.command_running
        return super().is_process_running(handle, pid)

    def read_process_logs(self, handle, pid, *, offset=0):
        if pid == "44":
            content = "actual command output\n".encode()
            return ProcessLogChunk(content[offset:].decode(), len(content))
        return super().read_process_logs(handle, pid, offset=offset)


@pytest.fixture
def command_setup(setup):
    store, project, _, make_worker, url = setup
    provider = CommandProvider()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    return store, project, provider, worker, url


def submit(worker, project, *, command="check", key="command-1"):
    return worker.submit_command(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key, command=command)


@pytest.mark.parametrize("command", ["check", "build", "test"])
def test_command_runs_fixed_script_returns_real_result_and_reclaims_workspace(command_setup, command):
    store, project, provider, worker, _ = command_setup
    operation = submit(worker, project, command=command)
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.kind == "runtime.exec" and finished.status == "completed"
    assert finished.result["command"] == command and finished.result["exitCode"] == 0
    assert finished.result["errorCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", f"npm run {command}"]
    assert not provider.handles and provider.created == 1
    assert submit(worker, project, command=command).operationId == operation.operationId
    assert any(e.type == "runtime.log" and e.payload["text"] == "actual command output\n"
        for e in store.list_events(operation.operationId, owner_id="alice"))
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").sandboxId is None)


@pytest.mark.parametrize("exit_code,error", [(9, "project_command_failed"), (None, "project_command_result_unknown")])
def test_nonzero_or_unknown_exit_never_reports_success(command_setup, exit_code, error):
    store, project, provider, worker, _ = command_setup
    provider.command_code = exit_code
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.status == "failed" and failed.result["errorCode"] == error
    assert failed.result["exitCode"] == exit_code and failed.result["command"] == "check"
    assert not provider.handles


@pytest.mark.parametrize("command", ["", "lint", "build --if-present", "check; exit 0", None, []])
def test_command_allowlist_rejects_arbitrary_dispatch(command_setup, command):
    _, project, provider, worker, _ = command_setup
    with pytest.raises(ValueError, match="invalid_project_command"):
        submit(worker, project, command=command)
    assert not provider.created and not provider.commands


def test_sandbox_script_runs_the_raw_line_not_npm_run_shell(command_setup):
    store, project, provider, worker, _ = command_setup
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="ls-1", command="shell", script="ls src")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["command"] == "ls src"
    assert provider.commands == ["npm ci --ignore-scripts", "ls src"]


def test_pty_stdin_reaches_the_running_command(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.command_running = True
    provider.stdin = []

    def write_console(handle, pid, data, *, press_enter=True):
        provider.stdin.append((pid, data, press_enter))

    provider.write_console = write_console
    operation = submit(worker, project)
    eventually(lambda: provider.commands[-1:] == ["npm run check"])
    worker.enqueue_stdin(operation.operationId, owner_id="alice", text="yes", press_enter=True)
    eventually(lambda: provider.stdin == [("44", "yes", True)])
    provider.command_running = False
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed"


def test_reusing_idempotency_key_for_a_different_command_conflicts(command_setup):
    _, project, provider, worker, _ = command_setup
    provider.command_running = True
    submit(worker, project)
    with pytest.raises(ProjectConflict, match="idempotency"):
        submit(worker, project, command="build")


@pytest.mark.parametrize("phase", ["installing", "executing"])
def test_command_restart_reconnects_saved_pid_without_dispatching_twice(command_setup, phase):
    store, project, provider, first, url = command_setup
    provider.install_running = phase == "installing"
    provider.command_running = True
    operation = submit(first, project)
    eventually(lambda: state(store, operation, phase))
    first.shutdown()
    previous = list(provider.commands)
    assert store.get_operation(operation.operationId, owner_id="alice").result["phase"] == phase
    reopened = ProjectStore.from_url(url)
    second = ProjectRuntimeSupervisor(reopened, lambda: provider, authorizer=lambda *args: None,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=30, idle_seconds=20)
    try:
        second.start()
        eventually(lambda: state(reopened, operation, phase))
        assert provider.commands == previous and provider.created == 1
        provider.install_running = False
        eventually(lambda: state(reopened, operation, "executing"))
        provider.command_running = False
        finished = eventually(lambda: state(reopened, operation, "stopped"))
        assert finished.status == "completed" and finished.result["exitCode"] == 0
        assert provider.commands == ["npm ci --ignore-scripts", "npm run check"]
        assert not provider.handles
    finally:
        second.shutdown()
        reopened.close()


@pytest.mark.parametrize("phase", ["installing", "executing"])
def test_command_cancellation_stops_remote_work_without_fabricating_an_exit(command_setup, phase):
    store, project, provider, worker, _ = command_setup
    provider.install_running = phase == "installing"
    provider.command_running = True
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, phase))
    worker.cancel(operation.operationId, owner_id="alice")
    cancelled = eventually(lambda: state(store, operation, "stopped"))
    assert cancelled.status == "cancelled" and cancelled.result["exitCode"] is None
    assert cancelled.result["errorCode"] == "user_cancelled" and not provider.handles


def test_missing_command_pid_is_failed_and_workspace_is_destroyed(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.missing_command_pid = True
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "project_process_identity_missing"
    assert failed.result["exitCode"] is None and not provider.handles


def test_unknown_command_dispatch_is_never_replayed(command_setup, monkeypatch):
    store, project, provider, worker, _ = command_setup
    original = store.renew_lease
    interrupted = threading.Event()

    def lose_command_identity(*args, **kwargs):
        if kwargs.get("process_refs", {}).get("command") and not interrupted.is_set():
            interrupted.set()
            raise ProjectConflict("crash_after_command_dispatch")
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "renew_lease", lose_command_identity)
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "runtime_dispatch_uncertain"
    assert failed.result["exitCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", "npm run check"] and not provider.handles


def test_successful_command_waits_for_cleanup_before_reporting_completion(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.cleanup_error = True
    operation = submit(worker, project)
    pending = eventually(lambda: state(store, operation, "reconciling"))
    assert pending.status == "interrupted" and pending.result["exitCode"] == 0
    assert pending.result["errorCode"] == "project_cleanup_pending" and provider.handles
    provider.cleanup_error = False
    completed = eventually(lambda: state(store, operation, "stopped"))
    assert completed.status == "completed" and completed.result["errorCode"] is None
    assert provider.commands == ["npm ci --ignore-scripts", "npm run check"] and not provider.handles


def test_command_budget_expiry_is_a_failure_not_a_completed_build(command_setup):
    store, project, provider, worker, _ = command_setup
    worker.lifetime_seconds = 1
    provider.command_running = True
    operation = submit(worker, project)
    expired = eventually(lambda: state(store, operation, "expired"))
    assert expired.status == "failed" and expired.result["exitCode"] is None
    assert expired.result["errorCode"] == "runtime_budget_exhausted" and not provider.handles


def test_provider_missing_completion_record_is_failure_with_no_invented_exit(command_setup, monkeypatch):
    store, project, provider, worker, _ = command_setup
    original = provider.process_result

    def missing_result(handle, pid):
        if pid == "44":
            raise WorkspaceProviderError("e2b_process_result_unavailable")
        return original(handle, pid)

    monkeypatch.setattr(provider, "process_result", missing_result)
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["exitCode"] is None
    assert failed.result["errorCode"] == "e2b_process_result_unavailable" and not provider.handles


def test_install_failure_is_reported_separately_from_command_result(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.install_code = 13
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["installExitCode"] == 13 and failed.result["exitCode"] is None
    assert failed.result["command"] == "check" and failed.result["errorCode"] == "project_dependency_install_failed"
    assert provider.commands == ["npm ci --ignore-scripts"] and not provider.handles


def test_plan_revocation_during_install_prevents_command_dispatch(command_setup):
    store, project, provider, worker, _ = command_setup
    provider.install_running = True
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "installing"))
    def revoked(*args):
        raise PermissionError("project_plan_approval_required")
    worker.authorizer = revoked
    provider.install_running = False
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["errorCode"] == "project_plan_approval_required"
    assert provider.commands == ["npm ci --ignore-scripts"] and not provider.handles


@pytest.mark.parametrize("approved", [True, False])
def test_default_command_authority_reads_real_persisted_session(command_setup, tmp_path, monkeypatch, approved):
    store, _, provider, worker, _ = command_setup
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: None)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "durable-session.json"))
    plan = {"planId": "command-plan", "revision": 1, "planContent": "Run project checks", "reqId": "req-1"}
    kinds = ("plan_written", "plan_approval", "plan_approved") if approved else ("plan_written", "plan_approval")
    session = V5SessionState(sessionId="durable-command", ownerId="alice", goal={"text": "Check project"},
        controlTranscript=[{**plan, "kind": kind} for kind in kinds])
    assert persistence.save_session_record(session, server_write=True)["ok"]
    ref = approved_reference(session)
    project = store.create_project(session.sessionId, owner_id="alice", files={"package.json": "{}", "package-lock.json": "{}"},
        template_version="fixed-1", plan_ref=ref)
    worker.authorizer = authorize_operation
    args = dict(owner_id="alice", expected_revision=project.currentRevision, approval_ref=ref, idempotency_key="durable")
    if approved:
        from services.project_creation import sync_session_project
        sync_session_project(store, session.sessionId, owner_id="alice", approval_ref=ref)
        operation = worker.submit_command(project.projectId, **args)
        assert eventually(lambda: state(store, operation, "stopped")).status == "completed"
    else:
        with pytest.raises(PermissionError, match="project_plan_approval_required"):
            worker.submit_command(project.projectId, **args)
        assert not provider.created


def test_queued_stale_revision_fails_and_releases_lease_instead_of_retrying_forever(command_setup, tmp_path, monkeypatch):
    from services.project_creation import create_session_project
    store, _, provider, worker, _ = command_setup
    worker.shutdown()
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: None)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "stale-session.json"))
    plan = {"planId": "p", "revision": 1, "planContent": "Check source", "reqId": "req"}
    session = V5SessionState(sessionId="stale-command", ownerId="alice", goal={"text": "Check source"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    persistence.save_session_record(session, server_write=True)
    ref = approved_reference(session)
    project = create_session_project(store, session.sessionId, owner_id="alice", approval_ref=ref)
    old = store.create_operation(project.projectId, owner_id="alice", kind="runtime.exec", idempotency_key="stale",
        expected_revision=project.currentRevision, approval_ref=ref, input={"command": "check"})
    files = store.read_files(project.projectId, owner_id="alice")
    files["src/main.tsx"] += "\n// next revision\n"
    latest = store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        files=files, template_version="fixed-1", plan_ref=ref)
    worker.authorizer = authorize_operation
    worker.start()
    failed = eventually(lambda: state(store, old, "failed"))
    assert failed.status == "failed" and failed.result["errorCode"] == "project_revision_conflict"
    assert not provider.created
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())
    next_operation = worker.submit_command(project.projectId, owner_id="alice", expected_revision=latest.revision,
        approval_ref=ref, idempotency_key="current")
    assert eventually(lambda: state(store, next_operation, "stopped")).status == "completed"


def test_office_workspace_bash_skips_npm_ci(command_setup):
    """真机 sr-20260921102816-KWETH78PZ0：办公工作区 bash 被锁文件闸打死。

    必须跑 worker，不许重抄 skip 条件。npm ci 出现 = 又接到 Vite 开箱上。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-bash", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="py-ver", command="shell",
        script="python3 --version")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert finished.result["command"] == "python3 --version"
    assert provider.commands == ["python3 --version"]
    assert provider.created == 1


def test_office_readme_tree_skips_npm_even_if_revision_says_vite(command_setup):
    """⚠ 2026-09-21 13ME64TF8Z：树是 README，revision 不是 workspace-1，
    echo hello 仍 project_lockfile_or_reserved_path_invalid。
    """
    from services.deliverable_kind import WORKSPACE_README

    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-vite-rev", owner_id="alice",
        files={"README.md": WORKSPACE_README,
               "scripts/generate_kickoff_pptx.py": "print(1)\n"},
        template_version="whybuddy-react-vite-1", plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="hello", command="shell",
        script="echo hello")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert provider.commands == ["echo hello"]
    assert "npm ci --ignore-scripts" not in provider.commands


def test_readme_only_bash_skips_npm_when_skip_helper_returns_false(command_setup, monkeypatch):
    """⚠ 2026-09-22 Z8NPKNM14C：助手若返回 False，只有 README 的 bash 仍不许 lockfile。

    把 worker 里 `bare → skip_install = True` 删掉，本条变红。
    """
    import services.project_runtime_worker as worker_mod
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files

    monkeypatch.setattr(worker_mod, "skip_vite_dependency_install", lambda **_k: False)
    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-office-skip-false", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="skip-false", command="shell",
        script="echo hello")
    finished = eventually(lambda: state(store, operation, "stopped"))
    assert finished.status == "completed" and finished.result["exitCode"] == 0
    assert provider.commands == ["echo hello"]
    assert "npm ci --ignore-scripts" not in provider.commands


def test_vite_exec_without_lockfile_still_fails(command_setup):
    """反向：网页工程缺锁文件仍 fail-closed。把 skip 写成「没有 lockfile 就跳过」必须红。"""
    store, _, provider, worker, _ = command_setup
    project = store.create_project(
        "session-vite-nolock", owner_id="alice",
        files={"package.json": "{}"}, template_version="whybuddy-react-vite-1",
        plan_ref="plan-1")
    operation = worker.submit_command(
        project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="no-lock", command="shell",
        script="python3 --version")
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.result["errorCode"] == "project_lockfile_or_reserved_path_invalid"
    assert provider.created == 0 and provider.commands == []


def test_office_bash_reuses_one_sandbox_and_names_the_pptx(command_setup):
    """⚠ 2026-09-22 BABCJGGB44：每条 bash 拆沙盒，装上的库和 pptx 下一条就没了，
    模型只好把文件 base64 塞进日志。

    第二条办公命令不得再 create。删掉 reused / keepSandbox，created 变成 2，本条变红。
    Vite 工程仍拆掉，见 test_command_runs_fixed_script_returns_real_result_and_reclaims_workspace。
    """
    from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
    from services.project_tools import _command_pointer, operation_snapshot

    store, _, provider, worker, _ = command_setup
    pptx = b"PK\x03\x04" + b"kickoff"
    provider.collect_office_files = lambda _handle: [{"path": "kickoff.pptx", "data": pptx}]
    project = store.create_project(
        "session-office-reuse", owner_id="alice",
        files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")

    def office_bash(key, script):
        return worker.submit_command(
            project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            approval_ref="plan-1", idempotency_key=key, command="shell", script=script)

    first = office_bash("build-deck", "python3 build_deck.py")
    built = eventually(lambda: state(store, first, "stopped"))
    assert built.status == "completed" and built.result["exitCode"] == 0
    assert provider.created == 1 and "sandbox-1" in provider.handles
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-1"
    assert built.result["officeFiles"] == ["kickoff.pptx"]
    snap = operation_snapshot(store.snapshot_operation(first.operationId, owner_id="alice"))
    assert snap["officeFiles"] == ["kickoff.pptx"]
    receipt = _command_pointer(snap, "saved kickoff.pptx")
    assert "kickoff.pptx" in receipt["hint"] and "base64" in receipt["hint"]
    assert "npm ci --ignore-scripts" not in provider.commands
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").expiresAt <= time.time())

    second = office_bash("import-pptx", "python3 -c \"import pptx\"")
    again = eventually(lambda: state(store, second, "stopped"))
    assert again.status == "completed" and again.result["exitCode"] == 0
    assert provider.created == 1 and "sandbox-1" in provider.handles
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sandbox-1"
    assert provider.commands == ["python3 build_deck.py", 'python3 -c "import pptx"']
