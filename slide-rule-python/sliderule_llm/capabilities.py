"""
Real capability execution for the Python V5 backend — replaces the canned `rag_service` brain.

execute_capability() builds a per-capability prompt and makes a REAL LLM call via client.call_llm
(httpx → the configured endpoint, e.g. su8/rcouyi). Returns the V5 capability shape
{title, summary, content, provenance, model, usage}. provenance is "python-llm" (honest: a real model
call, NOT retrieval) so it is distinguishable from the old fake "python-rag" stub.

Dialogue-family caps emit MARKDOWN prose (not a strict JSON schema): reasoning models (e.g. rcouyi's
gemini) reliably write grounded markdown but routinely ignore an exact JSON shape, so we package the
prose into the V5 fields ourselves rather than depending on the model obeying a schema.

Markdown dialogue caps use CAPABILITY_PROMPTS; structured caps (e.g. report.write) use JSON via
call_llm_json_with_shape. Anything else raises UnsupportedCapability so the caller can fall back.
"""
from __future__ import annotations

import os
import re
from contextvars import ContextVar
from typing import Any, Callable

from .client import LlmError, LlmResult, call_llm_json_with_shape, call_llm_with_retry
from .config import default_max_tokens
from .evidence import EvidenceRetrievalResult, generated_sources_from_content


class UnsupportedCapability(Exception):
    pass


# 实时增量回调（推演可观测性）：驱动层注册后，每个能力的 LLM 内容增量会带
# capability 标签逐块推给它（SSE llm_delta → 前端左栏实时输出）。只是观测
# 钩子——不参与结果/gate/trust；回调异常被吞掉，永不影响调用本身。
#
# 2026-08-06：从模块级全局改成请求域 ContextVar。原来的注释写着"多会话并发时
# 增量会交织（本地单人 dev 可接受）"——那个前提在有账号的多租户下不成立了。
# 实测过它的同门兄弟 v5_llm_generate._delta_sink：两个并发流式推演，后到的把
# 先到的 sink 顶掉，**用户 A 生成的内容实时出现在用户 B 的页面上**，A 自己
# 那边一片空白。这个 sink 是同一形状同一后果，只是走能力执行那条链路。
# 详细取舍见 services/v5_llm_generate.py 里那段"请求域状态"说明。
_delta_sink_var: ContextVar[Callable[[str, str], None] | None] = ContextVar(
    "sliderule_capability_delta_sink", default=None
)


def set_capability_delta_sink(sink: Callable[[str, str], None] | None) -> None:
    _delta_sink_var.set(sink)


def capability_delta_sink_scope(sink: Callable[[str, str], None] | None):
    """装了自带卸的写法（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。

    调用方优先用这个，别用上面那个裸 setter——裸 setter 要人肉记得去别处补
    一行卸载，而且卸成 None 而不是还原成原来那个。
    """
    from .scoped import sink_scope

    return sink_scope(_delta_sink_var, sink)


def _delta_emitter(capability_id: str) -> Callable[[str], None] | None:
    if _delta_sink_var.get() is None:
        return None

    def _emit(chunk: str, _cap: str = capability_id) -> None:
        sink = _delta_sink_var.get()
        if sink is None:
            return
        try:
            sink(_cap, chunk)
        except Exception:
            pass

    return _emit


def delta_emitter(label: str) -> Callable[[str], None] | None:
    """给**能力执行之外**的调用点用的同一条增量通道（2026-08-14）。

    ## 为什么要这个公开口

    spec-first 那六步不是"能力"，走的是自己的模块，于是它们一条增量都不发——
    真机一轮 884 个 llm_delta **全部**来自老链路的轮内能力，新链路是零。
    表现就是左栏只有"正在执行 XXX"这行标题，底下什么都没有。

    参照 666ghj/BettaFish 的 forum 流：它把每个 Agent **说的话**逐行推成
    `{sender, content, timestamp}`，前端渲染成发言。要流的是**内容**，
    不是"正在执行 X"。我们这条通道本来就是干这个的，缺的只是接上去。

    ⚠ 传进去的 label 会原样变成 SSE 事件里的 `label`，前端据它起标题、分缓冲。
    前端认不出来的 label 会被原样显示成内部 id——所以加新 label 时，
    humanLlmLabel 那张表要同步加（判据见 test_spec_first_streaming）。

    ⚠ **不要给逐页并发的步骤用**（第 3 步画界面、第 6.5 步打孔）：
      · 五路并发往同一个 label 里推，前端拼出来是交织的乱码；
      · `on_delta` 在场会**关掉对冲**（见 call_llm_with_retry 边界一），
        而那两步恰恰是最慢、最需要对冲治长尾的（bind 实测 552 秒）。
      那两步的进度另有出口：页面本身就是逐页交付的。
    """
    return _delta_emitter(label)


CAPABILITY_PROMPTS: dict[str, str] = {
    "intent.clarify": (
        "You are SlideRule V5's intent-clarification role. Given the user's goal and message, write a "
        "concise **markdown** clarification with three short sections: (1) restated goal, "
        "(2) implicit assumptions, (3) key open questions to resolve before planning. "
        "Stay strictly grounded in the user's actual goal — do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "gap.ask": (
        "You are SlideRule V5's gap-discovery role. Given the user's goal and message, write a "
        "concise **markdown** gap analysis with three short sections: (1) missing information, "
        "(2) why each gap matters, (3) the smallest set of questions to ask next. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "question.expand": (
        "You are SlideRule V5's question-expansion role. Given the user's goal and rough question, write a "
        "concise **markdown** expansion with three short sections: (1) expanded questions, "
        "(2) why those questions matter, (3) suggested answer format for the user. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "critique.generate": (
        "You are SlideRule V5's structured-critique role. Given the user's goal and message, write a "
        "concise **markdown** critique with three short sections: (1) critique points, "
        "(2) risks, (3) minimal verification steps. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "synthesis.merge": (
        "You are SlideRule V5's deliberation-synthesis role. Given the user's goal and message, write a "
        "concise **markdown** convergence with three short sections: (1) synthesized conclusion, "
        "(2) remaining disagreements, (3) smallest next action. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "rebuttal.resolve": (
        "You are SlideRule V5's rebuttal-resolution role. Given the user's goal and message, write a "
        "concise **markdown** rebuttal response with three short sections: (1) response points, "
        "(2) unresolved disagreements, (3) suggested verification steps. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "counter.argue": (
        "You are SlideRule V5's counter-argument role. Given the user's goal and message, write a "
        "concise **markdown** counter-argument with three short sections: (1) counterpoints, "
        "(2) evidence gaps, (3) verifiable rebuttal path. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "structure.decompose": (
        "You are SlideRule V5's structure-decomposition role. Given the user's goal and message, write a "
        "concise **markdown** SPEC-tree decomposition with: (1) a root goal line, "
        "(2) child branches for requirements, risks, and deliverables (nested bullets), "
        "(3) evidenceRef notes on key branches. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "document.draft": (
        "You are SlideRule V5's document-drafting role. Given the user's goal, state, and message, write a "
        "concise **markdown** delivery document with these sections: (1) Requirements, "
        "(2) Design notes, (3) Tasks, (4) Acceptance criteria. "
        "Use concrete bullets grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Do not return a generic template; every section must mention the actual goal or its domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "traceability.matrix": (
        "You are SlideRule V5's traceability-matrix role. Given the user's goal, state, and message, write a "
        "concise **markdown table** that maps requirement, evidence, risk, decision, and next action. "
        "Use concrete rows grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Do not return a generic template; every row must connect the actual goal to evidence or action. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "task.write": (
        "You are SlideRule V5's engineering-task writer. Given the user's goal, state, and message, write a "
        "concise **markdown task list** for implementation work. Each task must include a stable task id, "
        "title, acceptance checks, and dependency or blocked-by notes. "
        "Use concrete tasks grounded in the user's actual goal. Do not return a generic template or a prose document. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "instruction.package": (
        "You are SlideRule V5's instruction-package role. Given the user's goal, state, and message, write a "
        "concise **markdown prompt pack** with exactly these sections: Operator prompt, Engineering prompt, "
        "Evidence prompt, and Verification prompt. Each section must include concrete constraints and an "
        "acceptance or stopping check grounded in the actual goal. Do not write a generic prompt template. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "outcome.visualize": (
        "You are SlideRule V5's outcome-visualization role. Given the user's goal, state, and message, write a "
        "concise **markdown** architecture or flow preview. Include either a Mermaid diagram block or clear "
        "flow states, plus evidence/provenance notes that explain what each visual element is grounded in. "
        "Stay strictly grounded in the user's actual goal. Do not return a generic dashboard mockup. "
        "Output markdown only: no JSON, no preamble."
    ),
    "ux.preview": (
        "You are SlideRule V5's UX preview role. Given the user's goal, state, and message, write a concise "
        "**markdown UX preview** with exactly these sections: Screen/state preview, Primary user flow, "
        "Interaction notes, and Source/provenance notes. Include at least one concrete screen or state name, "
        "and explain which goal/state evidence each preview detail is grounded in. Stay strictly grounded in "
        "the user's actual goal. Do not return generic dashboard filler. Output markdown only: no JSON, no preamble."
    ),
    "handoff.package": (
        "You are SlideRule V5's engineering-handoff role. Given the user's goal, state, and message, write a "
        "concise **markdown handoff package** that explicitly bundles report, traceability matrix, prompt pack, "
        "visual preview, risk, and next steps. Include owner-ready acceptance notes and unresolved gaps. "
        "Stay strictly grounded in the user's actual goal. Do not return a generic summary. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "risk.analyze": (
        "You are SlideRule V5's risk-analysis role. Given the user's goal and message, write a "
        "concise **markdown** risk scan with three short sections: (1) risk inventory, "
        "(2) impact assessment, (3) mitigation paths. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "evidence.search": (
        "You are SlideRule V5's evidence-search role. Given the user's goal and message, write a "
        "concise **markdown** evidence brief with three short sections: (1) grounding references, "
        "(2) why each reference matters, (3) gaps that still need external retrieval. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
}

CAPABILITY_TITLES: dict[str, str] = {
    "intent.clarify": "Intent clarification",
    "gap.ask": "Gap questions",
    "question.expand": "Expanded questions",
    "critique.generate": "Structured critique",
    "synthesis.merge": "Synthesis merge",
    "rebuttal.resolve": "Rebuttal resolution",
    "counter.argue": "Counter argument",
    "structure.decompose": "Structure decomposition",
    "document.draft": "SPEC document draft",
    "traceability.matrix": "Traceability matrix",
    "task.write": "Engineering task list",
    "instruction.package": "Instruction package",
    "outcome.visualize": "Outcome visualization",
    "ux.preview": "UX preview",
    "handoff.package": "Engineering handoff package",
    "risk.analyze": "Risk analysis",
    "evidence.search": "Evidence search",
    "report.write": "Feasibility report",
}

STRUCTURED_JSON_CAPABILITIES: frozenset[str] = frozenset({"report.write"})

REPORT_WRITE_REQUIRED_KEYS = ("title", "summary", "content")

#: 轮内能力的输出上限。**2000 → 8000（2026-08-11）→ 并进全局口径（2026-08-13）。**
#:
#: ## 为什么翻上来
#:
#: 推理模型的**思考 token 和正文共用同一个 max_tokens**。线上跑一道真题时
#: `intent.clarify` 占着连接算了 115.5 秒，正文一个字都没吐，抛
#: `empty content from LLM (stream)`，整轮被它一个人从 22 秒拖到 116 秒
#: （并行批的耗时等于最慢那个），最后还得回退 RAG——**产出也打了折**。
#:
#: ## 为什么后来连"轮内能力专属的那个旋钮"也撤了
#:
#: 因为分路旋钮没解决问题。8000 和它的 `LLM_ROUND_CAP_MAX_TOKENS` 都调过了，
#: 换 DeepSeek 那趟挂的是**第三处**、这个旋钮管不着的硬编码。预算的分路数量
#: 本身就是病因。现在全链路一个 `LLM_MAX_TOKENS`，见 config.DEFAULT_MAX_TOKENS。
#:
#: ## 纪律（没变，只是收得更紧了）
#:
#: **走 LLM 的路径，token 预算不许写死**——不许写在函数默认值里，也不许写在
#: 调用点上。写死的东西没有名字、搜不到、也没人会想起来它跟模型换代有关系。
#: 判据见 tests/test_llm_token_budget.py。
REPORT_WRITE_SECTION_MARKERS = (
    "结论",
    "支撑证据",
    "反证",
    "风险",
    "分歧",
    "收敛决策",
    "未解缺口",
    "下一步工程化",
    "provenance",
)

REPORT_WRITE_SYSTEM_PROMPT = (
    "You are SlideRule V5's feasibility-report writer. Return ONLY a JSON object with exactly these keys: "
    "title (string), summary (string), content (string). "
    "The content string must include these nine labeled sections in order: "
    "结论, 支撑证据, 反证/挑战, 风险, 分歧, 收敛决策, 未解缺口, 下一步工程化分支, "
    "provenance / upstream refs. "
    "Stay strictly grounded in the user's actual goal — do not invent an unrelated domain "
    "(no generic RBAC/data-scoping boilerplate unless the goal is about permissions). "
    "No markdown code fences, no preamble outside the JSON object."
)


def is_python_native_capability(capability_id: str) -> bool:
    return capability_id in CAPABILITY_PROMPTS or capability_id in STRUCTURED_JSON_CAPABILITIES


def build_messages(capability_id: str, body: dict[str, Any]) -> list[dict[str, str]]:
    system = CAPABILITY_PROMPTS.get(capability_id)
    if not system:
        raise UnsupportedCapability(capability_id)
    state = body.get("state") or {}
    goal = ((state.get("goal") or {}).get("text") or "").strip()
    user_text = (body.get("userText") or "").strip()
    upstream = str(body.get("upstreamEvidence") or "").strip()
    evidence_section = (
        (
            "\nUPSTREAM_EVIDENCE（上游已过信任门的产物，作为你的推理依据；"
            "引用其中的结论/风险/证据，不要凭空另起炉灶）:\n" + upstream + "\n"
        )
        if upstream
        else ""
    )
    user = (
        f"GOAL: {goal or '(none stated)'}\n"
        f"USER_MESSAGE: {user_text or '(none)'}\n"
        f"ROLE: {body.get('roleId', 'agent')}  TURN: {body.get('turnId', '')}\n"
        f"{evidence_section}\n"
        "Write the markdown now."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


_FENCE = re.compile(r"^\s*```[a-z]*\s*\n?|\n?\s*```\s*$", re.IGNORECASE)


def _clean(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = _FENCE.sub("", t).strip()
    return t


def _first_line(text: str, limit: int = 120) -> str:
    for line in text.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:limit]
    return ""


def _goal_and_user(body: dict[str, Any]) -> tuple[str, str]:
    state = body.get("state") or {}
    goal = ((state.get("goal") or {}).get("text") or "").strip()
    user_text = (body.get("userText") or "").strip()
    return goal, user_text


def build_report_write_messages(body: dict[str, Any]) -> list[dict[str, str]]:
    goal, user_text = _goal_and_user(body)
    upstream = str(body.get("upstreamEvidence") or "").strip()
    evidence_section = (
        (
            "\nUPSTREAM_EVIDENCE（上游已过信任门的产物；报告的结论/证据/"
            "风险各节必须以此为依据并引用，不得凭空再推演）:\n" + upstream + "\n"
        )
        if upstream
        else ""
    )
    user = (
        f"GOAL: {goal or '(none stated)'}\n"
        f"USER_MESSAGE: {user_text or '(none)'}\n"
        f"ROLE: {body.get('roleId', 'agent')}  TURN: {body.get('turnId', '')}\n"
        f"{evidence_section}\n"
        "Write the JSON report object now."
    )
    return [
        {"role": "system", "content": REPORT_WRITE_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _report_content_has_required_sections(content: str) -> bool:
    hits = sum(1 for marker in REPORT_WRITE_SECTION_MARKERS if marker in content)
    return hits >= 5


def _execute_report_write(
    body: dict[str, Any],
    *,
    json_caller: Callable[..., tuple[dict[str, Any], LlmResult]] | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    max_tokens = max_tokens or default_max_tokens()
    messages = build_report_write_messages(body)
    caller = json_caller or call_llm_json_with_shape
    kwargs: dict[str, Any] = {}
    # on_delta 只在默认 caller 上传（注入的测试替身不认识这个参数）
    if json_caller is None:
        emitter = _delta_emitter("report.write")
        if emitter is not None:
            kwargs["on_delta"] = emitter
    parsed, result = caller(
        messages,
        required_keys=REPORT_WRITE_REQUIRED_KEYS,
        max_shape_retries=1,
        max_tokens=max_tokens,
        **kwargs,
    )
    title = _clean(str(parsed.get("title") or ""))
    summary = _clean(str(parsed.get("summary") or ""))
    content = _clean(str(parsed.get("content") or ""))
    if not title or not summary or not content:
        raise LlmError("python backend produced empty report.write fields", transient=False)
    if not _report_content_has_required_sections(content):
        raise LlmError("report.write content missing required V5 sections", transient=False)
    return {
        "title": title,
        "summary": summary,
        "content": content,
        "provenance": "python-llm",
        "model": result.model,
        "usage": result.usage,
    }


def execute_capability(
    body: dict[str, Any],
    *,
    caller: Callable[..., LlmResult] | None = None,
    json_caller: Callable[..., tuple[dict[str, Any], LlmResult]] | None = None,
    evidence_retriever: Callable[[str], EvidenceRetrievalResult] | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Run one capability via a REAL LLM call. Raises UnsupportedCapability / LlmError on failure
    (caller decides fallback). `caller` / `json_caller` are injectable for deterministic unit tests.

    `max_tokens=None`（缺省）走 `default_max_tokens()`——**不再写死在签名里**，
    理由见 config.DEFAULT_MAX_TOKENS 头上的长注释。显式传值仍然优先
    （测试与评测靠它控成本）。
    """
    max_tokens = max_tokens or default_max_tokens()
    capability_id = body.get("capabilityId")
    if not is_python_native_capability(capability_id):
        raise UnsupportedCapability(str(capability_id))

    if capability_id == "report.write":
        return _execute_report_write(body, json_caller=json_caller, max_tokens=max_tokens)

    messages = build_messages(capability_id, body)
    llm_caller = caller or call_llm_with_retry
    kwargs: dict[str, Any] = {}
    if caller is None:
        emitter = _delta_emitter(str(capability_id))
        if emitter is not None:
            kwargs["on_delta"] = emitter
    result = llm_caller(messages, max_tokens=max_tokens, **kwargs)

    content = _clean(result.content)
    if not content:
        raise LlmError("python backend produced empty capability content", transient=False)
    payload: dict[str, Any] = {
        "title": CAPABILITY_TITLES.get(capability_id, capability_id),
        "summary": _first_line(content),
        "content": content,
        "provenance": "python-llm",
        "model": result.model,
        "usage": result.usage,
    }
    if capability_id == "evidence.search":
        query = "\n".join(part for part in _goal_and_user(body) if part)
        if evidence_retriever:
            retrieval = evidence_retriever(query)
            payload["sources"] = retrieval.sources_as_dicts()
            payload["evidenceProvenance"] = retrieval.provenance
            if retrieval.fallback_reason:
                payload["fallbackReason"] = retrieval.fallback_reason
        else:
            payload["sources"] = [source.to_dict() for source in generated_sources_from_content(content)]
            payload["evidenceProvenance"] = "generated"
            payload["fallbackReason"] = "llm_prose_only"
    return payload
