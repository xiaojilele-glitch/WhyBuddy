# -*- coding: utf-8 -*-
"""角色的显示名（2026-08-05）。

## 改之前

模型里所有概念都是 id + 中文名配对——实体 `{id, name}`、字段 `{id, name}`、
菜单 `{id, label}`、页面 `{id, name}`、流程节点 `{id, name}`。**只有角色是一根
光杆字符串**：

    "roles": ["warehouse_keeper", "store_clerk", ...]

于是运行应用的角色下拉、流程条上的负责人、RBAC 屏，显示的全是
`warehouse_keeper`。前端那层"引用 → 显示名"的解析器把这件事暴露得最清楚：
`resolveEntityRef` 能吐 `entity.name || entity.id`，而 `resolveRoleRef` 只能把
id 原样吐回去——**label 那个位置一直留着，只是角色没有名字可填**。

所以补的不是翻译，是模型里本来就缺的那半个字段。

## 为什么 id 不能直接写成中文

id 同时是 roleRefs / assigneeRole / aigc.roleRefs / appbundle.roleRef 的引用键，
还会被投影成生成代码里的常量、存进 localStorage。把标识符和显示名合成一个，
以后想改名就会连引用一起断。
"""

import pytest

from services.rbac_roles import role_entries, role_ids, role_labels


# ── 两种写法都得吃 ──────────────────────────────────────────────


def test_object_form_carries_the_label():
    rbac = {"roles": [{"id": "warehouse_keeper", "name": "仓库管理员"}]}
    assert role_ids(rbac) == ["warehouse_keeper"]
    assert role_labels(rbac) == {"warehouse_keeper": "仓库管理员"}


def test_legacy_string_form_still_works():
    """内置夹具和线上库里已有的应用全是字符串，一条都不迁移。

    它们数据里就没有中文名，迁移只能瞎编。
    """
    rbac = {"roles": ["requester", "manager"]}
    assert role_ids(rbac) == ["requester", "manager"]
    assert role_labels(rbac) == {"requester": "requester", "manager": "manager"}


def test_mixed_shapes_in_one_model():
    """半路改过的模型也得能读——不能因为混着写就整段作废。"""
    rbac = {"roles": ["legacy_role", {"id": "new_role", "name": "新角色"}]}
    assert role_ids(rbac) == ["legacy_role", "new_role"]
    assert role_labels(rbac)["new_role"] == "新角色"


def test_label_falls_back_to_id_never_blank():
    """显示英文总好过显示空白，而且一眼看得出这是补字段之前生成的。"""
    for rbac in (
        {"roles": [{"id": "ops"}]},
        {"roles": [{"id": "ops", "name": ""}]},
        {"roles": [{"id": "ops", "name": "   "}]},
    ):
        assert role_labels(rbac) == {"ops": "ops"}


@pytest.mark.parametrize("junk", [None, {}, {"roles": None}, {"roles": "not-a-list"},
                                  {"roles": [None, 42, [], ""]}])
def test_garbage_in_does_not_raise(junk):
    """模型是 LLM 生成的，形状不可信。读坏数据不能把整条链路带崩。"""
    assert role_entries(junk) == []


def test_duplicate_ids_collapse():
    rbac = {"roles": ["a", {"id": "a", "name": "甲"}, "a"]}
    assert role_ids(rbac) == ["a"]


def test_name_only_object_uses_name_as_id():
    """闸门历史上就接受 `{"name": ...}` 当 id，别改这个语义。"""
    assert role_ids({"roles": [{"name": "approver"}]}) == ["approver"]


# ── 下游必须跟着换，否则是静默失效 ──────────────────────────────


def test_the_gate_accepts_object_roles():
    """闸门早就收对象形态；这条钉住它别退化。"""
    from services.v5_model_gate import _collect_role_ids

    assert _collect_role_ids({"roles": [{"id": "r1", "name": "角色一"}]}) == {"r1"}
    assert _collect_role_ids({"roles": ["r1"]}) == {"r1"}


def test_content_quality_does_not_silently_drop_object_roles():
    """这处是地雷：原来写的是 `if isinstance(r, str)`。

    角色一变对象就**静默过滤成零个角色**，下面每条质量检查跟着失效，
    而且一个 finding 都不报——看起来像"全都合格"。
    """
    from services.v5_content_quality import _role_permissions

    model = {
        "rbac": {
            "roles": [{"id": "approver", "name": "审批人"}],
            "menus": [{"id": "m1", "roleRefs": ["approver"], "permissionRefs": ["x:view"]}],
        }
    }
    grants = _role_permissions(model)
    assert grants == {"approver": {"x:view"}}, "对象形态的角色被吃掉了"


def test_closure_summary_prints_names_not_dict_reprs():
    """收口摘要那行是给人看的。直接 str(r) 会把整个 dict 打进去，
    用户看到的是 "角色权限：1 角色（{'id': 'warehouse_keeper', ...}）"。"""
    from services.v5_closure_summary import _model_stats_lines

    text = "\n".join(_model_stats_lines({
        "perSkillEvidence": {
            "rbac": {"modelSection": {
                "roles": [{"id": "warehouse_keeper", "name": "仓库管理员"}],
                "permissions": ["stock:view"],
            }},
        }
    }))
    assert "仓库管理员" in text
    assert "{" not in text and "warehouse_keeper" not in text


def test_judge_projection_pairs_id_and_name():
    """评委看到的该是"这个角色是干什么的"，不是一段 JSON 噪音。"""
    import json

    from services.v5_llm_judge import _digest_model

    out = json.loads(_digest_model({"rbac": {"roles": [
        {"id": "warehouse_keeper", "name": "仓库管理员"},
        "legacy_role",
    ]}}))
    assert out["roles"] == ["warehouse_keeper:仓库管理员", "legacy_role"]


# ── 提示词得真的要求中文名 ──────────────────────────────────────


def test_prompt_asks_for_id_plus_display_name():
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert '"roles": [{"id": "<snake_case>", "name": "<label>"}, ...]' in _SCHEMA_INSTRUCTION
    # 必须说清 id 是引用键、name 跟随用户语言，否则模型会把中文塞进 id
    assert "rbac.roles[].id is the reference key" in _SCHEMA_INSTRUCTION
    assert "SAME LANGUAGE as the user's intent" in _SCHEMA_INSTRUCTION
