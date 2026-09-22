"""工厂后交回控制面的 message 形状必须能过 _normalize_messages。

⚠ 2026-09-02 真机：spec 跳写完后 `control llm loop failed after write`，
  LlmError: content must be a string or content part list。根因两处：
  1. `_control_llm_loop` 把空 content 写成 None；
  2. `_normalize_message` 见 None 就抛，而且剥掉 tool_calls。
"""

from __future__ import annotations

from sliderule_llm.client import _normalize_message, _normalize_messages


def test_normalize_accepts_none_content_and_keeps_tool_calls():
    """变异：把 None→空串 或 tool_calls 拷贝删掉 → 本条红。"""
    out = _normalize_message(
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "forced-pages",
                    "type": "function",
                    "function": {"name": "pages", "arguments": "{}"},
                }
            ],
        }
    )
    assert out["content"] == ""
    assert out["tool_calls"][0]["id"] == "forced-pages"


def test_normalize_keeps_tool_result_call_id():
    out = _normalize_message(
        {"role": "tool", "tool_call_id": "forced-pages", "content": '{"ok": true}'}
    )
    assert out["tool_call_id"] == "forced-pages"
    assert out["content"] == '{"ok": true}'


def test_forced_write_transcript_roundtrip():
    """`_messages_after_forced_write` 的合成记录必须能原样过闸。"""
    messages = [
        {"role": "system", "content": "你是控制面。"},
        {"role": "user", "content": "假设已确认。继续画页面。"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "forced-pages",
                    "type": "function",
                    "function": {"name": "pages", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "forced-pages",
            "content": '{"ok": true, "tool": "pages"}',
        },
        {"role": "user", "content": "本跳实际跑了：页面生成。"},
    ]
    out = _normalize_messages(messages)
    assert out[2]["tool_calls"][0]["id"] == "forced-pages"
    assert out[3]["tool_call_id"] == "forced-pages"


def test_control_loop_does_not_write_none_content():
    """变异：把 `"content": content` 改回 `content or None` → 本条红。"""
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    at = src.find("assistant_msg")
    assert at > 0
    body = src[at : at + 400]
    assert "content or None" not in body
    assert "'content': content" in body or '"content": content' in body
