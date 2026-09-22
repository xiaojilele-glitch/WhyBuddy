"""SLIDERULE_PARALLEL_CAPS: parallel execute + deterministic sequential commit.

The drive loop's per-capability provider calls are independent; parallel mode
overlaps them but MUST commit in the original selection order, so artifacts,
capabilityRuns and dependencyGraph execution-chain edges are identical to the
serial reference path (the flag-off path, which stays byte-for-byte intact).

Covers:
  (a) parallel mode produces identical artifacts/runs/ordering as serial for a
      multi-cap turn, with a stubbed executor that sleeps different durations
      per cap to force out-of-order completion (and proves real overlap);
  (b) one capability raising does not sink the batch — the errored run is
      recorded like today (record_capability_run_error) and the other caps'
      commits still land;
  (c) flag off -> serial path (no concurrency, no parallel timing marker);
  (d) stream driver keeps step-event pairing coherent (all reasoning_step
      events precede the reasoning_step_result events of the batch);
  (e) settings default is ON.
"""
import asyncio
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402

COMPLEX_GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"


class _ConcurrencyProbe:
    """Stub executor: per-cap sleeps chosen so the FIRST submitted capability
    finishes LAST, forcing out-of-order completion in parallel mode. Tracks the
    maximum number of concurrently running executions."""

    def __init__(self, fail_caps=None):
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.started_order = []
        self.finished_order = []
        self.fail_caps = set(fail_caps or [])

    def __call__(self, cap, state, input_ids, role, turn_id):
        with self.lock:
            idx = len(self.started_order)
            self.started_order.append(cap)
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        # earlier submission -> longer sleep (0.4s, 0.3s, 0.2s, ...)
        time.sleep(max(0.05, 0.4 - 0.1 * idx))
        with self.lock:
            self.active -= 1
            self.finished_order.append(cap)
        if cap in self.fail_caps:
            raise RuntimeError(f"boom in {cap}")
        return {
            "title": f"{cap} (stub)",
            "summary": f"{cap} done",
            "content": f"executed {cap} with real output",
            "provenance": "python-rag",
            "sources": [{"content": "evidence", "source": "internal-policy-v1", "id": "rbac1"}],
        }


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(
        sessionId=session_id,
        goal={"text": COMPLEX_GOAL},
        artifacts=[],
    )
    authored = author_coverage_contract(COMPLEX_GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    import services.v5_full_driver as driver_mod

    # persistence writes are irrelevant here; keep the run hermetic + fast
    # ⚠ 2026-08-27：PR-8(M14) 起 persist_state 必须返回 {"ok": True} 的 dict，
    #   否则能力结束落 pendingRuns 判为写失败并 fail-closed 中止本轮。
    #   `lambda s: s` 会让驱动器跑完第一个能力就退出。
    monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
    return driver_mod


def _drive(driver_mod, probe, session_id, parallel, monkeypatch, max_loops=1):
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "true" if parallel else "false")
    monkeypatch.setattr(driver_mod, "execute_v5_capability", probe)
    state = _seeded_state(session_id)
    return driver_mod.drive_full_v5_session(state, max_loops=max_loops, user_instruction=COMPLEX_GOAL)


def _run_fingerprint(state):
    out = []
    for r in state.capabilityRuns:
        rid = r.get("id") if isinstance(r, dict) else r.id
        cap = r.get("capabilityId") if isinstance(r, dict) else r.capabilityId
        err = (r.get("error") if isinstance(r, dict) else r.error) or None
        out.append((rid, cap, (err or {}).get("code")))
    return out


def _artifact_fingerprint(state):
    out = []
    for a in state.artifacts:
        get = a.get if isinstance(a, dict) else lambda k, _a=a: getattr(_a, k, None)
        prod = get("producedBy")
        prod_cap = prod.get("capabilityId") if isinstance(prod, dict) else getattr(prod, "capabilityId", None)
        out.append((get("id"), get("kind"), get("content"), get("summary"), get("trustLevel"), prod_cap))
    return out


def _dep_fingerprint(state):
    out = []
    for e in state.dependencyGraph or []:
        get = e.get if isinstance(e, dict) else lambda k, _e=e: getattr(_e, k, None)
        out.append((get("fromArtifactId"), get("toArtifactId"), get("reason")))
    return out


def test_parallel_matches_serial_byte_identical_ordering(driver, monkeypatch):
    serial_probe = _ConcurrencyProbe()
    serial_state = _drive(driver, serial_probe, "par-serial", parallel=False, monkeypatch=monkeypatch)

    parallel_probe = _ConcurrencyProbe()
    parallel_state = _drive(driver, parallel_probe, "par-parallel", parallel=True, monkeypatch=monkeypatch)

    # multi-cap first turn (contract seeds >= 4 picks) and forced out-of-order completion
    first_loop_caps = [c for c in parallel_probe.started_order if c != "appbundle.runtimeClosure"]
    assert len(set(first_loop_caps)) >= 3, first_loop_caps
    assert parallel_probe.finished_order != parallel_probe.started_order, (
        "stub sleeps must force out-of-order completion to make the ordering assertion meaningful"
    )
    # real overlap happened in parallel mode; serial reference never overlaps
    assert parallel_probe.max_active >= 2
    assert serial_probe.max_active == 1

    # deterministic commit: artifacts / runs / dependencyGraph identical to serial
    assert _artifact_fingerprint(parallel_state) == _artifact_fingerprint(serial_state)
    assert _run_fingerprint(parallel_state) == _run_fingerprint(serial_state)
    assert _dep_fingerprint(parallel_state) == _dep_fingerprint(serial_state)

    # timing telemetry: parallel runs carry the attributable marker
    batch_runs = [
        r for r in parallel_state.capabilityRuns
        if (r.timing or {}).get("durationMs") is not None and r.capabilityId != "appbundle.runtimeClosure"
    ]
    assert batch_runs and all((r.timing or {}).get("parallel") is True for r in batch_runs)
    # per-loop wall duration event exists and is attributable
    timing_events = [
        e for e in parallel_state.reasoningEvents or []
        if getattr(e, "kind", None) == "think" and "loop_timing:" in (getattr(e, "text", "") or "")
    ]
    assert timing_events and "parallel=true" in timing_events[0].text

    # visibility: every capability_start precedes every capability_complete of loop 0
    ev = [e for e in parallel_state.reasoningEvents if getattr(e, "turnId", "") == "loop-0"]
    kinds = [e.kind for e in ev]
    starts = [i for i, k in enumerate(kinds) if k == "capability_start"]
    completes = [i for i, k in enumerate(kinds) if k == "capability_complete"]
    assert starts and completes and max(starts) < min(completes)


def test_one_capability_error_does_not_sink_the_batch(driver, monkeypatch):
    probe = _ConcurrencyProbe(fail_caps={"risk.analyze"})
    state = _drive(driver, probe, "par-error", parallel=True, monkeypatch=monkeypatch)

    runs = {(r.get("capabilityId") if isinstance(r, dict) else r.capabilityId): r for r in state.capabilityRuns}
    failed = runs.get("risk.analyze")
    assert failed is not None
    err = failed.get("error") if isinstance(failed, dict) else failed.error
    assert (err or {}).get("code") == "capability_execution_failed"
    timing = failed.get("timing") if isinstance(failed, dict) else failed.timing
    assert (timing or {}).get("parallel") is True

    # other caps of the batch still committed artifacts
    produced = {p[5] for p in _artifact_fingerprint(state)}
    committed_others = produced - {None, "risk.analyze", "appbundle.runtimeClosure"}
    assert committed_others, produced
    assert "risk.analyze" not in produced
    assert "degraded cap risk.analyze" in (state.awaitDetail or "")


def test_flag_off_takes_serial_path_unchanged(driver, monkeypatch):
    probe = _ConcurrencyProbe()
    state = _drive(driver, probe, "par-off", parallel=False, monkeypatch=monkeypatch)

    assert probe.max_active == 1  # never concurrent
    # serial reference path: timing has no parallel marker, no loop_timing event
    for r in state.capabilityRuns:
        timing = r.get("timing") if isinstance(r, dict) else r.timing
        assert "parallel" not in (timing or {})
    assert not any(
        "loop_timing:" in (getattr(e, "text", "") or "") for e in state.reasoningEvents or []
    )


def test_stream_driver_parallel_step_event_pairing(driver, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "true")
    probe = _ConcurrencyProbe()
    monkeypatch.setattr(driver, "execute_v5_capability", probe)
    state = _seeded_state("par-stream")

    async def _collect():
        events = []
        async for ev in driver.drive_full_v5_session_stream(state, max_loops=1, user_instruction=COMPLEX_GOAL):
            events.append(ev)
        return events

    events = asyncio.run(_collect())
    assert probe.max_active >= 2

    # 2026-08-04：选材那一步自己也会发一对 planning 事件（它是整条链上最长的
    # 一段静默，20~26s，此前完全没有事件）。它**不属于能力批次**，所以这里先
    # 把它摘掉——下面那条"批内全部先报再出结果"针对的是能力批次的可见性，
    # 不是"整条流里第一个 result 之前不许有别的东西"。
    #
    # 摘之前先确认它确实成对出现：漏掉收尾的话前端那一条会一直转到下一批
    # capability_start 才被顶掉，看着像卡在 planning。
    planning_types = [
        e["type"] for e in events
        if e.get("label") == "planning" and e["type"] in ("reasoning_step", "reasoning_step_result")
    ]
    assert planning_types.count("reasoning_step") == planning_types.count("reasoning_step_result")
    assert planning_types.count("reasoning_step") >= 1

    cap_events = [
        e for e in events
        if e["type"] in ("reasoning_step", "reasoning_step_result") and e.get("label") != "planning"
    ]
    step_types = [e["type"] for e in cap_events]
    n_steps = step_types.count("reasoning_step")
    n_results = step_types.count("reasoning_step_result")
    assert n_steps == n_results and n_steps >= 3
    # batch visibility: all steps announced before any result of the batch
    first_result = step_types.index("reasoning_step_result")
    assert all(t == "reasoning_step" for t in step_types[:first_result])
    assert first_result == n_steps
    # per-cap result labels match the announced steps (pairing coherent)
    step_labels = [e["label"] for e in cap_events if e["type"] == "reasoning_step"]
    result_labels = [e["label"] for e in cap_events if e["type"] == "reasoning_step_result"]
    assert step_labels == result_labels
    # skill_start/skill_result closure walk still paired 1:1 in order
    skill_seq = [(e["type"], e.get("skill")) for e in events if e["type"] in ("skill_start", "skill_result")]
    assert len(skill_seq) % 2 == 0
    for i in range(0, len(skill_seq), 2):
        assert skill_seq[i][0] == "skill_start" and skill_seq[i + 1][0] == "skill_result"
        assert skill_seq[i][1] == skill_seq[i + 1][1]


def test_settings_default_is_parallel_on(monkeypatch):
    monkeypatch.delenv("SLIDERULE_PARALLEL_CAPS", raising=False)
    import config.settings as settings_mod
    from config.settings import Settings

    fresh = Settings(_env_file=None)
    assert fresh.SLIDERULE_PARALLEL_CAPS is True
    # the module singleton may have been instantiated under an earlier test's env;
    # pin a fresh instance so we assert the real default-fallback semantics
    monkeypatch.setattr(settings_mod, "settings", fresh)
    import services.v5_full_driver as driver_mod

    assert driver_mod._parallel_caps_enabled() is True
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    assert driver_mod._parallel_caps_enabled() is False
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "0")
    assert driver_mod._parallel_caps_enabled() is False
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "true")
    assert driver_mod._parallel_caps_enabled() is True
