# -*- coding: utf-8 -*-
"""发布判定必须在产出链**末尾**算（2026-09-04 真机，15/15 会话）。

## 事故

真机 15 个会话，凡成型闭环的**全是 `0/6 + blocked`，一个例外没有**。
诊断为空、运行条件为空、`SLIDERULE_LLM_GENERATE_ENABLED=1`——
所以既不是「生成被关」也不是「闸拒绝」。

查能力执行顺序，三个会话完全一致：

    evidence.search → risk.analyze → critique.generate → report.write
    → appbundle.runtimeClosure     ← 信封在这里就算完了（第 5 位）
    → factory.pages → factory.structure → factory.bind → factory.closure
                      ↑ 页面 / 实体 / 角色全在信封之后才做出来

`appbundle.runtimeClosure` 每个会话**只跑一次**，跑在点火那一轮的规则短清单
里——那时页面 0、实体 0、角色 0，六段证据当然全 `missing`。之后工厂把东西
全做出来了，信封**再没重算过**。

所以 `0/6` 不是"认不出证据"，是**在还没有证据的时候就把证据数完了**，
然后那张快照一直挂到最后。用户可见的后果：屏幕上摆着六页应用，闭环却说
blocked——**合格证一张都发不出来**。

## 修法（用户在三个方案里选的第 2 个：从源头解决顺序）

抄 grok 的 Terminal 不变量（`xai-tool-runtime/src/dispatch.rs`）：

    /// Streaming dispatch. The returned stream MUST end with exactly one
    /// `Terminal` item per the [`ToolStream`] invariant.

判定就是 Terminal，Terminal 必须在最后。`closure` 这一跳的全部意义就是
出判定（`capability_plan` 头注：「closure 是判定，留给迭代」），
所以由它来建信封——语义与位置一致。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from services.v5_full_driver import _app_profile_short_picks, _host_hop_picks

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"
_CLOSURE_CAP = "appbundle.runtimeClosure"


def _st(*, tools=None, pages=0, **goal):
    g = {"text": "建材市场质量合规系统", "status": "clear", **goal}
    if tools is not None:
        g["tools"] = list(tools)
    st = V5SessionState(sessionId="s-verdict", goal=g)
    if pages:
        st.specFirstPages = {
            "pages": {f"p{i}": "<html>x</html>" for i in range(pages)},
            "spec": {"appName": "x", "pages": [{"id": "p0"}]},
        }
    return st


def _ids(picks):
    return [p["capabilityId"] for p in picks]


class Test判定挂在closure那一跳:
    def test_closure跳建信封(self):
        """这条红 = 判定又只在点火时算，合格证永远发不出。"""
        assert _ids(_host_hop_picks(_st(tools=["closure"]))) == [_CLOSURE_CAP]

    @pytest.mark.parametrize("hop", ["spec", "pages", "structure", "bind"])
    def test_别的跳不许碰信封(self, hop):
        """⚠ 反向：2026-09-03 真机（团子 XNDW5W2M59）五跳全 pick 信封，
        pages 写了两条之后 structure 被 max_repeat_guard 整跳跳过，
        画布「打过孔但没填上数据」。一跳一件的身份必须是 factory.{hop}。
        """
        got = _ids(_host_hop_picks(_st(tools=[hop])))
        assert got == [f"factory.{hop}"], got
        assert _CLOSURE_CAP not in got


class Test点火清单不许摘掉发动机:
    """⚠ 2026-09-04 我在这里改坏过一次，判据是为了不让它再发生。

    我把 `appbundle.runtimeClosure` 当成「只是出判定的信封」，于是给点火清单
    加了 `if _state_has_pages(state) or not picks:`，想避开"点火时算信封必然
    0/6"。真机 sr-20260904163026 当场停摆：stamp 了
    `factory-plan tools=spec,pages,structure,bind` 之后**一跳都没执行**，
    30 分钟只有 GET 轮询，页面 0。

    因为它根本不只是信封：`execute_v5_capability("appbundle.runtimeClosure")`
    里同时做**五系统模型生成**与**页面落库**。摘掉它等于把发动机拆了，
    只剩一张计划单。名字叫 runtimeClosure、干的却是"生成 + 判定"两件事，
    这个命名就是我误判的直接原因。
    """

    def test_点火一定带发动机(self):
        """这条红 = 点火不产出任何东西，只 stamp 一张计划单。"""
        for st in (_st(), _st(wantEvidence=True), _st(wantEvidence=True, pages=5)):
            assert _CLOSURE_CAP in _ids(_app_profile_short_picks(st)), (
                "点火清单里没有 appbundle.runtimeClosure —— 它是生成引擎，不是可选项"
            )

    def test_它永远排在最后(self):
        """取证在前、生成在后：evidence.search 的产物要能被生成读到。"""
        picks = _ids(_app_profile_short_picks(_st(wantEvidence=True)))
        assert picks[-1] == _CLOSURE_CAP, picks

    def test_点火清单不许为空(self):
        """空 picks 被判 convergence 直接收敛（:1589/:3148），点火那轮什么都不做。"""
        assert _app_profile_short_picks(_st())

    def test_源码里钉着为什么不许摘(self):
        """⚠ 注释是这条教训唯一的载体，删了下一个人还会再摘一次。"""
        src = _DRV.read_text(encoding="utf-8")
        assert "把发动机拆了" in src, "撤回那次的教训注释没了"


class Test接在真跑的那条路上:
    def test_两个函数都在流式驱动里被调(self):
        """CLAUDE.md §1：改之前先确认这条链真的在跑。"""
        src = _DRV.read_text(encoding="utf-8")
        tree = ast.parse(src)
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef)
            and n.name == "drive_full_v5_session_stream"
        )
        body = ast.unparse(fn)
        assert "_host_hop_picks(state)" in body
        assert "_app_profile_short_picks(state)" in body

    def test_点火清单不许再挂条件(self):
        """⚠ 反向：给 append 加任何条件都会把发动机摘掉（我 2026-09-04 干过）。"""
        tree = ast.parse(_DRV.read_text(encoding="utf-8"))
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_app_profile_short_picks"
        )
        appends = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.Expr) and _CLOSURE_CAP in ast.unparse(n)
        ]
        assert appends, "点火清单里没有发动机"
        # 那句 append 必须是函数体的直接语句，不许躲在 if 里
        top = [ast.unparse(n) for n in fn.body]
        assert any(_CLOSURE_CAP in t and t.startswith("picks.append") for t in top), (
            "append 被挂上条件了 —— 条件不成立时点火就只 stamp 计划、不产出"
        )
