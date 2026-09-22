# -*- coding: utf-8 -*-
"""页型约束：先告知模型，先观测不拦（2026-08-11）。

## 缺口是什么

目录里每个区块都声明了 `pageKinds`（这种区块适合放在哪几种页上）。这份声明
在 2026-08-11 之前**只被选材侧读**（block_assembler 挑候选、block_narrowing
派生预设、pageKindPresets 自检），生成路径上没有任何一处用它：

    提示词   每个区块的条目里只有 data= / regions= / events= / binding=，页型一个字没提
    结构闸   v5_model_gate 里没有任何一处读 pageKinds

第一份线上真骨架收割时照出来：告警值班那趟 15 个区块有 2 个越界
（AlertRoutingPolicy、MuteTimingSchedule 都只允许 monitor/dashboard，被摆进了
workbench 页）。**不是模型马虎，是我们没说。**

这是 lowcode-engine `nestingRule.parentWhitelist` 那一半，只是父级是"页"不是
"容器"（它的类型定义注释举的例子正是这个形状：「FormField 只能在 Form 容器下，
Column 只能在 Table 下」）。区域那一半这个仓库 2026-08-08 已经补过
（page_assembler「双向约束的另一半」），页型这一半漏到了现在。

## 为什么这一轮只告知、不上闸

因为这条约束本身经不起推敲：

    AlertSilenceForm    capability=form        pages=monitor,dashboard,workbench
    AlertRuleEditor     capability=form        pages=monitor,dashboard      ← 同族同能力，规则相反
    AlertRoutingPolicy  capability=entityRows  pages=monitor,dashboard

而「路由策略管理页」天然就是个工作台。全目录 304/358 都允许 workbench。
拿一条可能标错的规则去硬拒模型，是把"违规发出去"换成"合规的也发不出去"。

所以这批用例守的是**这个阶段性状态本身**：提示词必须说，修复器必须记，
而模型**必须不被改动**。等攒够真实数据再决定是收紧模型还是放宽目录——
那一步会把这里的 `不改模型` 断言换掉，换的时候得有人回来读这段。

## 后续（2026-08-11 当天）：上面那个怀疑被核实了，并且已经放宽了一批

`test_page_kind_consistency_ratchet.py` 把"这条约束经不起推敲"做成了量化判据：
控制住领域族之后有 **25 对**同域同能力的严格子集矛盾，且 `pageKinds` 从来没有
集中评审（随每个区块被添加时手写）。随后按
`docs/page-kinds-widening-proposal.md` 的 A 档放宽了 8 个区块（只沿 workbench /
dashboard 这两个通用工作面），矛盾降到 **15 对**，允许 workbench 的从 304 →
**309 / 359**。

对本文件的直接影响：**上面举的反例已经不成立了**——`AlertRuleEditor` 和
`AlertRoutingPolicy` 现在都允许 workbench。留着那段文字是因为它记录的是当时的
判断依据；要看现在还剩哪 15 对，读棘轮那个文件。

更要紧的是：那一趟实测的两处越界里，**`AlertRoutingPolicy` 那处已经不算越界了**
——结论正是"不是模型摆错，是目录把路由策略管理页这种天然工作台排除在外"。
所以下面 `test_钉住那趟实测的两处越界` 改成了钉住"一处仍越界 + 一处已放宽"。

而"只告知不上闸"这个阶段性状态**没变**：还剩 15 对矛盾，清零之前不上闸。
"""

import json

import pytest

from services.schema_legal import (
    EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE,
    EXPERIENCE_BLOCKS,
    experience_block_prompt_block,
)
from services.v5_model_repair import repair_five_system_model


@pytest.fixture(scope="module")
def prompt() -> str:
    return experience_block_prompt_block()


class Test提示词必须告知页型:
    def test_每个区块条目都带pages(self, prompt):
        enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
        missing = [
            str(b["type"])
            for b in enabled
            if f"- {b['type']}: " in prompt
            and f"pages={','.join(b['pageKinds'])}" not in prompt
        ]
        assert not missing, f"这些区块的条目没写页型：{missing[:5]}"

    def test_那两个真实越界的区块_页型写在条目里(self, prompt):
        """钉住实测那两条——它们正是因为没被告知才摆错的。"""
        for btype in ("AlertRoutingPolicy", "MuteTimingSchedule"):
            allowed = ",".join(EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE[btype])
            assert f"pages={allowed}" in prompt, btype

    def test_有一句规则句而不只是一个字段(self, prompt):
        """区域限制当初也有条目字段，照样反复被违反，直到补上点名反例的规则句
        才收住。所以这里也要有一句，且必须举反例。"""
        assert "PAGE KINDS" in prompt
        assert "MuteTimingSchedule" in prompt and "is a violation" in prompt

    def test_规则句说清了该改页型而不是硬塞区块(self, prompt):
        """不给出路的禁令会被绕过：模型要么硬塞，要么干脆不用那个区块。"""
        assert "change the PAGE's kind" in prompt


def _model_with(page_kind: str, block_type: str) -> dict:
    return {
        "page": {
            "pages": [
                {
                    "id": "p1",
                    "kind": page_kind,
                    "name": "某一页",
                    "blocks": [{"id": "b1", "type": block_type}],
                }
            ]
        }
    }


@pytest.fixture
def offender():
    """目录里现查一个「不允许 workbench」的区块 —— 不写死名字（目录天天在动）。"""
    for btype, kinds in EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE.items():
        if "workbench" not in kinds and kinds:
            return btype
    pytest.skip("目录里已经没有排除 workbench 的区块了")


class Test修复器只观测不改:
    def test_越界会被记下来(self, offender):
        out = repair_five_system_model(_model_with("workbench", offender))
        notes = out["pageKindViolations"]
        assert len(notes) == 1, notes
        assert notes[0]["blockType"] == offender
        assert notes[0]["pageKind"] == "workbench"
        assert notes[0]["pageId"] == "p1"

    def test_模型一个字都不许改(self, offender):
        """**本文件最要紧的一条。**

        页型摆错不影响渲染，所以修复器不该擅自动手——它跟
        `_repair_layout_slot_violations` 不同，那条改模型是因为槽位摆错会把页面
        真搞坏（PageHeader 钉在底部操作条上是实测过的）。

        将来若决定收紧，改的是这条断言，而不是悄悄让修复器开始删区块。
        """
        model = _model_with("workbench", offender)
        before = json.dumps(model, ensure_ascii=False, sort_keys=True)
        out = repair_five_system_model(model)
        assert json.dumps(out["model"], ensure_ascii=False, sort_keys=True) == before

    def test_合法摆放不留痕(self):
        legal = next(
            b for b in EXPERIENCE_BLOCKS
            if b.get("generationEnabled") and "workbench" in (b.get("pageKinds") or [])
        )
        out = repair_five_system_model(_model_with("workbench", str(legal["type"])))
        assert out["pageKindViolations"] == []

    def test_越界不会让门禁挂掉(self, offender):
        """这一轮的判据：越界**不影响过闸**。改这条之前先读文件头。"""
        from services.v5_model_gate import validate_five_system_model

        model = _model_with("workbench", offender)
        gate = validate_five_system_model(model)
        paths = " ".join(f.get("path", "") for f in gate.get("findings") or [])
        assert "pageKind" not in paths and "page kind" not in paths.lower(), (
            "门禁开始拦页型了——如果这是有意的，请连同本文件头注一起更新"
        )

    def test_认不出的类型与缺字段都不炸(self):
        for model in (
            _model_with("workbench", "并不存在的区块"),
            {"page": {"pages": [{"id": "p", "kind": "workbench"}]}},
            {"page": {"pages": [{"id": "p", "blocks": [{"id": "b", "type": "DataTable"}]}]}},
            {},
        ):
            assert repair_five_system_model(model)["pageKindViolations"] == []


class Test真实数据:
    #: 那一趟实测的两处"越界"。**两处最终都被判定为目录标错，不是模型摆错。**
    _实测越界的两个区块 = ("AlertRoutingPolicy", "MuteTimingSchedule")

    def test_那趟实测的两处越界最终都是目录标错(self):
        """整条线的收口：第一份线上收割里那 2/15 处"越界"，**一处都不是模型的错**。

        ## 两处各自的平反依据

        `AlertRoutingPolicy`（A 档，2026-08-11）
            同域同能力的近亲 `AlertTriagePanel` 早就允许 workbench，而"路由策略
            管理页"天然是个工作台。放宽后它不再被记一笔。

        `MuteTimingSchedule`（同日，跑真实话题时收的）
            181 份真实生成模型里它在 workbench 页被摆了 **47 次**（calendar 2、
            dashboard 2），最主要的用法恰恰是目录不允许的那个；同能力同槽位的
            `AlertTriagePanel` / `AlertRoutingPolicy` 都已允许；当天一趟全新生成
            又把它摆进 workbench，且三趟"对题件被选频次"都是 3/3——模型每次都要
            用它。

        所以这条用例从"钉住还剩几处越界"改成**钉住结论本身**：这两个都得是合法
        摆放。原来那个形态（数还剩几处）已经走到尽头——它在 2026-08-11 一天里
        因为数据变好红了两次，而每次要改的都不是判据，是那个"还剩几处"的期望值。

        判据仍然从目录现查，不写死名字：哪天有人把它们改窄回去，这条会红，
        并且报出是哪一个。
        """
        legal_pages = {
            t: EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE[t] for t in self._实测越界的两个区块
        }
        regressed = [t for t, ks in legal_pages.items() if "workbench" not in ks]
        assert not regressed, (
            f"{regressed} 又不允许 workbench 了。这两处越界当初查清了是目录标错"
            f"（AlertRoutingPolicy 有近亲对照，MuteTimingSchedule 有 47 次真实用例），"
            "改窄回去等于把那次判定推翻了——如果确实要推翻，请连同本用例的说明一起改。"
        )

        # 正向：这两个摆进 workbench 页，修复器**不该**再记任何一笔
        model = {
            "page": {
                "pages": [
                    {"id": "routing_policies", "kind": "workbench",
                     "blocks": [{"id": "b1", "type": "AlertRoutingPolicy"}]},
                    {"id": "mute_schedules", "kind": "workbench",
                     "blocks": [{"id": "b2", "type": "MuteTimingSchedule"}]},
                    {"id": "oncall", "kind": "calendar",
                     "blocks": [{"id": "b3", "type": "OnCallScheduleCalendar"}]},
                ]
            }
        }
        notes = repair_five_system_model(model)["pageKindViolations"]
        assert notes == [], (
            f"这三处现在都该是合法摆放，却仍被记了 {len(notes)} 笔：{notes}"
        )

        # 反向哨兵：换一个**语义上不可能属于工作台**的块，必须照旧被记一笔
        # ——否则上面那个 `notes == []` 可能是因为整条观测坏了，而不是因为合法。
        assert "workbench" not in EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE["WizardNavigationBar"]
        sentinel = {
            "page": {"pages": [{
                "id": "p", "kind": "workbench",
                "blocks": [{"id": "b", "type": "WizardNavigationBar"}],
            }]}
        }
        sentinel_notes = repair_five_system_model(sentinel)["pageKindViolations"]
        assert [n["blockType"] for n in sentinel_notes] == ["WizardNavigationBar"], (
            f"哨兵没被记一笔（{sentinel_notes}）——说明越界观测本身坏了，"
            "上面那条『都合法』的断言因此不可信"
        )
