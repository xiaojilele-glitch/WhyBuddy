"""模型动手之前说的那段话，必须真的发到界面上。

## 修的是什么（2026-09-13，用户对照 Manus 截图：「页面没跟上，逻辑是有了」）

差的不是能力是呈现。Manus 每组动作前面都有一段第一人称散文：

    「我会采用浅蓝工作台 + 白色卡片 + 橙色优先级作为视觉方向，接着
      初始化项目并把核心页面做成可交互的单页客服工作台。」

我们这边同一时刻左栏只有「第 1 轮 · 正在执行 planning」。逐跳查下来，
那段话**模型本来就在产**——`_run_control_turn_body` 每轮拿到的 `content`
一直有，会进喂给 LLM 的 `assistant_msg`；但原来只有

    content and not _has_product_topic(state)
            and any(c["name"] == "ask_user_question" for c in calls)

才 `yield {"type": "control_text"}`。工程模式下模型是「说一句 + 调
project_create」，**两个条件都不成立**，于是那段话一个字都没到界面上。

## 这条判据为什么这么写

⚠ 喂的是**真机那一发的原样载荷**（§1.2）：`content` 与 `tool_calls`
  **同时**存在。这正是原护栏永远不成立的那个形态——判据自己构造一个
  刚好满足护栏的输入（比如只发 ask_user_question），只能证明「我抄对了」，
  证明不了真机上会发生什么。

⚠ 判据直接跑产线的 `control.run_control_turn`，不重抄事件流。

⚠ 顺序也钉住：开口必须排在这一轮的工具事件**之前**。散文排在动作后面
  就不是「我要做什么」而是事后旁白，观感差别正在这儿。
"""

import asyncio

import pytest
from control_turn_support import six_fields
from project_actor_support import project_actor  # noqa: F401  (setup 依赖它)
from services import rehearsal_control as control
from sliderule_llm.control_client import ControlLlmResult
from services.project_creation import create_session_project
from services.project_tools import ProjectTools
from services.slide_rule_session import load_session

from conftest import TEST_USER_ID
from test_control_project_tools import post, setup  # noqa: F401  (pytest fixtures)


SPEECH = (
    "我会采用「浅蓝工作台 + 白色卡片 + 橙色优先级」作为视觉方向，"
    "接着初始化项目并把核心页面做成可交互的单页客服工作台。"
)


def llm_speech_and_tool(content, name, arguments=None, call_id="call-1"):
    """真机形态：模型**又说话又调工具**。

    `control_turn_support.llm_tool` 把 content 写死成 ""，复用它就等于把
    这条判据要证明的东西提前抹掉了。
    """
    return ControlLlmResult(
        content=content,
        tool_calls=[{"id": call_id, "name": name, "arguments": arguments or {}}],
        usage={"total_tokens": 12},
        finish_reason="tool_calls",
        model="ctrl-test",
        latency_ms=1,
    )


def run_turn(setup, adapter, user_text="继续"):
    async def go():
        return [
            event
            async for event in control.run_control_turn(
                six_fields(setup.state.sessionId, user_text),
                authorized_owner_id=TEST_USER_ID,
                project_tools=adapter,
            )
        ]

    return asyncio.run(go())


def speech_texts(events):
    return [
        str(event.get("text") or "")
        for event in events
        if event.get("type") == "control_text" and not event.get("stopReason")
    ]


def test_工程模式下模型的开口真的发到界面(setup, monkeypatch):
    """正向：说一句 + 调 project_read → 那句话必须出现在事件流里。"""
    create_session_project(
        setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref
    )
    adapter = ProjectTools(setup.store, None, TEST_USER_ID)
    rounds = []

    async def model(*a, **kw):
        rounds.append(1)
        if len(rounds) == 1:
            return llm_speech_and_tool(SPEECH, "project_read", {"path": "src/main.tsx"})
        return ControlLlmResult(
            content="已经看过源码了。",
            tool_calls=[],
            usage={"total_tokens": 12},
            finish_reason="stop",
            model="ctrl-test",
            latency_ms=1,
        )

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    events = run_turn(setup, adapter)

    assert SPEECH in speech_texts(events), (
        "模型带着工具调用说的话没到界面上——正是 2026-09-13 那次"
        "「页面没跟上」的成因。事件流：%r" % [e.get("type") for e in events]
    )


def test_开口排在本轮工具事件之前(setup, monkeypatch):
    """反向/顺序：散文排在动作后面就成了事后旁白，不是「我要做什么」。"""
    create_session_project(
        setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref
    )
    adapter = ProjectTools(setup.store, None, TEST_USER_ID)
    rounds = []

    async def model(*a, **kw):
        rounds.append(1)
        if len(rounds) == 1:
            return llm_speech_and_tool(SPEECH, "project_read", {"path": "src/main.tsx"})
        return ControlLlmResult(
            content="看完了。", tool_calls=[], usage={"total_tokens": 12},
            finish_reason="stop", model="ctrl-test", latency_ms=1,
        )

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    events = run_turn(setup, adapter)

    types = [e.get("type") for e in events]
    speech_at = next(
        i for i, e in enumerate(events)
        if e.get("type") == "control_text" and str(e.get("text") or "") == SPEECH
    )
    tool_at = next(
        (i for i, t in enumerate(types) if t in {"control_tool_start", "control_tool_result"}),
        None,
    )
    assert tool_at is not None, "这一轮没有工具事件，顺序判据落空：%r" % types
    assert speech_at < tool_at, (
        "开口排在工具事件后面了（散文成了事后旁白）：%r" % types
    )


def test_工程工具写入会话日志刷新才回得来(setup, monkeypatch):
    """正向：project_read 的 start/result 必须进 controlTranscript。

    2026-09-15 TicketStream：SSE 有动作，会话日志没有，一刷左栏步骤没了。
    写入必须走派发出口 `_logged_tool_events`：只在 `_dispatch_tool` 里
    手写 append，forced / 超限那两条出口会漏。
    """
    create_session_project(
        setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref
    )
    adapter = ProjectTools(setup.store, None, TEST_USER_ID)
    rounds = []

    async def model(*a, **kw):
        rounds.append(1)
        if len(rounds) == 1:
            return llm_speech_and_tool("", "project_read", {"path": "src/main.tsx"})
        return ControlLlmResult(
            content="读完了。", tool_calls=[], usage={"total_tokens": 12},
            finish_reason="stop", model="ctrl-test", latency_ms=1,
        )

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    run_turn(setup, adapter)
    saved = load_session(setup.state.sessionId) or setup.state
    remembered = [
        (row.get("kind"), row.get("tool"))
        for row in (saved.controlTranscript or [])
        if str(row.get("kind") or "").startswith("tool_")
    ]
    assert ("tool_start", "project_read") in remembered, remembered
    assert ("tool_result", "project_read") in remembered, remembered
    assert all(
        "content" not in row
        for row in (saved.controlTranscript or [])
        if str(row.get("kind") or "").startswith("tool_")
    )


def test_非工程工具也进会话日志(setup, monkeypatch):
    """正向：todo_write 不是 project_*，刷新也要回得来。

    反向：只认 project_* 的那一版，这条会红。
    用批准后清单里真会列出的工具，不许自己拼一个 inspect_model 再
    假装 should_list 成立（§1.2）。
    """
    create_session_project(
        setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref
    )
    adapter = ProjectTools(setup.store, None, TEST_USER_ID)
    rounds = []

    async def model(*a, **kw):
        rounds.append(1)
        if len(rounds) == 1:
            return llm_speech_and_tool(
                "",
                "todo_write",
                {"todos": [{"content": "搭工程", "status": "pending"}]},
            )
        return ControlLlmResult(
            content="记下了。", tool_calls=[], usage={"total_tokens": 12},
            finish_reason="stop", model="ctrl-test", latency_ms=1,
        )

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    run_turn(setup, adapter)
    saved = load_session(setup.state.sessionId) or setup.state
    remembered = [
        (row.get("kind"), row.get("tool"))
        for row in (saved.controlTranscript or [])
        if str(row.get("kind") or "").startswith("tool_")
    ]
    assert ("tool_start", "todo_write") in remembered, remembered
    assert ("tool_result", "todo_write") in remembered, remembered


def test_没说话就不许凭空造一段开口(setup, monkeypatch):
    """反向：`content` 为空时不许发空的 control_text——

    「每写一条应该有 X，配一条不该有 Y」（§3）。放宽条件最容易顺手带出
    的回归就是把空串也 yield 出去，左栏于是多一段空白段落。
    """
    create_session_project(
        setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref
    )
    adapter = ProjectTools(setup.store, None, TEST_USER_ID)
    rounds = []

    async def model(*a, **kw):
        rounds.append(1)
        if len(rounds) == 1:
            # 真机见过：模型只回 tool_calls，content 是空串。
            return llm_speech_and_tool("", "project_read", {"path": "src/main.tsx"})
        return ControlLlmResult(
            content="读完了。", tool_calls=[], usage={"total_tokens": 12},
            finish_reason="stop", model="ctrl-test", latency_ms=1,
        )

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    events = run_turn(setup, adapter)

    assert all(text.strip() for text in speech_texts(events)), (
        "发了空的开口：%r" % speech_texts(events)
    )
