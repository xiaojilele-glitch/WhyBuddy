"""`/回退` forcedTool restore_version：空 versionId 默认上一版，缺版本 fail-closed。

反向：`_dispatch_tool` 仍把 args={} 的 versionId 传成 "" → spy 收到空串，
且 `_tool_restore` 再对空 id 报 ok:True → 本文件红。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.slide_rule_session import load_session, save_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_forced_restore_empty_version_defaults_previous(harness, monkeypatch):
    sid = new_sid("restore-prev")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[
            {"id": "v1", "model": {"pages": []}},
            {"id": "v2", "model": {"pages": []}},
        ],
        currentModelVersionId="v2",
    )
    seen = []

    def fake_restore(session_id: str, version_id: str):
        seen.append(version_id)
        loaded = load_session(session_id)
        assert loaded is not None
        loaded.currentModelVersionId = version_id
        save_session(loaded)
        return {"restored": True, "state": loaded.model_dump()}

    # ⚠ 2026-08-29 业务核下沉到 services/model_version_restore（原来长在 routes 里，
    #   业务层反向 import 路由层，是个真的循环依赖）。控制面走的是 service 那份，
    #   所以 patch 点跟着走——**patch 错模块不会报错，会去打真库**。
    monkeypatch.setattr(
        "services.model_version_restore.restore_model_version_locked", fake_restore
    )
    _, events = harness.post(
        six_fields(sid, "/回退", forcedTool="restore_version")
    )
    assert harness.llm_calls == []
    assert harness.helper_calls == []
    assert seen == ["v1"], "空 versionId 必须默认上一版，不得把 '' 丢进 restore"
    results = [e for e in events if e.get("type") == "control_tool_result"]
    assert results
    assert results[0].get("ok") is True
    assert results[0].get("versionId") == "v1"
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.currentModelVersionId == "v1"
    assert "control_handoff_factory" not in event_types(events)


def test_forced_restore_payload_version_id_wins(harness, monkeypatch):
    sid = new_sid("restore-payload")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[
            {"id": "v1", "model": {"pages": []}},
            {"id": "v2", "model": {"pages": []}},
            {"id": "v3", "model": {"pages": []}},
        ],
        currentModelVersionId="v3",
    )
    seen = []

    def fake_restore(session_id: str, version_id: str):
        seen.append(version_id)
        loaded = load_session(session_id)
        assert loaded is not None
        loaded.currentModelVersionId = version_id
        save_session(loaded)
        return {"restored": True, "state": loaded.model_dump()}

    # ⚠ 2026-08-29 业务核下沉到 services/model_version_restore（原来长在 routes 里，
    #   业务层反向 import 路由层，是个真的循环依赖）。控制面走的是 service 那份，
    #   所以 patch 点跟着走——**patch 错模块不会报错，会去打真库**。
    monkeypatch.setattr(
        "services.model_version_restore.restore_model_version_locked", fake_restore
    )
    harness.post(
        six_fields(
            sid, "/回退", forcedTool="restore_version", versionId="v1"
        )
    )
    assert seen == ["v1"]


def test_forced_restore_without_versions_is_fail_closed(harness, monkeypatch):
    sid = new_sid("restore-empty")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    seen = []

    def fake_restore(session_id: str, version_id: str):
        seen.append(version_id)
        return {"restored": True, "state": load_session(session_id).model_dump()}

    # ⚠ 2026-08-29 业务核下沉到 services/model_version_restore（原来长在 routes 里，
    #   业务层反向 import 路由层，是个真的循环依赖）。控制面走的是 service 那份，
    #   所以 patch 点跟着走——**patch 错模块不会报错，会去打真库**。
    monkeypatch.setattr(
        "services.model_version_restore.restore_model_version_locked", fake_restore
    )
    _, events = harness.post(
        six_fields(sid, "/回退", forcedTool="restore_version")
    )
    assert seen == [], "没有上一版时不得拿空 id 去 restore"
    results = [e for e in events if e.get("type") == "control_tool_result"]
    assert results
    assert results[0].get("ok") is False
    assert harness.helper_calls == []
    loaded = load_session(sid)
    assert loaded is not None
    assert not loaded.currentModelVersionId
