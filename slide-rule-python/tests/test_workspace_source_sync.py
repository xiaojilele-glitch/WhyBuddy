"""Exercise SDK dispatch and, on Linux, the exact remote source synchronizer.

The old manifest is a complete expected source tree, not merely touched files.
Untracked runtime data stays outside the operation. Linux cases use actual fds,
links and filesystem failures; a Windows skip is not Linux execution evidence.
"""

import hashlib
import json
import os
import shlex
import subprocess
import sys

import pytest
from e2b.sandbox.commands.command_handle import CommandExitException

from services import e2b_workspace_provider as module
from services.workspace_provider import PROJECT_REVISION_FILE, WorkspaceProviderError
from test_workspace_provider import completed, setup_provider

MARKER = PROJECT_REVISION_FILE
OLD = {"src/a.ts": "export const value = 1;", "src/keep.ts": "keep",
       "src/remove.ts": "remove", MARKER: '{"revision":"old"}'}
NEW = {"src/a.ts": "export const value = 2;", "src/keep.ts": "keep",
       "nested/new.ts": "new", MARKER: '{"revision":"new"}'}
linux = pytest.mark.skipif(sys.platform != "linux", reason="actual synchronizer requires Linux dir_fd/O_NOFOLLOW")


def capture_payload(setup_provider, old=None, new=None):
    provider, handle, fake, _ = setup_provider
    fake.process.input = ""
    fake.process.result = completed(stdout='{"status":"ok"}')
    provider.sync_files(handle, expected_files=OLD if old is None else old, files=NEW if new is None else new)
    return json.loads(fake.process.input)


def test_sync_dispatches_fixed_helper_with_bounded_stdin_and_complete_hashes(setup_provider, monkeypatch):
    provider, _, fake, _ = setup_provider
    chunks = []
    send = fake.process.send_stdin
    monkeypatch.setattr(fake.process, "send_stdin", lambda value: (chunks.append(value), send(value)))
    new = {**NEW, "unicode.txt": "\u4e2d" * 30_000 + "`$(cat /secret)`"}
    root, marker, old, proposed = capture_payload(setup_provider, new=new)
    assert root == module.PROJECT_ROOT and marker == MARKER
    assert set(old) == set(OLD) and set(proposed) == set(new)
    assert old["src/keep.ts"] == {"sha256": hashlib.sha256(b"keep").hexdigest(), "size": 4}
    assert proposed["unicode.txt"]["content"] == new["unicode.txt"]
    assert all(0 < len(value) <= 32 * 1024 for value in chunks) and len(chunks) > 1
    assert shlex.split(fake.calls[0][0]) == ["python3", "-I", "-S", "-c", module._SYNC_SCRIPT]
    assert fake.calls[0][1] == {"cwd": "/home/user", "background": True, "stdin": True, "timeout": 60}
    assert "cat /secret" not in fake.calls[0][0] and fake.process.closed
    assert "provider-test-key" not in fake.process.input
    compile(module._SYNC_SCRIPT, "source-sync-helper", "exec")


@pytest.mark.parametrize("side", ["old", "new"])
@pytest.mark.parametrize("path", ["../escape", "/outside", "nested\\escape", "node_modules/lib.js", ".env", ".git/config"])
def test_unsafe_manifest_paths_fail_before_remote_io(setup_provider, side, path):
    provider, handle, fake, _ = setup_provider
    old, new = dict(OLD), dict(NEW)
    (old if side == "old" else new)[path] = "unsafe"
    with pytest.raises(ValueError):
        provider.sync_files(handle, expected_files=old, files=new)
    assert not fake.calls


@pytest.mark.parametrize("change", ["missing-old-marker", "missing-new-marker", "unchanged-marker", "oversized-file"])
def test_revision_and_size_contracts_precede_sdk_access(setup_provider, change):
    provider, handle, fake, _ = setup_provider
    old, new = dict(OLD), dict(NEW)
    if change == "missing-old-marker": del old[MARKER]
    if change == "missing-new-marker": del new[MARKER]
    if change == "unchanged-marker": new[MARKER] = old[MARKER]
    if change == "oversized-file": new["huge.txt"] = "a" * (512 * 1024 + 1)
    with pytest.raises(ValueError):
        provider.sync_files(handle, expected_files=old, files=new)
    assert not fake.calls


def test_sync_payload_limit_is_checked_before_sdk_access(setup_provider, monkeypatch):
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "MAX_SYNC_PAYLOAD_BYTES", 100)
    with pytest.raises(ValueError, match="payload_too_large"):
        provider.sync_files(handle, expected_files=OLD, files=NEW)
    assert not fake.calls


@pytest.mark.parametrize("code", ["e2b_source_sync_conflict", "e2b_source_sync_partial"])
def test_remote_failure_returns_only_fixed_code_and_exit_status(setup_provider, code):
    provider, handle, fake, _ = setup_provider
    fake.process.result = CommandExitException(stdout=json.dumps({"code": code}),
        stderr="provider-test-key and private source text", exit_code=1, error=None)
    with pytest.raises(WorkspaceProviderError, match=code) as caught:
        provider.sync_files(handle, expected_files=OLD, files=NEW)
    assert caught.value.result.exit_code == 1
    assert caught.value.result.stdout == caught.value.result.stderr == ""
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


@pytest.mark.parametrize("result", [
    RuntimeError("api_key=provider-test-key private source text"),
    completed(stdout="private source text", exit_code=1),
    completed(stdout='{"status":"ok","secret":"private"}'),
    completed(stdout='{"status":"ok"}', exit_code=1),
    completed(stdout='{"code":"e2b_source_sync_partial"}', exit_code=0),
    completed(stdout="x" * 257),
])
def test_missing_or_forged_receipt_is_uncertain_without_retry_or_error_leak(setup_provider, result):
    provider, handle, fake, _ = setup_provider
    fake.process.result = result
    with pytest.raises(WorkspaceProviderError, match="e2b_source_sync_uncertain") as caught:
        provider.sync_files(handle, expected_files=OLD, files=NEW)
    assert len(fake.calls) == 1
    assert caught.value.result is None
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def materialize(root, files):
    root.mkdir()
    for path, content in files.items():
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")


def remote(setup_provider, root, *, old=None, new=None, prefix=""):
    payload = capture_payload(setup_provider, old=old, new=new)
    payload[0] = str(root)
    return subprocess.run([sys.executable, "-I", "-S", "-c", prefix + module._SYNC_SCRIPT],
        input=json.dumps(payload), text=True, capture_output=True, timeout=10)


@linux
def test_actual_helper_adds_replaces_deletes_and_publishes_revision_last(setup_provider, tmp_path):
    root = tmp_path / "project"
    materialize(root, OLD)
    (root / "node_modules").mkdir()
    (root / "node_modules/keep.js").write_text("dependency")
    (root / "business.db").write_bytes(b"\x00business-data")
    before_keep = (root / "src/keep.ts").stat()
    prefix = '''
import os
real_replace = os.replace
def checked_replace(src, dst, **kwargs):
    if dst == "__whybuddy_revision.json":
        parent = kwargs["dst_dir_fd"]
        project = os.open("..", os.O_RDONLY | os.O_DIRECTORY, dir_fd=parent)
        try:
            assert not os.path.exists("/proc/self/fd/" + str(project) + "/src/remove.ts")
            assert open("/proc/self/fd/" + str(project) + "/src/a.ts").read() == "export const value = 2;"
            assert open("/proc/self/fd/" + str(project) + "/nested/new.ts").read() == "new"
        finally: os.close(project)
    return real_replace(src, dst, **kwargs)
os.replace = checked_replace
'''
    result = remote(setup_provider, root, prefix=prefix)
    assert result.returncode == 0 and json.loads(result.stdout) == {"status": "ok"}, result.stderr
    assert all((root / path).read_text(encoding="utf-8") == text for path, text in NEW.items())
    assert not (root / "src/remove.ts").exists()
    assert (root / "src/keep.ts").stat().st_ino == before_keep.st_ino
    assert (root / "src/keep.ts").stat().st_mtime_ns == before_keep.st_mtime_ns
    assert (root / "node_modules/keep.js").read_text() == "dependency"
    assert (root / "business.db").read_bytes() == b"\x00business-data"


@linux
@pytest.mark.parametrize("damage", ["unchanged-hash", "missing", "symlink-file", "symlink-parent", "hardlink", "new-collision", "new-directory", "fifo"])
def test_preflight_validates_entire_old_tree_and_new_targets_before_any_write(setup_provider, tmp_path, damage):
    root = tmp_path / "project"
    materialize(root, OLD)
    outside = tmp_path / "outside.txt"
    outside.write_text("keep")
    target = root / "src/keep.ts"
    if damage == "unchanged-hash": target.write_text("oops")
    elif damage == "missing": target.unlink()
    elif damage == "symlink-file":
        target.unlink(); target.symlink_to(outside)
    elif damage == "hardlink":
        target.unlink(); os.link(outside, target)
    elif damage == "fifo":
        target.unlink(); os.mkfifo(target)
    elif damage == "symlink-parent":
        (root / "src").rename(tmp_path / "outside-src")
        (root / "src").symlink_to(tmp_path / "outside-src", target_is_directory=True)
    else:
        (root / "nested").mkdir()
        if damage == "new-directory": (root / "nested/new.ts").mkdir()
        else: (root / "nested/new.ts").write_text("runtime-owned")
    result = remote(setup_provider, root)
    assert result.returncode == 1 and json.loads(result.stdout) == {"code": "e2b_source_sync_conflict"}
    assert not result.stderr
    assert (root / "src/a.ts").read_text() == OLD["src/a.ts"]
    assert (root / MARKER).read_text() == OLD[MARKER]
    assert outside.read_text() == "keep"


@linux
def test_root_symlink_cannot_redirect_the_source_operation(setup_provider, tmp_path):
    outside = tmp_path / "outside"
    materialize(outside, OLD)
    root = tmp_path / "project"
    root.symlink_to(outside, target_is_directory=True)
    result = remote(setup_provider, root)
    assert json.loads(result.stdout) == {"code": "e2b_source_sync_conflict"}
    assert all((outside / path).read_text() == text for path, text in OLD.items())


@linux
def test_partial_replace_failure_keeps_old_revision_and_reports_uncertain_tree(setup_provider, tmp_path):
    root = tmp_path / "project"
    materialize(root, OLD)
    prefix = '''
import os
real_replace = os.replace
def fail_source_replace(src, dst, **kwargs):
    if dst == "a.ts": raise OSError("secret source text must not escape")
    return real_replace(src, dst, **kwargs)
os.replace = fail_source_replace
'''
    result = remote(setup_provider, root, prefix=prefix)
    assert result.returncode == 1 and json.loads(result.stdout) == {"code": "e2b_source_sync_partial"}
    assert not result.stderr
    assert (root / "nested/new.ts").read_text() == "new"
    assert (root / MARKER).read_text() == OLD[MARKER]
    assert not list(root.rglob(".wb-sync-*"))


@linux
def test_new_file_race_never_overwrites_the_untracked_winner(setup_provider, tmp_path):
    root = tmp_path / "project"
    materialize(root, OLD)
    prefix = '''
import os
real_link = os.link
def collision(src, dst, **kwargs):
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=kwargs["dst_dir_fd"])
    os.write(fd, b"untracked-winner"); os.close(fd)
    return real_link(src, dst, **kwargs)
os.link = collision
'''
    result = remote(setup_provider, root, prefix=prefix)
    assert json.loads(result.stdout) == {"code": "e2b_source_sync_partial"}
    assert (root / "nested/new.ts").read_text() == "untracked-winner"
    assert (root / MARKER).read_text() == OLD[MARKER]


@linux
def test_identical_manifests_verify_without_writing_any_file(setup_provider, tmp_path):
    root = tmp_path / "project"
    materialize(root, OLD)
    before = {path: (root / path).stat().st_mtime_ns for path in OLD}
    result = remote(setup_provider, root, new=OLD)
    assert result.returncode == 0
    assert {path: (root / path).stat().st_mtime_ns for path in OLD} == before
