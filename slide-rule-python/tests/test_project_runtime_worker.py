"""Run the real scanner against durable SQL, including restart and dispatch gaps.

The fake provider represents remote state shared across worker instances. It
does not execute generated code; the E2B smoke supplies that separate evidence.
"""

import threading
import time

import pytest
from project_actor_support import project_actor

from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore
from services.workspace_provider import ProcessLogChunk, ProcessResult, WorkspaceHandle, WorkspaceProviderError


class Provider:
    def __init__(self):
        self.handles = {}
        self.commands = []
        self.install_running = False
        self.healthy = True
        self.install_code = 0
        self.cleanup_error = False
        self.created = 0
        self.renewed = threading.Event()
        self.contents = {}

    def create(self, *, workspace_id, **kwargs):
        self.created += 1
        handle = WorkspaceHandle(workspace_id, f"sandbox-{self.created}")
        self.handles[handle.sandbox_id] = handle
        return handle

    def find_workspaces(self, *, workspace_id):
        return [h for h in self.handles.values() if h.workspace_id == workspace_id]

    def connect(self, handle):
        if handle.sandbox_id not in self.handles:
            raise WorkspaceProviderError("e2b_connect_failed")
        return handle

    def write_files(self, handle, files):
        self.contents = dict(files)

    def start_process(self, handle, command, **kwargs):
        self.commands.append(command)
        return ProcessResult("42" if command.startswith("npm ci") else "43")

    def read_process_logs(self, handle, pid, *, offset=0):
        content = ("installation output\n" if pid == "42" else "server output\n").encode()
        return ProcessLogChunk(content[offset:].decode(), len(content))

    def process_result(self, handle, pid):
        return ProcessResult(pid, exit_code=self.install_code)

    def is_process_running(self, handle, pid):
        return handle.sandbox_id in self.handles and (pid != "42" or self.install_running)

    def probe(self, handle, port, *, expected_revision):
        return handle.sandbox_id in self.handles and self.healthy

    def renew(self, handle, **kwargs):
        self.renewed.set()

    def destroy(self, handle):
        if self.cleanup_error:
            raise WorkspaceProviderError("e2b_destroy_failed")
        self.handles.pop(handle.sandbox_id, None)


def eventually(predicate, *, timeout=6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.015)
    raise AssertionError("worker_did_not_reach_expected_state")


@pytest.fixture
def setup(tmp_path, project_actor):
    project_actor("alice")
    url = f"sqlite:///{tmp_path / 'runtime.db'}"
    store = ProjectStore.from_url(url)
    project = store.create_project("session-1", owner_id="alice",
        files={"package.json": "{}", "package-lock.json": "{}"}, template_version="fixed-1", plan_ref="plan-1")
    provider = Provider()
    supervisors = []

    def worker(**kwargs):
        config = {"poll_interval": 0.02, "lease_ttl": 1, "lifetime_seconds": 30, "idle_seconds": 20, **kwargs}
        instance = ProjectRuntimeSupervisor(store, lambda: provider, authorizer=lambda *args: None,
            **config)
        instance.start()
        supervisors.append(instance)
        return instance

    yield store, project, provider, worker, url
    for instance in supervisors:
        instance.shutdown()
    store.close()


def submit(worker, project, key="request-1"):
    return worker.submit(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key)


def state(store, operation, expected):
    value = store.get_operation(operation.operationId, owner_id="alice")
    return value if value.runtime and value.runtime.status == expected else None


def test_submission_is_durable_idempotent_and_ready_keeps_lease(setup):
    store, project, provider, make_worker, _ = setup
    provider.preview_url = lambda handle, port: f"https://{port}-{handle.sandbox_id}.e2b.app"
    worker = make_worker()
    operation = submit(worker, project)
    duplicate = submit(worker, project)
    assert duplicate.operationId == operation.operationId
    with pytest.raises(ProjectConflict, match="idempotency"):
        worker.submit(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            approval_ref="plan-1", idempotency_key="request-1", port=5182)
    ready = eventually(lambda: state(store, operation, "ready"))
    assert ready.status == "running"
    assert ready.runtime.previewUrl == f"https://5173-sandbox-1.e2b.app/"
    assert provider.created == 1 and len(provider.commands) == 2
    assert provider.renewed.wait(2)
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease.expiresAt > time.time()
    snapshot = store.snapshot_operation(operation.operationId, owner_id="alice")
    events = store.list_events(operation.operationId, owner_id="alice")
    assert snapshot["lastSeq"] >= 5
    assert any(e.type == "runtime.log" and "installation output" in e.payload["text"] for e in events)
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(store, operation, "stopped"))
    assert not provider.handles


@pytest.mark.parametrize("phase", ["installing", "starting", "ready"])
def test_cancel_stops_remote_work_in_all_phases_and_preserves_source(setup, phase):
    store, project, provider, make_worker, _ = setup
    provider.install_running = phase == "installing"
    provider.healthy = phase != "starting"
    worker = make_worker()
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, phase))
    worker.cancel(operation.operationId, owner_id="alice")
    stopped = eventually(lambda: state(store, operation, "stopped"))
    assert stopped.status == "cancelled"
    assert not provider.handles
    assert worker.cancel(operation.operationId, owner_id="alice").status == "cancelled"
    assert store.read_files(project.projectId, project.currentRevision, owner_id="alice")["package.json"] == "{}"
    eventually(lambda: store.get_lease(project.projectId, owner_id="alice").sandboxId is None)


@pytest.mark.parametrize("phase", ["installing", "starting", "ready"])
def test_restart_reconnects_same_process_without_replaying_commands(setup, phase):
    store, project, provider, make_worker, url = setup
    provider.install_running = phase == "installing"
    provider.healthy = phase != "starting"
    first = make_worker()
    operation = submit(first, project)
    eventually(lambda: state(store, operation, phase))
    first.shutdown()
    saved = store.get_operation(operation.operationId, owner_id="alice")
    assert saved.status == "interrupted" and saved.result["phase"] == phase
    assert provider.handles
    previous_commands = list(provider.commands)
    reopened = ProjectStore.from_url(url)
    second = ProjectRuntimeSupervisor(reopened, lambda: provider, authorizer=lambda *args: None,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=30, idle_seconds=20)
    try:
        second.start()
        eventually(lambda: state(reopened, operation, phase))
        assert provider.commands == previous_commands and provider.created == 1
        provider.install_running = False
        provider.healthy = True
        eventually(lambda: state(reopened, operation, "ready"))
        second.cancel(operation.operationId, owner_id="alice")
        eventually(lambda: state(reopened, operation, "stopped"))
        events = reopened.list_events(operation.operationId, owner_id="alice")
        ids = [event.eventId for event in events]
        assert len(ids) == len(set(ids))
        assert len([e for e in events if e.type == "runtime.log" and e.payload["processId"] == "42"]) == 1
    finally:
        second.shutdown()
        reopened.close()


def test_failed_cleanup_remains_reconciling_and_is_retried(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker()
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "ready"))
    provider.cleanup_error = True
    worker.cancel(operation.operationId, owner_id="alice")
    pending = eventually(lambda: state(store, operation, "reconciling"))
    assert pending.status == "interrupted"
    assert pending.result["cleanup"]["status"] == "cancelled"
    assert provider.handles and store.get_lease(project.projectId, owner_id="alice").sandboxId
    provider.cleanup_error = False
    eventually(lambda: state(store, operation, "stopped"))
    assert not provider.handles


@pytest.mark.parametrize("code", [None, 7])
def test_failed_or_unknown_install_cannot_start_server(setup, code):
    store, project, provider, make_worker, _ = setup
    provider.install_code = code
    operation = submit(make_worker(), project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.status == "failed"
    assert failed.runtime.errorCode == "project_dependency_install_failed"
    assert len(provider.commands) == 1 and not provider.handles


def test_unknown_dispatch_is_cleaned_without_replaying_install(setup, monkeypatch):
    store, project, provider, make_worker, _ = setup
    original_renew = store.renew_lease
    failed = threading.Event()

    def interrupted_register(*args, **kwargs):
        if kwargs.get("process_refs", {}).get("install") and not failed.is_set():
            failed.set()
            raise ProjectConflict("simulated_crash_after_remote_dispatch")
        return original_renew(*args, **kwargs)

    monkeypatch.setattr(store, "renew_lease", interrupted_register)
    operation = submit(make_worker(), project)
    terminal = eventually(lambda: state(store, operation, "failed"))
    assert terminal.runtime.errorCode == "runtime_dispatch_uncertain"
    assert len(provider.commands) == 1 and not provider.handles


def test_create_identity_gap_is_found_by_metadata_and_cleaned(setup, monkeypatch):
    store, project, provider, make_worker, _ = setup
    original_renew = store.renew_lease
    failed = threading.Event()

    def interrupted_register(*args, **kwargs):
        if kwargs.get("sandbox_id") and not failed.is_set():
            failed.set()
            raise ProjectConflict("simulated_crash_after_create")
        return original_renew(*args, **kwargs)

    monkeypatch.setattr(store, "renew_lease", interrupted_register)
    operation = submit(make_worker(), project)
    eventually(lambda: state(store, operation, "failed"))
    assert provider.created == 1 and not provider.commands and not provider.handles


def test_other_owner_cannot_cancel_or_read_events(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker()
    operation = submit(worker, project)
    with pytest.raises(ProjectNotFound):
        worker.cancel(operation.operationId, owner_id="mallory")
    with pytest.raises(ProjectNotFound):
        store.list_events(operation.operationId, owner_id="mallory")


def test_execution_rechecks_approval_before_any_remote_side_effect(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker()
    calls = []

    def authorize(*args):
        calls.append(1)
        if len(calls) > 1:
            raise PermissionError("project_plan_approval_required")

    worker.authorizer = authorize
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "project_plan_approval_required"
    assert not provider.created and not provider.commands


def test_idle_activity_delays_cleanup_but_does_not_exempt_total_budget(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker(idle_seconds=1, lifetime_seconds=3)
    operation = submit(worker, project)
    eventually(lambda: state(store, operation, "ready"))
    deadline = time.monotonic() + 4
    touched = 0
    while time.monotonic() < deadline and not state(store, operation, "expired"):
        store.touch_operation(operation.operationId, owner_id="alice")
        touched += 1
        time.sleep(0.15)
    expired = state(store, operation, "expired")
    assert touched > 10 and expired.status == "completed"
    assert expired.runtime.errorCode == "runtime_budget_exhausted"
    assert not provider.handles


def test_no_activity_expires_ready_runtime(setup):
    store, project, provider, make_worker, _ = setup
    operation = submit(make_worker(idle_seconds=1), project)
    expired = eventually(lambda: state(store, operation, "expired"))
    assert expired.status == "completed" and expired.runtime.errorCode == "runtime_idle_expired"
    assert not provider.handles


def test_missing_provider_is_durable_failure_and_queued_cancel_needs_no_provider(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker()

    def unavailable():
        raise WorkspaceProviderError("e2b_api_key_missing")

    worker.provider_factory = unavailable
    operation = submit(worker, project)
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "e2b_api_key_missing"
    worker.shutdown()
    cancelled = store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="cancel-before-start", expected_revision=project.currentRevision, approval_ref="plan-1")
    store.request_operation_cancel(cancelled.operationId, owner_id="alice")
    worker.start()
    stopped = eventually(lambda: state(store, cancelled, "stopped"))
    assert stopped.status == "cancelled" and not provider.created


def test_changed_worker_budget_does_not_break_idempotent_retry(setup):
    store, project, provider, make_worker, _ = setup
    worker = make_worker()
    operation = submit(worker, project)
    worker.lifetime_seconds = 25
    assert submit(worker, project).operationId == operation.operationId
