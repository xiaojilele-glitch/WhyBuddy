"""Durable project-operation workers, independent of HTTP subscription lifetime.

This is an execution supervisor, not an agent loop. A runtime.start operation
owns the managed runtime until cancellation, idle/total budget expiry, or failure.
A runtime.exec operation owns one command and its sandbox: managed
check/build/test (`npm run …`) or one grok-build bash line in `input.script`.
Every side effect has a saved phase; uncertain dispatches are never replayed.

2026-09-15: install / exec prefer `start_console` (a real bash PTY) when the
provider has one. Vite stays on `start_process`. The pane reads
`runtime.console` bytes; do not reconstruct a prompt in the worker.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Callable
from urllib.parse import urlsplit

from models.project_runtime import ProjectOperation, RuntimeInstance
from services.project_actor_access import authorize_project_actor
from services.project_application_runtime import checkpoint_application_data, restore_application_data
from services.project_browser_verification import (
    finish_pending_verifications, recover_project_verifications, run_next_project_verification,
)
from services.project_authority import approved_reference
from services.project_creation import load_authorized_session
from services.project_preview_config import (
    origin_for_runtime,
    preview_configuration_enabled,
    published_preview_url,
)
from services.vite_preview_hosts import injected_preview_dev_command
from services.project_runtime import REVISION_FILE, _LeaseHeartbeat, _timestamp
from services.project_source_sync import authorize_source_recovery, finish_pending_source_patches, sync_next_source_patch
from services.deliverable_kind import (
    is_office_artifact_path,
    is_office_zip_bytes,
    orch_trace,
    skip_vite_dependency_install,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_store import ProjectConflict, ProjectStore, ProjectStoreUnavailable
from services.project_verification_store import ProjectVerificationStore
from services.project_acceptance import normalize_acceptance_requirements
from services.project_tool_contracts import sandbox_shell_script
from services.workspace_provider import WorkspaceHandle, WorkspaceProvider, WorkspaceProviderError

logger = logging.getLogger(__name__)
TERMINAL = {"completed", "cancelled", "failed"}
PROJECT_COMMANDS = {"check", "build", "test"}


class ProjectExecutionRejected(ProjectConflict):
    """The request is stale; unlike a lost lease, it can be failed by its owner."""


def authorize_operation(store: ProjectStore, operation: ProjectOperation, owner_id: str) -> None:
    authorize_project_actor(owner_id)
    project = store.get_project(operation.projectId, owner_id=owner_id)
    state = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=operation.approvalRef)
    if state.runtimeKind != "project" or state.projectId != project.projectId:
        raise ProjectExecutionRejected("project_session_binding_required")
    revision = store.get_revision(project.projectId, owner_id=owner_id)
    expected = operation.runtime.revision if operation.kind == "runtime.start" and operation.runtime else operation.expectedRevision
    if revision.revision != expected:
        raise ProjectExecutionRejected("project_revision_conflict")
    if revision.planRef != operation.approvalRef:
        raise PermissionError("project_plan_approval_required")


class _Shutdown(Exception):
    pass


class _Cancel(Exception):
    pass


class _Expired(Exception):
    pass


class ProjectRuntimeSupervisor:
    def __init__(self, store: ProjectStore, provider_factory: Callable[[], WorkspaceProvider], *,
                 authorizer: Callable[[ProjectStore, ProjectOperation, str], None] = authorize_operation,
                 max_workers: int = 2, poll_interval: float = 2, lease_ttl: float = 120,
                 lifetime_seconds: float = 900, idle_seconds: float = 300,
                 install_timeout: float = 600, ready_timeout: float = 60, preview_runtime=None,
                 browser_provider_factory=None):
        if not 1 <= max_workers <= 8 or not 0 < poll_interval <= 30 or not 1 <= lease_ttl <= 3600:
            raise ValueError("invalid_runtime_worker_config")
        if not 1 <= lifetime_seconds <= 3600 or not 1 <= idle_seconds <= lifetime_seconds:
            raise ValueError("invalid_runtime_budget")
        if not 1 <= install_timeout <= 600 or not 1 <= ready_timeout <= 300:
            raise ValueError("invalid_runtime_timeout")
        self.store, self.provider_factory, self.authorizer = store, provider_factory, authorizer
        self.max_workers, self.poll_interval, self.lease_ttl = max_workers, poll_interval, lease_ttl
        self.lifetime_seconds, self.idle_seconds = lifetime_seconds, idle_seconds
        self.install_timeout, self.ready_timeout = install_timeout, ready_timeout
        self.preview_runtime = preview_runtime
        self.browser_provider_factory = browser_provider_factory
        self.verification_store = ProjectVerificationStore(store)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._workers: dict[str, threading.Thread] = {}
        self._stdin: dict[str, list[dict]] = {}
        self._scanner: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._scanner is not None and self._scanner.is_alive() and not self._stop.is_set()

    @staticmethod
    def preview_configuration_enabled() -> bool:
        """Expose the canonical local preview check to planning callers.

        This is configuration only; it never contacts E2B or redeems a grant.
        Keeping the check on the runtime owner avoids a control-tools import
        edge into the runtime layer.
        """
        return preview_configuration_enabled()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._scanner = threading.Thread(target=self._scan_loop, name="project-runtime-supervisor", daemon=True)
        self._scanner.start()

    def shutdown(self, timeout: float = 30) -> None:
        self._stop.set()
        self._wake.set()
        deadline = time.monotonic() + timeout
        if self._scanner is not None:
            self._scanner.join(max(0, deadline - time.monotonic()))
        with self._lock:
            workers = list(self._workers.values())
        for worker in workers:
            worker.join(max(0, deadline - time.monotonic()))
        if any(worker.is_alive() for worker in workers):
            raise RuntimeError("runtime_workers_still_stopping")

    def submit(self, project_id: str, *, owner_id: str, expected_revision: str,
               approval_ref: str, idempotency_key: str, port: int = 5173) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if isinstance(port, bool) or not 1024 <= port <= 65535:
            raise ValueError("invalid_preview_port")
        # Authorization is checked before persistence and again by the worker.
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.start", idempotencyKey=idempotency_key, requestHash="", expectedRevision=project.currentRevision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.start",
            idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
            input={"port": port})
        self._wake.set()
        return operation

    def submit_command(self, project_id: str, *, owner_id: str, expected_revision: str,
                       approval_ref: str, idempotency_key: str, command: str = "check",
                       script: str | None = None) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        if script is not None:
            payload = {"command": "shell", "script": sandbox_shell_script(script)}
        elif isinstance(command, str) and command in PROJECT_COMMANDS:
            payload = {"command": command}
        else:
            raise ValueError("invalid_project_command")
        project = self.store.get_project(project_id, owner_id=owner_id)
        candidate = ProjectOperation(operationId="pending", projectId=project_id, sessionId=project.sessionId,
            kind="runtime.exec", idempotencyKey=idempotency_key, requestHash="", expectedRevision=expected_revision,
            approvalRef=approval_ref, createdAt=_timestamp(), updatedAt=_timestamp())
        self.authorizer(self.store, candidate, owner_id)
        # 同一把钥匙的重放不许抢租约。命令还在跑时先 acquire，会把
        # 「钥匙冲突」盖成 workspace_lease_busy，重试也拿不回那次操作。
        if self.store.operation_by_key(project_id, idempotency_key, owner_id=owner_id) is not None:
            return self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.exec",
                idempotency_key=idempotency_key, expected_revision=expected_revision,
                approval_ref=approval_ref, input=payload)
        # ⚠ 2026-09-22 KM48CMNDPE：操作一进共享库，另一个监督器先领走，
        #   用旧代码把只有 README 的 bash 打成 lockfile。先占租约再插入，
        #   公开时 list_runnable 已经看不见它。
        lease = self.store.acquire_lease(project_id, owner_id=owner_id,
            lease_owner="runtime-" + uuid.uuid4().hex, ttl_seconds=self.lease_ttl)
        try:
            operation = self.store.create_operation(project_id, owner_id=owner_id, kind="runtime.exec",
                idempotency_key=idempotency_key, expected_revision=expected_revision, approval_ref=approval_ref,
                input=payload)
        except Exception:
            self.store.release_lease(project_id, owner_id=owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)
            raise
        self._start_held(operation, owner_id, lease)
        return operation

    def enqueue_stdin(self, operation_id: str, *, owner_id: str, text: str,
                      press_enter: bool = True) -> None:
        """Queue PTY stdin for a live exec. Worker flushes on the next poll.

        抄 grok / E2B pty.send_stdin。落在监督器内存里：租约线程才碰 PTY，
        控制面不许自己 send。进程已经终态就拒，不许假装写进去了。
        """
        if not isinstance(text, str) or text == "" or len(text.encode("utf-8")) > 8 * 1024:
            raise ValueError("project_shell_stdin_invalid")
        if any(char in text for char in ("\x00",)):
            raise ValueError("project_shell_stdin_invalid")
        operation = self.store.get_operation(operation_id, owner_id=owner_id)
        if operation.kind != "runtime.exec" or operation.status in TERMINAL:
            raise ValueError("project_shell_stdin_not_available")
        with self._lock:
            self._stdin.setdefault(operation_id, []).append(
                {"text": text, "pressEnter": bool(press_enter)})
        self._wake.set()

    def peek_stdin(self, operation_id: str) -> list[dict]:
        with self._lock:
            return list(self._stdin.get(operation_id) or [])

    def take_stdin(self, operation_id: str) -> list[dict]:
        with self._lock:
            return self._stdin.pop(operation_id, [])

    def cancel(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        operation = self.store.request_operation_cancel(operation_id, owner_id=owner_id)
        self._wake.set()
        return operation

    def submit_patch(self, runtime_operation_id: str, *, owner_id: str, expected_revision: str,
                     approval_ref: str, idempotency_key: str, changes: list[dict]) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        for attempt in range(3):
            parent = self.store.get_operation(runtime_operation_id, owner_id=owner_id)
            # Recheck the live plan using the current source. The enqueue CAS
            # checks the requested base and may return an identical saved call.
            project = self.store.get_project(parent.projectId, owner_id=owner_id)
            candidate = parent.model_copy(update={"runtime": None, "expectedRevision": project.currentRevision,
                                                   "approvalRef": approval_ref})
            self.authorizer(self.store, candidate, owner_id)
            try:
                operation = self.store.enqueue_runtime_patch(runtime_operation_id, owner_id=owner_id,
                    expected_revision=expected_revision, approval_ref=approval_ref,
                    idempotency_key=idempotency_key, changes=changes)
            except ProjectConflict as exc:
                # The lease heartbeat can invalidate a healthy admission CAS.
                # Only confirmed zero-row writes may retry; an unknown SQL
                # reply may already own a child and must reach the caller.
                if str(exc) != "project_runtime_patch_changed" or attempt == 2:
                    raise
                continue
            self._wake.set()
            return operation

    def submit_verification(self, runtime_operation_id: str, *, owner_id: str, expected_revision: str,
                            approval_ref: str, idempotency_key: str,
                            acceptance_requirements: list[str] | None = None) -> ProjectOperation:
        if not self.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        for attempt in range(3):
            parent = self.store.get_operation(runtime_operation_id, owner_id=owner_id)
            candidate = parent.model_copy(update={"approvalRef": approval_ref})
            self.authorizer(self.store, candidate, owner_id)
            revision = self.store.get_revision(parent.projectId, expected_revision, owner_id=owner_id)
            suite_version = "react-vite-tasks@1" if revision.templateVersion == "whybuddy-react-vite-tasks-1" else "react-vite-counter@1"
            try:
                operation = self.store.enqueue_runtime_verification(runtime_operation_id,
                    owner_id=owner_id, expected_revision=expected_revision, approval_ref=approval_ref,
                    idempotency_key=idempotency_key, suite_version=suite_version,
                    acceptance_requirements=normalize_acceptance_requirements(acceptance_requirements))
            except ProjectConflict as exc:
                # A confirmed zero-row admission may race the healthy heartbeat.
                # Read and authorize everything again, never replay unknown IO.
                if str(exc) != "project_runtime_patch_changed" or attempt == 2:
                    raise
                continue
            self._wake.set()
            return operation

    def _scan_loop(self) -> None:
        while not self._stop.is_set():
            try:
                with self._lock:
                    self._workers = {key: value for key, value in self._workers.items() if value.is_alive()}
                    available = self.max_workers - len(self._workers)
                if available:
                    for operation, owner_id in self.store.list_runnable_operations(limit=self.max_workers * 4):
                        with self._lock:
                            if self._stop.is_set() or len(self._workers) >= self.max_workers:
                                break
                            if operation.operationId in self._workers:
                                continue
                            worker = threading.Thread(target=self._execute,
                                args=(operation, owner_id), name="project-operation", daemon=True)
                            self._workers[operation.operationId] = worker
                            worker.start()
            except Exception as exc:
                logger.warning("project runtime scan unavailable: %s", type(exc).__name__)
            self._wake.wait(self.poll_interval)
            self._wake.clear()

    def _start_held(self, operation: ProjectOperation, owner_id: str, lease) -> None:
        with self._lock:
            if operation.operationId in self._workers:
                return
            worker = threading.Thread(target=self._execute,
                args=(operation, owner_id, lease), name="project-operation", daemon=True)
            self._workers[operation.operationId] = worker
            worker.start()

    def _execute(self, candidate: ProjectOperation, owner_id: str, held_lease=None) -> None:
        context, lease = None, held_lease
        try:
            if lease is None:
                lease = self.store.acquire_lease(candidate.projectId, owner_id=owner_id,
                    lease_owner="runtime-" + uuid.uuid4().hex, ttl_seconds=self.lease_ttl)
            prior_id = lease.processRefs.get("operationId")
            if prior_id and prior_id != candidate.operationId:
                prior = self.store.get_operation(prior_id, owner_id=owner_id)
                if prior.status not in TERMINAL or prior.pendingEvent is not None:
                    # Queued commands cannot replace a recovering runtime.
                    return
            original = self.store.get_operation(candidate.operationId, owner_id=owner_id)
            claimed = self.store.claim_operation(candidate.operationId, owner_id=owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)
            if claimed.status in TERMINAL:
                self.store.flush_operation_event(claimed.operationId, owner_id=owner_id,
                    lease_generation=lease.generation, lease_owner=lease.leaseOwner)
                self.store.release_lease(candidate.projectId, owner_id=owner_id,
                    lease_owner=lease.leaseOwner, generation=lease.generation)
                return
            context = _RuntimeTask(self, owner_id, lease, original)
            with context.heartbeat:
                try:
                    if original.runtime is None and not lease.sandboxId and context.operation().cancelRequested:
                        raise _Cancel()
                    context.set_provider(self.provider_factory())
                    context.run()
                except _Cancel:
                    context.finish("cancelled", "stopped", "user_cancelled")
                except _Expired:
                    context.finish("failed" if original.kind == "runtime.exec" else "completed",
                        "expired", "runtime_budget_exhausted")
                except _Shutdown:
                    context.suspend("worker_shutdown")
                except ProjectExecutionRejected as exc:
                    context.finish("failed", "failed", str(exc))
                except (ProjectConflict, ProjectStoreUnavailable):
                    # Ownership or durable-state uncertainty forbids further IO.
                    raise
                except Exception as exc:
                    code = str(exc) if isinstance(exc, (WorkspaceProviderError, PermissionError, ValueError)) else type(exc).__name__
                    context.finish("failed", "failed", code)
        except ProjectConflict:
            pass  # Another valid generation now owns all state and side effects.
        except Exception as exc:
            logger.warning("project operation requires reconciliation: %s (%s)", candidate.operationId, type(exc).__name__)
        finally:
            if context is not None:
                context.heartbeat.close()
            elif lease is not None:
                try:
                    self.store.release_lease(candidate.projectId, owner_id=owner_id,
                        lease_owner=lease.leaseOwner, generation=lease.generation)
                except (ProjectConflict, ProjectStoreUnavailable):
                    pass
            self._wake.set()


class _RuntimeTask:
    def __init__(self, supervisor, owner_id, lease, original):
        self.supervisor, self.store, self.provider = supervisor, supervisor.store, None
        self.owner_id, self.lease, self.original = owner_id, lease, original
        self.operation_id = original.operationId
        self.runtime = original.runtime or RuntimeInstance(runtimeId="rt-" + original.operationId,
            workspaceId=lease.workspaceId, projectId=original.projectId, revision=original.expectedRevision,
            status="provisioning", port=int(original.input.get("port", 5173)), lastHeartbeat=_timestamp(),
            expiresAt=time.time() + supervisor.lifetime_seconds)
        self.handle = WorkspaceHandle(lease.workspaceId, lease.sandboxId) if lease.sandboxId else None
        self.heartbeat = _LeaseHeartbeat(self.store, None, original.projectId, owner_id, lease, supervisor.lease_ttl)
        self.log_offsets: dict[str, int] = {}
        self.result = dict(original.result or {})
        self.result.setdefault("idleSeconds", supervisor.idle_seconds)
        if original.kind == "runtime.exec":
            script = original.input.get("script")
            self.result.setdefault("command", script if isinstance(script, str) else original.input.get("command"))
            self.result.setdefault("exitCode", None)

    def set_provider(self, provider):
        self.provider = provider
        self.heartbeat.provider = provider

    def operation(self):
        return self.store.get_operation(self.operation_id, owner_id=self.owner_id)

    def save(self, phase, *, status="running", error=None):
        self.heartbeat.check()
        self.runtime = self.runtime.model_copy(update={"status": phase, "errorCode": error,
            "health": "revision_verified" if phase == "ready" else "unknown", "lastHeartbeat": _timestamp()})
        self.result["phase"] = phase
        if self.original.kind == "runtime.exec":
            self.result["errorCode"] = error
        current = self.operation()
        self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status=current.status, status=status, runtime=self.runtime, result=self.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)

    def check(self):
        self.heartbeat.check()
        if self.operation().cancelRequested:
            raise _Cancel()
        if self.supervisor._stop.is_set():
            raise _Shutdown()
        if self.runtime.expiresAt is not None and time.time() >= self.runtime.expiresAt:
            raise _Expired()
        authorize_project_actor(self.owner_id)

    def sleep(self, *, tight=False):
        # Console typing is ~50 cps. A 2s poll turns that into a jump. 120ms
        # keeps the pane looking like a machine being typed on.
        self.supervisor._stop.wait(0.12 if tight else self.supervisor.poll_interval)

    def _is_console_pid(self, pid):
        refs = self.heartbeat.lease.processRefs
        return any(refs.get(key) == pid and refs.get(f"{key}Console") == "1"
                   for key in ("install", "command"))

    def _attach_console(self, pid):
        if not self._is_console_pid(pid):
            return
        attach = getattr(self.provider, "attach_console", None)
        if callable(attach):
            attach(self.handle, pid)

    def _start_visible(self, key, command, *, timeout_seconds):
        """Install / exec go through a PTY when the provider has one.

        2026-09-15: reconstructing `$ cmd` + `runtime.log` is a log viewer.
        Manus types into bash. Vite stays on start_process — same command in
        both places would run twice.
        """
        start_console = getattr(self.provider, "start_console", None)
        if callable(start_console):
            result = start_console(self.handle, command, timeout_seconds=timeout_seconds)
            self._register(key, result.process_id, console=True)
            return result
        result = self.provider.start_process(self.handle, command, timeout_seconds=timeout_seconds)
        self._register(key, result.process_id)
        return result

    def logs(self, pid):
        if pid not in self.log_offsets:
            offset, seq = 0, 0
            while True:
                events = self.store.list_events(self.operation_id, owner_id=self.owner_id, after_seq=seq, limit=1000)
                for event in events:
                    if event.type in {"runtime.log", "runtime.console"} and event.payload.get("processId") == pid:
                        offset = max(offset, int(event.payload["nextOffset"]))
                if len(events) < 1000:
                    break
                seq = events[-1].seq
            self.log_offsets[pid] = offset
        self._attach_console(pid)
        if self._is_console_pid(pid):
            read_console = getattr(self.provider, "read_console", None)
            if not callable(read_console):
                raise WorkspaceProviderError("project_console_reader_missing")
            chunk = read_console(self.handle, pid, offset=self.log_offsets[pid])
            if chunk.next_offset > self.log_offsets[pid]:
                self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.console",
                    event_id=f"{pid}:console:{self.log_offsets[pid]}:{chunk.next_offset}",
                    payload={"processId": pid, "data": chunk.text, "nextOffset": chunk.next_offset,
                             "truncated": chunk.truncated},
                    lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
                self.log_offsets[pid] = chunk.next_offset
            return chunk.next_offset
        chunk = self.provider.read_process_logs(self.handle, pid, offset=self.log_offsets[pid])
        if chunk.next_offset > self.log_offsets[pid]:
            self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.log",
                event_id=f"{pid}:log:{self.log_offsets[pid]}:{chunk.next_offset}",
                payload={"processId": pid, "text": chunk.text, "nextOffset": chunk.next_offset, "truncated": chunk.truncated},
                lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
            self.log_offsets[pid] = chunk.next_offset
        return chunk.next_offset

    def _persist_process_output(self, pid, executed):
        """把 process_result 里的 stdout/stderr 补进操作日志。

        ⚠ 2026-09-22 FFR6：PTY 缓冲是空的时，read_console 不写事件，
          但 process_result 仍可能带着同一段输出。只写日志里还没有的部分，
          避免和已经落库的 runtime.console 再贴一遍。
        """
        parts = [str(getattr(executed, "stdout", "") or ""), str(getattr(executed, "stderr", "") or "")]
        text = "".join(part for part in parts if part)
        if not text.strip():
            return
        have = []
        events = self.store.list_events(self.operation_id, owner_id=self.owner_id, after_seq=0, limit=1000)
        for event in events:
            if event.type not in {"runtime.log", "runtime.console"}:
                continue
            payload = event.payload if isinstance(event.payload, dict) else {}
            if payload.get("processId") != pid:
                continue
            have.append(str(payload.get("text") or payload.get("data") or ""))
        if text in "".join(have):
            return
        encoded = text.encode("utf-8", errors="replace")
        offset = self.log_offsets.get(pid, 0)
        next_offset = offset + len(encoded)
        self.store.append_event(self.operation_id, owner_id=self.owner_id, event_type="runtime.console",
            event_id=f"{pid}:captured:{offset}:{next_offset}",
            payload={"processId": pid, "data": text, "nextOffset": next_offset, "truncated": False},
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.log_offsets[pid] = next_offset

    def development_server_command(self):
        server_command = f"npm run dev -- --host 0.0.0.0 --port {self.runtime.port} --strictPort"
        hosts = self._vite_allowed_hosts()
        # Env alone is the Vite CLI merge. Agent `createViteServer` skips it
        # (2026-09-18 真机 server.mjs). NODE --import wraps createServer for
        # every project; do not patch durable source per revision.
        if hosts:
            logger.info("project_vite_preview_hosts relay=%s all=%s", hosts[0], hosts)
            # ⚠ 2026-09-18：logger.info 进不了 uvicorn access 日志，重启后
            #   仍拦时终端里完全看不到注入有没有跑。print flush 才能对上真机。
            print(f"[project] vite preview hosts relay={hosts[0]} all={hosts}", flush=True)
            return injected_preview_dev_command(server_command, hosts)
        return server_command

    def _published_preview_url(self):
        getter = getattr(self.provider, "preview_url", None)
        if getter is None or self.handle is None:
            return None
        try:
            return published_preview_url(getter(self.handle, self.runtime.port))
        except Exception:
            return None

    def _remember_published_preview(self):
        url = self._published_preview_url()
        if url and self.runtime.previewUrl != url:
            self.runtime = self.runtime.model_copy(update={"previewUrl": url})

    def _require_relay_origin(self):
        # Validate the private relay template before any remote IO. A bad
        # template must still fail before create / npm ci (2026-09-16).
        # ⚠ 2026-09-18：iframe Host 来自 origin template，不是来自隧道进程。
        #   本地缺 dist/project-preview/agent.cjs 时 preview_runtime 是 None，
        #   上一版这里直接 return None，中继 Host 永远不进 Vite 名单——
        #   启动日志 `[startup] project preview agent bundle unavailable`，
        #   预览照样兑票，Vite 照样拦 sslip.io。
        if self.original.kind != "runtime.start":
            return None
        try:
            preview_host = urlsplit(origin_for_runtime(self.runtime.runtimeId)).hostname
        except ValueError:
            if self.supervisor.preview_runtime is not None:
                raise
            return None
        if not preview_host:
            raise ValueError("project_preview_origin_invalid")
        return preview_host

    def _vite_allowed_hosts(self):
        # ⚠ 2026-09-18 真机（allowlist + 156 sslip 中继）：上一版
        #   `_vite_allowed_host` 让 E2B `get_host` 赢，启动命令只放行
        #   `5173-*.e2b.app`。iframe 的 Host 是
        #   `{runtimeId}.preview.156.239.47.108.sslip.io`，Vite 7 回
        #   「Blocked request. This host is not allowed」——票已经兑上了，
        #   应用自己把预览拦了。allowlist 出票走中继，internal 无隧道才走
        #   发布域；两个 Host 都要进名单，不许互斥。Never take hosts from
        #   tool input or set allowedHosts=true.
        hosts = []
        relay = self._require_relay_origin()
        if relay:
            hosts.append(relay)
        published = self._published_preview_url()
        if published:
            name = urlsplit(published).hostname
            if name and name not in hosts:
                hosts.append(name)
        return hosts

    def run(self):
        if self.result.get("cleanup"):
            self.finish(**self.result["cleanup"])
            return
        self.check()
        if self.result.get("sourceSync"):
            authorize_source_recovery(self)
        else:
            self.supervisor.authorizer(self.store, self.operation(), self.owner_id)
        command = self.original.input.get("command") if self.original.kind == "runtime.exec" else None
        script = self.original.input.get("script") if self.original.kind == "runtime.exec" else None
        if self.original.kind == "runtime.exec":
            if isinstance(script, str):
                script = sandbox_shell_script(script)
            elif not isinstance(command, str) or command not in PROJECT_COMMANDS:
                raise ValueError("invalid_project_command")
        self._require_relay_origin()
        if self.original.runtime is None:
            self.save("provisioning")
            files = self.store.read_files(self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            if REVISION_FILE in files:
                orch_trace("lockfile", reason="revision_file", files=sorted(str(n) for n in files))
                self.result["gate"] = "revision_file:" + ",".join(sorted(str(n) for n in files))[:300]
                raise ValueError("project_lockfile_or_reserved_path_invalid")
            revision = self.store.get_revision(
                self.original.projectId, self.original.expectedRevision, owner_id=self.owner_id)
            skip_install = skip_vite_dependency_install(
                operation_kind=self.original.kind,
                template_version=revision.templateVersion,
                files=files,
            )
            # ⚠ 2026-09-22 Z8NPKNM14C：树只有 README.md，skip 助手按源码应返回
            #   True，真机仍 lockfile。没有 package.json 就不是 Vite 开箱，
            #   不把这一发交给「助手返回了 False」。
            bare = "package.json" not in files and "package-lock.json" not in files
            if bare and self.original.kind == "runtime.exec":
                skip_install = True
            orch_trace(
                "exec-gate",
                kind=self.original.kind,
                template=revision.templateVersion,
                files=sorted(str(n) for n in files),
                skip=bool(skip_install),
                bare=bare,
            )
            if "package-lock.json" not in files and not skip_install:
                # ⚠ 2026-09-21 XSGAMK9PYZ：源码只有 README.md / workspace-1，
                #   bash 仍 lockfile。打印当时那一发，别再对着测试里的 dict 猜。
                self.result["gate"] = (
                    f"template={revision.templateVersion} "
                    f"files={sorted(str(n) for n in files)} skip={skip_install}"
                )[:300]
                print(
                    f"[project] lockfile gate kind={self.original.kind} "
                    f"template={revision.templateVersion!r} "
                    f"files={sorted(str(n) for n in files)} skip={skip_install}",
                    flush=True,
                )
                raise ValueError("project_lockfile_or_reserved_path_invalid")
            # ⚠ 2026-09-22 BABCJGGB44：办公 bash 每条命令都拆沙盒再建。
            #   pip 和刚写出的 pptx 下一条就没了，模型只好把文件 base64
            #   塞进日志。没有 package.json 的工作区留下同一个沙盒。
            reused = False
            if skip_install and self.handle is not None:
                try:
                    self.provider.connect(self.handle)
                    reused = True
                except Exception:
                    self.handle = None
            if not reused:
                if self.handle is not None:
                    self.provider.destroy(self.handle)
                    self.handle = None
                self.check()
                self.heartbeat.renew(sandbox_id=None, process_refs={"operationId": self.operation_id})
                for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                    self.heartbeat.check()
                    self.provider.destroy(orphan)
                self.handle = self.provider.create(workspace_id=self.lease.workspaceId)
            orch_trace(
                "sandbox",
                reused=reused,
                sandbox=None if self.handle is None else self.handle.sandbox_id,
            )
            self.heartbeat.renew(sandbox_id=self.handle.sandbox_id, process_refs={"operationId": self.operation_id})
            self.heartbeat.handle = self.handle
            if skip_install:
                self.result["keepSandbox"] = True
            restore_application_data(self)
            self.save("syncing")
            self.provider.write_files(self.handle, {**files, REVISION_FILE: json.dumps({"revision": self.runtime.revision})})
            self.heartbeat.renew(mounted_revision=self.runtime.revision)
            self.check()
            if skip_install:
                self.save("executing")
                visible = script if isinstance(script, str) else f"npm run {command}"
                self._start_visible("command", visible, timeout_seconds=900)
                phase = "executing"
            else:
                self.result["phaseDeadline"] = time.time() + self.supervisor.install_timeout
                self.save("installing")
                self._start_visible("install", "npm ci --ignore-scripts", timeout_seconds=600)
                phase = "installing"
        else:
            if self.handle is None:
                raise WorkspaceProviderError("runtime_dispatch_uncertain")
            self.provider.connect(self.handle)
            self.heartbeat.handle = self.handle
            if self.original.kind == "runtime.start":
                recover_project_verifications(self)
            if self.result.get("sourceSync"):
                self.save("syncing")
                sync_next_source_patch(self, recovering=True)
            phase = self.result.get("phase") or self.original.runtime.status
            phases = {"installing", "executing"} if self.original.kind == "runtime.exec" else {"installing", "starting", "ready"}
            if phase not in phases:
                raise WorkspaceProviderError("runtime_dispatch_uncertain")
            self.save(phase)
        if phase == "installing":
            pid = self._process("install")
            while True:
                self.check()
                self.logs(pid)
                if not self.provider.is_process_running(self.handle, pid):
                    break
                if time.time() >= self.result["phaseDeadline"]:
                    raise WorkspaceProviderError("project_install_timeout")
                self.sleep(tight=self._is_console_pid(pid))
            installed = self.provider.process_result(self.handle, pid)
            while True:
                previous = self.log_offsets.get(pid, 0)
                if self.logs(pid) == previous:
                    break
            self._persist_process_output(pid, installed)
            if installed.exit_code != 0:
                if self.original.kind == "runtime.exec":
                    self.result["installExitCode"] = installed.exit_code
                raise WorkspaceProviderError("project_dependency_install_failed", result=installed)
            self.check()
            self.supervisor.authorizer(self.store, self.original, self.owner_id)
            if self.original.kind == "runtime.exec":
                self.save("executing")
                visible = script if isinstance(script, str) else f"npm run {command}"
                self._start_visible("command", visible, timeout_seconds=900)
                phase = "executing"
            else:
                self.result["phaseDeadline"] = time.time() + self.supervisor.ready_timeout
                self.save("starting")
                started = self.provider.start_process(self.handle,
                    self.development_server_command(), timeout_seconds=900)
                self._register("server", started.process_id)
                phase = "starting"
        if self.original.kind == "runtime.exec":
            self.run_command()
            return
        pid = self._process("server")
        self.runtime = self.runtime.model_copy(update={"processId": pid})
        if phase == "starting":
            while True:
                self.check()
                self.logs(pid)
                if not self.provider.is_process_running(self.handle, pid):
                    raise WorkspaceProviderError("project_process_exited")
                if self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
                    break
                if time.time() >= self.result["phaseDeadline"]:
                    raise WorkspaceProviderError("project_readiness_timeout")
                self.sleep()
            self.result["readyAt"] = time.time()
        elif not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
            raise WorkspaceProviderError("project_recovery_health_failed")
        previous = published_preview_url(self.runtime.previewUrl)
        self._remember_published_preview()
        now = published_preview_url(self.runtime.previewUrl)
        if phase != "starting" and now and previous != now:
            # 2026-09-16 TicketStream：刚拿到发布地址时停掉旧进程再起一次，
            # 让 __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS 带上 E2B 发布域。
            # 2026-09-18：中继 Host 必须一直在名单里，不能被这次重启换掉。
            # 后续 lease 续上 previous==now，不再重启。
            stopper = getattr(self.provider, "stop", None)
            if callable(stopper):
                stopper(self.handle, pid)
            started = self.provider.start_process(
                self.handle, self.development_server_command(), timeout_seconds=900)
            self._register("server", started.process_id)
            pid = started.process_id
            self.runtime = self.runtime.model_copy(update={"processId": pid})
            if not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision):
                raise WorkspaceProviderError("project_runtime_health_failed")
        self.save("ready")
        next_health = 0
        while True:
            self.check()
            # A formal verification temporarily serves built assets, then starts
            # a fresh dev process. Never retain its predecessor's PID in this loop.
            pid = self._process("server")
            checkpoint_application_data(self)
            if sync_next_source_patch(self):
                next_health = 0
            operation_count = self.store.project_operation_count(self.original.projectId, owner_id=self.owner_id)
            observed = self.operation()
            last_access = max(self.result["readyAt"], observed.lastAccessAt or 0,
                self.store.runtime_patch_activity_at(self.operation_id, owner_id=self.owner_id))
            if time.time() - last_access >= min(float(self.result["idleSeconds"]), self.supervisor.idle_seconds):
                if self.try_finish_idle(operation_count, observed.lastAccessAt):
                    return
                continue
            self.logs(pid)
            if time.time() >= next_health:
                if (not self.provider.is_process_running(self.handle, pid)
                        or not self.provider.probe(self.handle, self.runtime.port, expected_revision=self.runtime.revision)):
                    raise WorkspaceProviderError("project_runtime_health_failed")
                self._remember_published_preview()
                self.save("ready")
                next_health = time.time() + min(30, self.supervisor.lease_ttl / 3)
            if self.supervisor.preview_runtime is not None:
                self.supervisor.preview_runtime.ensure(self)
            checkpoint_application_data(self)
            if run_next_project_verification(self):
                next_health = 0
            checkpoint_application_data(self)
            self.sleep()

    def run_command(self):
        pid = self._process("command")
        self.runtime = self.runtime.model_copy(update={"processId": pid})
        self.save("executing")
        while True:
            self.check()
            self.logs(pid)
            self._flush_stdin()
            if not self.provider.is_process_running(self.handle, pid):
                break
            self.sleep(tight=self._is_console_pid(pid))
        executed = self.provider.process_result(self.handle, pid)
        self.result["exitCode"] = executed.exit_code
        while True:
            previous = self.log_offsets.get(pid, 0)
            if self.logs(pid) == previous:
                break
        self._persist_process_output(pid, executed)
        # 命令结束后都扫。失败也可能已经写出 .pptx；收集 fail-open。
        self._collect_office_artifacts()
        if executed.exit_code is None:
            raise WorkspaceProviderError("project_command_result_unknown", result=executed)
        if executed.exit_code != 0:
            raise WorkspaceProviderError("project_command_failed", result=executed)
        self.check()
        self.finish("completed", "stopped", None)

    def _collect_office_artifacts(self):
        """命令结束后把沙箱里的办公文件提进主机产物库。

        ⚠ 2026-09-20 真机：python generate_deck.py 即使当时写出了 .pptx，
          主机 file_read 也是 project_file_not_found。收集 I/O 失败不许
          改写这次命令的成败（fail-open）；完工闸另看产物（fail-closed）。
        """
        collector = getattr(self.provider, "collect_office_files", None)
        if not callable(collector) or self.handle is None:
            return
        try:
            items = collector(self.handle)
        except Exception:
            logger.warning("office artifact collect failed", exc_info=True)
            return
        if not isinstance(items, list) or not items:
            return
        try:
            store = ProjectOfficeArtifactStore(self.store)
        except Exception:
            logger.warning("office artifact persist failed", exc_info=True)
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            data = item.get("data")
            path = str(item.get("path") or "")
            if not isinstance(data, (bytes, bytearray)):
                continue
            payload = bytes(data)
            if not is_office_artifact_path(path) or not is_office_zip_bytes(payload):
                continue
            try:
                store.put(
                    self.original.projectId,
                    owner_id=self.owner_id,
                    path=path,
                    data=payload,
                )
            except Exception:
                logger.warning("office artifact persist failed", exc_info=True)
                continue
            kept = list(self.result.get("officeFiles") or [])
            if path not in kept:
                kept.append(path)
            self.result["officeFiles"] = kept[:8]

    def _flush_stdin(self):
        pending = self.supervisor.peek_stdin(self.operation_id)
        if not pending:
            return
        writer = getattr(self.provider, "write_console", None)
        if not callable(writer):
            return
        try:
            pid = self._process("command")
        except WorkspaceProviderError:
            return
        for chunk in self.supervisor.take_stdin(self.operation_id):
            try:
                writer(self.handle, pid, chunk["text"], press_enter=chunk.get("pressEnter", True))
            except Exception:
                logger.warning("project stdin not delivered: %s", self.operation_id)

    def _register(self, key, pid, *, console=False):
        if not pid:
            raise WorkspaceProviderError("project_process_identity_missing")
        refs = dict(self.heartbeat.lease.processRefs)
        refs[key] = pid
        if console:
            refs[f"{key}Console"] = "1"
        self.heartbeat.renew(process_refs=refs)

    def _process(self, key):
        pid = self.heartbeat.lease.processRefs.get(key)
        if not isinstance(pid, str) or not pid.isdecimal():
            raise WorkspaceProviderError("runtime_dispatch_uncertain")
        return pid

    def try_finish_idle(self, operation_count, last_access_at):
        """An accepted edit must invalidate a concurrently prepared idle stop.

        2026-09-13: SQLite child admission leaves parent rev unchanged. Counting
        before activity fences that gap; PostgreSQL also locks the parent during
        admission. A CAS miss is normal new
        activity, not provider failure; keep local state and the heartbeat alive
        until the fresh idle-loop read. Total lifetime/cancel cleanup is separate.
        """
        self.heartbeat.check()
        code = "runtime_idle_expired"
        result = {**self.result, "phase": "stopping",
            "cleanup": {"status": "completed", "phase": "expired", "code": code}}
        runtime = self.runtime.model_copy(update={"status": "stopping", "errorCode": code,
            "health": "unknown", "lastHeartbeat": _timestamp()})
        stopped = self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status="running", status="running", runtime=runtime, result=result,
            idle_operation_count=operation_count, idle_last_access_at=last_access_at)
        if stopped is None:
            return False
        self.runtime, self.result = stopped.runtime, dict(stopped.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.finish("completed", "expired", code)
        return True

    def finish(self, status, phase, code):
        if self.operation().status in TERMINAL:
            return
        self.result["cleanup"] = {"status": status, "phase": phase, "code": code}
        self.heartbeat.handle = None
        if status == "cancelled":
            self.save("stopping", status="cancelling", error=code)
        else:
            current = self.operation().status
            self.save("stopping", status="cancelling" if current == "cancelling" else "running", error=code)
        try:
            self.heartbeat.check()
            if self.original.kind == "runtime.start":
                finish_pending_source_patches(self, cancelled=status == "cancelled", error=code or "project_runtime_stopped")
                finish_pending_verifications(self, cancelled=status == "cancelled", error=code or "project_runtime_stopped")
            if self.supervisor.preview_runtime is not None:
                self.supervisor.preview_runtime.revoke(self)
            checkpoint_application_data(self, final=True)
            # 办公命令成功或脚本失败都留下沙盒。Vite 工程仍拆掉。
            keep = (
                bool(self.result.get("keepSandbox"))
                and self.handle is not None
                and self.original.kind == "runtime.exec"
                and status in {"completed", "failed"}
            )
            if self.handle is not None and not keep:
                self.provider.destroy(self.handle)
            if self.provider is None:
                if self.original.runtime is not None or self.handle is not None:
                    raise WorkspaceProviderError("project_provider_unavailable")
            elif not keep:
                for orphan in self.provider.find_workspaces(workspace_id=self.lease.workspaceId):
                    self.heartbeat.check()
                    self.provider.destroy(orphan)
        except ProjectConflict:
            raise
        except Exception:
            self.save("reconciling", status="interrupted", error="project_cleanup_pending")
            # Keep the lease until expiry to bound cleanup retries after outages.
            self.heartbeat.close()
            return
        self.runtime = self.runtime.model_copy(update={"processId": None})
        self.save(phase, status=status, error=code)
        self.heartbeat.close()
        self.store.release_lease(self.original.projectId, owner_id=self.owner_id,
            lease_owner=self.lease.leaseOwner, generation=self.lease.generation,
            clear_runtime=not bool(self.result.get("keepSandbox")))

    def suspend(self, reason):
        checkpoint_application_data(self, force=True)
        phase = self.result.get("phase", self.runtime.status)
        self.save("reconciling", status="interrupted", error=reason)
        if self.supervisor.preview_runtime is not None:
            self.supervisor.preview_runtime.revoke(self)
        # Preserve the last dispatched phase across intentional service shutdown.
        self.result["phase"] = phase
        current = self.operation()
        self.store.update_runtime_operation(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner,
            expected_status=current.status, status=current.status, runtime=self.runtime, result=self.result)
        self.store.flush_operation_event(self.operation_id, owner_id=self.owner_id,
            lease_generation=self.lease.generation, lease_owner=self.lease.leaseOwner)
        self.heartbeat.close()
        self.store.release_lease(self.original.projectId, owner_id=self.owner_id,
            lease_owner=self.lease.leaseOwner, generation=self.lease.generation)
