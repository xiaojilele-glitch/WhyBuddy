# -*- coding: utf-8 -*-
"""范围授权——设备 / 原型的 persist-as-authority（2026-08-30）。

对照 grok-build `xai-grok-workspace` 的 `PermissionState`：用户授予写进
持久化，内存覆盖不是权威。`persist_state` / `load_state_from_disk` 那一套
的核心不是「有个磁盘文件」，是 **grant 的来源只有一处，读的时候也只认它**。

本仓澄清答案已经这样抄了（`clarifications_from_state`：从 coverageGaps
取，不从 HTTP 再传一遍）。范围卡抄了一半——确认只把 `productArchetype`
写进 goal，`preferredDevice` 只活在 `set_preferred_device_override` 里，
工厂 `finally` 一清就没了。2026-08-30 真机两场点了「平板」的会话
（`sr-20260830144419-GEBYE95H68`、API `J274GF24KK`），checkpoint 里
零条 tablet：park 吃作曲家默认 desktop，stamp 不写设备，override 跑完就丢。

本模块补完那一半。不换五系统内核，不接通 `casual_game` / `watch`。
只依赖账本 + 设备词推断，**不许** import `rehearsal_control`。

park ≠ confirm：
  2026-08-30 当时 park 是提示（NeedPermission），卡上还能改档，所以句子里的
  「平板」压过作曲家默认 desktop。2026-09-01 真机「团子的一天」：空态已经
  选了平板 / 自由类型，范围卡画出桌面/PC 还能点——形态在新建会话就锁死了，
  卡上置灰。park 事件必须带作曲家载荷；句子 / 澄清里的 iPad 不再改档。
  confirm 仍是授予（Permission{decision}），载荷优先（卡上点的 = 锁死的那份）。
"""

from __future__ import annotations


def latest_control_plan(state):
    """The durable document, independent from the client and approval response."""
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if isinstance(row, dict) and row.get("kind") == "plan_written":
            return row
    return {}


def plan_execution_authorized(state):
    """Only the exact approved revision grants writes; old scope cards never do.

    Existing sessions without an approval also need a plan before their next write.
    """
    rows = [r for r in (getattr(state, "controlTranscript", None) or []) if isinstance(r, dict)]
    plan_rows = [r for r in rows if str(r.get("kind", "")).startswith("plan_")]
    if plan_rows:
        plan = latest_control_plan(state)
        if (
            not plan or not str(plan.get("planContent") or "").strip()
            or not str(plan.get("planId") or "").strip()
            or not isinstance(plan.get("revision"), int) or plan["revision"] < 1
        ):
            return False
        latest = plan_rows[-1]
        if latest.get("kind") != "plan_approved":
            return False
        if any(latest.get(k) != plan.get(k) for k in ("planId", "revision", "planContent")):
            return False
        request = next((r for r in reversed(plan_rows[:-1]) if r.get("kind") == "plan_approval"), {})
        return bool(request.get("reqId")) and all(
            latest.get(k) == request.get(k)
            for k in ("reqId", "planId", "revision", "planContent")
        )
    return False


def approved_plan_instruction(state, user_text):
    """Give every execution dialect the same approved, server-owned document."""
    if not plan_execution_authorized(state):
        raise ValueError("plan_approval_required")
    plan = latest_control_plan(state)
    return (
        f"{user_text}\n\nApproved implementation plan (revision {plan['revision']}):\n{plan['planContent']}"
    )

from typing import Any, Dict, Iterable, Mapping, Optional

from services.archetype_legal import (
    default_device,
    is_wired,
    supported_devices,
    UnknownArchetype,
)
from services.device_policy import infer_device_from_text


def wired_device(raw: Any) -> Optional[str]:
    """接通的设备档。哨兵 / watch / 空串都不是授予。"""
    name = str(raw or "").strip()
    if name in supported_devices():
        return name
    return None


def wired_archetype(raw: Any) -> Optional[str]:
    name = str(raw or "").strip()
    if not name:
        return None
    try:
        if is_wired(name):
            return name
    except UnknownArchetype:
        return None
    return None


def _as_map(raw: Any) -> Dict[str, Any]:
    return dict(raw) if isinstance(raw, Mapping) else {}


def _texts(texts: Iterable[Any] | None) -> list[str]:
    return [str(item or "") for item in (texts or [])]


def _persisted_device(last_card: Any, goal: Any) -> Optional[str]:
    card = _as_map(last_card)
    body = _as_map(goal)
    return wired_device(card.get("device")) or wired_device(body.get("preferredDevice"))


def resolve_park_device(
    *,
    last_card: Any = None,
    goal: Any = None,
    texts: Iterable[Any] | None = None,
    payload_device: Any = None,
) -> str:
    """停泊用档。作曲家载荷是授予 > 已持久化 > 句子推断 > 哨兵。

    ⚠ 2026-08-30：`device=str(preferred_device or "unspecified")` 让作曲家
    默认 desktop 盖掉「巡店点单平板」。当时 park 是出卡提示，卡上还能改。
    ⚠ 2026-09-01：形态在空态作曲家就选定，范围卡锁死置灰。作曲家 POST
    的档才是授予；把优先级改回「句子压过载荷」，团子那场必再现。
    """
    inferred = infer_device_from_text(*_texts(texts))
    payload = wired_device(payload_device)
    # 微信小程序 / 手机 不能画成桌面卡。作曲家默认 desktop 不是授予。
    # 2026-09-03 真机：句子「微信小程序」+ POST desktop → 卡锁 Web/PC，
    # 工厂 preferred_device_for_run 却出 phone，卡在撒谎。
    # 空态点了平板、句子没设备词：inferred 为空，下面仍走 payload（团子那场）。
    if inferred == "phone" and payload in (None, "desktop"):
        return "phone"
    if payload:
        return payload
    persisted = _persisted_device(last_card, goal)
    if persisted:
        return persisted
    if inferred:
        return inferred
    return "unspecified"


def resolve_park_archetype(
    *,
    last_card: Any = None,
    goal: Any = None,
    payload_archetype: Any = None,
) -> str:
    """停泊用原型。作曲家载荷是授予 > 已持久化。空串交给 _park_archetype 兜底。"""
    payload = wired_archetype(payload_archetype)
    if payload:
        return payload
    card = wired_archetype(_as_map(last_card).get("productArchetype"))
    if card:
        return card
    persisted = wired_archetype(_as_map(goal).get("productArchetype"))
    if persisted:
        return persisted
    return ""


def resolve_confirm_device(
    *,
    payload_device: Any = None,
    last_card: Any = None,
    goal: Any = None,
    texts: Iterable[Any] | None = None,
) -> str:
    """确认用档。卡上点的接通档是授予，压过句子和旧卡。"""
    payload = wired_device(payload_device)
    if payload:
        return payload
    card = wired_device(_as_map(last_card).get("device"))
    if card:
        return card
    persisted = wired_device(_as_map(goal).get("preferredDevice"))
    if persisted:
        return persisted
    inferred = infer_device_from_text(*_texts(texts))
    if inferred:
        return inferred
    return default_device()


def preferred_device_for_run(
    *,
    goal: Any = None,
    payload_device: Any = None,
    texts: Iterable[Any] | None = None,
) -> str:
    """本轮生成用档。本轮句子里的唯一设备词 > goal 上的授予 > 载荷 > 兜底。

    精修 POST 仍会带作曲家 localStorage 的 desktop。那不是新授予——
    对照 grok：磁盘上的 grant 压过会话里随手带上的默认值。
    """
    inferred = infer_device_from_text(*_texts(texts))
    if inferred:
        return inferred
    persisted = wired_device(_as_map(goal).get("preferredDevice"))
    if persisted:
        return persisted
    payload = wired_device(payload_device)
    if payload:
        return payload
    return default_device()


def stamp_scope_onto_goal(
    goal: Any,
    *,
    product_archetype: Any = None,
    preferred_device: Any = None,
    tools: Any = None,
) -> Dict[str, Any]:
    """把范围卡授予写进 goal。调用方随后 persist——内存 override 不是权威。"""
    body = goal if isinstance(goal, dict) else {}
    arch = str(product_archetype or "").strip()
    if arch:
        body["productArchetype"] = arch
    device = wired_device(preferred_device)
    if device:
        body["preferredDevice"] = device
    if tools is not None:
        names = [str(item).strip() for item in tools if str(item).strip()]
        if names:
            body["tools"] = names
        else:
            body.pop("tools", None)
    return body
