"""
LLM config + wire selection — port of server/core/ai-config.ts.

Reads the SAME env vars as the Node app so a single .env drives both during migration.
Stdlib-only (no pydantic) so it can be unit-tested without any third-party deps.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

# ── env helpers ───────────────────────────────────────────────────────────────

def _pick(*names: str) -> str | None:
    """First non-empty env var among names (mirrors ai-config pickProviderValue)."""
    for n in names:
        v = os.environ.get(n)
        if v is not None and v != "":
            return v
    return None


def _int(v: str | None, default: int) -> int:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def _bool(v: str | None, default: bool = False) -> bool:
    """⚠ 2026-08-29：原来是 `in ("1","true","yes","on")` 配一个**可传的** default。
    今天所有调用点都传 False，所以还没出事；但签名允许 default=True，而那一刻
    拼错一个字母就会静静地关掉一个默认开的功能——仓里另外两处正是这么坏的
    （见 services/env_flags 模块头）。改成回落到声明的默认。"""
    from config.env_flags import parse

    return parse(v, default=default)


def _csv(v: str | None) -> tuple[str, ...]:
    return tuple(s.strip() for s in (v or "").split(",") if s.strip())


def _positive_int(v: str | None, default: int) -> int:
    parsed = _int(v, default)
    return parsed if parsed > 0 else default


#: 所有调用的输出上限，一个口径（2026-08-13）。
#:
#: ## 为什么必须统一
#:
#: `max_tokens` 在非推理模型上是"输出上限"，在**推理模型上是"思考 + 输出的
#: 共享池"**。这个语义变化让所有按旧口径定的预算一起失效——而且失败形态是
#: **静默返回空正文**（`finish_reason=length` + `completion_tokens` 顶满），
#: 不是报错，最难查。
#:
#: 换 DeepSeek 那趟实测，18 处硬编码预算里当场挂了两处：
#:
#:     freeform_block:1246  max_tokens=1200   思考吃光 → 「怎么画」的润色静默跳过
#:     freeform_block:2033  max_tokens=14000  思考吃光 → **整个首页设计失败**，
#:                                            3 次重试全一样，白烧 433.8s
#:
#: 逐个调大是治不完的：18 个点、每换一次模型再来一遍。所以收成一个数。
#:
#: ## 为什么调大是安全的
#:
#: `max_tokens` 是**上限不是配额**——按实际生成的 token 计费，模型说完就停。
#: 把上限抬高不会让正常调用变贵，只是让"思考+正文"不再被人为截断。
#: 唯一的代价是失控生成时的天花板变高，这由各调用点自己的提示词约束兜着。
#:
#: ## 为什么连"分路旋钮"也一起收掉
#:
#: 以前有 `LLM_GENERATE_MAX_TOKENS` / `LLM_ROUND_CAP_MAX_TOKENS` 两个分路开关，
#: **它们已经删了**。分路旋钮救不了这个病，反而是病因的一部分：换模型那趟，
#: 这两个都调大了，挂掉的却是它俩都管不着的第三处硬编码。而且留着分路值
#: 还会**反向咬人**——旧 .env 里一个 `LLM_ROUND_CAP_MAX_TOKENS=32000`
#: 会让那条路悄悄比全局窄，正是要根除的形态。现在只剩一个 `LLM_MAX_TOKENS`：
#: 调它，全链路一起变；旧变量留在 .env 里也只是被忽略，不会再造成局部收窄。
#:
#: ⚠ 2026-08-19 换 ouyi-5-preview：网关按 Gemini 口径，maxOutputTokens
#: **1 含、65536 不含**。默认 65536 原样发出去，HTTP 400 不可重试。
#: 真机 PEJBRSVSD1、MFQJ4JECA5 的 spec / 画页全灭；本趟 P0CJH3JV3P 的
#: structure / evidence / risk / spec-first 又全 400。不是题目坏了。
#: 上限是开区间右端减一，不是再加一个分路旋钮。
#:
#: ⚠ 2026-09-19：按要求输出预算不设限。坦克大战 `sr-20260919072444-11CSR1RSM6`
#:   黄条带着 `max_tokens=65535`，那发只吐了 14 个 token——这个数字没挡住空答，
#:   但每一发控制面请求都被写成有闸。默认改为**不带这个字段**；有人要闸时
#:   才写正数 `LLM_MAX_TOKENS`。65535 只留给「写了数字」时的开区间钳，
#:   不再当默认配额。
WIRE_MAX_OUTPUT_TOKENS = 65535
DEFAULT_MAX_TOKENS = WIRE_MAX_OUTPUT_TOKENS
_UNLIMITED_TOKEN_MARKERS = {"", "unlimited", "none", "0"}


def clamp_max_tokens(n: int) -> int:
    """发出去之前卡在上游开区间里。`.env` 仍写 65536 也不许再 400。"""
    try:
        raw = int(n)
    except (TypeError, ValueError):
        raw = DEFAULT_MAX_TOKENS
    if raw <= 0:
        raw = DEFAULT_MAX_TOKENS
    return min(raw, WIRE_MAX_OUTPUT_TOKENS)


def default_max_tokens() -> int | None:
    """所有 LLM 调用的输出上限。`None` = 不设限，请求里不带 `max_tokens`。

    `LLM_MAX_TOKENS` 是全链路唯一旋钮：**每次读环境变量**，不做模块级常量。
    不设 / 空 / `0` / `unlimited` / `none` → `None`。写了正数才 clamp。
    写坏了（非数字）也当不设限，不偷偷压回 65535——配错一个数就整场挂，
    比省略字段糟得多。
    """
    raw = os.environ.get("LLM_MAX_TOKENS")
    if raw is None or str(raw).strip().lower() in _UNLIMITED_TOKEN_MARKERS:
        return None
    parsed = _positive_int(raw, 0)
    if parsed <= 0:
        return None
    return clamp_max_tokens(parsed)


def resolve_wire_max_tokens(explicit: int | None = None) -> int | None:
    """出网口用的输出上限。`None` = 请求不带这个字段。

    显式正数优先（单测 / 评测控成本）。否则走 `default_max_tokens()`。
    """
    if explicit is not None:
        return clamp_max_tokens(explicit)
    return default_max_tokens()


def wider_output_budget(*values: int | None) -> int | None:
    """取更宽的输出上限。`None`（不设限）比任何数字都宽。"""
    if any(value is None for value in values):
        return None
    return max(values)


def format_max_tokens(max_tokens: int | None) -> str:
    """错误消息里的预算词。不设限就说 unlimited，不许写成 default。"""
    return "unlimited" if max_tokens is None else str(max_tokens)


#: 推理档位没有分路旋钮——**一律走 .env 的 `LLM_REASONING_EFFORT`**（2026-08-13）。
#:
#: ## 这里曾经有一个 DEFAULT_STRUCTURED_REASONING_EFFORT = "medium"，已经删了
#:
#: 它的由来：同日早些时候把全局降到 low 提速，结果把首页设计跑挂了——
#: 3 次尝试全是 `5 validation errors ... tag Field required`，思考砍到中位数
#: 12 个 token，模型拼不出合法的深层节点树。当时的处置是给结构化生成这条路
#: 单独定一个 medium 的默认档位，把它抬回来。
#:
#: 为什么删：**全局已经回到 medium 了**（理由见 .env.example 的
#: LLM_REASONING_EFFORT 头上），那个默认值于是从"补丁"退化成一个纯风险项——
#: 它是代码里写死的第二个档位来源，而写死的分路值只会反向咬人：谁把 .env 调到
#: high，最需要思考的那条路会被这个 medium 悄悄按回去，症状还是静默的深层
#: JSON 校验失败，和当初 low 跑挂首页一模一样。
#:
#: 这跟 DEFAULT_MAX_TOKENS 头上那段是同一条纪律，不是例外：**旋钮越多，
#: 漏的越多。** 那个病在 max_tokens 上犯过三次，每次的"修法"都是再加一个分路
#: 旋钮，而每次挂掉的都是新旋钮管不着的第三处。所以这里不留第二个来源——
#: 要调思考量，改 .env 里那一个数，全链路一起变。
#:
#: 判据钉在 tests/test_llm_token_budget.py（AST 扫描写死的 reasoning_effort），
#: 不靠自觉。

def _provider_name(base_url: str) -> str:
    parsed = urlparse(base_url or "")
    return parsed.netloc or base_url


def _dedupe_models(models: tuple[str, ...], primary_model: str) -> tuple[str, ...]:
    seen = {primary_model.strip().lower()} if primary_model else set()
    result: list[str] = []
    for model in models:
        normalized = model.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(model)
    return tuple(result)


# ── wire selection (port of ai-config.ts:104-121) ─────────────────────────────

_REASONING_MODEL_RE = re.compile(r"gpt-5|gpt5|o[0-3]|thinking|reasoning", re.IGNORECASE)


def select_wire_api(raw_wire: str | None, model: str, reasoning_effort: str | None) -> str:
    """
    Decide 'chat_completions' vs 'responses'.

    Matches the (fixed) ai-config behaviour:
      - explicit 'responses'        → responses
      - explicit 'chat_completions' → chat_completions  (HONORED as-is; do NOT auto-upgrade —
        some providers like rcouyi only implement /chat/completions and 501 on /responses)
      - unset → reasoning models (gpt-5.x / o-series / thinking) default to 'responses',
        otherwise 'chat_completions'
    """
    has_reasoning = bool(
        reasoning_effort and reasoning_effort.strip() and reasoning_effort.strip().lower() != "none"
    )
    is_reasoning_model = bool(_REASONING_MODEL_RE.search(model or ""))
    rw = (raw_wire or "").strip().lower()
    if rw == "responses":
        return "responses"
    if rw == "chat_completions":
        return "chat_completions"
    return "responses" if (has_reasoning and is_reasoning_model) else "chat_completions"


# ── high-level (primary) config ───────────────────────────────────────────────

@dataclass(frozen=True)
class LlmConfig:
    api_key: str
    base_url: str
    model: str
    router_model: str | None
    wire_api: str  # "chat_completions" | "responses"
    reasoning_effort: str | None
    timeout_ms: int
    stream: bool
    unlimited_models: tuple[str, ...]
    model_fallbacks: tuple[str, ...]
    max_context: int
    max_concurrent: int
    provider_name: str
    chat_thinking_type: str | None
    supports_image_content_parts: bool = False


def get_llm_config() -> LlmConfig:
    base = (_pick("LLM_BASE_URL", "OPENAI_BASE_URL") or "").rstrip("/")
    model = _pick("LLM_MODEL", "OPENAI_MODEL") or "gpt-5.5"
    router_model = _pick("LLM_ROUTER_MODEL", "OPENAI_ROUTER_MODEL")
    reasoning = _pick("LLM_REASONING_EFFORT", "OPENAI_REASONING_EFFORT")
    raw_wire = _pick("LLM_WIRE_API", "OPENAI_WIRE_API")
    return LlmConfig(
        api_key=_pick("LLM_API_KEY", "OPENAI_API_KEY") or "",
        base_url=base,
        model=model,
        router_model=router_model,
        wire_api=select_wire_api(raw_wire, model, reasoning),
        reasoning_effort=reasoning,
        timeout_ms=_positive_int(_pick("LLM_TIMEOUT_MS", "OPENAI_TIMEOUT_MS"), 600_000),
        stream=_bool(_pick("LLM_STREAM", "OPENAI_STREAM"), False),
        unlimited_models=_csv(_pick("LLM_UNLIMITED_MODELS")),
        model_fallbacks=_dedupe_models(_csv(_pick("LLM_MODEL_FALLBACKS")), model),
        max_context=_positive_int(_pick("LLM_MAX_CONTEXT"), 1_000_000),
        max_concurrent=max(1, _int(_pick("LLM_MAX_CONCURRENT"), 9999)),
        provider_name=_provider_name(base),
        chat_thinking_type=_pick("LLM_CHAT_THINKING_TYPE", "OPENAI_CHAT_THINKING_TYPE"),
        supports_image_content_parts=_bool(_pick("LLM_SUPPORTS_IMAGE_CONTENT_PARTS"), False),
    )


# ── fallback provider config (port of llm-client buildProviders env) ───────────

@dataclass(frozen=True)
class FallbackLlmConfig:
    enabled: bool
    api_key: str
    base_url: str
    model: str
    wire_api: str
    timeout_ms: int
    reasoning_effort: str | None
    force_model: bool
    stream: bool
    chat_thinking_type: str | None
    retries: int
    cooldown_ms: int


def get_fallback_llm_config() -> FallbackLlmConfig:
    api_key = _pick("FALLBACK_LLM_API_KEY") or ""
    base_url = (_pick("FALLBACK_LLM_BASE_URL") or "").rstrip("/")
    model = _pick("FALLBACK_LLM_MODEL") or "glm-4.6"
    return FallbackLlmConfig(
        enabled=bool(api_key and base_url),
        api_key=api_key,
        base_url=base_url,
        model=model,
        wire_api="responses" if (_pick("FALLBACK_LLM_WIRE_API") or "").lower() == "responses" else "chat_completions",
        timeout_ms=_positive_int(_pick("FALLBACK_LLM_TIMEOUT_MS"), 600_000),
        reasoning_effort=_pick("FALLBACK_LLM_REASONING_EFFORT"),
        force_model=(_pick("FALLBACK_LLM_FORCE_MODEL") or "true").lower() != "false",
        stream=(_pick("FALLBACK_LLM_STREAM") or "false").lower() != "false",
        chat_thinking_type=_pick("FALLBACK_LLM_CHAT_THINKING_TYPE") or "disabled",
        retries=_positive_int(_pick("FALLBACK_LLM_RETRIES"), 3),
        cooldown_ms=_positive_int(_pick("FALLBACK_LLM_COOLDOWN_MS"), 30_000),
    )


# ── low-level pool config (port of pool-json-llm env) ──────────────────────────

@dataclass(frozen=True)
class PoolConfig:
    keys: tuple[str, ...]
    labels: tuple[str, ...]
    base_url: str
    model: str
    timeout_ms: int
    wire_api: str
    race_mode: str  # "parallel" | "sequential"
    enabled: bool


def _resolve_race_mode() -> str:
    """
    Port of resolveSlideRulePoolRaceMode: explicit override wins; otherwise default 'parallel'.
    (We deliberately drop the Node proxy-auto-detect → sequential heuristic: in Python httpx the
    proxy is handled cleanly via trust_env, so parallel is safe.)
    """
    raw = (_pick("SLIDERULE_POOL_RACE_MODE", "WHYBUDDY_POOL_RACE_MODE") or "").strip().lower()
    if raw in ("parallel", "sequential"):
        return raw
    return "parallel"


def get_pool_config() -> PoolConfig:
    keys = _csv(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"))
    labels = _csv(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"))
    if len(labels) != len(keys):
        labels = tuple(f"key-{i + 1}" for i in range(len(keys)))
    model = _pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL") or "ouyi-5-preview-thinking"
    raw_wire = (_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API") or "").strip().lower()
    if raw_wire:
        wire_api = "responses" if raw_wire == "responses" else "chat_completions"
    elif re.search(r"gpt-5|gpt5|5\.[0-9]", model or "", re.IGNORECASE):
        wire_api = "responses"
    else:
        wire_api = "chat_completions"
    return PoolConfig(
        keys=keys,
        labels=labels,
        base_url=(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL") or "https://api.rcouyi.com/v1").rstrip("/"),
        model=model,
        timeout_ms=_positive_int(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_TIMEOUT_MS"), 300_000),
        wire_api=wire_api,
        race_mode=_resolve_race_mode(),
        enabled=_bool(_pick("SLIDERULE_CAPABILITY_POOL_ENABLED"), False),
    )


#: 跟 `scripts/dev-all.mjs` `collectLlmBypassHosts` 同一份硬编码兜底。
#: 换供应商时真正救命的是 LLM_BASE_URL 的 hostname，这几个是历史踩坑。
_LLM_BYPASS_DEFAULTS = (
    "localhost",
    "127.0.0.1",
    "::1",
    "blackaicoding.com",
    "api.rcouyi.com",
    "www.su8.codes",
    "miantuan.ai",
)

_LLM_BYPASS_URL_KEYS = (
    "LLM_BASE_URL",
    "LLM_API_BASE",
    "LLM_HOST",
    "OPENAI_API_BASE",
    "OPENAI_BASE_URL",
    "FALLBACK_LLM_BASE_URL",
    "APP_STORE_HTTP_API_URL",
    "APP_STORE_DATABASE_URL",
)


def hostname_from_maybe_url(raw: str | None) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    try:
        parsed = urlparse(s if "://" in s else f"https://{s}")
        return (parsed.hostname or "").strip()
    except Exception:
        host = s.split("/")[0]
        if "://" in s:
            host = s.split("://", 1)[1].split("/")[0]
        return host.split(":")[0].strip()


def llm_bypass_hosts() -> tuple[str, ...]:
    """必须绕过 Clash 的主机。漏了 LLM_BASE_URL 就会把长请求送进 7890。"""
    seen: list[str] = []
    for key in _LLM_BYPASS_URL_KEYS:
        host = hostname_from_maybe_url(os.environ.get(key))
        if host and host not in seen:
            seen.append(host)
    for host in _LLM_BYPASS_DEFAULTS:
        if host not in seen:
            seen.append(host)
    return tuple(seen)


def ensure_llm_proxy_bypass() -> None:
    """让 httpx 的 NO_PROXY 对 LLM 主机生效。

    ⚠ 2026-08-19（dev-all 注释）：Python httpx 把长请求送进 Clash 7890，
      画页/打孔 502/503/504。`dev:all` 会给子进程灌 NO_PROXY，手起
      uvicorn 没有那份名单。

    ⚠ 2026-09-08 真机：控制面每句 5–11s 后罐头「网关连不上」。直连
      `api.rcouyi.com` 是 200，同一条控制面请求是 Cloudflare **522**。
      Windows 上 HTTP_PROXY 环境变量为空时，`urllib.getproxies()` 走
      注册表（Clash 系统代理），这时 NO_PROXY **环境变量不生效**
      （`proxy_bypass` 走 registry 分支）。把系统代理抬进 HTTP_PROXY，
      再把 LLM 主机写进 NO_PROXY，httpx 才走 environment 分支并绕过它们。
    """
    import urllib.request

    env_http = _pick("HTTP_PROXY", "http_proxy")
    env_https = _pick("HTTPS_PROXY", "https_proxy")
    if not env_http and not env_https:
        try:
            registry = urllib.request.getproxies()
        except Exception:
            registry = {}
        url = str(registry.get("https") or registry.get("http") or "").strip()
        if url:
            os.environ.setdefault("HTTP_PROXY", url)
            os.environ.setdefault("HTTPS_PROXY", url)

    existing = _pick("NO_PROXY", "no_proxy") or ""
    merged: list[str] = []
    for part in (*existing.split(","), *llm_bypass_hosts()):
        item = part.strip()
        if item and item not in merged:
            merged.append(item)
    blob = ",".join(merged)
    os.environ["NO_PROXY"] = blob
    os.environ["no_proxy"] = blob


@dataclass(frozen=True)
class VectorStoreConfig:
    """Runtime config contract for vector-backed evidence retrieval."""

    runtime: str
    enabled: bool
    base_url: str
    collection: str
    api_key: str
    timeout_ms: int
    dimension: int


def _normalize_vector_runtime(raw_runtime: str | None, enabled: bool) -> tuple[str, bool]:
    runtime = (raw_runtime or "").strip().lower()
    if runtime in ("qdrant", "real", "vector"):
        return "qdrant", True
    if runtime in ("disabled", "off", "none", "fallback"):
        return "disabled", False
    if enabled:
        return "qdrant", True
    return "disabled", False


def get_vector_store_config() -> VectorStoreConfig:
    enabled = _bool(
        _pick(
            "SLIDERULE_REAL_VECTOR_RETRIEVAL_ENABLED",
            "RAG_VECTOR_RETRIEVAL_ENABLED",
        ),
        False,
    )
    runtime, enabled = _normalize_vector_runtime(
        _pick("SLIDERULE_VECTOR_RUNTIME", "RAG_VECTOR_RUNTIME"),
        enabled,
    )
    return VectorStoreConfig(
        runtime=runtime,
        enabled=enabled,
        base_url=(_pick("QDRANT_URL", "RAG_VECTOR_STORE_URL") or "http://localhost:6333").rstrip("/"),
        collection=_pick("QDRANT_COLLECTION", "RAG_VECTOR_COLLECTION") or "knowledge_base",
        api_key=_pick("QDRANT_API_KEY", "RAG_VECTOR_STORE_API_KEY") or "",
        timeout_ms=_positive_int(_pick("QDRANT_TIMEOUT_MS", "RAG_VECTOR_TIMEOUT_MS"), 10_000),
        dimension=_positive_int(_pick("QDRANT_DIMENSION", "RAG_EMBEDDING_DIMENSION"), 1536),
    )
