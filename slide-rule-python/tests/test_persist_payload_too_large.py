"""落库超限（HTTP 413）的降级重写（2026-08-18 真机事故）。

## 事故原样

烘焙店会话 sr-20260818010027 本体 605KB（capabilityRuns 179KB + artifacts
130KB 的永续历史打底），精修轮追加第二份带页版本（~77KB 整页 HTML）后，
每一次落盘都撞网关 413。过夜 6 话题打的是 miantuan.ai/db-api（默认 1MB），
日志前缀曾写成 `neon http`——Neon 已经不用了。失败此前被**静默吞掉**。
表现：

    驱动器内存里 mv-4 追加成功、轮叙述写了、lastTurnId 改了名，
    库里却停在轮初快照；轮末前端 PUT 一来，内存缓存也被刷回旧值。
    用户看到"过程卡在动、预览纹丝不动"，日志一行不吭。

只抹版本史页面不够：当前页 + runs + artifacts 仍超限。咖啡馆几乎每轮
是 500 不是 413。所以降级是阶梯，500/超时在大包上也削。
"""

import pytest

from models.v5_state import V5SessionState
from services.persistence import (
    _next_slim,
    _payload_too_large,
    _save_session_record_db,
    _should_retry_slim,
    _strip_version_pages,
)

_PAGES = {"version": "spec-first-pipeline-v1", "pages": {"p1": "<html>页</html>"}}


def _state_with_versions() -> V5SessionState:
    st = V5SessionState(sessionId="s-413", goal={"text": "目标"})
    st.lastTurnId = "turn-9"
    st.specFirstPages = dict(_PAGES)
    st.modelVersions = [
        {"id": "mv-1", "turnId": "turn-8", "model": {"a": 1}, "specFirstPages": None},
        {"id": "mv-2", "turnId": "turn-9", "model": {"a": 2}, "specFirstPages": dict(_PAGES)},
    ]
    return st


class _FakeStore:
    """只演超限剧本的假库：前 fail_times 次 save 抛 413，之后照单全收。"""

    def __init__(self, fail_times: int = 1, error: str = "neon http 413: request body too large"):
        self.fail_times = fail_times
        self.error = error
        self.save_calls = 0
        self.saved_payloads = []

    def load(self, sid):
        return None  # 没有 prior，守卫直接放行

    def content_hash(self, payload):
        import json

        return json.dumps(payload, sort_keys=True, default=str)

    def save(self, sid, payload, expected_rev=None):
        self.save_calls += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError(self.error)
        self.saved_payloads.append(payload)
        return True


class Test超限降级:
    def test_413时抹掉版本史页面重写成功(self):
        store = _FakeStore(fail_times=1)
        result = _save_session_record_db(store, _state_with_versions())
        assert result["ok"] is True
        assert result.get("degradedVersionPagesStripped") is True
        assert store.save_calls == 2, "第一次 413，第二次降级重写"
        saved = store.saved_payloads[-1]
        assert all(
            not v.get("specFirstPages") for v in saved["modelVersions"]
        ), "降级重写后版本史不许再带整页"
        # 核心不许陪葬：模型段、当前预览页面（state.specFirstPages）都要在
        assert saved["modelVersions"][-1]["model"] == {"a": 2}
        assert saved["specFirstPages"]["pages"]["p1"] == "<html>页</html>"

    def test_非413错误不降级_如实报错(self):
        # 反向配对：降级只对超限开。网络断了/表锁了照样重试会把别的故障
        # 掩护成"成功但页面没了"。
        store = _FakeStore(fail_times=9, error="connection reset by peer")
        result = _save_session_record_db(store, _state_with_versions())
        assert result["ok"] is False
        assert result["reason"] == "db_write_failed"
        assert store.save_calls == 1, "非超限错误不许有第二次写"

    def test_413但没有版本页面可抹_削当前页重写成功(self):
        # 过夜：版本史已经没页了，超限的是当前预览页。旧判据「没版本页就
        # 如实报错」会让 6 个话题后期整包写不进去。当前页是增强类，可 fail-open。
        st = _state_with_versions()
        st.modelVersions = [
            {"id": "mv-1", "turnId": "turn-8", "model": {"a": 1}, "specFirstPages": None}
        ]
        store = _FakeStore(fail_times=1)
        result = _save_session_record_db(store, st)
        assert result["ok"] is True
        assert "current_pages" in (result.get("degradeFlags") or [])
        assert store.saved_payloads[-1].get("specFirstPages") in (None, {})
        assert st.specFirstPages["pages"]["p1"] == "<html>页</html>", (
            "内存里的当前页被降级顺手抹了——预览当场没了"
        )

    def test_什么都削不动才如实报错(self):
        # 反向：当前页/版本页/历史都没有可削的，不许空转第二次写。
        st = V5SessionState(sessionId="s-empty", goal={"text": "g"})
        st.lastTurnId = "turn-1"
        st.specFirstPages = None
        st.modelVersions = [{"id": "mv-1", "model": {}, "specFirstPages": None}]
        store = _FakeStore(fail_times=9)
        result = _save_session_record_db(store, st)
        assert result["ok"] is False
        assert store.save_calls == 1

    def test_降级不动调用方手里那份状态(self):
        # 调用方的 state 是内存权威，降级只影响写进库的那份
        st = _state_with_versions()
        _save_session_record_db(_FakeStore(fail_times=1), st)
        assert st.modelVersions[-1]["specFirstPages"] is not None, \
            "内存里的版本页面被降级顺手抹了——预览和回退会当场少东西"


class Test判据本身:
    def test_payload_too_large_认语义词(self):
        assert _payload_too_large(RuntimeError("neon http 413: request body too large"))
        assert _payload_too_large(RuntimeError("db-api http 413: request body too large"))
        assert _payload_too_large(RuntimeError("Payload Too Large"))
        assert not _payload_too_large(RuntimeError("connection reset"))

    def test_大包500也走降级_小包500不走(self):
        fat = _state_with_versions()
        fat.specFirstPages = {"pages": {"p1": "x" * 800_000}}
        assert _should_retry_slim(RuntimeError("db-api http 500: Internal Server Error"), fat)
        thin = V5SessionState(sessionId="s", goal={"text": "g"})
        assert not _should_retry_slim(RuntimeError("db-api http 500: Internal Server Error"), thin)

    def test_strip_没页面返回None(self):
        st = V5SessionState(sessionId="s", goal={"text": "g"})
        st.modelVersions = [{"id": "mv-1", "model": {}, "specFirstPages": None}]
        assert _strip_version_pages(st) is None
        nxt = _next_slim(st)
        assert nxt is None, "没有可削的还返回下一档——空转"
