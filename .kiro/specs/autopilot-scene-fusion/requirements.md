# 自动驾驶 3D 场景融合 — 需求文档

## 引言

`/autopilot` 蓝图驾驶舱的目标是把"目的地 → 路线 → 车队 → 阶段 → 证据"这条主线在 3D 场景中可视化地呈现出来。当前蓝图后端（`agent-reasoning-bridge.ts` 等受保护模块）已经在持续 emit `role.activated` / `phase.transitioned` / `phase.advanced` 等事件，右栏 `MiroFishCardStream` 流式卡片、后墙左终端 `SandboxMonitor`、后墙中区 `MissionWallTaskPanel` 紧凑 HUD 也已经联动到蓝图 store。

但 3D 场景与右栏阶段卡片当前与蓝图后端处于"信号断联"状态，导致用户在 `/autopilot` 看到的 3D 视觉与"蓝图正在哪个阶段、哪个角色在工作"完全脱节，与旧版 mission-first 任务壳的 3D 联动体验有明显落差。

本 spec 的目标是在不破坏 mission-first 任务壳行为、不修改任何受保护后端模块的前提下，把 3D 场景的三个关键组件（`PetWorkers` / `MissionIsland` / `SceneStageFlow`）接到蓝图信号源，恢复"3D 场景跟随蓝图阶段推进"的视觉锚点。

## 背景与问题

### 问题 1：PetWorkers roleId 空间不匹配

- `client/src/components/three/PetWorkers.tsx` 当前从 `BlueprintRealtimeStore.rolePhases[config.id]` 读取角色阶段
- `config.id` 是 mission-first 配置的 agent id（共 7 个：`agent-ceo` / `agent-manager-research` / `agent-manager-design` / `agent-manager-engineering` / `agent-worker-research` / `agent-worker-design` / `agent-worker-engineering`）
- 蓝图后端 `agent-reasoning-bridge.ts` emit 的 `role.activated` / `role.message` / `role.completed` 等事件里 `payload.roleId` 是 FSD 角色名（`planner` / `analyzer` / `clarifier` / `generator` / `reviewer` / `auditor` / `operator`）
- 两套 ID 空间互不相通，蓝图阶段推进时 PetWorkers 不会跟随动起来

### 问题 2：MissionIsland 在蓝图页空白

- `client/src/components/three/MissionIsland.tsx` 直接读 `useTasksStore.tasks`
- 蓝图 jobId 对应的 BlueprintGenerationJob 不在 mission `tasks` store 里（任务壳走 mission，蓝图走独立 BlueprintGenerationJob 链路）
- 结果是 `/autopilot` 页面打开时 MissionIsland 显示空态或旧 mission 残影，与"蓝图正在跑"的实际状态完全冲突

### 问题 3：SceneStageFlow 不联动蓝图阶段

- `client/src/components/three/SceneStageFlow.tsx` 当前从 mission 状态推导阶段流线
- 蓝图 9 阶段（`intake` → `clarification` → `route` → `spec_tree` → `spec_docs` → `effect_preview` → `prompt_packaging` → `engineering_handoff` → `artifact_memory`）没有信号源接入
- 场景中没有"当前在哪个阶段"的视觉锚点，用户必须看右栏文字才能判断进度

### 已经成立的部分（本 spec 不再改动）

- `SandboxMonitor`（后墙左终端）已通过 `useAutopilotSandboxBridge` 联动到蓝图，本 spec 视为既成事实
- 后墙中区 `MissionWallTaskPanel` 紧凑 HUD 已收口，承担蓝图的"任务概要"角色
- 右栏 `MiroFishCardStream` 流式卡片已通过 mirofish-stream spec Wave 1 接管挂载点
- `agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` 是受保护后端模块，本 spec 不修改

## 主线约束

本 spec 必须遵循当前主仓的 9 条全局工程约束：

1. 所有 JSDoc / 注释 / commit message 必须使用中文；prompt 字面量与 promptId 保持英文，模块级 JSDoc 用中文
2. 禁止引入 PBT（property-based testing），只允许 example-based 测试
3. 不扩大 TypeScript 基线错误数（当前基线 `116`），新增改动必须保持类型边界稳定
4. 不破坏既有 5140+ 测试，已有测试套件必须继续通过
5. 不引入 `@testing-library/react` / `jsdom` / `happy-dom`，沿用 `react-dom/server` SSR + `vi.mock` 的现有测试模式
6. 不修改受保护文件：`agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts`
7. 用户访问入口固定为 `http://localhost:3000/autopilot`（Vite 默认端口）
8. 中央底部 `UnifiedLaunchComposer` 是唯一发起入口，本 spec 不引入第二个发起器
9. 模块级 JSDoc 必须使用中文，prompt 字面量与 promptId 保留英文以匹配后端契约

## 术语表

- **蓝图（Blueprint）**：`/autopilot` 页面的 9 阶段任务自动驾驶链路，对应 `BlueprintGenerationJob`
- **mission-first 路径**：旧版任务壳路径，对应 `/tasks` 与 `MissionRecord`
- **FSD 角色**：蓝图后端使用的 7 个角色名（`planner` / `analyzer` / `clarifier` / `generator` / `reviewer` / `auditor` / `operator`）
- **mission agent id**：mission-first 任务壳使用的 7 个 agent id（`agent-ceo` / `agent-manager-research` / `agent-manager-design` / `agent-manager-engineering` / `agent-worker-research` / `agent-worker-design` / `agent-worker-engineering`）
- **roleId 映射桥**：把 FSD roleId 转换为 mission agent id 的纯函数桥接层
- **getBlueprintSceneStageSignal**：把 BlueprintGenerationJob 转换为场景阶段信号的纯函数

## 用户故事

### 用户故事 1：蓝图页"角色谁在工作"立刻可见

**As a** 蓝图驾驶舱用户
**I want** 在 `/autopilot` 打开时看到 3D 场景里的 PetWorkers 跟随蓝图后端 emit 的 FSD 角色阶段事件动起来
**So that** 我不用读右栏文字也能立刻判断当前哪个 FSD 角色在主导工作

### 用户故事 2：蓝图页"当前在哪个阶段"立刻可见

**As a** 蓝图驾驶舱用户
**I want** 在 `/autopilot` 看到 SceneStageFlow 跟随蓝图 9 阶段推进，沿场景流线节点逐段点亮
**So that** 我能在 3D 视觉中直接定位"当前在哪个阶段、还差几步"，不必依赖右栏文字提示

### 用户故事 3：蓝图页 MissionIsland 不再显示空态或旧 mission 残影

**As a** 蓝图驾驶舱用户
**I want** 在 `/autopilot` 打开时 MissionIsland 不再显示与当前蓝图无关的空态或旧 mission 残影
**So that** 后墙中区 `MissionWallTaskPanel` 紧凑 HUD 能独占"任务概要"承接位，3D 场景视觉与右栏蓝图阶段卡片保持一致

### 用户故事 4：mission-first 路径 3D 场景联动行为不退化

**As a** mission-first 任务壳用户
**I want** 在 `/tasks` 与既有任务壳路径下，PetWorkers / MissionIsland / SceneStageFlow 的行为保持原样
**So that** 本 spec 对蓝图页的改造不会反向破坏旧版 mission-first 路径已经成立的 3D 联动体验

### 用户故事 5：3D 场景在蓝图 store 初始空态时不抛错

**As a** 任意 `/autopilot` 用户
**I want** 在蓝图 store 还没有任何 job、rolePhases 为空对象、当前 phase 未确定时 3D 场景仍然能稳定渲染
**So that** 首次进入页面或刷新页面时不会因为初始空态触发 React 渲染错误或场景闪烁

## 验收准则（EARS 格式）

### AC1：roleId 映射桥在蓝图页生效

WHERE 当前页面是蓝图页（`/autopilot` 路由 / 蓝图 mode），WHEN PetWorkers 渲染时，THE Scene_Fusion_System SHALL 通过 FSD roleId → mission agent id 映射桥读取 `BlueprintRealtimeStore.rolePhases`，使每个 pet 对应到正确的 FSD 角色阶段。

### AC2：mission-first 路径下 PetWorkers 行为不变

WHERE 当前页面是 mission-first 路径（`/tasks` 或既有任务壳），WHEN PetWorkers 渲染时，THE Scene_Fusion_System SHALL 直接使用 mission agent id 读取 mission rolePhases，不经过 FSD 映射桥。

### AC3：MissionIsland 在蓝图页隐藏

WHERE 当前页面是蓝图页，WHEN 3D 场景挂载 MissionIsland 时，THE Scene_Fusion_System SHALL 不渲染 MissionIsland 节点（条件渲染或 mode prop 控制），让后墙中区 `MissionWallTaskPanel` 独占任务概要承接位。

### AC4：SceneStageFlow 接蓝图阶段信号（蓝图页）/ mission 信号（mission-first 页）

WHERE 当前页面是蓝图页，WHEN SceneStageFlow 渲染时，THE Scene_Fusion_System SHALL 通过 `getBlueprintSceneStageSignal(job)` 获取当前阶段索引、进度比例、阶段名作为流线信号源；WHERE 当前页面是 mission-first 路径，WHEN SceneStageFlow 渲染时，THE Scene_Fusion_System SHALL 继续使用既有 mission 信号源，行为与本 spec 改造前一致。

### AC5：getBlueprintSceneStageSignal 是纯函数且容忍空态

THE Scene_Fusion_System SHALL 把 `getBlueprintSceneStageSignal(job: BlueprintGenerationJob | null | undefined)` 实现为纯函数，IF 入参为 `null` 或 `undefined` 或缺失阶段字段，THEN THE Scene_Fusion_System SHALL 返回一个表示"未开始 / 阶段索引为 0 / 进度 0"的安全默认信号，不抛异常。

### AC6：roleId 映射桥是纯函数且容忍未知 FSD roleId

THE Scene_Fusion_System SHALL 把 FSD roleId → mission agent id 映射桥实现为纯函数，映射规则按用户认可的方向落地：`planner → agent-manager-research`、`clarifier → agent-ceo`、`analyzer → agent-manager-design`、`generator → agent-worker-design`、`reviewer → agent-manager-engineering`、`auditor → agent-worker-engineering`、`operator → agent-worker-research`；IF 输入的 FSD roleId 不在映射表内，THEN THE Scene_Fusion_System SHALL fallback 到"按 mission agent id 直读"的兼容行为，不抛异常。

### AC7：3D 场景在蓝图 store 初始空态时不抛错、不闪烁

WHEN `/autopilot` 首次挂载或刷新且 `BlueprintRealtimeStore.rolePhases` 为空对象、当前 jobId 未确定时，THE Scene_Fusion_System SHALL 让 PetWorkers / SceneStageFlow 渲染稳定的初始视觉（pet 处于 idle 阶段、流线指向第 0 阶段），不抛 React 渲染错误，不出现一帧空白后再切回的视觉闪烁。

### AC8：既有 SandboxMonitor / MissionWallTaskPanel 联动不被本 spec 改动

THE Scene_Fusion_System SHALL 不修改 `SandboxMonitor` 与 `useAutopilotSandboxBridge` 的联动实现，THE Scene_Fusion_System SHALL 不修改 `MissionWallTaskPanel` 后墙中区 HUD 的现有行为；本 spec 的改动范围严格限定在 `PetWorkers` / `MissionIsland` / `SceneStageFlow` 与新增的 roleId 映射桥 / 阶段信号纯函数。

### AC9：当蓝图 store 同时有 FSD roleId 与 mission agent id 时 FSD 优先

WHERE 当前页面是蓝图页，WHEN `BlueprintRealtimeStore.rolePhases` 同时包含 FSD roleId（如 `planner`）与 mission agent id（如 `agent-manager-research`）的键时，THE Scene_Fusion_System SHALL 优先采用 FSD roleId 经映射桥得到的 mission agent id 作为 PetWorkers 的阶段读取键，因为蓝图页的主要事件源是 FSD 角色名。

### AC10：FSD → mission 映射不影响既有 7 pet 视觉布局

THE Scene_Fusion_System SHALL 复用 `PetWorkers.tsx` 既有的 7 pet 视觉配置（pet 形象、坐标、姓名牌、动画），不重新调整 pet 数量、顺序或 3D 坐标，只在 roleId 读取层加映射桥。

## 不在范围内

为了把本 spec 控制在"3D 场景与蓝图信号联动"这一最小可见目标内，以下事项明确不在本轮范围：

- **不重构 PetWorkers 7 pet 视觉布局**：pet 数量、形象、坐标、姓名牌、glass-3d 渲染保持现状
- **不改 SandboxMonitor 后墙左终端的联动**（已成立）：`useAutopilotSandboxBridge` 与 `SandboxMonitor` 视为既成事实，不在本 spec 改动
- **不改 MissionWallTaskPanel 后墙中区 HUD**（已成立）：紧凑 HUD 收口与 2026-04-21 遮挡修复保持现状
- **不改 mission-first 任务壳路由 / 任务工作台**：`/tasks` / `TasksPage` / `TaskDetailView` / `MissionRuntime` 与本 spec 无关
- **不改 mirofish-stream 右栏流式卡片**（独立 spec 已完成）：`MiroFishCardStream` 与右栏挂载点不在本 spec 改动
- **不引入新 socket / 不改 socket-relay 协议**：本 spec 只读现有 BlueprintRealtimeStore，不新增后端事件源
- **不引入 framer-motion 等新动画库**：流线动画沿用既有 mission-first 路径的实现
- **不修改受保护后端文件**：`agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` 严格只读
- **不改后端 BlueprintGenerationJob 数据结构 / 9 阶段定义**：阶段映射只在前端纯函数中表达
- **不引入 `@testing-library/react` / `jsdom` / `happy-dom`**：测试沿用 `react-dom/server` SSR + `vi.mock`
- **不在本 spec 内升级 promptId 映射或 prompt 字面量**：prompt 字面量与 promptId 保持英文与现有契约

## 风险与边界

### 风险 1：FSD → mission 角色映射不完美

FSD `planner` 与旧版 `agent-manager-research` 在职责上并非 1:1 对齐，`clarifier → agent-ceo` 也是"够用即可"的近似映射。本 spec 接受"先把信号联通"作为最小目标，映射准确度可在后续 spec 中迭代调整。映射表必须集中在一个纯函数模块内，方便后续单点替换。

### 风险 2：SceneStageFlow 当前可能耦合 mission 数据

SceneStageFlow 的现有实现可能直接依赖 mission `currentStage` 字段。本 spec 必须在不破坏 mission-first 路径行为的前提下做信号源切换，方案是：让 SceneStageFlow 接受一个"已经标准化的阶段信号对象"作为输入，由 page-level 决定信号来源（蓝图页传入 `getBlueprintSceneStageSignal(job)`，mission-first 页传入既有 mission 信号 helper）。

### 风险 3：蓝图页 vs mission-first 页的判别方式

3D 场景三个组件需要知道"当前是蓝图模式还是 mission-first 模式"。两种可行方式：
- **page-level prop drill**：在 `Home.tsx` / `OfficeTaskCockpit.tsx` 等顶层 page 把 `mode: "blueprint" | "mission-first"` 一路传给 `Scene3D` 与子组件
- **React context**：新加 `SceneFusionModeContext`，在 `/autopilot` 路由层 provide `"blueprint"`，默认 fallback `"mission-first"`

设计阶段需要选择其中一种方案，避免两种判别方式同时存在导致状态漂移。

### 风险 4：9 阶段映射到 9 个流线节点节点过多

蓝图实际有 10 个阶段（`intake` / `clarification` / `route` / `spec_tree` / `spec_docs` / `effect_preview` / `prompt_packaging` / `engineering_handoff` / `artifact_memory`，加上潜在的入口阶段）。为避免场景流线节点过密，方案是把 `artifact_memory` 复用 `engineering_handoff` 末尾的视觉锚点，不为它单独增加流线节点。具体节点列表：`input` / `clarification` / `route_generation` / `route_selection` / `spec_tree` / `spec_docs` / `effect_preview` / `prompt_packaging` / `engineering_handoff` 共 9 个。

### 风险 5：BlueprintRealtimeStore 的 rolePhases 可能短时为空对象

页面刷新或首次挂载时 `BlueprintRealtimeStore` 可能尚未收到任何后端事件，`rolePhases` 与当前 jobId 都是空状态。AC7 已经为这一情况给出验收口径：必须有稳定的"初始空态视觉"，不抛错也不闪烁。

### 风险 6：既有 5140+ 测试不能退化

PetWorkers / MissionIsland / SceneStageFlow 已经有相关测试覆盖。本 spec 改动后必须保证：
- mission-first 路径下既有测试继续通过
- 蓝图页新增的 fixture-driven example 测试覆盖映射桥纯函数、阶段信号纯函数、mode 判别逻辑

### 边界声明

- 本 spec 不承诺"FSD → mission 角色映射是产品语义上的最佳映射"，只承诺"信号能联通到 3D 场景"
- 本 spec 不承诺"蓝图 9 阶段在场景中的视觉密度是最终设计"，只承诺"阶段索引能驱动既有流线节点逐段点亮"
- 本 spec 不引入新的后端契约或 socket 协议，所有改动限定在前端 client 侧
