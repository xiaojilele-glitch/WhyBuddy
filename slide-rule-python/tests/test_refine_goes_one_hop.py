# -*- coding: utf-8 -*-
"""精修也走逐跳，不再 profile="full" 一把梭（2026-09-02）。

## 这条判据在守什么

⚠ 真机（社区图书馆那趟）：`refine` 分支只写 `goal["text"]`、直接
`profile="full"`，于是**「一跳一件」在最常走的路径上等于没生效**——
`capabilityPlan=product-rehearsal`，43 步 195 秒把 spec→pages→structure→
semantics→assemble→bind→closure 全跑完；而控制面收尾还在问「或是进入下一步的
结构绑定?」，那步本轮早跑完了（bind 51.2s、bound=4）。

控制面的心智模型（一跳）和工厂的实际行为（全量）对不上，就是这么来的。

## 为什么只改 refine、不改 repair

`repair` 的 `profile="full"` **是有意的**，不是漏改：它用
`pick_repair_capabilities`，由覆盖门决定重跑哪些能力；
`skip_planning_loop_for_refine` 的文档字符串写着「repair 仍走循环：覆盖门
决定修什么，不给精修短路」。把它压成单跳会把覆盖门那套选材废掉。

这条判据把「repair 保持 full」也钉住——免得下一个人看见 refine 改了，
顺手把 repair 一起改了。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from services.closed_tools import FACTORY_HOPS

_SRC = Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"


def _strip_comments(code: str) -> str:
    """⚠ 匹配前先剥注释（纪律二）。

    本仓栽过：判据 grep 一个标识符，而那个词**同时出现在注释里** → 变异后照样绿。
    这份判据自己也差点栽——解释「为什么改」的注释里就写着 `profile="full"`。
    """
    return re.sub(r"(?m)^\s*#.*$", "", code)


def _branch(name: str, *, forced: bool = False) -> str:
    """取出某个工具分支的源码（已剥注释）。

    `forced=True` 取按钮那条（`if forced == "x"`）。⚠ 精修有两个入口，
    只看一个等于只验了一半。
    """
    src = _SRC.read_text(encoding="utf-8")
    head = f'if forced == "{name}":' if forced else f'if name == "{name}":'
    assert head in src, f"找不到 {name} 分支（forced={forced}）"
    rest = src.split(head, 1)[1]
    pat = r'\n    if forced == "' if forced else r'\n    if name == "'
    nxt = re.search(pat, rest)
    return _strip_comments(rest[: nxt.start()] if nxt else rest)


class Test精修走逐跳:
    def test_refine_不再用full档(self):
        body = _branch("refine")
        assert 'profile="app"' in body, (
            "精修必须用 app 档才会进 _host_factory_hop 的逐跳分支；"
            'profile="full" 会把整条链一口气跑完。'
        )
        assert 'profile="full"' not in body

    def test_refine_写单件工具(self):
        """`_host_factory_hop` 要求 goal["tools"] **恰好一件**，多一件就回全量。"""
        body = _branch("refine")
        assert "_set_goal_tools(goal, [hop], refine=True)" in body, (
            "精修没写 goal['tools']，工厂那边 _host_factory_hop 为假 → 走全量菜单"
        )

    def test_没点名时已有SPEC从pages起(self):
        """⚠ 2026-09-07 水果店：缺省 spec 把刚确认的假设整份重起草。

        按钮点火已经是 `pages if _has_spec else spec`。模型挑 refine 不给 hop
        必须同一缺省——只改按钮等于一半不生效。
        """
        body = _branch("refine")
        assert "pages" in body and "_has_spec" in body
        assert 'raw_hop or (' in body or 'raw_hop or ("pages"' in body

    def test_点名了生词要重问_不静默回落(self):
        """跟 `clip_factory_tools` 同一套语义（O-2 那条）：

        「没点名」可以给默认值；「点名了但是生词」是模型在乱点，得说出来，
        不许悄悄回落成默认值——那正是回落全菜单那个洞的同一形状。
        """
        body = _branch("refine")
        assert "raw_hop not in FACTORY_HOPS" in body
        head = body.split("raw_hop not in FACTORY_HOPS", 1)[1][:700]
        assert "_canned" in head, "生词应当走 _canned 重问"
        assert "return" in head, "重问之后必须 return，不许继续点火"

    def test_前置闸仍然在(self):
        """没有 SPEC 就挑 pages 之类，要被 `_factory_hop_blocker` 说人话挡住。"""
        body = _branch("refine")
        assert "_factory_hop_blocker(state, hop)" in body

    def test_工具schema把hop暴露给模型(self):
        """光有代码不算数——模型看不见这个参数就永远点不出 hop（纪律三）。"""
        src = _SRC.read_text(encoding="utf-8")
        chunk = src.split('"name": "refine"', 1)[1][:900]
        assert '"hop"' in chunk, "refine 的 parameters 里没有 hop，模型无从点名"
        assert "FACTORY_HOPS" in chunk, "enum 应当直接引账本里的那份，别手抄一遍"


class Test按钮那条入口也改了:
    """⚠ 精修有两个入口：模型在 _dispatch_tool 里挑，和用户点按钮走 forcedTool。

    只改前者，按钮那条（更常走的那条）照样全量跑，而且**不会报错**——
    CLAUDE.md 第四条：「成对的东西改一条不改另一条，只会有一半不生效」。
    """

    def test_forced_refine_也是app档(self):
        body = _branch("refine", forced=True)
        assert 'profile="app"' in body
        assert 'profile="full"' not in body

    def test_forced_refine_也写单件工具(self):
        body = _branch("refine", forced=True)
        assert "_set_goal_tools(goal, [_hop], refine=True)" in body

    def test_forced_refine_也过前置闸(self):
        body = _branch("refine", forced=True)
        assert "_factory_hop_blocker(state, _hop)" in body


class Test修复轮保持全量:
    """反向判据：repair 的 full 是有意的，不许被顺手改掉。"""

    def test_repair_两个入口都仍然是full(self):
        for forced in (False, True):
            body = _branch("repair", forced=forced)
            assert 'profile="full"' in body, (
                f"repair(forced={forced}) 被改成非 full 了。"
                "它用 pick_repair_capabilities，由覆盖门选材。"
                "压成单跳会把那套选材废掉——skip_planning_loop_for_refine 的注释写着"
                "「repair 仍走循环」。"
            )

    def test_repair_说明(self):
        body = _branch("repair")
        assert 'profile="full"' in body, (
            "repair 用 pick_repair_capabilities，由覆盖门选材。"
            "压成单跳会把那套选材废掉——skip_planning_loop_for_refine 的注释写着"
            "「repair 仍走循环」。"
        )

    def test_repair_不写单件工具(self):
        body = _branch("repair")
        assert "_set_goal_tools" not in body


class Test两条分支没有别的full残留:
    def test_点火路径上只剩repair用full(self):
        """全文件扫一遍 profile= 的取值，确认 full 只出现在该出现的地方。

        ⚠ 用 AST 取关键字实参，不 grep 字符串——文档字符串里就写着
        `profile="full"`（解释 repair 为什么保持全量），裸 grep 会把注释算进去。
        """
        tree = ast.parse(_SRC.read_text(encoding="utf-8"))
        fulls = 0
        apps = 0
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for kw in node.keywords or ():
                if kw.arg == "profile" and isinstance(kw.value, ast.Constant):
                    if kw.value.value == "full":
                        fulls += 1
                    elif kw.value.value == "app":
                        apps += 1
        # repair 有两个入口（模型挑 / 按钮点），两处都该保持 full。
        assert fulls == 2, f"只有 repair 的两个入口该用 full，实际 {fulls} 处"
        assert apps >= 4, f"批准/单跳/精修两入口至少四处 app 档，实际 {apps} 处"
