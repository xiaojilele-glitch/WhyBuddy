# -*- coding: utf-8 -*-
"""一直在读、一次没写：**捅一下，但不许掐**。

## 病是怎么看见的（2026-09-14 真机 `shots/build2`）

工程链路终于跑通之后，模型在工程工作台里干了这些：

    工程动作 17/17
    创建工程 → list → 查看运行状态 → 读取源码 ×5 → 查看运行状态
    → list → 读取源码 ×4 → search → 读取源码

**17 个动作，`project_patch` 零次。** 它自己写的计划里有「project_exec 跑
check/build/test 并修复」，人工连催 6 次「现在用 project_patch 写实现」都不
动手，整轮停在 17/17，构建从来没跑起来。

前两道闸都拦不住，**而且它们不该拦**：
  · 整轮签名 —— 每轮读的文件不一样，签名当然不同
  · 同调用同结果 —— 同一个文件最多读了 3 次，阈值是 5

两道数的都是「原地打转」。这一种不是打转，是**一直在往前走但永远不落地**。

## 判据分三类

1. **活路径**（§1）——打在真 HTTP 上，看提醒有没有真的进下一发的 messages。
2. **反向**（§3）——正常「读两三个文件就动手」不许被打扰；一旦写了要清零；
   而且**绝不许掐断**（读源码是正当动作）。
3. **阈值可达**（§一之二）——档位必须小于一回合的轮数预算。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import ControlHarness, llm_tool, new_sid, seed_session, six_fields
from services.action_stationarity import (
    NUDGE_AFTER_READONLY_ROUNDS,
    NUDGE_AGAIN_AFTER_READONLY_ROUNDS,
    ReadOnlyStreak,
)
from services.rehearsal_control import MAX_TOOL_ROUNDS, ControlStopReason

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


# ── 一、纯游标 ────────────────────────────────────────────────────────────


def test_连着只读到档才捅_而且同一档只捅一次():
    streak = ReadOnlyStreak()
    fired = []
    for _ in range(NUDGE_AGAIN_AFTER_READONLY_ROUNDS + 2):
        streak.observe(True)
        fired.append(streak.take_nudge())
    # 第一档、第二档各一次，其余全 False
    assert fired.count(True) == 2
    assert fired[NUDGE_AFTER_READONLY_ROUNDS - 1] is True
    assert fired[NUDGE_AGAIN_AFTER_READONLY_ROUNDS - 1] is True


def test_反向_写了一次就清零_不许接着数():
    """最重要的一条反向：真的落地了，这道闸就该闭嘴。"""
    streak = ReadOnlyStreak()
    for _ in range(NUDGE_AFTER_READONLY_ROUNDS):
        streak.observe(True)
    assert streak.take_nudge() is True

    streak.observe(False)  # 写了一次
    assert streak.rounds == 0
    assert streak.take_nudge() is False
    # 清零之后重新攒够，要能重新被捅——否则一轮里只提醒得了一次。
    for _ in range(NUDGE_AFTER_READONLY_ROUNDS):
        streak.observe(True)
    assert streak.take_nudge() is True


def test_反向_没到档一个字都不出():
    streak = ReadOnlyStreak()
    for _ in range(NUDGE_AFTER_READONLY_ROUNDS - 1):
        streak.observe(True)
        assert streak.take_nudge() is False


def test_提醒必须给一条能立刻执行的出路():
    """只说「该动手了」，模型会再读一轮当作动手。抄 grok nudge 模板的三段：
    观察到什么 + **一条具体的出路** + 代价。

    ⚠ 判据盯的是**语义**不是字面（§2）：出路必须同时满足
      「点名写的那件工具」+「把范围缩到一处」。缺后者最要命——
      「开始写实现」对模型等于「再多读点才敢写」，它会接着翻。

    ⚠ 2026-09-14 变异时逮到：原来只断言 `"project_patch" in text`，
      而首句「一次 project_patch 都没有」里本来就有这个词，
      把整句出路删掉判据照样绿。
    """
    streak = ReadOnlyStreak()
    for _ in range(NUDGE_AFTER_READONLY_ROUNDS):
        streak.observe(True)
    text = streak.nudge_text()
    assert str(NUDGE_AFTER_READONLY_ROUNDS) in text

    # 出路那一段：把观察句（首句）剥掉之后仍然要点名写工具。
    tail = text.split("。", 1)[1]
    assert "file_write" in tail, "剥掉观察句就没有出路了"
    assert "file_str_replace" in tail
    assert "shell_exec" in tail, "没告诉它写完怎么验"
    # 范围收窄：没有这个，模型会继续读到「够了」为止。
    assert any(word in tail for word in ("一个", "最小", "一处")), "没把范围缩到一处"


def test_档位必须够得着():
    """§一之二：档位大于一回合的轮数预算 = 真机上永不成立。"""
    assert NUDGE_AFTER_READONLY_ROUNDS < NUDGE_AGAIN_AFTER_READONLY_ROUNDS
    assert NUDGE_AGAIN_AFTER_READONLY_ROUNDS <= MAX_TOOL_ROUNDS


# ── 二、活路径 ────────────────────────────────────────────────────────────


def _snapshots(harness, impl):
    shots: list = []

    def wrapped(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return impl(messages, **kw)

    harness.llm_impl = wrapped
    return shots


def test_活路径_连着只读时提醒真的进了下一发对话(harness):
    """变异：把 `readonly_streak.take_nudge()` 那段删掉 → 本条红。"""
    sid = new_sid("readonly-nudge")
    _confirmed(sid)
    shots = _snapshots(
        harness,
        lambda messages, **kw: llm_tool(
            "search_evidence", {"query": f"看一眼{len(harness.llm_calls)}"},
            call_id=f"c{len(harness.llm_calls)}",
        ),
    )

    harness.post(six_fields(sid, "帮我查查请假流程"))

    def _has(snapshot) -> bool:
        return any("一次写入都没有" in str(m.get("content") or "")
                   for m in snapshot)

    hits = [i for i, snap in enumerate(shots) if _has(snap)]
    assert hits, f"一次提醒都没贴进去：{len(shots)} 发采样"
    assert hits[0] == NUDGE_AFTER_READONLY_ROUNDS, (
        f"提醒出现在第 {hits[0] + 1} 发，期望第 {NUDGE_AFTER_READONLY_ROUNDS + 1} 发"
    )
    # 贴在工具结果上，不另起 role:user（伪造用户消息那条老伤）。
    carriers = {m.get("role") for m in shots[-1]
                if "一次写入都没有" in str(m.get("content") or "")}
    assert carriers == {"tool"}, carriers


def test_反向_只读不许被掐断_这道闸只捅不掐(harness):
    """**最重要的一条反向。** 读源码是正当动作；把它掐了，「需要多读几轮
    才敢下手」的正常行为就变成了事故。

    变异：给这道闸加一个 should_hard_stop 并接上 → 本条红
    （停因会变成 stationarity，而且轮数到不了 MAX_TOOL_ROUNDS）。
    """
    sid = new_sid("readonly-nostop")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "search_evidence", {"query": f"看一眼{len(harness.llm_calls)}"},
        call_id=f"c{len(harness.llm_calls)}",
    )

    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    stops = [e for e in events
             if e.get("type") == "control_text" and e.get("stopReason")]
    assert len(stops) == 1, stops
    assert stops[0]["stopReason"] == ControlStopReason.TOOL_ROUNDS.value, stops[0]
    assert stops[0]["stopReason"] != ControlStopReason.STATIONARITY.value
    # 走满预算才停 —— 证明这道闸没顺手把回合掐死。
    assert len(harness.llm_calls) == MAX_TOOL_ROUNDS


# ── 三、通电 ──────────────────────────────────────────────────────────────


def test_接在真链路上_不是摆着好看():
    """变异：把 observe / take_nudge / 落库任一处删掉 → 本条红。"""
    import pathlib
    from control_turn_support import strip_python

    src = strip_python(
        pathlib.Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    )
    assert "readonly_streak.observe(step_is_read_only(calls))" in src
    assert "readonly_streak.take_nudge()" in src
    # ⚠ **跨回合**：必须从 state 读出来、写回去。只落 checkpoint 的话，
    #   新的用户消息会让它从零开始——那正是第一版真机一次没响的原因。
    assert "ReadOnlyStreak.from_state(" in src
    assert "state.controlReadOnly = readonly_streak.to_state()" in src
    # ⚠ 必须用 `step_is_read_only`（权威写工具判断），**不许**退回
    #   `_step_is_problematically_repeating`——那个判的是紧档，而工程工具
    #   缺省 READ，会把 project_patch 也算成读（见 tool_writes 头注）。
    assert "readonly_streak.observe(_step_is_problematically_repeating" not in src
    # 落库两头都要在，否则打断一次这道闸就失忆。
    assert "'readonlyStreak': {key: getattr(readonly_streak, key)" in src
    assert "resume.get('readonlyStreak', {})" in src


def test_反向_工程写工具不许被算成只读():
    """2026-09-14 回归当场逮到的那个坑。

    工程工具没进 `TOOL_SCOPE`，按 closed_tools 那条「Absence is treated as
    Read」全都缺省 READ。拿紧档判断当「这一轮没写」，
    `project_create → project_read → project_patch` 会被数成「连着三轮只读」，
    提醒当场误发。
    """
    from services.rehearsal_control import step_is_read_only, tool_writes

    def call(name):
        return {"id": "x", "name": name, "arguments": {}}

    for name in ("project_create", "project_patch", "project_write",
                 "project_str_replace", "file_write", "file_str_replace",
                 "write_file", "search_replace", "shell_exec", "bash",
                 "deploy_expose_port", "browser_navigate",
                 "project_exec", "project_start", "project_verify", "project_restore"):
        assert tool_writes(name) is True, name
        assert step_is_read_only([call(name)]) is False, name

    assert step_is_read_only([call("project_read")]) is True
    assert step_is_read_only([call("file_read")]) is True
    assert step_is_read_only([call("project_list")]) is True
    # 混着写的一轮不算只读。
    assert step_is_read_only([call("project_read"), call("project_patch")]) is False
    # 空轮不是「只读」——没有调用就谈不上。
    assert step_is_read_only([]) is False


# ── 四、跨回合（2026-09-14 换轴之后补的）──────────────────────────────────


def test_跨回合_账要从state还原而不是从零开始():
    """第一版做成回合级游标，真机 `readonly_nudge` 一次都没响。

    按回合拆开量出来：每回合最长只读连胜 = 3，阈值 = 4，每次都差那一轮；
    而降到 3 正好撞上正当排障（status → logs → read）。
    **3 太急、4 够不着 = 轴选错了**，不是数字的问题。
    """
    from services.action_stationarity import ReadOnlyStreak

    # 上一个回合攒了 3 轮
    streak = ReadOnlyStreak.from_state({"rounds": 3, "nudgedAt": 0})
    assert streak.rounds == 3
    # 这个回合再读一轮就该响——回合级游标在这里会是 1，永远响不了
    streak.observe(True)
    assert streak.rounds == NUDGE_AFTER_READONLY_ROUNDS
    assert streak.take_nudge() is True


def test_跨回合_落库形状要能原样往返():
    from services.action_stationarity import ReadOnlyStreak

    streak = ReadOnlyStreak()
    for _ in range(NUDGE_AFTER_READONLY_ROUNDS):
        streak.observe(True)
    streak.take_nudge()
    saved = streak.to_state()
    assert saved == {"rounds": NUDGE_AFTER_READONLY_ROUNDS,
                     "nudgedAt": NUDGE_AFTER_READONLY_ROUNDS}

    import json
    back = ReadOnlyStreak.from_state(json.loads(json.dumps(saved)))
    assert back.rounds == streak.rounds and back.nudged_at == streak.nudged_at
    # 同一档不许再捅一次（否则每个回合都刷一遍屏）
    assert back.take_nudge() is False


def test_跨回合_坏数据一律当没读过_不许抛():
    from services.action_stationarity import ReadOnlyStreak

    for bad in (None, "x", 5, [], {"rounds": "3"}, {"rounds": -1, "nudgedAt": -9}):
        streak = ReadOnlyStreak.from_state(bad)
        assert streak.rounds == 0 and streak.nudged_at == 0


def test_跨回合_两侧模型都要有这个字段():
    """§4：Python 判定 / TypeScript 运行时。少一侧就是「服务端写了、
    客户端 PUT 回来把它抹掉」——这条链上已经栽过一次（continuations）。"""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2]
    import re

    py = (root / "slide-rule-python" / "models" / "v5_state.py").read_text(encoding="utf-8")
    ts = (root / "shared" / "blueprint" / "v5-reasoning-state.ts").read_text(encoding="utf-8")
    # ⚠ 盯**字段声明**，不是盯标识符出现过。两边的注释里都写着这个名字，
    #   光 `"controlReadOnly" in ts` 在字段被删掉之后照样绿——CLAUDE.md §2
    #   点名的第一种形态（「那个词同时出现在文档字符串里」），
    #   2026-09-14 变异时当场逮到。
    assert re.search(r"^\s*controlReadOnly\s*:", py, re.M), "Python 侧字段没了"
    assert re.search(r"^\s*controlReadOnly\??\s*:", ts, re.M), "TS 侧字段没了"
