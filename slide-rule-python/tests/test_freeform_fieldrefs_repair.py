"""机械补 rowsRef.fieldRefs（2026-08-07）。

`rowsRef.fieldRefs 不能为空` 是首页设计这条链路上最顽固的失败：
2026-08-04 真机连挂三轮、烧 192 秒降级；加了分诊式 reask 提示之后，
2026-08-07 又原样复现一次，三轮全挂在同一句，整页退回固定骨架。

模型每次都写了 entityRef/sortByRef/limit，模板里 fieldRef 一个不少，
就是不肯把字段清单再抄一遍到 fieldRefs 里。既然模板里写全了，
它的意图就没有歧义——这是形式错，不是语义错，机械誊一遍即可，
跟 json-repair 补括号同一类。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import _repair_missing_field_refs  # noqa: E402


def test_fills_from_template_field_refs():
    root = {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "house", "order": "desc", "limit": 8},
                "children": [
                    {
                        "tag": "div",
                        "children": [
                            {"tag": "span", "fieldRef": "name"},
                            {"tag": "span", "fieldRef": "temp"},
                        ],
                    }
                ],
            }
        ],
    }
    assert _repair_missing_field_refs(root) == 1
    assert root["children"][0]["rowsRef"]["fieldRefs"] == ["name", "temp"]


def test_keeps_first_seen_order_and_dedupes():
    """顺序按模板里出现的先后——那就是模型想要的列序；重复的只留一次。"""
    root = {
        "tag": "div",
        "rowsRef": {"entityRef": "e"},
        "children": [
            {
                "tag": "div",
                "children": [
                    {"tag": "span", "fieldRef": "b"},
                    {"tag": "span", "fieldRef": "a"},
                    {"tag": "span", "fieldRef": "b"},
                ],
            }
        ],
    }
    _repair_missing_field_refs(root)
    assert root["rowsRef"]["fieldRefs"] == ["b", "a"]


def test_does_not_touch_explicit_field_refs():
    """已经写了非空 fieldRefs 的是模型的显式选择（可能比模板里多，留给 sortByRef）。"""
    root = {
        "tag": "div",
        "rowsRef": {"entityRef": "e", "fieldRefs": ["a", "b", "c"]},
        "children": [{"tag": "span", "fieldRef": "a"}],
    }
    assert _repair_missing_field_refs(root) == 0
    assert root["rowsRef"]["fieldRefs"] == ["a", "b", "c"]


def test_nested_rows_ref_fields_do_not_leak_upward():
    """嵌套列表有自己的字段域——把内层的 fieldRef 收上来会拿 B 实体的字段
    去声明 A 实体的行，校验器会当场拒收，等于把一个错换成另一个错。"""
    root = {
        "tag": "div",
        "rowsRef": {"entityRef": "outer"},
        "children": [
            {
                "tag": "div",
                "children": [
                    {"tag": "span", "fieldRef": "outer_a"},
                    {
                        "tag": "div",
                        "rowsRef": {"entityRef": "inner"},
                        "children": [{"tag": "span", "fieldRef": "inner_x"}],
                    },
                ],
            }
        ],
    }
    _repair_missing_field_refs(root)
    assert root["rowsRef"]["fieldRefs"] == ["outer_a"]
    inner = root["children"][0]["children"][1]
    assert inner["rowsRef"]["fieldRefs"] == ["inner_x"]


def test_no_field_ref_in_template_leaves_it_alone():
    """模板里一个 fieldRef 都没有 → 无从推断，原样交给校验器照旧报错、照旧 reask。

    这是这次修复的边界：只在意图明确时代劳，绝不替模型编字段。
    """
    root = {
        "tag": "div",
        "rowsRef": {"entityRef": "e"},
        "children": [{"tag": "div", "children": [{"tag": "span", "text": "写死的字"}]}],
    }
    assert _repair_missing_field_refs(root) == 0
    assert "fieldRefs" not in root["rowsRef"]


def test_repairs_several_lists_in_one_tree():
    root = {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "a"},
                "children": [{"tag": "span", "fieldRef": "a1"}],
            },
            {
                "tag": "div",
                "rowsRef": {"entityRef": "b"},
                "children": [{"tag": "span", "fieldRef": "b1"}],
            },
        ],
    }
    assert _repair_missing_field_refs(root) == 2


def test_tolerates_junk_shapes():
    """修复步骤自己绝不能炸——它跑在 reask 兜底之前，炸了就把兜底也顶掉了。"""
    for junk in (None, "x", 3, [], [1, "a"], {"children": "not-a-list"}):
        _repair_missing_field_refs(junk)
