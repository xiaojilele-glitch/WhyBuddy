"""Authenticated source workbench over the same project/runtime authority."""

from fastapi import APIRouter, HTTPException, Query, Request, Response
import uuid
from urllib.parse import quote
from pydantic import BaseModel, ConfigDict, Field

from middlewares.current_user import CurrentUser
from models.project_runtime import (ProjectSourceIndex, ProjectSourceFile, ProjectSourceCommand,
    ProjectRevisionPage, ProjectForkResult, ProjectDataSnapshot, ProjectDataRestoreResult,
    ProjectDeliveryStatus, ProjectReleaseResult)
from services.project_access import project_access_enabled, project_read_access
from services.project_application_data import ProjectApplicationDataStore
from services.project_export import source_archive
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.deliverable_kind import office_artifact_suffix, office_preview_html
from services.project_delivery import ProjectDeliveryService
from services.project_source_operations import ProjectSourceOperations
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, get_project_store
from services.project_tool_contracts import FileChange

from contextlib import contextmanager


router = APIRouter(tags=["Project source"])


class PatchSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedRevision: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")
    changes: list[FileChange] = Field(min_length=1, max_length=64)


class RestoreSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedRevision: str = Field(min_length=1, max_length=240)
    targetRevision: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")


class ForkSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")


class RestoreDataRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    backupId: str = Field(min_length=1, max_length=80)
    expectedVersion: int = Field(ge=1)


class PrepareReleaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedRevision: str = Field(min_length=1, max_length=240)
    verificationId: str = Field(min_length=1, max_length=80)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")


@contextmanager
def _service(request, viewer, *, write=False):
    if not (project_access_enabled(viewer) if write else project_read_access(viewer)):
        raise HTTPException(status_code=503, detail="project_preview_not_enabled")
    try:
        yield ProjectSourceOperations(get_project_store(),
            getattr(request.app.state, "project_runtime_supervisor", None), str(viewer.id))
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


@router.get("/projects/{project_id}/source", response_model=ProjectSourceIndex)
def get_source(project_id: str, request: Request, response: Response, viewer: CurrentUser,
               revision: str | None = Query(default=None, max_length=240)):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        return service.source(project_id, revision)


@router.get("/projects/{project_id}/source/file", response_model=ProjectSourceFile)
def read_source_file(project_id: str, request: Request, response: Response, viewer: CurrentUser,
                     path: str = Query(min_length=1, max_length=240),
                     revision: str | None = Query(default=None, max_length=240)):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        return service.file(project_id, path, revision)


@router.post("/projects/{project_id}/source/patch", response_model=ProjectSourceCommand)
def patch_source(project_id: str, body: PatchSourceRequest, request: Request, viewer: CurrentUser):
    with _service(request, viewer, write=True) as service:
        return service.patch(project_id, expected_revision=body.expectedRevision,
            idempotency_key=body.idempotencyKey, changes=[change.model_dump() for change in body.changes])


@router.get("/projects/{project_id}/revisions", response_model=ProjectRevisionPage)
def get_revisions(project_id: str, request: Request, response: Response, viewer: CurrentUser,
                  cursor: str | None = Query(default=None, max_length=240),
                  limit: int = Query(default=50, ge=1, le=50)):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        return service.revisions(project_id, cursor, limit)


@router.post("/projects/{project_id}/restore", response_model=ProjectSourceCommand)
def restore_source(project_id: str, body: RestoreSourceRequest, request: Request, viewer: CurrentUser):
    with _service(request, viewer, write=True) as service:
        return service.restore(project_id, expected_revision=body.expectedRevision,
            target_revision=body.targetRevision, idempotency_key=body.idempotencyKey)


@router.get("/projects/{project_id}/export")
def export_source(project_id: str, request: Request, viewer: CurrentUser,
                  revision: str | None = Query(default=None, max_length=240)):
    with _service(request, viewer) as service:
        service.authority(project_id)
        saved = service.store.get_revision(project_id, revision, owner_id=service.owner_id)
        files = service.store.read_files(project_id, saved.revision, owner_id=service.owner_id)
        extras = {}
        try:
            office = ProjectOfficeArtifactStore(service.store)
            for item in office.list(project_id, owner_id=service.owner_id):
                _meta, payload = office.get_bytes(
                    project_id, item["artifactId"], owner_id=service.owner_id)
                extras[item["path"]] = payload
        except Exception:
            extras = {}
        data = source_archive(files, saved, artifacts=extras)
        return Response(data, media_type="application/zip", headers={
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": 'attachment; filename="whybuddy-project.zip"'})


@router.post("/projects/{project_id}/fork", status_code=201, response_model=ProjectForkResult)
def fork_source(project_id: str, body: ForkSourceRequest, request: Request, viewer: CurrentUser):
    with _service(request, viewer, write=True) as service:
        return service.fork(project_id, revision=body.revision, idempotency_key=body.idempotencyKey)


@router.get("/projects/{project_id}/data", response_model=ProjectDataSnapshot)
def get_application_backups(project_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        service.authority(project_id)
        backups = ProjectApplicationDataStore(service.store).list_backups(project_id, owner_id=service.owner_id)
        return {"backup": backups[0] if backups else None, "backups": backups,
            "checkpointIntervalSeconds": 30, "recoveryPolicy": "last-checkpoint"}


@router.post("/projects/{project_id}/data/restore", response_model=ProjectDataRestoreResult)
def restore_application_backup(project_id: str, body: RestoreDataRequest, request: Request, viewer: CurrentUser):
    with _service(request, viewer, write=True) as service:
        service.authority(project_id, write=True)
        lease = service.store.acquire_lease(project_id, owner_id=service.owner_id,
            lease_owner="restore-data-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            if lease.sandboxId or lease.processRefs:
                raise ProjectConflict("project_application_restore_requires_stopped_runtime")
            service.authority(project_id, write=True)
            backup = ProjectApplicationDataStore(service.store).restore_backup(project_id, body.backupId,
                owner_id=service.owner_id, lease_generation=lease.generation, lease_owner=lease.leaseOwner,
                expected_version=body.expectedVersion)
            return {"backup": backup}
        finally:
            service.store.release_lease(project_id, owner_id=service.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)


@router.get("/projects/{project_id}/delivery", response_model=ProjectDeliveryStatus)
def get_delivery(project_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        return ProjectDeliveryService(service.store, service.owner_id).status(project_id)


@router.post("/projects/{project_id}/releases", status_code=201, response_model=ProjectReleaseResult)
def prepare_release(project_id: str, body: PrepareReleaseRequest, request: Request, viewer: CurrentUser):
    with _service(request, viewer, write=True) as service:
        release = ProjectDeliveryService(service.store, service.owner_id).prepare(project_id,
            expected_revision=body.expectedRevision, verification_id=body.verificationId,
            idempotency_key=body.idempotencyKey)
        return {"release": release}


@router.get("/projects/{project_id}/releases/{release_id}/download")
def download_release(project_id: str, release_id: str, request: Request, viewer: CurrentUser):
    with _service(request, viewer) as service:
        data = ProjectDeliveryService(service.store, service.owner_id).download(project_id, release_id)
        return Response(data, media_type="application/zip", headers={"Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff", "Content-Disposition": 'attachment; filename="whybuddy-delivery.zip"'})


_OFFICE_TYPES = {
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _office_disposition(name: str, suffix: str) -> str:
    """Starlette 头必须是 latin-1。中文文件名走 RFC 5987，不许直接塞进 filename=。"""
    fallback = "office-file" + (suffix if suffix in _OFFICE_TYPES else "")
    safe = quote(name, safe="")
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{safe}'


@router.get("/projects/{project_id}/artifacts")
def list_office_artifacts(project_id: str, request: Request, response: Response, viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        service.authority(project_id)
        files = ProjectOfficeArtifactStore(service.store).list(project_id, owner_id=service.owner_id)
        return {"files": files}


@router.get("/projects/{project_id}/artifacts/{artifact_id}")
def download_office_artifact(project_id: str, artifact_id: str, request: Request, viewer: CurrentUser):
    with _service(request, viewer) as service:
        service.authority(project_id)
        meta, data = ProjectOfficeArtifactStore(service.store).get_bytes(
            project_id, artifact_id, owner_id=service.owner_id)
        suffix = office_artifact_suffix(meta["path"]) or ""
        name = str(meta["path"]).rsplit("/", 1)[-1]
        return Response(data, media_type=_OFFICE_TYPES.get(suffix, "application/octet-stream"), headers={
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": _office_disposition(name, suffix),
        })


@router.get("/projects/{project_id}/artifacts/{artifact_id}/preview")
def preview_office_artifact(project_id: str, artifact_id: str, request: Request, response: Response,
                            viewer: CurrentUser):
    response.headers["Cache-Control"] = "no-store"
    with _service(request, viewer) as service:
        service.authority(project_id)
        preview = ProjectOfficeArtifactStore(service.store).get_preview(
            project_id, artifact_id, owner_id=service.owner_id)
        if preview is None:
            return {"kind": None}
        if preview.get("kind") == "pdf":
            import base64
            data = base64.b64decode(preview["content"], validate=True)
            return Response(data, media_type="application/pdf", headers={
                "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            })
        # ⚠ 2026-09-22 列表出现就画，是宿主流程。这一页只给 make_manus_page
        #   点名之后的预览框来取。
        if request.query_params.get("render") == "browser":
            document = office_preview_html(preview)
            if document:
                return Response(document, media_type="text/html; charset=utf-8", headers={
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
                })
        return preview
