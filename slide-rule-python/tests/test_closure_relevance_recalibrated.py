# -*- coding: utf-8 -*-
"""相关性闸 2026-09-05 重标定的判据。

## 起因

原标定集是**手写的** 3 个应用 + 交叉错配，阈值 0.5、单项取"跟某一个名字的最大
相似度"。拿真库里 152 个真会话重跑（自己的题 × 自己的模型 = 正例，交叉错配
= 负例，题目近似的对子剔除），成绩是：

    正例过闸 36.6%（全集）/ 40.0%（有 SPEC 的会话）

**十个做对了的应用，六个被判成「产出与题目不符」。** 手写标定集看不出来，
因为它的正例名字是照着目标里的词写的（"就餐老人"对"登记就餐老人"），
而真机上模型用行业自然叫法：

    题「经典单机大鱼吃小鱼闯关游戏」  模型「海域关卡」「海洋生物图鉴」  → 0.000
    题「流浪猫智能救助（匹配识别）」  模型「救助档案」「AI匹配」        → 0.000

三处改动、为什么选 0.30、以及逐条锚点复核，全在
`services/closure_relevance.py` 模块头「2026-09-05 重标定」那一节。
这份判据钉住的是那节里的结论**在代码上真的成立**。

## 判据形状

- 锚点用真数据：2026-08-04 那次真实事故、手写标定集的 3 正例 6 错配，
  一条都不许因为放宽而漏放（§3 正反配对）。
- 真机那一发（社区养老 sr-20260904181150）的原样载荷，钉住三处改动各自的贡献。
- 套模板那一路必须**逐位不变**——它跟闭环判定的代价函数相反，没重标定过。
"""

import pytest

from services.closure_relevance import (
    CLOSURE_COVERAGE_THRESHOLD,
    TERM_HIT_THRESHOLD,
    containment,
    COVERAGE_THRESHOLD,
    collect_spec_terms,
    evaluate_model_relevance,
    goal_coverage,
    split_goal_phrases,
)
from services.app_template import match_app_template

# ── 2026-08-04 真实事故：目标是课后托管，产出是内置请假样板 ──
TUOGUAN_GOAL = (
    "给中小学课后托管做一套管理系统：登记学生和托管班次、老师排班考勤、"
    "每日签到签退、家长请假申请、按月生成托管费账单"
)
LEAVE_TERMS = [
    "员工", "假期余额", "请假单", "审批记录",
    "我的请假单", "主管审批看板", "团队请假日历", "HR假勤概览",
]

# ── 真机 sr-20260904181150（社区养老）那一发的原样载荷 ──
YANGLAO_GOAL = (
    "构建覆盖社区居家养老全场景的服务闭环：1) 老人全景档案（基础信息、慢病标签、"
    "饮食忌口、照护等级与补贴资质）；2) 助餐订配送闭环（餐次预订、网格化配送路径推荐、"
    "调度调整、送达签收）；3) 上门照护排班（照护员技能矩阵、合规工时池、排班冲突硬拦截、"
    "LBS定位签到、打卡服务记录）；4) 资金结算引擎；5) 质量监督（家属端小程序评价打分、"
    "低分差评触发自动工单回访、中心质控）"
)
#: 那一发模型里真实的六系统显示名（菜单标签/实体/工作流节点/角色，被压得很短）
YANGLAO_MODEL_TERMS = [
    "长者档案", "照护等级", "慢病标签", "所属网格", "社区照护员", "资质标签库",
    "服务工单", "服务总费用", "政府补贴核销总额", "个人账户扣费总额",
    "待回访差评工单", "家属留言", "任务作业", "上门照护排班",
    "费用结算与补贴流水", "服务质控", "调度质控主管", "老人家属",
    "服务预订待排班", "已指派待履约", "现场打卡履约中", "结算完成待评价",
    "差评质控回访中", "工单归档结案", "照护等级智能推荐",
]
#: 同一发的 SPEC 节点标题——「打算干什么」写在这儿，判定侧原先看不见
YANGLAO_SPEC = {"nodes": [
    {"id": "n0", "title": "社区居家养老闭环服务作业与结算管理"},
    {"id": "n1", "title": "助餐网格配送与现场LBS签收闭环"},
    {"id": "n2", "title": "上门照护智能排班与合规冲突拦截"},
    {"id": "n3", "title": "补贴与长护险自费混合抵扣结算引擎"},
    {"id": "n4", "title": "家属评价监督与差评自动转工单质控"},
    {"id": "nD1", "title": "助餐路线推荐与LBS签收设计"},
    {"id": "nD2", "title": "技能矩阵与合规工时校验设计"},
    {"id": "nD3", "title": "混合抵扣结算算法与账单生成设计"},
    {"id": "nD4", "title": "差评捕获与质控工单派发设计"},
    {"id": "nT1", "title": "测试助餐现场超距签收拦截"},
    {"id": "nE1", "title": "居家养老核心场景规划依据"},
]}

REAL_APPS = [
    (
        "给社区老年食堂做一套系统：登记就餐老人和补贴资格、排每日菜单、"
        "刷卡就餐记录、每月补贴结算、家属查看用餐情况",
        ["就餐老人", "家属", "补贴资格", "每日菜单", "就餐卡", "刷卡就餐记录", "月度补贴结算",
         "食堂运营总览", "刷卡就餐管理", "每日菜单排期", "补贴资格办理", "家属用餐查询"],
    ),
    (
        "给社区消防安全巡检做一套系统：登记楼栋和消防设施、排巡检班次、"
        "记录每次巡检结果和隐患等级、隐患整改闭环",
        ["楼栋", "消防设施", "巡检班次", "消防巡检", "消防隐患", "隐患整改记录",
         "消防安全总览", "楼栋设施台账", "巡检班次排期", "巡检记录", "隐患整改看板"],
    ),
    (
        "给社区图书馆做一套绘本借阅管理系统，登记绘本、办理借还、逾期提醒、"
        "按借阅次数排热门榜、看最近借还动态",
        ["绘本", "读者", "借阅记录", "逾期提醒", "借还动态",
         "借阅运营总览", "绘本登记与编目", "读者登记", "借还办理", "到期与逾期日历"],
    ),
]


def _closure(goal, terms):
    return goal_coverage(goal, terms, mode="hybrid", threshold=CLOSURE_COVERAGE_THRESHOLD)


class Test放宽了但没放水:
    """★ 整件事最要紧的一条：召回上去了，漏放不许上去。

    漏放 = 2026-08-04 那次「交出一套请假系统还判 closed」。误杀只是浪费时间，
    漏放是把错的东西当成对的交出去——两者代价不对等，所以这一组排在最前面。
    """

    def test_事故锚点_课后托管配请假模型_照样拦下(self):
        v = _closure(TUOGUAN_GOAL, LEAVE_TERMS)
        assert v["applicable"] is True
        assert v["passed"] is False, (
            f"重标定把 2026-08-04 那次事故放过去了（score={v['score']}）"
        )

    def test_事故锚点余量够(self):
        """0.143 对 0.35 的阈值，余量 0.21——不是"刚好还拦得住"。"""
        assert _closure(TUOGUAN_GOAL, LEAVE_TERMS)["score"] <= CLOSURE_COVERAGE_THRESHOLD - 0.2

    @pytest.mark.parametrize("goal,terms", REAL_APPS)
    def test_手写标定集三个正例照样放行(self, goal, terms):
        v = _closure(goal, terms)
        assert v["passed"] is True, v["reason"]
        assert v["score"] >= CLOSURE_COVERAGE_THRESHOLD + 0.2, (
            f"余量不足（{v['score']}），贴着阈值就是下次重标定的隐患"
        )

    def test_手写标定集六个错配对照样全部拦下(self):
        worst = 0.0
        for i, (goal, _) in enumerate(REAL_APPS):
            for j, (_, terms) in enumerate(REAL_APPS):
                if i == j:
                    continue
                v = _closure(goal, terms)
                assert v["passed"] is False, f"错配 {i}×{j} 漏放了：{v['reason']}"
                worst = max(worst, v["score"])
        assert worst == 0.0, f"错配最高分从 0.000 涨到了 {worst}"


class Test三处改动各自的贡献:
    """真机那一发（社区养老）的原样载荷，逐处量。

    三处一起上才够——只上一处仍然误杀。判据分开写，是为了哪一处被改回去
    都看得出来是哪一处。
    """

    def test_一_SPEC节点标题进了词表(self):
        titles = collect_spec_terms(YANGLAO_SPEC)
        assert "助餐网格配送与现场LBS签收闭环" in titles
        assert len(titles) == 11

    def test_一_没有SPEC时不多不少(self):
        """反向配对：SPEC 缺席/形状不对时不许炸，也不许凭空造词。"""
        assert collect_spec_terms(None) == []
        assert collect_spec_terms({"nodes": [{"id": "n1"}]}) == []
        assert collect_spec_terms("不是字典") == []

    def test_一_acceptance那种散文不许进词表(self):
        """★ 只收 title，不收 acceptance。

        acceptance 是整句散文（"当照护员与配送员登录系统时…"），跟任何题目都
        共享一堆 bigram，进词表等于把闸泡软——那正是这次要治的反面。
        """
        got = collect_spec_terms({"nodes": [
            {"id": "n0", "title": "标题", "acceptance": "当用户登录系统时，系统应当展示今日待办并支持一键处理"}
        ]})
        assert got == ["标题"]

    def test_二_认得出散落在多个名字里的业务点(self):
        """pool 的定义性差别：一个业务点的几段字眼**分散在不同名字里**时算命中。

        max 要求某**一个**名字独力扛下这个点；真机上一个业务点常常被拆到
        三个实体/菜单里各占一段，于是每一个单名都只共享 1 个 bigram = 0.33，
        全判没做。

        ⚠ 别拿两种模式的**总分**去比（第一版判据就错在这儿）：pool 那一路同时
          开了去括号，分母不一样，分数高低没有可比性。这里比的是**同一个业务点
          的命中与否**，两边喂同一个短语和同一份词表。
        """
        phrase = "助餐配送签收"
        terms = ["助餐订单", "配送路线", "签收记录"]
        # max：每个单名各只共享一段 → 全部 0.33，判没做
        assert max(containment(phrase, t) for t in terms) < TERM_HIT_THRESHOLD
        v = goal_coverage(phrase + "，另一个点，第三个点", terms,
                          mode="hybrid", threshold=CLOSURE_COVERAGE_THRESHOLD)
        assert phrase in {m["phrase"] for m in v["matched"]}, (
            "三个名字合起来明明把这个点写全了，pool 还是判成没做"
        )

    def test_二_不是把闸泡软_不相干的点照样判没做(self):
        """反向配对：让分散的字眼算数，**不许**让不相干的点也算数。"""
        v = goal_coverage("消防隐患整改，另一个点，第三个点",
                          ["助餐订单", "配送路线", "签收记录"],
                          mode="hybrid", threshold=CLOSURE_COVERAGE_THRESHOLD)
        assert "消防隐患整改" in {m["phrase"] for m in v["missing"]}

    def test_三_闭环那条路真的开了去括号(self):
        """★ §1：上一条只证明了函数**能**去括号，没证明闭环路径**开**了它。

        第一版就漏在这儿：把 `drop_paren_details=(mode == "hybrid")` 改成
        `False`，20 条判据全绿——因为它们都是直接调 split 函数并自己传 True。
        这条改成从产线入口进，数它实际用的分母。
        """
        v = evaluate_model_relevance(
            YANGLAO_GOAL,
            {"datamodel": {"entities": [{"name": t} for t in YANGLAO_MODEL_TERMS]}},
            spec=YANGLAO_SPEC,
        )
        denom = len(v["matched"]) + len(v["missing"])
        assert denom == len(split_goal_phrases(YANGLAO_GOAL, drop_paren_details=True)), (
            f"闭环判定用的分母是 {denom}，不等于去括号后的业务点数——"
            f"这条路上没开去括号（不去括号是 {len(split_goal_phrases(YANGLAO_GOAL))} 个）"
        )
        assert denom < len(split_goal_phrases(YANGLAO_GOAL)), "这道题本来就没有括号？判据选错样本了"

    def test_三_括号里的子项不各算一个业务点(self):
        """「老人全景档案（基础信息、慢病标签、饮食忌口、照护等级与补贴资质）」
        原先拆成 6 个点，分母凭空 +5。"""
        one = "老人全景档案（基础信息、慢病标签、饮食忌口、照护等级与补贴资质）"
        assert split_goal_phrases(one, drop_paren_details=True) == ["老人全景档案"]
        assert len(split_goal_phrases(one)) > 1, "默认行为被改了——套模板那一路会跟着变"

    def test_三处合起来_真机那一发从误杀变成放行(self):
        """★ 事故本体。三处任缺其一这条都该红。"""
        v = evaluate_model_relevance(
            YANGLAO_GOAL,
            {"datamodel": {"entities": [{"name": t} for t in YANGLAO_MODEL_TERMS]}},
            spec=YANGLAO_SPEC,
        )
        assert v["passed"] is True, (
            f"社区养老那一发仍被判成「产出与题目不符」（{v['score']}）：{v['reason']}"
        )


class Test套模板那一路逐位不变:
    """§4：这把尺子有两个用户，代价函数**相反**，操作点不共用。

    闭环判定判不了要放行（别误杀已生成的模型）；套模板判不了要拒绝
    （"判不了却套上，等于把别人的应用扣在用户头上"）。这次只重标定了前者。
    """

    def test_两个阈值是两个数_不许被统一掉(self):
        assert COVERAGE_THRESHOLD == 0.5
        assert CLOSURE_COVERAGE_THRESHOLD == 0.35
        assert COVERAGE_THRESHOLD != CLOSURE_COVERAGE_THRESHOLD

    @pytest.mark.parametrize("goal,terms", REAL_APPS)
    def test_默认入口仍是老算法老阈值(self, goal, terms):
        v = goal_coverage(goal, terms)
        assert v["threshold"] == 0.5
        assert v["score"] >= 0.8, "默认路径的分数变了——套模板那一路会跟着变"

    def test_套模板不会因为放宽而乱套(self):
        """真机那一发的目标：重标定之前挑不出模板，之后也不该突然挑得出。"""
        got = match_app_template(YANGLAO_GOAL, [{
            "id": "tpl-leave", "name": "员工请假管理",
            "pages": [{"id": "p1", "name": "我的请假单", "kind": "list"}],
        }])
        assert got is None, "放宽把一套请假模板扣到养老题上了"


# ── 标定集本体：真库里 15 个 spec-first 真会话（题 / 模型显示名 / SPEC 标题）──
#
# ⚠ 这份 JSON 就是模块头那张表的**数据**。以前"标定脚本与数据见提交说明"，
#   于是没人能重跑——阈值一改，凭什么改、改完好没好，全靠提交说明里的一段话。
#   现在它进了仓：谁要动 CLOSURE_COVERAGE_THRESHOLD / mode / 去括号，
#   下面这组判据会当场告诉他成绩掉到哪儿了（CLAUDE.md §6）。
_CALIB_PATH = (
    __import__("pathlib").Path(__file__).resolve().parent
    / "data" / "closure_relevance_calibration.json"
)
CALIB = __import__("json").loads(_CALIB_PATH.read_text(encoding="utf-8"))


def _terms(row):
    return list(row["modelTerms"]) + list(row["specTitles"])


def _near_duplicate(a, b):
    """题目本身就近似的两行不算「错配」——同一个话题跑过好几遍。"""
    from services.closure_relevance import containment
    return containment(a["goal"][:60], b["goal"][:60]) >= 0.4


class Test标定集成绩不许退步:
    """★ ②③ 两处改动只有在这里才咬得住。

    单条业务点的判据证明得了"pool 认得出分散的字眼"，证明不了"整套操作点
    对真会话的成绩"。而重标定的全部理由就是那个成绩。任一处改回去
    （SPEC 词表 / pool / 去括号 / 阈值），下面两条会当场变红并报出新成绩。
    """

    def test_正例过闸率不低于标定时的水平(self):
        passed = [r["sid"] for r in CALIB
                  if evaluate_model_relevance(
                      r["goal"],
                      {"datamodel": {"entities": [{"name": t} for t in r["modelTerms"]]}},
                      spec={"nodes": [{"id": f"n{i}", "title": t}
                                      for i, t in enumerate(r["specTitles"])]},
                  )["passed"]]
        rate = len(passed) / len(CALIB)
        assert rate >= 0.93, (
            f"正例过闸率掉到 {rate:.1%}（标定时 93.3%，改之前是 40.0%）。"
            f"被误杀的：{[s for s in (r['sid'] for r in CALIB) if s not in passed]}"
        )

    def test_交叉错配的漏放不超过标定时的水平(self):
        """标定时 210 对里漏放 1 对（99.52%）——**跟改动前的现状逐位持平**。

        这一条是整次重标定"没放水"的凭据：召回从 40.0% 提到 93.3%，
        而漏放一条没多。多漏一条就说明操作点被动过了。
        """
        leaked = []
        for a in CALIB:
            for b in CALIB:
                if a["sid"] == b["sid"] or _near_duplicate(a, b):
                    continue
                v = goal_coverage(a["goal"], _terms(b), mode="hybrid",
                                  threshold=CLOSURE_COVERAGE_THRESHOLD)
                if v["applicable"] and v["passed"]:
                    leaked.append((a["sid"][:16], b["sid"][:16], v["score"]))
        assert len(leaked) <= 1, (
            f"错配漏放了 {len(leaked)} 对（标定时 1 对）：{leaked[:5]}"
        )
