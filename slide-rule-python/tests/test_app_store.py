"""生成应用存储 / App Store（2026-07-24）的单测覆盖。

同一套 SQLAlchemy 代码在 SQLite（本地/CI，离线）和 Postgres（生产 Neon）上
跑，所以这里用 SQLite 内存/临时库把落库逻辑全测通，等于间接验证了生产
Postgres 路径；再单独测 JSON 文件兜底。两条后端跑同一批断言（参数化），
证明"有 DB 用 DB、没 DB 回退文件"两条路行为一致。
"""

import json
import os
import tempfile

import pytest

import services.app_store as store


def _model(name: str, entities: int = 2, pages: int = 2, theme: str = "forest") -> dict:
    return {
        "datamodel": {"entities": [{"id": f"e{i}", "name": f"E{i}", "fields": []} for i in range(entities)]},
        "page": {"pages": [{"id": f"p{i}", "kind": "monitor" if i == 0 else "workbench"} for i in range(pages)]},
        "appbundle": {
            "landingPageRef": "p0",
            "preferredDevice": "desktop",
            "appIdentity": {"productName": name, "theme": theme, "generatedTheme": {"label": f"{theme}·测试"}},
        },
    }


@pytest.fixture(params=["jsonfile", "sqlite"])
def configured_store(request, tmp_path, monkeypatch):
    """同一批断言在两个后端各跑一遍。"""
    if request.param == "jsonfile":
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
        monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
        # 2026-07-28 起降级链多了一级本地 SQLite（远端 → 本地库 → JSON）。
        # 要测 JSON 兜底本身，得把中间那级关掉，否则永远走不到最后一档。
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    else:
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'apps.db'}")
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    yield request.param
    store.reset_backend_cache()


def test_save_and_get_roundtrip(configured_store):
    app_id = store.save_app(_model("咖营通"), goal="咖啡店", session_id="s1", gate_passed=True)
    rec = store.get_app(app_id)
    assert rec is not None
    assert rec["product_name"] == "咖营通"
    assert rec["theme_id"] == "forest" and rec["theme_label"] == "forest·测试"
    assert rec["entity_count"] == 2 and rec["page_count"] == 2
    assert rec["gate_passed"] is True
    assert rec["model_json"]["appbundle"]["landingPageRef"] == "p0"  # 完整模型回读得到
    assert rec["visibility"] == "private", "新建默认私有，否则一闭环就出现在应用市场"
    assert rec.get("is_official") is False


def test_get_missing_returns_none(configured_store):
    assert store.get_app("does-not-exist") is None


def test_list_is_summary_and_latest_per_root(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    store.save_app(_model("宠医云"), session_id="s2")
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通", entities=3))
    apps = store.list_apps()
    assert len(apps) == 2, "每个应用只出最新版"
    assert all("model_json" not in a for a in apps), "列表是摘要，不含大模型载荷"
    ka = next(a for a in apps if a["product_name"] == "咖营通")
    assert ka["version"] == 2 and ka["entity_count"] == 3, "出的应是最新版"


def test_versions_chain(configured_store):
    a = store.save_app(_model("咖营通"))
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通"))
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通"))
    versions = store.list_versions(a)
    assert [v["version"] for v in versions] == [1, 2, 3]
    assert all(v["root_id"] == a for v in versions)


def test_fork_creates_new_lineage(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a, session_id="s9")
    assert fk is not None and fk != a
    rec = store.get_app(fk)
    assert rec["parent_id"] == a, "fork 的 parent 指向源"
    assert rec["root_id"] == fk and rec["version"] == 1, "fork 是新血缘根、v1"
    assert rec["model_json"]["appbundle"]["appIdentity"]["productName"] == "咖营通", "model 拷贝了一份"
    assert len(store.list_apps()) == 2, "fork 后是两个独立根"


def test_fork_missing_source_returns_none(configured_store):
    assert store.fork_app("nope") is None


def test_fork_with_new_name_renames_copy(configured_store):
    """复刻改名（对标 Budibase）：副本的 productName + product_name 元数据都跟着改，
    源应用不受影响。"""
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a, new_name="奶茶版")
    rec = store.get_app(fk)
    assert rec["product_name"] == "奶茶版"
    assert rec["model_json"]["appbundle"]["appIdentity"]["productName"] == "奶茶版"
    assert rec["parent_id"] == a and rec["root_id"] == fk, "仍是新血缘、parent 指源"
    assert store.get_app(a)["product_name"] == "咖营通", "源应用名不受影响"


def test_fork_default_does_not_inherit_source_session(configured_store):
    """默认不继承源会话——避免点开副本却进了源应用的会话。"""
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a)  # 不传 session_id
    assert store.get_app(fk)["session_id"] is None


def test_fork_of_an_official_app_is_not_official(configured_store):
    """官方货架上的应用被 Fork 之后是普通副本，不能带着官方标记进我的应用。"""
    a = store.save_app(_model("官方样板"), session_id="s1", visibility="public")
    store.patch_app(a, is_official=True)
    assert store.get_app(a)["is_official"] is True
    assert store.get_app(a)["owner_id"] == "system:official"
    fk = store.fork_app(a, owner_id="u-bob")
    copy = store.get_app(fk)
    assert copy["is_official"] is False
    assert copy["visibility"] == "private"
    assert copy["owner_id"] == "u-bob"
    mine = store.list_apps(shelf="mine", owner_id="u-bob")
    assert copy["id"] in {r["id"] for r in mine}
    official = store.list_apps(shelf="official")
    assert copy["id"] not in {r["id"] for r in official}
    assert a in {r["id"] for r in official}


def test_dedup_key_is_idempotent(configured_store):
    model = _model("咖营通")
    sig = store.model_signature("s1", model)
    id1 = store.save_app(model, session_id="s1", dedup_key=sig)
    id2 = store.save_app(model, session_id="s1", dedup_key=sig)
    assert id1 == id2, "同 dedup_key → 幂等更新同一条"
    assert len(store.list_apps()) == 1, "同会话反复落同一模型不堆重复"


def test_dedup_key_new_record_when_model_changes(configured_store):
    id1 = store.save_app(_model("咖营通", entities=2), session_id="s1",
                         dedup_key=store.model_signature("s1", _model("咖营通", entities=2)))
    id2 = store.save_app(_model("咖营通", entities=5), session_id="s1",
                         dedup_key=store.model_signature("s1", _model("咖营通", entities=5)))
    assert id1 != id2, "模型内容变了 → 签名变 → 落新记录"
    assert len(store.list_apps()) == 2


def test_delete_removes_record(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    store.save_app(_model("宠医云"), session_id="s2")
    assert store.delete_app(a) is True
    assert store.get_app(a) is None
    assert len(store.list_apps()) == 1, "删掉一条后列表只剩另一条"


def test_delete_app_drops_entire_version_chain(configured_store):
    """画廊一张卡 = 一个 root。只删最新版的话刷新会把上一版顶回来。

    把 ``delete_app`` 改回 ``backend.delete(最新 id)``，这条必红。
    """
    v1 = store.save_app(_model("咖营通"), session_id="s1")
    v2 = store.save_version(root_id=v1, parent_id=v1, model=_model("咖营通", entities=3))
    v3 = store.save_version(root_id=v1, parent_id=v2, model=_model("咖营通", entities=4))
    other = store.save_app(_model("宠医云"), session_id="s2")
    assert store.delete_app(v3) is True
    assert store.get_app(v1) is None
    assert store.get_app(v2) is None
    assert store.get_app(v3) is None
    leftover = store.list_apps()
    assert [a["id"] for a in leftover] == [other]
    assert store.delete_app(v3) is False


def test_delete_app_does_not_touch_fork_source(configured_store):
    src = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(src, new_name="奶茶版")
    assert store.delete_app(fk) is True
    assert store.get_app(fk) is None
    assert store.get_app(src) is not None
    assert store.get_app(src)["product_name"] == "咖营通"


def test_unbind_session_clears_pointer_keeps_app(configured_store):
    """删 Codespace 不删仓库：卡留下，session_id 必须空。"""
    a = store.save_app(_model("咖营通"), session_id="sr-dead")
    b = store.save_app(_model("宠医云"), session_id="sr-live")
    assert store.unbind_session("sr-dead") == 1
    assert store.get_app(a)["session_id"] is None
    assert store.get_app(a) is not None
    assert store.get_app(b)["session_id"] == "sr-live"
    assert store.unbind_session("sr-dead") == 0
    assert store.unbind_session("") == 0


def test_bind_session_rewrites_workspace(configured_store):
    a = store.save_app(_model("咖营通"), session_id="old")
    rec = store.bind_session(a, "sliderule-work-abc")
    assert rec["session_id"] == "sliderule-work-abc"
    assert store.get_app(a)["session_id"] == "sliderule-work-abc"
    assert store.bind_session("missing", "x") is None


def test_delete_missing_returns_false(configured_store):
    assert store.delete_app("does-not-exist") is False


def test_export_all_returns_full_records(configured_store):
    store.save_app(_model("咖营通"))
    store.save_app(_model("宠医云"))
    dump = store.export_all()
    assert len(dump) == 2
    assert all("model_json" in r for r in dump), "导出是完整记录（可迁移备份）"


def test_no_db_url_falls_back_to_local_sqlite(tmp_path, monkeypatch):
    """没配远端连接串时落**本地 SQLite**，不是 JSON（2026-07-28 起）。

    优先级是 远端 → 本地库 → JSON。没有远端不代表就该退到最弱的那一档：
    SQLite 能查能索引、写入是事务性的，JSON 是整文件读改写。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    assert (tmp_path / "local.db").exists()
    store.reset_backend_cache()


def test_local_sqlite_disabled_falls_back_to_jsonfile(tmp_path, monkeypatch):
    """本地库置空 = 跳过这一级，直接 JSON。只读文件系统/容器里用得上。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    store.reset_backend_cache()


def test_local_sqlite_config_is_part_of_backend_signature(tmp_path, monkeypatch):
    """改本地库配置要能触发重建——否则改了配置像没生效（拿的是旧单例）。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'a.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    # 不调 reset_backend_cache——签名变了就该自己重建
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    store.reset_backend_cache()


class _FakeNullPool:
    """占位——只需身份可比对，_sql_engine_config 不实例化它。"""


def test_postgres_engine_config_follows_neon_best_practices():
    """Neon（-pooler = PgBouncer transaction 模式）最佳实践锁死：
    psycopg 关预处理语句 + NullPool（不双层池）+ 连接超时。"""
    connect_args, engine_kwargs = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x-pooler.neon.tech/db?sslmode=require", _FakeNullPool
    )
    # ① 关掉客户端预处理语句（否则 transaction 池并发抛 prepared statement 错）
    assert connect_args["prepare_threshold"] is None
    # ② 用 NullPool，不让 SQLAlchemy 再套一层池跟 PgBouncer 打架
    assert engine_kwargs["poolclass"] is _FakeNullPool
    # ③ 连不上快速失败
    assert connect_args["connect_timeout"] == 4
    # postgres 不该用 pre_ping（NullPool 无长连可 ping）
    assert "pool_pre_ping" not in engine_kwargs


def test_sqlite_engine_config_no_pgbouncer_tweaks():
    """SQLite 本地库：不该带 postgres 专属的 NullPool/prepare_threshold。"""
    connect_args, engine_kwargs = store._sql_engine_config("sqlite:///x.db", _FakeNullPool)
    assert "prepare_threshold" not in connect_args
    assert "poolclass" not in engine_kwargs
    assert engine_kwargs.get("pool_pre_ping") is True


def test_bad_db_url_fails_open_to_local_sqlite(tmp_path, monkeypatch):
    """远端初始化失败（无法解析的连接串）时降到本地 SQLite，不崩。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", "not-a-valid-url://xxx")
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    store.reset_backend_cache()


def test_bad_db_url_and_no_local_falls_open_to_jsonfile(tmp_path, monkeypatch):
    """远端挂 + 本地库禁用 → 最后一档 JSON。任何一级失败都不抛给调用方。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", "not-a-valid-url://xxx")
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    store.reset_backend_cache()


# ── Neon SQL over HTTP 后端（受限网络第二选择）────────────────────────
# 真实往返需要出网，CI 里跑不了；这里锁的是不依赖网络的纯逻辑：端点派生
# 与类型归一化。二者错了，HTTP 后端会静默给出与另两个后端不一致的数据。

def test_neon_http_endpoint_derived_only_for_neon_hosts():
    """只有 *.neon.tech 才派生 HTTP 端点——别的 Postgres 没这个口，
    盲拼地址只会换来一串困惑的连接错误。"""
    assert store.neon_http_endpoint(
        "postgresql://u:p@ep-x-pooler.c-4.us-east-2.aws.neon.tech/db?sslmode=require"
    ) == "https://ep-x-pooler.c-4.us-east-2.aws.neon.tech/sql"
    # 驱动前缀（psycopg）也要能解析
    assert store.neon_http_endpoint("postgresql+psycopg://u:p@ep-y.neon.tech/db") == (
        "https://ep-y.neon.tech/sql"
    )
    # 非 Neon / 本地库 / 垃圾串 → None（不派生）
    assert store.neon_http_endpoint("postgresql://u:p@my-rds.amazonaws.com/db") is None
    assert store.neon_http_endpoint("sqlite:///data/apps.db") is None
    assert store.neon_http_endpoint("not-a-url") is None


def test_http_api_query_endpoint_normalizes_base_urls():
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api/") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api/v1/query") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("") is None


class _FakeHttpxResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"rows": []}
        self.text = json.dumps(self._payload, ensure_ascii=False)

    def json(self):
        return self._payload


class _FakeHttpxClient:
    instances = []

    def __init__(self, timeout=None, headers=None):
        self.timeout = timeout
        self.headers = headers or {}
        self.posts = []
        self.__class__.instances.append(self)

    def post(self, endpoint, json=None):
        self.posts.append((endpoint, json))
        return _FakeHttpxResp()


def test_http_api_backend_uses_sql_endpoint_and_bearer_token(monkeypatch):
    import httpx

    _FakeHttpxClient.instances.clear()
    monkeypatch.setattr(httpx, "Client", _FakeHttpxClient)

    backend = store.HttpApiAppStore("https://miantuan.ai/db-api", "secret-token")
    client = _FakeHttpxClient.instances[-1]
    assert client.headers["Authorization"] == "Bearer secret-token"
    assert client.posts[0][0] == "https://miantuan.ai/db-api/v1/query"
    assert client.posts[0][1]["sql"].lstrip().startswith("create table if not exists generated_app")
    assert client.posts[0][1]["timeout_ms"] == store._PG_STATEMENT_TIMEOUT_MS

    backend._q("select 1", [])
    assert client.posts[-1][1]["sql"] == "select 1"
    assert client.posts[-1][1]["params"] == []
    assert client.posts[-1][1]["timeout_ms"] == store._PG_STATEMENT_TIMEOUT_MS


def test_会话档语句超时比应用库宽_墙钟宽过语句(monkeypatch):
    """咖啡馆 10 轮：会话 UPSERT 被 8s statement_timeout 掐死，/db-api 回 500。

    应用库仍是百毫秒级读，保持 8s。谁把会话通道改回默认 8s，这条必红。
    """
    import httpx
    from services import session_blob_store as sbs

    _FakeHttpxClient.instances.clear()
    monkeypatch.setattr(httpx, "Client", _FakeHttpxClient)

    blob = sbs.HttpApiSessionBlobStore("https://miantuan.ai/db-api", "secret-token")
    client = _FakeHttpxClient.instances[-1]
    assert client.timeout == sbs._HTTP_TIMEOUT_S
    assert client.timeout > sbs._BLOB_STATEMENT_TIMEOUT_MS / 1000, (
        "墙钟必须宽过语句超时，否则 httpx 先报 timed out"
    )
    blob._q("select 1", [])
    assert client.posts[-1][1]["timeout_ms"] == sbs._BLOB_STATEMENT_TIMEOUT_MS
    assert client.posts[-1][1]["timeout_ms"] != store._PG_STATEMENT_TIMEOUT_MS

    app = store.HttpApiAppStore("https://miantuan.ai/db-api", "secret-token")
    app_client = _FakeHttpxClient.instances[-1]
    app._q("select 1", [])
    assert app_client.posts[-1][1]["timeout_ms"] == store._PG_STATEMENT_TIMEOUT_MS


def test_http_api_base_url_takes_priority_when_configured(tmp_path, monkeypatch):
    chosen = []

    class FakeHttpApi:
        def __init__(self, api_base_url, api_key):
            chosen.append((api_base_url, api_key))

    monkeypatch.setattr(store, "HttpApiAppStore", FakeHttpApi)
    monkeypatch.setattr(store.settings, "APP_STORE_HTTP_API_URL", "https://miantuan.ai/db-api")
    monkeypatch.setattr(store.settings, "APP_STORE_HTTP_API_KEY", "secret-token")
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()

    backend = store.get_backend()
    assert type(backend).__name__ == "FakeHttpApi"
    assert chosen == [("https://miantuan.ai/db-api", "secret-token")]
    store.reset_backend_cache()


def test_neon_row_normalization_matches_other_backends():
    """HTTP 端点的 timestamptz 是 '2026-07-26 12:34:56+00' 这种带空格写法，
    另外两个后端产出的是 isoformat()——不归一化的话，画廊排序/相对时间
    会因后端而异。"""
    row = store._neon_normalize_row({
        "id": "a1",
        "created_at": "2026-07-26 12:34:56+00",
        "model_json": {"appbundle": {}},
        "gate_passed": True,
        "version": 2,
    })
    assert row["created_at"] == "2026-07-26T12:34:56+00:00"
    # 已是原生类型的字段不该被动
    assert row["gate_passed"] is True and row["version"] == 2
    assert isinstance(row["model_json"], dict)


def test_neon_row_normalization_tolerates_bad_shapes():
    """坏时间戳原样留着（不编造时间）；model_json 缺失/非 dict 归一成 {}。"""
    assert store._neon_normalize_row({"created_at": "garbage"})["created_at"] == "garbage"
    assert store._neon_normalize_row({"model_json": None})["model_json"] == {}
    assert store._neon_normalize_row({})["model_json"] == {}


# ── HTTP 错误的结构化解析（2026-07-27）──────────────────────────────
# 此前只截响应体前 200 字符：唯一键冲突这种只想知道 code/constraint 的场景，
# 截断还可能正好切掉关键部分。现在按官方 JS 驱动（@neondatabase/serverless
# httpQuery.ts 的 errorFields）同款把字段提出来，另加官方没读但端点确实返回
# 的 neon:retryable。下面的响应形状取自对真库触发真实错误的实测记录。


class _FakeResp:
    def __init__(self, status: int, payload=None, text: str = ""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def test_neon_error_extracts_structured_fields():
    """唯一键冲突：code/constraint/detail 必须能直接取到，并出现在摘要里。"""
    err = store._neon_http_error(_FakeResp(400, {
        "message": 'duplicate key value violates unique constraint "generated_app_pkey"',
        "code": "23505",
        "constraint": "generated_app_pkey",
        "detail": "Key (id)=(abc) already exists.",
        "severity": "ERROR",
        "neon:retryable": False,
    }))
    assert isinstance(err, store.NeonHttpError)
    assert err.code == "23505"
    assert err.retryable is False
    assert err.fields["constraint"] == "generated_app_pkey"
    text = str(err)
    assert "code=23505" in text and "constraint=generated_app_pkey" in text


def test_http_gateway_error_does_not_say_neon():
    """过夜清单把 /db-api 413 写成了 Neon。前缀必须能区分两条通道。"""
    err = store._http_gateway_error(_FakeResp(413, {"detail": "request body too large"}))
    assert "db-api http 413" in str(err)
    assert "neon http" not in str(err)


def test_neon_error_falls_back_to_text_for_non_json():
    """网关 5xx 常返回 HTML——解析不了就回落文本截断，绝不因此再抛一个异常。"""
    err = store._neon_http_error(_FakeResp(502, None, "<html>Bad Gateway</html>"))
    assert isinstance(err, store.NeonHttpError)
    assert err.status == 502
    assert "Bad Gateway" in str(err)
    assert err.code is None and err.retryable is None


def test_neon_error_fields_cover_official_driver_list():
    """字段清单与官方 errorFields 对齐（16 项）+ neon:retryable。
    官方少了 retryable 这项，但端点真的会返回，实测确认。"""
    official = {
        "severity", "code", "detail", "hint", "position", "internalPosition",
        "internalQuery", "where", "schema", "table", "column", "dataType",
        "constraint", "file", "line", "routine",
    }
    assert official <= set(store._NEON_ERROR_FIELDS)
    assert "neon:retryable" in store._NEON_ERROR_FIELDS


# ────────────────────── Neon 事故（2026-08-02）的三层守卫 ──────────────────────
#
# 事故形状：切回 Neon 后 Python 单 worker 被堵死，/api/health 一起超时。
# 三个原因叠加，各配一条守卫：
#   ① fail-open 只兜异常、不兜"卡住"        → 服务端超时 + 墙钟预算
#   ② 初始化每一步各开一条连接              → 合并成一次握手
#   ③ async 路由里同步调库，单 worker       → to_thread（在路由那侧断言）


def test_postgres_config_sets_server_side_timeouts():
    """**没有语句级超时 = 那套四级 fail-open 是摆设。**

    降级全靠 except 触发，而一条永远不返回的查询什么都不抛。connect_timeout
    只管握手，连上之后想跑多久跑多久——线上就是这么被堵死的。
    """
    connect_args, _ = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x-pooler.neon.tech/db?sslmode=require", _FakeNullPool
    )
    opts = connect_args.get("options") or ""
    assert f"statement_timeout={store._PG_STATEMENT_TIMEOUT_MS}" in opts
    # 等锁超时是给 DDL 的：ALTER TABLE 要 ACCESS EXCLUSIVE，撞上任何一个正在读
    # 这张表的连接就会无限等，那正是把单 worker 堵死的形状。
    assert f"lock_timeout={store._PG_LOCK_TIMEOUT_MS}" in opts
    assert f"idle_in_transaction_session_timeout={store._PG_IDLE_TX_TIMEOUT_MS}" in opts


def test_connection_string_options_are_never_clobbered():
    """连接串自带 options 时不许覆盖——Neon 用 `options=endpoint%3D...` 做端点
    路由，盖掉就连错库了。宁可这一条没有服务端超时（还有墙钟预算兜底），也不能
    改坏路由。"""
    connect_args, _ = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x.neon.tech/db?options=endpoint%3Dep-x", _FakeNullPool
    )
    assert "options" not in connect_args


def test_sqlite_gets_no_postgres_timeouts():
    """SQLite 不认 postgres 的 options，塞进去会连不上。"""
    connect_args, _ = store._sql_engine_config("sqlite:///x.db", _FakeNullPool)
    assert "options" not in connect_args


def test_slow_remote_init_degrades_instead_of_hanging(tmp_path, monkeypatch):
    """**初始化卡住时必须降级，不能吊死。**

    这是事故的核心：存储层承诺"绝不拖垮主链路"，但那个承诺只覆盖了"失败"，
    没覆盖"不返回"。这条用例模拟一个永远不返回的初始化，断言 get_backend 在
    预算内放弃并落到本地 SQLite——而不是一直等下去。
    """
    started = __import__("threading").Event()
    real_factory = store._sqlalchemy_backend

    # **只拦远端那一个 URL**：_local_sqlite_backend 走的是同一个工厂函数，
    # 一刀切地替换会让降级目标也卡住——本地兜底那一步没有预算保护，于是整条
    # 用例挂死。第一版就是这么写的，被自己挂住了。
    def blocks_only_the_remote(url):
        if "invalid.internal" in url:
            started.set()
            __import__("threading").Event().wait()  # 永远不返回
        return real_factory(url)

    monkeypatch.setattr(store, "_sqlalchemy_backend", blocks_only_the_remote)
    monkeypatch.setattr(store, "_SQL_INIT_BUDGET_S", 0.5)
    # 刻意用**非 Neon** 主机：*.neon.tech 会让降级链先去试 SQL-over-HTTP，
    # 那是一次真实网络请求，会把这条用例的耗时变成网络超时而不是预算。
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@db.invalid.internal:5432/x?sslmode=require",
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()

    import time as _t

    t0 = _t.time()
    backend = store.get_backend()
    elapsed = _t.time() - t0

    assert started.is_set(), "初始化根本没被调用，这条用例是空过的"
    assert elapsed < 5, f"没有在预算内放弃，等了 {elapsed:.1f}s"
    assert type(backend).__name__ == "SqlAppStore", "应当降级到本地 SQLite"
    store.reset_backend_cache()


def test_remote_init_opens_one_connection_not_three(monkeypatch):
    """建表 + 查列 + 补列**共用一条连接**。

    NullPool 下每次 engine 级操作都是新建连接。平时无所谓，但线上撞到的正是
    "每次连接都慢"（Neon pooler 多地址 × connect_timeout=4s），连接次数在这条
    路径上是直接乘上去的成本。这条按源码钉住，因为真连库测不了。
    """
    import inspect as _inspect

    src = _inspect.getsource(store._sqlalchemy_backend)
    body = src[src.index("engine = create_engine"):src.index("class SqlAppStore")]
    # 只允许出现一次 engine 级的连接获取
    assert body.count("engine.begin()") == 1, "初始化里不止一次 engine.begin()"
    assert "create_all(_init_conn)" in body, "create_all 没有复用那条连接"
    assert "_sql_inspect(_init_conn)" in body, "查列没有复用那条连接"
    assert "_sql_inspect(engine)" not in body, "查列又开了一条新连接"


def test_hung_init_thread_never_blocks_process_exit():
    """**卡住的初始化线程必须是 daemon。**

    第一版用 ThreadPoolExecutor + future.result(timeout=…)，被这条抓了：它的
    工作线程是非守护线程，而 concurrent.futures 注册了 atexit 钩子去 join 它们
    ——卡住的线程会挡住**进程退出**。那等于把"启动卡死"换成"关停卡死"，容器停
    不下来，部署时更难受。

    这条不是风格检查：非 daemon 会让整个测试进程在收集完后挂死（实测撞到过）。
    """
    import threading

    started = threading.Event()
    release = threading.Event()

    def blocks(_url):
        started.set()
        release.wait(timeout=30)
        raise RuntimeError("late")

    orig = store._sqlalchemy_backend
    orig_budget = store._SQL_INIT_BUDGET_S
    store._sqlalchemy_backend = blocks
    store._SQL_INIT_BUDGET_S = 0.3
    try:
        try:
            store._sqlalchemy_backend_within_budget("postgresql://u:p@h/db")
        except TimeoutError:
            pass
        else:
            raise AssertionError("超预算时应当抛 TimeoutError")
        assert started.is_set(), "初始化没被调用，用例空过"
        stuck = [t for t in threading.enumerate() if t.name == "appstore-init"]
        assert stuck, "没找到那个卡住的线程，用例空过"
        assert all(t.daemon for t in stuck), "初始化线程不是 daemon，会挡住进程退出"
    finally:
        release.set()
        store._sqlalchemy_backend = orig
        store._SQL_INIT_BUDGET_S = orig_budget


# ────────────────────── 显式指定 Neon HTTP 通道 ──────────────────────
#
# 事故后加的口子：TCP "能连上、只是慢得要死"时，兜底逻辑永远轮不到 HTTP
# （它只在 TCP 抛异常时才触发）。这一组盯这个开关的边界。


def test_http_channel_is_opt_in(monkeypatch):
    """默认不开——行为必须与加这个开关之前逐字节一致。"""
    monkeypatch.delenv(store._PREFER_HTTP_ENV, raising=False)
    assert store.prefer_neon_http() is False
    for truthy in ("1", "true", "YES", "on"):
        monkeypatch.setenv(store._PREFER_HTTP_ENV, truthy)
        assert store.prefer_neon_http() is True, truthy
    for falsy in ("0", "false", "no", ""):
        monkeypatch.setenv(store._PREFER_HTTP_ENV, falsy)
        assert store.prefer_neon_http() is False, falsy


def test_http_preference_skips_the_tcp_path_entirely(monkeypatch, tmp_path):
    """开了就**根本不碰 TCP**。

    这是这个开关存在的全部意义：TCP 那一段（探针 + pooler 多地址逐个试 ×
    connect_timeout 4s + 建表补列）正是把线上堵死的地方，指定 HTTP 就不该再
    走进去一步。
    """
    tcp_calls = []
    monkeypatch.setattr(
        store, "_sqlalchemy_backend",
        lambda url: tcp_calls.append(url) or (_ for _ in ()).throw(AssertionError("不该走 TCP")),
    )
    made = []

    class FakeHttp:
        def __init__(self, url, endpoint):
            made.append(endpoint)

    monkeypatch.setattr(store, "NeonHttpAppStore", FakeHttp)
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    )
    store.reset_backend_cache()
    try:
        backend = store.get_backend()
        assert isinstance(backend, FakeHttp), type(backend).__name__
        assert made, "没有真的去建 HTTP 后端，用例空过"
        assert tcp_calls == [], "开了 HTTP 偏好却仍然走了 TCP"
    finally:
        store.reset_backend_cache()


def test_http_preference_still_degrades_when_http_is_down(monkeypatch, tmp_path):
    """指定了 HTTP 也可能连不上——那时候要继续往下降级，不能把人卡在这一级。"""
    class Broken:
        def __init__(self, url, endpoint):
            raise RuntimeError("http down")

    monkeypatch.setattr(store, "NeonHttpAppStore", Broken)
    monkeypatch.setattr(store, "_sqlalchemy_backend", lambda url: (_ for _ in ()).throw(OSError("tcp down")))
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path/'l.db'}")
    store.reset_backend_cache()
    try:
        assert type(store.get_backend()).__name__ in ("SqlAppStore", "JsonFileAppStore")
    finally:
        store.reset_backend_cache()


def test_http_preference_ignored_for_non_neon_hosts(monkeypatch, tmp_path):
    """自建 PG / RDS 没有这个 HTTP 端点，盲目拼一个只会得到困惑的连接错误。
    这种情况忽略偏好、照常走 TCP。"""
    tcp = []
    monkeypatch.setattr(
        store, "_sqlalchemy_backend",
        lambda url: tcp.append(url) or (_ for _ in ()).throw(OSError("tcp down")),
    )
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL", "postgresql://u:p@pg.internal:5432/x"
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path/'l.db'}")
    store.reset_backend_cache()
    try:
        store.get_backend()
        assert tcp, "非 Neon 主机应当照常走 TCP"
    finally:
        store.reset_backend_cache()


# ── spec-first 整页 HTML（pages_json，2026-08-14）────────────────────────
#
# 应用中心的卡和只读预览靠这份 HTML 渲染真页面。这里钉四条语义：
# 落库回读、摘要不带本体只带 has_pages 一位、幂等更新"没传保留"、
# 新版本"不继承"（模型变了，旧 HTML 是照旧模型打的孔）。


def _pages(n: int = 2) -> dict:
    return {
        "version": "spec-first-pipeline-v1",
        "pages": {f"p{i}": f"<!DOCTYPE html><html><body>页 {i}</body></html>" for i in range(n)},
        "navItems": [{"pageId": f"p{i}", "label": f"页{i}"} for i in range(n)],
        "boundPages": n,
        "failedPages": {},
    }


def test_pages_json_roundtrip_and_summary_flag(configured_store):
    with_pages = store.save_app(_model("咖营通"), session_id="s1", pages_json=_pages())
    without = store.save_app(_model("宠医云"), session_id="s2")
    rec = store.get_app(with_pages)
    assert rec["pages_json"]["pages"]["p0"].startswith("<!DOCTYPE html>"), "完整记录回读到整页 HTML"
    assert rec["pages_json"]["boundPages"] == 2
    assert store.get_app(without)["pages_json"] is None, "没有页面就是 None，不造空 dict"
    summaries = {s["product_name"]: s for s in store.list_apps()}
    assert all("pages_json" not in s for s in summaries.values()), "摘要不带页面本体（大载荷）"
    assert summaries["咖营通"]["has_pages"] is True
    assert summaries["宠医云"]["has_pages"] is False


def test_latest_app_for_session_is_summary_not_payload(configured_store):
    """推演收口前端靠这条拿到 app_id。完整记录太大，摘要里不许带页面/模型。"""
    app_id = store.save_app(_model("咖营通"), session_id="sess-shot", pages_json=_pages())
    row = store.get_latest_app_for_session("sess-shot")
    assert row is not None and row["id"] == app_id
    assert "model_json" not in row and "pages_json" not in row
    assert row["has_pages"] is True
    assert store.get_latest_app_for_session("missing") is None
    assert store.get_latest_app_for_session("") is None


def test_pages_json_empty_pages_normalized_to_none(configured_store):
    """{"pages": {}} 这种"有壳没页"的载荷落成 None——前端拿到空壳会当成
    "有页面但空"，判定分支走错。判空在落库口做一次，三个后端同一行为。"""
    app_id = store.save_app(_model("咖营通"), pages_json={"pages": {}, "navItems": []})
    assert store.get_app(app_id)["pages_json"] is None


def test_pages_json_kept_on_dedup_resave_without_pages(configured_store):
    """幂等重存（同会话同模型，如重开夹具）不带页面是常态——纪律与
    preview_png_b64 同款：没传就保留既有那份，不把卡打回区块渲染。"""
    model = _model("咖营通")
    first = store.save_app_or_version(model, session_id="s1", pages_json=_pages())
    again = store.save_app_or_version(model, session_id="s1")  # 同模型 → dedup 幂等更新
    assert again == first
    assert store.get_app(first)["pages_json"]["pages"], "重存没传页面，既有那份还在"


def test_pages_json_not_inherited_by_new_version(configured_store):
    """模型变了才会开新版本，上一版的 HTML 是照旧模型打的孔——挂过去就是
    「东西看着在，其实是旧的」。新版本自己没画页面就落 None。"""
    first = store.save_app_or_version(_model("咖营通"), session_id="s1", pages_json=_pages())
    second = store.save_app_or_version(_model("咖营通", entities=3), session_id="s1")
    assert second != first
    rec = store.get_app(second)
    assert rec["version"] == 2 and rec["pages_json"] is None
    # 这一版自己画了页面就用自己的
    third = store.save_app_or_version(_model("咖营通", entities=4), session_id="s1", pages_json=_pages(3))
    assert store.get_app(third)["pages_json"]["boundPages"] == 3


def test_pages_json_copied_on_fork(configured_store):
    """fork 的设计层逐字拷贝、模型没变，孔照样对得上——页面跟着走。"""
    src = store.save_app(_model("咖营通"), session_id="s1", pages_json=_pages())
    fk = store.fork_app(src, session_id="s9")
    assert store.get_app(fk)["pages_json"]["pages"] == _pages()["pages"]


def test_list_limit_offset_returns_adjacent_pages(configured_store):
    store.save_app(_model("甲"), session_id="s1")
    store.save_app(_model("乙"), session_id="s2")
    store.save_app(_model("丙"), session_id="s3")
    page0 = store.list_apps(limit=1, offset=0)
    page1 = store.list_apps(limit=1, offset=1)
    assert len(page0) == 1 and len(page1) == 1
    assert page0[0]["id"] != page1[0]["id"]
    assert {page0[0]["product_name"], page1[0]["product_name"]} <= {"甲", "乙", "丙"}


def test_list_apps_sql_omits_payloads_and_paginates():
    """判据盯 SQL 文本本身：把 model_json 加回选出列、或改回 select *、
    或拿掉 LIMIT，这条必须红。注释里会写旧语句，所以只看函数返回值。"""
    sql = store.list_apps_sql(latest_per_root=True).lower()
    assert "select *" not in sql
    assert "model_json" not in sql
    leftover = sql.replace("pages_json is not null", "")
    assert "pages_json" not in leftover, "pages_json 只允许出现在 IS NOT NULL，不能当选出列"
    assert "limit $1" in sql and "offset $2" in sql
    assert "row_number()" in sql
    assert "order by created_at desc, id desc" in sql
    assert "order by version desc, created_at desc, id desc" in sql
    assert "owner_id = $3" not in sql
    all_versions = store.list_apps_sql(latest_per_root=False).lower()
    assert "row_number()" not in all_versions
    assert "limit $1" in all_versions and "model_json" not in all_versions
    assert "id desc" in all_versions
    mine = store.list_apps_sql(latest_per_root=True, shelf="mine").lower()
    assert "owner_id = $3" in mine
    market = store.list_apps_sql(latest_per_root=True, shelf="market").lower()
    assert "is_official" in market and "public" in market
    official = store.list_apps_sql(latest_per_root=True, shelf="official").lower()
    assert "is_official" in official and "<> 0" in official


def test_paginate_latest_same_timestamp_does_not_skip_or_dup():
    """created_at 全相同的 36 行，按 12 翻三页：每页 12、并集 36、页间无交集。

    输入顺序反过来，第一页必须还是同一批 id——没有 id 决胜的话 stable sort
    会跟着输入走，OFFSET 窗口就对不上（真机 12→24→35→48 的根）。
    """
    stamp = "2026-08-20T00:00:00"

    def rows(order: list[int]) -> list[dict]:
        return [
            {"id": f"a{i:02d}", "root_id": f"a{i:02d}", "version": 1, "created_at": stamp}
            for i in order
        ]

    forward = rows(list(range(36)))
    backward = rows(list(reversed(range(36))))
    first_fwd = [r["id"] for r in store._paginate_latest(
        forward, limit=12, offset=0, latest_per_root=True
    )]
    first_bwd = [r["id"] for r in store._paginate_latest(
        backward, limit=12, offset=0, latest_per_root=True
    )]
    assert first_fwd == first_bwd

    pages = [
        [r["id"] for r in store._paginate_latest(
            forward, limit=12, offset=off, latest_per_root=True
        )]
        for off in (0, 12, 24)
    ]
    assert [len(p) for p in pages] == [12, 12, 12]
    flat = [i for p in pages for i in p]
    assert len(flat) == 36
    assert len(set(flat)) == 36
    assert set(pages[0]).isdisjoint(pages[1])
    assert set(pages[1]).isdisjoint(pages[2])


def test_http_list_sends_summary_sql_with_limit():
    """真机 list 走 NeonHttpAppStore（HttpApiAppStore 继承它）。
    直接 new 会打网关；用未初始化实例钉住发出去的 SQL 和参数。"""
    captured: list[tuple[str, list]] = []

    inst = object.__new__(store.NeonHttpAppStore)

    def _q(sql, params=None):
        captured.append((sql, list(params or [])))
        return [{
            "id": "a1", "root_id": "a1", "parent_id": None, "version": 2,
            "session_id": "s1", "goal": "g", "product_name": "咖营通",
            "theme_id": "forest", "theme_label": "forest·测试", "device": "desktop",
            "landing_page_ref": "p0", "entity_count": 2, "page_count": 2,
            "gate_passed": True, "dedup_key": None,
            "created_at": "2026-08-18 00:00:00+00",
            "owner_id": None, "visibility": "public",
            "has_pages": True,
        }]

    inst._q = _q  # type: ignore[method-assign]
    rows = store.NeonHttpAppStore.list(inst, limit=12, offset=0, latest_per_root=True)
    assert captured, "list() 必须打 _q，否则装在不通电的插座上"
    sql, params = captured[0]
    assert sql == store.list_apps_sql(latest_per_root=True)
    assert params == [12, 0]
    assert rows[0]["has_pages"] is True
    assert rows[0]["product_name"] == "咖营通"
    assert "model_json" not in rows[0] and "pages_json" not in rows[0]


def _unparse_method(source: str, class_name: str, method_name: str) -> str:
    import ast

    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name != class_name:
            continue
        for item in node.body:
            if not isinstance(item, ast.FunctionDef) or item.name != method_name:
                continue
            if (
                item.body
                and isinstance(item.body[0], ast.Expr)
                and isinstance(item.body[0].value, ast.Constant)
                and isinstance(item.body[0].value.value, str)
            ):
                item.body.pop(0)
            return ast.unparse(item)
    raise AssertionError(f"{class_name}.{method_name} 不在源码里")


def test_list_methods_do_not_select_star_or_hydrate_blobs():
    """正：三条 list 都走摘要/SQL 分页。反：把 select * 或 to_record 装回去必须红。

    ⚠ 先剥方法文档串再匹配——NeonHttpAppStore.list 的事故注释里原样引用了
    `select * from generated_app`，不剥就会假绿。
    """
    from pathlib import Path

    src = Path(store.__file__).read_text(encoding="utf-8")
    neon = _unparse_method(src, "NeonHttpAppStore", "list")
    sql_backend = _unparse_method(src, "SqlAppStore", "list")
    json_backend = _unparse_method(src, "JsonFileAppStore", "list")
    assert "list_apps_sql" in neon
    assert "select * from generated_app" not in neon
    assert "to_record" not in sql_backend
    assert "select(GeneratedApp)" not in sql_backend
    assert "_summary" in json_backend
    assert "_paginate_latest" in json_backend
    # 自检：剥注释真的把事故原文去掉了。不剥的话上面那条会被文档串喂饱。
    assert "select * from generated_app" in src, "事故原文应从注释里能找到，否则剥注释自检没锚"


def test_gallery_route_calls_list_apps_on_the_live_path():
    """GET /apps 必须 to_thread(list_apps)。改了摘要查询但路由去调别的 = 没改。"""
    import ast
    from pathlib import Path

    path = Path(store.__file__).resolve().parent.parent / "routes" / "sliderule_full.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    fn = next(
        (
            n for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "list_generated_apps"
        ),
        None,
    )
    assert fn is not None, "list_generated_apps 不在 sliderule_full.py——接口换地方了？"
    if (
        fn.body
        and isinstance(fn.body[0], ast.Expr)
        and isinstance(fn.body[0].value, ast.Constant)
        and isinstance(fn.body[0].value.value, str)
    ):
        fn.body.pop(0)
    code = ast.unparse(fn)
    assert "app_store.list_apps" in code
    assert "to_thread" in code
    assert "matches_shelf" in code
    assert "normalize_shelf" in code
    assert "shelf=" in code
    assert "owner_id=" in code


def test_patch_app_transfers_ownership_on_the_live_path():
    """PATCH 官方必须走 transfer_to_official。只改 is_official 旗、owner 不动 = 没改。"""
    import ast
    from pathlib import Path

    tree = ast.parse(Path(store.__file__).read_text(encoding="utf-8"))
    fn = next(
        (
            n for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "patch_app"
        ),
        None,
    )
    assert fn is not None
    if (
        fn.body
        and isinstance(fn.body[0], ast.Expr)
        and isinstance(fn.body[0].value, ast.Constant)
        and isinstance(fn.body[0].value.value, str)
    ):
        fn.body.pop(0)
    code = ast.unparse(fn)
    assert "transfer_to_official" in code
    assert "transfer_from_official" in code


# ── 卡片徽标不该逼前端拉整包（2026-08-22）────────────────────────────────
#
# 真机量的：应用中心首屏 53 个请求、约 5 MB，其中
#     ×30  1931 KB  /api/sliderule/apps/{id}      每张卡拉完整 model_json + pages_json
# 而卡片上只用到「实体 N · 页面 N · 角色 N · AI N」四个数字。前两个摘要里
# 早就有了（entity_count / page_count），后两个没有，于是整包被拉了下来。
#
# ⚠ 存量记录这两列是**空的**（用户决定不跑生产回填）。所以口径是
#   `None` = 数不出来，**前端不显示那个徽标**——而不是显示「角色 0」。
#   显示 0 是说了一句错话，不显示只是少说一句。本仓 demo-seed-semantics
#   立的规矩：宁可少认，不可认错。


def _model_with_rbac_aigc(roles: int = 3, caps: int = 2) -> dict:
    m = _model("带权限的应用")
    m["rbac"] = {"roles": [{"id": f"r{i}", "name": f"角色{i}"} for i in range(roles)]}
    m["aigc"] = {"capabilities": [{"id": f"c{i}"} for i in range(caps)]}
    return m


class Test摘要带角色数与AI数:
    def test_从模型数出来(self):
        meta = store.derive_app_metadata(_model_with_rbac_aigc(roles=3, caps=2))
        assert meta["role_count"] == 3
        assert meta["ai_count"] == 2

    def test_反向_模型里没有这两段时是_None_不是_0(self):
        """★ 这条是整组的核心。

        返回 0 等于断言「这个应用没有角色」，而真相是「这份模型里没这一段，
        数不出来」。两者在卡片上长得一样，但一个是事实、一个是编的。
        """
        meta = store.derive_app_metadata(_model("光板应用"))
        assert meta["role_count"] is None
        assert meta["ai_count"] is None

    def test_反向_坏形状不许崩也不许编(self):
        for bad in ({"rbac": "nope"}, {"rbac": {"roles": 42}}, {"aigc": {"capabilities": None}}):
            m = {**_model("坏形状"), **bad}
            meta = store.derive_app_metadata(m)
            assert meta["role_count"] in (None, 0)
            assert meta["ai_count"] in (None, 0)

    def test_空数组是_0_不是_None(self):
        """有这一段但里面是空的 —— 那是「确实一个角色都没有」，跟数不出来不同。"""
        m = _model("空权限")
        m["rbac"] = {"roles": []}
        m["aigc"] = {"capabilities": []}
        meta = store.derive_app_metadata(m)
        assert meta["role_count"] == 0
        assert meta["ai_count"] == 0

    def test_列表摘要里带着这两个数_不带整包(self, configured_store):
        """★ 接线：数出来了没接进列表接口，等于没做。"""
        store.save_app(_model_with_rbac_aigc(roles=4, caps=1), session_id="s-badge")
        rows = store.list_apps(limit=10)
        row = next(r for r in rows if r.get("session_id") == "s-badge")
        assert row["role_count"] == 4
        assert row["ai_count"] == 1
        # 反向：列表仍然不许把大字段带出来（_LIST_COLUMNS 的存在理由）
        assert "model_json" not in row
        assert "pages_json" not in row

    def test_存量记录读出来是_None_不是_0(self, configured_store):
        """老记录没有这两列。读出来必须是 None —— 让前端知道「不知道」。"""
        store.save_app(_model("老应用"), session_id="s-legacy")
        rows = store.list_apps(limit=10)
        row = next(r for r in rows if r.get("session_id") == "s-legacy")
        assert row.get("role_count") is None
        assert row.get("ai_count") is None


# ─────────────────────────────────────────────────────────────────────────
# 两套补列逻辑必须成对（2026-08-22 线上事故）
# ─────────────────────────────────────────────────────────────────────────


def _app_store_source_without_comments() -> str:
    """读 app_store.py 源码，先剥掉 `#` 注释再给判据用。

    CLAUDE.md 第二条踩过的坑：判据 grep 标识符，而那个词同时出现在注释里 →
    把修复改回去照样绿。这里只剥注释、保留字符串字面量——要找的 SQL 就住在
    字符串里。
    """
    import io
    import tokenize

    path = os.path.join(os.path.dirname(store.__file__), "app_store.py")
    with io.open(path, "rb") as fh:
        toks = [t for t in tokenize.tokenize(fh.readline) if t.type != tokenize.COMMENT]
    return tokenize.untokenize(toks).decode("utf-8")


def _migration_columns(source: str) -> tuple[set[str], set[str]]:
    """从源码里取出两套 generated_app 的补列清单。

    返回 (SQLAlchemy 那套, Neon/HTTP 那套)。两套写法天生不同——SQLAlchemy 走
    `inspect` 再 `add column`（SQLite 不支持 `if not exists`，见 _init 的注释），
    Neon 走 `add column if not exists`——所以只能分开匹配。
    """
    import re

    neon = set(
        re.findall(
            r"alter\s+table\s+generated_app\s+add\s+column\s+if\s+not\s+exists\s+(\w+)",
            source,
            re.I,
        )
    )
    sqla = set(
        re.findall(
            r"alter\s+table\s+generated_app\s+add\s+column\s+(?!if\s+not\s+exists)(\w+)",
            source,
            re.I,
        )
    )
    return sqla, neon


class Test两套补列逻辑必须成对:
    """★ 2026-08-22 线上事故的判据化。

    那天给列表摘要加 role_count / ai_count，四处都改对了——_LIST_COLUMNS、
    ORM 列、Neon 的 `create table if not exists` 列定义、SQLAlchemy 的补列
    清单——**唯独漏了 Neon 的补列清单**。生产的 generated_app 早就存在，那句
    建表对它什么都不做，列根本没长出来；而列表查询已经在 select 它们 →
    UndefinedColumn → /db-api 回 500。

    表面症状有三个（应用市场空、"我的应用"筛选项没了、设备类型没了），其实
    是同一处：列表接口一挂，前端 fail-open 成空数组，所有从列表里推导出来的
    选项一起消失。

    这是 CLAUDE.md 第四条「只改一半必然静默失效」的第四种成对形态：
    **SQLAlchemy 补列 / Neon 补列**。
    """

    def test_两边补的列完全一样(self):
        sqla, neon = _migration_columns(_app_store_source_without_comments())
        assert sqla, "SQLAlchemy 那套补列清单一条都没匹配到——判据本身坏了"
        assert neon, "Neon 那套补列清单一条都没匹配到——判据本身坏了"
        assert sqla == neon, (
            "generated_app 的两套补列逻辑不一致，只改一半会在生产上静默缺列：\n"
            f"  只有 SQLAlchemy 补：{sorted(sqla - neon)}\n"
            f"  只有 Neon 补      ：{sorted(neon - sqla)}"
        )

    def test_事故当事的那两列两边都在(self):
        """★ 变异判据：把 Neon 那两句 add column 删掉，这条必须变红。"""
        sqla, neon = _migration_columns(_app_store_source_without_comments())
        for col in ("role_count", "ai_count"):
            assert col in sqla, f"{col} 不在 SQLAlchemy 补列清单里"
            assert col in neon, f"{col} 不在 Neon 补列清单里 —— 正是 08-22 那次的形状"

    def test_列表要select的列_要么建表时就有_要么有人补(self):
        """反向：_LIST_COLUMNS 里出现一个没人负责创建的列，是另一种 500。

        注意建表 DDL 本身并不全 —— owner_id / visibility / is_official /
        prior_owner_id 从来只靠补列语句长出来（新库建完表随即被补上）。所以
        判据是"两条路至少走通一条"，不是"建表 DDL 里都得有"。
        """
        import re

        source = _app_store_source_without_comments()
        _, neon = _migration_columns(source)
        m = re.search(
            r"create\s+table\s+if\s+not\s+exists\s+generated_app\s*\((.*?)\n\s*\)",
            source,
            re.S | re.I,
        )
        assert m, "没找到 generated_app 的建表 DDL——判据本身坏了"
        ddl_cols = {
            line.strip().split()[0]
            for line in m.group(1).splitlines()
            if line.strip() and not line.strip().startswith(("primary", "unique", "constraint"))
        }
        assert "role_count" in ddl_cols, "建表 DDL 的解析结果不对——判据本身坏了"
        missing = [c for c in store._LIST_COLUMNS if c not in ddl_cols and c not in neon]
        assert not missing, (
            f"列表在 select 这些列，但既不在建表 DDL 里、也没有补列语句：{missing}"
        )
