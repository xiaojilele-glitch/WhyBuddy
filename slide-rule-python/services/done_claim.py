# -*- coding: utf-8 -*-
"""报完工的判决词表。模型自称做完了**不算数**，判官说了算。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/update_goal/mod.rs`

    //! `update_goal` — model-driven goal progress reporting.
    //!
    //! Each invocation is paired with an `oneshot::Sender<UpdateGoalAck>`
    //! over the channel to `SessionActor`; the tool blocks on that ack so
    //! the model's tool reply reflects the real outcome (classifier
    //! verdict / transition / rejection), **not a misleading instant success**.

最后那半句是这件工具存在的全部理由。

──────────────────────────────────────────────────────────────────────────
## 这条治的是本仓数得最多的那个病

CLAUDE.md §3：「闸全绿但东西没了」——正向判据齐全，反向判据缺失。
真机形态一次比一次贵：

    2026-09-04 社区养老 sr-20260904181150
      closure 判出 CLOSURE_GOAL_RELEVANCE_FAILED（24 个业务点只覆盖 5 个）
      模型如实照着手上的材料叙述成「闭环判定已完成。当前已具备 4 份页面…」
      用户看到「完成」，实际是被拦下的

    2026-09-05 sr-20260904214530
      3 页画完、预算耗尽，factoryTodo 还挂着 ['structure','bind']
      收尾那句：「页面已经出来。要改哪一页…」——完工的口气配半成品

两次都修过，修法都是**把裁决作为事实回流到下一轮的提示词里**
（`_after_write_hint` 里那两段）。但事实是**劝告**：模型仍然可以照说不误。

grok 的解法在结构上更硬：**把「我做完了」变成一个有后果的动作**。
声称完成要走判官，而不是绕过判官。声称被驳回，模型当场就知道。

──────────────────────────────────────────────────────────────────────────
## 真机验过（2026-09-09，真 LLM + 真 HTTP + 真建一遍应用）

会话 done3-1788946492：说需求 → 开始推演 → pages(138s) → structure(93s)
→ bind(38s) → 问「都做完了吗」。两条路都走到了：

    ⑦ 模型**主动挑了** report_done，但 completed=false（只报进度）
       判决: accepted  「记下了。这一条不算完工声明。」
       它接着如实告诉用户：闭环判定未通过，页面缺录入控件、权限孤岛

    ⑧ 再逼它 completed=true
       判决: not_achieved  「闭环判定没过，这次完工声明不成立。」
       第几次/上限: 1 / 3
       理由原样带回（页面：2 条需要录入的需求，承载页上没有任何落笔的地方）

⚠ 顺带炸出一个**存量** bug，记在这儿备查（不是这次改动引入的）：
  上面那条理由的前半句是「被拦下了，但本版本不认识这个拦截原因
  （CLOSURE_SUBMIT_INTENT_UNSERVED）」。产线实际会发 13 个拦截码，
  而 `closure_block_reason._CLASS_BY_CODE` 只认识 9 个，漏的正是最常出现的
  交付面那一族（SUBMIT_INTENT_UNSERVED / UNMAPPED / PAGE_WITHOUT_CONTROLS /
  NO_ENTRY_SURFACE / ONE_PAGE_PER_ROLE / FACTORY_TODO_OPEN）和五系统引用
  那一族（PUBLISH_*）。这条影响的是**所有**读那个出口的地方（本工具、
  `_after_write_hint`、前端），不只这一件。

──────────────────────────────────────────────────────────────────────────
## 故意没抄的那一档：fail-open

grok 有一档 `ClassifierFailOpenAchieved`——判官自己挂了就当达成，
理由是别把用户困在死循环里。**我们不抄，而且是有意的。**

它的判官是一个 LLM 分类器（外部调用、会超时）；我们的判官
`derive_publish_closure_response` 是**确定性推导**，没有外部调用，
它"挂了"只意味着我们自己的代码炸了。CLAUDE.md §7 把这类划得很清楚：

    增强类（生图、取色、缓存）自己炸了不许拖垮主链路 → fail-open
    证据 / 闭环类：缺证据就是缺，**不许伪造绿灯** → fail-closed

照抄 fail-open 会让「判官炸了」变成「恭喜完工」——正好是这件工具要治的病。
所以没有判决 = `NO_VERDICT`，不算达成。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Tuple

#: 同一份产出上最多允许报几次完工。第 N 次被驳回之后不再让它重报——
#: 再报一次也是同样的结论（`_after_write_hint` 里那句「同样的产出再调一次
#: closure 会得到同样的结论」说的是同一件事），该做的是如实告诉用户。
#:
#: 3 抄的是 grok `blocked_reason` 的门槛「only when truly stuck after
#: **3+ consecutive** failed attempts at the same problem」。
DONE_CLAIM_MAX_RUNS = 3


class DoneVerdict(str, Enum):
    """报完工这一次的判决。可穷举，每一个都对应一句能据以行动的话。

    对着 grok `UpdateGoalAck` 排的，少一档 `ClassifierFailOpenAchieved`
    （见模块头注：那一档跟本仓 §7 的 fail-closed 冲突，有意不抄）。
    """

    #: 只报了进度 / 卡住，没声称完成。记下就完。
    ACCEPTED = "accepted"
    #: 声称完成，判官认可。
    ACHIEVED = "achieved"
    #: 声称完成，判官驳回。带 attempt / maxRuns / 驳回理由。
    NOT_ACHIEVED = "not_achieved"
    #: 还没有可判的产物（闭环压根没跑过）。**fail-closed：不算达成。**
    NO_VERDICT = "no_verdict"
    #: 参数用错了。比如同时声称完成又说自己卡住了——那是两个相反的信号。
    REJECTED = "rejected"


#: 判决 → 给模型的那句话。**唯一渲染处**（同 `_STOP_TABLE` 那条纪律）。
#: 想在别处再拼一句「没过」，先回来看这张表。
_SAY: Dict[DoneVerdict, str] = {
    DoneVerdict.ACCEPTED: "记下了。这一条不算完工声明。",
    DoneVerdict.ACHIEVED: "闭环判定通过，这份应用可以交付。",
    DoneVerdict.NOT_ACHIEVED: "闭环判定没过，这次完工声明不成立。",
    DoneVerdict.NO_VERDICT: (
        "还没有可判的闭环结论——没跑过 closure 就没有判决，"
        "没有判决不算完工。"
    ),
    DoneVerdict.REJECTED: "参数用错了，这次声明没被采纳。",
}


def verdict_text(verdict: DoneVerdict) -> str:
    """**唯一**把判决变成人话的地方。"""
    return _SAY[verdict]


#: `blocked_reason` 那个参数的说明书。**逐条抄 grok 的措辞**：
#:
#:     "Set only when truly stuck after 3+ consecutive failed attempts at the
#:      same problem. If set, the goal is paused as blocked. This is a FAILURE
#:      signal — never put success text here. For success, use `completed: true`
#:      with `message`."
#:
#: ⚠ 「这是失败信号，永远不许往这儿填成功的话」这半句必须留着。少了它，
#:   模型会把「我做完了」塞进 blocked_reason 当小结——两个相反的信号挤进
#:   同一个字段，台账上就再也分不出「卡住了」和「干完了」。
BLOCKED_REASON_SCHEMA = (
    "卡在哪。只有在同一个问题上连着栽了 3 次以上、确实推进不下去时才填。"
    "填了就记为受阻。**这是失败信号——永远不许往这儿填成功的话。**"
    "要报成功用 completed=true 配 message。"
)

COMPLETED_SCHEMA = (
    "只有确实全部做完了才设 true。设了会走闭环判定，判定没过这次声明不成立。"
)

MESSAGE_SCHEMA = "一句话小结。配 completed=true 就是完工说明。"


def judge(
    *,
    completed: bool,
    blocked_reason: str,
    closure_blocked: Any,
    prior_rejections: int,
) -> Tuple[DoneVerdict, Dict[str, Any]]:
    """给这一次声明定性。**纯函数**：只吃四个已经算好的值。

    `closure_blocked`：判官的结论。True=拦下了，False=过了，None=还没判过。
    刻意收成三态而不是传整个 state——这样这个模块谁都不依赖，是叶子；
    也让「没判过 ≠ 判过且没拦」这条区别在类型上就跑不掉
    （把 None 折成 False 就是伪造绿灯，正是 §7 那条）。

    `prior_rejections`：**同一份产出上**已经被驳回过几次。调用方按交付物
    指纹数（产出一变，这个数自然归零——那才是「同一个问题」的意思）。
    """
    if completed and blocked_reason.strip():
        return DoneVerdict.REJECTED, {
            "why": "completed=true 和 blocked_reason 不能同时给：一个说做完了，"
            "一个说卡住了，这是两个相反的信号。"
        }
    if not completed:
        return DoneVerdict.ACCEPTED, {
            "blocked": bool(blocked_reason.strip()),
        }
    if closure_blocked is None:
        return DoneVerdict.NO_VERDICT, {}
    if closure_blocked:
        attempt = prior_rejections + 1
        return DoneVerdict.NOT_ACHIEVED, {
            "attempt": attempt,
            "maxRuns": DONE_CLAIM_MAX_RUNS,
            "exhausted": attempt >= DONE_CLAIM_MAX_RUNS,
        }
    return DoneVerdict.ACHIEVED, {}
