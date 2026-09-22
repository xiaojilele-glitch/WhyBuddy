"""Exercise production session fencing against an explicitly supplied PostgreSQL.

Run with the repository venv and --database-url-env WHYBUDDY_PG_SMOKE_URL.
The named environment variable must contain a dedicated test connection. No
workspace database URL is selected implicitly. Each invocation creates and drops
one unique schema; assertions observe actual PostgreSQL lock waits, not sleeps
that merely assume a competing statement reached the database.

The HTTP phase starts deploy/postgres-https-api/app.py on a local ephemeral port.
Its connection uses the same isolated schema through libpq PGOPTIONS. This tests
the deployed gateway's SQL transport, but not its production TLS or network setup.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
OWNER = "postgres-smoke-owner"
SCHEMA_PREFIX = "wb_control_smoke_"
WAIT_SECONDS = 12


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def sql_query(connection, sql, params=None):
    from sqlalchemy import text

    bound = re.sub(r"\$(\d+)", lambda match: ":p" + match.group(1), sql)
    result = connection.execute(text(bound), {f"p{i + 1}": value for i, value in enumerate(params or [])})
    return [dict(row) for row in result.mappings()] if result.returns_rows else []


def isolated_url(raw, schema, application):
    from sqlalchemy.engine import make_url

    url = make_url(raw)
    check(url.get_backend_name() == "postgresql", "a PostgreSQL test connection is required")
    check(bool(url.database), "the dedicated test database must be explicit")
    options = str(url.query.get("options", ""))
    options += (f" -c search_path={schema} -c statement_timeout=20000"
                " -c lock_timeout=15000 -c idle_in_transaction_session_timeout=20000")
    return url.set(drivername="postgresql+psycopg").update_query_dict({
        "options": options.strip(), "application_name": application,
    }).render_as_string(hide_password=False)


def fence(record):
    return {"runId": record["runId"], "ownerId": OWNER,
            "workerId": record["leaseOwner"], "generation": record["generation"]}


class Smoke:
    def __init__(self, database_url, schema, directory, report):
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool

        self.url, self.schema, self.directory, self.report = database_url, schema, directory, report
        self.monitor = create_engine(isolated_url(database_url, schema, schema + "_monitor"),
                                     poolclass=NullPool, connect_args={"connect_timeout": 8})
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.gateway = None
        self.gateway_log = None
        self.gateway_url = None
        self.gateway_key = secrets.token_urlsafe(32)

    def close(self):
        try:
            self.executor.shutdown(wait=True, cancel_futures=True)
        finally:
            try:
                if self.gateway is not None:
                    self.gateway.terminate()
                    try:
                        self.gateway.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.gateway.kill()
                        self.gateway.wait(timeout=10)
            finally:
                if self.gateway_log is not None:
                    self.gateway_log.close()
                self.monitor.dispose()

    def query(self, sql, params=None):
        with self.monitor.begin() as connection:
            return sql_query(connection, sql, params)

    def wait_locked(self, application, *, blocker_pid):
        deadline = time.monotonic() + WAIT_SECONDS
        while time.monotonic() < deadline:
            rows = self.query(
                "select pid,wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity "
                "where application_name=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid))",
                [application, blocker_pid])
            if rows:
                self.report.setdefault("lockObservations", []).append({
                    "check": dict(self.report.get("activeCheck", {})),
                    "blockedPid": rows[0]["pid"], "blockerPid": blocker_pid,
                    "waitEvent": rows[0]["wait_event"],
                })
                return rows[0]
            time.sleep(0.025)
        raise AssertionError("competing production SQL did not reach the expected PostgreSQL lock")

    @contextmanager
    def stores(self, transport):
        from services.control_run_store import ControlRunStore
        from services.project_store import ProjectStore
        from services.session_blob_store import HttpApiSessionBlobStore, SqlSessionBlobStore

        sessions = projects = gateway = None
        try:
            if transport == "sqlalchemy":
                sessions = SqlSessionBlobStore(isolated_url(self.url, self.schema, self.schema + "_session"))
                projects = ProjectStore.from_url(isolated_url(self.url, self.schema, self.schema + "_control"))
                controls = ControlRunStore(projects._q)
            else:
                from services.sql_gateway import HttpSqlGateway

                sessions = HttpApiSessionBlobStore(self.gateway_url, self.gateway_key)
                gateway = HttpSqlGateway(self.gateway_url, self.gateway_key, timeout_s=25)
                controls = ControlRunStore(gateway.query)
            yield sessions, controls
        finally:
            if projects is not None:
                projects.close()
            if sessions is not None:
                if transport == "sqlalchemy":
                    sessions._engine.dispose()
                else:
                    sessions._gateway._client.close()
            if gateway is not None:
                gateway._client.close()

    def start_gateway(self):
        from sqlalchemy.engine import make_url
        import httpx

        url = make_url(self.url)
        env = os.environ.copy()
        env.update({
            "DB_API_KEY": self.gateway_key,
            "DB_HOST": url.host or "127.0.0.1", "DB_PORT": str(url.port or 5432),
            "POSTGRES_DB": url.database, "DB_API_DB_USER": url.username or "",
            "DB_API_DB_PASSWORD": url.password or "",
            "DB_SSLMODE": str(url.query.get("sslmode", "prefer")),
            "PGOPTIONS": str(url.query.get("options", "")) + f" -c search_path={self.schema}",
            "PGAPPNAME": self.schema + "_http",
            "PYTHONUNBUFFERED": "1",
        })
        for key in ("sslrootcert", "sslcert", "sslkey"):
            if key in url.query:
                env["PG" + key.upper()] = str(url.query[key])
        ready = self.directory / "gateway-ready.json"
        self.gateway_log = (self.directory / "gateway.log").open("w", encoding="utf-8")
        self.gateway = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
            "--serve-gateway", str(ready)], cwd=ROOT, env=env,
            stdout=self.gateway_log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            check(self.gateway.poll() is None, "isolated HTTP SQL gateway exited before readiness")
            if ready.exists():
                self.gateway_url = json.loads(ready.read_text(encoding="utf-8"))["url"]
                try:
                    response = httpx.get(self.gateway_url + "/livez", timeout=1)
                    if response.status_code == 200:
                        check(httpx.get(self.gateway_url + "/v1/health", timeout=2).status_code == 401,
                              "HTTP SQL gateway accepted missing credentials")
                        from services.sql_gateway import HttpSqlGateway

                        gateway = HttpSqlGateway(self.gateway_url, self.gateway_key)
                        try:
                            selected = gateway.query("select current_schema() as schema")
                            check(selected[0]["schema"] == self.schema,
                                  "HTTP SQL gateway did not enter the isolated schema")
                        finally:
                            gateway._client.close()
                        return
                except httpx.HTTPError:
                    pass
            time.sleep(0.05)
        raise AssertionError("isolated HTTP SQL gateway readiness timed out")

    def fixture(self, sessions, controls, label, *, existing=True):
        session_id = "pg-" + label + "-" + uuid.uuid4().hex[:10]
        run = controls.submit(session_id, OWNER, "request", {"message": "verify fencing"})
        owned = controls.claim(run["runId"], "old-worker", 300)
        check(owned is not None, "initial worker claim failed")
        payload = {"sessionId": session_id, "ownerId": OWNER, "goal": {"text": "initial"}}
        if existing:
            check(sessions.save(session_id, payload, expected_rev=None, expected_control_run=fence(owned)),
                  "current worker could not insert session")
        return session_id, payload, owned

    def record(self, transport, name, action):
        started = time.monotonic()
        print(f"[postgres-smoke] {transport}: {name}", flush=True)
        self.report["activeCheck"] = {"transport": transport, "name": name}
        action()
        self.report["checks"].append({"transport": transport, "name": name, "status": "passed",
                                     "elapsedMs": round((time.monotonic() - started) * 1000)})
        self.report.pop("activeCheck")
        write_json(self.directory / "report.json", self.report)

    def basic(self, transport):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "basic")
            check(sessions.save(sid, {**payload, "lastTurnId": "current"}, expected_rev=1,
                                expected_control_run=fence(owned)), "current owner update failed")
            for key, value in (("generation", owned["generation"] + 1), ("workerId", "other-worker")):
                check(not sessions.save(sid, payload, expected_rev=2,
                    expected_control_run={**fence(owned), key: value}), "incorrect producer identity was accepted")
            check(not sessions.save(sid, payload, expected_rev=1, expected_control_run=fence(owned)),
                  "stale session revision was accepted")
            row = sessions.load(sid)
            check(row.rev == 2 and row.payload["lastTurnId"] == "current", "rejected writes changed session")

    def write_after_control_change(self, transport, change, *, same_payload=False, existing=True):
        from services.control_run_store import ControlRunStore

        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, change, existing=existing)
            attempted = payload if same_payload else {**payload, "lastTurnId": "stale"}
            replacement = None
            with self.monitor.begin() as blocker:
                # This adapter runs the actual takeover/cancel methods inside the
                # transaction that already holds the row, controlling commit order.
                locked_controls = ControlRunStore(lambda sql, params: sql_query(blocker, sql, params))
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select id from wb_control_run where id=$1 for update", [owned["runId"]])
                pending = self.executor.submit(sessions.save, sid, attempted,
                    expected_rev=1 if existing else None, expected_control_run=fence(owned))
                waiter = self.wait_locked(self.schema + ("_session" if transport == "sqlalchemy" else "_http"),
                                          blocker_pid=blocker_pid)
                check(waiter["pid"] != blocker_pid, "race used a single database connection")
                if change == "takeover":
                    locked_controls.suspend(owned["runId"], owned["leaseOwner"], owned["generation"])
                    replacement = locked_controls.claim(owned["runId"], "new-worker", 300)
                    check(replacement["generation"] == owned["generation"] + 1, "takeover did not advance generation")
                else:
                    locked_controls.cancel(owned["runId"], OWNER)
            check(pending.result(timeout=WAIT_SECONDS) is False, "stale save committed after a control-row change")
            row = sessions.load(sid)
            check((row is None) if not existing else (row.rev == 1 and row.payload == payload),
                  "rejected stale save changed persisted data")
            if replacement is not None:
                check(sessions.save(sid, {**payload, "lastTurnId": "replacement"},
                    expected_rev=1 if existing else None, expected_control_run=fence(replacement)),
                    "replacement worker could not save")
                check(sessions.load(sid).payload["lastTurnId"] == "replacement", "replacement save was not durable")

    def save_first(self, transport):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "save-first")

            def takeover():
                controls.suspend(owned["runId"], owned["leaseOwner"], owned["generation"])
                return controls.claim(owned["runId"], "new-worker", 300)

            with self.monitor.begin() as blocker:
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select session_id from sliderule_session where session_id=$1 for update", [sid])
                pending = self.executor.submit(sessions.save, sid, {**payload, "lastTurnId": "first"},
                    expected_rev=1, expected_control_run=fence(owned))
                waiting_save = self.wait_locked(
                    self.schema + ("_session" if transport == "sqlalchemy" else "_http"), blocker_pid=blocker_pid)
                pending_takeover = self.executor.submit(takeover)
                self.wait_locked(self.schema + ("_control" if transport == "sqlalchemy" else "_http"),
                                 blocker_pid=waiting_save["pid"])
            check(pending.result(timeout=WAIT_SECONDS) is True, "save holding execution rights did not finish first")
            replacement = pending_takeover.result(timeout=WAIT_SECONDS)
            check(replacement["generation"] == owned["generation"] + 1, "waiting takeover did not complete")
            row = sessions.load(sid)
            check(row.rev == 2 and row.payload["lastTurnId"] == "first", "first save lost its data")
            check(not sessions.save(sid, row.payload, expected_rev=row.rev, expected_control_run=fence(owned)),
                  "old worker saved unchanged payload after takeover")
            check(sessions.save(sid, {**payload, "lastTurnId": "second"}, expected_rev=row.rev,
                                expected_control_run=fence(replacement)), "new worker could not continue after first save")

    def cancelled_and_expired(self, transport):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "cancel-request")
            controls.cancel_request(sid, OWNER, "request")
            check(not sessions.save(sid, payload, expected_rev=1, expected_control_run=fence(owned)),
                  "request cancellation accepted unchanged payload")
            sid, payload, owned = self.fixture(sessions, controls, "expired")
            controls.suspend(owned["runId"], owned["leaseOwner"], owned["generation"])
            check(not sessions.save(sid, payload, expected_rev=1, expected_control_run=fence(owned)),
                  "released lease could still save")

    def lease_expires_while_waiting(self, transport, *, existing=True):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "expires-waiting", existing=existing)
            owned = controls.heartbeat(owned["runId"], owned["leaseOwner"], owned["generation"], 2)
            with self.monitor.begin() as blocker:
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select id from wb_control_run where id=$1 for update", [owned["runId"]])
                pending = self.executor.submit(sessions.save, sid, {**payload, "lastTurnId": "expired"},
                    expected_rev=1 if existing else None, expected_control_run=fence(owned))
                self.wait_locked(self.schema + ("_session" if transport == "sqlalchemy" else "_http"),
                                 blocker_pid=blocker_pid)
                while time.time() <= owned["leaseExpiresAt"] + 0.05:
                    time.sleep(0.025)
            check(pending.result(timeout=WAIT_SECONDS) is False,
                  "session save used a lease that expired while waiting for the control lock")
            row = sessions.load(sid)
            check((row is None) if not existing else (row.rev == 1 and row.payload == payload),
                  "expired writer changed persisted session")

    def lease_expires_waiting_for_session(self, transport):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "expires-session-lock")
            owned = controls.heartbeat(owned["runId"], owned["leaseOwner"], owned["generation"], 2)
            with self.monitor.begin() as blocker:
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select session_id from sliderule_session where session_id=$1 for update", [sid])
                pending = self.executor.submit(sessions.save, sid, {**payload, "lastTurnId": "expired"},
                    expected_rev=1, expected_control_run=fence(owned))
                self.wait_locked(self.schema + ("_session" if transport == "sqlalchemy" else "_http"),
                                 blocker_pid=blocker_pid)
                while time.time() <= owned["leaseExpiresAt"] + 0.05:
                    time.sleep(0.025)
            check(pending.result(timeout=WAIT_SECONDS) is False,
                  "session save used a lease that expired while waiting for the session lock")
            row = sessions.load(sid)
            check(row.rev == 1 and row.payload == payload, "expired writer changed session after target lock wait")

    def competing_claims(self, transport):
        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "competing-claims")
            controls.suspend(owned["runId"], owned["leaseOwner"], owned["generation"])
            with self.monitor.begin() as blocker:
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                sql_query(blocker, "select id from wb_control_run where id=$1 for update", [owned["runId"]])
                pending = [self.executor.submit(controls.claim, owned["runId"], worker, 300)
                           for worker in ("contender-a", "contender-b")]
                application = self.schema + ("_control" if transport == "sqlalchemy" else "_http")
                deadline = time.monotonic() + WAIT_SECONDS
                while time.monotonic() < deadline:
                    waiting = self.query(
                        "select pid,pg_blocking_pids(pid) as blockers from pg_stat_activity "
                        "where application_name=$1 and wait_event_type='Lock'", [application])
                    allowed_blockers = {blocker_pid, *(row["pid"] for row in waiting)}
                    if (len(waiting) == 2 and all(set(row["blockers"]) <= allowed_blockers for row in waiting)
                            and any(blocker_pid in row["blockers"] for row in waiting)):
                        self.report.setdefault("claimCompetitions", []).append({
                            "transport": transport, "blockedPids": [row["pid"] for row in waiting],
                            "blockerPid": blocker_pid,
                        })
                        break
                    time.sleep(0.025)
                else:
                    raise AssertionError("both competing lease claims did not reach the PostgreSQL lock")
            results = [job.result(timeout=WAIT_SECONDS) for job in pending]
            winners = [result for result in results if result is not None]
            check(len(winners) == 1, "competing claims produced more than one lease holder")
            winner = winners[0]
            check(winner["generation"] == owned["generation"] + 1, "competing claims skipped a generation")
            check(sessions.save(sid, payload, expected_rev=1, expected_control_run=fence(winner)),
                  "winning claimant could not write session")
            check(not sessions.save(sid, payload, expected_rev=2, expected_control_run=fence(owned)),
                  "previous claimant retained session write rights")

    def reopen(self, transport):
        from services.control_run_store import ControlRunConflict

        with self.stores(transport) as (sessions, controls):
            sid, payload, owned = self.fixture(sessions, controls, "reopen")
            controls.save_checkpoint(owned["runId"], owned["leaseOwner"], owned["generation"],
                                     {"phase": "tool_result", "receipt": "already-executed"})
            controls.append_event(owned["runId"], owned["leaseOwner"], owned["generation"], {"type": "tool_result"})
            controls.suspend(owned["runId"], owned["leaseOwner"], owned["generation"])
        with self.stores(transport) as (sessions, controls):
            replacement = controls.claim(owned["runId"], "replacement-process", 300)
            check(replacement["checkpoint"]["receipt"] == "already-executed", "reopen lost tool receipt")
            check(replacement["lastSeq"] == 1, "reopen lost event cursor")
            check(sessions.load(sid).payload == payload, "reopen lost session state")
            check(not sessions.save(sid, payload, expected_rev=1, expected_control_run=fence(owned)),
                  "old storage handle remained authoritative after reopen")
            try:
                controls.append_event(owned["runId"], owned["leaseOwner"], owned["generation"], {"type": "late"})
            except ControlRunConflict:
                pass
            else:
                raise AssertionError("old producer appended an event after reopen")
            event = controls.append_event(replacement["runId"], replacement["leaseOwner"],
                                          replacement["generation"], {"type": "resumed"})
            check(event["seq"] == 2, "resumed event sequence is not monotonic")

    def run(self, transport):
        self.record(transport, "lease-expires-while-waiting-session-update", lambda: self.lease_expires_waiting_for_session(transport))
        self.record(transport, "current-owner-and-session-cas", lambda: self.basic(transport))
        self.record(transport, "takeover-before-save-update", lambda: self.write_after_control_change(transport, "takeover"))
        self.record(transport, "takeover-before-save-same-payload",
                    lambda: self.write_after_control_change(transport, "takeover", same_payload=True))
        self.record(transport, "takeover-before-save-insert",
                    lambda: self.write_after_control_change(transport, "takeover", existing=False))
        self.record(transport, "cancel-before-save", lambda: self.write_after_control_change(transport, "cancel"))
        self.record(transport, "save-before-takeover", lambda: self.save_first(transport))
        self.record(transport, "cancel-request-and-released-lease", lambda: self.cancelled_and_expired(transport))
        self.record(transport, "lease-expires-while-waiting-update", lambda: self.lease_expires_while_waiting(transport))
        self.record(transport, "lease-expires-while-waiting-insert",
                    lambda: self.lease_expires_while_waiting(transport, existing=False))
        self.record(transport, "competing-claims-have-one-winner", lambda: self.competing_claims(transport))
        self.record(transport, "reopen-checkpoint-and-event-sequence", lambda: self.reopen(transport))


def serve_gateway(ready_path):
    import uvicorn

    spec = importlib.util.spec_from_file_location("postgres_smoke_gateway", ROOT / "deploy/postgres-https-api/app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    write_json(ready_path, {"url": f"http://127.0.0.1:{listener.getsockname()[1]}"})
    server = uvicorn.Server(uvicorn.Config(module.app, log_level="warning", access_log=False))
    server.run(sockets=[listener])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url-env", help="dedicated PostgreSQL test URL environment variable")
    parser.add_argument("--skip-http", action="store_true", help="report HTTP transport as untested")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--serve-gateway", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve_gateway:
        serve_gateway(args.serve_gateway)
        return 0
    if not args.database_url_env:
        parser.error("--database-url-env is required; workspace database defaults are never used")
    if args.database_url_env in {"APP_STORE_DATABASE_URL", "DATABASE_URL", "DB_URL"}:
        parser.error("use a dedicated smoke-test environment variable, not a workspace database default")
    raw = os.environ.get(args.database_url_env, "").strip()
    if not raw:
        parser.error("the explicitly selected test connection environment variable is empty")

    sys.path.insert(0, str(BACKEND))
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    schema = SCHEMA_PREFIX + uuid.uuid4().hex[:16]
    directory = (args.output_dir or ROOT / "artifacts" / ("control-postgres-smoke-" + schema[-16:])).resolve()
    check(directory.is_relative_to((ROOT / "artifacts").resolve()), "reports must remain under artifacts")
    directory.mkdir(parents=True, exist_ok=False)
    report = {"kind": "real-postgresql-control-fencing", "status": "running", "schema": schema,
              "checks": [], "cleanup": "pending", "limitations": [
                  "Does not validate production TLS, pooling, network interruption, or a deployed worker restart.",
                  "Control/session storage methods are real; no LLM, E2B, or browser is invoked."]}
    admin = smoke = None
    created = False
    try:
        admin = create_engine(isolated_url(raw, schema, schema + "_admin"),
                              poolclass=NullPool, connect_args={"connect_timeout": 8})
        with admin.begin() as connection:
            version = connection.execute(text("select current_setting('server_version')")).scalar_one()
            check(int(version.split(".")[0]) >= 12, "PostgreSQL 12 or newer is required")
            connection.execute(text(f'create schema "{schema}"'))
            created = True
        report["serverVersion"] = version
        smoke = Smoke(raw, schema, directory, report)
        check(smoke.query("select current_schema() as schema")[0]["schema"] == schema,
              "test connection did not enter the isolated schema")
        smoke.run("sqlalchemy")
        if args.skip_http:
            report["limitations"].append("HTTP gateway phase was explicitly skipped.")
        else:
            smoke.start_gateway()
            smoke.run("http-gateway")
        report["status"] = "passed" if not args.skip_http else "partial"
    except Exception as exc:
        report["status"] = "failed"
        # Driver exceptions can contain DSNs and parameter payloads. Only fixed
        # assertion text and exception types are safe to retain in this report.
        report["error"] = {"type": type(exc).__name__,
                           "message": str(exc) if isinstance(exc, AssertionError) else "see exception type; connection details omitted"}
        cause = getattr(exc, "orig", None) or getattr(exc, "__cause__", None)
        if cause is not None:
            report["error"]["causeType"] = type(cause).__name__
            report["error"]["sqlstate"] = getattr(cause, "sqlstate", None)
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
                    remaining = connection.execute(text("select 1 from pg_namespace where nspname=:schema"),
                                                   {"schema": schema}).first()
                check(remaining is None, "isolated schema still exists after cleanup")
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
