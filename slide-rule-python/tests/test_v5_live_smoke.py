"""
Safe live-smoke style tests for the Python SlideRule service.

These use FastAPI TestClient against the real /api/sliderule route surface, but
monkeypatch the LLM callers so the suite never needs real external LLM keys.
"""

from plan_approval_support import approved_execution_payload

from fastapi.testclient import TestClient
import pytest

try:
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

from sliderule_llm.client import LlmResult  # noqa: E402


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


def _post_execute(capability_id: str, *, state: dict, turn_id: str, user_text: str = ""):
    return client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload({
            "capabilityId": capability_id,
            "state": state,
            "inputArtifactIds": [],
            "roleId": "agent",
            "turnId": turn_id,
            "userText": user_text,
        }),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )


def test_health_path_is_available():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "python" in data.get("backend", "").lower()


def test_dialogue_live_smoke_uses_python_llm_shape(monkeypatch):
    def fake_call_llm(messages, **kwargs):
        joined = "\n".join(message["content"] for message in messages)
        assert "pet office onboarding" in joined
        return LlmResult(
            content=(
                "## Restated goal\n"
                "- Clarify pet office onboarding decisions.\n"
                "## Open questions\n"
                "- Which first desk state should unlock task assignment?"
            ),
            usage={"total_tokens": 21},
            finish_reason="stop",
            model="fake-live-dialogue",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_call_llm)

    response = _post_execute(
        "intent.clarify",
        state=_state("live-dialogue", "clarify pet office onboarding"),
        turn_id="live-dialogue",
        user_text="clarify the first screen",
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["provenance"] == "python-llm"
    assert data["model"] == "fake-live-dialogue"
    assert "pet office onboarding" in data["content"]


def test_report_live_smoke_uses_python_json_llm_shape(monkeypatch):
    def fake_call_llm_json_with_shape(messages, **kwargs):
        content = "\n".join(
            [
                "结论：pet office report is feasible",
                "支撑证据：desk assignment smoke evidence",
                "反证/挑战：onboarding depth is still thin",
                "风险：progression may feel grindy",
                "分歧：first milestone scope unresolved",
                "收敛决策：prototype the first desk loop",
                "未解缺口：retention benchmark missing",
                "下一步工程化分支：ship one measurable onboarding slice",
                "provenance / upstream refs：live-smoke-fake-llm",
            ]
        )
        return (
            {
                "title": "Feasibility report",
                "summary": "pet office report smoke",
                "content": content,
            },
            LlmResult(
                content="{}",
                usage={"total_tokens": 90},
                finish_reason="stop",
                model="fake-live-report",
                latency_ms=1,
            ),
        )

    monkeypatch.setattr(
        "sliderule_llm.capabilities.call_llm_json_with_shape",
        fake_call_llm_json_with_shape,
    )

    response = _post_execute(
        "report.write",
        state=_state("live-report", "write pet office feasibility report"),
        turn_id="live-report",
        user_text="write the report",
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["provenance"] == "python-llm"
    assert data["model"] == "fake-live-report"
    assert "支撑证据" in data["content"]
    assert "provenance" in data["content"].lower()


def test_handoff_live_smoke_uses_python_llm_shape(monkeypatch):
    def fake_call_llm(messages, **kwargs):
        joined = "\n".join(message["content"] for message in messages)
        assert "handoff pet office delivery" in joined
        return LlmResult(
            content=(
                "## Report bundle\n"
                "- report.md captures the delivery decision.\n"
                "## Traceability matrix bundle\n"
                "- matrix links requirement, evidence, risk, and decision.\n"
                "## Prompt pack bundle\n"
                "- prompt pack includes operator and verification prompts.\n"
                "## Visual preview bundle\n"
                "- visual preview includes provenance notes.\n"
                "## Risk bundle\n"
                "- risk: onboarding may feel grindy.\n"
                "## Next steps\n"
                "- assign owner and rerun gate."
            ),
            usage={"total_tokens": 55},
            finish_reason="stop",
            model="fake-live-handoff",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_call_llm)

    response = _post_execute(
        "handoff.package",
        state=_state("live-handoff", "handoff pet office delivery"),
        turn_id="live-handoff",
        user_text="package the handoff",
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["provenance"] == "python-llm"
    assert data["model"] == "fake-live-handoff"
    assert "Report bundle" in data["content"]
    assert "Next steps" in data["content"]
