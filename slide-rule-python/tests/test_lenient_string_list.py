"""模型把「一串字符串」写歪的那几种形状：宽容到哪儿为止。

抄的标准答案：grok-build `xai-tool-types/src/serde_lenient.rs`

    //! Lenient deserializers for tool arguments whose wire shape models get
    //! wrong in predictable ways.
    //!
    //! String lists (e.g. `task_ids`) may arrive as a bare string or number
    //! instead of an array; see [`lenient_string_list_from_json`].

    /// - array of strings/numbers → each element as a string (`228` → `"228"`),
    /// - bare string or number → one-element list,
    /// - `null` → empty list.
    /// Booleans, objects, and nested arrays are rejected (`None`).

⚠ 要害是**裸字符串 → 单元素列表**，不是空列表。本仓原来在
  `spec_tree._sanitize_assumptions` 里写的是 `isinstance(x, list) else []`，
  模型把 alternatives 写成 "工号或扫码" 时那条备选被静静扔掉——伴随式澄清的
  卡退化成一句"知会一声"，用户想改都没得点（2026-08-27 审查真机验的）。

⚠ 宽容 ≠ 什么都收。bool / dict / 嵌套数组返回 None，交给调用方决定。
  收下 True 会让"true"作为一个备选摆到用户面前。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.structured import lenient_string_list  # noqa: E402


@pytest.mark.parametrize(
    "raw,want",
    [
        (["工号", "扫码"], ["工号", "扫码"]),
        (["a", 228], ["a", "228"]),          # 数字转字符串
        ([], []),
        (None, []),                          # 缺席 = 空清单，不是错
    ],
)
def test_认识的形状照单全收(raw, want):
    assert lenient_string_list(raw) == want


@pytest.mark.parametrize("raw,want", [("工号或扫码", ["工号或扫码"]), (228, ["228"])])
def test_裸的一个变成单元素列表(raw, want):
    """这一条是整件事的要害。丢掉它，用户就少了一个能点的选项。"""
    assert lenient_string_list(raw) == want


@pytest.mark.parametrize("raw", [True, False, {"a": 1}, [["x"]], ["ok", True], object()])
def test_认不出来的返回None_不硬凑(raw):
    """反向判据：宽容不是来者不拒。

    没有这一条，把函数写成"什么都 str() 一下"也全绿——那样 True 会变成
    "True"、dict 会变成 "{'a': 1}"，直接摆到用户面前当备选。
    """
    assert lenient_string_list(raw) is None


def test_bool必须在int之前判():
    """Python 里 isinstance(True, int) 是真——判序写反了 True 会变成 "True"。

    变异：把 `isinstance(v, bool)` 那两行删掉 → 本条红。
    """
    assert lenient_string_list([True]) is None
    assert lenient_string_list([1]) == ["1"]


def test_字符串不许被逐字符拆开():
    """老坑复检：str 是可迭代的，走 for 循环会拆成一个字一个选项。"""
    got = lenient_string_list("工号或扫码")
    assert got == ["工号或扫码"], f"被拆开了：{got}"


def test_接在假设清洗上_不是摆着好看():
    """通电：光有函数不算数，_sanitize_assumptions 得真的用它。

    变异：把那一行改回 `isinstance(raw_alts, list) else []` → 本条红。
    """
    from services.spec_tree import _sanitize_assumptions

    payload = {
        "assumptions": [
            {"id": "a1", "topic": "登录", "decision": "手机号", "alternatives": "工号或扫码"}
        ]
    }
    _sanitize_assumptions(payload)
    assert payload["assumptions"][0]["alternatives"] == ["工号或扫码"]
