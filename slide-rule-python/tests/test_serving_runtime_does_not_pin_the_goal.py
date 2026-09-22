"""正在服务的运行时不许把目标钉在「等操作 settle」上。

## 来历（2026-09-16）

`test_project_composition_authority.py` 六条全红，失败点统一是
`reason: project_runtime_not_ready`。查下去不是判据的问题，是产线的：

    control_run_service._produce 收尾   把 awaitingOperationIds 当硬闸
    那些 id 来自 control_tool_result    一律记下来，注释明说只是「记账」

于是 `project_start` 的操作——一个**正在服务的运行时**，只有被空闲回收才进
`completed`——把整个目标挂住了。「等异步工作做完」实际变成「等沙盒死」。

真机形态：点了启动工程，那一轮的流挂到空闲超时（默认 300 秒）才收，模型在
沙盒服务期间不往下做。判据形态更毒：等回来时运行时已被回收、`status` 不再是
ready，`available` 永远为假，**那条路径上判据不可能绿**。

实测（压 `SLIDERULE_PROJECT_IDLE_SECONDS` 分毫不差）：

    idle=300（默认）  →  单条 call 301 秒
    idle=30           →  单条 call 30.79 秒
    修好后            →  单条 call 16 秒，整个文件 99 秒（原来半小时）

## 这份判据为什么单独存在

修完之后做变异，发现**只改挂起侧、唤醒侧退回老规矩，那六条照样全绿**——
因为它们走不到唤醒侧。而唤醒侧是必需的：模型拿到 project_start 结果时运行时
可能还在 `starting`，这时挂起是对的；等它变 `ready` 必须有人放它出来。
唤醒侧不改就是「挂了没人叫醒」，一样等到沙盒死，而且**没有任何判据会红**。

所以这里直接**执行唤醒侧的产线源码**（`ControlRunService._requeue_settled_goals`
的未绑定方法喂一个替身 self），不重抄它的逻辑——重抄只能证明「我抄对了」。
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from services.control_run_service import ControlRunService, operation_released_the_goal


def _operation(kind, status, runtime_status=None):
    runtime = None if runtime_status is None else SimpleNamespace(status=runtime_status)
    return SimpleNamespace(kind=kind, status=status, runtime=runtime)


def test_服务中的start操作以ready为准():
    """正向：ready 了就放目标走，不必等它被回收。"""
    assert operation_released_the_goal(
        _operation("runtime.start", "running", "ready"))


def test_还没起来的start操作仍然要等():
    """反向（§3）。没有这一条，「永远返回 True」也能让上面那条绿。"""
    assert not operation_released_the_goal(
        _operation("runtime.start", "running", "starting"))
    assert not operation_released_the_goal(
        _operation("runtime.start", "running", None))


def test_短命操作不许沾ready这条捷径():
    """⚠ exec / verify / patch 会自然结束（run_command 结尾就是
    `finish("completed", ...)`），等它们是对的。给它们也开 ready 捷径，
    等于模型在命令跑完之前就往下走。"""
    for kind in ("runtime.exec", "runtime.verify", "runtime.patch"):
        assert not operation_released_the_goal(_operation(kind, "running", "ready")), kind


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_终态一律放行(status):
    assert operation_released_the_goal(_operation("runtime.exec", status))
    assert operation_released_the_goal(_operation("runtime.start", status, "stopped"))


def test_唤醒侧会把已就绪的start目标放出来():
    """⚠ 这条钉的是**另一半**（CLAUDE.md §4）。

    挂起侧改对了、唤醒侧忘了改，`test_project_composition_authority.py` 六条
    仍然全绿——2026-09-16 变异实测过。那种状态下运行时 `starting` 时挂起的目标
    永远等不到人叫醒。

    这里不构造判断逻辑，直接跑 `_requeue_settled_goals` 的产线源码。
    """
    requeued = []
    waiting = {"runId": "run-1", "ownerId": "owner-1",
               "goal": {"awaitingOperationIds": ["op-start"]}}
    stub = SimpleNamespace(
        store=SimpleNamespace(
            list_waiting_operation=lambda: [waiting],
            requeue_waiting=lambda run_id, operation_ids: requeued.append((run_id, operation_ids)),
        ),
        project_store=SimpleNamespace(
            get_operation=lambda operation_id, owner_id: _operation("runtime.start", "running", "ready"),
        ),
        _wake=asyncio.Event(),
    )
    asyncio.run(ControlRunService._requeue_settled_goals(stub))
    assert requeued == [("run-1", ["op-start"])], (
        "唤醒侧没有放行一个已经 ready 的 runtime.start——目标会一直挂到沙盒被回收"
    )
    assert stub._wake.is_set(), "放行了却没叫醒 scanner，下一轮还要等一个 poll 周期"


def test_唤醒侧不会放行还没起来的start目标():
    """反向：没有这一条，唤醒侧写成「无条件放行」也能让上面那条绿。"""
    requeued = []
    waiting = {"runId": "run-2", "ownerId": "owner-1",
               "goal": {"awaitingOperationIds": ["op-start"]}}
    stub = SimpleNamespace(
        store=SimpleNamespace(
            list_waiting_operation=lambda: [waiting],
            requeue_waiting=lambda run_id, operation_ids: requeued.append((run_id, operation_ids)),
        ),
        project_store=SimpleNamespace(
            get_operation=lambda operation_id, owner_id: _operation("runtime.start", "running", "starting"),
        ),
        _wake=asyncio.Event(),
    )
    asyncio.run(ControlRunService._requeue_settled_goals(stub))
    assert requeued == [], "运行时还没 ready 就把目标放出去了"
