"""The host interviews, writes a plan, and selects individual approved hops."""
from __future__ import annotations

import pytest

from control_turn_support import ControlHarness, event_types, llm_text, llm_tool, new_sid, seed_session, seed_approved_session, six_fields
from models.v5_state import V5SessionState
from services.rehearsal_control import POST_WRITE_FALLBACK, list_control_tools, _system_prompt


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_fresh_topic_exposes_interview_and_planning_tools():
    state = V5SessionState(sessionId="interview", goal={"text": "fruit store checkout"})
    names = {tool["function"]["name"] for tool in list_control_tools(state)}
    assert {"ask_user_question", "enter_plan_mode", "write_plan"} <= names
    assert not {"scope_card", "clarify", "rehearse", "spec"} & names
    prompt = _system_prompt(state)
    assert "write_plan" in prompt and "exit_plan_mode" in prompt


def test_real_product_topic_can_still_be_interviewed(harness):
    sid = new_sid("fruit-interview")
    seed_session(sid, goal={"text": "fruit store checkout"})
    harness.llm_impl = lambda messages, **kw: llm_tool("ask_user_question", {"question": "Which payment methods are required?", "options": ["Cash", "Card"]})
    _, events = harness.post(six_fields(sid, "Build a fruit store checkout"))
    assert "control_ask_user" in event_types(events)
    assert "control_scope_card" not in event_types(events)
    assert harness.helper_calls == []
    question = next(e for e in events if e["type"] == "control_ask_user")
    assert "payment" in question["question"]


class TestHostChoosesNextHop:
    def test_host_picks_remaining_hops_one_at_a_time(self, harness):
        """开始推演只点火 spec。交回后 host 按模型挑 pages → structure → bind。
        四件不许焊在同一次 handoff 里。"""
        sid = new_sid("p7-hops")
        seed_approved_session(
            sid,
            goal={"text": "水果店收银台", "status": "clear"},
            awaitReason="control_scope",
            awaitDetail="水果店收银台",
        )
        picked: list[str] = []

        def impl(messages, **kw):
            n = len(harness.llm_calls)
            if n == 1:
                picked.append("pages")
                return llm_tool("pages", {}, call_id="h-pages")
            if n == 2:
                picked.append("structure")
                return llm_tool("structure", {}, call_id="h-structure")
            if n == 3:
                picked.append("bind")
                return llm_tool("bind", {}, call_id="h-bind")
            return llm_text("页面已经出来。要改哪一页，或者说继续精修、补齐缺口。")

        harness.llm_impl = impl
        _, events = harness.post(
            six_fields(sid, "将做成：水果店收银台", forcedTool="rehearse")
        )
        tools = [c.get("goal_tools") for c in harness.helper_calls]
        assert tools[0] == ["spec"], tools
        assert ["pages"] in tools, tools
        assert ["structure"] in tools, tools
        assert ["bind"] in tools, tools
        for batch in tools:
            assert list(batch or []) != [
                "spec",
                "pages",
                "structure",
                "bind",
            ], f"课表又焊回来了：{tools}"
        texts = [
            str(e.get("text") or "")
            for e in events
            if e.get("type") == "control_text"
        ]
        blob = "\n".join(texts)
        assert "没点火" not in blob
        assert "额度用完" not in blob
        assert POST_WRITE_FALLBACK in blob or "页面已经出来" in blob
        assert picked == ["pages", "structure", "bind"], picked
        assert types_ok(events)


def types_ok(events) -> bool:
    types = event_types(events)
    assert types[-1] == "complete"
    assert "control_handoff_factory" in types
    return True
