"""质疑 / 澄清卡：判据钉**状态真的变了**，不是"那个分支跑过了"。

这两条 2026-08-27 评审逮到的断链是同一个形状——三段各自都写了，接起来是空的：

  质疑：客户端 challenge-composer 解析出 targetArtifactId → runTurn 收到了
        → **POST body 里没有** → 服务端三个 target 全空 → 失效级联整段跳过
        → staleArtifactIds 一个不加，而流里照样说「已按质疑失效相关产物」。
  澄清：resolve_readiness_gaps_by_ids 一直在、还有单测，**产品链路零调用点**
        （控制面改造把 TS 的 intakeMessage 删了）→ 答完卡片一个缺口不关。

原来那条 test_forced_challenge_invalidates 断言的是
`len(harness.invalidate_calls) == 1`——**一个调用计数**。把 targetArtifactId
删掉它照样绿。这就是本仓第三条：正向判据齐全、反向判据缺失。

所以这里每条都钉状态：staleArtifactIds 变长 / coverageGaps 真的 resolved，
并且各配一条反向的（没指到就不许说失效、没答的不许被关）。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _seed_with_artifacts(sid: str):
    return seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        artifacts=[
            {"id": "art-1", "kind": "finding", "content": "上游结论"},
            {"id": "art-2", "kind": "report", "content": "引用了上游的报告"},
            {"id": "art-3", "kind": "finding", "content": "无关的另一条"},
        ],
        dependencyGraph=[
            {"fromArtifactId": "art-1", "toArtifactId": "art-2", "reason": "cites"}
        ],
    )


def _texts(events):
    return " ".join(
        str(e.get("text") or "") for e in events if e.get("type") == "control_text"
    )


def _tool_result(events, tool: str):
    for e in events:
        if e.get("type") == "control_tool_result" and e.get("tool") == tool:
            return e
    return None


class TestChallengeInvalidates:
    def test_target_goes_stale_with_downstream(self, harness):
        sid = new_sid("challenge-real")
        _seed_with_artifacts(sid)
        _, events = harness.post(
            six_fields(
                sid,
                "这个结论依据不够",
                forcedTool="challenge",
                targetArtifactId="art-1",
            )
        )
        saved = load_session(sid)
        stale = set(saved.staleArtifactIds or [])
        # 指到的那件 + 依赖图下游都必须真的进名单
        assert "art-1" in stale, "质疑指到的产物没有失效"
        assert "art-2" in stale, "下游没有跟着失效（级联没跑）"
        # 反向：无关的那件不许被牵连
        assert "art-3" not in stale
        result = _tool_result(events, "challenge")
        assert result is not None
        assert result.get("detail") == "invalidated"
        assert sorted(result.get("staleArtifactIds") or []) == ["art-1", "art-2"]
        assert "已按质疑失效 2 件产物" in _texts(events)
        assert "complete" in event_types(events)

    def test_no_target_changes_nothing_and_does_not_claim_it_did(self, harness):
        """反向：没指到产物时**一件都不许失效**，也不许说已失效。

        这条是上面那条的对子。少了它，"永远说已失效"照样全绿——
        而假绿灯比没有这个功能更糟（用户以为那份产物作废了）。
        """
        sid = new_sid("challenge-blind")
        _seed_with_artifacts(sid)
        _, events = harness.post(
            six_fields(sid, "这个结论依据不够", forcedTool="challenge")
        )
        saved = load_session(sid)
        assert not (saved.staleArtifactIds or []), "没指到产物却失效了东西"
        result = _tool_result(events, "challenge")
        assert result is not None
        assert result.get("detail") == "no_target"
        text = _texts(events)
        assert "已按质疑失效" not in text
        assert "没有任何产物被失效" in text

    def test_unknown_target_is_not_written_into_stale_list(self, harness):
        """反向：客户端给了一个对不上的 id，不许把它塞进 staleArtifactIds。

        塞进去不会报错，只会让那份名单越长越脏，而且看着像"失效过了"。
        """
        sid = new_sid("challenge-ghost")
        _seed_with_artifacts(sid)
        _, events = harness.post(
            six_fields(
                sid,
                "这个结论依据不够",
                forcedTool="challenge",
                targetArtifactId="art-does-not-exist",
            )
        )
        saved = load_session(sid)
        assert not (saved.staleArtifactIds or [])
        assert _tool_result(events, "challenge").get("detail") == "no_target"
        assert "已按质疑失效" not in _texts(events)


class TestAnsweredGapsClose:
    def _seed_gaps(self, sid: str):
        return seed_session(
            sid,
            goal={"text": "请假系统", "status": "clear"},
            modelVersions=[{"id": "v1", "model": {"pages": []}}],
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "谁来审批？",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                },
                {
                    "id": "g2",
                    "kind": "open_question",
                    "label": "假期额度怎么算？",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                },
            ],
        )

    def _status(self, sid: str, gid: str) -> str:
        saved = load_session(sid)
        for gap in saved.coverageGaps or []:
            get = gap.get if isinstance(gap, dict) else lambda k, _g=gap: getattr(_g, k, None)
            if get("id") == gid:
                return str(get("status"))
        return "missing"

    def test_answered_gap_is_resolved(self, harness):
        sid = new_sid("gaps")
        self._seed_gaps(sid)
        harness.post(six_fields(sid, "主管审批", answeredGapIds=["g1"]))
        assert self._status(sid, "g1") == "resolved"
        # 反向：没答的那条必须还开着——整批关掉等于把没答的也当答了
        assert self._status(sid, "g2") == "open"

    def test_no_answered_ids_leaves_every_gap_open(self, harness):
        sid = new_sid("gaps-none")
        self._seed_gaps(sid)
        harness.post(six_fields(sid, "随便聊一句"))
        assert self._status(sid, "g1") == "open"
        assert self._status(sid, "g2") == "open"
