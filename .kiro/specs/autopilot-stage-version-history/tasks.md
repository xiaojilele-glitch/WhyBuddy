# 实施任务：Autopilot Stage Version History

> 本任务列表对应 `requirements.md` 与 `design.md`。**前置依赖**：spec 1 已合并（消费 `staleArtifactIds`）；spec 2 已合并（消费 `parentJobId` / `branchedAt` / `branchedFromStage` / `replan.triggered`）。spec 3 不是硬依赖（spec 4 直接读 staleSince，不通过 spec 3 UI 组件）。
> 完成顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。任务 1（shared contracts）→ 2-4（后端 family endpoint）→ 5-7（前端 UI 组件）→ 8（验证）。

## 1. 在 `shared/blueprint/contracts.ts` 上追加 `BlueprintFamilyResponse` 类型

- [x] 1.1 在文件末尾追加 `BlueprintFamilyResponse` interface（`rootJobId: string` / `jobs: BlueprintGenerationJob[]` / `replanEvents: BlueprintGenerationEvent[]`）；不引入新字段类型，纯组合既有
- [x] 1.2 在 `shared/blueprint/index.ts` re-export
- [x] 1.3 跑 `npx tsc --noEmit` 确认零类型错误
- 需求覆盖：1.3 / 13.3

## 2. 落地 family-builder 纯函数（含环检测）

- [x] 2.1 创建 `server/routes/blueprint/family/family-builder.ts`，导出 `FamilyBuilderResult` union 与 `buildFamilyFromJobStore(allJobs, startJobId)` 纯函数
- [x] 2.2 实现向上找 root 的算法：visited Set + 深度阈值 `MAX_PARENT_CHAIN_DEPTH = 1024`，环检测时返回 `{ kind: "cycle", offendingJobId, chainSummary: "a→b→c→a" }`
- [x] 2.3 实现向下 BFS 扫所有 descendants，按 `parentJobId` 索引（无需依赖前端 Branch_Index）
- [x] 2.4 实现 jobs 排序：root 排首位，其余按 `branchedAt` 升序（缺失时 fallback 到 `createdAt`）
- [x] 2.5 实现 replanEvents 合并：跨所有 family job 的 events 中 `type === "replan.triggered"`，按 `occurredAt` 升序 + jobId tie-breaker
- [x] 2.6 处理 `parentJobId` 指向不存在 job 的边界（视为 cycle，返回错误）
- 需求覆盖：1.3 / 1.4 / 1.5 / 1.6 / 1.7 / 1.8

## 3. 落地 `GET /api/blueprint/jobs/:jobId/family` 端点

- [x] 3.1 创建 `server/routes/blueprint/family/family-logger.ts`：导出 `logFamilyRead` / `logFamilyRejected` / `logFamilyCycle`，事件键固定 `family.*`，与 spec 1/2/3 命名空间互斥
- [x] 3.2 创建 `server/routes/blueprint/family/family-route.ts`，实现 `createFamilyHandler(deps)`：
  - 404 当 jobId 不存在 + `family.rejected` debug 日志
  - 调 `buildFamilyFromJobStore(jobStore.list(), jobId)`
  - cycle → 500 + `family_cycle_detected` + error 日志
  - family > 100 jobs → warn 级 large family 日志
  - 200 + `family.read` info 日志
- [x] 3.3 在 `server/routes/blueprint.ts` 顶部 import `createFamilyHandler`
- [x] 3.4 在 spec 1 / spec 2 既有路由之后追加：
  ```typescript
  router.get(
    "/jobs/:jobId/family",
    createFamilyHandler({ jobStore, ctx: blueprintServiceContext }),
  );
  ```
- 需求覆盖：1.1 / 1.2 / 1.9 / 1.10 / 1.11 / 1.12 / 12.1–12.6

## 4. 编写后端 fast-check 与 example tests

- [x] 4.1 创建 `__fixtures__/build-fixture-family.ts`：导出 `buildFamilyOfOne` / `buildParentPlusOne` / `buildParentPlusN(n)` / `buildDeepTree(depth)` / `buildCyclicFamily`
- [x] 4.2 创建 `__fixtures__/arbitraries.ts`：随机合法 family 生成器（先 root，再随机选已存在 job 作为 parent 创建 branch；保证无环）
- [x] 4.3 创建 `family-endpoint.test.ts`，包含 fast-check property + example 两类：
  - property: family 连接性（≥ 100 iter，需求 11.2 第 1 条）
  - property: family 无环（≥ 100 iter，需求 11.2 第 2 条）
  - property: replanEvents 类型纯净（≥ 100 iter，需求 11.2 第 3 条）
  - property: rootJobId 唯一（≥ 100 iter，需求 11.2 第 4 条）
  - property: 只读性（≥ 100 iter，需求 11.2 第 5 条；连续两次请求 deep equality + jobStore deep snapshot equality）
  - example: family-of-one（含 in_place replan）+ replanEvents 非空
  - example: parent + 1 / 3 / 深度 2
  - example: jobId 不存在 → 404 + `family.rejected` debug 日志
  - example: 构造性 cyclic fixture → 500 + `family_cycle_detected` + error 日志
  - example: spy `jobStore.save` 验证未被调
- [x] 4.4 跑 `npx vitest --config vitest.config.server.ts run server/routes/blueprint/family` → 全绿
- 需求覆盖：11.1–11.5 / 11.7

## 5. 落地前端 API helper 与数据 hook

- [x] 5.1 创建 `client/src/lib/blueprint-api/family.ts`：导出 `getBlueprintFamily(jobId, options?)` + `BlueprintFamilyError` class
- [x] 5.2 在 `client/src/lib/blueprint-api/index.ts` re-export
- [x] 5.3 创建 `client/src/pages/autopilot/version-history/use-family-data.ts`：状态机 idle / loading / ok / error；静态预览模式下直接返回 `{ kind: "error", message: "static_preview_unsupported" }`
- [x] 5.4 创建 `client/src/pages/autopilot/version-history/derive-tree-layout.ts`：`deriveTreeLayout(jobs)` 派生 `TreeNode[]`（depth 用 BFS 计算；同 parent 下 children 按 branchedAt 升序）
- [x] 5.5 创建 `client/src/pages/autopilot/version-history/use-switch-active-job.ts`：跨 family 校验 + setActiveJobId + URL 更新（`?activeJob=<jobId>`）+ rightRailRetry；不调 spec 2/3 端点；不修改 backend job stage；若 spec 5 Coordination_Layer 已落地，则通过 `coordinator.submit({ triggerSource: "switch_active", ... })` 原子提交这些前端写入
- 需求覆盖：1.x / 2.1–2.8 / 13.7

## 6. 落地前端 UI 组件

- [x] 6.1 创建 `client/src/pages/autopilot/version-history/TreeNode.tsx`：单 job 行；`depth * 24px` 缩进 + `border-left` 表树枝；展示 jobId 短标识 / stage 中文名 / status / active 标记 / stale 标记 / branchedFromStage / branchedAt（仅 branch）；可点击 + 键盘激活；hover tooltip 完整信息
- [x] 6.2 创建 `client/src/pages/autopilot/version-history/VersionTreeView.tsx`：消费 `useFamilyData` + `deriveTreeLayout`；loading / error / static-preview 三种降级态；`onSwitchActive` 回调用 `useSwitchActiveJob`
- [x] 6.3 创建 `client/src/pages/autopilot/version-history/CompareView.tsx`：双窗格只读视图；`PRIMARY_ARTIFACT_TYPE_BY_STAGE` 映射（input → intake / route_generation → route_selection / spec_docs → design / 等）；每格展示存在/缺失/stale/timestamp；不实现 payload 内容级 diff；跨 family 拒绝渲染并显示提示
- [x] 6.4 创建 `client/src/pages/autopilot/version-history/ReplanTimelineView.tsx`：消费 `replanEvents`；防御性过滤 `type === "replan.triggered"`；按 occurredAt 降序 + jobId tie-breaker；条目展示 时间 / mode 中文化 / jobId 短标识 / parentJobId（branch only）/ fromStage / count / reason 截断到 200；reason 用 React 默认文本渲染（XSS 防护）；空数组空态文案
- [x] 6.5 创建 `client/src/pages/autopilot/version-history/HistoryEntryPoint.tsx`：右栏顶部按钮；`data-testid="autopilot-history-entry"`；点击 navigate `?history=1`；静态预览 disabled + tooltip；不响应 socket / replan 成功事件；与 spec 2 ReplanButton / spec 3 edit 图标位置互斥（DOM 不同 container）
- 需求覆盖：3.1–3.9 / 4.1–4.9 / 5.1–5.8 / 6.1–6.6 / 9.x

## 7. 编写前端组件测试

- [x] 7.1 创建 `__tests__/VersionTreeView.test.tsx`：family-of-1 / parent+1 / parent+3 / 深度 2 各渲染一次；loading / error / static-preview 三态；`onSwitchActive` 触发
- [x] 7.2 创建 `__tests__/TreeNode.test.tsx`：active 标记、stale 标记、branchedFromStage 文案、点击 + Enter + Space 触发
- [x] 7.3 创建 `__tests__/CompareView.test.tsx`：跨 family 拒绝；stage 顺序；artifact 缺失展示 "—"；stale 标记；零 mutation 控件
- [x] 7.4 创建 `__tests__/ReplanTimelineView.test.tsx`：降序、空态文案、reason 截断、不渲染 HTML（`<script>` 转义）
- [x] 7.5 创建 `__tests__/HistoryEntryPoint.test.tsx`：静态预览 disabled、点击 navigate、socket / replan 不自动打开、与 ReplanButton DOM 互斥
- [x] 7.6 创建 `__tests__/use-family-data.test.ts`：四态 + cancel 卸载
- [x] 7.7 创建 `__tests__/use-switch-active-job.test.ts`：跨 family 拒绝 + toast.error；同 family setActiveJobId + URL 更新；spec 5 存在时走 coordinator submit；不调 spec 2/3 端点；不修改 backend job stage
- [x] 7.8 跑客户端 vitest 全量 → 失败 0
- 需求覆盖：11.6 / 11.7 / 11.8

## 8. 验证向后兼容性与端到端串通

- [x] 8.1 跑全量 server vitest → 失败 0；spec 1/2/3 测试全绿（需求 13.6）
- [x] 8.2 跑 `npm run build:pages` → GitHub Pages 模式下 VersionTreeView 降级单节点视图、不抛异常（需求 13.7）
- [x] 8.3 手测：在 dev:all 模式下，先用 spec 2 的 replan branch 创建 2 条 branch，然后打开 history 视图确认 family 渲染、Switch_Active 切换工作、Compare_View 选两个 job 渲染对比、ReplanTimelineView 显示 3 条 replan 事件
- [x] 8.4 验证 `MissionAutopilotSummary` / `mission-projection` 投影形态完全不变（diff check 既有 contracts，需求 13.4）
- [x] 8.5 PR 描述勾选"零 backend mutation / 不引入 socket 通道 / 不引入 BlueprintEventName 家族 / 不复用 spec 2/3 组件"checklist（需求 14.x）
- 需求覆盖：13.1–13.9 / 14.1–14.11

## 任务依赖图

```
1 (contracts) ─→ 2 (family-builder) ─→ 3 (route+logger+register) ─→ 4 (backend tests)
                                                                       ↓
1 ─→ 5 (frontend api+hooks) ─→ 6 (UI components) ─→ 7 (frontend tests) ─→ 8 (compat + e2e)
```

任务 1 是硬依赖；2-4 后端独立链；5-7 前端独立链（5 在 1 后即可启动）；8 是最终验证。
