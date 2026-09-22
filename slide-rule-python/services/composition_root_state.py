# -*- coding: utf-8 -*-
"""装配根有没有装起来 —— 叶子模块，**谁都不依赖**。

## 为什么要有这个文件（2026-08-29）

原来 `external_provider_cutover._check_deployed_python_service` 是这么写的：

    try:
        import app          # noqa: F401
        return {"status": "ready", "reason": "python app module loadable"}
    except Exception:
        return {"status": "degraded", ...}

两个毛病，第二个才是要命的：

1. **方向反的。** 业务层反过来 import 装配根。抄的 grok-build 那边，
   装配根 `xai-grok-pager-bin` 的**被依赖数是 0**——没有任何 crate 依赖它，
   这是编译器焊死的。我们这条边把 `diagnostics → entrypoint → http_routes
   → diagnostics` 连成了一个组间环。

2. ⚠ **这个判据永远不会红。** uvicorn 是用 `app:app` 起的，`sys.modules['app']`
   早就在了，函数体里那句 `import app` 拿的是缓存，必然成功；而万一 app 真的
   import 失败，进程根本起不来，这个接口也没人能调。也就是说线上它**只能返回
   ready**——CLAUDE.md 第三条点名的那种「接口返回 200 ≠ 它真的做了事」。

## 换成什么

抄 grok 的依赖倒置（跟 `persistence.set_cache_sink` 同一招）：下层定义标记，
装配根装完自己来钉。方向变成 `app → 这里`、`external_provider_cutover → 这里`，
两条都是往下的，环断了；而且判据**能红了**——没装配过的进程（跑脚本、跑单测、
app import 到一半炸了）读到的就是 None。

## ⚠ 这种写法最容易坏在哪

跟 cache sink 一样：**接口写对了 ≠ 有人钉**。`app.py` 尾巴上那一行被谁删掉、
或者被缩进进某个 `if` 里，探针就会永远报 degraded，而且不会有任何报错。
所以判据的第一条不是「函数在不在」，是 **「import app 之后标记真的在」**
（tests/test_composition_root_state.py）。

⚠ 那一行必须在 `app.py` 的**模块顶层**。文件尾部那一大段 SPA 兜底路由是包在
`if _spa_static.exists():` 里的，跟着它缩进就会在没打前端包的机器上静默不执行。
"""

from __future__ import annotations

from typing import Any, Dict, Optional

#: 装配根装完之后的自述。None = 本进程没装配过（不是「装配失败」，也不是「就绪」）。
_READY: Optional[Dict[str, Any]] = None


def mark_composition_root_ready(*, routers: int, title: str = "") -> None:
    """装配根装完自己调这一行。只有 `app.py` 该调它。"""
    global _READY
    _READY = {"routers": int(routers), "title": str(title or "")}


def composition_root_ready() -> Optional[Dict[str, Any]]:
    """返回装配根自述；本进程没装配过则 None。"""
    return dict(_READY) if _READY else None
