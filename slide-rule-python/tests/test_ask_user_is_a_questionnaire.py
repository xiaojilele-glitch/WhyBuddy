# -*- coding: utf-8 -*-
"""问用户：一次几道、每项带解释、答案原样回喂。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/ask_user_question/`

上一版的入参是 `{question: str, options: string[]}`——一道题、选项只有标签。
真机上模型想说清「选它意味着什么」无处可写，就把解释塞进 question，卡上一大坨字；
而用户要拿的主意常常不止一件，一次只能问一道就只能连问三轮。

判据分三层，缺任何一层这条就白改：

1. **纯函数层**——形状认得全（grok 形状、老形状、字符串选项）。
2. **活路径层**——走 harness 真分发，量 `control_ask_user` 事件里到底有什么。
   只测纯函数的话，把分发处的 `coerce_questions` 换回 `args.get("options")`
   照样全绿——本仓 §一那个形状（`plan_todo` 已经栽过两次）。
3. **反向层**——认不出任何一道题时不许静默出一张空卡（§三）。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.user_questions import (
    CANCEL_TEXT,
    MAX_OPTIONS,
    MAX_QUESTIONS,
    coerce_questions,
    format_accepted,
    format_chat_about_this,
    format_skip_interview,
    normalize_answers,
    unanswered_text,
)

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


#: 2026-09-10 抄进来时用的 grok 形状原样载荷。
GROK_SHAPE = [
    {
        "question": "患者怎么登录？",
        "options": [
            {"label": "手机号 + 验证码（推荐）", "description": "最通用，不用记密码"},
            {"label": "微信授权", "description": "一键，但绑死微信生态"},
        ],
    },
    {
        "question": "预约能提前多久？",
        "options": [{"label": "7 天"}, {"label": "30 天"}],
        "multi_select": True,
    },
]


# ── 一、纯函数：形状认得全 ────────────────────────────────────────────────


def test_grok形状原样认得下():
    rows = coerce_questions(GROK_SHAPE)
    assert [r["question"] for r in rows] == ["患者怎么登录？", "预约能提前多久？"]
    assert rows[0]["options"][0]["description"] == "最通用，不用记密码"
    assert rows[1].get("multiSelect") is True
    assert rows[0].get("multiSelect") is None, "没写 multi_select 的题不许变成多选"


def test_老形状也要认_模型学过上一版():
    """`{question, options: string[]}` 是上一版的入参，模型一定还会那么填。
    不认就等于把真机上最常见的那一发静默丢掉。"""
    rows = coerce_questions([{"question": "谁来用？", "options": ["前台", "医生"]}])
    assert len(rows) == 1
    assert [o["label"] for o in rows[0]["options"]] == ["前台", "医生"]


def test_整条是字符串也认():
    assert coerce_questions("要做成手机还是桌面？")[0]["question"] == "要做成手机还是桌面？"


def test_题数和选项数都有上限():
    many = [{"question": f"第{i}题", "options": [f"o{j}" for j in range(9)]} for i in range(9)]
    rows = coerce_questions(many)
    assert len(rows) == MAX_QUESTIONS
    assert all(len(r["options"]) <= MAX_OPTIONS for r in rows)


def test_没有问句的题整条丢掉_但不许留个空壳():
    rows = coerce_questions([{"options": ["A", "B"]}, {"question": "真问题"}])
    assert [r["question"] for r in rows] == ["真问题"]


def test_单选送裸字符串也算数():
    """抄 grok `deserialize_string_or_vec_answers`：`"值"` 与 `["值"]` 都认。
    收窄成只认数组 = 把单选那一半静默丢掉。"""
    assert normalize_answers({"q1": "手机号"}) == {"q1": ["手机号"]}
    assert normalize_answers({"q1": ["a", "b"]}) == {"q1": ["a", "b"]}


# ── 二、纯函数：四条结果文案 ──────────────────────────────────────────────


def test_回喂必须带问句原文():
    """模型这一发看不到自己上一发问了什么。只回一个「A」它无从对应——
    真机上会当成新信息又问一遍。"""
    rows = coerce_questions(GROK_SHAPE)
    said = format_accepted(rows, normalize_answers({"q1": "微信授权"}))
    assert "患者怎么登录？" in said
    assert "微信授权" in said


def test_多选把标签接起来_用户补充也带上():
    rows = coerce_questions(GROK_SHAPE)
    said = format_accepted(
        rows,
        normalize_answers({"q2": ["7 天", "30 天"]}),
        {"q2": "老人多，别搞太复杂"},
    )
    assert "7 天、30 天" in said
    assert "老人多，别搞太复杂" in said


def test_没答的题不许出现在回喂里():
    """反向：不是补一句「未回答」——那会让模型去追问已经跳过的事。"""
    rows = coerce_questions(GROK_SHAPE)
    said = format_accepted(rows, normalize_answers({"q1": "微信授权"}))
    assert "预约能提前多久" not in said


def test_拒答不是错误_是一条正常的用户决定():
    """grok 专门给 cancel 写了一句 purpose-built message 而不是复用权限拒绝那串。
    回成 error 会让模型以为自己调错了，换个花样再问一遍。"""
    assert unanswered_text() == CANCEL_TEXT
    assert "按你自己的判断继续" in CANCEL_TEXT
    assert "错误" not in CANCEL_TEXT and "失败" not in CANCEL_TEXT


def test_想聊聊和别再问了必须分得开():
    """混成一句，模型下一轮还会再问一遍。"""
    rows = coerce_questions(GROK_SHAPE)
    picks = normalize_answers({"q1": "微信授权"})
    chat = format_chat_about_this(rows, picks)
    skip = format_skip_interview(rows, picks)
    assert chat != skip
    assert "换个问法再问" in chat
    assert "不要再调问答工具" in skip
    assert "换个问法" not in skip


# ── 三、活路径：走真分发，量事件里到底有什么 ──────────────────────────────


def _ask_with(harness, args):
    sid = new_sid("askq")
    seed_session(sid, goal={"text": "社区诊所预约与排班系统", "status": "clear"})
    harness.llm_impl = lambda m, **k: (
        llm_tool("ask_user_question", args, call_id="ask")
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "帮我定几件事"))
    return sid, events


def test_活路径上每一道题都到得了前端(harness):
    """⚠ 只测 `coerce_questions` 的话，把分发处换回 `args.get("options")`
    照样全绿——那正是本仓 §一 反复记的形状。这一条走 harness。"""
    _, events = _ask_with(harness, {"questions": GROK_SHAPE})
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, [e.get("type") for e in events]
    rows = ask[-1].get("questions")
    assert isinstance(rows, list) and len(rows) == 2, ask[-1]
    assert rows[0]["options"][0]["description"] == "最通用，不用记密码"
    assert rows[1].get("multiSelect") is True


def test_老字段仍是第一道题的投影(harness):
    """`question` / `options` 留着给水合和 `_last_need_question` 用。
    两边说的必须是**同一道题**，否则刷新之后摊回来的是另一张卡。"""
    _, events = _ask_with(harness, {"questions": GROK_SHAPE})
    ask = [e for e in events if e.get("type") == "control_ask_user"][-1]
    assert ask["question"] == ask["questions"][0]["question"]
    assert ask["options"] == [o["label"] for o in ask["questions"][0]["options"]]


def test_活路径上老形状照样问得出来(harness):
    _, events = _ask_with(
        harness, {"question": "谁来用？", "options": ["前台", "医生"]}
    )
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, [e.get("type") for e in events]
    assert ask[-1]["questions"][0]["question"] == "谁来用？"
    assert ask[-1]["options"] == ["前台", "医生"]


def test_一道题都认不出时不许出空卡(harness):
    """反向那半（§三）：认不出就 fail-closed，不许 `ok: true` 配一张空卡。
    `plan_todo` 就是这个形状栽过两次。"""
    _, events = _ask_with(harness, {"questions": [{"options": ["A"]}]})
    assert not [e for e in events if e.get("type") == "control_ask_user"], events
    res = [
        e
        for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "ask_user_question"
    ]
    assert res and res[-1].get("ok") is False, res
    assert "题" in str(res[-1].get("error") or "")


def test_结构化答案按grok那套回喂给模型(harness):
    """第二发采样时，模型收到的必须是**这一层**造的那段话，
    不是前端拼的自然语言（措辞归服务端拥有，§四）。"""
    sid = new_sid("askq-answer")
    seed_session(sid, goal={"text": "社区诊所预约与排班系统", "status": "clear"})
    harness.llm_impl = lambda m, **k: (
        llm_tool("ask_user_question", {"questions": GROK_SHAPE}, call_id="ask")
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    harness.post(six_fields(sid, "帮我定几件事"))

    seen: list = []
    harness.llm_impl = lambda m, **k: (seen.append(m), llm_text("知道了"))[1]
    payload = six_fields(sid, "微信授权")
    payload["toolAnswer"] = {
        "kind": "ask_user_question",
        "outcome": "accepted",
        "answers": {"q1": ["微信授权"], "q2": ["7 天", "30 天"]},
        "notes": {"q1": "老人多"},
    }
    harness.post(payload)

    blob = "\n".join(
        str(msg.get("content") or "") for turn in seen for msg in turn
    )
    assert "患者怎么登录？" in blob, blob[-600:]
    assert "7 天、30 天" in blob, blob[-600:]
    assert "老人多" in blob, blob[-600:]


def test_拒答走的是那句话而不是报错(harness):
    sid = new_sid("askq-cancel")
    seed_session(sid, goal={"text": "社区诊所预约与排班系统", "status": "clear"})
    harness.llm_impl = lambda m, **k: (
        llm_tool("ask_user_question", {"questions": GROK_SHAPE}, call_id="ask")
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    harness.post(six_fields(sid, "帮我定几件事"))

    seen: list = []
    harness.llm_impl = lambda m, **k: (seen.append(m), llm_text("那我自己定"))[1]
    payload = six_fields(sid, "")
    payload["toolAnswer"] = {"kind": "ask_user_question", "outcome": "cancelled"}
    harness.post(payload)

    blob = "\n".join(
        str(msg.get("content") or "") for turn in seen for msg in turn
    )
    assert "按你自己的判断继续" in blob, blob[-400:]


def test_工具说明里那两句承诺不许掉(harness):
    """抄 grok `description_template` 的两句。第一句是**给渲染侧的承诺**，
    掉了模型就会自己往 options 里塞一个「其他」，卡上出现两个其他。"""
    from services.rehearsal_control import CONTROL_TOOLS

    desc = next(
        t["function"]["description"]
        for t in CONTROL_TOOLS
        if t["function"]["name"] == "ask_user_question"
    )
    assert "其他（自己写）" in desc, desc
    assert "你不要自己加" in desc, desc
    assert "（推荐）" in desc, desc
