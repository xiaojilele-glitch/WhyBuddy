# -*- coding: utf-8 -*-
"""阶段配对台账：开了的步骤必须有人给它收尾。

## 事故（2026-09-06 真机 sr-20260906045441，443 个事件）

把那一轮的 `reasoning_step` / `reasoning_step_result` 按 stage 对账，结果是：

    阶段                    start  end
    specfirst.spec            1     1    OK
    specfirst.design          1     1    OK
    specfirst.pages           3     0    ← 开了三次，一次没收
    specfirst.structure       1     1    OK
    specfirst.semantics       1     1    OK
    specfirst.assemble        1     1    OK
    specfirst.bind            1     0    ← 开了没收
    （驱动器自己那层）        14    11    ← 也不成对

`specfirst.pages` 是整条链上最长的一步（3~4 分钟），`specfirst.bind` 更长
（4~10 分钟）。**恰恰是最长的两步没有收尾事件**——前端那条"逐页画界面"
转到流结束，用户看到的是"卡在画界面"，而它其实早就画完、后面几步都跑过了。

发出端本身是干净的：`enrich_timing.stage()` 是 `try/finally`，`end` 一定会
`_notify`。丢的是**传输段**：

  * `_stage_q` 由 `_pump_llm_deltas` 排水，而泵是**按任务一个**的
    （每个能力执行、收口、总结各起一个）。一个阶段的 start 落在上一个泵、
    end 落在下一个泵是常态。
  * 泵之间有空档；流被停泊/重连打断时，队列里剩下的东西没有下一个泵来取。
  * 于是"开了但没收"不是偶发，是**这条传输结构的默认结局**。

## 抄的是 grok 的哪一处

`xai-grok-session-events/src/tracker.rs`。它把同一件事做成了三个动作：

1. **记住开着的那个**（`active_tool: RefCell<Option<ActiveTool>>` +
   `tool_started()` / `tool_finished()`）——不记就没法收尾。

2. **走的时候替它收尾**（`cancel_active_tool()`）：

       /// Cancels the in-flight tool and emits `ToolCompleted(cancelled)`.
       /// `cancel_running_task()` calls this before `turn_ended`.

   注意它收的是 `outcome: Cancelled`，**不是编一个 Success**。台账里
   "被打断"和"成功"是两回事，混同就等于用假绿盖住真相。

3. **幂等闩**（`emit_turn_ended`）：

       if self.turn_ended_emitted.replace(true) { return; }

   收尾这件事会从好几条路进来（正常结束、取消、异常），没有闩就会重复发。

本文件是第 1、3 两件事 + "谁还开着"的查询；第 2 件事的**发事件**动作留给
调用方（`v5_full_driver._close_dangling_stages`），因为事件形状只该有一处
定义（`_enrich_stage_event`），在这里再拼一遍就是两处书写。

## ⚠ 三个必须做对的细节

1. **同名可以同时开多个。** 真机那轮 `specfirst.pages` 三个并发能力各开一次。
   用 `name -> 单个槽` 会让后开的顶掉先开的，对账数字凭空对上——比不做更糟。
   所以每个名字挂一条**栈**。

2. **`note_end` 要认孤儿。** 只收不发的反面是只发不收：一个没有 start 的
   end 说明 start 掉在了别处。它照样要透出去（事件本身是真的），但要单独
   记一笔 `orphanEnds`，不许当成正常配对。

3. **收尾只许一次。** `close_dangling()` 取走并清空。第二次调用返回空——
   正常结束路径和取消路径都会叫它，没有这条就会重复发收尾事件。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

__all__ = [
    "OpenStage",
    "StagePairTracker",
    "DANGLING_REASON",
    "pairing_report",
]

#: 补发的收尾事件带的原因。写成常量而不是散在调用点的字面量：
#: 判据要能引用同一个词，两处书写就会漂。
DANGLING_REASON = "stream_ended_before_stage_finished"


@dataclass(frozen=True)
class OpenStage:
    """一个还开着的阶段。`event` 是它的 start 事件原样，补发收尾时要用里头的
    pageId / device / stageOrder，凭空重建会丢字段。"""

    name: str
    event: Dict[str, Any]
    started_at: float


class StagePairTracker:
    """一次 SSE 流共用一本。**不是每个泵一本**——阶段跨泵边界是常态，
    每个泵新建一本等于把"谁还开着"这件事每隔几秒清零一次。

    真机那轮心跳全灭（443 个事件里 `progress_heartbeat` = 0）就是这个形状：
    心跳的条件挂在泵局部的 `active_stage` 上，而它在每个泵里都从 None 开始。
    """

    def __init__(self) -> None:
        # name -> 按开启顺序排的栈。同名并发时先开的先收（FIFO 收、LIFO 报）。
        self._open: Dict[str, List[OpenStage]] = {}
        # 报给心跳看的"当前在做什么"：最后开的那个（LIFO），最贴近用户直觉。
        self._recent: List[OpenStage] = []
        self._starts = 0
        self._ends = 0
        self._orphan_ends = 0
        self._closed_out = 0

    # ── 记账 ────────────────────────────────────────────────────────────
    def note_start(self, name: str, event: Dict[str, Any], *, now: float) -> OpenStage:
        """开一个。返回这一次的 `OpenStage`（照 grok `permission_requested()`
        返回 `Instant` 的做法：把配对要用的东西交回调用方，而不是让它自己再存
        一份——两份状态就会漂）。"""
        entry = OpenStage(name=name, event=dict(event or {}), started_at=float(now))
        self._open.setdefault(name, []).append(entry)
        self._recent.append(entry)
        self._starts += 1
        return entry

    def note_end(self, name: str, event: Optional[Dict[str, Any]] = None) -> bool:
        """收一个。配上了返回 True；没有对应 start（孤儿 / 重复收）返回 False。

        返回值**不是**"要不要把事件发出去"——事件永远该发，它是真的。
        返回值是给对账用的：False 说明 start 掉在了别处。
        """
        self._ends += 1
        stack = self._open.get(name)
        if not stack:
            self._orphan_ends += 1
            return False
        # Parallel pages can complete out of order; unkeyed legacy stages stay FIFO.
        keys = [key for key in ("pageId", "device") if (event or {}).get(key) is not None]
        index = next((i for i, row in enumerate(stack)
                      if all(row.event.get(key) == event[key] for key in keys)), None)
        if index is None:
            self._orphan_ends += 1
            return False
        entry = stack.pop(index)
        if not stack:
            self._open.pop(name, None)
        try:
            self._recent.remove(entry)
        except ValueError:  # pragma: no cover — 只可能是同一 entry 被收两次
            pass
        return True

    # ── 查询 ────────────────────────────────────────────────────────────
    def active(self) -> Optional[Dict[str, Any]]:
        """当前还开着的、最后开的那个阶段的 start 事件。没有就 None。

        心跳拿它当**内容**（有就带上，没有就诚实留空），不当**条件**：
        "多久没吐东西"才是心跳的条件，见 v5_full_driver 里那段。
        """
        if not self._recent:
            return None
        return self._recent[-1].event

    def active_started_at(self) -> Optional[float]:
        if not self._recent:
            return None
        return self._recent[-1].started_at

    def dangling(self) -> Tuple[OpenStage, ...]:
        """还开着的全部，按开启顺序。只读，不清空。"""
        rows: List[OpenStage] = []
        for stack in self._open.values():
            rows.extend(stack)
        rows.sort(key=lambda r: r.started_at)
        return tuple(rows)

    # ── 收尾 ────────────────────────────────────────────────────────────
    def close_dangling(self) -> Tuple[OpenStage, ...]:
        """取走并清空还开着的那些，交给调用方补发收尾事件。

        **幂等靠"取走即清空"，不靠额外的闩。**

        grok 那边是 `if self.turn_ended_emitted.replace(true) { return; }`，
        因为 `emit_turn_ended` 本身**不改状态**——不加闩就会重复发。这里的
        语义不同：清空之后 `dangling()` 自然为空，第二次调用空手而归。
        第一版真的加了一把 `_drained` 闩，变异检查当场证明它**没有可观察
        效果**（把闩删掉，判据照样绿）——那种"看起来在保护什么"的代码比
        没有更糟，所以删了。

        ⚠ 真正要守的是**清空这一步**：不清空，第二次调用会把同一批再交一遍，
          于是补发出两条收尾事件。判据钉的是这个。
        """
        rows = self.dangling()
        self._open.clear()
        self._recent.clear()
        self._closed_out += len(rows)
        return rows

    def counters(self) -> Dict[str, int]:
        """对账数字。`starts == ends + closedOut` 且 `orphanEnds == 0` 才算成对。"""
        return {
            "starts": self._starts,
            "ends": self._ends,
            "orphanEnds": self._orphan_ends,
            "closedOut": self._closed_out,
            "stillOpen": len(self.dangling()),
        }


def pairing_report(events: Any) -> Dict[str, Any]:
    """拿一串 SSE 事件反查配对情况。给判据和事后验尸用，不在主链路上。

    只认 `reasoning_step` / `reasoning_step_result` 且带 `stage` 的那些：
    驱动器自己那层（`label` 是能力 id、没有 `stage`）不在本文件的职责里。
    """
    starts: Dict[str, int] = {}
    ends: Dict[str, int] = {}
    for ev in events or ():
        if not isinstance(ev, dict):
            continue
        name = ev.get("stage")
        if not name:
            continue
        kind = ev.get("type")
        if kind == "reasoning_step":
            starts[name] = starts.get(name, 0) + 1
        elif kind == "reasoning_step_result":
            ends[name] = ends.get(name, 0) + 1
    unpaired = {
        name: (starts.get(name, 0), ends.get(name, 0))
        for name in set(starts) | set(ends)
        if starts.get(name, 0) != ends.get(name, 0)
    }
    return {
        "starts": dict(sorted(starts.items())),
        "ends": dict(sorted(ends.items())),
        "unpaired": dict(sorted(unpaired.items())),
        "paired": not unpaired,
    }
