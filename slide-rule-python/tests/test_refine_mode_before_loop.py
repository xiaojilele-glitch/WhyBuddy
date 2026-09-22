"""精修必须在主循环**之前**判定（2026-08-16 线上两组对照）。

## 这条防的是"我只想加点数据，它把整个应用换了"

真机对照（同一话题、同一句指令、同一把尺子）：

    会话                      保留段数   菜单        页面数
    sr-20260816165447（基线）  0 / 6     全换        4 → 4
    sr-20260816170934（对照）  0 / 6     全换        4 → 3   ← 还丢了一页

用户说的是「预警消息中心那一页的消息流是空的，给它加一些模拟数据」。

## 根因是时序，不是提示词

    while 主循环:
        execute_v5_capability(...)        ← 五系统模型在这里生成
        ...                                 此时 refine context 是**空的**
    循环结束
    _ensure_runtime_closure_evidence(...) ← 到这里才设 refine context

模型生成时压根不知道自己在做精修。之前两次修复都作用在循环之后那一步：

    48ffe604  让 blocked 时也能设上下文     ← 对的，但设晚了
    0f5686e5  让精修提示词不自相矛盾       ← 对的，但那段 prompt 没被这一步用上

两次都打偏，而第一次我还用"页面字节变没变"当判据判它通过——那个判据只能证明
"有反应"，证不了"改对地方"。逐段指纹才是对的尺子。

## 判据

不测"模型听不听话"（要真调 LLM 且不稳定）。测**上下文在不在**：
`enter_refine_mode` 返回 True 且 `get_refine_context()` 拿得到基线 + 指令，
才谈得上后面那两条修复起作用。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_full_driver as driver  # noqa: E402
from services.v5_llm_generate import get_refine_context, set_refine_context  # noqa: E402

GOAL = "给社区养老服务站做一套长者健康监测与紧急呼叫管理系统"
INSTR = "预警消息中心那一页的消息流是空的，给它加一些模拟数据"
MODEL = {"datamodel": {"entities": [{"id": "alert"}]}, "page": {"pages": []}}


@pytest.fixture(autouse=True)
def _clean():
    set_refine_context(None)
    yield
    set_refine_context(None)


def _state(versions=None) -> V5SessionState:
    st = V5SessionState(sessionId="t-refine-mode", goal={"text": GOAL, "status": "needs_refinement"})
    if versions:
        st.modelVersions = versions
    return st


def test_new_instruction_on_an_existing_model_enters_refine_mode():
    """有基线 + 新指令 → 进精修，且上下文里带着基线和这句话。主判据。"""
    st = _state([{"id": "mv-1", "model": MODEL}])
    assert driver.enter_refine_mode(st, INSTR) is True

    ctx = get_refine_context()
    assert ctx is not None, "精修模式没设上下文 —— 主循环里的生成拿不到基线"
    assert ctx["model"] == MODEL, "上下文里的基线不是上一版模型"
    assert ctx["instruction"] == INSTR, "上下文里没带用户这句话"


def test_the_baseline_may_come_from_version_history_not_only_the_closure():
    """闭环取不到模型时回落版本史 —— 用户来精修恰恰常常是"上一轮没收好口"。

    真机那条会话闭环一直是 blocked，`extract_model_from_closure` 返回 None。
    只认闭环的话，最需要精修的场景反而永远进不了精修。
    """
    st = _state([{"id": "mv-1", "model": MODEL}])
    assert driver.derive_publish_closure_response(st) is None, "前提变了：这个 state 本不该有闭环"
    assert driver.enter_refine_mode(st, INSTR) is True
    assert (get_refine_context() or {}).get("model") == MODEL


def test_same_text_as_the_topic_is_a_rerun_not_a_refine():
    """指令与话题原文相同 = 用户点了"重新推演"，不该走精修。"""
    st = _state([{"id": "mv-1", "model": MODEL}])
    assert driver.enter_refine_mode(st, GOAL) is False
    assert get_refine_context() is None


def test_no_baseline_means_no_refine():
    """一版模型都没有 → 照旧从零生成（首轮就是这个形态）。

    代价判据：这次改动不能让首轮也被当成精修——那会拿 None 当基线。
    """
    st = _state()
    assert driver.enter_refine_mode(st, INSTR) is False
    assert get_refine_context() is None


def test_both_drivers_enter_refine_before_their_loop():
    """两条驱动都要在循环前调 —— 流式是前端主路径，只改同步那条等于没改。

    源码判据：`enter_refine_mode(state, user_instruction)` 的调用行号必须
    早于本函数各自的 `while loop < max_loops`。仓里刚在身份透传上踩过
    "只改了回退路径"这个坑，注释里写着。
    """
    import inspect
    import re

    src = inspect.getsource(driver)
    lines = src.splitlines()
    calls = [i for i, l in enumerate(lines) if "enter_refine_mode(state, user_instruction)" in l]
    loops = [i for i, l in enumerate(lines) if re.search(r"while loop < max_loops", l)]

    assert len(calls) >= 2, f"只有 {len(calls)} 处调用 —— 两条驱动都要接"
    assert len(loops) >= 2, "找不到两条主循环，判据锚点失效"
    for lo in loops:
        assert any(c < lo for c in calls), f"第 {lo} 行的主循环之前没有精修判定"
