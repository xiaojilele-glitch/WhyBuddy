"""范围卡确认后，上一轮范围下的控制面提问必须作废（KD19 / UI 叠层）。

⚠ 2026-08-27 真机逮到：会话 goal 已经是「连锁宠物医院管理系统」，作曲家上
  弹的 ClarificationCard 问的还是上一轮的「这个**诊所系统**首期主要服务哪几类
  核心角色？」。持久化里三条 `gap-q-…` 全是 `status=open`、
  `reason=control_plane_clarify`，而 gap 上既没有 turnId 也没有 goal 引用——
  客户端判定不了归属，只能在服务端确认新范围时收口。

  同一张截图里范围卡还压在这张澄清卡上：两张「要不要烧」的决策面同屏，
  违 KD19。前端那半在 SlideRule.tsx 的 showClarify 上修。

判据落在 coverageGaps 的状态上（作曲家画不画卡就看它），不是落在源码里
有没有某个函数名。
反向：把 _retire_stale_control_questions 的调用点删掉，本文件必须红。
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import (  # noqa: E402
    _retire_stale_control_questions,
)


NOW = "2026-08-27T00:00:00+00:00"


def _gap(gid: str, label: str, reason: str = "control_plane_clarify", status: str = "open"):
    return {
        "id": gid,
        "kind": "open_question",
        "label": label,
        "status": status,
        "createdAt": NOW,
        "reason": reason,
        "clarifyType": "free_text",
    }


def _state_with_stale_questions() -> V5SessionState:
    return V5SessionState(
        sessionId="scope-retire",
        goal={"text": "连锁宠物医院管理系统", "status": "clear"},
        coverageGaps=[
            _gap("gap-q-ctl-a-0", "这个诊所系统首期主要服务哪几类核心角色？"),
            _gap("gap-q-ctl-b-1", "医护人员主要在什么设备上使用该系统？"),
            # 非控制面的缺口：证据/能力缺口是门说了算的，不许被这条顺手关掉
            {
                "id": "gap-evidence-turn-1",
                "kind": "missing_evidence",
                "label": "Missing grounded external evidence",
                "status": "open",
                "createdAt": NOW,
            },
            {
                "id": "gap-evidence.search-turn-1",
                "kind": "missing_capability",
                "label": "Missing required capability: evidence.search",
                "status": "open",
                "createdAt": NOW,
            },
        ],
    )


def _by_id(state: V5SessionState):
    out = {}
    for g in state.coverageGaps or []:
        d = g if isinstance(g, dict) else g.model_dump()
        out[d.get("id")] = d
    return out


def test_confirm_retires_control_plane_open_questions():
    state = _state_with_stale_questions()
    _retire_stale_control_questions(state)
    gaps = _by_id(state)
    assert gaps["gap-q-ctl-a-0"]["status"] == "waived", (
        "上一轮范围下的控制面提问仍是 open —— 作曲家会继续弹问「诊所系统」的卡"
    )
    assert gaps["gap-q-ctl-b-1"]["status"] == "waived"


def test_evidence_and_capability_gaps_are_never_touched():
    """反向：证据/能力缺口是 fail-closed 的门，不许被这条顺手关掉。"""
    state = _state_with_stale_questions()
    _retire_stale_control_questions(state)
    gaps = _by_id(state)
    assert gaps["gap-evidence-turn-1"]["status"] == "open", (
        "把证据缺口一起关掉 = 伪造绿灯（Claude.md §7 闭环类 fail-closed）"
    )
    assert gaps["gap-evidence.search-turn-1"]["status"] == "open"


def test_gap_count_unchanged_questions_are_retired_not_deleted():
    """作废不是删除：证据链要留痕，删掉就没法解释这张卡去哪了。"""
    state = _state_with_stale_questions()
    before = len(state.coverageGaps or [])
    _retire_stale_control_questions(state)
    assert len(state.coverageGaps or []) == before


def test_idempotent_second_confirm_is_a_noop():
    state = _state_with_stale_questions()
    _retire_stale_control_questions(state)
    first = _by_id(state)
    _retire_stale_control_questions(state)
    assert _by_id(state) == first


def test_waiving_questions_cannot_turn_a_red_gate_green():
    """反向（最贵的一条）：作废提问不许让覆盖闸变绿。

    slide_rule_coverage 会把 blockingGapIds 里状态为 waived 的缺口算进
    waivedGaps。所以只要控制面的提问哪天被塞进 blockingGapIds，本条作废
    就成了伪造绿灯（Claude.md §7：闭环类 fail-closed）。这里把"控制面
    的提问永远不在 blockingGapIds 里"钉死。
    """
    import inspect
    import re

    from services import rehearsal_control

    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(rehearsal_control))
    src = re.sub(r"#.*", "", src)
    assert "blockingGapIds" not in src, (
        "控制面开始往 blockingGapIds 里加东西了——那条作废会把红闸洗成绿闸，"
        "要么别加，要么把作废的范围再收紧"
    )


def test_new_turn_retires_legacy_questions_on_the_live_route(monkeypatch):
    from control_turn_support import ControlHarness, new_sid, seed_session, six_fields
    from services.slide_rule_session import load_session

    sid = new_sid("retire-legacy-questions")
    state = _state_with_stale_questions()
    seed_session(sid, goal=state.goal, coverageGaps=state.coverageGaps, awaitReason="control_clarify")
    harness = ControlHarness(monkeypatch)
    harness.post(six_fields(sid, "改成连锁门店的预约管理"))
    gaps = _by_id(load_session(sid))
    assert gaps["gap-q-ctl-a-0"]["status"] == "waived"
    assert gaps["gap-evidence-turn-1"]["status"] == "open"
    assert not harness.helper_calls
