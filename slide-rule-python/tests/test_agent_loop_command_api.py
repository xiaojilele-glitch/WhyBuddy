"""
SlideRule AgentLoop 108: command API.

Exposes Python-owned endpoints over the Node bridge for queue, task, rerun, cancel.
"""

from plan_approval_support import approved_execution_payload

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_command_api_real_queue_start_returns_background_receipt(monkeypatch):
    """Real queue starts are background submissions, not blocking subprocess waits."""
    from models.agent_loop import AgentLoopCommandReceipt  # noqa: WPS433
    from routes import agent_loop as agent_loop_route  # noqa: WPS433

    def fake_start(req):
        return AgentLoopCommandReceipt(
            command="node run-queue.mjs",
            status="started",
            runId="bridge-2026-06-27T00-00-00-000Z",
            pid=12345,
            exitCode=None,
            startedAt="2026-06-27T00:00:00.000Z",
            metadata={"background": True},
        )

    def fail_sync(*_args, **_kwargs):
        raise AssertionError("real queue run must not call blocking execute_agent_loop_command")

    monkeypatch.setattr(agent_loop_route, "start_agent_loop_background_command", fake_start)
    monkeypatch.setattr(agent_loop_route, "execute_agent_loop_command", fail_sync)

    resp = client.post(
        "/api/agent-loop/queue/run",
        json={"queue": "agent-loop/scripts/migration-queue.json", "mode": "queue", "dryRun": False},
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "started"
    assert data["runId"] == "bridge-2026-06-27T00-00-00-000Z"
    assert data["pid"] == 12345
    assert data["exitCode"] is None
    assert data["metadata"]["background"] is True


def test_agentloop_command_api_108_starts_queue_through_bridge_dry_run():
    """agentloop command api 108 starts queue through bridge dry run

    - Starts queue run through bridge using dry-run (no worker started)
    - Returns the exact redacted command that would be executed
    - Validates task ids, queue paths, and mode values (400 on bad)
    - Cancel returns explicit queued-cancel/unsupported placeholder (no pretend success)
    """
    # basic queue dry-run start
    resp = client.post(
        "/api/agent-loop/queue/run",
        json={
            "task": "agent-loop/tasks/sliderule-agentloop-command-api-108.md",
            "mode": "queue",
            "dryRun": True,
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, dict)
    assert "command" in data
    cmd = data["command"] or ""
    assert "node" in cmd
    assert "run-queue.mjs" in cmd or "run-queue" in cmd
    # exact redacted form: contains the script path
    assert "--only" in cmd or "command-api-108" in cmd
    # dry run markers
    assert data.get("exitCode") is None
    meta = data.get("metadata") or {}
    assert meta.get("dryRun") is True or meta.get("wouldExecute") is False or "dry" in str(meta).lower()

    # single task run dry
    resp_s = client.post(
        "/api/agent-loop/task/run",
        json={"task": "agent-loop/tasks/sliderule-agentloop-command-api-108.md", "dryRun": True, "mode": "single"},
    )
    assert resp_s.status_code == 200, resp_s.text
    assert "node" in (resp_s.json().get("command") or "")

    # rerun
    resp_r = client.post(
        "/api/agent-loop/rerun",
        json={"task": "agent-loop/tasks/sliderule-agentloop-command-api-108.md", "dryRun": True},
    )
    assert resp_r.status_code == 200

    # queue path validation + use
    resp_qp = client.post(
        "/api/agent-loop/queue/run",
        json={"queue": "agent-loop/scripts/sliderule-v2-hardening-115-queue.json", "dryRun": True},
    )
    assert resp_qp.status_code == 200
    queue_cmd = resp_qp.json().get("command") or ""
    assert "run-queue.mjs" in queue_cmd
    assert "--queue" in queue_cmd
    assert "sliderule-v2-hardening-115-queue.json" in queue_cmd

    # task id validation
    bad_task = client.post("/api/agent-loop/queue/run", json={"task": "", "dryRun": True})
    assert bad_task.status_code in (400, 422)

    # queue path validation (invalid)
    bad_q = client.post("/api/agent-loop/queue/run", json={"queue": "../evil.json", "dryRun": True})
    assert bad_q.status_code in (400, 422)

    # mode validation
    bad_m = client.post("/api/agent-loop/queue/run", json={"mode": "invalid-mode-xyz", "dryRun": True})
    assert bad_m.status_code in (400, 422)

    # cancel placeholder (explicit, not pretending)
    c = client.post("/api/agent-loop/cancel", json={"task": "foo"})
    assert c.status_code == 200
    cj = c.json()
    assert "queued-cancel" in str(cj.get("status", "")) or "cancel" in str(cj).lower()
    # do not claim success execution
    assert cj.get("exitCode") is None
    assert "unsupported" in str(cj).lower() or "placeholder" in str(cj).lower() or "queued-cancel" in str(cj.get("status", ""))

    # do not return raw env (test that key not present in top level)
    assert "env" not in data


def test_agentloop_dashboard_python_endpoints_health_overview_settings_105(monkeypatch):
    """105: Python-owned dashboard endpoints (health/runs/overview/queue/overview/settings/provider-health) must expose Python backend provenance.
    Node will thin-proxy; Python path exercised directly; degraded states visible (no silent Node wrap).
    """
    # health provenance
    r = client.get("/api/agent-loop/health")
    assert r.status_code == 200
    h = r.json()
    assert h.get("backend") == "sliderule-python"
    assert h.get("mode") == "bridge" or h.get("status") == "ok"

    # runs overview for dashboard load
    ro = client.get("/api/agent-loop/runs/overview")
    assert ro.status_code == 200
    assert isinstance(ro.json(), list)

    # queue overview
    qo = client.get("/api/agent-loop/queue/overview")
    assert qo.status_code == 200

    # settings status
    st = client.get("/api/agent-loop/settings")
    assert st.status_code == 200
    ss = st.json()
    assert "effective" in ss or "keys" in ss or ss.get("loaded") is True

    # provider health for provenance display
    ph = client.get("/api/agent-loop/provider-health")
    assert ph.status_code == 200
    phj = ph.json()
    assert "providers" in phj or "checkedAt" in phj

    # 105: real Python-owned degraded/502 envelope via TestClient endpoint + service func (no placeholder)
    # exercises /orchestrate-plan degraded path (via wait_for timeout) and execute-capability 502 for frontend normalize + retry
    import asyncio
    import routes.sliderule_full as sr  # mounted /api/sliderule surface (app.py includes sliderule_full_router)
    from sliderule_llm.client import LlmError

    # service func that produces the exact envelope shape used in orchestrate degrade
    env = sr._degraded_plan("planner_timeout", "timeout", "Python orchestrate.plan timed out before producing a plan.")
    assert env.get("degraded") is True
    assert env.get("error") == "planner_timeout"
    assert "timeout" in str(env.get("reason", ""))

    # TestClient call exercising real python _run_orchestrate_plan -> _degraded_plan path (force timeout inside)
    def force_timeout(*a, **k):
        raise asyncio.TimeoutError()
    monkeypatch.setattr(asyncio, "wait_for", force_timeout)
    r_deg = client.post(
        "/api/sliderule/orchestrate-plan",
        json={"state": {"sessionId": "s105", "goal": {}}, "turnId": "t105"},
        headers={"x-internal-key": "dev-slide-rule-internal"},
    )
    assert r_deg.status_code == 200
    dj = r_deg.json()
    assert dj.get("degraded") is True
    assert "planner_timeout" in str(dj.get("error", "")) or "timeout" in str(dj.get("reason", ""))

    # real TestClient + python path for 502 LLM fail (python native cap)
    # restore asyncio.wait_for first: sliderule_full's execute-capability also wraps the native
    # execute in wait_for, and a forced TimeoutError would return the degraded 200 envelope
    # (execute_timeout) instead of exercising the LlmError -> 502 contract.
    monkeypatch.undo()

    def raise_llm_fail(payload, **_kwargs):
        raise LlmError("python LLM failed for evidence.search")
    monkeypatch.setattr(sr, "is_python_native_capability", lambda cap: True)
    monkeypatch.setattr(sr, "execute_capability", raise_llm_fail)
    # avoid hitting the real evidence retrieval runtime before the forced LLM failure
    monkeypatch.setattr(sr, "execute_evidence_runtime", lambda _q: None)
    r502 = client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload({
            "capabilityId": "evidence.search",
            "state": {"sessionId": "s105", "goal": {}, "turns": []},
            "turnId": "t105",
            "inputArtifactIds": [],
        }),
        headers={"x-internal-key": "dev-slide-rule-internal"},
    )
    assert r502.status_code == 502
    assert "python LLM failed" in r502.text
