# 设计文档：Autopilot Asset Staleness Model

## 概览

本设计落地 spec 1 的全部需求：在 `shared/blueprint/contracts.ts` 上**追加**可选 staleness 字段（不动既有字段）；在 `server/routes/blueprint/staleness/` 下落地**纯函数级**的依赖图与 invalidation 引擎；在 `server/routes/blueprint.ts` 内 mount 一个**只读**端点 `GET /api/blueprint/jobs/:jobId/stale-artifacts`。本 spec 是 5-spec 系列（autopilot blueprint 流"返回 / 重新规划 / 内联编辑"生命周期）的数据基座，所有上层 spec（spec 2 显式 replan / spec 3 inline edit / spec 4 family 视图 / spec 5 协调层）只能以**调用方**身份使用本 spec 暴露的纯函数与字段。

设计的三个不变量：

1. **零拷贝既有形态**：既有 `BlueprintGenerationArtifact` / `BlueprintGenerationJob` / 既有路由 / 既有测试断言无任何修改；新增字段一律 `?:` 可选；旧 job 在 store 中读出来，stale 字段缺失时按 fresh 处理。
2. **纯函数 + 不可变**：`invalidateDownstream` 是深度不可变纯函数，不修改入参、不触发 IO、不调用 LLM / Docker / MCP；返回新 job 对象（structural copy）。
3. **单调写入**：`staleSince` 一旦写入，本 spec 任一路径都不会清除；唯一的"清除"出现在未来 spec（spec 2 replan 重写或 stage-specific 重新生成端点）写入"全新 job 副本"时——那也不算清除，是新 artifact 替换。

## 架构

### 模块边界与文件布局

```
shared/blueprint/contracts.ts           ← 仅追加 4 个新类型/字段（向后兼容）
shared/blueprint/index.ts               ← re-export 新类型
server/routes/blueprint/
  staleness/
    dependency-graph.ts                 ← BLUEPRINT_ASSET_DEPENDENCY_GRAPH + 3 个辅助纯函数
    invalidate-downstream.ts            ← invalidateDownstream + writeStaleMarker (内部辅助)
    artifact-walker.ts                  ← 内部 utility：遍历 job 上所有可能携带 stale marker 的 artifact 位置
    stale-artifacts-route.ts            ← createStaleArtifactsHandler 工厂（router 注册由 blueprint.ts 完成）
    __tests__/
      __fixtures__/
        build-fixture-job.ts            ← BlueprintGenerationJob factory（用于测试）
        arbitraries.ts                  ← fast-check arbitraries
      dependency-graph.test.ts          ← example-based
      invalidate-downstream.test.ts     ← fast-check property + example
      stale-artifacts-route.test.ts     ← example-based
server/routes/blueprint.ts              ← 仅在 createBlueprintRouter 内追加一行 router.get 注册
```

`server/routes/blueprint.ts` 已经是 2000+ 行的总装文件、已 mount 三十多条既有路由。新增挂载点位置选在 `router.get("/jobs/:jobId/artifact-ledger", ...)` 之后（既有 ledger 端点的镜像位置），保持只读端点聚团。

### 与现有依赖的接线

- **依赖**：`BlueprintServiceContext`（用于 logger / now 注入）、`BlueprintJobStore.get(jobId)`（只读）、`shared/blueprint/contracts.ts` 既有类型。
- **不依赖**：`BlueprintEventBus`（不发事件）、LLM client、executor client、role container loader、agent crew、capability bridges、docker / mcp / aigc bridges。本 spec 的 invalidation 引擎对所有这些子系统不可见、不触发。
- **不接线**：spec 1 **明确不**接线到既有 `POST /jobs/:jobId/route-selection` / `DELETE /route-selection` / 任一 `PATCH /intake` 等既有 modify 路径。spec 2 / spec 3 才接线，spec 1 仅暴露能力。

### 数据流

```
(spec 2/3 调用，spec 1 不接线)
caller        ─→  invalidateDownstream(job, fromStage, options)
                    │
                    ├─ getTransitiveDownstreamStages(fromStage)
                    │     使用 BLUEPRINT_ASSET_DEPENDENCY_GRAPH
                    │
                    ├─ artifact-walker.walkAllStaleableLocations(job)
                    │     遍历 job.artifacts + 嵌套 artifact 位置
                    │
                    ├─ for each artifact at downstream stage:
                    │     if staleSince === undefined: writeStaleMarker(...)
                    │     else: skip（单调性保证）
                    │
                    └─ rebuildStaleArtifactIds(newJob)
                          扫一遍新 job，产出 staleArtifactIds 索引

(独立路径)
GET /api/blueprint/jobs/:jobId/stale-artifacts
   ─→ jobStore.get(jobId)
   ─→ 纯函数：从 job 形态推导响应（不调用引擎）
   ─→ 200 / 404
```

### 非功能性约束

- **响应时间**：`GET /stale-artifacts` 在 100ms 内返回（in-memory store + 纯遍历）；`invalidateDownstream` 单次调用在 50ms 内（artifact 数量 ≤ 1000 的假设下）。
- **可观测性**：`info` / `debug` 日志各一条，沿用 `ctx.logger.*`，不引入新 logger / 新 transport。
- **GitHub Pages 静态预览**：纯前端预览没有后端路由可调用，但 stale 字段缺失时按 fresh 处理是 contracts 层兼容性保证。

## 组件设计

### C1. Shared Contracts（`shared/blueprint/contracts.ts`）

#### C1.1 新增类型（追加位置：紧挨 `BlueprintGenerationArtifact` 定义之后）

```typescript
export type BlueprintStaleReason =
  | "upstream_target_changed"
  | "upstream_clarification_changed"
  | "upstream_route_changed"
  | "upstream_route_selection_changed"
  | "upstream_explicit_invalidation";

export interface BlueprintStaleSource {
  stage: BlueprintGenerationStage;
  artifactId: string;
  artifactType: BlueprintGenerationArtifactType;
  reason: BlueprintStaleReason;
  triggeredAt: string;  // ISO 8601 UTC
}
```

#### C1.2 在 `BlueprintGenerationArtifact` 上追加（不修改既有 6 个字段）

```typescript
export interface BlueprintGenerationArtifact {
  id: string;
  type: BlueprintGenerationArtifactType;
  title: string;
  summary: string;
  createdAt: string;
  payload?: unknown;
  // ↓ 本 spec 新增（需求 1.1 / 1.2）
  staleSince?: string;          // ISO 8601 UTC；undefined 即 fresh
  invalidatedBy?: BlueprintStaleSource;
}
```

#### C1.3 在 `BlueprintGenerationJob` 上追加（不修改既有字段）

```typescript
export interface BlueprintGenerationJob {
  // ... 既有字段不变
  // ↓ 本 spec 新增（需求 1.4）
  staleArtifactIds?: string[];  // 派生索引，权威源仍是各 artifact 的 staleSince
}
```

#### C1.4 必要时在 stage-specific 子结构上追加可选 staleness 字段

需求 3.8 要求"stale marker 同步写入 stage-specific 子结构"。具体哪些子结构需要承载 staleness 字段，由 design 决定。本设计采取以下口径：

- **首选方案：仅在 `BlueprintGenerationArtifact` 上写**。因为既有 ledger / replay 路径已经把每个 stage-specific 产物（spec_tree / spec_documents / effect_preview / prompt_packages / engineering_runs 等）镜像为 `BlueprintGenerationArtifact` 条目（type 字段区分），spec 4 / spec 5 的视觉层只需读 `job.artifacts` 即可拿到全集 stale 状态。
- **不在子结构上写**：`BlueprintRouteSet` / `BlueprintRouteSelection` / `BlueprintSpecTree` / `BlueprintSpecDocument` / `BlueprintEffectPreview` / `BlueprintImplementationPromptPackage` / `BlueprintCapabilityInvocation` / `BlueprintEngineeringRun` 这些子结构是**生成业务的产出 payload**，把 staleness 灌进去会扩大改面、影响既有生成逻辑的字段语义。spec 1 只在 `job.artifacts` 数组的 `BlueprintGenerationArtifact` 元素上写 stale marker，子结构通过 `artifactId` 反查即可拿到 staleness。

这一选择与需求 3.8 兼容：需求 3.8 只要求"所有最终对外可见的下游 artifact 都必须能被遍历到"，由 ledger 镜像保证。**反向约束**：本 spec 实施时若发现某 stage 的产出不在 ledger 中（即 `job.artifacts` 不包含该 stage 的元素），属于既有 ledger 缺陷，由独立 spec 修复，spec 1 不补这个洞——只在 `getTransitiveDownstreamStages` 拿到的 stage 集合里、能在 `job.artifacts` 中找到的元素上写 stale marker。

### C2. Dependency Graph（`server/routes/blueprint/staleness/dependency-graph.ts`）

#### C2.1 直接依赖图常量

```typescript
import type { BlueprintGenerationStage } from "../../../../shared/blueprint/contracts.js";

export const BLUEPRINT_ASSET_DEPENDENCY_GRAPH: Readonly<
  Record<BlueprintGenerationStage, readonly BlueprintGenerationStage[]>
> = Object.freeze({
  input: ["clarification"],
  clarification: ["route_generation"],
  route_generation: ["spec_tree"],
  spec_tree: ["spec_docs"],
  spec_docs: ["preview", "effect_preview"],
  preview: ["effect_preview"],
  effect_preview: ["prompt_packaging"],
  prompt_packaging: ["runtime_capability"],
  runtime_capability: ["engineering_handoff"],
  engineering_handoff: ["engineering_landing"],
  engineering_landing: [],
});
```

`Object.freeze` 保证调用方无法变更图（避免运行时被某个调用点意外改写）。`readonly` 标注使 TS 在编译期阻止赋值。

#### C2.2 三个辅助纯函数

```typescript
/** 拓扑排序后的传递下游 stage 列表（不含 fromStage 自身）。 */
export function getTransitiveDownstreamStages(
  fromStage: BlueprintGenerationStage,
): BlueprintGenerationStage[] {
  // BFS：沿 BLUEPRINT_ASSET_DEPENDENCY_GRAPH 出边走
  // 用 visited Set 防止重复访问（DAG 应无环，作为防御）
  // 返回时按 BFS 顺序，等价于拓扑序（DAG）
}

export function isDownstreamOf(
  candidate: BlueprintGenerationStage,
  fromStage: BlueprintGenerationStage,
): boolean {
  return getTransitiveDownstreamStages(fromStage).includes(candidate);
}

/** artifactType → stage 映射；未知 type 返回 undefined。 */
export function mapArtifactTypeToStage(
  artifactType: BlueprintGenerationArtifactType,
): BlueprintGenerationStage | undefined {
  // 完整 28 个 artifactType（contracts.ts L1613-L1640）的归属：
  //   intake / github_source        → input
  //   clarification_session         → clarification
  //   project_context               → clarification
  //   route_set                     → route_generation
  //   route_selection               → route_generation
  //   spec_tree / spec_tree_version → spec_tree
  //   requirements / design / tasks → spec_docs
  //   spec_document_version         → spec_docs
  //   preview                       → preview
  //   effect_preview                → effect_preview
  //   prompt_pack                   → prompt_packaging
  //   capability_registry           → runtime_capability
  //   agent_crew / role_timeline    → runtime_capability
  //   capability_invocation         → runtime_capability
  //   capability_evidence           → runtime_capability
  //   sandbox_derivation_job        → runtime_capability
  //   engineering_plan              → engineering_handoff
  //   engineering_run               → engineering_landing
  //   replay                        → undefined  // 横切，不属于流水线 stage
  //   feedback                      → undefined  // 横切
}
```

#### C2.3 与需求的对应

- 需求 2.1 / 2.2：`BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 常量与边的精确取值。
- 需求 2.3 / 2.4：两个查询函数。
- 需求 2.5：图为 DAG（人工审视：每条出边的 stage index 都比源 stage 大，无回边）。
- 需求 2.6：`mapArtifactTypeToStage` 覆盖现有 28 个 artifact 类型，未识别返回 `undefined`（如 `replay` / `feedback`）。
- 需求 2.7：图本身不暴露任何"新增 stage"的 API，常量被 `Object.freeze` 后调用方也无法扩展。

### C3. Invalidation Engine（`server/routes/blueprint/staleness/invalidate-downstream.ts`）

#### C3.1 Public API

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintGenerationArtifactType,
  BlueprintStaleReason,
  BlueprintStaleSource,
} from "../../../../shared/blueprint/contracts.js";

export interface BlueprintInvalidateDownstreamOptions {
  reason: BlueprintStaleReason;
  triggeringArtifactId: string;
  triggeringArtifactType: BlueprintGenerationArtifactType;
  /** 注入用，默认 () => new Date().toISOString()。 */
  now?: () => string;
}

export function invalidateDownstream(
  job: BlueprintGenerationJob,
  fromStage: BlueprintGenerationStage,
  options: BlueprintInvalidateDownstreamOptions,
): BlueprintGenerationJob;
```

#### C3.2 算法（伪代码）

```typescript
function invalidateDownstream(job, fromStage, options) {
  const now = options.now ?? defaultNow;
  const downstreamStages = new Set(getTransitiveDownstreamStages(fromStage));

  // fromStage 不合法（不在 11 stage 集合）→ downstreamStages 为空 → no-op
  // （需求 3.9）
  if (downstreamStages.size === 0 && !isLegalStage(fromStage)) {
    return job;  // structural identity preserved
  }

  // 深度不可变更新：先克隆 artifacts 数组，再克隆数组中需要修改的元素
  const newArtifacts = job.artifacts.map((artifact) => {
    const stage = mapArtifactTypeToStage(artifact.type);
    if (stage === undefined || !downstreamStages.has(stage)) {
      return artifact;  // 同引用返回，避免无谓拷贝
    }
    if (artifact.staleSince !== undefined) {
      return artifact;  // 单调性：已 stale 不覆盖（需求 3.4 / 4.x）
    }
    const triggeredAt = now();
    const newSource: BlueprintStaleSource = {
      stage: fromStage,
      artifactId: options.triggeringArtifactId,
      artifactType: options.triggeringArtifactType,
      reason: options.reason,
      triggeredAt,
    };
    return {
      ...artifact,
      staleSince: triggeredAt,
      invalidatedBy: newSource,
    };
  });

  // 如果没有任何元素被改写（noop / 全已 stale / 无下游 artifact），
  // 直接返回原 job（保留 staleArtifactIds 既有值）。
  const anyChanged = newArtifacts.some((a, i) => a !== job.artifacts[i]);
  if (!anyChanged && job.staleArtifactIds !== undefined) {
    return job;
  }

  // 重建 staleArtifactIds：扫一遍 newArtifacts，过滤 staleSince !== undefined 的 id
  const staleArtifactIds = newArtifacts
    .filter((a) => a.staleSince !== undefined)
    .map((a) => a.id);

  return {
    ...job,
    artifacts: newArtifacts,
    staleArtifactIds,
  };
}
```

#### C3.3 不可变保证

- 入参 `job` 不被修改：`job.artifacts.map(...)` 返回新数组；改写元素时用 `{ ...artifact, staleSince, invalidatedBy }` 返回新对象。
- `payload` / `summary` / `title` / `createdAt` / `id` / `type` 全部从原 artifact 透传（`...artifact`），不被读出后再写回（需求 3.7）。
- `BlueprintGenerationJob` 的 `status` / `stage` / `handoffState` / `nextAction` / `events` / `error` 全部不在 `{ ...job, ... }` 展开后再覆盖（需求 3.7）。
- `staleArtifactIds` 是**派生**字段，每次都从新 artifacts 数组重算。

#### C3.4 与需求的对应

- 需求 3.1：函数签名严格对齐。
- 需求 3.2：深度不可变（map 返回新数组，元素改写用新对象）。
- 需求 3.3：仅在 `downstreamStages.has(stage)` 时写；`fromStage` 自身不在该集合（`getTransitiveDownstreamStages` 不含起点）。
- 需求 3.4：`if (artifact.staleSince !== undefined) return artifact` 直接 short-circuit。
- 需求 3.5：写入字段构造严格对齐 `BlueprintStaleSource` 形态。
- 需求 3.6：`staleArtifactIds` 重算时按 `newArtifacts` 顺序（即原始 `job.artifacts` 顺序）。
- 需求 3.7：除 `staleSince` / `invalidatedBy` 外其他字段不动。
- 需求 3.8：在 `BlueprintGenerationArtifact` 元素上写（统一 entry point；ledger 镜像保证子结构可达，参见 C1.4）。
- 需求 3.9：非法 fromStage 时 `getTransitiveDownstreamStages` 返回空数组 → 主循环不进入分支 → 返回原 job。
- 需求 3.10：`job.artifacts` 中无下游 stage 的元素时主循环 noop → `anyChanged === false` → 返回原 job。

### C4. Stale Artifacts Route（`server/routes/blueprint/staleness/stale-artifacts-route.ts`）

#### C4.1 Handler 工厂

```typescript
import type { Request, Response } from "express";
import type { BlueprintJobStore } from "../job-store.js";
import type { BlueprintServiceContext } from "../context.js";

export interface StaleArtifactsHandlerDeps {
  jobStore: BlueprintJobStore;
  // logger 与 now 通过 ctx 注入
  ctx: Pick<BlueprintServiceContext, "logger">;
}

export function createStaleArtifactsHandler(
  deps: StaleArtifactsHandlerDeps,
): (req: Request, res: Response) => void {
  return (req, res) => {
    const jobId = req.params.jobId;
    const job = deps.jobStore.get(jobId);
    if (!job) {
      // debug-level not info-level（需求 11.3 隐含）
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    const generatedAt = new Date().toISOString();
    const staleArtifacts = job.artifacts
      .filter((a) => a.staleSince !== undefined && a.invalidatedBy !== undefined)
      .map((a) => ({
        artifactId: a.id,
        artifactType: a.type,
        stage: mapArtifactTypeToStage(a.type) ?? a.type, // 防御
        staleSince: a.staleSince!,
        invalidatedBy: a.invalidatedBy!,
      }));
    res.status(200).json({
      jobId,
      generatedAt,
      staleArtifacts,
    });
  };
}
```

#### C4.2 路由注册（在 `server/routes/blueprint.ts` 内追加单行）

紧邻 `router.get("/jobs/:jobId/artifact-ledger", ...)` 之后：

```typescript
import { createStaleArtifactsHandler } from "./blueprint/staleness/stale-artifacts-route.js";

// ... 既有 router 装配代码 ...

router.get(
  "/jobs/:jobId/stale-artifacts",
  createStaleArtifactsHandler({ jobStore, ctx: blueprintServiceContext }),
);
```

只追加一个 `import` 与一个 `router.get` 调用，不修改 `createBlueprintRouter` 的入参签名、不修改 deps 解构、不修改既有装配顺序。

#### C4.3 与需求的对应

- 需求 7.1：`router.get("/jobs/:jobId/stale-artifacts", ...)`。
- 需求 7.2：响应体精确对齐。
- 需求 7.3：`job === null` 时 `404 + { error: "job_not_found" }`。
- 需求 7.4：`staleArtifacts: []` 在无 stale 时仍返回 200。
- 需求 7.5：filter + map 保持 `job.artifacts` 原顺序。
- 需求 7.6：handler 只接受 GET（Express 默认 405 行为对其他方法）。
- 需求 7.7：响应不带 `Cache-Control` / `ETag`，无分页参数解析，不读取 auth 字段。
- 需求 7.8：handler 仅访问 `jobStore.get`，不调用任何 LLM / Docker / MCP。

### C5. Logger 接线

#### C5.1 Invalidation 引擎日志

引擎本身是纯函数，不打日志。日志在调用方包装层（spec 2 / spec 3 落地时由 caller 负责）。**但** spec 1 提供一个内部辅助 `logInvalidation(ctx, jobId, fromStage, options, markedCount)`，spec 2 / spec 3 接线时可以直接复用：

```typescript
// staleness/log-invalidation.ts（内部模块，不是 public API，但被 invalidate-downstream.ts 内部使用）
export function logInvalidation(
  ctx: Pick<BlueprintServiceContext, "logger">,
  jobId: string,
  fromStage: BlueprintGenerationStage,
  options: BlueprintInvalidateDownstreamOptions,
  markedCount: number,
  alreadyStaleCount: number,
): void {
  if (markedCount > 0) {
    ctx.logger.info("[blueprint-staleness] invalidate downstream", {
      jobId,
      fromStage,
      reason: options.reason,
      triggeringArtifactId: options.triggeringArtifactId,
      markedArtifactCount: markedCount,
    });
  } else {
    ctx.logger.debug("[blueprint-staleness] invalidate noop", {
      jobId,
      fromStage,
      alreadyStaleCount,
    });
  }
}
```

但 spec 1 需求 12.6 明确要求"`invalidateDownstream` 函数被导出且可被未来调用"，且需求 11.1 / 11.2 把日志责任挂在 invalidation 行为本身。为兼容这两点，本设计选择：

- `invalidateDownstream` **本身不打日志**（保持纯函数）；
- 提供一个**伴随**导出函数 `invalidateDownstreamWithLog(ctx, job, fromStage, options)`，内部调用 `invalidateDownstream` 并依据返回结果选择 info / debug 级日志；
- spec 2 / spec 3 在接线时调用 `invalidateDownstreamWithLog`，spec 1 自身的测试调用 `invalidateDownstream`（保持纯函数测试无需 mock logger）。

```typescript
export function invalidateDownstreamWithLog(
  ctx: Pick<BlueprintServiceContext, "logger">,
  job: BlueprintGenerationJob,
  fromStage: BlueprintGenerationStage,
  options: BlueprintInvalidateDownstreamOptions,
): BlueprintGenerationJob {
  const before = countStale(job);
  const next = invalidateDownstream(job, fromStage, options);
  const after = countStale(next);
  const markedCount = after - before;
  const alreadyStaleCount = before;
  logInvalidation(ctx, job.id, fromStage, options, markedCount, alreadyStaleCount);
  return next;
}
```

#### C5.2 Stale Artifacts 路由日志

需求 11.3：默认不打 info 日志（避免轮询污染）。本设计选择**完全不打**（即使 debug 级）——既有 GET 路由（如 `GET /jobs/:jobId/spec-tree` / `GET /jobs/:jobId/spec-documents`）都没有逐请求日志，保持一致。

#### C5.3 敏感字段过滤

需求 11.4 / 12.8 禁止输出 `payload` / GitHub URL / API key / token。`logInvalidation` 的 payload 字段集合是 `{ jobId, fromStage, reason, triggeringArtifactId, markedArtifactCount }` / `{ jobId, fromStage, alreadyStaleCount }`，全部是元数据，无敏感信息。

## 数据模型

| 名称 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `BlueprintStaleReason` | `shared/blueprint/contracts.ts` | union literal | 5 个取值（需求 1.3） |
| `BlueprintStaleSource` | `shared/blueprint/contracts.ts` | interface | 5 个字段（需求 1.2） |
| `BlueprintGenerationArtifact.staleSince` | `shared/blueprint/contracts.ts` | `string?` | ISO 8601 UTC |
| `BlueprintGenerationArtifact.invalidatedBy` | `shared/blueprint/contracts.ts` | `BlueprintStaleSource?` | 与 `staleSince` 同步出现/缺失 |
| `BlueprintGenerationJob.staleArtifactIds` | `shared/blueprint/contracts.ts` | `string[]?` | 派生索引 |
| `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` | `server/routes/blueprint/staleness/dependency-graph.ts` | `Readonly<Record<...>>` | 11 个 stage 的边 |
| `BlueprintInvalidateDownstreamOptions` | `server/routes/blueprint/staleness/invalidate-downstream.ts` | interface | 引擎入参 |

## 错误处理

| 场景 | 行为 |
|---|---|
| `invalidateDownstream(job, "unknown_stage", ...)` | 返回原 job（结构等价），不抛错（需求 3.9） |
| `invalidateDownstream(job_no_downstream, "engineering_landing", ...)` | 返回原 job（结构等价），不抛错（需求 3.10） |
| `GET /stale-artifacts` 时 jobId 不存在 | 404 + `{ error: "job_not_found" }`（需求 7.3） |
| `GET /stale-artifacts` 时 job 存在但无 stale | 200 + `staleArtifacts: []`（需求 7.4） |
| `GET /stale-artifacts` 收到非 GET 方法 | 由 Express 返回 404 / 405（既有路由层一致行为） |
| 响应 schema 异常（理论不发生，因为 handler 是纯函数） | 由 Express 默认错误处理；本 spec 不引入 try/catch 包裹 |

## 测试策略

### T1. `dependency-graph.test.ts`（example-based）

- `getTransitiveDownstreamStages("input")` → `["clarification", "route_generation", "spec_tree", "spec_docs", "preview", "effect_preview", "prompt_packaging", "runtime_capability", "engineering_handoff", "engineering_landing"]`（顺序按 BFS / 拓扑序）
- `getTransitiveDownstreamStages("engineering_landing")` → `[]`
- `getTransitiveDownstreamStages("spec_docs")` → `["preview", "effect_preview", "prompt_packaging", "runtime_capability", "engineering_handoff", "engineering_landing"]`（注意 preview/effect_preview 都在）
- `isDownstreamOf("spec_tree", "input")` → `true`
- `isDownstreamOf("input", "spec_tree")` → `false`（反向）
- `isDownstreamOf("input", "input")` → `false`（不含自身）
- `mapArtifactTypeToStage("intake")` → `"input"`
- `mapArtifactTypeToStage("replay")` → `undefined`
- 边界：未知 type 字符串（运行时塞入非合法枚举值）→ `undefined`，不抛错
- 边界：未知 stage（运行时塞入）→ `getTransitiveDownstreamStages` 返回 `[]`

### T2. `invalidate-downstream.test.ts`（fast-check + example）

#### Property tests（≥ 100 iterations 各）

- **幂等性**（需求 4.1 / 4.3）：`invalidateDownstream(job, fromStage, options)` 与 `invalidateDownstream(invalidateDownstream(job, ...), ...)` 在 `staleSince` / `invalidatedBy` 字段集合上结构等价。
- **timestamp 不被覆盖**（需求 4.2）：第二次调用使用 `now: () => "<later-iso>"` 时，所有 stale artifact 的 `staleSince` 仍是第一次的值。
- **单调性**（需求 5.1 / 5.4）：随机生成 `(job, fromStage)` 序列连续应用，序列开始时 stale 的 artifact 在序列结束时仍 stale。
- **深度不可变**（需求 3.2）：`Object.is(invalidateDownstream(job, ...), job)` 在有写入时为 false（返回新对象），无写入时可以为 true（结构等价，可以是同引用作为优化）；任何情况下入参 `job.artifacts[i]` 在调用前后引用不变（深度 freeze 比较）。
- **不写 fromStage 自身**（需求 3.3）：`fromStage = "spec_tree"` 时，`spec_tree` artifact 的 `staleSince` 始终保持调用前状态（fresh→fresh，stale→stale）。

#### Example tests

- 全 fresh 的 job + `fromStage = "input"` → 所有 11 stage 中除 input 外的 artifact 都被标记 stale；fromStage 自身不变。
- 部分已 stale + `fromStage = "input"` → 已 stale 的字段不被覆盖；其他下游被新标记。
- noop 修改（无下游 artifact 的 job + 任意 fromStage）→ 返回原 job，`staleArtifactIds` 保持原值（需求 3.10）。
- 非法 fromStage（运行时塞入字符串）→ 返回原 job（需求 3.9）。
- `staleArtifactIds` 顺序：标记两个 artifact（id 在 `job.artifacts` 中位于 index 1 与 5）→ 输出 `staleArtifactIds = [<id_at_1>, <id_at_5>]`（需求 3.6）。

### T3. `stale-artifacts-route.test.ts`（example-based via supertest）

- 200 + 响应 schema（需求 7.2）：构造 fixture job、用引擎写入 staleness、handler 返回完整字段。
- 404 + `{ error: "job_not_found" }`（需求 7.3）：未知 jobId。
- 200 + 空数组（需求 7.4）：fresh job。
- 顺序（需求 7.5）：构造 stale 元素位于 `job.artifacts` index 0 / 3 / 7 → 响应数组按 0/3/7 顺序。
- 405 / 404 行为（需求 7.6）：POST / PATCH / DELETE 该路由 → 由 Express 拒绝（不需要 handler 显式处理）。
- 副作用验证（需求 7.8）：spy 验证 LLM client / executor / event bus 全部未被调用。

### T4. Fixtures（`__fixtures__/build-fixture-job.ts`）

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationArtifact,
  BlueprintGenerationStage,
  BlueprintGenerationArtifactType,
} from "../../../../../shared/blueprint/contracts.js";

export function buildFixtureArtifact(
  overrides: Partial<BlueprintGenerationArtifact> = {},
): BlueprintGenerationArtifact { ... }

export function buildFixtureJob(
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob { ... }

/** 含每个 stage 各一个 artifact 的 job（用于全链路测试）。 */
export function buildFullChainJob(): BlueprintGenerationJob { ... }

/** 完全空 artifact 列表的 job（用于 noop 测试）。 */
export function buildEmptyJob(): BlueprintGenerationJob { ... }
```

`__fixtures__/arbitraries.ts` 提供 fast-check arbitraries：

```typescript
import * as fc from "fast-check";

export const blueprintStageArb = fc.constantFrom<BlueprintGenerationStage>(
  "input", "clarification", "route_generation", "spec_tree",
  "spec_docs", "preview", "effect_preview", "prompt_packaging",
  "runtime_capability", "engineering_handoff", "engineering_landing",
);

export const blueprintArtifactTypeArb = fc.constantFrom<BlueprintGenerationArtifactType>(
  "intake", "github_source", "clarification_session", /* ...28 个 */
);

/** 随机 fixture artifact，可控制 staleSince 是否预先设置。 */
export const blueprintArtifactArb = fc.record({ ... });

/** 随机 fixture job，0~50 个 artifact。 */
export const blueprintJobArb = fc.record({ ... });
```

### T5. 测试运行

- 测试位置：`server/routes/blueprint/staleness/__tests__/`
- runner：既有 `vitest.config.server.ts`（无需新增 config / npm script）
- 依赖：仅 `fast-check` 与 `vitest`，已存在于项目；不引入新 devDependencies

## 与需求的全量对照

| 需求 | 落地点 |
|---|---|
| 1.1–1.8（contracts） | C1.1–C1.4 |
| 2.1–2.7（依赖图） | C2.1–C2.3 |
| 3.1–3.10（引擎） | C3.1–C3.4 |
| 4.1–4.3（幂等性） | C3.2（algorithm）+ T2 property tests |
| 5.1–5.4（单调性） | C3.2（algorithm）+ T2 property tests |
| 6.1–6.4（stale 不阻塞读取） | 设计层不引入任何 read-side guard；既有路由不修改 |
| 7.1–7.8（端点） | C4.1–C4.3 |
| 8.1–8.7（向后兼容） | 全文未触及任一既有字段 / 路由 / 测试 |
| 9.1–9.4（与 DELETE route-selection 关系） | 设计层不接线 DELETE 端点 |
| 10.1–10.5（测试） | T1–T5 |
| 11.1–11.4（日志） | C5.1–C5.3 |
| 12.1–12.9（范围边界） | 全文未引入 UI / 用户动作 / replan / 版本历史 / 协调器 / 自动接线 |

## 实施风险与对冲

| 风险 | 对冲 |
|---|---|
| `mapArtifactTypeToStage` 漏算某个 artifactType | example tests 枚举所有 28 个 type；CI 失败即看见 |
| `Object.freeze` 在被嵌套修改时不抛错（TypeScript-only enforcement） | 测试验证：试图 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH.input.push(...)` 在 strict mode 下抛 TypeError |
| 既有 `job.artifacts` 不包含某 stage 的产出（ledger 缺失） | spec 1 不补，引擎只在能找到的元素上写；spec 4 read 时一致 |
| `staleArtifactIds` 派生计算的性能（artifact 数量极大时） | 当前设计 O(n)，n ≤ 1000 时 < 1ms；不引入索引缓存 |
| spec 2 / spec 3 后续接线时绕过 `invalidateDownstreamWithLog`，自己调引擎 + 自己打日志 | 设计层不强制；通过 spec 2 / spec 3 的需求约束（spec 2 §11、spec 3 §11）保证日志一致 |
| `Object.freeze` 与 TS readonly 配合不当导致运行时可改 | `Object.freeze` 是 shallow freeze；二级数组（`["clarification"]`）也需 `.map(arr => Object.freeze(arr))`，本设计实施时补 deep freeze 或将整个常量做 `as const` 后转 `Readonly<>` |

## 下游 spec 的接线点位（不在本 spec 实施）

| 下游 spec | 接线 |
|---|---|
| spec 2（replan-and-branch-action） | `POST /jobs/:jobId/replan` 内部调用 `invalidateDownstreamWithLog` |
| spec 3（stage-edit-mode） | `PATCH /intake/:intakeId` / `POST /clarifications/:sessionId/answers` / `POST /jobs/:jobId/route-selection`（重选场景）内部调用 `invalidateDownstreamWithLog` |
| spec 4（stage-version-history） | 只读消费 `job.artifacts[i].staleSince` 与 `job.staleArtifactIds`；可选调用 `GET /stale-artifacts` 作为辅助数据源 |
| spec 5（stage-state-coordination） | 不直接接线引擎；消费 `staleArtifactIds` 做视觉刷新协调 |
