# -*- coding: utf-8 -*-
"""驱动器把步骤写进 turnNarrations（会话 blob / 库），不另开表。

2026-08-18 社区工具屋 sr-20260818172818：四轮都画了页，库里
turnNarrations=[]，左栏「1 阶段 · 0 步」。字段早就在，没人写。

删掉 stamp_drive_narration / 把 events_cursor 改成 0，下面必红。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from types import SimpleNamespace  # noqa: E402

from services.turn_narration import (  # noqa: E402
    HOP_NO_PRODUCE_NOTE,
    project_drive_steps,
    stamp_drive_narration,
    stamp_turn_narration,
)


def _event(kind, *, text="", cap="intent.parse", turn="loop-0"):
    return {
        "kind": kind,
        "text": text,
        "capabilityId": cap,
        "turnId": turn,
    }


def _state(**kw):
    base = dict(
        sessionId="n",
        goal={"text": "社区篮球馆", "status": "clear"},
        reasoningEvents=[],
        specFirstPages=None,
        publishClosure=None,
        turnNarrations=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_project_skips_prior_drive_events():
    """精修轮不得把首轮 intent.parse 再投一遍。"""
    st = _state(reasoningEvents=[
        _event("capability_start", cap="intent.parse", turn="loop-0"),
        _event("capability_start", cap="risk.analyze", turn="loop-1"),
        _event(
            "think",
            text="refine_skip_planning: 跳过规划循环，直进 appbundle.runtimeClosure",
            cap="driver",
        ),
    ])
    labels = [
        str(s.get("label") or s.get("text") or "")
        for s in project_drive_steps(st, user="加红标", events_cursor=2)
    ]
    assert any("精修" in x and "跳过规划" in x for x in labels)
    assert not any("正在理解你的目标" in x for x in labels)
    assert not any("正在分析风险" in x for x in labels)
    # 反向：cursor=0 必须能看见首轮规划——否则上面那条绿灯是因为标签写错了
    all_labels = [
        str(s.get("label") or s.get("text") or "")
        for s in project_drive_steps(st, user="加红标", events_cursor=0)
    ]
    assert any("正在理解你的目标" in x for x in all_labels)


def test_structure_hop_does_not_claim_missing_pages():
    """点 Structure 本跳没画页是正常的，不许套精修那句「没画出页面」。"""
    st = _state(
        goal={
            "text": "萌芽成长树",
            "status": "clear",
            "tools": ["structure"],
        },
        specFirstPages={"pages": {"p1": "<html>打卡</html>"}},
        publishClosure={"refinePaintNote": "", "chatSummary": "含 2 角色、3 页面。"},
    )
    steps = project_drive_steps(
        st,
        user="进入数据模型反推（Structure）",
        events_cursor=0,
        produced=True,
    )
    finals = [s["text"] for s in steps if s.get("kind") == "narration" and s.get("isFinal")]
    blob = " ".join(finals)
    assert "本轮没有画出新的页面" not in blob
    assert "本轮已完成数据模型反推。" in blob
    assert "含 2 角色" not in blob


def test_structure_user_text_wins_over_stale_pages_tools():
    """确认继续把 tools 钉成 pages 之后点 Structure，叙述仍不许说没画页。"""
    st = _state(
        goal={"text": "两个人的账本", "status": "clear", "tools": ["pages"]},
        specFirstPages={"pages": {"p1": "<html>账本</html>"}},
        publishClosure={"refinePaintNote": "", "chatSummary": "含 2 角色、3 页面。"},
    )
    steps = project_drive_steps(
        st,
        user="进入数据模型反推（structure）",
        events_cursor=0,
        produced=True,
    )
    finals = [s["text"] for s in steps if s.get("kind") == "narration" and s.get("isFinal")]
    blob = " ".join(finals)
    assert "本轮没有画出新的页面" not in blob
    assert "本轮已完成数据模型反推。" in blob


def test_zero_production_hop_does_not_claim_done_from_user_text():
    """反向：零产出的一跳，原文提到 hop 名也不许叙述成已完成。"""
    st = _state(
        goal={"text": "萌芽成长树", "status": "clear", "tools": ["structure"]},
        specFirstPages={"pages": {"p1": "<html>打卡</html>"}},
        publishClosure={"refinePaintNote": "", "chatSummary": "含 2 角色、3 页面。"},
    )
    steps = project_drive_steps(
        st, user="进入数据模型反推（Structure）", events_cursor=0, produced=False
    )
    finals = [s["text"] for s in steps if s.get("kind") == "narration" and s.get("isFinal")]
    blob = " ".join(finals)
    assert "本轮已完成数据模型反推" not in blob
    assert "已完成" not in blob
    assert HOP_NO_PRODUCE_NOTE in blob
    assert "含 2 角色" not in blob


def test_project_pages_and_refine_narration():
    st = _state(
        goal={"text": "社区工具屋", "status": "clear"},
        specFirstPages={"pages": {"p2": "<html>台账</html>", "p5": "<html>逾期</html>"}},
        publishClosure={"refinePaintNote": "", "chatSummary": "含 2 角色、3 页面。"},
    )
    steps = project_drive_steps(
        st, user="台账加预约排队人数", events_cursor=0, produced=True
    )
    labels = [s.get("label") or s.get("text") or "" for s in steps]
    assert any("🖼 界面已出：p2" in x for x in labels)
    assert any("🖼 界面已出：p5" in x for x in labels)
    finals = [s["text"] for s in steps if s.get("kind") == "narration" and s.get("isFinal")]
    assert finals == ["本轮已按指令改画页面。"]
    assert "含 2 角色" not in "".join(finals)


def test_refine_without_production_does_not_claim_updated():
    """A-7 收口：没改页面不许说已改画 / 已更新。"""
    st = _state(
        goal={"text": "社区工具屋", "status": "clear"},
        specFirstPages={"pages": {"p2": "<html>台账</html>"}},
        publishClosure={"refinePaintNote": "", "chatSummary": "含 2 角色、3 页面。"},
    )
    steps = project_drive_steps(
        st, user="台账加预约排队人数", events_cursor=0, produced=False
    )
    finals = [s["text"] for s in steps if s.get("kind") == "narration" and s.get("isFinal")]
    blob = " ".join(finals)
    assert "已按指令改画" not in blob
    assert "已更新" not in blob
    assert "本轮没有画出新的页面" in blob


def test_stamp_drive_writes_on_state_and_caps_three_turns():
    st = _state(goal={"text": "x", "status": "clear"})
    for i in range(4):
        st.reasoningEvents = list(st.reasoningEvents or []) + [
            _event("capability_start", cap="intent.parse", turn="loop-0")
        ]
        cursor = len(st.reasoningEvents) - 1
        stamp_drive_narration(
            st,
            turn_id=f"turn-{i + 1}",
            user=f"指令{i}",
            events_cursor=cursor,
        )
    assert len(st.turnNarrations) == 3
    assert [n["turnId"] for n in st.turnNarrations] == ["turn-2", "turn-3", "turn-4"]
    assert st.turnNarrations[-1]["steps"], "最新一轮 steps 空着"


def test_empty_steps_do_not_stamp():
    st = _state(goal={"text": "x"})
    stamp_turn_narration(st, turn_id="turn-1", user="u", steps=[])
    assert st.turnNarrations == []


def test_live_driver_passes_produced_into_stamp():
    """函数写对了 ≠ 它被调用了。两条驱动都要把 produced 传进 stamp。"""
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py").read_text(
        encoding="utf-8"
    )
    src = re.sub(r"(?m)^\s*#.*$", "", src)
    assert src.count("produced=deliverable_fingerprint(state) != _fp_before") >= 2
    assert "_fp_before = deliverable_fingerprint(state)" in src
