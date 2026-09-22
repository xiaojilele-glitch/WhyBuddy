"""reask 的建议要按**这次真正报的错**给，不是每次念一遍全部老经验。

## 这条防的是一次 192 秒的失败

2026-08-04 真机：一次首页设计连挂三轮、烧掉 192 秒，最后降级回固定骨架。
三轮报的都是同一句——

    root.children.2.children.1.rowsRef
      Value error, rowsRef.fieldRefs 不能为空

错误本身回喂得没问题。问题出在紧跟着那段**固定**的"请仔细检查"：它整段讲的是
children 形状、tag/style 白名单、以及 dataRef 的 key 名怎么写，**一个字都没提
rowsRef**。模型拿到一句正确的报错，后面跟着一大段把它往 dataRef 上引的建议，
三轮都没改对。

那段话本身没错，是 dataRef 时代攒下来的真经验；错在无差别播放。提示词里每多
一句无关的话，真正相关的那句就被冲淡一分——跟出图那边"一长串禁令把'画满'那句
冲掉"是同一个毛病。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import _reask_hint, _rows_prompt_fragment  # noqa: E402

REAL_ERROR = (
    "1 validation error for FreeformDesign\n"
    "root.children.2.children.1.rowsRef\n"
    "  Value error, rowsRef.fieldRefs 不能为空——必须先声明这一行要显示哪些字段"
)


def test_the_real_failure_gets_rowsref_advice_not_dataref_lore():
    hint = _reask_hint(REAL_ERROR)
    assert "fieldRefs" in hint
    assert "必填" in hint
    # 关键是**不要**再把它往 dataRef 上引——那正是这次三轮没改对的原因
    assert "trendGrain" not in hint
    assert "entity / field" not in hint


def test_rowsref_advice_offers_deleting_the_node_as_a_way_out():
    """给一条"删掉它"的出路。

    这一页本来就不需要逐行列表时，逼它补一个凑数的字段清单，会得到一个跟业务
    无关的列表——比没有更差。
    """
    assert "删掉" in _reask_hint(REAL_ERROR)


def test_each_error_family_gets_its_own_advice():
    assert "dataRef" in _reask_hint("dataRef Field required")
    assert "metricFieldId" in _reask_hint("chart.type invalid")
    assert "白名单" in _reask_hint("tag 'marquee' not allowed")


def test_unknown_errors_fall_back_to_the_generic_checklist():
    """认不出来才发通用清单——**不是每次都发通用清单再附一条**，那等于没分诊。"""
    generic = _reask_hint("some brand new failure nobody has seen")
    assert "children" in generic
    # 通用清单不该混进任何一族的专属建议
    assert "trendGrain" not in generic and "fieldRefs" not in generic


def test_advice_families_do_not_bleed_into_each_other():
    """分诊要互斥：dataRef 的错不该拿到 rowsRef 的建议，反之亦然。"""
    assert "fieldRefs" not in _reask_hint("dataRef Field required")


def test_prompt_states_fieldrefs_is_required_not_just_related():
    """提示词要直说"必填"。

    原文只写了 fieldRef 与 fieldRefs 的**关系**（"fieldRef 只能取声明过的"），
    从关系描述推不出"这个字段不能省"——模型写了 entityRef/limit 就以为齐了。
    """
    frag = _rows_prompt_fragment()
    assert "fieldRefs 必填" in frag
    assert "空数组" in frag
