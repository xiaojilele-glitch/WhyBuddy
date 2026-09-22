"""The actual SQL runtime owner dispatches trusted checks and serializes edits.

Only cloud/browser IO is replaced here. Real Chromium assertions are covered by
the runner tests; these cases protect the product control and recovery wiring.
"""
import base64
import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from services.project_preview_config import origin_for_runtime
from services.project_tools import ProjectTools
from test_project_live_source_sync import live, patch_args
from project_actor_support import project_actor
from test_project_runtime_worker import eventually
from test_control_project_tools import setup as control_setup, post as control_post
from project_build_support import enable_build_provider

ASSERTIONS = ("heading_visible", "counter_initial", "counter_increment", "counter_second_increment",
              "reload_reset", "no_page_errors", "no_failed_requests")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")


class Browser:
    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.calls, self.cleaned = [], []
        self.failed = False

    def availability_error(self):
        return None

    def cleanup(self, verification_id, check_callback=None):
        if check_callback:
            check_callback()
        self.cleaned.append(verification_id)
        return True

    def run(self, **kwargs):
        if hasattr(self, "workspace"):
            assert self.workspace.active_server_mode == "production"
        self.calls.append({key: value for key, value in kwargs.items() if key != "check_callback"})
        self.entered.set()
        try:
            while not self.release.wait(0.01):
                kwargs["check_callback"]()
            kwargs["check_callback"]()
            return {"status": "failed" if self.failed else "passed", "cleanupConfirmed": True,
                "runnerVersion": "whybuddy-browser-v1:pw1.61.1",
                "errorCode": "project_browser_assertion_failed" if self.failed else None,
                "assertions": [{"id": name, "status": "failed" if self.failed and name == "counter_increment" else "passed",
                    **({"expected": "1", "actual": "2"} if self.failed and name == "counter_increment" else {})}
                    for name in ASSERTIONS], "artifacts": {"before.png": PNG, "after.png": PNG}}
        finally:
            self.cleanup(kwargs["verification_id"])


def install_browser(live, monkeypatch, browser=None):
    browser = browser or Browser()
    browser.workspace = enable_build_provider(getattr(live, "provider", None) or live.supervisor.provider_factory())
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    live.supervisor.browser_provider_factory = lambda: browser
    live.supervisor.preview_runtime = SimpleNamespace(ensure=lambda task: None, revoke=lambda task: None,
        suspend_for_sync=lambda task: None)
    revoked = []
    live.supervisor.preview_access = SimpleNamespace(has_active_tunnel=lambda *args, **kwargs: True,
        issue_browser_ticket=lambda *args, **kwargs: SimpleNamespace(secret="browser-ticket-fixture",
            scope=SimpleNamespace(grant_id="grant-fixture")),
        revoke_grant=lambda grant_id, **kwargs: revoked.append(grant_id))
    return browser, revoked


def verify(live, *, key="verify-1", revision=None):
    result = live.tools.execute("project_verify", {"approvalRef": live.approval,
        "expectedRevision": revision or live.parent().runtime.revision,
        "runtimeOperationId": live.started["operationId"], "idempotencyKey": key}, live.state)
    assert result["ok"], result
    return result["operationId"]


def verdict(live, operation_id):
    records = live.supervisor.verification_store
    eventually(lambda: (row := records.for_operation(operation_id, owner_id="alice"))
        and row.verification.status != "running")
    eventually(lambda: live.store.get_operation(operation_id, owner_id="alice").status in {"completed", "cancelled", "failed"})
    return records.for_operation(operation_id, owner_id="alice")


def test_real_tools_and_owner_record_missing_browser_as_blocked(live):
    child = verify(live)
    snapshot = verdict(live, child)
    assert snapshot.effectiveStatus == "blocked" and snapshot.deliveryEligible is False
    assert snapshot.verification.errorCode == "project_browser_not_configured"
    assert not snapshot.verification.artifactRefs
    assert live.parent().runtime.status == "ready" and live.parent().runtime.processId
    observed = live.tools.execute("project_verification", {"operationId": child}, live.state)
    assert observed["ok"] and observed["verification"]["status"] == "blocked"


def test_real_owner_serializes_browser_and_queued_patch_then_exposes_stale_evidence(live, monkeypatch):
    browser, revoked = install_browser(live, monkeypatch)
    browser.release.clear()
    child = verify(live)
    assert browser.entered.wait(5)
    before = dict(live.provider.contents)
    patch = live.tools.execute("project_patch", patch_args(live), live.state)
    assert patch["ok"]
    time.sleep(0.08)
    assert live.provider.contents == before
    assert live.store.get_operation(patch["operationId"], owner_id="alice").status == "queued"
    browser.release.set()
    eventually(lambda: live.store.get_operation(patch["operationId"], owner_id="alice").status == "completed")
    saved = verdict(live, child)
    assert saved.verification.status == "passed" and saved.effectiveStatus == "stale"
    assert saved.verification.revision != live.parent().runtime.revision
    assert browser.calls[0]["revision"] == saved.verification.revision
    assert revoked == ["grant-fixture"]
    observed = live.tools.execute("project_status", {"operationId": child, "waitSeconds": 0}, live.state)
    assert observed["verification"]["status"] == "stale"
    assert observed["verification"]["deliveryEligible"] is False


def test_cancel_check_stops_browser_without_cancelling_healthy_parent(live, monkeypatch):
    browser, revoked = install_browser(live, monkeypatch)
    browser.release.clear()
    child = verify(live)
    assert browser.entered.wait(5)
    result = live.tools.execute("project_cancel", {"operationId": child}, live.state)
    assert result["ok"]
    snapshot = verdict(live, child)
    assert snapshot.effectiveStatus == "cancelled" and child in browser.cleaned
    assert live.parent().status == "running" and live.parent().runtime.status == "ready"
    assert not live.parent().cancelRequested and revoked == ["grant-fixture"]


def test_failed_assertion_reaches_model_and_new_check_can_pass(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    browser.failed = True
    child = verify(live)
    assert verdict(live, child).effectiveStatus == "failed"
    result = live.tools.execute("project_verification", {"operationId": child}, live.state)
    assert {"id": "counter_increment", "status": "failed", "expected": "1", "actual": "2"} in result["verification"]["assertions"]
    browser.failed = False
    second = verify(live, key="verify-again")
    assert verdict(live, second).effectiveStatus == "passed"
    assert verdict(live, child).verification.status == "failed"


def test_unknown_browser_evidence_cannot_turn_a_completed_process_into_passed(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    monkeypatch.setattr(browser, "run", lambda **kwargs: {"status": "passed", "cleanupConfirmed": True,
        "runnerVersion": "whybuddy-browser-v1:pw1.61.1", "assertions": [], "artifacts": {}})
    child = verify(live)
    snapshot = verdict(live, child)
    assert snapshot.effectiveStatus == "blocked" and not snapshot.verification.artifactRefs


def test_source_changed_inside_verification_prevents_passing_receipt(live, monkeypatch):
    browser, _ = install_browser(live, monkeypatch)
    original = browser.run
    def tampered(**kwargs):
        result = original(**kwargs)
        live.provider.contents["src/App.tsx"] = "unversioned edit"
        return result
    monkeypatch.setattr(browser, "run", tampered)
    child = verify(live)
    assert verdict(live, child).effectiveStatus == "blocked"


def test_verify_tool_rejects_cross_session_parent_and_extra_passed_argument(live):
    parameters = {"approvalRef": live.approval, "expectedRevision": live.project["revision"],
        "runtimeOperationId": live.started["operationId"], "idempotencyKey": "forged", "passed": True}
    assert live.tools.execute("project_verify", parameters, live.state)["error"] == "project_tool_arguments_invalid"
    assert not live.store.list_runtime_verifications(live.started["operationId"], owner_id="alice")


def test_http_queue_observe_and_artifact_require_current_owner(live, monkeypatch):
    from routes import project_runtime as routes
    browser, _ = install_browser(live, monkeypatch)
    monkeypatch.setattr(routes, "get_project_store", lambda: live.store)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/sliderule")
    app.state.project_runtime_supervisor = live.supervisor
    viewer = {"id": "alice"}
    app.dependency_overrides[require_user] = lambda: SimpleNamespace(id=viewer["id"], is_superuser=True, is_active=True)
    client = TestClient(app)
    endpoint = "/api/sliderule/project-operations/" + live.started["operationId"] + "/verify"
    body = {"expectedRevision": live.project["revision"], "idempotencyKey": "http-verify"}
    assert client.post(endpoint, json={**body, "status": "passed"}).status_code == 422
    response = client.post(endpoint, json=body)
    assert response.status_code == 202, response.text
    child = response.json()["operationId"]
    saved = verdict(live, child)
    latest = client.get("/api/sliderule/projects/" + live.project["projectId"] + "/verification")
    assert latest.status_code == 200 and latest.json()["snapshot"]["effectiveStatus"] == "passed"
    assert latest.headers["cache-control"] == "no-store"
    record = saved.verification
    image_path = f"/api/sliderule/project-verifications/{record.verificationId}/artifacts/{record.artifactRefs[0].artifactId}"
    image = client.get(image_path)
    assert image.status_code == 200 and image.content == PNG and image.headers["content-type"] == "image/png"
    viewer["id"] = "another-owner"
    assert client.get(image_path).status_code == 404
    assert client.get("/api/sliderule/project-verifications/" + record.verificationId).status_code == 404
    assert client.post(endpoint, json=body).status_code == 404


def test_parent_cancel_reclaims_browser_then_runtime_and_preserves_source(live, monkeypatch):
    browser, revoked = install_browser(live, monkeypatch)
    browser.release.clear()
    child = verify(live)
    assert browser.entered.wait(5)
    result = live.tools.execute("project_cancel", {"operationId": live.started["operationId"]}, live.state)
    assert result["ok"]
    snapshot = verdict(live, child)
    eventually(lambda: live.parent().status == "cancelled")
    assert snapshot.effectiveStatus == "cancelled" and snapshot.deliveryEligible is False
    assert child in browser.cleaned and revoked == ["grant-fixture"]
    assert not live.provider.handles and live.parent().runtime.status == "stopped"
    assert live.store.read_files(live.project["projectId"], owner_id="alice") == live.files
    eventually(lambda: not live.store.get_lease(live.project["projectId"], owner_id="alice").sandboxId)


@pytest.mark.parametrize("revoked", ["account", "plan"])
def test_revocation_during_browser_execution_cannot_commit_passed(live, monkeypatch, project_actor, revoked):
    browser, grants = install_browser(live, monkeypatch)
    browser.release.clear()
    child = verify(live)
    assert browser.entered.wait(5)
    if revoked == "account":
        actor = project_actor("alice")
        actor["is_active"] = False
    else:
        row = live.sessions.load(live.state.sessionId)
        live.sessions.save(live.state.sessionId,
            {**row.payload, "controlTranscript": row.payload["controlTranscript"][:-1]}, expected_rev=row.rev)
    snapshot = verdict(live, child)
    eventually(lambda: live.parent().status == "failed")
    assert snapshot.verification.status == "blocked"
    assert snapshot.deliveryEligible is False and not snapshot.verification.artifactRefs
    assert child in browser.cleaned and grants == ["grant-fixture"]
    assert not live.provider.handles


def test_expired_plan_before_dispatch_blocks_queued_check_without_browser_io(live, monkeypatch):
    import services.project_runtime_worker as worker
    browser, revoked = install_browser(live, monkeypatch)
    actual = worker.run_next_project_verification
    permit = threading.Event()
    monkeypatch.setattr(worker, "run_next_project_verification",
        lambda task: actual(task) if permit.is_set() else False)
    child = verify(live)
    row = live.sessions.load(live.state.sessionId)
    live.sessions.save(live.state.sessionId,
        {**row.payload, "controlTranscript": row.payload["controlTranscript"][:-1]}, expected_rev=row.rev)
    permit.set()
    snapshot = verdict(live, child)
    eventually(lambda: live.parent().status == "failed")
    assert snapshot.verification.status == "blocked" and snapshot.deliveryEligible is False
    assert not browser.calls and not revoked and not live.provider.handles


def test_changed_plan_marks_existing_pass_stale_without_rewriting_historical_record(live, monkeypatch):
    install_browser(live, monkeypatch)
    child = verify(live)
    saved = verdict(live, child)
    assert saved.verification.status == "passed"
    row = live.sessions.load(live.state.sessionId)
    live.sessions.save(live.state.sessionId,
        {**row.payload, "controlTranscript": row.payload["controlTranscript"][:-1]}, expected_rev=row.rev)
    observed = live.tools.execute("project_verification", {"operationId": child}, live.state)
    assert observed["ok"], observed
    assert observed["verification"]["status"] == "stale"
    assert observed["verification"]["deliveryEligible"] is False
    assert live.supervisor.verification_store.for_operation(child, owner_id="alice").verification.status == "passed"


def test_restart_reconciles_interrupted_browser_without_replaying_its_clicks(live, monkeypatch):
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    browser, revoked = install_browser(live, monkeypatch)
    browser.release.clear()
    original_parent = live.parent()
    cleanup_sources = []
    cleanup = browser.cleanup
    def observe_cleanup(*args, **kwargs):
        cleanup_sources.append(live.provider.contents["src/App.tsx"])
        return cleanup(*args, **kwargs)
    monkeypatch.setattr(browser, "cleanup", observe_cleanup)
    child = verify(live)
    assert browser.entered.wait(5)
    patched = live.tools.execute("project_patch", patch_args(live), live.state)
    assert patched["ok"]
    assert live.store.get_operation(patched["operationId"], owner_id="alice").status == "queued"
    live.supervisor.shutdown()
    assert live.parent().status == "interrupted"
    assert live.store.get_operation(child, owner_id="alice").status == "running"
    assert len(browser.calls) == 1 and child in browser.cleaned
    second = ProjectRuntimeSupervisor(live.store, lambda: live.provider,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=90, idle_seconds=60)
    install_browser(SimpleNamespace(supervisor=second), monkeypatch, browser)
    second.start()
    try:
        saved = verdict(live, child)
        eventually(lambda: live.store.get_operation(patched["operationId"], owner_id="alice").status == "completed")
        eventually(lambda: live.parent().status == "running" and live.parent().runtime.status == "ready")
        assert saved.verification.status == "blocked"
        assert saved.verification.errorCode == "project_browser_verification_interrupted"
        assert not saved.verification.assertions and not saved.verification.artifactRefs
        assert len(browser.calls) == 1 and browser.cleaned.count(child) >= 2
        assert cleanup_sources[:2] == [live.files["src/App.tsx"], live.files["src/App.tsx"]]
        assert live.provider.contents["src/App.tsx"] == "Updated task\n"
        assert live.parent().runtime.processId != original_parent.runtime.processId
        assert live.provider.active_server_mode == "dev"
        assert live.parent().runtime.runtimeId == original_parent.runtime.runtimeId
        assert live.parent().leaseGeneration > original_parent.leaseGeneration
        assert live.provider.created == 1
        assert live.provider.commands.count("npm run build") == 1
        assert live.provider.commands.count("npm ci --ignore-scripts") == 2
        assert revoked == ["grant-fixture"]
        second.cancel(live.started["operationId"], owner_id="alice")
        eventually(lambda: live.parent().status == "cancelled")
    finally:
        second.shutdown()


def test_restart_reconciles_saved_evidence_without_replaying_browser_or_rewriting_verdict(live, monkeypatch):
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import ProjectConflict
    browser, _ = install_browser(live, monkeypatch)
    original = live.supervisor.verification_store.reconcile_operation
    interrupted = threading.Event()

    def crash_after_record(*args, **kwargs):
        if not interrupted.is_set():
            interrupted.set()
            live.supervisor._stop.set()
            raise ProjectConflict("injected_loss_after_record_before_child_terminal")
        return original(*args, **kwargs)

    monkeypatch.setattr(live.supervisor.verification_store, "reconcile_operation", crash_after_record)
    child = verify(live)
    assert interrupted.wait(5)
    live.supervisor.shutdown()
    saved = live.supervisor.verification_store.for_operation(child, owner_id="alice")
    assert saved.verification.status == "passed"
    before = saved.verification.model_dump()
    assert live.store.get_operation(child, owner_id="alice").status == "running"
    second = ProjectRuntimeSupervisor(live.store, lambda: live.provider,
        poll_interval=0.02, lease_ttl=1, lifetime_seconds=90, idle_seconds=60)
    install_browser(SimpleNamespace(supervisor=second), monkeypatch, browser)
    second.start()
    try:
        settled = verdict(live, child)
        eventually(lambda: live.parent().runtime.status == "ready")
        assert settled.verification.model_dump() == before
        assert settled.effectiveStatus == "passed" and settled.deliveryEligible is False
        assert len(browser.calls) == 1 and browser.cleaned.count(child) >= 2
        assert live.store.get_operation(child, owner_id="alice").result["verificationId"] == before["verificationId"]
        second.cancel(live.started["operationId"], owner_id="alice")
        eventually(lambda: live.parent().status == "cancelled")
    finally:
        second.shutdown()


def test_unconfirmed_browser_cleanup_prevents_terminal_success_and_retries_cleanup(live, monkeypatch):
    allowed = threading.Event()

    class PendingCleanupBrowser(Browser):
        def cleanup(self, verification_id, check_callback=None):
            super().cleanup(verification_id, check_callback)
            return allowed.is_set()

        def run(self, **kwargs):
            result = super().run(**kwargs)
            return {**result, "cleanupConfirmed": allowed.is_set()}

    browser, _ = install_browser(live, monkeypatch, PendingCleanupBrowser())
    child = verify(live)
    eventually(lambda: live.parent().runtime.status == "reconciling")
    snapshot = live.supervisor.verification_store.for_operation(child, owner_id="alice")
    assert snapshot.verification.status == "running" and snapshot.deliveryEligible is False
    assert not snapshot.verification.artifactRefs
    assert live.store.get_operation(child, owner_id="alice").status == "running"
    assert live.provider.handles and len(browser.calls) == 1
    allowed.set()
    final = verdict(live, child)
    eventually(lambda: live.parent().status == "failed")
    assert final.verification.status == "blocked" and not final.verification.artifactRefs
    assert browser.cleaned.count(child) >= 3 and not live.provider.handles
    assert len(browser.calls) == 1


def test_model_http_loop_observes_failed_assertion_patches_source_and_verifies_new_revision(control_setup, monkeypatch):
    """Keep the actual HTTP/control/tools/SQL worker; replace only model/browser IO.

    The scripted gateway chooses a source edit after receiving the real failed
    receipt. Browser outcome derives from remote source, so flipping a test flag
    cannot manufacture a repaired verdict or hide a disconnected patch call.
    """
    from app import app
    from conftest import TEST_USER_ID
    from control_turn_support import ControlHarness, llm_text, llm_tool
    from services.project_creation import create_session_project
    from services.project_manifest import content_hash
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from test_project_live_source_sync import SyncProvider
    from services import persistence

    env = control_setup
    provider = SyncProvider()
    supervisor = ProjectRuntimeSupervisor(env.store, lambda: provider,
        poll_interval=0.02, lease_ttl=10, lifetime_seconds=60, idle_seconds=45)
    monkeypatch.setattr(app.state, "project_runtime_supervisor", supervisor, raising=False)
    env.control.project_supervisor = supervisor
    project = create_session_project(env.store, env.state.sessionId, owner_id=TEST_USER_ID, approval_ref=env.ref)
    source = env.store.read_files(project.projectId, owner_id=TEST_USER_ID)["src/main.tsx"]
    adapter = ProjectTools(env.store, supervisor, TEST_USER_ID)
    broken = adapter.execute("project_patch", {"approvalRef": env.ref, "expectedRevision": project.currentRevision,
        "changes": [{"path": "src/main.tsx", "content": source + "\n// BROKEN_COUNTER\n",
                     "expectedSha256": content_hash(source)}]}, env.state)
    assert broken["ok"], broken

    class SourceBrowser(Browser):
        def run(self, **kwargs):
            self.failed = "BROKEN_COUNTER" in provider.contents["src/main.tsx"]
            return super().run(**kwargs)

    browser, _ = install_browser(SimpleNamespace(supervisor=supervisor), monkeypatch, SourceBrowser())
    supervisor.start()
    try:
        started = supervisor.submit(project.projectId, owner_id=TEST_USER_ID,
            expected_revision=broken["revision"], approval_ref=env.ref, idempotency_key="model-browser-start")
        parent = lambda: env.store.get_operation(started.operationId, owner_id=TEST_USER_ID)
        eventually(lambda: parent().runtime and parent().runtime.status == "ready")
        original_pid = parent().runtime.processId
        harness = ControlHarness(monkeypatch)
        seen = []

        def model(messages, **kwargs):
            offered = {item["function"]["name"] for item in kwargs["tools"]}
            assert {"project_verify", "project_verification", "project_patch"} <= offered
            results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
            if not results:
                return llm_tool("project_verify", {"runtimeOperationId": started.operationId,
                    "expectedRevision": broken["revision"], "approvalRef": env.ref, "idempotencyKey": "model-before"}, "before")
            result = results[-1]
            assert result["ok"], result
            seen.append(result)
            step = len(results)
            if step in {1, 5, 7}:
                return llm_tool("project_status", {"operationId": result["operationId"], "waitSeconds": 5}, f"wait-{step}")
            if step in {2, 8}:
                assert result["verification"]["status"] == ("failed" if step == 2 else "passed")
                return llm_tool("project_verification", {"operationId": result["operationId"]}, f"evidence-{step}")
            if step == 3:
                assert result["verification"]["status"] == "failed"
                assert {"id": "counter_increment", "status": "failed", "expected": "1", "actual": "2"} in result["verification"]["assertions"]
                return llm_tool("project_read", {"path": "src/main.tsx", "offset": 0, "limit": 8000}, "read-failure")
            if step == 4:
                assert "BROKEN_COUNTER" in result["content"]
                return llm_tool("project_patch", {"approvalRef": env.ref, "expectedRevision": result["revision"],
                    "changes": [{"path": "src/main.tsx", "content": source, "expectedSha256": result["sha256"]}]}, "repair")
            if step == 6:
                assert result["status"] == "completed" and result["synchronized"] is True
                assert result["revision"] != broken["revision"]
                return llm_tool("project_verify", {"runtimeOperationId": started.operationId,
                    "expectedRevision": result["revision"], "approvalRef": env.ref, "idempotencyKey": "model-after"}, "after")
            assert step == 9 and result["verification"]["status"] == "passed"
            assert result["verification"]["deliveryEligible"] is False
            return llm_text("The repaired source passed the page/counter suite; business acceptance remains separate.")

        harness.llm_impl = model
        events = control_post(env.state)
        # ⚠ 2026-09-15：+1 是那一轮自动续跑（业务验收还没通过 → 目标未交付）。
        #   跟 test_control_project_tools 同一个处理：把续跑正面钉住，
        #   不是把数字改大了事。
        assert [(e["attempt"], e["reason"]) for e in events
                if e.get("type") == "control_continuation"] == [(1, "goal_not_delivered")]
        assert len(seen) == 10 and len(harness.llm_calls) == 11, {
            "run": {key: value for key, value in env.control.store.get(events[0]["controlRunId"], TEST_USER_ID).items()
                    if key in {"status", "error"}},
            "seen": [(item.get("tool"), item.get("status"), item.get("error")) for item in seen],
            "lastTools": [json.loads(message["content"]) for message in harness.llm_calls[-1]["messages"]
                if message["role"] == "tool"][-2:],
            "events": [{key: event[key] for key in ("type", "tool", "error", "message", "code") if key in event}
                for event in events],
        }
        assert events[-1]["type"] == "complete" and not harness.helper_calls
        assert events[-1]["state"]["projectRevision"] == parent().runtime.revision
        directory = persistence._checkpoint_dir() / persistence._safe_ckpt_token(env.state.sessionId)
        index = json.loads((directory / "index.json").read_text(encoding="utf-8"))
        checkpoint = json.loads((directory / (index["latest_id"] + ".json")).read_text(encoding="utf-8"))
        assert checkpoint["state"]["projectRevision"] == parent().runtime.revision
        assert len(browser.calls) == 2
        assert browser.calls[0]["revision"] == broken["revision"]
        assert browser.calls[1]["revision"] == parent().runtime.revision != broken["revision"]
        assert parent().runtime.processId != original_pid and provider.created == 1
        assert provider.active_server_mode == "dev" and provider.processes[original_pid] == "stopped"
        assert provider.contents["src/main.tsx"] == source
        old = supervisor.verification_store.for_operation(seen[0]["operationId"], owner_id=TEST_USER_ID)
        assert old.verification.status == "failed" and old.effectiveStatus == "stale"
        supervisor.cancel(started.operationId, owner_id=TEST_USER_ID)
        eventually(lambda: parent().status == "cancelled")
    finally:
        supervisor.shutdown()
