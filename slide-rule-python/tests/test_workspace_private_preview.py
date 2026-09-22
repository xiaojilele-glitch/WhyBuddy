"""Private ingress resolution fails closed before a gateway can publish access.

These cases exercise the provider's real method with SDK-shaped metadata. They
do not claim a cloud request or ownership checks, which belong to the runtime
authority. The separate E2B smoke checks HTTP/WS and credential stripping.
"""

from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

import pytest

from services import e2b_workspace_provider as module
from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.workspace_provider import PrivatePreviewTarget, WorkspaceHandle, WorkspaceProviderError


@pytest.fixture
def fixture(monkeypatch):
    info = SimpleNamespace(sandbox_id="sandbox-1", state="running",
        metadata={"whybuddy_workspace_id": "workspace-1"}, network={"allow_public_traffic": False},
        end_at=datetime.now(timezone.utc) + timedelta(minutes=5))
    calls = []

    def get_info(**kwargs):
        calls.append(("info", kwargs))
        return info

    sandbox = SimpleNamespace(sandbox_id="sandbox-1", sandbox_domain="e2b.app",
        traffic_access_token="secret-traffic-fixture", get_info=get_info,
        get_host=lambda port: f"{port}-sandbox-1.e2b.app")

    def connect(sandbox_id, **kwargs):
        calls.append(("connect", sandbox_id, kwargs))
        return sandbox

    monkeypatch.setattr(module, "_sandbox_class", lambda: SimpleNamespace(connect=connect))
    provider = E2BWorkspaceProvider(api_key="secret-management-fixture")
    provider._sandboxes[sandbox.sandbox_id] = sandbox
    return SimpleNamespace(provider=provider, sandbox=sandbox, info=info, calls=calls,
        handle=WorkspaceHandle("workspace-1", "sandbox-1"))


@pytest.mark.parametrize("fresh", [False, True])
def test_private_target_binds_identity_port_private_ingress_and_expiry(fixture, fresh):
    if fresh:
        fixture.provider._sandboxes.clear()
        fixture.provider.connect(fixture.handle, timeout_seconds=300)
    target = fixture.provider.private_preview_target(fixture.handle, 5173)
    assert isinstance(target, PrivatePreviewTarget)
    assert (target.workspace_id, target.sandbox_id, target.port, target.origin) == (
        "workspace-1", "sandbox-1", 5173, "https://5173-sandbox-1.e2b.app")
    assert target.expires_at == fixture.info.end_at.timestamp()
    assert target.headers() == {"E2B-Traffic-Access-Token": "secret-traffic-fixture"}
    assert "secret-traffic-fixture" not in repr(target)
    assert "secret-management-fixture" not in repr(target)
    assert not hasattr(target, "__dict__")
    with pytest.raises(TypeError):
        json.dumps(target)
    assert sum(call[0] == "connect" for call in fixture.calls) == int(fresh)
    assert fixture.calls[-1] == ("info", {"request_timeout": 20})


@pytest.mark.parametrize("port", [True, False, 0, 80, 1023, 65536, -1, "5173", 5173.0, None])
def test_invalid_ports_never_reach_sdk(fixture, port):
    with pytest.raises(ValueError, match="invalid_preview_port"):
        fixture.provider.private_preview_target(fixture.handle, port)
    assert not fixture.calls


@pytest.mark.parametrize("change", [
    {"sandbox_id": "another-sandbox"}, {"metadata": {}},
    {"metadata": {"whybuddy_workspace_id": "other-workspace"}}, {"metadata": None},
])
def test_wrong_persisted_workspace_identity_is_refused(fixture, change):
    fixture.info.__dict__.update(change)
    with pytest.raises(WorkspaceProviderError, match="preview_identity_mismatch"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


@pytest.mark.parametrize("network", [{"allow_public_traffic": True}, {"allow_public_traffic": 0}, {}, None])
def test_public_or_unknown_ingress_never_returns_token(fixture, network):
    fixture.info.network = network
    with pytest.raises(WorkspaceProviderError, match="private_ingress_required"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


@pytest.mark.parametrize("end_at", [None, "tomorrow", datetime.now(),
    datetime.now(timezone.utc) - timedelta(seconds=1)])
def test_expired_or_unverifiable_lifetime_is_refused(fixture, end_at):
    fixture.info.end_at = end_at
    with pytest.raises(WorkspaceProviderError, match="sandbox_not_running"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


def test_paused_sandbox_does_not_claim_ready_ingress(fixture):
    fixture.info.state = "paused"
    with pytest.raises(WorkspaceProviderError, match="sandbox_not_running"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


@pytest.mark.parametrize("token", [None, "", " ", "with space", "token\r\nInjected: yes", "中文", "x" * 8193],
    ids=["none", "empty", "blank", "space", "crlf", "unicode", "overlong"])
def test_missing_or_unsafe_token_is_refused_without_secret_in_exception(fixture, token):
    fixture.sandbox.traffic_access_token = token
    with pytest.raises(WorkspaceProviderError, match="traffic_token_unavailable") as caught:
        fixture.provider.private_preview_target(fixture.handle, 5173)
    assert str(caught.value) == "e2b_preview_traffic_token_unavailable"


@pytest.mark.parametrize("host", ["https://evil.example", "good.example@evil.example",
    "evil.example/path", "evil.example#fragment", "5173-other.e2b.app",
    "80-sandbox-1.e2b.app", "5173-sandbox-1.evil.example", "127.0.0.1", "localhost"])
def test_host_must_match_registered_sandbox_and_port(fixture, host):
    fixture.sandbox.get_host = lambda port: host
    with pytest.raises(WorkspaceProviderError, match="invalid_preview_host"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


@pytest.mark.parametrize("domain", [None, "127.0.0.1", "localhost", "evil.example/path", "-bad.example"])
def test_unverifiable_provider_domain_is_refused(fixture, domain):
    fixture.sandbox.sandbox_domain = domain
    with pytest.raises(WorkspaceProviderError, match="invalid_preview_host"):
        fixture.provider.private_preview_target(fixture.handle, 5173)


def test_sdk_error_cannot_put_credentials_in_public_error(fixture):
    def failed(**kwargs):
        raise OSError("secret-traffic-fixture secret-management-fixture")
    fixture.sandbox.get_info = failed
    with pytest.raises(WorkspaceProviderError) as caught:
        fixture.provider.private_preview_target(fixture.handle, 5173)
    assert str(caught.value) == "e2b_private_preview_unavailable"
    assert caught.value.__suppress_context__ is True


@pytest.mark.parametrize("state,metadata", [("running", "workspace-1"), ("paused", "workspace-1"), ("paused", "other-workspace")])
def test_fresh_target_does_not_resume_extend_or_connect(fixture, monkeypatch, state, metadata):
    fixture.provider._sandboxes.clear()
    fixture.info.state = state
    fixture.info.metadata = {"whybuddy_workspace_id": metadata}
    original_expiry = fixture.info.end_at
    calls = []
    # SDK connect is a mutating POST: paused -> running and a longer timeout.
    # Making this behavior real in the fixture catches the original _sandbox()
    # bug instead of hiding it behind a connect that simply returns an object.
    def sdk_connect(*args, **kwargs):
        calls.append((args, kwargs))
        fixture.info.state = "running"
        fixture.info.end_at += timedelta(seconds=900)
        return fixture.sandbox
    monkeypatch.setattr(module, "_sandbox_class", lambda: SimpleNamespace(connect=sdk_connect))
    with pytest.raises(WorkspaceProviderError, match="e2b_preview_connection_required"):
        fixture.provider.private_preview_target(fixture.handle, 5173)
    assert not calls and not fixture.calls
    assert fixture.info.state == state and fixture.info.end_at == original_expiry


def test_cached_target_only_reads_metadata_without_lifetime_change(fixture):
    original_expiry = fixture.info.end_at
    first = fixture.provider.private_preview_target(fixture.handle, 5173)
    second = fixture.provider.private_preview_target(fixture.handle, 5173)
    assert first.expires_at == second.expires_at == original_expiry.timestamp()
    assert fixture.calls == [("info", {"request_timeout": 20})] * 2


def test_nested_sdk_failure_cannot_leak_credentials(fixture):
    import traceback
    def failed(*args, **kwargs):
        try:
            raise OSError("secret-traffic-fixture secret-management-fixture")
        except OSError as exc:
            raise WorkspaceProviderError("e2b_metadata_failed") from exc
    fixture.sandbox.get_info = failed
    with pytest.raises(WorkspaceProviderError, match="e2b_metadata_failed") as caught:
        fixture.provider.private_preview_target(fixture.handle, 5173)
    rendered = "".join(traceback.format_exception(caught.value))
    assert "secret-traffic-fixture" not in rendered
    assert "secret-management-fixture" not in rendered
