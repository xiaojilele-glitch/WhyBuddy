"""跨站白名单与出厂密码（2026-08-04）。

## 这两条是怎么被发现的

用另一套多租户系统的架构图当检查表逐条对我们自己的代码时掉出来的。那份图里有
一层独立的 Edge（Nginx 域名绑定、防盗链），我们没有对应物——顺着这条线查，
发现两处：

**① CORS 是全开且允许携带凭据。**

原来写死 `allow_origins=["*"] + allow_credentials=True`。Starlette 对这个组合的
处理**不是**返回 `*`，而是**回显请求方的 Origin**（cors.py:167
`if self.allow_all_origins and self.allow_credentials`）。实测：

    curl -H "Origin: https://evil.example" .../account/me
    → access-control-allow-origin: https://evil.example
      access-control-allow-credentials: true

当时没被打穿只是因为登录 Cookie 带 `samesite=lax`，浏览器不会在跨站 fetch 上带
它——**整条防线押在一个 Cookie 属性上，CORS 这层零防御**。

**② 内部密钥是出厂默认值。**

`SLIDE_RULE_INTERNAL_KEY` 默认 `dev-slide-rule-internal`，明文写在仓库和测试里。
它守着 sliderule_full / permissions / tasks 那几十个写接口。生产沿用默认值 =
那些接口对任何能连上端口的人敞开。

## 改法都抄 fastapi/full-stack-fastapi-template

· CORS：`main.py:28` —— **有白名单才装中间件**，没配就不装（= 只允许同源）。
· 出厂密码：`core/config.py:96` 的 `_check_default_secret` —— 本地 warn、
  其余环境 raise。本地要能一把跑起来、上线必须换掉，靠环境区分而不是靠自觉。
"""

from __future__ import annotations

import pytest

ROOT_OK = pytest.importorskip("fastapi", reason="没装 fastapi 时这份测试无意义")


# ── ① 跨站白名单 ─────────────────────────────────────────────────


def test_no_whitelist_means_same_origin_only():
    """默认不配 = 不装 CORS 中间件 = 浏览器默认的同源策略。

    这是我们想要的默认：前后端同源部署（Node/Vite 代理到这里），跨站访问本来就
    不该发生。"默认最保守"比"默认全开再让人记得收紧"可靠得多。
    """
    from config.settings import Settings

    assert Settings(BACKEND_CORS_ORIGINS="").cors_origins == []


def test_whitelist_accepts_both_shapes():
    """逗号分隔和 JSON 数组都认（同模板的 parse_cors），尾斜杠归一。

    尾斜杠必须去掉：CORS 比对的是**源**（scheme+host+port），
    `https://a.com/` 永远匹配不上任何请求的 Origin 头。
    """
    from config.settings import Settings

    assert Settings(BACKEND_CORS_ORIGINS="https://a.com, https://b.com/").cors_origins == [
        "https://a.com",
        "https://b.com",
    ]
    assert Settings(BACKEND_CORS_ORIGINS='["https://a.com"]').cors_origins == ["https://a.com"]


def test_a_malformed_whitelist_falls_back_to_closed():
    """配歪了按"没配"处理——**不能**按"全开"处理。

    与本项目其他地方"认不出就用默认值"的取向一致方向相反：配置脏了的时候，
    往开放的一边兜底等于把门敞开。
    """
    from config.settings import Settings

    assert Settings(BACKEND_CORS_ORIGINS="[这不是 JSON").cors_origins == []


def test_the_app_does_not_echo_arbitrary_origins():
    """真起一次应用，拿一个恶意域名问一句——这是实测那条现象的回归钉子。

    默认没配白名单，所以响应里**不该**出现任何 access-control-allow-origin。
    """
    from fastapi.testclient import TestClient

    from app import app

    got = TestClient(app).get(
        "/api/sliderule/account/me", headers={"Origin": "https://evil.example"}
    )
    lowered = {k.lower(): v for k, v in got.headers.items()}
    assert "access-control-allow-origin" not in lowered, (
        f"回显了任意 Origin：{lowered.get('access-control-allow-origin')}"
    )
    assert "access-control-allow-credentials" not in lowered


# ── ② 出厂密码 ───────────────────────────────────────────────────


def test_production_refuses_to_start_with_the_factory_key():
    """生产环境沿用出厂密码 = 拒绝启动。

    宁可上线时炸一次，也别带着一把公开的钥匙跑一年——那把钥匙守着几十个写接口。
    """
    from config.settings import Settings

    with pytest.raises(ValueError) as e:
        Settings(NODE_ENV="production")._enforce_non_default_secrets()
    assert "SLIDE_RULE_INTERNAL_KEY" in str(e.value)


def test_development_only_warns():
    """本地开发要能一把跑起来，不然每个人 clone 完都先卡在配置上。"""
    from config.settings import Settings

    with pytest.warns(UserWarning, match="SLIDE_RULE_INTERNAL_KEY"):
        Settings(NODE_ENV="development")._enforce_non_default_secrets()


def test_a_real_key_passes_in_production():
    """换掉之后生产环境正常放行——这条防的是"检查写得太紧，换了也过不了"。"""
    from config.settings import Settings

    s = Settings(NODE_ENV="production", SLIDE_RULE_INTERNAL_KEY="a-real-secret-value")
    assert s._enforce_non_default_secrets() is s


def test_prod_detection_covers_both_spellings():
    from config.settings import Settings

    assert Settings(NODE_ENV="production").is_production is True
    assert Settings(NODE_ENV="prod").is_production is True
    assert Settings(NODE_ENV="development").is_production is False
