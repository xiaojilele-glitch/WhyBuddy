# 设计文档：Autopilot Stage Version History

## 概览

本设计落地 spec 4 的全部需求：把 spec 1（staleness）+ spec 2（branch metadata + replan event）+ spec 3（inline edit 触发的 stale）写入的全部数据浮到用户可见层——版本树视图、Compare 视图、Replan 时间线视图。新增**只读**端点 `GET /api/blueprint/jobs/:jobId/family`，前端通过它一次拉回 family 全集。spec 4 是消费方而非生产方：不修改任一 job 状态、不触发任一 LLM/Docker 副作用、不引入新事件家族、不扩展 shared contracts。

设计的三个不变量：

1. **只读消费**：spec 4 服务端唯一新增物是一个 `GET` 端点，前端唯一写动作是 Switch_Active（只触达 store 的 `activeJobId` / `subStagePin` / `workflowStageOverride` 与 URL，不写 backend job）。spec 5 落地后，Switch_Active 的这些前端写入必须通过 Coordination_Layer 原子提交。
2. **Branch_Index 在 spec 4 才 surface**：spec 2 §9.4 把 Branch_Index 锁在 store 内部、不暴露到 UI 层；spec 4 是其**唯一** UI 消费方。但 family 重建不依赖 Branch_Index——服务端的 `GET /family` 直接扫 `jobStore.list()`，前端的 Branch_Index 仅作为快速派生缓存。
3. **不做 artifact payload 内容级 diff**：Compare_View 只表达"存在 / 缺失 / fresh / stale / 时间戳"，不引入任何 markdown / json / svg 行级对比逻辑。

## 架构

### 模块边界与文件布局

```
shared/blueprint/contracts.ts                            ← 仅追加 BlueprintFamilyResponse 类型导出（jobs + replanEvents 复用既有类型）
server/routes/blueprint/
  family/
    family-route.ts                                      ← createFamilyHandler 工厂
    family-builder.ts                                    ← buildFamilyFromJobStore 纯函数（含环检测）
    family-logger.ts                                     ← family.read / family.rejected / family.cycle_detected 日志
    __tests__/
      __fixtures__/
        build-fixture-family.ts                          ← 各种 family 拓扑构造器（family-of-1 / parent+1 / parent+N / 多层）
        arbitraries.ts                                   ← fast-check arbitraries（含合法 family）
      family-endpoint.test.ts                            ← property + example
server/routes/blueprint.ts                               ← 仅追加一行 router.get 注册
client/src/lib/blueprint-api/
  family.ts                                              ← getBlueprintFamily helper
client/src/pages/autopilot/version-history/
  VersionTreeView.tsx                                    ← 树状渲染主组件
  TreeNode.tsx                                           ← 单 job 节点
  CompareView.tsx                                        ← 双窗格比较视图
  ReplanTimelineView.tsx                                 ← 时间线视图
  HistoryEntryPoint.tsx                                  ← 入口触点（右栏顶部 / 主壳按钮）
  use-family-data.ts                                     ← 拉数据 + 派生 Tree 拓扑
  use-switch-active-job.ts                               ← Switch_Active 写入 store + URL；spec 5 落地后改为提交 coordinator
  derive-tree-layout.ts                                  ← jobs[] → 树拓扑数据
  __tests__/
    VersionTreeView.test.tsx
    CompareView.test.tsx
    ReplanTimelineView.test.tsx
    HistoryEntryPoint.test.tsx
    use-family-data.test.ts
    use-switch-active-job.test.ts
client/src/lib/                                          ← spec 2 的 useAutopilotJobStore 已含 activeJobId + branchIndex；spec 4 仅消费
```

### 与现有依赖的接线

- **后端依赖**：`BlueprintJobStore.list` / `get`（只读）、`BlueprintServiceContext.logger`。
- **后端不依赖**：spec 1 引擎 / spec 2 端点 / spec 3 hook / LLM / Docker / event bus 推送。
- **前端依赖**：spec 2 的 `useAutopilotJobStore`（`activeJobId` setter + `branchIndex`）、spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`（用于 Compare_View 的 stage 顺序）、既有路由 hook、既有 toast、既有 `BLUEPRINT_JOBS_ENDPOINT` 常量。
- **前端不依赖**：spec 2 的 `ReplanConfirmationModal` / spec 3 的 `EditModeField` / spec 5 的 `Atomic_Refresh_Mediator`（spec 5 后续接管）。

### 数据流

```
用户点 HistoryEntryPoint
   │
   ├─ 路由跳转到 /autopilot?history=1（或 modal 打开）
   ▼
VersionTreeView mount
   │
   ├─ useFamilyData(activeJobId) 触发 fetch
   │     GET /api/blueprint/jobs/:activeJobId/family
   │     │
   │     ├─ family-route.ts: jobStore.get(jobId)
   │     │     失败 → 404 + family.rejected debug 日志
   │     ├─ family-builder.ts: 从该 jobId 出发
   │     │     ├─ 向上沿 parentJobId 找 root
   │     │     │     若链路成环 → 500 + family.cycle_detected error 日志
   │     │     ├─ 从 root 向下扫 jobStore.list()，找所有 parentJobId === root.id 的 child（递归）
   │     │     ├─ 合并每个 job 的 events 中 type === "replan.triggered" 的事件
   │     │     │     按 triggeredAt 升序排列
   │     │     └─ 返回 { rootJobId, jobs, replanEvents }
   │     └─ 200 + family-builder 输出（family.read info 日志）
   │
   ▼
deriveTreeLayout(jobs) → 派生 React 渲染所需的 tree 数据
   │
   ├─ TreeNode 渲染：jobId 短标识 + stage + status + active 标记 + stale 标记
   ▼
用户在 TreeNode 上点击
   │
   ├─ useSwitchActiveJob: 设置 activeJobId / 更新 URL
   ├─ rightRailRetry() 拉新 job 数据
   ▼
其他 family 视图（Compare / Timeline）按需渲染
```

### 非功能性约束

- **响应时间**：family 端点 ≤ 200ms（in-memory list + 拓扑遍历，family 规模 ≤ 100 时极快）；> 100 jobs 时输出 warn 级日志，但仍返回完整 family。
- **可观测性**：三条日志事件键 `family.read` / `family.rejected` / `family.cycle_detected`，前缀稳定，与 spec 1/2/3 互斥。
- **GitHub Pages 静态预览**：family 端点不可用 → 前端 fetch 4xx/5xx → VersionTreeView 渲染单节点降级视图（仅当前 Active_Job）。

## 组件设计

### C1. Shared Contracts

#### C1.1 `BlueprintFamilyResponse` 类型

```typescript
// shared/blueprint/contracts.ts 末尾追加（紧邻 spec 1/2 已有的追加段）
export interface BlueprintFamilyResponse {
  rootJobId: string;
  jobs: BlueprintGenerationJob[];
  replanEvents: BlueprintGenerationEvent[];
}
```

不引入新字段类型（jobs 复用 `BlueprintGenerationJob`，replanEvents 复用 `BlueprintGenerationEvent`）。这是 spec 4 对 shared contracts 的**唯一**改动。

### C2. Family Builder（`server/routes/blueprint/family/family-builder.ts`）

#### C2.1 算法

```typescript
import type {
  BlueprintGenerationJob,
  BlueprintGenerationEvent,
  BlueprintFamilyResponse,
} from "../../../../shared/blueprint/contracts.js";

const MAX_PARENT_CHAIN_DEPTH = 1024;  // 防御无界递归

export type FamilyBuilderResult =
  | { kind: "ok"; response: BlueprintFamilyResponse }
  | { kind: "cycle"; offendingJobId: string; chainSummary: string };

export function buildFamilyFromJobStore(
  allJobs: readonly BlueprintGenerationJob[],
  startJobId: string,
): FamilyBuilderResult {
  const byId = new Map<string, BlueprintGenerationJob>();
  for (const j of allJobs) byId.set(j.id, j);

  const startJob = byId.get(startJobId);
  if (!startJob) {
    // 调用方应已检查；此处兜底
    return { kind: "cycle", offendingJobId: startJobId, chainSummary: "(missing)" };
  }

  // Step 1: 向上找 root
  const visitedAscent = new Set<string>();
  const ascentChain: string[] = [];
  let cursor: BlueprintGenerationJob | undefined = startJob;
  let depth = 0;
  while (cursor && cursor.parentJobId !== undefined) {
    ascentChain.push(cursor.id);
    if (visitedAscent.has(cursor.parentJobId)) {
      // 链路成环：A → B → A
      const summary = ascentChain.concat(cursor.parentJobId).map(shortId).join("→");
      return {
        kind: "cycle",
        offendingJobId: cursor.parentJobId,
        chainSummary: summary,
      };
    }
    visitedAscent.add(cursor.parentJobId);
    if (++depth > MAX_PARENT_CHAIN_DEPTH) {
      const summary = ascentChain.slice(0, 8).map(shortId).join("→") + "→…";
      return {
        kind: "cycle",
        offendingJobId: cursor.parentJobId,
        chainSummary: summary,
      };
    }
    cursor = byId.get(cursor.parentJobId);
  }
  if (!cursor) {
    // parentJobId 指向不存在的 job：视为 cycle（不可访问根）
    return {
      kind: "cycle",
      offendingJobId: startJob.id,
      chainSummary: ascentChain.map(shortId).join("→") + "→(missing-parent)",
    };
  }
  const root = cursor;
  const rootJobId = root.id;

  // Step 2: 从 root 向下 BFS 扫所有 descendants
  const familyJobs = new Map<string, BlueprintGenerationJob>();
  familyJobs.set(rootJobId, root);
  const queue: string[] = [rootJobId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const j of allJobs) {
      if (j.parentJobId === parentId && !familyJobs.has(j.id)) {
        familyJobs.set(j.id, j);
        queue.push(j.id);
      }
    }
  }

  // Step 3: 排序 jobs（root 排首位，其余按 branchedAt 升序）
  const jobsOrdered: BlueprintGenerationJob[] = [];
  jobsOrdered.push(root);
  const branchJobs = [...familyJobs.values()]
    .filter((j) => j.id !== rootJobId)
    .sort((a, b) => {
      const aAt = a.branchedAt ?? a.createdAt;
      const bAt = b.branchedAt ?? b.createdAt;
      return aAt.localeCompare(bAt);
    });
  jobsOrdered.push(...branchJobs);

  // Step 4: 合并 replan.triggered events，按 triggeredAt 升序排列
  const replanEvents: BlueprintGenerationEvent[] = [];
  for (const j of jobsOrdered) {
    for (const e of j.events) {
      if (e.type === "replan.triggered") {
        replanEvents.push(e);
      }
    }
  }
  replanEvents.sort((a, b) => {
    const aAt = a.occurredAt;
    const bAt = b.occurredAt;
    if (aAt !== bAt) return aAt.localeCompare(bAt);
    // tie-breaker: jobId 字典序
    return a.jobId.localeCompare(b.jobId);
  });

  return {
    kind: "ok",
    response: {
      rootJobId,
      jobs: jobsOrdered,
      replanEvents,
    },
  };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
```

#### C2.2 与需求的对应

- 需求 1.3 / 1.4：`rootJobId` 严格等于 `jobs` 数组中唯一 `parentJobId === undefined` 的 job 的 id。
- 需求 1.5：family-of-one 时 `cursor.parentJobId === undefined` → root === startJob，BFS 仅 root 一节点；replanEvents 可能仍非空（startJob 自身经历过 in_place replan）。
- 需求 1.6：仅过滤 `type === "replan.triggered"`。
- 需求 1.7：纯遍历，无 mutation。
- 需求 1.8：环检测通过 `visitedAscent` Set + 深度阈值；返回 `cycle` kind 触发 500。
- 需求 1.12：family > 100 jobs 不报错；性能阈值 warn 在路由层（C3）触发。

### C3. Family Route（`server/routes/blueprint/family/family-route.ts`）

```typescript
import type { Request, Response } from "express";
import type { BlueprintJobStore } from "../job-store.js";
import type { BlueprintServiceContext } from "../context.js";
import { buildFamilyFromJobStore } from "./family-builder.js";
import { logFamilyRead, logFamilyRejected, logFamilyCycle } from "./family-logger.js";

const FAMILY_SIZE_WARN_THRESHOLD = 100;

export interface FamilyHandlerDeps {
  jobStore: BlueprintJobStore;
  ctx: Pick<BlueprintServiceContext, "logger">;
}

export function createFamilyHandler(deps: FamilyHandlerDeps) {
  return (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const job = deps.jobStore.get(jobId);
    if (!job) {
      logFamilyRejected(deps.ctx, jobId, "job_not_found");
      res.status(404).json({ error: "job_not_found" });
      return;
    }

    const startTime = Date.now();
    const result = buildFamilyFromJobStore(deps.jobStore.list(), jobId);
    const elapsedMs = Date.now() - startTime;

    if (result.kind === "cycle") {
      logFamilyCycle(deps.ctx, jobId, result.offendingJobId, result.chainSummary);
      res.status(500).json({ error: "family_cycle_detected", jobId: result.offendingJobId });
      return;
    }

    const familySize = result.response.jobs.length;
    if (familySize > FAMILY_SIZE_WARN_THRESHOLD) {
      deps.ctx.logger.warn("[blueprint-family] large family", {
        rootJobId: result.response.rootJobId,
        requestedJobId: jobId,
        familySize,
        elapsedMs,
      });
    }

    logFamilyRead(deps.ctx, {
      rootJobId: result.response.rootJobId,
      requestedJobId: jobId,
      familySize,
      replanEventCount: result.response.replanEvents.length,
    });

    res.status(200).json(result.response);
  };
}
```

#### C3.1 路由注册（`server/routes/blueprint.ts` 内追加）

紧邻 spec 1 的 `stale-artifacts` 与 spec 2 的 `replan` 之后：

```typescript
import { createFamilyHandler } from "./blueprint/family/family-route.js";

router.get(
  "/jobs/:jobId/family",
  createFamilyHandler({ jobStore, ctx: blueprintServiceContext }),
);
```

### C4. Family Logger

```typescript
export function logFamilyRead(
  ctx: Pick<BlueprintServiceContext, "logger">,
  payload: {
    rootJobId: string;
    requestedJobId: string;
    familySize: number;
    replanEventCount: number;
  },
): void {
  ctx.logger.info("[blueprint-family] family.read", {
    event: "family.read",
    rootJobId: payload.rootJobId,
    requestedJobId: payload.requestedJobId,
    familySize: payload.familySize,
    replanEventCount: payload.replanEventCount,
  });
}

export function logFamilyRejected(
  ctx: Pick<BlueprintServiceContext, "logger">,
  requestedJobId: string,
  reason: "job_not_found",
): void {
  ctx.logger.debug("[blueprint-family] family.rejected", {
    event: "family.rejected",
    requestedJobId,
    reason,
  });
}

export function logFamilyCycle(
  ctx: Pick<BlueprintServiceContext, "logger">,
  requestedJobId: string,
  offendingJobId: string,
  parentChainSummary: string,
): void {
  ctx.logger.error("[blueprint-family] family.cycle_detected", {
    event: "family.cycle_detected",
    requestedJobId,
    jobId: offendingJobId,
    parentChainSummary,
  });
}
```

### C5. Frontend Family Data Hook（`use-family-data.ts`）

```typescript
import { useEffect, useState } from "react";
import type { BlueprintFamilyResponse } from "../../../../../shared/blueprint/contracts.js";
import { getBlueprintFamily } from "../../../../lib/blueprint-api/family.js";

type FamilyFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; response: BlueprintFamilyResponse }
  | { kind: "error"; message: string };

export function useFamilyData(jobId: string | null) {
  const [state, setState] = useState<FamilyFetchState>({ kind: "idle" });
  useEffect(() => {
    if (!jobId) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    getBlueprintFamily(jobId)
      .then((response) => {
        if (cancelled) return;
        setState({ kind: "ok", response });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  return state;
}
```

#### C5.1 静态预览降级

在前端层判定（与 spec 2 §1.9 / spec 3 §12.6 同款 `useIsStaticPreviewMode`）：静态预览模式下 `useFamilyData` 直接返回 `{ kind: "error", message: "static_preview_unsupported" }`，不发起 fetch；`VersionTreeView` 在 `error.message === "static_preview_unsupported"` 时降级为单节点视图。

### C6. Frontend Tree Layout Derivation（`derive-tree-layout.ts`）

```typescript
import type { BlueprintGenerationJob } from "../../../../shared/blueprint/contracts.js";

export interface TreeNode {
  job: BlueprintGenerationJob;
  depth: number;
  parentJobId: string | undefined;
  childIds: string[];
  hasStale: boolean;
}

export function deriveTreeLayout(jobs: readonly BlueprintGenerationJob[]): TreeNode[] {
  const byId = new Map<string, BlueprintGenerationJob>();
  for (const j of jobs) byId.set(j.id, j);

  const childrenByParent = new Map<string, string[]>();
  for (const j of jobs) {
    if (j.parentJobId !== undefined) {
      const arr = childrenByParent.get(j.parentJobId) ?? [];
      arr.push(j.id);
      childrenByParent.set(j.parentJobId, arr);
    }
  }
  // 同 parent 下按 branchedAt 升序
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => {
      const aAt = byId.get(a)!.branchedAt ?? byId.get(a)!.createdAt;
      const bAt = byId.get(b)!.branchedAt ?? byId.get(b)!.createdAt;
      return aAt.localeCompare(bAt);
    });
  }

  // BFS 从 root 出发计算 depth
  const root = jobs.find((j) => j.parentJobId === undefined);
  if (!root) return [];

  const result: TreeNode[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const job = byId.get(id)!;
    const childIds = childrenByParent.get(id) ?? [];
    result.push({
      job,
      depth,
      parentJobId: job.parentJobId,
      childIds,
      hasStale: (job.staleArtifactIds ?? []).length > 0,
    });
    for (const c of childIds) queue.push({ id: c, depth: depth + 1 });
  }
  return result;
}
```

### C7. Frontend Version Tree View（`VersionTreeView.tsx`）

```tsx
export interface VersionTreeViewProps {
  rootJobId: string;
  activeJobId: string | null;
  onSwitchActive: (jobId: string) => void;
}

export function VersionTreeView(props: VersionTreeViewProps) {
  const familyState = useFamilyData(props.rootJobId);

  if (familyState.kind === "loading") {
    return <div>正在加载版本历史…</div>;
  }
  if (familyState.kind === "error") {
    if (familyState.message === "static_preview_unsupported") {
      return <SingleJobFallback jobId={props.activeJobId} />;
    }
    return <div>无法加载版本历史 <button>重试</button></div>;
  }
  if (familyState.kind !== "ok") return null;

  const tree = deriveTreeLayout(familyState.response.jobs);
  return (
    <div data-testid="autopilot-version-tree-view">
      {tree.map((node) => (
        <TreeNode
          key={node.job.id}
          node={node}
          isActive={node.job.id === props.activeJobId}
          onClick={() => props.onSwitchActive(node.job.id)}
        />
      ))}
    </div>
  );
}
```

#### C7.1 视觉布局

需求 3.1：root 在最上方/左侧，branch 通过 `depth` 缩进表达连接关系。本设计采用 **CSS grid + indent**：每个 TreeNode 一行，`marginLeft: depth * 24px`，左侧用 `border-left` 表示树枝；不引入 d3 / cytoscape / react-flow（需求 3.5）。

需求 3.2：每个 TreeNode 展示 jobId 短标识 + stage 中文名 + status + active 标记 + stale 标记 + branch 节点的 branchedFromStage / branchedAt。

需求 3.3：TreeNode 是 `<button role="button">` 或 `<div tabindex="0" onKeyDown>`，支持 Enter / Space 激活。

### C8. Frontend Tree Node（`TreeNode.tsx`）

```tsx
export function TreeNode(props: { node: TreeNode; isActive: boolean; onClick: () => void }) {
  const { job, depth, hasStale } = props.node;
  const isBranch = job.parentJobId !== undefined;
  const tooltip = `${job.id}\n${formatLocalTime(job.branchedAt ?? job.createdAt)}\n${stageZh(job.stage)}`;
  return (
    <button
      type="button"
      role="button"
      data-testid={`autopilot-tree-node-${job.id}`}
      onClick={props.onClick}
      title={tooltip}
      style={{ marginLeft: depth * 24 }}
      className={cn(
        "...",
        props.isActive && "bg-active",
        hasStale && "border-warn",
      )}
    >
      <span>{shortId(job.id)}</span>
      <span>{stageZh(job.stage)}</span>
      <StatusBadge status={job.status} />
      {isBranch && <BranchMetaBadge job={job} />}
      {props.isActive && <ActiveBadge />}
      {hasStale && <StaleBadgeMini />}
    </button>
  );
}
```

需求 3.9：`StaleBadgeMini` 与 spec 1 / 2 / 3 既有 stale badge 共用同一警告色 token。

### C9. Frontend Switch Active Job Hook（`use-switch-active-job.ts`）

```typescript
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAutopilotJobStore, useAutopilotRightRailRetry } from "...";
import { fetchBlueprintJob } from "../../../../lib/blueprint-api/jobs.js";

export function useSwitchActiveJob(familyJobs: BlueprintGenerationJob[]) {
  const activeJob = useAutopilotJobStore((s) => s.activeJob);
  const setActiveJobId = useAutopilotJobStore((s) => s.setActiveJobId);
  const rightRailRetry = useAutopilotRightRailRetry();
  const coordinator = useOptionalAutopilotCoordination(); // spec 5 落地后可用；未落地时返回 null
  const navigate = useNavigate();

  return useCallback(
    async (newJobId: string) => {
      // 校验 newJobId 必须在当前 family 内
      const inFamily = familyJobs.some((j) => j.id === newJobId);
      if (!inFamily) {
        toast.error("该任务不在当前家族中");
        return;
      }

      const nextJob = familyJobs.find((j) => j.id === newJobId)!;
      const apply = () => {
        setActiveJobId(newJobId);
        const params = new URLSearchParams(location.search);
        params.set("activeJob", newJobId);
        navigate({ search: params.toString() }, { replace: false });
        rightRailRetry();
      };

      if (coordinator) {
        await coordinator.submit({
          triggerSource: "switch_active",
          apply,
          stageTransition: { prevStage: activeJob?.stage, nextStage: nextJob.stage },
          pageTransition: { prevPage: activeJob ? STAGE_TO_PAGE[activeJob.stage] : undefined, nextPage: STAGE_TO_PAGE[nextJob.stage] },
        });
        return;
      }

      // spec 5 未落地前的兼容路径：直接写入，保持 spec 4 可独立交付。
      apply();
    },
    [activeJob, coordinator, familyJobs, setActiveJobId, rightRailRetry, navigate],
  );
}
```

#### C9.1 与需求的对应

- 需求 2.1：100ms 内执行 store 切换 + URL 更新；`setActiveJobId` 是同步 setter，URL `navigate` 也是同步（react-router 内部 push history），整体 < 16ms。
- 需求 2.2：spec 5 落地后由 Coordination_Layer 原子处理 sub-stage pin / workflowStageOverride；spec 5 未落地前沿用既有 `useAutopilotRightRailData` hook 在 jobId 变化时自动重置的兼容行为。
- 需求 2.3：URL 更新通过 `?activeJob=<jobId>` query 参数；spec 5 落地后 URL 与 Active_Job 切换处于同一次 Coordination_Submission；刷新页面后既有路由解析逻辑读 query 设置 `activeJobId`。
- 需求 2.4：URL 上未携带 `activeJob` 时不强制改写 store，`activeJobId` 保持当前值。
- 需求 2.5：跨 family jobId 校验 + toast 错误提示。
- 需求 2.6：running job 切走不中断 backend；前端 store 只切 `activeJobId`，不调任何 mutation。
- 需求 2.7：本 hook 不调 spec 2/3 端点。
- 需求 2.8：通过 `rightRailRetry()` 触发既有 fetch（既有 hook 已实现 `GET /jobs/:jobId`）。

### C10. Frontend Compare View（`CompareView.tsx`）

```tsx
const STAGE_ORDER: BlueprintGenerationStage[] = [
  "input", "clarification", "route_generation", "spec_tree",
  "spec_docs", "preview", "effect_preview", "prompt_packaging",
  "runtime_capability", "engineering_handoff", "engineering_landing",
];

const PRIMARY_ARTIFACT_TYPE_BY_STAGE: Record<BlueprintGenerationStage, BlueprintGenerationArtifactType> = {
  input: "intake",
  clarification: "clarification_session",
  route_generation: "route_selection",
  spec_tree: "spec_tree",
  spec_docs: "design",
  preview: "preview",
  effect_preview: "effect_preview",
  prompt_packaging: "prompt_pack",
  runtime_capability: "capability_registry",
  engineering_handoff: "engineering_plan",
  engineering_landing: "engineering_run",
};

export function CompareView(props: { familyJobs: BlueprintGenerationJob[]; jobAId: string; jobBId: string }) {
  const jobA = props.familyJobs.find((j) => j.id === props.jobAId);
  const jobB = props.familyJobs.find((j) => j.id === props.jobBId);

  // 需求 4.2: 两个 job 必须同 family（family 即 props.familyJobs，已是同 family）
  if (!jobA || !jobB) {
    return <div>两个任务不属于同一家族</div>;
  }

  return (
    <div data-testid="autopilot-compare-view" className="grid grid-cols-2">
      {STAGE_ORDER.map((stage) => (
        <CompareStageRow
          key={stage}
          stage={stage}
          artifactA={findPrimaryArtifact(jobA, stage)}
          artifactB={findPrimaryArtifact(jobB, stage)}
        />
      ))}
    </div>
  );
}

function findPrimaryArtifact(job: BlueprintGenerationJob, stage: BlueprintGenerationStage) {
  const targetType = PRIMARY_ARTIFACT_TYPE_BY_STAGE[stage];
  return job.artifacts.find((a) => a.type === targetType);
}

function CompareStageRow(props: { stage: BlueprintGenerationStage; artifactA?: BlueprintGenerationArtifact; artifactB?: BlueprintGenerationArtifact }) {
  return (
    <>
      <CompareCell artifact={props.artifactA} stage={props.stage} />
      <CompareCell artifact={props.artifactB} stage={props.stage} />
    </>
  );
}

function CompareCell(props: { artifact?: BlueprintGenerationArtifact; stage: BlueprintGenerationStage }) {
  if (!props.artifact) {
    return <div>—</div>;
  }
  const isStale = props.artifact.staleSince !== undefined;
  return (
    <div>
      <span>✓</span>
      {isStale && <StaleBadgeMini />}
      <span>{formatLocalTime(props.artifact.createdAt)}</span>
    </div>
  );
}
```

需求 4.5：本组件**不**实现 markdown 行级 diff / json 字段对比 / svg / html diff；仅展示存在/缺失/stale/时间戳。

需求 4.6：组件内零 mutation 控件（无"覆盖"/"合并"/"删除"按钮）。

### C11. Frontend Replan Timeline View（`ReplanTimelineView.tsx`）

```tsx
export function ReplanTimelineView(props: { replanEvents: BlueprintGenerationEvent[] }) {
  // 需求 5.1: 已由后端过滤；此处再次防御性过滤
  const events = props.replanEvents.filter((e) => e.type === "replan.triggered");

  // 需求 5.2: 降序展示
  const sorted = [...events].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
    return a.jobId.localeCompare(b.jobId);
  });

  if (sorted.length === 0) {
    return <div>该任务尚无重新规划记录</div>;
  }

  return (
    <ol data-testid="autopilot-replan-timeline">
      {sorted.map((e) => (
        <ReplanTimelineEntry key={e.id} event={e} />
      ))}
    </ol>
  );
}

function ReplanTimelineEntry(props: { event: BlueprintGenerationEvent }) {
  const payload = props.event.payload as {
    parentJobId?: string;
    fromStage: BlueprintGenerationStage;
    mode: "in_place" | "branch";
    reason?: string;
    triggeredAt: string;
    markedStaleArtifactCount?: number;
    inheritedUpstreamArtifactCount?: number;
  };
  const truncatedReason = payload.reason && payload.reason.length > 200
    ? payload.reason.slice(0, 200) + "…"
    : payload.reason;
  const count = payload.mode === "in_place"
    ? payload.markedStaleArtifactCount ?? 0
    : payload.inheritedUpstreamArtifactCount ?? 0;

  return (
    <li>
      <time>{formatLocalTime(payload.triggeredAt)}</time>
      <span>{payload.mode === "in_place" ? "原地标记过期" : "创建新分支"}</span>
      <span>{shortId(props.event.jobId)}</span>
      {payload.parentJobId && <span>← {shortId(payload.parentJobId)}</span>}
      <span>{stageZh(payload.fromStage)}</span>
      <span>{count}</span>
      {truncatedReason && <p>{truncatedReason /* 纯文本，不渲染 HTML */}</p>}
    </li>
  );
}
```

需求 5.7：`reason` 通过 React 的默认文本渲染（非 `dangerouslySetInnerHTML`）；XSS 防护天然生效。

需求 5.5：本组件不订阅 socket 推送。socket 接入由 `use-family-data.ts` 在后续可选扩展（本 spec 不强制；如要做，仅在事件到达时往本地 events 数组前 prepend，不重新 fetch）。

### C12. Frontend History Entry Point（`HistoryEntryPoint.tsx`）

```tsx
export function HistoryEntryPoint() {
  const isStaticPreview = useIsStaticPreviewMode();
  const navigate = useNavigate();
  const tooltip = isStaticPreview ? "静态预览模式不支持版本历史" : null;

  return (
    <button
      type="button"
      data-testid="autopilot-history-entry"
      onClick={() => navigate("?history=1")}
      title={tooltip ?? "版本历史"}
      aria-disabled={isStaticPreview ? "true" : undefined}
    >
      <ClockIcon />
      <span>版本历史</span>
    </button>
  );
}
```

需求 6.3：本组件**不**响应 socket / URL 自动 / replan 成功事件——仅在用户点击时调 `navigate`。

需求 6.6：通过 ESLint 或单测断言保护，HistoryEntryPoint 与 ReplanButton（spec 2）/ EditModeField edit 图标（spec 3）的 DOM 不在同一容器（同一 button group）。

### C13. Frontend API Helper（`client/src/lib/blueprint-api/family.ts`）

```typescript
import type { BlueprintFamilyResponse } from "../../../../shared/blueprint/contracts.js";

export async function getBlueprintFamily(
  jobId: string,
  options?: { signal?: AbortSignal },
): Promise<BlueprintFamilyResponse> {
  const response = await fetch(
    `/api/blueprint/jobs/${encodeURIComponent(jobId)}/family`,
    { signal: options?.signal },
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "unknown" }));
    throw new BlueprintFamilyError(response.status, errorBody);
  }
  return response.json();
}

export class BlueprintFamilyError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`blueprint family fetch failed: ${status}`);
  }
}
```

## 数据模型

| 名称 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `BlueprintFamilyResponse` | `shared/blueprint/contracts.ts` | interface | 新增（jobs + replanEvents 复用既有类型） |
| `FamilyBuilderResult` | `family-builder.ts` | union | 内部 builder 返回值 |
| `TreeNode`（前端） | `derive-tree-layout.ts` | interface | 渲染所需的派生数据 |
| `FamilyFetchState` | `use-family-data.ts` | union | 加载状态机 |

## 错误处理

| 场景 | HTTP / UI | 错误码 / 文案 | 日志 |
|---|---|---|---|
| `jobId` 不存在 | 404 | `job_not_found` | `family.rejected` debug |
| family 链路成环 | 500 | `family_cycle_detected` + `jobId` | `family.cycle_detected` error |
| family > 100 jobs | 200 | — | warn 级 large family |
| 成功 | 200 | — | `family.read` info |
| 前端 fetch 失败 | UI 错误态 | "无法加载版本历史" + 重试按钮 | — |
| 静态预览模式 | UI 单节点降级 | — | — |
| 跨 family 切换 | UI toast 错误 | "该任务不在当前家族中" | — |

## 测试策略

### T1. `family-endpoint.test.ts`（property + example）

#### Property tests（≥ 100 iterations 各）

- **Family 连接性**（需求 11.2 第 1 条）：随机 family + 随机起点 jobId → 响应 `jobs` 包含起点 jobId 与 root；其他每个元素的 `parentJobId` 链路在有限步内到达 `rootJobId`。
- **Family 无环**（需求 11.2 第 2 条）：随机生成的合法 family（fixture 保证无环）→ for each job in response, `parentJobId` 不在自身链路上。
- **`replanEvents` 类型纯净**（需求 11.2 第 3 条）：响应 `replanEvents` 全部 `type === "replan.triggered"`。
- **Family_Root 唯一**（需求 11.2 第 4 条）：响应 `jobs` 中**有且仅有**一个元素 `parentJobId === undefined`，且其 id === `rootJobId`。
- **只读性**（需求 11.2 第 5 条）：连续两次请求 → 响应 deep equality；调用前后 jobStore 中 family 内任一 job 的字段 deep equality。

#### Example tests

- family-of-one + replan in_place 后：响应 `jobs.length === 1`，`replanEvents.length >= 1`。
- parent + 1 branch：响应 `jobs.length === 2`，`replanEvents.length >= 1`（branch 创建时的 replan.triggered）。
- parent + 3 sibling branches：响应 `jobs.length === 4`，sibling 排序按 branchedAt 升序。
- parent + branch + re-branch（深度 2）：响应 `jobs.length === 3`，TreeNode `depth` 为 0 / 1 / 2。
- jobId 不存在 → 404 + `family.rejected` debug 日志。
- 构造性测试：手动构造 `parentJobId` 闭环的 fixture → 500 + `family_cycle_detected` + error 日志。
- jobStore 副作用验证：spy `jobStore.save` 未被调用。

### T2. Frontend 组件测试

- **VersionTreeView.test.tsx**：family-of-1 / parent+1 / parent+3 / 深度 2 各渲染一次，验证 DOM 结构。
- **TreeNode.test.tsx**：active 标记、stale 标记、branchedFromStage 文案、点击触发 onSwitchActive。
- **CompareView.test.tsx**：跨 family 拒绝渲染、stage 顺序、artifact 缺失展示 "—"、stale 标记。
- **ReplanTimelineView.test.tsx**：降序排列、空数组空态文案、reason 截断到 200 字符、不渲染 HTML（`<script>` 文本被转义）。
- **HistoryEntryPoint.test.tsx**：静态预览模式 disabled、点击 navigate 到 `?history=1`、replan / inline edit 成功后不自动打开。
- **use-family-data.test.ts**：loading / ok / error / static-preview 四态、cancel 卸载。
- **use-switch-active-job.test.ts**：跨 family 拒绝 + toast.error；同 family setActiveJobId + URL 更新；不调 spec 2 / spec 3 端点；不修改 backend job stage。

### T3. Fixtures

```typescript
// build-fixture-family.ts
export function buildFamilyOfOne(): BlueprintGenerationJob[] { ... }
export function buildParentPlusOne(): BlueprintGenerationJob[] { ... }
export function buildParentPlusN(n: number): BlueprintGenerationJob[] { ... }
export function buildDeepTree(depth: number): BlueprintGenerationJob[] { ... }
export function buildCyclicFamily(): BlueprintGenerationJob[] { ... }  // 用于 cycle 测试
```

`arbitraries.ts` 提供随机 family 生成器：先生成 root，再随机选已存在 job 作为 parent 创建新 branch；保证无环。

## 与需求的全量对照

| 需求 | 落地点 |
|---|---|
| 1.1–1.12（Family Endpoint） | C2 / C3 / C4 |
| 2.1–2.8（Switch Active 导航） | C9 |
| 3.1–3.9（Version Tree View） | C7 / C8 |
| 4.1–4.9（Compare View） | C10 |
| 5.1–5.8（Replan Timeline View） | C11 |
| 6.1–6.6（History Entry Point） | C12 |
| 7.1–7.5（与 spec 1 关系） | 仅读 staleSince / staleArtifactIds，零修改 |
| 8.1–8.7（与 spec 2 关系） | 不调 replan 端点；只读消费 Branch_Metadata 与 replan.triggered |
| 9.1–9.5（与 spec 3 关系） | 不调 spec 3 端点；不复用 spec 3 组件 |
| 10.1–10.4（与 spec 5 关系） | 不实现动画；spec 5 接管时机标 `TODO(spec-5-wiring)` |
| 11.1–11.8（测试覆盖） | T1 / T2 / T3 |
| 12.1–12.6（日志） | C4 |
| 13.1–13.9（向后兼容） | 全文未触及任一既有字段 / 既有路由（仅追加只读端点 + 可选类型） |
| 14.1–14.11（范围边界） | 设计层未引入 spec 1/2/3/5 范围内的代码 |

## 实施风险与对冲

| 风险 | 对冲 |
|---|---|
| family > 100 jobs 时 BFS 遍历 + jobs 数组排序的 O(n²) 风险 | 当前 jobStore 是 in-memory map，n ≤ 100 时实测 < 50ms；warn 阈值在 100；如未来超过 500 需引入 parent → children 索引 |
| `parentJobId` 指向不存在的 job（数据被 cleanup 删除） | C2 算法把它视为 cycle 路径的一种（无法上溯到 root），返回 500 + 错误码；前端降级单节点 |
| URL `?activeJob=<id>` 与 `?history=1` 共存时的解析冲突 | 双 query 互不影响；history=1 控制 modal 开关，activeJob 控制 store；route 解析层独立 |
| 前端 BlueprintFamilyError 在 type assertion 后还会运行 unknown body | error.body 类型 `unknown`，调用方 narrow 后再使用 |
| Compare_View 的 PRIMARY_ARTIFACT_TYPE_BY_STAGE 在某些 stage（如 spec_docs）选了 design，但 spec_docs 实际可能产出 requirements / design / tasks 三种 | design 选定 design 作为 spec_docs primary（用户视觉默认）；如未来要展开三种，由独立 spec 推进 |
| `jobs.list()` 顺序变化（spec 2 把 in_place 的 jobId 重写时 createdAt 可能与 branch 的 branchedAt 冲突） | 排序优先用 branchedAt；branchedAt 缺失时退化到 createdAt；tie-breaker 用 jobId 字典序 |
| socket 推送的 replan.triggered 没有自动追加到 ReplanTimelineView | 本 spec 不强制接 socket；spec 5 的 Coordination_Layer 接管时再补 |

## 下游 spec 的接线点位（不在本 spec 实施）

| 下游 spec | 接线 |
|---|---|
| spec 5（stage-state-coordination） | 把 `useSwitchActiveJob` 的 store 写入聚合到 `Atomic_Refresh_Mediator`；把 toast 调用改走 `Toast_Queue`；version-tree-view 切到不同 stage 的 job 时由 `Page_Transition_Choreographer` 接管动画 |
