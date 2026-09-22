# -*- coding: utf-8 -*-
"""一跳一件的精修没有模型，段沿用不许因此炸掉（2026-09-04 真机）。

## 事故

真机 `sr-20260903232557-BNFJTZ957Q`（社区老年助餐点）。首轮 4 页落库正常，
随后发一条精修「配送清单页按楼栋分组的折叠面板改成默认全部展开……」：

    [enrich-timing] stage=specfirst.pagescope ms=2703 ok=1
                    scopePages=meal_delivery_check reusedPages=3
    [enrich-timing] stage=specfirst.pages ms=15759 ok=1 reusedPages=3 got=4
    Traceback (most recent call last):
      ...
      File "services/spec_first_pipeline.py", line 2184, in run_spec_first
      File "services/spec_first_pipeline.py", line 2188, in <listcomp>
    AttributeError: 'NoneType' object has no attribute 'get'
    [v5_capability_executor] spec-first 失败，不回落老链路
    [v5_capability_executor] refine failed, keeping previous model（本轮修改未生效）

## 机制

「一跳一件」的精修是 **pages 单跳**（`capabilityPlan tools=pages`）。
assemble 被 `plan.includes("specfirst.assemble")` 挡在门外根本不跑，于是
`model` 一路保持 :2103 的初值 `None`——这本来是合法形状，返回处就写着
`"model": model`，单跳不产模型是预期。

漏的是第 6.2 步：`apply_refine_segment_reuse(None, …)` 原样返回 None，
紧接着的 listcomp `model.get(seg)` 当场炸。

段沿用是增强类，它自己的文档串写着 fail-open（纪律七）：
「把它写成 fail-closed 会让一次本来能跑完的推演直接崩掉」——真机上正是如此。

## 为什么没人早点发现

宽 except 把 AttributeError 吃成一句 `str(exc)[:200]`，只说「什么坏了」
不说「在哪坏的」。同一个 except 2026-08-31 还吃过一次 NameError。
崩点是加了 `traceback.print_exc()`（96f0d9c）之后**第一次精修就现形**的。

## 同类守卫

同文件 `_stamp_preferred_device`（:1265）、`page_id_freeze.freeze_pages_in_model`
（:220）用的都是 `isinstance(model, dict)`。本处是唯一漏掉的一个。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.spec_first_pipeline import apply_refine_segment_reuse

_PIPE = Path(__file__).resolve().parents[1] / "services" / "spec_first_pipeline.py"

PREV_MODEL = {
    "datamodel": {"entities": [{"id": "elder"}]},
    "rbac": {"roles": [{"id": "volunteer"}]},
    "workflow": {"nodes": [{"id": "n1"}]},
}


def _reuse_block():
    """把产线那一段（第 6.2 步）原样取出来编译好，供下面执行。

    ⚠ 不重抄逻辑——重抄的判据只能证明"我抄对了"。
    """
    src = _PIPE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "run_spec_first"
    )
    seg = ast.get_source_segment(src, fn)
    start = seg.index("if refine and refine_reuse_enabled()")
    end = seg.index("# 汇合出口再拨一次", start)
    body = seg[start:end]
    # 这一段在 run_spec_first 里缩进 4 格（函数体顶层），去掉再编译
    body = "\n".join(l[4:] if l.startswith("    ") else l for l in body.split("\n"))
    return compile(body, "<reuse-block>", "exec")


def _run_block(model, *, reuse_model=PREV_MODEL, refine=True):
    from services import spec_first_pipeline as sfp

    ns = {
        "refine": refine,
        "refine_reuse_enabled": lambda: True,
        "apply_refine_segment_reuse": sfp.apply_refine_segment_reuse,
        "REFINE_REUSABLE_SEGMENTS": sfp.REFINE_REUSABLE_SEGMENTS,
        "_assemble_gate_fn": lambda: None,
        "model": model,
        "reuse_model": reuse_model,
        "spec": {"refineScope": []},
        "stages": {},
    }
    exec(_reuse_block(), ns)
    return ns["model"], ns["stages"]


class Test单跳没有模型时不许炸:
    def test_model为None不抛(self):
        """这条红 = 精修又静默失败，用户改一处、等几分钟、页面原样。"""
        model, stages = _run_block(None)
        assert model is None, "本轮没有模型，跳过即可，不该凭空造一个"
        assert "refineReuse" not in stages, "没沿用就别写这笔台账，免得下游当成沿用过"

    def test_不吃掉别的假值(self):
        """⚠ 反向：守卫要认「是不是字典」，不是「真不真」。

        空字典是**合法的模型形状**（还没填段），不许被当成没有模型跳过——
        写成 `if model:` 就会把它一起漏掉。
        """
        model, stages = _run_block({})
        assert "refineReuse" in stages, "空字典是合法模型，段沿用该照常走"


class Test有模型时行为不变:
    def test_照常沿用并记台账(self):
        model, stages = _run_block(dict(PREV_MODEL))
        assert isinstance(model, dict)
        assert "refineReuse" in stages
        assert stages["refineReuse"]["scopeDeclared"] is True

    def test_非精修轮压根不进这一段(self):
        model, stages = _run_block(dict(PREV_MODEL), refine=False)
        assert "refineReuse" not in stages


class Test函数本身的契约:
    """`apply_refine_segment_reuse` 拿到 None 会原样返回——它不是罪魁，
    但这条契约得钉住，免得有人在函数里"顺手"加个默认值把问题藏起来。"""

    def test_传None原样返回None(self):
        assert apply_refine_segment_reuse(None, PREV_MODEL, [], gate_fn=None) is None


class Test守卫真的在调用点上:
    """⚠ §3：函数里防住不算数，得确认**调用点**防住了。"""

    def test_第六点二步带isinstance守卫(self):
        src = _PIPE.read_text(encoding="utf-8")
        tree = ast.parse(src)
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "run_spec_first"
        )
        seg = ast.get_source_segment(src, fn)
        line = seg[seg.index("if refine and refine_reuse_enabled()"):].split("\n")[0]
        assert "isinstance(model, dict)" in line, (
            f"第 6.2 步没防 None，pages 单跳会再炸一次：{line!r}"
        )

    @pytest.mark.parametrize(
        "where,needle",
        [
            ("_stamp_preferred_device", "isinstance(model, dict)"),
        ],
    )
    def test_同类守卫的写法一致(self, where, needle):
        """跟同文件既有守卫同一个写法，别再发明第二种。"""
        src = _PIPE.read_text(encoding="utf-8")
        body = src.split(f"def {where}")[1].split("\ndef ")[0]
        assert needle in body
