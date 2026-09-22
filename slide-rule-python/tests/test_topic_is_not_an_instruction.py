# -*- coding: utf-8 -*-
"""首轮话题不是指令：话题里的 hop 词不许决定跑哪一跳（2026-09-04 真机）。

## 事故

真机话题「做一个社区旧物置换站，把物品、置换记录、押金的**数据结构**理清楚」。
点「开始推演」，uvicorn 只留下一行：

    [control] forced hop=structure hasSpec=0 hasPages=0

后面连 `capabilityPlan=` 都没有——一件活没干，界面上就是点了没反应。
`数据结构` 命中 `factory_hop_from_text` 的 structure 规则，而首轮会话里
根本没有可供反推的交付物。

## 为什么上一轮的护栏没接住

`badec6f` 已经修过一次同名的病，判据也绿：它让文本**只压残留 hop、不压显式
意图**，写成 `if hop and (forced is None or forced in FACTORY_HOPS)`。

漏在 `forced is None` 这一支。`useSlideRuleSession` 的函数头注释白纸黑字：

    /推演 不得在客户端带 rehearse——未确认卡由服务端 park

首轮点火**本来就不传** forcedTool，于是 `forced is None` 成立，文本照样赢。
护栏挡的是「显式意图被盖掉」，挡不住「压根没有显式意图」。

当时的单测喂的是 `{'forcedTool': 'rehearse'}` ——**真机根本不传这个**。
CLAUDE.md §1：判据装在了不通电的插座上。

## 现在的判据

首轮（没 SPEC 也没页面）= 这句是产品话题，文本里的 hop 词一律不算数。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.closed_tools import factory_hop_from_text
from services.rehearsal_control import resolve_forced_tool

#: 真机那条话题，原样。
TOPIC = "做一个社区旧物置换站，把物品、置换记录、押金的数据结构理清楚"


class Test话题确实带陷阱:
    """先证明这条路真的通电（§1）：不设边界，文本就是会赢。"""

    def test_话题里认得出hop词(self):
        assert factory_hop_from_text(TOPIC) == "structure", (
            "话题不再命中 structure 的话，下面几条就是在空跑——"
            "换一条含 hop 词的话题，别把判据删了。"
        )

    def test_非首轮时文本仍然算数(self):
        """反向：这条护栏只管首轮，不许顺手把精修轮的人话 hop 也废掉。"""
        assert resolve_forced_tool({}, "进入数据模型反推", first_pass=False) == "structure"


class Test首轮话题不许决定hop:
    def test_真机那一发_不带forcedTool(self):
        """⚠ 复刻真机 POST：前端首轮**不传** forcedTool（函数头注释写着）。

        这条红 = 又回到 `[control] forced hop=structure hasSpec=0 hasPages=0`，
        点开始推演一件活不干。
        """
        assert resolve_forced_tool({}, TOPIC, first_pass=True) is None

    def test_带了rehearse也不许被盖(self):
        """上一轮护栏管的那一支，继续得管。"""
        assert (
            resolve_forced_tool({"forcedTool": "rehearse"}, TOPIC, first_pass=True)
            == "rehearse"
        )

    def test_首轮默认参数不改老调用(self):
        """不传 first_pass = 老行为。放宽只针对显式声明首轮的调用点。"""
        assert resolve_forced_tool({}, TOPIC) == "structure"

    @pytest.mark.parametrize(
        "topic",
        [
            "做个工具共享站，把借还的数据结构理清楚",
            "社区旧书交换平台，重点是页面生成的顺序",
            "做一个门店权限绑定管理台",
        ],
    )
    def test_各种含hop词的话题都不劫持(self, topic):
        assert resolve_forced_tool({}, topic, first_pass=True) is None


class Test别的口子没被顺手废掉:
    """反向判据成组：first_pass 只掐文本 hop，其余分支原样。"""

    def test_显式repair仍然生效(self):
        assert resolve_forced_tool({"mode": "repair"}, TOPIC, first_pass=True) == "repair"

    def test_斜杠精修仍然生效(self):
        assert resolve_forced_tool({}, "/精修 改配色", first_pass=True) == "refine"

    def test_斜杠回退仍然生效(self):
        assert resolve_forced_tool({}, "/回退", first_pass=True) == "restore_version"

    def test_显式factory_hop仍然生效(self):
        """用户明确点了 structure 按钮，首轮也照跑（blocker 会说人话）。"""
        assert (
            resolve_forced_tool({"forcedTool": "structure"}, "随便", first_pass=True)
            == "structure"
        )


class Test调用点真的传了首轮:
    """⚠ §3：光有形参不算数。函数改对了、调用点不传，等于没修。"""

    def _ctrl(self) -> ast.Module:
        return ast.parse(
            (
                Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
            ).read_text(encoding="utf-8")
        )

    def test_控制面调用点带了first_pass(self):
        calls = [
            n
            for n in ast.walk(self._ctrl())
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "resolve_forced_tool"
        ]
        assert calls, "没有调用点？那这个函数是死代码"
        for c in calls:
            assert any(k.arg == "first_pass" for k in c.keywords), (
                "调用点没传 first_pass —— 真机照样 forced hop=structure"
            )

    def test_首轮口径是没spec也没页面(self):
        """口径要跟前端那半边一致（§4）。写死 True/False 都会红。

        ⚠ 用 AST 取实参再 unparse，别按 `)` 切源码——第一个 `)` 落在
          `_has_spec(state)` 里面，切出来的是半句。第一版就这么自己红的。
        """
        calls = [
            n
            for n in ast.walk(self._ctrl())
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "resolve_forced_tool"
        ]
        for c in calls:
            kw = next(k for k in c.keywords if k.arg == "first_pass")
            expr = ast.unparse(kw.value)
            assert "_has_spec(state)" in expr and "_has_pages(state)" in expr, (
                f"first_pass 不是由会话状态算出来的：{expr!r}"
            )
