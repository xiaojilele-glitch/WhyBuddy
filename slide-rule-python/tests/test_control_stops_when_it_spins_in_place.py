# -*- coding: utf-8 -*-
"""原地打转：同一件工具、同一份实参连着调，先捅一下，再掐断。

抄的标准答案：grok-build
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs`

    loop {
        self.emit_event(Event::LoopStarted { loop_index });
        loop_index += 1;
        if identical_tool_calls.run_len >= identical_tool_calls.hard_stop_threshold() { … }
        if identical_tool_calls.take_nudge() { … }
        …然后才去采样

改造前我们只有 `MAX_TOOL_ROUNDS = 8` 一道兜底：**「在往前走但走不到头」和
「根本没在走」是同一句话**——用户读到的都是「来回想了好几轮还没定下来，
把需求说具体一点」，而后一种跟他把话说得清不清楚毫无关系。

判据分三类，缺一类这条改造就白做：

1. **活路径**（CLAUDE.md §1）——打在真 HTTP 上（`ControlHarness` 走
   `/api/sliderule/control-turn-stream`），不单独调那几个函数。
   只直接调函数的判据证明不了「它接在链路上」。
2. **反向**（§3）——实参会变的重复**不许**被判成打转；捅完改口**不许**再掐。
   只写正向的话，把阈值改成 1 也全绿。
3. **阈值可达**（§一之二）——`test_硬停阈值必须够得着` 钉死
   「阈值 < 总轮数预算」。照抄 grok 的 4/8/8/12 会让硬停在真机上永远不成立
   （grok 的 max_turns 默认是 None，我们是 8），单测却照样绿。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import (
    ControlHarness,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.action_stationarity import (
    MAX_CONSECUTIVE_IDENTICAL_CALLS,
    MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS,
    NUDGE_AFTER_IDENTICAL_CALLS,
    NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS,
    IdenticalToolCallRun,
    step_signature,
    step_tool_name,
)
from services.rehearsal_control import (
    MAX_TOOL_ROUNDS,
    ControlStopReason,
    _step_is_problematically_repeating,
    stop_text,
)

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


def _stops(events) -> list:
    return [
        {k: e.get(k) for k in ("stopReason", "stoppedBy", "limit", "used")}
        for e in events
        if e.get("type") == "control_text" and e.get("stopReason")
    ]


def _texts(events) -> list:
    return [e.get("text") for e in events if e.get("type") == "control_text"]


def _snapshotting(harness, impl):
    """每一发采样前把 messages 拍一张快照。

    ⚠ `harness.llm_calls` 里存的是**同一个 list 对象**（控制面就地改它），
      直接读它拿到的四条记录内容一模一样——照它写「第 3 轮才有提醒」
      会永远绿。所以在这儿深拷贝。
    """
    shots: list = []

    def wrapped(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return impl(messages, **kw)

    harness.llm_impl = wrapped
    return shots


# ── 一、活路径：连着调同一件读工具 ────────────────────────────────────────


def test_同一件读工具连着调_停成打转而不是轮次到顶(harness):
    """真机形态：模型认死一次 `search_evidence`，实参一字不差。"""
    sid = new_sid("spin-read")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "search_evidence", {"query": "请假流程"}, call_id="same"
    )

    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.STATIONARITY.value, stop
    # 反向：**不许**再被塌进「轮次到顶」那句话里——那正是改造前的现状。
    assert stop["stopReason"] != ControlStopReason.TOOL_ROUNDS.value
    assert stop["stoppedBy"] == "runtime"
    # 光说「打转了」没法行动：带上「紧档上限 4 / 已经连了 4 轮」才知道该不该调这个数。
    assert stop["limit"] == MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
    assert stop["used"] == MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
    assert stop_text(ControlStopReason.STATIONARITY) in _texts(events)
    # 变异咬这一条：把 should_hard_stop 那段删掉 → 走满 8 轮、停因变 tool_rounds。
    assert len(harness.llm_calls) == MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
    assert len(harness.llm_calls) < MAX_TOOL_ROUNDS
    # 打转不许点火。
    assert harness.helper_calls == []


def test_捅一下真的贴进了下一发的对话里(harness):
    """中间那一档是**真的一档**：提醒必须出现在模型下一发看得见的 messages 里。

    只断言「最后停成 stationarity」的话，把 take_nudge 整段删掉照样绿——
    那样就只剩硬停，等于这次改造只做了一半。
    """
    sid = new_sid("spin-nudge")
    _confirmed(sid)
    shots = _snapshotting(
        harness,
        lambda messages, **kw: llm_tool(
            "search_evidence", {"query": "请假流程"}, call_id="same"
        ),
    )

    harness.post(six_fields(sid, "帮我查查请假流程"))

    def _has_nudge(snapshot) -> bool:
        return any(
            "原地打转" in str(m.get("content") or "")
            and "system-reminder" in str(m.get("content") or "")
            for m in snapshot
        )

    hits = [i for i, snap in enumerate(shots) if _has_nudge(snap)]
    # 第 1、2 发时 run_len 还没到 2，不许有提醒。
    assert hits, f"一次提醒都没贴进去：{len(shots)} 发采样"
    assert hits[0] == NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS, (
        f"提醒出现在第 {hits[0] + 1} 发，期望第 "
        f"{NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS + 1} 发"
    )
    assert not _has_nudge(shots[0])

    # 只捅一次：提醒是**贴在对话上**的，后面几发当然还带着它，
    # 但整段对话里它只许出现一份。贴两遍 = take_nudge 的 once-per-run 破了。
    last = shots[-1]
    assert sum(str(m.get("content") or "").count("原地打转") for m in last) == 1

    # 贴在工具结果上，不许另起一条 role:user（伪造用户消息那条老伤）。
    carriers = {
        m.get("role") for m in last if "原地打转" in str(m.get("content") or "")
    }
    assert carriers == {"tool"}, carriers


def test_捅完改口就不再掐_中间那一档不是延迟版硬停(harness):
    """反向：捅一下之后模型换了实参 → 走完正常流程，不许停成打转。"""
    sid = new_sid("spin-recover")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        # 前 3 发认死同一次调用（足够触发捅一下），之后改口。
        if n <= NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS:
            return llm_tool("search_evidence", {"query": "同一句"}, call_id="same")
        return llm_tool("search_evidence", {"query": f"换一句{n}"}, call_id=f"c{n}")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    stops = _stops(events)
    assert all(
        s["stopReason"] != ControlStopReason.STATIONARITY.value for s in stops
    ), stops
    # 改口之后按正常预算跑到轮次到顶——证明捅一下没有顺手把回合掐死。
    assert len(harness.llm_calls) == MAX_TOOL_ROUNDS


def test_实参会变的重复不算打转(harness):
    """反向：同一件工具但每轮换实参（真机上「一次搜三个角度」就是这样）。"""
    sid = new_sid("spin-vary")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "search_evidence",
        {"query": f"q{len(harness.llm_calls)}"},
        call_id=f"c{len(harness.llm_calls)}",
    )

    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    [stop] = _stops(events)
    assert stop["stopReason"] == ControlStopReason.TOOL_ROUNDS.value, stop
    assert len(harness.llm_calls) == MAX_TOOL_ROUNDS


# ── 二、阈值必须够得着（CLAUDE.md §一之二）────────────────────────────────


def test_硬停阈值必须够得着():
    """照抄 grok 的 4/8/8/12 → 这条红。

    grok 的 `max_turns` 默认 `None`（不限轮），所以「连续 12 次」是个正常数字；
    我们的控制面一回合最多 8 轮，12 在真机上**永远不成立**，8 要烧掉整个预算
    才可能碰一次。护栏装在真跑的路上、条件恒假、单测还绿——正是本仓 §一之二
    那一夜连栽两次的形态。
    """
    assert MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS <= MAX_TOOL_ROUNDS
    assert MAX_CONSECUTIVE_IDENTICAL_CALLS <= MAX_TOOL_ROUNDS


def test_捅一下必须留出改口的余地():
    """捅完立刻掐 = 中间那一档不存在。两档之间至少要有一轮让模型改口，
    而且改口那一轮得装得进 8 轮预算里。"""
    for nudge, stop in (
        (NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS,
         MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS),
        (NUDGE_AFTER_IDENTICAL_CALLS, MAX_CONSECUTIVE_IDENTICAL_CALLS),
    ):
        assert nudge < stop, (nudge, stop)
        assert stop - nudge >= 1
        assert stop <= MAX_TOOL_ROUNDS


def test_紧档比宽档严():
    assert (
        NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS < NUDGE_AFTER_IDENTICAL_CALLS
    )
    assert (
        MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS < MAX_CONSECUTIVE_IDENTICAL_CALLS
    )


# ── 三、签名与分档 ────────────────────────────────────────────────────────


def _call(name: str, args: dict) -> dict:
    """真机那一发的原样形状：控制面手里的 call 就是这三个键。"""
    return {"id": "x", "name": name, "arguments": args}


def test_键序不同算同一次调用():
    a = step_signature([_call("inspect_model", {"kind": "pages", "limit": 5})])
    b = step_signature([_call("inspect_model", {"limit": 5, "kind": "pages"})])
    assert a == b


def test_数组顺序变了算新的一次():
    """抄 grok `canonicalize_json` 那句：数组顺序是语义的，重排是真的改动。"""
    a = step_signature([_call("inspect_model", {"ids": ["p1", "p2"]})])
    b = step_signature([_call("inspect_model", {"ids": ["p2", "p1"]})])
    assert a != b


def test_并行调用换顺序算同一轮():
    a = step_signature([_call("inspect_model", {}), _call("search_evidence", {})])
    b = step_signature([_call("search_evidence", {}), _call("inspect_model", {})])
    assert a == b


def test_实参不一样就是不一样():
    a = step_signature([_call("search_evidence", {"query": "甲"})])
    b = step_signature([_call("search_evidence", {"query": "乙"})])
    assert a != b


def test_代表名取得稳定():
    assert step_tool_name(
        [_call("search_evidence", {}), _call("inspect_model", {})]
    ) == step_tool_name(
        [_call("inspect_model", {}), _call("search_evidence", {})]
    )


def test_分档按声明的权限判_不按名字判():
    """全是 READ → 紧档；掺一件 WRITE → 宽档。

    抄 grok `step_is_problematically_repeating` 那两条理由：
    要求**每一件**都是 READ（其中一件本来就可能正当重复，整轮跟着算正当），
    以及按注册的权限判、不按 wire 名判（名字会改，权限表不会）。
    """
    assert _step_is_problematically_repeating(
        [_call("inspect_model", {}), _call("search_evidence", {})]
    )
    assert not _step_is_problematically_repeating(
        [_call("inspect_model", {}), _call("spec", {})]
    )
    assert not _step_is_problematically_repeating([_call("spec", {})])
    # 空轮不是「重复的调用」。
    assert not _step_is_problematically_repeating([])
    # 查不到权限的名字缺省 READ（closed_tools 那条「Absence is treated as
    # Read」），但它落在紧档还是宽档由缺省决定，这里只钉住不许抛。
    assert _step_is_problematically_repeating([_call("以后新加的工具", {})]) in (
        True,
        False,
    )


def test_一段打转只捅一次_换了签名重新开始():
    run = IdenticalToolCallRun()
    sig = step_signature([_call("inspect_model", {"kind": "pages"})])
    for _ in range(MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS):
        run.observe(sig, "inspect_model", True)
    fired = [run.take_nudge() for _ in range(3)]
    assert fired == [True, False, False]
    assert run.should_hard_stop()

    other = step_signature([_call("inspect_model", {"kind": "nodes"})])
    assert run.observe(other, "inspect_model", True) == 1
    assert not run.should_hard_stop()
    # 换了签名要把「捅过了」清掉，否则第二段打转永远不会被捅。
    run.observe(other, "inspect_model", True)
    assert run.take_nudge() is True
