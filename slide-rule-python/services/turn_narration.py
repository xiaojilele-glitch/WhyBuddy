"""驱动器写左栏步骤记录（E13 turnNarrations），随会话 blob 进库。

2026-08-18 社区工具屋（sr-20260818172818-8XJ40SG9AH）：四轮都画了页，
左栏却是「1 阶段 · 0 步」。库里 turnNarrations=[]。

E13 早就把叙述放进会话状态（文件 / HTTPS SQL 网关同一份 blob），
封顶、同轮守卫豁免都在。缺的是**谁写**：注释写「客户端轮末 PUT」，
而旁路 fetch、刷新后水合都不会走那条 SSE 收尾。Python 只封顶、不写，
于是落库字段永远空着。

⚠ 不另开一张步骤表。会话已经在库里；另开表要跟 lastTurnId 守卫、
3 轮封顶、水合对账再对一次，而这次看不见步骤的原因是「没人写字段」。

文案跟前端 useSlideRuleSession / capability-process-labels 对齐——
隔着一条 SSE，漏一个的后果是内部 id 漏到用户脸上。
"""

from __future__ import annotations
from .stage_legal import labels as _stage_labels
from .archetype_legal import required_evidence as _required_evidence
from .closed_tools import (
    FACTORY_HOP_LABELS,
    FACTORY_HOPS,
    factory_hop_from_text,
    hop_from_factory_capability,
)

import hashlib
import json
import re
import time
from typing import Any, Dict, List, Optional

MAX_TURNS = 3
MAX_STEPS = 300
MAX_TEXT = 1200

# 只收静态 liveLabel。函数型（mcp.call 等）走「正在执行 {id}」。
_CAPABILITY_LIVE_LABELS: Dict[str, str] = {
    "intent.parse": "正在理解你的目标",
    "intent.clarify": "正在澄清需求",
    "context.collect": "正在整理上下文",
    "source.classify": "正在归类信息来源",
    "gap.ask": "正在定位信息缺口",
    "question.expand": "正在展开关键问题",
    "assumption.validate": "正在校验假设",
    "route.generate": "正在生成可行路线",
    "route.compare": "正在对比路线",
    "tradeoff.evaluate": "正在权衡取舍",
    "scenario.simulate": "正在模拟场景",
    "execution.prepare": "正在准备执行方案",
    "risk.analyze": "正在分析风险",
    "counter.argue": "正在寻找反方观点",
    "argument.expand": "正在展开论证",
    "critique.generate": "正在自我挑刺",
    "rebuttal.resolve": "正在消解分歧",
    "evidence.search": "⚡ 正在全网检索外部证据",
    "memory.recall": "⚡ 正在回忆历史会话",
    "structure.decompose": "正在拆解结构",
    "document.draft": "正在起草文档",
    "requirement.write": "正在编写需求",
    "design.write": "正在编写设计",
    "task.write": "正在编写任务清单",
    "ux.preview": "正在生成交互预览",
    "outcome.visualize": "正在生成效果预览",
    "instruction.package": "正在打包执行指令",
    "synthesis.merge": "正在综合各方结论",
    "report.write": "正在撰写可行性报告",
    "traceability.matrix": "正在构建追溯矩阵",
    "handoff.package": "正在打包交接材料",
    "appbundle.runtimeClosure": "正在生成应用闭环",
    "refine": "精修：跳过规划，直进收口",
    "planning": "正在规划本轮动作",
}

#: ⚠ 2026-08-30：曾是写死的 9 条，而 `v5_full_driver._ENRICH_STAGE_LABELS`
#: 还有**逐字相同的第二份**（多带耗时）。两份手抄，改一份不报错，只让左栏
#: 与进度提示悄悄说两套话。现在两份同源于阶段账本。
#: ⚠ 只取 spec-first 那九条：本模块讲的是**本轮流水线**的叙述，
#: 老生成链（model.* / monitor.*）不属于它。账本里两组用 pipeline 标区分。
_SPEC_FIRST_LABELS: Dict[str, str] = {
    k: v for k, v in _stage_labels().items() if k.startswith("specfirst.")
}

_SKILL_LABELS: Dict[str, str] = {
    "datamodel": "数据模型",
    "dataModel": "数据模型",
    "workflow": "工作流",
    "rbac": "角色权限",
    "page": "页面",
    "aigc": "AI 能力",
    "appbundle": "应用装配",
    "appBundle": "应用装配",
}

#: ⚠ 2026-08-30：这份曾是 `v5_full_driver._SKILL_EMIT_ORDER` 的**手抄第二份**。
#: 两份都写死同样六个字面量，改一份不改另一份不报错，只让左栏与 SSE 的点亮顺序
#: 悄悄错开（第四条）。现在两份同源。
_SKILL_EMIT_ORDER = _required_evidence()

_SKIP_THINK_PREFIXES = ("phase_changed:", "loop_timing:")


def human_capability_label(capability_id: str) -> str:
    cap = str(capability_id or "").strip()
    hop = hop_from_factory_capability(cap)
    if hop:
        return FACTORY_HOP_LABELS.get(hop) or f"正在执行 {hop}"
    if cap in _CAPABILITY_LIVE_LABELS:
        return _CAPABILITY_LIVE_LABELS[cap]
    if cap in _SPEC_FIRST_LABELS:
        return _SPEC_FIRST_LABELS[cap]
    return f"正在执行 {cap}" if cap else "正在执行"


def _event_fields(ev: Any) -> Dict[str, Any]:
    if isinstance(ev, dict):
        return ev
    return {
        "kind": getattr(ev, "kind", ""),
        "text": getattr(ev, "text", ""),
        "capabilityId": getattr(ev, "capabilityId", ""),
        "turnId": getattr(ev, "turnId", ""),
    }


def _loop_index(turn_id: str) -> Optional[int]:
    matched = re.match(r"loop-(\d+)$", str(turn_id or ""))
    if not matched:
        return None
    return int(matched.group(1))


def _goal_text(state: Any) -> str:
    goal = getattr(state, "goal", None)
    if isinstance(goal, dict):
        return str(goal.get("text") or "")
    if goal is None:
        return ""
    return str(getattr(goal, "text", "") or "")


_HOP_DONE_NOTE = {
    "structure": "本轮已完成数据模型反推。",
    "bind": "本轮已完成权限绑定。",
    "closure": "本轮已完成完整性检查。",
    "spec": "本轮已完成规格起草。",
}

#: 零产出不许说「已完成」。跟回执 ok=false 同一把尺子。
HOP_NO_PRODUCE_NOTE = "这一跳没有新的产出，上一版保留。"


def deliverable_fingerprint(state: Any) -> str:
    """交付物指纹：SPEC + 页面 + 模型版本。用来回答「这一跳到底动没动东西」。

    只取会被工厂改写的那几块，稳定序列化后哈希。取整个 state 会把
    lastActive / 台账这类每轮必变的字段算进去，指纹就永远"变了"，
    等于没判据。
    """
    blob = getattr(state, "specFirstPages", None)
    if not isinstance(blob, dict):
        blob = {}
    payload = {
        "spec": blob.get("spec"),
        "pages": blob.get("pages"),
        "version": getattr(state, "currentModelVersionId", None),
    }
    try:
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:  # noqa: BLE001
        raw = repr(payload)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _goal_tools(state: Any) -> List[str]:
    goal = getattr(state, "goal", None)
    if not isinstance(goal, dict):
        return []
    raw = goal.get("tools")
    if not isinstance(raw, list):
        return []
    return [str(item).strip() for item in raw if str(item).strip()]


def _hop_done_note(tools: List[str]) -> str:
    for name in tools:
        note = _HOP_DONE_NOTE.get(name)
        if note:
            return note
    return ""


def _turn_hop(state: Any, user: str) -> str:
    """本跳是哪一件 WRITE。人话点名压过 goal.tools 里上一跳的残留。"""
    named = factory_hop_from_text(user)
    if named:
        return named
    tools = _goal_tools(state)
    if len(tools) == 1 and tools[0] in FACTORY_HOPS:
        return tools[0]
    return ""


def _slim_step(step: Dict[str, Any]) -> Dict[str, Any]:
    """落库瘦身。

    ⚠ 2026-08-23：截 ``text`` 时必须把**原始长度**记进 ``textChars``。

    现象是用户指着推演步骤列表问"这些字数为啥都一样"——12 步里 9 步整整齐齐
    写着「1201 字」。1201 不是字数，是 ``1200（上限）+ 1（省略号）``：这里把
    超长文本截成 ``value[:1200] + "…"``，而回放时前端直接数这份**已经截断的**
    文本（client 的 LlmLiveOutput）。于是所有超过 1200 字的步骤显示同一个数。

    只记 ``text`` 的原长——前端只显示这一个字段的长度。其余三个字段照截，但
    不占额外字节；没被截的步骤也不加这个键，它的长度本来就是真的。

    ⚠ 前端 client/src/pages/sliderule/turn-narration.ts 的 slimStep 是同一件事
      的另一半实现（两侧都会写这份投影）。**改一处不改另一处的现象是"有的步骤
      显示真字数、有的还是 1201"**，取决于这轮是谁落的库——不会报错。
    """
    slim = dict(step)
    for key in ("text", "message", "label", "title"):
        value = slim.get(key)
        if isinstance(value, str) and len(value) > MAX_TEXT:
            # ⚠ **必须幂等**：已经有 textChars 就别再写。
            #
            # 这条路会被跑两遍：客户端 slimStep 先截一次（那次记的才是真原长），
            # PUT 上来之后 cap_turn_narrations 又对同一份数据跑一遍——此时
            # text 已经是 1201（1200+省略号），仍然 > MAX_TEXT，不设防的话
            # 就把正确的原长覆盖成 1201，等于这个字段白加。
            #
            # 2026-08-23 真机就是这么翻车的：加完字段跑新话题，库里赫然是
            # `text=1201 textChars=1201`，界面照旧一排 1201。判据当时全绿，
            # 因为单测只跑了一遍瘦身。见 test_slim_is_idempotent。
            if key == "text" and "textChars" not in slim:
                slim["textChars"] = len(value)
            slim[key] = value[:MAX_TEXT] + "…"
    return slim


def cap_turn_narrations(state: Any) -> None:
    """E13 展示数据封顶：最近 3 轮 × 每轮 300 步 × 字段 1200 字。"""
    raw = getattr(state, "turnNarrations", None) or []
    capped: List[Dict[str, Any]] = []
    for entry in raw[-MAX_TURNS:]:
        if not isinstance(entry, dict) or not entry.get("turnId"):
            continue
        steps = []
        for step in (entry.get("steps") or [])[:MAX_STEPS]:
            if not isinstance(step, dict):
                continue
            steps.append(_slim_step(step))
        slim_entry: Dict[str, Any] = {
            "turnId": str(entry["turnId"]),
            "user": str(entry.get("user") or "")[:600],
            "steps": steps,
        }
        try:
            duration = int(entry.get("durationMs") or 0)
            if duration > 0:
                slim_entry["durationMs"] = min(duration, 24 * 3600 * 1000)
        except (TypeError, ValueError):
            pass
        capped.append(slim_entry)
    state.turnNarrations = capped


def stamp_turn_narration(
    state: Any,
    *,
    turn_id: str,
    user: str,
    steps: List[Dict[str, Any]],
    duration_ms: Optional[int] = None,
) -> Any:
    """同轮覆盖、只留最近 MAX_TURNS 轮。空步骤不打戳——与前端 stampTurnNarration 一致。"""
    if not turn_id or not steps:
        return state
    prior = [
        entry
        for entry in (getattr(state, "turnNarrations", None) or [])
        if isinstance(entry, dict) and entry.get("turnId") != turn_id
    ]
    entry: Dict[str, Any] = {
        "turnId": str(turn_id),
        "user": str(user or "")[:600],
        "steps": [_slim_step(step) for step in steps[:MAX_STEPS] if isinstance(step, dict)],
    }
    if duration_ms and duration_ms > 0:
        entry["durationMs"] = min(int(duration_ms), 24 * 3600 * 1000)
    state.turnNarrations = (prior + [entry])[-MAX_TURNS:]
    cap_turn_narrations(state)
    return state


def project_drive_steps(
    state: Any,
    *,
    user: str,
    events_cursor: int,
    produced: Optional[bool] = None,
) -> List[Dict[str, Any]]:
    """把本趟 drive 新增的 reasoningEvents + 本轮页面/闭环投成左栏 steps。

    ``events_cursor`` 是本趟开头的事件条数。不截的话精修轮会把首轮
    intent.parse 再投一遍——看起来像规划又跑了，其实是上一趟的骨灰。
    """
    steps: List[Dict[str, Any]] = []
    seq = 0

    def add_chip(label: str, *, capability_id: str = "intent.parse") -> None:
        nonlocal seq
        seq += 1
        steps.append(
            {
                "id": f"srv-{seq}",
                "kind": "chip",
                "capabilityId": capability_id,
                "roleId": "system",
                "label": str(label)[:MAX_TEXT],
                "realLlm": False,
                "progressType": "thinking",
            }
        )

    def add_narration(text: str) -> None:
        nonlocal seq
        seq += 1
        steps.append(
            {
                "id": f"srv-{seq}",
                "kind": "narration",
                "text": str(text)[:MAX_TEXT],
                "source": "llm",
                "isFinal": True,
            }
        )

    add_chip("指令已接收 · 启动推理")

    events = list(getattr(state, "reasoningEvents", None) or [])[max(0, events_cursor) :]
    for ev in events:
        fields = _event_fields(ev)
        kind = str(fields.get("kind") or "")
        text = str(fields.get("text") or "")
        cap = str(fields.get("capabilityId") or "")
        turn = str(fields.get("turnId") or "")
        if kind == "think" and text.startswith("refine_skip_planning"):
            add_chip(
                "第 1 轮 · 精修：跳过规划，直进收口",
                capability_id="appbundle.runtimeClosure",
            )
            continue
        if kind == "think" and text.startswith(_SKIP_THINK_PREFIXES):
            continue
        if kind != "capability_start":
            continue
        human = human_capability_label(cap)
        loop = _loop_index(turn)
        label = f"第 {loop + 1} 轮 · {human}" if loop is not None else human
        add_chip(label, capability_id=cap or "intent.parse")

    pages_blob = getattr(state, "specFirstPages", None) or {}
    page_map = pages_blob.get("pages") if isinstance(pages_blob, dict) else None
    if isinstance(page_map, dict) and page_map:
        total = len(page_map)
        for index, page_id in enumerate(page_map.keys(), 1):
            add_chip(
                f"🖼 界面已出：{page_id}（{index}/{total}）",
                capability_id="ux.preview",
            )

    closure = getattr(state, "publishClosure", None) or {}
    if not isinstance(closure, dict):
        closure = {}
    per_skill = closure.get("perSkillEvidence") or {}
    if isinstance(per_skill, dict) and per_skill:
        for key in _SKILL_EMIT_ORDER:
            evidence = per_skill.get(key)
            if not isinstance(evidence, dict):
                continue
            name = _SKILL_LABELS.get(key, key)
            add_chip(f"⚙ {name} 系统画面生成中...", capability_id="appbundle.runtimeClosure")
            present = evidence.get("evidencePresent") is True
            add_chip(
                f"{'✓' if present else '✗'} {name} 证据{'落地' if present else '缺失（fail-closed）'}",
                capability_id="appbundle.runtimeClosure",
            )

    paint = str(closure.get("refinePaintNote") or "").strip()
    summary = str(closure.get("chatSummary") or "").strip()
    instruction = str(user or "").strip()
    goal = _goal_text(state).strip()
    follow_up = bool(instruction and goal and instruction != goal)
    painted = bool(page_map)
    hop = _turn_hop(state, instruction)
    this_hop_paints = hop in ("", "pages")
    # 叙述由「本轮真的产出了什么」决定。人话点名 hop 只用来认这一跳
    # 是哪一件 WRITE，不许单独把零产出说成已完成。produced 缺省
    # None = 不知道，按没产出（fail-closed）。
    did_produce = produced is True
    if paint:
        add_narration(paint)
    elif follow_up and hop and hop != "pages":
        # structure / bind 本跳就没打算画页。套「没画出页面」是把 hop 当精修。
        if did_produce:
            done = _HOP_DONE_NOTE.get(hop) or f"本轮已完成 {hop}。"
            add_narration(done)
        else:
            add_narration(HOP_NO_PRODUCE_NOTE)
    elif follow_up and painted and this_hop_paints and did_produce:
        add_narration("本轮已按指令改画页面。")
    elif follow_up and this_hop_paints:
        add_narration("本轮没有画出新的页面，上一版保留。")
    elif summary and did_produce:
        add_narration(summary)

    return steps[:MAX_STEPS]


def stamp_drive_narration(
    state: Any,
    *,
    turn_id: str,
    user: str,
    events_cursor: int,
    started_monotonic: Optional[float] = None,
    produced: Optional[bool] = None,
) -> Any:
    """轮末把本趟步骤打进 state.turnNarrations，下一笔 persist_state 进库。"""
    steps = project_drive_steps(
        state, user=user, events_cursor=events_cursor, produced=produced
    )
    duration_ms = None
    if started_monotonic is not None:
        duration_ms = int((time.monotonic() - started_monotonic) * 1000)
    return stamp_turn_narration(
        state,
        turn_id=turn_id,
        user=user,
        steps=steps,
        duration_ms=duration_ms,
    )
