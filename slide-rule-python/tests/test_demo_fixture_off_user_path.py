"""演示域夹具快路径在用户路径上默认关（2026-08-10 线上实测事故回归）。

事故现场：一道「客服工单系统」被 _recognize_domain 认成 service_ticket，
相关性补丁放行（这道题**确实**就是工单系统，尺子挑不出错），整趟推演
model.generate **0 次**，直接端出 2026-07 之前冻结的那份样板——5 个页面里
连 blocks 这个键都不存在，359 个区块一个都没用上。

这跟 08-04 那次是两种病：
  · 08-04：认**错**域（托管请假 → 企业请假）。_domain_fixture_fits_goal 补的是它。
  · 这次：认**对**了域，可夹具本身已经过期。相关性尺子量不出来——题和夹具
    确实同域。补丁挡不住，只能把这条路从用户路径上摘掉。

所以这个文件锁两件事：
  1. 默认（用户路径）：认出演示域也**不**套夹具，落到 LLM 生成分支；
  2. 显式开启（演示/回归）：行为与从前**一字不差**，夹具没删也没坏。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.v5_state import V5SessionState
from services.v5_capability_executor import (
    REQUIRED_EVIDENCE_KEYS,
    _build_per_skill_evidence,
    _builtin_domain_model_section,
    _demo_fixture_enabled,
    _recognize_domain,
)

#: 事故原题的形状：确实是工单系统，_recognize_domain 认得对，相关性也该放行。
TICKET_GOAL = "我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效"


def _per_skill(goal: str) -> dict:
    state = V5SessionState(sessionId="t-demo-fixture-gate", goal={"text": goal})
    return _build_per_skill_evidence(state, blocked_signal=False, goal=goal)


def _fixture_skills(per_skill: dict, domain: str) -> list:
    """哪些槽位的证据是**那份冻结夹具**来的。

    判据故意用"模型段与 builtin_domain_models.json 里的那一段逐字相等"，
    而不是看 artifactId 前缀或 provenance：
      · provenance 压根不投影到 per_skill 条目里（第一版这么写，结果三条
        "没走夹具"的断言全部**平凡通过**——恒返回空列表，什么都没测到）；
      · artifactId 前缀（runtime-linkage-*）是命名巧合，改个名就失灵。
    跟夹具原文比是唯一不会骗人的判据。
    """
    return [
        skill
        for skill in REQUIRED_EVIDENCE_KEYS
        if per_skill.get(skill, {}).get("modelSection") is not None
        and per_skill[skill]["modelSection"] == _builtin_domain_model_section(domain, skill)
    ]


# ── 1. 开关本身 ────────────────────────────────────────────────────────────


def test_默认关(monkeypatch):
    """产品默认值就是关。这条是这次改动的全部要点，单独钉一下。"""
    monkeypatch.delenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raising=False)
    assert _demo_fixture_enabled() is False


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
def test_真值写法都认(monkeypatch, raw):
    monkeypatch.setenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raw)
    assert _demo_fixture_enabled() is True


@pytest.mark.parametrize("raw", ["", "0", "false", "off", "no", "  ", "maybe"])
def test_非真值一律当关(monkeypatch, raw):
    """含糊值当关——夹具误开的代价是静默发残次品，宁可 fail-closed。"""
    monkeypatch.setenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raw)
    assert _demo_fixture_enabled() is False


# ── 2. 默认（用户路径）：认对了域也不套夹具 ────────────────────────────────


def test_域仍然认得出来(monkeypatch):
    """先确认前提：这道题**确实**被认成 service_ticket。

    否则下面那条"没套夹具"可能只是因为压根没认出域，测了个空。
    """
    monkeypatch.delenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raising=False)
    assert _recognize_domain(TICKET_GOAL) == "service_ticket"


def test_用户路径不再套夹具(monkeypatch):
    """事故的正解：认对了域，也不拿那份过期样板交付。"""
    monkeypatch.delenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raising=False)
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    per_skill = _per_skill(TICKET_GOAL)
    assert _fixture_skills(per_skill, "service_ticket") == [], "用户路径不得再套那份冻结夹具"


def test_夹具关掉后诚实停在缺证据而不是发残次品(monkeypatch):
    """LLM 生成也没开 → 0/6 fail-closed。

    这是刻意选的：宁可诚实地什么都不给（用户看得见 blocker、能排查），
    也不要静默端出一份 359 个区块一个没用的光秃秃表格应用。
    """
    monkeypatch.delenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raising=False)
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    per_skill = _per_skill(TICKET_GOAL)
    assert all(
        per_skill[skill].get("modelSection") is None for skill in REQUIRED_EVIDENCE_KEYS
    ), "没有夹具、也没开生成时不该凭空长出模型段"


def test_四个演示域一个都不走夹具(monkeypatch):
    """不是只修了工单这一个域——四个内置域在用户路径上一律不套夹具。"""
    monkeypatch.delenv("SLIDERULE_DEMO_FIXTURE_ENABLED", raising=False)
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    goals = {
        "purchase_approval": "生成一个采购审批应用，包含采购单、审批流和财务复核",
        "leave_approval": "做一个员工请假管理系统，含请假单、假期余额和审批",
        "service_ticket": TICKET_GOAL,
        "employee_onboarding": "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
    }
    for domain, goal in goals.items():
        assert _recognize_domain(goal) == domain, f"前提不成立：{goal!r} 没认成 {domain}"
        assert _fixture_skills(_per_skill(goal), domain) == [], f"{domain} 仍走了夹具"


# ── 3. 显式开启：夹具没删也没坏 ────────────────────────────────────────────


def test_显式开启后夹具照旧(monkeypatch, demo_fixture_path):
    """演示模式/回归的行为与从前一字不差：6/6 + 每段带冻结模型段。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    per_skill = _per_skill(TICKET_GOAL)
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert per_skill[skill]["evidencePresent"] is True, skill
        assert isinstance(per_skill[skill].get("modelSection"), dict), skill
    assert _fixture_skills(per_skill, "service_ticket") == REQUIRED_EVIDENCE_KEYS, \
        "开启后六段都该来自那份冻结夹具"


def test_开启时相关性补丁仍然生效(monkeypatch, demo_fixture_path):
    """08-04 那道补丁不能被这次改动顶掉：开着夹具时，误认的域照样要被否掉。

    「课后托管 + 家长请假申请」会让 _recognize_domain 命中 leave_approval，
    但夹具适配检查否掉它——即便快路径开着，也不该套出一套员工请假系统。
    """
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    tuoguan = (
        "给中小学课后托管机构做个系统：学生报名、班次排课、每日签到、"
        "家长请假申请、课时账单"
    )
    assert _recognize_domain(tuoguan) == "leave_approval", "前提不成立"
    assert _fixture_skills(_per_skill(tuoguan), "leave_approval") == [], \
        "误认的域即便开着夹具也不该套上"
