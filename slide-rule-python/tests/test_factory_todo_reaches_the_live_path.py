# -*- coding: utf-8 -*-
"""工厂待办必须接在活路上（2026-09-04 阶段 1）。

阶段 0 把「首轮必须做完」焊成 clip 不许摘。真机 sr-20260904041125 第 2 跳
模型选 pages、理由写着跳过绑定——护栏把 structure/bind 强行并回这一跳，
首轮链上模型零自由。

阶段 1：可以延后，不许丢失。判据盯四件事（正反成对）：

  正  模型延后 bind → 待办里有 bind（厂内合法集仍是 stamp）
  正  首轮链身份不因减菜丢失（挂在待办上，不靠这一跳 tools 长度）
  反  待办非空时闭环不发合格证
  反  用户在范围卡上取消掉的工具不许被待办塞回来

⚠ 活路径是流式驱动 profile=app。只测 helper 会假绿。
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from pathlib import Path

from models.v5_state import V5SessionState
from services.capability_plan import (
    deferred_factory_tools,
    factory_todo_blockers,
    factory_todo_open,
    first_pass_still_open,
    merge_factory_todo,
)
from services.v5_full_driver import (
    _factory_tools_from_state,
    _first_pass_chain,
    _record_factory_todo,
)

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"
_EXEC = Path(__file__).resolve().parents[1] / "services" / "v5_capability_executor.py"
_ROUTES = Path(__file__).resolve().parents[1] / "routes" / "sliderule_full.py"

#: 真机 sr-20260904041125 第 2 跳的原样载荷。
_REAL_LEGAL = ("pages", "structure", "bind")
_REAL_CHOSEN = ("pages",)


def _state_after_defer(*, todo, tools=_REAL_CHOSEN, legal=None):
    return V5SessionState(
        sessionId="sr-todo-1",
        goal={"text": "做一个社区宠物寄养平台", "tools": list(tools)},
        factoryTodo=list(todo),
        specFirstPages={
            "spec": {"appName": "寄养", "pages": [{"id": "p1"}]},
            "pages": {"p1": "<html></html>"},
        },
    )


class Test延后进账下一跳能看见:
    def test_模型延后bind则待办里有bind(self):
        todo = deferred_factory_tools(
            _REAL_CHOSEN, floor=_REAL_LEGAL, legal=_REAL_LEGAL
        )
        assert todo == ("structure", "bind"), todo

    def test_厂内合法集是stamp待办留给host(self):
        """第 4 格：stamp 成 pages 之后，这一跳合法集不许并 bind。

        bind 还在待办上，闭环 fail-closed，host 下一跳能看见。
        """
        state = _state_after_defer(todo=["structure", "bind"])
        legal = _factory_tools_from_state(state)
        assert legal == ("pages",), legal
        assert "bind" in factory_todo_open(state.factoryTodo)
        assert "structure" in factory_todo_open(state.factoryTodo)

    def test_首轮身份在待办上还活着(self):
        state = _state_after_defer(todo=["structure", "bind"])
        assert _first_pass_chain(state)
        assert first_pass_still_open(("pages",), ("structure", "bind"))

    def test_跑掉的从待办划掉(self):
        kept = merge_factory_todo(
            ("structure", "bind"),
            ran=("structure",),
            deferred=(),
            legal=_REAL_LEGAL,
        )
        assert kept == ("bind",), kept


class Test反向:
    def test_范围卡取消的bind不许被待办塞回来(self):
        todo = deferred_factory_tools(
            ("pages",), floor=("pages", "structure"), legal=("pages", "structure")
        )
        assert "bind" not in todo
        merged = merge_factory_todo(
            (), ran=("pages",), deferred=("bind",), legal=("pages", "structure")
        )
        assert "bind" not in merged, f"取消掉的 bind 被塞回来了：{merged}"

    def test_待办非空时闭环不发合格证(self):
        blockers = factory_todo_blockers(("structure", "bind"))
        assert blockers
        assert blockers[0]["code"] == "CLOSURE_FACTORY_TODO_OPEN"
        assert "bind" in blockers[0]["ref"]

    def test_待办空了才不拦(self):
        """⚠ 反向：账清了还拦 = 永远发不出合格证。"""
        assert factory_todo_blockers(()) == ()
        assert factory_todo_blockers(None) == ()

    def test_一跳一件不记待办(self):
        """用户自己点 pages，不是首轮链，floor 为空。"""
        todo = deferred_factory_tools(("pages",), floor=None, legal=_REAL_LEGAL)
        assert todo == ()


class Test接在真跑的那条路上:
    def test_流式驱动写下待办并打日志(self):
        src = _DRV.read_text(encoding="utf-8")
        stream = src.split("async def drive_full_v5_session_stream")[1].split(
            "\nasync def "
        )[0]
        assert "_record_factory_todo(" in stream, (
            "helper 写了但流式驱动没调用，待办不会进会话"
        )
        assert "[factory-todo]" in stream
        assert "deferred_factory_tools" in stream
        body = src.split("def _record_factory_todo")[1].split("\ndef ")[0]
        assert "state.factoryTodo" in body

    def test_厂内合法集函数不再并待办(self):
        """变异：再把 factory_todo_open 并进 chosen → 红。"""
        src = inspect.getsource(_factory_tools_from_state)
        assert "factory_todo_open" not in src

    def test_首轮谓词读待办(self):
        src = inspect.getsource(_first_pass_chain)
        assert "first_pass_still_open" in src
        assert "factoryTodo" in src

    def test_闭环执行器读待办(self):
        """变异：只写 helper 不接线 → 待办非空照样 closed。"""
        src = _EXEC.read_text(encoding="utf-8")
        # 剥注释，避免 docstring 里的名字把判据打空。
        tree = ast.parse(src)
        texts = [
            ast.unparse(n)
            for n in ast.walk(tree)
            if isinstance(n, (ast.Call, ast.Assign, ast.AugAssign, ast.Return))
        ]
        joined = "\n".join(texts)
        assert "factory_todo_blockers" in joined
        assert "todo_blockers" in src

    def test_PUT把factoryTodo当成服务端台账(self):
        from routes import sliderule_full as routes

        put_src = inspect.getsource(routes.save_sess)
        # 剥注释：名字必须出现在 pop / exclude 里，不能只在头注。
        tree = ast.parse(put_src)
        calls = [
            ast.unparse(n)
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
        ]
        dumps = [
            ast.unparse(n)
            for n in ast.walk(tree)
            if isinstance(n, ast.Call) and "model_dump" in ast.unparse(n)
        ]
        assert any('pop("factoryTodo"' in c or "pop('factoryTodo'" in c for c in calls), (
            "PUT 没 pop factoryTodo，客户端 None 会把待办抹掉"
        )
        assert dumps and "factoryTodo" in dumps[0], (
            "PUT merge 没 exclude factoryTodo"
        )

    def test_流式首轮减菜真的把bind记进待办(self, monkeypatch, tmp_path):
        """变异：调用点删掉 _record_factory_todo，tools 减了、账是空的。"""
        monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
        monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "on")
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        import services.v5_agentic_pick as agentic_mod
        import services.v5_full_driver as driver_mod

        monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
        monkeypatch.setattr(
            driver_mod, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
        )
        monkeypatch.setattr(
            driver_mod,
            "execute_v5_capability",
            lambda *a, **k: {
                "title": "stub",
                "summary": "stub",
                "content": "stub",
                "provenance": "python-rag",
                "sources": [],
            },
        )

        def fake_pick(state, user_text, **kwargs):
            return {
                "picks": [{"capabilityId": "pages", "roleId": "工程"}],
                "rationale": "用户指令明确为继续生成页面，跳过数据结构与权限绑定",
            }

        monkeypatch.setattr(agentic_mod, "agentic_pick_next_capabilities", fake_pick)
        monkeypatch.setattr(agentic_mod, "agentic_pick_enabled", lambda: True)
        state = V5SessionState(
            sessionId="sr-todo-live",
            goal={
                "text": "做一个社区宠物寄养平台",
                "tools": ["spec", "pages", "structure", "bind"],
            },
            specFirstPages={
                "spec": {"appName": "寄养", "pages": [{"id": "p1"}]},
                "pages": {"p1": "<html></html>"},
            },
        )

        async def _run():
            events = []
            async for ev in driver_mod.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction="先只要页面", profile="app"
            ):
                events.append(ev)
            return events

        events = asyncio.run(_run())
        tools = list((state.goal or {}).get("tools") or [])
        todo = factory_todo_open(state.factoryTodo)
        assert tools == ["pages"], f"这一跳没按提案走：{tools}"
        assert "bind" in todo and "structure" in todo, f"延后没进账：{todo}"
        plan = next(e for e in events if e.get("type") == "factory_plan" and e.get("deferred") is not None)
        assert "bind" in (plan.get("deferred") or [])

    def test_persist见None才restore空列表是清账(self):
        src = (
            Path(__file__).resolve().parents[1] / "services" / "persistence.py"
        ).read_text(encoding="utf-8")
        assert 'inc_todo = getattr(merged_logs_state, "factoryTodo", None)' in src
        assert "if inc_todo is None:" in src, (
            "[] 被当成 blank 的话驱动器清账会把 bind 写回去"
        )
