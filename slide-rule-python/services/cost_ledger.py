"""把 LLM 实调用记进会话 costLedger。

⚠ 2026-08-20：用量统计读 costLedger。能力执行器会对 execute_capability
估 content//4，但主循环（流式 drive / 五系统生成 / spec-first 写页）走
`call_llm`，调用方写 `parsed, _result = ...` 把 telemetry 丢掉。
于是侧栏一堆话题，设置里却写「跑一轮推演之后才有账」——账一直没记。

挂在 call_llm 成功出口（_finalize_result）。没绑定会话就空操作。
观察者自己炸了不许拖垮生成（增强类 fail-open）。
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, List

from models.v5_state import CapabilityCostRecord
from sliderule_llm.client import LlmResult, result_hook


def ledger_entries(state: Any) -> List[Any]:
    """dict / pydantic 都能取出 costLedger。getattr(dict) 会永远得到空。"""
    if isinstance(state, dict):
        return list(state.get("costLedger") or [])
    return list(getattr(state, "costLedger", None) or [])


@contextmanager
def bind_cost_session(state: Any) -> Iterator[None]:
    """本趟 drive 期间，成功的 LLM 调用写进 state.costLedger。"""
    with result_hook(lambda result: record_llm_result(state, result)):
        yield


def record_llm_result(state: Any, result: LlmResult) -> None:
    """fail-open。state 不对或字段对不上就静默返回。"""
    try:
        _record_llm_result(state, result)
    except Exception:  # noqa: BLE001
        return


def _record_llm_result(state: Any, result: LlmResult) -> None:
    usage = result.usage if isinstance(result.usage, dict) else {}
    telemetry = result.telemetry if isinstance(result.telemetry, dict) else {}
    tel_usage = telemetry.get("usage") if isinstance(telemetry.get("usage"), dict) else {}
    tokens = int(
        usage.get("total_tokens")
        or tel_usage.get("total_tokens")
        or 0
    )
    cost_block = telemetry.get("cost") if isinstance(telemetry.get("cost"), dict) else {}
    cost = float(
        telemetry.get("estimated_cost_usd")
        if telemetry.get("estimated_cost_usd") is not None
        else cost_block.get("estimated_usd") or 0.0
    )
    if tokens <= 0 and cost <= 0:
        # 没用量的成功回包仍记一笔时长，否则「调用了但 0 token」在账上看不见。
        tokens = 0
    try:
        from services.enrich_timing import current_stage_name

        cap = current_stage_name() or "llm.call"
    except Exception:  # noqa: BLE001
        cap = "llm.call"
    turn_id = str(getattr(state, "lastTurnId", None) or "t")
    now = datetime.now(timezone.utc).isoformat()
    run_id = f"llm-{uuid.uuid4().hex[:10]}"
    rec = CapabilityCostRecord(
        id=f"cost-{run_id}",
        turnId=turn_id,
        capabilityRunId=run_id,
        capabilityId=cap,
        estimatedTokens=tokens,
        estimatedCostUsd=round(cost, 8),
        durationMs=int(result.latency_ms or 0),
        source="server" if tokens > 0 else "estimated",
        createdAt=now,
    )
    existing = ledger_entries(state)
    existing.append(rec)
    if isinstance(state, dict):
        state["costLedger"] = existing
    else:
        state.costLedger = existing


def usage_by_owner() -> dict[str, dict[str, Any]]:
    """Stafftools：按会话主人汇总话题数。

    ⚠ 2026-08-21：第一版走 `persistence.load_all()`。那是把每条会话的整页
    HTML 经网关拉回来——侧栏 2026-08-19 已经改成 `list_session_summaries`
    就是因为 34 条 5.2MB / 2.3s。`load_all` 一超时就 fail-open 空账，管理台
    用户表「话题」全是 0，左侧栏却明明挂着这个人的会话。
    话题数必须跟侧栏同一条 `list_session_summaries`，并且只计有 goal 的行
    （空壳新会话侧栏不展示）。token 不在摘要列上，这里不强行再 hydrate blob
    （为了用量把主链路再堵一次，比显示 0 更糟）。
    """
    out: dict[str, dict[str, Any]] = {}
    try:
        from services.persistence import list_session_summaries, session_has_goal

        rows = list_session_summaries()
    except Exception:  # noqa: BLE001
        return out
    for row in rows:
        owner = str((row or {}).get("ownerId") or "").strip()
        if not owner:
            continue
        if not session_has_goal(row):
            continue
        bucket = out.setdefault(
            owner,
            {
                "sessions": 0,
                "estimatedTokens": 0,
                "estimatedCostUsd": 0.0,
                "lastActiveAt": None,
            },
        )
        bucket["sessions"] += 1
        active = row.get("lastActive") or row.get("createdAt")
        if active and (
            not bucket["lastActiveAt"] or str(active) > str(bucket["lastActiveAt"])
        ):
            bucket["lastActiveAt"] = active
    return out
