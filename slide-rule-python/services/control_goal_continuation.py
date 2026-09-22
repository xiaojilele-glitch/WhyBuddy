"""目标没做完就自己接着跑——**但要有人管住它**。

## 修的是什么（2026-09-13）

`control_run_service._produce` 里这五行决定了一个回合的下场：

    if any(event.get("type") == "complete" for event in record["events"]):
        status = "waiting_user" if 问过用户 else "completed"

两个都在 TERMINAL 里，没人叫得醒。于是模型说一句「好的，我这就去实现截止
日期功能」然后没调工具，目标八字没一撇，run 却被判成「完成了」——用户只能
自己打「继续」。§27 列的第一条体验差距就是这个。

叫醒机制本身已经有了（`_requeue_settled_goals`：等的 operation 一结束就把
run CAS 翻回 queued，由原 producer 从 checkpoint 接着跑，不新建 Agent）。
缺的是**第三个叫醒理由**：模型不说话了，但事没干完。

## 四条护栏，一条都不能省

**一、只有工程目标能自动续跑。**
    对话目标没有可验证的「做完了」——判它没完就等于无限续跑，判它做完了
    就是编。没有证据的地方不猜（§7：闭环类 fail-closed）。

**二、没进展就不再叫醒。** 这是最重要的一条。
    一次续跑如果一个工具都没调（纯说话），再叫一次只会得到同样的一句话。
    没有这条，模型说「我这就去做」就能把额度烧干而什么都没有。

**三、目标级预算。**
    跟单轮预算是两码事：单轮墙钟每次续跑都会重置（`run_control_turn` 每次
    都新起一轮），所以拦不住无限续跑。这里数的是**这个目标一共自动续了
    几次**。

**四、问过用户的、失败的、被取消的，一律不续。**
    等人回答就是真的要等人；失败要让人看见，不许自己重试掩盖过去。

⚠ 判据 `test_control_goal_continuation.py` 对每条护栏都有反向判据，
  变异（去掉任一条）都要变红。
"""

from __future__ import annotations

import time

from typing import Any, Dict, List, Optional

#: 一个目标最多自动续跑几次。超了就停下来问人，不是继续烧。
#:
#: ⚠ 2026-09-17 起工程档取消轮次/墙钟，对话档 09-18 对齐 control-v3。
#:   这一层却还按 8 次续跑先停——闸装在通电路上、条件在真机长跑上成立。
#:   用户看见「时间 / 轮次放开了，怎么还停」。跟 project-v3 同一口径：
#:   一万 = 按要求不设限。没进展那条护栏仍在，空转续跑不会烧穿。
MAX_CONTINUATIONS = 10_000

#: 这些终态不许自动续：等人回答是真的要等人；失败/取消要让人看见。
_NEVER_CONTINUE = frozenset({"waiting_user", "failed", "cancelled", "interrupted"})

#: 单轮时间片。新一轮会重置墙钟（见 continuation_checkpoint），总量由
#: MAX_CONTINUATIONS 管。2026-09-14 真机 wall_clock 181.5/180 之后目标被
#: 写成 completed、continuations=0——把时间片当成了整个目标做完。
SLICE_STOP_REASONS = frozenset({"wall_clock"})

#: 点火前 / 防打转的硬闸。续跑会给一份全新单轮预算，把这些当时间片
#: 就等于绕过闸。2026-09-13 真机：8001 token 撞 8000 cheap 额度后若续跑，
#: 点火前额度形同虚设。
HARD_CAP_STOP_REASONS = frozenset({"token_budget", "tool_rounds", "stationarity"})


def tool_result_count(events: Any) -> int:
    """这一 run 至今真的跑完过几次工具。

    进展指纹用它而不用「事件总数」：事件每轮都会涨（光说话也涨），
    只有工具结果代表**真的动了什么**。
    """
    if not isinstance(events, list):
        return 0
    return sum(
        1
        for event in events
        if isinstance(event, dict) and event.get("type") == "control_tool_result"
    )


def progress_mark(events: Any) -> str:
    """把「到目前为止的进展」压成一个可比较的指纹。"""
    return f"tools:{tool_result_count(events)}"


def turn_stop_reason(events: Any) -> str:
    if not isinstance(events, list):
        return ""
    for event in events:
        if isinstance(event, dict):
            reason = str(event.get("stopReason") or "").strip()
            if reason:
                return reason
    return ""


def turn_was_sliced(events: Any) -> bool:
    """这一轮是单轮时间片到了，不是整个目标做完了。"""
    return turn_stop_reason(events) in SLICE_STOP_REASONS


def turn_was_capped(events: Any) -> bool:
    """这一轮是**硬闸掐断**的，不许再领一份单轮预算。

    ⚠ 2026-09-13 真机 `control-continuation-smoke` 之后、跑控制面回归时抓到：
      `test_legacy_8001_tokens_still_prevent_project_creation[client-forged-policy]`
      当场变红。那一轮是 8001 token 撞上 8000 的点火前额度被掐断的，而我的
      续跑会**给它一个全新的单轮预算再跑一遍**——等于把预算闸整个绕过去。

      「硬闸」和「时间片」是两回事。wall_clock 是时间片：新一轮重置墙钟，
      总量由 MAX_CONTINUATIONS 管。token_budget / tool_rounds / stationarity
      仍是硬闸。llm_unavailable 走失败终态，不从这里续。
    """
    reason = turn_stop_reason(events)
    if not reason:
        return False
    return reason in HARD_CAP_STOP_REASONS or reason not in SLICE_STOP_REASONS


def unfinished_slice_waits_for_user(*, status: str, events: Any, goal_done: bool) -> bool:
    """时间片到了、目标没交付、又不能自动续时：停下来问人，不许写 completed。

    2026-09-14 真机：phase=budget_exhausted / stopReason=wall_clock，
    但 run 和 goal 都落成 completed，continuations=0。
    """
    if goal_done or status == "failed":
        return False
    return status == "completed" and turn_was_sliced(events)


def unfinished_cap_waits_for_user(*, status: str, events: Any, goal_done: bool) -> bool:
    """硬闸掐断、目标没交付：停成等待用户，不许写成完工。

    ⚠ 2026-09-15 TicketStream：token_budget 是硬闸，**不许自动续**（见
      turn_was_capped）。但 run/goal 仍落 completed，待办停在 4/10，
      用户读成葬礼。暂停、可以说继续，和「自己再领一份预算」是两件事。
    """
    if goal_done or status == "failed":
        return False
    return status == "completed" and turn_was_capped(events)


def continuation_budget_left(goal: Any) -> int:
    spent = 0
    if isinstance(goal, dict):
        raw = goal.get("continuations")
        if isinstance(raw, int) and raw > 0:
            spent = raw
    return max(MAX_CONTINUATIONS - spent, 0)


def should_continue(
    *,
    status: str,
    goal: Any,
    events: Any,
    goal_done: bool,
) -> tuple[bool, Optional[str]]:
    """这一回合结束之后，要不要自己接着跑。

    返回 ``(要不要续, 不续的原因)``。原因是给人看的诊断，不是给模型的提示词；
    续跑时为 ``None``。

    ⚠ 调用方必须已经确认过 rollout 开着、租约还在。这里只做纯判断，
      不碰存储、不发事件。
    """
    if status in _NEVER_CONTINUE:
        return False, f"terminal_{status}"
    if status != "completed":
        return False, f"not_settled_{status}"
    goal_dict: Dict[str, Any] = goal if isinstance(goal, dict) else {}
    if goal_dict.get("kind") != "project":
        # 对话目标没有可验证的「做完了」。不猜。
        return False, "not_a_project_goal"
    if goal_done:
        return False, "goal_done"
    if turn_was_capped(events):
        # 闸掐断的不许自己再要一份预算。见 turn_was_capped 头注。
        return False, "capped"
    if continuation_budget_left(goal_dict) <= 0:
        return False, "budget_exhausted"
    mark = progress_mark(events)
    if goal_dict.get("progressMark") == mark:
        # 上一次续跑之后一个工具都没跑成——再叫一次只会拿到同一句话。
        return False, "no_progress"
    return True, None


def continuation_checkpoint(checkpoint: Any, notice: str) -> Optional[Dict[str, Any]]:
    """把「已经收尾的那一轮」的 checkpoint 改造成「新一轮的起点」。

    ## 为什么必须转换（2026-09-13 真机 control-continuation-smoke 第一趟）

    第一趟真机直接红在这里：`error: control_reconciliation_required`。

    `_produce` 的 resume 守卫只认 `phase in {"model","tools"}`——那是「回合**中途**
    被打断」的形态。而自动续跑面对的是另一种：**上一回合已经正常收尾了**
    （text-only 结束，`rehearsal_control` 留下 `phase="settling"`），我们要开的是
    **新一轮**，不是接着上一轮的半截。守卫于是当场把它判成需要人工对账。

    转换做三件事：
      · phase → "model"：新一轮从「准备采样」开始
      · 把续跑说明追进 messages：模型得知道自己为什么又醒了
      · **重置这一轮的预算计量**（见下）

    ## 预算：这一轮重置，总量由续跑次数管

    resume 会把 `startedAt` / `cheapTokens` 一起还原——那是「同一轮被打断后
    接着算」的语义。续跑不是同一轮：不重置的话，首轮烧掉 100 秒，续跑一睁眼
    就只剩 80 秒，基本立刻撞墙钟，续跑等于白做。

    所以这里给新一轮**干净的单轮预算**，总量改由 `MAX_CONTINUATIONS` 兜底：
    「没进展就收手」通常在第 1~2 次就把它掐掉，不是靠次数天花板。

    ⚠ `stationarity`（原地打转游标）**故意保留**：它防的正是模型反复调同一个
      工具，跨轮次继承才有意义，重置了等于每次续跑都给它一次重新打转的机会。
      `stagnantCalls`（同一次调用带回同一份结果的账）、`readonlyStreak`
      （连着几轮只读不写）同理——三道闸都靠
      `{**checkpoint, ...}` 原样带过来，**别往下面的重置清单里加它们**。
      判据：`test_真机1_已收尾回合的checkpoint要能转成新一轮的起点`。
    """
    if not isinstance(checkpoint, dict):
        return None
    messages = checkpoint.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    text = str(notice or "").strip()
    out = {
        **checkpoint,
        "phase": "model",
        "messages": [*messages, {"role": "system", "content": text}] if text else list(messages),
        # 新一轮：轮数、墙钟、token 从头算。
        "round": 0,
        "startedAt": time.time(),
        "cheapTokens": 0,
        "retrySpent": 0,
        "retryStartedAt": time.time(),
        "pendingCalls": [],
        "content": "",
    }
    # 花费闸存档不许焊进新一轮——否则 PPT 续跑一直是 control-v2/8000。
    out.pop("budgetPolicy", None)
    return out


def continuation_notice(blocked_reasons: Any, attempt: int) -> str:
    """续跑时追加给模型的那句话。

    ⚠ 内容**从服务端算出来的 blockedReasons 生成**，不是「请继续」这种空话，
      也不是重放用户原来那条 POST——模块头注写着：过期的派发意图是不确定性
      的证据，不是重放的许可。拿不到具体原因时只说状态，不编。
    """
    reasons: List[str] = []
    if isinstance(blocked_reasons, list):
        for item in blocked_reasons:
            text = str(item or "").strip()
            if text and text not in reasons:
                reasons.append(text[:120])
            if len(reasons) >= 6:
                break
    head = f"[自动续跑 第 {attempt} 次] 这个目标还没达到可交付状态。"
    if not reasons:
        return head + "服务端没有给出具体缺项；先用 project_status 查清当前状态再决定下一步。"
    return head + "服务端判定仍缺：" + "；".join(reasons) + "。请据此继续，不要重复已经完成的步骤。"


def repair_dangling_tool_calls(messages: Any) -> List[Dict[str, Any]]:
    """给没有结果的 tool_calls 补一条合成 tool result。

    抄 grok-build `repair_dangling_tool_calls`：API 要求每个 tool_call 都有
    配对结果，中断后下一轮采样之前必须补齐，否则网关 400。
    只补缺的，已有结果的不许再编一条。
    """
    if not isinstance(messages, list):
        return []
    out = [item if isinstance(item, dict) else item for item in messages]
    repairs: List[tuple[int, List[Dict[str, Any]]]] = []
    index = 0
    while index < len(out):
        head = out[index]
        if not isinstance(head, dict) or head.get("role") != "assistant":
            index += 1
            continue
        calls = head.get("tool_calls")
        if not isinstance(calls, list) or not calls:
            index += 1
            continue
        answered: set[str] = set()
        cursor = index + 1
        while cursor < len(out):
            follow = out[cursor]
            if isinstance(follow, dict) and follow.get("role") == "tool":
                call_id = str(follow.get("tool_call_id") or "")
                if call_id:
                    answered.add(call_id)
                cursor += 1
                continue
            break
        synthetic = []
        for call in calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            if not call_id or call_id in answered:
                continue
            fn = call.get("function") if isinstance(call.get("function"), dict) else {}
            name = str(fn.get("name") or call.get("name") or "unknown")
            synthetic.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": (
                    f"Tool execution was halted by the harness (sampling_interrupted); "
                    f"the tool `{name}` was not executed."
                ),
            })
        if synthetic:
            repairs.append((cursor, synthetic))
        index = cursor
    for insert_at, synthetic in reversed(repairs):
        out[insert_at:insert_at] = synthetic
    return out


def sampling_interrupted_notice() -> str:
    """采样死了之后新开一轮的合成提示。

    抄 grok `PriorTurnInterrupt::MidTurnAbort`：不重放那次 HTTP 推理，
    下一句是新采样。2026-09-19 真机停在 phase=sampling，resume 守卫只认
    model/tools，直接 `control_reconciliation_required`。
    """
    return (
        "[采样中断] 上一轮模型还没返回结果，控制面心跳读档失败。"
        "那次推理没有产出，不要假设它做完了。"
        "未完成的工具调用已按中断补齐。"
        "请从当前工程状态继续，不要重放未确认的副作用。"
    )


def sampling_interrupted_checkpoint(checkpoint: Any) -> Optional[Dict[str, Any]]:
    """把「正在采样」的 checkpoint 转成新一轮起点。

    过期的派发意图不许重放（模块头那句）。采样是一次未完成的 HTTP POST，
    不是已经发出去的工具。补齐 dangling tool result，再走
    `continuation_checkpoint` 开新一轮。
    dispatching 不许走这里——工具可能已经有副作用。
    """
    if not isinstance(checkpoint, dict) or checkpoint.get("phase") != "sampling":
        return None
    messages = checkpoint.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    repaired = repair_dangling_tool_calls(messages)
    return continuation_checkpoint(
        {**checkpoint, "messages": repaired, "phase": "settling"},
        sampling_interrupted_notice(),
    )


def operation_settled_notice(operations: Any) -> str:
    """后台命令进终态之后叫醒模型的那句话。

    抄 grok-build `format_bash_completion`：
        Background task "{id}" completed (exit code: {code}).

    ⚠ 2026-09-18 真机：text-only 收尾留下 settling，wait_for_operations 把
      排队的 build 等完再叫醒，resume 守卫只认 model/tools，直接
      `control_reconciliation_required`，页面黄条「控制面未返回结果」。
      grok 是**新开一轮合成提示**，不是把已经说完的 checkpoint 当中途打断。
      这句话是那一轮的合成提示；checkpoint 形状由 continuation_checkpoint 转。
    """
    rows: List[str] = []
    if isinstance(operations, list):
        for item in operations:
            oid = str(getattr(item, "operationId", "") or "").strip()
            kind = str(getattr(item, "kind", "") or "").strip()
            status = str(getattr(item, "status", "") or "").strip()
            saved = getattr(item, "result", None)
            extra = ""
            if isinstance(saved, dict) and "exitCode" in saved:
                extra = f"，exit code: {saved['exitCode']}"
            piece = " ".join(part for part in (oid, kind, status) if part) + extra
            if piece and piece not in rows:
                rows.append(piece[:160])
            if len(rows) >= 6:
                break
    head = "[后台命令已结束]"
    if not rows:
        return head + " 没有可读的操作结果。先用 project_status 查清当前状态。"
    return head + " " + "；".join(rows) + "。刚才排队时的 ok 只表示接单，不是跑完。"
