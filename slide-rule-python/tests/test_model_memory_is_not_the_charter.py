# -*- coding: utf-8 -*-
"""模型自己攒的记忆：它写、它查、跨会话活着，而且**跟产品宪章分开**。

抄的标准答案：grok-build `xai-grok-memory`（MemoryScope / MemoryStorage）
以及它的 `ToolKind::MemorySearch` / `MemoryGet` 两件模型工具。

## 两份不许合并

    产品宪章  用户自己写的行业约束，长期不变，opt-in，模型只读
    这一份    模型自己攒的经验，它写它查，随时可能过时

合并了会出现「模型往宪章里塞一条自己编的规矩，下一场当成用户定的约束执行」。

## 没抄的那一大半

grok 的 memory 是 17 个 rs：markdown 文件、embedding、sqlite-vec、MMR 重排、
查询扩展、后台 dream 整理、文件 watcher。这里一样没做，理由写在模块头注里
（几十条记忆上关键词和向量的召回差别可忽略，而向量索引是一整套没法一夜验完
的基础设施）。**判据不许假装那些做了。**
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
from services.closed_tools import CLOSED_TOOLS, ToolScope, resolve_tool_scope
from services.model_memory import (
    MAX_NOTE_CHARS,
    MAX_NOTES,
    MAX_RECALL,
    load_notes,
    recall,
    remember,
    reset_memory_cache,
    summarize,
)
from services.rehearsal_control import _memory_scope_id, should_list_tool
from models.v5_state import V5SessionState

pytest.importorskip("fastapi")


@pytest.fixture(autouse=True)
def _clean():
    reset_memory_cache()
    yield
    reset_memory_cache()


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _uid(prefix: str) -> str:
    import uuid

    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _login_as(monkeypatch, owner: str) -> None:
    from types import SimpleNamespace
    from control_turn_support import client
    from middlewares.current_user import optional_user

    # Earlier tests reload app; the harness still sends requests to its original instance.
    user = SimpleNamespace(id=owner, is_active=True, is_superuser=False)
    monkeypatch.setitem(client.app.dependency_overrides, optional_user, lambda: user)


# ── 一、写 / 查 ─────────────────────────────────────────────────────────


def test_记下来_查得到():
    u = _uid("m")
    assert remember(scope_id=u, text="这个用户不要蓝色")[0] is True
    hits = recall(scope_id=u, query="蓝色")
    assert [r["text"] for r in hits] == ["这个用户不要蓝色"]


def test_同一条不记第二遍():
    """模型每轮都想"确认一下"是常事。不去重会把同一句攒成几十条，
    然后把检索结果全占满。"""
    u = _uid("m")
    assert remember(scope_id=u, text="不要蓝色")[0] is True
    ok, say = remember(scope_id=u, text="不要蓝色")
    assert ok is False and "记过" in say
    assert len(load_notes(scope_id=u)) == 1


def test_空的记不了_没归属也记不了():
    """§7：记不了就说记不了，不许假装记下了。"""
    assert remember(scope_id=_uid("m"), text="   ")[0] is False
    assert remember(scope_id="", text="有内容")[0] is False


def test_中英都能查得到():
    u = _uid("m")
    remember(scope_id=u, text="他们的角色叫主管，不叫经理")
    remember(scope_id=u, text="prefers CSV export over Excel")
    assert recall(scope_id=u, query="主管")
    assert recall(scope_id=u, query="CSV")


def test_空查询拿最近几条_新的在前():
    u = _uid("m")
    for i in range(3):
        remember(scope_id=u, text=f"第{i}条")
    got = [r["text"] for r in recall(scope_id=u)]
    assert got[0] == "第2条", got


def test_命中的词越多越靠前():
    u = _uid("m")
    remember(scope_id=u, text="登录页要工号")
    remember(scope_id=u, text="登录页要工号和验证码")
    top = recall(scope_id=u, query="工号 验证码")[0]["text"]
    assert top == "登录页要工号和验证码", top


def test_一次最多回几条_不许把提示词顶穿():
    u = _uid("m")
    for i in range(MAX_RECALL + 6):
        remember(scope_id=u, text=f"关于登录的第{i}条")
    assert len(recall(scope_id=u, query="登录")) <= MAX_RECALL


def test_超上限从最旧的开始丢():
    """新的更可能还成立。"""
    u = _uid("m")
    for i in range(MAX_NOTES + 5):
        remember(scope_id=u, text=f"第{i}条")
    notes = load_notes(scope_id=u)
    assert len(notes) == MAX_NOTES
    assert notes[0]["text"] == "第5条", notes[0]


def test_单条超长截断而不是拒收():
    """模型写长了是常事，为此丢掉整条不划算。"""
    u = _uid("m")
    assert remember(scope_id=u, text="长" * (MAX_NOTE_CHARS + 50))[0] is True
    assert len(load_notes(scope_id=u)[0]["text"]) == MAX_NOTE_CHARS


def test_没记过时说没有_不许编():
    assert summarize(recall(scope_id=_uid("m"), query="随便")) == "没有相关的记忆。"


# ── 二、跟宪章分开 ───────────────────────────────────────────────────────


def test_记忆和宪章是两张表():
    """合并了会出现「模型往宪章里塞一条自己编的规矩，下一场当成用户定的
    约束执行」。"""
    from services.model_memory import TABLE as MEM_TABLE
    from services.product_charter import TABLE as CHARTER_TABLE

    assert MEM_TABLE != CHARTER_TABLE


def test_记忆挂在账号上_不是会话上():
    """⚠ 拿 sessionId 当键就退化成"会话内记忆"，跟直接写 transcript 没区别——
    跨会话活着才是这件工具的全部意义。"""
    st = V5SessionState(sessionId="s1", goal={"text": "x"})
    st.ownerId = "u-abc"
    assert _memory_scope_id(st) == "u-abc"
    st2 = V5SessionState(sessionId="s2", goal={"text": "x"})
    assert _memory_scope_id(st2) == ""


def test_没账号归属时压根不列这两件工具():
    st = V5SessionState(sessionId="s", goal={"text": "x"})
    assert not should_list_tool("remember", st)
    assert not should_list_tool("recall", st)
    st.ownerId = "u-1"
    assert should_list_tool("remember", st)


# ── 三、活路径 ───────────────────────────────────────────────────────────


def test_模型调remember_真的落到账号上(harness, monkeypatch):
    sid = new_sid("mem")
    owner = _uid("owner")
    _login_as(monkeypatch, owner)
    seed_session(sid, goal={"text": "请假系统", "status": "clear"}, ownerId=owner)

    harness.llm_impl = lambda messages, **kw: (
        llm_tool("remember", {"text": "这个用户不要蓝色"})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "记一下"))
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "remember"
    ]
    assert res and res[0].get("ok") is True, [e.get("type") for e in events]
    # 变异咬这一条：分发分支不落库 → 这里查不到。
    assert [r["text"] for r in recall(scope_id=owner, query="蓝色")] == [
        "这个用户不要蓝色"
    ]


def test_换一个会话还查得到_这才叫跨会话(harness, monkeypatch):
    """**这条是这件工具存在的理由。** 同一个账号、另一个会话。"""
    owner = _uid("owner")
    _login_as(monkeypatch, owner)
    sid1 = new_sid("mem-a")
    seed_session(sid1, goal={"text": "请假系统", "status": "clear"}, ownerId=owner)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("remember", {"text": "角色叫主管不叫经理"})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    harness.post(six_fields(sid1, "记一下"))

    sid2 = new_sid("mem-b")
    seed_session(sid2, goal={"text": "报销系统", "status": "clear"}, ownerId=owner)
    calls = {"n": 0}

    def impl(messages, **kw):
        calls["n"] += 1
        return (
            llm_tool("recall", {"query": "角色"})
            if calls["n"] == 1
            else llm_text("好")
        )

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid2, "以前说过啥"))
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "recall"
    ]
    assert res, [e.get("type") for e in events]
    assert "主管" in str(res[0].get("summary") or ""), res[0]


def test_别的账号查不到(harness):
    """反向。少了它，「所有人共用一份记忆」照样能让上面几条绿——
    而那是把一个用户的偏好泄漏给另一个用户。"""
    a, b = _uid("owner"), _uid("owner")
    remember(scope_id=a, text="甲的偏好")
    assert recall(scope_id=b, query="偏好") == []


def test_两件工具都是读权限():
    """remember 写的是**记忆**不是五系统模型，不进工厂信封。"""
    for name in ("remember", "recall"):
        assert name in CLOSED_TOOLS
        assert resolve_tool_scope(name) is ToolScope.READ


def test_闭集两侧同步():
    from pathlib import Path

    ts = (
        Path(__file__).resolve().parents[2] / "client/src/lib/factory-hops.ts"
    ).read_text("utf-8")
    for name in ("remember", "recall"):
        assert f'"{name}"' in ts, f"TS 镜像漏了 {name}"


def test_没归属的会话_说清楚而不是假装记下了():
    """⚠ 变异测试逮到这条分支**一条判据都没有**：把 ok 改成 True
    （假装记下了）全绿。

    ⚠ 而且它走不通 `ControlHarness`——`seed_session` 会给会话装上归属，
      正常路径也不会列这两件工具（没归属就不列）。所以直接驱动
      `_dispatch_tool`。

      那这条分支为什么还留着？因为**无主会话真出现过**：
      routes/sliderule_full.py 那段 2026-08-09 的记录写着
      「没带 ownerId → merge 时把服务端那条覆盖成 None，会话静默变无主」。
      §7：记不了就说记不了，不许伪造绿灯。
    """
    import asyncio

    from services.rehearsal_control import _dispatch_tool

    st = V5SessionState(sessionId="no-owner", goal={"text": "请假系统"})
    assert _memory_scope_id(st) == ""

    async def drive():
        out = []
        async for ev in _dispatch_tool(
            "remember", {"text": "随便记一条"}, st, "记一下", None, None, None, None, ""
        ):
            out.append(ev)
        return out

    events = asyncio.run(drive())
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "remember"
    ]
    assert res, [e.get("type") for e in events]
    assert res[0].get("ok") is False, res[0]
    assert "归属" in str(res[0].get("error") or ""), res[0]


def test_空查询按当前目标滤_不许把待办偏好倒进PPT(harness, monkeypatch):
    """真机 sr-20260921150545：PPT 回合 recall 空查询，倒出待办清单偏好。"""
    owner = _uid("owner")
    _login_as(monkeypatch, owner)
    remember(scope_id=owner, text="待办清单偏好：简洁清爽、要账号登录、All|Active|Done")
    sid = new_sid("ppt-recall")
    seed_session(
        sid,
        goal={"text": "@office-skills 做一份5页PPT", "status": "clear"},
        ownerId=owner,
    )
    n = {"i": 0}

    def impl(*_a, **_k):
        n["i"] += 1
        return llm_tool("recall", {"query": ""}) if n["i"] == 1 else llm_text("好")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "开始做PPT"))
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "recall"
    ]
    assert res, [e.get("type") for e in events]
    blob = str(res[0].get("summary") or "") + str(res[0].get("notes") or "")
    assert "All|Active|Done" not in blob
    assert "账号登录" not in blob
    assert "待办清单" not in blob
    assert int(res[0].get("taskChars") or 0) > 0


def test_偏好查询也不得把待办倒进PPT(harness, monkeypatch):
    """⚠ 2026-09-21 XSGAMK9PYZ：模型 query=设计偏好，空查询闸不响。"""
    owner = _uid("owner")
    _login_as(monkeypatch, owner)
    remember(scope_id=owner, text="待办清单偏好：简洁清爽、要账号登录、All|Active|Done")
    sid = new_sid("ppt-recall-pref")
    seed_session(
        sid,
        goal={"text": "@office-skills 做一份5页PPT，主题是「面团AI办公启动会」", "status": "clear"},
        ownerId=owner,
    )
    n = {"i": 0}

    def impl(*_a, **_k):
        n["i"] += 1
        return llm_tool("recall", {"query": "设计偏好"}) if n["i"] == 1 else llm_text("好")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "开始做PPT"))
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "recall"
    ]
    assert res, [e.get("type") for e in events]
    blob = str(res[0].get("summary") or "") + str(res[0].get("notes") or "")
    assert "All|Active|Done" not in blob
    assert "待办清单" not in blob
