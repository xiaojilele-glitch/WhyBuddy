"""PC / 手机能力计划必须接到 run_spec_first 的活体上。

默认顺序与今天逐字相同。删掉 plan.includes 或 product_rehearsal_plan
调用点，本文件必须红——不是「helper 单测全绿、接线没了」。
"""

from __future__ import annotations

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import capability_plan as cp  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services import stage_legal as S  # noqa: E402


def _code(obj) -> str:
    src = inspect.getsource(obj)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_public_tools_are_spec_pages_structure_bind_closure():
    assert cp.TOOLS == ("spec", "pages", "structure", "bind", "closure")
    assert cp.expand_tools(cp.TOOLS) == cp.NEW_RUN
    assert "closure" not in cp.NEW_RUN


def test_first_pass_is_producing_chain_without_closure():
    assert cp.FIRST_PASS_TOOLS == ("spec", "pages", "structure", "bind")
    assert "closure" not in cp.FIRST_PASS_TOOLS
    assert cp.first_pass_tools(None) == cp.FIRST_PASS_TOOLS
    assert cp.first_pass_tools(["spec", "pages", "closure"]) == ("spec", "pages")
    assert cp.first_pass_tools(["invented"]) == cp.FIRST_PASS_TOOLS
    assert cp.remaining_first_pass_tools(
        None, has_spec=True, has_pages=False
    ) == ("pages", "structure", "bind")
    assert cp.is_first_pass_chain(["spec", "pages", "structure", "bind"])
    assert not cp.is_first_pass_chain(["structure"])
    assert not cp.is_first_pass_chain(["spec", "pages", "closure"])


def test_live_spec_first_tools_does_not_union_todo_after_pages_stamp():
    """第 4 格：stamp=['pages']，待办 structure/bind，流水线只跑 pages。

    变异：再把待办并进菜单 → 本条红。bind 没跑由待办 + 闭环挡住，
    不是偷跑进这一跳。
    """
    out = cp.live_spec_first_tools(
        ["pages"], ["structure", "bind"], has_spec=True
    )
    assert out == ("pages",)
    assert "specfirst.bind" not in cp.expand_tools(out)
    assert "spec" not in out


def test_live_spec_first_tools_does_not_rewrite_a_lone_host_hop():
    """用户点 bind / 空待办的 pages 单跳，不许被并回整条首轮链。"""
    assert cp.live_spec_first_tools(["bind"], [], has_spec=True) == ("bind",)
    assert cp.live_spec_first_tools(["pages"], None, has_spec=True) == ("pages",)


def test_desktop_and_phone_share_the_same_capabilities():
    desktop = cp.product_rehearsal_plan(device="desktop")
    phone = cp.product_rehearsal_plan(device="phone")
    assert desktop.tools == phone.tools == cp.TOOLS
    assert desktop.ids == phone.ids == cp.NEW_RUN
    assert desktop.name == phone.name == cp.PRODUCT_REHEARSAL
    assert desktop.device == "desktop"
    assert phone.device == "phone"


def test_refine_plan_puts_graphscope_before_spec():
    plan = cp.product_rehearsal_plan(refine=True)
    assert plan.ids == cp.REFINE_RUN
    assert plan.ids.index("specfirst.graphscope") < plan.ids.index("specfirst.spec")


def test_shell_is_a_capability_but_not_on_the_progress_ledger():
    assert "specfirst.shell" in cp.NEW_RUN
    assert "specfirst.shell" not in S.stage_ids()
    assert "specfirst.shell" not in cp.product_rehearsal_plan().visible_ids()


def test_visible_new_run_ids_are_on_the_stage_ledger():
    visible = set(cp.product_rehearsal_plan().visible_ids())
    assert visible <= set(S.stage_ids())
    assert visible == {
        "specfirst.spec",
        "specfirst.design",
        "specfirst.pages",
        "specfirst.structure",
        "specfirst.semantics",
        "specfirst.assemble",
        "specfirst.bind",
    }


def test_run_spec_first_consults_the_plan_on_the_live_path():
    stripped = _code(sfp.run_spec_first)
    assert "select_workflow(" in stripped
    from services import workflow_select as wr
    from services.v5_capability_executor import execute_v5_capability

    assert "product_rehearsal_plan(" in _code(wr.select_workflow)
    for cap in cp.NEW_RUN:
        needle = f'plan.includes("{cap}")'
        assert needle in stripped, f"默认能力 {cap} 没有门口：删 includes 会假绿"
    for cap in ("specfirst.graphscope", "specfirst.pagescope"):
        needle = f'plan.includes("{cap}")'
        assert needle in stripped, f"精修能力 {cap} 没有门口：删 includes 会假绿"
    exec_src = _code(execute_v5_capability)
    assert 'includes("closure")' in exec_src, "收口工具没有门口：删 includes 会假绿"


def test_run_spec_first_stage_order_matches_the_plan():
    """计划里的次序必须就是函数体里 `_stage` 第一次出现的次序。

    只改 NEW_RUN 元组、或只改函数里的步骤顺序，这一条必须红。
    """
    stripped = _code(sfp.run_spec_first)
    appearances = [f"specfirst.{name}" for name in re.findall(r'_stage\("specfirst\.([^"]+)"\)', stripped)]

    def first_hits(expected: tuple[str, ...]) -> tuple[str, ...]:
        seen: list[str] = []
        wanted = set(expected)
        for cap in appearances:
            if cap in wanted and cap not in seen:
                seen.append(cap)
        return tuple(seen)

    assert first_hits(cp.NEW_RUN) == cp.NEW_RUN
    assert first_hits(cp.REFINE_RUN) == cp.REFINE_RUN


def test_select_workflow_does_not_route_by_keyword():
    from services.workflow_select import select_workflow

    assert "goal" not in inspect.signature(select_workflow).parameters
    watch = select_workflow(device="phone")
    game = select_workflow(device="desktop")
    shop = select_workflow(archetype="business_app", device="desktop")
    assert watch.name == game.name == shop.name == cp.PRODUCT_REHEARSAL
    assert watch.stages == cp.NEW_RUN
    live = _code(sfp.run_spec_first)
    call = live[live.index("select_workflow(") : live.index("plan = CapabilityPlan(")]
    assert "archetype=" in call
    assert "device=" in call
    assert "tools=" in call
    assert "name=" in call
    assert "goal" not in call


def test_normalize_tools_empty_or_unknown_falls_back_to_the_five():
    """空清单不许当成什么都不跑——那会端出一份空成功。"""
    assert cp.normalize_tools(None) == cp.TOOLS
    assert cp.normalize_tools(()) == cp.TOOLS
    assert cp.normalize_tools(["invented", "also-fake"]) == cp.TOOLS
    assert cp.normalize_tools(["closure", "spec", "invented"]) == ("spec", "closure")


def test_clip_factory_tools_falls_back_to_legal_not_the_five():
    """没提案回落范围卡，不许把减菜冲回五件套。"""
    legal = ("spec", "pages", "closure")
    assert cp.clip_factory_tools(None, legal) == legal
    assert cp.clip_factory_tools([], legal) == legal
    assert cp.clip_factory_tools(
        [{"capabilityId": "pages"}, {"capabilityId": "spec"}, {"capabilityId": "bind"}],
        legal,
    ) == ("spec", "pages")


def test_clip_factory_tools_refuses_all_illegal_proposals():
    """提案全不合法不许回落菜单——回落就是一跳一件装在不通电的插座上。"""
    legal = ("spec", "pages", "closure")
    with pytest.raises(cp.FactoryToolsRefused):
        cp.clip_factory_tools(
            [{"capabilityId": "critique.generate"}, {"capabilityId": "bind"}],
            legal,
        )


def test_assert_stages_match_tools_positive_and_negative():
    """实际执行必须等于本跳 tools 展开。把 bind 从实际里拿掉必须红。"""
    tools = ("spec", "pages", "bind")
    declared = cp.expand_tools(tools)
    stages = {cap.split(".", 1)[1]: {} for cap in declared}
    cp.assert_stages_match_tools(tools, stages)
    stages.pop("assemble")
    with pytest.raises(AssertionError, match="missing"):
        cp.assert_stages_match_tools(tools, stages)
    stages = {cap.split(".", 1)[1]: {} for cap in declared}
    stages["invented"] = {}
    with pytest.raises(AssertionError, match="extra"):
        cp.assert_stages_match_tools(tools, stages)


def test_assert_allows_held_assumptions_to_skip_design():
    """伴随式澄清停在 SPEC：design 及之后允许缺。把标记拿掉必须红。"""
    stages = {"spec": {}, "assumptionsHeld": {"count": 2}}
    cp.assert_stages_match_tools(("spec",), stages)
    stages.pop("assumptionsHeld")
    with pytest.raises(AssertionError, match="missing"):
        cp.assert_stages_match_tools(("spec",), stages)


def test_assert_allows_pages_hop_to_run_design():
    """pages 单跳补跑 design 允许多。发明别的阶段仍红。"""
    stages = {"design": {}, "pages": {}, "shell": {}}
    cp.assert_stages_match_tools(("pages",), stages)
    stages["invented"] = {}
    with pytest.raises(AssertionError, match="extra"):
        cp.assert_stages_match_tools(("pages",), stages)


def test_run_spec_first_calls_assert_stages_match_tools():
    """出口断言必须接在活路径上。只测 helper 会假绿。"""
    src = _code(sfp.run_spec_first)
    assert "assert_stages_match_tools" in src
    assert "plan.tools" in src


def test_expand_tools_bind_implies_assemble():
    """任意含 bind 的子集展开后 assemble 必在。把闭包删掉必须红。"""
    ids = cp.expand_tools(("spec", "pages", "bind"))
    assert "specfirst.bind" in ids
    assert "specfirst.assemble" in ids
    assert "specfirst.structure" in ids
    assert "specfirst.assemble" in _code(cp.expand_tools)


def test_clip_factory_tools_puts_spec_back_on_a_new_run():
    assert cp.clip_factory_tools(
        [{"capabilityId": "pages"}, {"capabilityId": "closure"}],
        cp.TOOLS,
    ) == ("spec", "pages", "closure")
    assert cp.clip_factory_tools(
        [{"capabilityId": "pages"}],
        cp.TOOLS,
        refine=True,
    ) == ("pages",)


def test_clip_factory_tools_single_hop_does_not_inject_spec():
    """建设单 O-4：单跳不在菜单里塞 spec。变异：把 len(chosen) != 1 删掉 → 红。"""
    assert cp.clip_factory_tools([{"capabilityId": "bind"}], cp.TOOLS) == ("bind",)
    assert cp.clip_factory_tools([{"capabilityId": "pages"}], cp.TOOLS) == ("pages",)


def _stub_pipeline(monkeypatch) -> dict:
    seen: dict = {"bind": 0, "spec": 0, "pages": 0}

    def fake_spec(*_a, **_k):
        seen["spec"] += 1
        return {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        }

    def fake_pages(*_a, **_k):
        seen["pages"] += 1
        return {"pages": {"p1": "<html>1</html>"}, "failed": {}}

    def fake_bind(pages, model, **_k):
        seen["bind"] += 1
        seen["bind_pages"] = pages
        return {"pages": pages, "failed": {}}

    monkeypatch.setattr("services.app_template.match_app_template", lambda *_a, **_k: None)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)
    monkeypatch.setattr("services.design_language.generate_style_brief", lambda *_a, **_k: None)
    monkeypatch.setattr(
        "services.design_language.generate_design_language",
        lambda *_a, **_k: {
            "tone": "x",
            "primary": "#2563eb",
            "accent": "#0f172a",
            "radius": "8px",
            "density": "标准",
            "components": [],
            "charts": False,
        },
    )
    monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", fake_pages)
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure",
        lambda *_a, **_k: {"entities": [], "pages": [{"id": "p1"}]},
    )
    monkeypatch.setattr(
        "services.spec_semantics.derive_semantics", lambda *_a, **_k: {"roles": []}
    )
    monkeypatch.setattr(
        "services.model_assembly.assemble", lambda *_a, **_k: {"model": {"ok": 1}}
    )
    monkeypatch.setattr("services.html_bindings.bind_pages", fake_bind)
    return seen


def test_default_plan_still_runs_bind(monkeypatch):
    seen = _stub_pipeline(monkeypatch)
    try:
        out = sfp.run_spec_first("做一个员工请假审批系统", preferred_device="desktop")
    finally:
        sfp.take_last_pages()
    assert seen["spec"] == 1
    assert seen["pages"] == 1
    assert seen["bind"] == 1
    assert out["stages"]["capabilityPlan"]["tools"] == list(cp.TOOLS)
    assert out["stages"]["capabilityPlan"]["capabilities"] == list(cp.NEW_RUN)
    assert out["device"] == "desktop"


def test_omitting_bind_from_the_plan_skips_bind_pages(monkeypatch):
    """反向：计划里拿掉 bind，打孔必须没发生。删 includes 这条必红。"""
    seen = _stub_pipeline(monkeypatch)
    no_bind = cp.product_rehearsal_plan(
        device="phone",
        tools=tuple(t for t in cp.TOOLS if t != "bind"),
    )
    monkeypatch.setattr(
        "services.capability_plan.product_rehearsal_plan",
        lambda **_k: no_bind,
    )
    try:
        out = sfp.run_spec_first("做一个员工请假审批系统", preferred_device="phone")
    finally:
        sfp.take_last_pages()
    assert seen["spec"] == 1
    assert seen["pages"] == 1
    assert seen["bind"] == 0
    assert "bind" not in out["stages"]
    assert out["device"] == "phone"
    assert "bind" not in out["stages"]["capabilityPlan"]["tools"]


def _closure_report(goal: str):
    from models.v5_state import V5SessionState
    from services.v5_capability_executor import execute_v5_capability

    state = V5SessionState(
        sessionId="t-capability-plan",
        goal={"text": goal, "status": "needs_refinement"},
    )
    result = execute_v5_capability(
        "appbundle.runtimeClosure", state, [], "appbundle", "t1"
    )
    return result if isinstance(result, dict) else result.model_dump()


def test_default_plan_still_emits_closure_verdict(monkeypatch):
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    report = _closure_report("企业采购审批系统")
    assert "runtimeClosure" in report
    assert report["blocked"] is True


def test_omitting_closure_skips_the_verdict_envelope(monkeypatch):
    """反向：计划里拿掉 closure，不许写出发布信封。删 includes 这条必红。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    no_closure = cp.product_rehearsal_plan(
        tools=tuple(t for t in cp.TOOLS if t != "closure"),
    )
    monkeypatch.setattr(
        "services.capability_plan.product_rehearsal_plan",
        lambda **_k: no_closure,
    )
    report = _closure_report("企业采购审批系统")
    assert "runtimeClosure" not in report
    assert "blocked" not in report


def test_run_spec_first_tools_argument_skips_bind_without_monkeypatch(monkeypatch):
    """活路径：tools= 必须进 select_workflow。只打孔 product_rehearsal_plan 会假绿。"""
    seen = _stub_pipeline(monkeypatch)
    try:
        out = sfp.run_spec_first(
            "做一个员工请假审批系统",
            preferred_device="phone",
            tools=("spec", "pages", "structure"),
        )
    finally:
        sfp.take_last_pages()
    assert seen["spec"] == 1
    assert seen["pages"] == 1
    assert seen["bind"] == 0
    assert "bind" not in out["stages"]["capabilityPlan"]["tools"]
    assert "specfirst.bind" not in out["stages"]["capabilityPlan"]["capabilities"]


def test_spec_only_skips_pages_and_bind(monkeypatch):
    seen = _stub_pipeline(monkeypatch)
    try:
        out = sfp.run_spec_first(
            "做一个员工请假审批系统",
            preferred_device="desktop",
            tools=("spec",),
        )
    finally:
        blob = sfp.take_last_pages()
    assert seen["spec"] == 1
    assert seen["pages"] == 0
    assert seen["bind"] == 0
    assert blob and blob.get("spec")
    assert out["spec"]["appName"] == "x"


def test_pages_without_spec_raises():
    with pytest.raises(sfp.SpecFirstError, match="SPEC"):
        sfp.run_spec_first("请假", tools=("pages",))


def test_pages_reuses_prior_spec_without_redrawing_it(monkeypatch):
    seen = _stub_pipeline(monkeypatch)
    prior = {
        "appName": "x",
        "personas": [],
        "pages": [{"id": "p1", "name": "首页"}],
        "nodes": [],
    }
    try:
        sfp.run_spec_first(
            "请假",
            preferred_device="desktop",
            tools=("pages",),
            reuse_spec=prior,
        )
    finally:
        sfp.take_last_pages()
    assert seen["spec"] == 0
    assert seen["pages"] == 1
    assert seen["bind"] == 0


def test_run_spec_first_pages_preview_skips_bind_without_monkeypatch(monkeypatch):
    """活路径：workflow 名字必须进 select_workflow。只打孔 plan 会假绿。"""
    seen = _stub_pipeline(monkeypatch)
    try:
        out = sfp.run_spec_first(
            "做一个员工请假审批系统",
            preferred_device="desktop",
            workflow="pages-preview",
        )
    finally:
        sfp.take_last_pages()
    assert seen["spec"] == 1
    assert seen["pages"] == 1
    assert seen["bind"] == 0
    assert out["stages"]["capabilityPlan"]["name"] == "pages-preview"
    assert "bind" not in out["stages"]["capabilityPlan"]["tools"]
    assert "specfirst.bind" not in out["stages"]["capabilityPlan"]["capabilities"]


def test_goal_tools_omit_closure_on_the_live_path_without_monkeypatch(monkeypatch):
    """执行器必须读 state.goal.tools。重建默认计划这条必红。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    from models.v5_state import V5SessionState
    from services.v5_capability_executor import execute_v5_capability

    state = V5SessionState(
        sessionId="t-goal-tools-omit-closure",
        goal={
            "text": "企业采购审批系统",
            "status": "needs_refinement",
            "tools": ["spec", "pages", "structure", "bind"],
        },
    )
    result = execute_v5_capability(
        "appbundle.runtimeClosure", state, [], "appbundle", "t1"
    )
    report = result if isinstance(result, dict) else result.model_dump()
    assert "runtimeClosure" not in report
    assert "blocked" not in report
    exec_src = _code(execute_v5_capability)
    assert '_goal_map.get("tools")' in exec_src
    assert '_goal_map.get("workflow")' in exec_src
    assert "select_workflow(" in exec_src
    assert 'includes("closure")' in exec_src


def test_executor_feeds_run_spec_first_the_stamp_not_the_todo():
    """接线：生成侧两处都必须走 _spec_first_tools_from_state。

    第 4 格：真机载荷 stamp=pages、待办 structure/bind → 只跑 pages。
    变异：改回 tools=_goal_map.get("tools") 绕过 helper，或 helper 再并待办 → 红。
    """
    from services.v5_capability_executor import (
        _build_per_skill_evidence,
        _spec_first_tools_from_state,
    )
    from models.v5_state import V5SessionState

    gen = _code(_build_per_skill_evidence)
    assert gen.count("_spec_first_tools_from_state(") >= 2
    assert "tools=_goal_map.get(" not in gen.replace(" ", "")
    helper = _code(_spec_first_tools_from_state)
    assert "live_spec_first_tools(" in helper

    state = V5SessionState(
        sessionId="sr-20260907112112-HATKBMVS6V",
        goal={"text": "社区便利店进销存", "tools": ["pages"]},
        factoryTodo=["structure", "bind"],
        specFirstPages={
            "spec": {"appName": "邻掌柜", "pages": [{"id": "p1"}]},
        },
    )
    assert _spec_first_tools_from_state(state) == ("pages",)
