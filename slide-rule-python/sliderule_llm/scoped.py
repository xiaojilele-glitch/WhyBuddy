"""「装了必须卸」：把 sink 的安装做成一个自带清除的作用域。

抄的标准答案：grok-build `xai-grok-pager/src/memory_trace.rs`

    /// Install a scoped sink writing to `path` … Returns a guard restoring
    /// the previous sink on drop.
    pub(crate) struct SinkGuard(Option<std::sync::Arc<Sink>>);

    impl Drop for SinkGuard {
        fn drop(&mut self) {
            *guard = self.0.take();          // ← 还原成**原来那个**
        }
    }

    pub(crate) fn install_test_sink(path, rotate_bytes) -> SinkGuard {
        let prev = guard.take();             // ← 先把原来的收好
        *guard = Some(Sink::new(...));
        SinkGuard(prev)
    }

两条要害，缺一条都不叫抄到：

  ① **装的动作自带卸的动作**。Rust 靠 Drop，Python 靠 with——都不需要调用方
     跑到别处去记得补一行。此前本仓是「第 1972 行装、第 2610 行卸」，中间
     隔着六百行和整轮推演。功能上靠 finally 兜住了，但谁加第六根 sink 都得
     记得跑到六百行外补一行，忘了不报错。

  ② **卸的时候还原成"原来那个"，不是置空**。此前统一写 `set(None)`。
     嵌套时 `None` 会把外层那根一起抹掉，而 grok 存的是 prev。

⚠ 存的是**值**不是 ContextVar 的 Token，这是照着 grok 抄的，也是这里唯一
  正确的做法：`ContextVar.reset(token)` 要求 token 在**同一个 Context** 里被
  reset，而本仓这些 sink 装在一个横跨几百次 yield 的异步生成器里，生成器被
  谁在什么 Context 里恢复不由我们说了算——用 token 会换来一个
  `ValueError: <Token> was created in a different Context`。存值再 set 回去
  没有这个约束，语义跟 SinkGuard 一模一样。

⚠ 这里**不解决**并发串台，那件事早就解决了：这些 sink 在 2026-08-06 全部从
  模块级全局改成了请求域 ContextVar（起因是真机实测「用户 A 生成的内容实时
  出现在用户 B 的页面上」，见 sliderule_llm/capabilities.py 头注）。本模块治
  的是另一件事——装和卸离得太远、以及卸成 None 而不是还原。
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator


@contextmanager
def sink_scope(var: ContextVar, sink: Any) -> Iterator[None]:
    """在这个 with 块里把 `var` 设成 `sink`，出块还原成进块前的值。"""
    prev = var.get()
    var.set(sink)
    try:
        yield
    finally:
        var.set(prev)
