"""每多一轮就多烧一次模型往返，等待类工具因此不许把上界钉死在 5 秒。

## 来历：2026-09-16 真机 sr-20260916212612-6N7V2BZ6XS

整趟 1127 秒、34 轮。逐条时间戳量出来的形状：

    tool_result → 下一个 tool_start 的间隔  稳定 12~20 秒
    （服务端记账是 ms 级，所以那一段就是模型往返）

    npm run build 18.9s   npm run check 18.9s   npm test 19.0s
    34 轮里 27 轮只挑 1 件工具
    9 轮是纯轮询（project_status ×5、shell_wait ×4）

等待上界原本是 5 秒，于是等一条 18 秒的 build 至少 4 轮：

    4 × (5 秒等待 + 15 秒往返) ≈ 80 秒，去等一件 18 秒的事

⚠ 而 project_create 只花 5.8 秒——「一跳起栈」在这趟里只值 0.5%。
  真正的大头是轮次，不是脚手架。这条注释别删：它是不去做那件事的理由。

## 这份判据钉三件

1. 上界够一条真实构建一次等完（30 秒）。
2. 等待循环**提前返回**——上界调大之所以是纯赚全靠这个。没有这条，
   30 秒就变成「每次都死等满」，比原来更糟。
3. 等待期间的重查要退避——否则 30 秒 = 向远程 SQL 网关打 300 次查询，
   把往返税换成数据库风暴。

外加一条：模型看得见的那两处描述（"max 5"）必须跟着改。只改 Field 不改描述，
模型仍然以为上限是 5（CLAUDE.md §4 生成侧/消费侧）。
"""

from __future__ import annotations

import time

import pytest

from services import project_tools
from services.project_tool_contracts import (
    PROJECT_WAIT_MAX_SECONDS,
    StatusArguments,
    ShellSessionArguments,
    _DESCRIPTIONS,
)


def test_上界够一条真实构建等完():
    """真机实测 build/check/test 都是 18~19 秒，30 秒一次等得完。"""
    assert PROJECT_WAIT_MAX_SECONDS >= 20, (
        f"上界 {PROJECT_WAIT_MAX_SECONDS} 秒等不完一条 19 秒的 build，"
        "模型只能反复轮询，每一轮都多烧一次模型往返（真机实测 12~20 秒/轮）"
    )
    StatusArguments(operationId="pop-1", waitSeconds=PROJECT_WAIT_MAX_SECONDS)
    ShellSessionArguments(id="pop-1", seconds=PROJECT_WAIT_MAX_SECONDS)


def test_两处合同用同一个上界():
    """⚠ 反向（§4）：分别写死两个数字，改一个就会静静地漂。"""
    with pytest.raises(Exception):
        StatusArguments(operationId="pop-1", waitSeconds=PROJECT_WAIT_MAX_SECONDS + 1)
    with pytest.raises(Exception):
        ShellSessionArguments(id="pop-1", seconds=PROJECT_WAIT_MAX_SECONDS + 1)


def test_模型看见的描述跟着改了():
    """⚠ 只改 Field 不改描述 = 模型仍以为上限是 5，等于没改。

    2026-09-18 前台等待秒数走 interpolate（抄 grok），盯生模板会绿、
    模型看见的还是 `{fg_block_secs}`。所以这里跑装配后的字符串。
    """
    from services.project_tool_contracts import (
        interpolate_description,
        SHELL_EXEC_FOREGROUND_BLOCK_SECONDS,
    )

    text = " ".join(interpolate_description(str(v)) for v in _DESCRIPTIONS.values())
    assert "max 5" not in text, (
        "描述里还写着 max 5——那是模型唯一看得见的上界，"
        "Field 放宽了它也不会用"
    )
    assert f"max {int(PROJECT_WAIT_MAX_SECONDS)}" in text
    assert "{fg_block_secs}" not in text
    assert f"about {int(SHELL_EXEC_FOREGROUND_BLOCK_SECONDS)}s" in text, (
        "shell_exec 描述没把前台默认等待秒数填进去，模型仍以为一交就是跑完"
    )
    assert "commandFinished" in text
    assert "is_background=true" in text


def test_退避让长等不再变成数据库风暴():
    """正向：前 2 秒仍然密（刚提交的活常常瞬间完），之后拉开。"""
    assert project_tools._wait_backoff(0.0) <= 0.15, "开头不密，瞬间完成的活要多等一拍"
    assert project_tools._wait_backoff(1.9) <= 0.15
    assert project_tools._wait_backoff(5.0) >= 0.4
    assert project_tools._wait_backoff(20.0) >= 0.9


def test_退避之后整段等待的查询次数是几十不是几百():
    """反向：写成常数 0.1 时这条会红——它才是「不许打风暴」的那条判据。

    直接按 _wait_backoff 走一遍 30 秒，数要查多少次。
    """
    elapsed, queries = 0.0, 0
    while elapsed < PROJECT_WAIT_MAX_SECONDS:
        elapsed += project_tools._wait_backoff(elapsed)
        queries += 1
    assert queries <= 60, (
        f"等满 {PROJECT_WAIT_MAX_SECONDS} 秒要查 {queries} 次。"
        "身份/工程存储是远程 HTTPS SQL 网关，这是把模型往返税换成了数据库风暴"
    )
    assert queries >= 20, "退避拉得太狠，活干完了还要等一大拍才发现"


def test_等待循环提前返回而不是死等满():
    """⚠ 这条是上面那个 30 秒之所以安全的**前提**。

    2026-09-18 又给 shell_exec 前台加了第三处等待。三处必须走同一个
    `_poll_operation`：再抄一份 while 就会漂（CLAUDE.md §4）。
    """
    import inspect

    source = inspect.getsource(project_tools)
    assert source.count("def _poll_operation") == 1
    assert source.count("self._poll_operation(") >= 3, (
        "project_status / shell_wait / shell_exec 少了一处走 _poll_operation。"
        "漏掉的那处会自己写一份循环，提前返回改了也不生效"
    )
    helper = inspect.getsource(project_tools.ProjectTools._poll_operation)
    assert "while operation.status not in _TERMINAL and time.monotonic() < deadline" in helper
    assert 'getattr(operation.runtime, "status", None) == "ready"' in helper
    assert source.count("while operation.status not in _TERMINAL and time.monotonic() < deadline") == 1, (
        "等待循环又抄了一份。没有提前返回的那份会把 30/120 秒死等满"
    )


def test_系统提示词把这两件事作为事实告诉模型():
    """⚠ 判据盯的是**发给模型的那份**，不是源码文本。

    源码里注释也含这些词，grep 源码的判据变异之后照样绿（CLAUDE.md §2 点名）。
    这里跑 `_system_prompt` 的产线源码，看装配出来的字符串。
    """
    from models.v5_state import V5SessionState
    from services import rehearsal_control

    state = V5SessionState(sessionId="s-1", goal={"text": "做个待办应用", "status": "clear"})
    prompt = rehearsal_control._system_prompt(state)
    assert "同一轮" in prompt and "一起" in prompt, (
        "提示词里没告诉模型可以一轮带齐——真机 34 轮里 27 轮只挑一件，"
        "每多一轮就多烧一次往返"
    )
    assert "立刻返回" in prompt, (
        "没告诉模型等待类工具会提前返回，它就不敢一次给足秒数，继续短轮询"
    )


def test_这两句不是写成流程命令():
    """⚠ 反向：本仓的教训是「写成命令模型就开始填答题卡」（2026-09-08 第 2 格）。

    只陈述能力和事实，不出现「必须 / 每次都要 / 先…再…」这类流程祈使。
    """
    from models.v5_state import V5SessionState
    from services import rehearsal_control

    prompt = rehearsal_control._system_prompt(
        V5SessionState(sessionId="s-2", goal={"text": "做个待办应用", "status": "clear"}))
    window = prompt[prompt.index("互不依赖的调用"):]
    window = window[:200]
    for bossy in ("必须合并", "每次都要", "不许分开", "总是先"):
        assert bossy not in window, f"这句写成了流程命令（{bossy}），会把模型推回填答题卡"
