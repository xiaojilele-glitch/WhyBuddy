"""工具结果回喂给模型之前必须有界，而且要说自己裁了。

抄的标准答案：
  grok-build `xai-grok-compaction/src/intra_compaction/fit.rs` 第 2 级台阶
      //! 2. ToolTruncated  only if still over: prefix-clip tool results
      //!                   that alone exceed budget (grok-build style:
      //!                   max_bytes = max_tokens * 4, no binary search)
  grok-build `xai-tool-types/src/task.rs`
      pub truncated: bool,
      /// Pre-resolved hint text for truncated output.
      pub truncation_hint: String,
      /// Raw output byte count before any truncation or soft-wrapping.
      pub raw_output_bytes: usize,

⚠ 2026-08-27 复审逮到的洞：控制面把工具结果**原样 json.dumps** append 进
  messages，一个长度约束都没有。`search_evidence` 的 hits 来自公网，一次胖
  搜索就能把下一发请求的提示词顶穿。而 8k 的 cheap 预算是**调用之后**才对账
  的，拦不住已经发出去的那一发——真顶穿了是网关 4xx，走 except 变成罐头，
  用户看到"控制面挂了"，真因却是我们自己把上下文塞爆了。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rehearsal_control import (  # noqa: E402
    CONTROL_TOOL_RESULT_MAX_CHARS,
    MAX_CHEAP_TOKENS,
    bound_tool_result,
)


def _fat() -> dict:
    return {"ok": True, "hits": [{"title": "x" * 300} for _ in range(200)]}


def test_短结果原样回喂_不许瞎改():
    """没超限就一个字都不动——裁剪是例外不是常态。"""
    body = {"ok": True, "summary": "找到两条"}
    assert json.loads(bound_tool_result(body)) == body


def test_胖结果被裁到上限以内():
    out = bound_tool_result(_fat())
    raw = json.dumps(_fat(), ensure_ascii=False)
    assert len(raw) > CONTROL_TOOL_RESULT_MAX_CHARS * 5, "夹具不够胖，测不到东西"
    # 裁完的整包（含 hint 那几个字段）仍应在同一数量级，不许是原文那么大
    assert len(out) < CONTROL_TOOL_RESULT_MAX_CHARS * 1.3, len(out)


def test_必须明说自己裁了():
    """不说的话模型会以为世界就这么大。

    搜出来二十条只喂进去三条，模型会当成"只找到三条"，然后据此下结论。
    变异：把 truncated 字段删掉 → 本条红。
    """
    d = json.loads(bound_tool_result(_fat()))
    assert d["truncated"] is True


def test_带一句能据以行动的提示():
    """抄 truncation_hint：光说"裁了"没法行动，得告诉模型下一步能干嘛。"""
    d = json.loads(bound_tool_result(_fat()))
    hint = d["truncationHint"]
    assert str(CONTROL_TOOL_RESULT_MAX_CHARS) in hint
    assert "查询词" in hint, "没告诉模型该怎么办"


def test_裁之前的真实大小要活下来():
    """抄 raw_output_bytes。

    裁完的字符串长度是**恒定的**——真实规模只能靠这个字段活下来。没有它，
    "搜出来 4 万字"和"搜出来 4 千字"在日志里长得一模一样。
    变异：把 rawChars 删掉 → 本条红。
    """
    d = json.loads(bound_tool_result(_fat()))
    raw = json.dumps(_fat(), ensure_ascii=False)
    assert d["rawChars"] == len(raw)
    assert d["rawChars"] > len(d["preview"])


def test_裁完还得是合法JSON():
    """前缀裁的是**内层文本**，外层必须仍能被模型当 JSON 读。

    直接对 json.dumps 的结果切一刀会得到半个对象——模型读到的是坏数据，
    而且不会报错，只会理解错。
    """
    d = json.loads(bound_tool_result(_fat()))  # 不抛就算过
    assert isinstance(d, dict) and "preview" in d


def test_八轮的量级对得上便宜预算():
    """上限不是拍脑袋：4000 字 ≈ 1000 token（grok 的 4 字节/token 口径），
    八轮正好落在 MAX_CHEAP_TOKENS 上。

    ⚠ 判据盯的是**这条推理还成立**，不是盯 4000 这个数字本身——调上限时
      这条会提醒你顺带看一眼预算，而不是拦着不让改。
    """
    rounds = 8
    approx_tokens = CONTROL_TOOL_RESULT_MAX_CHARS / 4 * rounds
    assert approx_tokens <= MAX_CHEAP_TOKENS * 1.05, (
        f"单个结果 {CONTROL_TOOL_RESULT_MAX_CHARS} 字 × {rounds} 轮 "
        f"≈ {approx_tokens:.0f} token，超过 cheap 预算 {MAX_CHEAP_TOKENS}"
    )


def test_接在回喂那一处_不是摆着好看():
    """通电：dispatch 循环必须走 bound_tool_result，不许裸 json.dumps。

    变异：把调用点改回 json.dumps(tool_body, ...) → 本条红。
    """
    import re
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    body = re.sub(r'"""[\s\S]*?"""', "", src)
    body = re.sub(r"#[^\n]*", "", body)
    assert '"content": bound_tool_result(' in body, "回喂那一处没接上"
    assert '"content": json.dumps(' not in body, "还留着裸 json.dumps 的回喂"
