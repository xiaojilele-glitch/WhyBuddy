"""ask_user 发出 control_ask_user 后本请求结束。

persist awaitReason=control_ask；reload 仍能看到问题；不是 G_READY ready。
"""

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
from services.rehearsal_control import CHEAP_TURN_FALLBACK
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_ask_user_parks_and_ends_this_request(harness):
    sid = new_sid("ask")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    question = "你想做什么应用？"
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question", {"question": question, "options": ["请假", "报销"]}
    )
    _, events = harness.post(six_fields(sid, "你好"))
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_ask_user" in types
    assert "complete" in types
    # 本请求在提问之后结束，不得再转一轮等用户。
    ask_at = types.index("control_ask_user")
    assert "control_ask_user" not in types[ask_at + 1 :]
    assert types[ask_at:].count("complete") == 1
    assert harness.llm_calls == [harness.llm_calls[0]], "不得空转等用户再调一轮模型"
    ask_events = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask_events[0]["question"] == question
    assert ask_events[0]["options"] == []

    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_ask"
    assert loaded.awaitReason != "ready"
    assert loaded.runtimePhase == "awaiting"
    assert question in str(loaded.awaitDetail or "")
    transcript = loaded.controlTranscript or []
    texts = [row.get("text") for row in transcript if isinstance(row, dict)]
    assert question in texts

    reloaded = load_session(sid)
    assert reloaded is not None
    assert reloaded.awaitReason == "control_ask"
    assert question in str(reloaded.awaitDetail or "")


def test_answer_to_ask_is_tool_result_not_new_user_turn(harness):
    """第 3 格：点选项是纸条回执，不是新开一单。

    真机水果店：点「精修（refine）」左栏画成用户原话，控制面当新话题。
    变异：仍 append kind=turn → 本条红。
    """
    sid = new_sid("ask-answer")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    question = "你想做什么应用？"
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question", {"question": question, "options": ["请假", "报销"]}
    )
    harness.post(six_fields(sid, "你好"))

    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        roles = [m.get("role") for m in messages]
        assert "tool" in roles, f"回执没进 messages：{roles}"
        assert "user" in roles, f"function call 前缺 user：{roles}"
        assert roles.index("user") < roles.index("assistant"), roles
        users = [m for m in messages if m.get("role") == "user"]
        assert not any(
            "请假" == str(m.get("content") or "").strip() for m in users
        ), "答案被当成新的 user 原话"
        assert any(
            "你好" == str(m.get("content") or "").strip() for m in users
        ), f"提问前那句 user 丢了：{users}"
        return llm_text("好，按请假系统做。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "请假"))
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason != "control_ask"
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "请假" not in turns, f"回执写进了 user turn：{turns}"
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert answers and answers[-1].get("text") == "请假"
    assert any(
        e.get("type") == "control_text" and "请假" in str(e.get("text") or "")
        for e in events
    ) or any(e.get("type") == "control_text" for e in events)
    assert rounds["n"] >= 1


def test_ask_answer_empty_llm_does_not_dump_operator_speak(harness):
    """回执后模型空回复：端给人话，不许「请调 pages」。"""
    sid = new_sid("ask-empty")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="你想做什么应用？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user_question",
                "text": "你想做什么应用？",
                "options": ["请假", "报销"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(six_fields(sid, "请假"))
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert "请调 pages" not in blob
    assert "告诉用户为什么先停" not in blob
    assert "SPEC 已经起草" not in blob
    from services.rehearsal_control import CANNED_FAILURE

    assert CANNED_FAILURE not in blob
    assert "说一个要做的应用" not in blob


def test_explicit_tool_answer_payload_is_the_live_path(harness):
    """客户端带 toolAnswer 时同样走回执，不靠猜停泊态。"""
    sid = new_sid("ask-payload")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="下一跳做什么？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user_question",
                "text": "下一跳做什么？",
                "reqId": "need-live1",
                "options": ["精修（refine）", "画页面（pages）"],
            }
        ],
        specFirstPages={
            "spec": {"appName": "店", "pages": [{"id": "p1"}]},
            "pages": {"p1": "<html></html>"},
        },
        modelVersions=[{"id": "v1", "model": {"pages": {}}}],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("精修这一轮做完了。")
    _, events = harness.post(
        six_fields(
            sid,
            "精修（refine）",
            toolAnswer={"kind": "ask_user_question", "text": "精修（refine）", "reqId": "need-live1"},
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "turn"
    ]
    assert "精修（refine）" not in turns
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert answers and answers[-1].get("text") == "精修（refine）"
    # Artifacts and a question answer do not replace explicit plan approval.
    assert not harness.helper_calls
    # 反向：第一版 _settled(_dispatch_tool) 直接 return，工厂 complete 被
    # nest 掉，host 零 LLM、客户端报推演中断。
    assert harness.llm_calls, "refine 回执没有交回 host"
    assert event_types(events)[-1] == "complete", event_types(events)


def test_legacy_confirmation_text_cannot_replace_structured_assumption_answers(harness):
    """Free text is not a questionnaire receipt or plan approval."""
    sid = new_sid("ask-assumptions")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {
                "appName": "请假",
                "pages": [{"id": "p1", "name": "申请"}],
                "nodes": [],
                "assumptions": [{"id": "a1", "topic": "登录"}],
            },
            "pages": {},
            "assumptionsConfirmed": False,
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "假设已确认。继续画页面。" in turns
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert not answers
    assert not harness.helper_calls
    assert harness.llm_calls
    assert event_types(events)[-1] == "complete"
    sfp = loaded.specFirstPages or {}
    assert sfp.get("assumptionsConfirmed") is False


def test_fresh_utterance_is_still_a_user_turn(harness):
    """反向：没有停泊提问时，人话仍是 HumanIntent，不许一律当成纸条。"""
    sid = new_sid("fresh-turn")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    harness.llm_impl = lambda messages, **kw: llm_text("收到。")
    harness.post(six_fields(sid, "把提交按钮改成红色"))
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "把提交按钮改成红色" in turns
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert not answers, f"普通原话被当成了纸条：{answers}"


def test_unconfirmed_assumptions_plain_text_does_not_steal_pages(harness):
    """反向：假设卡摊着但用户没点确认，不许当纸条、不许偷画页。"""
    sid = new_sid("ask-no-confirm")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {
                "appName": "请假",
                "pages": [{"id": "p1"}],
                "assumptions": [{"id": "a1", "topic": "登录"}],
            },
            "pages": {},
            "assumptionsConfirmed": False,
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("还在等你确认假设。")
    _, events = harness.post(six_fields(sid, "再想想"))
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "turn"
    ]
    assert "再想想" in turns
    assert not any(
        isinstance(row, dict) and row.get("kind") == "user_answer"
        for row in (loaded.controlTranscript or [])
    )
    assert not harness.helper_calls, f"没确认就画页了：{event_types(events)}"


def test_ask_user_without_product_drops_meaning_chips(harness):
    """空会话不许把任意话拆成「这是哪种意思」的芯片。

    变异：仍把模型的 options 原样 park → 本条红。
    """
    sid = new_sid("ask-chips")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question",
        {
            "question": "Hello! How can I help you today?",
            "options": [
                "Greeting / General conversation",
                "SMTP protocol command (HELO)",
            ],
        },
    )
    _, events = harness.post(six_fields(sid, "helo"))
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, event_types(events)
    assert ask[0].get("options") == []
    assert "SMTP" not in str(ask[0].get("options"))
    assert "Greeting" not in str(ask[0].get("options"))


def test_ask_user_with_product_keeps_options(harness):
    """反向：已经有产品目标时，问句和选项还是模型给的。"""
    sid = new_sid("ask-keep")
    seed_session(sid, goal={"text": "请假系统", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question",
        {"question": "给谁用？", "options": ["员工", "主管"]},
    )
    _, events = harness.post(six_fields(sid, "下一步"))
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, event_types(events)
    assert ask[0]["question"] == "给谁用？"
    assert ask[0]["options"] == ["员工", "主管"]


def test_first_product_turn_keeps_options_before_goal_is_stamped(harness):
    """首轮产品话题尚未写进 goal 时，也不能把选择项静默删掉。

    真机截图中的形态就是这条路径：用户先说完整产品目标，控制面同一轮
    调 ask_user_question；goal 仍是空占位，但题目已有真实选项。此前分发器
    只看 `_has_product_topic(state)`，于是前端只能看到自动补的「其他」。
    反向判据：廉价问候仍由上一条测试保证会收窄成开放问句。
    """
    sid = new_sid("ask-first-product")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question",
        {
            "questions": [
                {
                    "question": "主要面向哪种终端使用？",
                    "options": [
                        {"label": "桌面端", "description": "适合财务和审批人员"},
                        {"label": "移动端", "description": "适合外出审批"},
                    ],
                }
            ]
        },
    )
    _, events = harness.post(six_fields(sid, "做一个采购审批应用，包含采购单、经理审批、财务确认和字段权限"))
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, event_types(events)
    assert [o["label"] for o in ask[0]["questions"][0]["options"]] == ["桌面端", "移动端"]


def test_mixed_script_todo_list_keeps_options_before_goal_is_stamped(harness):
    """2026-09-18 真机 sr-20260918103119-06YZQ65BJE。

    用户原话「做一个todo list」——3 个汉字 + 英文产品名。goal 仍是空占位。
    模型问核心功能并带了选项。上一版 `_is_cheap_chat` 只数汉字 < 4，
    当闲聊，分发器把 options 整表换成 []；落盘
    `questions[0].options == []`，卡上只剩前端自动补的「其他（自己写）」。

    判据喂这一发的原话，不另拼一句更长的中文让护栏成立。
    反向：helo 仍由 test_ask_user_without_product_drops_meaning_chips 收窄。
    """
    sid = new_sid("ask-todo-list")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user_question",
        {
            "questions": [
                {
                    "question": "您希望这个 Todo List 包含哪些核心功能？（可多选）",
                    "multi_select": True,
                    "options": [
                        {"label": "添加 / 完成任务"},
                        {"label": "截止日期与提醒"},
                        {"label": "清单分组"},
                    ],
                }
            ]
        },
    )
    _, events = harness.post(six_fields(sid, "做一个todo list"))
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, event_types(events)
    assert [o["label"] for o in ask[0]["questions"][0]["options"]] == [
        "添加 / 完成任务",
        "截止日期与提醒",
        "清单分组",
    ]
    assert ask[0]["questions"][0].get("multiSelect") is True
    parked = load_session(sid)
    assert parked is not None
    row = next(
        r
        for r in (parked.controlTranscript or [])
        if isinstance(r, dict) and r.get("kind") == "ask_user_question"
    )
    assert [o.get("label") for o in (row.get("questions") or [{}])[0].get("options") or []] == [
        "添加 / 完成任务",
        "截止日期与提醒",
        "清单分组",
    ]


def test_todo_list_live_path_does_not_offer_omit_options_schema(harness):
    """通电：HTTP 那一发递给模型的 ask_user_question 说明不许写「不要给选项」。

    只测 list_control_tools 会漏掉「清单在 user turn 落盘之前就编好了」。
    变异：list_control_tools 仍只看 `_has_product_topic` → 本条红。
    """
    sid = new_sid("ask-todo-schema")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    offered: list = []

    def impl(messages, **kw):
        offered.extend(kw.get("tools") or [])
        return llm_tool(
            "ask_user_question",
            {
                "questions": [
                    {
                        "question": "您期望的 Todo List 具备哪些核心功能？",
                        "options": [
                            {"label": "添加 / 完成任务"},
                            {"label": "截止日期与提醒"},
                        ],
                    }
                ]
            },
        )

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "做一个Todo List"))
    assert [e for e in events if e.get("type") == "control_ask_user"], event_types(events)
    ask = next(
        t["function"]
        for t in offered
        if (t.get("function") or {}).get("name") == "ask_user_question"
    )
    assert "不要给选项" not in str(ask.get("description") or "")


def test_need_answer_messages_put_user_before_function_call():
    """Gemini 400：function call 不能直接跟在 system 后面。

    ⚠ 2026-09-08：回执路径 system → assistant(tool_calls) → tool，
      网关 v_api_biz_error「function call turn comes immediately after
      a user turn or after a function response turn」。
    变异：拿掉那句 user → roles 仍以 assistant 开头 → 本条红。
    变异：把答案写进 user → 请假变成新话题 → 本条红。
    """
    from services.rehearsal_control import _messages_after_need_answer

    sid = new_sid("need-order")
    state = seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "其他含义"},
            {
                "role": "assistant",
                "kind": "ask_user_question",
                "text": "想做什么？",
                "reqId": "need-abc",
            },
        ],
    )
    msgs = _messages_after_need_answer(
        state, "请假", {"kind": "ask_user_question", "text": "请假", "reqId": "need-abc"}
    )
    roles = [m.get("role") for m in msgs]
    assert roles == ["system", "user", "assistant", "tool"], roles
    assert msgs[1]["content"] == "其他含义"
    assert "请假" not in str(msgs[1].get("content") or "")
    assert msgs[2]["tool_calls"][0]["function"]["name"] == "ask_user_question"
    assert "请假" in str(msgs[3].get("content") or "")


def test_repair_inserts_user_when_function_call_follows_system():
    from services.rehearsal_control import _repair_function_call_turn_order

    raw = [
        {"role": "system", "content": "把这件事做完。"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "need-1",
                    "type": "function",
                    "function": {"name": "ask_user_question", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "need-1", "content": "{}"},
    ]
    out = _repair_function_call_turn_order(raw, fallback_user="其他含义")
    roles = [m.get("role") for m in out]
    assert roles == ["system", "user", "assistant", "tool"], roles
    assert out[1]["content"] == "其他含义"
    # 已经合法的序列不许再插一条 user。
    again = _repair_function_call_turn_order(out, fallback_user="别插")
    assert [m.get("role") for m in again] == roles
    assert again[1]["content"] == "其他含义"
