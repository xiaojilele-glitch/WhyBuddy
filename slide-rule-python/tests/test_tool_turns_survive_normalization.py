# -*- coding: utf-8 -*-
"""多轮工具对话过归一化不许被拆散（2026-09-02 真机）。

## 事故

健身房那趟真机：控制面 WRITE 交回 host 之后，日志里每次都是

    control llm loop failed after write
    LlmError: invalid LLM message: content must be a string or content part list

两个毛病叠在一起，症状完全不同：

**① 静默的那个**：`_normalize_message` 原来只返回 `{role, content}`，
`tool_calls` / `tool_call_id` 被剥掉。控制面拼的消息本来合法（assistant 带
tool_calls、随后 role="tool" 带 tool_call_id），剥完变成「孤儿 tool 消息」。
**请求照样发得出去**，所以没人发现——只是模型看到的对话是残的。
这正是本仓第三条说的「闸全绿但东西没了」。

**② 响亮的那个**：空正文的 assistant 是合法回复（模型把话全放进工具参数，
`control_client` 模块头写着这条），调用方于是写 `content or None`，
而归一化只认 str / list → 第二轮直接抛。

后果：**「工厂跑完交回控制面继续挑下一跳」整条链断在这儿**。真机上表现为
每一跳都停在 spec、发「继续下一步」毫无反应、refine 因为一直没有模型而够不着。
"""

from __future__ import annotations

import pytest

from sliderule_llm.client import LlmError, _normalize_message, _normalize_messages


ASSISTANT_CALL = {
    "role": "assistant",
    "content": "",
    "tool_calls": [
        {"id": "call-1", "type": "function", "function": {"name": "spec", "arguments": "{}"}}
    ],
}
TOOL_RESULT = {"role": "tool", "tool_call_id": "call-1", "content": '{"ok":true}'}


class Test工具轮次字段不许被剥:
    def test_assistant_的tool_calls_留下来(self):
        out = _normalize_message(ASSISTANT_CALL)
        assert out.get("tool_calls"), (
            "tool_calls 被剥掉了。请求还能发出去，但模型看到的 assistant "
            "没有发起过任何调用，后面那条 role='tool' 就是孤儿。"
        )
        assert out["tool_calls"][0]["function"]["name"] == "spec"

    def test_tool消息的tool_call_id_留下来(self):
        out = _normalize_message(TOOL_RESULT)
        assert out.get("tool_call_id") == "call-1", "tool_call_id 被剥掉 → 结果配不回调用"

    def test_整段对话过一遍还是完整的(self):
        msgs = _normalize_messages(
            [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "做个系统"},
                ASSISTANT_CALL,
                TOOL_RESULT,
                {"role": "user", "content": "继续"},
            ]
        )
        assert len(msgs) == 5
        assert msgs[2].get("tool_calls"), "assistant 的调用丢了"
        assert msgs[3].get("tool_call_id") == "call-1", "tool 结果的配对丢了"


class Test空正文带工具调用是合法的:
    def test_content_为None_且有tool_calls_不抛(self):
        """模型常把话全放进工具参数（control_client 模块头）。

        历史上调用方写 `content or None`，空串会变 None——那是崩的直接原因。
        """
        out = _normalize_message({**ASSISTANT_CALL, "content": None})
        assert out.get("tool_calls")

    def test_None归一成空串_跟仓里同形状消息一致(self):
        """⚠ 口径要跟 `_messages_after_forced_write` 合成的那条对齐。

        那条 assistant 消息本来就写 `content: ""`。这里若原样留 None，
        同一件事就有两种表示——本仓栽过太多次的形状。空串是「这一轮没说话」。
        """
        out = _normalize_message({**ASSISTANT_CALL, "content": None})
        assert out["content"] == "", "应归一成空串，跟仓里既有形状一致"


class Test该拒的还得拒:
    """反向判据：放宽只针对「带 tool_calls 的空正文」，别把校验整个废掉。"""

    def test_没有tool_calls的None仍然抛(self):
        with pytest.raises(LlmError):
            _normalize_message({"role": "user", "content": None})

    def test_content是dict仍然抛(self):
        with pytest.raises(LlmError):
            _normalize_message({"role": "user", "content": {"text": "x"}})

    def test_role不是字符串仍然抛(self):
        with pytest.raises(LlmError):
            _normalize_message({"role": None, "content": "x"})


class Test纯聊天路径行为不变:
    """两个工厂调用点传的是普通消息，改动不许碰到它们。"""

    def test_普通消息原样过(self):
        out = _normalize_message({"role": "user", "content": "你好"})
        assert out == {"role": "user", "content": "你好"}, (
            "纯聊天消息多出了字段——工厂那两条路径会跟着变"
        )
