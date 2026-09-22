"""LLM 错误文案人话化测试。

锁：HTML 错误页剥标签坍缩空白；upstream/HTTP/gateway 5xx 加人话前缀
（瞬时故障建议重试）；非 5xx 原样清洗透传（保留可诊断信息如 502/429
数字与原因文本）；永不抛异常。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.llm_error_text import humanize_llm_error


def test_upstream_502_html_page_becomes_human_readable() -> None:
    raw = (
        'LlmError: upstream 502: <!DOCTYPE html> <!--[if lt IE 7]> '
        '<html class="no-js ie6 oldie" lang="en-US"> <![endif]--> '
        "<body><h1>502 Bad Gateway</h1></body>"
    )
    out = humanize_llm_error(raw)
    assert out.startswith("LLM 服务商网关 502（瞬时故障，建议稍后重试）")
    assert "<" not in out and ">" not in out  # HTML 标签剥净
    assert "502" in out


def test_gateway_timeout_524_and_http_503_matched() -> None:
    assert humanize_llm_error("gateway timeout (524): snippet").startswith("LLM 服务商网关 524")
    assert humanize_llm_error("HTTP 503: overloaded").startswith("LLM 服务商网关 503")
    assert humanize_llm_error("gateway timeout (522):").startswith("LLM 服务商网关 522")


LIVE_524_EXHAUSTED = (
    'gateway timeout (524): {"error":{"message":"All available accounts exhausted"'
    ',"type":"server_error"}}'
)


def test_accounts_exhausted_524_is_not_called_transient() -> None:
    """真机句子。账号池空不许说成瞬时故障。"""
    out = humanize_llm_error(LIVE_524_EXHAUSTED)
    assert "账号池" in out
    assert "冷却" in out
    assert "瞬时故障" not in out


def test_non_5xx_passthrough_cleaned() -> None:
    # 429/鉴权类不是网关瞬时错误 → 不加 5xx 前缀，原文清洗透传
    out = humanize_llm_error("429: rate limited or out of quota")
    assert "429" in out and "网关" not in out
    out2 = humanize_llm_error("auth failed (401): check API key")
    assert "401" in out2 and "网关" not in out2
    # provider 502（无 upstream/HTTP 前缀）不误判为网关——数字仍保留
    assert "502" in humanize_llm_error("provider 502")


def test_never_raises_and_truncates() -> None:
    assert humanize_llm_error(None) == ""
    assert humanize_llm_error("") == ""
    assert len(humanize_llm_error("x" * 1000)) <= 240
