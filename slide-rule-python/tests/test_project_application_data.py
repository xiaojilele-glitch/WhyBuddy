"""Application rows survive source rebuild through fenced immutable SQLite data.

Use real SQLite bytes and the actual store/lease/parent rows, including a stopped
restore and final-SQL takeover. Cancel is a request to save then stop, never a
reason to discard the user's last successful application write.
"""
import base64
import sqlite3

import pytest

from services.project_application_data import ProjectApplicationDataStore, MAX_DATABASE_BYTES
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from test_project_runtime_patch_store import runtime, parent_state


def database(title="saved task"):
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript("CREATE TABLE metadata(key TEXT PRIMARY KEY,value INTEGER); INSERT INTO metadata VALUES('schema',1);"
            "CREATE TABLE users(id TEXT,username TEXT,salt TEXT,password_hash TEXT,role TEXT);"
            "CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);"
            "CREATE TABLE tasks(id TEXT,title TEXT,status TEXT,created_at TEXT,updated_at TEXT);")
        connection.execute("INSERT INTO tasks VALUES('task-1',?,'open','now','now')", (title,))
        connection.commit()
        return connection.serialize()
    finally:
        connection.close()


def args(rt):
    return dict(owner_id="alice", runtime_operation_id=rt.parent.operationId,
        lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)


def save(rt, backups, payload=None, expected=None):
    return backups.save(rt.project.projectId, **args(rt), payload=payload or database(), expected_version=expected)


def test_true_sqlite_backup_restores_rows_and_keeps_sources_separate(runtime):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    assert backups.load(rt.project.projectId, owner_id="alice") is None
    first = save(rt, backups)
    assert first["version"] == 1 and first["dataSchemaVersion"] == 1 and first["sourceRevision"] == rt.project.currentRevision
    assert save(rt, backups) == first
    second = save(rt, backups, database("edited task"), expected=1)
    assert second["version"] == 2 and second["parentBackupId"] == first["backupId"]
    metadata, restored = backups.load(rt.project.projectId, owner_id="alice")
    assert metadata == second
    database_copy = sqlite3.connect(":memory:")
    try:
        database_copy.deserialize(restored)
        assert database_copy.execute("select title from tasks").fetchone() == ("edited task",)
    finally:
        database_copy.close()
    assert backups.list_backups(rt.project.projectId, owner_id="alice") == [second, first]
    assert rt.store.read_files(rt.project.projectId, owner_id="alice") == rt.files
    assert rt.store.get_project(rt.project.projectId, owner_id="alice").currentRevision == rt.project.currentRevision
    with pytest.raises(ProjectConflict, match="version_conflict"):
        save(rt, backups, database("stale request"), expected=0)
    assert backups.load(rt.project.projectId, owner_id="alice")[0] == second


def test_stopping_cancelled_parent_can_checkpoint_but_foreign_or_released_lease_cannot(runtime):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    rt.store.request_operation_cancel(rt.parent.operationId, owner_id="alice")
    parent_state(rt, "stopping")
    first = save(rt, backups)
    with pytest.raises(ProjectNotFound):
        backups.load(rt.project.projectId, owner_id="mallory")
    with pytest.raises(ProjectNotFound):
        backups.list_backups(rt.project.projectId, owner_id="mallory")
    rt.store.release_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
    with pytest.raises(ProjectConflict):
        save(rt, backups, database("late data"), expected=first["version"])
    assert backups.load(rt.project.projectId, owner_id="alice")[0] == first


def test_stopped_restore_creates_new_head_with_old_content_and_no_new_content_budget(runtime):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    first = save(rt, backups)
    second = save(rt, backups, database("newer task"), expected=1)
    restore = dict(owner_id="alice", lease_generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner, expected_version=2)
    with pytest.raises(ProjectConflict, match="stopped"):
        backups.restore_backup(rt.project.projectId, first["backupId"], **restore)
    rt.store.renew_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation,
        lease_owner=rt.lease.leaseOwner, process_refs={})
    budget = rt.store._q("select * from wb_project_app_data_budget")
    third = backups.restore_backup(rt.project.projectId, first["backupId"], **restore)
    assert third["version"] == 3 and third["parentBackupId"] == second["backupId"]
    assert backups.load(rt.project.projectId, owner_id="alice")[1] == database()
    assert rt.store._q("select * from wb_project_app_data_budget") == budget
    with pytest.raises(ProjectConflict, match="version_conflict"):
        backups.restore_backup(rt.project.projectId, second["backupId"], **restore)
    with pytest.raises(ProjectNotFound):
        backups.restore_backup(rt.project.projectId, "pad-invented", **{**restore, "expected_version": 3})


@pytest.mark.parametrize("invalid", [b"SQLite format 3\0" + b"x" * 200, b"not a database", b"x" * (MAX_DATABASE_BYTES + 1)], ids=["invalid-sqlite", "not-sqlite", "oversized"])
def test_invalid_or_oversized_application_data_cannot_create_a_backup(runtime, invalid):
    backups = ProjectApplicationDataStore(runtime.store)
    with pytest.raises(ValueError, match="database_invalid"):
        save(runtime, backups, invalid)
    assert not backups.list_backups(runtime.project.projectId, owner_id="alice")
    assert not runtime.store._q("select * from wb_project_app_data_budget")


@pytest.mark.parametrize("write", ["budget", "content", "head"])
def test_lost_lease_at_actual_sql_write_cannot_publish_late_application_data(runtime, monkeypatch, write):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    real, injected = rt.store._q, []
    prefix = {"budget": "update wb_project_app_data_budget", "content": "insert into wb_project_app_data_content", "head": "update wb_project_app_data_head"}[write]
    def racing(sql, params=None):
        if sql.startswith(prefix) and not injected:
            injected.append(True)
            rt.store.release_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    with pytest.raises(ProjectConflict):
        save(rt, backups)
    assert injected and backups.load(rt.project.projectId, owner_id="alice") is None
    assert not backups.list_backups(rt.project.projectId, owner_id="alice")


def test_healthy_heartbeat_retries_checkpoint_without_duplicate_version_or_reservation(runtime, monkeypatch):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    real, injected = rt.store._q, []
    def racing(sql, params=None):
        if sql.startswith("update wb_project_app_data_budget") and not injected:
            injected.append(True)
            rt.store.renew_lease(rt.project.projectId, owner_id="alice", generation=rt.lease.generation, lease_owner=rt.lease.leaseOwner)
        return real(sql, params)
    monkeypatch.setattr(rt.store, "_q", racing)
    result = save(rt, backups)
    assert result["version"] == 1 and injected
    assert rt.store._q("select reserved_bytes from wb_project_app_data_budget")[0]["reserved_bytes"] == len(database())


def test_unknown_head_reply_can_be_reconciled_by_content_without_creating_another_version(runtime, monkeypatch):
    rt = runtime
    backups = ProjectApplicationDataStore(rt.store)
    real, injected = rt.store._q, []
    def lost(sql, params=None):
        result = real(sql, params)
        if sql.startswith("update wb_project_app_data_head") and not injected:
            injected.append(True)
            raise ProjectStoreUnavailable("unknown_backup_reply")
        return result
    monkeypatch.setattr(rt.store, "_q", lost)
    with pytest.raises(ProjectStoreUnavailable): save(rt, backups)
    result = save(rt, backups)
    assert result["version"] == 1 and len(backups.list_backups(rt.project.projectId, owner_id="alice")) == 1
    rt.store._q("update wb_project_app_data_content set content=$1", [base64.b64encode(database("tampered data")).decode("ascii")])
    with pytest.raises(ProjectStoreUnavailable, match="corrupt"):
        backups.load(rt.project.projectId, owner_id="alice")
