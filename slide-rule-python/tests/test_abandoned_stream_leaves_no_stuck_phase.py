# -*- coding: utf-8 -*-
"""流被放弃时相位不许僵在 orchestrating（2026-09-04 真机）。

## 事故

两个真机会话，浏览器全关、`GET /runs/active` 返回 `{"active": null}`，而：

    页=5 版本=1  停泊=max_loops  相=orchestrating
    页=4 版本=1  停泊=max_loops  相=orchestrating

三个字段互相矛盾：停泊说在等人，相位说还在跑，跑批说没有东西在跑。

## 机制

`drive_full_v5_session_stream` 是**异步生成器**：

    :2209  state.runtimePhase = "orchestrating"
    :2222  await persist_state(state)          ← orchestrating 落库
    …
    :2881  state.runtimePhase = "awaiting"     ← 终端块，在 try 里面
    :2896  except Exception:  → "failed"
    :2904  finally: _sinks.close()             ← 只清 sink，不碰相位

客户端断开 / 切走 / 关标签页 → 生成器被关闭 → 抛 `GeneratorExit`
（任务被取消则是 `CancelledError`）。**这两个都是 BaseException**，
`except Exception` 一个都接不住 → 终端块整段跳过 → 库里留着 :2222 那笔。

## 看得见的后果

`SidebarSessions` 的列表 phase 就是 runtimePhase（见那边 :330 注释），
于是这个会话在侧栏**永远显示「推演中」**，按状态筛选时堆着一批早就结束的。

## 纠正一条我先前的误判

昨晚我把「相位僵死」和「此后精修不再派发」写成了因果。查完代码不成立：
控制面只写不读 runtimePhase（rehearsal_control 里唯一的读在 :1673，
只做 awaiting→idle），前端的 `isRunning` 是本地 ref 也不读它。
那几轮不派发是同一条指令连发三次、控制面自己判断无事可做——**相关，不是因果**。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"


def _stream_fn() -> ast.AsyncFunctionDef:
    tree = ast.parse(_DRV.read_text(encoding="utf-8"))
    return next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "drive_full_v5_session_stream"
    )


def _outer_try() -> ast.Try:
    """驱动器主体那个 try（带 finally 清 sink 的那个）。"""
    fn = _stream_fn()
    tries = [
        n for n in ast.walk(fn)
        if isinstance(n, ast.Try) and n.finalbody
        and any("_sinks.close()" in ast.unparse(s) for s in n.finalbody)
    ]
    assert tries, "找不到那个带 _sinks.close() 的主 try"
    return tries[0]


def _handled_names(t: ast.Try) -> set[str]:
    names: set[str] = set()
    for h in t.handlers:
        if h.type is None:
            names.add("*bare*")
            continue
        for node in ast.walk(h.type):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
    return names


class Test接住流被放弃:
    def test_接住GeneratorExit和CancelledError(self):
        """这条红 = 关页面后会话在侧栏永远显示「推演中」。"""
        names = _handled_names(_outer_try())
        assert "GeneratorExit" in names, "没接 GeneratorExit：关标签页就僵住"
        assert "CancelledError" in names, "没接 CancelledError：任务取消就僵住"

    def test_接住之后把相位落回去(self):
        """只接不改等于没接——必须把 orchestrating 改掉并落库。"""
        t = _outer_try()
        h = next(
            h for h in t.handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        src = ast.unparse(h)
        assert 'runtimePhase = "awaiting"' in src or "runtimePhase = 'awaiting'" in src, (
            "接住了却没改相位"
        )
        assert "_persist_phase_after_abandon" in src, (
            "改了不落库，下次读还是 orchestrating"
        )
        assert "Thread(" in src, (
            "落库必须丢给线程：关闭中不能 await，裸调又会阻塞事件循环"
            "（test_no_blocking_io_on_event_loop）"
        )

    def test_只在僵住时才动(self):
        """⚠ 反向：正常收尾已经把相位设成 awaiting/done，兜底不许覆盖它。"""
        t = _outer_try()
        h = next(
            h for h in t.handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        src = ast.unparse(h)
        assert '== "orchestrating"' in src or "== 'orchestrating'" in src, (
            "没有条件就无脑改相位，会把 done 覆盖成 awaiting"
        )

    def test_原样抛回去(self):
        """GeneratorExit 吞掉会让运行时报 'async generator ignored GeneratorExit'。"""
        t = _outer_try()
        h = next(
            h for h in t.handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        assert any(isinstance(s, ast.Raise) for s in ast.walk(h)), "必须 raise 回去"


class Test关闭路径上的两条硬约束:
    """生成器正在关闭时，await 和 yield 都是非法的。"""

    def _handler_src(self) -> str:
        t = _outer_try()
        h = next(
            h for h in t.handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        return ast.unparse(h)

    def test_不许await(self):
        """`await asyncio.to_thread(persist_state, …)` 在关闭中会 RuntimeError。"""
        h = next(
            h for h in _outer_try().handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        assert not any(isinstance(n, ast.Await) for n in ast.walk(h)), (
            "关闭路径上不许 await —— 用同步 persist_state"
        )

    def test_不许yield(self):
        h = next(
            h for h in _outer_try().handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        assert not any(isinstance(n, (ast.Yield, ast.YieldFrom)) for n in ast.walk(h)), (
            "流已经没人收了，yield 只会再抛一次"
        )

    def test_兜底自己不许抛(self):
        """落库失败（网关抖）不该把 GeneratorExit 换成别的异常。

        落库挪进了 `_persist_phase_after_abandon`（为了能在线程里跑），
        try/except 跟着挪过去了——判据也跟到那儿。
        """
        src = _DRV.read_text(encoding="utf-8")
        body = src.split("def _persist_phase_after_abandon")[1].split("\n\ndef ")[0]
        assert "persist_state(state)" in body
        assert "try:" in body and "except" in body, (
            "兜底落库没被 try 包住，网关一抖线程里就抛栈"
        )

    def test_落库不占事件循环(self):
        """⚠ 反向：不许为了省事又裸调回去。

        persist 走远端 HTTPS SQL 网关，裸调会卡住整个事件循环
        （test_no_blocking_io_on_event_loop：一处卡住，全站请求一起排队）。
        """
        h = next(
            h for h in _outer_try().handlers
            if h.type is not None and "GeneratorExit" in ast.unparse(h.type)
        )
        src = ast.unparse(h)
        assert "persist_state(" not in src, "又裸调回事件循环上了"
        assert "Thread(" in src and "daemon=True" in src


class Test别的异常路径没被改坏:
    def test_普通异常仍然判failed(self):
        t = _outer_try()
        h = next(
            h for h in t.handlers
            if h.type is not None and ast.unparse(h.type).strip() == "Exception"
        )
        src = ast.unparse(h)
        assert 'runtimePhase = "failed"' in src or "runtimePhase = 'failed'" in src

    def test_finally仍然清sink(self):
        t = _outer_try()
        src = "\n".join(ast.unparse(s) for s in t.finalbody)
        assert "_sinks.close()" in src
        assert "reset_run_budget" in src
