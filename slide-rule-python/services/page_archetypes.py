"""页面范式 —— 装配的"户型图"。

## 为什么必须有这一层

2026-08-08 用户的判断（原话摘要）：「你现在 AI 做的其实不是装配应用页面，
而是把组件 Demo 拼到一张画布上……你已经建好了零件仓库，但是 AI 组装器目前
没有产品设计图纸。」

实测那张「库存管理」证据确凿：Menu 一张大卡、Input 一张卡、Button 一张卡、
Table 一张卡、Pagination 又单独一张卡，表格内容还是「甲/乙/12/34」。
**那是 Ant Design 组件示例合集换了个标题。**

根因不是模型不会排版，是装配目标错了。此前的链路是

    意图 → 需要哪些组件 → 排出来

模型收到的任务实际上变成了"从组件库选几个组件并排列"，它确实完成了。
正确的链路多两层：

    意图 → 页面范式 → 业务区域 → 区块 → 组件实例

**组件是最后一步，不是第二步。**

## 这个模块负责第二层

每种范式声明它的**区域**（region）：叫什么、干什么、是不是必须、视觉权重
多少、能放哪类区块。这不是写死页面——是给模型一套语法，就像写文章有
"标题/引言/正文/结尾"，不能每次从字开始随便排。

## 权重不是装饰

primary / secondary / supporting / overlay 直接决定布局引擎分多少空间。
没有它，模型会继续生成"五个组件 = 五个差不多大的卡片"——那张库存管理页
就是这么来的。

## 区域名的来历（2026-08-08 第二轮，重要）

**第一版这七个区域是我编的。** 我从常见后台页面倒推，写了 header / metrics /
filters / charts / main / aside / overlay，没有依据——404 页该有哪些区、结果页
该有哪些区、详情页的关键数字该摆哪儿，我当时并不知道。

用户指出去看 `ant-design/pro-blocks`：29 个真实页面，被无数项目抄过。扒完
之后，页面骨架的**官方答案**是 `PageContainer` 的槽（`pro-components/src/
layout/components/PageContainer`），29 页的使用统计如下：

    PageContainer / GridContent   全部 29 页
    extra          页头右上角操作     9 页
    content        页头下的描述块     6 页  ← 我们没有
    extraContent   页头右侧关键指标   4 页  ← 我们没有
    tabList        页面级页签         3 页  ← 我们没有
    FooterToolbar  底部固定操作条     2 页  ← 我们没有
    <Result>       结果/异常主体      7 页  ← 我们连范式都没有

**最要紧的一条修正**：我原来假设"关键数字 = 全宽一条指标带"（metrics 区）。
证据不支持。只有仪表盘类才用全宽带（DashboardAnalysis 的 IntroduceRow）；
列表页和详情页把那两三个最重要的数**放在页头右侧**（ProfileAdvanced 是
「状态：待审批」「订单金额：¥568.08」，DashboardWorkplace 是「项目数 56 /
团队内排名 8 / 项目访问 2223」）。这不是审美差异——页头里的数不占正文空间，
主区还是完整的一张表；做成全宽带就把主体挤下去一屏。

于是新增四个区域，每个都在下面标了它的出处。加不加一个区域，从此有依据可查。

## 还缺的：result 范式

29 页里有 7 页的主体是 `<Result>`（403 / 404 / 500 / 提交成功 / 提交失败 /
注册结果 / 分步表单的最后一步），是这个库里**最常见的一种页面形状**，我们一个
都没有。但它得先有区块才能建范式——按用户定的链路，先有基础组件（Result 已在
库里），再组装成区块（ResultPanel，尚缺），再进范式。所以这一轮先不加空范式：
`test_required_regions_are_reachable_with_the_blocks_we_actually_have` 会红，
而那条红得对——它挡的正是"语法里写着、却没有任何区块填得了"。
"""

from __future__ import annotations

from typing import Any, Dict, List

from services import schema_legal as L

#: 区域的视觉权重。布局按它分空间，Gate 按它查"有没有主次"。
WEIGHTS = ("primary", "secondary", "supporting", "overlay")

#: 每种范式的区域语法 —— **从共享目录 JSON 读**，不在这里写第二份。
#:
#: 2026-08-08 第三轮改的就是这一处。此前语法只有 Python 有，前端的
#: REGION_LAYOUT 是手抄的第二份；我上一轮加了条对账用例让"一边改了另一边没改"
#: 报错——那是创可贴，两份还是两份。而同一天拉到的那个真机 bug（点「清空」
#: 筛出空集）根子正是同一类：同一个概念在两处各写一份，取值迟早对不上。
#:
#: 现在两边同读 experience_block_catalog.json：Python 走 schema_legal，
#: 前端走 vite 的 @experience-blocks 别名。抄错这件事从此不可能发生。
#:
#: 区域目录（叫什么、摆哪条带、出处）在 pageRegions；范式语法（哪个区域、
#: 多重、必不必填、收哪类区块、最多几个）在 pageArchetypes。分开是因为前者
#: 是全局事实，后者按范式各有一套——列表页和结果页的区域本来就不该一样。
_R = L.PAGE_REGIONS


def _regions(archetype_key: str) -> List[Dict[str, Any]]:
    """把范式里的区域条目补上目录里的通用字段（label / band / evidence）。"""
    out: List[Dict[str, Any]] = []
    for r in L.PAGE_ARCHETYPES_RAW[archetype_key]["regions"]:
        meta = _R[r["key"]]
        out.append({**r, "label": meta["label"], "band": meta["band"],
                    "evidence": meta["evidence"]})
    return out


PAGE_ARCHETYPES: Dict[str, Dict[str, Any]] = {
    key: {**{k: v for k, v in arch.items() if k != "regions"},
          "regions": _regions(key)}
    for key, arch in L.PAGE_ARCHETYPES_RAW.items()
}

#: 区域 -> 它摆在页面哪条带上。前端排版直接吃这个，不再自己维护一份。
REGION_BANDS: Dict[str, str] = {k: v["band"] for k, v in _R.items()}


def archetype_prompt_block() -> str:
    """把范式语法压成给模型看的说明。

    措辞照 schema_legal 里那条反复验证过的纪律：**祈使 + 说清不照做的代价**。
    07-28 记过，写成许可式时七个通电区块一个都没被用。
    """
    lines = [
        "PAGE ARCHETYPES — pick ONE, then fill its regions. You are laying out a page, "
        "not choosing components. Components come later and are resolved by the blocks "
        "themselves; you never name one.",
        "",
        "A region marked required MUST get at least one block. A list page with no list "
        "is not a list page — it will be rejected and you will have wasted the turn.",
        "",
    ]
    for key, arch in PAGE_ARCHETYPES.items():
        lines.append(f"{key} — {arch['label']}: {arch['when']}")
        for r in arch["regions"]:
            req = "required" if r["required"] else "optional"
            lines.append(
                f"    {r['key']} ({r['label']}, {r['weight']}, {req}, "
                f"max {r['maxBlocks']}): {r['why']}"
            )
        lines.append("")
    lines.append(
        "WEIGHT decides how much room a region gets: primary is the thing the user came "
        "for and takes the main area; secondary supports it; supporting sits in the narrow "
        "column; overlay costs no page space at all because it only appears on click. "
        "Give every page exactly one clear primary — a page where everything is the same "
        "size is a pile of cards, not a page."
    )
    # 下面这三条是从 ant-design/pro-blocks 那 29 个真实页面里读出来的习惯，
    # 不写进提示词的话模型不会主动用新区域——它们都是 optional，而 optional
    # 在模型眼里约等于"可以不管"。第一次实测正是这样：detail 页只用了
    # header/main/aside，把「状态」「金额」这类数丢在了主区里。
    lines.append("")
    lines.append(
        "WHERE THE KEY NUMBERS GO — this is the rule people get wrong most often:\n"
        "  On a dashboard, the key numbers ARE the page: use the full-width metrics "
        "region.\n"
        "  On a list or detail page they are NOT the page — the list or the record is. "
        "Put the two or three most important numbers in headerExtra, beside the title, "
        "where they cost no vertical space. A detail page of an order shows 状态 and "
        "订单金额 up there; a task list shows 我的待办 / 平均处理时间 / 本周完成. "
        "Never open a list or detail page with a full-width band of metric cards — it "
        "pushes the thing the user actually came for below the fold."
    )
    lines.append(
        "headerContent holds the few fields that must be visible on arrival (who created "
        "it, when, related documents) or one sentence saying what this page is for. Use "
        "it on detail pages and on long forms — not on every page."
    )
    lines.append(
        "footerBar pins actions to the bottom of the viewport. Use it when the action "
        "belongs to something the user scrolls through: submitting a long form, or acting "
        "on rows selected in a long table. Putting a submit button at the end of a long "
        "form means the user must scroll to the bottom to find it."
    )
    return "\n".join(lines)
