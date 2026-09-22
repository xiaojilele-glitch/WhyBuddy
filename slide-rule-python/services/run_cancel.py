"""协作式取消：让跑在线程里的引擎**自己看得见"该停了"**。

## 为什么需要它（2026-08-14 实测）

run_registry 的孤儿看门狗喊的是 `run.task.cancel()`。但引擎每一步走的是
`await asyncio.to_thread(...)`，而 **`Task.cancel()` 打不断已经在线程里跑
的同步代码**——它只让协程在下一个 await 点抛 CancelledError，线程照跑到底。

实测（tests/test_run_cooperative_cancel.py 里钉着同一件事）：

    [0.0s] 协程被 cancel 掉了，看门狗认为「收掉了」
            此刻线程状态: 仍在跑
    [3.5s] 线程状态: ['跑完了']      ← cancel 根本没打断它

而这里"一步"有多大：真机一轮 `specfirst.structure` 单步 **918 秒**。
所以喊停之后它还能烧十几分钟，喊停之前那 600 秒宽限白等。

更别扭的是**账面还会说谎**：`_drive()` 捕获 CancelledError 后立刻把 run 标成
`cancelled`，而线程里的活还在烧 LLM。「状态绿了但东西没停」——本仓数过很多次
的那个形状，这次落在生命周期上。

## 抄的是什么

协作式取消是这类系统的标准答案，三家形状一致：

    .NET      CancellationToken + token.ThrowIfCancellationRequested()
    Go        context.Context   + select { case <-ctx.Done(): }
    Temporal  heartbeat         + 心跳时才收得到取消

⚠ **Temporal 自己的 Python SDK 有一模一样的限制**（sdk-python#700：活儿卡在
长协程里时，取消要等到下一次 heartbeat 才看得见）。也就是说没有"更聪明的
成品"可抄——大家都是靠**在安全点主动查一下**。所以这里也不引库：一个
`threading.Event` + 一个 `raise_if_cancelled()` 就是全部，引任何东西进来
都只是把这两行包一层。

## 为什么用 ContextVar 装一个 Event，而不是直接传参

`asyncio.to_thread` 会把**当前 contextvars.Context 复制进线程**，所以异步侧
设好的 ContextVar 在线程里读得到。但取消是**事后**发生的——ContextVar 里
必须放一个**可变对象**（Event），线程读到的是同一个对象引用，看门狗事后
`set()` 它，线程下一次 `is_set()` 就看得见。

放一个 bool 进 ContextVar 是不行的：复制进线程的是那一刻的值，之后改不动。

替代方案是给沿途十几个函数都加一个 token 参数——那是本仓在 request_context
那次已经拒绝过的做法（见 set_current_user 的注释）。
"""

from __future__ import annotations

import threading
from contextvars import ContextVar
from typing import Optional

#: 当前 run 的取消令牌。异步侧在起跑前 set()，线程侧只读。
_CANCEL: ContextVar[Optional[threading.Event]] = ContextVar("sliderule_run_cancel", default=None)


class RunCancelled(Exception):
    """引擎在安全点上主动停下来。

    ⚠ 特意**不继承 asyncio.CancelledError**：那个在 3.8+ 是 BaseException，
      沿途大量 `except Exception` 捕不到它，会穿过所有 fail-open 的兜底层
      一路炸上去——而这条链上到处是"这一步失败不该打死整轮"的设计。
      这里要的是"干净地停下并留痕"，不是"炸穿一切"。
    """


def new_token() -> threading.Event:
    """造一个取消令牌。调用方（run_registry）持有它，用于事后 set()。"""
    return threading.Event()


def bind(token: Optional[threading.Event]) -> None:
    """把令牌绑到当前上下文。**必须在起跑前调用**，之后才会被复制进线程。"""
    _CANCEL.set(token)


def is_cancelled() -> bool:
    token = _CANCEL.get()
    return token is not None and token.is_set()


def raise_if_cancelled(where: str) -> None:
    """安全点。`where` 只用于留痕——停在哪一步是排查时最想知道的第一件事。

    ⚠ 放在**步与步之间**，不要放进循环内层：这一层的意义是"别再开始下一件
      大活儿"，不是"把当前这件切成碎片"。切太碎既救不了已经发出去的 LLM
      请求，又给每一步都加上一处可能抛异常的地方。
    """
    if is_cancelled():
        raise RunCancelled(f"已请求取消，停在 {where} 之前")
