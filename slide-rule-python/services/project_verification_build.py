"""One runtime owner builds and serves a fixed revision, then restores dev.

Like grok workspace's owned terminal shutdown, process lifetime belongs to the
session owner, not to a browser subscription. Persist dispatch intent before IO;
an unknown process start destroys that workspace instead of replaying a command.
Only the separately controlled browser produces behavioral assertions.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from models.project_runtime import VerificationBuildEvidence
from services.project_application_runtime import checkpoint_application_data
from services.workspace_provider import PROJECT_REVISION_FILE, WorkspaceProviderError

KEY = "verificationBuild"
PROCESS_KEYS = ("verification_install", "verification_compile", "verification_server")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _state(task, child):
    value = task.result.get(KEY)
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("operationId") != child.operationId:
        raise WorkspaceProviderError("project_build_owner_mismatch")
    return value


def _save(task, child, phase, runtime_phase="installing", **updates):
    prior = _state(task, child) or {"operationId": child.operationId}
    task.result[KEY] = {**prior, **updates, "phase": phase}
    task.save(runtime_phase)


def _drop_process(task, key, *, checkpoint=False):
    task.heartbeat.check()
    pid = task.heartbeat.lease.processRefs.get(key)
    if pid:
        if task.provider.is_process_running(task.handle, pid):
            task.provider.stop(task.handle, pid)
        if task.provider.is_process_running(task.handle, pid):
            raise WorkspaceProviderError("project_build_process_stop_failed")
        if checkpoint:
            # Persist the user's final dev DB after process exit, while its
            # runtime/lease PID binding still authorizes the data-store CAS.
            # The verification server uses another DB and never takes this path.
            checkpoint_application_data(task, force=True)
        refs = dict(task.heartbeat.lease.processRefs)
        refs.pop(key, None)
        task.heartbeat.renew(process_refs=refs)
    if key == "server":
        task.runtime = task.runtime.model_copy(update={"processId": None})


def _dispatch(task, child, key, execute, runtime_phase):
    _save(task, child, "dispatching", runtime_phase, dispatching=key)
    process = execute()
    task._register(key, process.process_id)
    _save(task, child, key, runtime_phase, dispatching=None)
    return process.process_id


def _wait(task, child, pid, check, seconds):
    deadline = time.monotonic() + seconds
    while True:
        check()
        task.logs(pid)
        if not task.provider.is_process_running(task.handle, pid):
            break
        if time.monotonic() >= deadline:
            raise WorkspaceProviderError("project_build_command_timeout")
        task.sleep()
    result = task.provider.process_result(task.handle, pid)
    task.logs(pid)
    if type(result.exit_code) is not int:
        raise WorkspaceProviderError("project_build_exit_code_unknown")
    return result.exit_code


def _evidence(task, child, values):
    """Keep completed build steps across a crash during browser or restoration."""
    proof = VerificationBuildEvidence(**{**values, "completedAt": _now()})
    state = _state(task, child)
    _save(task, child, state["phase"], task.runtime.status, evidence=proof.model_dump(mode="json"))
    return proof


def build_and_start(task, child, record, *, expected_files, check):
    revision = task.store.get_revision(child.projectId, child.expectedRevision, owner_id=task.owner_id)
    lockfile = next((item.sha256 for item in revision.manifest.files if item.path == "package-lock.json"), None)
    if lockfile is None:
        raise WorkspaceProviderError("project_build_lockfile_missing")
    evidence = dict(revision=record.revision, treeHash=record.treeHash, lockfileHash=lockfile,
        status="blocked", serverKind="tasks-node" if child.input["suiteVersion"] == "react-vite-tasks@1" else "static-dist",
        startedAt=_now(), completedAt=_now())
    check()
    _save(task, child, "stopping_dev", "starting")
    if task.supervisor.preview_runtime is not None:
        task.supervisor.preview_runtime.suspend_for_sync(task)
    _drop_process(task, "server", checkpoint=True)
    _save(task, child, "preparing")
    task.provider.prepare_verification(task.handle, child.operationId)
    check()
    pid = _dispatch(task, child, "verification_install", lambda: task.provider.start_process(
        task.handle, "npm ci --ignore-scripts", timeout_seconds=600), "installing")
    evidence["installExitCode"] = _wait(task, child, pid, check, task.supervisor.install_timeout)
    if evidence["installExitCode"] != 0:
        evidence.update(status="failed")
        return _evidence(task, child, evidence)
    _evidence(task, child, evidence)
    task.provider.sync_files(task.handle, expected_files=expected_files, files=expected_files)
    check()
    pid = _dispatch(task, child, "verification_compile", lambda: task.provider.start_process(
        task.handle, "npm run build", timeout_seconds=600), "executing")
    evidence["buildExitCode"] = _wait(task, child, pid, check, task.supervisor.install_timeout)
    if evidence["buildExitCode"] != 0:
        evidence.update(status="failed")
        return _evidence(task, child, evidence)
    _evidence(task, child, evidence)
    task.provider.sync_files(task.handle, expected_files=expected_files, files=expected_files)
    output = task.provider.inspect_build_output(task.handle, revision=record.revision)
    evidence.update(outputHash=output.output_hash, outputFileCount=output.file_count, outputBytes=output.size_bytes)
    check()
    pid = _dispatch(task, child, "verification_server", lambda: task.provider.start_verification_server(
        task.handle, verification_id=child.operationId, suite_version=child.input["suiteVersion"], port=task.runtime.port), "starting")
    # The preview authority continues to refer to the same runtime and port,
    # now backed by the process serving the actual build output.
    task._register("server", pid)
    task.runtime = task.runtime.model_copy(update={"processId": pid})
    _save(task, child, "starting_build", "starting")
    deadline = time.monotonic() + task.supervisor.ready_timeout
    while True:
        check()
        if not task.provider.is_process_running(task.handle, pid):
            raise WorkspaceProviderError("project_build_server_exited")
        if task.provider.probe(task.handle, task.runtime.port, expected_revision=record.revision):
            break
        if time.monotonic() >= deadline:
            raise WorkspaceProviderError("project_build_readiness_timeout")
        task.sleep()
    _save(task, child, "browser", "ready")
    evidence.update(status="passed")
    return _evidence(task, child, evidence)


def restore_development_runtime(task, child, *, restore=True):
    state = _state(task, child)
    if state is None:
        return
    if state.get("evidence") is not None:
        receipts = getattr(task, "_verification_build_receipts", {})
        receipts[child.operationId] = state["evidence"]
        task._verification_build_receipts = receipts
    task.heartbeat.check()
    if task.handle is None:
        task.result.pop(KEY, None)
        return
    if state.get("dispatching"):
        # A command may have started without a persisted PID. The sandbox is
        # the only reliable process fence; never run an ambiguous command again.
        task.provider.destroy(task.handle)
        task.handle = None
        task.heartbeat.handle = None
        task.result.pop(KEY, None)
        raise WorkspaceProviderError("project_build_workspace_rebuild_required")
    if restore:
        _save(task, child, "stopping_build", "starting")
    for key in PROCESS_KEYS:
        _drop_process(task, key)
    _drop_process(task, "server")
    task.provider.cleanup_verification_data(task.handle, child.operationId)
    if not restore:
        task.result.pop(KEY, None)
        return
    try:
        task.check()
    except Exception:
        # Shutdown/cancel/expiry is handled by the outer owner. Keep the durable
        # restore marker for restart; never start a dev process after cancellation.
        _save(task, child, "restore_pending", "starting")
        return
    files = task.store.read_files(child.projectId, child.expectedRevision, owner_id=task.owner_id)
    expected = {**files, PROJECT_REVISION_FILE: json.dumps({"revision": child.expectedRevision})}
    task.provider.sync_files(task.handle, expected_files=expected, files=expected)
    pid = _dispatch(task, child, "server", lambda: task.provider.start_process(
        task.handle, task.development_server_command(), timeout_seconds=900), "starting")
    task.runtime = task.runtime.model_copy(update={"processId": pid})
    deadline = time.monotonic() + task.supervisor.ready_timeout
    while True:
        task.check()
        if not task.provider.is_process_running(task.handle, pid):
            raise WorkspaceProviderError("project_build_dev_restore_failed")
        if task.provider.probe(task.handle, task.runtime.port, expected_revision=task.runtime.revision):
            break
        if time.monotonic() >= deadline:
            raise WorkspaceProviderError("project_build_dev_restore_timeout")
        task.sleep()
    task.result.pop(KEY, None)
    task.result["readyAt"] = time.time()
    task.save("ready")
    if task.supervisor.preview_runtime is not None:
        task.supervisor.preview_runtime.ensure(task)
