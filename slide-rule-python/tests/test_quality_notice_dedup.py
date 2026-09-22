# -*- coding: utf-8 -*-
"""同一条质检通知不许重复上流。

## 事故（2026-09-06 第二轮真机，校区自习室座位预约）

一轮里 `quality_notice` 发了 **18 条，去重后只有 6 条** —— 同一条
「页面 X：对比度不足…」原样重复三遍。用户之前提过的「27 条大量重复」
是同一个根因。

质检本身没问题：`spec_first_pipeline` 每次跑完都把全部页面重检一遍并广播，
而那条流水线在**一个 turn 里跑多次**（每个 factory 跳一次：pages / structure
/ bind）。流水线内部有 `_quality_notices_var` 桶，所以**单次运行不重复**；
重复发生在**跨运行**，而 sink 是流级的、一直装着。

所以去重必须落在**流级** —— 跟 `stage_pairing.StagePairTracker` 同一层，
同一个理由：那一层才跨得过流水线的多次运行。

## 抄的是 grok 的哪一处

`xai-grok-sampling-types/src/conversation.rs` 的 `dedup_duplicate_tool_results()`：

    /// Remove duplicate `ToolResult` entries for the same `tool_call_id`.
    /// … only the **last** occurrence is kept (the real result), and earlier
    /// duplicates are removed.
    /// Returns the number of duplicate entries removed.

照抄三件：去重键是**稳定身份**、头注写明**为什么必须去重**、**返回抑制了几条**
（静默丢弃事件是本仓反复吃亏的形状）。

## ⚠ 跟 grok 反过来的那一点

grok 留**最后一条**，因为它改的是可变的 conversation 列表，能删掉先前那条。
SSE 是发出去就收不回的流 —— 等价做法是**让第一条过、压后来的重复**。
下一个人照着 grok 把它改成"留最后一条"的话，在流上等于先发一条再发一条，
去重完全失效。本文件有一条判据专门钉这个方向。
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.session_events import (  # noqa: E402
    RepeatSuppressor,
    notice_identity,
    notice_payload,
)

DRIVER = Path(__file__).parent.parent / "services" / "v5_full_driver.py"


class Test抑制器:
    def test_原样重复只让第一条过(self):
        s = RepeatSuppressor()
        assert s.allow("contrast|pageId=p1", "对比度不足") is True
        assert s.allow("contrast|pageId=p1", "对比度不足") is False
        assert s.allow("contrast|pageId=p1", "对比度不足") is False
        assert s.suppressed == 2

    def test_留的是第一条不是最后一条(self):
        """⚠ 跟 grok 反过来，理由见模块头注。

        流上没有"删掉先前那条"这回事：`allow` 第一次必须 True。
        变异：改成"最后一条才 True" → 本条红。
        """
        s = RepeatSuppressor()
        first = s.allow("k", "同一句")
        second = s.allow("k", "同一句")
        assert (first, second) == (True, False), (
            "第一条被压住了 —— 在流上这等于这条通知永远发不出去"
        )

    def test_内容变了要放行(self):
        """⚠ 只按身份去重的话，同一页在**打孔之后**重检得出的**不同**结论
        会被吃掉，而那正是新信息。

        变异：`allow` 只比 key 不比 payload → 本条红。
        """
        s = RepeatSuppressor()
        assert s.allow("contrast|pageId=p1", "对比度不足") is True
        assert s.allow("contrast|pageId=p1", "打孔后仍缺 3 处绑定") is True
        assert s.suppressed == 0

    def test_内容变回去还要放行(self):
        """A → B → A：第三条是**当前**结论，不是重复。

        变异：把 `_seen` 从「身份→最近一次内容」改成「见过的全部内容集合」
        → 本条红。
        """
        s = RepeatSuppressor()
        s.allow("k", "A")
        s.allow("k", "B")
        assert s.allow("k", "A") is True

    def test_不同身份互不影响(self):
        s = RepeatSuppressor()
        assert s.allow("contrast|pageId=p1", "同一句") is True
        assert s.allow("contrast|pageId=p2", "同一句") is True
        assert s.suppressed == 0

    def test_抑制了几条要数得出来(self):
        """抄 grok 的 `Returns the number of duplicate entries removed`。
        静默丢弃事件是本仓反复吃亏的形状。"""
        s = RepeatSuppressor()
        for _ in range(3):
            s.allow("k", "同一句")
        c = s.counters()
        assert c == {"passed": 1, "suppressed": 2, "distinct": 1}
        assert c["passed"] + c["suppressed"] == 3, "调用方本来打算发 3 条"


class Test身份与内容怎么分:
    def test_身份带指向物不带文本(self):
        """⚠ 文本进身份的话，文案改一个字就被当成另一条通知，去重形同虚设。"""
        a = notice_identity({"kind": "contrast", "pageId": "p1", "text": "甲"})
        b = notice_identity({"kind": "contrast", "pageId": "p1", "text": "乙"})
        assert a == b == "contrast|pageId=p1"

    def test_没有指向物时身份带上文本(self):
        """⚠ 第一版这里只用 `kind`，真机当场失效：对比度通知对六个页面各说一次，
        六条共用 `contrast` 一个身份，而内容轮着变（页面名不同），抑制器每次
        都判成"内容变了→放行"，**一条都压不住**（18 条原样发出去）。

        变异：去掉 `|text=` → 下面 Test真机那一轮 的两条红。
        """
        assert notice_identity({"kind": "graph_scope_fallback"}) == "graph_scope_fallback"
        a = notice_identity({"kind": "contrast", "text": "页面 p1：对比度不足"})
        b = notice_identity({"kind": "contrast", "text": "页面 p2：对比度不足"})
        assert a != b, "没有 pageId 字段时，两页的通知不许共用一个身份"
        assert a == notice_identity({"kind": "contrast", "text": "页面 p1：对比度不足"})

    def test_有pageId字段时身份不带文本(self):
        """有结构化指向物的走上面那条：文案改一个字不算另一条通知，
        这样"内容变了要放行"的语义才立得住。"""
        a = notice_identity({"kind": "contrast", "pageId": "p1", "text": "甲"})
        b = notice_identity({"kind": "contrast", "pageId": "p1", "text": "乙"})
        assert a == b == "contrast|pageId=p1"

    def test_不同页面不同身份(self):
        assert notice_identity({"kind": "contrast", "pageId": "p1"}) != notice_identity(
            {"kind": "contrast", "pageId": "p2"}
        )

    def test_内容指纹认文本也认条数(self):
        """孤岛那类通知带 items，条数变了是新信息。"""
        assert notice_payload({"text": "3 个孤岛", "items": [1, 2, 3]}) != notice_payload(
            {"text": "3 个孤岛", "items": [1, 2]}
        )


class Test真机那一轮:
    _PAGES = (
        "seat_hogging_report", "seat_selection", "my_reservations_and_credit",
        "operations_and_reports", "violation_ticket_audit", "area_and_timeslot_mgmt",
    )
    #: 真机 18 条**原样**：只有 kind + text，页面名烘在 prose 里、没有 pageId 字段。
    #: 这一份必须保持"没有 pageId"，它测的正是那种情况也得压得住。
    REAL = [
        {"kind": "contrast", "text": f"页面 {p}：正文与背景对比度不足，弱视用户读不动"}
        for p in _PAGES
    ] * 3
    #: 修好之后的形状：pageId 成了结构化字段。
    REAL_WITH_FIELD = [
        {
            "kind": "contrast",
            "pageId": p,
            "text": f"页面 {p}：正文与背景对比度不足，弱视用户读不动",
        }
        for p in _PAGES
    ] * 3

    def test_十八条压成六条(self):
        s = RepeatSuppressor()
        out = [n for n in self.REAL if s.allow(notice_identity(n), notice_payload(n))]
        assert len(self.REAL) == 18
        assert len(out) == 6, f"压完还有 {len(out)} 条"
        assert s.suppressed == 12
        assert len({n["text"] for n in out}) == 6, "压掉的不是重复，是把不同的也吃了"

    def test_这六条都不许丢(self):
        """⚠ 代价判据。只写「18 压成 6」的话，把 allow 改成永远 False 也能让
        条数变少 —— 那是把通知全关掉，不是去重。"""
        s = RepeatSuppressor()
        out = [n for n in self.REAL if s.allow(notice_identity(n), notice_payload(n))]
        assert {n["text"] for n in out} == {n["text"] for n in self.REAL}

    def test_带上pageId字段之后同样压成六条(self):
        """修好之后的形状。两种形状都要压得住：
        库里可能还有没带 pageId 的历史通知。"""
        s = RepeatSuppressor()
        out = [
            n
            for n in self.REAL_WITH_FIELD
            if s.allow(notice_identity(n), notice_payload(n))
        ]
        assert len(out) == 6 and s.suppressed == 12
        assert {n["pageId"] for n in out} == set(self._PAGES)

    def test_带字段时打孔后的新结论要放行(self):
        """有结构化 pageId 才谈得上这个语义：同一页重检得出**不同**结论是新信息。"""
        s = RepeatSuppressor()
        first = {"kind": "contrast", "pageId": "p1", "text": "对比度不足"}
        after = {"kind": "contrast", "pageId": "p1", "text": "打孔后仍缺 3 处绑定"}
        assert s.allow(notice_identity(first), notice_payload(first)) is True
        assert s.allow(notice_identity(after), notice_payload(after)) is True
        assert s.suppressed == 0


class Test接线:
    """去重必须真的接在泵的排水口上，而且是**流级**那一本。"""

    def _driver_code(self) -> str:
        src = DRIVER.read_text(encoding="utf-8")
        return "\n".join(
            l for l in src.splitlines() if not l.lstrip().startswith("#")
        )

    def test_抑制器建在流级不是泵局部(self):
        """变异：把 `_quality_dedup = _RepeatSuppressor()` 挪进
        `_pump_llm_deltas` → 每个泵一本，跨流水线运行的重复又漏出来。

        判法：它必须出现在 `async def _pump_llm_deltas` **之前**。
        """
        code = self._driver_code()
        assert "_quality_dedup = _RepeatSuppressor()" in code, "没建抑制器"
        i_make = code.index("_quality_dedup = _RepeatSuppressor()")
        i_pump = code.index("async def _pump_llm_deltas")
        assert i_make < i_pump, "抑制器建在泵里面了 —— 每个泵一本等于没去重"

    def test_排水口真的问过它(self):
        code = self._driver_code()
        assert "_quality_dedup.allow(" in code, "排水口没问抑制器"

    def test_按身份加内容问不是只按身份(self):
        code = self._driver_code()
        assert "_notice_identity(_note), _notice_payload(_note)" in code, (
            "只传了身份没传内容 —— 打孔后的新结论会被吃掉"
        )

    def test_被压住的那条不许还发出去(self):
        """顺序判据：`allow` 为假必须 `continue`，不能只是记个数然后照发。"""
        node = next(
            n
            for n in ast.walk(ast.parse(DRIVER.read_text(encoding="utf-8")))
            if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
            and n.name == "_pump_llm_deltas"
        )
        guards = [
            n
            for n in ast.walk(node)
            if isinstance(n, ast.If)
            and "quality_dedup" in ast.dump(n.test)
        ]
        assert guards, "泵里找不到那道去重闸"
        bodies = [ast.dump(g) for g in guards]
        assert any("Continue" in b for b in bodies), (
            "去重闸没有 continue —— 数了但照样发出去了"
        )

    def test_对比度通知把页面名给成字段(self):
        """★ 变异检查逼出来的一条。

        前面那些判据用的都是自己造的通知字典，钉不住**真正发通知的那一处**
        有没有把 `pageId` 给成字段。真机第一版就是只烘在 prose 里
        （`text="页面 p1：对比度不足…"`），流级去重拿不到"这条说的是哪一页"。

        变异：删掉 `pageId=str(_pid)` → 本条红。
        """
        pipe = (
            Path(__file__).parent.parent / "services" / "spec_first_pipeline.py"
        ).read_text(encoding="utf-8")
        i = pipe.index('"contrast",')
        window = pipe[i : i + 300]
        assert "pageId=" in window, (
            "对比度通知没把页面名给成字段 —— 去重只能拿到 kind，六页共用一个身份"
        )

    def test_发通知的口子支持pageId(self):
        """`_emit_quality_notice` 的签名里得有这一格，否则调用方传不进去。"""
        import inspect

        from services.spec_first_pipeline import _emit_quality_notice

        params = inspect.signature(_emit_quality_notice).parameters
        assert "pageId" in params, "_emit_quality_notice 收不下 pageId"
        assert params["pageId"].kind is inspect.Parameter.KEYWORD_ONLY, (
            "pageId 得是 keyword-only —— 位置参数会跟 text 混"
        )

    def test_只有质检那条流被去重(self):
        """⚠ 别顺手把别的流也去重了。

        `spec_page` **必须**允许同一页重复上流（素颜 → 外壳统一 → 打孔三批，
        前端按 pageId 覆盖，这是设计）。`llm_delta` 同样天然重复。
        """
        code = self._driver_code()
        for other in ('"type": "spec_page"', '"type": "llm_delta"'):
            i = code.index(other)
            window = code[max(0, i - 600) : i]
            assert "_quality_dedup.allow(" not in window, (
                f"{other} 也被去重了 —— 那三批页面重发是设计，不是重复"
            )
