"""Control-plane LLM client — separate payload, MAY include tools.

Q1=A：工具调用只活在这一份 payload 里。factory sliderule_llm/client.py 的
`_chat_payload` 禁止长 tools 字段——生成器路径保持无工具。

空 content **带着 tool_calls** 是合法回复（模型经常把话全放进工具参数）。
factory 客户端把空 content 当失败，所以控制面不能复用那条提取。
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .client import (
    LlmError,
    _headers,
    _http_timeout,
    _normalize_error,
    _normalize_messages,
    _describe_http_error,
    _describe_timeout,
    _empty_content_hint,
)
from .config import (
    ensure_llm_proxy_bypass,
    get_llm_config,
    resolve_wire_max_tokens,
)
from .gateway_circuit import (  # 叶子（顶层只有标准库），无循环，顶层 import 让这条边留在架构闸上
    note_failure,
    note_success,
    reject_reason,
    retries_allowed,
)
from .retry_budget import charge_retry  # 同上：叶子，顶层 import 让这条边留在闸上
from .doom_loop import Collector as DoomLoopCollector, peek as peek_doom_loop
from .empty_sample import (
    MAX_EMPTY_RESAMPLES,
    empty_reason,
    message_reasoning,
    should_resample_empty,
)


@dataclass
class ControlLlmResult:
    content: str
    tool_calls: list[dict[str, Any]]
    usage: dict[str, Any] | None
    finish_reason: str | None
    model: str
    latency_ms: int


def _inline_tool_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Send self-contained parameter schemas while keeping typed input checks.

    2026-09-12: the first real project-model smoke failed before choosing any
    tool. Gemini's OpenAI gateway rejected project_patch.changes.items.$ref;
    scripted tool dispatch had never sent the Pydantic schema to a provider.
    Keep $defs in the canonical schema and inline only this transport copy.
    Reference siblings remain a conjunction, never overwrite target checks.
    """
    maps = {"properties", "patternProperties", "dependentSchemas"}
    singles = {"items", "additionalProperties", "additionalItems", "contains", "propertyNames",
               "not", "if", "then", "else", "unevaluatedProperties", "unevaluatedItems", "contentSchema"}
    arrays = {"allOf", "anyOf", "oneOf", "prefixItems"}
    annotations = {"title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "$comment"}

    def visit(node, ancestors=()):
        if isinstance(node, bool):
            return node
        if not isinstance(node, dict):
            raise ValueError("invalid_tool_schema")
        siblings = {}
        for key, value in node.items():
            if key in {"$defs", "definitions", "$ref"}:
                continue
            if key in maps:
                siblings[key] = {name: visit(child, ancestors) for name, child in value.items()}
            elif key in singles:
                siblings[key] = ([visit(child, ancestors) for child in value]
                                 if isinstance(value, list) else visit(value, ancestors))
            elif key in arrays:
                siblings[key] = [visit(child, ancestors) for child in value]
            elif key == "dependencies":
                siblings[key] = {name: copy.deepcopy(child) if isinstance(child, list) else visit(child, ancestors)
                                 for name, child in value.items()}
            else:
                # default/const/examples contain data; a literal "$ref" key in
                # that data (or in a property name) is not a schema reference.
                siblings[key] = copy.deepcopy(value)
        if "$ref" not in node:
            return siblings
        reference = node["$ref"]
        if not isinstance(reference, str) or not reference.startswith("#/"):
            raise ValueError("tool_schema_reference_must_be_local_pointer")
        if reference in ancestors:
            raise ValueError("recursive_tool_schema_reference")
        target = schema
        try:
            for part in reference[2:].split("/"):
                target = target[part.replace("~1", "/").replace("~0", "~")]
        except (KeyError, TypeError) as exc:
            raise ValueError("unknown_tool_schema_reference") from exc
        expanded = visit(target, (*ancestors, reference))
        if not siblings:
            return expanded
        # Even disjoint validation keywords may interact if flattened:
        # additionalProperties:false in the target must not start recognizing
        # properties introduced by a reference sibling. Only annotations merge.
        if isinstance(expanded, dict) and siblings.keys() <= annotations:
            return {**expanded, **siblings}
        return {"allOf": [expanded, siblings]}

    return visit(schema)


def _control_chat_payload(
    messages: list[dict[str, Any]],
    model: str,
    temperature: float,
    max_tokens: int | None,
    tools: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if tools:
        payload["tools"] = copy.deepcopy(tools)
        for tool in payload["tools"]:
            function = tool.get("function")
            if isinstance(function, dict) and isinstance(function.get("parameters"), dict):
                function["parameters"] = _inline_tool_schema(function["parameters"])
        payload["tool_choice"] = "auto"
    return payload


def _parse_tool_calls(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        fn = item.get("function") if isinstance(item.get("function"), dict) else {}
        args: Any = fn.get("arguments") if fn else item.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except json.JSONDecodeError:
                args = {"_raw": args}
        if not isinstance(args, dict):
            args = {}
        name = str((fn or {}).get("name") or item.get("name") or "")
        if not name:
            continue
        out.append(
            {
                "id": str(item.get("id") or ""),
                "name": name,
                "arguments": args,
            }
        )
    return out


def _extract_control(data: dict[str, Any]) -> tuple[str, list[dict[str, Any]], dict | None, str | None]:
    choice = (data.get("choices") or [{}])[0] or {}
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    if not isinstance(content, str):
        content = str(content or "")
    tool_calls = _parse_tool_calls(msg.get("tool_calls"))
    # A few OpenAI-compatible gateways still emit the pre-2023 singular
    # `function_call` shape. Treat it as one tool call so an empty message
    # body does not get misclassified as an LLM failure.
    if not tool_calls and isinstance(msg.get("function_call"), dict):
        tool_calls = _parse_tool_calls([msg["function_call"]])
    if not tool_calls and isinstance(choice.get("function_call"), dict):
        tool_calls = _parse_tool_calls([choice["function_call"]])
    return content, tool_calls, data.get("usage"), choice.get("finish_reason")


def _termination_metadata(data: dict[str, Any]) -> tuple[str | None, dict[str, int] | None]:
    """Keep fixed, bounded provider diagnostics without carrying response text.

    2026-09-12: a real project turn returned content_filter and 5759 billed
    tokens. The old empty-body error lost both facts. Read termination before
    parsing partial tool arguments or logging provider extension fields.
    """
    choice = (data.get("choices") or [{}])[0] or {}
    raw_finish = choice.get("finish_reason") if isinstance(choice, dict) else None
    finish = raw_finish.strip().lower() if isinstance(raw_finish, str) else None
    if finish not in {None, "stop", "length", "content_filter", "tool_calls", "function_call"}:
        finish = "unknown"
    raw_usage = data.get("usage")
    if not isinstance(raw_usage, dict):
        return finish, None
    usage: dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "reasoning_tokens", "total_tokens"):
        value = raw_usage.get(key)
        # Do not interpolate arbitrary provider strings, objects, bools or
        # huge integers into a durable error/checkpoint. JSON token counts
        # are non-negative integers; malformed counters remain unavailable.
        if type(value) is int and 0 <= value <= 2**63 - 1:
            usage[key] = value
    details = raw_usage.get("completion_tokens_details")
    if "reasoning_tokens" not in usage and isinstance(details, dict):
        value = details.get("reasoning_tokens")
        if type(value) is int and 0 <= value <= 2**63 - 1:
            usage["reasoning_tokens"] = value
    return finish, usage or None


async def call_control_llm(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout_ms: int | None = None,
) -> ControlLlmResult:
    """控制面专用。失败 raise LlmError；空正文但有 tool_calls 算成功。

    瞬时错误（522/524/5xx/超时）重试两次。工厂路径 `call_llm_with_retry`
    已经这么干；控制面以前一发 522 就罐头「网关连不上」（2026-09-08）。
    不对冲：cheap 回合不需要第二份影子，取消还得能掐断。
    """
    ensure_llm_proxy_bypass()

    blocked = reject_reason()
    if blocked is not None:
        raise LlmError(blocked, status=525, transient=True)

    last_error: LlmError | None = None
    empty_resamples = 0
    for attempt in range(1, 4):
        if attempt > 1 and not retries_allowed():
            if last_error is not None:
                raise last_error
            raise LlmError(
                "gateway circuit open (525): retries disabled",
                status=525,
                transient=True,
            )
        try:
            result = await _call_control_llm_once(
                messages,
                tools=tools,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout_ms=timeout_ms,
            )
            note_success()
            return result
        except asyncio.CancelledError:
            raise
        except LlmError as error:
            task = asyncio.current_task()
            if task is not None and task.cancelled():
                # httpx 有时把取消收成 ReadError → LlmError。再重试就把
                # 「真的停了」变成第二发还在烧（取消判据会红）。
                raise asyncio.CancelledError() from error
            last_error = error
            note_failure(error)
            # 空回复跟 522 共用这一圈，但只许再采 1 发。TicketStream 那发
            # 5874 token，套 522 的三次会把「只想不干」变成烧钱循环。
            if error.empty_reason and empty_resamples >= MAX_EMPTY_RESAMPLES:
                if error.transient:
                    raise LlmError(
                        str(error),
                        status=error.status,
                        transient=False,
                        usage=error.usage,
                        finish_reason=error.finish_reason,
                        empty_reason=error.empty_reason,
                    ) from error
                raise
            if not error.transient or attempt >= 3:
                raise
            if not retries_allowed():
                raise
            if error.empty_reason:
                empty_resamples += 1
                print(
                    f"[control] empty sample empty_reason={error.empty_reason} "
                    f"finish={error.finish_reason or 'unknown'} "
                    f"resample={empty_resamples}/{MAX_EMPTY_RESAMPLES}",
                    flush=True,
                )
            # 抄 grok 的第二层：**整个回合累计**的重试上限，中途永不清零。
            #
            # ⚠ 上面那个 `attempt >= 3` 是第一层（每次调用 3 次，下一次调用
            #   又从 1 开始）。一个控制面回合最多 8 次调用，所以只有第一层时
            #   一回合能烧到 24 次重试——而三道现有的闸（45s 墙钟 / 8000 token
            #   / 8 轮）量的都是单轮，一道都拦不住：每一轮单独看都正常。
            #   没开预算的路径（工厂 call_llm_with_retry、夹具、脚本）拿到
            #   None，行为一字不变。
            denial = charge_retry()
            if denial is not None:
                raise LlmError(denial, status=error.status, transient=False) from error
            await asyncio.sleep(0.2 * attempt)
    if last_error is not None:
        raise last_error
    raise LlmError("call_control_llm exhausted without result", transient=False)


async def _call_control_llm_once(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout_ms: int | None = None,
) -> ControlLlmResult:
    """控制面专用。失败 raise LlmError；空正文但有 tool_calls 算成功。

    ⚠ **必须是 async 且用 AsyncClient**——这不是风格问题，是取消能不能穿透
      到 socket 的问题。2026-08-27 真机实测（社区养老/连锁餐饮两趟）：

          272.290  发起
          273.131  LLM 调用开始
          275.319  ← 客户端断开（用户点了停 / 关了页面）
          278.427  LLM 调用才返回     ← 客户端走后又跑了 3.1 秒

      老写法是同步 httpx 塞进 `run_in_threadpool`。Starlette 在客户端断开时
      **确实**把生成器协程取消掉了（实测：不进第 2 轮、不 yield、不落盘），
      但 `Task.cancel()` 打不断已经在线程里阻塞的 socket 读——线程照跑到底，
      钱照烧，线程池的槽照占（池子 64 槽，一组流式推演占 5 槽）。
      这跟 services/run_cancel.py 头注记的是同一个病。

      试过的死路，别再试一遍：从外部调 `client.close()` **打不断**在飞的
      同步请求（实测：慢 10s 的服务端，1s 时 close，线程仍跑满 10.00s 才
      拿到 ReadError）。同步 httpx 没有可中断的口子。

      抄的标准答案：grok-build `xai-grok-sampler/src/actor/request_task.rs`

          tokio::select! {
              biased;
              _ = cancel_token.cancelled() => return AttemptOutcome::Cancelled,
              next = l2.next() => ...
          }

      要点不是那个 `supports_cancel` 字段（那东西在 grok 自己代码里只声明、
      零消费者，照抄等于抄了个摆设），而是**取消赢了 race 之后请求的 future
      被 drop，tokio/reqwest 会真的关掉 socket**。Python 里的等价物只有一个：
      让请求本身跑在事件循环上，靠 asyncio 取消传导下去。
      实测 AsyncClient 这条真的通——取消 1.00s 生效，服务端写回时收到
      BrokenPipe，证明 socket 确实被关了。
    """
    cfg = get_llm_config()
    if not cfg.api_key or not cfg.base_url:
        raise LlmError("LLM not configured (no api_key)", transient=False)
    # ⚠ 2026-09-17：这里原本是 `min(default_max_tokens(), 2048)`。那个 min 让
    #   `LLM_MAX_TOKENS` 永远赢不了，恒定 2048——而 default_max_tokens() 的
    #   docstring 写着它是"全链路唯一旋钮"，这一行正好把那个设计意图废掉。
    #
    #   .env.example 里早写着这个病的形态，只是当时没找到人：
    #     「分路旋钮救不了这个病——换 DeepSeek 那趟这两个都调大了，挂掉的是
    #       它俩都管不着的**第三处写死预算**」
    #   第三处就是这一行。
    #
    #   真机 2/2 撞上（20:03 与 23:36，gemini-3.7-flash）：
    #     finish_reason=stop  max_tokens=2048  completion_tokens=2449
    #     empty_reason=no_visible_content
    #   思考 token 算进 completion 却不受 max_tokens 约束，2048 被思考吃光，
    #   正文一个字不剩——整条工程链就此停住，而且报的是"空正文"不是"超预算"，
    #   看着像网关坏了。
    #
    #   2026-09-19：按要求默认不设输出上限。不再 `or default_max_tokens()`
    #   把 65535 写进每一发——真机坦克大战黄条带着那个数，那发只吐了 14 token。
    #   显式传入仍 clamp（单测 / 评测 / 有人要闸）。不传则省略字段。
    max_tokens = resolve_wire_max_tokens(max_tokens)
    messages = _normalize_messages(messages)
    model_name = (
        model
        or os.environ.get("SLIDERULE_CONTROL_MODEL")
        or cfg.model
    )
    timeout_s = (timeout_ms or min(int(cfg.timeout_ms or 60000), 45_000)) / 1000.0
    url = f"{cfg.base_url}/chat/completions"
    payload = _control_chat_payload(
        messages, model_name, temperature, max_tokens, tools
    )
    started = time.time()
    try:
        # ⚠ AsyncClient + await：取消要靠 asyncio 传导到 socket（见函数头注）。
        #   换回 httpx.Client 不会报错、测试也不一定红——只会让"停止"重新
        #   变成"看起来停了"。别改。
        async with httpx.AsyncClient(timeout=_http_timeout(timeout_s)) as client:
            response = await client.post(
                url, headers=_headers(cfg.api_key), json=payload
            )
    except httpx.TimeoutException as exc:
        raise LlmError(
            _describe_timeout(exc, timeout_s, time.time() - started), transient=True
        ) from exc
    except httpx.HTTPError as exc:
        raise LlmError(
            f"cannot reach {url}: {_describe_http_error(exc)}", transient=True
        ) from exc

    latency = int((time.time() - started) * 1000)
    if response.status_code >= 400:
        raise _normalize_error(response.status_code, response.text)
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise LlmError(
            f"non-JSON response: {response.text[:200]}", transient=False
        ) from exc

    finish, termination_usage = _termination_metadata(data)
    if finish == "content_filter":
        # A partial body/tool call is not authorization to use a filtered
        # response. No retries, fallback samples, content or tool arguments.
        #
        # ⚠ 2026-09-17 换模型实测（rcouyi + gemini-3.5-flash-lite）：这条不重采
        #   的规矩本身是对的（确定性拒答，同发再跑还是拒），但它的下游后果比
        #   预想严重——**一发 content_filter 就打死整条运行**，而模型本可以换个
        #   下一步继续干活。真机形态：
        #
        #       A1    2 轮  content_filter ×1  → 整趟作废
        #       A1r2  9 轮  content_filter ×1  → 重跑一次，照样作废
        #
        #   触发条件是把那一发原样揪出来重放定位的（checkpoint 里的 messages），
        #   结论跟"某句话犯规"完全不同：
        #
        #       真 system(3338 字) + 带工具调用的对话尾   5~6 / 6 被过滤
        #       真 system + 普通用户消息                  0 / 6
        #       假 system + 带工具调用的对话尾            0 / 6
        #       system 切成任意一半(1669 字) 或 1/4       0 / 6   ← 没有哪一段单独犯规
        #
        #   也就是说是**规模 × 工具调用对话**的交互越过了那家的安全阈值，不是
        #   内容里有什么可以删掉的东西。我们的系统提示词还会随功能继续变长，
        #   所以这类模型只会越来越不适用——选型时要拿真机对话试，不能拿单发
        #   问答试（见下条）。
        #
        # ⚠ 定位过程里的方法论教训，比结论更值得记：我**没先验证现象可复现**
        #   就开始二分，于是二分法忠实地"找到"了元凶 `project_export`。
        #   后来把同一个请求重复 8 次才看清：`FFF✓FFFF`——每个"通过"只是抽样
        #   运气。**二分法的前提是现象确定性**，先测 n≥6 再定位。
        #
        #   同一天还栽了三次同类：拿 32 token 玩具请求、真形状小载荷、27k 大
        #   载荷分别判断过"网关没问题"，三次都被真机推翻。自己构造的判据总会过。
        raise LlmError(
            "control LLM response terminated by content_filter "
            + _empty_content_hint(finish, max_tokens, termination_usage),
            transient=False, usage=termination_usage, finish_reason=finish,
        )

    # 服务端 doom-loop 信号：终局响应对象上那份冗余拷贝就挂在这份 JSON 里。
    #
    # ⚠ **当前网关不发这个字段**，所以 peek 恒返回 NONE，这段等于不存在。
    #   接在这儿不是为了今天生效，是为了「哪天网关换了」不用再找一遍入口——
    #   而且架构闸不许留没人 import 的模块（它那句「要么接上，要么说清为什么」
    #   是对的）。收到了先留痕；据以重采样是下一步，`should_resample` 要一份
    #   Policy，而 Policy 缺席就是关着。
    _doom = DoomLoopCollector()
    _kind, _signals = peek_doom_loop(response.text)
    if _signals:
        _doom.observe(_signals)
        print(
            f"[doom-loop] 服务端报了循环信号：{[s.raw for s in _doom.signals][:6]}",
            flush=True,
        )

    content, tool_calls, usage, result_finish = _extract_control(data)
    choice = (data.get("choices") or [{}])[0] or {}
    msg = choice.get("message") if isinstance(choice, dict) else {}
    reason = empty_reason(
        content=content,
        tool_calls=tool_calls,
        reasoning=message_reasoning(msg if isinstance(msg, dict) else {}),
    )
    if reason is not None:
        # Control has its own request cap; the factory helper's instruction
        # to increase LLM_MAX_TOKENS does not describe this call's policy.
        #
        # ⚠ 思考只用来归类，不许写进 ControlLlmResult.content——写进去
        #   host 会当成对用户说的话（TicketStream 前几发英文独白就是这样）。
        cause = " (output token limit reached)" if finish == "length" else ""
        retry = should_resample_empty(finish, reason)
        raise LlmError(
            "empty content from control LLM" + cause + " "
            + _empty_content_hint(
                finish, max_tokens, termination_usage, include_length_advice=False,
            )
            + f" empty_reason={reason.value}",
            transient=retry,
            usage=termination_usage,
            finish_reason=finish,
            empty_reason=reason.value,
        )
    return ControlLlmResult(
        content=content,
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=result_finish,
        model=str(data.get("model") or model_name),
        latency_ms=latency,
    )
