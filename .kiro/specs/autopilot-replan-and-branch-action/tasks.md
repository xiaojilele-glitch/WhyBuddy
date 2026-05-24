# 实施任务：Autopilot Replan And Branch Action

> 本任务列表对应 `requirements.md` 与 `design.md`。**前置依赖**：spec 1（`autopilot-asset-staleness-model`）已合并到主分支并落地；本 spec 在任务 3 引擎调用时直接 `import { invalidateDownstreamWithLog } from "../staleness/invalidate-downstream.js"`。
> 完成顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10。任务 1（shared contracts + event enum）必须最先；任务 5（路由注册）在 3/4 后；前端任务 6-9 可与后端任务 7-10 并行（共享端点契约稳定后）。

## 1. 在 `shared/blueprint/` 上追加 Branch metadata 与 event enum 成员

- [x] 1.1 在 `shared/blueprint/contracts.ts` 的 `BlueprintGenerationJob` interface 末尾追加 `parentJobId?: string` / `branchedAt?: string` / `branchedFromStage?: BlueprintGenerationStage`，**不修改既有字段**
- [x] 1.2 在 `shared/blueprint/events.ts` 的 `BlueprintEventName` enum 中追加成员 `ReplanTriggered = "replan.triggered"`（如不存在），不修改既有成员；同步更新 `BlueprintGenerationEventType` union 与 `resolveBlueprintEventFamily` 函数的 switch 加 `case "replan.triggered": return "job"`
- [x] 1.3 在 `shared/blueprint/index.ts` 确认新类型与 enum 成员被 re-export
- [x] 1.4 跑 `npx tsc --noEmit` 确认零类型错误（基线不扩大）
- 需求覆盖：5.1 / 5.2 / 9.1 / 12.3 / 12.8

## 2. 落地 input 校验与 noop 检测

- [x] 2.1 创建 `server/routes/blueprint/replan/guards/validate-input.ts`，导出 `ReplanValidationResult` union 与 `validateReplanInput(body)` 函数
- [x] 2.2 校验顺序固定：fromStage → mode → reason；fromStage 必须是 11 个合法 stage 之一；mode 必须是 `in_place` / `branch`；reason 可选但若提供则字符数 ≤ 1024
- [x] 2.3 创建 `server/routes/blueprint/replan/guards/running-stage-guard.ts`，导出 `detectRunningDownstream(job, fromStage)` 函数
- [x] 2.4 算法对齐 design §C4.1：(a) `job.status === "running"` 且 `job.stage === stage`（拓扑下游内）；(b) `handoffState` 不在 `{confirmed, reset, failed, idle}`；(c) `nextAction.stage === stage` 且 `type` 不以 `review_` 开头且不是 `none`；返回拓扑最近的 stage 或 null
- [x] 2.5 例子级单元测：构造 fixture 验证三类判定；多 stage running 时返回最近一个；reviewing handoffState 视为 active；首条 example tests 提交到 `__tests__/guards.test.ts`
- 需求覆盖：3.3 / 3.4 / 3.5 / 4.1 / 4.2 / 4.3 / 4.5

## 3. 落地 in_place 模式处理器

- [x] 3.1 创建 `server/routes/blueprint/replan/replan-event-writer.ts`，实现 `writeReplanTriggeredEvent(job, payload)`（payload 字段集合恰好对齐 design §C7；reason 内部截断到 ≤ 500 字符）
- [x] 3.2 创建 `server/routes/blueprint/replan/replan-logger.ts`，实现 `logReplanTriggered` / `logReplanRejected` / `logReplanBlocked` 三函数（日志键固定 `replan.*`，不输出 reason 原文，仅 `reasonPresent` + `reasonLength`）
- [x] 3.3 创建 `server/routes/blueprint/replan/handlers/handle-in-place.ts`，实现 `handleInPlaceReplan(input)`：
  - 调 spec 1 `invalidateDownstreamWithLog(ctx, job, fromStage, { reason: "upstream_explicit_invalidation", triggeringArtifactId: job.id, triggeringArtifactType: "replay", now: ctx.now })`
  - 把返回 job 的 `stage` 字段改写为 fromStage
  - 计算 markedStaleArtifactCount（`afterCount - beforeCount`）与 markedStaleArtifactIds（diff）
  - 调 `writeReplanTriggeredEvent` 追加事件
  - 调 `jobStore.save(eventedJob)`
  - 调 `logReplanTriggered`
  - 返回 `{ mode: "in_place", job, summary }` 响应体
- 需求覆盖：3.6 / 5.1–5.7 / 6.1 / 11.1 / 11.4 / 11.5 / 11.6

## 4. 落地 branch 模式处理器与 buildBranchJob

- [x] 4.1 创建 `server/routes/blueprint/replan/branch-creator.ts`，实现 `buildBranchJob({ parentJob, fromStage, now, newJobId? })`：
  - 用 `randomUUID()` 生成新 jobId（除非 caller 显式传入 newJobId 用于测试）
  - 拷贝 parent 的 `request`（共享）/ `projectId` / `sourceId` / `version`
  - 用 `mapArtifactTypeToStage` + `getTransitiveDownstreamStages(fromStage)` 派生"严格上游 artifact"集合（不在下游路径 + 不属于 fromStage）
  - 严格上游 artifact 通过 `structuredClone` 深拷贝（payload 也深拷贝），并显式去除 `staleSince` / `invalidatedBy` 字段
  - branch job 的 stage = fromStage、status = "pending"、artifacts = inheritedArtifacts、events = `[]`、staleArtifactIds = `[]`、parentJobId = parentJob.id、branchedAt = now()、branchedFromStage = fromStage
- [x] 4.2 创建 `server/routes/blueprint/replan/handlers/handle-branch.ts`，实现 `handleBranchReplan(input)`：
  - 调 `buildBranchJob` 生成 branch job 与 inheritedUpstreamArtifactCount / Ids
  - 调 `writeReplanTriggeredEvent`（payload 含 `parentJobId`）
  - `jobStore.save(eventedBranch)`，**parent job 完全不动**（不再次 save parent）
  - 调 `logReplanTriggered`（payload 含 parentJobId）
  - 返回 `{ mode: "branch", job, parentJobId, summary }` 响应体
- 需求覆盖：3.7 / 9.1 / 9.2 / 5.1 / 6.2 / 6.3 / 11.1

## 5. 落地 replan 端点路由 + 注册

- [x] 5.1 创建 `server/routes/blueprint/replan/replan-route.ts`，实现 `createReplanHandler(deps)`：依次调用 validate-input → jobStore.get → running-guard → 分发到 in_place / branch handler；catch 内部错误返回 500 + `internal_error` + error 级日志（design §C2.1）
- [x] 5.2 在 `server/routes/blueprint.ts` 顶部 import `createReplanHandler`
- [x] 5.3 在 `createBlueprintRouter` 内紧邻 spec 1 `router.get("/jobs/:jobId/stale-artifacts", ...)` 之后追加：
  ```typescript
  router.post(
    "/jobs/:jobId/replan",
    createReplanHandler({ jobStore, ctx: blueprintServiceContext }),
  );
  ```
- [x] 5.4 不修改 `createBlueprintRouter` 入参；不修改既有装配顺序
- [x] 5.5 跑既有 `server/tests/blueprint-routes.test.ts` → 不破任一既有断言（需求 12.5）
- 需求覆盖：3.1 / 3.2 / 3.8 / 3.9 / 3.10 / 3.11 / 3.12 / 3.13

## 6. 编写后端 fast-check 与 example tests

- [x] 6.1 创建 `__fixtures__/build-fixture-job.ts`：复用 spec 1 的 `buildFixtureJob` / `buildFullChainJob`；新增 `buildBranchJobFixture` / `buildRunningJobFixture` / `buildJobWithReviewingHandoff`
- [x] 6.2 创建 `__fixtures__/arbitraries.ts`：随机合法 fromStage、随机 mode、随机 reason 三类（undefined / 空 / 1–256）、随机 fixture job
- [x] 6.3 创建 `replan-in-place.test.ts`：
  - property: in_place mode 引擎等价性（≥ 100 iter，需求 10.2 第 1 条）
  - property: in_place 幂等（≥ 100 iter，需求 10.2 第 5 条）
  - example: 200 响应 schema、`markedStaleArtifactCount === markedStaleArtifactIds.length`（需求 3.6）
  - example: 400 / 404 各错误码（需求 3.2–3.5）
  - example: events 末尾恰好追加一条 `replan.triggered`
  - example: noop fromStage（无下游 artifact 的 job）→ 仍写 `replan.triggered`
- [x] 6.4 创建 `replan-branch.test.ts`：
  - property: branch 上游保留（≥ 100 iter，需求 10.2 第 2 条）
  - property: branch 下游为空（≥ 100 iter，需求 10.2 第 3 条）
  - property: branch 是树而非链（≥ 100 iter，需求 10.2 第 4 条）
  - property: branch 上 staleArtifactIds 为空
  - example: 响应 schema、parent job deep-snapshot 不变（需求 6.3）
  - example: branch job 含 Branch_Metadata 三字段；in_place 路径无三字段（需求 9.1 / 9.2）
- [x] 6.5 在两个测试文件中各加 example：running guard 在 in_place 与 branch 两种 mode 下都 409（需求 10.5）
- [x] 6.6 跑 `npx vitest --config vitest.config.server.ts run server/routes/blueprint/replan` → 全绿
- 需求覆盖：10.1–10.8 / 11.1–11.3

## 7. 落地前端 API helper 与 inline 派生函数

- [x] 7.1 创建 `client/src/lib/blueprint-api/replan.ts`：导出 `BlueprintReplanRequest` / `BlueprintReplanResponse` 类型 + `postBlueprintReplan(jobId, body, options?)` + `BlueprintReplanError` class
- [x] 7.2 在 `client/src/lib/blueprint-api/index.ts` re-export
- [x] 7.3 创建 `client/src/pages/autopilot/right-rail/replan/derive-downstream-impact.ts`：基于 spec 1 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` + 当前 localJob 派生 `DownstreamImpact`（按 artifact type 分组的计数对象）
- [x] 7.4 创建 `useIsStaticPreviewMode` hook（如已存在则复用），通过对 `/api/blueprint/jobs/latest` 探测请求 + 模块 flag 双重判定
- 需求覆盖：1.9 / 2.2 / 12.7

## 8. 落地前端 ReplanButton 与 ReplanConfirmationModal

- [x] 8.1 创建 `client/src/pages/autopilot/right-rail/replan/ReplanButton.tsx`：
  - 文案"从这里重新规划"，`data-testid="autopilot-replan-from-stage-divider"`
  - 仅在 `isViewingCompletedStage === true && downstreamImpact.size >= 1` 渲染
  - 静态预览或下游 running → `aria-disabled="true"` + 邻近 hint 文案
  - hover ≥ 300ms / long-press ≥ 500ms → tooltip 含两条语义子句
  - 键盘 Enter / Space 等价点击
- [x] 8.2 创建 `client/src/pages/autopilot/right-rail/replan/ReplanConfirmationModal.tsx`：
  - 使用既有 `<Dialog>`（基于 `@radix-ui/react-dialog`），宽 720–960px，max-h 90vh
  - 状态机 `idle → loading_impact → ready/impact_failed/empty → in_flight → ready/error/store_sync_failed`
  - mode 切换刷新 Downstream_Impact_Summary 文案 ≤ 100ms 且 reason 保留
  - reason textarea ≤ 1000 字符 + 计数 + 阻止 confirm
  - in-flight 期间 Esc / 外点击不关闭、confirm 防重；30s 超时中止
  - 4xx/5xx 显示错误（409 显示 runningStage）；用户编辑后清错
  - 不复用 spec 3 `Inline_Confirmation` 组件（DOM 中不应存在 `data-testid="autopilot-edit-*"`）
- [x] 8.3 创建 `client/src/pages/autopilot/right-rail/replan/use-replan-flow.ts`：协调成功后的 store 更新（in_place / branch 两套）+ toast；
  - `useAutopilotJobStore` 至少含 `activeJobId` setter 与 `branchIndex.append(parentId, branchId)`（如 store 不存在则在本任务一并新建最小 store）
  - 若 spec 5 Coordination_Layer 已落地，则通过 `coordinator.submit({ triggerSource: "replan", ... })` 原子提交 store / pin / override / toast；否则保留本 spec 的直接写入兼容路径
- [x] 8.4 在 `AutopilotRightRail.tsx` 既有 stage divider CTA 区域（第 802-814 行附近）追加 ReplanButton 渲染（不替换既有"返回当前阶段"按钮）
- 需求覆盖：1.1–1.9 / 2.1–2.15 / 6.1 / 6.2 / 8.3 / 8.4

## 9. 编写前端组件测试

- [x] 9.1 创建 `__tests__/ReplanButton.test.tsx`：可见性 5 条件矩阵（viewing/non-viewing × downstream-empty/non-empty × static-preview × downstream-running）；点击触发 modal；hover tooltip 文案；键盘等效点击
- [x] 9.2 创建 `__tests__/ReplanConfirmationModal.test.tsx`：默认 mode、mode 切换文案 + reason 保留、Esc / cancel / 外点击行为（in-flight vs idle）、confirm disabled 防重复、reason 超长阻止 confirm、30s 超时分支、错误清除、不渲染 spec 3 testid
- [x] 9.3 创建 `__tests__/use-replan-flow.test.tsx`：in_place / branch 各成功一次（toast 文案断言 + branchIndex 调用）、4xx 错误抛 BlueprintReplanError、AbortController 在 30s 时调用
- [x] 9.4 跑客户端 vitest → 全绿
- 需求覆盖：10.6

## 10. 验证向后兼容性与端到端串通

- [x] 10.1 跑全量 `npx vitest --config vitest.config.server.ts --run` → 失败 0 / skip 0；spec 1 测试全绿（需求 12.6）
- [x] 10.2 跑客户端 vitest 全量 → 失败 0
- [x] 10.3 跑 `npm run build:pages` → 静态构建通过；GitHub Pages 预览模式下 ReplanButton 显示 disabled + 静态预览 hint（需求 12.7）
- [x] 10.4 手测：在本地 dev:all 模式下完整跑一次 in_place replan 与一次 branch replan，验证 audit timeline 中出现 `replan.triggered` 事件、parent job 字段不变（branch 模式）、active job 切换（branch 模式）
- [x] 10.5 PR 描述勾选"未引入新 socket 通道 / 新 BlueprintEventName 家族 / 新持久化 / 新鉴权 / 新限流"checklist（需求 12.8）
- 需求覆盖：12.1–12.9 / 13.1–13.10

## 任务依赖图

```
1 (contracts+event) ─→ 2 (validate+guard) ─→ 3 (in_place handler) ─→ 5 (route reg)
                                          └→ 4 (branch handler) ───→ 5
                                                                     ↓
                          6 (backend tests) ─────────────────────────┤
                                                                     ↓
1 ─→ 7 (frontend api) ─→ 8 (UI components) ─→ 9 (frontend tests) ───→ 10 (compat + e2e)
```

任务 1 是所有其他任务的硬依赖（共享类型）；任务 5 把后端串通；任务 7-9 在共享类型冻结后可与后端并行。
