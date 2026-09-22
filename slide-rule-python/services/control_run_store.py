"""Durable control runs, session exclusion, and fenced producer updates.

The HTTPS SQL adapter cannot keep a transaction open across requests. A run is
prepared before a session CAS publishes it; only the published active run can
be claimed. A crash in that gap leaves an inert row that the same idempotency
key can recover. Lease expiry never frees the session for another user turn.

⚠ 2026-09-19 真机 `ctr-372375fbce1f5fe592ce99f8be7192de`：258 条事件 + 145
  条消息揉在同一份 payload 里，每记一条事件、每续一次租约都整行改写
  ~800KB。`owned_model_sample` 每 0.25s `store.get()` 拉整坨，Neon 8s
  statement_timeout 一抖，`guard` 把所有异常打成
  `control_checkpoint_unavailable`，黄条「控制面未返回结果」。

  抄 grok-build：对话是追加日志（`updates.jsonl`），心跳不是重写整份会话。
  这边不能改成本地文件（多实例 / 会话互斥还在），但形状对齐——
  事件进 `wb_control_event` 只 INSERT，心跳只碰 `lease_expires_at` 列，
  sampling 期间的 fence 只 SELECT 租约列。旧行的事件还在 payload 里，
  读的时候拼起来，下一次 producer 写入再spill 进表。
"""

from __future__ import annotations

import hashlib
import json
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

TERMINAL = frozenset({"completed", "waiting_user", "failed", "cancelled", "interrupted"})
#: 非终态的「停在这儿等一个外部条件」。**必须与 TERMINAL 互斥**：进了
#: TERMINAL 就没人叫得醒了，而这两种都要被 scanner 叫回来。
#:   waiting_operation —— 等一个异步工程 operation 落定
#:   waiting_continue  —— 模型这一轮说完了，但目标还没达到可交付状态
#:                        （2026-09-13，见 control_goal_continuation 模块头）
WAITING = frozenset({"waiting_operation", "waiting_continue"})
MAX_RUN_BYTES = 8 * 1024 * 1024
MAX_PAYLOAD_BYTES = 128 * 1024
MAX_EVENT_BYTES = 64 * 1024
MAX_STATE_EVENT_BYTES = 2 * 1024 * 1024
MAX_EVENTS = 2000
_RESERVED_BYTES = 4096
GOAL_STATUSES = frozenset({"active", "waiting_user", "waiting_operation", "waiting_continue", "completed", "failed", "cancelled"})
_DDL = (
    "create table if not exists wb_control_cancel_request (session_id varchar(240) not null, owner_id varchar(240) not null, idempotency_key varchar(240) not null, primary key(session_id,idempotency_key))",
    "create table if not exists wb_control_session (session_id varchar(240) primary key, owner_id varchar(240) not null, active_run_id varchar(80), rev integer not null)",
    "create table if not exists wb_control_run (id varchar(80) primary key, session_id varchar(240) not null, owner_id varchar(240) not null, idempotency_key varchar(240) not null, status varchar(24) not null, accepted integer not null, rev integer not null, generation integer not null, lease_owner varchar(240), lease_expires_at double precision not null, payload text not null, unique(session_id,idempotency_key))",
    "create index if not exists wb_control_run_session on wb_control_run(session_id)",
    # 抄 grok updates.jsonl：事件只追加。create table if not exists 对已有库
    # 加得上这张新表；旧 run 行不用迁，hydrate 时 payload.events 仍可读。
    "create table if not exists wb_control_event (run_id varchar(80) not null, seq integer not null, body text not null, primary key(run_id, seq))",
)

_TERMINAL_SQL = "('completed','waiting_user','failed','cancelled','interrupted')"
_RUN_SESSION_FENCE = (
    "exists(select 1 from wb_control_session s where s.active_run_id=r.id "
    "and s.session_id=r.session_id)"
)


class ControlRunUnavailable(RuntimeError):
    pass


class ControlRunConflict(RuntimeError):
    pass


class ControlRunNotFound(LookupError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise ValueError(name)
    return value


def _json(value: Any, limit: int) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > limit:
        raise ValueError("control_run_size_limit")
    return encoded


def _seconds(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 1 <= value <= 3600:
        raise ValueError("invalid_control_lease_seconds")
    return float(value)


#: 前端审批 / 退出计划的合成句。它们是派发意图，不是业务目标。
#: 真机 `sr-20260914150256-Z3DP93VKQ9`：userText「批准计划并执行」盖过了入职系统。
SYNTHETIC_OBJECTIVE_TEXTS = frozenset({
    "批准计划并执行",
    "退出计划",
    "请修改计划",
})


def session_goal_text(state: Any) -> str:
    goal = getattr(state, "goal", None)
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    if goal is None:
        return ""
    return str(getattr(goal, "text", "") or "").strip()


def stamp_control_goal_payload(payload: dict[str, Any], state: Any) -> dict[str, Any]:
    """把会话权威目标盖进即将落库的控制 payload。

    六字段 POST 没有 `runtimeKind` / `sessionGoal`。不盖的话
    `_goal_from_payload` 只能看见按钮文案。
    """
    if not isinstance(payload, dict):
        raise ValueError("control_payload_required")
    stamped = dict(payload)
    text = session_goal_text(state)
    if text:
        stamped["sessionGoal"] = text[:4000]
    runtime = getattr(state, "runtimeKind", None)
    if runtime in {"project", "html-prototype"}:
        stamped["runtimeKind"] = runtime
    return stamped


def payload_objective_text(payload: dict[str, Any]) -> str:
    """durable goal.text：会话业务目标优先，合成审批句不许赢。"""
    session_goal = payload.get("sessionGoal")
    if isinstance(session_goal, str) and session_goal.strip():
        return session_goal.strip()[:4000]
    spoken: list[str] = []
    for key in ("userText", "user_text", "message", "goal"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            spoken.append(value.strip())
    for value in spoken:
        if value not in SYNTHETIC_OBJECTIVE_TEXTS:
            return value[:4000]
    return spoken[0][:4000] if spoken else ""


def payload_objective_kind(payload: dict[str, Any]) -> str:
    if payload.get("runtimeKind") == "project":
        return "project"
    return "conversation"


def project_goal_promotion(event: Any) -> bool:
    """这一发事件是否证明工程已经存在，该把 goal.kind 升成 project。"""
    if not isinstance(event, dict):
        return False
    if event.get("type") == "control_project_state" and event.get("runtimeKind") == "project":
        return True
    return (
        event.get("type") == "control_tool_result"
        and event.get("tool") == "project_create"
        and event.get("ok") is True
    )


def _goal_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Build the durable, non-secret objective envelope for a control run.

    The control checkpoint already preserves model messages, but those are an
    implementation detail and are not suitable for discovery or a UI resume
    affordance.  Keep only the user objective and the operation ids which may
    still need observation.  This is deliberately a data contract; it does
    not start another agent loop.

    ⚠ 2026-09-14：userText 是本轮派发句（「批准计划并执行」），不是业务目标。
    业务目标由 stamp_control_goal_payload 盖进 sessionGoal；合成句不许赢。
    """
    text = payload_objective_text(payload)
    kind = payload_objective_kind(payload)
    return {"text": text, "kind": kind, "status": "active",
            "awaitingOperationIds": [], "continuations": 0, "progressMark": "",
            "updatedAt": _now()}


class ControlRunStore:
    def __init__(self, query: Callable[[str, list[Any]], list[dict[str, Any]]], *,
                 max_run_bytes: int = MAX_RUN_BYTES, max_events: int = MAX_EVENTS):
        if type(max_run_bytes) is not int or not 8192 <= max_run_bytes <= MAX_RUN_BYTES:
            raise ValueError("invalid_control_run_limit")
        if type(max_events) is not int or not 1 <= max_events <= MAX_EVENTS:
            raise ValueError("invalid_control_event_limit")
        self._query = query
        self.max_run_bytes, self.max_events = max_run_bytes, max_events
        for statement in _DDL:
            self._q(statement)

    def _q(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        try:
            return self._query(sql, params or [])
        except Exception as exc:
            raise ControlRunUnavailable("control_run_store_unavailable") from exc

    def _row(self, run_id: str, owner_id: str | None = None) -> dict[str, Any]:
        sql = "select r.* from wb_control_run r where r.id=$1 and (r.accepted=1 or exists(select 1 from wb_control_session s where s.session_id=r.session_id and s.active_run_id=r.id))"
        params = [run_id]
        if owner_id is not None:
            sql += " and r.owner_id=$2"
            params.append(owner_id)
        rows = self._q(sql, params)
        if not rows:
            raise ControlRunNotFound("control_run_not_found")
        return rows[0]

    def _load_events(self, run_id: str) -> list[dict[str, Any]]:
        rows = self._q(
            "select body from wb_control_event where run_id=$1 order by seq", [run_id])
        events = []
        for row in rows:
            item = json.loads(row["body"])
            if isinstance(item, dict):
                events.append(item)
        return events

    def _spill_payload_events(self, run_id: str, events: Any) -> None:
        """把旧 payload 里的事件搬进追加表。表里已有行就不动——新事件以表为准。"""
        if not isinstance(events, list) or not events:
            return
        if self._q("select 1 as ok from wb_control_event where run_id=$1 limit 1", [run_id]):
            return
        for event in events:
            if not isinstance(event, dict):
                continue
            seq = event.get("seq")
            if type(seq) is not int or seq < 1:
                continue
            body = _json({**event, "controlRunId": run_id, "seq": seq}, MAX_STATE_EVENT_BYTES)
            self._q(
                "insert into wb_control_event(run_id,seq,body) values($1,$2,$3) on conflict do nothing",
                [run_id, seq, body])

    def _shell(self, record: dict[str, Any]) -> dict[str, Any]:
        return {**record, "events": [], "lastSeq": 0}

    def _assemble(self, row: dict[str, Any]) -> dict[str, Any]:
        record = json.loads(row["payload"])
        table = self._load_events(row["id"])
        payload_events = record["events"] if isinstance(record.get("events"), list) else []
        events = table if table else payload_events
        record["events"] = events
        record["lastSeq"] = events[-1]["seq"] if events else 0
        record["generation"] = int(row["generation"])
        record["leaseOwner"] = row["lease_owner"]
        record["leaseExpiresAt"] = float(row["lease_expires_at"] or 0)
        record["status"] = row["status"]
        return record

    def inspect_fence(self, run_id: str, owner_id: str) -> dict[str, Any]:
        """Sampling 心跳只许看租约列。整份 payload 是 2026-09-19 那场黄条的起因。"""
        _required(owner_id, "control_owner_required")
        rows = self._q(
            "select r.id, r.session_id, r.owner_id, r.idempotency_key, r.status, r.generation, "
            "r.lease_owner, r.lease_expires_at from wb_control_run r "
            "where r.id=$1 and r.owner_id=$2 and (r.accepted=1 or exists("
            "select 1 from wb_control_session s where s.session_id=r.session_id and s.active_run_id=r.id))",
            [run_id, owner_id])
        if not rows:
            raise ControlRunNotFound("control_run_not_found")
        row = rows[0]
        return {
            "runId": row["id"],
            "sessionId": row["session_id"],
            "ownerId": row["owner_id"],
            "status": row["status"],
            "generation": int(row["generation"]),
            "leaseOwner": row["lease_owner"],
            "leaseExpiresAt": float(row["lease_expires_at"] or 0),
            "cancelRequested": bool(self._q(
                "select 1 as ok from wb_control_cancel_request "
                "where session_id=$1 and owner_id=$2 and idempotency_key=$3",
                [row["session_id"], row["owner_id"], row["idempotency_key"]])),
        }

    def get(self, run_id: str, owner_id: str) -> dict[str, Any]:
        _required(owner_id, "control_owner_required")
        record = self._assemble(self._row(run_id, owner_id))
        if record["status"] not in TERMINAL and self._request_cancelled(record):
            record["cancelRequested"] = True
        return record

    def _request_cancelled(self, record):
        return bool(self._q("select 1 from wb_control_cancel_request where session_id=$1 and owner_id=$2 and idempotency_key=$3",
            [record["sessionId"], record["ownerId"], record["idempotencyKey"]]))

    def latest(self, session_id: str, owner_id: str) -> dict[str, Any] | None:
        _required(owner_id, "control_owner_required")
        slots = self._q("select * from wb_control_session where session_id=$1", [session_id])
        if not slots:
            return None
        if slots[0]["owner_id"] != owner_id:
            raise ControlRunNotFound("control_run_not_found")
        return self.get(slots[0]["active_run_id"], owner_id) if slots[0]["active_run_id"] else None

    def submit(self, session_id: str, owner_id: str, idempotency_key: str, payload: dict[str, Any],
               *, claim_worker: str | None = None, claim_seconds: float | None = None) -> dict[str, Any]:
        _required(session_id, "control_session_required")
        _required(owner_id, "control_owner_required")
        _required(idempotency_key, "control_idempotency_key_required")
        if not isinstance(payload, dict):
            raise ValueError("control_payload_required")
        encoded = _json(payload, min(MAX_PAYLOAD_BYTES, self.max_run_bytes - _RESERVED_BYTES))
        request_hash = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        self._q("insert into wb_control_session(session_id,owner_id,active_run_id,rev) values($1,$2,null,0) on conflict(session_id) do nothing", [session_id, owner_id])
        run_id = "ctr-" + uuid.uuid5(uuid.NAMESPACE_URL, "whybuddy:control:" + _json([session_id, idempotency_key], 4096)).hex
        for _ in range(20):
            slot = self._q("select * from wb_control_session where session_id=$1", [session_id])[0]
            if slot["owner_id"] != owner_id:
                raise ControlRunNotFound("control_run_not_found")
            existing = self._q("select * from wb_control_run where session_id=$1 and idempotency_key=$2", [session_id, idempotency_key])
            if existing:
                prior = json.loads(existing[0]["payload"])
                if prior["requestHash"] != request_hash:
                    raise ControlRunConflict("control_idempotency_conflict")
                if existing[0]["accepted"] or slot["active_run_id"] == prior["runId"]:
                    return self.get(prior["runId"], owner_id)
            if slot["active_run_id"]:
                active = self._row(slot["active_run_id"])
                if active["status"] not in TERMINAL:
                    raise ControlRunConflict("control_run_active")
                # Repair publication acknowledgement before moving the pointer;
                # a previous crash may have occurred immediately after its CAS.
                self._q("update wb_control_run set accepted=1 where id=$1", [active["id"]])
            if not existing:
                now = _now()
                # ⚠ 2026-09-22 RFZYDAVHG9：先插 queued、回头再 claim，中间那一拍
                #   共享库上的另一个 worker 把 run 抢走，本进程的新代码没跑到。
                #   收下的 worker 要在指针公开之前就把租约写上。
                leased = bool(claim_worker)
                expires = time.time() + _seconds(claim_seconds or 30) if leased else 0.0
                record = {"runId": run_id, "sessionId": session_id, "ownerId": owner_id,
                    "idempotencyKey": idempotency_key, "requestHash": request_hash,
                    "status": "running" if leased else "queued",
                    "payload": json.loads(encoded), "checkpoint": None, "events": [], "lastSeq": 0,
                    "generation": 1 if leased else 0,
                    "leaseOwner": claim_worker if leased else None,
                    "leaseExpiresAt": expires, "cancelRequested": False,
                    "goal": _goal_from_payload(json.loads(encoded)),
                    "createdAt": now, "updatedAt": now, "error": None}
                self._q(
                    "insert into wb_control_run(id,session_id,owner_id,idempotency_key,status,accepted,rev,generation,lease_owner,lease_expires_at,payload) "
                    "values($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9) on conflict(session_id,idempotency_key) do nothing",
                    [run_id, session_id, owner_id, idempotency_key,
                     "running" if leased else "queued",
                     1 if leased else 0,
                     claim_worker if leased else None,
                     expires,
                     _json(record, self.max_run_bytes - _RESERVED_BYTES)])
                continue
            changed = self._q("update wb_control_session set active_run_id=$1,rev=rev+1 where session_id=$2 and owner_id=$3 and rev=$4 returning session_id",
                [run_id, session_id, owner_id, slot["rev"]])
            if changed:
                self._q("update wb_control_run set accepted=1 where id=$1", [run_id])
                return self.get(run_id, owner_id)
        raise ControlRunConflict("control_submit_conflict")

    def list_runnable(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("invalid_control_scan_limit")
        rows = self._q("select r.* from wb_control_run r join wb_control_session s on s.active_run_id=r.id and s.session_id=r.session_id where r.status in ('queued','running') and r.lease_expires_at<=$1 order by r.id limit $2", [time.time(), limit])
        return [self._assemble(row) for row in rows]

    def list_waiting_operation(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """List durable goals paused on an async project operation."""
        rows = self._q("select r.* from wb_control_run r join wb_control_session s on s.active_run_id=r.id and s.session_id=r.session_id where r.status='waiting_operation' order by r.id limit $1", [limit])
        return [self._assemble(row) for row in rows]

    def requeue_waiting(self, run_id: str, *, operation_ids: list[str]) -> dict[str, Any]:
        """Atomically make a waiting goal claimable once its operation settled."""
        ids = [item for item in operation_ids if isinstance(item, str) and item.strip()][:32]
        for _ in range(20):
            row = self._row(run_id)
            record = self._assemble(row)
            goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            if record["status"] != "waiting_operation":
                return record
            if goal.get("awaitingOperationIds") != ids:
                raise ControlRunConflict("control_goal_operation_conflict")
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            updated = {**record, "status": "queued", "leaseOwner": None,
                "leaseExpiresAt": 0.0, "goal": {**goal, "status": "active", "updatedAt": _now()}}
            saved = self._q("update wb_control_run set status='queued',rev=rev+1,lease_owner=null,lease_expires_at=0,payload=$1 where id=$2 and rev=$3 and status='waiting_operation' returning id", [_json(self._shell(updated), self.max_run_bytes), run_id, row["rev"]])
            if saved:
                return self._assemble(self._row(run_id))
        raise ControlRunConflict("control_goal_requeue_conflict")

    def list_waiting_continue(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """停在「说完了但没做完」上的目标。跟 list_waiting_operation 同形。"""
        rows = self._q("select r.* from wb_control_run r join wb_control_session s on s.active_run_id=r.id and s.session_id=r.session_id where r.status='waiting_continue' order by r.id limit $1", [limit])
        return [self._assemble(row) for row in rows]

    def wait_for_continue(self, run_id: str, worker_id: str, generation: int,
                          *, progress_mark: str) -> dict[str, Any]:
        """producer 把这一 run 交给续跑调度：非终态，等 scanner 叫回来。

        `progressMark` 记的是**交出去那一刻的进展指纹**。下一次续跑结束时
        指纹没变 = 这一轮一个工具都没跑成，`should_continue` 据此收手。
        没有它，模型说一句「我这就去做」就能无限循环。
        """
        mark = str(progress_mark or "")[:240]
        def transform(record):
            goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            return {**record, "status": "waiting_continue", "leaseExpiresAt": 0.0,
                "goal": {**goal, "status": "waiting_continue", "progressMark": mark,
                         "updatedAt": _now()}}
        return self._producer_update(run_id, worker_id, generation, transform, reserve=False)

    def requeue_continue(self, run_id: str, *, progress_mark: str) -> dict[str, Any]:
        """scanner 把它翻回 queued，并且**记一次预算**。

        ⚠ 预算在这里加一，不在 producer 那边：加在这儿才跟「真的被重新排进
        队列」这件事绑死。加在别处会出现「排队失败但预算已扣」或者反过来
        「反复排队不扣」。
        """
        mark = str(progress_mark or "")[:240]
        for _ in range(20):
            row = self._row(run_id)
            record = self._assemble(row)
            if record["status"] != "waiting_continue":
                return record
            goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            if str(goal.get("progressMark") or "") != mark:
                # 指纹在我们判断之后变了：别人动过，重新走一遍判断，不硬排。
                raise ControlRunConflict("control_goal_continue_conflict")
            spent = goal.get("continuations")
            spent = spent + 1 if isinstance(spent, int) and spent > 0 else 1
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            updated = {**record, "status": "queued", "leaseOwner": None,
                "leaseExpiresAt": 0.0,
                "goal": {**goal, "status": "active", "continuations": spent,
                         "updatedAt": _now()}}
            saved = self._q("update wb_control_run set status='queued',rev=rev+1,lease_owner=null,lease_expires_at=0,payload=$1 where id=$2 and rev=$3 and status='waiting_continue' returning id", [_json(self._shell(updated), self.max_run_bytes), run_id, row["rev"]])
            if saved:
                return self._assemble(self._row(run_id))
        raise ControlRunConflict("control_goal_requeue_conflict")

    def wait_for_operations(self, run_id: str, worker_id: str, generation: int,
                            operation_ids: list[str]) -> dict[str, Any]:
        ids = [item for item in operation_ids if isinstance(item, str) and item.strip()][:32]
        if not ids:
            raise ValueError("control_goal_operations_required")
        def transform(record):
            goal = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            return {**record, "status": "waiting_operation", "leaseExpiresAt": 0.0,
                "goal": {**goal, "status": "waiting_operation", "awaitingOperationIds": ids, "updatedAt": _now()}}
        return self._producer_update(run_id, worker_id, generation, transform, reserve=False)

    def claim(self, run_id: str, worker_id: str, lease_seconds: float) -> dict[str, Any] | None:
        _required(worker_id, "control_worker_required")
        duration = _seconds(lease_seconds)
        for _ in range(20):
            row = self._row(run_id)
            record = self._assemble(row)
            if record["status"] in TERMINAL:
                return None
            now = time.time()
            if row["lease_expires_at"] > now:
                return record if row["lease_owner"] == worker_id else None
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            updated = {**record, "status": "running", "generation": int(row["generation"]) + 1,
                "leaseOwner": worker_id, "leaseExpiresAt": now + duration, "updatedAt": _now()}
            updated["cancelRequested"] = record["cancelRequested"] or self._request_cancelled(record)
            rows = self._q("update wb_control_run set status='running',accepted=1,rev=rev+1,generation=$1,lease_owner=$2,lease_expires_at=$3,payload=$4 where id=$5 and rev=$6 and lease_expires_at<=$7 and exists(select 1 from wb_control_session s where s.active_run_id=wb_control_run.id and s.session_id=wb_control_run.session_id) returning id",
                [updated["generation"], worker_id, updated["leaseExpiresAt"], _json(self._shell(updated), self.max_run_bytes), run_id, row["rev"], time.time()])
            if rows:
                return self._assemble(self._row(run_id))
        raise ControlRunConflict("control_claim_conflict")

    def _producer_update(self, run_id, worker_id, generation, transform, *, reserve=True):
        if type(generation) is not int or generation < 1:
            raise ControlRunConflict("control_lease_lost")
        for _ in range(20):
            row = self._row(run_id)
            record = self._assemble(row)
            if (record["status"] in TERMINAL or row["lease_owner"] != worker_id or int(row["generation"]) != generation
                    or float(row["lease_expires_at"] or 0) <= time.time()):
                raise ControlRunConflict("control_lease_lost")
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            updated = transform(record)
            updated["updatedAt"] = _now()
            encoded = _json(self._shell(updated), self.max_run_bytes - (_RESERVED_BYTES if reserve else 0))
            saved = self._q("update wb_control_run set status=$1,rev=rev+1,lease_expires_at=$2,payload=$3 where id=$4 and rev=$5 and generation=$6 and lease_owner=$7 and lease_expires_at>$8 and exists(select 1 from wb_control_session s where s.active_run_id=wb_control_run.id and s.session_id=wb_control_run.session_id) returning id",
                [updated["status"], updated["leaseExpiresAt"], encoded, run_id, row["rev"], generation, worker_id, time.time()])
            if saved:
                return self._assemble(self._row(run_id))
        raise ControlRunConflict("control_update_conflict")

    def heartbeat(self, run_id: str, worker_id: str, generation: int, lease_seconds: float) -> dict[str, Any]:
        """只续租约列。整行改写 payload 是 2026-09-19 采样中途被掐的根。"""
        if type(generation) is not int or generation < 1:
            raise ControlRunConflict("control_lease_lost")
        duration = _seconds(lease_seconds)
        expires = time.time() + duration
        for _ in range(20):
            row = self._row(run_id)
            if (row["status"] in TERMINAL or row["lease_owner"] != worker_id
                    or int(row["generation"]) != generation
                    or float(row["lease_expires_at"] or 0) <= time.time()):
                raise ControlRunConflict("control_lease_lost")
            saved = self._q(
                "update wb_control_run set lease_expires_at=$1 where id=$2 and rev=$3 "
                "and generation=$4 and lease_owner=$5 and lease_expires_at>$6 "
                "and exists(select 1 from wb_control_session s where s.active_run_id=wb_control_run.id "
                "and s.session_id=wb_control_run.session_id) returning id",
                [expires, run_id, row["rev"], generation, worker_id, time.time()])
            if saved:
                record = self._assemble(self._row(run_id))
                record["leaseExpiresAt"] = expires
                return record
        raise ControlRunConflict("control_update_conflict")

    def save_checkpoint(self, run_id: str, worker_id: str, generation: int, checkpoint: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(checkpoint, dict):
            raise ValueError("control_checkpoint_required")
        frozen = json.loads(_json(checkpoint, self.max_run_bytes - _RESERVED_BYTES))
        return self._producer_update(run_id, worker_id, generation, lambda record: {**record, "checkpoint": frozen})

    def goal(self, run_id: str, owner_id: str) -> dict[str, Any]:
        """Return the small objective envelope used to resume a run in the UI.

        Older rows predate this field.  They remain readable and receive a
        conservative empty conversation objective rather than exposing their
        full payload or checkpoint.
        """
        record = self.get(run_id, owner_id)
        value = record.get("goal")
        if not isinstance(value, dict):
            return {"text": "", "kind": "conversation", "status": "active",
                    "awaitingOperationIds": [], "updatedAt": record.get("updatedAt")}
        return {
            "text": str(value.get("text") or "")[:4000],
            "kind": value.get("kind") if value.get("kind") in {"project", "conversation"} else "conversation",
            "status": value.get("status") if value.get("status") in GOAL_STATUSES else "active",
            "awaitingOperationIds": [str(item)[:240] for item in (value.get("awaitingOperationIds") or [])
                                     if isinstance(item, str)][:32],
            # 自动续跑的账：已经续了几次、上次交出去时的进展指纹。
            # 旧行没有这两个字段，读成 0 / "" —— 等同于「一次都没续过」，
            # 正是想要的兼容行为。
            "continuations": value["continuations"] if isinstance(value.get("continuations"), int) and value["continuations"] > 0 else 0,
            "progressMark": str(value.get("progressMark") or "")[:240],
            "updatedAt": value.get("updatedAt") or record.get("updatedAt"),
        }

    def update_goal(self, run_id: str, worker_id: str, generation: int, *,
                    status: str, operation_ids: list[str] | None = None,
                    kind: str | None = None, text: str | None = None) -> dict[str, Any]:
        """Fenced goal bookkeeping for a producer or a recovery worker.

        This only records whether the existing control run is active, waiting
        for a user, or has an operation to observe.  It never dispatches work;
        callers still use the existing ``ControlRunService`` loop.

        ``kind`` / ``text`` 只在工程创建成功后升级身份时传入。不传就沿用
        当前值——``control_tool_start`` 每发都调这里，不许把业务目标抹回
        按钮文案，也不许把 continuations 清零。
        """
        if status not in GOAL_STATUSES:
            raise ValueError("invalid_control_goal_status")
        if kind is not None and kind not in {"project", "conversation"}:
            raise ValueError("invalid_control_goal_kind")
        ids = operation_ids or []
        if not isinstance(ids, list) or any(not isinstance(item, str) or not item.strip() for item in ids):
            raise ValueError("invalid_control_goal_operations")
        ids = list(dict.fromkeys(item.strip()[:240] for item in ids))[:32]
        def transform(record):
            current = record.get("goal") if isinstance(record.get("goal"), dict) else {}
            next_kind = kind if kind in {"project", "conversation"} else (
                current.get("kind") if current.get("kind") in {"project", "conversation"} else "conversation")
            next_text = (str(text).strip()[:4000] if isinstance(text, str) and text.strip()
                         else str(current.get("text") or "")[:4000])
            # ⚠ 2026-09-13 真机 control-continuation-smoke 抓到：这里原来是
            #   **重建**一个 goal 字典，`continuations` / `progressMark` 两个
            #   字段被静静抹掉。而 `update_goal(status="active")` 在每次
            #   control_tool_start 时都会调——于是自动续跑的计数每跑一个工具
            #   就清零，**目标级预算永远烧不完，续跑会无限循环**。
            #   护栏写对了，落库把它擦了，判据还全绿。
            spent = current.get("continuations")
            spent = spent if isinstance(spent, int) and spent > 0 else 0
            return {**record, "goal": {"text": next_text, "kind": next_kind, "status": status,
                "awaitingOperationIds": ids,
                "continuations": spent,
                "progressMark": str(current.get("progressMark") or "")[:240],
                "updatedAt": _now()}}
        return self._producer_update(run_id, worker_id, generation, transform)

    def append_event(self, run_id: str, worker_id: str, generation: int, event: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(event, dict):
            raise ValueError("control_event_required")
        # Legacy complete/factory_complete carry the full session, including
        # generated HTML. Bound them independently from ordinary log events.
        event_limit = MAX_STATE_EVENT_BYTES if event.get("type") in {
            "complete", "factory_complete", "spec_page", "skill_result", "publish_closure"
        } else MAX_EVENT_BYTES
        frozen = json.loads(_json(event, event_limit))
        if type(generation) is not int or generation < 1:
            raise ControlRunConflict("control_lease_lost")
        for _ in range(20):
            row = self._row(run_id)
            if (row["status"] in TERMINAL or row["lease_owner"] != worker_id
                    or int(row["generation"]) != generation
                    or float(row["lease_expires_at"] or 0) <= time.time()):
                raise ControlRunConflict("control_lease_lost")
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            record = self._assemble(row)
            if len(record["events"]) >= self.max_events:
                raise ValueError("control_event_count_limit")
            next_seq = record["lastSeq"] + 1
            saved = {**frozen, "controlRunId": run_id, "seq": next_seq}
            body = json.dumps(saved, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
            inserted = self._q(
                "insert into wb_control_event(run_id,seq,body) select $1,$2,$3 where exists("
                "select 1 from wb_control_run r where r.id=$1 and r.generation=$4 and r.lease_owner=$5 "
                f"and r.lease_expires_at>$6 and r.status not in {_TERMINAL_SQL} and {_RUN_SESSION_FENCE}"
                ") on conflict do nothing returning seq",
                [run_id, next_seq, body, generation, worker_id, time.time()])
            if inserted:
                return saved
        raise ControlRunConflict("control_event_append_conflict")

    def finish(self, run_id: str, worker_id: str, generation: int, status: str, error=None) -> dict[str, Any]:
        if status not in TERMINAL:
            raise ValueError("invalid_control_terminal_status")
        frozen = json.loads(_json(error, 2048))
        return self._producer_update(run_id, worker_id, generation,
            lambda record: {**record, "status": status, "error": frozen, "leaseExpiresAt": 0.0}, reserve=False)

    def complete(self, run_id: str, worker_id: str, generation: int,
                 status: str, event: dict[str, Any], error=None) -> dict[str, Any]:
        """Publish the final state and its actual outcome. Event is append-only.

        HTTP SQL 不能跨请求开事务，所以先 INSERT 完成事件再把 status 打成终态。
        取消抢先时不写事件——跟旧 CAS 里 cancel 优先同一条。
        """
        if status not in {"completed", "waiting_user", "failed"} or event.get("type") != "complete":
            raise ValueError("invalid_control_completion")
        record = self._assemble(self._row(run_id))
        if record["cancelRequested"]:
            return self.finish(run_id, worker_id, generation, "cancelled", "control_cancelled")
        self.append_event(run_id, worker_id, generation, event)
        return self.finish(run_id, worker_id, generation, status, error)

    def suspend(self, run_id: str, worker_id: str, generation: int) -> dict[str, Any]:
        """Release only after the producer has drained, preserving its checkpoint."""
        return self._producer_update(run_id, worker_id, generation,
            lambda record: {**record, "leaseExpiresAt": 0.0}, reserve=False)

    def cancel(self, run_id: str, owner_id: str) -> dict[str, Any]:
        _required(owner_id, "control_owner_required")
        for _ in range(20):
            row = self._row(run_id, owner_id)
            record = self._assemble(row)
            if record["status"] in TERMINAL or record["cancelRequested"]:
                return record
            # 取消必须进 cancel_request 表。sampling 的 fence 只看租约列，
            # 看不见 payload 里的 cancelRequested——只写 payload 的话，
            # 正在采样的回合会一直跑到墙钟（2026-09-19 拆 payload 之后）。
            self._q(
                "insert into wb_control_cancel_request(session_id,owner_id,idempotency_key) "
                "values($1,$2,$3) on conflict do nothing",
                [row["session_id"], row["owner_id"], row["idempotency_key"]])
            self._spill_payload_events(run_id, json.loads(row["payload"]).get("events") or [])
            updated = {**record, "cancelRequested": True, "updatedAt": _now()}
            rows = self._q("update wb_control_run set rev=rev+1,payload=$1 where id=$2 and owner_id=$3 and rev=$4 returning id",
                [_json(self._shell(updated), self.max_run_bytes), run_id, owner_id, row["rev"]])
            if rows:
                cancelled = self._assemble(self._row(run_id, owner_id))
                cancelled["cancelRequested"] = True
                return cancelled
        raise ControlRunConflict("control_cancel_conflict")

    def cancel_request(self, session_id: str, owner_id: str, idempotency_key: str) -> dict[str, Any]:
        """An explicit stop can arrive before POST has published its run ID."""
        for value, name in ((session_id, "control_session_required"), (owner_id, "control_owner_required"),
                            (idempotency_key, "control_idempotency_key_required")):
            _required(value, name)
        self._q("insert into wb_control_cancel_request(session_id,owner_id,idempotency_key) values($1,$2,$3) on conflict do nothing",
            [session_id, owner_id, idempotency_key])
        rows = self._q("select r.id from wb_control_run r where r.session_id=$1 and r.owner_id=$2 and r.idempotency_key=$3 and (r.accepted=1 or exists(select 1 from wb_control_session s where s.active_run_id=r.id))",
            [session_id, owner_id, idempotency_key])
        if rows:
            return self.cancel(rows[0]["id"], owner_id)
        return {"sessionId": session_id, "cancelRequested": True, "runId": None}
