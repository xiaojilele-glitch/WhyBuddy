"""廉价跟进不是产品。真机载荷，不许自己拼一个让护栏成立的输入。

⚠ 2026-09-08 会话标题「继续」：

  1. 问候 ask_user 芯片「继续」→ NeedUserAnswer
     `_stamp_user_answer` 把「继续」写成 goal
     模型空回复 empty_text=CANNED_FAILURE
     左栏：「我是面团的推演引擎。说一个要做的应用…」
  2. 用户问「你能做啥」（能力问答，不是产品）
     `_has_product_topic` 只排除问候表，继续 / 你能做啥都算产品
     `_can_auto_grant_scope` 只数「去标点 ≥4 字」
     你能做啥(4) + goal 继续 → 自动授予 → 点着 SPEC，六步钟亮起

变异：把空回复改回 CANNED_FAILURE、把「继续」再写进 goal、
把 auto-grant 改回纯字数 → 本文件红。
反向：真需求「街边早餐摊收银台」「请假」仍是产品。
"""
from __future__ import annotations

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.rehearsal_control import (
    CANNED_FAILURE,
    CHEAP_TURN_FALLBACK,
    _ask_is_cheap_intake,
    _has_product_topic,
    _is_cheap_chat,
    _system_prompt,
    _unstamped_product_turn,
    list_control_tools,
)
from services.slide_rule_session import load_session
from services.scope_authority import plan_execution_authorized
from sliderule_llm.control_client import ControlLlmResult

pytest.importorskip("fastapi")

LIVE_CONTINUE = "继续"
LIVE_META = "你能做啥"
REAL_TOPIC = "街边早餐摊收银台"


def _names(state) -> set:
    return {t["function"]["name"] for t in list_control_tools(state)}


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_mixed_script_todo_list_is_an_unstamped_product():
    """2026-09-18 真机 sr-20260918103119-06YZQ65BJE 的原话。

    goal 空，所以 `_has_product_topic` 仍是假；但当前这句已经是产品，
    `_unstamped_product_turn` 必须把它交出去。上一版 `_is_cheap_chat`
    只数汉字，3 个就当闲聊，选项被整表删掉。
    """
    live = "做一个todo list"
    assert _is_cheap_chat(live) is False
    assert _is_cheap_chat("你好") is True
    assert _is_cheap_chat("hello") is True
    st = V5SessionState(
        sessionId="sr-20260918103119-06YZQ65BJE",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": live}],
    )
    assert _has_product_topic(st) is False
    assert _unstamped_product_turn(st) == live
    assert _ask_is_cheap_intake(st) is False


def _ask_description(state) -> str:
    ask = next(
        t["function"]
        for t in list_control_tools(state)
        if t["function"]["name"] == "ask_user_question"
    )
    return str(ask.get("description") or "")


def test_unstamped_todo_list_does_not_tell_the_model_to_omit_options():
    """2026-09-18 真机 sr-20260918103947-G434QZHGQ7 重启后仍无选项。

    分发器已经不再删 options，但 `list_control_tools` 只看 goal。
    首轮 goal 空，工具说明被改成「不要给选项」。模型照做，
    落盘 questions[0].options == []，卡上又只剩「其他」。
    反向：问候仍要那句，免得 hello 又被拆成选择题。
    """
    live = V5SessionState(
        sessionId="sr-20260918103947-G434QZHGQ7",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "做一个Todo List"}
        ],
    )
    assert "不要给选项" not in _ask_description(live)
    hello = V5SessionState(
        sessionId="cheap-hello-desc",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": "你好"}],
    )
    assert "不要给选项" in _ask_description(hello)


def test_empty_goal_is_not_a_product_even_if_user_said_hello():
    """不看当前这句话。goal 空 = 没产品，hello / 你能做啥 都一样。"""
    st = V5SessionState(
        sessionId="cheap-hello",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hello"},
        ],
    )
    assert _has_product_topic(st) is False
    st.controlTranscript = [{"role": "user", "kind": "turn", "text": LIVE_META}]
    assert _has_product_topic(st) is False
    st.goal = {"text": LIVE_CONTINUE, "status": "needs_refinement"}
    assert _has_product_topic(st) is False
    st.goal = {"text": REAL_TOPIC, "status": "clear"}
    assert _has_product_topic(st) is True


def test_auto_grant_rejects_the_live_pair():
    """Neither a real product nor a conversational reply is plan approval."""
    for topic in (LIVE_META, LIVE_CONTINUE, "hello", REAL_TOPIC):
        state = V5SessionState(sessionId="no-auto-grant", goal={"text": topic})
        assert not plan_execution_authorized(state)


def test_continue_and_meta_do_not_list_write_tools():
    """没写入 goal 就不列问卷 / 范围卡。当前这句话随便说。"""
    for text in (LIVE_CONTINUE, LIVE_META, "hello", "早上好"):
        st = V5SessionState(
            sessionId=f"cheap-list-{text}",
            goal={"text": "", "status": "needs_refinement"},
            controlTranscript=[{"role": "user", "kind": "turn", "text": text}],
        )
        names = _names(st)
        assert "clarify" not in names, text
        # ⚠ 2026-09-09 照 grok 改：清单不猜意图（`ListToolsContext` 里没有用户消息，grok 全仓只有 3 处管道层覆写 `should_list`）。保证挪到分发层——模型硬挑 scope_card 也不画卡，只再问一句。
        assert "spec" not in names, text
        assert "rehearse" not in names, text
        assert "ask_user_question" in names, text
    clinic = V5SessionState(
        sessionId="cheap-list-clinic",
        goal={"text": "诊所系统", "status": "needs_refinement"},
    )
    assert "write_plan" in _names(clinic)
    assert "scope_card" not in _names(clinic)
    assert "clarify" not in _names(clinic)


def test_prompt_does_not_report_missing_dims_on_meta():
    for text in ("", LIVE_CONTINUE):
        hi = _system_prompt(
            V5SessionState(
                sessionId=f"cheap-prompt-{text or 'empty'}",
                goal={"text": text, "status": "needs_refinement"},
            )
        )
        assert "还没读到" not in hi, text


def test_cheap_speech_park_is_on_the_live_no_calls_path():
    """变异：把 if not calls 里的 _park_ask 删掉 → 本条红。

    ⚠ 2026-09-09：原来是 `src.find("if not calls:")` 从**全文件**找第一处。
      加原地打转分档时 `_step_is_problematically_repeating` 里也有一句
      `if not calls:`（空轮不算重复的调用），而它排在文件靠前——锚点静静地
      挪到了另一个函数上，判据开始量一段跟它无关的代码。
      这跟 CLOSED_TOOLS 那次 `ts.index("] as const;")` 匹配到 FACTORY_HOPS
      是同一种伤：**先定位到那个函数，再在它之后找**。
    """
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    fn = src.find("async def _control_llm_loop")
    assert fn > 0, "活路径那个函数改名了，这条判据的锚点得跟着改"
    at = src.find("if not calls:", fn)
    assert at > 0
    chunk = src[at : at + 1800]
    assert "_park_ask" in chunk
    assert "CHEAP_TURN_FALLBACK" in chunk
    assert "_has_ask_answer_candidate" in chunk


def test_ask_answer_does_not_refresh_original_goal_from_the_stamp():
    """变异：stamp 之后又写 original_goal = _goal_text / or user_text → 红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    at = src.find("await _stamp_user_answer")
    assert at > 0
    chunk = src[at : at + 900]
    assert "if not original_goal" not in chunk
    assert "original_goal or user_text" not in chunk


def test_a_greeting_gets_no_card_even_when_the_model_picks_scope_card(harness):
    """模型**硬挑** scope_card，会话只有「你好」→ 不画卡，只再问一句。

    ⚠ 2026-09-09：这条是清单那层撤掉之后，「你好不许得到一张卡」这条保证的新家。

      原来靠 `should_list` 不把 scope_card 摆出来——模型看不见就挑不了。
      照 grok 改成清单不猜意图之后（它的 `ListToolsContext` 里根本没有用户
      消息，全仓只有 3 处管道层覆写 `should_list`），那道防线没了。

      但换来的这道更强：**就算模型挑了，分发那层也不画卡**。前者只是不诱惑
      模型，后者是模型受了诱惑也没用。真机验过同一件事——范围卡摆在菜单上，
      模型自己没挑（`offered=[ask_user, scope_card] picked=[]`）；这条判据
      钉的是它万一挑了的那种情况。

    反向：同一条路上换成真产品，卡照出、火照点（见
    `test_scope_card_tool_ignites_without_waiting`）。
    """
    sid = new_sid("hello-forced-card")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": "你好"}],
    )
    harness.llm_impl = lambda m, **k: llm_tool("scope_card", {"restatement": "你好"})
    _, events = harness.post(six_fields(sid, "你好"))
    types = event_types(events)
    assert "control_scope_card" not in types, f"问候被画成了范围卡：{types}"
    assert harness.helper_calls == [], f"问候点着了工厂：{types}"
    assert "control_ask_user" in types, f"没画卡也得问一句，不能干瞪眼：{types}"
    assert types[-1] == "complete", types


def test_gibberish_ask_answer_does_not_ignite_spec(harness):
    """真机：hello 停在提问，回执 sfljsdlf → 我认成了 + 点着 SPEC。

    回执不是本回合开始时就有的产品目标，scope_card 不许同一跳点火。
    """
    sid = new_sid("cheap-gibber")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail=CHEAP_TURN_FALLBACK,
        runtimePhase="awaiting",
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hello"},
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": CHEAP_TURN_FALLBACK,
                "reqId": "need-gib",
            },
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "scope_card", {"restatement": "sfljsdlf"}
    )
    _, events = harness.post(
        six_fields(
            sid,
            "sfljsdlf",
            toolAnswer={"kind": "ask_user", "text": "sfljsdlf", "reqId": "need-gib"},
        )
    )
    types = event_types(events)
    assert harness.helper_calls == [], f"乱码回执点着了工厂：{types}"
    assert "control_handoff_factory" not in types
    loaded = load_session(sid)
    assert loaded is not None
    goal = (loaded.goal or {}).get("text") if isinstance(loaded.goal, dict) else ""
    assert goal != "sfljsdlf", f"乱码回执被写成了目标：{goal!r}"
    assert types[-1] == "complete", types


def test_need_answer_continue_does_not_stamp_goal_or_dump_canned(harness):
    """真机路径 1：芯片「继续」是纸条回执，不是产品名，空回复不许套开场罐头。"""
    sid = new_sid("cheap-continue")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="请问有什么需要帮助的？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": "请问有什么需要帮助的？",
                "options": ["继续", "退出"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(
        six_fields(
            sid,
            LIVE_CONTINUE,
            toolAnswer={"kind": "ask_user", "text": LIVE_CONTINUE},
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    goal = (loaded.goal or {}).get("text") if isinstance(loaded.goal, dict) else ""
    assert goal != LIVE_CONTINUE, f"芯片「继续」被写成了目标：{goal!r}"
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert CANNED_FAILURE not in blob
    assert "说一个要做的应用" not in blob
    assert "请调 pages" not in blob
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert CHEAP_TURN_FALLBACK in blob or ask or any(texts)
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)


def test_neng_zuo_sha_does_not_ignite_spec(harness):
    """真机路径 2：goal 已被芯片写成继续，用户问你能做啥，夹具硬挑 spec。

    旧尺子字数够 → 自动授予 → helper≥1。删掉产品话题判定本条必红。
    """
    sid = new_sid("cheap-meta")
    seed_session(
        sid,
        goal={"text": LIVE_CONTINUE, "status": "needs_refinement"},
    )
    harness.llm_impl = lambda messages, **kw: llm_tool("spec", {})
    _, events = harness.post(six_fields(sid, LIVE_META))
    types = event_types(events)
    assert harness.helper_calls == [], (
        "「你能做啥」点着了工厂。"
        f"事件：{types}"
    )
    assert "control_handoff_factory" not in types
    listed = []
    for call in harness.llm_calls:
        tools = (call.get("kwargs") or {}).get("tools") or []
        listed.extend(
            (t.get("function") or {}).get("name")
            for t in tools
            if isinstance(t, dict)
        )
    assert "spec" not in listed, f"能力问答还把 spec 列给模型：{listed}"


def test_composer_nihao_does_not_answer_a_stuck_clarify_card(harness):
    """卡还摊着时，作曲家打「你好」是新话，不是答谁用。"""
    sid = new_sid("cheap-dismiss-clarify")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_clarify",
        awaitDetail="请问这款产品主要面向哪类用户？",
        runtimePhase="awaiting",
        coverageGaps=[
            {
                "id": "gap-q-stuck",
                "kind": "open_question",
                "label": "请问这款产品主要面向哪类用户？",
                "status": "open",
                "reason": "control_plane_clarify",
                "createdAt": "2026-09-08T00:00:00Z",
            }
        ],
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "clarify",
                "text": "请问这款产品主要面向哪类用户？",
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("请问有什么需要帮助的？")
    _, events = harness.post(six_fields(sid, "你好"))
    loaded = load_session(sid)
    assert loaded is not None
    goal = (loaded.goal or {}).get("text") if isinstance(loaded.goal, dict) else ""
    assert goal != "你好", f"「你好」被写成了目标：{goal!r}"
    assert loaded.awaitReason != "control_clarify"
    gaps = [
        g
        for g in (loaded.coverageGaps or [])
        if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None))
        == "open"
    ]
    assert gaps == [], "澄清缺口还开着，卡会粘在下一轮"
    assert "control_clarify" not in event_types(events)
    assert harness.helper_calls == []


def test_continue_execute_does_not_open_a_scope_card(harness):
    """真机：继续执行 → 模型塞 spec → 「我认成了：接续用户指令完成未竟目标」。

    本轮清单没有 spec，调了也不许 park 成产品卡。
    """
    sid = new_sid("cheap-continue-exec")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_tool("spec", {})
    _, events = harness.post(six_fields(sid, "继续执行"))
    types = event_types(events)
    blob = "\n".join(
        str(e.get("text") or e.get("restatement") or "")
        for e in events
        if e.get("type") in ("control_text", "control_scope_card")
    )
    assert "control_scope_card" not in types, types
    assert "接续用户指令" not in blob
    assert harness.helper_calls == []
    listed = []
    for call in harness.llm_calls:
        tools = (call.get("kwargs") or {}).get("tools") or []
        listed.extend(
            (t.get("function") or {}).get("name")
            for t in tools
            if isinstance(t, dict)
        )
    assert "spec" not in listed


def test_cheap_idle_speech_parks_so_next_line_is_receipt(harness):
    """模型空会话只回一句话、不调工具：必须停成 ask_user。

    变异：if not calls 仍 complete 成 control_text → awaitReason 空，
    下一句当新话题。
    """
    sid = new_sid("cheap-speech-park")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_text("Hello! How can I help you today?")
    _, events = harness.post(six_fields(sid, "hello"))
    types = event_types(events)
    assert "control_ask_user" in types
    assert "control_handoff_factory" not in types
    spoken = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    assert any("Hello" in t for t in spoken), spoken
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask and ask[0].get("options") == []
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_ask"
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("role") == "user" and row.get("kind") == "turn"
    ]
    assert "hello" in turns


def test_capability_question_is_not_the_same_canned_line(harness):
    """「你能做什么」必须能听到模型自己的话，不许盖成同一句开场。"""
    sid = new_sid("cheap-what")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.llm_impl = lambda messages, **kw: llm_text(
        "我是面团，可以把一句话推演成能点的应用。"
    )
    _, events = harness.post(six_fields(sid, "你能做什么"))
    spoken = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    assert any("面团" in t for t in spoken), spoken
    assert CHEAP_TURN_FALLBACK not in spoken


def test_capability_question_as_receipt_is_not_the_same_canned_line(harness):
    """真机：前一句已经停成提问，「你能做什么」是回执。

    回执事实若写成「继续问想做什么应用」，空回复再盖 CHEAP_TURN_FALLBACK，
    左栏三轮都是同一句。变异：回执仍 dump 开场罐头 → 本条红。
    """
    sid = new_sid("cheap-what-receipt")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail=CHEAP_TURN_FALLBACK,
        runtimePhase="awaiting",
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hhh"},
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": CHEAP_TURN_FALLBACK,
                "reqId": "need-what",
            },
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text(
        "我是面团，可以把一句话推演成能点的应用。"
    )
    _, events = harness.post(
        six_fields(
            sid,
            "你能做什么",
            toolAnswer={"kind": "ask_user", "text": "你能做什么", "reqId": "need-what"},
        )
    )
    spoken = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    assert any("面团" in t for t in spoken), spoken
    assert CHEAP_TURN_FALLBACK not in spoken
    assert harness.helper_calls == []


def test_ask_user_does_not_hide_model_speech_behind_the_canned_question(harness):
    """模型开口 + 调 ask_user：左栏要听到开口，提问只许当停泊。"""
    sid = new_sid("cheap-speech-ask")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})

    def impl(messages, **kw):
        return ControlLlmResult(
            content="我是面团，可以把一句话推演成能点的应用。",
            tool_calls=[
                {
                    "id": "call-1",
                    "name": "ask_user",
                    "arguments": {"question": CHEAP_TURN_FALLBACK},
                }
            ],
            usage={"total_tokens": 12},
            finish_reason="tool_calls",
            model="ctrl-test",
            latency_ms=1,
        )

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "你能做什么"))
    spoken = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    assert any("面团" in t for t in spoken), spoken
    ask = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask, event_types(events)
    assert "control_handoff_factory" not in event_types(events)


def test_receipt_prompt_lets_the_model_answer_instead_of_copying_the_opener():
    """回执事实不许再教「继续问想做什么应用」——模型会整句照抄。"""
    st = V5SessionState(
        sessionId="cheap-receipt-prompt",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hhh"},
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": CHEAP_TURN_FALLBACK,
            },
            {"role": "tool", "kind": "user_answer", "text": "你能做什么"},
        ],
    )
    text = _system_prompt(st)
    assert "先用文本回答" in text
    assert "不要每句都用同一句开场" in text
    assert "继续问想做什么应用" not in text
    assert CHEAP_TURN_FALLBACK not in text
    empty = _system_prompt(
        V5SessionState(
            sessionId="cheap-empty-prompt",
            goal={"text": "", "status": "needs_refinement"},
        )
    )
    assert CHEAP_TURN_FALLBACK not in empty
    assert "先用文本回答" in empty


def test_hello_does_not_list_clarify_or_ignite(harness):
    """真机：发 hello 弹出「哪类用户」澄清卡。清单不许有 clarify/spec。"""
    sid = new_sid("cheap-hello")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    listed: list = []

    def impl(messages, **kw):
        tools = kw.get("tools") or []
        listed.extend(
            (t.get("function") or {}).get("name")
            for t in tools
            if isinstance(t, dict)
        )
        return llm_text("请问有什么需要帮助的？")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "hello"))
    assert "clarify" not in listed, listed
    assert "spec" not in listed, listed
    # ⚠ 2026-09-09 照 grok 改：清单不猜意图（`ListToolsContext` 里没有用户消息，grok 全仓只有 3 处管道层覆写 `should_list`）。保证挪到分发层——模型硬挑 scope_card 也不画卡，只再问一句。
    assert "search_evidence" not in listed, listed
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert "control_clarify" not in types
    assert "control_ask_user" in types
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_ask"


def test_need_answer_path_does_not_pass_canned_as_empty_text():
    """变异：把 NeedUserAnswer 的 empty_text 改回 CANNED_FAILURE → 红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "empty_text=CANNED_FAILURE" not in src
    assert "CHEAP_TURN_FALLBACK" in src


def test_product_gate_does_not_enumerate_what_people_say():
    """用户会说任意话。把 hello/你能做啥 写进问候表不是办法。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    at = src.find("def _has_product_topic")
    chunk = src[at : src.find("def should_list_tool", at)]
    assert "hello" not in chunk
    assert "你能做啥" not in chunk
    assert "_goal_text" in src[at : at + 400]
