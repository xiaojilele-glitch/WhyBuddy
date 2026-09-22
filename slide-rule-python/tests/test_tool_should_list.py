"""按轮裁工具清单：这一轮做不成的事，别让模型看见。

抄的标准答案：grok-build `xai-tool-runtime/src/tool.rs`

    /// Per-turn listing predicate. Return `false` to exclude this tool
    /// from the model-facing manifest for a given turn.
    fn should_list(&self, _ctx: &ListToolsContext) -> bool { true }

比「闭集 + 分发时拒绝」强一档：模型**看不见**的工具，不需要写规则去拒绝它。
本仓分发器里那些防御性重定向（rehearse 未确认就 re-park、clarify 问过一轮
就改开范围卡）正是"本来就不该被列出"的现成清单——它们每次都要先让模型
挑一次、再被服务端纠正一次，白烧一轮。

缺省照 grok：没声明谓词的工具一律列出（`should_list` 默认 true）。

⚠ 底线：清单永不为空。全裁光了模型无事可做，比多列一个更糟。
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from plan_approval_support import approved_plan_rows
from services.rehearsal_control import (  # noqa: E402
    CLOSED_TOOLS,
    CONTROL_TOOLS,
    list_control_tools,
    should_list_tool,
)


def _names(state) -> set:
    return {t["function"]["name"] for t in list_control_tools(state)}


def _fresh() -> V5SessionState:
    return V5SessionState(sessionId="lst-fresh", goal={"text": "", "status": "needs_refinement"})


def _scoped() -> V5SessionState:
    """已开过范围卡并确认。"""
    return V5SessionState(
        sessionId="lst-scoped",
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=approved_plan_rows(),
    )


def _with_model() -> V5SessionState:
    """已经落过一版模型的会话。"""
    return V5SessionState(
        sessionId="lst-model",
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"systems": []}}],
        currentModelVersionId="v1",
        controlTranscript=approved_plan_rows(),
    )


def test_default_is_list_absence_means_visible():
    """没声明谓词的工具一律列出（grok 的 `should_list` 默认 true）。

    ⚠ 这条原本拿 inspect_model 当例子，后来 inspect_model 也声明了谓词
      （见 test_inspect_model_hidden_without_anything_to_inspect），例子就得换。
      别再把它加回来：加回来这条就成了"断言一个有谓词的工具没被裁"，
      测的不是缺省行为。
    """
    assert should_list_tool("ask_user_question", _fresh()) is True
    # ⚠ 清单不再猜意图（2026-09-09 照 grok 改：`Tool::should_list` 在 grok 全仓只被覆写 3 次、全在管道层，`ListToolsContext` 里根本没有用户消息）。保证挪到了分发那层：没有真产品就不画卡、改成再问一句——**模型硬挑 scope_card 也挡得住**，比「菜单里不摆」更强。
    assert should_list_tool("write_plan", _fresh()) is True
    assert should_list_tool(
        "write_plan",
        V5SessionState(
            sessionId="lst-topic",
            goal={"text": "诊所系统", "status": "needs_refinement"},
        ),
    ) is True
    assert should_list_tool("一个还没声明谓词的新工具", _fresh()) is True


def test_rehearse_hidden_until_scope_confirmed():
    """分发器 :1672 本来就要把未确认的 rehearse re-park——别先让模型挑一次。

    「开始推演」按钮走 forcedTool，绕过 LLM（KD21），所以裁掉它不会
    让用户点不动。
    """
    assert "rehearse" not in _names(_fresh())
    assert "rehearse" in _names(_scoped())
    assert "spec" in _names(_scoped())
    assert "pages" not in _names(_scoped())
    # ⚠ 清单不再猜意图（2026-09-09 照 grok 改：`Tool::should_list` 在 grok 全仓只被覆写 3 次、全在管道层，`ListToolsContext` 里根本没有用户消息）。保证挪到了分发那层：没有真产品就不画卡、改成再问一句——**模型硬挑 scope_card 也挡得住**，比「菜单里不摆」更强。
    assert "write_plan" in _names(_fresh()), "问候空会话还列范围卡会把你好当成产品开干"
    assert "write_plan" not in _names(_scoped()), (
        "已确认后还列 scope_card，交回会把假设面板顶掉"
    )
    with_model = _with_model()
    with_model.controlTranscript = approved_plan_rows()
    assert "rehearse" not in _names(with_model)
    assert "refine" in _names(with_model)
    assert "workflow" in _names(_scoped())
    assert "workflow" in _names(with_model)
    assert "workflow" not in _names(_fresh())
    assert "spec" not in _names(_fresh())


def test_pages_hidden_until_spec_exists():
    st = _scoped()
    st.specFirstPages = {
        "spec": {"appName": "请假", "pages": [{"id": "p1"}], "nodes": []},
        "pages": {},
    }
    names = _names(st)
    assert "spec" not in names
    assert "pages" in names
    assert "structure" not in names
    assert "bind" not in names
    st.specFirstPages["pages"] = {"p1": "<html>1</html>"}
    names = _names(st)
    assert "pages" in names
    assert "structure" in names
    assert "bind" in names
    assert "closure" in names


def test_workflow_tool_description_lists_registered_presets():
    """模型看不见配方名字就只能发明流程。删掉 list_control_tools 里的注入必红。"""
    tools = list_control_tools(_scoped())
    workflow = next(t for t in tools if t["function"]["name"] == "workflow")
    desc = workflow["function"]["description"]
    assert "pages-preview" in desc
    assert "product-rehearsal" in desc
    assert "structure-bind" in desc
    assert "spec-pages-structure" in desc


def test_clarify_hidden_after_one_round():
    """分发器 :1631：问过一轮再问就改开范围卡。裁掉省一次往返。"""
    st = _fresh()
    assert "clarify" not in _names(st), "空目标还列 clarify，问候会弹出产品类型问卷"
    st.controlTranscript = [{"role": "user", "kind": "turn", "text": "hello"}]
    assert "clarify" not in _names(st), "当前话是 hello 但 goal 空，仍列 clarify"
    st.goal = {"text": "继续", "status": "needs_refinement"}
    assert "clarify" not in _names(st), "芯片「继续」当目标仍列 clarify"
    st.goal = {"text": "诊所系统", "status": "needs_refinement"}
    assert "clarify" not in _names(st), "问卷工具不再列给模型，避免问候被填成谁用"


def test_restore_version_hidden_without_a_previous_version():
    """_previous_model_version_id 对不上就返回 ""（fail-closed）——没上一版就别列。"""
    assert "restore_version" not in _names(_fresh())


def test_refine_and_fork_hidden_without_a_model():
    """空会话没东西可精修/可分叉。

    ⚠ 这条不是"顺手收紧"，是堵一个实测存在的洞：
      探针（空 goal + 夹具让模型挑 refine）实测
          helper(工厂信封) 调用次数: 1
          事件: ['control_handoff_factory', 'run_started', 'complete']
      —— 零范围卡就点着了火，违反验收 A「确认前 drive_full_* 调用 = 0」
      和 KD4。refine 的分发分支不像 rehearse 那样有 _scope_confirmed 兜底，
      而它现在是 WRITE，ToolScope 那道闸会放行。
      裁清单 + 分发兜底两处一起补（见 test_refine_without_model_reparks）。
    """
    assert "refine" not in _names(_fresh())
    assert "fork_variant" not in _names(_fresh())


def test_scope_card_listed_until_scope_is_confirmed():
    """范围卡在**确认之前**一直摆着，确认之后撤掉。

    ⚠ 2026-09-09 照 grok 改：这条原来叫「回执之后才列」，靠猜「这一轮像不像
      产品」来决定摆不摆。查过 grok-build——`Tool::should_list` 全仓只被覆写
      3 次且全在管道层，`ListToolsContext` 里根本没有用户消息，按"用户说了
      什么"筛在类型上就做不到。清单只答「这件工具现在能不能用」。

      「你好不许得到一张卡」那条保证没丢，只是挪到了分发那层：没有真产品就
      不画卡、改成再问一句——模型硬挑 scope_card 也挡得住，比「菜单里不摆」
      更强（判据在 test_cheap_followup_is_not_a_product）。
    """
    assert "write_plan" in _names(_fresh())
    st = V5SessionState(
        sessionId="lst-ask-ans",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hello"},
            {"role": "assistant", "kind": "ask_user_question", "text": "想做什么应用，说一句就行。"},
            {"role": "tool", "kind": "user_answer", "text": "请假系统", "answerKind": "ask_user_question"},
        ],
    )
    assert "write_plan" in _names(st)
    # 反向：确认过范围就撤掉——下一步是 pages，不是再开一张卡。
    assert "write_plan" not in _names(_scoped())


def test_search_evidence_hidden_without_a_product_topic():
    """空会话检索会把任意话当术语拆义。有产品才列。

    反向：goal 里已经有产品时必须还能搜（test_control_search 那条路）。
    """
    assert "search_evidence" not in _names(_fresh())
    assert should_list_tool("search_evidence", _fresh()) is False
    topic = V5SessionState(
        sessionId="lst-search-topic",
        goal={"text": "请假系统", "status": "needs_refinement"},
    )
    assert "search_evidence" in _names(topic)
    assert "challenge" not in _names(_fresh())
    assert "repair" not in _names(_fresh())
    assert "challenge" in _names(_with_model())
    assert "repair" in _names(_with_model())


def test_inspect_model_hidden_without_anything_to_inspect():
    """没有模型也没有闭环产物时，别让模型看见 inspect_model。

    ⚠ 2026-08-27 真机压测逮到的洞（refine/fork 补 _has_model 时漏掉的第三个）：
      同一句「中小学课后托管的报名、排班与考勤系统」连跑三遍，
          #1 scope_card → 范围卡 41s
          #3 scope_card → 范围卡 41s
          #2 inspect_model → 套话收尾 → **范围卡再没出现**，136s 打空
      真机会话 sr-20260827073836-C3VJV41PV5 的 controlTranscript 明写着
      `turn → clarify → turn → inspect_model → canned`。零模型的会话上
      `_inspect_digest` 只能回「当前还没有五系统模型可查看」，模型拿到这句
      就没有下一步了——不是它选错，是本来就不该让它看见这个选项。

    口径盯**能不能查到东西**，不盯 modelVersions 一个字段：`_inspect_digest`
    先读 publishClosure、再退 modelVersions，判据跟着它走（下面第二段）。
    """
    assert "inspect_model" not in _names(_fresh())
    assert "inspect_model" in _names(_with_model())


def test_inspect_model_visible_on_closure_only_sessions():
    """反向：有闭环产物、还没落版本的会话**必须**还能查看。

    这一条是上一条的对照。少了它，把谓词写成 `_has_model` 也全绿——
    而那样会在真机上把「跑完一轮、模型版本还没落库」的会话的查看入口
    裁没（CLAUDE.md §3：每写一条"不该有"，配一条"该有的还在"）。
    """
    state = _fresh()
    state.sessionId = "lst-closure-only"
    state.publishClosure = {"five_system_model": {"systems": []}}
    assert not (getattr(state, "modelVersions", None) or []), "前提：没有模型版本"
    assert "inspect_model" in _names(state)


def test_manifest_is_never_empty():
    """底线：全裁光比多列一个更糟。

    ⚠ 2026-08-27 变异检查逮到：只断言"现有状态下非空"咬不住这条底线——
      现有谓词组合下本来就裁不光，把兜底整段删掉判据照样全绿。
      所以这里**逼出**空清单：临时给每个工具都挂上恒假谓词，看兜底顶不顶得住。
    """
    from services import rehearsal_control as rc

    saved = dict(rc.TOOL_LIST_WHEN)
    try:
        rc.TOOL_LIST_WHEN.clear()
        rc.TOOL_LIST_WHEN.update({n: (lambda st: False) for n in CLOSED_TOOLS})
        floor = _names(_fresh())
        assert floor, "所有谓词都为假时清单空了——兜底没顶住，模型这一轮无事可做"
        assert floor == {"ask_user_question"}, (
            f"兜底放行的不是「问一句」，而是 {sorted(floor)}"
        )
    finally:
        rc.TOOL_LIST_WHEN.clear()
        rc.TOOL_LIST_WHEN.update(saved)

    for st in (_fresh(), _scoped()):
        assert len(list_control_tools(st)) > 0
    assert "ask_user_question" in _names(_fresh()), (
        "空会话至少要留得下「问一句」，否则问候无事可做"
    )
    topic = V5SessionState(
        sessionId="lst-topic2",
        goal={"text": "诊所系统", "status": "needs_refinement"},
    )
    assert "write_plan" in _names(topic)


def test_listed_tools_are_a_subset_of_the_closed_set():
    """裁剪不许把闭集之外的东西放进来。"""
    for st in (_fresh(), _scoped()):
        assert _names(st) <= set(CLOSED_TOOLS)


def test_full_manifest_shape_is_untouched():
    """裁的是清单，不是工具定义本身——形状必须原样。

    workflow / skill 除外：描述里要写上此刻的目录，改全局 CONTROL_TOOLS
    会让 schema 跟着注册表变，provider 那头不稳定。
    """
    listed = list_control_tools(_scoped())
    by_name = {t["function"]["name"]: t for t in listed}
    live = {"workflow", "skill"}
    for t in CONTROL_TOOLS:
        n = t["function"]["name"]
        if n in by_name and n not in live:
            assert by_name[n] is t, f"{n} 的定义被复制/改写了，应当原样透传"
    for name in live:
        original = next(t for t in CONTROL_TOOLS if t["function"]["name"] == name)
        assert by_name[name] is not original


# ── 通电：光有 list_control_tools 不算数 ──────────────────────────


def test_llm_call_site_uses_the_filtered_manifest():
    """裁剪要真的接在喂给模型的那一处，不是摆着好看。

    变异：把调用点改回 tools=CONTROL_TOOLS → 本条必红。
    """
    import inspect
    import re

    from services import rehearsal_control as rc

    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(rc))
    src = re.sub(r"#.*", "", src)
    assert "list_control_tools(" in src, (
        "喂给控制模型的还是整张 CONTROL_TOOLS——裁剪没通电"
    )
    assert "offered_names" in src, (
        "模型塞了本轮没列出的工具仍会分发——空会话 spec 会变成继续执行范围卡"
    )
    assert "tools=CONTROL_TOOLS" not in src, (
        "还留着直接传全量的调用点：裁剪会被绕过"
    )


def test_a_continuation_phrase_does_not_open_a_product_card():
    """「继续执行」不是产品——不许被复述成一张产品卡。

    这是上一条判据自己写下的担心（"继续执行就会开范围卡"），但它当时用的
    userText 是一句真产品，测不到。这里用它说的那句话真跑一遍。
    """
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: PLC0415
        ControlHarness,
        event_types,
        llm_tool,
        new_sid,
        seed_session,
        six_fields,
    )

    import _pytest.monkeypatch as _mp

    mp = _mp.MonkeyPatch()
    try:
        harness = ControlHarness(mp)
        sid = new_sid("continuation-no-card")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool("refine", {})
        _, events = harness.post(six_fields(sid, "继续执行"))
        types = event_types(events)
        assert "control_scope_card" not in types, (
            f"「继续执行」被复述成了产品卡：{types}"
        )
        assert harness.helper_calls == []
        assert "control_handoff_factory" not in types
    finally:
        mp.undo()


def test_refine_without_model_reparks_instead_of_igniting():
    """分发兜底：裁清单挡不住硬调，refine 空会话必须 re-park 而不是点火。

    实测过的洞（探针）：空 goal 会话 + 夹具让模型挑 refine →
        helper(工厂信封) 调用次数: 1
        事件: ['control_handoff_factory', 'run_started', 'complete']
    零范围卡就点着了火。rehearse 有 _scope_confirmed 兜底，refine 没有，
    而它是 WRITE，ToolScope 那道闸会放行。两处都要补——清单裁掉是省一次
    往返，分发兜底才是闸。
    """
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: PLC0415
        ControlHarness,
        event_types,
        llm_tool,
        new_sid,
        seed_session,
        six_fields,
    )

    import _pytest.monkeypatch as _mp

    mp = _mp.MonkeyPatch()
    try:
        harness = ControlHarness(mp)
        sid = new_sid("refine-no-model")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool("refine", {})
        _, events = harness.post(six_fields(sid, "做一个请假系统"))
        types = event_types(events)
        assert harness.helper_calls == [], (
            "空会话上 refine 点着了工厂——确认前 drive_full_* 必须是 0"
            f"（验收 A / KD4）。事件：{types}"
        )
        assert "control_handoff_factory" not in types
        # ⚠ 2026-09-09：这条断言原本是「没列出的 refine 不许被复述成产品卡」，
        #   理由写着「继续执行就会开范围卡」。但它用的 userText 是
        #   「做一个请假系统」——一句**真产品**。真产品出复述卡正是第 5/7 格
        #   要的行为，拿它来证明「继续执行」的毛病是张冠李戴。
        #
        #   这条判据真正贵的地方是上面两句（refine 不许点火），那两句照旧钉着。
        #   它自己担心的那件事另立一条，用它自己说的那句话去测。
        assert "control_handoff_factory" not in types
    finally:
        mp.undo()
