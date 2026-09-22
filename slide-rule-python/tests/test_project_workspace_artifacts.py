"""Bounded provider IO contracts; real Linux path checks run in the E2B smoke."""
import base64
import json
from types import SimpleNamespace

import pytest

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_workspace_artifacts import MAX_APPLICATION_DATA_BYTES
from services.workspace_provider import WorkspaceHandle, WorkspaceProviderError


@pytest.fixture
def artifact_provider():
    provider = E2BWorkspaceProvider(api_key="fixture")
    handle = WorkspaceHandle("workspace-fixture", "sandbox-fixture")
    calls, sent = [], []
    reply = SimpleNamespace(exit_code=0, stdout=json.dumps({"ok": True}))
    process = SimpleNamespace(send_stdin=sent.append, close_stdin=lambda: None, wait=lambda: reply)
    def run(command, **options):
        calls.append((command, options))
        return process
    provider._sandboxes[handle.sandbox_id] = SimpleNamespace(commands=SimpleNamespace(run=run))
    return SimpleNamespace(provider=provider, handle=handle, calls=calls, sent=sent, reply=reply)


def test_restore_uses_chunked_stdin_and_preserves_more_than_log_truncation_limit(artifact_provider):
    f = artifact_provider
    data = b"SQLite format 3\x00" + bytes(range(256)) * 1024
    f.provider.write_application_data(f.handle, data)
    payload = json.loads("".join(f.sent))
    assert base64.b64decode(payload["data"]) == data
    assert payload["action"] == "write-data" and payload["root"] == "/home/user/workspace"
    assert len(f.sent) > 1 and all(len(part) <= 32768 for part in f.sent)
    assert payload["data"] not in f.calls[0][0]
    assert f.calls[0][1] == {"cwd": "/home/user", "background": True, "stdin": True, "timeout": 60}
    f.reply.stdout = json.dumps({"data": base64.b64encode(data).decode()})
    assert f.provider.read_application_data(f.handle) == data


@pytest.mark.parametrize("data", [b"not SQLite", "SQLite format 3\x00", b"SQLite format 3\x00" + b"x" * MAX_APPLICATION_DATA_BYTES],
    ids=["wrong-header", "not-bytes", "over-limit"])
def test_invalid_or_oversized_database_is_rejected_before_remote_io(artifact_provider, data):
    f = artifact_provider
    with pytest.raises(ValueError):
        f.provider.write_application_data(f.handle, data)
    assert not f.calls


@pytest.mark.parametrize("reply", [{"data": "%%"}, {"data": "cGFzc2Vk"}, {"data": True}, {"data": None, "unexpected": 1}])
def test_database_read_never_accepts_arbitrary_remote_output(artifact_provider, reply):
    f = artifact_provider
    f.reply.stdout = json.dumps(reply)
    with pytest.raises(WorkspaceProviderError):
        f.provider.read_application_data(f.handle)


@pytest.mark.parametrize("change", [{"outputHash": "passed"}, {"fileCount": 0}, {"fileCount": True},
    {"sizeBytes": 104857601}, {"sizeBytes": False}, {"extra": True}])
def test_dist_descriptor_requires_bounded_exact_fields(artifact_provider, change):
    f = artifact_provider
    f.reply.stdout = json.dumps({"outputHash": "a" * 64, "fileCount": 2, "sizeBytes": 200, **change})
    with pytest.raises(WorkspaceProviderError):
        f.provider.inspect_build_output(f.handle, revision="revision-fixture")


@pytest.mark.parametrize("identity", ["../application", "x/../../outside", "x; cat /etc/passwd", "x" * 101])
def test_verification_identity_cannot_become_an_arbitrary_remote_path(artifact_provider, identity):
    f = artifact_provider
    with pytest.raises(ValueError):
        f.provider.prepare_verification(f.handle, identity)
    with pytest.raises(ValueError):
        f.provider.cleanup_verification_data(f.handle, identity)
    with pytest.raises(ValueError):
        f.provider.start_verification_server(f.handle, verification_id=identity, suite_version="react-vite-tasks@1", port=5173)
    assert not f.calls


def test_tasks_server_uses_dist_and_separate_verification_database(artifact_provider, monkeypatch):
    f = artifact_provider
    starts = []
    monkeypatch.setattr(f.provider, "start_process", lambda handle, command, **kwargs: starts.append((command, kwargs)))
    f.provider.start_verification_server(f.handle, verification_id="pvo-1", suite_version="react-vite-tasks@1", port=5199)
    assert starts == [("npm start -- --host 0.0.0.0 --port 5199 --static-dir /home/user/workspace/dist "
        "--data-dir /home/user/.whybuddy-verification/pvo-1/data", {"timeout_seconds": 900})]
