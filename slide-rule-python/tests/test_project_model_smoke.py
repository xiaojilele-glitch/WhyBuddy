"""The live smoke must reject model prose, fabricated events and stale exits.

These tests exercise evidence predicates and the actual client observation path
with an HTTP fixture. They make no external network calls; the separate smoke
invokes the configured production model and E2B provider.
"""

import importlib.util
import json
import copy
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest


_PATH = Path(__file__).resolve().parents[2] / "scripts" / "project-model-smoke.py"
_SPEC = importlib.util.spec_from_file_location("project_model_smoke", _PATH)
smoke = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(smoke)


def test_wire_metrics_match_actual_httpx_utf8_request_without_changing_or_exposing_input():
    import httpx

    payload = {"model": "fixture", "messages": [
        {"role": "system", "content": "中文系统提示"},
        {"role": "user", "content": "private-user-content"},
        {"role": "tool", "tool_call_id": "call-1", "content": "private-tool-content"}],
        "tools": [{"type": "function", "function": {"name": "project_read",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}],
        "max_tokens": 2048, "tool_choice": "auto"}
    original = copy.deepcopy(payload)
    metrics = smoke.wire_request_metrics(payload)
    request = httpx.Request("POST", "https://fixture.invalid", json=payload,
                            headers={"authorization": "Bearer private-management-key"})
    assert metrics["serializedBodyBytes"] == len(request.content)
    assert metrics["messagesByRole"]["system"]["count"] == 1
    assert metrics["messagesByRole"]["tool"]["count"] == 1
    assert metrics["toolCount"] == 1
    assert metrics["toolSchemas"][0]["tool"] == "project_read"
    assert metrics["toolSchemas"][0]["schemaBytes"] > 0
    assert metrics["maxOutputTokens"] == 2048
    assert metrics["toolChoice"] == "auto"
    assert payload == original
    serialized = json.dumps(metrics)
    for private in ("中文系统提示", "private-user-content", "private-tool-content", "private-management-key"):
        assert private not in serialized
    changed = copy.deepcopy(payload)
    changed["messages"][0]["content"] += "多"
    changed_metrics = smoke.wire_request_metrics(changed)
    assert changed_metrics["serializedBodyBytes"] - metrics["serializedBodyBytes"] == len("多".encode("utf-8"))
    assert changed_metrics["toolDefinitionsBytes"] == metrics["toolDefinitionsBytes"]


def test_usage_metrics_keep_missing_and_failed_sample_cost_unknown():
    samples = [
        {"status": "completed", "usage": {"prompt_tokens": 3000, "completion_tokens": 10, "total_tokens": 3010}, "wireRequests": [{}, {}]},
        {"status": "completed", "usage": {"completion_tokens": 20}, "wireRequests": [{}]},
        {"status": "failed", "wireRequests": [{}]},
    ]
    result = smoke.usage_metrics(samples)
    assert result["sampleCount"] == 3
    assert result["completedSamples"] == 2
    assert result["wireRequestCount"] == 4
    assert result["promptTokens"] == {"knownSum": 3000, "reportedSamples": 1, "unreportedSamples": 2}
    assert result["completionTokens"] == {"knownSum": 30, "reportedSamples": 2, "unreportedSamples": 1}
    assert result["totalTokens"]["knownSum"] == 3010


def test_filtered_provider_usage_is_recorded_without_double_counting_success():
    samples = [
        {"status": "completed", "usage": {"total_tokens": 100},
            "providerResponses": [{"usage": {"total_tokens": 100}}]},
        {"status": "failed", "providerResponses": [{"finishReasons": ["content_filter"],
            "usage": {"prompt_tokens": 5709, "completion_tokens": 50, "total_tokens": 5759}}]},
    ]
    result = smoke.usage_metrics(samples)
    assert result["completedSamples"] == 1
    assert result["totalTokens"] == {"knownSum": 5859, "reportedSamples": 2, "unreportedSamples": 0}
    assert result["completionTokens"] == {"knownSum": 50, "reportedSamples": 1, "unreportedSamples": 1}


def test_budget_report_reads_current_production_values_without_overriding_them():
    project = {"profile": "fixture-project", "maxRounds": 15, "maxTokens": 40000, "maxWallSeconds": 120.0}
    module = SimpleNamespace(MAX_TOOL_ROUNDS=9, MAX_CHEAP_TOKENS=4321, MAX_WALL_SECONDS=17.0,
        PROJECT_BUDGET=SimpleNamespace(to_wire=lambda: dict(project)))
    report = smoke.control_budget_metrics(module)
    assert report["legacyDefaults"] == {"profile": "control-v1", "maxRounds": 9, "maxTokens": 4321, "maxWallSeconds": 17.0}
    assert report["projectProfile"] == project
    assert module.MAX_TOOL_ROUNDS == 9 and module.MAX_CHEAP_TOKENS == 4321 and module.MAX_WALL_SECONDS == 17.0
    report["projectProfile"]["maxTokens"] = 1
    assert module.PROJECT_BUDGET.to_wire() == project


@pytest.mark.parametrize("finish", ["stop", "content_filter", "length"])
def test_passive_observer_is_connected_to_actual_control_client_request_and_response(monkeypatch, finish):
    import httpx
    from sliderule_llm import control_client
    from services.project_tool_contracts import PROJECT_TOOLS

    observed = {"wireRequests": []}
    received = []
    def handle(request):
        received.append(request)
        return httpx.Response(200, json={"model": "fixture-model", "usage": {
            "prompt_tokens": 3000, "completion_tokens": 50, "total_tokens": 3050},
            "choices": [{"finish_reason": finish,
                "message": {"content": "fixture response" if finish == "stop" else
                    "private-filtered-partial-response" if finish == "content_filter" else ""}}]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(control_client.httpx, "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url="https://fixture.invalid/v1", model="fixture-model", timeout_ms=1000))
    original_payload, original_extract = control_client._control_chat_payload, control_client._extract_control
    restore = smoke.attach_transport_observer(control_client, lambda: observed)
    try:
        call = smoke.observe_model_result(control_client.call_control_llm, observed,
            [{"role": "user", "content": "Run fixture"}], tools=PROJECT_TOOLS)
        if finish != "stop":
            with pytest.raises(control_client.LlmError) as failed:
                asyncio.run(call)
            assert observed["status"] == "failed"
            assert failed.value.finish_reason == finish
        else:
            result = asyncio.run(call)
            assert result.content == "fixture response"
            assert observed["status"] == "completed"
        assert len(received) == 1
        assert observed["wireRequests"][0]["serializedBodyBytes"] == len(received[0].content)
        assert observed["wireRequests"][0]["toolCount"] == len(PROJECT_TOOLS)
        assert len(observed["providerResponses"]) == 1
        response = observed["providerResponses"][0]
        assert response["finishReasons"] == [finish]
        assert observed["finishReason"] == finish
        assert response["usage"]["total_tokens"] == 3050
        assert response["normalizedContentChars"] == (None if finish == "content_filter" else
            len("fixture response") if finish == "stop" else 0)
        assert response["normalizedToolCallCount"] == (None if finish == "content_filter" else 0)
        assert "private-filtered-partial-response" not in json.dumps(observed)
        assert smoke.usage_metrics([observed])["totalTokens"] == {
            "knownSum": 3050, "reportedSamples": 1, "unreportedSamples": 0}
    finally:
        restore()
    assert control_client._control_chat_payload is original_payload
    assert control_client._extract_control is original_extract


def test_turn_diagnostics_retains_authoritative_provider_stop_and_budget_receipt():
    record = {"checkpoint": {"cheapTokens": 36625, "round": 8,
        "budgetPolicy": {"profile": "project-v1"}, "messages": ["private source"],
        "providerFailure": {"finishReason": "content_filter", "reportedTokens": 5759}}}
    events = [{"type": "control_stopped", "stopReason": "llm_unavailable",
        "providerFinishReason": "content_filter", "text": "private text"}]
    result = smoke.turn_diagnostics(record, events)
    assert result["stopDetails"] == [{"stopReason": "llm_unavailable", "providerFinishReason": "content_filter"}]
    assert result["persistedBudget"]["providerFailure"] == record["checkpoint"]["providerFailure"]
    assert result["persistedBudget"]["cheapTokens"] == 36625
    assert result["persistedBudget"]["budgetPolicy"] == {"profile": "project-v1"}
    assert "private" not in json.dumps(result)


def _fixture():
    result = {"tool": "project_read", "ok": True, "content": "real source", "revision": "rev-1"}
    record = {"checkpoint": {"messages": [
        {"role": "assistant", "tool_calls": [{"id": "call-1", "function": {
            "name": "project_read", "arguments": '{"path":"src/main.tsx"}'}}]},
        {"role": "tool", "tool_call_id": "call-1", "content": json.dumps(result)},
    ]}}
    event = {"type": "control_tool_result", "toolCallId": "call-1", **result}
    return record, event


def test_tool_evidence_matches_real_durable_assistant_and_result():
    record, event = _fixture()
    evidence = smoke.correlate(record, [event])
    assert evidence[0]["arguments"] == {"path": "src/main.tsx"}
    assert evidence[0]["result"]["content"] == "real source"


@pytest.mark.parametrize("broken", [None, "request-failed", "not-fed", "different-call", "different-result"])
def test_durable_results_must_reach_a_successful_followup_model_request(broken):
    record, event = _fixture()
    evidence = smoke.correlate(record, [event])
    sample = {"status": "completed", "receivedToolResults": [{
        "toolCallId": "call-1", "content": json.dumps(evidence[0]["result"])}]}
    if broken == "request-failed":
        sample["status"] = "failed"
    elif broken == "not-fed":
        sample["receivedToolResults"] = []
    elif broken == "different-call":
        sample["receivedToolResults"][0]["toolCallId"] = "call-other"
    elif broken == "different-result":
        sample["receivedToolResults"][0]["content"] = '{"ok": true}'
    if broken:
        with pytest.raises(RuntimeError, match="not_sent_back"):
            smoke.require_model_receipts([sample], evidence)
    else:
        smoke.require_model_receipts([sample], evidence)


@pytest.mark.parametrize("broken", ["assistant", "tool", "call-id", "content", "prose-only"])
def test_missing_or_fabricated_model_tool_evidence_is_not_a_pass(broken):
    record, event = _fixture()
    if broken == "assistant":
        record["checkpoint"]["messages"].pop(0)
    elif broken == "tool":
        record["checkpoint"]["messages"].pop()
    elif broken == "call-id":
        event["toolCallId"] = "fabricated"
    elif broken == "content":
        event["content"] = "fabricated source"
    else:
        event = {"type": "control_text", "text": "I read and patched the source successfully."}
    with pytest.raises(RuntimeError, match="correlation|did_not_execute"):
        smoke.correlate(record, [event])


@pytest.mark.parametrize("broken", [None, "unchanged-revision", "extra-file", "missing-edit"])
def test_exact_source_edit_requires_new_revision_and_preserves_other_files(broken):
    before = {"src/main.tsx": "<h1>New Project</h1>\n", "package.json": "{}"}
    after = {**before, "src/main.tsx": "<h1>Smoke title</h1>\n"}
    revision = "rev-2"
    if broken == "unchanged-revision":
        revision = "rev-1"
    elif broken == "extra-file":
        after["extra.ts"] = ""
    elif broken == "missing-edit":
        after = before
    if broken:
        with pytest.raises(RuntimeError, match="requested_exact_edit"):
            smoke.require_edit(before, after, "rev-1", revision, "Smoke title")
    else:
        smoke.require_edit(before, after, "rev-1", revision, "Smoke title")


@pytest.mark.parametrize("broken", [None, "stale", "failed", "bool-exit", "no-status", "no-logs", "fake-log"])
def test_exit_and_model_observation_must_describe_same_real_command(broken):
    operation = SimpleNamespace(expectedRevision="rev-2", input={"command": "check"},
        status="completed", result={"exitCode": 0}, operationId="op-1")
    evidence = [
        {"tool": "project_status", "result": {"operationId": "op-1", "revision": "rev-2", "status": "completed", "exitCode": 0}},
        {"tool": "project_logs", "result": {"operationId": "op-1", "logs": [{"text": "> tsc --noEmit\n"}]}},
    ]
    if broken == "stale":
        operation.expectedRevision = "rev-1"
    elif broken == "failed":
        operation.status = "failed"
    elif broken == "bool-exit":
        operation.result["exitCode"] = False
    elif broken == "no-status":
        evidence.pop(0)
    elif broken == "no-logs":
        evidence.pop()
    elif broken == "fake-log":
        evidence[1]["result"]["logs"] = [{"text": "The model claims that everything passed."}]
    if broken:
        with pytest.raises(RuntimeError, match="not_passed|did_not_observe|did_not_read"):
            smoke.require_verified_command(operation, "rev-2", evidence)
    else:
        smoke.require_verified_command(operation, "rev-2", evidence)


def _live_receipts():
    runtime = SimpleNamespace(runtimeId="rt-1", workspaceId="ws-1", processId="42",
        revision="rev-1", status="ready", health="revision_verified")
    initial = SimpleNamespace(operationId="start-1", kind="runtime.start", projectId="project-1",
        sessionId="session-1", expectedRevision="rev-1", requestHash="original-request", runtime=runtime,
        status="running", cancelRequested=False)
    current = copy.deepcopy(initial)
    current.runtime.revision = "rev-2"
    receipt = {"runtimeOperationId": "start-1", "revision": "rev-2", "parentRevision": "rev-1",
        "synchronized": True, "sourcePublished": True, "verification": "not_run"}
    child = SimpleNamespace(operationId="patch-1", kind="runtime.patch", status="completed",
        result=receipt, expectedRevision="rev-1", input={"runtimeOperationId": "start-1"},
        projectId="project-1", sessionId="session-1", leaseGeneration=3)
    before = SimpleNamespace(sandboxId="sb-1", workspaceId="ws-1", generation=3,
        leaseOwner="worker-1", mountedRevision="rev-1", processRefs={"operationId": "start-1", "server": "42"})
    after = copy.deepcopy(before)
    after.mountedRevision = "rev-2"
    observed = [
        {"tool": "project_status", "result": {"ok": True, "operationId": "patch-1",
            "kind": "runtime.patch", "status": "completed", **receipt}},
        {"tool": "project_status", "result": {"ok": True, "operationId": "start-1", "status": "running",
            "runtime": {"status": "ready", "revision": "rev-2"}}},
    ]
    return initial, current, child, before, after, observed


@pytest.mark.parametrize("broken", [None, "queued", "not-synchronized", "not-published", "wrong-verification",
    "wrong-parent", "old-revision", "replacement-runtime", "replacement-server", "unknown-health",
    "original-request-mutated", "replacement-sandbox", "new-generation", "wrong-mounted",
    "child-not-observed", "parent-not-observed", "observed-old-revision"])
def test_live_edit_requires_same_runtime_durable_receipt_and_actual_model_observation(broken):
    initial, current, child, before, after, observed = _live_receipts()
    if broken == "queued": child.status = "queued"
    elif broken == "not-synchronized": child.result["synchronized"] = 1
    elif broken == "not-published": child.result["sourcePublished"] = False
    elif broken == "wrong-verification": child.result["verification"] = "passed"
    elif broken == "wrong-parent": child.input["runtimeOperationId"] = "other-runtime"
    elif broken == "old-revision": child.result["revision"] = "rev-1"
    elif broken == "replacement-runtime": current.runtime.runtimeId = "rt-2"
    elif broken == "replacement-server": current.runtime.processId = "43"
    elif broken == "unknown-health": current.runtime.health = "unknown"
    elif broken == "original-request-mutated": current.expectedRevision = "rev-2"
    elif broken == "replacement-sandbox": after.sandboxId = "sb-2"
    elif broken == "new-generation": after.generation = 4
    elif broken == "wrong-mounted": after.mountedRevision = "rev-1"
    elif broken == "child-not-observed": observed.pop(0)
    elif broken == "parent-not-observed": observed.pop()
    elif broken == "observed-old-revision": observed[0]["result"]["revision"] = "rev-1"
    if broken:
        with pytest.raises(RuntimeError, match="live_model_patch_|model_did_not_observe"):
            smoke.require_live_edit_receipts(initial, current, child, before, after, observed)
    else:
        smoke.require_live_edit_receipts(initial, current, child, before, after, observed)


@pytest.mark.parametrize("field,value", [("synchronized", False), ("sourcePublished", False),
    ("runtime", {"status": "ready", "revision": "different"}), ("verification", "passed")])
def test_live_receipt_sse_cannot_disagree_with_durable_model_result(field, value):
    record, event = _fixture()
    record["checkpoint"]["messages"][0]["tool_calls"][0]["function"]["name"] = "project_status"
    reply = {"tool": "project_status", "ok": True, "operationId": "patch-1", "synchronized": True,
        "sourcePublished": True, "verification": "not_run", "runtime": {"status": "ready", "revision": "rev-2"}}
    record["checkpoint"]["messages"][1]["content"] = json.dumps(reply)
    event = {"type": "control_tool_result", "toolCallId": "call-1", **reply}
    assert smoke.correlate(record, [event])[0]["result"] == reply
    event[field] = value
    with pytest.raises(RuntimeError, match="correlation_mismatch"):
        smoke.correlate(record, [event])
