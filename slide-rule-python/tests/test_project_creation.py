"""Approved-session creation, binding races, and source-authority recovery.

The real session persistence and source SQL store run in every test. Failure
injection targets the boundary between stores, where an isolated helper test
would miss a stale approval or source pointer that did not reach persistence.
"""

import json

import pytest

from models.v5_state import V5SessionState
from services import persistence, project_creation as creation
from services.project_authority import approved_reference
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture(params=["file", "sql"])
def setup(request, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    database = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}") if request.param == "sql" else None
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: database)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    plan = {"planId": "plan-project", "revision": 1, "planContent": "Create a minimal editable application", "reqId": "approve-1"}
    state = V5SessionState(sessionId="session-project", ownerId="alice", goal={"text": "New app"},
        lastTurnId="turn-2", controlTranscript=[
            {**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")
        ])
    assert persistence.save_session_record(state, server_write=True)["ok"]
    yield store, state, approved_reference(state), database
    store.close()
    if database is not None:
        database._engine.dispose()


def create(setup, **kwargs):
    store, state, ref, _ = setup
    return creation.create_session_project(store, state.sessionId, owner_id=kwargs.get("owner_id", "alice"),
        approval_ref=kwargs.get("approval_ref", ref))


def test_approved_creation_is_idempotent_and_sources_survive_binding(setup):
    store, state, ref, _ = setup
    project = create(setup)
    again = create(setup)
    assert again.projectId == project.projectId and again.currentRevision == project.currentRevision
    stored = persistence.load_session_record(state.sessionId)["session"]
    assert stored.runtimeKind == "project" and stored.projectId == project.projectId
    assert stored.projectRevision == project.currentRevision
    files = store.read_files(project.projectId, owner_id="alice")
    package = json.loads(files["package.json"])
    lock = json.loads(files["package-lock.json"])
    assert package["dependencies"]["react"] == "19.2.1"
    assert lock["packages"][""]["devDependencies"]["vite"] == "7.3.6"
    assert {"check", "test", "build"} <= package["scripts"].keys()
    assert store.get_revision(project.projectId, owner_id="alice").planRef == ref
    assert not store.list_runnable_operations()


@pytest.mark.parametrize("owner,ref,error", [("bob", None, ProjectNotFound), ("alice", "stale", PermissionError)])
def test_wrong_owner_and_stale_approval_do_not_create_sources(setup, owner, ref, error):
    store, state, current, _ = setup
    with pytest.raises(error):
        create(setup, owner_id=owner, approval_ref=ref or current)
    assert store.get_project_for_session(state.sessionId, owner_id="alice") is None


@pytest.mark.parametrize("existing", [{"specFirstPages": {"pages": {"home": "<button>Old</button>"}}},
    {"modelVersions": [{"id": "mv-1", "model": {"pages": []}}]}])
def test_existing_application_requires_explicit_conversion(setup, existing):
    store, state, _ref, _ = setup
    assert persistence.save_session_record(state.model_copy(update=existing), server_write=True)["ok"]
    with pytest.raises(ProjectConflict, match="project_conversion_required"):
        create(setup)
    assert store.get_project_for_session(state.sessionId, owner_id="alice") is None


def test_plan_change_between_source_creation_and_binding_cannot_bind(setup, monkeypatch):
    store, state, ref, _ = setup
    original = store.create_project
    def create_then_change(*args, **kwargs):
        project = original(*args, **kwargs)
        changed = state.model_copy(update={"controlTranscript": state.controlTranscript + [
            {"kind": "plan_written", "planId": "plan-project", "revision": 2, "planContent": "Different app"}]})
        assert persistence.save_session_record(changed, server_write=True)["ok"]
        return project
    monkeypatch.setattr(store, "create_project", create_then_change)
    with pytest.raises(PermissionError, match="project_plan_approval_required"):
        create(setup)
    assert persistence.load_session_record(state.sessionId)["session"].projectId is None
    project = store.get_project_for_session(state.sessionId, owner_id="alice")
    assert project is not None and not store.list_runnable_operations()
    assert store.get_revision(project.projectId, owner_id="alice").planRef == ref


def test_crash_after_source_creation_is_repaired_without_duplicate_project(setup, monkeypatch):
    store, state, ref, _ = setup
    original = creation._save_reference
    monkeypatch.setattr(creation, "_save_reference", lambda *_: (_ for _ in ()).throw(ProjectStoreUnavailable("injected_crash")))
    with pytest.raises(ProjectStoreUnavailable):
        create(setup)
    project = store.get_project_for_session(state.sessionId, owner_id="alice")
    assert project is not None and persistence.load_session_record(state.sessionId)["session"].projectId is None
    monkeypatch.setattr(creation, "_save_reference", original)
    assert create(setup).currentRevision == project.currentRevision
    assert persistence.load_session_record(state.sessionId)["session"].projectRevision == project.currentRevision


def test_lost_session_pointer_adopts_current_approved_plan(setup):
    """会话指针丢了、源码还在：按当前批准绑回去，不许甩 initial_plan_changed。

    真机 TicketStream（2026-09-15）：工程 4 个 revision 都在，会话
    runtimeKind 掉回 html-prototype。把 `not state.projectId` 从 adopt
    条件拿掉，这条必红。
    """
    store, state, _ref, _ = setup
    project = create(setup)
    lost = persistence.load_session_record(state.sessionId)["session"].model_copy(update={
        "runtimeKind": "html-prototype", "projectId": None, "projectRevision": None,
        "controlTranscript": [
            {"kind": kind, "planId": "plan-later", "revision": 2,
             "planContent": "TicketStream after the pointer was lost", "reqId": "approve-2"}
            for kind in ("plan_written", "plan_approval", "plan_approved")
        ],
    })
    assert persistence.save_session_record(lost, server_write=True)["ok"]
    later = approved_reference(lost)
    rebound = create(setup, approval_ref=later)
    stored = persistence.load_session_record(state.sessionId)["session"]
    assert rebound.projectId == project.projectId
    assert stored.runtimeKind == "project" and stored.projectId == project.projectId
    assert store.get_revision(project.projectId, owner_id="alice").planRef == later


def test_sync_uses_source_head_and_preserves_newer_conversation(setup):
    store, state, ref, _ = setup
    project = create(setup)
    files = store.read_files(project.projectId, owner_id="alice")
    files["src/main.tsx"] += "\n// changed source\n"
    revision = store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        files=files, template_version=creation.TEMPLATE_VERSION, plan_ref=ref)
    stored = persistence.load_session_record(state.sessionId)["session"]
    assert persistence.save_session_record(stored.model_copy(update={"lastTurnId": "turn-8", "goal": {"text": "New request"}}), server_write=True)["ok"]
    synced = creation.sync_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref)
    assert synced.projectRevision == revision.revision and synced.lastTurnId == "turn-8"
    assert synced.goal["text"] == "New request"
    assert create(setup).currentRevision == revision.revision


def test_approval_is_rechecked_inside_database_cas(setup, monkeypatch):
    store, state, _ref, database = setup
    if database is None:
        pytest.skip("The file path holds one lock; cross-process conflict uses SQL CAS")
    original = database.save
    raced = False
    def revoke_then_conflict(session_id, payload, *, expected_rev=None):
        nonlocal raced
        if payload.get("projectId") and not raced:
            raced = True
            revoked = state.model_copy(update={"controlTranscript": state.controlTranscript + [{"kind": "plan_exited"}]})
            assert original(session_id, revoked.model_dump(), expected_rev=expected_rev)
            return False
        return original(session_id, payload, expected_rev=expected_rev)
    monkeypatch.setattr(database, "save", revoke_then_conflict)
    with pytest.raises(PermissionError, match="project_plan_approval_required"):
        create(setup)
    stored = persistence.load_session_record(state.sessionId)["session"]
    assert raced and stored.projectId is None and stored.controlTranscript[-1]["kind"] == "plan_exited"


def test_failed_session_store_does_not_use_cached_approval(setup, monkeypatch):
    store, state, _ref, _ = setup
    monkeypatch.setattr(persistence, "load_session_record", lambda _sid: {"ok": False, "error": "store_unavailable"})
    with pytest.raises(ProjectStoreUnavailable):
        create(setup)
    assert store.get_project_for_session(state.sessionId, owner_id="alice") is None


def test_binding_does_not_rewind_same_turn_conversation_scalars(setup, monkeypatch):
    _store, state, _ref, _database = setup
    original = creation._save_reference
    def change_goal_before_save(prior, project, approval):
        current = persistence.load_session_record(state.sessionId)["session"]
        assert persistence.save_session_record(current.model_copy(update={"goal": {"text": "Concurrent update"}}), server_write=True)["ok"]
        return original(prior, project, approval)
    monkeypatch.setattr(creation, "_save_reference", change_goal_before_save)
    project = create(setup)
    stored = persistence.load_session_record(state.sessionId)["session"]
    assert stored.projectId == project.projectId and stored.goal["text"] == "Concurrent update"


def test_html_created_while_binding_waits_requires_conversion(setup, monkeypatch):
    _store, state, _ref, _database = setup
    original = creation._save_reference
    def add_page_before_save(prior, project, approval):
        current = persistence.load_session_record(state.sessionId)["session"]
        current.specFirstPages = {"pages": {"home": "<button>Existing application</button>"}}
        assert persistence.save_session_record(current, server_write=True)["ok"]
        return original(prior, project, approval)
    monkeypatch.setattr(creation, "_save_reference", add_page_before_save)
    with pytest.raises(ProjectConflict, match="project_conversion_required"):
        create(setup)
    assert persistence.load_session_record(state.sessionId)["session"].projectId is None


def test_sync_rechecks_source_that_advances_during_session_save(setup, monkeypatch):
    store, state, ref, _database = setup
    project = create(setup)
    original = creation._save_reference
    committed = []
    def advance_source(prior, current, approval):
        saved = original(prior, current, approval)
        if not committed:
            files = store.read_files(project.projectId, owner_id="alice")
            files["src/main.tsx"] += "\n// concurrent source update\n"
            committed.append(store.commit_revision(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
                files=files, template_version=creation.TEMPLATE_VERSION, plan_ref=ref))
        return saved
    monkeypatch.setattr(creation, "_save_reference", advance_source)
    synced = creation.sync_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref)
    assert synced.projectRevision == committed[0].revision
    assert persistence.load_session_record(state.sessionId)["session"].projectRevision == committed[0].revision
