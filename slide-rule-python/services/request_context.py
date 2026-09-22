"""把"这次请求是谁发的"带到深处（2026-08-02）。

## 为什么需要它

应用是在推演到闭环时由 `v5_capability_executor` 落库的，那里距离 HTTP 路由隔着
好几层（驱动器 → 能力执行 → 增强 → 落库），中间每一层都不关心用户是谁。把
`owner_id` 一路当参数传下去要改十几个函数签名，而它们中的绝大多数只是"顺手带一下"。

`contextvars` 正是为这种场景设计的：请求开始时设一次，任意深处读得到，且**天然
按请求隔离**（不像全局变量会被并发请求串味）。

## 线程池里也有效

推演路由是 `def`（同步）——FastAPI 把它丢进线程池跑（见 sliderule_full 里那段
长注释）。`anyio.to_thread.run_sync` 会把调用方的 context **复制**进工作线程，
所以在线程里读同一个 contextvar 拿得到值。`asyncio.to_thread` 同理。

⚠️ 但**手动起的 threading.Thread 不会**继承 context。将来若有人把落库挪进自己
起的线程，这里会静默变成 None（表现是"登录用户跑出来的应用还是无主的"）。
所以下面的读取函数在拿不到时返回 None 而不是抛——无主是一个合法状态，
不能因为上下文没传到就把闭环搞失败。
"""

from __future__ import annotations

import contextvars
from typing import Any, Optional

_current_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "sliderule_current_user_id", default=None
)


def set_current_user(user: Any) -> contextvars.Token:
    """在请求入口设一次。返回的 token 可用于恢复（一般不需要——每个请求有自己的
    context，请求结束就没了）。"""
    uid = None
    if user is not None:
        raw = getattr(user, "id", None)
        uid = str(raw) if raw else None
    return _current_user_id.set(uid)


def current_user_id() -> Optional[str]:
    """当前请求的用户 id；匿名或上下文没传到时返回 None。

    **不抛异常**：无主是合法状态（匿名推演已被路由层拦住，但存量/内部调用仍可能
    走到这里）。为了拿归属而让闭环失败是本末倒置。
    """
    try:
        return _current_user_id.get()
    except LookupError:  # pragma: no cover — 有 default 时不会发生，防御性
        return None


def reset_current_user(token: contextvars.Token) -> None:
    try:
        _current_user_id.reset(token)
    except (ValueError, LookupError):
        pass
