# -*- coding: utf-8 -*-
"""落库几页，就得发出去几个「这页好了」。

## 事故（2026-09-06 真机）

    gemini-3.8 那轮：7 页落库，`spec_page` 事件 **3 个**
    gemini-3.7 那轮：3 页落库，`spec_page` 事件 **0 个**

第二轮画布上是 83 秒纯空白，然后什么都没有。而第 3 步的代码注释写着它存在
的全部理由：

    「一份能独立打开的 HTML 比最终模型早四五分钟。**攒齐再交等于白白转圈。**」

没有任何东西会因此变红：页面在盘上、闭环 6/6、blocked=false。**因为没人数。**

## 抄的是 grok 的哪一处

`xai-grok-sampling-types/src/conversation.rs:851-855` 把"应该发多少事件"做成
**持久化字段**，而不是只在运行时断言一下：

    /// Number of `AgentMessageChunk` (text-only) streaming events emitted
    /// during this response.
    /// When this is zero but the response contains text, the streaming events
    /// were lost (e.g. after an empty-response retry).
    /// The caller should then emit a fallback `AgentMessageChunk` so downstream
    /// consumers (e.g. the TUI) see the turn as complete.
    pub message_chunks_emitted: u64,

配套 `fallback_text()`（:966-979）：**有终态内容但增量事件数为 0 ⇒ 事件丢了
⇒ 补发兜底**。

两件事一起搬：计数随 `specFirstPages` 落库（对账 + 事后审计），驱动器在能力
返回后按同一判据补发。

## ⚠ 判据钉的是"对不对得上"，不是"发了几个"

同一页会到达多次（第 3 步素颜 → 3.5 外壳统一 → 6.5 打孔重发），所以事件数
**大于**页数是正常的。只有"落了页却一个事件都没发"才叫丢了。把它写成
`emitted == pages` 会让每一轮正常运行都报红——比不做更糟。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.spec_first_pipeline import (
    note_page_event_emitted,
    peek_page_events_emitted,
    reset_page_events_emitted,
)

DRIVER = Path(__file__).parent.parent / "services" / "v5_full_driver.py"
EXECUTOR = Path(__file__).parent.parent / "services" / "v5_capability_executor.py"


def _code_of(path: Path, name: str) -> str:
    """按 AST 切出某个函数的代码（去掉 docstring）。

    ⚠ 去 docstring 是必须的：那些头注里逐字引了修复前的写法和 grok 原文，
      不去掉的话"不许出现 X"这类反向判据会被自己的注释咬红。
    """
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src, filename=str(path))
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
            and node.name == name
        ):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body = body[1:]
            lines = src.splitlines(keepends=True)
            first = body[0].lineno
            last = max(n.end_lineno or n.lineno for n in body)
            return "".join(lines[first - 1 : last])
    raise AssertionError(f"{path.name} 里找不到 {name} —— 判据自己打空了")


@pytest.fixture(autouse=True)
def _clean_counter():
    """每条用例从"没装计数器"开始。

    ⚠ 不能用 `reset_page_events_emitted()` 当清场动作 —— 那正好装上了一个
      计数器，于是「没装时报不知道」那条判据永远测不到。
    """
    from services import spec_first_pipeline as sfp

    sfp._page_events_var.set(None)
    yield
    sfp._page_events_var.set(None)


# ── 计数本身 ────────────────────────────────────────────────────────────
class Test事件计数:
    def test_没装计数器时报不知道而不是零(self):
        """⚠ `None`（不知道）与 `0`（知道是零）是两件事。

        折成 0 的话，每条没走流式驱动器的路径都会被判成"事件丢了"，
        而这条判据的全部价值就在于它平时不响。同 `CapabilityRunStatus`
        里 `unknown` 那一档的理由。
        """
        assert peek_page_events_emitted() is None

    def test_每发一个记一笔(self):
        reset_page_events_emitted()
        for _ in range(3):
            note_page_event_emitted()
        assert peek_page_events_emitted() == 3

    def test_只读不清(self):
        """落库那一处要拿它对账，读一次就清零会让对账读到 0 → 每轮都判"丢了"。"""
        reset_page_events_emitted()
        note_page_event_emitted()
        assert peek_page_events_emitted() == 1
        assert peek_page_events_emitted() == 1

    def test_新一轮换一个新计数器(self):
        """⚠ 不换的话上一轮的计数会让这一轮"看起来发过事件"，
        于是补发判定**永远不触发**——那正是本仓反复数到的
        "东西看着在，其实是旧的"。"""
        reset_page_events_emitted()
        note_page_event_emitted()
        reset_page_events_emitted()
        assert peek_page_events_emitted() == 0

    def test_计数出问题不许拖垮出页(self):
        """增强类 fail-open：这条计数是为了让丢事件**看得见**，
        它自己炸了不该把一轮已经画完的页面带走。"""
        reset_page_events_emitted()
        note_page_event_emitted("不是数字")  # type: ignore[arg-type]
        assert peek_page_events_emitted() == 0

    def test_跨Context副本也数得到(self):
        """★ 真机（2026-09-06）当场抓到的那条：明明发出 15 个事件，
        落库里 `specPageEventsEmitted=0`、`specPageEventsLost=true`。

        因为写和读不在同一个 Context：写在驱动器的泵里，读在
        `asyncio.to_thread(...)` 的 **Context 副本**里，而 `ContextVar.set()`
        只改当前 Context 那一格。护栏装对了位置，**它依赖的输入在真机上
        根本不成立**。

        变异：把 `_page_events_var` 改回 `ContextVar[int]` + `set(get()+1)`
        → 本条红。
        """
        import contextvars

        reset_page_events_emitted()          # 在"驱动器"这个 Context 里装
        ctx = contextvars.copy_context()     # to_thread 复制的就是这个
        ctx.run(note_page_event_emitted)     # 在副本里记一笔
        ctx.run(note_page_event_emitted)
        assert peek_page_events_emitted() == 2, (
            "副本里记的笔数在外面读不到 —— 计数器又变成不可变的 int 了"
        )

    def test_副本里读得到外面记的(self):
        """反向：泵在外层记，`_cache_spec_first_pages` 在副本里读。
        真机丢的就是这个方向。"""
        import contextvars

        reset_page_events_emitted()
        note_page_event_emitted(5)
        ctx = contextvars.copy_context()
        assert ctx.run(peek_page_events_emitted) == 5

    def test_没reset时副本里也不许现装(self):
        """在 Context 副本里 `set()` 的东西外面读不到，现装等于自欺。"""
        import contextvars

        _page_events_var_reset_to_none()
        ctx = contextvars.copy_context()
        ctx.run(note_page_event_emitted)
        assert peek_page_events_emitted() is None


def _page_events_var_reset_to_none() -> None:
    from services import spec_first_pipeline as sfp

    sfp._page_events_var.set(None)


# ── 落库对账 ────────────────────────────────────────────────────────────
class Test落库时对账:
    def test_落库带上发了几个和对不对得上(self):
        code = _code_of(EXECUTOR, "_cache_spec_first_pages")
        assert '"specPageEventsEmitted": _emitted' in code, "事件数没落库"
        assert '"specPageEventsLost"' in code, "没记「对不对得上」"

    def test_不知道的时候不许说成丢了(self):
        """`peek` 返回 `None` 时，`specPageEventsLost` 必须是 `None` 而不是 True。

        真机那一轮就是这里出的假阳性：计数器读不到 → 报 `lost=true`，
        而实际发了 15 个事件。变异：把 `None if _emitted is None else ...`
        改回无条件 `bool(...)` → 本条红。
        """
        code = _code_of(EXECUTOR, "_cache_spec_first_pages")
        assert "None if _emitted is None else bool(_page_n > 0 and _emitted == 0)" in code, (
            "「不知道」被折成了「丢了」"
        )

    def test_判据是落了页却零事件而不是数字相等(self):
        """同一页会到达多次（素颜 → 外壳统一 → 打孔），事件数大于页数是正常的。

        变异：改成 `_emitted == _page_n` → 每一轮正常运行都判"丢了"，
        本条红。
        """
        code = _code_of(EXECUTOR, "_cache_spec_first_pages")
        assert "bool(_page_n > 0 and _emitted == 0)" in code, (
            "对账判据不是「落了页却零事件」"
        )
        assert "_emitted == _page_n" not in code, (
            "又写成数字相等了 —— 同一页会到达多次，这会让每轮都报红"
        )

    def test_零页不算丢(self):
        """一页都没落库的时候，零事件是**正确**的，不是丢了。"""
        for page_n, emitted, lost in (
            (0, 0, False),
            (3, 0, True),
            (3, 3, False),
            (7, 3, False),  # 真机那轮：厚的一发，事件少但不是零
        ):
            assert bool(page_n > 0 and emitted == 0) is lost, (
                f"落库 {page_n} 页 / 发出 {emitted} 个，对账结论应为 lost={lost}"
            )


# ── 兜底补发 ────────────────────────────────────────────────────────────
class Test兜底补发:
    def test_补发的判据跟落库对账同一条(self):
        """两处书写同一个事实。漂了的结果是"落库说丢了、补发不动手"。"""
        code = _code_of(DRIVER, "_fallback_page_events")
        assert "_emitted = _peek_page_events()" in code, "补发不看事件数"

    def test_take之后从落库补发(self):
        """execute 里 take_last_pages 已取空。grok fallback_text 读终态。

        变异：只 peek 暂存 → 本条红，画布补发永远跳过。
        """
        code = _code_of(DRIVER, "_fallback_page_events")
        assert "specFirstPages" in code, "take 之后必须读落库页面"

    def test_不知道的时候不许补发(self):
        """★ 真机差点在这里翻车：计数器读不到（恒 0）时，补发会把**已经发过的
        页再发一遍**，前端每页闪两次。那一轮没重发纯属 `peek_last_pages()`
        已被取空。

        变异：把 `_emitted is None or _emitted > 0` 改回 `_emitted > 0`
        → 本条红。
        """
        code = _code_of(DRIVER, "_fallback_page_events")
        assert "if _emitted is None:" in code, (
            "「不知道」时还会去补发 —— 会重发已经发过的页"
        )

    def test_补发时把计数补上(self):
        """不补的话同一轮里第二次走到这儿会再补一遍，页面在前端闪两次。"""
        code = _code_of(DRIVER, "_fallback_page_events")
        assert "_note_page_event()" in code

    def test_补发的页面标成已打孔(self):
        """⚠ 补发发生在整链跑完之后，此时页面已经打过孔。说 `False` 会让前端
        把成品当素颜页，再等一次永远不会来的覆盖。"""
        code = _code_of(DRIVER, "_fallback_page_events")
        assert '"bound": _bound' in code
        assert 'binding_status.get(_pid) == "bound"' in code
        assert '"bound": False' not in code

    def test_补发的事件带着标记(self):
        """下游要能分出"这是补发的"——排查时最想知道的第一件事。"""
        code = _code_of(DRIVER, "_fallback_page_events")
        assert '"fallback": True' in code

    def test_模块缺失或读不到就安静跳过(self):
        """本仓第七条：增强类 fail-open。补发自己不许炸主链路。"""
        code = _code_of(DRIVER, "_fallback_page_events")
        assert "_peek_page_events is None" in code
        assert "except Exception" in code

    def test_新一轮开始先清零(self):
        """驱动器起流时必须 reset。不清零 → 上一轮的计数让这一轮看起来发过
        事件 → 补发判定永远不触发。"""
        src = DRIVER.read_text(encoding="utf-8")
        assert "if _reset_page_events is not None:\n        _reset_page_events()" in src, (
            "起流时没清零事件计数"
        )

    def test_两个调用点都接了补发(self):
        """⚠ 串行 / 并行两条执行路。只改一条不报错、只有一半不生效——
        本仓第四条那个形状。"""
        tree = ast.parse(DRIVER.read_text(encoding="utf-8"))
        stream = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "drive_full_v5_session_stream")
        sources = []
        for parent in ast.walk(stream):
            body = getattr(parent, "body", None)
            if not isinstance(body, list):
                continue
            for index, node in enumerate(body):
                if not (isinstance(node, ast.AsyncFor) and isinstance(node.iter, ast.Call) and isinstance(node.iter.func, ast.Name) and node.iter.func.id == "_fallback_page_events"):
                    continue
                assert index > 0
                previous = body[index - 1]
                assert isinstance(previous, ast.Assign)
                result = previous.value
                assert isinstance(result, ast.Call) and isinstance(result.func, ast.Attribute)
                assert result.func.attr == "result" and isinstance(result.func.value, ast.Name)
                sources.append(result.func.value.id)
                assert isinstance(node.target, ast.Name)
                assert any(
                    isinstance(child, ast.Yield) and isinstance(child.value, ast.Name) and child.value.id == node.target.id
                    for child in ast.walk(node)
                ), "Reading fallback events without yielding them still leaves the canvas blank"
        assert sorted(sources) == ["batch_task", "exec_task"], (
            "Serial and parallel capability results must each trigger page fallback"
        )

    def test_计数函数挂在已有的import上而不是新开一条(self):
        """`baseline.deferred = 483` 是个棘轮（函数体内 import 只许变少）。
        新开一条 import 语句会把它顶上去，架构闸变红。"""
        src = DRIVER.read_text(encoding="utf-8")
        block = src[src.index("from .spec_first_pipeline import (  # noqa: F401") :][:600]
        for name in (
            "note_page_event_emitted",
            "peek_page_events_emitted",
            "reset_page_events_emitted",
        ):
            assert name in block, f"{name} 没挂在已有的那条 try-import 上"
