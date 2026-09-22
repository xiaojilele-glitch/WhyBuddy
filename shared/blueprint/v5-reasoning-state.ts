/**
 * V5 Reasoning State & Artifact contracts (能力池定型版).
 *
 * 这些类型将 "目标驱动的能力调用网络" 正式定型为可实现的运行时模型。
 * 核心修复：信任层（gate + provenance + ledger）进入运行时 schema；
 * 失效引擎升为一等公民（写进 orchestrateReasoningTurn 主循环）；
 * 调度单元明确为 (capability, role) 对。
 *
 * 详见 docs/SlideRuleV5CapabilityPool.md 和 docs/SlideRuleV5闭环总图_完整版.md
 */

import type { V5CapabilityId } from "./contracts.js";
import type { ReasoningEvent } from "./sliderule-reasoning-events.js";
import type { BrainstormReasoningGraph } from "./brainstorm-reasoning-graph.js";
import type { SlideRuleReplayEvent } from "./sliderule-session-replay.js";
import type { Project } from "../project-runtime.generated.js";

export type { V5CapabilityId };

/** P0: first-class human-wait signals surfaced on STATUS (not LLM self-confirm). */
export type AwaitReason =
  | "ready"
  | "confirm"
  | "coverage"
  | "budget"
  | "convergence"
  | "user_input"
  | "max_loops"
  | "max_repeat_guard"
  | "no_progress"
  | "closure_blocked"
  | "closure_missing"
  | "control_ask"
  | "control_scope"
  | "control_plan_approval"
  /** 控制面澄清停靠。缺它会让停在澄清的会话读不回来，见 models/v5_state.py 同名注释。 */
  | "control_clarify"
  /** 马拉松内层驱动失败停靠（slide_rule_marathon.py）。同上，缺它会连失败取证一起丢。 */
  | "error";

export interface Artifact {
  id: string;
  kind:
    | "clarification"
    | "route_options"
    | "spec_tree"
    | "doc"
    | "preview"
    | "evidence"
    | "risk"
    | "decision"
    | "synthesis"
    | "report"
    | "plan";
  /** 三级 provenance，与 v4/v5 护城河对齐 */
  provenance:
    | "ai_generated"
    | "rendered_chart_mcp"
    | "rendered_screenshot"
    | "llm"
    | "llm_fallback"
    | "template";
  /** 只有 gated_pass / audited 才能被报告引用为“已证明” */
  trustLevel: "untrusted" | "gated_pass" | "audited";
  producedBy: {
    capabilityRunId: string;
    capabilityId: V5CapabilityId;
    roleId?: string;
  };
  passedGates: string[];
  evidenceRefs?: string[];
  /** V5: 真实内容片段，用于 report/synthesis 聚合展示（从上游 artifact 抽取结论/证据/反证） */
  title?: string;
  summary?: string;
  content?: string;
  /** R2: optional structured executor output (e.g. Critique[]); Trust Gate must not read this field. */
  payload?: unknown;
}

export interface GateState {
  gateId:
    | "schema"
    | "invariant"
    | "confirm"
    | "decision"
    | "merge"
    | "previews_real"
    // Actual values written by commitArtifact / evaluateGates (Trust Layer)
    | "precondition"
    | "ground"
    | "commit"
    // S19 ship-time only (phase: "ship")
    | "T_CONTENT"
    | "T_TEST"
    | "T_MERGE";
  kind: "precondition" | "commit"; // 运行前置闸 or 产物提交闸
  status: "open" | "passed" | "failed";
  evaluatedAt?: string;
  /** P5 dual-speed: commit-time vs ship-time gate evaluation. */
  phase?: "commit" | "ship";
}

export interface CapabilityRun {
  id: string;
  capabilityId: V5CapabilityId;
  roleId?: string; // (capability, role) 对
  inputs: string[]; // 依赖的 artifactId
  outputs: string[]; // 产出的 artifactId
  gateResults: Array<{
    gateId: string;
    status: "passed" | "failed";
    /** Optional richer audit info for Flow phase projection (ground/commit etc). Writers may populate. */
    reason?: string;
    checkedArtifactIds?: string[];
    evidenceRefs?: string[];
    detail?: string;
  }>;
  ledgerEntryId?: string; // 台账留痕
  turnId: string;
  /** Task goal alignment: result, timing, error for full contract (Python authority owns durable shape). */
  result?: unknown;
  timing?: { startedAt?: string; completedAt?: string; durationMs?: number };
  error?: { code?: string; message?: string; detail?: unknown };
  /**
   * 2026-09-06 台账三格。抄 grok `ToolCallCompleted`
   * （xai-tool-protocol/src/session_event.rs）：结局 + 耗时 + 谁写的，一次执行
   * 该说的话一次说完。
   *
   * 此前台账**说不出结局**：只有 `error`（有值=失败），于是"成功"和"没人填
   * error"长得一模一样。
   *
   * ⚠ 三个都是可选的，因为这是**持久化记录**：库里已有的记录都没有它们，
   *   写成必填会让老会话读不回来。"必填"落在 Python 写路径
   *   （`CapabilityRun.server_record(...)` 三个参数 keyword-only 无默认值），
   *   见 models/v5_state.py 里那段。
   *
   * `unknown` 对应 grok 的 `#[serde(other)] Unknown`：旧记录和占位记录
   * **如实说不知道**，不许被编成 success。
   */
  status?: "success" | "error" | "cancelled" | "unknown";
  /** 顶层耗时。`timing.durationMs` 保留给老读者，两处由 server_record 对齐。 */
  durationMs?: number;
  /** 这条台账是哪条代码路径写的。申报制——自由字符串半年后会有七种拼法。 */
  provenance?:
    | "scheduling.error"
    | "scheduling.commit"
    | "executor.run"
    | "trust.ledger_stub"
    | "route.execute_capability"
    | "route.execute_capability_native_llm"
    | "test.fixture";
}

export interface DependencyEdge {
  fromArtifactId: string;
  toArtifactId: string;
  reason: string;
}

export interface V5SessionState {
  /** Server-owned references. Source revisions and evidence live in the project store. */
  runtimeKind?: "html-prototype" | Project["runtimeKind"];
  projectId?: Project["projectId"] | null;
  projectRevision?: Project["currentRevision"] | null;
  goal: {
    text: string;
    status: "clear" | "needs_refinement" | "not_recommended";
    tools?: string[];
    /**
     * 本轮该亮哪几格。后端 `stage_legal.product_steps_for_stages` 按真跑的
     * stage 算好写进来（`rehearsal_control._set_goal_tools` 是唯一写入点）。
     * ⚠ 前端不许再从 tools 名字自己推——那张表 2026-09-02 已删。
     * 老会话没有这个字段：读不到就全开，不是画没。
     */
    productSteps?: number[];
    workflow?: string;
  };
  graph: BrainstormReasoningGraph; // capability invocation graph (strict)
  artifacts: Artifact[];
  conversation: Array<{ id: string; role: string; text: string; timestamp?: string }>;
  /** M1 控制面停泊记录。cheap 回合只写这里。老会话缺字段读成 []。 */
  controlTranscript?: Array<{
    id?: string;
    role: string;
    text?: string;
    kind?: string;
    timestamp?: string;
    /** Server-owned plan revision and its correlated approval request. */
    planContent?: string;
    planId?: string;
    revision?: number;
    reqId?: string;
    [key: string]: unknown;
  }>;
  openQuestions: Array<{ id: string; text: string }>;
  evidence: any[];
  decisions: any[];
  risks: any[];
  capabilityRuns: CapabilityRun[];
  /** V5 新增：闸进入运行时状态 */
  gates: GateState[];
  /** V5 新增：失效级联用 */
  dependencyGraph: DependencyEdge[];
  /** V5 新增：被失效引擎标记 */
  staleArtifactIds: string[];
  /** M6: superseded by round digests (separate from stale per spec; for context compression in marathon, not trust cascade) */
  supersededArtifactIds?: string[];
  currentFocus?: { nodeId?: string; artifactId?: string };
  userIntervention?: UserIntervention;

  /** V5 闭环修复（单门 INTAKE + AWAIT 歇脚点 + 按 sessionId 隔离） */
  sessionId?: string;
  runtimePhase?: "idle" | "orchestrating" | "awaiting" | "failed" | "done";
  /** S19 ship-time: none → shipping → shipped (after T_MERGE). */
  deliveryPhase?: "none" | "shipping" | "shipped";
  /** P6 ROLES: simple | complex | degraded (D_GATE). */
  roleMode?: "simple" | "complex" | "degraded";
  /** P6 S17: brainstorm timeout/failure → single-agent fallback. */
  brainstormDegraded?: boolean;
  /** P4 ESC: budget block + unsatisfiable GCOV → human handoff. */
  escalated?: boolean;
  /** P3 incremental derive: node ids needing status recompute. */
  projectionDirtyNodeIds?: string[];
  /** S21 edge 117: append-only replay log (JOB→REPLAY→STORE, per sessionId). */
  sessionReplayLog?: SlideRuleReplayEvent[];
  /** E13 直播时间线持久化：最近几轮的左栏叙述步骤（纯展示数据，无信任
   *  语义）。驱动器轮末写入会话 blob；客户端 PUT 可覆盖同轮更细的直播
   *  芯片。封顶在 Python 侧强制（最近 3 轮 × 每轮限步数/字数）。 */
  turnNarrations?: Array<{
    turnId: string;
    user?: string;
    steps: unknown[];
    durationMs?: number;
  }>;
  /**
   * E29 模型版本史（前进/回退按钮的数据源）与当前生效版本指针。
   *
   * ⚠ 2026-09-13：跟 `specFirstPages` 同一笔欠账——Python 侧
   * `v5_state.py` 一直有 `modelVersions` / `currentModelVersionId`，TS 这边
   * 一直没声明。`previousModelVersionId(preparedState)` 于是报 TS2559
   * 「两个类型没有任何共同属性」，而那正是回退按钮真在走的调用点。
   */
  modelVersions?: Array<{
    id?: string;
    turnId?: string;
    instruction?: string;
    createdAt?: string;
    model?: unknown;
    [key: string]: unknown;
  }>;
  currentModelVersionId?: string | null;
  /**
   * spec-first 工厂的展示投影（规格 / 逐页产物 / 质检提示）。
   *
   * ⚠ 2026-09-13：Python 侧 `v5_state.py:specFirstPages` 一直有，**TS 这边
   * 一直没有** —— 正是 §4 点名的「Python 判定 / TypeScript 运行时」成对物只
   * 写了一半。后果不是报错而是各处就地 `as any` / 内联重声明（本文件搜
   * specFirstPages 能看到三四份形状不一的局部声明），而 `pnpm run check` 里
   * 留着三条 TS2339——CI 第一步就挂在这儿，后面的架构闸整个被 skip。
   *
   * Python 那边是 `Optional[Dict[str, Any]]`，所以这里保留索引签名是诚实的：
   * 已知字段写出来，其余不假装知道。
   */
  specFirstPages?: {
    spec?: unknown;
    pages?: unknown[] | Record<string, unknown>;
    qualityNotices?: Array<{ kind: string; text: string }>;
    [key: string]: unknown;
  };
  lastTurnId?: string;
  /**
   * 工厂待办（2026-09-04 阶段 1）。模型从首轮链上摘掉的公开工具。
   * 服务端拥有，客户端只读——PUT 不得写回。空 = 账已清。
   */
  factoryTodo?: string[];
  /**
   * 老师傅自己列的活儿清单（`todo_write` 写的）。服务端拥有，客户端只读。
   *
   * ⚠ 2026-09-14 补：Python 侧 2026-09-09 就有了，TS 镜像一直漏着
   *   （同 specFirstPages / modelVersions 那批的形态，§4）。
   *   后续建议 chips（`next-step-chips.ts`）读的就是它——没有类型的话
   *   只能靠 `as any` 硬读，那等于把这条断链继续藏着。
   */
  controlTodo?: Array<{ id?: string; status?: string; content?: string }>;
  /**
   * 「一直在读、一次没写」的**跨回合**账（2026-09-14）。服务端拥有，客户端只读。
   * 回合级游标在真机上一次没响（每回合最多 3 轮只读就收尾，阈值 4），
   * 详见 `models/v5_state.py` 上 controlReadOnly 的说明。
   */
  controlReadOnly?: { rounds?: number; nudgedAt?: number };
  /** 只读子代理账本。服务端拥有，客户端只读。 */
  subagentTasks?: Array<{
    id: string;
    type: string;
    status?: string;
    content?: string;
    error?: string;
  }>;
  /**
   * 本轮降级 Condition（K8s 形状）。服务端 `run_degradation` 写。
   * 阶段 2：AgenticPickFallback 必须上屏说人话，不许装成模型挑的。
   */
  runConditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    impact?: string;
    lastTransitionTime?: string;
  }>;
  /** P0: why the session is parked awaiting human input (distinct from trust-layer confirm gate). */
  awaitReason?: AwaitReason;
  awaitDetail?: string;

  /** V5.1 DLEDGER (P1/A): scheduling decision ledger, appended on every pickNextCapabilities (or special budget block entry). */
  decisionLedger?: SchedulingDecision[];

  /** V5.1 CONTRACT + GCOV (Knife 3): optional coverage contract and last gate result. Kept optional for durable old-state compat. */
  coverageContract?: CoverageContract;
  coverageGate?: CoverageGateResult;

  /** V5.1 FLOWB (Knife 4): optional ledger of boundary purifications for formal paths (report/synthesis). */
  flowBoundaryLedger?: FlowBoundaryCheck[];

  /** S13/S14: structure.decompose G_SCHEMA / G_INV gate checks (T_LEDGER). */
  structureGateLedger?: StructureGateCheck[];

  /** V5.1 Knife 6: optional cost telemetry ledger (v1: estimated tokens/duration per run). */
  costLedger?: CapabilityCostRecord[];

  /** V5.1 Knife 7: optional coverage gaps for gap lifecycle (resolved/waived) under authored CoverageContract. */
  coverageGaps?: CoverageGap[];

  /**
   * V5.3 #4: 执行事件流(投影源)。每条绑定 capabilityRunId,记录一次能力执行内的有序
   * 思考/动作步(think/observe/role_position/critique/converge/…)。可选、可截断、向后兼容。
   * 不参与机械裁决,纯投影/UI 消费。
   */
  reasoningEvents?: ReasoningEvent[];
}

export interface UserIntervention {
  targetArtifactId?: string;
  targetNodeId?: string;
  targetReportSectionId?: string;
  /** V5.1 Knife 5: allow challenging a specific SchedulingDecision from DLEDGER for re-entry / reconsideration. */
  targetDecisionId?: string;
  intent:
    | "challenge"
    | "clarify"
    | "expand"
    | "synthesize"
    | "generate_plan"
    | "preview"
    | "compare"
    | "revise";
  text: string;
  /** 澄清卡片回答：精确标记本次回答了哪些 open_question gap（按 gap id 精确 resolve，支持部分回答）。 */
  answeredGapIds?: string[];
  /**
   * 澄清卡片回答的**问答对**。
   *
   * ⚠ 跟上面那条是一件事的两半：id 用来关缺口，答案用来进生成提示词
   *   （services/v5_llm_generate.clarification_prompt_block 靠 gap.answer 取料）。
   *   只发 id 的话闸绿了而模型什么也没多知道——澄清白问。
   */
  answeredGaps?: Array<{ gapId: string; answer: string }>;
}

/**
 * orchestrateReasoningTurn 返回的计划（简化版，实际实现会更完整）。
 */
export interface PlannedCapability {
  capabilityId: V5CapabilityId;
  roleId?: string;
  inputArtifactIds: string[];
  expectedArtifactKind?: Artifact["kind"];
}

export interface TurnPlan {
  selected: PlannedCapability[];
  reason: string;
  expectedArtifacts: string[];
}

export interface OrchestrateContext {
  turnId: string;
  userText: string;
  intervention?: UserIntervention;
  /** R1: server-prefetched scheduling proposal. Absent → runtime uses local heuristic. */
  proposedPlan?: {
    selected: Array<{ capabilityId: V5CapabilityId; roleId: string }>;
    rationale: string;
    source: "llm" | "heuristic_fallback";
    /** Mechanical convergence from router (empty selected + converged true). */
    converged?: boolean;
  };
}

/** V5.1 DLEDGER (P1/A): auditable record of each pickNextCapabilities decision. */
export interface SchedulingDecision {
  id: string;
  turnId: string;
  saw: string[];
  chose: string[];
  skipped: Array<{ capabilityId: string; reason: string }>;
  addresses: string[];
  rationale: string;
  alternativesRejected: string[];
  createdAt: string;

  /** V5.1 Knife 5: decision-level challenge support (optional for durable compat). */
  status?: "active" | "challenged" | "superseded";
  challengedAt?: string;
  challengeText?: string;

  /** R1: scheduling proposal source (optional for durable compat). */
  source?: "llm" | "heuristic_fallback" | "local_heuristic";
  droppedFromProposal?: Array<{ capabilityId: string; reason: string }>;
}

/** V5.1 CONTRACT / GCOV (P1/A): Coverage contract authored for the session/goal to declare what is required before convergence (report/AWAIT) is allowed. Now supports authored/versioned/frozen baseline + blockingGapIds for gap lifecycle (Knife 7). */
export interface CoverageContract {
  id: string;
  version: 1;
  mode: "simple" | "complex";
  authoredBy: "system" | "user" | "imported";
  authoredAt: string;
  frozenAtTurnId?: string;
  requiredCapabilities: string[];
  conditionalCapabilities: string[];
  minEvidencePerRequirement: number;
  blockingGapIds: string[];
}

/** V5.1 GCOV gate result: mechanical check outcome before allowing report.write or AWAIT converge. */
export interface CoverageGateResult {
  passed: boolean;
  missingCapabilities: string[];
  unresolvedGaps: string[];
  waivedGaps: string[];
  reason: string;
}

/** V5.1 Knife 7: Coverage gap with lifecycle (open/resolved/waived). Used by authored CoverageContract baseline. */
export interface CoverageGap {
  id: string;
  kind: "missing_capability" | "missing_evidence" | "open_question" | "risk_unresolved";
  label: string;
  requiredCapabilityId?: string;
  status: "open" | "resolved" | "waived";
  reason?: string;
  resolvedByArtifactId?: string;
  waivedBy?: "user" | "system";
  waivedReason?: string;
  createdAt: string;
  updatedAt?: string;
  /**
   * 澄清问题卡片（G_READY）用：gap.ask 产出结构化候选选项时携带。
   * 字段词汇对齐 V4 `BlueprintClarificationQuestion`（type/options/defaultAnswer/context）。
   * 全可选 —— 缺省（或 clarifyType=free_text）时卡片退化为纯文本输入框（向后兼容旧的纯文本问题 gap）。
   */
  clarifyType?: "free_text" | "single_choice" | "multi_choice";
  options?: string[];
  defaultAnswer?: string;
  context?: string;
  questionId?: string;
  /** V4 alignment for clarification kind (e.g. "audience", "blueprint-question-xxx"); does not override the gap's 'kind' discriminant. */
  clarifyKind?: string;
  /** 事件自带的人话。有它前端不许再翻译 clarifyKind。 */
  kindLabel?: string;
  /**
   * 用户答的原话。
   *
   * ⚠ 只把缺口置 resolved、不留答案的话，澄清就是白问的：闸绿了，
   *   生成侧什么也没多知道。答案要原样进提示词
   *   （services/v5_llm_generate.clarification_prompt_block）。
   */
  answer?: string;
}

/** S13/S14 · G_SCHEMA / G_INV results persisted for structure.decompose (edges 88–89). */
export interface StructureGateCheck {
  id: string;
  turnId: string;
  runId: string;
  gateId: string;
  attempt?: number;
  status: "passed" | "failed";
  reason?: string;
  createdAt: string;
}

/** V5.1 FLOWB (Knife 4): Flow Boundary check record. Records purification of brainstorm/critique/rebuttal/debate protocol before formal artifact/report/synthesis content. v1 mechanical strip only. */
export interface FlowBoundaryCheck {
  id: string;
  turnId: string;
  source: "brainstorm" | "discussion" | "artifact" | "executor";
  strippedProtocolNodes: string[];
  assertions: string[];
  passed: boolean;
  createdAt: string;
}

/** V5.1 Knife 6: Cost telemetry record for a capability run (v1 estimated). */
export interface CapabilityCostRecord {
  id: string;
  turnId: string;
  capabilityRunId: string;
  capabilityId: string;
  estimatedTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  source: "estimated" | "server" | "manual";
  createdAt: string;
}

/**
 * Golden durable V5.2 session fixture (TS side) for sliderule-python-v52-state-ts-parity-golden-105.
 * Proves Python/TS schema parity: this shape (incl. currentFocus, userIntervention, new flags)
 * is accepted by the V5SessionState contract in blueprint (compile-time via satisfies).
 * Python test mirrors structure for authoritative golden; Vitest proves TS contract consumption (thin consumer).
 * Node/TS remains thin contract consumer; Python owns the durable state baseline.
 */
export const GOLDEN_DURABLE_V52_SESSION = {
  sessionId: "durable-golden-001",
  goal: { text: "Prove V5.2 durable state parity", status: "clear" },
  artifacts: [
    {
      id: "art-g1",
      kind: "evidence",
      content: "fact from python",
      trustLevel: "untrusted",
      passedGates: [],
      provenance: "llm",
      producedBy: {
        capabilityRunId: "run-g1",
        capabilityId: "evidence.search",
      },
    },
  ],
  capabilityRuns: [
    {
      id: "run-g1",
      capabilityId: "evidence.search",
      turnId: "t-g1",
      inputs: ["g0"],
      outputs: ["art-g1"],
      gateResults: [{ gateId: "ground", status: "passed" }],
      result: { ok: true },
      timing: { startedAt: "2026-07-02T00:00:00Z", completedAt: "2026-07-02T00:00:01Z", durationMs: 800 },
      roleId: "researcher",
      ledgerEntryId: "led-g1",
    },
  ],
  coverageGaps: [],
  graph: {
    id: "g-durable-001",
    jobId: "job-durable-g",
    stage: "spec_tree",
    source: "llm",
    nodes: [],
    edges: [],
  },
  staleArtifactIds: [],
  supersededArtifactIds: ["art-old-round"],
  conversation: [],
  openQuestions: [{ id: "q-g", text: "parity?" }],
  evidence: [{ id: "e-g", content: "gold" }],
  decisions: [{ id: "d-g", summary: "chose python" }],
  risks: [],
  gates: [{ gateId: "commit", kind: "commit", status: "passed" }],
  dependencyGraph: [],
  runtimePhase: "done",
  lastTurnId: "t-g1",
  deliveryPhase: "shipped",
  roleMode: "complex",
  decisionLedger: [],
  costLedger: [],
  flowBoundaryLedger: [],
  structureGateLedger: [],
  sessionReplayLog: [{ id: "rep-g", sessionId: "durable-golden-001", at: "2026-07-02T00:00:01Z", kind: "capability_run", turnId: "t-g1" }],
  reasoningEvents: [],
  currentFocus: { nodeId: "n1", artifactId: "art-g1" },
  userIntervention: { intent: "challenge", text: "why this?", targetDecisionId: "d-g" },
  brainstormDegraded: false,
  escalated: false,
  projectionDirtyNodeIds: [],
} satisfies V5SessionState;
