"""A real provider rejection is a billed terminal receipt, never a retry hint.

The live single-turn project smoke reported another 5759 tokens with
content_filter after starting an E2B check. Previously only the preceding
successful samples were saved, and the user was told to start the HTML factory.
Exercise the provider HTTP decoder inside the durable project control loop.
"""

import asyncio

import pytest

from control_turn_support import llm_tool, six_fields
from services import rehearsal_control as control
from services.control_checkpoint import ControlRunStopped
from services.control_run_service import RunCheckpoint
from services.project_creation import create_session_project
from sliderule_llm import control_client
from sliderule_llm.client import LlmError
from test_control_provider_termination import install_response
from test_control_run_service import env, settled


@pytest.mark.parametrize("crash_after_receipt", [False, True])
def test_filtered_http_response_is_accounted_and_never_resampled(env, monkeypatch, crash_after_receipt):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
    requests = install_response(monkeypatch, {
        "choices": [{"message": {"content": None}, "finish_reason": "content_filter"}],
        "usage": {"prompt_tokens": 5500, "completion_tokens": 259, "total_tokens": 5759},
    })
    model_calls = []

    async def model(messages, **kwargs):
        model_calls.append(1)
        if len(model_calls) == 1:
            return llm_tool("project_status", {}, usage={"total_tokens": 3015})
        return await control_client.call_control_llm(messages, **kwargs)

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    original = RunCheckpoint.save
    first = env.service()

    async def save(port, cp):
        await original(port, cp)
        if crash_after_receipt and port.service is first and cp.get("phase") == "provider_failed":
            first._stopping = True
            raise ControlRunStopped("control_worker_shutdown")

    monkeypatch.setattr(RunCheckpoint, "save", save)

    async def run():
        await first.start()
        record = await first.submit(six_fields(env.state.sessionId, "Continue approved work"), env.owner,
                                    "provider-filter-receipt")
        try:
            if crash_after_receipt:
                for _ in range(1000):
                    if first._stopping and not first._tasks:
                        break
                    await asyncio.sleep(0.005)
                else:
                    raise AssertionError("producer did not persist the provider failure receipt")
                saved = env.store.get(record["runId"], env.owner)
            else:
                saved = await settled(first, record["runId"])
            # A filtered provider response is a terminal *turn* outcome.  The
            # durable run may be marked completed because the control stream
            # settled, but it must carry the provider stop receipt and may not
            # be mistaken for a successful model turn or an implicit retry.
                assert saved["status"] == "failed"
                assert saved["error"] == "llm_unavailable"
                assert any(e.get("type") == "complete" for e in saved["events"])
                assert not any(e.get("tool") == "project_exec" for e in saved["events"])
                assert saved["checkpoint"]["phase"] == "provider_failed"
                same = await first.submit(
                    six_fields(env.state.sessionId, "Continue approved work"),
                    env.owner,
                    "provider-filter-receipt",
                )
                assert same["runId"] == record["runId"]
                assert len(requests) == 1, "replaying the completed request must not resample"
        finally:
            await first.shutdown()
        cp = saved["checkpoint"]
        assert cp["phase"] == "provider_failed"
        assert cp["round"] == 2
        assert cp["cheapTokens"] == 3015 + 5759
        # 2026-09-17 起新回合默认 project-v3（取消轮次/墙钟上限）。
        assert cp["budgetPolicy"]["profile"] == "project-v3"
        assert cp["providerFailure"] == {"finishReason": "content_filter", "reportedTokens": 5759}
        if crash_after_receipt:
            second = env.service()
            await second.start()
            try:
                final = await settled(second, record["runId"])
                assert final["status"] == "failed"
                assert final["error"] == "llm_unavailable"
                assert final["checkpoint"] == cp
            finally:
                await second.shutdown()
        else:
            [stop] = [e for e in saved["events"] if e.get("stopReason")]
            assert stop["stopReason"] == "llm_unavailable" and stop["stoppedBy"] == "provider"
            assert stop["providerFinishReason"] == "content_filter"
            assert "内容过滤" in stop["text"] and "未自动重试" in stop["text"]
            assert "工程源码" in stop["text"]
            assert "开始推演" not in stop["text"] and "没点火" not in stop["text"]
        assert len(model_calls) == 2 and len(requests) == 1

    asyncio.run(run())


@pytest.mark.parametrize("usage", [None, {"reasoning_tokens": 10}])
def test_provider_without_usage_does_not_invent_a_zero_cost_receipt(env, monkeypatch, usage):
    async def model(*args, **kwargs):
        raise LlmError("upstream closed connection", transient=False, usage=usage)

    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(six_fields(env.state.sessionId, "Continue"), env.owner, "unknown-cost")
            saved = await settled(service, record["runId"])
            assert saved["checkpoint"]["phase"] == "provider_failed"
            assert saved["checkpoint"]["providerFailure"]["reportedTokens"] is None
        finally:
            await service.shutdown()

    asyncio.run(run())
