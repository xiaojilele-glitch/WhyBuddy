"""First-owner claims must not inherit save's merging or cache fallback behavior."""

import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from models.v5_state import V5SessionState
from services import persistence, request_context, session_blob_store, slide_rule_session


def state(sid="claim", owner="owner", goal="original"):
    return V5SessionState(sessionId=sid, ownerId=owner, goal={"text": goal})


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch, tmp_path):
    path = tmp_path / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(path))
    monkeypatch.setattr(slide_rule_session, "_sessions", {})
    return path


def test_file_claim_preserves_the_existing_owner_and_bytes(isolated_store):
    first = persistence.claim_session_record(state(), isolated_store)
    assert first["ok"] and first["created"]
    before = isolated_store.read_bytes()
    metadata = persistence._meta_path(isolated_store).read_bytes()
    checkpoint = persistence._checkpoint_dir(isolated_store) / "claim" / "index.json"
    checkpoint_before = checkpoint.read_bytes()
    contender = state(owner="other", goal="overwrite")
    contender.lastTurnId = "turn-999"
    contender.conversation = [{"role": "user", "text": "must not merge"}]
    result = persistence.claim_session_record(contender, isolated_store)
    assert result["ok"] and not result["created"]
    assert result["state"].model_dump() == first["state"].model_dump()
    assert isolated_store.read_bytes() == before
    assert persistence._meta_path(isolated_store).read_bytes() == metadata
    assert checkpoint.read_bytes() == checkpoint_before


def test_file_claim_serializes_simultaneous_first_writers(isolated_store):
    def claim(owner):
        return persistence.claim_session_record(state(owner=owner), isolated_store)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(claim, [f"owner-{i}" for i in range(8)]))
    assert all(result["ok"] for result in results)
    assert sum(result["created"] for result in results) == 1
    assert len({result["state"].ownerId for result in results}) == 1


@pytest.mark.parametrize("raw", [
    "{not json",
    json.dumps([["claim", "unreadable"]]),
    json.dumps([["claim", {"sessionId": "another", "ownerId": "owner"}]]),
])
def test_file_claim_refuses_unreadable_or_mismatched_existing_records(isolated_store, raw):
    isolated_store.write_text(raw, encoding="utf-8")
    result = persistence.claim_session_record(state(owner="other"), isolated_store)
    assert not result["ok"]
    assert result["state"] is None
    assert not result["created"]
    assert isolated_store.read_text(encoding="utf-8") == raw


def test_creating_another_session_preserves_unreadable_unrelated_records(isolated_store):
    isolated_store.write_text(json.dumps([["legacy", "unreadable"]]), encoding="utf-8")
    assert persistence.claim_session_record(state(), isolated_store)["created"]
    saved = dict(json.loads(isolated_store.read_text(encoding="utf-8")))
    assert saved["legacy"] == "unreadable"
    assert saved["claim"]["ownerId"] == "owner"


def test_database_claim_uses_insert_only_even_when_another_connection_wins(monkeypatch, tmp_path):
    store = session_blob_store.SqlSessionBlobStore(f"sqlite:///{tmp_path / 'claim.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: store)
    real_save = store.save
    writes = []

    def insert_after_a_competing_write(sid, payload, *, expected_rev):
        assert expected_rev is None
        writes.append(payload)
        assert real_save(sid, state(owner="winner").model_dump(), expected_rev=None)
        return real_save(sid, payload, expected_rev=expected_rev)

    monkeypatch.setattr(store, "save", insert_after_a_competing_write)
    try:
        result = persistence.claim_session_record(state(owner="loser", goal="not committed"))
        assert result["ok"] and not result["created"]
        assert result["state"].ownerId == "winner"
        assert len(writes) == 1
        assert store.load("claim").payload == state(owner="winner").model_dump()
    finally:
        store._engine.dispose()


@pytest.mark.parametrize("load_failure,write_failure,collision", [
    (True, False, False), (False, True, False), (False, False, True),
])
def test_database_failures_do_not_fall_back_to_a_file_or_cache(
    monkeypatch, isolated_store, load_failure, write_failure, collision,
):
    class UnavailableStore:
        def load(self, _sid):
            if load_failure:
                raise OSError("unavailable")
            return None

        def save(self, _sid, _payload, *, expected_rev):
            assert expected_rev is None
            if write_failure:
                raise OSError("not written")
            assert collision
            return False

    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: UnavailableStore())
    with pytest.raises(slide_rule_session.PersistClosedError):
        slide_rule_session.claim_session(state())
    assert "claim" not in slide_rule_session._sessions
    assert not isolated_store.exists()


def test_unreadable_database_winner_is_never_overwritten(monkeypatch):
    store = SimpleNamespace(load=lambda _sid: SimpleNamespace(payload="unreadable"))
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: store)
    result = persistence.claim_session_record(state())
    assert not result["ok"]
    assert result["reason"] == "invalid_shape"


def test_checkpoint_failure_does_not_populate_claim_cache(monkeypatch):
    monkeypatch.setattr(persistence, "_write_turn_checkpoint", lambda *_args: {
        "ok": False, "reason": "checkpoint_write_failed", "message": "disk full",
    })
    with pytest.raises(slide_rule_session.PersistClosedError, match="checkpoint_write_failed"):
        slide_rule_session.claim_session(state())
    assert "claim" not in slide_rule_session._sessions


def test_successful_claim_replaces_speculative_cache_with_the_durable_winner(isolated_store):
    first = persistence.claim_session_record(state(), isolated_store)
    slide_rule_session._sessions["claim"] = state(owner="speculative")
    returned = slide_rule_session.claim_session(state(owner="other"))
    assert returned.model_dump() == first["state"].model_dump()
    assert slide_rule_session._sessions["claim"] is returned


def test_create_session_retries_a_real_collision_and_keeps_context_owner(monkeypatch, isolated_store):
    persistence.claim_session_record(state("occupied", owner="original"), isolated_store)
    ids = iter(["occupied", "fresh"])
    monkeypatch.setattr(slide_rule_session, "_new_session_id", lambda: next(ids))
    token = request_context.set_current_user(SimpleNamespace(id="request-owner"))
    try:
        created = slide_rule_session.create_session("new goal")
    finally:
        request_context.reset_current_user(token)
    assert created.sessionId == "fresh"
    assert created.ownerId == "request-owner"
    assert persistence.load_session_record("occupied", isolated_store)["session"].ownerId == "original"
    assert persistence.load_session_record("fresh", isolated_store)["session"].goal["text"] == "new goal"


def test_explicit_create_collision_returns_existing_state_without_overwriting(isolated_store):
    first = persistence.claim_session_record(state(), isolated_store)["state"]
    returned = slide_rule_session.create_session("different goal", "claim")
    assert returned.model_dump() == first.model_dump()


def test_create_failure_never_caches_the_candidate(monkeypatch):
    monkeypatch.setattr(persistence, "claim_session_record", lambda *_args: {
        "ok": False, "reason": "write_failed", "state": None, "created": False,
    })
    with pytest.raises(slide_rule_session.PersistClosedError, match="write_failed"):
        slide_rule_session.create_session("not durable", "claim")
    assert "claim" not in slide_rule_session._sessions


def test_failed_claim_preserves_an_existing_cache_entry(monkeypatch):
    cached = state(owner="cached-owner")
    slide_rule_session._sessions["claim"] = cached
    monkeypatch.setattr(persistence, "claim_session_record", lambda *_args: {
        "ok": False, "reason": "read_failed", "state": None, "created": False,
    })
    with pytest.raises(slide_rule_session.PersistClosedError, match="read_failed"):
        slide_rule_session.claim_session(state(owner="contender"))
    assert slide_rule_session._sessions["claim"] is cached
