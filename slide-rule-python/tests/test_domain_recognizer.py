"""演示域识别器的准确性哨兵（真实事故回归）。

历史 bug：裸子串匹配让 "sla" 命中 translation/island/slack/slash/legislation，
"升级" 命中任何提到升级的意图——用户要翻译平台、拿到冻结工单系统，且全程
无痕。此前测试只锁"四份夹具能过门"，从未测过"匹配器会不会认错人"，CI 恒绿。

本文件锁两件事：
1. 该认的认（四张示例卡原文 + 常见领域表述）；
2. 不该认的坚决不认（误伤词均返回 None → fail-closed 交给 LLM 生成）。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_capability_executor import DOMAIN_INTENT_MARKERS, _recognize_domain

# 原 E41 示例卡的四句预填意图（示例库 2026-08-14 下架、builtin_examples 模块
# 删除，但这四句是"最标准的领域表述"，识别器的召回契约照旧用它们锁）。
_CANONICAL_INTENTS = {
    "purchase_approval": "设计一个采购审批系统，包含采购申请、部门审批和供应商管理",
    "leave_approval": "设计一个请假审批系统，包含请假申请、主管审批和假期额度管理",
    "service_ticket": "我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效",
    "employee_onboarding": "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
}


# ── 该认的认 ────────────────────────────────────────────────

def test_example_card_intents_recognized():
    """四句标准领域表述必须精确落回各自的域（识别器召回契约）。"""
    for domain, intent in _CANONICAL_INTENTS.items():
        assert _recognize_domain(intent) == domain


def test_domain_specific_phrases_recognized():
    cases = {
        "purchase approval workflow for vendors": "purchase_approval",
        "帮我做一个采购管理系统": "purchase_approval",
        "请假审批小程序": "leave_approval",
        "团队休假管理": "leave_approval",
        "客服工单平台，支持 SLA 升级": "service_ticket",
        "内部服务台系统": "service_ticket",
        "新员工报到与入职流程": "employee_onboarding",
        "employee onboarding portal": "employee_onboarding",
    }
    for goal, expected in cases.items():
        assert _recognize_domain(goal) == expected, goal


def test_two_weak_markers_together_recognized():
    """弱词单独不认，两个不同弱词同现才认（ticket + sla）。"""
    assert _recognize_domain("ticket triage with SLA tracking") == "service_ticket"


def test_plural_forms_recognized():
    """词边界允许可选复数后缀——tickets/approvals/requests 是极自然的英文
    表述，一刀切词边界会把它们全打成认不出（终检实测的召回回归）。"""
    cases = {
        "service tickets system": "service_ticket",
        "build purchase approvals workflow": "purchase_approval",
        "build a purchase_requests system": "purchase_approval",
        "leave requests approval app": "leave_approval",
    }
    for goal, expected in cases.items():
        assert _recognize_domain(goal) == expected, goal


# ── 不该认的坚决不认（历史误伤全量回归）────────────────────

FALSE_POSITIVE_GOALS = [
    # "sla" 裸子串历史误伤
    "A translation platform for multilingual docs",
    "Island tourism booking site",
    "Slack-like team chat tool",
    "A slash command bot for Discord",
    "legislation tracking dashboard",
    "slate-gray design system docs",
    # "升级" 泛词误伤
    "产品功能升级路线图管理",
    # "ticket" 单独出现是泛词（门票/票务 ≠ 服务工单）
    "movie ticket booking app",
    # "onboarding" 单独出现是泛词（产品新手引导 ≠ 员工入职）
    "user onboarding flow for a mobile app",
    # 完全无关
    "会员制健身房管理系统",
]


def test_false_positives_stay_unrecognized():
    for goal in FALSE_POSITIVE_GOALS:
        assert _recognize_domain(goal) is None, f"误认: {goal!r} -> {_recognize_domain(goal)}"


# ── 结构哨兵 ────────────────────────────────────────────────

def test_marker_table_shape():
    """marker 表必须是 {domain: {strong: [...], weak: [...]}}；泛词只许出现在
    weak 档（防止将来有人把 sla/升级 又挪回强词）。"""
    generic_words = {"sla", "ticket", "升级", "onboarding"}
    for domain, markers in DOMAIN_INTENT_MARKERS.items():
        assert set(markers.keys()) == {"strong", "weak"}, domain
        for word in markers["strong"]:
            assert word.lower() not in generic_words, (
                f"泛词 {word!r} 不允许作为 {domain} 的强词"
            )


def test_empty_and_garbage_goals():
    assert _recognize_domain("") is None
    assert _recognize_domain("   ") is None
    assert _recognize_domain("完全无关的一句话") is None
