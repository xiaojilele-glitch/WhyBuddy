# 需求文档：Autopilot Stage Version History

## 简介

本 spec 是 WhyBuddy autopilot blueprint 流"返回 / 重新规划 / 内联编辑"生命周期 5 个 spec 系列中的**第四个**，负责把前三份 spec 留下来但未对用户暴露的 job 家族数据浮到 UI 层：版本树、parent / branch 切换、跨 job 比较、replan 时间线。

系列概览：

- **spec 1 — `autopilot-asset-staleness-model`**：在仓库中目前**仅为需求文档**，尚未落地代码。定义 `staleSince` / `invalidatedBy` / `staleArtifactIds` 字段、`BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 依赖图、纯函数 `invalidateDownstream(job, fromStage, options)`、只读端点 `GET /api/blueprint/jobs/:jobId/stale-artifacts`，并通过 fast-check 验证幂等性与单调性。
- **spec 2 — `autopilot-replan-and-branch-action`**：在仓库中目前**仅为需求文档**。承载显式 replan：右栏 stage divider 处的"从这里重新规划"按钮、`POST /api/blueprint/jobs/:jobId/replan`、`mode = "in_place" | "branch"`、`replan.triggered` 事件、Branch_Metadata（`parentJobId` / `branchedAt` / `branchedFromStage`）写入、前端 Branch_Index（`parentJobId → [branchJobId, ...]`）维护。spec 2 显式约束 Branch_Index **不**对 UI 层暴露（spec 2 §9.4），将 UI 暴露权全部交给 spec 4。
- **spec 3 — `autopilot-stage-edit-mode`**：在仓库中目前**仅为需求文档**。viewing-completed 模式下上游字段就地编辑、调用既有 modify 端点、自动经 spec 1 引擎使下游 stale；隐式意图通路；不创建分支、不写 `replan.triggered`。
- **spec 4 — `autopilot-stage-version-history`（本 spec）**：消费 spec 1 / spec 2 / spec 3 的全部既有数据（Branch_Metadata、Branch_Index、`replan.triggered` 事件、`staleSince` / `staleArtifactIds`），实现版本树视图、parent / branch / sibling 之间的 active job 切换、双 job 比较视图、replan 时间线视图，以及一个新增**只读** family 端点 `GET /api/blueprint/jobs/:jobId/family`。spec 4 是消费方而非生产方，不创建 / 修改 / 删除任何 job、不修改 spec 1 / 2 / 3 的任一既有路由 / 字段 / 组件。
- **spec 5 — `autopilot-stage-state-coordination`**（尚未创建）：stage transition 动画、跨组件原子刷新、toast 序列协调、页面 3→2→1 视觉过渡。spec 4 的版本树切换会触发 active job 变化，相关视觉过渡由 spec 5 负责。

> **重要前置假设**：本 spec **假设 spec 1 / spec 2 先于本 spec 落地**。本 spec 在需求层把 spec 1 的 staleness 字段与引擎、spec 2 的 Branch_Metadata 与 `replan.triggered` 事件、spec 3 的 inline edit 路径都视为"将要存在的字段 / 端点 / 组件"使用，但 SHALL NOT 主张它们已经在仓库代码中落地。如果 spec 4 实施时 spec 1 / spec 2 仍未落地，本 spec 的实施可临时桩接其字段与端点，但合并到主线时仍须以 spec 1 / spec 2 已落地为前提。spec 3 不是 spec 4 的硬依赖（spec 4 仅在 stale badge 渲染上消费 spec 3 的视图能力，没有 spec 3 时 spec 4 仍可只渲染 stale 文字）。

本 spec 引用的产品时序源是 `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md`（含页面 3→2→1 返回时序与 replan 分支语义）。

本 spec 与系列其他 spec 的边界：

- **消费数据，不修改数据**：spec 4 仅读取 spec 1 / spec 2 / spec 3 写入的状态，SHALL NOT 通过任一路径修改 job、artifact、stale marker、Branch_Metadata 或 events。
- **新增唯一端点**：本 spec 新增 `GET /api/blueprint/jobs/:jobId/family` 一条只读端点，SHALL NOT 新增任一 PATCH / POST / DELETE 端点。
- **不引入新事件家族**：replan 时间线消费 spec 2 已写入的 `replan.triggered`，stale 信号消费 spec 1 已写入的 `staleSince` / `invalidatedBy`，不引入新的 BlueprintEvent / socket channel。
- **opt-in UI**：版本历史界面不在 replan 后自动打开；用户经显式入口（如右栏 history 触点或 URL）进入。

**不在本 spec 范围内**（已由其他 sibling spec 承担或显式排除）：

- 创建 branch / 触发 replan → **spec 2**；
- 修改 staleness 字段 / 调用 invalidation 引擎 → **spec 1**；
- 字段级 inline edit → **spec 3**；
- stage 切换动画、跨组件原子刷新、toast 序列编排、页面 3→2→1 视觉过渡 → **spec 5**；
- 删除 / 归档 / 修剪 branch job、合并 branch 到 parent、把 branch "promote" 为主线、跨 family 关联两棵不相关的树；
- artifact payload 内容级 diff（如 spec_documents markdown 行级对比、spec_tree node 内容字段对比、effect_preview html diff）——本 spec 仅做"存在 / 不存在 / fresh / stale / 生成时间"层面的对比，不做内容 diff；
- 任何 backend mutation：`PATCH` / `POST` / `DELETE` 任一既有 job 状态；
- 修改 `MissionAutopilotSummary` / `mission-projection` / `tasks-store` / Office Cockpit / Web-AIGC runtime / autopilot 节点 11 阶段任一既有能力。

本 spec 属于 Feature 类型，requirements-first 工作流。

## 术语表

- **Job_Family**：一组通过 `parentJobId` 链路相连的 `BlueprintGenerationJob` 集合，含一个唯一的 Family_Root 与 0 个或多个传递分支 job。一个 family 是无环树（tree）而非链（chain）（沿用 spec 2 需求 10.2 第 4 条性质）。
- **Family_Root**：family 中**唯一**满足 `parentJobId === undefined` 的 job；其 `jobId` 即 family 的稳定标识。
- **Family_Endpoint**：本 spec 新增的只读路由 `GET /api/blueprint/jobs/:jobId/family`，给定 family 中任一 jobId 返回完整 family 的 jobs 数组、root jobId 与 replan 时间线。
- **Family_Response**：Family_Endpoint 的成功响应体，形态为 `{ rootJobId: string, jobs: BlueprintGenerationJob[], replanEvents: BlueprintEvent[] }`。
- **Version_Tree_View**：前端组件，把 family 渲染为可视化的 parent → branch 树状结构；每个 Tree_Node 展示该 job 的 jobId 短标识、`branchedFromStage`（仅 branch）、`branchedAt`（仅 branch）、当前 stage、status、active 标记、stale 标记。
- **Tree_Node**：Version_Tree_View 中代表单个 job 的可视元素；点击或激活后触发导航语义（详见 Switch_Active）。
- **Compare_View**：双窗格只读对比视图，左 / 右两侧分别展示 family 中两个 job（`jobA` / `jobB`）在每个 stage 的主 artifact 存在性、stale 状态、最近生成时间。
- **Replan_Timeline_View**：跨整个 family 按时间排序的 `replan.triggered` 事件列表视图（顺序：最新在上，旧在下）。
- **Active_Job**：前端 job store 中当前用户正在交互的 job 引用（沿用 spec 2 术语表）。spec 4 通过 Switch_Active 语义改写该引用。
- **Branch_Index**：前端 job store 中维护的 `parentJobId → [branchJobId, ...]` 映射（沿用 spec 2 术语表）。spec 4 是 Branch_Index 在 UI 层的**唯一**消费方。
- **Switch_Active**：spec 4 定义的导航语义——用户点击 Tree_Node 或选择"切换到该分支"时，把 Active_Job 引用切换为该 jobId。Switch_Active 是 spec 4 在前端 store 上唯一允许触发的写动作；spec 5 落地前可直接写 Active_Job、Sub_Stage_Pin、Workflow_Stage_Override 与 URL，spec 5 落地后 SHALL 通过 Coordination_Layer 原子提交这些前端状态写入；任一路径均不写任一 job 字段。
- **Sub_Stage_Pin / Workflow_Stage_Override**：前端导航状态变量（沿用 spec 2 术语表）。Switch_Active 后这两个字段的处置规则见需求 2。
- **History_Entry_Point**：用户进入 Version_Tree_View 的显式触点（如右栏顶部 history 图标或 `/autopilot/...?history=1` query 参数）。本 spec 不约束触点的具体位置，只约束"必须显式、不得在 replan 后自动弹出"。
- **Read_Only_Surface**：spec 4 暴露的全部前端组件与后端端点统称；仅消费已有数据，不写。
- **Static_Preview_Mode**：通过 `npm run build:pages` 生成的 GitHub Pages 纯前端预览运行环境，没有可用的后端 modify 端点，也没有 Family_Endpoint。

## 需求

### 需求 1：Family_Endpoint 契约

**用户故事：** 作为前端开发者，我希望有一个稳定的只读端点，给我一个 jobId 就能拿回它所属 family 的全部 job 与 replan 时间线，让前端不必维护跨 job 的复杂往返调用。

#### 验收标准

1.1 THE Server_Blueprint_Module SHALL 新增路由 `GET /api/blueprint/jobs/:jobId/family`；该路由是本 spec 新增的**唯一**端点；SHALL NOT 在本 spec 内新增 `POST` / `PATCH` / `DELETE` 端点。

1.2 IF `jobId` 在 In_Memory_Job_Store 中不存在，THEN THE Family_Endpoint SHALL 在 200ms 内返回 HTTP 404 + `{ "error": "job_not_found" }`，与既有 blueprint 路由 404 风格一致。

1.3 WHEN `jobId` 存在，THE Family_Endpoint SHALL 返回 HTTP 200 + Family_Response，形态为：

```json
{
  "rootJobId": "<string>",
  "jobs": [ "<BlueprintGenerationJob>", "..." ],
  "replanEvents": [ "<BlueprintEvent>", "..." ]
}
```

`rootJobId` SHALL 等于 `jobs` 数组中**唯一**满足 `parentJobId === undefined` 的 job 的 `jobId`。

1.4 THE `jobs` 数组 SHALL 包含 family 中的全部 job，去重后元素总数 ≥ 1；至少包含请求中传入的 jobId 对应的 job 与 Family_Root；其顺序由 design 阶段对齐（建议按 `branchedAt` 升序、Family_Root 排首位）。

1.5 IF 给定的 jobId 没有 `parentJobId` 也不在任一 Branch_Index 条目的 value 列表中（即 family-of-one 场景），THEN THE Family_Endpoint SHALL 返回单元素 `jobs` 数组（只包含该 job）、`rootJobId` 等于该 jobId、`replanEvents` 为空数组（除非该 job 自身曾经历过 in_place replan，含 `replan.triggered` 事件）。

1.6 THE `replanEvents` 数组 SHALL 仅包含 `type === "replan.triggered"` 的事件；SHALL NOT 包含其他事件类型；SHALL 跨 family 中所有 job 的 `events` 数组合并；SHALL 按 `triggeredAt` 升序或降序排序，由 design 阶段对齐选定一种并明确（建议升序）。

1.7 THE Family_Endpoint SHALL 是**纯读**：调用前后 In_Memory_Job_Store 中任一 job 的 `events` / `staleArtifactIds` / `stage` / `status` / `artifacts` / Branch_Metadata 字段 SHALL 不发生任何变化（可通过对调用前后 deep snapshot 取 deep equality 验证）。

1.8 IF Family_Endpoint 在内部组装 family 时检测到环（即 `parentJobId` 链路存在闭环），THEN THE Family_Endpoint SHALL 返回 HTTP 500 + `{ "error": "family_cycle_detected", "jobId": "<string>" }`，并通过既有 logger 输出 `error` 级日志；SHALL NOT 返回部分组装的 family。本场景理论上由 spec 2 的 branch 创建语义保证不发生（spec 2 需求 10.2 第 4 条性质要求 tree 而非 chain），spec 4 仅作防御处理。

1.9 THE Family_Endpoint SHALL 沿用既有 blueprint 路由的鉴权策略、错误处理形态、入参解析方式；SHALL NOT 引入新的鉴权字段、新的限流策略、新的中间件。

1.10 THE Family_Endpoint SHALL NOT 触发 LLM 调用、Docker 调用、MCP 调用或其他外部副作用；其全部副作用仅限于读取 In_Memory_Job_Store 与日志输出。

1.11 THE Family_Endpoint SHALL NOT 修改 `shared/blueprint/contracts.ts` 中由 spec 1 / spec 2 引入或既有的任一字段；本 spec 仅追加 `BlueprintFamilyResponse` 类型导出，且该类型由 jobs 与 replanEvents 两个既有类型组合而成，不引入新字段。

1.12 IF family 规模超过 design 阶段确定的上限（例如 100 个 job），THEN THE Family_Endpoint SHALL 仍返回 200 与完整 family（family-of-100 不属于异常路径）；本 spec 不对 family 规模设硬上限，但 design 阶段 SHALL 评估 100+ 规模下的响应时间并给出 warn 级日志阈值。

### 需求 2：Switch_Active 导航语义

**用户故事：** 作为产品用户，我希望在版本树里点一下另一个分支的 jobId 就能切到那条分支上继续看产物或工作，并且我刷新页面后还能停在同一条分支上，不会跳回根 job。

#### 验收标准

2.1 WHEN 用户在 Version_Tree_View 中通过点击或键盘激活某个 Tree_Node，THE Frontend SHALL 在 100ms 内执行 Switch_Active：把前端 job store 的 Active_Job 引用切换为该 Tree_Node 对应的 jobId；保留 family 中其他 job 在 store 内不删除；SHALL NOT 修改任一 job 的字段（包括但不限于 `events` / `staleArtifactIds` / `stage` / `status` / `artifacts` / Branch_Metadata）。

2.2 WHEN Switch_Active 完成，THE Frontend SHALL 清除 Sub_Stage_Pin、把 Workflow_Stage_Override 写入新 Active_Job 的当前 `stage` 字段；在 spec 5 尚未落地时可通过既有 `resetPin()` / `setWorkflowStageOverride()` 完成，在 spec 5 落地后 SHALL 通过 Coordination_Layer 一次性提交；SHALL NOT 把 Workflow_Stage_Override 写入 family 中其他 job 的 stage（避免误用相邻 job 的 stage）。

2.3 WHEN Switch_Active 完成，THE Frontend SHALL 更新 URL 以反映新 Active_Job 的 jobId（具体 URL 形态由 design 阶段对齐，建议 `?activeJob=<jobId>` 或 path-based）；URL 更新 SHALL 通过既有路由机制（非 full reload）；spec 5 落地后该 URL 更新 SHALL 与 Active_Job / Sub_Stage_Pin / Workflow_Stage_Override 写入处于同一次 Coordination_Submission 中；用户刷新页面后 SHALL 重新落地到该 Active_Job。

2.4 WHEN 用户首次进入 Version_Tree_View 而 URL 上未携带 active job 参数，THE Frontend SHALL 把当前 store 中的 Active_Job 视为默认（即不强制改写 Active_Job）；SHALL 在 Tree_Node 渲染中以 active 标记标识当前 Active_Job 对应的节点。

2.5 IF 用户在 Version_Tree_View 中尝试切换到一个不在当前 family 中的 jobId（例如手工改 URL），THEN THE Frontend SHALL NOT 切换 Active_Job、SHALL 在视图上提示"该任务不在当前家族中"或等效语义；SHALL NOT 抛 schema 校验异常或导致页面崩溃。

2.6 WHILE 当前 Active_Job 处于 `running` 状态（即后端正在生成下一段产物），THE Switch_Active SHALL 仍可执行——切到另一 job 不应中断 running job 的后端生成；该 running job 在被切走后继续在 store 中保持其 status 与 events 同步；用户切回时 SHALL 看到最新状态。

2.7 THE Switch_Active SHALL NOT 触发 spec 2 的 Replan_Endpoint、SHALL NOT 触发 spec 3 的 inline edit Modify_Endpoints、SHALL NOT 调用任一 job mutation API；它**只**改写前端导航状态（Active_Job / Sub_Stage_Pin / Workflow_Stage_Override / URL），并且在 spec 5 落地后 SHALL 通过 Coordination_Layer 改写这些状态。

2.8 WHEN Switch_Active 触发，IF 新 Active_Job 的本地 store 副本尚未从后端拉取过最新 job 形态，THEN THE Frontend SHALL 通过既有 `GET /api/blueprint/jobs/:jobId` 端点拉取最新 job；该拉取 SHALL 是只读、SHALL NOT 修改任何后端状态。

### 需求 3：Version_Tree_View 渲染契约

**用户故事：** 作为产品用户，我希望在一个紧凑的视图里看到当前 family 的全貌：哪个是根，哪些是分支，每个 job 的进度到哪、有没有下游过期、谁是当前激活的那一条。

#### 验收标准

3.1 THE Version_Tree_View SHALL 基于 Family_Response 渲染整棵树；Family_Root 在视觉上排在最上方或最左侧（由 design 阶段对齐，建议从上至下展开，root 在顶端）；branch 沿 `parentJobId` 关系连接到其父节点；同一 parent 的多个 branch（sibling）SHALL 横向并排或按 `branchedAt` 顺序排列，避免视觉重叠。

3.2 每个 Tree_Node SHALL 至少展示以下字段：(a) jobId 短标识（前 8 位或等效短哈希）；(b) 当前 `stage`（中文名）；(c) `status`（沿用既有 BlueprintGenerationJob.status 取值，如 pending / running / completed / failed）；(d) Family_Root 标记或 branch 标记（branch 节点 SHALL 显示 `branchedFromStage` 与 `branchedAt`）；(e) active 标记（与当前 Active_Job 一致时高亮）；(f) stale 标记（当 `staleArtifactIds.length > 0` 时显示与 spec 1 / spec 3 视觉一致的"已过期"小标）。

3.3 THE Tree_Node SHALL 是可点击 / 可键盘激活的元素（即可达性合规：`role="button"` 或等效语义）；点击 / `Enter` / `Space` 触发 Switch_Active（需求 2）。

3.4 WHEN 用户 hover / focus 在 Tree_Node 上，THE Version_Tree_View SHALL 通过既有 tooltip 机制显示完整 jobId、完整 `branchedAt`（ISO 8601 本地化时间）、完整 stage 名；tooltip 文案 SHALL NOT 包含 reason 原文或任何敏感字段。

3.5 THE Version_Tree_View SHALL NOT 引入新的图可视化库（如 d3 / cytoscape / react-flow 等）；它 SHALL 使用既有 CSS / Tailwind / SVG 原语实现树形布局；如必须引入新依赖，SHALL 在 design 阶段提出并由用户决策。

3.6 IF Family_Response 失败获取（网络错误 / 后端 5xx / 超时），THEN THE Version_Tree_View SHALL 显示文案"无法加载版本历史"并保留一个"重试"按钮；SHALL NOT 整页崩溃、SHALL NOT 阻塞 family 之外的导航。

3.7 IF 当前运行处于 Static_Preview_Mode，THEN THE Version_Tree_View SHALL 显示等效"静态预览模式不支持版本历史"或"仅当前任务"的语义文案，并在 store 中以单元素 family（仅含当前 Active_Job）渲染单节点视图；SHALL NOT 抛 schema 校验异常或路由跳转。

3.8 THE Version_Tree_View SHALL NOT 提供任一 job mutation 控件（删除 / 重命名 / 标记 / 复制 / 合并等）；本视图仅承担可视化与导航职责（mutation 由 spec 2 承担）。

3.9 THE Version_Tree_View 的 Tree_Node 在视觉上 SHALL 与 spec 2 / spec 3 中的 stale 标记保持视觉一致（同一种黄色 / 警告色 token），方便用户跨视图对照同一个 stale 语义。

### 需求 4：Compare_View 契约

**用户故事：** 作为产品用户，当我有 parent 和 branch 两条 job，我希望并排看看它们在每个 stage 上各自有什么产物、谁更新、谁过期，方便决定继续在哪条上走。

#### 验收标准

4.1 THE Compare_View SHALL 是双窗格只读视图，左侧承载 `jobA`、右侧承载 `jobB`；用户从 Version_Tree_View 选择两个 Tree_Node 进入 Compare_View（具体入口由 design 阶段对齐，例如多选 + "比较"按钮，或在 Tree_Node 上的 context menu）。

4.2 THE Compare_View SHALL 仅接受同一 family 内的两个 job；IF 用户尝试比较跨 family 的两个 job，THEN THE Compare_View SHALL NOT 渲染、SHALL 显示文案"两个任务不属于同一家族"或等效语义。

4.3 THE Compare_View SHALL 按 `BlueprintGenerationStage` 的标准顺序枚举每个 stage，并在左 / 右窗格各自渲染该 stage 的"主 artifact"概览（具体每个 stage 取哪个 artifact 作为"主 artifact"由 design 阶段对齐既有 stage → primary artifact 映射，如 `route_generation → routeSelection`）。

4.4 每个 stage 的左 / 右单元 SHALL 至少展示：(a) 主 artifact 是否存在（用 ✓ / — 或等效图标）；(b) stale 标记（当该 artifact 的 `staleSince` 非空时显示）；(c) `createdAt` / `updatedAt` 之类的最近生成时间戳（如既有 artifact 字段不携带此值，则取 `BlueprintGenerationJob.events` 中关联生成事件的时间戳，由 design 阶段对齐）。

4.5 THE Compare_View SHALL NOT 实现 artifact payload 内容级 diff：SHALL NOT 对 spec_documents markdown 行级对比、SHALL NOT 对 spec_tree node 内容字段对比、SHALL NOT 对 prompt_packages 文本 diff、SHALL NOT 对 effect_preview html / svg diff。本视图只表达"存在 / 缺失 / fresh / stale / 时间戳"层面的差异。

4.6 THE Compare_View SHALL 是只读的；SHALL NOT 提供"把右侧覆盖到左侧"、"合并 branch 到 parent"、"删除某条 branch" 或任一 mutation 控件。

4.7 IF 任一被比较 job 的本地 store 副本不完整，THEN THE Compare_View SHALL 通过既有 `GET /api/blueprint/jobs/:jobId` 端点拉取该 job；拉取过程中 SHALL 显示 loading 占位；拉取失败 SHALL 显示语义"无法加载该任务"并提供重试。

4.8 THE Compare_View SHALL NOT 自动触发任一 job 的重新生成、replan 或 inline edit；它纯粹是可视化对比。

4.9 THE Compare_View 在视觉上 SHALL 与 Version_Tree_View 的 stale 标记保持一致（同一警告色 token），与 spec 1 / spec 2 / spec 3 的 stale 标记不冲突。

### 需求 5：Replan_Timeline_View 契约

**用户故事：** 作为产品用户与排障人员，我希望看到这个 family 上所有"从某 stage 重来"的事件按时间排好，知道谁在什么时候开了哪条分支、谁在什么时候原地把下游标记过期。

#### 验收标准

5.1 THE Replan_Timeline_View SHALL 渲染 Family_Response 中 `replanEvents` 数组的全部条目；SHALL NOT 包含其他事件类型（即使后端误传，前端 SHALL 过滤）。

5.2 THE Replan_Timeline_View SHALL 按 `triggeredAt` 降序排列（最新在上、最旧在下）；当 `triggeredAt` 字面量相同（毫秒级冲突），SHALL 按 jobId 字典序作为稳定 tie-breaker。

5.3 每个 timeline 条目 SHALL 展示：(a) `triggeredAt` 的本地化时间；(b) `mode`（中文化为"原地标记过期" / "创建新分支"）；(c) `jobId` 短标识（in_place: 当前 job；branch: 新 branch job）；(d) `parentJobId`（仅 branch 模式存在时）的短标识；(e) `fromStage` 中文名；(f) `markedStaleArtifactCount` 或 `inheritedUpstreamArtifactCount` 计数（按 mode 对应字段展示）；(g) `reason` 文本（截断到 200 字符，超出附"…"）。

5.4 THE Replan_Timeline_View SHALL NOT 引入新的事件家族、新的 socket channel；它仅消费 Family_Response 中已组装的 `replanEvents` 数组。

5.5 WHEN 后端在 spec 4 视图打开期间通过既有 audit / job-update channel 推送了新的 `replan.triggered` 事件，THE Frontend SHALL 把该事件**追加**到 Replan_Timeline_View 的最前面；SHALL NOT 重新拉取整个 Family_Response、SHALL NOT 因 socket 推送而触发 Switch_Active。

5.6 THE Replan_Timeline_View 是只读的；SHALL NOT 提供"撤销 replan"、"replay 该 replan"、"删除事件" 等任一 mutation 控件。

5.7 THE Replan_Timeline_View SHALL NOT 渲染 reason 字段中的可执行内容（如 `<script>` / `<a href>` 等）；reason 文本 SHALL 以纯文本展示（XSS 防护，沿用既有渲染约定）。

5.8 IF Replan_Timeline_View 在打开时 `replanEvents` 数组为空（family-of-one 且未发生过 replan），THEN THE Replan_Timeline_View SHALL 显示语义"该任务尚无重新规划记录"或等效空态文案；SHALL NOT 渲染空白横线或空 timeline 占位。

### 需求 6：History_Entry_Point（opt-in 入口）

**用户故事：** 作为产品用户，我不希望版本历史在我每次 replan 后自动弹出，但我应该能很容易找到入口。

#### 验收标准

6.1 THE Frontend SHALL 在 autopilot blueprint 视图中提供至少一处 History_Entry_Point（具体位置由 design 阶段对齐，建议在右栏顶部或既有右栏 stage divider 附近）；该入口 SHALL 文案明确（如"版本历史"），SHALL 携带稳定标识（如 `data-testid="autopilot-history-entry"`）。

6.2 WHEN 用户点击 History_Entry_Point，THE Frontend SHALL 打开 Version_Tree_View；该打开 SHALL 通过既有路由机制（如新增 `/autopilot/history` sub-route 或 modal 形态，由 design 阶段对齐）；SHALL NOT 阻塞 autopilot 主视图（即用户仍可关闭 history 返回主视图，状态保留）。

6.3 THE History_Entry_Point SHALL NOT 在 spec 2 的 replan 成功后自动触发；SHALL NOT 在 spec 3 的 inline edit 成功后自动触发；SHALL NOT 通过 socket 事件 / URL query / 快捷键自动打开（必须用户显式点击或显式 URL 导航）。

6.4 IF 当前 family 是 family-of-one 且未发生过 in_place replan（即 `replanEvents` 为空），THE History_Entry_Point SHALL 仍可见且可点击；点击后 Version_Tree_View SHALL 渲染单节点 + 空 Replan_Timeline_View；SHALL NOT 隐藏入口（避免用户找不到）。

6.5 IF 当前运行处于 Static_Preview_Mode，THEN THE History_Entry_Point SHALL 仍可见但 SHALL 在 hover / focus 时通过 tooltip 提示"静态预览模式不支持版本历史"；SHALL NOT 触发后端调用、SHALL NOT 抛异常。

6.6 THE History_Entry_Point SHALL NOT 与 spec 2 的 Replan_Button、spec 3 的 edit 图标在 DOM 上重叠或在同一容器内；三者位置互斥，避免用户混淆。

### 需求 7：与系列 Spec 1 的关系（只读消费、零修改）

**用户故事：** 作为代码评审人，我希望 spec 4 在使用 spec 1 已有的 staleness 字段时不修改其引擎、不绕过其语义。

#### 验收标准

7.1 THE Feature SHALL NOT 修改系列 spec 1 的 `invalidateDownstream` 函数签名或行为；本 spec 不调用该函数。

7.2 THE Feature SHALL NOT 修改系列 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`、辅助函数、或任一既有取值的 `BlueprintStaleReason` 枚举。

7.3 THE Feature SHALL NOT 修改系列 spec 1 的 `GET /api/blueprint/jobs/:jobId/stale-artifacts` 端点形态；spec 4 不调用该端点（它读取的是 job 本身的 `staleArtifactIds` 字段，已包含在 Family_Response 的 jobs 元素中）。

7.4 THE Feature SHALL NOT 通过任一路径"清除"已写入的 stale marker（与 spec 1 单调性约束兼容）。

7.5 THE Feature SHALL 视 spec 1 的 `staleSince` / `invalidatedBy` / `staleArtifactIds` 字段为只读读取源；Compare_View 与 Tree_Node 的 stale 标记 SHALL 直接基于这些字段派生。

### 需求 8：与系列 Spec 2 的关系（消费 Branch_Metadata 与事件、零修改）

**用户故事：** 作为代码评审人，我希望 spec 4 把 spec 2 写入的 Branch_Metadata 与 `replan.triggered` 事件作为唯一数据源消费，不重复实现 branch 创建或 replan 触发逻辑。

#### 验收标准

8.1 THE Feature SHALL NOT 修改系列 spec 2 的 `POST /api/blueprint/jobs/:jobId/replan` 路由的请求 / 响应 / 副作用、`Replan_Confirmation_Modal` 组件、`Replan_Button` 组件或 branch 创建逻辑。

8.2 THE Feature SHALL 视 spec 2 的 Branch_Metadata 三字段（`parentJobId` / `branchedAt` / `branchedFromStage`）为只读消费源；Family_Endpoint 与 Version_Tree_View SHALL 仅读取这些字段、SHALL NOT 写入或修改。

8.3 THE Feature SHALL 视 spec 2 的 Branch_Index 为前端层只读消费源；Version_Tree_View 在前端 store 中读取 Branch_Index 渲染树形结构（spec 2 §9.4 把 Branch_Index 在 UI 上的暴露权交给 spec 4，本 spec 是其**唯一**消费方）。

8.4 THE Feature SHALL 视 spec 2 写入的 `replan.triggered` 事件为只读消费源；Replan_Timeline_View 仅渲染 Family_Response 中的 `replanEvents` 数组、SHALL NOT 写入新的 `replan.triggered` 事件、SHALL NOT 修改既有事件的 payload。

8.5 THE Feature SHALL NOT 在 Family_Endpoint 内部调用 spec 2 的 Replan_Endpoint；Family_Endpoint 仅读 In_Memory_Job_Store。

8.6 THE Feature SHALL NOT 复用 spec 2 的 Replan_Confirmation_Modal 组件；Version_Tree_View / Compare_View / Replan_Timeline_View 是独立的 UI 组件，与 spec 2 的 modal 在视觉、组件树、键盘交互上完全独立。

8.7 THE Feature SHALL NOT 在 Switch_Active 流程中以二次请求 / 内部 handler 函数调用 / 同步或异步 dispatch 任一形式触发 spec 2 的 `POST /replan`；Switch_Active 仅写前端 store。

### 需求 9：与系列 Spec 3 的关系（不阻断 inline edit）

**用户故事：** 作为代码评审人，我希望 spec 4 与 spec 3 的 inline edit 在数据层、UI 层、事件层都互不干扰。

#### 验收标准

9.1 THE Feature SHALL NOT 修改系列 spec 3 hook 的任一 Modify_Endpoint 的请求 / 响应 / 副作用；本 spec 不调用 spec 3 的 inline edit 端点。

9.2 THE Feature SHALL NOT 复用 spec 3 的 Inline_Confirmation 组件、edit 图标控件或 Right_Rail_Stale_Indicator；spec 4 的 stale 渲染走 Tree_Node / Compare_View 自身的视觉规范（与 spec 1 / spec 2 / spec 3 视觉一致即可）。

9.3 IF 用户在 spec 4 的 Version_Tree_View 中切换了 Active_Job，THEN spec 3 的 inline edit 控件 SHALL 在新 Active_Job 上**根据其 viewing-completed 状态**重新计算可见性（即 spec 3 的 §1.5 既有规则）；spec 4 SHALL NOT 主动隐藏 / 禁用 / 控制 spec 3 的 inline edit 控件。

9.4 THE Feature SHALL NOT 在 Family_Endpoint 内部调用 spec 3 的任一 Modify_Endpoint。

9.5 THE Feature SHALL NOT 把 Version_Tree_View 与 spec 3 的 inline edit confirmation 渲染在同一 DOM 子树位置；任一时刻两者同时可见的场景由 design 阶段视具体布局对齐，本 spec 不强制互斥但要求两者视觉边界清晰。

### 需求 10：与系列 Spec 5 的关系（动画与原子刷新留白）

**用户故事：** 作为代码评审人与系列 spec 5 的预备工作，我希望 spec 4 不超前实现切换动画与跨组件原子状态协调。

#### 验收标准

10.1 THE Feature SHALL NOT 实现 stage transition 动画；Switch_Active 在视觉上 SHALL 立即生效（无 fade / slide / spring 过渡），具体过渡动画由 spec 5 推进。

10.2 THE Feature SHALL NOT 实现"跨组件原子状态协调器"或"toast 序列编排器"；如 Switch_Active 与下游 specTree / specDocuments / effectPreview 派生 store 的刷新存在时序问题，spec 4 SHALL 在 design 阶段以 `TODO(spec-5-wiring)` 标注接线点位、并采用最简单的 "React batch + 单帧刷新" 策略（与 spec 2 §6.4 相同口径）；SHALL NOT 在本 spec 内实施 spec 5 范围的协调器。

10.3 THE Feature SHALL NOT 实现页面 3→2→1 视觉过渡；切到不同 stage 的 job 时，URL 与 store 立即生效，视觉表现采用既有 stage 切换路径，由 spec 5 决定是否补动画。

10.4 IF 实施过程中发现 Version_Tree_View / Compare_View / Replan_Timeline_View 的视觉打磨需要 spec 5 范围的能力（例如 timeline 滚动动画、tree 节点出场动画），THEN THE Feature SHALL 以 `TODO(spec-5-wiring)` 注释延后；SHALL NOT 在本 spec 内实施跨主线动画改造。

### 需求 11：属性测试与示例测试覆盖

**用户故事：** 作为代码评审人，我希望本 spec 在 family 端点上有可证明的连接性 / 无环 / 只读性属性测试，UI 视图上有最小可信的示例测试。

#### 验收标准

11.1 THE Feature SHALL 在 `server/routes/blueprint/family/__tests__/` 下添加**正好 1 组**测试文件 `family-endpoint.test.ts`，包含 fast-check property test 与 example-based 测试。

11.2 THE Property_Tests SHALL 验证以下 5 条核心性质，每条以独立 `fc.assert(fc.property(...))` 调用实现：

1. **Family 连接性**：对任意随机 family 中的任一 jobId，Family_Endpoint 返回的 `jobs` 数组 SHALL 包含该 jobId 与其 Family_Root；对 `jobs` 中其他每个元素，其 `parentJobId` 链路 SHALL 在有限步内到达 `rootJobId`（即 family 是单连通的有根树）。
2. **Family 无环**：对任意 job，其 `parentJobId` 链路 SHALL NOT 在有限步内回到自身；这是 spec 2 需求 10.2 第 4 条性质（branch 是树而非链）的服务端侧重述。
3. **`replanEvents` 类型纯净**：Family_Response 的 `replanEvents` 数组中每个元素 SHALL 满足 `event.type === "replan.triggered"`；不含其他事件类型。
4. **Family_Root 唯一**：`jobs` 数组中**有且仅有**一个元素满足 `parentJobId === undefined`，且该元素的 `jobId` 严格等于 `rootJobId`。
5. **只读性**：对同一 jobId 连续两次调用 Family_Endpoint，两次响应 SHALL 在元素层面 deep equality；调用前后 In_Memory_Job_Store 中 family 内任一 job 的 `events` / `staleArtifactIds` / `stage` / `status` / `artifacts` / Branch_Metadata 字段 SHALL deep equality。

11.3 THE Property_Tests 每条性质的 `numRuns` SHALL ≥ 100；SHALL 使用 fast-check 提供的 `fc.assert` + `fc.property` 组合；SHALL NOT 硬编码 seed；SHALL NOT 使用 `it.skip` / `describe.skip` / `test.skip` / `it.todo` / `describe.only`；单条 property 的 wall-clock 运行时间 SHALL ≤ 30 秒。

11.4 THE Property_Tests 的 arbitrary 生成器 SHALL 至少能覆盖以下样本类（每类样本数 ≥ 1）：family-of-one、parent + 1 branch、parent + N (N ≥ 2) sibling branches、parent + branch + re-branch（深度 ≥ 2）的 family、含 in_place replan 事件的 family、含混合 mode replan 事件的 family。

11.5 THE Family_Endpoint 的 4xx / 5xx 路径 SHALL 通过 example-based 测试覆盖：(a) jobId 不存在返回 404；(b) `parentJobId` 链路存在闭环（构造性测试）返回 500 + `family_cycle_detected`；(c) family-of-one 返回单元素 jobs 数组与空 replanEvents。

11.6 THE Feature SHALL 在 `client/src/pages/autopilot/version-history/__tests__/` 或等效既有目录下新增 example-based 组件测试，至少覆盖 6 个场景，每个 ≥ 1 条 `expect` 断言：(a) family-of-one 渲染单节点（需求 1.5 / 3.1）；(b) parent + branch 渲染连接线（需求 3.1）；(c) Tree_Node 显示 active 标记（需求 3.2 / 2.4）；(d) Tree_Node 点击触发 Switch_Active 与 URL 更新（需求 2.1 / 2.3）；(e) Compare_View 拒绝跨 family 比较（需求 4.2）；(f) Replan_Timeline_View 按 triggeredAt 降序展示（需求 5.2）。组件测试 SHALL NOT 使用 fast-check（fast-check 仅用于服务端纯函数 / 路由层）。

11.7 THE Feature SHALL NOT 引入新的 vitest config 或新的测试 npm script；新增的服务端测试 SHALL 通过 `vitest.config.server.ts` 既有 server-side runner 自动发现并运行；新增的客户端测试 SHALL 通过既有客户端 vitest runner 自动发现并运行。

11.8 IF 在测试中需要构造 `BlueprintGenerationJob` 样例，THE Test_Files SHALL 优先复用 spec 1 在 `server/routes/blueprint/staleness/__tests__/__fixtures__/` 与 spec 2 在 `server/routes/blueprint/replan/__tests__/__fixtures__/` 下的 fixture / factory；如必须新增 family 构造工具，SHALL 放在 `server/routes/blueprint/family/__tests__/__fixtures__/` 下，并以 `TODO(spec-1-wiring)` / `TODO(spec-2-wiring)` 标注接线点位（如 spec 1 / spec 2 仍未落地）。

### 需求 12：日志与可观测性

**用户故事：** 作为排障人员，我希望 family 端点的访问与异常都在日志里看得见。

#### 验收标准

12.1 WHEN Family_Endpoint 成功返回 200，THE Server_Blueprint_Module SHALL 通过既有 logger 输出一条 `info` 级结构化日志，事件键固定为 `family.read`；payload 字段（强制结构化、无嵌套）：`rootJobId: string`、`requestedJobId: string`、`familySize: number`（jobs.length，0–10000 取值范围）、`replanEventCount: number`（replanEvents.length，0–10000）。

12.2 WHEN Family_Endpoint 返回 404，THE Server_Blueprint_Module SHALL 输出一条 `debug` 级日志，事件键固定为 `family.rejected`；payload：`requestedJobId: string`、`reason: "job_not_found"`；`info` 与 `warn` SHALL NOT 输出。

12.3 WHEN Family_Endpoint 因 family cycle detected 返回 500，THE Server_Blueprint_Module SHALL 输出一条 `error` 级日志，事件键固定为 `family.cycle_detected`；payload：`requestedJobId: string`、`jobId: string`（检测到环的具体 job）、`parentChainSummary: string`（链路摘要，如 `"a→b→c→a"`，仅 jobId 短标识）。

12.4 THE Logging（任一日志级别）SHALL NOT 输出 artifact `payload` 内容、target text 原文、clarification answer 原文、GitHub URL、API key、token、reason 原文；允许字段类型白名单与 spec 2 §11.4 一致。

12.5 THE Logging SHALL 沿用既有 `ctx.logger.info / debug / error` 接口；SHALL NOT 引入新的 logger 实例 / 新的日志 transport / 新的日志库依赖。

12.6 THE Logging 事件键集合 SHALL 仅包含三个：`family.read`、`family.rejected`、`family.cycle_detected`；前缀固定为 `family.`；SHALL NOT 借用 spec 2 的 `replan.*` 事件键、SHALL NOT 借用 spec 3 的 inline edit 日志事件键。

### 需求 13：向后兼容性与零迁移

**用户故事：** 作为依赖现有 in-memory job store 与 GitHub Pages 静态预览的运行实例，我希望本 spec 落地后既有 job、既有响应结构、既有测试都不被破坏。

#### 验收标准

13.1 THE Feature SHALL NOT 引入数据库迁移、SHALL NOT 引入磁盘持久化变更、SHALL NOT 修改 In_Memory_Job_Store 的初始化签名 / 构造参数 / 默认值或启动时序；本 spec 是纯内存、纯路由扩展（仅 1 条只读端点）的最小增量。

13.2 THE Feature SHALL NOT 修改既有路由的 HTTP 方法、URL、请求体字段、枚举值、字段类型或字段含义；新增字段（如 Family_Response 类型）仅作为新端点的响应类型存在，不污染既有响应。

13.3 THE Feature SHALL NOT 修改 `shared/blueprint/contracts.ts` 中由 spec 1 / spec 2 引入或既有的任一字段；只允许新增 `BlueprintFamilyResponse` 类型导出，且该类型由 jobs 数组与 replanEvents 数组两个既有类型组合而成。

13.4 THE Feature SHALL NOT 修改 `MissionAutopilotSummary` / `mission-projection` 投影形态的状态机迁移序列、事件名、事件触发顺序或既有副作用；SHALL NOT 影响既有 mission runtime / workflow runtime / tasks-store / Office Task Cockpit / Web-AIGC runtime / autopilot 节点 11 阶段任一既有能力。

13.5 THE Feature SHALL NOT 修改、删除或调整 `server/tests/blueprint-routes.test.ts` 中任一既有 E2E 用例的 `expect` 断言或断言行；SHALL NOT 修改既有 bridge / 路由层单测的断言；新增测试 SHALL 仅以新文件方式实现。

13.6 WHEN 本 spec 落地后执行 `npx vitest --config vitest.config.server.ts --run`，既有用例数量 SHALL 不减少、失败数 SHALL 为 0、新增 skip SHALL 为 0；spec 1 / spec 2 / spec 3 测试（如已落地）SHALL 全绿；新增的 fast-check property test 与新增 example test SHALL 在同一次运行中通过。

13.7 THE Feature SHALL NOT 影响 GitHub Pages 静态预览路径（`npm run build:pages`）；纯前端预览的运行时 SHALL 在 Family_Endpoint 不可用时把 Version_Tree_View 降级为单节点视图（仅当前 Active_Job）；History_Entry_Point 仍可见但 hover 提示静态预览模式限制（需求 3.7 / 6.5）。

13.8 THE Feature SHALL NOT 引入新的 socket 通道、新的 BlueprintEventName 家族、新的持久化存储、新的鉴权字段、新的限流策略、新的环境变量主开关；Replan_Timeline_View 复用既有 `BlueprintEvent` 形状与既有 audit / job-update channel。

13.9 THE Feature SHALL 尊重 spec 2 §12.9 与 spec 5 的"URL Pin / `workflowStageOverride` / Backend_Job_Stage 三层"语义：spec 4 的 Switch_Active 仅触达前端导航层（Active_Job、Sub_Stage_Pin、Workflow_Stage_Override、URL），SHALL NOT 修改 Backend_Job_Stage（即不通过任一路径写入后端 `BlueprintGenerationJob.stage` 字段）。spec 5 落地后，Switch_Active SHALL 通过 Coordination_Layer 提交，以避免 URL / store / right rail 在不同帧出现中间态。

### 需求 14：范围边界与不在范围内事项

**用户故事：** 作为代码评审人与系列 spec 5 的预备工作，我希望明确本 spec 的范围边界。

#### 验收标准

14.1 THE Feature SHALL NOT 在本 spec 提交中新增 spec 1 范围的导出 / 路由注册 / 字段类型 / 组件（`staleSince` / `invalidatedBy` / `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` / `invalidateDownstream` 引擎 / `GET /stale-artifacts` 端点）；这些由 spec 1 推进。

14.2 THE Feature SHALL NOT 在本 spec 提交中新增 spec 2 范围的导出 / 路由注册 / 组件（Replan_Button、Replan_Confirmation_Modal、`POST /replan` 端点、Branch_Metadata 字段写入逻辑、`replan.triggered` 事件写入）；这些由 spec 2 推进。

14.3 THE Feature SHALL NOT 在本 spec 提交中新增 spec 3 范围的导出 / 路由注册 / 组件（字段级 inline edit UI、Auto_Invalidation_Hook、Stale_Badge、Right_Rail_Stale_Indicator、Per-Stage_Regenerate）；这些由 spec 3 推进。

14.4 THE Feature SHALL NOT 在本 spec 提交中新增 spec 5 范围的导出 / 调度策略 / 组件（stage transition 动画、跨组件原子刷新策略、浮动 toast 序列协调、页面 3→2→1 视觉过渡）；这些由 spec 5 推进。

14.5 THE Feature SHALL NOT 实现以下能力（均明确为 OUT OF SCOPE）：删除 / 归档 / 修剪 branch job、把某 branch promote 为 main、合并 branch 到 parent、跨 family 关联、artifact payload 内容级 diff（spec_documents markdown 行级、spec_tree node 内容字段、prompt_packages 文本、effect_preview html / svg）。

14.6 THE Feature SHALL NOT 修改 LLM prompt 文件、DAG 构造算法、generation 业务逻辑、route candidate 生成算法、spec_tree 派生算法的函数签名、返回值结构或既有测试断言；本 spec 是纯只读 + 视图增量。

14.7 THE Feature SHALL NOT 引入新的 Socket.IO 事件名 / channel name、新的请求头 / 请求体 / 中间件鉴权字段、新的 rate limit / 配额策略；本 spec 是纯内存、纯只读路由的最小增量。

14.8 THE Feature SHALL NOT 在本 spec 提交中新增"清除 stale marker"或"删除 branch job"或"修改 Backend_Job_Stage"任一形式入口；与 spec 1 单调性约束、spec 2 §12.9 backend stage 写入约束兼容。

14.9 IF 实施过程中识别到需要修改 mission runtime、workflow runtime 或 Office cockpit 主线的既有源码或测试，THEN THE Feature SHALL 把该修改延后到 spec 5 范围内推进，并在本 spec 的 design 阶段以 `TODO(spec-5-wiring)` 标注接线点位；本 spec 提交 SHALL NOT 包含上述主线模块的源码或测试改动。

14.10 THE Feature SHALL NOT 把 Family_Endpoint 在以下任一发布面暴露：对外发布的 API 文档、SDK 包导出清单、`docs/` 下的公共说明文件；它仅作为 autopilot blueprint 流的内部只读路由，沿用既有鉴权策略（需求 1.9）。

14.11 THE Feature SHALL NOT 修改既有"返回上一步"按钮、spec 2 的 Replan_Button、spec 3 的 edit 图标的语义、文案、显示位置；History_Entry_Point 是新增 UI，三者位置互斥（需求 6.6）。
