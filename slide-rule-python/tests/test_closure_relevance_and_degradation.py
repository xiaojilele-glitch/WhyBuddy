# -*- coding: utf-8 -*-
"""闭环三道新关卡的回归：题目相关性、降级标记、closureId。

回归锚点是 2026-08-04 那次真实事故：用户要「中小学课后托管」，目标里
「家长请假申请」这一个子功能让 `_recognize_domain` 单强词命中
`leave_approval`，走确定性夹具近路注入内置「员工请假管理」样板，6 项证据
数量齐全 → 判 closed 6/6 → 舞台渲染出一套跟托管毫无关系的请假系统。

正例数据取自 App Store 里真实落库的应用，不是编的——阈值就是拿它们标定
出来的（见 services/closure_relevance.py 模块头）。
"""

import pytest

from models.v5_state import V5SessionState
from services.closure_relevance import (
    COVERAGE_THRESHOLD,
    collect_model_terms,
    containment,
    evaluate_model_relevance,
    goal_coverage,
    split_goal_phrases,
)
from services.run_degradation import (
    IMPACT_DELIVERABLE,
    IMPACT_REASONING,
    REASON_AGENTIC_PICK_FALLBACK,
    REASON_CAPABILITY_LLM_FALLBACK,
    blocking_degradations,
    collect_degradations,
    degradation_blockers,
    degradation_summary,
    impact_for_capability,
    mark_degraded,
)
from services.v5_capability_executor import (
    _assemble_model_from_per_skill,
    _closure_app_slug,
    execute_v5_capability,
)

# ── 事故现场：目标是课后托管，产出是内置请假样板 ──
TUOGUAN_GOAL = (
    "给中小学课后托管做一套管理系统：登记学生和托管班次、老师排班考勤、"
    "每日签到签退、家长请假申请、按月生成托管费账单"
)
LEAVE_TERMS = [
    "员工", "假期余额", "请假单", "审批记录",
    "我的请假单", "主管审批看板", "团队请假日历", "HR假勤概览",
]

# ── 正例：App Store 里真实落库的应用（标定集） ──
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


class TestGoalCoverage:
    def test_事故现场_课后托管配请假模型_判不通过(self):
        v = goal_coverage(TUOGUAN_GOAL, LEAVE_TERMS)
        assert v["applicable"] is True
        assert v["passed"] is False
        assert v["score"] < COVERAGE_THRESHOLD
        # 理由要能自解释：说清漏了哪些业务点，否则用户无从排查
        assert "托管" in v["reason"]
        missing = {m["phrase"] for m in v["missing"]}
        assert "登记学生" in missing
        assert "每日签到签退" in missing

    def test_家长请假申请会部分命中请假单_但不足以救回覆盖率(self):
        """负例里恰好有一个业务点能对上，正是「只要有一个匹配就算过」会漏判的地方。"""
        v = goal_coverage(TUOGUAN_GOAL, LEAVE_TERMS)
        matched = {m["phrase"] for m in v["matched"]}
        assert "家长请假申请" in matched
        assert v["passed"] is False

    @pytest.mark.parametrize("goal,terms", REAL_APPS)
    def test_真实落库应用不被误杀(self, goal, terms):
        v = goal_coverage(goal, terms)
        assert v["passed"] is True, v["reason"]
        assert v["score"] >= COVERAGE_THRESHOLD

    def test_交叉错配全部判不通过(self):
        """A 的题配 B 的模型——标定时 24 个错配对全是 0.00。"""
        for i, (goal, _) in enumerate(REAL_APPS):
            for j, (_, terms) in enumerate(REAL_APPS):
                if i == j:
                    continue
                v = goal_coverage(goal, terms)
                assert v["passed"] is False, f"错配 {i}×{j} 竟然放行了：{v['reason']}"

    def test_目标太短时不判定_放行而非误杀(self):
        v = goal_coverage("做个记账的", ["账目"])
        assert v["applicable"] is False
        assert v["passed"] is True

    def test_模型没有可比对名称时不判定(self):
        v = goal_coverage(TUOGUAN_GOAL, [])
        assert v["applicable"] is False
        assert v["passed"] is True

    def test_餐饮巡检最终六系统模型覆盖责任升级看板和权限(self):
        """2026-08-05 真机回归：不能只看实体名和页面名就误判 3/7。"""
        goal = (
            "为连锁餐饮企业设计门店巡检与整改闭环系统，包含问题上报、责任分派、"
            "超时升级、数据看板和角色权限"
        )
        model = {
            "datamodel": {"entities": [
                {"id": "inspection_issue", "name": "巡检问题", "fields": [
                    {"id": "assignee", "name": "整改责任人"},
                    {"id": "deadline", "name": "整改时限"},
                ]},
            ]},
            "workflow": {"nodes": [
                {"id": "reported", "name": "问题上报"},
                {"id": "assigned", "name": "责任分派"},
                {"id": "escalated", "name": "超时升级"},
            ]},
            "rbac": {"roles": [
                {"id": "store_manager", "name": "门店店长", "permissionRefs": ["issue.assign"]},
                {"id": "quality_manager", "name": "品控管理员", "permissionRefs": ["dashboard.view"]},
            ], "permissions": [
                {"id": "issue.assign", "name": "分派整改责任"},
                {"id": "dashboard.view", "name": "查看数据看板"},
            ]},
            "page": {"pages": [
                {"id": "report_wizard", "name": "问题上报向导", "kind": "wizard"},
                {"id": "quality_dashboard", "name": "品控分析看板", "kind": "dashboard",
                 "stats": [{"id": "overdue", "label": "超时整改"}]},
                {"id": "escalation_workbench", "name": "升级督办台", "kind": "workbench"},
            ]},
            "aigc": {"features": []},
            "appbundle": {"appIdentity": {"productName": "巡改通"}},
        }

        verdict = evaluate_model_relevance(goal, model)
        assert verdict["passed"] is True, verdict["reason"]
        missing = {item["phrase"] for item in verdict["missing"]}
        assert not {"责任分派", "超时升级", "数据看板", "角色权限"} & missing


class TestPrimitives:
    def test_短语切分_按标点与并列连词(self):
        ph = split_goal_phrases(TUOGUAN_GOAL)
        assert "登记学生" in ph
        assert "托管班次" in ph  # "和" 拆开的后半段
        assert "每日签到签退" in ph

    def test_包含度是非对称的_短实体能被长短语覆盖(self):
        # 实体名比目标短语短，对称的 Dice 会被长度差稀释
        assert containment("登记就餐老人", "就餐老人") == 1.0
        assert containment("登记就餐老人", "绘本") == 0.0

    def test_只取_name_不取_id(self):
        model = {
            "datamodel": {"entities": [{"id": "leave_request", "name": "请假单"}]},
            "page": {"pages": [{"id": "my_leave", "name": "我的请假单"}]},
        }
        terms = collect_model_terms(model)
        assert terms == ["请假单", "我的请假单"]


class TestDegradation:
    def test_记录并取出降级条目(self):
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        assert collect_degradations(st) == []
        mark_degraded(st, reason=REASON_AGENTIC_PICK_FALLBACK, message="第 4 轮回落规则版")
        got = collect_degradations(st)
        assert len(got) == 1
        # 照 K8s metav1.Condition 的字段与语义
        assert got[0]["type"] == "Degraded"
        assert got[0]["status"] == "True"
        assert got[0]["reason"] == REASON_AGENTIC_PICK_FALLBACK
        assert got[0]["lastTransitionTime"]

    def test_同原因重复上报只记一次(self):
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        for _ in range(3):
            mark_degraded(st, reason=REASON_AGENTIC_PICK_FALLBACK, message="回落")
        assert len(collect_degradations(st)) == 1

    def test_伤到交付物的降级才转成_blocker(self):
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        mark_degraded(st, reason=REASON_CAPABILITY_LLM_FALLBACK, message="收口退 RAG",
                      impact=IMPACT_DELIVERABLE)
        blockers = degradation_blockers(collect_degradations(st))
        assert blockers[0]["code"] == "CLOSURE_DEGRADED_RUN"
        assert REASON_CAPABILITY_LLM_FALLBACK in blockers[0]["ref"]

    def test_过程磕碰不转成_blocker(self):
        """argo#12530 的教训：「能继续跑」跟「算不算数」是两件事。"""
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        mark_degraded(st, reason=REASON_AGENTIC_PICK_FALLBACK, message="回落规则版")
        got = collect_degradations(st)
        assert len(got) == 1                       # 照样留痕
        assert blocking_degradations(got) == []    # 但不拦交付
        assert degradation_blockers(got) == []


class TestImpactGrading:
    """降级分级：只有伤到交付物的才拦。

    2026-08-04 真跑：六项证据齐、相关性 0.857 判定对题、建模生图设计全成，
    只因推演阶段两处退 RAG 就整轮作废，用户白等 33 分钟。
    """

    def test_收口能力算交付关键路径(self):
        assert impact_for_capability("appbundle.runtimeclosure") == IMPACT_DELIVERABLE
        assert impact_for_capability("AppBundle.RuntimeClosure") == IMPACT_DELIVERABLE  # 大小写无关

    @pytest.mark.parametrize("cap", [
        "synthesis.merge", "risk.analyze", "evidence.search",
        "critique.generate", "structure.decompose", "task.write",
    ])
    def test_推演类能力只算过程磕碰(self, cap):
        assert impact_for_capability(cap) == IMPACT_REASONING

    def test_默认取_reasoning_而不是阻断(self):
        """默认设成阻断会重演「白等半小时」；真正伤交付物的路径可枚举，让它显式声明。"""
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        mark_degraded(st, reason="SomeNewReason", message="m")
        assert collect_degradations(st)[0]["impact"] == IMPACT_REASONING

    def test_同原因再次上报可升级影响面(self):
        """先在推演里退过一次、后来收口也退了——不能被首次记录盖住。"""
        st = V5SessionState(sessionId="s", goal={"text": "x"})
        mark_degraded(st, reason=REASON_CAPABILITY_LLM_FALLBACK, message="synthesis 退 RAG")
        mark_degraded(st, reason=REASON_CAPABILITY_LLM_FALLBACK, message="收口退 RAG",
                      impact=IMPACT_DELIVERABLE)
        got = collect_degradations(st)
        assert len(got) == 1
        assert got[0]["impact"] == IMPACT_DELIVERABLE
        assert len(blocking_degradations(got)) == 1

    def test_摘要措辞要分清拦下了还是放行了(self):
        """用户看到绿灯时也该知道这轮不是一帆风顺，好自己判断要不要重跑。"""
        soft = [{"reason": "R", "message": "退了兜底", "impact": IMPACT_REASONING}]
        hard = [{"reason": "R", "message": "收口退兜底", "impact": IMPACT_DELIVERABLE}]
        assert "未伤及交付物" in degradation_summary(soft)
        assert "伤及交付物" in degradation_summary(hard)
        assert "不足以判定闭环" in degradation_summary(hard)
        assert degradation_summary([]) == ""


class TestClosureIdSlug:
    def test_不再是硬编码的采购审批(self):
        model = {
            "appbundle": {"appIdentity": {"productName": "假期无忧"}},
            "datamodel": {"entities": [{"id": "leave_request"}]},
        }
        slug = _closure_app_slug(model, "随便什么目标")
        assert "purchase_approval" not in slug
        # 中文产品名取不出 ASCII，退到实体 id 当可读前缀
        assert slug.startswith("leave_request_")

    def test_同名但结构不同的应用不撞_id(self):
        a = {"appbundle": {"appIdentity": {"productName": "工单系统"}},
             "datamodel": {"entities": [{"id": "ticket"}]}}
        b = {"appbundle": {"appIdentity": {"productName": "工单系统"}},
             "datamodel": {"entities": [{"id": "work_order"}, {"id": "customer"}]}}
        assert _closure_app_slug(a, "g") != _closure_app_slug(b, "g")

    def test_同一应用两次算出同一个_slug(self):
        model = {"appbundle": {"appIdentity": {"productName": "X"}},
                 "datamodel": {"entities": [{"id": "a"}]}}
        assert _closure_app_slug(model, "g") == _closure_app_slug(model, "g")


@pytest.mark.usefixtures("demo_fixture_path")
class TestClosureEndToEnd:
    """事故现场的端到端复现——这三条是这次改动真正要守住的东西。

    整类显式开夹具快路径（2026-08-10 起默认关）。对这里的用例这不是"为了让
    它们继续绿"的补丁，而是**测的前提**：这一类问的是"夹具这条路活着的时候，
    相关性尺子拦不拦得住误认"。开关关掉的话，托管那条会因为压根没夹具可套
    而平凡通过，哨兵就失效了。
    """

    def _closure(self, goal, *, degrade=False, degrade_impact=IMPACT_DELIVERABLE):
        st = V5SessionState(sessionId="t", goal={"text": goal})
        if degrade:
            mark_degraded(st, reason=REASON_AGENTIC_PICK_FALLBACK,
                          message="第 4 轮回落规则版", impact=degrade_impact)
        return execute_v5_capability("appbundle.runtimeClosure", st, [], "综合", "turn-1")

    def test_课后托管不再被套上请假样板(self):
        """事故的正解：不是「套错了再拦住」，是压根不套。

        「家长请假申请」仍会让 _recognize_domain 认成 leave_approval，但夹具
        适配检查会否掉它，落到 LLM 生成分支去真做一个托管应用。测试环境没开
        LLM 生成，于是诚实停在 0/6 + LLM_GENERATE_DISABLED——绝不会再渲染出
        一套员工请假系统。
        """
        r = self._closure(TUOGUAN_GOAL)
        assert r["blocked"] is True
        model = _assemble_model_from_per_skill(r["perSkillEvidence"])
        entity_names = [
            e.get("name") for e in ((model.get("datamodel") or {}).get("entities") or [])
        ]
        assert "请假单" not in entity_names
        assert "假期余额" not in entity_names

    def test_域误认时夹具被否掉_真域不受影响(self):
        from services.v5_capability_executor import (
            _domain_fixture_fits_goal,
            _recognize_domain,
        )

        # 托管题里的「请假」子功能仍会命中强词，但夹具对不上题
        assert _recognize_domain(TUOGUAN_GOAL) == "leave_approval"
        assert _domain_fixture_fits_goal("leave_approval", TUOGUAN_GOAL) is False
        # 真请假题 / 真采购题的演示域快路径不受影响
        real_leave = ("给公司做一套请假审批系统：登记员工和假期余额、提交请假单、"
                      "主管审批、HR假勤概览、审批记录归档")
        assert _domain_fixture_fits_goal("leave_approval", real_leave) is True

    def test_错模型若混进证据_相关性关卡仍能拦住(self):
        """夹具适配是第一道，相关性关卡是第二道——LLM 生成路径跑歪时靠它兜。"""
        from services.v5_capability_executor import _relevance_findings

        per_skill = {
            "datamodel": {"modelSection": {"entities": [
                {"id": "leave_request", "name": "请假单"},
                {"id": "employee", "name": "员工"},
            ]}},
            "page": {"modelSection": {"pages": [
                {"id": "my_leave", "name": "我的请假单"},
                {"id": "kanban", "name": "主管审批看板"},
            ]}},
        }
        verdict, blockers = _relevance_findings(TUOGUAN_GOAL, per_skill)
        assert verdict["passed"] is False
        assert verdict["score"] < COVERAGE_THRESHOLD
        assert [b["code"] for b in blockers] == ["CLOSURE_GOAL_RELEVANCE_FAILED"]

    def test_题目与产出相符时照常放行(self):
        r = self._closure(
            "给公司做一套请假审批系统：登记员工和假期余额、提交请假单、"
            "主管审批、HR假勤概览、审批记录归档"
        )
        assert r["blocked"] is False
        assert r["blockers"] == []
        assert r["goalRelevance"]["passed"] is True

    REAL_LEAVE = ("给公司做一套请假审批系统：登记员工和假期余额、提交请假单、"
                  "主管审批、HR假勤概览、审批记录归档")

    def test_伤到交付物的降级_产出对题也不发合格证(self):
        r = self._closure(self.REAL_LEAVE, degrade=True, degrade_impact=IMPACT_DELIVERABLE)
        assert r["blocked"] is True
        assert "CLOSURE_DEGRADED_RUN" in [b["code"] for b in r["blockers"]]
        # 产出本身是对题的，拦它纯粹因为交付链路降级了
        assert r["goalRelevance"]["passed"] is True
        assert "伤及交付物" in r["degradationSummary"]

    def test_过程磕碰照常放行_但摘要要标出来(self):
        """2026-08-04 真跑：六项证据齐、判定对题、建模生图设计全成，只因推演
        阶段两处退 RAG 就整轮作废，用户白等 33 分钟。分级之后这种放行。"""
        r = self._closure(self.REAL_LEAVE, degrade=True, degrade_impact=IMPACT_REASONING)
        assert r["blocked"] is False
        assert r["blockers"] == []
        # 放行不等于装作没发生：降级照旧留痕、摘要照旧标注
        assert len(r["runConditions"]) == 1
        assert "未伤及交付物" in r["degradationSummary"]

    def test_闭环产物带上判定依据(self):
        r = self._closure(TUOGUAN_GOAL)
        assert "goalRelevance" in r and "runConditions" in r
        assert "app_purchase_approval" not in r["closureId"]

    def test_判定依据要投影到前端契约里(self):
        """derive 那层是**白名单**投影，不列出的字段一律丢掉。

        实测漏过一轮：闭环产物里明明带了 goalRelevance/runConditions，
        持久化的 publishClosure 里却是 None——前端只看到结论看不到依据。
        放行时也必须留分数，否则通过的那次完全无痕，事后无从判断这道关卡
        是真在起作用还是形同虚设。
        """
        from services.v5_publish_closure_response import _to_publish_closure_summary

        real_leave = ("给公司做一套请假审批系统：登记员工和假期余额、提交请假单、"
                      "主管审批、HR假勤概览、审批记录归档")
        # 放行的一轮：分数要在
        s = _to_publish_closure_summary(self._closure(real_leave))
        assert s["blocked"] is False
        assert s["goalRelevance"]["passed"] is True
        assert s["goalRelevance"]["score"] >= COVERAGE_THRESHOLD
        assert s["runConditions"] == []
        assert s["degradationSummary"] == ""

        # 降级的一轮：降级条目与摘要要在
        s2 = _to_publish_closure_summary(self._closure(real_leave, degrade=True))
        assert s2["blocked"] is True
        assert len(s2["runConditions"]) == 1
        assert s2["runConditions"][0]["reason"] == REASON_AGENTIC_PICK_FALLBACK
        assert "降级" in s2["degradationSummary"]

    def test_模型能从逐技能证据拼回来(self):
        """走演示域快路径的真请假题会挂上完整模型段，验证拼装覆盖这条路。"""
        real_leave = ("给公司做一套请假审批系统：登记员工和假期余额、提交请假单、"
                      "主管审批、HR假勤概览、审批记录归档")
        r = self._closure(real_leave)
        model = _assemble_model_from_per_skill(r["perSkillEvidence"])
        assert "datamodel" in model and "page" in model
        assert evaluate_model_relevance(real_leave, model)["passed"] is True
