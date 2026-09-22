"""A lease heartbeat cannot turn a valid model edit into an admission failure.

Inject at the actual INSERT used by ProjectTools -> supervisor -> durable store,
then require that the original runtime worker applies exactly one source edit.
Fresh authorization and unknown SQL responses have separate retry contracts.
"""
import threading

from project_actor_support import project_actor
from services.project_store import ProjectStoreUnavailable
from test_project_live_source_sync import live, patch_args, child_done
from test_project_runtime_worker import eventually


def admission_sql(sql):
    return sql.startswith("insert into wb_project_operation") and " select " in sql


def renew(live):
    lease = live.store.get_lease(live.project["projectId"], owner_id="alice")
    live.store.renew_lease(lease.projectId, owner_id="alice", generation=lease.generation,
        lease_owner=lease.leaseOwner)


def test_actual_heartbeat_cas_retries_then_same_runtime_applies_one_patch(live, monkeypatch):
    original, real, inserts = live.parent(), live.store._q, []
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            if len(inserts) == 1:
                renew(live)
        return real(sql, params)
    monkeypatch.setattr(live.store, "_q", racing)
    submitted = live.tools.execute("project_patch", patch_args(live), live.state)
    assert submitted["ok"], submitted
    done = eventually(lambda: child_done(live, submitted))
    assert 2 <= len(inserts) <= 3 and done.status == "completed" and done.result["synchronized"]
    assert len(live.store.list_runtime_patches(original.operationId, owner_id="alice", include_terminal=True)) == 1
    assert live.provider.contents["src/App.tsx"] == "Updated task\n" and len(live.provider.syncs) == 1
    assert live.parent().runtime.processId == original.runtime.processId
    assert live.parent().runtime.status == "ready" and live.provider.created == 1


def test_second_attempt_reloads_real_plan_authority_and_refuses_revoked_approval(live, monkeypatch):
    real, inserts, authorizations = live.store._q, [], []
    authorizer, caller = live.supervisor.authorizer, threading.get_ident()
    def authorize(store, operation, owner):
        if threading.get_ident() == caller:
            authorizations.append(operation.expectedRevision)
        return authorizer(store, operation, owner)
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            if len(inserts) == 1:
                renew(live)
                row = live.sessions.load(live.state.sessionId)
                live.sessions.save(live.state.sessionId,
                    {**row.payload, "controlTranscript": row.payload["controlTranscript"][:-1]}, expected_rev=row.rev)
        return real(sql, params)
    monkeypatch.setattr(live.supervisor, "authorizer", authorize)
    monkeypatch.setattr(live.store, "_q", racing)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert not result["ok"] and "approval" in result["error"]
    assert len(authorizations) == 2 and len(inserts) == 1
    assert not live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)
    assert not live.provider.syncs


def test_unknown_insert_reply_is_returned_without_repeating_an_already_saved_admission(live, monkeypatch):
    real, inserts = live.store._q, []
    def lost_reply(sql, params=None):
        result = real(sql, params)
        if admission_sql(sql) and real("select id from wb_project_operation where id=$1", [params[0]]):
            inserts.append(True)
            raise ProjectStoreUnavailable("unknown_patch_admission_reply")
        return result
    monkeypatch.setattr(live.store, "_q", lost_reply)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert result == {"ok": False, "error": "unknown_patch_admission_reply"}
    assert len(inserts) == 1
    children = live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)
    assert len(children) == 1
    done = eventually(lambda: child_done(live, {"operationId": children[0].operationId}))
    assert done.status == "completed" and len(live.provider.syncs) == 1


def test_repeated_confirmed_heartbeat_conflicts_stop_after_three_admissions(live, monkeypatch):
    real, inserts = live.store._q, []
    def racing(sql, params=None):
        if admission_sql(sql):
            inserts.append(True)
            renew(live)
        return real(sql, params)
    monkeypatch.setattr(live.store, "_q", racing)
    result = live.tools.execute("project_patch", patch_args(live), live.state)
    assert result == {"ok": False, "error": "project_runtime_patch_changed"}
    assert len(inserts) == 3 and not live.provider.syncs
    assert not live.store.list_runtime_patches(live.started["operationId"], owner_id="alice", include_terminal=True)
