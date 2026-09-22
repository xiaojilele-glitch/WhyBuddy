"""Private preview uses real SQL/session approval and the actual HTTP consumer.

No cloud provider is involved: observing a runtime must be sufficient to revoke
access even with every execution worker offline. A single SQL CAS consumes the
URL ticket because the production gateway commits each query independently.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from project_actor_support import project_actor
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.project_runtime import RuntimeInstance
from models.v5_state import V5SessionState
from routes import project_preview as route
from services import persistence, project_access
from services.identity_store import User
from services.project_creation import create_session_project
from services.project_preview_access import PreviewAccessDenied, ProjectPreviewAccess
from services.project_preview_config import (
    origin_for_runtime,
    preview_configuration_enabled,
    published_preview_url,
)
from services.project_runtime_worker import approved_reference, authorize_operation
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture
def world(tmp_path, monkeypatch, project_actor):
    project_actor("u1")
    store_url = f"sqlite:///{tmp_path / 'project.db'}"
    store = ProjectStore.from_url(store_url)
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    plan = {"planId": "plan-1", "revision": 1, "planContent": "Run fixed internal project", "reqId": "request-1"}
    state = V5SessionState(sessionId="s1", ownerId="u1", goal={"text": plan["planContent"]}, controlTranscript=[
        {**plan, "kind": "plan_written"}, {**plan, "kind": "plan_approval"}, {**plan, "kind": "plan_approved"}])
    approval = approved_reference(state)
    persistence.save_session_record(state, server_write=True)
    project = create_session_project(store, "s1", owner_id="u1", approval_ref=approval)
    operation = store.create_operation(project.projectId, owner_id="u1", kind="runtime.start",
        expected_revision=project.currentRevision, approval_ref=approval, idempotency_key="start", input={"port": 5173})
    lease = store.acquire_lease(project.projectId, owner_id="u1", lease_owner="worker-private", ttl_seconds=600)
    store.claim_operation(operation.operationId, owner_id="u1", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = store.renew_lease(project.projectId, owner_id="u1", lease_owner=lease.leaseOwner,
        generation=lease.generation, ttl_seconds=600, sandbox_id="sandbox-private", mounted_revision=project.currentRevision,
        process_refs={"operationId": operation.operationId, "server": "pid-private"})
    clock = {"now": time.time()}
    runtime = RuntimeInstance(runtimeId="rt-" + operation.operationId, projectId=project.projectId,
        workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
        health="revision_verified", processId="pid-private", previewUrl="https://provider-private.example",
        expiresAt=clock["now"] + 900, lastHeartbeat="2026-09-13T00:00:00Z")
    operation = store.update_runtime_operation(operation.operationId, owner_id="u1", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime)
    access = ProjectPreviewAccess(store, authorizer=authorize_operation, clock=lambda: clock["now"])
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(project_access.settings, "NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "g" * 40)
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    audience = origin_for_runtime(runtime.runtimeId)
    viewer = User(id="u1", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[require_user] = lambda: viewer
    app.state.project_preview_access = access
    with TestClient(app) as client:
        yield SimpleNamespace(store=store, store_url=store_url, sessions=sessions, project=project,
            operation=operation, lease=lease, runtime=runtime, clock=clock, access=access,
            viewer=viewer, app=app, client=client, audience=audience,
            internal_headers={"Authorization": "Bearer " + "g" * 40}, approval=approval)
    store.close()
    sessions._engine.dispose()


def _ticket(world):
    return world.access.issue_browser_ticket(world.operation.operationId, owner_id="u1", audience=world.audience)


def _tunnel(world):
    return world.access.issue_tunnel_grant(world.operation.operationId, owner_id="u1", audience=world.audience)


def _browser(world):
    return world.access.redeem_browser_ticket(_ticket(world).secret, audience=world.audience)


def _runtime_change(world, **changes):
    operation = world.store.get_operation(world.operation.operationId, owner_id="u1")
    return world.store.update_runtime_operation(operation.operationId, owner_id="u1",
        lease_generation=world.lease.generation, lease_owner=world.lease.leaseOwner,
        expected_status=operation.status, status=operation.status,
        runtime=operation.runtime.model_copy(update=changes))


def _publish_runtime_patch(world, *, at_stage=lambda _: None):
    """Exercise the durable source/lease/runtime APIs, keeping start identity.

    Preview must remain unavailable until the same worker has published source,
    confirmed its mount and projected a healthy runtime at that exact version.
    No provider or remote browser is implied by this SQL/HTTP contract fixture.
    """
    store, parent = world.store, world.operation
    fence = {"owner_id": "u1", "lease_generation": world.lease.generation,
        "lease_owner": world.lease.leaseOwner}
    child = store.enqueue_runtime_patch(parent.operationId, owner_id="u1",
        expected_revision=parent.expectedRevision, approval_ref=world.approval,
        idempotency_key="patch-preview", changes=[{
            "path": "src/preview-proof.txt", "content": "new source", "expectedSha256": None}])
    child = store.claim_operation(child.operationId, owner_id="u1",
        lease_owner=world.lease.leaseOwner, generation=world.lease.generation)
    store.transition_operation(child.operationId, expected_status=child.status, status="running", **fence)
    target = store.publication_revision_id(parent.projectId, child.operationId)
    intent = {"operationId": child.operationId, "baseRevision": parent.expectedRevision,
        "targetRevision": target, "phase": "publishing"}
    store.update_runtime_operation(parent.operationId, expected_status="running", status="running",
        runtime=parent.runtime.model_copy(update={"status": "syncing", "health": "unknown"}),
        result={"sourceSync": intent}, **fence)
    at_stage("syncing")
    base = store.get_revision(parent.projectId, parent.expectedRevision, owner_id="u1")
    files = store.read_files(parent.projectId, parent.expectedRevision, owner_id="u1")
    files["src/preview-proof.txt"] = "new source"
    revision = store.commit_revision(parent.projectId, expected_revision=parent.expectedRevision,
        files=files, template_version=base.templateVersion, plan_ref=world.approval,
        spec_revision=base.specRevision, publication_id=child.operationId,
        runtime_operation_id=parent.operationId, **fence)
    assert revision.revision == target
    at_stage("published")
    store.renew_lease(parent.projectId, owner_id="u1", generation=world.lease.generation,
        lease_owner=world.lease.leaseOwner, mounted_revision=target, ttl_seconds=600)
    at_stage("mounted")
    current = store.advance_runtime_revision(parent.operationId, child.operationId,
        target_revision=target, **fence)
    at_stage("advanced")
    store.update_runtime_operation(parent.operationId, expected_status="running", status="running",
        runtime=current.runtime.model_copy(update={"status": "ready", "health": "revision_verified"}),
        result={"sourceSync": {**intent, "phase": "verified"}}, **fence)
    store.transition_operation(child.operationId, expected_status="running", status="completed",
        result={"synchronized": True, "revision": target}, **fence)
    return revision


def test_credentials_persist_as_hashes_and_browser_ticket_is_single_use_across_processes(world):
    ticket = _ticket(world)
    other_store = ProjectStore.from_url(world.store_url)
    try:
        other = ProjectPreviewAccess(other_store, authorizer=authorize_operation, clock=world.access.clock)
        granted = other.redeem_browser_ticket(ticket.secret, audience=world.audience)
        assert world.access.authorize_browser(granted.secret, audience=world.audience) == granted.scope
        assert granted.scope.grant_id == ticket.scope.grant_id
        assert granted.secret != ticket.secret
        assert granted.expires_at == world.clock["now"] + 300
        with pytest.raises(PreviewAccessDenied):
            world.access.redeem_browser_ticket(ticket.secret, audience=world.audience)
        stored = world.store._q("select * from wb_project_preview_access")
        assert len(stored) == 1 and stored[0]["kind"] == "browser"
        assert ticket.secret not in str(stored) and granted.secret not in str(stored)
        assert ticket.secret not in repr(ticket) and granted.secret not in repr(granted)
    finally:
        other_store.close()


def test_simultaneous_ticket_redemption_has_exactly_one_winner(world, monkeypatch):
    ticket, barrier = _ticket(world), threading.Barrier(2)
    original = world.access._lookup
    def same_snapshot(*args):
        result = original(*args)
        barrier.wait(timeout=5)
        return result
    monkeypatch.setattr(world.access, "_lookup", same_snapshot)
    def redeem():
        try:
            return world.access.redeem_browser_ticket(ticket.secret, audience=world.audience)
        except PreviewAccessDenied:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: redeem(), range(2)))
    assert sum(result is not None for result in results) == 1


def test_browser_tunnel_and_ticket_roles_are_disjoint(world):
    browser, tunnel, ticket = _browser(world), _tunnel(world), _ticket(world)
    assert world.access.authorize_browser(browser.secret, audience=world.audience) == browser.scope
    assert world.access.authorize_tunnel(tunnel.secret, audience=world.audience) == tunnel.scope
    for credential, method in ((browser, world.access.authorize_tunnel), (tunnel, world.access.authorize_browser),
            (ticket, world.access.authorize_browser), (ticket, world.access.authorize_tunnel)):
        with pytest.raises(PreviewAccessDenied):
            method(credential.secret, audience=world.audience)
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding(ticket.scope.to_wire(), audience=world.audience)
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(browser.secret, audience="https://other.preview.example.com")


@pytest.mark.parametrize("change", ["cancel", "stopped", "reconciling", "unverified", "lease_expired", "runtime_expired",
    "generation", "revision", "plan", "session_owner", "session_binding", "process", "port"])
def test_all_existing_grants_and_new_tickets_obey_current_durable_authority(world, change):
    browser, tunnel = _browser(world), _tunnel(world)
    if change == "cancel":
        world.store.request_operation_cancel(world.operation.operationId, owner_id="u1")
    elif change in {"stopped", "reconciling"}:
        _runtime_change(world, status=change)
    elif change == "unverified":
        _runtime_change(world, health="ready")
    elif change == "runtime_expired":
        _runtime_change(world, expiresAt=world.clock["now"] - 1)
    elif change == "lease_expired":
        world.store.release_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
            generation=world.lease.generation)
    elif change == "generation":
        world.store.release_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
            generation=world.lease.generation)
        world.store.acquire_lease(world.project.projectId, owner_id="u1", lease_owner="replacement-worker")
    elif change == "revision":
        files = world.store.read_files(world.project.projectId, owner_id="u1")
        files["changed.txt"] = "new revision makes old runtime stale"
        world.store.commit_revision(world.project.projectId, owner_id="u1", expected_revision=world.project.currentRevision,
            files=files, template_version="test", plan_ref=world.approval,
            lease_generation=world.lease.generation, lease_owner=world.lease.leaseOwner)
    elif change in {"plan", "session_owner", "session_binding"}:
        row = world.sessions.load("s1")
        payload = row.payload
        if change == "plan": payload["controlTranscript"].pop()
        if change == "session_owner": payload["ownerId"] = "mallory"
        if change == "session_binding": payload["projectId"] = "different-project"
        world.sessions.save("s1", payload, expected_rev=row.rev)
    elif change == "process":
        _runtime_change(world, processId="different-process")
    elif change == "port":
        _runtime_change(world, port=5174)
    for callback in (
            lambda: world.access.authorize_browser(browser.secret, audience=world.audience),
            lambda: world.access.authorize_tunnel(tunnel.secret, audience=world.audience),
            lambda: world.access.validate_binding(browser.scope.to_wire(), audience=world.audience),
            lambda: _ticket(world)):
        with pytest.raises((PermissionError, ProjectConflict, ProjectNotFound)):
            callback()


def test_owner_is_checked_before_issue_and_before_durable_revoke(world):
    browser = _browser(world)
    with pytest.raises(PreviewAccessDenied):
        world.access.issue_browser_ticket(world.operation.operationId, owner_id="mallory", audience=world.audience)
    with pytest.raises((PreviewAccessDenied, ProjectNotFound)):
        world.access.revoke_grant(browser.scope.grant_id, owner_id="mallory")
    with pytest.raises(ProjectNotFound):
        world.access.revoke_runtime(world.operation.operationId, owner_id="mallory")
    assert world.access.authorize_browser(browser.secret, audience=world.audience) == browser.scope


def test_revoked_binding_never_resurrects_when_new_tunnel_uses_same_generation(world):
    browser, old = _browser(world), _tunnel(world)
    world.access.revoke_grant(old.scope.grant_id, owner_id="u1")
    fresh = _tunnel(world)
    assert fresh.scope.tunnel_id == old.scope.tunnel_id
    assert fresh.scope.grant_id != old.scope.grant_id
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding(old.scope.to_wire(), audience=world.audience)
    assert world.access.validate_binding(fresh.scope.to_wire(), audience=world.audience) == fresh.scope
    assert world.access.authorize_browser(browser.secret, audience=world.audience) == browser.scope
    world.access.revoke_runtime(world.operation.operationId, owner_id="u1")
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(browser.secret, audience=world.audience)


@pytest.mark.parametrize("field,value", [("ownerId", "mallory"), ("projectId", "other"), ("sessionId", "s2"),
    ("operationId", "other"), ("runtimeId", "other"), ("revision", "other"), ("workspaceId", "other"),
    ("generation", 9), ("port", 5174), ("audience", "other"), ("expiresAt", 9999999999), ("tunnelId", "other")])
def test_relay_cannot_rebind_or_extend_a_grant(world, field, value):
    scope = _browser(world).scope
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding({**scope.to_wire(), field: value}, audience=world.audience)


def test_grant_cannot_be_repurposed_by_submitting_fresh_fields_for_stale_saved_row(world):
    credential = _browser(world)
    world.store._q("update wb_project_preview_access set revision=$1 where id=$2", ["old", credential.scope.grant_id])
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding(credential.scope.to_wire(), audience=world.audience)


def test_authentication_and_observation_do_not_touch_or_renew_runtime(world, monkeypatch):
    tunnel, browser = _tunnel(world), _browser(world)
    before = world.store._q("select * from wb_project_lease") + world.store._q("select * from wb_project_operation")
    def forbidden(*args, **kwargs):
        raise AssertionError("read-only preview attempted a lifecycle mutation")
    for name in ("touch_operation", "renew_lease", "claim_operation", "request_operation_cancel", "update_runtime_operation"):
        monkeypatch.setattr(world.store, name, forbidden)
    for _ in range(2):
        assert world.access.authorize_tunnel(tunnel.secret, audience=world.audience) == tunnel.scope
        assert world.access.authorize_browser(browser.secret, audience=world.audience) == browser.scope
        assert world.access.validate_binding(browser.scope.to_wire(), audience=world.audience) == browser.scope
        assert world.client.get(f"/projects/{world.project.projectId}/preview").json()["available"] is True
    after = world.store._q("select * from wb_project_lease") + world.store._q("select * from wb_project_operation")
    assert before == after


def test_ticket_and_grant_expiration_never_slide_on_reads_or_redemption(world):
    ticket = _ticket(world)
    world.clock["now"] += 59
    browser = world.access.redeem_browser_ticket(ticket.secret, audience=world.audience)
    assert browser.expires_at == ticket.expires_at + 240
    world.clock["now"] = browser.expires_at
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(browser.secret, audience=world.audience)
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding(browser.scope.to_wire(), audience=world.audience)
    expired_ticket = _ticket(world)
    world.clock["now"] = expired_ticket.expires_at
    with pytest.raises(PreviewAccessDenied):
        world.access.redeem_browser_ticket(expired_ticket.secret, audience=world.audience)


def test_cancellation_between_authority_read_and_ticket_write_is_fenced(world, monkeypatch):
    real = world.access.authorizer
    def cancelling_authorizer(*args):
        real(*args)
        world.store.request_operation_cancel(world.operation.operationId, owner_id="u1")
    monkeypatch.setattr(world.access, "authorizer", cancelling_authorizer)
    with pytest.raises(PreviewAccessDenied):
        _ticket(world)
    assert not world.store._q("select id from wb_project_preview_access")


def test_revoke_during_relay_recheck_is_fenced(world, monkeypatch):
    browser, real = _browser(world), world.access.authorizer
    def revoking_authorizer(*args):
        real(*args)
        world.access.revoke_grant(browser.scope.grant_id, owner_id="u1")
    monkeypatch.setattr(world.access, "authorizer", revoking_authorizer)
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding(browser.scope.to_wire(), audience=world.audience)


def test_process_binding_changed_during_authority_check_is_fenced(world, monkeypatch):
    real = world.access.authorizer
    def switching_process(*args):
        real(*args)
        world.store.renew_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
            generation=world.lease.generation, process_refs={"operationId": world.operation.operationId,
                "server": "replacement-process"})
    monkeypatch.setattr(world.access, "authorizer", switching_process)
    with pytest.raises(PreviewAccessDenied):
        _ticket(world)
    assert not world.store._q("select id from wb_project_preview_access")


@pytest.mark.parametrize("pulse", ["lease", "operation"])
@pytest.mark.parametrize("action", ["ticket", "tunnel", "ready", "presence", "redeem", "browser", "binding"])
def test_healthy_heartbeat_during_preview_check_reauthorizes_without_false_denial(world, monkeypatch, pulse, action):
    tunnel, browser, ticket = _tunnel(world), _browser(world), _ticket(world)
    real, calls = world.access.authorizer, []
    def heartbeat(*args):
        real(*args)
        calls.append(True)
        if len(calls) == 1:
            if pulse == "lease":
                world.store.renew_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
                    generation=world.lease.generation, ttl_seconds=601)
            else:
                _runtime_change(world, lastHeartbeat="2026-09-13T00:00:01Z")
    monkeypatch.setattr(world.access, "authorizer", heartbeat)
    if action == "ticket": result = _ticket(world)
    elif action == "tunnel": result = _tunnel(world)
    elif action == "ready": result = world.access.ready_scope(world.operation.operationId, owner_id="u1", audience=world.audience)
    elif action == "presence": result = world.access.has_active_tunnel(world.operation.operationId, owner_id="u1", audience=world.audience)
    elif action == "redeem":
        result = world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
            json={"ticket": ticket.secret, "audience": world.audience})
        assert result.status_code == 200
        with pytest.raises(PreviewAccessDenied):
            world.access.redeem_browser_ticket(ticket.secret, audience=world.audience)
    else:
        body = {"role": action, "audience": world.audience}
        body.update({"token": browser.secret} if action == "browser" else {"binding": tunnel.scope.to_wire()})
        result = world.client.post("/internal/project-preview/authorize", headers=world.internal_headers, json=body)
        assert result.status_code == 200 and result.json()["ok"] is True
    assert result and len(calls) == 2


@pytest.mark.parametrize("change", ["cancel", "generation", "process", "mount", "runtime", "plan", "owner", "revoke"])
def test_preview_retry_rechecks_revocation_and_complete_current_authority(world, monkeypatch, change):
    if change == "mount":
        _publish_runtime_patch(world)
    browser, real = _browser(world), world.access.authorizer
    calls = []
    def changed(*args):
        real(*args)
        calls.append(True)
        if len(calls) != 1:
            return
        world.store.renew_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
            generation=world.lease.generation, ttl_seconds=601)
        if change == "cancel": world.store.request_operation_cancel(world.operation.operationId, owner_id="u1")
        elif change == "generation":
            world.store.release_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
                generation=world.lease.generation)
            world.store.acquire_lease(world.project.projectId, owner_id="u1", lease_owner="new-worker")
        elif change in {"process", "mount"}:
            kwargs = {"process_refs": {"operationId": world.operation.operationId, "server": "different-process"}} if change == "process" else {"mounted_revision": world.operation.expectedRevision}
            world.store.renew_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
                generation=world.lease.generation, **kwargs)
        elif change == "runtime": _runtime_change(world, status="syncing")
        elif change in {"plan", "owner"}:
            row = world.sessions.load("s1")
            payload = row.payload
            if change == "plan": payload["controlTranscript"].pop()
            else: payload["ownerId"] = "mallory"
            world.sessions.save("s1", payload, expected_rev=row.rev)
        else: world.access.revoke_grant(browser.scope.grant_id, owner_id="u1")
    monkeypatch.setattr(world.access, "authorizer", changed)
    response = world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "browser", "token": browser.secret, "audience": world.audience})
    assert response.status_code == (404 if change == "owner" else 403)
    assert len(calls) == 1


def test_continuously_changing_authority_has_a_finite_retry_budget_and_issues_no_ticket(world, monkeypatch):
    real, calls = world.access.authorizer, []
    def heartbeat(*args):
        real(*args)
        calls.append(True)
        world.store.renew_lease(world.project.projectId, owner_id="u1", lease_owner=world.lease.leaseOwner,
            generation=world.lease.generation, ttl_seconds=601 + len(calls))
    monkeypatch.setattr(world.access, "authorizer", heartbeat)
    with pytest.raises(PreviewAccessDenied, match="project_preview_changed"):
        _ticket(world)
    assert len(calls) == 3
    assert not world.store._q("select id from wb_project_preview_access")


def test_lost_ticket_insert_response_is_not_retried_as_a_heartbeat_race(world, monkeypatch):
    real, inserts = world.store._q, []
    def lost_response(sql, params=None):
        result = real(sql, params)
        if sql.startswith("insert into wb_project_preview_access"):
            inserts.append(True)
            raise ProjectStoreUnavailable("response_lost_after_commit")
        return result
    monkeypatch.setattr(world.store, "_q", lost_response)
    with pytest.raises(ProjectStoreUnavailable):
        _ticket(world)
    assert inserts == [True]
    assert len(real("select id from wb_project_preview_access")) == 1


def test_http_owner_ticket_relay_redeem_and_revoke_end_to_end(world):
    tunnel = _tunnel(world)
    ticket_response = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket")
    assert ticket_response.status_code == 200
    assert ticket_response.headers["cache-control"] == "no-store"
    entry = urlsplit(ticket_response.json()["entryUrl"])
    assert entry.path == "/_whybuddy/authorize"
    ticket = parse_qs(entry.query)["ticket"][0]
    redeemed = world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": ticket, "audience": world.audience})
    assert redeemed.status_code == 200
    body = redeemed.json()
    assert set(body) == {"token", "binding"}
    for role, token in (("browser", body["token"]), ("tunnel", tunnel.secret)):
        reply = world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
            json={"role": role, "token": token, "audience": world.audience})
        assert reply.status_code == 200 and reply.json()["ok"] is True
        assert reply.json()["binding"]["grantId"]
    assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "binding", "binding": body["binding"], "audience": world.audience}).status_code == 200
    assert world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": ticket, "audience": world.audience}).status_code == 403
    assert world.client.post(f"/project-operations/{world.operation.operationId}/preview/revoke").status_code == 200
    assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "browser", "token": body["token"], "audience": world.audience}).status_code == 403
    assert "private" not in str(body)


def test_http_preview_moves_to_published_revision_with_same_runtime_and_denies_old_credentials(world):
    old_browser, old_tunnel, old_ticket = _browser(world), _tunnel(world), _ticket(world)
    stages = []

    def assert_unavailable(stage):
        stages.append(stage)
        response = world.client.get(f"/projects/{world.project.projectId}/preview")
        assert response.status_code == 200 and response.json()["available"] is False
        assert world.client.post(
            f"/project-operations/{world.operation.operationId}/preview-ticket").status_code == 403
        for role, token in (("browser", old_browser.secret), ("tunnel", old_tunnel.secret)):
            assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
                json={"role": role, "token": token, "audience": world.audience}).status_code == 403

    revision = _publish_runtime_patch(world, at_stage=assert_unavailable)
    assert stages == ["syncing", "published", "mounted", "advanced"]
    current = world.store.get_operation(world.operation.operationId, owner_id="u1")
    lease = world.store.get_lease(world.project.projectId, owner_id="u1")
    assert current.expectedRevision == world.operation.expectedRevision != revision.revision
    assert current.runtime.revision == lease.mountedRevision == revision.revision
    assert current.runtime.runtimeId == world.runtime.runtimeId
    assert current.runtime.processId == world.runtime.processId == lease.processRefs["server"]
    assert lease.sandboxId == world.lease.sandboxId
    assert (lease.generation, lease.leaseOwner) == (world.lease.generation, world.lease.leaseOwner)

    # Even without an explicit revoke, the old revision cannot be rebound to the
    # same run. In production suspend_for_sync additionally revokes these rows.
    assert all(row["revoked_at"] is None for row in world.store._q("select * from wb_project_preview_access"))
    for role, token in (("browser", old_browser.secret), ("tunnel", old_tunnel.secret)):
        assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
            json={"role": role, "token": token, "audience": world.audience}).status_code == 403
    assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "binding", "binding": old_browser.scope.to_wire(), "audience": world.audience}).status_code == 403
    assert world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": old_ticket.secret, "audience": world.audience}).status_code == 403
    assert world.client.get(f"/projects/{world.project.projectId}/preview").json()["available"] is False

    fresh_tunnel = _tunnel(world)
    observed = world.client.get(f"/projects/{world.project.projectId}/preview").json()
    assert observed["available"] is True and observed["descriptor"]["revision"] == revision.revision
    ticket = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket")
    assert ticket.status_code == 200
    secret = parse_qs(urlsplit(ticket.json()["entryUrl"]).query)["ticket"][0]
    redeemed = world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": secret, "audience": world.audience})
    assert redeemed.status_code == 200
    body = redeemed.json()
    assert body["binding"]["revision"] == fresh_tunnel.scope.revision == revision.revision
    for role, token in (("browser", body["token"]), ("tunnel", fresh_tunnel.secret)):
        response = world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
            json={"role": role, "token": token, "audience": world.audience})
        assert response.status_code == 200 and response.json()["ok"] is True


def test_advanced_runtime_requires_matching_mounted_revision_for_preview(world):
    revision = _publish_runtime_patch(world)
    fresh = _browser(world)
    world.store.renew_lease(world.project.projectId, owner_id="u1", generation=world.lease.generation,
        lease_owner=world.lease.leaseOwner, mounted_revision=world.operation.expectedRevision)
    assert world.store.get_operation(world.operation.operationId, owner_id="u1").runtime.revision == revision.revision
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(fresh.secret, audience=world.audience)
    with pytest.raises(PreviewAccessDenied):
        _ticket(world)


def test_http_ticket_and_browser_access_deadlines_match_actual_delayed_redemption(world):
    _tunnel(world)
    response = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"entryUrl", "ticketExpiresAt", "accessExpiresAt", "projectId", "operationId", "runtimeId", "revision"}
    assert body["projectId"] == world.project.projectId
    assert body["operationId"] == world.operation.operationId
    assert body["runtimeId"] == world.runtime.runtimeId
    assert body["revision"] == world.runtime.revision
    ticket_expiry = datetime.fromisoformat(body["ticketExpiresAt"]).timestamp()
    access_expiry = datetime.fromisoformat(body["accessExpiresAt"]).timestamp()
    assert ticket_expiry == pytest.approx(world.clock["now"] + 60, rel=0, abs=0.000001)
    assert access_expiry == pytest.approx(world.clock["now"] + 300, rel=0, abs=0.000001)
    token = parse_qs(urlsplit(body["entryUrl"]).query)["ticket"][0]
    world.clock["now"] += 59
    redeemed = world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": token, "audience": world.audience})
    assert redeemed.status_code == 200
    grant = redeemed.json()
    assert grant["binding"]["expiresAt"] == pytest.approx(access_expiry, rel=0, abs=0.000001)
    world.clock["now"] = ticket_expiry + 1
    assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "browser", "token": grant["token"], "audience": world.audience}).status_code == 200
    assert world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": token, "audience": world.audience}).status_code == 403
    world.clock["now"] = grant["binding"]["expiresAt"]
    assert world.client.post("/internal/project-preview/authorize", headers=world.internal_headers,
        json={"role": "browser", "token": grant["token"], "audience": world.audience}).status_code == 403


@pytest.mark.parametrize("remaining", [30, 120])
def test_browser_deadline_is_capped_by_runtime_not_refreshed_by_exchange(world, remaining):
    _runtime_change(world, expiresAt=world.clock["now"] + remaining)
    _tunnel(world)
    body = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket").json()
    assert datetime.fromisoformat(body["accessExpiresAt"]).timestamp() == pytest.approx(world.clock["now"] + remaining, rel=0, abs=0.000001)
    assert datetime.fromisoformat(body["ticketExpiresAt"]).timestamp() == pytest.approx(world.clock["now"] + min(60, remaining), rel=0, abs=0.000001)


def test_ticket_window_never_outlives_a_short_configured_browser_access_window(world):
    world.access.browser_grant_seconds = 20
    ticket = _ticket(world)
    assert ticket.expires_at == ticket.access_expires_at == world.clock["now"] + 20


def test_published_preview_url_only_accepts_e2b_https_hosts():
    assert published_preview_url("https://5173-sb-test.e2b.app") == "https://5173-sb-test.e2b.app/"
    assert published_preview_url("https://5173-sb-test.e2b.dev/app") == "https://5173-sb-test.e2b.dev/"
    assert published_preview_url("https://provider-private.example") is None
    assert published_preview_url("http://5173-sb-test.e2b.app") is None
    assert published_preview_url("https://e2b.app") is None


def test_internal_mode_opens_e2b_published_host_without_a_private_tunnel(world):
    url = f"/projects/{world.project.projectId}/preview"
    assert world.client.get(url).json()["available"] is False
    _runtime_change(world, previewUrl="https://5173-sb-test.e2b.app")
    body = world.client.get(url).json()
    assert body["available"] is True and body["reason"] is None
    ticket = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket")
    assert ticket.status_code == 200
    assert ticket.json()["entryUrl"] == "https://5173-sb-test.e2b.app/"
    assert ticket.json()["runtimeId"] == world.runtime.runtimeId


def test_internal_mode_rejects_a_non_e2b_preview_url_as_published_host(world):
    _runtime_change(world, previewUrl="https://provider-private.example")
    body = world.client.get(f"/projects/{world.project.projectId}/preview").json()
    assert body["available"] is False
    assert body["reason"] == "project_preview_tunnel_not_started"
    assert world.client.post(
        f"/project-operations/{world.operation.operationId}/preview-ticket"
    ).status_code == 503


def test_allowlist_cannot_use_e2b_published_host_instead_of_the_private_tunnel(world, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "allowlist")
    monkeypatch.setenv("WHYBUDDY_PROJECT_ALLOWED_USERS", "u1")
    _runtime_change(world, previewUrl="https://5173-sb-test.e2b.app")
    body = world.client.get(f"/projects/{world.project.projectId}/preview").json()
    assert body["available"] is False
    assert body["reason"] is not None
    assert world.client.post(
        f"/project-operations/{world.operation.operationId}/preview-ticket"
    ).status_code == 503


def test_configuration_and_grant_presence_are_distinct_from_runtime_ready(world, monkeypatch):
    url = f"/projects/{world.project.projectId}/preview"
    initial = world.client.get(url).json()
    assert initial["descriptor"]["status"] == "ready" and not initial["available"]
    assert initial["reason"] == "project_preview_tunnel_not_started"
    assert world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket").status_code == 503
    _tunnel(world)
    assert world.client.get(url).json()["available"] is True
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    missing = world.client.get(url).json()
    assert not missing["available"] and missing["reason"] == "project_preview_not_configured"
    world.store.request_operation_cancel(world.operation.operationId, owner_id="u1")
    stale = world.client.get(url).json()
    assert not stale["available"] and stale["descriptor"]["status"] == "reconciling"
    assert stale["reason"] == "project_preview_binding_changed"


def _preview_project_at(world, phase):
    """Persist the same early states seen before the real E2B startup begins."""
    if phase == "starting":
        _runtime_change(world, status="starting", health="unknown")
        return world.project
    plan = {"planId": "plan-2", "revision": 1, "planContent": "Run another fixed project", "reqId": "request-2"}
    state = V5SessionState(sessionId="s2", ownerId="u1", goal={"text": plan["planContent"]}, controlTranscript=[
        {**plan, "kind": "plan_written"}, {**plan, "kind": "plan_approval"}, {**plan, "kind": "plan_approved"}])
    approval = approved_reference(state)
    persistence.save_session_record(state, server_write=True)
    project = create_session_project(world.store, "s2", owner_id="u1", approval_ref=approval)
    if phase == "queued":
        world.store.create_operation(project.projectId, owner_id="u1", kind="runtime.start",
            expected_revision=project.currentRevision, approval_ref=approval, idempotency_key="start-pending",
            input={"port": 5173})
    return project


@pytest.mark.parametrize("phase", ["unstarted", "queued", "starting"])
@pytest.mark.parametrize("configured", [False, True])
@pytest.mark.parametrize("disabled", [False, True])
def test_http_pending_preview_reports_configuration_before_sandbox_start(world, monkeypatch, phase, configured, disabled):
    project = _preview_project_at(world, phase)
    if not configured:
        monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    if disabled:
        monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    before = world.store.list_project_operations(project.projectId, owner_id="u1")
    response = world.client.get(f"/projects/{project.projectId}/preview")
    assert response.status_code == 200
    body = response.json()
    expected = ("project_rollout_disabled" if disabled else
        "project_preview_not_configured" if not configured else
        "project_runtime_not_started" if phase == "unstarted" else "project_runtime_not_ready")
    assert body["reason"] == expected and body["available"] is False
    assert (body["operationId"] is None) == (phase == "unstarted")
    if phase == "starting":
        assert body["descriptor"]["status"] == "starting"
    else:
        assert body["descriptor"] is None
    assert world.store.list_project_operations(project.projectId, owner_id="u1") == before


@pytest.mark.parametrize("phase", ["unstarted", "queued", "starting"])
def test_http_pending_preview_checks_owner_before_disclosing_configuration(world, monkeypatch, phase):
    project = _preview_project_at(world, phase)
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    world.viewer["id"] = "mallory"
    response = world.client.get(f"/projects/{project.projectId}/preview")
    assert response.status_code == 404
    assert response.json() == {"detail": "project_not_found"}


def test_missing_preview_config_cannot_hide_expired_ready_authority(world, monkeypatch):
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    world.clock["now"] += 1000
    response = world.client.get(f"/projects/{world.project.projectId}/preview")
    assert response.status_code == 200
    body = response.json()
    assert body["descriptor"]["status"] == "reconciling"
    assert body["reason"] == "project_preview_binding_changed" and body["available"] is False


def test_latest_runtime_selection_ignores_uuid_order_and_newer_exec(world):
    old = world.operation
    # The actual store's public listing is sorted by random IDs, not time.
    for key, kind, when, operation_id in (("newer-start", "runtime.start", "2099-01-01T00:00:00Z", "pop-000-new"),
            ("newest-command", "runtime.exec", "2099-02-01T00:00:00Z", "pop-zzz-exec")):
        item = world.store.create_operation(world.project.projectId, owner_id="u1", kind=kind,
            idempotency_key=key, expected_revision=old.expectedRevision, approval_ref=old.approvalRef)
        item = item.model_copy(update={"createdAt": when, "operationId": operation_id})
        world.store._q("update wb_project_operation set id=$1,payload=$2 where project_id=$3 and idempotency_key=$4",
            [operation_id, item.model_dump_json(), world.project.projectId, key])
    response = world.client.get(f"/projects/{world.project.projectId}/preview")
    assert response.status_code == 200 and response.json()["operationId"] == "pop-000-new"
    assert response.json()["descriptor"] is None and response.json()["available"] is False


@pytest.mark.parametrize("method,path", [("get", "/projects/{project}/preview"),
    ("post", "/project-operations/{operation}/preview-ticket"), ("post", "/project-operations/{operation}/preview/revoke")])
def test_all_public_preview_routes_reject_other_owner(world, method, path):
    world.viewer["id"] = "mallory"
    path = path.format(project=world.project.projectId, operation=world.operation.operationId)
    assert getattr(world.client, method)(path).status_code == 404


@pytest.mark.parametrize("blocked", ["disabled", "production", "nonadmin"])
def test_preview_routes_do_not_open_public_rollout(world, monkeypatch, blocked):
    if blocked == "disabled": monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED")
    if blocked == "production": monkeypatch.setenv("NODE_ENV", "production")
    if blocked == "nonadmin": world.viewer["is_superuser"] = False
    # Rollback preserves owned observation; the descriptor is unavailable until
    # the rollout is enabled, while ticket issuance remains a write/capability gate.
    preview = world.client.get(f"/projects/{world.project.projectId}/preview")
    assert preview.status_code == 200 and preview.json()["available"] is False
    if blocked == "disabled":
        assert preview.json()["reason"] == "project_rollout_disabled"
    assert world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket").status_code == 503


def test_internal_relay_requires_its_own_key_even_for_logged_in_owner(world):
    tunnel = _tunnel(world)
    body = {"role": "tunnel", "token": tunnel.secret, "audience": world.audience}
    for headers in ({}, {"Authorization": "Bearer wrong"}, {"Cookie": "sliderule_token=workbench-login"}):
        assert world.client.post("/internal/project-preview/authorize", headers=headers, json=body).status_code == 401


@pytest.mark.parametrize("template", ["https://preview.example.com", "https://{runtimeId}.example.com/",
    "https://{runtimeId}.example.com/?upstream=secret", "https://user:pass@{runtimeId}.example.com",
    "http://{runtimeId}.example.com", "http://{runtimeId}.localhost.evil", "https://prefix-{runtimeId}.example.com",
    "https://{runtimeId}.example.com#fragment", "https://{runtimeId}.example.com\\@evil",
    "https://{runtimeId}.example.com:bad", "https://{runtimeId}.example.com:0", "https://{runtimeId}.example.com:",
    "https://{runtimeId}.example.com/{runtimeId}", "https://{runtimeId}..example.com"])
def test_origin_template_rejects_shared_origins_proxy_targets_and_insecure_remote(world, monkeypatch, template):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", template)
    assert preview_configuration_enabled() is False
    with pytest.raises(ValueError):
        origin_for_runtime(world.runtime.runtimeId)


def test_each_runtime_has_distinct_origin_and_local_development_is_explicit(world, monkeypatch):
    assert origin_for_runtime("rt-one") != origin_for_runtime("rt-two")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "http://{runtimeId}.localhost:3010")
    assert origin_for_runtime("rt-one") == "http://rt-one.localhost:3010"
    assert preview_configuration_enabled() is True


@pytest.mark.parametrize("protocol,port,suffix", [("https", 443, "preview.example.com"), ("http", 80, "localhost")])
def test_default_port_template_matches_node_and_browser_canonical_origin(world, monkeypatch, protocol, port, suffix):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", f"{protocol}://{{runtimeId}}.{suffix}:{port}")
    audience = f"{protocol}://{world.runtime.runtimeId}.{suffix}"
    assert origin_for_runtime(world.runtime.runtimeId) == audience
    world.access.issue_tunnel_grant(world.operation.operationId, owner_id="u1", audience=audience)
    response = world.client.post(f"/project-operations/{world.operation.operationId}/preview-ticket")
    assert response.status_code == 200
    entry = urlsplit(response.json()["entryUrl"])
    assert entry.scheme + "://" + entry.netloc == audience
    ticket = parse_qs(entry.query)["ticket"][0]
    redeemed = world.client.post("/internal/project-preview/redeem", headers=world.internal_headers,
        json={"ticket": ticket, "audience": audience})
    assert redeemed.status_code == 200 and redeemed.json()["binding"]["audience"] == audience
