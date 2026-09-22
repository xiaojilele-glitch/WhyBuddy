"""每个昂贵按钮的流都必须以**终局事件**收尾。

2026-08-27 评审：`restore_version` 分支 yield 完 `control_tool_result` 就
`return`，没有 `complete`。后果不是"点了没反应"——

  无 complete → 客户端 acc.finalState 恒 null → postControlTurnStream 返回
  null → runTurn 抛「控制面未返回结果」→ catch 里 persistSession(轮前快照)
  → **服务端已经做成的回退被客户端盖回去**。

紧挨着的 `fork_variant` 有 complete，注释还写着「不 yield 等于点了没反应」，
只有回退这支漏了。所以判据不逐个分支写，而是**参数化盖住整张封闭工具表**：
以后新增工具忘了收尾，这条自己会红。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.rehearsal_control import CLOSED_TOOLS, _TERMINAL_EVENTS
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

# ask_user / scope_card / rehearse 由控制面自己决定停泊或点火，
# 其余都是产品按钮直达。整张表都要过这条。
FORCED = [t for t in CLOSED_TOOLS]


@pytest.fixture
def harness(monkeypatch):
    h = ControlHarness(monkeypatch)
    h.llm_impl = lambda messages, **kw: llm_text("ok")
    return h


def _seed(sid: str):
    return seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[
            {"id": "v1", "model": {"pages": [{"id": "p1"}]}},
            {"id": "v2", "model": {"pages": [{"id": "p1"}, {"id": "p2"}]}},
        ],
        currentModelVersionId="v2",
        artifacts=[{"id": "art-1", "kind": "finding", "content": "x"}],
        controlTranscript=[{"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}],
    )


@pytest.mark.parametrize("tool", FORCED)
def test_every_forced_tool_ends_with_a_terminal_event(harness, tool):
    sid = new_sid(f"settle-{tool}")
    _seed(sid)
    _, events = harness.post(
        six_fields(sid, "做点什么", forcedTool=tool, targetArtifactId="art-1")
    )
    types = event_types(events)
    assert types, f"{tool}: 一个事件都没有"
    assert any(t in _TERMINAL_EVENTS for t in types), (
        f"{tool} 的流没有终局事件 → 客户端会报「推演中断」并把轮前快照写回去："
        f"{types}"
    )


def test_restore_version_hands_the_server_state_back(harness):
    """回退这支要把**服务端此刻的状态**交回客户端。

    只判"有 complete"不够：complete 里带的必须跟服务端存档一致。不一致的话
    客户端 applyPersistedState 之后两边就分叉了——而这条链路上"客户端把自己
    的快照写回去"正是评审逮到的那个事故形状。

    ⚠ 这里**不断言回退一定成功**：重建闭环要走 LLM，离线环境下它会如实
      返回 restore_failed。判据钉的是"服务端说什么、客户端就拿到什么"，
      成功与否都成立；把它写成"必须回退成功"会变成一条只在有 key 的机器上
      绿的判据。
    """
    sid = new_sid("restore")
    _seed(sid)
    _, events = harness.post(
        six_fields(sid, "/回退", forcedTool="restore_version", versionId="v1")
    )
    completes = [e for e in events if e.get("type") == "complete"]
    assert completes, "回退没有 complete —— 客户端会把回退前的快照写回去"
    final = completes[-1].get("state") or {}
    saved = load_session(sid)
    assert final.get("currentModelVersionId") == saved.currentModelVersionId
    assert final.get("sessionId") == sid
    # 失败要如实说失败，不许省略 ok
    result = next(
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "restore_version"
    )
    assert isinstance(result.get("ok"), bool)


class TestSettledGuardItself:
    """守卫本身的正反两条。

    ⚠ 这两条**直接喂 `_settled`**，不走 HTTP——因为今天没有任何 forced 工具
      会在守卫里交棒（rehearse / refine / repair 三支都在 CLOSED_TOOLS 之前
      各自 return 了）。第一版把反向条写成"forcedTool=refine 不许两个
      complete"，跑变异才发现它**根本没经过守卫**，改坏了照样绿——正是本仓
      第一条说的"装在不通电的插座上"。
      能通过真链路验的（每个 forced 工具都收尾、回退把服务端状态交回去）
      在上面，已经走真 HTTP；剩下这条只能贴着函数验。
    """

    @staticmethod
    def _drain(events):
        import asyncio

        from services.rehearsal_control import _settled

        async def run():
            async def gen():
                for e in events:
                    yield e

            out = []
            async for e in _settled(_state(), gen()):
                out.append(e)
            return out

        # ⚠ 用 asyncio.run，不用 get_event_loop().run_until_complete()：
        #   后者单跑这个文件是绿的，跟全量套件一起跑就红——前面的用例可能把
        #   默认事件循环关掉/换掉了。判据不该依赖别人留下的循环。
        return asyncio.run(run())

    def test_appends_complete_when_the_stream_did_not_settle(self):
        out = self._drain([{"type": "control_tool_result", "tool": "x"}])
        assert [e["type"] for e in out] == ["control_tool_result", "complete"]

    def test_handoff_is_not_host_terminal(self):
        """handoff 只是 WRITE 开始。变异：把 control_handoff_factory 加回
        `_TERMINAL_EVENTS` → 本条红（不再补 complete）。

        ⚠ 2026-09-02：确认继续 forced pages，守卫把 handoff 当终局，工厂
          嵌在同一条 SSE 里跑完后不补 complete，客户端报「推演中断」。
        """
        from services.rehearsal_control import _TERMINAL_EVENTS

        assert "control_handoff_factory" not in _TERMINAL_EVENTS
        handed = self._drain([{"type": "control_handoff_factory", "runId": "r1"}])
        assert [e["type"] for e in handed] == ["control_handoff_factory", "complete"]

    def test_does_not_append_after_a_complete(self):
        """反向：已经收尾的不许再补。"""
        done = self._drain([{"type": "complete", "state": {}}])
        assert [e["type"] for e in done] == ["complete"]


def _state():
    from models.v5_state import V5SessionState

    return V5SessionState(
        sessionId="settle-unit", goal={"text": "", "status": "needs_refinement"}
    )
