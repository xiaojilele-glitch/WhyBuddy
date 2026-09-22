# -*- coding: utf-8 -*-
"""上下文占用到 19.7 万就折叠较早的工具结果，不是把累计花费当硬闸。

变异：compact_messages 变成恒等 → 占用仍超阈值，活路径那条会停成
token_budget，而不是继续采样。
"""

from __future__ import annotations

import json

from services.control_budget import (
    PROJECT_BUDGET, PROJECT_BUDGET_V1, PROJECT_BUDGET_V2, WINDOW_COMPACT_AT_TOKENS,
)
from services.control_context_compact import (
    COMPACT_NOTICE_PREFIX,
    compact_messages,
    estimate_message_tokens,
    is_compact_notice,
    microcompact_messages,
)


def _history(*, tools: int, payload: str) -> list:
    messages = [
        {"role": "system", "content": "你是控制面。"},
        {"role": "user", "content": "做团长工作台"},
    ]
    for index in range(tools):
        call_id = f"call-{index}"
        messages.append({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": call_id,
                "type": "function",
                "function": {"name": "project_read", "arguments": "{}"},
            }],
        })
        messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "content": payload,
        })
    return messages


def test_没到阈值不许动消息():
    messages = _history(tools=2, payload="短")
    out, report = compact_messages(messages, max_tokens=200_000, compact_at_tokens=197_000)
    assert report.did_compact is False
    assert out == messages


def test_到阈值就折叠较早的tool并留下最近两条():
    payload = "源码" * 4000
    messages = _history(tools=6, payload=payload)
    before = estimate_message_tokens(messages)
    assert before >= 8_000
    out, report = compact_messages(messages, max_tokens=12_000, compact_at_tokens=8_000)
    assert report.did_compact is True
    assert report.folded >= 1
    assert report.tokens_after < report.tokens_before
    assert any(is_compact_notice(row) for row in out)
    assert out[0]["content"] == "你是控制面。"
    assert out[1]["content"].startswith(COMPACT_NOTICE_PREFIX)
    assert any(row.get("role") == "user" and "团长" in str(row.get("content")) for row in out)
    tool_bodies = [row["content"] for row in out if row.get("role") == "tool"]
    assert payload in tool_bodies[-1]
    assert tool_bodies.count(payload) <= 2


def test_工程档标定是20万窗口60percent压缩_v1不压缩():
    """v3 压缩点是窗口的 60%。v1/v2 存档数字不许动。

    ⚠ 2026-09-20：197k 太靠边，PPT 短回合永远压不到。Manus / 工作台
      都是窗口占用到约六成就自动压缩。档名保留字面量。
    """
    assert PROJECT_BUDGET.profile == "project-v3"
    assert PROJECT_BUDGET.max_tokens == 200_000
    assert PROJECT_BUDGET.compact_at_tokens == WINDOW_COMPACT_AT_TOKENS
    assert WINDOW_COMPACT_AT_TOKENS == 120_000
    assert PROJECT_BUDGET.context_token_budget is True
    assert PROJECT_BUDGET.max_request_seconds == 3600.0
    # 旧档仍钉着自己那份标定，供 restore_budget 还原老 checkpoint。
    assert PROJECT_BUDGET_V2.profile == "project-v2"
    assert PROJECT_BUDGET_V2.max_wall_seconds == 900.0
    assert PROJECT_BUDGET_V2.compact_at_tokens == 197_000
    assert PROJECT_BUDGET_V1.profile == "project-v1"
    assert PROJECT_BUDGET_V1.max_tokens == 64_000
    assert PROJECT_BUDGET_V1.compact_at_tokens == 0
    assert PROJECT_BUDGET_V1.context_token_budget is False
    assert PROJECT_BUDGET.should_compact(120_000) is True
    assert PROJECT_BUDGET.should_compact(119_999) is False
    assert PROJECT_BUDGET_V1.should_compact(1_000_000) is False


def test_折叠后的桩仍是json():
    messages = _history(tools=4, payload="X" * 20_000)
    out, report = compact_messages(messages, max_tokens=3_000, compact_at_tokens=2_000)
    assert report.did_compact
    stub = json.loads(next(row["content"] for row in out if row.get("role") == "tool"
                           and "compacted" in str(row.get("content"))))
    assert stub["compacted"] is True
    assert stub["tool"]
    assert "file_read" in stub["hint"] or "grep" in stub["hint"]


def test_microcompact_snips_old_file_reads_without_waiting_for_window():
    payload = json.dumps({"path": "src/App.tsx", "content": "X" * 4000}, ensure_ascii=False)
    messages = [
        {"role": "system", "content": "你是控制面。"},
        {"role": "user", "content": "改标题"},
    ]
    for index in range(4):
        call_id = f"call-{index}"
        messages.append({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": call_id,
                "type": "function",
                "function": {"name": "file_read", "arguments": "{}"},
            }],
        })
        messages.append({"role": "tool", "tool_call_id": call_id, "content": payload})
    before = estimate_message_tokens(messages)
    out, report = microcompact_messages(messages)
    assert report.did_compact is True
    assert report.tokens_after < before
    tool_bodies = [row["content"] for row in out if row.get("role") == "tool"]
    assert tool_bodies.count(payload) == 2
    stub = json.loads(next(body for body in tool_bodies if "compacted" in body))
    assert stub["path"] == "src/App.tsx"
    assert stub["tool"] == "file_read"


def test_microcompact_skill_stub_does_not_tell_model_to_file_read():
    """真机 sr-20260921150545：skill 桩写 file_read/grep，模型第三遍加载技能。"""
    from services.control_context_compact import skill_name_from_tool_content, tool_result_stub

    payload = json.dumps({
        "ok": True,
        "skill": "office-skills",
        "skill_message": '<skill name="office-skills">HOW TO MAKE PPT WITH PYTHON-PPTX ' + ("X" * 800) + "</skill>",
    }, ensure_ascii=False)
    messages = [
        {"role": "system", "content": "你是控制面。"},
        {"role": "user", "content": "做PPT"},
    ]
    for index in range(4):
        call_id = f"sk-{index}"
        messages.append({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": call_id,
                "type": "function",
                "function": {"name": "skill", "arguments": '{"name":"office-skills"}'},
            }],
        })
        messages.append({"role": "tool", "tool_call_id": call_id, "content": payload})
    out, report = microcompact_messages(messages)
    assert report.did_compact is True
    stubs = [
        json.loads(row["content"])
        for row in out
        if row.get("role") == "tool" and "compacted" in str(row.get("content"))
    ]
    assert stubs
    for stub in stubs:
        assert stub["tool"] == "skill"
        assert stub["skill"] == "office-skills"
        assert "file_read" not in stub["hint"]
        assert "grep" not in stub["hint"]
        assert "不要再调 skill" in stub["hint"]
    assert skill_name_from_tool_content(payload) == "office-skills"
    skill_stub = json.loads(tool_result_stub("skill", skill="office-skills"))
    assert "file_read" not in skill_stub["hint"]
