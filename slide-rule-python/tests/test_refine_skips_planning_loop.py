# -*- coding: utf-8 -*-
"""精修轮跳过规划循环，直进 appbundle.runtimeClosure（2026-08-18 篮球馆）。

真机 sr-20260818033315：enter_refine_mode 已经在循环前设了上下文，
但循环照跑 intent.parse / risk / handoff。agentic pick 两圈覆盖同一
art-0-* → no_progress，说明书改了、页没动。

Aider 的 /code 是进门就定 edit。这里同理：精修模式一旦成立，
while 第一行就 break，收口仍由循环后的 _ensure_runtime_closure_evidence 跑。

删掉 break / skip_planning_loop_for_refine，下面必红。
首轮（无基线 / 指令==话题）不许被这条短路——那是代价判据。
"""

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_full_driver as driver  # noqa: E402
from services.v5_llm_generate import get_refine_context, set_refine_context  # noqa: E402

GOAL = "社区篮球馆半场预约与会员积分"
INSTR = "预约台超时未到的场次给红标"
MODEL = {"datamodel": {"entities": [{"id": "court"}]}, "page": {"pages": []}}


@pytest.fixture(autouse=True)
def _clean():
    set_refine_context(None)
    yield
    set_refine_context(None)


def _ledger_ids(state: V5SessionState):
    out = []
    for d in getattr(state, "decisionLedger", []) or []:
        out.append(d.id if hasattr(d, "id") else d.get("id"))
    return out


def test_skip_helper_true_only_when_refine_context_and_not_repair():
    assert driver.skip_planning_loop_for_refine(repair=False) is False
    set_refine_context(MODEL, INSTR)
    assert driver.skip_planning_loop_for_refine(repair=False) is True
    assert driver.skip_planning_loop_for_refine(repair=True) is False


def test_refine_drive_skips_pick_and_still_closes(monkeypatch):
    """有基线 + 新指令 → 不 pick / 不 orchestrate，但收口必须跑。"""
    calls = []
    monkeypatch.setattr(driver, "persist_state", lambda s: None)
    monkeypatch.setattr(
        driver,
        "orchestrate_plan",
        lambda *a, **k: calls.append("plan") or type("P", (), {"selected": []})(),
    )
    monkeypatch.setattr(
        driver,
        "pick_next_capabilities",
        lambda *a, **k: calls.append("pick") or [],
    )

    def _ensure(state, *a, **k):
        calls.append("closure")
        return state

    monkeypatch.setattr(driver, "_ensure_runtime_closure_evidence", _ensure)

    st = V5SessionState(
        sessionId="t-refine-skip",
        goal={"text": GOAL, "status": "needs_refinement"},
    )
    st.modelVersions = [{"id": "mv-1", "model": MODEL}]
    driver.drive_full_v5_session(st, max_loops=3, user_instruction=INSTR)

    assert "pick" not in calls, f"精修还在选材：{calls}"
    assert "plan" not in calls, f"精修还在规划：{calls}"
    assert "closure" in calls, "跳过循环后没收口——局部打孔那条没接到电"
    assert "dec-0-refine-skip-planning" in _ledger_ids(st)
    skipped_caps = []
    for d in st.decisionLedger:
        if getattr(d, "id", None) == "dec-0-refine-skip-planning":
            skipped_caps = [x.get("capabilityId") for x in (d.skipped or [])]
    assert "intent.parse" in skipped_caps
    assert "risk.analyze" in skipped_caps
    assert "handoff.package" in skipped_caps
    narrs = getattr(st, "turnNarrations", None) or []
    assert narrs, "精修跑完步骤没进会话——刷新又是 0 步"
    labels = [
        str(step.get("label") or step.get("text") or "")
        for step in (narrs[-1].get("steps") or [])
    ]
    assert any("指令已接收" in text for text in labels)
    assert any("精修" in text and "跳过规划" in text for text in labels)
    assert not any("正在理解你的目标" in text for text in labels), (
        "精修叙述里冒出了规划步——events_cursor 没截住上一趟"
    )


def test_first_turn_still_runs_the_planning_loop(monkeypatch):
    """无基线 = 首轮，不许跳过规划。"""
    calls = []
    monkeypatch.setattr(driver, "persist_state", lambda s: None)
    monkeypatch.setattr(
        driver,
        "orchestrate_plan",
        lambda *a, **k: calls.append("plan") or type("P", (), {"selected": []})(),
    )
    monkeypatch.setattr(
        driver,
        "pick_next_capabilities",
        lambda *a, **k: calls.append("pick") or [],
    )
    monkeypatch.setattr(
        driver, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
    )

    st = V5SessionState(
        sessionId="t-first-no-skip",
        goal={"text": GOAL, "status": "needs_refinement"},
    )
    driver.drive_full_v5_session(st, max_loops=1, user_instruction=INSTR)

    assert "pick" in calls, "首轮规划被精修短路了——从零生成没人拆意图"
    assert "dec-0-refine-skip-planning" not in _ledger_ids(st)
    assert get_refine_context() is None


def test_same_text_as_topic_is_rerun_not_skip(monkeypatch):
    """指令 == 话题 = 重新推演，即使有版本史也不跳规划。"""
    calls = []
    monkeypatch.setattr(driver, "persist_state", lambda s: None)
    monkeypatch.setattr(
        driver,
        "orchestrate_plan",
        lambda *a, **k: calls.append("plan") or type("P", (), {"selected": []})(),
    )
    monkeypatch.setattr(
        driver,
        "pick_next_capabilities",
        lambda *a, **k: calls.append("pick") or [],
    )
    monkeypatch.setattr(
        driver, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
    )

    st = V5SessionState(
        sessionId="t-rerun-no-skip",
        goal={"text": GOAL, "status": "needs_refinement"},
    )
    st.modelVersions = [{"id": "mv-1", "model": MODEL}]
    driver.drive_full_v5_session(st, max_loops=1, user_instruction=GOAL)

    assert "pick" in calls, "重新推演被当成精修跳过了"
    assert "dec-0-refine-skip-planning" not in _ledger_ids(st)


def test_both_driver_loops_skip_planning_when_refine():
    """流式是前端主路径，只改同步等于没改。"""
    sync = inspect.getsource(driver.drive_full_v5_session)
    stream = inspect.getsource(driver.drive_full_v5_session_stream)
    for name, src in (("sync", sync), ("stream", stream)):
        while_at = src.find("while loop < max_loops")
        assert while_at >= 0, name
        rest = src[while_at:]
        skip_at = rest.find("skip_planning_loop_for_refine")
        pick_hits = [
            i
            for i in (
                rest.find("pick_next_capabilities"),
                rest.find("pick_repair_capabilities"),
            )
            if i >= 0
        ]
        assert skip_at >= 0, f"{name}：主循环里没有精修短路"
        assert pick_hits and skip_at < min(pick_hits), (
            f"{name}：短路写在 pick 后面，规划已经跑过了"
        )
        assert "record_refine_skip_planning" in src, name
        assert "stamp_drive_narration" in src, (
            f"{name}：步骤没打进 turnNarrations，旁路 drive 刷新仍是 0 步"
        )
        assert re.search(r"\bbreak\b", rest[skip_at:skip_at + 400]), (
            f"{name}：记了台账却没 break，循环还会 pick"
        )
