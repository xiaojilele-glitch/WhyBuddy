"""执行器事件词表：Python 与 TS 那份契约必须一字不差（2026-08-28 架构对账补的）。

## 为什么补这一条

`executor_event_projection.py` 的注释写着「Contract constants
(shared/executor/contracts.ts)」——**注释说了，但没有任何东西保证**。

本仓给同类词表都上过闸：
  · BLOCK_KINDS        → test_page_kind_contract_scope.py（Python 判据直接读 TS 文件）
  · RECORD/WORKFLOW_ACTION_KINDS → test_html_bindings_record_scope.py

唯独执行器这份漏了。漂了的后果跟那几个一样：Node 那边发一个 Python 不认的
事件类型，投影就静默少一条；Python 加一个 TS 不认的，前端 switch 直接丢
（`default: return "continue"`，连日志都没有）。CLAUDE.md §4 的「生成侧 /
消费侧改一半」，跨进程版本。

## 判据形状照已有那两条：Python 读 TS 文件，不手抄第二份

⚠ 手抄一份期望值放在判据里，等于把同一张表写了**第三遍**——那样判据自己
  就是下一个漂移源。所以从 TS 源文件里解析出来比。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.executor_event_projection import (  # noqa: E402
    EXECUTOR_EVENT_TYPES,
    STATE_CHANGING_EXECUTOR_EVENT_TYPES,
    STREAMING_EXECUTOR_EVENT_TYPES,
    TERMINAL_EXECUTOR_STATUSES,
)

_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "shared",
    "executor",
    "contracts.ts",
)


def _ts_list(name: str) -> list:
    """从 TS 契约里解析出一个 `export const NAME = [...]`。

    ⚠ 解析不到就 fail，**不许返回空表**。空表会让下面的比较空过——
    判据打空是本仓点名的形状（CLAUDE.md §2）。
    """
    with open(_TS, encoding="utf-8") as fh:
        src = fh.read()
    # 剥注释：本仓踩过"判据 grep 到的词其实在注释里"
    code = "\n".join(
        line
        for line in src.splitlines()
        if not line.strip().startswith(("//", "*", "/*"))
    )
    m = re.search(rf"export const {name}\s*(?::[^=]+)?=\s*\[(.*?)\]", code, re.S)
    assert m, f"{name} 在 {_TS} 里找不到——契约改名了？判据要跟着改，不能静默放行"
    vals = re.findall(r'"([^"]+)"', m.group(1))
    assert vals, f"{name} 解析出来是空的——正则失配，判据会空过"
    return vals


class Test两边一字不差:
    def test_事件类型完全一致(self):
        assert list(EXECUTOR_EVENT_TYPES) == _ts_list("EXECUTOR_EVENT_TYPES")

    def test_顺序也一致(self):
        """⚠ 不只比集合。这份表在两边都被当**有序**用（TS 那边导出
        `(typeof EXECUTOR_EVENT_TYPES)[number]` 当类型，Python 侧按序遍历），
        只比集合会漏掉"顺序换了"这一类。"""
        assert tuple(EXECUTOR_EVENT_TYPES) == tuple(_ts_list("EXECUTOR_EVENT_TYPES"))


class Test子表都是总表的子集:
    """⚠ 反向判据：两边一致 ≠ 表自己是自洽的。

    子表里出现一个总表没有的词，两边"一致"照样成立，而那个词永远不会被
    投影处理——又一个"闸全绿但东西没了"。
    """

    @pytest.mark.parametrize(
        "name,sub",
        [
            ("STATE_CHANGING", STATE_CHANGING_EXECUTOR_EVENT_TYPES),
            ("STREAMING", STREAMING_EXECUTOR_EVENT_TYPES),
        ],
    )
    def test_子表不许有总表外的词(self, name, sub):
        extra = [t for t in sub if t not in EXECUTOR_EVENT_TYPES]
        assert extra == [], f"{name} 里有总表没有的事件类型：{extra}"

    def test_两个子表不重叠(self):
        """状态变更走 Python 投影、流式留在 Node 内联（见 Python 侧注释）。
        一个类型同时进两边 = 同一件事被处理两遍。"""
        both = set(STATE_CHANGING_EXECUTOR_EVENT_TYPES) & set(
            STREAMING_EXECUTOR_EVENT_TYPES
        )
        assert both == set(), f"这些类型两条路都走：{sorted(both)}"

    def test_终态状态词跟事件类型对得上(self):
        """`job.completed` → 状态 `completed`。两边各写一份，漏一个就是
        "跑完了但状态没落终态"。"""
        from_events = {
            t.split(".", 1)[1]
            for t in EXECUTOR_EVENT_TYPES
            if t.split(".", 1)[1] in ("completed", "failed", "cancelled")
        }
        assert from_events == set(TERMINAL_EXECUTOR_STATUSES)
