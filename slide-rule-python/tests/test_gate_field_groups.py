"""门禁：带标题的字段分组（`entityFieldGroups`）。

## 这个形状是干什么的

2026-08-09 批次 5/7 一起要的：

    SectionedForm.binding.sections    分段表单：每段一个业务标题 + 几个字段
    DataTable.binding.columnGroups    多级表头：每组一个标题 + 几列

值长这样：`[{"title": "仓库管理", "fieldRefs": ["name", "url"]}, ...]`

此前只有 `entityFieldRefLists`（一串平的字段 id），表达不了「这几个字段属于
同一段、这一段叫什么」。拿两个平行数组拼也不是不行，但长度一对不上就静默
错位——而错位的表现是标题挂到了别人头上，界面完全正常，没人看得出来。

## 这里钉的

**标题必须非空**是最要紧的一条。分段和分组的全部意义就是那个标题；标题空了，
屏幕上就是几组没名字的字段挤在一起，比不分组更糟——而且它不会报错。
"""

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_model_gate import validate_five_system_model

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def _model_with_block(binding: dict, block_type: str = "SectionedForm") -> dict:
    """拿一份真实模型，在第一页挂一个待测区块。

    不手搓最小模型——门禁在六段任一为空时会提前 return，手搓夹具很容易在走到
    区块校验之前就短路（test_gate_field_types 的文件头记了这个坑）。
    """
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    model = copy.deepcopy(next(iter(models.values())))
    page = model["page"]["pages"][0]
    page["blocks"] = [
        {"id": "b1", "type": block_type, "props": {}, "binding": binding}
    ]
    return model


def _findings(binding: dict, block_type: str = "SectionedForm") -> list[dict]:
    """门禁返回的是 `{'passed': bool, 'findings': [...]}`，不是裸列表。"""
    result = validate_five_system_model(_model_with_block(binding, block_type))
    return list(result.get("findings", []))


def _paths(binding: dict, block_type: str = "SectionedForm") -> list[str]:
    return [str(f.get("path", "")) for f in _findings(binding, block_type)]


ENTITY = "purchase_order"
GOOD = {
    "entityRef": ENTITY,
    "sections": [
        {"title": "基本信息", "fieldRefs": ["order_no", "requester"]},
        {"title": "采购内容", "fieldRefs": ["supplier_id", "total_amount"]},
    ],
}


def test_a_well_formed_grouping_passes():
    """先钉住"对的能过"——只会说不的门禁等于把这个形状关掉。"""
    assert [p for p in _paths(GOOD) if "sections" in p] == []


def test_empty_group_title_is_rejected():
    """**这条是这个形状存在的理由。**

    标题空了，界面上就是几组没名字的字段挤在一起——比不分组更糟，而且不报错。
    """
    bad = copy.deepcopy(GOOD)
    bad["sections"][0]["title"] = "   "
    assert any(".sections[0].title" in p for p in _paths(bad))


def test_a_field_not_on_the_entity_is_rejected():
    """分组里的字段跟别的绑定一样要落在同一个实体上，不能凭空编。"""
    bad = copy.deepcopy(GOOD)
    bad["sections"][1]["fieldRefs"] = ["not_a_real_field"]
    assert any(".sections[1].fieldRefs" in p for p in _paths(bad))


def test_empty_field_list_is_rejected():
    """一个只有标题、没有字段的段，在屏幕上就是一个空盒子。"""
    bad = copy.deepcopy(GOOD)
    bad["sections"][0]["fieldRefs"] = []
    assert any(".sections[0].fieldRefs" in p for p in _paths(bad))


def test_non_array_and_non_object_shapes_are_rejected():
    """模型偶尔会把它写成字符串或对象。两种都得拦——渲染端只画声明得清楚的。"""
    assert any(".sections" in p for p in _paths({**GOOD, "sections": "基本信息"}))
    assert any(".sections[0]" in p for p in _paths({**GOOD, "sections": ["基本信息"]}))


def test_group_count_and_size_caps_are_enforced():
    """上限来自目录（SectionedForm 是 6 段 × 每段 12 个字段）。

    不是为了整齐——一屏放不下的分段就失去了"分段好找"的意义。
    """
    many = {**GOOD, "sections": [
        {"title": f"第{i}段", "fieldRefs": ["order_no"]} for i in range(8)
    ]}
    assert any(".sections" in p for p in _paths(many))


def test_datatable_column_groups_share_the_same_rule():
    """一个形状服务两处：批次 7 的多级表头走的是同一条校验。

    钉住这件事，免得日后有人给 columnGroups 另写一份——两份迟早分叉。
    """
    paths = _paths(
        {"entityRef": ENTITY, "columnGroups": [{"title": "", "fieldRefs": ["order_no"]}]},
        block_type="DataTable",
    )
    assert any(".columnGroups[0].title" in p for p in paths)
