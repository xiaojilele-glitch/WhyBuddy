"""Check browser-receipt fencing through real PostgreSQL row-lock waits.

Run with --database-url-env naming a dedicated test PostgreSQL connection.
The selected server must already be running. This command creates and removes
only its unique schema; it does not start a database, browser, E2B or model.

2026-09-13: an EXISTS predicate alone can retain a stale READ COMMITTED snapshot
after waiting for another transaction. Exercise the production verification
store, including PostgreSQL locks on the parent, child and lease, through both
SQLAlchemy and the real HTTP SQL gateway. Every race first proves the actual
receipt statement waited on a row lock, then commits revocation and requires
the receipt to remain running. Synthetic PNG/assertions test storage authority,
not browser behavior or product delivery acceptance.
"""
from __future__ import annotations

import argparse
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
SCHEMA_PREFIX = "wb_project_verify_smoke_"

_spec = importlib.util.spec_from_file_location("project_idle_postgres_smoke", ROOT / "scripts/project-idle-postgres-smoke.py")
idle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(idle)
base, check, sql_query, write_json = idle.base, idle.check, idle.sql_query, idle.write_json


class ProjectVerificationSmoke(idle.ProjectIdleSmoke):
    def scope(self, fixture):
        return dict(owner_id=idle.OWNER, lease_generation=fixture.lease.generation,
                    lease_owner=fixture.lease.leaseOwner)

    def start_verification(self, store, fixture, key):
        from services.project_verification_store import ProjectVerificationStore

        child = store.enqueue_runtime_verification(fixture.parent.operationId, owner_id=idle.OWNER,
            expected_revision=fixture.project.currentRevision, approval_ref="plan-1", idempotency_key=key)
        store.claim_operation(child.operationId, owner_id=idle.OWNER,
            generation=fixture.lease.generation, lease_owner=fixture.lease.leaseOwner)
        store.transition_operation(child.operationId, **self.scope(fixture), expected_status="queued", status="running")
        records = ProjectVerificationStore(store)
        record = records.begin(child.operationId, **self.scope(fixture))
        return records, record, child

    def finish_verification(self, records, record, fixture):
        from PIL import Image
        from services.project_verification_gate import REQUIRED_ASSERTIONS

        output = BytesIO()
        Image.new("RGB", (3, 3), "red").save(output, format="PNG")
        return records.finish(record.verificationId, **self.scope(fixture), status="passed",
            assertions=[dict(id=name, status="passed") for name in sorted(REQUIRED_ASSERTIONS)],
            artifacts={"page": output.getvalue()})

    def positive(self, transport):
        with self.stores(transport) as store:
            fixture = self.fixture(store)
            records, record, child = self.start_verification(store, fixture, "positive")
            result = self.finish_verification(records, record, fixture)
            check(result.effectiveStatus == "passed" and result.deliveryEligible is False,
                  "fixed-suite proof did not stay separate from product delivery")
            check(store.get_operation(child.operationId, owner_id=idle.OWNER).status == "completed",
                  "durable proof did not complete the original child")
            check(self.finish_verification(records, record, fixture) == result,
                  "retry changed the persisted browser receipt")
            artifact = result.verification.artifactRefs[0]
            check(len(records.read_artifact(record.verificationId, artifact.artifactId, owner_id=idle.OWNER)) == artifact.sizeBytes,
                  "authorized PNG evidence did not survive persistence")

    def revocation_first(self, transport, change):
        from services.project_store import ProjectConflict

        with self.stores(transport) as store:
            fixture = self.fixture(store)
            records, seed, _ = self.start_verification(store, fixture, "seed")
            # Seed identical content to make the competing write the final
            # receipt, rather than an earlier screenshot quota reservation.
            self.finish_verification(records, seed, fixture)
            records, record, child = self.start_verification(store, fixture, "race")
            with self.monitor.begin() as blocker:
                held = self.transaction_store(store, blocker)
                blocker_pid = sql_query(blocker, "select pg_backend_pid() as pid")[0]["pid"]
                if change == "lease":
                    held.release_lease(fixture.project.projectId, owner_id=idle.OWNER,
                        generation=fixture.lease.generation, lease_owner=fixture.lease.leaseOwner)
                else:
                    held.request_operation_cancel(
                        fixture.parent.operationId if change == "parent" else child.operationId,
                        owner_id=idle.OWNER)
                pending = self.executor.submit(self.finish_verification, records, record, fixture)
                self.lock_observed(transport, blocker_pid, statement_prefix="with verification_lease as")
            try:
                pending.result(timeout=15)
            except ProjectConflict:
                pass
            else:
                raise AssertionError("revoked browser receipt became passed")
            check(records.get(record.verificationId, owner_id=idle.OWNER).verification.status == "running",
                  "rejected browser proof changed its historical result")
            check(store.get_operation(child.operationId, owner_id=idle.OWNER).status == "running",
                  "revocation allowed an unverified child completion")

    def run(self, transport):
        self.record(transport, "positive-png-and-idempotent-receipt", lambda: self.positive(transport))
        for change in ("parent", "child", "lease"):
            self.record(transport, "reject-lock-wait-" + change,
                        lambda change=change: self.revocation_first(transport, change))


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
    directory = (args.output_dir or ROOT / "artifacts" / ("project-verification-postgres-" + schema[-16:])).resolve()
    check(directory.is_relative_to((ROOT / "artifacts").resolve()), "reports must remain under artifacts")
    directory.mkdir(parents=True, exist_ok=False)
    report = {"kind": "real-postgresql-browser-verification-fencing", "status": "running", "schema": schema,
              "checks": [], "cleanup": "pending", "limitations": [
                  "Exercises real stores and the deployed HTTP SQL gateway against the supplied PostgreSQL.",
                  "Uses fixture PNG/assertions; does not invoke a browser, runtime worker, LLM or E2B.",
                  "Does not validate production TLS or claim product delivery acceptance."]}
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
        smoke = ProjectVerificationSmoke(raw, schema, directory, report)
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
