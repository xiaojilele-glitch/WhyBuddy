# -*- coding: utf-8 -*-
"""阶段 start/end 必须成对，以及心跳的判据是「流沉默多久」。

## 这条判据在守什么

真机 sr-20260906045441（443 个事件）按 stage 对账：

    specfirst.pages   start 3 / end 0
    specfirst.bind    start 1 / end 0
    progress_heartbeat                0

整条链最长的两步（3~4 分钟、4~10 分钟）都没有收尾事件，前端那条进度转到
流结束；而覆盖那段空白的心跳一个都没发。两件事同一个根：

  * 收尾丢在**传输段**——`_stage_q` 由 `_pump_llm_deltas` 排水，而泵是按任务
    一个的，泵之间的空档、以及停泊打断，都会让队列里剩下的 end 没人取；
  * 心跳的条件挂在**泵局部**的 `active_stage` 上，每个泵都从 None 开始，
    所以在最长的那一步上恒不成立。

发出端（`enrich_timing.stage()` 的 try/finally）从来是干净的。**判据装在
发出端就永远是绿的**——这正是本仓数到第十次的失败形态：闸全绿但东西没了。
所以本文件的判据全部落在**传输段和收尾段**。

## 夹具

`fixtures/stage_pairing/real-20260906-unpaired.json` 是真机那一轮的三类事件
原样（42 条）。它的价值就在于它是真机那一发：任何"重构后仍然成对"的说法
都得在这份东西上过一遍。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services.stage_pairing import (
    DANGLING_REASON,
    StagePairTracker,
    pairing_report,
)

FIXTURE = (
    Path(__file__).parent / "fixtures" / "stage_pairing" / "real-20260906-unpaired.json"
)
DRIVER = Path(__file__).parent.parent / "services" / "v5_full_driver.py"


def _real_events() -> list:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["events"]


def _driver_src() -> str:
    return DRIVER.read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    """去掉注释行——本文件几处形状判据要查的是**代码**，不是注释里提到过。"""
    return "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )


# ── 台账本身 ────────────────────────────────────────────────────────────
class Test台账:
    def test_同名可以同时开多个(self):
        """真机那轮三个并发能力各开了一次 `specfirst.pages`。

        变异：把 `_open` 从"每名字一条栈"改成"每名字一个槽" → 后开的顶掉先开的，
        `stillOpen` 变 0，对账凭空对上——比不做更糟。本条必须红。
        """
        t = StagePairTracker()
        for _ in range(3):
            t.note_start("specfirst.pages", {"stage": "specfirst.pages"}, now=0.0)
        assert t.counters()["stillOpen"] == 3

        assert t.note_end("specfirst.pages") is True
        assert t.counters()["stillOpen"] == 2, "三个开着收掉一个应该还剩两个"

    def test_孤儿end单独记一笔而不是当成配对(self):
        """只发不收的反面。start 掉在别处时，end 照样要透出去（事件是真的），
        但不许算成正常配对。

        变异：`note_end` 无条件 return True → `orphanEnds` 恒 0，本条红。
        """
        t = StagePairTracker()
        assert t.note_end("specfirst.bind") is False
        assert t.counters()["orphanEnds"] == 1
        assert t.counters()["stillOpen"] == 0

        t.note_start("specfirst.bind", {}, now=0.0)
        assert t.note_end("specfirst.bind") is True
        assert t.note_end("specfirst.bind") is False, "收第二次是孤儿，不是配对"
        assert t.counters()["orphanEnds"] == 2

    def test_收尾取走即清空所以第二次空手(self):
        """正常结束、取消、异常三条路都会叫 `close_dangling()`。第二次必须空手，
        否则同一批会被补发两条收尾事件。

        ⚠ 幂等靠"取走即清空"，不靠额外的闩。第一版加了一把 `_drained`，
          变异检查证明它**没有可观察效果**（删掉判据照样绿），已经删了。
          这条判据钉的是**清空**：变异 `_open.clear()` → 第二次又返回一份，
          本条红。
        """
        t = StagePairTracker()
        t.note_start("specfirst.pages", {}, now=0.0)
        t.note_start("specfirst.bind", {}, now=1.0)
        first = t.close_dangling()
        assert [r.name for r in first] == ["specfirst.pages", "specfirst.bind"]
        assert t.close_dangling() == (), "第二次必须空手，不然收尾事件会重复发"
        assert t.active() is None, "收尾之后不许还报着一个阶段在跑"

    def test_收尾算进对账等式(self):
        """`starts == ends + closedOut` 是这本台账的收支平衡式。"""
        t = StagePairTracker()
        t.note_start("a", {}, now=0.0)
        t.note_start("b", {}, now=1.0)
        t.note_end("a")
        t.close_dangling()
        c = t.counters()
        assert c["starts"] == c["ends"] + c["closedOut"] == 2
        assert c["orphanEnds"] == 0
        assert c["stillOpen"] == 0

    def test_active是最后开的那个且收掉之后回退(self):
        """心跳拿它当**内容**。嵌套时用户直觉里"在做"的是最内层那个。

        变异：`active()` 返回最先开的 → 本条红。
        变异：`note_end` 不从 `_recent` 里摘掉 → 收完还报同一个阶段，本条红。
        """
        t = StagePairTracker()
        t.note_start("outer", {"stage": "outer"}, now=0.0)
        t.note_start("inner", {"stage": "inner"}, now=1.0)
        assert (t.active() or {}).get("stage") == "inner"
        t.note_end("inner")
        assert (t.active() or {}).get("stage") == "outer", "收掉内层要回退到外层"
        t.note_end("outer")
        assert t.active() is None
        assert t.active_started_at() is None

    def test_start事件原样存着好让收尾带上pageId(self):
        """收尾事件要带 pageId / device，凭空重建会丢字段。

        变异：`OpenStage` 只存 name（不存 event）→ 本条红。
        """
        t = StagePairTracker()
        t.note_start(
            "specfirst.pages",
            {"stage": "specfirst.pages", "pageId": "p3", "device": "phone"},
            now=12.5,
        )
        (row,) = t.dangling()
        assert row.event["pageId"] == "p3"
        assert row.event["device"] == "phone"
        assert row.started_at == 12.5

    def test_台账不共享同一个字典(self):
        """`note_start` 存的是副本。调用方之后改自己那份不许影响台账。"""
        t = StagePairTracker()
        ev = {"stage": "x", "pageId": "p1"}
        t.note_start("x", ev, now=0.0)
        ev["pageId"] = "被改了"
        assert t.dangling()[0].event["pageId"] == "p1"


# ── 拿真机那一轮反查 ──────────────────────────────────────────────────
class Test真机对账:
    def test_真机那轮确实不成对(self):
        """夹具自己得是"病态"的，否则下面那条"修好了"无从对照。

        这一条同时是**判据自检**：夹具被人无意"整理"成成对之后，
        它会立刻变红，而不是让整个文件退化成空跑。
        """
        report = pairing_report(_real_events())
        assert report["paired"] is False
        assert report["unpaired"] == {
            "specfirst.pages": (3, 0),
            "specfirst.bind": (1, 0),
        }, f"真机那轮的病灶变了：{report['unpaired']}"

    def test_补上收尾之后就成对了(self):
        """把台账的收尾动作接上去 —— 同一串事件必须变成成对。

        这就是修复的行为定义：**不改发出端，只在收尾时把开着的补齐。**
        """
        t = StagePairTracker()
        replayed = []
        for ev in _real_events():
            stage = ev.get("stage")
            if not stage:
                continue
            if ev.get("type") == "reasoning_step":
                t.note_start(stage, ev, now=0.0)
                replayed.append(ev)
            elif ev.get("type") == "reasoning_step_result":
                t.note_end(stage)
                replayed.append(ev)
        for row in t.close_dangling():
            replayed.append(
                {
                    "type": "reasoning_step_result",
                    "stage": row.name,
                    "error": True,
                    "skippedReason": DANGLING_REASON,
                    "synthetic": True,
                }
            )
        report = pairing_report(replayed)
        assert report["paired"] is True, f"补完还是不成对：{report['unpaired']}"
        assert t.counters()["orphanEnds"] == 0

    def test_补出来的收尾不许伪装成成功(self):
        """抄的是 grok `cancel_active_tool()` 发 `ToolOutcome::Cancelled`
        而**不是** Success。编一个成功就是用假绿盖住真相。"""
        t = StagePairTracker()
        t.note_start("specfirst.bind", {"stage": "specfirst.bind"}, now=0.0)
        (row,) = t.close_dangling()
        assert row.name == "specfirst.bind"
        assert DANGLING_REASON and "stream_ended" in DANGLING_REASON

    def test_真机那轮心跳几乎全灭(self):
        """443 个事件里 3 个心跳，而 `specfirst.pages` 那一步单独就 60 秒以上。

        15 秒一跳的话，光那一步就该有 4 个。这一条钉住的是"当时确实全灭"，
        修好之后要靠实跑而不是靠它验证——但它保证没人能把这段历史抹掉。
        """
        beats = [e for e in _real_events() if e.get("type") == "progress_heartbeat"]
        assert len(beats) <= 3, "夹具被换了？真机那轮就是 3 个"


# ── 传输段与收尾段真的接上去了 ────────────────────────────────────────
class Test驱动器接线:
    """这几条查的是**接线**，不是逻辑。

    逻辑判据（上面那些）在台账类上跑得很干净，但台账再对，没接进泵和收尾
    也是白的——本仓第四条（只改一半必然静默失效）反复就在这个缝上。
    驱动器那一段是 1400 行 async generator 里的内联代码，没法单独实例化，
    所以这里退一步查形状；每一条都点明"删掉哪一行会让它红"。
    """

    def test_泵用的是流级台账而不是泵局部变量(self):
        src = _strip_comments(_driver_src())
        assert "_stage_pairs = _StagePairTracker()" in src, "台账没建"
        assert "_stage_pairs.note_start(" in src, "泵没记 start"
        assert "_stage_pairs.note_end(" in src, "泵没记 end"
        # 反向：泵局部的 active_stage 必须已经不在了，否则心跳又会挂回去
        assert "active_stage: Optional[Dict[str, Any]] = None" not in src, (
            "泵局部 active_stage 回来了 —— 心跳会重新变成每个泵清零一次"
        )

    def test_心跳的条件是流沉默多久不是有没有已知阶段(self):
        src = _strip_comments(_driver_src())
        assert "now - last_yield_at >= heartbeat_seconds" in src, (
            "心跳条件不是「流沉默多久」"
        )
        # 反向：真机实测 `active_stage is not None` 这个条件在最长的一步上
        # 恒不成立（443 事件 / 0 心跳）。它不许作为条件回来。
        assert not re.search(r"if\s+active_stage\s+is\s+not\s+None\s*:", src), (
            "心跳的条件又挂回「有没有已知阶段」了"
        )

    def test_心跳内容取自流级台账(self):
        src = _strip_comments(_driver_src())
        assert "_stage_pairs.active()" in src
        assert "_stage_pairs.active_started_at()" in src

    def test_收尾在sink卸载之后才跑(self):
        """顺序是刻意的：先 `_sinks.close()`（不再有新事件进队列），
        再排干、再判断谁还开着。反过来会给一个其实已经收尾、只是 end 还
        躺在队列里的阶段补一条"被打断"——把正常说成异常。"""
        src = _driver_src()
        i_close_sinks = src.index("_sinks.close()")
        i_call = src.index("async for _tail_ev in _close_dangling_stages()")
        assert i_close_sinks < i_call, "收尾跑在 sink 卸载之前了"

    def test_收尾先排干队列再判断谁还开着(self):
        src = _driver_src()
        body_start = src.index("async def _close_dangling_stages():")
        body = src[body_start : body_start + 4000]
        i_drain = body.index("_stage_q.get_nowait()")
        i_close = body.index("_stage_pairs.close_dangling()")
        assert i_drain < i_close, "先判断再排干 = 会把已收尾的说成被打断"

    def test_收尾事件逐字段翻译而不是摊开start事件(self):
        """台账存的是 start **事件**（键叫 pageId），`_enrich_stage_event` 吃的是
        **埋点 fields**（键叫 page）。直接 `**row.event` 会让 pageId 静默变
        None——本仓「白名单漏一行就被静默丢掉」那个形状。"""
        src = _driver_src()
        body_start = src.index("async def _close_dangling_stages():")
        body = src[body_start : body_start + 4000]
        assert '"page": _row.event.get("pageId")' in body
        assert "**_row.event," not in body, "又摊开 start 事件了，pageId 会变 None"

    def test_补出来的收尾带着不成功和原因(self):
        src = _driver_src()
        body_start = src.index("async def _close_dangling_stages():")
        body = src[body_start : body_start + 4000]
        assert '"ok": False' in body, "补出来的收尾不许伪装成成功"
        assert '"skippedReason": _STAGE_DANGLING_REASON' in body
        assert '"synthetic": True' in body, "下游要能分出这是补出来的"


# ── 收尾事件的形状 ────────────────────────────────────────────────────
class Test收尾事件形状:
    @pytest.mark.parametrize("stage", ["specfirst.pages", "specfirst.bind"])
    def test_ok为False时事件带error(self, stage):
        """补出来的收尾靠 `ok=False` 变成 `error=True`。这一步的映射断了的话，
        补发出来的东西在前端看起来是"成功了"——比不补更糟。"""
        from services.v5_full_driver import _enrich_stage_event

        ev = _enrich_stage_event(
            "end",
            stage,
            {"ms": 61000, "ok": False, "skippedReason": DANGLING_REASON},
        )
        assert ev is not None
        assert ev["type"] == "reasoning_step_result"
        assert ev["stage"] == stage
        assert ev["error"] is True
        assert ev["skippedReason"] == DANGLING_REASON

    def test_空阶段的心跳如实留空而不是编一个阶段名(self):
        """没有已知阶段时给空壳。字段如实为 None——编一个阶段名会让排查
        的人追一个不存在的步骤。"""
        from services.v5_full_driver import _progress_heartbeat_event

        ev = _progress_heartbeat_event({}, elapsed_ms=15000)
        assert ev["type"] == "progress_heartbeat"
        assert ev["stage"] is None
        assert ev["label"] is None
        assert ev["elapsedMs"] == 15000
