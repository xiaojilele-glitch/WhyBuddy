"""你好帮我搜一下请假制度 → 不计入闭环、不进 conversation、不 commit_artifact。"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_control_search_does_not_count_toward_closure(harness, monkeypatch):
    sid = new_sid("search")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        conversation=[{"role": "user", "text": "seed-turn"}],
        artifacts=[{"id": "art-seed", "content": "prior", "kind": "note"}],
        publishClosure={"evidencePresentCount": 4, "blocked": True},
    )

    def fake_retrieve(query, top_k=6):
        return [
            {
                "title": "请假制度",
                "content": "员工请假需提前三天",
                "source": "handbook",
            }
        ]

    monkeypatch.setattr(
        "services.rag_service.retrieve_evidence", fake_retrieve
    )

    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool(
                "search_evidence", {"query": "请假制度"}, call_id="search-1"
            )
        return llm_text("手册里写了请假要提前三天。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "你好帮我搜一下请假制度"))
    assert harness.helper_calls == []
    types = event_types(events)
    assert "commit_artifact" not in types
    assert "control_handoff_factory" not in types
    assert "control_tool_result" in types
    loaded = load_session(sid)
    assert loaded is not None
    closure = loaded.publishClosure or {}
    assert closure.get("evidencePresentCount") == 4
    assert len(loaded.conversation or []) == 1
    assert (loaded.conversation or [])[0]["text"] == "seed-turn"
    assert [a.id if hasattr(a, "id") else a.get("id") for a in (loaded.artifacts or [])] == [
        "art-seed"
    ]
    kinds = [
        row.get("kind")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
    ]
    assert "search_evidence" in kinds
