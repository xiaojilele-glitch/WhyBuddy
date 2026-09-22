"""Runtime provenance contract: retrieved / fallback / generated / degraded stay honest."""

from plan_approval_support import approved_execution_payload
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.evidence import (  # noqa: E402
    DEGRADED_PROVENANCE,
    EVIDENCE_RUNTIME_PROVENANCE,
    FALLBACK_PROVENANCE,
    GENERATED_PROVENANCE,
    RETRIEVED_PROVENANCE,
    EvidenceRetriever,
    degraded_evidence,
    fallback_evidence,
    generated_sources_from_content,
)
from sliderule_llm.vector import QdrantVectorClient, VectorClientUnavailable, VectorConfig  # noqa: E402


class FakeEmbeddingProvider:
    def __init__(self, vector=None, error=None):
        self.vector = vector or [0.1, 0.2]
        self.error = error

    def embed_query(self, text):
        if self.error:
            raise self.error
        assert text
        return self.vector


class FakeTransport:
    def __init__(self, response=None, error=None):
        self.response = response or {}
        self.error = error

    def __call__(self, method, url, body, headers, timeout_ms):
        if self.error:
            raise self.error
        return self.response


def make_vector_client(response=None, error=None):
    return QdrantVectorClient(
        VectorConfig("http://qdrant.test", "knowledge", "", 1000, 2),
        transport=FakeTransport(response=response, error=error),
    )


def test_runtime_provenance_values_are_explicit_and_disjoint():
    assert EVIDENCE_RUNTIME_PROVENANCE == {
        RETRIEVED_PROVENANCE,
        FALLBACK_PROVENANCE,
        GENERATED_PROVENANCE,
        DEGRADED_PROVENANCE,
    }


def test_retrieved_runtime_provenance_keeps_vector_fields():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client(
            {
                "result": [
                    {
                        "id": "chunk-runtime",
                        "score": 0.95,
                        "payload": {
                            "content": "runtime retrieved evidence",
                            "sourceId": "doc-runtime",
                            "title": "Runtime fixture",
                        },
                    }
                ]
            }
        ),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("runtime retrieved query")

    assert result.provenance == RETRIEVED_PROVENANCE
    assert result.fallback_reason is None
    assert result.error is None
    payload = result.to_payload_fields()
    assert payload["evidenceProvenance"] == RETRIEVED_PROVENANCE
    assert payload["sources"][0]["provenance"] == RETRIEVED_PROVENANCE
    assert payload["sources"][0]["sourceId"] == "doc-runtime"
    assert "fallbackReason" not in payload
    assert "error" not in payload


def test_fallback_runtime_provenance_is_not_retrieved():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client({"result": []}),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("no hits")

    assert result.provenance == FALLBACK_PROVENANCE
    assert result.fallback_reason == "no_retrieval_hits"
    assert result.error is None
    payload = result.to_payload_fields()
    assert payload["evidenceProvenance"] == FALLBACK_PROVENANCE
    assert payload["fallbackReason"] == "no_retrieval_hits"
    assert payload["sources"][0]["provenance"] == FALLBACK_PROVENANCE
    assert payload["evidenceProvenance"] != RETRIEVED_PROVENANCE


def test_vector_unavailable_stays_fallback_not_degraded():
    retriever = EvidenceRetriever(
        vector_client=make_vector_client(error=VectorClientUnavailable("down")),
        embedding_provider=FakeEmbeddingProvider(),
    )

    result = retriever.retrieve("query")

    assert result.provenance == FALLBACK_PROVENANCE
    assert result.fallback_reason == "vector_unavailable:VectorClientUnavailable"
    assert result.error is None
    assert result.sources


def test_generated_runtime_provenance_is_not_retrieved():
    sources = generated_sources_from_content(
        "## Grounding references\n- generated planning reference from model prose"
    )

    assert sources[0].provenance == GENERATED_PROVENANCE
    assert sources[0].fallback_reason == "llm_prose_only"
    source_dict = sources[0].to_dict()
    assert source_dict["provenance"] == GENERATED_PROVENANCE
    assert source_dict["fallbackReason"] == "llm_prose_only"
    assert "sourceId" not in source_dict
    assert source_dict["provenance"] != RETRIEVED_PROVENANCE


def test_degraded_runtime_provenance_has_error_and_no_fake_sources():
    result = degraded_evidence(
        "desk progression",
        error="retrieval_runtime_failed",
        reason="embedding_timeout",
    )

    assert result.provenance == DEGRADED_PROVENANCE
    assert result.error == "retrieval_runtime_failed"
    assert result.fallback_reason == "embedding_timeout; query=desk progression"
    assert result.sources == []
    payload = result.to_payload_fields()
    assert payload["evidenceProvenance"] == DEGRADED_PROVENANCE
    assert payload["error"] == "retrieval_runtime_failed"
    assert payload["fallbackReason"] == "embedding_timeout; query=desk progression"
    assert payload["sources"] == []
    assert payload["evidenceProvenance"] != RETRIEVED_PROVENANCE
    assert payload["evidenceProvenance"] != FALLBACK_PROVENANCE


def test_fallback_evidence_is_not_degraded():
    result = fallback_evidence("desk progression", reason="no_retrieval_hits")

    assert result.provenance == FALLBACK_PROVENANCE
    assert result.error is None
    assert result.sources
    assert result.provenance != DEGRADED_PROVENANCE


# --- FastAPI route payload ownership tests (Python-owned evidence+source provenance) ---
# These prove that slide-rule-python/routes/sliderule_full (mounted in app) returns
# result payloads carrying "backend":"python", top-level provenance (python-*), and
# the runtime evidenceProvenance / sources[].provenance from the evidence contract.
# This directly addresses review: gate must exercise pytest proving route-level signal.

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    FastAPI = None  # type: ignore
    TestClient = None  # type: ignore

INTERNAL_KEY = "dev-slide-rule-internal"


def _make_full_client():
    if FastAPI is None or TestClient is None:
        raise RuntimeError("fastapi not available for route test")
    app = FastAPI()
    # import here to use the edited full router which wires execute_evidence_runtime
    from routes.sliderule_full import router as full_router  # noqa: E402
    app.include_router(full_router, prefix="/api/sliderule")
    # 2026-08-14 权限批量修后 /execute-capability 要登录。conftest 的默认
    # 登录覆盖只装在全局 app 上，这里是自建的裸 app——照 conftest._TestUser
    # 装同一份（这条测的是 provenance 载荷，不是鉴权；鉴权在
    # test_auth_hardening_batch 里专测）。
    from middlewares.current_user import optional_user  # noqa: E402
    from conftest import _TestUser  # noqa: E402

    app.dependency_overrides[optional_user] = lambda: _TestUser()
    return TestClient(app, raise_server_exceptions=False)


def _evidence_search_payload() -> dict:
    return {
        "capabilityId": "evidence.search",
        "state": {
            "sessionId": "prov-route-105",
            "goal": {"text": "table progression pacing evidence"},
            "artifacts": [],
            "capabilityRuns": [],
        },
        "inputArtifactIds": [],
        "roleId": "grounding",
        "turnId": "prov-105",
        "userText": "ground the pacing",
    }


def _post_evidence_route(client):
    return client.post(
        "/api/sliderule/execute-capability",
        json=approved_execution_payload(_evidence_search_payload()),
        headers={"X-Internal-Key": INTERNAL_KEY},
    )


def test_route_payload_exposes_python_backend_and_provenance(monkeypatch):
    """Python FastAPI route for evidence.search returns explicit python provenance signals."""
    from sliderule_llm.client import LlmResult  # noqa: E402

    def fake_llm(messages, **kwargs):
        return LlmResult(
            content="## Grounding references\n- runtime evidence note\n## Why\n- proves ownership\n## Gaps\n- n/a",
            usage={"total_tokens": 11},
            finish_reason="stop",
            model="prov-test-llm",
            latency_ms=1,
        )

    def retrieved_ev(q):
        from sliderule_llm.evidence import EvidenceRetrievalResult, EvidenceSource  # noqa: E402
        return EvidenceRetrievalResult(
            sources=[EvidenceSource(title="Pacing note", snippet="evidence from tests", provenance=RETRIEVED_PROVENANCE, source_id="doc-prov", score=0.91)],
            provenance=RETRIEVED_PROVENANCE,
        )

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr("routes.sliderule_full.execute_evidence_runtime", retrieved_ev)

    client = _make_full_client()
    resp = _post_evidence_route(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Python owns the result payload
    assert body.get("backend") == "python"
    assert body.get("provenance") in ("python-llm", "python-rag")
    # Evidence and source provenance from runtime contract exposed
    assert body.get("evidenceProvenance") == RETRIEVED_PROVENANCE
    assert body["sources"][0]["provenance"] == RETRIEVED_PROVENANCE
    assert body["sources"][0].get("sourceId") == "doc-prov"
    assert "model" in body


def test_route_payload_exposes_fallback_provenance(monkeypatch):
    from sliderule_llm.client import LlmResult  # noqa: E402

    def fake_llm(messages, **kwargs):
        return LlmResult(content="fallback note", usage={}, finish_reason="stop", model="f", latency_ms=0)

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr(
        "routes.sliderule_full.execute_evidence_runtime",
        lambda q: fallback_evidence(q, reason="no_retrieval_hits"),
    )

    client = _make_full_client()
    resp = _post_evidence_route(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("backend") == "python"
    assert body.get("evidenceProvenance") == FALLBACK_PROVENANCE
    assert body["sources"][0]["provenance"] == FALLBACK_PROVENANCE
    assert body.get("fallbackReason") == "no_retrieval_hits"
    assert body["evidenceProvenance"] != RETRIEVED_PROVENANCE


def test_route_payload_exposes_degraded_provenance(monkeypatch):
    from sliderule_llm.client import LlmResult  # noqa: E402

    def fake_llm(messages, **kwargs):
        return LlmResult(content="deg note", usage={}, finish_reason="stop", model="d", latency_ms=0)

    monkeypatch.setattr("sliderule_llm.capabilities.call_llm_with_retry", fake_llm)
    monkeypatch.setattr(
        "routes.sliderule_full.execute_evidence_runtime",
        lambda q: degraded_evidence(q, error="retrieval_runtime_failed", reason="timeout"),
    )

    client = _make_full_client()
    resp = _post_evidence_route(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("backend") == "python"
    assert body.get("evidenceProvenance") == DEGRADED_PROVENANCE
    assert body.get("error") == "retrieval_runtime_failed"
    assert body["sources"] == []
    assert body["evidenceProvenance"] != RETRIEVED_PROVENANCE
    assert body["evidenceProvenance"] != FALLBACK_PROVENANCE
