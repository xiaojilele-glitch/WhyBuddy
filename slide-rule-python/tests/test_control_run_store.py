"""Real SQL/HTTP-adapter CAS tests for control producer and subscriber state."""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from sqlalchemy import text

from services import control_run_store as module
from services.control_run_store import (
    ControlRunConflict, ControlRunNotFound, ControlRunStore, ControlRunUnavailable,
    payload_objective_text,
)
from services.project_store import ProjectStore
from services.sql_gateway import HttpSqlGateway


@pytest.fixture(params=["sql", "http"])
def store(request, tmp_path):
    base = ProjectStore.from_url(f"sqlite:///{tmp_path / 'control.db'}")
    if request.param == "sql":
        yield ControlRunStore(base._q)
    else:
        def respond(req):
            body = json.loads(req.content)
            parts = body["sql"].split("%s")
            sql = "".join(part + (f":p{i}" if i < len(parts) - 1 else "") for i, part in enumerate(parts))
            with base._engine.begin() as conn:
                result = conn.execute(text(sql), {f"p{i}": value for i, value in enumerate(body["params"])})
                rows = [dict(row) for row in result.mappings()] if result.returns_rows else []
            return httpx.Response(200, json={"rows": rows, "truncated": False})

        gateway = HttpSqlGateway("https://control-db.test", "test-only-key")
        gateway._client.close()
        gateway._client = httpx.Client(transport=httpx.MockTransport(respond))
        yield ControlRunStore(gateway.query)
        gateway._client.close()
    base.close()


def submit(store, *, key="request-1", session="session-1", payload=None):
    return store.submit(session, "alice", key, payload or {"message": "Create an app"})


def claim(store, *, worker="worker-1", lease=30):
    run = submit(store)
    return store.claim(run["runId"], worker, lease)


def test_leased_submit_is_not_claimable_by_another_worker(store):
    """⚠ 2026-09-22 RFZYDAVHG9：queued 窗口里另一个 worker 把 run 领走。

    带 claim_worker 插入后，list_runnable 不许再看见它。
    """
    record = store.submit(
        "session-leased", "alice", "idem-leased", {"message": "做PPT"},
        claim_worker="local-worker", claim_seconds=60,
    )
    assert record["status"] == "running"
    assert record["leaseOwner"] == "local-worker"
    assert record["generation"] == 1
    runnable = [item["runId"] for item in store.list_runnable()]
    assert record["runId"] not in runnable


def test_submission_is_idempotent_and_data_is_detached(store):
    request = {"message": "Hello", "nested": {"value": 1}}
    first = submit(store, payload=request)
    request["nested"]["value"] = 2
    repeated = submit(store, payload={"nested": {"value": 1}, "message": "Hello"})
    assert repeated["runId"] == first["runId"] and repeated["payload"]["nested"]["value"] == 1
    assert first["status"] == "queued" and first["generation"] == 0 and first["lastSeq"] == 0
    assert first["events"] == [] and first["checkpoint"] is None
    with pytest.raises(ControlRunConflict, match="idempotency"):
        submit(store, payload={"message": "Changed"})
    assert store.latest("session-1", "alice")["runId"] == first["runId"]
    assert store.latest("unknown", "alice") is None


def test_反向_不盖sessionGoal时合成句才会落到目标上():
    """先证明旧行为：只喂 userText 时「批准计划并执行」确实会赢。

    没有这条，后面那条「盖了就不赢」可能是断言打空。
    """
    assert payload_objective_text({"userText": "批准计划并执行"}) == "批准计划并执行"
    assert payload_objective_text({
        "userText": "批准计划并执行",
        "sessionGoal": "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
    }) == "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理"


def test_submit_live_path_stamps_and_promotes():
    """闸全绿但东西没了：直接调纯函数绿，接在 submit / _produce 上才算数。"""
    import pathlib
    service = (pathlib.Path(__file__).resolve().parents[1] / "services" / "control_run_service.py").read_text(encoding="utf-8")
    submit = service[service.index("async def submit"): service.index("async def cancel")]
    assert "stamp_control_goal_payload" in submit
    produce = service[service.index("async def _produce"):]
    assert "project_goal_promotion" in produce
    assert 'kind="project"' in produce or "kind='project'" in produce
    assert "unfinished_slice_waits_for_user" in produce
    assert "unfinished_cap_waits_for_user" in produce
    assert "sampling_interrupted_checkpoint" in produce
    store_src = (pathlib.Path(__file__).resolve().parents[1] / "services" / "control_run_store.py").read_text(encoding="utf-8")
    cancel_fn = store_src[store_src.index("def cancel("): store_src.index("def cancel_request")]
    assert "wb_control_cancel_request" in cancel_fn
    guard = service[service.index("def guard"): service.index("async def save")]
    assert "inspect_fence" in guard
    assert "store.get(" not in guard
    heartbeat = service[service.index("async def _heartbeat"): service.index("async def _produce")]
    assert "except ControlRunConflict" in heartbeat
    blip = heartbeat[heartbeat.rindex("except Exception"):]
    assert "control_lease_lost" not in blip


def test_goal_envelope_is_durable_compact_and_owner_bound(store):
    run = submit(store, payload={"userText": "  Build a task app  ", "runtimeKind": "project",
                                  "secret": "must-not-leak"})
    goal = store.goal(run["runId"], "alice")
    assert goal["text"] == "Build a task app" and goal["kind"] == "project"
    assert goal["status"] == "active" and goal["awaitingOperationIds"] == []
    assert "secret" not in json.dumps(goal)
    with pytest.raises(ControlRunNotFound):
        store.goal(run["runId"], "bob")


def test_真机_批准计划不能盖过业务目标(store):
    """2026-09-14 `sr-20260914150256-Z3DP93VKQ9` 的原样载荷。

    用户点批准时 HTTP userText 是「批准计划并执行」，会话 goal 是入职系统。
    旧 `_goal_from_payload` 只认 userText，durable 目标就变成了按钮文案。
    """
    from types import SimpleNamespace
    from services.control_run_store import stamp_control_goal_payload

    live_text = "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理"
    state = SimpleNamespace(goal={"text": live_text}, runtimeKind="html-prototype")
    stamped = stamp_control_goal_payload(
        {"userText": "批准计划并执行", "sessionId": "sr-20260914150256-Z3DP93VKQ9"},
        state,
    )
    run = submit(store, payload=stamped)
    goal = store.goal(run["runId"], "alice")
    assert goal["text"] == live_text
    assert "批准计划" not in goal["text"]
    assert goal["kind"] == "conversation"


def test_工程创建后可以升级目标身份而不擦续跑账(store):
    run = claim(store)
    store.update_goal(run["runId"], "worker-1", 1, status="active")
    # 先记一笔续跑账，再升级 kind——升级不许把账抹掉。
    waiting = store.wait_for_continue(run["runId"], "worker-1", 1, progress_mark="tools:2")
    assert waiting["goal"]["progressMark"] == "tools:2"
    queued = store.requeue_continue(run["runId"], progress_mark="tools:2")
    claimed = store.claim(queued["runId"], "worker-1", 30)
    promoted = store.update_goal(
        claimed["runId"], "worker-1", claimed["generation"],
        status="active", kind="project",
        text="设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
    )
    assert promoted["goal"]["kind"] == "project"
    assert promoted["goal"]["continuations"] == 1
    assert promoted["goal"]["progressMark"] == "tools:2"
    assert "入职" in promoted["goal"]["text"]


def test_goal_update_is_fenced_and_survives_reopen(store):
    run = claim(store)
    updated = store.update_goal(run["runId"], "worker-1", 1,
        status="waiting_operation", operation_ids=["op-1", "op-1"])
    assert updated["goal"]["status"] == "waiting_operation"
    assert updated["goal"]["awaitingOperationIds"] == ["op-1"]
    with pytest.raises(ControlRunConflict, match="lease_lost"):
        store.update_goal(run["runId"], "other-worker", 1, status="active")
    assert store.goal(run["runId"], "alice")["awaitingOperationIds"] == ["op-1"]


def test_waiting_goal_can_be_requeued_once_without_losing_operation_ids(store):
    run = claim(store)
    store.update_goal(run["runId"], "worker-1", 1, status="waiting_operation", operation_ids=["op-1"])
    waiting = store.wait_for_operations(run["runId"], "worker-1", 1, ["op-1"])
    assert waiting["status"] == "waiting_operation" and waiting["leaseExpiresAt"] == 0
    queued = store.requeue_waiting(run["runId"], operation_ids=["op-1"])
    assert queued["status"] == "queued" and queued["goal"]["status"] == "active"
    assert store.requeue_waiting(run["runId"], operation_ids=["op-1"])["status"] == "queued"


def test_other_owner_cannot_read_submit_latest_or_cancel(store):
    run = submit(store)
    for call in (lambda: store.get(run["runId"], "bob"), lambda: store.latest("session-1", "bob"),
            lambda: store.cancel(run["runId"], "bob"), lambda: store.submit("session-1", "bob", "other", {})):
        with pytest.raises(ControlRunNotFound):
            call()
    assert not store.get(run["runId"], "alice")["cancelRequested"]


def test_one_active_turn_per_session_even_after_lease_expiry(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    first = claim(store, lease=10)
    with pytest.raises(ControlRunConflict, match="control_run_active"):
        submit(store, key="second")
    clock[0] += 11
    with pytest.raises(ControlRunConflict, match="control_run_active"):
        submit(store, key="second")
    assert store.list_runnable()[0]["runId"] == first["runId"]
    second = store.claim(first["runId"], "worker-2", 10)
    assert second["generation"] == 2
    store.finish(second["runId"], "worker-2", 2, "interrupted", error="missing_checkpoint")
    next_run = submit(store, key="second")
    assert next_run["runId"] != first["runId"]


@pytest.mark.parametrize("status", sorted(module.TERMINAL))
def test_terminal_releases_session_but_cannot_be_reclaimed(store, status):
    run = claim(store)
    finished = store.finish(run["runId"], "worker-1", 1, status)
    assert finished["status"] == status and finished["leaseExpiresAt"] == 0
    assert store.claim(run["runId"], "worker-2", 30) is None
    assert store.cancel(run["runId"], "alice") == finished
    assert store.list_runnable() == []
    following = submit(store, key="second")
    assert store.latest("session-1", "alice")["runId"] == following["runId"]
    assert submit(store)["runId"] == run["runId"]
    assert store.get(run["runId"], "alice")["status"] == status


@pytest.mark.parametrize("cancelled", [False, True])
def test_failed_final_state_is_atomic_and_preserves_cancel_precedence(store, cancelled):
    run = claim(store)
    if cancelled:
        store.cancel(run["runId"], "alice")
    event = {"type": "complete", "state": {"runtimeKind": "project", "projectId": "saved-project"}}
    final = store.complete(run["runId"], "worker-1", 1, "failed", event, "llm_unavailable")
    assert final == store.get(run["runId"], "alice")
    assert final["status"] == ("cancelled" if cancelled else "failed")
    assert final["error"] == ("control_cancelled" if cancelled else "llm_unavailable")
    assert final["lastSeq"] == (0 if cancelled else 1)
    if not cancelled:
        assert final["events"][0]["state"] == event["state"]
    assert store.claim(run["runId"], "other-worker", 30) is None
    assert submit(store, key="next-request")["runId"] != run["runId"]


def test_claim_conflict_and_generation_fence_every_producer_write(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    assert store.claim(run["runId"], "worker-1", 10)["generation"] == 1
    assert store.claim(run["runId"], "worker-2", 10) is None
    writes = [lambda: store.heartbeat(run["runId"], "worker-1", 1, 10),
        lambda: store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "ready"}),
        lambda: store.append_event(run["runId"], "worker-1", 1, {"type": "done"}),
        lambda: store.finish(run["runId"], "worker-1", 1, "completed")]
    clock[0] = 1010.0
    for write in writes:
        with pytest.raises(ControlRunConflict, match="lease_lost"):
            write()
    replacement = store.claim(run["runId"], "worker-2", 10)
    assert replacement["generation"] == 2
    for write in writes:
        with pytest.raises(ControlRunConflict, match="lease_lost"):
            write()
    saved = store.get(run["runId"], "alice")
    assert saved["events"] == [] and saved["checkpoint"] is None and saved["status"] == "running"


def test_event_sequence_and_checkpoint_survive_reopen(tmp_path):
    url = f"sqlite:///{tmp_path / 'restart.db'}"
    first = ProjectStore.from_url(url)
    store = ControlRunStore(first._q)
    run = claim(store)
    store.save_checkpoint(run["runId"], "worker-1", 1, {"messages": [{"role": "assistant", "text": "partial"}], "phase": "model"})
    saved = store.append_event(run["runId"], "worker-1", 1, {"type": "text", "seq": 900, "controlRunId": "forged", "text": "hello"})
    assert saved["seq"] == 1 and saved["controlRunId"] == run["runId"]
    first.close()
    second = ProjectStore.from_url(url)
    reopened = ControlRunStore(second._q)
    record = reopened.get(run["runId"], "alice")
    assert record["checkpoint"]["phase"] == "model" and record["events"] == [saved] and record["lastSeq"] == 1
    appended = reopened.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "world"})
    assert appended["seq"] == 2
    second.close()


def test_concurrent_submissions_have_one_winner_and_idempotency_is_shared(store):
    def attempt(key):
        try:
            return submit(store, key=key)["runId"]
        except ControlRunConflict:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        winners = [run for run in pool.map(attempt, [f"key-{i}" for i in range(6)]) if run]
    assert len(winners) == 1
    assert [run["runId"] for run in store.list_runnable()] == winners
    with ThreadPoolExecutor(max_workers=6) as pool:
        shared = list(pool.map(lambda _: submit(store, session="other-session")["runId"], range(6)))
    assert len(set(shared)) == 1


def test_concurrent_event_append_and_cancel_keep_every_event_and_sticky_cancel(store):
    run = claim(store)
    with ThreadPoolExecutor(max_workers=6) as pool:
        events = list(pool.map(lambda n: store.append_event(run["runId"], "worker-1", 1, {"type": "value", "n": n}), range(12)))
    assert sorted(event["seq"] for event in events) == list(range(1, 13))
    record = store.cancel(run["runId"], "alice")
    assert record["cancelRequested"] and record["status"] == "running" and record["lastSeq"] == 12
    store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "cancel"})
    assert store.get(run["runId"], "alice")["cancelRequested"]


def test_cancel_race_during_checkpoint_cas_does_not_lose_intent(store, monkeypatch):
    run = claim(store)
    original = store._q
    raced = [False]

    def cancel_before_save(sql, params=None):
        if sql.startswith("update wb_control_run set status=") and not raced[0]:
            raced[0] = True
            store.cancel(run["runId"], "alice")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", cancel_before_save)
    record = store.save_checkpoint(run["runId"], "worker-1", 1, {"phase": "tool"})
    assert record["cancelRequested"] and record["checkpoint"] == {"phase": "tool"}


def test_expiry_between_read_and_sql_cas_rejects_the_write(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    original = store._q

    def expire_after_lease_read(sql, params=None):
        result = original(sql, params)
        if isinstance(sql, str) and sql.startswith("select r.* from wb_control_run"):
            clock[0] = 1011
        return result

    monkeypatch.setattr(store, "_q", expire_after_lease_read)
    with pytest.raises(ControlRunConflict, match="lease_lost"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "text"})
    assert store.get(run["runId"], "alice")["lastSeq"] == 0


def test_event_and_total_size_limits_preserve_room_for_terminal_state(store):
    store.max_events = 1
    store.max_run_bytes = 8192
    run = claim(store)
    store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "a" * 100})
    with pytest.raises(ValueError, match="event_count_limit"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "text"})
    with pytest.raises(ValueError, match="size_limit"):
        store.save_checkpoint(run["runId"], "worker-1", 1, {"messages": "x" * 8000})
    assert store.get(run["runId"], "alice")["lastSeq"] == 1
    assert store.finish(run["runId"], "worker-1", 1, "failed", error="bounded log capacity reached")["status"] == "failed"


def test_failed_session_publication_leaves_inert_recoverable_run(store, monkeypatch):
    original = store._q

    def fail_publication(sql, params=None):
        if sql.startswith("update wb_control_session set active_run_id="):
            raise ControlRunUnavailable("injected_database_failure")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", fail_publication)
    with pytest.raises(ControlRunUnavailable):
        submit(store)
    assert store.list_runnable() == [] and store.latest("session-1", "alice") is None
    raw = original("select id from wb_control_run")[0]["id"]
    with pytest.raises(ControlRunNotFound):
        store.get(raw, "alice")
    monkeypatch.setattr(store, "_q", original)
    assert submit(store)["runId"] == raw
    assert store.list_runnable()[0]["runId"] == raw


def test_crash_after_session_cas_is_observable_and_idempotent(store, monkeypatch):
    original = store._q

    def fail_ack(sql, params=None):
        if sql.startswith("update wb_control_run set accepted=1"):
            raise ControlRunUnavailable("injected_after_session_publication")
        return original(sql, params)

    monkeypatch.setattr(store, "_q", fail_ack)
    with pytest.raises(ControlRunUnavailable):
        submit(store)
    observed = store.latest("session-1", "alice")
    assert observed["status"] == "queued"
    assert submit(store)["runId"] == observed["runId"]
    monkeypatch.setattr(store, "_q", original)
    claimed = store.claim(observed["runId"], "worker", 30)
    store.finish(claimed["runId"], "worker", 1, "completed")
    submit(store, key="next")
    assert store.get(observed["runId"], "alice")["status"] == "completed"


def test_query_failure_message_does_not_expose_database_credentials():
    def unavailable(sql, params):
        raise RuntimeError("postgres://user:secret@database.invalid")

    with pytest.raises(ControlRunUnavailable) as failure:
        ControlRunStore(unavailable)
    assert str(failure.value) == "control_run_store_unavailable"


@pytest.mark.parametrize("owner", [None, "", "   "])
def test_empty_owner_never_turns_public_reads_or_cancel_into_trusted_access(store, owner):
    run = submit(store)
    for call in (lambda: store.get(run["runId"], owner), lambda: store.latest("session-1", owner),
            lambda: store.cancel(run["runId"], owner)):
        with pytest.raises(ValueError, match="owner_required"):
            call()


def test_expired_claim_preserves_checkpoint_and_events_for_recovery(store, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    run = claim(store, lease=10)
    checkpoint = {"phase": "tool_result", "toolCallId": "call-1", "messages": [{"role": "tool", "content": "done"}]}
    store.save_checkpoint(run["runId"], "worker-1", 1, checkpoint)
    event = store.append_event(run["runId"], "worker-1", 1, {"type": "tool_result", "text": "done"})
    clock[0] = 1011
    runnable = store.list_runnable()[0]
    assert runnable["checkpoint"] == checkpoint and runnable["events"] == [event]
    recovered = store.claim(run["runId"], "worker-2", 30)
    assert recovered["checkpoint"] == checkpoint and recovered["lastSeq"] == 1
    assert recovered["generation"] == 2 and recovered["leaseOwner"] == "worker-2"


def test_cancel_cas_does_not_overwrite_concurrent_events(store, monkeypatch):
    run = claim(store)
    original = store._q
    raced = [False]

    def append_before_cancel(sql, params=None):
        if sql.startswith("update wb_control_run set rev=rev+1,payload=") and not raced[0]:
            raced[0] = True
            store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "concurrent"})
        return original(sql, params)

    monkeypatch.setattr(store, "_q", append_before_cancel)
    cancelled = store.cancel(run["runId"], "alice")
    assert cancelled["lastSeq"] == 1 and cancelled["events"][0]["text"] == "concurrent"
    assert cancelled["cancelRequested"]


@pytest.mark.parametrize("lease", [True, 0, -1, 3601, float("nan"), "30"])
def test_invalid_leases_cannot_claim(store, lease):
    run = submit(store)
    with pytest.raises(ValueError, match="lease_seconds"):
        store.claim(run["runId"], "worker", lease)
    assert store.get(run["runId"], "alice")["generation"] == 0


@pytest.mark.parametrize("event_type,field", [("spec_page", "html"), ("skill_result", "modelSection"), ("factory_complete", "state")])
def test_artifact_events_keep_real_payloads_larger_than_a_log_chunk(store, event_type, field):
    run = claim(store)
    event = {"type": event_type, field: {"content": "x" * 90000}}
    saved = store.append_event(run["runId"], "worker-1", 1, event)
    assert saved[field] == event[field]
    with pytest.raises(ValueError, match="control_run_size_limit"):
        store.append_event(run["runId"], "worker-1", 1, {"type": "log", "text": "x" * 90000})


def test_completion_publishes_state_and_releases_the_slot_together(store):
    run = claim(store)
    final = store.complete(run["runId"], "worker-1", 1, "completed", {"type": "complete", "state": {"sessionId": "session-1"}})
    assert final["status"] == "completed" and final["events"][-1]["type"] == "complete"
    assert submit(store, key="next")["runId"] != run["runId"]


def test_cancel_wins_over_late_completion_publication(store):
    run = claim(store)
    store.cancel(run["runId"], "alice")
    final = store.complete(run["runId"], "worker-1", 1, "completed", {"type": "complete", "state": {}})
    assert final["status"] == "cancelled" and not final["events"]


@pytest.mark.parametrize("submitted", [True, False])
def test_request_stop_survives_arriving_before_run_publication(store, submitted):
    if submitted:
        submit(store)
    store.cancel_request("session-1", "alice", "request-1")
    run = submit(store)
    assert store.get(run["runId"], "alice")["cancelRequested"]
    claimed = store.claim(run["runId"], "worker", 30)
    assert claimed["cancelRequested"]


def test_heartbeat_and_append_do_not_rewrite_the_run_blob(store, monkeypatch):
    """2026-09-19 真机：每条事件/心跳整行改写 800KB payload。

    正向：事件走 INSERT，心跳 UPDATE 只碰 lease_expires_at。
    反向：这两条 SQL 里不许再出现 payload=。
    """
    seen: list[str] = []
    original = store._q

    def spy(sql, params=None):
        if isinstance(sql, str):
            seen.append(sql)
        return original(sql, params)

    monkeypatch.setattr(store, "_q", spy)
    run = claim(store)
    store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "hello"})
    store.heartbeat(run["runId"], "worker-1", 1, 10)
    inserts = [sql for sql in seen if "insert into wb_control_event" in sql]
    assert inserts, "事件必须追加进 wb_control_event"
    heartbeats = [sql for sql in seen if sql.startswith("update wb_control_run set lease_expires_at=")]
    assert heartbeats, "心跳必须只续租约列"
    for sql in heartbeats:
        assert "payload" not in sql
    for sql in inserts:
        assert "payload" not in sql


def test_inspect_fence_does_not_load_payload(store, monkeypatch):
    seen: list[str] = []
    original = store._q

    def spy(sql, params=None):
        if isinstance(sql, str):
            seen.append(sql)
        return original(sql, params)

    monkeypatch.setattr(store, "_q", spy)
    run = claim(store)
    fence = store.inspect_fence(run["runId"], "alice")
    assert fence["generation"] == 1 and fence["leaseOwner"] == "worker-1"
    assert not fence["cancelRequested"]
    store.cancel(run["runId"], "alice")
    assert store.inspect_fence(run["runId"], "alice")["cancelRequested"]
    selects = [sql for sql in seen if sql.startswith("select r.id, r.session_id")]
    assert selects, "fence 必须走租约列 SELECT"
    for sql in selects:
        assert "payload" not in sql


def test_legacy_payload_events_hydrate_and_spill_on_append(store):
    """旧行事件还在 payload 里。读得见；下一次追加再搬进表，不许丢。"""
    run = claim(store)
    row = store._row(run["runId"])
    record = json.loads(row["payload"])
    record["events"] = [{
        "type": "text", "seq": 1, "controlRunId": run["runId"], "text": "legacy",
    }]
    record["lastSeq"] = 1
    store._q(
        "update wb_control_run set payload=$1 where id=$2",
        [json.dumps(record, ensure_ascii=False, separators=(",", ":")), run["runId"]],
    )
    assert store.get(run["runId"], "alice")["events"][0]["text"] == "legacy"
    added = store.append_event(run["runId"], "worker-1", 1, {"type": "text", "text": "next"})
    assert added["seq"] == 2
    texts = [event["text"] for event in store.get(run["runId"], "alice")["events"]]
    assert texts == ["legacy", "next"]
    # 反向：表是权威。漏了 spill 的话表里只有 next，旧那条会丢。
    table = store._load_events(run["runId"])
    assert [event["text"] for event in table] == ["legacy", "next"]


def test_heartbeat_is_not_a_payload_cas():
    """闸全绿但东西没了：heartbeat 若又走回 _producer_update，上面那条 SQL 间谍也会绿。"""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "services" / "control_run_store.py").read_text(encoding="utf-8")
    start = src.index("def heartbeat")
    body = src[start:src.index("def save_checkpoint")]
    assert "_producer_update" not in body
    assert "set lease_expires_at=" in body
    assert "payload=$" not in body
