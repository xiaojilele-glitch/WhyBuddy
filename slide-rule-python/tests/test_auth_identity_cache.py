"""鉴权路径上 get_by_id 的 5 秒 TTL 缓存（2026-08-24，用户定的 5 秒）。

## 为什么有它

真机（HTTPS SQL 网关）：不鉴权的 /health 4ms，只鉴权什么都不干的 /account/me
340ms。两次查库并发之后仍剩 get_by_id 的 180ms，而**每个登录请求**都付。

## 判据的重点是"代价被限住"，不是"变快了"

缓存的是 ② 账号还在、还活着 和 ③ 密码戳要用的 password_hash——也就是拿
"改密码/停用最长 5 秒才生效"换来的速度。2026-08-04 加 ③ 的全部理由就是
"改了密码，旧令牌全灭"，所以这个窗口必须被三条设计夹住，下面逐条钉：

  ① 登出**立刻**生效（走 jti 撤销，不进缓存）
  ② 同进程里任何一次写都全表失效（改密码/停用当场生效，5 秒只是多实例上界）
  ③ 只在鉴权路径用；管理台/账号接口照旧实查

变异：把 TTL 调大、把撤销也缓存、去掉写失效、让 get_by_id 也走缓存，
分别会咬到下面不同的用例。
"""

from __future__ import annotations

import time

import pytest

import services.identity_store as ident


@pytest.fixture(autouse=True)
def _clean_cache():
    ident.invalidate_auth_cache()
    yield
    ident.invalidate_auth_cache()


@pytest.fixture
def store(tmp_path):
    """本地 sqlite 身份库 —— **真的 IdentityStore**，不是假的。

    直接拿 _SqlExecutor 建，绕开 get_identity_store 那套"用哪个库"的降级逻辑：
    这份判据测的是缓存行为，跟选后端无关，走 settings 只会把测试绑在配置形状上。
    """
    x = ident._SqlExecutor(f"sqlite:///{tmp_path/'id.db'}")
    return ident.IdentityStore(x, is_sqlite=True)


def _count_queries(store, monkeypatch) -> dict:
    """数一数真正落到库上的 select 次数。"""
    seen = {"n": 0}
    real = store._x.query

    def counting(sql, params=None):
        if "select" in sql.lower():
            seen["n"] += 1
        return real(sql, params)

    monkeypatch.setattr(store._x, "query", counting)
    return seen


def _mk(store, email="a@b.c"):
    return store.create(email, "hash-v1", display_name="A")


def test_窗口内只查一次库(store, monkeypatch):
    user = _mk(store)
    ident.invalidate_auth_cache()
    seen = _count_queries(store, monkeypatch)

    for _ in range(5):
        got = store.get_by_id_for_auth(user.id)
        assert got is not None and got.id == user.id
    assert seen["n"] == 1, f"5 次鉴权查了 {seen['n']} 次库，缓存没生效"


def test_过了TTL要重新查(store, monkeypatch):
    """TTL 到期必须回库 —— 否则"最长 5 秒"这个上界就是假的。"""
    user = _mk(store)
    monkeypatch.setattr(ident, "AUTH_CACHE_TTL_S", 0.15)
    ident.invalidate_auth_cache()
    seen = _count_queries(store, monkeypatch)

    store.get_by_id_for_auth(user.id)
    store.get_by_id_for_auth(user.id)
    assert seen["n"] == 1
    time.sleep(0.2)
    store.get_by_id_for_auth(user.id)
    assert seen["n"] == 2, "TTL 过了还在吃缓存"


def test_改密码当场失效_不等5秒(store):
    """② 写失效。同进程里改完密码，下一次鉴权读到的必须是新哈希。

    这条是整个取舍成立的关键：5 秒只是多进程/多实例下的上界，单实例是立刻。
    """
    user = _mk(store)
    assert store.get_by_id_for_auth(user.id)["password_hash"] == "hash-v1"

    store.set_password_hash(user.id, "hash-v2")
    assert store.get_by_id_for_auth(user.id)["password_hash"] == "hash-v2", (
        "改了密码还在读缓存 —— 2026-08-04 修的正是这个形状"
    )


def test_停用账号当场失效(store):
    """同上，换成 is_active。"""
    user = _mk(store)
    assert store.get_by_id_for_auth(user.id).is_active is True

    store.set_active(user.id, False)
    assert store.get_by_id_for_auth(user.id).is_active is False


def test_改昵称也失效_写失效挂在执行器上而不是四个写方法里(store):
    """update_profile 没有任何"记得清缓存"的代码，照样得失效。

    ⚠ 这条钉的是**位置**：失效挂在 executor.execute 上，所有写必然经过它。
      挂在写方法里就得指望每个新写方法的作者记得加一行（本仓第四条）。
      哪天有人把它挪回写方法，这条会红。
    """
    user = _mk(store)
    store.get_by_id_for_auth(user.id)
    store.update_profile(user.id, display_name="改过了")
    assert store.get_by_id_for_auth(user.id)["display_name"] == "改过了"


def test_查库失败不进缓存(store, monkeypatch):
    """异常照常抛出，且不许把失败缓存 5 秒。

    缓存住失败 = 一次网络抖动让人掉线 5 秒，比慢 180ms 糟得多。
    """
    user = _mk(store)
    real = store._x.query

    def boom(sql, params=None):
        raise RuntimeError("库抖了")

    monkeypatch.setattr(store._x, "query", boom)
    with pytest.raises(RuntimeError):
        store.get_by_id_for_auth(user.id)

    monkeypatch.setattr(store._x, "query", real)
    assert store.get_by_id_for_auth(user.id) is not None, "上一次的失败被缓存了"


def test_缓存回的是拷贝_调用方改不脏缓存(store):
    """很多请求同时拿到同一条，谁顺手改一下就串到别人身上。

    ⚠ 第一版判据写错了，去掉读侧拷贝**照样绿**（变异咬不住）：第一次调用是
      miss，返回的是刚查出来的那个对象，而**存进缓存的已经是拷贝**，改它当然
      脏不到缓存。要验读侧拷贝，必须改一个**命中缓存那次**拿到的对象。
    """
    user = _mk(store)
    store.get_by_id_for_auth(user.id)          # miss，缓存焐热
    hit = store.get_by_id_for_auth(user.id)    # 这次才是从缓存里拿的
    hit["display_name"] = "被我改了"
    again = store.get_by_id_for_auth(user.id)
    assert again["display_name"] == "A", "缓存被上一个调用方改脏了"


def test_撤销名单也缓存5秒_但登出当场生效(store, monkeypatch):
    """① 换了保法，性质没换。

    ⚠ 这条判据 2026-08-24 当天改过一次落点，记一下省得下次看不懂：
        上午加身份缓存时，撤销**不缓存**——那时"登出立刻生效"靠的是每次实查。
        下午用户让撤销也上同样的 5 秒（is_token_revoked 头注本来就写着"真成为
        瓶颈时该加的是缓存"）。于是"立刻生效"换了个靠山：**登出是一次写，会
        把两个鉴权缓存一起清掉**，同进程当场生效，5 秒只是多实例下的上界。

    所以下面正反两条一起验：缓存确实生效了（省了查询），撤销之后立刻改判。
    """
    ident.invalidate_auth_cache()
    seen = _count_queries(store, monkeypatch)
    for _ in range(3):
        assert store.is_token_revoked_for_auth("jti-abc") is False
    assert seen["n"] == 1, f"3 次鉴权查了 {seen['n']} 次库，撤销缓存没生效"

    # ★ 撤销之后必须**当场**改判，不许等 5 秒
    store.revoke_token("jti-abc", user_id="u-1")
    assert store.is_token_revoked_for_auth("jti-abc") is True, (
        "撤销了还在读缓存 —— 登出会延迟生效，这是整个取舍的底线"
    )


def test_裸的is_token_revoked永远实查(store, monkeypatch):
    """判据、管理台、清理任务读到 5 秒前的值就是 bug。

    与 get_by_id / get_by_id_for_auth 同一条分工：带缓存的那条只给鉴权。
    """
    store.is_token_revoked_for_auth("jti-x")  # 焐热
    seen = _count_queries(store, monkeypatch)
    store.is_token_revoked("jti-x")
    store.is_token_revoked("jti-x")
    assert seen["n"] == 2, "is_token_revoked 也吃上缓存了"


def test_撤销缓存过了TTL要重新查(store, monkeypatch):
    """上界得是真的：TTL 到期必须回库。"""
    monkeypatch.setattr(ident, "AUTH_CACHE_TTL_S", 0.15)
    ident.invalidate_auth_cache()
    seen = _count_queries(store, monkeypatch)
    store.is_token_revoked_for_auth("jti-y")
    store.is_token_revoked_for_auth("jti-y")
    assert seen["n"] == 1
    time.sleep(0.2)
    store.is_token_revoked_for_auth("jti-y")
    assert seen["n"] == 2, "TTL 过了还在吃缓存"


def test_撤销查库失败不进缓存(store, monkeypatch):
    """把失败缓存 5 秒 = 一次抖动让撤销检查停摆 5 秒。"""
    real = store._x.query

    def boom(sql, params=None):
        raise RuntimeError("库抖了")

    monkeypatch.setattr(store._x, "query", boom)
    with pytest.raises(RuntimeError):
        store.is_token_revoked_for_auth("jti-z")

    monkeypatch.setattr(store._x, "query", real)
    seen = _count_queries(store, monkeypatch)
    store.is_token_revoked_for_auth("jti-z")
    assert seen["n"] == 1, "上一次的失败被缓存了"


def test_只有鉴权那条走缓存_裸的get_by_id永远实查(store, monkeypatch):
    """③ 管理台、账号接口读到 5 秒前的值就是 bug（改完昵称刷新还是旧的）。"""
    user = _mk(store)
    store.get_by_id_for_auth(user.id)  # 先把缓存焐热
    seen = _count_queries(store, monkeypatch)
    store.get_by_id(user.id)
    store.get_by_id(user.id)
    assert seen["n"] == 2, "get_by_id 也吃上缓存了"


def test_TTL就是用户定的5秒():
    """标定过的数，改它要连同 AUTH_CACHE_TTL_S 那段注释一起想（本仓第六条）。"""
    assert ident.AUTH_CACHE_TTL_S == 5.0


def test_鉴权那条路真的走缓存(monkeypatch):
    """**函数写对了 ≠ 它被调用了**（本仓第三条）。

    ⚠ 这条是补的：只测 IdentityStore 的缓存行为时，把 optional_user 里的
      get_by_id_for_auth 改回裸 get_by_id，上面十条**全绿**——缓存完好无损地
      挂在了不通电的插座上。变异当场发现，记在这儿。
    """
    import middlewares.current_user as cu
    from services.auth_tokens import create_access_token
    from starlette.requests import Request
    from starlette.responses import Response

    calls = {"plain": 0, "cached": 0, "revoke_plain": 0, "revoke_cached": 0}

    class _U(dict):
        def __getattr__(self, k):
            return self[k]

    user = _U(id="u-1", is_active=True, is_superuser=False, password_hash="h")

    class _S:
        def get_by_id(self, _uid):
            calls["plain"] += 1
            return user

        def get_by_id_for_auth(self, _uid):
            calls["cached"] += 1
            return user

        def is_token_revoked(self, _jti):
            calls["revoke_plain"] += 1
            return False

        def is_token_revoked_for_auth(self, _jti):
            calls["revoke_cached"] += 1
            return False

    token = create_access_token("u-1", password_hash="h")
    monkeypatch.setattr(cu, "get_identity_store", lambda: _S())
    req = Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/x",
            "raw_path": b"/x",
            "query_string": b"",
            "headers": [(b"cookie", f"{cu.AUTH_COOKIE}={token}".encode())],
            "client": ("127.0.0.1", 9),
            "server": ("test", 80),
        }
    )
    assert cu.optional_user(req, Response(), None, token) is not None
    assert calls["cached"] == 1, "鉴权没走带缓存的那条"
    assert calls["plain"] == 0, "鉴权还在走裸 get_by_id —— 缓存等于没接上"
    assert calls["revoke_cached"] == 1, "撤销检查没走带缓存的那条"
    assert calls["revoke_plain"] == 0, "撤销检查还在走裸 is_token_revoked"
