/**
 * Effect-preview scheduler — Stage C 调度模块
 * （`autopilot-image-rendering-and-visual-system` spec, task 5.1 + 5.2）。
 *
 * Stage C 出图流水线的第三步：把上游 spec / route 给出的
 * `dependencyOrder` 转换成一份「初始 progressPlan」，全部节点状态为
 * `"pending"`，并保持 `dependencyOrder` 的相对顺序。task 5.2 在同一
 * 文件追加 `markFailed` / `markCompleted` 不可变更新方法，由
 * `ImageService` 在节点 raster 调用前后调用，完成 Stage C 状态机闭环。
 *
 * 设计原则：
 *
 * - **确定性 / 纯函数**：`plan()` 不读 `Date.now()`、不调用
 *   `Math.random()`、不依赖任何模块级可变状态。同输入必同输出，便于
 *   property-based test 与回放比对（Property 5：scheduler topological
 *   ordering and per-node fault isolation）。
 * - **顺序保留**：输出 `progressPlan[i].nodeId === dependencyOrder[i]`，
 *   `i ∈ [0, dependencyOrder.length)`，长度严格等于输入数组长度
 *   （需求 4.1 + Property 5 第一条）。
 * - **状态最小集**：初始所有 entry `state === "pending"`；后续 5.2 会
 *   把 `running / completed / failed / text-only` 作为可达状态加入
 *   状态机（design §「EffectPreviewScheduler」中 `ProgressPlanState`
 *   联合）。
 * - **本地化实体**：design 文档把 progress plan 元素叫做
 *   `ProgressPlanEntry`，与 `shared/blueprint/contracts.ts` 中的
 *   `BlueprintEffectPreviewMilestone` 字段集互不相同（前者持
 *   `nodeId/state`，后者持 `id/title/summary/target/sourceDocumentIds`）。
 *   本模块以 design 为准导出 `ProgressPlanEntry`，并保留可选的
 *   `title / summary / sourceDocumentIds` 字段以便 `ImageService` 在已知
 *   人类可读元数据时一次性把它们注入到 progress plan 上，避免下游再做
 *   一次 join。
 * - **无 IO / 无外部依赖**：这条件让本模块可被 PBT 与上层
 *   `image-service.ts` 同时安全引用，且不会因此引入新的 fetch / env
 *   读取点。
 *
 * 该文件仅依赖 `shared/blueprint/contracts.ts` 中的 `FallbackTier`（task
 * 1.1 已加入），不允许引入 runtime / business import，与同目录
 * `prompt-template-library.ts`、`svg-architecture-drafter.ts` 的纯函数风格
 * 保持一致。
 *
 * _Requirements: 4.1, 4.2, 4.3_
 */

import type { FallbackTier } from "../../../../shared/blueprint/contracts.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Progress plan 条目可达状态。design §「EffectPreviewScheduler」联合：
 *
 * - `"pending"`  ── 初始状态，由 {@link EffectPreviewScheduler.plan} 写入。
 * - `"running"`  ── 节点正在向上游 image API 发起请求（task 5.2 写入）。
 * - `"completed"`── 节点已成功获得 raster 图像（task 5.2 `markCompleted`）。
 * - `"failed"`   ── 节点降级触发，配合非空 `fallbackTier`（task 5.2
 *   `markFailed`）。
 * - `"text-only"`── ImageService 退化为文本兜底视图后给当前节点写入；
 *   与 `BlueprintEffectPreview.textOnlyEffectPreview.active` 配合，定义
 *   见 design §「Error Handling」。
 */
export type ProgressPlanState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "text-only";

/**
 * Progress plan 单条条目。design §「Components and Interfaces ·
 * EffectPreviewScheduler」原始定义：
 *
 * ```ts
 * interface ProgressPlanEntry {
 *   nodeId: string;
 *   state: ProgressPlanState;
 *   startedAt?: string;
 *   endedAt?: string;
 *   fallbackTier?: FallbackTier;
 *   errorSummary?: string;
 * }
 * ```
 *
 * 本实现新增 3 个 *可选* 字段（`title` / `summary` /
 * `sourceDocumentIds`）以便 `ImageService` 在已知人类可读元数据时一次性
 * 注入，方便后续把 progress plan 投影成 `BlueprintEffectPreviewMilestone`
 * 视图（contracts.ts 中已有 `id / title / summary / target /
 * sourceDocumentIds` 五个字段）。所有新字段均为 optional，对既有
 * design 约束完全兼容（design 列出的字段全部保留、未引入语义破坏）。
 *
 * 字段全部 readonly，强制下游通过 task 5.2 的不可变更新方法改写状态。
 */
export interface ProgressPlanEntry {
  /** SPEC tree node id；保持与 `dependencyOrder[i]` 严格一致。 */
  readonly nodeId: string;
  /** 当前节点处理状态。`plan()` 写入 `"pending"`。 */
  readonly state: ProgressPlanState;
  /** 可选 — 节点显示标题；当 {@link SchedulerPlanInput.titles} 命中时填充。 */
  readonly title?: string;
  /** 可选 — 节点摘要；当 {@link SchedulerPlanInput.summaries} 命中时填充。 */
  readonly summary?: string;
  /**
   * 可选 — 节点关联的 spec 文档 id 数组；当
   * {@link SchedulerPlanInput.sourceDocumentIds} 命中时拷贝为只读快照。
   */
  readonly sourceDocumentIds?: ReadonlyArray<string>;
  /** 进入 raster 调用的起始时间（ISO8601）；task 5.2 写入。 */
  readonly startedAt?: string;
  /** 处理完成 / 失败时间（ISO8601）；task 5.2 写入。 */
  readonly endedAt?: string;
  /** 6 级降级层级；仅 `failed` / `text-only` 终态写入。 */
  readonly fallbackTier?: FallbackTier;
  /** 失败摘要；不含密钥或原始 prompt。 */
  readonly errorSummary?: string;
}

/**
 * `plan()` 输入。
 *
 * - `dependencyOrder` ── 由上游（spec tree / route planner）确定的拓扑
 *   顺序数组。`plan()` 输出的 progress plan 与该数组一一对应、顺序一致。
 *   允许出现重复 nodeId 也允许空数组（空数组 → 空 plan）。
 * - `titles` / `summaries` / `sourceDocumentIds` ── 可选的 nodeId →
 *   人类可读元数据映射。`plan()` 仅在命中时写入对应字段，缺失/未提供
 *   时该字段保持 undefined（保证「不给元数据 → 输出仍然确定」的纯函数
 *   性质）。
 *
 * 注意：`SchedulerPlanInput` 不包含时钟 / `now` 注入，因为初始状态全部
 * 为 `"pending"`，没有时间戳要写入；时间戳是 task 5.2 `markFailed` /
 * `markCompleted` 的职责，将通过独立的 clock 注入（design 提到的
 * 注入式 clock）传入。
 */
export interface SchedulerPlanInput {
  readonly dependencyOrder: ReadonlyArray<string>;
  readonly titles?: ReadonlyMap<string, string>;
  readonly summaries?: ReadonlyMap<string, string>;
  readonly sourceDocumentIds?: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * Stage C 调度器接口。task 5.1 暴露 {@link plan}；task 5.2 追加
 * {@link markFailed} 与 {@link markCompleted} 两个不可变更新方法，复用
 * 同一份 {@link ProgressPlanEntry} / {@link FallbackTier} 类型组成 Stage C
 * 状态机闭环。
 */
export interface EffectPreviewScheduler {
  /**
   * 把 `dependencyOrder` 转换为初始 progress plan。所有 entry 状态写
   * 为 `"pending"`，顺序与输入数组保持一致。
   *
   * 该方法是纯函数，不读时钟、不读 env、不发起 IO。返回的数组与单条
   * entry 都为只读字面量；调用方对返回值进行的任何变异都不会影响
   * scheduler 内部状态（scheduler 也没有内部状态）。
   *
   * _Requirements: 4.1_
   */
  plan(input: SchedulerPlanInput): ReadonlyArray<ProgressPlanEntry>;

  /**
   * 不可变标记单个节点为 `"failed"`，写入 `fallbackTier` / `errorSummary`
   * 与 `endedAt`（ISO8601，由注入的 clock 提供）。其他节点的 entry 引用
   * 与状态保持不变 ── 单点失败不影响其它节点的 state（需求 4.2）。
   *
   * 当 `nodeId` 不在 `plan` 中时，返回原始数组引用（即 `plan` 本身），
   * 表示无变更；不抛错。这与 design「Per-node fault isolation」一致：
   * 失败标记是单点局部更新，不应因找不到节点而影响其它节点的处理流程。
   *
   * _Requirements: 4.2, 4.3_
   */
  markFailed(
    plan: ReadonlyArray<ProgressPlanEntry>,
    nodeId: string,
    tier: FallbackTier,
    summary: string,
  ): ReadonlyArray<ProgressPlanEntry>;

  /**
   * 不可变标记单个节点为 `"completed"`，写入 `endedAt`（ISO8601，由
   * 注入的 clock 提供）。其他节点 entry 引用与状态保持不变。
   *
   * 当 `nodeId` 不在 `plan` 中时，返回原始数组引用（即 `plan` 本身），
   * 表示无变更；不抛错（与 {@link markFailed} 同一约束）。
   *
   * 实现策略：保守地仅写入文档化字段（`state` / `endedAt`），其它字段
   * （包括上一轮可能存在的 `fallbackTier` / `errorSummary` / `startedAt`
   * / `title` / `summary` / `sourceDocumentIds`）原样保留，避免在状态
   * 切换时丢失上游已注入的人类可读元数据。
   *
   * _Requirements: 4.2, 4.3_
   */
  markCompleted(
    plan: ReadonlyArray<ProgressPlanEntry>,
    nodeId: string,
  ): ReadonlyArray<ProgressPlanEntry>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * 把 nodeId → 元数据映射的 `get(nodeId)` 结果归一化：
 *
 * - 字符串字段：`undefined` 直接保留为 `undefined`，命中则原样返回。
 * - 数组字段：`undefined` 保留为 `undefined`，命中则浅拷贝为一份新的
 *   `ReadonlyArray<string>`，避免调用方持有的可变数组泄漏到返回值里。
 *
 * 不读时钟、不抛错。
 */
function lookupOptionalString(
  map: ReadonlyMap<string, string> | undefined,
  nodeId: string,
): string | undefined {
  if (!map) {
    return undefined;
  }
  return map.get(nodeId);
}

function lookupOptionalSourceDocumentIds(
  map: ReadonlyMap<string, ReadonlyArray<string>> | undefined,
  nodeId: string,
): ReadonlyArray<string> | undefined {
  if (!map) {
    return undefined;
  }
  const value = map.get(nodeId);
  if (!value) {
    return undefined;
  }
  // 浅拷贝 + Object.freeze：返回的数组对调用方为只读，且不与输入 map 中
  // 的引用共享。这样即使调用方在 `plan()` 之后改了原数组，progress plan
  // 也不会被污染，与「确定性」属性兼容。
  return Object.freeze(value.slice());
}

/**
 * 构造单条 `ProgressPlanEntry`。仅在元数据命中时写入对应字段，缺失则
 * 保持 undefined，避免在序列化结果里出现 `"title": undefined` 之类的
 * 噪声字段。
 */
function buildPendingEntry(
  nodeId: string,
  input: SchedulerPlanInput,
): ProgressPlanEntry {
  const title = lookupOptionalString(input.titles, nodeId);
  const summary = lookupOptionalString(input.summaries, nodeId);
  const sourceDocumentIds = lookupOptionalSourceDocumentIds(
    input.sourceDocumentIds,
    nodeId,
  );

  const entry: {
    nodeId: string;
    state: ProgressPlanState;
    title?: string;
    summary?: string;
    sourceDocumentIds?: ReadonlyArray<string>;
  } = {
    nodeId,
    state: "pending",
  };
  if (title !== undefined) {
    entry.title = title;
  }
  if (summary !== undefined) {
    entry.summary = summary;
  }
  if (sourceDocumentIds !== undefined) {
    entry.sourceDocumentIds = sourceDocumentIds;
  }
  return Object.freeze(entry);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * 注入式时钟。返回一个表示 "现在" 的 {@link Date} 对象。`createEffectPreviewScheduler`
 * 在不传时默认 `() => new Date()`；测试可注入固定时间以验证
 * `markFailed` / `markCompleted` 的 `endedAt` 写入。
 */
export type SchedulerClock = () => Date;

/**
 * `createEffectPreviewScheduler` 的可选依赖。
 *
 * - `now` — 时钟工厂函数，用于在 `markFailed` / `markCompleted` 时
 *   生成 `endedAt` ISO8601 时间戳。缺省 `() => new Date()`。
 */
export interface CreateEffectPreviewSchedulerOptions {
  readonly now?: SchedulerClock;
}

/**
 * 把单条 entry 复制并替换 `state`，同时写入由 task 5.2 提供的
 * 失败 / 完成元数据（保守地仅写入文档化字段）。
 *
 * - 对于 `markFailed`：写 `state="failed"` / `fallbackTier=tier` /
 *   `errorSummary=summary` / `endedAt=nowIso`。
 * - 对于 `markCompleted`：写 `state="completed"` / `endedAt=nowIso`。
 *   其它字段（含历史 `fallbackTier` / `errorSummary` / `startedAt`）
 *   原样保留 —— 设计要求只覆盖文档化字段。
 *
 * 返回的 entry 经 Object.freeze，与 `plan()` 的输出保持一致只读语义。
 */
function applyTransition(
  entry: ProgressPlanEntry,
  patch: Partial<ProgressPlanEntry> & Pick<ProgressPlanEntry, "state">,
): ProgressPlanEntry {
  const next: {
    nodeId: string;
    state: ProgressPlanState;
    title?: string;
    summary?: string;
    sourceDocumentIds?: ReadonlyArray<string>;
    startedAt?: string;
    endedAt?: string;
    fallbackTier?: FallbackTier;
    errorSummary?: string;
  } = {
    nodeId: entry.nodeId,
    state: patch.state,
  };
  // 保留既有字段（按 ProgressPlanEntry 字段顺序）。
  if (entry.title !== undefined) next.title = entry.title;
  if (entry.summary !== undefined) next.summary = entry.summary;
  if (entry.sourceDocumentIds !== undefined) {
    next.sourceDocumentIds = entry.sourceDocumentIds;
  }
  if (entry.startedAt !== undefined) next.startedAt = entry.startedAt;
  if (entry.endedAt !== undefined) next.endedAt = entry.endedAt;
  if (entry.fallbackTier !== undefined) next.fallbackTier = entry.fallbackTier;
  if (entry.errorSummary !== undefined) next.errorSummary = entry.errorSummary;
  // 应用 patch 覆盖（task 5.2 文档化字段）。
  if (patch.endedAt !== undefined) next.endedAt = patch.endedAt;
  if (patch.fallbackTier !== undefined) next.fallbackTier = patch.fallbackTier;
  if (patch.errorSummary !== undefined) {
    next.errorSummary = patch.errorSummary;
  }
  return Object.freeze(next);
}

/**
 * 工厂：构造一个无状态的 {@link EffectPreviewScheduler}。
 *
 * 当前实现包含 task 5.1 的 `plan()` 与 task 5.2 的 `markFailed` /
 * `markCompleted`。后两者通过 `options.now` 注入的时钟在状态切换时
 * 写入 `endedAt`（ISO8601），便于属性测试与回放比对。
 *
 * 与 `createPromptTemplateLibrary()` / `createSvgArchitectureDrafter()`
 * 保持同一无状态工厂模式 —— scheduler 实例本身不持有可变状态，所有
 * 状态都体现在被传入的 `plan` 数组上，调用方负责持有「最新的 plan」。
 */
export function createEffectPreviewScheduler(
  options?: CreateEffectPreviewSchedulerOptions,
): EffectPreviewScheduler {
  const clock: SchedulerClock = options?.now ?? (() => new Date());

  return {
    plan(input: SchedulerPlanInput): ReadonlyArray<ProgressPlanEntry> {
      const entries = input.dependencyOrder.map((nodeId) =>
        buildPendingEntry(nodeId, input),
      );
      return Object.freeze(entries);
    },

    markFailed(
      plan: ReadonlyArray<ProgressPlanEntry>,
      nodeId: string,
      tier: FallbackTier,
      summary: string,
    ): ReadonlyArray<ProgressPlanEntry> {
      const targetIndex = plan.findIndex((entry) => entry.nodeId === nodeId);
      if (targetIndex === -1) {
        // 未找到目标节点 —— 不抛错、不变更，返回原数组引用，便于
        // 调用方做 `plan === scheduler.markFailed(plan, ...)` 的引用相等
        // 判断；与「单点失败不影响其它节点 state」语义一致（需求 4.2）。
        return plan;
      }
      const endedAt = clock().toISOString();
      const next = plan.slice();
      next[targetIndex] = applyTransition(plan[targetIndex]!, {
        state: "failed",
        fallbackTier: tier,
        errorSummary: summary,
        endedAt,
      });
      return Object.freeze(next);
    },

    markCompleted(
      plan: ReadonlyArray<ProgressPlanEntry>,
      nodeId: string,
    ): ReadonlyArray<ProgressPlanEntry> {
      const targetIndex = plan.findIndex((entry) => entry.nodeId === nodeId);
      if (targetIndex === -1) {
        return plan;
      }
      const endedAt = clock().toISOString();
      const next = plan.slice();
      next[targetIndex] = applyTransition(plan[targetIndex]!, {
        state: "completed",
        endedAt,
      });
      return Object.freeze(next);
    },
  };
}
