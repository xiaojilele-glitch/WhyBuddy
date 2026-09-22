# -*- coding: utf-8 -*-
"""三个存储是不是都走上了 HTTPS SQL 网关（2026-08-05）。

## 起因

换库那天只有**应用库**接了网关，身份库和会话档仍然只认 `APP_STORE_DATABASE_URL`。
连接串留空之后，两者各自回落本地 SQLite——**不报错**，表现是「账号能注册、
换台机器就没了」。这类降级最难发现，因为每一步看起来都成功。

所以这里钉的不是"能连上"，而是"**选中的是哪个后端**"：三个存储必须都落在
网关上，任何一个偷偷回落本地都算失败。

## 为什么不打真库

选路逻辑不需要真库就能验，而真库往返在另一处（提交说明里记的手工验证）跑。
这里用一个假的 httpx 客户端顶上，让测试离线可跑、且不往生产库写测试数据。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import settings  # noqa: E402
from services import app_store, identity_store, session_blob_store  # noqa: E402

GATEWAY = "https://example.invalid/db-api"
KEY = "test-key"


class _FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FakeClient:
    """记下每一次请求，永远回空结果集——建表和查询都能过。"""

    def __init__(self, *a, **k):
        self.calls: list[dict] = []

    def post(self, url, json=None, **k):
        self.calls.append({"url": url, **(json or {})})
        return _FakeResponse({"ok": True, "columns": [], "rows": [], "truncated": False})


@pytest.fixture
def gateway(monkeypatch):
    """把三个存储都指向网关，并把 httpx 换成假客户端。"""
    import httpx

    calls: list[dict] = []

    def _client(*a, **k):
        c = _FakeClient()
        c.calls = calls
        return c

    monkeypatch.setattr(httpx, "Client", _client)
    monkeypatch.setattr(settings, "APP_STORE_HTTP_API_URL", GATEWAY, raising=False)
    monkeypatch.setattr(settings, "APP_STORE_HTTP_API_KEY", KEY, raising=False)
    # 连接串留空 = 正是线上那个配置：只有网关，没有 TCP
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    # conftest 给全套件按了会话存档文件（隔离用），而"指定了文件"在
    # session_blob_store 里的语义就是"这台机器不进库"——不摘掉它，会话档
    # 这一条永远走不到网关。
    for env in session_blob_store._FILE_OVERRIDE_ENVS:
        monkeypatch.delenv(env, raising=False)
    app_store.reset_backend_cache()
    identity_store.reset_identity_cache()
    session_blob_store.reset_cache()
    yield calls
    app_store.reset_backend_cache()
    identity_store.reset_identity_cache()
    session_blob_store.reset_cache()


class TestAllThreeStoresPickTheGateway:
    def test_应用库走网关(self, gateway):
        assert isinstance(app_store.get_backend(), app_store.HttpApiAppStore)

    def test_身份库走网关而不是回落本地_SQLite(self, gateway):
        store = identity_store.get_identity_store()
        # ⚠ 2026-08-24 起 _x 外面包了一层 _InvalidatingExecutor（写操作要清鉴权
        #   缓存，见 identity_store）。这条判据问的是"选了哪个通道"，跟包没包
        #   一层无关，所以先剥壳再判。getattr 带默认值：没有那层包装时照旧。
        inner = getattr(store._x, "_inner", store._x)
        assert isinstance(inner, identity_store._HttpApiExecutor)
        assert store._is_sqlite is False, "回落本地 SQLite 就意味着账号不跨机器"

    def test_会话档走网关而不是回落文件(self, gateway):
        store = session_blob_store.get_store()
        assert store is not None, "None 表示回落成本地文件了"
        assert isinstance(store, session_blob_store.HttpApiSessionBlobStore)

    def test_三个存储打的是同一个端点(self, gateway):
        app_store.get_backend()
        identity_store.get_identity_store()
        session_blob_store.get_store()
        urls = {c["url"] for c in gateway}
        assert urls == {f"{GATEWAY}/v1/query"}, f"端点不一致，数据会分叉: {urls}"

    def test_发出去的语句里没有残留的编号占位符(self, gateway):
        """漏一个就是一次 `there is no parameter $1`——换库那天真踩过。"""
        app_store.get_backend()
        identity_store.get_identity_store()
        session_blob_store.get_store()
        assert gateway, "一条语句都没发出去，说明建表被跳过了"
        for call in gateway:
            sql = call.get("sql", "")
            assert "$1" not in sql, f"占位符没转干净: {sql[:120]}"


class TestGatewayGuards:
    def test_没配密钥时不走网关(self, monkeypatch):
        """半套配置比没配更危险：得明确忽略并说出来，而不是拿空 token 去打。"""
        monkeypatch.setattr(settings, "APP_STORE_HTTP_API_URL", GATEWAY, raising=False)
        monkeypatch.setattr(settings, "APP_STORE_HTTP_API_KEY", "", raising=False)
        monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
        app_store.reset_backend_cache()
        identity_store.reset_identity_cache()
        session_blob_store.reset_cache()
        try:
            assert not isinstance(app_store.get_backend(), app_store.HttpApiAppStore)
            assert identity_store.get_identity_store()._is_sqlite is True
            assert session_blob_store.get_store() is None
        finally:
            app_store.reset_backend_cache()
            identity_store.reset_identity_cache()
            session_blob_store.reset_cache()

    def test_截断必须抛而不是少给几行(self, monkeypatch):
        """少几行不报错是最难查的一类故障——会话"莫名其妙少了几个"。"""
        import httpx

        class _Truncating(_FakeClient):
            def post(self, url, json=None, **k):
                return _FakeResponse(
                    {"ok": True, "rows": [{"a": 1}], "truncated": True}
                )

        monkeypatch.setattr(httpx, "Client", lambda *a, **k: _Truncating())
        gw = app_store.HttpSqlGateway(GATEWAY, KEY)
        with pytest.raises(app_store.NeonHttpError, match="截断"):
            gw.query("select * from t")

    def test_密钥不进_URL_只进请求头(self, monkeypatch):
        """凭据落进 URL 就会进访问日志、进 Referer、进代理的记录。"""
        import httpx

        seen = {}

        class _Recording(_FakeClient):
            def __init__(self, *a, **k):
                super().__init__()
                seen.update(k.get("headers") or {})

        monkeypatch.setattr(httpx, "Client", lambda *a, **k: _Recording(*a, **k))
        gw = app_store.HttpSqlGateway(GATEWAY, KEY)
        assert KEY not in gw.endpoint
        assert seen.get("Authorization") == f"Bearer {KEY}"
