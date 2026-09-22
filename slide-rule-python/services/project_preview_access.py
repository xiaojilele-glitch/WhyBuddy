"""Durable preview capabilities, separate from provider and application state.

2026-09-13: private E2B ingress forwarded its traffic token to application code.
The relay instead needs two disjoint credentials: a browser access grant and a
runtime-scoped tunnel grant. Neither carries E2B management or traffic secrets.

The SQL gateway cannot share transactions across queries. Redeeming a ticket
therefore consumes it and installs the browser grant hash in ONE CAS update.
Authority is checked against a single joined project/operation/lease snapshot;
the write predicates fence changes since that snapshot. Reads never reconnect,
touch activity, renew leases, or trust a generated application's success claim.
"""

from __future__ import annotations

import hashlib
import math
import re
import secrets
import time
import uuid
from dataclasses import dataclass, field, replace
from functools import wraps
from typing import Callable

from models.project_runtime import Project, ProjectOperation, WorkspaceLease
from services.project_store import ProjectStore


class PreviewAccessDenied(PermissionError):
    """Bounded public error; never include supplied credentials or SQL values."""


class _PreviewSnapshotChanged(Exception):
    """A known zero-row CAS/read may race a healthy heartbeat or a revocation."""


def _retry_snapshot(method):
    @wraps(method)
    def checked(*args, **kwargs):
        # Re-run the WHOLE authority path. A lease renewal legitimately changes
        # its payload, but removing that SQL fence would also hide process/mount
        # replacement. Never retry provider IO, unknown SQL outcomes, or denial.
        for _ in range(3):
            try:
                return method(*args, **kwargs)
            except _PreviewSnapshotChanged:
                continue
        raise PreviewAccessDenied("project_preview_changed")
    return checked


@dataclass(frozen=True)
class PreviewAccessScope:
    owner_id: str
    project_id: str
    session_id: str
    operation_id: str
    runtime_id: str
    revision: str
    workspace_id: str
    generation: int
    port: int
    audience: str
    grant_id: str = ""
    expires_at: float = 0

    @property
    def tunnel_id(self) -> str:
        identity = f"{self.operation_id}\0{self.runtime_id}\0{self.generation}"
        return "ptn-" + hashlib.sha256(identity.encode()).hexdigest()[:32]

    def to_wire(self) -> dict:
        return {"ownerId": self.owner_id, "projectId": self.project_id,
            "sessionId": self.session_id, "operationId": self.operation_id,
            "runtimeId": self.runtime_id, "revision": self.revision,
            "workspaceId": self.workspace_id, "generation": self.generation,
            "port": self.port, "audience": self.audience, "grantId": self.grant_id,
            "tunnelId": self.tunnel_id, "expiresAt": self.expires_at}


@dataclass(frozen=True)
class IssuedPreviewCredential:
    kind: str
    scope: PreviewAccessScope
    expires_at: float
    secret: str = field(repr=False)
    access_expires_at: float


_DDL = (
    "create table if not exists wb_project_preview_access (id varchar(80) primary key, credential_hash varchar(64) unique not null, kind varchar(24) not null, owner_id varchar(240) not null, project_id varchar(80) not null, session_id varchar(240) not null, operation_id varchar(80) not null, runtime_id varchar(80) not null, revision varchar(80) not null, workspace_id varchar(100) not null, generation integer not null, lease_owner varchar(240) not null, port integer not null, audience varchar(240) not null, expires_at double precision not null, grant_expires_at double precision not null, consumed_at double precision, revoked_at double precision)",
    "create index if not exists wb_project_preview_operation on wb_project_preview_access(operation_id)",
)


def _audience(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}", value):
        raise ValueError("invalid_preview_audience")
    return value


def _ttl(value: float, maximum: float) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or not 1 <= value <= maximum:
        raise ValueError("invalid_preview_ttl")
    return float(value)


def _digest(secret: str) -> str:
    if not isinstance(secret, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", secret):
        raise PreviewAccessDenied("project_preview_credential_invalid")
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


class ProjectPreviewAccess:
    def __init__(self, store: ProjectStore, *,
                 authorizer: Callable[[ProjectStore, ProjectOperation, str], None],
                 clock: Callable[[], float] = time.time, browser_grant_seconds: float = 300):
        self.store, self.authorizer, self.clock = store, authorizer, clock
        self.browser_grant_seconds = _ttl(browser_grant_seconds, 900)
        for statement in _DDL:
            self.store._q(statement)

    def _authority(self, operation_id: str, owner_id: str, audience: str) -> tuple[PreviewAccessScope, dict]:
        audience = _audience(audience)
        rows = self.store._q(
            "select o.payload as operation_payload,o.rev as operation_rev,p.payload as project_payload,p.current_revision,p.owner_id,l.payload as lease_payload,l.generation,l.lease_owner,l.expires_at as lease_expires_at from wb_project_operation o join wb_project p on p.id=o.project_id join wb_project_lease l on l.project_id=p.id where o.id=$1 and p.owner_id=$2",
            [operation_id, owner_id])
        if not rows:
            raise PreviewAccessDenied("project_preview_unavailable")
        row, now = rows[0], self.clock()
        operation = ProjectOperation.model_validate_json(row["operation_payload"])
        project = Project.model_validate_json(row["project_payload"])
        lease = WorkspaceLease.model_validate_json(row["lease_payload"])
        runtime = operation.runtime
        if (operation.kind != "runtime.start" or operation.status != "running" or operation.cancelRequested
                or runtime is None or runtime.status != "ready" or runtime.health != "revision_verified"
                or runtime.expiresAt is None or not math.isfinite(runtime.expiresAt) or runtime.expiresAt <= now
                or not math.isfinite(row["lease_expires_at"]) or not math.isfinite(lease.expiresAt)
                or row["lease_expires_at"] <= now or lease.expiresAt <= now
                or lease.generation != row["generation"] or lease.leaseOwner != row["lease_owner"]
                or operation.leaseGeneration != lease.generation or operation.leaseOwner != lease.leaseOwner
                or not lease.sandboxId or lease.processRefs.get("operationId") != operation.operationId
                or not runtime.processId or runtime.processId != lease.processRefs.get("server")
                or project.ownerId != owner_id or project.projectId != operation.projectId
                or project.sessionId != operation.sessionId or runtime.projectId != project.projectId
                or lease.projectId != project.projectId or runtime.workspaceId != lease.workspaceId
                or project.currentRevision != row["current_revision"]
                # expectedRevision records the original runtime.start request.
                # A lease-owned sync may advance this same runtime without
                # rewriting that idempotency identity. Access follows the live
                # mounted revision and is still exact-version scoped.
                or project.currentRevision != runtime.revision
                or lease.mountedRevision != runtime.revision or type(runtime.port) is not int
                or not 1024 <= runtime.port <= 65535 or runtime.port != operation.input.get("port", 5173)):
            raise PreviewAccessDenied("project_preview_unavailable")
        # The host's existing approval function rechecks durable session/plan and
        # revision.planRef. Injection avoids a cycle when the worker issues grants.
        self.authorizer(self.store, operation, owner_id)
        if runtime.expiresAt <= self.clock():
            raise PreviewAccessDenied("project_preview_unavailable")
        scope = PreviewAccessScope(owner_id, project.projectId, project.sessionId, operation.operationId,
            runtime.runtimeId, runtime.revision, runtime.workspaceId, lease.generation, runtime.port, audience)
        row["runtime_expires_at"] = runtime.expiresAt
        return scope, row

    def _fence(self, scope: PreviewAccessScope, row: dict, params: list) -> str:
        first = len(params) + 1
        params.extend([scope.operation_id, row["operation_rev"], scope.project_id, scope.owner_id,
            scope.revision, scope.generation, row["lease_owner"], self.clock(), row["runtime_expires_at"], row["lease_payload"]])
        p = lambda offset: "$" + str(first + offset)
        return (f"exists(select 1 from wb_project_operation o join wb_project p on p.id=o.project_id "
            f"join wb_project_lease l on l.project_id=p.id where o.id={p(0)} and o.rev={p(1)} "
            f"and p.id={p(2)} and p.owner_id={p(3)} and p.current_revision={p(4)} "
            f"and l.generation={p(5)} and l.lease_owner={p(6)} and l.expires_at>{p(7)} and {p(8)}>{p(7)} and l.payload={p(9)})")

    @_retry_snapshot
    def _issue(self, kind: str, operation_id: str, owner_id: str, audience: str,
               ttl_seconds: float) -> IssuedPreviewCredential:
        ttl_seconds = _ttl(ttl_seconds, 120 if kind == "browser-ticket" else 900)
        scope, row = self._authority(operation_id, owner_id, audience)
        now, secret = self.clock(), secrets.token_urlsafe(32)
        expires = min(now + ttl_seconds, row["runtime_expires_at"])
        grant_expires = min(now + self.browser_grant_seconds, row["runtime_expires_at"])
        if kind == "browser-ticket":
            expires = min(expires, grant_expires)
        params = ["pva-" + uuid.uuid4().hex, _digest(secret), kind, scope.owner_id, scope.project_id,
            scope.session_id, scope.operation_id, scope.runtime_id, scope.revision, scope.workspace_id,
            scope.generation, row["lease_owner"], scope.port, scope.audience, expires, grant_expires]
        fence = self._fence(scope, row, params)
        inserted = self.store._q(
            "insert into wb_project_preview_access(id,credential_hash,kind,owner_id,project_id,session_id,operation_id,runtime_id,revision,workspace_id,generation,lease_owner,port,audience,expires_at,grant_expires_at) select "
            + ",".join("$" + str(i) for i in range(1, 17)) + " where " + fence + " returning id", params)
        if not inserted:
            raise _PreviewSnapshotChanged()
        return IssuedPreviewCredential(kind, replace(scope, grant_id=params[0], expires_at=expires), expires, secret,
            grant_expires if kind == "browser-ticket" else expires)

    def issue_browser_ticket(self, operation_id: str, *, owner_id: str, audience: str,
                             ttl_seconds: float = 60) -> IssuedPreviewCredential:
        return self._issue("browser-ticket", operation_id, owner_id, audience, ttl_seconds)

    def issue_tunnel_grant(self, operation_id: str, *, owner_id: str, audience: str,
                           ttl_seconds: float = 300) -> IssuedPreviewCredential:
        return self._issue("tunnel", operation_id, owner_id, audience, ttl_seconds)

    def _lookup(self, secret: str, kind: str, audience: str) -> tuple[dict, PreviewAccessScope, dict]:
        rows = self.store._q(
            "select * from wb_project_preview_access where credential_hash=$1 and kind=$2 and audience=$3 and revoked_at is null and expires_at>$4",
            [_digest(secret), kind, _audience(audience), self.clock()])
        if not rows:
            raise PreviewAccessDenied("project_preview_credential_invalid")
        saved = rows[0]
        scope, authority = self._authority(saved["operation_id"], saved["owner_id"], audience)
        self._check_saved_scope(saved, scope, authority)
        return saved, replace(scope, grant_id=saved["id"],
            expires_at=min(saved["expires_at"], authority["runtime_expires_at"])), authority

    @staticmethod
    def _check_saved_scope(saved: dict, scope: PreviewAccessScope, authority: dict) -> None:
        if (any(getattr(scope, name) != saved[name] for name in (
                "owner_id", "project_id", "session_id", "operation_id", "runtime_id", "revision",
                "workspace_id", "generation", "port", "audience"))
                or saved["lease_owner"] != authority["lease_owner"]):
            raise PreviewAccessDenied("project_preview_binding_changed")

    @_retry_snapshot
    def ready_scope(self, operation_id: str, *, owner_id: str, audience: str) -> PreviewAccessScope:
        scope, authority = self._authority(operation_id, owner_id, audience)
        params: list = []
        fence = self._fence(scope, authority, params)
        if not self.store._q("select 1 as ready where " + fence, params):
            raise _PreviewSnapshotChanged()
        return replace(scope, expires_at=authority["runtime_expires_at"])

    @_retry_snapshot
    def has_active_tunnel(self, operation_id: str, *, owner_id: str, audience: str) -> bool:
        """An issued tunnel is not proof that its socket is currently connected."""
        scope, authority = self._authority(operation_id, owner_id, audience)
        rows = self.store._q(
            "select * from wb_project_preview_access where operation_id=$1 and owner_id=$2 and audience=$3 and kind='tunnel' and revoked_at is null and expires_at>$4",
            [operation_id, owner_id, audience, self.clock()])
        changed = False
        for saved in rows:
            try:
                self._check_saved_scope(saved, scope, authority)
            except PreviewAccessDenied:
                continue
            params = [saved["id"], self.clock()]
            fence = self._fence(scope, authority, params)
            if self.store._q("select id from wb_project_preview_access where id=$1 and kind='tunnel' and revoked_at is null and expires_at>$2 and " + fence, params):
                return True
            changed = True
        if changed:
            raise _PreviewSnapshotChanged()
        return False

    @_retry_snapshot
    def redeem_browser_ticket(self, secret: str, *, audience: str) -> IssuedPreviewCredential:
        saved, scope, authority = self._lookup(secret, "browser-ticket", audience)
        grant_secret, now = secrets.token_urlsafe(32), self.clock()
        expires = min(saved["grant_expires_at"], authority["runtime_expires_at"])
        if expires <= now:
            raise PreviewAccessDenied("project_preview_credential_invalid")
        params = [_digest(grant_secret), expires, now, saved["id"], _digest(secret), now]
        fence = self._fence(scope, authority, params)
        changed = self.store._q(
            "update wb_project_preview_access set credential_hash=$1,kind='browser',expires_at=$2,consumed_at=$3 where id=$4 and credential_hash=$5 and kind='browser-ticket' and consumed_at is null and revoked_at is null and expires_at>$6 and "
            + fence + " returning id", params)
        if not changed:
            raise _PreviewSnapshotChanged()
        return IssuedPreviewCredential("browser", replace(scope, expires_at=expires), expires, grant_secret, expires)

    @_retry_snapshot
    def _authorize(self, secret: str, kind: str, audience: str) -> PreviewAccessScope:
        saved, scope, authority = self._lookup(secret, kind, audience)
        # Recheck the credential and authority in one read after the approval
        # callback. A concurrent cancellation/revoke cannot use the old snapshot.
        params = [saved["id"], _digest(secret), kind, audience, self.clock()]
        fence = self._fence(scope, authority, params)
        rows = self.store._q(
            "select id from wb_project_preview_access where id=$1 and credential_hash=$2 and kind=$3 and audience=$4 and revoked_at is null and expires_at>$5 and "
            + fence, params)
        if not rows:
            raise _PreviewSnapshotChanged()
        return scope

    def authorize_browser(self, secret: str, *, audience: str) -> PreviewAccessScope:
        return self._authorize(secret, "browser", audience)

    def authorize_tunnel(self, secret: str, *, audience: str) -> PreviewAccessScope:
        return self._authorize(secret, "tunnel", audience)

    @_retry_snapshot
    def validate_binding(self, binding: dict, *, audience: str) -> PreviewAccessScope:
        """Only for the authenticated relay, rechecking an already issued scope.

        The row ID is essential: revoking and later issuing a fresh grant under
        the same lease generation must never reactivate an old connection.
        """
        if not isinstance(binding, dict) or not isinstance(binding.get("grantId"), str):
            raise PreviewAccessDenied("project_preview_binding_invalid")
        rows = self.store._q(
            "select * from wb_project_preview_access where id=$1 and audience=$2 and kind in ('browser','tunnel') and revoked_at is null and expires_at>$3",
            [binding["grantId"], _audience(audience), self.clock()])
        if not rows:
            raise PreviewAccessDenied("project_preview_binding_invalid")
        saved = rows[0]
        scope, authority = self._authority(saved["operation_id"], saved["owner_id"], audience)
        self._check_saved_scope(saved, scope, authority)
        scope = replace(scope, grant_id=saved["id"], expires_at=min(saved["expires_at"], authority["runtime_expires_at"]))
        if binding != scope.to_wire() or saved["lease_owner"] != authority["lease_owner"]:
            raise PreviewAccessDenied("project_preview_binding_changed")
        params = [saved["id"], self.clock()]
        fence = self._fence(scope, authority, params)
        if not self.store._q("select id from wb_project_preview_access where id=$1 and revoked_at is null and expires_at>$2 and " + fence, params):
            raise _PreviewSnapshotChanged()
        return scope

    def revoke_grant(self, grant_id: str, *, owner_id: str) -> None:
        rows = self.store._q("select operation_id from wb_project_preview_access where id=$1 and owner_id=$2",
            [grant_id, owner_id])
        if not rows:
            raise PreviewAccessDenied("project_preview_credential_invalid")
        self.store.get_operation(rows[0]["operation_id"], owner_id=owner_id)
        self.store._q("update wb_project_preview_access set revoked_at=$1 where id=$2 and owner_id=$3 and revoked_at is null",
            [self.clock(), grant_id, owner_id])

    def revoke_runtime(self, operation_id: str, *, owner_id: str, reason: str = "revoked") -> None:
        # Revocation remains available while the runtime is offline/not ready.
        # Owner lookup fails without disclosing whether another user's run exists.
        self.store.get_operation(operation_id, owner_id=owner_id)
        self.store._q("update wb_project_preview_access set revoked_at=$1 where operation_id=$2 and owner_id=$3 and revoked_at is null",
            [self.clock(), operation_id, owner_id])
