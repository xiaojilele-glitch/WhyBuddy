
from plan_approval_support import approved_execution_payload
import json
import threading

import pytest

from conftest import TEST_USER_ID

from models.v5_state import V5SessionState
from services.persistence import (
    delete_session_record,
    load_all,
    load_session_record,
    list_session_records,
    save_session_record,
)


def make_state(session_id: str, goal_text: str = "persist contract") -> V5SessionState:
    return V5SessionState(
        sessionId=session_id,
        goal={"text": goal_text, "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
    )


def test_session_state_roundtrips_python_runtime_closure_projection():
    state = V5SessionState.server_load(
        {
            "sessionId": "runtime-closure-roundtrip",
            "goal": {"text": "purchase approval"},
            "publishClosure": {
                "blocked": False,
                "evidencePresentCount": 6,
                "skillCount": 6,
            },
            "skillRuntimeGraph": {
                "edges": [
                    {
                        "sourceSkill": "datamodel",
                        "targetSkill": "page",
                        "state": "allowed",
                        "evidenceKey": "DM_PAGE_BINDING_IMPACT_EVIDENCE",
                    }
                ],
                "bySkill": {},
                "evidenceBySkill": {},
            },
        }
    )

    dumped = state.model_dump()

    assert dumped["publishClosure"]["evidencePresentCount"] == 6
    assert dumped["skillRuntimeGraph"]["edges"][0]["sourceSkill"] == "datamodel"


def test_session_state_accepts_drive_full_max_loops_await_reason():
    for reason in ["max_loops", "max_repeat_guard", "no_progress"]:
        state = V5SessionState(sessionId=f"{reason}-await", goal={"text": "g"}, awaitReason=reason)

        assert state.awaitReason == reason


def test_same_turn_save_merges_runtime_projection_fields(tmp_path):
    store_file = tmp_path / "sessions.json"
    prior = make_state("projection-merge", "prior")
    prior.lastTurnId = "turn-100"
    save_session_record(prior, store_file=store_file)

    incoming = make_state("projection-merge", "incoming")
    incoming.lastTurnId = "turn-100"
    incoming.publishClosure = {"blocked": True, "evidencePresentCount": 0, "skillCount": 6}
    incoming.skillRuntimeGraph = {
        "edges": [
            {
                "sourceSkill": "datamodel",
                "targetSkill": "page",
                "state": "allowed",
                "evidenceKey": "DM_PAGE_BINDING_IMPACT_EVIDENCE",
            }
        ],
        "bySkill": {},
        "evidenceBySkill": {},
    }

    save_session_record(incoming, store_file=store_file)
    loaded = load_session_record("projection-merge", store_file=store_file)["session"]

    assert loaded.goal["text"] == "prior"
    assert loaded.publishClosure["skillCount"] == 6
    assert loaded.skillRuntimeGraph["edges"][0]["targetSkill"] == "page"


def test_save_load_and_list_use_node_compatible_store_shape(tmp_path):
    store_file = tmp_path / "sessions.json"
    state = make_state("py-contract-001")

    saved = save_session_record(state, store_file=store_file)

    assert saved == {"ok": True, "sessionId": "py-contract-001"}
    raw = json.loads(store_file.read_text(encoding="utf-8"))
    assert isinstance(raw, list)
    assert raw[0][0] == "py-contract-001"
    assert raw[0][1]["sessionId"] == "py-contract-001"

    loaded = load_session_record("py-contract-001", store_file=store_file)
    assert loaded["ok"] is True
    assert loaded["session"].sessionId == "py-contract-001"

    listed = list_session_records(store_file=store_file)
    assert listed["ok"] is True
    assert len(listed["sessions"]) == 1
    entry = listed["sessions"][0]
    # 落盘时 sidecar meta 盖 createdAt/lastActive 章（侧栏"最近"排序数据源）
    assert entry["createdAt"] and entry["lastActive"]
    assert {k: v for k, v in entry.items() if k not in ("createdAt", "lastActive")} == {
        "sessionId": "py-contract-001",
        "goal": "persist contract",
        "artifactCount": 0,
        "phase": None,
    }

    deleted = delete_session_record("py-contract-001", store_file=store_file)
    assert deleted == {"ok": True, "sessionId": "py-contract-001"}
    assert load_session_record("py-contract-001", store_file=store_file) == {
        "ok": False,
        "error": "not_found",
        "sessionId": "py-contract-001",
    }
    assert json.loads(store_file.read_text(encoding="utf-8")) == []


def test_missing_session_returns_node_compatible_not_found_shape(tmp_path):
    store_file = tmp_path / "sessions.json"

    result = load_session_record("missing-session", store_file=store_file)

    assert result == {
        "ok": False,
        "error": "not_found",
        "sessionId": "missing-session",
    }


def test_session_state_accepts_untrusted_artifacts_from_frontend_runtime(tmp_path):
    store_file = tmp_path / "sessions-untrusted.json"
    state = V5SessionState(
        sessionId="py-untrusted-001",
        goal={"text": "persist untrusted artifact", "status": "needs_refinement"},
        artifacts=[
            {
                "id": "art-untrusted-001",
                "kind": "evidence",
                "provenance": "llm_fallback",
                "trustLevel": "untrusted",
                "passedGates": [],
                "content": "failed grounding should remain auditable",
            }
        ],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
    )

    saved = save_session_record(state, store_file=store_file)
    loaded = load_session_record("py-untrusted-001", store_file=store_file)

    assert saved == {"ok": True, "sessionId": "py-untrusted-001"}
    assert loaded["ok"] is True
    assert loaded["session"].artifacts[0].trustLevel == "untrusted"


def test_corrupt_store_returns_stable_error_shape_for_load_and_list(tmp_path):
    store_file = tmp_path / "sessions.json"
    store_file.write_text("{not-json", encoding="utf-8")

    loaded = load_session_record("py-corrupt", store_file=store_file)
    listed = list_session_records(store_file=store_file)

    assert loaded["ok"] is False
    assert loaded["error"] == "store_corrupt"
    assert loaded["reason"] == "invalid_json"
    assert loaded["sessionId"] == "py-corrupt"
    assert listed["ok"] is False
    assert listed["error"] == "store_corrupt"
    assert listed["reason"] == "invalid_json"


def test_load_all_accepts_legacy_python_mapping_shape(tmp_path):
    store_file = tmp_path / "legacy-python-sessions.json"
    state = make_state("py-legacy-001", goal_text="legacy mapping")
    store_file.write_text(
        json.dumps({"py-legacy-001": state.model_dump()}),
        encoding="utf-8",
    )

    sessions = load_all(store_file=store_file)

    assert list(sessions.keys()) == ["py-legacy-001"]
    assert sessions["py-legacy-001"].goal["text"] == "legacy mapping"


# Focused coverage for task goal: Python session API responses must explicitly
# report stateAuthority: "python" + normalized provenance + backend.
# Exercises the actual route handlers (create_sess/get_sess/save_sess/delete_sess/drive)
# via FastAPI TestClient so the assertions are coupled to the Python-owned
# implementation in slide-rule-python/routes/sliderule_full.py (addresses review finding).

def test_python_session_responses_report_state_authority_and_normalized_fields(monkeypatch):
    try:
        from fastapi.testclient import TestClient
        from app import app
        from routes.sliderule_full import (
            STATE_AUTHORITY_PYTHON,
            PROVENANCE_PYTHON_FULLPATH,
            PROVENANCE_PYTHON_RAG,
            PYTHON_BACKEND,
        )
    except Exception as e:
        pytest.skip(f"app or routes.sliderule_full import failed (install requirements.txt first): {e}")

    client = TestClient(app)
    INTERNAL_KEY = "dev-slide-rule-internal"
    headers = {"X-Internal-Key": INTERNAL_KEY}

    # create
    create_resp = client.post(
        "/api/sliderule/sessions",
        json={"goal": {"text": "env test"}, "sessionId": "env-sess-001"},
        headers=headers,
    )
    assert create_resp.status_code == 200
    create_env = create_resp.json()

    # get
    get_resp = client.get("/api/sliderule/sessions/env-sess-001", headers=headers)
    assert get_resp.status_code == 200
    get_env = get_resp.json()

    # save (PUT uses V5SessionState body)
    state_body = {
        "sessionId": "env-sess-001",
        "goal": {"text": "env test"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "conversation": [],
    }
    save_resp = client.put(
        "/api/sliderule/sessions/env-sess-001", json=state_body, headers=headers
    )
    assert save_resp.status_code == 200
    save_env = save_resp.json()

    # delete success
    del_resp = client.delete("/api/sliderule/sessions/env-sess-001", headers=headers)
    assert del_resp.status_code == 200
    delete_env = del_resp.json()

    # delete not-found (route returns 200 + ok for not_found case per impl)
    del_not_resp = client.delete("/api/sliderule/sessions/env-sess-999", headers=headers)
    assert del_not_resp.status_code == 200
    delete_notfound = del_not_resp.json()

    # drive-turn (the drive handler)
    # Patch orchestrate inside drive_reasoning_turn to return empty selected.
    # This avoids constructing Artifacts with server-only trustLevel="gated_pass"
    # (the elevation guard from prior artifact contract work; out of scope for this envelope test).
    # We still exercise the /drive-turn route + its envelope return.
    from services.slide_rule_orchestrator import OrchestratePlanResult

    def fake_orchestrate(state, turn_id, user_text):
        return OrchestratePlanResult(selected=[], rationale="env-test-no-op", converged=True)

    monkeypatch.setattr("services.slide_rule_session.orchestrate_plan", fake_orchestrate)

    drive_payload = {
        "state": {
            "sessionId": "env-drive-001",
            "goal": {"text": "drive"},
            "artifacts": [],
            "capabilityRuns": [],
            "coverageGaps": [],
            "conversation": [],
        },
        "turnId": "env-t1",
        "userText": "",
    }
    drive_resp = client.post("/api/sliderule/drive-turn", json=approved_execution_payload(drive_payload), headers=headers)
    assert drive_resp.status_code == 200
    drive_env = drive_resp.json()

    # Assert the envelopes returned by the actual Python route handlers.
    for env in [create_env, get_env, save_env, delete_env, delete_notfound, drive_env]:
        assert (
            env.get("stateAuthority") == STATE_AUTHORITY_PYTHON
        ), "session envelope must report stateAuthority: python for PYTHON_AUTHORITY"
        assert env.get("provenance") in (
            PROVENANCE_PYTHON_FULLPATH,
            PROVENANCE_PYTHON_RAG,
        ), "normalized provenance required"
        assert env.get("backend") == PYTHON_BACKEND, "normalized backend required"

    # Also assert the imported constants (no hidden Node fallback)
    assert STATE_AUTHORITY_PYTHON == "python"
    assert PYTHON_BACKEND == "python"


# Focused test for task: PUT /sessions/{sid} must sanitize/ignore client body for server-owned
# coverageGate, capabilityRuns, artifact trustLevel + server-owned ledgers (decisionLedger etc).
# Proves Python rejects forging stale/partial ledgers; uses direct route + TestClient; server values retained.
# Normal client parse would reject elevated artifacts; route accepts raw dict then sanitizes.
def test_put_sanitize_prevents_client_forging_coverageGate_trustLevel_capabilityRuns_and_ledgers(monkeypatch):
    try:
        from fastapi.testclient import TestClient
        from app import app
        from routes.sliderule_full import STATE_AUTHORITY_PYTHON, PYTHON_BACKEND
        import routes.sliderule_full as route_mod
        import services.slide_rule_session as sess_mod
        from models.v5_state import V5SessionState, Artifact, ProducedBy, CapabilityRun, SchedulingDecision, CapabilityCostRecord, FlowBoundaryCheck, StructureGateCheck
    except Exception as e:
        pytest.skip(f"imports for sanitize PUT test failed: {e}")

    client = TestClient(app)
    INTERNAL_KEY = "dev-slide-rule-internal"
    headers = {"X-Internal-Key": INTERNAL_KEY}
    sid = "put-sanitize-001"

    # Seed server-owned existing state with elevated trust artifact + runs + gate (using server path)
    trusted_artifact = Artifact.server_construct(
        id="art-server-1",
        kind="evidence",
        content="server evidence after gate",
        provenance="python-rag",
        trustLevel="gated_pass",
        passedGates=["ground"],
        producedBy=ProducedBy(capabilityRunId="run-s1", capabilityId="evidence.search", roleId="agent"),
        title="s",
        summary="s",
    )
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    dec_ledger = SchedulingDecision(id="d-ledger-1", turnId="t-s1", saw=["planA"], chose=["evidence.search"], createdAt=now)
    cost_ledger = CapabilityCostRecord(id="c-ledger-1", turnId="t-s1", capabilityRunId="run-s1", capabilityId="evidence.search", source="estimated", createdAt=now)
    flow_ledger = FlowBoundaryCheck(id="f-ledger-1", turnId="t-s1", source="brainstorm", passed=True, createdAt=now)
    struct_ledger = StructureGateCheck(id="s-ledger-1", turnId="t-s1", runId="run-s1", gateId="structure", status="passed", createdAt=now)
    server_state = V5SessionState(
        sessionId=sid,
        goal={"text": "sanitize goal", "status": "needs_refinement"},
        # 归属必须写上：会话恒为 private，无主的只有超管读得到 —— 这几条测的是
        # PUT 的清洗/防覆盖/并发守卫，不是"匿名能不能读别人的会话"。
        ownerId=TEST_USER_ID,
        artifacts=[trusted_artifact],
        capabilityRuns=[
            CapabilityRun(id="run-s1", capabilityId="evidence.search", turnId="t-s1", outputs=["art-server-1"], gateResults=[{"gateId": "ground", "status": "passed"}])
        ],
        coverageGate={"passed": True, "version": "v5.2", "gapsResolved": 5},
        coverageGaps=[],
        conversation=[],
        decisionLedger=[dec_ledger],
        costLedger=[cost_ledger],
        flowBoundaryLedger=[flow_ledger],
        structureGateLedger=[struct_ledger],
    )
    # Seed both module caches so load_session and route get see the trusted existing
    sess_mod._sessions[sid] = server_state
    route_mod._sessions[sid] = server_state

    # Client attempts to forge all three via PUT body (simulates malicious or stale client payload)
    forge_body = {
        "sessionId": sid,
        "goal": {"text": "client mutated goal"},
        "artifacts": [
            {"id": "art-forged", "content": "forged", "trustLevel": "audited", "producedBy": {"capabilityRunId": "f", "capabilityId": "f"}, "passedGates": ["x"]}
        ],
        "capabilityRuns": [{"id": "run-forged", "capabilityId": "forge.cap"}],
        "coverageGate": {"passed": False, "reason": "client-forged-low"},
        "conversation": [{"role": "user", "text": "client said", "turnId": "c1"}],
        "decisionLedger": [{"id": "client-d", "chose": ["bad"]}],
        "costLedger": [{"id": "client-c"}],
        "flowBoundaryLedger": [{"id": "client-f"}],
        "structureGateLedger": [{"id": "client-s"}],
    }
    put_resp = client.put(f"/api/sliderule/sessions/{sid}", json=forge_body, headers=headers)
    assert put_resp.status_code == 200, "PUT must succeed (sanitized internally)"
    put_env = put_resp.json()
    assert put_env.get("stateAuthority") == STATE_AUTHORITY_PYTHON

    # Verify via GET (Python route) that server values retained, client updates applied only to safe fields
    get_resp = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert get_resp.status_code == 200
    got_state = get_resp.json()["state"]

    # coverageGate retained from server, not forged
    assert got_state.get("coverageGate") == {"passed": True, "version": "v5.2", "gapsResolved": 5}
    # capabilityRuns retained from server
    assert len(got_state.get("capabilityRuns", [])) == 1
    assert got_state["capabilityRuns"][0]["id"] == "run-s1"
    assert got_state["capabilityRuns"][0].get("capabilityId") == "evidence.search"
    # artifacts retain server trustLevel (client forge stripped)
    assert len(got_state.get("artifacts", [])) == 1
    assert got_state["artifacts"][0]["id"] == "art-server-1"
    assert got_state["artifacts"][0]["trustLevel"] == "gated_pass"
    assert got_state["artifacts"][0].get("producedBy") is not None
    # server-owned ledgers retained from server, client stale/partial ignored
    assert len(got_state.get("decisionLedger", [])) == 1
    assert got_state["decisionLedger"][0]["id"] == "d-ledger-1"
    assert got_state["decisionLedger"][0]["chose"] == ["evidence.search"]
    assert len(got_state.get("costLedger", [])) == 1
    assert got_state["costLedger"][0]["id"] == "c-ledger-1"
    assert len(got_state.get("flowBoundaryLedger", [])) == 1
    assert got_state["flowBoundaryLedger"][0]["id"] == "f-ledger-1"
    assert len(got_state.get("structureGateLedger", [])) == 1
    assert got_state["structureGateLedger"][0]["id"] == "s-ledger-1"
    # safe client fields updated
    assert got_state["goal"]["text"] == "client mutated goal"
    assert len(got_state.get("conversation", [])) == 1
    assert got_state.get("coverageGaps", []) == []  # no fake gap from client applied over

    # cleanup
    client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    sess_mod._sessions.pop(sid, None)
    route_mod._sessions.pop(sid, None)


# Focused replay append-only merge + readback tests for this task (sliderule-python-v52-session-replay-append-only-105).
# Direct use of persistence save/load (Python-owned) + TestClient for route PUT protection.
# Proves: save never clobbers prior replay, readback returns full replay, PUT client replay ignored.
# Classification exercised: PYTHON_AUTHORITY for append-only save/read of replay.

def test_persistence_save_merges_replay_append_only_and_readback_returns_full_log(tmp_path):
    """Direct pytest on persistence proves append-only merge on save and replay readback."""
    from models.v5_state import V5SessionState, SlideRuleReplayEvent
    from services import persistence as pers

    store_file = tmp_path / "replay-merge.json"
    sid = "replay-merge-001"

    replay1 = SlideRuleReplayEvent(
        id="rep-1", sessionId=sid, at="2026-07-02T00:00:01Z", kind="conversation", turnId="t1", conversationId="c1"
    )
    state1 = V5SessionState(
        sessionId=sid,
        goal={"text": "replay merge test", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[{"role": "user", "text": "hi", "turnId": "t1"}],
        sessionReplayLog=[replay1],
        reasoningEvents=[],
    )

    # first save with replay
    res = pers.save_session_record(state1, store_file=store_file)
    assert res == {"ok": True, "sessionId": sid}

    # readback
    loaded1 = pers.load_session_record(sid, store_file=store_file)
    assert loaded1["ok"] is True
    assert len(loaded1["session"].sessionReplayLog) == 1
    assert loaded1["session"].sessionReplayLog[0].id == "rep-1"

    # now save a partial state with empty replay (simulates stale client or partial snapshot)
    state_partial = V5SessionState(
        sessionId=sid,
        goal={"text": "partial no replay", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    pers.save_session_record(state_partial, store_file=store_file)

    # readback must still have prior replay (append-only merge, no clobber)
    loaded2 = pers.load_session_record(sid, store_file=store_file)
    assert loaded2["ok"] is True
    assert len(loaded2["session"].sessionReplayLog) == 1
    assert loaded2["session"].sessionReplayLog[0].id == "rep-1"
    # goal updated but replay preserved
    assert loaded2["session"].goal["text"] == "partial no replay"


def test_put_does_not_overwrite_server_replay_via_client_body(monkeypatch):
    """PUT sanitize excludes replay; existing server replay preserved (like ledgers)."""
    try:
        from fastapi.testclient import TestClient
        from app import app
        from routes.sliderule_full import STATE_AUTHORITY_PYTHON
        import routes.sliderule_full as route_mod
        import services.slide_rule_session as sess_mod
        from models.v5_state import V5SessionState, SlideRuleReplayEvent
    except Exception as e:
        pytest.skip(f"imports for replay PUT test failed: {e}")

    client = TestClient(app)
    INTERNAL_KEY = "dev-slide-rule-internal"
    headers = {"X-Internal-Key": INTERNAL_KEY}
    sid = "put-replay-protect-001"

    # seed server state with replay (via direct module to bypass client path)
    replay_ev = SlideRuleReplayEvent(
        id="rep-s1", sessionId=sid, at="2026-07-02T00:00:10Z", kind="capability_run", turnId="t-s1", capabilityId="evidence.search"
    )
    server_state = V5SessionState(
        sessionId=sid,
        goal={"text": "replay put test", "status": "needs_refinement"},
        # 归属必须写上：会话恒为 private，无主的只有超管读得到 —— 这几条测的是
        # PUT 的清洗/防覆盖/并发守卫，不是"匿名能不能读别人的会话"。
        ownerId=TEST_USER_ID,
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        sessionReplayLog=[replay_ev],
        reasoningEvents=[],
    )
    sess_mod._sessions[sid] = server_state
    route_mod._sessions[sid] = server_state

    # client PUT tries to send empty or forged replay
    forge_body = {
        "sessionId": sid,
        "goal": {"text": "client changed"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "conversation": [],
        "sessionReplayLog": [{"id": "client-fake", "sessionId": sid, "at": "now", "kind": "conversation"}],
        "reasoningEvents": [{"id": "r-fake", "turnId": "x", "capabilityRunId": "x", "capabilityId": "x", "kind": "think", "text": "bad", "order": 0, "ts": "now"}],
    }
    put_resp = client.put(f"/api/sliderule/sessions/{sid}", json=forge_body, headers=headers)
    assert put_resp.status_code == 200

    # GET must retain server replay, ignore client replay
    get_resp = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert get_resp.status_code == 200
    get_env = get_resp.json()
    got = get_env["state"]
    assert get_env.get("stateAuthority") == STATE_AUTHORITY_PYTHON
    assert len(got.get("sessionReplayLog", [])) == 1
    assert got["sessionReplayLog"][0]["id"] == "rep-s1"
    assert got["sessionReplayLog"][0].get("capabilityId") == "evidence.search"
    # client fake not present
    assert not any(e.get("id") == "client-fake" for e in got.get("sessionReplayLog", []))
    assert len(got.get("reasoningEvents", [])) == 0

    # cleanup
    client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    sess_mod._sessions.pop(sid, None)
    route_mod._sessions.pop(sid, None)


# Focused pytest for sliderule-python-v52-session-delete-reset-contract-105 (SessionAuthority phase, seq 13/72).
# Directly locks the DELETE /api/sliderule/sessions/{sid} reset contract for browser reset behavior.
# Classification (per required impl step 1): before this task PYTHON_COMPAT (DELETE surface existed in route/service/persist + incidental envelope/not-found coverage in prior envelope test);
# after: PYTHON_AUTHORITY (Python owns the full reset: irrecoverable from persistence + both in-memory caches, GET 404 post-delete, repeated DELETE stable 200/ok idempotent).
# Proves no resurrection from service cache, route cache or disk. No Node fallback.
# This test uses the actual Python route handlers + direct module cache + persistence inspection (no mocks hiding semantics).
def test_delete_reset_contract_clears_persistence_service_route_caches_and_is_idempotent(monkeypatch):
    """DELETE reset contract:
    - post-DELETE GET returns 404
    - persistence record removed (load returns not_found)
    - service _sessions cache cleared
    - route _sessions cache cleared
    - repeated DELETE returns stable 200 + ok envelope (safe for browser reset calls)
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
        import routes.sliderule_full as route_mod
        import services.slide_rule_session as sess_mod
        from routes.sliderule_full import STATE_AUTHORITY_PYTHON, PYTHON_BACKEND
        from services.persistence import load_session_record
    except Exception as e:
        pytest.skip(f"imports for delete-reset contract test failed (ensure venv + app wiring): {e}")

    client = TestClient(app)
    INTERNAL_KEY = "dev-slide-rule-internal"
    headers = {"X-Internal-Key": INTERNAL_KEY}
    sid = "delete-reset-contract-001"

    # Create via route (populates service cache + persistence; since the stream-persistence fix
    # the route no longer writes its own _sessions on create/GET — durable writes go through
    # save_session so the authoritative store stays consistent; route _sessions is only written on PUT)
    create_resp = client.post(
        "/api/sliderule/sessions",
        json={"goal": {"text": "delete reset contract"}, "sessionId": sid},
        headers=headers,
    )
    assert create_resp.status_code == 200, "create must succeed for setup"

    # Pre-state: loadable from persistence and present in service cache
    pre_load = load_session_record(sid)
    assert pre_load.get("ok") is True, "session must be persisted before delete"
    assert sid in sess_mod._sessions, "service cache must contain sid before delete"
    # Seed the route cache manually (as a PUT save_sess would) so the
    # "DELETE clears the route cache" assertion below remains meaningful under the current contract.
    route_mod._sessions[sid] = sess_mod._sessions[sid]
    assert sid in route_mod._sessions, "route cache seeded (PUT-equivalent) before delete"

    # Pre GET succeeds
    pre_get = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert pre_get.status_code == 200

    # Perform DELETE (the browser reset action)
    del_resp = client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert del_resp.status_code == 200
    del_env = del_resp.json()
    assert del_env.get("ok") is True
    assert del_env.get("sessionId") == sid
    assert del_env.get("stateAuthority") == STATE_AUTHORITY_PYTHON
    assert del_env.get("backend") == PYTHON_BACKEND

    # 1. GET after delete returns 404 (reset state, no resurrection)
    post_get = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert post_get.status_code == 404, "GET after DELETE must 404 (reset state)"

    # 2. persistence record removed
    post_load = load_session_record(sid)
    assert post_load.get("ok") is False
    assert post_load.get("error") == "not_found"

    # 3. service cache cleared
    assert sid not in sess_mod._sessions, "service _sessions must be cleared after delete_session"

    # 4. route cache cleared
    assert sid not in route_mod._sessions, "route _sessions must be cleared after delete_sess"

    # 5. repeated DELETE is stable 200/ok (idempotent, browser reset can safely re-invoke)
    del2_resp = client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert del2_resp.status_code == 200
    del2_env = del2_resp.json()
    assert del2_env.get("ok") is True
    assert del2_env.get("stateAuthority") == STATE_AUTHORITY_PYTHON
    assert del2_env.get("backend") == PYTHON_BACKEND
    assert del2_env.get("sessionId") == sid


# Focused pytest for sliderule-python-v52-session-concurrency-guard-105 (SessionAuthority seq 14).
# Proves Python-owned guard: stale/older (by lastTurnId monotonic or counts) saves do not overwrite newer authoritative state.
# Direct persistence test + route PUT 409 conflict on stale.
# Classification: before PYTHON_COMPAT (replay merge only, unconditional overwrite); after PYTHON_AUTHORITY.
# No Node fallback; tests use real persistence + route handlers.

def test_persistence_guard_prevents_older_lastturn_from_overwriting_newer_state(tmp_path):
    """Direct persistence save: newer state saved first; older save attempt must not clobber goal/fields."""
    from services import persistence as pers
    from models.v5_state import V5SessionState

    store_file = tmp_path / "concurrency-guard.json"
    sid = "conc-guard-001"

    # Newer authoritative state (higher lastTurnId)
    newer = V5SessionState(
        sessionId=sid,
        goal={"text": "newer authoritative goal", "status": "needs_refinement"},
        # 归属必须写上：会话恒为 private，无主的只有超管读得到 —— 这几条测的是
        # PUT 的清洗/防覆盖/并发守卫，不是"匿名能不能读别人的会话"。
        ownerId=TEST_USER_ID,
        artifacts=[],
        capabilityRuns=[{"id": "r-new", "capabilityId": "x", "turnId": "t10"}],
        coverageGaps=[],
        conversation=[{"role": "user", "text": "new", "turnId": "t10"}],
        lastTurnId="t10",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    res1 = pers.save_session_record(newer, store_file=store_file)
    assert res1["ok"] is True

    loaded_new = pers.load_session_record(sid, store_file=store_file)
    assert loaded_new["ok"]
    assert loaded_new["session"].goal["text"] == "newer authoritative goal"
    assert loaded_new["session"].lastTurnId == "t10"

    # Stale/older state (lower turn) attempts overwrite with different goal
    older = V5SessionState(
        sessionId=sid,
        goal={"text": "stale old goal should be rejected", "status": "needs_refinement"},
        ownerId=newer.ownerId,
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t3",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    pers.save_session_record(older, store_file=store_file)

    loaded_after = pers.load_session_record(sid, store_file=store_file)
    assert loaded_after["ok"]
    # MUST retain newer authoritative
    assert loaded_after["session"].goal["text"] == "newer authoritative goal", "stale save must not overwrite newer goal"
    assert loaded_after["session"].lastTurnId == "t10"
    # capabilityRuns from newer preserved
    assert len(loaded_after["session"].capabilityRuns) == 1


def test_put_route_returns_409_on_stale_lastturn_and_does_not_overwrite(monkeypatch):
    """PUT with older lastTurnId must 409 conflict; state must retain newer from server."""
    try:
        from fastapi.testclient import TestClient
        from app import app
        import routes.sliderule_full as route_mod
        import services.slide_rule_session as sess_mod
        from models.v5_state import V5SessionState
    except Exception as e:
        pytest.skip(f"imports for put concurrency 409 test: {e}")

    client = TestClient(app)
    INTERNAL_KEY = "dev-slide-rule-internal"
    headers = {"X-Internal-Key": INTERNAL_KEY}
    sid = "put-stale-409-001"

    # Seed server state at higher turn (via service to have full)
    server_newer = V5SessionState(
        sessionId=sid,
        # 同上：无主会话谁都读不到，PUT 会先在归属判定上 404，根本走不到
        # 并发守卫那一步——而这条测的正是并发守卫。
        ownerId=TEST_USER_ID,
        goal={"text": "server-newer", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t20",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    sess_mod._sessions[sid] = server_newer
    route_mod._sessions[sid] = server_newer
    # also ensure persistence sees it
    from services.persistence import save_session_record
    save_session_record(server_newer)

    # Client sends stale older turn update
    stale_body = {
        "sessionId": sid,
        "goal": {"text": "client-stale-should-fail"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "conversation": [],
        "lastTurnId": "t5",
    }
    put_resp = client.put(f"/api/sliderule/sessions/{sid}", json=stale_body, headers=headers)
    assert put_resp.status_code == 409, "stale PUT must be rejected with 409"

    # Verify state not overwritten
    get_resp = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert get_resp.status_code == 200
    got = get_resp.json()["state"]
    assert got["goal"]["text"] == "server-newer"
    assert got["lastTurnId"] == "t20"

    # cleanup
    client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    sess_mod._sessions.pop(sid, None)
    route_mod._sessions.pop(sid, None)


def test_put_does_not_advance_last_turn_or_pin_stale_versions(monkeypatch):
    """过夜：落库失败后库是 mv-1/t1，前端 PUT 带 t99。合并若吃 lastTurnId，
    旧版本被钉在新 turn 上，下一轮守卫以为已经赶上。

    lastTurnId 必须留在服务端；409 仍拒更旧的 PUT（上一条）。
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
        import routes.sliderule_full as route_mod
        import services.slide_rule_session as sess_mod
        from models.v5_state import V5SessionState
        from services.persistence import save_session_record
    except Exception as e:
        pytest.skip(f"imports for put pin test: {e}")

    client = TestClient(app)
    headers = {"X-Internal-Key": "dev-slide-rule-internal"}
    sid = "put-pin-stale-001"
    server = V5SessionState(
        sessionId=sid,
        ownerId=TEST_USER_ID,
        goal={"text": "server-live", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t1",
        currentModelVersionId="mv-1",
        modelVersions=[{"id": "mv-1", "model": {"a": 1}}],
    )
    sess_mod._sessions[sid] = server
    route_mod._sessions[sid] = server
    save_session_record(server)

    put_resp = client.put(
        f"/api/sliderule/sessions/{sid}",
        json={
            "sessionId": sid,
            "goal": {"text": "client-should-not-move-turn"},
            "artifacts": [],
            "capabilityRuns": [],
            "coverageGaps": [],
            "conversation": [],
            "lastTurnId": "t99",
            "currentModelVersionId": "mv-1",
        },
        headers=headers,
    )
    assert put_resp.status_code == 200, put_resp.text
    get_resp = client.get(f"/api/sliderule/sessions/{sid}", headers=headers)
    assert get_resp.status_code == 200
    got = get_resp.json()["state"]
    assert got["lastTurnId"] == "t1", f"PUT 把 lastTurnId 推到了 {got['lastTurnId']}"
    assert got["currentModelVersionId"] == "mv-1"
    assert (got.get("modelVersions") or [{}])[0].get("id") == "mv-1"

    client.delete(f"/api/sliderule/sessions/{sid}", headers=headers)
    sess_mod._sessions.pop(sid, None)
    route_mod._sessions.pop(sid, None)


# Additional focused pytest for sliderule-python-v52-session-concurrency-guard-105 (review fix).
# Covers Finding 1: stale service-layer save_session() must not overwrite _sessions cache or load_session readable state.
# Uses the service save path (not only direct pers or route PUT), asserts cache + load + pers all retain newer.
# Classification: service save now delegates to guarded persistence then reconciles cache from authoritative result.

def test_service_save_session_prevents_stale_overwrite_of_cache_and_load(tmp_path):
    """Stale state passed to slide_rule_session.save_session must leave cache and load_session with newer authoritative state."""
    import sys
    sys.path.insert(0, str(tmp_path))  # no-op, just for pattern
    try:
        import services.slide_rule_session as sess_mod
        from services.persistence import save_session_record, load_session_record, delete_session_record
        from models.v5_state import V5SessionState
    except Exception as e:
        pytest.skip(f"imports for service save guard test: {e}")

    sid = "svc-save-stale-guard-001"
    # ensure clean (service save test uses default global store; robustly remove sid entry or corrupt file to avoid pollution from prior test runs)
    sess_mod._sessions.pop(sid, None)
    try:
        delete_session_record(sid)
    except Exception:
        pass
    # extra cleanup for default store file (delete may not cover corrupt json left by interrupted prior runs)
    try:
        import json
        from pathlib import Path
        ds = Path("data/sliderule-sessions.json")
        if ds.exists():
            try:
                raw = ds.read_text(encoding="utf-8")
                data = json.loads(raw) if raw.strip() else []
                if isinstance(data, list):
                    data = [e for e in data if not (isinstance(e, list) and len(e) == 2 and e[0] == sid)]
                    ds.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                try:
                    ds.unlink()
                except Exception:
                    pass
    except Exception:
        pass

    # Seed authoritative newer (higher lastTurnId + counts)
    newer = V5SessionState(
        sessionId=sid,
        goal={"text": "newer-service-authoritative", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[{"id": "r-svc", "capabilityId": "cap", "turnId": "t30"}],
        coverageGaps=[],
        conversation=[{"role": "user", "text": "n", "turnId": "t30"}],
        lastTurnId="t30",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    save_session_record(newer)
    sess_mod._sessions[sid] = newer

    # Now attempt stale save via the service API under test
    older = V5SessionState(
        sessionId=sid,
        goal={"text": "stale-via-save-session-must-be-ignored", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t4",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    returned = sess_mod.save_session(older)

    # 1. returned (if we propagate) and cache must be the newer
    assert returned is not None
    assert returned.goal["text"] == "newer-service-authoritative"
    assert returned.lastTurnId == "t30"
    assert sid in sess_mod._sessions
    assert sess_mod._sessions[sid].goal["text"] == "newer-service-authoritative"
    assert sess_mod._sessions[sid].lastTurnId == "t30"

    # 2. load_session (prefers cache but now synced) must return newer
    loaded = sess_mod.load_session(sid)
    assert loaded is not None
    assert loaded.goal["text"] == "newer-service-authoritative", "service load must not return stale after stale save_session"
    assert loaded.lastTurnId == "t30"

    # 3. pers disk must still be newer (guard + our reload)
    rec = load_session_record(sid)
    assert rec.get("ok")
    assert rec["session"].goal["text"] == "newer-service-authoritative"
    assert rec["session"].lastTurnId == "t30"

    # cleanup
    sess_mod.delete_session(sid)
    sess_mod._sessions.pop(sid, None)
    try:
        delete_session_record(sid)
    except Exception:
        pass


def test_persistence_guard_serialized_concurrent_saves_higher_key_wins(tmp_path):
    """True concurrent saves (threads) must not let lower/older key overwrite higher authoritative state.
    Uses _save_lock + re-read inside + monotonic <= compare to serialize decision.
    Proves fix for review finding 1 (concurrent RMW race) directly.
    """
    import threading
    from services import persistence as pers
    from models.v5_state import V5SessionState

    store_file = tmp_path / "conc-guard-concurrent.json"
    sid = "conc-guard-conc-001"

    def make_state(turn: str, goal_text: str, cap_count: int = 0) -> V5SessionState:
        caps = [{"id": f"r{i}", "capabilityId": "x", "turnId": turn} for i in range(cap_count)]
        return V5SessionState(
            sessionId=sid,
            goal={"text": goal_text, "status": "needs_refinement"},
            artifacts=[],
            capabilityRuns=caps,
            coverageGaps=[],
            conversation=[],
            lastTurnId=turn,
            decisionLedger=[],
            sessionReplayLog=[],
            reasoningEvents=[],
        )

    # Seed initial
    base = make_state("t1", "base", 1)
    assert pers.save_session_record(base, store_file=store_file)["ok"]

    results = []
    errors = []

    def saver(st: V5SessionState):
        try:
            res = pers.save_session_record(st, store_file=store_file)
            results.append(res)
        except Exception as ex:
            errors.append(str(ex))

    # Simulate concurrent: one higher key (newer), one lower at same time.
    newer = make_state("t10", "authoritative-higher-must-win", 3)
    older = make_state("t2", "stale-lower-must-lose", 0)

    t1 = threading.Thread(target=saver, args=(newer,))
    t2 = threading.Thread(target=saver, args=(older,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors, f"no errors in concurrent saves: {errors}"
    assert len(results) == 2

    # Regardless of thread order, final must be the higher key one
    final_rec = pers.load_session_record(sid, store_file=store_file)
    assert final_rec["ok"]
    final = final_rec["session"]
    assert final.lastTurnId == "t10"
    assert final.goal["text"] == "authoritative-higher-must-win"
    assert len(final.capabilityRuns) == 3, "higher key's data must be retained"


def test_persistence_guard_lower_lastturnid_with_higher_replay_count_does_not_clobber_core(tmp_path):
    """Lower lastTurnId snapshot carrying more replay entries must NOT clobber
    core authoritative fields (goal, conversation, artifacts, etc) even if its replay
    count would have inflated key in flawed version. This covers review finding 1:
    replay counts must not decide full clobber (only lastTurnId monotonic); append-only
    replay merge still applies (adds new ids from the save), core stays from higher-turn prior.
    """
    from services import persistence as pers
    from models.v5_state import V5SessionState, SlideRuleReplayEvent

    store_file = tmp_path / "lower-turn-replay-clobber.json"
    sid = "lower-turn-replay-001"

    # Authoritative committed state at t7 (higher turn)
    auth = V5SessionState(
        sessionId=sid,
        goal={"text": "committed-authoritative-core-t7", "status": "needs_refinement"},
        artifacts=[{"id": "a-auth", "kind": "report"}],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[{"role": "user", "text": "auth", "turnId": "t7"}],
        lastTurnId="t7",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    assert pers.save_session_record(auth, store_file=store_file)["ok"]

    # Older snapshot at LOWER lastTurnId="t3" but carries 5 replay events (old snapshot with inflated replay)
    stale_replays = [
        SlideRuleReplayEvent(id=f"stale-r{i}", sessionId=sid, at="2026-07-02T00:00:0Z", kind="conversation")
        for i in range(5)
    ]
    stale = V5SessionState(
        sessionId=sid,
        goal={"text": "stale-lower-turn-more-replay-must-not-overwrite", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t3",
        decisionLedger=[],
        sessionReplayLog=stale_replays,
        reasoningEvents=[],
    )
    pers.save_session_record(stale, store_file=store_file)

    rec = pers.load_session_record(sid, store_file=store_file)
    assert rec["ok"]
    final = rec["session"]
    # Core authoritative must be retained (lower turn blocked regardless of replay count)
    assert final.goal["text"] == "committed-authoritative-core-t7", "lower-turn higher-replay must not clobber goal"
    assert final.lastTurnId == "t7"
    assert len(final.artifacts) == 1
    assert len(final.conversation) == 1
    # Replay merge still happened: prior 0 + 5 new from stale -> appended
    assert len(final.sessionReplayLog) == 5, "replay append-only merge must still occur for new ids"
    # Verify no core from stale leaked
    art0 = final.artifacts[0] if final.artifacts else None
    art0_id = art0.get("id") if isinstance(art0, dict) else getattr(art0, "id", None) if art0 else None
    assert art0_id == "a-auth" or len(final.artifacts) == 1


def test_persistence_guard_same_lastturnid_stale_does_not_clobber_core(tmp_path):
    """Same lastTurnId stale snapshot (even non-concurrent) must not overwrite newer core fields.
    This directly addresses review finding 1: prior < only allowed equal-turn overwrite; <= guard
    + re-read under lock ensures same-turn later stale cannot clobber goal/conversation/artifacts/ledgers.
    lastTurnId acts as version; serialized first-write provides timestamp order for ties.
    """
    from services import persistence as pers
    from models.v5_state import V5SessionState

    store_file = tmp_path / "same-turn-guard.json"
    sid = "same-turn-guard-001"

    # Authoritative at t8
    auth = V5SessionState(
        sessionId=sid,
        goal={"text": "authoritative-same-turn-core", "status": "needs_refinement"},
        artifacts=[{"id": "a-auth", "kind": "report"}],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[{"role": "user", "text": "auth", "turnId": "t8"}],
        lastTurnId="t8",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    assert pers.save_session_record(auth, store_file=store_file)["ok"]

    # Stale same lastTurnId="t8" with different core
    stale_same = V5SessionState(
        sessionId=sid,
        goal={"text": "stale-same-turn-must-not-overwrite", "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[],
        lastTurnId="t8",
        decisionLedger=[],
        sessionReplayLog=[],
        reasoningEvents=[],
    )
    pers.save_session_record(stale_same, store_file=store_file)

    rec = pers.load_session_record(sid, store_file=store_file)
    assert rec["ok"]
    final = rec["session"]
    # Core must retain from prior even on equal lastTurnId
    assert final.goal["text"] == "authoritative-same-turn-core", "same-lastTurnId stale must not clobber goal"
    assert final.lastTurnId == "t8"
    assert len(final.artifacts) == 1
    assert len(final.conversation) == 1
    # Replay merge from stale (empty) no change
    assert len(final.sessionReplayLog) == 0


# Direct pytest for review finding 2 (major): non-empty selected drive-turn path.
# Exercises the REAL selected capability code in drive_reasoning_turn (no selected=[] bypass).
# Proves: drive creates Artifact via server_construct (gated_pass + producedBy), writes capabilityRuns,
# save persists, and load_session_record / load_all (via fixed server_load in _coerce) can read back
# the server-owned gated artifact fields. This is the main evidence for Python-owned drive/persist session authority.
# The prior [] monkeypatch envelope test is kept unchanged (per review).
def test_drive_reasoning_turn_nonempty_selected_writes_gated_artifacts_capruns_and_readback_via_load(tmp_path, monkeypatch):
    """Direct test of drive path with real selected !=[] ; gated artifact + readback after persist."""
    store_file = tmp_path / "drive-nonempty-gated.json"
    sid = "drive-gated-nonempty-001"

    # Ensure env var makes resolve_store use our tmp for the drive's internal save_session_record calls
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store_file))

    # Patch orchestrate to return NON-EMPTY selected (exercises the gated construction path directly)
    from services.slide_rule_orchestrator import OrchestratePlanResult
    def fake_nonempty_orchestrate(state, turn_id, user_text):
        return OrchestratePlanResult(
            selected=[{"capabilityId": "evidence.search", "roleId": "grounding"}],
            rationale="nonempty-selected-for-gated-artifact-proof",
            converged=False,
        )

    monkeypatch.setattr("services.slide_rule_session.orchestrate_plan", fake_nonempty_orchestrate)
    # Current PYTHON_AUTHORITY pick contract: drive_reasoning_turn selects via
    # pick_next_capabilities (explicit pick; plan_result.selected is legacy and no longer drives
    # the loop). Patch the pick to the same NON-EMPTY selection so this test still exercises the
    # real gated commit path for exactly evidence.search.
    monkeypatch.setattr(
        "services.slide_rule_session.pick_next_capabilities",
        lambda state, user_text: [{"capabilityId": "evidence.search", "roleId": "grounding"}],
    )

    import services.slide_rule_session as sess_mod
    import services.persistence as pers

    # Clean any prior in service cache for this sid
    sess_mod._sessions.pop(sid, None)

    # Fresh minimal state (no prior elevated artifacts, so ordinary ** input to drive ok for start)
    state = make_state(sid, goal_text="drive gated test")
    # call the real drive_reasoning_turn (non-bypassed path)
    final = sess_mod.drive_reasoning_turn(state, "t-nonempty-1", "user input for drive test")

    # Verify in-memory final from drive has the server-owned fields
    assert len(final.artifacts) >= 1, "drive with selected must append artifact"
    art = final.artifacts[-1]
    assert art.trustLevel == "gated_pass", "drive must produce gated_pass artifact (server-owned)"
    assert art.producedBy is not None, "drive artifact must have producedBy"
    assert getattr(art.producedBy, "capabilityId", None) == "evidence.search"
    assert len(final.capabilityRuns) >= 1, "drive must append capabilityRun"
    assert final.capabilityRuns[-1].capabilityId == "evidence.search"
    # also proves replay etc may be appended via save path, but focus gated

    # Now prove durable persistence + readback using server_load path (finding 1)
    loaded_rec = pers.load_session_record(sid, store_file=store_file)
    assert loaded_rec.get("ok") is True, "load_session_record must succeed for state saved by drive"
    lstate = loaded_rec["session"]
    assert len(lstate.artifacts) >= 1
    lart = lstate.artifacts[-1]
    assert lart.trustLevel == "gated_pass"
    assert lart.producedBy is not None and getattr(lart.producedBy, "capabilityId", None) == "evidence.search"
    assert len(lstate.capabilityRuns) >= 1

    # Also load_all must read back the gated server state
    all_loaded = pers.load_all(store_file=store_file)
    assert sid in all_loaded
    astate = all_loaded[sid]
    assert astate.artifacts[0].trustLevel == "gated_pass"
    assert astate.artifacts[0].producedBy is not None

    # cleanup
    pers.delete_session_record(sid, store_file=store_file)
    sess_mod._sessions.pop(sid, None)


def test_sessions_list_carries_the_bound_app_and_its_cover(monkeypatch):
    """GET /sessions 的每条会话要带上它绑定那版应用的 appId + 缩略图三件套。

    ## 这条判据钉的是什么

    应用中心把「全部会话」和「**一页**应用」合并去重（前端 mergeGalleryItems
    按 session_id 认领）。会话列表一次拉全、应用是 limit=14 的一页——认不到自己
    应用的那些会话各摆一张没有封面的空卡。真机 2026-08-24：66 张卡只有 14 张
    有图，而库里 67 张图都在。

    ⚠ 正反两条一起写（本仓第三条）：名单里有字段 ≠ 值真的接上了，
      没绑应用的会话也**不许**凭空长出 appId。
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    client = TestClient(app)
    headers = {"X-Internal-Key": "dev-slide-rule-internal"}

    import services.persistence as persistence

    # ⚠ 路由是**在函数体里** `from services.persistence import ...`，所以补丁要打
    #   在 persistence 模块上，打在 routes.sliderule_full 上不生效。
    # ⚠ 归属必须给：会话恒为 private（连无主的也是，见 app_access.session_record
    #   那段 2026-08-06 的裁决），不带 ownerId 的假数据会被列表过滤器全部滤掉，
    #   现象是 KeyError 而不是断言失败。
    monkeypatch.setattr(
        persistence,
        "list_session_summaries",
        lambda: [
            {
                "sessionId": "s-bound",
                "goal": "有绑定应用",
                "artifactCount": 1,
                "ownerId": TEST_USER_ID,
            },
            {
                "sessionId": "s-loose",
                "goal": "没绑定应用",
                "artifactCount": 0,
                "ownerId": TEST_USER_ID,
            },
        ],
    )
    import services.app_store as store

    monkeypatch.setattr(
        store,
        "session_covers",
        lambda: {
            "s-bound": {
                "app_id": "app-abc",
                "version": 2,
                "device": "phone",
                "has_preview": True,
                "preview_source": "shot",
                "preview_tag": "shot.123",
            }
        },
    )

    body = client.get("/api/sliderule/sessions", headers=headers).json()
    rows = {r["sessionId"]: r for r in body["sessions"]}

    bound = rows["s-bound"]
    assert bound["appId"] == "app-abc"
    assert bound["version"] == 2
    assert bound["device"] == "phone"
    assert bound["has_preview"] is True
    assert bound["preview_tag"] == "shot.123"
    # 字段名必须与应用摘要（_mark_previews）一致——前端那条 shouldUseSheetThumb
    # 不该分两套判定。
    assert "preview_source" in bound

    # 反向：没绑应用的会话不许凭空长出这些字段
    loose = rows["s-loose"]
    assert "appId" not in loose
    assert "has_preview" not in loose
    assert loose["goal"] == "没绑定应用"


def test_sessions_list_survives_a_broken_cover_index(monkeypatch):
    """封面索引炸了，会话列表照常给（fail-open，本仓第七条）。

    缩略图是增强类。GET /sessions 是侧栏和应用中心共用的那条路，把它拖成 500
    等于整个工作台白屏——比没有封面严重得多。
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    import services.app_store as store
    import services.persistence as persistence

    monkeypatch.setattr(
        persistence,
        "list_session_summaries",
        lambda: [
            {
                "sessionId": "s-solo",
                "goal": "只要列得出来",
                "artifactCount": 0,
                "ownerId": TEST_USER_ID,
            }
        ],
    )

    def boom():
        raise RuntimeError("索引挂了")

    monkeypatch.setattr(store, "session_covers", boom)

    resp = TestClient(app).get(
        "/api/sliderule/sessions", headers={"X-Internal-Key": "dev-slide-rule-internal"}
    )
    assert resp.status_code == 200, "封面挂了不许把会话列表拖成 500"
    assert [r["sessionId"] for r in resp.json()["sessions"]] == ["s-solo"]


def test_sessions_list_fetches_summaries_and_covers_concurrently(monkeypatch):
    """摘要和封面索引必须并发发，不许串行。

    真机（2026-08-24，HTTPS SQL 网关）：摘要 140ms、封面 145ms。串行 ~420ms、
    并发 ~145ms。GET /sessions 是侧栏和应用中心共用的首屏接口，改回串行不报错
    不变红，只是每个人每次开工作台多等 280ms。

    用真的阻塞时间判，不 grep 源码——写法可以变，"别串行"不变。
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    import time
    import services.app_store as store
    import services.persistence as persistence

    DELAY = 0.25

    def slow_summaries():
        time.sleep(DELAY)
        return [{"sessionId": "s1", "goal": "g", "artifactCount": 0, "ownerId": TEST_USER_ID}]

    def slow_covers():
        time.sleep(DELAY)
        return {}

    monkeypatch.setattr(persistence, "list_session_summaries", slow_summaries)
    monkeypatch.setattr(store, "session_covers", slow_covers)

    client = TestClient(app)
    started = time.time()
    resp = client.get(
        "/api/sliderule/sessions", headers={"X-Internal-Key": "dev-slide-rule-internal"}
    )
    elapsed = time.time() - started

    assert resp.status_code == 200
    assert [r["sessionId"] for r in resp.json()["sessions"]] == ["s1"]
    assert elapsed < DELAY * 1.6, (
        f"摘要与封面看起来是串行取的：{elapsed:.2f}s ≥ {DELAY * 1.6:.2f}s"
    )


def test_sessions_list_still_fails_closed_when_summaries_break(monkeypatch):
    """摘要那条**不许** fail-open —— 它是这个接口的正事。

    增强类 fail-open、主链路 fail-closed，两者不能混（本仓第七条）。封面拿不到
    就画空态没关系；会话摘要拿不到却假装"你没有会话"，是端出一份**假的空列表**，
    比报错严重得多。并发化之后特别容易顺手把它一起包进 try 里，这条钉住它。
    """
    try:
        from fastapi.testclient import TestClient
        from app import app
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    import services.persistence as persistence

    def boom():
        raise RuntimeError("摘要查询挂了")

    monkeypatch.setattr(persistence, "list_session_summaries", boom)

    with pytest.raises(RuntimeError):
        TestClient(app).get(
            "/api/sliderule/sessions",
            headers={"X-Internal-Key": "dev-slide-rule-internal"},
        )


def test_startup_warms_storage_backends_in_the_background(monkeypatch):
    """启动时**后台**把两个存储后端建起来，而且不许阻塞启动。

    ## 钉的是什么

    两个后端都是懒加载单例，第一次用到才建。真机 2026-08-24：建 session 后端
    1525ms、建 app_store 后端 2409ms，建完之后每次查询 ~140ms —— 也就是重启后
    第一个开工作台的人要付 3.9 秒，全花在建连接和建表上，跟他要的数据无关
    （GET /sessions 冷启动 4.7s vs 稳态 843ms）。

    ⚠ 反向同样重要：**不许在启动里 await 它**。2026-08-19 有过相反方向的教训
      （启动 load_all 把每条会话 blob 拉进进程，dev:all 卡在 "Application
      startup complete" 起不来）。所以下面既验"确实被触发了"，也验"启动函数
      自己没被拖住"。
    """
    try:
        import app as app_module
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    import time

    built: list[str] = []
    gate = threading.Event()

    def slow_blob_store(_store_file=None):
        gate.wait(2.0)
        built.append("session store")
        return None

    def slow_get_backend():
        gate.wait(2.0)
        built.append("app store")
        return None

    import services.persistence as persistence
    import services.app_store as store

    monkeypatch.setattr(persistence, "_blob_store", slow_blob_store)
    monkeypatch.setattr(store, "get_backend", slow_get_backend)

    started = time.time()
    app_module._warm_storage_backends()
    returned_in = time.time() - started

    # ① 立刻返回 —— 预热在后台，启动不被 IO 拖住
    assert returned_in < 0.5, f"预热阻塞了启动 {returned_in:.2f}s"
    assert built == [], "还没放行就建完了？那说明它是同步跑的"

    # ② 放行之后两个后端都真的被建了（正向：不是只写了个函数没人调）
    gate.set()
    deadline = time.time() + 5
    while len(built) < 2 and time.time() < deadline:
        time.sleep(0.02)
    assert sorted(built) == ["app store", "session store"]


def test_warm_up_failure_falls_back_to_lazy_loading(monkeypatch):
    """预热建不起来 → 打一行日志走人，绝不把启动带崩。

    预热纯属提速：失败就退回原来的懒加载，第一个请求自己建，行为零回退。
    """
    try:
        import app as app_module
    except Exception as e:
        pytest.skip(f"app import failed: {e}")

    import time
    import services.persistence as persistence
    import services.app_store as store

    def boom(*_a, **_kw):
        raise RuntimeError("网关连不上")

    monkeypatch.setattr(persistence, "_blob_store", boom)
    monkeypatch.setattr(store, "get_backend", boom)

    app_module._warm_storage_backends()  # 不抛就是通过
    time.sleep(0.3)
