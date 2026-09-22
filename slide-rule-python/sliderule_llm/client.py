"""
LLM HTTP client — port of server/core/llm-client.ts (createChatCompletion / createResponse).

Real httpx calls. NO custom proxy dispatcher needed: httpx.Client(trust_env=True) (the default)
reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the environment, so the Clash proxy works without
the undici version-skew bug that plagued Node.
"""
from __future__ import annotations

import json
import re
import os
import sys
import time
from dataclasses import dataclass, replace
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Callable, Iterable, Iterator, Literal, Optional
from urllib.parse import urlparse

import httpx

from .config import (
    FallbackLlmConfig,
    LlmConfig,
    default_max_tokens,
    format_max_tokens,
    get_fallback_llm_config,
    get_llm_config,
    resolve_wire_max_tokens,
)

ContentPart = dict[str, Any]
MessageContent = str | list[ContentPart]
Message = dict[str, Any]


_MODEL_PRICING_USD_PER_1K_TOKENS: dict[str, dict[str, float]] = {
    "glm-5-turbo": {"input": 0.001, "output": 0.002},
    "glm-4.6": {"input": 0.002, "output": 0.004},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o": {"input": 0.005, "output": 0.015},
}
_DEFAULT_PRICING_USD_PER_1K_TOKENS = {"input": 0.001, "output": 0.002}


class LlmError(Exception):
    def __init__(
        self, message: str, *, status: int | None = None, transient: bool = False,
        usage: dict[str, Any] | None = None, finish_reason: str | None = None,
        empty_reason: str | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.transient = transient
        # A provider can bill a response it then terminates. The control run
        # must charge that usage even though no assistant message is accepted.
        self.usage = usage
        self.finish_reason = finish_reason
        #: 控制面空采样的归类。缺省 None：工厂路径和旧构造函数不受影响。
        self.empty_reason = empty_reason


@dataclass
class LlmResult:
    content: str
    usage: dict[str, Any] | None
    finish_reason: str | None
    model: str
    latency_ms: int
    provider: str | None = None
    telemetry: dict[str, Any] | None = None


@dataclass(frozen=True)
class LlmStreamEvent:
    kind: Literal["chunk", "done", "error"]
    delta: str = ""
    result: LlmResult | None = None
    error: LlmError | None = None
    failure_kind: str | None = None


@dataclass(frozen=True)
class SSEEvent:
    event: str | None
    data: str


def _headers(api_key: str) -> dict[str, str]:
    return {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}


def _provider_name(base_url: str) -> str:
    parsed = urlparse(base_url or "")
    return parsed.netloc or base_url


def _fallback_to_llm_config(fallback: FallbackLlmConfig) -> LlmConfig:
    return LlmConfig(
        api_key=fallback.api_key,
        base_url=fallback.base_url,
        model=fallback.model,
        router_model=None,
        wire_api=fallback.wire_api,
        reasoning_effort=fallback.reasoning_effort,
        timeout_ms=fallback.timeout_ms,
        stream=fallback.stream,
        unlimited_models=(),
        model_fallbacks=(),
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name=_provider_name(fallback.base_url),
        chat_thinking_type=fallback.chat_thinking_type,
        supports_image_content_parts=False,
    )


def build_provider_configs(explicit: LlmConfig | None = None) -> list[tuple[str, LlmConfig]]:
    """Port of llm-client buildProviders: primary, model fallbacks, then env fallback provider."""
    if explicit is not None:
        return [("explicit", explicit)]

    primary = get_llm_config()
    chain: list[tuple[str, LlmConfig]] = []
    if primary.api_key and primary.base_url:
        chain.append(("primary", primary))
        for model in primary.model_fallbacks:
            chain.append((f"primary:{model}", replace(primary, model=model)))

    fallback = get_fallback_llm_config()
    if fallback.enabled:
        chain.append(("fallback", _fallback_to_llm_config(fallback)))
    return chain


def should_try_next_provider(error: LlmError) -> bool:
    """Mirror Node shouldTryNextProvider for provider-chain failover."""
    message = str(error).lower()
    if "does not support image content parts" in message:
        return True
    if error.status == 404:
        return True
    patterns = (
        "no available clients",
        "temporarily unavailable",
        "upstream",
        "timeout",
        "cannot reach",
        "rate limit",
        "rate_limit",
        "out of quota",
        "empty content",
        "malformed",
        "model/endpoint mismatch",
        "404:",
    )
    return any(pattern in message for pattern in patterns) or error.transient


# 网关用鉴权码表达"容量满了"——状态码撒谎时以响应体为准。
#
# ⚠ 2026-08-25 真机（健身房那趟）连挂四轮，每轮都停在同一处：
#     [llm-retry] 第 1/3 次失败（HTTP 401 不可重试）
#     [v5_capability_executor] spec 生成失败（重问 2 次后）
#   `第 1/3` 是关键——链路给了 3 次重试预算，分类器判"不可重试"，烧掉 1 次
#   就弃权，预算全程没用上。抓响应体一看：
#     {"error":{"message":"All available accounts exhausted","type":"server_error"}}
#   **type 是 server_error**，账号池耗尽披了个 401 的壳，不是 key 错了。
#   实测该网关稳定 ~20% 抛这个，一轮推演十几次调用，全程躲开概率约 10%，
#   于是"改一行代码 → 跑真机验证"这条路被整个堵死。
#   同一天量过：换 gemini-3-flash 也一样（25 次里 5 次），抖动在账号池层，
#   不在模型层——所以换模型不是解法，别再试了。
#
# 这不是新规矩：下面 429 分支早就认了"403 + quota/billing 关键词按限流处理"，
# 这里只是把同一条规矩扩到 401 的容量耗尽。判据盯**语义**（上游容量/账号池
# 满了，跟本地凭据无关），不盯某家网关的某句话。
# 真鉴权失败的 401 仍然 transient=False——重试一万次也没用，别退化成 fail-open。
_CAPACITY_BEHIND_AUTH_STATUS = re.compile(
    r"quota|billing|rate.?limit|insufficient_quota"
    r"|accounts?\s+exhausted|no\s+available\s+accounts?|capacity"
    r'|"?type"?\s*[:=]\s*"?server_error',
    re.IGNORECASE,
)


def _normalize_error(status: int, body: str) -> LlmError:
    """Port of normalizeLLMError status mapping."""
    snippet = (body or "")[:200]
    lower = snippet.lower()
    if status == 429 or (status in (401, 403) and _CAPACITY_BEHIND_AUTH_STATUS.search(lower)):
        # 文案说实话：日志里写"鉴权失败"会把人送去查 key，查一晚上查不出东西。
        detail = f"upstream capacity exhausted ({status}, not an auth failure): {snippet}"
        return LlmError(
            "429: rate limited or out of quota" if status == 429 else detail,
            status=status,
            transient=True,
        )
    if status in (401, 403):
        return LlmError(f"auth failed ({status}): check API key", status=status, transient=False)
    if status == 404:
        return LlmError("404: check base URL / model id", status=status, transient=False)
    if status in (522, 524):
        # 522 = Cloudflare 源站连接超时；524 = 源站读超时。都是瞬时的。
        # ⚠ 2026-09-08：522 原先掉进下面的 generic 5xx，控制面 except 再
        #   一律说「网关连不上」。直连同一网关是 200，用户不认那句罐头。
        return LlmError(
            f"gateway timeout ({status}): {snippet}", status=status, transient=True
        )
    if 500 <= status < 600:
        return LlmError(f"upstream {status}: {snippet}", status=status, transient=True)
    return LlmError(f"HTTP {status}: {snippet}", status=status, transient=False)


# ── payload builders ──────────────────────────────────────────────────────────

def _is_content_part(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("type"), str)


def _has_image_content_parts(messages: list[Message]) -> bool:
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    return True
    return False


def _validate_text_part(part: ContentPart) -> dict[str, str]:
    text = part.get("text")
    if not isinstance(text, str):
        raise LlmError("invalid text content part: text must be a string", transient=False)
    return {"type": "text", "text": text}


def _validate_image_part(part: ContentPart) -> dict[str, Any]:
    image_url = part.get("image_url")
    if not isinstance(image_url, dict) or not isinstance(image_url.get("url"), str) or not image_url["url"]:
        raise LlmError("invalid image content part: image_url.url must be a non-empty string", transient=False)
    normalized = {"url": image_url["url"]}
    detail = image_url.get("detail")
    if detail is not None:
        if detail not in ("auto", "low", "high"):
            raise LlmError("invalid image content part: detail must be auto, low, or high", transient=False)
        normalized["detail"] = detail
    return {"type": "image_url", "image_url": normalized}


def _normalize_content_parts(content: list[Any]) -> list[ContentPart]:
    normalized: list[ContentPart] = []
    for part in content:
        if not _is_content_part(part):
            raise LlmError("invalid multimodal content part", transient=False)
        if part["type"] == "text":
            normalized.append(_validate_text_part(part))
        elif part["type"] == "image_url":
            normalized.append(_validate_image_part(part))
        else:
            raise LlmError(f"unsupported content part type: {part['type']}", transient=False)
    return normalized


#: 工具调用轮次要带的字段。归一化**必须原样透传**，剥掉就等于把多轮工具
#: 对话拆散：assistant 少了 tool_calls，后面那条 role="tool" 就成了孤儿。
_TOOL_TURN_KEYS = ("tool_calls", "tool_call_id", "name")


def _normalize_message(message: Message) -> Message:
    """归一化一条消息。

    ⚠ 2026-09-02 真机（健身房那趟）：控制面 WRITE 交回 host 之后，循环里
    `control llm loop failed after write` 每次必崩，
    `LlmError: content must be a string or content part list`。两个原因叠在一起：

    **① 这里原来只返回 `{role, content}`**，`tool_calls` / `tool_call_id`
    被静默剥掉。控制面拼的消息本来是合法的工具轮次（assistant 带 tool_calls、
    随后 role="tool" 带 tool_call_id），剥完就成了「孤儿 tool 消息」——
    请求还能发出去，所以一直没人发现，只是模型看到的对话是残的。

    **② 空正文的 assistant 是合法的**：模型常把话全放进工具参数
    （`control_client` 模块头写着这条）。调用方于是写 `content or None`，
    而这里只认 str / list，None 直接抛——host 循环第二轮必挂，
    「工厂跑完交回控制面继续挑」整条自由编排链就断在这儿。

    所以：带 tool_calls 时允许 content 为 None（OpenAI 兼容口径），
    并把工具轮次字段原样带上。纯聊天那两条路径行为不变。
    """
    role = message.get("role")
    content = message.get("content")
    if not isinstance(role, str):
        raise LlmError("invalid LLM message: role must be a string", transient=False)

    extras = {k: message[k] for k in _TOOL_TURN_KEYS if message.get(k) is not None}

    if isinstance(content, str):
        return {"role": role, "content": content, **extras}
    if isinstance(content, list):
        return {"role": role, "content": _normalize_content_parts(content), **extras}
    if content is None and extras.get("tool_calls"):
        # 空正文 + 工具调用：合法，归一成空串。
        #
        # ⚠ 为什么是 ""，不是原样留 None：`_messages_after_forced_write` 合成的
        #   同形状 assistant 消息本来就写 ""（rehearsal_control 里那条），
        #   两种形状混着走会让「同一件事两种表示」再长出来。空串是「这一轮没说话」，
        #   不是替模型编了一句话。调用侧也已经不再写 `content or None`，
        #   这里是防御性的第二道。
        return {"role": role, "content": "", **extras}
    raise LlmError("invalid LLM message: content must be a string or content part list", transient=False)


def _normalize_messages(messages: list[Message]) -> list[Message]:
    return [_normalize_message(message) for message in messages]


def _content_to_text(content: MessageContent) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(part["text"] for part in content if part.get("type") == "text")


def _responses_content_parts(content: MessageContent) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    parts: list[dict[str, Any]] = []
    for part in content:
        if part["type"] == "image_url":
            parts.append({"type": "input_image", "image_url": part["image_url"]["url"]})
        else:
            parts.append({"type": "input_text", "text": part["text"]})
    return parts


def _chat_payload(messages, model, temperature, max_tokens, reasoning, stream) -> dict[str, Any]:
    p: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": stream,
    }
    if max_tokens is not None:
        p["max_tokens"] = max_tokens
    if reasoning and reasoning.strip().lower() != "none":
        p["reasoning_effort"] = reasoning
    return p


def _responses_payload(messages, model, temperature, max_tokens, reasoning, stream) -> dict[str, Any]:
    instructions = "\n\n".join(_content_to_text(m["content"]) for m in messages if m.get("role") == "system")
    input_items = [
        {"role": m["role"], "content": _responses_content_parts(m["content"])}
        for m in messages
        if m.get("role") != "system"
    ]
    p: dict[str, Any] = {
        "model": model,
        "input": input_items,
        "stream": stream,
        "store": False,
    }
    if max_tokens is not None:
        p["max_output_tokens"] = max_tokens
    if instructions:
        p["instructions"] = instructions
    if reasoning and reasoning.strip().lower() != "none":
        p["reasoning"] = {"effort": reasoning}
    return p


# ── response extraction (chat + responses shapes) ─────────────────────────────

def _empty_content_hint(
    finish: str | None, max_tokens: int | None, usage: dict | None,
    *, include_length_advice: bool = True,
) -> str:
    """空内容报错时，把**为什么空**一起说出来（2026-08-11）。

    ## 差这一个词，两个完全不同的故障长得一模一样

    线上实测：`intent.clarify` 占着连接算了 115.5 秒、正文零字节，报的是
    `empty content from LLM (stream)`。读到这句话的人第一反应是"服务商坏了"，
    于是去查上游、查网络——**而真因是 max_tokens 不够**：推理模型的思考 token
    和正文共用同一个预算，思考把它吃光，`finish_reason=length`，正文自然是空的。

    仓库里那条 `config.DEFAULT_MAX_TOKENS` 的注释原话就是「表现像"服务商坏了"，
    其实是预算不够」——**它预言了这次误诊，而报错消息里偏偏没带这个词。**
    信息一直在手上（`finish` 就在同一个函数里，成功路径还会塞进返回值），
    只是没写进错误。

    所以这里只做一件事：把 finish_reason 和当时的预算写进消息。
    """
    bits = [f"finish_reason={finish or 'unknown'}", f"max_tokens={format_max_tokens(max_tokens)}"]
    if isinstance(usage, dict):
        for key in ("completion_tokens", "reasoning_tokens", "total_tokens"):
            if usage.get(key) is not None:
                bits.append(f"{key}={usage[key]}")
    tail = ""
    if include_length_advice and str(finish or "").lower() == "length":
        tail = "（预算被吃光，不是服务商故障：推理模型的思考 token 与正文共用 max_tokens，调大 LLM_MAX_TOKENS——全链路就这一个旋钮）"
    return f"[{' '.join(bits)}]{tail}"


def _extract(data: dict[str, Any], wire: str) -> tuple[str, dict | None, str | None]:
    if wire == "responses":
        text = data.get("output_text")
        if not text:
            parts: list[str] = []
            for item in data.get("output", []) or []:
                for c in item.get("content", []) or []:
                    if isinstance(c, dict) and c.get("text"):
                        parts.append(c["text"])
            text = "".join(parts)
        return text or "", data.get("usage"), data.get("status")
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    return (msg.get("content") or ""), data.get("usage"), choice.get("finish_reason")


def normalize_finish_reason(finish_reason: str | None) -> str | None:
    if finish_reason is None:
        return None
    normalized = finish_reason.strip().lower()
    return normalized or None


def normalize_usage(usage: dict[str, Any] | None) -> dict[str, int]:
    data = usage or {}
    prompt_tokens = int(data.get("prompt_tokens") or data.get("input_tokens") or 0)
    completion_tokens = int(data.get("completion_tokens") or data.get("output_tokens") or 0)
    total_tokens = int(data.get("total_tokens") or (prompt_tokens + completion_tokens))
    return {
        "total_tokens": total_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


def build_cost_metadata(model: str, usage: dict[str, Any] | None) -> dict[str, Any]:
    normalized_usage = normalize_usage(usage)
    pricing = _MODEL_PRICING_USD_PER_1K_TOKENS.get(model)
    pricing_source = "known" if pricing is not None else "fallback"
    pricing_model = model if pricing is not None else "default"
    effective_pricing = pricing or _DEFAULT_PRICING_USD_PER_1K_TOKENS
    estimated = (
        (normalized_usage["prompt_tokens"] / 1000) * effective_pricing["input"]
        + (normalized_usage["completion_tokens"] / 1000) * effective_pricing["output"]
    )
    return {
        "estimated_usd": round(estimated, 12),
        "currency": "USD",
        "is_estimate": True,
        "pricing_source": pricing_source,
        "pricing_model": pricing_model,
        "pricing_unit": "usd_per_1k_tokens",
        "billing_source": "static_pricing_table",
    }


def build_llm_telemetry(result: LlmResult, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    usage = normalize_usage(result.usage)
    cost = build_cost_metadata(result.model, usage)
    telemetry: dict[str, Any] = {
        "model": result.model,
        "provider": result.provider,
        "usage": usage,
        "latency_ms": result.latency_ms,
        "finish_reason": normalize_finish_reason(result.finish_reason),
        "estimated_cost_usd": cost["estimated_usd"],
        "cost": cost,
    }
    if extra:
        telemetry.update(extra)
    return telemetry


def parse_sse(raw: str) -> list[SSEEvent]:
    normalized = raw.replace("\r\n", "\n")
    events: list[SSEEvent] = []
    for chunk in normalized.split("\n\n"):
        lines = [line for line in chunk.split("\n") if line]
        if not lines:
            continue
        event_name: str | None = None
        data_lines: list[str] = []
        for line in lines:
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if data_lines:
            events.append(SSEEvent(event=event_name, data="\n".join(data_lines)))
    return events


def _event_to_sse_chunk(event: SSEEvent) -> str:
    lines: list[str] = []
    if event.event:
        lines.append(f"event: {event.event}")
    for data_line in event.data.split("\n"):
        lines.append(f"data: {data_line}")
    return "\n".join(lines)


def _extract_stream_delta(payload: dict[str, Any], wire: str) -> str | None:
    if wire == "responses":
        if payload.get("type") == "response.output_text.delta":
            delta = payload.get("delta")
            return delta if isinstance(delta, str) else None
        return None
    choice = (payload.get("choices") or [{}])[0]
    delta = (choice.get("delta") or {}).get("content")
    return delta if isinstance(delta, str) else None


def _stream_error_event(error: LlmError) -> LlmStreamEvent:
    return LlmStreamEvent(
        kind="error",
        error=error,
        failure_kind=classify_llm_failure_kind(error),
    )


def _stream_error_from_payload(payload: dict[str, Any]) -> LlmStreamEvent | None:
    raw_error = payload.get("error")
    if raw_error is None:
        return None
    if isinstance(raw_error, dict):
        message = raw_error.get("message") or raw_error.get("type") or json.dumps(raw_error)
        status_value = raw_error.get("status") or raw_error.get("status_code") or raw_error.get("code")
    else:
        message = str(raw_error)
        status_value = None

    try:
        status = int(status_value) if status_value is not None else None
    except (TypeError, ValueError):
        status = None
    return _stream_error_event(LlmError(str(message), status=status, transient=False))


def _iter_stream_events_from_parsed_sse(
    source: Iterable[SSEEvent],
    *,
    wire: str,
    model: str,
    provider: str | None,
    started: float,
    now: Callable[[], float] = time.time,
) -> list[LlmStreamEvent]:
    raw_chunks: list[str] = []
    for event in source:
        if event.event == "error":
            try:
                payload = json.loads(event.data)
            except json.JSONDecodeError:
                return [_stream_error_event(LlmError(event.data, transient=False))]
            if isinstance(payload, dict):
                error = _stream_error_from_payload(payload)
                if error is not None:
                    return [error]
            return [_stream_error_event(LlmError(event.data, transient=False))]
        raw_chunks.append(_event_to_sse_chunk(event))

    return iter_stream_events_from_sse(
        "\n\n".join(raw_chunks),
        wire=wire,
        model=model,
        provider=provider,
        started=started,
        now=now,
    )


def iter_stream_events_from_sse_source(
    source: Iterable[SSEEvent],
    *,
    wire: str,
    model: str,
    provider: str | None,
    started: float,
    now: Callable[[], float] = time.time,
) -> list[LlmStreamEvent]:
    return _iter_stream_events_from_parsed_sse(
        source,
        wire=wire,
        model=model,
        provider=provider,
        started=started,
        now=now,
    )


def iter_stream_events_from_sse(
    raw: str,
    *,
    wire: str,
    model: str,
    provider: str | None,
    started: float,
    now: Callable[[], float] = time.time,
) -> list[LlmStreamEvent]:
    content_parts: list[str] = []
    usage: dict[str, Any] | None = None
    finish_reason: str | None = None
    resolved_model = model
    events: list[LlmStreamEvent] = []

    for event in parse_sse(raw):
        if event.data == "[DONE]":
            break
        try:
            payload = json.loads(event.data)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue

        error = _stream_error_from_payload(payload)
        if error is not None:
            events.append(error)
            return events

        if isinstance(payload.get("model"), str):
            resolved_model = payload["model"]

        delta = _extract_stream_delta(payload, wire)
        if delta:
            content_parts.append(delta)
            events.append(LlmStreamEvent(kind="chunk", delta=delta))

        if wire == "responses":
            if payload.get("type") == "response.completed":
                response = payload.get("response") or {}
                if response.get("error"):
                    error = LlmError(
                        f"LLM response failed: {json.dumps(response['error'])}",
                        transient=False,
                    )
                    events.append(_stream_error_event(error))
                    return events
                if response.get("usage"):
                    usage = response["usage"]
                if not content_parts:
                    text, _, _ = _extract(response, wire)
                    if text:
                        content_parts.append(text)
        else:
            choice = (payload.get("choices") or [{}])[0]
            reason = choice.get("finish_reason")
            if isinstance(reason, str):
                finish_reason = reason
            if payload.get("usage"):
                usage = payload["usage"]

    content = "".join(content_parts)
    if not content.strip():
        events.append(_stream_error_event(LlmError("empty content from LLM stream", transient=False)))
        return events

    result = LlmResult(
        content=content,
        usage=usage,
        finish_reason=finish_reason,
        model=resolved_model,
        latency_ms=int((now() - started) * 1000),
        provider=provider,
    )
    events.append(LlmStreamEvent(kind="done", result=_finalize_result(result)))
    return events


_result_hook_var: ContextVar[Optional[Callable[["LlmResult"], None]]] = ContextVar(
    "sliderule_llm_result_hook", default=None
)


def llm_result_hook_active() -> bool:
    return _result_hook_var.get() is not None


@contextmanager
def result_hook(fn: Callable[["LlmResult"], None]) -> Iterator[None]:
    """请求域观察者：每次成功的 LLM 调用（_finalize_result）调一次。

    用量台账挂在这里，而不是散落在 `parsed, _ = call_llm_json` 那些丢弃点。
    观察者自己炸了必须静默——增强类 fail-open。
    """
    token = _result_hook_var.set(fn)
    try:
        yield
    finally:
        _result_hook_var.reset(token)


def _finalize_result(result: LlmResult) -> LlmResult:
    finalized = LlmResult(
        content=result.content,
        usage=normalize_usage(result.usage),
        finish_reason=normalize_finish_reason(result.finish_reason),
        model=result.model,
        latency_ms=result.latency_ms,
        provider=result.provider,
    )
    out = replace(finalized, telemetry=build_llm_telemetry(finalized))
    hook = _result_hook_var.get()
    if hook is not None:
        try:
            hook(out)
        except Exception:  # noqa: BLE001 — 观察者不许拖垮主调用
            pass
    return out



def _call_llm_once(
    messages: list[Message],
    *,
    cfg: LlmConfig,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
    timeout_ms: int | None = None,
) -> LlmResult:
    if not cfg.api_key:
        raise LlmError("LLM not configured (no api_key)", transient=False)
    # 预算在**这里**兜底，不在签名默认值上：以前写死 2000，凡是没显式传的调用点
    # 都被悄悄按在 2000——推理模型下等于必然空正文。见 config.DEFAULT_MAX_TOKENS。
    # 2026-09-19：默认不设限，请求不带 max_tokens。显式数字仍 clamp。
    max_tokens = resolve_wire_max_tokens(max_tokens)
    messages = _normalize_messages(messages)
    if _has_image_content_parts(messages) and not cfg.supports_image_content_parts:
        raise LlmError(
            f"provider {cfg.provider_name or cfg.base_url} does not support image content parts",
            transient=False,
        )
    model = model or cfg.model
    reasoning = reasoning_effort if reasoning_effort is not None else cfg.reasoning_effort
    timeout_s = (timeout_ms or cfg.timeout_ms) / 1000.0

    if cfg.wire_api == "responses":
        url = f"{cfg.base_url}/responses"
        payload = _responses_payload(messages, model, temperature, max_tokens, reasoning, cfg.stream)
    else:
        url = f"{cfg.base_url}/chat/completions"
        payload = _chat_payload(messages, model, temperature, max_tokens, reasoning, cfg.stream)

    started = time.time()
    try:
        with httpx.Client(timeout=_http_timeout(timeout_s)) as client:
            r = client.post(url, headers=_headers(cfg.api_key), json=payload)
    except httpx.TimeoutException as e:
        raise LlmError(
            _describe_timeout(e, timeout_s, time.time() - started), transient=True
        ) from e
    except httpx.HTTPError as e:
        raise LlmError(f"cannot reach {url}: {_describe_http_error(e)}", transient=True) from e

    latency = int((time.time() - started) * 1000)
    if r.status_code >= 400:
        raise _normalize_error(r.status_code, r.text)

    try:
        data = r.json()
    except json.JSONDecodeError as e:
        raise LlmError(f"non-JSON response: {r.text[:200]}", transient=False) from e

    content, usage, finish = _extract(data, cfg.wire_api)
    if not content.strip():
        raise LlmError(
            f"empty content from LLM {_empty_content_hint(finish, max_tokens, usage)}",
            status=r.status_code,
            transient=False,
        )
    return LlmResult(
        content=content,
        usage=usage,
        finish_reason=finish,
        model=str(data.get("model") or model),
        latency_ms=latency,
        provider=cfg.provider_name,
    )


def _call_llm_once_streaming(
    messages: list[Message],
    *,
    cfg: LlmConfig,
    on_delta: Callable[[str], None],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
    timeout_ms: int | None = None,
) -> LlmResult:
    """Streaming twin of _call_llm_once — consumes the provider SSE stream,
    invoking on_delta per content chunk (推演可观测性：让 UI 实时看到 LLM 的
    生成过程)。语义与非流式版一致：任何失败 raise LlmError，空内容 fail-closed。
    """
    if not cfg.api_key:
        raise LlmError("LLM not configured (no api_key)", transient=False)
    # 预算在**这里**兜底，不在签名默认值上：以前写死 2000，凡是没显式传的调用点
    # 都被悄悄按在 2000——推理模型下等于必然空正文。见 config.DEFAULT_MAX_TOKENS。
    # 2026-09-19：默认不设限，请求不带 max_tokens。显式数字仍 clamp。
    max_tokens = resolve_wire_max_tokens(max_tokens)
    messages = _normalize_messages(messages)
    if _has_image_content_parts(messages) and not cfg.supports_image_content_parts:
        raise LlmError(
            f"provider {cfg.provider_name or cfg.base_url} does not support image content parts",
            transient=False,
        )
    model = model or cfg.model
    reasoning = reasoning_effort if reasoning_effort is not None else cfg.reasoning_effort
    timeout_s = (timeout_ms or cfg.timeout_ms) / 1000.0
    wire = cfg.wire_api

    if wire == "responses":
        url = f"{cfg.base_url}/responses"
        payload = _responses_payload(messages, model, temperature, max_tokens, reasoning, True)
    else:
        url = f"{cfg.base_url}/chat/completions"
        payload = _chat_payload(messages, model, temperature, max_tokens, reasoning, True)

    started = time.time()
    content_parts: list[str] = []
    usage: dict[str, Any] | None = None
    finish: str | None = None
    resolved_model = model
    try:
        with httpx.Client(timeout=_http_timeout(timeout_s)) as client:
            with client.stream("POST", url, headers=_headers(cfg.api_key), json=payload) as r:
                if r.status_code >= 400:
                    body = r.read().decode("utf-8", "replace")
                    raise _normalize_error(r.status_code, body)
                for line in r.iter_lines():
                    line = (line or "").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        payload_obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(payload_obj, dict):
                        continue
                    error_event = _stream_error_from_payload(payload_obj)
                    if error_event is not None and error_event.error is not None:
                        raise error_event.error
                    if isinstance(payload_obj.get("model"), str):
                        resolved_model = payload_obj["model"]
                    delta = _extract_stream_delta(payload_obj, wire)
                    if delta:
                        content_parts.append(delta)
                        try:
                            on_delta(delta)
                        except Exception:
                            pass  # observability hook must never break the call
                    if wire == "responses":
                        if payload_obj.get("type") == "response.completed":
                            response = payload_obj.get("response") or {}
                            if response.get("usage"):
                                usage = response["usage"]
                    else:
                        choice = (payload_obj.get("choices") or [{}])[0]
                        if isinstance(choice.get("finish_reason"), str):
                            finish = choice["finish_reason"]
                        if payload_obj.get("usage"):
                            usage = payload_obj["usage"]
    except httpx.TimeoutException as e:
        raise LlmError(
            _describe_timeout(e, timeout_s, time.time() - started), transient=True
        ) from e
    except httpx.HTTPError as e:
        raise LlmError(f"cannot reach {url}: {_describe_http_error(e)}", transient=True) from e

    latency = int((time.time() - started) * 1000)
    content = "".join(content_parts)
    if not content.strip():
        raise LlmError(
            f"empty content from LLM (stream) {_empty_content_hint(finish, max_tokens, usage)}",
            transient=False,
        )
    return LlmResult(
        content=content,
        usage=usage,
        finish_reason=finish,
        model=str(resolved_model),
        latency_ms=latency,
        provider=cfg.provider_name,
    )


def call_llm(
    messages: list[Message],
    *,
    config: LlmConfig | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
    timeout_ms: int | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> LlmResult:
    """Provider-chain LLM call. Raises LlmError on any failure (never returns a stub).

    on_delta 提供时走流式（逐块回调内容增量），否则保持既有非流式路径。
    """
    providers = build_provider_configs(config)
    if not providers:
        raise LlmError("LLM not configured (no provider chain)", transient=False)

    last_error: LlmError | None = None
    for _name, cfg in providers:
        try:
            if on_delta is not None:
                return _finalize_result(
                    _call_llm_once_streaming(
                        messages,
                        cfg=cfg,
                        on_delta=on_delta,
                        model=model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        reasoning_effort=reasoning_effort,
                        timeout_ms=timeout_ms,
                    )
                )
            return _finalize_result(
                _call_llm_once(
                    messages,
                    cfg=cfg,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    reasoning_effort=reasoning_effort,
                    timeout_ms=timeout_ms,
                )
            )
        except LlmError as error:
            last_error = error
            if config is not None or not should_try_next_provider(error):
                raise
    if last_error is not None:
        raise last_error
    raise LlmError("LLM provider chain exhausted", transient=False)


# ── JSON helper (port of callLLMJson: strip ```json fences, parse) ────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = _FENCE_RE.sub("", t).strip()
    return t


def classify_llm_failure_kind(error: LlmError) -> str:
    """Align Python failure labels with Node llm-client semantics."""
    status = error.status
    message = str(error).lower()
    if status == 429 or "rate limit" in message or "rate_limit" in message or "out of quota" in message:
        return "rate_limit"
    if status in (401, 403) or "auth" in message:
        return "auth"
    if status == 404 or "model/endpoint mismatch" in message:
        return "not_found"
    if "timeout" in message or status == 524:
        return "timeout"
    if status is not None and 500 <= status < 600:
        return "upstream"
    if error.transient:
        return "transient"
    return "unknown"


#: 对冲阈值（毫秒）。0 或负数 = 关闭对冲，退回纯重试语义。
#:
#: 默认 30s 是从真机日志量出来的：同一个能力自己跟自己差 3~6 倍——
#: critique.generate 74.8s vs 22.6s、synthesis.merge 69.0s vs 11.3s。
#: 差这么多不是活变重了，是网关排队抖动。取值要落在"正常请求已经回来了、
#: 慢请求还在等"这个区间：太小会把每个请求都变成两个（白烧配额），
#: 太大则等于没开。
_HEDGE_DELAY_MS_DEFAULT = 30_000


def _hedge_delay_ms() -> int:
    raw = os.getenv("LLM_HEDGE_DELAY_MS")
    if raw is None or not str(raw).strip():
        return _HEDGE_DELAY_MS_DEFAULT
    try:
        return int(str(raw).strip())
    except ValueError:
        return _HEDGE_DELAY_MS_DEFAULT


#: 连接阶段的超时。**照抄 openai SDK 的默认**（openai/_constants.py:9：
#: `DEFAULT_TIMEOUT = httpx.Timeout(timeout=600, connect=5.0)`）。
#:
#: ## 为什么要单独拆出来（2026-08-14 真机）
#:
#: 此前给 httpx 传的是一个**裸数字**，而那个值会被同时用在四个阶段上
#: （connect / read / write / pool）。于是 LLM_TIMEOUT_MS=600000 不只是
#: "读响应最多等 10 分钟"，连"建连最多等 10 分钟"也一起给了。
#:
#: 代价实测到了：一次 `Server disconnected without sending a response`
#: **挂了 331 秒才失败**，三次重试就是十几分钟——而收尾那 821 秒的黑洞
#: 正是这么来的（见 [llm-retry] 那行日志）。
#:
#: ⚠ **read 那 600 秒不能动**：一次页面生成实测 149~200s、bind 单页 185s，
#:   缩短读超时会当场误杀正常的长生成。要治的只是"建不上连还傻等"。
_CONNECT_TIMEOUT_SECONDS = float(os.getenv("LLM_CONNECT_TIMEOUT_SECONDS", "5"))


def _http_timeout(timeout_s: float) -> "httpx.Timeout":
    """整体 timeout_s，**只把 connect 压短**。形状与 openai SDK 一致。"""
    return httpx.Timeout(timeout=timeout_s, connect=_CONNECT_TIMEOUT_SECONDS)


def _describe_timeout(error: Exception, timeout_s: float, waited_s: float) -> str:
    """超时要说清**哪一档**超的、真等了多久、预算是多少。

    ⚑ 2026-08-17 真机踩到，一行自相矛盾的日志：

        [llm-retry] 第 2/3 次失败（可重试，耗时 5.2s）：timeout after 600s

    **耗时 5.2 秒却报 600 秒，差 120 倍。** 根因：`_http_timeout` 把 connect
    压到 5s、其余三档留 600s（见上），而 `httpx.ConnectTimeout` 是
    `TimeoutException` 的子类，被这个分支一把捞走之后，消息里填的是**配置的
    整体预算** `timeout_s`，不是真正生效的那档。

    这跟下面 `_describe_http_error`（2026-08-14）是**同一个病**：不同的失败
    长成同一行日志。当时只修了 `HTTPError` 分支，`TimeoutException` 分支漏了
    ——典型的只改一半，而且因为两个 except 挨着写，看代码时特别容易略过。

    后果不是不好看：**连不上**（该查网关可达性/网络）和**生成太慢**（该查模型
    与预算）要的修法完全相反，而日志把前者写成了后者。收尾那 821 秒的黑洞
    至今没定论，靠的就是这类分不出成分的日志。
    """
    kind = type(error).__name__
    budget = _CONNECT_TIMEOUT_SECONDS if isinstance(error, httpx.ConnectTimeout) else timeout_s
    return f"{kind} after {waited_s:.1f}s (budget {budget:.0f}s)"


def _describe_http_error(error: Exception) -> str:
    """把 httpx 异常的**类型**带出来。

    ⚑ 2026-08-14：此前 ConnectError / RemoteProtocolError / ReadError 全被
      `except httpx.HTTPError` 一把捞走，消息里只有 "cannot reach …"。
      于是"连不上"和"连上了但对面中途断开"在日志里长得一模一样——
      而这两者要的修法不同（前者靠短 connect 超时，后者得靠首字节超时或对冲）。
      331 秒那次就卡在分不出是哪一种。
    """
    return f"{type(error).__name__}: {error}"


def call_llm_with_retry(
    messages: list[Message],
    *,
    max_attempts: int = 3,
    backoff_ms: int = 200,
    **kwargs: Any,
) -> LlmResult:
    """带重试 + **对冲**的调用（对冲于 2026-08-04 加入）。

    ## 重试和对冲是两件事，别混

    · **重试**治的是"失败了"——请求抛错才有第二次，串行。
    · **对冲**治的是"慢"——请求**没失败也没回来**，超过阈值就并发再发一份，
      谁先回用谁。原始那份不取消（它可能马上就回），只是不再等它。

    真机数据说明为什么需要后者：同一个能力自己跟自己差 3~6 倍
    （critique.generate 74.8s vs 22.6s，synthesis.merge 69.0s vs 11.3s）。
    这类请求**从不报错**，所以重试一次都不会触发；它只是排在网关队列后面。
    一次 6.4 分钟的执行里，这两条离群值吃掉 143.8s——占全部能力时间的 41%。

    ## 语义照抄 gRPC 的 hedging policy

    gRPC 的 `hedgingPolicy`（hedgingDelay / maxAttempts / 非致命状态码）是这套
    做法的成熟形态，Envoy 与「The Tail at Scale」讲的是同一件事。三条关键约定
    这里都保留：

      ① **只对冲一次**（相当于 maxAttempts=2）。不设上限的话，网关一旦整体变慢，
         每个请求都会裂变成 N 个，把它压得更慢——对冲是治长尾，不是治过载。
      ② **谁先回用谁，另一份直接丢**。不比较内容、不做仲裁：两份都是合法输出，
         选先到的那份既最快也最简单。
      ③ **对冲副本失败不算数**。副本报错时仍然等原始那份的结果/异常——否则
         "为了更快"反而把一次本来会成功的调用变成失败。

    ## 两条边界（2026-08-04 补，真机 A/B 量出来的）

    上面三条抄全了，但漏了 gRPC 的第四条：**hedgingPolicy 与 retryPolicy 在
    gRPC 的 method config 里是互斥的**（只能配其一）。漏掉的代价实测如下。

    同一道题跑三轮，只差 `LLM_HEDGE_DELAY_MS`：

        对冲开   五系统模型流出 ——        · 18.2 分钟闭环
        对冲关   五系统模型流出  53,172 字 · 28.1 分钟闭环
        对冲开   五系统模型流出 316,932 字 · 30.8 分钟**未闭环**

    其余 7 个能力的字数在两组之间是 1.0~1.2 倍（几乎一致），**只有
    five-system-model 一条炸到 6.0 倍**——排除了"多跑了几轮"这个解释。

    ⚠️ 一条**当时读错、事后订正**的观测：起初还记了"流式主路失败次数 1/0/2，
    对冲关那组是 0"，据此以为对冲也是那个报错的原因。复查发现对冲关那组**同样
    出现了 1 次**——第一次统计时那一轮还没跑完，读的是中间态。所以
    `legacy stream failed` 与对冲无关（多半是模型输出超长被截断），
    **不要**把它当成这两条边界的依据。依据只有上面那组逐标签字数，
    以及单元用例里可复现的交错。

    **边界一：`on_delta` 在场时不对冲。**
    对冲的两份副本会**同时**往同一个 on_delta 里推，UI 上就是两份不同的生成
    逐块交错。返回值仍然只取一份（是对的），但用户眼前的流式文字是花的。
    流式的意义就是"边生成边看"，第二份从第一个 token 起就是脏的——除非把副本
    增量全缓冲起来等胜负揭晓，而那等于放弃流式。所以直接不对冲。

    **边界二：重试的第 2 次起不对冲。**
    不设这条会**相乘**：`max_attempts` × `max_shape_retries` × 对冲，
    每次重试都重新对冲一遍。而对冲弄脏流式内容 → 结构校验失败 → 触发重试 →
    又对冲，自己喂自己。31.7 万字（6 倍）就是这么滚出来的。
    重试本身已经是对"这次失败了"的响应，给一个已知失败的请求再配一个影子
    只会放大问题。

    两条边界之后，同一个逻辑调用最多只有 2 个并发生成（对冲的本意），
    而不是 6~8 个。

    ## 为什么不用现成的库

    这段逻辑一共几十行，而且要贴着我们自己的 `LlmError.transient` 语义走。
    引一个通用重试库（tenacity 之类）反而要把这三条约定翻译成它的配置词汇，
    读代码的人得先读那个库才能看懂我们的取舍。抄的是 gRPC 的**语义**，
    不是它的实现。
    """
    # 边界一：流式一律不对冲（见上）。判据是**调用方传没传 on_delta**，
    # 不是"通道支不支持流式"——真正决定会不会双写的是有没有那个回调。
    # 过夜 525 过密：熔断开着连第一下都不发（话术带 525，上层才不会 GEN5）。
    # 半开探活 / 关闭态走下面的循环。详见 gateway_circuit 头注。
    from .gateway_circuit import note_failure, note_success, reject_reason, retries_allowed

    blocked = reject_reason()
    if blocked is not None:
        raise LlmError(blocked, status=525, transient=True)

    delay_ms = 0 if kwargs.get("on_delta") is not None else _hedge_delay_ms()
    last_error: LlmError | None = None
    for attempt in range(1, max_attempts + 1):
        # AWS standard：熔断开了只关重试。半开探活也只打第一下，不对冲。
        if attempt > 1 and not retries_allowed():
            if last_error is not None:
                raise last_error
            raise LlmError(
                "gateway circuit open (525): retries disabled",
                status=525,
                transient=True,
            )
        _t0 = time.monotonic()
        try:
            # 边界二：只有第一次尝试对冲，重试不再对冲（见上，防相乘）
            hedge_ms = delay_ms if attempt == 1 and retries_allowed() else 0
            result = _call_llm_hedged(messages, hedge_ms, **kwargs)
            note_success()
            return result
        except LlmError as error:
            last_error = error
            # ⚑ 2026-08-14 补这一行日志：**重试此前是完全静默的**。
            #
            # 代价实测过两次：第 3 步那次 429 查了半天（对外报的是"模型吐了坏
            # JSON"，真因埋在静默重试里）；收尾那 821 秒到现在都没定论，
            # 因为"重试了三轮"和"某处卡住了"在日志里长得一模一样。
            #
            # ⚠ 打 stderr 不打 stdout：这层是库，产出走返回值，日志不该混进
            #   调用方的正常输出里。
            _took = time.monotonic() - _t0
            _kind = "可重试" if error.transient else "不可重试"
            _status = f"HTTP {error.status} " if getattr(error, "status", None) else ""
            print(
                f"[llm-retry] 第 {attempt}/{max_attempts} 次失败（{_status}{_kind}，"
                f"耗时 {_took:.1f}s）：{str(error)[:160]}",
                file=sys.stderr,
                flush=True,
            )
            note_failure(error)
            if not error.transient or attempt >= max_attempts:
                raise
            if not retries_allowed():
                raise
            time.sleep(backoff_ms / 1000.0)
    if last_error is not None:
        raise last_error
    raise LlmError("call_llm_with_retry exhausted without result", transient=False)


def _call_llm_hedged(messages: list[Message], delay_ms: int, **kwargs: Any) -> LlmResult:
    """一次调用；超过 delay_ms 还没回就并发补发一份，取先到的那个。

    delay_ms <= 0 时**完全走老路径**（直接 call_llm，不建线程池）——关掉对冲
    的环境里不该为一个用不到的功能付出任何额外开销。
    """
    if delay_ms <= 0:
        return call_llm(messages, **kwargs)

    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    # 不用 with：块退出时 ThreadPoolExecutor 会 join 所有线程，那会把"不再等
    # 慢的那份"这件事整个抵消掉——原始请求还在跑，我们就卡在这里等它。
    pool = ThreadPoolExecutor(max_workers=2)
    try:
        primary = pool.submit(call_llm, messages, **kwargs)
        done, _ = wait([primary], timeout=delay_ms / 1000.0, return_when=FIRST_COMPLETED)
        if done:
            return primary.result()  # 正常路径：没超时，跟以前逐字一样

        hedge = pool.submit(call_llm, messages, **kwargs)
        pending = {primary, hedge}
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for fut in done:
                try:
                    return fut.result()
                except LlmError:
                    # 约定③：副本失败不算数，继续等另一份。两份都失败时
                    # 循环退出，下面按原始那份的异常抛——报错要报真实那次的。
                    if not pending:
                        return primary.result()
        return primary.result()
    finally:
        # 不等在跑的线程：慢的那份自己会结束，它的结果没人取，直接丢掉。
        pool.shutdown(wait=False)


def parse_llm_json_shape(
    payload: dict[str, Any],
    *,
    required_keys: tuple[str, ...],
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise LlmError("JSON shape is not an object", transient=False)
    missing = [key for key in required_keys if not payload.get(key)]
    if missing:
        raise LlmError(f"JSON missing required keys: {', '.join(missing)}", transient=False)
    return payload


def call_llm_json_with_shape(
    messages: list[Message],
    *,
    required_keys: tuple[str, ...],
    max_shape_retries: int = 0,
    **kwargs: Any,
) -> tuple[dict[str, Any], LlmResult]:
    last_error: LlmError | None = None
    for attempt in range(max_shape_retries + 1):
        parsed, result = call_llm_json(messages, **kwargs)
        try:
            return parse_llm_json_shape(parsed, required_keys=required_keys), result
        except LlmError as error:
            last_error = error
            if attempt >= max_shape_retries:
                raise
    if last_error is not None:
        raise last_error
    raise LlmError("JSON shape validation failed", transient=False)


def _repair_llm_json_object(raw: str) -> dict[str, Any] | None:
    """语法烂、结构还在：用 json-repair 机械补一次（freeform 已用过）。

    instructor 会把这种当校验失败再问一轮 LLM。本仓第 3 步和 spec_llm_call
    头注写过：传输层已经退避过了，再问是浪费。截断不当修——补出来的尾巴
    是猜的，看起来像成功。
    """
    try:
        import json_repair

        payload = json.loads(json_repair.repair_json(raw))
    except Exception:  # noqa: BLE001 — 修不了就当没修，调用方照旧报 parse
        return None
    return payload if isinstance(payload, dict) else None


def call_llm_json(messages: list[Message], **kwargs: Any) -> tuple[dict[str, Any], LlmResult]:
    """call_llm_with_retry + parse the content as a JSON object. Raises LlmError if not parseable."""
    max_attempts = int(kwargs.pop("max_attempts", 3))
    # 报**生效的那个数**，不是 "default"：截断消息里写 "default" 等于没写，
    # 读的人还得回头去猜到底是多少（跟 _empty_content_hint 同一条教训）。
    max_tokens = resolve_wire_max_tokens(kwargs.get("max_tokens"))
    result = call_llm_with_retry(messages, max_attempts=max_attempts, **kwargs)
    raw = _strip_fences(result.content)
    if not raw.startswith("{"):
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            raw = m.group(0)
    try:
        return json.loads(raw), result
    except json.JSONDecodeError as e:
        if result.finish_reason == "length":
            raise LlmError(
                f"LLM JSON response was truncated by the max token limit ({format_max_tokens(max_tokens)}). "
                "Raise LLM_MAX_TOKENS or reduce the requested JSON size.",
                transient=False,
            ) from e
        repaired = _repair_llm_json_object(raw)
        if repaired is not None:
            print("[llm] JSON parse 失败，json-repair 救回，不重问")
            return repaired, result
        raise LlmError(f"LLM JSON parse failed: {result.content[:200]}", transient=False) from e
