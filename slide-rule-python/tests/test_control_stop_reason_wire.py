"""控制面停止原因的线上形状：新增一个原因，必须在这儿给它起名字。

抄的标准答案：grok-build `xai-grok-hooks/src/event.rs`

    /// Exhaustive, so a new reason has to name its wire value here.
    #[test]
    fn stop_cancelled_wire_shape() {
        let wire_of = |reason: StopCancelledReason| match reason {
            StopCancelledReason::UserInterrupt => ("user_interrupt", "user"),
            StopCancelledReason::MaxTurns      => ("max_turns", "runtime"),
            StopCancelledReason::NoProgress    => ("no_progress", "runtime"),
            StopCancelledReason::Unknown       => ("unknown", "unknown"),
            ...
        };
        for reason in StopCancelledReason::iter() { ... }
    }

Rust 靠 match 的穷尽性：加一个变体不在这张表里写它的 wire 值就编译不过。
Python 没有这个，所以**判据自己当穷尽性检查**：下面那张表少一条就红。

⚠ 为什么值得单写一条：wire 值是**跨语言契约**。前端按 `stopReason` 分支，
  日志按它聚合。改一个字面量（wall_clock → wallClock）不会有任何东西报错，
  只会让前端的分支和日志的聚合同时静默失效。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rehearsal_control import (  # noqa: E402
    ControlStopReason,
    StoppedBy,
    stop_text,
    stop_wire,
)

#: 手写的期望表。**故意不从枚举推导**——从枚举推导等于拿被测物证明自己。
_WIRE = {
    ControlStopReason.WALL_CLOCK: ("wall_clock", "runtime"),
    ControlStopReason.TOKEN_BUDGET: ("token_budget", "runtime"),
    ControlStopReason.TOOL_ROUNDS: ("tool_rounds", "runtime"),
    ControlStopReason.STATIONARITY: ("stationarity", "runtime"),
    ControlStopReason.LLM_UNAVAILABLE: ("llm_unavailable", "provider"),
    ControlStopReason.UNKNOWN: ("unknown", "unknown"),
}


def test_每个原因都得在这张表里有名字():
    """新增一个 ControlStopReason 而不在这儿写它的 wire 值 → 本条红。"""
    missing = sorted(r.value for r in ControlStopReason if r not in _WIRE)
    assert not missing, f"这些新原因还没起线上名字：{missing}"
    extra = sorted(r.value for r in _WIRE if r not in set(ControlStopReason))
    assert not extra, f"表里有枚举里已经没有的原因：{extra}"


@pytest.mark.parametrize("reason", list(ControlStopReason))
def test_wire_值和归属都对得上(reason: ControlStopReason):
    want_reason, want_by = _WIRE[reason]
    got = stop_wire(reason)
    assert got["stopReason"] == want_reason
    assert got["stoppedBy"] == want_by


@pytest.mark.parametrize("reason", list(ControlStopReason))
def test_每个原因都有一句能据以行动的话(reason: ControlStopReason):
    """少一条会在 stop_text 里 KeyError——而这条链挂在失败路径上，
    炸了只会变成又一个"什么都没发生"。"""
    text = stop_text(reason)
    assert isinstance(text, str) and len(text) >= 8, reason


def test_给用户的话两两不同():
    """一个原因一句话。塌成一句就是改这一版之前的现状。

    ⚠ 2026-09-09 加 STATIONARITY 时差点又塌一次：「打转」和 TOOL_ROUNDS
      都是运行时闸、都停在控制面，措辞一顺手就写成同一句「来回想了好几轮」。
      那正是这条判据存在的意义——两种停法用户该做的事不一样。"""
    texts = [stop_text(r) for r in ControlStopReason]
    assert len(set(texts)) == len(texts), "有两个原因给的是同一句话"


def test_限额跟着原因一起上线():
    """抄 turn_hook 的 cancellation_context：`{"reason": …, "limit": 50}`。

    变异：把 stop_wire 里 limit/used 那两段删掉 → 本条红。
    """
    got = stop_wire(ControlStopReason.TOOL_ROUNDS, limit=8, used=8)
    assert got["limit"] == 8 and got["used"] == 8
    # 反向：没给就不许凭空造一个
    assert "limit" not in stop_wire(ControlStopReason.LLM_UNAVAILABLE)


def test_stoppedBy_是推导出来的_但照样上线():
    """抄 CancelledBy 那句 "shipped anyway, so hosts do not re-derive it"。

    前端不该自己维护一份 reason → 归属映射；新增原因时那份必然漂。
    所以每个 wire payload 都必须自带 stoppedBy。
    """
    for reason in ControlStopReason:
        assert "stoppedBy" in stop_wire(reason), reason
    assert {b.value for b in StoppedBy} == {"runtime", "provider", "unknown"}


def test_只有一处把原因变成人话():
    """唯一渲染处（同 closure_block_reason 那条纪律）。

    变异：在 rehearsal_control 里再写死一句"停在控制面" → 本条红。
    """
    import re
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    body = re.sub(r'"""[\s\S]*?"""', "", src)
    body = re.sub(r"#[^\n]*", "", body)
    # _STOP_TABLE 之外不许再出现"停在控制面"这种自制停止话术
    outside = body.split("_STOP_TABLE")[-1]
    outside = outside[outside.index("}") :] if "}" in outside else outside
    assert "停在控制面" not in outside, "又有人在别处拼了一句停止理由"
