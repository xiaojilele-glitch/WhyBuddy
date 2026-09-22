"""Exercise project creation and failure feedback through the product HTTP loop."""

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from project_actor_support import project_actor

from app import app
from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, KEY, client, llm_text, llm_tool, new_sid, parse_sse, seed_approved_session, six_fields
from middlewares.current_user import optional_user, require_user
from services import persistence, project_store
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_store import ProjectStore
from services.project_tool_contracts import PROJECT_TOOL_NAMES
from services.slide_rule_session import load_session


@pytest.fixture
def setup(tmp_path, monkeypatch, project_actor):
    project_actor(TEST_USER_ID)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.session_blob_store import SqlSessionBlobStore
    database_url = f"sqlite:///{tmp_path / 'state.db'}"
    sessions = SqlSessionBlobStore(database_url)
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    from config.settings import settings
    monkeypatch.setattr(settings, "NODE_ENV", "development")
    store = ProjectStore.from_url(database_url)
    monkeypatch.setattr(project_store, "get_project_store", lambda: store)
    from routes import project_runtime
    monkeypatch.setattr(project_runtime, "get_project_store", lambda: store)
    viewer = User(id=TEST_USER_ID, is_superuser=True)
    app.dependency_overrides[optional_user] = lambda: viewer
    app.dependency_overrides[require_user] = lambda: viewer
    state = seed_approved_session(new_sid("project-control"), goal={"text": "Build a small project"})
    from services.control_run_store import ControlRunStore
    from services.control_run_service import ControlRunService
    from services.project_creation import load_authorized_session
    control_service = ControlRunService(ControlRunStore(store._q), store, None,
        authorize=lambda sid, owner: load_authorized_session(sid, owner_id=owner), poll_seconds=0.01)
    @asynccontextmanager
    async def lifespan(application):
        application.state.control_run_service = control_service
        await control_service.start()
        try:
            yield
        finally:
            await control_service.shutdown()
            application.state.control_run_service = None
    monkeypatch.setattr(app.router, "lifespan_context", lifespan)
    with client:
        yield SimpleNamespace(store=store, state=state, viewer=viewer, ref=approved_reference(state), control=control_service)
    app.dependency_overrides.pop(require_user, None)
    store.close()
    sessions._engine.dispose()


def post(state, **extra):
    response = client.post("/api/sliderule/control-turn-stream", headers=KEY,
        json=six_fields(state.sessionId, "Continue the approved project", **extra))
    assert response.status_code == 200, response.text
    return [e for e in parse_sse(response.text) if e["type"] not in {"control_run_started", "control_run_settled"}]


def test_http_creation_recovery_and_client_cannot_overwrite_reference(setup):
    path = f"/api/sliderule/sessions/{setup.state.sessionId}/project"
    first = client.post(path, json={"approvalRef": setup.ref})
    second = client.post(path, json={"approvalRef": setup.ref})
    assert first.status_code == second.status_code == 201
    project = first.json()["project"]
    assert project == second.json()["project"] == client.get(path).json()["project"]
    saved = load_session(setup.state.sessionId)
    assert saved.projectId == project["projectId"] and saved.runtimeKind == "project"
    assert saved.projectRevision == project["currentRevision"]
    assert client.post(path, json={"approvalRef": "old"}).status_code == 403
    assert client.post(path, json={"approvalRef": setup.ref, "ownerId": "forged"}).status_code == 422
    setup.viewer["id"] = "someone-else"
    assert client.get(path).status_code == 404
    assert client.post(path, json={"approvalRef": setup.ref}).status_code == 404


def test_plan_approval_receipt_enters_project_creation_in_the_existing_loop(setup, monkeypatch):
    harness = ControlHarness(monkeypatch)
    calls = iter([llm_tool("enter_plan_mode"), llm_tool("write_plan", {"planContent": "Create the fixed source project"}),
                  llm_tool("exit_plan_mode")])
    harness.llm_impl = lambda *a, **kw: next(calls)
    approval = next(e for e in post(setup.state) if e["type"] == "control_plan_approval")
    assert setup.store.get_project_for_session(setup.state.sessionId, owner_id=TEST_USER_ID) is None
    def model(messages, **kwargs):
        if any(m["role"] == "tool" for m in messages):
            return llm_text("Approved source project saved.")
        current = load_session(setup.state.sessionId)
        ref = approved_reference(current)
        assert ref != setup.ref and ref in messages[0]["content"]
        return llm_tool("project_create", {"approvalRef": ref})
    harness.llm_impl = model
    events = post(setup.state, toolAnswer={"kind": "plan_approval", "reqId": approval["reqId"], "outcome": "approved"})
    assert any(e.get("tool") == "project_create" and e.get("ok") for e in events)
    assert load_session(setup.state.sessionId).runtimeKind == "project"
    assert not harness.helper_calls


def test_model_creation_read_and_patch_reach_durable_sources_and_next_prompt(setup, monkeypatch):
    harness = ControlHarness(monkeypatch)
    observed = []

    def model(messages, **kwargs):
        results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        offered = {t["function"]["name"] for t in kwargs["tools"]}
        if not results:
            assert "project_create" in offered
            return llm_tool("project_create", {"approvalRef": setup.ref})
        result = results[-1]
        assert result["ok"], result
        observed.append(result)
        assert "rehearse" not in offered and "report_done" not in offered
        if result["tool"] == "project_create":
            # The source is committed, but the model turn is still in flight.
            # Its persisted event must already let the browser change surface.
            active = setup.control.store.latest(setup.state.sessionId, TEST_USER_ID)
            assert active["status"] == "running"
            assert not any(e["type"] == "complete" for e in active["events"])
            projection = next(e for e in active["events"] if e["type"] == "control_project_state")
            assert projection["projectRevision"] == result["revision"]
            assert projection["projectId"] == load_session(setup.state.sessionId).projectId
            assert result["revision"] in messages[0]["content"]
            return llm_tool("project_read", {"path": "src/main.tsx", "offset": 0, "limit": 8000}, "read")
        if result["tool"] == "project_read":
            return llm_tool("project_patch", {"approvalRef": setup.ref, "expectedRevision": result["revision"],
                "changes": [{"path": "src/main.tsx", "content": result["content"] + "\n// revision from the control loop\n",
                             "expectedSha256": result["sha256"]}]}, "patch")
        assert result["revision"] in messages[0]["content"]
        return llm_text("Source saved; verification has not run.")

    harness.llm_impl = model
    events = post(setup.state)
    # ⚠ 2026-09-15：这条判据写在自动续跑之前。工程目标收尾时若还没交付，
    #   `should_continue` 会再醒一轮（reason=goal_not_delivered），桩模型于是
    #   又发了一次 patch。**这是设计好的行为**，不是多写一次源码：
    #   `no_progress` 那道闸保证第二轮没新进展就收手，所以恰好多一轮。
    #
    #   所以不是把数字改大了事——把续跑**正面钉住**：续跑没了会红，
    #   续跑失控成两轮也会红。原意（create→read→patch 走到落库的源码）照旧。
    continuations = [e for e in events if e.get("type") == "control_continuation"]
    assert [(e["attempt"], e["reason"]) for e in continuations] == [(1, "goal_not_delivered")]
    assert [r["tool"] for r in observed] == [
        "project_create", "project_read", "project_patch",
        "project_patch",  # ← 续跑那一轮
    ]
    saved = load_session(setup.state.sessionId)
    assert saved.projectRevision == observed[-1]["revision"] != observed[0]["revision"]
    assert setup.store.read_files(saved.projectId, owner_id=TEST_USER_ID)["src/main.tsx"].endswith("// revision from the control loop\n")
    assert not harness.helper_calls
    assert events[-1]["type"] == "complete" and events[-1]["state"]["projectRevision"] == saved.projectRevision
    projections = [e for e in events if e["type"] == "control_project_state"]
    assert projections[0]["projectRevision"] == observed[0]["revision"]
    assert projections[-1]["projectRevision"] == saved.projectRevision
    assert all(e["runtimeKind"] == "project" and e["sessionId"] == saved.sessionId for e in projections)
    assert all(set(e) <= {"type", "sessionId", "runtimeKind", "projectId", "projectRevision",
        "controlRunId", "toolCallId", "seq"} for e in projections)
    first_receipt = next(e for e in events if e["type"] == "control_tool_result" and e["tool"] == "project_create")
    assert projections[0]["seq"] < first_receipt["seq"]
    # Resume uses the same public event log, not the private model checkpoint.
    resumed = client.get(f"/api/sliderule/control-runs/{first_receipt['controlRunId']}/stream", headers=KEY)
    assert resumed.status_code == 200
    assert [e for e in parse_sse(resumed.text) if e["type"] == "control_project_state"] == projections


def test_tool_result_cannot_claim_a_project_without_a_persisted_session_projection(setup, monkeypatch):
    from services.project_tools import ProjectTools
    monkeypatch.setattr(ProjectTools, "execute", lambda *_: {
        "ok": True, "runtimeKind": "project", "projectId": "claimed-project", "revision": "claimed-revision",
    })
    events = post(setup.state, forcedTool="project_create", toolArgs={"approvalRef": setup.ref})
    assert any(e.get("tool") == "project_create" and e.get("ok") for e in events)
    assert not any(e["type"] == "control_project_state" for e in events)
    assert load_session(setup.state.sessionId).runtimeKind != "project"
    assert setup.store.get_project_for_session(setup.state.sessionId, owner_id=TEST_USER_ID) is None


@pytest.mark.parametrize("mode", ["off", "nonadmin", "production", "no-approval"])
def test_payload_cannot_enable_project_writes(setup, monkeypatch, mode):
    if mode == "off": monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED")
    if mode == "nonadmin": setup.viewer["is_superuser"] = False
    if mode == "production": monkeypatch.setenv("NODE_ENV", "production")
    if mode == "no-approval":
        setup.state.controlTranscript = []
        persistence.save_session_record(setup.state, server_write=True)
        from services.slide_rule_session import save_session
        save_session(setup.state)
    events = post(setup.state, forcedTool="project_create", toolArgs={"approvalRef": setup.ref},
                  projectToolsEnabled=True, ownerId=TEST_USER_ID)
    assert any(e.get("ok") is False and "project_" in e.get("error", "") for e in events)
    assert setup.store.get_project_for_session(setup.state.sessionId, owner_id=TEST_USER_ID) is None
    assert not any(e["type"] == "control_project_state" for e in events)


@pytest.mark.parametrize("tool", ["spec", "refine", "repair", "workflow", "restore_version", "report_done"])
def test_project_forced_legacy_tools_cannot_enter_html_or_claim_old_closure(setup, monkeypatch, tool):
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    events = post(setup.state, forcedTool=tool)
    expected = "project_verification_not_available" if tool == "report_done" else "project_html_factory_not_supported"
    assert any(e.get("error") == expected for e in events)
    assert not harness.helper_calls and not harness.invalidate_calls


@pytest.mark.parametrize("path", ["drive-full", "drive-full-stream"])
def test_project_cannot_bypass_control_using_legacy_driver(setup, path):
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    saved = load_session(setup.state.sessionId)
    response = client.post(f"/api/sliderule/{path}", headers=KEY,
        json={**six_fields(saved.sessionId, "go"), "state": saved.model_dump(mode="json")})
    assert response.status_code == 409 and response.json()["message"] == "project_html_factory_not_supported"


def test_project_contract_names_are_registered_without_factory_write_scope():
    from services.closed_tools import CLOSED_TOOLS, ToolScope, resolve_tool_scope
    from services.rehearsal_control import CONTROL_TOOLS
    assert PROJECT_TOOL_NAMES <= set(CLOSED_TOOLS)
    assert PROJECT_TOOL_NAMES <= {t["function"]["name"] for t in CONTROL_TOOLS}
    assert all(resolve_tool_scope(name) == ToolScope.READ for name in PROJECT_TOOL_NAMES)


def test_failed_command_returns_to_same_model_loop_before_patch_and_rerun(setup, monkeypatch):
    from services.project_manifest import content_hash
    from services.project_tools import ProjectTools
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from test_project_command_worker import CommandProvider
    from test_project_runtime_worker import eventually

    class SourceProvider(CommandProvider):
        def write_files(self, handle, files):
            super().write_files(handle, files)
            self.command_code = 2 if "TYPE_ERROR" in files["src/main.tsx"] else 0

    provider = SourceProvider()
    supervisor = ProjectRuntimeSupervisor(setup.store, lambda: provider,
        poll_interval=0.02, lease_ttl=10, lifetime_seconds=30, idle_seconds=20)
    monkeypatch.setattr(app.state, "project_runtime_supervisor", supervisor, raising=False)
    setup.control.project_supervisor = supervisor
    adapter = ProjectTools(setup.store, supervisor, TEST_USER_ID)
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    source = setup.store.read_files(project.projectId, owner_id=TEST_USER_ID)["src/main.tsx"]
    broken = adapter.execute("project_patch", {"approvalRef": setup.ref, "expectedRevision": project.currentRevision,
        "changes": [{"path": "src/main.tsx", "content": source + "\nTYPE_ERROR\n", "expectedSha256": content_hash(source)}]}, setup.state)
    assert broken["ok"]
    supervisor.start()
    try:
        failed = supervisor.submit_command(project.projectId, owner_id=TEST_USER_ID,
            expected_revision=broken["revision"], approval_ref=setup.ref, idempotency_key="bad", command="check")
        eventually(lambda: setup.store.get_operation(failed.operationId, owner_id=TEST_USER_ID).status == "failed")
        eventually(lambda: setup.store.get_lease(project.projectId, owner_id=TEST_USER_ID).sandboxId is None)
        harness = ControlHarness(monkeypatch)
        seen = []

        def model(messages, **kwargs):
            results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
            if not results:
                return llm_tool("project_status", {"operationId": failed.operationId})
            result = results[-1]
            assert result["ok"], result
            seen.append(result)
            if len(results) == 1:
                assert result["status"] == "failed" and result["exitCode"] == 2
                return llm_tool("project_logs", {"operationId": failed.operationId}, "logs")
            if len(results) == 2:
                assert result["logs"]
                return llm_tool("project_read", {"path": "src/main.tsx", "offset": 0, "limit": 8000}, "read")
            if len(results) == 3:
                assert "TYPE_ERROR" in result["content"]
                return llm_tool("project_patch", {"approvalRef": setup.ref, "expectedRevision": result["revision"],
                    "changes": [{"path": "src/main.tsx", "content": source, "expectedSha256": result["sha256"]}]}, "fix")
            if len(results) == 4:
                assert result["revision"] != broken["revision"]
                return llm_tool("project_exec", {"approvalRef": setup.ref, "expectedRevision": result["revision"],
                    "command": "check", "idempotencyKey": "fixed"}, "exec")
            if len(results) == 5:
                return llm_tool("project_status", {"operationId": result["operationId"], "waitSeconds": 5}, "status")
            assert result["status"] == "completed" and result["exitCode"] == 0
            return llm_text("Check passed for repaired source. Business verification remains unavailable.")

        harness.llm_impl = model
        events = post(setup.state)
        # ⚠ 2026-09-15：+1 是那一轮自动续跑（见上一条判据的注释）。
        #   照旧钉住续跑本身，别只把数字改大。
        assert [(e["attempt"], e["reason"]) for e in events
                if e.get("type") == "control_continuation"] == [(1, "goal_not_delivered")]
        assert len(seen) == 7 and len(harness.llm_calls) == 8
        assert seen[-1]["revision"] == seen[3]["revision"]
        assert events[-1]["type"] == "complete" and not harness.helper_calls
        assert not provider.handles
    finally:
        supervisor.shutdown()
