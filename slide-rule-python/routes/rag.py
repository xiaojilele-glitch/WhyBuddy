"""
RAG query/search API router for Python backend cutover (task 37).

Exposes /api/rag/search and /api/rag/ingest (and batch) so that Node's
server/routes/rag.ts delegate can prefer Python as the source of truth
for RAG query/search behavior.

Classification: PYTHON_FIRST_COMPAT for query/search.
Node route becomes explicit thin proxy/compat shell (delegate drives; fallback only on connect/404).
Python responses include provenance signals for verification.

Uses rag_service for the search impl (keyword baseline consistent with other python-rag).
"""

from fastapi import APIRouter, HTTPException
from typing import Any, Dict, List, Optional

from services.rag_service import (
    rag_query_search,
    rag_ingest_contract,
    RAG_QUERY_PROVENANCE,
    RAG_QUERY_BACKEND,
)

from fastapi import Depends

from middlewares.auth import verify_internal_key

# ── 谁能调这些接口（2026-08-04 补）────────────────────────────────
#
# 这个路由此前**两种守卫都没有**。它跟 agent_loop 不同：浏览器和 Node 都没有
# 任何调用点（全仓搜过 `/api/rag/`，只有测试和 Python 内部 service 引用），
# 它是 Node 那套 `/api/rag/search` 被 Python 接管后留下的**服务间**接口。
#
# 所以补的是**内部密钥**而不是用户身份：调用方是程序不是人，走的是同一条
# x-internal-key 通道（跟 permissions / tasks / blueprint 那几个路由一致）。
# 读接口 /health 不加——它只回一个可用性布尔，是给探活用的。
#
# ⚠️ ingest 是**写向量库**的接口。不加守卫的话，任何能连上端口的人都能往
# 检索库里灌内容，而检索结果会进推演的证据链——那是投毒面，不只是写坏数据。

router = APIRouter()


@router.post("/search")
def search_rag(body: Dict[str, Any], _: bool = Depends(verify_internal_key)) -> Dict[str, Any]:
    """POST /api/rag/search

    Body may be { "query": "...", "options": { ... } } or wrapped.
    Returns results with explicit python provenance.
    """
    query = body.get("query") or (body.get("payload", {}) or {}).get("query")
    options = body.get("options") or (body.get("payload", {}) or {}).get("options") or body.get("payload") or {}
    if not query or not isinstance(query, str):
        raise HTTPException(status_code=400, detail="query is required")
    result = rag_query_search(query, options if isinstance(options, dict) else {})
    # ensure signals (defense in depth)
    result.setdefault("provenance", RAG_QUERY_PROVENANCE)
    result.setdefault("backend", RAG_QUERY_BACKEND)
    result.setdefault("source", "python")
    return result


@router.post("/ingest")
def ingest_rag(body: Dict[str, Any], _: bool = Depends(verify_internal_key)) -> Dict[str, Any]:
    """POST /api/rag/ingest (compat for delegate)

    Accepts { "payload": <IngestionPayload> } or direct.
    Returns contract result (storage contract only in this slice).
    """
    payload = body.get("payload") or body
    if not isinstance(payload, dict) or not payload.get("sourceType") or not payload.get("sourceId") or not payload.get("content"):
        # Still return python-shaped error so delegate treats as delegated result (visible failure)
        return {
            "success": False,
            "ok": False,
            "status": "unavailable",
            "error": {"code": "python_rag_ingest_bad_payload", "message": "Missing required fields", "retryable": False},
            "provenance": RAG_QUERY_PROVENANCE,
            "backend": RAG_QUERY_BACKEND,
            "source": "python",
        }
    res = rag_ingest_contract(payload)
    return res


@router.post("/ingest/batch")
def ingest_batch(body: Dict[str, Any], _: bool = Depends(verify_internal_key)) -> Dict[str, Any]:
    payloads = body.get("payloads") or []
    if not isinstance(payloads, list):
        return {"error": "payloads must be an array", "provenance": RAG_QUERY_PROVENANCE, "backend": RAG_QUERY_BACKEND, "source": "python"}
    # For contract slice, accept batch by returning aggregated contract (no full batch impl yet)
    return {
        "success": True,
        "accepted": len(payloads),
        "operation": "batch",
        "provenance": RAG_QUERY_PROVENANCE,
        "backend": RAG_QUERY_BACKEND,
        "source": "python",
        "migratedStorage": False,
    }


# GET health alias under rag for direct probe
@router.get("/health")
def rag_health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "backend": RAG_QUERY_BACKEND,
        "source": "python",
        "provenance": RAG_QUERY_PROVENANCE,
    }
