# -*- coding: utf-8 -*-
"""生命周期钩子：只有闸类事件能拦，处理器炸了一律放行。

抄的标准答案：grok-build `xai-grok-hooks/src/event.rs` / `dispatcher.rs`

    pub enum GateKind { Observe, Tool, Stop, PostTool, Prompt }
    // SECURITY: a hook that errors fails open (contributes nothing);
    //           only a healthy deny blocks.

grok 用宏把「事件名 → 它是哪种闸」焊在一起，加事件不声明就编译不过。
Python 没宏，所以那条约束由 `test_每个事件都得声明自己是哪种闸` 顶上。

## 这一版是**引擎侧**，默认一个处理器都没挂

没做的：从文件发现钩子、命令/HTTP 处理器、信任模型、环境变量展开——
那是 grok 给工程师的形态（往 `~/.grok/hooks/` 丢 JSON）。面团的用户不写代码，
凭空发明一个文件格式只会得到一个没人用的入口。配置来源是产品决定。

⚠ 所以这批判据**必须自己挂处理器再走真 HTTP**：不挂就等于在量一条恒 ALLOW
  的空路，那正是 §一之二 说的「条件在真机上永不成立」。下面
  `test_挂上拦截钩子之后_真的拦得住` 是这条缝通电与否的唯一证据。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.hook_events import (
    GateKind,
    HookDecision,
    HookEvent,
    HookOutcome,
    MAX_PAYLOAD_BYTES,
    can_block,
    clear_hooks,
    dispatch,
    gate_kind,
    register_hook,
    registered,
    unregister_hook,
)

pytest.importorskip("fastapi")


@pytest.fixture(autouse=True)
def _clean_hooks():
    clear_hooks()
    yield
    clear_hooks()


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


# ── 一、活路径：这条缝通不通电 ───────────────────────────────────────────


def test_挂上拦截钩子之后_真的拦得住(harness):
    """**这条是这次改造唯一的通电证据。**

    默认一个处理器都没挂，`dispatch` 立刻返回 ALLOW，整条路等于不存在——
    只测那个纯函数证明不了它接在链路上（§1）。所以这里自己挂一个，
    再走真 HTTP，看工具到底跑没跑。
    """
    seen = {}

    def veto(payload):
        seen.update(payload)
        return HookOutcome(decision=HookDecision.DENY, reason="这个应用先别搜")

    register_hook(HookEvent.PRE_TOOL_USE, "veto", veto)

    sid = new_sid("hook-deny")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("search_evidence", {"query": "请假"})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "查一下"))

    kinds = [e.get("type") for e in events]
    # 变异咬这一条：把 pre_tool_use 那段派发删掉 → 工具照跑。
    assert "control_tool_result" not in kinds, kinds
    assert any(
        e.get("type") == "control_text" and "这个应用先别搜" in str(e.get("text") or "")
        for e in events
    ), events
    # 载荷里得有工具名和实参，否则处理器没法判断
    assert seen.get("tool") == "search_evidence", seen
    assert seen.get("args") == {"query": "请假"}, seen


def test_钩子炸了照样放行_但留痕(harness, capsys):
    """grok 那行 SECURITY：处理器出错 = 什么都没贡献，只有健康的 deny 才拦。

    ⚠ 反过来写（炸了就拦）会让一个写错的钩子把所有推演堵死，而且堵得
      毫无线索。但 fail-open **必须留痕**——不留痕就成了"静静地什么都没发生"。
    """

    def boom(payload):
        raise RuntimeError("我自己炸了")

    register_hook(HookEvent.PRE_TOOL_USE, "boom", boom)

    sid = new_sid("hook-boom")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("search_evidence", {"query": "请假"})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "查一下"))

    assert "control_tool_result" in [e.get("type") for e in events], "炸了就把工具拦掉了"
    assert "我自己炸了" in capsys.readouterr().out, "fail-open 了但没留痕"


def test_钩子能改写入参(harness):
    """抄 grok `updatedInput`。

    ⚠ 第一版拿 `search_evidence` 做探针——它**结果里不回显 query**，
      于是改写生效了判据也看不见（在量一个不承载证据的出口）。
      换成 `todo_write`：它产出的 `control_todo` 事件直接带内容。
    """

    def rewrite(payload):
        return HookOutcome(
            updated_input={"todos": [{"id": "t1", "content": "被钩子改过的那一步"}]}
        )

    register_hook(HookEvent.PRE_TOOL_USE, "rewrite", rewrite)

    sid = new_sid("hook-rewrite")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": [{"id": "t1", "content": "原来那一步"}]})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "列一下"))
    todo = [e for e in events if e.get("type") == "control_todo"]
    assert todo, [e.get("type") for e in events]
    assert "被钩子改过的那一步" in str(todo[-1].get("summary") or ""), todo[-1]
    assert "原来那一步" not in str(todo[-1].get("summary") or ""), "改写没生效"


def test_没挂钩子时这条路等于不存在(harness):
    """反向。没有它，「默认就拦」这种写反的实现照样能让上面几条绿。"""
    sid = new_sid("hook-none")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("search_evidence", {"query": "请假"})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "查一下"))
    assert "control_tool_result" in [e.get("type") for e in events]


# ── 二、只有闸类事件能拦 ─────────────────────────────────────────────────


def test_只是通知的事件_判决一律丢掉():
    """⚠ 不丢的话，一个只想记日志的处理器返回个 deny 就能把推演掐掉，
    而且没有任何报错——表现为「有时候点了没反应」。"""
    register_hook(
        HookEvent.POST_TOOL_USE,
        "logger",
        lambda p: HookOutcome(decision=HookDecision.DENY, reason="我只是想记日志"),
    )
    assert dispatch(HookEvent.POST_TOOL_USE, {}).decision is HookDecision.ALLOW


def test_闸类事件的deny算数():
    register_hook(
        HookEvent.PRE_TOOL_USE,
        "gate",
        lambda p: HookOutcome(decision=HookDecision.DENY, reason="不行"),
    )
    v = dispatch(HookEvent.PRE_TOOL_USE, {})
    assert v.decision is HookDecision.DENY and v.reason == "不行"
    assert v.blocked_by == "gate"


def test_每个事件都得声明自己是哪种闸():
    """grok 用宏焊死这条（漏了编译不过）。Python 靠这条判据顶上。"""
    for event in HookEvent:
        assert isinstance(gate_kind(event), GateKind), event
    assert can_block(HookEvent.PRE_TOOL_USE)
    assert not can_block(HookEvent.POST_TOOL_USE)
    assert not can_block(HookEvent.SESSION_START)


def test_第一个健康的deny说了算_后面的不再问():
    order = []

    def first(p):
        order.append("first")
        return HookOutcome(decision=HookDecision.DENY, reason="第一个拦的")

    def second(p):
        order.append("second")
        return HookOutcome(decision=HookDecision.DENY, reason="第二个")

    register_hook(HookEvent.PRE_TOOL_USE, "a", first)
    register_hook(HookEvent.PRE_TOOL_USE, "b", second)
    v = dispatch(HookEvent.PRE_TOOL_USE, {})
    assert v.reason == "第一个拦的"
    assert order == ["first"], "拦下之后还在往下问"


def test_炸掉的处理器不算拦_健康的deny才算():
    register_hook(
        HookEvent.PRE_TOOL_USE, "boom", lambda p: (_ for _ in ()).throw(RuntimeError("x"))
    )
    v = dispatch(HookEvent.PRE_TOOL_USE, {})
    assert v.decision is HookDecision.ALLOW
    assert v.errors and v.errors[0][0] == "boom"


def test_deny没写理由也要有一句话():
    """拦下必须有理由，否则用户只看到「点了没反应」。"""
    register_hook(
        HookEvent.PRE_TOOL_USE, "silent", lambda p: HookOutcome(decision=HookDecision.DENY)
    )
    assert "silent" in dispatch(HookEvent.PRE_TOOL_USE, {}).reason


def test_返回了别的东西当成没返回_不去猜():
    register_hook(HookEvent.PRE_TOOL_USE, "weird", lambda p: "deny")
    v = dispatch(HookEvent.PRE_TOOL_USE, {})
    assert v.decision is HookDecision.ALLOW
    assert v.errors and "non-HookOutcome" in v.errors[0][1]


def test_载荷太大就不派发():
    """抄 grok MAX_PAYLOAD_SIZE。把一份 4MB 的页面 HTML 塞进每个钩子，
    钩子没问题，进程会有问题。"""
    hit = []
    register_hook(HookEvent.PRE_TOOL_USE, "x", lambda p: hit.append(1))
    v = dispatch(HookEvent.PRE_TOOL_USE, {"blob": "x" * (MAX_PAYLOAD_BYTES + 10)})
    assert hit == [], "超限载荷还是派发出去了"
    assert v.errors and "too large" in v.errors[0][1]


# ── 三、注册表 ───────────────────────────────────────────────────────────


def test_同名覆盖不追加():
    register_hook(HookEvent.PRE_TOOL_USE, "same", lambda p: None)
    register_hook(HookEvent.PRE_TOOL_USE, "same", lambda p: None)
    assert registered(HookEvent.PRE_TOOL_USE) == ["same"]


def test_能摘掉():
    register_hook(HookEvent.PRE_TOOL_USE, "a", lambda p: None)
    unregister_hook(HookEvent.PRE_TOOL_USE, "a")
    assert registered(HookEvent.PRE_TOOL_USE) == []


def test_没挂处理器时不干活():
    assert dispatch(HookEvent.PRE_TOOL_USE, {}).allowed()
    assert dispatch(HookEvent.PRE_TOOL_USE, {}).errors == []
