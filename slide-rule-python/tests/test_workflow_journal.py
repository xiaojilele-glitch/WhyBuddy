"""建设单 O-8：journal + 重放校验。对照 grok-build journal.rs。

正向：未改动的重放能接上，execute 不再打。
反向：改动编排后重放必须报 divergence，不许静默接上。
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from services.workflow_journal import (
    HOST_ERROR_KEY,
    MAX_JOURNAL_BYTES,
    Journal,
    JournalDivergence,
    JournalError,
    JournalFull,
    JournalParseError,
    JournalSequenceError,
    JournalUnsafeRestore,
    bind_orchestration,
    hop_payload,
    journal_scope,
    journaled_call,
    request_hash,
    walk_hops,
)


def test_request_hash_is_stable_across_key_order():
    a = request_hash("k", {"b": 2, "a": 1})
    b = request_hash("k", {"a": 1, "b": 2})
    assert a == b
    assert len(a) == 32


def test_record_and_replay_roundtrip(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    journal = Journal(path)
    hashed = request_hash("spec_first", hop_payload(("spec",), "product-rehearsal"))
    journal.record(0, "spec_first", hashed, {"ok": True})

    loaded = Journal.load(path)
    assert loaded.len() == 1
    assert loaded.replay(0, "spec_first", hashed) == {"ok": True}
    assert loaded.replay(1, "spec_first", hashed) is None


def test_divergence_on_hash_or_kind_mismatch():
    journal = Journal()
    journal.record(0, "spec_first", "aaaa", 1)
    with pytest.raises(JournalDivergence, match="replay divergence at seq 0"):
        journal.replay(0, "spec_first", "bbbb")
    with pytest.raises(JournalDivergence, match=r"seq 0 \(fingerprint\)"):
        journal.replay(0, "fingerprint", "aaaa")


def test_unedited_walk_replays_without_hitting_execute():
    """建设单 O-8 正向：未改动的重放能接上。"""
    journal = Journal()
    hops = [
        ("spec_first", hop_payload(("spec",), "product-rehearsal")),
        ("spec_first", hop_payload(("pages",), "product-rehearsal")),
    ]
    calls: list[str] = []

    def execute(_kind: str, payload: dict) -> dict:
        calls.append(payload["tools"][0])
        return {"ok": True, "hop": payload["tools"][0]}

    first = walk_hops(journal, hops, execute)
    assert calls == ["spec", "pages"]
    assert [item["hop"] for item in first] == ["spec", "pages"]

    calls.clear()

    def boom(_kind: str, _payload: dict) -> dict:
        calls.append("live")
        raise AssertionError("unedited replay must not hit execute")

    second = walk_hops(journal, hops, boom)
    assert calls == []
    assert second == first


def test_edited_orchestration_replays_as_divergence():
    """建设单 O-8 反向：改动编排后重放必须 divergence，不许静默接上。"""
    journal = Journal()
    original = [
        ("spec_first", hop_payload(("spec",), "product-rehearsal")),
        ("spec_first", hop_payload(("pages",), "product-rehearsal")),
    ]
    walk_hops(
        journal,
        original,
        lambda kind, payload: {"ok": True, "hop": payload["tools"][0]},
    )
    edited = [
        ("spec_first", hop_payload(("spec",), "product-rehearsal")),
        ("spec_first", hop_payload(("bind",), "product-rehearsal")),
    ]
    hits: list[str] = []

    def boom(_kind: str, payload: dict) -> dict:
        hits.append(payload["tools"][0])
        return {"ok": True}

    with pytest.raises(JournalDivergence, match="replay divergence at seq 1"):
        walk_hops(journal, edited, boom)
    assert hits == [], "divergent replay must not hit execute"


def test_bind_orchestration_diverges_when_the_calendar_changes():
    """seq 0 指纹：改日历再续跑必须红。变异：fingerprint 不校验 hash → 本条绿。"""
    journal = Journal()
    stages = ("specfirst.spec", "specfirst.pages")
    bind_orchestration(journal, "product-rehearsal", stages)
    bind_orchestration(journal, "product-rehearsal", stages)
    with pytest.raises(JournalDivergence, match="replay divergence at seq 0"):
        bind_orchestration(
            journal,
            "pages-preview",
            ("specfirst.spec", "specfirst.pages", "specfirst.shell"),
        )


def test_torn_tail_is_truncated_before_the_next_append(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    first = (
        '{"seq":0,"kind":"log","req_hash":"x","result":null,"at_ms":1}\n'
    )
    path.write_text(first + '{"seq":1,"kind', encoding="utf-8")
    journal = Journal.load(path)
    assert journal.len() == 1
    assert path.read_text(encoding="utf-8") == first
    journal.record(1, "log", "y", None)
    assert Journal.load(path).len() == 2


def test_valid_unterminated_tail_is_kept_and_terminated(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    line = '{"seq":0,"kind":"log","req_hash":"x","result":null,"at_ms":1}'
    path.write_text(line, encoding="utf-8")
    assert Journal.load(path).len() == 1
    assert path.read_text(encoding="utf-8") == line + "\n"


def test_complete_malformed_line_is_not_treated_as_torn(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    path.write_bytes(b"not-json\n")
    with pytest.raises(JournalParseError):
        Journal.load(path)


def test_load_and_record_require_dense_sequences(tmp_path: Path):
    journal = Journal()
    with pytest.raises(JournalSequenceError) as exc:
        journal.record(1, "log", "x", None)
    assert exc.value.expected == 0
    assert exc.value.actual == 1

    path = tmp_path / "journal.jsonl"
    path.write_text(
        '{"seq":1,"kind":"log","req_hash":"x","result":null,"at_ms":1}\n',
        encoding="utf-8",
    )
    with pytest.raises(JournalSequenceError):
        Journal.load(path)


def test_persistence_error_does_not_advance_memory(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    path.mkdir()
    journal = Journal(path)
    with pytest.raises(OSError):
        journal.record(0, "log", "x", None)
    assert journal.is_empty()


def test_record_refuses_to_grow_past_the_restore_cap(monkeypatch):
    monkeypatch.setattr("services.workflow_journal.MAX_JOURNAL_BYTES", 256)
    journal = Journal()
    hashed = request_hash("spec_first", {})
    with pytest.raises(JournalFull):
        journal.record(0, "spec_first", hashed, {"blob": "x" * 512})
    journal.record(0, "spec_first", hashed, {"ok": True})
    assert journal.len() == 1


def test_load_rejects_oversize_journal_before_reading(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("services.workflow_journal.MAX_JOURNAL_BYTES", 32)
    path = tmp_path / "journal.jsonl"
    path.write_bytes(b"x" * 33)
    with pytest.raises(JournalUnsafeRestore):
        Journal.load(path)
    assert MAX_JOURNAL_BYTES == 64 * 1024 * 1024


def test_load_rejects_directory_journal(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    path.mkdir()
    with pytest.raises(JournalUnsafeRestore):
        Journal.load(path)


def test_prune_removes_trailing_host_error_sentinel(tmp_path: Path):
    path = tmp_path / "journal.jsonl"
    journal = Journal(path)
    journal.record(0, "spec_first", "aaaa", {"ok": True})
    journal.record(
        1, "spec_first", "bbbb", {HOST_ERROR_KEY: "scratch byte quota exceeded"}
    )
    loaded = Journal.load(path)
    assert loaded.prune_trailing_host_error(
        "Runtime error: scratch byte quota exceeded"
    )
    assert loaded.len() == 1
    after = path.read_text(encoding="utf-8")
    assert HOST_ERROR_KEY not in after
    assert after.count("\n") == 1


def test_prune_is_a_noop_when_last_entry_is_a_success():
    journal = Journal()
    journal.record(0, "spec_first", "aaaa", {HOST_ERROR_KEY: "caught"})
    journal.record(1, "spec_first", "bbbb", {"ok": True})
    assert not journal.prune_trailing_host_error("caught")
    assert journal.len() == 2


def test_journaled_call_records_host_error_then_reraises():
    journal = Journal()

    def boom():
        raise RuntimeError("structure gate")

    with pytest.raises(RuntimeError, match="structure gate"):
        journaled_call(journal, 0, "spec_first", {"tools": ["spec"]}, boom)
    assert journal.len() == 1
    with pytest.raises(JournalError, match="structure gate"):
        journaled_call(
            journal, 0, "spec_first", {"tools": ["spec"]}, lambda: {"ok": True}
        )


def test_journal_stays_a_leaf():
    """叶子不许依赖流水线。变异：journal 里 import run_spec_first → 本条红。"""
    from services import workflow_journal as wj

    src = inspect.getsource(wj)
    assert "run_spec_first" not in src
    assert "workflow_validate" not in src
    assert "workflow_select" not in src


def test_journal_scope_is_the_live_socket():
    journal = Journal()
    assert inspect.getsource(journal_scope)
    from services.workflow_journal import active_journal

    assert active_journal() is None
    with journal_scope(journal):
        assert active_journal() is journal
    assert active_journal() is None


def test_live_factory_path_goes_through_the_journal():
    """函数写对了 ≠ 它被调用了。变异：执行器里那两处调用删掉 → 本条红。"""
    from services.v5_capability_executor import _try_llm_generate_evidence
    from services.drive_full_factory import start_drive_full_factory_run

    exec_src = inspect.getsource(_try_llm_generate_evidence)
    assert "bind_orchestration(" in exec_src
    assert "journaled_call(" in exec_src
    assert "active_journal(" in exec_src
    drive_src = inspect.getsource(start_drive_full_factory_run)
    assert "journal_scope(" in drive_src
    assert "_workflow_journal_path(" in drive_src
    from services.drive_full_factory import _workflow_journal_path

    assert "workflow-journal.jsonl" in inspect.getsource(_workflow_journal_path)
