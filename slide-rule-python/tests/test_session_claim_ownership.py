"""Ownership must be claimed before a run exists, including concurrent first turns.

Previously a second viewer could attach to the first viewer's unpersisted stream.
Use real route/factory/registry code with a bounded driver to expose that window.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from routes import sliderule_full as routes
from services import drive_full_factory, persistence, product_charter, rehearsal_control, run_registry
from services.slide_rule_session import _memory_ahead_of_store, load_session, save_session


def user(owner):
    return SimpleNamespace(id=owner, is_active=True, is_superuser=False)


def body(sid):
    return {"state": {"sessionId": sid, "goal": {"text": "private first run"}}}


@pytest.fixture(autouse=True)
def isolated_claims(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(product_charter, "activate_charter_for_run", lambda *_args: None)


def state(sid, owner):
    return V5SessionState(**body(sid)["state"], ownerId=owner, controlTranscript=approved_plan_rows())


def test_second_user_cannot_attach_before_the_first_driver_saves(monkeypatch):
    async def scenario():
        release = asyncio.Event()

        async def driver(state, **kwargs):
            await release.wait()
            yield {"type": "complete", "state": state.model_dump()}

        monkeypatch.setattr(drive_full_factory, "drive_full_v5_session_stream", driver)
        sid = "claim-stream-" + uuid4().hex
        save_session(state(sid, "first-owner"))
        await routes.drive_full_stream(body(sid), user("first-owner"), None)
        run = run_registry.get_active_run(sid)
        try:
            with pytest.raises(HTTPException) as denied:
                await routes.drive_full_stream(body(sid), user("second-owner"), None)
            assert denied.value.status_code == 404
            assert load_session(sid).ownerId == "first-owner"
        finally:
            release.set()
            await run.task

    asyncio.run(scenario())


def test_concurrent_first_turns_claim_one_owner_even_if_both_initial_reads_miss(monkeypatch):
    sid = "claim-threads-" + uuid4().hex
    monkeypatch.setattr(routes, "load_session", lambda _sid: None)

    def request(owner):
        try:
            return routes._drive_state(body(sid), user(owner)).ownerId
        except HTTPException as exc:
            assert exc.status_code in (404, 409)
            return owner if exc.status_code == 409 else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(request, ["claim-one", "claim-two"]))
    winners = [owner for owner in results if owner]
    assert len(winners) == 1
    assert load_session(sid).ownerId == winners[0]


@pytest.mark.parametrize("replacement_owner", ["replacement-owner", None])
def test_factory_rechecks_owner_after_reloading_authoritative_state(monkeypatch, replacement_owner):
    sid = "claim-reload-" + uuid4().hex
    save_session(state(sid, "first-owner"))
    monkeypatch.setattr(drive_full_factory, "load_session", lambda _sid:
                        state(sid, replacement_owner) if replacement_owner else None)

    async def scenario():
        with pytest.raises(HTTPException) as denied:
            await routes.drive_full_stream(body(sid), user("first-owner"), None)
        assert denied.value.status_code == 404
        assert run_registry.get_active_run(sid) is None

    asyncio.run(scenario())


def test_cached_progress_cannot_override_a_different_durable_owner():
    sid = "claim-cache-owner"
    cached = state(sid, "old-owner")
    cached.lastTurnId = "turn-99"
    durable = state(sid, "new-owner")
    durable.lastTurnId = "turn-1"
    assert not _memory_ahead_of_store(cached, durable)


def test_old_run_does_not_become_visible_to_a_recreated_sessions_owner(monkeypatch):
    sid = "claim-recreated-" + uuid4().hex
    save_session(state(sid, "new-owner"))
    run = run_registry.Run("old-" + sid, sid)
    run.owner_id = "original-owner"
    monkeypatch.setitem(run_registry._runs, run.run_id, run)
    assert routes._visible_run(run.run_id, "view", user("new-owner")) is None
    monkeypatch.setitem(run_registry._active_by_session, sid, run.run_id)
    assert asyncio.run(routes.runs_active(sid, user("new-owner"), None)) == {"active": None}


def test_recreated_session_cannot_attach_to_the_original_owners_active_run(monkeypatch):
    sid = "claim-active-" + uuid4().hex
    save_session(state(sid, "new-owner"))
    run = run_registry.Run("old-" + sid, sid, owner_id="original-owner")
    monkeypatch.setitem(run_registry._runs, run.run_id, run)
    monkeypatch.setitem(run_registry._active_by_session, sid, run.run_id)
    with pytest.raises(HTTPException) as denied:
        asyncio.run(routes.drive_full_stream(body(sid), user("new-owner"), None))
    assert denied.value.status_code == 404


@pytest.mark.parametrize("method", ["post", "put"])
def test_creation_rechecks_the_atomic_claim_winner_after_an_initial_miss(monkeypatch, method):
    sid = "claim-create-" + uuid4().hex
    save_session(state(sid, "winner"))
    monkeypatch.setattr(routes, "load_session", lambda _sid: None)
    with pytest.raises(HTTPException) as denied:
        if method == "post":
            routes.create_sess(body(sid)["state"], user("loser"), None)
        else:
            routes.save_sess(sid, body(sid)["state"], user("loser"), None)
    assert denied.value.status_code == 404
    assert load_session(sid).ownerId == "winner"
    assert load_session(sid).goal["text"] == "private first run"


def test_put_rechecks_its_second_authoritative_read(monkeypatch):
    sid = "claim-put-reload-" + uuid4().hex
    reads = iter([state(sid, "first-owner"), state(sid, "replacement-owner")])
    monkeypatch.setattr(routes, "load_session", lambda _sid: next(reads))
    with pytest.raises(HTTPException) as denied:
        routes.save_sess(sid, body(sid)["state"], user("first-owner"), None)
    assert denied.value.status_code == 404


def test_old_driver_cannot_merge_into_a_recreated_sessions_new_owner():
    sid = "claim-late-save-" + uuid4().hex
    current = state(sid, "new-owner")
    save_session(current)
    late = state(sid, "original-owner")
    late.goal["text"] = "old owners private result"
    late.lastTurnId = "turn-99"
    with pytest.raises(persistence.PersistClosedError):
        save_session(late, server_write=True)
    assert load_session(sid).ownerId == "new-owner"
    assert load_session(sid).goal["text"] == current.goal["text"]


def test_control_rechecks_owner_when_the_stream_begins(monkeypatch):
    sid = "claim-control-reload-" + uuid4().hex
    save_session(state(sid, "first-owner"))

    async def scenario():
        payload = {"sessionId": sid, "userText": "hello", "installedSkills": [],
                   "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
        response = await routes.control_turn_stream(payload, user("first-owner"),
            request=None, x_internal_key=None, x_control_request_id=None)
        monkeypatch.setattr(rehearsal_control, "load_session", lambda _sid:
                            state(sid, "replacement-owner"))
        with pytest.raises(HTTPException) as denied:
            await anext(response.body_iterator)
        assert denied.value.status_code == 404

    asyncio.run(scenario())


def test_database_insert_collision_returns_the_winner_without_overwriting(monkeypatch):
    prior = state("claim-db", "db-first")

    class RacingStore:
        def __init__(self):
            self.inserted = False
            self.writes = 0

        def load(self, sid):
            return SimpleNamespace(payload=prior.model_dump()) if self.inserted else None

        def save(self, sid, payload, *, expected_rev):
            assert expected_rev is None
            self.writes += 1
            self.inserted = True
            return False

    store = RacingStore()
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: store)
    result = persistence.claim_session_record(state("claim-db", "db-second"))
    assert result["ok"]
    assert result["state"].ownerId == "db-first"
    assert store.writes == 1


def test_failed_claim_never_starts_a_driver(monkeypatch):
    sid = "claim-unavailable-" + uuid4().hex
    monkeypatch.setattr(persistence, "_read_store_file", lambda _path=None:
                        ({}, {"ok": False, "reason": "read_failed"}))
    with pytest.raises(HTTPException) as unavailable:
        routes._drive_state(body(sid), user("claim-owner"))
    assert unavailable.value.status_code == 503
    assert run_registry.get_active_run(sid) is None


@pytest.mark.parametrize("state", ["not-an-object", [1]])
def test_invalid_state_type_is_a_client_error(state):
    with pytest.raises(HTTPException) as invalid:
        routes._drive_state({"state": state}, user("claim-owner"))
    assert invalid.value.status_code == 400
