# -*- coding: utf-8 -*-
"""工厂选材决策必须上屏（2026-09-04 阶段 2）。

数据早就写在 decisionLedger，产品面没人看。判据盯三件事：

  正  一跳跑完，factory_plan 带着模型理由原文
  反  开局那一发（选材还没发生）不许伪造 rationale
  反  回落规则版 source=heuristic_fallback，不许装成 llm
"""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path

from models.v5_state import V5SessionState

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"


class Test开局不许伪造决策:
    def test_开局payload没有rationale键(self):
        from services.v5_full_driver import _factory_plan_payload

        state = V5SessionState(
            sessionId="sr-open",
            goal={"text": "t", "tools": ["pages"], "productSteps": [3]},
        )
        payload = _factory_plan_payload(state, ("pages",))
        assert "rationale" not in payload
        assert "source" not in payload
        assert payload["type"] == "factory_plan"
        assert payload["tools"] == ["pages"]


class Test接在活路上:
    def test_流式stamp那一发带着理由(self):
        src = _DRV.read_text(encoding="utf-8")
        stream = src.split("async def drive_full_v5_session_stream")[1].split(
            "\nasync def "
        )[0]
        assert "rationale=_proposal.get(\"rationale\")" in stream or (
            'rationale=_proposal.get("rationale")' in stream
        )
        assert 'source="llm"' in stream
        assert 'source="heuristic_fallback"' in stream

    def test_回落也yield且source不是llm(self, monkeypatch, tmp_path):
        monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
        monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "on")
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        import services.v5_agentic_pick as agentic_mod
        import services.v5_full_driver as driver_mod

        monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
        monkeypatch.setattr(
            driver_mod, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
        )
        monkeypatch.setattr(
            driver_mod,
            "execute_v5_capability",
            lambda *a, **k: {
                "title": "stub",
                "summary": "stub",
                "content": "stub",
                "provenance": "python-rag",
                "sources": [],
            },
        )
        monkeypatch.setattr(
            agentic_mod, "agentic_pick_next_capabilities", lambda *a, **k: None
        )
        monkeypatch.setattr(agentic_mod, "agentic_pick_enabled", lambda: True)
        state = V5SessionState(
            sessionId="sr-fb",
            goal={
                "text": "做一个社区宠物寄养平台",
                "tools": ["spec", "pages", "structure", "bind"],
            },
            specFirstPages={
                "spec": {"appName": "寄养", "pages": [{"id": "p1"}]},
                "pages": {"p1": "<html></html>"},
            },
        )

        async def _run():
            events = []
            async for ev in driver_mod.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction="先只要页面", profile="app"
            ):
                events.append(ev)
            return events

        events = asyncio.run(_run())
        decided = [
            e
            for e in events
            if e.get("type") == "factory_plan" and "source" in e
        ]
        assert decided, "回落没发带 source 的 factory_plan，界面只能装成没发生"
        last = decided[-1]
        assert last["source"] == "heuristic_fallback"
        assert "回落规则版" in last["rationale"]
        ledger = state.decisionLedger or []
        assert any(getattr(d, "source", None) == "heuristic_fallback" for d in ledger)

    def test_模型挑了理由原文进事件(self, monkeypatch, tmp_path):
        monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
        monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "on")
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        import services.v5_agentic_pick as agentic_mod
        import services.v5_full_driver as driver_mod

        monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
        monkeypatch.setattr(
            driver_mod, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
        )
        monkeypatch.setattr(
            driver_mod,
            "execute_v5_capability",
            lambda *a, **k: {
                "title": "stub",
                "summary": "stub",
                "content": "stub",
                "provenance": "python-rag",
                "sources": [],
            },
        )
        why = "用户指令明确为继续生成页面，跳过数据结构与权限绑定"

        def fake_pick(state, user_text, **kwargs):
            return {
                "picks": [{"capabilityId": "pages", "roleId": "工程"}],
                "rationale": why,
            }

        monkeypatch.setattr(agentic_mod, "agentic_pick_next_capabilities", fake_pick)
        monkeypatch.setattr(agentic_mod, "agentic_pick_enabled", lambda: True)
        state = V5SessionState(
            sessionId="sr-why",
            goal={
                "text": "做一个社区宠物寄养平台",
                "tools": ["spec", "pages", "structure", "bind"],
            },
            specFirstPages={
                "spec": {"appName": "寄养", "pages": [{"id": "p1"}]},
                "pages": {"p1": "<html></html>"},
            },
        )

        async def _run():
            events = []
            async for ev in driver_mod.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction="先只要页面", profile="app"
            ):
                events.append(ev)
            return events

        events = asyncio.run(_run())
        decided = [
            e
            for e in events
            if e.get("type") == "factory_plan" and e.get("rationale")
        ]
        assert decided, "stamp 那一发没带理由"
        last = decided[-1]
        assert last["rationale"] == why
        assert last["source"] == "llm"
        assert "pages" in last["chose"]
        assert last.get("tools") == ["pages"]


class Test驱动器把决策交给前端:
    def test_payload构造函数在活路上(self):
        src = inspect.getsource(
            __import__(
                "services.v5_full_driver", fromlist=["_factory_plan_payload"]
            )._factory_plan_payload
        )
        assert "rationale" in src
        assert "不许伪造" in src or "rationale or chose or source" in src
