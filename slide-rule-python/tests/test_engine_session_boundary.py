# -*- coding: utf-8 -*-
"""引擎 ⇄ 会话文件这条边：已经拆了，这里钉住它别长回来（2026-08-29）。

## 这条边曾经是最后一个组间环的全部内容

`drive ⇄ model_core`，2026-08-29 一路量下来：

    21 条  → 7 条   本轮运行控制面（取消/暂停/降级/重复）单独成 run_control crate
    7 条   → 6 条   `model_version_restore` 归组归错了（第五次栽在名字前缀上）
    6 条   → 0 条   回合机制那 20 个函数搬去 `services/engine_scheduling.py`

## ⚠ 本文件的上一版是「立判据代替修复」，而那个决定建立在一个没做的测量上

上一版模块头写着不拆的理由：

> 那 7 个函数又用到同文件里另外 13 个模块级 helper……要动的是 1101 行里的
> 700 多行——那不是搬家，是把这个文件劈成两半。

**"700 多行"是估的。** 真按传递闭包数了一遍：

    引擎侧  20 个函数  541 行   连续占据文件末尾（477–1101），切口是一刀直的
    存储侧  12 个函数  402 行
    两侧共用的 helper：**0 个**

零重叠。而且那些函数自己的注释里写着它们当初为什么在那儿：

    # Moved into allowed file (slide_rule_session.py) for this task to respect
    # Allowed files boundary.

——**是某一轮任务的可改文件白名单把它们挤进来的**，从来不是归属判断。

上一版还立了一条 `Test那七个函数确实还缠在一起`，说「哪天缠绕解开了这条会红，
那是好消息」。它从来没红过，因为**缠绕根本不存在**：判据量的是"引擎侧用了多少
helper"（13 个，真的），而该量的是"这 13 个是不是也被存储侧用"（0 个）。
量对了方向，结论就翻过来了。这是本仓第五次「错的测量让我少做该做的事」
（前四次见 docs/欠缺模块清单-对照Claude与Grok-build.md §29.4 / §30.2）。

## 所以现在钉的是三条反向判据

拆完之后最容易发生的事不是"再拆一次"，是**悄悄长回去**：谁在 `v5_full_driver`
里补一行 `from .slide_rule_session import ...`，环就回来了，而且不会报错。
"""

from __future__ import annotations

import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: 回合机制的全部入口。它们现在的家是 `services/engine_scheduling.py`。
SCHEDULING = {
    "pick_next_capabilities",       # 213 行，排程主路径
    "pick_repair_capabilities",     # 44 行
    "commit_artifact",              # 80 行
    "record_capability_run_error",  # 38 行
    "append_reasoning_event",       # 32 行
    "append_replay_event",          # 28 行
    "_is_delivery_intent",          # 6 行
}

#: `slide_rule_session` 允许从 engine_scheduling 顶层 import 回来的名字。
#: **只许是 `drive_reasoning_turn`（本文件里 177 行的单轮驱动）真的用到的那些。**
#: 多一个就说明有别的东西在拿会话文件当引擎的门面——那正是拆之前的病。
SESSION_MAY_REEXPORT = {
    "append_reasoning_event",
    "append_replay_event",
    "commit_artifact",
    "pick_next_capabilities",
    "record_capability_run_error",
}


def _imports_from(path: pathlib.Path, module: str) -> set[str]:
    """`path` 从 `module` import 了哪些名字。顶层与函数体内一视同仁——
    函数体内 import 是这仓绕环的标准手法，只数顶层等于给了一句话绕过的办法。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and (n.module or "").endswith(module):
            out.update(a.name for a in n.names)
    return out


class Test引擎不再从会话文件拿东西:
    """⚠ 反向判据。这是环有没有长回来的唯一判据。"""

    def test_v5_full_driver_一个名字都不从_slide_rule_session_拿(self):
        got = _imports_from(ROOT / "services" / "v5_full_driver.py", "slide_rule_session")
        assert not got, (
            f"引擎又从 slide_rule_session 拿了：{sorted(got)}。\n"
            f"这条边就是 `drive ⇄ model_core` 那个环——它 2026-08-29 才被拆掉，"
            f"补一行 import 就能让它整个回来，而且 Python 不会报错。\n"
            f"回合机制在 services/engine_scheduling.py，从那里拿。"
        )

    def test_路由层也从新家拿排程函数(self):
        """⚠ CLAUDE.md 第四条：同一件事的第二处。只改驱动器不改路由，
        路由会继续把会话文件当引擎门面用，而闸看不见（routes → drive 是合法边）。"""
        got = _imports_from(ROOT / "routes" / "sliderule_full.py", "slide_rule_session")
        leaked = sorted(got & SCHEDULING)
        assert not leaked, (
            f"路由还在从 slide_rule_session 拿排程函数：{leaked}。改成 services.engine_scheduling。"
        )


class Test新家不许反向依赖回去:
    """⚠ 反向判据。engine_scheduling 一旦 import slide_rule_session，
    环就换个方向重新成立，而且这次更难看出来。"""

    def test_engine_scheduling_不import_slide_rule_session(self):
        got = _imports_from(ROOT / "services" / "engine_scheduling.py", "slide_rule_session")
        assert not got, (
            f"engine_scheduling 反向依赖了会话文件：{sorted(got)}。\n"
            f"它要读写会话就说明拆错了地方——回合机制不该需要会话存储，"
            f"是调用方把 state 传进来。"
        )

    def test_排程函数确实都在新家(self):
        """正向判据。配合上面三条反向的——光证明"旧地方没有了"不够，
        还得证明"新地方真有"，否则删掉整个文件也能让上面全绿。"""
        tree = ast.parse((ROOT / "services" / "engine_scheduling.py").read_text(encoding="utf-8"))
        defined = {
            n.name
            for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        missing = sorted(SCHEDULING - defined)
        assert not missing, f"这些排程函数不在 engine_scheduling 里：{missing}"


class Test会话文件不许变成引擎的门面:
    def test_回export的名字只许是drive_reasoning_turn用到的(self):
        """⚠ 棘轮。`slide_rule_session` 顶层 import 这几个是有理由的
        （`drive_reasoning_turn` 要用，且顶层 import 让既有的
        `monkeypatch.setattr("services.slide_rule_session.pick_next_capabilities", …)`
        仍然拦得住）。但名单只许变短——变长就是有人在拿它当门面。"""
        got = _imports_from(ROOT / "services" / "slide_rule_session.py", "engine_scheduling")
        extra = sorted(got - SESSION_MAY_REEXPORT)
        assert not extra, (
            f"slide_rule_session 多 import 了：{extra}。\n"
            f"先问那个调用方是不是也该搬去 engine_scheduling——"
            f"这个文件是会话存储，不是引擎的门面。"
        )

    def test_名单只许变短(self):
        """⚠ 反向判据。哪天 drive_reasoning_turn 不用某个了，名单要跟着删，
        否则下一个人以为那条依赖还在（同 baseline 只许变短）。"""
        got = _imports_from(ROOT / "services" / "slide_rule_session.py", "engine_scheduling")
        stale = sorted(SESSION_MAY_REEXPORT - got)
        assert not stale, f"这些已经不用了，从 SESSION_MAY_REEXPORT 里删掉：{stale}"

    def test_会话文件里不再定义排程函数(self):
        """⚠ 这条挡的是"搬了一半"：函数搬走了但留了个同名包装在原地。"""
        tree = ast.parse((ROOT / "services" / "slide_rule_session.py").read_text(encoding="utf-8"))
        defined = {
            n.name
            for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        leftover = sorted(defined & SCHEDULING)
        assert not leftover, (
            f"这些排程函数又在会话文件里定义了：{leftover}——搬家搬了一半，"
            f"两份实现会各自漂移，那是本仓踩过三次的坑。"
        )
