"""字段语义门禁测试（加厚 schema 一期）。

锁：enum options / field format / page stats 三类新声明"出现即校验、
缺省不罚"——老模型（无新字段）照常通过；非法声明被精确标红：
  - options 出现在非 enum 字段 / 空 options / option 无 id / id 重复 / tone 非法
  - format 与字段类型不匹配（number 才有 money/percent/…，string 才有 masked）
  - stats 的 entity 悬挂 / metric 非法 / sum·avg 引用悬挂 / format 非法
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_model_gate import validate_five_system_model, DANGLING, EMPTY_SECTION


def _base_model():
    """最小合法五系统模型（客户档案域），新语义字段全部就位。"""
    return {
        "datamodel": {
            "entities": [
                {"id": "customer", "name": "客户", "fields": [
                    {"id": "name", "name": "客户名称", "type": "string"},
                    {"id": "phone", "name": "联系电话", "type": "string", "format": "masked"},
                    {"id": "deal_amount", "name": "成交金额", "type": "number", "format": "money"},
                    {"id": "intent_score", "name": "意向评分", "type": "number", "format": "score"},
                    {"id": "status", "name": "跟进状态", "type": "enum", "options": [
                        {"id": "待跟进", "label": "待跟进", "tone": "warning"},
                        {"id": "跟进中", "label": "跟进中", "tone": "processing"},
                        {"id": "已成交", "label": "已成交", "tone": "success"},
                        {"id": "已流失", "label": "已流失", "tone": "danger"},
                    ]},
                ]},
            ]
        },
        "rbac": {
            "roles": ["sales", "manager"],
            "permissions": ["customer:create", "customer:view"],
            "menus": [
                {"id": "m_list", "label": "客户列表", "roleRefs": ["sales"],
                 "permissionRefs": ["customer:create", "customer:view"]},
            ],
        },
        "workflow": {
            "id": "wf_followup",
            "nodes": [
                {"id": "n_new", "name": "新建跟进", "assigneeRole": "sales"},
                {"id": "n_review", "name": "主管复核", "assigneeRole": "manager"},
            ],
            "transitions": [{"from": "n_new", "to": "n_review"}],
        },
        "page": {
            "pages": [
                {"id": "p_customers", "name": "客户管理",
                 "fieldBindings": ["customer.name", "customer.status", "customer.deal_amount"],
                 "actionPermissions": ["customer:create"],
                 "stats": [
                     {"id": "s_total", "name": "客户总数", "entity": "customer", "metric": "count"},
                     {"id": "s_amount", "name": "成交总额", "entity": "customer",
                      "metric": "sum:customer.deal_amount", "format": "money"},
                     {"id": "s_score", "name": "平均意向分", "entity": "customer",
                      "metric": "avg:customer.intent_score"},
                 ]},
            ]
        },
        "aigc": {
            "capabilities": [
                {"id": "c_summary", "name": "跟进摘要", "inputFields": ["customer.name"],
                 "outputField": "customer.status", "roleRefs": ["sales"]},
            ]
        },
        "appbundle": {
            "pageBindings": [{"pageRef": "p_customers", "workflowRef": "wf_followup"}],
            "roleRefs": ["sales", "manager"],
            "dataModelRefs": ["customer"],
        },
    }


def _findings_of(model):
    result = validate_five_system_model(model)
    return result["passed"], result["findings"]


def test_valid_semantics_pass() -> None:
    passed, findings = _findings_of(_base_model())
    assert passed is True, findings


def test_legacy_model_without_semantics_still_passes() -> None:
    """老模型零破坏：摘掉 options/format/stats 后照常通过。"""
    m = _base_model()
    for f in m["datamodel"]["entities"][0]["fields"]:
        f.pop("options", None)
        f.pop("format", None)
    m["page"]["pages"][0].pop("stats")
    passed, findings = _findings_of(m)
    assert passed is True, findings


def test_options_on_non_enum_blocked() -> None:
    m = _base_model()
    m["datamodel"]["entities"][0]["fields"][0]["options"] = [{"id": "x"}]
    passed, findings = _findings_of(m)
    assert passed is False
    assert any("non-enum" in f["message"] for f in findings)


def test_empty_options_and_bad_tone_blocked() -> None:
    m = _base_model()
    fields = m["datamodel"]["entities"][0]["fields"]
    fields[4]["options"] = []
    passed, findings = _findings_of(m)
    assert passed is False
    assert any(f["code"] == EMPTY_SECTION and "options" in f["path"] for f in findings)

    m2 = _base_model()
    m2["datamodel"]["entities"][0]["fields"][4]["options"][0]["tone"] = "rainbow"
    passed2, findings2 = _findings_of(m2)
    assert passed2 is False
    assert any(f["ref"] == "rainbow" and f["code"] == DANGLING for f in findings2)


def test_duplicate_and_unnamed_option_ids_blocked() -> None:
    m = _base_model()
    m["datamodel"]["entities"][0]["fields"][4]["options"] = [
        {"id": "待跟进"}, {"id": "待跟进"}, {"label": "无 id"},
    ]
    passed, findings = _findings_of(m)
    assert passed is False
    messages = " | ".join(f["message"] for f in findings)
    assert "duplicate enum option id" in messages
    assert "enum option has no id" in messages


def test_format_type_mismatch_blocked() -> None:
    # string 字段挂 number 格式
    m = _base_model()
    m["datamodel"]["entities"][0]["fields"][0]["format"] = "money"
    passed, findings = _findings_of(m)
    assert passed is False
    assert any("not valid for type 'string'" in f["message"] for f in findings)

    # number 字段挂 string 格式 / 未知格式
    m2 = _base_model()
    m2["datamodel"]["entities"][0]["fields"][2]["format"] = "masked"
    passed2, findings2 = _findings_of(m2)
    assert passed2 is False
    assert any(f["ref"] == "masked" for f in findings2)

    # enum 字段不允许任何 format
    m3 = _base_model()
    m3["datamodel"]["entities"][0]["fields"][4]["format"] = "money"
    passed3, _f3 = _findings_of(m3)
    assert passed3 is False


def test_stats_dangling_entity_and_metric_blocked() -> None:
    m = _base_model()
    m["page"]["pages"][0]["stats"] = [
        {"id": "s_bad_entity", "name": "坏实体", "entity": "ghost", "metric": "count"},
        {"id": "s_bad_sum", "name": "坏求和", "entity": "customer", "metric": "sum:customer.ghost_field"},
        {"id": "s_bad_metric", "name": "坏指标", "entity": "customer", "metric": "median"},
        {"id": "s_bad_fmt", "name": "坏格式", "entity": "customer", "metric": "count", "format": "hexdump"},
    ]
    passed, findings = _findings_of(m)
    assert passed is False
    refs = {f["ref"] for f in findings}
    assert {"ghost", "customer.ghost_field", "median", "hexdump"} <= refs
    # 路径精确到 stats 声明
    assert all("stats[" in f["path"] for f in findings)


def test_page_kind_valid_paradigms_pass() -> None:
    """二期页面范式：合法 kanban/calendar/dashboard 声明通过。"""
    m = _base_model()
    m["datamodel"]["entities"][0]["fields"].append(
        {"id": "next_follow_at", "name": "下次跟进日期", "type": "date"}
    )
    m["page"]["pages"][0]["kind"] = "kanban"
    m["page"]["pages"][0]["statusField"] = "customer.status"
    m["page"]["pages"].append({
        "id": "p_calendar", "name": "跟进日历", "kind": "calendar",
        "dateField": "customer.next_follow_at", "colorBy": "customer.status",
        "fieldBindings": ["customer.name"], "actionPermissions": ["customer:view"],
    })
    m["rbac"]["menus"][0]["permissionRefs"].append("customer:view")
    passed, findings = _findings_of(m)
    assert passed is True, findings


def test_page_kind_bad_kind_and_missing_bindings_blocked() -> None:
    # 未知 kind
    m = _base_model()
    m["page"]["pages"][0]["kind"] = "hologram"
    passed, findings = _findings_of(m)
    assert passed is False
    assert any(f["ref"] == "hologram" for f in findings)

    # kanban 缺 statusField
    m2 = _base_model()
    m2["page"]["pages"][0]["kind"] = "kanban"
    passed2, findings2 = _findings_of(m2)
    assert passed2 is False
    assert any("requires 'statusField'" in f["message"] for f in findings2)

    # calendar 的 dateField 指向非 date 字段
    m3 = _base_model()
    m3["page"]["pages"][0]["kind"] = "calendar"
    m3["page"]["pages"][0]["dateField"] = "customer.name"
    passed3, findings3 = _findings_of(m3)
    assert passed3 is False
    assert any("must be a date field" in f["message"] for f in findings3)

    # statusField 悬挂引用
    m4 = _base_model()
    m4["page"]["pages"][0]["kind"] = "kanban"
    m4["page"]["pages"][0]["statusField"] = "customer.ghost"
    passed4, findings4 = _findings_of(m4)
    assert passed4 is False
    assert any(f["ref"] == "customer.ghost" for f in findings4)


def test_page_kind_absent_is_legacy_safe() -> None:
    """kind 缺省 = workbench，老模型零破坏（一期基础模型即无 kind）。"""
    passed, findings = _findings_of(_base_model())
    assert passed is True, findings


def _model_with_ref(**field_extra):
    """在客户档案上挂一个指向 `owner`（销售员）的 ref 字段。"""
    m = _base_model()
    m["datamodel"]["entities"].append(
        {"id": "owner", "name": "负责人", "fields": [{"id": "name", "type": "string"}]}
    )
    m["datamodel"]["entities"][0]["fields"].append(
        {"id": "assigned_owner", "name": "负责人", "type": "ref", **field_extra}
    )
    return m


def test_ref_entity_valid_target_passes() -> None:
    """refEntity 指向真实实体 → 放行。"""
    passed, findings = _findings_of(_model_with_ref(refEntity="owner"))
    assert passed is True, findings


def test_ref_entity_absent_is_legacy_safe() -> None:
    """缺省不罚：契约加这个键之前生成的 ref 字段照常通过。

    反向兜底——这条要是没了，存量模型会成批被闸掉，而它们本来能跑
    （运行时保留了按字段名猜目标的兜底）。
    """
    passed, findings = _findings_of(_model_with_ref())
    assert passed is True, findings


def test_ref_entity_dangling_target_blocked() -> None:
    """悬空目标即拒——声明了却指向不存在的实体，前端拿不到候选行，
    关系字段会静默退化成纯文本输入框。"""
    passed, findings = _findings_of(_model_with_ref(refEntity="ghost_entity"))
    assert passed is False
    assert any(
        f["code"] == DANGLING and f["ref"] == "ghost_entity"
        and f["path"].endswith(".refEntity")
        for f in findings
    ), findings


def test_ref_entity_on_non_ref_field_blocked() -> None:
    """越位即拒：只有 type=ref 该带目标声明（跟 options 只许长在 enum 上同一口径）。"""
    m = _base_model()
    m["datamodel"]["entities"][0]["fields"][0]["refEntity"] = "customer"
    passed, findings = _findings_of(m)
    assert passed is False
    assert any("non-ref field" in f["message"] for f in findings), findings


def test_ref_entity_empty_blocked() -> None:
    """空串不算声明——写了键却没内容，比不写更容易被当成"已经声明过了"。"""
    passed, findings = _findings_of(_model_with_ref(refEntity="   "))
    assert passed is False
    assert any(
        f["code"] == EMPTY_SECTION and f["path"].endswith(".refEntity")
        for f in findings
    ), findings


def test_stats_avg_metric_valid() -> None:
    """avg 是 stats 独有指标（charts 只有 count/sum）——合法 avg 不误拦。"""
    m = _base_model()
    m["page"]["pages"][0]["stats"] = [
        {"id": "s", "name": "平均分", "entity": "customer", "metric": "avg:customer.intent_score"},
    ]
    passed, findings = _findings_of(m)
    assert passed is True, findings
