# -*- coding: utf-8 -*-
"""交回 host 的那段话是**情报**，不是命令（2026-09-04）。

## 事故

用户看完架构：「还是死流程，不是很智能呢」。查下来外层 ReAct 是真的，
但工厂交回时塞给模型的是一句祈使句：

    本跳实际跑了：起草 SPEC。页面还没有。
    下一跳**必须**调 pages，或者用一句话告诉用户你为什么先停。
    不要调 rehearse，不要假装页面已经出来，不要问结构绑定。

那不是模型在决定下一步，是流程在下命令、模型负责复述。而且它是以
`{"role": "user"}` 塞进去的——**伪造了一条用户消息**，模型看见的是
「用户命令我调 pages」，用户根本没说过；下一轮真用户开口时两条 user 还会打架。

## 抄的标准答案

grok `xai-grok-tools/src/reminders/mod.rs`：

    //! Provides contextual hints wrapped in `<system-reminder>` tags that are
    //! appended to tool outputs before being sent to the model.

`xai-tool-runtime/src/render.rs:205`：

    // grok-build `ToolRunResult`: the model sees `prompt_text` (reminders
    // appended), never a JSON dump of the structured result.

措辞看 `reminders/task_completion.rs`：陈述事实与可选项
（"Background task X completed (exit code N)"、"Use get_task_output for full
content"），禁令只在跟一条事实绑定时出现（"killed by the user — do not restart it"）。

## 判据盯语义不盯字面

CLAUDE.md §2 那条前科：判据写 `"Produce the complete" not in tail`，而真实
收尾是 `"Produce the five-system JSON now."`，断言直接打空。所以这里盯的是
**「有没有可核对的数」「有没有祈使句」**，不是某一句话的原文。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from services.rehearsal_control import (
    _after_write_hint,
    _messages_after_forced_write,
    append_reminder,
    wrap_reminder,
)

_RC = Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"

#: 命令式的痕迹。出现任意一条就说明又滑回祈使句了。
_ORDERS = ("必须调", "不要调", "不许调", "不要假装", "不要问")


def _spec_only_state(**sfp) -> V5SessionState:
    # ⚠ spec 里要有真内容：`_has_spec` 认的是 pages/nodes/appName 三者之一，
    #   写 `{"pages": []}` 会被判成「没有 SPEC」（第一版判据就栽在这）。
    base = {
        "pages": {},
        "capabilityPlan": {"tools": ["spec"]},
        "spec": {"appName": "图书馆", "pages": [{"id": "p1"}]},
    }
    base.update(sfp)
    return V5SessionState(
        sessionId="t-hint",
        goal={"text": "图书馆", "status": "clear", "tools": ["spec"]},
        specFirstPages=base,
    )


class Test情报而不是命令:
    def test_报的是可核对的数(self):
        """⚠「页面 0 份」比「不要假装页面已经出来」更硬：前者能核对。"""
        hint = _after_write_hint(_spec_only_state())
        assert "页面 0 份" in hint, f"没报页面数：{hint}"
        assert "SPEC 有" in hint

    def test_页数是真数出来的_不是写死的(self):
        """⚠ 反向：变异成常量就红。"""
        state = _spec_only_state(pages={"p1": "<html>", "p2": "<html>", "p3": "<html>"})
        assert "页面 3 份" in _after_write_hint(state)

    def test_没有祈使句(self):
        """这条红 = 又变回流程下命令、模型复述。"""
        for state in (
            _spec_only_state(),
            _spec_only_state(pages={"p1": "<html>"}),
        ):
            hint = _after_write_hint(state)
            hit = [w for w in _ORDERS if w in hint]
            assert not hit, f"祈使句回来了 {hit}：{hint}"

    def test_把选择权交回模型(self):
        hint = _after_write_hint(_spec_only_state())
        assert "由你决定" in hint, f"没有把下一步交回模型：{hint}"

    def test_后果照实说_但不禁止(self):
        """rehearse 的代价要讲，讲完仍由模型自己权衡（grok 的 truncation_hint 同款）。"""
        hint = _after_write_hint(_spec_only_state())
        assert "覆盖" in hint and "rehearse" in hint
        assert "不要调 rehearse" not in hint


class Test本跳跑了什么读的是本跳:
    """⚠ 2026-09-02 那条不许回退：会话里有旧页面、本跳只跑 spec，
    不许当成「页面刚出来」。"""

    def test_旧页面不算本跳产出(self):
        state = V5SessionState(
            sessionId="t-hint-hop",
            goal={"text": "图书馆", "status": "clear", "tools": ["spec"]},
            specFirstPages={
                "pages": {"p1": "<html>旧页</html>"},
                "capabilityPlan": {"tools": ["spec"]},
            },
        )
        hint = _after_write_hint(state)
        assert "起草 SPEC" in hint
        assert "本跳实际跑了" in hint
        src = _RC.read_text(encoding="utf-8")
        assert "_this_hop_tools" in src and "capabilityPlan" in src


class Test假设闸不许静静地哑掉:
    """假设卡等确认：本轮 HTTP 直接收工（零 LLM）。没有假设：host 按 hint 挑 pages。"""

    def test_假设卡等确认时把闸讲出来(self):
        state = _spec_only_state(spec={"assumptions": [{"id": "a1", "topic": "登录"}]})
        hint = _after_write_hint(state)
        assert "确认继续" in hint and "确认之前不画页面" in hint

    def test_确认过了就不再提(self):
        """⚠ 反向：确认完还念叨这句，模型会以为还卡着。"""
        state = _spec_only_state(
            spec={"assumptions": [{"id": "a1", "topic": "登录"}]},
            assumptionsConfirmed=True,
        )
        assert "确认继续" not in _after_write_hint(state)

    def test_没有假设时不提(self):
        assert "确认继续" not in _after_write_hint(_spec_only_state())

    def test_打孔部分failed不许说可以交付(self):
        """真机 sr-20260909041801：p1/p2 failed、p3 bound、blocked=false。"""
        state = V5SessionState(
            sessionId="t-bind-fail",
            goal={"text": "鲜果速收", "status": "clear", "tools": ["bind"]},
            specFirstPages={
                "pages": {"p1": "<html/>", "p2": "<html/>", "p3": "<html/>"},
                "pageBindStatus": {"p1": "failed", "p2": "failed", "p3": "bound"},
                "capabilityPlan": {"tools": ["bind"]},
            },
            publishClosure={"blocked": False, "topBlockers": []},
        )
        hint = _after_write_hint(state)
        assert "failed" in hint
        assert "p1" in hint and "p2" in hint
        assert "可以交付" not in hint
        assert "闭环完成" not in hint

    def test_打孔全skipped不许说闭环完成(self):
        state = V5SessionState(
            sessionId="t-bind-skip",
            goal={"text": "权盾后台", "status": "clear", "tools": ["bind"]},
            specFirstPages={
                "pages": {"p1": "<html/>", "p2": "<html/>", "p3": "<html/>"},
                "pageBindStatus": {"p1": "skipped", "p2": "skipped", "p3": "skipped"},
                "capabilityPlan": {"tools": ["bind"]},
            },
        )
        hint = _after_write_hint(state)
        assert "没接到任何页面" in hint
        assert "不许说已经闭环完成" in hint

    def test_没有假设时不许再把清单清成空(self):
        """变异：把 `tools = []` 加回 host 循环 → 本条红。

        那是「步骤不是 LLM 决策」的那一刀。没有假设时 pages 必须还在清单里。
        """
        tree = ast.parse(_RC.read_text(encoding="utf-8"))
        fn = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == "_control_llm_loop"
        )
        body = ast.unparse(fn)
        assert "tools = []" not in body, "host 循环又把工具清单清掉了"

    def test_假设卡等确认时两处都提前收工(self):
        """⚠ 2026-09-03：交回还问控制面 = 确认继续排队 25 分钟。

        成对：按钮路径 `_resume_control_llm_after_write` 与 host 循环。
        """
        src = _RC.read_text(encoding="utf-8")
        assert src.count("_complete_waiting_for_assumptions") >= 3, (
            "定义 1 处 + 调用至少 2 处（forced / host）。少一处 = 一半不生效。"
        )


class Test交付方式抄的是grok:
    def test_裹成提醒块(self):
        assert wrap_reminder("x") == "<system-reminder>\nx\n</system-reminder>"

    def test_追加在工具结果后面(self):
        out = append_reminder("工具结果", "情报")
        assert out.startswith("工具结果")
        assert out.endswith("</system-reminder>")

    def test_没有情报就原样返回(self):
        assert append_reminder("工具结果", "") == "工具结果"

    def test_按钮点火那条不再伪造用户消息(self):
        """⚠ 反向判据，钉的就是病灶本身。"""
        msgs = _messages_after_forced_write(
            _spec_only_state(), "开始推演", "spec", {"ok": True, "tool": "spec"}
        )
        users = [m for m in msgs if m.get("role") == "user"]
        assert len(users) == 1, f"又多出一条伪造的 user：{[m['content'][:40] for m in users]}"
        assert users[0]["content"] == "开始推演"
        tool_msg = next(m for m in msgs if m.get("role") == "tool")
        assert "<system-reminder>" in tool_msg["content"], "情报没贴在工具结果上"

    def test_host循环那条也贴在工具结果上(self):
        """⚠ CLAUDE.md §4：两条路成对，只改一条等于一半不生效。"""
        src = _RC.read_text(encoding="utf-8")
        assert src.count("append_reminder(") >= 3, (
            "两条交回路径没都用 append_reminder（定义 1 处 + 调用 2 处）"
        )
        assert '{"role": "user", "content": hint}' not in src, (
            "host 循环还在伪造 user 消息"
        )
