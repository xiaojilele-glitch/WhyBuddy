"""Actual app lifespan, SQL identities, signed login, control HTTP and preview.

Only E2B process/file IO is replaced. The test never substitutes the production
authorizers, ControlRunService, ProjectTools, supervisor, preview manager, or
identity store. A cached browser grant must obey the same revoked account as
the next authenticated workbench request, including after application restart.
"""

import json
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

import app as app_module
from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from routes import project_runtime as runtime_route
from services import identity_store, node_bridge_runtime, persistence, project_store
from services.auth_tokens import create_access_token
from services.project_authority import approved_reference
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore
from services.workspace_provider import ProcessResult
from test_project_live_source_sync import SyncProvider
from test_project_runtime_worker import eventually


class ComposedProvider(SyncProvider):
    def __init__(self):
        super().__init__()
        self.tunnels = {}

    def start_preview_tunnel(self, handle, **arguments):
        pid = str(800 + len(self.tunnels))
        self.tunnels[pid] = dict(arguments)
        return ProcessResult(pid)

    def is_process_running(self, handle, pid):
        return pid in self.tunnels if pid.startswith("8") else super().is_process_running(handle, pid)

    def stop(self, handle, pid):
        assert pid.startswith("8"), "preview rotation tried to stop the app server"
        self.tunnels.pop(pid, None)


@pytest.fixture
def composed(tmp_path, monkeypatch, real_auth):
    url = f"sqlite:///{(tmp_path / 'composition.db').as_posix()}"
    store, sessions = ProjectStore.from_url(url), SqlSessionBlobStore(url)
    accounts_executor = identity_store._SqlExecutor(url)
    accounts = identity_store.IdentityStore(accounts_executor, is_sqlite=True)
    owner = accounts.create("composition@example.test", "fixture-password-hash", is_superuser=True, is_verified=True)
    monkeypatch.setattr(identity_store, "_store", accounts)
    monkeypatch.setattr(identity_store, "_store_sig", identity_store._signature())
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    for module in (app_module, project_store, runtime_route):
        monkeypatch.setattr(module, "get_project_store", lambda: store)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(app_module.settings, "NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("SLIDERULE_PROJECT_POLL_SECONDS", "1")
    monkeypatch.setenv("SLIDERULE_PROJECT_LEASE_SECONDS", "30")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "g" * 40)
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    bundle = tmp_path / "preview-agent.cjs"
    bundle.write_text("// fixture bytes; execution is the only replaced boundary", encoding="utf-8")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_AGENT_BUNDLE", str(bundle))
    monkeypatch.setattr(app_module, "_warm_storage_backends", lambda: None)
    monkeypatch.setattr(app_module, "_dry_run_calendars", lambda: None)
    monkeypatch.setattr(node_bridge_runtime, "configure_node_bridge_runtimes", lambda: False)
    provider = ComposedProvider()
    monkeypatch.setattr(app_module, "E2BWorkspaceProvider", lambda: provider)
    monkeypatch.delitem(app_module.app.dependency_overrides, require_user, raising=False)
    state = V5SessionState(sessionId="composition-" + uuid.uuid4().hex, ownerId=owner.id,
        goal={"text": "Build the fixed project", "status": "clear"}, controlTranscript=approved_plan_rows())
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    token = create_access_token(owner.id, password_hash=owner["password_hash"])
    client = TestClient(app_module.app, headers={"Authorization": "Bearer " + token})
    world = SimpleNamespace(client=client, provider=provider, accounts=accounts, owner=owner, store=store,
        sessions=sessions, state=state, approval=approved_reference(state), app=app_module.app)
    client.__enter__()
    try:
        yield world
    finally:
        client.__exit__(None, None, None)
        for handle in list(provider.handles.values()):
            provider.destroy(handle)
        store.close()
        sessions._engine.dispose()
        accounts_executor._engine.dispose()
        identity_store.invalidate_auth_cache()


def control(world, name, arguments):
    response = world.client.post("/api/sliderule/control-turn-stream", json={
        "sessionId": world.state.sessionId, "userText": "Continue the approved project",
        "installedSkills": [], "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None,
        "forcedTool": name, "toolArgs": arguments,
    })
    assert response.status_code == 200, response.text
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    result = [item for item in events if item.get("type") == "control_tool_result" and item.get("tool") == name]
    assert len(result) == 1 and result[0].get("ok"), events
    return result[0]


def ready(world):
    project = control(world, "project_create", {"approvalRef": world.approval})
    submitted = control(world, "project_start", {"approvalRef": world.approval,
        "expectedRevision": project["revision"], "idempotencyKey": "start"})
    def current():
        operation = world.store.get_operation(submitted["operationId"], owner_id=world.owner.id)
        return operation if (operation.result or {}).get("preview", {}).get("phase") == "active" else None
    operation = eventually(current, timeout=12)
    return project, operation


def grant(world, operation):
    response = world.client.post(f"/api/sliderule/project-operations/{operation.operationId}/preview-ticket")
    assert response.status_code == 200, response.text
    entry = urlsplit(response.json()["entryUrl"])
    audience = entry.scheme + "://" + entry.netloc
    ticket = parse_qs(entry.query)["ticket"][0]
    result = authority(world, "redeem", {"ticket": ticket, "audience": audience})
    assert result.status_code == 200, result.text
    return audience, result.json()


def authority(world, action, arguments):
    return world.client.post("/api/sliderule/internal/project-preview/" + action,
        headers={"Authorization": "Bearer " + "g" * 40}, json=arguments)


def test_actual_lifespan_shares_one_supervisor_store_and_preview_authority(composed):
    world = composed
    project, operation = ready(world)
    app_state = world.app.state
    supervisor, control_service = app_state.project_runtime_supervisor, app_state.control_run_service
    assert control_service.project_supervisor is supervisor
    assert control_service.project_store is supervisor.store is world.store
    assert supervisor.preview_access is supervisor.preview_runtime.access is app_state.project_preview_access
    assert world.provider.created == 1
    observed = world.client.get(f"/api/sliderule/projects/{project['projectId']}/preview")
    assert observed.status_code == 200 and observed.json()["available"]
    audience, browser = grant(world, operation)
    assert authority(world, "authorize", {"role": "browser", "token": browser["token"], "audience": audience}).status_code == 200
    assert authority(world, "authorize", {"role": "tunnel", "token": browser["token"], "audience": audience}).status_code == 403
    assert world.client.post("/api/sliderule/internal/project-preview/authorize", json={
        "role": "browser", "token": browser["token"], "audience": audience}).status_code == 401


@pytest.mark.parametrize("revocation", ["inactive", "no-project-qualification", "deleted"])
def test_account_revocation_denies_existing_grants_new_ticket_and_active_worker(composed, revocation):
    world = composed
    _, operation = ready(world)
    audience, browser = grant(world, operation)
    tunnel = next(iter(world.provider.tunnels.values()))["token"]
    bodies = [
        {"role": "browser", "token": browser["token"], "audience": audience},
        {"role": "tunnel", "token": tunnel, "audience": audience},
        {"role": "binding", "binding": browser["binding"], "audience": audience},
    ]
    assert all(authority(world, "authorize", body).status_code == 200 for body in bodies)
    pending = world.client.post(f"/api/sliderule/project-operations/{operation.operationId}/preview-ticket")
    assert pending.status_code == 200
    pending_ticket = parse_qs(urlsplit(pending.json()["entryUrl"]).query)["ticket"][0]
    if revocation == "inactive":
        world.accounts.set_active(world.owner.id, False)
    elif revocation == "no-project-qualification":
        world.accounts.set_superuser(world.owner.id, False)
    else:
        world.accounts._x.execute("delete from sliderule_user where id=:p1", [world.owner.id])
    assert all(authority(world, "authorize", body).status_code == 403 for body in bodies)
    assert authority(world, "redeem", {"ticket": pending_ticket, "audience": audience}).status_code == 403
    ticket = world.client.post(f"/api/sliderule/project-operations/{operation.operationId}/preview-ticket")
    assert ticket.status_code in {401, 403, 503}
    def stopped():
        current = world.store.get_operation(operation.operationId, owner_id=world.owner.id)
        return current if current.status == "failed" else None
    failed = eventually(stopped, timeout=12)
    assert failed.runtime.health == "unknown" and not world.provider.handles
    assert all(row["revoked_at"] is not None for row in world.store._q("select * from wb_project_preview_access"))


def test_identity_lookup_outage_denies_preview_without_leaking_and_cleans_runtime(composed, monkeypatch):
    world = composed
    _, operation = ready(world)
    audience, browser = grant(world, operation)
    def unavailable(_owner):
        raise RuntimeError("private-database-connection-token")
    monkeypatch.setattr(world.accounts, "get_by_id_for_auth", unavailable)
    denied = authority(world, "authorize", {"role": "browser", "token": browser["token"], "audience": audience})
    assert denied.status_code == 403
    assert "private-database" not in denied.text
    def stopped():
        current = world.store.get_operation(operation.operationId, owner_id=world.owner.id)
        return current if current.status == "failed" else None
    failed = eventually(stopped, timeout=12)
    assert failed.runtime.errorCode == "project_actor_unavailable" and not world.provider.handles
    assert "private-database" not in failed.model_dump_json()


def test_real_app_restart_recovers_same_runtime_and_invalidates_old_preview_generation(composed):
    world = composed
    _, original = ready(world)
    audience, browser = grant(world, original)
    old_control = world.app.state.control_run_service
    old_access = world.app.state.project_preview_access
    old_lease = world.store.get_lease(original.projectId, owner_id=world.owner.id)
    old_tunnel = next(iter(world.provider.tunnels.values()))["token"]
    world.client.__exit__(None, None, None)
    assert world.app.state.project_runtime_supervisor is None
    assert world.app.state.project_preview_access is None and world.app.state.control_run_service is None
    assert len(world.provider.handles) == 1
    world.client.__enter__()
    def recovered():
        operation = world.store.get_operation(original.operationId, owner_id=world.owner.id)
        preview = (operation.result or {}).get("preview", {})
        return operation if preview.get("phase") == "active" and preview.get("generation", 0) > old_lease.generation else None
    fresh = eventually(recovered, timeout=12)
    assert world.app.state.control_run_service is not old_control
    assert world.app.state.project_preview_access is not old_access
    assert world.app.state.control_run_service.project_supervisor is world.app.state.project_runtime_supervisor
    assert fresh.runtime.runtimeId == original.runtime.runtimeId and fresh.runtime.processId == original.runtime.processId
    assert world.provider.created == 1
    for role, token in (("browser", browser["token"]), ("tunnel", old_tunnel)):
        assert authority(world, "authorize", {"role": role, "token": token, "audience": audience}).status_code == 403
    new_audience, new_browser = grant(world, fresh)
    assert new_audience == audience
    assert new_browser["binding"]["generation"] > browser["binding"]["generation"]
    assert authority(world, "authorize", {"role": "browser", "token": new_browser["token"], "audience": audience}).status_code == 200
