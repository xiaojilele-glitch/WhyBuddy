"""Owner ticket issuance and private relay authority; never performs provider IO.

The gateway exchanges a single-use URL ticket for its own browser cookie. It
rechecks every request/connection against Python's durable generation and grant
row, using a separate server credential rather than forwarding workbench auth.
"""

from __future__ import annotations

import secrets
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from middlewares.current_user import CurrentUser
from models.project_runtime import PreviewDescriptor
from services.project_acceptance import template_verification_capabilities
from services.project_access import project_access_enabled
from services.project_rollout import rollout_readiness
from services.project_creation import load_authorized_session
from services.project_preview_access import PreviewAccessDenied, ProjectPreviewAccess
from services.project_preview_config import (
    gateway_key,
    origin_for_runtime,
    preview_configuration_enabled,
    published_preview_url,
)
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable


router = APIRouter(tags=["Project preview"])


class RedeemPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket: str = Field(min_length=43, max_length=43)
    audience: str = Field(min_length=1, max_length=240)


class AuthorizePreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["browser", "tunnel", "binding"]
    token: str | None = Field(default=None, min_length=43, max_length=43)
    binding: dict | None = None
    audience: str = Field(min_length=1, max_length=240)

    @model_validator(mode="after")
    def check_role(self):
        if self.role == "binding":
            valid = self.binding is not None and self.token is None
        else:
            valid = self.token is not None and self.binding is None
        if not valid:
            raise ValueError("project_preview_role_payload_invalid")
        return self


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def _gate(viewer) -> None:
    if not project_access_enabled(viewer):
        raise HTTPException(status_code=503, detail="project_preview_not_enabled")


def _access(request: Request) -> ProjectPreviewAccess:
    access = getattr(request.app.state, "project_preview_access", None)
    if access is None:
        raise HTTPException(status_code=503, detail="project_preview_unavailable")
    return access


@contextmanager
def _errors():
    try:
        yield
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_preview_unavailable") from exc
    except (PermissionError, ProjectConflict) as exc:
        raise HTTPException(status_code=403, detail="project_preview_denied") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="project_preview_configuration_invalid") from exc


def _relay(request: Request) -> ProjectPreviewAccess:
    # Relay traffic is authenticated by its independent bearer. Do not invent a
    # synthetic administrator here: allowlist rollout must still permit the
    # gateway to serve already-authorized users while Python owns the grant.
    if not rollout_readiness()["configured"]:
        raise HTTPException(status_code=503, detail="project_preview_not_enabled")
    try:
        expected = "Bearer " + gateway_key()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="project_preview_gateway_not_configured") from exc
    supplied = request.headers.get("authorization", "")
    if not secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="project_preview_gateway_unauthorized")
    return _access(request)


def _latest_runtime(access: ProjectPreviewAccess, project_id: str, owner_id: str):
    # IDs are random UUIDs. Walking the existing keyset pages avoids mistaking a
    # lexicographically large ID (or a later exec command) for the latest start.
    newest, cursor = None, ""
    while True:
        page = access.store.list_project_operations(project_id, owner_id=owner_id, after_id=cursor, limit=100)
        for operation in page:
            if operation.kind == "runtime.start" and (newest is None or
                    (operation.createdAt, operation.operationId) > (newest.createdAt, newest.operationId)):
                newest = operation
        if len(page) < 100:
            return newest
        cursor = page[-1].operationId


@router.get("/projects/{project_id}/preview")
def get_project_preview(project_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _errors():
        access, owner_id = _access(request), str(viewer.id)
        project = access.store.get_project(project_id, owner_id=owner_id)
        load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=None)
        rollout = rollout_readiness()
        # 2026-09-13: internal mode permits source work and sandbox execution
        # without a relay. Waiting until ready to disclose that missing config
        # sent users through a paid startup which could never provide preview.
        # Keep runtime state intact; this is only its observation reason. Ready
        # runtimes still recheck authority below before reporting configuration.
        pending_reason = (
            "project_rollout_disabled" if rollout["mode"] == "disabled" else
            "project_preview_not_configured" if not preview_configuration_enabled() else None
        )
        operation = _latest_runtime(access, project_id, owner_id)
        if operation is None:
            reason = pending_reason or "project_runtime_not_started"
            return {"operationId": None, "descriptor": None, "available": False, "reason": reason}
        runtime = operation.runtime
        revision = access.store.get_revision(project_id, runtime.revision if runtime else None, owner_id=owner_id)
        descriptor = None if runtime is None else PreviewDescriptor(projectId=project_id,
            runtimeId=runtime.runtimeId, revision=runtime.revision, status=runtime.status,
            capabilities=template_verification_capabilities(revision.templateVersion),
            expiresAt=_iso(runtime.expiresAt) if runtime.expiresAt else None)
        available, reason = False, pending_reason or "project_runtime_not_ready"
        if runtime is not None and runtime.status == "ready":
            # A missing relay configuration must not preserve a stale ready state
            # for a cancelled/expired/replaced runtime. Check authority regardless.
            try:
                access.ready_scope(operation.operationId, owner_id=owner_id, audience="preview-observation")
            except (PermissionError, ProjectConflict):
                if rollout["mode"] == "disabled":
                    # During rollback no preview grant is expected to exist;
                    # keep the durable runtime observable and expose the gate.
                    reason = "project_rollout_disabled"
                else:
                    descriptor = descriptor.model_copy(update={"status": "reconciling"})
                    reason = "project_preview_binding_changed"
            else:
                if rollout["mode"] == "disabled":
                    # Rollback keeps owned observation available, but must explain
                    # why a ready runtime cannot be opened or extended.
                    reason = "project_rollout_disabled"
                else:
                    if not preview_configuration_enabled():
                        reason = "project_preview_not_configured"
                    else:
                        audience = origin_for_runtime(runtime.runtimeId)
                        available = access.has_active_tunnel(operation.operationId, owner_id=owner_id, audience=audience)
                        if not available and rollout["mode"] == "internal":
                            available = published_preview_url(runtime.previewUrl) is not None
                        reason = None if available else "project_preview_tunnel_not_started"
        return {"operationId": operation.operationId,
            "descriptor": descriptor.model_dump(mode="json") if descriptor else None,
            "available": available, "reason": reason}


@router.post("/project-operations/{operation_id}/preview-ticket")
def issue_project_preview_ticket(operation_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _errors():
        access, owner_id = _access(request), str(viewer.id)
        operation = access.store.get_operation(operation_id, owner_id=owner_id)
        _gate(viewer)
        if not preview_configuration_enabled():
            raise HTTPException(status_code=503, detail="project_preview_not_configured")
        if operation.runtime is None or operation.runtime.status != "ready":
            raise PreviewAccessDenied("project_runtime_not_ready")
        audience = origin_for_runtime(operation.runtime.runtimeId)
        published = published_preview_url(operation.runtime.previewUrl) if rollout_readiness()["mode"] == "internal" else None
        if access.has_active_tunnel(operation_id, owner_id=owner_id, audience=audience):
            credential = access.issue_browser_ticket(operation_id, owner_id=owner_id, audience=audience)
            # A ticket can be exchanged for 60 seconds; its browser grant remains
            # valid until the separate fixed deadline. Using ticket expiry for the
            # mounted iframe previously closed working applications after one minute.
            return {"entryUrl": audience + "/_whybuddy/authorize?ticket=" + credential.secret,
                "projectId": credential.scope.project_id, "operationId": credential.scope.operation_id,
                "runtimeId": credential.scope.runtime_id, "revision": credential.scope.revision,
                "ticketExpiresAt": _iso(credential.expires_at), "accessExpiresAt": _iso(credential.access_expires_at)}
        if published is None:
            raise HTTPException(status_code=503, detail="project_preview_tunnel_not_started")
        now = time.time()
        access_expires = min(now + 300, operation.runtime.expiresAt or now + 300)
        ticket_expires = min(now + 60, access_expires)
        return {"entryUrl": published,
            "projectId": operation.runtime.projectId, "operationId": operation.operationId,
            "runtimeId": operation.runtime.runtimeId, "revision": operation.runtime.revision,
            "ticketExpiresAt": _iso(ticket_expires), "accessExpiresAt": _iso(access_expires)}


@router.post("/project-operations/{operation_id}/preview/revoke")
def revoke_project_preview(operation_id: str, request: Request, viewer: CurrentUser):
    with _errors():
        access = _access(request)
        access.store.get_operation(operation_id, owner_id=str(viewer.id))
        _gate(viewer)
        access.revoke_runtime(operation_id, owner_id=str(viewer.id))
        return {"ok": True}


@router.post("/internal/project-preview/redeem")
def redeem_project_preview(body: RedeemPreviewRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    access = _relay(request)
    with _errors():
        grant = access.redeem_browser_ticket(body.ticket, audience=body.audience)
        return {"token": grant.secret, "binding": grant.scope.to_wire()}


@router.post("/internal/project-preview/authorize")
def authorize_project_preview(body: AuthorizePreviewRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    access = _relay(request)
    with _errors():
        if body.role == "binding":
            scope = access.validate_binding(body.binding, audience=body.audience)
        elif body.role == "browser":
            scope = access.authorize_browser(body.token, audience=body.audience)
        else:
            scope = access.authorize_tunnel(body.token, audience=body.audience)
        return {"ok": True, "binding": scope.to_wire()}
