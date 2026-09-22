"""版本回退不许追加副本（2026-08-16 线上实测）。

## 这条防的是"每点一次数字加 1"

真机证据 —— 会话 `sr-20260816114340`：两轮推演只产出 **2 份不同的模型**，
用户来回点了几下 ◀▶ 之后 `modelVersions` 变成 **9 条**：

    mv-1  模型A  11:47:17   ← 真实产物（第1轮）
    mv-2  模型B  11:51:11   ← 真实产物（第2轮）
    mv-3  模型A  15:42:02   ← 复制
    mv-4  模型B  15:42:13   ← 复制
    mv-5  模型A  15:42:25
    ...                        A B A B A B A，间隔约 10 秒
    mv-9  模型A  15:42:54     全部挂在同一个 turn-4-drive-full 上

## 成因

回退路由自己写着「指针移动，不追加副本（经典 undo/redo）」，意图是对的。
但它要重建闭环，重建会走到生成层，生成层把**直供回来的历史模型**当成
"刚产出的模型"记一版——在路由背后把那条纪律破坏掉。

而原来的去重挡不住，因为它**只跟队尾比**：回退到 A 时队尾是 B → 不等 →
追加 A；再切到 B 时队尾成了 A → 又追加 B。来回点就是无限增长。

⚠ 排查时踩过一个坑：直接打接口回退，版本数 9→9 纹丝不动，一度以为复现不了。
   原因是那次恰好回退到与队尾同模型的那一版，**去重巧合命中**。所以下面
   第二条专门用"目标模型 ≠ 队尾模型"的摆位——那才是会涨的形态。

## 为什么不是"把去重改成跟所有历史比"

那是治标：它默认了"回退时记一版是对的，只是别记重复的"。不对——回退时
**一版都不该记**。override 在场 = 正在直供一份已经存在于历史里的快照，
按定义没有新东西。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from models.v5_state import V5SessionState  # noqa: E402
from services.v5_full_driver import record_model_snapshot  # noqa: E402
from services.v5_llm_generate import set_model_override  # noqa: E402

MODEL_A = {"datamodel": {"entities": [{"id": "a"}]}, "rbac": {"roles": ["r1"]}}
MODEL_B = {"datamodel": {"entities": [{"id": "b"}]}, "rbac": {"roles": ["r2"]}}


@pytest.fixture(autouse=True)
def _clear_override():
    set_model_override(None)
    yield
    set_model_override(None)


def _state_with(*models) -> V5SessionState:
    st = V5SessionState(sessionId="t-restore-append", goal={"text": "话题", "status": "needs_refinement"})
    for m in models:
        record_model_snapshot(st, m, "真实产出")
    return st


def test_restoring_a_snapshot_appends_nothing():
    """回退期间（override 在场）记快照 = 空操作。这是主判据。

    摆位刻意用"目标模型 ≠ 队尾模型"：队尾是 B、回退到 A。修复前这一步必涨。
    """
    st = _state_with(MODEL_A, MODEL_B)
    assert len(st.modelVersions) == 2, "前提没搭起来"

    set_model_override(MODEL_A)  # 回退路由做的事
    record_model_snapshot(st, MODEL_A, "restore:mv-1")

    assert len(st.modelVersions) == 2, (
        f"回退追加了副本：{[v['id'] for v in st.modelVersions]} —— 用户看到的就是数字每点一次加 1"
    )


def test_toggling_back_and_forth_stays_flat():
    """来回点 ◀▶ 六次，版本数一条都不许涨。

    这条复刻真机上那个 A B A B A B A 的形态——单次不涨不等于来回点不涨，
    原来那个"只跟队尾比"的去重恰恰是单次可能不涨、交替必涨。
    """
    st = _state_with(MODEL_A, MODEL_B)
    for i in range(6):
        target = MODEL_A if i % 2 == 0 else MODEL_B
        set_model_override(target)
        record_model_snapshot(st, target, f"restore:{i}")
    assert len(st.modelVersions) == 2, (
        f"来回点之后涨到 {len(st.modelVersions)} 版：{[v['id'] for v in st.modelVersions]}"
    )


def test_normal_generation_still_records():
    """没有 override 时照常记版本 —— 这次修复不能顺手把版本史关掉。

    这是上面两条的**代价判据**：只挡回退，不挡真实产出。
    """
    st = _state_with(MODEL_A)
    record_model_snapshot(st, MODEL_B, "第二轮真实产出")
    assert len(st.modelVersions) == 2, "真实的新模型没有被记进版本史"
    assert st.modelVersions[-1]["model"] == MODEL_B


def test_identical_consecutive_model_still_dedupes():
    """原有的队尾去重照常生效（同一轮内重复调用不该涨版本）。"""
    st = _state_with(MODEL_A)
    record_model_snapshot(st, MODEL_A, "同一份再记一次")
    assert len(st.modelVersions) == 1
