# 设计文档：Autopilot Stage State Coordination

## 概览

本设计落地 spec 5 的全部需求：把前四份 spec 落地后所有"切换 / 刷新 / 跳变"动作的视觉表现与时序约束在前端统一收口。spec 5 是系列的"收尾 spec"——只做协调层（动画、原子刷新、toast 队列、三层一致性自检），不动数据流、不动后端、不引入新数据模型、不引入新事件家族、不新增 HTTP 端点。

设计的三个不变量：

1. **零后端改动**：服务端零改动；spec 5 完全在前端落地，所有副作用都是浏览器侧 React 渲染 + DOM 动画 + console 日志。
2. **包装而非替代**：Coordination_Layer 是 wrapper / facade，不替代 spec 2 / 3 / 4 已有的 store / 端点；既有 spec 在直接调用 store 写入路径时仍然可工作（兼容性保护，需求 6.5）。
3. **被动触发**：协调器只在 spec 2 / 3 / 4 通过 `useAutopilotCoordination()` 入口主动注册 Refresh_Trigger 时工作；它**不**轮询、不订阅 socket、不监听 store mutation 自动检测。三层一致性自检也只在 Refresh_Trigger 完成后做一次（需求 5.5）。

## 架构

### 模块边界与文件布局

```
client/src/lib/autopilot-coordination/
  index.ts                                       ← 对外 barrel：useAutopilotCoordination + 4 子模块
  AutopilotCoordinator.ts                        ← 单例 service / hook 入口
  StageTransitionAnimator.ts                     ← 子模块 1：stage 切换视觉过渡
  AtomicRefreshMediator.ts                       ← 子模块 2：多 store 写入聚合
  ToastQueue.ts                                  ← 子模块 3：toast 队列协调
  PageTransitionChoreographer.ts                 ← 子模块 4：页面级过渡
  ThreeLayerConsistencyChecker.ts                ← 三层一致性自检
  reduced-motion.ts                              ← prefers-reduced-motion 探测
  page-mapping.ts                                ← stage → page (1/2/3) 映射
  __tests__/
    __fixtures__/
      mock-store.ts                              ← React 测试用 mock store
      mock-trigger.ts                            ← Refresh_Trigger 构造器
    AutopilotCoordinator.integration.test.tsx    ← 端到端集成测试
    StageTransitionAnimator.test.tsx
    AtomicRefreshMediator.test.ts                ← property + example
    ToastQueue.test.ts
    PageTransitionChoreographer.test.tsx
    ThreeLayerConsistencyChecker.test.ts
client/src/pages/autopilot/
  AutopilotRoutePage.tsx                         ← 顶部包一层 PageTransitionChoreographer
  right-rail/AutopilotRightRail.tsx              ← stage 切换包一层 StageTransitionAnimator
client/src/pages/autopilot/replan/               ← spec 2 已有；spec 5 改造调用 useAutopilotCoordination
  ReplanConfirmationModal.tsx                    ← 在 onConfirm 成功路径上调 coordinator.submit("replan", ...)
client/src/pages/autopilot/stage-edit/           ← spec 3 已有；spec 5 改造调用 useAutopilotCoordination
  use-inline-edit-flow.ts                        ← 改走 coordinator
client/src/pages/autopilot/version-history/      ← spec 4 已有；spec 5 改造调用 useAutopilotCoordination
  use-switch-active-job.ts                       ← 改走 coordinator
```

### 与现有依赖的接线

- **依赖**：spec 2 的 `useAutopilotJobStore`（`activeJobId` / `branchIndex`）、spec 2/3/4 的 store hook、spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`（用于 page-mapping）、既有 toast（`sonner`）、既有 Framer Motion / CSS transition（已被既有 StageTransitionWrapper 使用）。
- **不依赖**：后端任何路由、socket / event bus、LLM client、executor client。
- **零修改**：spec 1 / 2 / 3 / 4 的服务端代码、shared contracts、既有路由全部不动。前端 spec 2 / 3 / 4 的核心 store 与组件不重构，只在调用方式上从"直接写 store + 直接 toast"改为"调 `coordinator.submit()`"。

### Refresh_Trigger 触发与协调流程

```
spec 2 ReplanConfirmationModal: onConfirm 成功
   │
   ├─ const result = await postBlueprintReplan(...)
   ▼
coordinator.submit({
  triggerSource: "replan",
  mode: result.mode,
  apply: () => {
    // 将所有 store 写入打包到这个回调中
    rightRailRetry();
    if (result.mode === "branch") {
      switchActiveJob(result.job.id);
      branchIndex.append(result.parentJobId, result.job.id);
    }
  },
  toastPayload: {
    level: "info",
    key: `replan.${result.mode}.${result.job.id}`,
    message: result.mode === "in_place"
      ? `已从 ${stageZh(fromStage)} 起标记 ${count} 个下游内容为过期`
      : `已创建新分支，从 ${stageZh(fromStage)} 起独立重新规划`,
  },
  pageTransition: {
    fromStage: prevActiveStage,
    toStage: fromStage,
  },
})
   │
   ├─ AtomicRefreshMediator.flush(apply):
   │     ├─ React batch（flushSync 或 startTransition）
   │     ├─ 同帧写完所有 store
   │     ├─ 失败 → 回滚 + console.error coordination.batch_rolled_back
   │     └─ 成功 → 继续
   │
   ├─ StageTransitionAnimator.transition(prevStage, newStage):
   │     ├─ 若 prefers-reduced-motion → 立即切，无动画
   │     ├─ 若同 stage → 跳过
   │     ├─ 若跨页面 → 让 PageTransitionChoreographer 接管，本动画延后
   │     ├─ 若同页面跨 stage → 触发 Framer Motion 过渡 (≤ 300ms)
   │     └─ in-flight 时第二次触发 → abort + 重新启动
   │
   ├─ PageTransitionChoreographer.transition(fromPage, toPage):
   │     ├─ 若同页面 → 跳过
   │     ├─ 若跨页面 → fade / slide ≤ 300ms
   │     └─ in-flight 时第二次触发 → abort + 重新启动
   │
   ├─ ToastQueue.enqueue(toastPayload):
   │     ├─ 与队列中已有同 key 的 toast 合并
   │     ├─ error 优先级抢占；info 排队
   │     ├─ 同时显示数 ≤ 1（或 design 阶段调整为 2）
   │     └─ 用户 dismiss → 立即展示下一条
   │
   ├─ ThreeLayerConsistencyChecker.check():
   │     ├─ urlPin / workflowStageOverride / activeJobStage 三方比对
   │     ├─ 合法回看上游页面 → 视为 compatible，不修正
   │     ├─ 非法 pin/override → console.warn + 仅修正前端不可展示状态
   │     └─ 100ms 内未对齐 → ToastQueue.enqueue({ level: "error", message: "前端状态同步失败，请刷新页面" })
   │
   ▼
coordinator.submit() resolve
```

### 非功能性约束

- **性能**：协调流程总开销 < 1 帧（约 16ms）store 写入 + ≤ 300ms 视觉过渡 + 同步执行 toast 入队与一致性自检。
- **可观测性**：三条 console 日志事件键 `coordination.three_layer_mismatch` / `coordination.batch_rolled_back` / `coordination.animation_aborted`，与服务端日志命名空间无重叠（前端 console-only）。
- **GitHub Pages 静态预览**：协调器与后端无关，静态预览模式下仍正常工作；`ThreeLayerConsistencyChecker` 不抛异常。

## 组件设计

### C1. AutopilotCoordinator（`AutopilotCoordinator.ts`）

#### C1.1 公共入口

```typescript
export type CoordinationTriggerSource = "replan" | "inline_edit" | "switch_active" | "manual";

export type ToastLevel = "info" | "warn" | "error";

export interface CoordinationToastPayload {
  level: ToastLevel;
  /** 用于队列中合并相同语义的 toast。 */
  key: string;
  message: string;
}

export interface CoordinationSubmission {
  triggerSource: CoordinationTriggerSource;
  /** 执行 store 写入的 callback；将被 AtomicRefreshMediator 包装在 React batch 中。 */
  apply: () => void;
  /** 完成后展示的 toast；可省略（例如 background 类的协调）。 */
  toastPayload?: CoordinationToastPayload;
  /** stage 切换信息；省略则不触发动画。 */
  stageTransition?: {
    prevStage: BlueprintGenerationStage;
    nextStage: BlueprintGenerationStage;
  };
  /** 期望切换到的 page（1/2/3）；省略则由 stage 自动派生。 */
  pageTransition?: {
    prevPage: 1 | 2 | 3;
    nextPage: 1 | 2 | 3;
  };
}

export interface CoordinationResult {
  /** 协调链路是否完整成功（含 store 写入 + 动画启动）。 */
  ok: boolean;
  /** 失败时的原因；ok=true 时为 undefined。 */
  failureReason?: "store_write_failed" | "animation_aborted" | "three_layer_mismatch_failed";
}

export function useAutopilotCoordination() {
  const animator = useStageTransitionAnimator();
  const mediator = useAtomicRefreshMediator();
  const choreographer = usePageTransitionChoreographer();
  const toastQueue = useToastQueue();
  const checker = useThreeLayerConsistencyChecker();

  const submit = useCallback(
    async (input: CoordinationSubmission): Promise<CoordinationResult> => {
      // 1. 原子写入 store
      const flushResult = mediator.flush(input.apply, { triggerSource: input.triggerSource });
      if (!flushResult.ok) {
        toastQueue.enqueue({
          level: "error",
          key: `coordination.batch_failed.${input.triggerSource}`,
          message: "前端状态同步失败，请刷新页面",
        });
        return { ok: false, failureReason: "store_write_failed" };
      }

      // 2. 启动页面级过渡（如有）
      if (input.pageTransition && input.pageTransition.prevPage !== input.pageTransition.nextPage) {
        choreographer.transition(input.pageTransition.prevPage, input.pageTransition.nextPage);
      }

      // 3. 启动 stage 过渡（如同页面跨 stage）
      if (
        input.stageTransition
        && input.stageTransition.prevStage !== input.stageTransition.nextStage
        && (!input.pageTransition || input.pageTransition.prevPage === input.pageTransition.nextPage)
      ) {
        animator.transition(input.stageTransition.prevStage, input.stageTransition.nextStage);
      }

      // 4. toast 入队（同步）
      if (input.toastPayload) toastQueue.enqueue(input.toastPayload);

      // 5. 三层一致性自检（同步）
      const checkResult = checker.checkAndCorrect();
      if (!checkResult.ok && checkResult.elapsedMs > 100) {
        toastQueue.enqueue({
          level: "error",
          key: `coordination.three_layer.${input.triggerSource}`,
          message: "前端状态同步失败，请刷新页面",
        });
        return { ok: false, failureReason: "three_layer_mismatch_failed" };
      }

      return { ok: true };
    },
    [animator, mediator, choreographer, toastQueue, checker],
  );

  return { submit };
}
```

#### C1.2 兼容性保护（需求 6.5）

如果 spec 2 / 3 / 4 的某个调用点尚未迁移到 coordinator，本 hook 不提供"反向劫持" mechanism——既有直接 store 写入路径完全保持兼容。spec 2/3/4 落地时各自的 design 已经把 coordinator 接入点位标记为 `TODO(spec-5-wiring)`，迁移时只是把直接 store 写入包到 `coordinator.submit({ apply: ... })` 中，不需要先实现 spec 5 全部子模块。

### C2. AtomicRefreshMediator（`AtomicRefreshMediator.ts`）

```typescript
import { flushSync } from "react-dom";

export interface MediatorFlushOptions {
  triggerSource: CoordinationTriggerSource;
}

export interface MediatorFlushResult {
  ok: boolean;
  error?: { failedStore: string; errorMessage: string };
}

export function useAtomicRefreshMediator() {
  const flush = useCallback(
    (apply: () => void, options: MediatorFlushOptions): MediatorFlushResult => {
      try {
        flushSync(() => {
          apply();
        });
        return { ok: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("[autopilot-coordination] coordination.batch_rolled_back", {
          event: "coordination.batch_rolled_back",
          triggerSource: options.triggerSource,
          failedStore: "(unknown)",   // apply callback 里没法直接知道是哪个 store；调用方可在 apply 里 try/catch 并 throw 带 store 名的 error
          errorMessage: errorMessage.slice(0, 200),
        });
        return {
          ok: false,
          error: { failedStore: "(unknown)", errorMessage },
        };
      }
    },
    [],
  );
  return { flush };
}
```

#### C2.1 关键决策

- 用 `flushSync` 而非 `startTransition`：spec 5 §2.2 要求 1 帧内完成，`flushSync` 把所有 setState 同步刷成 1 次 commit；`startTransition` 是 deferred，不符合"立即可见"语义。
- `flushSync` 抛错时整个 batch 回滚——因为 React 的 setState 在 throw 之前已经收集，但 commit 在 callback 完成后才一次性 apply；catch 时 setState 集合被丢弃，无 partial commit。
- `apply` callback 内部如果调用了多个 store 的 `set`，它们都属于同一 batch；React 的 commit 是原子的。

#### C2.2 与需求的对应

- 需求 2.1 / 2.2：`flushSync` 把 N 次 setState 收敛到 1 次 React commit。
- 需求 2.3：依赖 store 派生通过 React 的 deps 链路在同 batch 内完成（既有 store / hook 已实现 deps）。
- 需求 2.4：本 hook 不修改 store 字段语义；只是 wrapper。
- 需求 2.5：try/catch + flushSync 的天然回滚。
- 需求 2.6：本 hook 不订阅 socket。
- 需求 2.7：本 hook 不调任何 backend mutation。

### C3. StageTransitionAnimator（`StageTransitionAnimator.ts`）

```typescript
import { useState, useCallback } from "react";
import { prefersReducedMotion } from "./reduced-motion";

export type StageTransitionDirection = "advance" | "retreat" | "fade";

export interface StageTransitionState {
  inFlight: boolean;
  direction: StageTransitionDirection | null;
  prevStage: BlueprintGenerationStage | null;
  nextStage: BlueprintGenerationStage | null;
}

const TRANSITION_DURATION_MS = 300;

export function useStageTransitionAnimator() {
  const [state, setState] = useState<StageTransitionState>({
    inFlight: false,
    direction: null,
    prevStage: null,
    nextStage: null,
  });
  const abortRef = useRef<{ timer: number; prev: BlueprintGenerationStage; next: BlueprintGenerationStage } | null>(null);

  const transition = useCallback((prevStage: BlueprintGenerationStage, nextStage: BlueprintGenerationStage) => {
    if (prevStage === nextStage) return;  // 同 stage 不触发

    if (prefersReducedMotion()) {
      // 立即切到 next（无动画）
      setState({ inFlight: false, direction: null, prevStage, nextStage });
      return;
    }

    // 中止当前 in-flight（如有）
    if (abortRef.current) {
      window.clearTimeout(abortRef.current.timer);
      console.debug("[autopilot-coordination] coordination.animation_aborted", {
        event: "coordination.animation_aborted",
        previousTrigger: `${abortRef.current.prev}→${abortRef.current.next}`,
        newTrigger: `${prevStage}→${nextStage}`,
        elapsedMs: 0,  // 实际经过时间，由实现层用 performance.now 计算
      });
    }

    const direction = getDirection(prevStage, nextStage);
    setState({ inFlight: true, direction, prevStage, nextStage });

    const timer = window.setTimeout(() => {
      setState((s) => (s.inFlight ? { ...s, inFlight: false, direction: null } : s));
      abortRef.current = null;
    }, TRANSITION_DURATION_MS);
    abortRef.current = { timer, prev: prevStage, next: nextStage };
  }, []);

  return { state, transition };
}

function getDirection(prev: BlueprintGenerationStage, next: BlueprintGenerationStage): StageTransitionDirection {
  const prevIdx = STAGE_ORDER.indexOf(prev);
  const nextIdx = STAGE_ORDER.indexOf(next);
  if (prevIdx < 0 || nextIdx < 0) return "fade";
  if (nextIdx > prevIdx) return "advance";
  if (nextIdx < prevIdx) return "retreat";
  return "fade";
}
```

#### C3.1 视觉接入

`AutopilotRightRail.tsx` 在既有 `StageTransitionWrapper` 外再包一层（或直接消费 `state` 决定 Framer Motion 的 `initial / animate / exit` props）。本设计选择**不替换** `StageTransitionWrapper`：spec 4 / 既有 spec 已使用它，spec 5 只在 `state.direction` 上派生 Motion props，让 Wrapper 接收新 direction。

### C4. PageTransitionChoreographer（`PageTransitionChoreographer.ts`）

```typescript
import { STAGE_TO_PAGE } from "./page-mapping";

const PAGE_TRANSITION_DURATION_MS = 300;

export type PageTransitionDirection = "forward" | "backward" | "fade";

export function usePageTransitionChoreographer() {
  const [state, setState] = useState({
    inFlight: false,
    direction: null as PageTransitionDirection | null,
    prevPage: null as 1 | 2 | 3 | null,
    nextPage: null as 1 | 2 | 3 | null,
  });
  const abortRef = useRef<number | null>(null);

  const transition = useCallback((prevPage: 1 | 2 | 3, nextPage: 1 | 2 | 3) => {
    if (prevPage === nextPage) return;
    if (prefersReducedMotion()) {
      setState({ inFlight: false, direction: null, prevPage, nextPage });
      return;
    }
    if (abortRef.current) window.clearTimeout(abortRef.current);

    const direction: PageTransitionDirection = nextPage > prevPage ? "forward" : "backward";
    setState({ inFlight: true, direction, prevPage, nextPage });

    abortRef.current = window.setTimeout(() => {
      setState((s) => (s.inFlight ? { ...s, inFlight: false, direction: null } : s));
      abortRef.current = null;
    }, PAGE_TRANSITION_DURATION_MS);
  }, []);

  return { state, transition };
}
```

#### C4.1 page-mapping（`page-mapping.ts`）

```typescript
export const STAGE_TO_PAGE: Record<BlueprintGenerationStage, 1 | 2 | 3> = {
  input: 1,
  clarification: 1,
  route_generation: 1,
  spec_tree: 2,
  spec_docs: 2,
  preview: 3,
  effect_preview: 3,
  prompt_packaging: 3,
  runtime_capability: 3,
  engineering_handoff: 3,
  engineering_landing: 3,
};
```

边界由 design 阶段对齐既有外层壳分页（与 spec 3 §术语 "Upstream Stage" 划分一致：input / clarification / route_generation 是页面 1）。

注意：`STAGE_TO_PAGE` 是产品页面级映射，不是 spec 1 的 artifact 依赖图。`spec_tree` 和 `spec_docs` 在依赖图中可以有先后关系，但在用户视口中同属页面 2；ThreeLayerConsistencyChecker 与 PageTransitionChoreographer 都必须以 `STAGE_TO_PAGE` 判断页面级回退。

### C5. ToastQueue（`ToastQueue.ts`）

```typescript
const MAX_VISIBLE_TOASTS = 1;
const PRIORITY: Record<ToastLevel, number> = { error: 3, warn: 2, info: 1 };

interface QueuedToast {
  payload: CoordinationToastPayload;
  enqueuedAt: number;
}

export function useToastQueue() {
  const [queue, setQueue] = useState<QueuedToast[]>([]);
  const [visible, setVisible] = useState<QueuedToast | null>(null);

  const enqueue = useCallback((payload: CoordinationToastPayload) => {
    setQueue((q) => {
      // 合并相同 key
      const filtered = q.filter((it) => it.payload.key !== payload.key);
      // 也清掉当前 visible 同 key
      if (visible?.payload.key === payload.key) {
        setVisible({ payload, enqueuedAt: Date.now() });
        return filtered;
      }
      return [...filtered, { payload, enqueuedAt: Date.now() }];
    });
  }, [visible]);

  // 队列调度：每当 visible 为空且 queue 非空，取最高优先级 + 最早入队的 toast
  useEffect(() => {
    if (visible) return;
    if (queue.length === 0) return;
    const sorted = [...queue].sort((a, b) => {
      const pa = PRIORITY[a.payload.level];
      const pb = PRIORITY[b.payload.level];
      if (pa !== pb) return pb - pa;  // 高优先级先
      return a.enqueuedAt - b.enqueuedAt;
    });
    const next = sorted[0];
    setVisible(next);
    setQueue((q) => q.filter((it) => it !== next));
  }, [queue, visible]);

  // 高优先级 (error) 抢占：当新 enqueue 是 error 且 visible 是 info → push visible 回队尾，立即展示新 error
  useEffect(() => {
    if (!visible) return;
    const errors = queue.filter((it) => it.payload.level === "error");
    if (errors.length > 0 && visible.payload.level !== "error") {
      setQueue((q) => [...q.filter((it) => it.payload.level !== "error"), visible]);
      setVisible(errors[0]);
    }
  }, [queue, visible]);

  const dismiss = useCallback(() => setVisible(null), []);

  return { visible, enqueue, dismiss };
}
```

#### C5.1 与既有 sonner toast 的关系

ToastQueue 是 spec 5 自己的 React state；`visible` 实时变化时通过既有 `sonner.toast.*` 调用展示一条新 toast，旧 toast 用 `sonner.dismiss(toastId)` 主动关闭。这样在不重写 sonner 的情况下实现"同时只显示 1 条"。

ToastQueue 不修改 spec 1 / 2 / 3 / 4 已经定义的文案语义（需求 3.5）；它只是协调展示节奏。

### C6. ThreeLayerConsistencyChecker（`ThreeLayerConsistencyChecker.ts`）

```typescript
export interface ThreeLayerCheckResult {
  ok: boolean;
  /** 检查 + 修正所耗时间。 */
  elapsedMs: number;
  /** true 表示当前是合法回看态，没有执行任何修正。 */
  reviewOverride?: boolean;
  /** 修正前的不一致快照（仅诊断用）。 */
  snapshot?: {
    urlPin: string | null;
    workflowStageOverride: string | null;
    activeJobStage: string;
    mismatchReason?: string;
  };
}

const LEGACY_STAGE_ALIASES: Record<string, BlueprintGenerationStage> = {
  spec_documents: "spec_docs",
  runtime: "runtime_capability",
};

function normalizeStage(stage: string | null): BlueprintGenerationStage | null {
  if (stage === null) return null;
  return LEGACY_STAGE_ALIASES[stage] ?? (isBlueprintGenerationStage(stage) ? stage : null);
}

function isDisplayableReviewStage(job: BlueprintGenerationJob, stage: BlueprintGenerationStage): boolean {
  // 页面 1 的 input/clarification/route_generation 可由 request/intake/selection 派生；
  // 页面 2/3 优先检查 artifact，允许 stale artifact 继续展示。
  if (STAGE_TO_PAGE[stage] === 1) return true;
  return stageHasArtifact(job, stage);
}

function isReviewOverrideCompatible(input: {
  activeJob: BlueprintGenerationJob;
  candidate: BlueprintGenerationStage | null;
}): boolean {
  if (input.candidate === null) return true;
  const activePage = STAGE_TO_PAGE[input.activeJob.stage];
  const candidatePage = STAGE_TO_PAGE[input.candidate];
  if (candidatePage === undefined) return false;
  if (!isDisplayableReviewStage(input.activeJob, input.candidate)) return false;

  // 同页合法：特别是 spec_tree/spec_docs 都是页面 2。
  if (candidatePage === activePage) return true;

  // 回看合法：用户可以从最新进度页面回看上游页面。
  if (candidatePage < activePage) return true;

  // 前跳到 backend 尚未到达的下游页面不合法。
  return false;
}

export function useThreeLayerConsistencyChecker() {
  const resetPin = useAutopilotPinStore((s) => s.reset);
  const setWorkflowStageOverride = useAutopilotWorkflowStore((s) => s.setOverride);
  const activeJob = useAutopilotJobStore((s) => s.activeJob);

  const checkAndCorrect = useCallback((): ThreeLayerCheckResult => {
    const start = performance.now();
    if (!activeJob) return { ok: true, elapsedMs: 0 };
    const urlPin = readUrlPinFromQuery();    // 既有 hook 提供
    const workflowStageOverride = readWorkflowStageOverride();
    const activeJobStage = activeJob.stage;
    const normalizedUrlPin = normalizeStage(urlPin);
    const normalizedOverride = normalizeStage(workflowStageOverride);

    const isUrlPinValid = urlPin === null
      || (normalizedUrlPin !== null && isReviewOverrideCompatible({ activeJob, candidate: normalizedUrlPin }));
    const isOverrideValid = workflowStageOverride === null
      || (normalizedOverride !== null && isReviewOverrideCompatible({ activeJob, candidate: normalizedOverride }));

    if (isUrlPinValid && isOverrideValid) {
      const isReviewOverride = (normalizedUrlPin !== null && normalizedUrlPin !== activeJobStage)
        || (normalizedOverride !== null && normalizedOverride !== activeJobStage);
      return { ok: true, elapsedMs: performance.now() - start, reviewOverride: isReviewOverride };
    }

    const mismatchReason = !isUrlPinValid
      ? "invalid_url_pin"
      : "invalid_workflow_stage_override";

    console.warn("[autopilot-coordination] coordination.three_layer_mismatch", {
      event: "coordination.three_layer_mismatch",
      urlPin,
      workflowStageOverride,
      activeJobStage,
      mismatchReason,
      correctedTo: activeJobStage,
    });

    if (!isUrlPinValid) resetPin();
    if (!isOverrideValid) setWorkflowStageOverride(activeJobStage);

    const elapsedMs = performance.now() - start;
    return {
      ok: elapsedMs <= 100,
      elapsedMs,
      snapshot: { urlPin, workflowStageOverride, activeJobStage, mismatchReason },
    };
  }, [activeJob, resetPin, setWorkflowStageOverride]);

  return { checkAndCorrect };
}
```

#### C6.1 与需求的对应

- 需求 5.1：在每次 `coordinator.submit()` 完成 store 写入后调一次。
- 需求 5.2：发现非法 pin / override 时 `console.warn` + 仅修正前端不可展示状态。
- 需求 5.2a：合法回看态（例如 backend 在 `runtime_capability`，用户 pin 到 `spec_tree` 或 override 到 `input`）直接返回 ok，不自动拉回 backend stage。
- 需求 5.2b：`spec_tree` 与 `spec_docs` 同属页面 2，二者差异不触发页面级回退或 mismatch。
- 需求 5.3：idempotent——已一致时直接返回 ok，不再修正。
- 需求 5.4：`elapsedMs > 100` 视为修正失败 → 上层 `coordinator.submit` 入队 error toast。
- 需求 5.5：本 hook 不在 React effect 中自动执行；只在 caller 显式调用时执行。
- 需求 5.6：本 hook 不写 backend job stage。
- 需求 5.7：使用 `STAGE_TO_PAGE` 判断页面兼容性，不使用 spec 1 artifact dependency graph 做 UI 回退。

### C7. Reduced Motion 探测（`reduced-motion.ts`）

```typescript
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
```

简单一次性同步探测。如未来需要响应媒体查询变化（用户切换系统设置），可用 `useReducedMotion` hook 监听 `change` 事件，但本 spec 不要求。

### C8. spec 2 / 3 / 4 调用点改造

#### C8.1 spec 2 ReplanConfirmationModal 改造（最小 diff）

```tsx
// client/src/pages/autopilot/right-rail/replan/ReplanConfirmationModal.tsx
const { submit } = useAutopilotCoordination();

const handleConfirm = async () => {
  setStateInFlight();
  try {
    const response = await postBlueprintReplan(jobId, { fromStage, mode, reason });
    const result = await submit({
      triggerSource: "replan",
      apply: () => {
        rightRailRetry();
        if (response.mode === "branch") {
          switchActiveJob(response.job.id);
          branchIndex.append(response.parentJobId, response.job.id);
        }
      },
      toastPayload: {
        level: "info",
        key: `replan.${response.mode}.${response.job.id}`,
        message: response.mode === "in_place"
          ? `已从 ${stageZh(fromStage)} 起标记 ${response.summary.markedStaleArtifactCount} 个下游内容为过期`
          : `已创建新分支，从 ${stageZh(fromStage)} 起独立重新规划`,
      },
      stageTransition: {
        prevStage: prevActiveStage,
        nextStage: fromStage,
      },
      pageTransition: {
        prevPage: STAGE_TO_PAGE[prevActiveStage],
        nextPage: STAGE_TO_PAGE[fromStage],
      },
    });
    if (!result.ok) { /* 已有错误 toast 自动展示 */ }
    setOpen(false);
  } catch (err) { ... }
};
```

替换面：将 spec 2 既有的"直接 toast.success + 直接 store 写入"路径改为 `coordinator.submit({ apply, toastPayload, stageTransition, pageTransition })`。spec 2 的 `useReplanFlow` hook 内部不再需要直接调 toast / 直接调 rightRailRetry，迁移到 coordinator 即可。

#### C8.2 spec 3 / spec 4 的迁移类似

- spec 3 的 `useInlineEditFlow` 把直接 toast + rightRailRetry 包到 `submit({ triggerSource: "inline_edit", apply: () => rightRailRetry(), toastPayload, ...})`。inline edit 不引发 page transition / stage transition（页面停留），故 `stageTransition` 与 `pageTransition` 都省略。
- spec 4 的 `useSwitchActiveJob` 把直接 setActiveJobId + URL 更新 + rightRailRetry 包到 `submit({ triggerSource: "switch_active", apply, stageTransition, pageTransition })`。

需求 6.1 要求所有 spec 通过统一入口注册 Refresh_Trigger；这一节是对各 sibling spec 的接线指引。

### C9. AutopilotRoutePage 改造

在外层壳上包一层 `<PageTransitionWrapper state={pageTransitionState}>`：根据 `state.direction` 给 Framer Motion 派生 `initial` / `animate` / `exit`。具体接入由 design 阶段对齐既有 `AutopilotRoutePage` 的容器结构。

## 数据模型

| 名称 | 位置 | 类型 |
|---|---|---|
| `CoordinationSubmission` | `AutopilotCoordinator.ts` | interface |
| `CoordinationResult` | 同上 | interface |
| `MediatorFlushResult` | `AtomicRefreshMediator.ts` | interface |
| `StageTransitionState` | `StageTransitionAnimator.ts` | interface |
| `QueuedToast` | `ToastQueue.ts` | interface（内部） |
| `ThreeLayerCheckResult` | `ThreeLayerConsistencyChecker.ts` | interface |

## 错误处理

| 场景 | 处理 |
|---|---|
| `apply` callback 抛错 | `flushSync` 回滚整 batch；`console.error coordination.batch_rolled_back`；`coordinator.submit` 返回 `{ ok: false, failureReason: "store_write_failed" }`；自动入队 error toast |
| `apply` 成功但三层存在非法 pin / override 且 100ms 内未修正完 | `console.warn coordination.three_layer_mismatch`；自动入队 error toast；`coordinator.submit` 返回 `{ ok: false, failureReason: "three_layer_mismatch_failed" }` |
| `apply` 成功后处于合法 Review_Override_State | 不输出 mismatch warn、不修正 pin/override；`coordinator.submit` 返回 ok |
| 动画 in-flight 时第二次 trigger | `console.debug coordination.animation_aborted`；abort 当前 animation；新 animation 启动；`coordinator.submit` 仍返回 ok（动画中止不视为失败） |
| `prefers-reduced-motion: reduce` | 所有动画跳过；store 写入与 toast 与一致性自检照常 |
| 静态预览模式 | 协调器与 backend 无关，正常工作；ThreeLayerConsistencyChecker 也正常运行 |

## 测试策略

### T1. `AtomicRefreshMediator.test.ts`（property + example）

#### Property test（≥ 100 iterations）

- **批次写入原子性**（需求 8.2）：构造 N (N ∈ [1, 10]) 个 setState 调用 → `flushSync` 包装 → React render snapshot 在 batch 内仅 1 次 commit；通过 `getRender` 在 mediator.flush 前后取快照，不应在过程中观察到中间状态。
  - fast-check: `fc.assert(fc.property(fc.array(fc.string(), 1, 10), (writes) => { ... }))`；每次写入触发一个 setState，验证 commit 计数为 1。

#### Example tests

- 三类 trigger（replan / inline_edit / switch_active）的成功路径：mediator.flush 返回 ok。
- apply 抛错 → flushResult.ok === false + console.error 被调（spy）。

### T2. `ToastQueue.test.ts`

- 同 key 合并：`enqueue({ key: "k", level: "info" })` 后 `enqueue({ key: "k", level: "info", message: "新" })` → visible 文案是"新"。
- 优先级抢占：visible 是 info 时 enqueue error → 立即切到 error，info 排队尾。
- dismiss 后立即展示下一条。
- prefers-reduced-motion 不影响入队 / 合并 / 优先级。

### T3. `StageTransitionAnimator.test.tsx`

- 同 stage 不触发：transition("input", "input") → state.inFlight === false。
- 跨 stage 触发：transition("input", "spec_tree") → direction === "advance"，inFlight === true，300ms 后 inFlight === false。
- prefers-reduced-motion 时立即结束：state.inFlight 永不为 true。
- 连续两次 trigger 中止前一次：console.debug 被调。

### T4. `PageTransitionChoreographer.test.tsx`

- 同页面 transition(2, 2) → 不触发。
- 跨页面 transition(3, 1) → direction === "backward"。

### T5. `ThreeLayerConsistencyChecker.test.ts`

- 三层一致 → checkResult.ok === true，无 console.warn。
- 合法回看态：activeJob.stage = runtime_capability，urlPin = spec_tree，workflowStageOverride = input → checkResult.ok === true，reviewOverride === true，无 setter 调用。
- 同页 SPEC 态：activeJob.stage = spec_docs，urlPin = spec_tree → checkResult.ok === true，无 setter 调用。
- urlPin 不在 activeJob 中 → 触发 console.warn + resetPin 被调。
- workflowStageOverride 与 activeJobStage 不兼容 → 触发 console.warn + setOverride 被调。
- idempotent：连续两次 check → 第二次不再调任何 setter。
- 不修改 backend job stage（验证：spy `jobStore.save` 未被调）。

### T6. `AutopilotCoordinator.integration.test.tsx`

5 个端到端场景（需求 8.4）：

- (a) replan in_place 成功：toast / stage 动画 / staleArtifactIds 同帧刷新。
- (b) replan branch 成功：Active_Job 切换 + 页面级过渡。
- (c) inline edit 成功后 toast 不与 spec 2 toast 冲突（合并 key 不同）。
- (d) Switch_Active 跨页面切换触发 PageTransitionChoreographer。
- (e) Animation_Reduced_Mode 下所有动画取消、store 一致性保持。

### T7. Fixtures

```typescript
// __fixtures__/mock-store.ts
export function createMockJobStore(initialJob?: BlueprintGenerationJob) { ... }
export function createMockPinStore() { ... }
export function createMockWorkflowStore() { ... }
```

`mock-trigger.ts`：构造测试用 `CoordinationSubmission`。

## 与需求的全量对照

| 需求 | 落地点 |
|---|---|
| 1.1–1.8（Stage_Transition_Animator） | C3 |
| 2.1–2.8（Atomic_Refresh_Mediator） | C2 |
| 3.1–3.8（Toast_Queue） | C5 |
| 4.1–4.7（Page_Transition_Choreographer） | C4 |
| 5.1–5.6（Three_Layer_State 一致性） | C6 |
| 6.1–6.7（Refresh_Trigger 接线契约） | C1 / C8 |
| 7.1–7.6（与 spec 1/2/3/4 关系） | 全文 wrapper 形态、不替换、不修改既有数据流 |
| 8.1–8.6（属性 + 示例测试） | T1–T7 |
| 9.1–9.6（日志） | C2 / C3 / C6 console 输出 |
| 10.1–10.9（向后兼容） | 全文未触及任一既有路由 / shared contract |
| 11.1–11.11（范围边界） | 设计层未引入 spec 1/2/3/4 范围内的代码 / 不引入 service worker / 不引入 BroadcastChannel / 不引入撤销栈 |

## 实施风险与对冲

| 风险 | 对冲 |
|---|---|
| `flushSync` 在某些 React 内部 setState 路径下可能抛 "flushSync was called from inside a lifecycle method" warning | 仅在 user event handler 内调；spec 2 / 3 / 4 调用 `coordinator.submit()` 都是 user-initiated（用户点 confirm / edit / tree node），无生命周期内调风险 |
| `flushSync` 把渲染同步化可能导致动画掉帧 | flushSync 只用于 store 写入；动画通过 Framer Motion 异步路径，不阻塞渲染 |
| ToastQueue 与 sonner 的双重展示 | spec 5 的 ToastQueue 控制时机，sonner 是底层渲染；通过 sonner.dismiss + sonner.toast 配对调用避免重叠 |
| ThreeLayerConsistencyChecker 在 activeJob 还未拉到（loading 态）时误判 | C6 显式 `if (!activeJob) return ok`，跳过自检 |
| 跨页面 + 跨 stage 同时存在时动画双触发 | C1 在判断 `pageTransition.prevPage !== nextPage` 时触发 page choreographer，并同时跳过 stage animator（条件互斥） |
| `prefers-reduced-motion` 用户在运行时切换系统设置 | 当前 spec 仅同步探测，切换需刷新页面；未来如需要可换 useReducedMotion hook |
| spec 2 / 3 / 4 落地时尚未接入 coordinator | 6.5 兼容性保护：本 hook 不强制；既有直接 store 写入路径仍可用 |
| Toast 队列在卸载组件时残留 | useToastQueue 是 React state，组件卸载即清空；如需持久化（跨页面）需额外 lift to module-level singleton，本 spec 不引入 |

## 系列收尾说明

spec 5 是 5-spec 系列的最后一份。本 spec 落地后：

- spec 1 提供数据基座（staleness 字段 + 引擎）；
- spec 2 提供显式 replan（按钮 + modal + 端点 + 事件 + 分支元数据）；
- spec 3 提供隐式 inline edit（hook + 字段 UI）；
- spec 4 提供版本树消费层（family 端点 + 树视图 + Compare + Timeline）；
- spec 5 把所有跨 spec 协调点（动画、原子刷新、toast、三层一致性）收口到统一前端协调层。

后续若需要扩展（例如 service worker、跨页签广播、撤销/重做栈、自定义动画偏好 UI 等），SHALL 以新系列 spec 形式推进，SHALL NOT 反向修改本系列任一 spec 的需求。
