"""假设卡「确认继续」= forcedTool pages。点火前跳过控制面 LLM。

真机（2026-09-02）：确认只发一句话，控制面去 planning，钟又回到起草 SPEC，
页面框一直 0。选完再继续的下一跳必须是 pages，不是再问一遍控制模型。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_forced_pages_skips_llm_and_sets_goal_tools_pages(harness):
    sid = new_sid("pages-after-spec")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"}
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "pages 点火前不得问控制面模型"
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert harness.helper_calls, "确认继续没有 handoff 工厂"
    assert harness.llm_calls, "工厂之后没有 LLM——确认继续没有交回控制面"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert types[-1] == "complete", (
        f"pages 跳没有 host complete → 客户端报推演中断，实际 {types}"
    )
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["pages"], (
        f"假设确认是 pages 这一跳，不许把剩余课表焊进来。实际 {tools}"
    )
    todo = list(getattr(saved, "factoryTodo", None) or [])
    assert "structure" in todo and "bind" in todo, todo
    sfp = (saved.specFirstPages or {}) if saved else {}
    assert sfp.get("assumptionsConfirmed") is not True, "Plain text is not a structured questionnaire receipt"


def test_forced_rehearse_resets_stale_assumptions_confirmed(harness):
    """首轮链走 rehearse，上一轮的 True 必须清掉，假设卡才能再弹。

    变异：只在 forced=="spec" 时重置 → 本条红。
    """
    sid = new_sid("rehearse-reset-assumptions")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
        specFirstPages={
            "spec": {
                "appName": "旧应用",
                "pages": [{"id": "p1", "name": "首页"}],
                "nodes": [{"id": "n0", "title": "首页"}],
            },
            "assumptionsConfirmed": True,
        },
    )

    def impl(messages, **kw):
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "将做成：请假系统", forcedTool="rehearse"))
    saved = load_session(sid)
    sfp = (saved.specFirstPages or {}) if saved else {}
    assert sfp.get("assumptionsConfirmed") is False, (
        f"rehearse 必须清掉陈旧确认。实际 {sfp.get('assumptionsConfirmed')}"
    )


def test_forced_pages_survives_stale_session_reload(monkeypatch):
    """同一 lastTurnId 改 goal.tools 会被落盘守卫挡住。工厂 reload 后仍必须是 pages。

    变异：把 start_drive_full 里 stamp goal_tools 删掉 → 本条红。
    """
    from services import drive_full_factory as factory
    from services.slide_rule_session import load_session as real_load

    harness = ControlHarness(monkeypatch, live_factory=True)

    def stale_load(sid):
        st = real_load(sid)
        if st is None:
            return None
        goal = dict(st.goal) if isinstance(st.goal, dict) else {}
        goal["tools"] = ["spec"]
        st.goal = goal
        return st

    monkeypatch.setattr(factory, "load_session", stale_load)

    sid = new_sid("pages-stale-reload")
    seed_session(
        sid,
        lastTurnId="turn-2",
        goal={
            "text": "社区图书馆借还书系统",
            "status": "clear",
            "tools": ["spec"],
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"}
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面出来了。")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert harness.helper_calls, "确认继续没有 handoff 工厂"
    assert harness.helper_calls[-1].get("goal_tools") == ["pages"]
    seen = [row.get("tools") for row in harness.generator_calls]
    assert ["pages"] in seen, (
        f"工厂 reload 后 tools 必须仍是 pages 一跳：{seen}"
    )
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert types[-1] == "complete"


def test_structure_card_label_without_forced_tool_skips_llm(harness):
    """收尾卡「进入数据模型反推（Structure）」不带 forcedTool 也必须当 structure。

    2026-09-03 真机：onAnswerAsk 把标签当聊天发出去，控制面去 planning，
    伴随式卡又弹。抄 grok：选项点下去是 typed 答案。
    """
    from services.factory_plan_steps import product_steps_for_tools

    sid = new_sid("structure-from-card")
    seed_session(
        sid,
        goal={"text": "萌芽成长树", "status": "clear", "tools": ["pages"]},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "萌芽成长树"}
        ],
        specFirstPages={
            "spec": {
                "appName": "萌芽成长树",
                "pages": [{"id": "p1", "name": "打卡"}],
                "nodes": [{"id": "n0", "title": "打卡"}],
            },
            "pages": {"p1": "<html>打卡</html>"},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "structure 点火前不得问控制面模型"
        return llm_text("数据模型已经出来。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "进入数据模型反推（Structure）")
    )
    assert harness.helper_calls, "收尾卡没有 handoff 工厂"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert types[-1] == "complete"
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["structure"], f"下一跳 tools 必须是 structure，实际 {tools}"
    steps = (saved.goal or {}).get("productSteps") if saved and isinstance(saved.goal, dict) else None
    assert steps == product_steps_for_tools(["structure"], refine=False), (
        f"钟没跟本跳 tools：{steps}"
    )


def test_structure_hop_factory_stamp_writes_clock_steps(monkeypatch):
    """活路径：工厂信封 reload 之后 productSteps 必须是 structure 的 [4,5,6]。

    假工厂不跑 spec-first，但 start_drive_full 盖章必须在进生成器之前完成。
    变异：信封只写 tools → generator_calls 里 productSteps 仍是上一跳的 [2]。
    """
    from services.factory_plan_steps import product_steps_for_tools

    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("structure-clock")
    seed_session(
        sid,
        lastTurnId="turn-2",
        goal={
            "text": "萌芽成长树",
            "status": "clear",
            "tools": ["pages"],
            "productSteps": [2],
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "萌芽成长树"}
        ],
        specFirstPages={
            "spec": {
                "appName": "萌芽成长树",
                "pages": [{"id": "p1", "name": "打卡"}],
                "nodes": [{"id": "n0", "title": "打卡"}],
            },
            "pages": {"p1": "<html>打卡</html>"},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("数据模型已经出来。")
    _, events = harness.post(
        six_fields(sid, "进入数据模型反推（Structure）")
    )
    assert harness.helper_calls, "没有 handoff 工厂"
    assert harness.helper_calls[-1].get("goal_tools") == ["structure"]
    stamped = [row.get("productSteps") for row in harness.generator_calls]
    want = product_steps_for_tools(["structure"], refine=False)
    assert want in stamped, f"工厂入场钟没跟 structure：{stamped}"
    types = event_types(events)
    assert "control_handoff_factory" in types


def test_handoff_passes_goal_tools():
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    at = src.find("async def _handoff_factory")
    assert at > 0
    body = src[at : at + 2200]
    assert "goal_tools=" in body, "handoff 没把本跳 tools 传进工厂信封"


def test_forced_closed_tools_bind_write_scope():
    """LLM 分发有 tool_scope_scope(name)；forced 那条必须有 tool_scope_scope(forced)。

    变异：把 with tool_scope_scope(forced) 删掉 → pages 点火抛 ToolScopeViolation。
    """
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    hop = src.find("if forced in FACTORY_HOPS")
    assert hop > 0
    hop_body = src[hop : hop + 1600]
    assert "tool_scope_scope(forced)" in hop_body, "pages 分发没绑 WRITE 闸"
    assert "_resume_control_llm_after_write" in hop_body, (
        "pages 工厂后没交回控制面——客户端会报推演中断"
    )
    at = src.find("if forced in CLOSED_TOOLS")
    assert at > hop
    body = src[at : at + 900]
    assert "tool_scope_scope(forced)" in body, "forced 分发没绑 WRITE 闸"


def test_spec_hop_resume_cannot_park_scope_card(harness):
    """选完再继续：SPEC 跳交回后模型想开范围卡，不许把假设面板冲掉。

    已确认后 scope_card 不进清单；即便模型硬调也是 alreadyConfirmed，不 park。
    """
    from control_turn_support import llm_tool

    sid = new_sid("spec-no-scope")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="社区图书馆借还书系统",
    )

    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("scope_card", {"restatement": "社区图书馆借还书系统"})
        return llm_text("页面还没有，下一步画页面。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "将做成：社区图书馆借还书系统", forcedTool="rehearse")
    )
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "control_scope_card" not in types, (
        f"SPEC 跳完又弹出范围卡，假设面板被 pendingScope 藏起来：{types}"
    )
    assert types[-1] == "complete"


def test_assumptions_waiting_resume_completes_before_control_llm():
    """剥注释：假设卡等确认必须自己 complete，不许进控制面 LLM。"""
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    at = src.find("async def _resume_control_llm_after_write")
    end = src.find("async def _control_llm_loop")
    assert at > 0 and end > at
    body = src[at:end]
    wait_at = body.find("_assumptions_awaiting")
    assert wait_at > 0, "交回没有假设卡闸"
    complete_at = body.find("_complete_waiting_for_assumptions", wait_at)
    loop_at = body.find("_control_llm_loop", wait_at)
    assert complete_at > 0, "假设卡等确认没有提前收工"
    assert loop_at < 0 or complete_at < loop_at, (
        "假设卡等确认仍先进控制面 LLM，确认继续会排队"
    )


def test_confirm_ignores_payload_tools_pages_and_keeps_first_pass_rest(harness):
    """确认 POST 常带 tools=['pages']。这一跳就是 pages，剩余进待办。"""
    sid = new_sid("confirm-payload-pages")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        controlTranscript=[
            {
                "id": "ct-1",
                "kind": "scope_card",
                "text": "社区图书馆借还书系统",
                "tools": ["spec", "pages", "structure", "bind", "closure"],
            },
            {"id": "ct-2", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"},
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    harness.post(
        six_fields(
            sid,
            "假设已确认。继续画页面。",
            forcedTool="pages",
            tools=["pages"],
        )
    )
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["pages"], (
        f"确认继续必须是 pages 一跳，实际 {tools}"
    )
    todo = list(getattr(saved, "factoryTodo", None) or [])
    assert "structure" in todo and "bind" in todo, (
        f"剩余产出跳必须进待办，不许丢：{todo}"
    )


def test_later_pages_hop_without_confirm_phrase_stays_one_hop(harness):
    """反向：迭代改页仍是 pages 一跳，不许把 structure/bind 绑上去。"""
    sid = new_sid("pages-iter")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear", "tools": ["pages"]},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
        specFirstPages={
            "spec": {
                "appName": "请假",
                "pages": [{"id": "p1", "name": "申请"}],
            },
            "pages": {"p1": "<html>旧</html>"},
            "assumptionsConfirmed": True,
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("按钮改过了。")
    harness.post(six_fields(sid, "把提交按钮改成红色", forcedTool="pages"))
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["pages"], f"迭代改页被绑上了产出链：{tools}"


def test_forced_pages_without_spec_does_not_invent_pages(harness):
    """反向：没有 SPEC 不许空转画页。变异：把 blocker 删掉 → 本条红。"""
    sid = new_sid("pages-no-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("不该走到这里")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert not harness.helper_calls, "没有 SPEC 还 handoff 了工厂"
    assert not harness.llm_calls, "没有 SPEC 还去问了控制面模型"
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert types[-1] == "complete"


def test_forced_bind_without_pages_says_so(harness):
    """建设单 O-4：空会话单跳 bind 闸说人话，不许抛、不许静默跑零页。"""
    sid = new_sid("bind-no-pages")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("不该走到这里")
    _, events = harness.post(
        six_fields(sid, "去绑权限", forcedTool="bind")
    )
    assert not harness.helper_calls, "没有页面还 handoff 了工厂"
    types = event_types(events)
    assert "control_handoff_factory" not in types
    texts = "\n".join(str(e.get("text") or "") for e in events)
    assert "还没有页面" in texts
    assert types[-1] == "complete"


def test_回执范围卡点火之后整轮仍有终局(harness):
    """`gate: False` 的范围卡是**回执**，同一发后面就跟着 handoff。
    这一轮**必须**有终局事件。

    ⚠ 2026-09-10 浏览器那条路量到的：上一版把回执也记成 parked，
      `if parked: return` 在工厂转播完之后立刻返回，整轮没有 `complete`。
      前端 `classifyStreamFallback` 见不到终局就判 `report_interrupted`，
      于是每一趟自动点火的推演最后都弹「推演连接中断，后台仍在进行」，
      而且 `_resume_control_llm_after_write` 整段被跳过。

      脚本那条路当时是绿的——探针读到 `factory_complete` 就 break 了，
      根本没读到流的结尾（判据自己把证据截断了，本仓 §二）。
    """
    from control_turn_support import llm_tool

    sid = new_sid("receipt-terminal")
    seed_session(sid, goal={"text": "宠物美容店的预约与会员卡系统"})

    def impl(messages, **kw):
        # 复述由 `_restate` 真跑出来，判据不许自己编一句（见
        # test_declined_scope_reaches_the_model 头注）。
        if len(harness.llm_calls) == 1:
            return llm_tool("spec", {}, call_id="spec")
        return llm_text("SPEC 出来了。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "做一个宠物美容店的预约与会员卡系统"))
    types = event_types(events)
    assert "control_scope_card" not in types, types
    assert "control_handoff_factory" in types, (
        f"回执卡没点火，这条判据测的就不是那条路了：{types}"
    )
    # 正向：有终局。
    assert types[-1] in ("complete", "factory_complete"), (
        f"点了火却没有终局事件——前端会判成断线：{types}"
    )
    # 反向：终局不许只是工厂那一个（`factory_complete` 在前端是 "continue"，
    # 不算 sawTerminal）。控制面自己那一发 `complete` 必须在。
    assert "complete" in types, (
        f"只有 factory_complete、没有控制面的 complete：{types}"
    )
