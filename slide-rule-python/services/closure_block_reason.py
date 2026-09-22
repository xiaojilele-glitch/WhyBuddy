"""闭环为什么没收上 —— 理由是**数据**，变成人话只有一个出口。

抄的标准答案（两家形状一致）：

  grok-build `xai-grok-pager/src/app/startup_failure.rs` 模块头一句话就是纪律：

      //! Startup failures as data. [`StartupFailure::user_report`] is the only
      //! place they become the text a reader sees.

      理由存成结构（`Reason` enum + `Context`），只有 `user_report()` 把它渲染
      成人话；`Display` 另开一条只给日志一行短的，注释写着完整报告不该进那里。

  claw-code `runtime/src/lane_events.rs`：

      pub struct LaneEventBlocker {
          pub failure_class: LaneFailureClass,
          pub detail: String,
          pub subphase: Option<BlockedSubphase>,
      }
      pub enum BlockedSubphase {
          TestHang { elapsed_secs: u32, test_name: Option<String> },
          BranchFreshness { behind_main: u32 },
          TrustPrompt { gate_repo: String }, ...
      }

      每个变体**自带自己的参数**。不是"被挡了"，是"测试卡了 900 秒，卡在 test_foo"。

  grok-build `xai-tool-protocol/src/frames.rs` 的 `IdleWithholdReason` 还多一条：
  留一个 `Unknown` 变体接"新版本报了个我不认识的原因"，注释解释没有它一个不
  认识的字符串会让**整帧**反序列化失败，连带把 idle 判定一起拖下水。
  —— 对应这里：拿不到/不认识的原因，给它一个名字，**不许**默认成一句听起来
  合理的话。

⚠ 修的是什么（2026-08-27，智能工单那趟真机）：
  用户屏幕上看到的拦截理由是**编的**。实际 blocker 是
  `CLOSURE_GOAL_RELEVANCE_FAILED`（业务点覆盖 0.4 < 0.5，产出跟题对不上），
  而 `v5_closure_summary.py:100` 把 "证据缺口拦截" 写死在喂给模型的材料里，
  `topBlockers` 和 `goalRelevance.reason` 一个都不传。模型只能顺着那句话编一个
  缺口名字出来——"DLP 脱敏规则库缺口"，整套五系统模型里根本没有这个东西。
  用户照着屏幕去补证据，补一天也走不通：真正卡的根本不是证据。

  最刺眼的一点：那一轮 `perSkillEvidence` 是 **6/6 全齐**的。材料里同时写着
  "证据 6/6" 和 "证据缺口拦截"——自相矛盾。模型要在这两句之间自圆其说，
  只能编一个"名单外的缺口"出来。写死的那半句不只是不准，它主动**制造**了
  幻觉的动机。

  同一句话当时在三个地方各编各的：
      v5_closure_summary.py:100          写死"证据缺口拦截"（喂模型的材料）
      v5_closure_summary._mechanical     只说"被拦截"，一个字理由都没有
      v5_agentic_pick.py:192             写死"补齐缺的那几项"（喂控制面模型）
  这正是 startup_failure 那句话要治的病：**文本在几处各自发明**。

  更刺眼的是意图早就写下来了——`v5_capability_executor.py:1684` 的注释：

      两道新关卡的 blocker 与证据缺失并列透出：用户要能一眼看出
      「是没做完」还是「做的不是这道题」还是「这轮降级了」。

  数据侧照着做了（topBlockers / goalRelevance / runConditions 都在，
  `v5_publish_closure_response.py:60` 还专门注了"blocked 只是结论，这两块是
  过程"），**渲染侧把它整个扔了**。CLAUDE.md §3 的又一个形态：正向的东西齐全，
  到出口没人用。

本模块只做两件事：把 topBlockers 归类成数据（`classify_blockers`），以及把
数据渲染成人话（`user_report`）。**渲染只有这一处**——再想在别处拼一句拦截
理由，先回来看这段注释。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional

# 五系统的中文名不在这里再抄一份：`turn_narration._SKILL_LABELS` 已经是
# 全仓那一份（CLAUDE.md §4——同一件事两处实现，改一条等于一半不生效；
# 真机踩过的形态是同一个 skill 在两处显示成两个名字）。
from .turn_narration import _SKILL_LABELS


class ClosureBlockClass(str, Enum):
    """闭环被拦的**类别**。用户一眼要分清的就是这几种。

    照 `LaneFailureClass` 的粒度：类别是有限的、可穷举的、每个都对应一句
    用户能据以行动的话；具体细节走 `ClosureBlocker.detail`，不往类别里塞。
    """

    #: 五系统里有 skill 没交出证据——**没做完**。
    MISSING_EVIDENCE = "missing_evidence"
    #: 交出来了，但跟这道题对不上——**做的不是这件事**。
    GOAL_RELEVANCE = "goal_relevance"
    #: 这一轮有能力降级，产出不可信（CLAUDE.md §7：闭环类 fail-closed）。
    DEGRADED_RUN = "degraded_run"
    #: 结构闸拦下（骨架级悬空引用等），回喂裁决重试仍未过门。
    MODEL_GATE = "model_gate"
    #: 闭环重建这一步自己炸了。
    REBUILD_FAILED = "rebuild_failed"
    #: 生成侧失败/被关（LLM_GENERATE_*、LLM_TEST_*）。
    GENERATE_FAILED = "generate_failed"
    #: 判定侧落的**笼统总标记**，本身不带任何原因。
    #:
    #: ⚠ 2026-08-27 拿库里 20 条真 blocked 会话验的时候逮到的（CLAUDE.md §5：
    #:   夹具全绿，真数据说话）。`APPBUNDLE_RUNTIME_CLOSURE_BLOCKED` 的 path 写着
    #:   `runtimeClosure.perSkillEvidence`，看着像"证据缺口"，实际
    #:   v5_capability_executor.py:1671 是 `if blocked` 就落——**任何**原因触发的
    #:   blocked 它都跟着出现。20 条里 20 条都是证据 6/6 齐、真因是相关度。
    #:   照 path 把它当证据缺口，就会在新代码里复刻这次事故本身：告诉用户
    #:   "证据没交齐"，而证据明明写着 6/6。
    UMBRELLA = "umbrella"
    #: 页面画出来了，但用户在上面**做不了事**——交付面可用性那道闸
    #: （deliverable_surface 的五条）。跟"没做完"是两回事：东西在，用不了。
    #:
    #: ⚠ 2026-09-09 真机 done3-1788946492 逮到的：模型报完工，闭环拿
    #:   `CLOSURE_SUBMIT_INTENT_UNSERVED` 拦下，而这个模块回的是
    #:   「本版本不认识这个拦截原因」。那道闸 2026-09-06 就上线了，
    #:   人话这一侧一直没跟上——**判定侧和叙述侧只改了一半**（CLAUDE.md §4）。
    #:
    #:   改前 真机: 被拦下了，但本版本不认识这个拦截原因（CLOSURE_SUBMIT_INTENT_UNSERVED）·页面：…
    #:   改后 真机: 页面画出来了，但用户在上面做不了事·页面：2 条需要用户录入/提交的需求…
    SURFACE_UNUSABLE = "surface_unusable"
    #: 首轮账上还挂着没跑的产出跳（structure / bind 没跑完就想收工）。
    #: 跟证据缺口的区别：证据缺口是"跑了但没交"，这个是"压根还没跑"。
    TODO_OPEN = "todo_open"
    #: 本版本不认识这个 code。**绝不**构造成上面任何一种。
    #:
    #: 抄 `IdleWithholdReason::Unknown`。这里的代价和那边一样具体：把不认识
    #: 的 code 归进"证据缺口"，用户就会去补一个根本不缺的东西——那正是这次
    #: 事故本身。不认识就说不认识，并把原始 code 原样带上。
    UNKNOWN = "unknown"


#: code → 类别。**只列认识的**；缺席即 `UNKNOWN`（照 grok 的"缺省"写法：
#: 缺省是最保守的那一档，不是最常见的那一档）。
_CLASS_BY_CODE: Dict[str, ClosureBlockClass] = {
    # 笼统总标记。**只有**当真有 skill 没交证据时才升格成 MISSING_EVIDENCE，
    # 见 classify_blockers——升格条件看 perSkillEvidence，不看它自己的 path。
    "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED": ClosureBlockClass.UMBRELLA,
    "CLOSURE_GOAL_RELEVANCE_FAILED": ClosureBlockClass.GOAL_RELEVANCE,
    "CLOSURE_DEGRADED_RUN": ClosureBlockClass.DEGRADED_RUN,
    "MODEL_GATE_BLOCKED": ClosureBlockClass.MODEL_GATE,
    "CLOSURE_REBUILD_FAILED": ClosureBlockClass.REBUILD_FAILED,
    # 交付面可用性那道闸的五条（deliverable_surface.BLOCKER_CODES，2026-09-06
    # 上线）。拦的只有 UNSERVED，其余四条只报不拦——但**都会进 topBlockers**，
    # 所以人话这一侧五条都要认识。分层（拦 / 只报）是判定侧的事，
    # 这儿只管把它翻成人话，不在这里重判一次。
    "CLOSURE_SUBMIT_INTENT_UNSERVED": ClosureBlockClass.SURFACE_UNUSABLE,
    "CLOSURE_SUBMIT_INTENT_UNMAPPED": ClosureBlockClass.SURFACE_UNUSABLE,
    "CLOSURE_NO_ENTRY_SURFACE": ClosureBlockClass.SURFACE_UNUSABLE,
    "CLOSURE_ONE_PAGE_PER_ROLE": ClosureBlockClass.SURFACE_UNUSABLE,
    "CLOSURE_PAGE_WITHOUT_CONTROLS": ClosureBlockClass.SURFACE_UNUSABLE,
    "CLOSURE_FACTORY_TODO_OPEN": ClosureBlockClass.TODO_OPEN,
    "LLM_GENERATE_FAILED": ClosureBlockClass.GENERATE_FAILED,
    "LLM_GENERATE_DISABLED": ClosureBlockClass.GENERATE_FAILED,
    "LLM_TEST_FAILED": ClosureBlockClass.GENERATE_FAILED,
    "LLM_TEST_ERROR": ClosureBlockClass.GENERATE_FAILED,
}

#: 每一类的开头半句。**只说这一类是什么**，具体走 detail——照
#: `BlockedSubphase` 的分工：变体名说类别，变体字段说这一次。
_CLASS_HEAD: Dict[ClosureBlockClass, str] = {
    ClosureBlockClass.MISSING_EVIDENCE: "证据没交齐（有系统还没做完）",
    ClosureBlockClass.GOAL_RELEVANCE: "产出跟你要的题对不上",
    ClosureBlockClass.DEGRADED_RUN: "这一轮有能力降级，产出不可信",
    ClosureBlockClass.MODEL_GATE: "模型没过结构闸",
    ClosureBlockClass.REBUILD_FAILED: "闭环重建这一步失败了",
    ClosureBlockClass.GENERATE_FAILED: "五系统模型没能生成出来",
    ClosureBlockClass.SURFACE_UNUSABLE: "页面画出来了，但用户在上面做不了事",
    ClosureBlockClass.TODO_OPEN: "首轮的产出跳还没跑完",
    ClosureBlockClass.UMBRELLA: "被拦下了，但这一轮只落了笼统的 blocked 标记，没有具体原因",
    ClosureBlockClass.UNKNOWN: "被拦下了，但本版本不认识这个拦截原因",
}

#: 有些 detail 自己就带了跟类别同义的开头（相关度那句就是"产出与题目不符：…"），
#: 直接拼会变成"产出跟你要的题对不上：产出与题目不符：…"。**优先留 detail 自己
#: 的措辞**——那句是判定侧写的，它知道这一次具体是什么。
_REDUNDANT_LEADS: Dict[ClosureBlockClass, tuple] = {
    ClosureBlockClass.GOAL_RELEVANCE: ("产出与题目不符：",),
}


@dataclass(frozen=True)
class ClosureBlocker:
    """一条拦截理由。照 `LaneEventBlocker`：类别 + 细节 + 影响到谁。

    `code` 永远保留原样。不是给用户看的，是给**下一个查这件事的人**看的：
    人话那半句会随措辞变，code 不会，日志和事故复盘认的是它。
    """

    klass: ClosureBlockClass
    code: str
    detail: str = ""
    affected_skill: Optional[str] = None

    @property
    def head(self) -> str:
        return _CLASS_HEAD[self.klass]

    def one_line(self) -> str:
        """一行人话。不认识的类别把原始 code 带出来，绝不吞掉。"""
        parts = [self.head]
        if self.klass is ClosureBlockClass.UNKNOWN and self.code:
            parts.append(f"（{self.code}）")
        if self.affected_skill:
            label = _SKILL_LABELS.get(self.affected_skill, self.affected_skill)
            parts.append(f"·{label}")
        line = "".join(parts)
        detail = self.detail
        for lead in _REDUNDANT_LEADS.get(self.klass, ()):
            if detail.startswith(lead):
                detail = detail[len(lead) :]
                break
        if detail:
            line = f"{line}：{detail}"
        return line


def _missing_skills(publish_closure: Dict[str, Any]) -> List[str]:
    """哪些 skill 没交证据。

    `APPBUNDLE_RUNTIME_CLOSURE_BLOCKED` 落下来时 `ref` 是空字符串（见
    v5_capability_executor.py:1677），"缺哪几个"只存在于 perSkillEvidence。
    不来这里捞，"证据缺口"就还是一句没有下文的空话——跟事故前一样。
    """
    per_skill = publish_closure.get("perSkillEvidence")
    if not isinstance(per_skill, dict):
        return []
    missing = [
        key
        for key, value in per_skill.items()
        if isinstance(value, dict) and not value.get("evidencePresent")
    ]
    return missing


def _relevance_reason(publish_closure: Dict[str, Any]) -> str:
    """相关度判定自己写好的那句话。

    `closure_relevance` 抄 deepeval 的 `score/threshold/passed/reason` 四件套，
    reason 本来就是给人看的整句（"目标的 5 个业务点覆盖了 2 个（40% < 50%）。
    未见落实：…"）。这里只取，不改写——改写就是第二处实现。
    """
    relevance = publish_closure.get("goalRelevance")
    if isinstance(relevance, dict):
        reason = str(relevance.get("reason") or "").strip()
        if reason:
            return reason
    return ""


def classify_blockers(publish_closure: Any) -> List[ClosureBlocker]:
    """topBlockers（+ 闭环里的过程数据）→ 归好类的拦截理由。

    只读不写，任何形状都不抛：这条链挂在收口总结上，而总结**永远不挡闭环**
    （见 v5_closure_summary 模块头）。判定本身早在别处 fail-closed 过了，
    这里是渲染侧，属于增强类（CLAUDE.md §7）。
    """
    if not isinstance(publish_closure, dict):
        return []
    rows = publish_closure.get("topBlockers")
    if not isinstance(rows, list):
        return []

    out: List[ClosureBlocker] = []
    seen: set = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        klass = _CLASS_BY_CODE.get(code, ClosureBlockClass.UNKNOWN)
        detail = str(row.get("ref") or "").strip()
        skill = str(row.get("affectedSkill") or "").strip() or None

        if klass is ClosureBlockClass.GOAL_RELEVANCE and not detail:
            detail = _relevance_reason(publish_closure)
        if klass is ClosureBlockClass.UMBRELLA:
            # 升格条件看 perSkillEvidence，**不看**这条 blocker 自己的 path
            # （它的 path 写着 perSkillEvidence，但真数据里证据 6/6 齐时它照样出现）。
            missing = _missing_skills(publish_closure)
            if missing:
                klass = ClosureBlockClass.MISSING_EVIDENCE
                if not detail:
                    names = "、".join(_SKILL_LABELS.get(m, m) for m in missing)
                    detail = f"缺 {names}"

        key = (klass, code, detail, skill)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            ClosureBlocker(klass=klass, code=code, detail=detail, affected_skill=skill)
        )
    return out


#: `architecture.toml [gate_codes]` 里**不会进 topBlockers** 的码，按理由归类。
#: 判据 `test_闸码注册表里的闭环码都得认识` 拿这份名单做差集——
#: 以后新加一道闸，人话表没跟上就当场红，不会再像交付面那五条一样
#: 静静地渲染成「本版本不认识这个拦截原因」三个月。
#:
#: ⚠ 往这儿加东西 = 声明「这个码不是闭环拦截理由」。加错了的代价是
#:   把一条真拦截理由挡在人话之外——跟这次要修的是同一个病。
_NOT_A_CLOSURE_BLOCKER: Dict[str, str] = {
    # 诊断，随 blocker 透出给人看，不进 report["blockers"]
    # （v5_capability_executor:1528 落进 _diagnostic()，不是 blockers）。
    "REFINE_PAINT_FAILED": "精修画页失败的留痕，是诊断不是拦截",
    # 接口层的即时反馈，当场回给调用方，不参与任何闭环判定。
    "LLM_EMPTY_OUTPUT": "AI 改提示词返回空，接口层即时反馈",
    "PACKAGE_NOT_FOUND": "点了一个不存在的技能包，接口层即时反馈",
    # 连通性自检 / 任务生命周期鉴权，跟"产出合不合格"无关。
    "TASK_LIFECYCLE_AUTH_DENIED": "任务生命周期鉴权，跟产出合不合格无关",
}


def user_report(publish_closure: Any, *, max_rows: int = 3) -> str:
    """**唯一**把拦截理由变成人话的地方。

    抄 `StartupFailure::user_report`。别在别处拼这句——上一次拼出来的是
    "证据缺口拦截"，而真实原因是产出跟题对不上，用户被指着补了一天错东西。

    没被拦 → 空串（调用方自己说 closed，那句话跟拦截理由无关）。
    被拦但一条 blocker 都没有 → 明说"没记下原因"，**不许**编一个。
    """
    if not isinstance(publish_closure, dict) or not publish_closure.get("blocked"):
        return ""
    blockers = classify_blockers(publish_closure)
    if not blockers:
        # fail-closed 的另一面：拿不到原因就说拿不到。这一句本身就是线索——
        # 出现它说明判定侧落 blocked 时没落 topBlockers，那是判定侧的 bug。
        return "被拦下了，但这一轮没有记下拦截原因（判定侧没落 topBlockers）"
    # 有具体原因时，笼统那条不进人话——它只会在前面加一句"被拦下了"的废话。
    # 但**数据层照旧返回它**（classify_blockers 不撒谎），过滤是渲染侧的事。
    specific = [b for b in blockers if b.klass is not ClosureBlockClass.UMBRELLA]
    if specific:
        blockers = specific
    lines = [b.one_line() for b in blockers[:max_rows]]
    rest = len(blockers) - len(lines)
    if rest > 0:
        lines.append(f"另有 {rest} 条")
    return "；".join(lines)
