# 合并 spec-docs 进度面板到 SPEC 树节点行（⑤ → ②）

> 单文件 spec（按既有"一份就够"口径）。Snapshot: 2026-05-29。
> 决策已拍板：Q1 = **A2（保留重试痕迹 ✓⚠，白盒透明）**，Q2 左侧图标，
> Q3 header 在搜索框下方，Q4 processing 一次性自动滚动，Q5 `3/3 修订`，
> Q6 双 background（cool-gray selection > cream processing）。

## 1. 为什么改

第二阶段（spec_tree / spec_documents）当前在右栏顶部飘着一个独立浮层
`SpecDocsProgressPanel`（testid `spec-docs-progress-panel`），列出 13 个节点的
✓✓ / ✗ / 处理中状态 + `13/13 已完成` 进度条 + 关闭按钮。

它和 `WorkbenchSpecTree` 列的是**同一批 13 个节点**，只是维度不同（一个是
状态、一个是结构）。同一份实体在同一屏列两遍，且浮层遮挡下方 tree / doc-main
内容。本次把进度状态**合并进 spec tree 节点行**，删除独立浮层。

> 本 spec 只做这一件事。①status-bar 三卡删除、②↔3D 双向联动、④execution-panel
> 下沉、节点↔角色活动指示，均不在本范围，留各自独立 spec。

## 2. 视觉契约（依据用户 mockup）

```
┌─────────────────────────────────┐
│ [搜索框]                        │  ← 既有，首行，不动
│ 节点 · 13                       │  ← 新增 header eyebrow，mono 11px #999
│                                 │
│  ✓  MiroFish 主路径             │  completed → 实心圆+白✓，fill #16A34A
│ ┌─────────────────────────────┐ │
│ │ ⟲ 仓库接入与归一化           │ │  processing → 3/4 弧+旋转，stroke #FF8A1A
│ │   3/3 修订                  │ │  行底 bg #FAF7F2 (cream)
│ └─────────────────────────────┘ │
│  ✓  选择执行器路由              │
│  ⊗  构建执行上下文              │  failed → 实心圆+白✗，fill #DC2626
│  ✓⚠ 派发角色代理（重试后成功）  │  retried-completed → 绿✓ + 右上角橙⚠ 角标
│  ○  待生成节点                  │  pending → 空心圆，stroke #999
└─────────────────────────────────┘
```

### 状态图标（24×24 stroked circle，行最左，Q2）

| 态 | 图形 | 颜色 | testid 后缀属性 |
| --- | --- | --- | --- |
| pending | 空心圆 | stroke `#999` | `data-status="pending"` |
| processing | 3/4 圆弧 + `animate-spin` | stroke `#FF8A1A` | `data-status="processing"` |
| completed | 实心圆 + 白 ✓ | fill `#16A34A` | `data-status="completed"` |
| failed | 实心圆 + 白 ✗ | fill `#DC2626` | `data-status="failed"` |
| **retried-completed**（Q1=A2） | 实心绿圆 + 白 ✓ + **右上角 8px 橙色 ⚠ 角标** | fill `#16A34A` + badge `#FF8A1A` | `data-status="completed" data-retried="true"` |

> Q1 白盒说明：节点中途 `node_failed` 后又被后端重排重试并 `node_completed`，
> 最终态是绿 ✓，但**保留一个橙色 ⚠ 角标**告诉用户"这个节点重试过"。
> 鼠标 hover 角标显示 `tooltip = errorSummary`（首次失败原因，如 "agent timeout"）。

### 行 background（Q6 双态，优先级 selection > processing）

| 行态 | bg | 说明 |
| --- | --- | --- |
| processing | `#FAF7F2` (warm cream) | 系统正在生成该节点 |
| selected（activeNodeId 命中） | `#F0F4F8` (cool gray) | 用户点击想读其文档 |
| processing **且** selected | `#F0F4F8`（cool gray 覆盖） | 用户意图优先 |
| 其它 | transparent / hover:`#F8FAFC` | 既有 hover 不变 |

### 排布

- 行内：`[status icon 24px][12px gap][title 列]`，外加既有的 chip / stale / generate 按钮保持在右侧
- 标题：font-display 16px medium，黑色（既有 11px bold 升级到 mockup 的 16px medium）
- 副标题 `3/3 修订`（Q5）：12px `#666`，**仅当该节点 generated 文档数 > 0 时**出现
- 卡片外壳保留既有 rounded-md（mockup 看着更圆，但本次不破例改 radius，避免和 mirofish token 打架）

### header（Q3）

`节点 · {specTree.nodes.length}`，渲染在**搜索框下方、tree roots 上方**，
mono 11px `#999` uppercase tracking，testid `autopilot-workbench-spec-tree-node-count`。

### 自动滚动（Q4）

当某节点 status 从非 processing **变成** processing 时，该行一次性
`scrollIntoView({ block: "nearest" })`。仅在状态跃迁那一刻触发一次，
不持续抢夺用户手动滚动位置。用 `useRef` 记录上一次每节点 status，
diff 出新晋 processing 节点才滚。

## 3. 数据连线

| 视觉 | 数据源 |
| --- | --- |
| 状态图标 | `useBlueprintRealtimeStore().specDocsProgress.nodes[nodeId].status` |
| 重试角标 ⚠ | `specDocsProgress.nodes[nodeId].wasRetried`（**本 spec 新增字段**） |
| 角标 tooltip | `specDocsProgress.nodes[nodeId].errorSummary`（已存在） |
| `节点 · N` | `specTree.nodes.length`（spec tree 结构，非 progress slice） |
| `3/3 修订` | `groupDocsByNodeId(specDocuments)[nodeId].length` / 该节点 doc 类型总数（既有 chip 派生复用） |
| 全局 `n/N` | 已在 `WorkbenchStatusBar` 的 `autopilot-workbench-stat-docs`，**本 spec 不动** |

### store 改动（A2 专属）

`SpecDocsNodeEntry` 增加可选字段：

```ts
export interface SpecDocsNodeEntry {
  nodeId: string;
  title: string;
  position: number;
  status: SpecDocsNodeStatus;
  errorSummary?: string;
  wasRetried?: boolean;   // ← 新增：曾经 failed 过（A2 白盒）
}
```

转移表放宽：允许 `failed → processing`（重试重新开始）。当
`node_started` 命中一个当前 status === "failed" 的节点时：
- 置 `status = "processing"`
- 置 `wasRetried = true`（永久保留，后续 completed 也不清）

`VALID_TRANSITIONS` 改：
```ts
pending:    ["processing"],
processing: ["completed", "failed"],
completed:  ["assembled"],
failed:     ["processing"],   // ← A2 新增：允许重试
assembled:  [],
```

`node_started` reducer：进入时若 `node.status === "failed"`，额外 set `wasRetried: true`。
`node_completed` reducer：保留 `wasRetried` 不变（spread `...node` 已覆盖，无需额外代码，但要加测试守护）。

## 4. 文件变更清单

| 文件 | 动作 |
| --- | --- |
| `client/src/lib/blueprint-realtime-store.ts` | `SpecDocsNodeEntry` 加 `wasRetried`；`VALID_TRANSITIONS.failed = ["processing"]`；`node_started` 在 failed→processing 时 set `wasRetried:true` |
| `client/src/pages/autopilot/right-rail/streaming-doc/workbench/WorkbenchSpecTree.tsx` | 主改：①新增 `节点·N` header ②每行注入 status icon（含 retried 角标）③副标题 `3/3 修订` ④双 bg ⑤一次性自动滚动；新增 `specDocsProgress` 订阅（通过 props 注入，保持组件无 store 依赖契约——见 §6） |
| `client/src/pages/autopilot/right-rail/spec-docs-progress/SpecDocsProgressPanel.tsx` | **整块删除** |
| `client/src/pages/autopilot/right-rail/spec-docs-progress/__tests__/SpecDocsProgressPanel.test.tsx` | **整文件删除** |
| `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` | 移除 `<SpecDocsProgressPanel/>` 挂载；把 `specDocsProgress.nodes` 作为新 prop `nodeStatusById` 传给 StreamingDocRenderer → workbench → WorkbenchSpecTree |
| `client/src/pages/autopilot/right-rail/streaming-doc/workbench/__tests__/WorkbenchSpecTree.node-status.test.tsx` | **新建**，约 9 个 SSR / PBT 契约 |
| 不动 | `blueprint-realtime-store` 的 spec-docs `dismissSpecDocsProgress` / `completeSpecDocsProgress` action 保留（虽不再有 dismiss 按钮，但 store API 不破坏）；`spec-docs-progress-store.property.test.ts`（25）/`spec-docs-progress-assembled.test.ts`（5）原样保留 |

## 5. testid 变更

**新增**：
- `autopilot-workbench-spec-tree-node-count` — `节点 · N` header
- `autopilot-workbench-spec-tree-status-{nodeId}` — 每行状态图标（带 `data-status` / `data-retried`）
- `autopilot-workbench-spec-tree-doc-count-{nodeId}` — `3/3 修订` 副标题（仅 generated>0）

**删除**：
- `spec-docs-progress-panel`
- `status-completed` / `status-processing` / `status-failed`（聚合层 → 迁到每节点）
- `batch-summary`
- `dismiss-btn`

**保留不变**：所有现有 `autopilot-workbench-spec-tree-*`（search / roots / node-{id} /
label-{id} / toggle-{id} / generate-{id} / doc-{docId} / chip-{id} / empty）。

## 6. 组件无 store 依赖契约

`WorkbenchSpecTree` 现在是纯 props 组件（`WorkbenchSpecTreeView` 完全无 hooks，
便于 SSR 测试）。为保持这一契约，**不在 WorkbenchSpecTree 内部直接调
`useBlueprintRealtimeStore`**，而是：

1. `AutopilotRightRail`（已经订阅 store）把 `specDocsProgress.nodes` 派生成一个
   plain `Record<nodeId, { status, wasRetried, errorSummary }>`
2. 通过新 prop `nodeStatusById` 逐层透传：RightRail → StreamingDocRenderer →
   AutopilotSpecDocumentsWorkbench → WorkbenchSpecTree → WorkbenchSpecTreeView
3. `WorkbenchSpecTreeView` 只读 prop，零 store 依赖，SSR 测试可直接注入 fixture

### 6.1 双源派生（refresh 持久化修复 + stale 守门）

`specDocsProgress` 是浏览器内存里的活跃态浮层，刷新页面后会回到 `idle` /
空 `nodes`。如果只用它做 `nodeStatusById`，刷新后所有已生成节点会回退成
`pending` 空心圆，`✓` 全部丢失。同样棘手的对称问题：上一轮「全部生成」如果
中途丢了 `batch_finished`（用户刷新、socket 闪断、event 被合并丢弃），父节点
的 `processing` 残留会**永远**留在内存里；下次用户点子节点单独生成时（单节点
请求路径不发任何 progress 事件），父节点会无端转圈，子节点反而无声。

修复：把 `nodeStatusById` 派生从单源改成双源合并 + `batchStatus` 守门，由纯函数
`deriveNodeStatusById({ persistedSpecDocuments, liveProgressNodes, liveBatchStatus })`
完成：

| 优先级 | 来源 | 行为 |
| --- | --- | --- |
| 1（兜底基线） | `job.artifacts` 中的 `requirements / design / tasks` | 任意节点存在至少一份持久化文档 → baseline `completed` |
| 2.a（活跃覆盖） | `specDocsProgress.nodes`（`batchStatus ∈ {running, assembling}`） | 全部 4 态 + `assembled→completed` 都覆盖 baseline |
| 2.b（终态覆盖） | `specDocsProgress.nodes`（`batchStatus ∈ {idle, finished}`） | 只允许终态（`completed` / `failed` / `assembled`）覆盖；非终态 `pending` / `processing` 视为残留，丢弃 |
| 3（兜底兜底） | 无 | view 层渲染 `pending` 空心圆 |

效果：
- 刷新页面后，已落盘节点立刻显示绿 ✓（不再误判为 pending）；
- 重新生成已存在文档时，`batchStatus = running`，live `processing` 覆盖
  baseline，行为正在发生；
- 上一轮没收尾的 stale `processing` 在 `batchStatus = idle / finished` 下
  被过滤，父节点不会因 stale 漏出而误转；
- 终态保留覆盖：`failed` 节点没有持久化文档兜底，丢掉它会看不出失败；
- retry 痕迹（`wasRetried`）只在 live 切片里，自然只在 retry 路径中出现。

容器层（`AutopilotRightRail` / `WorkbenchFixturePage`）通过同一个纯函数
`deriveNodeStatusById` 保证语义一致；helper 落在
`right-rail/spec-docs-progress/derive-node-status-by-id.ts`，配套 13 个
unit case + 2 个 PBT。

## 7. 验收标准

| # | 行为 | 期望 |
| --- | --- | --- |
| 1 | store idle | tree 所有节点 pending 空心圆，无 cream 行 |
| 2 | `batch_init` + 3×`node_started` | 3 行 processing（橙旋转）+ cream bg，其余 pending |
| 3 | `node_completed` | 该行绿实心 ✓，cream 消失 |
| 4 | `node_failed` | 该行红实心 ⊗ |
| 5 | failed 节点收到二次 `node_started` 再 `node_completed`（A2） | 最终绿 ✓ + 橙 ⚠ 角标，`data-retried="true"`，hover 显示原 errorSummary |
| 6 | 用户点 pending 行 | cool-gray bg + doc-main 切到该节点；processing 行 cream 不变 |
| 7 | 同时 processing + selected | cool-gray 覆盖 cream |
| 8 | `batch_finished` | 各节点保持最终态（混合 fail/retried 各自显示） |
| 9 | DOM `spec-docs-progress-panel` | **不存在** |
| 10 | DOM `dismiss-btn` | **不存在** |
| 11 | 每节点 `autopilot-workbench-spec-tree-status-{id}` | 存在，`data-status` 正确 |
| 12 | `节点 · N` | N == `specTree.nodes.length` |
| 13 | 副标题 `3/3 修订` | 仅 generated>0 出现 |
| 14 | 新晋 processing 节点 | 一次性 scrollIntoView，不持续抢滚动 |
| 15 | 刷新页面后已落盘节点（job.artifacts 含其 requirements/design/tasks） | 仍渲染绿 ✓（status="completed"），不退回 pending |
| 16 | 刷新后立即触发重新生成已落盘节点 | live `processing` 覆盖持久化 baseline，行渲染橙弧旋转 |
| 17 | 上一轮「全部生成」漏掉 `batch_finished`，父节点残留 `processing` + `batchStatus = idle/finished` | 父行渲染绿 ✓（持久化 baseline），不因 stale 漏出而误转 |

## 8. 测试计划

**删除**：`SpecDocsProgressPanel.test.tsx`（10 case）

**新增** `WorkbenchSpecTree.node-status.test.tsx`（约 9 SSR case）：
1. 4 种状态图标 testid + data-status 正确
2. retried-completed 显示绿✓+⚠ 角标 + data-retried="true"
3. processing 行含 `bg-[#FAF7F2]`
4. selected 行含 `bg-[#F0F4F8]`
5. processing+selected → cool gray 覆盖
6. 副标题仅 generated>0 显示
7. `节点·N` 数字 == nodes.length
8. nodeStatusById 缺某节点时该行回退 pending（容错）
9. PBT：随机 13 节点 4 态混合，渲染状态图标数 == 节点数

**新增 store 测试**（并入既有 `spec-docs-progress-store.property.test.ts` 或单开）：
- `failed → processing` 转移合法
- 重试后 `wasRetried` 永久为 true，completed 不清除

**保留 0 改动**：`spec-docs-progress-store.property.test.ts`（25）/
`spec-docs-progress-assembled.test.ts`（5）—— 仅放宽转移表，需确认这两组不
依赖 "failed 是终态" 的断言（若依赖，按 A2 语义更新该断言并在 commit 注明）。

## 8.5 Playwright 端到端验收（强制门槛）

SSR 单测覆盖渲染契约，但**状态跃迁是 socket 驱动的**，只有真浏览器跑真 job
才能验证"节点行随后端事件实时变色"这条主链路。本节是本 spec 的**合并前强制
门槛**，脚本落在 `.tmp/`（throwaway，不进源码树）。

### 脚本：`.tmp/spec-tree-progress-e2e.mjs`

运行环境（前置，由人工保证）：
- 前端 `http://localhost:3000`、后端 `http://localhost:3001` 已起
- Playwright channel `chrome`，viewport **1920×1080**（与既有 e2e 脚本一致）
- 登录走既有 `e2e-smoke@cube-pets.local` 账号自举（login→register→login 回退）

### 步骤与断言

| 步 | 动作 | Playwright 断言 |
| --- | --- | --- |
| P1 | 登录 + 选一个 latest job 处于 spec_docs / spec_tree 的项目，打开 `/autopilot?projectId=…` | `autopilot-workbench-spec-tree` 可见 |
| P2 | 等右栏渲染 | DOM **不含** `spec-docs-progress-panel`；**不含** `dismiss-btn`（§7 验收 9/10） |
| P3 | 读 `autopilot-workbench-spec-tree-node-count` 文本 | == `节点 · {N}`，N 与 `/api/blueprint/jobs/:id` 返回的 `specTree.nodes.length` 一致（§7-12） |
| P4 | 截图基线 `01-tree-initial.png`（fullPage，1920×1080） | 每个节点都有 `autopilot-workbench-spec-tree-status-{nodeId}`（§7-11） |
| P5 | 触发一次 `POST /api/blueprint/jobs/:id/spec-documents`（或点"生成全部"），让后端真发 `node_started`/`node_completed`/`node_failed` 事件 | 轮询：至少 1 个节点 `data-status="processing"` 出现过（断言 processing 态被 socket 点亮）；该行 class 含 `bg-[#FAF7F2]`（§7-2/3） |
| P6 | 等 `batch_finished` | 所有节点 `data-status ∈ {completed, failed}`；截图 `02-tree-finished.png` |
| P7 | **A2 白盒验证**：若本轮 job 出现过 `node_failed` 后重试成功（日志里见过 "agent timeout"），找到该节点 | 该行 `data-status="completed"` **且** `data-retried="true"`；存在 ⚠ 角标元素；hover 角标 tooltip 文本含原 errorSummary（§7-5） |
| P8 | 点一个非 processing 节点行 | 该行 class 含 `bg-[#F0F4F8]`（cool gray）；`autopilot-workbench-doc-main` 切到该节点文档（§7-6） |
| P9 | 构造 processing+selected 同行（点一个正在 processing 的行） | class 含 cool-gray、**不含** cream（§7-7，cool gray 覆盖） |
| P10 | 截图 `03-tree-selected.png` 交付人工核对配色 / 角标位置 / 图标形状 | 人工目检 mockup 一致性 |
| P12 | 刷新页面（`page.reload()`） | 每个 fixture 节点 `data-status="completed"`（依赖 `FIXTURE_SPEC_DOCUMENTS` 持久化基线）；`specDocsProgress` 已被 reset 但 ✓ 不丢 |
| P13 | 注入 stale `processing` 残留（`batch_init` + `node_started` 后通过 DEV `setBatchStatus("idle")` 模拟没收到 `batch_finished`） | 该行 `data-status="completed"`（持久化 baseline 兜底），不因 stale 漏出而误转 |

### 产物

- `.tmp/spec-tree-progress-e2e/01-tree-initial.png` / `02-tree-finished.png` / `03-tree-selected.png` / `04-tree-after-reload.png` / `05-tree-stale-guard.png`（1920×1080）
- `.tmp/spec-tree-progress-e2e/events.jsonl`（socket / api 事件流，供回溯哪些节点真的 processing→completed 过）
- `.tmp/spec-tree-progress-e2e/node-status-snapshot.json`（最终每节点 data-status / data-retried 快照）

### 门槛判定

- **P2 / P3 / P5 / P6 / P11(status testid) / P12(refresh persistence) / P13(stale-guard)** 是**自动断言**，任一失败则本 spec 不合并。
- **P7（A2 白盒）** 若本轮 job 未自然产生重试，用一个**强制失败注入**的兜底 job（脚本里对某节点先打 `node_failed` 再 `node_started`+`node_completed` 的本地事件回放）来覆盖，确保 ✓⚠ 路径一定被走到。
- **P4 / P6 / P10** 截图是**人工目检**项，交付时附在审阅说明里，不作自动 gate。

> 注：前几轮 e2e 已证明本 dev 环境 `AUTOPILOT_REAL_RUNTIME=true` + 自动驾驶会
> 把 job 一路冲过 spec_docs。若 P1 选不到停在 spec_docs 的 job，脚本回退到
> **socket 事件本地回放**模式：用 `useBlueprintRealtimeStore.__setSocket` 的测试
> 注入口（已存在，PBT 在用）在浏览器里直接 dispatch `batch_init`→`node_started`
> →`node_failed`→`node_started`→`node_completed`→`batch_finished` 一整套，
> 确保 5 种状态 + retried 路径都被渲染验证到，不依赖真 LLM 时序。

## 9. 执行顺序（一个一个改）

1. **store**：加 `wasRetried` + 放宽转移表 + node_started 标记 → 跑 store 测试
2. **prop 通道**：RightRail 派生 `nodeStatusById` 并逐层透传（先不渲染，确保类型通）
3. **WorkbenchSpecTree**：header + status icon + 副标题 + 双 bg + 自动滚动
4. **删除** SpecDocsProgressPanel + 其测试 + RightRail 挂载点
5. **新建** node-status SSR / PBT 测试（§8）
6. **Playwright e2e**（§8.5）：写 `.tmp/spec-tree-progress-e2e.mjs`，跑通 P1–P10，
   产出 3 张 1920×1080 截图 + 事件流 + 状态快照
7. 全量受影响单测 + `getDiagnostics` 全绿，Playwright 自动断言项（P2/P3/P5/P6/P11）
   全过、A2 白盒（P7）走到，**不 commit**，把 3 张截图随交付说明附上等审阅

预计净变更：删 ~250 行（panel）+ 新增 ~150 行（tree row + store + 测试）= 净 -100 行。
（`.tmp/` 下的 e2e 脚本与截图不计入源码净变更。）
