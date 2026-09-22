"""薄控制面（M1 合同）。点火插座是信封 helper，不是裸生成器。

⚠ 2026-08-27 PR-4：写进模块头的是合同，不是「这个文件做什么」。缺任何一条
= 这个 PR 失败。实现必须能被变异咬住（删 helper 调用点 → 测试红）。

1. Route POST /api/sliderule/control-turn-stream, _require_login. No Node twin.
2. SSE: control_text, control_tool_start, control_tool_result, control_ask_user,
   control_plan_approval, control_handoff_factory (with runId), complete.
   Legacy consumers own their generator. Internal durable consumers delegate
   ownership to control_run_service; SSE only subscribes to persisted events.
   Handoff starts the factory run; its restart recovery remains separate.
3. Parking: awaitReason MUST be control_ask / control_plan_approval.
   controlTranscript is a schema field. Tool loop MUST NOT spin waiting for
   the user in the same HTTP request. The *next* POST is a NeedUserAnswer
   reply (kind=user_answer), not a new HumanIntent turn.
4. Cheap turns write only controlTranscript. FORBIDDEN to append
   greetings/inspect/search into conversation.
5. inspect_model bounded digest (≤40 items / ≤4k chars), never raw five-system
   JSON; missing → fail-open empty digest + one human sentence.
6. Hard caps: 8 tool rounds, 8k cheap tokens, 45s wall clock before ignition.
   Over cap → control_text 「停在控制面，未点火」+ complete, helper = 0.
   Authorized project work uses a separate persisted control_budget policy;
   this pre-ignition contract is not the project execution budget.
7. Failure → canned reply 「我是面团的推演引擎。说一个要做的应用，或问当前应用里已经推出来的角色/页面。」
   FORBIDDEN open chat without tools. FORBIDDEN helper/generator.
   FORBIDDEN driveReasoningSession.
8. Ignition socket = envelope helper, not bare generator. Named fields.
   Product missing session_id → 400 (no anon-).
9. Every product POST (including greetings) MUST carry the six fields.
   FORBIDDEN {forcedTool, goal} only.
10. After plan approval, forcedTool rehearse skips LLM before factory.
    Before approval, /推演 and expensive tools stay in planning. /精修 = refine.
    补齐缺口 = repair. 质疑 = challenge (invalidate once, no helper).
11. WRITE (rehearse/refine/repair) does NOT exit the tool loop — LLM-picked
    or forced. Factory complete is nested (`factory_complete`); control yields
    control_tool_result and keeps picking. Forced buttons still skip LLM
    before ignition; after factory they rejoin the host loop.

Closed tool table: ask_user_question, search_evidence, inspect_model,
enter_plan_mode, write_plan, exit_plan_mode,
rehearse, workflow, spec, pages, structure, bind, closure, refine, challenge,
repair, restore_version, fork_variant.
LLM cannot invent tools. No tool may write blocked=false.

Q1=A：tools 只活在 control_client；factory sliderule_llm/client.py 不得长
tools 字段。rehearse/refine/repair 只调 start_drive_full_factory_run。
FORBIDDEN: `async for drive_full_v5_session_stream`。
refine 走生成器 refine-context（v5_full_driver wants_refine /
set_refine_context）；FORBIDDEN 把 v5_capability_executor 当入口 import。
未批准计划 + forcedTool rehearse → 继续规划，helper calls = 0。
"""

from __future__ import annotations

import copy
import asyncio
import inspect
import json
import re
import time
import uuid
from contextlib import aclosing, contextmanager, nullcontext
from contextvars import ContextVar
from enum import Enum
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional

from services.factory_plan_steps import product_steps_for_tools
from services.capability_plan import (
    factory_todo_open,
    TOOL_LABELS,
    first_pass_tools,
    is_first_pass_chain,
    merge_factory_todo,
)

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from models.v5_state import CoverageGap, UserIntervention, V5SessionState
from services.archetype_legal import (
    DEFAULT_ARCHETYPE,
    ArchetypeNotWired,
    UnknownArchetype,
    is_wired,
    resolve as resolve_archetype,
    valid_judge_devices,
    wired_archetype_choices,
    wired_device_choices,
)
from services.user_questions import (
    coerce_questions as coerce_user_questions,
    format_accepted as format_answers_for_model,
    format_chat_about_this as format_chat_answers,
    format_skip_interview as format_skip_answers,
    normalize_answers as normalize_user_answers,
    unanswered_text as unanswered_question_text,
)
from services.action_stationarity import (IdenticalToolCallRun, ReadOnlyStreak,
    StagnantCallLedger, call_signature, result_fingerprint, step_signature, step_tool_name)
from services.control_checkpoint import current_checkpoint, guard_control_run, owned_model_sample, ControlRunStopped
from services.control_budget import (
    ControlBudget,
    CONVERSATION_BUDGET,
    PROJECT_BUDGET,
    restore_budget,
)
from services.control_context_compact import (
    compact_messages,
    estimate_message_tokens,
    microcompact_messages,
)
from services.model_memory import (
    recall as recall_memory,
    remember as remember_memory,
    summarize as summarize_memory,
)
from services.hook_events import (
    HookDecision,
    HookEvent,
    dispatch as dispatch_hook,
)
from services.hop_requirements import (
    HOP_REQUIRES,
    Need,
    blocker_text as hop_blocker_text,
    satisfied as hop_satisfied,
)
from services.plan_todo import (
    MAX_TODO_ITEMS,
    apply as apply_todo,
    normalize as normalize_todo,
    one_line as todo_one_line,
    summarize as summarize_todo,
)
from services.done_claim import (
    BLOCKED_REASON_SCHEMA,
    COMPLETED_SCHEMA,
    DONE_CLAIM_MAX_RUNS,
    MESSAGE_SCHEMA,
    DoneVerdict,
    judge as judge_done_claim,
    verdict_text,
)
from services.closure_block_reason import user_report as closure_user_report
from services.closed_tools import (
    CLOSED_TOOLS,
    FACTORY_HOPS,
    closed_tool_from_text,
    factory_hop_from_text,
    TOOL_SCOPE,
    ToolScope,
    ToolScopeViolation,
    resolve_tool_scope,
)
from services.control_skills import (
    SkillInfo,
    invoke_skill,
    mentioned_skill_playbooks,
    mentioned_skill_slugs,
    normalize_skill_name,
    skill_tool_description,
)
from services.deliverable_kind import (
    DELIVERABLE_KINDS,
    OFFICE_FILE,
    normalize_deliverable_kind,
    orch_trace,
    plan_deliverable_kind,
)
from services.skill_catalog_store import (
    OFFICE_SKILL_CATEGORY,
    installed_skill_infos,
    local_seed_skill_info,
    skill_seed_category,
)
from services.drive_full_factory import start_drive_full_factory_run
from services.project_authority import approved_reference
from services.project_tool_contracts import (PROJECT_ALIAS_TOOLS, PROJECT_READ_MAX_RESULT_CHARS,
    PROJECT_TOOLS, PROJECT_TOOL_NAMES, PROJECT_WRITE_TOOLS,
    SHELL_EXEC_FOREGROUND_BLOCK_SECONDS, SHELL_EXEC_MAX_FOREGROUND_SECONDS)
from services.project_tool_summary import project_tool_summary
from services.project_tools import command_receipt_from
from services.workflow_registry import workflow_for, workflow_names
from services.workflow_select import select_workflow
from services.scope_authority import (
    latest_control_plan,
    plan_execution_authorized,
    preferred_device_for_run,
)
from services.slide_rule_interactive_gates import (
    apply_user_intervention_invalidation,
    resolve_readiness_gaps_by_ids,
)
from services.slide_rule_session import load_session, save_session
from services.control_transcript_log import tool_start_event, tool_transcript_entry
from services.turn_narration import deliverable_fingerprint as factory_deliverable_fingerprint  # 叙述/回执同一把尺子
from services.llm_error_text import humanize_llm_error
from sliderule_llm.client import LlmError
from sliderule_llm.control_client import ControlLlmResult, call_control_llm
from sliderule_llm.retry_budget import retry_budget_scope, current_budget, RetryBudget

CANNED_FAILURE = (
    "我是面团的推演引擎。说一个要做的应用，或问当前应用里已经推出来的角色/页面。"
)
#: 廉价回执后模型空回复。不许套开场罐头。
#: ⚠ 2026-09-08 真机：点问候芯片「继续」，empty_text=CANNED_FAILURE，
#:   左栏写出「我是面团的推演引擎。说一个要做的应用」——像没听见。
CHEAP_TURN_FALLBACK = "想做什么应用，说一句就行。"
#: 工厂已经出过页面，交回控制面时模型空回复不许套开场罐头。
POST_WRITE_FALLBACK = "页面已经出来。要改哪一页，或者说继续精修、补齐缺口。"
#: spec 单跳交回、端给人的话。页面还没有。不许说页面出来了，也不许下命令。
POST_SPEC_USER = "规格已经记下。要继续画页面，或者说想先改哪一点。"
#: 假设卡摊着：卡自己会说话，这里只补一句人话。
ASSUMPTIONS_WAIT_USER = "规格里有几条假设要你先拍板，确认后继续画页面。"
#: 兼容旧名：曾经误把 reminder 当用户可见 empty_text。
POST_SPEC_HOP_FALLBACK = POST_SPEC_USER

# ── 控制面为什么停下来：是数据，不是一句话 ────────────────────────────────
#
# 抄的标准答案：grok-build `xai-grok-hooks/src/event.rs`
#
#     pub enum StopCancelledReason {
#         UserInterrupt, PermissionRejected, PermissionCancelled,
#         MaxTurns, NoProgress,
#         /// A cancel the runtime could not classify. New causes land here
#         /// until they get a name.
#         Unknown,
#     }
#
#     /// Derived from `reason` and shipped anyway, so hosts do not re-derive
#     /// it as reasons are added.
#     pub enum CancelledBy { User, Runtime, Unknown }
#
# 以及 `xai-tool-protocol/src/turn_hook.rs`：停的时候把**限额本身**一起带上
#
#     /// Opaque JSON mirror … (e.g. `{ "reason": "max_turns_reached", "limit": 50 }`)
#     pub cancellation_context: Option<serde_json::Value>,
#
# ⚠ 2026-08-27 复审逮到：本仓四个不同的终止点塌成**同一句话**——
#     45 秒墙钟到了           → "停在控制面，未火"
#     8k token 烧完了         → 同一句
#     8 轮工具还没收敛        → 同一句
#     控制面 LLM 挂了/我们自己抛异常 → 另一句罐头
#   而事件里 `{"type": "control_text", "text": …}` 一个结构化字段都没有
#   （探针实测：stopReason / stoppedBy 在全文件出现 0 次）。
#
#   后果跟 closure_block_reason 治的那个是同一个病，只是搬到了控制面：
#   前端看到的是一条普通助手消息，分不清「模型在绕圈」（产品 bug，该查提示词）
#   和「网关挂了」（运维问题，该看日志）。用户看到的也是同一句，不知道再点
#   一次有没有用——墙钟/额度到了再点一次可能就过了，绕圈再点一百次还是绕圈。


class ControlStopReason(str, Enum):
    """控制面这一回合为什么没跑完。可穷举、每个都对应一句能据以行动的话。"""

    #: 点火前墙钟到顶（MAX_WALL_SECONDS）。
    WALL_CLOCK = "wall_clock"
    #: 便宜轮 token 预算烧完（MAX_CHEAP_TOKENS）。
    TOKEN_BUDGET = "token_budget"
    #: 工具轮次到顶还没收敛（MAX_TOOL_ROUNDS）。抄 grok 的 MaxTurns。
    TOOL_ROUNDS = "tool_rounds"
    #: 同一件工具、同一份实参连着调，捅过一次仍不改。抄 grok 的
    #: `TurnOutcome::StationarityEnded`。**跟 TOOL_ROUNDS 是两码事**：
    #: 「想了 8 轮没定下来」是在往前走但走不到头，「同一件事干了 4 遍」
    #: 是根本没在走。塌成同一句话，前端和日志就都看不出哪种。
    STATIONARITY = "stationarity"
    #: 控制面模型/网关不可用，或分发器自己抛了。
    LLM_UNAVAILABLE = "llm_unavailable"
    #: 归不了类的。**新原因先落这儿，直到有人给它起名字**——抄 grok 的
    #: Unknown 那句注释。绝不构造成上面任何一种。
    UNKNOWN = "unknown"


class StoppedBy(str, Enum):
    """谁把它停下来的。由 reason 推导，但**照样上线**——抄 CancelledBy 那句
    "shipped anyway, so hosts do not re-derive it as reasons are added"：
    前端不该自己维护一份 reason → 归属的映射，新增原因时那份必然漂。"""

    #: 我们自己的闸（墙钟/额度/轮次）。再点一次可能有用。
    RUNTIME = "runtime"
    #: 模型或网关。跟用户说的话不一样——不是他做错了什么。
    PROVIDER = "provider"
    UNKNOWN = "unknown"


#: 「收到了但没点火」那半句。供应商失败时前半句要换成真实错误（522 不许
#: 说成「连不上」），后半句必须还是这一份——写第二遍就是 CLAUDE.md §4 那张
#: 表：两处措辞，改一处不报错、只有一半生效。
_STOP_TAIL_RECEIVED = (
    "你说的我收到了，先停在控制面没点火。"
    "稍等再说一次，或者直接点「开始推演」。"
)

#: reason → (谁停的, 给用户的那句话)。**唯一渲染处**（同 closure_block_reason
#: 那条纪律）。想在别处再拼一句"停在控制面"，先回来看这张表。
_STOP_TABLE: Dict[ControlStopReason, tuple] = {
    ControlStopReason.WALL_CLOCK: (
        StoppedBy.RUNTIME,
        "这一轮想得太久，先停在控制面没点火。再说一次或者直接点「开始推演」。",
    ),
    ControlStopReason.TOKEN_BUDGET: (
        StoppedBy.RUNTIME,
        "这一轮的思考额度用完了，先停在控制面没点火。再说一次或者直接点「开始推演」。",
    ),
    ControlStopReason.TOOL_ROUNDS: (
        StoppedBy.RUNTIME,
        "来回想了好几轮还没定下来，先停在控制面没点火。把需求说具体一点，"
        "或者直接点「开始推演」。",
    ),
    # ⚠ 这句话故意**不说**「想得太久」「说具体一点」——那是 TOOL_ROUNDS 的实话，
    #   不是这一种的。这一种是模型自己卡在同一次调用上，跟用户把话说得清不清楚
    #   没关系，让用户去「说具体一点」是又一次甩锅（见下面 LLM_UNAVAILABLE
    #   那段 2026-09-05 的事故记录，同一个病）。
    ControlStopReason.STATIONARITY: (
        StoppedBy.RUNTIME,
        "我在同一步上打转了，先停下没点火。再说一次，或者直接点「开始推演」。",
    ),
    # ⚠ 2026-09-05 真机第 5 轮（汉字消除小游戏 sr-20260904220902）：
    #   用户把话说得清清楚楚——「做一个网页端的汉字连线消除小游戏：网格里随机
    #   布字…限时通关并记录最高分与连击数」——网关这会儿连不上，回过去的却是
    #   开场罐头「我是面团的推演引擎。**说一个要做的应用**…」。
    #
    #   用户只会读出一个意思：你没听懂我。于是他重说一遍、再重说一遍——
    #   而真正的原因（网关不可用）系统自己**知道**，`StoppedBy.PROVIDER`
    #   就在同一行里，只是没说出口。
    #
    #   这跟今晚另外两条是同一个病：闭环没过却说「已完成」、待办没清却说
    #   「页面已经出来」。**机器知道的事实，说话的那一版不知道。**
    #   上面另外四种停因早就各有各的实话（"想得太久"、"额度用完了"），
    #   唯独这一种在甩锅给用户。
    ControlStopReason.LLM_UNAVAILABLE: (
        StoppedBy.PROVIDER,
        "模型网关这会儿连不上，" + _STOP_TAIL_RECEIVED,
    ),
    ControlStopReason.UNKNOWN: (
        StoppedBy.UNKNOWN,
        "这一轮没跑完，先停在控制面没点火。再说一次试试。",
    ),
}


def stop_wire(
    reason: ControlStopReason,
    *,
    limit: Any = None,
    used: Any = None,
) -> Dict[str, Any]:
    """停下来这件事的**结构化部分**，挂在 control_text 事件上。

    带 limit / used 是抄 turn_hook 的 cancellation_context
    （`{"reason": "max_turns_reached", "limit": 50}`）：光说"到顶了"没法行动，
    说"8 轮到顶"才知道是不是该调这个数。
    """
    stopped_by, _text = _STOP_TABLE[reason]
    out: Dict[str, Any] = {"stopReason": reason.value, "stoppedBy": stopped_by.value}
    if limit is not None:
        out["limit"] = limit
    if used is not None:
        out["used"] = used
    return out


def stop_text(reason: ControlStopReason) -> str:
    """**唯一**把停止原因变成人话的地方。"""
    return _STOP_TABLE[reason][1]


def _provider_failure_text(exc: BaseException, state: V5SessionState | None = None) -> str:
    """网关/模型失败的人话。机器知道 522，就说 522，不许一律「连不上」。

    ⚠ 2026-09-08：`.env` 网关直连 200，控制面每句却端「模型网关这会儿
      连不上」。真因是 Cloudflare 522（Clash 系统代理），被
      `except Exception → LLM_UNAVAILABLE` 盖成同一句。用户只会读成
      网关坏了，于是换 key、换供应商——都不是病。
    """
    is_project = getattr(state, "runtimeKind", None) == "project"
    if getattr(exc, "finish_reason", None) == "content_filter":
        detail = "模型服务返回内容过滤（content_filter），本轮已停止，未自动重试。"
        return detail + ("已保存的工程源码仍保留；远端任务需要继续查询状态或明确停止。" if is_project else "")
    detail = humanize_llm_error(str(exc) or "").strip()
    if is_project:
        return (detail or "模型调用未完成。") + " 本轮工程任务已停止；已保存的源码仍保留，远端任务需要继续查询状态或明确停止。"
    if not detail:
        return stop_text(ControlStopReason.LLM_UNAVAILABLE)
    # 只换前半句（真实错误），后半句取那一份 —— 不在这里再拼一遍。
    return f"{detail} {_STOP_TAIL_RECEIVED}"

CONTROL_SIX_FIELDS = (
    "sessionId",
    "userText",
    "installedSkills",
    "activeConnectors",
    "preferredDevice",
    "designSystemId",
)

# 控制面本回合信封。_handoff_factory 在 persist-as-authority 之后再读，
# 把 reuse_charter / product_charter 交给工厂命名字段——asyncio.create_task
# 复制 ContextVar 救不了「脚本直打 /drive-full-stream」那条。
_CONTROL_PAYLOAD: ContextVar[Dict[str, Any]] = ContextVar(
    "sliderule_control_payload", default={}
)

# 词表在 services.closed_tools（叶子，对齐 xai-tool-types）。
# 本回合正在分发的工具名。走 ContextVar 而不是给 `_handoff_factory` 加参数：
# 跟本文件里 `_CONTROL_PAYLOAD` / 读 charter 同一套机制（本回合信封），
# 也逼着判据打在真分发上而不是直调函数。
#
# 缺省空串 → resolve_tool_scope 给 READ → 没进过分发就直调工厂会被拦。
_ACTIVE_TOOL: ContextVar[str] = ContextVar("sliderule_active_tool", default="")
_PROJECT_TOOLS: ContextVar[Any] = ContextVar("sliderule_project_tools", default=None)


def _project_tool_error(name, state):
    if getattr(state, "runtimeKind", None) == "project":
        if resolve_tool_scope(name) == ToolScope.WRITE:
            return "project_html_factory_not_supported"
        if name == "report_done":
            return "project_verification_not_available"
    if name in PROJECT_TOOL_NAMES:
        if _PROJECT_TOOLS.get() is None:
            return "project_tools_not_enabled"
        if name in PROJECT_WRITE_TOOLS and not plan_execution_authorized(state):
            return "project_plan_approval_required"
    return None


_SHELL_LIVE_TOOLS = frozenset({"shell_exec", "bash"})


def _execute_project_tool(adapter, name, args, state):
    """前台 shell 先 enqueue。id 出去之后分发处再堵，模型仍等到终态。

    ⚠ 2026-09-19：execute 默认在线程里等到 exit 才返回。开场那发
    control_tool_start 没有 operationId，补 id 的那发要等命令结束——
    进行中右侧订不到 PTY，npm test 整段白纸。不是 SSE 假流，是 id 来晚了。
    """
    fn = adapter.execute
    kwargs: Dict[str, Any] = {}
    if name in _SHELL_LIVE_TOOLS and not (
        isinstance(args, dict) and args.get("is_background")
    ):
        try:
            if "wait" in inspect.signature(fn).parameters:
                kwargs["wait"] = False
        except (TypeError, ValueError):
            pass
    return fn(name, args, state, **kwargs)


def _project_tool_wait_seconds(name: str, args: Any, body: Any) -> float:
    if not isinstance(body, dict) or body.get("status") in {
        "completed",
        "failed",
        "cancelled",
    }:
        return 0.0
    if name in _SHELL_LIVE_TOOLS and not (
        isinstance(args, dict) and args.get("is_background")
    ):
        raw = args.get("timeout") if isinstance(args, dict) else None
        try:
            wait = (
                float(raw)
                if raw is not None
                else SHELL_EXEC_FOREGROUND_BLOCK_SECONDS
            )
        except (TypeError, ValueError):
            wait = SHELL_EXEC_FOREGROUND_BLOCK_SECONDS
        return min(max(wait, 0.0), SHELL_EXEC_MAX_FOREGROUND_SECONDS)
    return 15.0


@contextmanager
def tool_scope_scope(name: str):
    """标记本回合正在分发哪个工具。两条分发路径都要用（成对，少一条 = 半个闸）。"""
    token = _ACTIVE_TOOL.set(str(name or ""))
    try:
        yield
    finally:
        _ACTIVE_TOOL.reset(token)


def assert_may_write_model() -> None:
    """工厂信封入口闸。READ 工具到这里就是**违约**，抛出来，别静静放行。

    对照 grok：写工具由 computer hub 路由给 leader agent，缺省 Read 的
    根本到不了那条路。这里没有多 agent 路由，等价物就是这道断言。
    """
    name = _ACTIVE_TOOL.get()
    if resolve_tool_scope(name) is not ToolScope.WRITE:
        raise ToolScopeViolation(
            f"工具 {name or '(未声明)'} 是 READ 权限，不能进工厂信封生成新五系统模型。"
            "要写请在 TOOL_SCOPE 里显式声明 WRITE——缺省只读是故意的。"
        )


def _has_model(state: V5SessionState) -> bool:
    """这个会话里已经有一份可精修 / 可分叉 / 可回退的模型吗。"""
    return bool(getattr(state, "modelVersions", None) or [])


def _set_goal_tools(
    goal: Dict[str, Any], tools: Iterable[str], *, refine: bool
) -> Dict[str, Any]:
    """写本轮工厂菜单，**顺带把钟该亮哪几格一起算出来**。

    ⚠ 2026-09-02：这两件事必须在同一个函数里落，别再分开写。前端原本自带一张
    `PUBLIC_TOOL_TO_STEP`，跟账本对不上（`bind` 写 5、账本是 6；`closure` 写 6
    而账本里没有 closure 阶段），`semantics`(5) 整格漏掉——典型的「同一件事两处
    实现，改一条不改另一条」。现在步集由账本算、随 goal 下发，前端不许再有表。

    三个写入点（按钮点火 / 单跳 / workflow 减菜）都走这里：少一处，那条路径的
    钟面就会静静地按上一轮的步集画。
    """
    chosen = [str(item or "").strip() for item in (tools or ()) if str(item or "").strip()]
    goal["tools"] = chosen
    goal["productSteps"] = product_steps_for_tools(chosen, refine=refine)
    return goal


def _spec_first_blob(state: V5SessionState) -> Dict[str, Any]:
    blob = getattr(state, "specFirstPages", None)
    return blob if isinstance(blob, dict) else {}


def _has_spec(state: V5SessionState) -> bool:
    spec = _spec_first_blob(state).get("spec")
    if not isinstance(spec, dict):
        return False
    return bool(spec.get("pages") or spec.get("nodes") or spec.get("appName"))


def _has_pages(state: V5SessionState) -> bool:
    pages = _spec_first_blob(state).get("pages")
    return isinstance(pages, dict) and bool(pages)


def _bind_account(
    state: V5SessionState,
) -> tuple:
    """(bound_ids, failed_ids, skipped_ids)。没有账就是三个空表。"""
    blob = _spec_first_blob(state)
    status = (
        blob.get("pageBindStatus")
        if isinstance(blob.get("pageBindStatus"), dict)
        else {}
    )
    bound: List[str] = []
    failed: List[str] = []
    skipped: List[str] = []
    for key, value in status.items():
        mark = str(value)
        pid = str(key)
        if mark == "bound":
            bound.append(pid)
        elif mark == "failed":
            failed.append(pid)
        elif mark == "skipped":
            skipped.append(pid)
    return bound, failed, skipped


def _delivery_speech(state: V5SessionState) -> str:
    """页面已经出来之后给人看的话。打孔失败必须说，不许装已经接好。

    ⚠ 2026-09-09 真机 sr-20260909041801：p1/p2 failed、p3 bound，
      收尾仍是「页面已经出来…继续精修」。闭环 blocked=false 也没提失败页。
    """
    bound, failed, skipped = _bind_account(state)
    if failed:
        names = "、".join(failed[:6])
        extra = f"另有 {len(skipped)} 页 skipped。" if skipped else ""
        return (
            f"页面已经出来，但 {names} 权限没接上（failed）。"
            f"{extra}不能说已经全部闭环。"
        )
    if not bound and skipped:
        return (
            f"页面已经出来，权限打孔 {len(skipped)} 页 skipped。"
            "不能当成已经接好，更不能说闭环完成。"
        )
    return POST_WRITE_FALLBACK


def _cap_speech(state: V5SessionState, reason: ControlStopReason) -> str:
    """额度 / 轮次 / 墙钟到顶时的人话。

    ⚠ 2026-09-09 真机 sr-20260909032509（擎盾权限云）：工厂已经跑完
      spec → pages → structure → bind，闭环也过了，收尾却端
      「这一轮的思考额度用完了，先停在控制面没点火」。
      用户读成完工台词，而且是假的——火已经点过。

    额度到顶是运行时闸，不是交付状态。工厂出过货，说话必须说货；
    没出过货才许说「没点火」。fail-closed：没有 SPEC、没有页面，
    仍走停因表那句罐头。
    """
    if getattr(state, "runtimeKind", None) == "project":
        detail = {
            ControlStopReason.WALL_CLOCK: "本轮工程任务达到时间上限。",
            ControlStopReason.TOKEN_BUDGET: "本轮工程任务的模型调用额度已用完。",
            ControlStopReason.TOOL_ROUNDS: "本轮工程任务达到工具轮次上限。",
            ControlStopReason.STATIONARITY: "模型重复执行同一步，本轮工程任务已暂停。",
        }.get(reason, "本轮工程任务未完成。")
        return (
            detail
            + "已保存的源码仍保留。再说一次即可继续；远端未完成的任务也可以明确停止。"
        )
    if _has_pages(state):
        return _delivery_speech(state)
    if _has_spec(state):
        return POST_SPEC_USER
    # ⚠ 2026-09-14 真机 sr-20260914171745-3PCJ39MFGV：write_plan 已经落了
    #   中文实施计划，下一发采样才对上 token_budget 12458/8000。exit_plan_mode
    #   没发出去，收尾却端「思考额度用完了，先停在控制面没点火」。
    #   机器知道计划在，说话的那一版不知道——跟上面 09-09 工厂出过货还说
    #   没点火是同一个病。计划写好了就说计划，不许再让用户「再说一次」。
    if _unapproved_plan_ready(state):
        return "实施计划已经写好。确认之后才会开工。"
    return stop_text(reason)


def _unapproved_plan_ready(state: V5SessionState) -> bool:
    """计划已经落库、还没批准。额度闸到顶时要停在批准卡，不是「没点火」。

    缺 planId / revision 的旧行不够停靠批准卡（`_park_plan_approval` 要
    拿这两把钥匙对账），退回罐头停因，不许 KeyError 把这一轮打成 500。
    """
    plan = latest_control_plan(state)
    if (
        not str(plan.get("planContent") or "").strip()
        or not str(plan.get("planId") or "").strip()
        or not isinstance(plan.get("revision"), int)
        or plan["revision"] < 1
    ):
        return False
    return not plan_execution_authorized(state)


def _task_text_for_recall(state: V5SessionState) -> str:
    """当前任务文本。goal 空就退到本轮信封 / 最近一句用户话。"""
    goal = state.goal if isinstance(getattr(state, "goal", None), dict) else {}
    text = str(goal.get("text") or "").strip()
    if text:
        return text
    payload = _CONTROL_PAYLOAD.get() or {}
    for key in ("sessionGoal", "userText"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if isinstance(row, dict) and row.get("kind") == "turn":
            value = str(row.get("text") or "").strip()
            if value:
                return value
    return ""


def _recall_belongs_to_task(query: str, note: str) -> bool:
    """空查询按目标滤时，2 字滑窗太松。要 3 字中文或长度≥3 的词。"""
    q = str(query or "")
    text = str(note or "")
    if not q or not text:
        return False
    terms: list[str] = [w.lower() for w in q.split() if len(w) >= 3 and w.isascii()]
    cjk = "".join(ch for ch in q if "一" <= ch <= "鿿")
    terms.extend(cjk[i : i + 3] for i in range(max(0, len(cjk) - 2)))
    if not terms:
        return False
    blob = text.lower()
    return any((t in blob) if t.isascii() else (t in text) for t in terms)


def _skills_loaded_this_turn(state: V5SessionState) -> set[str]:
    """本回合已经成功加载过的技能 slug。

    ⚠ 2026-09-21 sr-20260921150545-6QG1GNGP1P：office-skills 加载成功后
      压缩桩让模型再调一遍，同一回合第三发 skill() 时生产者崩了。
      只数「上一句用户话之后、已经有成功 tool_result」的，正在飞的
      这一发 start 不算。
    """
    loaded: set[str] = set()
    pending = ""
    for row in getattr(state, "controlTranscript", None) or []:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "")
        if kind in {"turn", "user_answer", "plan_approved"}:
            loaded = set()
            pending = ""
            continue
        if kind == "tool_start" and row.get("tool") == "skill":
            pending = normalize_skill_name(str(row.get("summary") or ""))
            continue
        if kind == "tool_result" and row.get("tool") == "skill":
            slug = pending
            pending = ""
            if slug and row.get("ok") is not False:
                loaded.add(slug)
    return loaded


def _memory_scope_id(state: V5SessionState) -> str:
    """记忆挂在**账号**上，不是会话上——跨会话活着才是它的意义。

    ⚠ 用 ownerId：那是服务端拥有的归属字段（客户端 PUT 一律不许带，
      见 routes/sliderule_full.py 那段 2026-08-09 的事故记录）。
      拿 sessionId 当键就退化成"会话内记忆"，跟直接写 transcript 没区别。
    """
    return str(getattr(state, "ownerId", "") or "").strip()


def _session_has(state: V5SessionState) -> Any:
    """把「这个会话手上有什么」包成 `hop_requirements` 要的那个闭包。

    抄 grok `Expr::eval(&|req| req.eval(&ctx))`——叶子怎么判由调用方给，
    表达式树本身不认识 state（所以它能是叶子模块）。
    """

    def have(need: Need) -> bool:
        if need is Need.PLAN:
            return plan_execution_authorized(state)
        if need is Need.SPEC:
            return _has_spec(state)
        if need is Need.PAGES:
            return _has_pages(state)
        if need is Need.MODEL:
            return _has_model(state)
        return False

    return have


def _factory_hop_blocker(state: V5SessionState, hop: str) -> str:
    """缺前置就说人话，不许进工厂空转。

    ⚠ 2026-09-09：这里原来是一段手写 if 链，而**同一条规则在
      `TOOL_LIST_WHEN` 里还写了一遍**（形式还不一样：那边是 lambda）。
      改一处不报错，只有一半生效：
        只改清单 → 模型看不见它，但 forcedTool 直接点进去照跑
        只改这里 → 摆在菜单上，点了当场被拒（用户眼里就是「按钮坏了」）
      现在两处都从 `HOP_REQUIRES` 那一份声明派生，判据钉着两者必须一致。
    """
    return hop_blocker_text(hop, _session_has(state))


def _has_inspectable(state: V5SessionState) -> bool:
    """有没有东西可给 inspect_model 看。

    ⚠ 口径**照抄 `_inspect_digest` 自己读的两个来源**（publishClosure 优先、
      再退到 modelVersions），不写成 `_has_model`。写成 _has_model 会在
      「有闭环产物、还没落版本」的会话上把 inspect_model 裁掉——那正是
      CLAUDE.md §4 说的「同一件事两处实现，口径一歪就半边不生效」。
    """
    if getattr(state, "publishClosure", None):
        return True
    return _has_model(state)


def _has_product_topic(state: V5SessionState) -> bool:
    """goal 里已经记下的产品。问候 / 你能做啥 不会写进 goal。

    当前这句话像不像产品，见 `_unstamped_product_turn`：真机水果店第一句
    还没 stamp 就得能开复述卡，但 hello 仍不许当产品。
    """
    g = _goal_text(state)
    if not g or g.startswith("（尚无"):
        return False
    return not _is_exact_filler(g)


def _cjk_len(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text or ""))


#: 拉丁侧的元问句开头。跟中文侧那几个（你是谁 / 你能做）同一类，
#: **不是问候表**——问候靠下面的结构判据挡，不靠列举。
_LATIN_META_PREFIX = (
    "what can you",
    "what do you",
    "what are you",
    "who are you",
    "how do you",
    "can you tell",
)


def _latin_is_cheap(text: str) -> bool:
    """拉丁文本是不是闲聊。**结构判据，不列问候表**。

    中文那条是「剥掉确认词还剩 ≥4 个汉字」；拉丁这条是「≥3 个词且 ≥10 个字符」，
    再加元问句开头。两边同一个形状，都不去枚举用户会说什么。

        hello / hhh / sfljsdlf   1 个词        → 闲聊
        ok thanks                2 个词        → 闲聊
        what can you do          元问开头      → 闲聊
        build a CRM              3 词 11 字符  → 需求
        Build a small inventory tracker …      → 需求

    ⚠ 已知漏网：`hi there ok` 这类三词寒暄会被当成需求。中文侧有同样的漏网
      （「今天天气真好啊」七个汉字也会过），这是同一种取舍——宁可漏一句闲聊，
      不要靠枚举问候语去猜产品（`test_product_gate_does_not_enumerate_what_people_say`
      钉的就是这条）。真正兜住它的是回执那道闸：乱码/闲聊回执不点火。
    """
    low = text.strip().lower()
    if low.startswith(_LATIN_META_PREFIX):
        return True
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", low)
    return len(words) < 3 or len(low) < 10


def _is_cheap_chat(text: str) -> bool:
    """问候 / 能力问答 / 确认词。不是产品。

    抄 grok：AskUserQuestion 是债务，不是开工考卷。hello / 你能做啥
    仍走提问；「做个水果店收银台」不是廉价闲聊。
    不写问候表猜产品——只排除确认词、拉丁短句、以「你是/你能」开头的元问。
    """
    raw = (text or "").strip()
    if not raw or _is_exact_filler(raw) or _is_content_free_reply(raw):
        return True
    compact = re.sub(r"[\s，,。.！!？?、]+", "", raw)
    if compact.startswith(("你是谁", "你能做", "你会做", "你是")):
        return True
    if _cjk_len(raw) == 0:
        # ⚠ 2026-09-09 真机：这里原来是「没有中文字符 → 一律闲聊」。注释写的
        #   意图是排掉拉丁短句（hello / hhh / sfljsdlf），但它把**所有英文需求**
        #   一起排掉了——"Build a small inventory tracker for a coffee shop"
        #   进不了环，控制面反过来问一句，英文用户永远开不了工。
        #
        #   改成跟中文那条同形状：中文是「剥掉确认词还剩 ≥4 个汉字」，
        #   拉丁就是「剥掉寒暄/元问词还剩 ≥2 个实词」。
        return _latin_is_cheap(raw)
    # 「继续执行」剥掉确认词只剩「执行」——不是产品。真产品剥完还剩四个字以上
    # （请假系统 / 做个水果店收银台）。
    leftover = compact.lower()
    for token in sorted(_FILLER_TOKENS, key=len, reverse=True):
        leftover = leftover.replace(token, "")
    cjk = _cjk_len(leftover)
    if cjk >= 4:
        return False
    # ⚠ 2026-09-18 真机 sr-20260918103119-06YZQ65BJE：用户说「做一个todo list」。
    #   上一版只数汉字，3 个 < 4 就当闲聊。goal 还是空的，`_unstamped_product_turn`
    #   也交不出这句话，分发器把模型已经拟好的功能选项整表换成 []。
    #   落盘 questions[0].options == []，卡上只剩前端自动补的「其他（自己写）」。
    #   中英夹杂时拉丁半边也算数——不能复用 `_latin_is_cheap`：那条要 3 个英文
    #   词，「todo list」两个词仍会输。
    letters = len(re.findall(r"[0-9A-Za-z]", leftover))
    words = re.findall(r"[A-Za-z][A-Za-z0-9'-]*", leftover)
    if cjk >= 1 and (letters >= 3 or len(words) >= 2):
        return False
    return True


def _unstamped_product_turn(state: V5SessionState) -> str:
    """当前这句已经是产品，但还没写进 goal。

    ⚠ 2026-09-09 真机 sr-20260909041801：intake 判 real/proceed，
      控制面 goal 空 → 只列 ask_user，模型问「需要哪些核心功能」。
      缺的进 SPEC 假设卡，不许在进环前再考一题。
    """
    if _has_product_topic(state):
        return ""
    text = ""
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if not isinstance(row, dict):
            continue
        if row.get("role") == "user" and row.get("kind") == "turn":
            text = str(row.get("text") or "").strip()
            break
    # ⚠ 2026-09-09：最后一句是廉价确认（「就按上面这个推演」「开始吧」）时，
    #   上一版直接判空——于是历史里明明有话题，控制面还是反过来问
    #   「想做什么应用，说一句就行。」，用户会读成"你刚才说的我没听见"。
    #   照 grok `get_first_user_text`：会话身份取**第一句有内容的话**，
    #   不取最后一句。最后一句只决定这一轮干什么。
    #
    #   注意不能无条件退回第一句：只有问候的会话（hello / hhh）里
    #   `first_substantive_user_text` 也返回空，所以「你好」仍然进不了环——
    #   反向条钉在 `test_greeting_then_bare_slash_still_parks`。
    # ⚠ 这里原来还并了一个 `_cjk_len(text) < 4`。它跟 `_is_cheap_chat` 里那条
    #   重复（那边剥掉确认词之后同样要求 ≥4 个汉字），而且**对英文永远成立**——
    #   英文的汉字数是 0，于是修好了 `_is_cheap_chat` 之后英文仍然进不了环。
    #   判据只留一处：闲不闲聊问 `_is_cheap_chat`，两种文字它都认。
    if not text or _is_cheap_chat(text):
        text = first_substantive_user_text(state)
    if not text or _is_cheap_chat(text):
        return ""
    return text


def _ask_is_cheap_intake(state: V5SessionState) -> bool:
    """还没有产品话题：问卷收成开放问句，工具说明也不许带选项。

    ⚠ 2026-09-18 真机 sr-20260918103947-G434QZHGQ7：分发器已经不再删
      options，但 `list_control_tools` 只看 `_has_product_topic`。首轮
      goal 空，说明被改成「不要给选项」，模型照做，卡上又只剩「其他」。
      两处必须用同一条判据（CLAUDE.md §4），一边修一边留着等于没修。
    """
    return not _has_product_topic(state) and not _unstamped_product_turn(state)


def _has_ask_answer_candidate(state: V5SessionState) -> bool:
    """刚收回的 ask_user 纸条，还没写成确认目标。

    回执路径不许先把答案写进 goal 再开范围卡——那会让乱码也变成
    「我认成了：…」并点着 SPEC（2026-09-09 真机）。
    """
    if _has_product_topic(state):
        return False
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if not isinstance(row, dict):
            continue
        if row.get("kind") == "user_answer":
            text = str(row.get("text") or "").strip()
            return bool(text) and not _is_exact_filler(text)
        if row.get("kind") in ("plan_written", "plan_approved", "plan_approval"):
            return False
    return False


# 按轮的清单谓词。**只列需要裁的**——没声明的一律列出
# （grok 的 `should_list` 默认 true）。
#
# 抄的标准答案：grok-build `xai-tool-runtime/src/tool.rs`
#     /// Per-turn listing predicate. Return `false` to exclude this tool
#     /// from the model-facing manifest for a given turn.
#     fn should_list(&self, _ctx: &ListToolsContext) -> bool { true }
#
# 比「闭集 + 分发时拒绝」强一档：模型**看不见**的工具不用写规则拒绝。
# 下面每条都对应分发器里一段现成的防御性重定向——那正是"本来就不该被
# 列出"的证据：不裁的话每次都要先让模型挑一次、再被服务端纠正一次。
TOOL_LIST_WHEN: Dict[str, Any] = {
    # 未确认范围时 rehearse 会被 re-park（见 _dispatch_tool 的 rehearse 分支）。
    # 「开始推演」按钮走 forcedTool 绕过 LLM（KD21），裁掉不影响用户点火。
    # 已有模型就别再列 rehearse：下一刀 WRITE 是 refine，不是整场重烧。
    "rehearse": lambda st: plan_execution_authorized(st) and not _has_spec(st) and not _has_model(st),
    # ⚠ 这五条**不再手写**：前置只有 `HOP_REQUIRES` 一份声明（抄 grok
    #   `requires_expr`），这里派生。改造前同一条规则在
    #   `_factory_hop_blocker` 里还有一份手写 if 链，两处会漂（§4）。
    #
    #   spec 多一条「已经有 SPEC 就别再列」——那不是前置，是**别重复干活**
    #   （前置问"跑得动吗"，这一条问"值得再跑吗"）。两件事，故意不合并进
    #   HOP_REQUIRES：合并了 forcedTool=spec 的重起草会被当成缺前置拦掉。
    "spec": lambda st: hop_satisfied("spec", _session_has(st)) and not _has_spec(st),
    "pages": lambda st: hop_satisfied("pages", _session_has(st)),
    "structure": lambda st: hop_satisfied("structure", _session_has(st)),
    "bind": lambda st: hop_satisfied("bind", _session_has(st)),
    "closure": lambda st: hop_satisfied("closure", _session_has(st)),
    # 没产出就没什么可报完工的。跟 closure 同一个条件——它俩问的是同一件事
    # 「手上有没有可判的东西」，不许在这儿另写一份口径（§4）。
    "report_done": lambda st: plan_execution_authorized(st) and (_has_pages(st) or _has_model(st)),
    # 执行清单只在计划批准后开放。
    "todo_write": lambda st: plan_execution_authorized(st),
    # 记忆按**账号**归属。没有归属就没地方记，列出来只会让模型白调一次。
    "remember": lambda st: bool(_memory_scope_id(st)),
    "recall": lambda st: bool(_memory_scope_id(st)),
    # 抄 grok WorkflowTool：有名字的日历是一件可挑选的 WRITE 工具，
    # 不是默认唯一路径。计划批准后就能看见；有模型后仍列出（减菜再跑）。
    "workflow": lambda st: plan_execution_authorized(st),
    # ⚠ 2026-09-09 照 grok 改：清单只看**这件工具现在能不能用**，不猜用户
    #   那句话像不像需求。
    #
    #   查过 grok-build（97 个 crate）：`Tool::should_list` 只被覆写 3 次，
    #   全在转发/解析的管道层，**没有一件真工具覆写它**——read_file / bash /
    #   ask_user_question / task / workflow 全走默认 `true`。而且它的
    #   `ListToolsContext` 里压根没有用户消息（只有 Cwd / SessionContext /
    #   功能开关），按"用户说了什么"筛在类型上就做不到。
    #
    #   上一版这里并了三个猜意图的谓词（有没有产品话题、是不是刚收回纸条、
    #   这一轮像不像产品）。它们是长度启发式的延伸，正是 grok 刻意不做的事：
    #   猜错一次就是「你好」弹一张卡，或者英文需求一整年进不来。
    #   意图由提示词那条 work_policy 判（回答就好，不要顺手造东西），
    #   贵动作由点火那道闸挡（`_turn_has_real_product`）——两层都在动作侧。
    "write_plan": lambda st: not plan_execution_authorized(st),
    "exit_plan_mode": lambda st: bool(latest_control_plan(st)) and not plan_execution_authorized(st),
    # 没有上一版可回（_previous_model_version_id fail-closed 返回 ""）。
    "restore_version": lambda st: bool(_previous_model_version_id(st)),
    # ⚠ refine / fork_variant 在空会话上无事可做，而 refine 的分发分支
    #   **没有** rehearse 那样的 _scope_confirmed 兜底：实测夹具让模型在
    #   空 goal 会话上挑 refine，工厂信封被调 1 次、零范围卡就点了火
    #   （违反验收 A / KD4）。裁清单 + 分发兜底两处一起补。
    "refine": lambda st: _has_model(st),
    "fork_variant": lambda st: _has_model(st),
    # ⚠ 2026-08-27 压测逮到的第三个同形态：同一句「中小学课后托管」跑三遍，
    #   两遍模型挑 scope_card（41s 出范围卡），一遍在**零模型**的会话上挑了
    #   inspect_model —— `_inspect_digest` 老实回「当前还没有五系统模型可
    #   查看」，模型接着甩了句套话就收尾，范围卡再没出现，136s 打空
    #   （真机 sr-20260827073836-C3VJV41PV5，controlTranscript 里明写着
    #    turn → clarify → turn → inspect_model → canned）。
    #   refine / fork_variant 当时补了 _has_model，inspect_model 漏了一个。
    "inspect_model": lambda st: _has_inspectable(st),
    # 空会话没有产品可查。列出来模型会把任意话当术语去检索，再弹出
    # 「这句话是哪种意思」的选项。有记下的产品才检索。
    "search_evidence": lambda st: _has_product_topic(st),
    "info_search_web": lambda st: _has_product_topic(st),
    "challenge": lambda st: _has_spec(st) or _has_model(st),
    "repair": lambda st: _has_spec(st) or _has_model(st),
}


# 「这个工具要不要用户显式批准才能执行」。**只列要批准的**——缺省不需要
# （grok 的 `ToolDef.requires_permission` 默认 false）。
#
# 抄的标准答案：grok-build `xai-grok-workspace-types/src/types/tools.rs`
#     pub struct ToolDef { ...
#         /// Whether invocations require explicit user permission.
#         pub requires_permission: bool, }
#     pub enum ToolProgress {
#         /// Tool started (after permission was granted, before execution).
#         Started { call_id: ToolCallId }, ... }
#
# 值放的是「已获批准吗」的谓词：本仓的批准动作就是范围卡上那次
# 「开始推演」，落在 transcript 的 scope_confirmed 上。
#
# ⚠ 原来这两条检查散在各自的 if 分支里。散着写的代价刚付过：refine 那段
#   是 2026-08-27 才补的，补之前空会话上模型挑 refine 零范围卡就点火
#   （实测信封调用 1 次）。**新加一个贵动词很容易忘写那一段，而忘了不会
#   报错，只会绕过范围卡。** 所以收到一处声明 + 一道统一闸。
#
# ⚠ 声明**不进 provider 线上 payload**：CONTROL_TOOLS 是 OpenAI 风格的
#   function 定义，塞非标准键有被拒的风险。grok 的 ToolDef 是他们自己的
#   内部类型，对应物就是这张表。
TOOL_PERMISSION: Dict[str, Any] = {
    # 范围卡上的「开始推演」就是这道批准。停泊 ≠ 已批准（见 _scope_confirmed）。
    "rehearse": lambda st: plan_execution_authorized(st),
    "workflow": lambda st: plan_execution_authorized(st),
    "spec": lambda st: plan_execution_authorized(st),
    "pages": lambda st: plan_execution_authorized(st),
    "structure": lambda st: plan_execution_authorized(st),
    "bind": lambda st: plan_execution_authorized(st),
    "closure": lambda st: plan_execution_authorized(st),
    # 空会话没模型可精修 → 先开卡。有模型时是否也出薄卡是产品决定
    # （M2 Q2），本次不扩大范围。
    "refine": lambda st: _has_model(st),
}


def tool_writes(name: Any) -> bool:
    """这件工具会不会真的改东西。权威是两处：声明的 WRITE 权限 + 工程写工具名单。

    ⚠ **别拿 `_step_is_problematically_repeating` 当它用。** 那个判的是
      「这一轮要不要走紧档阈值」，而工程工具压根没进 `TOOL_SCOPE`——
      按 closed_tools 那条「Absence is treated as Read」，`project_patch`
      `project_create` 全被算成 READ。

      2026-09-14 回归当场逮到：只读连胜那道闸复用了它，于是
      `project_create → project_read → project_patch` 三轮被数成「连着三轮
      只读」，提醒当场误发，而且把 `test_model_creation_read_and_patch_...`
      的第三轮顶掉了。两个谓词长得像、名字也像，语义完全不同（§4）。
    """
    return (resolve_tool_scope(name) == ToolScope.WRITE
            or str(name or "").strip() in PROJECT_WRITE_TOOLS)


def step_is_read_only(calls: List[Dict[str, Any]]) -> bool:
    """这一轮**一件都没写**。空轮不算（没有调用就谈不上「只读」）。"""
    return bool(calls) and not any(tool_writes((c or {}).get("name")) for c in calls)


def tool_requires_permission(name: Any) -> bool:
    """这个工具要不要显式批准。没声明的一律不需要。"""
    return tool_writes(name) or str(name or "").strip() in TOOL_PERMISSION


def tool_permission_granted(name: Any, state: V5SessionState) -> bool:
    """已获批准吗。不需要批准的恒为真。"""
    if _project_tool_error(name, state):
        return False
    if resolve_tool_scope(name) == ToolScope.WRITE and not plan_execution_authorized(state):
        return False
    pred = TOOL_PERMISSION.get(str(name or "").strip())
    if pred is None:
        return True
    return bool(pred(state))


def should_list_tool(name: Any, state: V5SessionState) -> bool:
    """这一轮要不要把这个工具摆给模型看。没声明谓词的一律列出。"""
    if _project_tool_error(name, state):
        return False
    if name in PROJECT_TOOL_NAMES:
        if name in PROJECT_ALIAS_TOOLS:
            return False
        return name == "project_create" or bool(getattr(state, "projectId", None))
    if resolve_tool_scope(name) == ToolScope.WRITE and not plan_execution_authorized(state):
        return False
    pred = TOOL_LIST_WHEN.get(str(name or "").strip())
    if pred is None:
        return True
    try:
        return bool(pred(state))
    except Exception:
        # 谓词自己炸了不许把工具吞掉：清单是增强，不是闸（闸在 ToolScope）。
        return True


def list_control_tools(state: V5SessionState) -> List[Dict[str, Any]]:
    """本回合摆给模型的工具清单。原样透传定义，只做裁剪。

    ⚠ 永不为空：全裁光了模型无事可做，比多列一个更糟。兜底只留
      ask_user。空会话把 scope_card 放进兜底 = 问候也会开范围卡。

    workflow 的描述把已登记名字写进去——模型看不见配方就只能发明流程，
    那正是 grok WorkflowTool 要挡的。不改全局 CONTROL_TOOLS：那份是
    provider schema，名字是运行时注册表。
    """
    listed = [
        t
        for t in CONTROL_TOOLS
        if should_list_tool(((t.get("function") or {}).get("name")), state)
    ]
    if not listed:
        floor = {"ask_user_question"}
        listed = [
            t for t in CONTROL_TOOLS if ((t.get("function") or {}).get("name")) in floor
        ]
    names = ", ".join(workflow_names())
    out: List[Dict[str, Any]] = []
    for item in listed:
        fn = item.get("function") or {}
        name = fn.get("name")
        if name == "workflow":
            cloned = copy.deepcopy(item)
            cloned["function"]["description"] = (
                "跑一份已登记的推演日历（不是发明流程）。"
                f"已登记：{names}。"
                "name 必须是其中之一；tools 可再减菜（spec/pages/structure/bind/closure）。"
                "未确认范围时必须先 park。有模型后仍可减菜再跑。"
            )
            out.append(cloned)
            continue
        if name == "ask_user_question" and _ask_is_cheap_intake(state):
            cloned = copy.deepcopy(item)
            cloned["function"]["description"] = (
                "用户在问你是谁、能做什么时：不要调这个工具，用文本回答。"
                "没有应用目标、需要他给一句话时才调。不要给选项，"
                "不要把一句话拆成问候或协议。本请求必须结束。"
            )
            out.append(cloned)
            continue
        if name == "skill":
            cloned = copy.deepcopy(item)
            cloned["function"]["description"] = skill_tool_description(
                _skill_infos_for_turn(state)
            )
            out.append(cloned)
            continue
        out.append(item)
    return out


def _skill_infos_from_cache(state: V5SessionState) -> list:
    rows = getattr(state, "controlSkillCache", None) or []
    out: list[SkillInfo] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = normalize_skill_name(str(row.get("name") or ""))
        body = str(row.get("body") or "")
        description = str(row.get("description") or "")
        path = str(row.get("path") or "")
        if not name or not body or not description:
            continue
        out.append(SkillInfo(
            name=name, description=description, path=path, body=body, enabled=True,
        ))
    return out


def _remember_skill_infos(state: V5SessionState, infos: list) -> None:
    by_name = {info.name: info for info in _skill_infos_from_cache(state)}
    for info in infos:
        if getattr(info, "name", None) and getattr(info, "body", None):
            by_name[info.name] = info
    state.controlSkillCache = [
        {
            "name": info.name,
            "description": info.description,
            "path": info.path,
            "body": info.body,
        }
        for info in by_name.values()
    ]


def _skill_infos_for_turn(state: V5SessionState) -> list:
    """已安装短目录。点名只预加载正文，不把别的技能藏起来。

    ⚠ 2026-09-20：selectedSkills 曾经用来 filter_selected 收窄目录。
    用户要的是「自由 Agent 编排 + 这次 @ 的 Skills 流程」——已装的
    都还能调，@ 只是把那份 SKILL.md 提前展开。收窄等于把搭配藏起来。

    ⚠ 2026-09-21 sr-20260921170121-13ME64TF8Z：批准计划后新回合
      skill(office-skills) → skill_not_found。商店目录这一发空了，
      上一回合已经打开过的正文必须还在。目录有就并进缓存，目录空
      就用缓存。
    """
    owner = str(getattr(state, "ownerId", None) or "").strip()
    live: list = []
    if owner:
        try:
            live = list(installed_skill_infos(owner) or [])
        except Exception:
            live = []
    cached = _skill_infos_from_cache(state)
    by_name = {info.name: info for info in cached}
    for info in live:
        by_name[info.name] = info
    payload = _CONTROL_PAYLOAD.get() or {}
    wanted: list[str] = []
    raw = payload.get("installedSkills")
    if isinstance(raw, list):
        wanted.extend(
            normalize_skill_name(str(item))
            for item in raw
            if str(item or "").strip()
        )
    wanted.extend(mentioned_skill_slugs(str(payload.get("userText") or "")))
    wanted.extend(mentioned_skill_slugs(_task_text_for_recall(state)))
    extra = payload.get("selectedSkills")
    if isinstance(extra, list):
        wanted.extend(
            normalize_skill_name(str(item))
            for item in extra
            if str(item or "").strip()
        )
    for name in dict.fromkeys(wanted):
        if name in by_name:
            continue
        info = local_seed_skill_info(name)
        if info is not None:
            by_name[info.name] = info
            live.append(info)
    merged = list(by_name.values())
    if live or wanted:
        _remember_skill_infos(state, merged)
    return merged


def _mentioned_skill_infos(state: V5SessionState) -> list:
    """这一轮 @slug / selectedSkills 点名的已装技能。"""
    payload = _CONTROL_PAYLOAD.get() or {}
    installed = _skill_infos_for_turn(state)
    if not installed:
        return []
    names = mentioned_skill_slugs(str(payload.get("userText") or ""))
    extra = payload.get("selectedSkills")
    if isinstance(extra, list):
        names = list(
            dict.fromkeys(
                [
                    *names,
                    *[
                        normalize_skill_name(str(item))
                        for item in extra
                        if str(item or "").strip()
                    ],
                ]
            )
        )
    allow = {info.name for info in installed}
    return [info for info in installed if info.name in set(names) & allow]


def _office_named_from_transcript(state: V5SessionState) -> bool:
    """落盘里的 @办公技能 / mentionedSkills。GET 没有本轮信封。"""
    for row in getattr(state, "controlTranscript", None) or []:
        if not isinstance(row, dict):
            continue
        extra = row.get("mentionedSkills")
        names = [str(item) for item in extra] if isinstance(extra, list) else []
        for key in ("text", "userText", "planContent"):
            names.extend(mentioned_skill_slugs(str(row.get(key) or "")))
        if any(skill_seed_category(name) == OFFICE_SKILL_CATEGORY for name in names):
            return True
    return False


def _this_turn_office_skill_named(state: V5SessionState) -> bool:
    """本轮信封里的 @slug / selectedSkills 点名了办公技能。

    ⚠ 2026-09-20 真机 sr-20260920102543-OFFICE / sr-20260920105329-PPT：
      write_plan 省略 kind 时只问已装目录。目录空或 ContextVar 里
      点名没进 `_mentioned_skill_infos`，键写成缺省或干脆没写，
      GET/complete 的 plan_written 没有 deliverableKind。
      点名以本轮六字段为准（persist-as-authority），seed 类别认「办公」，
      不猜「做一份 PPT」。
    """
    payload = _CONTROL_PAYLOAD.get() or {}
    names = mentioned_skill_slugs(str(payload.get("userText") or ""))
    extra = payload.get("selectedSkills")
    if isinstance(extra, list):
        names = list(
            dict.fromkeys(
                [
                    *names,
                    *[
                        normalize_skill_name(str(item))
                        for item in extra
                        if str(item or "").strip()
                    ],
                ]
            )
        )
    if any(skill_seed_category(name) == OFFICE_SKILL_CATEGORY for name in names):
        return True
    if any(
        skill_seed_category(info.name) == OFFICE_SKILL_CATEGORY
        for info in _mentioned_skill_infos(state)
    ):
        return True
    return _office_named_from_transcript(state)


def _deliverable_kind_for_write_plan(state: V5SessionState, raw: Any) -> str:
    """模型写了类别用模型的。省略时只认本轮点名的办公技能，不猜话题。

    ⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：write_plan 没带
      deliverableKind，normalize 成 web-app，office 闸全没合上。
      @office-skills 是点名，不是从「做一份 PPT」猜。
    """
    text = str(raw or "").strip()
    if text in DELIVERABLE_KINDS:
        return text
    if _this_turn_office_skill_named(state):
        return OFFICE_FILE
    return normalize_deliverable_kind(raw)


def _plan_written_kind(row: Any) -> str | None:
    if not isinstance(row, dict) or row.get("kind") != "plan_written":
        return None
    text = str(row.get("deliverableKind") or "").strip()
    return text if text in DELIVERABLE_KINDS else None


def stamp_control_plan_kind(state: V5SessionState) -> bool:
    """plan_written 缺键或空值时补上。GET / complete 的权威投影。

    ⚠ 2026-09-20 真机 complete.state 与 GET 的 plan_written 没有
      deliverableKind。write_plan 源码写了键，落盘/快照那一刀剥了。
      这里按 persist-as-authority 补回：有本轮点名用 office-file，
      否则 web-app。键必须在，不许再是 None。
    """
    rows = list(getattr(state, "controlTranscript", None) or [])
    changed = False
    stamped: list[Any] = []
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") != "plan_written":
            stamped.append(row)
            continue
        if _plan_written_kind(row):
            stamped.append(row)
            continue
        stamped.append({
            **row,
            "deliverableKind": _deliverable_kind_for_write_plan(
                state, row.get("deliverableKind")
            ),
            "mentionedSkills": list(row.get("mentionedSkills") or [
                info.name for info in _mentioned_skill_infos(state)
            ]),
        })
        changed = True
    if changed:
        state.controlTranscript = stamped
    return changed


async def _invoke_control_llm(
    messages: List[Dict[str, Any]], *, tools: List[Dict[str, Any]],
    timeout_ms: Optional[int] = None,
) -> Any:
    """问一次控制面模型。**真协程直接 await，同步实现才下线程池。**

    为什么要分这一下（两条判据各钉住一半，缺一条就静默失效）：

    · 生产实现 `call_control_llm` 是 async + httpx.AsyncClient。必须**直接
      await 在事件循环上**——只有这样客户端断开时 asyncio 的取消才传导得到
      socket，请求才是真停了而不是"账面停了、线程还在烧"。塞进
      run_in_threadpool 会把这条链斩断（那正是 2026-08-27 实测到的
      「客户端走后 LLM 又跑 3.1 秒」）。
      钉这一半的是 tests/test_control_llm_cancel_really_aborts.py。

    · 测试替身（42 个文件共用的 ControlHarness）传的是**同步**函数，其中
      test_control_stream_does_not_block_the_loop 的夹具还故意用 time.sleep
      阻塞——那条判据要的就是"阻塞实现不许冻住别人的流"。同步实现直接
      await 会真把事件循环焊死，那条测试立刻红。所以同步的照旧下线程池。
      钉这一半的是那条并发测试本身。

    ⚠ 分派看的是**函数**不是返回值：同步阻塞实现一旦被调用就已经把循环占住了，
      拿到返回值再判断已经晚了。
    """
    # ⚠ `timeout_ms` 只在**显式给了**的时候才透传。夹具（42 个文件共用的
    #   ControlHarness）的替身签名是 `(messages, **kw)`，多塞一个 None 进去
    #   会让它们记下一个本来不存在的参数；而真机上不给就退回
    #   `control_client` 的 45 秒默认——那正是这次要治的病。
    kwargs: Dict[str, Any] = {"tools": tools}
    if timeout_ms is not None:
        kwargs["timeout_ms"] = int(timeout_ms)
    fn = call_control_llm
    if inspect.iscoroutinefunction(fn):
        return await fn(messages, **kwargs)
    return await run_in_threadpool(lambda: fn(messages, **kwargs))


# 客户端认得的**终局事件**。少了它们，`consumeControlStreamResponse` 的
# `acc.finalState` 一直是 null → `postControlTurnStream` 返回 null →
# `runTurn` 抛「控制面未返回结果」，然后 catch 里把**这一轮开始前的快照**
# PUT 回去。
#
# ⚠ 2026-08-27 评审逮到 `restore_version` 就是这样：服务端明明回退成功并
#   `_persist` 了，客户端一个错误路径把它盖回去——比"点了没反应"更糟。
#   紧挨着的 `fork_variant` 有 `yield _complete(state)`，注释还写着
#   「不 yield 等于点了没反应」，只有它漏了。
#   所以不再指望每个分支各自记得：**在 forced 这条总出口上兜一次**。
#
# ⚠ 2026-09-02 真机：假设卡「确认继续」forcedTool=pages。第一版把
#   `control_handoff_factory` 也算终局——那是「交棒后工厂另开一条 SSE」
#   的旧合同。现在 nest=True，工厂事件还在同一条流里，handoff 只是
#   WRITE 开始。`_settled` 见了它就不再补 `complete`，工厂跑完流自然
#   结束，客户端报「推演中断」。host 终局只认 `complete`。
_TERMINAL_EVENTS = ("complete",)

MAX_TOOL_ROUNDS = 8
MAX_CHEAP_TOKENS = 8000

#: 点火前（还没进工程档）一整个回合的墙钟。
#:
#: ⚠ 2026-09-14 真机把它从 45 抬到 90：**新链路整个进不去**。
#:   进工程档的开关挂在 `project_create` 成功之后（见本文件 `loop_budget =
#:   PROJECT_BUDGET` 那一处），而 `project_create` 要先有一份批准的计划——
#:   写计划那一发就跑在这条墙钟上。三种配置量下来：
#:
#:       rcouyi/gemini-3.5-flash-lite   content_filter（provider 侧）
#:       text168/grok-4.6               55s → wall_clock
#:       控制面换 grok-4.5              小回合全过，写计划那一发 65s → wall_clock
#:
#:   45 秒对「一句话聊天」够用，对「写一份实施计划」不够，于是工程模式
#:   永远够不着。这正是 CLAUDE.md §一之二：闸装在真跑的路上，
#:   而它守的那道门后面的东西没人到得了。
#: ⚠ 2026-09-15 新开会话 `sr-20260915161915-B2601PBD1Q`：写计划前两发
#:   分别想了 148s / 151s，墙钟 90 把计划掐在「没点火」。工程档的 600/900
#:   根本轮不到。对话档当时改走 control-v2（180/240）。
#: ⚠ 2026-09-18 对话档再开 control-v3（轮次/墙钟/token 跟工程档对齐），
#:   下面两个常量仍是 **control-v1 存档** 的数字，不许原地改——改了旧
#:   checkpoint 的 to_wire 对不上。
MAX_WALL_SECONDS = 90.0

#: 点火前 v1 **单发** HTTP 读超时。v2 见 CONVERSATION_BUDGET。
MAX_REQUEST_SECONDS = 75.0
INSPECT_MAX_ITEMS = 40
INSPECT_MAX_CHARS = 4000


def _project_budget_eligible(state):
    """Claude ExitPlanMode：批准后就是执行档，不要求仓库已经建好。

    ⚠ 2026-09-20 真机 sr-20260920105329-PPT：批准后 17 秒
      `token_budget used=9611/8000`，bash 零次。当时还要求
      `runtimeKind==project` 且已有 `projectId`，而 `project_create`
      又要先批准——卡在中间，cheap 8k/90s 先爆。
      适配器仍是服务端注入的，payload 伪造工程指针抬不了档。
    """
    return (_PROJECT_TOOLS.get() is not None
            and plan_execution_authorized(state))


def _is_fresh_control_round(resume: Any) -> bool:
    """新用户回合 / 自动续跑（cheapTokens 已清零），不是中途打断的 resume。"""
    if not resume or not isinstance(resume, dict):
        return True
    if resume.get("phase") not in {"model", "tools"}:
        return True
    return int(resume.get("round") or 0) == 0 and int(resume.get("cheapTokens") or 0) == 0


def _loop_budget_for(state: V5SessionState, resume: Any):
    """新回合用当前窗口档。v1/v2 花费闸只在中途 resume 那份存档上还原。

    ⚠ 2026-09-20 sr-20260920120007-PPT：七次 durable 全是 control-v2/8000。
      continuation 把旧 budgetPolicy 原样带进 phase=model / cheapTokens=0，
      restore_budget 就把花费闸焊死。新一轮必须重选 control-v3 / project-v3。
    """
    current = PROJECT_BUDGET if _project_budget_eligible(state) else CONVERSATION_BUDGET
    if _is_fresh_control_round(resume):
        return current
    snap = resume.get("budgetPolicy") if isinstance(resume, dict) else None
    if not snap:
        return current
    return restore_budget(snap, CONVERSATION_BUDGET)

#: 单个工具结果回喂给模型时的上限。
#:
#: 抄的标准答案：grok-build `xai-grok-compaction/src/intra_compaction/fit.rs`
#: 的第 2 级台阶
#:
#:     //! 2. ToolTruncated  only if still over: prefix-clip tool results
#:     //!                   that alone exceed budget (grok-build style:
#:     //!                   max_bytes = max_tokens * 4, no binary search)
#:
#: 以及 `xai-tool-types/src/task.rs` 的三件套：
#:
#:     pub truncated: bool,
#:     /// Pre-resolved hint text for truncated output.
#:     pub truncation_hint: String,
#:     /// Raw output byte count before any truncation or soft-wrapping.
#:     pub raw_output_bytes: usize,
#:
#: ⚠ 2026-08-27 复审逮到：本仓把工具结果**原样 json.dumps 回喂**，一个长度
#:   约束都没有。而 `search_evidence` 的 hits 来自公网——一次胖搜索就能把下一
#:   次控制面请求的提示词顶穿。8k 的 cheap 预算是**调用之后**才对账的，拦不住
#:   已经发出去的那一发；真顶穿了是网关 4xx，走 except → 罐头，用户看到的是
#:   "控制面挂了"，而真因是我们自己把上下文塞爆了。
#:
#: 取 4000 字符 ≈ 1000 token（grok 的 4 字节/token 口径），八轮正好落在
#: MAX_CHEAP_TOKENS 上。跟 INSPECT_MAX_CHARS 同一个数量级，是同一族常量。
CONTROL_TOOL_RESULT_MAX_CHARS = 4000

#: 按工具名覆盖上面那个默认档。抄 grok `TruncationConfig`：
#:
#:     /// Max total output bytes for any tool. Default: 40KB.
#:     pub default_max_output_bytes: Option<usize>,
#:     /// Per-tool overrides keyed by canonical tool name.
#:     pub per_tool_max_output_bytes: HashMap<String, usize>,
#:
#: ⚠ 默认档**故意不动**。它挡的是 `search_evidence` 那类**长度我们说了不算**
#:   的结果（hits 来自公网，一次胖搜索就能把下一发顶穿——见上面的头注）。
#:   `project_read` 不一样：它的长度在我们自己手里，已经被
#:   `PROJECT_READ_MAX_CHARS` 夹过一道了，再用 4000 夹第二道就只是把刚放宽的
#:   读窗原样砍回去。grok 区分 default / per-tool 正是这个理由。
#:
#: ⚠ 这是读窗那条链的**第三道**，也是最后一道（CLAUDE.md §4）。三道齐了
#:   读窗才真的变宽，漏一道都是"改了但一点效果没有"。
CONTROL_TOOL_RESULT_MAX_CHARS_BY_TOOL: Dict[str, int] = {
    "project_read": PROJECT_READ_MAX_RESULT_CHARS,
    "file_read": PROJECT_READ_MAX_RESULT_CHARS,
    "read_file": PROJECT_READ_MAX_RESULT_CHARS,
    # SKILL.md 正文只在这件工具回。默认 4000 会裁掉说明书。
    "skill": 100000,
}


def control_tool_result_max_chars(tool_name: Any = None) -> int:
    """这件工具的结果回喂上限。抄 grok `max_output_bytes_for` 的优先级：
    per-tool 覆盖 > 默认档。"""
    return CONTROL_TOOL_RESULT_MAX_CHARS_BY_TOOL.get(
        str(tool_name or ""), CONTROL_TOOL_RESULT_MAX_CHARS
    )

LEAKED_CONTROL_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "message_notify_user",
            "description": (
                "Show the user a short status note. This does not ask a question "
                "and does not wait. Keep it one or two sentences in the user's language."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "message_ask_user",
            "description": (
                "Ask the user one or more questions and wait. Same parking contract as "
                "ask_user_question: pass text, or questions with options. "
                "Every question gets an Other choice in the UI."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "text": {"type": "string"},
                    "question": {"type": "string"},
                    "questions": {"type": "array", "items": {"type": "object"}},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "info_search_web",
            "description": (
                "Search the public web for evidence about this product topic. "
                "Same retrieval as search_evidence. Hits are not closure."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "idle",
            "description": (
                "End this turn and wait for the user. This is not a completion claim "
                "and does not go through the done judge."
            ),
            "parameters": {"type": "object", "additionalProperties": False, "properties": {}},
        },
    },
]


CONTROL_TOOLS: List[Dict[str, Any]] = [
    *PROJECT_TOOLS,
    *LEAKED_CONTROL_TOOLS,
    {
        "type": "function",
        "function": {
            "name": "ask_user_question",
            # 抄 grok `AskUserQuestion` 的 description_template（两句都要）：
            #   - Every question automatically gets an "Other" choice where the
            #     user can type their own answer.
            #   - Put your recommended option first and append "(Recommended)"
            #     to its label.
            # ⚠ 第一句是**给渲染侧的承诺**：Other 由前端补，模型不许自己往
            #   options 里塞一个「其他」。生成侧/消费侧成对（本仓 §四）。
            "description": (
                "问用户一道或几道选择题。一次可以问几件相关的事，别拆成几轮。"
                "每道题渲染时都会自动多一个「其他（自己写）」，你不要自己加。"
                "把你推荐的那一项排第一，标签后面加「（推荐）」。"
                "问句和选项跟用户同一种语言（默认简体中文）。"
                "本请求必须结束，不得空转等待。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "description": "要问的题，每道自带选项。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {
                                    "type": "string",
                                    "description": "问句，写成一整句问话。",
                                },
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {
                                                "type": "string",
                                                "description": "选项文字，几个字就够。",
                                            },
                                            "description": {
                                                "type": "string",
                                                "description": "选它意味着什么。",
                                            },
                                            "preview": {
                                                "type": "string",
                                                "description": (
                                                    "焦点在这一项时给人看的对照内容"
                                                    "（示例、片段）。单选题专用。"
                                                ),
                                            },
                                        },
                                        "required": ["label"],
                                    },
                                },
                                "multi_select": {
                                    "type": "boolean",
                                    "description": "允许多选，缺省单选。",
                                },
                            },
                            "required": ["question", "options"],
                        },
                    },
                },
                "required": ["questions"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_evidence",
            "description": "控制面检索。不计入闭环证据，不 commit_artifact。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_model",
            "description": "查看当前五系统模型的有界摘要，禁止倒出原始 JSON。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_plan",
            "description": (
                "保存完整实施计划。包含目标、访谈结论、设备与设计选择、工作步骤和验收方法。"
                "计划正文跟用户同一种语言（默认简体中文）。"
                "每次重写使上一版批准失效。"
                "deliverableKind 缺省 web-app；磁盘上的 .pptx / .docx / .xlsx 用 office-file。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "planContent": {"type": "string"},
                    "deliverableKind": {
                        "type": "string",
                        "enum": ["web-app", "office-file"],
                    },
                },
                "required": ["planContent"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "enter_plan_mode",
            "description": "进入只读规划，重新访谈并编写计划；暂停现有执行授权。",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "exit_plan_mode",
            "description": "读取已保存的完整计划并请求用户批准。输入必须为空，批准之前不能执行。",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rehearse",
            "description": "开始推演：起草 SPEC。跑完交回。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "spec",
            "description": "起草 SPEC。跑完交回。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pages",
            "description": "按已有 SPEC 逐页生成 HTML。没有 SPEC 时不许调。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "structure",
            "description": "从已有页面反推数据模型并汇合。没有页面时不许调。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bind",
            "description": "给已有页面打权限/工作流孔。没有页面时不许调。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "closure",
            "description": "发布闭环判定。缺证据就 blocked，不许补绿灯。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # 抄 grok MemorySearch / MemoryGet：模型自己攒的经验，跨会话活着。
    # ⚠ 跟产品宪章不是一回事——宪章是**用户写的规矩**，这是**模型攒的经验**。
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "记一条跨会话的经验（用户的偏好、习惯、叫法）。"
                "只记以后还用得上的事实，别记这一轮的过程。"
            ),
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string", "description": "一句话"}},
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": "翻以前记下的经验。不给关键词就拿最近几条。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "关键词，可空"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill",
            "description": (
                "加载一份磁盘上的技能（SKILL.md）。"
                "目录只给名字和一句话；全文只在你调用这件工具时喂回来。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "技能目录里的名字",
                    },
                    "args": {
                        "type": "string",
                        "description": "可选，传给这份技能的补充说明",
                    },
                },
                "required": ["name"],
            },
        },
    },
    # 抄 grok `TodoWriteTool`。工具说明两句都要——第二句「用户能看见」
    # 是它存在的理由，去掉就只剩模型自言自语。
    {
        "type": "function",
        "function": {
            "name": "todo_write",
            "description": (
                "列一张活儿清单并维护它。**用户看得见这张清单，这是你展示进度的主要方式。**"
                "三步以上的活儿就列；一步能做完的别列。"
                "开始下一条或做完当前这条时立刻改 status，不要等全部做完再改。"
                "改已有条目必须用回喂里的 id；换 id 会叠出两份。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "description": "要写入的条目",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": (
                                        "条目唯一标识。回喂里已有的条目必须用原来的 id，"
                                        "不要另起一个。"
                                    ),
                                },
                                "content": {
                                    "type": "string",
                                    "description": "这一条要做什么。改已有条目的状态时可以不带。",
                                },
                                "status": {
                                    "type": "string",
                                    "enum": [
                                        "pending",
                                        "in_progress",
                                        "completed",
                                        "cancelled",
                                    ],
                                },
                            },
                            "required": ["id"],
                        },
                    },
                    "merge": {
                        "type": "boolean",
                        "description": (
                            "缺省 true：按 id 合并进现有清单——只发你要改的那几条，"
                            "只翻状态时带 id + status 就够。false 表示整张替换。"
                        ),
                    },
                },
                "required": ["todos"],
            },
        },
    },
    # 抄 grok `update_goal`：模型自称做完了**不算数**，判决当场回喂。
    # 参数说明书三条都照它的措辞（见 done_claim.BLOCKED_REASON_SCHEMA 头注）。
    {
        "type": "function",
        "function": {
            "name": "report_done",
            "description": (
                "报完工 / 报进度 / 报受阻。"
                "声称做完了会走闭环判定，判定没过这次声明不成立——"
                "判决当场回给你，不是一句「收到」。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "completed": {"type": "boolean", "description": COMPLETED_SCHEMA},
                    "message": {"type": "string", "description": MESSAGE_SCHEMA},
                    "blocked_reason": {
                        "type": "string",
                        "description": BLOCKED_REASON_SCHEMA,
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workflow",
            "description": (
                "跑一份已登记的推演日历（不是发明流程）。"
                "name 必须是已注册工作流；tools 可减菜（spec/pages/structure/bind/closure）。"
                "未确认范围时必须先 park。有模型后仍可减菜再跑。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "tools": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refine",
            "description": (
                "在现有模型上精修。hop 指明这一轮改哪一段"
                "（spec / pages / structure / bind / closure）。"
                "不给 hop 时：已有 SPEC 从 pages 起，否则从 spec 起。"
                "不得用 userText 覆盖 session goal。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "hop": {
                        "type": "string",
                        "enum": list(FACTORY_HOPS),
                        "description": "这一跳重跑哪一段。不确定就留空，从 spec 起。",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "challenge",
            "description": "质疑：失效一次，不点火。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repair",
            "description": "补齐缺口。只重跑覆盖门标红的能力。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restore_version",
            "description": "回退到某一版模型。",
            "parameters": {
                "type": "object",
                "properties": {"versionId": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fork_variant",
            "description": "从当前应用分出一条变体。",
            "parameters": {
                "type": "object",
                "properties": {"newName": {"type": "string"}},
            },
        },
    },
]


def validate_control_turn_body(payload: Dict[str, Any]) -> None:
    """产品 POST 必须带齐六字段。{forcedTool, goal} only → 400。"""
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="control-turn requires sessionId, userText, installedSkills, "
            "activeConnectors, preferredDevice, designSystemId",
        )
    missing = [key for key in CONTROL_SIX_FIELDS if key not in payload]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="control-turn requires sessionId, userText, installedSkills, "
            "activeConnectors, preferredDevice, designSystemId",
        )
    sid = str(payload.get("sessionId") or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id required")


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _append_transcript(state: V5SessionState, entry: Dict[str, Any]) -> None:
    rows = list(getattr(state, "controlTranscript", None) or [])
    item = {"id": f"ct-{uuid.uuid4().hex[:10]}", "timestamp": _now_iso(), **entry}
    rows.append(item)
    state.controlTranscript = rows


async def _logged_tool_events(
    state: V5SessionState, stream: AsyncIterator[Dict[str, Any]]
) -> AsyncIterator[Dict[str, Any]]:
    """派发出口：SSE 工具事件边 yield 边进会话日志并落盘。

    抄 OpenHands EventStream.add_event。套在每一条 `_dispatch_tool` 出口上。
    只套 LLM 主循环、漏 forced / 超限补写计划，就是 §4 改一半。
    """
    async for event in stream:
        entry = tool_transcript_entry(event)
        if entry is not None:
            _append_transcript(state, entry)
            # start 先只进内存：project_* 的 execute 可能自己 save 一份
            # 刚 load 的会话，抢先 persist 会被那一刀盖掉。结果出来再落盘，
            # 这一发的 start/result 一起进库。checkpoint 也会再写一次。
            if entry["kind"] == "tool_result":
                await _apersist_transcript(state)
        yield event


async def _apersist_transcript(state: V5SessionState) -> None:
    """把会话日志落盘——**只落日志那一栏**，用读-改-写，不整份盖。

    ## 为什么不能直接 `_apersist(state)`（2026-09-15）

    这个包装器套在**整条流**上，手里那份 `state` 是进来时的。而流中途会有
    别的写入者往同一个会话里写：`_handoff_factory` 起的工厂是另一条 run，
    spec-first 跑完把 SPEC 写进 `state.specFirstPages` 并自己存了库。

    直接 `_apersist(state)` 就是拿进来时那份旧快照整体覆盖——SPEC 当场没了。
    而 `_persist` 用的是 `server_write=True`，它**绕过 persistence 的同轮
    增长守卫**（那是 2026-09-04 为了让纯标量翻转别被丢掉才加的），
    所以这一盖不会被拦下来，不报错、不告警。

    真机形态：spec 跳交回后 `_has_spec(state)` 仍是 False → `pages` 不进
    工具清单 → host 挑不了下一跳，整条 spec-first 链停在 spec。
    落库的 blob 只剩 `{'assumptionsConfirmed'}`，`spec` 键整个没了。

    ⚠ 头注上面那半句说的是**反方向**的同一个病（「抢先 persist 会被那一刀
      盖掉」）。两个方向都要防：那半句靠延后落盘，这半句靠只写自己那一栏。

    做法：重新 load 一份，把这一条日志接到**它**的日志后面再存。
    没读到就退回原来那份——拿不到新的时候，落盘总比不落好。
    """
    sid = str(getattr(state, "sessionId", "") or "")
    fresh = await run_in_threadpool(load_session, sid) if sid else None
    if fresh is None:
        await _apersist(state)
        return
    rows = list(getattr(state, "controlTranscript", None) or [])
    fresh.controlTranscript = rows
    await _apersist(fresh)
    # 调用方后面还要读这份日志，别让它停在旧的上。
    state.controlTranscript = list(getattr(fresh, "controlTranscript", None) or rows)


def _goal_text(state: V5SessionState) -> str:
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    return str(getattr(goal, "text", "") or "").strip()




def _write_confirmed_goal(state: V5SessionState, restatement: str) -> None:
    """确认 rehearse 才写 goal；空 goal 用复述句。精修不得走这里。"""
    if _goal_text(state):
        return
    text = (restatement or "").strip()
    if not text:
        return
    goal = dict(state.goal) if isinstance(state.goal, dict) else {}
    goal["text"] = text
    if not goal.get("status"):
        goal["status"] = "clear"
    state.goal = goal




def _done_claim_rejections(state: V5SessionState, fingerprint: str) -> int:
    """**同一份产出上**已经被驳回过几次。

    抄 grok `blocked_reason` 那句「3+ consecutive failed attempts at
    **the same problem**」里的 the same problem——「同一个问题」不是「连续」，
    是「产出没变」。用 `deliverable_fingerprint`（SPEC + 页面 + 模型版本）当键：
    模型补画了几页、指纹就变了，计数自然归零。那才是它该归零的时刻。

    ⚠ 不另开一份「产出动没动」的口径（§4 那张表）。turn_narration 那把尺子
      已经在被叙述侧用着，这儿再拼一个 hash 就是两处会漂的实现。
    """
    if not fingerprint:
        return 0
    n = 0
    for row in getattr(state, "controlTranscript", None) or []:
        if not isinstance(row, dict) or row.get("kind") != "done_claim":
            continue
        if row.get("verdict") != DoneVerdict.NOT_ACHIEVED.value:
            continue
        if str(row.get("fingerprint") or "") == fingerprint:
            n += 1
    return n


def _confirmed_restatement(state: V5SessionState, user_text: str) -> str:
    return _restate(_session_topic(state)) or _restate(user_text)


def _is_slash_rehearse(user_text: str) -> bool:
    text = (user_text or "").strip()
    return text.startswith("/推演") or text == "推演"


def resolve_forced_tool(
    payload: Dict[str, Any], user_text: str, *, first_pass: bool = False
) -> Optional[str]:
    """把 payload + 人话解析成这一轮要强制跑的那一跳。

    first_pass：这个会话还没有任何交付物（没 SPEC 也没页面）。此时用户这句
    是**产品话题**，不是针对交付物的指令，文本里的 hop 词一律不算数。
    """
    text = (user_text or "").strip()
    raw = payload.get("forcedTool") or payload.get("forced_tool")
    forced = (
        raw.strip()
        if isinstance(raw, str) and raw.strip() in CLOSED_TOOLS
        else None
    )
    # 人话点明某一跳：只许盖掉上一跳留下的 factory hop（pages 等残留），
    # 不许盖掉 rehearse / refine / repair / restore_version 这类显式意图。
    #
    # 2026-09-03 真机：确认继续把 pending 钉成 pages，随后「进入数据模型
    # 反推（Structure）」仍 POST pages，uvicorn `[control] forced hop=pages`。
    # 2026-09-04 审查：把文本提到 forcedTool 之前修过头——新会话话题含
    # 「结构」时，开始推演的 forcedTool=rehearse 被劫持成 structure，
    # 撞上「还没有页面」。只压残留 hop，不压显式意图。
    #
    # ⚠ 2026-09-04 真机（社区旧物置换站，话题里有「数据结构」）：上面那条
    #   护栏**整个没生效**——前端首轮点火按设计不带 rehearse（见
    #   useSlideRuleSession:120 的注释「/推演 不得在客户端带 rehearse」），
    #   于是 forced 是 None，`forced is None` 反而放行了文本。
    #   uvicorn 只留下一行 `[control] forced hop=structure hasSpec=0 hasPages=0`，
    #   后面连 capabilityPlan= 都没有——点了没反应。
    #   单测当时是绿的：它喂了 forcedTool='rehearse'，而真机根本不传。
    #   §1「先确认哪条链真的在跑」。
    #   根子是**话题不是指令**：首轮没有可供反推/绑定的交付物。
    # 括号里的闭集名（含 refine）优先；中文工厂启发式兜底「继续画页面」。
    hop = None if first_pass else (
        closed_tool_from_text(text) or factory_hop_from_text(text)
    )
    if hop and (forced is None or forced in FACTORY_HOPS):
        return hop
    if forced:
        return forced
    if str(payload.get("mode") or "").strip().lower() == "repair":
        return "repair"
    if text.startswith("/精修"):
        return "refine"
    if text.startswith("/质疑"):
        return "challenge"
    if text.startswith("/范围"):
        return "enter_plan_mode"
    if text.startswith("/回退"):
        return "restore_version"
    return None


def _dump_state(state: V5SessionState) -> Dict[str, Any]:
    stamp_control_plan_kind(state)
    return state.model_dump()


def _complete(state: V5SessionState) -> Dict[str, Any]:
    return {"type": "complete", "state": _dump_state(state)}


def _persist_durable_state(state: V5SessionState) -> V5SessionState:
    guard_control_run()
    try:
        port = current_checkpoint.get()
        fence = port.fence() if port is not None else None
        if port is not None and not isinstance(fence, dict):
            raise ControlRunStopped("control_fence_missing")
        return save_session(state, server_write=True, require_durable=True,
                            expected_control_run=fence)
    except Exception as exc:
        if current_checkpoint.get() is not None:
            raise ControlRunStopped("control_session_persist_failed") from exc
        raise


def _persist(state: V5SessionState) -> V5SessionState:
    """控制面的落盘口。

    ⚠ `server_write=True` 不是随手加的：控制面写的多半是**纯标量翻转**
      （assumptionsConfirmed、awaitReason、runtimePhase），零集合增长，
      而 persistence 的同轮守卫此前只认「有增长」→ 这些写入一直在被静静
      丢掉。2026-09-04 真机：假设卡确认后刷新，同一张卡又摊回来
      （详见 persistence._resolve_write_state 的 server_write 头注）。
    """
    guard_control_run()
    if current_checkpoint.get() is not None:
        return _persist_durable_state(state)
    return save_session(state, server_write=True)


async def _apersist(state: V5SessionState) -> V5SessionState:
    """落盘挪出事件循环。

    ⚠ 2026-08-27 评审：`save_session` 是**同步**的，而这台机器上的会话后端
      是「自定义 HTTPS SQL 网关」——一次落盘就是一次同步 HTTP。直接在
      async 生成器里调，整个事件循环停在那里：单人开发看不出来，**两个人
      同时推演就互相卡**（对方的 SSE 一个字都不出）。

    ⚠ 走 starlette 的 `run_in_threadpool`（FastAPI 跑同步 endpoint 用的就是
      它），不是自己 new 线程池：它跟着请求上下文走、有并发上限、
      contextvars 会被带进工作线程（`_CONTROL_PAYLOAD` 靠这个）。

    ⚠ 包一层而不是把 `_persist` 直接改成 async：漏改一处的话，
      `_persist(...)` 会变成"造了个协程没人 await"——**不报错、也不落盘**，
      是最难查的那种。现在漏改一处只是那处仍然阻塞，行为不变。
    """
    return await run_in_threadpool(_persist, state)


async def _settled(
    state: V5SessionState, events: AsyncIterator[Dict[str, Any]]
) -> AsyncIterator[Dict[str, Any]]:
    """昂贵按钮这条出口**一定**以终局事件收尾。

    见 `_TERMINAL_EVENTS` 的注释：漏一个 `complete`，客户端不是"没反应"，
    而是报「推演中断」并把这一轮开始前的快照 PUT 回去，把服务端已经做成的
    事（比如版本回退）原地抹掉。

    ⚠ 兜底只在**没出过**终局事件时补一个，不是无脑追加：多发一个 complete
      会让客户端把中途状态当最终状态。handoff 不是终局（工厂还在同一条
      SSE 里）——见 `_TERMINAL_EVENTS` 2026-09-02 那条。
    """
    settled = False
    async for event in events:
        if str(event.get("type") or "") in _TERMINAL_EVENTS:
            settled = True
        yield event
    if not settled:
        yield _complete(state)


_SLASH_VERBS = ("/推演", "/精修", "/质疑", "/范围", "/回退")


def _restate(user_text: str) -> str:
    """复述句。斜杠动词剥掉；剥空返回空串，让调用方落到 original_goal。

    ⚠ 2026-08-27：第一版只剥 `/推演`，且 `stripped or text` 把裸 `/范围`
    填回去——卡标题变成「将做成：/范围」，goal 再没用上。
    """
    import re

    text = (user_text or "").strip()
    stripped = re.sub(
        r"^(请)?(帮我)?(做一?个|搭建|设计一?个|构建|开发一?个|建一?个|来一?个|create|build|design)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(r"[。！？.!?]+$", "", stripped).strip()
    for cmd in _SLASH_VERBS:
        if stripped == cmd or stripped.startswith(cmd):
            stripped = stripped[len(cmd) :].strip()
            break
    if not stripped or stripped.startswith("/"):
        return ""
    # ⚠ 纯确认不能当复述句。剥空返回空串，让调用方顺着兜底链往下走
    #   （照 grok 的 `normalize_title(primary).or_else(|| normalize_title(fallback))`）。
    #   守卫放在**这一份**里，不放在四个调用点上——放调用点就是同一件事五处
    #   实现，改一处等于四处静默地还是老样子（CLAUDE.md §4）。
    if _is_content_free_reply(stripped):
        return ""
    return stripped


def _restatement_chain(
    state: V5SessionState, user_text: str, original_goal: str
) -> str:
    """本轮复述句的兜底链。

    照 grok `xai-grok-foreign-sessions/src/codex/mod.rs`：
        fn title(primary: &str, fallback: &str) -> Option<String> {
            normalize_title(primary).or_else(|| normalize_title(fallback))
        }
    一处链条，四个 park 点共用。第三段是这次补的：用户第一句实话——
    没有它，「空会话 + 问过澄清 + 用户回一句确认」这条真机路径上前两段都是空。
    """
    return (
        _restate(user_text)
        or _restate(original_goal)
        or _restate(first_substantive_user_text(state))
    )


def _previous_model_version_id(state: V5SessionState) -> str:
    """当前指针的上一版。对不上 / 已经是第一版 → 空（fail-closed）。"""
    versions = list(getattr(state, "modelVersions", None) or [])
    ids: List[str] = []
    for row in versions:
        vid = ""
        if isinstance(row, dict):
            vid = str(row.get("id") or "").strip()
        else:
            vid = str(getattr(row, "id", "") or "").strip()
        if vid:
            ids.append(vid)
    if not ids:
        return ""
    current = str(getattr(state, "currentModelVersionId", None) or "").strip()
    if current and current in ids:
        idx = ids.index(current)
    else:
        idx = len(ids) - 1
    if idx > 0:
        return ids[idx - 1]
    return ""


def _inspect_digest(state: V5SessionState) -> tuple[str, str]:
    """有界摘要。缺模型 → fail-open 空摘要 + 一句人话。永不倒出原始五系统 JSON。"""
    human = "当前还没有五系统模型可查看。"
    model: Optional[Dict[str, Any]] = None
    try:
        from services.v5_full_driver import extract_model_from_closure

        closure = getattr(state, "publishClosure", None)
        model = extract_model_from_closure(closure) if closure is not None else None
        if model is None:
            versions = list(getattr(state, "modelVersions", None) or [])
            current_id = getattr(state, "currentModelVersionId", None)
            for row in reversed(versions):
                if not isinstance(row, dict):
                    continue
                if current_id and row.get("id") != current_id:
                    continue
                if isinstance(row.get("model"), dict):
                    model = row["model"]
                    break
            if model is None:
                for row in reversed(versions):
                    if isinstance(row, dict) and isinstance(row.get("model"), dict):
                        model = row["model"]
                        break
    except Exception:  # noqa: BLE001 — 增强类 fail-open
        model = None
    if not isinstance(model, dict) or not model:
        return "", human

    items: List[str] = []

    def walk(prefix: str, value: Any) -> None:
        if len(items) >= INSPECT_MAX_ITEMS:
            return
        if isinstance(value, dict):
            for key, child in list(value.items())[:12]:
                walk(f"{prefix}.{key}" if prefix else str(key), child)
        elif isinstance(value, list):
            items.append(f"{prefix}: {len(value)} items")
        else:
            text = str(value)
            if len(text) > 80:
                text = text[:77] + "..."
            items.append(f"{prefix}: {text}")

    walk("", model)
    digest = "\n".join(items[:INSPECT_MAX_ITEMS])
    if len(digest) > INSPECT_MAX_CHARS:
        digest = digest[:INSPECT_MAX_CHARS]
    return digest, "当前模型摘要（有界，不是原始五系统 JSON）。"


async def _park_ask(
    state: V5SessionState,
    question: str,
    options: Optional[List[str]] = None,
    *,
    questions: Optional[List[Dict[str, Any]]] = None,
    assumption_snapshot: Optional[List[Dict[str, Any]]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """停下来问。**一次可以问几道**（抄 grok `AskUserQuestion`）。

    ⚠ `question` / `options` 两个老字段留着，值是**第一道题的投影**。
      不是懒得删：`awaitDetail`、`_last_need_question`、水合时摊回卡的那条路
      全按单题写的，一起改会把「刷新之后卡还在」那条链一并动了。
      多题走 `questions`，单题两边一致——判据
      `test_ask_user_carries_every_question` 钉着"两个字段说的是同一道题"。
    """
    rows = list(questions or [])
    if not rows:
        rows = [
            {
                "id": "q1",
                "question": question,
                "options": [{"label": str(o)} for o in (options or [])],
            }
        ]
    head = rows[0]
    question = str(head.get("question") or question or "")
    flat = [str(o.get("label") or "") for o in (head.get("options") or [])]
    published = state
    state = state.model_copy(deep=True)
    state.runtimePhase = "awaiting"
    state.awaitReason = "control_ask"
    state.awaitDetail = question
    req_id = f"need-{uuid.uuid4().hex[:10]}"
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "ask_user_question",
            "text": question,
            "options": flat,
            "questions": rows,
            "reqId": req_id,
            **({"assumptionSnapshot": copy.deepcopy(assumption_snapshot)} if assumption_snapshot is not None else {}),
        },
    )
    await _commit_question_state(published, state)
    yield {
        "type": "control_ask_user",
        "question": question,
        "options": flat,
        "questions": rows,
        "reqId": req_id,
    }
    yield _complete(state)


async def _park_plan_approval(state: V5SessionState) -> AsyncIterator[Dict[str, Any]]:
    plan = latest_control_plan(state)
    if not str(plan.get("planContent") or "").strip():
        yield {"type": "control_tool_result", "tool": "exit_plan_mode", "ok": False, "error": "empty_plan"}
        return
    candidate = state.model_copy(deep=True)
    rows = getattr(candidate, "controlTranscript", None) or []
    request = next((r for r in reversed(rows) if r.get("kind") == "plan_approval"), {})
    if not (
        state.awaitReason == "control_plan_approval"
        and all(request.get(k) == plan.get(k) for k in ("planId", "revision", "planContent"))
    ):
        request = {
            "role": "assistant", "kind": "plan_approval",
            "reqId": f"plan-approval-{uuid.uuid4().hex}",
            **{k: plan[k] for k in ("planId", "revision", "planContent")},
            "deliverableKind": plan_deliverable_kind(plan),
        }
        _append_transcript(candidate, request)
    candidate.runtimePhase = "awaiting"
    candidate.awaitReason = "control_plan_approval"
    candidate.awaitDetail = str(plan["planContent"])
    await _commit_plan_state(state, candidate)
    yield {"type": "control_plan_approval", "reqId": request["reqId"], "planContent": plan["planContent"]}
    yield _complete(state)


async def _settle_runtime_cap(
    state: V5SessionState,
    reason: ControlStopReason,
    stop: Dict[str, Any],
) -> AsyncIterator[Dict[str, Any]]:
    """额度 / 轮次 / 墙钟到顶。计划已经写好就停在批准卡，不许再说没点火。

    ⚠ 2026-09-14 真机 sr-20260914171745-3PCJ39MFGV：write_plan 17:47:31
      已经落了中文实施计划，下一发采样 17:47:58 才对上 token_budget
      12458/8000。exit_plan_mode 没发出去，用户看见的是「思考额度用完了，
      先停在控制面没点火」。跟 2026-09-09 工厂出过货还说没点火同一个病。

    停在批准卡不是点火：project_create / drive-full 仍要用户确认之后才走。
    """
    if _unapproved_plan_ready(state):
        async for event in _park_plan_approval(state):
            yield event
        return
    async for event in _canned(state, _cap_speech(state, reason), stop=stop):
        yield event


async def _flush_write_plan_from_sample(
    state: V5SessionState,
    result: ControlLlmResult,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    original_goal: str,
) -> AsyncIterator[Dict[str, Any]]:
    """这一发已经带了 write_plan，账却在派发前就算超了。

    计划正文在 arguments 里，不派发就等于白写。点火仍被闸住。
    """
    if _unapproved_plan_ready(state) or plan_execution_authorized(state):
        return
    for call in result.tool_calls or []:
        if str(call.get("name") or "") != "write_plan":
            continue
        args = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
        async for event in _logged_tool_events(
            state,
            _dispatch_tool(
                "write_plan",
                args,
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                original_goal,
            ),
        ):
            yield event
        return


async def _commit_plan_state(state: V5SessionState, candidate: V5SessionState) -> None:
    """Publish plan state only after storage confirms the exact revision."""
    stamp_control_plan_kind(candidate)
    wanted = next(
        (
            _plan_written_kind(row)
            for row in reversed(getattr(candidate, "controlTranscript", None) or [])
            if _plan_written_kind(row)
        ),
        None,
    )
    saved = await run_in_threadpool(
        _persist_durable_state, candidate
    )
    # persist-as-authority：磁盘剥了键就写回去。GET 只认落盘，不认内存。
    if wanted and _plan_written_kind(latest_control_plan(saved)) != wanted:
        rows = list(getattr(saved, "controlTranscript", None) or [])
        restored: list[Any] = []
        seen = False
        for row in reversed(rows):
            if not seen and isinstance(row, dict) and row.get("kind") == "plan_written":
                restored.append({**row, "deliverableKind": wanted})
                seen = True
            else:
                restored.append(row)
        saved.controlTranscript = list(reversed(restored))
        saved = await run_in_threadpool(_persist_durable_state, saved)
    for field in ("controlTranscript", "awaitReason", "awaitDetail", "runtimePhase", "goal"):
        setattr(state, field, getattr(saved, field))


async def _commit_question_state(state: V5SessionState, candidate: V5SessionState) -> None:
    """Do not expose a question or consume its answer before durable storage."""
    saved = await run_in_threadpool(
        _persist_durable_state, candidate
    )
    for field in ("controlTranscript", "awaitReason", "awaitDetail", "runtimePhase",
                  "specFirstPages", "coverageGaps"):
        setattr(state, field, getattr(saved, field))


async def _accept_plan_answer(state: V5SessionState, raw: Dict[str, Any]) -> str:
    """The request id authorizes only the persisted revision that was shown."""
    rows = getattr(state, "controlTranscript", None) or []
    request = next((r for r in reversed(rows) if r.get("kind") == "plan_approval"), {})
    plan = latest_control_plan(state)
    if (
        state.awaitReason != "control_plan_approval"
        or not request.get("reqId")
        or str(raw.get("reqId") or "") != request["reqId"]
        or not all(request.get(k) == plan.get(k) for k in ("planId", "revision", "planContent"))
    ):
        return "stale"
    outcome = str(raw.get("outcome") or "cancelled")
    if outcome not in ("approved", "cancelled", "abandoned"):
        outcome = "cancelled"
    # The loaded object may also be the cache entry. Never publish a grant in
    # that object before storage confirms the write.
    candidate = state.model_copy(deep=True)
    _append_transcript(candidate, {
        "role": "user", "kind": f"plan_{outcome}",
        **{k: request[k] for k in ("reqId", "planId", "revision", "planContent")},
        "deliverableKind": plan_deliverable_kind(plan),
        "feedback": str(raw.get("feedback") or ""),
    })
    candidate.awaitReason = None
    candidate.awaitDetail = None
    candidate.runtimePhase = "idle"
    if outcome == "approved":
        _write_confirmed_goal(candidate, _session_topic(candidate))
    await _commit_plan_state(state, candidate)
    return outcome


def _model_text_for_answer(
    raw: Dict[str, Any], state: V5SessionState
) -> Optional[str]:
    """结构化答案 → 回给模型的那段话。四条路径抄 grok `format.rs`。

        accepted   选完提交了
        cancelled  明确不答 —— **不是错误**，别回成 error
        chat       想先聊聊：答了的算数，没答的换个问法再问
        skip       别再问了，直接开干

    ⚠ 认不出结构就返回 None，调用方用前端送来的自然语言兜底。
      认不出 ≠ 出错：老前端、老回执、脚本手打的一句话都走这条。
    """
    outcome = str(raw.get("outcome") or "").strip().lower()
    answers_raw = raw.get("answers")
    if not outcome and not isinstance(answers_raw, dict):
        return None
    questions = _last_asked_questions(state)
    answers = normalize_user_answers(answers_raw)
    notes_raw = raw.get("notes")
    notes = (
        {str(k): str(v) for k, v in notes_raw.items()}
        if isinstance(notes_raw, dict)
        else {}
    )
    if outcome in ("cancelled", "cancel", "dismissed"):
        return unanswered_question_text(bool(raw.get("nonInteractive")))
    if outcome in ("chat", "chat_about_this"):
        return format_chat_answers(questions, answers)
    if outcome in ("skip", "skip_interview"):
        return format_skip_answers(questions, answers)
    if not answers:
        return None
    return format_answers_for_model(questions, answers, notes)


def _last_asked_questions(state: V5SessionState) -> List[Dict[str, Any]]:
    """上一发问出去的那几道题。回喂要带问句原文——模型看不见自己上一发。"""
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if not isinstance(row, dict):
            continue
        if row.get("role") == "assistant" and row.get("kind") in ("ask_user_question", "ask_user"):
            rows = row.get("questions")
            if isinstance(rows, list) and rows:
                return [r for r in rows if isinstance(r, dict)]
            return [{"id": "q1", "question": str(row.get("text") or ""), "options": []}]
    return []


def _tool_answer_from_payload(
    payload: Dict[str, Any], state: V5SessionState, user_text: str
) -> Optional[Dict[str, str]]:
    """这一发是不是对停泊提问的回执（grok NeedUserAnswer → UserAnswer）。

    抄 grok：答案是当前工具的回执，不是新的 HumanIntent。
    本请求仍结束在 park（合同第 3 条：不许同一 HTTP 空转等用户）；
    **下一发 POST** 才是纸条，不是新开一单。
    """
    raw = payload.get("toolAnswer") or payload.get("tool_answer")
    if isinstance(raw, dict):
        kind = str(raw.get("kind") or "").strip()
        text = str(raw.get("text") or user_text or "").strip()
        # ⚠ 结构化答案优先：`answers` 在，就按 grok 那四条路径之一造回喂的话，
        #   不用前端拼好的自然语言。抄 grok `format.rs` 头注那句——
        #   「Each function produces the **exact** model-visible string for one
        #   of the four user-action paths.」措辞由**这一层**拥有，
        #   前端换个说法不该改变模型看到的东西（本仓 §四）。
        structured = _model_text_for_answer(raw, state)
        if structured:
            text = structured
        req_id = str(raw.get("reqId") or raw.get("req_id") or "").strip()
        if kind or text or raw.get("confirmed"):
            if not kind:
                reason = getattr(state, "awaitReason", None)
                if reason == "control_ask":
                    kind = "ask_user_question"
                elif reason == "control_clarify":
                    kind = "clarify"
                else:
                    kind = "ask_user_question"
            if kind not in ("ask_user_question", "ask_user", "clarify"):
                return None
            out = {"kind": kind, "text": text, "outcome": raw.get("outcome"), "answers": raw.get("answers"), "notes": raw.get("notes")}
            if req_id:
                out["reqId"] = req_id
            return out
    reason = getattr(state, "awaitReason", None)
    # 作曲家另说一句不是答澄清卡。答卡必须带 toolAnswer（前端「」答：）。
    # ⚠ 2026-09-08 真机：卡还摊着，用户打「你好」被当成谁用的答案，
    #   再 stamp 成 goal，问卷又弹一轮。
    if reason == "control_ask" and str(user_text or "").strip():
        return {
            "kind": "ask_user_question",
            "text": str(user_text).strip(),
        }
    # 只认确认短语。forcedTool=pages 单独不算——未确认时偷画页
    # 是 2026-09-02 真机事故，不许用 NeedUserAnswer 再开一条口。
    return None


def _last_need_question(state: V5SessionState) -> str:
    detail = str(getattr(state, "awaitDetail", None) or "").strip()
    if detail:
        return detail
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if not isinstance(row, dict):
            continue
        if row.get("kind") in ("ask_user_question", "ask_user", "clarify"):
            return str(row.get("text") or "").strip()
    return ""


def _last_need_req_id(state: V5SessionState) -> str:
    """grok 用同一条 req_id 把 NeedUserAnswer 和 UserAnswer 对上。"""
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if not isinstance(row, dict):
            continue
        if row.get("kind") in ("ask_user_question", "ask_user", "clarify"):
            rid = str(row.get("reqId") or "").strip()
            if rid:
                return rid
    return ""


async def _stamp_user_answer(
    state: V5SessionState, payload: Dict[str, Any], answer: Dict[str, str]
) -> None:
    """把点选写进 transcript（kind=user_answer），清停泊。不点火。

    ⚠ 合同第 3 条：本请求仍在 park 时结束。下一发 POST 才是这张纸条。
    点名了闭集工具的话，点火走 `_run_control_turn_body` 同一份 forced
    分发——第一版在这里 `_settled(_dispatch_tool)` 直接 return，工厂
    complete 被 nest 成 factory_complete，host 再也没有 complete，
    客户端报「推演中断」（2026-09-02 同一条伤，CLAUDE.md §4）。
    """
    user_text = answer.get("text") or ""
    kind = answer.get("kind") or "ask_user_question"
    question = _last_need_question(state)
    req_id = str(answer.get("reqId") or "").strip() or _last_need_req_id(state)
    if (
        req_id != _last_need_req_id(state)
        or state.awaitReason not in ("control_ask", "control_clarify")
        or any(r.get("kind") == "user_answer" and r.get("reqId") == req_id
               for r in state.controlTranscript)
    ):
        raise HTTPException(409, "question_answer_stale")
    asked = next((r for r in reversed(state.controlTranscript) if r.get("reqId") == req_id and r.get("kind") in ("ask_user_question", "ask_user")), {})
    snapshot = asked.get("assumptionSnapshot")
    if isinstance(snapshot, list) and ((_sfp(state).get("spec") or {}).get("assumptions") != snapshot):
        raise HTTPException(409, "assumption_revision_changed")
    published = state
    state = state.model_copy(deep=True)
    row: Dict[str, Any] = {
        "role": "tool",
        "kind": "user_answer",
        "text": user_text,
        "answerKind": kind,
        "question": question,
        "answers": normalize_user_answers(answer.get("answers")),
        "outcome": answer.get("outcome"),
        "notes": answer.get("notes"),
    }
    if req_id:
        row["reqId"] = req_id
    _append_transcript(state, row)
    reason = getattr(state, "awaitReason", None)
    if reason in ("control_ask", "control_clarify"):
        state.awaitReason = None
        state.awaitDetail = None
        if getattr(state, "runtimePhase", None) == "awaiting":
            state.runtimePhase = "idle"
    if isinstance(snapshot, list):
        sfp = copy.deepcopy(getattr(state, "specFirstPages", None) or {})
        spec = sfp.get("spec") or {}
        picks = normalize_user_answers(answer.get("answers"))
        notes = answer.get("notes") if isinstance(answer.get("notes"), dict) else {}
        for assumption in spec.get("assumptions") or []:
            qid = str(assumption.get("id") or "")
            values = picks.get(qid) or []
            if values:
                assumption["decision"] = "；".join(values)
                if notes.get(qid):
                    assumption["decision"] += "；" + str(notes[qid])
        sfp["assumptionsConfirmed"] = (
            answer.get("outcome") in ("skip", "skip_interview")
            or (answer.get("outcome") in ("accepted", "accept") and all(picks.get(str(a.get("id") or "")) for a in snapshot))
        )
        state.specFirstPages = sfp
    await _resolve_answered_gaps(state, payload, persist=False)

    # ⚠ 2026-09-09：这里曾把 ask_user 答案写进 goal。下一行又把
    #   original_goal 刷新成这句话，`_can_auto_grant_scope` 立刻为真，
    #   乱码回执变成「我认成了：sfljsdlf」并点着 SPEC。
    #   目标只在 scope_card / 开始推演 时由 `_write_confirmed_goal` 写。

    await _commit_question_state(published, state)


def _user_turn_before_need(state: V5SessionState, answer_text: str) -> str:
    """提问之前用户说的那句。答案本身不算。"""
    rows = [
        r
        for r in (getattr(state, "controlTranscript", None) or [])
        if isinstance(r, dict)
    ]
    cut = len(rows)
    for i in range(len(rows) - 1, -1, -1):
        if rows[i].get("kind") in ("ask_user_question", "clarify") and rows[i].get(
            "role"
        ) == "assistant":
            cut = i
            break
    needle = (answer_text or "").strip()
    for row in reversed(rows[:cut]):
        if row.get("role") != "user" or row.get("kind") != "turn":
            continue
        text = str(row.get("text") or "").strip()
        if text and text != needle:
            return text[:500]
    for row in rows:
        if row.get("role") != "user" or row.get("kind") != "turn":
            continue
        text = str(row.get("text") or "").strip()
        if text and text != needle:
            return text[:500]
    return ""


def _repair_function_call_turn_order(
    messages: List[Dict[str, Any]], *, fallback_user: str
) -> List[Dict[str, Any]]:
    """Gemini：function call 必须紧跟 user 或 function response。

    ⚠ 2026-09-08：`_messages_after_need_answer` 第一版是
      system → assistant(tool_calls) → tool。网关 400
      「function call turn comes immediately after a user turn or
      after a function response turn」。答案走 tool 是对的，缺的是
      提问前那句 user。
    """
    out = list(messages)
    i = 0
    while i < len(out) and out[i].get("role") == "system":
        i += 1
    if i >= len(out):
        return out
    head = out[i]
    if head.get("role") == "assistant" and head.get("tool_calls"):
        text = (fallback_user or "").strip() or "你好"
        out.insert(i, {"role": "user", "content": text})
    return out


def _messages_after_need_answer(
    state: V5SessionState, user_text: str, answer: Dict[str, str]
) -> List[Dict[str, Any]]:
    """开放式回答：提问是上一轮 tool_call，答案是 tool result。

    答案不许塞 role=user——七个字的「请假」会变成新话题。
    提问前那句 user 必须在：Gemini 不允许 function call 直接跟在 system 后面。
    """
    kind = answer.get("kind") or "ask_user_question"
    question = str(answer.get("question") or "").strip() or _last_need_question(state)
    tool_name = "clarify" if kind == "clarify" else "ask_user_question"
    call_id = (
        str(answer.get("reqId") or "").strip()
        or _last_need_req_id(state)
        or f"need-{uuid.uuid4().hex[:8]}"
    )
    prior = _user_turn_before_need(state, user_text) or "你好"
    return [
        {"role": "system", "content": _system_prompt(state)},
        {"role": "user", "content": prior},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(
                            {"question": question}, ensure_ascii=False
                        ),
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": call_id,
            "content": bound_tool_result(
                {"ok": True, "kind": kind, "answer": user_text, "question": question}
            ),
        },
    ]


# 这句需求里通常会漏掉的四个维度。**只当提示，不当闸。**
#
# ⚠ 旧的 TS 那套（shared/blueprint/sliderule-readiness-chain.ts 的
#   SPEC_DIMENSIONS + isUnderSpecifiedGoal）把它做成了硬判定：命中 <2 才问、
#   目标 ≥80 字直接算"已充分规约、一个问题都不问"。结果是一句 100 字的
#   废话不问，一句 30 字的好需求反倒被问四条模板题。
#   参考成熟做法（dzhng/deep-research 的 generateFeedback）：**问几条交给模型**
#   ——"最多 N 条，本来就清楚就少问或不问"，规则只负责告诉它"这句话里我没读到
#   用户/平台/场景/边界"，问不问、问什么由模型看着办。
_SPEC_DIMENSIONS: List[tuple] = [
    ("users", "谁用（角色）", r"用户|面向|客户|员工|老师|学生|医生|护士|患者|商家|管理员|团队|老板|摊主|店长|to ?[cb]"),
    ("platform", "在哪用（平台）", r"平台|web|网页|ios|android|安卓|小程序|桌面|客户端|pc|手机|大屏"),
    ("scenario", "核心流程与验收", r"流程|场景|用于|目标是|核心|kpi|指标|验收|成功标准|解决|审批|下单|结算"),
    ("scope", "本期边界", r"范围|不做|边界|mvp|仅|只做|首期|第一期|优先|暂不"),
]


def _missing_dimensions(goal_text: str) -> List[str]:
    """这句需求里**没读到**的维度（人话标签）。只用于提示模型。"""
    import re as _re

    text = (goal_text or "").strip()
    out: List[str] = []
    for _key, label, pattern in _SPEC_DIMENSIONS:
        if not _re.search(pattern, text, _re.IGNORECASE):
            out.append(label)
    return out


# ── 「这句用户话里有没有新信息」──────────────────────────────────────────
#
# 抄的标准答案：grok-build `xai-chat-state/src/compaction_utils.rs`
#
#     /// Return `true` when the *extracted* query text represents a synthetic
#     /// session-internal turn rather than a real human-authored prompt.
#     pub fn is_synthetic_extracted_query(text: &str) -> bool { … }
#
#     /// This is the single source of truth for "real user" classification
#     /// in the compaction pipeline.
#     pub fn is_real_user_turn(item: &ConversationItem) -> bool { … }
#
# 以及取数口拆成两个、各写明给谁用：
#     get_first_user_text()        会话身份（注释里写 "e.g. for memory context search"）
#     get_last_user_query_text()   本轮动作（且先剥掉元数据标签）
#
# ⚠ 抄不动的那一半：grok 的"不算真用户话"只包括**系统自己塞进去的**文本
#   （auto-continue、bootstrap reminder）。本仓的空确认是**人说的**——
#   「就按上面这个推演」。全库扫过 ok/yes/sure/继续 这些词，两家都没有这个
#   概念，所以下面这份判定是自己定的，不是抄来的。
#
# ⚠ 为什么需要它（2026-08-27 真机 + 探针）：控制面喂给模型的 messages 只有
#   两条——system 一条 + **当前这句** user。探针实测：
#
#       [system] …当前目标：（尚无确认的应用目标）。停泊：none。
#                已经问过一轮澄清，不要再问，直接 scope_card。
#       [user]   就按上面这个推演
#       原话题出现在 messages 里？ -> False
#
#   模型被要求"直接开范围卡"，而它对世界的全部认知就是那七个字。它只能编，
#   于是库里一排会话叫「按当前设定的应用范围进行推演」「基于已确认的需求开展
#   方案推演与可行性分析」——四个不同项目，四个一样的名字。
#
#   代价不止是标题难看：goal 变成一句一个业务点的场面话之后，
#   closure_relevance 判「样本不足以判定相关性（业务点 1 个 < 3），跳过」——
#   「产出对不对得上题」那道闸**整个失效**。2026-08-27 真机复现过一次。

#: 纯确认 / 指代 / 元词。剥光了就说明这句话没带新信息。
#: 盯**语素**不盯整句（CLAUDE.md §2）：整句白名单只能挡住写过的那几种说法。
_FILLER_TOKENS = (
    "就按上面这个", "就按上面", "按上面的", "照上面的", "上面这个", "上面那个",
    "刚才那个", "刚说的", "如上", "同上",
    "就这样", "就这么办", "就它了", "可以了", "没问题", "没毛病",
    "开始吧", "开始", "继续", "确认", "同意", "行吧", "好的", "好了",
    "麻烦了", "谢谢", "辛苦",
    "推演", "跑吧", "跑一下", "来吧", "走起",
    "ok", "okay", "yes", "yep", "yeah", "sure", "go", "go ahead", "confirm",
)
#: 单字确认。只在**整句就是它**时算数——"好用的排班系统"里的"好"不能算。
_FILLER_ALONE = ("好", "行", "嗯", "是", "对", "可", "中", "y", "ye")


def _is_exact_filler(text: str) -> bool:
    """整句就是确认词。不是问候名单——用户会说任意话。"""
    raw = (text or "").strip()
    if not raw:
        return True
    low = re.sub(
        r"[\s，,。.！!？?、~～;；:：'\"“”‘’()（）]+", "", raw.lower()
    )
    if not low:
        return True
    if low in _FILLER_ALONE:
        return True
    return low in {tok.lower() for tok in _FILLER_TOKENS}


def _is_content_free_reply(text: str) -> bool:
    """这句用户话是不是纯确认——没带任何新信息。

    判据落在**剥完还剩什么**上，不落在"是不是长得像某句话"上：
        就按上面这个推演          → 剥光 → True
        好                        → 整句是单字确认 → True
        继续做刚才那个排班的      → 剩「做那的排班」→ 有实词 → False
        大赛积分软件              → 一个语素都不沾 → False
    """
    import re as _re

    raw = (text or "").strip()
    if not raw:
        return True
    low = raw.lower()
    low = _re.sub(r"[\s，,。.！!？?、~～;；:：'\"“”‘’()（）]+", "", low)
    if not low:
        return True
    if low in _FILLER_ALONE:
        return True
    for token in sorted(_FILLER_TOKENS, key=len, reverse=True):
        low = low.replace(token, "")
    # 剩下的还有没有实词。中文 2 字起、拉丁 3 字起——低于这个长度的残渣
    # （"的"、"了"、"a"）不算信息。
    leftover = _re.sub(r"[的了吧呀啊呢嘛麽么把将给帮请下一个再又还都也就那这它他她我你们]+", "", low)
    leftover = _re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", leftover)
    cjk = len(_re.findall(r"[\u4e00-\u9fff]", leftover))
    latin = len(_re.findall(r"[0-9a-z]", leftover))
    return cjk < 2 and latin < 3


def first_substantive_user_text(state: V5SessionState) -> str:
    """会话里用户说的**第一句有内容的话**。

    照 grok 的 `get_first_user_text`：会话身份取第一句，不取最后一句。
    本轮该干什么仍然看 user_text——两个取数口分开，别再合成一个含混的
    「用户那句话」让所有人各取所需（那正是这次的病根）。
    """
    for row in getattr(state, "controlTranscript", None) or []:
        if not isinstance(row, dict):
            continue
        if row.get("role") != "user" or row.get("kind") != "turn":
            continue
        text = str(row.get("text") or "").strip()
        if text and not _is_content_free_reply(text):
            return text
    return ""


def _session_topic(state: V5SessionState) -> str:
    """这个会话到底在做什么。

    照 grok 的兜底链写法：
        fn title(primary: &str, fallback: &str) -> Option<String> {
            normalize_title(primary).or_else(|| normalize_title(fallback))
        }
    确认过的目标优先；还没确认就回到用户最初说的那句实话。
    """
    return _goal_text(state) or first_substantive_user_text(state)




def _retire_stale_control_questions(state: V5SessionState) -> None:
    """确认新范围时，把上一轮范围下的控制面提问置为 superseded。

    ⚠ 2026-08-27 真机：会话 goal 已经是「连锁宠物医院管理系统」，作曲家还在
      弹上一轮的「这个**诊所系统**首期主要服务哪几类核心角色？」。三条
      `gap-q-…` 全是 status=open / reason=control_plane_clarify，而 gap 上
      既没有 turnId 也没有 goal 引用——客户端判定不了归属，只能在这里收口。

    状态用 `waived`（既有闭集 Literal 的"免除/作废"档），不新造
    `superseded`：CoverageGap.status 是 open/resolved/waived 的闭集，
    Python 与 TS 两边都声明了——新造值要双边同步改，那是 KD22 已经付过
    学费的形状。作废是安全的：控制面从不往 contract.blockingGapIds 里加
    自己的提问，所以 waive 它们碰不到覆盖闸（见同名测试的反向判据）。

    只碰 `kind == "open_question"` 且 `reason == "control_plane_clarify"` 的：
    · 证据缺口 / 能力缺口是**门说了算**的，fail-closed，顺手关掉就是伪造
      绿灯（Claude.md §7）；
    · 工厂内 G_READY 出的澄清（reason 不是 control_plane_clarify）也不归
      控制面管。

    作废而不是删除：证据链要留痕，删了就没法解释这张卡去哪了。
    """
    gaps = list(getattr(state, "coverageGaps", None) or [])
    if not gaps:
        return
    now = _now_iso()
    changed = False
    out: List[Any] = []
    for g in gaps:
        row = g if isinstance(g, dict) else g.model_dump()
        if (
            row.get("kind") == "open_question"
            and row.get("reason") == "control_plane_clarify"
            and row.get("status") == "open"
        ):
            row = {**row, "status": "waived", "updatedAt": now}
            changed = True
            out.append(CoverageGap(**row))
        else:
            out.append(g)
    if changed:
        state.coverageGaps = out




_PRODUCING_HOPS = ("spec", "pages", "structure", "bind", "rehearse", "refine")


def _factory_tool_body(
    state: V5SessionState, tool: str, *, before_fingerprint: Optional[str] = None
) -> Dict[str, Any]:
    """WRITE 工具交回控制面的有界结果。不许倒出五系统 JSON。

    ⚠ 2026-09-02 食堂话题：第一版把 specFirstPages（dict）当 list 量，
      pageCount 恒 0，human 又是 inspect 的「还没有五系统模型」。SPEC
      单跳交回后模型以为工厂空转，host 就不调 pages——钟剩一格。

    ⚠ 2026-09-03 真机（宠物寄养 EBCW1P6FYT）：为了修上面那条，`ok` 被焊成
      恒 True——于是**再也表达不了「这一跳真的什么都没干」**。那天
      forcedTool=pages 带精修指令，驱动器的精修短路把整个执行循环 break 掉，
      一件活没干；回执照样 ok=true + 页面清单，控制面据此对用户说
      「宠物建档页的疫苗到期红色角标已更新，数据结构已同步」——
      而五页哈希逐字节没变。**接口返回 ok ≠ 它真的做了事**（CLAUDE.md §3）。

      现在 `ok` 由交付物指纹判定：产出型 hop 跑完指纹没变 = 这轮没产出，
      `ok=False` 且 human 直说。⚠ 修的时候别退回上面那条老坑：
      指纹**不看** pageCount，动了东西就是动了，不许因为"页数没变"报 0。
      `before_fingerprint` 缺省 None（老调用点 / 非产出 hop）时保持恒真。
    """
    digest, human = _inspect_digest(state)
    closure = getattr(state, "publishClosure", None)
    blocked = None
    if isinstance(closure, dict):
        blocked = closure.get("blocked")
    blob = _spec_first_blob(state)
    pages_map = blob.get("pages")
    page_n = len(pages_map) if isinstance(pages_map, dict) else 0
    spec_obj = blob.get("spec") if isinstance(blob.get("spec"), dict) else {}
    declared = spec_obj.get("pages") if isinstance(spec_obj, dict) else None
    declared_n = len(declared) if isinstance(declared, list) else 0
    hint = _after_write_hint(state)
    if _has_spec(state) and not _has_pages(state):
        human = "SPEC 已经起草，页面还没有。"
    elif _has_pages(state):
        human = f"已经出过 {page_n} 页。"
    bound_ids, failed_ids, skipped_ids = _bind_account(state)
    bound_n = len(bound_ids)
    skipped_n = len(skipped_ids)
    failed_n = len(failed_ids)
    changed: Optional[bool] = None
    ok = True
    if before_fingerprint is not None and tool in _PRODUCING_HOPS:
        changed = factory_deliverable_fingerprint(state) != before_fingerprint
        ok = changed
        if not changed:
            human = (
                f"这一跳（{tool}）跑完了，但交付物一个字节都没变——"
                "本轮没有产出，别当成已经改好。"
            )
    if tool == "bind" and page_n > 0 and (bound_n == 0 or failed_n):
        ok = False
        if failed_n:
            human = (
                f"已经出过 {page_n} 页，其中 {failed_n} 页 failed"
                f"（{'、'.join(failed_ids[:6])}）。"
                "不能当成已经全部接好，更不能说闭环完成。"
            )
        else:
            human = (
                f"这一跳没有把权限接到任何页面上（{skipped_n} 页 skipped）。"
                "不能当成已经接好，更不能说闭环完成。"
            )
    return {
        "ok": ok,
        "changed": changed,
        "tool": tool,
        "digest": (digest or "")[:INSPECT_MAX_CHARS],
        "human": human,
        "blocked": blocked,
        "hasSpec": _has_spec(state),
        "pageCount": page_n,
        "declaredPages": declared_n,
        "nextHint": hint,
        "versionId": getattr(state, "currentModelVersionId", None),
    }


async def _handoff_factory(
    state: V5SessionState,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    *,
    repair: bool = False,
    profile: str = "full",
    max_loops: int = 10,
    nest: bool = False,
) -> AsyncIterator[Dict[str, Any]]:
    """唯一点火插座。rehearse/refine/repair 必须走这里，禁止裸生成器。

    nest=True：工厂的 complete 改成 factory_complete，好让控制面 SSE
    在 WRITE 之后继续（抄 grok：工具流有自己的 Terminal，host 循环另算）。
    按钮点火也 nest：跳过的是点火前的 LLM，不是工厂后的 host 循环。
    """
    # 写权限闸（抄 grok 的 ToolScope）：只有声明了 WRITE 的工具能造新模型。
    # 缺省 READ ⇒ 新工具、拼错的名字、绕过分发直调，统统在这里被拦。
    assert_may_write_model()

    durable = await run_in_threadpool(load_session, str(state.sessionId or ""))
    if durable is None or durable.ownerId != state.ownerId or not plan_execution_authorized(durable):
        raise HTTPException(status_code=409, detail="plan_approval_required")
    try:
        resolve_archetype(durable)
    except (ArchetypeNotWired, UnknownArchetype) as exc:
        yield {"type": "control_text", "text": str(exc)}
        yield _complete(state)
        return

    from services import run_registry
    from services.product_charter import factory_charter_kwargs

    charter_kw = factory_charter_kwargs(_CONTROL_PAYLOAD.get())
    goal = dict(state.goal) if isinstance(state.goal, dict) else {}
    run_device = preferred_device_for_run(
        goal=goal,
        payload_device=preferred_device,
        texts=[user_text, str(goal.get("text") or "")],
    )
    await asyncio.to_thread(guard_control_run)
    run = await start_drive_full_factory_run(
        state.sessionId,
        user_text,
        installed_skills,
        active_connectors,
        run_device,
        design_system_id,
        repair=repair,
        profile=profile,  # type: ignore[arg-type]
        max_loops=max_loops,
        goal_tools=goal.get("tools"),
        require_session_id=True,
        expected_owner_id=state.ownerId,
        **charter_kw,
    )
    port = current_checkpoint.get()
    stopped = None

    async def watch_owner():
        nonlocal stopped
        while True:
            try:
                await asyncio.to_thread(port.guard)
            except ControlRunStopped as exc:
                stopped = exc
                run_registry.cancel_run(run.run_id)
                return
            await asyncio.sleep(0.25)

    watcher = asyncio.create_task(watch_owner()) if port is not None else None
    try:
        yield {
            "type": "control_handoff_factory",
            "runId": getattr(run, "run_id", None),
        }
        async with aclosing(run_registry.subscribe(run, since=0)) as stream:
            async for event in stream:
                if nest and str(event.get("type") or "") == "complete":
                    nested = dict(event)
                    nested["type"] = "factory_complete"
                    yield nested
                else:
                    yield event
    finally:
        if watcher is not None:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
            # The durable host owns this child even while no factory events
            # arrive. Closing its subscription alone would leave writes running.
            if run_registry.is_live(run):
                run_registry.cancel_run(run.run_id)
            if run.task is not None:
                await asyncio.gather(run.task, return_exceptions=True)
            if run.hard_cancelled:
                raise ControlRunStopped("control_factory_stop_unconfirmed")
    if stopped is not None:
        raise stopped


def _challenge_target(state: V5SessionState) -> Optional[str]:
    """这次质疑指向哪件产物。

    ⚠ **必须来自本回合的 POST。** 2026-08-27 评审逮到的断链：
      `_tool_challenge` 只拿 intent + text 造 UserIntervention，
      `invalidate_for_intervention` 三个 target 全空 → `initial_art_targets`
      空 → 级联整段跳过 → `staleArtifactIds` 一个都不加，而流里照样说
      「已按质疑失效相关产物」。三段（客户端解析 → POST → 服务端失效）各自
      都写了，接起来是空的——本仓第七条最坏的形态：**绿灯是假的**。

    ⚠ 客户端给的 id **要跟 artifacts 对一遍**。对不上就当没指到：
      往 staleArtifactIds 里塞一个不存在的 id 不会报错，只会让那份名单
      越长越脏，而且看着像"失效过了"。

    走 ContextVar 而不是加参数，跟 `_handoff_factory` 读 charter 是同一个
    机制（本回合信封），也逼着判据打在真 HTTP 上而不是直调函数。
    """
    payload = _CONTROL_PAYLOAD.get() or {}
    raw = str(
        payload.get("targetArtifactId") or payload.get("target_artifact_id") or ""
    ).strip()
    if not raw:
        return None
    for art in getattr(state, "artifacts", None) or []:
        aid = art.get("id") if isinstance(art, dict) else getattr(art, "id", None)
        if aid and str(aid) == raw:
            return raw
    return None


async def _tool_challenge(state: V5SessionState, user_text: str) -> AsyncIterator[Dict[str, Any]]:
    yield {"type": "control_tool_start", "tool": "challenge"}
    target = _challenge_target(state)
    before = set(getattr(state, "staleArtifactIds", None) or [])
    intervention = UserIntervention(
        intent="challenge",
        text=(user_text or "质疑").strip() or "质疑",
        targetArtifactId=target,
    )
    apply_user_intervention_invalidation(state, intervention)
    after = set(getattr(state, "staleArtifactIds", None) or [])
    newly = sorted(after - before)
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "challenge",
            "text": user_text,
            "targetArtifactId": target,
            "staleArtifactIds": newly,
        },
    )
    await _apersist(state)
    yield {
        "type": "control_tool_result",
        "tool": "challenge",
        "ok": True,
        # ⚠ detail 说的是**这次真的发生了什么**，不是"这个分支跑过了"。
        "detail": "invalidated" if newly else "no_target",
        "targetArtifactId": target,
        "staleArtifactIds": newly,
    }
    yield {
        "type": "control_text",
        # ⚠ 一件都没失效时**不许说已失效**（第七条）。说了就是假绿灯：
        #   用户以为那份产物已经作废，下一轮照样拿它当依据。
        "text": (
            f"已按质疑失效 {len(newly)} 件产物。需要的话再说一次要改什么。"
            if newly
            else "记下了这条质疑，但没有指到具体产物——没有任何产物被失效。"
            "点某张卡片上的「质疑」，或者说清是哪一份。"
        ),
    }
    yield _complete(state)


#: 证据检索的整体死线。供应商链是 12s × 最多 3 家
#: （services/mcp_tools._TIMEOUT_S），向量库那条真机上还可能更久——不封顶
#: 的话一次控制面轮次能被它拖住半分钟，而用户那头只看见一个转圈。
_SEARCH_DEADLINE_S = 20.0


async def _tool_search(state: V5SessionState, query: str) -> Dict[str, Any]:
    """查外部证据。**「查过了没有」和「没查成」必须分得开。**

    ⚠ 2026-08-27 修的就是这条：老版本任何失败都走
      `except Exception: hits = []`，然后照样返回 `ok=True` +
      「没有检索到可用片段。」+ 一条 provenance=control-search 的空证据行。
      Tavily 挂了、网断了、超时了——对模型和用户来说**跟"网上确实没有"
      长得一模一样**。这就是 CLAUDE.md §7 说的伪造绿灯：流程可以 fail-open
      （不该因为搜不到就打死整轮），但**结论不许 fail-open**。

    抄的标准答案：grok-build `xai-grok-session-search/src/bootstrap.rs`

        Err(_) => {
            // The abandoned spawn_blocking task runs to completion.
            log_bootstrap_timeout(&session_id, per_session_timeout.as_secs());
            progress.skipped.fetch_add(1, Ordering::Relaxed);
            return;
        }

    三件事一件不少：**限时**（per_session_timeout）、**放弃**、**记成
    skipped 而不是 indexed**。整轮继续跑，但那一份被如实记成"没做成"。

    ⚠ 这里**不**学上面 call_control_llm 改 async：`retrieve_evidence` 有 28 个
      同步调用方（整条工厂流水线），改 async 得把整条链一起改。而 grok 自己
      对这种天生阻塞的活也不是"想办法中断"，就是上面那段——**被放弃的线程
      会跑到底**（实测：wait_for 1.00s 返回，孤儿线程跑满 5.00s），这是
      已知且接受的代价，不假装它停了。
    """
    hits: List[Dict[str, Any]] = []
    outcome = "searched"
    try:
        from services.rag_service import retrieve_evidence

        # 同上：RAG 检索是同步的（可能带网络/向量库），一样不许坐在事件循环上
        raw = await asyncio.wait_for(
            run_in_threadpool(lambda: retrieve_evidence(query or "", top_k=6) or []),
            timeout=_SEARCH_DEADLINE_S,
        )
        for item in raw[:6]:
            if not isinstance(item, dict):
                continue
            hits.append(
                {
                    "title": item.get("title") or item.get("source") or "",
                    "content": str(item.get("content") or item.get("text") or "")[:400],
                    "provenance": "control-search",
                }
            )
    except asyncio.TimeoutError:
        # 超过死线：孤儿线程还在跑（见头注），但这一轮不再等它。
        hits, outcome = [], "abandoned"
    except Exception:  # noqa: BLE001 — 流程 fail-open，结论 fail-closed（见头注）
        hits, outcome = [], "failed"

    if outcome == "abandoned":
        summary = (
            f"证据检索超过 {int(_SEARCH_DEADLINE_S)} 秒未返回，已放弃。"
            "这一轮**没有**外部证据——不是「查过了、没有」，是没查成。"
        )
    elif outcome == "failed":
        summary = (
            "证据检索失败（外部检索不可用）。"
            "这一轮**没有**外部证据——不是「查过了、没有」，是没查成。"
        )
    else:
        summary = (
            "；".join(
                str(h.get("title") or h.get("content") or "")[:80] for h in hits if h
            )
            or "查过了，没有检索到可用片段。"
        )
    _append_transcript(
        state,
        {
            "role": "tool",
            "kind": "search_evidence",
            "text": query,
            "provenance": "control-search",
            # ⚠ outcome 必须进存档：会话读回来时，空 hits 到底是"查过没有"
            #   还是"没查成"，只有这个字段分得开。
            "outcome": outcome,
            "hits": hits,
        },
    )
    # 故意不碰 conversation / publishClosure / commit_artifact
    return {
        "ok": outcome == "searched",
        "outcome": outcome,
        "summary": summary,
        "hits": hits,
        "provenance": "control-search",
    }


async def _tool_inspect(state: V5SessionState) -> Dict[str, Any]:
    digest, human = _inspect_digest(state)
    _append_transcript(
        state,
        {"role": "tool", "kind": "inspect_model", "text": digest or human},
    )
    return {"ok": True, "digest": digest, "human": human}


async def _tool_restore(state: V5SessionState, version_id: str) -> Dict[str, Any]:
    """空 versionId 是静默 no-op（锁里找不到 id==""）。缺 id 必须 fail-closed。"""
    vid = (version_id or "").strip()
    if not vid:
        return {"ok": False, "error": "version_id required"}
    try:
        from fastapi.responses import JSONResponse

        from services.model_version_restore import restore_model_version_locked

        # ⚠ 2026-08-29：这里原来 import 的是 `routes.sliderule_full`——业务层反过来
        #   依赖路由层，方向是反的，还成了一个真的循环依赖。业务核已经下沉到
        #   services/model_version_restore，方向顺了（判据：架构闸的 baseline 少两条）。
        # 回退要重建闭环证据（可能走 LLM），是这条链上最重的一次同步调用
        result = await run_in_threadpool(
            restore_model_version_locked, state.sessionId, vid
        )
        if isinstance(result, JSONResponse):
            return {"ok": False, "error": "restore_failed", "versionId": vid}
        if isinstance(result, dict) and isinstance(result.get("state"), dict):
            restored = V5SessionState.server_load(result["state"])
            state.modelVersions = restored.modelVersions
            state.currentModelVersionId = restored.currentModelVersionId
            state.publishClosure = restored.publishClosure
            # ⚠ 2026-08-28：整份替换会把页面 id 别名表冲掉。旧快照里那张表
            #   可能是空的（修复之前的存量版本；或某个没改过名的精修轮——
            #   canonical_page_id_map 一个都没改就返回空表，那正是精修轮的
            #   常态）。冲掉 = 菜单又点不动，而且照例一声不吭。
            #   别名是**历史**，模型版本可以回退，"p1 曾经是 remote_rx_audit"
            #   这件事永远为真。规则见 page_id_freeze.merge_page_id_aliases
            #   （抄 friendly_id：slug 历史只增，回退内容不删老 slug）。
            #
            #   ⚠ 2026-08-29：**主刀已经搬进 _restore_model_version_locked 本身**
            #   （前端 ◀ 按钮走 HTTP 直接进那个核，不经过这里——当时只补这一处
            #   等于只改一半）。这里留着的是第二道：`state` 是控制面手里的内存态，
            #   可能带着还没落库的别名，而那个核读的是 load_session 的那份。
            #   合并是并集且幂等，两道叠着不会打架。
            from services.page_id_freeze import merge_page_id_aliases

            _live = getattr(state, "specFirstPages", None)
            _live_aliases = _live.get("pageIdAliases") if isinstance(_live, dict) else None
            state.specFirstPages = restored.specFirstPages
            _restored = state.specFirstPages
            if isinstance(_restored, dict):
                _merged = merge_page_id_aliases(
                    _live_aliases, _restored.get("pageIdAliases")
                )
                if _merged:
                    state.specFirstPages = {**_restored, "pageIdAliases": _merged}
            _append_transcript(
                state, {"role": "tool", "kind": "restore_version", "text": vid}
            )
            return {
                "ok": True,
                "versionId": vid,
                "restored": result.get("restored", True),
            }
        return {"ok": False, "error": "restore_failed", "versionId": vid}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:200]}


async def _tool_fork(state: V5SessionState, new_name: str) -> Dict[str, Any]:
    """在本会话 modelVersions 时间线上分一条变体。

    ⚠ 不能调 fork_app(..., session_id=state.sessionId)：画廊副本会粘在源
    会话上——点开副本却进了源会话。版本条坐在 modelVersions 上，用户要
    看到的是 变体 n+1，不是画廊里多一张同会话卡片。失败必须 ok:false。
    """
    try:
        versions = [
            item
            for item in (getattr(state, "modelVersions", None) or [])
            if isinstance(item, dict)
        ]
        current_id = str(getattr(state, "currentModelVersionId", "") or "")
        source = None
        if current_id:
            for item in versions:
                if str(item.get("id") or "") == current_id:
                    source = item
                    break
        if source is None and versions:
            source = versions[-1]
        if not isinstance(source, dict) or not source:
            return {"ok": False, "error": "没有可分的模型版本"}
        max_seq = 0
        for item in versions:
            vid = str(item.get("id") or "")
            if vid.startswith("mv-"):
                try:
                    max_seq = max(max_seq, int(vid[3:]))
                except ValueError:
                    pass
        new_id = f"mv-{max_seq + 1}"
        clone = copy.deepcopy(source)
        clone["id"] = new_id
        clone["instruction"] = str(new_name or "变体")[:300]
        clone["createdAt"] = datetime.now(timezone.utc).isoformat()
        clone["turnId"] = str(getattr(state, "lastTurnId", "") or "")
        versions.append(clone)
        state.modelVersions = versions[-20:]
        state.currentModelVersionId = new_id
        _append_transcript(
            state,
            {
                "role": "tool",
                "kind": "fork_variant",
                "text": clone["instruction"],
                "versionId": new_id,
            },
        )
        return {"ok": True, "versionId": new_id}
    except Exception as exc:  # noqa: BLE001 — 增强类 fail-open
        return {"ok": False, "error": str(exc)[:200]}


def _system_prompt(state: V5SessionState) -> str:
    """给控制面模型的那一句。抄 grok：complete the request，不是答题手册。

    ⚠ 2026-09-08 第 2 格：上一版教「先 clarify → scope_card → 选项带括号
      → 未确认不许 rehearse」。模型在填答题卡，空回复把「请调 pages」端给人。
      规章只留边界（闭集工具、禁止闲聊、证据不计闭环）；路径自己挑。
      缺维度、交回现场是**事实**，不是流程命令。

    ⚠ 话题必须看得见。以前只读 _goal_text，未确认时是空的，「就按上面这个
      推演」没有指代，库里一排场面话 goal（2026-08-27）。改成 _session_topic。
    """
    topic = _session_topic(state)
    goal = topic or "（尚无确认的应用目标）"
    parked = getattr(state, "awaitReason", None) or "none"
    from services.product_charter import charter_prompt_block

    extra = charter_prompt_block()
    facts: List[str] = []
    interview = [
        str(row.get("text") or "")
        for row in (getattr(state, "controlTranscript", None) or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    if interview:
        facts.append("已收集的访谈回答：\n" + "\n".join(interview[-12:])[-10000:])
    plan = latest_control_plan(state)
    if plan:
        facts.append(f"已保存计划（第 {plan.get('revision')} 版）：\n{plan.get('planContent')}")
        if plan_deliverable_kind(plan) == OFFICE_FILE:
            facts.append("这份已保存计划的交付物是办公文件，不是任务管理网页。")
    if plan_deliverable_kind(plan) == OFFICE_FILE or any(
        skill_seed_category(info.name) == OFFICE_SKILL_CATEGORY
        for info in _skill_infos_for_turn(state)
    ):
        # ⚠ 2026-09-20 真机 sr-20260920051924-QA0YXX59Q0：只写「创建工程用
        #   project_create；任务管理应用选 tasks」，模型把做 PPT 编成任务清单。
        #   这里只陈述交付物类别，不写「必须先调 skill 再 pip」。
        facts.append(
            "办公文件（.pptx / .docx / .xlsx）是磁盘上的文件，不是 Vite 网页。"
            "react-vite-tasks 只用于任务管理网页。"
            "办公计划下的工程是空工作区，不是 Vite 脚手架。"
            "右侧预览显示 make_manus_page 点名的那一份：源码里的 .html，或已经收回的 .pptx / .docx / .xlsx。"
            "没有点名就没有预览。应用运行失败不是办公文件的预览。Vite 页面不是办公文件。"
            "办公文件不以 project_verify 为交付证据。"
        )
    mentioned = _mentioned_skill_infos(state)
    if mentioned:
        # ⚠ 点名 = 告诉模型去哪查。不是把 SKILL.md 倒进 system
        #   （长短记忆交叉污染），也不是写死 PPT 步骤。
        facts.append(mentioned_skill_playbooks(mentioned))
    if _PROJECT_TOOLS.get() is not None or getattr(state, "runtimeKind", None) == "project":
        facts.append(
            "源码以工程磁盘为准。技能全文在 skill 回执里，path 不是工程文件。"
            "file_read / project_read 默认只回路径和摘要；"
            "要原文带 offset/limit 或 start_line/end_line，搜内容用 grep。"
            "旧工具输出不是全文。"
        )
    if plan_execution_authorized(state):
        facts.append("用户已明确批准这份计划，可以按该版本执行。")
    else:
        facts.append(
            "当前处于只读规划。先通过 ask_user_question 访谈澄清真实需求、设备和设计选择，"
            "再调用 write_plan 写完整实施计划，最后用空参数 exit_plan_mode 请求批准。"
            "问卷提交、跳过访谈或普通文字都不是计划批准；批准前不能执行任何生成或修改工具。"
        )
    for row in reversed(getattr(state, "controlTranscript", None) or []):
        if row.get("kind") in ("plan_cancelled", "plan_abandoned"):
            facts.append(f"用户对上一版计划的处理：{row.get('kind')}；反馈：{row.get('feedback', '')}")
            break
        if row.get("kind") in ("plan_written", "plan_approved"):
            break
    # 抄 grok enter_plan_mode 的拒绝回执，摆在最前面：这一条比「还没有应用
    # 目标」之类的现场更要紧——它说的是**模型刚提的东西被否了**。
    #
    # ⚠ 措辞只陈述发生了什么，不写「别再提一遍」。本函数头注那条纪律：
    #   规章只留边界，现场是**事实**不是流程命令（2026-09-08 第 2 格的教训——
    #   写成命令模型就开始填答题卡）。判断留给它自己。
    # 活儿清单回喂。抄 grok：`summary_for_prompt` 每轮跟着走——
    # 模型自己列的计划要它自己看得见，否则下一轮就忘了列过什么，
    # 于是重列一张（用户眼里进度归零）。
    _plan = normalize_todo(getattr(state, "controlTodo", None))
    if _plan:
        facts.append(f"你列的活儿清单（用户看得见）：\n{summarize_todo(_plan)}")
    if _has_ask_answer_candidate(state):
        # ⚠ 2026-09-09 真机：hhh / ghgjg / 你能做什么 三轮左栏都是
        #   「想做什么应用，说一句就行。」回执事实写成「继续问想做什么
        #   应用」，空回复 empty_text 再盖同一句——模型跟着抄。
        facts.append(
            "刚收到回答。如果还在问你是谁、能做什么，先用文本回答；"
            "还不是应用目标就再问一句，问句按这一轮说，不要开范围卡，"
            "不要每句都用同一句开场。"
        )
    elif not _has_product_topic(state):
        facts.append(
            "还没有应用目标。用户问你是谁、能做什么就先用文本回答，不要调工具；"
            "需要应用目标时再提问，问句按这一轮说，不要每句都用同一句开场。"
        )
    # 第 7 格：有产品话题就干活。缺维度是 SPEC 假设卡的事，不是开工前门禁。
    # 再把「在哪用（平台）」写进 system = 类型/设备门借提示词还魂
    # （漫画第 5 格已经拆掉的 NeedPermission-on-product-type）。
    is_project = getattr(state, "runtimeKind", None) == "project"
    if _PROJECT_TOOLS.get() is not None or is_project:
        # Planning may precede project creation, so feed the model the same
        # local readiness facts the runtime will enforce.  This is a read-only
        # configuration check; it does not create a sandbox or prove cloud
        # reachability.  Browser acceptance remains mandatory when required.
        readiness_tool = _PROJECT_TOOLS.get()
        readiness = (readiness_tool.capability_readiness()
                      if readiness_tool is not None and hasattr(readiness_tool, "capability_readiness")
                      else None)
        facts.append(
            "工程工具运行在受管 E2B 中，源码版本持久保存。"
            f"当前工程：{getattr(state, 'projectId', None)}；源码版本：{getattr(state, 'projectRevision', None)}。"
            "创建新工程用 project_create；任务管理网页才选 templateId=react-vite-tasks。"
            "办公文件不是任务管理应用，不要为 .pptx / .docx / .xlsx 选 react-vite-tasks。"
            "办公计划下 project_create 会开空工作区，templateId 不会变成 Vite。"
            "react-vite 仅是网页的最小电脑；已有 HTML 应用转换尚未支持。"
            "工程会话使用 project_* 工具，不调用 HTML 工厂。"
            # 2026-09-13 真模型 live-edit：工具已支持运行中同步，这里仍教
            # “修改前先取消”，模型照做 project_cancel，标题一个字没改。
            # 初始化、工具回填和checkpoint恢复共用此装配，必须与执行合同一致。
            "电脑核用泄漏包那 29 件名字：file_*、shell_*、browser_*、deploy_*、message_*、info_search_web、make_manus_page、idle。"
            "GitHub 薄核也能用：read_file / write_file / search_replace / bash / grep / list_dir / glob，接到同一份源码和沙箱命令。"
            "日常改一个文件用 file_write（file+content）或 file_str_replace（old_str 必须只出现一次）。"
            "读文件用 file_read；搜内容用 file_find_in_content；按名找用 file_find_by_name。"
            "构建用 shell_exec：check/build/test 走受管安装，其它一行命令在 E2B 沙箱里跑（grok-build bash）。看输出用 shell_view / shell_wait，写入正在跑的 PTY 用 shell_write_to_process，停用 shell_kill_process。sudo 拒绝。"
            "预览用 deploy_expose_port 或 browser_navigate（只许本工程预览地址）。deploy_apply_deployment 只亮私有预览，不是公开 CDN，deployed 永远为 false。"
            "预览就绪后可用 browser_view 看交互节点，再用 browser_click / input / key / scroll / console_exec。外站拒绝。这不是 project_verify，点过不等于验收通过。"
            "问用户用 message_ask_user；报个进度用 message_notify_user；检索用 info_search_web；这一轮先交给用户用 idle，那不是报完工。"
            "这几件不要自己传 approvalRef、版本号或文件哈希。sudo=true 会被拒绝。"
            "多文件精确对照或删除仍用 project_patch。"
            "project_patch 在运行就绪时可直接修改 src/、public/、tests/ 和 index.html 的源码与静态资源，"
            "由现有运行持有者同步，保持当前应用运行，不需要先取消。"
            "返回 runtime.patch 的 operationId 表示补丁已排队；用 project_status 查询到 completed 且 synchronized=true，"
            "才能确认新源码版本已同步。依赖或启动配置变更需先停止并确认清理，再修改和重启。"
            "project_exec 只运行 check/build/test，返回 operationId；用 status/logs 读取真实结果。"
            "新回合可用不带 operationId 的 project_status 找回任务；运行 project_exec 命令前先取消已有服务并等待清理。"
            "project_verify 需要保留正在运行的工程：由原运行者先固定源码、锁文件安装并构建，再在独立浏览器中运行对应模板的受管用例，"
            "与源码修改由原运行者串行执行。用 project_verification 读取真实断言；缺浏览器或预览为 blocked，"
            "源码或批准改变使旧证据 stale。失败后按断言修源码再申请新检查；用例通过只代表列出的验收范围。"
            "任务未结束就如实交回 operationId，下轮继续查询，不能重复提交或宣称完成。"
            "构建通过和服务就绪均不是业务验收；私有预览、验证结果和对外发布分别查看服务端真实状态。"
        )
        if isinstance(readiness, dict):
            blockers = readiness.get("blockers") or []
            facts.append(
                "当前本地能力就绪检查（仅配置事实，不代表云端已连通）："
                f"rollout={'ready' if readiness.get('rolloutConfigured') else 'blocked'}，"
                f"私有预览={'ready' if readiness.get('previewConfigured') else 'blocked'}，"
                f"独立浏览器={'ready' if readiness.get('browserConfigured') else 'blocked'}。"
                f"缺项代码：{', '.join(str(item) for item in blockers) if blockers else 'none'}。"
                "若独立浏览器或私有预览缺项，project_verify 必须标记 blocked，不能用构建、API 或模型自述替代。"
            )
        if plan_execution_authorized(state):
            facts.append(f"工程操作批准引用 approvalRef：{approved_reference(state)}。")
    after_write = None if is_project else _after_write_hint(state)
    if after_write:
        facts.append(after_write.strip())
    fact_blob = " ".join(facts)
    base = (
        "把这件事做完。只能调用给定工具，不能发明工具。"
        # ⚠ 抄 grok-build `xai-grok-agent/templates/prompt.md` 的 work_policy：
        #     Match your response to the user's intent. Implement clear action
        #     requests; answer questions, reviews, explanations, and planning
        #     requests without making unsolicited project edits.
        #
        #   我们原来只抄了它第一行（complete the user's request → 把这件事做完），
        #   把这条限定语丢了，还多写了一句「禁止开放闲聊」。两句加起来等于堵死
        #   「就回答一句」这条路——模型只剩造东西一个合法出口。2026-09-09 真机
        #   乱码那轮它把心里话说出来了：「但我需要推进应用创建流程」。
        #
        #   注意 grok 没有分类器：没有长度启发式、没有关键词表、也不单独跑一次
        #   模型判「这是不是需求」。就是提示词里这一句，安全网在工具那侧
        #   （破坏性动作要批准）。
        "回应要对上用户的意图：明确要动手的就动手；提问、说明、评论、闲谈这类，"
        "回答就好，不要顺手造东西。不跑题。"
        # ⚠ 2026-09-18 真机：问「用户名密码是啥」，模型仍改 src/main.tsx 又
        #   shell_exec npm run build。work_policy 那句已经在上面，它没听。
        #   grok 还有两句工具侧事实，我们漏了：
        #     Claim that something is done … only when tool output supports
        #     is_background 才立刻返回；前台等的是 exit code
        #   没有分类器（grok 也没有）。这里只补事实，不写成「必须先…」。
        "说已经做完、修好或测过，只能在工具结果撑得住的时候说；"
        "还在排队、commandFinished 不是 true、没有 exitCode，就说明还没核实。"
        "shell_exec / bash 默认会等到命令结束才交回结果；"
        "要丢到后台跑就带 is_background=true，回来的是 running 不是做完。"
        # ⚠ 2026-09-15 真机 TicketStream（sr-20260915165800-M6JK4H3XFB）：
        #   用户中文需求、问卷和 write_plan 都已是中文，但派工具前的
        #   content 是英文思考独白（"Initial Assessment…" / "playing the
        #   role of the thinking entity"）。host 把它当 control_text 开口，
        #   左栏就整段英文。技能包那句「用户输入是什么语言就用什么语言」
        #   控制面漏了；思考模型默认用英文想，想完写进正文。
        #
        #   边界不是流程手册：只钉对用户开口的语言，路径仍自己挑。
        "对用户开口、问卷和计划跟用户同一种语言（默认简体中文）。"
        "思考过程不要写进正文。"
        # ⚠ 2026-09-16 真机（sr-20260916212612-6N7V2BZ6XS）量出来的。整趟 1127 秒、
        #   34 轮，其中 27 轮只挑 1 件工具。而 `tool_result` 到下一个 `tool_start`
        #   的间隔稳定 12~20 秒（服务端记账是 ms 级，那一段就是模型往返）——
        #   也就是说**每多一轮就多烧一次往返**，跟那一轮干了多少活无关：
        #
        #       连着三轮各读一个文件（package.json / main.tsx / style.css）
        #       → 工具本身各 3.5 秒，往返却付了三次
        #
        #   仓里没有任何一句要求「一轮只调一件」（查过），所以这纯粹是模型的
        #   默认习惯 + 没人告诉它可以带齐。
        #
        # ⚠ 写成**事实**不写成命令：本函数头注那条纪律——规章只留边界，路径自己挑；
        #   写成流程命令模型就开始填答题卡（2026-09-08 第 2 格的教训）。
        #   所以这里只陈述「可以」和「等待类工具会提前返回」，不写「你必须合并」。
        #
        # ⚠ 2026-09-17 真机复盘：**上面这句「可以一轮带齐」基本没用，别再往上加措辞。**
        #   跨两个模型量过，单件轮次占比一动不动：
        #
        #       gpt-5.6-luna 改之前   34 轮 / 27 轮单件 = 79%   最大一轮 3 件
        #       gpt-5.6-luna 改之后   19 轮 / 15 轮单件 = 79%   最大一轮 5 件
        #       gpt-6-astra  改之后   19 轮 / 18 轮单件 = 95%   最大一轮 4 件
        #
        #   偶尔会带齐（出现过一轮 5 个 project_read、一轮 4 件），但不成习惯；
        #   换个模型甚至更差。**模型就是倾向一轮一件**，尤其写操作——真机里
        #   连续 6 轮都是单件 file_str_replace，一轮改一处（写有顺序依赖，
        #   带齐本来也不合适）。
        #
        #   同一笔改动里**真正兑现的是下面那句对应的等待上界 5→30**：
        #       shell_wait 调用次数  基线 4 次 → 改后 1 次
        #   所以下次想省轮次，方向是**减少必须的步数**（放宽等待、合并必然成对
        #   的操作），不是继续劝模型合并——劝不动，而且措辞越长越像答题卡
        #   （2026-09-08 第 2 格那条教训）。
        "互不依赖的调用可以放在同一轮里一起给，会按顺序执行、结果一起回来。"
        "等待类工具（shell_wait、project_status 的 waitSeconds）在活干完时立刻返回，"
        "所以一次给足秒数比反复短轮询便宜。"
        "search_evidence 不计入闭环。inspect_model 只看摘要。"
        f"当前目标：{goal[:200]}。停泊：{parked}。"
        f"{fact_blob}"
    )
    return f"{base}\n{extra}" if extra else base


def _usage_tokens(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    for key in ("total_tokens", "prompt_tokens", "completion_tokens"):
        try:
            value = int(usage.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if key == "total_tokens" and value:
            return value
    try:
        return int(usage.get("prompt_tokens") or 0) + int(
            usage.get("completion_tokens") or 0
        )
    except (TypeError, ValueError):
        return 0


def bound_tool_result(body: Any, tool_name: Any = None) -> str:
    """工具结果 → 回喂给模型的字符串，超限就裁并**说自己裁了**。

    抄 grok 三件套（见 CONTROL_TOOL_RESULT_MAX_CHARS 头注）：
      truncated       —— 明说裁过。不说的话模型会以为世界就这么大：搜出来
                         二十条只喂进去三条，它会当成"只找到三条"。
      truncationHint  —— 预先写好的一句人话，模型据此决定要不要换个查询词。
      rawChars        —— **裁之前**的真实大小。裁完的字符串长度是恒定的，
                         真实规模只能靠这个字段活下来（grok 那边留它是给
                         doom-loop 检测用的，同一个理由）。

    裁法是**前缀裁**，不做二分（grok 明写 "no binary search"）——省下来的
    那点精度不值一次额外的 token 计数。
    """
    cap = control_tool_result_max_chars(tool_name)
    text = json.dumps(
        body if body is not None else {"ok": True}, ensure_ascii=False
    )
    if len(text) <= cap:
        return text
    return json.dumps(
        {
            "truncated": True,
            "rawChars": len(text),
            "truncationHint": (
                f"结果太长，只喂了前 {cap} 字"
                f"（原文 {len(text)} 字）。需要更多就换个更窄的查询词再来一次。"
            ),
            "preview": text[:cap],
        },
        ensure_ascii=False,
    )


async def _canned(
    state: V5SessionState,
    text: str,
    *,
    stop: Optional[Dict[str, Any]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """罐头回复。`stop` 是结构化的「为什么停」，挂在同一个事件上。

    ⚠ 挂在 control_text 而不是新开一个事件类型，是为了让老客户端照旧渲染
      text、新客户端多读两个字段——加新事件类型会让 consumeControlStreamResponse
      的 switch 静默丢掉它（那个 switch 没有 default，2026-08-27 已记过一次）。
    """
    _append_transcript(state, {"role": "assistant", "kind": "canned", "text": text})
    await _apersist(state)
    wire = dict(stop or {})
    yield {"type": "control_text", "text": text, **wire}
    event = {**_complete(state), **wire}
    # ⚠ 2026-09-21 349E2KVH7G：control_text 有 llm_unavailable，
    #   complete 却是裸 _complete(idle)。停因必须挂在 complete 上。
    if wire.get("stopReason") in {"llm_unavailable", "unknown"}:
        state_dump = dict(event.get("state") or {}) if isinstance(event.get("state"), dict) else {}
        state_dump["runtimePhase"] = "failed"
        state_dump["awaitReason"] = "error"
        state_dump["awaitDetail"] = str(wire.get("stopReason") or "control_loop_failed")
        event["state"] = state_dump
    yield event


_ERROR_PARK_FIELDS = ("controlTranscript", "awaitReason", "awaitDetail", "runtimePhase")


def _stamp_error_park(state: V5SessionState, detail: str) -> None:
    state.runtimePhase = "failed"
    state.awaitReason = "error"
    state.awaitDetail = detail


async def _park_control_error(
    state: V5SessionState,
    text: str,
    *,
    stop: Optional[Dict[str, Any]] = None,
    detail: str,
) -> AsyncIterator[Dict[str, Any]]:
    """网关/循环炸了。会话必须停在 error，不许看起来像做完了。

    ⚠ 2026-09-21 真机 sr-20260921155056-HKA1MC5142：except 里写了
      failed/error，接着走 `_canned`。控制 run 是 failed/llm_unavailable，
      complete.state 和 GET 却是 idle/None——卡片画成「任务已完成」。
      `_canned` 是额度到顶那种「先停着」，不负责失败停泊。失败要自己
      persist-as-authority 写回去，complete 还得带上停因（跟 control_text
      同一份 stop，CLAUDE.md §4：两处措辞必然只改一半）。
    """
    _stamp_error_park(state, detail)
    _append_transcript(state, {"role": "assistant", "kind": "canned", "text": text})
    saved = await _apersist(state)
    if (
        getattr(saved, "runtimePhase", None) == "failed"
        and getattr(saved, "awaitReason", None) == "error"
    ):
        for field in _ERROR_PARK_FIELDS:
            setattr(state, field, getattr(saved, field))
    else:
        # 落盘剥了标量。本地停泊留下，再写一次；complete 仍以失败为准。
        _stamp_error_park(state, detail)
        await _apersist(state)
        _stamp_error_park(state, detail)
    print(
        f"[control] park error phase={state.runtimePhase} await={state.awaitReason} "
        f"detail={state.awaitDetail}",
        flush=True,
    )
    wire = dict(stop or {})
    yield {"type": "control_text", "text": text, **wire}
    event = {**_complete(state), **wire}
    state_dump = dict(event.get("state") or {}) if isinstance(event.get("state"), dict) else {}
    state_dump["runtimePhase"] = "failed"
    state_dump["awaitReason"] = "error"
    state_dump["awaitDetail"] = detail
    event["state"] = state_dump
    yield event


_ACTIVE_CONTROL_TURNS: set[str] = set()


@contextmanager
def reserve_control_turn(session_id: str):
    """Reserve before HTTP headers; hold through cancellation and producer cleanup."""
    if session_id in _ACTIVE_CONTROL_TURNS:
        raise HTTPException(409, "control_turn_in_progress")
    _ACTIVE_CONTROL_TURNS.add(session_id)
    try:
        yield
    finally:
        _ACTIVE_CONTROL_TURNS.discard(session_id)


async def run_control_turn(
    payload: Dict[str, Any],
    *,
    authorized_owner_id: Optional[str] = None,
    reservation_held: bool = False,
    project_tools: Any = None,
) -> AsyncIterator[Dict[str, Any]]:
    """One control producer per session, including while durable writes await I/O."""
    validate_control_turn_body(payload)
    session_id = str(payload["sessionId"]).strip()
    orch_trace("turn", session=session_id[:40])
    # The HTTP response owns its reservation before it sends SSE headers. Direct
    # consumers acquire here. Closing this wrapper must close the child in the
    # same task: deferred async-generator GC used to reset ContextVars elsewhere
    # and release exclusivity before the producer's finally block ran.
    with nullcontext() if reservation_held else reserve_control_turn(session_id):
        async with aclosing(_run_control_turn_serial(payload, authorized_owner_id=authorized_owner_id, project_tools=project_tools)) as stream:
            async for event in stream:
                yield event


async def _run_control_turn_serial(
    payload: Dict[str, Any],
    *,
    authorized_owner_id: Optional[str] = None,
    project_tools: Any = None,
) -> AsyncIterator[Dict[str, Any]]:
    """产品控制面主循环。cheap 请求内结束；点火才调信封 helper。"""
    validate_control_turn_body(payload)
    session_id = str(payload["sessionId"]).strip()
    state = await run_in_threadpool(load_session, session_id)
    if authorized_owner_id is not None and (
        state is None or state.ownerId != authorized_owner_id
    ):
        raise HTTPException(status_code=404, detail="Not found")
    if state is None:
        raise HTTPException(status_code=400, detail="session_id required")

    from services.product_charter import activate_charter_for_run, clear_charter_for_run

    token = _CONTROL_PAYLOAD.set(payload if isinstance(payload, dict) else {})
    project_token = _PROJECT_TOOLS.set(project_tools)
    activate_charter_for_run(state, payload)
    try:
        # 抄 grok 第二层重试预算：**一个回合一份，中途永不清零**。
        # 开在这儿而不是 `_control_llm_loop` 里——loop 一个回合可能进两次
        # （回执路径 / forced 交回后），开在 loop 里等于每次进都重新给额度，
        # 那正好是这一层要治的「每轮成功就把额度赚回来」。
        # grok 把它存在 actor 的 Cell 上、不是循环局部，同一个道理。
        port = current_checkpoint.get()
        resume = port.checkpoint if port is not None else None
        budget = RetryBudget()
        if resume and resume.get("phase") in {"model", "tools"}:
            # 只在同一轮被打断时接着算 cheapTokens。
            # ⚠ budget_exhausted / settling 不是中途打断：用户再说一次或
            #   点「开始推演」必须走 _run_control_turn_body，计数器从 0、
            #   重选当前窗口档。自动续仍禁 token_budget（HARD_CAP）。
            budget.spent = resume.get("retrySpent", 0)
            budget.started -= max(0, time.time() - resume["retryStartedAt"])
            options = dict(resume["options"])
            options["started"] = time.monotonic() - max(0, time.time() - resume["startedAt"])
            options["cheap_tokens"] = resume["cheapTokens"]
            restored_messages = copy.deepcopy(resume["messages"])
            restored_messages[0] = {"role": "system", "content": _system_prompt(state)}
            body = _control_llm_loop(state, restored_messages, **options)
        else:
            body = _run_control_turn_body(payload, state)
        with retry_budget_scope(budget):
            async with aclosing(body) as stream:
                async for event in stream:
                    yield event
    finally:
        clear_charter_for_run()
        _CONTROL_PAYLOAD.reset(token)
        _PROJECT_TOOLS.reset(project_token)


def _open_question_gaps(state: V5SessionState) -> List[str]:
    out: List[str] = []
    for gap in getattr(state, "coverageGaps", None) or []:
        get = gap.get if isinstance(gap, dict) else lambda k, _g=gap: getattr(_g, k, None)
        if get("status") == "open" and get("kind") == "open_question":
            gid = get("id")
            if gid:
                out.append(str(gid))
    return out


async def _resolve_answered_gaps(
    state: V5SessionState, payload: Dict[str, Any], *, persist: bool = True
) -> List[str]:
    """澄清卡答完，按 id 精确关掉这几个缺口。返回真的被关掉的那些。

    ⚠ **`resolve_readiness_gaps_by_ids` 一直就在**（slide_rule_interactive_gates
      :182），逐条写对、还有单测——**只是产品链路上没有任何调用点**。
      本仓第三条的原话：函数写对了 ≠ 它被调用了。控制面改造把 TS 那侧的
      `intakeMessage`（唯一的 resolveReadinessGapsByIds 调用点）删了，
      客户端仍在拼 answeredGapIds，于是答完卡片一个缺口都不关，闸还是红的，
      而用户以为自己已经答过了。

    ⚠ 只关**这次点名的**：整批关掉等于把没答的问题也当答了，覆盖门就成了
      摆设（第七条：闭环类 fail-closed，不许伪造绿灯）。
    """
    answers: Dict[str, str] = {}
    # 结构化形态：[{gapId, answer}]。**答案要留下来**——只把缺口置 resolved
    # 而不记答案，等于闸绿了、生成侧什么也没多知道，澄清白问（见
    # v5_llm_generate.clarification_prompt_block）。
    for row in payload.get("answeredGaps") or payload.get("answered_gaps") or []:
        if not isinstance(row, dict):
            continue
        gid = str(row.get("gapId") or row.get("id") or "").strip()
        if gid:
            answers[gid] = str(row.get("answer") or "").strip()
    # 只有 id 的老形态照旧收（早前的调用方还在发它）
    for x in payload.get("answeredGapIds") or payload.get("answered_gap_ids") or []:
        gid = str(x or "").strip()
        if gid:
            answers.setdefault(gid, "")
    ids = [gid for gid in answers if gid]
    if not ids:
        return []
    before = set(_open_question_gaps(state))
    # 先把答案写在缺口上，再 resolve —— 反过来写的话 resolve 那步会
    # model_copy 出新对象，答案落在被丢掉的旧对象上。
    for gap in getattr(state, "coverageGaps", None) or []:
        gid = gap.get("id") if isinstance(gap, dict) else getattr(gap, "id", None)
        if not gid or gid not in answers or not answers[gid]:
            continue
        if isinstance(gap, dict):
            gap["answer"] = answers[gid]
        else:
            try:
                gap.answer = answers[gid]
            except (ValueError, AttributeError):
                pass
    resolve_readiness_gaps_by_ids(state, ids)
    closed = sorted(before - set(_open_question_gaps(state)))
    if closed and persist:
        await _apersist(state)
    return closed


def _this_hop_tools(state: V5SessionState) -> List[str]:
    """本跳工厂真正跑过的公开工具。先看页面载体上的 capabilityPlan。"""
    blob = _spec_first_blob(state)
    plan = blob.get("capabilityPlan") if isinstance(blob, dict) else None
    if isinstance(plan, dict) and isinstance(plan.get("tools"), list) and plan["tools"]:
        return [str(t).strip() for t in plan["tools"] if str(t).strip()]
    stages = blob.get("stages") if isinstance(blob, dict) else None
    if isinstance(stages, dict):
        nested = stages.get("capabilityPlan")
        if (
            isinstance(nested, dict)
            and isinstance(nested.get("tools"), list)
            and nested["tools"]
        ):
            return [str(t).strip() for t in nested["tools"] if str(t).strip()]
    goal = getattr(state, "goal", None)
    if isinstance(goal, dict) and isinstance(goal.get("tools"), list):
        return [str(t).strip() for t in goal["tools"] if str(t).strip()]
    return []


#: 交回时贴在工具结果上的提醒标签。
#:
#: 抄 grok `xai-grok-tools/src/reminders/mod.rs`：
#:
#:     //! Provides contextual hints wrapped in `<system-reminder>` tags that are
#:     //! appended to tool outputs before being sent to the model.
#:
#: 以及 `xai-tool-runtime/src/render.rs:205`——
#: 「the model sees `prompt_text` (reminders appended), never a JSON dump」。
_REMINDER_TAG = "system-reminder"


def wrap_reminder(text: str) -> str:
    """把一段情报裹成提醒块。对应 grok 的 `wrap_reminder`。"""
    return f"<{_REMINDER_TAG}>\n{text}\n</{_REMINDER_TAG}>"


def append_reminder(output: str, reminder: str) -> str:
    """把提醒**追加在工具结果后面**（grok `format_with_reminders`）。

    ⚠ 追加、不是另起一条 `role: user`。原来的写法是伪造一条用户消息，
      模型看见的是「用户命令我调 pages」——那不是用户说的，而且下一轮
      真用户开口时两条 user 会打架。
    """
    if not reminder:
        return output
    wrapped = wrap_reminder(reminder)
    return wrapped if not output else f"{output}\n\n{wrapped}"


def _push_system_reminder(messages: List[Dict[str, Any]], reminder: str) -> None:
    """把一段情报贴到**最后一条工具结果**上。对应 grok `push_system_reminder`。

    ⚠ 这段逻辑原来只长在「交回工厂之后贴 hint」那一处，行内写死。
      2026-09-09 加原地打转的 nudge 时要贴第二段情报——照 CLAUDE.md §4，
      同一件事有两份实现就必然只改一半：抄一遍等于埋一条「nudge 贴在
      role:user 上、hint 贴在 tool 上」的静默分叉。所以提成一处。

    没有工具消息可贴（理论上不会：能走到这儿说明上一轮跑过工具）时退回
    role:user——宁可退回老写法，也不许把情报整段丢掉。
    """
    if not reminder:
        return
    last_tool = next(
        (m for m in reversed(messages) if m.get("role") == "tool"), None
    )
    if last_tool is not None:
        last_tool["content"] = append_reminder(
            str(last_tool.get("content") or ""), reminder
        )
    else:
        messages.append({"role": "user", "content": wrap_reminder(reminder)})


def _step_is_problematically_repeating(calls: List[Dict[str, Any]]) -> bool:
    """这一轮的重复该不该走紧档阈值。

    抄 grok `step_is_problematically_repeating` 的**形状与理由**，只是换了轴：
    grok 按 `ToolKind::Read | Plan` 分档，理由是「同一个路径同一段范围再读一遍
    只会回同一批字节」；我们按 `ToolScope.READ` 分，理由一模一样——
    `inspect_model` / `search_evidence` 同一份实参必然回同一份结果，
    重复一次就是零进展。

    两条细节照抄，别自己简化：
    - **按声明的权限判，不按名字判。** 名字会改（芯片上写「精修（refine）」
      那次就踩过），`TOOL_SCOPE` 不会。
    - **要求这一轮里每一件都是 READ**，不是任意一件。混着 WRITE 的一轮落宽档：
      其中一件本来就可能正当重复，整轮跟着算正当。
    - 空轮不算（`not calls` → False）：没有调用就没有「重复的调用」。
    """
    if not calls:
        return False
    return all(
        resolve_tool_scope(str((c or {}).get("name") or "")) is ToolScope.READ
        for c in calls
    )


async def _complete_waiting_for_assumptions(
    state: V5SessionState,
) -> AsyncIterator[Dict[str, Any]]:
    """假设卡等确认：罐头收尾 + complete，不再问控制面。

    ⚠ 2026-09-03 sr-20260903204902：交回仍 `_invoke_control_llm`，
      HTTP 挂住 SSE，确认继续排队 25 分钟。这一支必须零 LLM。
    """
    assumptions = copy.deepcopy((_sfp(state).get("spec") or {}).get("assumptions") or [])
    questions = []
    for i, assumption in enumerate(assumptions):
        if not isinstance(assumption, dict):
            continue
        qid = str(assumption.get("id") or f"assumption-{i + 1}")
        assumption["id"] = qid
        decision = str(assumption.get("decision") or "")
        questions.append({
            "id": qid, "question": str(assumption.get("topic") or qid),
            "options": [
                {"label": decision, "description": str(assumption.get("why") or "")},
                *[{"label": str(option)} for option in assumption.get("alternatives") or [] if str(option) != decision],
            ],
        })
    if not questions:
        yield _complete(state)
        return
    sfp = copy.deepcopy(_sfp(state))
    sfp["spec"]["assumptions"] = assumptions
    state.specFirstPages = sfp
    async for event in _park_ask(state, questions[0]["question"], questions=questions, assumption_snapshot=assumptions):
        yield event


def _assumptions_awaiting(state: V5SessionState) -> bool:
    """假设卡摊着、用户还没点「确认继续」。"""
    sfp = getattr(state, "specFirstPages", None)
    if not isinstance(sfp, dict):
        return False
    if sfp.get("assumptionsConfirmed") is True:
        return False
    spec = sfp.get("spec")
    rows = (spec or {}).get("assumptions") if isinstance(spec, dict) else None
    return bool(rows)


def _sfp(state: V5SessionState) -> Dict[str, Any]:
    """specFirstPages 那个 blob，取不到就空字典。"""
    blob = getattr(state, "specFirstPages", None)
    return blob if isinstance(blob, dict) else {}


def _after_write_hint(state: V5SessionState) -> str:
    """交回 host 时把**现场情况**摆给模型，让它自己挑下一步。

    ⚠ 2026-09-02：话术曾看「会话里有没有旧页面」，spec 单跳交回仍问结构绑定。
    必须读本跳 capabilityPlan.tools。

    ## 2026-09-04：从命令式改成情报式

    上一版是祈使句——「下一跳**必须**调 pages，不要调 rehearse，不要问结构绑定」。
    那不是模型在决定下一步，是流程在下命令、模型负责复述；用户看完架构的原话是
    「还是死流程，不是很智能呢」。

    抄 grok 的 reminder 措辞：陈述**事实**与**可选项**，禁令只在跟一条事实
    绑定时才出现（`task_completion.rs`：「This task was killed by the user —
    do not restart it.」）。所以这里只报：本跳跑了什么、现在手上有什么、
    还缺什么、还能调哪几件、调 rehearse 的后果是什么。挑哪一件交给模型。

    ⚠ 事实比禁令更硬：写「页面 0 份」比写「不要假装页面已经出来」更难被绕过——
      前者是可核对的数，后者只是一句叮嘱。
    """
    tools = _this_hop_tools(state)
    labels = dict(TOOL_LABELS)
    ran = "、".join(labels.get(t, t) for t in tools)

    n_pages = len(((getattr(state, "specFirstPages", None) or {}).get("pages")) or {})
    facts: List[str] = []
    if ran:
        facts.append(f"本跳实际跑了：{ran}。")
    facts.append(
        f"当前产出：SPEC {'有' if _has_spec(state) else '没有'}，页面 {n_pages} 份。"
    )

    factory = {"pages", "structure", "bind", "closure"}
    pages_missing = not _has_pages(state) and (
        not tools
        or not factory.intersection(tools)
        or is_first_pass_chain(tools)
    )
    if not tools and not _has_spec(state) and not _has_pages(state) and not _has_model(state):
        return ""

    if pages_missing:
        facts.append(
            "页面还没有，用户现在看不到任何东西——"
            "pages 是唯一能把页面画出来的工具。"
        )
        if _assumptions_awaiting(state):
            # ⚠ 这一条不是叮嘱，是**把闸说清楚**。
            #
            # 假设卡等确认时本轮 HTTP 直接收工（`_complete_waiting_for_assumptions`），
            # 不再 tools=[] 还问一轮控制面——那是 2026-09-03 的 25 分钟事故。
            # 没有假设时 host 按 hint 挑 pages。这里把闸讲清楚，给交回那一
            # 轮看（forced 路径罐头收尾也会带上）。
            facts.append(
                "假设卡正在等用户点「确认继续」，确认之前不画页面——"
                "这一轮的任务是把现在的状态讲清楚，不是往下调工具。"
            )
    else:
        done = "、".join(labels.get(t, t) for t in tools) if tools else ""
        if done:
            facts.append(f"{done} 这几件本跳已经做过，重复调不会有新产出。")

    # ★ 首轮待办也要回流（2026-09-05 真机第 4 轮 sr-20260904214530）。
    #
    # 真机形状：3 页画完、loop 预算耗尽停在 max_loops，而账上
    # `factoryTodo = ['structure','bind']` **一直没清**——数据模型没反推、
    # 权限没打孔。而交回 host 的最后一句是：
    #     「页面已经出来。要改哪一页，或者说继续精修、补齐缺口。」
    # 听起来像做完了。用户看到的是一个"完工"的口气配一份半成品。
    #
    # 跟今晚闭环裁决那条一模一样：**机器已经算出来的事实，叙述侧看不见**。
    # 待办本来就在 `_state_digest` 里给选材器看（【首轮待办】那一行），
    # 唯独这条收尾情报没接——于是选材器知道、说话的那一版不知道。
    # 用同一个 `factory_todo_open`，不另开一份口径（§4）。
    _todo_open = factory_todo_open(getattr(state, "factoryTodo", None))
    if _todo_open:
        _todo_text = "、".join(labels.get(t, t) for t in _todo_open)
        facts.append(
            f"首轮账上还挂着没做的产出跳：{_todo_text}。"
            "这几跳没跑完，应用是半成品——数据模型没反推 / 权限没打孔，"
            "闭环判定也会因此拦下。"
        )

    # ★ 裁决要回流到计划侧（2026-09-04 社区养老真机 sr-20260904181150）。
    #
    # 真机形状：closure 判出
    #   CLOSURE_GOAL_RELEVANCE_FAILED「目标的 24 个业务点只覆盖了 5 个（21%
    #   < 50%）。未见落实：老人全景档案、饮食忌口、补贴资质…」
    # 而这个 hint 里只有「本跳实际跑了：闭环判定。当前产出：SPEC 有，页面 4 份。」
    # ——**一个字都没提它没过**。于是模型照着手上的材料如实叙述成
    #   「闭环判定已完成。当前已具备 4 份页面…请问下一步」
    # 用户看到的是"完成"，实际是被拦下的；接着它又点了一次 closure，
    # 原地重跑，同样的理由再来一遍。日志里连着两条 `factory-plan tools=closure`。
    #
    # 这跟 factoryTodo 那条是同一件事：**机器已经算出来的事实，计划侧看不见**。
    # 拦截理由本来就是数据（topBlockers），人话只有 closure_block_reason.
    # user_report 一个出口（那个模块头注写着为什么），这里直接用它，
    # 不许在这儿另拼一句——上一次另拼的那句把用户指去补了一天错东西。
    _pc = getattr(state, "publishClosure", None)
    _why = closure_user_report(_pc) if isinstance(_pc, dict) else ""
    if _why:
        facts.append(f"闭环判定**没过**：{_why}。")
        facts.append(
            "同样的产出再调一次 closure 会得到同样的结论——"
            "要么先补产出（pages 补画缺的那几页、structure/bind 跟着补），"
            "要么把这个结论如实告诉用户，由用户决定接不接受。"
        )
    elif isinstance(_pc, dict) and _pc.get("blocked") is False:
        _bound_ids, _failed_ids, _skipped_ids = _bind_account(state)
        if _failed_ids:
            facts.append(
                f"闭环判定 blocked=false，但 {'、'.join(_failed_ids[:6])} "
                "打孔 failed——不能当成已经交差。"
            )
        else:
            facts.append("闭环判定已通过，这份应用可以交付。")

    _bound_ids, _failed_ids, _skipped_ids = _bind_account(state)
    if _failed_ids:
        facts.append(
            f"权限打孔 {len(_failed_ids)} 页 failed（{'、'.join(_failed_ids[:6])}）。"
            "不许说已经全部接好。"
        )
    elif _bound_ids == [] and _skipped_ids and n_pages:
        facts.append(
            f"权限打孔没接到任何页面（{len(_skipped_ids)} 页 skipped）。"
            "不许说已经闭环完成。"
        )

    # ★ 孤岛清单也要回流（2026-09-05）。跟上面闭环裁决同一个病：
    #
    # `app_graph.find_orphans` 早就在打孔之后跑了，结论存进
    # `specFirstPages.qualityNotices`——但那条路**只通到前端**（
    # ArchitectureStage 画一块提示），计划侧一个字看不见。于是「这个应用
    # 声明了『新建服务工单』却没有任何页面能新建」这种事，模型永远不知道。
    #
    # 真机（社区养老 sr-20260904181150）：elder:update / staff:manage /
    # service_order:create / qc_work_order:create 四个动作纸面上有、界面上
    # 没有——用户那道题的第 1 条「老人全景档案」进不去就是这个形状。
    # （权限这一类的孤岛规则本身也是 2026-09-05 才补的，见 app_graph
    #   _ORPHAN_RULES：在那之前图上根本看不见它。）
    # ⚠ 两种 kind 都要收：`orphan`（本次新产生）与 `orphan_stale`（上一版就有）。
    #   只收前者的后果在真机上验到了（2026-09-05 融媒体 sr-20260904195810）：
    #   pages/structure/bind 那一跳报了 3 个新孤岛，紧接着的精修跳报的是
    #   「存量孤岛 2 个」——kind 变成 orphan_stale，过滤器认不出，于是
    #   `_cache_spec_first_pages` 的保留逻辑判定"这一跳跑了 bind 且没有孤岛"，
    #   把上一跳的 3 条清了。**存量孤岛照样是用户点不进去的动作**，
    #   不是"已经处理过"的意思。
    _ORPHAN_KINDS = ("orphan", "orphan_stale")
    _orphans = [
        n for n in ((_sfp(state).get("qualityNotices")) or [])
        if isinstance(n, dict) and str(n.get("kind") or "") in _ORPHAN_KINDS
    ]
    if _orphans:
        _head = "；".join(str(n.get("text") or "")[:120] for n in _orphans[:2])
        facts.append(f"体检报了孤岛：{_head}。")
        facts.append(
            "孤岛是「东西做出来了但接不上」——通常补一页或给某一页加个动作就能接上，"
            "不需要重跑整条链。"
        )

    facts.append(
        "rehearse 会从头重跑整条产出链，已有的 SPEC 与页面都会被覆盖。"
    )
    facts.append(
        "下一步由你决定：接着调工具，或者用一两句话告诉用户现在的状态和你的建议。"
    )
    return "".join(facts)


def _messages_after_forced_write(
    state: V5SessionState,
    user_text: str,
    tool: str,
    body: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """按钮没走过 tool-calling，交回模型时补一回合合成记录。"""
    call_id = f"forced-{tool}"
    hint = _after_write_hint(state) or (
        "工厂已经跑完。用一两句话告诉用户下一步。不要再调 rehearse。"
    )
    return [
        {"role": "system", "content": _system_prompt(state)},
        {"role": "user", "content": user_text or "你好"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": tool, "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": call_id,
            # 跟 host 循环那条成对（CLAUDE.md §4）：情报贴在工具结果上，
            # 不伪造 role:user。只改一条，按钮点火这条路就还是老样子。
            "content": append_reminder(bound_tool_result(body), hint),
        },
    ]


async def _resume_control_llm_after_write(
    state: V5SessionState,
    user_text: str,
    tool: str,
    tool_body: Optional[Dict[str, Any]],
    *,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    original_goal: str,
    before_fingerprint: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """按钮点火不经过 LLM；工厂收尾必须交回控制面。

    ⚠ 2026-09-01 真机：点「开始推演」走 forcedTool，第一版在 handoff 后
      return，自由编排整轮零介入。抄 grok：工具流有自己的 Terminal，
      host 循环另算——跳过的是点火前那一轮，不是工厂后的思考。
    """
    fresh = await run_in_threadpool(
        load_session, str(getattr(state, "sessionId", "") or "")
    )
    if fresh is not None:
        state = fresh
    body = (
        tool_body
        if tool_body is not None
        else _factory_tool_body(state, tool, before_fingerprint=before_fingerprint)
    )
    if tool_body is None:
        yield {"type": "control_tool_result", "tool": tool, **body}
    # 假设卡等确认：结束本轮 HTTP，别再问控制面。
    # ⚠ 2026-09-03 sr-20260903204902：交回仍 `_invoke_control_llm`，
    #   HTTP 挂住 SSE，确认继续排队 25 分钟。没有假设时 host 按 hint 挑
    #   pages——那是步骤级自主，不许再 tools=[] 把清单清掉。
    if _assumptions_awaiting(state) and not _has_pages(state):
        async for event in _complete_waiting_for_assumptions(state):
            yield event
        return
    messages = _messages_after_forced_write(state, user_text, tool, body)
    async with aclosing(_control_llm_loop(
        state,
        messages,
        user_text=user_text,
        installed_skills=installed_skills,
        active_connectors=active_connectors,
        preferred_device=preferred_device,
        design_system_id=design_system_id,
        original_goal=original_goal,
        started=time.monotonic(),
        cheap_tokens=0,
        empty_text=(
            POST_SPEC_USER
            if not _has_pages(state)
            else POST_WRITE_FALLBACK
        ),
        tools=None,
    )) as stream:
        async for event in stream:
            yield event


async def _control_llm_loop(
    state: V5SessionState,
    messages: List[Dict[str, Any]],
    *,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    original_goal: str,
    started: float,
    cheap_tokens: int,
    empty_text: Optional[str] = None,
    tools: Optional[List[Any]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """控制面 host 循环。WRITE 交回后再给便宜思考。

    tools=None：用本轮清单（list_control_tools）。假设卡等确认时本函数
    不会被叫到——见 `_complete_waiting_for_assumptions`。
    """

    async def _maybe_over_cap(*, include_context: bool = False) -> Optional[Dict[str, Any]]:
        """到顶了就返回结构化的停止信息，没到顶返回 None。

        ⚠ 原来返回 bool，两条不同的闸（墙钟 / 额度）塌成同一句话。前端分不清
          "想太久"和"额度烧完"，用户也不知道再点一次有没有用。

        ⚠ 2026-09-15：project-v2 的 max_tokens 是上下文窗口，不是 cheapTokens
          累加。include_context 只在压缩之后才打开——先停再压等于压缩永远
          走不到（§一之二）。
        """
        elapsed = time.monotonic() - started
        if elapsed > loop_budget.max_wall_seconds:
            return stop_wire(
                ControlStopReason.WALL_CLOCK,
                limit=loop_budget.max_wall_seconds,
                used=round(elapsed, 1),
            )
        if loop_budget.context_token_budget:
            if include_context:
                used = estimate_message_tokens(messages)
                if used > loop_budget.max_tokens:
                    return stop_wire(
                        ControlStopReason.TOKEN_BUDGET,
                        limit=loop_budget.max_tokens,
                        used=used,
                    )
            return None
        if cheap_tokens > loop_budget.max_tokens:
            return stop_wire(
                ControlStopReason.TOKEN_BUDGET,
                limit=loop_budget.max_tokens,
                used=cheap_tokens,
            )
        return None

    async def _compact_context_if_needed() -> Optional[Dict[str, Any]]:
        """窗口快满就折叠较早的工具结果，然后继续采样。压完仍超窗才停。

        事件必须是 control_text（不许新类型——consumeControlStreamResponse
        的 switch 没有 default，新类型会被静默丢掉）。
        """
        occupancy = estimate_message_tokens(messages)
        snipped, snip_report = microcompact_messages(messages)
        if snip_report.did_compact:
            messages[:] = snipped
            occupancy = estimate_message_tokens(messages)
        if not loop_budget.should_compact(occupancy):
            return None
        compacted, report = compact_messages(
            messages,
            max_tokens=loop_budget.max_tokens,
            compact_at_tokens=loop_budget.compact_at_tokens,
        )
        if report.did_compact:
            messages[:] = compacted
            print(
                f"[control] compact before={report.tokens_before} "
                f"after={report.tokens_after} folded={report.folded} "
                f"window={loop_budget.max_tokens}",
                flush=True,
            )
            text = str(compacted[1].get("content") or compacted[0].get("content") or "")
            if not text.startswith("【会话压缩】"):
                text = next(
                    (str(row.get("content") or "") for row in compacted
                     if str(row.get("content") or "").startswith("【会话压缩】")),
                    text,
                )
            _append_transcript(state, {"role": "assistant", "kind": "compact", "text": text})
            await _apersist(state)
            return {"type": "control_text", "text": text, "compacted": True}
        return None

    # 一个回合一份游标。抄 grok：`identical_tool_calls` 是
    # `process_conversation_turn` 的局部变量，不是 actor 上的字段——
    # 上一个回合的打转记录不许漏进这一个。
    identical_tool_calls = IdenticalToolCallRun()
    # 第二道游标，同样一个回合一份。数的是「同一次调用带回同一份结果」，
    # 补的是整轮签名那道闸的洞（并行调用里有一件在变就清零）。
    stagnant_calls = StagnantCallLedger()
    # 第三道：一直在读、一次没写。只捅不掐（读源码是正当动作）。
    #
    # ⚠ **从 session state 读出来，不是新建一个空的。** 前两道是回合级游标，
    #   这一道跨回合——真机证过它在「单回合」那根轴上跟正当用法分不开
    #   （每回合最多 3 轮只读就收尾，而正当排障也正好 3 轮）。
    #   见 action_stationarity 里 NUDGE_AFTER_READONLY_ROUNDS 的头注。
    readonly_streak = ReadOnlyStreak.from_state(
        getattr(state, "controlReadOnly", None)
    )

    port = current_checkpoint.get()
    resume = copy.deepcopy(port.checkpoint) if port is not None else None
    resume = resume if resume and resume.get("phase") in {"model", "tools"} else None
    try:
        loop_budget = _loop_budget_for(state, resume)
    except ValueError as exc:
        raise ControlRunStopped("control_reconciliation_required") from exc
    # 新一轮（含自动续跑）可以在 project_create 之后升到工程档。
    # 中途 resume 不许因为部署了更大的档就另领一份预算。
    can_enter_project_budget = _is_fresh_control_round(resume)
    print(
        f"[control] budget profile={loop_budget.profile} "
        f"context_token_budget={int(loop_budget.context_token_budget)} "
        f"occupancy={estimate_message_tokens(messages)} "
        f"cheapTokens={cheap_tokens}",
        flush=True,
    )
    first_round = int(resume["round"]) if resume else 0
    operation_ids = list(resume.get("operationIds", [])) if resume else []
    if resume:
        for key, value in resume.get("stationarity", {}).items():
            setattr(identical_tool_calls, key, value)
        for key, value in resume.get("stagnantCalls", {}).items():
            setattr(stagnant_calls, key, value)
        for key, value in resume.get("readonlyStreak", {}).items():
            setattr(readonly_streak, key, value)

    async def checkpoint(phase, round_index, pending_calls=None, content="", provider_failure=None):
        if port is None:
            return
        budget = current_budget()
        await _apersist(state)
        await port.save({"schemaVersion": 1, "phase": phase,
            "messages": messages, "round": round_index,
            "operationIds": operation_ids,
            "pendingCalls": pending_calls or [], "content": content,
            "cheapTokens": cheap_tokens,
            "budgetPolicy": loop_budget.to_wire(),
            **({"providerFailure": provider_failure} if provider_failure is not None else {}),
            "startedAt": time.time() - (time.monotonic() - started),
            "retrySpent": budget.spent if budget else 0,
            "retryStartedAt": time.time() - budget.elapsed() if budget else time.time(),
            "stationarity": {key: getattr(identical_tool_calls, key)
                             for key in IdenticalToolCallRun.__slots__},
            "stagnantCalls": {key: getattr(stagnant_calls, key)
                              for key in StagnantCallLedger.__slots__},
            "readonlyStreak": {key: getattr(readonly_streak, key)
                               for key in ReadOnlyStreak.__slots__},
            "options": dict(user_text=user_text, installed_skills=installed_skills,
                active_connectors=active_connectors, preferred_device=preferred_device,
                design_system_id=design_system_id, original_goal=original_goal,
                empty_text=empty_text, tools=tools)})

    try:
        _round = first_round
        while _round < loop_budget.max_rounds:
            restoring_calls = bool(resume and resume.get("phase") == "tools")
            capped = await _maybe_over_cap()
            if capped:
                await checkpoint("budget_exhausted", _round)
                reason = ControlStopReason(capped["stopReason"])
                async for event in _settle_runtime_cap(state, reason, capped):
                    yield event
                return
            if not restoring_calls:
                compacted_event = await _compact_context_if_needed()
                if compacted_event is not None:
                    yield compacted_event
                capped = await _maybe_over_cap(include_context=True)
                if capped:
                    await checkpoint("budget_exhausted", _round)
                    reason = ControlStopReason(capped["stopReason"])
                    async for event in _settle_runtime_cap(state, reason, capped):
                        yield event
                    return

            # ── 原地打转：先判断状态，再花钱问模型 ────────────────────────
            # 抄 grok 主循环的**顺序**，这一点比阈值本身重要：
            #
            #     loop {
            #         self.emit_event(Event::LoopStarted { loop_index });
            #         loop_index += 1;
            #         if identical_tool_calls.run_len >= …hard_stop_threshold() { … }
            #         if identical_tool_calls.take_nudge() { … }
            #         …然后才去采样
            #
            # 每一轮开头第一件事是问「模型是不是在原地打转」，问完才采样。
            # 我们原来是反过来的：先问模型，再看结果——所以「同一件事干了 8 遍」
            # 只能等 MAX_TOOL_ROUNDS 兜底，还兜成一句「想得太久」的假话。
            if not restoring_calls and identical_tool_calls.should_hard_stop():
                tool_name, run_len, problematic = identical_tool_calls.telemetry()
                print(
                    f"[control] stationarity_stop tool={tool_name!r} "
                    f"run_len={run_len} problematic={int(problematic)} "
                    f"round={_round}",
                    flush=True,
                )
                stationarity_stop = stop_wire(
                    ControlStopReason.STATIONARITY,
                    limit=identical_tool_calls.hard_stop_threshold(),
                    used=run_len,
                )
                # ⚠ limit/used 不是装饰：光说「打转了」没法行动，说「同一件
                #   inspect_model 连了 4 轮、紧档上限就是 4」才知道该不该调这个数。
                #   跟另外两条闸（墙钟 45s / 额度 8000）同一个合同。
                async for event in _settle_runtime_cap(
                    state, ControlStopReason.STATIONARITY, stationarity_stop
                ):
                    yield event
                return
            if not restoring_calls and identical_tool_calls.take_nudge():
                tool_name, run_len, problematic = identical_tool_calls.telemetry()
                print(
                    f"[control] stationarity_nudge tool={tool_name!r} "
                    f"run_len={run_len} problematic={int(problematic)} "
                    f"round={_round}",
                    flush=True,
                )
                # 贴在上一轮的工具结果上，不另起 role:user——同 _after_write_hint
                # 那条纪律（伪造用户消息会让模型以为是用户在下命令）。
                _push_system_reminder(messages, identical_tool_calls.nudge_text())

            # 第二道，同一个位置、同一个次序（先掐断、再捅一下、然后才采样）。
            # 这道数的是「同一次调用带回同一份结果」——整轮签名那道闸看不见的
            # 那种打转：并行调用里只要有一件在变，它就永远清零。
            if not restoring_calls and stagnant_calls.should_hard_stop():
                tool_name, repeats = stagnant_calls.telemetry()
                print(
                    f"[control] stagnant_stop tool={tool_name!r} "
                    f"repeats={repeats} round={_round}",
                    flush=True,
                )
                async for event in _settle_runtime_cap(
                    state,
                    ControlStopReason.STATIONARITY,
                    stop_wire(
                        ControlStopReason.STATIONARITY,
                        limit=stagnant_calls.hard_stop_threshold(),
                        used=repeats,
                    ),
                ):
                    yield event
                return
            if not restoring_calls and stagnant_calls.take_nudge():
                tool_name, repeats = stagnant_calls.telemetry()
                print(
                    f"[control] stagnant_nudge tool={tool_name!r} "
                    f"repeats={repeats} round={_round}",
                    flush=True,
                )
                _push_system_reminder(messages, stagnant_calls.nudge_text())

            # 第三道：一直在读、一次没写。**只捅不掐**——读源码是正当动作，
            # 掐断会把「多读两轮再下手」的正常行为变成事故。
            if not restoring_calls and readonly_streak.take_nudge():
                print(
                    f"[control] readonly_nudge rounds={readonly_streak.rounds} "
                    f"round={_round}",
                    flush=True,
                )
                _push_system_reminder(messages, readonly_streak.nudge_text())

            offered = list_control_tools(state) if tools is None else list(tools)
            prior = _user_turn_before_need(state, user_text) or "你好"
            messages[:] = _repair_function_call_turn_order(
                messages, fallback_user=prior
            )
            if restoring_calls:
                result = ControlLlmResult(content=resume["content"],
                    tool_calls=resume["pendingCalls"], usage=None,
                    finish_reason="tool_calls", model="checkpoint", latency_ms=0)
            else:
                await checkpoint("sampling", _round)
                # 单发读超时跟着 budget profile 走：对话档 75 秒、工程档 v2 600 秒。
                # 读完整份源码再想怎么改，45/120 秒都不够（见 ControlBudget
                # .max_request_seconds 头注，以及 2026-09-15 团长工作台 120.9s）。
                result = await owned_model_sample(_invoke_control_llm(
                    messages, tools=offered,
                    timeout_ms=loop_budget.request_timeout_ms()))
                await run_in_threadpool(guard_control_run)
            cheap_tokens += _usage_tokens(getattr(result, "usage", None))
            capped = await _maybe_over_cap()
            if capped:
                await checkpoint("budget_exhausted", _round)
                async for event in _flush_write_plan_from_sample(
                    state,
                    result,
                    user_text,
                    installed_skills,
                    active_connectors,
                    preferred_device,
                    design_system_id,
                    original_goal,
                ):
                    yield event
                reason = ControlStopReason(capped["stopReason"])
                async for event in _settle_runtime_cap(state, reason, capped):
                    yield event
                return
            # 抄 grok should_list：看不见的工具不能调。CLOSED_TOOLS 是闭集，
            # 不是本轮清单——空会话模型仍可能塞 spec，接着 park 成
            # 「我认成了：继续执行」（2026-09-08 真机）。
            offered_names = {
                str(((t.get("function") or {}).get("name") or ""))
                for t in offered
                if isinstance(t, dict)
            }
            calls = [
                call
                for call in (result.tool_calls or [])
                if restoring_calls or (call.get("name") or "") in offered_names
            ]
            # One normalized identity is shared by assistant, tool result and
            # recovery receipt, including providers that omit or reuse IDs.
            seen_ids = {m.get("tool_call_id") for m in messages if m.get("role") == "tool"}
            for call in calls:
                if not call.get("id") or (not restoring_calls and call["id"] in seen_ids):
                    call["id"] = "call-" + uuid.uuid4().hex
                seen_ids.add(call["id"])
            # ⚠ 诊断：模型**看见了什么**、**挑了什么**、**被裁掉了什么**。
            #   缺这一行时，「你好为什么点着了工厂」只能靠读代码猜——真机日志里
            #   只有 `[control] forced hop=None`，看不出模型挑了哪件工具。
            dropped = [
                str(c.get("name") or "")
                for c in (result.tool_calls or [])
                if (c.get("name") or "") not in offered_names
            ]
            print(
                f"[control] goal={_goal_text(state)[:40]!r} "
                f"offered={sorted(offered_names)} "
                f"picked={[str(c.get('name') or '') for c in calls]} "
                f"dropped={dropped}",
                flush=True,
            )
            if tools == []:
                # 只许说话：夹具/模型仍可能塞 tool_calls，不许再 park / 点火。
                calls = []
            content = (result.content or "").strip()
            if not calls:
                await checkpoint("settling", _round + 1)
                if (
                    tools != []
                    and not _has_product_topic(state)
                    and not str(original_goal or "").strip()
                    and not _has_ask_answer_candidate(state)
                ):
                    if content:
                        _append_transcript(
                            state,
                            {
                                "role": "assistant",
                                "kind": "control_text",
                                "text": content,
                            },
                        )
                        await _apersist(state)
                        yield {"type": "control_text", "text": content}
                    async for event in _park_ask(
                        state, CHEAP_TURN_FALLBACK, []
                    ):
                        yield event
                    return
                text = content or empty_text or CANNED_FAILURE
                _append_transcript(
                    state, {"role": "assistant", "kind": "control_text", "text": text}
                )
                await _apersist(state)
                yield {"type": "control_text", "text": text}
                # ⚠ 2026-09-22 BABCJGGB44：清掉 503 停泊时把 phase 设成
                #   orchestrating。模型说完就结束，complete 仍停在 orchestrating。
                #   没有待答问题，这一轮已经收口。
                if (
                    getattr(state, "runtimePhase", None) == "orchestrating"
                    and not getattr(state, "awaitReason", None)
                ):
                    state.runtimePhase = "idle"
                    await _apersist(state)
                yield _complete(state)
                return

            # 模型在派发工具**之前**说的那段话，是它对用户的开口，不是日志。
            #
            # ⚠ 2026-09-13：原判据是「还没定产品主题 **且** 这批工具里有
            #   ask_user_question」才发。工程模式下模型每一轮都会先说
            #   「我会采用浅蓝工作台…接着初始化项目」再调 project_create——
            #   两个条件都不成立，那段话只进了喂给 LLM 的 `assistant_msg`，
            #   **一个字都没到界面上**。左栏于是只剩机器味的阶段标签
            #   （「第 1 轮 · 正在执行 planning」），用户看不出它在想什么。
            #   对照 Manus：每组动作前面都有一段第一人称的「我要做什么、
            #   为什么」——那段话我们的模型本来就在产，缺的只是这里没 yield。
            #
            # ⚠ 不在这里过滤「操作员口吻」（"下一跳请调 pages" 之类）。那份
            #   判据已经在消费侧 `assistant-text-for-turn.ts` 的 OPERATOR_SPEAK
            #   里，同一条规则不许有第二处实现（§4：改一半必然静默失效）。
            if content:
                _append_transcript(
                    state,
                    {"role": "assistant", "kind": "control_text", "text": content},
                )
                await _apersist(state)
                yield {"type": "control_text", "text": content}

            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                # ⚠ 2026-09-02 真机：`content or None` 在模型只回 tool_calls
                #   时变成 None，下一轮 `_normalize_message` 直接抛
                #   「content must be a string or content part list」，
                #   工厂后的控制面收尾整段死掉。空串是合法的。
                "content": content,
                "tool_calls": [
                    {
                        "id": call.get("id") or f"call-{i}",
                        "type": "function",
                        "function": {
                            "name": call.get("name"),
                            "arguments": json.dumps(
                                call.get("arguments") or {}, ensure_ascii=False
                            ),
                        },
                    }
                    for i, call in enumerate(calls)
                ],
            }
            if not restoring_calls:
                messages.append(assistant_msg)

            # 这一轮的签名记进游标。**在这儿记、到下一轮开头才判**，
            # 抄 grok 的位置（observe 在执行前、take_nudge 在下一轮循环开头）：
            # 提醒必须贴在已经落进对话的结果后面，不能贴在还没发生的事上。
            #
            # ⚠ 记的是 `calls`（过滤后真会跑的那批），不是 result.tool_calls。
            #   模型反复挑没列出来的工具时 calls 为空，上面早就 return 了，
            #   在这儿再算一遍只会把「被裁掉的」也当成一段打转。
            if not restoring_calls:
                identical_tool_calls.observe(
                    step_signature(calls), step_tool_name(calls),
                    _step_is_problematically_repeating(calls),
                )
                # ⚠ 用 `step_is_read_only` 而**不是**上面那个紧档判断：
                #   工程工具没进 TOOL_SCOPE、缺省 READ，拿紧档判断当「没写」
                #   会把 project_patch 也算成读（见 tool_writes 头注那次回归）。
                readonly_streak.observe(step_is_read_only(calls))
                # ⚠ 立刻写回 state：这道闸跨回合，只落 checkpoint 的话，
                #   下一个回合（新的用户消息）会从零开始——那正是第一版
                #   一次都没响的原因。`_apersist(state)` 在 checkpoint() 里。
                state.controlReadOnly = readonly_streak.to_state()
            resume = None
            await checkpoint("tools", _round, calls, content)

            parked = False
            aborted = False
            wrote = False
            for call_index, call in enumerate(calls):
                name = str(call.get("name") or "")
                args = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
                tool_body: Optional[Dict[str, Any]] = None
                await checkpoint("dispatching", _round, calls[call_index:], content)
                with tool_scope_scope(name):
                    async with aclosing(_dispatch_tool(
                        name,
                        args,
                        state,
                        user_text,
                        installed_skills,
                        active_connectors,
                        preferred_device,
                        design_system_id,
                        original_goal,
                    )) as stream:
                        async for event in _logged_tool_events(state, stream):
                            if port is not None:
                                event = {**event, "toolCallId": call["id"]}
                            yield event
                            et = str(event.get("type") or "")
                            if et == "control_tool_result":
                                tool_body = {
                                    k: v for k, v in event.items() if k != "type"
                                }
                                operation_id = tool_body.get("operationId")
                                if operation_id and operation_id not in operation_ids:
                                    operation_ids.append(operation_id)
                            if et == "control_ask_user":
                                parked = True
                            elif et == "control_plan_approval":
                                parked = True
                            elif et == "control_handoff_factory":
                                wrote = True
                            elif et == "complete" and not wrote:
                                aborted = True
                if parked or aborted:
                    return
                # 记这一次调用及其结果。**在这儿记、到下一轮开头才判**，
                # 跟上面那道闸同一个位置纪律：提醒要贴在已经落进对话的结果后面。
                #
                # ⚠ 喂的是 `tool_body`——控制面手里那一份**原样载荷**，
                #   里面带着每发都变的 seq / toolCallId，由
                #   `result_fingerprint` 按名单剔掉。自己在这儿先挑一遍字段，
                #   就等于把判据和产线各写一份（CLAUDE.md §4）。
                if not restoring_calls:
                    stagnant_calls.observe(call_signature(call), result_fingerprint(tool_body))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or "",
                        # ⚠ 必须走 bound_tool_result，不许裸 json.dumps：
                        #   search_evidence 的 hits 来自公网，一次胖搜索能把
                        #   下一发请求的提示词顶穿（见该函数头注）。
                        "content": bound_tool_result(
                            tool_body
                            if tool_body is not None
                            else {"ok": True, "tool": name},
                            name,
                        ),
                    }
                )
                if name in PROJECT_TOOL_NAMES or name in {"write_plan", "enter_plan_mode"}:
                    messages[0] = {"role": "system", "content": _system_prompt(state)}
                if (can_enter_project_budget and name == "project_create"
                        and tool_body and tool_body.get("ok") and _project_budget_eligible(state)):
                    # Entry changes its policy, not its already spent tokens,
                    # model rounds, retry ledger or original wall-clock start.
                    loop_budget = PROJECT_BUDGET
                remaining = calls[call_index + 1:]
                await checkpoint("tools" if remaining else "model",
                    _round if remaining else _round + 1, remaining, content)
            if wrote:
                # 工厂墙钟不计入控制面 45s。WRITE 交回后再给便宜思考。
                started = time.monotonic()
                reloaded = await run_in_threadpool(
                    load_session, str(getattr(state, "sessionId", "") or "")
                )
                if reloaded is not None:
                    state = reloaded
                    messages[0] = {"role": "system", "content": _system_prompt(state)}
                hint = _after_write_hint(state)
                if hint:
                    # 抄 grok `format_with_reminders`：情报**追加在工具结果上**，
                    # 不另起一条 role:user。
                    #
                    # ⚠ 2026-09-04：原来是 `messages.append({"role":"user",...})`
                    #   ——伪造一条用户消息。模型看见的是「用户命令我调 pages」，
                    #   而用户根本没说过；下一轮真用户开口时两条 user 还会打架。
                    #   只改 system 会被下一轮用户话盖掉（这条原注释是对的），
                    #   贴在 tool 结果上两个毛病都没有。
                    # 2026-09-09 提成 _push_system_reminder：原地打转的 nudge
                    # 要贴同一个位置，两份实现必然只改一半（CLAUDE.md §4）。
                    _push_system_reminder(messages, hint)
                # LLM 路径原先 empty_text=None，空回复会吐开场罐头（P3 ③）。
                empty_text = (
                    POST_SPEC_USER
                    if not _has_pages(state)
                    else POST_WRITE_FALLBACK
                )
                if _assumptions_awaiting(state) and not _has_pages(state):
                    async for event in _complete_waiting_for_assumptions(state):
                        yield event
                    return
                # 没有假设：清单仍走 list_control_tools（pages 在有 SPEC
                # 时会出现）。host 按 hint 挑下一跳，不许 tools=[]。
            _round += 1
        await checkpoint("budget_exhausted", _round)
        rounds_stop = stop_wire(
            ControlStopReason.TOOL_ROUNDS, limit=loop_budget.max_rounds, used=_round
        )
        async for event in _settle_runtime_cap(
            state, ControlStopReason.TOOL_ROUNDS, rounds_stop
        ):
            yield event
    except HTTPException:
        raise
    except LlmError as exc:
        import logging

        # A rejected/empty response can still report billable usage. Keep that
        # receipt before announcing the stop. This phase is never auto-resumed:
        # a crash must not turn a known rejection into a fresh model request.
        failed_usage = getattr(exc, "usage", None)
        cheap_tokens += _usage_tokens(failed_usage)
        finish = getattr(exc, "finish_reason", None)
        reported = (isinstance(failed_usage, dict)
                    and any(key in failed_usage for key in ("total_tokens", "prompt_tokens", "completion_tokens")))
        await checkpoint("provider_failed", _round + 1, provider_failure={
            "finishReason": finish,
            "reportedTokens": _usage_tokens(failed_usage) if reported else None,
        })
        logging.getLogger(__name__).exception("control llm loop failed after write")
        # empty_text 是模型空回复的人话，不是异常的人话。
        # ⚠ 2026-09-05：网关挂了还套 CANNED_FAILURE「说一个要做的应用」。
        # ⚠ 2026-09-08：NeedUserAnswer 把 empty_text 设成那句罐头，
        #   异常分支优先端罐头，停因表的实话又被盖掉。
        #   同一天：LlmError 是 522 仍端「连不上」——机器知道状态码。
        # ⚠ 2026-09-21 sr-20260921150545 / HKA1MC5142：问卷后 503、首轮
        #   503 都写过 failed，再走 `_canned` 就会被读成 idle。失败停泊
        #   走 `_park_control_error`，不借用额度到顶那条罐头。
        async for event in _park_control_error(
            state,
            _provider_failure_text(exc, state),
            stop={**stop_wire(ControlStopReason.LLM_UNAVAILABLE),
                  **({"providerFinishReason": finish} if finish else {})},
            detail="llm_unavailable",
        ):
            yield event
    except Exception as exc:  # noqa: BLE001 — 失败合同：罐头回复，禁止点火
        import logging

        logging.getLogger(__name__).exception("control llm loop failed after write")
        # persist / schema / 代码自己炸了 ≠ 网关连不上。
        # ⚠ 2026-09-22 FFR6：罐头只有「没点火」，awaitDetail 是
        #   control_loop_failed。模型下一轮不知道是哪一种异常。类型名
        #   不是栈，也不把异常正文塞进用户话里。
        name = type(exc).__name__ or "Exception"
        async for event in _park_control_error(
            state,
            stop_text(ControlStopReason.UNKNOWN) + f"（{name}）",
            stop=stop_wire(ControlStopReason.UNKNOWN),
            detail=name[:80],
        ):
            yield event


async def _run_control_turn_body(
    payload: Dict[str, Any],
    state: V5SessionState,
) -> AsyncIterator[Dict[str, Any]]:
    user_text = str(payload.get("userText") or "")
    installed_skills = payload.get("installedSkills")
    active_connectors = payload.get("activeConnectors")
    preferred_device = payload.get("preferredDevice")
    design_system_id = payload.get("designSystemId")
    started = time.monotonic()
    cheap_tokens = 0
    original_goal = _goal_text(state)

    raw_forced = str(
        payload.get("forcedTool") or payload.get("forced_tool") or ""
    ).strip()
    raw_answer = payload.get("toolAnswer") or payload.get("tool_answer")
    if isinstance(raw_answer, dict) and raw_answer.get("kind") == "plan_approval":
        outcome = await _accept_plan_answer(state, raw_answer)
        if outcome in ("stale", "abandoned"):
            yield {"type": "control_text", "text": "计划审批已失效，请重新提交计划。" if outcome == "stale" else "已放弃本次计划。"}
            yield _complete(state)
            return
        user_text = (
            "用户已批准已保存的计划，请按该版本执行。"
            if outcome == "approved"
            else "用户取消了计划审批，请继续访谈并修改计划。反馈：" + str(raw_answer.get("feedback") or "")
        )
        async with aclosing(_control_llm_loop(
            state,
            [{"role": "system", "content": _system_prompt(state)}, {"role": "user", "content": user_text}],
            user_text=user_text, installed_skills=installed_skills,
            active_connectors=active_connectors, preferred_device=preferred_device,
            design_system_id=design_system_id, original_goal=_goal_text(state),
            started=started, cheap_tokens=0, empty_text=CHEAP_TURN_FALLBACK,
        )) as stream:
            async for event in stream:
                yield event
        return
    if state.awaitReason == "control_plan_approval":
        async for event in _park_plan_approval(state):
            yield event
        return
    answer = _tool_answer_from_payload(payload, state, user_text)
    if answer:
        try:
            await _stamp_user_answer(state, payload, answer)
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
            yield {"type": "control_tool_result", "tool": "ask_user_question", "ok": False, "error": str(exc.detail)}
            yield _complete(state)
            return
        user_text = answer.get("text") or user_text
        # 回执不是新指令。只有纸条本身点名了闭集工具（芯片「精修（refine）」）
        # 或 payload 带了 forcedTool，才走强制分发；开放回答里的 hop 词不算。
        forced = resolve_forced_tool(
            payload,
            user_text if closed_tool_from_text(user_text) else "",
            first_pass=not _has_spec(state) and not _has_pages(state),
        )
        print(
            f"[control] forced hop={forced} hasSpec={int(_has_spec(state))} "
            f"hasPages={int(_has_pages(state))} answer={user_text[:48]!r} "
            f"kind={answer.get('kind')}",
            flush=True,
        )
        if not forced or forced in ("ask_user_question", "clarify"):
            async with aclosing(_control_llm_loop(
                state,
                _messages_after_need_answer(state, user_text, answer),
                user_text=user_text,
                installed_skills=installed_skills,
                active_connectors=active_connectors,
                preferred_device=preferred_device,
                design_system_id=design_system_id,
                original_goal=original_goal,
                started=started,
                cheap_tokens=0,
                empty_text=(
                    POST_SPEC_USER
                    if _has_spec(state) and not _has_pages(state)
                    else POST_WRITE_FALLBACK
                    if _has_pages(state)
                    else CHEAP_TURN_FALLBACK
                ),
                tools=None,
            )) as stream:
                async for event in stream:
                    yield event
            return
    else:
        # 作曲家另说一句：作废摊着的澄清卡，不当答卷。
        if getattr(state, "awaitReason", None) == "control_clarify":
            _retire_stale_control_questions(state)
            state.awaitReason = None
            state.awaitDetail = None
            if getattr(state, "runtimePhase", None) == "awaiting":
                state.runtimePhase = "idle"
        _append_transcript(state, {"role": "user", "kind": "turn", "text": user_text})
        # ⚠ 2026-09-22 BABCJGGB44：上一轮 503 把会话停在 failed/error。
        #   这一轮工具都成功，模型 idle 交回，complete 仍是 phase=failed
        #   await=error、stop=None。驾驶把它当成又一次 llm_unavailable。
        #   用户已经开口，旧停泊不能跟着这一轮走。
        if (
            getattr(state, "awaitReason", None) == "error"
            or getattr(state, "runtimePhase", None) == "failed"
        ):
            state.awaitReason = None
            state.awaitDetail = None
            if getattr(state, "runtimePhase", None) == "failed":
                state.runtimePhase = "orchestrating"
            await _apersist(state)
        await _resolve_answered_gaps(state, payload)

        # 没 SPEC 也没页面 = 这句是产品话题，不是针对交付物的指令。
        forced = resolve_forced_tool(
            payload,
            user_text,
            first_pass=not _has_spec(state) and not _has_pages(state),
        )
        print(
            f"[control] forced hop={forced} hasSpec={int(_has_spec(state))} "
            f"hasPages={int(_has_pages(state))} text={user_text[:48]!r}",
            flush=True,
        )
        # 抄 grok NeedPermission：卡摊着时输入不是新话题。
        # ⚠ 2026-09-09 真机：复述卡 gate=false，用户又打「权限管理系统」，
        #   又问一轮又出一张卡。开始推演 / 不对再说才是这张卡的出路。
    if forced == "rehearse" or (forced is None and _is_slash_rehearse(user_text)):
        forced = "spec"

    if forced and _project_tool_error(forced, state):
        yield {"type": "control_tool_result", "tool": forced, "ok": False,
               "error": _project_tool_error(forced, state)}
        yield _complete(state)
        return

    if forced and resolve_tool_scope(forced) == ToolScope.WRITE and not plan_execution_authorized(state):
        # An explicit tool name is an intent, never approval. Continue planning.
        forced = None
    if forced in ("pages", "structure", "bind", "closure", "workflow", "refine", "repair") and _assumptions_awaiting(state):
        async for event in _complete_waiting_for_assumptions(state):
            yield event
        return

    if forced == "refine":
        # 精修：userText 是增量指令，禁止覆盖 session goal。persist 后再
        # handoff，否则 persist-as-authority 工厂加载看不到这道闸。
        #
        # ⚠ 2026-09-02：精修有**两个入口**——模型在 _dispatch_tool 里挑 refine，
        #   和用户点按钮走 forcedTool 到这里。只改前者的话，按钮那条（更常走的
        #   那条）照样全量跑，而且不会报错——正是 CLAUDE.md 第四条说的
        #   「成对的东西改一条不改另一条，只会有一半不生效」。两处都要写单件。
        #   已有 SPEC 不许再从 spec 起——2026-09-07 真机水果店点精修弹出
        #   登录假设卡，就是缺省 spec 把刚确认的假设整份重起草。
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["text"] = original_goal
        _hop = "pages" if _has_spec(state) else "spec"
        _blocker = _factory_hop_blocker(state, _hop)
        if _blocker:
            async for event in _canned(
                state,
                _blocker,
                stop=stop_wire(ControlStopReason.LLM_UNAVAILABLE),
            ):
                yield event
            return
        _set_goal_tools(goal, [_hop], refine=True)
        state.goal = goal
        await _apersist(state)
        _fp_before = factory_deliverable_fingerprint(state)
        # 写权限：forcedTool 绕过 _dispatch_tool 直接进工厂，scope 要在这里设。
        handed = False
        with tool_scope_scope("refine"):
            async with aclosing(_handoff_factory(
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                repair=False,
                profile="app",
                nest=True,
            )) as stream:
                async for event in stream:
                    yield event
                    if str(event.get("type") or "") == "control_handoff_factory":
                        handed = True
        if not handed:
            return
        async with aclosing(_resume_control_llm_after_write(
            state,
            user_text,
            "refine",
            None,
            installed_skills=installed_skills,
            active_connectors=active_connectors,
            preferred_device=preferred_device,
            design_system_id=design_system_id,
            original_goal=original_goal,
            before_fingerprint=_fp_before,
        )) as stream:
            async for event in stream:
                yield event
        return

    if forced == "repair":
        # 写权限：forcedTool 绕过 _dispatch_tool 直接进工厂，scope 要在这里设。
        # repair 走覆盖门选材（pick_repair_capabilities），profile=full 不动。
        handed = False
        with tool_scope_scope("repair"):
            async with aclosing(_handoff_factory(
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                repair=True,
                profile="full",
                max_loops=2,
                nest=True,
            )) as stream:
                async for event in stream:
                    yield event
                    if str(event.get("type") or "") == "control_handoff_factory":
                        handed = True
        if not handed:
            return
        async with aclosing(_resume_control_llm_after_write(
            state,
            user_text,
            "repair",
            None,
            installed_skills=installed_skills,
            active_connectors=active_connectors,
            preferred_device=preferred_device,
            design_system_id=design_system_id,
            original_goal=original_goal,
        )) as stream:
            async for event in stream:
                yield event
        return

    if forced == "challenge":
        async for event in _settled(state, _tool_challenge(state, user_text)):
            yield event
        return

    if forced in FACTORY_HOPS:
        # 假设卡「确认继续」= forcedTool pages。点火前跳过控制面 LLM，
        # 工厂收尾必须交回 host（跟 rehearse/refine/repair 同一份合同）。
        #
        # ⚠ 2026-09-02 真机两刀：
        #   1. 这里没套 tool_scope_scope，assert_may_write_model 把未声明
        #      工具当 READ 抛掉。流断了，控制面下一次又去 planning。
        #   2. 走 `_settled(_dispatch_tool)` 后直接 return。nest=True 把
        #      工厂 complete 改名 factory_complete，host 再也没有 complete，
        #      客户端 14 秒后报「推演中断」。rehearse 那条有 resume，这一条漏了。
        print(
            f"[control] forced hop={forced} hasSpec={int(_has_spec(state))} "
            f"hasPages={int(_has_pages(state))}",
            flush=True,
        )
        # 假设确认必须进盘。只活在前端 ref 里，刷新就把同一张卡摊回来。
        sfp = dict(getattr(state, "specFirstPages", None) or {})
        if forced in ("spec",):
            sfp["assumptionsConfirmed"] = False
            state.specFirstPages = sfp
        handed = False
        tool_body: Optional[Dict[str, Any]] = None
        with tool_scope_scope(forced):
            async with aclosing(_dispatch_tool(
                forced,
                {},
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                original_goal,
            )) as stream:
                async for event in _logged_tool_events(state, stream):
                    yield event
                    et = str(event.get("type") or "")
                    if et == "control_handoff_factory":
                        handed = True
                    elif et == "control_tool_result":
                        tool_body = {k: v for k, v in event.items() if k != "type"}
        if not handed:
            return
        async with aclosing(_resume_control_llm_after_write(
            state,
            user_text,
            forced,
            tool_body,
            installed_skills=installed_skills,
            active_connectors=active_connectors,
            preferred_device=preferred_device,
            design_system_id=design_system_id,
            original_goal=original_goal,
        )) as stream:
            async for event in stream:
                yield event
        return

    if forced in CLOSED_TOOLS:
        # 其余 forced 工具仍跳过 LLM，走一圈执行器。
        #
        # ⚠ 2026-09-02 真机：假设卡「确认继续」forcedTool=pages，这里没套
        #   tool_scope_scope，assert_may_write_model 把未声明工具当 READ 抛掉。
        #   流断了，控制面下一次又去 planning / 起草 SPEC，页面框一直 0。
        #   tool_scope_scope 头注写着「两条分发路径都要用」——LLM 那条有，
        #   这一条漏了（CLAUDE.md §4）。pages 已改走 FACTORY_HOPS 那支；
        #   restore / inspect 仍走这里，闸不能拆。
        tool_args: Dict[str, Any] = (payload.get("toolArgs") or {}) if forced in PROJECT_TOOL_NAMES else {}
        if forced == "restore_version":
            vid = str(
                payload.get("versionId") or payload.get("version_id") or ""
            ).strip()
            if vid:
                tool_args["versionId"] = vid
        with tool_scope_scope(forced):
            async for event in _logged_tool_events(
                state,
                _settled(
                    state,
                    _dispatch_tool(
                        forced,
                        tool_args,
                        state,
                        user_text,
                        installed_skills,
                        active_connectors,
                        preferred_device,
                        design_system_id,
                        original_goal,
                    ),
                ),
            ):
                yield event
        return

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": _system_prompt(state)},
        {"role": "user", "content": user_text or "你好"},
    ]
    async with aclosing(_control_llm_loop(
        state,
        messages,
        user_text=user_text,
        installed_skills=installed_skills,
        active_connectors=active_connectors,
        preferred_device=preferred_device,
        design_system_id=design_system_id,
        original_goal=original_goal,
        started=started,
        cheap_tokens=cheap_tokens,
        empty_text=CHEAP_TURN_FALLBACK,
    )) as stream:
        async for event in stream:
            yield event


async def _dispatch_tool(
    name: str,
    args: Dict[str, Any],
    state: V5SessionState,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    original_goal: str,
) -> AsyncIterator[Dict[str, Any]]:
    orch_trace("dispatch", name=name, session=str(getattr(state, "sessionId", "") or "")[:40])
    await run_in_threadpool(guard_control_run)
    if name in PROJECT_TOOL_NAMES and not isinstance(args, dict):
        yield {"type": "control_tool_result", "tool": name, "ok": False, "error": "project_tool_arguments_invalid"}
        return
    # 批准闸（抄 grok 的 ToolDef.requires_permission）。声明在 TOOL_PERMISSION
    # 一处，强制在这一处——不再让每个贵动词各写一段（漏写不报错，只会绕过
    # 范围卡：refine 就这么漏过一次）。
    #
    # grok 把 `Started` 的语义钉成「批准之后、执行之前」，所以这道闸必须在
    # 任何 control_tool_start / handoff 之前。
    # ── pre_tool_use 钩子（抄 grok）。批准闸**之前**跑：grok 的顺序是
    #    钩子可以在权限对话弹出之前就把这次调用拦掉 / 改写入参。
    #
    # ⚠ fail-open：处理器炸了什么都不贡献（grok 那行 SECURITY 注释）。
    #   钩子是**增强类**，不是证据/闭环类——CLAUDE.md §7 的分法。
    #   没挂处理器时 dispatch 立刻返回 ALLOW，这条路等于不存在。
    _hook = dispatch_hook(
        HookEvent.PRE_TOOL_USE,
        {"tool": name, "args": dict(args or {}), "sessionId": getattr(state, "sessionId", "")},
    )
    if _hook.errors:
        print(f"[hooks] pre_tool_use 有处理器炸了（已放行）：{_hook.errors}", flush=True)
    if isinstance(_hook.updated_input, dict):
        # grok `updatedInput`：钩子可以改写这次调用的实参。
        args = dict(_hook.updated_input)
    if _hook.decision is HookDecision.DENY:
        # 拦下必须有理由，否则用户只看到「点了没反应」。
        yield {
            "type": "control_text",
            "text": _hook.reason or f"这次 {name} 被拦下了。",
        }
        yield _complete(state)
        return
    if _hook.decision is HookDecision.ASK:
        # ASK is a real tool gate: pause this invocation before any write or
        # factory handoff. The client already knows how to render tool results;
        # keep the machine reason explicit instead of turning it into a generic
        # questionnaire that could be mistaken for product requirements.
        yield {
            "type": "control_tool_result",
            "tool": name,
            "ok": False,
            "error": "hook_approval_required",
            "human": _hook.reason or "这项操作需要先确认。",
            **({"hookContext": list(_hook.context)} if _hook.context else {}),
        }
        yield _complete(state)
        return

    project_error = _project_tool_error(name, state)
    if project_error:
        yield {"type": "control_tool_result", "tool": name, "ok": False, "error": project_error}
        return
    if not tool_permission_granted(name, state):
        yield {"type": "control_tool_result", "tool": name, "ok": False, "error": "plan_approval_required"}
        return
    if name in PROJECT_TOOL_NAMES:
        adapter = _PROJECT_TOOLS.get()
        # 开场就说得出「在对什么动手」，别让动作进行中的那几十秒界面是哑的。
        #
        # ⚠ 走白名单摘要，**不是**把 args 原样发出去：参数里有 approvalRef
        #   （闸的钥匙）和 project_patch 的文件全文。见
        #   `project_tool_summary` 模块头。
        summary = project_tool_summary(name, args)
        yield tool_start_event(name, summary=summary or "")
        body = await run_in_threadpool(
            _execute_project_tool, adapter, name, args, state
        )
        # Project operations are durable and may outlive this tool call.  Keep
        # the existing control loop alive briefly so the next model turn sees
        # the real terminal result instead of having to ask the user to
        # "continue".  This is deliberately bounded: long work remains
        # resumable through project_status and never blocks cancellation or
        # consumes the control budget indefinitely.
        operation_id = body.get("operationId") if isinstance(body, dict) else None
        # ⚠ 2026-09-18：开场那一发还没 enqueue，没有 id。enqueue 一返回
        #   就把 id 补出去——否则等待里「它的电脑」订不到这条 PTY。
        # ⚠ 2026-09-19：前台 shell 必须在堵住之前补 id。等 exit 再补，
        #   进行中整屏空白，看起来像假流。
        if operation_id:
            yield tool_start_event(
                name, summary=summary or "", operation_id=str(operation_id)
            )
        wait_seconds = _project_tool_wait_seconds(name, args, body)
        if operation_id and wait_seconds > 0:
            deadline = time.monotonic() + wait_seconds
            while time.monotonic() < deadline:
                guard_control_run()
                try:
                    operation = await run_in_threadpool(
                        adapter.store.get_operation, operation_id, owner_id=adapter.owner_id
                    )
                    body = {**body, "status": operation.status}
                    if operation.status in {"completed", "failed", "cancelled"}:
                        # ⚠ 2026-09-21 13ME64TF8Z：裸 snapshot 没有 excerpt。
                        #   enqueue 时 wait=False，日志还没写；等终态必须
                        #   再取 PTY/文件日志尾，否则模型只看见 errorCode。
                        body = {
                            **body,
                            **command_receipt_from(adapter, operation_id),
                        }
                        break
                except Exception:
                    # The operation may be claimed by a recovering worker;
                    # leave the original operationId for a later status poll.
                    break
                await asyncio.sleep(0.25)
        # Source CAS can succeed before session projection. Reload only the
        # authoritative reference; never replace the in-flight conversation.
        reloaded = await run_in_threadpool(load_session, state.sessionId)
        if (reloaded is not None and reloaded.ownerId == state.ownerId
                and reloaded.sessionId == state.sessionId):
            state.runtimeKind = reloaded.runtimeKind
            state.projectId = reloaded.projectId
            state.projectRevision = reloaded.projectRevision
            if state.runtimeKind == "project" and state.projectId and state.projectRevision:
                # 2026-09-13 browser: creation was durable, but the workbench
                # stayed on HTML until the entire model turn completed. Emit
                # only the reloaded references, never trust a tool's claimed
                # project result or overwrite the in-flight conversation.
                # This precedes the tool receipt: receipt-based crash recovery
                # must not skip a projection that was never persisted.
                yield {"type": "control_project_state", "sessionId": state.sessionId,
                    "runtimeKind": "project", "projectId": state.projectId,
                    "projectRevision": state.projectRevision}
        yield {"type": "control_tool_result", "tool": name, **body}
        return
    if name in ("pages", "structure", "bind", "closure", "workflow", "refine", "repair") and _assumptions_awaiting(state):
        async for event in _complete_waiting_for_assumptions(state):
            yield event
        return
    if name == "enter_plan_mode":
        candidate = state.model_copy(deep=True)
        _append_transcript(candidate, {"role": "assistant", "kind": "plan_entered"})
        candidate.awaitReason = None
        candidate.awaitDetail = None
        candidate.runtimePhase = "idle"
        await _commit_plan_state(state, candidate)
        yield {"type": "control_tool_result", "tool": name, "ok": True}
        return
    if name == "write_plan":
        content = str(args.get("planContent") or "").strip()
        if not content or len(content) > 60000:
            yield {"type": "control_tool_result", "tool": name, "ok": False, "error": "invalid_plan_content"}
            return
        previous = latest_control_plan(state)
        kind = _deliverable_kind_for_write_plan(state, args.get("deliverableKind"))
        candidate = state.model_copy(deep=True)
        _append_transcript(candidate, {
            "role": "assistant", "kind": "plan_written", "planContent": content,
            "deliverableKind": kind,
            "mentionedSkills": [info.name for info in _mentioned_skill_infos(state)],
            "planId": previous.get("planId") or f"plan-{uuid.uuid4().hex}",
            "revision": int(previous.get("revision") or 0) + 1,
        })
        candidate.awaitReason = None
        candidate.awaitDetail = None
        candidate.runtimePhase = "idle"
        await _commit_plan_state(state, candidate)
        yield {"type": "control_tool_result", "tool": name, "ok": True, "revision": latest_control_plan(state)["revision"]}
        return
    if name == "exit_plan_mode":
        if args:
            yield {"type": "control_tool_result", "tool": name, "ok": False, "error": "exit_plan_mode_takes_no_input"}
            return
        async for event in _park_plan_approval(state):
            yield event
        return
    if name == "message_notify_user":
        text = str((args or {}).get("text") or "").strip()
        if not text:
            yield {"type": "control_tool_result", "tool": name, "ok": False, "error": "message_text_required"}
            return
        yield {"type": "control_tool_start", "tool": name, "summary": text[:160]}
        yield {"type": "control_text", "text": text}
        yield {"type": "control_tool_result", "tool": name, "ok": True}
        return
    if name == "idle":
        yield {"type": "control_tool_start", "tool": name}
        yield {"type": "control_tool_result", "tool": name, "ok": True, "idle": True}
        yield _complete(state)
        return
    if name in {"ask_user_question", "message_ask_user"}:
        # ⚠ 2026-09-09 真机 sr-20260909041801：做个水果店收银台，
        #   模型问核心功能清单。抄 grok AskUserQuestion：问是债务，
        #   不是开工考卷。已经说了产品 → 复述卡，缺的进假设卡。
        rows = coerce_user_questions(args.get("questions"))
        if not rows:
            legacy = args.get("options") if isinstance(args.get("options"), list) else []
            rows = coerce_user_questions(
                [{"question": args.get("question") or args.get("text") or "", "options": legacy}]
            )
        # 空会话的廉价闲聊不应该被模型拆成“这是哪种意思”的选择题，
        # 但首轮产品话题通常还没来得及写进 goal（本轮 user turn 已经落入
        # controlTranscript）。只看 `_has_product_topic(state)` 会把真实产品
        # 的选项误删，用户最终只看到前端自动补的“其他（自己写）”。
        # `_ask_is_cheap_intake` 跟清单说明是同一条判据：有产品内容就保留
        # 模型选项，纯问候仍然收窄成开放问句。
        if _ask_is_cheap_intake(state):
            had = len((rows[0].get("options") or []) if rows else [])
            question = (
                str(args.get("question") or "").strip()
                or (rows[0]["question"] if rows else "")
                or CHEAP_TURN_FALLBACK
            )
            print(
                f"[control] cheap-chat stripped ask options question={question!r} had={had}",
                flush=True,
            )
            rows = [
                {
                    "id": "q1",
                    "question": question,
                    "options": [],
                }
            ]
        if not rows:
            yield {
                "type": "control_tool_result",
                "tool": name,
                "ok": False,
                "error": "这一笔没解析出任何一道题。questions 要是一串题，每道至少给 question。",
            }
            return
        async for event in _park_ask(
            state, str(rows[0].get("question") or ""), questions=rows
        ):
            if event.get("tool") == "ask_user_question":
                event = {**event, "tool": name}
            yield event
        return
    # clarify 已退役（2026-09-09 用户裁决）。它当年是"开场先问几条模板题"，
    # 而维度问题现在长在 SPEC 假设卡上——那里问才有上下文可依。工具从目录
    # 撤掉之后这段分发就没有生产者了，留着就是 §一 说的不通电的插座。
    #
    # ⚠ 撤的是**模型能不能调它**。已经停在 `awaitReason=control_clarify`
    #   的老会话仍要能交卷：`_tool_answer_from_payload` /
    #   `_messages_after_need_answer` 那条回执路径原样保留。抄 grok：
    #   把一件工具移出目录，不作废在途的 NeedUserAnswer 相关性。
    if name in FACTORY_HOPS or name == "rehearse":
        restatement = _confirmed_restatement(state, user_text)
        _write_confirmed_goal(state, restatement)
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        # 抄 grok Tool::execute：点哪件跑哪件。rehearse 是「开始」= 第一件
        # spec，其余进待办；workflow 才是一次跑完的日历。
        # 漫画第 4 格：你叫了 pages，不许把 structure/bind 焊进这一跳。
        deferred: List[str] = []
        if name == "rehearse":
            floor = list(first_pass_tools(goal.get("tools")))
            chosen = ["spec"]
            deferred = [t for t in floor if t != "spec"]
        else:
            chosen = [name]
            if name == "spec" and not _has_spec(state):
                floor = list(first_pass_tools(goal.get("tools")))
                deferred = [t for t in floor if t != "spec"]
            elif name == "pages" and "假设已确认" in (user_text or ""):
                legal = goal.get("tools")
                floor = list(first_pass_tools(legal))
                deferred = [t for t in floor if t not in ("spec", "pages")]
        hop = chosen[0]
        blocker = _factory_hop_blocker(state, hop)
        if blocker:
            async for event in _canned(
                state,
                blocker,
                stop=stop_wire(ControlStopReason.LLM_UNAVAILABLE),
            ):
                yield event
            return
        _set_goal_tools(goal, chosen, refine=_has_model(state))
        state.goal = goal
        if deferred:
            state.factoryTodo = list(
                merge_factory_todo(
                    getattr(state, "factoryTodo", None),
                    ran=chosen,
                    deferred=deferred,
                    legal=list(dict.fromkeys([*chosen, *deferred])),
                )
            )
        await _apersist(state)
        _fp_before = factory_deliverable_fingerprint(state)
        # scope_card 复述后改名为 spec：外层 tool_scope 仍是 READ 的
        # scope_card，信封闸会拒。内层盖成当前 name（spec 是 WRITE）。
        with tool_scope_scope(name):
            async with aclosing(_handoff_factory(
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                profile="app",
                nest=True,
            )) as stream:
                async for event in stream:
                    yield event
        fresh = await run_in_threadpool(load_session, str(state.sessionId or ""))
        result_tool = name if name == "rehearse" or len(chosen) > 1 else hop
        yield {
            "type": "control_tool_result",
            "tool": result_tool,
            **_factory_tool_body(
                fresh or state, result_tool, before_fingerprint=_fp_before
            ),
        }
        return
    if name == "workflow":
        wf_name = str(args.get("name") or "product-rehearsal").strip() or "product-rehearsal"
        try:
            registered = workflow_for(wf_name)
        except KeyError:
            async for event in _canned(
                state,
                f"未知工作流 {wf_name}。只能跑已登记的日历。",
                stop=stop_wire(ControlStopReason.LLM_UNAVAILABLE),
            ):
                yield event
            return
        restatement = _confirmed_restatement(state, user_text)
        _write_confirmed_goal(state, restatement)
        preset = select_workflow(
            name=registered.name,
            archetype=str((state.goal or {}).get("productArchetype") or ""),
            device=str((state.goal or {}).get("preferredDevice") or "desktop"),
            tools=args.get("tools"),
        )
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["workflow"] = preset.name
        _set_goal_tools(goal, preset.tools, refine=_has_model(state))
        state.goal = goal
        await _apersist(state)
        async with aclosing(_handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            profile="app",
            nest=True,
        )) as stream:
            async for event in stream:
                yield event
        fresh = await run_in_threadpool(load_session, str(state.sessionId or ""))
        yield {
            "type": "control_tool_result",
            "tool": "workflow",
            **_factory_tool_body(fresh or state, "workflow"),
        }
        return
    if name == "refine":
        # 空会话没东西可精修这道闸已收进统一批准闸
        # （TOOL_PERMISSION["refine"] = _has_model）。实测过的洞：补之前
        # 模型在空 goal 会话上挑 refine，信封被调 1 次、零范围卡就点了火。
        #
        # ⚠ 2026-09-02 真机（社区图书馆那趟）：精修此前不写 goal["tools"]、
        #   直接 profile="full"，于是**一跳一件在最常走的路径上等于没生效**——
        #   capabilityPlan=product-rehearsal，43 步 195 秒把全链跑完，而控制面
        #   收尾还在问「或是进入下一步的结构绑定?」，那步本轮早跑完了。
        #   现在跟单跳工具同一形状：写一件、profile="app"、跑完交回控制面再问。
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["text"] = original_goal
        raw_hop = str(args.get("hop") or "").strip()
        if raw_hop and raw_hop not in FACTORY_HOPS:
            # 不合法就重问，**不静默回落**——跟 clip_factory_tools 同一套语义：
            # 「没点名」可以给默认值，「点名了但是生词」是模型在乱点，得说出来。
            async for event in _canned(
                state,
                f"精修这一跳只能是 {' / '.join(FACTORY_HOPS)} 之一，"
                f"收到的是「{raw_hop}」。想改哪一段？",
                stop=stop_wire(ControlStopReason.LLM_UNAVAILABLE),
            ):
                yield event
            return
        # 没点名：已有 SPEC 从 pages 起（按钮点火同一缺省）。再从 spec 起
        # 会把刚确认的假设整份重起草（2026-09-07 水果店真机）。
        hop = raw_hop or ("pages" if _has_spec(state) else "spec")
        blocker = _factory_hop_blocker(state, hop)
        if blocker:
            async for event in _canned(
                state,
                blocker,
                stop=stop_wire(ControlStopReason.LLM_UNAVAILABLE),
            ):
                yield event
            return
        # refine=True 恒成立：TOOL_PERMISSION["refine"] = _has_model 已经保证有上一版。
        _set_goal_tools(goal, [hop], refine=True)
        state.goal = goal
        await _apersist(state)
        _fp_before = factory_deliverable_fingerprint(state)
        async with aclosing(_handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            profile="app",
            nest=True,
        )) as stream:
            async for event in stream:
                yield event
        fresh = await run_in_threadpool(load_session, str(state.sessionId or ""))
        yield {
            "type": "control_tool_result",
            "tool": "refine",
            **_factory_tool_body(fresh or state, "refine", before_fingerprint=_fp_before),
        }
        return
    if name == "repair":
        async with aclosing(_handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            repair=True,
            profile="full",
            max_loops=2,
            nest=True,
        )) as stream:
            async for event in stream:
                yield event
        fresh = await run_in_threadpool(load_session, str(state.sessionId or ""))
        yield {
            "type": "control_tool_result",
            "tool": "repair",
            **_factory_tool_body(fresh or state, "repair"),
        }
        fresh = await run_in_threadpool(load_session, str(state.sessionId or ""))
        yield {
            "type": "control_tool_result",
            "tool": "repair",
            **_factory_tool_body(fresh or state, "repair"),
        }
        return
    if name == "challenge":
        async for event in _tool_challenge(state, user_text):
            yield event
        return
    if name in {"search_evidence", "info_search_web"}:
        yield {"type": "control_tool_start", "tool": name}
        result = await _tool_search(state, str(args.get("query") or user_text))
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": name, **result}
        return
    if name in ("remember", "recall"):
        yield {"type": "control_tool_start", "tool": name}
        owner = _memory_scope_id(state)
        if not owner:
            # 没归属就没地方记。说清楚，别假装记下了（§7：不许伪造绿灯）。
            yield {
                "type": "control_tool_result",
                "tool": name,
                "ok": False,
                "error": "这一发没有账号归属，记忆用不了。",
            }
            return
        if name == "remember":
            saved, say = remember_memory(
                scope_id=owner, text=str(args.get("text") or "")
            )
            yield {
                "type": "control_tool_result",
                "tool": "remember",
                "ok": bool(saved),
                "say": say,
            }
            return
        query = str(args.get("query") or "").strip()
        goal_text = _task_text_for_recall(state)
        if not query:
            # ⚠ 2026-09-21 真机 PPT：空查询把账号里待办清单偏好整段倒回来。
            query = goal_text
        rows = recall_memory(scope_id=owner, query=query)
        # ⚠ 2026-09-21 YKEDKJDJ5R：state.goal 空时上一版闸不响，最近一条
        #   待办偏好照样倒出来。没有当前任务文本就交空，不许 dump 最近记忆。
        if not goal_text:
            rows = []
        else:
            rows = [
                row for row in rows
                if _recall_belongs_to_task(goal_text, str(row.get("text") or ""))
            ]
        orch_trace("recall", count=len(rows), taskChars=len(goal_text))
        yield {
            "type": "control_tool_result",
            "tool": "recall",
            "ok": True,
            "count": len(rows),
            "notes": rows,
            "summary": summarize_memory(rows),
            "taskChars": len(goal_text),
            "orchBuild": "20260922-recall",
        }
        return
    if name == "skill":
        # 开场就带技能名。正文只回给模型（tool result），不进会话。
        slug = normalize_skill_name(str(args.get("name") or args.get("skill") or ""))
        summary = project_tool_summary("skill", args)
        yield tool_start_event("skill", summary=summary or "")
        # 先看上一发成功结果，再认这一发 start——正在飞的不算已加载。
        if slug and slug in _skills_loaded_this_turn(state):
            yield {
                "type": "control_tool_result",
                "tool": "skill",
                "ok": True,
                "skill": slug,
                "alreadyLoaded": True,
                "skill_message": (
                    f"「{slug}」本回合已经加载过。不要再调 skill，"
                    "按未完成待办继续。"
                ),
            }
            return
        infos = list(_skill_infos_for_turn(state))
        # ⚠ 2026-09-22 Z8NPKNM14C：fallback 只在 error==skill_not_found 之后
        #   才打开种子。真机回执就是 skill_not_found / available=[]，
        #   种子正文没进结果。点名先并进目录，再 invoke，不靠事后补救。
        seeded = local_seed_skill_info(slug) if slug else None
        if seeded is not None and all(getattr(info, "name", None) != seeded.name for info in infos):
            infos = [seeded, *infos]
        result = invoke_skill(
            infos,
            str(args.get("name") or args.get("skill") or ""),
            str(args.get("args") or "") or None,
        )
        if (
            not result.get("ok")
            and result.get("error") == "skill_not_found"
            and seeded is not None
        ):
            result = invoke_skill(
                [seeded],
                seeded.name,
                str(args.get("args") or "") or None,
            )
        result["seedBytes"] = 0 if seeded is None else len(seeded.body or "")
        orch_trace(
            "skill",
            slug=slug,
            catalog=[getattr(info, "name", "") for info in infos],
            seedBytes=result["seedBytes"],
            ok=bool(result.get("ok")),
            error=result.get("error"),
        )
        if result.get("ok") and result.get("skill"):
            hit = next((i for i in infos if getattr(i, "name", None) == result.get("skill")), None)
            if hit is None and seeded is not None and seeded.name == result.get("skill"):
                hit = seeded
            if hit is not None:
                _remember_skill_infos(state, [hit])
                await _apersist(state)
        # 正文只回给模型（tool result）。不要另发 control_text。
        yield {"type": "control_tool_result", "tool": "skill", **result}
        return
    if name == "todo_write":
        yield {"type": "control_tool_start", "tool": "todo_write"}
        raw_updates = args.get("todos")
        # merge 缺省为真（grok `default_merge`）。显式传 false 才整张替换。
        merge = args.get("merge")
        # 显式的「清空」：只有 merge 明确写了 false 才算。缺省的合并调用送不出
        # 任何一条 = 什么都没写，不许当成"清空成功"。
        explicit_replace = merge is not None and not bool(merge)
        # ⚠ 别在这里挑形状。`coerce_updates` 认整条字符串、认 task/text、认没带
        #   id——上一版先 `isinstance(u, dict)` 滤一道，那三条韧性在真机上**一次
        #   都用不上**（本仓 §一：装在不通电的插座上，这回不通电的是入参）。
        rows, err = apply_todo(
            getattr(state, "controlTodo", None),
            raw_updates,
            merge=True if merge is None else bool(merge),
        )
        # ⚠ 2026-09-10 真机 probe-build-1789004996 第 4 轮：模型自己挑了
        #   todo_write，回给它的是 `ok: true, count: 0`，发出去的 control_todo
        #   line=''，用户那边一个字都没有。**同一形状第二次发作**——
        #   plan_todo 头注记的 2026-09-09 那次是"没带 id 被静默丢掉"，
        #   修完补的判据是「非空输入不许产出空清单」，而这次输入本身就没剩下，
        #   反向那半（"空结果不许回 ok"）当时没写（§三）。
        #   §7：工具结果是一句「我干了活」的声明，不是增强项，fail-closed。
        if err is None and not rows and not explicit_replace:
            err = "这一笔没解析出任何一条待办。todos 要是一串条目，每条至少给 content。"
        if err:
            # 重复 id 是**错误即输出**，不是抛异常——抄 grok 那句
            # 「so the Python side can distinguish this from infra errors」。
            # 分不清「模型写错了」和「我们炸了」，两种都会被当成后者。
            yield {
                "type": "control_tool_result",
                "tool": "todo_write",
                "ok": False,
                "error": err,
            }
            return
        state.controlTodo = rows
        await _apersist(state)
        # 用户看得见这半句要真的成立：前端浮层读这条事件里的 todos。
        # 只落库不发事件 = 抄了一半（工具说明第二句就成了假话）。
        yield {
            "type": "control_todo",
            "todos": rows,
            "summary": summarize_todo(rows),
            # line 给日志 / 工具回执。浮层读 todos：空数组 = 人清空了，卡收起来。
            "line": todo_one_line(rows) or "活儿清单已清空",
        }
        yield {
            "type": "control_tool_result",
            "tool": "todo_write",
            "ok": True,
            "count": len(rows),
            # 抄 grok TodoWriteSuccess：summary 带 id，todos 也带 id。
            # 只回文案、不回 id = 2026-09-19 坦克大战叠两份的根。
            "summary": summarize_todo(rows),
            "todos": rows,
        }
        return
    if name == "report_done":
        # 抄 grok update_goal：**阻塞在判决上**。判决就是这次调用的 tool result，
        # 顺着 `_control_llm_loop` 里那条 `bound_tool_result` 回喂给模型——
        # 不是「收到」，不是下一轮的提示词事实（那是 2026-09-04 修的那一版，
        # 事实是劝告，模型照样可以说完成）。
        yield {"type": "control_tool_start", "tool": "report_done"}
        completed = bool(args.get("completed"))
        message = str(args.get("message") or "").strip()
        blocked_reason = str(
            args.get("blocked_reason") or args.get("blockedReason") or ""
        ).strip()

        _pc = getattr(state, "publishClosure", None)
        # 三态，不许折成 bool：None 是「压根没判过」，False 是「判过且没拦」。
        # 折了就是把没判过当成通过——§7 点名的伪造绿灯。
        _blocked = _pc.get("blocked") if isinstance(_pc, dict) else None
        fingerprint = factory_deliverable_fingerprint(state)
        prior = _done_claim_rejections(state, fingerprint)
        verdict, detail = judge_done_claim(
            completed=completed,
            blocked_reason=blocked_reason,
            closure_blocked=_blocked,
            prior_rejections=prior,
        )

        body: Dict[str, Any] = {
            "ok": verdict is not DoneVerdict.REJECTED,
            "verdict": verdict.value,
            "say": verdict_text(verdict),
            **detail,
        }
        if verdict is DoneVerdict.NOT_ACHIEVED:
            # 驳回理由只有 closure_block_reason.user_report 一个出口。
            # 在这儿另拼一句的代价付过：上一次另拼的那句把用户指去补了一天
            # 错东西（见 _after_write_hint 里那段）。
            why = closure_user_report(_pc) if isinstance(_pc, dict) else ""
            if why:
                body["why"] = why
            if detail.get("exhausted"):
                body["say"] = (
                    f"{verdict_text(verdict)}同一份产出已经报过 "
                    f"{detail.get('attempt')} 次，都是同样的结论——"
                    "别再报了，把这个结论如实告诉用户，由用户决定接不接受。"
                )
        _append_transcript(
            state,
            {
                "role": "system",
                "kind": "done_claim",
                "verdict": verdict.value,
                "fingerprint": fingerprint,
                "text": message or blocked_reason,
            },
        )
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "report_done", **body}
        return
    if name == "inspect_model":
        yield {"type": "control_tool_start", "tool": "inspect_model"}
        result = await _tool_inspect(state)
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "inspect_model", **result}
        return
    if name == "restore_version":
        version_id = str(args.get("versionId") or args.get("version_id") or "").strip()
        if not version_id:
            version_id = _previous_model_version_id(state)
        yield {"type": "control_tool_start", "tool": "restore_version"}
        result = await _tool_restore(state, version_id)
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "restore_version", **result}
        return
    if name == "fork_variant":
        yield {"type": "control_tool_start", "tool": "fork_variant"}
        result = await _tool_fork(state, str(args.get("newName") or user_text or "变体"))
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "fork_variant", **result}
        # 客户端靠 complete.finalState 看见新 versionId；不 yield 等于点了没反应。
        yield _complete(state)
        return
    yield {"type": "control_text", "text": CANNED_FAILURE}
    yield _complete(state)
