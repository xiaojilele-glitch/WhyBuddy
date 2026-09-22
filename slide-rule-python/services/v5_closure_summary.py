"""v5_closure_summary — 推演收口后的真 LLM 对话总结（方案 B）。

结合推演全程上下文（意图、五系统模型、轮内风险/反方/综合等真实产出）生成
面向用户的收口总结；流式增量经 on_delta 推给前端（llm_delta label
"closure.summary"）。任何失败返回 None——调用方回落零 LLM 模板（方案 A），
总结永远不挡闭环主流程。
"""

from typing import Any, Callable, Dict, List, Optional

# 轮内真实产出里最值得进总结的能力（按叙事顺序）
_CONTEXT_CAPS = [
    "intent.clarify",
    "evidence.search",
    "risk.analyze",
    "counter.argue",
    "critique.generate",
    "synthesis.merge",
    "report.write",
]

_CAP_CN = {
    "intent.clarify": "意图澄清",
    "evidence.search": "证据检索",
    "risk.analyze": "风险分析",
    "counter.argue": "反方观点",
    "critique.generate": "自我挑刺",
    "synthesis.merge": "综合结论",
    "report.write": "可行性报告",
}


def _artifact_get(art: Any, key: str) -> Any:
    return art.get(key) if isinstance(art, dict) else getattr(art, key, None)


def _latest_artifacts_by_cap(state: Any) -> Dict[str, Any]:
    """每个能力取最新一份产物（真 LLM 或 RAG 回落都如实收录）。"""
    latest: Dict[str, Any] = {}
    for art in getattr(state, "artifacts", None) or []:
        produced = _artifact_get(art, "producedBy")
        cap = (
            produced.get("capabilityId")
            if isinstance(produced, dict)
            else getattr(produced, "capabilityId", None)
        )
        if cap in _CONTEXT_CAPS:
            latest[cap] = art  # artifacts 追加有序，后者更新
    return latest


def _model_stats_lines(publish_closure: Dict[str, Any]) -> List[str]:
    """从闭环证据的 modelSection 提炼五系统事实行（无 LLM 模型段时为空）。"""
    per_skill = publish_closure.get("perSkillEvidence") or {}
    lines: List[str] = []

    def section(skill: str) -> Optional[Dict[str, Any]]:
        entry = per_skill.get(skill) or {}
        ms = entry.get("modelSection") if isinstance(entry, dict) else None
        return ms if isinstance(ms, dict) else None

    dm = section("datamodel")
    if dm and isinstance(dm.get("entities"), list):
        names = [str(e.get("name") or e.get("id") or "?") for e in dm["entities"] if isinstance(e, dict)]
        fields = sum(len(e.get("fields") or []) for e in dm["entities"] if isinstance(e, dict))
        lines.append(f"数据模型：{len(names)} 实体（{'、'.join(names[:8])}）· {fields} 字段")
    wf = section("workflow")
    if wf and isinstance(wf.get("nodes"), list):
        lines.append(
            f"工作流：{len(wf['nodes'])} 节点 · {len(wf.get('transitions') or [])} 转移"
        )
    rb = section("rbac")
    if rb and isinstance(rb.get("roles"), list):
        # 显示名而不是引用键：这行是给人看的。角色补中文名之后直接 str(r)
        # 会把整个 dict 打进摘要（"{'id': 'warehouse_keeper', 'name': ...}"）。
        from .rbac_roles import role_entries

        _names = [r["label"] for r in role_entries(rb)]
        lines.append(
            f"角色权限：{len(_names)} 角色（{'、'.join(_names[:6])}）· {len(rb.get('permissions') or [])} 权限"
        )
    pg = section("page")
    if pg and isinstance(pg.get("pages"), list):
        names = [str(p.get("name") or p.get("id") or "?") for p in pg["pages"] if isinstance(p, dict)]
        lines.append(f"页面：{len(names)} 页（{'、'.join(names[:8])}）")
    ai = section("aigc")
    if ai and isinstance(ai.get("capabilities"), list):
        names = [str(c.get("name") or c.get("id") or "?") for c in ai["capabilities"] if isinstance(c, dict)]
        lines.append(f"AI 能力：{len(names)} 项（{'、'.join(names[:6])}）")
    return lines


def build_summary_messages(state: Any, publish_closure: Dict[str, Any]) -> List[Dict[str, str]]:
    goal = state.goal.get("text", "") if isinstance(getattr(state, "goal", None), dict) else str(getattr(state, "goal", ""))
    blocked = bool(publish_closure.get("blocked"))
    per_skill = publish_closure.get("perSkillEvidence") or {}
    present = sum(1 for v in per_skill.values() if isinstance(v, dict) and v.get("evidencePresent"))

    parts: List[str] = [f"业务意图：{goal or '(未提供)'}"]
    # ⚠ 这一行以前写死 "blocked（证据缺口拦截）"。2026-08-27 智能工单那趟真机：
    #   实际 blocker 是 CLOSURE_GOAL_RELEVANCE_FAILED（产出跟题对不上），模型
    #   只能顺着"证据缺口"四个字编出一个"DLP 脱敏规则库缺口"——模型里根本没有
    #   那东西。用户照着屏幕补证据，补一天也走不通。
    #   理由从 closure_block_reason.user_report 来，那是唯一渲染它的地方。
    from .closure_block_reason import user_report as _block_report

    status = "blocked" if blocked else "closed"
    parts.append(f"闭环状态：{status} · 证据 {present}/{len(per_skill) or 6}")
    reason = _block_report(publish_closure)
    if reason:
        # 单开一行而不是塞进上一行：下面 system 里要求"如实说 closed/blocked",
        # 拦截原因是**另一件事**，混成一句模型会把两者揉成一个说法。
        parts.append(f"拦截原因（原样转述，不要改写、不要补充）：{reason}")
    stats = _model_stats_lines(publish_closure)
    if stats:
        parts.append("五系统模型事实：\n" + "\n".join(f"- {s}" for s in stats))

    arts = _latest_artifacts_by_cap(state)
    for cap in _CONTEXT_CAPS:
        art = arts.get(cap)
        if art is None:
            continue
        content = str(_artifact_get(art, "content") or _artifact_get(art, "summary") or "").strip()
        if not content:
            continue
        parts.append(f"【{_CAP_CN[cap]}】\n{content[:1100]}")

    system = (
        "你是 SlideRule 的推演总结助手。基于给定的推演全程材料，写一段面向用户的"
        "中文收口总结（350 字以内，markdown，短段落+短列表）。必须覆盖四点："
        # ⚠ 判据盯语义不盯这句字面（CLAUDE.md §2）：光在材料里给了原因不够，
        #   上一版模型就是在"证据缺口"四个字的暗示下自己编了个缺口名字。
        #   这里明写「照抄、不许换成别的原因」，把编造的口子堵在指令侧。
        "1) 闭环结论（如实说 closed/blocked 与证据数；blocked 时**照抄**材料里"
        "给出的拦截原因，不许换成别的原因、不许自己命名一个缺口）；"
        "2) 现在这个应用能干什么（结合五系统模型的实体/流程/角色/页面/AI 能力，说人话）；"
        "3) 推演中发现的关键风险与分歧（提炼自风险分析/反方观点/综合结论，最多 3 条）；"
        "4) 建议的下一步（1-2 条，具体可做）。"
        "只使用给定材料中的事实，禁止编造；材料里没有的方面直接略过。"
        "不要复述这段指令，不要输出标题「总结」之类的套话开头。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(parts) + "\n\n现在输出总结。"},
    ]


# 模型把指令清单写进正文时的记号。对照 Instructor / LangChain 的
# output parser：看起来像 prompt 回声的 completion 直接拒收。
#
# ⚠ 2026-08-19 安康随访通：chatSummary 落成「存审计日志 / 字数与格式检查」。
#   不是 1200 字中段被截，是模型把 system 里的检查项复述出来了。
#   「不要复述这段指令」写在 prompt 里挡不住——必须在出口拦。
_ECHO_MARKERS = (
    "字数与格式检查",
    "不要复述这段指令",
    "现在输出总结",
    "字数：大约",
    "符合「",
)


def summary_looks_like_instruction_echo(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    first = raw.splitlines()[0].strip()
    if first.startswith("存审计日志"):
        return True
    return any(mark in raw for mark in _ECHO_MARKERS)


def _mechanical_summary(publish_closure: Dict[str, Any]) -> Optional[str]:
    """方案 A 同款事实行：闭环状态 + 五系统统计。零 LLM。"""
    lines = _model_stats_lines(publish_closure)
    if not lines:
        return None
    blocked = bool(publish_closure.get("blocked"))
    per_skill = publish_closure.get("perSkillEvidence") or {}
    present = sum(
        1 for v in per_skill.values() if isinstance(v, dict) and v.get("evidencePresent")
    )
    from .closure_block_reason import user_report as _block_report

    head = (
        f"闭环{'被拦截' if blocked else '已闭合'} · "
        f"证据 {present}/{len(per_skill) or 6}。"
    )
    # 零 LLM 这条路以前一个字理由都没有——"被拦截"然后没有下文。回声兜底走的
    # 就是这里，用户看到的就是这句，所以它也得带上原因（CLAUDE.md §4：
    # 成对的东西只改一条，另一条静默地还是老样子）。
    reason = _block_report(publish_closure)
    if reason:
        head = f"{head}原因：{reason}。"
    return head + "\n" + "\n".join(lines)


def generate_closure_chat_summary(
    state: Any,
    publish_closure: Dict[str, Any],
    on_delta: Optional[Callable[[str], None]] = None,
) -> Optional[str]:
    """真 LLM 收口总结。失败（无通道/LlmError/空文）一律返回 None，绝不抛出。"""
    try:
        from sliderule_llm.client import call_llm_with_retry

        messages = build_summary_messages(state, publish_closure)
        kwargs: Dict[str, Any] = {"max_tokens": 900, "temperature": 0.3}
        buffered: List[str] = []
        if on_delta is not None:
            kwargs["on_delta"] = buffered.append
        result = call_llm_with_retry(messages, **kwargs)
        text = (result.content or "").strip()
        if not text:
            return None
        if summary_looks_like_instruction_echo(text):
            # 回声不许落库、也不许流到左栏。机械行跟客户端模板同一批事实。
            print("[v5_closure_summary] model echoed the checklist, using mechanical facts")
            mech = _mechanical_summary(publish_closure)
            if mech and on_delta is not None:
                on_delta(mech)
            return mech
        if on_delta is not None:
            for chunk in buffered:
                on_delta(chunk)
        return text
    except Exception as exc:  # noqa: BLE001 — 总结永远不挡闭环
        print(f"[v5_closure_summary] summary failed, fallback to template: {str(exc)[:160]}")
        return None
