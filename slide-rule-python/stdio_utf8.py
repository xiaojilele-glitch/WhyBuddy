"""Windows stdio 编码：CPython 的标准答案，不是逐处抓 ⚠。

2026-08-20 Foclip 真机：`print("[spec_first] ⚠ …")` 在 GBK 下 UnicodeEncodeError
（position 13），被宽 except 当成 LLM_GENERATE_FAILED，规格已成、右栏空白、
证据 0/6。仓里已经有 `_safe_print`，漏了一行裸 print 就全军覆没。

GitHub / CPython 标准（抄逻辑，不抄库）：

  · ``sys.stdout.reconfigure(encoding="utf-8", errors="replace")``
    （3.7+ ``io.TextIOWrapper.reconfigure``）
  · 启动前 ``PYTHONIOENCODING=utf-8:replace``（文档：``sys.stdout``）
  · ``PYTHONUTF8=1``（PEP 540 UTF-8 mode）

过夜脚本已经 reconfigure，uvicorn 活路径（app.py）漏了。dev:all 等就绪时
把 stdout/stderr 收成 **pipe**——Windows 对非控制台设备用 ANSI 代码页（GBK），
控制台本身反而是 UTF-8。所以「终端看着是 UTF-8」也挡不住这条。

开机钉一次，后面任何 ``print(⚠)`` / logging 打到 stderr 都不再能拖死主链路。
``errors="replace"`` 宁可日志出问号，不许异常逃进业务 except。
"""

from __future__ import annotations

import sys
from typing import Any, Optional, TextIO


def configure_stdio_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        _reconfigure(stream)


def _reconfigure(stream: Optional[TextIO]) -> None:
    if stream is None:
        return
    fn = getattr(stream, "reconfigure", None)
    if not callable(fn):
        return
    try:
        fn(encoding="utf-8", errors="replace")
    except Exception:
        try:
            fn(errors="replace")
        except Exception:
            return


def safe_print(*args: Any, **kwargs: Any) -> None:
    """测试里会把 stdout 换成没有 reconfigure 的假对象；开机钉不住时的退路。"""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        text = " ".join(str(a) for a in args)
        print(
            text.encode(encoding, errors="replace").decode(encoding, errors="replace"),
            **kwargs,
        )
