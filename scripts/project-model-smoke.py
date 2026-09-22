"""Live configured model -> durable control HTTP -> saved source -> real E2B.

The approved plan, isolated account and fixed starting project are fixtures.
Tool selection, tool arguments, results and follow-up model requests use the
production control loop unchanged. The default combined-edit smoke separates
command observation into later user turns; single-turn-check explicitly attempts
the whole edit/check/result in one turn. live-edit starts a real runtime fixture
before the model edits it and observes synchronization. Production budgets remain intact.
No browser, production login or business acceptance is claimed.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
from contextvars import ContextVar
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
sys.path.insert(0, str(BACKEND))
TERMINAL = {"completed", "failed", "cancelled", "interrupted", "waiting_user"}


def redact(text):
    for name, value in os.environ.items():
        if value and len(value) > 7 and any(part in name.upper() for part in ("KEY", "TOKEN", "SECRET", "PASSWORD")):
            text = text.replace(value, "[redacted]")
    return text


def write_report(directory, report, name="report.json"):
    destination = directory / name
    temporary = directory / (name + ".tmp")
    temporary.write_text(redact(json.dumps(report, ensure_ascii=False, indent=2)), encoding="utf-8")
    temporary.replace(destination)


def wire_request_metrics(payload):
    """Measure actual JSON payload bytes; do not infer tokens from characters.

    HTTPX uses this compact UTF-8 JSON representation for its json= argument.
    Counts contain no message text or credentials, and exclude HTTP headers.
    Per-role message arrays are independent measurements, not additive slices
    of messagesBytes because each array contributes brackets and separators.
    """
    def size(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))

    messages, tools = payload.get("messages") or [], payload.get("tools") or []
    roles = sorted({str(message.get("role") or "unknown") for message in messages})
    parameters = [{"tool": tool["function"]["name"],
        "schemaBytes": size(tool["function"].get("parameters", {})),
        "definitionBytes": size(tool)} for tool in tools if isinstance(tool.get("function"), dict)]
    return {"serializedBodyBytes": size(payload), "messageCount": len(messages),
        "messagesBytes": size(messages), "messagesByRole": {
            role: {"count": sum(message.get("role") == role for message in messages),
                   "bytes": size([message for message in messages if message.get("role") == role])}
            for role in roles},
        "toolCount": len(tools), "toolDefinitionsBytes": size(tools), "toolSchemas": parameters,
        "maxOutputTokens": payload.get("max_tokens"), "toolChoice": payload.get("tool_choice"),
        "measurement": "compact UTF-8 JSON bytes excluding HTTP headers; not estimated tokens"}


def usage_metrics(samples):
    """Keep absent provider usage unknown, including failed/retried calls."""
    completed = [sample for sample in samples if sample.get("status") == "completed"]
    def measured(key):
        known, reported = [], 0
        for sample in samples:
            # A provider can report billed usage and then return content_filter
            # with no usable result. That usage is still measured spend.
            responses = sample.get("providerResponses")
            usages = [response.get("usage") for response in responses] if responses else [sample.get("usage")]
            values = [(usage or {}).get(key) for usage in usages]
            present = [value for value in values if type(value) is int and value >= 0]
            known.extend(present)
            reported += int(len(present) == len(values))
        return {"knownSum": sum(known), "reportedSamples": reported,
                "unreportedSamples": len(samples) - reported}

    return {"sampleCount": len(samples), "completedSamples": len(completed),
        "promptTokens": measured("prompt_tokens"), "completionTokens": measured("completion_tokens"),
        "totalTokens": measured("total_tokens"),
        "wireRequestCount": sum(len(sample.get("wireRequests", [])) for sample in samples),
        "scope": "provider-reported usage only; missing or failed-attempt usage is not zero cost"}


def control_budget_metrics(control_module):
    return {"legacyDefaults": {"profile": "control-v1", "maxRounds": control_module.MAX_TOOL_ROUNDS,
        "maxTokens": control_module.MAX_CHEAP_TOKENS, "maxWallSeconds": control_module.MAX_WALL_SECONDS},
        "projectProfile": control_module.PROJECT_BUDGET.to_wire(),
        "source": "current production profiles; each turn's persistedBudget.budgetPolicy is the actual pinned policy"}


def attach_transport_observer(control_client, get_sample):
    """Observe the real payload/response seams and return their restore action."""
    original_payload = control_client._control_chat_payload
    original_extract = control_client._extract_control

    def observe_payload(*args, **kwargs):
        payload = original_payload(*args, **kwargs)
        sample = get_sample()
        if sample is not None:
            sample["wireRequests"].append(wire_request_metrics(payload))
        return payload

    def observe_extract(data):
        result = original_extract(data)
        sample = get_sample()
        if sample is not None:
            sample.setdefault("providerResponses", []).append({
                "finishReasons": [choice.get("finish_reason") for choice in data.get("choices") or []],
                "normalizedContentChars": len(result[0]), "normalizedToolCallCount": len(result[1]),
                "usage": result[2], "returnedModel": data.get("model")})
        return result

    control_client._control_chat_payload = observe_payload
    control_client._extract_control = observe_extract

    def restore():
        control_client._control_chat_payload = original_payload
        control_client._extract_control = original_extract

    return restore


async def observe_model_result(model, sample, messages, **kwargs):
    """Record the real result, including rejection before response extraction.

    content_filter is rejected by the production client before _extract_control.
    Its bounded exception receipt supplies the missing observation. Empty-result
    failures already passed that seam and must not be counted a second time.
    """
    try:
        result = await model(messages, **kwargs)
        sample.update(status="completed", returnedModel=result.model, usage=result.usage,
            latencyMs=result.latency_ms, finishReason=result.finish_reason,
            selectedTools=copy.deepcopy(result.tool_calls))
        return result
    except BaseException as exc:
        sample.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:700])
        usage, finish = getattr(exc, "usage", None), getattr(exc, "finish_reason", None)
        if isinstance(usage, dict):
            sample["usage"] = copy.deepcopy(usage)
        if finish is not None:
            sample["finishReason"] = finish
        if (usage is not None or finish is not None) and not sample.get("providerResponses"):
            sample.setdefault("providerResponses", []).append({
                "finishReasons": [finish], "usage": copy.deepcopy(usage),
                "normalizedContentChars": None, "normalizedToolCallCount": None,
                "observation": "client_termination_before_extraction", "responseRejected": True})
        raise


def turn_diagnostics(record, events):
    return {
        "stopDetails": [{key: e[key] for key in ("stopReason", "limit", "used", "providerFinishReason") if key in e}
                        for e in events if e.get("stopReason")],
        "persistedBudget": {key: value for key, value in (record.get("checkpoint") or {}).items()
                            if key in {"round", "cheapTokens", "retrySpent", "startedAt", "retryStartedAt",
                                       "budgetPolicy", "providerFailure"}},
    }


def correlate(record, events):
    """A successful SSE string alone is insufficient: match durable model IO."""
    checkpoint = record.get("checkpoint") or {}
    calls, replies = {}, {}
    for message in checkpoint.get("messages", []):
        if message.get("role") == "assistant":
            for call in message.get("tool_calls", []):
                function = call.get("function") or {}
                arguments = json.loads(function.get("arguments") or "{}")
                calls[call["id"]] = {"tool": function.get("name"), "arguments": arguments}
        elif message.get("role") == "tool":
            replies[message.get("tool_call_id")] = json.loads(message.get("content") or "{}")
    evidence = []
    for event in events:
        if event.get("type") != "control_tool_result":
            continue
        call_id = event.get("toolCallId")
        call, reply = calls.get(call_id), replies.get(call_id)
        if not call or not reply or call["tool"] != event.get("tool") or reply.get("tool") != call["tool"]:
            raise RuntimeError("model_tool_result_correlation_missing")
        for key in ("ok", "revision", "operationId", "status", "exitCode", "content", "logs", "kind",
                    "runtimeOperationId", "parentRevision", "synchronized", "sourcePublished", "verification", "runtime"):
            if key in event and reply.get(key) != event[key]:
                raise RuntimeError("model_tool_result_correlation_mismatch")
        evidence.append({"toolCallId": call_id, **call, "result": reply})
    if not evidence:
        raise RuntimeError("live_model_did_not_execute_tools")
    return evidence


def require_edit(before, after, old_revision, new_revision, expected_title):
    expected = dict(before)
    marker = ">New Project</h1>"
    if before["src/main.tsx"].count(marker) != 1:
        raise RuntimeError("fixture_heading_changed")
    expected["src/main.tsx"] = before["src/main.tsx"].replace(marker, f">{expected_title}</h1>")
    if new_revision == old_revision or after != expected:
        raise RuntimeError("model_did_not_save_requested_exact_edit")


def require_model_receipts(samples, evidence):
    for tool in evidence:
        if not any(json.loads(receipt["content"] or "{}") == tool["result"]
                   for sample in samples if sample.get("status") == "completed"
                   for receipt in sample["receivedToolResults"]
                   if receipt["toolCallId"] == tool["toolCallId"]):
            raise RuntimeError("tool_result_not_sent_back_to_live_model")


def require_verified_command(operation, revision, evidence):
    result = operation.result or {}
    if (operation.expectedRevision != revision or operation.input.get("command") != "check"
            or operation.status != "completed" or type(result.get("exitCode")) is not int
            or result["exitCode"] != 0):
        raise RuntimeError("real_e2b_check_not_passed")
    statuses = [item["result"] for item in evidence if item["tool"] == "project_status"
                and item["result"].get("operationId") == operation.operationId]
    logs = [item["result"] for item in evidence if item["tool"] == "project_logs"
            and item["result"].get("operationId") == operation.operationId]
    if not any(item.get("status") == "completed" and item.get("exitCode") == 0
               and item.get("revision") == revision for item in statuses):
        raise RuntimeError("model_did_not_observe_terminal_command_result")
    text = "".join(chunk["text"] for item in logs for chunk in item.get("logs", []))
    if "tsc --noEmit" not in text:
        raise RuntimeError("model_did_not_read_real_typecheck_logs")


def require_live_edit_receipts(initial, current, child, before_lease, after_lease, observed):
    """Require durable source, execution identity and the model's observed receipt."""
    result = child.result or {}
    revision = result.get("revision")
    if (child.kind != "runtime.patch" or child.status != "completed"
            or result.get("synchronized") is not True or result.get("sourcePublished") is not True
            or result.get("verification") != "not_run" or revision == initial.expectedRevision
            or not isinstance(revision, str) or child.expectedRevision != initial.expectedRevision
            or child.input.get("runtimeOperationId") != initial.operationId
            or result.get("runtimeOperationId") != initial.operationId
            or child.projectId != initial.projectId or child.sessionId != initial.sessionId):
        raise RuntimeError("live_model_patch_receipt_invalid")
    if (current.operationId != initial.operationId or current.kind != "runtime.start"
            or current.status != "running" or current.cancelRequested
            or current.expectedRevision != initial.expectedRevision or current.requestHash != initial.requestHash
            or current.runtime is None or initial.runtime is None
            or current.runtime.status != "ready" or current.runtime.health != "revision_verified"
            or current.runtime.revision != revision
            or any(getattr(current.runtime, name) != getattr(initial.runtime, name)
                   for name in ("runtimeId", "workspaceId", "processId"))
            or not current.runtime.processId):
        raise RuntimeError("live_model_patch_replaced_runtime")
    if (not before_lease or not after_lease or not before_lease.sandboxId
            or any(getattr(before_lease, name) != getattr(after_lease, name)
                   for name in ("sandboxId", "generation", "leaseOwner", "workspaceId"))
            or after_lease.mountedRevision != revision or child.leaseGeneration != after_lease.generation
            or after_lease.processRefs.get("operationId") != initial.operationId
            or after_lease.processRefs.get("server") != current.runtime.processId):
        raise RuntimeError("live_model_patch_changed_execution_owner")
    statuses = [item["result"] for item in observed if item["tool"] == "project_status" and item["result"].get("ok")]
    if not any(item.get("operationId") == child.operationId and item.get("kind") == "runtime.patch"
            and item.get("status") == "completed" and item.get("revision") == revision
            and item.get("synchronized") is True and item.get("sourcePublished") is True
            and item.get("verification") == "not_run" for item in statuses):
        raise RuntimeError("model_did_not_observe_live_patch_completion")
    if not any(item.get("operationId") == initial.operationId and item.get("status") == "running"
            and (item.get("runtime") or {}).get("revision") == revision
            and (item.get("runtime") or {}).get("status") == "ready" for item in statuses):
        raise RuntimeError("model_did_not_observe_updated_running_project")


async def live_edit_scenario(*, client, turn, store, owner_id, project_id, initial_revision,
                             files, expected_title, approval_ref, remaining, report, persist, check):
    """Startup is the fixture; both editing and final observation use the model."""
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.workspace_provider import WorkspaceHandle

    async def wait_operation(operation_id, *, ready=False):
        while remaining() > 0.1:
            response = await client.get("/api/sliderule/project-operations/" + operation_id)
            if response.status_code != 200:
                raise RuntimeError("live_edit_operation_snapshot_unavailable")
            operation = store.get_operation(operation_id, owner_id=owner_id)
            if ready and operation.runtime and operation.runtime.status == "ready":
                return operation
            if operation.status in {"completed", "failed", "cancelled"}:
                if ready:
                    raise RuntimeError("live_edit_fixture_runtime_not_ready")
                return operation
            await asyncio.sleep(min(1, remaining()))
        raise RuntimeError("live_edit_operation_wait_timeout")

    report["stage"] = "starting_live_edit_fixture"
    persist()
    response = await client.post("/api/sliderule/projects/" + project_id + "/runtime/start", json={
        "approvalRef": approval_ref, "expectedRevision": initial_revision, "idempotencyKey": "live-edit-fixture-start"})
    if response.status_code != 202:
        raise RuntimeError(f"live_edit_fixture_start_http_{response.status_code}")
    parent_id = response.json()["operation"]["operationId"]
    report["operationId"] = parent_id
    persist()
    initial = await wait_operation(parent_id, ready=True)
    before_lease = store.get_lease(project_id, owner_id=owner_id)
    report["runtimeFixture"] = {"operationId": parent_id, "runtimeId": initial.runtime.runtimeId,
        "revision": initial.runtime.revision, "processId": initial.runtime.processId,
        "leaseGeneration": before_lease.generation, "sandboxId": before_lease.sandboxId,
        "startup": "actual authorized runtime/start HTTP; fixture, not selected by model"}
    check("fixed_project_is_running_before_model_edit")
    edited = await turn("live_edit", f"Execute the approved source edit in the project that is already running. "
        f"Read src/main.tsx and change exactly the heading New Project to {expected_title}. "
        "Keep every other byte and file unchanged and keep the current application running. "
        "Save the edit through the existing runtime; finish this step after the edit request is saved. "
        "I will ask you to inspect its final status separately. Do not launch checks, create another runtime, "
        "publish, or claim browser or business verification.")
    successful = [item for item in edited if item["result"].get("ok")]
    names = [item["tool"] for item in successful]
    edits = [item for item in successful if item["tool"] == "project_patch"]
    if (len(edits) != 1 or "project_read" not in names
            or names.index("project_read") > names.index("project_patch")
            or edits[0]["result"].get("kind") != "runtime.patch"):
        raise RuntimeError("live_model_did_not_read_and_queue_one_runtime_patch")
    child_id = edits[0]["result"]["operationId"]
    report["patchOperationId"] = child_id
    report["stage"] = "waiting_for_live_source_sync"
    persist()
    child = await wait_operation(child_id)
    report["patchReceipt"] = {"operationId": child.operationId, "status": child.status,
        "expectedRevision": child.expectedRevision, "result": child.result}
    persist()
    if child.status != "completed":
        raise RuntimeError("live_model_source_sync_failed:" + str((child.result or {}).get("errorCode")))
    observed = await turn("observe_live_edit", f"The background wait for edit operation {child_id} has ended. "
        f"Read its durable status and the status of the existing running application operation {parent_id}. "
        "Report whether the saved edit actually synchronized and which source revision is running. "
        "This step only observes these statuses; do not edit, start, stop or run commands. "
        "A ready application is not browser or business verification.")
    current = store.get_operation(parent_id, owner_id=owner_id)
    after_lease = store.get_lease(project_id, owner_id=owner_id)
    require_live_edit_receipts(initial, current, child, before_lease, after_lease, observed)
    revised = store.get_project(project_id, owner_id=owner_id).currentRevision
    require_edit(files, store.read_files(project_id, owner_id=owner_id), initial_revision, revised, expected_title)
    if current.runtime.revision != revised or store.read_files(project_id, initial_revision, owner_id=owner_id) != files:
        raise RuntimeError("live_model_source_revision_mismatch")
    from services import persistence
    if persistence.load_session_record(child.sessionId)["session"].projectRevision != revised:
        raise RuntimeError("session_revision_not_updated")
    operations = store.list_project_operations(project_id, owner_id=owner_id, limit=100)
    if len(operations) != 2 or {item.operationId for item in operations} != {parent_id, child_id}:
        raise RuntimeError("unexpected_extra_remote_operations")
    check("live_model_receives_synchronized_receipt_for_same_runtime_and_owner")
    provider = E2BWorkspaceProvider()
    handle = WorkspaceHandle(after_lease.workspaceId, after_lease.sandboxId)
    await asyncio.to_thread(provider.connect, handle)
    if not await asyncio.to_thread(provider.probe, handle, current.runtime.port, expected_revision=revised):
        raise RuntimeError("live_model_runtime_revision_probe_failed")
    source = "import json,urllib.request; s=urllib.request.urlopen('http://127.0.0.1:" + str(current.runtime.port) + "/src/main.tsx').read().decode(); print(json.dumps({'headingFound': " + repr(expected_title) + " in s}))"
    response = await asyncio.to_thread(provider.run, handle,
        "python3 -I -S -c " + shlex.quote(source), timeout_seconds=20)
    if response.exit_code != 0 or json.loads(response.stdout).get("headingFound") is not True:
        raise RuntimeError("live_model_vite_did_not_serve_edited_heading")
    report["editedRevision"] = revised
    report["liveRuntime"] = {"operationId": parent_id, "runtimeId": current.runtime.runtimeId,
        "revision": revised, "processId": current.runtime.processId, "sandboxId": after_lease.sandboxId,
        "leaseGeneration": after_lease.generation, "health": current.runtime.health,
        "httpHeadingObserved": True, "verification": "not_run"}
    check("real_e2b_vite_serves_model_edit_from_immutable_new_revision")


async def worker(directory, timeout, scenario):
    import httpx
    from config.settings import settings

    # Windows drops empty environment values in child processes; explicitly
    # reject a dotenv gateway before any store can issue a remote DDL request.
    expected_database = "sqlite:///" + (directory / "state.db").as_posix()
    if (settings.APP_STORE_DATABASE_URL != expected_database
            or (settings.APP_STORE_HTTP_API_URL or "").strip()
            or (settings.APP_STORE_HTTP_API_KEY or "").strip()):
        raise RuntimeError("model_smoke_storage_isolation_failed")
    from app import app
    from middlewares.current_user import optional_user, require_user
    from models.v5_state import V5SessionState
    from services import persistence, rehearsal_control
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.identity_store import get_identity_store
    from services.project_authority import approved_reference
    from services.project_creation import create_session_project, load_project_template
    from services.project_manifest import build_manifest
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import get_project_store, reset_project_store
    from services.session_blob_store import SqlSessionBlobStore
    from sliderule_llm.config import get_llm_config
    from sliderule_llm import control_client

    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    sessions = SqlSessionBlobStore(os.environ["APP_STORE_DATABASE_URL"])
    persistence._blob_store = lambda _path=None: sessions
    store = get_project_store()
    identity = get_identity_store()
    viewer = identity.create("smoke-" + directory.name + "@example.invalid", "!no-login-smoke-fixture",
                             is_superuser=True, is_verified=True)
    owner_id = viewer.id
    app.dependency_overrides[optional_user] = lambda: viewer
    app.dependency_overrides[require_user] = lambda: viewer
    supervisor = ProjectRuntimeSupervisor(store, E2BWorkspaceProvider, max_workers=1,
        lifetime_seconds=min(timeout, 900), idle_seconds=60, install_timeout=min(timeout, 600))
    control_store = ControlRunStore(store._q)
    control = ControlRunService(control_store, store, supervisor)
    app.state.project_runtime_supervisor = supervisor
    app.state.control_run_service = control
    tables = {row["name"] for row in store._q("select name from sqlite_master where type='table'")}
    if not {"sliderule_session", "sliderule_user", "wb_control_run", "wb_project"} <= tables:
        raise RuntimeError("model_smoke_shared_database_required")
    session_id = "model-smoke-" + directory.name
    expected_title = "Model smoke " + directory.name
    config = get_llm_config()
    report["model"] = {"configuredModel": config.model, "routerModel": config.router_model,
        "configuredControlModel": os.getenv("SLIDERULE_CONTROL_MODEL") or config.model,
        "wireApi": "chat_completions", "providerHost": urlsplit(config.base_url).hostname,
        "selection": "production auto tool choice; no model or budget overrides"}
    report["modelSamples"] = []
    report["productionBudgets"] = control_budget_metrics(rehearsal_control)
    original_model = rehearsal_control.call_control_llm
    current_sample = ContextVar("project_model_smoke_sample", default=None)
    restore_transport = attach_transport_observer(control_client, current_sample.get)

    async def observe_model(messages, **kwargs):
        # Observe the real client result without replacing input, output or limits.
        sample = {"stage": report.get("stage"), "wireRequests": [], "offeredTools": [
            tool["function"]["name"] for tool in kwargs.get("tools") or []],
            "receivedToolResults": [
                {"toolCallId": message.get("tool_call_id"), "content": message.get("content")}
                for message in messages if message.get("role") == "tool"]}
        report["modelSamples"].append(sample)
        sample_token = current_sample.set(sample)
        started = time.monotonic()
        try:
            return await observe_model_result(original_model, sample, messages, **kwargs)
        finally:
            current_sample.reset(sample_token)
            sample["elapsedSeconds"] = round(time.monotonic() - started, 2)
            report["usageSummary"] = usage_metrics(report["modelSamples"])
            write_report(directory, report)

    rehearsal_control.call_control_llm = observe_model
    report["sessionId"] = session_id
    report["repositoryHead"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
        capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    source_paths = ["services/rehearsal_control.py", "services/control_run_service.py",
        "services/project_tools.py", "services/project_runtime_worker.py", "services/project_source_sync.py",
        "services/project_store.py", "services/e2b_workspace_provider.py", "sliderule_llm/control_client.py"]
    report["implementationSha256"] = {path: hashlib.sha256((BACKEND / path).read_bytes()).hexdigest()
                                        for path in source_paths}
    files, template = load_project_template()
    report.update(templateVersion=template, initialTreeHash=build_manifest(files).treeHash,
                  lockfileSha256=hashlib.sha256(files["package-lock.json"].encode()).hexdigest())
    plan = {"planId": "model-smoke-approved-plan", "revision": 1, "reqId": "model-smoke-approval",
        "planContent": f"In the existing React/Vite project change only the New Project heading to {expected_title}. "
                       "Read the source first, preserve every other byte, then run the check command in E2B and inspect status and logs. Do not publish."}
    if scenario == "live-edit":
        plan["planContent"] = (f"Start the fixed React/Vite project, then change only the New Project heading to {expected_title}. "
            "Read the source first and preserve every other byte. Synchronize the edit through the existing runtime, "
            "keep that application running and inspect the saved edit receipt and current runtime status. Do not publish.")
    state = V5SessionState(sessionId=session_id, ownerId=owner_id,
        goal={"text": "Edit the heading through the existing E2B runtime and observe source synchronization"
              if scenario == "live-edit" else "Edit the existing project heading and verify TypeScript in E2B", "status": "clear"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    saved = persistence.save_session_record(state, server_write=True)
    if not saved.get("ok"):
        raise RuntimeError("model_smoke_session_not_persisted")
    project = create_session_project(store, session_id, owner_id=owner_id,
                                     approval_ref=approved_reference(state))
    project_id, initial_revision = project.projectId, project.currentRevision
    report.update(projectId=project_id, workspaceId="ws-" + project_id, initialRevision=initial_revision)
    write_report(directory, report)
    deadline = time.monotonic() + timeout - 60
    await control.start()
    supervisor.start()
    resource_observation_done = asyncio.Event()

    async def observe_resources():
        while not resource_observation_done.is_set():
            try:
                lease = await asyncio.to_thread(store.get_lease, project_id, owner_id=owner_id)
                if lease and lease.sandboxId and lease.sandboxId not in report["sandboxIds"]:
                    report["sandboxIds"].append(lease.sandboxId)
                    write_report(directory, report)
            except Exception as exc:
                report["resourceObservationError"] = type(exc).__name__
            try:
                await asyncio.wait_for(resource_observation_done.wait(), timeout=1)
            except asyncio.TimeoutError:
                pass

    resource_observer = asyncio.create_task(observe_resources())

    def remaining():
        return max(0.01, deadline - time.monotonic())

    def check(name):
        report["checks"].append({"name": name, "status": "passed"})
        write_report(directory, report)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://model-smoke",
            headers={"x-internal-key": os.environ["SLIDE_RULE_INTERNAL_KEY"]}) as client:
        async def turn(name, prompt):
            report["stage"] = name
            write_report(directory, report)
            payload = {"sessionId": session_id, "userText": prompt, "installedSkills": [],
                       "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
            response = await asyncio.wait_for(client.post("/api/sliderule/control-turn-stream", json=payload,
                headers={"x-control-request-id": directory.name + "-" + name}), timeout=remaining())
            if response.status_code != 200:
                raise RuntimeError(f"control_http_{response.status_code}")
            events = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith("data:")]
            run_id = response.headers.get("x-control-run-id")
            if not run_id or not any(event.get("type") == "control_run_started" for event in events):
                raise RuntimeError("durable_control_route_not_used")
            record = control_store.get(run_id, owner_id)
            stage = {"name": name, "runId": run_id, "request": payload,
                "status": record["status"], "stopReasons": [e["stopReason"] for e in events if e.get("stopReason")],
                **turn_diagnostics(record, events),
                "usage": usage_metrics([sample for sample in report["modelSamples"] if sample["stage"] == name]),
                "eventTypes": [e.get("type") for e in events],
                "toolResults": [e for e in events if e.get("type") == "control_tool_result"]}
            report["turns"].append(stage)
            write_report(directory, report)
            if record["status"] != "completed" or not any(e.get("type") == "complete" for e in events):
                raise RuntimeError("live_control_turn_not_completed")
            if stage["stopReasons"]:
                raise RuntimeError("live_control_turn_stopped:" + str(stage["stopReasons"][0]))
            stage["correlatedTools"] = correlate(record, events)
            samples = [sample for sample in report["modelSamples"]
                       if sample["stage"] == name and sample.get("status") == "completed"]
            require_model_receipts(samples, stage["correlatedTools"])
            write_report(directory, report)
            return stage["correlatedTools"]

        try:
            if scenario == "live-edit":
                await live_edit_scenario(client=client, turn=turn, store=store, owner_id=owner_id,
                    project_id=project_id, initial_revision=initial_revision, files=files,
                    expected_title=expected_title, approval_ref=approved_reference(state),
                    remaining=remaining, report=report, persist=lambda: write_report(directory, report), check=check)
            else:
                if scenario == "single-turn-check":
                    edit = await turn("edit_check_observe", f"Carry out the approved change in the existing project: "
                        f"read src/main.tsx, change exactly the heading New Project to {expected_title}, "
                        "and preserve every other byte and file. Save a new source revision, then run the check command "
                        "in E2B for that revision. Inspect the actual operation status and logs and report the result "
                        "when you have evidence. Do not publish or claim browser/business verification.")
                elif scenario == "combined-edit":
                    edit = await turn("edit", f"Execute only the source-edit step of the approved plan now. "
                        f"Read src/main.tsx from the existing saved project, then change exactly the heading text "
                        f"New Project to {expected_title}. Keep every other byte and every other file unchanged. "
                        "Save the edit as a new revision. Stop after saving; I will request the E2B check separately.")
                else:
                    read = await turn("read", f"Read only src/main.tsx at revision {initial_revision} "
                        "using project_read, then finish this step. This fixture project is newly created with no "
                        "operations or active runtime; no status query is needed. Only the file content and hash are "
                        "requested. Do not change files or use other tools.")
                    reads = [item["result"] for item in read if item["tool"] == "project_read" and item["result"].get("ok")]
                    if len(reads) != 1 or reads[0].get("truncated"):
                        raise RuntimeError("model_source_read_missing_or_truncated")
                    # This is an explicit new user step with the real previous read
                    # attached. It is not a forged tool message or model continuation.
                    context = {key: reads[0][key] for key in ("path", "content", "revision", "sha256")}
                    edit = await turn("edit", f"Apply the approved edit using the preceding real read attached below. "
                        f"Change only the heading text New Project to {expected_title}; preserve every other byte and file. "
                        f"Use approvalRef {approved_reference(state)}. There are no operations or active runtime. "
                        "The tool schema takes expectedRevision once at the top level; each changes item contains only "
                        "path, content and expectedSha256. Stop after saving the new revision; do not read again, "
                        "query status or run commands in this step. Previous actual project_read result: " + json.dumps(context, ensure_ascii=False))
                    edit = read + edit
                names = [item["tool"] for item in edit if item["result"].get("ok")]
                if "project_read" not in names or "project_patch" not in names or names.index("project_read") > names.index("project_patch"):
                    raise RuntimeError("model_read_before_patch_missing")
                project = store.get_project(project_id, owner_id=owner_id)
                revised = project.currentRevision
                require_edit(files, store.read_files(project_id, owner_id=owner_id), initial_revision, revised, expected_title)
                if store.read_files(project_id, initial_revision, owner_id=owner_id) != files:
                    raise RuntimeError("immutable_original_revision_changed")
                persisted = persistence.load_session_record(session_id)["session"]
                if persisted.projectRevision != revised:
                    raise RuntimeError("session_revision_not_updated")
                report["editedRevision"] = revised
                check("live_model_reads_and_saves_exact_edit_with_immutable_parent")

                executed = edit if scenario == "single-turn-check" else await turn("execute", "The source-edit step is complete. Queue exactly one E2B check "
                    f"command for revision {revised} with approvalRef {approved_reference(state)}. Return the operation ID "
                    "and stop once queued; I will ask you to inspect its result when the background operation settles. "
                    "Do not modify files or start a preview.")
                dispatched = [item for item in executed if item["tool"] == "project_exec" and item["result"].get("ok")]
                if len(dispatched) != 1 or dispatched[0]["arguments"].get("command") != "check":
                    raise RuntimeError("model_did_not_dispatch_one_check")
                operation_id = dispatched[0]["result"]["operationId"]
                report["operationId"] = operation_id
                check("live_model_selects_real_e2b_check_for_edited_revision")
                report["stage"] = "waiting_for_e2b"
                write_report(directory, report)
                while remaining() > 0.1:
                    snapshot = await client.get("/api/sliderule/project-operations/" + operation_id)
                    if snapshot.status_code != 200:
                        raise RuntimeError("operation_snapshot_unavailable")
                    lease = store.get_lease(project_id, owner_id=owner_id)
                    if lease and lease.sandboxId and lease.sandboxId not in report["sandboxIds"]:
                        report["sandboxIds"].append(lease.sandboxId)
                        write_report(directory, report)
                    if snapshot.json()["operation"]["status"] in {"completed", "failed", "cancelled"}:
                        break
                    await asyncio.sleep(1)
                else:
                    raise RuntimeError("e2b_check_wait_timeout")
                operation = store.get_operation(operation_id, owner_id=owner_id)
                report["command"] = {"operationId": operation_id, "revision": operation.expectedRevision,
                    "status": operation.status, "command": operation.input.get("command"),
                    "exitCode": (operation.result or {}).get("exitCode"),
                    "errorCode": (operation.result or {}).get("errorCode")}
                write_report(directory, report)
                if scenario == "single-turn-check":
                    observed = edit
                    if len(report["turns"]) != 1:
                        raise RuntimeError("single_turn_scenario_added_user_turns")
                else:
                    observed = await turn("observe_status", f"The background wait for operation {operation_id} has ended. "
                        "Read this operation's durable status and report its actual result. This step only reads status; "
                        "do not launch operations, read logs or edit files. Do not claim browser or business acceptance.")
                    observed += await turn("observe_logs", f"Read the command logs of operation {operation_id} and report "
                        "what command actually ran. This step only reads logs; do not launch operations, read status or edit files. "
                        "If needed follow the returned log cursor until you find the typecheck command.")
                require_verified_command(operation, revised, observed)
                all_operations = store.list_project_operations(project_id, owner_id=owner_id, limit=100)
                if len(all_operations) != 1 or all_operations[0].operationId != operation_id:
                    raise RuntimeError("unexpected_extra_remote_operations")
                if store.get_project(project_id, owner_id=owner_id).currentRevision != revised:
                    raise RuntimeError("model_changed_revision_after_check")
                check("live_model_receives_terminal_exit_and_real_typecheck_logs")
            report["status"] = "passed"
        except Exception as exc:
            report.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:1000])
        finally:
            record = control_store.latest(session_id, owner_id)
            if record and record["status"] not in TERMINAL:
                await control.cancel(record["runId"], owner_id)
            for operation in store.list_project_operations(project_id, owner_id=owner_id, limit=100):
                if operation.status not in {"completed", "failed", "cancelled"}:
                    supervisor.cancel(operation.operationId, owner_id=owner_id)
            try:
                await asyncio.wait_for(control.shutdown(), timeout=20)
                await asyncio.to_thread(supervisor.shutdown, 35)
            except Exception as exc:
                report.update(status="failed", shutdownError=type(exc).__name__)
            resource_observation_done.set()
            await resource_observer
            restore_transport()
            rehearsal_control.call_control_llm = original_model
            # Retain partial real work when the model stops before the turn
            # succeeds (for example a provider content_filter after exec).
            try:
                final_project = store.get_project(project_id, owner_id=owner_id)
                final_files = store.read_files(project_id, owner_id=owner_id)
                report["finalProject"] = {"revision": final_project.currentRevision,
                    "changedPaths": sorted(path for path in files.keys() | final_files.keys()
                                           if files.get(path) != final_files.get(path)),
                    "originalRevisionUnchanged": store.read_files(project_id, initial_revision, owner_id=owner_id) == files}
                report["finalOperations"] = [{"operationId": operation.operationId,
                    "kind": operation.kind,
                    "revision": operation.expectedRevision, "status": operation.status,
                    "runtimeRevision": operation.runtime.revision if operation.runtime else None,
                    "synchronized": (operation.result or {}).get("synchronized"),
                    "sourcePublished": (operation.result or {}).get("sourcePublished"),
                    "command": operation.input.get("command"), "exitCode": (operation.result or {}).get("exitCode"),
                    "errorCode": (operation.result or {}).get("errorCode")}
                    for operation in store.list_project_operations(project_id, owner_id=owner_id, limit=100)]
            except Exception as exc:
                report["finalSnapshotError"] = type(exc).__name__
            write_report(directory, report)
            sessions._engine.dispose()
            reset_project_store()
    return 0 if report["status"] == "passed" else 1


def cleanup(directory):
    from services.e2b_workspace_provider import E2BWorkspaceProvider

    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    workspace_id = report.get("workspaceId")
    result = {"status": "not_needed", "workspaceId": workspace_id, "sandboxIds": []}
    if workspace_id:
        result["status"] = "pending"
        write_report(directory, result, "cleanup.json")
        provider = E2BWorkspaceProvider()
        try:
            for handle in provider.find_workspaces(workspace_id=workspace_id):
                result["sandboxIds"].append(handle.sandbox_id)
                write_report(directory, result, "cleanup.json")
                provider.destroy(handle)
            if provider.find_workspaces(workspace_id=workspace_id):
                raise RuntimeError("remote_cleanup_not_confirmed")
            result["status"] = "confirmed_empty"
        except Exception as exc:
            result["error"] = redact(str(exc))[:500]
    write_report(directory, result, "cleanup.json")
    return 0 if result["status"] in {"confirmed_empty", "not_needed"} else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=600, help="Total worker seconds, followed by at most 90 seconds of cleanup")
    parser.add_argument("--without-key", action="store_true", help="Test the blocked preflight without network calls")
    parser.add_argument("--scenario", choices=("combined-edit", "guided-tools", "single-turn-check", "live-edit"), default="combined-edit",
        help="Combined edit is the default; guided-tools supplies steps; single-turn-check uses one user request; live-edit updates an already running fixture")
    parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--cleanup", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 180 <= args.timeout <= 900:
        parser.error("timeout must be between 180 and 900 seconds")
    if args.cleanup:
        return cleanup(args.cleanup)
    if args.worker:
        try:
            return asyncio.run(worker(args.worker, args.timeout, args.scenario))
        except Exception as exc:
            report = json.loads((args.worker / "report.json").read_text(encoding="utf-8"))
            causes = []
            cause = exc
            while cause is not None and len(causes) < 6:
                causes.append({"type": type(cause).__name__, "message": redact(str(cause))[:700]})
                cause = cause.__cause__
            report.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:1000], causes=causes)
            write_report(args.worker, report)
            return 1

    from dotenv import dotenv_values

    # Explicit overrides retain whitespace: on Windows, assigning an empty
    # environment value removes it before the child can override dotenv.
    for source in (ROOT / ".env", BACKEND / ".env"):
        for key, value in dotenv_values(source).items():
            if value is not None and (key.startswith(("LLM_", "OPENAI_")) or key in {"E2B_API_KEY", "SLIDERULE_CONTROL_MODEL"}):
                os.environ.setdefault(key, value)
    directory = ROOT / "artifacts" / "project-model" / (str(int(time.time())) + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=True)
    report = {"scope": "live-model-durable-control-http-real-e2b-source-edit-and-check", "status": "running",
        "scenario": args.scenario,
        "controlTransport": "actual FastAPI HTTP routes via ASGI transport",
        "fixtures": ["isolated active superuser", "already approved plan", "checked-in initial project"],
        "storage": "one isolated SQLite for session, identity, control and project stores",
        "notCovered": ["production login", "model-driven planning or approval", "private browser preview",
            "browser behavior", "application business acceptance", "unprompted autonomous task completion"],
        "checks": [], "turns": [], "sandboxIds": [], "cleanup": []}
    if args.scenario == "live-edit":
        report["scope"] = "live-model-durable-control-http-running-e2b-source-edit-and-synchronization"
        report["fixtures"].append("runtime started through authorized HTTP before model editing")
    missing = []
    if args.without_key or not os.getenv("E2B_API_KEY"):
        missing.append("e2b_api_key_missing")
    if args.without_key or not (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")):
        missing.append("llm_api_key_missing")
    if not (os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")):
        missing.append("llm_base_url_missing")
    if importlib.util.find_spec("e2b_code_interpreter") is None:
        missing.append("e2b_sdk_missing")
    if missing:
        report.update(status="blocked", missing=missing)
        write_report(directory, report)
        print("BLOCKED " + ", ".join(missing) + "; report: " + str(directory / "report.json"))
        return 2
    database_url = "sqlite:///" + (directory / "state.db").as_posix()
    os.environ.update({"NODE_ENV": "development", "APP_STORE_DATABASE_URL": database_url,
        "APP_STORE_HTTP_API_URL": " ", "APP_STORE_HTTP_API_KEY": " ", "APP_STORE_NEON_HTTP": "0",
        "SLIDERULE_IDENTITY_SQLITE": database_url, "SLIDERULE_DISABLE_ENV_HYDRATION": "1",
        "APP_STORE_FILE": str(directory / "apps.json"), "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "SLIDE_RULE_INTERNAL_KEY": secrets.token_hex(32),
        "SLIDERULE_AUTH_SECRET": secrets.token_hex(32), "SLIDERULE_WEB_SEARCH": "off",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "PYTHONIOENCODING": "utf-8"})
    write_report(directory, report)
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", str(directory),
        "--timeout", str(args.timeout), "--scenario", args.scenario], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=creationflags)
    deadline, last_stage = time.monotonic() + args.timeout, None
    interrupted = False
    try:
        while process.poll() is None and time.monotonic() < deadline:
            report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
            stage = report.get("stage")
            if stage and stage != last_stage:
                print("RUN " + stage, flush=True)
                last_stage = stage
            time.sleep(1)
        if process.poll() is None:
            interrupted = True
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
        if interrupted or process.returncode != 0 or report["status"] == "running":
            report.update(status="failed", error=report.get("error") or
                          ("smoke_worker_timeout_or_interrupted" if interrupted else "smoke_worker_failed"))
        write_report(directory, report)
        try:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "--cleanup", str(directory)],
                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, check=True,
                creationflags=creationflags)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            report.update(status="failed", cleanupError="remote_cleanup_pending")
        cleanup_path = directory / "cleanup.json"
        report["cleanup"] = [json.loads(cleanup_path.read_text(encoding="utf-8"))] if cleanup_path.exists() else [{"status": "pending"}]
        if any(item["status"] == "pending" for item in report["cleanup"]):
            report["status"] = "failed"
        write_report(directory, report)
    print(report["status"].upper() + "; report: " + str(directory / "report.json"), flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
