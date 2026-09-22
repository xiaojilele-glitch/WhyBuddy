# -*- coding: utf-8 -*-
"""第二道打转闸：**同一次调用带回同一份结果**，这一回合里出现了几次。

## 这条判据是哪来的（2026-09-14）

真机 `artifacts/control-real-model/1fcfd3d4`（真 LLM + 真 E2B）复盘时发现：
`IdenticalToolCallRun` 数的是**整一轮**的签名，一轮里只要有一件调用不同，
`run_len` 就清零。而我们的控制面一轮发 4~6 件并行调用：

    轮3  read×6   database / server / main.tsx / application.test / style.css / README.md
    轮4  read×5 + project_status      前五件一模一样，尾巴换了一件
    轮5  read×4   又是前四件

肉眼就是同一批文件读了三遍，`run_len` 一路停在 1——**五件在打转、一件在变，
计数器永远回到 1**。grok 那边这个形状够用，因为它的回合多半是单件调用。

⚠ 说清楚：**那一趟真机并不是打转**。落库的 offset 老老实实 0→2000→4000，
  模型在正经翻页，翻不完是因为读窗只有 2000 字（另见
  `test_project_read_window_fits_real_sources.py`）。这道闸补的是复盘时
  顺手看见的那个洞，**不是那次事故的成因**——别把两件事记混了。

## 为什么判据必须带上「结果」

只看实参的话，真机上第一个被误伤的就是正当轮询：

    project_status(operationId=X)   实参一字不差，结果 queued → running → completed

所以抄 grok `TaskOutputResult::progress_signature`——「两份结果指纹相同才算
停滞」。翻页读（offset 在变）和轮询（status 在变）两种正当重复都靠这条放过。

判据分四类，缺一类这道闸就不算数：

1. **活路径**（§1）——打在真 HTTP 上，不单独调那几个函数。
2. **反向**（§3）——翻页、轮询、正常流量都不许被误伤。
3. **真机载荷**（§一之二）——指纹函数喂真机那一发的**原样** JSON，
   不许自己拼一个干净的。`seq` / `toolCallId` 每发都变，拼一个干净的
   会让这道闸变成永不触发的哑弹，而单测照样绿。
4. **阈值可达**——阈值必须小于总轮数预算。
"""

from __future__ import annotations

import json
import pathlib

import pytest

from control_turn_support import ControlHarness, new_sid, seed_session, six_fields
from services.action_stationarity import (
    MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS,
    MAX_STAGNANT_REPEATS,
    NUDGE_AFTER_STAGNANT_REPEATS,
    StagnantCallLedger,
    call_signature,
    result_fingerprint,
)
from sliderule_llm.control_client import ControlLlmResult
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


def _calls(*specs) -> ControlLlmResult:
    """一轮发好几件并行调用——真机就是这个形状，单件调用测不出这个洞。"""
    return ControlLlmResult(
        content="",
        tool_calls=[{"id": cid, "name": name, "arguments": args}
                    for cid, name, args in specs],
        usage={"total_tokens": 12},
        finish_reason="tool_calls",
        model="ctrl-test",
        latency_ms=1,
    )


# ── 一、活路径：一件在打转、一件在变 ──────────────────────────────────────


def test_一件打转被同轮另一件掩护时_照样掐得住(harness):
    """核心正向：整轮签名每轮都不同（第二件在变），老那道闸永远不响。

    变异咬这条：把 `stagnant_calls.should_hard_stop()` 那段删掉 → 走满 8 轮、
    停因变 tool_rounds。这正是改造前的现状。
    """
    sid = new_sid("stagnant-masked")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        return _calls(
            # 这一件每轮一字不差，结果自然也一样 —— 真正在打转的那件
            ("stuck", "search_evidence", {"query": "同一句"}),
            # 这一件每轮都在变 —— 它让整轮签名每轮都不同
            ("moving", "search_evidence", {"query": f"换一句{n}"}),
        )

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    stops = [e for e in events
             if e.get("type") == "control_text" and e.get("stopReason")]
    assert len(stops) == 1, stops
    [stop] = stops
    assert stop["stopReason"] == ControlStopReason.STATIONARITY.value, stop
    assert stop["stoppedBy"] == "runtime"
    # limit 指认是**哪一道**闸停的：5 是「同一次调用同一份结果」那道，
    # 4 是老的整轮签名那道。两道都叫 stationarity，只能靠这个数分辨。
    assert stop["limit"] == MAX_STAGNANT_REPEATS
    assert stop["limit"] != MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
    assert stop["used"] == MAX_STAGNANT_REPEATS
    assert len(harness.llm_calls) == MAX_STAGNANT_REPEATS
    assert len(harness.llm_calls) < MAX_TOOL_ROUNDS
    # 打转不许点火。
    assert harness.helper_calls == []


def test_捅一下真的贴进了下一发的对话里(harness):
    """中间那一档是真的一档。只断言最后掐断的话，把 take_nudge 删掉照样绿。"""
    import copy

    sid = new_sid("stagnant-nudge")
    _confirmed(sid)
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        n = len(harness.llm_calls)
        return _calls(
            ("stuck", "search_evidence", {"query": "同一句"}),
            ("moving", "search_evidence", {"query": f"换一句{n}"}),
        )

    harness.llm_impl = impl
    harness.post(six_fields(sid, "帮我查查请假流程"))

    def _has(snapshot) -> bool:
        return any("一模一样" in str(m.get("content") or "") for m in snapshot)

    hits = [i for i, snap in enumerate(shots) if _has(snap)]
    assert hits, f"一次提醒都没贴进去：{len(shots)} 发采样"
    assert hits[0] == NUDGE_AFTER_STAGNANT_REPEATS, (
        f"提醒出现在第 {hits[0] + 1} 发，期望第 {NUDGE_AFTER_STAGNANT_REPEATS + 1} 发"
    )
    assert not _has(shots[0])
    # 只捅一次；而且贴在工具结果上，不另起 role:user（伪造用户消息那条老伤）。
    last = shots[-1]
    assert sum(str(m.get("content") or "").count("一模一样") for m in last) == 1
    carriers = {m.get("role") for m in last if "一模一样" in str(m.get("content") or "")}
    assert carriers == {"tool"}, carriers


def test_反向_每轮都在变的正常流量不许被误伤(harness):
    """两件都在变 —— 正常的「一次搜三个角度」。走满预算，不许停成打转。"""
    sid = new_sid("stagnant-vary")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: _calls(
        ("a", "search_evidence", {"query": f"甲{len(harness.llm_calls)}"}),
        ("b", "search_evidence", {"query": f"乙{len(harness.llm_calls)}"}),
    )

    _, events = harness.post(six_fields(sid, "帮我查查请假流程"))

    [stop] = [e for e in events
              if e.get("type") == "control_text" and e.get("stopReason")]
    assert stop["stopReason"] == ControlStopReason.TOOL_ROUNDS.value, stop
    assert len(harness.llm_calls) == MAX_TOOL_ROUNDS


# ── 二、真机载荷：易变字段不许被算成进展（§一之二）────────────────────────

#: 真机那一发的**原样** JSON，从 `wb_control_run.events` 抄下来，一个字没改。
#: 自己拼一个干净的载荷 = 判据替产线把 seq/toolCallId 先擦掉了，
#: 于是「指纹永远不重复」这个哑弹形态测不出来。
_REAL_READ_RESULT = json.loads(r"""
{"content": "// One application process owns this SQLite file.",
 "controlRunId": "ctr-ca9f080df9da504f892a877c923ecc3d",
 "nextOffset": 2000, "offset": 0, "ok": true, "path": "database.mjs",
 "revision": "prv-3c1041f7c8d84bfdbc9cd9038eb24578", "seq": 23,
 "sha256": "a7579ea8ef0b5981ab903074a1b26a057ee5d6513504ed6378d51931aa48ffff",
 "tool": "project_read",
 "toolCallId": "call-eab3c0bb-e6ef-4bac-8b99-a382220feb09-6",
 "totalChars": 7458, "truncated": true, "type": "control_tool_result"}
""")


def test_真机载荷_易变字段不算进展():
    """同一份内容、不同的 seq/toolCallId → 必须是**同一个**指纹。

    ⚠ 这是这道闸最容易写成哑弹的地方。控制面回给模型的 `tool_body` 是整个
      事件（`{k: v for k, v in event.items() if k != "type"}`），`seq` 和
      `toolCallId` 每一发都不同。整包哈希的话指纹永远不重复，闸装上了也
      永远不响。

    变异：把 `_VOLATILE_RESULT_KEYS` 清空 → 本条红。
    """
    later = {**_REAL_READ_RESULT, "seq": 41,
             "toolCallId": "call-eab3c0bb-e6ef-4bac-8b99-a382220feb09-11",
             "controlRunId": "ctr-另一次运行"}
    assert result_fingerprint(_REAL_READ_RESULT) == result_fingerprint(later)


def test_真机载荷_内容变了就是进展():
    """反向：同样从真机那一份出发，只动**有意义**的字段。

    没有这条，上一条可以靠「指纹恒等于常量」作弊通过。
    """
    base = _REAL_READ_RESULT
    assert result_fingerprint(base) != result_fingerprint({**base, "content": "别的内容"})
    assert result_fingerprint(base) != result_fingerprint({**base, "offset": 2000})
    assert result_fingerprint(base) != result_fingerprint({**base, "ok": False})


def test_坏输入不许崩():
    assert result_fingerprint(None) == result_fingerprint(None)
    assert result_fingerprint("不是字典") != result_fingerprint(None)
    assert call_signature(None) == call_signature({})


# ── 三、反向：两种正当重复 ────────────────────────────────────────────────


def _ledger_run(pairs) -> StagnantCallLedger:
    ledger = StagnantCallLedger()
    for call, body in pairs:
        ledger.observe(call_signature(call), result_fingerprint(body))
    return ledger


def test_反向_翻页读不算打转():
    """真机那一趟干的就是这件事：offset 0→2000→4000。

    这是整条改造里最重要的一条反向判据——如果这道闸把翻页也掐了，
    2026-09-14 那一趟不但不会变好，还会更早死。
    """
    pairs = [
        ({"name": "project_read", "arguments": {"path": "database.mjs", "offset": off}},
         {**_REAL_READ_RESULT, "offset": off, "nextOffset": off + 8000,
          "content": f"第 {off} 段", "seq": 20 + i})
        for i, off in enumerate(range(0, 8 * 8000, 8000))
    ]
    assert len(pairs) > MAX_STAGNANT_REPEATS
    ledger = _ledger_run(pairs)
    assert ledger.repeats == 1
    assert not ledger.should_hard_stop()


def test_反向_轮询不算打转():
    """`project_status(operationId=X)` 实参一字不差，结果在推进。

    grok 的 nudge 文案专门给轮询留了出路，正是因为它是正当重复。
    变异：把 `observe` 里比对 fingerprint 那一条去掉（只看实参）→ 本条红。
    """
    call = {"name": "project_status", "arguments": {"operationId": "op-1"}}
    states = ["queued", "running", "running", "installing", "building", "completed"]
    assert len(states) > MAX_STAGNANT_REPEATS
    # 每一发的 status 都在推进；seq 照真机那样每发都变。
    ledger = _ledger_run([
        (call, {"ok": True, "tool": "project_status", "status": st,
                "seq": 30 + i, "toolCallId": f"call-{i}"})
        for i, st in enumerate(states)
    ])
    assert ledger.repeats == 1
    assert not ledger.should_hard_stop()


def test_正向_结果一字不差才算停滞():
    """同一次调用、同一份结果，只有 seq/toolCallId 在变——这就是零信息量。"""
    call = {"name": "project_read", "arguments": {"path": "database.mjs", "offset": 0}}
    ledger = _ledger_run([
        (call, {**_REAL_READ_RESULT, "seq": 20 + i, "toolCallId": f"call-{i}"})
        for i in range(MAX_STAGNANT_REPEATS)
    ])
    assert ledger.repeats == MAX_STAGNANT_REPEATS
    assert ledger.should_hard_stop()


def test_停滞中断后重新起算_而且能被重新捅():
    """结果推进了就是进展，账要清；后面再停滞要能重新被捅一下。"""
    call = {"name": "project_read", "arguments": {"path": "a.mjs", "offset": 0}}
    ledger = _ledger_run([(call, {"ok": True, "content": "一样"})
                          for _ in range(NUDGE_AFTER_STAGNANT_REPEATS)])
    assert ledger.take_nudge() is True
    assert ledger.take_nudge() is False, "一段停滞只许捅一次"

    ledger.observe(call_signature(call), result_fingerprint({"ok": True, "content": "变了"}))
    assert ledger.repeats == 1 and not ledger.should_hard_stop()
    for _ in range(NUDGE_AFTER_STAGNANT_REPEATS - 1):
        ledger.observe(call_signature(call), result_fingerprint({"ok": True, "content": "变了"}))
    assert ledger.take_nudge() is True, "第二段停滞没能重新被捅"


# ── 四、阈值可达 + 落库能还原 ─────────────────────────────────────────────


def test_重复阈值必须够得着():
    """§一之二：阈值大于总轮数预算 = 真机上永不成立，而单测照样绿。"""
    assert MAX_STAGNANT_REPEATS <= MAX_TOOL_ROUNDS
    assert NUDGE_AFTER_STAGNANT_REPEATS < MAX_STAGNANT_REPEATS
    assert MAX_STAGNANT_REPEATS - NUDGE_AFTER_STAGNANT_REPEATS >= 1


def test_游标能原样存进checkpoint再还原():
    """控制面把它当普通 JSON 存进 checkpoint（`__slots__` 逐字段存）。
    存不进去 = 回合被打断后这道闸就失忆了。"""
    call = {"name": "project_read", "arguments": {"path": "a.mjs", "offset": 0}}
    ledger = _ledger_run([(call, {"ok": True, "content": "一样"}) for _ in range(3)])

    saved = json.loads(json.dumps(
        {key: getattr(ledger, key) for key in StagnantCallLedger.__slots__},
        ensure_ascii=False))
    restored = StagnantCallLedger()
    for key, value in saved.items():
        setattr(restored, key, value)

    assert restored.repeats == 3
    restored.observe(call_signature(call), result_fingerprint({"ok": True, "content": "一样"}))
    assert restored.repeats == 4, "还原之后接着数不上，等于每次打断都白送一段"


def test_接在回喂那一处_不是摆着好看():
    """通电（§1）：dispatch 循环必须真的调 observe，喂的必须是 tool_body 原样。

    变异：把调用点删掉 → 本条红（上面那几条活路径判据也会红，这条是
    定位用的：它直接指出是哪一行掉了）。
    """
    from control_turn_support import strip_python

    src = strip_python(
        pathlib.Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    )
    assert "stagnant_calls.observe(call_signature(call), result_fingerprint(tool_body))" in src
    assert "stagnant_calls.should_hard_stop()" in src
    assert "stagnant_calls.take_nudge()" in src
    # 落库两头都要在，否则打断一次这道闸就失忆。
    # ⚠ strip_python 走 ast.unparse，字符串引号会被归一成单引号——
    #   照源码原样写 `"stagnantCalls"` 会永远找不到（假红）。
    assert "'stagnantCalls': {key: getattr(stagnant_calls, key)" in src
    assert "resume.get('stagnantCalls', {})" in src
