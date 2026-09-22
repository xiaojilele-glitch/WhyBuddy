# -*- coding: utf-8 -*-
"""流水线阶段账本：五份步骤表收成一本（2026-08-30）。

「用户在左栏看到的步骤」2026-08-30 数下来有五份，互相对不上：
后端两份（turn_narration / v5_full_driver）、前端三份（文案表 / 权属表 /
3D 场景词表，最后一份与前四份**只有 spec_tree 一个词对得上**）。

后端加一步 → 前端显示原始 id；后端删一步 → 前端那条永远不亮。

抄 grok 的 `xai-grok-session-events`（typed 自描述事件）：**删表，不是改表**。
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import stage_legal as S  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parent

#: 改造前两份后端表的内容。**故意逐字重抄**：账本被改动时当场红。
HISTORICAL = {
    "specfirst.spec": ("起草规格：成功判据、需求节点与页面清单", "通常 60~90 秒"),
    "specfirst.design": ("定这个应用的设计语言", "通常 10~20 秒"),
    "specfirst.pagescope": ("判断这次要改哪几页", "通常 5~15 秒"),
    "specfirst.graphscope": ("分析这次修改牵扯的范围", "通常 3~10 秒"),
    "specfirst.pages": ("逐页画界面（并发）", "通常 3~4 分钟，页数越多越久"),
    "specfirst.structure": ("从界面反推数据模型与关联关系", "通常 60~120 秒"),
    "specfirst.semantics": ("推导权限、工作流与不变式", "通常 60~120 秒"),
    "specfirst.assemble": ("汇合五系统模型并过结构闸", "通常 20~40 秒"),
    "specfirst.bind": ("给界面接上数据", "较慢，通常 4~10 分钟，页数越多越久"),
    # ⚠ 老生成链（spec-first 之前那条）。**建账本时我第一版把这五条弄丢了**：
    #   正则只抓了 `specfirst.*`，因为我以为这张表只有流水线的步骤。
    #   全量测试当场红（test_enrich_stage_visibility）。
    #   **只抓自己认识的那一半，就是丢掉另一半。**
    "model.generate": ("生成五系统模型", "通常 3~4 分钟"),
    "model.regenerate": ("按结构闸的意见重做模型", "通常 3~4 分钟"),
    "monitor.sheet": ("生成首页参照图", "通常 80~110 秒，偶尔要 4 分钟"),
    "monitor.palette": ("从参照图读取配色", "通常 15~25 秒"),
    "monitor.design": ("照着参照图设计页面版式", "通常 55~100 秒，偶尔要 4~5 分钟"),
}


class Test零行为变化:
    def test_人话与耗时逐字等于改造前(self):
        assert S.labels_with_eta() == HISTORICAL

    def test_两份后端表现在同源(self):
        from services.turn_narration import _SPEC_FIRST_LABELS
        from services.v5_full_driver import _ENRICH_STAGE_LABELS

        # turn_narration 那份**只要 spec-first 九条**（它讲的是本轮流水线叙述），
        # v5_full_driver 那份还要带老生成链——形状不同是有意的，同源即可。
        assert _SPEC_FIRST_LABELS == {
            k: v[0] for k, v in HISTORICAL.items() if k.startswith("specfirst.")
        }
        assert _ENRICH_STAGE_LABELS == HISTORICAL

    def test_bind的耗时区间没被改窄(self):
        """⚠ 第六条：这是实测标定过的。原写「3~4 分钟」实测 9.2 分钟，
        差一倍多——写窄了比不写更糟：用户等到第 5 分钟会以为卡死。
        改它要连实测一起重跑。"""
        assert "4~10 分钟" in S.labels_with_eta()["specfirst.bind"][1]


class Test事件自描述:
    """⚠ 这一组是「页面能不能跟着自由」的验收。"""

    def test_describe给全了展示所需的四样(self):
        d = S.describe("specfirst.assemble")
        for k in ("stage", "label", "group", "eta"):
            assert d.get(k), f"describe 缺 {k}"
        assert d["productStep"] == 6
        assert S.describe("specfirst.spec")["productStep"] == 2
        assert S.describe("specfirst.pages")["productStep"] == 3
        assert S.describe("specfirst.structure")["productStep"] == 4
        assert S.describe("specfirst.semantics")["productStep"] == 5

    def test_序号按本轮真实序列算不按账本位置(self):
        """⚠ 实测踩过：拿账本绝对位置当序号，新建轮出 order=8 of=7。
        账本含两个精修专用步，绝对位置对哪一轮都不准。"""
        new_run = [
            "specfirst.spec", "specfirst.design", "specfirst.pages",
            "specfirst.structure", "specfirst.semantics",
            "specfirst.assemble", "specfirst.bind",
        ]
        d = S.describe("specfirst.assemble", sequence=new_run)
        assert (d["order"], d["of"]) == (6, 7)

    def test_不给序列就不给of(self):
        """⚠ 宁可少给一个字段，也不给一对自相矛盾的数。"""
        d = S.describe("specfirst.assemble")
        assert "of" not in d

    def test_名单外的阶段返回空(self):
        """specfirst.shell 零 LLM、0.004 秒，故意不报——名单外不报是纪律。"""
        assert S.describe("specfirst.shell") == {}

    def test_reasoning_step事件真的带上了分组与序号(self):
        """⚠ 反向判据。账本有 ≠ 它进了事件（第三条）。
        把 stageGroup/stageOrder 从事件里删掉，这条会红。"""
        from services.v5_full_driver import _enrich_stage_event

        seq = ["specfirst.spec", "specfirst.assemble"]
        ev = _enrich_stage_event("start", "specfirst.assemble", {"sequence": seq})
        assert ev["label"] == HISTORICAL["specfirst.assemble"][0]
        assert ev["stageGroup"] == "收口"
        assert (ev["stageOrder"], ev["stageOf"]) == (2, 2)
        assert ev["productStep"] == 6
        spec_ev = _enrich_stage_event("start", "specfirst.spec", {"sequence": seq})
        assert spec_ev["productStep"] == 2

    def test_名单外的阶段仍然不发事件(self):
        from services.v5_full_driver import _enrich_stage_event

        assert _enrich_stage_event("start", "specfirst.shell", {}) is None


class Test前端不许再有翻译表:
    """⚠ 第四条：只做后端等于没做。表还在，后端加一步照样漏。"""

    def test_手抄的文案表已经删掉(self):
        src = (REPO / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
            encoding="utf-8"
        )
        # 剥注释——注释里提到它是**有意的**（记录为什么删），不算复活
        import re

        code = re.sub(r"//.*$", "", src, flags=re.M)
        code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
        assert "SPEC_FIRST_LLM_LABELS" not in code, (
            "前端那张手抄表又回来了。事件已经自带 stageLabel，不需要它。"
        )

    def test_前端确实在用事件里的人话(self):
        src = (REPO / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
            encoding="utf-8"
        )
        assert "stageLabel" in src, "前端没接事件里的人话，那删表就是把左栏搞坏了"

    def test_驱动器把stageLabel透传了(self):
        """⚠ 中间那一段也得通——SSE 解析层不透传，前端永远拿不到。"""
        src = (REPO / "client/src/lib/sliderule-marathon-driver.ts").read_text(
            encoding="utf-8"
        )
        assert "event.stageLabel" in src


class Test账本自洽:
    def test_每个阶段都有人话和分组(self):
        for sid in S.stage_ids():
            d = S.describe(sid)
            assert d["label"].strip(), f"{sid} 没有人话"
            assert d["group"].strip(), f"{sid} 没有分组"

    def test_顺序覆盖全部阶段(self):
        assert set(S.STAGE_ORDER) == set(S.labels())

    def test_分组保序去重(self):
        assert S.groups() == [
            "起草", "划范围", "画界面", "反推模型", "收口",
            "老链·建模", "老链·视觉",
        ]

    def test_账本带版本(self):
        raw = json.loads(
            (ROOT / "services" / "data" / "pipeline_stages.json").read_text(encoding="utf-8")
        )
        assert raw.get("version")
        assert S.STAGE_LEDGER_VERSION == raw["version"]


class Test这道闸咬得动:
    def test_describe对不存在的阶段真的返回空(self):
        assert S.describe("specfirst.definitely_not_a_stage") == {}

    def test_序列里混入未知阶段不会算错序号(self):
        d = S.describe("specfirst.spec", sequence=["ghost", "specfirst.spec"])
        assert (d["order"], d["of"]) == (1, 1), "未知阶段被算进了总数"
