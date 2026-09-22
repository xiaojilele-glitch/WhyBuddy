"""Fixed Vite runtime provisioning with real process and revision health checks.

ProjectRuntimeService is retained for the explicit primitive smoke command.
Product HTTP starts use ProjectRuntimeSupervisor, which owns the full lifetime.
A ready runtime means a live process serves the mounted revision, not product
acceptance. The shared lease heartbeat is used by both execution paths.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone

from models.project_runtime import PreviewDescriptor, RuntimeInstance
from services.project_acceptance import template_verification_capabilities
from services.project_store import ProjectConflict, ProjectStore
from services.skill_hydrate import hydrate_owner_into
from services.workspace_provider import WorkspaceHandle, WorkspaceProvider, WorkspaceProviderError


REVISION_FILE = "public/__whybuddy_revision.json"


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class _LeaseHeartbeat:
    """Renew under one lock so a heartbeat cannot erase new provider metadata."""

    def __init__(self, store, provider, project_id, owner_id, lease, ttl):
        self.store, self.provider = store, provider
        self.project_id, self.owner_id, self.lease = project_id, owner_id, lease
        self.ttl = ttl
        self.handle = None
        self.failure = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, name="project-lease", daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self._stop.set()
        self._thread.join()

    def check(self):
        if self.failure:
            raise ProjectConflict("workspace_heartbeat_lost") from self.failure

    def renew(self, **metadata):
        with self._lock:
            self.check()
            self.lease = self.store.renew_lease(self.project_id, owner_id=self.owner_id,
                lease_owner=self.lease.leaseOwner, generation=self.lease.generation,
                ttl_seconds=self.ttl, **metadata)

    def _run(self):
        while not self._stop.wait(self.ttl / 3):
            try:
                self.renew()
                if self.handle is not None:
                    self.provider.renew(self.handle, timeout_seconds=900)
            except Exception as exc:
                self.failure = exc
                return


class ProjectRuntimeService:
    def __init__(self, store: ProjectStore, provider: WorkspaceProvider, *,
                 lease_ttl: float = 120, ready_timeout: float = 60, poll_interval: float = 1):
        self.store, self.provider = store, provider
        self.lease_ttl, self.ready_timeout, self.poll_interval = lease_ttl, ready_timeout, poll_interval

    def start(self, project_id: str, *, owner_id: str, lease_owner: str,
              port: int = 5173, expected_revision: str | None = None,
              approval_ref: str | None = None) -> tuple[RuntimeInstance, PreviewDescriptor]:
        if isinstance(port, bool) or not 1024 <= port <= 65535:
            raise ValueError("invalid_preview_port")
        project = self.store.get_project(project_id, owner_id=owner_id)
        revision = self.store.get_revision(project_id, owner_id=owner_id)
        if expected_revision is not None and revision.revision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        if approval_ref is not None and revision.planRef != approval_ref:
            raise ProjectConflict("project_approval_conflict")
        files = self.store.read_files(project_id, revision.revision, owner_id=owner_id)
        if REVISION_FILE in files:
            raise ValueError("reserved_runtime_file")
        if "package-lock.json" not in files:
            raise ValueError("project_lockfile_required")
        lease = self.store.acquire_lease(project_id, owner_id=owner_id,
            lease_owner=lease_owner, ttl_seconds=self.lease_ttl)
        handle = None
        with _LeaseHeartbeat(self.store, self.provider, project_id, owner_id, lease, self.lease_ttl) as heartbeat:
            try:
                if self.store.get_project(project_id, owner_id=owner_id).currentRevision != revision.revision:
                    raise ProjectConflict("project_revision_conflict")
                # A prior process may outlive its worker. Never overwrite its only
                # durable reference before the provider has confirmed destruction.
                if lease.sandboxId:
                    prior = WorkspaceHandle(lease.workspaceId, lease.sandboxId)
                    self.provider.destroy(prior)
                handle = self.provider.create(workspace_id=lease.workspaceId)
                heartbeat.renew(sandbox_id=handle.sandbox_id, process_refs={})
                heartbeat.handle = handle
                self.provider.write_files(handle, {**files,
                    REVISION_FILE: json.dumps({"revision": revision.revision})})
                # 沙盒是一次性的：按账号安装表再开箱一遍。单独写，
                # 不许跟工程 8MiB 源码清单挤一次 write_files。
                hydrate_owner_into(self.provider.write_files, handle, owner_id)
                heartbeat.renew(mounted_revision=revision.revision)
                installed = self.provider.run(handle, "npm ci --ignore-scripts", timeout_seconds=600)
                if installed.exit_code != 0:
                    raise WorkspaceProviderError("project_dependency_install_failed", result=installed)
                heartbeat.check()
                started = self.provider.start_process(handle,
                    f"npm run dev -- --host 0.0.0.0 --port {port} --strictPort", timeout_seconds=900)
                if not started.process_id or started.exit_code is not None:
                    raise WorkspaceProviderError("project_start_failed", result=started)
                runtime_id = "rt-" + uuid.uuid4().hex
                heartbeat.renew(process_refs={runtime_id: started.process_id})
                deadline = time.monotonic() + self.ready_timeout
                while True:
                    heartbeat.check()
                    if not self.provider.is_process_running(handle, started.process_id):
                        raise WorkspaceProviderError("project_process_exited")
                    if self.provider.probe(handle, port, expected_revision=revision.revision):
                        break
                    if time.monotonic() >= deadline:
                        raise WorkspaceProviderError("project_readiness_timeout")
                    time.sleep(self.poll_interval)
                heartbeat.renew()
                runtime = RuntimeInstance(runtimeId=runtime_id, workspaceId=lease.workspaceId,
                    projectId=project.projectId, revision=revision.revision, status="ready", port=port,
                    processId=started.process_id, health="revision_verified", lastHeartbeat=_timestamp())
                # No browser URL or websocket capability before the private gateway.
                descriptor = PreviewDescriptor(projectId=project.projectId, runtimeId=runtime_id,
                    revision=revision.revision, status="ready",
                    capabilities=template_verification_capabilities(revision.templateVersion))
                return runtime, descriptor
            except Exception as failure:
                heartbeat.close()
                if handle is not None:
                    try:
                        self.provider.destroy(handle)
                    except Exception as cleanup:
                        raise WorkspaceProviderError("project_cleanup_pending") from cleanup
                elif lease.sandboxId:
                    # The old instance could not be stopped. Keep it registered.
                    raise
                self.store.release_lease(project_id, owner_id=owner_id,
                    lease_owner=lease_owner, generation=lease.generation, clear_runtime=True)
                raise failure
