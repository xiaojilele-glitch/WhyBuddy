"""Immutable application SQLite backups, independent of project source trees.

The runtime owner checkpoints an atomic database file while its lease is valid,
including cancellation cleanup. A failed/unknown upload never means data saved.
Only a head CAS publishes a backup; orphan content and records are not history.
Restoring an older database makes a new version while the application is stopped.
"""
from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import time
from datetime import datetime, timezone

from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable

MAX_DATABASE_BYTES = 8 * 1024 * 1024
MAX_PROJECT_DATA_BYTES = 64 * 1024 * 1024
_DDL = (
    "create table if not exists wb_project_app_data_head(project_id varchar(80) primary key,backup_id varchar(80),version integer not null,rev integer not null)",
    "create table if not exists wb_project_app_data_backup(id varchar(80) primary key,project_id varchar(80) not null,payload text not null)",
    "create table if not exists wb_project_app_data_content(project_id varchar(80) not null,hash varchar(64) not null,size_bytes integer not null,content text not null,primary key(project_id,hash))",
    "create table if not exists wb_project_app_data_budget(project_id varchar(80) primary key,reserved_bytes bigint not null)",
)


def _validate_database(payload):
    if not isinstance(payload, bytes) or not 100 <= len(payload) <= MAX_DATABASE_BYTES or not payload.startswith(b"SQLite format 3\0"):
        raise ValueError("project_application_database_invalid")
    connection = sqlite3.connect(":memory:")
    try:
        connection.deserialize(payload)
        connection.execute("pragma trusted_schema=OFF")
        connection.execute("pragma query_only=ON")
        remaining = [200]
        def progress():
            remaining[0] -= 1
            return int(remaining[0] <= 0)
        connection.set_progress_handler(progress, 1000)
        # Data is read only; no generated application SQL or triggers execute.
        tables = set(row[0] for row in connection.execute("select name from sqlite_schema where type='table'"))
        if not {"metadata", "users", "sessions", "tasks"}.issubset(tables):
            raise ValueError("project_application_database_schema_invalid")
        for table, columns in {"metadata": {"key", "value"}, "users": {"id", "username", "salt", "password_hash", "role"},
                               "sessions": {"token_hash", "user_id", "expires_at"},
                               "tasks": {"id", "title", "status", "created_at", "updated_at"}}.items():
            schema = connection.execute(f"pragma table_xinfo({table})").fetchall()
            actual = {row[1] for row in schema}
            if not columns.issubset(actual) or any(row[-1] != 0 for row in schema):
                raise ValueError("project_application_database_schema_invalid")
        if connection.execute("select value from metadata where key='schema'").fetchone() != (1,):
            raise ValueError("project_application_database_schema_invalid")
        if connection.execute("pragma quick_check").fetchall() != [("ok",)]:
            raise ValueError("project_application_database_invalid")
    except sqlite3.Error:
        raise ValueError("project_application_database_invalid") from None
    finally:
        connection.close()


class ProjectApplicationDataStore:
    def __init__(self, store):
        self.store = store
        for sql in _DDL:
            store._q(sql)

    def _head(self, project_id, owner_id):
        self.store.get_project(project_id, owner_id=owner_id)
        rows = self.store._q("select * from wb_project_app_data_head where project_id=$1", [project_id])
        return rows[0] if rows else {"project_id": project_id, "backup_id": None, "version": 0, "rev": 0}

    def _metadata(self, project_id, backup_id):
        rows = self.store._q("select payload from wb_project_app_data_backup where id=$1 and project_id=$2", [backup_id, project_id])
        if not rows:
            raise ProjectStoreUnavailable("project_application_backup_missing")
        return json.loads(rows[0]["payload"])

    def list_backups(self, project_id, *, owner_id, limit=20):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("project_application_backup_limit_invalid")
        head, result = self._head(project_id, owner_id), []
        current = head["backup_id"]
        while current and len(result) < limit:
            item = self._metadata(project_id, current)
            result.append(item)
            current = item["parentBackupId"]
        return result

    def _content(self, project_id, metadata):
        rows = self.store._q("select content,size_bytes from wb_project_app_data_content where project_id=$1 and hash=$2", [project_id, metadata["sha256"]])
        if not rows:
            raise ProjectStoreUnavailable("project_application_data_missing")
        try:
            data = base64.b64decode(rows[0]["content"], validate=True)
        except ValueError:
            raise ProjectStoreUnavailable("project_application_data_corrupt") from None
        if len(data) != rows[0]["size_bytes"] or len(data) != metadata["sizeBytes"] or hashlib.sha256(data).hexdigest() != metadata["sha256"]:
            raise ProjectStoreUnavailable("project_application_data_corrupt")
        return data

    def load(self, project_id, *, owner_id):
        head = self._head(project_id, owner_id)
        if not head["backup_id"]:
            return None
        metadata = self._metadata(project_id, head["backup_id"])
        return metadata, self._content(project_id, metadata)

    def _context(self, project_id, owner_id, generation, lease_owner, runtime_operation_id):
        if runtime_operation_id is not None:
            context = self.store._runtime_patch_context(runtime_operation_id, owner_id=owner_id,
                lease_generation=generation, lease_owner=lease_owner, cleanup=True)
            parent, lease = context["parent"], context["lease"]
            if (parent.projectId != project_id or parent.status not in {"running", "cancelling"}
                    or not parent.runtime.processId or not lease.sandboxId
                    or lease.processRefs.get("server") != parent.runtime.processId
                    or parent.runtime.revision != lease.mountedRevision):
                raise ProjectConflict("project_application_checkpoint_unavailable")
            return context
        project = self.store.get_project(project_id, owner_id=owner_id)
        lease = self.store.get_lease(project_id, owner_id=owner_id)
        if (lease is None or lease.generation != generation or lease.leaseOwner != lease_owner
                or lease.expiresAt <= time.time() or lease.processRefs.get("server") or lease.processRefs.get("operationId")):
            raise ProjectConflict("project_application_restore_requires_stopped_runtime")
        return {"project": project, "lease": lease, "owner_id": owner_id, "generation": generation,
                "lease_owner": lease_owner, "lease_payload": lease.model_dump_json()}

    def _guard(self, context, params):
        project_id = context["project"].projectId
        if "parent" in context:
            fence = self.store._runtime_patch_fence(context, params)
        else:
            i = len(params) + 1
            params.extend([project_id, context["owner_id"], context["lease_payload"], context["generation"], context["lease_owner"], time.time()])
            fence = (f"exists(select 1 from wb_project p join wb_project_lease l on l.project_id=p.id where p.id=${i} "
                f"and p.owner_id=${i+1} and l.payload=${i+2} and l.generation=${i+3} and l.lease_owner=${i+4} and l.expires_at>${i+5})")
        if self.store._dialect != "postgresql":
            return "", fence
        i = len(params) + 1
        params.extend([project_id, context["lease_payload"], context["generation"], context["lease_owner"]])
        prefix = ("with application_lease as (select project_id from wb_project_lease "
            f"where project_id=${i} and payload=${i+1} and generation=${i+2} and lease_owner=${i+3} "
            "and expires_at>extract(epoch from clock_timestamp()) for update) ")
        if "parent" in context:
            i = len(params) + 1
            params.extend([context["parent"].operationId, context["parent_rev"], context["parent_payload"]])
            prefix = prefix.rstrip() + ", application_parent as (update wb_project_operation set rev=rev+1 "
            prefix += f"where id=${i} and rev=${i+1} and payload=${i+2} and exists(select 1 from application_lease) and " + fence + " returning id) "
            return prefix, "exists(select 1 from application_parent)"
        return prefix, "exists(select 1 from application_lease) and " + fence

    def _write(self, scope, sql, params):
        for attempt in range(3):
            context = self._context(**scope)
            bound = list(params)
            prefix, fence = self._guard(context, bound)
            rows = self.store._q(prefix + sql.replace("{fence}", fence), bound)
            if rows:
                return rows
            observed = self._context(**scope)
            stable = all(observed[key] == context[key] for key in ("lease_payload", "generation", "lease_owner"))
            if "parent" in context:
                stable = stable and observed["parent_payload"] == context["parent_payload"] and observed["project_rev"] == context["project_rev"]
                stable = stable and observed["parent_rev"] == context["parent_rev"] + (1 if self.store._dialect == "postgresql" else 0)
            if stable:
                return []
        raise ProjectConflict("project_application_checkpoint_changed")

    def save(self, project_id, *, owner_id, runtime_operation_id, lease_generation, lease_owner, payload, expected_version):
        if not isinstance(runtime_operation_id, str) or not runtime_operation_id:
            raise ValueError("project_application_runtime_required")
        if expected_version is not None and (isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 0):
            raise ValueError("project_application_version_invalid")
        _validate_database(payload)
        scope = dict(project_id=project_id, owner_id=owner_id, generation=lease_generation,
                     lease_owner=lease_owner, runtime_operation_id=runtime_operation_id)
        context = self._context(**scope)
        digest = hashlib.sha256(payload).hexdigest()
        head = self._head(project_id, owner_id)
        if head["backup_id"]:
            current = self._metadata(project_id, head["backup_id"])
            if current["sha256"] == digest and current["sourceRevision"] == context["parent"].runtime.revision:
                return current
        if expected_version != head["version"] and not (expected_version is None and head["version"] == 0):
            raise ProjectConflict("project_application_version_conflict")
        exists = self.store._q("select hash from wb_project_app_data_content where project_id=$1 and hash=$2", [project_id, digest])
        if not exists:
            self._write(scope, "insert into wb_project_app_data_budget(project_id,reserved_bytes) select $1,0 where {fence} on conflict(project_id) do nothing returning project_id", [project_id])
            reserved = self._write(scope, "update wb_project_app_data_budget set reserved_bytes=reserved_bytes+$1 where project_id=$2 and reserved_bytes+$1<=$3 and {fence} returning project_id", [len(payload), project_id, MAX_PROJECT_DATA_BYTES])
            if not reserved:
                raise ValueError("project_application_data_limit")
            inserted = self._write(scope, "insert into wb_project_app_data_content(project_id,hash,size_bytes,content) select $1,$2,$3,$4 where {fence} on conflict(project_id,hash) do nothing returning hash", [project_id, digest, len(payload), base64.b64encode(payload).decode("ascii")])
            if not inserted and not self.store._q("select hash from wb_project_app_data_content where project_id=$1 and hash=$2", [project_id, digest]):
                raise ProjectConflict("project_application_checkpoint_changed")
        return self._publish(scope, head, digest, len(payload), context["parent"].runtime.revision)

    def _publish(self, scope, head, digest, size, source_revision):
        project_id = scope["project_id"]
        identity = json.dumps([project_id, head["backup_id"], digest, source_revision], separators=(",", ":"))
        metadata = {"backupId": "pad-" + hashlib.sha256(identity.encode()).hexdigest()[:40], "projectId": project_id,
            "version": head["version"] + 1, "parentBackupId": head["backup_id"], "sha256": digest,
            "sizeBytes": size, "sourceRevision": source_revision, "dataSchemaVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat()}
        self._write(scope, "insert into wb_project_app_data_head(project_id,backup_id,version,rev) select $1,null,0,1 where {fence} on conflict(project_id) do nothing returning project_id", [project_id])
        self._write(scope, "insert into wb_project_app_data_backup(id,project_id,payload) select $1,$2,$3 where {fence} on conflict(id) do nothing returning id", [metadata["backupId"], project_id, json.dumps(metadata, separators=(",", ":"))])
        self._write(scope, "update wb_project_app_data_head set backup_id=$1,version=$2,rev=rev+1 where project_id=$3 and version=$4 and {fence} returning backup_id", [metadata["backupId"], metadata["version"], project_id, head["version"]])
        observed = self._head(project_id, scope["owner_id"])
        if observed["backup_id"] != metadata["backupId"]:
            raise ProjectConflict("project_application_version_conflict")
        return self._metadata(project_id, metadata["backupId"])

    def restore_backup(self, project_id, backup_id, *, owner_id, lease_generation, lease_owner, expected_version):
        if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 0:
            raise ValueError("project_application_version_invalid")
        scope = dict(project_id=project_id, owner_id=owner_id, generation=lease_generation,
                     lease_owner=lease_owner, runtime_operation_id=None)
        self._context(**scope)
        head = self._head(project_id, owner_id)
        if expected_version != head["version"]:
            raise ProjectConflict("project_application_version_conflict")
        current, selected = head["backup_id"], None
        for _ in range(10000):
            if not current:
                break
            item = self._metadata(project_id, current)
            if current == backup_id:
                selected = item
                break
            current = item["parentBackupId"]
        if selected is None:
            raise ProjectNotFound("project_application_backup_not_found")
        data = self._content(project_id, selected)
        _validate_database(data)
        return self._publish(scope, head, selected["sha256"], selected["sizeBytes"], selected["sourceRevision"])
