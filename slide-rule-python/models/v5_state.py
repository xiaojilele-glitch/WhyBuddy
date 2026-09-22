"""
Pydantic models for SlideRule V5 state (migrated from shared/blueprint/v5-reasoning-state.ts and Node usage).

This replaces the TS types used in Node's session-driver, orchestrate-plan, execute-capability, GCOV, etc.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field, model_validator, ValidationInfo

# AwaitReason from shared/blueprint/v5-reasoning-state.ts for runtime await parking (P0)
AwaitReason = Literal[
    "ready",
    "confirm",
    "coverage",
    "budget",
    "convergence",
    "user_input",
    "max_loops",
    "max_repeat_guard",
    "no_progress",
    "closure_blocked",
    "closure_missing",
    "control_ask",
    "control_scope",
    "control_plan_approval",
    # ⚠ 2026-08-27 压测挖出来的静默数据丢失：控制面澄清停靠写的是
    #   `state.awaitReason = "control_clarify"`（rehearsal_control.py:906），
    #   而这个名单里从来没有它。pydantic v2 默认**不校验赋值**，所以写的时候
    #   一声不响；等到从库里读回来走 server_load，整条会话直接
    #   `invalid_session` → `_coerce_many` 把它**跳过**（persistence.py:370）。
    #   症状是「停在澄清那一步的会话，重启后从侧栏里消失了」——没有报错、
    #   没有告警、schema 对齐测试照样绿（两边都缺，所以"两边一致"成立）。
    #   同一形态上一次是 coverageContract，看 persistence.py:177 那段注释。
    "control_clarify",
    # 同一形态的第二处：马拉松内层驱动炸掉时写
    #   `working.awaitReason = "error"`（slide_rule_marathon.py:170）。
    #   讽刺的是这条**恰恰是失败取证路径**——它把异常写进 decisionLedger 好让
    #   人事后查，结果整条会话因为这个未申报的值读不回来，取证记录一起没了。
    "error",
]


class ProducedBy(BaseModel):
    """Structured server-owned provenance for Artifact.
    Matches shared/blueprint/v5-reasoning-state.ts exactly.
    Frontend/client cannot forge; only server paths (executors, drivers) populate.
    Required for trustLevel elevation beyond untrusted.
    """
    capabilityRunId: str
    capabilityId: str
    roleId: Optional[str] = None


class Artifact(BaseModel):
    """V5 Artifact contract (PYTHON_AUTHORITY).
    Aligned to producedBy, trustLevel, passedGates, stale, status, payload behavior per task.
    Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY.
    Do not default to trusted. Trust gates + provenance ledger justify elevation.
    Normal construction (Artifact(), **dict from client/PUT, model_validate without context) rejects elevated trustLevel, producedBy, and non-empty passedGates.
    Artifact.server_construct for new elevated; V5SessionState.server_load for durable/persisted state roundtrip.
    This separates client anti-forgery from server-owned persistence reload of gated/audited artifacts.
    frontend/client dicts cannot forge server-owned trust/provenance via the model.
    payload is retained for structured executor output (e.g. sources/critiques) but MUST NOT participate in trustLevel/passedGates decisions.
    stale per-artifact marker for compat; authoritative invalidation uses V5SessionState.staleArtifactIds.
    status provides explicit lifecycle state separate from trustLevel.
    """
    id: str
    kind: str = "evidence"
    provenance: str = "python-rag"  # was ai_generated, mcp:github, template, llm, etc.
    # Do not default to trusted (per task requirements: do-not-default-artifacts-to-trusted)
    trustLevel: Literal["untrusted", "gated_pass", "audited"] = "untrusted"
    passedGates: List[str] = Field(default_factory=list)
    title: Optional[str] = None
    summary: Optional[str] = None
    content: str = ""
    # payload保留且不参与 trust gate：executor 结构化输出（例 critiques, sources）；Trust Gate 不得读取此字段判定。
    payload: Optional[Dict[str, Any]] = None
    # producedBy 必须是结构化 server-owned provenance；前端 PUT 不得伪造 server-owned trust/provenance 语义。
    producedBy: Optional[ProducedBy] = None
    stale: bool = False
    # status: 明确 artifact 状态语义（独立于 trustLevel）；active 为默认；stale/superseded 由 server 驱动的失效/轮次机制设置。
    status: Optional[Literal["active", "stale", "superseded"]] = "active"

    @classmethod
    def server_construct(cls, **data: Any) -> "Artifact":
        """Server-only path to construct Artifact with elevated trustLevel / server provenance.
        Call ONLY from server executor/driver/gate code AFTER actual gate evaluations have passed.
        Uses model_validate(..., context={"server_trusted": True}) to bypass ONLY the anti-forgery
        _reject_elevated_in_raw_input check, while still executing full Pydantic field/schema validation
        (Literal for trustLevel/status, list for passedGates, required fields+shape for ProducedBy etc.).
        Client/frontend paths using normal Artifact() or model_validate without context are rejected.
        For loading previously persisted server state containing elevated artifacts, use V5SessionState.server_load.
        """
        # Pass through as-is; context tells validator to skip only anti-forgery.
        # Pydantic will validate all fields, sub-models, and literals here.
        return cls.model_validate(data, context={"server_trusted": True})

    @model_validator(mode="before")
    @classmethod
    def _reject_elevated_in_raw_input(cls, data, info):
        """Enforce server-only trust/provenance boundary at raw input (PYTHON_AUTHORITY).
        Rejects client-supplied producedBy (server-owned provenance), non-empty passedGates (trust gate state),
        or elevated trustLevel unless server_trusted context provided.
        Normal Artifact(**client_dict), V5SessionState(**client_state) etc. hit this (incl. nested artifacts) and reject.
        model_validate(..., context={"server_trusted": True}) via server_load allows persisted elevated server state.
        server_construct uses model_validate with server_trusted context (bypasses only anti-forgery, not field/schema validation).
        Client/frontend dicts cannot forge server-owned producedBy/passedGates/trust.
        """
        if info is not None and getattr(info, "context", None) and info.context.get("server_trusted"):
            return data
        if isinstance(data, dict):
            tl = data.get("trustLevel")
            if tl in ("gated_pass", "audited"):
                raise ValueError(
                    "trustLevel elevation to gated_pass/audited is server-only; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
            if data.get("producedBy") is not None:
                raise ValueError(
                    "producedBy is server-owned provenance; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
            pg = data.get("passedGates")
            if isinstance(pg, (list, tuple)) and len(pg) > 0:
                raise ValueError(
                    "passedGates is server-only trust gate state; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
        return data

# Classification for sliderule-python-v52-artifact-contract-105 (this task):
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial loose dicts) -> PYTHON_AUTHORITY
# Python owns durable Artifact contract (producedBy structured, status, payload isolation, stale, trust defaults).
# Normal construction rejects elevated trustLevel + producedBy + non-empty passedGates (anti-forgery for server-owned provenance/trust); server-only Artifact.server_construct for gated/audited (and server provenance).
# V5SessionState.server_load provides context-distinguished reload for persisted durable state containing elevated artifacts.
# No Node fallback hiding semantics. Client inputs cannot set elevated trustLevel/producedBy/passedGates for forgery.
# Previous slices (core, runtime, ledgers, replay, stale-superseded) remain PYTHON_AUTHORITY.

# Classification for sliderule-python-v52-state-schema-core-105:
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial) -> PYTHON_AUTHORITY
# This slice (V5SessionState core fields) is now PYTHON_AUTHORITY.
# Python owns durable state schema; no Node fallback for these fields.

class OpenQuestion(BaseModel):
    id: str
    text: str

class GateState(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts GateState for V5 gates list."""
    gateId: str
    kind: Literal["precondition", "commit"]
    status: Literal["open", "passed", "failed"]
    evaluatedAt: Optional[str] = None
    phase: Optional[Literal["commit", "ship"]] = None

class DependencyEdge(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts DependencyEdge."""
    fromArtifactId: str
    toArtifactId: str
    reason: str

#: 一次能力执行的结局。**四档，抄 grok 的 `ToolCallOutcome`**
#: （`xai-tool-protocol/src/session_event.rs`）：
#:
#:     pub enum ToolCallOutcome {
#:         Success,
#:         Error,
#:         Cancelled,
#:         #[serde(other)]
#:         Unknown,
#:     }
#:
#: `unknown` 不是"懒得填"，它是 grok 那个 `#[serde(other)]` 的对应物：
#: **旧记录和占位记录如实说"不知道"**，而不是被编成 success。
#: 词表故意不加 `blocked` / `needs_approval` 之类——那些是 runtime adapter
#: 结果壳的词汇，混进来会变成两处半重合的词表各自漂移。
CapabilityRunStatus = Literal["success", "error", "cancelled", "unknown"]

#: 这条台账是**哪条代码路径**写下的。
#:
#: 加它的直接原因：`CapabilityRun` 在生产代码里有 6 个构造点，各写一部分字段
#: （`slide_rule_trust` 那处只为挂 ledgerEntryId 造一条空壳、`engine_scheduling`
#: 的 commit 路径压根没有 timing）。事后看台账时第一个问题永远是"这条是谁写的"，
#: 而此前只能靠 id 前缀猜。
#:
#: ⚠ 必须是**申报制**。写成自由字符串的话，半年后会有七种拼法指同一条路径，
#: 台账就退化成噪音。同一条纪律见 `AwaitReason` 头上那三次事故。
CapabilityRunProvenance = Literal[
    # engine_scheduling.record_capability_run_error —— 执行炸了那条
    "scheduling.error",
    # engine_scheduling.commit_artifact* —— 产物落地顺带记一条
    "scheduling.commit",
    # slide_rule_executor.* —— 带 timing 的正常执行
    "executor.run",
    # slide_rule_trust.* —— 只为挂 ledgerEntryId 造的空壳，结局确实不知道
    "trust.ledger_stub",
    # routes/sliderule_full.py 的 execute-capability 两条路
    "route.execute_capability",
    "route.execute_capability_native_llm",
    # 测试与脚本。**显式一档**，不给"不填也行"留门
    "test.fixture",
]


class CapabilityRun(BaseModel):
    id: str
    capabilityId: str
    turnId: str
    inputs: List[str] = []
    outputs: List[str] = []
    gateResults: List[Dict[str, Any]] = []
    result: Optional[Dict[str, Any]] = None
    # Task goal: align with inputs/outputs/gateResults/result/timing/error.
    # roleId/ledgerEntryId added for TS contract parity (from blueprint).
    roleId: Optional[str] = None
    ledgerEntryId: Optional[str] = None
    timing: Optional[Dict[str, Any]] = None  # {startedAt, completedAt, durationMs}
    error: Optional[Dict[str, Any]] = None  # {code, message, ...} for failed runs

    # ── 2026-09-06：台账三格 ────────────────────────────────────────────
    #
    # ## 事故形态
    #
    # 台账此前**说不出一次执行的结局**：只有 `error`（有值=失败）和嵌在
    # `timing` 里的 `durationMs`。于是：
    #   * "成功"和"没人填 error" 长得一模一样；
    #   * 两个路由构造点是 `append(CapabilityRun(...))` 之后再
    #     `state.capabilityRuns[-1].timing = {"durationMs": dur}` —— 按
    #     **下标 -1** 打补丁，并发或顺序一变就把耗时记到别人头上；
    #   * 6 个构造点各写一部分，谁都不知道另外 5 个写了什么。
    #
    # ## 抄的是 grok 的哪一处
    #
    # `xai-tool-protocol/src/session_event.rs` 的 `ToolCallCompleted`：
    #
    #     ToolCallCompleted {
    #         tool_call_id: String,
    #         tool_name: String,
    #         duration_ms: u64,
    #         outcome: ToolCallOutcome,
    #     }
    #
    # **四个字段全必填**，配一条反向判据
    # `turn_ended_missing_required_field_rejected`（少一个字段就必须反序列化失败）。
    #
    # ## ⚠ 为什么这里是"有默认值"而不是 pydantic 级 required
    #
    # 因为这是**持久化记录**，不是新发出的事件。grok 那边的 required 管的是
    # 一条刚生成的事件；历史数据靠 `#[serde(other)] Unknown` 兜。
    # 这里同理：库里已有的每条 `CapabilityRun` 都没有这三个字段，改成
    # pydantic required 的话读回来会 `invalid_session` → `_coerce_many`
    # 把**整条会话跳过**（persistence.py:370）—— 就是 `AwaitReason` 头上
    # 记着的那三次事故，症状是「会话从侧栏消失了」。
    #
    # 所以"必填"落在**写路径**：新增记录一律走
    # `CapabilityRun.server_record(...)`，那三个参数是 keyword-only 且
    # **没有默认值**，漏一个就是 TypeError。
    # 配套判据（tests/test_capability_run_ledger.py）扫全仓，禁止生产代码
    # 直接 `CapabilityRun(...)` —— 这条才是防"加第 7 个构造点又忘填"的闸。
    status: CapabilityRunStatus = "unknown"
    #: 顶层耗时。`timing.durationMs` 保留（老读者按它取值），由
    #: `server_record` 保证两处一致——两处书写靠一处填。
    durationMs: Optional[int] = None
    provenance: Optional[CapabilityRunProvenance] = None

    @classmethod
    def server_record(
        cls,
        *,
        status: CapabilityRunStatus,
        durationMs: Optional[int],
        provenance: CapabilityRunProvenance,
        **data: Any,
    ) -> "CapabilityRun":
        """写一条台账。**三个字段是 keyword-only 且无默认值** —— 漏一个是
        TypeError，不是一条静默残缺的记录。

        照 `Artifact.server_construct` 的既有约定：服务端写路径走命名工厂，
        客户端/历史数据走普通构造。

        `durationMs` 允许显式 `None`：`engine_scheduling.commit_artifact*`
        那条路径**真的不知道**耗时（它是产物落地顺带记一笔，没有计时）。
        逼它编一个 0 比留 None 糟——0 会被当成"这一步不花时间"。
        但**必须显式传**：`server_record(...)` 少写这个参数就报错，
        写 `durationMs=None` 是一次有意识的声明。
        """
        timing = dict(data.pop("timing", None) or {})
        if durationMs is not None:
            # 两处书写、一处填：老读者取 `timing.durationMs`，新读者取顶层。
            timing["durationMs"] = int(durationMs)
        elif isinstance(timing.get("durationMs"), (int, float)):
            # 反向也补：调用方只给了 timing 时，顶层别空着。
            durationMs = int(timing["durationMs"])
        return cls(
            status=status,
            durationMs=durationMs,
            provenance=provenance,
            timing=timing or None,
            **data,
        )


def stamp_run_timing(run: Any, *, durationMs: Optional[int], **extra: Any) -> None:
    """给一条**已存在**的台账补耗时。顶层 `durationMs` 与 `timing.durationMs` 一起写。

    ## 为什么要有它（2026-09-06 第二轮真机）

    上一轮给 `CapabilityRun` 加了顶层 `durationMs`，`server_record()` 里也做了
    与 `timing` 的双向对齐。真机跑完一看，**13 行台账的顶层 durationMs 全是
    `None`**，而 `timing.durationMs` 全都有值：

        evidence.search   顶层=None  timing.durationMs=9477
        factory.pages     顶层=None  timing.durationMs=219510

    因为主路径上耗时不是**建记录时**给的，是**跑完之后**打在已有记录上的，
    一共五处（v5_full_driver 三处、slide_rule_session 两处），形状都是
    `last.timing = {"durationMs": dur}`。它们绕过了工厂，于是我新加的那一格
    从落地第一天就是死的。

    这就是本仓第四条的又一次现形：**加字段的时候只改了"创建"那一半，
    "更新"那一半在别处**。把两处书写收成一处，加字段的人不必再去找五个地方。

    ## 形状上的两件事

    · 同时收掉这五处各自手写的 `hasattr(run, "timing") / isinstance(run, dict)`
      分支——台账在库里可能是裸 dict（历史数据），也可能是 pydantic 模型。
    · `durationMs=None` 是**合法**的（有些路径真的没计时），此时只写 extra，
      不往 timing 里塞一个 None 冒充测量值。
    """
    if run is None:
        return
    timing: Dict[str, Any] = {}
    if durationMs is not None:
        timing["durationMs"] = int(durationMs)
    for key, value in extra.items():
        if value is not None:
            timing[key] = value
    if not timing:
        return
    if isinstance(run, dict):
        merged = dict(run.get("timing") or {})
        merged.update(timing)
        run["timing"] = merged
        if durationMs is not None:
            run["durationMs"] = int(durationMs)
        return
    try:
        merged = dict(getattr(run, "timing", None) or {})
        merged.update(timing)
        run.timing = merged
        if durationMs is not None:
            run.durationMs = int(durationMs)
    except Exception:  # noqa: BLE001 — 补耗时是观测项，不许拖垮已经跑完的一轮
        return

# Classification for sliderule-python-v52-capability-run-contract-105 (this task):
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial fields: inputs/outputs/gateResults/result only) -> PYTHON_AUTHORITY
# Python now owns full CapabilityRun contract (inputs, outputs, gateResults, result, timing, error + roleId/ledger for parity).
# Direct model + focused tests prove the fields; no Node fallback hiding semantics.
# This advances StateSchema durable contract parity for capability execution records.
# Prior slices (core/runtime/ledgers/replay/stale/artifact) remain PYTHON_AUTHORITY.

class CoverageGap(BaseModel):
    id: str
    kind: str
    label: str
    requiredCapabilityId: Optional[str] = None
    status: Literal["open", "resolved", "waived"] = "open"
    createdAt: str
    # 下面两个字段 2026-08-09 补。**代码一直在写它们，模型一直没声明它们。**
    #
    # `slide_rule_coverage.reconcile_coverage` 判定缺口被填上时会写
    # `updatedAt`（何时填上的）和 `resolvedByArtifactId`（被哪个产物填上的），
    # 见那个文件里 `_set_gap(g, status="resolved", updatedAt=now)` 两处。
    #
    # 而 pydantic v2 对未声明字段的 setattr 是直接抛的，实测：
    #     ValueError: "CoverageGap" object has no field "updatedAt"
    # 老的 `_set_gap` 又把它 `except Exception: pass` 吞掉——于是**只有当
    # 状态里装的是裸 dict 时这两个字段才写得进去**。真机日志里那串
    # `PydanticSerializationUnexpectedValue: Expected 'CoverageGap'` 就是这个：
    # 代码是靠"状态没被校验"才正常工作的，一旦哪天校验生效，"谁填上的这个缺口"
    # 会无声无息地丢掉，不报错也不告警。
    #
    # 两个字段本来就在 TS 契约里（shared/blueprint/v5-reasoning-state.ts:307/311
    # 的 `resolvedByArtifactId?` 与 `updatedAt?`）——补的是 Python 侧的漏，
    # 不是新增契约。
    resolvedByArtifactId: Optional[str] = None
    updatedAt: Optional[str] = None
    # 澄清卡片（G_READY）用的结构化字段。**词汇跟 TS 契约逐字对齐**
    # （shared/blueprint/v5-reasoning-state.ts:311-335），不是新发明。
    #
    # ⚠ 2026-08-27 补：跟上面 updatedAt 那两条是同一个坑的第二次发作——
    #   前端 ClarificationCard 早就会渲染选项/单选多选/默认值/说明，
    #   `pendingClarifications` 也早就在读这些字段，**Python 侧一个都没声明**。
    #   pydantic v2 对未声明字段的 setattr 直接抛，被上游 except 吞掉之后
    #   表现是：控制面写了带选项的问题，落盘只剩一句 label，卡片退化成
    #   一个纯文本框。不报错、不告警，看着就是"AI 只会问一句大白话"。
    reason: Optional[str] = None
    waivedBy: Optional[str] = None
    waivedReason: Optional[str] = None
    clarifyType: Optional[Literal["free_text", "single_choice", "multi_choice"]] = None
    options: Optional[List[str]] = None
    defaultAnswer: Optional[str] = None
    context: Optional[str] = None
    questionId: Optional[str] = None
    clarifyKind: Optional[str] = None
    # 事件自带的人话。有它前端不许再翻译 clarifyKind。
    # ⚠ 2026-08-31：只写 SSE、缺口上不留，刷新后卡片又回去查本地表。
    kindLabel: Optional[str] = None
    # 用户答的原话。resolve 时写在缺口上，生成侧照原样带进提示词
    # （见 services/turn_context.clarification_prompt_block）——只关不留答案的话，
    # 澄清就白问了：闸是绿了，模型什么也没多知道。
    #
    # ⚠ 2026-08-29：上面这句"生成侧照原样带进提示词"在这一天之前**是不成立的**。
    #   那个块当时只被 `v5_llm_generate._build_user_content` 读，而那是 spec-first
    #   失败时的回落生成器——正常一轮根本不跑它。也就是说：卡片答完、缺口关掉、
    #   闸变绿，而生成侧一个字都没看到，跟"只关不留答案"是同一个结果。
    #   现在 `spec_tree.build_spec_prompt` 跟宪章/连接器一样拼它，
    #   判据 tests/test_turn_blocks_reach_the_live_chain.py 盯着这条链。
    answer: Optional[str] = None

class CoverageContract(BaseModel):
    id: str
    version: int = 1
    mode: Literal["simple", "complex"] = "complex"
    requiredCapabilities: List[str]
    minEvidencePerRequirement: int = 1
    blockingGapIds: List[str] = []

# V5.1 ledger models for sliderule-python-v52-state-ledgers-105 (PYTHON_AUTHORITY slice)
# These enable Python to persist/validate the decision/cost/flow/structure ledger state.
# Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
# This slice is now PYTHON_AUTHORITY; no Node fallback; direct Python models + V5SessionState fields.
class SchedulingDecision(BaseModel):
    """V5.1 DLEDGER (P1/A): auditable record of each pickNextCapabilities decision."""
    id: str
    turnId: str
    saw: List[str] = Field(default_factory=list)
    chose: List[str] = Field(default_factory=list)
    skipped: List[Dict[str, Any]] = Field(default_factory=list)
    addresses: List[str] = Field(default_factory=list)
    rationale: str = ""
    alternativesRejected: List[str] = Field(default_factory=list)
    createdAt: str
    status: Optional[Literal["active", "challenged", "superseded"]] = None
    challengedAt: Optional[str] = None
    challengeText: Optional[str] = None
    source: Optional[Literal["llm", "heuristic_fallback", "local_heuristic"]] = None
    droppedFromProposal: List[Dict[str, Any]] = Field(default_factory=list)

class FlowBoundaryCheck(BaseModel):
    """V5.1 FLOWB (Knife 4): Flow Boundary check record for formal path purification."""
    id: str
    turnId: str
    source: Literal["brainstorm", "discussion", "artifact", "executor"]
    strippedProtocolNodes: List[str] = Field(default_factory=list)
    assertions: List[str] = Field(default_factory=list)
    passed: bool
    createdAt: str

class StructureGateCheck(BaseModel):
    """S13/S14: G_SCHEMA / G_INV results persisted for structure.decompose (T_LEDGER)."""
    id: str
    turnId: str
    runId: str
    gateId: str
    attempt: Optional[int] = None
    status: Literal["passed", "failed"]
    reason: Optional[str] = None
    createdAt: str

class CapabilityCostRecord(BaseModel):
    """V5.1 Knife 6: Cost telemetry record for a capability run (estimated)."""
    id: str
    turnId: str
    capabilityRunId: str
    capabilityId: str
    estimatedTokens: Optional[int] = None
    estimatedCostUsd: Optional[float] = None
    durationMs: Optional[int] = None
    source: Literal["estimated", "server", "manual"]
    createdAt: str


# sessionReplayLog / reasoningEvents slice (sliderule-python-v52-state-replay-events-105):
# Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
# This slice is now PYTHON_AUTHORITY. Python owns the durable V5.2 replay and reasoningEvents schemas.
# List defaults + optional fields ensure pre-existing saved sessions missing these keys load with [] (legacy compat, no Node fallback hiding semantics).
class SlideRuleReplayEvent(BaseModel):
    """V5 append-only replay log entry (JOB->REPLAY->STORE per sessionId)."""
    id: str
    sessionId: str
    at: str
    kind: Literal["capability_run", "conversation", "decision"]
    turnId: Optional[str] = None
    capabilityId: Optional[str] = None
    capabilityRunId: Optional[str] = None
    conversationId: Optional[str] = None
    decisionId: Optional[str] = None


class ReasoningEventMeta(BaseModel):
    """Minimal meta for reasoning projection events (convergence etc)."""
    convergenceScore: Optional[float] = None
    consensusReached: Optional[bool] = None
    dissent: Optional[List[Dict[str, Any]]] = None
    toolName: Optional[str] = None
    sourceTag: Optional[str] = None


class ReasoningEvent(BaseModel):
    """V5 reasoning execution events inside a capabilityRun (optional, for UI projection; truncatable, backward compat)."""
    id: str
    turnId: str
    capabilityRunId: str
    capabilityId: str
    kind: Literal["capability_start", "think", "observe", "tool_call", "role_position", "role_critique", "role_rebuttal", "panel_converge", "subtask", "capability_complete"]
    roleId: Optional[str] = None
    targetRoleId: Optional[str] = None
    text: str
    refs: Optional[List[str]] = None
    meta: Optional[ReasoningEventMeta] = None
    order: int
    ts: str


class UserIntervention(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts UserIntervention for durable V5.2 session state (intervention, challenge etc)."""
    targetArtifactId: Optional[str] = None
    targetNodeId: Optional[str] = None
    targetReportSectionId: Optional[str] = None
    targetDecisionId: Optional[str] = None
    intent: Literal["challenge", "clarify", "expand", "synthesize", "generate_plan", "preview", "compare", "revise"]
    text: str
    answeredGapIds: List[str] = Field(default_factory=list)


class V5SessionState(BaseModel):
    """Core state for V5 full-path (orchestrate, coverage, artifacts, runs).
    Aligned to shared/blueprint/v5-reasoning-state.ts V5SessionState core fields.

    Classification for sliderule-python-v52-state-ts-parity-golden-105 (sequence 8/72, StateSchema):
    TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (prior field slices) -> PYTHON_AUTHORITY
    This task adds the complete durable V5.2 session fields + golden fixtures proving schema parity for persisted durable sessions.
    Python owns the durable session state shape (all listed TS V5SessionState durable fields including intervention, focus, flags); direct tests use golden fixtures.
    No Node fallback hiding semantics. This advances Python state authority for V5.2 durable sessions.
    """
    sessionId: str
    goal: Dict[str, Any]
    # 归属（2026-08-06）。None = 无主：匿名建的，或者这个字段存在之前的存量会话。
    #
    # 为什么放进 state 而不是只放数据库列：payload 是唯一真相，列是可查询的投影
    # ——跟 generated_app 一个路子（那张表既有 model_json 也有 goal/product_name
    # 这些反范式列）。四个存储后端（SQL / NeonHttp / HttpApi / 文件）里只有
    # 建表和 save 需要知道这个字段，读路径完全不用改；文件后端也天然跟着走。
    #
    # 语义与判定在 services/app_access.py，与应用共用同一套阶梯——不新写一套。
    ownerId: Optional[str] = None
    # Project source/operations live in the project store. These are references,
    # never a client-writable replacement for the stored project or its evidence.
    # Older sessions keep their original HTML runtime on decode.
    runtimeKind: Literal["html-prototype", "project"] = "html-prototype"
    projectId: Optional[str] = None
    projectRevision: Optional[str] = None
    artifacts: List[Artifact] = []
    capabilityRuns: List[CapabilityRun] = []
    coverageGaps: List[CoverageGap] = []
    coverageContract: Optional[CoverageContract] = None
    coverageGate: Optional[Dict[str, Any]] = None
    graph: Dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})
    # staleArtifactIds / supersededArtifactIds slice (sliderule-python-v52-state-stale-superseded-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # staleArtifactIds: marked by invalidation engine (trust cascade / re-entry). Required list.
    # supersededArtifactIds: superseded by round digests (M6); separate from stale per spec; for context compression in marathon, not trust cascade. Optional in TS, defaults [] for legacy.
    # Python owns both fields with direct model; list defaults ensure roundtrip + legacy missing-key compat. No Node fallback hiding semantics.
    staleArtifactIds: List[str] = []
    supersededArtifactIds: List[str] = Field(default_factory=list)
    conversation: List[Dict[str, Any]] = []
    # M1 控制面停泊记录。cheap 回合只写这里，禁止把问候/inspect/search 追加进
    # conversation。老会话缺这个字段时读成 []。FORBIDDEN 复用 ready / user_input / confirm。
    controlTranscript: List[Dict[str, Any]] = Field(default_factory=list)
    # TS core fields for this task (PYTHON_AUTHORITY):
    openQuestions: List[Dict[str, Any]] = Field(default_factory=list)
    evidence: List[Dict[str, Any]] = Field(default_factory=list)
    decisions: List[Dict[str, Any]] = Field(default_factory=list)
    risks: List[Dict[str, Any]] = Field(default_factory=list)
    gates: List[GateState] = Field(default_factory=list)
    dependencyGraph: List[DependencyEdge] = Field(default_factory=list)
    # runtimePhase / await / delivery / role slice (sliderule-python-v52-state-runtime-phase-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # This slice is now PYTHON_AUTHORITY for V5.2 state schema (runtime/await/delivery/role fields).
    # Python owns durable state; safe legacy defaults (None) preserve roundtrip for pre-V5.2 states.
    # No Node fallback hiding semantics.
    runtimePhase: Optional[Literal["idle", "orchestrating", "awaiting", "failed", "done"]] = None
    awaitReason: Optional[AwaitReason] = None
    awaitDetail: Optional[str] = None
    lastTurnId: Optional[str] = None
    deliveryPhase: Optional[Literal["none", "shipping", "shipped"]] = None
    roleMode: Optional[Literal["simple", "complex", "degraded"]] = None
    # V5.1 ledgers slice (sliderule-python-v52-state-ledgers-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # decisionLedger, costLedger, flowBoundaryLedger, structureGateLedger now PYTHON_AUTHORITY.
    # List defaults ensure persistence roundtrip for pre-ledger states; explicit models for validation.
    # No Node fallback hiding V5.2 ledger semantics.
    decisionLedger: List[SchedulingDecision] = Field(default_factory=list)
    costLedger: List[CapabilityCostRecord] = Field(default_factory=list)
    flowBoundaryLedger: List[FlowBoundaryCheck] = Field(default_factory=list)
    structureGateLedger: List[StructureGateCheck] = Field(default_factory=list)
    # sessionReplayLog / reasoningEvents slice (sliderule-python-v52-state-replay-events-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # Python owns durable state for replay log and reasoning events; list defaults for legacy saved sessions missing the keys.
    # No Node fallback; explicit minimal models for schema validation and roundtrips.
    sessionReplayLog: List[SlideRuleReplayEvent] = Field(default_factory=list)
    reasoningEvents: List[ReasoningEvent] = Field(default_factory=list)
    # E13 直播时间线持久化：最近几轮左栏叙述步骤（纯展示数据，无信任语义）。
    # 2026-08-18 起由驱动器轮末写（旁路 drive / 刷新才看得到步骤）；
    # 客户端 PUT 仍可覆盖同轮更细的直播芯片。封顶与 drive 共用
    # services.turn_narration.cap_turn_narrations。
    turnNarrations: List[Dict[str, Any]] = Field(default_factory=list)
    # additional durable V5.2 session fields (currentFocus, userIntervention, booleans, dirty) for full schema parity (sliderule-python-v52-state-ts-parity-golden-105)
    currentFocus: Optional[Dict[str, Any]] = None
    userIntervention: Optional[UserIntervention] = None
    brainstormDegraded: bool = False
    escalated: bool = False
    projectionDirtyNodeIds: List[str] = Field(default_factory=list)
    # publishClosure (AppBundle runtime/publish closure evidence projection from python /drive-full and /drive-marathon):
    # Frontend SlideRule session state persistence (119): declared as optional so store load/save roundtrips carry it.
    # Attached on drive response (client adapter or python route), preserved here.
    # Legacy sessions without key load with None (fail-closed compat, no breakage).
    # Pure schema + pass-through; derive logic stays in v5_publish_closure_response; no network/provider/DB here.
    publishClosure: Optional[Dict[str, Any]] = None
    # E29 模型版本史（前进/回退按钮数据源）：每次五系统模型真实变化追加一条
    # {id, turnId, instruction, createdAt, model}，上限 20 版。
    modelVersions: List[Dict[str, Any]] = Field(default_factory=list)
    # 当前生效版本指针（前进/回退移动它；精修追加新版本并指向之）
    currentModelVersionId: Optional[str] = None
    # skillRuntimeGraph (cross-skill runtime evidence graph from python /drive-full and /drive-marathon):
    # Kept durable alongside publishClosure so browser reload can replay Skill linkage surfaces.
    skillRuntimeGraph: Optional[Dict[str, Any]] = None
    # spec-first 链路产出的整页 HTML（2026-08-14）：
    # {version, pages: {pageId: html}, navItems: [...], boundPages: int,
    #  pageBindStatus: {pageId: bound|failed|skipped}}
    #
    # ## 为什么必须落到状态里，而不是只走 SSE
    #
    # 此前主轴只取 run_spec_first(...)["model"]，**res["pages"] 整个扔掉**。
    # 结果是：推演**过程中**右侧能看到新链路的 HTML（spec_page 事件），
    # 一跑完就换回老 ENRICH 区块路径——用户原话「最后执行完，我发现变成
    # 老链路了」。花了 18 分钟画出来的五页，交付那一刻蒸发。
    #
    # 位置照 skillRuntimeGraph 的先例（它的注释写得很清楚：durable 是为了
    # 刷新之后还能重放）。只走 SSE 的话，关掉页面再进来就什么都没有了。
    specFirstPages: Optional[Dict[str, Any]] = None
    # 产品宪章（2026-08-27）：行业/术语/角色/合规/品牌。约束不是证据。
    # 只在 charterReuseNext / payload.reuseCharter 为真时注入 spec-first。
    # 缺省 None/False：老会话 roundtrip 行为不变，也不会自动沿用上一场模型。
    productCharter: Optional[Dict[str, Any]] = None
    charterReuseNext: bool = False
    # 本轮运行的降级状况（services/run_degradation.py 写、闭环判定读）。
    # 结构照 Kubernetes metav1.Condition：{type,status,reason,message,lastTransitionTime}。
    # 存在降级条目时闭环不许判 closed——降级轮的产出不可信，详见该模块头。
    runConditions: List[Dict[str, Any]] = Field(default_factory=list)
    # 能力粒度 pendingWrites（PR-8 / M14，抄 LangGraph 图纸不搬框架）。
    #
    # ⚠ 2026-07-15 OSS 就写了「一轮 5 能力挂在第 4 个 = 整轮重跑，前 3 个
    # LLM 白烧」；到 2026-08-27 代码里仍只有一份最新快照。crash recovery
    # 读这份台账跳过已完成能力。不是挑战级局部重跑 UI——只是持久化地基。
    pendingRuns: Optional[Dict[str, Any]] = None
    # 工厂待办（2026-09-04 阶段 1）：模型从首轮链上摘掉的公开工具。
    # 服务端拥有，客户端只读——所有权写法照 pendingRuns（PUT pop + exclude，
    # persist 见 None 才 restore，[] 是驱动器清账）。
    # 摘了进待办，账不清空就不算首轮做完；闭环读它，非空不许发合格证。
    factoryTodo: Optional[List[str]] = None
    # 老师傅自己列的活儿清单（2026-09-09，抄 grok todo_write）。
    # 服务端拥有、客户端只读——所有权写法照 factoryTodo / pendingRuns
    # 三处齐备：PUT pop + model_dump exclude + persist 见 None 才 restore。
    # ⚠ 跟上面那个 factoryTodo **不是一回事**：那个是闭集五件套的待办账、
    #   闭环读它 fail-closed；这个是模型自己写的自由清单，不参与任何判定。
    #   合并了就会出现「模型把 closure 划掉，闭环就放行」（§7 伪造绿灯）。
    controlTodo: Optional[List[Dict[str, Any]]] = None
    # 本会话已经成功打开过的技能正文。批准计划后新回合如果商店目录
    # 空了，仍按这里加载——真机 13ME64TF8Z skill_not_found。
    controlSkillCache: Optional[List[Dict[str, Any]]] = None
    # 只读子代理账本（2026-09-04 阶段 3）。服务端拥有，客户端只读。
    # 失败 fail-open：error 记在条目上，不改主链路结论。
    subagentTasks: Optional[List[Dict[str, Any]]] = None
    # 「一直在读、一次没写」的**跨回合**账（2026-09-14）。服务端拥有，客户端只读。
    #
    # ⚠ 为什么必须跨回合：这道闸第一版做成回合级游标，真机上**一次都没响**。
    #   量下来每个回合最多攒到 3 轮只读就收尾了，而阈值 4 —— 差的那一轮每次
    #   都差。降到 3 又正好撞上正当流程（排查失败命令本来就要 status→logs→read
    #   三轮）。3 太急、4 够不着 = **这根轴选错了**，不是数字的问题。
    #
    #   病态是「这个目标一路读下来从没落地过」（真机 14 次 project_read、
    #   0 次 patch），那是目标级属性。同 `MAX_CONTINUATIONS` 的理由——
    #   `control_goal_continuation` 头注写着「单轮预算每次续跑都会重置，
    #   所以拦不住无限续跑」，一模一样的形状。
    #
    #   形状：{"rounds": int, "nudgedAt": int}。任何一次写工具清零。
    controlReadOnly: Optional[Dict[str, Any]] = None
    # ... (add more fields as migrated from TS)

    @classmethod
    def server_load(cls, data: Any) -> "V5SessionState":
        """Server-only reload path for durable V5SessionState from persisted storage (PYTHON_AUTHORITY ownership).
        Persisted state may legitimately contain Artifacts with trustLevel=gated_pass/audited (server produced after gates).
        Uses model_validate with server_trusted context so child Artifact validators permit elevated trust.
        Normal V5SessionState(**client_dict) or model_validate(client) without context will run strict Artifact validation
        and reject any attempt to forge elevated trust artifacts from input.
        This provides the durable state server reload path required for roundtrip/behavior ownership without mixing client
        forgery protection and server persistence load.
        """
        if isinstance(data, dict):
            return cls.model_validate(data, context={"server_trusted": True})
        # fallback
        return cls.model_validate(data, context={"server_trusted": True})

class ExecuteCapabilityResult(BaseModel):
    title: str
    summary: str
    content: str
    provenance: str = "python-rag"
    degraded: bool = False
    degradedReason: Optional[str] = None
    sources: List[Dict[str, Any]] = []
    toolName: Optional[str] = None
    skillName: Optional[str] = None

class PlanProjectionPhase(BaseModel):
    id: str
    label: str
    status: Literal["pending", "active", "complete", "blocked"]
    stepIds: List[str] = []

class PlanProjectionStep(BaseModel):
    id: str
    capabilityId: str
    roleId: str
    status: Literal["pending", "running", "complete", "blocked"] = "pending"
    phaseId: str
    why: Optional[str] = None

class PlanProjectionRisk(BaseModel):
    id: str
    severity: Literal["low", "medium", "high"]
    summary: str
    mitigation: str

class PlanProjectionRecoveryPoint(BaseModel):
    id: str
    label: str
    action: str
    retryable: bool = True

class PlanProjectionError(BaseModel):
    code: str
    reason: str
    message: str

class PlanStateProjection(BaseModel):
    kind: Literal["orchestrate.plan.state_projection"] = "orchestrate.plan.state_projection"
    schemaVersion: int = 1
    stateAuthority: Literal["node"] = "node"
    stateMutation: Literal["none"] = "none"
    status: Literal["partial", "complete", "error"]
    phase: str
    partial: bool
    phases: List[PlanProjectionPhase]
    steps: List[PlanProjectionStep]
    risks: List[PlanProjectionRisk]
    recoveryPoints: List[PlanProjectionRecoveryPoint]
    error: Optional[PlanProjectionError] = None

class OrchestratePlanResult(BaseModel):
    selected: List[Dict[str, Any]]
    rationale: str
    source: str = "python-rag"
    converged: Optional[bool] = None
    usage: Optional[Dict[str, Any]] = None
    planStateProjection: Optional[PlanStateProjection] = None
