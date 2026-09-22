"""建连不许傻等十分钟，而读响应必须能等（2026-08-14）。

## 真机形状

收尾那 821 秒的黑洞，埋点补上之后一行说清：

    [llm-retry] 第 1/3 次失败（可重试，耗时 331.0s）：
        cannot reach …: Server disconnected without sending a response.

**一次调用挂了 331 秒才失败**，三次重试就是十几分钟。

根因：此前给 httpx 传的是一个**裸数字**，而它会被同时用在四个阶段上
（connect / read / write / pool）。于是 `LLM_TIMEOUT_MS=600000` 不只是
"读响应最多等 10 分钟"，连"建连最多等 10 分钟"也一起给了。

## 抄的是 openai SDK 的默认

    openai/_constants.py:9
    DEFAULT_TIMEOUT = httpx.Timeout(timeout=600, connect=5.0)

整体 600 秒、连接单独压到 5 秒。这不是拍的数，是官方 SDK 的默认形状。

## read 那 600 秒**不能动**

一次页面生成实测 149~200s、bind 单页 185s、spec 起草 64~93s。缩短读超时
会当场误杀正常的长生成——那比多等 331 秒糟得多。所以这条用例是**双向**的：
既钉住 connect 要短，也钉住 read 不许被顺手改短。
"""

import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import (  # noqa: E402
    _describe_http_error,
    _describe_timeout,
    _http_timeout,
)


class Test四个阶段不再共用一个数:
    def test_connect_短_read_长(self):
        t = _http_timeout(600.0)
        assert t.connect == 5.0, "建连还在等 10 分钟——裸数字又传回去了？"
        assert t.read == 600.0, (
            "读超时被改短了。⚠ 一次页面生成实测 149~200s、bind 单页 185s，"
            "缩短它会当场误杀正常的长生成"
        )

    def test_形状与_openai_sdk_一致(self):
        """⚠ 判据钉在**参照实现**上，不钉在我写下的数字上。

        openai SDK 换了默认值时这条会红——那时该跟着想一遍，
        而不是让我们的值和业界默认悄悄分叉。
        """
        from openai._constants import DEFAULT_TIMEOUT as SDK

        ours = _http_timeout(600.0)
        assert ours.connect == SDK.connect, (
            f"connect 与 openai SDK 分叉了：我们 {ours.connect} vs SDK {SDK.connect}"
        )

    def test_整体超时仍然跟着调用方走(self):
        """connect 是固定的，其余三档要跟着 timeout_ms 走——
        否则 LLM_TIMEOUT_MS 这个配置就名存实亡了。"""
        t = _http_timeout(30.0)
        assert t.read == 30.0 and t.write == 30.0 and t.pool == 30.0
        assert t.connect == 5.0, "connect 不该被调用方的整体超时带走"


class Test错误类型不许被吞掉:
    """⚑ 此前 ConnectError / RemoteProtocolError / ReadError 全被
    `except httpx.HTTPError` 一把捞走，消息里只有 "cannot reach …"。

    于是「连不上」和「连上了但对面中途断开」在日志里长得一模一样——
    而这两者要的修法不同：前者靠短 connect 超时，后者得靠首字节超时或对冲。
    331 秒那次就卡在分不出是哪一种。
    """

    @pytest.mark.parametrize(
        "exc,name",
        [
            (httpx.ConnectError("refused"), "ConnectError"),
            (httpx.RemoteProtocolError("Server disconnected without sending a response."),
             "RemoteProtocolError"),
            (httpx.ReadError("boom"), "ReadError"),
        ],
    )
    def test_类型名进了消息(self, exc, name):
        out = _describe_http_error(exc)
        assert out.startswith(f"{name}: "), f"类型名没带出来：{out}"

    def test_原始消息不许被类型名挤掉(self):
        """两样都要：类型定位「哪一层」，原文定位「具体怎么了」。"""
        out = _describe_http_error(
            httpx.RemoteProtocolError("Server disconnected without sending a response.")
        )
        assert "Server disconnected" in out


class Test超时也不许被吞掉:
    """⚑ 2026-08-17：上面那条（2026-08-14）**只修了一半**。

    `HTTPError` 分支修好了，紧挨着的 `TimeoutException` 分支漏了。真机日志：

        [llm-retry] 第 2/3 次失败（可重试，耗时 5.2s）：timeout after 600s

    耗时 5.2 秒、报 600 秒，**差 120 倍**。因为 `_http_timeout` 把 connect 压到
    5s、其余留 600s，而 `ConnectTimeout` 是 `TimeoutException` 的子类，被一把
    捞走后消息里填的是配置的整体预算，不是真正生效的那档。

    危害与上面同源：连不上（查网关可达性）和生成太慢（查模型/预算）修法相反，
    而日志把前者写成了后者。
    """

    def test_连接超时报的是_connect_预算而不是整体预算(self):
        out = _describe_timeout(httpx.ConnectTimeout("timed out"), 600.0, 5.2)
        assert "5" in out and "600" not in out, (
            f"连接超时仍在报整体预算 600s，真实等待只有 5 秒：{out}"
        )

    def test_读超时报的才是整体预算(self):
        """反向判据：别为了修 connect 把 read 也一起写错——
        读超时本来就该是那 600 秒。"""
        out = _describe_timeout(httpx.ReadTimeout("timed out"), 600.0, 601.3)
        assert "600" in out, f"读超时的预算写丢了：{out}"

    @pytest.mark.parametrize(
        "exc,name",
        [
            (httpx.ConnectTimeout("t"), "ConnectTimeout"),
            (httpx.ReadTimeout("t"), "ReadTimeout"),
            (httpx.WriteTimeout("t"), "WriteTimeout"),
            (httpx.PoolTimeout("t"), "PoolTimeout"),
        ],
    )
    def test_四档超时的类型名都进消息(self, exc, name):
        assert _describe_timeout(exc, 600.0, 1.0).startswith(name), (
            "四档超时又被坍缩成同一句了"
        )

    def test_真实等待时长必须在消息里(self):
        """没有它就没法判断「等够了才超时」还是「刚开始就炸」——
        5.2s 那行日志正是靠这个数才露馅的。"""
        assert "5.2" in _describe_timeout(httpx.ConnectTimeout("t"), 600.0, 5.2)


class Test两条链路都得修到:
    """⚠ 纪律四：同步与流式是两条独立的 except 分支，改一条不改另一条
    **不会报错，只会有一半日志继续骗人**。这条钉住源码里不再有裸的
    `timeout after {…}` 写法。

    ⚠ 判据必须**先剥注释和文档串再匹配**：本次修复的 docstring 里原样引用了
      "timeout after 600s" 这行病历。直接 grep 源码会被文档串喂饱，
      改回去照样绿——CLAUDE.md 点名过这个形态。
    """

    @staticmethod
    def _source_without_comments() -> str:
        """只留可执行代码：注释 + 文档串都去掉。

        用 ast 不用 tokenize：注释压根不进 AST（省掉一半活），文档串是
        每个作用域 body[0] 上的裸字符串常量，摘掉即可。手搓 tokenize 的
        状态机第一版就写漏了，被下面那条自检咬红——留个记号。
        """
        import ast
        from pathlib import Path

        path = Path(__file__).resolve().parent.parent / "sliderule_llm" / "client.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(
                node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
            ):
                continue
            body = getattr(node, "body", None)
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body.pop(0)
        return ast.unparse(tree)

    def test_源码里不再有裸的_timeout_after_写法(self):
        code = self._source_without_comments()
        assert "timeout after" not in code, (
            "还有分支在用裸的 'timeout after {整体预算}'——"
            "同步或流式漏了一条，那条的日志会继续把 5 秒的连接失败报成 600 秒"
        )

    def test_剥注释这件事本身是有效的(self):
        """自检：如果剥注释失效（比如 tokenize 用法写错、整份原样返回），
        上面那条判据就会被文档串里的病历喂饱而永远绿。这条钉住剥这个动作
        真的把文档串去掉了。"""
        code = self._source_without_comments()
        assert "差 120 倍" not in code, "文档串没被剥掉，上面那条判据是假绿"
        assert "def _describe_timeout" in code, "剥过头了，把代码本身也剥没了"
