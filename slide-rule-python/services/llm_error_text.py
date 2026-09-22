"""LLM 错误文案人话化（面向用户的 blocker/试跑失败提示）。

线上案例：供应商网关 502 返回整页 nginx HTML 错误页，被原样透传进
blocker——用户看到一屏 `<!DOCTYPE html>...`。这里做展示层清洗：
剥 HTML 标签、坍缩空白；识别出 5xx 网关错误时前置一句人话
（瞬时故障，建议稍后重试）。只改"怎么说"，不改 fail-closed 语义
——失败仍然是失败，原因仍然如实保留（截断后的纯文本摘录）。
"""

from __future__ import annotations

import re

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
_GATEWAY_5XX_RE = re.compile(r"(?:upstream|HTTP|gateway timeout \()\s*(5\d{2})", re.IGNORECASE)
_ACCOUNTS_EXHAUSTED_RE = re.compile(
    r"accounts?\s+exhausted|no\s+available\s+accounts?|all available accounts"
    r"|gateway circuit open",
    re.IGNORECASE,
)


def humanize_llm_error(text: object, limit: int = 240) -> str:
    """剥 HTML/坍缩空白；5xx 网关错误加一句人话前缀。永不抛异常。

    ⚠ 2026-09-20 真机 sr-20260920102543-OFFICE：524 响应体是
      `All available accounts exhausted`，罐头却说「瞬时故障」。
      账号池空不是 Cloudflare TLS，冷却期内再打只会把门焊死。
    """
    raw = str(text or "")
    cleaned = _WS_RE.sub(" ", _TAG_RE.sub(" ", raw)).strip()
    if _ACCOUNTS_EXHAUSTED_RE.search(raw):
        head = "账号池空了，网关正在冷却，请稍后再试"
        excerpt = cleaned[:120].strip()
        return f"{head} · {excerpt}" if excerpt else head
    m = _GATEWAY_5XX_RE.search(raw)
    if m:
        head = f"LLM 服务商网关 {m.group(1)}（瞬时故障，建议稍后重试）"
        excerpt = cleaned[:120].strip()
        return f"{head} · {excerpt}" if excerpt else head
    return cleaned[:limit]
