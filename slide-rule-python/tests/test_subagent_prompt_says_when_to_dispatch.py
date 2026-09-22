# -*- coding: utf-8 -*-
"""派工提示词要说**什么时候派**，不能只说什么不许派（2026-09-04）。

## 事故

阶段 3 的只读子代理接线全通（提示词两分支都提了 tasks、两条驱动都调
`_run_readonly_subagents`、写侧双重挡、fail-open 齐全），但真机**连跑三趟
子代理 0 只**，其中两趟话题是特意挑的合规取证（食安报备、监管自查）。

这条路原来是完全静默的——「0 只」有三种解释：模型没提、提了被写侧拒、
提了但种类是生词。先加日志把三种分开（跟隔壁「提案全被门剔除」同一条纪律），
真机立刻给出答案：

    [agentic-pick] loop 0: 派工 模型没提 tasks

## 机制

原提示词里关于 tasks 只有一句，而且整句是**禁令**：

    tasks 是只读取料子代理，可并行；写侧（spec/pages/structure/bind/closure）
    只能放 picks，不许派出去写。

只说了这是什么、什么不许，**没有一个字说什么时候该派**。模型默认输出最小
合法集合，于是把这个键整个略掉。

⚠ 这是「装好了但没通电」的第三种形态：前两次是调用点条件不成立、判据喂了
  假载荷；这次是**能力对模型不可见**——接线通、开关开、就是没人按。

## 修法

抄 grok reminder 的措辞：陈述事实与触发条件，禁令只跟着一条事实走。
现在写明「必须给这个键，没有就写 []」+ 三种触发场景各对应哪个 type。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_SRC = (
    Path(__file__).resolve().parents[1] / "services" / "v5_agentic_pick.py"
).read_text(encoding="utf-8")

#: 提示词里 tasks 那一段的两个分支（工厂词表 / 作文词表）。
#: ⚠ 成对物：只改一个 = 一半不生效（CLAUDE.md §4）。
_BRANCHES = re.findall(r'"tasks 这个键[\s\S]{0,600}?不许派出去', _SRC)


class Test两个分支都说了什么时候派:
    def test_两个分支都在(self):
        assert len(_BRANCHES) == 2, (
            f"派工说明只剩 {len(_BRANCHES)} 处——工厂词表与作文词表是成对物，"
            "只改一处等于一半不生效"
        )

    @pytest.mark.parametrize("i", (0, 1))
    def test_必须给这个键(self, i):
        """这条红 = 模型又会把整个 tasks 略掉（真机实测就是这么丢的）。"""
        assert "必须给" in _BRANCHES[i]
        assert "[]" in _BRANCHES[i], "没告诉模型「没有就写空数组」"

    @pytest.mark.parametrize("i", (0, 1))
    def test_写清三种触发场景(self, i):
        seg = _BRANCHES[i]
        assert "什么时候该派" in seg, "只说了是什么、不许什么，没说什么时候派"
        for kind in ("compliance", "evidence", "page_quality"):
            assert kind in seg, f"{kind} 没有对应的触发场景"

    @pytest.mark.parametrize("i", (0, 1))
    def test_禁令还在_但只剩写侧那一条(self, i):
        """⚠ 反向：放宽措辞不许把写侧那道闸说没了。

        写侧派出去会撞上 specFirstPages 整份替换（subagent_tasks 头注）。
        """
        assert "不许派出去" in _BRANCHES[i]


class Test出声这件事没被顺手删掉:
    """⚠ 反向：日志是这次能定位的唯一原因。删了下次又只能猜。"""

    def test_三种情况分得开(self):
        assert "派工 模型没提 tasks" in _SRC, "「模型没提」这一支不出声了"
        assert "派工 提案" in _SRC and "收下" in _SRC, "「提了几条、收下几条」不出声了"

    def test_收下的种类要打出来(self):
        """只打数量分不清「收下 2 条」是哪两种。"""
        seg = _SRC[_SRC.index("派工 提案") - 400 : _SRC.index("派工 提案") + 200]
        assert "_kinds" in seg or "type" in seg
