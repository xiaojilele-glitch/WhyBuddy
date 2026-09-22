"""Rollout closes spending while preserving owned source, logs and stop commands.

Exercise the HTTP commands and real durable operation, not just a boolean gate.
Static readiness intentionally makes no network/production success claim.
"""

import pytest

from services import project_rollout as rollout
from services.project_access import project_access_enabled
from test_project_runtime_route import setup
from project_actor_support import project_actor


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "allowlist")
    monkeypatch.setenv("WHYBUDDY_PROJECT_ALLOWED_USERS", "u1,u2")
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setattr(rollout.settings, "NODE_ENV", "production")
    monkeypatch.setattr(rollout.settings, "APP_STORE_DATABASE_URL", "postgresql://test.invalid/project")
    monkeypatch.setattr(rollout.settings, "APP_STORE_HTTP_API_URL", "")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.test")
    monkeypatch.setenv("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", "https://workbench.test")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "x" * 32)
    monkeypatch.setenv("E2B_API_KEY", "test-presence-only")
    monkeypatch.setenv("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "test-browser-template")


def test_allowlist_requires_current_member_even_for_administrator(configured):
    assert project_access_enabled({"id": "u1", "is_superuser": False})
    assert not project_access_enabled({"id": "administrator", "is_superuser": True})
    assert not project_access_enabled(None)
    report = rollout.rollout_readiness()
    assert report["configured"] and report["configurationOnly"]
    assert "test-presence-only" not in str(report)


@pytest.mark.parametrize("key,value,blocker", [
    ("WHYBUDDY_PROJECT_ALLOWED_USERS", "", "project_rollout_users_missing"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "http://{runtimeId}.preview.test", "project_private_preview_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://prefix-{runtimeId}.preview.test", "project_private_preview_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.workbench.test", "project_preview_origin_isolation_required"),
    ("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", "https://workbench.test/path", "project_workbench_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "short", "project_preview_gateway_key_required"),
    ("E2B_API_KEY", "", "project_sandbox_not_configured"),
    ("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "", "project_browser_not_configured"),
])
def test_missing_or_unsafe_deployment_config_cannot_open_execution(configured, monkeypatch, key, value, blocker):
    monkeypatch.setenv(key, value)
    assert blocker in rollout.rollout_readiness()["blockers"]
    assert not project_access_enabled({"id": "u1", "is_superuser": True})


def test_allowlist_rejects_ephemeral_storage_and_internal_production(configured, monkeypatch):
    monkeypatch.setattr(rollout.settings, "APP_STORE_DATABASE_URL", "sqlite:///local.db")
    assert "project_durable_database_required" in rollout.rollout_readiness()["blockers"]
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "internal")
    assert "project_internal_mode_not_for_production" in rollout.rollout_readiness()["blockers"]


def test_rollback_keeps_owner_observation_and_cancel_but_rejects_new_work(setup, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "internal")
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 202
    operation = response.json()["operation"]["operationId"]
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    capabilities = setup.client.get("/project-capabilities").json()
    assert not capabilities["canExecute"] and capabilities["canReadOwnedProjects"]
    assert setup.client.get("/sessions/s1/project").json()["project"]["projectId"] == setup.project.projectId
    assert setup.client.get(f"/project-operations/{operation}").status_code == 200
    assert setup.client.get(f"/project-operations/{operation}/events").status_code == 200
    assert setup.client.get(f"/projects/{setup.project.projectId}/verification").status_code == 200
    assert setup.client.post(setup.url, json={**setup.body, "idempotencyKey": "blocked"}).status_code == 503
    assert setup.client.post(f"/project-operations/{operation}/touch").status_code == 503
    assert setup.client.post(f"/project-operations/{operation}/cancel").json()["operation"]["cancelRequested"]
    setup.viewer["id"] = "mallory"
    assert setup.client.get(f"/project-operations/{operation}").status_code == 404
    assert setup.client.post(f"/project-operations/{operation}/cancel").status_code == 404
    assert not setup.called


def test_cleanup_worker_can_start_during_rollback_without_enabling_actor(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    monkeypatch.setenv("WHYBUDDY_PROJECT_CLEANUP_ENABLED", "1")
    assert rollout.project_worker_enabled()
    assert not project_access_enabled({"id": "u1", "is_superuser": True})
