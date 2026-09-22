"""E35：确定性演示域的内置五系统模型夹具（闭环后右侧长出应用）。

用户实测 bug：员工入职（内置演示域）闭环 6/6 后右侧停在证据看板——夹具
证据历史上不带 modelSection，客户端解析不出模型。夹具模型由 LLM 一次性
生成、过结构门后冻结（services/data/builtin_domain_models.json），运行时
零 LLM。这里锁三件事：夹具本身过门、证据挂上 modelSection、闭环语义不变。
"""

import json
from pathlib import Path

import pytest

# 整个文件测的就是内置演示域夹具本身，前提是夹具快路径开着。
# 该开关 2026-08-10 起默认关（见 _demo_fixture_enabled 头注）。
pytestmark = pytest.mark.usefixtures("demo_fixture_path")

from services.v5_capability_executor import (
    DOMAIN_INTENT_MARKERS,
    _build_per_skill_evidence,
    _builtin_domain_model_section,
    REQUIRED_EVIDENCE_KEYS,
)
from services.v5_model_gate import validate_five_system_model

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def test_fixture_exists_and_covers_all_domains():
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(models.keys()) == set(DOMAIN_INTENT_MARKERS.keys())


def test_fixture_models_pass_structural_gate():
    """冻结的模型必须始终过门——门规则演进时这里会红，提醒重新生成夹具。"""
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for domain, model in models.items():
        verdict = validate_five_system_model(model)
        assert verdict.get("passed"), f"{domain} 夹具未过门: {verdict.get('findings')[:2]}"


def test_fixture_models_choose_a_real_landing_page():
    """内置应用也不再统一打开旧工作台；首屏引用必须落到自身页面。"""
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for domain, model in models.items():
        page_ids = {page["id"] for page in model["page"]["pages"]}
        landing = model["appbundle"].get("landingPageRef")
        assert landing in page_ids, f"{domain} 首屏引用无效: {landing}"


def test_builtin_section_lookup():
    assert _builtin_domain_model_section("employee_onboarding", "datamodel") is not None
    assert _builtin_domain_model_section("no_such_domain", "datamodel") is None


def test_builtin_domain_models_pass_strict_gate():
    """leave_approval 和 service_ticket 内置模型在 strict Gate 下仍通过。

    这两个模型已声明真实业务首屏（landingPageRef 指向自身 page.pages 内有效页面），
    strict Gate 不应拦截。此测试锁住该事实：如果哪次修改不小心清掉了 landingPageRef，
    此测试立即变红。
    """
    import json
    import pathlib
    models_path = pathlib.Path(__file__).parent.parent / "services/data/builtin_domain_models.json"
    data = json.loads(models_path.read_text(encoding="utf-8"))
    for name in ["leave_approval", "service_ticket"]:
        model = data.get(name)
        assert model is not None, f"{name} not found in builtin_domain_models.json"
        findings_result = validate_five_system_model(model, require_landing_page_ref=True)
        blocking = [f for f in findings_result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
        assert len(blocking) == 0, f"{name} failed strict gate: {blocking}"
    """演示域闭环证据六段全挂 modelSection（app 主舞台的数据源）。"""
    from models.v5_state import V5SessionState

    goal = "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理"
    state = V5SessionState(sessionId="t-e35", goal={"text": goal})
    per_skill = _build_per_skill_evidence(state, blocked_signal=False, goal=goal)
    for skill in REQUIRED_EVIDENCE_KEYS:
        entry = per_skill[skill]
        assert entry["evidencePresent"] is True
        assert isinstance(entry.get("modelSection"), dict), f"{skill} 缺 modelSection"
        # 信任字段口径不变：artifactId 仍是确定性夹具 id
        assert entry["artifactId"] == f"runtime-linkage-{skill}"
