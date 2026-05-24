# 设计文档：Autopilot Replan And Branch Action

## 概览

本设计落地 spec 2 的全部需求：用户在 `AutopilotRightRail.tsx` 的 stage divider 上点击"从这里重新规划"按钮，弹出全屏 `Replan_Confirmation_Modal`，选择 `mode = "in_place" | "branch"` 后调 `POST /api/blueprint/jobs/:jobId/replan`，后端调用 spec 1 引擎或创建 branch job，写一条 `replan.triggered` 事件，前端按 mode 协调本地 store。

设计的三个不变量：

1. **spec 1 是被动调用方**：本 spec 唯一接线点是 spec 1 的 `invalidateDownstreamWithLog`（`mode = "in_place"`）；引擎签名 / 依赖图 / 枚举 / 路由全部零修改。
2. **显式意图通路与 spec 3 严格分离**：本 spec 的端点 / modal / 事件键 / 日志键 / 字段位置都是独立的；spec 3 的 inline edit 端点不会以任何形态调用 `POST /replan`，反向也不会。
3. **branch 是 tree 不是 chain**：连续两次从同一 fromStage 触发 branch replan，新 job 都指向 **原始 jobId** 作为 `parentJobId`，不是上一次 branch 的 jobId（spec 2 §10.2 第 4 条性质）。

## 架构

### 模块边界与文件布局

```
shared/blueprint/contracts.ts                    ← 仅追加 3 个可选字段：parentJobId? / branchedAt? / branchedFromStage?
shared/blueprint/index.ts                        ← re-export 新类型（如有）
server/routes/blueprint/
  replan/
    types.ts                                     ← BlueprintReplanRequest / Response / ReplanMode 类型导出
    replan-route.ts                              ← createReplanHandler 工厂
    handlers/
      handle-in-place.ts                         ← in_place 模式处理器（调 spec 1 引擎）
      handle-branch.ts                           ← branch 模式处理器（创建 branch job）
    guards/
      running-stage-guard.ts                     ← Running_Stage_Guard 检测函数
      validate-input.ts                          ← fromStage / mode / reason 校验
    branch-creator.ts                            ← buildBranchJob 纯函数（深拷贝上游 artifact）
    replan-event-writer.ts                       ← writeReplanTriggeredEvent
    replan-logger.ts                             ← replan.triggered / replan.rejected / replan.blocked 日志
    __tests__/
      __fixtures__/
        build-fixture-job.ts                     ← 复用 spec 1 fixtures + branch metadata 扩展
        arbitraries.ts                           ← fast-check arbitraries（含 branch 场景）
      replan-in-place.test.ts                    ← property + example
      replan-branch.test.ts                      ← property + example
server/routes/blueprint.ts                       ← 仅追加一行 router.post 注册
server/routes/blueprint/job-store.ts             ← list() 方法保持，新 jobId 通过既有 save() 写入
client/src/lib/blueprint-api/
  replan.ts                                      ← postBlueprintReplan(jobId, body) helper
  index.ts                                       ← re-export
client/src/pages/autopilot/right-rail/
  AutopilotRightRail.tsx                         ← stage divider 区域追加 Replan_Button 渲染
  replan/
    ReplanButton.tsx                             ← 按钮组件
    ReplanConfirmationModal.tsx                  ← 全屏 modal
    use-replan-flow.ts                           ← 提交协调 hook（fetch + store 更新）
    derive-downstream-impact.ts                  ← 基于 spec 1 依赖图的本地派生函数
    __tests__/
      ReplanButton.test.tsx
      ReplanConfirmationModal.test.tsx
      use-replan-flow.test.tsx
client/src/lib/                                  ← 既有 autopilot store hook 接入
```

### 与现有依赖的接线

- **后端依赖**：`BlueprintServiceContext`（logger / now）、`BlueprintJobStore.get` / `save`、spec 1 的 `invalidateDownstreamWithLog`、`mapArtifactTypeToStage`、`getTransitiveDownstreamStages`。
- **后端不依赖**：LLM client、executor client、role container loader、agent crew、capability bridges、event bus 的 socket 推送（事件本身写入 `job.events`，既有 socket-relay 会自然把它推出去）。
- **前端依赖**：既有 `client/src/lib/blueprint-api.ts` 的 fetch helper 模式、既有 `useAutopilotRightRailData` hook 的 `retry` 入口、既有 `@radix-ui/react-dialog`（已封装为 `client/src/components/ui/dialog.tsx`）、既有 `sonner` toast。
- **前端不依赖**：spec 3 的 `Inline_Confirmation`（不存在或不复用）、spec 4 的 `Version_Tree_View` / `History_Entry_Point`（spec 4 才落地）。

### 数据流

```
用户点击 Replan_Button
   │
   ├─ 前端从 spec 1 BLUEPRINT_ASSET_DEPENDENCY_GRAPH 与本地 job 派生 Downstream_Impact_Summary
   │
   ▼
ReplanConfirmationModal 打开
   │
   ├─ 默认 mode = "in_place"
   ├─ 用户切换 mode → 文案刷新（不调后端）
   ├─ 用户输入 reason（≤ 1000 字符）
   │
   ▼
用户点 confirm
   │
   ├─ POST /api/blueprint/jobs/:jobId/replan { fromStage, mode, reason? }
   │     │
   │     ├─ validate-input.ts: 校验 fromStage / mode / reason
   │     │     失败 → 400 + replan.rejected debug 日志
   │     ├─ jobStore.get(jobId)
   │     │     失败 → 404 + replan.rejected debug 日志
   │     ├─ running-stage-guard.ts: 扫 fromStage 传递下游
   │     │     失败 → 409 + replan.blocked warn 日志
   │     │
   │     ├─ if mode === "in_place":
   │     │     ├─ invalidateDownstreamWithLog(ctx, job, fromStage, options) ← spec 1
   │     │     ├─ 把返回 job 的 stage 字段重置为 fromStage
   │     │     ├─ writeReplanTriggeredEvent(job, payload)
   │     │     ├─ jobStore.save(updatedJob)
   │     │     ├─ 200 + { mode, job, summary }
   │     │     └─ replan.triggered info 日志
   │     │
   │     └─ if mode === "branch":
   │           ├─ buildBranchJob(parentJob, fromStage, now()): 创建新 BlueprintGenerationJob
   │           │     - 新 jobId（randomUUID）
   │           │     - 上游 artifact 深拷贝（含 staleSince=undefined）
   │           │     - 下游 stage 的 artifact 全部丢弃
   │           │     - parentJobId / branchedAt / branchedFromStage 写入
   │           │     - staleArtifactIds = []
   │           │     - events = [replan.triggered]
   │           │     - stage = fromStage
   │           │     - status / handoffState / nextAction 重置为初始
   │           ├─ jobStore.save(branchJob)
   │           ├─ 200 + { mode, job, parentJobId, summary }
   │           └─ replan.triggered info 日志（payload 含 parentJobId）
   │
   ▼
前端按 mode 协调 store
   │
   ├─ if mode === "in_place":
   │     - 用响应 job 刷新本地 store
   │     - 保持 Active_Job 同 jobId
   │     - spec 5 未落地前：resetPin() + workflowStageOverride = fromStage
   │     - spec 5 落地后：通过 Coordination_Layer 原子提交 pin / override / store 写入
   │     - toast.success "已从 [stage] 起标记 N 个下游内容为过期"
   │
   ├─ if mode === "branch":
   │     - 把响应 job (branch job) 写入 store
   │     - 切换 Active_Job 引用为新 jobId
   │     - 在 Branch_Index 中追加 parentJobId → [..., branchJobId]
   │     - spec 5 未落地前：resetPin() + workflowStageOverride = fromStage
   │     - spec 5 落地后：通过 Coordination_Layer 原子提交 pin / override / Active_Job / Branch_Index 写入
   │     - toast.success "已创建新分支，从 [stage] 起独立重新规划"
   │
   ▼
关闭 ReplanConfirmationModal
```

### 非功能性约束

- **后端响应时间**：404 ≤ 200ms（纯 store lookup）；200 ≤ 5s（in_place 仅 spec 1 引擎调用 + store save；branch 仅深拷贝 + 创建 + store save）；典型场景 < 100ms。
- **可观测性**：三条日志事件键 `replan.triggered` / `replan.rejected` / `replan.blocked`，前缀稳定，与 spec 1 / spec 3 不混。
- **GitHub Pages 静态预览**：modify 端点不可用 → 探测请求 4xx/5xx → frontend 把 Replan_Button 置 `aria-disabled="true"`（对应需求 1.9）。

## 组件设计

### C1. Shared Contracts（`shared/blueprint/contracts.ts`）

#### C1.1 在 `BlueprintGenerationJob` 上追加（不修改既有字段）

```typescript
export interface BlueprintGenerationJob {
  // ... 既有字段不变（含 spec 1 追加的 staleArtifactIds?）
  // ↓ 本 spec 新增（需求 9.1）
  parentJobId?: string;                      // 仅 branch job 写入
  branchedAt?: string;                       // ISO 8601 UTC，毫秒精度，仅 branch 写入
  branchedFromStage?: BlueprintGenerationStage; // 仅 branch 写入
}
```

三个字段共生：要么全写，要么全省（需求 9.2）。non-branch job 上一律以 `undefined` 表示（不写 `null` / 空串）。

#### C1.2 BlueprintEvent payload 不需要新字段

`replan.triggered` 事件复用既有 `BlueprintGenerationEvent` 形状：

```typescript
{
  id: string,            // 既有
  jobId: string,         // 既有；in_place 为当前 jobId、branch 为新 branch jobId
  type: "replan.triggered" as BlueprintGenerationEventType,  // 既有 union 已包含或追加
  family: "lifecycle" as BlueprintGenerationEventFamily,     // 既有 union 已含
  stage: fromStage,      // 既有
  status: "running",     // 既有；replan 触发后 job 进入 fromStage 重新生成的预备态
  message: "...",        // 自由文本
  occurredAt: now,       // 既有
  payload: {             // 既有 unknown 字段，承载本 spec 全部 payload
    parentJobId?: string,                 // branch only
    fromStage,                            // 重复提供便于前端 timeline 直接渲染
    mode: "in_place" | "branch",
    reason?: string,
    triggeredAt: string,
    markedStaleArtifactCount?: number,    // in_place only
    inheritedUpstreamArtifactCount?: number, // branch only
  }
}
```

如 `BlueprintEventName` enum 中尚未包含 `"replan.triggered"`，本设计在 `shared/blueprint/events.ts` 上**追加一个 enum 成员**（不修改既有成员）；这是 spec 2 唯一对 events.ts 的改动。

### C2. Replan Endpoint（`server/routes/blueprint/replan/`）

#### C2.1 主入口 `replan-route.ts`

```typescript
import type { Request, Response } from "express";
import type { BlueprintJobStore } from "../job-store.js";
import type { BlueprintServiceContext } from "../context.js";
import { validateReplanInput } from "./guards/validate-input.js";
import { detectRunningDownstream } from "./guards/running-stage-guard.js";
import { handleInPlaceReplan } from "./handlers/handle-in-place.js";
import { handleBranchReplan } from "./handlers/handle-branch.js";
import { logReplanRejected, logReplanBlocked } from "./replan-logger.js";

export interface ReplanHandlerDeps {
  jobStore: BlueprintJobStore;
  ctx: Pick<BlueprintServiceContext, "logger" | "now">;
}

export function createReplanHandler(deps: ReplanHandlerDeps) {
  return async (req: Request, res: Response) => {
    const jobId = req.params.jobId;

    // 1. 输入校验（fromStage / mode / reason）
    const validation = validateReplanInput(req.body);
    if (!validation.ok) {
      logReplanRejected(deps.ctx, jobId, validation.error, validation);
      res.status(400).json({ error: validation.error });
      return;
    }

    // 2. job 查找
    const job = deps.jobStore.get(jobId);
    if (!job) {
      logReplanRejected(deps.ctx, jobId, "job_not_found", { fromStage: null, mode: null });
      res.status(404).json({ error: "job_not_found" });
      return;
    }

    // 3. running guard
    const running = detectRunningDownstream(job, validation.fromStage);
    if (running) {
      logReplanBlocked(deps.ctx, jobId, validation.fromStage, validation.mode, running);
      res.status(409).json({ error: "downstream_running", runningStage: running });
      return;
    }

    // 4. 分发到模式处理器
    try {
      if (validation.mode === "in_place") {
        const result = await handleInPlaceReplan({
          job,
          fromStage: validation.fromStage,
          reason: validation.reason,
          jobStore: deps.jobStore,
          ctx: deps.ctx,
        });
        res.status(200).json(result);
      } else {
        const result = await handleBranchReplan({
          parentJob: job,
          fromStage: validation.fromStage,
          reason: validation.reason,
          jobStore: deps.jobStore,
          ctx: deps.ctx,
        });
        res.status(200).json(result);
      }
    } catch (err) {
      deps.ctx.logger.error("[blueprint-replan] internal error", {
        jobId,
        fromStage: validation.fromStage,
        mode: validation.mode,
        error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
      });
      res.status(500).json({ error: "internal_error" });
    }
  };
}
```

#### C2.2 路由注册（`server/routes/blueprint.ts` 内追加）

紧邻 spec 1 的 `router.get("/jobs/:jobId/stale-artifacts", ...)` 之后：

```typescript
import { createReplanHandler } from "./blueprint/replan/replan-route.js";

router.post(
  "/jobs/:jobId/replan",
  createReplanHandler({ jobStore, ctx: blueprintServiceContext }),
);
```

只追加一行 import + 一行 `router.post`。不修改 `createBlueprintRouter` 入参。

### C3. Validation（`server/routes/blueprint/replan/guards/validate-input.ts`）

```typescript
import type { BlueprintGenerationStage } from "../../../../../shared/blueprint/contracts.js";

const LEGAL_STAGES: ReadonlySet<BlueprintGenerationStage> = new Set([
  "input", "clarification", "route_generation", "spec_tree",
  "spec_docs", "preview", "effect_preview", "prompt_packaging",
  "runtime_capability", "engineering_handoff", "engineering_landing",
]);

const LEGAL_MODES = new Set(["in_place", "branch"] as const);
const REASON_MAX = 1024;

export type ReplanValidationResult =
  | {
      ok: true;
      fromStage: BlueprintGenerationStage;
      mode: "in_place" | "branch";
      reason: string | undefined;
    }
  | {
      ok: false;
      error: "invalid_from_stage" | "invalid_mode" | "invalid_reason";
      fromStage: BlueprintGenerationStage | null;
      mode: "in_place" | "branch" | null;
    };

export function validateReplanInput(body: unknown): ReplanValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_from_stage", fromStage: null, mode: null };
  }
  const b = body as Record<string, unknown>;

  // fromStage
  if (typeof b.fromStage !== "string" || !LEGAL_STAGES.has(b.fromStage as BlueprintGenerationStage)) {
    return { ok: false, error: "invalid_from_stage", fromStage: null, mode: null };
  }
  const fromStage = b.fromStage as BlueprintGenerationStage;

  // mode
  if (typeof b.mode !== "string" || !LEGAL_MODES.has(b.mode as "in_place" | "branch")) {
    return { ok: false, error: "invalid_mode", fromStage, mode: null };
  }
  const mode = b.mode as "in_place" | "branch";

  // reason（可选）
  let reason: string | undefined;
  if (b.reason !== undefined && b.reason !== null) {
    if (typeof b.reason !== "string" || b.reason.length > REASON_MAX) {
      return { ok: false, error: "invalid_reason", fromStage, mode };
    }
    reason = b.reason;
  }

  return { ok: true, fromStage, mode, reason };
}
```

校验顺序固定：`fromStage` → `mode` → `reason`。这样多字段同时非法时，错误信号反映"最早错误"（避免输出枚举乱跳）。

### C4. Running Stage Guard（`server/routes/blueprint/replan/guards/running-stage-guard.ts`）

#### C4.1 算法

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "../../../../../shared/blueprint/contracts.js";
import {
  getTransitiveDownstreamStages,
  mapArtifactTypeToStage,
} from "../../staleness/dependency-graph.js";

const TERMINAL_HANDOFF_STATES = new Set(["confirmed", "reset", "failed"] as const);

/** 返回拓扑上最靠近 fromStage 的 running 下游 stage；若无 running，返回 null。 */
export function detectRunningDownstream(
  job: BlueprintGenerationJob,
  fromStage: BlueprintGenerationStage,
): BlueprintGenerationStage | null {
  const downstreamOrdered = getTransitiveDownstreamStages(fromStage);
  // downstreamOrdered 已是拓扑序，第一个匹配即为"最靠近"

  for (const stage of downstreamOrdered) {
    // 判定 (a)：job.stage 字段指向当前 stage 且 status === running
    if (job.stage === stage && job.status === "running") {
      return stage;
    }
    // 判定 (b)：handoffState 不在终态枚举内（reviewing 也算 active 状态）
    //   注意：job.handoffState 是 job 级，不是 stage 级；只在 job.stage === stage 时纳入判定
    if (
      job.stage === stage &&
      job.handoffState !== undefined &&
      !TERMINAL_HANDOFF_STATES.has(job.handoffState as never) &&
      job.handoffState !== "idle"
    ) {
      return stage;
    }
    // 判定 (c)：nextAction 指向下游生成动作
    //   即 nextAction.stage === stage 且 type 不在 review_* 系列（review_* 等用户态不算 running）
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

#### C4.2 与需求 4.1 / 4.2 的对应

- 需求 4.1(a) `status === "running"`：直接判定。
- 需求 4.1(b) `handoffState` 不在终态枚举：本设计选用 `confirmed | reset | failed` 三态作为终态（idle 也作为非 active）；**reviewing 视为 active**，因为 reviewing 是用户决策态、replan 应等待用户先把 reviewing 关闭。
- 需求 4.1(c) `nextAction` 指向下游生成动作：通过 `type !== review_*` 与 `type !== "none"` 判定。
- 需求 4.2 多 stage 同时 running 时返回拓扑最靠近的：`getTransitiveDownstreamStages` 返回拓扑序（spec 1 已保证），for 循环遇第一个匹配即返回。
- 需求 4.3 两种 mode 一致：guard 在 `validation.mode` 之前调用，模式无关。
- 需求 4.5 与 spec 3 独立：本文件位于 `replan/guards/`；spec 3 的 Conflict_Detection 位于 `stage-edit/guards/`（spec 3 design 阶段独立）。两份文件物理隔离、不共享导出。

### C5. In-Place Handler（`server/routes/blueprint/replan/handlers/handle-in-place.ts`）

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "../../../../../shared/blueprint/contracts.js";
import type { BlueprintJobStore } from "../../job-store.js";
import type { BlueprintServiceContext } from "../../context.js";
import { invalidateDownstreamWithLog } from "../../staleness/invalidate-downstream.js";
import { writeReplanTriggeredEvent } from "../replan-event-writer.js";
import { logReplanTriggered } from "../replan-logger.js";

export interface InPlaceHandlerInput {
  job: BlueprintGenerationJob;
  fromStage: BlueprintGenerationStage;
  reason: string | undefined;
  jobStore: BlueprintJobStore;
  ctx: Pick<BlueprintServiceContext, "logger" | "now">;
}

export async function handleInPlaceReplan(input: InPlaceHandlerInput) {
  const triggeringArtifactId = input.job.id;  // 用 jobId 兜底（无法精准定位某个 artifact）
  const triggeringArtifactType = "replay" as const;  // 占位 type；不污染 stale marker 语义

  // 1. 调 spec 1 引擎
  const invalidatedJob = invalidateDownstreamWithLog(
    input.ctx,
    input.job,
    input.fromStage,
    {
      reason: "upstream_explicit_invalidation",
      triggeringArtifactId,
      triggeringArtifactType,
      now: input.ctx.now,
    },
  );

  // 2. 倒回 backend stage
  const stagedJob: BlueprintGenerationJob = {
    ...invalidatedJob,
    stage: input.fromStage,
  };

  // 3. 计算 marked count
  const beforeCount = (input.job.staleArtifactIds ?? []).length;
  const afterCount = (stagedJob.staleArtifactIds ?? []).length;
  const markedStaleArtifactCount = afterCount - beforeCount;
  const markedStaleArtifactIds = (stagedJob.staleArtifactIds ?? []).filter(
    (id) => !(input.job.staleArtifactIds ?? []).includes(id),
  );

  // 4. 写 replan.triggered 事件
  const triggeredAt = input.ctx.now();
  const eventedJob = writeReplanTriggeredEvent(stagedJob, {
    parentJobId: undefined,
    fromStage: input.fromStage,
    mode: "in_place",
    reason: input.reason,
    triggeredAt,
    markedStaleArtifactCount,
    inheritedUpstreamArtifactCount: undefined,
  });

  // 5. save
  input.jobStore.save(eventedJob);

  // 6. info 日志
  logReplanTriggered(input.ctx, {
    jobId: eventedJob.id,
    parentJobId: undefined,
    fromStage: input.fromStage,
    mode: "in_place",
    reason: input.reason,
    triggeredAt,
    markedStaleArtifactCount,
    inheritedUpstreamArtifactCount: undefined,
  });

  // 7. 响应
  return {
    mode: "in_place" as const,
    job: eventedJob,
    summary: {
      fromStage: input.fromStage,
      markedStaleArtifactCount,
      markedStaleArtifactIds,
    },
  };
}
```

### C6. Branch Handler（`server/routes/blueprint/replan/handlers/handle-branch.ts`）

#### C6.1 buildBranchJob 纯函数（`branch-creator.ts`）

```typescript
import { randomUUID } from "node:crypto";
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintGenerationArtifact,
} from "../../../../shared/blueprint/contracts.js";
import {
  getTransitiveDownstreamStages,
  mapArtifactTypeToStage,
} from "../staleness/dependency-graph.js";

export interface BuildBranchJobInput {
  parentJob: BlueprintGenerationJob;
  fromStage: BlueprintGenerationStage;
  now: () => string;
  newJobId?: string;  // 测试可注入；默认 randomUUID()
}

export interface BuildBranchJobResult {
  branchJob: BlueprintGenerationJob;
  inheritedUpstreamArtifactCount: number;
  inheritedUpstreamArtifactIds: string[];
}

export function buildBranchJob(input: BuildBranchJobInput): BuildBranchJobResult {
  const triggeredAt = input.now();
  const newJobId = input.newJobId ?? randomUUID();

  // 严格上游 = 不在 fromStage 传递下游集合 + 不属于 fromStage 自身
  const downstreamSet = new Set(getTransitiveDownstreamStages(input.fromStage));
  const isStrictlyUpstream = (artifact: BlueprintGenerationArtifact): boolean => {
    const stage = mapArtifactTypeToStage(artifact.type);
    if (stage === undefined) return false;     // 横切类型（replay / feedback）不继承
    if (stage === input.fromStage) return false; // fromStage 自身不继承（branch 从此处重生）
    if (downstreamSet.has(stage)) return false;  // 下游不继承
    return true;
  };

  // 深拷贝上游 artifact（含字段）；branch 不继承 staleSince
  const inheritedArtifacts = input.parentJob.artifacts
    .filter(isStrictlyUpstream)
    .map((a) => {
      const { staleSince: _s, invalidatedBy: _i, ...rest } = a;
      // structured deep clone（payload 不可知，安全起见走 JSON）
      const cloned: BlueprintGenerationArtifact = {
        ...rest,
        payload: a.payload === undefined ? undefined : structuredClone(a.payload),
      };
      return cloned;
    });

  const inheritedUpstreamArtifactIds = inheritedArtifacts.map((a) => a.id);

  // 构造 branch job
  const branchJob: BlueprintGenerationJob = {
    id: newJobId,
    request: input.parentJob.request,        // request 共享：用户初始意图不变
    status: "pending",
    stage: input.fromStage,
    projectId: input.parentJob.projectId,
    sourceId: input.parentJob.sourceId,
    version: input.parentJob.version,
    createdAt: triggeredAt,
    updatedAt: triggeredAt,
    completedAt: undefined,
    artifacts: inheritedArtifacts,
    events: [],                              // 由 caller 追加 replan.triggered
    stageState: undefined,
    nextAction: undefined,
    handoffState: undefined,
    error: undefined,
    // spec 1 fields
    staleArtifactIds: [],                    // 新链路无 stale
    // spec 2 branch metadata
    parentJobId: input.parentJob.id,         // 总是指向**原始 parent**（即调用方传入的 parentJob）
    branchedAt: triggeredAt,
    branchedFromStage: input.fromStage,
  };

  return {
    branchJob,
    inheritedUpstreamArtifactCount: inheritedArtifacts.length,
    inheritedUpstreamArtifactIds,
  };
}
```

**关键性质实现**：需求 10.2 第 4 条"branch 是树而非链"——`parentJobId = input.parentJob.id`。在调用方（`handle-branch.ts`），`parentJob` 始终是用户当前正在交互的 job（即原始 jobId），而不是上一次 branch 的 jobId。如果用户在 branch job 上再次 branch replan，`parentJobId` 才会指向那个 branch；这是预期行为（分支的子分支）。spec 2 §10.2 第 4 条只要求"两次以**相同 (jobId, fromStage, mode = "branch")**"产生 sibling，即两次都从同一个 jobId 触发——这一点由调用方的 `jobStore.get(jobId)` 路径自然保证。

#### C6.2 handleBranchReplan

```typescript
export async function handleBranchReplan(input: BranchHandlerInput) {
  const triggeredAt = input.ctx.now();

  // 1. 构造 branch job（深拷贝上游）
  const { branchJob: bareBranch, inheritedUpstreamArtifactCount, inheritedUpstreamArtifactIds } =
    buildBranchJob({
      parentJob: input.parentJob,
      fromStage: input.fromStage,
      now: input.ctx.now,
    });

  // 2. 写 replan.triggered 事件到 branch job
  const eventedBranch = writeReplanTriggeredEvent(bareBranch, {
    parentJobId: input.parentJob.id,
    fromStage: input.fromStage,
    mode: "branch",
    reason: input.reason,
    triggeredAt,
    markedStaleArtifactCount: undefined,
    inheritedUpstreamArtifactCount,
  });

  // 3. save branch job（不动 parent）
  input.jobStore.save(eventedBranch);

  // 4. info 日志
  logReplanTriggered(input.ctx, {
    jobId: eventedBranch.id,
    parentJobId: input.parentJob.id,
    fromStage: input.fromStage,
    mode: "branch",
    reason: input.reason,
    triggeredAt,
    markedStaleArtifactCount: undefined,
    inheritedUpstreamArtifactCount,
  });

  // 5. 响应
  return {
    mode: "branch" as const,
    job: eventedBranch,
    parentJobId: input.parentJob.id,
    summary: {
      fromStage: input.fromStage,
      branchedAt: triggeredAt,
      inheritedUpstreamArtifactCount,
      inheritedUpstreamArtifactIds,
    },
  };
}
```

注意：parent job **完全不动**——既不写新事件，也不修改 staleArtifactIds 或 stage（需求 3.7、6.3）。spec 2 §3.7 在文档中"建议在 parent job 上以 info 级日志或可选事件镜像记录"，本设计选择**只打 info 日志**（已在 `logReplanTriggered` 中通过 payload 包含 `parentJobId` 体现），不在 parent job 上追加事件镜像。

### C7. Replan Triggered Event Writer（`replan-event-writer.ts`）

```typescript
import { randomUUID } from "node:crypto";
import type {
  BlueprintGenerationJob,
  BlueprintGenerationEvent,
  BlueprintGenerationStage,
} from "../../../../shared/blueprint/contracts.js";

export interface ReplanEventPayload {
  parentJobId: string | undefined;
  fromStage: BlueprintGenerationStage;
  mode: "in_place" | "branch";
  reason: string | undefined;
  triggeredAt: string;
  markedStaleArtifactCount: number | undefined;
  inheritedUpstreamArtifactCount: number | undefined;
}

export function writeReplanTriggeredEvent(
  job: BlueprintGenerationJob,
  payload: ReplanEventPayload,
): BlueprintGenerationJob {
  const event: BlueprintGenerationEvent = {
    id: randomUUID(),
    jobId: job.id,
    type: "replan.triggered",
    family: "lifecycle",
    stage: payload.fromStage,
    status: "running",
    message: payload.mode === "in_place"
      ? `Replanned in place from ${payload.fromStage}`
      : `Branched from ${payload.fromStage}`,
    occurredAt: payload.triggeredAt,
    payload: {
      jobId: job.id,
      parentJobId: payload.parentJobId,
      fromStage: payload.fromStage,
      mode: payload.mode,
      reason: payload.reason,
      triggeredAt: payload.triggeredAt,
      markedStaleArtifactCount: payload.markedStaleArtifactCount,
      inheritedUpstreamArtifactCount: payload.inheritedUpstreamArtifactCount,
    },
  };

  return {
    ...job,
    events: [...job.events, event],
  };
}
```

事件 payload 的字段集合**恰好**对齐 spec 2 §5.1 列出的 8 个字段，无多余、无缺失。reason 字段长度由 caller（C2.1 的 validateReplanInput）保证 ≤ 1024，但 spec 2 §5.1 / §5.6 约束事件 payload 中 reason ≤ 500 字符——本设计在 `writeReplanTriggeredEvent` 内做一次截断：

```typescript
const SAFE_REASON_LIMIT = 500;
const safeReason = payload.reason !== undefined && payload.reason.length > SAFE_REASON_LIMIT
  ? payload.reason.slice(0, SAFE_REASON_LIMIT)
  : payload.reason;
// ... event.payload.reason = safeReason
```

### C8. Logger（`replan-logger.ts`）

```typescript
import type { BlueprintServiceContext } from "../context.js";
import type { BlueprintGenerationStage } from "../../../../shared/blueprint/contracts.js";

export function logReplanTriggered(
  ctx: Pick<BlueprintServiceContext, "logger">,
  payload: {
    jobId: string;
    parentJobId: string | undefined;
    fromStage: BlueprintGenerationStage;
    mode: "in_place" | "branch";
    reason: string | undefined;
    triggeredAt: string;
    markedStaleArtifactCount: number | undefined;
    inheritedUpstreamArtifactCount: number | undefined;
  },
): void {
  ctx.logger.info("[blueprint-replan] replan.triggered", {
    event: "replan.triggered",
    jobId: payload.jobId,
    parentJobId: payload.parentJobId,
    fromStage: payload.fromStage,
    mode: payload.mode,
    markedStaleArtifactCount: payload.markedStaleArtifactCount,
    inheritedUpstreamArtifactCount: payload.inheritedUpstreamArtifactCount,
    reasonPresent: payload.reason !== undefined,
    reasonLength: payload.reason?.length ?? 0,
    triggeredAt: payload.triggeredAt,
  });
}

export function logReplanRejected(
  ctx: Pick<BlueprintServiceContext, "logger">,
  jobId: string,
  reason: "job_not_found" | "invalid_from_stage" | "invalid_mode" | "invalid_reason",
  context: { fromStage: BlueprintGenerationStage | null; mode: "in_place" | "branch" | null },
): void {
  ctx.logger.debug("[blueprint-replan] replan.rejected", {
    event: "replan.rejected",
    jobId,
    reason,
    fromStage: context.fromStage,
    mode: context.mode,
  });
}

export function logReplanBlocked(
  ctx: Pick<BlueprintServiceContext, "logger">,
  jobId: string,
  fromStage: BlueprintGenerationStage,
  mode: "in_place" | "branch",
  runningStage: BlueprintGenerationStage,
): void {
  ctx.logger.warn("[blueprint-replan] replan.blocked", {
    event: "replan.blocked",
    jobId,
    fromStage,
    mode,
    runningStage,
  });
}
```

reason 原文不输出（需求 11.4 / 5.6），仅以 `reasonPresent` + `reasonLength` 表达。

### C9. Frontend Replan Button（`client/src/pages/autopilot/right-rail/replan/ReplanButton.tsx`）

#### C9.1 渲染锚点

`AutopilotRightRail.tsx` 第 802-814 行的 `cta` 区域是 stage divider 的现有 CTA 容器。本设计在该区域**额外**渲染一个独立按钮：

```tsx
// AutopilotRightRail.tsx 改动（追加，不替换）
const downstreamImpact = deriveDownstreamImpact(activeStageKey, latestJob);
const replanButtonVisible =
  isViewingCompletedStage && downstreamImpact.size >= 1;

// ... 在 StageViewport.cta 处：
cta={
  isViewingCompletedStage ? (
    <div className="flex flex-col gap-2">
      <StageCTA
        label={locale === "zh-CN" ? "返回当前阶段" : "Return to current stage"}
        loading={false}
        disabled={false}
        onAction={handleReturnToCurrentStage}
      />
      {replanButtonVisible && (
        <ReplanButton
          fromStage={activeStageKey}
          downstreamImpact={downstreamImpact}
          onConfirm={handleReplanConfirm}
        />
      )}
    </div>
  ) : (
    /* 既有非回看分支 */
  )
}
```

需求 1.5 要求 Replan_Button 在视觉上与"返回上一步"可区分。本设计采用：颜色 token 不同（"返回上一步"是中性色 / "从这里重新规划"是 warning 黄色）+ 图标不同（`ArrowLeft` vs `RotateCcw`）+ DOM 位置不同（垂直堆叠在"返回上一步"之下）。

#### C9.2 ReplanButton 组件

```tsx
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { ReplanConfirmationModal } from "./ReplanConfirmationModal";
import type { BlueprintGenerationStage } from "../../../../../shared/blueprint/contracts.js";
import type { DownstreamImpact } from "./derive-downstream-impact";

export interface ReplanButtonProps {
  fromStage: BlueprintGenerationStage;
  downstreamImpact: DownstreamImpact;
  onConfirm: (mode: "in_place" | "branch", reason: string | undefined) => Promise<void>;
}

export function ReplanButton(props: ReplanButtonProps) {
  const [open, setOpen] = useState(false);
  const isStaticPreview = useIsStaticPreviewMode();
  const isDownstreamRunning = useIsDownstreamRunning(props.fromStage);

  const disabled = isStaticPreview || isDownstreamRunning;
  const ariaLabel = ...;
  const hint = isStaticPreview
    ? "静态预览模式不支持重新规划"
    : isDownstreamRunning
      ? "下游正在生成，请稍候"
      : null;

  return (
    <>
      <button
        type="button"
        data-testid="autopilot-replan-from-stage-divider"
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && setOpen(true)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={hint ?? "返回上一步只是回看，不删除产物；从这里重新规划会让下游内容过期或开新分支"}
        className={cn(/* warning color tokens */)}
      >
        <RotateCcw className="h-4 w-4" />
        <span>从这里重新规划</span>
      </button>
      {hint && <span className="text-xs text-warn">{hint}</span>}
      <ReplanConfirmationModal
        open={open}
        onOpenChange={setOpen}
        fromStage={props.fromStage}
        downstreamImpact={props.downstreamImpact}
        onConfirm={props.onConfirm}
      />
    </>
  );
}
```

`useIsStaticPreviewMode` 通过对一个轻量 endpoint（如 `GET /api/blueprint/jobs/latest`）的探测 + module flag 双重判定（spec 2 §12.7）。

### C10. Frontend Confirmation Modal（`ReplanConfirmationModal.tsx`）

#### C10.1 状态机

```typescript
type ModalState =
  | { kind: "idle" }                                              // 初始
  | { kind: "loading_impact" }                                    // Downstream_Impact_Summary 加载中
  | { kind: "impact_failed"; retryable: true }                    // 加载失败
  | { kind: "ready"; impact: DownstreamImpact; mode: "in_place" | "branch"; reason: string }
  | { kind: "in_flight"; mode: "in_place" | "branch"; reason: string; startedAt: number }
  | { kind: "error"; mode: "in_place" | "branch"; reason: string; impact: DownstreamImpact; lastError: ErrorState }
  | { kind: "store_sync_failed" };
```

modal 打开 → `idle` → `loading_impact` → `ready` → 用户提交 → `in_flight` → 成功关闭 / 失败回 `error`。`in_flight` 持续 30s 仍无响应 → 失败 + "请求超时，请重试"（需求 2.12）。

#### C10.2 按 spec 2 §2.1-§2.15 全要求实现

- §2.1 dialog 宽度 720-960px、`max-h: 90vh`：`<Dialog>` + className `max-w-[960px] min-w-[720px] max-h-[90vh] overflow-y-auto`
- §2.6 `in_place` 默认选中
- §2.7 切换 mode 文案立刻刷新（≤ 100ms 是天然属性，因为是纯 React state）；reason 保留
- §2.8 reason ≤ 1000 字符，超长展示计数 + 阻止 confirm
- §2.10 / §2.11 飞行中 Esc / 外点击禁用：通过 Radix Dialog `onPointerDownOutside={e => state.kind === 'in_flight' && e.preventDefault()}` + `onEscapeKeyDown` 同样阻断
- §2.12 30s 超时：`AbortController` + `setTimeout(30_000)`
- §2.13 4xx/5xx 错误展示 + 字段修改时清除：通过 state 在 `kind === error` 时持有 lastError，输入变化时迁移到 `ready`
- §2.14 store 更新失败回滚：`onConfirm` callback 抛错时进 `store_sync_failed` 状态并显示文案
- §2.15 不复用 spec 3 Inline_Confirmation：本组件独立 import、独立样式

### C11. Frontend Replan Flow Hook（`use-replan-flow.ts`）

```typescript
export function useReplanFlow(jobId: string | null) {
  const rightRailRetry = useAutopilotRightRailRetry();
  const switchActiveJob = useAutopilotSwitchActiveJob();
  const branchIndex = useAutopilotBranchIndexStore();

  return useCallback(
    async (
      fromStage: BlueprintGenerationStage,
      mode: "in_place" | "branch",
      reason: string | undefined,
    ) => {
      if (!jobId) throw new Error("no_active_job");
      const response = await postBlueprintReplan(jobId, { fromStage, mode, reason });
      if (response.mode === "in_place") {
        // store 协调（§6.1）
        rightRailRetry();           // 拉新 job 数据
        // spec 5 未落地前：resetPin + workflowStageOverride = fromStage 由 RightRail 内层处理
        // spec 5 落地后：该写入应迁移到 Coordination_Layer
        toast.success(`已从 ${stageZh(fromStage)} 起标记 ${response.summary.markedStaleArtifactCount} 个下游内容为过期`);
      } else {
        // branch 模式（§6.2）
        switchActiveJob(response.job.id);  // 切 Active_Job
        branchIndex.append(response.parentJobId, response.job.id);  // Branch_Index 维护
        rightRailRetry();
        toast.success(`已创建新分支，从 ${stageZh(fromStage)} 起独立重新规划`);
      }
    },
    [jobId, rightRailRetry, switchActiveJob, branchIndex],
  );
}
```

`switchActiveJob` 与 `branchIndex` store 是 spec 2 在前端层新增的最小协调层（不重构既有 store）：

```typescript
// client/src/lib/autopilot-job-store.ts（追加，不替换）
export const useAutopilotJobStore = create<{
  activeJobId: string | null;
  branchIndex: Map<string, string[]>;     // parentJobId → [branchJobId, ...]
  setActiveJobId: (id: string) => void;
  appendBranch: (parentId: string, branchId: string) => void;
}>((set) => ({ ... }));
```

Branch_Index 仅供前端协调使用，spec 2 §9.4 约束其不暴露到 UI 层；spec 4 才是它的 UI 消费方。

### C12. Frontend API Helper（`client/src/lib/blueprint-api/replan.ts`）

```typescript
export interface BlueprintReplanRequest {
  fromStage: BlueprintGenerationStage;
  mode: "in_place" | "branch";
  reason?: string;
}

export type BlueprintReplanResponse =
  | {
      mode: "in_place";
      job: BlueprintGenerationJob;
      summary: {
        fromStage: BlueprintGenerationStage;
        markedStaleArtifactCount: number;
        markedStaleArtifactIds: string[];
      };
    }
  | {
      mode: "branch";
      job: BlueprintGenerationJob;
      parentJobId: string;
      summary: {
        fromStage: BlueprintGenerationStage;
        branchedAt: string;
        inheritedUpstreamArtifactCount: number;
        inheritedUpstreamArtifactIds: string[];
      };
    };

export async function postBlueprintReplan(
  jobId: string,
  body: BlueprintReplanRequest,
  options?: { signal?: AbortSignal },
): Promise<BlueprintReplanResponse> {
  const response = await fetch(`/api/blueprint/jobs/${encodeURIComponent(jobId)}/replan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "unknown" }));
    throw new BlueprintReplanError(response.status, errorBody);
  }
  return response.json();
}
```

`BlueprintReplanError` 是局部 Error 子类，承载 status + error code + 可选 runningStage（409 时）。

## 数据模型

| 名称 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `parentJobId?` | `BlueprintGenerationJob` | `string?` | 仅 branch job |
| `branchedAt?` | `BlueprintGenerationJob` | `string?` | ISO 8601 UTC，毫秒 |
| `branchedFromStage?` | `BlueprintGenerationJob` | `BlueprintGenerationStage?` | 仅 branch job |
| `replan.triggered` | `BlueprintEventName` | enum 成员 | 沿用既有 enum |
| `BlueprintReplanRequest` | `client/src/lib/blueprint-api/replan.ts` | interface | 请求体 |
| `BlueprintReplanResponse` | 同上 | union | 200 响应 |
| `BlueprintReplanError` | 同上 | class | 4xx/5xx 错误 |

## 错误处理

| 场景 | HTTP | 错误码 | 日志 |
|---|---|---|---|
| `body` 不是 object | 400 | `invalid_from_stage` | `replan.rejected` debug |
| `fromStage` 缺失/非法 | 400 | `invalid_from_stage` | `replan.rejected` debug |
| `mode` 缺失/非法 | 400 | `invalid_mode` | `replan.rejected` debug |
| `reason` 类型错或超长 | 400 | `invalid_reason` | `replan.rejected` debug |
| `jobId` 不存在 | 404 | `job_not_found` | `replan.rejected` debug |
| 下游 stage running | 409 | `downstream_running` + `runningStage` | `replan.blocked` warn |
| spec 1 引擎抛错 / save 失败 / 序列化失败 | 500 | `internal_error` | `error` 级日志 |
| 成功 in_place / branch | 200 | — | `replan.triggered` info |

## 测试策略

### T1. `replan-in-place.test.ts`（fast-check property + example）

#### Property tests（≥ 100 iterations 各）

- **In-place mode 引擎等价性**（需求 10.2 第 1 条）：构造任意 fixture job + 任意合法 fromStage → `POST /replan { mode: "in_place" }` 返回 job 中"被标记 stale 的 artifact id 集合"在元素层面（`Set` 比较）等于直接调 `invalidateDownstream(job, fromStage, options)` 后的 stale 集合。
- **In-place 幂等**（需求 10.2 第 5 条）：同一 fromStage 连续两次 replan → 第二次响应的 `staleArtifactIds` 与第一次元素层面相等。

#### Example tests

- HTTP 200 + 响应 schema（`mode` / `job.stage === fromStage` / `summary.markedStaleArtifactCount === markedStaleArtifactIds.length`）。
- `markedStaleArtifactIds.length === markedStaleArtifactCount`（需求 3.6）。
- 非法 fromStage / mode / reason → 400 + 对应 error code，不 mutate store。
- 不存在的 jobId → 404，不 mutate store。
- 成功后 `events` 末尾恰好追加一条 `replan.triggered`（无重复）。
- noop fromStage（无下游 artifact 的 job）→ 200 + markedStaleArtifactCount = 0，但仍写 `replan.triggered`（这是显式用户动作，与 spec 1 的 noop 引擎调用语义不同）。

### T2. `replan-branch.test.ts`（fast-check property + example）

#### Property tests（≥ 100 iterations 各）

- **Branch 模式上游保留**（需求 10.2 第 2 条）：branch job 中所有"严格上游 stage"的 artifact 与 parent 在 deep equality 下相等；该集合中每个 artifact 的 `staleSince === undefined`。
- **Branch 模式下游为空**（需求 10.2 第 3 条）：branch job 中所属 stage ∈ { fromStage } ∪ getTransitiveDownstreamStages(fromStage) 的 artifact 集合为空。
- **Branch 是树而非链**（需求 10.2 第 4 条）：连续两次以相同 (jobId, fromStage, mode = "branch") replan → 两次创建的 branch job 都有 `parentJobId === <原始 jobId>`（不是第一个 branch 的 jobId）。
- **Branch 上 staleArtifactIds 为空**：branch job 的 `staleArtifactIds.length === 0`。

#### Example tests

- HTTP 200 + 响应 schema（`mode === "branch"` / `parentJobId === <原始 jobId>` / `summary.branchedAt` 是合法 ISO 8601 / `inheritedUpstreamArtifactCount === inheritedUpstreamArtifactIds.length`）。
- branch job 携带 Branch_Metadata 三字段，parent job 不携带（即在响应外通过 `jobStore.get(parentJobId)` 验证 parent 的 `parentJobId === undefined`）。
- parent job 在 replan 后字段全等于 replan 前的 deep snapshot（`events` / `staleArtifactIds` / `stage` / `status` / `artifacts` 全部不变）。
- 成功后 branch job `events` 末尾恰好追加一条 `replan.triggered`，payload 含 `parentJobId`。
- 9.1 / 9.2：branch job 上三字段全合法填充；in_place 路径上三字段在响应中为 undefined。

### T3. Running Stage Guard 测试（在两个测试文件中各 example test 一份）

- 当 `job.status === "running"` 且 `job.stage` 在下游 → 409 + `downstream_running` + `runningStage`，且 job 任一字段不变（请求前后 deep snapshot equality），events 不追加（需求 10.5）。
- 在 in_place 与 branch 两种 mode 下各跑一次。
- 多 stage 同时 running 时（构造 job stage 在最近的下游 + 另一更下游 stage 上也设置 running 标志）→ 返回拓扑最靠近的 stage（需求 4.2）。

### T4. Frontend 组件测试

`client/src/pages/autopilot/right-rail/replan/__tests__/`：

- **ReplanButton.test.tsx**（需求 10.6）：
  - `isViewingCompletedStage === false` → 不渲染（DOM 中不存在 `data-testid="autopilot-replan-from-stage-divider"`）
  - `downstreamImpact.size === 0` → 不渲染
  - `isStaticPreview === true` → 渲染但 `aria-disabled="true"`
  - `isDownstreamRunning === true` → 渲染但 `aria-disabled="true"` + 邻近 hint 文本
  - 点击触发 modal 打开
- **ReplanConfirmationModal.test.tsx**（需求 10.6）：
  - 默认 mode = "in_place"
  - 切换到 "branch" 时 Downstream_Impact_Summary 文案变化（断言文案中包含 "新分支独立重新生成"）
  - reason 文本切换 mode 时保留
  - reason 超长（1001 字符）→ confirm 按钮 disabled + 计数提示
  - Esc 键关闭（非 in-flight 时）
  - 飞行中 Esc / 外点击不关闭
  - 重复点击 confirm 不触发重复请求
  - 与 spec 3 inline edit modal 视觉互斥：通过 `data-testid` namespace `autopilot-replan-*` 与未来 spec 3 的 `autopilot-edit-*` 不重叠（断言 query 不到 `data-testid="autopilot-edit-*"`）。
- **use-replan-flow.test.tsx**：
  - in_place 成功 → toast 文案断言 + rightRailRetry 被调
  - branch 成功 → switchActiveJob 被调 + branchIndex.append 被调 + toast 文案断言
  - 4xx 错误抛 BlueprintReplanError，state 退回 ready
  - 5xx 抛 BlueprintReplanError
  - 30s 超时 → AbortController.abort 被调

### T5. Fixtures（`__fixtures__/build-fixture-job.ts`）

复用 spec 1 的 `buildFixtureJob` / `buildFullChainJob`，新增：

- `buildBranchJobFixture(parent, fromStage, overrides?)`：构造已有 Branch_Metadata 的 branch job
- `buildRunningJobFixture(stage)`：构造 `status = "running"` 且 `job.stage = stage` 的 fixture
- `buildJobWithReviewingHandoff(stage)`：构造 `handoffState = "reviewing"` 的 fixture（验证 reviewing 视为 active）

### T6. 测试运行

- 测试位置：`server/routes/blueprint/replan/__tests__/` + `client/src/pages/autopilot/right-rail/replan/__tests__/`
- runner：既有 server vitest config + 客户端 vitest config，无新增 config / npm script
- 依赖：`fast-check` / `vitest` / `@testing-library/react` / `supertest`，全部已存在

## 与需求的全量对照

| 需求 | 落地点 |
|---|---|
| 1.1–1.9（Replan_Button） | C9.1 / C9.2 |
| 2.1–2.15（Confirmation Modal） | C10.1 / C10.2 |
| 3.1–3.13（Replan_Endpoint 契约） | C2.1 / C5 / C6 / C7 |
| 4.1–4.6（Running_Stage_Guard） | C4.1 / C4.2 |
| 5.1–5.7（Replan_Triggered_Event） | C7 |
| 6.1–6.6（Frontend Store 协调） | C11 |
| 7.1–7.6（与 spec 1 关系） | spec 1 引擎以 caller 身份调，无修改；C5 调 `invalidateDownstreamWithLog` |
| 8.1–8.7（与 spec 3 关系） | C2 路径不调 spec 3 端点；C10 不复用 Inline_Confirmation；事件键 `replan.*` 不与 spec 3 的 inline edit 日志键重叠 |
| 9.1–9.5（与 spec 4 关系） | C1.1 仅追加可选字段；C11 维护 Branch_Index；不实现版本历史 UI |
| 10.1–10.8（属性 + 示例测试） | T1–T6 |
| 11.1–11.6（日志） | C8 |
| 12.1–12.9（向后兼容） | 全文未触及任一既有字段 / 路由 / 测试 |
| 13.1–13.10（范围边界） | 设计层未引入 spec 1 / 3 / 4 / 5 范围内的代码 |

## 实施风险与对冲

| 风险 | 对冲 |
|---|---|
| `BlueprintEventName` enum 中可能尚未包含 `"replan.triggered"` | C1.2 已说明：如缺失，仅追加 enum 成员，不修改既有成员 |
| `structuredClone` 在 Node 18+ 才稳定 | 项目最低支持 Node 20，安全；fallback 为 `JSON.parse(JSON.stringify(...))` |
| Branch_Index 在前端 store 中可能与 SSR / hydration 冲突 | 客户端纯运行时 store，不参与 SSR；hydration 后从 socket / fetch 重建 |
| reviewing 视为 active 是否过严（用户可能希望在 reviewing 态 replan） | 设计层视为严：reviewing 是用户决策窗口，replan 应等待决策完成；如反馈过严，可在后续 spec 加 override，但当前 spec 不引入 |
| `triggeringArtifactId = job.id` / `triggeringArtifactType = "replay"` 在 spec 1 引擎日志中不准确 | 这是 in-place 模式的天然限制：用户没指定具体某个上游 artifact，只指定了 fromStage；占位值不污染 stale marker 的视觉表达（前端读 `invalidatedBy.stage` 而不是 artifactId） |
| reason 长度边界：endpoint 接受 ≤ 1024，event payload 截断到 ≤ 500 | C7 显式截断；前端 textarea ≤ 1000；三层保持不变量：endpoint > textarea > event payload |
| spec 2 文档中"建议 parent job 上以 info 级日志或可选事件镜像"的二选一 | 选 info 日志（已通过 logReplanTriggered 的 parentJobId 字段体现），不做事件镜像（保持 parent job 的 events 数组完全不变） |

## 下游 spec 的接线点位（不在本 spec 实施）

| 下游 spec | 接线 |
|---|---|
| spec 3（stage-edit-mode） | spec 3 的 inline edit 路径**不**调 `POST /replan`、**不**复用 `ReplanConfirmationModal` / `ReplanButton`；spec 3 自有 hook + modal |
| spec 4（stage-version-history） | 消费 `parentJobId` / `branchedAt` / `branchedFromStage` 字段 + Branch_Index；调 `GET /family` 端点（spec 4 自己实现）；消费 `replan.triggered` 事件构造 Replan_Timeline_View |
| spec 5（stage-state-coordination） | 把本 spec 的 `useReplanFlow` hook 的多 store 写入聚合到 `Atomic_Refresh_Mediator`；把 toast 调用改走 `Toast_Queue`；把页面级过渡接管到 `Page_Transition_Choreographer` |
