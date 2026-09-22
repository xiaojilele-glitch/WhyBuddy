"""精修必须落在**真正在跑的那条生成链**上（2026-08-16 晚，代价惨痛）。

## 为什么单独有这个文件

Merge Patch 的实现和单测都对（test_refine_merge_patch.py 12 条 + 2 个变异全咬住），
但真机跑完发现诊断日志 `精修合并（RFC 7386）` **一次都没出现**——因为它接在
`generate_five_system_model` 上，而这一轮实际产出模型的是 **spec-first 链路**
（`v5_capability_executor.py` 的 `run_spec_first(...)["model"]`）。

代码装在了不通电的插座上。而这已经是同一天内第三次同类错误：

    改了闭环重建那一步      而模型是主循环里生成的
    改了提示词收尾          同样在没被使用的那一步
    合并接在老生成器        真正在跑的是 spec-first

三次都是**没先确认哪条路真的在跑**就动手，三次都靠真机日志才发现。

## 这条判据的作用

把"哪条链在跑"从事后靠日志发现，变成**当场红灯**。加了它之后，接错插座在
`pytest` 阶段就暴露，不用等 25 分钟真机跑。

## 2026-08-17：书签已摘，但判据换了形状，别照抄旧的

原来第二条是 `strict xfail`，grep 调用点附近有没有 `merge_patch`。现在**修好了**，
xfail 摘掉——但修法不是把 merge_patch 接上去，而是**换了方案**：

    补丁语义   模型吐增量，合并器往基线上打          ← 与 spec-first 架构不兼容
    沿用语义   模型声明碰了哪几段，出口把其余段按住   ← 现在用的

原因在 `services/spec_first_pipeline.apply_refine_segment_reuse` 的文档串里：
spec-first 天生"从 spec 树重新生成"，出口**永远是完整模型**，合并器看到六段
齐全就判"没按补丁交付"、原样放行。这不是接线问题，是方案选错了。

⚠ 所以这里的第二条也从 **grep 判据换成了行为判据**。旧写法钉的是"某个标识符
  出现在某个窗口里"，换个实现方式就失效——而这一轮恰恰换了实现方式。教训：
  判据要盯**语义**（上一版有没有到达真正在跑的那条链），别盯某个函数名。

逐段行为的完整覆盖在 `tests/test_refine_segment_reuse.py`（21 条 + 7 个变异全咬住）。
这个文件只守一件事：**哪条链在跑，以及精修上下文有没有到达它**。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402


def _code(mod) -> str:
    """源码去注释去 docstring —— 本文件注释里就写着这些函数名，不剥必然假绿。"""
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_the_live_generator_is_spec_first_not_the_legacy_one():
    """先锁住"哪条链在跑"这个事实本身 —— 后面的判据都建在它上面。

    这条要是红了，说明链路换了，下面那条的前提就没了，得重新确认再改判据。
    """
    from services import v5_capability_executor as ex

    code = _code(ex)
    assert "run_spec_first(" in code, "spec-first 不在链路里了？先确认现状再改判据"
    at_spec = code.index("run_spec_first(")
    at_legacy = code.find("generate_five_system_model(")
    assert at_legacy == -1 or at_spec < at_legacy, (
        "老链路排到了 spec-first 前面 —— 主生成器变了"
    )


def test_the_previous_model_reaches_the_path_that_actually_produces_the_model():
    """上一版模型必须**到达** spec-first —— 不到达的话，沿用在生产路径上等于没有。

    行为判据，不是 grep：真的跑一遍执行器，捕获它交给 run_spec_first 的实参。
    这正是旧版判据缺的那一环——那 11 条只直接调被测函数，把调用点删掉照样全绿。
    """
    from services import v5_capability_executor as ex
    from services.v5_llm_generate import set_refine_context

    baseline = {
        "datamodel": {"entities": [{"id": "wo", "name": "工单", "fields": []}]},
        "page": {"pages": [{"id": "p1", "name": "工单页"}]},
        "rbac": {"roles": [{"id": "mgr", "name": "主管"}]},
        "workflow": {"nodes": [{"id": "s1", "name": "提交", "assigneeRole": "mgr"}]},
    }
    captured: dict = {}
    saved_env = os.environ.get("SLIDERULE_SPEC_FIRST")

    def fake_run(goal, **kw):
        captured.update(kw)
        raise RuntimeError("捕获即止")

    original = None
    try:
        from services import spec_first_pipeline as sfp

        original = sfp.run_spec_first
        sfp.run_spec_first = fake_run
        os.environ["SLIDERULE_SPEC_FIRST"] = "1"
        set_refine_context(baseline, "给工单页加点模拟数据")
        ex._try_llm_generate_evidence("原始话题", None)
    finally:
        if original is not None:
            sfp.run_spec_first = original
        set_refine_context(None)
        if saved_env is None:
            os.environ.pop("SLIDERULE_SPEC_FIRST", None)
        else:
            os.environ["SLIDERULE_SPEC_FIRST"] = saved_env

    assert captured.get("refine"), "精修指令没到 spec-first —— 迭代又变回按原话重抽"
    assert captured.get("reuse_model") == baseline, (
        "上一版模型没到 spec-first —— 没提到的段仍会被整段重写"
    )


def test_the_reuse_actually_runs_at_the_spec_first_model_exit():
    """沿用必须发生在 spec-first 的**模型出口**上，而不是只是把参数传进去了。

    反向判据：参数传到了 ≠ 它被用上了。这条直接调 pipeline 的出口函数，
    确认"没点名的段"确实被按住。
    """
    from services.spec_first_pipeline import (
        REFINE_REUSABLE_SEGMENTS,
        apply_refine_segment_reuse,
    )

    baseline = {seg: {"来源": "上一版"} for seg in REFINE_REUSABLE_SEGMENTS}
    fresh = {seg: {"来源": "重新生成"} for seg in REFINE_REUSABLE_SEGMENTS}
    out = apply_refine_segment_reuse(fresh, baseline, [], gate_fn=lambda m: {"passed": True})
    for seg in REFINE_REUSABLE_SEGMENTS:
        assert out[seg] == baseline[seg], f"{seg} 没被按住"


@pytest.mark.parametrize("seg", ["datamodel", "page", "appbundle"])
def test_segments_coupled_to_this_run_are_never_reused(seg):
    """反向判据：耦合本轮产物的段**不许**沿用。

    2026-08-17 第一版把 appbundle 放进了可沿用清单，被闸当场咬出来——它整段都是
    指向本轮页面/角色/实体的引用（landingPageRef、pageBindings、roleRefs），
    沿用上一版等于拿旧页面 id 当落地页。
    """
    from services.spec_first_pipeline import REFINE_REUSABLE_SEGMENTS

    assert seg not in REFINE_REUSABLE_SEGMENTS
