"""pendingRuns + 轮级 checkpoint（PR-8 / M14）。

用户看见的失败：一轮 5 能力挂在第 4 个 → 整轮重跑，前 3 个 LLM 白烧。
本文件钉的是持久化地基，不是挑战级局部重跑 UI。

判据纪律：
  · 正向：A、B 完成后 pendingRuns 进盘；崩溃后再跑跳过 A/B，只跑 C。
  · 反向：删掉驱动器里 persist_pending_capability 调用点 → 盘上没有
    pending → 恢复重跑 A/B（本文件从磁盘恢复，不是只测 helper）。
  · 写失败 fail-closed：checkpoint OSError 不许报成功；pending 写失败
    不许接着跑下一个能力。
  · 剥注释后流式主路径必须引用 persist helper / pending skip。
  · 不许引 langgraph；spec-first 七步内部不许做每步 checkpoint。
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import persistence  # noqa: E402
from services.persistence import PersistClosedError, load_session_record  # noqa: E402

CAP_A = "evidence.search"
CAP_B = "risk.analyze"
CAP_C = "report.write"
CAPS = [
    {"capabilityId": CAP_A, "roleId": "agent"},
    {"capabilityId": CAP_B, "roleId": "agent"},
    {"capabilityId": CAP_C, "roleId": "agent"},
]
GOAL = "做一个宠物医院预约管理系统，崩溃恢复不得重烧已完成能力"


def _strip_comments(src: str) -> str:
    """源码去注释去 docstring —— 本文件注释里就写着这些函数名，不剥必然假绿。"""
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def _seeded_state(session_id: str) -> V5SessionState:
    return V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])


def _completed_ids(state) -> list:
    pending = getattr(state, "pendingRuns", None) or {}
    if not isinstance(pending, dict):
        return []
    return [
        c.get("capabilityId")
        for c in (pending.get("completed") or [])
        if isinstance(c, dict) and c.get("capabilityId")
    ]


class _CrashAfterB(Exception):
    """模拟进程在 cap C 之前挂掉。必须在 per-cap except 外面抛，否则 C 仍会开跑。"""


def _stub_drive_loop(driver, monkeypatch, execute, *, parallel=False):
    if parallel:
        # 默认 ON：测 commit helper 路径。unset 走 settings 默认 True。
        monkeypatch.delenv("SLIDERULE_PARALLEL_CAPS", raising=False)
    else:
        monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "off")
    monkeypatch.setenv("SLIDERULE_LLM_ROUND_CAPS", "0")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(driver, "pick_next_capabilities", lambda state, ui="": [dict(p) for p in CAPS])
    monkeypatch.setattr(driver, "pick_repair_capabilities", lambda state: [dict(p) for p in CAPS])
    monkeypatch.setattr(driver, "ensure_closure_pick_by_deadline", lambda state, picks, **k: picks)
    monkeypatch.setattr(driver, "trusted_closure_decision", lambda *a, **k: "continue")
    monkeypatch.setattr(driver, "skip_planning_loop_for_refine", lambda **k: False)
    monkeypatch.setattr(driver, "orchestrate_plan", lambda *a, **k: type("P", (), {"selected": []})())
    monkeypatch.setattr(driver, "reconcile_coverage", lambda state: state)
    monkeypatch.setattr(driver, "evaluate_coverage_gate", lambda state: {"passed": False})
    monkeypatch.setattr(driver, "resolve_coverage_gaps_from_state", lambda state: state)
    monkeypatch.setattr(driver, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state)
    monkeypatch.setattr(driver, "execute_v5_capability", execute)


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    store = tmp_path / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store))
    # persist_state 不传 store_file；有库配置时会走 DB。本文件要钉磁盘上的 pending。
    monkeypatch.setattr(persistence, "_blob_store", lambda store_file=None: None)
    import services.v5_full_driver as driver_mod

    return driver_mod, store


def _run_stream(driver_mod, state, max_loops=1):
    async def _collect():
        events = []
        async for ev in driver_mod.drive_full_v5_session_stream(
            state, max_loops=max_loops, user_instruction=GOAL
        ):
            events.append(ev)
        return events

    return asyncio.run(_collect())


def test_live_stream_driver_references_pending_persist_and_skip():
    """剥注释后，流式主路径必须引用 persist helper 和 skip。删调用点这条就红。"""
    import services.v5_full_driver as drv

    stream = _strip_comments(inspect.getsource(drv.drive_full_v5_session_stream))
    sync = _strip_comments(inspect.getsource(drv.drive_full_v5_session))
    commit = _strip_comments(inspect.getsource(drv._commit_executed_outcome))
    helper = _strip_comments(inspect.getsource(drv.persist_pending_capability))

    # 流式主路径是 `await asyncio.to_thread(persist_pending_capability, ...)`，
    # persist 名字和开括号不在同一 token 上。盯调用形（名字后跟 `,` 或 `(`），
    # 删掉 to_thread 里那个参数这条就红——注释里的同名已被剥掉。
    assert re.search(r"persist_pending_capability\s*[,(]", stream), (
        "流式驱动没在能力结束后落 pending——删调用点必须红，不能只测 helper"
    )
    assert "_apply_pending_run_skips(" in stream
    assert re.search(r"persist_pending_capability\s*[,(]", sync)
    assert "_apply_pending_run_skips(" in sync
    assert re.search(r"persist_pending_capability\s*[,(]", commit)
    # 并行 commit 必须把整批 selected 交给 persist，不能只传 [sel]
    assert re.search(r"persist_pending_capability\(\s*state,\s*cap,\s*loop,\s*batch", commit)
    assert "record_pending_run(" in helper
    # 反面：不是只在注释/docstring 里出现
    assert "langgraph" not in stream.lower()
    assert "langgraph" not in helper.lower()


def test_does_not_import_langgraph_or_checkpoint_spec_first():
    from services import spec_first_pipeline as sfp
    import services.v5_full_driver as drv
    import services.persistence as pers

    for src in (
        _strip_comments(inspect.getsource(pers)),
        _strip_comments(inspect.getsource(drv)),
        _strip_comments(inspect.getsource(sfp)),
    ):
        assert "langgraph" not in src.lower()
    spec_src = _strip_comments(inspect.getsource(sfp))
    assert "persist_pending_capability" not in spec_src
    assert "checkpoints" not in spec_src


def test_crash_after_b_resume_skips_completed_caps(driver, monkeypatch):
    """A、B 完成后崩溃；从磁盘恢复必须跳过 A/B，只跑 C。

    变异：驱动器不调 persist_pending_capability → 盘上 pendingRuns 没有 A/B
    → 本条变红（不是只测 record_pending_run helper）。
    """
    driver_mod, store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    real_persist = driver_mod.persist_pending_capability

    def crash_after_b(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_B:
            raise _CrashAfterB("simulated crash before cap C")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", crash_after_b)

    _run_stream(driver_mod, _seeded_state("sr-pending-crash"))

    assert calls == [CAP_A, CAP_B], f"崩溃前不该跑到 C，实际 {calls}"
    assert CAP_C not in calls

    rec = load_session_record("sr-pending-crash")
    assert rec.get("ok"), rec
    loaded = rec["session"]
    pending_ids = _completed_ids(loaded)
    assert CAP_A in pending_ids and CAP_B in pending_ids, pending_ids
    assert CAP_C not in pending_ids

    raw = json.dumps(json.loads(store.read_text(encoding="utf-8")), ensure_ascii=False)
    assert "pendingRuns" in raw
    assert CAP_A in raw and CAP_B in raw

    first_calls = list(calls)
    calls.clear()
    monkeypatch.setattr(driver_mod, "persist_pending_capability", real_persist)
    _run_stream(driver_mod, loaded)

    assert CAP_A not in calls and CAP_B not in calls, (
        f"恢复重跑了已完成能力（白烧 LLM）: {calls}; 崩溃前={first_calls}"
    )
    assert CAP_C in calls, f"恢复必须跑未完成的 C，实际 {calls}"


def test_new_batch_including_completed_cap_is_not_skipped_forever(driver, monkeypatch):
    """选材变了必须重跑。A 曾经完成 ≠ 下一轮挑 A 就永远跳过。

    变异：skip 忽略 selected 集合、只按 completed 过滤 → A 不跑 → 本条红。
    """
    driver_mod, _store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)
    only_a = [{"capabilityId": CAP_A, "roleId": "agent"}]
    monkeypatch.setattr(driver_mod, "pick_next_capabilities", lambda state, ui="": [dict(p) for p in only_a])
    monkeypatch.setattr(driver_mod, "pick_repair_capabilities", lambda state: [dict(p) for p in only_a])

    state = _seeded_state("sr-pending-new-batch")
    state.pendingRuns = {
        "loop": 0,
        "selected": [CAP_A, CAP_B, CAP_C],
        "completed": [
            {"capabilityId": CAP_A, "status": "ok"},
            {"capabilityId": CAP_B, "status": "ok"},
        ],
    }
    _run_stream(driver_mod, state)
    assert CAP_A in calls, f"新选材含已完成的 A，必须重跑，实际 {calls}"
    assert CAP_B not in calls and CAP_C not in calls


def test_new_goal_with_the_same_selection_reruns_everything(driver, monkeypatch):
    """换了目标就得重跑 —— 哪怕这一轮挑的能力跟上一轮一模一样。

    2026-08-27 评审逮到的：`same_batch` 只看 selected 集合，而 spec-first
    那批选材在相邻两轮经常一模一样。于是「停掉一轮 → 换个需求再发」时，
    上一轮**为旧目标**完成的能力被当成本轮已完成跳掉——新需求的推演里混着
    上一单的产物，没有任何报错。

    ⚠ 反向条在下一个用例（同一个目标恢复时**不许**重跑）。少了那条，
      "永远重跑"照样绿，崩溃恢复就白做了。
    """
    driver_mod, _store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    state = _seeded_state("sr-pending-new-goal")
    # 上一轮为**旧目标**干到一半：A 完成，B/C 没跑
    state.pendingRuns = {
        "turnId": "turn-1",
        "goal": "做一个完全不相干的旧需求：宠物寄养排班",
        "loop": 0,
        "selected": [CAP_A, CAP_B, CAP_C],
        "completed": [{"capabilityId": CAP_A, "status": "ok"}],
    }
    _run_stream(driver_mod, state)
    assert CAP_A in calls, (
        f"换了目标却复用了上一单为旧需求跑出来的 {CAP_A}，实际跑了 {calls}"
    )


def test_same_goal_resume_still_skips_completed(driver, monkeypatch):
    """反向：目标没变（崩溃恢复）就**不许**重跑已完成的。

    跟上一条是一对。只钉"换目标要重跑"的话，把 same_batch 直接写死 False
    照样绿，而那等于把崩溃恢复关掉、前面烧掉的 LLM 全白烧。
    """
    driver_mod, _store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    state = _seeded_state("sr-pending-same-goal")
    state.pendingRuns = {
        "turnId": "turn-1",
        "goal": GOAL,
        "loop": 0,
        "selected": [CAP_A, CAP_B, CAP_C],
        "completed": [{"capabilityId": CAP_A, "status": "ok"}],
    }
    _run_stream(driver_mod, state)
    assert CAP_A not in calls, f"同一个目标恢复却重烧了 {CAP_A}：{calls}"
    assert CAP_B in calls and CAP_C in calls, calls


def test_parallel_commit_path_crash_resume_skips_committed(driver, monkeypatch):
    """默认并行：LLM 在 gather 里花掉，pending 走 _commit_executed_outcome。

    report.write 是屏障段，所以 A/B 并发、C 在 A/B commit 之后。崩在 B 的
    persist 之后，C 还没开跑。恢复仍跳过已落盘的 A/B。
    变异：commit persist 只传 [sel] → pending.selected 缩成单能力 → 恢复
    不认同一批，A/B 重烧。
    """
    driver_mod, store = driver
    calls = []
    selected_seen = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute, parallel=True)
    real_persist = driver_mod.persist_pending_capability

    def crash_after_b(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        ids = []
        for item in selected or []:
            cap = item if isinstance(item, str) else (item.get("capabilityId") if isinstance(item, dict) else None)
            if cap:
                ids.append(cap)
        selected_seen.append((capability_id, ids))
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_B:
            raise _CrashAfterB("simulated crash after parallel commit of B")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", crash_after_b)
    _run_stream(driver_mod, _seeded_state("sr-pending-parallel"))

    assert CAP_A in calls and CAP_B in calls
    assert CAP_C not in calls
    assert any(CAP_A in ids and CAP_B in ids and CAP_C in ids for _, ids in selected_seen), selected_seen

    rec = load_session_record("sr-pending-parallel")
    assert rec.get("ok"), rec
    loaded = rec["session"]
    pending_ids = _completed_ids(loaded)
    assert CAP_A in pending_ids and CAP_B in pending_ids

    calls.clear()
    monkeypatch.setattr(driver_mod, "persist_pending_capability", real_persist)
    _run_stream(driver_mod, loaded)
    assert CAP_A not in calls and CAP_B not in calls, f"并行路径恢复重烧了 {calls}"
    assert CAP_C in calls


def test_pending_write_failure_does_not_run_next_cap(driver, monkeypatch):
    """pending 写失败 fail-closed：不许假装存了然后接着跑 B/C。"""
    driver_mod, _store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    real_persist = driver_mod.persist_pending_capability

    def fail_after_a(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_A:
            raise PersistClosedError("pending_write_failed", "injected OSError")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", fail_after_a)
    _run_stream(driver_mod, _seeded_state("sr-pending-failclosed"))
    assert calls == [CAP_A], f"写失败后仍继续跑了 {calls}"


def test_save_session_writes_checkpoint_with_parent_id(tmp_path):
    store = tmp_path / "sessions.json"
    s1 = V5SessionState(sessionId="s-ckpt", goal={"text": "g1"}, artifacts=[], lastTurnId="turn-1")
    assert persistence.save_session_record(s1, store)["ok"]
    s2 = V5SessionState(sessionId="s-ckpt", goal={"text": "g2"}, artifacts=[], lastTurnId="turn-2")
    assert persistence.save_session_record(s2, store)["ok"]

    ckpt_dir = tmp_path / "checkpoints" / "s-ckpt"
    turn1 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-1.json").read_text(encoding="utf-8"))
    turn2 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-2.json").read_text(encoding="utf-8"))
    assert turn1["id"] == "ckpt-s-ckpt-turn-1"
    assert turn1["parent_id"] is None
    assert turn2["id"] == "ckpt-s-ckpt-turn-2"
    assert turn2["parent_id"] == "ckpt-s-ckpt-turn-1"
    assert turn2["turnId"] == "turn-2"
    assert turn2["state"]["goal"]["text"] == "g2"

    # 同轮覆写必须带真进展（pending.completed 增长），否则 lastTurnId 守卫
    # 会挡掉「只改 goal」的陈旧快照——那是故意的，不是 checkpoint 分叉。
    s2b = V5SessionState(
        sessionId="s-ckpt",
        goal={"text": "g2b"},
        artifacts=[],
        lastTurnId="turn-2",
        pendingRuns={
            "loop": 0,
            "selected": [CAP_A],
            "completed": [{"capabilityId": CAP_A, "status": "ok"}],
        },
    )
    assert persistence.save_session_record(s2b, store)["ok"]
    turn2 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-2.json").read_text(encoding="utf-8"))
    assert turn2["parent_id"] == "ckpt-s-ckpt-turn-1"
    assert turn2["id"] != turn2["parent_id"]
    assert turn2["state"]["goal"]["text"] == "g2b"
    assert CAP_A in json.dumps(turn2["state"].get("pendingRuns") or {})
    # 反面：同轮覆写不得另开文件（父链是覆盖，不是 fork）
    ckpt_files = sorted(p.name for p in ckpt_dir.glob("ckpt-*.json"))
    assert ckpt_files == ["ckpt-s-ckpt-turn-1.json", "ckpt-s-ckpt-turn-2.json"], ckpt_files


def test_checkpoint_write_failure_is_fail_closed(tmp_path, monkeypatch):
    """checkpoint 写失败不许报成功。会话文件可能已经落了，但不能假装存档成了。"""
    store = tmp_path / "sessions.json"

    def boom(path, payload):
        raise OSError("disk full")

    monkeypatch.setattr(persistence, "_atomic_write_json", boom)
    result = persistence.save_session_record(
        V5SessionState(sessionId="s-ckpt-fail", goal={"text": "g"}, artifacts=[], lastTurnId="turn-1"),
        store,
    )
    assert result.get("ok") is False
    assert result.get("reason") == "checkpoint_write_failed"
    # 反面：不能因为会话正文写进去了就当成功
    assert store.exists()


def _pending_ab():
    return {
        "loop": 0,
        "selected": [CAP_A, CAP_B],
        "completed": [
            {"capabilityId": CAP_A, "status": "ok"},
            {"capabilityId": CAP_B, "status": "ok"},
        ],
    }


def test_save_session_checkpoint_failure_does_not_pretend_success(tmp_path, monkeypatch):
    """live service save_session 必须 fail-closed。只测 save_session_record 会假绿。"""
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(persistence, "_blob_store", lambda store_file=None: None)
    from services import slide_rule_session as sess

    monkeypatch.setattr(
        persistence,
        "_atomic_write_json",
        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")),
    )
    with pytest.raises(PersistClosedError) as ei:
        sess.save_session(
            V5SessionState(
                sessionId="s-sess-ckpt-fail",
                goal={"text": "g"},
                artifacts=[],
                lastTurnId="turn-1",
            )
        )
    assert ei.value.reason == "checkpoint_write_failed"
    rec = load_session_record("s-sess-ckpt-fail")
    assert rec.get("ok"), "正文可能已经落了——那也不能把 save_session 当成功"


def test_save_session_record_keeps_prior_pending_when_incoming_blank(tmp_path):
    """incoming pendingRuns=None / {} 不许抹台账。删掉 restore 这条就红。"""
    store = tmp_path / "sessions.json"
    s1 = V5SessionState(
        sessionId="s-keep-pending",
        goal={"text": "g1"},
        artifacts=[],
        lastTurnId="turn-1",
        pendingRuns=_pending_ab(),
    )
    assert persistence.save_session_record(s1, store)["ok"]

    s_none = V5SessionState(
        sessionId="s-keep-pending",
        goal={"text": "g2"},
        artifacts=[],
        lastTurnId="turn-2",
    )
    assert s_none.pendingRuns is None
    assert persistence.save_session_record(s_none, store)["ok"]
    rec = persistence.load_session_record("s-keep-pending", store)
    ids = _completed_ids(rec["session"])
    assert CAP_A in ids and CAP_B in ids, ids

    s_empty = V5SessionState(
        sessionId="s-keep-pending",
        goal={"text": "g3"},
        artifacts=[],
        lastTurnId="turn-3",
        pendingRuns={},
    )
    assert persistence.save_session_record(s_empty, store)["ok"]
    rec = persistence.load_session_record("s-keep-pending", store)
    ids = _completed_ids(rec["session"])
    assert CAP_A in ids and CAP_B in ids, ids


def _pending_abc_all_done():
    return {
        "loop": 0,
        "selected": [CAP_A, CAP_B, CAP_C],
        "completed": [
            {"capabilityId": CAP_A, "status": "ok"},
            {"capabilityId": CAP_B, "status": "ok"},
            {"capabilityId": CAP_C, "status": "ok"},
        ],
    }


def test_all_done_reset_persist_does_not_restore_old_ledger(driver, monkeypatch):
    """整批完成后 skip helper reset completed=[]。同 selected 的缩减必须留下。

    变异：_resolve_write_state 对 inc_done < prior_done 做 restore → 盘上又是
    [A,B,C] → 第二趟崩在 A 之后恢复重烧 A。本条必须红。
    """
    driver_mod, store = driver

    def _assert_empty_ledger(rec, label):
        ids = _completed_ids(rec["session"])
        pending = getattr(rec["session"], "pendingRuns", None) or {}
        assert ids == [], f"{label}: completed must stay empty, got {ids}"
        assert set(pending.get("selected") or []) == {CAP_A, CAP_B, CAP_C}, pending

    # 同 lastTurnId + conversation 增长（同轮守卫会放行）
    s1 = V5SessionState(
        sessionId="s-alldone-reset-same",
        goal={"text": "g1"},
        artifacts=[],
        lastTurnId="turn-1",
        pendingRuns=_pending_abc_all_done(),
        conversation=[],
    )
    assert persistence.save_session_record(s1, store)["ok"]
    s_empty_same = V5SessionState(
        sessionId="s-alldone-reset-same",
        goal={"text": "g1"},
        artifacts=[],
        lastTurnId="turn-1",
        conversation=[{"role": "user", "content": "same pick again"}],
        pendingRuns={
            "loop": 1,
            "selected": [CAP_A, CAP_B, CAP_C],
            "completed": [],
        },
    )
    assert persistence.save_session_record(s_empty_same, store)["ok"]
    rec = persistence.load_session_record("s-alldone-reset-same", store)
    _assert_empty_ledger(rec, "same-turn completed=[]")

    s_a_same = V5SessionState(
        sessionId="s-alldone-reset-same",
        goal={"text": "g1"},
        artifacts=[{"id": "art-a"}],
        lastTurnId="turn-1",
        conversation=[
            {"role": "user", "content": "same pick again"},
            {"role": "assistant", "content": "A done"},
        ],
        pendingRuns={
            "loop": 1,
            "selected": [CAP_A, CAP_B, CAP_C],
            "completed": [{"capabilityId": CAP_A, "status": "ok"}],
        },
    )
    assert persistence.save_session_record(s_a_same, store)["ok"]
    rec = persistence.load_session_record("s-alldone-reset-same", store)
    ids = _completed_ids(rec["session"])
    assert CAP_A in ids and CAP_B not in ids and CAP_C not in ids, ids

    # 新 lastTurnId（用户重发同一句）
    s2 = V5SessionState(
        sessionId="s-alldone-reset-new",
        goal={"text": "g1"},
        artifacts=[],
        lastTurnId="turn-1",
        pendingRuns=_pending_abc_all_done(),
    )
    assert persistence.save_session_record(s2, store)["ok"]
    s_empty_new = V5SessionState(
        sessionId="s-alldone-reset-new",
        goal={"text": "g2"},
        artifacts=[],
        lastTurnId="turn-2",
        pendingRuns={
            "loop": 1,
            "selected": [CAP_A, CAP_B, CAP_C],
            "completed": [],
        },
    )
    assert persistence.save_session_record(s_empty_new, store)["ok"]
    rec = persistence.load_session_record("s-alldone-reset-new", store)
    _assert_empty_ledger(rec, "new-turn completed=[]")

    # 活路径：all-done 在盘上，第二趟跑 A 后崩，恢复必须跳过 A 而不是重烧。
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)
    live = _seeded_state("sr-pending-alldone-reset")
    live.lastTurnId = "turn-1"
    live.pendingRuns = _pending_abc_all_done()
    assert persistence.save_session_record(live, store)["ok"]

    real_persist = driver_mod.persist_pending_capability

    def crash_after_a(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_A:
            raise _CrashAfterB("simulated crash after A of second pass")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", crash_after_a)
    rec = load_session_record("sr-pending-alldone-reset")
    _run_stream(driver_mod, rec["session"])
    assert calls == [CAP_A], f"第二趟崩前只该跑 A，实际 {calls}"

    rec = load_session_record("sr-pending-alldone-reset")
    ids = _completed_ids(rec["session"])
    assert CAP_A in ids and CAP_B not in ids and CAP_C not in ids, (
        f"all-done restore clobbered second-pass ledger: {ids}"
    )

    calls.clear()
    monkeypatch.setattr(driver_mod, "persist_pending_capability", real_persist)
    _run_stream(driver_mod, rec["session"])
    assert CAP_A not in calls, f"第二趟恢复重烧了 A: {calls}"
    assert CAP_B in calls and CAP_C in calls, f"恢复必须跑 B/C，实际 {calls}"


def test_put_route_excludes_pending_runs_and_save_session_raises():
    """剥注释：PUT 必须 pop/exclude pendingRuns；save_session 必须对 checkpoint 抛错。"""
    from routes import sliderule_full as routes
    from services import slide_rule_session as sess

    put_src = _strip_comments(inspect.getsource(routes.save_sess))
    save_src = _strip_comments(inspect.getsource(sess.save_session))
    assert 'pop("pendingRuns"' in put_src
    assert '"pendingRuns"' in put_src
    assert "checkpoint_write_failed" in save_src
    assert "PersistClosedError" in save_src
    # 反面：不是只在注释里写了 pendingRuns
    assert "langgraph" not in put_src.lower()


def test_put_without_pending_runs_does_not_wipe_cache(tmp_path, monkeypatch):
    """PUT 不带 pendingRuns / 带 {}：缓存不得被 setattr 成空台账。

    模拟库削页 memory-ahead：save 回读磁盘（restore 保住台账）之后仍可能
    把内存里那份抹掉的对象塞回 _sessions。pop+exclude 是这一闸。
    """
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(persistence, "_blob_store", lambda store_file=None: None)
    from services import slide_rule_session as sess
    from conftest import TEST_USER_ID

    sid = "sr-put-keep-pending"
    seeded = V5SessionState(
        sessionId=sid,
        goal={"text": GOAL},
        artifacts=[],
        lastTurnId="turn-1",
        pendingRuns=_pending_ab(),
        ownerId=TEST_USER_ID,
    )
    sess.save_session(seeded)
    monkeypatch.setattr(sess, "_memory_ahead_of_store", lambda mem, disk: True)

    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app import app

    client = TestClient(app)
    key = {"x-internal-key": "dev-slide-rule-internal"}
    body = {"sessionId": sid, "goal": {"text": GOAL}, "lastTurnId": "turn-2"}
    resp = client.put(f"/api/sliderule/sessions/{sid}", json=body, headers=key)
    assert resp.status_code == 200, resp.text
    loaded = sess.load_session(sid)
    ids = _completed_ids(loaded)
    assert CAP_A in ids and CAP_B in ids, ids

    resp_empty = client.put(
        f"/api/sliderule/sessions/{sid}",
        json={**body, "pendingRuns": {}, "lastTurnId": "turn-3"},
        headers=key,
    )
    assert resp_empty.status_code == 200, resp_empty.text
    loaded = sess.load_session(sid)
    ids = _completed_ids(loaded)
    assert CAP_A in ids and CAP_B in ids, ids


def test_persist_pending_none_result_is_fail_closed(driver, monkeypatch):
    driver_mod, _store = driver
    monkeypatch.setattr(driver_mod, "persist_state", lambda state: None)
    with pytest.raises(PersistClosedError):
        driver_mod.persist_pending_capability(_seeded_state("sr-none-persist"), CAP_A)
