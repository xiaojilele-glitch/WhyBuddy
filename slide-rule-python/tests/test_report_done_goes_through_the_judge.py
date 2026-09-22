# -*- coding: utf-8 -*-
"""模型自称做完了不算数：判决当场回喂，不是一句「收到」。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/update_goal/mod.rs`

    //! the tool blocks on that ack so the model's tool reply reflects the
    //! real outcome (classifier verdict / transition / rejection),
    //! **not a misleading instant success**.

本仓要治的病（CLAUDE.md §3「闸全绿但东西没了」）真机形态两次：

    2026-09-04 sr-20260904181150   closure 判出 24 个业务点只覆盖 5 个
                                   模型叙述成「闭环判定已完成」
    2026-09-05 sr-20260904214530   3 页画完、factoryTodo 还挂着 structure/bind
                                   收尾「页面已经出来」——完工口气配半成品

两次都修过，修法是把裁决作为**事实**回流到下一轮提示词。但事实是劝告：
模型仍然可以照说不误。这件工具把「我做完了」变成**有后果的动作**。

判据四类：
1. **活路径**（§1）——打真 HTTP，量模型下一发**真收到的那条 tool 消息**，
   不单独调 `judge`。只调纯函数证明不了它接在链路上。
2. **反向**（§3）——闭环过了要真的放行；没跑过闭环**不许**当成通过。
3. **穷尽**——每加一档判决必须在这儿写它的 wire 值（抄
   `test_control_stop_reason_wire` 那条纪律，wire 值是跨语言契约）。
4. **有意的分歧**——grok 有 `ClassifierFailOpenAchieved`，我们**故意没抄**。
   下面 `test_没判过不许当成通过` 钉着这一条：谁哪天"补全"了它，本条红。
"""

from __future__ import annotations

import copy
import json

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from models.v5_state import V5SessionState
from services.closed_tools import CLOSED_TOOLS, ToolScope, resolve_tool_scope
from services.done_claim import (
    DONE_CLAIM_MAX_RUNS,
    BLOCKED_REASON_SCHEMA,
    DoneVerdict,
    judge,
    verdict_text,
)
from services.rehearsal_control import _done_claim_rejections, should_list_tool

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _seed(sid: str, *, blocked, pages=True) -> None:
    """有产出的会话。blocked=None 表示闭环压根没判过。"""
    kw = {
        "goal": {"text": "请假系统", "status": "clear"},
        "modelVersions": [{"id": "v1", "model": {"pages": []}}],
        "currentModelVersionId": "v1",
    }
    if blocked is not None:
        # ⚠ 用真机那一发的原样载荷（§一之二）。第一版我编了个
        #   `PUBLISH_DANGLING_CROSSREF` 当 code——`closure_block_reason`
        #   的码表里**没有这个码**，`user_report` 老实回「本版本不认识这个
        #   拦截原因」，判据于是在量一条真机永远不会走的路。
        #   换成 2026-09-04 社区养老那次真机判出来的码 + 它的 ref 字段名。
        kw["publishClosure"] = {
            "blocked": blocked,
            "topBlockers": (
                [
                    {
                        "code": "CLOSURE_GOAL_RELEVANCE_FAILED",
                        "ref": "目标的 24 个业务点只覆盖了 5 个（21% < 50%）",
                    }
                ]
                if blocked
                else []
            ),
        }
    seed_session(sid, **kw)


def _tool_msgs(snapshot) -> list:
    return [m for m in snapshot if m.get("role") == "tool"]


# ── 一、活路径：判决回到模型手里 ──────────────────────────────────────────


def _drive(harness, sid: str):
    """模型报完工 → 拿判决 → 说一句收尾。返回每发采样的 messages 快照。"""
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        if len(harness.llm_calls) == 1:
            return llm_tool(
                "report_done", {"completed": True, "message": "五个系统都齐了"}
            )
        return llm_text("好的")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "做完了吗"))
    return shots


def test_闭环没过_驳回当场回到模型手里(harness):
    sid = new_sid("done-blocked")
    _seed(sid, blocked=True)
    shots = _drive(harness, sid)

    assert len(shots) >= 2, "模型没拿到工具结果就收尾了，判据量不到东西"
    tools = _tool_msgs(shots[1])
    assert tools, shots[1]
    body = json.loads(str(tools[-1].get("content") or "{}"))

    # 变异咬这一条：把分支改成 `{"ok": True}` 一句收到 → 红。
    assert body["verdict"] == DoneVerdict.NOT_ACHIEVED.value, body
    assert body["attempt"] == 1 and body["maxRuns"] == DONE_CLAIM_MAX_RUNS
    # 驳回理由必须带上，而且走 closure_block_reason 那个唯一出口。
    # ⚠ 第一版写的是 `... in why or body.get("why")`——后半截让任何非空
    #   字符串都能过，等于没判。钉在那个出口真会说的话上。
    from services.closure_block_reason import user_report

    want = user_report(
        {
            "blocked": True,
            "topBlockers": [
                {
                    "code": "CLOSURE_GOAL_RELEVANCE_FAILED",
                    "ref": "目标的 24 个业务点只覆盖了 5 个（21% < 50%）",
                }
            ],
        }
    )
    assert want, "码表里没这个码，判据又在量一条真机不走的路"
    assert body.get("why") == want, (body.get("why"), want)


def test_闭环过了_放行(harness):
    """反向：判官说过了就是过了，不许一律驳回。"""
    sid = new_sid("done-pass")
    _seed(sid, blocked=False)
    shots = _drive(harness, sid)
    body = json.loads(str(_tool_msgs(shots[1])[-1].get("content") or "{}"))
    assert body["verdict"] == DoneVerdict.ACHIEVED.value, body
    assert "attempt" not in body


def test_没判过不许当成通过(harness):
    """**故意跟 grok 分歧的那一条。**

    grok 有 `ClassifierFailOpenAchieved`：判官挂了就当达成。它的判官是外部
    LLM 分类器，fail-open 是为了别把用户困死。我们的判官
    `derive_publish_closure_response` 是确定性推导、没有外部调用——照抄
    fail-open 就是把「判官炸了」变成「恭喜完工」，正是 §7 点名的伪造绿灯。

    谁哪天"照 grok 补全"了这一档，本条红。
    """
    sid = new_sid("done-noverdict")
    _seed(sid, blocked=None)
    shots = _drive(harness, sid)
    body = json.loads(str(_tool_msgs(shots[1])[-1].get("content") or "{}"))
    assert body["verdict"] == DoneVerdict.NO_VERDICT.value, body
    assert body["verdict"] != DoneVerdict.ACHIEVED.value


def test_没产出的会话里压根不列这件工具():
    """空会话没什么可报完工的。跟 closure 同一个条件，不许另写口径。"""
    empty = V5SessionState(sessionId="done-empty", goal={"text": ""})
    assert not should_list_tool("report_done", empty)
    assert should_list_tool("report_done", empty) == should_list_tool("closure", empty)


# ── 二、同一份产出上的计数会随产出变化归零 ───────────────────────────────


def _claim_row(fp: str, verdict: str = DoneVerdict.NOT_ACHIEVED.value) -> dict:
    return {"role": "system", "kind": "done_claim", "verdict": verdict, "fingerprint": fp}


def test_计数按产出指纹走_产出一变就归零():
    st = V5SessionState(sessionId="fp", goal={"text": "x"})
    st.controlTranscript = [_claim_row("aaa"), _claim_row("aaa"), _claim_row("bbb")]
    assert _done_claim_rejections(st, "aaa") == 2
    # 补画了几页 → 指纹变了 → 这是「另一个问题」，从头数。
    assert _done_claim_rejections(st, "ccc") == 0


def test_只数被驳回的_通过的和受阻的不算():
    st = V5SessionState(sessionId="fp2", goal={"text": "x"})
    st.controlTranscript = [
        _claim_row("aaa"),
        _claim_row("aaa", DoneVerdict.ACHIEVED.value),
        _claim_row("aaa", DoneVerdict.ACCEPTED.value),
    ]
    assert _done_claim_rejections(st, "aaa") == 1


def test_报到上限就别再报_改成如实告诉用户(harness):
    sid = new_sid("done-exhaust")
    _seed(sid, blocked=True)
    st = __import__(
        "services.slide_rule_session", fromlist=["load_session"]
    ).load_session(sid)
    from services.slide_rule_session import save_session
    from services.turn_narration import deliverable_fingerprint

    fp = deliverable_fingerprint(st)
    st.controlTranscript += [_claim_row(fp)] * (DONE_CLAIM_MAX_RUNS - 1)
    save_session(st)

    shots = _drive(harness, sid)
    body = json.loads(str(_tool_msgs(shots[1])[-1].get("content") or "{}"))
    assert body["attempt"] == DONE_CLAIM_MAX_RUNS, body
    assert body["exhausted"] is True
    assert "如实告诉用户" in body["say"], body["say"]


# ── 三、判决表穷尽 + 参数纪律 ─────────────────────────────────────────────


#: 手写的期望表。**故意不从枚举推导**——从枚举推导等于拿被测物证明自己。
_WIRE = {
    DoneVerdict.ACCEPTED: "accepted",
    DoneVerdict.ACHIEVED: "achieved",
    DoneVerdict.NOT_ACHIEVED: "not_achieved",
    DoneVerdict.NO_VERDICT: "no_verdict",
    DoneVerdict.REJECTED: "rejected",
}


def test_每一档判决都得在这张表里有名字():
    missing = sorted(v.value for v in DoneVerdict if v not in _WIRE)
    assert not missing, f"这些新判决还没起线上名字：{missing}"
    extra = sorted(v for v in _WIRE if v not in set(DoneVerdict))
    assert not extra, f"表里有枚举里已经没有的判决：{extra}"


@pytest.mark.parametrize("v", list(DoneVerdict))
def test_每一档都有一句能据以行动的话(v: DoneVerdict):
    assert _WIRE[v] == v.value
    assert len(verdict_text(v)) >= 8, v


def test_给模型的话两两不同():
    says = [verdict_text(v) for v in DoneVerdict]
    assert len(set(says)) == len(says), "有两档判决给的是同一句话"


def test_同时说做完了又说卡住了_不采纳():
    """两个相反的信号挤进同一次调用。grok 的 schema 用措辞挡，我们再加一道。"""
    verdict, detail = judge(
        completed=True, blocked_reason="接不上", closure_blocked=False, prior_rejections=0
    )
    assert verdict is DoneVerdict.REJECTED
    assert "相反" in detail["why"]


def test_blocked_reason_的说明书必须写着这是失败信号():
    """抄 grok 那句「This is a FAILURE signal — never put success text here.」

    ⚠ 少了这半句，模型会把「我做完了」塞进 blocked_reason 当小结——
      台账上就再也分不出「卡住了」和「干完了」。
    """
    assert "失败信号" in BLOCKED_REASON_SCHEMA
    assert "不许" in BLOCKED_REASON_SCHEMA and "成功" in BLOCKED_REASON_SCHEMA


def test_报完工是读权限_不产出新模型():
    """它只是把一次声明交给判官，不造五系统模型。落 READ 还让
    action_stationarity 的紧档接得上：同一份产出上一遍遍重报会被掐。"""
    assert "report_done" in CLOSED_TOOLS
    assert resolve_tool_scope("report_done") is ToolScope.READ
