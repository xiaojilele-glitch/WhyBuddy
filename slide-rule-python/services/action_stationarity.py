# -*- coding: utf-8 -*-
"""原地打转检测：同一件工具、同一份实参，连着调了几轮。

抄的标准答案：grok-build
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs`
的 `IdenticalToolCallRun` / `step_signature` / `canonicalize_json`
（连同它头顶那几行事故记录）：

    /// A production turn repeated one `ToolKind::Plan` call (`todo_write`) with
    /// byte-identical arguments 12 times (224 in the turn).
    /// Replaying it showed the model answers the user as soon as it is interrupted.

grok 的主循环每一轮**开头第一件事**就是问这个，问完才去采样——
先判断状态，再花钱问模型。我们原来只数总轮数（MAX_TOOL_ROUNDS=8），
「跑了 8 轮」和「同一件事干了 8 遍」在停因表上是同一句话。

这个模块是叶子（services 里谁都不依赖）：它**不自己查工具权限**，
`problematic` 由调用方算好传进来——跟 grok 一样，
`step_is_problematically_repeating` 在 turn.rs 里，struct 只收一个 bool。
所以它谁都不 import，谁都能安全 import 它。

──────────────────────────────────────────────────────────────────────────
⚠ 阈值是**重新标定过的，不是照抄 grok 的 4/8/8/12**。

grok 的 `max_turns` 默认是 `None`（不限轮），4/8/8/12 是在一个基本无界的
循环里的绝对值。我们的控制面 `MAX_TOOL_ROUNDS = 8` —— 照抄过来，
「连续 12 次相同调用」在真机上**永远不成立**，「连续 8 次」也要烧掉整个预算
才可能碰到一次。那正是 CLAUDE.md §一之二 点名的形态：护栏装在真跑的路上，
条件却永远为假，单测还绿（判据自己构造那个输入）。

所以判据里钉了一条 `test_硬停阈值必须小于总轮数预算`：
阈值一旦被改回 grok 的原值，或者有人把 MAX_TOOL_ROUNDS 调小，立刻红。
──────────────────────────────────────────────────────────────────────────

真机验过（2026-09-09，真 uvicorn + 真 HTTP + 真 SSE）：LLM_BASE_URL 指向一台
复读机网关（每一发都回同一次 `search_evidence`，实参一字不差），
会话先 PUT 成「范围已确认 + 已有模型」——**这一步是必须的**，第一次试忘了，
`search_evidence` 不在本轮清单里被裁掉、calls 为空、第一轮就 return，
什么都没触发：

    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] stationarity_nudge tool='search_evidence' run_len=2 problematic=1 round=2
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] stationarity_stop  tool='search_evidence' run_len=4 problematic=1 round=4

    STOP: {"stopReason":"stationarity","stoppedBy":"runtime","limit":4,"used":4,
           "text":"我在同一步上打转了，先停下没点火。…"}

反向也在真机上量过：同一天 12 条真话题（16 轮控制面）跑完，
日志里 `stationarity_` 出现 **0** 次——正常流量不许误伤。

没抄的那一档：grok 还有 `MAX_CONSECUTIVE_TRUE_NOOPS`（`command_is_true`——
模型反复跑 `run(cmd="true")` 当保活）。我们的闭集里没有任何一件工具能当
空转保活用，硬造一个判据只会得到又一条真机上永不成立的分支。
以后真出现了再加，别现在替它占位。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

#: READ 档（同一份实参必然回同一份结果）：捅一下 / 硬停。
NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS = 2
MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS = 4

#: 其余（WRITE、以及查不到权限的新工具）：宽一档。
#: 抄 grok 那条理由——「重复也可能是正当的」，所以不用紧档去卡它。
NUDGE_AFTER_IDENTICAL_CALLS = 3
MAX_CONSECUTIVE_IDENTICAL_CALLS = 5

# grok 用 `const _: () = assert!(...)` 在编译期钉住这两条。Python 没有编译期，
# import 期就是最早的时刻——捅一下的阈值必须严格小于硬停，否则「先提醒后掐断」
# 塌成「只掐断」，而那正是这次改造要治的病。
assert (
    NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS < MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
)
assert NUDGE_AFTER_IDENTICAL_CALLS < MAX_CONSECUTIVE_IDENTICAL_CALLS

#: 捅一下时贴给模型的那句话。抄 grok `ACTION_STATIONARITY_NUDGE_TEMPLATE`
#: 的三段结构：说清**观察到了什么**、给一条**出路**、预告**再来就掐**。
#: 只说「别重复了」而不给出路，模型往往换个参数再重复一遍。
NUDGE_TEMPLATE = (
    "你已经连着 {run_len} 轮调用同一件工具（`{tool_name}`），实参一字不差——"
    "这一路在原地打转。别再重复这次调用了。"
    "已经拿到的信息够就直接往下走（该画就画、该问就问）；"
    "还缺东西就换一件工具或者换一份实参；"
    "实在推进不下去，就停下来用一句话告诉用户你卡在哪。"
    "再这么重复下去，这一轮会被自动掐断。"
)


def _canonical(value: Any) -> Any:
    """递归排序对象的键，让同一份实参不因序列化顺序不同而算成两次调用。

    抄 grok `canonicalize_json`：`{"a":1,"b":2}` 与 `{"b":2,"a":1}` 是同一次调用。
    **数组顺序不动**——数组顺序是语义的（一份清单、一批改动），重排是真的改动。
    """
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value, key=str)}
    if isinstance(value, (list, tuple)):
        return [_canonical(v) for v in value]
    return value


def step_signature(calls: Sequence[Dict[str, Any]]) -> str:
    """一轮采样的签名：这一轮发出的每一次调用，各自规范化后再排序。

    抄 grok `step_signature`：并行调用换个顺序再发一遍**不算进展**。
    实参序列化不了就退回 repr（对应 grok「不是合法 JSON 就用 trim 过的原文」）。
    """
    parts: List[str] = []
    for call in calls:
        name = str((call or {}).get("name") or "")
        args = (call or {}).get("arguments")
        try:
            rendered = json.dumps(
                _canonical(args if isinstance(args, dict) else {}),
                sort_keys=True,
                ensure_ascii=False,
            )
        except (TypeError, ValueError):
            rendered = repr(args)
        parts.append(f"{name}\x1f{rendered}")
    parts.sort()
    return "\x1e".join(parts)


def step_tool_name(calls: Sequence[Dict[str, Any]]) -> str:
    """这一轮报给日志/用户的代表名。抄 grok：取名字里最小的那个，稳定可复现。"""
    names = sorted(str((c or {}).get("name") or "") for c in calls)
    return names[0] if names else ""


class IdenticalToolCallRun:
    """连续相同调用的游标。**一个回合一个**，不许做成模块级单例
    （那会让上一位用户的打转记录漏到下一位身上）。"""

    __slots__ = ("last_signature", "tool_name", "problematic_step", "run_len", "nudged")

    def __init__(self) -> None:
        self.last_signature: Optional[str] = None
        self.tool_name: str = ""
        self.problematic_step: bool = False
        self.run_len: int = 0
        self.nudged: bool = False

    def observe(
        self, signature: str, tool_name: str, problematic_step: bool
    ) -> int:
        """记一轮。签名跟上一轮一样就 +1，不一样就重新起一段（并清掉捅过的标记）。"""
        if self.last_signature == signature:
            self.run_len += 1
        else:
            self.run_len = 1
            self.last_signature = signature
            self.nudged = False
        self.tool_name = tool_name
        self.problematic_step = problematic_step
        return self.run_len

    def is_problematic(self) -> bool:
        return self.problematic_step

    def nudge_threshold(self) -> int:
        return (
            NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS
            if self.is_problematic()
            else NUDGE_AFTER_IDENTICAL_CALLS
        )

    def hard_stop_threshold(self) -> int:
        return (
            MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
            if self.is_problematic()
            else MAX_CONSECUTIVE_IDENTICAL_CALLS
        )

    def should_hard_stop(self) -> bool:
        return self.run_len >= self.hard_stop_threshold()

    def take_nudge(self) -> bool:
        """一段打转里**只捅一次**。抄 grok `take_nudge`：只在结果已经落进
        对话之后调（我们是在下一轮循环开头调），不然提醒会贴在还没发生的事上。"""
        fire = (not self.nudged) and self.run_len >= self.nudge_threshold()
        self.nudged = self.nudged or fire
        return fire

    def nudge_text(self) -> str:
        return NUDGE_TEMPLATE.format(
            run_len=self.run_len, tool_name=self.tool_name or "（未具名）"
        )

    def telemetry(self) -> Tuple[str, int, bool]:
        """(工具名, 连了几轮, 是不是紧档)。日志和停止信封共用这一份，不各拼各的。"""
        return (self.tool_name, self.run_len, self.is_problematic())


# ═══════════════════════════════════════════════════════════════════════════
# 第二道：**同一次调用、同一份结果**，这一回合里出现了几次
# ═══════════════════════════════════════════════════════════════════════════
#
# ## 为什么上面那道不够（2026-09-14 真机复盘）
#
# `IdenticalToolCallRun` 数的是「**整一轮**的签名跟上一轮一字不差」——
# `step_signature` 把这一轮所有并行调用拼成一个串，只要**有一件**不同，
# `observe` 就 `run_len = 1` 清零重来。
#
# grok 那边这个形状够用，因为它的回合多半是单件调用。我们的控制面一轮发
# 4~6 件并行调用，于是出现一个洞：**五件原地打转、一件在变，计数器永远回到 1。**
#
#     轮3  read×6   database / server / main.tsx / application.test / style.css / README.md
#     轮4  read×5 + project_status      前五个一模一样，尾巴换了一件
#     轮5  read×4   又是前四个
#
# 三轮读的是同一批文件，肉眼就是在打转，而 run_len 一路停在 1。
#
# ⚠ 但**那一趟真机并不是打转**：落库的 offset 老老实实 0→2000→4000，模型在
#   翻页，翻不完是因为读窗只有 2000 字（已随 `PROJECT_READ_MAX_CHARS` 修好）。
#   这道闸是顺手补上的那个洞，**不是那次事故的成因**。别把两件事记混了。
#
# ## 判据不能只看实参（否则会误伤真机上的正当重复）
#
# 最直觉的写法是「同一个 name+args 出现 N 次就掐」。真机上它会当场误伤：
#
#     project_status(operationId=X)   实参一字不差，结果从 queued → running → completed
#
# 那是**正当轮询**，grok 的 nudge 文案里专门给它留了出路。所以判据必须再加一
# 个条件：**结果也没变**。抄 grok `TaskOutputResult::progress_signature`：
#
#     /// Two results with the same signature are considered stagnant — the task
#     /// state has not changed between polls.  Used by the doom-loop detector to
#     /// distinguish legitimate waiting (progress) from a true polling stall.
#
# 同一次调用 + 同一份结果 = 这一次调用带回来的信息量是零，无论实参长什么样。
# 而翻页读（offset 在变）、轮询（status 在变）两种正当重复都会被这条放过。

#: 结果指纹要**扔掉**的键：每发都不一样的传输/排序元数据。
#:
#: ⚠ 这是这道闸最容易写成哑弹的地方（CLAUDE.md §一之二）。控制面回给模型的
#:   `tool_body` 是 `{k: v for k, v in event.items() if k != "type"}`——整个事件，
#:   `toolCallId` 和 `seq` 都在里面，而这两个**每一发都不同**。整包哈希的话
#:   指纹永远不重复，闸装上了也永远不响，单测还会绿（判据自己拼一个干净的
#:   载荷就行）。
#:
#: 下面这份名单是从真机那一发的**原样载荷**抄下来的
#: （`artifacts/control-real-model/1fcfd3d4`，`wb_control_run.events`）：
#:
#:     {"content": "…", "controlRunId": "ctr-ca9f08…", "nextOffset": 2000,
#:      "offset": 0, "ok": true, "path": "database.mjs", "revision": "prv-3c10…",
#:      "seq": 23, "sha256": "a7579ea8…", "tool": "project_read",
#:      "toolCallId": "call-eab3c0bb-…-6", "totalChars": 7458,
#:      "truncated": true, "type": "control_tool_result"}
#:
#: `tests/test_control_stops_when_it_repeats_itself.py::test_真机载荷_易变字段不算进展`
#: 直接喂这一份原文，不许自己拼。
_VOLATILE_RESULT_KEYS = frozenset({"seq", "toolCallId", "controlRunId", "type"})

#: 捅一下 / 掐断。**一次调用带回同一份结果**，第二次起就是零信息量。
#:
#: ⚠ 不是照抄 grok 的 4/8：那组数是给「连续轮数」那个轴的，而且 grok 的
#:   `max_turns` 默认不限轮。这个轴数的是「这一回合里出现过几次」，
#:   控制面一回合最多 `MAX_TOOL_ROUNDS`(8) ~ `PROJECT_BUDGET.max_rounds` 轮。
#:   ⚠ 2026-09-17 起工程档是 project-v3，max_rounds 一万（等于不设限），
#:     所以**停下来这件事从此全靠这里的停滞检测**，不再有轮次兜底。
#:   取 3/5：留一次「报错后重试一遍」的余地（真机上确实有这种正当重复），
#:   第三次还是同一份结果就提醒，第五次掐断。判据
#:   `test_重复阈值必须够得着` 钉住它小于总轮数预算。
#: ⚠ 2026-09-16 换模型真机首次实弹命中（在此之前只有单测覆盖过）：
#:     [control] stationarity_nudge tool='project_status' run_len=2 problematic=1 round=13
#:   形态跟设计时设想的一致：模型反复 `project_status` 拿**同一份**结果。
#:   注意 `problematic=1` —— 是 `result_fingerprint` 认出「结果没变」才算数的，
#:   不是光看工具名重复（光看名字会把正当的轮询也一起拦掉）。
NUDGE_AFTER_STAGNANT_REPEATS = 3
MAX_STAGNANT_REPEATS = 5

assert NUDGE_AFTER_STAGNANT_REPEATS < MAX_STAGNANT_REPEATS

#: 抄 grok `ACTION_STATIONARITY_NUDGE_TEMPLATE` 的三段结构：观察到什么、
#: 给一条出路、预告再来就掐。这里的出路跟上面那条不同——重点是
#: 「你已经有这份结果了」，而不是「换个实参」。
STAGNANT_NUDGE_TEMPLATE = (
    "你在这一回合里已经第 {repeats} 次调用 `{tool_name}` 并拿回**一模一样**的结果了——"
    "这次调用没有带来任何新信息。这份结果已经在上面的对话里，别再要一遍。"
    "拿它往下走（该改就改、该跑就跑）；真的还缺东西就换一件工具或者换一份实参；"
    "推进不下去就停下来用一句话告诉用户你卡在哪。再重复下去，这一轮会被自动掐断。"
)


def call_signature(call: Any) -> str:
    """**单次**调用的签名（上面那个 `step_signature` 是整轮的）。

    规范化沿用 `_canonical`，两个轴对「什么算同一次调用」的口径必须一致，
    否则同一批调用在两道闸里会得出两个结论（CLAUDE.md §4）。
    """
    call = call if isinstance(call, dict) else {}
    name = str(call.get("name") or "")
    args = call.get("arguments")
    try:
        rendered = json.dumps(
            _canonical(args if isinstance(args, dict) else {}),
            sort_keys=True,
            ensure_ascii=False,
        )
    except (TypeError, ValueError):
        rendered = repr(args)
    return f"{name}\x1f{rendered}"


def result_fingerprint(body: Any) -> str:
    """一份工具结果的「有没有变」指纹。

    抄 grok `progress_signature`：只取**语义上有意义**的字段，易变的传输元数据
    （`seq` / `toolCallId` / `controlRunId`）一律扔掉——见 `_VOLATILE_RESULT_KEYS`
    头注里那份真机载荷。
    """
    if not isinstance(body, dict):
        return f"raw\x1f{body!r}"
    kept = {k: v for k, v in body.items() if k not in _VOLATILE_RESULT_KEYS}
    try:
        return json.dumps(_canonical(kept), sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(sorted(kept))


class StagnantCallLedger:
    """「同一次调用 → 同一份结果」在这一回合里出现了几次。

    **一个回合一个**，跟 `IdenticalToolCallRun` 同一条纪律：上一位用户的
    记录不许漏到下一位身上。
    """

    __slots__ = ("seen", "tool_name", "repeats", "nudged")

    def __init__(self) -> None:
        # signature -> [result_fingerprint, 出现次数]
        self.seen: Dict[str, List[Any]] = {}
        self.tool_name: str = ""
        self.repeats: int = 0
        self.nudged: bool = False

    def observe(self, signature: str, fingerprint: str) -> int:
        """记一次调用及其结果，返回这次调用**带回同一份结果**的累计次数。

        结果变了就从 1 重新起算——那是进展：轮询的状态推进了、翻页读到了新
        内容。两种正当重复都靠这一条放过去。
        """
        previous = self.seen.get(signature)
        if previous is not None and previous[0] == fingerprint:
            previous[1] += 1
        else:
            self.seen[signature] = [fingerprint, 1]
        # 游标跟着**当前最严重的那一条**走，不是跟着刚记的这一条。
        # 这正是整轮签名那道闸漏掉的东西：一件在打转、同一轮里另一件在变，
        # 不许让后者把前者的计数顶掉。
        worst_signature, worst = max(self.seen.items(), key=lambda item: item[1][1])
        if worst[1] < self.repeats:
            # 最严重的那条自己往前走了 → 有进展，「捅过了」清掉，
            # 下一段停滞要能重新被捅。
            self.nudged = False
        self.repeats = worst[1]
        self.tool_name = worst_signature.split("\x1f", 1)[0]
        return self.seen[signature][1]

    def should_hard_stop(self) -> bool:
        return self.repeats >= MAX_STAGNANT_REPEATS

    def hard_stop_threshold(self) -> int:
        return MAX_STAGNANT_REPEATS

    def take_nudge(self) -> bool:
        """一段停滞只捅一次。调用位置跟上面那条一样：在下一轮循环开头，
        结果已经落进对话之后。"""
        fire = (not self.nudged) and self.repeats >= NUDGE_AFTER_STAGNANT_REPEATS
        self.nudged = self.nudged or fire
        return fire

    def nudge_text(self) -> str:
        return STAGNANT_NUDGE_TEMPLATE.format(
            repeats=self.repeats, tool_name=self.tool_name or "（未具名）"
        )

    def telemetry(self) -> Tuple[str, int]:
        return (self.tool_name, self.repeats)


# ═══════════════════════════════════════════════════════════════════════════
# 第三道：**一直在读，一次没写**
# ═══════════════════════════════════════════════════════════════════════════
#
# ## 病（2026-09-14 真机 `shots/build2`）
#
# 工程链路终于跑通之后，模型在工程工作台里干了这些：
#
#     工程动作 17/17
#     创建工程 → list → 查看运行状态 → 读取源码 ×5 → 查看运行状态
#     → list → 读取源码 ×4 → search → 读取源码
#
# **17 个动作，`project_patch` 零次。** 它自己写的计划里明明有
# 「project_exec 跑 check/build/test 并修复」，连催 6 次「现在用 project_patch
# 写实现」都不动手，整轮停在 17/17。
#
# 前两道闸都拦不住它，而且**它们不该拦**：
#   · 整轮签名（第一道）——每轮读的文件不一样，签名当然不同
#   · 同调用同结果（第二道）——同一个文件最多读了 3 次，阈值是 5
# 两道数的都是「原地打转」。这一种不是打转，是**一直在往前走但永远不落地**：
# 每一次读都带回新信息，只是从不转化成改动。
#
# ## 判据：整轮全是 READ，连着几轮
#
# 复用 `_step_is_problematically_repeating` 那个「这一轮**每一件**都是 READ」
# 的判断（调用方算好传进来，本模块仍然不查权限表）——不另写一份 scope 判断
# （CLAUDE.md §4）。一旦某一轮出现 WRITE，连胜清零。
#
# ⚠ **只捅不掐。** 读源码是正当动作，把它掐断会让「需要多读几轮才敢下手」的
#   正常行为变成事故。这一道跟前两道的区别就在这儿：前两道有硬停，这一道没有。

#: 连着几轮只读不写就提醒一次，以及第二次提醒的位置。
#:
#: ⚠ **这根轴换过一次，换轴的过程比数字本身重要。**
#:
#:   第一版做成「回合级游标」，阈值 4。2026-09-14 真机跑下来
#:   `readonly_nudge` **一次都没响**，而病态完整复现：
#:
#:       picked: project_read × 14   project_patch × 0   project_exec × 0
#:
#:   拿产线的 `step_is_read_only` 重算整份后端日志，按回合拆开：
#:
#:       回合 A  create(写→清零) → status/list(1) → read×5(2) → read+search(3)  收尾
#:       回合 B  status/list(1) → read×4(2) → read×3(3)                        收尾
#:       每回合出现过的最长只读连胜 = 3，阈值 = 4，每次都差那一轮
#:
#:   而降到 3 正好撞上正当流程（`test_failed_command_returns_to_same_model_loop_...`
#:   的 status → logs → read，排查一条失败命令本来就要读三轮）。
#:
#:   **3 太急、4 够不着，说明这根轴选错了**——在「单回合」这根轴上，病态和
#:   正当用法根本分不开。病态是「**这个目标**一路读下来从没落地过」，
#:   是跨回合属性。同 `MAX_CONTINUATIONS` 的理由（那边头注写着「单轮预算
#:   每次续跑都会重置，所以拦不住无限续跑」），一模一样的形状。
#:
#:   所以游标改成跟着 session state 跨回合累积（`controlReadOnly`），
#:   任何一次写工具清零。换轴之后 4 就够得着了：真机那两个回合合计 6 轮只读。
#:
#: ⚠ 不是从 grok 抄的——grok 没有这一档（它的 Read 紧档管的是**重复**读同一份，
#:   不是「读了很多但不写」）。
#:
#: 第二档 7：跨回合之后不再受单回合 `MAX_TOOL_ROUNDS`(8) 限制，但留着这个数
#: 是为了「捅两次还不动就别再刷屏」。
#:
#: ⚠ 2026-09-16 换模型（gpt-5.6-luna）真机复核：**两档都响了，而且没误伤**。
#:     [control] readonly_nudge rounds=4 round=15
#:     [control] readonly_nudge rounds=7 round=2
#:   前一趟同一条链还抓到过一次「响完真的改行为」的完整形态：
#:     readonly_nudge rounds=4 → project_cancel → project_patch（写）→ project_exec
#:   换了一个跟标定时完全不同的模型（推理型，reasoning_tokens 占九成），
#:   4 / 7 这两个数依旧够得着、也没在正当的 status→logs→read 诊断流上误触。
#:   **这两个数是标定过的，照 §6 别拍脑袋改**——要动就连同这段真机记录一起重跑。
NUDGE_AFTER_READONLY_ROUNDS = 4
NUDGE_AGAIN_AFTER_READONLY_ROUNDS = 7

assert NUDGE_AFTER_READONLY_ROUNDS < NUDGE_AGAIN_AFTER_READONLY_ROUNDS

#: 提醒文案。抄 grok nudge 模板的三段结构：观察到什么、给一条出路、说清代价。
#: ⚠ 出路必须是**具体那一件工具**——只说「该动手了」，模型会再读一轮当作动手。
READONLY_NUDGE_TEMPLATE = (
    "你已经连着 {rounds} 轮只在读，一次写入都没有。"
    "读到的东西只有落进源码才算数。"
    "现在就挑**一个**最小的改动用 `file_write` 或 `file_str_replace` 写进去（哪怕只改一个文件），"
    "写完用 `shell_exec` 跑一次构建看结果；"
    "真的还缺关键信息，就说清楚缺哪一处、为什么读不到，别继续翻。"
)


class ReadOnlyStreak:
    """连着几轮整轮都是 READ。

    ⚠ **跟前两道不一样：这个跨回合。** 前两道数的是「原地打转」，那是回合内
      的性质，一个回合一份游标（grok 那条「上一个回合的记录不许漏到下一位
      用户身上」）。这一道数的是「这个目标一路读下来从没落地过」——真机证过
      它在回合这根轴上跟正当用法分不开（见上面阈值的头注）。
      所以它从 session state 的 `controlReadOnly` 读出来、写回去。
    """

    __slots__ = ("rounds", "nudged_at")

    def __init__(self) -> None:
        self.rounds: int = 0
        #: 已经在第几轮提醒过。一段连胜里同一个档只提醒一次。
        self.nudged_at: int = 0

    # ── 跨回合存取（形状钉在 models/v5_state.py 的 controlReadOnly 上）──

    @classmethod
    def from_state(cls, saved: Any) -> "ReadOnlyStreak":
        """从 session state 还原。坏数据一律当成「没读过」，不许抛。"""
        streak = cls()
        if isinstance(saved, dict):
            rounds = saved.get("rounds")
            nudged = saved.get("nudgedAt")
            streak.rounds = rounds if isinstance(rounds, int) and rounds > 0 else 0
            streak.nudged_at = nudged if isinstance(nudged, int) and nudged > 0 else 0
        return streak

    def to_state(self) -> Dict[str, int]:
        return {"rounds": self.rounds, "nudgedAt": self.nudged_at}

    def observe(self, read_only_step: bool) -> int:
        """记一轮。整轮全 READ 就 +1；出现任何非 READ 就清零（真的落地了）。"""
        if read_only_step:
            self.rounds += 1
        else:
            self.rounds = 0
            self.nudged_at = 0
        return self.rounds

    def take_nudge(self) -> bool:
        """到档就捅一次。两个档各一次，不会每轮都刷屏。"""
        for threshold in (NUDGE_AFTER_READONLY_ROUNDS, NUDGE_AGAIN_AFTER_READONLY_ROUNDS):
            if self.rounds >= threshold > self.nudged_at:
                self.nudged_at = threshold
                return True
        return False

    def nudge_text(self) -> str:
        return READONLY_NUDGE_TEMPLATE.format(rounds=self.rounds)
