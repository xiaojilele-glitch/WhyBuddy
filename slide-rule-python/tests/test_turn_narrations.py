"""E13 直播时间线持久化：turnNarrations PUT→GET 往返 + 封顶 + 同轮守卫豁免。

回归目标：刷新后左栏「7 阶段 25 步」不再缩成「1 阶段 0 步」——
叙述随会话状态落库，且不被同轮 stale-clobber 守卫丢弃。
"""

import os
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fresh_client(monkeypatch):
    store = Path(tempfile.mkdtemp(prefix="turn-narr-")) / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store))
    import services.slide_rule_session as sess_svc
    import routes.sliderule_full as sliderule_full

    sess_svc._sessions = {}
    sliderule_full._sessions = {}
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    # 这个 app 是**本地新建的**，conftest 那个 autouse 登录覆盖只装在
    # `sys.modules["app"].app` 上，装不到这里 —— 于是请求是匿名的，而
    # PUT 建会话要求登录（方案 B），会稳定 401。
    #
    # 覆盖同源：用 conftest 的 _TestUser，免得两处身份对不上（对不上的表现是
    # "建得成但读不到"，比 401 更难查）。
    from middlewares.current_user import optional_user
    from conftest import _TestUser

    app.dependency_overrides[optional_user] = lambda: _TestUser()
    return TestClient(app)


def _narr(turn_id: str, n_steps: int = 3, text: str = "正在分析风险"):
    return {
        "turnId": turn_id,
        "user": "社区宠物医院预约问诊系统",
        "steps": [
            {"id": f"{turn_id}-s{i}", "kind": "narration", "text": f"{text} {i}", "source": "llm"}
            for i in range(n_steps)
        ],
    }


def test_put_get_roundtrip_keeps_narrations(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-roundtrip"
    entry = _narr("turn-7", 5)
    entry["durationMs"] = 23456  # E16 收口句：真实用时随叙述持久化
    state = {
        "sessionId": sid,
        "goal": {"text": "宠物医院", "status": "clear"},
        "lastTurnId": "turn-7",
        "turnNarrations": [entry],
    }
    put = client.put(f"/api/sliderule/sessions/{sid}", json=state)
    assert put.status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    narrs = got.get("turnNarrations") or []
    assert len(narrs) == 1 and narrs[0]["turnId"] == "turn-7"
    assert len(narrs[0]["steps"]) == 5
    assert narrs[0]["steps"][0]["text"].startswith("正在分析风险")
    assert narrs[0]["durationMs"] == 23456
    # 非数值用时被丢弃，不编数据
    bad = _narr("turn-8", 1)
    bad["durationMs"] = "not-a-number"
    state2 = {**state, "lastTurnId": "turn-8", "turnNarrations": [bad]}
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state2).status_code == 200
    got2 = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    assert "durationMs" not in (got2.get("turnNarrations") or [{}])[-1]


def test_caps_three_turns_and_truncates_text(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-caps"
    big = _narr("turn-5", 2)
    big["steps"][0]["text"] = "长" * 5000
    state = {
        "sessionId": sid,
        "goal": {"text": "x", "status": "clear"},
        "lastTurnId": "turn-5",
        "turnNarrations": [_narr(f"turn-{i}") for i in range(1, 5)] + [big],
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    narrs = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]["turnNarrations"]
    assert len(narrs) == 3  # 只留最近 3 轮
    assert narrs[-1]["turnId"] == "turn-5"
    step = narrs[-1]["steps"][0]
    assert len(step["text"]) <= 1201  # 1200 + 省略号

    # ⚠ 2026-08-23：截断后的长度**恒等于 1201**，所以前端"数截断后的文本"会让
    # 每个超长步骤都显示同一个数——用户指着推演步骤列表问"这些字数为啥都一样"
    # 就是这么来的。原始长度必须另存，且必须是真数、不是那个 1201。
    assert step["textChars"] == 5000
    assert step["textChars"] != len(step["text"])


def test_short_step_gets_no_textChars(monkeypatch):
    """没超上限的步骤不加这个键——它的长度本来就是真的。

    反向：少了这条，把 textChars 写成"每步都记"也全绿，而那是白占字节
    （这份投影本来就是为了封顶体积才存在的）。
    """
    client = _fresh_client(monkeypatch)
    sid = "narr-short"
    small = _narr("turn-1", 1)
    small["steps"][0]["text"] = "短文本"
    state = {
        "sessionId": sid,
        "goal": {"text": "x", "status": "clear"},
        "lastTurnId": "turn-1",
        "turnNarrations": [small],
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    narrs = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]["turnNarrations"]
    step = narrs[-1]["steps"][0]
    assert step["text"] == "短文本"
    assert "textChars" not in step


def test_same_turn_snapshot_still_carries_narrations(monkeypatch):
    """同轮无核心增长的 PUT（轮末叙述回传的真实形态）：守卫保留旧核心，
    但 turnNarrations 作为展示投影必须穿透（persistence 豁免清单）。"""
    client = _fresh_client(monkeypatch)
    sid = "narr-same-turn"
    base = {
        "sessionId": sid,
        "goal": {"text": "宠物医院", "status": "clear"},
        "lastTurnId": "turn-9",
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=base).status_code == 200
    # 第二次 PUT：同 lastTurnId、核心零增长，只多叙述
    assert (
        client.put(
            f"/api/sliderule/sessions/{sid}",
            json={**base, "turnNarrations": [_narr("turn-9", 4)]},
        ).status_code
        == 200
    )
    narrs = client.get(f"/api/sliderule/sessions/{sid}").json()["state"].get("turnNarrations") or []
    assert len(narrs) == 1 and len(narrs[0]["steps"]) == 4, "同轮守卫把叙述丢了"


def test_legacy_state_without_narrations_loads_clean(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-legacy"
    state = {"sessionId": sid, "goal": {"text": "旧会话", "status": "clear"}}
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    assert got.get("turnNarrations") == []


def test_slim_is_idempotent(monkeypatch):
    """**同一份数据被瘦身两遍，textChars 必须还是真原长。**

    这条是 2026-08-23 真机翻车逼出来的：字段加完、单测全绿，跑新话题一看库里
    是 `text=1201 textChars=1201`，界面照旧一排 1201。原因是这条路本来就跑两
    遍——客户端 slimStep 先截（那次记的才是真原长），PUT 上来后
    cap_turn_narrations 再跑一遍，此时 text 已是 1201 仍然超限，把正确值覆盖成
    了 1201。

    单测只跑一遍瘦身是抓不到的。这条显式跑两遍。
    """
    from services.turn_narration import _slim_step

    once = _slim_step({"id": "s1", "kind": "llm_output", "text": "长" * 5000})
    assert once["textChars"] == 5000
    assert len(once["text"]) == 1201  # 1200 + 省略号：再跑一遍仍然超限

    twice = _slim_step(once)
    assert twice["textChars"] == 5000, "第二遍不许把真原长覆盖成 1201"
    assert len(twice["text"]) == 1201


def test_put_then_reput_keeps_the_original_length(monkeypatch):
    """走真实通道再验一遍：客户端已截过的数据 PUT 上来，原长要活下来。"""
    client = _fresh_client(monkeypatch)
    sid = "narr-idem"
    entry = _narr("turn-1", 1)
    # 客户端瘦身之后的形状：text 已经是 1201，原长在 textChars 里
    entry["steps"][0]["text"] = "长" * 1200 + "…"
    entry["steps"][0]["textChars"] = 7777
    state = {
        "sessionId": sid,
        "goal": {"text": "x", "status": "clear"},
        "lastTurnId": "turn-1",
        "turnNarrations": [entry],
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    step = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]["turnNarrations"][-1]["steps"][0]
    assert step["textChars"] == 7777, "服务端不该把客户端记下的原长覆盖掉"
