"""陈旧 PUT 不许抹掉服务端自己写的控制面 transcript。

2026-08-27 评审：`controlTranscript` 由服务端 `_append_transcript` 写、客户端
只读，但它**不在 PUT 的 exclude 集里**。于是一次陈旧写（推演出错时客户端
catch 里 persistSession(轮前快照)）会把这一轮新写的行整段盖掉——其中就有
`scope_confirmed`，而 `_scope_confirmed` 正靠它判定范围确认过没有。

表现：刚确认完范围、这一轮又失败了，下次 `/推演` 还弹卡。且只在**第一场
推演之前**复现（之后 modelVersions 兜底），所以极难复现、更难归因。
"""

from __future__ import annotations

import pytest

from control_turn_support import KEY, client, new_sid, seed_session
from services.scope_authority import plan_execution_authorized
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

PUT = "/api/sliderule/sessions/{sid}"


def _seed_confirmed(sid: str):
    plan = {"planId": "plan-1", "revision": 1, "planContent": "Build a leave app"}
    return seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "plan_written", **plan},
            {"id": "ct-2", "kind": "plan_approval", "reqId": "approval-1", **plan},
            {"id": "ct-3", "kind": "plan_approved", "reqId": "approval-1", **plan},
        ],
    )


def test_stale_put_cannot_erase_scope_confirmation():
    sid = new_sid("stale-put")
    _seed_confirmed(sid)
    # 客户端拿的是"确认之前"的快照：transcript 空
    stale = {
        "sessionId": sid,
        "goal": {"text": "请假系统", "status": "clear"},
        "controlTranscript": [],
    }
    res = client.put(PUT.format(sid=sid), json=stale, headers=KEY)
    assert res.status_code == 200, res.text[:400]
    saved = load_session(sid)
    kinds = [r.get("kind") for r in (saved.controlTranscript or [])]
    assert "plan_approved" in kinds
    assert plan_execution_authorized(saved) is True


def test_stale_put_cannot_erase_clarify_questions():
    """陈旧 PUT 也不许抹掉控制面刚问出来的澄清问题。

    跟上面那条同一个坑：推演出错时客户端 catch 里 persistSession(轮前快照)，
    那份快照里根本没有这组缺口 → 卡片凭空消失，用户以为自己看花了眼。
    """
    sid = new_sid("stale-put-gaps")
    seed_session(
        sid,
        goal={"text": "诊所系统", "status": "clear"},
        coverageGaps=[
            {
                "id": "gap-q-1",
                "kind": "open_question",
                "label": "主要给谁用？",
                "status": "open",
                "createdAt": "2026-08-27T00:00:00Z",
                "clarifyType": "multi_choice",
                "options": ["医生", "护士"],
            }
        ],
    )
    res = client.put(
        PUT.format(sid=sid),
        json={"sessionId": sid, "goal": {"text": "诊所系统", "status": "clear"}},
        headers=KEY,
    )
    assert res.status_code == 200, res.text[:400]
    saved = load_session(sid)
    labels = []
    for g in saved.coverageGaps or []:
        get = g.get if isinstance(g, dict) else lambda k, _g=g: getattr(_g, k, None)
        labels.append(get("label"))
    assert "主要给谁用？" in labels, "陈旧 PUT 把澄清问题抹掉了"


def test_client_still_writes_the_fields_it_owns():
    """反向：exclude 只挡服务端字段，客户端该写的还得写得进去。

    整段 exclude 写宽了会让普通保存变成只读，那比这个 bug 更糟。
    """
    sid = new_sid("stale-put-ok")
    _seed_confirmed(sid)
    res = client.put(
        PUT.format(sid=sid),
        json={
            "sessionId": sid,
            "goal": {"text": "改成报销系统", "status": "clear"},
            "controlTranscript": [],
        },
        headers=KEY,
    )
    assert res.status_code == 200, res.text[:400]
    saved = load_session(sid)
    assert (saved.goal or {}).get("text") == "改成报销系统"
    assert not plan_execution_authorized(saved), "Changed product goals require a revised plan"
