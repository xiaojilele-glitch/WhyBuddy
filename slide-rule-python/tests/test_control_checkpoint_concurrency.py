"""Two legitimate project writers must not race their shared turn checkpoint.

The P4 HTTP model loop intermittently stopped immediately after patch admission:
both the control thread and source owner wrote the same .json.tmp after releasing
the SQL-save lock. Windows raised WinError 32; another interleaving silently
replaced the newer project checkpoint with the earlier conversation snapshot.
These tests execute the real SQL/fenced saves and real filesystem replacement.
"""
import json
import threading

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services.project_authority import approved_reference
from test_control_session_persistence import owned


def test_source_reference_and_control_save_keep_checkpoint_in_sql_commit_order(owned, monkeypatch):
    row = owned.blobs.load(owned.state.sessionId)
    payload = {**row.payload, "runtimeKind": "project", "projectId": "project-one",
        "projectRevision": "revision-before", "controlTranscript": approved_plan_rows()}
    assert owned.blobs.save(owned.state.sessionId, payload, expected_rev=row.rev)
    state = V5SessionState.server_load(payload)
    control = state.model_copy(update={"goal": {"text": "Conversation progressed"}})
    source = state.model_copy(update={"projectRevision": "revision-after"})
    entered, release, second_started, second_done = [threading.Event() for _ in range(4)]
    original = persistence._write_turn_checkpoint
    results, errors = {}, []

    def checkpoint(candidate, *args, **kwargs):
        if threading.current_thread().name == "control-save":
            entered.set()
            assert release.wait(3)
        return original(candidate, *args, **kwargs)

    monkeypatch.setattr(persistence, "_write_turn_checkpoint", checkpoint)

    def save_control():
        try:
            results["control"] = persistence.save_session_record(control, server_write=True,
                expected_control_run=owned.fence)
        except Exception as exc:
            errors.append(exc)

    def save_source():
        second_started.set()
        try:
            results["source"] = persistence.save_session_record(source, server_write=True,
                project_binding_approval=approved_reference(state), expected_project_revision="revision-before")
        except Exception as exc:
            errors.append(exc)
        finally:
            second_done.set()

    one = threading.Thread(target=save_control, name="control-save")
    two = threading.Thread(target=save_source, name="source-save")
    one.start()
    assert entered.wait(3)
    two.start()
    assert second_started.wait(3)
    try:
        escaped = second_done.wait(0.2)
    finally:
        release.set()
        one.join(3)
        two.join(3)
    assert not one.is_alive() and not two.is_alive() and not errors
    assert all(result["ok"] for result in results.values()), results
    row = owned.blobs.load(state.sessionId)
    directory = persistence._checkpoint_dir() / persistence._safe_ckpt_token(state.sessionId)
    index = json.loads((directory / "index.json").read_text(encoding="utf-8"))
    checkpoint_state = json.loads((directory / (index["latest_id"] + ".json")).read_text(encoding="utf-8"))["state"]
    assert row.payload["projectRevision"] == checkpoint_state["projectRevision"] == "revision-after"
    assert row.payload["goal"] == checkpoint_state["goal"] == control.goal
    assert row.payload["controlTranscript"] == checkpoint_state["controlTranscript"] == payload["controlTranscript"]
    assert not escaped, "source SQL/checkpoint escaped while an earlier control checkpoint was unfinished"


def test_atomic_checkpoint_writers_never_share_a_temporary_file(tmp_path, monkeypatch):
    path = tmp_path / "checkpoint.json"
    path.write_text('{"original":true}', encoding="utf-8")
    replace = persistence.os.replace
    barrier = threading.Barrier(2)
    replace_lock = threading.Lock()
    sources, errors = [], []

    def simultaneous_replace(source, destination):
        sources.append(str(source))
        barrier.wait(timeout=3)
        # Force overlapping temporary writes, then serialize replacement just
        # as the save lock does. Windows also rejects simultaneous target-file
        # replacements; that unrelated OS behavior must not hide a shared tmp.
        with replace_lock:
            return replace(source, destination)

    monkeypatch.setattr(persistence.os, "replace", simultaneous_replace)
    def write(value):
        try:
            persistence._atomic_write_json(path, {"writer": value})
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(index,)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(4)
    assert all(not thread.is_alive() for thread in threads)
    assert not errors, [type(error).__name__ for error in errors]
    assert len(set(sources)) == 2
    assert json.loads(path.read_text(encoding="utf-8")) in ({"writer": 0}, {"writer": 1})
    assert list(tmp_path.iterdir()) == [path]


def test_unknown_sql_commit_response_does_not_retry_or_publish_checkpoint(owned, monkeypatch):
    original = owned.blobs.save
    directory = persistence._checkpoint_dir() / persistence._safe_ckpt_token(owned.state.sessionId)
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    calls = []

    def committed_without_response(*args, **kwargs):
        calls.append(kwargs)
        assert original(*args, **kwargs)
        raise TimeoutError("unknown committed response")

    monkeypatch.setattr(owned.blobs, "save", committed_without_response)
    result = persistence.save_session_record(owned.state.model_copy(update={"goal": {"text": "Uncertain save"}}),
        server_write=True, expected_control_run=owned.fence)
    assert not result["ok"] and result["reason"] == "db_write_failed"
    assert len(calls) == 1 and calls[0]["expected_control_run"] == owned.fence
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == before
