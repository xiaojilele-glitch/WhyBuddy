"""身份网关抖一下回「0 行」，不许被判成「账号被吊销」。

## 来历：2026-09-16 真机 sr-20260916212612-6N7V2BZ6XS

工程建完、`npm run check` / `build` / `test` 三个全过、`project_start` 提交成功，
运行时却在 worker 的**第一次 check() 上**就死了：

    runtime.state seq=1  status=stopping  errorCode=project_actor_access_revoked
    runtime.state seq=2  status=failed    processId=null  previewUrl=null

而同一个账号、同一份进程环境事后连判三次全过（rollout=internal、
is_superuser=True、is_active=True）。**账号一秒都没被吊销过。**

坏法是两处合起来的：

    identity_store.get_by_id_for_auth   空结果**连同 None 一起缓存 5 秒**
    project_actor_access                「查到空」直接判 project_actor_access_revoked

身份存储是远程 HTTPS SQL 网关，它抖一下回「0 行」不是异常，所以绕过了
「查库失败不缓存」那条让步，落进「判定吊销」那条。5 秒窗口里每一次 check()
都判吊销，正在跑的工程被当场掐掉，错误还甩锅给账号。

⚠ 这个形态在真机上极难查：后端日志一行没有（守卫当时不打日志），
  transcript 的 tool_result 只留 ok 和 operationId，**只有操作记录里才有那个码**。
  所以这轮一并补了日志。

## 这份判据钉什么

正向：抖一下（第一次空、复查有）→ 放行，工程不被掐。
反向：真吊销（两次都空 / 账号停用 / 没有工程权限）→ 仍然当场拒绝。
      没有反向那几条，「守卫直接 return」也能让正向全绿。
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from services import identity_store, project_access, project_actor_access
from services.identity_store import User


@pytest.fixture
def internal_rollout(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(project_access.settings, "NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_ROLLOUT", "internal")
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "internal")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")


def _user(owner, **overrides):
    return User(dict({"id": owner, "is_active": True, "is_superuser": True,
                      "is_verified": True}, **overrides))


def _store(monkeypatch, *, auth_returns, by_id_returns):
    """替身按**真机那一发的形状**：网关回空是返回值，不是异常。"""
    calls = {"auth": 0, "by_id": 0}

    def get_by_id_for_auth(owner):
        calls["auth"] += 1
        return auth_returns(owner, calls["auth"])

    def get_by_id(owner):
        calls["by_id"] += 1
        return by_id_returns(owner, calls["by_id"])

    monkeypatch.setattr(project_actor_access, "get_identity_store",
        lambda: SimpleNamespace(get_by_id_for_auth=get_by_id_for_auth, get_by_id=get_by_id))
    return calls


def test_抖一下回空不再掐掉正在跑的工程(internal_rollout, monkeypatch, caplog):
    """正向：第一次查空、无缓存复查查到了 → 放行。

    ⚠ 这就是真机那一发。修之前它抛 project_actor_access_revoked，
      运行时 stopping → failed，processId 和 previewUrl 全是 null。
    """
    calls = _store(monkeypatch,
        auth_returns=lambda owner, n: None,
        by_id_returns=lambda owner, n: _user(owner))
    with caplog.at_level(logging.WARNING):
        project_actor_access.authorize_project_actor("owner-1")
    assert calls["by_id"] == 1, "没有走无缓存复查——那这条修复根本没接上"
    assert any("recheck" in r.message for r in caplog.records), (
        "复查救回来了却不留痕。下次再发生时，后端日志仍然什么都查不到——"
        "真机那次就是因为这样才要穿三层才找到。"
    )


def test_两次都空仍然算吊销(internal_rollout, monkeypatch):
    """反向：复查只降低误判，不放宽结论。"""
    calls = _store(monkeypatch,
        auth_returns=lambda owner, n: None,
        by_id_returns=lambda owner, n: None)
    with pytest.raises(PermissionError, match="project_actor_access_revoked"):
        project_actor_access.authorize_project_actor("owner-1")
    assert calls["by_id"] == 1


@pytest.mark.parametrize("field", ["is_active", "is_superuser"])
def test_账号真被停用时复查不许放行(internal_rollout, monkeypatch, field):
    """反向：2026-09-13 那条性质必须原样保留——停用当场失效。

    ⚠ 复查拿到的是**同一个被停用的账号**，所以它两次都判不通过。
      要是把复查写成「拿到用户就放行」，这条会红。
    """
    disabled = _user("owner-1", **{field: False})
    _store(monkeypatch,
        auth_returns=lambda owner, n: disabled,
        by_id_returns=lambda owner, n: disabled)
    with pytest.raises(PermissionError, match="project_actor_access_revoked"):
        project_actor_access.authorize_project_actor("owner-1")


def test_查库抛异常仍然是可重试而不是吊销(internal_rollout, monkeypatch):
    """反向：两种失败必须继续分开。抛异常 = 可重试，查到空 = 另一条路。"""
    def boom(owner):
        raise RuntimeError("postgresql://user:password@host/db 连接失败")
    monkeypatch.setattr(project_actor_access, "get_identity_store",
        lambda: SimpleNamespace(get_by_id_for_auth=boom, get_by_id=boom))
    with pytest.raises(PermissionError) as exc:
        project_actor_access.authorize_project_actor("owner-1")
    assert "project_actor_unavailable" in str(exc.value)
    assert "password" not in str(exc.value), "凭据不许跟着异常漏出去"


def test_空结果不进鉴权缓存(monkeypatch):
    """另一半（§4）：守卫改对了，缓存不改一样会连续 5 秒判空。

    直接跑 IdentityStore.get_by_id_for_auth 的产线源码，只替换底下的实查。
    """
    identity_store.invalidate_auth_cache()
    hits = {"n": 0}

    def flaky_get_by_id(self, key):
        hits["n"] += 1
        return None if hits["n"] == 1 else _user(key)

    monkeypatch.setattr(identity_store.IdentityStore, "get_by_id", flaky_get_by_id)
    store = identity_store.IdentityStore.__new__(identity_store.IdentityStore)

    assert store.get_by_id_for_auth("owner-1") is None
    again = store.get_by_id_for_auth("owner-1")
    assert again is not None, (
        "第一次的空被缓存了：5 秒内这个 id 一律查不到，"
        "下游 authorize_project_actor 会连续判「账号被吊销」"
    )
    assert hits["n"] == 2, "第二次没有实查，说明空结果仍然走了缓存"
    identity_store.invalidate_auth_cache()


def test_查到的用户仍然走缓存(monkeypatch):
    """反向：别把缓存整个关掉——那是另一种修法，代价是每次鉴权都打一次远程网关。"""
    identity_store.invalidate_auth_cache()
    hits = {"n": 0}

    def counted_get_by_id(self, key):
        hits["n"] += 1
        return _user(key)

    monkeypatch.setattr(identity_store.IdentityStore, "get_by_id", counted_get_by_id)
    store = identity_store.IdentityStore.__new__(identity_store.IdentityStore)
    store.get_by_id_for_auth("owner-2")
    store.get_by_id_for_auth("owner-2")
    assert hits["n"] == 1, "命中的用户没走缓存，5 秒 TTL 那套让步白做了"
    identity_store.invalidate_auth_cache()
