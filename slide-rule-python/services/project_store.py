"""Durable project sources, operations, event cursors and workspace fencing.

2026-09-11: a sandbox is disposable; saving only its ID would lose the project
on expiry. Immutable content is written before a CAS publishes the source head.
An interrupted CAS can leave unreferenced content but can never publish missing
files. All mutable writes use database predicates, including HTTP SQL (whose
requests cannot share a transaction). No fallback to memory or temporary files.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool, StaticPool

from config.settings import settings
from models.project_runtime import Project, ProjectOperation, ProjectRevision, RuntimeEvent, RuntimeInstance, WorkspaceLease
from services.project_manifest import build_manifest, canonical_json, content_hash
from services.sql_gateway import HttpSqlGateway, _sql_engine_config, configure_sqlite_journal, http_api_credentials

MAX_SOURCE_HISTORY_BYTES = 64 * 1024 * 1024
MAX_REVISIONS = 200
MAX_OPERATION_BYTES = 128 * 1024
_PATCH_OUTCOME_RESERVE_BYTES = 4 * 1024
MAX_EVENT_BYTES = 32 * 1024
MAX_OPERATION_EVENTS = 2000
_TERMINAL_OPERATIONS = {"completed", "failed", "cancelled"}
#: 进程内订阅。worker 写下一条 runtime.console 就叫醒 SSE，浏览器不再
#: 200ms 空打 `/events?afterSeq=`。跨进程写库时 wait 超时再读，fail-open。
_EVENT_WAITERS: dict[str, list[threading.Event]] = {}
_EVENT_WAITERS_LOCK = threading.Lock()


def notify_operation_waiters(operation_id: str) -> None:
    """有新事件或终态。叫醒所有等这条 operation 的 SSE。"""
    key = str(operation_id or "").strip()
    if not key:
        return
    with _EVENT_WAITERS_LOCK:
        waiters = list(_EVENT_WAITERS.get(key) or ())
    for waiter in waiters:
        waiter.set()


def wait_for_operation_events(operation_id: str, timeout: float) -> bool:
    """等到下一条事件，或超时。超时不是失败——调用方再读库。"""
    key = str(operation_id or "").strip()
    if not key:
        return False
    waiter = threading.Event()
    with _EVENT_WAITERS_LOCK:
        _EVENT_WAITERS.setdefault(key, []).append(waiter)
    try:
        return waiter.wait(max(0.0, float(timeout)))
    finally:
        with _EVENT_WAITERS_LOCK:
            bucket = _EVENT_WAITERS.get(key)
            if bucket is None:
                pass
            else:
                try:
                    bucket.remove(waiter)
                except ValueError:
                    pass
                if not bucket:
                    _EVENT_WAITERS.pop(key, None)


_OPERATION_TRANSITIONS = {
    "queued": {"running", "cancelling", "cancelled", "failed", "interrupted"},
    "running": {"completed", "failed", "cancelling", "waiting_user", "interrupted"},
    "waiting_user": {"running", "cancelling", "cancelled", "interrupted"},
    "cancelling": {"cancelled", "failed", "interrupted"},
    "interrupted": {"running", "cancelling", "failed", "cancelled"},
}


class ProjectStoreUnavailable(RuntimeError):
    pass


class ProjectNotFound(LookupError):
    pass


class ProjectConflict(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise ValueError(name)
    return value


def _bounded(value: Any, limit: int) -> str:
    encoded = canonical_json(value)
    if len(encoded.encode("utf-8")) > limit:
        raise ValueError("project_record_too_large")
    return encoded


def _operation_payload(operation: ProjectOperation, *, admission: bool = False) -> str:
    encoded = operation.model_dump_json()
    if operation.kind == "runtime.patch":
        # A request fitting 128 KiB can exceed it once IDs and result are added.
        # Reserve outcome space before acceptance so a large queued patch can
        # still be claimed and terminalized with a small bounded error result.
        limit = MAX_OPERATION_BYTES - (_PATCH_OUTCOME_RESERVE_BYTES if admission else 0)
        if len(encoded.encode("utf-8")) > limit:
            raise ValueError("project_record_too_large")
    return encoded


_DDL = (
    "create table if not exists wb_project (id varchar(80) primary key, session_id varchar(240) unique not null, owner_id varchar(240) not null, current_revision varchar(80) not null, rev integer not null, payload text not null)",
    "create table if not exists wb_project_revision (id varchar(80) primary key, project_id varchar(80) not null, payload text not null)",
    "create table if not exists wb_project_content (hash varchar(64) primary key, content text not null)",
    "create table if not exists wb_project_source_budget (project_id varchar(80) primary key, reserved_revisions integer not null, reserved_bytes bigint not null)",
    "create table if not exists wb_project_lease (project_id varchar(80) primary key, generation integer not null, lease_owner varchar(240) not null, expires_at double precision not null, payload text not null)",
    "create table if not exists wb_project_operation (id varchar(80) primary key, project_id varchar(80) not null, idempotency_key varchar(240) not null, rev integer not null, payload text not null, unique(project_id, idempotency_key))",
    "create table if not exists wb_project_event (operation_id varchar(80) not null, seq integer not null, event_id varchar(240) not null, payload text not null, primary key(operation_id, seq), unique(operation_id, event_id))",
    "create index if not exists wb_project_revision_project on wb_project_revision(project_id)",
    "create index if not exists wb_project_operation_project on wb_project_operation(project_id)",
    "create table if not exists wb_project_preview_snapshot (project_id varchar(80) primary key, revision varchar(80) not null, source varchar(40) not null, sha256 varchar(64) not null, size_bytes integer not null, content text not null, captured_at varchar(64) not null)",
)

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_PREVIEW_SNAPSHOT_BYTES = 2 * 1024 * 1024
_PREVIEW_SNAPSHOT_SOURCES = {"browser_view", "browser_interact"}


class ProjectStore:
    """A query adapter shared by SQLAlchemy and the existing HTTPS SQL gateway.

    Raw query adapters default to SQLite's serial statement writes. PostgreSQL
    adapters, including the HTTP gateway, must explicitly select its dialect so
    live-patch admission competes with idle expiry on the parent's row lock.
    """

    def __init__(self, query: Callable[[str, list[Any]], list[dict[str, Any]]], *, dialect: str = "sqlite"):
        if dialect not in {"sqlite", "postgresql"}:
            raise ProjectStoreUnavailable("unsupported_project_database")
        self._dialect = dialect
        self._query = query
        self._engine = None
        for statement in _DDL:
            self._q(statement)

    @classmethod
    def from_url(cls, url: str) -> ProjectStore:
        if not url.startswith(("sqlite:", "postgresql:" , "postgresql+")):
            raise ProjectStoreUnavailable("unsupported_project_database")
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        connect_args, engine_kwargs = _sql_engine_config(url, NullPool)
        if url.startswith("sqlite:"):
            connect_args = {"check_same_thread": False, "timeout": 10}
            if ":memory:" in url or url in ("sqlite://", "sqlite:///"):
                engine_kwargs["poolclass"] = StaticPool
        engine = create_engine(url, connect_args=connect_args, **engine_kwargs)

        def query(sql: str, params: list[Any]) -> list[dict[str, Any]]:
            # Statements are authored here; user input only enters bound params.
            bound_sql = re.sub(r"\$(\d+)", lambda match: ":p" + match.group(1), sql)
            with engine.begin() as connection:
                result = connection.execute(text(bound_sql), {f"p{i + 1}": v for i, v in enumerate(params)})
                return [dict(row) for row in result.mappings()] if result.returns_rows else []

        try:
            configure_sqlite_journal(engine)
            store = cls(query, dialect=engine.dialect.name)
        except Exception:
            engine.dispose()
            raise
        store._engine = engine
        return store

    def close(self) -> None:
        if self._engine is not None:
            self._engine.dispose()

    def _q(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        try:
            return self._query(sql, params or [])
        except Exception as exc:
            # Do not send DSNs, SQL arguments, source, or gateway credentials to UI.
            raise ProjectStoreUnavailable("project_store_unavailable") from exc

    def _project_row(self, project_id: str, owner_id: str) -> dict[str, Any]:
        rows = self._q("select * from wb_project where id=$1 and owner_id=$2", [project_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_not_found")
        return rows[0]

    def get_project(self, project_id: str, *, owner_id: str) -> Project:
        return Project.model_validate_json(self._project_row(project_id, owner_id)["payload"])

    def get_project_for_session(self, session_id: str, *, owner_id: str) -> Project | None:
        rows = self._q("select payload from wb_project where session_id=$1 and owner_id=$2", [session_id, owner_id])
        return Project.model_validate_json(rows[0]["payload"]) if rows else None

    def _write_revision(self, project_id: str, files: dict[str, str], *, parent: str | None,
                        template_version: str, plan_ref: str, spec_revision: str | None,
                        revision_id: str | None = None) -> ProjectRevision:
        manifest = build_manifest(files)
        for entry in manifest.files:
            self._q("insert into wb_project_content(hash, content) values($1,$2) on conflict(hash) do nothing", [entry.sha256, files[entry.path]])
        revision = ProjectRevision(revision=revision_id or "prv-" + uuid.uuid4().hex, projectId=project_id,
            parentRevision=parent, treeHash=manifest.treeHash, manifest=manifest,
            templateVersion=_required(template_version, "template_version_required"),
            planRef=_required(plan_ref, "plan_ref_required"), specRevision=spec_revision, createdAt=_now())
        self._q("insert into wb_project_revision(id,project_id,payload) values($1,$2,$3) on conflict(id) do nothing",
                [revision.revision, project_id, revision.model_dump_json()])
        saved = self._q("select payload from wb_project_revision where id=$1 and project_id=$2", [revision.revision, project_id])
        if not saved:
            raise ProjectConflict("project_publication_identity_conflict")
        actual = ProjectRevision.model_validate_json(saved[0]["payload"])
        if actual.model_dump(exclude={"createdAt"}) != revision.model_dump(exclude={"createdAt"}):
            raise ProjectConflict("project_publication_identity_conflict")
        return actual

    @staticmethod
    def publication_revision_id(project_id: str, publication_id: str) -> str:
        identity = [_required(project_id, "project_id_required"), _required(publication_id, "publication_id_required")]
        return "prv-" + content_hash(canonical_json(identity))[:32]

    def _reserve_source(self, project_id: str, byte_count: int, *, lease_generation: int | None = None,
                        lease_owner: str | None = None) -> None:
        # Gateway requests cannot share a transaction. Reserve before uploading;
        # failed uploads/publications keep their charge until explicit GC exists.
        rows = self._q("select project_id from wb_project_source_budget where project_id=$1", [project_id])
        if not rows:
            existing = self._q("select payload from wb_project_revision where project_id=$1", [project_id])
            prior_bytes = sum(ProjectRevision.model_validate_json(row["payload"]).manifest.totalBytes for row in existing)
            self._q("insert into wb_project_source_budget(project_id,reserved_revisions,reserved_bytes) values($1,$2,$3) on conflict(project_id) do nothing",
                    [project_id, len(existing), prior_bytes])
        params: list[Any] = [byte_count, project_id, MAX_REVISIONS, MAX_SOURCE_HISTORY_BYTES]
        fence = self._fence(project_id, lease_generation, lease_owner, params)
        reserved = self._q("update wb_project_source_budget set reserved_revisions=reserved_revisions+1,reserved_bytes=reserved_bytes+$1 where project_id=$2 and reserved_revisions<$3 and reserved_bytes+$1<=$4 and " + fence + " returning project_id", params)
        if not reserved:
            checks: list[Any] = []
            condition = self._fence(project_id, lease_generation, lease_owner, checks)
            if not self._q("select 1 as valid where " + condition, checks):
                raise ProjectConflict("workspace_lease_lost")
            raise ValueError("project_history_limit")

    def create_project(self, session_id: str, *, owner_id: str, files: dict[str, str],
                       template_version: str, plan_ref: str, spec_revision: str | None = None,
                       source_project_id: str | None = None, source_revision: str | None = None) -> Project:
        _required(session_id, "session_id_required")
        _required(owner_id, "owner_id_required")
        existing = self.get_project_for_session(session_id, owner_id=owner_id)
        if existing is not None:
            return existing
        # One identity per session, including when two workers race to initialize.
        project_id = "prj-" + uuid.uuid5(uuid.NAMESPACE_URL, "whybuddy:project:" + session_id).hex
        conflict = self._q("select owner_id from wb_project where session_id=$1", [session_id])
        if conflict:
            raise ProjectNotFound("project_not_found")
        manifest = build_manifest(files)
        _required(template_version, "template_version_required")
        _required(plan_ref, "plan_ref_required")
        self._reserve_source(project_id, manifest.totalBytes)
        revision = self._write_revision(project_id, files, parent=None, template_version=template_version,
                                        plan_ref=plan_ref, spec_revision=spec_revision)
        now = _now()
        project = Project(projectId=project_id, sessionId=session_id, ownerId=owner_id,
            currentRevision=revision.revision, createdAt=now, updatedAt=now,
            sourceBytesStored=revision.manifest.totalBytes,
            sourceProjectId=source_project_id, sourceRevision=source_revision)
        self._q("insert into wb_project(id,session_id,owner_id,current_revision,rev,payload) values($1,$2,$3,$4,1,$5) on conflict(session_id) do nothing",
                [project_id, session_id, owner_id, revision.revision, project.model_dump_json()])
        return self.get_project(project_id, owner_id=owner_id)

    def get_revision(self, project_id: str, revision: str | None = None, *, owner_id: str) -> ProjectRevision:
        project = self.get_project(project_id, owner_id=owner_id)
        target = revision or project.currentRevision
        # Traverse the committed parent chain: a losing CAS must not publish an
        # orphan revision through a guessed ID or revision listing.
        current: str | None = project.currentRevision
        for _ in range(MAX_REVISIONS):
            if current is None:
                break
            rows = self._q("select payload from wb_project_revision where id=$1 and project_id=$2", [current, project_id])
            if not rows:
                raise ProjectStoreUnavailable("project_revision_missing")
            item = ProjectRevision.model_validate_json(rows[0]["payload"])
            if current == target:
                return item
            current = item.parentRevision
        raise ProjectNotFound("project_revision_not_found")

    def read_files(self, project_id: str, revision: str | None = None, *, owner_id: str) -> dict[str, str]:
        snapshot = self.get_revision(project_id, revision, owner_id=owner_id)
        files: dict[str, str] = {}
        for item in snapshot.manifest.files:
            rows = self._q("select content from wb_project_content where hash=$1", [item.sha256])
            if not rows or content_hash(rows[0]["content"]) != item.sha256:
                raise ProjectStoreUnavailable("project_content_missing_or_corrupt")
            files[item.path] = rows[0]["content"]
        if build_manifest(files).treeHash != snapshot.treeHash:
            raise ProjectStoreUnavailable("project_manifest_corrupt")
        return files

    def _fence(self, project_id: str, generation: int | None, lease_owner: str | None,
               params: list[Any]) -> str:
        first = len(params) + 1
        if generation is None and lease_owner is None:
            params.extend([project_id, time.time()])
            return f"not exists(select 1 from wb_project_lease where project_id=${first} and expires_at>${first + 1})"
        if generation is None or not lease_owner:
            raise ValueError("lease_fence_required")
        params.extend([project_id, generation, lease_owner, time.time()])
        return f"exists(select 1 from wb_project_lease where project_id=${first} and generation=${first + 1} and lease_owner=${first + 2} and expires_at>${first + 3})"

    def commit_revision(self, project_id: str, *, owner_id: str, expected_revision: str,
                        files: dict[str, str], template_version: str, plan_ref: str,
                        spec_revision: str | None = None, lease_generation: int | None = None,
                        lease_owner: str | None = None, publication_id: str | None = None,
                        runtime_operation_id: str | None = None) -> ProjectRevision:
        row = self._project_row(project_id, owner_id)
        project = Project.model_validate_json(row["payload"])
        manifest = build_manifest(files)
        _required(template_version, "template_version_required")
        _required(plan_ref, "plan_ref_required")
        target_id = self.publication_revision_id(project_id, publication_id) if publication_id is not None else None
        context = None
        if runtime_operation_id is not None:
            if publication_id is None:
                raise ValueError("project_patch_publication_required")
            context = self._runtime_patch_context(runtime_operation_id, publication_id, owner_id=owner_id,
                lease_generation=lease_generation, lease_owner=lease_owner, require_claim=True)
            parent, child = context["parent"], context["child"]
            sync = (parent.result or {}).get("sourceSync", {})
            if (context["project"].projectId != project_id or child.status != "running" or child.expectedRevision != expected_revision
                    or child.approvalRef != plan_ref or parent.runtime.status != "syncing"
                    or sync.get("operationId") != publication_id or sync.get("baseRevision") != expected_revision
                    or sync.get("targetRevision") != target_id):
                raise ProjectConflict("project_patch_publication_mismatch")
        existing = self._q("select payload from wb_project_revision where id=$1 and project_id=$2", [target_id, project_id]) if target_id else []
        revision = ProjectRevision.model_validate_json(existing[0]["payload"]) if existing else None
        if revision is not None and (revision.parentRevision != expected_revision or revision.manifest != manifest
                or revision.treeHash != manifest.treeHash or revision.planRef != plan_ref
                or revision.templateVersion != template_version or revision.specRevision != spec_revision):
            raise ProjectConflict("project_publication_identity_conflict")
        if revision is not None and project.currentRevision == target_id:
            params: list[Any] = []
            fence = self._fence(project_id, lease_generation, lease_owner, params)
            if context is not None:
                fence += " and " + self._runtime_patch_fence(context, params)
            if not self._q("select 1 as valid where " + fence, params):
                raise ProjectConflict("project_revision_or_lease_conflict")
            return revision
        if project.currentRevision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        if revision is None:
            # A stable revision row survives a lost publication response. A
            # crash before that row may still consume a conservative quota
            # reservation, matching the existing bounded failed-upload policy.
            self._reserve_source(project_id, manifest.totalBytes, lease_generation=lease_generation, lease_owner=lease_owner)
            revision = self._write_revision(project_id, files, parent=expected_revision,
                template_version=template_version, plan_ref=plan_ref, spec_revision=spec_revision, revision_id=target_id)
        updated = project.model_copy(update={"currentRevision": revision.revision, "updatedAt": _now(),
            "revisionCount": project.revisionCount + 1, "sourceBytesStored": project.sourceBytesStored + manifest.totalBytes})
        params: list[Any] = [revision.revision, updated.model_dump_json(), project_id, owner_id, row["rev"], expected_revision]
        fence = self._fence(project_id, lease_generation, lease_owner, params)
        if context is not None:
            fence += " and " + self._runtime_patch_fence(context, params)
        rows = self._q("update wb_project set current_revision=$1,payload=$2,rev=rev+1 where id=$3 and owner_id=$4 and rev=$5 and current_revision=$6 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("project_revision_or_lease_conflict")
        return revision

    def get_lease(self, project_id: str, *, owner_id: str) -> WorkspaceLease | None:
        self.get_project(project_id, owner_id=owner_id)
        rows = self._q("select payload from wb_project_lease where project_id=$1", [project_id])
        return WorkspaceLease.model_validate_json(rows[0]["payload"]) if rows else None

    def acquire_lease(self, project_id: str, *, owner_id: str, lease_owner: str,
                      ttl_seconds: float = 120) -> WorkspaceLease:
        self.get_project(project_id, owner_id=owner_id)
        _required(lease_owner, "lease_owner_required")
        if not 1 <= ttl_seconds <= 3600:
            raise ValueError("invalid_lease_ttl")
        prior = self.get_lease(project_id, owner_id=owner_id)
        now = time.time()
        if prior is not None and prior.expiresAt > now:
            raise ProjectConflict("workspace_lease_busy")
        lease = WorkspaceLease(workspaceId="ws-" + project_id, projectId=project_id,
            generation=(prior.generation + 1 if prior else 1), leaseOwner=lease_owner,
            expiresAt=now + ttl_seconds,
            sandboxId=prior.sandboxId if prior else None,
            mountedRevision=prior.mountedRevision if prior else None,
            processRefs=prior.processRefs if prior else {})
        if prior is None:
            rows = self._q("insert into wb_project_lease(project_id,generation,lease_owner,expires_at,payload) values($1,$2,$3,$4,$5) on conflict(project_id) do nothing returning project_id",
                [project_id, lease.generation, lease_owner, lease.expiresAt, lease.model_dump_json()])
        else:
            rows = self._q("update wb_project_lease set generation=$1,lease_owner=$2,expires_at=$3,payload=$4 where project_id=$5 and generation=$6 and expires_at<=$7 returning project_id",
                [lease.generation, lease_owner, lease.expiresAt, lease.model_dump_json(), project_id, prior.generation, now])
        if not rows:
            raise ProjectConflict("workspace_lease_busy")
        return lease

    def renew_lease(self, project_id: str, *, owner_id: str, lease_owner: str, generation: int,
                    ttl_seconds: float = 120, sandbox_id: str | None = None,
                    mounted_revision: str | None = None, process_refs: dict[str, Any] | None = None) -> WorkspaceLease:
        prior = self.get_lease(project_id, owner_id=owner_id)
        if prior is None or prior.generation != generation or prior.leaseOwner != lease_owner:
            raise ProjectConflict("workspace_lease_lost")
        if not 1 <= ttl_seconds <= 3600:
            raise ValueError("invalid_lease_ttl")
        if mounted_revision is not None:
            self.get_revision(project_id, mounted_revision, owner_id=owner_id)
        updates: dict[str, Any] = {"expiresAt": time.time() + ttl_seconds}
        if sandbox_id is not None:
            updates["sandboxId"] = _required(sandbox_id, "sandbox_id_required")
        if mounted_revision is not None:
            updates["mountedRevision"] = mounted_revision
        if process_refs is not None:
            _bounded(process_refs, MAX_EVENT_BYTES)
            updates["processRefs"] = process_refs
        lease = prior.model_copy(update=updates)
        rows = self._q("update wb_project_lease set expires_at=$1,payload=$2 where project_id=$3 and generation=$4 and lease_owner=$5 and expires_at>$6 returning project_id",
            [lease.expiresAt, lease.model_dump_json(), project_id, generation, lease_owner, time.time()])
        if not rows:
            raise ProjectConflict("workspace_lease_lost")
        return lease

    def release_lease(self, project_id: str, *, owner_id: str, lease_owner: str, generation: int,
                      clear_runtime: bool = False) -> None:
        prior = self.get_lease(project_id, owner_id=owner_id)
        if prior is None or prior.generation != generation or prior.leaseOwner != lease_owner:
            raise ProjectConflict("workspace_lease_lost")
        updates: dict[str, Any] = {"expiresAt": 0.0}
        if clear_runtime:
            updates.update(sandboxId=None, mountedRevision=None, processRefs={})
        released = prior.model_copy(update=updates)
        rows = self._q("update wb_project_lease set expires_at=0,payload=$1 where project_id=$2 and generation=$3 and lease_owner=$4 returning project_id",
            [released.model_dump_json(), project_id, generation, lease_owner])
        if not rows:
            raise ProjectConflict("workspace_lease_lost")

    def _runtime_patch_context(self, parent_id: str, child_id: str | None = None, *, owner_id: str,
                               lease_generation: int | None = None, lease_owner: str | None = None,
                               require_claim: bool = False, cleanup: bool = False,
                               child_kind: str = "runtime.patch") -> dict[str, Any]:
        if child_kind not in {"runtime.patch", "runtime.verify"}:
            raise ValueError("runtime_child_kind_invalid")
        rows = self._q("select o.payload as parent_payload,o.rev as parent_rev,p.payload as project_payload,p.rev as project_rev,p.current_revision,l.payload as lease_payload,l.generation,l.lease_owner,l.expires_at from wb_project_operation o join wb_project p on p.id=o.project_id join wb_project_lease l on l.project_id=p.id where o.id=$1 and p.owner_id=$2",
            [parent_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_runtime_not_found")
        row = rows[0]
        parent = ProjectOperation.model_validate_json(row["parent_payload"])
        project = Project.model_validate_json(row["project_payload"])
        lease = WorkspaceLease.model_validate_json(row["lease_payload"])
        if (parent.kind != "runtime.start" or parent.runtime is None or parent.projectId != project.projectId
                or parent.sessionId != project.sessionId or project.ownerId != owner_id
                or project.currentRevision != row["current_revision"]
                or lease.projectId != project.projectId or parent.runtime.workspaceId != lease.workspaceId
                or lease.generation != row["generation"] or lease.leaseOwner != row["lease_owner"]
                or parent.leaseGeneration != lease.generation or parent.leaseOwner != lease.leaseOwner
                or lease.processRefs.get("operationId") != parent_id
                or row["expires_at"] <= time.time() or lease.expiresAt <= time.time()
                or (lease_generation is not None and lease_generation != lease.generation)
                or (lease_owner is not None and lease_owner != lease.leaseOwner)):
            raise ProjectConflict("workspace_lease_lost")
        if not cleanup and (parent.status != "running" or parent.cancelRequested
                or parent.runtime.status not in {"ready", "syncing"}
                or parent.runtime.expiresAt is None or parent.runtime.expiresAt <= time.time()
                or not lease.sandboxId or not parent.runtime.processId
                or lease.processRefs.get("server") != parent.runtime.processId):
            raise ProjectConflict("project_runtime_patch_unavailable")
        row.update(parent=parent, project=project, lease=lease, owner_id=owner_id)
        if child_id is not None:
            child_row = self._operation_row(child_id, owner_id)
            child = ProjectOperation.model_validate_json(child_row["payload"])
            if (child.kind != child_kind or child.input.get("runtimeOperationId") != parent_id
                    or child.projectId != project.projectId or child.sessionId != parent.sessionId):
                raise ProjectConflict("project_patch_parent_mismatch")
            if not cleanup and (child.cancelRequested or child.status in _TERMINAL_OPERATIONS
                    or child.approvalRef != parent.approvalRef):
                raise ProjectConflict("project_patch_not_runnable")
            if require_claim and (child.leaseGeneration != lease.generation or child.leaseOwner != lease.leaseOwner):
                raise ProjectConflict("workspace_lease_lost")
            row.update(child=child, child_rev=child_row["rev"], child_payload=child_row["payload"])
        return row

    def _runtime_verification_context(self, parent_id: str, child_id: str | None = None, **kwargs):
        return self._runtime_patch_context(parent_id, child_id, child_kind="runtime.verify", **kwargs)

    def _runtime_patch_fence(self, context: dict, params: list[Any]) -> str:
        """Parent cancellation and lease metadata are part of each write CAS.

        Reading JSON then checking only generation permits a cancellation or a
        materialized-revision change between the check and SQL write. Comparing
        the captured rows keeps SQLite and the HTTP SQL backend equivalent.
        """
        first = len(params) + 1
        parent, project = context["parent"], context["project"]
        params.extend([parent.operationId, context["parent_rev"], context["parent_payload"],
            project.projectId, context["owner_id"], context["project_rev"], context["current_revision"],
            context["generation"], context["lease_owner"], context["lease_payload"], time.time()])
        p = lambda offset: "$" + str(first + offset)
        clause = ("exists(select 1 from wb_project_operation po join wb_project pp on pp.id=po.project_id "
            "join wb_project_lease pl on pl.project_id=pp.id "
            f"where po.id={p(0)} and po.rev={p(1)} and po.payload={p(2)} "
            f"and pp.id={p(3)} and pp.owner_id={p(4)} and pp.rev={p(5)} and pp.current_revision={p(6)} "
            f"and pl.generation={p(7)} and pl.lease_owner={p(8)} and pl.payload={p(9)} and pl.expires_at>{p(10)})")
        if "child" in context:
            index = len(params) + 1
            params.extend([context["child"].operationId, context["child_rev"], context["child_payload"]])
            clause += f" and exists(select 1 from wb_project_operation pc where pc.id=${index} and pc.rev=${index + 1} and pc.payload=${index + 2})"
        return clause

    def enqueue_runtime_patch(self, parent_operation_id: str, *, owner_id: str, expected_revision: str,
                              approval_ref: str, idempotency_key: str, changes: list[dict]) -> ProjectOperation:
        if not isinstance(changes, list) or not 1 <= len(changes) <= 64:
            raise ValueError("invalid_project_changes")
        return self._enqueue_runtime_child(parent_operation_id, owner_id=owner_id,
            expected_revision=expected_revision, approval_ref=approval_ref, idempotency_key=idempotency_key,
            kind="runtime.patch", input_value={"runtimeOperationId": parent_operation_id, "changes": changes})

    def enqueue_runtime_verification(self, parent_operation_id: str, *, owner_id: str,
                                     expected_revision: str, approval_ref: str, idempotency_key: str,
                                     suite_version: str = "react-vite-counter@1",
                                     acceptance_requirements: list[str] | None = None) -> ProjectOperation:
        if suite_version not in {"react-vite-counter@1", "react-vite-tasks@1"}:
            raise ValueError("verification_suite_unsupported")
        return self._enqueue_runtime_child(parent_operation_id, owner_id=owner_id,
            expected_revision=expected_revision, approval_ref=approval_ref, idempotency_key=idempotency_key,
            kind="runtime.verify", input_value={"runtimeOperationId": parent_operation_id, "suiteVersion": suite_version,
                "acceptanceRequirements": list(acceptance_requirements or [])})

    def _enqueue_runtime_child(self, parent_operation_id: str, *, owner_id: str, expected_revision: str,
                               approval_ref: str, idempotency_key: str, kind: str, input_value: dict) -> ProjectOperation:
        parent = self.get_operation(parent_operation_id, owner_id=owner_id)
        _required(idempotency_key, "idempotency_key_required")
        _required(approval_ref, "approval_ref_required")
        request = {"kind": kind, "expectedRevision": expected_revision,
            "approvalRef": approval_ref, "input": input_value}
        digest = content_hash(_bounded(request, MAX_OPERATION_BYTES))
        existing = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [parent.projectId, idempotency_key])
        if existing:
            saved = ProjectOperation.model_validate_json(existing[0]["payload"])
            if saved.requestHash != digest:
                raise ProjectConflict("operation_idempotency_conflict")
            return saved
        context = self._runtime_patch_context(parent_operation_id, owner_id=owner_id, child_kind=kind)
        parent, lease = context["parent"], context["lease"]
        if (parent.runtime.status != "ready" or parent.runtime.health != "revision_verified"
                or parent.runtime.revision != expected_revision or context["current_revision"] != expected_revision
                or lease.mountedRevision != expected_revision or parent.approvalRef != approval_ref
                or not lease.sandboxId or not parent.runtime.processId
                or lease.processRefs.get("server") != parent.runtime.processId):
            raise ProjectConflict("project_runtime_patch_unavailable")
        now = _now()
        operation = ProjectOperation(operationId="pop-" + uuid.uuid4().hex, projectId=parent.projectId,
            sessionId=parent.sessionId, kind=kind, idempotencyKey=idempotency_key,
            requestHash=digest, expectedRevision=expected_revision, approvalRef=approval_ref,
            input=input_value, createdAt=now, updatedAt=now)
        params: list[Any] = [operation.operationId, operation.projectId, idempotency_key, _operation_payload(operation, admission=True)]
        parent_index = len(params) + 1
        fence = self._runtime_patch_fence(context, params)
        prefix, admission = "", fence
        if self._dialect == "postgresql":
            # READ COMMITTED permits INSERT and idle UPDATE to see the same old
            # snapshot. Bump the parent rev and insert in ONE committed statement,
            # so both paths compete on the parent row. Direct target predicates
            # are rechecked after a lock wait; the child and rev bump roll back
            # together on failure. SQLite serializes writes at statement level.
            prefix = ("with admitted_parent as (update wb_project_operation set rev=rev+1 "
                f"where id=${parent_index} and rev=${parent_index + 1} and payload=${parent_index + 2} and "
                + fence + " returning id) ")
            admission = "exists(select 1 from admitted_parent)"
        self._q(prefix + "insert into wb_project_operation(id,project_id,idempotency_key,rev,payload) select $1,$2,$3,1,$4 where "
            + admission + " on conflict(project_id,idempotency_key) do nothing", params)
        saved_rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [parent.projectId, idempotency_key])
        if not saved_rows:
            raise ProjectConflict("project_runtime_patch_changed")
        saved = ProjectOperation.model_validate_json(saved_rows[0]["payload"])
        if saved.requestHash != digest:
            raise ProjectConflict("operation_idempotency_conflict")
        return saved

    def list_runtime_patches(self, parent_operation_id: str, *, owner_id: str,
                             include_terminal: bool = False) -> list[ProjectOperation]:
        return self._list_runtime_children(parent_operation_id, owner_id=owner_id,
            include_terminal=include_terminal, kind="runtime.patch")

    def list_runtime_verifications(self, parent_operation_id: str, *, owner_id: str,
                                   include_terminal: bool = False) -> list[ProjectOperation]:
        return self._list_runtime_children(parent_operation_id, owner_id=owner_id,
            include_terminal=include_terminal, kind="runtime.verify")

    def _list_runtime_children(self, parent_operation_id: str, *, owner_id: str,
                               include_terminal: bool, kind: str) -> list[ProjectOperation]:
        parent = self.get_operation(parent_operation_id, owner_id=owner_id)
        if parent.kind != "runtime.start":
            raise ProjectConflict("project_patch_parent_mismatch")
        result, cursor = [], ""
        while True:
            page = self.list_project_operations(parent.projectId, owner_id=owner_id, after_id=cursor, limit=100)
            result.extend(item for item in page if item.kind == kind
                and item.input.get("runtimeOperationId") == parent_operation_id
                and (include_terminal or item.status not in _TERMINAL_OPERATIONS or item.pendingEvent is not None))
            if len(page) < 100:
                return sorted(result, key=lambda item: (item.createdAt, item.operationId))
            cursor = page[-1].operationId

    def runtime_patch_activity_at(self, parent_operation_id: str, *, owner_id: str) -> float:
        """Admission and activity share the child's one durable INSERT.

        2026-09-13 live model: a successful edit at second 54 was destroyed by
        the original 60-second idle deadline. A new accepted patch is activity;
        polling or replaying its idempotency key is not. Reading immutable
        createdAt repairs crashes without a second parent-touch transaction or
        advancing activity on every background retry.
        """
        parent = self.get_operation(parent_operation_id, owner_id=owner_id)
        # Browser requests have the same durable child admission and idle race.
        # Keep the existing public name so the real worker and its race tests
        # continue to exercise this shared activity source.
        patches = self.list_runtime_patches(parent_operation_id, owner_id=owner_id, include_terminal=True)
        patches += self.list_runtime_verifications(parent_operation_id, owner_id=owner_id, include_terminal=True)
        latest, now = 0.0, time.time()
        try:
            start = datetime.fromisoformat(parent.createdAt)
            if start.tzinfo is None:
                raise ValueError("missing_created_at_timezone")
            for child in patches:
                created = datetime.fromisoformat(child.createdAt)
                if created.tzinfo is None:
                    raise ValueError("missing_created_at_timezone")
                submitted = created.timestamp()
                if submitted < start.timestamp() or submitted > now:
                    raise ValueError("invalid_patch_creation_time")
                latest = max(latest, submitted)
        except (ValueError, OverflowError):
            # Clamping a future timestamp to now would renew on every poll.
            raise ValueError("project_patch_activity_invalid") from None
        return latest

    def project_operation_count(self, project_id: str, *, owner_id: str) -> int:
        """Capture before reading activity; idle expiry fences later INSERTs."""
        self.get_project(project_id, owner_id=owner_id)
        return int(self._q("select count(*) as total from wb_project_operation where project_id=$1", [project_id])[0]["total"])

    def create_operation(self, project_id: str, *, owner_id: str, kind: str,
                         idempotency_key: str, expected_revision: str, approval_ref: str,
                         input: dict[str, Any] | None = None) -> ProjectOperation:
        project = self.get_project(project_id, owner_id=owner_id)
        _required(kind, "operation_kind_required")
        if kind in {"runtime.patch", "runtime.verify"}:
            raise ValueError("runtime_patch_enqueue_required")
        _required(idempotency_key, "idempotency_key_required")
        _required(approval_ref, "approval_ref_required")
        request = {"kind": kind, "expectedRevision": expected_revision, "approvalRef": approval_ref, "input": input or {}}
        digest = content_hash(_bounded(request, MAX_OPERATION_BYTES))
        rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [project_id, idempotency_key])
        if rows:
            existing = ProjectOperation.model_validate_json(rows[0]["payload"])
            if existing.requestHash != digest:
                raise ProjectConflict("operation_idempotency_conflict")
            return existing
        if project.currentRevision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        now = _now()
        operation = ProjectOperation(operationId="pop-" + uuid.uuid4().hex, projectId=project_id,
            sessionId=project.sessionId, kind=kind, idempotencyKey=idempotency_key, requestHash=digest,
            expectedRevision=expected_revision, approvalRef=approval_ref, input=input or {}, createdAt=now, updatedAt=now)
        self._q("insert into wb_project_operation(id,project_id,idempotency_key,rev,payload) values($1,$2,$3,1,$4) on conflict(project_id,idempotency_key) do nothing",
            [operation.operationId, project_id, idempotency_key, operation.model_dump_json()])
        rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [project_id, idempotency_key])
        saved = ProjectOperation.model_validate_json(rows[0]["payload"])
        if saved.requestHash != digest:
            raise ProjectConflict("operation_idempotency_conflict")
        return saved

    def _operation_row(self, operation_id: str, owner_id: str) -> dict[str, Any]:
        rows = self._q("select o.* from wb_project_operation o join wb_project p on p.id=o.project_id where o.id=$1 and p.owner_id=$2", [operation_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_operation_not_found")
        return rows[0]

    def get_operation(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        return ProjectOperation.model_validate_json(self._operation_row(operation_id, owner_id)["payload"])

    def operation_by_key(self, project_id: str, key: str, *, owner_id: str) -> ProjectOperation | None:
        self.get_project(project_id, owner_id=owner_id)
        rows = self._q("select payload from wb_project_operation where project_id=$1 and idempotency_key=$2", [project_id, key])
        return ProjectOperation.model_validate_json(rows[0]["payload"]) if rows else None

    def list_project_operations(self, project_id: str, *, owner_id: str,
                                after_id: str = "", limit: int = 9) -> list[ProjectOperation]:
        self.get_project(project_id, owner_id=owner_id)
        if not 1 <= limit <= 100 or len(after_id) > 240:
            raise ValueError("invalid_operation_cursor")
        rows = self._q("select o.payload from wb_project_operation o join wb_project p on p.id=o.project_id where o.project_id=$1 and p.owner_id=$2 and o.id>$3 order by o.id limit $4",
            [project_id, owner_id, after_id, limit])
        return [ProjectOperation.model_validate_json(row["payload"]) for row in rows]

    def list_runnable_operations(self, *, limit: int = 100) -> list[tuple[ProjectOperation, str]]:
        """Trusted worker scan, including terminal rows whose outbox needs repair."""
        if not 1 <= limit <= 1000:
            raise ValueError("invalid_operation_limit")
        selected: list[tuple[ProjectOperation, str]] = []
        cursor = ""
        # Filtering JSON in Python keeps both SQL backends compatible. Keyset
        # paging must continue past completed rows and currently leased work.
        while len(selected) < limit:
            rows = self._q("select o.id,o.payload,p.owner_id,l.payload as lease_payload from wb_project_operation o join wb_project p on p.id=o.project_id left join wb_project_lease l on l.project_id=o.project_id where o.id>$1 and (l.project_id is null or l.expires_at<=$2) order by o.id limit $3",
                [cursor, time.time(), max(100, limit)])
            if not rows:
                break
            for row in rows:
                operation = ProjectOperation.model_validate_json(row["payload"])
                lease = WorkspaceLease.model_validate_json(row["lease_payload"]) if row["lease_payload"] else None
                prior_id = lease.processRefs.get("operationId") if lease else None
                if prior_id and prior_id != operation.operationId:
                    prior = self.get_operation(prior_id, owner_id=row["owner_id"])
                    if prior.status not in _TERMINAL_OPERATIONS or prior.pendingEvent is not None:
                        continue
                if operation.kind in {"runtime.start", "runtime.exec"} and (operation.status not in _TERMINAL_OPERATIONS or operation.pendingEvent is not None):
                    selected.append((operation, row["owner_id"]))
                    if len(selected) == limit:
                        break
            cursor = rows[-1]["id"]
        return selected

    def snapshot_operation(self, operation_id: str, *, owner_id: str) -> dict[str, Any]:
        rows = self._q("select o.payload,l.expires_at as lease_expires_at,coalesce((select max(e.seq) from wb_project_event e where e.operation_id=o.id),0) as last_seq from wb_project_operation o join wb_project p on p.id=o.project_id left join wb_project_lease l on l.project_id=o.project_id where o.id=$1 and p.owner_id=$2", [operation_id, owner_id])
        if not rows:
            raise ProjectNotFound("project_operation_not_found")
        operation = ProjectOperation.model_validate_json(rows[0]["payload"])
        return {"operation": operation, "runtime": operation.runtime, "lastSeq": int(rows[0]["last_seq"]),
            "leaseExpiresAt": rows[0]["lease_expires_at"]}

    def request_operation_cancel(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        for _ in range(12):
            row = self._operation_row(operation_id, owner_id)
            operation = ProjectOperation.model_validate_json(row["payload"])
            if operation.cancelRequested or operation.status in _TERMINAL_OPERATIONS:
                return operation
            updated = operation.model_copy(update={"cancelRequested": True, "updatedAt": _now()})
            if self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 returning id",
                       [_operation_payload(updated), operation_id, row["rev"]]):
                return updated
        raise ProjectConflict("operation_state_conflict")

    def touch_operation(self, operation_id: str, *, owner_id: str) -> ProjectOperation:
        """Explicit user activity; polling/log subscriptions do not extend billing."""
        for _ in range(12):
            row = self._operation_row(operation_id, owner_id)
            operation = ProjectOperation.model_validate_json(row["payload"])
            if operation.status in _TERMINAL_OPERATIONS or operation.cancelRequested:
                return operation
            now = time.time()
            updated = operation.model_copy(update={"lastAccessAt": now, "updatedAt": _now()})
            if self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 returning id",
                       [_operation_payload(updated), operation_id, row["rev"]]):
                return updated
        raise ProjectConflict("operation_state_conflict")

    def update_runtime_operation(self, operation_id: str, *, owner_id: str, lease_generation: int,
                                 lease_owner: str, expected_status: str, status: str,
                                 runtime: RuntimeInstance, result: dict[str, Any] | None = None,
                                 idle_operation_count: int | None = None,
                                 idle_last_access_at: float | None = None) -> ProjectOperation | None:
        _bounded(result, MAX_OPERATION_BYTES)
        for _ in range(12):
            self.flush_operation_event(operation_id, owner_id=owner_id,
                lease_generation=lease_generation, lease_owner=lease_owner)
            row = self._operation_row(operation_id, owner_id)
            operation = ProjectOperation.model_validate_json(row["payload"])
            if idle_operation_count is not None and (operation.kind != "runtime.start"
                    or operation.status != "running" or operation.cancelRequested
                    or operation.runtime is None or operation.runtime.status != "ready"
                    or operation.lastAccessAt != idle_last_access_at):
                return None
            if operation.kind in {"runtime.patch", "runtime.verify"}:
                raise ProjectConflict("runtime_patch_child_has_no_runtime")
            if operation.pendingEvent is not None:
                continue
            if operation.leaseGeneration != lease_generation or operation.leaseOwner != lease_owner:
                raise ProjectConflict("workspace_lease_lost")
            if operation.status != expected_status or operation.status in _TERMINAL_OPERATIONS or (
                    status != expected_status and status not in _OPERATION_TRANSITIONS.get(expected_status, set())):
                raise ProjectConflict("operation_state_conflict")
            effective_revision = operation.runtime.revision if operation.runtime is not None else operation.expectedRevision
            if runtime.projectId != operation.projectId or runtime.revision != effective_revision:
                raise ProjectConflict("runtime_operation_mismatch")
            lease = self.get_lease(operation.projectId, owner_id=owner_id)
            if lease is None or runtime.workspaceId != lease.workspaceId:
                raise ProjectConflict("runtime_operation_mismatch")
            if operation.runtime is not None and (runtime.runtimeId != operation.runtime.runtimeId or
                    runtime.workspaceId != operation.runtime.workspaceId):
                raise ProjectConflict("runtime_operation_mismatch")
            version, now = operation.stateVersion + 1, _now()
            pending = {"eventId": f"{operation_id}:state:{version}", "type": "runtime.state", "payload": {
                "operationId": operation_id, "status": status, "runtime": runtime.model_dump(),
                "cancelRequested": operation.cancelRequested, "stateVersion": version, "updatedAt": now}}
            _bounded(pending["payload"], MAX_EVENT_BYTES)
            updated = ProjectOperation.model_validate({**operation.model_dump(), "status": status,
                "runtime": runtime, "result": result, "stateVersion": version, "pendingEvent": pending, "updatedAt": now})
            params: list[Any] = [_operation_payload(updated), operation_id, row["rev"]]
            fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
            if idle_operation_count is not None:
                # SQLite patch INSERTs do not advance the parent's rev. Fence
                # admission here too; PostgreSQL also locks and advances that
                # rev in its admission CTE. Neither requires a client transaction.
                index = len(params) + 1
                params.extend([operation.projectId, idle_operation_count])
                fence += (f" and (select count(*) from wb_project_operation pi "
                    f"where pi.project_id=${index})=${index + 1}")
            if self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params):
                return updated
            if idle_operation_count is not None:
                # No retry from stale activity, including a concurrent touch.
                # The worker must reread activity before any cleanup side effect.
                return None
            current = self.get_operation(operation_id, owner_id=owner_id)
            # A concurrent cancel is sticky. Retry only that change; concurrent
            # worker progress must not be overwritten by a stale runtime value.
            ignored = {"cancelRequested", "lastAccessAt", "updatedAt"}
            if current.model_dump(exclude=ignored) != operation.model_dump(exclude=ignored):
                raise ProjectConflict("operation_state_or_lease_conflict")
        raise ProjectConflict("operation_state_or_lease_conflict")

    def flush_operation_event(self, operation_id: str, *, owner_id: str,
                              lease_generation: int, lease_owner: str) -> RuntimeEvent | None:
        for _ in range(12):
            row = self._operation_row(operation_id, owner_id)
            operation = ProjectOperation.model_validate_json(row["payload"])
            if operation.leaseGeneration != lease_generation or operation.leaseOwner != lease_owner:
                raise ProjectConflict("workspace_lease_lost")
            pending = operation.pendingEvent
            if pending is None:
                return None
            event = self.append_event(operation_id, owner_id=owner_id, event_type=pending["type"],
                payload=pending["payload"], event_id=pending["eventId"],
                lease_generation=lease_generation, lease_owner=lease_owner)
            updated = operation.model_copy(update={"pendingEvent": None})
            params: list[Any] = [_operation_payload(updated), operation_id, row["rev"]]
            fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
            if self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params):
                return event
            current = self.get_operation(operation_id, owner_id=owner_id)
            if current.pendingEvent != pending:
                # A different writer flushed this event and possibly stored the
                # next one. Never clear its outbox using this older event.
                return event
        raise ProjectConflict("operation_event_flush_conflict")

    def claim_operation(self, operation_id: str, *, owner_id: str, lease_owner: str,
                        generation: int) -> ProjectOperation:
        """Fence out the previous worker, leaving uncertain effects to reconcile."""
        row = self._operation_row(operation_id, owner_id)
        operation = ProjectOperation.model_validate_json(row["payload"])
        lease = self.get_lease(operation.projectId, owner_id=owner_id)
        if (lease is None or lease.generation != generation or lease.leaseOwner != lease_owner
                or lease.expiresAt <= time.time()):
            raise ProjectConflict("workspace_lease_lost")
        patch_context = self._runtime_patch_context(operation.input.get("runtimeOperationId"), operation_id,
            owner_id=owner_id, lease_generation=generation, lease_owner=lease_owner, cleanup=True,
            child_kind=operation.kind) if operation.kind in {"runtime.patch", "runtime.verify"} else None
        if operation.status in _TERMINAL_OPERATIONS and operation.pendingEvent is None:
            raise ProjectConflict("operation_state_conflict")
        if operation.leaseGeneration == generation and operation.leaseOwner == lease_owner:
            return operation
        if operation.leaseGeneration is not None and operation.leaseGeneration >= generation:
            raise ProjectConflict("workspace_lease_lost")
        managed_runtime = operation.kind in {"runtime.start", "runtime.exec"} and operation.runtime is not None
        updated = operation.model_copy(update={
            "leaseGeneration": generation, "leaseOwner": lease_owner,
            "status": operation.status if managed_runtime or operation.status == "queued" else "interrupted", "updatedAt": _now(),
        })
        params: list[Any] = [_operation_payload(updated), operation_id, row["rev"]]
        fence = self._fence(operation.projectId, generation, lease_owner, params)
        if patch_context is not None:
            fence += " and " + self._runtime_patch_fence(patch_context, params)
        rows = self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("operation_state_or_lease_conflict")
        if managed_runtime:
            self.flush_operation_event(operation_id, owner_id=owner_id, lease_generation=generation, lease_owner=lease_owner)
            updated = self.get_operation(operation_id, owner_id=owner_id)
            if operation.leaseGeneration is not None and operation.status not in _TERMINAL_OPERATIONS and operation.status != "queued":
                updated = self.update_runtime_operation(operation_id, owner_id=owner_id,
                    lease_generation=generation, lease_owner=lease_owner, expected_status=updated.status,
                    status="interrupted", runtime=updated.runtime.model_copy(update={"status": "reconciling", "health": "unknown"}),
                    result=updated.result)
        return updated

    def transition_operation(self, operation_id: str, *, owner_id: str, expected_status: str,
                             status: str, result: dict[str, Any] | None = None,
                             lease_generation: int | None = None, lease_owner: str | None = None) -> ProjectOperation:
        row = self._operation_row(operation_id, owner_id)
        operation = ProjectOperation.model_validate_json(row["payload"])
        if operation.kind == "runtime.verify" and status == "completed":
            raise ProjectConflict("verification_finish_required")
        if operation.runtime is not None:
            raise ProjectConflict("runtime_operation_update_required")
        same_patch_status = operation.kind in {"runtime.patch", "runtime.verify"} and status == expected_status and status not in _TERMINAL_OPERATIONS
        # A patch has no independently owned process. Its runtime owner can
        # terminalize it in one fenced write after cancellation. Requiring a
        # takeover to turn running into interrupted delays remote cleanup for
        # an entire lease, because finish handles children before destruction.
        cancel_patch = operation.kind in {"runtime.patch", "runtime.verify"} and expected_status == "running" and status == "cancelled"
        if operation.status != expected_status or (not same_patch_status and not cancel_patch
                and status not in _OPERATION_TRANSITIONS.get(expected_status, set())):
            raise ProjectConflict("operation_state_conflict")
        if operation.leaseGeneration is not None and (lease_generation != operation.leaseGeneration or lease_owner != operation.leaseOwner):
            raise ProjectConflict("workspace_lease_lost")
        _bounded(result, MAX_OPERATION_BYTES)
        patch_context = None
        if operation.kind in {"runtime.patch", "runtime.verify"}:
            patch_context = self._runtime_patch_context(operation.input.get("runtimeOperationId"), operation_id,
                owner_id=owner_id, lease_generation=lease_generation, lease_owner=lease_owner,
                require_claim=True, cleanup=status in {"failed", "cancelled"}, child_kind=operation.kind)
            if status == "completed":
                target = self.publication_revision_id(operation.projectId, operation_id)
                parent = patch_context["parent"]
                if (parent.runtime.status != "ready" or parent.runtime.health != "revision_verified"
                        or parent.runtime.revision != target or patch_context["current_revision"] != target
                        or patch_context["lease"].mountedRevision != target):
                    raise ProjectConflict("project_patch_runtime_not_ready")
        updated = ProjectOperation.model_validate({**operation.model_dump(), "status": status,
            "result": result, "updatedAt": _now(), "leaseGeneration": lease_generation, "leaseOwner": lease_owner})
        params: list[Any] = [_operation_payload(updated), operation_id, row["rev"]]
        fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
        if patch_context is not None:
            fence += " and " + self._runtime_patch_fence(patch_context, params)
        rows = self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params)
        if not rows:
            raise ProjectConflict("operation_state_or_lease_conflict")
        if status in _TERMINAL_OPERATIONS:
            notify_operation_waiters(operation_id)
        return updated

    def advance_runtime_revision(self, parent_operation_id: str, patch_operation_id: str, *, owner_id: str,
                                 lease_generation: int, lease_owner: str, target_revision: str) -> ProjectOperation:
        self.flush_operation_event(parent_operation_id, owner_id=owner_id,
            lease_generation=lease_generation, lease_owner=lease_owner)
        context = self._runtime_patch_context(parent_operation_id, patch_operation_id, owner_id=owner_id,
            lease_generation=lease_generation, lease_owner=lease_owner, require_claim=True)
        parent, child, lease = context["parent"], context["child"], context["lease"]
        expected_target = self.publication_revision_id(parent.projectId, patch_operation_id)
        sync = (parent.result or {}).get("sourceSync", {})
        if (target_revision != expected_target or context["current_revision"] != target_revision
                or lease.mountedRevision != target_revision or child.status != "running"
                or parent.runtime.revision not in {child.expectedRevision, target_revision}
                or sync.get("operationId") != patch_operation_id or sync.get("baseRevision") != child.expectedRevision
                or sync.get("targetRevision") != target_revision):
            raise ProjectConflict("project_patch_revision_mismatch")
        revision = self.get_revision(parent.projectId, target_revision, owner_id=owner_id)
        if revision.parentRevision != child.expectedRevision or revision.planRef != child.approvalRef:
            raise ProjectConflict("project_patch_publication_mismatch")
        params: list[Any] = []
        fence = self._runtime_patch_fence(context, params)
        if parent.runtime.revision == target_revision:
            if not self._q("select 1 as valid where " + fence, params):
                raise ProjectConflict("operation_state_or_lease_conflict")
            return parent
        if parent.runtime.status != "syncing":
            raise ProjectConflict("project_patch_sync_required")
        runtime = parent.runtime.model_copy(update={"revision": target_revision, "status": "syncing", "health": "unknown"})
        version, now = parent.stateVersion + 1, _now()
        pending = {"eventId": f"{parent_operation_id}:state:{version}", "type": "runtime.state", "payload": {
            "operationId": parent_operation_id, "status": parent.status, "runtime": runtime.model_dump(),
            "cancelRequested": parent.cancelRequested, "stateVersion": version, "updatedAt": now}}
        _bounded(pending["payload"], MAX_EVENT_BYTES)
        updated = parent.model_copy(update={"runtime": runtime, "stateVersion": version,
            "pendingEvent": pending, "updatedAt": now})
        params = [updated.model_dump_json(), parent_operation_id, context["parent_rev"]]
        fence = self._runtime_patch_fence(context, params)
        if not self._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2 and rev=$3 and " + fence + " returning id", params):
            raise ProjectConflict("operation_state_or_lease_conflict")
        return updated

    def append_event(self, operation_id: str, *, owner_id: str, event_type: str,
                     payload: dict[str, Any] | None = None, event_id: str | None = None,
                     lease_generation: int | None = None, lease_owner: str | None = None) -> RuntimeEvent:
        operation = self.get_operation(operation_id, owner_id=owner_id)
        if operation.leaseGeneration is not None and (lease_generation != operation.leaseGeneration or lease_owner != operation.leaseOwner):
            raise ProjectConflict("workspace_lease_lost")
        _required(event_type, "event_type_required")
        identity = _required(event_id or uuid.uuid4().hex, "event_id_required")
        _bounded(payload or {}, MAX_EVENT_BYTES)
        for _ in range(12):
            existing = self._q("select payload from wb_project_event where operation_id=$1 and event_id=$2", [operation_id, identity])
            if existing:
                item = RuntimeEvent.model_validate_json(existing[0]["payload"])
                if item.type != event_type or item.payload != (payload or {}):
                    raise ProjectConflict("event_idempotency_conflict")
                return item
            rows = self._q("select coalesce(max(seq),0) as seq from wb_project_event where operation_id=$1", [operation_id])
            seq = int(rows[0]["seq"]) + 1
            if seq > MAX_OPERATION_EVENTS:
                raise ValueError("operation_event_limit")
            event = RuntimeEvent(eventId=identity, sessionId=operation.sessionId, projectId=operation.projectId,
                operationId=operation_id, seq=seq, type=event_type, timestamp=_now(), payload=payload or {})
            params: list[Any] = [operation_id, seq, identity, event.model_dump_json()]
            fence = self._fence(operation.projectId, lease_generation, lease_owner, params)
            saved = self._q("insert into wb_project_event(operation_id,seq,event_id,payload) select $1,$2,$3,$4 where " + fence + " on conflict do nothing returning seq", params)
            if saved:
                notify_operation_waiters(operation_id)
                return event
            # A concurrent append retries at the new cursor. A stale lease fails
            # immediately, before any event can be published by an old worker.
            checks: list[Any] = []
            condition = self._fence(operation.projectId, lease_generation, lease_owner, checks)
            if not self._q("select 1 as valid where " + condition, checks):
                raise ProjectConflict("workspace_lease_lost")
        raise ProjectConflict("event_append_conflict")

    def list_events(self, operation_id: str, *, owner_id: str, after_seq: int = 0,
                    limit: int = 200) -> list[RuntimeEvent]:
        self.get_operation(operation_id, owner_id=owner_id)
        if after_seq < 0 or not 1 <= limit <= 1000:
            raise ValueError("invalid_event_cursor")
        rows = self._q("select payload from wb_project_event where operation_id=$1 and seq>$2 order by seq limit $3", [operation_id, after_seq, limit])
        return [RuntimeEvent.model_validate_json(row["payload"]) for row in rows]

    def wait_for_events(self, operation_id: str, timeout: float) -> bool:
        return wait_for_operation_events(operation_id, timeout)

    def put_preview_snapshot(
        self,
        project_id: str,
        *,
        owner_id: str,
        png: bytes,
        revision: str,
        source: str,
    ) -> None:
        """Latest browser/preview PNG. Not a verification receipt.

        ⚠ 2026-09-19 飞机大战：结果卡只认 project_verify。那趟一次都没调
          verify，browser_view 看了三次也不落图，完成卡空白。这是第二份
          诚实来源——模型看过页面时拍的，不许写成验收通过。
        """
        self.get_project(project_id, owner_id=owner_id)
        src = str(source or "").strip()
        if src not in _PREVIEW_SNAPSHOT_SOURCES:
            raise ValueError("preview_snapshot_source_invalid")
        if not isinstance(png, (bytes, bytearray)):
            raise ValueError("preview_snapshot_invalid")
        data = bytes(png)
        if not data.startswith(_PNG_MAGIC) or not (8 < len(data) <= MAX_PREVIEW_SNAPSHOT_BYTES):
            raise ValueError("preview_snapshot_invalid")
        digest = hashlib.sha256(data).hexdigest()
        content = base64.b64encode(data).decode("ascii")
        captured = datetime.now(timezone.utc).isoformat()
        rev = str(revision or "").strip() or "unknown"
        present = self._q(
            "select project_id from wb_project_preview_snapshot where project_id=$1",
            [project_id],
        )
        if present:
            self._q(
                "update wb_project_preview_snapshot set revision=$1,source=$2,sha256=$3,"
                "size_bytes=$4,content=$5,captured_at=$6 where project_id=$7",
                [rev, src, digest, len(data), content, captured, project_id],
            )
            return
        self._q(
            "insert into wb_project_preview_snapshot"
            "(project_id,revision,source,sha256,size_bytes,content,captured_at) "
            "values($1,$2,$3,$4,$5,$6,$7)",
            [project_id, rev, src, digest, len(data), content, captured],
        )

    def read_preview_snapshot(self, project_id: str, *, owner_id: str) -> bytes | None:
        self.get_project(project_id, owner_id=owner_id)
        rows = self._q(
            "select content,size_bytes from wb_project_preview_snapshot where project_id=$1",
            [project_id],
        )
        if not rows:
            return None
        try:
            data = base64.b64decode(rows[0]["content"], validate=True)
        except Exception as exc:
            raise ProjectStoreUnavailable("preview_snapshot_corrupt") from exc
        if len(data) != int(rows[0]["size_bytes"] or 0) or not data.startswith(_PNG_MAGIC):
            raise ProjectStoreUnavailable("preview_snapshot_corrupt")
        return data


_cached_store: ProjectStore | None = None
_cached_signature: str | None = None
_cache_lock = threading.Lock()


def get_project_store() -> ProjectStore:
    global _cached_store, _cached_signature
    api_url, api_key = http_api_credentials()
    database_url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
    signature = hashlib.sha256(canonical_json([api_url, api_key, database_url]).encode()).hexdigest()
    with _cache_lock:
        if _cached_store is not None and _cached_signature == signature:
            return _cached_store
        if api_url:
            if not api_key:
                raise ProjectStoreUnavailable("project_sql_gateway_credentials_missing")
            gateway = HttpSqlGateway(api_url, api_key)
            store = ProjectStore(lambda sql, params: gateway.query(sql, params), dialect="postgresql")
        elif database_url:
            if getattr(settings, "NODE_ENV", "") == "production" and database_url.startswith("sqlite:"):
                raise ProjectStoreUnavailable("project_durable_database_required")
            store = ProjectStore.from_url(database_url)
        else:
            raise ProjectStoreUnavailable("project_durable_database_required")
        if _cached_store is not None:
            _cached_store.close()
        _cached_store, _cached_signature = store, signature
        return store


def reset_project_store() -> None:
    global _cached_store, _cached_signature
    with _cache_lock:
        if _cached_store is not None:
            _cached_store.close()
        _cached_store = None
        _cached_signature = None
