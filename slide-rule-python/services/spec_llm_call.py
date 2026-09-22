"""spec-first 四步共用的 LLM-JSON 调用口：**把"传输挂了"和"模型吐了坏 JSON"分开**。

## 病灶（2026-08-14 真机撞出来）

第 4 步失败，对外报的是「LLM 没有返回可解析的 JSON」。而紧跟着的后端日志是：

    [v5_llm_generate] structured channel failed: exhausted retries:
        llm error: 429: rate limited or out of quota

真因是**限流**，报出来的却是「模型吐了坏 JSON」。这两件事要的修法正好相反：

    429 / 5xx / 连接断开  → 退避、降并发、查配额     （改提示词毫无用处）
    模型吐了坏 JSON        → 改提示词 / schema / 重问 （退避毫无用处）

病根在四个模块里各写了一份的 `_call`：它 `except Exception: return None`，
把 `LlmError`（带 status 和 transient 分级的那个）压成了一个无差别的 None，
调用方只好统一说成"没解析出 JSON"。**错因在离现场一行的地方被丢掉了。**

## 顺带治掉第二件事：重问预算被传输故障吃掉

调用方那个 `for attempt in range(max_reask + 1)` 循环治的是**校验不过**——
把校验器原话喂回去重问。但传输挂了的时候根本没拿到东西，没有任何可喂回去的
内容，重问只是把同一个请求再发一遍。

而且底下 `call_llm_json` 已经走 `call_llm_with_retry`（带 transient 分级 +
gRPC hedging）**退避重试过了**。上层再转两圈，是拿宝贵的重问额度去做一件
下层刚做完且做得更好的事。实测就是这个形状：11.6 秒跑完三次尝试。

所以 `transport=True` 时调用方直接停，如实报真因。

## 开源怎么选的：查过，不引

`instructor`（LLM 结构化输出的事实标准）正是干这件事的库。查下来**它自己有
同一个毛病**——issue #693「Error handling broken in retry.py」说的就是 API
连接错误被当成校验失败继续重试；社区给的解法是自己用 tenacity 的
`retry_if_not_exception_type` 按异常类型分流。

也就是说：**参照实现里没有更好的成品可抄，照抄反而会把同一个 bug 抄进来。**
可抄的只有那条原则本身（API 错误与校验错误必须分流），而它在本仓第 3 步
（generate_page_html 那次）已经写下过一遍——这次是把同一条原则补到另外四步。

分级本身也不用另立：`LlmError` 已经带 `status` + `transient`，
`_normalize_error` 的映射跟 openai SDK 的异常类层次一一对应
（429→RateLimit、401/403→Auth、404→NotFound、5xx/524→transient），
只是压成了两个字段而不是一串类名。**够用，不再包一层。**
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class SpecLlmOutcome:
    """一次 LLM-JSON 调用的结果。

    payload 为 None 时 failure 一定有话说——**不存在"失败了但说不出为什么"**，
    那正是这个文件要消灭的状态。
    """

    payload: Optional[Dict[str, Any]]
    failure: Optional[str] = None
    #: True = 传输/配额/客户端层面挂了。调用方据此**停止重问**：
    #: 没拿到任何内容，没有可以喂回去的东西；而且下层已经退避重试过了。
    transport: bool = False

    @property
    def ok(self) -> bool:
        return self.payload is not None


def call_spec_json(
    messages: List[Dict[str, str]],
    llm_json_fn: Optional[Callable[[List[Dict[str, str]]], Optional[Dict[str, Any]]]],
    *,
    stage: str,
    temperature: float = 0.2,
) -> SpecLlmOutcome:
    """调一次 LLM 要 JSON。`stage` 只用于实时增量的通道名（specfirst.*）。

    ⚠ 注入的 `llm_json_fn` 抛错按**没产出**处理而不是传输故障：用例注入的假
      LLM 抛错，语义是"这次没给出东西"，调用方照旧走重问那条路——保持既有
      行为，不因为这次重构改掉用例的语义。
    """
    if llm_json_fn is not None:
        try:
            payload = llm_json_fn(messages)
        except Exception as exc:  # noqa: BLE001 — 注入的假 LLM 抛错等同没产出
            return SpecLlmOutcome(None, f"注入的 llm_json_fn 抛错：{str(exc)[:200]}")
        return _wrap(payload)

    try:
        from sliderule_llm.client import LlmError, call_llm_json
    except Exception as exc:  # noqa: BLE001 — 客户端不可用是环境问题，不是模型问题
        return SpecLlmOutcome(None, f"LLM 客户端不可用：{str(exc)[:200]}", transport=True)

    # 实时增量：这一步在"想什么"要能被看见，不是只报一行"正在执行"。
    # ⚠ on_delta 在场会关掉对冲（call_llm_with_retry 边界一：两份副本会往同一个
    #   sink 推，UI 上是两份内容交替出现）。这几步都是单次调用，拿"看得见"换掉
    #   对冲划算；逐页并发的第 3 / 6.5 步则相反，那两步不接。
    try:
        from sliderule_llm.capabilities import delta_emitter

        on_delta = delta_emitter(stage)
    except Exception:  # noqa: BLE001 — 观测钩子不可用不该打死这一步
        on_delta = None

    try:
        payload, _ = call_llm_json(
            messages,
            temperature=temperature,
            **({"on_delta": on_delta} if on_delta is not None else {}),
        )
    except LlmError as exc:
        # ★ 这一支就是本文件存在的理由：把真因原样带出去，并标成传输层。
        #   status 一并写进话术——「429」和「404」对读日志的人是完全不同的指令。
        status = f"HTTP {exc.status} · " if getattr(exc, "status", None) else ""
        kind = "可重试" if getattr(exc, "transient", False) else "不可重试"
        return SpecLlmOutcome(
            None,
            f"LLM 调用失败（{status}{kind}）：{str(exc)[:200]}",
            transport=True,
        )
    except Exception as exc:  # noqa: BLE001 — 非 LlmError 的意外同样不是"坏 JSON"
        return SpecLlmOutcome(None, f"LLM 调用异常：{str(exc)[:200]}", transport=True)

    return _wrap(payload)


def _wrap(payload: Any) -> SpecLlmOutcome:
    """拿到东西了，但不是 dict —— 这才是真正的「没返回可解析的 JSON」。"""
    if isinstance(payload, dict):
        return SpecLlmOutcome(payload)
    return SpecLlmOutcome(None, "LLM 没有返回可解析的 JSON")
