"""llm_channel — 推演 LLM 通道的运行时配置（设置中心「推演通道」后端）。

真通道 = sliderule_llm（五系统生成 / LLM 评审 / AIGC 试跑与写回共用一条）。
配置解析在 sliderule_llm.config.get_llm_config()，每次调用现读 os.environ——
所以运行时覆盖直接写 os.environ 即刻生效；同时持久化到 .llm-override.json
（gitignored，本机文件）供重启后恢复。

诚实边界：
- GET 只回掩码密钥（前4…后4），明文永不离开服务端；
- override 优先于 .env（用户在 UI 显式设置的意图更新）；置空某字段 =
  回退到进程启动时的 .env 基线值（基线在首次应用前快照）；
- test 走真通道一次小请求，结果如实（连接失败/无 key 不粉饰）。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from sliderule_llm.config import default_max_tokens

OVERRIDE_PATH = Path(__file__).resolve().parent.parent / ".llm-override.json"

# UI 字段 → 环境变量（只开放这三项；wire/timeout 等仍归 .env 管）
FIELDS: Dict[str, str] = {
    "apiKey": "LLM_API_KEY",
    "baseUrl": "LLM_BASE_URL",
    "model": "LLM_MODEL",
}

# 进程启动时的 env 基线（.env 已装载后、override 应用前快照）。
_env_baseline: Optional[Dict[str, Optional[str]]] = None


def mask_key(key: str) -> str:
    """密钥掩码：短 key 全遮，长 key 露前4后4。"""
    if not key:
        return ""
    if len(key) <= 12:
        return "*" * len(key)
    return f"{key[:4]}…{key[-4:]}"


def load_override() -> Dict[str, str]:
    try:
        raw = json.loads(OVERRIDE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {k: str(v) for k, v in raw.items() if k in FIELDS and isinstance(v, str) and v.strip()}


def _save_override(override: Dict[str, str]) -> None:
    if override:
        OVERRIDE_PATH.write_text(json.dumps(override, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            os.chmod(OVERRIDE_PATH, 0o600)
        except OSError:
            pass
    elif OVERRIDE_PATH.exists():
        OVERRIDE_PATH.unlink()


def _capture_baseline() -> Dict[str, Optional[str]]:
    global _env_baseline
    if _env_baseline is None:
        _env_baseline = {env: os.environ.get(env) for env in FIELDS.values()}
    return _env_baseline


def apply_override_to_env() -> None:
    """override → os.environ；无 override 的字段回退基线。应用启动时调用一次，
    之后每次 set_channel 也会调用（含"置空回退"语义）。"""
    baseline = _capture_baseline()
    override = load_override()
    for field, env in FIELDS.items():
        value = override.get(field)
        if value:
            os.environ[env] = value
        else:
            base = baseline.get(env)
            if base is None:
                os.environ.pop(env, None)
            else:
                os.environ[env] = base


def get_channel_status() -> Dict[str, Any]:
    """当前生效的通道配置（密钥只回掩码）+ 哪些字段被 override。"""
    from sliderule_llm.config import get_llm_config

    _capture_baseline()
    cfg = get_llm_config()
    override = load_override()
    return {
        "baseUrl": cfg.base_url,
        "model": cfg.model,
        "provider": cfg.provider_name,
        "keyMasked": mask_key(cfg.api_key),
        "keyPresent": bool(cfg.api_key),
        "overriddenFields": sorted(override.keys()),
    }


def set_channel(payload: Dict[str, Any]) -> Dict[str, Any]:
    """更新 override：字段传非空字符串 = 覆盖；传空串/null = 清除该字段
    override（回退 .env 基线）；未传 = 不动。返回更新后的状态。"""
    _capture_baseline()
    override = load_override()
    for field in FIELDS:
        if field not in payload:
            continue
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            override[field] = value.strip()
        else:
            override.pop(field, None)
    _save_override(override)
    apply_override_to_env()
    return get_channel_status()


def test_channel(timeout_ms: int = 20_000) -> Dict[str, Any]:
    """对真通道发一次极小请求。ok/latency 或结构化失败原因，绝不粉饰。"""
    import time as _time

    from sliderule_llm.client import LlmError, call_llm

    started = _time.monotonic()
    try:
        # 实测经验（勿改回）：max_tokens 要给足（推理模型的思考计入输出额度，
        # 给 8 会被吃光）；且部分路由对英文极简指令（"reply: pong"）返回空内容，
        # 中文单 user 消息稳定有回。
        result = call_llm(
            [{"role": "user", "content": "这是一次连接测试，请回复两个字：正常"}],
            temperature=0.0,
            max_tokens=default_max_tokens(),
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        return {
            "ok": False,
            "code": "LLM_TEST_FAILED",
            "detail": str(exc)[:300],
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 — 网络层意外也如实归类
        return {
            "ok": False,
            "code": "LLM_TEST_ERROR",
            "detail": f"{type(exc).__name__}: {str(exc)[:260]}",
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }
    return {
        "ok": True,
        "model": result.model,
        "latencyMs": result.latency_ms,
        "elapsedMs": int((_time.monotonic() - started) * 1000),
    }
