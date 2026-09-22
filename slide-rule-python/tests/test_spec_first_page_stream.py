"""spec-first 的页面要实时冲到 SSE 流上（2026-08-14）。

## 这条防的是「东西早就在内存里，右侧还在转圈」

新链路一轮 8~9 分钟。第 3 步在**第二分钟**就有第一份能直接打开的 HTML，
可它此前一直攒到最后才随模型一起交——右侧那四五分钟纯转圈，而且转的不是
"还没算出来"，是"算出来了没往外发"。

这一层三段接线，缺任何一段都是**静默失效**（页面照出、模型照返、闸照绿，
没有一处会红）：

    spec_page_html   每落地一页调 on_page
    spec_first_pipeline  没传实参就取请求域 sink
    v5_full_driver   装 sink → 排水 → yield spec_page → finally 卸

所以这里从**流的另一端**验：真跑一趟 drive_full_v5_session_stream，
在能力执行期间叫一次 sink，看事件有没有出来。只查源码的话，三段各自
"看着都对"、拼起来不通的情况一次都拦不住。
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402

GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"

HTML = ('<!DOCTYPE html><html lang="zh-CN"><head>'
        '<script src="https://cdn.tailwindcss.com"></script></head>'
        '<body><main>宠物档案</main></body></html>')


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_full_driver as driver_mod

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: s)
    return driver_mod


def _drive(driver, state, hook):
    """跑一趟流，在第一个能力执行时叫一次 hook（模拟第 3 步落地一页）。"""
    from sliderule_llm import capabilities as caps

    monkeypatched = {"done": False}

    def fake_native(body, **kw):
        if not monkeypatched["done"]:
            monkeypatched["done"] = True
            hook()
        cap = body["capabilityId"]
        return {"title": cap, "summary": "s", "content": "c", "provenance": "python-llm"}

    os.environ["SLIDERULE_LLM_ROUND_CAPS"] = "1"
    old = caps.execute_capability
    caps.execute_capability = fake_native
    try:
        async def _collect():
            evs = []
            async for ev in driver.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction=GOAL
            ):
                evs.append(ev)
            return evs

        return asyncio.run(_collect())
    finally:
        caps.execute_capability = old
        os.environ.pop("SLIDERULE_LLM_ROUND_CAPS", None)


def test_页面在能力执行期间就冲上流(driver):
    """判据是**位置**，不只是"有这个事件"。

    攒到最后再一次性发，事件同样会出现在列表里——那正是这次要治的病。
    所以钉的是它排在 complete 之前、且在轮内能力还在跑的时候。
    """
    def hook():
        sink = sfp._page_sink_var.get()
        assert sink is not None, "驱动器没装 sink——这条链一整段静默失效"
        sink("p1", HTML, 1, 3)
        sink("p2", HTML, 2, 3)

    events = _drive(driver, _seeded_state("sf-page-1"), hook)

    pages = [e for e in events if e["type"] == "spec_page"]
    assert [e["pageId"] for e in pages] == ["p1", "p2"]
    assert [(e["current"], e["total"]) for e in pages] == [(1, 3), (2, 3)]
    assert all(e["html"] == HTML for e in pages)
    # ⚠ bound=False：第 3 步的素颜页，data-* 孔要等第 6.5 步。前端据此知道
    #   现在渲染的是"长什么样"，数据是后面才接上的。
    assert all(e["bound"] is False for e in pages)

    kinds = [e["type"] for e in events]
    assert kinds.index("spec_page") < len(kinds) - 1, "不能攒到最后才发"


def test_流结束后_sink_已卸(driver):
    """不卸的话，本次流之后的调用会往一个没人排水的队列里灌。

    同款纪律见 caps._delta_sink_var / _gen 的两条——驱动器 finally 里一起卸。
    """
    _drive(driver, _seeded_state("sf-page-2"), lambda: None)
    assert sfp._page_sink_var.get() is None


def test_sink_自己炸了不打死这一轮(driver):
    """队列满/序列化失败都不该带走已经烧过 LLM 的页面。

    这条的兜底在 spec_page_html 那一层（回调异常吞掉），这里验的是
    **整条链拼起来之后**它还在——中间任何一层重新抛出来都会被这条抓住。
    """
    from services.spec_page_html import generate_pages_parallel

    def hook():
        sink = sfp._page_sink_var.get()
        spec = {"appName": "x", "nodes": [],
                "pages": [{"id": "p1", "name": "甲", "purpose": "看",
                           "audience": "谁", "coversNodes": []}]}

        class _R:
            content = HTML

        def exploding(*_a):
            sink("p1", HTML, 1, 1)  # 先真发一次，证明通道确实通着
            raise RuntimeError("SSE 队列满了")

        out = generate_pages_parallel(spec, llm_call=lambda *a, **k: _R(),
                                      on_page=exploding)
        assert len(out["pages"]) == 1, "回调炸了不该赔掉已经生成好的页面"

    events = _drive(driver, _seeded_state("sf-page-3"), hook)
    assert [e["pageId"] for e in events if e["type"] == "spec_page"] == ["p1"]
    assert events[-1]["type"] in ("complete", "phase_change")


def test_开关关着时一个页面事件都没有(driver):
    """装 sink 不判断开关（判断开关的地方只该有一处），所以"没人叫它"
    本身就是"没有事件"。这条钉的是**没有多余的旁路**去发这类事件。"""
    events = _drive(driver, _seeded_state("sf-page-4"), lambda: None)
    assert [e for e in events if e["type"] == "spec_page"] == []
