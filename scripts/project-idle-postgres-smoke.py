"""Observe real PostgreSQL row-lock ordering between live edits and idle stop.

Run with the repository venv and --database-url-env WHYBUDDY_PG_IDLE_SMOKE_URL.
Only an explicitly named dedicated PostgreSQL connection is used. The fixture
creates a unique schema, real source/lease/runtime records, and removes that
schema afterwards. No LLM, E2B or browser is invoked.

2026-09-13: SQLite's statement serialization hid a PostgreSQL READ COMMITTED
race. An idle UPDATE could take its count snapshot before admission committed,
wait for the parent lock, then still stop a runtime with a newly admitted edit.
The reverse ordering could admit a child after idle-stop won. Observe both
waits in pg_stat_activity, including the actual deployed HTTP SQL transport.
The winning method runs in a held database transaction only to control commit
order; the competing method uses the unmodified production store adapter.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
SCHEMA_PREFIX = "wb_project_idle_smoke_"
OWNER = "postgres-idle-smoke-owner"

_spec = importlib.util.spec_from_file_location("control_postgres_smoke", ROOT / "scripts/control-postgres-smoke.py")
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
check, sql_query, write_json = base.check, base.sql_query, base.write_json


class ProjectIdleSmoke(base.Smoke):
    def transaction_store(self, store, connection):
        # The constructor runs CREATE INDEX IF NOT EXISTS, which holds relation
        # locks even when the index exists. Reinitializing inside the held
        # transaction would test those locks instead of the parent's row CAS.
        held = copy(store)
        held._engine = None
        held._query = lambda sql, params: sql_query(connection, sql, params)
        return held

    @contextmanager
    def stores(self, transport):
        from services.project_store import ProjectStore

        gateways, restore = [], None
        store = None
        try:
            if transport == "sqlalchemy":
                store = ProjectStore.from_url(base.isolated_url(self.url, self.schema, self.schema + "_project"))
            else:
                import services.project_store as stores

                # Use the product composition point too: manually selecting a
                # PostgreSQL dialect here would miss a disconnected HTTP factory.
                settings = stores.settings
                saved = (settings.APP_STORE_HTTP_API_URL, settings.APP_STORE_HTTP_API_KEY,
                         settings.APP_STORE_DATABASE_URL, stores.HttpSqlGateway)
                stores.reset_project_store()
                settings.APP_STORE_HTTP_API_URL, settings.APP_STORE_HTTP_API_KEY = self.gateway_url, self.gateway_key
                settings.APP_STORE_DATABASE_URL = ""

                def tracked_gateway(*args, **kwargs):
                    gateway = saved[3](*args, **kwargs)
                    gateways.append(gateway)
                    return gateway

                # Only retain real client handles for cleanup; query execution,
                # authentication and the factory's dialect choice remain real.
                stores.HttpSqlGateway = tracked_gateway

                def restore():
                    stores.reset_project_store()
                    (settings.APP_STORE_HTTP_API_URL, settings.APP_STORE_HTTP_API_KEY,
                     settings.APP_STORE_DATABASE_URL, stores.HttpSqlGateway) = saved

                store = stores.get_project_store()
            yield store
        finally:
            if store is not None:
                store.close()
            if restore is not None:
                restore()
            for gateway in gateways:
                gateway._client.close()

    def fixture(self, store):
        from models.project_runtime import RuntimeInstance

        files = {"package.json": "{}", "src/App.tsx": "export const title = 'before';"}
        project = store.create_project("pg-idle-" + uuid.uuid4().hex, owner_id=OWNER,
            files=files, template_version="vite-1", plan_ref="plan-1", spec_revision="spec-1")
        parent = store.create_operation(project.projectId, owner_id=OWNER, kind="runtime.start",
            idempotency_key="start-1", expected_revision=project.currentRevision, approval_ref="plan-1", input={"port": 5173})
        lease = store.acquire_lease(project.projectId, owner_id=OWNER, lease_owner="runtime-owner", ttl_seconds=120)
        store.claim_operation(parent.operationId, owner_id=OWNER, lease_owner=lease.leaseOwner, generation=lease.generation)
        lease = store.renew_lease(project.projectId, owner_id=OWNER, lease_owner=lease.leaseOwner,
            generation=lease.generation, sandbox_id="fixture-sandbox", mounted_revision=project.currentRevision,
            process_refs={"operationId": parent.operationId, "server": "43"})
        instance = RuntimeInstance(runtimeId="rt-" + parent.operationId, projectId=project.projectId,
            workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
            processId="43", health="revision_verified", expiresAt=time.time() + 900,
            lastHeartbeat=parent.createdAt)
        parent = store.update_runtime_operation(parent.operationId, owner_id=OWNER, lease_generation=lease.generation,
            lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=instance,
            result={"readyAt": time.time() - 60})
        # Flush the fixture's state event before creating a row-lock wait. The
        # observed blocked SQL must be the idle decision or patch admission.
        store.flush_operation_event(parent.operationId, owner_id=OWNER,
            lease_generation=lease.generation, lease_owner=lease.leaseOwner)
        parent = store.get_operation(parent.operationId, owner_id=OWNER)
        check(parent.pendingEvent is None, "fixture has an unflushed state event")
        return SimpleNamespace(store=store, project=project, parent=parent, lease=lease, files=files)

    def enqueue(self, store, fixture, *, key="patch-1"):
        from services.project_manifest import content_hash

        return store.enqueue_runtime_patch(fixture.parent.operationId, owner_id=OWNER,
            expected_revision=fixture.project.currentRevision, approval_ref="plan-1", idempotency_key=key,
            changes=[{"path": "src/App.tsx", "content": "export const title = 'after';",
                      "expectedSha256": content_hash(fixture.files["src/App.tsx"])}])

    def idle_stop(self, store, fixture, count):
        return store.update_runtime_operation(fixture.parent.operationId, owner_id=OWNER,
            lease_generation=fixture.lease.generation, lease_owner=fixture.lease.leaseOwner,
            expected_status="running", status="running",
            runtime=fixture.parent.runtime.model_copy(update={"status": "stopping"}),
            result={"phase": "stopping", "cleanup": {"code": "runtime_idle_expired"}},
            idle_operation_count=count, idle_last_access_at=fixture.parent.lastAccessAt)

    def lock_observed(self, transport, blocker_pid, *, statement_prefix):
        row = self.wait_locked(self.schema + ("_project" if transport == "sqlalchemy" else "_http"),
                               blocker_pid=blocker_pid)
        check(row["pid"] != blocker_pid, "race used only one database connection")
        check(row["wait_event"] in {"transactionid", "tuple"}, "fixture observed a relation lock, not parent row ordering")
        query = self.query("select query from pg_stat_activity where pid=$1", [row["pid"]])[0]["query"]
        check(query.startswith(statement_prefix), "the wrong statement waited on the parent row lock")
        self.report["lockObservations"][-1]["statement"] = statement_prefix

    def admission_first(self, transport):
        with self.stores(transport) as store:
            fixture = self.fixture(store)
            count = store.project_operation_count(fixture.project.projectId, owner_id=OWNER)
            before = store.get_operation(fixture.parent.operationId, owner_id=OWNER)
            with self.monitor.begin() as blocker:
                locked = self.transaction_store(store, blocker)
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                child = self.enqueue(locked, fixture)
                pending = self.executor.submit(self.idle_stop, store, fixture, count)
                self.lock_observed(transport, blocker_pid, statement_prefix="update wb_project_operation set payload=")
                check(store.project_operation_count(fixture.project.projectId, owner_id=OWNER) == count,
                      "competing connection saw an uncommitted admission")
            check(pending.result(timeout=base.WAIT_SECONDS) is None,
                  "stale idle UPDATE stopped the runtime after patch admission committed")
            after = store.get_operation(fixture.parent.operationId, owner_id=OWNER)
            check(after.model_dump() == before.model_dump(), "rejected idle stop changed parent payload or cleanup")
            check(store.list_runtime_patches(fixture.parent.operationId, owner_id=OWNER) == [child],
                  "winning admission was lost or duplicated")
            accepted = store.runtime_patch_activity_at(fixture.parent.operationId, owner_id=OWNER)
            check(accepted > 0, "accepted edit did not create durable activity")
            check(self.enqueue(store, fixture).operationId == child.operationId, "retry admitted a second child")
            check(store.runtime_patch_activity_at(fixture.parent.operationId, owner_id=OWNER) == accepted,
                  "idempotent retry renewed idle activity")

    def idle_first(self, transport):
        from services.project_store import ProjectConflict

        with self.stores(transport) as store:
            fixture = self.fixture(store)
            count = store.project_operation_count(fixture.project.projectId, owner_id=OWNER)
            with self.monitor.begin() as blocker:
                locked = self.transaction_store(store, blocker)
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                stopped = self.idle_stop(locked, fixture, count)
                check(stopped is not None, "uncontested idle stop could not commit")
                pending = self.executor.submit(self.enqueue, store, fixture)
                self.lock_observed(transport, blocker_pid, statement_prefix="with admitted_parent as (")
                check(store.get_operation(fixture.parent.operationId, owner_id=OWNER).runtime.status == "ready",
                      "competing connection saw an uncommitted idle stop")
            try:
                pending.result(timeout=base.WAIT_SECONDS)
            except ProjectConflict as exc:
                check(str(exc) == "project_runtime_patch_changed", "admission failed at an unexpected boundary")
            else:
                raise AssertionError("patch admission succeeded after idle stop committed")
            after = store.get_operation(fixture.parent.operationId, owner_id=OWNER)
            check(after.runtime.status == "stopping" and after.result["cleanup"]["code"] == "runtime_idle_expired",
                  "losing admission damaged the winning idle-stop decision")
            check(store.project_operation_count(fixture.project.projectId, owner_id=OWNER) == count,
                  "rejected admission created an orphan child")
            check(not store.list_runtime_patches(fixture.parent.operationId, owner_id=OWNER),
                  "rejected admission left a queued child")
            check(store.runtime_patch_activity_at(fixture.parent.operationId, owner_id=OWNER) == 0,
                  "rejected admission created fake activity")

    def duplicate_admission(self, transport):
        with self.stores(transport) as store:
            fixture = self.fixture(store)
            before = store.touch_operation(fixture.parent.operationId, owner_id=OWNER)
            with self.monitor.begin() as blocker:
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select id from wb_project_operation where id=$1 for update", [fixture.parent.operationId])
                pending = [self.executor.submit(self.enqueue, store, fixture) for _ in range(2)]
                deadline = time.monotonic() + base.WAIT_SECONDS
                while time.monotonic() < deadline:
                    rows = self.query("select pid,wait_event,query,pg_blocking_pids(pid) as blockers from pg_stat_activity "
                        "where application_name=$1 and wait_event_type='Lock'",
                        [self.schema + ("_project" if transport == "sqlalchemy" else "_http")])
                    connected = {blocker_pid}
                    # PostgreSQL may report a preceding waiter as a soft blocker.
                    # Require both chains to reach this exact held parent lock.
                    for _ in rows:
                        connected.update(row["pid"] for row in rows if connected.intersection(row["blockers"]))
                    if len(rows) == 2 and all(row["pid"] in connected for row in rows):
                        break
                    time.sleep(0.025)
                else:
                    raise AssertionError("both duplicate admissions did not wait on the same parent row lock")
                for row in rows:
                    check(row["query"].startswith("with admitted_parent as ("), "duplicate fixture waited at the wrong SQL")
                    check(row["wait_event"] in {"transactionid", "tuple"}, "duplicate fixture observed a relation lock")
                    self.report.setdefault("lockObservations", []).append({
                        "check": dict(self.report["activeCheck"]), "blockedPid": row["pid"],
                        "rootBlockerPid": blocker_pid, "blockerPids": row["blockers"],
                        "waitEvent": row["wait_event"], "statement": "with admitted_parent as ("})
            first, second = [future.result(timeout=base.WAIT_SECONDS) for future in pending]
            check(first == second, "concurrent duplicate requests returned different children")
            check(store.list_runtime_patches(fixture.parent.operationId, owner_id=OWNER) == [first],
                  "concurrent duplicate requests created more than one child")
            after = store.get_operation(fixture.parent.operationId, owner_id=OWNER)
            check(after.model_dump() == before.model_dump(), "admission changed parent activity or runtime state")
            accepted = store.runtime_patch_activity_at(fixture.parent.operationId, owner_id=OWNER)
            check(accepted > 0 and self.enqueue(store, fixture) == first, "idempotent replay changed the accepted request")
            check(store.runtime_patch_activity_at(fixture.parent.operationId, owner_id=OWNER) == accepted,
                  "duplicate replay manufactured new idle activity")

    def run(self, transport):
        self.record(transport, "admission-first-rejects-waiting-stale-idle-update", lambda: self.admission_first(transport))
        self.record(transport, "idle-first-rejects-waiting-admission-without-child", lambda: self.idle_first(transport))
        self.record(transport, "concurrent-duplicate-admission-creates-one-child-without-renewing-activity",
                    lambda: self.duplicate_admission(transport))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url-env", required=True, help="dedicated PostgreSQL test URL environment variable")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.database_url_env in {"APP_STORE_DATABASE_URL", "DATABASE_URL", "DB_URL"}:
        parser.error("use a dedicated smoke-test variable, not a workspace database default")
    raw = os.environ.get(args.database_url_env, "").strip()
    if not raw:
        parser.error("the explicitly selected test connection environment variable is empty")
    sys.path.insert(0, str(BACKEND))
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    schema = SCHEMA_PREFIX + uuid.uuid4().hex[:16]
    directory = (args.output_dir or ROOT / "artifacts" / ("project-idle-postgres-" + schema[-16:])).resolve()
    check(directory.is_relative_to((ROOT / "artifacts").resolve()), "reports must remain under artifacts")
    directory.mkdir(parents=True, exist_ok=False)
    report = {"kind": "real-postgresql-project-idle-ordering", "status": "running", "schema": schema,
              "checks": [], "cleanup": "pending", "limitations": [
                  "Exercises real stores and the deployed HTTP SQL gateway against the supplied PostgreSQL.",
                  "Does not invoke a runtime worker, LLM, E2B or browser or validate production TLS."]}
    admin = smoke = None
    created = False
    try:
        admin = create_engine(base.isolated_url(raw, schema, schema + "_admin"), poolclass=NullPool,
                              connect_args={"connect_timeout": 8})
        with admin.begin() as connection:
            version = connection.execute(text("select current_setting('server_version')")).scalar_one()
            check(int(version.split(".")[0]) >= 12, "PostgreSQL 12 or newer is required")
            connection.execute(text(f'create schema "{schema}"'))
            created = True
        report["serverVersion"] = version
        smoke = ProjectIdleSmoke(raw, schema, directory, report)
        check(smoke.query("select current_schema() as schema")[0]["schema"] == schema,
              "test connection did not enter the isolated schema")
        smoke.run("sqlalchemy")
        smoke.start_gateway()
        smoke.run("http-gateway")
        report["status"] = "passed"
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = {"type": type(exc).__name__,
            "message": str(exc) if isinstance(exc, AssertionError) else "connection details omitted"}
        cause = getattr(exc, "orig", None) or getattr(exc, "__cause__", None)
        if cause is not None:
            report["error"].update(causeType=type(cause).__name__, sqlstate=getattr(cause, "sqlstate", None))
    finally:
        if smoke is not None:
            try:
                smoke.close()
            except Exception as exc:
                report["workerCleanup"] = "failed:" + type(exc).__name__
                report["status"] = "failed"
        if created and admin is not None:
            try:
                check(re.fullmatch(SCHEMA_PREFIX + "[0-9a-f]{16}", schema) is not None, "invalid cleanup schema")
                with admin.begin() as connection:
                    connection.execute(text(f'drop schema "{schema}" cascade'))
                with admin.connect() as connection:
                    remaining = connection.execute(text("select 1 from pg_namespace where nspname=:schema"), {"schema": schema}).first()
                check(remaining is None, "isolated schema remains after cleanup")
                report["cleanup"] = "schema-dropped-and-confirmed"
            except Exception as exc:
                report["cleanup"] = "failed:" + type(exc).__name__
                report["status"] = "failed"
        else:
            report["cleanup"] = "schema-not-created"
        if admin is not None:
            admin.dispose()
        write_json(directory / "report.json", report)
    print(json.dumps({"status": report["status"], "passed": len(report["checks"]),
                      "cleanup": report["cleanup"], "report": str(directory / "report.json")}), flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
