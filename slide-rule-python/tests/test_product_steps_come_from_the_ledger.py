# -*- coding: utf-8 -*-
"""钟面步集由账本算，前端不许再查表（2026-09-02）。

## 这条判据在守什么

前端一直自带一张 `PUBLIC_TOOL_TO_STEP`（公开工具 → 步号），跟账本对不上：

    bind      前端 5 / 账本 6           → bind 那 4~10 分钟钟上没有 current
    closure   前端 6 / 账本里没这个阶段    → pages-preview 第 6 格永远 pending
    semantics 前端根本没有               → 第 5 格整格不画

上一轮把 `bind: 5` 改成 `6`——**改表不是删表**。`stage_legal` 模块头写的是
「正确的抄法是删表」，`session_events` 写的是「不许在前端再补一张表」。

现在步集由 `product_steps_for_stages(expand_tools(tools))` 算，随 goal 下发。
这份判据钉住三件事：账本算得对、写入点只有一个、两个 util 叶子没有互相 import。
"""

from __future__ import annotations

import ast
from pathlib import Path

from services.capability_plan import expand_tools
from services.stage_legal import product_steps_for_stages


def _steps(tools, *, refine: bool = False):
    return product_steps_for_stages(expand_tools(tools, refine=refine))


class Test账本算步集:
    def test_pages_preview_不含第6步(self):
        """closure 不是 spec-first 阶段，不该点亮「汇合过闸」。

        这是真机看得见的那条：钟上挂一个谁也点不亮的第 6 格。
        """
        assert _steps(["spec", "pages", "closure"]) == (2, 3)

    def test_bind_带出第5步(self):
        """bind 隐含 structure/semantics/assemble，semantics 是第 5 步。

        旧前端表没有 semantics 这一项，第 5 格被当成「没选」直接不画。
        """
        steps = _steps(["spec", "pages", "bind"])
        assert 5 in steps, f"第 5 步应当在场，实际 {steps}"
        assert steps == (2, 3, 4, 5, 6)

    def test_按钮点火单跳只亮一格(self):
        """「一跳一件」要在钟面上看得见，不是跑全量还画满格。"""
        assert _steps(["spec"]) == (2,)

    def test_空菜单不瞎补(self):
        """没有工具就没有步。补默认值是前端的活（老会话全开），不是账本的。"""
        assert _steps([]) == ()

    def test_名单外的阶段不贡献步号(self):
        """`specfirst.shell` 故意不进账本（零 LLM、实测 0.004 秒）。

        ⚠ 不许在这里给它补一个默认步号——不报就是不报。
        """
        assert product_steps_for_stages(["specfirst.shell"]) == ()
        assert product_steps_for_stages(["根本不存在的阶段"]) == ()

    def test_升序去重(self):
        """assemble 与 bind 都是第 6 步，只能占一格。"""
        assert product_steps_for_stages(
            ["specfirst.bind", "specfirst.spec", "specfirst.assemble"]
        ) == (2, 6)


class Test接线只有一处:
    """反向判据：光有函数不算数，得确认它真的被接在写入点上（纪律三）。"""

    def _control_src(self) -> str:
        return (
            Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
        ).read_text(encoding="utf-8")

    def test_没有裸写goal_tools的地方(self):
        """三个写入点必须都走 `_set_goal_tools`。

        ⚠ 剥注释后再比对（纪律二）：`_set_goal_tools` 的文档字符串里就写着
        `goal["tools"]`，裸 grep 会把它自己算进去，判据永远红。
        """
        tree = ast.parse(self._control_src())
        bare = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if (
                    isinstance(target, ast.Subscript)
                    and isinstance(target.slice, ast.Constant)
                    and target.slice.value == "tools"
                ):
                    bare.append(node.lineno)
        # 唯一合法的一处在 `_set_goal_tools` 函数体内
        helper = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "_set_goal_tools"
        )
        inside = [ln for ln in bare if helper.lineno <= ln <= (helper.end_lineno or 0)]
        outside = [ln for ln in bare if ln not in inside]
        assert not outside, (
            f"这些行绕过 _set_goal_tools 直接写 goal['tools']：{outside}。"
            "写了 tools 不写 productSteps，那条路径的钟会按上一轮的步集画。"
        )
        assert len(inside) == 1

    def test_写tools必定同时写productSteps(self):
        helper_src = self._control_src().split("def _set_goal_tools")[1].split("\ndef ")[0]
        assert 'goal["tools"]' in helper_src
        assert 'goal["productSteps"]' in helper_src


class Test驱动器那处也得写:
    """⚠ 2026-09-02：控制面不是唯一写 goal["tools"] 的地方。

    `v5_full_driver._stamp_factory_tools_onto_goal` 的文档字符串自己写着
    「run_spec_first / **钟**都读这里」——减完菜的那轮走的是它。只改控制面
    那三处，减菜路径的钟面会静静按上一轮的格子画：正是 §4 说的成对物只改一半。
    """

    def _driver_src(self) -> str:
        return (
            Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"
        ).read_text(encoding="utf-8")

    def test_盖章函数同时写两个字段(self):
        body = self._driver_src().split("def _stamp_factory_tools_onto_goal")[1].split("\ndef ")[0]
        assert 'goal["tools"]' in body
        assert 'goal["productSteps"]' in body, (
            "驱动器减菜后只写了 tools。钟读的就是这里——少这一行，"
            "pages-preview 那轮的格子会按上一轮画。"
        )

    def test_factory_plan事件带步集(self):
        """前端 onFactoryPlan 从这个事件写 goal，事件不带步集它就只能猜。"""
        src = self._driver_src()
        for chunk in src.split('"type": "factory_plan"')[1:]:
            head = chunk[:400]
            assert "productSteps" in head, "factory_plan 事件必须带 productSteps"

    def test_两个flow写入点都走同一个组合(self):
        base = Path(__file__).resolve().parents[1] / "services"
        for name in ("rehearsal_control", "v5_full_driver"):
            src = (base / f"{name}.py").read_text(encoding="utf-8")
            assert "product_steps_for_tools" in src, (
                f"{name} 没走共用组合——抄第二份就是 §4 的老毛病"
            )

    def test_工厂信封盖tools必须走同一把章(self):
        """2026-09-03 团子的一天：信封只写 tools，钟停在起草 SPEC。

        变异：把 `_stamp_factory_tools_onto_goal` 改回 `goal["tools"]=wanted`
        → 本条红。
        """
        src = (
            Path(__file__).resolve().parents[1]
            / "services"
            / "drive_full_factory.py"
        ).read_text(encoding="utf-8")
        tree = ast.parse(src)
        src_no_doc = ast.unparse(tree)
        assert "_stamp_factory_tools_onto_goal" in src_no_doc
        # 剥文档串后再找裸写：头注里会提到 goal["tools"]。
        bare = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if (
                    isinstance(target, ast.Subscript)
                    and isinstance(target.slice, ast.Constant)
                    and target.slice.value == "tools"
                ):
                    bare.append(node.lineno)
        assert not bare, (
            f"drive_full_factory 裸写 goal['tools'] 于 {bare}，"
            "钟面步集不会一起走。"
        )


class Test叶子层没有互相import:
    """`stage_legal` 与 `capability_plan` 都是 util 叶子（may_depend_on = []）。

    组合发生在调用点（flow 层）。谁 import 谁都会让架构闸变红——这条先在这里挡住，
    免得下一个人图省事把 expand_tools 搬进账本。
    """

    def test_两个叶子互不依赖(self):
        base = Path(__file__).resolve().parents[1] / "services"
        for name, other in (
            ("stage_legal", "capability_plan"),
            ("capability_plan", "stage_legal"),
        ):
            src = (base / f"{name}.py").read_text(encoding="utf-8")
            tree = ast.parse(src)
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and other in (node.module or ""):
                    raise AssertionError(f"{name} 不许 import {other}：两个都是 util 叶子")
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        assert other not in alias.name, (
                            f"{name} 不许 import {other}：两个都是 util 叶子"
                        )
