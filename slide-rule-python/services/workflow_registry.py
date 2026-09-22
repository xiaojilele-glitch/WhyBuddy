"""Named workflow presets. 叶子引擎，不依赖 services 里任何其它模块。

抄 grok-build `xai-workflow`：脚本/预设由 host 注入，引擎自己谁都不依赖。
本产品的 host 是 `workflow_select.select_workflow`。

日历从范围卡上的 原型×设备 派生，不看话题词。`select_workflow` 没有
`goal` 参数——加回去等于再给关键词分流开口。那条函数不在本文件。

⚠ 2026-08-31：第一版按「手表 / 游戏 / 巡检」关键词分流，真机户外手表话题
被带去 game-prototype。PC / 手机先只接通能力计划，其它原型不从这里选。
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import Dict, Tuple


@dataclass(frozen=True)
class WorkflowPreset:
    """A workflow's stable identity and ordered stage contract."""

    name: str
    stages: Tuple[str, ...]
    description: str = ""
    tools: Tuple[str, ...] = ()


_LOCK = RLock()
_PRESETS: Dict[str, WorkflowPreset] = {}


def _normalize(name: str) -> str:
    return "-".join(str(name or "").strip().lower().replace("_", "-").split())


def register_workflow(preset: WorkflowPreset, *, replace: bool = False) -> None:
    """Register a preset; duplicate names fail unless explicitly replaced."""
    key = _normalize(preset.name)
    if not key or key != preset.name:
        raise ValueError("workflow name must be normalized kebab-case")
    if not preset.stages or len(set(preset.stages)) != len(preset.stages):
        raise ValueError("workflow stages must be non-empty and unique")
    if "specfirst.bind" in preset.stages and "specfirst.assemble" not in preset.stages:
        raise ValueError("workflow bind requires assemble")
    with _LOCK:
        if key in _PRESETS and not replace:
            raise ValueError(f"workflow already registered: {key}")
        _PRESETS[key] = preset


def workflow_for(name: str) -> WorkflowPreset:
    key = _normalize(name)
    with _LOCK:
        try:
            return _PRESETS[key]
        except KeyError as exc:
            raise KeyError(f"unknown workflow: {name}") from exc


def workflow_names() -> Tuple[str, ...]:
    with _LOCK:
        return tuple(sorted(_PRESETS))


__all__ = [
    "WorkflowPreset",
    "register_workflow",
    "workflow_for",
    "workflow_names",
]
