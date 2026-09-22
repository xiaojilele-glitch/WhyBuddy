"""FreeformInsight JSON 机械修复（2026-07-30，任务 #9 复现结果）。

背景：总览生成偶发返回非法 JSON，此前只知道错误信息（"invalid JSON:
Expecting ',' delimiter"），docstring 里记录的旧诊断（14000 token 截断）
不能解释这次的样本——真机复现抓到一份真实坏输出（存在
tests/data/freeform_json_repair_case_real.txt）：结尾收得完整（不是话没
说完），但 {}/[] 各差 1、结尾多一个孤立句号，是模型在深层嵌套 JSON 里数
错了括号层数。

调研过 GitHub 上专门解决这个问题的成熟库（json-repair，PyPI 现役维护，
本仓已作为依赖引入），而不是自己写"数括号数、线性补全"式的修补——手搓的
版本容易把内容拼出语法合法但结构错位的树。这里锁住：真实复现样本能被
修复成结构正确、能通过我们严格 Pydantic 校验的内容；修不好的输入照旧
返回 None，落回原有 reask 流程，不引入新的失败模式。
"""

import json
import sys

import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import (
    _prune_non_dict_list_items,
    _repair_freeform_json_or_none,
    build_freeform_models,
)

_REAL_CASE_PATH = Path(__file__).resolve().parent / "data" / "freeform_json_repair_case_real.txt"

# 真实样本引用的实体/字段——从 tests/data/freeform_json_repair_case_real.txt
# 里实际出现的 entityRef/dimensionFieldId 反推的最小数据模型，只用来让
# build_freeform_models 能构造出匹配的 Pydantic 校验器，不代表完整业务模型。
_REAL_CASE_DATAMODEL = {
    "entities": [
        {
            "id": "member",
            "name": "会员",
            "fields": [
                {"id": "join_date", "name": "入会日期", "type": "date"},
                {"id": "last_visit_date", "name": "最近到店日期", "type": "date"},
            ],
        },
        {
            "id": "private_lesson",
            "name": "私教课",
            "fields": [
                {"id": "lesson_status", "name": "课程状态", "type": "enum", "options": ["scheduled", "done", "cancelled"]},
                {"id": "scheduled_date", "name": "排课日期", "type": "date"},
                {"id": "lesson_no", "name": "课程编号", "type": "string"},
                {"id": "duration_minutes", "name": "时长(分钟)", "type": "number"},
                {"id": "coach_note", "name": "教练备注", "type": "string"},
            ],
        },
        {
            "id": "lesson_package",
            "name": "课时包",
            "fields": [
                {"id": "used_lessons", "name": "已用课时", "type": "number"},
            ],
        },
        {
            "id": "membership_payment",
            "name": "会籍缴费",
            "fields": [
                {"id": "amount", "name": "金额", "type": "number"},
                {"id": "payment_date", "name": "缴费日期", "type": "date"},
            ],
        },
    ]
}


# 样本文件（tests/data/…）是真实抓取的产物，保持原样不动——它的价值就在于
# "这是模型真的吐出来过的东西"。它抓于 blockRef 通道删除（2026-08-03）之前，
# 第二行第三块当时是个 ActivityFeed 的 blockRef 节点；blockRef 字段现在已经
# 不在模型里，Pydantic 默认忽略未知字段，于是它被静默丢弃、那个节点渲染成一个
# 普通空容器。对这条用例没有影响：它验的是 **JSON 修复**（括号错位/孤立字符
# 之后结构还在不在），不是 blockRef 政策，所以第三块只断言"容器还在"。


def test_synthetic_extra_brace_repaired():
    """最小复现：children 数组里一个节点多了一个收尾 }，后面还接了个坏值。"""
    bad = (
        '{"root":{"tag":"div","children":['
        '{"tag":"span","text":"a"}},'
        '{"tag":"div","text":"b"}'
        "]}}."
    )
    with_pytest_raises_json_error(bad)
    repaired = _repair_freeform_json_or_none(bad)
    assert repaired == {
        "root": {
            "tag": "div",
            "children": [{"tag": "span", "text": "a"}, {"tag": "div", "text": "b"}],
        }
    }


def with_pytest_raises_json_error(text: str) -> None:
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return
    raise AssertionError("这条测试用例本该是非法 JSON，用来验证修复前确实解析不了")


def test_prune_non_dict_list_items_drops_junk_keeps_dicts():
    """json_repair 有时把多余的孤立字符/字符串当成"数组的一项"塞回来
    （真机复现：结尾的孤立句号变成了 children 数组里的字符串 "."）——
    这道清理只删非 dict 的数组项，不动任何看起来像合法节点的内容。"""
    payload = {
        "tag": "div",
        "children": [{"tag": "span", "text": "a"}, ".", {"tag": "div", "text": "b"}, 42, None],
    }
    cleaned = _prune_non_dict_list_items(payload)
    assert cleaned == {
        "tag": "div",
        "children": [{"tag": "span", "text": "a"}, {"tag": "div", "text": "b"}],
    }


def test_real_captured_failure_repairs_to_valid_schema():
    """真实复现样本（2026-07-30，健身房会话第 4 次尝试抓到）：修复后必须
    是结构正确、能通过我们严格 Pydantic 校验的内容——不只是"能 json.loads
    了"这么低的标准。"""
    raw = _REAL_CASE_PATH.read_text(encoding="utf-8")
    with_pytest_raises_json_error(raw)

    repaired = _repair_freeform_json_or_none(raw)
    assert repaired is not None, "真实样本应该能被 json-repair 修好"

    FreeformDesign = build_freeform_models(_REAL_CASE_DATAMODEL)
    design = FreeformDesign.model_validate(repaired)  # 校验不过会抛 ValidationError，测试直接失败

    # 结构性断言：4 张 KPI 卡 + 一行两个图表卡片（各自套一层 wrapper div）+
    # 一块逐行内容，这是模型原本想表达的内容（用脚本走树核对过实际结构）。
    root = design.root
    kpi_row, chart_row = root.children[0], root.children[1]
    assert len(kpi_row.children) == 4, "四张 KPI 卡不能被修复过程弄丢"

    def find_charts(node):
        found = []
        if node.chart:
            found.append(node.chart.type)
        for c in node.children or []:
            found.extend(find_charts(c))
        return found

    assert find_charts(chart_row) == ["line", "donut"], "两个图表的顺序/类型不能因为修复而错位"
    # 第二行原本是"两个图表 + 一块逐行内容"三块。逐行内容那块当年用的 blockRef
    # 已随通道删除（见文件头说明），但**容器本身**必须还在——修复过程弄丢一整块
    # 内容正是这条用例要防的事。
    assert len(chart_row.children) == 3, "第二行的三块内容不能被修复过程弄丢"


def test_garbage_input_returns_none_not_a_guess():
    """真正修不好的输入（比如压根不是 JSON 的自由文本）必须返回 None，
    照旧落回 reask——不能勉强凑出一个语义上瞎猜的结构。"""
    assert _repair_freeform_json_or_none("这不是 JSON，就是一段中文说明文字。") is None
    assert _repair_freeform_json_or_none("") is None


def test_valid_json_still_returns_it_unchanged():
    """已经合法的 JSON 走这条路径也不该被改样子（幂等，不引入副作用）。"""
    good = '{"tag":"div","text":"合法内容"}'
    assert _repair_freeform_json_or_none(good) == {"tag": "div", "text": "合法内容"}
