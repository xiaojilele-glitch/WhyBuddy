# -*- coding: utf-8 -*-
"""老师傅自己列活儿清单：模型写、用户看得见、下一轮它自己也看得见。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/todo/mod.rs`

    Create and manage a structured task list.
    **The user sees this list live — it is your primary way to show progress.**
    Use for any task with 3+ steps. Skip for trivial single-step work.

第二句是它存在的理由。只落库不给人看 = 抄了一半，工具说明第二句就成了假话。

判据分四类：
1. **活路径**（§1）——真 HTTP：模型调 → 落库 → 发事件 → **下一发的 system
   里带着这张清单**（grok 的 `summary_for_prompt` 每轮跟着走）。
2. **韧性三条**——grok 注释里逐条写了为什么，少一条模型一次疏忽就把进度冲掉。
3. **两份待办不许混**（§7）——`factoryTodo` 是闸的输入，这一份是叙述。
   混了就会出现「模型把 closure 从清单里划掉，闭环就放行」。
4. **生成侧 / 消费侧成对**（§4）——服务端发 `control_todo`，客户端得认。
   新增事件不进客户端 switch 会被**静默丢掉**，跟 data-* 不进 DOMPurify 白名单
   是同一种伤。
"""

from __future__ import annotations

import ast
import copy
import json
from pathlib import Path

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
from services.plan_todo import (
    MAX_TODO_ITEMS,
    TodoStatus,
    apply as apply_todo,
    coerce_updates,
    effective_merge,
    normalize,
    one_line,
    summarize,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


THREE = [
    {"id": "t1", "content": "先画页面", "status": "in_progress"},
    {"id": "t2", "content": "再反推数据模型"},
    {"id": "t3", "content": "最后打权限孔"},
]


# ── 一、活路径 ────────────────────────────────────────────────────────────


def test_模型列的清单_落库_发事件_下一发自己还看得见(harness):
    sid = new_sid("todo-live")
    _confirmed(sid)
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        if len(harness.llm_calls) == 1:
            return llm_tool("todo_write", {"todos": THREE, "merge": False})
        return llm_text("好的")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "这活儿分几步做？"))

    # ① 发了给人看的事件（工具说明第二句的载体）
    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    assert "活儿清单" in todo_ev[0]["line"], todo_ev[0]
    assert "先画页面" in todo_ev[0]["summary"]

    # ② 真落库了
    saved = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["id"] for r in saved] == ["t1", "t2", "t3"], saved
    assert saved[0]["status"] == TodoStatus.IN_PROGRESS.value

    # ③ **同一轮**：靠工具结果回喂（grok 的 summary_for_prompt 就是 tool 结果）。
    #
    # ⚠ 第一版这里断言的是「第二发采样的 system 里有清单」——红了才想明白：
    #   控制面的 messages[0] 只在 **WRITE 交回之后**才重建（`wrote` 那一支），
    #   todo_write 是 READ，同一轮里 system 还是回合开始时那一份。
    #   grok 也不是走系统提示词：它把 summary 放进 tool 结果。照它抄才对。
    assert len(shots) >= 2, "第二发没采样，量不到回喂"
    tool_msgs = [m for m in shots[1] if m.get("role") == "tool"]
    assert tool_msgs, shots[1]
    body = json.loads(str(tool_msgs[-1].get("content") or "{}"))
    assert "先画页面" in str(body.get("summary") or ""), body
    # 抄 grok：回喂必须带 id。只回文案，下一发会另起 todo-1 叠两份
    # （2026-09-19 坦克大战 sr-20260919072444-11CSR1RSM6）。
    assert "t1:" in str(body.get("summary") or ""), body
    assert [r.get("id") for r in (body.get("todos") or [])] == ["t1", "t2", "t3"], body

    # ④ **下一轮**（新一发 HTTP，state 重新读）：靠系统提示词那条现场。
    shots.clear()
    harness.llm_impl = lambda messages, **kw: (
        shots.append(copy.deepcopy(messages)) or llm_text("嗯")
    )
    harness.post(six_fields(sid, "接着说"))
    system = str(shots[0][0].get("content") or "")
    assert "活儿清单" in system and "先画页面" in system, system[-500:]
    assert "t1:" in system, system[-500:]


def test_没列过清单时提示词里不许凭空多一段(harness):
    """反向。少了它，「每轮都塞一段空清单」照样绿。"""
    sid = new_sid("todo-none")
    _confirmed(sid)
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return llm_text("好的")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "随便聊聊"))
    assert "活儿清单" not in str(shots[0][0].get("content") or "")


def test_重复id是错误即输出_清单原样不动(harness):
    """抄 grok：`error-as-output variant so the Python side can distinguish
    this from infra errors`。分不清「模型写错了」和「我们炸了」，
    两种都会被当成后者。而且出错时清单必须原样——半张比没写更糟。"""
    sid = new_sid("todo-dup")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n == 1:
            return llm_tool("todo_write", {"todos": THREE, "merge": False})
        if n == 2:
            return llm_tool(
                "todo_write", {"todos": [{"id": "x"}, {"id": "x"}]}, call_id="dup"
            )
        return llm_text("好的")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "列一下"))

    bad = [
        e
        for e in events
        if e.get("type") == "control_tool_result"
        and e.get("tool") == "todo_write"
        and e.get("ok") is False
    ]
    assert bad, [e.get("type") for e in events]
    assert "唯一" in str(bad[0].get("error") or "")
    # 清单没被那一笔弄坏
    saved = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["id"] for r in saved] == ["t1", "t2", "t3"], saved


# ── 二、grok 的韧性三条 ───────────────────────────────────────────────────


def test_merge缺省为真_只翻状态不必回抄内容():
    """grok：`This lets the model mark an item from in_progress → completed
    without echoing the content back.`"""
    rows, err = apply_todo(None, THREE, merge=False)
    assert err is None
    after, err = apply_todo(rows, [{"id": "t1", "status": "completed"}])
    assert err is None
    assert [r["id"] for r in after] == ["t1", "t2", "t3"], after
    assert after[0]["content"] == "先画页面", "只翻状态把内容冲掉了"
    assert after[0]["status"] == TodoStatus.COMPLETED.value


def test_合并时内容丢了拿id兜底_永不报错():
    """grok：`so the tool never errors on a merge call. This makes the tool
    resilient to state being lost between calls.`"""
    rows, err = apply_todo(None, [{"id": "补一条"}], merge=True)
    assert err is None
    assert rows == [{"id": "补一条", "content": "补一条", "status": "pending"}]


def test_忘了写merge时自动升格_但不许扩大成猜意图():
    """grok 的自动升格。正向 + **反向**：只要有一条是新 id 或带了内容，
    就按调用方说的算——自动升格只救「明显是想改状态却忘了写 merge」。"""
    rows, _ = apply_todo(None, THREE, merge=False)
    assert effective_merge(rows, [{"id": "t1"}, {"id": "t2"}], False) is True
    # 新 id → 不升格。minimax 会整张替换；我们跟 grok，不许猜成替换。
    assert effective_merge(rows, [{"id": "t9"}], False) is False
    # 带了内容 → 不升格（那是真的想重写）
    assert effective_merge(rows, [{"id": "t1", "content": "改一改"}], False) is False
    # 清单本来是空的 → 没什么可合并
    assert effective_merge([], [{"id": "t1"}], False) is False


def test_显式replace是真的整张换掉():
    rows, _ = apply_todo(None, THREE, merge=False)
    after, _ = apply_todo(rows, [{"id": "n1", "content": "新计划"}], merge=False)
    assert [r["id"] for r in after] == ["n1"], after


def test_认不出的状态一律当没做_不当已完成():
    """缺省是最保守那一档，不是最乐观那一档。把认不出的当成已完成，
    进度条会自己跑满。"""
    rows, _ = apply_todo(None, [{"id": "a", "status": "以后新加的状态"}])
    assert rows[0]["status"] == TodoStatus.PENDING.value


def test_清单有上限_不许把SPEC抄一遍进提示词():
    many = [{"id": f"i{n}", "content": f"第 {n} 步"} for n in range(MAX_TODO_ITEMS + 8)]
    rows, _ = apply_todo(None, many, merge=False)
    assert len(rows) == MAX_TODO_ITEMS


# 2026-09-19 飞机大战 sr-20260919163941-977KTNMZ0K 的形状：
# 早上 8 条 grok 风 id，续跑另起 task-1…8，文案相同。
_AIRPLANE_OLD = [
    {"id": "init-project", "content": "初始化 Vite React 工程", "status": "completed"},
    {"id": "audio-engine", "content": "音效引擎", "status": "completed"},
    {"id": "canvas-engine", "content": "Canvas 渲染器、精灵、输入与游戏循环", "status": "in_progress"},
    {"id": "ui-hud", "content": "HUD 与开始界面", "status": "pending"},
    {"id": "player-ship", "content": "玩家飞机与射击", "status": "pending"},
    {"id": "enemies", "content": "敌机与碰撞", "status": "pending"},
    {"id": "score", "content": "分数与生命", "status": "pending"},
    {"id": "polish", "content": "手感与收尾", "status": "pending"},
]
_AIRPLANE_NEW = [
    {"id": f"task-{i + 1}", "content": row["content"], "status": "completed"}
    for i, row in enumerate(_AIRPLANE_OLD)
]


def test_同文案新id合回旧条_飞机大战不许叠成十六():
    """真机那一发：merge 缺省为真，新 id 按 id 对不上就追加。

    正向：8 + 8 同文案 → 还是 8 条，canvas 完成，不是 3/16。
    反向：文案不同的新 id 仍追加——那是真的多了一条，不许模糊匹配。
    """
    rows, err = apply_todo(None, _AIRPLANE_OLD, merge=False)
    assert err is None and len(rows) == 8
    after, err = apply_todo(rows, _AIRPLANE_NEW)
    assert err is None, err
    assert len(after) == 8, after
    assert [r["content"] for r in after] == [r["content"] for r in _AIRPLANE_OLD]
    assert all(r["status"] == TodoStatus.COMPLETED.value for r in after), after
    assert after[2]["id"] == "task-3"
    assert "canvas-engine" not in [r["id"] for r in after]
    line = one_line(after)
    assert "8/8" in line
    assert "正在做" not in line

    extra, err = apply_todo(after, [{"id": "task-9", "content": "额外的收尾"}])
    assert err is None
    assert len(extra) == 9, extra
    assert extra[-1]["content"] == "额外的收尾"


def test_已经叠成两套的清单读出来也合成一条():
    """续跑当时已经落库 16 条。下一笔 todo_write 之前，浮层和回喂
    也必须是 8——只修 apply、不修 normalize，已经写坏的会话仍钉 3/16。"""
    stacked = list(_AIRPLANE_OLD) + list(_AIRPLANE_NEW)
    healed = normalize(stacked)
    assert len(healed) == 8, healed
    assert healed[2]["status"] == TodoStatus.COMPLETED.value
    assert healed[2]["id"] == "task-3"
    assert "3/16" not in one_line(healed)
    assert "8/8" in one_line(healed)


def test_飞机大战同文案新id_活路径上也是八条(harness):
    """§1：直接调 apply 绿了不算，todo_write 分发必须走到同一份。"""
    sid = new_sid("todo-plane")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": _AIRPLANE_OLD, "merge": False})
        if len(harness.llm_calls) == 1
        else llm_text("好的")
    )
    harness.post(six_fields(sid, "列一下"))
    n = [0]

    def impl(messages, **kw):
        n[0] += 1
        if n[0] == 1:
            return llm_tool("todo_write", {"todos": _AIRPLANE_NEW})
        return llm_text("好的")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "接着做"))
    saved = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["id"] for r in saved] == [f"task-{i}" for i in range(1, 9)], saved
    assert all(r["status"] == TodoStatus.COMPLETED.value for r in saved)
    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev and len(todo_ev[-1]["todos"]) == 8, todo_ev[-1] if todo_ev else events


# ── 三、两份待办不许混（§7）──────────────────────────────────────────────


def test_活儿清单碰不到闭环那本账(harness):
    """`factoryTodo` 是闭环闸的输入（非空不发合格证），这一份是叙述。

    混了就会出现「模型把 closure 从清单里划掉，闭环就放行」——§7 伪造绿灯。
    这里让模型把带 closure 字样的条目全标成完成，factoryTodo 必须纹丝不动。
    """
    sid = new_sid("todo-sep")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        factoryTodo=["structure", "bind"],
    )
    harness.llm_impl = lambda messages, **kw: (
        llm_tool(
            "todo_write",
            {
                "todos": [
                    {"id": "structure", "content": "structure", "status": "completed"},
                    {"id": "bind", "content": "bind", "status": "completed"},
                    {"id": "closure", "content": "closure", "status": "completed"},
                ],
                "merge": False,
            },
        )
        if len(harness.llm_calls) == 1
        else llm_text("好了")
    )
    harness.post(six_fields(sid, "都标完成"))

    st = load_session(sid)
    assert list(getattr(st, "factoryTodo", None) or []) == ["structure", "bind"], (
        "活儿清单动了闭环那本账"
    )
    assert len(normalize(getattr(st, "controlTodo", None))) == 3


def test_两个字段在状态上是分开的():
    st = V5SessionState(sessionId="sep", goal={"text": "x"})
    assert "factoryTodo" in V5SessionState.model_fields
    assert "controlTodo" in V5SessionState.model_fields
    assert getattr(st, "factoryTodo", None) is None
    assert getattr(st, "controlTodo", None) is None


# ── 四、成对物：归属三处 + 生成侧/消费侧（§4）────────────────────────────


def test_归属三处齐备_客户端PUT抹不掉():
    """照 factoryTodo：PUT pop + model_dump exclude + persist 见 None 才 restore。

    ⚠ 少任何一处都不报错，只会**静静地**被客户端一次全量 PUT 抹掉——
      ownerId 那次就是这么丢的（实测 POST 建好 → PUT 一次 → DELETE 404）。
    """
    route = (ROOT / "slide-rule-python/routes/sliderule_full.py").read_text("utf-8")
    assert 'client_input.pop("controlTodo", None)' in route
    assert '"controlTodo"' in route.split("model_dump(exclude=")[1][:600]
    persist = (ROOT / "slide-rule-python/services/persistence.py").read_text("utf-8")
    at = persist.find('prior_plan = getattr(prior, "controlTodo"')
    assert at > 0, "persist 没有 restore 这一段"
    assert 'update={"controlTodo": prior_plan}' in persist[at : at + 700]


def test_服务端发的事件客户端必须认():
    """新增流事件不进客户端 switch 会被**静默丢掉**——跟新增 data-* 不进
    DOMPurify 白名单是同一种伤（CLAUDE.md §4 那张表）。"""
    driver = (ROOT / "client/src/lib/sliderule-marathon-driver.ts").read_text("utf-8")
    assert 'case "control_todo":' in driver, "客户端不认这个事件"
    assert "onControlTodo" in driver
    hook = (
        ROOT / "client/src/pages/sliderule/useSlideRuleSession.ts"
    ).read_text("utf-8")
    assert "onControlTodo" in hook, "认了但没人接 = 清单还是看不见"
    hook_tail = hook.split("onControlTodo")[1][:600]
    assert "controlTodo" in hook_tail, "接了但不写进 state = 浮层读不到"
    assert "setSessionState" in hook_tail
    assert "appendStreamStep" not in hook_tail, (
        "再往左栏塞 📋 = 清单又嵌回聊天（2026-09-15 对照 Manus）"
    )


def test_闭集两侧同步():
    ts = (ROOT / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert "todo_write" in CLOSED_TOOLS
    assert '"todo_write"' in ts, "TS 镜像漏了 = 芯片一半不认"
    # 它不造五系统模型 → READ（缺省），紧档的原地打转检测正好接得上。
    assert resolve_tool_scope("todo_write") is ToolScope.READ


def test_工具说明第二句必须在():
    """grok 的说明只有两句，第二句「用户看得见」是它存在的理由。
    砍掉就只剩模型自言自语，而这条判据在别处**量不到**——
    提示词里没有它，模型不知道这清单是给人看的。"""
    from services.rehearsal_control import CONTROL_TOOLS

    desc = next(
        (t["function"]["description"] for t in CONTROL_TOOLS
         if (t.get("function") or {}).get("name") == "todo_write"),
        "",
    )
    assert "用户看得见" in desc, desc
    assert "三步以上" in desc, desc
    assert "回喂里的 id" in desc, desc


def test_渲染标记只有一处():
    """状态 → 标记只许一张表。第二处会漂（同 _STOP_TABLE 那条纪律）。"""
    src = (ROOT / "slide-rule-python/services/plan_todo.py").read_text("utf-8")
    tree = ast.parse(src)
    tables = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.AnnAssign)
        and isinstance(n.target, ast.Name)
        and n.target.id == "_TAG"
    ]
    assert len(tables) == 1
    line = summarize([{"id": "a", "content": "x", "status": "completed"}])
    assert line.startswith("●")
    # 抄 grok `- [completed] a: x`：标记、id、文案三段都在。
    # 反向：只回 `● x` 就是 2026-09-19 那场叠两份的回喂。
    assert line == "● a: x"
    assert "a:" in line and line != "● x"
    assert one_line([]) == ""


# ── 五、真机 todo-1788951017 逮到的：送了 N 条不许静默变 0 条 ────────────


@pytest.mark.parametrize(
    "shape",
    [
        pytest.param([{"content": "设计数据模型"}, {"content": "规划页面"}], id="没带id"),
        pytest.param(["设计数据模型", "规划页面"], id="整条是字符串"),
        pytest.param([{"task": "设计数据模型"}, {"text": "规划页面"}], id="别的键名"),
    ],
)
def test_模型送了几条清单里就得有几条(shape):
    """⚠ 这条是真机打出来的。todo-1788951017：模型在正文里老老实实列了四步，
    `control_todo` 事件里却是「还没有列活儿清单。」，工具还回 `ok: true`。

    真因是它没带 id，而第一版那句 `if not rid: continue` 把四条全丢了——
    **正向判据全绿、东西没了**（CLAUDE.md §3）。改造前那批单测全都是我自己
    构造的、每条都带 id 的输入，所以一条都没红：判据自己喂了护栏想要的形状
    （§一之二）。

    这一条钉的是不变量本身：**非空输入不许产出空清单**。以后模型再换一种
    填法，红的是这里，不是用户那边。
    """
    rows, err = apply_todo(None, shape)
    assert err is None, err
    assert len(rows) == len(shape), (shape, rows)
    assert all(r["content"] for r in rows), rows
    assert all(r["id"] for r in rows), rows


def test_没带id时拿内容当id_下一笔还能对上():
    """兜底的 id 必须**稳定**，否则合并永远命不中，每一笔都变成新条目，
    清单越滚越长——用户看着进度反着走。"""
    rows, _ = apply_todo(None, [{"content": "设计数据模型"}, {"content": "规划页面"}])
    assert [r["id"] for r in rows] == ["设计数据模型", "规划页面"]
    after, err = apply_todo(rows, [{"id": "设计数据模型", "status": "completed"}])
    assert err is None
    assert len(after) == 2, "合并没命中，长出了新条目"
    assert after[0]["status"] == TodoStatus.COMPLETED.value


def test_空输入才允许是空清单():
    """反向：不许为了让上面那条过，把空输入也塞出一条来。"""
    rows, err = apply_todo(None, [])
    assert rows == [] and err is None
    assert summarize(rows) == "还没有列活儿清单。"


def test_工具不许在吞掉了内容之后还说ok(harness):
    """活路径上的同一条不变量：模型送了东西、清单是空的，`ok` 不许是 true。"""
    sid = new_sid("todo-noid")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool(
            "todo_write",
            {"todos": [{"content": "第一步"}, {"content": "第二步"}, {"content": "第三步"}]},
        )
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))

    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    assert len(todo_ev[-1]["todos"]) == 3, todo_ev[-1]
    assert "第一步" in todo_ev[-1]["summary"]
    assert todo_ev[-1]["line"], "左栏那一句是空的 = 用户还是看不见"
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "todo_write"
    ]
    assert res and res[-1].get("count") == 3, res


def test_活路径上整条字符串的清单不许被滤掉(harness):
    """`coerce_updates` 认「整条是字符串」这种形状，判据也钉过——**但那三条
    韧性在真机上一次都用不上**：分发处先 `isinstance(u, dict)` 滤了一道。

    ⚠ 2026-09-10 逮到的形状，本仓 §一：修复本身是对的，装在不通电的插座上。
      上一版 22 条判据全绿，因为它们直接调 `apply_todo`，从没经过分发。
      这一条走 harness，钉的是**入参进得来**。
    """
    sid = new_sid("todo-strings")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": ["登记书目", "扫码借出", "到期提醒"]})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))

    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    assert len(todo_ev[-1]["todos"]) == 3, todo_ev[-1]
    assert "登记书目" in todo_ev[-1]["summary"], todo_ev[-1]
    assert todo_ev[-1]["line"], "左栏那一句是空的 = 用户还是看不见"


def test_活路径上写不进任何一条时不许回ok(harness):
    """反向那半（§三）：上一条钉「非空输入不许产出空清单」，这一条钉
    **空结果不许回 ok**。

    ⚠ 2026-09-10 真机 probe-build-1789004996 第 4 轮：模型自己挑了 todo_write，
      拿到的是 `ok: true, count: 0`，`control_todo` 的 line 是空串——
      用户那边一个字都没有，模型那边是一盏绿灯。§7：工具结果是一句
      「我干了活」的声明，不是增强项，缺就是缺。
    """
    sid = new_sid("todo-empty")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": []})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))

    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "todo_write"
    ]
    assert res, [e.get("type") for e in events]
    assert res[-1].get("ok") is False, res[-1]
    assert "待办" in str(res[-1].get("error") or ""), res[-1]
    # 反向：不许一边报错一边还发一条空 chip 出去。
    assert not [e for e in events if e.get("type") == "control_todo"], events


def test_显式清空是有意的动作_左栏要看得见(harness):
    """`merge: false` + 空 todos = 「把清单清了」，这是真动作，不是没写成。
    它得走 ok，而且左栏那一句不许是空串——空串在前端等于隐身
    （useSlideRuleSession:2069 `if (payload.line)`）。"""
    sid = new_sid("todo-clear")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": [], "merge": False})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "清了吧"))

    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "todo_write"
    ]
    assert res and res[-1].get("ok") is True, res
    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev and todo_ev[-1]["todos"] == [], todo_ev
    assert todo_ev[-1]["line"], "清空也要看得见，空串在前端等于没发"


#: 2026-09-10 真机 real-topic-survives-1789005461 第 2 轮的**原样载荷**。
#: 不许照着记忆重拼一个（§一之二）——键名没加引号正是它抛 json 的原因。
真机序列化的一发 = [
    '{id: "spec", content: "起草并确认门店排班与考勤系统 SPEC", status: "in_progress"}',
    '{id: "pages", content: "生成相关前端页面", status: "pending"}',
    '{id: "structure", content: "反推数据结构与权限点", status: "pending"}',
]


#: 同一天第二发（real-topic-survives-1789005633）：值用的是**单引号**。
#: 两发都留着——只留一发，另一种填法回来时红的还是用户那边。
真机序列化的第二发 = [
    "{id: '1', content: '起草系统 SPEC', status: 'pending'}",
    "{id: '2', content: '生成页面代码', status: 'pending'}",
]


def test_单引号的对象字面量也要能还原():
    """只补键的引号治不了它——`json.loads` 认双引号。第三道
    `ast.literal_eval` 管这一种。"""
    rows = coerce_updates(真机序列化的第二发)
    assert [r["id"] for r in rows] == ["1", "2"], rows
    assert rows[0]["content"] == "起草系统 SPEC", rows[0]
    assert all("{" not in r["content"] for r in rows), rows


def test_活路径上单引号那一发同样变成人看得懂的清单(harness):
    """真机 real-topic-survives-1789005633 的原样载荷，走完控制面。"""
    sid = new_sid("todo-single-quote")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": 真机序列化的第二发})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))
    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    summary = todo_ev[-1]["summary"]
    assert "起草系统 SPEC" in summary, summary
    assert "{" not in summary and "status" not in summary, summary


def test_被序列化成字符串的一条要能还原():
    """模型把每条待办 `JSON.stringify` 了一遍再塞进数组，而且键名没加引号。

    ⚠ 拆掉分发处那道 dict 滤网之后才看得见这一发：在那之前它整张被丢掉
      （`ok: true, count: 0`）；拆掉之后整串字面量成了 content，
      用户在左栏看见一行代码。两种都不对。
    """
    rows = coerce_updates(真机序列化的一发)
    assert [r["id"] for r in rows] == ["spec", "pages", "structure"], rows
    assert rows[0]["content"] == "起草并确认门店排班与考勤系统 SPEC", rows[0]
    assert rows[0]["status"] == TodoStatus.IN_PROGRESS.value, rows[0]
    # 反向：不许把整串字面量留在内容里。
    assert all("{" not in r["content"] for r in rows), rows


def test_普通字符串还是整串当内容():
    """反向那半：别为了认对象字面量，把「登记书目」这种也当成解析失败丢掉。"""
    rows = coerce_updates(["登记书目", "扫码借出"])
    assert [r["content"] for r in rows] == ["登记书目", "扫码借出"], rows


def test_解析不了的花括号不许被丢掉():
    """看着像对象、其实解析不了——退回「整串当内容」，**不许**变成静默丢弃。
    丢弃是这个模块被逮到两次的那个形状。"""
    rows = coerce_updates(["{这不是对象}"])
    assert len(rows) == 1 and rows[0]["content"] == "{这不是对象}", rows


def test_活路径上序列化的一发要变成人看得懂的清单(harness):
    """把真机那一发喂进**分发**，不是喂进 `coerce_updates`。

    上一轮 22 条判据全绿而真机是红的，就是因为它们只调纯函数
    （本仓 §一）。这一条钉的是：同一份载荷走完控制面，左栏那句话里
    是「起草并确认…」，不是一行代码。
    """
    sid = new_sid("todo-serialized")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool("todo_write", {"todos": 真机序列化的一发})
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))

    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    line = todo_ev[-1]["line"]
    assert "起草并确认" in line, line
    assert "{" not in line and "status" not in line, line
    assert len(todo_ev[-1]["todos"]) == 3, todo_ev[-1]


# ── 五、host 不许猜进度（2026-09-19 写死流程撤回） ──────────────────


SETUP = [
    {"id": "t1", "content": "初始化任务管理系统工程与依赖", "status": "in_progress"},
    {"id": "t2", "content": "设计任务数据模型与持久化", "status": "pending"},
    {"id": "t3", "content": "实现 Todos 页与 CreateModal", "status": "pending"},
]


def test_反向_写文件不许冒充_todo_write():
    """控制面自己挑何时改清单。host 按 path 推进 = 写死流程。

    ⚠ 2026-09-19 装过 `_emit_todo_progress`：file_write 成功就发
    control_todo。变异：把那条接回去，这条必须红。
    """
    import asyncio
    from services import rehearsal_control as rc

    sid = new_sid("todo-host-must-not-guess")
    state = seed_session(
        sid,
        goal={"text": "做一个待办清单", "status": "clear"},
        controlTodo=SETUP,
    )

    class FakeTools:
        owner_id = "test-user"

        def execute(self, name, args, session):
            return {
                "ok": True,
                "path": "src/components/CreateModal.tsx",
                "revision": "r2",
            }

    token = rc._PROJECT_TOOLS.set(FakeTools())
    try:
        events = asyncio.run(
            _collect_dispatch(
                rc,
                "file_write",
                {"file": "src/components/CreateModal.tsx", "content": "x\n"},
                state,
            )
        )
    finally:
        rc._PROJECT_TOOLS.reset(token)

    assert not [e for e in events if e.get("type") == "control_todo"], [
        e.get("type") for e in events
    ]
    persisted = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["status"] for r in persisted] == [
        TodoStatus.IN_PROGRESS.value,
        TodoStatus.PENDING.value,
        TodoStatus.PENDING.value,
    ]


async def _collect_dispatch(rc, name, args, state):
    return [
        event
        async for event in rc._dispatch_tool(
            name,
            args,
            state,
            "继续做",
            [],
            [],
            "desktop",
            None,
            "做一个待办清单",
        )
    ]


def test_反向_分发处不许再接host推进():
    from control_turn_support import strip_python

    src = strip_python(ROOT / "slide-rule-python" / "services" / "rehearsal_control.py")
    plan = strip_python(ROOT / "slide-rule-python" / "services" / "plan_todo.py")
    project = src[src.find("if name in PROJECT_TOOL_NAMES") :]
    assert "_emit_todo_progress" not in project
    assert "advance_todo_status" not in src
    assert "def advance_status" not in plan
    assert "hint_paths" not in plan
