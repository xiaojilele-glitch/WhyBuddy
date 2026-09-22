"""历史欠账台账本身的判据。

抄的标准答案：grok-build `xai-grok-pager-pty-harness/src/scroll_matrix/runner.rs`
的 xfail 契约——**XPass 也算失败**：

    /// XPASS row detail: the actionable half of the xfail contract.
    const XPASS_DETAIL: &str = "expected to violate (xfail) but PASSED — the pinned bug got fixed
                                or the cell rotted; promote the invariant out of the xfail set";

一张"已知红"的名单，最危险的失效方式不是漏了一条，是**悄悄多留一条**：
bug 修好了、名单没摘，于是那条判据从此不再守任何东西，而全量跑照样绿。
所以下面几条盯的都是名单本身会不会烂，不是名单里那 10 条的内容。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from known_failures import KNOWN_FAILURES  # noqa: E402

_TESTS = Path(__file__).resolve().parent


def _hook():
    """拿到 conftest 里那两个真家伙，不复制一份实现。"""
    import conftest  # noqa: PLC0415

    return conftest.pytest_collection_modifyitems, conftest._ledger_key


class _FakeItem:
    """只长 nodeid 和 add_marker 的假 item——够 hook 用了。"""

    def __init__(self, nodeid: str) -> None:
        self.nodeid = nodeid
        self.marks: list = []

    def add_marker(self, mark) -> None:
        self.marks.append(mark)


def test_the_ledger_marks_are_strict():
    """钉住的红必须是 `strict=True`。

    这是整份台账的**要害**。少了 strict，修好的那条会以 XPASS 静静地过去，
    名单只增不减，最后变成一块谁也不敢碰的免检区——正是 grok 那句
    "fixed/rotted xfail must be promoted, not absorbed" 要防的。

    变异：把 strict=True 去掉 → 本条红。
    """
    modify, _ = _hook()
    listed = next(iter(KNOWN_FAILURES))
    item = _FakeItem(f"tests/{listed}")
    modify(None, [item])
    assert len(item.marks) == 1, "台账里的用例没被打上标记"
    mark = item.marks[0]
    assert mark.name == "xfail"
    assert mark.kwargs.get("strict") is True, "不是 strict——修好了也不会有人知道"
    assert "known_failures" in str(mark.kwargs.get("reason", "")), (
        "理由里没指回台账，下一个人看到 XFAIL 不知道去哪儿查"
    )


def test_untracked_tests_are_left_alone():
    """反向：不在名单里的用例一个标记都不许加。

    没有这一条，把 hook 写成"给所有人打 xfail"也能让上一条绿——那就等于
    整个套件变成免检区（CLAUDE.md §3：每写一条"应该有 X"，配一条"不该有 Y"）。
    """
    modify, _ = _hook()
    item = _FakeItem("tests/test_definitely_not_in_the_ledger.py::test_nope")
    modify(None, [item])
    assert item.marks == []


def test_ledger_key_survives_both_ways_of_running_pytest():
    """两种起跑方式下 nodeid 不同，台账都得认。

    ⚠ 这不是假想：CLAUDE.md「常用命令」写的是在**仓根**跑
      `slide-rule-python/.venv/bin/python -m pytest slide-rule-python/tests/`，
      而在 slide-rule-python/ 里跑同一条用例 nodeid 少了前缀。写死任一种，
      另一种调用方式下整张名单**静默失效**——不报错，10 条红原样红回来。
    """
    _, key = _hook()
    listed = next(iter(KNOWN_FAILURES))
    assert key(f"tests/{listed}") == listed
    assert key(f"slide-rule-python/tests/{listed}") == listed
    assert key(f"/abs/path/slide-rule-python/tests/{listed}") == listed
    # 不含 tests/ 的原样返回，不许瞎裁
    assert key("weird::id") == "weird::id"


@pytest.mark.parametrize("nodeid", sorted(KNOWN_FAILURES))
def test_every_ledger_entry_still_points_at_a_real_test(nodeid: str):
    """名单里的每一条都得指向真实存在的用例。

    改名/删掉一条被钉住的用例，名单里那行就成了死条目：它不再让任何东西
    xfail，却让人以为"这条还欠着"。台账烂掉的第一步就是这个。
    """
    file_part, _, rest = nodeid.partition("::")
    path = _TESTS / file_part
    assert path.exists(), f"台账指向的文件不在了：{file_part}"
    body = path.read_text(encoding="utf-8")
    for name in rest.split("::"):
        stem = name.split("[")[0]  # 去掉 parametrize 的 id
        assert re.search(rf"(def|class)\s+{re.escape(stem)}\b", body), (
            f"{file_part} 里找不到 {stem}——改过名？台账那行已经是死条目"
        )


@pytest.mark.parametrize("nodeid", sorted(KNOWN_FAILURES))
def test_every_ledger_entry_says_why(nodeid: str):
    """每条都得写清红在哪。写不清说明还没看，那就别往里加。"""
    why = KNOWN_FAILURES[nodeid]
    assert len(why) >= 12, f"{nodeid} 的说明太短，等于没写"


def test_the_ledger_really_turns_a_known_red_into_xfail():
    """通电：真跑一次，名单里的红必须变成 xfailed，而不是 failed。

    前面几条都是拿假 item 直接调 hook——证明的是 hook 本身对。这一条起一个
    真 pytest 子进程，证明它**接在收集链路上**（CLAUDE.md §1：改之前先确认
    这条链真的在跑）。

    变异：把 conftest 里的 pytest_collection_modifyitems 改名 → 本条红。
    """
    listed = next(
        n for n in KNOWN_FAILURES if n.startswith("test_no_blocking_io_on_event_loop.py")
    )
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", f"tests/{listed}", "-q", "--no-header"],
        cwd=str(_TESTS.parent),
        capture_output=True,
        text=True,
        # ⚠ 2026-09-06 补 encoding/errors。子进程打的是**中文用例名**，
        #   `text=True` 不给 encoding 就按本地代码页解（Windows 是 cp936），
        #   解不动 → 读取线程抛 UnicodeDecodeError → `proc.stdout` 变成 None
        #   → 这条报的是 `TypeError: argument of type 'NoneType' is not
        #   iterable`，**看起来像台账坏了**，而台账是好的。
        #   这是本仓「判据自己出的错被当成被测对象的病」那个形状。
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )
    assert proc.returncode == 0, f"台账没生效，这条还是红的：\n{proc.stdout[-1500:]}"
    assert "xfailed" in proc.stdout, proc.stdout[-1500:]
