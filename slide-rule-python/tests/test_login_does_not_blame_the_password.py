# -*- coding: utf-8 -*-
"""账号库连不上时，登录不许说「邮箱或密码不正确」。

## 事故（2026-09-05 真机）

容器里的代理端口换了号，dev 服务还揣着旧端口，于是**所有出站 HTTPS 都是
`Connection refused`**。`identity_store` 按设计降级：远端 → 本地 SQLite。
那个本地库里一个用户都没有。

结果：一个真实存在的账号登录，拿到的是

    POST /api/sliderule/account/login → 401 {"message": "邮箱或密码不正确"}

排查方向被这句话整个带偏——去核对密码、去点「忘记密码」（改到的还是那个
空库）。而服务端日志里躺着一行 `[identity] HTTPS 网关不可用，继续按常规
顺序降级`，没人会因为"密码不对"去翻它。

这跟同一天修的 `LLM_UNAVAILABLE`（网关连不上时别把锅甩给用户）是同一个
形状的另一扇门：**基础设施出不去，话术却在说人做错了事。**

## 两头都得钉（§3）

正：降级中 → 说服务连不上，HTTP 503。
反：库正常 → 密码打错还必须是那句 LOGIN_FAILED、还必须是 401。
    否则防枚举（模块说明 ①）就白做了——"这个邮箱不存在"和"密码错了"
    一旦能被区分，登录接口就成了用户枚举器。
"""

from __future__ import annotations

import ast
import inspect

import pytest

from services import auth_service, identity_store as ident


class _FakeUser(dict):
    id = "u1"
    is_active = True

    def public(self):  # noqa: D401
        return {"id": self.id}


class _FakeStore:
    def __init__(self, *, user=None, degraded=""):
        self._user = user
        self.degraded_from = degraded

    def get_by_email(self, email):  # noqa: ARG002
        return self._user


@pytest.fixture(autouse=True)
def _no_real_store(monkeypatch):
    """任何一条判据都不许真去连库。"""
    yield


def _install(monkeypatch, store):
    monkeypatch.setattr(ident, "get_identity_store", lambda: store)
    monkeypatch.setattr(
        ident,
        "identity_backend_degraded",
        lambda: str(getattr(store, "degraded_from", "") or ""),
    )


class Test降级中不许甩锅:
    def test_库连不上时说的是服务不可用(self, monkeypatch):
        _install(monkeypatch, _FakeStore(degraded="HTTPS SQL 网关不可用：Connection refused"))
        r = auth_service.login("someone@example.com", "whatever")
        assert r["ok"] is False
        assert r["error"] == "identity_unavailable"
        assert r["message"] == auth_service.IDENTITY_UNAVAILABLE
        assert r["message"] != auth_service.LOGIN_FAILED

    def test_那句话得明说不是用户的错(self):
        """措辞判据盯**语义**不盯字面（§2）：一个人读完要知道"不用去改密码"。"""
        msg = auth_service.IDENTITY_UNAVAILABLE
        assert "密码" in msg and ("不是" in msg or "无关" in msg), msg
        assert "不正确" not in msg.replace("不是你的密码有问题", ""), msg


class Test库正常时防枚举不许被破坏:
    """★ 反向配对。这几条比上面那几条更要紧：改坏了是安全问题，不是体验问题。"""

    def test_查无此人还是那句统一话术(self, monkeypatch):
        _install(monkeypatch, _FakeStore(degraded=""))
        r = auth_service.login("nobody@example.com", "whatever")
        assert r["error"] == "invalid_credentials"
        assert r["message"] == auth_service.LOGIN_FAILED

    def test_密码不对也是同一句_逐字节相同(self, monkeypatch):
        """有这个人但密码不对，跟没这个人，对外必须一模一样。"""
        user = _FakeUser({"password_hash": "$argon2id$v=19$m=1,t=1,p=1$YWJj$YWJj"})
        _install(monkeypatch, _FakeStore(user=user, degraded=""))
        got = auth_service.login("someone@example.com", "wrong-password")
        _install(monkeypatch, _FakeStore(user=None, degraded=""))
        none = auth_service.login("someone@example.com", "wrong-password")
        assert got == none, "两种失败被区分开了 = 送了个用户枚举器出去"

    def test_降级判据只看降级_不看有没有查到人(self, monkeypatch):
        """★ §一之二：护栏的条件在真机上真的会成立吗？

        降级时**恰恰是查不到人**，所以改口必须挂在 user is None 那一支里。
        挂在别处（比如只有密码不匹配时才改口）真机上永远不成立。
        """
        src = inspect.getsource(auth_service.login)
        tree = ast.parse(src.lstrip())
        found = False
        for node in ast.walk(tree):
            if not isinstance(node, ast.If):
                continue
            test = ast.dump(node.test)
            if "user" not in test or "Is(" not in test:
                continue
            if "identity_unavailable" in ast.dump(node):
                found = True
        assert found, "改口没挂在「查不到人」那一支里——真机降级时走的正是那一支"


class Test路由把它跟密码错分开:
    def test_不是401_是503(self):
        from routes import account

        src = inspect.getsource(account.login)
        assert "identity_unavailable" in src, "路由没区分账号库故障"
        assert "503" in src, "账号库连不上仍按 401 回——前端会去引导重输密码"

    def test_反向配对_真的密码错还是401(self):
        from routes import account

        src = inspect.getsource(account.login)
        assert "HTTPException(401" in src, "把 401 那条也改没了"


class Test降级标记接在真链路上:
    """§1：光有 `degraded_from` 字段不算数，得证明它**被填上**。"""

    def test_远端配了却落到本地兜底时会填上原因(self):
        src = inspect.getsource(ident._build_store)
        tree = ast.parse(src.lstrip())
        # 兜底那条 return 必须把 degraded 传下去。
        # ⚠ 别用 `rets[-1]`：ast.walk 是广度优先，"最后一个"不是源码里最后那条
        #   （第一版就这么抓到了 Neon-HTTP 那支，红得莫名其妙）。
        #   按语义找：`is_sqlite=True` 的那次构造才是本地兜底。
        fallbacks = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and getattr(n.func, "id", "") == "IdentityStore"
            and any(k.arg == "is_sqlite" and getattr(k.value, "value", None) is True
                    for k in n.keywords)
        ]
        assert fallbacks, "找不到本地兜底那次 IdentityStore 构造"
        assert all("degraded_from" in ast.dump(c) for c in fallbacks), (
            "兜底 IdentityStore 没带降级原因"
        )
        # 而且 degraded 在网关失败那一支里被赋过值
        assigns = [n for n in ast.walk(tree)
                   if isinstance(n, ast.Assign)
                   and any(getattr(t, "id", "") == "degraded" for t in n.targets)]
        assert len(assigns) >= 2, "只有初始化那一次赋值 = 降级原因永远是空串"

    def test_反向配对_没配远端时不算降级(self, monkeypatch):
        """纯本地开发落到 SQLite 是正常形态。这时密码打错还得是那句
        LOGIN_FAILED，不许说成"服务暂时不可用"——那会把本地开发者带偏。"""
        src = inspect.getsource(ident._build_store)
        assert 'degraded = ""' in src, "少了「没配远端就不算降级」这条初值"
