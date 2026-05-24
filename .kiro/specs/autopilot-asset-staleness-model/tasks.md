# 实施任务：Autopilot Asset Staleness Model

> 本任务列表对应 `requirements.md` 与 `design.md`。每个顶层任务对应一个独立可合并的 PR / commit；子任务为顺序步骤。
> 完成顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。各顶层任务在前一项合并后才动手，避免对未冻结的契约做并行依赖。

## 1. 在 `shared/blueprint/contracts.ts` 上追加 staleness 字段与类型

- [x] 1.1 在 `BlueprintGenerationStage` 之后、`BlueprintGenerationArtifact` 之前追加 `BlueprintStaleReason` union（5 个取值，对齐需求 1.3）
- [x] 1.2 追加 `BlueprintStaleSource` interface（5 个字段，对齐需求 1.2）
- [x] 1.3 在既有 `BlueprintGenerationArtifact` interface 末尾追加 `staleSince?: string` 与 `invalidatedBy?: BlueprintStaleSource`，**不修改既有 6 个字段**
- [x] 1.4 在既有 `BlueprintGenerationJob` interface 末尾追加 `staleArtifactIds?: string[]`，**不修改既有字段**
- [x] 1.5 在 `shared/blueprint/index.ts` re-export 新类型，确保既有 import 路径 `from "@shared/blueprint"` 与 `from "@shared/blueprint/contracts"` 都能取到
- [x] 1.6 跑 `npx tsc --noEmit` 确认零类型错误（基线不扩大）；如有错，修正只在新增部分而不修改既有断言
- 需求覆盖：1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 / 1.7 / 1.8

## 2. 落地 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 与三个辅助纯函数

- [x] 2.1 创建文件 `server/routes/blueprint/staleness/dependency-graph.ts`
- [x] 2.2 导出常量 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`，使用 `Object.freeze` + 二级数组 `Object.freeze`（deep freeze），类型 `Readonly<Record<BlueprintGenerationStage, readonly BlueprintGenerationStage[]>>`，11 stage 的边精确对齐需求 2.2
- [x] 2.3 导出 `getTransitiveDownstreamStages(fromStage)`：BFS + visited Set；返回拓扑序数组（不含 fromStage）；非法 fromStage 返回 `[]`
- [x] 2.4 导出 `isDownstreamOf(candidate, fromStage)`：基于 `getTransitiveDownstreamStages` 的 `.includes`
- [x] 2.5 导出 `mapArtifactTypeToStage(artifactType)`：覆盖现有 28 个 artifact 类型；未识别（`replay` / `feedback`）返回 `undefined`
- 需求覆盖：2.1 / 2.2 / 2.3 / 2.4 / 2.5 / 2.6 / 2.7

## 3. 落地 `invalidateDownstream` 引擎与伴随导出

- [x] 3.1 创建文件 `server/routes/blueprint/staleness/invalidate-downstream.ts`
- [x] 3.2 导出 `BlueprintInvalidateDownstreamOptions` interface（reason / triggeringArtifactId / triggeringArtifactType / now?）
- [x] 3.3 实现 `invalidateDownstream(job, fromStage, options)` 纯函数：
  - 用 `getTransitiveDownstreamStages` 取下游 stage 集合
  - `job.artifacts.map(...)`：对每个 artifact，若 stage 在下游集合且 `staleSince === undefined`，返回新对象写入 staleSince + invalidatedBy；否则返回同引用
  - 检测 anyChanged；无变化时返回原 job（保 staleArtifactIds 既有值）
  - 有变化时返回新 job 对象 + 重算 staleArtifactIds（按原 artifact 顺序）
- [x] 3.4 实现内部辅助 `logInvalidation(ctx, jobId, fromStage, options, markedCount, alreadyStaleCount)`，按需求 11.1 / 11.2 输出 info / debug 级日志
- [x] 3.5 导出 `invalidateDownstreamWithLog(ctx, job, fromStage, options)` 伴随包装：内部调 `invalidateDownstream` + `logInvalidation`，给 spec 2 / 3 接线方使用；纯函数版本 `invalidateDownstream` 不打日志
- [x] 3.6 处理需求 3.9（非法 fromStage 返回原 job 不抛错）与 3.10（无下游 artifact 返回原 job 不抛错）
- 需求覆盖：3.1–3.10 / 11.1 / 11.2 / 11.4 / 11.5

## 4. 编写 fast-check 与 example-based 测试

- [x] 4.1 创建 `server/routes/blueprint/staleness/__tests__/__fixtures__/build-fixture-job.ts`，导出 `buildFixtureArtifact` / `buildFixtureJob` / `buildFullChainJob` / `buildEmptyJob`
- [x] 4.2 创建 `__fixtures__/arbitraries.ts`：`blueprintStageArb` / `blueprintArtifactTypeArb` / `blueprintArtifactArb` / `blueprintJobArb`
- [x] 4.3 创建 `dependency-graph.test.ts`：example tests 覆盖 11 stage 的传递下游序列、`isDownstreamOf` 正反向、`mapArtifactTypeToStage` 28 type 映射 + `replay` / `feedback` 返回 undefined
- [x] 4.4 创建 `invalidate-downstream.test.ts`：
  - property: 幂等性（≥ 100 iter，需求 4.1 / 4.3）
  - property: timestamp 不被覆盖（≥ 100 iter，需求 4.2）
  - property: 单调性（≥ 100 iter，需求 5.1 / 5.4）
  - property: 深度不可变（≥ 100 iter，需求 3.2）
  - property: fromStage 自身不被标 stale（≥ 100 iter，需求 3.3）
  - example: 全 fresh + fromStage="input" → 10 个下游全 stale；fromStage 自身不变
  - example: 部分已 stale + 二次调用 → marker 不变
  - example: noop（无下游 artifact）→ 返回原 job
  - example: 非法 fromStage（运行时塞入字符串）→ 返回原 job
  - example: staleArtifactIds 顺序按 artifacts 原序
- [x] 4.5 跑 `npx vitest --config vitest.config.server.ts run server/routes/blueprint/staleness` → 全绿
- 需求覆盖：4.x / 5.x / 10.1 / 10.2 / 10.3 / 10.4 / 10.5

## 5. 落地 `GET /api/blueprint/jobs/:jobId/stale-artifacts` 端点

- [x] 5.1 创建文件 `server/routes/blueprint/staleness/stale-artifacts-route.ts`
- [x] 5.2 实现 `createStaleArtifactsHandler(deps)` 工厂；handler 体仅访问 `jobStore.get`，纯函数派生响应；不调 LLM / Docker / event bus
- [x] 5.3 处理 404（jobId 不存在）+ 200（含 `staleArtifacts: []` 的 fresh 场景）
- [x] 5.4 响应中 artifact 顺序按 `job.artifacts` 原序（filter + map）
- [x] 5.5 响应 schema 严格对齐需求 7.2（jobId / generatedAt / staleArtifacts[].{artifactId, artifactType, stage, staleSince, invalidatedBy}）
- 需求覆盖：7.1 / 7.2 / 7.3 / 7.4 / 7.5 / 7.6 / 7.7 / 7.8

## 6. 编写 stale-artifacts 路由测试

- [x] 6.1 创建 `__tests__/stale-artifacts-route.test.ts`，使用 supertest（沿用既有 blueprint-routes 测试风格；Worker D note: 未新增 supertest 依赖，已用既有 `withServer`/`fetch` blueprint route 风格覆盖同等行为）
- [x] 6.2 example: 200 + 完整响应 schema（已 stale 的 fixture）
- [x] 6.3 example: 404 + `{ error: "job_not_found" }`（未知 jobId）
- [x] 6.4 example: 200 + `staleArtifacts: []`（fresh job）
- [x] 6.5 example: 顺序断言（artifact 位于 index 0/3/7 → 响应数组按 0/3/7）
- [x] 6.6 example: POST/PATCH/DELETE 该路径返回 404 / 405（Express 默认）
- [x] 6.7 example: spy LLM client / executor / event bus 全部未被调用
- [x] 6.8 跑该测试文件 → 全绿
- 需求覆盖：7.1–7.8 / 10.1

## 7. 在 `server/routes/blueprint.ts` 注册新路由

- [x] 7.1 在文件顶部 import `createStaleArtifactsHandler`
- [x] 7.2 在 `createBlueprintRouter` 内、紧邻 `router.get("/jobs/:jobId/artifact-ledger", ...)` 之后追加：
  ```typescript
  router.get(
    "/jobs/:jobId/stale-artifacts",
    createStaleArtifactsHandler({ jobStore, ctx: blueprintServiceContext }),
  );
  ```
- [x] 7.3 不修改 `createBlueprintRouter` 入参签名、不修改既有装配顺序
- [x] 7.4 跑既有 `server/tests/blueprint-routes.test.ts` 全部 51+ 用例 → 不能破任一既有断言（需求 8.5）
- [x] 7.5 跑全量 `npx vitest --config vitest.config.server.ts --run` → 失败 0 / skip 0（需求 8.6）
- 需求覆盖：6.1 / 6.2 / 6.3 / 6.4 / 8.5 / 8.6

## 8. 验证向后兼容性与 GitHub Pages

- [x] 8.1 跑 `npm run build:pages` 确认静态预览构建无报错（需求 8.7）
- [x] 8.2 在 GitHub Pages 预览模式下加载一个**既有 job**（无 staleSince 字段）→ 前端按 fresh 处理、不抛 schema 校验异常（需求 8.2）
- [x] 8.3 验证 `DELETE /api/blueprint/jobs/:jobId/route-selection` 端点行为不变（需求 8.3 / 9.1 / 9.2 / 9.3）
- [x] 8.4 验证 `shared/blueprint/contracts.ts` 中既有字段集合是新形态的子集（diff check）（需求 8.4）
- [x] 8.5 在 PR 描述里勾选"不引入 socket 通道 / 持久化 / 鉴权 / 审计 / 限流"checklist（需求 12.8）
- 需求覆盖：8.1–8.7 / 9.1–9.4 / 12.x

## 任务依赖图

```
1 (contracts) ─┬─→ 2 (graph) ─┬─→ 3 (engine) ─┬─→ 4 (engine tests)
               │               │                ↓
               │               └────────────────┘
               │                                ↓
               └─→ 5 (route) ─→ 6 (route tests) ─→ 7 (registration) ─→ 8 (compat)
```

任务 1 产出共享类型，是其他所有任务的硬依赖；任务 2 / 3 / 5 在类型冻结后可顺序推进；任务 4 / 6 紧跟各自实现；任务 7 / 8 是最后的接线 + 验证。
