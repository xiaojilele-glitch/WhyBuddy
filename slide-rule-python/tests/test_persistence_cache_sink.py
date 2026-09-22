# -*- coding: utf-8 -*-
"""持久层写完钉缓存：下层定义接口，上层注入实现（2026-08-29）。

## 换掉了什么

原来 `persistence` 在写完之后 `from .slide_rule_session import _sessions`，
把状态钉进会话层的内存缓存——**持久层反过来 import 会话层**，而会话层顶层就
import 持久层，是个真的循环依赖。Python 不会报错，它只会逼你把 import 藏进
函数体接着跑（那正是当时的写法）。

## 抄的是 grok 的依赖倒置

`xai-grok-tools`（下层）定义 `MemoryBackend` / `TerminalBackend` /
`ToolSearchIndex` 这些 trait，由上层 `xai-grok-shell` 去 `impl` 并注入。
实测他们的依赖边始终是 `shell → tools`，**没有反向边**——调用在运行时反向回去。

这里同构：`persistence.set_cache_sink()` 是接口，
`slide_rule_session._pin_into_cache` 是实现，import 会话层时注入。

## ⚠ 这种写法最容易坏在哪

**接口写对了 ≠ 有人注入**（CLAUDE.md 第三条）。注册那一行被谁删掉、或者被挪进
某个不会执行的分支，功能就**安静地没了**：写还是成功的，只是缓存不再更新，
表现是「库写失败/降级之后 GET 读到旧指针」——2026-08-18 过夜踩过的那个病原样
回来，而且一行日志都不会有。

所以这个文件的第一条判据不是「接口在不在」，是**「import 会话层之后 sink 真的在」**。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import persistence  # noqa: E402


class Test上层真的注入了:
    def test_import会话层就完成注入(self):
        """⚠ 第一条。注册那一行没执行 = 功能安静地没了。"""
        import services.slide_rule_session  # noqa: F401

        assert persistence.get_cache_sink() is not None, (
            "没有人注入 cache sink——persistence 写完不会再钉缓存，"
            "库写失败/降级后 GET 会读到旧指针（2026-08-18 过夜踩过）"
        )

    def test_注入的是会话层那个实现(self):
        import services.slide_rule_session as sess

        assert persistence.get_cache_sink() is sess._pin_into_cache


class Test钉缓存这件事真的发生:
    """⚠ 行为判据。上面两条只证明「线接上了」，这条证明「电通了」。"""

    def test_写完之后状态进了内存缓存(self, monkeypatch):
        import services.slide_rule_session as sess
        from models.v5_state import V5SessionState

        state = V5SessionState(sessionId="sr-sink-1", goal={"text": "x"})
        monkeypatch.setattr(
            persistence, "save_session_record", lambda s, *a, **kw: {"ok": True}
        )
        sess._sessions.pop("sr-sink-1", None)
        persistence.persist_state(state)
        assert sess._sessions.get("sr-sink-1") is state, (
            "写完没把这一份钉进缓存"
        )

    def test_sink炸了不许拖垮写入(self, monkeypatch):
        """⚠ 反向判据：钉缓存是增强，不是闭环（CLAUDE.md 第七条 fail-open）。"""
        from models.v5_state import V5SessionState

        def _boom(sid, state):
            raise RuntimeError("boom")

        monkeypatch.setattr(persistence, "save_session_record", lambda s, *a, **kw: {"ok": True})
        monkeypatch.setattr(persistence, "_CACHE_SINK", _boom)
        persistence.persist_state(V5SessionState(sessionId="sr-sink-2", goal={"text": "x"}))

    def test_没人注入时安静跳过(self, monkeypatch):
        """没加载会话层的进程里，这一步不做是对的——没人会去读那份缓存。"""
        from models.v5_state import V5SessionState

        monkeypatch.setattr(persistence, "save_session_record", lambda s, *a, **kw: {"ok": True})
        monkeypatch.setattr(persistence, "_CACHE_SINK", None)
        persistence.persist_state(V5SessionState(sessionId="sr-sink-3", goal={"text": "x"}))


class Test方向不许再反过来:
    """⚠ 架构闸已经盯着这条（环只许变少），这里再钉一次源码级的，
    因为这个具体的反向 import 有过前科，值得点名。"""

    def test_persistence不许import会话层(self):
        import pathlib
        import re

        src = pathlib.Path(persistence.__file__).read_text(encoding="utf-8")
        code = "\n".join(
            l for l in src.splitlines() if not l.lstrip().startswith("#")
        )
        code = re.sub(r'"""[\s\S]*?"""', "", code)
        assert "slide_rule_session" not in code, (
            "persistence 又反过来 import 会话层了——环会长回来。"
            "要用上层的东西就加一个 sink，让上层注入（见本文件模块头）"
        )


class Test注入活得过reload:
    """⚠ 2026-08-29 实测踩到的真漏洞，不是测试洁癖。

    `importlib.reload(persistence)` 会把模块全局重置成 None，而
    `slide_rule_session` 已经 import 过、不会再执行一次注册——钉缓存**安静地停了**。
    全量跑 5182 条时就是这么翻的：`test_golden_path_convergence` reload 了持久层，
    之后本文件三条红，而单独跑全绿。

    这不只是测试里的事：**uvicorn `--reload` 在开发时也会重载模块**。
    所以 load/save 两个入口各补一次幂等注册，让它 reload 之后自愈。
    """

    def test_reload之后下一次load就自愈(self):
        import importlib

        import services.slide_rule_session as sess

        importlib.reload(persistence)
        assert persistence.get_cache_sink() is None, "reload 没把全局清掉？前提变了"
        sess.ensure_cache_sink()
        assert persistence.get_cache_sink() is not None, (
            "reload 之后没自愈——钉缓存会安静地停掉"
        )

    def test_自愈是幂等的_不许覆盖别人注入的(self, monkeypatch):
        """⚠ 反向判据：自愈只在「没人注入」时补，不许把测试或别的实现顶掉。"""
        import services.slide_rule_session as sess

        sentinel = lambda sid, state: None  # noqa: E731
        monkeypatch.setattr(persistence, "_CACHE_SINK", sentinel)
        sess.ensure_cache_sink()
        assert persistence.get_cache_sink() is sentinel

    def test_两个入口都补了(self):
        """⚠ 只补一个入口 = 只改一半（第四条）：走另一条路进来的照样失效。"""
        import inspect

        import services.slide_rule_session as sess

        for fn in (sess.load_session, sess.save_session):
            src = inspect.getsource(fn)
            assert "ensure_cache_sink()" in src, f"{fn.__name__} 没补自愈"
