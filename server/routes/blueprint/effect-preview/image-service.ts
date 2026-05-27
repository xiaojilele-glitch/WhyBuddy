/**
 * `ImageService` — autopilot effect-preview Stage C 4 步串行流水线编排器
 * （`autopilot-image-rendering-and-visual-system` spec, task 6.1 骨架 +
 * task 6.2 节点串行 raster 调用 + fallback 写回）。
 *
 * Stage C 流水线（design.md §"Stage C Pipeline Sequence"）：
 *
 *   spec_documents → prompt template → SVG architecture draft
 *     → schedule plan → gpt-image-2 raster
 *
 * 本文件实现 `ImageService.runStageC()`，按 4 步严格串行：
 *
 *   1. **Gate** — `specDocuments` 缺失或为空 → 直接写
 *      `textOnlyEffectPreview = { active: true, reason: "empty-spec" }`
 *      并返回。**零 outgoing 请求**：不调用 drafter / scheduler /
 *      imageApiClient（需求 1.2 / Property 5 第三条）。
 *   2. **Prompt rendering** — 对 `dependencyOrder` 的每个节点调用
 *      {@link PromptTemplateLibrary.render}，把 (nodeId → prompt) 收集到
 *      局部 `Map`。同输入必同输出（{@link PromptTemplateLibrary} 是确定
 *      性纯函数库），所以这一步不会失败 / 不会触发降级。
 *   3. **SVG draft** — `await svgArchitectureDrafter.draft({ architectureNotes,
 *      missionId })`；`kind === "ok"` 时写入 `architectureSvgDraft`，
 *      `kind === "skipped"` 时不污染该字段，仅在 progress plan / 日志中
 *      记录降级原因（需求 3.2 / 3.3）。
 *   4. **Scheduler.plan** — `progressPlan = scheduler.plan(...)`，所有
 *      entry 初始 `state === "pending"`。{@link SchedulerPlanInput.dependencyOrder}
 *      继续从 `input.dependencyOrder` 取值（**timeline-only 元数据**），
 *      与 `rasterTargets` 完全解耦。
 *   5. **Serial raster** — task 32.x 起，按 **`rasterTargets`** 顺序对每个
 *      nodeId 调用一次 {@link ImageApiClient.generate}（NOT `progressPlan`，
 *      NOT `dependencyOrder`）。这是 raster targets vs timeline 契约切分的
 *      核心：raster targets 是**显式的 generate 调用列表**，dependencyOrder
 *      是**timeline-only 元数据**。实现 MUST 严格按 `rasterTargets` 调用
 *      `imageApiClient.generate`，每 nodeId 恰好 1 次，never more。
 *      `rasterTargets` 缺失或为空时 → no-op（零 generate 调用 + logger.warn）。
 *      成功路径写入 `imageBase64ByNodeId[nodeId]` + `scheduler.markCompleted`；
 *      失败路径调用 `scheduler.markFailed(...)`，并在首次失败时挂上
 *      `textOnlyEffectPreview = { active: true, reason, errorSummary }`。
 *      单点失败不阻断后续节点。每个节点结束调用一次
 *      `costTracker?.record({ tier?, durationMs, model, estimatedCost })`
 *      （需求 7.3 / Phase 5 task 43）：成功路径
 *      `estimatedCost = lookupImagePricing(request.model)`（来自
 *      `shared/cost.ts` IMAGE_PRICING_TABLE 的 per-call 静态估算），
 *      失败路径显式 `0`，让下游 cost-tracker-adapter 区分「pricing source
 *      缺失」（适配器侧 console.warn）与「failure 的诚实零成本」。
 *
 *   **Raster targets 不变量**（task 32.x）：
 *   - `rasterTargets` 中的每个 nodeId **MUST** 触发 1 次且仅 1 次
 *     `imageApiClient.generate`，never more。
 *   - `imageBase64ByNodeId` 的 key 集合 **MUST** 是 `rasterTargets` 的
 *     子集（成功的那部分）；progressPlan 中其它 timeline-only 节点
 *     不会出现在 base64 map 中。
 *   - `rasterTargets` 缺失或为空 → no-op：不调用 generate，进度面板
 *     仍然按 dependencyOrder 渲染 progressPlan 但所有 entry 保持
 *     `pending` 状态。
 *   - **永不**回退到 `dependencyOrder`。这是显式契约，避免静悄悄地
 *     恢复批量 cost 放大 bug（generateEffectPreviews 对 N 个 target
 *     节点 fan-out 时，若每次都 raster 全 dependencyOrder，会产生
 *     O(N × M) 调用而不是 O(N)）。
 *
 * 错误兜底约束（需求 6.4 / Property 4）：
 *
 * - `runStageC` **永不抛错**。任意预期外异常（drafter / scheduler 抛错、
 *   prompt rendering 异常）都被翻译成
 *   `textOnlyEffectPreview = { active: true, reason: "upstream-failure",
 *   errorSummary }`，并返回当前已积累的 partial result（不丢弃已生成
 *   的 SVG / progressPlan）。
 * - 未来 6.2 的 raster 调用单点失败由 {@link EffectPreviewScheduler.markFailed}
 *   接管，`runStageC` 整体仍旧返回 partial 结果。
 *
 * 制品分离不变量（design §"Data Models" / Property 5 第四条）：
 *
 * - `architectureSvgDraft` 独占 SVG 字符串字段；不混入 `imageBase64ByNodeId`。
 * - `imageBase64ByNodeId` 独占 base64 raster 字段；不混入 SVG 字符串。
 * - `textOnlyEffectPreview` 独占文本兜底字段；与上面两类制品无冲突，
 *   可与已生成的 SVG / 部分图像并存。
 *
 * 仅依赖同目录 4 个 stateless 模块 + `shared/blueprint/contracts.ts` 类型，
 * 不读 `process.env`（env 在 {@link ImageApiClient} 内部读取一次）、
 * 不发起 IO（HTTP 在 6.2 通过 `imageApiClient.generate` 发起）。
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2, 3.3, 4.2, 6.4, 6.5, 7.3, 8.1_
 */

import type {
  BlueprintSpecDocument,
  FallbackTier,
  NodeImageRecord,
} from "../../../../shared/blueprint/contracts.js";
import { lookupImagePricing } from "../../../../shared/cost.js";

import type {
  ImageApiClient,
  ImageApiRequest,
  ImageGenModel,
} from "./image-api-client.js";
import type {
  PromptStyleKey,
  PromptTemplateLibrary,
} from "./prompt-template-library.js";
import type {
  EffectPreviewScheduler,
  ProgressPlanEntry,
} from "./scheduler.js";
import type { SvgArchitectureDrafter } from "./svg-architecture-drafter.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * 上游可选注入的人类可读节点元数据。每个 map 都是
 * `nodeId → 元数据` 的只读映射，缺失时各下游组件自行回退到默认值：
 *
 * - `titles` / `summaries` —— 命中时分别注入到
 *   {@link PromptTemplateLibrary.render} 与
 *   {@link EffectPreviewScheduler.plan}；缺失时 prompt 使用空字符串。
 * - `sourceDocumentIds` —— 命中时注入到
 *   {@link EffectPreviewScheduler.plan}，便于把 progress plan 投影成
 *   `BlueprintEffectPreviewMilestone` 视图（contracts.ts 中 5 字段）。
 *
 * 注意：上游若要避免「某节点既出现在 dependencyOrder 又被 nodeMetadata
 * 标记」，应自己保证 dependencyOrder 不含敏感节点；本服务不做再次校验
 * 以保持纯函数链路简单。
 */
export interface ImageServiceNodeMetadata {
  readonly titles?: ReadonlyMap<string, string>;
  readonly summaries?: ReadonlyMap<string, string>;
  readonly sourceDocumentIds?: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * `runStageC` 输入。design §"ImageService" 的 `ImageServiceInput` 形状。
 *
 * - `missionId` —— 用作 SVG 草图的 `data-mission-id`，以及 raster 阶段
 *   的审计上下文（6.2 接入 BlueprintCostTracker 时复用）。
 * - `specDocuments` —— Stage A+B 产出的 spec 文档列表。**长度为 0 或
 *   `undefined` 是合法输入**；此时直接走 empty-spec 兜底（需求 1.2）。
 * - `dependencyOrder` —— 拓扑顺序的 nodeId 数组。**timeline-only 元数据**：
 *   {@link EffectPreviewScheduler.plan} 仍按它生成 progressPlan，
 *   `BlueprintEffectPreviewMilestone` 视图也按它取顺序。**它不再决定
 *   `imageApiClient.generate` 的调用集合** —— 见 `rasterTargets`。
 * - `rasterTargets` —— **明确的 raster 调用集合**，每个 nodeId 触发
 *   恰好 1 次 `imageApiClient.generate`。该字段是 task 32.x 引入的
 *   契约切分，把「时间线 / 进度面板想看见哪些节点」与「真正出图
 *   消耗 token / quota 的节点集合」彻底分离：
 *
 *   * 默认上游（`buildEffectPreview` per-node 调用）只传 `[input.node.id]`，
 *     一个 preview 一次 generate 调用，避免对 N 个 target × M 个依赖
 *     节点的 cost 放大。
 *   * 缺失（`undefined`）按 no-op 处理（零 generate 调用）并在 logger
 *     上记录一条 warning；**不会自动 fall back 到 `dependencyOrder`**，
 *     避免静悄悄地恢复成本放大 bug。
 *   * `imageBase64ByNodeId` 的 key 集合严格等于 `rasterTargets` 中
 *     真正成功的子集；其它 progressPlan 节点（timeline-only）不会出现
 *     在 base64 map 里。
 *
 * - `architectureNotes` —— SVG drafter 的输入；空数组允许，drafter 会
 *   返回 `{ kind: "skipped", reason: "no-architecture-notes" }`。
 * - `style` —— 可选的 4 风格枚举之一；缺失时
 *   {@link PromptTemplateLibrary} 自动回退到 `system_architecture_diagram`。
 * - `nodeMetadata` —— 可选的人类可读元数据注入点（见
 *   {@link ImageServiceNodeMetadata}）。
 */
export interface ImageServiceRunStageCInput {
  readonly missionId: string;
  readonly specDocuments?: ReadonlyArray<BlueprintSpecDocument>;
  readonly dependencyOrder: ReadonlyArray<string>;
  /**
   * 明确的 raster 调用集合（task 32.x 引入）。每个 nodeId 触发
   * 恰好 1 次 {@link ImageApiClient.generate}。
   *
   * - 缺失（`undefined`）按 no-op 处理：零 generate 调用 + logger.warn
   *   记录一条警告。**不会回退到 `dependencyOrder`**，避免静悄悄地
   *   恢复 N×deps 的 cost 放大 bug。
   * - 长度为 0 与缺失等价（零 generate 调用）。
   * - 实现 MUST 仅对该集合调用 generate，never more。
   */
  readonly rasterTargets?: ReadonlyArray<string>;
  readonly architectureNotes: ReadonlyArray<string>;
  readonly style?: PromptStyleKey;
  readonly nodeMetadata?: ImageServiceNodeMetadata;
}

/**
 * `textOnlyEffectPreview` 兜底视图字段。原型与
 * `BlueprintEffectPreview.textOnlyEffectPreview` 严格一致，方便 6.2 / 7.1
 * 把本服务结果直接合并到 `BlueprintEffectPreview` 制品。
 */
export interface ImageServiceTextOnlyEffectPreview {
  readonly active: boolean;
  readonly reason: FallbackTier | "empty-spec";
  readonly errorSummary?: string;
}

/**
 * `runStageC` 返回值。所有字段都为 optional 以便 6.2 在 raster 出图后
 * 增量填充 `imageBase64ByNodeId`，并在任意 fallback 触发后追加
 * `textOnlyEffectPreview`。
 *
 * 制品分离不变量：
 *
 * - `architectureSvgDraft` 与 `imageBase64ByNodeId[*]` 之间的字符串值
 *   不允许互相出现（Property 5 第四条）。
 * - `progressPlan` 永远存在（即使为空数组）；这与
 *   {@link EffectPreviewScheduler.plan} 输入空数组返回空数组一致。
 */
export interface ImageServiceRunStageCResult {
  readonly architectureSvgDraft?: string;
  readonly imageBase64ByNodeId?: Record<string, NodeImageRecord>;
  readonly textOnlyEffectPreview?: ImageServiceTextOnlyEffectPreview;
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
}

/**
 * `ImageService` 接口。`runStageC` 是当前 spec 唯一对外暴露的方法；
 * 后续若需要扩展（如批量出图 / image edit）应另开 spec。
 */
export interface ImageService {
  runStageC(
    input: ImageServiceRunStageCInput,
  ): Promise<ImageServiceRunStageCResult>;
}

/**
 * `createImageService` 的依赖。task 7.1 在 `server/routes/blueprint.ts` 的
 * `ctx.effectPreviewLlmService` 装配处实例化各依赖，再注入本服务。
 *
 * 4 个核心依赖均为 required —— 6.1 不做 stub fallback，确保 wiring 正确。
 *
 * `costTracker` 是 task 6.2 引入的可选成本治理依赖：每个节点在 raster
 * 调用结束（无论成功还是失败）后会调用一次
 * {@link BlueprintCostTrackerLike.record}，把 tier / durationMs / model
 * 上报给 `BlueprintCostTracker`（需求 7.3 / 8.1）。task 7.1 会把真实
 * `BlueprintCostTracker` 通过该接口注入；缺省时（如单元测试不关心成本
 * 治理路径）跳过 record 调用，不影响 raster 主流程。
 */
export interface ImageServiceDeps {
  readonly promptTemplateLibrary: PromptTemplateLibrary;
  readonly svgArchitectureDrafter: SvgArchitectureDrafter;
  readonly scheduler: EffectPreviewScheduler;
  readonly imageApiClient: ImageApiClient;
  readonly costTracker?: BlueprintCostTrackerLike;
}

/**
 * `BlueprintCostTracker` 的最小注入接口。task 6.2 在每个节点 raster
 * 调用完成后调用一次 `record(...)`，记录本次调用的耗时、模型、降级
 * 层级与 per-call 估算成本。Phase 5 task 43 已接入真实成本：成功路径
 * `estimatedCost = lookupImagePricing(model)`（来自 `shared/cost.ts`
 * 的 IMAGE_PRICING_TABLE，per-call flat-rate 静态估算）；失败路径
 * 显式传 `0`，与 cost-tracker-adapter 一起在审计链上区分「pricing
 * source 缺失」与「failure 的诚实零成本」。
 *
 * 这里不直接 import `BlueprintCostTracker` 类型，是为了避免对上层
 * 治理子系统形成硬依赖；本接口与 `BlueprintCostTracker.record` 入参
 * 字段集兼容（`tier` / `durationMs` / `model` / `estimatedCost`），
 * task 7.1 可直接把实例当作 `BlueprintCostTrackerLike` 注入。
 */
export interface BlueprintCostTrackerLike {
  record(input: {
    readonly tier?: FallbackTier;
    readonly durationMs: number;
    readonly model: ImageGenModel;
    readonly estimatedCost?: number;
  }): void;
}

// ---------------------------------------------------------------------------
// Internal helpers — pure, no IO
// ---------------------------------------------------------------------------

/**
 * 上游 `specDocuments` 是否为「缺失 / 空」。
 *
 * 走兜底的两种合法情形：
 *
 * - `undefined`（字段未提供）。
 * - 长度为 0 的数组。
 *
 * 注意：这里不对 `null` 做特殊处理 —— TypeScript 类型层已禁止 `null`，
 * 任何 runtime 错误地传入 `null` 都会被外层 `try/catch` 翻译成
 * `upstream-failure`，比这里再加一条分支更安全。
 */
function isSpecDocumentsEmpty(
  specDocuments: ImageServiceRunStageCInput["specDocuments"],
): boolean {
  if (specDocuments === undefined) {
    return true;
  }
  return specDocuments.length === 0;
}

/**
 * 把上游 `nodeMetadata` 解构成 prompt rendering 所需的最小输入。
 *
 * - title 缺失 → 使用 `nodeId`（保证 prompt 中至少有一个可读标识）。
 * - summary 缺失 → 使用空字符串（{@link PromptTemplateLibrary} 容忍空 summary）。
 *
 * 这一步只读 map，不修改输入。
 */
function resolveNodePromptFields(
  nodeId: string,
  metadata: ImageServiceNodeMetadata | undefined,
): { readonly title: string; readonly summary: string } {
  const title = metadata?.titles?.get(nodeId) ?? nodeId;
  const summary = metadata?.summaries?.get(nodeId) ?? "";
  return { title, summary };
}

/**
 * 从 prompt rendering 步骤里收集 `Map<nodeId, prompt>`。该 Map 是 6.1
 * 与 6.2 之间的契约：6.2 在 raster 阶段从这里读取每个节点的 prompt
 * 字符串，并在成功路径中把它写入 `NodeImageRecord.promptUsed`。
 *
 * task 32.x：除了 `dependencyOrder` 中所有节点（用于 timeline / progressPlan
 * 投影），也对 `rasterTargets` 中独立出现的 nodeId 渲染 prompt，确保
 * raster 阶段每个目标都有可用的 prompt 字符串。两个集合可能完全相同
 * （单 target 场景）也可能仅部分重叠。
 */
function renderPrompts(
  input: ImageServiceRunStageCInput,
  promptTemplateLibrary: PromptTemplateLibrary,
): Map<string, string> {
  const prompts = new Map<string, string>();
  const rendered = new Set<string>();
  const renderOne = (nodeId: string): void => {
    if (rendered.has(nodeId)) {
      return;
    }
    rendered.add(nodeId);
    const { title, summary } = resolveNodePromptFields(
      nodeId,
      input.nodeMetadata,
    );
    const prompt = promptTemplateLibrary.render({
      nodeId,
      title,
      summary,
      architectureNotes: input.architectureNotes,
      ...(input.style !== undefined ? { style: input.style } : {}),
    });
    prompts.set(nodeId, prompt);
  };
  for (const nodeId of input.dependencyOrder) {
    renderOne(nodeId);
  }
  if (input.rasterTargets) {
    for (const nodeId of input.rasterTargets) {
      renderOne(nodeId);
    }
  }
  return prompts;
}

/**
 * 把异常翻译成 `errorSummary` 字符串。截断到 240 字符，避免审计 / UI
 * 面板里出现超长堆栈；不含密钥（drafter / scheduler 模块本身不接触
 * 密钥，所以这里只防 prompt 字面量泄漏）。
 */
function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  if (typeof error === "string") {
    return error.slice(0, 240);
  }
  return "Unknown error during effect-preview Stage C orchestration.";
}

// ---------------------------------------------------------------------------
// Per-node serial raster pipeline — task 6.2 implementation
// ---------------------------------------------------------------------------

/**
 * 节点串行 raster 调用（task 32.x：按 **`rasterTargets`** 而非 `progressPlan`
 * 顺序串行）。该集合是上游显式声明的 generate 调用列表；`progressPlan`
 * 仅作为 timeline / 状态写回的载体。
 *
 * 关键不变量（需求 4.2 / 6.4 / 6.5 / 7.3 / 8.1，Property 4 / Property 5，task 32.x）：
 *
 * 1. **严格串行**：使用 `for...of` 顺序 await，禁止 `Promise.all`。
 *    保证 outgoing 请求计数恰好等于 `rasterTargets.length`，便于 PBT 断言。
 * 2. **raster targets 决定调用集合**：iterate `rasterTargets`，对每个
 *    nodeId 调用 1 次 `imageApiClient.generate`。NOT `progressPlan`，
 *    NOT `dependencyOrder`。这是 task 32.x 修复 N×M cost 放大 bug 的核心。
 * 3. **rasterTargets 子集即可**：`rasterTargets` 中的 nodeId 不必出现在
 *    `progressPlan` / `dependencyOrder` 中。出现时按其原 entry 调用
 *    `markCompleted` / `markFailed` 写回；不出现时仍写入
 *    `imageBase64ByNodeId[nodeId]`，但不修改 progress plan 引用。
 * 4. **单点失败不阻断**：任意节点的 `imageApiClient.generate` 失败仅
 *    通过 `scheduler.markFailed` 标记当前节点（如果在 plan 中），循环
 *    继续推进下一节点。
 * 5. **首失败决定 textOnlyEffectPreview**：第一个失败节点的 tier /
 *    errorSummary 写入 `textOnlyEffectPreview`，作为整段 Stage C 的
 *    canonical 兜底原因；后续节点失败仅更新 progress plan，不覆盖。
 * 6. **成本治理**：每个 raster target 处理结束（无论成功 / 失败）调用一次
 *    `costTracker?.record(...)`，传入 `tier` / `durationMs` / `model` /
 *    `estimatedCost`。Phase 5 task 43 已接入真实成本：成功路径
 *    `estimatedCost = lookupImagePricing(request.model)`（来自
 *    `shared/cost.ts` 的 `IMAGE_PRICING_TABLE`，per-call flat-rate 静态
 *    估算）；失败路径显式传 `0`，让下游 cost-tracker-adapter 区分
 *    「pricing source 缺失」（适配器侧 console.warn）与「failure 的
 *    诚实零成本」。token unit prices 仍由适配器从 `PRICING_TABLE` /
 *    `DEFAULT_PRICING` 填入 `CostRecord` schema，与 image actualCost
 *    解耦。
 * 7. **制品分离**：`imageBase64ByNodeId` 仅在至少一个 raster target 成功
 *    时返回，内容只包含成功节点；不与 `architectureSvgDraft` 共享字段。
 *
 * 请求体字段集是 design.md §"ImageApiClient" 与需求 5.1 / 5.2 / 5.3 /
 * 5.4 共同冻结的 6 字段：`model` / `prompt` / `response_format` /
 * `image_size` / `aspect_ratio` / `n`。当前阶段固定使用项目默认值
 * （`gpt-image-2` / `1K` / `1:1` / `b64_json` / `n=1`），后续 task 可在
 * 不改变签名的前提下接入 per-node style / aspect 切换。
 *
 * 永不抛错：`imageApiClient.generate` 协议本身就保证只 resolve 不 reject，
 * 但本函数额外用一层 `try/catch` 防御预期外异常 ── 即便单个节点抛出
 * 也只标记该节点失败，不阻断循环。
 */
async function runRasterPipeline(args: {
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
  readonly rasterTargets: ReadonlyArray<string>;
  readonly prompts: ReadonlyMap<string, string>;
  readonly scheduler: EffectPreviewScheduler;
  readonly imageApiClient: ImageApiClient;
  readonly costTracker?: BlueprintCostTrackerLike;
}): Promise<{
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
  readonly imageBase64ByNodeId?: Record<string, NodeImageRecord>;
  readonly textOnlyEffectPreview?: ImageServiceTextOnlyEffectPreview;
}> {
  let currentPlan: ReadonlyArray<ProgressPlanEntry> = args.progressPlan;
  const imageBase64ByNodeId: Record<string, NodeImageRecord> = {};
  let textOnlyEffectPreview: ImageServiceTextOnlyEffectPreview | undefined;

  for (const nodeId of args.rasterTargets) {
    const promptUsed = args.prompts.get(nodeId) ?? "";

    // -----------------------------------------------------------------
    // 请求体字段集是 design.md / requirements 5.1-5.5 冻结的 6 字段。
    // 当前阶段使用项目默认值，与 `IMAGE_GEN_DEFAULT_*` 默认配置一致。
    // -----------------------------------------------------------------
    const request: ImageApiRequest = {
      model: "gpt-image-2",
      prompt: promptUsed,
      response_format: "b64_json",
      image_size: "1K",
      aspect_ratio: "1:1",
      n: 1,
    };

    let result: Awaited<ReturnType<ImageApiClient["generate"]>>;
    try {
      result = await args.imageApiClient.generate(request);
    } catch (error) {
      // ImageApiClient 协议保证不抛错；这里是防御性兜底。
      // 任何意外异常被翻译为 upstream-failure，处理与正常失败一致。
      const errorSummary =
        error instanceof Error
          ? error.message.slice(0, 240)
          : "Unknown error during image API dispatch.";
      result = {
        kind: "error",
        tier: "upstream-failure",
        errorSummary,
        durationMs: 0,
      };
    }

    if (result.kind === "ok") {
      imageBase64ByNodeId[nodeId] = {
        b64: result.b64Json,
        mimeType: result.mimeType,
        promptUsed,
        generatedAt: new Date().toISOString(),
      };
      currentPlan = args.scheduler.markCompleted(currentPlan, nodeId);
    } else {
      currentPlan = args.scheduler.markFailed(
        currentPlan,
        nodeId,
        result.tier,
        result.errorSummary,
      );
      // 首个失败决定 textOnlyEffectPreview 的 reason / errorSummary —
      // 后续节点失败只追加 progress plan 上的 fallbackTier，不覆盖。
      if (textOnlyEffectPreview === undefined) {
        textOnlyEffectPreview = {
          active: true,
          reason: result.tier,
          errorSummary: result.errorSummary,
        };
      }
    }

    // -----------------------------------------------------------------
    // 成本治理：每个节点结束后记录一次（task 43.2 — Honest cost reporting）。
    // - 成功路径：`estimatedCost = lookupImagePricing(model)` 返回 spec 的
    //   静态 per-call 估算值（`shared/cost.ts` IMAGE_PRICING_TABLE）。
    // - 失败路径：显式传 `0`，让下游 cost-tracker-adapter 能区分「pricing
    //   source 缺失」与「failure 的诚实零成本」（task 43.3）。
    // -----------------------------------------------------------------
    if (args.costTracker) {
      const estimatedCost =
        result.kind === "ok" ? lookupImagePricing(request.model) : 0;
      args.costTracker.record({
        ...(result.kind === "error" ? { tier: result.tier } : {}),
        durationMs: result.durationMs,
        model: request.model,
        estimatedCost,
      });
    }
  }

  return {
    progressPlan: currentPlan,
    ...(Object.keys(imageBase64ByNodeId).length > 0
      ? { imageBase64ByNodeId }
      : {}),
    ...(textOnlyEffectPreview !== undefined ? { textOnlyEffectPreview } : {}),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * 构造一个 {@link ImageService}。无状态实例：所有运行期状态都体现在
 * 调用 `runStageC` 时的输入与返回值上，工厂可被多次调用产生等价的
 * 服务实例。
 *
 * 与 `createPromptTemplateLibrary()` /
 * `createSvgArchitectureDrafter()` / `createEffectPreviewScheduler()` /
 * `createImageApiClient()` 保持同一无状态工厂模式。
 */
export function createImageService(deps: ImageServiceDeps): ImageService {
  const {
    promptTemplateLibrary,
    svgArchitectureDrafter,
    scheduler,
    imageApiClient,
    costTracker,
  } = deps;

  return {
    async runStageC(
      input: ImageServiceRunStageCInput,
    ): Promise<ImageServiceRunStageCResult> {
      // ---------------------------------------------------------------
      // Step 0 — Gate：spec_documents 缺失 / 为空 → 直接 textOnly 兜底
      // 零 outgoing 请求；不调用 drafter / scheduler / imageApiClient。
      // ---------------------------------------------------------------
      if (isSpecDocumentsEmpty(input.specDocuments)) {
        return {
          progressPlan: [],
          textOnlyEffectPreview: {
            active: true,
            reason: "empty-spec",
          },
        };
      }

      try {
        // -------------------------------------------------------------
        // Step 1 — Prompt rendering（确定性、纯函数；不会失败）。
        //
        // 为保证 6.2 能从 `prompts` 中按 nodeId 查到 prompt 字符串，
        // 这里把渲染结果收集进局部 Map；该 Map 不出现在返回值上 ──
        // prompts 在 raster 成功后会被复制到 `NodeImageRecord.promptUsed`。
        // -------------------------------------------------------------
        const prompts = renderPrompts(input, promptTemplateLibrary);

        // -------------------------------------------------------------
        // Step 2 — SVG architecture draft（成功 / 跳过；永不抛错）。
        //
        // 失败时不污染 `architectureSvgDraft`，仅日志层记录原因；后续
        // 由 progress plan 上对应节点的 `fallbackTier` 反映降级状态
        // （6.2 写入）。
        // -------------------------------------------------------------
        const svgResult = await svgArchitectureDrafter.draft({
          missionId: input.missionId,
          architectureNotes: input.architectureNotes,
        });
        const architectureSvgDraft =
          svgResult.kind === "ok" ? svgResult.svg : undefined;

        // -------------------------------------------------------------
        // Step 3 — Scheduler.plan：把 dependencyOrder 转换为初始
        // progressPlan，所有 entry 状态为 "pending"。
        // -------------------------------------------------------------
        const initialPlan = scheduler.plan({
          dependencyOrder: input.dependencyOrder,
          ...(input.nodeMetadata?.titles !== undefined
            ? { titles: input.nodeMetadata.titles }
            : {}),
          ...(input.nodeMetadata?.summaries !== undefined
            ? { summaries: input.nodeMetadata.summaries }
            : {}),
          ...(input.nodeMetadata?.sourceDocumentIds !== undefined
            ? { sourceDocumentIds: input.nodeMetadata.sourceDocumentIds }
            : {}),
        });

        // -------------------------------------------------------------
        // Step 4 — Serial raster：按 **`rasterTargets`** 顺序对每个 nodeId
        // 调用一次 `imageApiClient.generate(...)`。NOT `progressPlan`，
        // NOT `dependencyOrder`（task 32.x：raster targets vs timeline
        // 契约切分）。
        //
        // 缺失或为空 → no-op：零 generate 调用，progress plan 保持
        // 全 `pending`。**永不**回退到 `dependencyOrder`，避免静悄悄
        // 恢复批量 cost 放大 bug。
        //
        // 成功写入 `imageBase64ByNodeId`，失败标记 progress plan + 首失败
        // 兜底。单点失败不阻断后续节点（需求 4.2）；每个节点结束调用
        // 一次 `costTracker.record`（需求 7.3）。
        // -------------------------------------------------------------
        const rasterTargets = input.rasterTargets;
        if (rasterTargets === undefined || rasterTargets.length === 0) {
          // task 32.x: missing/empty rasterTargets is a no-op (zero
          // generate calls). We log a warning via console.warn since
          // this is server-side and ImageService deps don't carry a
          // logger; if it fires, callers should explicitly pass an
          // empty array (intentional) or the actual target nodeIds.
          if (rasterTargets === undefined) {
            console.warn(
              "[ImageService.runStageC] rasterTargets is undefined; skipping all raster calls. " +
                "Pass an explicit rasterTargets array (e.g. [input.node.id]) to generate images, " +
                "or [] to opt-out without warning. Never falls back to dependencyOrder.",
            );
          }
          return {
            progressPlan: initialPlan,
            ...(architectureSvgDraft !== undefined
              ? { architectureSvgDraft }
              : {}),
          };
        }

        const rasterResult = await runRasterPipeline({
          progressPlan: initialPlan,
          rasterTargets,
          prompts,
          scheduler,
          imageApiClient,
          ...(costTracker !== undefined ? { costTracker } : {}),
        });

        return {
          progressPlan: rasterResult.progressPlan,
          ...(architectureSvgDraft !== undefined
            ? { architectureSvgDraft }
            : {}),
          ...(rasterResult.imageBase64ByNodeId !== undefined
            ? { imageBase64ByNodeId: rasterResult.imageBase64ByNodeId }
            : {}),
          ...(rasterResult.textOnlyEffectPreview !== undefined
            ? { textOnlyEffectPreview: rasterResult.textOnlyEffectPreview }
            : {}),
        };
      } catch (error) {
        // -------------------------------------------------------------
        // 任何上游异常都被翻译成 upstream-failure 文本兜底。
        // 不丢失外层任何字段（progress plan 此时未生成，回空数组）。
        // -------------------------------------------------------------
        return {
          progressPlan: [],
          textOnlyEffectPreview: {
            active: true,
            reason: "upstream-failure",
            errorSummary: summarizeError(error),
          },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Type re-exports — 便于 6.2 / 7.1 / 测试直接 import 时不绕路
// ---------------------------------------------------------------------------

export type { PromptStyleKey } from "./prompt-template-library.js";
export type { ProgressPlanEntry } from "./scheduler.js";
export type { ImageApiRequest, ImageGenModel } from "./image-api-client.js";
