# -*- coding: utf-8 -*-
"""health 必须能看出目录窄化到底生效没有（2026-08-11）。

## 为什么加这条

窄化是**会静默失效**的：`block_narrowing` 对 `rank_bm25` fail-open，缺了就退回
全量目录。fail-open 是对的，但它造成的失效态在外面完全不可观测——接口照常
200、health 照常 ok、日志照常干净，只是那份 0.67 → 3.25（p=0.00004）没有了。

同一天踩了两次：
  · rank-bm25 漏在 requirements.txt 外，部署上去窄化整个不生效；
  · 修完要验证线上装没装，发现除了「登服务器敲一行 pip」没有别的办法。

所以健康探针里必须有它的位置。判据是 `effective` ——
**开关开着不算数，依赖也在才算数**。
"""

from fastapi.testclient import TestClient


def _health(client: TestClient) -> dict:
    res = client.get("/api/health")
    assert res.status_code == 200
    return res.json()


def test_health_里有窄化就绪度():
    import app as app_module

    body = _health(TestClient(app_module.app))
    assert "blockNarrowing" in body, "health 看不出窄化状态——这正是上次卡住的地方"
    for key in ("enabled", "scorerPresent", "effective", "limit"):
        assert key in body["blockNarrowing"], key


def test_装齐时_effective为真():
    import app as app_module

    n = _health(TestClient(app_module.app))["blockNarrowing"]
    assert n["scorerPresent"] is True, "本地没装 rank-bm25——先 pip install -r requirements.txt"
    assert n["effective"] is True, f"窄化未生效：{n}"


def test_开关开着但依赖缺失_effective必须为假():
    """**这条是整个文件的理由。**

    "开关开着" ≠ "在窄化"。少了这一条，线上那个"以为在窄化其实退回全量"的状态
    在 health 上仍然看不出来——那就白加了。
    """
    import app as app_module
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "rank_bm25":
            raise ImportError("模拟依赖缺失")
        return real_import(name, *args, **kwargs)

    builtins.__import__ = fake_import
    try:
        n = _health(TestClient(app_module.app))["blockNarrowing"]
    finally:
        builtins.__import__ = real_import

    assert n["scorerPresent"] is False
    assert n["effective"] is False, "依赖缺失却报 effective=true —— health 在说谎"


def test_不泄露实现细节():
    """跟 _llm_readiness 同一条纪律：只回答"能不能干活"，不吐内部结构。"""
    import app as app_module

    n = _health(TestClient(app_module.app))["blockNarrowing"]
    assert set(n) == {"enabled", "scorerPresent", "effective", "limit"}
    assert isinstance(n["limit"], int) and n["limit"] > 0
