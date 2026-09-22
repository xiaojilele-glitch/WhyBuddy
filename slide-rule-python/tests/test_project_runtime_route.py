import asyncio
import json
from types import SimpleNamespace

import pytest
from project_actor_support import project_actor
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from services.identity_store import User
from services.project_store import ProjectStore
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services import project_runtime_worker as worker
from models.project_runtime import RuntimeInstance
from models.v5_state import V5SessionState
from services import persistence
from services.project_creation import create_session_project
from services.session_blob_store import SqlSessionBlobStore
from routes import project_runtime as route


@pytest.fixture
def setup(tmp_path, monkeypatch, project_actor):
    project_actor("u1")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'route.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    plan = {"planId": "plan-1", "revision": 1, "planContent": "Run fixed internal project", "reqId": "request-1"}
    state = V5SessionState(sessionId="s1", ownerId="u1", goal={"text": "Run fixed internal project"}, controlTranscript=[
        {**plan, "kind": "plan_written"}, {**plan, "kind": "plan_approval"}, {**plan, "kind": "plan_approved"}])
    approval = route._approved_reference(state)
    persistence.save_session_record(state, server_write=True)
    project = create_session_project(store, "s1", owner_id="u1", approval_ref=approval)
    state = persistence.load_session_record("s1")["session"]
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", raising=False)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(route.settings, "NODE_ENV", "development")
    viewer = User(id="u1", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[require_user] = lambda: viewer
    called = []
    def forbidden_provider():
        called.append(True)
        raise AssertionError("provider must not run before authorization and internal gate")
    # Exercise the real submit/authorize/persist path without starting the
    # background scanner. Route tests must never create a cloud sandbox.
    supervisor = ProjectRuntimeSupervisor(store, forbidden_provider)
    supervisor._scanner = SimpleNamespace(is_alive=lambda: True)
    app.state.project_runtime_supervisor = supervisor
    with TestClient(app) as client:
        yield SimpleNamespace(store=store, sessions=sessions, project=project, client=client, state=state,
            viewer=viewer, called=called, app=app, supervisor=supervisor,
            body={"expectedRevision": project.currentRevision, "approvalRef": approval, "idempotencyKey": "start-1"},
            url=f"/projects/{project.projectId}/runtime/start")
    store.close()
    sessions._engine.dispose()


def test_public_start_remains_closed_before_private_preview(setup):
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 503 and response.json()["detail"] == "project_preview_not_enabled"
    assert not setup.called


def test_public_wake_remains_closed_before_private_preview(setup):
    response = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert response.status_code == 503 and response.json()["detail"] == "project_preview_not_enabled"
    assert not setup.called


def test_wake_uses_bound_session_approval_without_a_client_body(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    response = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert response.status_code == 202
    body = response.json()
    assert body["operation"]["kind"] == "runtime.start"
    assert body["operation"]["expectedRevision"] == setup.project.currentRevision
    operation = setup.store.get_operation(body["operation"]["operationId"], owner_id="u1")
    assert operation.idempotencyKey == (
        f"preview-wake:{setup.project.projectId}:{setup.project.currentRevision}"
    )
    assert not setup.called


def test_wake_after_expired_runtime_opens_a_new_start(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    first = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert first.status_code == 202
    first_id = first.json()["operation"]["operationId"]
    operation = setup.store.get_operation(first_id, owner_id="u1")
    expired = operation.model_copy(update={
        "status": "completed",
        "runtime": RuntimeInstance(
            runtimeId="rt-expired", workspaceId="ws-expired",
            projectId=setup.project.projectId, revision=setup.project.currentRevision,
            status="expired", port=5173, lastHeartbeat="2026-09-16T00:00:00Z"),
    })
    setup.store._q(
        "update wb_project_operation set payload=$1 where id=$2",
        [expired.model_dump_json(), first_id],
    )
    second = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert second.status_code == 202
    second_id = second.json()["operation"]["operationId"]
    assert second_id != first_id
    again = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert again.json()["operation"]["operationId"] == second_id


def test_wake_after_cancel_requested_opens_a_new_start(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    first = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    first_id = first.json()["operation"]["operationId"]
    operation = setup.store.get_operation(first_id, owner_id="u1")
    setup.store._q(
        "update wb_project_operation set payload=$1 where id=$2",
        [operation.model_copy(update={"cancelRequested": True}).model_dump_json(), first_id],
    )
    second = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert second.status_code == 202
    assert second.json()["operation"]["operationId"] != first_id


def test_wake_without_approved_plan_stays_closed(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    setup.state.controlTranscript = [
        row for row in setup.state.controlTranscript if row["kind"] != "plan_approved"
    ]
    row = setup.sessions.load("s1")
    setup.sessions.save("s1", setup.state.model_dump(mode="json"), expected_rev=row.rev)
    response = setup.client.post(f"/projects/{setup.project.projectId}/preview/wake")
    assert response.status_code == 403
    assert response.json()["detail"] == "project_plan_approval_required"
    assert not setup.called


@pytest.mark.parametrize("scenario,status", [("wrong-owner", 404), ("missing-session", 404),
    ("session-owner", 404), ("no-approval", 403), ("changed-plan", 403),
    ("forged-approval", 403), ("stale-revision", 409), ("unknown-command", 422)])
def test_actual_http_path_rejects_invalid_authority_before_side_effects(setup, monkeypatch, scenario, status):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    if scenario == "wrong-owner": setup.viewer["id"] = "mallory"
    if scenario == "missing-session": setup.sessions.delete("s1")
    if scenario == "session-owner": setup.state.ownerId = "mallory"
    if scenario == "no-approval": setup.state.controlTranscript.pop()
    if scenario == "changed-plan": setup.state.controlTranscript[0]["planContent"] = "Different plan"
    if scenario == "forged-approval": setup.body["approvalRef"] = "forged"
    if scenario == "stale-revision": setup.body["expectedRevision"] = "old"
    if scenario == "unknown-command": setup.body["command"] = "unapproved"
    if scenario in {"session-owner", "no-approval", "changed-plan"}:
        row = setup.sessions.load("s1")
        setup.sessions.save("s1", setup.state.model_dump(mode="json"), expected_rev=row.rev)
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == status
    assert not setup.called


@pytest.mark.parametrize("production,admin", [(True, True), (False, False)])
def test_internal_flag_cannot_enable_production_or_nonadmin_execution(setup, monkeypatch, production, admin):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("NODE_ENV", "production" if production else "development")
    setup.viewer["is_superuser"] = admin
    assert setup.client.post(setup.url, json=setup.body).status_code == 503
    assert not setup.called


def test_internal_authorized_request_persists_once_and_returns_before_provider_io(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    response = setup.client.post(setup.url, json=setup.body)
    repeated = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == repeated.status_code == 202
    assert response.json()["operation"]["operationId"] == repeated.json()["operation"]["operationId"]
    operation = setup.store.get_operation(response.json()["operation"]["operationId"], owner_id="u1")
    assert operation.status == "queued"
    assert operation.kind == "runtime.start"
    assert operation.input["port"] == 5173
    assert response.json()["runtime"] is None and response.json()["lastSeq"] == 0
    assert setup.supervisor._wake.is_set()
    assert not setup.called
    assert setup.client.post(setup.url, json={**setup.body, "port": 5174}).status_code == 409


def test_source_created_without_session_binding_cannot_start(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    row = setup.sessions.load("s1")
    setup.sessions.save("s1", {**row.payload, "projectId": None, "projectRevision": None,
        "runtimeKind": "html-prototype"}, expected_rev=row.rev)
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 409 and response.json()["detail"] == "project_session_binding_required"
    assert not setup.called and not setup.store.list_runnable_operations()


def test_settings_production_blocks_internal_flag_without_process_environment(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setattr(route.settings, "NODE_ENV", "production")
    assert setup.client.post(setup.url, json=setup.body).status_code == 503
    assert not setup.called


def test_lease_response_does_not_expose_provider_metadata(setup):
    lease = setup.store.acquire_lease(setup.project.projectId, owner_id="u1", lease_owner="worker-secret")
    setup.store.renew_lease(setup.project.projectId, owner_id="u1", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="sandbox-secret", process_refs={"rt": "42"})
    response = setup.client.get(f"/projects/{setup.project.projectId}/runtime/lease")
    assert response.status_code == 200
    assert not {"sandboxId", "leaseOwner", "processRefs"}.intersection(response.json()["lease"])
    setup.viewer["id"] = "mallory"
    assert setup.client.get(f"/projects/{setup.project.projectId}/runtime/lease").status_code == 404


@pytest.fixture
def operation(setup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 202
    return response.json()["operation"]["operationId"]


def _running(setup, operation):
    lease = setup.store.acquire_lease(setup.project.projectId, owner_id="u1", lease_owner="worker-secret")
    setup.store.claim_operation(operation, owner_id="u1", lease_owner=lease.leaseOwner, generation=lease.generation)
    runtime = RuntimeInstance(runtimeId="rt-1", workspaceId=lease.workspaceId,
        projectId=setup.project.projectId, revision=setup.project.currentRevision,
        status="ready", port=5173, previewUrl="https://sandbox-secret.example", processId="process-secret",
        health="ready", lastHeartbeat="2026-09-11T00:00:00Z")
    setup.store.update_runtime_operation(operation, owner_id="u1", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime,
        result={"providerToken": "provider-secret"})
    return lease


def test_snapshot_and_cancel_remain_durable_while_worker_is_offline(setup, operation):
    setup.app.state.project_runtime_supervisor = None
    url = f"/project-operations/{operation}"
    assert setup.client.post(setup.url, json={**setup.body, "idempotencyKey": "other"}).status_code == 503
    snapshot = setup.client.get(url)
    assert snapshot.status_code == 200
    assert snapshot.json()["operation"]["status"] == "queued"
    cancelled = setup.client.post(url + "/cancel")
    assert cancelled.status_code == 202
    assert cancelled.json()["operation"]["cancelRequested"] is True
    # A persisted request is not proof that the remote process has stopped.
    assert cancelled.json()["operation"]["status"] == "queued"
    assert setup.store.get_operation(operation, owner_id="u1").cancelRequested is True
    assert setup.client.post(url + "/cancel").json() == cancelled.json()


def test_active_cancel_wakes_supervisor_without_provider_io(setup, operation):
    setup.supervisor._wake.clear()
    assert setup.client.post(f"/project-operations/{operation}/cancel").status_code == 202
    assert setup.supervisor._wake.is_set()
    assert setup.store.get_operation(operation, owner_id="u1").cancelRequested is True
    assert not setup.called


def test_activity_is_persisted_only_on_explicit_touch(setup, operation):
    url = f"/project-operations/{operation}"
    assert setup.client.get(url).json()["operation"]["lastAccessAt"] is None
    assert setup.client.get(url + "/events").status_code == 200
    assert setup.store.get_operation(operation, owner_id="u1").lastAccessAt is None
    response = setup.client.post(url + "/touch")
    assert response.status_code == 200
    assert response.json()["operation"]["lastAccessAt"] > 0
    assert setup.store.get_operation(operation, owner_id="u1").lastAccessAt > 0


def test_expired_lease_cannot_display_stale_ready_snapshot(setup, operation):
    lease = _running(setup, operation)
    setup.store.release_lease(setup.project.projectId, owner_id="u1", lease_owner=lease.leaseOwner,
        generation=lease.generation)
    snapshot = setup.client.get(f"/project-operations/{operation}").json()
    assert snapshot["runtime"]["status"] == "reconciling"
    assert snapshot["runtime"]["health"] == "unknown"


@pytest.mark.parametrize("suffix,method", [("", "get"), ("/events", "get"), ("/cancel", "post"), ("/touch", "post")])
def test_operation_reads_logs_and_cancel_reject_cross_owner(setup, operation, suffix, method):
    setup.viewer["id"] = "mallory"
    response = getattr(setup.client, method)(f"/project-operations/{operation}{suffix}")
    assert response.status_code == 404
    assert setup.store.get_operation(operation, owner_id="u1").cancelRequested is False


@pytest.mark.parametrize("suffix,method", [("", "get"), ("/events", "get"), ("/cancel", "post"), ("/touch", "post")])
@pytest.mark.parametrize("reason", ["disabled", "nonadmin", "production"])
def test_rollout_removal_preserves_owned_observation_and_stop_but_not_keepalive(setup, operation, monkeypatch, suffix, method, reason):
    if reason == "disabled": monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED")
    if reason == "nonadmin": setup.viewer["is_superuser"] = False
    if reason == "production": monkeypatch.setenv("NODE_ENV", "production")
    expected = 503 if suffix == "/touch" else 202 if suffix == "/cancel" else 200
    assert getattr(setup.client, method)(f"/project-operations/{operation}{suffix}").status_code == expected
    setup.viewer["id"] = "other-owner"
    assert getattr(setup.client, method)(f"/project-operations/{operation}{suffix}").status_code == 404
    assert setup.store.get_operation(operation, owner_id="u1").cancelRequested is (suffix == "/cancel")


def test_snapshots_and_event_pages_exclude_internal_records_and_resume_by_sequence(setup, operation):
    lease = _running(setup, operation)
    url = f"/project-operations/{operation}"
    snapshot = setup.client.get(url).json()
    assert snapshot["operation"]["status"] == "running" and snapshot["runtime"]["status"] == "ready"
    assert snapshot["lastSeq"] == 0
    assert "secret" not in str(snapshot)
    assert not {"leaseOwner", "pendingEvent", "result", "input", "requestHash"}.intersection(snapshot["operation"])
    assert not {"previewUrl", "processId"}.intersection(snapshot["runtime"])
    setup.store.flush_operation_event(operation, owner_id="u1", lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    for index in range(3):
        setup.store.append_event(operation, owner_id="u1", event_type="runtime.log", event_id=f"process-secret:{index}",
            payload={"processId": "process-secret", "text": f"line {index}", "nextOffset": index + 1, "truncated": False,
                "providerToken": "provider-secret"}, lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    first = setup.client.get(url + "/events", params={"afterSeq": snapshot["lastSeq"], "limit": 2}).json()
    assert [event["seq"] for event in first["events"]] == [1, 2]
    assert first["hasMore"] is True and first["nextSeq"] == 2
    assert first["events"][0]["payload"]["runtime"]["status"] == "ready"
    assert first["events"][1]["payload"]["text"] == "line 0"
    assert "secret" not in str(first)
    # Returning from or abandoning observation has no cancellation side effect.
    setup.supervisor._wake.clear()
    second = setup.client.get(url + "/events", params={"afterSeq": first["nextSeq"], "limit": 2}).json()
    assert [event["seq"] for event in second["events"]] == [3, 4]
    assert second["hasMore"] is False
    assert setup.store.get_operation(operation, owner_id="u1").cancelRequested is False
    assert not setup.supervisor._wake.is_set()
    empty = setup.client.get(url + "/events", params={"afterSeq": second["nextSeq"]}).json()
    assert empty == {"events": [], "nextSeq": 4, "hasMore": False}
    assert setup.client.get(url).json()["lastSeq"] == 4


def test_event_pages_expose_console_bytes_and_strip_internal_fields(setup, operation):
    lease = _running(setup, operation)
    url = f"/project-operations/{operation}"
    setup.store.flush_operation_event(operation, owner_id="u1", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner)
    setup.store.append_event(operation, owner_id="u1", event_type="runtime.console",
        event_id="pty-secret:0", payload={"processId": "pty-secret", "data": "user@sb$ n",
            "nextOffset": 10, "truncated": False, "providerToken": "provider-secret"},
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    page = setup.client.get(url + "/events", params={"afterSeq": 0}).json()
    console = [event for event in page["events"] if event["type"] == "runtime.console"]
    assert console and console[0]["payload"]["data"] == "user@sb$ n"
    assert "processId" not in console[0]["payload"]
    assert "secret" not in str(page)
    unknown = setup.store.append_event(operation, owner_id="u1", event_type="runtime.secret",
        event_id="hidden:1", payload={"token": "provider-secret"},
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    hidden = setup.client.get(url + "/events", params={"afterSeq": unknown.seq - 1, "limit": 1}).json()
    assert hidden["events"][0]["type"] == "runtime.secret"
    assert hidden["events"][0]["payload"] == {}


@pytest.mark.parametrize("params", [{"afterSeq": -1}, {"limit": 0}, {"limit": 201}, {"afterSeq": "not-a-cursor"}])
def test_event_cursor_is_bounded(setup, operation, params):
    assert setup.client.get(f"/project-operations/{operation}/events", params=params).status_code == 422


def test_event_stream_replays_then_settles(setup, operation):
    """通电：SSE 把已有 PTY 字节推出去，终态后 settled，不是空转 afterSeq。"""
    lease = _running(setup, operation)
    setup.store.flush_operation_event(operation, owner_id="u1", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner)
    setup.store.append_event(operation, owner_id="u1", event_type="runtime.console",
        event_id="pty-live:0", payload={"data": "npm test\n", "nextOffset": 9, "truncated": False},
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    current = setup.store.get_operation(operation, owner_id="u1")
    setup.store._q(
        "update wb_project_operation set payload=$1 where id=$2",
        [current.model_copy(update={"status": "completed"}).model_dump_json(), operation],
    )
    with setup.client.stream("GET", f"/project-operations/{operation}/events/stream") as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")
        body = "".join(response.iter_text())
    assert "npm test" in body
    assert "runtime.settled" in body
    assert "runtime.console" in body


def test_event_stream_rejects_cross_owner(setup, operation):
    setup.viewer["id"] = "mallory"
    assert setup.client.get(f"/project-operations/{operation}/events/stream").status_code == 404


@pytest.mark.parametrize("key", [None, "", " " * 3, "x" * 257])
def test_start_requires_bounded_client_idempotency_key(setup, monkeypatch, key):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    body = {**setup.body, "idempotencyKey": key}
    if key is None: body.pop("idempotencyKey")
    assert setup.client.post(setup.url, json=body).status_code == 422
    assert not setup.called


def test_dropped_start_response_keeps_persisted_operation_for_idempotent_retry(setup, monkeypatch):
    """Lose the actual ASGI response after dispatch, as a closed browser does."""
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    raw = json.dumps(setup.body).encode()
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "scheme": "http",
        "method": "POST", "path": setup.url, "raw_path": setup.url.encode(), "root_path": "",
        "query_string": b"", "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1234), "server": ("testserver", 80)}

    async def run():
        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                assert message["status"] == 202
                raise asyncio.CancelledError("browser disconnected")

        with pytest.raises(asyncio.CancelledError):
            await setup.app(scope, receive, send)

    asyncio.run(run())
    persisted = setup.store.list_runnable_operations()
    assert len(persisted) == 1
    operation, owner = persisted[0]
    assert owner == "u1" and operation.status == "queued" and not operation.cancelRequested
    retry = setup.client.post(setup.url, json=setup.body)
    assert retry.status_code == 202 and retry.json()["operation"]["operationId"] == operation.operationId
    assert not setup.called


_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_preview_snapshot_route_is_not_verification(setup):
    pid = setup.project.projectId
    empty = setup.client.get(f"/projects/{pid}/preview-snapshot")
    assert empty.status_code == 404
    verify = setup.client.get(f"/projects/{pid}/verification")
    assert verify.status_code == 200
    assert verify.json()["snapshot"] is None
    setup.store.put_preview_snapshot(
        pid,
        owner_id="u1",
        png=_TINY_PNG,
        revision=setup.project.currentRevision,
        source="browser_view",
    )
    shot = setup.client.get(f"/projects/{pid}/preview-snapshot")
    assert shot.status_code == 200
    assert shot.headers["content-type"].startswith("image/png")
    assert shot.content == _TINY_PNG
    still = setup.client.get(f"/projects/{pid}/verification")
    assert still.json()["snapshot"] is None
