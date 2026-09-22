"""精修模式下，提示词的**最后一句**不能要求"产出完整的"（2026-08-16 线上实测）。

## 这条防的是"我只想加点数据，它把整个应用换了"

真机证据 —— 会话 `sr-20260816113435`：用户在一个已生成的应用上发
「预警消息中心那一页的消息流是空的，给它加一些模拟数据」。产出的 mv-2：

    段        mv-1       mv-2
    datamodel fc60313c → 6eb6f420   变
    workflow  76557359 → cdddd0b0   变
    rbac      366cc2cd → 2432b741   变
    page      d2c7d851 → ad9eb444   变
    aigc      d920cb6c → 469e1b36   变
    appbundle c13b8311 → df50e2b8   变      ← 六段全变，一段没留

菜单从「守望地图首页 / 预警消息中心 / 拐杖参数配置页」变成
「监护实时看护舱 / 志愿者接单大厅 / 安全与硬件设置页」——
**用户提到的那一页直接不存在了。**

## 成因是提示词里两句话打架，而打架的那句在最后

    REFINE MODE … Keep every id/field not affected byte-identical.
                  If the instruction does not ask for any design change,
                  return the current model unchanged.
    ...
    Produce the complete SystemContract JSON now.      ← 默认收尾，最后一句

"产出完整的"和"原样返回"是矛盾的。LLM 对末尾指令权重最高，于是照最后那句干。

这跟 `build_design_system_prompt_block` 当初那个是同一个形状：约束被埋在中间，
后面的话把它盖掉。那次的修法是把契约挪到最后 + 写明"冲突时以这一节为准"。

## 判据为什么落在"最后一句"

不测"模型有没有听话"——那要真调 LLM 且结果不稳定。能确定性判的是**提示词本身
有没有自相矛盾**：精修时最后一句必须是"改这一处、别的别动"，不能是"产出完整的"。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import v5_llm_generate as gen  # noqa: E402


@pytest.fixture(autouse=True)
def _clean():
    gen.set_refine_context(None)
    yield
    gen.set_refine_context(None)


def _prompt(goal="给社区养老服务站做一套长者健康监测系统"):
    # 私有函数：提示词装配没有公开入口，判据只能打到这里（改名了这条会红，是好事）
    return gen._build_user_content(goal)


def _tail(text, n=400):
    return text[-n:]


def test_refine_prompt_does_not_end_by_asking_for_a_complete_rewrite():
    """精修时收尾那句不许再说"产出完整的"。这是主判据。"""
    gen.set_refine_context({"datamodel": {"entities": []}}, "消息流是空的，加些模拟数据")
    tail = _tail(_prompt()).lower()
    # ⚠ 判据打的是"produce"这个动词，不是某个具体句子。
    #   本条第一版写的是 `"Produce the complete" not in tail`——而默认收尾其实是
    #   "Produce the five-system JSON now."，不含 complete，断言直接打空：
    #   变异注入后它照样绿。判据要盯**语义**（还在要求"产出一份"），不是盯字面。
    assert "produce the" not in tail, (
        "精修提示词仍以「产出一份 JSON」收尾 —— 它会盖掉上面那句"
        "「原样返回、逐字节保持」，模型照最后一句干就是全量重写"
    )


def test_refine_prompt_ends_by_forbidding_unrelated_changes():
    """光是"不说产出完整的"不够，最后一句得**正面**约束住不许动别的。

    这是上面那条的反向判据：把收尾整句删掉同样能让上面那条绿，
    但那样末尾就没有约束了，等于把最强的位置浪费掉。
    """
    gen.set_refine_context({"datamodel": {"entities": []}}, "消息流是空的，加些模拟数据")
    tail = _tail(_prompt(), 700).lower()
    # ⚠ 契约在 2026-08-16 晚换过一次，判据跟着换（意图不变）。
    #
    #   旧契约：要整份模型，措辞是 "every other field byte-identical"
    #   新契约：要 Merge Patch（RFC 7386），"省略即保持"是**结构保证**，
    #           不再需要那句措辞——省略的键根本没机会被改
    #
    # 所以这里断言的是新契约的等价约束：说清"只给要改的键"且"省略的自动保持"。
    # 直接删掉这条测试是错的：末尾这个最强位置必须**正面**约束住范围，
    # 否则等于把它浪费掉。
    assert "only the keys you need to change" in tail, "末尾没有把范围收到『只给要改的键』"
    assert "keeps its current value" in tail, "末尾没有说明『省略的键自动保持』"


def test_normal_generation_keeps_the_original_ending():
    """非精修时收尾照旧 —— 这次改动不能顺手把首次生成也改了。

    代价判据：首次生成本来就该产出完整模型，把那句也换掉是另一种破坏。
    """
    tail = _tail(_prompt())
    assert "Produce the five-system JSON now." in tail or "Produce the complete" in tail, (
        "非精修路径的收尾被误改了"
    )


def test_the_current_model_and_instruction_are_both_in_the_prompt():
    """精修的两个必要输入都得在场 —— 缺一个的话上面的判据全是空转。"""
    gen.set_refine_context({"datamodel": {"entities": [{"id": "alert"}]}}, "消息流是空的")
    p = _prompt()
    assert "REFINE MODE" in p
    assert "alert" in p, "现有模型没进提示词，精修没有基线"
    assert "消息流是空的" in p, "用户指令没进提示词"
