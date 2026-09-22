"""「查过了没有」和「没查成」必须分得开。

2026-08-27：老版本 `_tool_search` 任何失败都走 `except Exception: hits = []`，
然后照样返回 `ok=True` + 「没有检索到可用片段。」+ 一条
provenance=control-search 的空证据行。Tavily 挂了 / 网断了 / 超时了——对模型
和用户来说**跟"网上确实没有"长得一模一样**。CLAUDE.md §7：流程可以 fail-open
（不该因为搜不到就打死整轮），**结论不许 fail-open**。

抄的标准答案：grok-build xai-grok-session-search/src/bootstrap.rs

    Err(_) => {
        // The abandoned spawn_blocking task runs to completion.
        log_bootstrap_timeout(&session_id, per_session_timeout.as_secs());
        progress.skipped.fetch_add(1, Ordering::Relaxed);   // 不是 indexed
        return;
    }

限时 + 放弃 + 记成 skipped。整轮继续，那一份如实记成"没做成"。

⚠ 判据盯的是**三态可分辨**，不是"有没有 outcome 这个键"。只断言键存在的话，
  把三种情形都填成 "searched" 照样绿——那正是本仓 §3 说的正向判据齐全、
  反向判据缺失。
"""

from __future__ import annotations

import asyncio
import time

import pytest

pytest.importorskip("fastapi")


def _run(query="随便查点什么"):
    from services import rehearsal_control as rc
    from models.v5_state import V5SessionState

    state = V5SessionState(
        sessionId="sr-search-test", goal={"text": "随便一个目标", "status": "clear"}
    )
    result = asyncio.run(rc._tool_search(state, query))
    rows = [
        r
        for r in (getattr(state, "controlTranscript", None) or [])
        if r.get("kind") == "search_evidence"
    ]
    assert len(rows) == 1, "证据检索必须留且只留一条存档行"
    return result, rows[0]


def test_real_hits_are_reported_as_searched(monkeypatch):
    """基线：真查到了。"""
    import services.rag_service as rag

    monkeypatch.setattr(
        rag,
        "retrieve_evidence",
        lambda q, top_k=6: [{"title": "某某调研", "content": "正文", "source": "u"}],
    )
    result, row = _run()
    assert result["ok"] is True
    assert result["outcome"] == "searched"
    assert result["hits"], "查到了却没带 hits"
    assert row["outcome"] == "searched"


def test_genuinely_empty_is_searched_not_broken(monkeypatch):
    """查过了、网上确实没有：ok=True、outcome=searched、话里说"查过了"。"""
    import services.rag_service as rag

    monkeypatch.setattr(rag, "retrieve_evidence", lambda q, top_k=6: [])
    result, row = _run()
    assert result["ok"] is True
    assert result["outcome"] == "searched"
    assert result["hits"] == []
    assert "查过了" in result["summary"], (
        f"真空结果的措辞必须说清「查过了」：{result['summary']!r}"
    )
    assert row["outcome"] == "searched"


def test_failure_is_not_dressed_up_as_empty(monkeypatch):
    """核心反向判据：检索炸了 ≠ 网上没有。

    变异：把 outcome 那一支改回统一 "searched" / 把 ok 改回恒 True → 本条必红。
    """
    import services.rag_service as rag

    def boom(q, top_k=6):
        raise RuntimeError("tavily 502")

    monkeypatch.setattr(rag, "retrieve_evidence", boom)
    result, row = _run()

    assert result["outcome"] == "failed", "检索失败被记成了别的"
    assert result["ok"] is False, (
        "检索失败还报 ok=True——模型会把它当成「查过了、没有」，这就是伪造绿灯"
    )
    assert row["outcome"] == "failed", (
        "存档行没记下失败：会话读回来时空 hits 就再也分不清是没有还是没查成"
    )
    # 措辞本身也要分得开（模型和用户读到的就是这句）
    assert "没查成" in result["summary"], (
        f"失败的措辞跟「查过了没有」分不开：{result['summary']!r}"
    )


def test_timeout_is_abandoned_not_empty(monkeypatch):
    """超死线：记 abandoned，且**必须真的及时返回**（不是等满慢检索）。

    ⚠ 同时钉住"及时"：只断言 outcome 的话，把死线改成 600s 照样绿——
      而那正好等于没有死线。
    """
    import services.rag_service as rag
    from services import rehearsal_control as rc

    monkeypatch.setattr(rc, "_SEARCH_DEADLINE_S", 0.5)

    def slow(q, top_k=6):
        time.sleep(5.0)
        return [{"title": "太晚了", "content": "x"}]

    monkeypatch.setattr(rag, "retrieve_evidence", slow)

    started = time.monotonic()
    result, row = _run()
    elapsed = time.monotonic() - started

    assert result["outcome"] == "abandoned"
    assert result["ok"] is False
    assert result["hits"] == []
    assert row["outcome"] == "abandoned"
    assert elapsed < 2.5, (
        f"超了死线还等满慢检索（{elapsed:.2f}s）——死线没通电，"
        "控制面轮次照样会被拖住"
    )
    assert "没查成" in result["summary"]


def test_the_three_outcomes_are_actually_distinguishable(monkeypatch):
    """把三种情形并排放：任意两种的对外表述不许撞车。

    这条是上面几条的合闸——单看每条都可能被"三个分支填同一个值"糊弄过去。
    """
    import services.rag_service as rag
    from services import rehearsal_control as rc

    monkeypatch.setattr(rc, "_SEARCH_DEADLINE_S", 0.5)

    def slow(q, top_k=6):
        time.sleep(5.0)
        return []

    def boom(q, top_k=6):
        raise RuntimeError("down")

    seen = {}
    for label, impl in (
        ("searched", lambda q, top_k=6: []),
        ("failed", boom),
        ("abandoned", slow),
    ):
        monkeypatch.setattr(rag, "retrieve_evidence", impl)
        result, _row = _run()
        seen[label] = (result["outcome"], result["ok"], result["summary"])

    assert len({v[0] for v in seen.values()}) == 3, f"outcome 撞车了：{seen}"
    # 「查过了没有」与两种"没查成"必须在 ok 上就分开
    assert seen["searched"][1] is True
    assert seen["failed"][1] is False and seen["abandoned"][1] is False
    # 措辞也不许一样
    assert seen["searched"][2] != seen["failed"][2] != seen["abandoned"][2]
