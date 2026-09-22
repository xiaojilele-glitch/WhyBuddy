"""Durable runtime commands and cursor-based observation; private preview stays gated.

HTTP owns no remote process. Dropping a response cannot cancel an operation;
the explicit cancel endpoint persists intent even while the worker is offline.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Literal
from contextlib import contextmanager

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from config.settings import settings
from middlewares.current_user import CurrentUser
from models.project_runtime import ProjectOperationSnapshot, RuntimeEventPage
from services.project_runtime_worker import approved_reference as _approved_reference
from services.project_access import project_access_enabled, project_read_access
from services.project_rollout import rollout_readiness
from services.project_creation import create_session_project, load_authorized_session
from services.project_authority import verification_with_current_authority
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, get_project_store
from services.project_verification_store import ProjectVerificationStore


router = APIRouter(tags=["Project runtime"])


class StartRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    port: int = Field(default=5173, ge=1024, le=65535)
    expectedRevision: str = Field(min_length=1, max_length=256)
    approvalRef: str = Field(min_length=1, max_length=512)
    idempotencyKey: str = Field(min_length=1, max_length=256, pattern=r"\S")


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approvalRef: str = Field(min_length=1, max_length=512)
    templateId: Literal["react-vite", "react-vite-tasks"] = "react-vite"


class VerifyProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedRevision: str = Field(min_length=1, max_length=256)
    idempotencyKey: str = Field(min_length=1, max_length=256, pattern=r"\S")


def _internal_gate(viewer) -> None:
    if not project_access_enabled(viewer):
        raise HTTPException(status_code=503, detail="project_preview_not_enabled")


def _read_gate(viewer) -> None:
    if not project_read_access(viewer):
        raise HTTPException(status_code=401, detail="login_required")


@contextmanager
def _store_errors():
    try:
        yield
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
    except ProjectConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProjectStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="project_runtime_unavailable") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="project_plan_approval_required") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _runtime_response(runtime):
    if runtime is None:
        return None
    value = runtime.model_dump(mode="json") if hasattr(runtime, "model_dump") else runtime
    return {key: value.get(key) for key in (
        "runtimeId", "workspaceId", "projectId", "revision", "status", "port", "health",
        "lastHeartbeat", "expiresAt", "errorCode",
    )}


@router.post("/sessions/{session_id}/project", status_code=201)
def create_project(session_id: str, body: CreateProjectRequest, viewer: CurrentUser):
    _internal_gate(viewer)
    with _store_errors():
        project = create_session_project(get_project_store(), session_id,
            owner_id=str(viewer.id), approval_ref=body.approvalRef, template_id=body.templateId)
        return {"project": project.model_dump(mode="json"), "verification": "not_run"}


@router.get("/sessions/{session_id}/project")
def get_session_project(session_id: str, viewer: CurrentUser):
    _read_gate(viewer)
    with _store_errors():
        load_authorized_session(session_id, owner_id=str(viewer.id), approval_ref=None)
        project = get_project_store().get_project_for_session(session_id, owner_id=str(viewer.id))
        return {"project": project.model_dump(mode="json") if project else None, "verification": "not_run"}


@router.get("/project-capabilities")
def get_project_capabilities(viewer: CurrentUser):
    status = rollout_readiness()
    return {**status, "canExecute": project_access_enabled(viewer),
        "canReadOwnedProjects": project_read_access(viewer)}


def _snapshot_response(snapshot):
    operation = snapshot["operation"]
    value = operation.model_dump(mode="json")
    runtime = _runtime_response(snapshot["runtime"])
    if (runtime is not None and operation.status not in {"completed", "failed", "cancelled"}
            and (snapshot.get("leaseExpiresAt") or 0) <= time.time()):
        runtime = {**runtime, "status": "reconciling", "health": "unknown", "errorCode": "workspace_lease_expired"}
    return {"operation": {key: value[key] for key in (
        "operationId", "projectId", "sessionId", "kind", "expectedRevision", "status",
        "cancelRequested", "lastAccessAt", "stateVersion", "createdAt", "updatedAt",
    )}, "runtime": runtime, "lastSeq": snapshot["lastSeq"]}


def _event_response(event):
    # Outbox payloads are internal records. A new provider field must not become
    # public merely because a worker starts persisting it.
    payload = {}
    if event.type == "runtime.state":
        payload = {key: event.payload.get(key) for key in (
            "operationId", "status", "cancelRequested", "stateVersion", "updatedAt",
        )}
        payload["runtime"] = _runtime_response(event.payload.get("runtime"))
    elif event.type == "runtime.log":
        payload = {key: event.payload.get(key) for key in ("text", "nextOffset", "truncated")}
    elif event.type == "runtime.console":
        # Raw PTY bytes. processId stays internal — same as runtime.log.
        payload = {key: event.payload.get(key) for key in ("data", "nextOffset", "truncated")}
    return {"schemaVersion": event.schemaVersion, "sessionId": event.sessionId,
        "projectId": event.projectId, "operationId": event.operationId,
        "seq": event.seq, "type": event.type, "timestamp": event.timestamp, "payload": payload}


@router.post("/projects/{project_id}/runtime/start", status_code=202, response_model=ProjectOperationSnapshot)
def start_project_runtime(project_id: str, body: StartRuntimeRequest, request: Request, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        project = store.get_project(project_id, owner_id=owner_id)
        state = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=body.approvalRef)
        if state.runtimeKind != "project" or state.projectId != project.projectId:
            raise ProjectConflict("project_session_binding_required")
        revision = store.get_revision(project_id, owner_id=owner_id)
        # The supervisor/store distinguish an identical historical start request
        # from a new stale request. The runtime may already serve a child revision.
        if revision.planRef != body.approvalRef:
            raise PermissionError("project_plan_approval_required")
        _internal_gate(viewer)
        supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
        if supervisor is None or not supervisor.running:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        operation = supervisor.submit(project_id, owner_id=owner_id,
            expected_revision=body.expectedRevision, approval_ref=body.approvalRef,
            idempotency_key=body.idempotencyKey, port=body.port)
        return _snapshot_response(store.snapshot_operation(operation.operationId, owner_id=owner_id))


_WAKE_DONE = {"expired", "stopped", "failed"}
_WAKE_DONE_OP = {"completed", "cancelled", "failed"}


def _wake_idempotency_key(store, project_id: str, revision: str, owner_id: str) -> str:
    """Reuse the live wake start; mint a new key once that runtime is terminal.

    2026-09-16 TicketStream：固定 `preview-wake:{project}:{revision}` 在第一次
    唤醒后写死。sandbox 过期后再点唤醒，create_operation 原样交回过期那条，
    工作台一直「正在启动」，iframe 永远不会出现。
    """
    prefix = f"preview-wake:{project_id}:{revision}"
    newest, cursor = None, ""
    while True:
        page = store.list_project_operations(project_id, owner_id=owner_id, after_id=cursor, limit=100)
        for operation in page:
            if operation.kind == "runtime.start" and operation.idempotencyKey.startswith(prefix):
                if newest is None or (operation.createdAt, operation.operationId) > (
                        newest.createdAt, newest.operationId):
                    newest = operation
        if len(page) < 100:
            break
        cursor = page[-1].operationId
    if newest is None:
        return prefix
    runtime_status = newest.runtime.status if newest.runtime else None
    if (newest.cancelRequested or newest.status in _WAKE_DONE_OP
            or runtime_status in _WAKE_DONE):
        return f"{prefix}:{int(time.time())}"
    return newest.idempotencyKey


@router.post("/projects/{project_id}/preview/wake", status_code=202, response_model=ProjectOperationSnapshot)
def wake_project_preview(project_id: str, request: Request, viewer: CurrentUser):
    """Restart an expired/stopped runtime from the bound session's approved plan.

    GET /preview is observation-only. The paused-face button must not invent an
    approval hash or silently re-poll; the host already has the plan binding.
    """
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        project = store.get_project(project_id, owner_id=owner_id)
        state = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=None)
        approval = _approved_reference(state)
        body = StartRuntimeRequest(
            expectedRevision=project.currentRevision,
            approvalRef=approval,
            idempotencyKey=_wake_idempotency_key(store, project_id, project.currentRevision, owner_id),
        )
    return start_project_runtime(project_id, body, request, viewer)


@router.get("/project-operations/{operation_id}", response_model=ProjectOperationSnapshot)
def get_project_operation(operation_id: str, viewer: CurrentUser):
    with _store_errors():
        snapshot = get_project_store().snapshot_operation(operation_id, owner_id=str(viewer.id))
        _read_gate(viewer)
        return _snapshot_response(snapshot)


@router.post("/project-operations/{operation_id}/cancel", status_code=202, response_model=ProjectOperationSnapshot)
def cancel_project_operation(operation_id: str, request: Request, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=owner_id)
        _read_gate(viewer)
        supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
        if supervisor is not None and supervisor.running:
            supervisor.cancel(operation_id, owner_id=owner_id)
        else:
            store.request_operation_cancel(operation_id, owner_id=owner_id)
        return _snapshot_response(store.snapshot_operation(operation_id, owner_id=owner_id))


@router.get("/project-operations/{operation_id}/events", response_model=RuntimeEventPage)
def list_project_operation_events(operation_id: str, viewer: CurrentUser,
        afterSeq: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=200)):
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=str(viewer.id))
        _read_gate(viewer)
        events = store.list_events(operation_id, owner_id=str(viewer.id), after_seq=afterSeq, limit=limit + 1)
        selected = events[:limit]
        return {"events": [_event_response(event) for event in selected],
            "nextSeq": selected[-1].seq if selected else afterSeq, "hasMore": len(events) > limit}


#: 浏览器只挂这一根 SSE。有字节就推，没有就等 notify，不再 200ms 空打 afterSeq。
_STREAM_WAIT_SECONDS = 0.25
_STREAM_HEARTBEAT_SECONDS = 15.0
_STREAM_TERMINAL = frozenset({"completed", "failed", "cancelled"})


async def _operation_event_sse(store, operation_id: str, owner_id: str, after_seq: int):
    """先补齐游标后面的事件，再等下一条。终态且追平才 settled。"""
    cursor = after_seq
    last_beat = time.monotonic()
    while True:
        events = await asyncio.to_thread(
            store.list_events, operation_id, owner_id=owner_id, after_seq=cursor, limit=200)
        if events:
            for event in events:
                cursor = event.seq
                yield (
                    f"id: {event.seq}\n"
                    f"data: {json.dumps(_event_response(event), ensure_ascii=False)}\n\n"
                )
            last_beat = time.monotonic()
            continue
        operation = await asyncio.to_thread(store.get_operation, operation_id, owner_id=owner_id)
        if operation.status in _STREAM_TERMINAL:
            yield (
                "data: " + json.dumps({
                    "type": "runtime.settled",
                    "operationId": operation_id,
                    "status": operation.status,
                    "lastSeq": cursor,
                }, ensure_ascii=False) + "\n\n"
            )
            return
        now = time.monotonic()
        if now - last_beat >= _STREAM_HEARTBEAT_SECONDS:
            yield ": keepalive\n\n"
            last_beat = now
        await asyncio.to_thread(store.wait_for_events, operation_id, _STREAM_WAIT_SECONDS)


@router.get("/project-operations/{operation_id}/events/stream")
async def stream_project_operation_events(
        operation_id: str, request: Request, viewer: CurrentUser,
        afterSeq: int = Query(default=0, ge=0)):
    """PTY / 日志的发布订阅。浏览器 EventSource，只在事件到时才有帧。"""
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=str(viewer.id))
        _read_gate(viewer)
    header = (request.headers.get("last-event-id") or "").strip()
    cursor = afterSeq
    if header.isdigit():
        cursor = max(cursor, int(header))
    return StreamingResponse(
        _operation_event_sse(store, operation_id, str(viewer.id), cursor),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/project-operations/{operation_id}/touch", response_model=ProjectOperationSnapshot)
def touch_project_operation(operation_id: str, viewer: CurrentUser):
    owner_id = str(viewer.id)
    with _store_errors():
        store = get_project_store()
        store.get_operation(operation_id, owner_id=owner_id)
        _internal_gate(viewer)
        store.touch_operation(operation_id, owner_id=owner_id)
        return _snapshot_response(store.snapshot_operation(operation_id, owner_id=owner_id))


@router.get("/projects/{project_id}/runtime/lease")
def get_project_runtime_lease(project_id: str, viewer: CurrentUser):
    with _store_errors():
        lease = get_project_store().get_lease(project_id, owner_id=str(viewer.id))
        return {"lease": ({"workspaceId": lease.workspaceId, "projectId": lease.projectId,
            "generation": lease.generation, "expiresAt": lease.expiresAt,
            "mountedRevision": lease.mountedRevision} if lease else None)}


def _verification_service(request):
    supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
    if supervisor is None:
        raise ProjectStoreUnavailable("project_worker_unavailable")
    return supervisor


def _verification_records(request):
    supervisor = getattr(request.app.state, "project_runtime_supervisor", None)
    return supervisor.verification_store if supervisor is not None else ProjectVerificationStore(get_project_store())


@router.post("/project-operations/{operation_id}/verify", status_code=202)
def verify_project_runtime(operation_id: str, body: VerifyProjectRequest, request: Request, viewer: CurrentUser):
    with _store_errors():
        store, owner_id = get_project_store(), str(viewer.id)
        operation = store.get_operation(operation_id, owner_id=owner_id)
        authority = load_authorized_session(operation.sessionId, owner_id=owner_id, approval_ref=None)
        _internal_gate(viewer)
        child = _verification_service(request).submit_verification(operation_id, owner_id=owner_id,
            expected_revision=body.expectedRevision, approval_ref=_approved_reference(authority),
            idempotency_key=body.idempotencyKey)
        return {"operationId": child.operationId, "status": child.status}


@router.get("/projects/{project_id}/verification")
def latest_project_verification(project_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _store_errors():
        store, owner_id = get_project_store(), str(viewer.id)
        project = store.get_project(project_id, owner_id=owner_id)
        authority = load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=None)
        _read_gate(viewer)
        records = _verification_records(request)
        newest, cursor = None, ""
        while True:
            page = store.list_project_operations(project_id, owner_id=owner_id, after_id=cursor, limit=100)
            for item in page:
                if item.kind == "runtime.verify" and (newest is None or
                        (item.createdAt, item.operationId) > (newest.createdAt, newest.operationId)):
                    newest = item
            if len(page) < 100:
                break
            cursor = page[-1].operationId
        snapshot = verification_with_current_authority(records.for_operation(newest.operationId,
            owner_id=owner_id), authority) if newest else None
        return {"operationId": newest.operationId if newest else None,
            "operationStatus": newest.status if newest else None,
            "snapshot": snapshot.model_dump(mode="json") if snapshot else None}


@router.get("/project-verifications/{verification_id}")
def read_project_verification(verification_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _store_errors():
        store, owner_id = get_project_store(), str(viewer.id)
        records = _verification_records(request)
        record = records.get(verification_id, owner_id=owner_id).verification
        child = store.get_operation(record.operationId, owner_id=owner_id)
        authority = load_authorized_session(child.sessionId, owner_id=owner_id, approval_ref=None)
        _read_gate(viewer)
        snapshot = verification_with_current_authority(records.for_operation(child.operationId, owner_id=owner_id), authority)
        if snapshot is None:
            raise ProjectNotFound("project_verification_not_found")
        return snapshot.model_dump(mode="json")


@router.get("/project-verifications/{verification_id}/artifacts/{artifact_id}")
def read_project_verification_artifact(verification_id: str, artifact_id: str, request: Request, viewer: CurrentUser):
    with _store_errors():
        store, owner_id = get_project_store(), str(viewer.id)
        records = _verification_records(request)
        record = records.get(verification_id, owner_id=owner_id).verification
        child = store.get_operation(record.operationId, owner_id=owner_id)
        load_authorized_session(child.sessionId, owner_id=owner_id, approval_ref=None)
        _read_gate(viewer)
        data = records.read_artifact(
            verification_id, artifact_id, owner_id=owner_id)
        return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="page-check.png"'})


@router.get("/projects/{project_id}/preview-snapshot")
def read_project_preview_snapshot(project_id: str, viewer: CurrentUser):
    """Latest browser/preview PNG. 404 if none. Never a verification receipt."""
    with _store_errors():
        store, owner_id = get_project_store(), str(viewer.id)
        project = store.get_project(project_id, owner_id=owner_id)
        load_authorized_session(project.sessionId, owner_id=owner_id, approval_ref=None)
        _read_gate(viewer)
        data = store.read_preview_snapshot(project_id, owner_id=owner_id)
        if data is None:
            raise ProjectNotFound("preview_snapshot_not_found")
        return Response(
            content=data,
            media_type="image/png",
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": 'inline; filename="preview-snapshot.png"',
            },
        )
