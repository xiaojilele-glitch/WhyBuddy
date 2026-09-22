"""工厂 hop 是独立 WRITE：pending / repeat / run id 按工具名分开。

2026-09-03 真机（sr-20260903100454-XNDW5W2M59 团子的一天）：
pages 已经写了两条 `run-0-appbundle.runtimeClosure`，structure 再 pick
同一条信封 → max_repeat_guard 整跳跳过，画布「打过孔但没填上数据」，
控制面还说 bind 做完了。

抄 grok：每一跳是一件 WRITE Terminal。信封 runtimeClosure 不是 hop 自己。

判据纪律：
  · 正向：pages 的 repeat/pending 之后，structure 仍执行 factory.structure。
  · 反向：host hop 仍 pick runtimeClosure → 本文件红。
  · 反向：同一跳崩溃恢复仍跳过已完成的（不许把 pending 整本清掉）。
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.closed_tools import factory_capability_id  # noqa: E402

GOAL = "团子的一天情侣手帐"


def _strip(src: str) -> str:
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def _run(run_id: str, cap: str) -> dict:
    return {"id": run_id, "capabilityId": cap, "turnId": "loop-0"}


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "off")
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    monkeypatch.setenv("SLIDERULE_LLM_ROUND_CAPS", "0")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_full_driver as driver_mod

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
    monkeypatch.setattr(driver_mod, "orchestrate_plan", lambda *a, **k: type("P", (), {"selected": []})())
    monkeypatch.setattr(driver_mod, "reconcile_coverage", lambda state: state)
    monkeypatch.setattr(driver_mod, "evaluate_coverage_gate", lambda state: {"passed": False})
    monkeypatch.setattr(driver_mod, "resolve_coverage_gaps_from_state", lambda state: state)
    monkeypatch.setattr(driver_mod, "skip_planning_loop_for_refine", lambda **k: False)
    monkeypatch.setattr(driver_mod, "trusted_closure_decision", lambda *a, **k: "continue")
    monkeypatch.setattr(driver_mod, "ensure_closure_pick_by_deadline", lambda state, picks, **k: picks)
    return driver_mod


def _drive(driver_mod, state):
    async def _collect():
        events = []
        async for ev in driver_mod.drive_full_v5_session_stream(
            state,
            max_loops=1,
            user_instruction=GOAL,
            profile="app",
        ):
            events.append(ev)
        return events

    return asyncio.run(_collect())


def _hop_state(hop: str) -> V5SessionState:
    """某一跳的会话态。判据要按跳分别验，不能只验 structure 一种。"""
    return V5SessionState(
        sessionId="hop-ledger",
        goal={"text": GOAL, "status": "clear", "tools": [hop]},
        artifacts=[],
    )


def _structure_state(**extra) -> V5SessionState:
    goal = {"text": GOAL, "status": "clear", "tools": ["structure"]}
    return V5SessionState(sessionId="hop-ledger", goal=goal, artifacts=[], **extra)


def test_stream_picks_host_hop_identity_not_the_envelope():
    """剥注释：host hop 必须走 _host_hop_picks。改回硬编码 runtimeClosure 这条红。"""
    import services.v5_full_driver as drv

    stream = _strip(inspect.getsource(drv.drive_full_v5_session_stream))
    helper = _strip(inspect.getsource(drv._host_hop_picks))
    skip = _strip(inspect.getsource(drv._apply_pending_run_skips))
    ensure = _strip(inspect.getsource(drv._ensure_runtime_closure_evidence))
    assert "_host_hop_picks(" in stream
    assert "factory_capability_id" in helper
    # ⚠ 2026-09-04 收窄：原来是「helper 里一个 runtimeClosure 都不许有」。
    #   这条钉的事故是 2026-09-03（团子 XNDW5W2M59）**五跳全 pick 信封**
    #   → pages 写了两条之后 structure 被 max_repeat_guard 整跳跳过。
    #   而发布判定挪到产出链末尾之后，`closure` 那一跳**就该**建信封
    #   （见 _host_hop_picks 头注：判定是 Terminal，Terminal 在最后）。
    #   所以判据从"字面上不许出现"改成"四个产出跳不许拿到它"——
    #   盯的是事故本身，不是某个字符串。
    from services.v5_full_driver import _host_hop_picks

    for hop in ("spec", "pages", "structure", "bind"):
        got = [
            p["capabilityId"]
            for p in _host_hop_picks(_hop_state(hop))
        ]
        assert got == [f"factory.{hop}"], f"{hop} 跳的账本身份不对：{got}"
        assert "appbundle.runtimeClosure" not in got, (
            f"{hop} 跳又去 pick 信封了——max_repeat_guard 会把后面的跳整跳跳过"
        )
    assert [
        p["capabilityId"] for p in _host_hop_picks(_hop_state("closure"))
    ] == ["appbundle.runtimeClosure"], "closure 跳必须建信封，否则合格证发不出"
    assert "_pending_batch_key(" in skip
    assert "factory-hop:" in _strip(inspect.getsource(drv._pending_batch_key))
    assert "_capability_ran(" in ensure
    assert "hop_cap" in ensure
    assert "_first_pass_chain(" in ensure


def test_structure_after_pages_envelope_is_not_repeat_exhausted(driver, monkeypatch):
    """真机形状：pages 已经写了两条 runtimeClosure + pending 完成。

    变异：host hop 仍 pick 信封 → is_repeat_exhausted → 本条 calls 空。
    """
    driver_mod = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": "stub",
            "content": "stub",
            "provenance": "python-rag",
            "sources": [],
        }

    monkeypatch.setattr(driver_mod, "execute_v5_capability", execute)

    envelope = "appbundle.runtimeClosure"
    state = _structure_state(
        capabilityRuns=[
            _run("run-0-appbundle.runtimeClosure", envelope),
            _run("run-1-appbundle.runtimeClosure", envelope),
            _run("run-0-factory.pages", factory_capability_id("pages")),
            _run("run-1-factory.pages", factory_capability_id("pages")),
        ],
        pendingRuns={
            "turnId": "turn-2",
            "goal": GOAL,
            "loop": 0,
            "selected": [envelope],
            "completed": [{"capabilityId": envelope, "status": "ok"}],
        },
    )
    _drive(driver_mod, state)
    want = factory_capability_id("structure")
    assert calls == [want], (
        f"structure 被 pages 的信封跳过了：实际 {calls}。每一跳必须是独立 WRITE。"
    )
    run_ids = [
        r.get("id") if isinstance(r, dict) else getattr(r, "id", None)
        for r in (state.capabilityRuns or [])
    ]
    assert any(want in str(i) for i in run_ids), f"structure 没写下自己的 run id：{run_ids}"
    pages_ids = {i for i in run_ids if i and "pages" in str(i)}
    struct_ids = {i for i in run_ids if i and "structure" in str(i)}
    assert pages_ids.isdisjoint(struct_ids), (
        f"pages/structure 的 id 撞了：{pages_ids & struct_ids}"
    )


def test_pending_batch_key_namespaces_by_hop():
    """同一目标、不同 hop 必须是两批。只认 goal 文本，pages 的 pending 会吞掉 structure。

    单跳整批完成后本来就会开新账本（正当重跑）；反向钉的是「换跳不是同一批」。
    """
    import services.v5_full_driver as drv

    pages = V5SessionState(sessionId="k-pages", goal={"text": GOAL, "tools": ["pages"]})
    structure = V5SessionState(
        sessionId="k-struct", goal={"text": GOAL, "tools": ["structure"]}
    )
    full = V5SessionState(
        sessionId="k-full", goal={"text": GOAL, "tools": ["spec", "pages"]}
    )
    k_pages = drv._pending_batch_key(pages)
    k_struct = drv._pending_batch_key(structure)
    k_full = drv._pending_batch_key(full)
    assert k_pages != k_struct, f"pages/structure 批次键撞了：{k_pages!r}"
    assert "structure" in k_struct
    assert "pages" in k_pages
    assert k_full == GOAL, f"非整跳不该带 hop 后缀：{k_full!r}"


def test_executor_treats_factory_structure_as_spec_first_path():
    src = _strip(inspect.getsource(
        __import__("services.v5_capability_executor", fromlist=["execute_v5_capability"])
        .execute_v5_capability
    ))
    assert "hop_from_factory_capability" in src
