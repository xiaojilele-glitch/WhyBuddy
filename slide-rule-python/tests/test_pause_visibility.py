"""Manual cooperative pause snapshots, timing, and recovery remain supported.

SPEC decisions now return to the control questionnaire and never own a pause
slot; their live-path regression is test_spec_decisions_questionnaire.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from services import run_pause
from services.run_pause import PauseBudget, PauseGate, PauseSlot, hold_state




# ── #2b：快照里有「正在等人」这一格 ──────────────────────────────────
class Test快照里有正在等人这一格:
    def test_没在等人时是None(self):
        assert hold_state(None) is None
        assert hold_state(PauseSlot()) is None, "空位子不许报成在等人"

    def test_按了还没到报pending(self):
        """`pending` = 按了暂停 / 出了假设卡，但还没走到安全点。

        变异：把 pending / waiting 合成一个布尔 → 前端分不出"再等一下就停"
        和"已经停了快答"，本条红。
        """
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget())
        st = hold_state(slot)
        assert st is not None
        assert st["phase"] == "pending"

    def test_已经停住报waiting并带上等什么等了多久(self):
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.active = gate

        async def _park():
            task = asyncio.ensure_future(gate.wait("spec-assumptions"))
            # 让 wait() 跑到"已经写下落点、正在等"那一刻
            await asyncio.sleep(0.05)
            st = hold_state(slot)
            gate.skip()
            await task
            return st

        st = asyncio.run(_park())
        assert st is not None
        assert st["phase"] == "waiting"
        assert st["where"] == "spec-assumptions", (
            "等待期间读不到 where —— 落点又写回 wait() 的返回处了"
        )
        assert st["waitedSeconds"] is not None and st["waitedSeconds"] >= 0

    def test_落点写在开始等之前(self):
        """跟 #2a 同一条纪律：写在返回时就只有等完了才可见。

        ⚠ 2026-09-06 第二轮真机之后，落点从 `wait()` 里挪到了 `arm()` 里 ——
          因为 `wait()` 里已经太晚了：`take_hold()` 把闸转成 active 之后、
          `await wait()` 之前有一道缝，前端在那道缝里问到过
          `{"phase":"waiting","where":"","waitedSeconds":null}`。
          现在驱动器在**发通知之前**先 arm（照 grok permission_requested）。

        这一条改成钉住 `wait()` **不许自己另写一份落点**：两处书写就会漂。
        """
        src = (
            Path(__file__).parent.parent / "services" / "run_pause.py"
        ).read_text(encoding="utf-8")
        # arm() 里必须两格一起落
        arm_start = src.index("    def arm(self, where: str) -> float:")
        arm_body = src[arm_start : src.index("\n    @property", arm_start)]
        assert "self._where = str(where or \"\")" in arm_body
        assert "self._started_at = time.monotonic()" in arm_body

        # wait() 只许通过 arm() 拿落点，不许自己再写一份
        wait_start = src.index("    async def wait(self, where: str)")
        wait_body = src[wait_start : src.index("\n    def _settle", wait_start)]
        assert "self.arm(where)" in wait_body, "wait() 没走 arm()，落点又变成两处书写"
        assert "self._started_at = " not in wait_body, "wait() 自己又写了一份起算时刻"
        assert "self._where = " not in wait_body, "wait() 自己又写了一份 where"

    def test_不限时报None而不是0(self):
        """⚠ 0 不表示不限时——那是 `enabled=False` 的活
        （`PauseBudget` 头注直接引了 grok 那句原话）。"""
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget(enabled=False))
        st = hold_state(slot)
        assert st is not None
        assert st["budgetSeconds"] is None

    def test_有预算就如实报秒数(self):
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget(seconds=90))
        st = hold_state(slot)
        assert st is not None
        assert st["budgetSeconds"] == 90.0

    def test_场上有没有人也报出来(self):
        """超时的结局会因此不同（用户跳过 vs 没有操作员）。"""
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.pending = gate
        assert hold_state(slot)["unattended"] is False
        gate.mark_no_operator()
        assert hold_state(slot)["unattended"] is True

    def test_Run快照两格都给(self):
        """布尔给判断、详情给展示。只给 hold 的话调用方得先判 None 再取值；
        只给布尔的话又回到"不知道在等什么"。"""
        from services.run_registry import Run

        run = Run("run-1", "sess-1") if _run_takes_two_args() else Run("run-1")
        snap = run.snapshot()
        assert "held" in snap and "hold" in snap, "快照里没有「正在等人」这一格"
        assert snap["held"] is False and snap["hold"] is None

        run.pause_slot.pending = PauseGate(PauseBudget())
        snap = run.snapshot()
        assert snap["held"] is True
        assert (snap["hold"] or {})["phase"] == "pending"

    def test_快照读不到停泊态也不许抛(self):
        """快照是诊断面。炸了会让 `runs/active` 整个 500，比少一格严重得多。"""
        from services.run_registry import Run

        run = Run("run-2", "sess-2") if _run_takes_two_args() else Run("run-2")

        class _Boom:
            @property
            def active(self):
                raise RuntimeError("炸了")

        run.pause_slot = _Boom()  # type: ignore[assignment]
        snap = run.snapshot()  # 不许抛
        assert snap["held"] is False and snap["hold"] is None


def _run_takes_two_args() -> bool:
    import inspect

    from services.run_registry import Run

    return len(inspect.signature(Run.__init__).parameters) >= 3


# ── 一致性：is_holding 与 hold_state 必须说同一件事 ───────────────────
@pytest.mark.parametrize(
    "setup",
    [
        pytest.param("empty", id="空位子"),
        pytest.param("pending", id="按了还没到"),
        pytest.param("active", id="正在等"),
    ],
)
def test_is_holding与hold_state不许互相打架(setup):
    """两处书写同一个事实。漂了的结果是孤儿看门狗和前端各信一半。

    变异：`hold_state` 只看 `slot.active`（漏 pending）→ "按了还没到" 那档
    两边不一致，本条红。
    """
    slot = PauseSlot()
    if setup == "pending":
        slot.pending = PauseGate(PauseBudget())
    elif setup == "active":
        slot.active = PauseGate(PauseBudget())
    assert run_pause.is_holding(slot) is (hold_state(slot) is not None)


# ── 第二轮真机：waiting 却说不出等什么、等了多久 ──────────────────────
#
# 停泊那一刻**立刻**问 GET /runs/active，拿到的是：
#
#     {"phase": "waiting", "where": "", "waitedSeconds": null, "budgetSeconds": 1800}
#
# 自相矛盾。因为 phase 是从 `slot.active` 推的，而 `take_hold()` 把闸转成 active
# 发生在 `await gate.wait()` **之前**；`where` / `_started_at` 是 wait() 进去才写的。
# 两步之间那道缝就是这个窗口。上一轮我等了 1.2 秒才问，正好躲过去了。
#
# 一个说不出内容的状态字比没有这个字更糟：前端会照着它把「快答」的按钮点亮，
# 而此时闸还没进 wait()。
#
# 抄 grok tracker.rs 的 `permission_requested()`：相位、等什么、起算时刻
# **一次全部建立**，并把起算时刻交回调用方。


class Test说在等就必须说得出等什么:
    def test_取到闸但还没开始等时报pending(self):
        """★ 这一条就是那个窗口。

        `take_hold()` 之后、`wait()` 之前，如实报 `pending`（"马上就要停"），
        不许报 `waiting`。

        变异：把 phase 改回按 `slot.active` 判 → 本条红。
        """
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.active = gate                      # take_hold() 干的事
        assert gate.armed is False, "还没 arm 就说自己在等了"
        st = hold_state(slot)
        assert st is not None
        assert st["phase"] == "pending", (
            f"取到闸但还没进 wait()，却报了 {st['phase']} —— 前端会把「快答」点亮"
        )

    def test_arm之后三格一起有值(self):
        """相位、等什么、等了多久，一次全部建立——不许出现「有相位没内容」。"""
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.active = gate
        gate.arm("spec-assumptions")
        st = hold_state(slot)
        assert st["phase"] == "waiting"
        assert st["where"] == "spec-assumptions"
        assert st["waitedSeconds"] is not None and st["waitedSeconds"] >= 0

    @pytest.mark.parametrize("setup", ["pending", "active-not-armed", "armed"])
    def test_任何时刻都不许有说不出内容的waiting(self, setup):
        """⚠ 不变式判据：`phase == "waiting"` ⇒ `where` 非空且 `waitedSeconds` 有值。

        这条比上面两条都硬——它不关心是哪条路走出来的，只钉住"不许自相矛盾"。
        变异：任何让 phase 与落点分两步建立的改法都会让某一档红。
        """
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        if setup == "pending":
            slot.pending = gate
        else:
            slot.active = gate
            if setup == "armed":
                gate.arm("spec-assumptions")
        st = hold_state(slot)
        assert st is not None
        if st["phase"] == "waiting":
            assert st["where"], f"{setup}: 报 waiting 却说不出等什么"
            assert st["waitedSeconds"] is not None, f"{setup}: 报 waiting 却说不出等了多久"

    def test_arm是幂等的不许把等了多久清零(self):
        """⚠ 刷新一次快照就把"等了多久"清零，比不报更骗人——用户会以为闸刚挂上。"""
        gate = PauseGate(PauseBudget())
        first = gate.arm("spec-assumptions")
        time.sleep(0.02)
        again = gate.arm("spec-assumptions")
        assert again == first, "重复 arm 改了起算时刻"

    def test_wait没被arm过也能自己补上(self):
        """脚本 / 判据直调 `wait()` 的路径语义不变。"""
        gate = PauseGate(PauseBudget())
        slot = PauseSlot()
        slot.active = gate

        async def _park():
            task = asyncio.ensure_future(gate.wait("直调"))
            await asyncio.sleep(0.05)
            st = hold_state(slot)
            gate.skip()
            await task
            return st

        st = asyncio.run(_park())
        assert st["phase"] == "waiting"
        assert st["where"] == "直调"
