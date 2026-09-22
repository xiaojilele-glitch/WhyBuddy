# -*- coding: utf-8 -*-
"""生命周期钩子：事件闭集 + 每个事件**能不能拦**。

抄的标准答案：grok-build `xai-grok-hooks/src/event.rs` / `dispatcher.rs`

    pub enum GateKind { Observe, Tool, Stop, PostTool, Prompt }
    pub struct EventTraits { pub gate: GateKind, pub matcher: MatcherPolicy, pub hub_forward: bool }

    // SECURITY: a hook that errors fails open (contributes nothing);
    // only a healthy deny blocks.

它用宏把「事件名 → traits」焊在一起：**加一个事件就必须说清它是哪种闸**，
漏了编译不过。Python 没有宏，所以这里用一张表 + 一条判据顶上
（`test_每个事件都得声明自己是哪种闸`）。

──────────────────────────────────────────────────────────────────────────
## 为什么「能不能拦」要写进类型

grok 把事件分成两类：`Observe` 只是通知，**它的返回值不许影响主流程**；
`Tool` / `Prompt` / `Stop` 才是闸。不分的话，一个只想记日志的处理器
返回个 falsy 值就能把推演掐掉——而那种事故没有任何报错，
只表现为「有时候点了没反应」。

## fail-open 是安全约定，不是省事

grok 那行 SECURITY 注释说得很死：**处理器自己炸了 = 什么都没贡献**，
只有「健康地返回 deny」才算拦。反过来写（炸了就拦）会让一个写错的钩子
把所有推演堵死，而且堵得毫无线索。

⚠ 这跟 CLAUDE.md §7 不冲突：钩子是**增强类**（用户自己挂的扩展），
  不是证据/闭环类。闭环那边照旧 fail-closed。

──────────────────────────────────────────────────────────────────────────
## 这一版做了什么、没做什么

**做了**：事件闭集、闸的种类、派发器、fail-open、决定的合并规则
（第一个健康的 deny 说了算）、入参改写、附加上下文、载荷上限。

**没做**：从文件发现钩子、命令/HTTP 处理器、信任模型、环境变量展开。
那些是 grok 给**工程师**用的形态（往 `~/.grok/hooks/` 丢 JSON）。
面团的用户不写代码，凭空发明一个文件格式只会得到一个没人用的入口——
配置来源是产品决定，等想清楚再接。**注册接口先只对进程内可见。**
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

#: 单次事件载荷上限。抄 grok `MAX_PAYLOAD_SIZE = 128 * 1024`。
MAX_PAYLOAD_BYTES = 128 * 1024


class HookEvent(str, Enum):
    """生命周期上的点。闭集——加一个必须在 `_GATE` 里说清它是哪种闸。"""

    SESSION_START = "session_start"
    USER_PROMPT_SUBMIT = "user_prompt_submit"
    PRE_TOOL_USE = "pre_tool_use"
    POST_TOOL_USE = "post_tool_use"
    STOP = "stop"
    NOTIFICATION = "notification"
    SESSION_END = "session_end"


class GateKind(str, Enum):
    """这个事件的返回值能起什么作用。抄 grok `GateKind`。"""

    #: 只是通知。**返回值一律不影响主流程**——只想记日志的处理器
    #: 不小心返回个 deny 也拦不住任何东西。
    OBSERVE = "observe"
    #: 工具闸：可以 allow / ask / deny，还可以改写入参。
    TOOL = "tool"
    #: 提问闸：可以拦下这一发。
    PROMPT = "prompt"
    #: 收尾闸：可以拦下「就这么结束」。
    STOP = "stop"


#: 事件 → 闸的种类。**唯一真相源**，判据钉着每个事件都在这儿。
_GATE: Dict[HookEvent, GateKind] = {
    HookEvent.SESSION_START: GateKind.OBSERVE,
    HookEvent.USER_PROMPT_SUBMIT: GateKind.PROMPT,
    HookEvent.PRE_TOOL_USE: GateKind.TOOL,
    HookEvent.POST_TOOL_USE: GateKind.OBSERVE,
    HookEvent.STOP: GateKind.STOP,
    HookEvent.NOTIFICATION: GateKind.OBSERVE,
    HookEvent.SESSION_END: GateKind.OBSERVE,
}


def gate_kind(event: HookEvent) -> GateKind:
    return _GATE[event]


def can_block(event: HookEvent) -> bool:
    """这个事件的处理器能不能拦下主流程。"""
    return _GATE[event] is not GateKind.OBSERVE


class HookDecision(str, Enum):
    """处理器的判决。抄 grok `HookDecision`。"""

    ALLOW = "allow"
    #: 要人点头。本仓的「要人点头」已经有范围卡那条路，这里只把意图透出去。
    ASK = "ask"
    DENY = "deny"


@dataclass
class HookOutcome:
    """一个处理器返回的东西。全是可选的——只想记日志就什么都不返回。"""

    decision: HookDecision = HookDecision.ALLOW
    #: 拦下时给人看的理由。**deny 必须带理由**，否则用户只看到「点了没反应」。
    reason: str = ""
    #: 改写后的入参（抄 grok `updatedInput`）。只有 TOOL 闸认。
    updated_input: Optional[Dict[str, Any]] = None
    #: 附加给模型的上下文（抄 grok `additionalContext`）。
    additional_context: str = ""


@dataclass
class HookVerdict:
    """派发之后的合并结果。"""

    decision: HookDecision = HookDecision.ALLOW
    reason: str = ""
    blocked_by: str = ""
    updated_input: Optional[Dict[str, Any]] = None
    context: List[str] = field(default_factory=list)
    #: 炸掉的处理器。fail-open **但留痕**——不留痕就成了"静静地什么都没发生"。
    errors: List[Tuple[str, str]] = field(default_factory=list)

    def allowed(self) -> bool:
        return self.decision is HookDecision.ALLOW


#: name → (event, handler)。进程内注册表；不从文件发现（见模块头注）。
_HANDLERS: Dict[HookEvent, List[Tuple[str, Callable[..., Any]]]] = {}


def register_hook(
    event: HookEvent, name: str, handler: Callable[..., Any]
) -> None:
    """挂一个处理器。同名重复注册**覆盖**（热重载友好），不追加。"""
    rows = [row for row in _HANDLERS.get(event, []) if row[0] != name]
    rows.append((str(name), handler))
    _HANDLERS[event] = rows


def unregister_hook(event: HookEvent, name: str) -> None:
    _HANDLERS[event] = [row for row in _HANDLERS.get(event, []) if row[0] != name]


def registered(event: HookEvent) -> List[str]:
    return [name for name, _ in _HANDLERS.get(event, [])]


def clear_hooks() -> None:
    """测试夹具。生产路径不许调。"""
    _HANDLERS.clear()


def _payload_ok(payload: Any) -> bool:
    try:
        import json

        return len(json.dumps(payload, ensure_ascii=False, default=str).encode()) <= MAX_PAYLOAD_BYTES
    except Exception:  # noqa: BLE001
        return True


def dispatch(event: HookEvent, payload: Dict[str, Any]) -> HookVerdict:
    """跑这个事件上挂着的所有处理器，合并成一个判决。

    合并规则抄 grok `dispatch_sequential_gate`：

    · **第一个健康的 deny 说了算**，后面的不再问（拦下就是拦下）。
    · 处理器自己炸了 = 什么都没贡献（SECURITY 那行），但**记进 errors**。
    · OBSERVE 事件的判决一律丢掉——只有闸类事件的 deny/ask 算数。
    · 入参改写只有 TOOL 闸认；多个处理器都改，**后一个盖前一个**。
    """
    verdict = HookVerdict()
    rows = list(_HANDLERS.get(event, []))
    if not rows:
        return verdict
    if not _payload_ok(payload):
        # 载荷太大就不派发。抄 grok MAX_PAYLOAD_SIZE——把一份 4MB 的页面
        # HTML 塞进每个钩子，钩子没问题，进程会有问题。
        verdict.errors.append(("<dispatch>", "payload too large"))
        return verdict

    gate = _GATE[event]
    # Each sequential handler observes the previous handler's updated input,
    # matching grok's `updatedInput` fold.  Passing the original payload to all
    # handlers made a rewrite silently disappear for the next policy hook.
    current_payload = dict(payload)
    for name, handler in rows:
        try:
            out = handler(dict(current_payload))
        except Exception as exc:  # noqa: BLE001 — fail-open：炸了什么都不贡献
            verdict.errors.append((name, str(exc)[:200]))
            continue
        if out is None:
            continue
        if not isinstance(out, HookOutcome):
            # 返回了别的东西 = 处理器写错了。当成没返回，别去猜它想干嘛。
            verdict.errors.append((name, "handler returned a non-HookOutcome"))
            continue
        if out.additional_context.strip():
            verdict.context.append(out.additional_context.strip())
        if gate is GateKind.TOOL and isinstance(out.updated_input, dict):
            verdict.updated_input = dict(out.updated_input)
            current_payload.update(out.updated_input)
        if gate is GateKind.OBSERVE:
            # 只是通知：判决丢掉。不丢的话，一个只想记日志的处理器
            # 返回个 deny 就能把推演掐掉，而且没有任何报错。
            continue
        if out.decision is HookDecision.DENY:
            verdict.decision = HookDecision.DENY
            verdict.reason = out.reason.strip() or f"被 {name} 拦下"
            verdict.blocked_by = name
            break
        if out.decision is HookDecision.ASK and verdict.decision is HookDecision.ALLOW:
            verdict.decision = HookDecision.ASK
            verdict.reason = out.reason.strip() or f"{name} 要求先问一下"
            verdict.blocked_by = name
    return verdict
