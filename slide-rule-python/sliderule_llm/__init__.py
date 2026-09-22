"""
SlideRule V5 — Python LLM layer (Phase 1 of the real migration).

Faithful port of the Node LLM stack:
  - config.py  ← server/core/ai-config.ts   (env + wire selection)  [stdlib only]
  - client.py  ← server/core/llm-client.ts  (chat_completions / responses over httpx)
  - pool.py    ← server/sliderule/pool-json-llm.ts (multi-key parallel/sequential)

No stubs, no canned data: client.py makes real HTTP calls to the configured endpoint (su8, etc.).
httpx honors HTTP_PROXY/HTTPS_PROXY/NO_PROXY from the environment natively (trust_env=True),
so the Clash proxy "just works" with no custom dispatcher (the Node undici-version-skew bug
does not exist here).

config is imported eagerly (stdlib only). client/pool are imported lazily so that
config-only consumers (and the network-free unit tests) don't require httpx.
"""
from .config import (  # stdlib only — safe to import eagerly
    DEFAULT_MAX_TOKENS,
    FallbackLlmConfig,
    LlmConfig,
    PoolConfig,
    default_max_tokens,
    get_fallback_llm_config,
    get_llm_config,
    get_pool_config,
    select_wire_api,
)

_LAZY = {
    "LlmResult": "client",
    "LlmError": "client",
    "call_llm": "client",
    "call_llm_json": "client",
    "call_pool": "pool",
    "call_pool_json": "pool",
}

__all__ = [
    "DEFAULT_MAX_TOKENS",
    "FallbackLlmConfig",
    "LlmConfig",
    "PoolConfig",
    "get_fallback_llm_config",
    "get_llm_config",
    "default_max_tokens",
    "get_pool_config",
    "select_wire_api",
    *_LAZY.keys(),
]


def __getattr__(name):  # PEP 562 — defer httpx import until client/pool is actually used
    mod = _LAZY.get(name)
    if mod is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib

    return getattr(importlib.import_module(f".{mod}", __name__), name)
