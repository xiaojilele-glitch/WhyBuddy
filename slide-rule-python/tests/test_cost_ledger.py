"""LLM 实调用必须进 costLedger（2026-08-20）。

主循环把 `parsed, _result = call_llm_json(...)` 的 telemetry 丢掉，
用量页读 costLedger 就永远是空账。钩子必须接在 `_finalize_result`
（call_llm 成功出口），绑定必须在同步/流式 drive 两条活路上。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.cost_ledger import (  # noqa: E402
    bind_cost_session,
    ledger_entries,
)
from sliderule_llm.client import LlmResult, _finalize_result  # noqa: E402


def _result(tokens: int = 12, cost: float = 0.0001) -> LlmResult:
    return LlmResult(
        content="ok",
        usage={"total_tokens": tokens, "prompt_tokens": 4, "completion_tokens": tokens - 4},
        finish_reason="stop",
        model="test-model",
        latency_ms=15,
        provider="test",
        telemetry={
            "usage": {"total_tokens": tokens},
            "estimated_cost_usd": cost,
            "cost": {"estimated_usd": cost},
        },
    )


def test_没绑定finalize不记账():
    state = V5SessionState(
        sessionId="cost-unbound",
        goal={"text": "x", "status": "clear"},
        artifacts=[],
    )
    _finalize_result(_result())
    assert ledger_entries(state) == []


def test_finalize_钩子把用量写进绑定会话():
    state = V5SessionState(
        sessionId="cost-bound",
        goal={"text": "x", "status": "clear"},
        artifacts=[],
        lastTurnId="turn-1",
    )
    with bind_cost_session(state):
        out = _finalize_result(_result(tokens=20, cost=0.002))
    assert out.usage["total_tokens"] == 20
    ledger = ledger_entries(state)
    assert len(ledger) == 1
    rec = ledger[0]
    dumped = rec.model_dump() if hasattr(rec, "model_dump") else rec
    assert dumped["estimatedTokens"] == 20
    assert dumped["source"] == "server"
    assert dumped["capabilityId"]


def test_dict_状态也能取出台账():
    payload = {
        "sessionId": "dict-sid",
        "costLedger": [{"id": "c1", "estimatedTokens": 9}],
    }
    assert len(ledger_entries(payload)) == 1
    assert ledger_entries({"sessionId": "empty"}) == []


def test_活路径_finalize_和两条_drive_都接了钩子():
    from pathlib import Path

    client_src = Path(__file__).resolve().parents[1] / "sliderule_llm" / "client.py"
    driver_src = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"
    client = client_src.read_text(encoding="utf-8")
    driver = driver_src.read_text(encoding="utf-8")
    # 剥注释再判，避免 docstring 里的标识符把变异养绿。
    def strip(src: str) -> str:
        import re

        return re.sub(r'"""[\s\S]*?"""', "", src)

    client_code = strip(client)
    driver_code = strip(driver)
    assert "_result_hook_var" in client_code
    fin = client_code[client_code.index("def _finalize_result") :]
    fin = fin[: fin.index("\ndef ", 1)]
    assert "hook" in fin
    assert driver_code.count("bind_cost_session") >= 2
    assert "drive_full_v5_session_stream" in driver_code
    executor = (
        Path(__file__).resolve().parents[1]
        / "services"
        / "slide_rule_executor.py"
    ).read_text(encoding="utf-8")
    assert "llm_result_hook_active" in strip(executor)
