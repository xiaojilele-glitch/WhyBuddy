"""
Session management for V5, ported from Node's memory/session-store.ts, sliderule/session-driver.ts, mini-session.ts.

Provides create, load, save, drive loop using stable Python RAG for evidence instead of Node LLM.
"""

import os
from typing import Dict, Any, Optional
from models.v5_state import Artifact, CapabilityRun, ProducedBy, V5SessionState, DependencyEdge, SlideRuleReplayEvent, ReasoningEvent, UserIntervention
from models.v5_state import stamp_run_timing as _stamp_run_timing
from datetime import datetime, timezone
from .slide_rule_orchestrator import orchestrate_plan
from .slide_rule_executor import execute_capability
from .persistence import PersistClosedError, delete_session_record, load_all, load_session_record, save_session_record
from . import persistence  # set_cache_sink：下层定义接口，这里注入实现
from .slide_rule_coverage import evaluate_coverage_gate
from .slide_rule_interactive_gates import (
    open_human_question_gap_count,
    user_clears_readiness,
    evaluate_interactive_gate_after_commit,
    apply_resolve_and_clear_readiness,
    apply_route_selection_resolution,
    user_picks_route,
    user_rejects_route_selection,
    gaps_from_gap_ask_content,
    merge_gap_ask_into_state,
    apply_user_intervention_invalidation,
    set_await_for_browser,
)

_sessions: Dict[str, V5SessionState] = {}


def _pin_into_cache(session_id: str, state: V5SessionState) -> None:
    """持久层写完之后，把这一份钉进内存缓存。

    ⚠ 2026-08-29：这段做法原来长在 persistence 里，靠 `from .slide_rule_session
      import _sessions` 反向 import——持久层依赖会话层，是个真的循环依赖。
      抄 grok（§17）：**下层定义接口、上层实现并注入**，依赖箭头始终朝下。

    为什么要钉：驱动器走 persist_state 不经 save_session。库写失败/降级后，
    GET 若只信库会读到旧指针；钉进缓存让 load_session 在「内存比库新」时
    把预览和版本交出去（2026-08-18 过夜实测）。
    """
    _sessions[session_id] = state


def ensure_cache_sink() -> None:
    """把注入补上（幂等）。

    ⚠ 2026-08-29 实测踩到：**注入活不过一次 `importlib.reload(persistence)`**。
      reload 会把模块全局重置成 None，而本模块已经 import 过、不会再执行一次
      注册——于是钉缓存**安静地停了**：写还是成功的，只是库写失败/降级之后
      GET 又会读到旧指针（2026-08-18 过夜那个病原样回来），一行日志都没有。

      这不只是测试里的事：uvicorn `--reload` 在开发时也会重载模块。

      所以除了 import 时注册，两个入口（load/save）再补一次。代价是一次
      `is None` 判断；换来的是「reload 之后自愈」而不是「悄悄失效」。
    """
    if persistence.get_cache_sink() is None:
        persistence.set_cache_sink(_pin_into_cache)


#: ⚠ 注入必须在 import 这个模块时就发生——**函数写对了 ≠ 它被调用了**（第三条）。
#:   判据 tests/test_persistence_cache_sink.py 钉的就是这一句真的执行过。
persistence.set_cache_sink(_pin_into_cache)

def _load_sessions():
    global _sessions
    # ⚠ 2026-08-19：曾经在模块 import 末尾无条件调用。HTTPS 网关
    # `select session_id, payload` 全表（80 条 × 几百 KB，墙钟数秒到
    # statement_timeout 30s）会挡住 uvicorn 的 Application startup complete，
    # dev:all 看起来像卡住。文件后端仍在 load_session 里缓存为空时懒加载。
    _sessions = load_all()
    return _sessions


def _shared_store_active() -> bool:
    """会话是不是落在跨机器共享的库里。

    决定 load_session 能不能相信进程内缓存：文件存档由本进程独占，缓存是安全的；
    共享库则不然——另一台机器写完，这里的缓存还是旧的。
    """
    try:
        from . import session_blob_store

        return session_blob_store.get_store() is not None
    except Exception:  # noqa: BLE001 — 判定不了就按老行为（用缓存）
        return False

# 注意：这里刻意没有"整体 dump 内存缓存到存档"的函数。历史上 create_session
# 调 save_all(_sessions) 整体覆写存档文件——当缓存在别的写入者之后变陈旧时，
# 一次 create 就会把其他会话从磁盘上抹掉（实测踩过：真实话题跨重启失忆的
# 元凶之一）。新建走原子认领，已有会话的更新走 save_session_record 的单条守卫。

# Crockford Base32 —— 去掉了 I / L / O / U。
#
# 为什么用它而不是 hex 或普通 base32：这些 id 会被人念出来、抄进工单、在日志里
# 肉眼比对（这次排查就是这么干的）。I/1、O/0、L/1 混淆是真会发生的事，U 被排除
# 是为了不拼出脏字。字母表照抄 ULID 规范（github.com/ulid/spec）。
_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# 后缀字符数。10 个 Crockford 字符 = 50 位熵。
#
# 长度上限是 **32**，不是随便定的：server/routes/sliderule-screenshot-device.ts:19,27
# 拿 `sessionId.slice(0, 32)` 当截图缓存键，超了会被截断、两个会话共用一张截图。
# 现在是 3("sr-") + 14(时间戳) + 1("-") + 10 = 28，留 4 个字符余量。
_ID_SUFFIX_LEN = 10


def _new_session_id() -> str:
    """时间戳前缀 + 加密随机后缀。

    ## 修的是什么（2026-08-06 实测）

    原来是 `f"sr-{datetime.now().strftime('%Y%m%d%H%M%S')}"` —— **秒级时间戳，
    没有随机位，没有碰撞检查**。同一秒内创建的会话拿到完全相同的 id，于是后写的
    把先写的整个盖掉。

    这不是理论风险。并发跑 5 个话题的实测结果：5 个会话只拿到 3 个 id，
    「独立书店」和「宠物寄养」两个话题的模型双双被「农机租赁」覆盖，库里连它们
    的原始目标文本都查不到了。下游那套 lastTurnId 单调守卫拦不住——它防的是
    同一个会话被陈旧快照覆盖，而在这套设计里 id 就是身份，不同会话共用一个 id
    时它只会认为"这是同一个会话的新一轮"。

    ## 为什么是这个形状

    结构照 ULID 规范（github.com/ulid/spec）：**时间戳在前保证字典序即时间序，
    加密随机在后保证唯一**。ULID 用 48 位毫秒 + 80 位随机；这里保留原有的
    可读时间戳（`sr-20260806140617-A7K2M9PQRS`），因为它会进日志、进工单，
    换成不透明的 `01K1M…` 反而增加排查成本，而且 ULID 以 '0' 开头会**排在**
    所有存量 `sr-2026…` id **前面**，跨格式的字典序会悄悄反转。

    随机源用 `os.urandom`（跟 python-ulid 的 default provider 一致，
    ulid/providers/default.py:36）。`b % 32` 没有取模偏置——256 是 32 的整数倍。

    50 位熵让碰撞极少发生；create_session 仍以持久层原子认领的 created
    结果为准，真撞上就重新生成。不能拿「先查没有」代替插入成功。
    """
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    suffix = "".join(_ID_ALPHABET[b % 32] for b in os.urandom(_ID_SUFFIX_LEN))
    return f"sr-{stamp}-{suffix}"


def _claim_and_cache(state: V5SessionState) -> Dict[str, Any]:
    ensure_cache_sink()
    try:
        result = persistence.claim_session_record(state)
    except Exception as exc:  # noqa: BLE001 - every persistence failure stops the first run
        raise PersistClosedError("claim_failed", str(exc)[:200]) from exc
    authoritative = result.get("state") if isinstance(result, dict) else None
    if (
        not isinstance(result, dict) or result.get("ok") is not True
        or not isinstance(authoritative, V5SessionState)
        or authoritative.sessionId != state.sessionId
    ):
        error = result if isinstance(result, dict) else {}
        raise PersistClosedError(
            str(error.get("reason") or "claim_failed"), str(error.get("message") or ""),
        )
    _sessions[state.sessionId] = authoritative
    return result


def claim_session(state: V5SessionState) -> V5SessionState:
    """Return the durable owner before starting work; failed claims never populate cache."""
    return _claim_and_cache(state)["state"]


def create_session(goal_text: str, session_id: Optional[str] = None) -> V5SessionState:
    # 归属：从请求上下文取当前用户（contextvars，见 services/request_context.py
    # 顶部那段说明）。拿不到就是 None = 无主——匿名建的会话是合法状态，
    # 不能因为没登录就建不出来。判定语义在 app_access。
    from .request_context import current_user_id

    generated = not session_id
    for _attempt in range(6 if generated else 1):
        candidate_id = _new_session_id() if generated else session_id
        state = V5SessionState(
            sessionId=candidate_id,
            ownerId=current_user_id(),
            goal={"text": goal_text, "status": "needs_refinement"},
            artifacts=[],
            capabilityRuns=[],
            coverageGaps=[],
            conversation=[],
            runtimePhase="idle",
        )
        result = _claim_and_cache(state)
        if result["created"] or not generated:
            return result["state"]
        print(f"[session] id 撞了（{candidate_id}），换一个重试")
    raise PersistClosedError("session_id_collision", "Could not allocate a new session id")

def _mv_seq(vid: Any) -> int:
    s = str(vid or "")
    if s.startswith("mv-"):
        try:
            return int(s[3:])
        except ValueError:
            return 0
    return 0


def _memory_ahead_of_store(mem: Optional[V5SessionState], disk: Optional[V5SessionState]) -> bool:
    """本进程刚推演完、落库失败/降级时，内存比库新。

    ⚠ 2026-08-18 过夜：共享库下 GET 无条件回库，读到旧指针；前端 PUT 再
    把新 lastTurnId 盖上去，版本史被钉死。另一台机器写了更新的库行时
    内存并不 ahead——那种情况仍信库。
    """
    if mem is None or disk is None or mem.ownerId != disk.ownerId:
        return False
    from .persistence import _monotonic_key

    if _monotonic_key(mem)[0] > _monotonic_key(disk)[0]:
        return True
    m_vers = list(getattr(mem, "modelVersions", None) or [])
    d_vers = list(getattr(disk, "modelVersions", None) or [])
    if len(m_vers) > len(d_vers):
        return True
    if _mv_seq(getattr(mem, "currentModelVersionId", None)) > _mv_seq(
        getattr(disk, "currentModelVersionId", None)
    ):
        return True
    mem_pages = getattr(mem, "specFirstPages", None)
    disk_pages = getattr(disk, "specFirstPages", None)
    mem_has = isinstance(mem_pages, dict) and bool(mem_pages.get("pages"))
    disk_has = isinstance(disk_pages, dict) and bool(disk_pages.get("pages"))
    return bool(mem_has and not disk_has)


def load_session(session_id: str) -> Optional[V5SessionState]:
    ensure_cache_sink()  # reload 之后自愈，见该函数注释
    # 会话落库之后（2026-08-02）缓存不能再无条件相信：库是**跨机器共享**的，
    # 本进程的缓存看不见别的机器刚写进去的内容，返回缓存等于返回陈旧数据。
    # 存档还在本机文件里时不存在这个问题（本进程独占那个文件），所以只在库
    # 后端下绕开缓存。代价是每次读一趟库（HTTP 通道实测 p50 77ms）。
    if _shared_store_active():
        cached = _sessions.get(session_id)
        result = load_session_record(session_id)
        if result.get("ok"):
            state = result["session"]
            if _memory_ahead_of_store(cached, state):
                return cached
            _sessions[session_id] = state
            return state
        # 库读不到：可能是这一条真不存在，也可能是库临时不可用。后者不该让
        # 正在进行的推演丢掉手上的状态，所以回落到缓存（有就用，没有才 None）。
        return cached

    if not _sessions:
        _load_sessions()
    cached = _sessions.get(session_id)
    if cached is not None:
        return cached
    result = load_session_record(session_id)
    if result.get("ok"):
        state = result["session"]
        _sessions[session_id] = state
        return state
    return None

def save_session(
    state: V5SessionState, *, server_write: bool = False, require_durable: bool = False,
    expected_control_run: dict | None = None,
) -> V5SessionState:
    ensure_cache_sink()  # reload 之后自愈，见该函数注释
    # Delegate guard+merge to persistence (replay append-only + monotonic_key lastTurnId+counts guard).
    # Then ALWAYS reconcile _sessions cache from the persistence authoritative result (load after write).
    # This ensures stale/older state passed to service save NEVER stays in the memory authority cache.
    # load_session will see only the guard-protected newer state; fixes review finding 1.
    # Python service save path now respects the persistence guard final result.
    saved = save_session_record(state, server_write=server_write,
                                expected_control_run=expected_control_run)
    if require_durable and not saved.get("ok"):
        raise PersistClosedError(
            str(saved.get("reason") or "persist_failed"), str(saved.get("message") or "")
        )
    # checkpoint 是证据链。save_session_record 可能已经把会话正文落了，
    # 再 load 成功并不能当存档成功——PUT 200 会让客户端以为能回退到这一轮。
    # ⚠ 2026-08-27：只在 save_session_record 判 fail-closed、save_session
    # 回读正文当成功，HTTP 永远 200。
    if isinstance(saved, dict) and saved.get("ok") is False:
        reason = str(saved.get("reason") or "persist_failed")
        if reason == "checkpoint_write_failed":
            raise PersistClosedError(reason, str(saved.get("message") or ""))
    # 库后端会把刚写下去的权威状态一并带回来（persistence 里手上就有），
    # 直接用它对账，省掉一趟全量回读——那趟在 HTTP 通道上要驮 ~300KB。
    # 文件后端不带这个字段，照旧走下面的 load 对账。
    authoritative = saved.get("state") if saved.get("ok") else None
    if authoritative is not None:
        if _memory_ahead_of_store(state, authoritative):
            # 库是削过页的降级包：缓存留调用方，下一轮精修还能拿到 reuse_pages
            _sessions[state.sessionId] = state
            return state
        _sessions[state.sessionId] = authoritative
        return authoritative
    rec = load_session_record(state.sessionId)
    if rec.get("ok"):
        final = rec["session"]
        if _memory_ahead_of_store(state, final):
            # ⚠ 落库失败后回读旧库再写进缓存 = 过夜那次 PUT 钉死的前奏
            _sessions[state.sessionId] = state
            return state
        _sessions[state.sessionId] = final
        return final
    # rare persist error: fall back (do not leave caller assuming success)
    _sessions[state.sessionId] = state
    return state

def delete_session(session_id: str):
    _sessions.pop(session_id, None)
    return delete_session_record(session_id)

def drive_reasoning_turn(state: V5SessionState, turn_id: str, user_text: str, intervention: Optional[UserIntervention] = None) -> V5SessionState:
    """Main loop: orchestrate + execute caps using Python RAG for stable evidence.
    Implements V5.2 runtimePhase machine: idle -> orchestrating -> awaiting|failed|done
    (PYTHON_AUTHORITY for driver phase transitions per task).
    """
    state.runtimePhase = "orchestrating"
    state.lastTurnId = turn_id
    # Emit phase change + replay so browser polling returned/persisted state sees orchestrating start (non-frozen)
    append_replay_event(state, kind="decision", turnId=turn_id, decisionId=f"phase-orchestrating-{turn_id}")
    append_reasoning_event(
        state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think",
        text=f"phase_changed: orchestrating (turn {turn_id})", order=0
    )
    # Immediate persist after start emit: makes orchestrating visible to GET /sessions poll BEFORE any cap exec (addresses review: no mid-save -> frozen)
    state = save_session(state)
    # G_READY resolution: on user turn intake, resolve open_question gaps from answer text and clear await if cleared.
    # This is the userClearsReadiness + resolveReadinessGaps path (PYTHON_AUTHORITY).
    state = apply_resolve_and_clear_readiness(state, user_text or "")
    # G_CONFIRM + route selection/reject (PYTHON_AUTHORITY): user pick clears confirm await; reject stales route artifacts and clears (enables re-compare without re-park).
    # Named behaviors (userPicksRoute/userRejectsRouteSelection + state writes) now in Python; no Node fallback.
    state = apply_route_selection_resolution(state, user_text or "")
    # User intervention invalidation + stale cascade (PYTHON_AUTHORITY this task): general UserIntervention support.
    # targetArtifactId/targetNodeId/targetDecisionId trigger target + depGraph downstream cascade into staleArtifactIds (monotonic).
    # Sets state.userIntervention; challenges graph nodes; handles decision ledger. Called unconditionally if provided.
    # Classification: was TS_RUNTIME_OWNED (invalidateForIntervention in runtime) now PYTHON_AUTHORITY in drive.
    # No Node fallback hiding semantics. Route text special-case remains orthogonal.
    state = apply_user_intervention_invalidation(state, intervention)
    try:
        plan_result = orchestrate_plan(state, turn_id, user_text)
        # PYTHON_AUTHORITY pick: explicitly invoke pick_next_capabilities; use its result directly.
        # Empty pick means converge per Python-owned fallback rules; no fallback to plan_result.selected (legacy).
        picks = pick_next_capabilities(state, user_text)
        selected = picks
        state.conversation.append({"role": "user", "text": user_text, "turnId": turn_id})
        state.conversation.append({"role": "system", "text": plan_result.rationale, "turnId": turn_id})
        append_replay_event(state, kind="conversation", turnId=turn_id, conversationId=f"c-{turn_id}")

        for sel in selected:
            cap_id = sel["capabilityId"]
            role = sel.get("roleId", "agent")
            import time as _time
            t0 = _time.time()
            run_id = f"run-{turn_id}-{cap_id}"
            # Emit capability_started for browser-visible progress (reasoningEvents visible in returned state / poll)
            append_reasoning_event(
                state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_start",
                text=f"capability_started: {cap_id}", roleId=role, order=1
            )
            append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap_id, capabilityRunId=run_id)
            # Immediate persist after start append, BEFORE execute_capability (long cap exec must not block pollers from seeing start)
            state = save_session(state)
            try:
                # Execute with RAG - always brings evidence, no degraded
                exec_result = execute_capability(cap_id, state, [], role, turn_id)
                # Use Python-owned commitArtifact (artifact, run, gate, dependencyGraph updates)
                art_id = f"art-{turn_id}-{cap_id}"
                produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap_id, roleId=role)
                kind = "evidence" if "evidence" in cap_id or cap_id in ["mcp.call", "skill.invoke"] else "report" if cap_id == "report.write" else "risk"
                exec_res_dump = exec_result.model_dump() if hasattr(exec_result, "model_dump") else {"title": getattr(exec_result, "title", ""), "summary": getattr(exec_result, "summary", ""), "content": getattr(exec_result, "content", ""), "sources": getattr(exec_result, "sources", [])}
                # commit_artifact populates art+run (with computed gateResults) + depGraph + ledger
                art, run = commit_artifact(
                    state,
                    id=art_id,
                    kind=kind,
                    content=getattr(exec_result, "content", ""),
                    summary=getattr(exec_result, "summary", ""),
                    title=getattr(exec_result, "title", None),
                    provenance=getattr(exec_result, "provenance", "python-rag"),
                    producedBy=produced,
                    inputArtifactIds=[],
                    turnId=turn_id,
                    payload={"sources": getattr(exec_result, "sources", [])},
                )
                # attach result + timing to the run
                dur = int((_time.time() - t0) * 1000)
                if hasattr(run, "result"):
                    run.result = exec_res_dump
                else:
                    if isinstance(run, dict):
                        run["result"] = exec_res_dump
                # ⚠ 两处一起写：顶层 durationMs 与 timing.durationMs。
                #   只赋 timing 的话上一轮新加的那一格从落地第一天就是死的
                #   （真机 13 行台账顶层全 None，见 stamp_run_timing 头注）。
                #   dict / pydantic 两种形态由那个函数一并处理，这里不再分叉。
                _stamp_run_timing(run, durationMs=dur, startedAt=None, completedAt=None)
                # Emit capability_complete so UI sees completion without waiting full drive end
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_complete",
                    text=f"capability_completed: {cap_id}", roleId=role, order=2
                )
                # Persist complete immediately so poll sees cap done before next or drive return
                state = save_session(state)

                # G_READY / interactive gate materialization + park (after clarification caps):
                # gap.ask/intent.clarify content -> open_question gaps; then evaluate gate; if park set awaiting+ready and break.
                # Prevents continuing execution past G_READY (no LLM self-answer). User answer will resolve on next drive.
                if cap_id in ("gap.ask", "intent.clarify", "question.expand"):
                    try:
                        content = getattr(exec_result, "content", "") or ""
                        gfs = gaps_from_gap_ask_content(content, turn_id, art_id)
                        if gfs:
                            merge_gap_ask_into_state(state, gfs)
                    except Exception:
                        pass
                ig = evaluate_interactive_gate_after_commit(state, {"capabilityId": cap_id, "turnUserText": user_text or "", "committed": True})
                if ig.get("park"):
                    # use hardened browser-contract helper (PYTHON slice) to set phase+awaitReason
                    state = set_await_for_browser(state, ig.get("gate") or "ready", ig.get("detail", "readiness gate parked for human answer"))
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think",
                        text=f"phase_changed: awaiting ({getattr(state, 'awaitReason', None) or (state.get('awaitReason') if isinstance(state, dict) else None)}) via G_READY gate", order=9
                    )
                    state = save_session(state)
                    return save_session(state)  # direct early return after G_READY park; skips all subsequent phase decision (prevents awaitReason overwrite to user_input)
            except Exception as cap_exc:
                # Record per-capability error run; preserve prior state (append); do not whole-fail here
                dur = int((_time.time() - t0) * 1000)
                timing = {"durationMs": dur}
                err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap_id}
                record_capability_run_error(
                    state,
                    capabilityId=cap_id,
                    turnId=turn_id,
                    error=err,
                    roleId=role,
                    timing=timing,
                )
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap_id, kind="capability_complete",
                    text=f"capability_completed: {cap_id} (error)", roleId=role, order=2
                )
                # Persist error complete immediately for poll visibility
                state = save_session(state)
                # surface degraded without hiding: set detail, keep phase decision below use current state
                state.awaitDetail = (state.awaitDetail or "") + f"; degraded cap {cap_id}: {str(cap_exc)[:80]}"
                # do not raise, record keeps it auditable, prior artifacts/runs intact

        # Phase decision: coverage or no more selected -> done or awaiting
        # rely on picks (from pick_next_capabilities) to reflect full fallback/selection rules.
        # Empty picks == converge (no legacy plan fallback).
        # G_READY post-turn: if human questions remain, park ready (authoritative, not user_input).
        # Short-circuit BEFORE coverage/picks decision to prevent else branch overwriting awaitReason to "user_input".
        # This ensures Python-owned G_READY park is preserved (no self-answer past readiness gate).
        if open_human_question_gap_count(state) > 0 and not user_clears_readiness(user_text or "", state):
            # use hardened browser-contract helper so frontend receives awaitReason + phase (no silent drop)
            state = set_await_for_browser(state, "ready", f"{open_human_question_gap_count(state)} open human question(s) after turn; awaiting clarification")
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting (ready) G_READY", order=10)
            state = save_session(state)
            final = save_session(state)
            return final
        from .slide_rule_coverage import resolve_coverage_gaps_from_state
        state = resolve_coverage_gaps_from_state(state)
        gate = evaluate_coverage_gate(state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            state = save_session(state)
        elif not picks:
            state.runtimePhase = "awaiting"
            state.awaitReason = "convergence"
            state.awaitDetail = "no selected capabilities; converged (pick returned empty)"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting (convergence)", order=10)
            state = save_session(state)
        else:
            state.runtimePhase = "awaiting"
            state.awaitReason = "user_input"
            state.awaitDetail = "awaiting further input or coverage"
            append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text="phase_changed: awaiting", order=10)
            state = save_session(state)
    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=turn_id, capabilityRunId=f"phase-{turn_id}", capabilityId="driver", kind="think", text=f"phase_changed: failed - {str(exc)[:60]}", order=10)
        state = save_session(state)
    final = save_session(state)
    return final



# ── 回合机制在 engine_scheduling，不在这里 ──────────────────────────────────
#
# ⚠ 2026-08-29：这 5 个名字曾经**定义**在本文件里（连同另外 15 个，共 541 行），
#   而它们是引擎的东西——`v5_full_driver` 为了拿它们，反过来 import 了驱动组的
#   这个文件，那是全仓最后一个组间环（model_core → drive）。已拆去
#   `engine_scheduling`，见那个文件的模块头。
#
#   这里保留顶层 import 有两个实打实的理由，都不是"为了兼容"：
#   ① `drive_reasoning_turn`（本文件，177 行的单轮驱动）真的要用这 5 个；
#   ② 顶层 import 让它们仍是本模块的属性，既有判据
#      （`test_session_persistence_contract.py` 用
#      `monkeypatch.setattr("services.slide_rule_session.pick_next_capabilities", …)`）
#      照样拦得住。改成函数体内 import 会让那个 patch 静默落空——**不是报错，
#      是打到真的排程逻辑上**，正是 §16.6 记过的那种坏法。
#
#   ⚠ 只许是这 5 个（`drive_reasoning_turn` 用到的）。想再加一个，先问那个
#   调用方是不是也该搬去 engine_scheduling——本文件是**会话存储**，
#   不是引擎的门面。`tests/test_engine_session_boundary.py` 钉着这条。
from .engine_scheduling import (
    append_reasoning_event,
    append_replay_event,
    commit_artifact,
    pick_next_capabilities,
    record_capability_run_error,
)
