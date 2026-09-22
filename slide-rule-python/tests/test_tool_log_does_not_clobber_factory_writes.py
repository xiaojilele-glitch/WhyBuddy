"""工具日志落盘不许盖掉流中途别人写进同一个会话的东西。

## 病（2026-09-15，接上游 b7213a9b 之后五条判据一起红）

`_logged_tool_events` 套在**整条分发流**上，手里那份 `state` 是进来时的。
而流跑到中途会有别的写入者往同一个会话里写：`_handoff_factory` 起的工厂是
另一条 run，spec-first 跑完把 SPEC 写进 `state.specFirstPages` 并自己存了库。

原来那一句 `await _apersist(state)` 于是拿进来时的旧快照**整份覆盖**——
SPEC 当场没了。而 `_persist` 走 `server_write=True`，它绕过 persistence
的同轮增长守卫（2026-09-04 为了让纯标量翻转别被丢掉才加的），
所以这一盖**不会被拦下来，不报错、不告警**。

真机形态（判据链逐层验过）：

    _has_spec(state) == False            ← pages 进不了工具清单
      └ specFirstPages 只剩 {'assumptionsConfirmed'}，'spec' 键整个没了
          └ 而工厂交回那一刻它确实写进去过（读回来也有）

⚠ `_logged_tool_events` 的头注本来就写着**反方向**的同一个病
  （「抢先 persist 会被那一刀盖掉」），那半边靠延后落盘防住了。
  这一条钉的是另外半边。两个方向缺一不可。
"""

import asyncio
from typing import Any, Dict, List

import pytest

from control_turn_support import new_sid, seed_session
from services import rehearsal_control as control
from services import slide_rule_session as session_mod
from services.slide_rule_session import load_session, save_session


@pytest.fixture
def sid():
    """用完把会话从共享缓存里摘掉。

    ⚠ 这个套件的会话存储是**全套件共享**的，没有 autouse 的重置。
      第一版这条判据写完自己是绿的，却把 `test_project_preview_host` 顶红了
      ——全量跑 8093 条里就那一条，隔离跑又是绿的，典型的判据间污染。
      判据自己制造的红比它防的那个 bug 还难查，所以收尾必须清干净。
    """
    value = new_sid("tool-log-clobber")
    try:
        yield value
    finally:
        session_mod._sessions.pop(value, None)


def _spec_blob() -> Dict[str, Any]:
    return {"appName": "请假系统", "pages": [{"id": "p1", "name": "首页"}], "nodes": []}


def test_工具日志落盘不许盖掉流中途工厂写的SPEC(sid):
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    # 控制面手里那份：**没有** SPEC，模拟「进流时读的那一份」。
    stale = load_session(sid)
    assert stale is not None
    assert "spec" not in (stale.specFirstPages or {})

    async def stream():
        # 流跑到中途，另一个写入者（工厂）把 SPEC 写进同一个会话并落库。
        other = load_session(sid)
        other.specFirstPages = {**(other.specFirstPages or {}), "spec": _spec_blob()}
        save_session(other, server_write=True)
        assert "spec" in (load_session(sid).specFirstPages or {}), "夹具自己没写进去"
        # 然后这条流吐出一个工具结果——就是这一发触发日志落盘。
        yield {"type": "control_tool_result", "tool": "project_status", "ok": True}

    async def run() -> List[Dict[str, Any]]:
        return [e async for e in control._logged_tool_events(stale, stream())]

    events = asyncio.run(run())
    assert len(events) == 1

    after = load_session(sid)
    # 正向：这一发的工具日志真的落库了（这才是这个包装器的活）。
    kinds = [r.get("kind") for r in (after.controlTranscript or [])]
    assert "tool_result" in kinds, kinds
    # 反向：**别人写的 SPEC 一个字都不许少**。
    #   变异：把 _apersist_transcript 换回 _apersist(state) → 这一条当场红。
    assert "spec" in (after.specFirstPages or {}), after.specFirstPages
    assert after.specFirstPages["spec"] == _spec_blob()
