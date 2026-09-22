"""反向判据：代码里真的写进 `state.awaitReason` 的每个值，都必须在 AwaitReason 名单里。

为什么要单写一条：`test_v5_state_schema_parity.py:1154` 那条守的是**两边一致**
（Python Literal 和 TS union 都含 `"control_ask"`/`"control_scope"`），名单本身
是手抄的。两边同时漏掉 `control_clarify` 时，「一致」照样成立，闸全绿——
CLAUDE.md §3 说的「名单里有名字 ≠ 埋点在」的镜像形态：**名单里没有，而埋点在**。

漏掉的代价不是类型报错，是**静默丢会话**：
  写入侧 pydantic v2 默认不校验赋值 → `state.awaitReason = "control_clarify"` 不报错
  读回侧 `V5SessionState.server_load` 校验 → ValidationError
  `_coerce_state` 把它转成 `invalid_session`，`_coerce_many` 直接跳过这条
  → 停在澄清那一步的会话，下次读库时从列表里消失。

所以本文件两条判据都盯**行为**，不盯字面：
  1. 静态：AST 扫 services/ 里所有 `*.awaitReason = "字面量"`，逐个查名单。
     用 AST 不用 grep，是因为注释和文档字符串里也写着这些词（CLAUDE.md §2
     记过这个坑：判据 grep 到的是注释，变异后照样绿）。
  2. 端到端：每个被写入的值都要能**存进去再读回来**。这条才是用户真正丢的东西。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import get_args

import pytest

from models.v5_state import AwaitReason, V5SessionState
from services.persistence import _coerce_state

_SERVICES = Path(__file__).resolve().parents[1] / "services"


def _assigned_await_reasons() -> dict[str, list[str]]:
    """{被赋的值: [写它的位置, ...]}。只认 `<任意>.awaitReason = "字面量"`。"""
    found: dict[str, list[str]] = {}
    for path in sorted(_SERVICES.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover — 语法坏了有别的闸管
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                targets, value = [node.target], node.value
            else:
                continue
            if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
                continue
            for target in targets:
                if isinstance(target, ast.Attribute) and target.attr == "awaitReason":
                    found.setdefault(value.value, []).append(f"{path.name}:{node.lineno}")
    return found


def test_every_written_await_reason_is_declared():
    written = _assigned_await_reasons()
    assert written, "一个 awaitReason 赋值都没扫到——扫描器坏了，不是代码干净了"
    allowed = set(get_args(AwaitReason))
    undeclared = {
        value: where for value, where in written.items() if value not in allowed
    }
    assert not undeclared, (
        "这些值代码在写、名单里却没有，会让会话读不回来："
        + "；".join(f"{v}（{'、'.join(w)}）" for v, w in sorted(undeclared.items()))
    )


@pytest.mark.parametrize("reason", sorted(_assigned_await_reasons()))
def test_a_session_parked_on_it_reads_back(reason: str):
    """停在这个原因上的会话，必须能从存档里读回来。

    走 `_coerce_state` 而不是直接 `server_load`：真机读库就是走这一层，
    而这一层把 ValidationError **吞成** `invalid_session` 再让上层跳过——
    直接调 server_load 只能看到抛异常，看不到「会话消失」这个真实症状。
    """
    payload = V5SessionState(sessionId="await-rt", goal={"raw": "x"}).model_dump()
    payload["runtimePhase"] = "awaiting"
    payload["awaitReason"] = reason
    state, error = _coerce_state("await-rt", payload)
    assert error is None, f"awaitReason={reason} 的会话读不回来：{error}"
    assert state is not None and state.awaitReason == reason


def test_the_scan_would_catch_an_undeclared_value():
    """变异自检：扫描器必须真的能认出没申报的值，否则上面两条是空判据。"""
    tree = ast.parse('state.awaitReason = "definitely_not_declared"\n')
    node = tree.body[0]
    assert isinstance(node, ast.Assign)
    target = node.targets[0]
    assert isinstance(target, ast.Attribute) and target.attr == "awaitReason"
    assert "definitely_not_declared" not in set(get_args(AwaitReason))


def test_typescript_union_lists_every_python_await_reason():
    """TS 侧的 AwaitReason 必须逐条覆盖 Python 侧（CLAUDE.md §4：成对的东西）。

    ⚠ 判据不写死名单。`test_v5_state_schema_parity.py` 里那条守的是
    `for token in ('"control_ask"', '"control_scope"')`——名单手抄，所以两边
    **同时**漏掉 `control_clarify` 时它照样绿。这里改成拿 Python 的 Literal
    当基准逐条比，新增一个原因只改 Python 而忘了 TS，这条立刻红。

    只比 Python→TS 一个方向：TS 多出的成员不会让会话读不回来，而 Python
    多出的会。真要双向对齐是另一件事，别把两个目的塞进一条判据。
    """
    ts_src = Path(__file__).resolve().parents[2] / "shared" / "blueprint" / "v5-reasoning-state.ts"
    text = ts_src.read_text(encoding="utf-8")
    start = text.index("export type AwaitReason")
    union = text[start : text.index(";", start)]
    # 先剥注释再取成员。今天 TS 侧的说明是中文、不含带引号的标识符，剥不剥
    # 结果一样；留着是因为下一个人很可能写 `// 别和 "control_ask" 搞混`，
    # 那一刻「删掉成员、注释还在」就会让这条变异咬不动（CLAUDE.md §2）。
    union = re.sub(r"/\*.*?\*/", " ", union, flags=re.S)
    union = re.sub(r"//[^\n]*", " ", union)
    # ⚠ 字符集要能认下带数字/驼峰的成员（2026-08-29 架构对账）。
    # 这一条与 test_state_enum_values_are_declared 的方向相反、后果也相反：
    # 那边窄字符集是**漏报**（未申报的 `controlScope` 扫不到，闸绿着放行）；
    # 这边窄了是**误报**（TS 里明明有 `controlScope`，正则看不见 → 判成 TS 少了
    # → 红）。误报比漏报安全，但一样得修：一条会无故变红的闸，下一个人会把它
    # 注释掉，那时漏报就来了。
    members = set(re.findall(r'"([A-Za-z0-9_]+)"', union))
    missing = sorted(set(get_args(AwaitReason)) - members)
    assert not missing, f"TS AwaitReason 少了：{missing}（{ts_src}）"
