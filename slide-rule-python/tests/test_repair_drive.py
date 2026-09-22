"""E26 缺口修复轮：选材只挑门标红项 / 瞬时故障分类器 / repair 模式驱动。

- pick_repair_capabilities：开放缺口 + 合约缺失 + 接地不足 → 对应能力；
  全部关闭时返回空（没什么可修就不修）。
- transient_blocked_signal：blocked + 超时/连接类报错 → True；
  结果不相关（无报错）→ False（自动补救只救瞬时故障）。
- drive_full_v5_session_stream(repair=True)：不碰启发式选材
  （pick_next_capabilities 被调用即失败），只执行修复选材。
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402
from services.engine_scheduling import pick_repair_capabilities  # noqa: E402
from services.v5_full_driver import transient_blocked_signal  # noqa: E402

GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


# ---------- pick_repair_capabilities ----------

def test_repair_picks_only_gate_red_items():
    state = _seeded_state("repair-picks")
    picks = pick_repair_capabilities(state)
    cap_ids = [p["capabilityId"] for p in picks]
    # 全新会话：合约要求项全缺 + 无接地证据 → evidence.search 必在
    assert "evidence.search" in cap_ids
    # 只来自合约/缺口，绝无启发式冷启动三件套之外的扩展项
    contract_reqs = set(state.coverageContract["requiredCapabilities"])
    assert set(cap_ids) <= contract_reqs | {"evidence.search"}
    assert len(cap_ids) == len(set(cap_ids))  # 无重复
    assert len(cap_ids) <= 5


def test_repair_picks_empty_when_nothing_to_repair(monkeypatch):
    state = _seeded_state("repair-none")
    for g in state.coverageGaps:
        g["status"] = "resolved"
    import services.slide_rule_coverage as cov

    monkeypatch.setattr(
        cov, "evaluate_coverage_gate",
        lambda st, selected=None, existing_contract=None: {
            "passed": True, "missingCapabilities": [], "unresolvedGaps": [],
            "waivedGaps": [], "reason": "ok",
        },
    )
    monkeypatch.setattr(cov, "has_grounded_external_evidence", lambda st: True)
    assert pick_repair_capabilities(state) == []


# ---------- transient_blocked_signal ----------

def _blocked_state(*, run_error: str = "", blocker_ref: str = "") -> V5SessionState:
    state = _seeded_state("transient")
    blockers = []
    if blocker_ref:
        blockers.append({
            "code": "LLM_GENERATE_FAILED",
            "path": "llmGenerate.fiveSystemModel",
            "affectedSkill": "",
            "ref": blocker_ref,
        })
    state.publishClosure = {"blocked": True, "blockers": blockers}
    if run_error:
        state.capabilityRuns = [{
            "id": "run-x", "capabilityId": "evidence.search", "turnId": "loop-0",
            "error": {"code": "capability_execution_failed", "message": run_error},
        }]
    return state


def test_transient_signal_on_timeout_error():
    assert transient_blocked_signal(_blocked_state(run_error="request timed out after 600000ms")) is True


def test_transient_signal_on_llm_gateway_blocker():
    assert transient_blocked_signal(_blocked_state(blocker_ref="connection reset by peer")) is True


def test_no_transient_signal_when_evidence_merely_irrelevant():
    # 检索成功但结果不相关：没有报错、没有瞬时故障样貌 → 不自动补救
    assert transient_blocked_signal(_blocked_state()) is False


def test_no_transient_signal_when_not_blocked():
    state = _seeded_state("not-blocked")
    state.publishClosure = {"blocked": False, "blockers": []}
    state.capabilityRuns = [{
        "id": "run-x", "capabilityId": "evidence.search", "turnId": "loop-0",
        "error": {"code": "capability_execution_failed", "message": "timed out"},
    }]
    assert transient_blocked_signal(state) is False


# ---------- repair 模式驱动 ----------

class _StubExecutor:
    def __init__(self):
        self.executed = []

    def __call__(self, cap, state, input_ids, role, turn_id):
        self.executed.append(cap)
        return {
            "title": f"{cap} (stub)",
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [{"content": "evidence", "source": "internal-policy-v1", "id": "e1"}],
        }


def test_repair_drive_never_consults_heuristic_pick(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    import services.v5_full_driver as driver_mod

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: s)
    stub = _StubExecutor()
    monkeypatch.setattr(driver_mod, "execute_v5_capability", stub)

    def _forbidden(*_a, **_k):
        raise AssertionError("repair 模式不得走启发式选材 pick_next_capabilities")

    monkeypatch.setattr(driver_mod, "pick_next_capabilities", _forbidden)

    state = _seeded_state("repair-drive")
    repair_picks = {p["capabilityId"] for p in pick_repair_capabilities(state)}
    assert repair_picks  # 前置：确实有缺口可修

    async def scenario():
        events = []
        async for ev in driver_mod.drive_full_v5_session_stream(
            state, max_loops=10, user_instruction=GOAL, repair=True
        ):
            events.append(ev)
        return events

    events = asyncio.run(scenario())

    # 修复轮标记随首个 phase_change 透出
    assert events[0]["type"] == "phase_change" and events[0].get("repair") is True
    # 执行的轮内能力 ⊆ 修复选材（闭环重建的 appbundle.runtimeClosure 除外）
    round_caps = {c for c in stub.executed if c != "appbundle.runtimeClosure"}
    assert round_caps, "修复轮应真的执行了缺口能力"
    assert round_caps <= repair_picks, f"越界执行: {round_caps - repair_picks}"
    # 流以 complete 收尾（正常落定，不是 error）
    assert events[-1]["type"] == "complete"
