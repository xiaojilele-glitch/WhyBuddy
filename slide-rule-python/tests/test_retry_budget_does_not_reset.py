# -*- coding: utf-8 -*-
"""一个回合的累计重试预算：中途永不清零。

抄的标准答案：grok-build
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs`

    MAX_TRANSIENT_TURN_RETRIES        = 3    每步，成功后清零
    MAX_TRANSIENT_RETRIES_PER_PROMPT  = 10   整个 prompt 累计，**中途永不清零**
    MAX_TRANSIENT_RETRY_WINDOW        = 10 分钟

第二层在 grok 里存在 actor 的 `Cell` 上，**不是循环局部变量**——那不是实现
细节，那就是这一层的全部意义。

## 改造前的洞

`call_control_llm` 每次调用重试 3 次；一个控制面回合最多 8 次调用
（MAX_TOOL_ROUNDS）→ **一回合最多 24 次重试**。而三道现有的闸：

    45s 墙钟    量单轮，而且 WRITE 交回后重置
    8000 token  重试不产生 token，烧再多也不涨
    8 轮上限    量轮数，不量每轮里重试了几次

**一道都拦不住，因为每一轮单独看都正常。** 这就是它今天看不见的原因。

## 判据分三类

1. **活路径**（§1）——真 HTTP，让网关每次都抛瞬时错，数**整回合**发了几次。
   只单测那个纯函数证明不了它接在链路上。
2. **反向**（§3）——没开预算的路径行为一字不变；偶发一两次重试不许误伤。
3. **不许清零**——这一层的全部意义。变异：把 charge 改成 note_success 时清零 → 红。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from sliderule_llm.client import LlmError
from sliderule_llm.retry_budget import (
    MAX_RETRIES_PER_TURN,
    MAX_RETRY_WINDOW_SECONDS,
    RetryBudget,
    charge_retry,
    current_budget,
    retry_budget_scope,
)

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


# ── 一、活路径：整回合的重试次数有天花板 ─────────────────────────────────


def test_网关一直抖_整回合的重试有天花板(harness, monkeypatch):
    """真 HTTP。网关每次都抛瞬时错，数控制面**总共**发了多少次。

    ⚠ 补丁必须打在 `_call_control_llm_once`（重试环**下面**那一层）。
      第一版打在 `call_control_llm` 上——那正是 `ControlHarness` 默认替换的
      东西，整个重试环被绕过，测出来「一次都没重试」。判据自己把要量的
      那段代码换掉了（§1 的另一种形态：装在不通电的插座上）。
      所以这里把 harness 那个补丁还原回真函数，只替换更下面一层。
    """
    import services.rehearsal_control as rc
    from sliderule_llm import control_client, gateway_circuit

    gateway_circuit.reset_gateway_circuit()
    # 还原 harness 的替换：要量的就是这个函数里的重试环。
    monkeypatch.setattr(rc, "call_control_llm", control_client.call_control_llm)

    sid = new_sid("budget")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})

    calls = {"n": 0}

    async def always_flaky(messages, **kw):
        calls["n"] += 1
        raise LlmError("upstream 522", status=522, transient=True)

    monkeypatch.setattr(control_client, "_call_control_llm_once", always_flaky)
    monkeypatch.setattr(control_client.asyncio, "sleep", _no_sleep)

    _, events = harness.post(six_fields(sid, "帮我看看"))

    # 第一次调用 1 发 + 累计重试上限 10 → 总发送次数不超过 11。
    # 没有这一层时是 24（8 轮 × 3 次）。
    assert calls["n"] > 1, "一次都没重试，这条判据量不到东西"
    assert calls["n"] <= MAX_RETRIES_PER_TURN + 1, calls["n"]
    # 回合仍然要有终局，不许挂着。
    assert "complete" in [e.get("type") for e in events], [
        e.get("type") for e in events
    ]


def test_抖一下成功一下_额度不许被赚回来(harness, monkeypatch):
    """**这条才是这一层的判据。**

    ⚠ 第一版漏了它：变异测试里给预算加一个「成功时清零」，11 条全绿——
      因为我那批判据从头到尾只失败，**从没成功过一次**，清零逻辑压根没被
      执行到。而真机的形状恰恰是「抖一下、成功、再抖一下」，
      「每轮成功一次就把额度赚回来」说的就是这个。

    这里让每次调用失败 2 次再成功，模型每轮都继续调工具：
      没有累计预算 → 8 轮 × 2 次重试 = 16 次
      有累计预算   → 重试总数被钉在 10
    """
    import services.rehearsal_control as rc
    from sliderule_llm import control_client, gateway_circuit

    gateway_circuit.reset_gateway_circuit()
    monkeypatch.setattr(rc, "call_control_llm", control_client.call_control_llm)

    sid = new_sid("budget-flap")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )

    stats = {"fail": 0, "ok": 0, "streak": 0}

    async def flap(messages, **kw):
        # 每次调用：连栽 2 次，第 3 次成功。真机「网关抽风」就是这形状。
        if stats["streak"] < 2:
            stats["streak"] += 1
            stats["fail"] += 1
            raise LlmError("upstream 522", status=522, transient=True)
        stats["streak"] = 0
        stats["ok"] += 1
        # 每轮换实参：别撞上原地打转检测（那是另一道闸，混在一起量不清）。
        return llm_tool("search_evidence", {"query": f"q{stats['ok']}"})

    monkeypatch.setattr(control_client, "_call_control_llm_once", flap)
    monkeypatch.setattr(control_client.asyncio, "sleep", _no_sleep)

    harness.post(six_fields(sid, "帮我查查"))

    assert stats["ok"] >= 2, "一轮都没成功过，量不到「成功后额度有没有被赚回来」"
    # 变异咬这一条：成功时清零 → fail 会涨到 16。
    assert stats["fail"] <= MAX_RETRIES_PER_TURN, stats


async def _no_sleep(_seconds):  # noqa: D401 — 夹具：退避不真睡
    return None


# ── 二、这一层的全部意义：不许清零 ───────────────────────────────────────


def test_中途永不清零():
    """变异：在成功时把 spent 清零 → 本条红。

    grok 把它存在 actor 的 Cell 上、不是循环局部，就是为了这个。
    """
    with retry_budget_scope() as budget:
        for _ in range(3):
            assert charge_retry() is None
        assert budget.spent == 3
        # 中间成功了很多次——这一层**不认**成功。成功清零是第一层的事。
        assert budget.spent == 3
        for _ in range(MAX_RETRIES_PER_TURN - 3 - 1):
            assert charge_retry() is None
        denial = charge_retry()
        assert denial is not None and "10 次" in denial


def test_先记后问_上限是准的():
    """⚠ 反过来写（先问后记）会让第 10 次重试**发出去之后**才发现超了，
    上限就变成 11。差一个不是小事——这一层的意义就是那个准确的天花板。"""
    with retry_budget_scope() as budget:
        allowed = 0
        while charge_retry() is None:
            allowed += 1
            assert allowed < 50, "没有天花板"
        assert budget.spent == MAX_RETRIES_PER_TURN
        assert allowed == MAX_RETRIES_PER_TURN - 1


def test_墙钟窗口也是一道():
    """两条闸分开说：用户读到「试了 10 次」和「抖了 10 分钟」该做的事不一样。"""
    budget = RetryBudget(started=-MAX_RETRY_WINDOW_SECONDS * 2, spent=0)
    said = budget.denial()
    assert said and "窗口" in said, said
    assert "10 次" not in said, "两条闸塌成了同一句话"


def test_墙钟窗口必须大于控制面自己的墙钟():
    """⚠ 600s 看着像永远不会触发——不是。控制面 45s 墙钟在 WRITE 交回后会
    重置（工厂时间不计控制面），这一层从回合开头起算、从不重置。
    但它必须**大于**单轮墙钟，否则单轮那道先响，这一层永远轮不到。"""
    from services.rehearsal_control import MAX_WALL_SECONDS

    assert MAX_RETRY_WINDOW_SECONDS > MAX_WALL_SECONDS


# ── 三、反向：没开预算的路径一字不变 ─────────────────────────────────────


def test_没开预算就是无限_老路径行为不变():
    """工厂 `call_llm_with_retry`、夹具、脚本都没开 scope。这一层只先接
    控制面这一条链，不许顺手改掉一条今天在跑且没量过的路径。"""
    assert current_budget() is None
    for _ in range(100):
        assert charge_retry() is None


def test_一个回合一份_不许漏到下一个回合():
    """做成模块级单例会让上一个用户的重试记录算在下一个头上
    （同 `IdenticalToolCallRun` 那条纪律）。"""
    with retry_budget_scope() as first:
        charge_retry()
        assert first.spent == 1
    with retry_budget_scope() as second:
        assert second.spent == 0
        assert second is not first
    assert current_budget() is None


def test_偶发一两次重试不许误伤():
    with retry_budget_scope():
        for _ in range(3):
            assert charge_retry() is None


def test_scope嵌套后能还原():
    with retry_budget_scope() as outer:
        charge_retry()
        with retry_budget_scope() as inner:
            assert inner is not outer
        assert current_budget() is outer
        assert outer.spent == 1


# ── 四、接在活路径上（§1：只调纯函数证明不了通电）──────────────────────


def test_控制面客户端真的问了这份预算():
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(
        Path(__file__).resolve().parents[1] / "sliderule_llm" / "control_client.py"
    )
    at = src.find("note_failure(error)")
    assert at > 0
    # ⚠ 2026-09-15：原来切的是 `note_failure` 之后**700 个字符**。上游在中间
    #   插了空回复重采样那一段（~25 行），`charge_retry` 就被挤出窗口，判据红了
    #   ——而预算一直在问。判据钉的是字符距离，不是语义（§2：盯语义别盯字面）。
    #
    #   真正要钉的性质：**这一圈在睡下去重试之前，必须先扣累计预算**。
    #   所以切到那句 sleep 为止，整段里都得有它。
    sleep_at = src.find("await asyncio.sleep", at)
    assert sleep_at > at, "重试环里那句 sleep 不见了，这条判据的锚点没了"
    chunk = src[at:sleep_at]
    assert "charge_retry" in chunk, "重试环没问累计预算"
    # 反向：扣预算必须在 sleep **之前**——扣在后面等于这一发已经烧出去了。
    assert chunk.rindex("charge_retry") < len(chunk)


def test_预算开在回合上_不是开在循环里():
    """⚠ 开在 `_control_llm_loop` 里等于每次进 loop 都重新给额度——
    而一个回合可能进两次（回执路径 / forced 交回后）。那正好是这一层
    要治的「每轮成功就把额度赚回来」。"""
    import ast
    from pathlib import Path

    tree = ast.parse((Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py").read_text(encoding="utf-8"))
    functions = {node.name: node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)}
    def scopes(name):
        return [node for node in ast.walk(functions[name]) if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name) and node.func.id == "retry_budget_scope"]
    assert len(scopes("_run_control_turn_serial")) == 1, "回合入口必须只开一份预算"
    assert not scopes("_control_llm_loop"), "预算开在了循环里，每次进入都会重置"
