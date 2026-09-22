"""鉴权那两次查库并发发（2026-08-24），且判定次序与 fail 语义一个字没变。

## 为什么动它

真机实测（HTTPS SQL 网关）：

    不鉴权的 /api/agent-loop/health      4 ms
    带鉴权的 /api/sliderule/account/me  340 ms   ← 业务上什么都不干
    get_by_id 180ms + is_token_revoked 133ms = 313ms，串行

**每一个登录请求**都付这 313ms，工作台首屏那十几个请求条条在付。两条查询互不
依赖（撤销名单只要 jti），并发之后只剩一次往返。

## 这是安全路径，所以判据的重点不是"快"

并发化最容易出的不是慢，是**判定次序悄悄变了**：本来 ②③ 不过就该 return，
不该让 ④ 的结论有机会插队；本来 get_by_id 挂了是 fail-closed（按匿名），
is_token_revoked 挂了是 fail-open（放行），两者方向相反，顺手包进一个 try
就会同化。下面每条判定都单独钉。

变异：把 submit 改回原地调用（串行）→「并发」那条红；
把两条 fail 方向调换 → 对应那条红。
"""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

import pytest
from starlette.requests import Request
from starlette.responses import Response

pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

import middlewares.current_user as cu
from services.auth_tokens import create_access_token

PW_HASH = "argon2-fake-hash"
UID = "u-perf-1"


class _User(dict):
    """够 optional_user 用的最小 User：属性访问 + dict 取值。"""

    def __getattr__(self, k: str) -> Any:
        try:
            return self[k]
        except KeyError as exc:  # pragma: no cover
            raise AttributeError(k) from exc


def _user(active: bool = True, pw: str = PW_HASH) -> _User:
    return _User(id=UID, is_active=active, is_superuser=False, password_hash=pw)


class _Store:
    """可控延迟的假身份库，记录两条查询各自的起止时刻。"""

    def __init__(self, delay: float = 0.0, user: Optional[_User] = None):
        self.delay = delay
        self.user = _user() if user is None else user
        self.marks: dict[str, tuple[float, float]] = {}
        self.revoked = False
        self.get_raises: Optional[Exception] = None
        self.revoke_raises: Optional[Exception] = None
        self.revoke_called = threading.Event()

    def _sleep(self, key: str):
        start = time.time()
        time.sleep(self.delay)
        self.marks[key] = (start, time.time())

    def get_by_id(self, _uid: str):
        self._sleep("get_by_id")
        if self.get_raises:
            raise self.get_raises
        return self.user

    # 鉴权路径调的是带 TTL 的那条。这个假库不缓存——并发/判定次序那几条判据
    # 要的是"每次都真查"，缓存会把它们变成不确定的。缓存本身另有一份判据
    # （test_auth_identity_cache.py）。
    def get_by_id_for_auth(self, uid: str):
        return self.get_by_id(uid)

    # 鉴权路径调的是带 TTL 的那条；这个假库不缓存，理由同 get_by_id_for_auth。
    def is_token_revoked_for_auth(self, jti: str) -> bool:
        return self.is_token_revoked(jti)

    def is_token_revoked(self, _jti: str) -> bool:
        self.revoke_called.set()
        self._sleep("is_token_revoked")
        if self.revoke_raises:
            raise self.revoke_raises
        return self.revoked


def _req(cookie_token: str) -> Request:
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/sliderule/sessions",
            "raw_path": b"/api/sliderule/sessions",
            "query_string": b"",
            "headers": [(b"cookie", f"{cu.AUTH_COOKIE}={cookie_token}".encode())],
            "client": ("127.0.0.1", 9),
            "server": ("test", 80),
        }
    )


def _call(store: _Store, monkeypatch, token: str):
    monkeypatch.setattr(cu, "get_identity_store", lambda: store)
    return cu.optional_user(_req(token), Response(), None, token)


@pytest.fixture
def token() -> str:
    return create_access_token(UID, password_hash=PW_HASH)


def test_两条查库是并发发出的(token, monkeypatch):
    """判"两段执行区间有重叠"，不 grep 源码——写法可以变，别串行不变。"""
    store = _Store(delay=0.25)
    started = time.time()
    user = _call(store, monkeypatch, token)
    elapsed = time.time() - started

    assert user is not None and user.id == UID, "并发不能把结论弄丢"
    # 串行 ≥ 2×delay，并发 ≈ 1×delay。1.6× 当闸，留足调度抖动。
    assert elapsed < 0.25 * 1.6, f"两条查库看起来是串行的：{elapsed:.2f}s"
    # 更直接的一条：两段执行区间必须真的重叠
    a_start, a_end = store.marks["get_by_id"]
    b_start, b_end = store.marks["is_token_revoked"]
    assert a_start < b_end and b_start < a_end, "两段执行区间没有重叠 = 串行"


def test_伪造或过期的令牌一次库都不查(monkeypatch):
    """① 签名与过期是纯内存的，走不到查库那一步。

    ⚠ 这条是原来"把撤销查询放最后"那个理由的真正落点（头注：没必要为一张签名
      就不对的令牌白查一次）。并发化把撤销查询提前发了，所以必须证明它仍然在
      ① 之后——否则任何人往接口上糊一串垃圾都能让我们打一次库。
    """
    store = _Store(delay=0.0)
    assert _call(store, monkeypatch, "not-a-real-token") is None
    assert store.marks == {}, "签名都不对的令牌不该触发任何一次查库"

    expired = create_access_token(UID, password_hash=PW_HASH, ttl_s=-10)
    store2 = _Store(delay=0.0)
    assert _call(store2, monkeypatch, expired) is None
    assert store2.marks == {}, "过期令牌同样不该查库"


def test_停用的账号仍然按未登录处理(token, monkeypatch):
    """② 账号还在、还活着 —— 并发不能让这道失效。"""
    store = _Store(delay=0.0, user=_user(active=False))
    assert _call(store, monkeypatch, token) is None


def test_改过密码的旧令牌仍然被踢掉(token, monkeypatch):
    """③ 密码戳 —— 2026-08-04 加它就是为了"改了密码，旧令牌全灭"。

    并发化之后撤销查询先发了，但 ③ 不过就必须 return，不许等 ④ 的结论。
    """
    store = _Store(delay=0.0, user=_user(pw="换过密码了"))
    assert _call(store, monkeypatch, token) is None


def test_撤销名单里的令牌仍然被踢掉(token, monkeypatch):
    """④ 撤销名单 —— 结果改成从 future 取，结论不变。"""
    store = _Store(delay=0.0)
    store.revoked = True
    assert _call(store, monkeypatch, token) is None
    store.revoked = False
    assert _call(store, monkeypatch, token) is not None


def test_身份库挂了按匿名处理_fail_closed(token, monkeypatch):
    """get_by_id 挂 → 匿名。**不许**因为并发把它同化成 fail-open。"""
    store = _Store(delay=0.0)
    store.get_raises = RuntimeError("身份库抖了")
    assert _call(store, monkeypatch, token) is None


def test_撤销表挂了照旧放行_fail_open(token, monkeypatch):
    """is_token_revoked 挂 → 放行。方向与上一条**相反**，别混。

    理由见 optional_user 里那段：撤销表是"额外收紧"的机制，它挂掉时该退回到
    "没有撤销表"的行为，而不是把所有已登录用户锁在门外。
    """
    store = _Store(delay=0.0)
    store.revoke_raises = RuntimeError("撤销表抖了")
    user = _call(store, monkeypatch, token)
    assert user is not None and user.id == UID


def test_提前return时把已发出的查询收掉(token, monkeypatch):
    """并发化新增的失败形状：判定提前 return，撤销查询的异常没人 result()。

    现象是日志里一行 "exception was never retrieved"——不影响功能、也没人看得
    见，直到某天它变成真问题。这里验它确实被发出去了、而且收干净了（不抛）。
    """
    store = _Store(delay=0.0, user=_user(active=False))  # ② 不过，提前 return
    store.revoke_raises = RuntimeError("撤销表也挂了")
    assert _call(store, monkeypatch, token) is None
    assert store.revoke_called.is_set(), "撤销查询应该已经并发发出去了"
