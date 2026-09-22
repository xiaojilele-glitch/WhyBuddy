# -*- coding: utf-8 -*-
"""假设确认后的剩余链不许重起草 SPEC（2026-09-04 真机）。

## 事故

真机 `sr-20260903220228-MXJ1AHF9AA`（社区旧物置换站）。答完假设卡点提交：

    [control] forced hop=pages hasSpec=1 hasPages=0
    capabilityPlan=product-rehearsal tools=spec,pages,structure,bind
    [enrich-timing] stage=specfirst.spec ms=18428 ok=1 pages=6 nodes=17
    [v5_capability_executor] spec-first 页面落库：0 份 · 有 SPEC

首版 SPEC 是 **5 页 16 节点**（22:03:44），重起草出来 **6 页 17 节点**。
两件事一起坏：

1. 用户刚确认的那些假设是针对**旧** SPEC 的，落到了一份新起草的上；
2. 这一跳的预算全烧在起草上，**页面一页都没画**——界面上就是
   「点了确认继续，还在起草规格」。

## 为什么上一轮的护栏没接住

`badec6f` 修过同名的病，护栏在 `v5_full_driver._factory_tools_from_state`：
会话里已有 SPEC、host 没点 spec 就把 spec 剔掉。那一半是对的——真机上
stamp 出来的 `goal.tools` 确实是 `pages,structure,bind`。

漏在另一半：`run_spec_first` 拿到窄化后的 tools，转手又
`select_workflow(tools=tools)`，然后用 **preset.tools** 当计划。而
`select_workflow` 见到「多件且缺 spec」会补根：

    ['pages','structure','bind']  → ['spec','pages','structure','bind']
    ['structure'] / ['bind']      → 原样（单跳不补，所以只在剩余链上现形）

§4 说的成对物只改一半：不报错，只是一半不生效。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.workflow_select import select_workflow

_PIPELINE = Path(__file__).resolve().parents[1] / "services" / "spec_first_pipeline.py"

PREV_SPEC = {"appName": "社区旧物置换站", "pages": [{"id": "p1"}, {"id": "p2"}]}


def _plan(tools, *, reuse_spec, refine=False):
    """复刻 run_spec_first 里那段计划推导（同一份源码，AST 取出来跑）。

    ⚠ 不重抄一遍逻辑——重抄的判据只能证明"我抄对了"，
      改了产线代码它照样绿。这里直接执行产线那几行。
    """
    src = _PIPELINE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "run_spec_first"
    )
    # 取从 `_plan_tools = ` 到 `plan = CapabilityPlan(` 之间那一段
    body_src = ast.get_source_segment(src, fn)
    start = body_src.index("_plan_tools = tuple(preset.tools)")
    end = body_src.index("plan = CapabilityPlan(", start)
    snippet = "\n".join(line[4:] if line.startswith("    ") else line
                        for line in body_src[start:end].split("\n"))
    preset = select_workflow(
        name="", archetype="business_app", device="desktop", refine=refine, tools=tools
    )
    ns = {"preset": preset, "tools": tools, "reuse_spec": reuse_spec}
    exec(compile(snippet, "<plan>", "exec"), ns)
    return ns["_plan_tools"], ns["_plan_ids"]


class Test补根这件事真的存在:
    """先证明这条路通电（§1）：不设边界，spec 就是会被加回来。"""

    def test_多件缺spec会被补根(self):
        preset = select_workflow(
            name="", archetype="business_app", device="desktop",
            tools=["pages", "structure", "bind"],
        )
        assert "spec" in preset.tools, (
            "select_workflow 不再补根的话，下面几条就是在空跑——"
            "换个仍会补根的组合，别把判据删了"
        )

    def test_单跳不补根(self):
        """真机上只有剩余链现形，单跳一直是好的——记下来免得误判范围。"""
        for one in ("structure", "bind"):
            preset = select_workflow(
                name="", archetype="business_app", device="desktop", tools=[one]
            )
            assert list(preset.tools) == [one]


class Test有上一版SPEC时不许重起草:
    def test_剩余链不含spec(self):
        """这条红 = 假设确认后又烧 18 秒重起草，页面一页不出。"""
        tools, ids = _plan(["pages", "structure", "bind"], reuse_spec=PREV_SPEC)
        assert "spec" not in tools, f"spec 又被补根加回来了：{tools}"
        assert "specfirst.spec" not in ids, (
            f"计划里还有 specfirst.spec —— 那一步就是按 plan.includes 判的：{ids}"
        )

    def test_design仍在(self):
        """⚠ 反向：pages 跳要靠 design 定风格，不许顺手一起摘掉。

        `assert_stages_match_tools` 对这一份是显式放行的（capability_plan:214）。
        """
        _, ids = _plan(["pages", "structure", "bind"], reuse_spec=PREV_SPEC)
        assert "specfirst.design" in ids, f"design 被误伤：{ids}"

    def test_不画页的跳不留design(self):
        """⚠ 2026-09-04：本条是我这条修复的第一版漏掉的那一半。

        `_do_design` 按 plan 成员判（spec_first_pipeline:1722），而
        `_skip_after_assumptions` 是在 **spec 那一步**里置位的。跳过 spec
        就没人置位，design 于是跑了起来——对 structure/bind 这种不画页的跳
        是白跑，还会被 `assert_stages_match_tools` 判成 extra：

            test_dry_run_walks_structure_not_a_clip
            extra=['specfirst.design']

        单跑那几个闸没盖住，跑全量才照出来。
        """
        _, ids = _plan(["structure", "bind"], reuse_spec=PREV_SPEC)
        assert "specfirst.design" not in ids, (
            f"不画页却留着 design，干跑会判 extra：{ids}"
        )

    def test_要画的那几步都还在(self):
        _, ids = _plan(["pages", "structure", "bind"], reuse_spec=PREV_SPEC)
        for need in ("specfirst.pages", "specfirst.structure", "specfirst.bind"):
            assert need in ids, f"{need} 不见了：{ids}"


class Test别的情形一律不动:
    """反向判据成组：只掐「已有 SPEC 且没点 spec」这一种。"""

    def test_没有上一版SPEC时照旧补根(self):
        """首轮就该补根——没 SPEC 不起草，后面全是空的。"""
        tools, ids = _plan(["pages", "structure", "bind"], reuse_spec=None)
        assert "spec" in tools
        assert "specfirst.spec" in ids

    def test_调用方点名了spec就跑(self):
        """用户明确要重起草（/精修 改需求那类），不许拦。"""
        tools, ids = _plan(
            ["spec", "pages", "structure", "bind"], reuse_spec=PREV_SPEC
        )
        assert "spec" in tools
        assert "specfirst.spec" in ids

    def test_没传tools时不动(self):
        tools, ids = _plan([], reuse_spec=PREV_SPEC)
        assert "spec" in tools

    @pytest.mark.parametrize("one", ["structure", "bind"])
    def test_单跳本来就没spec_不受影响(self, one):
        tools, _ = _plan([one], reuse_spec=PREV_SPEC)
        assert list(tools) == [one]


class Test接线接在了真的那条路上:
    """⚠ §1：badec6f 的护栏装在驱动侧，真机走的是流水线这一侧。

    两侧都得有，且都得由「会话里已有 SPEC」这一个事实驱动。
    """

    def test_流水线侧按reuse_spec判(self):
        src = _PIPELINE.read_text(encoding="utf-8")
        tree = ast.parse(src)
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "run_spec_first"
        )
        seg = ast.get_source_segment(src, fn)
        start = seg.index("_plan_tools = tuple(preset.tools)")
        chunk = seg[start:seg.index("plan = CapabilityPlan(", start)]
        assert "reuse_spec" in chunk, "不看有没有上一版 SPEC 就剔 spec，首轮会空转"
        assert '"spec" not in _requested' in chunk

    def test_驱动侧那一半还在(self):
        drv = (
            Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"
        ).read_text(encoding="utf-8")
        body = drv.split("def _factory_tools_from_state")[1].split("\ndef ")[0]
        assert "_state_has_spec(state)" in body, (
            "驱动侧那一半没了——goal.tools 会重新带上 spec，钟面步集也跟着错"
        )
