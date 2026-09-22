"""A real session-list reader must not starve identity or project commits.

2026-09-13 full Studio/E2B smoke: ticket redemption succeeded, then a normal
control scanner SELECT raised SQLite database-is-locked and the runtime failed.
The stores share a database but have separate SQLAlchemy engines. Holding the
actual HTTP list cursor at its first fetched row reproduces a slow reader;
production transactions and result consumption remain unmodified.
"""

from concurrent.futures import ThreadPoolExecutor
import sqlite3
from threading import Event
from types import SimpleNamespace

import pytest
from sqlalchemy import event

from services import app_store, identity_store
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore
from services.sql_gateway import configure_sqlite_journal
from test_project_composition_authority import composed


def test_actual_http_session_reader_allows_other_store_commit_and_control_scan(composed, monkeypatch):
    world = composed
    url = str(world.store._engine.url)
    applications = app_store._sqlalchemy_backend(url)
    monkeypatch.setattr(app_store, "get_backend", lambda: applications)
    # A second row keeps sqlite's cursor alive after execute() fetches row one.
    payload = world.state.model_dump(mode="json")
    assert world.sessions.save("another-session", {**payload, "sessionId": "another-session"}, expected_rev=None)
    entered, release = Event(), Event()

    def slow_reader(connection, cursor, statement, parameters, context, executemany):
        if "coalesce(artifact_count" in statement:
            entered.set()
            assert release.wait(10), "test_reader_release_timeout"

    event.listen(world.sessions._engine, "after_cursor_execute", slow_reader)
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            reader = pool.submit(world.client.get, "/api/sliderule/sessions")
            try:
                assert entered.wait(5), "actual_http_did_not_read_sql_sessions"
                writer = pool.submit(world.accounts.update_profile, world.owner.id, display_name="Concurrent update")
                # A writer must commit while the independent reader still owns
                # its cursor. DELETE journal blocks here; increasing SQL timeout
                # cannot make this assertion pass before release.
                assert writer.result(timeout=2)["display_name"] == "Concurrent update"
                scanner = pool.submit(world.app.state.control_run_service.store.list_runnable)
                assert scanner.result(timeout=2) == []
                fetched = pool.submit(world.client.get, "/api/sliderule/sessions/" + world.state.sessionId)
                assert fetched.result(timeout=2).status_code == 200
            finally:
                release.set()
            response = reader.result(timeout=5)
            assert response.status_code == 200
            assert len(response.json()["sessions"]) == 2
    finally:
        release.set()
        event.remove(world.sessions._engine, "after_cursor_execute", slow_reader)
    # The read cursor and its transaction are released by the actual store.
    assert world.sessions._engine.pool.checkedout() == 0
    assert world.store._engine.pool.checkedout() == 0
    assert world.accounts._x._inner._engine.pool.checkedout() == 0


@pytest.mark.parametrize("entry", ["project", "session", "identity", "application"])
def test_every_store_initializes_existing_sqlite_file_without_losing_rows(tmp_path, entry):
    path = tmp_path / (entry + ".db")
    with sqlite3.connect(path) as old:
        assert old.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
        old.execute("create table retained_source(value text not null)")
        old.execute("insert into retained_source values ('unchanged')")
    url = "sqlite:///" + path.as_posix()
    store = {
        "project": ProjectStore.from_url,
        "session": SqlSessionBlobStore,
        "identity": identity_store._SqlExecutor,
        "application": app_store._sqlalchemy_backend,
    }[entry](url)
    try:
        # Check from a separate DBAPI connection: mode is persisted in the file,
        # not merely remembered by one SQLAlchemy engine/pooled connection.
        with sqlite3.connect(path) as independent:
            assert independent.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert independent.execute("select value from retained_source").fetchone() == ("unchanged",)
    finally:
        engine = getattr(store, "_engine", None)
        if engine is not None:
            engine.dispose()


def test_wal_preserves_read_snapshot_and_cas_then_releases_reader(tmp_path):
    path = tmp_path / "snapshot.db"
    sessions = SqlSessionBlobStore("sqlite:///" + path.as_posix())
    assert sessions.save("s", {"goal": {"text": "before"}}, expected_rev=None)
    reader = sqlite3.connect(path, isolation_level=None)
    try:
        reader.execute("begin")
        assert reader.execute("select rev from sliderule_session where session_id='s'").fetchone() == (1,)
        assert sessions.save("s", {"goal": {"text": "after"}}, expected_rev=1)
        assert not sessions.save("s", {"goal": {"text": "stale overwrite"}}, expected_rev=1)
        assert reader.execute("select rev from sliderule_session where session_id='s'").fetchone() == (1,)
        reader.execute("commit")
        assert reader.execute("select rev from sliderule_session where session_id='s'").fetchone() == (2,)
        assert sessions.load("s").payload["goal"]["text"] == "after"
    finally:
        reader.close()
        sessions._engine.dispose()


def test_wal_keeps_single_writer_and_failed_transaction_rollback(tmp_path):
    path = tmp_path / "writer.db"
    store = ProjectStore.from_url("sqlite:///" + path.as_posix())
    store._q("create table exactly_once(id integer primary key, value text)")
    first, second = sqlite3.connect(path), sqlite3.connect(path, timeout=0)
    try:
        first.execute("insert into exactly_once values (1,'pending')")
        assert store._q("select * from exactly_once") == []
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            second.execute("insert into exactly_once values (2,'must not be queued')")
        second.rollback()
        first.rollback()
        assert store._q("select * from exactly_once") == []
        store._q("insert into exactly_once values (3,'committed')")
        assert store._q("select * from exactly_once") == [{"id": 3, "value": "committed"}]
    finally:
        first.close()
        second.close()
        store.close()


def test_memory_database_stays_shared_and_postgres_does_not_connect():
    store = ProjectStore.from_url("sqlite:///:memory:")
    try:
        store._q("create table preserved(value text)")
        store._q("insert into preserved values ('present')")
        configure_sqlite_journal(store._engine)
        assert store._q("PRAGMA journal_mode") == [{"journal_mode": "memory"}]
        assert store._q("select * from preserved") == [{"value": "present"}]
    finally:
        store.close()
    def forbidden():
        raise AssertionError("sqlite_configuration_connected_to_postgres")
    configure_sqlite_journal(SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), connect=forbidden))
