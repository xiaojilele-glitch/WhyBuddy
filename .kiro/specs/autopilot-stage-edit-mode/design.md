# 设计文档：Autopilot Stage Edit Mode

## 概览

本设计落地 spec 3 的全部需求：在 viewing-completed 模式下解锁 input / clarification / route_generation 三个上游 stage 的字段级 inline edit；在既有 modify 端点上接线 spec 1 引擎做自动级联 stale；在下游 artifact 视图渲染 stale badge；在右栏渲染 stale indicator + per-stage regenerate。spec 3 是 spec 2 之外的**第二条** stale 触发通路（隐式意图通路），与 spec 2 显式 replan 在 API 入口、modal 组件、事件审计上严格分离。

设计的三个不变量：

1. **共用 spec 1 引擎、不共用 spec 2 端点**：spec 3 的全部 invalidation 都通过 spec 1 的 `invalidateDownstreamWithLog` 完成；任何路径都不调用 spec 2 的 `POST /replan` 端点、不写入 `replan.triggered` 事件。
2. **接线既有 modify 端点、不重建路由**：在 `PATCH /intake/:intakeId`（**新增**，spec 3 唯一新建端点）/ `POST|PATCH /clarifications/:sessionId/answers`（**已存在**，扩展 hook）/ `POST /jobs/:jobId/route-selection`（**已存在**，仅在重选场景下扩展 hook）三条路径上挂 Auto_Invalidation_Hook，不替换处理函数主体。
3. **隐式意图、不弹全屏 modal**：用户在字段旁点 edit 图标 → inline confirmation（紧邻字段、同区域）→ 直接调既有 modify 端点；既有响应自带刷新后的 `staleArtifactIds`（追加可选字段），前端用既有 store 协调。

## 架构

### 模块边界与文件布局

```
shared/blueprint/contracts.ts                            ← 仅追加 BlueprintIntakePatchRequest 类型 + modify 响应可选追加字段
server/routes/blueprint/
  stage-edit/
    auto-invalidation-hook.ts                            ← spec 3 唯一的服务端核心：调 spec 1 引擎的薄包装
    intake-patch-route.ts                                ← PATCH /intake/:intakeId handler（新增端点）
    intake-patch-validator.ts                            ← intake patch body 校验
    intake-noop-detector.ts                              ← 检测 patch 是否为 noop（值在结构上等价）
    clarification-answers-hook.ts                        ← 包装 handleClarificationAnswers，识别"实际写入"
    route-reselection-hook.ts                            ← 包装 route-selection POST，识别"二次或后续调用"
    job-locator.ts                                       ← intakeId / sessionId → 对应 BlueprintGenerationJob 的查找
    conflict-detection.ts                                ← Conflict_Detection（与 spec 2 running guard 独立模块）
    stage-edit-logger.ts                                 ← stage_edit.invalidated / stage_edit.noop / stage_edit.blocked 日志
    __tests__/
      __fixtures__/
        build-fixture-job.ts                             ← 复用 spec 1 / spec 2 fixtures + intake / clarification
        arbitraries.ts                                   ← fast-check arbitraries
      intake-modify-invalidation.test.ts                 ← property + example
      clarification-modify-invalidation.test.ts          ← property + example
      route-selection-reselection.test.ts                ← property + example
server/routes/blueprint.ts                               ← 在三条 modify 端点处追加 hook 调用 + 注册 PATCH /intake
client/src/lib/blueprint-api/
  intake.ts                                              ← 追加 patchBlueprintIntake helper
  clarification.ts                                       ← 既有 helper，补 staleArtifactIds 解析（不破坏既有调用）
  routeset.ts                                            ← 既有 helper，补 staleArtifactIds 解析
client/src/pages/autopilot/
  AutopilotRoutePage.tsx                                 ← 在页面 1 渲染区域内为 input / clarification / route 字段挂 EditModeField
  stage-edit/
    EditModeField.tsx                                    ← view ↔ editing 状态机包装组件
    InlineConfirmation.tsx                               ← 字段级轻量确认（与 spec 2 modal 完全独立）
    use-inline-edit-flow.ts                              ← 字段级提交协调 hook
    derive-downstream-impact.ts                          ← 复用 spec 2 同名工具或独立实现的派生器
    StaleBadge.tsx                                       ← 下游 artifact 视图层"已过期"小标签
    RightRailStaleIndicator.tsx                          ← 右栏顶部黄条 + per-stage regenerate
    use-per-stage-regenerate.ts                          ← per-stage 重新生成 hook
    __tests__/
      EditModeField.test.tsx
      InlineConfirmation.test.tsx
      StaleBadge.test.tsx
      RightRailStaleIndicator.test.tsx
      use-inline-edit-flow.test.tsx
      use-per-stage-regenerate.test.tsx
client/src/pages/autopilot/right-rail/
  AutopilotRightRail.tsx                                 ← 顶部追加 RightRailStaleIndicator 渲染槽
```

### 与现有依赖的接线

- **后端依赖**：`BlueprintServiceContext`、`BlueprintJobStore`、`BlueprintIntakeStores`（intakes / clarificationSessions）、spec 1 的 `invalidateDownstreamWithLog`、既有 `updateClarificationSession`（不修改）、既有 `selectRouteForSpecTree`（不修改）。
- **后端不依赖**：spec 2 的 `Replan_Endpoint`、spec 2 的 `Replan_Triggered_Event`、LLM client、executor client。
- **前端依赖**：既有 `AutopilotRoutePage`（页面 1 渲染区域）、既有 toast、spec 1 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`（前端层导入用于派生 Downstream_Impact_Summary）、既有 right rail data hook。
- **前端不依赖**：spec 2 的 `ReplanConfirmationModal` / `ReplanButton`（独立组件，零 import 共享）。

### 数据流（以 clarification answers modify 为例）

```
用户在 viewing-completed 模式下点击 clarification answer 旁的 edit 图标
   │
   ├─ EditModeField: view → editing
   ├─ InlineConfirmation 渲染（"保存修改将使 N 个下游内容过期，确认？"）
   │     N 来自前端 deriveDownstreamImpact("clarification", localJob)
   │
   ▼
用户点 confirm（或 Enter）
   │
   ├─ EditModeField: editing → submitting
   ├─ POST /api/blueprint/clarifications/:sessionId/answers { answers: [...] }
   │     │
   │     ├─ 既有 handleClarificationAnswers（不修改）
   │     │     ├─ jobLocator: 通过 sessionId 找到关联的 BlueprintGenerationJob
   │     │     │     若未找到（session 还没创建过 job）→ 跳过 invalidation hook，返回既有响应
   │     │     ├─ conflictDetection.checkRunningDownstream(job, "clarification")
   │     │     │     若 running → 返回 409 + downstream_running，不调 updateClarificationSession
   │     │     ├─ noopDetector.compareAnswers(prev, next)
   │     │     │     若 noop → 跳过 invalidation hook，返回既有响应（debug 日志）
   │     │     ├─ 调既有 updateClarificationSession（保持不变）
   │     │     └─ Auto_Invalidation_Hook:
   │     │           ├─ invalidateDownstreamWithLog(ctx, job, "clarification", { reason: "upstream_clarification_changed", ... })
   │     │           ├─ jobStore.save(invalidatedJob)
   │     │           └─ stage_edit.invalidated info 日志
   │     │
   │     └─ 响应附加 staleArtifactIds 摘要（追加可选字段）
   │
   ▼
EditModeField: submitting → view（用新值）
   │
   ├─ 协调前端 store：刷新本地 job、staleArtifactIds 索引、所有下游派生 store
   ├─ 重新渲染 StaleBadge / RightRailStaleIndicator（同一 React batch）
   └─ toast.success "已保存修改，N 个下游内容已标记为过期"

页面停留在原 sub-stage（不调 resetPin / 不改 workflowStageOverride / 不导航）
```

### 非功能性约束

- **响应时间**：modify 端点既有响应时间不变；hook 引入额外 ≤ 50ms（spec 1 引擎 + jobStore.save）。
- **可观测性**：三条日志事件键 `stage_edit.invalidated` / `stage_edit.noop` / `stage_edit.blocked`，前缀稳定；与 spec 1 的 `[blueprint-staleness]` / spec 2 的 `[blueprint-replan]` 日志键命名空间互斥。
- **GitHub Pages 静态预览**：modify 端点不可用 → 前端探测 → EditModeField 整体 disabled（所有 edit 图标隐藏）；不抛异常。

## 组件设计

### C1. Shared Contracts（`shared/blueprint/contracts.ts`）

#### C1.1 新增类型：`BlueprintIntakePatchRequest`

```typescript
export interface BlueprintIntakePatchRequest {
  /** 完整替换 target text；省略表示不修改。 */
  targetText?: string;
  /** 完整替换 GitHub URLs 列表；省略表示不修改。 */
  githubUrls?: string[];
  /** 可选 reason，沿用与 spec 2 一致的 ≤ 1024 字符上限。 */
  reason?: string;
}
```

PATCH 语义：**字段级 partial update**。不提供的字段保持不变；提供的字段（哪怕是空字符串 / 空数组）即为新值。这与既有 `POST /intake` 创建语义不冲突——POST 是整体创建，PATCH 是部分修改。

#### C1.2 既有 modify 响应追加可选字段（不修改既有字段）

为前端能在不重新拉 `GET /jobs/:jobId` 的情况下知道下游 stale 摘要，本设计在三条 modify 端点的响应上**追加可选字段**：

```typescript
export interface BlueprintStaleEditResultSummary {
  /** invalidation 触发时的 fromStage（"input" / "clarification" / "route_generation"）。 */
  fromStage: BlueprintGenerationStage;
  /** 本次新增标记 stale 的 artifact id 列表（不含原本已 stale 的）。 */
  newlyStaleArtifactIds: string[];
  /** 本次新增标记数量；等于 newlyStaleArtifactIds.length。 */
  newlyStaleArtifactCount: number;
  /** 调用后 job 的全量 staleArtifactIds 索引快照。 */
  staleArtifactIdsSnapshot: string[];
}
```

三条 modify 端点的响应在 hook 触发时**追加** `staleEdit?: BlueprintStaleEditResultSummary` 字段；hook 未触发（无关联 job / noop / 首次 route selection 等）时**整体省略**该字段。

需求 12.2 / 12.3 允许"以追加方式附带新可选字段"。本设计严格遵守：

- 既有字段不动；
- 新字段全部可选；
- 不在响应中以 null / 空对象占位（hook 未触发即整体省略 `staleEdit` key）。

### C2. Auto Invalidation Hook（`server/routes/blueprint/stage-edit/auto-invalidation-hook.ts`）

#### C2.1 公共入口

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintGenerationArtifactType,
  BlueprintStaleReason,
} from "../../../../shared/blueprint/contracts.js";
import type { BlueprintJobStore } from "../job-store.js";
import type { BlueprintServiceContext } from "../context.js";
import { invalidateDownstreamWithLog } from "../staleness/invalidate-downstream.js";
import { logStageEditInvalidated, logStageEditNoop } from "./stage-edit-logger.js";

export interface AutoInvalidationHookInput {
  job: BlueprintGenerationJob;
  fromStage: BlueprintGenerationStage;
  reason: BlueprintStaleReason;
  triggeringEndpoint: "intake_patch" | "clarification_answers" | "route_reselection";
  triggeringArtifactId: string;
  triggeringArtifactType: BlueprintGenerationArtifactType;
  jobStore: BlueprintJobStore;
  ctx: Pick<BlueprintServiceContext, "logger" | "now">;
}

export interface AutoInvalidationHookResult {
  /** 写入 store 的最终 job 形态（含刷新后的 staleArtifactIds）。 */
  job: BlueprintGenerationJob;
  /** 本次新增标记 stale 的 artifact id 列表。 */
  newlyStaleArtifactIds: string[];
  /** 本次新增标记数量。 */
  newlyStaleArtifactCount: number;
}

export function runAutoInvalidationHook(input: AutoInvalidationHookInput): AutoInvalidationHookResult {
  const beforeIds = new Set(input.job.staleArtifactIds ?? []);

  let newJob: BlueprintGenerationJob;
  try {
    newJob = invalidateDownstreamWithLog(input.ctx, input.job, input.fromStage, {
      reason: input.reason,
      triggeringArtifactId: input.triggeringArtifactId,
      triggeringArtifactType: input.triggeringArtifactType,
      now: input.ctx.now,
    });
  } catch (err) {
    // 防御：spec 1 引擎为纯函数，理论不抛错（spec 3 §3.9）
    input.ctx.logger.warn("[blueprint-stage-edit] invalidation engine threw", {
      jobId: input.job.id,
      fromStage: input.fromStage,
      triggeringEndpoint: input.triggeringEndpoint,
      error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
    });
    // modify 业务本身已成功；invalidation 失败不回滚 modify
    return {
      job: input.job,
      newlyStaleArtifactIds: [],
      newlyStaleArtifactCount: 0,
    };
  }

  const afterIds = new Set(newJob.staleArtifactIds ?? []);
  const newlyStaleArtifactIds = [...afterIds].filter((id) => !beforeIds.has(id));
  const newlyStaleArtifactCount = newlyStaleArtifactIds.length;

  if (newlyStaleArtifactCount === 0) {
    // spec 1 引擎本身已经处理 noop（needs 3.10）；这里 hook 层补 debug 日志
    logStageEditNoop(input.ctx, {
      jobId: input.job.id,
      fromStage: input.fromStage,
      triggeringEndpoint: input.triggeringEndpoint,
      alreadyStaleCount: beforeIds.size,
    });
    // 没新增 stale，但要确保 job 持久化（保险起见，引擎可能返回同引用 = 无写）
    if (newJob !== input.job) {
      input.jobStore.save(newJob);
    }
    return { job: newJob, newlyStaleArtifactIds, newlyStaleArtifactCount };
  }

  // 写回 store
  input.jobStore.save(newJob);

  // info 日志
  logStageEditInvalidated(input.ctx, {
    jobId: input.job.id,
    fromStage: input.fromStage,
    reason: input.reason,
    triggeringEndpoint: input.triggeringEndpoint,
    markedArtifactCount: newlyStaleArtifactCount,
  });

  return { job: newJob, newlyStaleArtifactIds, newlyStaleArtifactCount };
}
```

#### C2.2 与需求的对应

- 需求 3.5：写回 store。
- 需求 3.6：不调 spec 2 端点、不写 `replan.triggered`（本 hook 全程不引用任何 spec 2 符号）。
- 需求 3.7：不修改 DELETE /route-selection（hook 不被该 handler 调用）。
- 需求 3.8：reason 取值复用 spec 1 既有枚举（caller 传入合法 `BlueprintStaleReason`）。
- 需求 3.9：try/catch 包裹引擎调用；引擎异常时返回原 job、modify 不回滚、warn 日志。

### C3. Conflict Detection（`server/routes/blueprint/stage-edit/conflict-detection.ts`）

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "../../../../shared/blueprint/contracts.js";
import {
  getTransitiveDownstreamStages,
} from "../staleness/dependency-graph.js";

const TERMINAL_HANDOFF_STATES = new Set(["confirmed", "reset", "failed", "idle"] as const);

/** 复用 spec 2 running guard 的同款判定，但为 stage-edit 独立维护。 */
export function detectRunningDownstreamForEdit(
  job: BlueprintGenerationJob,
  fromStage: BlueprintGenerationStage,
): BlueprintGenerationStage | null {
  const downstreamOrdered = getTransitiveDownstreamStages(fromStage);
  for (const stage of downstreamOrdered) {
    if (job.stage === stage && job.status === "running") return stage;
    if (
      job.stage === stage &&
      job.handoffState !== undefined &&
      !TERMINAL_HANDOFF_STATES.has(job.handoffState as never)
    ) {
      return stage;
    }
    if (
      job.nextAction !== undefined &&
      job.nextAction.stage === stage &&
      !job.nextAction.type.startsWith("review_") &&
      job.nextAction.type !== "none"
    ) {
      return stage;
    }
  }
  return null;
}
```

需求 4.4 / 4.5 要求与 spec 2 的 `detectRunningDownstream` 在代码上独立。本设计采取：**算法相同、文件物理隔离**——两个文件各自实现一份相同的判定逻辑，不共享 import / export。这样 spec 2 的 guard 修改不影响 spec 3 的 guard，反之亦然（spec 3 §4.5）。共享的只有 spec 1 的 `getTransitiveDownstreamStages`（这是 spec 1 提供的纯函数，不属于 spec 2 / spec 3 任一方）。

### C4. Job Locator（`server/routes/blueprint/stage-edit/job-locator.ts`）

由于 clarification answers / intake 的 modify 路径以 `sessionId` / `intakeId` 为路由参数，而 spec 1 引擎以 `BlueprintGenerationJob` 为输入，本设计需要一个查找器：

```typescript
import type { BlueprintGenerationJob } from "../../../../shared/blueprint/contracts.js";
import type { BlueprintJobStore } from "../job-store.js";

export function findJobByIntakeId(
  jobStore: BlueprintJobStore,
  intakeId: string,
): BlueprintGenerationJob | null {
  // 扫 jobStore.list()，找 request.intakeId === intakeId 的最新 job
  const matched = jobStore.list().filter((j) => j.request.intakeId === intakeId);
  if (matched.length === 0) return null;
  // jobStore.list() 已按 createdAt desc 排序，list[0] 是最新
  return matched[0];
}

export function findJobByClarificationSessionId(
  jobStore: BlueprintJobStore,
  sessionId: string,
): BlueprintGenerationJob | null {
  const matched = jobStore.list().filter((j) => j.request.clarificationSessionId === sessionId);
  if (matched.length === 0) return null;
  return matched[0];
}
```

**关键边界**：

- 如果 `intakeId` / `sessionId` 还没产生过 job（用户在创建 job 之前修改 intake），`findJob*` 返回 null → caller 跳过 invalidation hook、返回既有 modify 响应（无 `staleEdit` 字段）。这是预期行为：尚无 job 即无下游可 stale。
- 如果一个 `sessionId` 关联多个 job（理论上 spec 2 的 branch 模式会创建关联同一 session 的多个 job），本设计选用"最新创建的 job"（`jobStore.list()[0]`）。这是 spec 3 的设计选择：inline edit 修改的是用户当前在 viewing 的最新 job 的下游；branch 模式下用户切到另一 branch 后再 inline edit，前端会用 branch job 的 jobId 走另一条 modify 路径——但 clarification 的 sessionId 是共享的，这里需要一个 **解决方案**：

  spec 3 在 design 阶段做出选择：**clarification 的 inline edit 影响 family 中所有共享同 sessionId 的 job**。即：在 `findJobByClarificationSessionId` 里返回所有匹配的 job，hook 对每一个都执行 invalidation。这样 branch 后修改 clarification answer，parent 与 branch 都被标 stale——这与 spec 2 的语义一致（clarification 是共享上游）。

  本设计采用此选项：

```typescript
export function findJobsByClarificationSessionId(
  jobStore: BlueprintJobStore,
  sessionId: string,
): BlueprintGenerationJob[] {
  return jobStore.list().filter((j) => j.request.clarificationSessionId === sessionId);
}
```

  intake 同理（intakeId 也是 family 共享）：返回所有匹配 job，逐个执行 hook。

  route-selection 的 modify 路径以 `:jobId` 为参数，天然只影响该 job——单一 job hook，不需要扩散。

### C5. Intake PATCH Route（`server/routes/blueprint/stage-edit/intake-patch-route.ts`）

#### C5.1 端点形态

```typescript
import type { Request, Response } from "express";
import { runAutoInvalidationHook } from "./auto-invalidation-hook.js";
import { detectRunningDownstreamForEdit } from "./conflict-detection.js";
import { findJobsByIntakeId } from "./job-locator.js";
import { detectIntakeNoop } from "./intake-noop-detector.js";
import { validateIntakePatch } from "./intake-patch-validator.js";

export function createIntakePatchHandler(deps: {
  blueprintStores: BlueprintIntakeStores;
  jobStore: BlueprintJobStore;
  ctx: Pick<BlueprintServiceContext, "logger" | "now">;
}) {
  return (req: Request, res: Response) => {
    const intakeId = req.params.intakeId;
    const intake = deps.blueprintStores.intakes.get(intakeId);
    if (!intake) {
      res.status(404).json({ error: "intake_not_found" });
      return;
    }

    const validation = validateIntakePatch(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // noop 检测：与既有值在结构上等价
    const isNoop = detectIntakeNoop(intake, validation.patch);

    // running guard：扫所有共享 intakeId 的 job，任一 running 即 409
    const matchingJobs = findJobsByIntakeId(deps.jobStore, intakeId);
    for (const job of matchingJobs) {
      const running = detectRunningDownstreamForEdit(job, "input");
      if (running) {
        deps.ctx.logger.warn("[blueprint-stage-edit] intake patch blocked", {
          event: "stage_edit.blocked",
          jobId: job.id,
          triggeringEndpoint: "intake_patch",
          runningStage: running,
        });
        res.status(409).json({ error: "downstream_running", runningStage: running });
        return;
      }
    }

    // 写入 intake（既有方式）
    const updatedIntake: BlueprintIntake = {
      ...intake,
      targetText: validation.patch.targetText ?? intake.targetText,
      githubUrls: validation.patch.githubUrls ?? intake.githubUrls,
      updatedAt: deps.ctx.now(),
    };
    deps.blueprintStores.intakes.set(intakeId, updatedIntake);

    // 如果是 noop，仍写入 updatedAt（既有约定），但跳过 hook
    if (isNoop || matchingJobs.length === 0) {
      res.status(200).json({ intake: updatedIntake });
      return;
    }

    // hook：对每个匹配 job 执行 invalidation
    let aggregateNewlyStale: string[] = [];
    let aggregateSnapshot: string[] = [];
    for (const job of matchingJobs) {
      const result = runAutoInvalidationHook({
        job,
        fromStage: "input",
        reason: "upstream_target_changed",
        triggeringEndpoint: "intake_patch",
        triggeringArtifactId: intakeId,
        triggeringArtifactType: "intake",
        jobStore: deps.jobStore,
        ctx: deps.ctx,
      });
      aggregateNewlyStale = aggregateNewlyStale.concat(result.newlyStaleArtifactIds);
      aggregateSnapshot = result.job.staleArtifactIds ?? [];  // 取最后一次的快照（latest job）
    }

    res.status(200).json({
      intake: updatedIntake,
      staleEdit: {
        fromStage: "input",
        newlyStaleArtifactIds: aggregateNewlyStale,
        newlyStaleArtifactCount: aggregateNewlyStale.length,
        staleArtifactIdsSnapshot: aggregateSnapshot,
      },
    });
  };
}
```

#### C5.2 路由注册（`server/routes/blueprint.ts` 内追加）

紧邻既有 `router.get("/intake/:intakeId", ...)` 之后：

```typescript
import { createIntakePatchHandler } from "./blueprint/stage-edit/intake-patch-route.js";

router.patch(
  "/intake/:intakeId",
  createIntakePatchHandler({
    blueprintStores,
    jobStore,
    ctx: blueprintServiceContext,
  }),
);
```

### C6. Clarification Answers Hook 接线

在既有 `handleClarificationAnswers` 内追加 hook（不替换主体）：

```typescript
// 在 server/routes/blueprint.ts 修改既有 handleClarificationAnswers
// 既有代码（参见 server/routes/blueprint.ts L650-676）保持不变；只在 res.json 之前追加 hook 调用。

const handleClarificationAnswers = (req: Request, res: Response) => {
  const session = blueprintStores.clarificationSessions.get(req.params.sessionId);
  if (!session) { /* 既有 */ return; }

  const parsed = parseClarificationAnswersRequest(req.body);
  if (!parsed.ok) { /* 既有 */ return; }

  // ── spec 3 hook 起 ──
  const matchingJobs = findJobsByClarificationSessionId(jobStore, session.id);

  // running guard
  for (const job of matchingJobs) {
    const running = detectRunningDownstreamForEdit(job, "clarification");
    if (running) {
      blueprintServiceContext.logger.warn("[blueprint-stage-edit] clarification blocked", {
        event: "stage_edit.blocked",
        jobId: job.id,
        triggeringEndpoint: "clarification_answers",
        runningStage: running,
      });
      res.status(409).json({ error: "downstream_running", runningStage: running });
      return;
    }
  }

  // noop 检测：在调 updateClarificationSession 之前对 prev 与 patch 做 deep compare
  const prevAnswers = session.answers;
  const isNoop = detectClarificationAnswersNoop(prevAnswers, parsed.request.answers);
  // ── spec 3 hook 检测段结束 ──

  const updated = updateClarificationSession(session, parsed.request.answers, {
    now: deps.now,
    stores: blueprintStores,
  });

  // ── spec 3 hook 写入段 ──
  if (!isNoop && matchingJobs.length > 0) {
    let aggregateNewlyStale: string[] = [];
    let aggregateSnapshot: string[] = [];
    for (const job of matchingJobs) {
      const result = runAutoInvalidationHook({
        job,
        fromStage: "clarification",
        reason: "upstream_clarification_changed",
        triggeringEndpoint: "clarification_answers",
        triggeringArtifactId: session.id,
        triggeringArtifactType: "clarification_session",
        jobStore,
        ctx: blueprintServiceContext,
      });
      aggregateNewlyStale = aggregateNewlyStale.concat(result.newlyStaleArtifactIds);
      aggregateSnapshot = result.job.staleArtifactIds ?? [];
    }
    res.json({
      session: updated,
      staleEdit: {
        fromStage: "clarification",
        newlyStaleArtifactIds: aggregateNewlyStale,
        newlyStaleArtifactCount: aggregateNewlyStale.length,
        staleArtifactIdsSnapshot: aggregateSnapshot,
      },
    });
    return;
  }
  // ── spec 3 hook 写入段结束 ──

  res.json({ session: updated });
};
```

需求 3.4 noop 跳过：spec 3 在调 `updateClarificationSession` 之前做 noop 检测。如果 noop，仍调用 `updateClarificationSession`（既有行为：刷新 `updatedAt`），但跳过 hook（不发 `info` 日志，发 `debug` 日志）。

### C7. Route Reselection Hook 接线

`POST /jobs/:jobId/route-selection` 路由（既有）：

```typescript
// 既有 router.post("/jobs/:jobId/route-selection", ...) 改造
// 在调 selectRouteForSpecTree 之前追加 spec 3 hook，仅在"二次或后续调用"时触发。

router.post("/jobs/:jobId/route-selection", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) { /* 既有 404 */ return; }

  const routeSet = extractRouteSet(job);
  if (!routeSet) { /* 既有 409 */ return; }

  const parsed = parseRouteSelectionRequest(req.body);
  if (!parsed.ok) { /* 既有 400 */ return; }

  const route = routeSet.routes.find((item) => item.id === parsed.request.routeId);
  if (!route) { /* 既有 404 */ return; }

  // ── spec 3 hook 起 ──
  // 检测是否是"二次或后续调用"
  const existingSelection = extractRouteSelection(job);
  const isReselection = existingSelection !== null && existingSelection.routeId !== undefined;

  // 仅在 reselection 时检测 running
  if (isReselection) {
    const running = detectRunningDownstreamForEdit(job, "route_generation");
    if (running) {
      blueprintServiceContext.logger.warn("[blueprint-stage-edit] route reselect blocked", {
        event: "stage_edit.blocked",
        jobId: job.id,
        triggeringEndpoint: "route_reselection",
        runningStage: running,
      });
      res.status(409).json({ error: "downstream_running", runningStage: running });
      return;
    }
  }
  // ── spec 3 hook 检测段结束 ──

  const response = await selectRouteForSpecTree(job, routeSet, parsed.request, {
    now: deps.now,
    store: jobStore,
    ctx: blueprintServiceContext,
  });

  // 既有 eventBus 事件（不修改）
  if (blueprintServiceContext.eventBus) { /* 既有 emit 路径 */ }

  // ── spec 3 hook 写入段 ──
  let staleEdit: BlueprintStaleEditResultSummary | undefined;
  if (isReselection) {
    // 注意：selectRouteForSpecTree 已经把 routeSelection / spec_tree / agent_crew 重新生成了
    //   这导致下游 stage 的 artifact 也发生变化（部分被新 artifact 替换）
    //   spec 3 hook 仍要在 selectRouteForSpecTree 之后调用 invalidateDownstream，
    //   原因是 spec_docs / effect_preview / prompt_packaging / runtime / engineering 等
    //   更下游的 artifact 既未被 selectRouteForSpecTree 重新生成，也未被标 stale；
    //   spec 3 hook 在这里补 stale 标记。
    const updatedJob = jobStore.get(job.id) ?? response.job;  // 取写入后最新 job
    const result = runAutoInvalidationHook({
      job: updatedJob,
      fromStage: "route_generation",
      reason: "upstream_route_selection_changed",
      triggeringEndpoint: "route_reselection",
      triggeringArtifactId: response.selection.id,
      triggeringArtifactType: "route_selection",
      jobStore,
      ctx: blueprintServiceContext,
    });
    staleEdit = {
      fromStage: "route_generation",
      newlyStaleArtifactIds: result.newlyStaleArtifactIds,
      newlyStaleArtifactCount: result.newlyStaleArtifactCount,
      staleArtifactIdsSnapshot: result.job.staleArtifactIds ?? [],
    };
  }
  // ── spec 3 hook 写入段结束 ──

  // Task 14.4 既有 hook 不变
  blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
    jobId: response.job.id,
    stageId: "spec_tree",
    transition: "stage_started",
    job: response.job,
  });

  res.status(201).json(staleEdit ? { ...response, staleEdit } : response);
});
```

需求 3.3 / 3.4：仅在"二次或后续调用"且实际写入了不同 routeId（或同 routeId 强制重选）时触发 hook；首次选择不触发。`isReselection` 通过 `extractRouteSelection(job)` 是否返回非 null 判定。

### C8. Stage Edit Logger（`stage-edit-logger.ts`）

```typescript
export function logStageEditInvalidated(
  ctx: Pick<BlueprintServiceContext, "logger">,
  payload: {
    jobId: string;
    fromStage: BlueprintGenerationStage;
    reason: BlueprintStaleReason;
    triggeringEndpoint: "intake_patch" | "clarification_answers" | "route_reselection";
    markedArtifactCount: number;
  },
): void {
  ctx.logger.info("[blueprint-stage-edit] stage_edit.invalidated", {
    event: "stage_edit.invalidated",
    jobId: payload.jobId,
    fromStage: payload.fromStage,
    reason: payload.reason,
    triggeringEndpoint: payload.triggeringEndpoint,
    markedArtifactCount: payload.markedArtifactCount,
  });
}

export function logStageEditNoop(
  ctx: Pick<BlueprintServiceContext, "logger">,
  payload: {
    jobId: string;
    fromStage: BlueprintGenerationStage;
    triggeringEndpoint: "intake_patch" | "clarification_answers" | "route_reselection";
    alreadyStaleCount: number;
  },
): void {
  ctx.logger.debug("[blueprint-stage-edit] stage_edit.noop", {
    event: "stage_edit.noop",
    jobId: payload.jobId,
    fromStage: payload.fromStage,
    triggeringEndpoint: payload.triggeringEndpoint,
    alreadyStaleCount: payload.alreadyStaleCount,
  });
}
```

需求 11.6 要求事件键前缀与 spec 2 区分：本设计统一用 `stage_edit.*` 前缀。

### C9. Frontend EditModeField（`client/src/pages/autopilot/stage-edit/EditModeField.tsx`）

#### C9.1 状态机

```typescript
type EditModeState =
  | { kind: "view" }                                          // 默认展示态
  | { kind: "editing"; draftValue: string; originalValue: string }
  | { kind: "submitting"; draftValue: string; originalValue: string }
  | { kind: "error"; draftValue: string; originalValue: string; lastError: ErrorState };
```

转移：

- `view` + 用户点 edit 图标 → `editing`，`draftValue = originalValue`
- `editing` + 用户输入 → `editing`（`draftValue` 更新）
- `editing` + Enter / confirm → `submitting`
- `editing` + Esc / cancel → `view`，`draftValue` 丢弃
- `submitting` + 2xx → store 更新完成 → `view`（用新值）
- `submitting` + 4xx/5xx → `error`（`draftValue` 保留）
- `submitting` + 409 downstream_running → `error`（"正在生成 [stage]，请等待完成"）
- `error` + 用户继续输入 → `editing`（清错）
- `error` + cancel → `view`

#### C9.2 组件签名

```tsx
export interface EditModeFieldProps {
  fieldKey: string;                          // e.g. "intake.targetText" / "clarification.q-001" / "route_generation.selectedRouteId"
  fromStage: BlueprintGenerationStage;       // "input" / "clarification" / "route_generation"
  currentValue: string;
  isViewingCompletedStage: boolean;
  isAdvancingThroughStage: boolean;          // 推进路径上的当前 stage（非 viewing-completed）
  isStaticPreview: boolean;
  renderControl: (props: {                    // 渲染 input / textarea / select 等
    value: string;
    onChange: (next: string) => void;
    disabled: boolean;
  }) => ReactNode;
  onSubmit: (newValue: string) => Promise<EditSubmitResult>;
  downstreamImpact: DownstreamImpact;        // 用于 InlineConfirmation 文案派生
}

export type EditSubmitResult =
  | { ok: true; staleEdit?: BlueprintStaleEditResultSummary }
  | { ok: false; error: { kind: "downstream_running" | "validation" | "network"; runningStage?: BlueprintGenerationStage; message: string } };
```

需求 1.5：仅在 `isViewingCompletedStage === true` 且当前 stage 在 input / clarification / route_generation 时才渲染 edit 图标；如 `isAdvancingThroughStage === true`，渲染既有"输入 / 提交"控件（即 `renderControl` 直接返回控件，不挂 edit 图标）。

需求 1.6：`view` 态显示当前值 + 紧邻 edit 图标（`data-testid="autopilot-edit-${fieldKey}"`）。

需求 1.7：`Enter` / `Esc` 键盘交互在 `editing` 态生效。

需求 1.8：禁止 URL query / 快捷键 / socket 自动进入 editing 态——本组件 state 只能由用户点击 edit 图标 / 输入 / Esc / confirm 触发，不暴露任何 setState 给外部 props 控制。

需求 12.6：`isStaticPreview === true` 时 edit 图标整体禁用（`aria-disabled="true"` 且不响应点击 / Enter / Space），rendered control 也保持 disabled。

### C10. Frontend InlineConfirmation（`InlineConfirmation.tsx`）

```tsx
export interface InlineConfirmationProps {
  fromStage: BlueprintGenerationStage;
  downstreamImpact: DownstreamImpact;
  onConfirm: () => void;
  onCancel: () => void;
  inFlight: boolean;
  errorState: ErrorState | null;
}

export function InlineConfirmation(props: InlineConfirmationProps) {
  const message = props.downstreamImpact.size === 0
    ? "无下游内容，将直接保存"
    : `保存修改将使 ${props.downstreamImpact.size} 个下游内容过期，确认？`;

  return (
    <div className="..." role="group" aria-label="字段编辑确认">
      <span>{message}</span>
      {props.errorState && <span className="text-error">{props.errorState.message}</span>}
      <button
        type="button"
        data-testid="autopilot-edit-confirm"
        disabled={props.inFlight}
        onClick={props.onConfirm}
      >
        确认
      </button>
      <button
        type="button"
        data-testid="autopilot-edit-cancel"
        onClick={props.onCancel}
      >
        取消
      </button>
    </div>
  );
}
```

需求 2.8 / 2.9 / 2.11：

- 视觉与 spec 2 modal 完全独立：本组件是 inline div（不是 dialog），样式 token 不同（小尺寸 / 边框 / 紧邻字段），DOM 位置在字段旁；spec 2 的 `ReplanConfirmationModal` 是 radix Dialog overlay。
- 不复用 `<Dialog>` / `<DialogContent>`。
- 不提供"创建新分支"选项：本组件只有 confirm / cancel 两个按钮。

需求 2.4：cancel / Esc → `EditModeField` 切回 `view`，丢弃 draft。

需求 2.5 / 2.7：confirm → `submitting` 态，按钮 disabled、发起 modify 请求；2xx 后 store 更新完成再切 `view`。

需求 8.3：本组件文件中**禁止 import** spec 2 的任何模块（`ReplanConfirmationModal` / `ReplanButton` 等）；通过 ESLint rule 或单测断言保护。

### C11. Frontend Inline Edit Flow Hook（`use-inline-edit-flow.ts`）

```typescript
export function useInlineEditFlow(jobId: string | null) {
  const rightRailRetry = useAutopilotRightRailRetry();

  return useCallback(
    async (
      fromStage: BlueprintGenerationStage,
      submit: () => Promise<unknown>,        // 由具体字段组件提供（POST /clarifications/.../answers / PATCH /intake/... / POST /jobs/.../route-selection）
    ): Promise<EditSubmitResult> => {
      if (!jobId) return { ok: false, error: { kind: "validation", message: "no_active_job" } };
      try {
        const response = await submit();
        const staleEdit = (response as any).staleEdit as BlueprintStaleEditResultSummary | undefined;
        rightRailRetry();    // 拉新 job 数据
        if (staleEdit && staleEdit.newlyStaleArtifactCount > 0) {
          toast.success(
            `已保存修改，${staleEdit.newlyStaleArtifactCount} 个下游内容已标记为过期`,
          );
        } else {
          toast.success("已保存修改");
        }
        return { ok: true, staleEdit };
      } catch (err) {
        if (err instanceof BlueprintInlineEditError) {
          if (err.status === 409 && err.errorCode === "downstream_running") {
            return {
              ok: false,
              error: {
                kind: "downstream_running",
                runningStage: err.runningStage,
                message: `正在生成 ${stageZh(err.runningStage)}，请等待完成`,
              },
            };
          }
          return { ok: false, error: { kind: "validation", message: err.message } };
        }
        return { ok: false, error: { kind: "network", message: String(err) } };
      }
    },
    [jobId, rightRailRetry],
  );
}
```

需求 7.2：成功后**保持当前页面 / sub-stage 不变**——本 hook 不调 `resetPin()` / 不修改 `workflowStageOverride`。

需求 7.3 / 7.4：成功 toast 文案两种：有 stale → "已保存修改，N 个下游内容已标记为过期"；无 stale → "已保存修改"。

需求 7.5：socket 推送的 stale.updated / staleArtifactIds 同步事件由既有 socket-relay 路径消费；本 hook 不监听 socket，仅通过 `rightRailRetry()` 主动拉数据避免重复重置。

需求 7.6：`rightRailRetry()` 触发既有 hook 重新 fetch + dispatch；同一 React batch 内重新渲染 StaleBadge / RightRailStaleIndicator。

### C12. Frontend StaleBadge（`StaleBadge.tsx`）

```tsx
export interface StaleBadgeProps {
  staleSince: string | undefined;          // ISO 8601
  invalidatedBy: BlueprintStaleSource | undefined;
}

export function StaleBadge(props: StaleBadgeProps) {
  if (!props.staleSince || !props.invalidatedBy) return null;
  const tooltip = `由 ${stageZh(props.invalidatedBy.stage)} 在 ${formatLocalTime(props.invalidatedBy.triggeredAt)} 修改导致`;
  return (
    <span
      className="..."  // 黄色警告 token
      title={tooltip}
      data-testid="autopilot-stale-badge"
      role="status"
    >
      已过期
    </span>
  );
}
```

需求 5.1 / 5.4：`staleSince` 缺失时返回 null（不渲染）。

需求 5.5：纯展示组件，无 `onClick` / 无操作语义。

需求 5.6：与 spec 2 `ReplanConfirmationModal` 中"将受影响"列表共用同一警告色 token（`--color-warn-bg` / `--color-warn-fg`）。

需求 5.2：在 spec_tree node 视图、spec_documents 卡片、effect_preview 瓷砖三处必须接入。具体接入点位由 design 阶段对齐既有组件结构：

- spec_tree node 视图：`client/src/pages/autopilot/right-rail/spec-tree-workbench/SpecTreeNodeRow.tsx`（或等效）
- spec_documents 卡片：既有 SpecDocPreviewBlock 顶部
- effect_preview 瓷砖：既有 EffectPreviewTile 顶部

### C13. Frontend RightRailStaleIndicator（`RightRailStaleIndicator.tsx`）

```tsx
export interface RightRailStaleIndicatorProps {
  currentSubStage: AutopilotRailSubStage;   // 当前查看的 sub-stage
  artifact: BlueprintGenerationArtifact;    // 当前 sub-stage 对应的 artifact
  isUpstreamRunning: boolean;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

export function RightRailStaleIndicator(props: RightRailStaleIndicatorProps) {
  if (!props.artifact.staleSince) return null;
  const buttonLabel = perStageRegenerateLabel(props.currentSubStage);
  const disabled = props.isUpstreamRunning || props.isRegenerating;
  const hint = props.isUpstreamRunning ? "等待上游生成完成" : null;

  return (
    <div className="..." data-testid="autopilot-right-rail-stale-indicator">
      <span>此内容已过期</span>
      <button
        type="button"
        data-testid="autopilot-per-stage-regenerate"
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && props.onRegenerate()}
      >
        {buttonLabel}
      </button>
      {hint && <span>{hint}</span>}
    </div>
  );
}
```

需求 6.1 / 6.2：`artifact.staleSince` 非空才渲染；fresh 时不占位。

需求 6.3：`perStageRegenerateLabel` 按 sub-stage 分发文案：spec_tree → "重新派生 SPEC 树"、spec_documents → "重新生成文档"、effect_preview → "重新生成预览"，其余 stage 由 design 阶段视既有 stage-specific 端点决定（本 spec 至少要求覆盖前述 3 类）。

需求 6.4：本组件不调 `POST /replan`；`onRegenerate` 由 caller 提供（见 C14 hook）。

需求 6.6 / 6.7：disabled 态由 caller 通过 `isUpstreamRunning` / `isRegenerating` 控制。

需求 6.8：本组件位于右栏顶部（在 StageHeader 之上、StageContent 之前），不与"返回当前阶段"按钮抢同一行——`AutopilotRightRail.tsx` 在渲染时把 stale indicator 放在 `StageViewport` 的 `header` slot 之外的额外槽位。

### C14. Frontend Per-Stage Regenerate Hook（`use-per-stage-regenerate.ts`）

```typescript
export function usePerStageRegenerate(jobId: string | null, currentSubStage: AutopilotRailSubStage) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const rightRailRetry = useAutopilotRightRailRetry();

  return {
    isRegenerating,
    onRegenerate: useCallback(async () => {
      if (!jobId) return;
      setIsRegenerating(true);
      try {
        switch (currentSubStage) {
          case "spec_tree":
            // 触发 POST /jobs/:jobId/route-selection（重新派生）
            await postBlueprintRouteSelection(jobId, { /* 复用既有选中 routeId */ });
            break;
          case "spec_documents":
            await postBlueprintSpecDocuments(jobId);
            break;
          case "effect_preview":
            await postBlueprintEffectPreviews(jobId);
            break;
          default:
            // 其他 sub-stage 由 design 阶段视既有端点决定
            break;
        }
        rightRailRetry();
      } finally {
        setIsRegenerating(false);
      }
    }, [jobId, currentSubStage, rightRailRetry]),
  };
}
```

需求 6.4：本 hook **不**调 `postBlueprintReplan`（spec 2 端点）。

需求 6.5：完成后通过 `rightRailRetry()` 重新拉 job；spec 1 引擎已经在 stage-specific 端点的 caller 路径上保证了"重新生成会刷新 staleSince"——本 spec 不在 stage-specific 端点内追加 invalidation 调用（这部分在 design 阶段对齐既有路径的清除语义；本 spec 不强制）。

### C15. Frontend AutopilotRoutePage 接线

在 `client/src/pages/autopilot/AutopilotRoutePage.tsx` 的页面 1 渲染区域（`stage === "input" | "clarification" | "route_generation"` 时的渲染分支）内，把既有字段控件包到 `EditModeField` 中：

```tsx
// 伪代码示意
{viewingPage === 1 && (
  <>
    {/* input stage */}
    <EditModeField
      fieldKey="intake.targetText"
      fromStage="input"
      currentValue={intake.targetText}
      isViewingCompletedStage={isViewingCompletedStage}
      isAdvancingThroughStage={activeStageKey === "input"}
      isStaticPreview={isStaticPreview}
      renderControl={(props) => <textarea {...props} />}
      onSubmit={(newValue) => patchIntake(intake.id, { targetText: newValue })}
      downstreamImpact={inputDownstreamImpact}
    />

    {intake.githubUrls.map((url, idx) => (
      <EditModeField
        key={url}
        fieldKey={`intake.githubUrls.${idx}`}
        fromStage="input"
        currentValue={url}
        ...
        onSubmit={(newValue) => patchIntake(intake.id, {
          githubUrls: replaceAt(intake.githubUrls, idx, newValue),
        })}
      />
    ))}

    {/* clarification stage */}
    {clarificationSession.questions.map((q) => (
      <EditModeField
        key={q.id}
        fieldKey={`clarification.${q.id}`}
        fromStage="clarification"
        currentValue={getAnswerValue(clarificationSession, q.id)}
        ...
        onSubmit={(newValue) => postClarificationAnswers(clarificationSession.id, {
          answers: [{ questionId: q.id, value: newValue, ... }],
        })}
      />
    ))}

    {/* route_generation stage */}
    <EditModeField
      fieldKey="route_generation.selectedRouteId"
      fromStage="route_generation"
      currentValue={currentSelection.routeId}
      ...
      renderControl={(props) => (
        <select {...props}>
          {routeSet.routes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      )}
      onSubmit={(newRouteId) => postBlueprintRouteSelection(jobId, { routeId: newRouteId })}
    />
  </>
)}
```

需求 1.4：spec_tree / spec_docs / preview / effect_preview / prompt_packaging / runtime / engineering_handoff / engineering_landing 等 stage 的渲染区域**不**挂 EditModeField；这些 stage 在 viewing-completed 模式下继续保持只读。

## 数据模型

| 名称 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `BlueprintIntakePatchRequest` | `shared/blueprint/contracts.ts` | interface | 新增 |
| `BlueprintStaleEditResultSummary` | `shared/blueprint/contracts.ts` | interface | 三条 modify 端点响应中的可选追加字段 |
| `EditModeState` | `client/src/pages/autopilot/stage-edit/EditModeField.tsx` | discriminated union | 字段级状态机 |
| `EditSubmitResult` | 同上 | union | submit hook 返回值 |

## 错误处理

| 场景 | HTTP | 错误码 | 日志 |
|---|---|---|---|
| `intakeId` 不存在（PATCH） | 404 | `intake_not_found` | 既有路由风格 |
| intake patch body 非法 | 400 | `invalid_intake_patch` | debug |
| 任一 modify 端点检测到下游 running | 409 | `downstream_running` + `runningStage` | `stage_edit.blocked` warn |
| modify 业务成功 + invalidation 引擎抛错 | 200 | — | warn 级 invalidation 失败日志；返回响应中无 `staleEdit` 字段 |
| modify 业务成功 + 实际写入新值 + 有下游 | 200 | — | `stage_edit.invalidated` info |
| modify 业务成功 + noop 或无关联 job | 200 | — | `stage_edit.noop` debug（仅有关联 job 时） |
| route reselection 首次调用 | 201 | — | 无 spec 3 hook 触发 |

## 测试策略

### T1. `intake-modify-invalidation.test.ts`（property + example）

#### Property tests（≥ 100 iterations）

- **传递下游全 stale**：随机 fixture job + intake patch → 调 `PATCH /intake/:intakeId` → 所有下游 stage 的 artifact 的 `staleSince` 字段非空（spec 1 已验证传递性，本 spec 验证 hook 接线确实触达引擎）。
- **同字段两次幂等**：连续两次 `PATCH /intake` 用相同 patch → 第二次的 `staleArtifactIds` 与第一次结构等价（沿用 spec 1 §4 幂等性）。
- **noop 修改无下游 stale**：patch body 与既有 intake 在结构上等价 → 响应中无 `staleEdit` 字段；`debug` 日志触发；`info` 日志不触发。

#### Example tests

- 新建 intake → 创建 job → PATCH intake.targetText → 200 + `staleEdit.staleArtifactIdsSnapshot` 包含所有下游 artifact id。
- intake 不存在 → 404 + `intake_not_found`。
- patch body 类型非法 → 400 + `invalid_intake_patch`。
- PATCH 时下游 stage running → 409 + `downstream_running`，job 字段不变（请求前后 deep snapshot equality）。
- 同一 intake 关联两个 job（branch 后）→ PATCH 触发对两个 job 都执行 invalidation。

### T2. `clarification-modify-invalidation.test.ts`（property + example）

#### Property tests（≥ 100 iterations）

- **传递下游全 stale**：随机 session + answers → POST /clarifications/.../answers → 下游 artifact 全 stale。
- **noop 修改不写 marker**：answers 与既有 answers 元素层等价 → 无 `staleEdit` 字段、无 `info` 日志。
- **同字段编辑两次幂等**。

#### Example tests

- session 不存在 → 既有 404。
- POST 与 PATCH 两个方法都触发 hook（既有 router 把两者绑同 handler）。
- running 时 → 409 + `downstream_running`；session 字段不变；invalidation hook 未调用。

### T3. `route-selection-reselection.test.ts`（property + example）

#### Property tests（≥ 100 iterations）

- **首次调用不触发 invalidation**：job 上无 routeSelection → POST → 响应无 `staleEdit` 字段；下游 artifact `staleSince` 全为 undefined（除非 fixture 预先设置）。
- **二次或后续调用触发 invalidation**：job 上已有 routeSelection → POST 同 routeId 或不同 routeId → 响应有 `staleEdit` 字段。
- **同 routeId 重复重选幂等**：第二次重选与第一次产生的 `staleArtifactIds` 元素层相等。

#### Example tests

- 首次 + 不同 routeId → 201 + 无 staleEdit。
- 首次 + 不存在的 routeId → 既有 404。
- reselect + 不同 routeId → 201 + staleEdit 含 newlyStaleArtifactIds。
- reselect + 同 routeId（强制重选）→ 也触发 hook（因为 selectRouteForSpecTree 重新生成了下游 spec_tree 等）。
- reselect 时下游 running → 409 + downstream_running。
- DELETE /route-selection 不触发 hook（既有破坏性重置端点保持原语义）。

### T4. Frontend 组件测试

- **EditModeField.test.tsx**：
  - `isViewingCompletedStage === false` → 不挂 edit 图标
  - stage ∈ {spec_tree, spec_docs, ...} → 不挂 edit 图标
  - Enter / Esc / cancel 键盘行为
  - 4xx / 5xx 错误重新启用按钮 + 保留 draftValue
  - 409 downstream_running → 文案"正在生成 [stage]，请等待完成"
- **InlineConfirmation.test.tsx**：
  - N >= 1 时文案含 "N 个下游内容过期"
  - N === 0 时文案 "无下游内容，将直接保存"
  - 不复用 spec 2 modal 组件（断言 `data-testid="autopilot-replan-from-stage-divider"` 不在 DOM）
- **StaleBadge.test.tsx**：
  - `staleSince` 非空 → 渲染
  - `staleSince === undefined` → 不渲染
  - hover tooltip 文案断言
- **RightRailStaleIndicator.test.tsx**：
  - artifact 是 stale → 渲染
  - artifact fresh → 不渲染（且不占位）
  - 上游 running → 按钮 disabled + hint
- **use-inline-edit-flow.test.tsx**：
  - 成功 + 有 stale → toast 文案 N 个
  - 成功 + 无 stale → toast 文案"已保存修改"
  - 不调 resetPin / 不修改 workflowStageOverride
- **use-per-stage-regenerate.test.tsx**：
  - 不调 postBlueprintReplan（spec 2 端点）
  - 调对应 stage-specific 端点

### T5. Fixtures（`__fixtures__/build-fixture-job.ts`）

复用 spec 1 / spec 2 的 fixtures，新增：

- `buildFixtureIntake(overrides?)`
- `buildFixtureClarificationSession(overrides?)`
- `buildJobLinkedToIntakeAndSession({ intakeId, sessionId, fromStage })`：构造 request 字段已设置的 job。

### T6. 测试运行

- 测试位置：`server/routes/blueprint/stage-edit/__tests__/` + `client/src/pages/autopilot/stage-edit/__tests__/`
- runner：既有 server / client vitest 配置

## 与需求的全量对照

| 需求 | 落地点 |
|---|---|
| 1.1–1.8（上游字段可编辑化） | C9 / C15 |
| 2.1–2.9（Inline Confirmation + 提交 / 取消） | C9.1 / C10 / C11 |
| 3.1–3.9（Auto Invalidation Hook） | C2 / C5 / C6 / C7 |
| 4.1–4.5（Conflict Detection） | C3 / C5 / C6 / C7 |
| 5.1–5.6（Stale Badge） | C12 |
| 6.1–6.8（Right Rail Stale Indicator + Per-Stage Regenerate） | C13 / C14 |
| 7.1–7.7（Frontend Store 协调） | C11 |
| 8.1–8.6（与 spec 2 关系） | C2 不调 spec 2 端点 / C10 不复用 spec 2 modal / C8 日志键 `stage_edit.*` 与 `replan.*` 互斥 |
| 9.1–9.5（与 spec 1 关系） | C2 仅以 caller 身份调引擎 / 不导出 clear-marker |
| 10.1–10.8（属性 + 示例测试） | T1–T6 |
| 11.1–11.6（日志） | C8 |
| 12.1–12.7（向后兼容） | 全文未触及任一既有字段 / 既有路由（仅追加可选字段） |
| 13.1–13.9（范围边界） | 设计层未引入 spec 4 / spec 5 范围内的代码 |

## 实施风险与对冲

| 风险 | 对冲 |
|---|---|
| `findJobsByClarificationSessionId` 在 family 多 job 场景下逐个调用 hook 导致 O(n) save | n 通常 ≤ 5（branch 数有限）；jobStore.save 是内存或文件 IO，影响可接受 |
| `route-selection` 首次 vs 二次的判定（`extractRouteSelection` 的语义） | 通过 example test 明确两条分支；如 selectRouteForSpecTree 内部已重写 routeSelection，本 spec 在 caller 处先抓 `extractRouteSelection(job)` 快照判 isReselection |
| spec 3 hook 在 `selectRouteForSpecTree` 之后调用 invalidateDownstream，而 selectRouteForSpecTree 自身已经把 spec_tree / agent_crew 重新生成 | 这是预期：spec 3 hook 标 stale 的是 spec_docs / effect_preview / prompt_packaging / runtime / engineering 等更下游 stage；selectRouteForSpecTree 重生成后 spec_tree / agent_crew 自然已 fresh，不会被 hook 错标 stale（因为引擎只看 staleSince；如 selectRouteForSpecTree 没重置 staleSince 就是其内部缺陷，由 design 阶段确认） |
| inline edit 路径上没有 jobId 可用（intake / session 还没生成 job） | C4 显式约定：`findJobs* === []` 时跳过 hook、返回既有响应（无 staleEdit 字段）；前端 toast 显示"已保存修改"（无下游分支） |
| `BlueprintIntake` 的 PATCH 端点是新增的 | 需求 12.2 允许新增端点（明确列出"既有路由不修改"，PATCH 是新增、不在该列表）；本 spec 视为新增 |
| EditModeField 在静态预览模式下整体禁用，可能让用户误以为页面坏了 | hover tooltip 提示"静态预览模式不支持编辑"或等效 |
| 三条 modify 端点的响应 schema 追加 staleEdit 字段后，既有前端不消费会忽略；新前端解析时如果 staleEdit 存在但内容不合规会怎样 | 因为 staleEdit 是可选追加，既有前端忽略安全；新前端通过 zod / runtime 校验避免崩溃 |

## 下游 spec 的接线点位（不在本 spec 实施）

| 下游 spec | 接线 |
|---|---|
| spec 4（stage-version-history） | 不依赖 spec 3；spec 4 直接读 `job.staleArtifactIds` 渲染 family 内每个 job 的 stale 状态 |
| spec 5（stage-state-coordination） | spec 5 把 `useInlineEditFlow` 的多 store 写入聚合到 `Atomic_Refresh_Mediator`；把 toast 调用改走 `Toast_Queue`；inline edit 不触发 stage transition 动画（页面停留），spec 5 不接管 |
