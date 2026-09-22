"""会话归属：**每一条能造出会话的路都得把归属写上**（2026-08-09）。

## 这组测试是怎么来的

套件里 11 条测试红了好几天（turnNarrations 4 / 持久化契约 4 / v5 冒烟 3），
形状都一样：请求返回 200，紧接着 GET 同一个 id 返回 404。看着像鉴权回归。

查下来是**方案 B 只堵了一条路**。2026-08-06 定的规矩是「不让无主会话这个状态
存在」，`POST /sessions` 照做了（要求登录 + 写 ownerId）。但从请求体造会话的
地方一共有四处：

    POST /sessions          建会话        ← 只有这条设了归属
    PUT  /sessions/{sid}    保存（可建）  ← 没设
    POST /drive-full        推演（可建）  ← 没设
    POST /drive-full-stream 推演（可建）  ← 没设

后三条建出来的会话是无主的。而 `session_record` 恒判 private、`access_for`
只给超管——**建出来就没人读得到**。

## 还有一条更隐蔽的

`PUT` 的合并没有把 `ownerId` 排除在客户端可写字段之外。前端每次保存都 PUT
一次全量 state，而它的 `V5SessionState.ownerId` 默认 None ——于是**正常用一次
就把归属抹掉了**，之后这条会话谁都读不到。

这条比上面三条更该钉：它不是"某条路忘了设"，而是"设好的会被后续操作悄悄
擦掉"，症状要等到下次打开才出现。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from conftest import TEST_USER_ID  # noqa: E402

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402

client = TestClient(app)
KEY = {"x-internal-key": "dev-slide-rule-internal"}


def _put(sid: str, **extra):
    body = {"sessionId": sid, "goal": {"text": "g", "status": "clear"}, "lastTurnId": "turn-1"}
    body.update(extra)
    return client.put(f"/api/sliderule/sessions/{sid}", json=body, headers=KEY)


def test_put_created_session_is_owned_and_readable():
    """**这是那 11 条红用例的共同根因。**

    PUT 建出来的会话必须有主，否则它 200 建成、404 读不到——最难查的那种。
    """
    sid = "own-put-created"
    assert _put(sid).status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}", headers=KEY)
    assert got.status_code == 200, "PUT 建的会话读不回来 —— 归属没写上"
    assert got.json()["state"]["ownerId"] == TEST_USER_ID


def test_client_put_cannot_erase_ownership():
    """**归属是服务端的。**

    前端每次保存都 PUT 全量 state，而它默认不带 ownerId。合并时不排除的话，
    一次普通保存就把归属抹成 None，会话从此谁都读不到。
    """
    sid = "own-put-not-erased"
    assert _put(sid).status_code == 200
    # 再存一次，body 里**没有** ownerId —— 前端真实行为
    assert _put(sid, lastTurnId="turn-2").status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}", headers=KEY)
    assert got.status_code == 200, "第二次保存之后就读不到了 —— 归属被客户端 body 擦了"
    assert got.json()["state"]["ownerId"] == TEST_USER_ID


def test_client_put_cannot_forge_ownership():
    """反方向同理：客户端塞一个别人的 ownerId 也不该生效。"""
    sid = "own-put-not-forged"
    assert _put(sid).status_code == 200
    assert _put(sid, lastTurnId="turn-2", ownerId="u-someone-else").status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}", headers=KEY)
    assert got.json()["state"]["ownerId"] == TEST_USER_ID


def test_every_session_creating_route_adopts_the_owner():
    """路由层的**结构**钉一遍，不只钉行为。

    行为测试只能覆盖到我想得起来的那几条路；这条钉的是"从请求体造会话的每一
    处都调了 _adopt_owner"。将来加第五条路时，漏调会在这里红，而不是等到用户
    报"我的会话打不开"。
    """
    src = (Path(__file__).resolve().parent.parent / "routes" / "sliderule_full.py").read_text(
        encoding="utf-8"
    )
    # 在**构造点周围一段**里找 _adopt_owner，不逐行找也不只往后找。
    #
    # 踩过两次：
    #   ① 逐行找 —— `_adopt_owner(\n  V5SessionState(...), viewer\n)` 跨行，
    #      第二行被当成"没认归属"；
    #   ② 只往后找 —— 上面那种写法里 `_adopt_owner(` 在构造点**前面**，照样漏。
    # 取前后各 200 字符的窗口，两种写法都覆盖。
    import re

    # 豁免：**不落库**的路由造不出无主会话。加进这张表要写清为什么。
    EXEMPT = {
        "/coverage": "只算覆盖门就返回，state 是纯入参，从不 save_session",
    }
    hits = [m.start() for m in re.finditer(r"V5SessionState\(\*\*(?:raw_state|payload\[)", src)]
    assert hits, "找不到任何「从请求体造会话」的地方 —— 是不是改写法了？"
    missing = []
    for idx in hits:
        window = src[max(0, idx - 200) : idx + 200]
        if "_adopt_owner" in window:
            continue
        route = re.findall(r'@router\.\w+\("([^"]+)"\)', src[:idx])
        where = route[-1] if route else "?"
        if where in EXEMPT:
            continue
        missing.append(f"{where}: {src[idx : idx + 60].splitlines()[0]}")
    assert missing == [], (
        "这些地方从请求体造了会话但没认归属：\n  "
        + "\n  ".join(missing)
        + "\n无主会话建出来就没人读得到（private + 只有超管可见）。"
        + "\n确实不落库的话，把路由加进 EXEMPT 并写明理由。"
    )


def test_put_creating_a_session_requires_login(real_auth):
    """匿名 PUT 不该建出会话 —— 那正是方案 B 要消灭的那个状态。

    用 real_auth 摘掉 conftest 的默认登录覆盖，走真实（未登录）身份。
    """
    r = _put("own-put-anon")
    assert r.status_code == 401, f"匿名 PUT 建会话返回了 {r.status_code}，无主会话又能造出来了"
