"""Workflow host-call journal. 叶子，不依赖 services 里任何其它模块。

抄 grok-build `xai-workflow` `journal.rs`：每条 `JournalEntry` 带 `seq` +
`req_hash`。重放时脚本发出的调用必须跟记录的一致，否则：

    replay divergence at seq {seq} ({kind}): the script issued a different
    call than the recorded run — nondeterministic or edited mid-run

建设单 O-8：没有这层，改了编排再续跑会安安静静接在错的地方——逐跳编排
天生就是「跑一半停下来问用户」。session_events 是 SSE wire 形状，职责
不同；真正对应 journal 的是本文件。

seq 0 钉 `fingerprint`（workflow 名 + 登记的 stages）。续跑先重放这条，
日历被改过就 divergence，不必把整段工厂再走一遍。
"""

from __future__ import annotations

import hashlib
import json
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, List, Optional, Sequence, Tuple, Union

MAX_JOURNAL_BYTES = 64 * 1024 * 1024
MAX_JOURNAL_ENTRIES = 10_000
HOST_ERROR_KEY = "__xai_workflow_host_error"

PathLike = Union[str, Path]


class JournalError(Exception):
    """journal.rs `JournalError` 的 Python 口。"""


class JournalDivergence(JournalError):
    """编排对不上记录。不许静默接上。"""

    def __init__(self, seq: int, kind: str) -> None:
        self.seq = seq
        self.kind = kind
        super().__init__(
            f"replay divergence at seq {seq} ({kind}): the script issued a "
            "different call than the recorded run — the workflow script is "
            "nondeterministic or was edited mid-run"
        )


class JournalSequenceError(JournalError):
    def __init__(self, index: int, expected: int, actual: int) -> None:
        self.index = index
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"journal is not dense at entry {index}: expected sequence "
            f"{expected}, found {actual}"
        )


class JournalParseError(JournalError):
    def __init__(self, line: int, error: str) -> None:
        self.line = line
        self.error = error
        super().__init__(f"journal parse at line {line}: {error}")


class JournalFull(JournalError):
    def __init__(self, seq: int, limit: int) -> None:
        self.seq = seq
        self.limit = limit
        super().__init__(
            f"journal full: appending seq {seq} would exceed the {limit}-byte "
            "cap that restore enforces, which would strand the run unresumable"
        )


class JournalUnsafeRestore(JournalError):
    def __init__(self, limit: int, reason: str) -> None:
        self.limit = limit
        self.reason = reason
        super().__init__(f"journal restore rejected (limit {limit}): {reason}")


@dataclass
class JournalEntry:
    seq: int
    kind: str
    req_hash: str
    result: Any
    at_ms: int

    def to_json(self) -> dict:
        return {
            "seq": self.seq,
            "kind": self.kind,
            "req_hash": self.req_hash,
            "result": self.result,
            "at_ms": self.at_ms,
        }

    @classmethod
    def from_json(cls, raw: Any) -> "JournalEntry":
        if not isinstance(raw, dict):
            raise ValueError("journal entry must be an object")
        return cls(
            seq=int(raw["seq"]),
            kind=str(raw["kind"]),
            req_hash=str(raw["req_hash"]),
            result=raw.get("result"),
            at_ms=int(raw.get("at_ms") or 0),
        )


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def request_hash(kind: str, payload: Any) -> str:
    digest = hashlib.sha256()
    digest.update(str(kind).encode("utf-8"))
    digest.update(b"\x00")
    digest.update(canonical_json(payload).encode("utf-8"))
    return digest.hexdigest()[:32]


def hop_payload(tools: Sequence[str], workflow: str) -> dict:
    return {"tools": [str(item) for item in tools], "workflow": str(workflow or "")}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _validate_sequence(entries: Sequence[JournalEntry], entry: JournalEntry) -> None:
    expected = len(entries)
    if entry.seq != expected:
        raise JournalSequenceError(expected, expected, entry.seq)


class Journal:
    def __init__(self, path: Optional[PathLike] = None) -> None:
        self.entries: List[JournalEntry] = []
        self.path = Path(path) if path else None
        self.bytes = 0
        self.last_line_start: Optional[int] = None

    def len(self) -> int:
        return len(self.entries)

    def __len__(self) -> int:
        return len(self.entries)

    def is_empty(self) -> bool:
        return not self.entries

    def covers(self, seq: int) -> bool:
        return 0 <= seq < len(self.entries)

    @classmethod
    def load(cls, path: PathLike) -> "Journal":
        target = Path(path)
        journal = cls(target)
        if not target.exists():
            return journal
        content = _read_journal_bounded(target)
        offset = 0
        line_number = 0
        nbytes = len(content)
        last_line_start: Optional[int] = None
        while offset < len(content):
            line_number += 1
            rel = content.find(b"\n", offset)
            if rel < 0:
                tail = content[offset:]
                if not tail.strip():
                    _truncate_tail(target, offset)
                    nbytes = offset
                    break
                try:
                    entry = JournalEntry.from_json(json.loads(tail.decode("utf-8")))
                except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError, TypeError):
                    _truncate_tail(target, offset)
                    nbytes = offset
                    break
                if len(journal.entries) >= MAX_JOURNAL_ENTRIES:
                    raise JournalUnsafeRestore(
                        MAX_JOURNAL_ENTRIES, "too many journal entries"
                    )
                _validate_sequence(journal.entries, entry)
                journal.entries.append(entry)
                last_line_start = offset
                _terminate_line(target)
                nbytes = nbytes + 1
                break
            end = rel
            line = content[offset:end]
            line_start = offset
            offset = end + 1
            if not line.strip():
                continue
            try:
                entry = JournalEntry.from_json(json.loads(line.decode("utf-8")))
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
                raise JournalParseError(line_number, str(exc)) from exc
            if len(journal.entries) >= MAX_JOURNAL_ENTRIES:
                raise JournalUnsafeRestore(
                    MAX_JOURNAL_ENTRIES, "too many journal entries"
                )
            _validate_sequence(journal.entries, entry)
            journal.entries.append(entry)
            last_line_start = line_start
        journal.bytes = nbytes
        journal.last_line_start = last_line_start
        return journal

    def replay(self, seq: int, kind: str, req_hash: str) -> Optional[Any]:
        if not self.covers(seq):
            return None
        entry = self.entries[seq]
        if entry.seq != seq or entry.kind != kind or entry.req_hash != req_hash:
            raise JournalDivergence(seq, kind)
        return entry.result

    def record(self, seq: int, kind: str, req_hash: str, result: Any) -> None:
        frozen = json.loads(canonical_json(result))
        entry = JournalEntry(
            seq=int(seq),
            kind=str(kind),
            req_hash=str(req_hash),
            result=frozen,
            at_ms=_now_ms(),
        )
        _validate_sequence(self.entries, entry)
        line = canonical_json(entry.to_json()) + "\n"
        encoded = line.encode("utf-8")
        if self.bytes + len(encoded) > MAX_JOURNAL_BYTES:
            raise JournalFull(seq, MAX_JOURNAL_BYTES)
        if self.path is not None:
            _append_line(self.path, encoded)
        self.last_line_start = self.bytes
        self.bytes += len(encoded)
        self.entries.append(entry)

    def prune_trailing_host_error(self, failure_detail: str) -> bool:
        if not self.entries:
            return False
        last = self.entries[-1]
        message = ""
        if isinstance(last.result, dict):
            raw = last.result.get(HOST_ERROR_KEY)
            message = str(raw) if raw is not None else ""
        if not message or message not in str(failure_detail or ""):
            return False
        if self.last_line_start is None:
            raise JournalError(
                "journal cannot locate the trailing entry's byte offset"
            )
        if self.path is not None:
            _truncate_tail(self.path, self.last_line_start)
        self.entries.pop()
        self.bytes = self.last_line_start
        self.last_line_start = None
        return True


def _read_journal_bounded(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise JournalUnsafeRestore(
            MAX_JOURNAL_BYTES, f"journal is not a regular file: {path}"
        )
    size = path.stat().st_size
    if size > MAX_JOURNAL_BYTES:
        raise JournalUnsafeRestore(
            MAX_JOURNAL_BYTES, f"journal exceeds {MAX_JOURNAL_BYTES} bytes"
        )
    data = path.read_bytes()
    if len(data) > MAX_JOURNAL_BYTES:
        raise JournalUnsafeRestore(
            MAX_JOURNAL_BYTES, f"journal exceeds {MAX_JOURNAL_BYTES} bytes"
        )
    return data


def _truncate_tail(path: Path, length: int) -> None:
    with path.open("r+b") as handle:
        handle.truncate(length)


def _terminate_line(path: Path) -> None:
    with path.open("ab") as handle:
        handle.write(b"\n")


def _append_line(path: Path, encoded: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as handle:
        handle.write(encoded)


def replay_host_error(recorded: Any) -> Optional[str]:
    if isinstance(recorded, dict):
        message = recorded.get(HOST_ERROR_KEY)
        if isinstance(message, str) and message:
            return message
    return None


def journaled_call(
    journal: Journal,
    seq: int,
    kind: str,
    payload: Any,
    execute: Callable[[], Any],
) -> Any:
    """grok `host_call`：覆盖到的 seq 重放；否则真跑并落盘。

    重放命中 divergence 直接抛，不许打到 execute——建设单 O-8 反向闸。
    """
    hashed = request_hash(kind, payload)
    replayed = journal.replay(seq, kind, hashed)
    if replayed is not None:
        error = replay_host_error(replayed)
        if error:
            raise JournalError(error)
        return replayed
    try:
        value = execute()
    except JournalError:
        raise
    except Exception as exc:
        journal.record(seq, kind, hashed, {HOST_ERROR_KEY: str(exc)})
        raise
    journal.record(seq, kind, hashed, value)
    return value


def walk_hops(
    journal: Journal,
    hops: Sequence[Tuple[str, Any]],
    execute: Callable[[str, Any], Any],
) -> List[Any]:
    """按脚本从 seq 0 重走。改编排 → 在被改的那一跳 divergence。"""
    results: List[Any] = []
    for seq, (kind, payload) in enumerate(hops):
        results.append(
            journaled_call(
                journal,
                seq,
                kind,
                payload,
                lambda k=kind, p=payload: execute(k, p),
            )
        )
    return results


def bind_orchestration(
    journal: Journal, workflow: str, stages: Sequence[str]
) -> Any:
    """seq 0 钉死本趟日历。改 stages / 名字再续跑必须 divergence。"""
    return journaled_call(
        journal,
        0,
        "fingerprint",
        {"workflow": str(workflow or ""), "stages": list(stages)},
        lambda: {"ok": True},
    )


_ACTIVE: ContextVar[Optional[Journal]] = ContextVar(
    "workflow_journal", default=None
)


@contextmanager
def journal_scope(journal: Journal) -> Iterator[Journal]:
    token = _ACTIVE.set(journal)
    try:
        yield journal
    finally:
        _ACTIVE.reset(token)


def active_journal() -> Optional[Journal]:
    return _ACTIVE.get()


__all__ = [
    "HOST_ERROR_KEY",
    "MAX_JOURNAL_BYTES",
    "MAX_JOURNAL_ENTRIES",
    "Journal",
    "JournalDivergence",
    "JournalEntry",
    "JournalError",
    "JournalFull",
    "JournalParseError",
    "JournalSequenceError",
    "JournalUnsafeRestore",
    "active_journal",
    "bind_orchestration",
    "canonical_json",
    "hop_payload",
    "journal_scope",
    "journaled_call",
    "request_hash",
    "walk_hops",
]
