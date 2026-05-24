# 实施任务：Autopilot Stage State Coordination

> 本任务列表对应 `requirements.md` 与 `design.md`。**前置依赖**：spec 1 / 2 / 3 / 4 已合并；spec 5 是系列的协调收尾，把前 4 份的多 store 写入聚合到统一前端协调层。
> spec 5 完全在前端落地，零后端改动、零 shared contracts 改动、零新端点。
> 完成顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。任务 1-5 是 5 个协调子模块的独立落地；任务 6 是 coordinator 入口；任务 7 是 spec 2/3/4 的迁移接线；任务 8 是测试；任务 9 是端到端验证。

## 1. 落地 reduced-motion 探测与 page mapping

- [x] 1.1 创建 `client/src/lib/autopilot-coordination/reduced-motion.ts`：实现 `prefersReducedMotion()` 同步探测函数（`window.matchMedia("(prefers-reduced-motion: reduce)").matches`）；SSR 安全（typeof window === "undefined" 返回 false）
- [x] 1.2 创建 `client/src/lib/autopilot-coordination/page-mapping.ts`：导出 `STAGE_TO_PAGE` 常量（input/clarification/route_generation → 1；spec_tree/spec_docs → 2；preview/effect_preview/prompt_packaging/runtime_capability/engineering_handoff/engineering_landing → 3），并导出 `getStagePage(stage)` / `isSameAutopilotPage(a,b)`；明确该映射用于 UI 页面级回退，不用于 stale 依赖图
- 需求覆盖：1.4 / 4.1

## 2. 落地 AtomicRefreshMediator

- [x] 2.1 创建 `client/src/lib/autopilot-coordination/AtomicRefreshMediator.ts`，实现 `useAtomicRefreshMediator()` hook
- [x] 2.2 内部用 `flushSync` 包裹 `apply()` callback；try/catch 捕获异常 → 输出 `console.error coordination.batch_rolled_back`（含 triggerSource / failedStore / errorMessage 截断到 200）
- [x] 2.3 返回 `{ flush: (apply, options) => MediatorFlushResult }`
- 需求覆盖：2.1–2.7 / 9.2

## 3. 落地 StageTransitionAnimator

- [x] 3.1 创建 `client/src/lib/autopilot-coordination/StageTransitionAnimator.ts`，实现 `useStageTransitionAnimator()` hook
- [x] 3.2 维护 `state: { inFlight, direction, prevStage, nextStage }`；`transition(prev, next)` 同 stage 不触发；prefers-reduced-motion 立即结束；中止 in-flight 时 `console.debug coordination.animation_aborted`
- [x] 3.3 派生 direction：`advance`（next index > prev index）/ `retreat`（< 反向）/ `fade`（异常）
- [x] 3.4 `TRANSITION_DURATION_MS = 300`，`setTimeout` 后 `inFlight = false`
- 需求覆盖：1.1–1.8 / 9.3

## 4. 落地 PageTransitionChoreographer

- [x] 4.1 创建 `client/src/lib/autopilot-coordination/PageTransitionChoreographer.ts`，实现 `usePageTransitionChoreographer()` hook
- [x] 4.2 维护 `state: { inFlight, direction, prevPage, nextPage }`；`transition(prev, next)` 同页面不触发；prefers-reduced-motion 立即结束
- [x] 4.3 direction：`forward`（next > prev）/ `backward`（< 反向）
- [x] 4.4 `PAGE_TRANSITION_DURATION_MS = 300`
- 需求覆盖：4.1–4.7

## 5. 落地 ToastQueue

- [x] 5.1 创建 `client/src/lib/autopilot-coordination/ToastQueue.ts`，实现 `useToastQueue()` hook
- [x] 5.2 状态：`queue: QueuedToast[]` + `visible: QueuedToast | null`；同 key 合并（替换 visible / 队列中元素）；`MAX_VISIBLE_TOASTS = 1`
- [x] 5.3 优先级 `error > warn > info`；error 抢占（visible 是非 error 时立即切换）
- [x] 5.4 `dismiss()` 立即从队列取下一条
- [x] 5.5 与既有 `sonner` toast 集成：`visible` 变化时调 `sonner.toast.[level]`；新 toast 来时 `sonner.dismiss(prevToastId)`
- [x] 5.6 `prefers-reduced-motion` 不影响入队 / 合并 / 优先级；底层 sonner 默认动画在该模式下也短/无
  - worker E note: 已用 `ToastQueue.test.ts` 证明入队 / 合并 / 优先级不受 reduced motion 影响，并补 sonner renderer API 路由测试；底层 sonner DOM 动画在当前 node-only focused tests 中不可验证，因此本项暂不勾。
- 需求覆盖：3.1–3.8

## 6. 落地 ThreeLayerConsistencyChecker 与 AutopilotCoordinator 入口

- [x] 6.1 创建 `client/src/lib/autopilot-coordination/ThreeLayerConsistencyChecker.ts`，实现 `useThreeLayerConsistencyChecker()` hook：
  - 读取 urlPin / workflowStageOverride / activeJob.stage 三层
  - `if (!activeJob) return ok`
  - 使用 `STAGE_TO_PAGE` 判断合法 Review_Override_State：backend 在页面 3 时 pin/override 到页面 2 或页面 1 合法；backend 在页面 2 时 pin/override 到页面 1 合法；spec_tree/spec_docs 同页合法
  - 合法 Review_Override_State 不输出 warn、不 resetPin、不 setOverride
  - 非法状态才 `console.warn coordination.three_layer_mismatch` + 修正前两层（未知 urlPin → resetPin；非法 override → setOverride(activeJob.stage)）
  - elapsedMs > 100ms 视为修正失败 → 返回 ok=false
  - 不修改 backend job stage
- [x] 6.2 创建 `client/src/lib/autopilot-coordination/AutopilotCoordinator.ts`，实现 `useAutopilotCoordination()` hook：
  - 入参 `CoordinationSubmission`（triggerSource / apply / toastPayload? / stageTransition? / pageTransition?）
  - 流程：mediator.flush → choreographer.transition（如跨页面）→ animator.transition（如同页面跨 stage）→ toast.enqueue → checker.checkAndCorrect
  - 失败时入队 error toast 并返回 `{ ok: false, failureReason }`
- [x] 6.3 创建 `client/src/lib/autopilot-coordination/index.ts` barrel
- 需求覆盖：5.1–5.6 / 6.1 / 6.2 / 6.3 / 6.4 / 6.6 / 9.1 / 9.4 / 9.5 / 9.6

## 7. 迁移 spec 2 / 3 / 4 调用点到 coordinator

- [x] 7.1 改造 spec 2 `client/src/pages/autopilot/right-rail/replan/use-replan-flow.ts`：把直接 `toast.success` + `rightRailRetry` + `switchActiveJob` + `branchIndex.append` 路径包到 `coordinator.submit({ triggerSource: "replan", apply, toastPayload, stageTransition, pageTransition })`
- [x] 7.2 改造 spec 3 `client/src/pages/autopilot/stage-edit/use-inline-edit-flow.ts`：把直接 toast + rightRailRetry 包到 `coordinator.submit({ triggerSource: "inline_edit", apply, toastPayload })`；inline edit 不引发 page / stage transition，省略两个字段
- [x] 7.3 改造 spec 4 `client/src/pages/autopilot/version-history/use-switch-active-job.ts`：把直接 setActiveJobId + URL 更新 + rightRailRetry 包到 `coordinator.submit({ triggerSource: "switch_active", apply, stageTransition, pageTransition })`
- [x] 7.4 在 `client/src/pages/autopilot/AutopilotRoutePage.tsx` 外层壳追加 `<PageTransitionWrapper state={pageTransitionState}>`，根据 state.direction 派生 Framer Motion props
- [x] 7.5 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 既有 `StageTransitionWrapper` 处把 spec 5 animator state 接入 direction prop（不替换 wrapper，只更新 direction）
- [x] 7.6 验证 spec 2 / 3 / 4 既有测试不破任一断言（迁移仅是包装层，spec 2/3/4 的 store 写入语义不变）
- 需求覆盖：6.1 / 6.2 / 6.3 / 6.4 / 6.5 / 6.7 / 7.1–7.6

## 8. 编写测试

- [x] 8.1 创建 `__fixtures__/mock-store.ts`：`createMockJobStore` / `createMockPinStore` / `createMockWorkflowStore`
- [x] 8.2 创建 `__fixtures__/mock-trigger.ts`：构造测试用 `CoordinationSubmission`
- [x] 8.3 创建 `AtomicRefreshMediator.test.ts`：
  - property: 批次写入原子性（≥ 100 iter；fast-check 生成 N ∈ [1,10] 个 setState；验证 React commit 计数为 1，需求 8.2）
  - example: 三类 trigger 成功路径；apply 抛错 → flushResult.ok = false + console.error 被调
- [x] 8.4 创建 `ToastQueue.test.ts`：合并、优先级抢占、dismiss 后自动切下一条、reduced-motion 不影响逻辑
- [x] 8.5 创建 `StageTransitionAnimator.test.tsx`：同 stage 不触发；跨 stage advance/retreat 方向；prefers-reduced-motion 立即结束；连续触发中止 + console.debug
- [x] 8.6 创建 `PageTransitionChoreographer.test.tsx`：同页面不触发；跨页面 forward/backward 方向
- [x] 8.7 创建 `ThreeLayerConsistencyChecker.test.ts`：一致 ok / 合法回看态不修正 / spec_tree 与 spec_docs 同页不修正 / 非法 pin 或 override 触发修正 / idempotent / 不修改 backend job stage
- [x] 8.8 创建 `AutopilotCoordinator.integration.test.tsx`，5 个端到端场景（需求 8.4）：
  - (a) replan in_place 成功：toast / stage 动画 / staleArtifactIds 同帧刷新
  - (b) replan branch 成功：Active_Job 切换 + 页面级过渡
  - (c) inline edit 成功后 toast key 与 spec 2 toast 不冲突（合并语义验证）
  - (d) Switch_Active 跨页面切换触发 PageTransitionChoreographer
  - (e) Animation_Reduced_Mode 下所有动画取消、store 一致性保持
- [x] 8.9 跑客户端 vitest 全量 → 失败 0
- 需求覆盖：8.1–8.6

## 9. 端到端验证 + 系列收尾

- [x] 9.1 跑全量 server vitest → 失败 0；spec 1/2/3/4 测试全绿（需求 10.6）
- [x] 9.2 跑 `npm run build:pages` → GitHub Pages 静态预览模式下 Coordination_Layer 仍正常加载（与 backend 无关，需求 10.7）
- [x] 9.3 手测 dev:all 模式：
  - replan in_place / branch 各跑一次，确认动画 / toast / 三层一致性自检全部正常
  - inline edit 成功，确认 toast 不与 replan toast 重叠
  - 在 system 设置开 prefers-reduced-motion，重新跑全部场景，确认动画全部取消但语义保持
  - 故意让 store 抛错（mock）验证 batch 回滚 + error toast
  - Codex verification note 2026-05-24: local dev server on 3000/3001 plus Chrome CDP was exercised against the live job family. Verified runtime_capability -> spec_tree -> input page-level back chain, History 3 count, ready version-history panel with 3 family jobs, history close restoring latest runtime job, reduced-motion path from earlier browser pass, and coordinator rollback/error-toast coverage through focused tests.
- [x] 9.4 验证未引入 service worker / BroadcastChannel / 撤销栈 / 自定义动画偏好 UI（需求 11.5）
- [x] 9.5 PR 描述勾选"零后端改动 / 零 shared contracts 改动 / 零新端点 / 零新 BlueprintEventName / 零新 socket 通道 / 不写 backend job.stage"checklist（需求 10.x / 11.x）
- [x] 9.6 在 `.kiro/steering/` 下追加一条系列收尾记录：5-spec 系列 (autopilot-asset-staleness-model + autopilot-replan-and-branch-action + autopilot-stage-edit-mode + autopilot-stage-version-history + autopilot-stage-state-coordination) 落地完成；后续若需扩展 SHALL 以新系列 spec 推进，SHALL NOT 反向修改本系列任一 spec 的需求
- 需求覆盖：10.1–10.9 / 11.1–11.11

## 任务依赖图

```
1 (reduced-motion + page-mapping) ─┬─→ 2 (AtomicRefreshMediator)
                                     ├─→ 3 (StageTransitionAnimator)
                                     ├─→ 4 (PageTransitionChoreographer)
                                     └─→ 5 (ToastQueue)
                                          ↓
                                     6 (Checker + Coordinator)
                                          ↓
                                     7 (spec 2/3/4 迁移)
                                          ↓
                                     8 (tests)
                                          ↓
                                     9 (e2e + 系列收尾)
```

任务 1 是基础工具；2-5 是 4 个独立子模块（可并行）；6 把它们组装到统一入口；7 是迁移接线；8 是测试；9 是最终验证 + 系列收尾。
