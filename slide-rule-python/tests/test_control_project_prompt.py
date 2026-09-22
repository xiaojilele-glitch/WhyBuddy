"""The system instruction received by the model must match running-source IO.

The live 2026-09-13 smoke offered a tool that can synchronize source, but the
system prompt still ordered cancellation first. The model cancelled the real
runtime before any edit. Exercise HTTP assembly and durable recovery so fixing
only a tool description or a disconnected prompt helper cannot pass these tests.
"""
import asyncio
import json

import pytest
from project_actor_support import project_actor

from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool
from services import rehearsal_control as control
from services.project_creation import create_session_project
from test_control_project_budget import parked_checkpoint
from test_control_project_tools import post, setup
from test_control_run_service import env, settled


def assert_live_guidance(messages, offered, *, has_project=True):
    prompt = messages[0]["content"]
    assert messages[0]["role"] == "system"
    assert "保持当前应用运行，不需要先取消" in prompt
    assert all(path in prompt for path in ("src/", "public/", "tests/", "index.html"))
    assert "completed 且 synchronized=true" in prompt
    assert "依赖或启动配置变更需先停止并确认清理" in prompt
    assert "修改前先取消活跃运行" not in prompt
    assert "私有预览和独立浏览器验收尚未接入" not in prompt
    # Readiness is assembled on the live control-turn path (including before
    # project creation), while browser acceptance remains a separate gate.
    assert "当前本地能力就绪检查" in prompt
    assert "不能用构建、API 或模型自述替代" in prompt
    if has_project:
        patch = next(item["function"] for item in offered if item["function"]["name"] == "project_patch")
        assert "existing worker" in patch["description"] and "synchronized=true" in patch["description"]
    else:
        names = {item["function"]["name"] for item in offered}
        assert "project_create" in names and "project_patch" not in names


@pytest.mark.parametrize("precreated", [False, True], ids=["new-project", "existing-project"])
def test_live_http_model_assembly_uses_source_sync_guidance_before_and_after_tool_result(setup, monkeypatch, precreated):
    if precreated:
        create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    observed = []
    def model(messages, **kwargs):
        results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
        assert_live_guidance(messages, kwargs["tools"], has_project=precreated or bool(results))
        observed.append(messages[0]["content"])
        if not results:
            return llm_tool("project_read" if precreated else "project_create",
                {"path": "src/main.tsx"} if precreated else {"approvalRef": setup.ref})
        assert results[-1]["ok"], results[-1]
        return llm_text("The saved project can synchronize source while its runtime stays active.")
    harness.llm_impl = model
    events = post(setup.state)
    # ⚠ 2026-09-15：第 3 次调用是自动续跑那一轮——工程目标收尾时还没交付，
    #   `should_continue` 再醒一次（reason=goal_not_delivered），`no_progress`
    #   那道闸保证只多这一轮。这条判据在乎的是**每一发都带着源码同步指引**
    #   （上面 `assert_live_guidance` 在每次调用里跑），续跑那一发同样要带——
    #   所以数字跟着到 3，同时把续跑正面钉住：没了会红，失控成两轮也会红。
    assert [(e["attempt"], e["reason"]) for e in events
            if e.get("type") == "control_continuation"] == [(1, "goal_not_delivered")]
    assert len(observed) == 3 and events[-1]["type"] == "complete"
    assert not any(event.get("tool") == "project_cancel" for event in events)


def test_durable_control_recovery_replaces_old_saved_stop_before_patch_instruction(env, monkeypatch):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
    async def run():
        owned, initial_calls = await parked_checkpoint(env, monkeypatch)
        checkpoint = owned["checkpoint"]
        checkpoint["messages"][0] = {"role": "system", "content": "STALE: 修改前先取消活跃运行，等停止并清理完成后再 patch"}
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], checkpoint)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        received = []
        async def model(messages, **kwargs):
            assert_live_guidance(messages, kwargs["tools"])
            assert "STALE:" not in messages[0]["content"]
            received.append(messages)
            return llm_text("Recovered the current source synchronization contract.")
        monkeypatch.setattr(control, "_invoke_control_llm", model)
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            # ⚠ 2026-09-15：第 2 发是自动续跑那一轮（目标还没到可交付）。
            #   与其把数字改大，不如钉住这一轮真正该有的东西：续跑说明必须
            #   **带着服务端算出来的缺口**进到对话里——设计头注写的
            #   「模型得知道自己为什么又醒了，内容由 blockedReasons 生成，
            #   不是『请继续』」。那句话没了，续跑就退化成空转。
            assert final["status"] == "completed" and len(initial_calls) == 1
            assert len(received) == 2, [len(m) for m in received]
            notice = received[1][-1]["content"]
            assert "还没达到可交付状态" in notice, notice
            assert "project_verification_required" in notice, notice
            # 反向：续跑那一发同样不许把那条陈旧的停止指令带回来。
            assert "STALE:" not in "".join(m["content"] for m in received[1])
        finally:
            await second.shutdown()
    asyncio.run(run())
