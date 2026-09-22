"""骨架匹配必须接在 **run_spec_first → spec_tree** 这条通电的链上。

`match_app_template` 的契约、种子、单测（test_app_template.py）都对，但直到
2026-08-27 生产调用点为零——函数写对了 ≠ 它被调用了。本文件只守接线：

  1. 剥注释后 `match_app_template(` 出现在 `run_spec_first` 活体里
  2. 命中的骨架真的作为 prior 交给 `generate_spec_tree`（删调用点必红）
  3. 匹配失败 / 匹配器炸了都 fail-open，不拦推演

test_app_template.py 全绿 **不够**。把 `run_spec_first` 里那一次调用删掉，
本文件必须红，那边可以继续绿。
"""

from __future__ import annotations

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import spec_first_pipeline as sfp  # noqa: E402
from services.spec_tree import (  # noqa: E402
    _PHONE_SPEC_IA,
    _SKELETON_IA_HARD,
    SpecGenerationError,
    build_spec_prompt,
    generate_spec_tree,
)


def _code(obj) -> str:
    """源码去注释去 docstring —— 本仓注释里就写着这些函数名，不剥必然假绿。"""
    src = inspect.getsource(obj)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


SKELETON = {
    "id": "leave_approval",
    "name": "请假申请与审批",
    "industry": "人事",
    "when": "本人提申请、主管审批、HR 备案",
    "roleShape": ["我的请假", "主管审批"],
    "workflowShape": {"steps": 3, "hasApproval": True, "phases": ["申请", "审核"]},
    "pages": [
        {"id": "my_leave_workbench", "kind": "workbench", "purpose": "我的请假单"},
        {
            "id": "manager_leave_kanban",
            "kind": "kanban",
            "purpose": "主管审批看板",
            "blocks": [{"type": "DataTable", "region": "main"}],
        },
    ],
}

HIT = {
    "template": SKELETON,
    "verdict": {"score": 0.9, "passed": True, "applicable": True, "reason": "test"},
}


def test_match_app_template_call_is_in_the_live_run_spec_first_body():
    """剥注释再盯调用点。import 一行没有括号；注释里写函数名也不算。"""
    stripped = _code(sfp.run_spec_first)
    assert "match_app_template(" in stripped, (
        "match_app_template 没接到 run_spec_first —— 删调用点只留 import 会假绿"
    )
    assert "all_app_templates(" in stripped
    assert "skeleton=skeleton" in stripped


def test_generate_spec_tree_forwards_skeleton_into_the_prompt_builder():
    """下一跳也得通电：pipeline 把骨架递进 generate_spec_tree 之后，
    漏传给 build_spec_prompt 等于先验进了死插座。"""
    stripped = _code(generate_spec_tree)
    assert "skeleton=skeleton" in stripped
    assert "build_spec_prompt(" in stripped


def test_skeleton_formatter_receives_device_from_the_live_prompt_builder():
    """漏传 device，手机题会静默套上桌面页型硬要求——2026-08-20 同型。"""
    stripped = _code(build_spec_prompt)
    at = stripped.index("_format_skeleton_prior(")
    window = stripped[at : at + 80]
    assert "device=device" in window, "骨架先验没拿到 device，手机/桌面无法机械和解"


def test_matching_goal_passes_the_template_into_spec_tree(monkeypatch):
    """行为：命中的 template 必须作为 skeleton 交给 generate_spec_tree。

    反向：run_spec_first 里那次 match_app_template(...) 删掉，本条必红，
    哪怕函数还在被 import、test_app_template.py 全绿。
    """
    seen: dict = {}

    def fake_match(goal, templates):
        seen["match_goal"] = goal
        seen["n_templates"] = len(list(templates))
        return HIT

    def fake_spec(*_a, **kw):
        seen["skeleton"] = kw.get("skeleton")
        seen["spec_called"] = True
        raise sfp.SpecFirstError("捕获即止")

    monkeypatch.setattr("services.app_template.match_app_template", fake_match)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)

    with pytest.raises(sfp.SpecFirstError, match="捕获即止"):
        sfp.run_spec_first("做一个员工请假审批系统")

    assert seen.get("match_goal") == "做一个员工请假审批系统", (
        "match_app_template 没被 run_spec_first 叫到"
    )
    assert seen.get("n_templates", 0) >= 1, "没把模板全集交给匹配器"
    assert seen.get("spec_called"), "匹配之后没进 spec_tree"
    assert seen.get("skeleton") is SKELETON, (
        "命中的骨架没作为 prior 交给 generate_spec_tree"
    )


def test_match_miss_is_fail_open_and_still_runs_spec_tree(monkeypatch):
    """匹配失败 = 无骨架继续。不许因为没套上模板就抛、就 blocked。"""
    seen: dict = {}

    def fake_spec(*_a, **kw):
        seen["skeleton"] = kw.get("skeleton")
        seen["spec_called"] = True
        raise sfp.SpecFirstError("捕获即止")

    monkeypatch.setattr("services.app_template.match_app_template", lambda *_a, **_k: None)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)

    with pytest.raises(sfp.SpecFirstError, match="捕获即止"):
        sfp.run_spec_first("黑灰产情报自动化分析系统")

    assert seen.get("spec_called"), "没命中骨架就把 spec_tree 短路了"
    assert seen.get("skeleton") is None


def test_matcher_raise_is_fail_open_and_still_runs_spec_tree(monkeypatch):
    """匹配器自己炸了也 fail-open。骨架是增强类结构先验，不是证据闸。"""
    seen: dict = {}

    def boom(*_a, **_k):
        raise RuntimeError("matcher exploded")

    def fake_spec(*_a, **kw):
        seen["skeleton"] = kw.get("skeleton")
        seen["spec_called"] = True
        raise sfp.SpecFirstError("捕获即止")

    monkeypatch.setattr("services.app_template.match_app_template", boom)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)

    with pytest.raises(sfp.SpecFirstError, match="捕获即止"):
        sfp.run_spec_first("做一个员工请假审批系统")

    assert seen.get("spec_called"), "匹配器异常被当成了推演失败"
    assert seen.get("skeleton") is None


def _stub_pipeline_after_spec(monkeypatch) -> None:
    monkeypatch.setattr(
        "services.design_language.generate_style_brief", lambda *_a, **_k: None
    )
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
    monkeypatch.setattr(
        "services.spec_page_html.generate_pages_parallel",
        lambda spec, **kw: {"pages": {"p1": "<html>1</html>"}, "failed": {}},
    )
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure",
        lambda *_a, **_k: {"entities": [], "pages": []},
    )
    monkeypatch.setattr(
        "services.spec_semantics.derive_semantics", lambda *_a, **_k: {"roles": []}
    )
    monkeypatch.setattr(
        "services.model_assembly.assemble", lambda *_a, **_k: {"model": {"ok": 1}}
    )
    monkeypatch.setattr(
        "services.html_bindings.bind_pages",
        lambda pages, model, **kw: {"pages": pages, "failed": {}},
    )


def test_match_miss_does_not_return_a_blocked_envelope(monkeypatch):
    """整条跑完：没命中骨架不得变成 blocked / error 信封。"""
    monkeypatch.setattr("services.app_template.match_app_template", lambda *_a, **_k: None)
    monkeypatch.setattr(
        "services.spec_tree.generate_spec_tree",
        lambda *_a, **_k: {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        },
    )
    _stub_pipeline_after_spec(monkeypatch)

    try:
        out = sfp.run_spec_first("黑灰产情报自动化分析系统")
    finally:
        sfp.take_last_pages()

    assert isinstance(out, dict)
    assert out.get("model", {}).get("ok") == 1
    assert not out.get("blocked")
    assert "error" not in out or out.get("error") in (None, "", False)


def test_refine_round_does_not_press_skeleton_over_previous_structure(monkeypatch):
    """精修轮上一版已经在 refine 段里。骨架再压上去会打架。"""
    seen: dict = {}

    def fake_match(*_a, **_k):
        seen["matched"] = True
        return HIT

    def fake_spec(*_a, **kw):
        seen["skeleton"] = kw.get("skeleton")
        raise sfp.SpecFirstError("捕获即止")

    monkeypatch.setattr("services.app_template.match_app_template", fake_match)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)

    with pytest.raises(sfp.SpecFirstError, match="捕获即止"):
        sfp.run_spec_first(
            "做一个员工请假审批系统",
            refine={"instruction": "加一列模拟数据", "modelDigest": "实体：请假单"},
        )

    assert not seen.get("matched"), "精修轮不该再套骨架"
    assert seen.get("skeleton") is None


def test_skeleton_prior_reaches_the_spec_prompt():
    """generate_spec_tree 必须把骨架页清单写进 prompt，不是只收了参数。"""
    seen: dict = {}

    def fake_llm(messages):
        seen["user"] = messages[-1]["content"]
        return None

    with pytest.raises(SpecGenerationError):
        generate_spec_tree("请假审批", skeleton=SKELETON, llm_json_fn=fake_llm, max_reask=0)

    user = seen.get("user") or ""
    assert "我的请假单" in user
    assert "主管审批看板" in user
    assert "DataTable@main" in user
    assert "页清单" in user
    assert "entityRef" not in user
    assert "binding" not in user.lower()


def test_no_skeleton_leaves_the_spec_prompt_byte_identical():
    """不传骨架，提示词必须跟从前逐字一致——否则每道题都多一段空先验。"""
    assert build_spec_prompt("做一个订单管理系统") == build_spec_prompt(
        "做一个订单管理系统", skeleton=None
    )
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert "行业骨架先验" not in user
    assert "页清单" not in user


def test_skeleton_with_bindings_is_dropped_from_the_prompt():
    """骨架带绑定就整段丢。混进去会被结构闸当悬挂引用咬。"""
    dirty = {
        "id": "x",
        "name": "脏骨架",
        "pages": [
            {
                "id": "p1",
                "kind": "workbench",
                "purpose": "不该出现的用途",
                "entityRef": "order",
            }
        ],
    }
    user = build_spec_prompt("做个系统", skeleton=dirty)[-1]["content"]
    assert "不该出现的用途" not in user
    assert "entityRef" not in user
    assert "行业骨架先验" not in user


def test_phone_plus_skeleton_does_not_fight_phone_ia():
    """骨架硬要求 vs 手机切页硬要求必须机械和解，不求模型自觉。

    2026-08-20：壳是手机、内容是 PC。请假审批手机 App 会命中 leave_approval
    种子（workbench/kanban），再叠「不要抛开骨架」= 把宽屏 IA 锁进竖屏。
    反向：把 device 从 _format_skeleton_prior 拿掉，本条必红。
    """
    user = build_spec_prompt("请假审批", device="phone", skeleton=SKELETON)[-1]["content"]
    assert _SKELETON_IA_HARD not in user
    assert "不要抛开骨架" not in user
    assert "切页硬要求" in user
    assert "一屏一件主任务" in user
    assert "不是 PC 后台" in user
    for mark in ("一屏一件主任务", "不要左右分栏", "手机 App"):
        assert mark in _PHONE_SPEC_IA
        assert mark in user
    assert user.count("硬要求") == 1, "两套硬要求并排放——模型会选错那套"
    assert "我的请假单" in user
    assert "主管审批" in user
    assert "workbench" not in user
    assert "kanban" not in user
    assert "DataTable" not in user
    assert "页清单" not in user

    desk = build_spec_prompt("请假审批", device="desktop", skeleton=SKELETON)[-1]["content"]
    assert _SKELETON_IA_HARD in desk
    assert "页清单" in desk
    assert "my_leave_workbench" in desk
    assert "DataTable@main" in desk
    assert "一屏一件主任务" not in desk


def test_generate_spec_tree_phone_skeleton_keeps_phone_ia():
    """直接测 build_spec_prompt 绿了也不够——generate_spec_tree 漏传 device
    会静默回桌面硬要求。"""
    seen: dict = {}

    def fake_llm(messages):
        seen["user"] = messages[-1]["content"]
        return None

    with pytest.raises(SpecGenerationError):
        generate_spec_tree(
            "请假审批",
            device="phone",
            skeleton=SKELETON,
            llm_json_fn=fake_llm,
            max_reask=0,
        )
    user = seen.get("user") or ""
    assert "不要抛开骨架" not in user
    assert "一屏一件主任务" in user
    assert "我的请假单" in user


def test_phone_device_still_passes_skeleton_as_soft_prior(monkeypatch):
    """选的是 (b) 不是 (a)：手机仍匹配、仍把骨架递进 spec_tree，
    和解发生在 prompt 层。跳过匹配会丢掉用途/角色提示。"""
    seen: dict = {}

    def fake_match(goal, templates):
        seen["matched"] = True
        return HIT

    def fake_spec(*_a, **kw):
        seen["device"] = kw.get("device")
        seen["skeleton"] = kw.get("skeleton")
        raise sfp.SpecFirstError("捕获即止")

    monkeypatch.setattr("services.app_template.match_app_template", fake_match)
    monkeypatch.setattr("services.spec_tree.generate_spec_tree", fake_spec)

    with pytest.raises(sfp.SpecFirstError, match="捕获即止"):
        sfp.run_spec_first("做一个员工请假审批系统", preferred_device="phone")

    assert seen.get("matched"), "手机路径把匹配跳过了——用途提示没了"
    assert seen.get("device") == "phone"
    assert seen.get("skeleton") is SKELETON
