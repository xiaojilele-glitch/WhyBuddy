# -*- coding: utf-8 -*-
"""单发 LLM 请求的读超时跟着 budget profile 走：对话档 45 秒、工程档 120 秒。

## 病是怎么看见的（2026-09-14 真机）

`artifacts/control-real-model/67d437a8`，真 LLM（grok-4.6）+ 真 E2B。
读窗放宽之后模型**一轮就把六个源文件全读完了**（这部分是好的），下一发请求
带着 ~32K 字源码去问"接下来怎么改"，推理模型想了 45 秒还没回，被客户端掐断：

    ReadTimeout after 45.2s (budget 45s)
    status=failed error=llm_unavailable   源码改动：0 处

45 秒来自 `sliderule_llm/control_client.py`：

    timeout_s = (timeout_ms or min(int(cfg.timeout_ms or 60000), 45_000)) / 1000.0

它是个**硬上限**——配置里写 60 秒也会被 min 压回 45。对"一句话聊天"够用，
对"读完整份源码再想怎么改"不够。而 `_invoke_control_llm` 从来不传
`timeout_ms`，于是工程档那条 180 秒墙钟的回合，每一发请求仍然只有 45 秒。

## 这三件事分别是什么，别混

    max_wall_seconds      一整个回合的墙钟      对话 45 / 工程 180
    max_request_seconds   **单发 HTTP** 读超时  对话 45 / 工程 120   ← 本文件
    MAX_RETRIES_PER_TURN  回合累计重试 10 次，窗口 600 秒

## 判据分三类

1. **活路径**（§1）——打在真 HTTP 上，看**真正到达客户端的那个数**，
   而且要看见它在 project_create 之后从 45000 切到 120000。
   只断言常量等于 120 证明不了它被传下去了（§3：名单里有名字 ≠ 埋点在）。
2. **老存档**——新字段故意不进 `to_wire()`；进了的话所有已存在的 checkpoint
   会当场 `invalid_control_budget_policy`。这条直接喂一份旧形状的存档。
3. **量级自洽**——单发超时必须装得进回合墙钟，否则墙钟永远轮不到生效。
"""

from __future__ import annotations

import pytest

from project_actor_support import project_actor  # noqa: F401
from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool
from services.control_budget import (
    PROJECT_BUDGET, PROJECT_BUDGET_V1, CONVERSATION_BUDGET, CONVERSATION_BUDGET_V2,
    ControlBudget, restore_budget,
)
from services.project_creation import create_session_project
from services.rehearsal_control import (MAX_CHEAP_TOKENS, MAX_REQUEST_SECONDS,
    MAX_TOOL_ROUNDS, MAX_WALL_SECONDS)
from services.slide_rule_session import load_session, save_session
from test_control_project_tools import post, setup  # noqa: F401

pytest.importorskip("fastapi")

LEGACY = ControlBudget("control-v1", MAX_TOOL_ROUNDS, MAX_CHEAP_TOKENS,
                       MAX_WALL_SECONDS, MAX_REQUEST_SECONDS)


def _timeouts(harness) -> list:
    """每一发请求实际带下去的 timeout_ms。没带就是 None（= 退回 45 秒默认）。"""
    return [call["kwargs"].get("timeout_ms") for call in harness.llm_calls]


# ── 一、活路径 ────────────────────────────────────────────────────────────


def test_工程档的每一发请求都拿到单发超时(setup, monkeypatch):
    """真 HTTP + 真 source store，工程会话已经建好 → 全程工程档。

    变异咬这条：把调用点的 `timeout_ms=loop_budget.request_timeout_ms()`
    删掉 → 每一发都是 None，本条红。
    """
    create_session_project(setup.store, setup.state.sessionId,
                           owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)

    def model(messages, **kwargs):
        if not any(m["role"] == "tool" for m in messages):
            return llm_tool("project_status", {})
        return llm_text("读完了。")

    harness.llm_impl = model
    post(setup.state)

    assert _timeouts(harness) == [PROJECT_BUDGET.request_timeout_ms()] * len(harness.llm_calls)
    assert PROJECT_BUDGET.request_timeout_ms() == 3_600_000


def test_批准后第一发就是工程档超时(setup, monkeypatch):
    """ExitPlanMode：批准后不必等 project_create，单发超时就是工程档。

    变异：eligible 仍要等到工程指针 → 第一发退回对话档 600s，本条红。
    """
    harness = ControlHarness(monkeypatch)

    def model(messages, **kwargs):
        results = [m for m in messages if m["role"] == "tool"]
        if not results:
            return llm_tool("project_create", {"approvalRef": setup.ref})
        return llm_text("工程已就绪。")

    harness.llm_impl = model
    post(setup.state)

    seen = _timeouts(harness)
    assert seen
    assert seen[0] == PROJECT_BUDGET.request_timeout_ms() == 3_600_000
    assert all(item == PROJECT_BUDGET.request_timeout_ms() for item in seen)


def test_反向_未批准对话回合不许被顺手放宽(setup, monkeypatch):
    """没批准的普通对话回合仍是对话档超时。

    放宽单发超时是有代价的，只给批准后的执行档。
    """
    state = load_session(setup.state.sessionId)
    state.controlTranscript = []
    save_session(state)
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda messages, **kw: llm_text("你好。")
    post(setup.state)

    assert _timeouts(harness) == [CONVERSATION_BUDGET.request_timeout_ms()]
    assert CONVERSATION_BUDGET.request_timeout_ms() == 600_000


# ── 二、老存档不许失效 ────────────────────────────────────────────────────


def test_老存档不许因为多了这个字段而失效():
    """`to_wire()` 是**校验**契约：`restore_budget` 拿
    `set(snapshot) != set(policy.to_wire())` 卡存档。

    新字段一旦进了 wire，所有**已经存在的 checkpoint**（四个键）会当场变成
    `invalid_control_budget_policy` → `control_reconciliation_required`，
    正在跑的 run 全被判成需要人工对账。

    变异：把 `max_request_seconds` 加进 `to_wire()` → 本条红。
    """
    old = {"profile": "project-v1", "maxRounds": 16,
           "maxTokens": 64_000, "maxWallSeconds": 180.0}
    assert set(old) == set(PROJECT_BUDGET.to_wire())
    restored = restore_budget(old, LEGACY)
    # 老存档照样能还原，而且**拿得到** v1 的 120 秒——不许因为部署了 v2
    # 就把 600 秒/20 万窗口发给旧 run。
    assert restored is PROJECT_BUDGET_V1
    assert restored.request_timeout_ms() == 120_000
    assert restored.max_tokens == 64_000
    assert restore_budget(PROJECT_BUDGET.to_wire(), LEGACY) is PROJECT_BUDGET
    assert PROJECT_BUDGET.request_timeout_ms() == 3_600_000
    assert restore_budget(CONVERSATION_BUDGET_V2.to_wire(), LEGACY) is CONVERSATION_BUDGET_V2
    assert CONVERSATION_BUDGET_V2.request_timeout_ms() == 180_000

    old_legacy = {"profile": "control-v1", "maxRounds": MAX_TOOL_ROUNDS,
                  "maxTokens": MAX_CHEAP_TOKENS, "maxWallSeconds": MAX_WALL_SECONDS}
    assert restore_budget(old_legacy, LEGACY).request_timeout_ms() == 75_000


def test_伪造的存档照旧被拒():
    """反向：别为了兼容老存档把校验放松了。"""
    for forged in (
        {"profile": "project-v1", "maxRounds": 16, "maxTokens": 999_999_999,
         "maxWallSeconds": 180.0},
        {"profile": "client-unlimited", "maxRounds": 16, "maxTokens": 64_000,
         "maxWallSeconds": 180.0},
        # 想靠多塞一个键把超时抬上去 —— wire 不认它
        {"profile": "project-v1", "maxRounds": 16, "maxTokens": 64_000,
         "maxWallSeconds": 180.0, "maxRequestSeconds": 999.0},
    ):
        with pytest.raises(ValueError, match="invalid_control_budget_policy"):
            restore_budget(forged, LEGACY)


# ── 三、量级自洽 ──────────────────────────────────────────────────────────


def test_单发超时必须装得进回合墙钟():
    """单发超时 ≥ 回合墙钟 = 墙钟永远轮不到生效，回合只会以 llm_unavailable 收场。

    §一之二：护栏装在真跑的路上、条件恒假的又一种形态。
    """
    for budget in (PROJECT_BUDGET, PROJECT_BUDGET_V1, CONVERSATION_BUDGET, LEGACY):
        assert budget.max_request_seconds <= budget.max_wall_seconds, budget
    # 工程档要留出余地：读完源码那一发想满单发超时，后面还得有时间改。
    assert PROJECT_BUDGET.max_wall_seconds - PROJECT_BUDGET.max_request_seconds >= 60
    assert PROJECT_BUDGET_V1.max_wall_seconds - PROJECT_BUDGET_V1.max_request_seconds >= 60
    assert CONVERSATION_BUDGET.max_wall_seconds - CONVERSATION_BUDGET.max_request_seconds >= 60


def test_工程档比对话档宽_而且真的是它需要宽():
    assert PROJECT_BUDGET.max_request_seconds > CONVERSATION_BUDGET.max_request_seconds
    assert CONVERSATION_BUDGET.max_request_seconds > LEGACY.max_request_seconds
    # ⚠ 2026-09-14 从 45 抬到 75：45 秒写不完一份实施计划。
    # ⚠ 2026-09-15 75/90 仍把 ~150s 的写计划掐死，当时新回合走 control-v2。
    # ⚠ 2026-09-18 再开 control-v3：单发 600，工程档单发再放到 3600。
    assert LEGACY.max_request_seconds == MAX_REQUEST_SECONDS == 75.0
    assert CONVERSATION_BUDGET_V2.max_request_seconds == 180.0
    assert CONVERSATION_BUDGET.max_request_seconds == 600.0


def test_客户端不许把显式传下来的值再压回45秒():
    """`timeout_s = (timeout_ms or min(cfg..., 45_000)) / 1000`

    那个 `min` 只兜**没传**的情况。要是哪天有人把它写成
    `min(timeout_ms or cfg..., 45_000)`，上面所有活路径判据仍然全绿
    （参数确实传下去了），而真机上超时依旧是 45 秒——这条盯的就是那个形态。
    """
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(
        Path(__file__).resolve().parents[1] / "sliderule_llm" / "control_client.py"
    )
    assert "timeout_s = (timeout_ms or min(int(cfg.timeout_ms or 60000), 45000)) / 1000.0" in src
