"""第 5 步：结构 + SPEC → 权限/工作流/不变式（2026-08-13）。

这是六步里**唯一没有正面实测**的一条边，所以用例的重点是"两侧的失败形态
都要被抓住"——三臂对照实测的结论直接固化在这里：

    臂            角色  权限对象编的  悬空引用  闸
    B 两个都给      4        0         0     过 ✅
    S 只有SPEC     4        8         8     拦（16 处）
    H 只有结构      1        0         0     拦（3 个 persona 没角色认领）

⚠ 头一版判据「角色可溯率」**没抓住 H**：H 只产出 1 个角色，而那一个恰好猜中
了 'u1'，于是可溯率 100%、指标全绿、3/4 的角色没了。只查"产出的对不对"、
不查"该有的在不在"——今天第三次踩这个形状。反向判据（persona 覆盖）就是
那次补的，别删。
"""

from __future__ import annotations

import copy

import pytest

from services.spec_semantics import (
    ACTIONS,
    SpecSemantics,
    SpecSemanticsError,
    build_prompt,
    derive_semantics,
    to_model_sections,
    validate_semantics,
)

SPEC = {
    "appName": "宠康云诊疗",
    "personas": [
        {"id": "u1", "name": "前台接诊员", "goals": ["登记预约"]},
        {"id": "u2", "name": "宠物医生", "goals": ["写病历开处方"]},
    ],
    "nodes": [
        {"id": "n0", "type": "requirement", "title": "预约挂号",
         "acceptance": "当宠物主人提交预约时，系统应生成预约单。"},
    ],
}

STRUCTURE = {
    "entities": [
        {"id": "appointment", "name": "预约",
         "fields": [{"id": "status", "name": "状态", "type": "enum"},
                    {"id": "booked_at", "name": "预约时间", "type": "date"}]},
        {"id": "medical_record", "name": "病历",
         "fields": [{"id": "diagnosis", "name": "诊断", "type": "text"}]},
    ],
    "pages": [{"id": "p1", "name": "预约与候诊", "kind": "workbench"}],
}

GOOD: dict = {
    "version": "spec-semantics-v1",
    "roles": [
        {"id": "reception", "name": "前台接诊员", "personaRef": "u1"},
        {"id": "doctor", "name": "宠物医生", "personaRef": "u2"},
    ],
    "permissions": ["appointment:create", "appointment:read", "medical_record:create"],
    "rolePermissions": {
        "reception": ["appointment:create", "appointment:read"],
        "doctor": ["medical_record:create"],
    },
    "workflowNodes": [
        {"id": "booked", "name": "已预约", "assigneeRole": "reception", "phase": "受理"},
        {"id": "in_consult", "name": "诊疗中", "assigneeRole": "doctor", "phase": "执行"},
        {"id": "closed", "name": "已完成", "assigneeRole": "reception", "phase": "结束"},
    ],
    "workflowTransitions": [
        {"from": "booked", "to": "in_consult", "condition": "叫号进入诊室"},
        {"from": "in_consult", "to": "closed", "condition": "病历写完"},
    ],
    "invariants": [
        {"id": "record_before_close", "statement": "没有病历不允许结束就诊。",
         "systems": ["datamodel", "workflow"],
         "refs": ["medical_record.diagnosis", "closed"]},
    ],
}


def 失败原因(payload: dict) -> str:
    v = validate_semantics(payload, structure=STRUCTURE, spec=SPEC)
    assert v["passed"] is False, "这份该被拦下来，却过了"
    return "｜".join(f["message"] for f in v["findings"])


class Test合法件:
    def test_通过(self):
        assert validate_semantics(GOOD, structure=STRUCTURE, spec=SPEC) == {
            "passed": True, "findings": []}

    def test_没给输入时只查形状(self):
        s = copy.deepcopy(GOOD)
        s["roles"][0]["personaRef"] = "不存在"
        assert validate_semantics(s)["passed"] is True


class Test少了结构那一侧_悬空引用:
    """S 臂的失败形态。实测：8 个编的权限对象 + 8 个悬空引用。

    坏样本原文：`dispensing:create`（结构里只有 dispensing_record）、
    `billing.amount`（凭空发明的字段）。
    """

    def test_拦_权限对象不是真实体(self):
        s = copy.deepcopy(GOOD)
        s["permissions"].append("dispensing:create")
        s["rolePermissions"]["doctor"].append("dispensing:create")
        assert "dispensing" in 失败原因(s)

    def test_拦_不变式_refs_悬空(self):
        s = copy.deepcopy(GOOD)
        s["invariants"][0]["refs"] = ["billing.amount"]
        assert "指不到" in 失败原因(s)

    def test_拦_refs_指向不存在的字段(self):
        s = copy.deepcopy(GOOD)
        s["invariants"][0]["refs"] = ["appointment.不存在的字段"]
        assert "指不到" in 失败原因(s)

    def test_refs_可以指实体_角色_节点(self):
        for ref in ("appointment", "doctor", "in_consult", "appointment.status"):
            s = copy.deepcopy(GOOD)
            s["invariants"][0]["refs"] = [ref]
            assert validate_semantics(s, structure=STRUCTURE, spec=SPEC)["passed"], ref

    def test_拦_不变式一个_ref_都没有(self):
        s = copy.deepcopy(GOOD)
        s["invariants"][0]["refs"] = []
        assert validate_semantics(s)["passed"] is False


class Test少了_SPEC_那一侧_角色塌掉:
    """H 臂的失败形态。实测：4 类使用者塌成 1 个角色，丢了 3 个。

    ⚠ 头一版判据抓不到它——H 那唯一的角色恰好猜中 'u1'，可溯率 100%。
    """

    def test_拦_persona_没有角色认领(self):
        s = copy.deepcopy(GOOD)
        s["roles"] = [s["roles"][0]]  # 只留前台，丢掉医生
        s["rolePermissions"].pop("doctor")  # 连带清掉，否则先撞上另一条判据
        s["workflowNodes"][1]["assigneeRole"] = "reception"
        msg = 失败原因(s)
        assert "宠物医生" in msg and "无权可用" in msg

    def test_报得出是哪个_persona(self):
        s = copy.deepcopy(GOOD)
        s["roles"] = [s["roles"][0]]
        s["rolePermissions"].pop("doctor")
        s["workflowNodes"][1]["assigneeRole"] = "reception"
        v = validate_semantics(s, structure=STRUCTURE, spec=SPEC)
        assert [f["path"] for f in v["findings"]] == ["personas[u2]"]

    def test_拦_角色回指不存在的_persona(self):
        s = copy.deepcopy(GOOD)
        s["roles"][1]["personaRef"] = "u9"
        assert "凭空加的" in 失败原因(s)

    def test_两个方向都要查(self):
        """只查一个方向就是头一版那个错。这条用例把两侧钉在一起。"""
        少了 = copy.deepcopy(GOOD); 少了["roles"] = [少了["roles"][0]]
        少了["rolePermissions"].pop("doctor"); 少了["workflowNodes"][1]["assigneeRole"] = "reception"
        多了 = copy.deepcopy(GOOD)
        多了["roles"].append({"id": "admin", "name": "系统管理员", "personaRef": "u9"})
        assert validate_semantics(少了, structure=STRUCTURE, spec=SPEC)["passed"] is False
        assert validate_semantics(多了, structure=STRUCTURE, spec=SPEC)["passed"] is False


class Test权限形状_照_Casbin_的三元组:
    def test_拦_权限形状不对(self):
        for bad in ("appointment", "appointment:", ":read", "Appointment:read", "a:b:c"):
            s = copy.deepcopy(GOOD)
            s["permissions"] = [bad]
            assert validate_semantics(s)["passed"] is False, bad

    def test_拦_动作不在封闭表里(self):
        s = copy.deepcopy(GOOD)
        s["permissions"].append("appointment:archive")
        assert validate_semantics(s)["passed"] is False

    def test_封闭表里的动作都放行(self):
        for act in ACTIONS:
            s = copy.deepcopy(GOOD)
            s["permissions"] = [f"appointment:{act}"]
            s["rolePermissions"] = {}
            assert validate_semantics(s)["passed"] is True, act

    def test_拦_授予了清单外的权限(self):
        s = copy.deepcopy(GOOD)
        s["rolePermissions"]["doctor"] = ["appointment:delete"]
        assert validate_semantics(s)["passed"] is False

    def test_拦_给不存在的角色授权(self):
        s = copy.deepcopy(GOOD)
        s["rolePermissions"]["ghost"] = ["appointment:read"]
        assert validate_semantics(s)["passed"] is False


class Test工作流是个走得通的状态机:
    """孤儿节点和死胡同都能过形状校验，却会在运行时把流程卡死。"""

    def test_拦_节点指了不存在的角色(self):
        s = copy.deepcopy(GOOD)
        s["workflowNodes"][0]["assigneeRole"] = "ghost"
        assert validate_semantics(s)["passed"] is False

    def test_拦_转移指向不存在的节点(self):
        s = copy.deepcopy(GOOD)
        s["workflowTransitions"][0]["to"] = "nowhere"
        assert validate_semantics(s)["passed"] is False

    def test_拦_孤儿节点(self):
        s = copy.deepcopy(GOOD)
        s["workflowNodes"].append(
            {"id": "orphan", "name": "谁也到不了", "assigneeRole": "doctor"})
        assert "起点" in 失败原因(s) or "走不到" in 失败原因(s)

    def test_拦_多个起点(self):
        s = copy.deepcopy(GOOD)
        s["workflowNodes"].append(
            {"id": "another_start", "name": "第二个起点", "assigneeRole": "doctor"})
        assert "起点" in 失败原因(s)

    def test_拦_没有终态(self):
        # 纯环会先撞上"起点恰好一个"（全都有入边）。要单独验终态这一条，
        # 得构造成**有起点、但走下去进环**：booked → in_consult ⇄ closed
        s = copy.deepcopy(GOOD)
        s["workflowTransitions"].append({"from": "closed", "to": "in_consult"})
        assert "终态" in 失败原因(s)

    def test_拦_一个节点都没有(self):
        s = copy.deepcopy(GOOD)
        s["workflowNodes"] = []
        assert validate_semantics(s)["passed"] is False


class Test提示词把两侧都说清:
    def test_两个输入都在(self):
        user = build_prompt(STRUCTURE, SPEC)[-1]["content"]
        assert "前台接诊员" in user and "appointment" in user

    def test_开关能关掉一侧_给对照实验用(self):
        无spec = build_prompt(STRUCTURE, SPEC, with_spec=False)[-1]["content"]
        assert "前台接诊员" not in 无spec and "appointment" in 无spec
        无结构 = build_prompt(STRUCTURE, SPEC, with_structure=False)[-1]["content"]
        assert "前台接诊员" in 无结构 and '"entities"' not in 无结构

    def test_两个方向的要求都写进去了(self):
        user = build_prompt(STRUCTURE, SPEC)[-1]["content"]
        assert "personaRef 到 SPEC 里真实存在" in user
        assert "一个都不许漏" in user, "反向那条没写进提示词，光靠重问去撞是浪费调用"
        assert "恰好一个起点" in user and "至少一个终态" in user


class Test生成与重问:
    def test_一次就对(self):
        s = derive_semantics(STRUCTURE, SPEC, llm_json_fn=lambda _m: copy.deepcopy(GOOD))
        assert isinstance(s, SpecSemantics) and len(s.roles) == 2

    def test_先错后对_把校验器原话喂回去(self):
        bad = copy.deepcopy(GOOD)
        bad["roles"] = [bad["roles"][0]]
        bad["rolePermissions"].pop("doctor")
        bad["workflowNodes"][1]["assigneeRole"] = "reception"
        calls: list = []

        def fake(messages):
            calls.append(messages)
            return bad if len(calls) == 1 else copy.deepcopy(GOOD)

        derive_semantics(STRUCTURE, SPEC, llm_json_fn=fake)
        assert len(calls) == 2
        回喂 = calls[1][-1]["content"]
        assert "宠物医生" in 回喂
        assert "整个删掉" in 回喂, "指不到东西时该删，不是换名字硬凑"

    def test_一直错就抛_不回落(self):
        """编出来的权限比没有权限更危险。"""
        bad = copy.deepcopy(GOOD)
        bad["permissions"].append("ghost_entity:read")
        bad["rolePermissions"]["doctor"].append("ghost_entity:read")
        with pytest.raises(SpecSemanticsError) as exc:
            derive_semantics(STRUCTURE, SPEC, llm_json_fn=lambda _m: copy.deepcopy(bad))
        assert "ghost_entity" in str(exc.value)


class Test转成模型三段:
    def test_形状对得上结构闸(self):
        out = to_model_sections(SpecSemantics.model_validate(GOOD))
        assert set(out) == {"rbac", "workflow", "invariants"}
        assert out["rbac"]["roles"][0] == {"id": "reception", "name": "前台接诊员"}
        assert out["workflow"]["nodes"][0]["assigneeRole"] == "reception"
        assert out["workflow"]["transitions"][0]["from"] == "booked"

    def test_personaRef_不带进下游(self):
        """它是这一步的校验依据，不是 rbac 的一部分——带过去会污染结构闸。"""
        assert "personaRef" not in str(to_model_sections(SpecSemantics.model_validate(GOOD)))
