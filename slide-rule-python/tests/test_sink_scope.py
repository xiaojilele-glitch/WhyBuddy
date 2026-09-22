"""装了必须卸：sink 的安装自带清除，且卸的时候还原成**原来那个**。

抄的标准答案：grok-build `xai-grok-pager/src/memory_trace.rs`

    /// Install a scoped sink … Returns a guard restoring the previous sink on drop.
    pub(crate) struct SinkGuard(Option<std::sync::Arc<Sink>>);
    impl Drop for SinkGuard {
        fn drop(&mut self) { *guard = self.0.take(); }   // 还原成原来那个
    }
    pub(crate) fn install_test_sink(...) -> SinkGuard {
        let prev = guard.take();                          // 先把原来的收好
        *guard = Some(Sink::new(...));
        SinkGuard(prev)
    }

治的两件事（都不是并发串台——那件事 2026-08-06 换 ContextVar 时就解决了）：
  ① 装和卸离得太远。上一版是「v5_full_driver 第 1972 行装、第 2610 行卸」，
     中间六百行。谁加第六根 sink 都得记得跑到六百行外补一行。
  ② 卸成 None 而不是还原。嵌套时会把外层那根一起抹掉。
"""
from __future__ import annotations

import ast
import os
import re
import sys
from contextvars import ContextVar
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.scoped import sink_scope  # noqa: E402

_SERVICES = Path(__file__).resolve().parents[1] / "services"

#: 本轮驱动器要装的管子，以及各自的作用域函数。
_SCOPES = [
    ("sliderule_llm.capabilities", "capability_delta_sink_scope", "_delta_sink_var"),
    ("services.v5_llm_generate", "generate_delta_sink_scope", "_delta_sink_var"),
    ("services.enrich_timing", "stage_sink_scope", "_stage_sink_var"),
    ("services.spec_first_pipeline", "page_sink_scope", "_page_sink_var"),
    ("services.spec_first_pipeline", "quality_sink_scope", "_quality_sink_var"),
    ("services.spec_first_pipeline", "rename_sink_scope", "_rename_sink_var"),
]


# ── 作用域本身 ────────────────────────────────────────────────────


def test_出块还原成进块前的值():
    var: ContextVar = ContextVar("t-restore", default=None)
    with sink_scope(var, "A"):
        assert var.get() == "A"
    assert var.get() is None


def test_嵌套时还原成外层那根_不是置空():
    """要害。上一版统一 `set(None)`，内层收工会把外层那根一起抹掉。

    变异：把 scoped.py 的 `var.set(prev)` 改成 `var.set(None)` → 本条红。
    """
    var: ContextVar = ContextVar("t-nest", default=None)
    with sink_scope(var, "外层"):
        with sink_scope(var, "内层"):
            assert var.get() == "内层"
        assert var.get() == "外层", "内层收工把外层那根抹掉了"
    assert var.get() is None


def test_抛异常也要还原():
    var: ContextVar = ContextVar("t-raise", default=None)
    with pytest.raises(RuntimeError):
        with sink_scope(var, "A"):
            raise RuntimeError("炸了")
    assert var.get() is None


def test_存的是值不是Token():
    """⚠ 必须存**值**再 set 回去，不许用 ContextVar.reset(token)。

    reset 要求 token 在同一个 Context 里被 reset，而这些 sink 装在一个横跨
    几百次 yield 的异步生成器里——生成器被谁在哪个 Context 恢复不由我们说了
    算，用 token 会换来 `ValueError: <Token> was created in a different
    Context`。grok 的 SinkGuard 存的也是 prev 值，不是句柄。

    变异：把 scoped.py 改成 token/reset 写法 → 本条红。
    """
    src = (
        Path(__file__).resolve().parents[1] / "sliderule_llm" / "scoped.py"
    ).read_text(encoding="utf-8")
    body = re.sub(r'"""[\s\S]*?"""', "", src)
    body = re.sub(r"#[^\n]*", "", body)
    assert "prev = var.get()" in body and "var.set(prev)" in body
    assert ".reset(" not in body, "用了 token/reset——异步生成器里会 ValueError"


# ── 每根管子都有作用域版 ──────────────────────────────────────────


@pytest.mark.parametrize("mod,fn,var", _SCOPES)
def test_每根管子都有作用域版_而且真的还原(mod: str, fn: str, var: str):
    import importlib

    module = importlib.import_module(mod)
    scope = getattr(module, fn)
    holder: ContextVar = getattr(module, var)

    def sink(*_a, **_kw):
        return None

    before = holder.get()
    with scope(sink):
        assert holder.get() is sink, f"{mod}.{fn} 没把 sink 装上"
    assert holder.get() is before, f"{mod}.{fn} 没还原"


# ── 通电：驱动器真的走作用域，而且 finally 里不再逐根卸 ──────────


def _driver_src() -> str:
    """剥掉注释和文档字符串——本文件的注释里大段引用了老写法，
    不剥的话下面 grep 到的是注释，变异后照样绿（CLAUDE.md §2）。"""
    text = (_SERVICES / "v5_full_driver.py").read_text(encoding="utf-8")
    text = re.sub(r'"""[\s\S]*?"""', "", text)
    text = re.sub(r"#[^\n]*", "", text)
    return text


def test_驱动器把每根管子都交给了栈():
    """变异：任一根改回裸 setter → 本条红。"""
    src = _driver_src()
    assert "_sinks = _contextlib.ExitStack()" in src, "没有 sink 栈"
    for _mod, fn, _var in _SCOPES:
        assert fn in src, f"驱动器没用 {fn}，还在自己装自己卸"


def test_驱动器里不许再有裸的_set_sink():
    """反向判据。

    没有这一条，"既 enter_context 又留着老的 set(None)"也全绿——那是最糟的
    中间态：看着改了，实际两套并存，谁也说不清哪套在起作用。
    """
    src = _driver_src()
    stray = [
        name
        for name in (
            "set_capability_delta_sink",
            "set_generate_delta_sink",
            "set_stage_sink",
            "set_page_sink",
        )
        if name in src
    ]
    assert not stray, f"驱动器里还留着裸 setter：{stray}"


def test_收尾处只关一次栈_不再逐根点名():
    """加第六根 sink 时不需要回来改收尾块——这正是抄 SinkGuard 图的东西。

    变异：把 `_sinks.close()` 删掉 → 本条红。
    """
    src = _driver_src()
    assert src.count("_sinks.close()") == 1


def test_装载点和卸载点不再隔着几百行():
    """量的是**距离**，不是"有没有写"。

    上一版装在 1972、卸在 2610，隔 638 行。现在每根 sink 的卸载动作就在
    enter_context 那一行上，收尾只剩一句 close。

    ⚠ 判据盯的是"最后一次 enter_context 到 close 之间的行数"这个可量的东西，
      而不是某个字面量——挪几行不该让它红，退回逐根点名才该红。
    """
    lines = (_SERVICES / "v5_full_driver.py").read_text(encoding="utf-8").splitlines()
    enters = [i for i, ln in enumerate(lines) if "_sinks.enter_context(" in ln]
    closes = [i for i, ln in enumerate(lines) if "_sinks.close()" in ln]
    assert enters and closes, "栈没接上"
    assert max(enters) - min(enters) < 160, "装载点被拆散到几百行外去了"


def test_scoped模块没有别的依赖():
    """这个工具要能被 services 和 sliderule_llm 两边用，不许反向依赖 services。"""
    tree = ast.parse(
        (Path(__file__).resolve().parents[1] / "sliderule_llm" / "scoped.py").read_text(
            encoding="utf-8"
        )
    )
    mods = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not any(m.startswith("services") for m in mods), "反向依赖 services 了"
