import json
import threading
import time

import pytest

from services.project_runtime import ProjectRuntimeService, REVISION_FILE
from services.project_store import ProjectConflict, ProjectStore
from services.workspace_provider import ProcessResult, WorkspaceHandle, WorkspaceProviderError


class Provider:
    def __init__(self):
        self.destroyed = False
        self.created = 0
        self.alive = True
        self.healthy = True
        self.install_code = 0
        self.cleanup_error = False
        self.commands = []
        self.renewed = threading.Event()

    def create(self, **kwargs):
        self.created += 1
        return WorkspaceHandle(kwargs["workspace_id"], f"sb-{self.created}")

    def write_files(self, handle, files):
        self.files = files

    def run(self, handle, command, **kwargs):
        self.commands.append(command)
        return ProcessResult(exit_code=self.install_code, stderr="install diagnostic")

    def start_process(self, handle, command, **kwargs):
        self.commands.append(command)
        return ProcessResult("42")

    def is_process_running(self, handle, process_id):
        return self.alive

    def probe(self, handle, port, expected_revision=None):
        self.probed = (port, expected_revision)
        return self.healthy

    def renew(self, handle, **kwargs):
        self.renewed.set()

    def preview_url(self, handle, port):
        return "https://preview.example"

    def stop(self, handle, process_id):
        pass

    def destroy(self, handle):
        if self.cleanup_error:
            raise WorkspaceProviderError("e2b_destroy_failed")
        self.destroyed = True


@pytest.fixture
def setup(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'runtime.db'}")
    project = store.create_project("session-1", owner_id="alice",
        files={"package.json": "{}", "package-lock.json": "{}"}, template_version="vite-1", plan_ref="plan-1")
    provider = Provider()
    yield store, project, provider
    store.close()


def test_start_provisions_revision_and_records_lease(setup):
    store, project, provider = setup
    runtime, preview = ProjectRuntimeService(store, provider).start(project.projectId, owner_id="alice", lease_owner="worker", port=5181)
    assert runtime.status == "ready"
    assert runtime.health == "revision_verified"
    assert runtime.revision == project.currentRevision
    assert preview.entryUrl is None and preview.capabilities == []
    assert provider.probed == (5181, project.currentRevision)
    assert provider.commands == ["npm ci --ignore-scripts", "npm run dev -- --host 0.0.0.0 --port 5181 --strictPort"]
    assert json.loads(provider.files[REVISION_FILE])["revision"] == project.currentRevision
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease and lease.sandboxId == "sb-1" and lease.mountedRevision == project.currentRevision
    assert lease.processRefs == {runtime.runtimeId: "42"}


@pytest.mark.parametrize("exit_code", [None, 1, 127])
def test_install_failure_is_not_ready_and_keeps_diagnostics(setup, exit_code):
    store, project, provider = setup
    provider.install_code = exit_code
    with pytest.raises(WorkspaceProviderError, match="project_dependency_install_failed") as error:
        ProjectRuntimeService(store, provider).start(project.projectId, owner_id="alice", lease_owner="worker")
    assert error.value.result.stderr == "install diagnostic"
    assert len(provider.commands) == 1 and provider.destroyed
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease.sandboxId is None and lease.expiresAt == 0


@pytest.mark.parametrize("alive,healthy,code", [(False, True, "project_process_exited"), (True, False, "project_readiness_timeout")])
def test_ready_requires_live_process_and_revision_probe(setup, alive, healthy, code):
    store, project, provider = setup
    provider.alive, provider.healthy = alive, healthy
    with pytest.raises(WorkspaceProviderError, match=code):
        ProjectRuntimeService(store, provider, ready_timeout=0).start(project.projectId, owner_id="alice", lease_owner="worker")
    assert provider.destroyed


def test_resource_is_recorded_before_install_and_failed_cleanup_is_retryable(setup):
    store, project, provider = setup
    def install(handle, command, **kwargs):
        lease = store.get_lease(project.projectId, owner_id="alice")
        assert lease.sandboxId == handle.sandbox_id
        return ProcessResult(exit_code=7)
    provider.run = install
    provider.cleanup_error = True
    with pytest.raises(WorkspaceProviderError, match="project_cleanup_pending"):
        ProjectRuntimeService(store, provider).start(project.projectId, owner_id="alice", lease_owner="worker")
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease.sandboxId == "sb-1" and lease.expiresAt > time.time()


def test_takeover_stops_prior_instance_before_replacing_reference(setup):
    store, project, provider = setup
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="old")
    store.renew_lease(project.projectId, owner_id="alice", lease_owner="old", generation=lease.generation, sandbox_id="sb-old")
    store.release_lease(project.projectId, owner_id="alice", lease_owner="old", generation=lease.generation)
    provider.cleanup_error = True
    with pytest.raises(WorkspaceProviderError, match="e2b_destroy_failed"):
        ProjectRuntimeService(store, provider).start(project.projectId, owner_id="alice", lease_owner="worker")
    assert provider.created == 0
    assert store.get_lease(project.projectId, owner_id="alice").sandboxId == "sb-old"


def test_install_renews_lease_while_remote_command_is_blocking(setup):
    store, project, provider = setup
    def install(handle, command, **kwargs):
        assert provider.renewed.wait(2), "provider heartbeat never ran"
        lease = store.get_lease(project.projectId, owner_id="alice")
        assert lease.expiresAt > time.time()
        return ProcessResult(exit_code=0)
    provider.run = install
    runtime, _ = ProjectRuntimeService(store, provider, lease_ttl=1).start(project.projectId, owner_id="alice", lease_owner="worker")
    assert runtime.status == "ready"


def test_wrong_owner_cannot_create_a_remote_resource(setup):
    store, project, provider = setup
    with pytest.raises(LookupError):
        ProjectRuntimeService(store, provider).start(project.projectId, owner_id="mallory", lease_owner="worker")
    assert provider.created == 0


def test_source_advance_between_request_and_lease_cannot_execute_stale_approval(setup, monkeypatch):
    store, project, provider = setup
    acquire = store.acquire_lease
    def race(*args, **kwargs):
        store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            files={"package.json": "{}", "package-lock.json": "{}", "new.txt": "new source"},
            template_version="vite-1", plan_ref="different-plan")
        return acquire(*args, **kwargs)
    monkeypatch.setattr(store, "acquire_lease", race)
    with pytest.raises(ProjectConflict, match="project_revision_conflict"):
        ProjectRuntimeService(store, provider).start(project.projectId, owner_id="alice", lease_owner="worker",
            expected_revision=project.currentRevision, approval_ref="plan-1")
    assert provider.created == 0
