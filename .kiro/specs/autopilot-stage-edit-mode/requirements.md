# 需求文档：Autopilot Stage Edit Mode

## 简介

本 spec 是 Cube Pets Office autopilot blueprint 流系列 5 个 spec 中的**第三个**，建立在系列 spec 1（`autopilot-asset-staleness-model`，规划 `staleSince` / `invalidatedBy` 字段、依赖图、`invalidateDownstream` 引擎与 `GET /stale-artifacts` 端点）与系列 spec 2（`autopilot-replan-and-branch-action`，规划 `POST /replan` 端点与确认弹窗交互模式）之上。

> **重要前置假设**：本 spec **假设 spec 1 / spec 2 先于本 spec 落地**。spec 1 与 spec 2 在仓库中目前**仅为需求文档（requirements-only）**，尚未落地代码。本 spec 在需求层把 spec 1 的引擎与字段、spec 2 的 modal 与 replan 事件视为"将要存在的纯函数 / 端点 / 类型 / 组件"使用，但 SHALL NOT 主张它们已经在仓库代码中落地。如果落地顺序倒置，本 spec 的实施可临时桩接 spec 1 / spec 2 的接线点位，但合并到主线时仍须以 spec 1 / spec 2 已落地为前提。

当前 autopilot 的 UX 痛点是：当用户通过"返回上一步"回到上游页面（页面 1：输入 / 澄清 / 路线）时，整个页面是**只读**的——`AutopilotRightRail.tsx` 中的 `isViewingCompletedStage === true` 把所有"推进 / 修改"按钮都禁用了。用户能看，但不能改。这与 `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md` 第 5 页时序图中"用户直接修改上游：例如改目标、重新澄清、换路线，也应自动使下游失效并重建"的产品语义不一致。

本 spec 实现"**回到上游页面后可就地编辑** + 编辑落库后**自动级联使下游过期**"这一交互闭环：

- **UI 层**：在 `viewing-completed` 模式下解锁 `input` / `clarification` / `route` 三个上游 stage 的可编辑控件（每个可编辑字段配一个"edit"图标，点击后从展示态切到编辑态）；其他 stage（spec_tree / spec_docs / effect_preview / prompt_packaging / runtime_capability / engineering_handoff / engineering_landing）继续保持只读，由系列后续 spec 推进。
- **后端 hook**：在既有 `PATCH /intake/:intakeId`、`POST|PATCH /clarifications/:sessionId/answers`、`POST /jobs/:jobId/route-selection`（重选场景）三条修改链路上自动调用 spec 1 的 `invalidateDownstream(job, fromStage, { reason: "upstream_*_changed" })`，复用 spec 1 引擎而不是 spec 2 的 `POST /replan` 端点（因为 inline edit 是隐式动作，不应消费 spec 2 的 replan 事件通道）。
- **视觉信号**：每个下游 artifact（spec_tree node / spec_documents 卡片 / effect_preview 瓷砖等）渲染"已过期"badge；当前 sub-stage 的右栏顶部展示黄色警告条 + per-stage"重新生成"按钮，按钮触发既有 stage-specific 生成端点而不是全量 replan。
- **冲突保护**：当下游正在 `running` 时，inline edit 被阻塞并提示用户等待。
- **轻量确认**：与 spec 2 的全屏 modal 不同，inline edit 的确认是字段级 small confirmation（"保存修改将使 N 个下游内容过期"），cancel 直接还原编辑。

本 spec 是 spec 2 的**补充而非替代**：spec 2 的"从这里重新规划"按钮承载用户**显式**的"我要重来"意图，弹全屏 modal、走 `POST /replan`、写 `replan.triggered` 事件；spec 3 的 inline edit 承载用户**隐式**的"我先改一下这里再说"意图，走既有 modify 端点、走 spec 1 引擎、不创建 branch、不写 `replan.triggered` 事件。两条路径在数据层都会通过 spec 1 引擎使下游 stale，但产品语义、确认 UI、事件审计完全分离。

本 spec **不**实现：spec 1 规划的 staleness 数据模型；spec 2 规划的显式 replan 按钮；spec 4 计划的版本历史 / branch 比较 UI；spec 5 计划的 stage transition 动画与跨组件原子状态协调；编辑 input / clarification / route 之外的字段（如 spec_tree node payload 直接编辑）；任何 LLM prompt / DAG 构造 / generation 业务逻辑的改造。

本 spec 属于 Feature 类型，requirements-first 工作流。

## 术语表

- **Upstream Stage**：在本 spec 内特指 blueprint 流的页面 1 三个 stage：`input`（含 target text / GitHub URLs）、`clarification`（含问题列表与 answers）、`route_generation`（含 route candidates 与 route selection）。其他 stage 一律称为 **Downstream Stage**。
- **Edit Mode**：单字段维度的 UI 状态机：`view`（默认展示态，旁边带 edit 图标）→ `editing`（控件可编辑、出现 inline confirm 与 cancel）→ `submitting`（请求中、控件禁用）→ `view`（落库成功、展示新值）。
- **Inline Edit**：用户在 viewing-completed 模式下对单个上游字段从 view 切到 editing 后提交的动作，区别于系列 spec 2 的"从这里重新规划"显式动作。
- **Edit Trigger**：用户点击字段旁的 edit 图标的事件，将该字段从 view 切到 editing。
- **Edit Submit**：用户在 editing 态点击 inline confirm 按钮（或对支持 edit-on-blur 的字段失焦）的事件，触发后端 modify 请求。
- **Edit Cancel**：用户在 editing 态点击 cancel 按钮（或按 Esc）的事件，将该字段恢复到 view 态、保留原值。
- **Inline Confirmation**：editing 态下出现的轻量字段级确认提示，文案至少包含"保存修改将使 N 个下游内容过期，确认？"语义；与系列 spec 2 的 `Replan_Confirmation_Modal` 显式区分。
- **Stale Badge**：渲染在每个 downstream artifact 视图（specTree node、specDocument card、effectPreview tile 等）上的"已过期"小标签，依据 artifact 的 `staleSince` 字段是否非空显示；hover 显示 tooltip "由 [上游 stage] 在 [时间] 修改导致"。
- **Right Rail Stale Indicator**：当用户当前查看的 sub-stage 对应的 artifact 是 stale 时，`AutopilotRightRail.tsx` 顶部出现的黄色横幅，含"此内容已过期 · [点击重新生成]"文案与触发按钮。
- **Per-Stage Regenerate**：右栏黄色横幅按钮触发的"只重新生成当前 stage"动作，仅调用既有的 stage-specific 生成端点（`POST /jobs/:jobId/route-selection`、`POST /jobs/:jobId/spec-documents`、效果预览生成端点等），而不调用 spec 2 的 `POST /replan` 全量重规划。每次 per-stage regenerate 仍然会通过 spec 1 引擎级联标记其更下游 artifact stale。
- **Modify Endpoints**：本 spec hook 的三条既有后端端点：
  - `PATCH /api/blueprint/intake/:intakeId`（target / GitHub URL 改写）；本 spec 视该路由为既有可写端点，如当前后端实现尚未提供 `PATCH` 方法，则在 design 阶段一并定义其请求 / 响应形态作为本 spec 的 modify 入口；
  - `POST /api/blueprint/clarifications/:sessionId/answers` 与 `PATCH /api/blueprint/clarifications/:sessionId/answers`（answers 改写）；
  - `POST /api/blueprint/jobs/:jobId/route-selection`（重选场景，已既存路由，本 spec 仅扩展其在"二次调用"时的 invalidation 副作用）。
- **Auto-Invalidation Hook**：在 Modify Endpoints 内部、于业务逻辑写回 in-memory store 成功之后、在响应发出之前，自动调用 spec 1 `invalidateDownstream(job, fromStage, options)` 的代码段。
- **Conflict Detection**：服务端在 Auto-Invalidation Hook 之前检查"该 job 的下游 stage 中是否有处于 `running` 状态的 generation"，若有则拒绝 modify 请求并返回结构化错误。
- **Stale Toast**：编辑成功后前端展示的 toast 文案，至少包含"已保存修改，N 个下游内容已标记为过期"语义。
- **In-Memory Job Store**：服务端既有 `BlueprintJobStore`（位于 `server/routes/blueprint/**`），与 spec 1 / spec 2 共用。
- **Invalidation Engine**：spec 1 规划的纯函数 `invalidateDownstream(job, fromStage, options?)`（spec 1 仍为需求文档，尚未在仓库中落地）；本 spec 仅复用、不修改其签名与语义。
- **Replan Endpoint**：spec 2 规划的 `POST /api/blueprint/jobs/:jobId/replan`（spec 2 仍为需求文档，尚未在仓库中落地）；本 spec 不调用、不修改、不依赖。
- **Stale Artifacts Endpoint**：spec 1 规划的 `GET /api/blueprint/jobs/:jobId/stale-artifacts`（spec 1 仍为需求文档，尚未在仓库中落地）；本 spec 仅作为前端读取下游影响数量的可选数据源，SHALL NOT 修改其响应 schema。
- **Right Rail**：前端组件 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`，承载当前 sub-stage 的产物视图与控制按钮；本 spec 在其顶部追加 stale indicator 区域。
- **Autopilot Route Page**：前端组件 `client/src/pages/autopilot/AutopilotRoutePage.tsx`，承载页面 1 / 页面 2 / 页面 3 的外层壳；本 spec 在其页面 1 渲染区域内为 input / clarification / route 字段挂载 edit 模式控件。
- **Frontend Job Store**：前端 Zustand store（位于 `client/src/lib/`，包含 job 数据、staleArtifactIds 索引、specTree / specDocuments / effectPreview 等下游派生 store），本 spec 在 inline edit 成功后协调更新但不重构 store 结构。

## 需求

### 需求 1：上游字段可编辑化（页面 1 范围）

**用户故事：** 作为产品用户，我希望在通过"返回上一步"回看到页面 1 时，仍然可以就地编辑目标 / GitHub URLs / 澄清答案 / 路线选择，而不必先点"从这里重新规划"开一条全新分支。

#### 验收标准

1.1 THE Frontend SHALL 在 `client/src/pages/autopilot/AutopilotRoutePage.tsx` 的 `input` stage 渲染区域内，为以下字段挂载 Edit_Mode 控件：目标文本（target text）、GitHub URLs 列表（每个 URL 视为独立可编辑字段）。

1.2 THE Frontend SHALL 在 `clarification` stage 渲染区域内，为每个 clarification answer（按 questionId 索引）挂载 Edit_Mode 控件。

1.3 THE Frontend SHALL 在 `route_generation` stage 渲染区域内，为"当前选中路线"挂载 Edit_Mode 控件，允许用户切换到同一 routeSet 中的其他 route candidate（即"重新选择路线"，复用既有 `POST /jobs/:jobId/route-selection` 路由作为 modify 入口）。

1.4 THE Frontend SHALL NOT 在 `spec_tree` / `spec_docs` / `preview` / `effect_preview` / `prompt_packaging` / `runtime_capability` / `engineering_handoff` / `engineering_landing` 任一 stage 的渲染区域挂载 Edit_Mode 控件；这些 stage 在 viewing-completed 模式下继续保持只读。

1.5 THE Frontend SHALL 仅在 `isViewingCompletedStage === true` 且当前 stage 属于 input / clarification / route_generation 时显示 edit 图标；在 stage 处于推进路径的当前 stage（即"未完成、正在推进"）时复用既有的"输入 / 提交"控件，SHALL NOT 重复挂载 edit 图标。

1.6 THE Edit_Mode 控件 SHALL 在 view 态显示当前值 + 紧邻一个 edit 图标（图标可达性标识符稳定，例如 `data-testid="autopilot-edit-{fieldKey}"`）；在 editing 态显示既有的 input / textarea / select 控件 + Inline_Confirmation 区域 + cancel 按钮。

1.7 THE Edit_Mode 控件 SHALL 在键盘交互上至少支持：`Enter` 触发 Edit_Submit（仅当字段处于 editing 态且未禁用）、`Esc` 触发 Edit_Cancel；与既有 autopilot 页面的可达性约定一致。

1.8 THE Frontend SHALL NOT 引入除"在字段旁渲染 edit 图标 / 切换 view ↔ editing 态 / Inline_Confirmation"之外的其他 UI 触发路径；inline edit 必须经用户在 edit 图标上的显式点击触发，SHALL NOT 通过 URL query / 快捷键 / socket 事件自动进入 editing 态。

### 需求 2：Inline Confirmation 与提交 / 取消行为

**用户故事：** 作为产品用户，我希望在保存上游修改之前能看到一句简短提示告诉我会影响多少下游内容，并能轻松撤回；不希望每改一个字段都弹一个全屏 modal。

#### 验收标准

2.1 WHEN 用户从 view 态点击 edit 图标进入 editing 态，THE Frontend SHALL 立刻显示该字段的可编辑控件 + 一个 Inline_Confirmation 区域（紧邻字段、不遮挡其他字段）；Inline_Confirmation 区域 SHALL 包含一个 confirm 按钮、一个 cancel 按钮，以及一行简短文案。

2.2 THE Inline_Confirmation 文案 SHALL 在该 stage 之后存在至少 1 个下游 artifact 时，至少包含语义"保存修改将使 N 个下游内容过期，确认？"，其中 N 由前端基于 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 与当前 job 的 artifact 列表派生（也可调用 spec 1 的 `GET /stale-artifacts` 作为辅助数据，但 SHALL NOT 修改其响应 schema）。

2.3 WHEN 该 stage 之后没有任何下游 artifact（例如 job 还在 `input` stage、尚未生成任何下游产物），THE Inline_Confirmation 文案 SHALL 显示等价的"无下游内容，将直接保存"语义；confirm 按钮仍可点击。

2.4 WHEN 用户点击 cancel 按钮（或按 Esc），THE Edit_Mode 控件 SHALL 立刻回到 view 态、字段值还原为编辑前的原值、SHALL NOT 发起任何网络请求、SHALL NOT 修改前端任一 store。

2.5 WHEN 用户点击 confirm 按钮（或在支持 edit-on-blur 的字段上失焦），THE Edit_Mode 控件 SHALL 切到 submitting 态、禁用 confirm 按钮防止重复提交、并以新值发起对应的 Modify_Endpoint 请求。

2.6 IF 后端返回 4xx / 5xx，THEN THE Edit_Mode 控件 SHALL 切回 editing 态（保留用户输入的新值）、显示错误提示、重新启用 confirm 按钮、SHALL NOT 修改下游 store。

2.7 WHEN 后端返回 2xx，THE Edit_Mode 控件 SHALL 在前端 store 与 stale 索引都已更新后再切回 view 态，避免出现"已切回但 store 还是旧值"的中间态。

2.8 THE Inline_Confirmation SHALL NOT 复用系列 spec 2 的 `Replan_Confirmation_Modal` 组件；两者在视觉、文案、键盘交互、组件树位置上保持独立，避免用户混淆 inline edit 与显式 replan 的语义。

2.9 THE Inline_Confirmation SHALL NOT 包含"创建新分支"选项；inline edit 一律为"在当前 job 上 stale 下游"的语义（等价于 spec 2 的 `mode = "in_place"` 但通过既有 modify 端点而非 `POST /replan` 实现）。

### 需求 3：Auto-Invalidation Hook 在 Modify Endpoints 上的接线

**用户故事：** 作为后端维护者，我希望既有的修改上游接口在落库成功后能自动级联标记下游 stale，使前端无需在每次修改后再单独调用 invalidation；同时希望接线点集中、可审阅、与 spec 1 / spec 2 边界清晰。

#### 验收标准

3.1 THE Server_Blueprint_Module SHALL 在 `PATCH /api/blueprint/intake/:intakeId` 的请求处理函数内，于业务写回 In-Memory_Job_Store 成功之后、HTTP 响应发出之前，调用 spec 1 的 `invalidateDownstream(job, "input", options)`，其中 `options.reason = "upstream_target_changed"`、`options.triggeringArtifactId` 与 `options.triggeringArtifactType` 取自被修改的 intake 关联的最新 artifact（具体取值由 design 阶段对齐 spec 1 既有调用约定）。

3.2 THE Server_Blueprint_Module SHALL 在 `POST /api/blueprint/clarifications/:sessionId/answers` 与 `PATCH /api/blueprint/clarifications/:sessionId/answers` 的请求处理函数内，于业务写回 In-Memory_Job_Store 成功之后、HTTP 响应发出之前，调用 `invalidateDownstream(job, "clarification", { reason: "upstream_clarification_changed", ... })`。

3.3 THE Server_Blueprint_Module SHALL 在 `POST /api/blueprint/jobs/:jobId/route-selection` 的请求处理函数内，**仅当该路由是当前 job 上对该路由的"二次或后续调用"**（即此前已存在被选中的 route_selection artifact 且本次请求带来一个不同的 routeId 或同一 routeId 的强制重选）时，于业务写回 In-Memory_Job_Store 成功之后、HTTP 响应发出之前，调用 `invalidateDownstream(job, "route_generation", { reason: "upstream_route_selection_changed", ... })`；首次选择路线（即既有"从无到有"路径）SHALL NOT 触发本 hook。

3.4 THE Auto_Invalidation_Hook SHALL 仅在 Modify_Endpoints 业务逻辑确认"实际写入了新的上游值"后调用引擎；如请求体与既有值在结构上等价（noop 修改），THE Auto_Invalidation_Hook SHALL NOT 调用引擎、SHALL NOT 写入任一 stale marker。

3.5 THE Auto_Invalidation_Hook SHALL 把引擎返回的"新 job"对象写回 In-Memory_Job_Store；后续的 HTTP 响应 SHALL 反映写回后的 job 形态（含被刷新的 `staleArtifactIds` 索引）。

3.6 THE Auto_Invalidation_Hook SHALL NOT 调用系列 spec 2 的 `POST /replan` 端点、SHALL NOT 写入 spec 2 定义的 `replan.triggered` 事件；inline edit 在事件层与 spec 2 显式 replan 严格分离。

3.7 THE Auto_Invalidation_Hook SHALL NOT 修改 `DELETE /api/blueprint/jobs/:jobId/route-selection` 的语义、SHALL NOT 在该端点内追加 invalidation 调用（该端点继续作为既有破坏性重置存在）。

3.8 THE Auto_Invalidation_Hook SHALL 复用 spec 1 引擎签名与 `BlueprintStaleReason` 枚举；如本 spec 提到的 `"upstream_target_changed"` / `"upstream_clarification_changed"` / `"upstream_route_changed"` / `"upstream_route_selection_changed"` 中任一取值与 spec 1 的合法枚举不一致，应以 spec 1 既有取值为准（具体映射在 design 阶段对齐），SHALL NOT 在 spec 3 内扩展 `BlueprintStaleReason` 取值。

3.9 IF Auto_Invalidation_Hook 在调用 `invalidateDownstream` 时抛出异常（理论上 spec 1 引擎为纯函数不应抛错，但实现层 SHALL 防御处理），THEN THE Server_Blueprint_Module SHALL 仍然返回 modify 业务本身的成功响应（即字段已落库），但 SHALL 通过 `warn` 级日志记录 invalidation 失败原因；SHALL NOT 因为 invalidation 失败而把 modify 业务回滚。

### 需求 4：Conflict Detection（下游正在运行时阻塞 inline edit）

**用户故事：** 作为后端维护者，我希望当下游某个 stage 还在 generation 中时，inline edit 被显式阻塞而不是默默使一个正在 running 的产出过期；用户应被提示等待。

#### 验收标准

4.1 IF 当前 job 的某个下游 stage 处于 `running` / 等价的 active generation 状态（具体字段由 design 阶段对齐既有 BlueprintGenerationJob.status / handoffState / nextAction），THEN 任一 Modify_Endpoint 在调用 Auto_Invalidation_Hook 之前 SHALL 检测到该状态并返回 HTTP 409 + `{ "error": "downstream_running", "runningStage": "<stage>" }`，SHALL NOT 修改 job 的任一字段、SHALL NOT 写入 stale marker。

4.2 THE Frontend SHALL 在 inline edit 的 submitting 态收到 409 + `error === "downstream_running"` 时，把 Edit_Mode 控件切回 editing 态、保留用户输入的新值、显示提示文案"正在生成 [stage]，请等待完成"或等效语义、重新启用 confirm 按钮。

4.3 THE Frontend SHALL 在用户进入 editing 态前不主动轮询 generation 状态；Conflict_Detection 仅在 Edit_Submit 时由后端 gate，前端不重复实现。

4.4 THE Conflict_Detection SHALL NOT 阻塞用户从 view 态切到 editing 态（即用户仍可看到 edit 图标并点击），仅在提交时拒绝。

4.5 THE Conflict_Detection SHALL NOT 阻塞系列 spec 2 的 `POST /replan` 端点；spec 2 已有自己的 `running` guard（spec 2 需求 3.7 / 10.3），与本 spec guard 各自独立。

### 需求 5：Stale Badge 渲染（下游 artifact 视图层）

**用户故事：** 作为产品用户，我希望在下游 artifact（spec 树节点、spec 文档卡片、效果预览瓷砖）上一眼看到"已过期"标记，以及它是因为哪个上游修改导致的。

#### 验收标准

5.1 WHEN 一个 downstream artifact 的 `staleSince` 字段非空，THE Frontend SHALL 在该 artifact 的视图组件上渲染一个"已过期"小标签，文案至少包含"已过期"中文语义（英文版本由既有 i18n 机制处理）。

5.2 THE Stale_Badge 至少 SHALL 在以下视图组件上渲染：spec_tree node 视图（节点列表 / 节点卡片）、spec_documents 卡片、effect_preview 瓷砖；其他 artifact 视图（prompt_packages、runtime / engineering / artifact_memory 等）由 design 阶段视既有组件结构决定是否一并接入，但本 spec 至少要求覆盖前述 3 类。

5.3 WHEN 用户 hover 在 Stale_Badge 上，THE Frontend SHALL 显示 tooltip，至少包含语义"由 [上游 stage 中文名] 在 [本地化时间] 修改导致"，其中"上游 stage"取自 `invalidatedBy.stage`、"时间"取自 `invalidatedBy.triggeredAt`（spec 1 已定义字段）。

5.4 WHEN `staleSince` 字段为 `undefined` / `null` / 缺失，THE Frontend SHALL NOT 渲染 Stale_Badge；该 artifact 视为 fresh，与从未被标记过的 artifact 视觉一致。

5.5 THE Stale_Badge SHALL 是纯展示组件，不带任何点击 / 操作语义；用户点击 badge 本身 SHALL NOT 触发任何动作（重新生成入口由 Right_Rail_Stale_Indicator 承担）。

5.6 THE Stale_Badge 组件 SHALL 在视觉上与系列 spec 2 的 `Replan_Confirmation_Modal` 中的"将受影响"列表保持视觉一致（同一种黄色 / 警告色），方便用户对照两条路径产生的同一种 stale 语义。

### 需求 6：Right Rail Stale Indicator 与 Per-Stage Regenerate

**用户故事：** 作为产品用户，我希望当我查看的当前内容已经过期时，右栏顶部明确告诉我"这部分需要重新生成"，并且我点一下就能只重新生成这一段，而不必走完整的"从这里重新规划"。

#### 验收标准

6.1 WHEN 用户当前查看的 sub-stage 对应的 artifact 是 stale（即其 `staleSince` 非空），THE Frontend SHALL 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 顶部渲染一个 Right_Rail_Stale_Indicator 横幅；横幅 SHALL 使用警告色（黄色），SHALL 包含文案语义"此内容已过期"以及一个 Per-Stage_Regenerate 按钮。

6.2 WHEN 用户当前查看的 sub-stage 对应的 artifact 是 fresh，THE Frontend SHALL NOT 渲染 Right_Rail_Stale_Indicator；右栏顶部维持既有视觉，不引入空横幅占位。

6.3 THE Per-Stage_Regenerate 按钮 SHALL 按当前 sub-stage 调用对应的既有 stage-specific 生成端点：
  - 当前 sub-stage 为 `spec_tree` 时，按钮文案为"重新派生 SPEC 树"，触发 `POST /api/blueprint/jobs/:jobId/route-selection`（即重新触发 spec_tree 派生）；
  - 当前 sub-stage 为 `spec_docs` / `spec_documents` 时，按钮文案为"重新生成文档"，触发 `POST /api/blueprint/jobs/:jobId/spec-documents`（既有端点）；
  - 当前 sub-stage 为 `effect_preview` 时，按钮文案为"重新生成预览"，触发既有效果预览生成端点（具体路径在 design 阶段对齐既有实现）；
  - 其他 sub-stage（prompt_packaging / runtime_capability / engineering_handoff / engineering_landing 等）由 design 阶段视既有 stage-specific 端点决定是否暴露按钮，但本 spec 至少要求覆盖前述 3 类。

6.4 THE Per-Stage_Regenerate SHALL NOT 调用系列 spec 2 的 `POST /replan` 端点；它仅是对既有 stage-specific 生成端点的一个 UI 入口包装。

6.5 WHEN Per-Stage_Regenerate 触发的生成完成（即 stage-specific 端点的响应或 socket 事件返回完成态），THE Frontend SHALL 通过 spec 1 的 `staleSince` 字段（在 stage-specific 生成端点的响应中应自然消失）刷新当前 sub-stage 的 artifact 状态；如果该次 per-stage 生成的下游还有更下游的 stage（例如 spec_tree 重新派生后，spec_docs / effect_preview 等仍然过期），那些更下游的 stale 状态由 spec 1 引擎在该 stage-specific 端点内部级联保持（具体接线由 design 阶段确认是否需要 stage-specific 端点也调用 `invalidateDownstream`）。

6.6 THE Per-Stage_Regenerate SHALL 在按钮被点击后立即进入 disabled 态防止重复触发；后端响应或 socket 事件返回前 SHALL NOT 重新启用按钮。

6.7 IF 当前 sub-stage 对应的 artifact 是 stale 且其上游中有 stage 仍处于 `running` 状态（极端情况：用户刚触发 inline edit 但上游还没结束），THEN Per-Stage_Regenerate 按钮 SHALL 进入 disabled 态并显示 hint"等待上游生成完成"；具体判定由 design 阶段对齐既有 generation 状态字段。

6.8 THE Right_Rail_Stale_Indicator SHALL NOT 与既有"返回当前阶段"按钮在同一行抢占视觉位置；两者共存时 stale indicator 优先位于顶部（醒目位置），既有按钮位于其下方或既有位置，SHALL NOT 被 stale indicator 覆盖。

### 需求 7：Frontend Store 协调与导航

**用户故事：** 作为产品用户，我希望保存上游修改后页面不要跳走、当前停留的页面立刻反映新值与"已过期"信号，并且能从 toast 上看到大概影响了几个下游。

#### 验收标准

7.1 WHEN inline edit 成功（即任一 Modify_Endpoint 返回 2xx），THE Frontend SHALL 用响应中携带的最新 job 对象（含被刷新的 `staleArtifactIds` 索引）刷新本地 job store；具体字段更新粒度由 design 阶段对齐既有 store 拆分（job / specTree / specDocuments / effectPreview / promptPackages / runtime 等）。

7.2 THE Frontend SHALL 在 inline edit 成功后**保持当前页面 / sub-stage 不变**：SHALL NOT 自动调用 `resetPin()`、SHALL NOT 修改 `workflowStageOverride`、SHALL NOT 自动导航到下游 stage；用户继续停留在原来的页面 1 上。

7.3 THE Frontend SHALL 在 inline edit 成功后通过既有 toast / notification 机制显示一条 Stale_Toast，至少包含语义"已保存修改，N 个下游内容已标记为过期"，其中 N 由响应中刷新后的 `staleArtifactIds` 长度差派生（也可由前端基于 spec 1 依赖图本地计算）。

7.4 WHEN inline edit 触发的 modify 没有产生任何下游 stale（例如该 stage 之后无下游 artifact），THE Frontend SHALL 仍展示 Stale_Toast，但文案 SHALL 切换为等价的"已保存修改"语义；SHALL NOT 显示"0 个下游内容"这种字面化文案。

7.5 IF 后端在 inline edit 成功后通过 socket 推送了相关事件（例如既有的 stale.updated / staleArtifactIds 同步事件，由 spec 1 / spec 2 已存在或后续 spec 引入），THEN THE Frontend SHALL 仅把它作为审计 / 时间线展示数据，SHALL NOT 因该事件触发第二次 store 重置（避免与 7.1 同步路径重复）。

7.6 THE Frontend SHALL 在 inline edit 成功后立刻用刷新后的 `staleArtifactIds` 重新渲染所有下游视图组件上的 Stale_Badge 与 Right_Rail_Stale_Indicator；视觉切换 SHALL 在 React batch 同一帧内完成，避免出现"toast 已弹但 badge 还没出现"的中间态。

7.7 THE Frontend SHALL 在 inline edit 处于 submitting 态时把当前正在编辑的字段控件置为 disabled，但 SHALL 保持页面其他区域可滚动 / 可阅读；SHALL NOT 整页加锁、SHALL NOT 弹遮罩。

### 需求 8：与系列 Spec 2 的关系（边界与互斥）

**用户故事：** 作为代码评审人与产品维护者，我希望本 spec 的 inline edit 与系列 spec 2 的"从这里重新规划"在数据层共享 spec 1 引擎的同时，在产品语义、UI 组件、事件审计、API 入口上严格分离，避免功能漂移。

#### 验收标准

8.1 THE Feature SHALL NOT 修改系列 spec 2 的 `POST /api/blueprint/jobs/:jobId/replan` 路由的请求 / 响应形态、guard rails、事件追加逻辑或 branch 创建语义。

8.2 THE Feature SHALL NOT 在 Modify_Endpoints 内部调用 `POST /replan`、SHALL NOT 写入 spec 2 定义的 `replan.triggered` 事件；inline edit 与 spec 2 显式 replan 的事件通道不重叠。

8.3 THE Feature SHALL NOT 修改系列 spec 2 的 `Replan_Confirmation_Modal` 组件、SHALL NOT 在 inline edit 流程中复用其 UI；Inline_Confirmation 是独立的轻量字段级组件。

8.4 THE Feature SHALL NOT 修改系列 spec 2 在前端 store 中追加的 branch 关系处理逻辑（`parentJobId` / `branchedAt` 字段）；inline edit 一律在当前 job 上进行，SHALL NOT 创建 branch。

8.5 THE Feature SHALL 复用系列 spec 1 的 `BlueprintStaleSource` / `BlueprintStaleReason` / `staleSince` / `invalidatedBy` / `staleArtifactIds` 字段；SHALL NOT 引入新的字段或类型来表达 inline edit 触发的 stale。

8.6 WHERE 用户希望"创建新分支"而非"原地标记过期"，THE Frontend SHALL 引导用户走系列 spec 2 的"从这里重新规划"按钮，inline edit 自身 SHALL NOT 提供 branch 选项；产品语义上 inline edit ⊆ spec 2 Mode A（in_place）的隐式触发路径，但 API 入口与确认 UI 完全独立。

### 需求 9：与系列 Spec 1 的关系（引擎复用与零修改）

**用户故事：** 作为代码评审人，我希望本 spec 在使用 spec 1 已有引擎时不修改其签名、不绕过其语义、不重复实现 stale marker 写入逻辑。

#### 验收标准

9.1 THE Feature SHALL NOT 修改系列 spec 1 的 `invalidateDownstream(job, fromStage, options)` 函数签名或行为；本 spec 仅在 Modify_Endpoints 内部以**调用方**身份复用该函数。

9.2 THE Feature SHALL NOT 修改系列 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`、`getTransitiveDownstreamStages`、`isDownstreamOf`、`mapArtifactTypeToStage` 任一辅助函数。

9.3 THE Feature SHALL NOT 修改系列 spec 1 的 `GET /api/blueprint/jobs/:jobId/stale-artifacts` 端点形态；前端 Inline_Confirmation 文案派生与下游影响计数 SHALL 优先基于本地依赖图派生，确实需要时再以"调用 spec 1 端点 + 不修改其响应"方式辅助。

9.4 THE Feature SHALL NOT 在 spec 3 内导出"清除 stale marker"的纯函数或路径；spec 1 已声明的 Monotonic_Staleness 不被本 spec 削弱。

9.5 THE Feature SHALL NOT 修改 `shared/blueprint/contracts.ts` 中由 spec 1 / spec 2 引入的任一字段类型或可选性；如本 spec 实现需要在 contracts 上追加字段（例如某些 modify 端点的响应 schema 需追加 `staleArtifactIds` 摘要），SHALL 仅以**追加可选字段**方式完成，沿用 spec 1 / spec 2 的追加式扩展约定。

### 需求 10：属性测试与示例测试覆盖

**用户故事：** 作为代码评审人，我希望本 spec 在数据层有清晰的 fast-check property test 与 example-based unit test 覆盖，证明 inline edit 在任意上游字段、任意 job 形态下都能正确触发下游级联 stale，并且重复编辑同一字段是幂等的。

#### 验收标准

10.1 THE Feature SHALL 在 `server/routes/blueprint/stage-edit/__tests__/` 下添加至少 3 组测试文件：
  - `intake-modify-invalidation.test.ts`：包含 fast-check property test，覆盖"任意 input 字段被 inline edit 后，引擎级联标记的下游 artifact 集合等价于 spec 1 `getTransitiveDownstreamStages('input')` 派生集合"；迭代次数 ≥ 100；同时包含 example-based 测试覆盖需求 3.1 / 3.4 / 3.9 的写入规则与边界。
  - `clarification-modify-invalidation.test.ts`：与上类似，覆盖 clarification fromStage 的 invalidation 行为；迭代次数 ≥ 100。
  - `route-selection-reselection.test.ts`：覆盖"二次调用 `POST /jobs/:jobId/route-selection` 触发 invalidation；首次调用不触发 invalidation"的差异（需求 3.3）；包含 fast-check 验证幂等性（同一 routeId 重复重选不引入新 stale marker，沿用 spec 1 需求 4 幂等性约束）；迭代次数 ≥ 100。

10.2 THE Property_Tests SHALL 验证以下三条核心性质（与本 spec 关键不变量对齐）：
  - **传递下游全 stale**：对任意 job、任意上游字段被 inline edit，产生的新 job 中所有"按 spec 1 依赖图位于 fromStage 传递下游"的 artifact 的 `staleSince` 字段 SHALL 非空；
  - **同字段编辑两次幂等**：对同一字段连续两次 inline edit（值不同或值相同均覆盖），第二次产生的新 job 在 `staleSince` 集合上与第一次结构等价；幂等性沿用 spec 1 需求 4；
  - **无下游则 no-op staleness**：对没有任何下游 artifact 的 job 进行 inline edit，新 job 的 `staleArtifactIds` 长度 SHALL 与编辑前等价；上游字段的新值 SHALL 已落库（即 modify 业务成功）。

10.3 THE Conflict_Detection SHALL 通过 example-based 测试覆盖：当下游 stage 处于 `running` 状态时 modify 请求返回 409 + `error === "downstream_running"` 且 job 任一字段不变。

10.4 THE Property_Tests SHALL 使用 fast-check 提供的 `fc.assert` + `fc.property` 组合；SHALL NOT 使用 `it.skip` 或 `describe.skip` 默认跳过。

10.5 THE Property_Tests 的 arbitrary 生成器 SHALL 至少能覆盖：空 artifact 列表的 job、所有 stage 都有 artifact 的 job、部分 stage 已有 stale marker 的 job（与 spec 1 单调性测试兼容）、随机的上游字段编辑序列。

10.6 THE Feature SHALL NOT 引入新的测试运行入口；新增测试 SHALL 通过 `vitest.config.server.ts` 既有的 server-side test runner 自动发现。

10.7 IF 在测试中需要构造 `BlueprintGenerationJob` 样例，THE Test_Files SHALL 优先复用 spec 1 在 `server/routes/blueprint/staleness/__tests__/__fixtures__/` 下与 spec 2 在 `server/routes/blueprint/replan/__tests__/__fixtures__/` 下的 fixture / factory；如必须新增 factory，SHALL 放在 `server/routes/blueprint/stage-edit/__tests__/__fixtures__/` 下。

10.8 THE Feature SHALL 在 `client/src/pages/autopilot/__tests__/` 或等效既有目录下新增 example-based 组件测试，覆盖：edit 图标可见性条件（需求 1.5 / 1.4）、Inline_Confirmation 交互（需求 2.4 / 2.5 / 2.7）、stale badge 渲染（需求 5.1 / 5.4）、Right_Rail_Stale_Indicator 渲染条件（需求 6.1 / 6.2）、Per-Stage_Regenerate 触发既有端点而非 spec 2 replan（需求 6.4）。组件测试 SHALL NOT 使用 fast-check（fast-check 仅用于服务端纯函数 / 路由层）。

### 需求 11：日志与可观测性

**用户故事：** 作为排障人员，我希望 inline edit 行为在 server 日志中可见，且与 spec 2 显式 replan 区分清楚，便于定位"为什么这个 spec_tree 突然变 stale 了"。

#### 验收标准

11.1 WHEN Auto_Invalidation_Hook 写入了至少 1 个 stale marker，THE Server_Blueprint_Module SHALL 通过既有 logger 输出一条 `info` 级结构化日志，至少包含：`jobId`、`fromStage`、`reason`、`triggeringEndpoint`（取值如 `"intake_patch"` / `"clarification_answers"` / `"route_reselection"`）、`markedArtifactCount`；该日志 SHALL 与 spec 1 既有 invalidation 日志在结构上一致（沿用 spec 1 需求 11.1）。

11.2 WHEN Auto_Invalidation_Hook 因 noop 修改（需求 3.4）或无下游（需求 3.10 等价场景）而写入 0 个新 marker，THE Server_Blueprint_Module SHALL 输出一条 `debug` 级日志，至少包含：`jobId`、`fromStage`、`triggeringEndpoint`；`info` 级 SHALL NOT 输出。

11.3 WHEN Modify_Endpoint 因 Conflict_Detection 返回 409，THE Server_Blueprint_Module SHALL 输出一条 `warn` 级日志，至少包含：`jobId`、`triggeringEndpoint`、`runningStage`；SHALL NOT 触发 `info` 级或调用 invalidation 引擎。

11.4 THE Logging SHALL NOT 输出 artifact `payload` 内容、SHALL NOT 输出用户输入的 target text / clarification answer / GitHub URL / API key / token 等敏感或大文本内容；仅输出 id / type / stage / reason / 计数等元数据。

11.5 THE Logging SHALL 沿用既有 logger（`ctx.logger.*` 或等价路径），SHALL NOT 引入新的 logger 实例 / 新的日志 transport。

11.6 THE Logging SHALL NOT 与 spec 2 的 `replan.triggered` 事件混入同一事件流；inline edit 的 `info` 日志键 SHALL 与 spec 2 显式 replan 的日志键在前缀上可区分（具体前缀由 design 阶段对齐既有命名规范）。

### 需求 12：向后兼容性与零迁移

**用户故事：** 作为依赖现有 in-memory job store 与 GitHub Pages 静态预览的运行实例，我希望本 spec 落地后既有 job、既有响应结构、既有测试都不被破坏。

#### 验收标准

12.1 THE Feature SHALL NOT 引入数据库迁移、SHALL NOT 引入磁盘持久化变更、SHALL NOT 修改 In-Memory_Job_Store 的初始化逻辑。

12.2 THE Feature SHALL NOT 修改既有路由 `POST /api/blueprint/jobs`、`POST /api/blueprint/generations`、`GET /api/blueprint/jobs/:jobId`、`POST /api/blueprint/intake`、`GET /api/blueprint/intake/:intakeId`、`GET /api/blueprint/clarifications/:sessionId`、`DELETE /api/blueprint/jobs/:jobId/route-selection` 等任一既有端点的请求形态、响应 schema 或既有字段；仅允许在响应中以**追加方式**附带新可选字段（例如响应中携带刷新后的 `staleArtifactIds` 摘要）。

12.3 THE Feature SHALL NOT 修改 `shared/blueprint/contracts.ts` 中 spec 1 / spec 2 引入的任一字段；只允许向既有响应类型上以**追加可选字段**方式扩展（沿用 spec 1 / spec 2 的追加式扩展约定）。

12.4 THE Feature SHALL NOT 修改、删除或调整 `server/tests/blueprint-routes.test.ts` 中任一既有 E2E 用例的断言；SHALL NOT 修改既有 bridge / 路由层单测；只允许新增测试。

12.5 WHEN 本 spec 落地后执行 `npx vitest --config vitest.config.server.ts --run`，所有既有测试与 spec 1 / spec 2 测试 SHALL 保持通过状态；新增的 fast-check property test 与新增 example test SHALL 在同一次运行中通过。

12.6 THE Feature SHALL NOT 影响 GitHub Pages 静态预览路径（`npm run build:pages`）；纯前端预览的运行时 SHALL 在所有 modify 端点不可用时维持 viewing-completed 模式的既有只读行为，并按 fresh 处理 stale 字段缺失的 artifact，不报错、不抛 schema 校验异常；inline edit 控件在静态预览模式下 SHALL 展示禁用态而非崩溃。

12.7 THE Feature SHALL NOT 修改 mission runtime、workflow runtime、tasks-store、Office Task Cockpit、Web-AIGC runtime、autopilot 节点 11 阶段任一既有能力；本 spec 仅在 blueprint 路由层、shared blueprint contracts、`client/src/pages/autopilot/` 与 `client/src/lib/` 范围内活动。

### 需求 13：范围边界与不在范围内事项

**用户故事：** 作为代码评审人与系列 spec 4 / spec 5 的预备工作，我希望明确本 spec 的范围边界，以及哪些相关工作必须被排除并由系列后续 spec 推进。

#### 验收标准

13.1 THE Feature SHALL NOT 引入 `spec_tree` / `spec_documents` / `effect_preview` / `prompt_packaging` / `runtime_capability` / `engineering_handoff` / `engineering_landing` 任一 stage 的 inline 编辑能力；上游字段以外的编辑由系列 spec 4（版本历史 / branch 比较）或独立后续 spec 推进。

13.2 THE Feature SHALL NOT 实现版本历史、版本快照、branch 比较 UI、parent / child job 切换 UI；这些能力由系列 spec 4 推进。

13.3 THE Feature SHALL NOT 实现 stage transition 动画、跨组件原子刷新策略、浮动 toast 序列协调；这些能力由系列 spec 5 推进。

13.4 THE Feature SHALL NOT 实现"从效果预览页面或 spec 树合并页内联编辑下游字段"的 UX；本 spec 的 inline edit 严格限定在页面 1 的 input / clarification / route_generation。

13.5 THE Feature SHALL NOT 修改 LLM prompt、DAG 构造、generation 业务逻辑、route candidate 生成算法、spec_tree 派生算法；本 spec 是纯接线 + UI 增量。

13.6 THE Feature SHALL NOT 引入新的 socket 通道、新的持久化存储、新的鉴权字段、新的限流策略；本 spec 是纯内存、纯路由扩展、纯 shared contract 追加可选字段的最小增量。

13.7 THE Feature SHALL NOT 引入"清除 stale marker"的能力；与 spec 1 单调性约束兼容（stale 一旦写入只能由 stage-specific 生成端点在重新生成时刷新，本 spec 不引入手动清除路径）。

13.8 IF 实现过程中发现需要修改 mission runtime / workflow runtime / Office cockpit 主线，THE Feature SHALL 把该修改延后到系列 spec 4 / spec 5 范围内推进，并在本 spec 的 design 阶段以注释或 TODO 标记接线点位，但 SHALL NOT 在本 spec 内实施跨主线改造。

13.9 THE Feature SHALL NOT 修改既有"返回上一步"按钮的语义、文案、显示位置；inline edit 控件是新增 UI，不复用 back 按钮。
