"""登录令牌怎么从请求里拿出来（2026-08-20）。

真机形状：左下角显示已登录，PUT /sessions 200，POST /drive-full-stream 401
「请先登录后再推演」。两条路共用 optional_user，差在令牌怎么取。

这里钉两件 Cookie() 注入覆盖不到的事：

  ① FastAPI Cookie() 是空的，但原始 Cookie 头还在 → 必须读出来
  ② Authorization 是坏 Bearer，Cookie 是好的 → 必须回落到 Cookie

变异：把 `_cookie_token` 改回只信 injected、或把 `_pick_access_token` 改回
「Bearer 非空就忽略 Cookie」，这两条会红。
"""

from __future__ import annotations

import pytest
from starlette.requests import Request

pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

from middlewares.current_user import AUTH_COOKIE, _cookie_token, _pick_access_token
from services.auth_tokens import create_access_token


def _request_with_cookie_header(raw: str) -> Request:
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/sliderule/drive-full-stream",
            "raw_path": b"/api/sliderule/drive-full-stream",
            "query_string": b"",
            "headers": [(b"cookie", raw.encode("latin-1"))],
            "client": ("127.0.0.1", 9),
            "server": ("test", 80),
        }
    )


def test_cookie_token_reads_raw_header_when_injection_is_empty():
    """注入是 None 不等于浏览器没带 Cookie。"""
    req = _request_with_cookie_header(f"{AUTH_COOKIE}=eyJ-from-header")
    assert _cookie_token(req, None) == "eyJ-from-header"
    assert _cookie_token(req, "  ") == "eyJ-from-header"
    # 注入有值时仍以注入为准（FastAPI 解析成功的那条路）
    assert _cookie_token(req, "injected") == "injected"


def test_cookie_token_parses_header_when_starlette_cookies_are_empty():
    """Starlette 没解析出 cookies 时，从原头再拆。只信 request.cookies 会漏。"""

    class _Req:
        cookies: dict = {}
        headers = {"cookie": f"{AUTH_COOKIE}=eyJ-from-header; other=1"}

    assert _cookie_token(_Req(), None) == "eyJ-from-header"


def test_junk_bearer_falls_back_to_valid_cookie():
    """解不开的 Bearer 必须改试 Cookie。旧实现看见 Bearer 就 return 那串垃圾。"""
    cookie = create_access_token("u-alice", password_hash="hashed")
    token, payload, from_cookie = _pick_access_token(
        "Bearer definitely-not-a-jwt", cookie
    )
    assert payload is not None
    assert payload["sub"] == "u-alice"
    assert from_cookie is True
    assert token == cookie
    # 反向：没有 Cookie 时坏 Bearer 仍然解不开（不许凭空放行）
    none_token, none_payload, _ = _pick_access_token(
        "Bearer definitely-not-a-jwt", None
    )
    assert none_payload is None
    assert none_token is None
