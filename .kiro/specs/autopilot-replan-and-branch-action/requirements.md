# 需求文档：Autopilot Replan And Branch Action

## 简介

本 spec 是 Cube Pets Office autopilot blueprint 流"返回 / 重新规划 / 内联编辑"生命周期 5 个 spec 系列中的**第二个**，聚焦用户**显式**的"从这里重新规划"动作。系列概览：

- **spec 1 — `autopilot-asset-staleness-model`**：在仓库中目前**仅为需求文档（requirements-only）**，尚未落地任何代码与 design 文档；它定义了 `staleSince` / `invalidatedBy` / `staleArtifactIds` 字段、`BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 依赖图、纯函数 `invalidateDownstream(job, fromStage, options)` 以及只读端点 `GET /api/blueprint/jobs/:jobId/stale-artifacts`，并通过 fast-check 验证幂等性与单调性。spec 1 显式排除任一用户触发动作。
- **spec 2 — `autopilot-replan-and-branch-action`（本 spec）**：用户显式触发的"从这里重新规划"动作。承载：右栏 stage divider 处的按钮、全屏 `Replan_Confirmation_Modal`、`POST /api/blueprint/jobs/:jobId/replan` 端点、两种执行模式（`mode = "in_place"` 与 `mode = "branch"`）、`replan.triggered` 审计事件、分支元数据（`parentJobId` / `branchedAt` / `branchedFromStage`），以及 running-stage guard。这是用户**显式意图**通路。
- **spec 3 — `autopilot-stage-edit-mode`**：在仓库中目前**仅为需求文档（requirements-only）**。负责 viewing-completed 时上游字段的就地编辑，调用既有 modify 端点并自动调用 spec 1 引擎；这是用户**隐式意图**通路。spec 3 永远不创建分支、永远不写 `replan.triggered` 事件，且与本 spec 在 modal 组件、API 端点、事件通道上完全分离。
- **spec 4 — `autopilot-stage-version-history`**（尚未创建）：版本树、分支比较 UI、parent / child job 切换。依赖本 spec 提供的分支元数据。
- **spec 5 — `autopilot-stage-state-coordination`**（尚未创建）：stage transition 动画、跨组件原子刷新、toast 序列协调、页面 3→2→1 视觉过渡。

> **重要前置假设**：本 spec **假设 spec 1 先于本 spec 落地**（先实现 spec 1 的引擎与字段，再实现本 spec 的按钮 / modal / 端点 / 事件）；本 spec 在需求层把 spec 1 视为"将要存在的纯函数 / 端点 / 类型"使用，但 SHALL NOT 主张 spec 1 已经在仓库代码中落地（spec 3 既有需求文档曾误用"已落地"措辞，本 spec 显式不沿用）。如果落地顺序倒置，本 spec 的实施可临时桩接 spec 1 引擎签名，但合并到主线时仍须以 spec 1 已落地为前提。

本 spec 引用的产品时序源是：

- `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md` 第 5 段（橙色 `rgb(255, 247, 237)` 背景的"create new generation branch 或 reset downstream artifacts"分支）；
- `docs/autopilot-return-navigation-review-vs-replan-sequence-2026-05-23.svg`（review 与 replan 路径分离）。

本 spec 与 spec 3 的边界：

- **显式意图通路（本 spec）**：用户在右栏 stage divider 上点击"从这里重新规划"按钮 → 全屏 modal 选择模式 → `POST /replan` → 写 `replan.triggered` 事件 → 可选创建 branch job。
- **隐式意图通路（spec 3）**：用户在 viewing-completed 模式下对单个上游字段点击 edit 图标 → inline confirmation → 调用既有 modify 端点（`PATCH /intake` / `POST /clarifications/answers` / `POST /route-selection`）→ 端点内部自动调用 spec 1 引擎 → SHALL NOT 写 `replan.triggered` 事件、SHALL NOT 创建 branch、SHALL NOT 复用本 spec 的 modal。

**不在本 spec 范围内**（已由其他 sibling spec 承担）：

- 字段级 inline edit UI、自动 invalidation hook 接线、stale badge 与 right-rail stale indicator → **spec 3**（`autopilot-stage-edit-mode`）；
- `staleSince` / `invalidatedBy` 字段、`BLUEPRINT_ASSET_DEPENDENCY_GRAPH`、`invalidateDownstream` 引擎、`GET /stale-artifacts` 端点 → **spec 1**（`autopilot-asset-staleness-model`）；
- 版本历史视图、分支比较 UI、parent / child job 切换 UI → **spec 4**（`autopilot-stage-version-history`）；
- stage transition 动画、跨组件原子状态协调、toast 序列编排、页面 3→2→1 视觉过渡 → **spec 5**（`autopilot-stage-state-coordination`）；
- `DELETE /api/blueprint/jobs/:jobId/route-selection` 既有破坏性重置端点的语义改造（保持原样）。

本 spec 属于 Feature 类型，requirements-first 工作流。


## 术语表

- **Replan_Action**：用户显式触发的"从这里重新规划"动作；与"返回上一步"导航动作语义严格分离。Replan_Action 一定伴随下游 invalidation 或分支创建。
- **Replan_Button**：渲染在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 的 stage divider 处的按钮；位于"已完成 stage"与"下一个待推进 stage"之间，作为整段下游的入口；不挂在字段级（字段级 inline edit 由 spec 3 承担）。
- **Stage_Divider**：右栏视图中区分"已完成 stage 链路（completed）"与"下一个 pending / running stage"的视觉分隔位；本 spec 在该分隔位上方挂载 Replan_Button。
- **Replan_Confirmation_Modal**：用户点击 Replan_Button 后弹出的**全屏**确认弹窗（与 spec 3 字段级轻量 inline confirmation 在视觉、组件、键盘交互上完全独立）。包含：fromStage 标识、Downstream_Impact_Summary、Replan_Mode 选择控件、可选 reason 输入、cancel 按钮、confirm 按钮、Running_Stage_Warning 区域。
- **Downstream_Impact_Summary**：modal 中按 artifact type 分组列出的"将受影响的下游 artifact 数量与类型"摘要；数据由前端基于 spec 1 的依赖图与当前 job 的 artifact 列表派生（也可读取 spec 1 的 `GET /stale-artifacts`）；仅用于展示，不能作为副作用真相源。
- **Replan_Endpoint**：本 spec 新增的路由 `POST /api/blueprint/jobs/:jobId/replan`；是 Replan_Action 的**唯一**服务端入口。
- **Replan_Mode**：用户在 modal 中选择的执行模式，初版仅两种取值：
  - **`in_place`**：调用 spec 1 的 `invalidateDownstream` 在当前 job 上标记下游 stale；不创建新 job；保留 history-of-content 但失去 history-of-iteration；产物可读、可被覆盖式重新生成。
  - **`branch`**：创建一个新的 `BlueprintGenerationJob`（branch job），其 `parentJobId` 指向当前 job；branch job 继承当前 job 中所有"严格上游 stage"的 artifact（即所属 stage 在 `fromStage` 的传递上游路径上、不含 `fromStage` 自身）；branch job 在 `fromStage` 起点重新启动一条独立的生成链路；parent job 完全不变。
- **Replan_From_Stage**：Replan_Action 的起点 stage。本 spec 在端点上接受 `BlueprintGenerationStage` 任一合法取值（具体支持范围由 design 阶段对齐右栏 stage divider 在每个 sub-stage 上的可见性判断），但**不接受** `engineering_landing` 之后的越界值。
- **Branch_Metadata**：branch job 上承载的三个**追加可选**字段，仅在 `mode === "branch"` 时写入：
  - `parentJobId: string`：指向 parent job 的 jobId；
  - `branchedAt: string`：ISO 8601 UTC timestamp，分支创建时刻；
  - `branchedFromStage: BlueprintGenerationStage`：分支起点 stage（即用户点击 Replan_Button 时所在的 fromStage）。
- **Replan_Triggered_Event**：每次成功 replan 后写入既有 audit 链与 `job.events` 的事件，类型字符串为 `replan.triggered`；payload 至少包含：`jobId`（in_place 模式下为当前 job、branch 模式下为新 branch job）、`parentJobId`（仅 branch 模式）、`fromStage`、`mode`、`reason`、`triggeredAt`、以及 `markedStaleArtifactCount`（in_place 模式）或 `inheritedUpstreamArtifactCount`（branch 模式）。
- **Running_Stage_Guard**：服务端在执行 replan 副作用之前的前置检查；若当前 job 在 `fromStage` 的传递下游 stage 上存在任一处于 `running` / 等价的 active generation 状态的 artifact，则拒绝请求并返回 HTTP 409；同一 guard 在 `in_place` 与 `branch` 两种模式下均生效。
- **In_Memory_Job_Store**：服务端既有 `BlueprintJobStore`（位于 `server/routes/blueprint/**`），以进程内 map 持有 `BlueprintGenerationJob`；本 spec 不引入持久化、不引入数据库迁移。本 spec 在 store 层扩展为支持多 job 共存（含 parent / branch 关系索引）。
- **Invalidation_Engine**：spec 1 已规划的纯函数 `invalidateDownstream(job, fromStage, options?)`（**spec 1 仍为需求文档，尚未在仓库中落地**）；本 spec 仅作为 caller 复用，SHALL NOT 修改其签名或行为。
- **Stale_Artifacts_Endpoint**：spec 1 规划的只读端点 `GET /api/blueprint/jobs/:jobId/stale-artifacts`；本 spec 仅在前端 Downstream_Impact_Summary 派生时作为可选数据源参考，SHALL NOT 修改其响应 schema。
- **Active_Job**：前端当前用户正在交互的 `BlueprintGenerationJob` 引用。`mode = "in_place"` 成功后 Active_Job 不变（仍指向同一 jobId，但其 staleArtifactIds 索引被刷新）；`mode = "branch"` 成功后 Active_Job 切换为新创建的 branch job（用户透明地继续在 branch job 上工作）。
- **Branch_Index**：前端在 job store 中维护的"job → 其 child branch job 列表"索引；仅作为 spec 4 版本历史 UI 的预备数据结构；本 spec 仅写入与同步该索引，不消费它。
- **URL_Pin / Sub_Stage_Pin**：前端 `AutopilotRoutePage` / `AutopilotRightRail` 对当前显示的 sub-stage 的钉选状态，由既有 `setPinnedSubStage` / `resetPin` API 控制。
- **Workflow_Stage_Override**：前端 `AutopilotRoutePage` 用于覆盖当前 workflow 顶层 stage 的状态变量（`workflowStageOverride`）。
- **Backend_Job_Stage**：服务端 `BlueprintGenerationJob.stage` 字段，是 job 最新生成进度真相源；它不等同于用户当前视口，用户通过"返回上一步"回看上游时允许 URL_Pin / Workflow_Stage_Override 指向上游页面。
- **Static_Preview_Mode**：通过 `npm run build:pages` 生成的 GitHub Pages 纯前端静态预览运行环境，没有可用的后端 modify 端点。
- **DELETE_Route_Selection_Endpoint**：既有路由 `DELETE /api/blueprint/jobs/:jobId/route-selection`；本 spec 不修改、不调用、不依赖。

## 需求

### 需求 1：Replan_Button 入口、可见性与位置

**用户故事：** 作为产品用户，我希望在 blueprint 右栏的"已完成 stage"与"下一段 pending stage"之间看到一个明确独立的"从这里重新规划"按钮，让我可以表达"我要从这里重来"的意图，且不会和"返回上一步"或字段级编辑混在一起。

#### 验收标准

1.1 THE Frontend SHALL 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 中、于 Stage_Divider 位置（即"已完成 stage 链路"与"下一个 pending / running stage"之间的视觉分隔位）渲染一个文案恰为"从这里重新规划"的 Replan_Button；按钮 SHALL 携带稳定标识 `data-testid="autopilot-replan-from-stage-divider"`；按钮 SHALL 在视觉上独立于任一 stage 卡片（不嵌入卡片内部容器）；按钮文案 SHALL NOT 被缩写或截断显示。

1.2 THE Replan_Button SHALL 仅在以下两个条件**同时**成立时可见：(a) `isViewingCompletedStage === true`；(b) 当前查看的 sub-stage 之后基于 spec 1 依赖图派生的"传递下游 artifact 集合" `size >= 1`。

1.3 IF 上述两个条件中任一不成立，THEN THE Frontend SHALL 不在 DOM 与无障碍树中渲染 Replan_Button（相当于该按钮节点不存在）；SHALL NOT 以"可见但 disabled"的方式呈现。

1.4 THE Replan_Button SHALL NOT 挂载在以下任一字段级位置（非穷举枚举，作为可观察的反例集合）：target 文本输入框、GitHub URL 列表项、clarification 答案输入框、route candidate 卡片内部、spec_tree 节点行内；字段级编辑入口由系列 spec 3 承担。

1.5 THE Replan_Button SHALL NOT 修改"返回上一步"按钮的语义、文案、显示位置或样式；两个按钮 SHALL 在视觉上可区分——具体满足"颜色 token / 图标 / DOM 位置"中**至少一项**与"返回上一步"按钮不同（可通过静态 DOM/style snapshot 断言）。

1.6 WHEN 用户的指针在 Replan_Button 上 hover 持续 ≥ 300ms，或在触屏设备上 long-press 持续 ≥ 500ms，THE Frontend SHALL 在 5000ms 内通过既有 tooltip 机制显示提示文案；该文案 SHALL 同时包含两条语义子句：(a)"返回上一步只是回看，不删除产物"；(b)"从这里重新规划会让下游内容过期或开新分支"。

1.7 WHEN 当前 job 在 `fromStage` 的传递下游 stage 上存在任一处于 `running` 状态的 generation，THE Frontend SHALL 把 Replan_Button 设为 `aria-disabled="true"` 且不响应鼠标点击与键盘激活（Enter / Space），并在按钮邻近位置（同一 button group 容器内）显示提示文案"下游正在生成，请稍候"或等效语义；SHALL NOT 自动重试、SHALL NOT 自动绕过 disabled 态。

1.8 THE Replan_Button SHALL NOT 通过 URL query / 全局快捷键 / socket 事件等任一非用户显式点击路径被自动触发；Replan_Action 的合法触发路径仅限：用户鼠标点击按钮、或按钮聚焦时按 Enter / Space 键（出于无障碍考虑允许键盘激活，等价于一次显式点击）。

1.9 IF 当前运行处于 Static_Preview_Mode（通过"modify 端点不可用"或"运行时模式标志"两种条件之一识别），THEN THE Frontend SHALL 把 Replan_Button 设为 `aria-disabled="true"` 且不响应任何激活路径，并在邻近位置显示提示文案"静态预览模式不支持重新规划"或等效语义；SHALL NOT 抛 schema 校验异常、SHALL NOT 导致页面崩溃或路由跳转。

### 需求 2：Replan_Confirmation_Modal 交互

**用户故事：** 作为产品用户，我希望点击"从这里重新规划"后看到一个明确的全屏确认页面，告诉我会影响哪些下游、让我选"原地标记过期"还是"开新分支"，并在我没准备好时能轻松取消。

#### 验收标准

2.1 WHEN 用户点击 Replan_Button 触发显式 Replan_Action，THE Frontend SHALL 打开 Replan_Confirmation_Modal——使用既有 `@radix-ui/react-dialog` 组件、宽度 720–960px、视口高度占用 ≤ 90vh——其内容 SHALL 包含以下分区且按此顺序：(a) 标题（含 fromStage 中文名）、(b) Downstream_Impact_Summary、(c) Replan_Mode 选择控件、(d) 可选 reason 输入框、(e) Running_Stage_Warning 区域、(f) cancel 按钮、(g) confirm 按钮。

2.2 THE Replan_Confirmation_Modal SHALL 在 Downstream_Impact_Summary 分区按 artifact type 分组列出"将受影响的下游 artifact 数量与类型"；数据基于 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 与当前 job 的 artifact 列表派生；前端 SHALL 优先使用本地依赖图计算，仅在确实需要时调用 spec 1 的 `GET /stale-artifacts` 作为辅助数据源；SHALL NOT 修改其响应 schema。

2.3 WHILE Downstream_Impact_Summary 数据源处于加载中，THE Replan_Confirmation_Modal SHALL 显示一个 loading 占位（skeleton 或等效文案"正在计算受影响下游…"）；confirm 按钮 SHALL 在 loading 期间保持 `disabled` 直至数据就绪。

2.4 IF Downstream_Impact_Summary 数据获取失败（网络错误 / 后端 5xx / 超时），THEN THE Replan_Confirmation_Modal SHALL 显示文案"无法计算受影响下游"并保留一个"重试"按钮；confirm 按钮 SHALL 保持 `disabled` 直至数据就绪。

2.5 IF Downstream_Impact_Summary 数据计算结果为 0 个受影响 artifact（即 `size === 0`），THEN THE Replan_Confirmation_Modal SHALL 显示等价于"当前阶段后无下游内容，将直接 reset stage"的语义文案；confirm 按钮 SHALL 仍可点击。

2.6 THE Replan_Confirmation_Modal SHALL 提供两个互斥的 Replan_Mode 单选项（radio 或 segmented control），文案与含义如下：
  - `in_place` — "原地标记过期"，副标题"旧产物保留可读，从当前 job 上重新生成"；
  - `branch` — "创建新分支"，副标题"保留当前 job 不变，开一条独立生成链路"。

2.7 WHEN Replan_Confirmation_Modal 首次打开，THE Frontend SHALL 默认选中 `in_place`；WHEN 用户切换到另一 mode，THE Frontend SHALL 立刻刷新 Downstream_Impact_Summary 分区的措辞——`in_place` 模式描述"将标记为过期"、`branch` 模式描述"将由新分支独立重新生成，原 job 内容不变"——刷新延迟 SHALL ≤ 100ms 且不重新发起后端请求；模式切换 SHALL 保留用户已输入的 reason 文本不变。

2.8 THE Replan_Confirmation_Modal 的 reason 输入控件 SHALL 是 multi-line textarea；最大长度 SHALL 为 1000 字符；超出长度 SHALL 在控件邻近显示计数与"已达上限"语义；SHALL NOT 阻止用户继续输入但 SHALL 阻止 confirm 提交超长内容。

2.9 WHEN 用户点击 confirm 按钮，THE Replan_Confirmation_Modal SHALL 把当前选中的 mode 与（如非空）reason 文本作为请求体发往 Replan_Endpoint。

2.10 WHEN 用户按 `Esc` 键、点击 cancel 按钮或点击 modal 外区域，且当前**不**处于"飞行中"（即未发出 confirm 请求或前一次请求已完成），THE Replan_Confirmation_Modal SHALL 关闭、SHALL NOT 发起任何网络请求、SHALL NOT 修改任一前端 store。

2.11 WHILE confirm 请求处于飞行中（in-flight），THE Replan_Confirmation_Modal SHALL 把 confirm 按钮设为 `disabled`、cancel 按钮保持可用；点击 modal 外区域或按 Esc SHALL NOT 关闭 modal（防止误操作打断飞行中请求）；SHALL NOT 允许重复点击 confirm 触发重复请求。

2.12 IF confirm 请求超过 30 秒未收到响应，THEN THE Replan_Confirmation_Modal SHALL 中止该请求、重新启用 confirm 按钮、并在 Running_Stage_Warning 区域显示文案"请求超时，请重试"或等效语义。

2.13 IF 后端返回 4xx / 5xx（非超时），THEN THE Replan_Confirmation_Modal SHALL 重新启用 confirm 按钮、保留用户已选择的模式与 reason、并在 Running_Stage_Warning 区域显示错误提示；针对 HTTP 409 + `error === "downstream_running"`，SHALL 显示语义"下游 [stage 中文名] 正在生成，请等待完成"；下次用户修改任一表单字段或重新打开 modal 时 SHALL 自动清除上次错误提示。

2.14 WHEN 后端返回 2xx，THE Frontend SHALL 在前端 store（包括 staleArtifactIds 索引、Active_Job 引用、Branch_Index）都已更新后再关闭 Replan_Confirmation_Modal；IF store 更新过程抛出异常，THEN THE Frontend SHALL 不关闭 modal、回滚已更新的 store 字段（best-effort）、并显示文案"前端状态同步失败，请刷新页面"或等效语义。

2.15 THE Replan_Confirmation_Modal SHALL NOT 复用 spec 3 的字段级 Inline_Confirmation 组件、SHALL NOT 共享样式 / 文案 / 键盘交互；两条产品语义在 UI 层完全独立。THE Replan_Confirmation_Modal SHALL NOT 提供任一字段级编辑控件（如直接修改 target text / clarification answer 的输入框）；字段级编辑入口由系列 spec 3 承担。

### 需求 3：Replan_Endpoint 契约

**用户故事：** 作为后端维护者，我希望 replan 动作有一个唯一、独立、可审计的 HTTP 入口，明确接受 fromStage / mode / reason 三个语义参数，且与既有 modify 端点、`DELETE /route-selection` 端点互不重叠。

#### 验收标准

3.1 THE Server_Blueprint_Module SHALL 新增路由 `POST /api/blueprint/jobs/:jobId/replan`，请求体形态为：

```json
{
  "fromStage": "<BlueprintGenerationStage>",
  "mode": "in_place" | "branch",
  "reason": "<string, optional, max 1024 chars>"
}
```

`fromStage` 与 `mode` 为必填；`reason` 为可选、若提供则字符数 SHALL ≤ 1024。

3.2 IF `jobId` 在 In_Memory_Job_Store 中不存在，THEN THE Replan_Endpoint SHALL 在 200ms 内返回 HTTP 404 + `{ "error": "job_not_found" }`；与既有 blueprint 路由 404 风格一致；SHALL NOT 修改 In_Memory_Job_Store 任一字段、SHALL NOT 写入任一事件、SHALL NOT 调用 spec 1 引擎。

3.3 IF `fromStage` 字段缺失、为非字符串、或不在 `BlueprintGenerationStage` 的合法取值集合中，THEN THE Replan_Endpoint SHALL 返回 HTTP 400 + `{ "error": "invalid_from_stage" }`；SHALL NOT 触发任何下游副作用（不修改 job、不写事件、不调用 spec 1 引擎、不创建 branch job）。

3.4 IF `mode` 字段缺失、为非字符串、或不在 `["in_place", "branch"]` 中，THEN THE Replan_Endpoint SHALL 返回 HTTP 400 + `{ "error": "invalid_mode" }`；SHALL NOT 触发任何下游副作用。

3.5 IF `reason` 字段存在且不是字符串、或字符数 > 1024，THEN THE Replan_Endpoint SHALL 返回 HTTP 400 + `{ "error": "invalid_reason" }`；SHALL NOT 触发任何下游副作用。

3.6 WHEN `mode === "in_place"` 且通过所有 guard，THE Replan_Endpoint SHALL 在 5 秒内：
  - 调用 spec 1 的 `invalidateDownstream(job, fromStage, options)`（其中 `options.reason` 由本 spec 在 design 阶段映射到 spec 1 既有的 `BlueprintStaleReason` 枚举之一，SHALL NOT 在本 spec 内扩展该枚举）；
  - 把引擎返回的"新 job"对象写回 In_Memory_Job_Store；
  - 把 Backend_Job_Stage 重置为 `fromStage`（即倒回到 fromStage 等价的初始态，用户即可在该 stage 上重新生成）；
  - 在该 job 的 `events` 数组上**恰好**追加一条 Replan_Triggered_Event（无重复）；
  - 返回 HTTP 200 + 响应体形态：

```json
{
  "mode": "in_place",
  "job": { "<refreshed BlueprintGenerationJob>" },
  "summary": {
    "fromStage": "<BlueprintGenerationStage>",
    "markedStaleArtifactCount": <number, equals length of markedStaleArtifactIds>,
    "markedStaleArtifactIds": ["<string>"]
  }
}
```

`markedStaleArtifactCount` SHALL 严格等于 `markedStaleArtifactIds.length`。

3.7 WHEN `mode === "branch"` 且通过所有 guard，THE Replan_Endpoint SHALL 在 5 秒内：
  - 创建一个新的 `BlueprintGenerationJob`（branch job），分配新的 `jobId`；
  - 在 branch job 上写入 Branch_Metadata：`parentJobId = <当前 jobId>`、`branchedAt = <ISO 8601 UTC now>`、`branchedFromStage = <fromStage>`；
  - 把当前 job 中所有"严格上游 artifact"（即所属 stage 在 `fromStage` 的传递上游路径上、**不含 `fromStage` 自身**）按本 spec design 阶段选定的语义（**深拷贝** 或 **引用共享**，二选一并由 design 文档明确）转入 branch job；
  - branch job 在 `fromStage` 及其下游 stage 上 SHALL NOT 携带任何 artifact（用户随后在 branch job 上从 fromStage 重新生成）；
  - branch job 的 `staleArtifactIds` 初始化为空数组；branch job 上**不**写入任何 stale marker（branch job 是全新链路，不继承 parent 的 stale 状态）；
  - 把 parent job 完全保持不变（artifact 列表、staleArtifactIds、stage、status、events 等任一字段都不修改）；
  - 把 branch job 写入 In_Memory_Job_Store 并在 Branch_Index 中登记 `parentJobId → [..., branchJobId]`；
  - 在 **branch job** 的 events 上**恰好**追加一条 Replan_Triggered_Event（无重复）（同时建议在 parent job 上以 `info` 级日志或可选事件镜像记录该分支动作，具体由 design 阶段确认；本 spec 仅强制要求 branch job 上必有事件）；
  - 返回 HTTP 200 + 响应体形态：

```json
{
  "mode": "branch",
  "job": { "<new branch BlueprintGenerationJob with Branch_Metadata>" },
  "parentJobId": "<string>",
  "summary": {
    "fromStage": "<BlueprintGenerationStage>",
    "branchedAt": "<ISO 8601>",
    "inheritedUpstreamArtifactCount": <number, equals length of inheritedUpstreamArtifactIds>,
    "inheritedUpstreamArtifactIds": ["<string>"]
  }
}
```

`inheritedUpstreamArtifactCount` SHALL 严格等于 `inheritedUpstreamArtifactIds.length`。

3.8 IF Replan_Endpoint 处理过程中出现内部错误（例如 spec 1 引擎抛出异常、In_Memory_Job_Store 写入失败、序列化失败等），THEN THE Replan_Endpoint SHALL 返回 HTTP 500 + `{ "error": "internal_error" }`，并执行 best-effort 回滚（不部分写入 In_Memory_Job_Store、不部分追加事件）；SHALL 通过既有 logger 输出 `error` 级日志记录失败原因。

3.9 THE Replan_Endpoint SHALL NOT 被 spec 3 的 inline edit 流程调用；SHALL NOT 在 spec 3 hook 的任一 Modify_Endpoint 内部以二次请求 / 内部 handler 函数调用 / 同步或异步 dispatch 任一形式触发本端点。Replan_Endpoint 是**显式**用户意图通路的唯一服务端入口。

3.10 THE Replan_Endpoint SHALL NOT 触发 LLM 调用、Docker 调用、MCP 调用或其他外部副作用；其全部副作用限定在 In_Memory_Job_Store 写回、Branch_Index 维护、events 追加、audit channel 推送、日志输出、HTTP 响应构造范围内。后续重新生成由用户在 fromStage 上的下一次显式动作（既有 generation 端点）触发。

3.11 THE Replan_Endpoint SHALL 沿用既有 blueprint 路由的鉴权策略、错误处理形态、入参解析方式；SHALL NOT 引入新的鉴权字段、新的限流策略、新的中间件。

3.12 THE Replan_Endpoint SHALL NOT 修改 `DELETE /api/blueprint/jobs/:jobId/route-selection` 的路由定义、入参形态、响应形态或副作用范围；该端点继续作为既有破坏性重置存在，与本 spec 共存且互不调用。

3.13 THE Replan_Endpoint SHALL NOT 引入新的 socket 事件 / 事件家族；Replan_Triggered_Event 沿用既有 audit / job-update channel（具体复用哪一条由 design 阶段对齐 spec 1 / 既有 events 命名规范）；事件 payload SHALL 至少携带 5 个语义字段：`jobId` / `fromStage` / `mode` / `reason`（即便为空也以 `reason: undefined` 表达字段存在）/ `triggeredAt`。

### 需求 4：Running_Stage_Guard

**用户故事：** 作为后端维护者，我希望当下游某个 stage 还在 generation 中时，replan 动作被显式阻塞而不是默默把一个正在 running 的产出过期或克隆到分支；用户应被提示等待。

#### 验收标准

4.1 IF 当前 job 在 `fromStage` 的传递下游 stage 上存在任一 artifact 满足以下三个判定中的任一项：(a) `BlueprintGenerationJob.status === "running"`；(b) `handoffState` 不在终态枚举集合 `{"completed", "failed", "cancelled"}` 内；(c) `nextAction` 指向下游生成动作；THEN THE Replan_Endpoint SHALL 在调用 spec 1 引擎或创建 branch job 之前**先**检测到该状态，并返回 HTTP 409 + `{ "error": "downstream_running", "runningStage": "<BlueprintGenerationStage>" }`；SHALL NOT 修改 job 任一字段、SHALL NOT 写入 stale marker、SHALL NOT 创建 branch job、SHALL NOT 追加事件。

4.2 IF 多个下游 stage 同时满足 4.1 的判定条件，THEN THE Replan_Endpoint SHALL 在 `runningStage` 字段中返回**拓扑上最靠近 `fromStage`** 的那一个；该字段 SHALL 是单一字符串值，不是数组。

4.3 THE Running_Stage_Guard SHALL 在 `mode === "in_place"` 与 `mode === "branch"` 两种情况下使用同一段检测逻辑、返回同一 409 形态；guard SHALL NOT 根据 mode 跳过、放宽或加严判定。

4.4 THE Running_Stage_Guard SHALL NOT 阻塞用户从右栏点开 Replan_Confirmation_Modal、查看 Downstream_Impact_Summary 或切换 mode 等任何只读交互；guard 仅在 confirm 提交到 Replan_Endpoint 时由后端兜底。

4.5 THE Running_Stage_Guard 实现 SHALL 与 spec 3 的 Conflict_Detection 在代码上独立（独立模块、不共享检测函数、不共享内部状态、不共享 409 响应构造）；任一 spec 改动 SHALL NOT 影响另一 spec 的 guard 行为。

4.6 WHEN Replan_Endpoint 因 Running_Stage_Guard 返回 409，THE Server_Blueprint_Module SHALL 输出一条 `warn` 级日志（需求 11.3）；SHALL NOT 输出任何标记 replan 已触发或已成功的日志条目（包括但不限于 `info` 级 `replan.triggered`、自定义别名日志键）。

### 需求 5：Replan_Triggered_Event 与审计

**用户故事：** 作为排障人员与系列 spec 4 的预备工作，我希望每次显式 replan 都在审计链中留下一条可读、结构化、与 spec 3 隐式 invalidation 严格区分的事件，便于后续版本历史 UI 消费。

#### 验收标准

5.1 WHEN Replan_Endpoint 返回 HTTP 2xx 状态码，THE Server_Blueprint_Module SHALL 在 HTTP 响应返回前、对应 job 的 `events` 数组上**恰好**追加一条类型为 `replan.triggered` 的 `BlueprintEvent`（**复用既有 `BlueprintEvent` 形状，不引入新事件家族**）；payload SHALL **恰好**包含以下字段（无多余字段）：

```text
{
  jobId: string,                              // in_place: 当前 jobId; branch: 新 branch jobId
  parentJobId?: string,                       // 仅 branch 模式存在
  fromStage: BlueprintGenerationStage,
  mode: "in_place" | "branch",
  reason?: string,                            // 若存在则字符数 ≤ 500
  triggeredAt: string,                        // ISO 8601 UTC，毫秒精度
  markedStaleArtifactCount?: number,          // 仅 in_place; 取值 0–10000
  inheritedUpstreamArtifactCount?: number     // 仅 branch; 取值 0–10000
}
```

5.2 THE Replan_Triggered_Event SHALL 沿用既有审计链 / socket 推送通道（具体为 spec 3 隐式 invalidation 事件所使用的同一通道），SHALL NOT 引入新的 socket channel、SHALL NOT 引入新的 BlueprintEventName 家族。

5.3 THE Replan_Triggered_Event 的唯一写入点 SHALL 为 Replan_Endpoint 成功路径；SHALL NOT 由 spec 3 的 Auto_Invalidation_Hook 写入、SHALL NOT 由其他端点写入；spec 3 内部即便复用 spec 1 引擎，也 SHALL NOT 写入此事件（spec 3 需求 8.2 已显式约束）。

5.4 IF Running_Stage_Guard 返回 409，THEN THE Server_Blueprint_Module SHALL NOT 追加任何 Replan_Triggered_Event；events 数组在请求前后 SHALL 完全一致（deep equality）。

5.5 IF fromStage / mode / reason 校验失败、或 jobId 不存在，THEN THE Server_Blueprint_Module SHALL NOT 追加任何 Replan_Triggered_Event；events 数组在请求前后 SHALL 完全一致。

5.6 THE Replan_Triggered_Event payload SHALL NOT 包含以下任一可枚举字段：artifact `payload` 原文、target text 原文、clarification answer 原文、GitHub URL、API key、token；reason 字段 SHALL 仅以纯文本表达，长度 ≤ 500 字符；其余字段仅包含 id / type / stage / mode / 计数等元数据。

5.7 THE Replan_Triggered_Event SHALL 通过既有 BlueprintEvent schema 校验；既有 timeline 反序列化与渲染逻辑 SHALL 无需修改即可正确读取与展示该事件；如出现反序列化失败或渲染异常，视为不满足本需求；本 spec SHALL NOT 强制新增 timeline UI（timeline 视图升级由系列 spec 4 推进）。

### 需求 6：Frontend Store 协调与 Active_Job 切换

**用户故事：** 作为产品用户，我希望"原地标记过期"成功后页面继续停留在当前 job 上、stale 索引立刻刷新；"创建新分支"成功后我能透明地继续在新分支上工作，旧 job 还能在审计 / 历史里查到。

#### 验收标准

6.1 WHEN Replan_Endpoint 在 `mode === "in_place"` 下返回 HTTP 2xx 响应，THE Frontend SHALL 在 100ms 内：
  - 用响应中 `job` 字段刷新当前 job 的本地 store（含 `staleArtifactIds` 索引、stage 字段、events 列表）；
  - 保持 Active_Job 引用为同一 jobId（不切换）；
  - 在 spec 5 尚未落地时调用既有 `resetPin()`、把 `workflowStageOverride` 写入 `fromStage`；在 spec 5 落地后 SHALL 通过 Coordination_Layer 原子提交 pin / override / store 写入；
  - 通过既有 toast / notification 机制显示文案"已从 [stage 中文名] 起标记 N 个下游内容为过期"，其中 N 为整数且 ≥ 0。

6.2 WHEN Replan_Endpoint 在 `mode === "branch"` 下返回 HTTP 2xx 响应，THE Frontend SHALL 在 100ms 内：
  - 把响应中 `job` 字段（branch job）写入 job store；
  - 把 Active_Job 引用切换为 branch job 的 jobId（用户透明地继续在 branch job 上工作）；
  - 保留 parent job 在 store 中（不删除）、不修改其任一字段（parent 上无 Branch_Metadata 三字段，因为 parent 不是 branch）；
  - 在 Branch_Index 中以追加方式登记 `parentJobId → [..., branchJobId]`，对相同 branchJobId 去重；
  - 在 spec 5 尚未落地时调用既有 `resetPin()`、把 `workflowStageOverride` 写入 `fromStage`；在 spec 5 落地后 SHALL 通过 Coordination_Layer 原子提交 pin / override / Active_Job / Branch_Index 写入；
  - 通过既有 toast / notification 机制显示文案"已创建新分支，从 [stage 中文名] 起独立重新规划"。

6.3 IF Replan_Endpoint 在 `mode === "branch"` 下返回 HTTP 2xx 响应，THEN THE Frontend SHALL NOT 从 store 中删除 parent job、SHALL NOT 修改 parent job 的 `staleArtifactIds` / `workflowState` / `artifacts` / 元数据任一字段、SHALL NOT 触发路由跳转回 parent job 的视图、SHALL NOT 把 Active_Job 回切到 parent jobId（这些动作 SHALL 由系列 spec 4 的版本历史 UI 提供）。

6.4 WHEN Replan_Endpoint 在任一 mode 下返回 HTTP 2xx 响应，THE Frontend SHALL 在同一个 React 渲染批次内、且下一帧（约 16ms）内可见地用响应中 job 的 `staleArtifactIds` 重新渲染所有下游视图组件（如 spec 树节点 stale badge、effect_preview 瓷砖 stale 状态等，badge UI 本身由 spec 3 落地）；视觉刷新 SHALL NOT 拆分为多个用户可感知的渲染步骤（避免出现"toast 已弹但 badge 还没出现"的中间态）。

6.5 WHILE replan 请求处于 in-flight 区间（从请求发出到响应到达或网络失败），THE Frontend SHALL NOT 整页加锁、SHALL NOT 弹遮罩、SHALL NOT 阻塞 replan 范围外的交互（如其他 tab 滚动、其他 modal 打开等）；提交过程的视觉态由 Replan_Confirmation_Modal 内部的 confirm 按钮 disabled 态承担。

6.6 IF 后端在 replan 成功后通过 socket 推送了相关事件（如既有 audit / job-update channel），THEN THE Frontend SHALL 仅把它作为审计 / 时间线展示数据消费，SHALL NOT 第二次重置 store、SHALL NOT 第二次切换 Active_Job、SHALL NOT 再次调用 `resetPin()` 或改写 `workflowStageOverride`。

### 需求 7：与系列 Spec 1 的关系（引擎复用、零修改）

**用户故事：** 作为代码评审人，我希望本 spec 在使用 spec 1 引擎时不修改其签名、不绕过其语义、不重复实现 stale marker 写入逻辑，并明确声明"spec 1 当前仅为需求文档、尚未落地代码"这一事实。

#### 验收标准

7.1 THE Feature SHALL NOT 修改系列 spec 1 的 `invalidateDownstream(job, fromStage, options)` 函数：参数名、参数顺序、参数类型、返回值结构、stage marker 写入范围、抛错条件、同步/异步形态任一不变；本 spec 仅在 Replan_Endpoint 内部以**调用方**身份复用该函数；SHALL NOT 在调用前后插入产生等价副作用的旁路代码以绕过其语义。

7.2 THE Feature SHALL NOT 修改系列 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`、`getTransitiveDownstreamStages`、`isDownstreamOf`、`mapArtifactTypeToStage` 任一辅助函数的导出名、签名、返回值结构或依赖图的节点 / 边集合；SHALL NOT 在本 spec 内重写、拷贝或私有镜像同等能力。

7.3 THE Feature SHALL NOT 修改系列 spec 1 的 `BlueprintStaleReason` 枚举：SHALL NOT 新增成员、SHALL NOT 修改字面量、SHALL NOT 重定义任一既有成员的语义；如本 spec 需要的 reason 取值与 spec 1 既有枚举不一致，SHALL 在 spec 1 既有有限取值集合中选择最接近的一项（如 `"upstream_explicit_invalidation"`）。

7.4 THE Feature SHALL NOT 修改系列 spec 1 的 `GET /api/blueprint/jobs/:jobId/stale-artifacts` 端点的 HTTP 方法、URL 路径、查询参数集合或响应字段集合；前端 Downstream_Impact_Summary 派生 SHALL 优先基于本地依赖图客户端计算，确实需要时再以"调用 spec 1 端点 + 不修改其响应"方式辅助；SHALL NOT 新增第二个 stale 摘要端点。

7.5 THE Feature 实现路径产出的 stale marker 集合 SHALL 是 spec 1 引擎写入结果的**真子集或相等集合**；SHALL NOT 清除 / 回写 spec 1 引擎写入的 marker；SHALL NOT 通过纯函数 / HTTP 端点 / socket 事件 / design 接线点等任一形式暴露"清除 stale marker"入口；branch 模式下 branch job 的 `staleArtifactIds` 为空不构成清除——branch job 本就是新 job，与 parent 的 stale 状态无继承关系。

7.6 IF 在本 spec 实施过程中发现 spec 1 尚未在仓库中落地（例如真实代码中 `invalidateDownstream` 函数不存在），THEN THE Feature SHALL 在 design 阶段以统一可机读前缀 `TODO(spec-1-wiring)` 标注至少以下 6 类接线点位：(a) `invalidateDownstream` 调用点；(b) `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 引用点；(c) `BlueprintStaleReason` 枚举映射点；(d) `staleSince` 字段读写点；(e) `staleArtifactIds` 索引读写点；(f) `GET /stale-artifacts` 端点引用点；如必须临时桩接 spec 1 引擎，桩接形态 SHALL 唯一为"返回空 stage 集合、不写入任何 stage marker、不清除任何 stage marker"的 no-op；SHALL NOT 在 spec 1 之前合并到主分支。

### 需求 8：与系列 Spec 3 的关系（无端点重叠、无 modal 共享）

**用户故事：** 作为代码评审人，我希望本 spec 与 spec 3 在 API 端点、modal 组件、事件审计上严格分离，避免显式与隐式两条意图通路在实现层互相污染。

#### 验收标准

8.1 THE Feature SHALL NOT 修改系列 spec 3 hook 的任一 Modify_Endpoint 在以下四个可观察维度上的形态：(a) 请求 body schema 字段集合；(b) 响应 body schema 字段集合；(c) In_Memory_Job_Store 写入的字段集合；(d) 对外推送的事件类型集合。涉及端点为 `PATCH /api/blueprint/intake/:intakeId`、`POST|PATCH /api/blueprint/clarifications/:sessionId/answers`、`POST /api/blueprint/jobs/:jobId/route-selection`（在 inline edit 路径上）。本 spec 不通过这些端点完成 replan。

8.2 THE Feature SHALL NOT 在 Replan_Endpoint 内部以下两种形态调用任一 spec 3 既有 Modify_Endpoint：(a) HTTP 入口（fetch / axios / 等同方式）；(b) 内部 handler 函数（同步或异步处理路径）。Replan_Endpoint SHALL 直接调用 spec 1 引擎与 In_Memory_Job_Store 完成 replan。

8.3 THE Feature SHALL NOT 复用 spec 3 的 Inline_Confirmation 组件，禁止形态包括但不限于以下三种：import、wrapper 包装、继承复用。

8.4 THE Feature SHALL NOT 把 Replan_Confirmation_Modal 与 spec 3 的字段级 inline edit confirmation 渲染在同一 React 子树位置；任一时刻 DOM 中两者同时可见的时长 SHALL = 0。

8.5 THE Feature SHALL NOT 在 Replan_Confirmation_Modal 中提供任一字段级编辑控件——具体禁止控件类型枚举包括：`<input>` / `<textarea>` / `<select>` 等绑定到 clarification answer 或 intake 字段的可编辑控件；用户若需要在 replan 之前修改这些字段，SHALL 通过 spec 3 的 inline edit 完成。

8.6 THE Feature SHALL NOT 在前端 / 后端引入"在 inline edit 内追加 `replan.triggered` 事件"或"在 replan 内追加 `spec3.invalidation`（或语义等价派生项）事件 / 日志"的代码路径；两条意图通路的事件名 / 日志名严格不重叠（spec 3 需求 8.2 / 11.6 已对侧约束）。

8.7 THE Feature SHALL NOT 把 Replan_Button 渲染在与 spec 3 字段级 edit 图标 DOM 祖先链重合的位置；Replan_Button 的合法位置 SHALL 收敛到 Stage_Divider 的直接子节点；edit 图标位于字段旁；两者位置互斥。

### 需求 9：与系列 Spec 4 的关系（仅写入分支元数据，不实现 UI）

**用户故事：** 作为系列 spec 4 的预备工作，我希望本 spec 写入完整、稳定、可消费的分支元数据，但不超前实现版本历史 / 分支比较 UI。

#### 验收标准

9.1 THE Feature SHALL 在 `shared/blueprint/contracts.ts` 上以**追加可选字段**方式扩展 `BlueprintGenerationJob` 形态：`parentJobId?: string`（非空字符串、引用合法父 job 的 jobId）、`branchedAt?: string`（ISO 8601 UTC 时间戳，毫秒精度）、`branchedFromStage?: BlueprintGenerationStage`（取值限定在已声明联合类型内）；SHALL NOT 修改任一既有字段的类型 / 可选性 / 默认值 / 语义。

9.2 WHEN `mode === "branch"` 创建 branch job，THE Feature SHALL 要么把 `parentJobId` / `branchedAt` / `branchedFromStage` 三字段全部以合法值填充并写入 branch job，要么不创建该 branch job 并返回 HTTP 500 + 带缺失 / 非法字段名的错误指示（不存在中间态）。IF `mode === "in_place"`，THEN THE Feature SHALL 不写入这三个字段（在响应 job 对象中表现为 `undefined`）。

9.3 THE Feature SHALL NOT 在任何用户可见的 UI 表面（路由、菜单、按钮、抽屉、modal）上提供承载版本历史视图、branch 比较 UI、parent / child job 切换 UI 的可见入口或容器；这些能力由系列 spec 4 推进。

9.4 THE Feature SHALL 在前端 job store 中维护 Branch_Index（`parentJobId → [branchJobId, ...]`），触发时机 SHALL 包括：(a) replan 成功后追加；(b) 应用启动时 rehydrate；同一 parent 下的 `branchJobId` 列表 SHALL 去重；该索引 SHALL 仅允许 store 内部及单元测试访问，SHALL NOT 通过 React selector / 公开 API / Hook / 路由 / 外部模块对 UI 组件可见。

9.5 THE Feature SHALL NOT 在任何用户可见的 UI 表面上提供触发"从 branch job 切回 parent job"的可点击元素、快捷键或导航行为；用户在 branch 创建后透明地继续在 branch 上工作（需求 6.2），切换回 parent 的能力由 spec 4 提供。

### 需求 10：属性测试与示例测试覆盖

**用户故事：** 作为代码评审人，我希望本 spec 在数据层有清晰的 fast-check property test 覆盖，证明两种模式在任意 job 形态下都满足关键不变量。

#### 验收标准

10.1 THE Feature SHALL 在 `server/routes/blueprint/replan/__tests__/` 下添加**正好 2 组**测试文件：
  - `replan-in-place.test.ts`：包含 fast-check property test 与 example-based 测试，覆盖需求 10.2 中第 1、5 条性质，以及需求 3.6 / 4.1 / 5.1 的端点行为；
  - `replan-branch.test.ts`：包含 fast-check property test 与 example-based 测试，覆盖需求 10.2 中第 2、3、4 条性质，以及需求 3.7 / 4.1 / 5.1 / 9.1–9.2 的端点与契约行为。

10.2 THE Property_Tests SHALL 验证以下 5 条核心性质，每条以**独立 `fc.assert(fc.property(...))` 调用**实现：

1. **In-place mode 引擎等价性**：`POST /replan` 在 `mode = "in_place"` 下返回的 job 中"被标记 stale 的 artifact id 集合"在元素层面（顺序无关、重复无关）等于直接调用 spec 1 `invalidateDownstream(job, fromStage, options)` 后得到的 job 中"被标记 stale 的 artifact id 集合"，对随机生成的 job 与随机的合法 fromStage 成立。
2. **Branch 模式上游保留**：`mode = "branch"` 下创建的 branch job 在所有"严格上游 stage（即位于 `fromStage` 的传递上游路径上、不含 `fromStage` 自身）"上的 artifact 与 parent job 在结构上等价（深拷贝语义下为字节级 deep equality；引用共享语义下为同一引用）；该集合中每个 artifact 的 `staleSince === undefined`（branch job 上 SHALL NOT 写入 `staleSince` marker）。
3. **Branch 模式下游为空**：`mode = "branch"` 下创建的 branch job 中所属 stage 等于 `fromStage` 或在 `fromStage` 传递下游路径上的 artifact 集合 SHALL 为空。
4. **Branch 是树而非链**：连续两次以相同 `(jobId, fromStage, mode = "branch")` 触发 replan，SHALL 创建两个不同的 sibling branch job，两者的 `parentJobId` SHALL 都等于原始 jobId（而非第一个 branch 的 jobId）；即分支结构是 tree（一个 parent 多个 child），不是 linked list（chain）。
5. **In-place 幂等**：连续两次以相同 `(jobId, fromStage, mode = "in_place")` 触发 replan，第二次返回的 job 中 `staleArtifactIds` 集合在元素层面与第一次相等（沿用 spec 1 需求 4 幂等性；本 spec 不引入新的清除路径）。

10.3 THE Property_Tests 每条性质的 `numRuns` SHALL ≥ 100；SHALL 使用 fast-check 提供的 `fc.assert` + `fc.property` 组合；SHALL NOT 硬编码 seed；SHALL NOT 使用 `it.skip` / `describe.skip` / `test.skip` / `it.todo` / `describe.only`；单条 property 的 wall-clock 运行时间 SHALL ≤ 30 秒。

10.4 THE Property_Tests 的 arbitrary 生成器 SHALL 至少能覆盖以下样本类（每类样本数 ≥ 1）：空 artifact 列表的 job；所有 stage 都有 artifact 的 job；部分 stage 已有 stale marker 的 job；随机的合法 fromStage；reason 文本三类——`undefined`、空字符串、长度 1–256 的字符串。

10.5 THE Running_Stage_Guard SHALL 通过 example-based 测试覆盖：当下游 stage 处于"running 状态"（沿用需求 4.1 design 对齐结果）时，replan 请求（in_place 与 branch 各独立断言一次）返回 409 + `error === "downstream_running"`；通过"请求前后对 job 做深拷贝快照 + deep equality 断言"验证 job 任一字段不变、events 不追加。

10.6 THE Feature SHALL 在以下三个候选目录之一（由 design 阶段选定）新增 example-based 组件测试：`client/src/pages/autopilot/__tests__/`、`client/src/components/autopilot/__tests__/`、`client/src/__tests__/autopilot/`；至少覆盖 5 个场景，每个场景 SHALL 至少包含 1 条 `expect` 断言：(a) Replan_Button 可见性条件（需求 1.2 / 1.3 / 1.7 / 1.9）；(b) Replan_Confirmation_Modal 模式切换刷新文案（需求 2.7）；(c) cancel / Esc 行为（需求 2.10）；(d) confirm disabled 防重复（需求 2.11）；(e) 与 spec 3 inline edit modal 视觉互斥（需求 8.4）——通过"DOM 不同时存在 + `data-testid` 命名空间不重叠"两条可观测断言实现。组件测试 SHALL NOT 使用 fast-check（fast-check 仅用于服务端纯函数 / 路由层）。

10.7 THE Feature SHALL NOT 引入新的 vitest config 或新的测试 npm script；新增的服务端测试 SHALL 通过 `vitest.config.server.ts` 既有 server-side runner 自动发现并运行；新增的客户端测试 SHALL 通过既有客户端 vitest runner 自动发现并运行。

10.8 IF 在测试中需要构造 `BlueprintGenerationJob` 样例且 spec 1 在 `server/routes/blueprint/staleness/__tests__/__fixtures__/` 下的 fixture / factory 已存在，THEN THE Test_Files SHALL 优先复用之；IF 该 fixture 尚未在仓库中落地，THEN THE Feature SHALL 在 design 阶段以 `TODO(spec-1-wiring)` 标注接线点位，并在新增 factory 的同时把 factory 文件放在 `server/routes/blueprint/replan/__tests__/__fixtures__/` 下。

### 需求 11：日志与可观测性

**用户故事：** 作为排障人员，我希望 replan 行为在 server 日志中可见，与 spec 3 隐式 invalidation 区分清楚，便于定位"为什么这个 spec_tree 突然出现新分支"。

#### 验收标准

11.1 WHEN Replan_Endpoint 成功执行（任一 mode），THE Server_Blueprint_Module SHALL 在返回 HTTP 200 之前通过既有 logger 输出一条 `info` 级结构化日志，事件键固定为 `replan.triggered`；payload 字段（强制结构化、无嵌套）：`jobId: string`、`parentJobId?: string`（仅 branch 模式存在）、`fromStage: BlueprintGenerationStage`、`mode: "in_place" | "branch"`、`markedStaleArtifactCount?: number`（仅 in_place）、`inheritedUpstreamArtifactCount?: number`（仅 branch）、`reasonPresent: boolean`、`reasonLength: number`、`triggeredAt: string`（ISO 8601 UTC，与 audit event 中同名字段字面量一致）；SHALL NOT 输出 reason 原文。

11.2 WHEN Replan_Endpoint 因 fromStage / mode / reason 校验失败、jobId 不存在等 4xx 拒绝场景返回，THE Server_Blueprint_Module SHALL 输出一条 `debug` 级日志，事件键固定为 `replan.rejected`；payload 字段：`jobId: string`（不可解析输入下记为 `null`）、`reason: "job_not_found" | "invalid_from_stage" | "invalid_mode" | "invalid_reason"`、`fromStage: BlueprintGenerationStage | null`（不可解析时为 `null`）、`mode: "in_place" | "branch" | null`（不可解析时为 `null`）；`info` 级与 `warn` 级 SHALL NOT 输出。

11.3 WHEN Replan_Endpoint 因 Running_Stage_Guard 返回 409，THE Server_Blueprint_Module SHALL 输出一条 `warn` 级日志，事件键固定为 `replan.blocked`；payload 字段：`jobId: string`、`fromStage: BlueprintGenerationStage`、`mode: "in_place" | "branch"`、`runningStage: BlueprintGenerationStage`；SHALL NOT 触发 `info` 级、SHALL NOT 调用 spec 1 引擎、SHALL NOT 创建 branch job、SHALL NOT 追加 events。

11.4 THE Logging（任一日志级别）SHALL NOT 输出以下任一字段类型：artifact `payload` 原文、target text 原文、clarification answer 原文、GitHub URL、API key、token、reason 原文。允许字段类型白名单：id（string）、type（string）、stage 名（string）、mode 字面量（string）、整数计数（number）、ISO 8601 时间戳（string）、布尔值（boolean）；reason 仅以 `reasonPresent: boolean` 与 `reasonLength: number` 表达。

11.5 THE Logging SHALL 沿用既有 `ctx.logger.info / debug / warn` 接口；SHALL NOT 引入新的 logger 实例 / 新的日志 transport / 新的日志库依赖。

11.6 THE Logging 事件键集合 SHALL 仅包含三个：`replan.triggered`、`replan.rejected`、`replan.blocked`；前缀固定为 `replan.`；SHALL NOT 借用 spec 3 的 inline edit info 日志事件键、SHALL NOT 在 spec 3 事件键 payload 中追加本 spec 字段。

### 需求 12：向后兼容性与零迁移

**用户故事：** 作为依赖现有 in-memory job store 与 GitHub Pages 静态预览的运行实例，我希望本 spec 落地后既有 job、既有响应结构、既有测试都不被破坏。

#### 验收标准

12.1 THE Feature SHALL NOT 引入数据库迁移、SHALL NOT 引入磁盘持久化变更、SHALL NOT 修改 In_Memory_Job_Store 的初始化签名、构造参数、默认值或启动时序；本 spec 是纯内存、纯路由扩展、纯 shared contract 追加可选字段的最小增量。

12.2 THE Feature SHALL NOT 修改既有路由 `POST /api/blueprint/jobs`、`POST /api/blueprint/generations`、`GET /api/blueprint/jobs/:jobId`、`POST /api/blueprint/intake`、`GET /api/blueprint/intake/:intakeId`、`GET /api/blueprint/clarifications/:sessionId`、`POST /api/blueprint/jobs/:jobId/route-selection`、`DELETE /api/blueprint/jobs/:jobId/route-selection` 的 HTTP 方法、URL、请求体字段、枚举值、字段类型或字段含义；新增字段 SHALL 以 `?:` 声明为可选、且在不适用场景中整体省略（不以 `null` / 空串占位）。

12.3 THE Feature SHALL 在 `BlueprintGenerationJob` 上新增的 `parentJobId?` / `branchedAt?` / `branchedFromStage?` 三字段一律以 `?:` 声明；非 branch job 上 SHALL 整体省略这三个字段（不以 `null` / 空串占位）；SHALL NOT 修改 `shared/blueprint/contracts.ts` 中由 spec 1 引入或既有的任一字段。

12.4 THE Feature SHALL NOT 修改 `MissionAutopilotSummary` / `mission-projection` 投影形态的状态机迁移序列、事件名、事件触发顺序或既有副作用；SHALL NOT 影响既有 mission runtime / workflow runtime / tasks-store / Office Task Cockpit / Web-AIGC runtime / autopilot 节点 11 阶段任一既有能力。

12.5 THE Feature SHALL NOT 修改、删除或调整 `server/tests/blueprint-routes.test.ts` 中任一既有 E2E 用例的 `expect` 断言或断言行；SHALL NOT 修改既有 bridge / 路由层单测的断言；新增测试 SHALL 仅以新文件或文件末尾追加 `describe` / `it` 的方式实现。

12.6 WHEN 本 spec 落地后执行 `npx vitest --config vitest.config.server.ts --run`，既有用例数量 SHALL 不减少、失败数 SHALL 为 0、新增 skip SHALL 为 0；spec 1 新增测试 SHALL 全绿；新增的 fast-check property test 与新增 example test SHALL 在同一次运行中通过。

12.7 THE Feature SHALL NOT 影响 GitHub Pages 静态预览路径（`npm run build:pages`）；纯前端预览的运行时 SHALL 在以下情况之一被识别为 Static_Preview_Mode：(a) 一次对 Replan_Endpoint 的探测请求收到 HTTP 4xx / 5xx；(b) 探测请求触发网络不可达；THEN THE Frontend SHALL 把 Replan_Button 置为 disabled 态（需求 1.9）、按"未分支"处理 job、SHALL NOT 因 Branch_Metadata 字段缺失而抛 schema 校验异常。

12.8 THE Feature SHALL NOT 引入新的 socket 通道、新的 BlueprintEventName 家族、新的持久化存储、新的鉴权字段、新的限流策略、新的环境变量主开关；Replan_Triggered_Event 复用既有 `BlueprintEvent` 形状与既有 audit / job-update channel（需求 5.2）。

12.9 THE Feature SHALL 尊重 `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md` 中已经描绘的"URL Pin / `workflowStageOverride` / Backend_Job_Stage 三层"语义：spec 3 的 inline edit 仅触达前两层（URL Pin 与 `workflowStageOverride` 由前端管理）；本 spec 的 replan 是仓库内**唯一**会主动重写 Backend_Job_Stage 的代码路径（in_place 模式倒回 fromStage、branch 模式新 job 从 fromStage 起）；其他模块若尝试写入 Backend_Job_Stage SHALL 在评审 / 测试中被识别为违规。Backend_Job_Stage 是最新生成进度，不是用户当前视口；合法"返回上一步"回看态由 spec 5 识别并保留。

### 需求 13：范围边界与不在范围内事项

**用户故事：** 作为代码评审人与系列 spec 3 / spec 4 / spec 5 的预备工作，我希望明确本 spec 的范围边界，以及哪些相关工作必须被排除并由系列后续 / 同期 spec 推进。

#### 验收标准

13.1 THE Feature SHALL NOT 在本 spec 提交中新增以下任一名称的导出 / 路由注册 / 字段类型 / 组件：`staleSince` / `invalidatedBy` 字段、`BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 依赖图、`invalidateDownstream` 引擎、`GET /stale-artifacts` 端点；这些由系列 spec 1 推进。本 spec 仅以 caller 身份复用。

13.2 THE Feature SHALL NOT 在本 spec 提交中新增以下任一名称的导出 / 路由注册 / 组件：字段级 inline edit UI、Auto_Invalidation_Hook、Stale_Badge、Right_Rail_Stale_Indicator、Per-Stage_Regenerate；这些由系列 spec 3 推进。本 spec 仅约束自身 modal 与 spec 3 inline confirmation 在 UI 上互不复用（需求 8.3 / 8.4）。

13.3 THE Feature SHALL NOT 在本 spec 提交中新增以下任一名称的导出 / 路由注册 / 组件：版本历史视图、版本快照、branch 比较 UI、parent / child job 切换 UI；这些由系列 spec 4 推进。本 spec 仅写入 Branch_Metadata 与 Branch_Index 作为预备数据。

13.4 THE Feature SHALL NOT 在本 spec 提交中新增以下任一名称的导出 / 调度策略 / 组件：stage transition 动画、跨组件原子刷新策略、浮动 toast 序列协调、页面 3→2→1 视觉过渡；这些由系列 spec 5 推进。

13.5 THE Feature SHALL NOT 修改 LLM prompt 文件、DAG 构造算法、generation 业务逻辑、route candidate 生成算法、spec_tree 派生算法的函数签名、返回值结构或既有测试断言；本 spec 是纯接线 + UI 增量，不触及生成业务。

13.6 THE Feature SHALL NOT 引入新的 Socket.IO 事件名 / channel name、新的请求头 / 请求体 / 中间件鉴权字段、新的 rate limit / 配额策略；本 spec 是纯内存、纯路由扩展、纯 shared contract 追加可选字段的最小增量（与需求 12.8 呼应）。

13.7 THE Feature SHALL NOT 在本 spec 提交中新增"清除 stale marker"或"删除 branch job"的端点 / 函数导出 / UI 控件 / CLI 入口任一形式入口；与 spec 1 单调性约束兼容。

13.8 IF 实施过程中识别到需要修改 mission runtime、workflow runtime 或 Office cockpit 主线的既有源码或测试，THEN THE Feature SHALL 把该修改延后到系列 spec 4 / spec 5 范围内推进，并在本 spec 的 design 阶段以 `TODO(spec-4-wiring)` / `TODO(spec-5-wiring)` 标注接线点位；本 spec 提交 SHALL NOT 包含上述主线模块的源码或测试改动。

13.9 THE Feature SHALL NOT 修改既有"返回上一步"按钮的语义、文案、显示位置；Replan_Button 是新增 UI，不复用 back 按钮（与需求 1.5 呼应）。

13.10 THE Feature SHALL NOT 把 Replan_Endpoint 在以下任一发布面暴露：对外发布的 API 文档、SDK 包导出清单、`docs/` 下的公共说明文件；它仅作为 autopilot blueprint 流的内部路由，沿用既有鉴权策略（需求 3.11）。
