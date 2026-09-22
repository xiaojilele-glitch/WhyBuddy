"""Golden path convergence: coverage gaps resolve after trusted commits and
the full driver converges instead of stalling on max_repeat_guard.

Regression for the live stall found on 2026-07-06: capabilities executed and
committed with producedBy + trust ledger, but nothing resolved the coverage
gaps (resolveCoverageGapsFromState was never ported) and the picker never
selected contract-required critique.generate — the loop then died on
max_repeat_guard with all blocking gaps still open.
"""

from plan_approval_support import approved_execution_payload
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import ProducedBy, V5SessionState  # noqa: E402
from conftest import TEST_USER_ID  # noqa: E402
from services.slide_rule_coverage import (  # noqa: E402
    author_coverage_contract,
    evaluate_coverage_gate,
    resolve_coverage_gaps_from_state,
)
from services.engine_scheduling import commit_artifact, pick_next_capabilities  # noqa: E402

COMPLEX_GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"


def _state_with_contract() -> V5SessionState:
    state = V5SessionState(
        sessionId="golden-conv-test",
        goal={"text": COMPLEX_GOAL},
        artifacts=[],
    )
    authored = author_coverage_contract(COMPLEX_GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


def _commit(state: V5SessionState, cap: str, loop: int = 0) -> None:
    commit_artifact(
        state,
        id=f"art-{loop}-{cap}",
        kind="evidence" if "evidence" in cap else "risk",
        content=f"executed {cap} with real output",
        summary=f"{cap} done",
        provenance="python-rag",
        producedBy=ProducedBy(capabilityRunId=f"run-{loop}-{cap}", capabilityId=cap),
        turnId=f"loop-{loop}",
        sources=[{"content": "evidence", "source": "internal-policy-v1", "id": "rbac1"}],
    )


def test_resolve_closes_capability_gap_after_trusted_commit():
    state = _state_with_contract()
    _commit(state, "risk.analyze")

    state = resolve_coverage_gaps_from_state(state)

    by_cap = {g.get("requiredCapabilityId") or g.get("kind"): g.get("status") for g in state.coverageGaps}
    assert by_cap["risk.analyze"] == "resolved"
    assert by_cap["critique.generate"] == "open"  # not committed → stays open


def test_resolve_closes_evidence_gap_when_grounded_count_met():
    state = _state_with_contract()
    _commit(state, "evidence.search")

    state = resolve_coverage_gaps_from_state(state)

    ev = [g for g in state.coverageGaps if g.get("kind") == "missing_evidence"]
    assert ev and ev[0].get("status") == "resolved"


def test_gate_passes_after_all_required_caps_committed_and_resolved():
    state = _state_with_contract()
    for cap in ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)

    state = resolve_coverage_gaps_from_state(state)
    gate = evaluate_coverage_gate(state)

    assert gate["passed"] is True, gate["reason"]
    assert gate["missingCapabilities"] == []
    assert gate["unresolvedGaps"] == []


def test_picker_fills_contract_required_capability_missed_by_heuristics():
    state = _state_with_contract()
    # 已提交除 critique.generate 外的所有前置能力（复刻线上死锁前的状态）
    for cap in ["risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)
    state = resolve_coverage_gaps_from_state(state)

    picks = pick_next_capabilities(state, "继续")

    assert any(p["capabilityId"] == "critique.generate" for p in picks), picks


def test_drive_full_uses_persisted_server_state_as_authority(tmp_path, monkeypatch):
    """回归：drive-full 必须以持久化的服务端会话为起点。

    客户端 state 副本经防伪造清洗后没有 trustLevel/producedBy/台账；曾经的实现
    以它为起点，导致"生成交付物"回合把之前所有 trusted-committed 进度清零、
    delivery 分支永不触发。
    """
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    import importlib
    import services.persistence as persistence_mod
    import services.slide_rule_session as session_mod
    importlib.reload(persistence_mod)
    session_mod._sessions.clear()

    from fastapi.testclient import TestClient
    import app as app_mod

    # 服务端持久化：已收敛、带可信产物的会话
    state = _state_with_contract()
    state.sessionId = "authority-check"
    state.ownerId = TEST_USER_ID
    for cap in ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)
    from services.slide_rule_coverage import resolve_coverage_gaps_from_state as _resolve
    state = _resolve(state)
    state.goal["status"] = "clear"
    from services.slide_rule_session import save_session
    save_session(state)

    client = TestClient(app_mod.app)
    degraded_client_copy = {
        "sessionId": "authority-check",
        "goal": {"text": COMPLEX_GOAL},  # 客户端副本：无 status、无可信产物
        "artifacts": [],
    }
    resp = client.post(
        "/api/sliderule/drive-full",
        json=approved_execution_payload({"state": degraded_client_copy, "userText": "打包交付：生成 spec 树、规格文档、提示词包", "max_loops": 4}),
        headers={"X-Internal-Key": "dev-slide-rule-internal"},
    )
    assert resp.status_code == 200, resp.text
    out_state = resp.json().get("state") or {}
    arts = out_state.get("artifacts") or []
    # 服务端权威起点：之前提交的可信产物必须保留
    prior_ids = {f"art-0-{cap}" for cap in ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search"]}
    got_ids = {a.get("id") for a in arts}
    assert prior_ids.issubset(got_ids), f"prior trusted artifacts lost: {sorted(prior_ids - got_ids)}"
    # 交付意图 + clear 状态：应产出 delivery 类产物
    delivery_caps = {"document.draft", "task.write", "instruction.package", "outcome.visualize", "handoff.package", "report.write"}
    produced_caps = {(a.get("producedBy") or {}).get("capabilityId") for a in arts}
    assert produced_caps & delivery_caps, f"no delivery artifacts produced: {sorted(produced_caps - {None})}"


def test_single_delivery_turn_produces_full_package(tmp_path, monkeypatch):
    """一轮"打包交付"应产出全部交付物：门通过后若交付清单未出全，驱动循环
    必须继续（单轮限选 5 个能力 + picker 跳过已提交项协同完成）。"""
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.v5_full_driver import drive_full_v5_session

    # 已收敛的会话（复用合约 + 全部前置能力已提交）
    state = _state_with_contract()
    state.sessionId = "single-delivery-turn"
    for cap in ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)
    state = resolve_coverage_gaps_from_state(state)
    state.goal["status"] = "clear"

    out = drive_full_v5_session(
        state,
        user_instruction="打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包",
        max_loops=8,
    )
    final = out["finalState"] if isinstance(out, dict) and "finalState" in out else out
    arts = final.get("artifacts") if isinstance(final, dict) else getattr(final, "artifacts", [])
    produced = set()
    for a in arts or []:
        prod = a.get("producedBy") if isinstance(a, dict) else getattr(a, "producedBy", None)
        cap = prod.get("capabilityId") if isinstance(prod, dict) else getattr(prod, "capabilityId", None)
        if cap:
            produced.add(cap)

    expected = {
        "report.write",
        "document.draft",
        "traceability.matrix",
        "task.write",
        "instruction.package",
        "outcome.visualize",
        "handoff.package",
    }
    assert expected.issubset(produced), f"missing deliverables: {sorted(expected - produced)}"


def test_full_driver_converges_instead_of_max_repeat_guard_stall(tmp_path, monkeypatch):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.v5_full_driver import drive_full_v5_session

    state = V5SessionState(
        sessionId="golden-conv-drive",
        goal={"text": COMPLEX_GOAL},
        artifacts=[],
    )
    out = drive_full_v5_session(state, user_instruction=COMPLEX_GOAL, max_loops=8)
    final = out["finalState"] if isinstance(out, dict) and "finalState" in out else out
    if isinstance(final, dict):
        phase = final.get("runtimePhase")
        await_reason = final.get("awaitReason")
        goal_status = (final.get("goal") or {}).get("status")
    else:
        phase = getattr(final, "runtimePhase", None)
        await_reason = getattr(final, "awaitReason", None)
        goal = getattr(final, "goal", {}) or {}
        goal_status = goal.get("status") if isinstance(goal, dict) else None

    assert await_reason != "max_repeat_guard", f"stalled: {await_reason}"
    assert phase == "done" or goal_status == "clear", (
        f"golden path must converge, got phase={phase} await={await_reason} goal={goal_status}"
    )
