"""forcedTool challenge：夹具模型只想 inspect_model，仍失效一次、helper=0。"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_tool,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_forced_challenge_invalidates_once_skips_inspect_fixture(harness):
    sid = new_sid("challenge")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        artifacts=[{"id": "art-1", "content": "a finding", "kind": "finding"}],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool("inspect_model", {})
    _, events = harness.post(
        six_fields(sid, "这个结论依据不够", forcedTool="challenge")
    )
    assert harness.helper_calls == []
    assert harness.llm_calls == [], "质疑是昂贵按钮，跳过控制面 LLM"
    assert len(harness.invalidate_calls) == 1
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert "control_tool_start" in types
    assert "inspect_model" not in [
        e.get("tool") for e in events if e.get("type") == "control_tool_start"
    ]
