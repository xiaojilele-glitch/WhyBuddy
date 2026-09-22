"""Lease-owned tunnel installation and rotation, never triggered by a GET.

The sandbox agent holds only a runtime/role-scoped credential. Sources, grants,
dispatch intent and process identities have different owners. An uncertain
process dispatch is blocked until an explicit runtime restart; it is not replayed.
"""
from __future__ import annotations

from pathlib import Path
import time
from typing import Callable

from services.project_preview_access import ProjectPreviewAccess
from services.project_preview_config import origin_for_runtime
from services.workspace_provider import WorkspaceProviderError


class ProjectPreviewRuntime:
    def __init__(self, access: ProjectPreviewAccess, *, agent_bundle: Path, clock: Callable[[], float] = time.time):
        self.access, self.clock = access, clock
        try:
            self.agent_source = agent_bundle.read_text(encoding="utf-8")
        except OSError:
            raise ValueError("project_preview_agent_bundle_missing") from None
        if not self.agent_source or len(self.agent_source.encode("utf-8")) > 512 * 1024:
            raise ValueError("project_preview_agent_bundle_invalid")

    def ensure(self, task) -> None:
        """Called by the runtime.start owner after health, while its lease is held."""
        # Cancellation, shutdown and lease loss belong to the worker lifecycle.
        # A preview failure must never convert these control signals into a
        # successful ready save, or resume remote IO after losing ownership.
        task.check()
        preview = task.result.get("preview") or {}
        if preview.get("phase") == "blocked":
            return
        pid = task.heartbeat.lease.processRefs.get("preview")
        now = self.clock()
        if preview.get("phase") == "dispatching":
            if preview.get("grantId"):
                self.access.revoke_grant(preview["grantId"], owner_id=task.owner_id)
            task.result["preview"] = {"phase": "blocked", "errorCode": "preview_dispatch_uncertain"}
            task.save("ready")
            return
        if preview.get("phase") == "active":
            if not isinstance(pid, str) or not pid.isdecimal():
                if preview.get("grantId"):
                    self.access.revoke_grant(preview["grantId"], owner_id=task.owner_id)
                task.result["preview"] = {"phase": "blocked", "errorCode": "preview_process_identity_missing"}
                task.save("ready")
                return
            same_generation = preview.get("generation") == task.lease.generation
            same_revision = preview.get("revision") == task.runtime.revision
            expiration = preview.get("expiresAt", 0)
            lasts_until_runtime_end = expiration >= (task.runtime.expiresAt or now)
            if same_generation and same_revision and expiration > now and (expiration > now + 15 or lasts_until_runtime_end):
                if now < getattr(task, "_preview_probe_after", 0):
                    return
                task._preview_probe_after = now + 15
                if pid and task.provider.is_process_running(task.handle, pid):
                    return
            # Known process identity: explicitly stop before rotating credentials.
            task.check()
            if pid:
                try:
                    task.provider.stop(task.handle, pid)
                except WorkspaceProviderError:
                    if preview.get("grantId"):
                        self.access.revoke_grant(preview["grantId"], owner_id=task.owner_id)
                    raise
            if preview.get("grantId"):
                self.access.revoke_grant(preview["grantId"], owner_id=task.owner_id)
        remaining = (task.runtime.expiresAt or now) - self.clock()
        if remaining < 2:
            return
        issued = self.access.issue_tunnel_grant(task.operation_id, owner_id=task.owner_id,
            audience=origin_for_runtime(task.runtime.runtimeId), ttl_seconds=min(900, remaining))
        task.result["preview"] = {"phase": "dispatching", "grantId": issued.scope.grant_id,
            "generation": task.lease.generation, "revision": task.runtime.revision, "expiresAt": issued.expires_at}
        try:
            task.save("ready")
            task.check()
        except Exception:
            self.access.revoke_grant(issued.scope.grant_id, owner_id=task.owner_id)
            raise
        try:
            process = task.provider.start_preview_tunnel(task.handle, agent_source=self.agent_source,
                relay_origin=issued.scope.audience, token=issued.secret, port=task.runtime.port,
                expires_at=issued.expires_at)
            if not process.process_id:
                raise WorkspaceProviderError("preview_process_identity_missing")
        except WorkspaceProviderError:
            self.access.revoke_grant(issued.scope.grant_id, owner_id=task.owner_id)
            task.check()
            # A request may have reached envd even if no PID was returned.
            task.result["preview"] = {"phase": "blocked", "errorCode": "preview_dispatch_uncertain"}
            task.save("ready")
            return
        try:
            task.check()
            task._register("preview", process.process_id)
            task.result["preview"]["phase"] = "active"
            task.save("ready")
        except Exception:
            self.access.revoke_grant(issued.scope.grant_id, owner_id=task.owner_id)
            # The worker must handle cancellation/lease uncertainty itself. It
            # owns runtime destruction or reconciliation; do not retry dispatch.
            raise

    def suspend_for_sync(self, task) -> None:
        """The existing runtime owner closes preview before changing its files.

        Revoke all old browser/ticket/tunnel grants, then stop the known tunnel
        process. Unknown dispatch cannot be repaired by dropping its only record
        or by blindly launching a replacement. The caller must reconcile it.
        No application-server process, sandbox identity, or lease changes owner.
        """
        task.check()
        self.access.revoke_runtime(task.operation_id, owner_id=task.owner_id)
        task.check()
        preview = task.result.get("preview") or {}
        refs = dict(task.heartbeat.lease.processRefs)
        pid = refs.get("preview")
        if preview.get("phase") in {"dispatching", "blocked"}:
            raise WorkspaceProviderError("preview_dispatch_uncertain")
        if pid is not None or preview:
            if not isinstance(pid, str) or not pid.isdecimal():
                raise WorkspaceProviderError("preview_process_identity_missing")
            task.provider.stop(task.handle, pid)
            task.check()
            refs.pop("preview", None)
            task.heartbeat.renew(process_refs=refs)
        task.result.pop("preview", None)
        task._preview_probe_after = 0
        task.save("syncing")

    def revoke(self, task) -> None:
        self.access.revoke_runtime(task.operation_id, owner_id=task.owner_id)
