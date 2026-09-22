"""用量统计接口（GET /api/sliderule/usage，2026-08-14）。

## 为什么要有这个接口

costLedger 从 V5.1 起每次能力执行都在记（tokens/费用/耗时/来源），但
主循环的 LLM 调用曾把 telemetry 丢掉，设置面板读出来是空账。出口在
GET /usage；记账在 call_llm 成功钩子（见 test_cost_ledger）。

## 这组测试钉两件事

1. **归属口径与 GET /sessions 同一条**：session_access >= READ 才计入。
   别人的会话不许出现在我的账单里——列表与聚合漂移就是泄漏。
2. **聚合口径如实**：按能力/天/来源分账，source 原样带出（绝大多数是
   estimated 粗估，前端要把「估算」写在脸上，不许当计费账单）。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from conftest import TEST_USER_ID  # noqa: E402

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402

client = TestClient(app)
KEY = {"x-internal-key": "dev-slide-rule-internal"}


def _ledger_record(rec_id: str, cap: str, tokens: int, cost: float, day: str):
    return {
        "id": rec_id,
        "turnId": "turn-1",
        "capabilityRunId": f"run-{rec_id}",
        "capabilityId": cap,
        "estimatedTokens": tokens,
        "estimatedCostUsd": cost,
        "durationMs": 1000,
        "source": "estimated",
        "createdAt": f"{day}T10:00:00",
    }


def _seed_session(sid: str, ledger, owner=TEST_USER_ID):
    """直接从持久层落账。

    ⚠ 不走 PUT：costLedger 是**服务端专有字段**，save_sess 会把客户端 body
    里的它剥掉（防伪造账本，见路由的 sanitize 段）——这个剥离本身是对的，
    所以测试照生产写入方（执行器落账）的路子直接 save_session。
    """
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    st = V5SessionState(
        sessionId=sid,
        goal={"text": f"目标 {sid}", "status": "clear"},
        artifacts=[],
    )
    st.ownerId = owner
    st.costLedger = ledger
    save_session_record(st)


def test_聚合口径_按能力天来源分账():
    sid = "usage-agg-1"
    _seed_session(sid, [
        _ledger_record("c1", "evidence.search", 1000, 0.01, "2026-08-13"),
        _ledger_record("c2", "evidence.search", 2000, 0.02, "2026-08-14"),
        _ledger_record("c3", "synthesis.merge", 500, 0.005, "2026-08-14"),
    ])

    got = client.get("/api/sliderule/usage", headers=KEY)
    assert got.status_code == 200
    data = got.json()

    assert data["totals"]["runs"] >= 3
    assert data["totals"]["estimatedTokens"] >= 3500

    caps = {c["capabilityId"]: c for c in data["byCapability"]}
    assert caps["evidence.search"]["estimatedTokens"] >= 3000
    assert caps["synthesis.merge"]["runs"] >= 1

    days = {d["date"]: d for d in data["byDay"]}
    assert "2026-08-13" in days and "2026-08-14" in days

    # source 如实带出——前端靠它把「估算」写在脸上
    assert data["bySource"].get("estimated", 0) >= 3

    sessions = {s["sessionId"]: s for s in data["bySession"]}
    assert sid in sessions
    assert sessions[sid]["goal"].startswith("目标")


def test_别人的会话不进我的账单():
    """归属口径必须与 GET /sessions 同一条：READ 不到就不计。

    塞一条别人的会话，聚合结果里不许出现它的 token。
    """
    _seed_session(
        "usage-foreign-1",
        [_ledger_record("f1", "evidence.search", 999_999, 9.9, "2026-08-14")],
        owner="u-someone-else",
    )

    got = client.get("/api/sliderule/usage", headers=KEY)
    assert got.status_code == 200
    data = got.json()
    sessions = {s["sessionId"] for s in data["bySession"]}
    assert "usage-foreign-1" not in sessions, "别人的会话进了我的账单——归属过滤漏了"


def test_usage_dict_payload_也能聚():
    """load_all 偶发交出 dict 时 getattr(costLedger) 恒为空——那就是空账假象。"""
    sid = "usage-dict-1"
    from services.persistence import save_session_record
    from models.v5_state import V5SessionState

    st = V5SessionState(sessionId=sid, artifacts=[], goal={"text": "dict 账", "status": "clear"})
    st.ownerId = TEST_USER_ID
    st.costLedger = [_ledger_record("d1", "model.generate", 400, 0.01, "2026-08-20")]
    save_session_record(st)

    got = client.get("/api/sliderule/usage", headers=KEY)
    assert got.status_code == 200
    sessions = {s["sessionId"]: s for s in got.json()["bySession"]}
    assert sid in sessions
    assert sessions[sid]["estimatedTokens"] >= 400


def test_没有台账时返回空账不报错():
    sid = "usage-empty-1"
    _seed_session(sid, [])
    got = client.get("/api/sliderule/usage", headers=KEY)
    assert got.status_code == 200
    data = got.json()
    # 空台账的会话不计入 sessions 数（有账才算一个会话）
    sessions = {s["sessionId"] for s in data["bySession"]}
    assert sid not in sessions
