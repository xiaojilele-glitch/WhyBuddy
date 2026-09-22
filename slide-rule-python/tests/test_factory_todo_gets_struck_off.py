# -*- coding: utf-8 -*-
"""待办只进不出——活干完了账没销（2026-09-04 真机 sr-20260904103406）。

## 事故

建材市场那趟：模型把 structure/bind 延后 → 进账（这半句是对的，阶段 1 验过）。
之后控制面一跳一件把两件**都跑完了**，ask 卡原话：

    权限与工作流绑定已完成（2个角色、9项权限、4个工作流节点已挂载至5个页面）

而库里 `factoryTodo` 仍然是 `["structure","bind"]`。

## 病灶

销账原来写在 `v5_full_driver._record_factory_todo(ran=_stamped)`，而那一处
**只在选材器出了提案并 stamp 成功时才执行**：

    if _proposal:
        ...
        if _stamped is not None:
            _record_factory_todo(state, ran=_stamped, ...)

控制面一跳一件的 host hop 根本不走这条分支 —— 于是「摘了进账」有人管，
「跑完销账」没人管。**账只进不出。**

后果是复合的：账不清 → 闭环永远挂 `CLOSURE_FACTORY_TODO_OPEN` → 合格证
发不出；「首轮没做完」的判定也永远为真，版本史跟着一直空。

## 修法

挂到 `_cache_spec_first_pages` —— **每一跳都会经过的唯一落库口**
（host hop / 首轮链 / 精修轮都走 take_last_pages），
而 `capabilityPlan.tools` 是流水线自己写的「这一跳真正跑了哪几件」。
销账按**实际跑了什么**算，不按选材器 stamp 了什么。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.capability_plan import merge_factory_todo

_EXEC = Path(__file__).resolve().parents[1] / "services" / "v5_capability_executor.py"


class Test销账挂在每一跳都过的那个口:
    def test_落库口里真的销账(self):
        """这条红 = 待办只进不出，闭环永远发不出合格证。"""
        src = _EXEC.read_text(encoding="utf-8")
        assert "merge_factory_todo" in src, "落库口没有销账"
        assert "capabilityPlan" in src and "factoryTodo" in src

    def test_销账在_cache_spec_first_pages里(self):
        """⚠ 挂错函数 = 又只盖住一部分路径。"""
        tree = ast.parse(_EXEC.read_text(encoding="utf-8"))
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_cache_spec_first_pages"
        )
        assert "merge_factory_todo" in ast.unparse(fn), (
            "销账不在落库口里——host hop 那条路又会漏"
        )

    def test_ran取的是本跳实际计划(self):
        """⚠ 反向：不许拿 goal.tools（那是 stamp 的意图，不是跑了什么）。"""
        tree = ast.parse(_EXEC.read_text(encoding="utf-8"))
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_cache_spec_first_pages"
        )
        src = ast.unparse(fn)
        assert "'capabilityPlan'" in src or '"capabilityPlan"' in src

    def test_销账失败不许拖垮落库(self):
        """⚠ CLAUDE.md §7：销账是顺路的事，炸了不能把页面落库带崩。"""
        tree = ast.parse(_EXEC.read_text(encoding="utf-8"))
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_cache_spec_first_pages"
        )
        tries = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.Try) and "merge_factory_todo" in ast.unparse(n)
        ]
        assert tries, "销账没被 try 包住"

    def test_出声(self):
        """账变了要留痕——不然下次又只能靠翻库猜。"""
        assert "[factory-todo]" in _EXEC.read_text(encoding="utf-8")


class Test销账的算术:
    """真机那一发的原样载荷：账上 structure,bind，这一跳跑了 bind。"""

    def test_跑掉的划掉_没跑的留着(self):
        assert merge_factory_todo(("structure", "bind"), ran=("bind",)) == ("structure",)

    def test_两件都跑掉就清空(self):
        assert merge_factory_todo(("structure", "bind"), ran=("structure", "bind")) == ()

    def test_跑了不相干的不动账(self):
        """⚠ 反向：pages 跑完不许把 structure 一起划掉。"""
        assert merge_factory_todo(("structure", "bind"), ran=("pages",)) == (
            "structure",
            "bind",
        )

    def test_空账不许被跑掉的东西凭空加项(self):
        """⚠ 反向：销账只减不增。"""
        assert merge_factory_todo((), ran=("structure", "bind")) == ()
