"""A model/app cannot author browser evidence or retain an orphan verifier.

Actual Chrome drives the fixed runner in browser-runner.test.mjs. These tests
exercise the production provider's SDK dispatch, bounded receipt decoding,
callback cancellation, lost-create-response discovery, and cleanup boundary.
"""
import base64
import json
import threading
from types import SimpleNamespace

import pytest

from services.project_browser_provider import (
    ASSERTION_IDS, BUNDLE, E2BProjectBrowserProvider, MAX_IMAGE_BYTES,
    METADATA_KIND, REMOTE_ROOT, RUNNER_VERSION, SUITE_VERSION, decode_result,
)
from services.project_verification_gate import SUITE_ASSERTIONS

REVISION = "prv-" + "a" * 32
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")


def receipt():
    return {"verificationId": "verification-1", "revision": REVISION, "suiteVersion": SUITE_VERSION,
        "runnerVersion": RUNNER_VERSION, "status": "passed", "errorCode": None,
        "assertions": [{"id": key, "status": "passed"} for key in sorted(ASSERTION_IDS)],
        "artifacts": {key: base64.b64encode(PNG).decode() for key in ["before.png", "after.png"]},
        "cleanupConfirmed": True, "revisionBefore": REVISION, "revisionAfter": REVISION}


class Command:
    pid = 43

    def __init__(self, sdk):
        self.sdk, self.killed, self.disconnected = sdk, False, False
        self.release = threading.Event()
        if not sdk.hold:
            self.release.set()

    def wait(self, on_stdout, on_stderr):
        self.release.wait(5)
        output = json.dumps(self.sdk.report)
        on_stdout(output)
        return SimpleNamespace(stdout=output, stderr="", exit_code=0)

    def kill(self):
        self.killed = True
        self.release.set()
        return True

    def disconnect(self):
        self.disconnected = True
        self.release.set()


class Sandbox:
    def __init__(self, sdk, identity):
        self.sdk, self.sandbox_id = sdk, identity
        self.files = SimpleNamespace(write=self.write)
        self.commands = SimpleNamespace(run=self.run)

    def write(self, path, text, **kwargs):
        self.sdk.writes[path] = text

    def run(self, command, **kwargs):
        self.sdk.command = (command, kwargs)
        self.sdk.handle = Command(self.sdk)
        return self.sdk.handle

    def kill(self, **kwargs):
        return self.sdk.kill(self.sandbox_id, **kwargs)


class SDK:
    def __init__(self):
        self.records = {"generated-app": {"whybuddy_workspace_id": "application-workspace"}}
        self.calls, self.writes, self.report = [], {}, receipt()
        self.hold = self.drop_response = self.late_create = self.kill_failure = self.foreign_discovery = False
        self.handle, self.command = None, None

    def create(self, **kwargs):
        self.calls.append(("create", kwargs))
        if self.late_create:
            raise RuntimeError("manager-key-canary connection timeout")
        self.records["verifier-1"] = kwargs["metadata"]
        if self.drop_response:
            raise RuntimeError("manager-key-canary response dropped")
        return Sandbox(self, "verifier-1")

    def list(self, *, query, **kwargs):
        self.calls.append(("list", None))
        selected = [SimpleNamespace(sandbox_id=key, metadata=value) for key, value in self.records.items()
            if self.foreign_discovery or all(value.get(k) == v for k, v in query.metadata.items())]
        pages = SimpleNamespace(has_next=True)
        def next_items():
            pages.has_next = False
            return selected
        pages.next_items = next_items
        return pages

    def kill(self, identity, **kwargs):
        self.calls.append(("kill", identity))
        if self.kill_failure:
            raise RuntimeError("manager-key-canary kill failed")
        self.records.pop(identity, None)
        return True


def provider(sdk, **kwargs):
    return E2BProjectBrowserProvider(template="private-browser-template", api_key="manager-key-canary",
        sandbox_class=sdk, **kwargs)


def run(subject, callback=lambda: None, **kwargs):
    return subject.run(entry_url="https://runtime.preview.test/_whybuddy/authorize?ticket=" + "t" * 32,
        revision=REVISION, verification_id="verification-1", suite_version=SUITE_VERSION,
        scope={"origin": "https://runtime.preview.test", "projectId": "project-1", "runtimeId": "runtime-1"},
        check_callback=callback, **kwargs)


def test_real_dispatch_uses_new_separate_sandbox_and_never_uploads_manager_credentials():
    sdk = SDK()
    result = run(provider(sdk))
    assert result["status"] == "passed" and result["cleanupConfirmed"] is True
    assert result["artifacts"] == {"before.png": PNG, "after.png": PNG}
    assert sdk.records == {"generated-app": {"whybuddy_workspace_id": "application-workspace"}}
    create = next(value for kind, value in sdk.calls if kind == "create")
    assert create["metadata"] == {"whybuddy_kind": METADATA_KIND, "whybuddy_verification_id": "verification-1"}
    assert create["network"] == {"allow_public_traffic": False, "allow_out": ["runtime.preview.test"],
        "deny_out": ["0.0.0.0/0"]}
    assert create["template"] == "private-browser-template" and create["api_key"] == "manager-key-canary"
    assert set(sdk.writes) == {REMOTE_ROOT + "/browser-runner.mjs", REMOTE_ROOT + "/job.json"}
    assert "manager-key-canary" not in json.dumps(sdk.writes) + json.dumps(sdk.command)
    assert sdk.command[1]["background"] is True and sdk.handle.killed


def tasks_receipt():
    value = receipt()
    value["suiteVersion"] = "react-vite-tasks@1"
    value["assertions"] = [{"id": name, "status": "passed"} for name in sorted(SUITE_ASSERTIONS["react-vite-tasks@1"])]
    value["artifacts"] = {name: base64.b64encode(PNG).decode() for name in ("tasks-created.png", "tasks-reader.png")}
    return value


def test_tasks_dispatch_decodes_the_task_runner_screenshots_and_assertions():
    sdk = SDK()
    sdk.report = tasks_receipt()
    result = provider(sdk).run(entry_url="https://runtime.preview.test/_whybuddy/authorize?ticket=" + "t" * 32,
        revision=REVISION, verification_id="verification-1", suite_version="react-vite-tasks@1",
        scope={"origin": "https://runtime.preview.test", "projectId": "project-1", "runtimeId": "runtime-1"},
        check_callback=lambda: None)
    assert result["status"] == "passed" and result["cleanupConfirmed"] is True
    assert result["artifacts"] == {"tasks-created.png": PNG, "tasks-reader.png": PNG}
    assert {item["id"] for item in result["assertions"]} == SUITE_ASSERTIONS["react-vite-tasks@1"]
    assert sdk.records == {"generated-app": {"whybuddy_workspace_id": "application-workspace"}}


@pytest.mark.parametrize("invalid", ["counter-names", "missing-reader", "extra-artifact", "counter-assertions"])
def test_task_receipt_cannot_substitute_another_suites_or_incomplete_evidence(invalid):
    value = tasks_receipt()
    if invalid == "counter-names": value["artifacts"] = receipt()["artifacts"]
    elif invalid == "missing-reader": value["artifacts"].pop("tasks-reader.png")
    elif invalid == "extra-artifact": value["artifacts"]["invented.png"] = next(iter(value["artifacts"].values()))
    else: value["assertions"] = receipt()["assertions"]
    result = decode_result(json.dumps(value), revision=REVISION, verification_id="verification-1", suite_version="react-vite-tasks@1")
    assert result["status"] == "blocked" and result["errorCode"] == "project_browser_output_invalid"
    assert not result["assertions"] and not result["artifacts"]


@pytest.mark.parametrize("missing,code", [("template", "not_configured"), ("key", "key_missing"), ("bundle", "unavailable")])
def test_disabled_or_missing_capability_does_not_make_any_cloud_request(tmp_path, missing, code):
    sdk = SDK()
    subject = E2BProjectBrowserProvider(template="" if missing == "template" else "template",
        api_key="" if missing == "key" else "manager-key-canary", sandbox_class=sdk,
        bundle_path=tmp_path / "missing.mjs" if missing == "bundle" else BUNDLE)
    assert subject.availability_error() == "project_browser_" + code
    assert run(subject)["errorCode"] == "project_browser_" + code
    assert not sdk.calls


def test_callback_cancellation_kills_the_actual_command_and_verifier_before_propagating():
    sdk, checks = SDK(), []
    sdk.hold = True
    def callback():
        checks.append(True)
        if len(checks) >= 4:
            raise PermissionError("owner_revoked")
    with pytest.raises(PermissionError, match="owner_revoked"):
        run(provider(sdk), callback)
    assert sdk.handle.killed and "verifier-1" not in sdk.records and "generated-app" in sdk.records


def test_single_callback_rejection_is_not_erased_by_rechecking_authority():
    sdk, checks = SDK(), []
    sdk.hold = True
    def callback():
        checks.append(True)
        if len(checks) == 4:
            raise PermissionError("owner_revoked")
    with pytest.raises(PermissionError, match="owner_revoked"):
        run(provider(sdk), callback)
    assert sdk.handle.killed and "verifier-1" not in sdk.records


def test_invalid_output_is_blocked_but_confirmed_sandbox_destruction_finishes_cleanup():
    sdk = SDK()
    sdk.report["headers"] = {"Authorization": "private-canary"}
    result = run(provider(sdk))
    assert result["status"] == "blocked" and result["errorCode"] == "project_browser_output_invalid"
    assert result["cleanupConfirmed"] is True and "verifier-1" not in sdk.records
    assert "private-canary" not in json.dumps(result)


def test_process_settings_supply_template_key_and_timeout_without_exported_environment(monkeypatch):
    from services import project_browser_provider as module
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    monkeypatch.setattr(module, "settings", SimpleNamespace(E2B_API_KEY="dotenv-key-canary",
        WHYBUDDY_PROJECT_BROWSER_TEMPLATE="dotenv-template", WHYBUDDY_PROJECT_BROWSER_TIMEOUT_SECONDS=67))
    sdk = SDK()
    subject = E2BProjectBrowserProvider(sandbox_class=sdk)
    assert subject.availability_error() is None and subject.timeout_seconds == 67
    assert run(subject)["status"] == "passed"
    create = next(value for kind, value in sdk.calls if kind == "create")
    assert create["template"] == "dotenv-template" and create["api_key"] == "dotenv-key-canary"
    assert create["timeout"] == 127
    assert "dotenv-key-canary" not in json.dumps(sdk.writes) + json.dumps(sdk.command)


def test_lost_create_response_discovers_and_cleans_same_metadata_without_replaying(caplog):
    sdk = SDK()
    sdk.drop_response = True
    result = run(provider(sdk))
    assert result["status"] == "blocked" and result["cleanupConfirmed"] is True
    assert result["errorCode"] == "project_browser_execution_failed"
    assert len([1 for kind, _ in sdk.calls if kind == "create"]) == 1
    assert sdk.command is None and "verifier-1" not in sdk.records
    assert "stage=create exception=RuntimeError" in caplog.text
    assert "manager-key-canary" not in caplog.text and "response dropped" not in caplog.text


def test_unobserved_late_create_retains_cleanup_pending_until_reconciliation():
    sdk = SDK()
    sdk.late_create = True
    result = run(provider(sdk))
    assert result["errorCode"] == "project_browser_cleanup_pending" and result["cleanupConfirmed"] is False


def test_recovery_cleanup_does_not_adopt_or_replay_old_browser_actions():
    sdk, subject = SDK(), None
    subject = provider(sdk)
    sdk.records["old-verifier"] = subject._metadata("verification-1")
    result = run(subject)
    assert result["errorCode"] == "project_browser_interrupted" and result["cleanupConfirmed"] is True
    assert not any(kind == "create" for kind, _ in sdk.calls)
    assert sdk.command is None and "old-verifier" not in sdk.records


@pytest.mark.parametrize("kind", ["kill_failure", "foreign_discovery"])
def test_cleanup_failure_or_wrong_discovery_identity_cannot_be_passed(kind):
    sdk = SDK()
    setattr(sdk, kind, True)
    result = run(provider(sdk))
    assert result["status"] == "blocked" and result["cleanupConfirmed"] is False
    assert result["errorCode"] == "project_browser_cleanup_pending"
    assert "generated-app" in sdk.records


def test_cleanup_callback_lease_loss_does_not_destroy_another_generation_resource():
    sdk = SDK()
    sdk.records["old-verifier"] = provider(sdk)._metadata("verification-1")
    assert provider(sdk).cleanup("verification-1", lambda: (_ for _ in ()).throw(RuntimeError("lease_lost"))) is False
    assert not sdk.calls and "old-verifier" in sdk.records


@pytest.mark.parametrize("change", ["missing", "duplicate", "revision", "runner", "cleanup", "path", "oversize", "error-url", "raw-headers", "false-status"])
def test_receipt_cannot_forge_pass_or_export_unbounded_or_sensitive_values(change):
    value = receipt()
    if change == "missing": value["assertions"].pop()
    elif change == "duplicate": value["assertions"][-1] = value["assertions"][0]
    elif change == "revision": value["revisionAfter"] = "wrong"
    elif change == "runner": value["runnerVersion"] = "app-provided-runner"
    elif change == "cleanup": value["cleanupConfirmed"] = False
    elif change == "path": value["artifacts"]["../secret.png"] = value["artifacts"].pop("before.png")
    elif change == "oversize": value["artifacts"]["before.png"] = base64.b64encode(PNG + b"x" * MAX_IMAGE_BYTES).decode()
    elif change == "error-url": value["errorCode"] = "https://private/?ticket=secret"
    elif change == "raw-headers": value["headers"] = {"Authorization": "secret"}
    else: value["assertions"][0]["status"] = True
    result = decode_result(json.dumps(value), revision=REVISION, verification_id="verification-1")
    assert result == {"status": "blocked", "errorCode": "project_browser_output_invalid", "runnerVersion": RUNNER_VERSION,
        "assertions": [], "artifacts": {}, "cleanupConfirmed": False}


@pytest.mark.parametrize("actual", ["2", "-2", "9999999999999999", "unexpected_value"])
def test_failed_counter_receipt_preserves_only_bounded_expected_and_actual(actual):
    value = receipt()
    value.update(status="failed", errorCode="project_browser_assertion_failed")
    failure = next(item for item in value["assertions"] if item["id"] == "counter_increment")
    failure.update(status="failed", detail="assertion", expected="1", actual=actual)
    result = decode_result(json.dumps(value), revision=REVISION, verification_id="verification-1")
    assert result["status"] == "failed" and failure in result["assertions"]


@pytest.mark.parametrize("update", [
    {"actual": "https://private.example/?ticket=secret"}, {"actual": "12345678901234567"},
    {"actual": "1.25"}, {"actual": "２"}, {"actual": True},
    {"expected": "2"}, {"status": "passed"}, {"id": "heading_visible"},
    {"raw": "page-error-canary"}, {"expected": None},
])
def test_failed_counter_receipt_rejects_raw_text_unknown_fields_and_wrong_expectation(update):
    value = receipt()
    value.update(status="failed", errorCode="project_browser_assertion_failed")
    failure = next(item for item in value["assertions"] if item["id"] == "counter_increment")
    failure.update(status="failed", detail="assertion", expected="1", actual="2")
    failure.update(update)
    result = decode_result(json.dumps(value), revision=REVISION, verification_id="verification-1")
    assert result["status"] == "blocked" and result["errorCode"] == "project_browser_output_invalid"
    assert not result["assertions"] and "secret" not in json.dumps(result)
