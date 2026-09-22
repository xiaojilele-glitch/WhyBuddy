# -*- coding: utf-8 -*-
"""待办要给做决定的人看见（2026-09-04 真机 sr-20260904103406）。

## 事故

会话待办挂着 `["structure","bind"]`，用户说「继续，把还没做的补上」，
模型的提案却是整条 `spec,pages,structure,bind` —— 把已有的 **5 页** SPEC
重起草成 **3 页**（`stage=specfirst.spec ms=20643 pages=3 nodes=11`），
页面落库 0 份，二十分钟白烧。

## 机制

`factoryTodo` 在 `v5_agentic_pick.py` 里**一次都没出现**。给模型的状态摘要是

    【本轮用户输入】【目标】【健康产物】【未答问题】【覆盖缺口】【只读取料】

没有【待办】。账记下来了（阶段 1）、销账也修好了（3f76d75），
但**账从来没给做决定的人看过** —— 模型每次都从零重新规划，
在它看得见的信息里，重画整份 SPEC 是最合理的动作。

## 这是同一个病的第五次发作

「装好了但没通电」今晚的五种形态：

  1. 调用点条件永不成立      选材器被剖面排除，真机 0 命中
  2. 判据喂了自己拼的载荷    单测构造护栏需要的输入，真机不喂
  3. 能力/信息对模型不可见   派工提示词只写禁令不写触发条件
  4. 函数只挂在一条支路      销账只在选材器分支里，host hop 不走
  5. 守卫用显示态当判据      （测试脚本侧）拿 runtimePhase 当"能不能发"

本条是第 3 种的第二次发作。共同解药也一样：**让链路自己出声、让信息到达
真正做决定的那一方**。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from services.v5_agentic_pick import _state_digest

_SRC = (
    Path(__file__).resolve().parents[1] / "services" / "v5_agentic_pick.py"
).read_text(encoding="utf-8")


def _state(todo=None, tools=("pages",)):
    st = V5SessionState(
        sessionId="s-todo", goal={"text": "建材市场质量合规系统", "tools": list(tools)}
    )
    if todo is not None:
        st.factoryTodo = list(todo)
    return st


def _digest(todo=None):
    return _state_digest(_state(todo), "继续，把还没做的补上", 0, 6)


class Test待办出现在摘要里:
    def test_挂账时摘要有待办行(self):
        """这条红 = 模型看不见欠账，会重画整份 SPEC（真机实测 20 分钟白烧）。"""
        d = _digest(["structure", "bind"])
        assert "【首轮待办】" in d, f"摘要里没有待办：\n{d}"

    def test_列出的是人话加机器名(self):
        """模型要按机器名回填 picks，人话是给它判断语义的。"""
        d = _digest(["structure", "bind"])
        assert "数据结构(structure)" in d and "权限工作流(bind)" in d

    def test_说清后果(self):
        """光列清单不够——要让它知道不补完会怎样，否则仍可能绕开。"""
        d = _digest(["structure"])
        assert "闭环" in d and "合格证" in d

    def test_明说别重画(self):
        """真机那一刀就是重画。禁令跟着一条事实走（grok reminder 措辞）。"""
        assert "别重画已经有的东西" in _digest(["bind"])


class Test没有欠账时不加噪音:
    def test_空账不出现待办行(self):
        """⚠ 反向：账清完还念叨，模型会以为还欠着。"""
        assert "【首轮待办】" not in _digest([])

    def test_没有这个字段时也不出现(self):
        assert "【首轮待办】" not in _digest(None)

    def test_生词不进摘要(self):
        """⚠ 反向：只认公开五件，脏数据不许透给模型。"""
        d = _digest(["structure", "不是工具", ""])
        assert "数据结构(structure)" in d
        assert "不是工具" not in d


class Test接在真跑的那条路上:
    def test_摘要函数真的读了这个字段(self):
        assert "factoryTodo" in _SRC, "本文件又不读待办了"
        assert "factory_todo_open" in _SRC, "没走公开五件的过滤"

    def test_顶层import不许退回函数体(self):
        """⚠ 架构闸：函数体 import 算逃生口，只许变少（今天刚栽过一次）。"""
        head = _SRC[: _SRC.index("def ")]
        assert "factory_todo_open" in head, "import 掉进函数体了"
