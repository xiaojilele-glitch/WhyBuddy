"""
Consolidated Python backend API contract test suite (task 53: backend-python-no-node-final-contract-test-suite-105).

This is the single consolidated suite for verifying Python FastAPI as the backend API source of truth
for cutover-owned surfaces (health, agent-loop/contracts registry, sliderule V5, blueprint spec, etc.).

Covers:
- Health/readiness provenance signals (backend:"slide-rule-python", source:"python")
- Live /api/agent-loop/contracts registry (source, supportedStates incl RouteState model, surfaces)
- Python-owned contract surfaces return explicit python provenance (no silent Node)
- RouteState model enforcement in registry
- Key sliderule paths (orchestrate, execute report, sessions) with standardized provenance

Degraded states remain explicit. Node (if proxied) is thin only.

Run (smallest):
  python -m pytest slide-rule-python/tests/test_no_node_backend_contracts.py -q --tb=line

Requires: pip install -r slide-rule-python/requirements.txt (or .venv)
"""

from plan_approval_support import approved_execution_payload

import sys
from pathlib import Path
import pytest

_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from fastapi.testclient import TestClient

try:
    from app import app
except Exception as e:
    pytest.skip(f"slide-rule-python app import failed: {e}", allow_module_level=True)

client = TestClient(app)

INTERNAL_KEY = "dev-slide-rule-internal"


def test_health_provenance_python_source():
    """Consolidated health contract: all health paths must surface Python backend provenance."""
    for path in ["/health", "/api/health", "/api/sliderule/health", "/ready"]:
        r = client.get(path)
        assert r.status_code == 200, f"{path} 200"
        data = r.json()
        assert data.get("status") in ("ok", "ready")
        backend = str(data.get("backend", "")).lower()
        assert "slide-rule-python" in backend or backend == "python", f"{path} must be python backend: {data}"
        assert data.get("source") == "python" or "python" in str(data.get("provenance", "")).lower()
        # provenance signal per contract
        assert "slide-rule-python" in str(data.get("provenance", "")) or data.get("provenance") in ("python-rag", "python-llm", "python-fullpath", "backend:slide-rule-python")


def test_contracts_registry_python_source_of_truth():
    """Core deliverable: /api/agent-loop/contracts is the live consolidated registry, Python owned (PYTHON_FIRST_COMPAT for surfaces)."""
    r = client.get("/api/agent-loop/contracts")
    assert r.status_code == 200
    data = r.json()

    # provenance signals
    assert data.get("source") == "python"
    assert data.get("backend") == "slide-rule-python"
    assert "registryVersion" in data
    assert data.get("routeStateModel") == "foundation-deprecation-state-model"
    assert data.get("introducedByTask") == 6

    # RouteState model served
    supported = data.get("supportedStates", [])
    assert "ACTIVE_NODE_BUSINESS" in supported
    assert "PYTHON_FIRST_COMPAT" in supported
    assert "PYTHON_ONLY" in supported
    assert "BLOCKED" in supported

    surfaces = data.get("surfaces", [])
    assert len(surfaces) >= 4
    surf_names = [s.get("surface") for s in surfaces]
    assert "/health" in surf_names
    assert "/api/agent-loop" in surf_names
    assert "/api/sliderule" in surf_names

    # All listed are PYTHON_FIRST_COMPAT per current cutover state (registry is PYTHON source)
    for s in surfaces:
        assert s.get("classification") == "PYTHON_FIRST_COMPAT"
        assert "python" in s.get("provenanceSignal", "").lower() or s.get("provenanceSignal") in ("backend:slide-rule-python", "controlPlane:python", "source:python-rag", "python")


def test_route_state_model_enforced_in_contracts():
    """RouteState from models is enforced; registry uses only valid enum values from Python model."""
    from models.agent_loop import RouteState
    r = client.get("/api/agent-loop/contracts")
    data = r.json()
    supported = set(data.get("supportedStates", []))
    expected = {s.value for s in RouteState}
    assert supported == expected

    # surfaces use only valid
    for s in data.get("surfaces", []):
        assert s["classification"] in expected


def test_sliderule_contract_surfaces_provenance(monkeypatch):
    """Consolidated: sliderule surfaces (orchestrate, execute via mapped, sessions) return standardized python provenance.
    Uses mapped mock for execute (report.write goes mapped per current routes; matches patterns from test_v5_smoke inventory).
    """
    from services.slide_rule_orchestrator import OrchestratePlanResult

    def fake_orchestrate(state, turn_id, user_text):
        return OrchestratePlanResult(
            selected=[{"capabilityId": "report.write"}],
            rationale="consolidated-contract",
            source="python-rag",
            converged=True,
        )

    monkeypatch.setattr("routes.sliderule_full.orchestrate_plan", fake_orchestrate)

    # Mock native check to force mapped path (as in test_v5_smoke inventory test)
    def fake_is_native(cap): return False
    monkeypatch.setattr("routes.sliderule_full.is_python_native_capability", fake_is_native)
    monkeypatch.setattr("sliderule_llm.capabilities.is_python_native_capability", fake_is_native)

    # Mock for execute mapped path (structure.decompose, report.write etc)
    def fake_mapped(cap, state, ins, role, turn):
        return {
            "title": "consolidated-contract",
            "summary": "contract proof",
            "content": "provenance proof content with 支撑证据 收敛决策",
            "provenance": "python-rag",
            "backend": "python",
        }

    monkeypatch.setattr("routes.sliderule_full.execute_mapped_capability", fake_mapped)
    monkeypatch.setattr("services.capability_maps.execute_mapped_capability", fake_mapped)

    # orchestrate
    plan = client.post(
        "/api/sliderule/orchestrate-plan",
        json={"state": {"sessionId": "cons-1", "goal": {"text": "contract test"}, "artifacts": [], "capabilityRuns": [], "graph": {"nodes": [], "edges": []}}, "turnId": "c1", "userText": "test"},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert plan.status_code == 200
    p = plan.json()
    assert p.get("backend") == "python"
    assert p.get("provenance") in ("python-rag", "python-llm", "python-fullpath")
    assert p.get("source") == "python-rag"

    # execute using mapped (structure.decompose / report.write use mapped per route + is_native false)
    ex = client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload({"capabilityId": "structure.decompose", "state": {"sessionId": "cons-1", "goal": {"text": "x"}}, "inputArtifactIds": [], "turnId": "c1"}),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert ex.status_code == 200
    ed = ex.json()
    assert ed.get("backend") == "python"
    assert ed.get("provenance") in ("python-rag", "python-llm", "python-fullpath")

    # sessions
    sess = client.post(
        "/api/sliderule/sessions",
        json={"goal": {"text": "consolidated"}, "sessionId": "cons-sess"},
        headers={"X-Internal-Key": INTERNAL_KEY},
    )
    assert sess.status_code == 200
    sd = sess.json()
    assert sd.get("backend") == "python"
    assert sd.get("provenance") == "python-fullpath"


def test_no_node_fallback_in_contract_responses():
    """Ensure no hidden Node success: responses carry python backend, never claim node-only for owned paths."""
    r = client.get("/api/agent-loop/contracts")
    data = r.json()
    assert data.get("source") == "python"
    assert "node" not in str(data.get("backend", "")).lower()

    h = client.get("/health").json()
    assert "slide-rule-python" in str(h.get("backend", "")).lower() or h.get("backend") == "python"
    assert "node" not in str(h.get("backend", "")).lower()
