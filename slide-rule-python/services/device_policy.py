"""Authoritative target-device policy for newly generated applications."""

from __future__ import annotations

from .archetype_legal import default_device as _default_device
from .archetype_legal import layout_device as _layout_device
from .archetype_legal import supported_devices as _supported_devices
import re
from typing import Any, MutableMapping, Optional


#: 合法域只从账本派生。Python 的 `Literal[...]` 不能写成 `Literal[*supported]`，
#: 再手抄一份就是账本加 watch、这里没跟上、生成出来闸不认。类型用 str，
#: 运行时用 `supported_devices()`。
Device = str
DEVICE_AUTHORITY = "single-v1"

_DESKTOP_EXPLICIT = re.compile(
    r"(?<![A-Za-z0-9])(?:pc|web|website)(?![A-Za-z0-9])|电脑|桌面端|网页|网站",
    re.IGNORECASE,
)
_PHONE_EXPLICIT = re.compile(
    r"(?<![A-Za-z0-9])app(?![A-Za-z0-9])|手机|移动端|小程序",
    re.IGNORECASE,
)
_TABLET_EXPLICIT = re.compile(
    r"(?<![A-Za-z0-9])(?:ipad|tablet)(?![A-Za-z0-9])|平板",
    re.IGNORECASE,
)

# 作曲家「应用 / Web」开关。模块级而不是 ContextVar：spec-first 跑在
# asyncio.to_thread 里，ContextVar 过不了线程（installed_skills 同款）。
# 本地单人推演可接受；finally 必须清掉，否则下一轮脏读。
_override: Optional[str] = None


def set_preferred_device_override(raw: Any) -> None:
    """本轮推演的用户显式选择。非法值 / None = 不清、走话题推断。"""
    global _override
    _override = raw if raw in _supported_devices() else None


def preferred_device_override() -> Optional[str]:
    return _override


def infer_device_from_text(*texts: str) -> Optional[str]:
    """话题里唯一的显式设备词。不含线程覆盖。

    ⚠ 2026-08-30 真机：作曲家 POST 默认 desktop，「巡店点单平板」里的
    平板被默认档盖掉。推断必须能单独调用——绑在 override 上，控制面
    park 那一步根本走不到这条链。冲突词（电脑+平板）返回 None，
    不猜。
    """
    joined = "\n".join(str(item or "") for item in texts)
    asked: list[str] = []
    if _DESKTOP_EXPLICIT.search(joined):
        asked.append("desktop")
    if _PHONE_EXPLICIT.search(joined):
        asked.append("phone")
    if "tablet" in _supported_devices() and _TABLET_EXPLICIT.search(joined):
        asked.append("tablet")
    unique = [device for device in asked if device in _supported_devices()]
    if len(unique) == 1:
        return unique[0]
    return None


def resolve_preferred_device(goal: str, model_choice: Any) -> str:
    """用户开关 > 话题里的显式设备词 > 模型已有选择 > desktop。

    开关要压过「网站/App」用词：空态点了「应用」再写「做个库存系统」，
    必须出竖屏，不能等用户把「手机」写进句子才认。
    """
    if _override in _supported_devices():
        return _override

    inferred = infer_device_from_text(goal)
    if inferred:
        return inferred
    if model_choice in _supported_devices():
        return model_choice
    return _default_device()


def normalize_model_preferred_device(
    goal: str, model: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Write the single authoritative device before gate and enrichment."""
    appbundle = model.get("appbundle")
    if not isinstance(appbundle, dict):
        appbundle = {}
        model["appbundle"] = appbundle

    appbundle["preferredDevice"] = resolve_preferred_device(
        goal, appbundle.get("preferredDevice")
    )
    appbundle["deviceAuthority"] = DEVICE_AUTHORITY
    return model


def preferred_layout_device(appbundle: Any) -> str:
    """版式 / 生图用档。接通的 preferredDevice 原样用，否则兜底。"""
    raw = ""
    if isinstance(appbundle, dict):
        raw = str(appbundle.get("preferredDevice") or "").strip()
    return _layout_device(raw)
