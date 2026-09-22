# -*- coding: utf-8 -*-
"""只读子代理必须接在活路上（2026-09-04 阶段 3）。

正  两个只读子代理并行，结果都进账本且能被下一跳规划读到
反  写侧（pages/bind/runtimeClosure）不许派出去
反  子代理失败不改变主链路 picks / 待办
"""

from __future__ import annotations

import ast
import inspect
import threading
import time
from pathlib import Path

from models.v5_state import V5SessionState
from services.subagent_tasks import (
    WRITE_BLOCKED,
    clip_task_requests,
    digest_lines,
    get_task_output,
    kill_task,
    spawn_readonly_task,
)
from services.v5_full_driver import _is_commit_order_sensitive_cap, _run_readonly_subagents

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="sr-sub-1",
        goal={"text": "做一个社区宠物寄养平台", "tools": ["pages"]},
        specFirstPages={"pages": {"p1": "<html></html>"}, "boundPages": 0},
    )


class Test写侧不许派:
    def test_pages不能spawn(self):
        assert spawn_readonly_task(_state(), "pages", "画首页") is None

    def test_clip丢掉写侧和生词(self):
        got = clip_task_requests(
            [
                {"type": "pages", "prompt": "写页面"},
                {"type": "evidence", "prompt": "取证"},
                {"type": "invented", "prompt": "x"},
                {"type": "bind", "prompt": "打孔"},
            ]
        )
        assert [t["type"] for t in got] == ["evidence"]

    def test_工厂hop仍是提交屏障(self):
        """反：写侧仍串行。这条要一直钉着。"""
        for hop in ("factory.pages", "factory.bind", "appbundle.runtimeclosure"):
            assert _is_commit_order_sensitive_cap(hop), hop
        assert "pages" in WRITE_BLOCKED
        assert "factory.pages" in WRITE_BLOCKED


class Test两个只读并行进账本:
    def test_evidence和page_quality都落账且可被规划读到(self, monkeypatch):
        state = _state()
        overlap = {"max": 0, "now": 0}
        lock = threading.Lock()

        def fake_exec(cap, st, inputs, role, turn_id):
            with lock:
                overlap["now"] += 1
                overlap["max"] = max(overlap["max"], overlap["now"])
            time.sleep(0.08)
            with lock:
                overlap["now"] -= 1
            return {"content": f"evidence-for-{cap}", "summary": "ok"}

        monkeypatch.setattr(
            "services.v5_full_driver.execute_v5_capability", fake_exec
        )
        _run_readonly_subagents(
            state,
            (
                {"type": "evidence", "prompt": "取证"},
                {"type": "compliance", "prompt": "合规"},
            ),
            loop=0,
        )
        kinds = {t.get("type") for t in (state.subagentTasks or [])}
        assert kinds == {"evidence", "compliance"}
        assert all(t.get("status") == "ok" for t in state.subagentTasks)
        lines = digest_lines(state)
        assert any("evidence" in x for x in lines)
        assert any("compliance" in x for x in lines)
        assert overlap["max"] >= 2, f"没有并行：max_active={overlap['max']}"

    def test_失败不改主链路goal(self, monkeypatch):
        state = _state()
        state.goal = {"text": "t", "tools": ["pages"]}
        monkeypatch.setattr(
            "services.v5_full_driver.execute_v5_capability",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        _run_readonly_subagents(
            state, ({"type": "evidence", "prompt": "x"},), loop=0
        )
        assert (state.goal or {}).get("tools") == ["pages"]
        rec = (state.subagentTasks or [None])[0]
        assert rec and rec.get("status") == "error"
        assert rec.get("error")


class Test四件套:
    def test_get和kill(self):
        state = _state()
        rec = spawn_readonly_task(state, "evidence", "取证")
        assert rec
        assert get_task_output(state, rec["id"])["status"] == "running"
        assert kill_task(state, rec["id"]) is True
        assert get_task_output(state, rec["id"])["status"] == "cancelled"
        assert kill_task(state, rec["id"]) is False


class Test接在真跑的那条路上:
    def test_流式驱动在选材后派子代理(self):
        src = _DRV.read_text(encoding="utf-8")
        stream = src.split("async def drive_full_v5_session_stream")[1].split(
            "\nasync def "
        )[0]
        assert "_run_readonly_subagents(" in stream
        assert "clip_task_requests" in stream
        assert "[subagent-task]" in src

    def test_同步驱动也派(self):
        """§4：只改流式等于只改一半。"""
        src = inspect.getsource(
            __import__("services.v5_full_driver", fromlist=["drive_full_v5_session"]).drive_full_v5_session
        )
        assert "_run_readonly_subagents(" in src

    def test_选材器收tasks(self):
        from services.v5_agentic_pick import agentic_pick_next_capabilities

        src = inspect.getsource(agentic_pick_next_capabilities)
        assert "clip_task_requests" in src
        assert '"tasks"' in src

    def test_下一跳digest读子代理(self):
        from services.v5_agentic_pick import _state_digest

        src = inspect.getsource(_state_digest)
        assert "subagent_digest_lines" in src or "digest_lines" in src
        tree = ast.parse(src)
        assert any(
            isinstance(n, ast.Call) and "digest" in ast.unparse(n)
            for n in ast.walk(tree)
        )
