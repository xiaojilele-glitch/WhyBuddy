# -*- coding: utf-8 -*-
"""Windows stdio：钉一次，不要逐处抓 ⚠。

判据必须能被变异咬住：reconfigure 丢掉 errors='replace'、app.py 不调用，
这两条都要红。
"""
from __future__ import annotations

import ast
import io
import sys
from pathlib import Path

from stdio_utf8 import configure_stdio_utf8, safe_print

ROOT = Path(__file__).resolve().parents[1]


class GbkConsole:
    encoding = "gbk"

    def write(self, s):
        s.encode("gbk")
        return len(s)

    def flush(self):
        return None


def test_reconfigure_要求_utf8_且_replace():
    """抄的是 CPython TextIOWrapper.reconfigure，不是只换编码不换 errors。"""
    calls = []

    class Fake:
        def reconfigure(self, **kw):
            calls.append(kw)

    fake = Fake()
    monkey_stdout = sys.stdout
    monkey_stderr = sys.stderr
    sys.stdout = fake  # type: ignore[assignment]
    sys.stderr = fake  # type: ignore[assignment]
    try:
        configure_stdio_utf8()
    finally:
        sys.stdout = monkey_stdout
        sys.stderr = monkey_stderr
    assert calls, "stdout/stderr 都没有 reconfigure"
    assert all(c.get("encoding") == "utf-8" for c in calls)
    assert all(c.get("errors") == "replace" for c in calls)


def test_原_GBK_流print警告符不炸():
    buf = io.BytesIO()
    stream = io.TextIOWrapper(buf, encoding="gbk", errors="strict")
    old = sys.stdout
    sys.stdout = stream
    try:
        configure_stdio_utf8()
        print("[spec_first] ⚠ 交付页数对不上 SPEC")
        stream.flush()
    finally:
        sys.stdout = old
        stream.close()


def test_safe_print_在假_GBK_控制台也不炸(monkeypatch):
    monkeypatch.setattr(sys, "stdout", GbkConsole())
    safe_print("[spec_first] ⚠ 交付页数对不上 SPEC")


def test_app_py_开机就调用():
    """反：把 configure_stdio_utf8() 从 app.py 拿掉必须红。手工起 uvicorn
    没有 PYTHONIOENCODING 时，只改 dev:all 等于没改。"""
    tree = ast.parse((ROOT / "app.py").read_text(encoding="utf-8"))
    calls = []
    for node in tree.body:
        if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call):
            continue
        func = node.value.func
        if isinstance(func, ast.Name) and func.id == "configure_stdio_utf8":
            calls.append(node.value)
    assert calls, "app.py 开机不再钉 stdout——管道里的 ⚠ 仍会拖死推演"
