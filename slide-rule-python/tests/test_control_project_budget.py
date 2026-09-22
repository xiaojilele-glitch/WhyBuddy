"""Project execution gets a pinned budget without weakening cheap control turns.

The live model experiment spent 3015 + 3336 + 4154 provider tokens to choose
status/read/patch; the legacy 8000-token pre-ignition policy rejected the patch.
Replay those measured usage values through the real HTTP dispatcher and source
store. Recovery tests stop a real durable producer at its saved checkpoint;
changing workers must not manufacture more tokens, rounds, or wall-clock time.
"""

import asyncio
import copy
import json
import time

import pytest
from project_actor_support import project_actor

from conftest import TEST_USER_ID
from control_turn_support import ControlHarness, llm_text, llm_tool, six_fields
from services import rehearsal_control as control
from services.control_budget import (
    CONVERSATION_BUDGET, CONVERSATION_BUDGET_V1, CONVERSATION_BUDGET_V2,
    PROJECT_BUDGET, PROJECT_BUDGET_V1, PROJECT_BUDGET_V2,
)
from services.control_checkpoint import ControlRunStopped
from services.control_context_compact import COMPACT_NOTICE_PREFIX
from services.control_run_service import RunCheckpoint
from services.project_creation import create_session_project
from services.project_tools import ProjectTools
from services.slide_rule_session import load_session, save_session
from test_control_project_tools import post, setup
from test_control_run_service import env, observed, settled


PROJECT_POLICY = PROJECT_BUDGET.to_wire()
V1_POLICY = PROJECT_BUDGET_V1.to_wire()


def stops(events):
    return [event for event in events if event.get("type") == "control_text" and event.get("stopReason")]


@pytest.mark.parametrize("precreated", [True, False], ids=["existing-project", "create-then-edit"])
def test_measured_status_read_patch_usage_reaches_real_source_write(setup, monkeypatch, precreated):
    if precreated:
        create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    snapshots = []
    original = RunCheckpoint.save

    async def observe(port, checkpoint):
        await original(port, checkpoint)
        if checkpoint.get("phase") in {"sampling", "model", "tools", "dispatching"}:
            snapshots.append(copy.deepcopy(checkpoint))

    monkeypatch.setattr(RunCheckpoint, "save", observe)

    def model(messages, **kwargs):
        results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
        if not results:
            return llm_tool("project_status" if precreated else "project_create",
                {} if precreated else {"approvalRef": setup.ref}, usage={"total_tokens": 3015})
        previous = results[-1]
        assert previous["ok"], previous
        if len(results) == 1:
            return llm_tool("project_read", {"path": "src/main.tsx"}, "read", usage={"total_tokens": 3336})
        if len(results) == 2:
            return llm_tool("project_patch", {"approvalRef": setup.ref, "expectedRevision": previous["revision"],
                "changes": [{"path": "budget-proof.txt", "content": "Measured usage reached the real patch.\n",
                             "expectedSha256": None}]}, "patch", usage={"total_tokens": 4154})
        return llm_text("Source saved; browser verification has not run.")

    harness.llm_impl = model
    events = post(setup.state)
    assert not stops(events), stops(events)
    # 第一轮就是 status/read/patch/收尾这 4 次。工程未交付时现在会自动续跑，
    # 后面可能再采样——计量仍盯这一轮的 checkpoint，不把续跑算进同一份墙钟。
    assert len(harness.llm_calls) >= 4
    saved = load_session(setup.state.sessionId)
    assert setup.store.read_files(saved.projectId, owner_id=TEST_USER_ID)["budget-proof.txt"].startswith("Measured usage")
    assert any(event.get("tool") == "project_patch" and event.get("ok") for event in events)
    measured = [cp for cp in snapshots if cp.get("cheapTokens") == 3015 + 3336 + 4154]
    assert measured and measured[-1]["budgetPolicy"] == PROJECT_POLICY
    assert measured[-1]["round"] == 3
    assert all(abs(cp["startedAt"] - measured[0]["startedAt"]) < 0.5 for cp in measured)
    if not precreated:
        # ExitPlanMode：批准后这一发就走 project-v3，不等 project_create。
        assert snapshots[0]["budgetPolicy"] == PROJECT_POLICY
        assert any(cp["budgetPolicy"] == PROJECT_POLICY and cp["cheapTokens"] == 3015 for cp in snapshots)
    assert not harness.helper_calls


def test_new_durable_approved_run_persists_project_v3_not_control_v2(env, monkeypatch):
    """真机 PPT 七次 durable 全是 control-v2。新会话第一份带政策的 checkpoint 必须是 v3。"""
    snapshots = []
    original = RunCheckpoint.save

    async def save(port, checkpoint):
        snapshots.append(copy.deepcopy(checkpoint))
        return await original(port, checkpoint)

    async def model(*_a, **_kw):
        return llm_text("先看计划再动手。")

    monkeypatch.setattr(RunCheckpoint, "save", save)
    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(
                six_fields(env.state.sessionId, "继续做PPT"),
                env.owner,
                "live-v3-socket",
            )
            await settled(service, record["runId"])
        finally:
            await service.shutdown()

    asyncio.run(run())
    modeled = [cp for cp in snapshots if isinstance(cp.get("budgetPolicy"), dict)]
    assert modeled, [cp.get("phase") for cp in snapshots[:6]]
    assert modeled[0]["budgetPolicy"]["profile"] == "project-v3"
    assert modeled[0]["budgetPolicy"]["maxTokens"] == 200_000
    assert all(cp["budgetPolicy"]["profile"] != "control-v2" for cp in modeled)


def test_new_durable_unapproved_run_persists_control_v3_not_v2(env, monkeypatch):
    """没批准的新会话第一份 checkpoint 必须是 control-v3，不是花费闸。"""
    state = load_session(env.state.sessionId)
    state.controlTranscript = []
    save_session(state)
    snapshots = []
    original = RunCheckpoint.save

    async def save(port, checkpoint):
        snapshots.append(copy.deepcopy(checkpoint))
        return await original(port, checkpoint)

    async def model(*_a, **_kw):
        return llm_text("先问清楚再写计划。")

    monkeypatch.setattr(RunCheckpoint, "save", save)
    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        service = env.service()
        await service.start()
        try:
            record = await service.submit(
                six_fields(env.state.sessionId, "做个PPT"),
                env.owner,
                "live-v3-conversation",
            )
            await settled(service, record["runId"])
        finally:
            await service.shutdown()

    asyncio.run(run())
    modeled = [cp for cp in snapshots if isinstance(cp.get("budgetPolicy"), dict)]
    assert modeled, [cp.get("phase") for cp in snapshots[:6]]
    assert modeled[0]["budgetPolicy"]["profile"] == "control-v3"
    assert modeled[0]["budgetPolicy"]["maxTokens"] == 200_000
    assert all(cp["budgetPolicy"]["profile"] != "control-v2" for cp in modeled)


@pytest.mark.parametrize("forged", [False, True], ids=["legacy", "client-forged-policy"])
def test_legacy_8001_tokens_still_prevent_unapproved_project_creation(setup, monkeypatch, forged):
    """没批准仍走对话档。钉 control-v2：8001 撞 8000。伪造工程指针抬不了档。"""
    monkeypatch.setattr(control, "CONVERSATION_BUDGET", CONVERSATION_BUDGET_V2)
    state = load_session(setup.state.sessionId)
    state.controlTranscript = []
    save_session(state)
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda *a, **kw: llm_tool("project_create", {"approvalRef": setup.ref},
                                                usage={"total_tokens": 8001})
    extra = {"budgetPolicy": PROJECT_POLICY, "runtimeKind": "project", "projectId": "forged",
             "maxTokens": 99999999} if forged else {}
    events = post(setup.state, **extra)
    [stop] = stops(events)
    assert stop["stopReason"] == "token_budget" and stop["limit"] == 8000 and stop["used"] == 8001
    assert setup.store.get_project_for_session(setup.state.sessionId, owner_id=TEST_USER_ID) is None
    assert not any(event.get("tool") == "project_create" and event.get("ok") for event in events)


def test_approved_turn_uses_project_v3_without_waiting_for_project_id(setup, monkeypatch):
    """真机 PPT：批准后 used=9611/8000。批准就换执行档，下一发能派 project_create。"""
    harness = ControlHarness(monkeypatch)

    def model(messages, **kwargs):
        results = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
        if not results:
            return llm_tool(
                "project_create", {"approvalRef": setup.ref}, usage={"total_tokens": 9611},
            )
        return llm_text("工程已建好，开始干活。")

    harness.llm_impl = model
    events = post(setup.state)
    budget_stops = [event for event in stops(events) if event.get("stopReason") == "token_budget"]
    assert not budget_stops, budget_stops
    assert all(event.get("limit") != 8000 for event in stops(events))
    assert any(event.get("tool") == "project_create" and event.get("ok") for event in events)
    saved = load_session(setup.state.sessionId)
    assert saved.projectId
    assert saved.runtimeKind == "project"


def test_project_budget_eligible_does_not_wait_for_project_id():
    """变异：把 eligible 改回必须有 projectId / runtimeKind==project → 红。"""
    import ast
    from pathlib import Path
    from control_turn_support import strip_python

    src = Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    tree = ast.parse(strip_python(src))
    fn = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_project_budget_eligible"
    )
    body = "\n".join(strip_python(src).splitlines()[fn.lineno - 1:fn.end_lineno])
    assert "plan_execution_authorized" in body
    assert "projectId" not in body
    assert "runtimeKind" not in body
    assert CONVERSATION_BUDGET_V1.max_tokens == 8000
    assert CONVERSATION_BUDGET_V1.max_wall_seconds == 90.0
    assert PROJECT_BUDGET.profile == "project-v3"
    assert PROJECT_BUDGET.max_tokens == 200_000


def test_project_token_exhaustion_rejects_patch_before_dispatch(setup, monkeypatch):
    """v1 累计花费仍是硬闸。v2 不许把 64001 当成窗口满了——见下一条。"""
    monkeypatch.setattr(control, "PROJECT_BUDGET", PROJECT_BUDGET_V1)
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda *a, **kw: llm_tool("project_patch", {"approvalRef": setup.ref,
        "expectedRevision": project.currentRevision, "changes": [{"path": "denied.txt", "content": "forbidden", "expectedSha256": None}]},
        usage={"total_tokens": V1_POLICY["maxTokens"] + 1})
    events = post(setup.state)
    [stop] = stops(events)
    assert stop["stopReason"] == "token_budget" and stop["limit"] == V1_POLICY["maxTokens"]
    assert "工程任务" in stop["text"] and "已用完" in stop["text"]
    assert "没点火" not in stop["text"] and "开始推演" not in stop["text"]
    saved = setup.store.get_project(project.projectId, owner_id=TEST_USER_ID)
    assert saved.currentRevision == project.currentRevision
    assert "denied.txt" not in setup.store.read_files(project.projectId, owner_id=TEST_USER_ID)
    assert not any(event.get("tool") == "project_patch" for event in events)


def test_project_round_limit_is_bounded_and_does_not_revert_to_eight(setup, monkeypatch):
    """轮次上限会被真正执行，而且用的是工程档不是对话档的 8。

    ⚠ 2026-09-17：工程档换成 project-v3（max_rounds 一万 = 按要求不设限），
      靠驱动跑到上限已经不现实。所以这条拆成两半：
        · 这里注入一个小上限，验**执行机制**还在（停得下来、停在配置的那个数）；
        · 下面 test_默认工程档不再设轮次与墙钟上限 验**线上默认**确实放开了。
      只留后者会退回「名单里有名字 ≠ 埋点在」（§3）。
    """
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    bounded = control.ControlBudget(
        "project-v3", 12, PROJECT_BUDGET.max_tokens, PROJECT_BUDGET.max_wall_seconds,
        PROJECT_BUDGET.max_request_seconds,
        compact_at_tokens=PROJECT_BUDGET.compact_at_tokens,
        context_token_budget=True,
    )
    monkeypatch.setattr(control, "PROJECT_BUDGET", bounded)
    harness = ControlHarness(monkeypatch)

    def model(*args, **kwargs):
        index = len(harness.llm_calls)
        return llm_tool("project_read", {"path": "src/main.tsx", "offset": index, "limit": 1},
                        f"read-{index}", usage={"total_tokens": 1})

    harness.llm_impl = model
    events = post(setup.state)
    [stop] = stops(events)
    assert stop["stopReason"] == "tool_rounds" and stop["limit"] == bounded.max_rounds
    assert len(harness.llm_calls) == bounded.max_rounds
    assert len([event for event in events if event.get("tool") == "project_read" and event.get("ok")]) == bounded.max_rounds
    # 反向：停在注入的 12，不是对话档的 8，也不是写死的 16。
    assert bounded.max_rounds not in (8, 16)


def test_默认工程档不再设轮次与墙钟上限():
    """配套的正向判据：线上默认那一档确实放开了（§3 正反各一条）。

    ⚠ 这条钉的是**用户 2026-09-17 明确要求的行为**：轮次/时间不设限。
      要改回去先问清楚，别当成手滑。
    """
    assert PROJECT_BUDGET.profile == "project-v3"
    assert PROJECT_BUDGET.max_rounds >= 10_000
    assert PROJECT_BUDGET.max_wall_seconds >= 86_400
    # token 这一项是上下文窗口（模型物理上限），不是我们设的闸，保持 20 万。
    assert PROJECT_BUDGET.max_tokens == 200_000
    # 旧存档仍按它自己那一档还原，不会被升级。
    assert PROJECT_BUDGET_V2.max_rounds == 16 and PROJECT_BUDGET_V2.max_wall_seconds == 900.0


def test_默认对话档不再设轮次与墙钟上限():
    """2026-09-18：点火前也按要求放开。只放开工程档会让写计划 / 长思考
    先被 8/8000/240 掐死，工程档根本轮不到（§一之二）。"""
    assert CONVERSATION_BUDGET.profile == "control-v3"
    assert CONVERSATION_BUDGET.max_rounds >= 10_000
    assert CONVERSATION_BUDGET.max_wall_seconds >= 86_400
    assert CONVERSATION_BUDGET.max_tokens == 200_000
    assert CONVERSATION_BUDGET.context_token_budget is True
    assert CONVERSATION_BUDGET.compact_at_tokens == 120_000
    # 旧存档仍按当时那一档还原。
    assert CONVERSATION_BUDGET_V2.max_rounds == 8
    assert CONVERSATION_BUDGET_V2.max_tokens == 8_000
    assert CONVERSATION_BUDGET_V2.max_wall_seconds == 240.0


@pytest.mark.parametrize("mode", ["no-adapter", "approval-revoked"])
def test_project_marker_alone_cannot_choose_execution_policy(env, monkeypatch, mode):
    monkeypatch.setattr(control, "CONVERSATION_BUDGET", CONVERSATION_BUDGET_V2)
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)
    if mode == "approval-revoked":
        state = load_session(env.state.sessionId)
        state.controlTranscript = []
        save_session(state)
    adapter = None if mode == "no-adapter" else ProjectTools(env.project, None, env.owner)
    calls = []

    async def model(*a, **kw):
        calls.append(1)
        return llm_tool("project_read", {"path": "src/main.tsx"}, usage={"total_tokens": 8001})

    monkeypatch.setattr(control, "_invoke_control_llm", model)

    async def run():
        return [event async for event in control.run_control_turn(six_fields(env.state.sessionId, "Continue"),
            authorized_owner_id=env.owner, project_tools=adapter)]

    events = asyncio.run(run())
    [stop] = stops(events)
    assert calls == [1]
    assert stop["stopReason"] == "token_budget" and stop["limit"] == 8000


async def parked_checkpoint(env, monkeypatch):
    first = env.service()
    calls = []
    original = RunCheckpoint.save

    async def model(*a, **kw):
        calls.append(1)
        return llm_tool("project_read", {"path": "src/main.tsx"}, usage={"total_tokens": 3015})

    async def save(port, checkpoint):
        await original(port, checkpoint)
        if port.service is first and checkpoint.get("phase") == "model" and checkpoint.get("round") == 1:
            first._stopping = True
            raise ControlRunStopped("control_worker_shutdown")

    monkeypatch.setattr(control, "_invoke_control_llm", model)
    monkeypatch.setattr(RunCheckpoint, "save", save)
    await first.start()
    record = await first.submit(six_fields(env.state.sessionId, "Continue approved work"), env.owner, "pin-budget")
    try:
        for _ in range(1000):
            if first._stopping and not first._tasks:
                break
            await asyncio.sleep(0.005)
        else:
            raise AssertionError("producer never reached its persisted recovery checkpoint")
    finally:
        await first.shutdown()
    owned = env.store.claim(record["runId"], "checkpoint-fixture", 3)
    # ⚠ 2026-09-17：这条在**全量里**偶发红（单跑、甚至 4 核满载连跑 15 次都绿），
    #   红的形态是这里 `owned is None`，而 claim 只有两种情况回 None：
    #   run 已进终态、或租约未过期。光看 `assert owned is not None` 两种都分不出来，
    #   读代码也读不出来（suspend 在 finally 里、_tasks.pop 在它之后，顺序是对的），
    #   而全量跑一趟要 11 分钟——所以先把现场留下来，别让下一次红又只剩一个 None。
    #   同一天鉴权守卫那条也是这个毛病：没有日志，查一次要穿三层。
    if owned is None:
        state = env.store.get(record["runId"], env.owner)
        raise AssertionError(
            "claim 回了 None。run 状态="
            + f"{state.get('status')!r} leaseOwner={state.get('leaseOwner')!r} "
            + f"leaseExpiresAt-now={state.get('leaseExpiresAt', 0) - time.time():.2f}s "
            + f"error={state.get('error')!r} checkpoint={'有' if state.get('checkpoint') else '无'}"
        )
    assert owned["checkpoint"]["budgetPolicy"] == control.PROJECT_BUDGET.to_wire()
    assert owned["checkpoint"]["cheapTokens"] == 3015
    return owned, calls


@pytest.mark.parametrize("exhausted", ["tokens", "rounds", "wall"])
def test_recovery_keeps_spent_project_budget_and_stops_before_sampling(env, monkeypatch, exhausted):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        cp = owned["checkpoint"]
        if exhausted == "tokens":
            # v2 不认 cheapTokens 累加。塞一条压不掉的超长 user，占用仍超窗。
            pad = "U" * (PROJECT_POLICY["maxTokens"] * 4 + 16_000)
            cp["messages"] = [
                {"role": "system", "content": "p"},
                {"role": "user", "content": pad},
            ]
        elif exhausted == "rounds":
            cp["round"] = PROJECT_POLICY["maxRounds"]
        else:
            cp["startedAt"] = time.time() - PROJECT_POLICY["maxWallSeconds"] - 10
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], cp)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await observed(second, owned["runId"], lambda saved: bool(stops(saved["events"])))
            [stop] = stops(final["events"])
            assert stop["stopReason"] == {"tokens": "token_budget", "rounds": "tool_rounds", "wall": "wall_clock"}[exhausted]
            assert stop["limit"] == PROJECT_POLICY[{"tokens": "maxTokens", "rounds": "maxRounds", "wall": "maxWallSeconds"}[exhausted]]
            # 同回合 resume 不许先再采样再停。wall_clock 之后的自动续跑是新一轮，
            # 可以再采样，所以只数发出 stop 之前的 calls。
            assert calls == [1], "recovery sampled again despite exhausted persisted budget"
            if exhausted != "wall":
                final = await settled(second, owned["runId"])
                assert calls == [1]
        finally:
            await second.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize("alteration", ["missing", "escalated", "unknown", "malformed"])
def test_recovery_cannot_upgrade_absent_or_invalid_policy(env, monkeypatch, alteration):
    create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        cp = owned["checkpoint"]
        if alteration == "missing":
            cp.pop("budgetPolicy")
            # 缺政策还原成当时的对话档。线上默认已是窗口口径，cheapTokens
            # 8001 撞不上；塞一条压不掉的超长 user，占用仍超窗。
            pad = "U" * (CONVERSATION_BUDGET.max_tokens * 4 + 16_000)
            cp["messages"] = [
                {"role": "system", "content": "p"},
                {"role": "user", "content": pad},
            ]
        elif alteration == "escalated":
            cp["budgetPolicy"]["maxTokens"] = 999999999
        elif alteration == "unknown":
            cp["budgetPolicy"]["profile"] = "client-unlimited"
        else:
            cp["budgetPolicy"] = "project-v1"
        env.store.save_checkpoint(owned["runId"], "checkpoint-fixture", owned["generation"], cp)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert calls == [1]
            if alteration == "missing":
                [stop] = stops(final["events"])
                assert stop["stopReason"] == "token_budget" and stop["limit"] == CONVERSATION_BUDGET.max_tokens
            else:
                assert final["status"] == "interrupted"
                assert final["error"] == "control_reconciliation_required"
        finally:
            await second.shutdown()

    asyncio.run(run())


def test_resumed_sample_adds_to_previous_tokens_before_any_patch(env, monkeypatch):
    monkeypatch.setattr(control, "PROJECT_BUDGET", PROJECT_BUDGET_V1)
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref)

    async def run():
        owned, calls = await parked_checkpoint(env, monkeypatch)
        # The next response alone fits; combining it with the already incurred
        # 3015 tokens must stop before its real project_patch can be dispatched.
        async def model(*a, **kw):
            calls.append(1)
            return llm_tool("project_patch", {"approvalRef": env.ref,
                "expectedRevision": project.currentRevision, "changes": [{"path": "over-budget.txt",
                    "content": "must not be saved", "expectedSha256": None}]},
                usage={"total_tokens": V1_POLICY["maxTokens"] - 3015 + 1})

        monkeypatch.setattr(control, "_invoke_control_llm", model)
        env.store.suspend(owned["runId"], "checkpoint-fixture", owned["generation"])
        second = env.service()
        await second.start()
        try:
            final = await settled(second, owned["runId"])
            assert calls == [1, 1]
            [stop] = stops(final["events"])
            assert stop["stopReason"] == "token_budget"
            assert stop["used"] == V1_POLICY["maxTokens"] + 1
            assert "over-budget.txt" not in env.project.read_files(project.projectId, owner_id=env.owner)
            assert not any(event.get("tool") == "project_patch" for event in final["events"])
        finally:
            await second.shutdown()

    asyncio.run(run())


def test_v2_cumulative_spend_does_not_block_a_patch(setup, monkeypatch):
    """反向：v1 的 64001 花费闸不许原样搬到 v2。变异：context_token_budget=False → 本条红。"""
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    harness = ControlHarness(monkeypatch)

    def model(messages, **kwargs):
        if any(row.get("role") == "tool" for row in messages):
            return llm_text("源码已保存。")
        return llm_tool("project_patch", {"approvalRef": setup.ref,
            "expectedRevision": project.currentRevision, "changes": [{"path": "spent-ok.txt", "content": "ok\n",
                "expectedSha256": None}]},
            usage={"total_tokens": 64_001})

    harness.llm_impl = model
    events = post(setup.state)
    assert "spent-ok.txt" in setup.store.read_files(project.projectId, owner_id=TEST_USER_ID)
    assert any(event.get("tool") == "project_patch" and event.get("ok") for event in events)
    assert not any(event.get("stopReason") == "token_budget" for event in events)


def test_接近窗口就压缩再采样(setup, monkeypatch):
    """活路径：进 `_control_llm_loop` 的 messages 已经超阈值，采样前必须压过。

    变异：把 `_compact_context_if_needed` 那次调用删掉 → 第一条采样没有
    【会话压缩】，本条红。
    """
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    tiny = control.ControlBudget(
        "project-v2", 16, 200_000, 900.0, 600.0,
        compact_at_tokens=3_000,
        context_token_budget=True,
    )
    monkeypatch.setattr(control, "PROJECT_BUDGET", tiny)
    original = control._control_llm_loop

    async def wrapped(state, messages, **kwargs):
        payload = "源码" * 3_000
        for index in range(5):
            call_id = f"pre-{index}"
            messages.append({
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": "project_search", "arguments": "{}"},
                }],
            })
            messages.append({"role": "tool", "tool_call_id": call_id, "content": payload})
        async for event in original(state, messages, **kwargs):
            yield event

    monkeypatch.setattr(control, "_control_llm_loop", wrapped)
    seen = []
    harness = ControlHarness(monkeypatch)

    def model(messages, **kwargs):
        seen.append(copy.deepcopy(messages))
        return llm_text("压缩之后继续。")

    harness.llm_impl = model
    events = post(setup.state)
    assert seen, "模型根本没被问到"
    assert COMPACT_NOTICE_PREFIX in json.dumps(seen[0], ensure_ascii=False)
    assert any(event.get("compacted") for event in events)
    assert not any(event.get("stopReason") == "token_budget" for event in events)
