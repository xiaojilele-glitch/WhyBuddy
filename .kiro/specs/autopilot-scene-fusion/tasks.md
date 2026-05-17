# 任务清单：自动驾驶 3D 场景融合

## 概述

按 4 个 Wave 切分，每个 Wave 单独 commit、单独可回滚。所有任务均带可验证产出（代码 / 测试 / commit hash）。

工程基线（待 Wave D 收尾时核对，目前预期）：

- TS 错误数 ≤ 116（与既有基线一致，本 spec 不扩大基线）
- 既有 5140+ 测试不退化（mission-first 主路径行为完全保持）
- 新增纯函数测试 ~22 case（role-id-bridge ~10 + blueprint-stage-signal ~12）
- 新增 / 扩展 SSR 组件测试 ~7 case（Scene3D 1 / MissionIsland 1 / PetWorkers 2 / SceneStageFlow 3）
- 新增 4 个文件、修改 5 个组件、修改 2 处调用方（`AutopilotRoutePage` 第 819 行 + `Scene3DFallback`），合计 4 个 commit

切分原则：

- Wave A 落地“最小可见”：让蓝图页 `Scene3D` 立即停止显示 mission-first 残影
- Wave B 落地“角色跟随蓝图动起来”：以 FSD roleId → mission agent id 桥接接入 PetWorkers
- Wave C 落地“流线跟随阶段推进”：以 BlueprintGenerationJob 派生 SceneStageFlow 信号
- Wave D 收尾：跑类型检查、跑 6 个测试套件、跑 mission-first 回归、收口 spec 文档

mission-first 路径在每个 Wave 都通过默认值（`mode = "mission-first"`）保持完整向后兼容。

---

## Wave A：Scene3D mode prop + MissionIsland 隐藏

目标：让蓝图页 `Scene3D` 立刻不再显示 mission-first 的 `MissionIsland` 残影；为后续 Wave B / C 准备 prop drilling 通道。本 Wave 只改 SSR 组件树的 prop 形状与一个 hooks-after 短路，不接入任何蓝图业务数据，可独立合并、独立回滚。

- [x] 1. Scene3D 加 `mode` prop 与透传
  - 路径：`client/src/components/Scene3D.tsx`
  - 在 `Scene3DProps` 接口加 `mode?: SceneFusionMode`，默认 `"mission-first"`
  - 透传给 `PetWorkers` / `MissionIsland` / `SceneStageFlow` 三个子组件
  - 不影响 `SandboxMonitor` / `WaitingDecisionBubble`（它们与本 spec 范围外的后墙左终端 / 中区 HUD 联动语义无关）
  - 引入 `SceneFusionMode` 类型：本 Wave 在 `Scene3D.tsx` 内 inline 定义 `type SceneFusionMode = "mission-first" | "blueprint"`，Wave B 落地 `scene-fusion/role-id-bridge.ts` 后回填 import 路径
  - 不修改 `Scene3D` 内部 R3F 装配、不修改 `frameloop` / `dpr` / `performanceProfile` 适配
  - 需求：AC1 / AC2 / AC3 / AC4 / AC8

- [x] 2. MissionIsland 加 `mode` prop + 蓝图返回 null
  - 路径：`client/src/components/three/MissionIsland.tsx`
  - 在 props 接口加 `mode?: SceneFusionMode`，默认 `"mission-first"`
  - 关键 hooks 顺序约束：先调用所有 hooks（`useMissionIslandData` / `useState` / `useMemo` / `useFrame` 等），再判 `mode === "blueprint"` 返回 `null`，再走原有 JSX 渲染分支
  - 不允许把 `if (mode === "blueprint") return null;` 放在 hooks 调用之前，否则会触发 React 的 "Rendered fewer hooks than expected" 错误
  - mission-first 默认行为完全不变（不改坐标、不改材质、不改岛体几何）
  - 需求：AC3

- [x] 3. AutopilotRoutePage 传 mode="blueprint"
  - 路径：`client/src/pages/autopilot/AutopilotRoutePage.tsx` 第 819 行
  - 当前：`<Scene3D performanceProfile="balanced" projectId={currentProjectId} />`
  - 改为：`<Scene3D performanceProfile="balanced" projectId={currentProjectId} mode="blueprint" />`
  - 不修改 `currentProjectId` / `performanceProfile` 等既有 prop
  - 仅本行变更，不动 `AutopilotRoutePage` 其余 800+ 行的页面骨架
  - 需求：AC1 / AC3

- [x] 4. Scene3DFallback 透传 mode
  - 路径：`client/src/components/stream/Scene3DFallback.tsx`
  - props 加 `mode?: SceneFusionMode`，默认 `"mission-first"`
  - 透传给内部 `<Scene3D>`：`<Scene3D ... mode={mode} />`
  - 不破坏 `VideoStreamPlayer` 既有调用：`VideoStreamPlayer` 不传 `mode` 时默认走 mission-first（行为不变）
  - 不修改 fallback 触发条件 / 流式回退 / 占位帧逻辑
  - 需求：AC2 / AC8

- [x] 5. 测试：Scene3D mode prop SSR 透传 + MissionIsland 蓝图返回 null
  - 扩展 `client/src/components/__tests__/Scene3D.test.tsx`：
    - 新增 1 case：`renders without crashing when mode="blueprint"`，断言 SSR 不抛错且子组件接收到 `mode="blueprint"`
  - 扩展 `client/src/components/three/__tests__/MissionIsland.test.tsx`：
    - 新增 1 case：`returns null when mode="blueprint"`，断言 hooks 仍被调用、组件渲染为空
  - 既有 case 不变（mission-first 路径不退化）
  - 不引入新依赖（继续用既有 vitest + 内置 SSR 测试模式）
  - 需求：AC1 / AC2 / AC3

- [x] 6. commit Wave A
  - message：`feat(autopilot-scene-fusion): wave A scene3d mode prop and missionisland blueprint hide`
  - 文件清单（6 个文件）：
    - `client/src/components/Scene3D.tsx`
    - `client/src/components/three/MissionIsland.tsx`
    - `client/src/pages/autopilot/AutopilotRoutePage.tsx`（仅第 819 行）
    - `client/src/components/stream/Scene3DFallback.tsx`
    - `client/src/components/__tests__/Scene3D.test.tsx`
    - `client/src/components/three/__tests__/MissionIsland.test.tsx`
  - 验收：`vitest run` 上述 2 个测试文件全绿；`node --run check` TS 错误数 ≤ 116

---

## Wave B：PetWorkers FSD roleId 映射桥

目标：让蓝图页 7 pet 的角色阶段跟随 FSD blueprint 的 `rolePhases` 状态推进，但保持 7 pet 的视觉布局、坐标与姓名牌完全不动。本 Wave 引入纯函数模块 `role-id-bridge`，把 FSD roleId（`fsd.planner` / `fsd.researcher` 等）映射成 mission agent id（`agent.planner` / `agent.researcher` 等），再让 `PetWorkers` 在 `mode === "blueprint"` 时通过桥接函数读 store。

- [x] 1. 新建 `role-id-bridge.ts` 纯函数模块
  - 路径：`client/src/components/three/scene-fusion/role-id-bridge.ts`
  - 导出类型：
    - `FsdRoleId`：联合类型，覆盖 7 个 FSD 角色（按 AC6 列出）
    - `MissionAgentId`：联合类型，覆盖 7 个 mission agent id
    - `SceneFusionMode`：`"mission-first" | "blueprint"`（从 Wave A 的 inline 定义升级为正式导出）
  - 模块私有 `FSD_TO_MISSION` 映射表（按 AC6 的 7 条映射规则）
  - 导出 `readBlueprintRolePhase(rolePhases: Record<string, RolePhase>, missionAgentId: MissionAgentId): RolePhase | undefined` 纯函数
    - 优先读 FSD roleId（先做反查或正查）
    - FSD roleId 不存在时降级到 mission agent id 直读
    - 容忍空 / `undefined` rolePhases，返回 `undefined`
    - 容忍未知 missionAgentId，返回 `undefined`，不抛错
  - 中文 JSDoc 注释每个导出符号
  - 零副作用、零 hook 调用、零 DOM 引用
  - 需求：AC6 / AC9

- [x] 2. 新建 `role-id-bridge.test.ts` 纯函数测试
  - 路径：`client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`
  - case 列表（≥ 10）：
    - 7 个 FSD roleId 各自映射到正确 mission agent id（每个 case 一条断言）
    - 1 个 case：未知 FSD roleId fallback 到 mission agent id 直读
    - 1 个 case：直读 mission agent id（rolePhases 只含 mission agent id 时仍能命中）
    - 1 个 case：空 rolePhases 返回 `undefined`
    - 1 个 case：rolePhases 同时含 FSD roleId 与 mission agent id 时 FSD 优先（覆盖优先级语义）
  - 不引入新依赖（仅 vitest 内置 `describe` / `it` / `expect`）
  - 需求：AC6 / AC9

- [x] 3. PetWorkers 加 `mode` prop + selector 替换
  - 路径：`client/src/components/three/PetWorkers.tsx`
  - props 加 `mode?: SceneFusionMode`，默认 `"mission-first"`
  - AgentWorker 单卡 selector（第 720 行附近）替换为蓝图 / mission-first 双分支：

    ```tsx
    const rolePhase = useBlueprintRealtimeStore(state =>
      mode === "blueprint"
        ? readBlueprintRolePhase(state.rolePhases, config.id)
        : (state.rolePhases[config.id] as RolePhase | undefined)
    );
    ```

  - 不修改 7 pet 视觉布局（坐标 / 形象 / 姓名牌全部不动）
  - 不修改 `useFrame` 动画驱动逻辑、不修改 LOD / 阴影 / 材质
  - hooks 顺序约束：`useBlueprintRealtimeStore(...)` 仍在所有其它 hooks 之后、JSX 之前调用，避免触发 React hooks 规则告警
  - 需求：AC1 / AC2 / AC10

- [x] 4. 扩展 PetWorkers 测试
  - 路径：`client/src/components/three/__tests__/PetWorkers.test.tsx`
  - 新增 case：
    - case 1：`mode === "blueprint"` + mock store 提供 FSD roleId rolePhases，断言 AgentWorker 拿到映射后的 phase
    - case 2：`mode === "mission-first"` 直读 mission agent id（行为不变，作为回归保护）
  - 既有 case 不变（mission-first 默认路径不退化）
  - 不引入 `@testing-library/react` / `jsdom` / `happy-dom` 等新依赖
  - 需求：AC1 / AC2 / AC10

- [x] 5. commit Wave B
  - message：`feat(autopilot-scene-fusion): wave B petworkers fsd role id bridge`
  - 文件清单（4 个文件）：
    - 新增 `client/src/components/three/scene-fusion/role-id-bridge.ts`
    - 新增 `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`
    - 修改 `client/src/components/three/PetWorkers.tsx`
    - 修改 `client/src/components/three/__tests__/PetWorkers.test.tsx`
  - 同步把 Wave A 在 `Scene3D.tsx` 中 inline 的 `SceneFusionMode` 改为从 `scene-fusion/role-id-bridge` import（不算独立修改文件，包含在 `Scene3D.tsx` 的 Wave B 关联微调中；若不动 `Scene3D.tsx` 则保留 inline 不强制回填，由 Wave C 一并清理）
  - 验收：`vitest run` 上述 2 个测试文件全绿；`node --run check` TS 错误数 ≤ 116

---

## Wave C：SceneStageFlow 接蓝图阶段信号

目标：让蓝图页中区流线跟随 BlueprintGenerationJob 的 9 阶段推进。本 Wave 引入纯函数模块 `blueprint-stage-signal`，把 `BlueprintGenerationJob` 派生为 `BlueprintSceneStageSignal`，再让 `SceneStageFlow` 在 `mode === "blueprint"` 时分流派生信号。mission-first 信号路径完全保留。

- [x] 1. 新建 `blueprint-stage-signal.ts` 纯函数模块
  - 路径：`client/src/components/three/scene-fusion/blueprint-stage-signal.ts`
  - 导出 `BlueprintSceneStageSignal` 接口：
    - `stageKey: string`
    - `stageIndex: number`（0-based）
    - `totalStages: number`（恒为 9）
    - `progress: number`（0-1，第 0 阶段 = 0；第 8 阶段 = 1；中间阶段按 `stageIndex / (totalStages - 1)` 派生）
  - 导出 `BLUEPRINT_SCENE_STAGES: readonly string[]` 阶段顺序常量（9 个，按 AC4 / AC5）：
    1. `input`
    2. `clarification`
    3. `route_generation`
    4. `route_selection`
    5. `spec_tree`
    6. `spec_docs`
    7. `effect_preview`
    8. `prompt_packaging`
    9. `engineering_handoff`
  - 导出 `getBlueprintSceneStageSignal(job: BlueprintGenerationJob | null | undefined): BlueprintSceneStageSignal` 纯函数
  - 容忍：
    - `null` / `undefined` 入参 → 返回 SAFE_DEFAULT_SIGNAL（第 0 阶段 / progress = 0）
    - `currentStage` / `stage` 字段缺失 → 返回 SAFE_DEFAULT_SIGNAL
    - 未知 stageKey → 返回 SAFE_DEFAULT_SIGNAL，不抛错
  - 中文 JSDoc 注释每个导出符号
  - 零副作用、零 hook、零 DOM 引用
  - 需求：AC4 / AC5 / AC7

- [x] 2. 新建 `blueprint-stage-signal.test.ts` 纯函数测试
  - 路径：`client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
  - case 列表（≥ 12）：
    - case 1：`null` 入参 → SAFE_DEFAULT_SIGNAL
    - case 2：`undefined` 入参 → SAFE_DEFAULT_SIGNAL
    - case 3：`currentStage` / `stage` 字段都缺失 → SAFE_DEFAULT_SIGNAL
    - case 4：未知 stageKey（如 `"unknown_stage"`）→ SAFE_DEFAULT_SIGNAL（不抛错）
    - case 5-13：9 个阶段每个 case 验证 stageKey / stageIndex / totalStages / progress 四字段
    - 边界 case：第 0 阶段（`input`）progress = 0
    - 边界 case：第 8 阶段（`engineering_handoff`）progress = 1
  - 不引入新依赖
  - 需求：AC4 / AC5 / AC7

- [x] 3. SceneStageFlow 加 `mode` + `blueprintJob` props 与信号分流
  - 路径：`client/src/components/three/SceneStageFlow.tsx`
  - props 加：
    - `mode?: SceneFusionMode`，默认 `"mission-first"`
    - `blueprintJob?: BlueprintGenerationJob | null`，默认 `null`
  - 内部 if 分流：
    - `mode === "blueprint"` 分支：
      - 用 `getBlueprintSceneStageSignal(blueprintJob)` 派生 signal
      - 调用既有 `@/lib/scene-stage-flow` helpers 时传入 blueprint 阶段表（9 阶段）
    - `mode === "mission-first"` 分支：
      - 走原有 mission 信号路径（既有 helpers / 既有阶段表完全不变）
  - 不破坏既有 mission-first 信号路径（默认值保证向后兼容）
  - 不修改流线节点的几何 / 材质 / 动画曲线
  - 需求：AC4 / AC5 / AC7

- [x] 4. AutopilotRoutePage 传 blueprintJob
  - 路径：`client/src/pages/autopilot/AutopilotRoutePage.tsx` 第 819 行
  - Wave A 已经传 `mode="blueprint"`，本 Wave 增加 `blueprintJob={latestJob}`
  - 改为：`<Scene3D performanceProfile="balanced" projectId={currentProjectId} mode="blueprint" blueprintJob={latestJob} />`
  - `latestJob` 从既有 page-level state 读取（`BlueprintRealtimeStore` selector 或 `useBlueprintRealtimeStore` 读取的 job 对象）
  - 不新增 store / 不修改 selector 形状 / 不引入新 socket 事件
  - 需求：AC4

- [x] 5. 扩展 SceneStageFlow 测试
  - 路径：`client/src/components/three/__tests__/SceneStageFlow.test.tsx`
  - 新增 3 case：
    - case 1：`mode === "blueprint"` + blueprintJob 提供不同 stage（覆盖 3 个代表性阶段：input / route_selection / engineering_handoff），断言流线节点状态对应阶段索引
    - case 2：`mode === "mission-first"` 走既有 mission 信号（既有 case 完全不变，作为回归保护）
    - case 3：`mode === "blueprint"` + `blueprintJob === null` → 流线指向第 0 阶段（覆盖 AC7：早期接入兜底）
  - 既有 case 不变
  - 不引入新依赖
  - 需求：AC4 / AC5 / AC7

- [x] 6. commit Wave C
  - message：`feat(autopilot-scene-fusion): wave C scenestageflow blueprint stage signal`
  - 文件清单（5 个文件）：
    - 新增 `client/src/components/three/scene-fusion/blueprint-stage-signal.ts`
    - 新增 `client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
    - 修改 `client/src/components/three/SceneStageFlow.tsx`
    - 修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`（仅第 819 行 prop 追加）
    - 修改 `client/src/components/three/__tests__/SceneStageFlow.test.tsx`
  - 验收：`vitest run` 上述 2 个测试文件全绿；`node --run check` TS 错误数 ≤ 116

---

## Wave D：spec 收尾

目标：在 Wave A / B / C 全部 commit 后，统一跑类型检查、跑 6 个新增 / 扩展测试套件、跑相关 mission-first 路径回归，并完成 spec 三件套（requirements.md / design.md / tasks.md）的最终对齐。

- [-] 1. 跑 TS 类型检查
  - 命令：`node --run check`
  - 验收：错误数 = 116（与既有基线一致，本 spec 不扩大基线）
  - 若错误数 > 116，按超出条目逐项分析：
    - 若来自本 spec 新增代码 → 本 Wave 内修复
    - 若来自既有代码偶发回归 → 单独记录到 spec 收口纪要，不阻塞本 Wave 验收

- [-] 2. 跑新增 / 扩展测试套件
  - 命令（按 vitest 配置自动选择 client / server，本 spec 全部位于 client 侧）：

    ```sh
    vitest run client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts
    vitest run client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts
    vitest run client/src/components/__tests__/Scene3D.test.tsx
    vitest run client/src/components/three/__tests__/MissionIsland.test.tsx
    vitest run client/src/components/three/__tests__/PetWorkers.test.tsx
    vitest run client/src/components/three/__tests__/SceneStageFlow.test.tsx
    ```

  - 验收：上述 6 个测试套件全绿
  - 若任一套件失败：
    - 不允许通过修改 mission-first 既有 case 来"绕过"失败
    - 应回到对应 Wave 修复实现，重跑该 Wave 的 commit 验收

- [-] 3. 跑相关 mission-first 路径回归
  - 跑 `client/src/pages/__tests__/Home.desktop-layout.smoke.test.tsx` 等涉及 `Scene3D` 挂载的既有测试
  - 跑 `client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 确认蓝图页 SSR 透传 `mode` / `blueprintJob` 不破坏既有 case
  - 视情况补跑 `client/src/components/three/__tests__/SandboxMonitor.test.tsx` 与 `client/src/components/three/__tests__/MissionIsland.test.tsx`（确认后墙左终端联动 / 任务岛 mission-first 默认路径不退化）
  - 验收：既有 case 全部通过，5140+ 测试基线不退化

- [-] 4. spec 三件套收口
  - `requirements.md`：10 条 EARS AC 完整、可验收、无 TBD
  - `design.md`：9 条决策 + Wave A/B/C/D 切分 + 4 新增 + 5 修改 + 2 调用方 + 风险与回滚说明完整
  - `tasks.md`（本文件）：全部 task 勾选 `[x]` 完成
  - 全部 task 与 design 中的 Wave 切分一一对应，无悬空任务
  - commit message：`docs(autopilot-scene-fusion): wave D close out`
  - 文件清单（仅文档）：
    - `.kiro/specs/autopilot-scene-fusion/requirements.md`（若有最终修订）
    - `.kiro/specs/autopilot-scene-fusion/design.md`（若有最终修订）
    - `.kiro/specs/autopilot-scene-fusion/tasks.md`（勾选 `[x]` 全部任务）

---

## 不做的事（明确范围外）

本 spec 严格遵守 mission-first 兼容优先原则，以下范围本轮一律不动：

### 受保护文件（一行不改）

- `agent-reasoning-bridge.ts`（FSD 推理桥接）
- `callback-receiver.ts`（执行器回调）
- `lite-agent-runtime.ts`（轻量代理运行时）
- `llm-call.ts`（LLM 调用层）
- `useAutopilotSandboxBridge.ts`（沙箱桥接 hook）
- `MissionWallTaskPanel.tsx`（后墙中区任务 HUD）
- `MiroFishCardStream.tsx`（右栏流式卡片）

### 不重构 PetWorkers 7 pet 视觉布局

- pet 数量不动（仍为 7 个）
- pet 形象 / 模型 / 材质不动
- pet 坐标 / 阵型不动
- 姓名牌（`PetNameTag`）位置 / 文案 / 字体不动

### 不改既有联动语义

- 不改 `SandboxMonitor` 与后墙左终端的联动（已成立）
- 不改 `MissionWallTaskPanel` 后墙中区 HUD（已成立）
- 不改 mission-first 任务壳路由 / 任务工作台（`/tasks` / `TaskDetailView` 等）
- 不改 `mirofish-stream` 右栏流式卡片（独立 spec 已完成）

### 不改协议层

- 不引入新 socket / 不改 `socket-relay` 协议
- 不引入新 REST 接口 / 不改既有 `/api/blueprint/*` 契约
- 不改 `BlueprintGenerationJob` 数据形状（只读）
- 不改 `BlueprintRealtimeStore` selector 形状（只读）

### 不引入新依赖

- 不引入 `framer-motion`
- 不引入 `@testing-library/react`
- 不引入 `jsdom`
- 不引入 `happy-dom`
- 不引入 PBT 测试框架（仅 example-based）
- 不引入任何新 npm 包

### 不引入跨组件状态机制

- 不引入 React context 传 `mode`（通过 page-level prop drill 透传）
- 不新增 zustand store 切片
- 不引入 `useReducer` 跨组件协调

### 测试侧严格约束

- 不引入 PBT 测试，全部 example-based
- 不扩大 TS 基线 116
- 不破坏既有 5140+ 测试

---

## 总结

`autopilot-scene-fusion` feature spec 4 个 Wave：

- **Wave A**：Scene3D mode prop + MissionIsland 隐藏（最小可见，蓝图页不再显示 mission-first 残影）
- **Wave B**：PetWorkers FSD → mission agent id 映射桥（蓝图页 7 pet 角色跟随 FSD blueprint 动起来）
- **Wave C**：SceneStageFlow 接蓝图阶段信号（蓝图页中区流线跟随 9 阶段推进）
- **Wave D**：spec 收尾 + 测试回归 + 文档收口

新增 4 文件 + 修改 5 文件 + 调用方 2 处。预期：4 个 commit。TS 基线 116，5140+ 测试不退化。

落地后蓝图页（`/autopilot/route`）的 `Scene3D` 不再显示 mission-first 残影，7 pet 与中区流线跟随 FSD blueprint 与 BlueprintGenerationJob 的实时状态推进；mission-first 主路径（`/` 办公室壳 / `/tasks` 任务工作台）行为完全保持不变。
