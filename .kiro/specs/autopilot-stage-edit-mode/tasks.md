# 实施任务：Autopilot Stage Edit Mode

> 本任务列表对应 `requirements.md` 与 `design.md`。**前置依赖**：spec 1 引擎已合并；spec 2 与本 spec 在数据层都共用 spec 1 引擎，但本 spec **不依赖** spec 2 已合并（spec 3 单独使用 spec 1，无需 spec 2 的 replan 端点 / modal）。
> 完成顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10。任务 1（shared contracts）最先；任务 2（hook 模块）在 1 后；任务 3-5（三条 modify 端点接线）顺序无关但都依赖 2；前端任务 6-9 在端点契约稳定后；任务 10 是最终验证。

## 1. 在 `shared/blueprint/contracts.ts` 上追加新类型

- [x] 1.1 在文件末尾追加 `BlueprintIntakePatchRequest` interface（`targetText?` / `githubUrls?` / `reason?`）
- [x] 1.2 追加 `BlueprintStaleEditResultSummary` interface（`fromStage` / `newlyStaleArtifactIds` / `newlyStaleArtifactCount` / `staleArtifactIdsSnapshot`）
- [x] 1.3 在 `shared/blueprint/index.ts` re-export
- [x] 1.4 跑 `npx tsc --noEmit` 确认零类型错误（不破基线）
- 需求覆盖：12.3 / 12.2

## 2. 落地后端核心模块（hook + guard + locator + noop detector）

- [x] 2.1 创建 `server/routes/blueprint/stage-edit/auto-invalidation-hook.ts`：实现 `runAutoInvalidationHook(input)`，内部调 spec 1 `invalidateDownstreamWithLog`，try/catch 包裹引擎；返回 `{ job, newlyStaleArtifactIds, newlyStaleArtifactCount }`
- [x] 2.2 创建 `server/routes/blueprint/stage-edit/conflict-detection.ts`：实现 `detectRunningDownstreamForEdit(job, fromStage)`，**算法相同但文件物理隔离**于 spec 2 的 `running-stage-guard.ts`（不 import 对方）；唯一共享是 spec 1 的 `getTransitiveDownstreamStages`
- [x] 2.3 创建 `server/routes/blueprint/stage-edit/job-locator.ts`：实现 `findJobsByIntakeId` / `findJobsByClarificationSessionId`，扫 `jobStore.list()` 找所有匹配的 job（family 共享 intake / session 时返回多个）
- [x] 2.4 创建 `server/routes/blueprint/stage-edit/intake-noop-detector.ts`：实现 `detectIntakeNoop(prevIntake, patch)`——检查 patch 中每个字段（targetText / githubUrls）是否与既有值在结构上等价（githubUrls 用元素层比较）
- [x] 2.5 创建 `server/routes/blueprint/stage-edit/clarification-noop-detector.ts`：实现 `detectClarificationAnswersNoop(prevAnswers, newAnswers)`——按 questionId 匹配，逐条比较 value
- [x] 2.6 创建 `server/routes/blueprint/stage-edit/stage-edit-logger.ts`：导出 `logStageEditInvalidated` / `logStageEditNoop` / `logStageEditBlocked`，事件键 `stage_edit.*`，与 spec 2 `replan.*` / spec 1 `[blueprint-staleness]` 命名空间互斥；不输出敏感字段原文
- 需求覆盖：3.5 / 3.6 / 3.7 / 3.8 / 3.9 / 4.1 / 4.4 / 4.5 / 11.1–11.6

## 3. 新增 `PATCH /api/blueprint/intake/:intakeId` 端点

- [x] 3.1 创建 `server/routes/blueprint/stage-edit/intake-patch-validator.ts`：实现 `validateIntakePatch(body)`，校验 targetText / githubUrls / reason 类型与上限（reason ≤ 1024）
- [x] 3.2 创建 `server/routes/blueprint/stage-edit/intake-patch-route.ts`：实现 `createIntakePatchHandler(deps)`：
  - 依次调用 `intake-not-found 404` → validate → noop detect → `findJobsByIntakeId` → 对每个 job 调 `detectRunningDownstreamForEdit`（任一 running 即 409）
  - 写入 intake（更新 targetText / githubUrls / updatedAt）
  - noop 或无 job → 返回响应（无 staleEdit 字段）
  - 否则对每个 job 调 `runAutoInvalidationHook`，聚合 `newlyStaleArtifactIds`，返回 `{ intake, staleEdit }`
- [x] 3.3 在 `server/routes/blueprint.ts` 顶部 import `createIntakePatchHandler`
- [x] 3.4 在既有 `router.get("/intake/:intakeId", ...)` 之后追加：
  ```typescript
  router.patch(
    "/intake/:intakeId",
    createIntakePatchHandler({ blueprintStores, jobStore, ctx: blueprintServiceContext }),
  );
  ```
- 需求覆盖：3.1 / 3.4 / 4.1 / 7.1 / 12.2

## 4. 在既有 `clarifications/:sessionId/answers` handler 上接线 hook

- [x] 4.1 在 `server/routes/blueprint.ts` 既有 `handleClarificationAnswers`（约第 650-676 行）内追加 spec 3 接线段：
  - 在 `parseClarificationAnswersRequest` 校验通过后，先 `findJobsByClarificationSessionId`
  - 对每个 job 调 `detectRunningDownstreamForEdit`（任一 running → 409 + log + return）
  - 在调 `updateClarificationSession` 前先存 `prevAnswers = session.answers`，**之后**调 `detectClarificationAnswersNoop(prevAnswers, parsed.request.answers)`
  - 调 `updateClarificationSession`（既有调用不变）
  - 若 `!isNoop && matchingJobs.length > 0` → 对每个 job 调 `runAutoInvalidationHook`，响应中追加 `staleEdit` 字段
  - 否则返回既有响应（无 staleEdit）
- [x] 4.2 验证 POST 与 PATCH 两个方法（既有路由把它们绑同 handler）都触发 hook
- [x] 4.3 不修改 `updateClarificationSession` 函数体；不修改 `parseClarificationAnswersRequest`
- 需求覆盖：3.2 / 3.4 / 4.1

## 5. 在既有 `POST /jobs/:jobId/route-selection` handler 上接线 hook（仅 reselection 场景）

- [x] 5.1 在 `server/routes/blueprint.ts` 既有路由（约第 1122-1238 行）内追加 spec 3 接线段：
  - 在 `parseRouteSelectionRequest` 通过后、`selectRouteForSpecTree` 调用前，抓 `existingSelection = extractRouteSelection(job)` 快照判 `isReselection`
  - 仅当 `isReselection` 时调 `detectRunningDownstreamForEdit(job, "route_generation")`（running → 409 + return）
  - `selectRouteForSpecTree` 既有调用不变
  - 既有 `eventBus.emit` 既有路径不变
  - 仅当 `isReselection` 时：从 `jobStore.get(job.id) ?? response.job` 取最新 job 调 `runAutoInvalidationHook(... fromStage: "route_generation", reason: "upstream_route_selection_changed", triggeringArtifactId: response.selection.id, triggeringArtifactType: "route_selection" ...)`，把 `staleEdit` 附加到响应
  - 既有 `agentCrewStageActivationDriver.onStageTransition` 调用不变
- [x] 5.2 不修改 `selectRouteForSpecTree` / `extractRouteSelection` / `parseRouteSelectionRequest`
- [x] 5.3 验证 `DELETE /api/blueprint/jobs/:jobId/route-selection` 端点行为完全不变（spec 3 不在此处接线，需求 3.7）
- 需求覆盖：3.3 / 3.4 / 3.7 / 4.1

## 6. 编写后端 fast-check 与 example tests

- [x] 6.1 创建 `__fixtures__/build-fixture-job.ts`：复用 spec 1 / spec 2 fixtures，新增 `buildFixtureIntake` / `buildFixtureClarificationSession` / `buildJobLinkedToIntakeAndSession({ intakeId, sessionId, fromStage })`
- [x] 6.2 创建 `__fixtures__/arbitraries.ts`：随机 fixture（intake patch / clarification answers / route reselection 三类）+ 已 stale / fresh 混合 job
- [x] 6.3 创建 `intake-modify-invalidation.test.ts`：
  - property: 传递下游全 stale（≥ 100 iter）
  - property: 同字段两次幂等
  - property: noop patch 无下游 stale
  - example: PATCH 200 + staleEdit 含全下游 id；intake 不存在 404；patch body 非法 400；下游 running 409 + job deep-snapshot 不变；family 多 job 时对每个都 invalidate
- [x] 6.4 创建 `clarification-modify-invalidation.test.ts`：
  - property: 传递下游全 stale
  - property: noop answers 不写 marker
  - property: 同字段编辑两次幂等
  - example: session 不存在 404；POST 与 PATCH 都触发 hook；running 时 409 + session 字段不变 + invalidation 未调用
- [x] 6.5 创建 `route-selection-reselection.test.ts`：
  - property: 首次调用不触发 invalidation（≥ 100 iter）
  - property: 二次或后续调用触发 invalidation
  - property: 同 routeId 重复重选幂等
  - example: 首次 + 不同 routeId → 201 + 无 staleEdit；首次 + 不存在 routeId → 既有 404；reselect + 不同 routeId → 201 + staleEdit；reselect + 同 routeId 强制重选触发 hook；reselect 时下游 running 409；DELETE /route-selection 不触发 hook
- [x] 6.6 跑 `npx vitest --config vitest.config.server.ts run server/routes/blueprint/stage-edit` → 全绿；既有 `blueprint-routes.test.ts` 不破任一断言（需求 12.4）
- 需求覆盖：10.1–10.7 / 12.4 / 12.5

## 7. 落地前端 API helper 与派生工具

- [x] 7.1 在 `client/src/lib/blueprint-api/intake.ts` 追加 `patchBlueprintIntake(intakeId, body)` helper
- [x] 7.2 在 `client/src/lib/blueprint-api/clarification.ts` 与 `routeset.ts` 既有 helper 内补 `staleEdit` 字段解析（不破坏既有调用方）
- [x] 7.3 创建 `client/src/pages/autopilot/stage-edit/derive-downstream-impact.ts`（如 spec 2 已实现则复用）
- [x] 7.4 创建 `client/src/pages/autopilot/stage-edit/use-inline-edit-flow.ts`：协调 submit + store 更新 + toast；不调 `resetPin()` / 不修改 `workflowStageOverride`；toast 文案两套（有 stale / 无 stale）
- 需求覆盖：7.1 / 7.2 / 7.3 / 7.4 / 7.5 / 7.6 / 7.7

## 8. 落地前端 EditModeField + InlineConfirmation

- [x] 8.1 创建 `client/src/pages/autopilot/stage-edit/EditModeField.tsx`：
  - 状态机 `view → editing → submitting → view/error`
  - 仅在 `isViewingCompletedStage === true && fromStage ∈ {input, clarification, route_generation}` 渲染 edit 图标
  - `data-testid="autopilot-edit-${fieldKey}"`
  - Enter / Esc 键盘交互
  - 静态预览模式整体 disabled（aria-disabled）
- [x] 8.2 创建 `client/src/pages/autopilot/stage-edit/InlineConfirmation.tsx`：
  - inline div（**非 dialog**），紧邻字段；样式 token 与 spec 2 modal 区分
  - 文案：N >= 1 → "保存修改将使 N 个下游内容过期，确认？"；N === 0 → "无下游内容，将直接保存"
  - cancel / Esc 还原 draft；confirm 提交
  - **禁止** import spec 2 任一模块（添加 ESLint rule 或单测断言保护）
- [x] 8.3 创建 `client/src/pages/autopilot/stage-edit/StaleBadge.tsx`：纯展示；`staleSince` 缺失时返回 null；hover tooltip 文案派生自 `invalidatedBy.stage` + `invalidatedBy.triggeredAt`；视觉色 token 与 spec 2 modal 中 stale 列表一致
- [x] 8.4 创建 `client/src/pages/autopilot/stage-edit/RightRailStaleIndicator.tsx`：仅在当前 sub-stage 对应 artifact `staleSince` 非空时渲染；按当前 sub-stage 派生按钮文案
- [x] 8.5 创建 `client/src/pages/autopilot/stage-edit/use-per-stage-regenerate.ts`：按 sub-stage 调对应既有 stage-specific 端点（POST /route-selection / POST /spec-documents / POST /effect-previews）；不调 spec 2 `POST /replan`；按钮 disabled 期间不重复触发
- 需求覆盖：1.1–1.8 / 2.1–2.9 / 5.1–5.6 / 6.1–6.8

## 9. 在 AutopilotRoutePage 与 AutopilotRightRail 接线

- [x] 9.1 在 `client/src/pages/autopilot/AutopilotRoutePage.tsx` 页面 1 渲染区域内（stage ∈ input / clarification / route_generation 分支）：把既有字段控件包到 `EditModeField`：target text、每个 GitHub URL、每个 clarification answer（按 questionId）、当前 route selection
- [x] 9.2 SHALL NOT 在 spec_tree / spec_docs / preview / effect_preview / prompt_packaging / runtime_capability / engineering_handoff / engineering_landing 任一渲染区域挂 EditModeField（需求 1.4）
- [x] 9.3 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 顶部追加 `<RightRailStaleIndicator />` 渲染槽（在 StageHeader 上方、不与"返回当前阶段"按钮抢位）
- [x] 9.4 在每个下游 artifact 视图组件（spec_tree node 视图、spec_documents 卡片、effect_preview 瓷砖）顶部追加 `<StaleBadge staleSince={...} invalidatedBy={...} />`
- 需求覆盖：1.1 / 1.2 / 1.3 / 1.4 / 5.2 / 6.1 / 6.8

## 10. 编写前端组件测试 + 端到端验证

- [x] 10.1 创建 `__tests__/EditModeField.test.tsx`：可见性 4 矩阵（viewing × stage × static-preview × advancing-stage）；Enter / Esc / cancel；4xx/5xx 重启用按钮；409 downstream_running 文案
- [x] 10.2 创建 `__tests__/InlineConfirmation.test.tsx`：N >= 1 / N === 0 两种文案；不渲染 spec 2 testid（DOM query 断言）
- [x] 10.3 创建 `__tests__/StaleBadge.test.tsx`：staleSince 非空渲染、缺失不渲染、tooltip 文案
- [x] 10.4 创建 `__tests__/RightRailStaleIndicator.test.tsx`：stale 渲染、fresh 不渲染、上游 running 按钮 disabled
- [x] 10.5 创建 `__tests__/use-inline-edit-flow.test.tsx`：成功有 stale / 无 stale 两套 toast；不调 resetPin / 不修改 workflowStageOverride
- [x] 10.6 创建 `__tests__/use-per-stage-regenerate.test.tsx`：spy `postBlueprintReplan` 不被调；调正确的 stage-specific 端点
- [x] 10.7 跑客户端 vitest 全量 → 失败 0
- [x] 10.8 跑全量 server vitest → 失败 0；spec 1 / spec 2 测试全绿
- [x] 10.9 跑 `npm run build:pages` → GitHub Pages 模式下 EditModeField 整体 disabled、不抛异常（需求 12.6）
- [x] 10.10 PR 描述勾选"未引入新 socket 通道 / 持久化 / 鉴权 / 限流 / 跨主线改造"checklist（需求 12.5 / 13.x）
- 需求覆盖：10.8 / 12.5 / 12.6 / 12.7 / 13.x

## 任务依赖图

```
1 (contracts) ─→ 2 (hook+guard+locator+noop+logger) ─┬─→ 3 (intake patch route)
                                                       ├─→ 4 (clarification hook)
                                                       └─→ 5 (route reselection hook)
                                                              ↓
                                              6 (backend tests)
                                                              ↓
1 ─→ 7 (frontend api) ─→ 8 (frontend components) ─→ 9 (page wiring) ─→ 10 (tests + e2e)
```

任务 1 是硬依赖；2 是后端共享基础；3/4/5 在 2 后顺序无关；前端 7-9 在共享类型冻结后可与后端并行；10 是最终验证。
