"""第 6 步：汇合成完整五系统模型并过闸（2026-08-13）。

## 这份用例最要紧的一条

**「结构闸 passed=True」证明不了绑定做没做。** 实测：把前五步的产物机械拼成
六段、绑定层全部留空，`validate_five_system_model` 依然 `passed=True,
findings=0`——它查的是"引用有没有悬空"，而空数组里没有引用，自然没有悬空。

所以这一步必须有自己的判据（check_bindings_closed），而且它守的正是结构闸
**不管**的那两件事：

  · 有页面一个绑定都没有  → 那一页在界面上是空的
  · aigc 的 outputField 出现在 inputFields 里 → 拿一个字段算它自己

这跟今天反复出现的是同一个形状：**闸全绿、东西没做**。
"""

from __future__ import annotations

import copy

import pytest

from services.model_assembly import (
    ModelAssemblyError,
    apply_bindings,
    assemble,
    assemble_mechanical,
    build_binding_prompt,
    check_bindings_closed,
    ensure_wizard_workflow_refs,
)
from services.v5_model_gate import validate_five_system_model

SPEC = {
    "appName": "车易盈",
    "personas": [{"id": "u1", "name": "门店经理", "goals": []},
                 {"id": "u2", "name": "销售顾问", "goals": []}],
}

STRUCTURE = {
    "version": "html-structure-v1",
    "entities": [
        {"id": "vehicle", "name": "车辆", "evidence": "车辆",
         "fields": [{"id": "plate", "name": "车牌", "type": "string", "evidence": "车牌"},
                    {"id": "price", "name": "评估价", "type": "number", "evidence": "评估价"},
                    {"id": "ai_note", "name": "AI 备注", "type": "text", "evidence": "AI 备注"}]},
        {"id": "store", "name": "门店", "evidence": "门店",
         "fields": [{"id": "store_name", "name": "门店名", "type": "string", "evidence": "门店名"}]},
    ],
    "pages": [
        {"id": "p1", "name": "收车评估", "kind": "workbench", "sourcePageId": "p1",
         "sections": ["车辆列表"], "evidence": "收车评估"},
        {"id": "p2", "name": "库存经营", "kind": "dashboard", "sourcePageId": "p2",
         "sections": ["库存趋势"], "evidence": "库存经营"},
    ],
}

SEMANTICS = {
    "version": "spec-semantics-v1",
    "roles": [{"id": "manager", "name": "门店经理", "personaRef": "u1"},
              {"id": "sales", "name": "销售顾问", "personaRef": "u2"}],
    "permissions": ["vehicle:create", "vehicle:read", "store:read"],
    "rolePermissions": {"manager": ["vehicle:read"], "sales": ["vehicle:create"]},
    "workflowNodes": [
        {"id": "received", "name": "已收车", "assigneeRole": "manager", "phase": "收车"},
        {"id": "listed", "name": "已上架", "assigneeRole": "sales", "phase": "销售"},
    ],
    "workflowTransitions": [{"from": "received", "to": "listed", "condition": "整备完成"}],
    "invariants": [{"id": "vehicle_store", "statement": "车辆必须归属门店。",
                    "systems": ["datamodel"], "refs": ["vehicle", "store"]}],
}

BINDINGS = {
    "pageBindings": [
        {"pageId": "p1", "fieldBindings": ["vehicle.plate", "vehicle.price"],
         "actionPermissions": ["vehicle:create"]},
        {"pageId": "p2", "fieldBindings": ["store.store_name"],
         "actionPermissions": ["store:read"]},
    ],
    "menus": [{"id": "m1", "label": "收车", "roleRefs": ["manager"],
               "permissionRefs": ["vehicle:read"]}],
    "aigcCapabilities": [{"id": "price_hint", "name": "评估价建议",
                          "inputFields": ["vehicle.plate"], "outputField": "vehicle.ai_note",
                          "roleRefs": ["manager"]}],
    "workflowPageBindings": [{"pageRef": "p1", "workflowRef": "received"},
                             {"pageRef": "p2", "workflowRef": "main_flow"}],
}


def 全套() -> dict:
    return apply_bindings(assemble_mechanical(STRUCTURE, SEMANTICS, SPEC), BINDINGS)


class Test过结构闸不等于做完了:
    """本文件的核心。别删这一条——它是这一步存在的理由。"""

    def test_绑定全空时结构闸照样放行(self):
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        gate = validate_five_system_model(
            skeleton, require_landing_page_ref=True, require_preferred_device=True)
        assert gate["passed"] is True, (
            "如果这条红了说明结构闸变严了——那是好事，"
            "但要回来重新评估本步的自有判据还需不需要"
        )

    def test_本步自己的闸能拦住(self):
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        probs = check_bindings_closed(skeleton)
        assert len(probs) == 2, "两个页面都该被点名"
        assert all("界面上会是空的" in p["message"] for p in probs)

    def test_补完绑定后两道闸都过(self):
        model = 全套()
        assert check_bindings_closed(model) == []
        assert validate_five_system_model(
            model, require_landing_page_ref=True, require_preferred_device=True)["passed"]


class Test机械段_零_LLM_纯搬运:
    def test_六段齐全(self):
        m = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert set(m) == {"datamodel", "rbac", "workflow", "page", "aigc", "appbundle"}

    def test_搬运不丢东西(self):
        m = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert len(m["datamodel"]["entities"]) == 2
        assert len(m["rbac"]["roles"]) == 2 and len(m["rbac"]["permissions"]) == 3
        assert len(m["workflow"]["nodes"]) == 2
        assert len(m["page"]["pages"]) == 2
        assert len(m["appbundle"]["invariants"]) == 1

    def test_appbundle_的引用是派生的_不是编的(self):
        m = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert m["appbundle"]["roleRefs"] == ["manager", "sales"]
        assert m["appbundle"]["dataModelRefs"] == ["vehicle", "store"]
        assert m["appbundle"]["landingPageRef"] == "p1"
        assert m["appbundle"]["appIdentity"]["appName"] == "车易盈"

    def test_personaRef_不带进模型(self):
        """它是第 5 步的校验依据，不是 rbac 的一部分。"""
        assert "personaRef" not in str(assemble_mechanical(STRUCTURE, SEMANTICS, SPEC))

    def test_零_LLM(self):
        import ast
        import inspect

        import services.model_assembly as mod

        src = inspect.getsource(mod.assemble_mechanical)
        assert "call_llm" not in src and "llm_json" not in src
        # 判据钉在真实语句上：AST 里没有注释，所以注释里提到 call_llm 不算数
        ast.parse(inspect.getsource(mod))


class Test绑定层的词汇表是封闭的:
    def test_拦_字段是编的(self):
        m = 全套()
        m["page"]["pages"][0]["fieldBindings"] = ["vehicle.不存在"]
        assert "不是真实字段" in str(check_bindings_closed(m))

    def test_拦_权限是编的(self):
        m = 全套()
        m["page"]["pages"][0]["actionPermissions"] = ["vehicle:destroy"]
        assert "不在权限清单里" in str(check_bindings_closed(m))

    def test_拦_菜单指了不存在的角色(self):
        m = 全套()
        m["rbac"]["menus"][0]["roleRefs"] = ["ghost"]
        assert "不是已声明的角色" in str(check_bindings_closed(m))

    def test_拦_aigc_字段是编的(self):
        m = 全套()
        m["aigc"]["capabilities"][0]["outputField"] = "vehicle.幻觉字段"
        assert "不是真实字段" in str(check_bindings_closed(m))

    def test_拦_aigc_自己算自己(self):
        """outputField 出现在 inputFields 里 = 拿一个字段算它自己，是句废话。

        结构闸不查这一条（两边都是合法字段引用，没有悬空）。
        """
        m = 全套()
        m["aigc"]["capabilities"][0]["inputFields"] = ["vehicle.ai_note"]
        assert "算它自己" in str(check_bindings_closed(m))
        # 确认结构闸确实放行——这就是本步判据存在的理由
        assert validate_five_system_model(m)["passed"] is True

    def test_拦_pageBindings_指了不存在的页(self):
        m = 全套()
        m["appbundle"]["pageBindings"][0]["pageRef"] = "p99"
        assert "不是已有页面" in str(check_bindings_closed(m))

    def test_拦_workflowRef_不是节点(self):
        m = 全套()
        m["appbundle"]["pageBindings"][0]["workflowRef"] = "随便编的"
        assert "不是工作流节点" in str(check_bindings_closed(m))

    def test_main_flow_是合法的_workflowRef(self):
        m = 全套()
        m["appbundle"]["pageBindings"][0]["workflowRef"] = "main_flow"
        assert check_bindings_closed(m) == []


class Test提示词:
    def test_把词汇表全摊开(self):
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        user = build_binding_prompt(skeleton)[-1]["content"]
        for token in ("vehicle.plate", "vehicle:create", "manager", "received", "p1"):
            assert token in user
        assert "一个都不许新造" in user

    def test_闸的裁决原文回喂_不自己另写话术(self):
        """照 E37 那条既有做法：闸报什么就回喂什么。"""
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        user = build_binding_prompt(skeleton, "page.pages[p1]：这一页在界面上会是空的")[-1]["content"]
        assert "这一页在界面上会是空的" in user
        assert "只改这些地方" in user

    def test_说清挑不到就留空_不要造(self):
        user = build_binding_prompt(assemble_mechanical(STRUCTURE, SEMANTICS, SPEC))[-1]["content"]
        assert "不要造一个看着像的" in user


class Test汇合与重问:
    def test_一次就对(self):
        r = assemble(STRUCTURE, SEMANTICS, SPEC,
                     llm_json_fn=lambda _m: copy.deepcopy(BINDINGS))
        assert r["gate"]["passed"] is True
        assert len(r["model"]["page"]["pages"][0]["fieldBindings"]) == 2

    def test_先错后对_把闸的原话喂回去(self):
        bad = copy.deepcopy(BINDINGS)
        bad["pageBindings"][1]["fieldBindings"] = ["store.不存在"]
        calls: list = []

        def fake(messages):
            calls.append(messages)
            return bad if len(calls) == 1 else copy.deepcopy(BINDINGS)

        assemble(STRUCTURE, SEMANTICS, SPEC, llm_json_fn=fake)
        assert len(calls) == 2
        assert "store.不存在" in calls[1][-1]["content"]

    def test_一直错就抛_不回落(self):
        """过不了闸的模型往下走，只会在更远的地方炸。"""
        bad = copy.deepcopy(BINDINGS)
        bad["pageBindings"] = [bad["pageBindings"][0]]  # p2 没绑定
        with pytest.raises(ModelAssemblyError) as exc:
            assemble(STRUCTURE, SEMANTICS, SPEC, llm_json_fn=lambda _m: copy.deepcopy(bad))
        assert "p2" in str(exc.value)

    def test_LLM_没产出也抛(self):
        with pytest.raises(ModelAssemblyError):
            assemble(STRUCTURE, SEMANTICS, SPEC, llm_json_fn=lambda _m: None)


class Test向导workflowRef机械补:
    """对照 rustc --fix：闸认得的洞先机械补，再问模型。"""

    def _wizard_structure(self):
        st = copy.deepcopy(STRUCTURE)
        st["pages"].append({
            "id": "p3", "name": "登记向导", "kind": "wizard",
            "sourcePageId": "p3", "sections": ["步骤"], "evidence": "向导",
        })
        return st

    def _wizard_bindings(self, *, with_ref: bool):
        b = copy.deepcopy(BINDINGS)
        b["pageBindings"].append({
            "pageId": "p3",
            "fieldBindings": ["vehicle.plate"],
            "actionPermissions": ["vehicle:create"],
        })
        if with_ref:
            b["workflowPageBindings"].append(
                {"pageRef": "p3", "workflowRef": "main_flow"}
            )
        return b

    def test_漏写向导绑定_一次过闸不重问(self):
        calls: list = []

        def fake(messages):
            calls.append(messages)
            return self._wizard_bindings(with_ref=False)

        r = assemble(
            self._wizard_structure(), SEMANTICS, SPEC, llm_json_fn=fake
        )
        assert len(calls) == 1, "机械补得了还去重问——活路径又绕回模型"
        assert r["gate"]["passed"] is True
        bound = {
            str(pb.get("pageRef")): str(pb.get("workflowRef") or "")
            for pb in r["model"]["appbundle"]["pageBindings"]
        }
        assert bound.get("p3") == "main_flow"

    def test_两个流程没有_main_flow_不猜(self):
        m = {
            "workflow": {
                "id": "intake",
                "nodes": [{"id": "n1", "name": "收"}],
                "chains": [{"id": "billing", "nodes": [{"id": "n2", "name": "结"}]}],
            },
            "page": {"pages": [{"id": "p3", "kind": "wizard", "name": "向导"}]},
            "appbundle": {"pageBindings": []},
        }
        assert ensure_wizard_workflow_refs(m) == []
        assert m["appbundle"]["pageBindings"] == []

    def test_接线在闸前面(self):
        """函数写对了 ≠ 接在 assemble 循环上。钉调用点。"""
        import inspect
        from services.model_assembly import assemble as _assemble

        src = inspect.getsource(_assemble)
        assert src.index("ensure_wizard_workflow_refs(model)") < src.index(
            "gate = validate_five_system_model"
        )


class Test产物不许跟输入共享对象:
    """写上面那些用例时当场撞到的：`apply_bindings` 头一版对绑定那几段只做了
    `list(...)`——外层列表复制了，**里面的 dict 还是调用方那几个对象**。

    一个用例改了 aigc 的 inputFields，后面所有用例跟着坏，而坏因完全看不出来。
    真实链路上更糟：这一步的产物要交给下游设计段，中途被别处改掉是最难查的
    一类问题。
    """

    def test_改了输入_产物不跟着变(self):
        b = copy.deepcopy(BINDINGS)
        model = apply_bindings(assemble_mechanical(STRUCTURE, SEMANTICS, SPEC), b)
        b["aigcCapabilities"][0]["inputFields"] = ["vehicle.ai_note"]
        b["pageBindings"][0]["fieldBindings"].append("vehicle.幻觉")
        b["menus"][0]["roleRefs"] = ["ghost"]
        assert model["aigc"]["capabilities"][0]["inputFields"] == ["vehicle.plate"]
        assert "vehicle.幻觉" not in model["page"]["pages"][0]["fieldBindings"]
        assert model["rbac"]["menus"][0]["roleRefs"] == ["manager"]
        assert check_bindings_closed(model) == []

    def test_改了产物_输入不跟着变(self):
        b = copy.deepcopy(BINDINGS)
        model = apply_bindings(assemble_mechanical(STRUCTURE, SEMANTICS, SPEC), b)
        model["rbac"]["menus"][0]["label"] = "被改了"
        assert b["menus"][0]["label"] == "收车"
