# -*- coding: utf-8 -*-
"""本轮运行的降级标记——降级过的一轮不许发合格证。

## 为什么需要这个

系统里到处是 fail-open 兜底：LLM 网关挂了就回落规则版选材、生成失败就退
RAG、取不到模型就用内置夹具。**兜底本身是对的**，外部一抖不该整条链卡死。
错的是兜底完还把结果按正常产出交付：2026-08-04 那轮 `agentic-pick` 连吃两
次 HTTP 400 回落规则版，整轮跳过建模链路，最后照样判 `closed 6/6`。

用户看到绿色的 closed 就以为东西做好了。**这比直接报错要坏**——报错知道
重跑，盖了章就信了。

## 做法来源

结构照 Kubernetes 的 `metav1.Condition`
（kubernetes/apimachinery/pkg/apis/meta/v1/types.go）：

    type / status / reason / message / lastTransitionTime

沿用它两条关键约定：
1. **reason 是机器可读的 CamelCase**，message 才是给人看的。判定逻辑只认
   reason，UI 只显示 message，两者不混用。
2. **status 有三态 True/False/Unknown**，Unknown 表示「状态无法确定」。
   这正是降级轮闭环的真实语义——不是「确定没做成」（False），而是
   「做没做成这件事本身已经不可信」。所以降级时闭环判定取 Unknown 侧：
   不发 closed，如实标出降级原因。

K8s 里 conditions 是**可累加的列表**而非单个 bool，我们照搬：一轮里可能
先后触发多种降级（选材回落 + 生成回退），每种各记一条，排查时能看到全貌。
现有的 `brainstormDegraded: bool` 那种单布尔做不到这点。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

DEGRADED_CONDITION_TYPE = "Degraded"

# ── 影响面：这次降级伤没伤到交付物 ──
#
# 教训来自 argo-workflows#12530「Separate Continuation after Task Failure and
# Success Determination」——那个 issue 至今没解决，讲的正是这里的坑：
# **「失败了能不能继续跑」和「整体最终算不算数」是两件事，混在一起就出错**。
# Argo 用户踩的是「设了 continueOn 之后，关键步骤失败工作流也判成功」；
# 我们上一版踩的是它的镜像——降级本来只是「兜底继续跑」的信号，却被直接
# 拿去当最终判定，于是 2026-08-04 真跑里出现：六项证据齐全、相关性 0.857
# 判定对题、建模生图设计全都成功，只因为推演阶段两处退了 RAG，整轮判不合格，
# 用户白等 33 分钟。
#
# 所以影响面必须显式标注，不能由「有没有降级」隐含推出。命名与分状态的做法
# 参考 Airflow 的 trigger_rule（failed / upstream_failed / skipped 各自独立，
# 判定规则写明白而不是靠默认值猜）。
IMPACT_DELIVERABLE = "deliverable"
"""伤到交付物本身（应用没造出来/造坏了）——闭环必须拒发合格证。"""

IMPACT_REASONING = "reasoning"
"""只影响推演过程（某个分析环节退了兜底）——如实记录并打标，但放行。"""

# 交付关键路径上的能力。只有这些出问题才算伤到成品；其余（intent/structure/
# evidence/risk/route/critique/synthesis/report/task…）都是"想事情"的环节，
# 退兜底会让结论粗糙，但不影响应用本身能不能用。
# 收口内部的生图/取色/设计若失败，会经由证据缺失与结构门体现，不走这条。
DELIVERABLE_CAPABILITIES = frozenset({"appbundle.runtimeclosure"})


def impact_for_capability(capability_id: str) -> str:
    """某个能力降级了，算伤到交付物还是只是过程磕碰。"""
    return (
        IMPACT_DELIVERABLE
        if str(capability_id or "").strip().lower() in DELIVERABLE_CAPABILITIES
        else IMPACT_REASONING
    )


# reason 取值（CamelCase，机器可读——判定与统计都认这个，不认 message）
REASON_AGENTIC_PICK_FALLBACK = "AgenticPickFallback"
"""LLM 选材失败/被门剔除，回落规则版选能力。

影响面恒为 reasoning：它只决定「这轮挑哪几件活儿干」，规则版挑出来的活儿
照样会被认真执行，做出来的东西不因此变差。"""

REASON_CAPABILITY_LLM_FALLBACK = "CapabilityLlmFallback"
"""能力的原生 LLM 执行失败，回退 RAG。影响面取决于是哪个能力。"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def mark_degraded(
    state: Any, *, reason: str, message: str, impact: str = IMPACT_REASONING
) -> None:
    """记一条降级 Condition。同 reason 只保留首次（K8s 语义：
    lastTransitionTime 记的是**状态翻转**的时刻，重复上报不算翻转）。

    `impact` 必须由调用方显式给出语义（见模块头 argo#12530 的教训）。默认
    取 reasoning 而非 deliverable：绝大多数降级发生在推演环节，把默认设成
    「阻断」会重演上一版那个「白等半小时」的问题；真正伤到交付物的路径是
    可枚举的少数，让它显式声明。

    永不抛异常：这是留痕通道，留痕失败不该把主流程带崩——但它记不下来
    就意味着闭环判定看不见降级，所以宁可静默也要保证调用方不受影响。
    """
    try:
        existing = list(getattr(state, "runConditions", None) or [])
        for item in existing:
            if isinstance(item, dict) and item.get("reason") == reason:
                # 同一 reason 再次上报，若这次伤到交付物则升级影响面——
                # 「先在推演里退过一次、后来收口也退了」不能被首次记录盖住
                if impact == IMPACT_DELIVERABLE and item.get("impact") != IMPACT_DELIVERABLE:
                    item["impact"] = IMPACT_DELIVERABLE
                    item["message"] = str(message)[:500]
                return
        existing.append(
            {
                "type": DEGRADED_CONDITION_TYPE,
                "status": "True",
                "reason": str(reason),
                "message": str(message)[:500],
                "impact": impact if impact in (IMPACT_DELIVERABLE, IMPACT_REASONING) else IMPACT_REASONING,
                "lastTransitionTime": _now(),
            }
        )
        setattr(state, "runConditions", existing)
    except Exception:
        pass


def collect_degradations(state: Any) -> List[Dict[str, Any]]:
    """取出本轮所有生效的降级条目（status=True 的 Degraded）。"""
    out: List[Dict[str, Any]] = []
    for item in list(getattr(state, "runConditions", None) or []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == DEGRADED_CONDITION_TYPE and item.get("status") == "True":
            out.append(item)
    return out


def blocking_degradations(degradations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """只挑出**伤到交付物**的那些——闭环判定认这个，不认降级总数。

    这就是 argo#12530 说的那条分界：能继续跑（所有降级都已 fail-open 兜底）
    是一回事，最终算不算数是另一回事。
    """
    return [d for d in degradations if d.get("impact") == IMPACT_DELIVERABLE]


def degradation_blockers(degradations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """降级条目 → 闭环 blocker。只有伤到交付物的才成为 blocker；过程磕碰
    照旧记录在 runConditions 里并在摘要中标出，但不拦交付。"""
    return [
        {
            "code": "CLOSURE_DEGRADED_RUN",
            "path": "runtimeClosure.runConditions",
            "affectedSkill": "",
            "ref": f"{d.get('reason')}: {str(d.get('message') or '')[:160]}",
        }
        for d in blocking_degradations(degradations)
    ]


def degradation_summary(degradations: List[Dict[str, Any]]) -> str:
    """给人看的一句话。措辞区分「拦下了」和「放行但有磕碰」——用户看到
    绿灯时也该知道这一轮不是一帆风顺，好自己判断要不要重跑。"""
    if not degradations:
        return ""
    blocking = blocking_degradations(degradations)
    head = degradations[:3]
    reasons = "、".join(str(d.get("message") or d.get("reason") or "") for d in head)
    if blocking:
        return (
            f"本轮有 {len(degradations)} 处降级，其中 {len(blocking)} 处伤及交付物，"
            f"不足以判定闭环：{reasons}"
        )
    return f"本轮有 {len(degradations)} 处降级，均只影响推演过程、未伤及交付物：{reasons}"
