"""`pageKinds` 声明的自洽性棘轮 —— 核实 ffaf964「那条规则本身还没核实」的结果。

## 核实结论：怀疑成立，这份声明现在**不能上闸**

ffaf964 把页型限制告诉了模型但**故意不上门禁**，理由是"这条约束本身经不起推敲"，
举了 AlertSilenceForm / AlertRuleEditor 同族同能力规则相反作为例子。本文件把那个
怀疑做成可复核的量化判据，结论是**成立的**：

### 一、这份数据没有集中评审

`pageKinds` 没有任何标注脚本（对比 `generality` 有 label_block_generality.py）。
追 git 历史，它是**随每个区块被添加时手写的**（da0be83、9389227 这类"补 XX 区块"
的提交各写各的）。没有中心化审校，也没有一致性检查——正是漂移的温床。

### 二、控制住领域之后，矛盾依然存在（核实时 25 对，A 档执行后 15 对）

只按 family+capability 分组会得出 67% 不一致，但那个数**不能当证据**：
`AlertRuleCommandHeader(monitor)` 与 `DocumentCommandHeader(workbench)` 页型不同是
合理的——告警监控页和文档管理页本来就是不同的页。

所以判据要**控制住领域**：按「名字首词（领域族）+ capability」分组，只数
**严格子集**关系——同域、同能力，一个明确比另一个少允许若干页型。这种情况没有
可辩护的理由。核实时 25 对，最刺眼的几对基本是近亲：

    Alert  form    AlertRuleEditor          dashboard,monitor
                   AlertSilenceForm         dashboard,monitor,workbench
    Alert  filter  AlertMatcherFilter       monitor
                   AlertRuleFilterBar       monitor,workbench
    Alert  action  AlertRuleCommandHeader   monitor
                   AlertGroupCommandHeader   monitor,workbench

而全目录 304/359 都允许 workbench。少数被卡住的更像随手标窄。

**这三对已经在 A 档里放宽掉了**（见下面的"后续"），留在基线里的 15 对都涉及
calendar / kanban / wizard / monitor 这些形状专属或有独立通道纪律的页型。

### 后续：A 档已执行（25 → 15）

docs/page-kinds-widening-proposal.md 里 A 档的 8 个区块已经改了 `pageKinds`，
只沿 workbench / dashboard 两个通用工作面放宽，没伸进 calendar/kanban/wizard。
提案里第 9 条（`HeaderEntitySummary` +dashboard）评审时被否掉——顺带发现它对矛盾
对数**本来就没影响**：加了 dashboard 之后它仍然是 `HeaderProgressSummary` 的严格
子集（缺 monitor），所以否与不否都是 15 对。

### 三、门禁的 `_finding` 没有分级

加进去就是硬拒。拿一条有证据认为标错的规则去拒模型，是把"违规发出去"换成
"合规的也发不出去"。所以 ffaf964 的判断是对的。

## 顺带修正 ffaf964 的一处附带说法

那条提交说页型摆错"不影响渲染"。**对渲染这一半成立**——live-runtime 下没有任何
渲染器读 pageKinds。但"没有任何一处读它"是不准的：
`client/src/pages/sliderule/ComponentsLibraryPage.tsx` 用它做组件库的页型筛选与
计数（3977、4132 行）。所以改这份数据会影响组件库的筛选结果，只是不影响生成的
应用怎么渲染。

## 这个文件守什么

不擅自改目录数据（那 25 对该放宽还是该收紧是产品判断），只上一道**棘轮**：
矛盾对数**只准变少**。

## 上闸还差什么（2026-08-11 修正：原来那条解锁条件不成立）

这个文件原先写的是"矛盾降到 0 就可以上门禁"。**那个条件是不充分的**，量出来
之后才看清：

    加了区域维度之后，全目录 358 个通电区块里，有至少一个"可比对象"
    （同域 + 同能力 + 区域相交）的只有 41 个。另外 317 个压根没有对照。

也就是说这条判据只覆盖 **11%** 的目录。把这 11% 里的矛盾清成 0，对剩下 89%
的声明对不对**一个字都没说**——那些区块只有一份手写的 pageKinds，没有任何
第二来源可以对照。拿这样一份声明去硬拒模型，仍然是把"违规发出去"换成
"合规的也发不出去"。

所以解锁条件换成：**pageKinds 得有一份能重算的推导依据**，而不是逐个手写。
仓库里已有先例——`generality` 有 `scripts/label_block_generality.py`，
`pageKinds` 从来没有（这正是本文件开头那段"随每个区块被添加时手写"说的事）。
在那之前，这里守两个数：生判据的总数只准变少，精判据里**没写理由**的必须是 0。

## 那份推导依据已经补上了，而它给出的答案是「不该上闸」

`scripts/label_block_page_kinds.py` + `tests/test_page_kind_derivation.py`
（2026-08-11）。写那个脚本时把运行时逐处 `page.view.kind` 分支查了一遍，结论：

    workbench / wizard / kanban / calendar 四种页型，从"区块能不能在这儿干活"
    的角度看是**可以互换的**——四者都有逐行视图、都走同一条 businessPageGrid、
    吃同一张区域表（regionsToGrid 的几何按 band 走，跟页型无关，只有
    kanban/calendar 把右栏从 4/12 收到 3/12）。

页型对区块准入的技术影响全部集中在"有没有逐行视图"这一件事上，也就是那 4 条
硬判据；而它们运行时早就兜死了。**门禁硬拒的前提是"违反了就一定错"，这个字段
四分之三的格子达不到这个标准**，所以下面那条路标是长期有效的，不是临时状态。

余下的判断（"这一页该不该推荐这个区块"）影响的是选材侧：提示词给模型的清单、
组件库的页型筛选。标错了页面不会坏，只是推荐得不好——那一层由脚本出初稿、
人过一遍（`--dry-run`），不进 CI。
"""

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.schema_legal import EXPERIENCE_BLOCKS, PAGE_KINDS

#: 生判据（不看区域）的基线。**只准变小。**
#:
#: 25 → 15：docs/page-kinds-widening-proposal.md 的 A 档已执行（8 个区块只加
#: workbench / dashboard 这两个通用工作面）。
#: 15 → 9：B 档里 monitor 那 6 个已定调，但**不是一起放宽**——4 个 action 加
#: monitor（同域近亲已允许、运行时真渲染），2 个 filter 反而收窄了它们更宽的
#: 兄弟（SavedViewTabs / UserEventFilter 撤掉 monitor），因为 filterChange 在
#: 总览页够不到任何东西。详见 docs/page-kinds-widening-proposal.md「B 档 monitor
#: 那 6 个的定调」。
#:
#: 这个数**留着不动**，作用是防止判据加了新维度之后悄悄失去约束力：下面那条
#: 更精确的判据是它的子集，两个数一起看才知道是真变好了还是判据变松了。
#: 2026-08-11 去重后 9 → 8。这一格**不是靠改 pageKinds 改出来的**——是砍掉 57 个
#: 「同工厂、参数只有 testid + 中文标题」的凑数类型时顺带掉的：矛盾对里有一对
#: 本来就是同一份实现挂着两个名字，一个允许 workbench 一个不允许。
#: 也就是说这批矛盾里至少有一部分根子不在「页型标错」，而在「这个类型压根不该存在」。
#: 2026-08-11 第二刀：8 → 7。同一个理由——又一对矛盾的两边本来就是同一份实现。
_CONTRADICTION_BASELINE = 7

#: 精判据（区域相交才算可比）下**没有写明理由**的矛盾对数。目标是 0，已经是 0。
#:
#: 生判据的 9 对里有 6 对是**假阳性**：窄的那个是页头说明（headerContent）、
#: 浮层抽屉（overlay）或底部操作条（footerBar），宽的那个是主列面板
#: （main/aside/supplement）——两者永远不会占同一个槽位，只是碰巧 capability
#: 相同。这种"窄"有可辩护的理由：宽的那个之所以宽，往往正因为它能当某种页型的
#: **主视图内容**（BookingSlotPicker 是预约向导那一步的主体、ConnectionMappingPanel
#: 是 Airbyte 连接设置向导里的映射步骤），而页头说明当不了主视图。
#:
#: 剩下 3 对区域真相交，逐对写了理由记在 _JUSTIFIED_PAIRS 里。要上门禁先让这个
#: 数是 0 —— 但**这不是充分条件**，见文件头「上闸还差什么」。
_UNJUSTIFIED_BASELINE = 0

#: 区域真相交、但"窄"有可辩护理由的对。**每条都必须写清理由**，不许只填名字。
#:
#: 这是把"基线数字"换成"逐条理由"：数字降到 0 只说明没有新漂移冒出来，而每一条
#: 例外为什么成立，得有人能读到。新增一条就是一次评审。
_JUSTIFIED_PAIRS: dict[tuple[str, str], str] = {
    ("ConnectionTimeline", "ConnectionMappingPanel"): (
        "MappingPanel 宽在 wizard，因为它能当**连接设置向导那一步的主体内容**"
        "（Airbyte 的 SyncCatalogTable 就是设置流程里的一步）；ConnectionTimeline "
        "是历史事件流，不是设置步骤。宽的那个宽得有理由，不是窄的那个标错了。"
    ),
    ("HeaderEntitySummary", "HeaderProgressSummary"): (
        "两者同区域（headerContent）、同能力，是真同形的一对，但 ProgressSummary "
        "宽在 dashboard/monitor 是**聚合语义**——总览页说“整体进度到哪了”成立；"
        "EntitySummary 说的是某一条记录的关键字段，而总览页不围绕单条记录，"
        "摆上去只能显示“第一行”的字段，是任意的。2026-08-11 评审已单独否掉给它"
        "加 dashboard 的提议。"
    ),
    ("RecordComparePanel", "RecordPicker"): (
        "只在 supplement 一个槽位相交。RecordPicker 宽在 wizard/monitor 是因为"
        "“挑一条记录”是向导里的标准一步、也是总览页跳转的常见入口；对比面板是"
        "复核工具，不是流程步骤。若产品要放宽，wizard 那一半有先例"
        "（MergePreviewPanel / RecordChangePreview 同是对比形状且允许 wizard），"
        "monitor 那一半没有。"
    ),
}


def _domain_of(block_type: str) -> str:
    m = re.match(r"^([A-Z][a-z]+)", block_type)
    return m.group(1) if m else "?"


def _strict_subset_pairs(*, region_aware: bool = False, blocks=None):
    """同【领域族 + capability】内，页型声明成严格子集关系的对。

    严格子集 = 同域、同能力，一个明确比另一个少允许若干页型。

    region_aware=True 时**再加一维**：两个区块的 allowedRegions 必须相交才算
    可比。理由见 _UNJUSTIFIED_BASELINE 的说明——不相交意味着它们永远不会占
    同一个槽位，是不同家具，只是碰巧 capability 相同。

    加这一维是**收紧精度、放宽计数**，所以两个数都留着：生判据那个数防止这条
    精判据把真漂移一起放过去。
    """
    groups = collections.defaultdict(list)
    for b in EXPERIENCE_BLOCKS if blocks is None else blocks:
        if not b.get("generationEnabled"):
            continue
        t = str(b["type"])
        key = (_domain_of(t), str(b.get("capability") or b.get("group")))
        groups[key].append((
            t,
            frozenset(b.get("pageKinds") or []),
            frozenset(b.get("allowedRegions") or []),
        ))

    out = []
    for (dom, cap), members in groups.items():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b2 = members[i], members[j]
                if region_aware and not (a[2] & b2[2]):
                    continue
                if a[1] < b2[1] or b2[1] < a[1]:
                    lo, hi = (a, b2) if a[1] < b2[1] else (b2, a)
                    out.append((dom, cap, lo[0], sorted(lo[1]), hi[0], sorted(hi[1])))
    return sorted(out)


def test_页型声明的自洽性只准变好():
    pairs = _strict_subset_pairs()
    detail = "\n".join(
        f"    {d} · {c}: {lo}({','.join(lok)})  ⊂  {hi}({','.join(hik)})"
        for d, c, lo, lok, hi, hik in pairs[:12]
    )
    assert len(pairs) <= _CONTRADICTION_BASELINE, (
        f"同域同能力的页型声明矛盾从 {_CONTRADICTION_BASELINE} 涨到 {len(pairs)}。\n"
        f"新增的矛盾意味着又有人随手标窄了某个区块的 pageKinds：\n{detail}"
    )
    if len(pairs) < _CONTRADICTION_BASELINE:
        # 变好了就要求把基线跟着降——否则棘轮会慢慢失去约束力
        raise AssertionError(
            f"矛盾对数已降到 {len(pairs)}（基线 {_CONTRADICTION_BASELINE}）。"
            f"请把 _CONTRADICTION_BASELINE 改成 {len(pairs)} 锁住这次改善。"
        )


def test_区域相交的矛盾必须逐条写明理由():
    """精判据：只数**会占同一个槽位**的对，剩下的每一条都得有写下来的理由。

    这条替代了原来那句"降到 0 才上闸"。数字降到 0 只说明没有新漂移，而"为什么
    这一条例外成立"必须能被读到——所以例外记在 _JUSTIFIED_PAIRS 里，附理由。
    """
    pairs = _strict_subset_pairs(region_aware=True)
    unjustified = [
        (d, c, lo, lok, hi, hik)
        for d, c, lo, lok, hi, hik in pairs
        if (lo, hi) not in _JUSTIFIED_PAIRS
    ]
    detail = "\n".join(
        f"    {d} · {c}: {lo}({','.join(lok)})  ⊂  {hi}({','.join(hik)})"
        for d, c, lo, lok, hi, hik in unjustified[:12]
    )
    assert len(unjustified) <= _UNJUSTIFIED_BASELINE, (
        f"出现了 {len(unjustified)} 对**区域相交、又没写理由**的页型矛盾：\n{detail}\n"
        "两条路：放宽窄的那个（同域同能力同槽位，找不出理由就是标错了），"
        "或者把理由写进 _JUSTIFIED_PAIRS。不许只改数字。"
    )

    # 反向：例外表不许留着已经不成立的条目，否则它会慢慢变成一张免死名单
    live = {(lo, hi) for _, _, lo, _, hi, _ in pairs}
    stale = sorted(k for k in _JUSTIFIED_PAIRS if k not in live)
    assert not stale, (
        f"_JUSTIFIED_PAIRS 里这些对已经不矛盾了，请删掉条目：{stale}"
    )

    # 每条理由都得真的是理由，不许填占位
    for key, why in _JUSTIFIED_PAIRS.items():
        assert len(why.strip()) >= 40, f"{key} 的理由太短，写清为什么宽的那个宽得有理"


def test_精判据没有把真漂移一起放过去():
    """加区域维度是**放宽计数**，所以要证明它没把检测能力一起放掉。

    做法：合成一个必然是漂移的区块（同域、同能力、**同区域**，页型少一个），
    精判据必须照样抓到它。
    """
    victim = next(
        b for b in EXPERIENCE_BLOCKS
        if b.get("generationEnabled") and len(b.get("pageKinds") or []) >= 2
    )
    planted = dict(victim)
    planted["type"] = str(victim["type"]) + "Drifted"
    planted["pageKinds"] = list(victim["pageKinds"])[:1]

    caught = [
        (lo, hi)
        for _, _, lo, _, hi, _ in _strict_subset_pairs(
            region_aware=True, blocks=[*EXPERIENCE_BLOCKS, planted]
        )
        if planted["type"] in (lo, hi)
    ]
    assert caught, (
        f"埋进去的漂移区块 {planted['type']}（同域同能力同区域、页型更窄）"
        "没被精判据抓到——判据已经失效了"
    )


def test_每个通电区块都声明了页型且都合法():
    """这一条与自洽性无关，是基本卫生：声明本身不能缺、不能写目录外的页型。"""
    legal = set(PAGE_KINDS)
    for b in EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        kinds = b.get("pageKinds") or []
        assert kinds, f"{b['type']} 没有声明 pageKinds"
        bad = [k for k in kinds if k not in legal]
        assert not bad, f"{b['type']} 声明了目录外的页型: {bad}"


def test_门禁仍然不拦页型越界():
    """路标：这份声明还不配硬拒，所以结构闸不该拦页型越界。

    ffaf964 已经有一条同向的测试；这里再钉一次，并写清解锁条件。

    **解锁条件已在 2026-08-11 修正**（原来写的是"基线降到 0"，那不充分）：
    要上闸，先给 pageKinds 一份能重算的推导依据——判据现在只覆盖 41/358 个
    区块，剩下 317 个的声明没有任何第二来源可以对照。详见文件头
    「上闸还差什么」。
    """
    from services.v5_model_gate import validate_five_system_model

    # 前置断言：先证明这份样例真的越界。放宽 pageKinds 时很容易让它变成合法摆放，
    # 那样下面那条断言就永远成立，路标静默失效。
    declared = {
        str(b["type"]): list(b.get("pageKinds") or []) for b in EXPERIENCE_BLOCKS
    }
    assert "workbench" not in declared["WizardNavigationBar"], (
        "WizardNavigationBar 现在允许 workbench 了，这份样例不再越界。"
        "请换一个仍然不允许 workbench 的区块，否则这条路标就是空断言。"
    )

    # WizardNavigationBar 只允许 wizard，这里故意摆进 workbench 页。
    #
    # ## 这个样例换过两次，第三次挑的判据不一样
    #
    #   ① AlertRoutingPolicy —— A 档放宽后它允许了 workbench；
    #   ② MuteTimingSchedule —— 2026-08-11 也放宽了（181 份真实生成里它在
    #      workbench 页被用了 47 次，而目录不允许，是目录标错）。
    #
    # 两次都是"暂时还不允许 workbench"的块，于是两次都随着数据变好而失效。所以
    # 这次改挑**语义上不可能属于工作台**的：向导导航条是驱动分步流程的下一步/
    # 提交按钮，脱离 wizard 页它没有可导航的步骤。真实生成 181 份里它在
    # workbench 页出现 0 次。
    #
    # 上面那条前置断言是防静默失效的：真要哪天它也放宽了，这条会直接说"换一个"，
    # 而不是让整条路标变成永远为真的空断言。
    model = {
        "datamodel": {"entities": [{"id": "alert", "name": "告警", "fields": [
            {"id": "title", "name": "标题", "type": "string"},
            {"id": "summary", "name": "摘要", "type": "string"}]}]},
        "rbac": {"roles": [{"id": "ops", "name": "运维"}], "permissions": [], "menus": []},
        "workflow": {"id": "wf", "name": "流程", "nodes": [], "transitions": [], "chains": []},
        "page": {"pages": [{
            "id": "p1", "name": "路由策略管理", "kind": "workbench",
            "blocks": [{"id": "b1", "type": "WizardNavigationBar",
                        "binding": {"entityRef": "alert"}}],
        }]},
        "aigc": {"capabilities": [{"id": "cap", "name": "摘要",
                                   "inputFields": ["alert.title"],
                                   "outputField": "alert.summary",
                                   "roleRefs": ["ops"]}]},
        "appbundle": {"landingPageRef": "p1"},
    }
    findings = validate_five_system_model(model).get("findings") or []
    page_kind_findings = [
        f for f in findings
        if "pageKind" in str(f.get("path") or "") or "page kind" in str(f.get("message") or "").lower()
    ]
    assert page_kind_findings == [], (
        "结构闸开始拦页型越界了，但那份声明还有 "
        f"{len(_strict_subset_pairs())} 对自相矛盾，而且判据只够得着 41/358 个"
        "区块——先给 pageKinds 一份能重算的推导依据，见文件头「上闸还差什么」"
    )
