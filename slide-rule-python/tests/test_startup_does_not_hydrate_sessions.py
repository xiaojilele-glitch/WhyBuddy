"""启动不得把全库会话 blob 拉进进程。

⚠ 2026-08-19：slide_rule_session 在 import 末尾调 `_load_sessions()`，
lifespan 再 `load_all()` 一次。HTTPS 网关 `select session_id, payload`
（34 条就 5.2 MB / 2.3s，现约 80 条）挡住 uvicorn
`Application startup complete`，dev:all 看起来像卡死。--reload 下
reloader + worker 把这条再乘一遍。
"""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _module_level_calls(path: Path, name: str) -> list[ast.Call]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[ast.Call] = []
    for node in tree.body:
        if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call):
            continue
        func = node.value.func
        if isinstance(func, ast.Name) and func.id == name:
            found.append(node.value)
    return found


def test_slide_rule_session_import_does_not_hydrate_all_blobs():
    """正：模块顶层不再调用 _load_sessions。反：把那一行加回去必须红。"""
    path = ROOT / "services" / "slide_rule_session.py"
    assert _module_level_calls(path, "_load_sessions") == []


def test_lifespan_does_not_call_load_all():
    """正：启动只打一行 defer。反：把 load_all() 塞回 lifespan 必须红。"""
    src = (ROOT / "app.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    lifespan = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "lifespan"
    )
    for node in ast.walk(lifespan):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id != "load_all", "lifespan still hydrates every session blob"
    assert "payloads deferred until first request" in src
    assert "startup_budget_line" in src
