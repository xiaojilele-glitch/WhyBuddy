"""WRITE 工具跑完工厂后必须交回控制面。

第一版把 `control_handoff_factory` 和工厂 `complete` 都当循环终局，
点了 rehearse 控制面就 return——抄 grok 是工具流有自己的 Terminal，
host 循环另算。按钮点火仍跳过 LLM；工厂收尾必须再问一轮。
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
    seed_approved_session as seed_session,
    six_fields,
    strip_python,
)
from services.rehearsal_control import (
    CANNED_FAILURE,
    ASSUMPTIONS_WAIT_USER,
    POST_SPEC_HOP_FALLBACK,
    POST_WRITE_FALLBACK,
    _after_write_hint,
    _factory_tool_body,
)
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _scoped(sid: str):
    return seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )


def test_llm_rehearse_calls_llm_again_after_factory(harness):
    sid = new_sid("free-orch")
    _scoped(sid)
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("rehearse", {}, call_id="r1")
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "开始做请假系统"))
    assert len(harness.helper_calls) == 1
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types, (
        "嵌套工厂的 complete 没改名——客户端会在工厂收尾处掐断 SSE"
    )
    assert any(
        e.get("type") == "control_tool_result"
        and e.get("tool") in ("spec", "rehearse")
        for e in events
    ), "WRITE 没有 control_tool_result 交回模型。"
    assert rounds["n"] >= 2, "工厂之后没有第二轮 LLM——控制面被 handoff 吞掉了"
    assert types[-1] == "complete"


def test_ask_user_still_parks_the_loop(harness):
    """反向：问用户仍然要停，不许为了自由编排把 park 也盘活。"""
    sid = new_sid("still-park")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        return llm_tool("ask_user", {"question": "做什么应用？"}, call_id="a1")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "你好"))
    assert "control_ask_user" in event_types(events)
    assert rounds["n"] == 1
    assert harness.helper_calls == []


def test_dispatch_factory_hops_are_on_the_live_path():
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "FACTORY_HOPS" in src
    assert "[hop]" in src
    assert "_factory_hop_blocker" in src
    assert "spec" in src


def test_loop_does_not_return_on_handoff_flag():
    """变异：把 `if parked or handed: return` 加回去，这条必须红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "if parked or handed:" not in src
    assert "factory_complete" in src
    assert "nest=True" in src
    assert "_resume_control_llm_after_write" in src
    assert "_after_write_hint" in src
    assert 'messages.append({"role": "user"' in src or "messages.append(" in src


def test_forced_rehearse_rejoins_loop_after_factory(harness):
    """按钮点火不经过 LLM；工厂收尾必须交回 host，按 hint 挑下一跳。"""
    sid = new_sid("forced-rejoin")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "点火前不得问控制面模型"
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert len(harness.helper_calls) == 1
    assert harness.llm_calls, "没有假设时工厂之后必须问控制面挑下一跳"
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types, (
        "按钮路径 nest=False 的话客户端会在工厂 complete 处掐断 SSE"
    )
    assert any(
        e.get("type") == "control_tool_result"
        and e.get("tool") in ("spec", "rehearse")
        for e in events
    )
    assert any(
        e.get("type") == "control_text"
        and "页面已经出来" in str(e.get("text") or "")
        for e in events
    ), "交回之后的人话没上屏"
    assert types[-1] == "complete"


def test_after_write_hint_reads_this_hop_tools_not_stale_pages():
    """会话里还有上一跳的页面，本跳只跑了 spec，不许问结构绑定 / 假装页面刚出来。"""
    state = V5SessionState(
        sessionId="t-hint-hop",
        goal={"text": "图书馆", "status": "clear", "tools": ["spec"]},
        specFirstPages={
            "pages": {"p1": "<html>旧页</html>"},
            "capabilityPlan": {"tools": ["spec"]},
        },
    )
    hint = _after_write_hint(state)
    # ⚠ 2026-09-04：话术从祈使句改成情报式（见
    #   test_after_write_hint_is_intel_not_orders）。判据跟着盯**语义**：
    #   本跳跑的是 spec、页面数照实报、不许把上一跳的页面说成本跳产出。
    #   盯原文（旧版写的是「下一跳必须调 pages」）会在改话术时假红/假绿。
    assert "本跳实际跑了" in hint
    assert "起草 SPEC" in hint
    assert "页面 1 份" in hint, f"页数没照实报：{hint}"
    for done_word in ("数据结构", "权限工作流"):
        assert f"{done_word} 这几件" not in hint, (
            f"本跳没跑 {done_word}，不许说成已经做过：{hint}"
        )


def test_after_write_hint_full_hop_does_not_ask_structure_bind():
    state = V5SessionState(
        sessionId="t-hint-full",
        goal={"text": "图书馆", "status": "clear"},
        specFirstPages={
        "pages": {"p1": "<html>本跳页</html>"},
        "capabilityPlan": {"tools": ["spec", "pages", "bind"]},
    },
    )
    hint = _after_write_hint(state)
    assert "权限工作流" in hint or "bind" in hint
    # 语义同上：本跳跑过的那几件要标成「做过」，别再问一遍。
    assert "本跳已经做过" in hint, f"没标明哪几件已经做过：{hint}"
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "_this_hop_tools" in src
    assert "capabilityPlan" in src


def test_forced_rehearse_empty_llm_uses_post_spec_hop_fallback(harness):
    """SPEC 单跳后模型空回复不许说页面已经出来，也不许套开场罐头。"""
    sid = new_sid("forced-empty")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert POST_SPEC_HOP_FALLBACK in blob
    assert "请调 pages" not in blob
    assert POST_WRITE_FALLBACK not in blob
    assert CANNED_FAILURE not in blob


def test_forced_refine_rejoins_loop_after_factory(harness):
    """成对改：精修按钮也 nest。只改 rehearse 等于一半不生效。"""
    sid = new_sid("forced-refine-rejoin")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "申请"}]},
            "pages": {"p1": "<html>旧</html>"},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "精修点火前不得问控制面模型"
        return llm_text("按钮已经改过了。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "把提交按钮改成红色", forcedTool="refine")
    )
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0].get("profile") == "app"
    assert harness.helper_calls[0].get("goal_tools") == ["pages"]
    assert harness.llm_calls
    types = event_types(events)
    assert "factory_complete" in types
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "refine"
        for e in events
    )
    assert types[-1] == "complete"
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert list(tools or []) == ["pages"], f"已有 SPEC 的精修走 pages，实际 {tools}"


def test_refine_branch_writes_tools_and_uses_app_profile():
    """建设单 O-1：变异把 goal['tools'] 或 profile='app' 改回 full → 红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    at = src.find("if forced == 'refine'")
    if at < 0:
        at = src.find('if forced == "refine"')
    assert at > 0
    repair_at = src.find("if forced == 'repair'", at)
    if repair_at < 0:
        repair_at = src.find('if forced == "repair"', at)
    body = src[at:repair_at]
    assert "_set_goal_tools" in body
    assert "profile='app'" in body or 'profile="app"' in body
    assert "profile='full'" not in body and 'profile="full"' not in body
    challenge_at = src.find("if forced == 'challenge'", repair_at)
    if challenge_at < 0:
        challenge_at = src.find('if forced == "challenge"', repair_at)
    repair = src[repair_at:challenge_at]
    assert "profile='full'" in repair or 'profile="full"' in repair
    assert "profile='app'" not in repair and 'profile="app"' not in repair


def test_workflow_tool_is_listed_and_handoffs_after_scope(harness):
    """抄 grok WorkflowTool：日历是可挑选的 WRITE，不是默认唯一路径。"""
    sid = new_sid("wf-pick")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool(
                "workflow",
                {"name": "product-rehearsal", "tools": ["spec", "pages"]},
                call_id="w1",
            )
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "按日历跑"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    assert loaded is not None
    tools = (loaded.goal or {}).get("tools") if isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec", "pages"]
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "workflow"
        for e in events
    )
    assert types[-1] == "complete"
    assert (loaded.goal or {}).get("workflow") == "product-rehearsal"


def test_forced_rehearse_does_not_read_retired_scope_card_tools(harness):
    """范围卡 tools 必须落到 goal，工厂才能少跑。只打孔 plan 会假绿。"""
    sid = new_sid("scope-tools")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
        controlTranscript=[
            {
                "id": "ct-1",
                "kind": "scope_card",
                "text": "请假系统",
                "device": "desktop",
                "tools": ["spec", "pages", "closure"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            tools=["spec", "pages", "closure"],
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    tools = (loaded.goal or {}).get("tools") if isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec"], (
        "开始推演只点火 spec。卡上减菜进待办，不许把课表焊进这一跳。"
        f"实际 {tools}"
    )
    todo = list(getattr(loaded, "factoryTodo", None) or [])
    assert "pages" in todo
    assert "structure" in todo and "bind" in todo, todo


def test_forced_rehearse_default_menu_is_spec_then_todo(harness):
    """没减菜时开始推演只点火 spec，其余进待办。不许焊课表。"""
    sid = new_sid("first-pass")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_text("规格已经记下。")
    harness.post(six_fields(sid, "将做成：请假系统", forcedTool="rehearse"))
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec"], f"开始推演焊了课表：{tools}"
    todo = list(getattr(loaded, "factoryTodo", None) or [])
    assert todo == ["pages", "structure", "bind"], todo
    assert harness.helper_calls[-1].get("goal_tools") == ["spec"]


def test_pages_preview_workflow_stamps_recipe_tools_without_override(harness):
    """挑 pages-preview 必须带上配方默认 tools，不能再跑 bind。"""
    sid = new_sid("wf-preview")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("workflow", {"name": "pages-preview"}, call_id="w2")
        return llm_text("先看页面。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "先只出管理员看板"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    assert loaded is not None
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert goal.get("workflow") == "pages-preview"
    assert list(goal.get("tools") or []) == ["spec", "pages", "closure"]
    assert "bind" not in (goal.get("tools") or [])
    assert "factory_complete" in event_types(events)


def test_llm_pages_without_spec_does_not_handoff(harness):
    """缺 SPEC 调 pages 必须 canned，不许进工厂。"""
    sid = new_sid("pages-no-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_tool("pages", {}, call_id="p1")
    _, events = harness.post(six_fields(sid, "先出页面"))
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert "control_scope_card" not in types


def test_llm_pages_after_spec_handoffs(harness):
    """有 SPEC 之后 pages 必须进工厂，goal.tools 只有 pages。"""
    sid = new_sid("pages-after-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1", "name": "首页"}], "nodes": []},
            "pages": {},
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("pages", {}, call_id="p1")
        return llm_text("页面出来了。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "出页面"))
    assert len(harness.helper_calls) == 1
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["pages"]
    assert any(
        e.get("type") == "control_tool_result" and e.get("tool") == "pages"
        for e in events
    )
    assert rounds["n"] >= 2


def test_after_spec_hop_host_lists_pages(harness):
    """SPEC 跳交回、没有假设卡：清单里必须有 pages，host 才能挑下一跳。

    变异：把 `tools = []` 加回去 → llm kwargs 里没有 pages，本条红。
    """
    sid = new_sid("after-spec-hint")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    seen = {"names": []}

    def impl(messages, **kw):
        tools = kw.get("tools") or []
        names = [
            ((t.get("function") or {}).get("name") if isinstance(t, dict) else None)
            for t in tools
        ]
        seen["names"] = [n for n in names if n]
        return llm_text("先出页面。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert harness.llm_calls, "没有假设时工厂之后必须问控制面"
    assert "pages" in seen["names"], f"交回清单没有 pages：{seen['names']}"
    assert "spec" not in seen["names"], f"已经有 SPEC 不该再列 spec：{seen['names']}"
    loaded = load_session(sid)
    assert loaded is not None
    body = _factory_tool_body(loaded, "spec")
    assert body.get("hasSpec") is True
    assert body.get("pageCount") == 0
    assert "pages" in str(body.get("nextHint") or "")


def test_spec_then_pages_in_same_host_loop(harness):
    """步骤级自主：spec 交回后同一轮 host 按 hint 挑 pages。

    变异：交回 tools=[] → 第二轮 LLM 调 pages 进不了工厂，helper 仍是 1。
    """
    sid = new_sid("spec-then-pages")
    _scoped(sid)
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("spec", {}, call_id="s1")
        if rounds["n"] == 2:
            return llm_tool("pages", {}, call_id="p1")
        return llm_text("页面出来了。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "做一个请假系统"))
    assert len(harness.helper_calls) == 2, (
        f"spec 之后 host 没挑 pages：helper={len(harness.helper_calls)} rounds={rounds['n']}"
    )
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["pages"], tools
    types = event_types(events)
    assert types[-1] == "complete"


def test_assumptions_awaiting_does_not_ask_control(harness):
    """假设卡摊着：工厂之后零 LLM，确认继续才能发出去（2026-09-03）。"""
    sid = new_sid("assumptions-wait")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear", "tools": ["spec"]},
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
    harness.llm_impl = lambda messages, **kw: llm_text("不该被叫到")
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="spec")
    )
    assert not harness.llm_calls, (
        f"假设卡还在等确认，工厂之后又问了控制面：{len(harness.llm_calls)} 次"
    )
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    question = next(e for e in events if e.get("type") == "control_ask_user")
    assert [row["id"] for row in question["questions"]] == ["a1"]
    assert not any("请调 pages" in t for t in texts)
    assert event_types(events)[-1] == "complete"


def test_factory_tool_body_counts_pages_from_the_dict():
    """变异：把 specFirstPages 当 list 量，pageCount 恒 0，host 以为没产物。"""
    from models.v5_state import V5SessionState

    st = V5SessionState(
        sessionId="body-pages",
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {"appName": "请假", "pages": [{"id": "p1"}, {"id": "p2"}], "nodes": []},
            "pages": {"p1": "<html>1</html>", "p2": "<html>2</html>"},
            "navItems": [],
        },
    )
    body = _factory_tool_body(st, "pages")
    assert body["pageCount"] == 2
    assert body["hasSpec"] is True
    assert body["declaredPages"] == 2
    assert "已经出过 2 页" in str(body.get("human") or "")


def test_host_hop_clips_factory_loop_to_one():
    """hop 成功还按 10 圈跑 = SPEC 起草两遍。剥注释后删掉 max_loops = 1 这条红。"""
    import inspect
    import re

    from services.v5_full_driver import (
        _host_factory_hop,
        drive_full_v5_session_stream,
    )
    from models.v5_state import V5SessionState

    st = V5SessionState(sessionId="hop-one", goal={"tools": ["spec"]})
    assert _host_factory_hop(st) is True
    st.goal = {"tools": ["spec", "pages"]}
    assert _host_factory_hop(st) is False

    src = inspect.getsource(drive_full_v5_session_stream)
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"#.*", "", src)
    hop_at = src.index("_host_factory_hop")
    window = src[hop_at : hop_at + 500]
    assert "max_loops = 1" in window, (
        "host hop 没有把工厂循环收成一跳。删掉这句，食堂那趟会再起草一遍 SPEC。"
    )


def test_bind_partial_failed_is_not_ok():
    """真机：3 页里 2 页 failed，不能当已经全部接好。"""
    state = V5SessionState(
        sessionId="bind-fail",
        goal={"text": "鲜果速收", "tools": ["bind"]},
        specFirstPages={
            "pages": {"p1": "<html/>", "p2": "<html/>", "p3": "<html/>"},
            "pageBindStatus": {"p1": "failed", "p2": "failed", "p3": "bound"},
            "capabilityPlan": {"tools": ["bind"]},
        },
    )
    body = _factory_tool_body(state, "bind", before_fingerprint="old")
    assert body["ok"] is False
    assert "failed" in body["human"]
    assert "闭环" in body["human"]


def test_bind_skip_all_pages_is_not_ok():
    """真机：bind 三页 skipped，收尾却说闭环完成。"""
    state = V5SessionState(
        sessionId="bind-skip",
        goal={"text": "权盾后台", "tools": ["bind"]},
        specFirstPages={
            "pages": {"p1": "<html/>", "p2": "<html/>", "p3": "<html/>"},
            "pageBindStatus": {"p1": "skipped", "p2": "skipped", "p3": "skipped"},
            "capabilityPlan": {"tools": ["bind"]},
        },
    )
    body = _factory_tool_body(state, "bind", before_fingerprint="old")
    assert body["ok"] is False
    assert "skipped" in body["human"]
    assert "闭环" in body["human"]
