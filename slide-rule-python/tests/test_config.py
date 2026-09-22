"""
Unit tests for the ported config + wire selection. Network-free, stdlib-only
(imports only sliderule_llm.config), so it runs on any Python without httpx.

Run:  python -m pytest tests/test_config.py -q
  or: python tests/test_config.py   (has a __main__ runner for envs without pytest)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.config import (  # noqa: E402
    select_wire_api,
    get_llm_config,
    get_fallback_llm_config,
    get_pool_config,
    llm_bypass_hosts,
    hostname_from_maybe_url,
    ensure_llm_proxy_bypass,
)

CONFIG_ENV_KEYS = (
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_ROUTER_MODEL",
    "OPENAI_REASONING_EFFORT",
    "OPENAI_WIRE_API",
    "OPENAI_TIMEOUT_MS",
    "OPENAI_STREAM",
    "OPENAI_CHAT_THINKING_TYPE",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_ROUTER_MODEL",
    "LLM_REASONING_EFFORT",
    "LLM_WIRE_API",
    "LLM_TIMEOUT_MS",
    "LLM_STREAM",
    "LLM_CHAT_THINKING_TYPE",
    "LLM_MAX_CONTEXT",
    "LLM_MAX_CONCURRENT",
    "LLM_MODEL_FALLBACKS",
    "LLM_UNLIMITED_MODELS",
    "FALLBACK_LLM_API_KEY",
    "FALLBACK_LLM_BASE_URL",
    "FALLBACK_LLM_MODEL",
    "FALLBACK_LLM_WIRE_API",
    "FALLBACK_LLM_TIMEOUT_MS",
    "FALLBACK_LLM_REASONING_EFFORT",
    "FALLBACK_LLM_FORCE_MODEL",
    "FALLBACK_LLM_STREAM",
    "FALLBACK_LLM_CHAT_THINKING_TYPE",
    "FALLBACK_LLM_RETRIES",
    "FALLBACK_LLM_COOLDOWN_MS",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_TIMEOUT_MS",
    "BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API",
    "SLIDERULE_CAPABILITY_POOL_ENABLED",
    "SLIDERULE_POOL_RACE_MODE",
    "WHYBUDDY_POOL_RACE_MODE",
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "QDRANT_COLLECTION",
    "QDRANT_TIMEOUT_MS",
    "QDRANT_DIMENSION",
    "RAG_VECTOR_STORE_URL",
    "RAG_VECTOR_STORE_API_KEY",
    "RAG_VECTOR_COLLECTION",
    "RAG_VECTOR_TIMEOUT_MS",
    "RAG_EMBEDDING_DIMENSION",
)


def clear_config_env():
    for key in CONFIG_ENV_KEYS:
        os.environ.pop(key, None)


def test_explicit_chat_completions_is_honored_not_upgraded():
    # Reasoning model + explicit chat_completions → stays chat_completions (the rcouyi/su8 fix).
    assert select_wire_api("chat_completions", "gpt-5.5", "medium") == "chat_completions"
    assert select_wire_api("chat_completions", "ouyi-5-preview-thinking", "high") == "chat_completions"


def test_explicit_responses_is_honored():
    assert select_wire_api("responses", "gpt-4o", None) == "responses"


def test_unset_wire_infers_responses_for_reasoning_models():
    assert select_wire_api(None, "gpt-5.5", "medium") == "responses"
    assert select_wire_api("", "o3-mini", "high") == "responses"
    assert select_wire_api(None, "some-thinking-model", "low") == "responses"


def test_unset_wire_defaults_chat_for_plain_models():
    assert select_wire_api(None, "gpt-4o-mini", None) == "chat_completions"
    assert select_wire_api(None, "gpt-5.5", "none") == "chat_completions"  # reasoning 'none' → not reasoning
    assert select_wire_api(None, "qwen-max", "medium") == "chat_completions"  # not a reasoning-model name


def test_get_llm_config_reads_env(monkeypatch=None):
    clear_config_env()
    _set = os.environ.__setitem__
    _set("LLM_API_KEY", "su8-test")
    _set("LLM_BASE_URL", "https://www.su8.codes/codex/v1/")  # trailing slash trimmed
    _set("LLM_MODEL", "gpt-5.5")
    _set("LLM_WIRE_API", "chat_completions")
    _set("LLM_REASONING_EFFORT", "medium")
    _set("LLM_TIMEOUT_MS", "600000")
    cfg = get_llm_config()
    assert cfg.api_key == "su8-test"
    assert cfg.base_url == "https://www.su8.codes/codex/v1"
    assert cfg.model == "gpt-5.5"
    assert cfg.wire_api == "chat_completions"
    assert cfg.timeout_ms == 600000


def test_get_llm_config_reads_router_and_runtime_parity_env():
    clear_config_env()
    os.environ["LLM_API_KEY"] = "project-key"
    os.environ["LLM_BASE_URL"] = "https://llm.example.test/v1"
    os.environ["LLM_MODEL"] = "gpt-5.5"
    os.environ["LLM_ROUTER_MODEL"] = "router-fast"
    os.environ["LLM_MAX_CONTEXT"] = "123456"
    os.environ["LLM_CHAT_THINKING_TYPE"] = "enabled"
    os.environ["LLM_MAX_CONCURRENT"] = "7"
    os.environ["LLM_MODEL_FALLBACKS"] = "gpt-5.4, gpt-5.3-codex, gpt-5.4"

    cfg = get_llm_config()

    assert cfg.router_model == "router-fast"
    assert cfg.provider_name == "llm.example.test"
    assert cfg.max_context == 123456
    assert cfg.chat_thinking_type == "enabled"
    assert cfg.max_concurrent == 7
    assert cfg.model_fallbacks == ("gpt-5.4", "gpt-5.3-codex")


def test_get_llm_config_uses_openai_router_when_project_llm_unset():
    clear_config_env()
    os.environ["OPENAI_API_KEY"] = "openai-key"
    os.environ["OPENAI_BASE_URL"] = "https://openai.example.test/v1"
    os.environ["OPENAI_MODEL"] = "openai-model"
    os.environ["OPENAI_ROUTER_MODEL"] = "openai-router"
    os.environ["OPENAI_CHAT_THINKING_TYPE"] = "disabled"

    cfg = get_llm_config()

    assert cfg.api_key == "openai-key"
    assert cfg.router_model == "openai-router"
    assert cfg.chat_thinking_type == "disabled"


def test_get_fallback_llm_config_reads_env():
    clear_config_env()
    os.environ["FALLBACK_LLM_API_KEY"] = "fallback-key"
    os.environ["FALLBACK_LLM_BASE_URL"] = "https://fallback.example.test/v1/"
    os.environ["FALLBACK_LLM_MODEL"] = "glm-test"
    os.environ["FALLBACK_LLM_WIRE_API"] = "responses"
    os.environ["FALLBACK_LLM_TIMEOUT_MS"] = "90000"
    os.environ["FALLBACK_LLM_REASONING_EFFORT"] = "low"
    os.environ["FALLBACK_LLM_FORCE_MODEL"] = "false"
    os.environ["FALLBACK_LLM_STREAM"] = "true"
    os.environ["FALLBACK_LLM_CHAT_THINKING_TYPE"] = "disabled"
    os.environ["FALLBACK_LLM_RETRIES"] = "5"
    os.environ["FALLBACK_LLM_COOLDOWN_MS"] = "12000"

    cfg = get_fallback_llm_config()

    assert cfg.enabled is True
    assert cfg.api_key == "fallback-key"
    assert cfg.base_url == "https://fallback.example.test/v1"
    assert cfg.model == "glm-test"
    assert cfg.wire_api == "responses"
    assert cfg.timeout_ms == 90000
    assert cfg.reasoning_effort == "low"
    assert cfg.force_model is False
    assert cfg.stream is True
    assert cfg.chat_thinking_type == "disabled"
    assert cfg.retries == 5
    assert cfg.cooldown_ms == 12000


def test_get_fallback_llm_config_disabled_without_key_or_base_url():
    clear_config_env()
    cfg = get_fallback_llm_config()

    assert cfg.enabled is False
    assert cfg.api_key == ""
    assert cfg.base_url == ""
    assert cfg.model == "glm-4.6"
    assert cfg.wire_api == "chat_completions"


def test_get_pool_config_parses_keys_and_labels():
    clear_config_env()
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"] = "k1, k2 ,k3"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"] = "a,b,c"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL"] = "https://www.su8.codes/codex/v1"
    os.environ["SLIDERULE_CAPABILITY_POOL_ENABLED"] = "true"
    os.environ["SLIDERULE_POOL_RACE_MODE"] = "parallel"
    pc = get_pool_config()
    assert pc.keys == ("k1", "k2", "k3")
    assert pc.labels == ("a", "b", "c")
    assert pc.enabled is True
    assert pc.race_mode == "parallel"


def test_get_pool_config_reads_wire_api_and_node_defaults():
    clear_config_env()
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"] = "k1"
    os.environ["SLIDERULE_CAPABILITY_POOL_ENABLED"] = "true"

    pc = get_pool_config()

    assert pc.base_url == "https://api.rcouyi.com/v1"
    assert pc.model == "ouyi-5-preview-thinking"
    assert pc.wire_api == "chat_completions"

    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL"] = "gpt-5.5"
    pc = get_pool_config()
    assert pc.wire_api == "responses"

    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API"] = "chat_completions"
    pc = get_pool_config()
    assert pc.wire_api == "chat_completions"


def test_pool_labels_default_when_mismatched():
    clear_config_env()
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"] = "k1,k2"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"] = "only-one"
    pc = get_pool_config()
    assert pc.labels == ("key-1", "key-2")


def test_hostname_from_maybe_url_strips_path():
    assert hostname_from_maybe_url("https://api.rcouyi.com/v1") == "api.rcouyi.com"
    assert hostname_from_maybe_url("api.example.test") == "api.example.test"
    assert hostname_from_maybe_url("") == ""


def test_llm_bypass_hosts_includes_live_base_url():
    """漏 LLM_BASE_URL = 2026-08-19 那次：NO_PROXY 还是旧网关。"""
    old = os.environ.get("LLM_BASE_URL")
    os.environ["LLM_BASE_URL"] = "https://gw.example-bypass.test/v1"
    try:
        hosts = llm_bypass_hosts()
        assert "gw.example-bypass.test" in hosts
        assert "api.rcouyi.com" in hosts
    finally:
        if old is None:
            os.environ.pop("LLM_BASE_URL", None)
        else:
            os.environ["LLM_BASE_URL"] = old


def test_ensure_llm_proxy_bypass_writes_noproxy():
    keys = ("NO_PROXY", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "LLM_BASE_URL")
    saved = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["LLM_BASE_URL"] = "https://gw.example-bypass.test/v1"
        os.environ["NO_PROXY"] = "localhost"
        ensure_llm_proxy_bypass()
        blob = os.environ.get("NO_PROXY") or ""
        assert "gw.example-bypass.test" in blob
        assert "api.rcouyi.com" in blob
        assert "localhost" in blob
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# Minimal runner so this file works even where pytest isn't installed.
if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {fn.__name__}: {e!r}")
    print(f"\n{passed}/{len(fns)} passed")
    sys.exit(0 if passed == len(fns) else 1)
