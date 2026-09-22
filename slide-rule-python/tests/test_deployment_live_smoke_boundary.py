"""Deployment/live-smoke boundary tests for the Python SlideRule service.

These tests stay inside FastAPI TestClient and mocked runtime failures. They do
not call a real LLM, external agent, vector database, or production service.
"""

from plan_approval_support import approved_execution_payload

import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

from config.settings import Settings  # noqa: E402
from sliderule_llm.client import LlmError  # noqa: E402


client = TestClient(app)
INTERNAL_KEY = "dev-slide-rule-internal"


def _state(session_id: str, goal: str) -> dict:
    return {
        "sessionId": session_id,
        "goal": {"text": goal},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": None,
    }


def test_python_health_exposes_deployment_boundary_without_secrets():
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["backend"] == "slide-rule-python"
    assert body["migration"] == "v5-baseline"
    assert "PYTHON_SLIDE_RULE" in body["note"]
    assert INTERNAL_KEY not in response.text


def test_runtime_config_reads_required_live_smoke_env_without_external_services(monkeypatch):
    monkeypatch.setenv("PORT", "9717")
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("SLIDE_RULE_INTERNAL_KEY", "deployment-smoke-key")
    monkeypatch.setenv("QDRANT_URL", "http://qdrant.deployment.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "qdrant-secret")
    monkeypatch.setenv("LLM_API_KEY", "llm-secret")
    monkeypatch.setenv("DB_PASSWORD", "db-secret")

    settings = Settings(_env_file=None)

    assert settings.PORT == 9717
    assert settings.NODE_ENV == "production"
    assert settings.is_development is False
    assert settings.SLIDE_RULE_INTERNAL_KEY == "deployment-smoke-key"
    assert settings.QDRANT_URL == "http://qdrant.deployment.test:6333"
    assert settings.QDRANT_API_KEY == "qdrant-secret"
    assert settings.LLM_API_KEY == "llm-secret"
    assert settings.DATABASE_URL.endswith("@localhost:3306/cube_pets_office?charset=utf8mb4")


def test_wrong_internal_key_is_visible_before_any_llm_or_agent_call():
    response = client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload({
            "capabilityId": "intent.clarify",
            "state": _state("deployment-wrong-key", "clarify deployment smoke"),
            "inputArtifactIds": [],
            "roleId": "agent",
            "turnId": "deployment-wrong-key",
            "userText": "clarify deployment smoke",
        }),
        headers={"X-Internal-Key": "wrong-key"},
    )

    assert response.status_code == 403
    assert "Invalid key" in response.text


def test_config_missing_live_smoke_returns_explicit_failure_without_fallback_success(monkeypatch):
    def fail_without_provider(*_args, **_kwargs):
        raise LlmError("LLM not configured (no provider chain)", transient=False)

    monkeypatch.setattr(
        "sliderule_llm.capabilities.call_llm_with_retry",
        fail_without_provider,
    )

    response = client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload({
            "capabilityId": "intent.clarify",
            "state": _state("deployment-config-missing", "clarify deployment smoke"),
            "inputArtifactIds": [],
            "roleId": "agent",
            "turnId": "deployment-config-missing",
            "userText": "clarify deployment smoke",
        }),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 502
    assert "python LLM failed for intent.clarify" in response.text
    assert "not configured" in response.text


def test_orchestrate_timeout_is_degraded_and_visible_without_external_side_effects(monkeypatch):
    def slow_planner(*_args, **_kwargs):
        time.sleep(0.05)
        raise AssertionError("planner should time out before returning")

    monkeypatch.setenv("SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS", "1")
    monkeypatch.setattr("routes.sliderule_full.orchestrate_plan", slow_planner)

    response = client.post(
        "/api/sliderule/orchestrate-plan",
        json={
            "state": _state("deployment-timeout", "plan deployment smoke"),
            "turnId": "deployment-timeout",
            "userText": "plan deployment smoke",
        },
        headers={"X-Internal-Key": INTERNAL_KEY},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["degraded"] is True
    assert body["error"] == "planner_timeout"
    assert body["reason"] == "timeout"
    assert body["fallbackAvailable"] is False
