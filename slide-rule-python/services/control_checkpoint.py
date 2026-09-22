"""Control-loop checkpoint port; persistence and worker ownership live outside it.

Ownership/cancellation must escape the loop's conversational error fallback.
Otherwise a lost producer can turn a failed checkpoint into a fake completion.
"""

import asyncio
from contextvars import ContextVar
from typing import Any, Protocol


class ControlRunStopped(BaseException):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class CheckpointPort(Protocol):
    checkpoint: dict[str, Any] | None

    def guard(self) -> None: ...

    async def save(self, checkpoint: dict[str, Any]) -> None: ...

    def fence(self) -> dict[str, Any]: ...


current_checkpoint: ContextVar[CheckpointPort | None] = ContextVar(
    "control_run_checkpoint", default=None
)


def guard_control_run() -> None:
    port = current_checkpoint.get()
    if port is not None:
        port.guard()


async def owned_model_sample(awaitable):
    """Only sampling is interruptible; threadpool tool writes must drain.

    ⚠ 2026-09-19：guard 失败原先立刻 ControlRunStopped。存档抖一下
    （Neon 8s）就把正在飞的采样整轮掐死。抄 grok 持久化 actor——LLM
    还在跑的时候存档抖动要重试，不是废会话。真正丢了租约 / 用户取消
    仍立刻停。
    """
    port = current_checkpoint.get()
    if port is None:
        return await awaitable
    task = asyncio.create_task(awaitable)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.25)
            await _guard_sampling(port)
            if done:
                return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


_SAMPLING_GUARD_RETRIES = 3


async def _guard_sampling(port: CheckpointPort) -> None:
    last: BaseException | None = None
    for attempt in range(_SAMPLING_GUARD_RETRIES):
        try:
            await asyncio.to_thread(port.guard)
            return
        except ControlRunStopped as exc:
            if exc.reason != "control_checkpoint_unavailable" or attempt + 1 >= _SAMPLING_GUARD_RETRIES:
                raise
            last = exc
            await asyncio.sleep(0.05)
    if last is not None:
        raise last
