# -*- coding: utf-8 -*-
"""不带 goal 建的会话，goal 必须是空，不许是占位串。

## 事故（2026-09-08，`scripts/run_real_topics.py` 第一条真实话题）

`POST /sessions` 的兜底曾是字面量 "default"：

    goal_text = payload.get("goal", {}).get("text", "default")

省掉 goal 的调用方于是拿到一个**叫「default」的产品**。下游没有一处
知道它是占位符：`_has_product_topic` 看它非空、又不在确认词表里，判真；
控制面据此把 `scope_card` / `search_evidence` 摆给模型；模型开卡、
自动授予、`capabilityPlan=product-rehearsal tools=spec`——

    [control] goal='default' offered=['ask_user','scope_card','search_evidence']
              picked=['scope_card']
    [spec_first_pipeline] capabilityPlan=product-rehearsal tools=spec
    [enrich-timing] stage=specfirst.spec ms=25294 ok=1 pages=1 nodes=4

**一句「你好」真去起草了 SPEC**，25 秒 LLM，事件流里连 complete 都没有。

前端发的是 `{"goal":{"text":""}}`，所以产品路径没踩到——踩到的是任何省掉
goal 的调用方。占位串放进语义字段就是这个形状：不报错，只在下游被当成真的。

正反一对：
  · 省掉 goal   → 空（本条）
  · 显式给 goal → 原样保留（反向，否则"永远返回空"也能全绿）
"""
from __future__ import annotations

import pytest

from models.v5_state import V5SessionState
from services.rehearsal_control import _has_product_topic, should_list_tool

pytest.importorskip("fastapi")


def _goal_text_from_payload(payload: dict) -> str:
    """跟 `routes/sliderule_full.create_sess` 同一行。改那边不改这里 = 本条红。"""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1] / "routes" / "sliderule_full.py"
    ).read_text(encoding="utf-8")
    assert 'goal_text = payload.get("goal", {}).get("text", "default")' not in src, (
        "建会话的兜底又变回字面量 default 了"
    )
    return payload.get("goal", {}).get("text", "") or ""


def test_missing_goal_becomes_empty_not_a_placeholder():
    assert _goal_text_from_payload({"sessionId": "s1"}) == ""


def test_explicit_goal_survives():
    """反向：不是"永远返回空"。"""
    assert _goal_text_from_payload({"goal": {"text": "做个水果店收银台"}}) == (
        "做个水果店收银台"
    )
    assert _goal_text_from_payload({"goal": {"text": ""}}) == ""


def test_placeholder_goal_would_have_opened_the_factory_door():
    """把占位串塞回 goal，控制面就会把开工工具摆出来——这才是它贵在哪。

    这条不是在测 "default" 这个词，是在测**任何非空占位串**都会被当成产品。
    """
    empty = V5SessionState(
        sessionId="p-empty", goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": "你好"}],
    )
    placeholder = V5SessionState(
        sessionId="p-holder", goal={"text": "default", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": "你好"}],
    )
    assert _has_product_topic(empty) is False
    assert _has_product_topic(placeholder) is True, "占位串被当成了真产品"

    # ⚠ 2026-09-09 照 grok 改：清单不猜意图（`ListToolsContext` 里没有用户消息，grok 全仓只有 3 处管道层覆写 `should_list`）。保证挪到分发层——模型硬挑 scope_card 也不画卡，只再问一句。
    #   scope_card 现在两种情况都列，区分不出占位串；能区分的是
    #   search_evidence（它按「有没有记下的产品」列，那是前提不是意图）。
    assert should_list_tool("search_evidence", empty) is False
    # 反向：占位串在场时它确实会被摆出来——这就是「你好」点着工厂的那一步。
    assert should_list_tool("search_evidence", placeholder) is True
