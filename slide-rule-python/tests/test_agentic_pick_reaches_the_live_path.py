# -*- coding: utf-8 -*-
"""节点内 ReAct 必须在真机那条路上通电（2026-09-04）。

## 事故

用户看完架构问：「目前还是死流程，不是很智能呢」。查下来是对的，而且能定位到一行。

仓里**有**一个 LLM 选材器 `agentic_pick_next_capabilities`，它的开关函数写着

    profile=app 也跑——边界是短清单，不是整张作文词表   （v5_agentic_pick:498）

但流式驱动的调用点又把它否掉了：

    if picks and should_run_agentic_pick(...) and not (
        profile == "app"
        and (_host_factory_hop(state) or _first_pass_chain(state))
    ):

真机 `profile` 恒为 `app`，而这两个谓词——控制面一跳一件 / 首轮产出链——
**合起来覆盖全部产品推演**。实测印证：三份过夜 dev 日志、11 次整轮真机落库，
`[factory-plan]` / `agentic` 关键字出现 **0 次**，这台机器一次没跑过。

更糟的是**同步**驱动（:1310）是 `if picks:` 无条件跑的。单测看的是那一半，
所以全绿——CLAUDE.md §4「只改一半必然静默失效」，而且失效的是活着的那一半。

## 这个文件为什么直接执行产线表达式

CLAUDE.md「一之二」：护栏装对了地方、条件却永远不成立，而单测自己构造了
护栏需要的那个输入。所以这里**不重抄判断逻辑**——从 AST 里把产线那行 if 的
判据原样取出来 eval，喂真机那一发的原样载荷（`goal.tools` 抄自 09-04 日志）。
重新收窄条件、或把谓词改名，这些判据立刻红。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from models.v5_state import V5SessionState

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"


def _stream_gate_src() -> str:
    """流式驱动里那行 `if picks and should_run_agentic_pick(...)` 的判据原文。"""
    tree = ast.parse(_DRV.read_text(encoding="utf-8"))
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef)
        and n.name == "drive_full_v5_session_stream"
    )
    gates = [
        n.test for n in ast.walk(fn)
        if isinstance(n, ast.If) and "should_run_agentic_pick" in ast.unparse(n.test)
    ]
    assert len(gates) == 1, f"流式驱动里 agentic 闸不是一处（{len(gates)}）"
    return ast.unparse(gates[0])


def _eval_gate(*, profile: str, repair: bool, tools) -> bool:
    """把产线判据放进真机载荷里跑一遍。逻辑不重抄，只提供输入。"""
    from services.v5_full_driver import _first_pass_chain, _host_factory_hop
    from services.v5_agentic_pick import should_run_agentic_pick

    state = V5SessionState(
        sessionId="sr-gate-1",
        goal={"text": "做一个社区宠物寄养平台", "tools": list(tools)},
    )
    ns = {
        "picks": [{"capabilityId": "runtimeClosure", "roleId": "综合"}],
        "should_run_agentic_pick": should_run_agentic_pick,
        "_host_factory_hop": _host_factory_hop,
        "_first_pass_chain": _first_pass_chain,
        "profile": profile,
        "repair": repair,
        "state": state,
    }
    return bool(eval(_stream_gate_src(), ns))  # noqa: S307 — 就是要跑产线那行


class Test真机那一发进得去:
    """载荷抄自 2026-09-04 真机日志，不是自己拼的。"""

    def test_首轮产出链(self):
        """`capabilityPlan=product-rehearsal tools=spec,pages,structure,bind`。"""
        assert _eval_gate(
            profile="app", repair=False, tools=["spec", "pages", "structure", "bind"]
        ), "首轮产出链仍被排除——这正是修复前 0 次命中的那一支"

    def test_假设确认后的剩余链(self):
        """`capabilityPlan=product-rehearsal tools=pages,structure,bind`。"""
        assert _eval_gate(
            profile="app", repair=False, tools=["pages", "structure", "bind"]
        )

    def test_一跳一件(self):
        """`[control] forced hop=pages` 之后的 host hop。"""
        assert _eval_gate(profile="app", repair=False, tools=["pages"])
        assert _eval_gate(profile="app", repair=False, tools=["structure"])

    def test_非app剖面照旧进得去(self):
        assert _eval_gate(profile="full", repair=False, tools=["spec", "pages"])


class Test该关的仍然关着:
    def test_repair不许走LLM选材(self):
        """⚠ 反向：修什么以门说了算（should_run_agentic_pick 头注）。"""
        assert not _eval_gate(
            profile="app", repair=True, tools=["spec", "pages", "structure", "bind"]
        )

    def test_规则清单为空时不跑(self):
        """⚠ 反向：`picks and ...`——没有合法清单就没有可减的菜。"""
        from services.v5_agentic_pick import should_run_agentic_pick
        from services.v5_full_driver import _first_pass_chain, _host_factory_hop

        ns = {
            "picks": [],
            "should_run_agentic_pick": should_run_agentic_pick,
            "_host_factory_hop": _host_factory_hop,
            "_first_pass_chain": _first_pass_chain,
            "profile": "app",
            "repair": False,
            "state": V5SessionState(sessionId="s", goal={"tools": ["pages"]}),
        }
        assert not bool(eval(_stream_gate_src(), ns))  # noqa: S307


class Test边界还在_模型发明不出第六道菜:
    """放开闸之后，安全性全靠这三层。一层塌了这里就红。"""

    def test_工厂词表只有五件(self):
        from services.capability_plan import TOOLS
        from services.v5_agentic_pick import factory_tool_vocab

        vocab = factory_tool_vocab(["spec", "pages", "structure", "bind"])
        assert set(vocab) <= set(TOOLS)
        assert "report" not in vocab and "critique" not in vocab and "risk" not in vocab

    def test_提案跑出规则清单就被丢掉(self):
        from services.v5_full_driver import _clip_agentic_picks_to_legal

        legal = [{"capabilityId": "specfirst.pages"}, {"capabilityId": "specfirst.bind"}]
        out = _clip_agentic_picks_to_legal(
            [{"capabilityId": "essay.report"}, {"capabilityId": "specfirst.bind"}], legal
        )
        assert [i["capabilityId"] for i in out] == ["specfirst.bind"]

    def test_提案全不合法就回落规则清单(self):
        """⚠ 反向：不许因为提案没用就端出空清单（那是「成功但内容为空」）。"""
        from services.v5_full_driver import _clip_agentic_picks_to_legal

        legal = [{"capabilityId": "specfirst.pages"}]
        out = _clip_agentic_picks_to_legal([{"capabilityId": "essay.report"}], legal)
        assert out == legal

    def test_app剖面必须传工厂词表(self):
        """⚠ 反向：不传 vocab 就是把作文词表放进工厂（test_rehearse_skips_essay_caps）。"""
        src = _DRV.read_text(encoding="utf-8")
        assert "factory_tool_vocab(_factory_legal)" in src, (
            "调用点没传工厂词表，闸放开之后作文能力会漏进工厂"
        )


class Test两条驱动没有再走岔:
    """CLAUDE.md §4：同步/流式是成对物，这次的病根就是两边判据不同。"""

    def test_同步与流式都会跑LLM选材(self):
        tree = ast.parse(_DRV.read_text(encoding="utf-8"))
        fns = {
            n.name: n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name in ("drive_full_v5_session", "drive_full_v5_session_stream")
        }
        assert len(fns) == 2, f"两条驱动没都找到：{sorted(fns)}"
        for name, fn in fns.items():
            assert any(
                "agentic_pick_next_capabilities" in ast.unparse(n)
                for n in ast.walk(fn)
            ), f"{name} 里没有 LLM 选材——又只改了一半"

    def test_流式的闸不许再挂剖面排除(self):
        """⚠ 反向判据，钉的就是这次的病灶本身。"""
        gate = _stream_gate_src()
        assert "_host_factory_hop" not in gate and "_first_pass_chain" not in gate, (
            f"流式闸又按剖面把 app 排除了，真机将再次一次都不跑：{gate}"
        )
