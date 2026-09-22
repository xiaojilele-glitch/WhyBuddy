"""Production build execution, process ownership and receipts use the real SQL owner.

Remote process IO is simulated with distinct PIDs; cloud smoke executes the real
provider. These tests cannot pass by relabelling a Vite development preview.
"""
from types import SimpleNamespace

import pytest

from test_project_browser_verification import install_browser, verify, verdict
from test_project_live_source_sync import live
from test_project_runtime_worker import eventually
from project_actor_support import project_actor
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.workspace_provider import WorkspaceProviderError
from test_project_runtime_patch_store import runtime


def test_build_receipt_matches_source_lockfile_and_served_output(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    old_pid = live.parent().runtime.processId
    child = verify(live)
    record = verdict(live, child).verification
    revision = live.store.get_revision(record.projectId, record.revision, owner_id="alice")
    proof = record.build
    assert proof.status == record.status == "passed"
    assert proof.revision == revision.revision and proof.treeHash == revision.treeHash
    assert proof.lockfileHash == next(item.sha256 for item in revision.manifest.files if item.path == "package-lock.json")
    assert proof.installExitCode == proof.buildExitCode == 0
    assert proof.outputHash == live.provider.build_output_hash and proof.outputFileCount == 2 and proof.outputBytes == 256
    assert proof.serverKind == "static-dist" and len(browser.calls) == 1
    assert live.provider.build_server_config["verification_id"] == child
    assert live.provider.build_server_config["suite_version"] == "react-vite-counter@1"
    assert live.provider.commands[-3:-1] == ["npm ci --ignore-scripts", "npm run build"]
    assert live.provider.processes[old_pid] == "stopped"
    assert live.parent().runtime.processId != old_pid and live.provider.active_server_mode == "dev"
    assert child in live.provider.build_cleaned and "verificationBuild" not in live.parent().result


@pytest.mark.parametrize("phase", ["install", "build"])
def test_nonzero_real_command_exit_fails_without_browser_and_restores_dev(live, monkeypatch, phase):
    browser, _ = install_browser(live, monkeypatch)
    setattr(live.provider, phase + "_code", 23)
    child = verify(live)
    record = verdict(live, child).verification
    assert record.status == record.build.status == "failed" and not browser.calls
    assert getattr(record.build, phase + "ExitCode") == 23
    assert record.build.outputHash is None and not record.assertions and not record.artifactRefs
    assert live.provider.active_server_mode == "dev" and live.parent().runtime.status == "ready"
    assert live.parent().status == "running" and child in live.provider.build_cleaned
    assert ("npm run build" in live.provider.commands) is (phase == "build")


def test_output_changed_during_browser_cannot_pass_even_with_same_source(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    actual = browser.run
    def corrupt(**kwargs):
        result = actual(**kwargs)
        live.provider.build_output_hash = "f" * 64
        return result
    monkeypatch.setattr(browser, "run", corrupt)
    child = verify(live)
    record = verdict(live, child).verification
    assert record.status == "blocked" and not record.assertions and not record.artifactRefs
    assert live.parent().runtime.status == "ready" and live.provider.active_server_mode == "dev"


@pytest.mark.parametrize("phase", ["install", "build"])
def test_cancel_during_command_stops_actual_pid_then_restores_dev(live, monkeypatch, phase):
    browser, _ = install_browser(live, monkeypatch)
    setattr(live.provider, phase + "_running", True)
    child = verify(live)
    eventually(lambda: any(mode == phase for mode in live.provider.processes.values()))
    pid = next(pid for pid, mode in live.provider.processes.items() if mode == phase)
    live.supervisor.cancel(child, owner_id="alice")
    assert verdict(live, child).verification.status == "cancelled"
    assert live.provider.processes[pid] == "stopped" and not browser.calls
    assert live.parent().status == "running" and live.provider.active_server_mode == "dev"
    assert child in live.provider.build_cleaned


@pytest.mark.parametrize("phase", ["install", "build"])
def test_restart_during_command_reconciles_without_replaying_install_or_build(live, monkeypatch, phase):
    browser, _ = install_browser(live, monkeypatch)
    setattr(live.provider, phase + "_running", True)
    child = verify(live)
    eventually(lambda: any(mode == phase for mode in live.provider.processes.values()))
    pid = next(pid for pid, mode in live.provider.processes.items() if mode == phase)
    live.supervisor.shutdown()
    before = list(live.provider.commands)
    assert live.parent().status == "interrupted" and live.provider.processes[pid] == "stopped"
    second = ProjectRuntimeSupervisor(live.store, lambda: live.provider,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=90, idle_seconds=60)
    install_browser(SimpleNamespace(supervisor=second), monkeypatch, browser)
    second.start()
    try:
        saved = verdict(live, child).verification
        assert saved.status == "blocked"
        if phase == "build":
            assert saved.build.installExitCode == 0 and saved.build.buildExitCode is None
        eventually(lambda: live.parent().runtime.status == "ready")
        for command in ("npm ci --ignore-scripts", "npm run build"):
            assert live.provider.commands.count(command) == before.count(command)
        assert not browser.calls and live.provider.active_server_mode == "dev" and live.provider.created == 1
        second.cancel(live.started["operationId"], owner_id="alice")
        eventually(lambda: live.parent().status == "cancelled")
    finally:
        second.shutdown()


def test_unknown_process_dispatch_destroys_workspace_instead_of_replaying(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    actual = live.provider.start_process
    attempts = []
    def lose_pid(handle, command, **kwargs):
        result = actual(handle, command, **kwargs)
        if command == "npm run build":
            attempts.append(result.process_id)
            raise WorkspaceProviderError("injected_lost_dispatch_reply")
        return result
    monkeypatch.setattr(live.provider, "start_process", lose_pid)
    child = verify(live)
    assert verdict(live, child).verification.status == "blocked"
    eventually(lambda: live.parent().status == "failed")
    assert not browser.calls and len(attempts) == 1 and not live.provider.handles
    assert live.provider.commands.count("npm run build") == 1


def test_stopped_dev_database_is_checkpointed_before_its_pid_binding_is_removed(runtime):
    from services.project_application_data import ProjectApplicationDataStore
    from services.project_verification_build import _drop_process
    from test_project_application_data import database
    rt = runtime
    payload = database("written just before verification")
    running = {rt.parent.runtime.processId}
    heartbeat = SimpleNamespace(lease=rt.lease, check=lambda: None)
    def renew(**kwargs):
        heartbeat.lease = rt.store.renew_lease(rt.project.projectId, owner_id="alice",
            lease_owner=rt.lease.leaseOwner, generation=rt.lease.generation, **kwargs)
    heartbeat.renew = renew
    def read(handle):
        assert not running
        assert heartbeat.lease.processRefs["server"] == rt.parent.runtime.processId
        return payload
    provider = SimpleNamespace(is_process_running=lambda handle, pid: pid in running,
        stop=lambda handle, pid: running.discard(pid), read_application_data=read)
    task = SimpleNamespace(store=rt.store, owner_id="alice", original=rt.parent,
        operation_id=rt.parent.operationId, runtime=rt.parent.runtime, handle=object(),
        heartbeat=heartbeat, lease=rt.lease, provider=provider, result={}, _application_data_enabled=True)
    _drop_process(task, "server", checkpoint=True)
    saved = ProjectApplicationDataStore(rt.store).load(rt.project.projectId, owner_id="alice")
    assert saved[1] == payload and saved[0]["version"] == 1
    assert task.runtime.processId is None and "server" not in heartbeat.lease.processRefs
