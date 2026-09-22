"""短清单路径仍必须调用 evaluate_coverage_gate（M20）。

只留 POST /coverage 不算通电。判据打在 drive_full_v5_session_stream 活生成器
上：spy 驱动器模块里的 evaluate_coverage_gate，不是 coverage 路由。

反向：把流式驱动里的 evaluate_coverage_gate 调用点注释掉，本文件必须红。
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402

GOAL = "做一个请假审批系统，含申请、审批和余额"


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def _seeded(session_id: str) -> V5SessionState:
    state = V5SessionState(
        sessionId=session_id,
        goal={"text": GOAL, "status": "needs_refinement"},
        artifacts=[],
    )
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_full_driver as driver_mod

    # ⚠ 2026-08-27：这里原来是 `lambda s: s`。PR-8(M14) 之后 persist_state 的
    #   契约变成"返回 save_session_record 的 dict"，能力结束落 pendingRuns 时
    #   `not isinstance(result, dict) or not result.get("ok")` 就是**写失败**，
    #   fail-closed 抛 PersistClosedError（正确行为：假装存了 = 崩溃后重烧 LLM）。
    #   于是本夹具让驱动器在第一个能力后就 `phase_changed: failed` 退出，
    #   走不到循环后那条无条件的 evaluate_coverage_gate——判据 **打空**，
    #   报"闸被删了"，而真实路径上闸调用了 2 次。
    #   契约改了要同步夹具，否则腐烂的是判据不是功能（Claude.md §2/§4）。
    monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
    monkeypatch.setattr(
        driver_mod, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
    )
    monkeypatch.setattr(
        driver_mod,
        "execute_v5_capability",
        lambda cap, state, input_ids, role, turn_id: {
            "title": cap,
            "summary": "stub",
            "content": "stub",
            "provenance": "python-rag",
            "sources": [],
        },
    )
    return driver_mod


def test_short_list_path_invokes_evaluate_coverage_gate_on_the_stream_driver(driver):
    calls = []
    real = driver.evaluate_coverage_gate

    def spy(state, *args, **kwargs):
        calls.append(state)
        return real(state, *args, **kwargs)

    driver.evaluate_coverage_gate = spy

    async def _run():
        events = []
        async for ev in driver.drive_full_v5_session_stream(
            _seeded("app-gcov-live"),
            max_loops=1,
            user_instruction=GOAL,
            profile="app",
        ):
            events.append(ev)
        return events

    events = asyncio.run(_run())
    assert events, "短清单路径流是空的"
    assert len(calls) >= 2, (
        f"evaluate_coverage_gate 在短清单路径上只被调用 {len(calls)} 次。"
        "循环内 ~2338 与循环后 ~2368 都应打到。"
        "只留 POST /coverage 或只 spy 路由，删掉生成器里的调用点会假绿。"
    )


def test_coverage_gate_call_sites_live_inside_stream_function_not_only_http():
    from pathlib import Path

    from services.v5_full_driver import drive_full_v5_session_stream

    stream_src = _code(drive_full_v5_session_stream)
    assert stream_src.count("evaluate_coverage_gate") >= 2, (
        "流式驱动函数体里的 evaluate_coverage_gate 被删到不足两处。"
        "注释掉循环内或循环后的调用，这条必须红。"
    )

    routes = (Path(__file__).resolve().parents[1] / "routes" / "sliderule_full.py").read_text(
        encoding="utf-8"
    )
    coverage_handler = ""
    if '@router.post("/coverage")' in routes:
        coverage_handler = routes.split('@router.post("/coverage")', 1)[1][:800]
    assert "evaluate_coverage_gate" in coverage_handler or "evaluate_coverage_gate" in routes
    # 路由有闸 ≠ 短清单通电。上面两条已经钉在生成器上。
