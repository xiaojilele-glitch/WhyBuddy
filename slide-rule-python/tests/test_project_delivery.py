"""The release HTTP path requires same-version business evidence from SQL.

Browser/process IO is separately exercised by the cloud product smoke. Here
records are written through the real lease-fenced verifier to test authority,
client forgery, idempotency, source changes and recoverable delivery artifacts.
"""

import io
import json
import time
import zipfile

import pytest

from models.project_runtime import RuntimeInstance, VerificationBuildEvidence
from services import persistence
from services.project_authority import approved_reference
from services.project_manifest import content_hash
from services.project_verification_gate import SUITE_ASSERTIONS
from services.project_verification_store import ProjectVerificationStore
from test_project_source_operations import setup
from test_project_verification_store import png


def proof(setup, suite="react-vite-tasks@1"):
    store, project = setup.store, setup.project
    authority = persistence.load_session_record(project.sessionId)["session"]
    approval = approved_reference(authority)
    parent = store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="start", expected_revision=project.currentRevision, approval_ref=approval)
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="test-proof", ttl_seconds=120)
    store.claim_operation(parent.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = store.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="fixture-sandbox", mounted_revision=project.currentRevision,
        process_refs={"operationId": parent.operationId, "server": "42"})
    runtime = RuntimeInstance(runtimeId="rt-" + parent.operationId, projectId=project.projectId,
        workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
        processId="42", health="revision_verified", expiresAt=time.time() + 900, lastHeartbeat="2026-09-13T00:00:00Z")
    store.update_runtime_operation(parent.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime)
    child = store.enqueue_runtime_verification(parent.operationId, owner_id="alice",
        expected_revision=project.currentRevision, approval_ref=approval, idempotency_key="verify", suite_version=suite)
    scope = dict(owner_id="alice", lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    store.claim_operation(child.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    store.transition_operation(child.operationId, expected_status="queued", status="running", **scope)
    records = ProjectVerificationStore(store)
    record = records.begin(child.operationId, **scope)
    revision = store.get_revision(project.projectId, owner_id="alice")
    lock = store.read_files(project.projectId, owner_id="alice")["package-lock.json"]
    build = VerificationBuildEvidence(revision=project.currentRevision, treeHash=revision.treeHash,
        lockfileHash=content_hash(lock), status="passed", installExitCode=0, buildExitCode=0,
        outputHash="b" * 64, outputFileCount=3, outputBytes=128,
        serverKind="tasks-node" if suite == "react-vite-tasks@1" else "static-dist",
        startedAt="2026-09-13T00:00:01Z", completedAt="2026-09-13T00:00:02Z")
    records.finish(record.verificationId, **scope, status="passed", build=build,
        assertions=[{"id": name, "status": "passed"} for name in sorted(SUITE_ASSERTIONS[suite])],
        artifacts={"page.png": png()})
    return record, parent, lease, approval


@pytest.mark.parametrize("setup", ["react-vite-tasks"], indirect=True)
def test_current_business_evidence_prepares_downloadable_release_without_claiming_deployment(setup):
    assert not setup.client.get(setup.url + "/delivery").json()["eligible"]
    record, _parent, _lease, _approval = proof(setup)
    current = setup.client.get(setup.url + "/delivery").json()
    assert current["eligible"] and current["profile"]["profileId"] == "whybuddy-tasks-acceptance@1"
    assert current["deployment"]["status"] == "not_configured"
    body = {"expectedRevision": record.revision, "verificationId": record.verificationId, "idempotencyKey": "release1"}
    response = setup.client.post(setup.url + "/releases", json=body)
    assert response.status_code == 201, response.text
    assert response.json() == setup.client.post(setup.url + "/releases", json=body).json()
    release = response.json()["release"]
    assert release["deployed"] is False
    download = setup.client.get(release["downloadPath"])
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        artifact = json.loads(archive.read("delivery.json"))
        assert artifact["verification"]["revision"] == record.revision
        assert artifact["hostingConfigured"] is False
        assert "deployment/Dockerfile" in archive.namelist()
        assert archive.read("source/src/main.tsx").decode() == setup.store.read_files(setup.project.projectId, owner_id="alice")["src/main.tsx"]
    setup.viewer["id"] = "another-admin"
    assert setup.client.get(release["downloadPath"]).status_code == 404
    assert setup.client.post(setup.url + "/releases", json=body).status_code == 404


def test_counter_pass_cannot_unlock_business_release(setup):
    record, *_ = proof(setup, "react-vite-counter@1")
    response = setup.client.post(setup.url + "/releases", json={"expectedRevision": record.revision,
        "verificationId": record.verificationId, "idempotencyKey": "fake-business"})
    assert response.status_code == 409
    assert not setup.client.get(setup.url + "/delivery").json()["eligible"]


@pytest.mark.parametrize("setup", ["react-vite-tasks"], indirect=True)
def test_source_changes_or_revoked_plan_make_saved_release_stale(setup):
    record, parent, lease, approval = proof(setup)
    body = {"expectedRevision": record.revision, "verificationId": record.verificationId, "idempotencyKey": "release"}
    assert setup.client.post(setup.url + "/releases", json=body).status_code == 201
    row = setup.sessions.load(setup.project.sessionId)
    row.payload["controlTranscript"].append({"kind": "plan_exited"})
    assert setup.sessions.save(setup.project.sessionId, row.payload, expected_rev=row.rev)
    status = setup.client.get(setup.url + "/delivery").json()
    assert status["eligible"] is False and status["releases"][0]["effectiveStatus"] == "stale"
    assert setup.client.post(setup.url + "/releases", json={**body, "idempotencyKey": "revoked"}).status_code == 409
    row = setup.sessions.load(setup.project.sessionId)
    row.payload["controlTranscript"].pop()
    assert setup.sessions.save(setup.project.sessionId, row.payload, expected_rev=row.rev)
    files = setup.store.read_files(setup.project.projectId, owner_id="alice")
    files["src/main.tsx"] += "\n// new source\n"
    setup.store.commit_revision(setup.project.projectId, owner_id="alice", expected_revision=record.revision,
        files=files, template_version="whybuddy-react-vite-tasks-1", plan_ref=approval,
        spec_revision="whybuddy-tasks-acceptance@1", lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    status = setup.client.get(setup.url + "/delivery").json()
    assert not status["eligible"] and status["releases"][0]["effectiveStatus"] == "stale"
    assert setup.client.post(setup.url + "/releases", json={**body, "idempotencyKey": "old"}).status_code == 409
    download = setup.client.get(status["releases"][0]["downloadPath"])
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        historical = json.loads(archive.read("delivery.json"))
        assert historical["revision"] == record.revision
        assert historical["currentRevision"] != record.revision
        assert historical["effectiveStatus"] == "stale"
        assert historical["blockedReasons"]


@pytest.mark.parametrize("setup", ["react-vite-tasks"], indirect=True)
def test_client_cannot_submit_passed_or_closure_with_release_request(setup):
    record, *_ = proof(setup)
    body = {"expectedRevision": record.revision, "verificationId": record.verificationId,
        "idempotencyKey": "forged", "publishClosure": {"status": "passed"}}
    assert setup.client.post(setup.url + "/releases", json=body).status_code == 422
