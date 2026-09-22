# -*- coding: utf-8 -*-
"""括号里的闭集工具名全表都认（含 refine）。

## 事故（2026-09-07 真机水果店 sr-20260907192228）

点芯片「精修（refine）」：
  · parseRehearsalSlash 只认整句开头的 /精修
  · factory_hop_from_text 只认 spec/pages/structure/bind/closure
  · POST 不带 forcedTool
  · 控制面重猜成 bind，expand_tools 把 bind 胀成 structure+assemble+bind
  · 弹出 SPEC 登录假设卡

抄 grok-build AskUserQuestion：选项点下去是 typed 答案，不是新 prompt。

判据喂真机那句原样载荷「精修（refine）」，不许自己拼一份。
先证明旧尺子确实不认——下面几条才不是空跑。
"""

from __future__ import annotations

import ast
from pathlib import Path

from services.closed_tools import (
    CLOSED_TOOLS,
    closed_tool_from_text,
    factory_hop_from_text,
    is_closed_tool_command,
)
from services.rehearsal_control import resolve_forced_tool

ROOT = Path(__file__).resolve().parents[2]
TS = ROOT / "client" / "src" / "lib" / "factory-hops.ts"
CTRL = ROOT / "slide-rule-python" / "services" / "rehearsal_control.py"


def _strip_comments(src: str) -> str:
    return "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("//")
    )


class Test旧尺子看不见refine:
    def test_factory_hop_from_text_does_not_see_refine_chip(self):
        assert factory_hop_from_text("精修（refine）") is None
        assert factory_hop_from_text("refine") is None


class Test闭集括号名:
    def test_refine_chip_is_refine(self):
        assert closed_tool_from_text("精修（refine）") == "refine"
        assert closed_tool_from_text("refine") == "refine"
        assert closed_tool_from_text("Refine") == "refine"

    def test_other_closed_tools(self):
        assert closed_tool_from_text("质疑（challenge）") == "challenge"
        assert closed_tool_from_text("进入权限绑定（bind）") == "bind"
        assert closed_tool_from_text("回退（restore_version）") == "restore_version"

    def test_product_name_is_not_a_tool(self):
        assert closed_tool_from_text("闭环发布管理系统") is None
        assert is_closed_tool_command("闭环发布管理系统") is False

    def test_rehearse_in_text_does_not_yolo(self):
        """跟 /推演 同一条：文本不得带 rehearse 跳过停泊。"""
        assert closed_tool_from_text("开始推演（rehearse）") is None
        assert is_closed_tool_command("开始推演（rehearse）") is True

    def test_multi_tool_sentence_is_command_but_not_unique(self):
        text = "精修（refine）然后闭环（closure）"
        assert closed_tool_from_text(text) is None
        assert is_closed_tool_command(text) is True


class Test活路径resolve_forced_tool:
    """⚠ §3：函数写对了 ≠ 接在链路上。"""

    def test_live_payload_refine_chip(self):
        assert resolve_forced_tool({}, "精修（refine）") == "refine"

    def test_leftover_factory_hop_is_overridden(self):
        assert (
            resolve_forced_tool({"forcedTool": "bind"}, "精修（refine）")
            == "refine"
        )

    def test_first_pass_still_ignores_text(self):
        assert resolve_forced_tool({}, "精修（refine）", first_pass=True) is None

    def test_explicit_refine_not_hijacked_by_topic(self):
        assert (
            resolve_forced_tool(
                {"forcedTool": "refine"}, "把权限绑定那一栏改成扫码"
            )
            == "refine"
        )

    def test_call_site_uses_closed_tool_from_text(self):
        src = CTRL.read_text(encoding="utf-8")
        tree = ast.parse(src)
        fn = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "resolve_forced_tool"
        )
        names = {
            node.id
            for node in ast.walk(fn)
            if isinstance(node, ast.Name)
        }
        assert "closed_tool_from_text" in names
        assert "factory_hop_from_text" in names


class Test精修已有SPEC不许从spec起:
    def test_refine_branch_picks_pages_when_spec_exists(self):
        src = CTRL.read_text(encoding="utf-8")
        assert '_hop = "pages" if _has_spec(state) else "spec"' in src


class Test两侧同一张表:
    def test_ts_exports_closed_tools_and_parser(self):
        src = TS.read_text(encoding="utf-8")
        assert "export const CLOSED_TOOLS" in src
        assert "export function closedToolFromText" in src
        for name in CLOSED_TOOLS:
            assert f'"{name}"' in src or f"'{name}'" in src
        stripped = _strip_comments(src)
        assert "closedToolFromText" in stripped
