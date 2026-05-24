# 需求文档：Autopilot Stage State Coordination

## 简介

本 spec 是 Cube Pets Office autopilot blueprint 流"返回 / 重新规划 / 内联编辑"生命周期 5 个 spec 系列中的**第五个**也是最后一个，负责把前四份 spec 落地后**跨组件状态切换**的视觉与时序问题统一处理：stage transition 动画、跨组件原子刷新、toast 序列协调、页面 3→2→1 视觉过渡，以及 URL Pin / `workflowStageOverride` / Backend_Job_Stage 三层状态在并发刷新场景下的一致性兜底。

系列概览：

- **spec 1 — `autopilot-asset-staleness-model`**：在仓库中目前**仅为需求文档**。`staleSince` / `invalidatedBy` / `staleArtifactIds` 字段、依赖图、`invalidateDownstream` 引擎、只读 `GET /stale-artifacts` 端点。
- **spec 2 — `autopilot-replan-and-branch-action`**：在仓库中目前**仅为需求文档**。显式 replan：右栏按钮、全屏 modal、`POST /replan`、`mode = "in_place" | "branch"`、`replan.triggered` 事件、Branch_Metadata 写入。
- **spec 3 — `autopilot-stage-edit-mode`**：在仓库中目前**仅为需求文档**。viewing-completed 上游字段就地编辑、调用既有 modify 端点、自动经 spec 1 引擎使下游 stale。
- **spec 4 — `autopilot-stage-version-history`**：在仓库中目前**仅为需求文档**。版本树、parent / branch 切换、Compare_View、Replan_Timeline_View、只读 `GET /family` 端点、Switch_Active 语义。
- **spec 5 — `autopilot-stage-state-coordination`（本 spec）**：把前四份 spec 中所有"切换 / 刷新 / 跳变"动作的视觉表现与时序约束统一收口；只做协调层（视觉过渡、原子刷新、toast 队列、并发场景兜底），不修改任一既有数据流、不引入新数据模型、不引入新事件家族。

> **重要前置假设**：本 spec **假设 spec 1 / spec 2 / spec 3 / spec 4 先于本 spec 落地**。本 spec 在需求层把它们的全部数据流、组件、事件、端点都视为已存在的接线点位使用，但 SHALL NOT 主张它们已经在仓库代码中落地。如果落地顺序倒置，本 spec 的实施可临时桩接其接线点位，但合并到主线时仍须以 spec 1 / 2 / 3 / 4 已落地为前提。spec 5 是系列的"收尾 spec"，它的合并应在系列其他 spec 的代码合并完成之后或同期，以便能在真实场景下验证视觉过渡与原子刷新。

本 spec 引用的产品时序源是 `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md`。

本 spec 只做协调层、不动数据流：

- **不引入新数据模型**：SHALL NOT 在 `shared/blueprint/contracts.ts` 上追加新字段；SHALL NOT 修改任一既有字段的可选性 / 类型 / 语义。
- **不引入新事件家族**：SHALL NOT 新增 BlueprintEventName；SHALL NOT 新增 socket channel；只消费 spec 1 / 2 / 3 / 4 已写入的事件作为视觉触发条件。
- **不引入新端点**：SHALL NOT 新增任一 `GET` / `POST` / `PATCH` / `DELETE` 端点；本 spec 完全在前端实施。
- **不修改既有路由 / 组件 / store 结构**：仅在前端追加协调层模块（动画 hook、原子刷新中介、toast 队列），并以**调用方 / 包装层**身份接入既有组件；SHALL NOT 重构既有 store 拆分。

本 spec 与系列其他 spec 的边界：

- **接管动画**：spec 2 §6.4（视觉刷新单帧内完成）、spec 3 §7.6（视觉刷新单帧内完成）、spec 4 §10.1–10.3（无动画立即生效）都把"动画"明确延后到 spec 5。本 spec 是系列内**唯一**允许实现 stage transition 动画的位置。
- **接管原子刷新**：spec 2 §6.4 / §6.6、spec 3 §7.6 / §7.5、spec 4 §10.2 都要求"刷新在 React batch 同一帧内完成"。本 spec 提供统一的协调器，避免每个 spec 各自实现导致竞态。
- **接管 toast 序列**：spec 2 §6.1 / §6.2（in_place / branch 成功 toast）、spec 3 §7.3（stale toast）、spec 4 各处的提示 toast 在并发场景下可能重叠或乱序；本 spec 提供 toast 队列协调器。
- **接管页面 3→2→1 过渡**：当 Backend_Job_Stage 倒回 fromStage（spec 2 §3.6）或 Active_Job 切换到不同 stage（spec 4 §2.2）时，外层页面（页面 3 / 页面 2 / 页面 1）的切换需要视觉过渡而非瞬切。本 spec 是该过渡的唯一负责方。

**不在本 spec 范围内**：

- 创建 branch / 触发 replan / inline edit / 版本树 / Compare_View → 各自由 spec 1 / 2 / 3 / 4 承担；
- 任何后端 mutation / 新端点 / 新数据字段；
- 修改 `MissionAutopilotSummary` / `mission-projection` / `tasks-store` / Office Cockpit / Web-AIGC runtime；
- 重构 autopilot 既有 store 拆分（job / specTree / specDocuments / effectPreview / promptPackages / runtime 等多 store 结构）；
- 实现 service worker / 离线模式 / 后台同步等运行时基建。

本 spec 属于 Feature 类型，requirements-first 工作流。

## 术语表

- **Coordination_Layer**：本 spec 新增的前端协调层模块集合，包括 Stage_Transition_Animator、Atomic_Refresh_Mediator、Toast_Queue、Page_Transition_Choreographer 四个子模块。
- **Stage_Transition_Animator**：负责 stage 切换的视觉过渡（含 stage 倒回、stage 前进、Active_Job 切换跨 stage）；输入是"前一 stage / 后一 stage / 触发源（replan / edit / switch_active）"，输出是 CSS / Framer Motion 过渡。
- **Atomic_Refresh_Mediator**：负责把"一次用户动作触发的多个 store 写入"在 React 渲染层面聚合成一帧；解决 spec 2 §6.4、spec 3 §7.6、spec 4 §10.2 共同要求但各自实现可能竞态的问题。
- **Toast_Queue**：跨 spec 的 toast 序列协调器；接收 spec 2 / spec 3 / spec 4 各自要发的 toast，按时间序、合并规则、最大可见数控制展示，避免叠加遮挡。
- **Page_Transition_Choreographer**：负责外层页面（页面 1 / 页面 2 / 页面 3）切换时的视觉过渡（fade / slide / 等价机制）；触发条件是 `workflowStageOverride` 跨页面边界变化。
- **Stage_Page_Mapping**：产品页面级映射，而非 artifact 依赖图。`input` / `clarification` / `route_generation` 属于页面 1；`spec_tree` / `spec_docs` 属于同一个页面 2；`preview` / `effect_preview` / `prompt_packaging` / `runtime_capability` / `engineering_handoff` / `engineering_landing` 属于页面 3。
- **Three_Layer_State**：URL Pin（Sub_Stage_Pin） / `workflowStageOverride` / Backend_Job_Stage 三层状态（沿用 spec 2 术语表）。Backend_Job_Stage 表示当前 job 的最新生成进度，不等同于用户当前正在回看的视口；本 spec 在并发刷新场景下负责把三层视觉表现保持兼容。
- **Review_Override_State**：用户通过"返回上一步"进入的合法回看态。此时 URL Pin 或 `workflowStageOverride` 可以指向 Backend_Job_Stage 的上游页面；该状态 SHALL NOT 被 Three_Layer_State 自检当作 mismatch 自动拉回最新 stage。
- **Refresh_Trigger**：触发协调层动作的事件源，至少包括：spec 2 replan 成功（in_place / branch）、spec 3 inline edit 成功、spec 4 Switch_Active、socket 推送的 job 更新、spec 4 family 端点首次返回。
- **Frame_Budget**：单次协调动作的视觉帧预算；本 spec 默认目标是 ≤ 1 帧（约 16ms）内完成 store 写入与首次 paint，复杂过渡（如页面级 fade / slide）允许 ≤ 300ms 完成。
- **Animation_Reduced_Mode**：用户开启系统级 `prefers-reduced-motion: reduce` 时的降级模式；Coordination_Layer 在该模式下 SHALL 取消所有过渡动画，仅保留瞬切语义。
- **Static_Preview_Mode**：通过 `npm run build:pages` 生成的 GitHub Pages 纯前端预览运行环境（沿用前序 spec 术语）。

## 需求

### 需求 1：Stage_Transition_Animator 行为

**用户故事：** 作为产品用户，当系统从 stage 6 倒回 stage 1（spec 2 in_place replan 把 backend stage 倒回到 input），或从一条 branch 切到另一条 branch（spec 4 Switch_Active 跨 stage）时，我希望看到平滑的视觉过渡而不是瞬切，让我能感知到状态确实变了。

#### 验收标准

1.1 THE Stage_Transition_Animator SHALL 在以下三类 Refresh_Trigger 上接管 stage 切换的视觉过渡：(a) spec 2 replan 成功（in_place 把 backend stage 倒回 fromStage、branch 切换 Active_Job 到新 branch 起 stage）；(b) spec 4 Switch_Active 跨不同 stage 的 job；(c) 用户手动切换 sub-stage（既有 Sub_Stage_Pin 改写）。

1.2 WHEN Refresh_Trigger 触发且前后 stage 不同，THE Stage_Transition_Animator SHALL 在 ≤ 300ms 内完成视觉过渡；过渡形态由 design 阶段对齐（建议方向感：stage 前进 → 从右滑入；stage 倒回 → 从左滑入；Active_Job 切换 → fade）；SHALL 使用既有 Framer Motion 或 CSS transition 原语，SHALL NOT 引入新的动画库。

1.3 WHEN Refresh_Trigger 触发但前后 stage 相同（即同 stage 内的 store 刷新，例如 spec 3 inline edit 成功后下游 stale 标记更新），THE Stage_Transition_Animator SHALL NOT 触发任何 stage 切换动画；过渡责任此时退给 Atomic_Refresh_Mediator（需求 2）。

1.4 IF 用户开启系统级 `prefers-reduced-motion: reduce`（Animation_Reduced_Mode），THEN THE Stage_Transition_Animator SHALL 取消所有过渡动画，立即切换视觉态；SHALL NOT 因检测到该 preference 抛异常或导致 store 失同步。

1.5 THE Stage_Transition_Animator SHALL NOT 阻塞 store 写入：动画在视觉层并行展开，store 写入在动画启动同帧已完成（与 Atomic_Refresh_Mediator 协作，详见需求 2）；用户在动画进行中点击其他控件 SHALL 立即生效，SHALL NOT 因动画 in-flight 被禁用。

1.6 IF 在动画 in-flight 期间触发了第二次 Refresh_Trigger（例如用户连点两次 Switch_Active），THEN THE Stage_Transition_Animator SHALL 中止当前动画并以新的 stage 对作为目标重新启动一次 ≤ 300ms 过渡；SHALL NOT 累积动画队列。

1.7 THE Stage_Transition_Animator SHALL NOT 修改 `workflowStageOverride` / `Sub_Stage_Pin` / Active_Job 的 store 字段；这些字段由 spec 2 / spec 3 / spec 4 既有路径写入，本 spec 仅消费这些字段的变化作为动画触发条件。

1.8 IF 当前运行处于 Static_Preview_Mode，THEN THE Stage_Transition_Animator SHALL 仍正常工作（动画与后端无关）；SHALL NOT 因 modify 端点不可用而禁用动画。

### 需求 2：Atomic_Refresh_Mediator 行为

**用户故事：** 作为产品用户，当我做了一个动作（replan / inline edit / Switch_Active），整个页面应该一次性变到新状态，不要让我看到"toast 已经弹了但 stale badge 还没出现"或"URL 已经变了但产物列表还是旧的"这类中间态。

#### 验收标准

2.1 THE Atomic_Refresh_Mediator SHALL 在以下 Refresh_Trigger 上把多 store 写入聚合到 React 单一渲染批次内：(a) spec 2 replan 成功（job store + Active_Job + Branch_Index + URL）；(b) spec 3 inline edit 成功（job store + staleArtifactIds 索引 + 下游派生 store）；(c) spec 4 Switch_Active（Active_Job + Sub_Stage_Pin + Workflow_Stage_Override + URL）。

2.2 WHEN Refresh_Trigger 完成（即承诺 store 写入已发起），THE Atomic_Refresh_Mediator SHALL 在 ≤ 1 帧（约 16ms）内完成所有相关 store 字段的更新与首次 paint；用户 SHALL NOT 看到部分更新的中间态（即"jobId 已切换但 staleArtifactIds 仍是旧 job 的"或"URL 已更新但 Tree_Node active 标记仍指向旧节点"等情况均应避免）。

2.3 IF 多个 store 字段更新存在依赖（例如 staleArtifactIds 需基于新 job 派生才能渲染下游 stale badge），THEN THE Atomic_Refresh_Mediator SHALL 在同一渲染批次内完成依赖 store 的派生计算与提交；SHALL NOT 把依赖更新拆分到下一帧。

2.4 THE Atomic_Refresh_Mediator SHALL NOT 修改任一 store 字段的语义、类型或可选性；它仅在调用层（即 spec 2 / 3 / 4 既有的 store 写入入口）包装一层 React 18+ `flushSync` / `startTransition` 或等价 batch 控制；具体技术选型由 design 阶段对齐。

2.5 IF 在批次内任一 store 写入抛异常，THEN THE Atomic_Refresh_Mediator SHALL 回滚整个批次（即所有相关 store 字段保持批次开始前的值）；SHALL 通过既有 toast 机制显示语义"前端状态同步失败，请刷新页面"或等效（与 spec 2 §2.14 一致）；SHALL NOT 留下半成品状态。

2.6 IF 后端在批次完成后通过 socket 推送了相关事件（spec 2 audit channel / spec 3 invalidation 事件 / spec 4 family 推送），THEN THE Atomic_Refresh_Mediator SHALL 视该事件为"已处理过"并仅作为审计 / timeline 数据消费；SHALL NOT 因 socket 事件触发第二次 store 重置（与 spec 2 §6.6 / spec 3 §7.5 一致）。

2.7 THE Atomic_Refresh_Mediator SHALL NOT 触发任一 backend mutation；它仅协调前端 store 写入。

2.8 THE Atomic_Refresh_Mediator SHALL 与 Stage_Transition_Animator 协作：动画在 store 写入提交后启动，动画进行中 store 已经是新值（用户中途点击其他控件得到的反馈基于新 store）。

### 需求 3：Toast_Queue 行为

**用户故事：** 作为产品用户，当我连续做了几个动作（例如先 inline edit 再 replan），不希望看到 toast 一个叠一个、互相遮挡或同时展示三条相似文案。

#### 验收标准

3.1 THE Toast_Queue SHALL 接管 spec 2 §6.1 / §6.2、spec 3 §7.3 / §7.4、spec 4 各处的 toast 触发；spec 1 / 2 / 3 / 4 在调用既有 toast / notification 入口时 SHALL 通过本 spec 提供的统一 helper（例如 `enqueueAutopilotToast(payload)`），由 Toast_Queue 控制实际展示。

3.2 THE Toast_Queue SHALL 把同一时刻最多并发可见 toast 数限制为 1（design 阶段可调整为 2）；超出时新 toast 进入队列等待，前一条 dismiss 或自动消失后再展示下一条。

3.3 IF 队列中存在内容语义等价的 toast（例如连续两次 inline edit 都产生"已保存修改，N 个下游内容已标记为过期"），THEN THE Toast_Queue SHALL 合并这些 toast：仅展示最新一条，旧条直接丢弃；合并判定由 design 阶段对齐 toast payload 的 `key` 字段。

3.4 THE Toast_Queue SHALL 提供至少 3 类 toast 优先级：`error`（如 store 同步失败、replan 4xx 错误）、`warn`（如下游 running 阻塞 inline edit）、`info`（如 stale 标记成功）；高优先级 toast SHALL 抢占队列，立即展示并把当前 info 级 toast 推到队尾。

3.5 THE Toast_Queue SHALL NOT 修改 toast 的文案语义；它仅控制展示时机、合并、优先级、视觉位置；spec 1 / 2 / 3 / 4 各自定义的文案规则全部保留。

3.6 IF 用户主动 dismiss 一条 toast，THEN THE Toast_Queue SHALL 立即开始展示队列中的下一条（如有）；SHALL NOT 强制 dismiss 后等待固定 cooldown。

3.7 THE Toast_Queue 在 Animation_Reduced_Mode 下 SHALL 取消 toast 进出场动画，仅保留瞬现 / 瞬隐；展示 / 合并 / 优先级逻辑保持一致。

3.8 THE Toast_Queue SHALL NOT 持久化 toast 历史；toast 一经 dismiss 或自动消失即从内存中清除（审计 / 时间线由 spec 4 Replan_Timeline_View 与既有 audit timeline 承担）。

### 需求 4：Page_Transition_Choreographer 行为

**用户故事：** 作为产品用户，当 spec 2 in_place replan 把我从页面 3（效果 / 运行时）一下倒回页面 1（输入 / 澄清 / 路线）时，我希望看到一个明确的"页面退出 → 新页面进入"过渡，而不是页面 3 直接消失再瞬现页面 1。

#### 验收标准

4.1 THE Page_Transition_Choreographer SHALL 在以下情况下触发外层页面切换动画：(a) `workflowStageOverride` 跨页面边界变化（页面 1 = input/clarification/route_generation；页面 2 = spec_tree/spec_docs；页面 3 = preview/effect_preview/prompt_packaging/runtime_capability/engineering_handoff/engineering_landing；具体边界以 Stage_Page_Mapping 为准）；(b) Active_Job 切换到落在不同页面的 job。

4.2 WHEN 跨页面切换触发，THE Page_Transition_Choreographer SHALL 在 ≤ 300ms 内完成"前页面退出 + 后页面进入"过渡；过渡形态由 design 阶段对齐（建议方向感：页面 3 → 页面 1 倒回 → 从右向左滑出 + 新页面从左滑入；页面 1 → 页面 3 前进 → 反向）。

4.3 THE Page_Transition_Choreographer SHALL 与 Stage_Transition_Animator 协作：当切换跨越页面边界时，Page_Transition_Choreographer 优先触发，Stage_Transition_Animator 在新页面挂载完成后接管页面内 stage 间过渡；二者 SHALL NOT 同时对同一区域施加冲突动画。

4.4 IF 切换不跨越页面边界（即仍在同一页面内的不同 stage），THEN THE Page_Transition_Choreographer SHALL NOT 触发；过渡责任完全由 Stage_Transition_Animator（需求 1）承担。

4.5 IF Animation_Reduced_Mode 启用，THEN THE Page_Transition_Choreographer SHALL 取消页面级过渡动画，立即瞬切新页面。

4.6 THE Page_Transition_Choreographer SHALL NOT 修改 `workflowStageOverride` / Active_Job / 任一 store 字段；它仅消费这些字段的变化作为触发条件。

4.7 IF 在页面级过渡 in-flight 期间触发了第二次 Refresh_Trigger，THEN THE Page_Transition_Choreographer SHALL 中止当前过渡并以新页面对为目标重新启动；SHALL NOT 累积动画队列。

### 需求 5：Three_Layer_State 一致性兜底

**用户故事：** 作为产品用户，我不希望出现"URL 上的 sub-stage 是 A，外层页面是 B，但右栏渲染的是 C 的产物"这种三层不一致的情况。

#### 验收标准

5.1 THE Coordination_Layer SHALL 在每次 Refresh_Trigger 完成后做一次 Three_Layer_State 一致性自检：URL Pin、`workflowStageOverride`、Active_Job 的 `BlueprintGenerationJob.stage` 三者 SHALL 互相兼容（即不应出现"URL Pin 指向未知 stage"、"URL activeJob 与 store activeJob 冲突"、"`workflowStageOverride` 指向当前 job 不可展示 stage"等明显冲突）。

5.2 IF Three_Layer_State 自检发现不一致，THEN THE Coordination_Layer SHALL 通过 `console.warn` 输出诊断信息（含三层各自当前值、mismatchReason 与修正目标），并仅修正前端不可展示的状态：未知 URL Pin SHALL `resetPin()`；非法 `workflowStageOverride` SHALL 设置为 Active_Job 当前 stage 的可展示 fallback；SHALL NOT 修改 backend job 字段。

5.2a IF URL Pin 或 `workflowStageOverride` 指向 Active_Job Backend_Job_Stage 的上游 stage / 上游页面，且该 stage 存在于 Stage_Page_Mapping 并可由当前 job、当前 request 或已缓存 artifact 展示，THEN THE Coordination_Layer SHALL 将其视为合法 Review_Override_State，SHALL NOT `resetPin()`，SHALL NOT 把 `workflowStageOverride` 自动改回 Backend_Job_Stage。

5.2b IF `spec_tree` 与 `spec_docs` 之间发生切换，THEN THE Coordination_Layer SHALL 将其视为页面 2 内部切换，SHALL NOT 把它解释为一次页面级"返回上一步"，也 SHALL NOT 因二者不同而触发 Three_Layer_State mismatch 修正。

5.3 THE Three_Layer_State 一致性自检 SHALL 是 idempotent 的：若三层已一致，自检 SHALL NOT 触发任何修改；若不一致且修正成功，再次自检 SHALL NOT 再做修正。

5.4 IF 自检在 100ms 内仍无法把三层对齐（例如 store 写入连续抛异常），THEN THE Coordination_Layer SHALL 通过 Toast_Queue（需求 3）展示一条 `error` 级 toast 提示"前端状态同步失败，请刷新页面"或等效语义；SHALL NOT 整页强制 reload。

5.5 THE Three_Layer_State 一致性自检 SHALL NOT 在用户没有触发任何 Refresh_Trigger 时主动启动（即不轮询、不定时执行）；它只在 Refresh_Trigger 完成后做一次同步检查。

5.6 THE Three_Layer_State 一致性自检 SHALL NOT 修改 Backend_Job_Stage（即不通过任一路径写入后端 `BlueprintGenerationJob.stage`）；这与 spec 2 §12.9 / spec 4 §13.9 一致——只有 spec 2 的 replan 路径允许重写 backend stage。

5.7 THE Three_Layer_State 一致性自检 SHALL 使用 Stage_Page_Mapping 做页面级兼容判断，SHALL NOT 使用 spec 1 的 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` 作为 UI 回退顺序；artifact 依赖图只用于 stale 级联，不用于页面回退。

### 需求 6：Refresh_Trigger 接线契约

**用户故事：** 作为代码评审人，我希望 spec 1 / 2 / 3 / 4 与本 spec 的接线点位明确、对称，不要每个 spec 都自己实现一套协调逻辑。

#### 验收标准

6.1 THE Coordination_Layer SHALL 暴露一个统一入口（例如 React hook `useAutopilotCoordination()` 或单例 service `AutopilotCoordinator`），spec 2 / spec 3 / spec 4 在各自既有 store 写入路径中通过该入口注册 Refresh_Trigger（具体 API 形态由 design 阶段对齐）。

6.2 WHEN spec 2 的 Replan_Confirmation_Modal 收到 2xx 响应（in_place / branch 任一），THE Replan_Confirmation_Modal SHALL 调用 Coordination_Layer 入口提交 Refresh_Trigger；完成本 spec 迁移后 SHALL NOT 直接调用既有 toast / 直接修改 `workflowStageOverride`。

6.3 WHEN spec 3 的 inline edit 成功（任一 Modify_Endpoint 返回 2xx），THE Edit_Mode 控件 SHALL 调用 Coordination_Layer 入口提交 Refresh_Trigger；SHALL NOT 直接调用既有 toast / 直接修改下游派生 store。

6.4 WHEN spec 4 的 Switch_Active 触发，THE Version_Tree_View SHALL 调用 Coordination_Layer 入口提交 Refresh_Trigger；完成本 spec 迁移后 SHALL NOT 直接修改 `workflowStageOverride` 或 URL。

6.5 IF spec 1 / 2 / 3 / 4 的代码尚未接入 Coordination_Layer 入口（即新 spec 落地前的过渡期），THEN THE Coordination_Layer SHALL NOT 拒绝工作；既有直接 store 写入路径 SHALL 保持兼容；本 spec 在 design 阶段以 `TODO(spec-N-wiring)` 标注 spec N 的迁移点位。

6.6 THE Coordination_Layer 入口 SHALL 支持 idempotent 调用：同一 Refresh_Trigger 在同一帧内被调用多次 SHALL 仅执行一次效果；调用方无需自己去重。

6.7 THE Coordination_Layer 入口 SHALL NOT 暴露任一允许调用方修改后端状态的 API；它仅承接前端 store 写入与视觉过渡的协调请求。

### 需求 7：与系列 Spec 1 / 2 / 3 / 4 的关系（零修改）

**用户故事：** 作为代码评审人，我希望本 spec 不修改前四份 spec 的任一既有路由 / 字段 / 组件 / 事件。

#### 验收标准

7.1 THE Feature SHALL NOT 修改 spec 1 的 `staleSince` / `invalidatedBy` / `staleArtifactIds` 字段、`BLUEPRINT_ASSET_DEPENDENCY_GRAPH`、`invalidateDownstream` 引擎、`GET /stale-artifacts` 端点。

7.2 THE Feature SHALL NOT 修改 spec 2 的 `Replan_Button` / `Replan_Confirmation_Modal` / `POST /replan` 端点 / `replan.triggered` 事件 / Branch_Metadata 字段；SHALL NOT 在 Coordination_Layer 内部以二次请求 / 内部 handler 调用方式触发 spec 2 的端点。

7.3 THE Feature SHALL NOT 修改 spec 3 的 inline edit 控件 / `Inline_Confirmation` 组件 / 任一 Modify_Endpoint / Auto_Invalidation_Hook / Stale_Badge / Right_Rail_Stale_Indicator / Per-Stage_Regenerate。

7.4 THE Feature SHALL NOT 修改 spec 4 的 Version_Tree_View / Compare_View / Replan_Timeline_View / `GET /family` 端点 / Switch_Active 语义；SHALL NOT 替换 spec 4 的 Tree_Node 点击 handler。

7.5 THE Feature SHALL NOT 重构既有 autopilot store 拆分（job / specTree / specDocuments / effectPreview / promptPackages / runtime 等多 store 结构）；Coordination_Layer 仅作为这些 store 写入的协调器、不替代它们。

7.6 THE Feature SHALL NOT 修改 `MissionAutopilotSummary` / `mission-projection` 投影形态的状态机迁移序列、事件名、事件触发顺序或既有副作用。

### 需求 8：属性测试与示例测试覆盖

**用户故事：** 作为代码评审人，我希望本 spec 在协调层有可证明的"原子刷新无中间态"性质测试，与跨场景的示例测试。

#### 验收标准

8.1 THE Feature SHALL 在 `client/src/lib/autopilot-coordination/__tests__/` 或等效既有目录下添加以下测试文件：
  - `atomic-refresh.test.ts`：覆盖需求 2，含 example-based 测试覆盖三类 Refresh_Trigger（spec 2 replan / spec 3 inline edit / spec 4 Switch_Active）的批量更新无中间态；
  - `toast-queue.test.ts`：覆盖需求 3，含 example-based 测试覆盖合并、优先级、抢占、reduced-motion 取消进出场动画；
  - `three-layer-consistency.test.ts`：覆盖需求 5，含 example-based 测试覆盖三层一致性自检 + 修正幂等性。

8.2 THE Feature SHALL 在 `atomic-refresh.test.ts` 中包含至少 1 条 fast-check property test 验证以下不变量：

- **批次写入原子性**：对随机生成的 N 次 store 写入序列（N ∈ [1, 10]），任意两次连续写入不会被外部观察到中间态——即 React 渲染快照在批次内只产生 1 次 commit。

8.3 THE Property_Tests SHALL 使用 fast-check 提供的 `fc.assert` + `fc.property` 组合；`numRuns` SHALL ≥ 100；SHALL NOT 硬编码 seed；SHALL NOT 使用 `it.skip` / `describe.skip` / `test.skip` / `it.todo` / `describe.only`；单条 property 的 wall-clock 运行时间 SHALL ≤ 30 秒。

8.4 THE Feature SHALL 在 `client/src/pages/autopilot/__tests__/` 或等效既有目录下新增 example-based 端到端 / 集成测试，覆盖跨 spec 场景，至少包含 5 个：(a) spec 2 in_place replan 后 toast / stage 动画 / staleArtifactIds 同帧刷新（需求 1.1 / 2.1 / 3.1）；(b) spec 2 branch replan 后 Active_Job 切换 + 页面级过渡（需求 1.1 / 4.1）；(c) spec 3 inline edit 成功后 toast 不与 spec 2 toast 冲突（需求 3.4）；(d) spec 4 Switch_Active 跨页面切换触发 Page_Transition_Choreographer（需求 4.1）；(e) Animation_Reduced_Mode 下所有动画取消、store 一致性保持（需求 1.4 / 3.7 / 4.5）。

8.5 THE Feature SHALL NOT 引入新的 vitest config 或新的测试 npm script；新增的客户端测试 SHALL 通过既有客户端 vitest runner 自动发现并运行。

8.6 IF 测试中需要构造 spec 2 / 3 / 4 的 fixture，THE Test_Files SHALL 优先复用 spec 2 / 3 / 4 既有 fixture 目录；如必须新增协调层 fixture，SHALL 放在 `client/src/lib/autopilot-coordination/__tests__/__fixtures__/` 下，并以 `TODO(spec-2-wiring)` / `TODO(spec-3-wiring)` / `TODO(spec-4-wiring)` 标注接线点位（如 spec 2 / 3 / 4 仍未落地）。

### 需求 9：日志与可观测性

**用户故事：** 作为排障人员，我希望 Coordination_Layer 的失败兜底（例如三层不一致、批次回滚）在 console 与可观测性面板都看得见。

#### 验收标准

9.1 WHEN Three_Layer_State 自检发现不一致并触发修正（需求 5.2），THE Coordination_Layer SHALL 通过 `console.warn` 输出一条结构化诊断信息，事件键固定为 `coordination.three_layer_mismatch`；payload：`urlPin: string | null`、`workflowStageOverride: string | null`、`activeJobStage: string`、`mismatchReason: string`、`correctedTo: string | null`。合法 Review_Override_State SHALL NOT 输出该 warn。

9.2 WHEN Atomic_Refresh_Mediator 因 store 写入抛异常触发批次回滚（需求 2.5），THE Coordination_Layer SHALL 通过 `console.error` 输出一条结构化诊断信息，事件键固定为 `coordination.batch_rolled_back`；payload：`triggerSource: "replan" | "inline_edit" | "switch_active"`、`failedStore: string`（抛异常的 store 名）、`errorMessage: string`（异常 message，截断到 200 字符）。

9.3 WHEN Stage_Transition_Animator / Page_Transition_Choreographer 因连续 Refresh_Trigger 中止当前动画（需求 1.6 / 4.7），THE Coordination_Layer SHALL 通过 `console.debug` 输出诊断信息，事件键固定为 `coordination.animation_aborted`；payload：`previousTrigger: string`、`newTrigger: string`、`elapsedMs: number`。

9.4 THE Logging（任一日志级别）SHALL NOT 输出 artifact `payload` 内容、target text 原文、clarification answer 原文、reason 原文、API key、token；允许字段类型白名单与 spec 2 §11.4 一致。

9.5 THE Logging SHALL NOT 引入新的 socket 事件 / 服务器侧日志推送；本 spec 完全前端运行，所有日志仅写到浏览器 console（与既有客户端日志约定一致）。

9.6 THE Logging 事件键集合 SHALL 仅包含三个：`coordination.three_layer_mismatch`、`coordination.batch_rolled_back`、`coordination.animation_aborted`；前缀固定为 `coordination.`；SHALL NOT 借用 spec 2 / spec 3 / spec 4 的日志事件键。

### 需求 10：向后兼容性与零迁移

**用户故事：** 作为依赖现有运行时实例，我希望本 spec 落地后既有 job、既有路由、既有 store 结构、既有测试都不被破坏。

#### 验收标准

10.1 THE Feature SHALL NOT 引入数据库迁移、SHALL NOT 引入磁盘持久化变更、SHALL NOT 修改 In-Memory_Job_Store 的初始化签名 / 构造参数 / 默认值或启动时序；本 spec 完全前端、纯协调层增量。

10.2 THE Feature SHALL NOT 修改任一既有 HTTP 路由的请求形态、响应 schema 或既有字段；本 spec 不新增任一后端路由（与本 spec 简介中"不引入新端点"一致）。

10.3 THE Feature SHALL NOT 修改 `shared/blueprint/contracts.ts` 中由 spec 1 / spec 2 / spec 3 / spec 4 引入或既有的任一字段；本 spec 不新增 shared contracts 类型。

10.4 THE Feature SHALL NOT 修改 `MissionAutopilotSummary` / `mission-projection` 投影形态；SHALL NOT 影响既有 mission runtime / workflow runtime / tasks-store / Office Task Cockpit / Web-AIGC runtime / autopilot 节点 11 阶段任一既有能力。

10.5 THE Feature SHALL NOT 修改、删除或调整既有客户端测试的 `expect` 断言或断言行；新增测试 SHALL 仅以新文件方式实现。

10.6 WHEN 本 spec 落地后执行客户端 vitest，既有用例数量 SHALL 不减少、失败数 SHALL 为 0、新增 skip SHALL 为 0；spec 1 / spec 2 / spec 3 / spec 4 测试（如已落地）SHALL 全绿；新增的 fast-check property test 与新增 example test SHALL 在同一次运行中通过。

10.7 THE Feature SHALL NOT 影响 GitHub Pages 静态预览路径（`npm run build:pages`）；纯前端预览的运行时 SHALL 在 modify 端点不可用时仍能加载 Coordination_Layer（动画与协调与后端无关）；SHALL NOT 因 backend 不可达而抛 schema 校验异常。

10.8 THE Feature SHALL NOT 引入新的 socket 通道、新的 BlueprintEventName 家族、新的持久化存储、新的鉴权字段、新的限流策略、新的环境变量主开关。

10.9 THE Feature SHALL 尊重 spec 2 §12.9 / spec 4 §13.9 中"URL Pin / `workflowStageOverride` / Backend_Job_Stage 三层"语义：本 spec 的 Coordination_Layer 仅触达前两层（URL Pin 与 `workflowStageOverride`），SHALL NOT 修改 Backend_Job_Stage；Backend_Job_Stage 是最新进度，不是强制当前视口。

### 需求 11：范围边界与不在范围内事项

**用户故事：** 作为代码评审人与系列收尾人，我希望明确本 spec 是系列的最后一份、范围被严格收敛。

#### 验收标准

11.1 THE Feature SHALL NOT 在本 spec 提交中新增 spec 1 范围的导出 / 路由注册 / 字段类型 / 组件（`staleSince` / `invalidatedBy` / `BLUEPRINT_ASSET_DEPENDENCY_GRAPH` / `invalidateDownstream` 引擎 / `GET /stale-artifacts` 端点）。

11.2 THE Feature SHALL NOT 在本 spec 提交中新增 spec 2 范围的导出 / 路由注册 / 组件（Replan_Button、Replan_Confirmation_Modal、`POST /replan` 端点、Branch_Metadata 字段写入逻辑、`replan.triggered` 事件写入）。

11.3 THE Feature SHALL NOT 在本 spec 提交中新增 spec 3 范围的导出 / 路由注册 / 组件（字段级 inline edit UI、Auto_Invalidation_Hook、Stale_Badge、Right_Rail_Stale_Indicator、Per-Stage_Regenerate）。

11.4 THE Feature SHALL NOT 在本 spec 提交中新增 spec 4 范围的导出 / 路由注册 / 组件（Version_Tree_View、Compare_View、Replan_Timeline_View、`GET /family` 端点、Switch_Active 写动作）。

11.5 THE Feature SHALL NOT 实现以下能力（均明确为 OUT OF SCOPE）：service worker / 离线模式 / 后台同步、跨页签状态广播（BroadcastChannel）、撤销 / 重做栈（undo/redo stack）、动画录制 / 回放（与既有 evidence replay 不冲突，本 spec 不补此能力）、自定义动画时长 / 缓动函数的用户偏好设置 UI（仅响应系统级 `prefers-reduced-motion`）。

11.6 THE Feature SHALL NOT 修改 LLM prompt 文件、DAG 构造算法、generation 业务逻辑、route candidate 生成算法、spec_tree 派生算法的函数签名、返回值结构或既有测试断言。

11.7 THE Feature SHALL NOT 引入新的 Socket.IO 事件名 / channel name、新的请求头 / 请求体 / 中间件鉴权字段、新的 rate limit / 配额策略；本 spec 完全前端实施。

11.8 THE Feature SHALL NOT 在本 spec 提交中新增"清除 stale marker"或"删除 branch job"或"修改 Backend_Job_Stage"任一形式入口；与 spec 1 单调性约束、spec 2 §12.9 backend stage 写入约束、spec 4 §13.9 兼容。

11.9 IF 实施过程中识别到需要修改 mission runtime / workflow runtime / Office cockpit 主线的既有源码或测试，THEN THE Feature SHALL 把该修改延后到独立后续 spec 推进；本 spec 提交 SHALL NOT 包含上述主线模块的源码或测试改动。

11.10 THE Feature SHALL NOT 修改既有"返回上一步"按钮、spec 2 的 Replan_Button、spec 3 的 edit 图标、spec 4 的 History_Entry_Point 的语义、文案、显示位置；Coordination_Layer 是协调中介，不增加新 UI 触点。

11.11 THE Feature SHALL 是系列 5 个 spec 的最后一份；本 spec 落地后，autopilot blueprint 流的"返回 / 重新规划 / 内联编辑"生命周期视为完整闭环；后续若需扩展，SHALL 以新系列 spec 形式推进，SHALL NOT 反向修改本系列任一 spec 的需求。
