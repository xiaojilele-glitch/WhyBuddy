# 自动驾驶 3D 场景融合 — 设计文档

## 设计概述

本设计的目标是把 `/autopilot` 蓝图驾驶舱的 3D 场景与既有 `BlueprintRealtimeStore` 信号源接通，让 `PetWorkers` / `MissionIsland` / `SceneStageFlow` 三个 3D 组件在蓝图页跟随后端 emit 的 FSD 角色阶段事件与 9 阶段推进动起来；同时保证 mission-first 任务壳路径（`/tasks` 等）的 3D 联动行为完全不变。

整套方案以"最小侵入接 3 个 3D 组件 + 两个纯函数桥"为核心：

- **不引入新 React context、不引入新 socket、不引入新动画库**
- **mode 判别采用 page-level prop drill**：`Scene3D` 新增 `mode?: "blueprint" | "mission-first"` prop，由调用 page（`AutopilotRoutePage` / `Home`）决定模式
- **新增两个纯函数模块**：`role-id-bridge.ts` 把 FSD roleId 翻译为 mission agent id；`blueprint-stage-signal.ts` 把 `BlueprintGenerationJob` 翻译为 `SceneStageFlow` 既有流线节点可消费的标准化信号对象
- **既有 mission-first 信号路径不动**：mode 默认值即 `"mission-first"`，所有未显式传 `mode` 的调用方走原有代码路径

落地节奏按 4 个 Wave 切分（详见后文"Wave 切分"章节），每个 Wave 单独 commit、单独可回滚，最小可见就交付，不堆积一次性大改动。

## 设计原则

1. **mission-first 默认行为不变**：`mode` 默认值为 `"mission-first"`，所有既有调用方（`Home.tsx` / `Scene3DFallback.tsx` 透传 / `VideoStreamPlayer.tsx` 间接使用）在不显式传 mode 时走原路径，不退化既有 5140+ 测试；
2. **mode 通过 page-level prop drill 透传，不引入 React context**：避免新增跨组件状态层，`Scene3D` 把 `mode` 透传给 `PetWorkers` / `MissionIsland` / `SceneStageFlow`，page 入口（`AutopilotRoutePage` 传 `mode="blueprint"`、`Home` 不传或显式传 `"mission-first"`）决定模式；
3. **roleId 映射与阶段映射封装为纯函数**：`readBlueprintRolePhase()` / `getBlueprintSceneStageSignal()` 都是 input → output 的纯函数，零副作用、零 React hook 依赖、容忍 `null / undefined / 未知 key / 空 rolePhases` 等空态，方便单点替换映射表；
4. **不修改受保护文件**：`agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` / `useAutopilotSandboxBridge.ts` / `MissionWallTaskPanel.tsx` / `MiroFishCardStream.tsx` 严格只读，不在本 spec 改动范围内；
5. **测试沿用 SSR + `vi.mock` 模式**：不引入 `@testing-library/react` / `jsdom` / `happy-dom`，纯函数测试用直接 import + 断言，组件测试用 `react-dom/server` 渲染 + selector 查找；
6. **Wave 切分单独可回滚**：每个 Wave（Scene3D mode prop / 映射桥 / 阶段信号 / spec 收尾）独立 commit，任一 Wave 出问题可单独 revert，不污染主线。

## 模块结构图

```
client/src/components/
├── Scene3D.tsx                                  ← 修改：加 mode prop + 透传
├── three/
│   ├── PetWorkers.tsx                           ← 修改：加 mode prop + selector 替换
│   ├── MissionIsland.tsx                        ← 修改：加 mode prop + 蓝图返回 null
│   ├── SceneStageFlow.tsx                       ← 修改：加 mode + blueprintJob props + signal 分流
│   └── scene-fusion/                            ← 新增子目录
│       ├── role-id-bridge.ts                    ← 新增：FSD → mission agent id 纯函数桥
│       ├── blueprint-stage-signal.ts            ← 新增：BlueprintGenerationJob → 阶段信号纯函数
│       └── __tests__/
│           ├── role-id-bridge.test.ts           ← 新增：纯函数测试
│           └── blueprint-stage-signal.test.ts   ← 新增：纯函数测试
└── stream/
    └── Scene3DFallback.tsx                      ← 修改：透传 mode

client/src/pages/
├── autopilot/
│   └── AutopilotRoutePage.tsx                   ← 修改：传 mode="blueprint" + blueprintJob
└── Home.tsx                                     ← 不修改（mode 默认 "mission-first"）
```

调用关系（蓝图页）：

```
AutopilotRoutePage
  └─ <Scene3D mode="blueprint" projectId={...} />
       ├─ <PetWorkers mode="blueprint" />
       │    └─ AgentWorker (内部) → readBlueprintRolePhase(rolePhases, missionAgentId)
       ├─ <MissionIsland mode="blueprint" projectId={...} />
       │    └─ if (mode === "blueprint") return null;
       ├─ <SceneStageFlow mode="blueprint" blueprintJob={latestJob} projectId={...} />
       │    └─ getBlueprintSceneStageSignal(blueprintJob) → 阶段信号
       ├─ <SandboxMonitor projectId={...} />            （受保护，不改）
       └─ <WaitingDecisionBubble projectId={...} />     （受保护，不改）
```

调用关系（mission-first 页）：

```
Home / OfficeTaskCockpit
  └─ <Scene3D performanceProfile={...} sidebarWidth={...} />   （未传 mode，默认 "mission-first"）
       ├─ <PetWorkers mode="mission-first" />
       │    └─ AgentWorker (内部) → state.rolePhases[config.id]    （直读 mission agent id）
       ├─ <MissionIsland mode="mission-first" projectId={...} />
       │    └─ 走既有 useMissionIslandData 路径（行为不变）
       ├─ <SceneStageFlow mode="mission-first" projectId={...} />
       │    └─ 走既有 mission 信号路径（行为不变）
       ├─ <SandboxMonitor projectId={...} />            （受保护，不改）
       └─ <WaitingDecisionBubble projectId={...} />     （受保护，不改）
```

## 接口与数据契约

### 类型定义

新增类型分布在两个纯函数模块中。所有类型均使用中文 JSDoc 注释，对外导出便于测试与组件消费。

```ts
/**
 * 自动驾驶 3D 场景融合模式判别。
 *
 * - `"blueprint"`：蓝图页（`/autopilot`），3D 场景跟随 BlueprintRealtimeStore 的 FSD 角色阶段事件与 9 阶段推进；
 * - `"mission-first"`：mission-first 任务壳（`/tasks` 等），3D 场景跟随既有 mission rolePhases 与 mission 阶段信号。
 *
 * 默认值为 `"mission-first"`，确保未显式传 `mode` 的调用方走原路径，不改变既有行为。
 */
export type SceneFusionMode = "blueprint" | "mission-first";
```

### roleId 映射桥纯函数

文件路径：`client/src/components/three/scene-fusion/role-id-bridge.ts`

```ts
/**
 * autopilot-scene-fusion 角色 ID 映射桥（FSD → mission agent id）。
 *
 * 蓝图后端 emit 的 `role.activated` / `role.message` / `role.completed` 等事件
 * payload.roleId 是 FSD 角色名（共 7 个），但 PetWorkers 配置使用的是 mission agent id
 * 体系（也是 7 个）。该纯函数用近似映射把 FSD roleId 翻译为 mission agent id，
 * 让 3D 场景在蓝图页能够跟随 FSD 角色阶段动起来。
 *
 * 映射不准是已知风险（已写入 requirements.md 风险段 1），后续可以单点替换该映射表，
 * 不会扩散到调用方。
 */

/** FSD 蓝图后端使用的 7 个角色名。 */
export type FsdRoleId =
  | "planner"
  | "clarifier"
  | "analyzer"
  | "generator"
  | "reviewer"
  | "auditor"
  | "operator";

/** mission-first 任务壳使用的 7 个 agent id。 */
export type MissionAgentId =
  | "agent-ceo"
  | "agent-manager-research"
  | "agent-manager-design"
  | "agent-manager-engineering"
  | "agent-worker-research"
  | "agent-worker-design"
  | "agent-worker-engineering";

/**
 * FSD roleId → mission agent id 的近似映射表。
 *
 * 映射方向（来自 requirements.md AC6）：
 * - `planner   → agent-manager-research`
 * - `clarifier → agent-ceo`
 * - `analyzer  → agent-manager-design`
 * - `generator → agent-worker-design`
 * - `reviewer  → agent-manager-engineering`
 * - `auditor   → agent-worker-engineering`
 * - `operator  → agent-worker-research`
 */
const FSD_TO_MISSION: Record<FsdRoleId, MissionAgentId> = {
  planner: "agent-manager-research",
  clarifier: "agent-ceo",
  analyzer: "agent-manager-design",
  generator: "agent-worker-design",
  reviewer: "agent-manager-engineering",
  auditor: "agent-worker-engineering",
  operator: "agent-worker-research",
};

/**
 * 从 BlueprintRealtimeStore.rolePhases 中按 mission agent id 读取对应的 RolePhase。
 *
 * 优先策略（蓝图模式专用）：
 *   1. 反查 FSD roleId：遍历 FSD_TO_MISSION，找到所有映射到目标 mission agent id 的 FSD roleId，
 *      若 rolePhases 中存在对应 FSD roleId 的 phase，则优先返回（对应 AC9：FSD 优先）;
 *   2. fallback：若没有 FSD roleId 命中，则直读 mission agent id（对应 AC6 fallback）;
 *   3. 若都没有，返回 `undefined`，由调用方走 idle 默认 phase。
 *
 * mission-first 模式下不调用此函数，组件直接 `state.rolePhases[config.id]` 读 mission agent id。
 *
 * @param rolePhases - BlueprintRealtimeStore 的 rolePhases 字典（key 可能是 FSD roleId 或 mission agent id）
 * @param missionAgentId - 目标 mission agent id（PetWorkers 配置中 config.id）
 * @returns 对应的 RolePhase；不存在则返回 `undefined`
 */
export function readBlueprintRolePhase(
  rolePhases: Record<string, RolePhase>,
  missionAgentId: MissionAgentId
): RolePhase | undefined {
  // 反查：找出所有映射到该 mission agent id 的 FSD roleId
  for (const [fsdRoleId, mappedMissionId] of Object.entries(FSD_TO_MISSION)) {
    if (mappedMissionId === missionAgentId) {
      const phase = rolePhases[fsdRoleId];
      if (phase !== undefined) return phase;
    }
  }
  // fallback：直读 mission agent id
  return rolePhases[missionAgentId];
}
```

### 蓝图阶段信号纯函数

文件路径：`client/src/components/three/scene-fusion/blueprint-stage-signal.ts`

```ts
/**
 * autopilot-scene-fusion 蓝图阶段信号纯函数。
 *
 * 把 BlueprintGenerationJob 的当前阶段映射到 SceneStageFlow 既有流线节点上，
 * 使蓝图 9 阶段推进时场景流线节点能够逐段点亮。
 *
 * 第 10 阶段 `artifact_memory` 复用 `engineering_handoff` 末尾节点，
 * 不为它单独占位（对应 requirements.md 风险段 4）。
 */
import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

/**
 * 标准化阶段信号对象。
 *
 * 字段语义：
 * - `stageKey`：当前阶段 key（例如 `"spec_tree"`），未开始时为 `"input"`；
 * - `stageIndex`：阶段索引，0..N-1，未开始时为 0；
 * - `totalStages`：总阶段数，恒为 9；
 * - `progress`:0..1 之间的进度比例，等于 `stageIndex / (totalStages - 1)`，未开始时为 0。
 */
export interface BlueprintSceneStageSignal {
  stageKey: string;
  stageIndex: number;
  totalStages: number;
  progress: number;
}

/**
 * 蓝图 9 阶段在场景流线上的节点顺序。
 *
 * 来自 requirements.md 风险段 4 的明确约定：
 * `input` / `clarification` / `route_generation` / `route_selection` /
 * `spec_tree` / `spec_docs` / `effect_preview` / `prompt_packaging` /
 * `engineering_handoff`（artifact_memory 复用此节点末尾）
 */
export const BLUEPRINT_SCENE_STAGES: ReadonlyArray<string> = [
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "spec_tree",
  "spec_docs",
  "effect_preview",
  "prompt_packaging",
  "engineering_handoff",
];

/** 安全默认信号：未开始 / 第 0 阶段 / 进度 0。 */
const SAFE_DEFAULT_SIGNAL: BlueprintSceneStageSignal = {
  stageKey: "input",
  stageIndex: 0,
  totalStages: BLUEPRINT_SCENE_STAGES.length,
  progress: 0,
};

/**
 * 把 BlueprintGenerationJob 翻译为 SceneStageFlow 可消费的标准化信号。
 *
 * 容错规则（对应 AC5 + AC7）：
 * - `job` 为 `null` / `undefined` → 返回 SAFE_DEFAULT_SIGNAL；
 * - `job.currentStage` / `job.stage` 都缺失 → 返回 SAFE_DEFAULT_SIGNAL；
 * - currentStage 不在 BLUEPRINT_SCENE_STAGES 内 → 返回 SAFE_DEFAULT_SIGNAL（不抛错）。
 *
 * 该函数零副作用、零 hook、可在任何渲染阶段安全调用。
 *
 * @param job - 当前 BlueprintGenerationJob，可能为 null / undefined
 * @returns 标准化的阶段信号对象
 */
export function getBlueprintSceneStageSignal(
  job: BlueprintGenerationJob | null | undefined
): BlueprintSceneStageSignal {
  if (!job) return SAFE_DEFAULT_SIGNAL;
  const currentStage = job.currentStage ?? job.stage ?? null;
  if (!currentStage) return SAFE_DEFAULT_SIGNAL;
  const idx = BLUEPRINT_SCENE_STAGES.indexOf(currentStage);
  if (idx < 0) return SAFE_DEFAULT_SIGNAL;
  return {
    stageKey: currentStage,
    stageIndex: idx,
    totalStages: BLUEPRINT_SCENE_STAGES.length,
    progress: idx / (BLUEPRINT_SCENE_STAGES.length - 1),
  };
}
```

### 组件 Props 增量

下表列出本 spec 涉及到的组件 props 增量；既有 props 不修改、不重命名。

| 组件 | 新增 prop | 类型 | 默认值 | 说明 |
| ---- | -------- | ---- | ------ | ---- |
| `Scene3D` | `mode` | `SceneFusionMode` | `"mission-first"` | 透传给 `PetWorkers` / `MissionIsland` / `SceneStageFlow` |
| `PetWorkers` | `mode` | `SceneFusionMode` | `"mission-first"` | 控制 selector 是否经过映射桥 |
| `MissionIsland` | `mode` | `SceneFusionMode` | `"mission-first"` | 蓝图模式直接 `return null` |
| `SceneStageFlow` | `mode` | `SceneFusionMode` | `"mission-first"` | 控制阶段信号源 |
| `SceneStageFlow` | `blueprintJob` | `BlueprintGenerationJob \| null` | `null` | 蓝图模式下用于派生阶段信号 |
| `Scene3DFallback` | `mode` | `SceneFusionMode` | `"mission-first"` | 透传给 Scene3D |

## 设计决策

下面 9 条设计决策按"决策内容 / 替代方案 / 选择理由"三段式展开，逐条对应实现细节。

### 决策 1：mode 判别采用 page-level prop drill

**决策内容**：给 `Scene3D` 加一个 optional prop `mode?: SceneFusionMode`，默认值 `"mission-first"`。`Scene3D` 把 `mode` 一路透传给 `PetWorkers` / `MissionIsland` / `SceneStageFlow`。调用方修改如下：

- `client/src/pages/autopilot/AutopilotRoutePage.tsx` 第 819 行：`<Scene3D performanceProfile="balanced" projectId={currentProjectId} mode="blueprint" />`
- `client/src/pages/Home.tsx` 第 1284-1289 行：保持不变（默认 `"mission-first"`）
- `client/src/components/stream/Scene3DFallback.tsx`：透传 `mode` prop
- `client/src/components/stream/VideoStreamPlayer.tsx`：通过 `Scene3DFallback` 间接使用，不直接改

`Scene3D` 类型签名：

```ts
type SceneFusionMode = "blueprint" | "mission-first";

interface Scene3DProps {
  // 既有
  performanceProfile?: ScenePerformanceProfile;
  sidebarWidth?: number;
  hidden?: boolean;
  projectId?: string | null;
  // 新加
  mode?: SceneFusionMode;
}
```

**替代方案**：

1. **新增 React context（`SceneFusionModeContext`）**：在 `/autopilot` 路由层 provide `"blueprint"`，默认 fallback `"mission-first"`，3D 组件用 `useContext` 读 mode。
2. **基于 `useLocation()` 路由判别**：3D 组件内部读路由路径，`/autopilot` 走蓝图，其它走 mission-first。

**选择理由**：

- 替代方案 1 引入新跨组件状态层，违反"最小侵入"原则；context 的 provide 位置如果离 `Scene3D` 太远还会出现"忘记 provide 时默认 mission-first"的歧义；
- 替代方案 2 把路由耦合进 3D 组件层，3D 组件本身不应该知道路由结构；同时 `Scene3DFallback` 在 stream 场景下也会被复用，路由判别会出错；
- prop drill 路径浅（只过 1 层 `Scene3D`），调用方明确，符合 requirements.md 风险段 3 给出的两个方案中"page-level prop drill"的偏好。

### 决策 2：roleId 映射桥纯函数（FSD → mission agent id）

**决策内容**：新建 `client/src/components/three/scene-fusion/role-id-bridge.ts`，导出 `FsdRoleId` / `MissionAgentId` 类型、`FSD_TO_MISSION` 映射表（不导出，模块私有）、`readBlueprintRolePhase()` 纯函数。映射规则严格按 requirements.md AC6 落地，零副作用、零 hook、容忍 `null / undefined / 未知 key / 空 rolePhases`。

读取策略（对应 AC9：FSD 优先）：

1. 反查 FSD roleId：遍历 `FSD_TO_MISSION`，找出所有映射到目标 mission agent id 的 FSD roleId，若 `rolePhases[fsdRoleId]` 存在则返回；
2. fallback：直读 `rolePhases[missionAgentId]`，对应 AC6 的"未知 FSD roleId 时按 mission agent id 直读"兼容行为；
3. 都没命中：返回 `undefined`，由调用方走 idle 默认 phase。

**替代方案**：

1. **在 `BlueprintRealtimeStore` 内做映射**：store 收到 FSD roleId 事件时直接转成 mission agent id 写入 `rolePhases`。
2. **在 `agent-reasoning-bridge.ts` 改 emit 事件 payload**：让后端直接 emit mission agent id。
3. **多套字典 + 反向查表 helper**：再建 `MISSION_TO_FSD` 反向表，但用不到这种双向能力。

**选择理由**：

- 替代方案 1 让 store 承担了它不该负责的语义翻译，且 store 对外契约会被改动，影响其它消费方（例如 `MiroFishCardStream` 也读 store）；
- 替代方案 2 直接修改受保护后端文件，违反工程约束 6；
- 替代方案 3 增加复杂度，本 spec 只需"按 mission agent id 反查 FSD roleId"这一个方向；
- 选择前端纯函数桥的优点：单点替换映射表、零副作用便于测试、不污染其它模块、不改后端契约。

### 决策 3：getBlueprintSceneStageSignal 纯函数

**决策内容**：新建 `client/src/components/three/scene-fusion/blueprint-stage-signal.ts`，导出 `BlueprintSceneStageSignal` 类型、`BLUEPRINT_SCENE_STAGES` 阶段顺序常量（9 个节点）、`getBlueprintSceneStageSignal()` 纯函数。第 10 阶段 `artifact_memory` 复用 `engineering_handoff` 末尾节点，不单独占位。

容错策略（对应 AC5 + AC7）：

- `job` 为 `null` / `undefined` → 返回 `SAFE_DEFAULT_SIGNAL`；
- `job.currentStage` / `job.stage` 都缺失 → 返回 `SAFE_DEFAULT_SIGNAL`；
- currentStage 不在 `BLUEPRINT_SCENE_STAGES` 内 → 返回 `SAFE_DEFAULT_SIGNAL`（不抛错）；
- 正常分支：`stageKey` = currentStage，`stageIndex` = `BLUEPRINT_SCENE_STAGES.indexOf(currentStage)`，`progress` = `idx / (totalStages - 1)`。

**替代方案**：

1. **直接把 BlueprintGenerationJob 传给 SceneStageFlow，由组件内部判断**：组件耦合 BlueprintGenerationJob 数据结构。
2. **在 `BlueprintRealtimeStore` 派生 currentStageIndex**：store 承担派生逻辑。
3. **不复用 engineering_handoff 末尾，给 artifact_memory 单独建第 10 个节点**：场景流线节点过密。

**选择理由**：

- 替代方案 1 让 SceneStageFlow 与 BlueprintGenerationJob 直接耦合，未来 BlueprintGenerationJob 字段变化会扩散到组件，违反单一职责；
- 替代方案 2 把派生逻辑放进 store，但 store 应只持有规范化数据，不该持有"针对 SceneStageFlow 的派生"；
- 替代方案 3 节点过密，requirements.md 风险段 4 明确建议复用 engineering_handoff 末尾；
- 选择纯函数的优点：测试简单、可单点替换阶段顺序、不耦合 store / 组件、对外类型边界清晰。

### 决策 4：组件 mode 透传具体方案

**决策内容**：四个组件分别按下面方式接 `mode` prop。

**Scene3D.tsx**：

- 加 `mode?: SceneFusionMode` prop（默认 `"mission-first"`）；
- 透传给 `PetWorkers` / `MissionIsland` / `SceneStageFlow`；
- 不影响 `SandboxMonitor` / `WaitingDecisionBubble`（受保护或不在范围）。

**PetWorkers.tsx**：

- 加 `mode?: SceneFusionMode` prop；
- AgentWorker 单卡内部把第 720 行的 selector 替换为：

```tsx
const rolePhase = useBlueprintRealtimeStore(state =>
  mode === "blueprint"
    ? readBlueprintRolePhase(state.rolePhases, config.id)
    : (state.rolePhases[config.id] as RolePhase | undefined)
);
```

- mission-first 默认行为完全不变（直读 `state.rolePhases[config.id]`）。

**MissionIsland.tsx**：

- 加 `mode?: SceneFusionMode` prop；
- 顶部条件渲染：`if (mode === "blueprint") return null;`
- mission-first 默认行为完全不变（继续走 `useMissionIslandData(projectId)` 路径）；
- 注意：要在所有 hook 调用之前判 mode → return null 是不允许的（hooks 顺序约束），因此判断必须在 hooks 之后、JSX return 之前：先调用所有 hooks，再判 mode。

**SceneStageFlow.tsx**：

- 加 `mode?: SceneFusionMode` prop；
- 加可选 `blueprintJob?: BlueprintGenerationJob | null` prop（蓝图页传入）；
- 内部 if 分流：
  - `mode === "blueprint"` → 用 `getBlueprintSceneStageSignal(blueprintJob)` 派生 signal，调用既有 `@/lib/scene-stage-flow` helpers 时改用 blueprint 阶段表（`BLUEPRINT_SCENE_STAGES`）；
  - `mode === "mission-first"` → 走原有路径（既有 mission helpers 不变）；
- 不破坏既有 mission-first 信号路径。

**替代方案**：

1. **PetWorkers 内部先把 rolePhases 复制一份再翻译**：每帧重建对象，性能差；
2. **MissionIsland 用 CSS `display: none` 隐藏**：3D 场景用 CSS 不直观，仍会跑 hooks 与渲染计算；
3. **SceneStageFlow 内部读 BlueprintRealtimeStore**：组件耦合 store，不能复用到不同信号源。

**选择理由**：

- selector 内部分流是 zustand 推荐用法，每次 selector 只调一次，性能最优；
- `return null` 在 hooks 之后判断不会触发 hooks 顺序错误，3D 组件树中这是常用做法；
- prop 注入信号源比组件内读 store 更可测、更可复用，未来若蓝图阶段表变化只改纯函数即可。

### 决策 5：Wave 切分

**决策内容**：把改动按 4 个 Wave 切分，单独 commit、单独可回滚。

```
Wave A — Scene3D mode prop + MissionIsland 隐藏
  - Scene3D.tsx 加 mode prop（默认 "mission-first"）
  - MissionIsland.tsx 加 mode prop + 顶部条件渲染（蓝图模式 return null）
  - AutopilotRoutePage.tsx 传 mode="blueprint"
  - Scene3DFallback.tsx 透传 mode（保持兼容）
  - 测试：Scene3D mode prop SSR 测试 + MissionIsland mode 测试
  - 这一波最小可见，单独 commit

Wave B — PetWorkers FSD roleId 映射桥
  - 新建 scene-fusion/role-id-bridge.ts + 单测
  - PetWorkers.tsx 加 mode prop + selector 替换
  - 测试：role-id-bridge 纯函数测试 + PetWorkers SSR mode 测试
  - 单独 commit

Wave C — SceneStageFlow 接蓝图阶段信号
  - 新建 scene-fusion/blueprint-stage-signal.ts + 单测
  - SceneStageFlow.tsx 加 mode + blueprintJob props
  - AutopilotRoutePage 传 blueprintJob={latestJob}
  - 测试：blueprint-stage-signal 纯函数测试 + SceneStageFlow mode 测试
  - 单独 commit

Wave D — spec 收尾
  - 创建 tasks.md（Wave 0/1/2/3 全部勾选）
  - 跑 node --run check 确认 116
  - 跑前端测试确认 mission-first 路径不退化
  - 跑后端测试确认无回归（不应该有 server 改动）
  - commit docs
```

**替代方案**：

1. **一次性大改动**：所有改动一个 commit。
2. **按文件切分**：Scene3D / PetWorkers / MissionIsland / SceneStageFlow 各一个 commit。

**选择理由**：

- 一次性大改动出问题难定位；按文件切分的话每个 commit 单独不可见效，回滚也不直观；
- Wave A / B / C 每个 Wave 都有独立的"用户可见效果"（Wave A 蓝图页不再显示残影 MissionIsland、Wave B PetWorkers 跟随 FSD 角色动起来、Wave C 流线跟随蓝图阶段推进），符合"最小可见就交付"的工程节奏。

### 决策 6：测试策略

**决策内容**：仓库不集成 `@testing-library/react`，沿用 SSR + `vi.mock` 模式。具体分两层：

**纯函数测试层**（在 `__tests__/` 直接 import 测）：

- `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`
  - 7 个 FSD roleId 映射正确性（每个 case）
  - 未知 FSD roleId 时 fallback 到 mission agent id 直读
  - 直读 mission agent id（rolePhases 只含 mission agent id）
  - 空 rolePhases 返回 undefined
  - 同时含 FSD roleId 与 mission agent id 时 FSD 优先（对应 AC9）
  - 共 ~10 个 case
- `client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
  - `null` 入参返回 SAFE_DEFAULT_SIGNAL
  - `undefined` 入参返回 SAFE_DEFAULT_SIGNAL
  - currentStage / stage 都缺失返回 SAFE_DEFAULT_SIGNAL
  - 未知 stage 返回 SAFE_DEFAULT_SIGNAL（不抛错）
  - 9 阶段每个阶段映射的 stageIndex / progress 正确
  - 共 ~12 个 case

**SSR 组件测试层**（用 `react-dom/server` + `vi.mock`）：

- `client/src/components/three/__tests__/MissionIsland.test.tsx`（既有文件，新增 case）
  - mode === "blueprint" 时返回 null（DOM 中不出现 MissionIsland 内容）
  - mode === "mission-first" 时正常渲染（行为不变）
- `client/src/components/three/__tests__/PetWorkers.test.tsx`（既有文件，新增 case）
  - mode === "blueprint" 时通过 mock store 提供 FSD roleId rolePhases，断言对应 AgentWorker 读到映射后的 phase
  - mode === "mission-first" 时直读 mission agent id（行为不变）
- `client/src/components/three/__tests__/SceneStageFlow.test.tsx`（既有文件，新增 case）
  - mode === "blueprint" 时传入 blueprintJob，断言流线节点状态对应阶段索引
  - mode === "mission-first" 时走既有 mission 信号（行为不变）
- `client/src/components/__tests__/Scene3D.test.tsx`（既有文件，新增 case）
  - mode prop SSR 透传到子组件（断言子组件 props 中存在 mode）

**说明**：`derive-mirofish-stream-entries.test.ts` 已存在，本 spec 不动。

**替代方案**：

1. **引入 `@testing-library/react`**：违反工程约束 5。
2. **不写 SSR 组件测试，只写纯函数测试**：覆盖度不够，mode 透传与 mock store 交互无法验证。

**选择理由**：

- 沿用既有 SSR + `vi.mock` 模式，不引入新测试依赖，与 5140+ 既有测试体系一致；
- 纯函数 + 组件双层覆盖，纯函数层测试逻辑正确性、组件层测试集成正确性，互补且各自简洁。

### 决策 7：受影响文件清单

**决策内容**：

```
新增文件（4 个）：
  client/src/components/three/scene-fusion/role-id-bridge.ts
  client/src/components/three/scene-fusion/blueprint-stage-signal.ts
  client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts
  client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts

修改文件（5 个）：
  client/src/components/Scene3D.tsx                 (加 mode prop + 透传)
  client/src/components/three/PetWorkers.tsx        (加 mode prop + selector 替换)
  client/src/components/three/MissionIsland.tsx     (加 mode prop + 蓝图返回 null)
  client/src/components/three/SceneStageFlow.tsx    (加 mode + blueprintJob props + signal 分流)
  client/src/components/stream/Scene3DFallback.tsx  (透传 mode)

修改调用方（2 个）：
  client/src/pages/autopilot/AutopilotRoutePage.tsx (传 mode="blueprint" + blueprintJob)
  client/src/pages/Home.tsx                         (无变化，mode 默认 "mission-first")
```

**说明**：`Home.tsx` 列在"修改调用方"是为了显式声明"已检查、确认无需修改"，便于审阅时一目了然。

**替代方案**：

- 把 `role-id-bridge.ts` 与 `blueprint-stage-signal.ts` 放到 `client/src/lib/` 下：违反"按 feature 分目录"的现有组织习惯，3D 场景相关 helpers 都在 `client/src/components/three/` 下。

**选择理由**：

- 新增 `scene-fusion/` 子目录把本 spec 的两个纯函数模块就近放置，便于追踪、便于回滚；
- 改动文件清单严格控制在 4 新增 + 5 修改 + 2 调用方，可控范围小。

### 决策 8：受保护边界

**决策内容**：本 spec 严格不改动以下文件：

- `agent-reasoning-bridge.ts`（受保护后端）
- `callback-receiver.ts`（受保护后端）
- `lite-agent-runtime.ts`（受保护后端）
- `llm-call.ts`（受保护后端）
- `useAutopilotSandboxBridge.ts`（已成立，SandboxMonitor 联动锁）
- `MissionWallTaskPanel.tsx`（已成立，紧凑 HUD 与 2026-04-21 遮挡修复）
- `MiroFishCardStream.tsx`（独立 spec 已完成，右栏挂载点）

**替代方案**：无（这是工程约束 6 的硬性要求）。

**选择理由**：受保护边界保证后端契约稳定 / 既有 spec 收口不被反向破坏 / 跨 spec 边界清晰。

### 决策 9：风险缓解

**决策内容**：requirements.md 列出 6 条风险，design 阶段对应缓解如下：

| 需求侧风险 | 设计侧缓解 |
| ---------- | ---------- |
| 风险 1：FSD → mission 角色映射不完美 | 决策 2：用近似映射，单点函数 `readBlueprintRolePhase` 后续可单点替换映射表 |
| 风险 2：SceneStageFlow 当前可能耦合 mission 数据 | 决策 4：信号源以 prop 注入，`mode === "mission-first"` 走原路径行为不变；`mode === "blueprint"` 走 blueprint 阶段表 |
| 风险 3：蓝图页 vs mission-first 页判别方式 | 决策 1：page-level prop drill，避免 context 引入跨组件状态 |
| 风险 4：9 阶段映射到 9 个流线节点节点过多 | 决策 3：`artifact_memory` 复用 `engineering_handoff` 末尾节点，明确 `BLUEPRINT_SCENE_STAGES` 9 个 |
| 风险 5：`rolePhases` 短时为空对象 | 决策 2 / 决策 3：纯函数容空，PetWorkers 走 idle 默认 phase；SceneStageFlow 走 SAFE_DEFAULT_SIGNAL |
| 风险 6：既有 5140+ 测试不能退化 | 决策 6：测试策略明确分纯函数 + SSR 两层；mission-first 路径默认行为完全不变 |

## Wave 切分

下面把 4 个 Wave 的具体步骤展开，作为后续 tasks.md 的输入。每个 Wave 都满足"单独可见效果 / 单独 commit / 单独可回滚"。

### Wave A：Scene3D mode prop + MissionIsland 隐藏

**目标**：蓝图页打开时 MissionIsland 不再显示空态或旧 mission 残影，由后墙中区 `MissionWallTaskPanel` 独占任务概要承接位（对应 AC3）。

**步骤**：

1. `Scene3D.tsx`：
   - 在 `Scene3DProps` 接口中加 `mode?: SceneFusionMode`，默认值 `"mission-first"`；
   - 把 `mode` 透传给 `<MissionIsland mode={mode} projectId={projectId} />`、`<PetWorkers mode={mode} />`、`<SceneStageFlow mode={mode} ... />`（第 259-262 行附近）；
   - 不影响 `SandboxMonitor` / `WaitingDecisionBubble`。
2. `MissionIsland.tsx`：
   - 在 props 接口中加 `mode?: SceneFusionMode`，默认 `"mission-first"`；
   - 在所有 hook 调用之后、JSX return 之前加 `if (mode === "blueprint") return null;`；
   - mission-first 默认行为完全不变。
3. `AutopilotRoutePage.tsx` 第 819 行：把 `<Scene3D performanceProfile="balanced" projectId={currentProjectId} />` 改为 `<Scene3D performanceProfile="balanced" projectId={currentProjectId} mode="blueprint" />`。
4. `Scene3DFallback.tsx`：透传 `mode` prop（保持兼容；默认 `"mission-first"`）。
5. 测试：
   - 新增 / 扩展 `MissionIsland.test.tsx`：mode === "blueprint" 时 SSR 结果中不出现 MissionIsland 相关 DOM；mode === "mission-first" 时正常渲染（既有 case 不变）；
   - 扩展 `Scene3D.test.tsx`：mode prop SSR 透传到子组件（spy / 浅 mock 子组件即可断言 mode prop 是否被传入）。
6. commit：`feat(autopilot-scene-fusion): wave A scene3d mode prop and missionisland blueprint hide`。

### Wave B：PetWorkers FSD roleId 映射桥

**目标**：蓝图页 PetWorkers 跟随 FSD 角色阶段事件动起来（对应 AC1 / AC2 / AC6 / AC9 / AC10）。

**步骤**：

1. 新建 `client/src/components/three/scene-fusion/role-id-bridge.ts`：
   - 导出 `FsdRoleId` / `MissionAgentId` 类型；
   - 定义模块私有 `FSD_TO_MISSION` 映射表（按 AC6）；
   - 导出 `readBlueprintRolePhase(rolePhases, missionAgentId)` 纯函数；
   - 中文 JSDoc，零 hook、零副作用。
2. 新建 `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`：
   - 7 个 FSD roleId 各自映射 case；
   - 未知 FSD roleId fallback 到 mission agent id 直读；
   - 直读 mission agent id（rolePhases 只含 mission agent id）；
   - 空 rolePhases 返回 undefined；
   - 同时含 FSD roleId 与 mission agent id 时 FSD 优先。
3. `PetWorkers.tsx`：
   - 在 props 接口中加 `mode?: SceneFusionMode`，默认 `"mission-first"`；
   - AgentWorker 单卡 selector（第 720 行）替换为蓝图 / mission-first 双分支：

     ```tsx
     const rolePhase = useBlueprintRealtimeStore(state =>
       mode === "blueprint"
         ? readBlueprintRolePhase(state.rolePhases, config.id)
         : (state.rolePhases[config.id] as RolePhase | undefined)
     );
     ```

   - 不修改 7 pet 视觉布局、坐标、姓名牌（AC10）；
   - `Scene3D` 已透传 `mode`，本步骤只在 `PetWorkers` 内部消费。
4. 测试：
   - 扩展 `PetWorkers.test.tsx`：
     - mode === "blueprint" + mock store 提供 FSD roleId rolePhases，断言 AgentWorker 拿到映射后的 phase；
     - mode === "mission-first" 直读 mission agent id（行为不变）。
5. commit：`feat(autopilot-scene-fusion): wave B petworkers fsd role id bridge`。

### Wave C：SceneStageFlow 接蓝图阶段信号

**目标**：蓝图页 SceneStageFlow 跟随蓝图 9 阶段推进，沿场景流线节点逐段点亮（对应 AC4 / AC5 / AC7）。

**步骤**：

1. 新建 `client/src/components/three/scene-fusion/blueprint-stage-signal.ts`：
   - 导出 `BlueprintSceneStageSignal` 接口；
   - 导出 `BLUEPRINT_SCENE_STAGES` 阶段顺序常量（9 个）；
   - 导出 `getBlueprintSceneStageSignal(job)` 纯函数；
   - 中文 JSDoc，零 hook、零副作用。
2. 新建 `client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`：
   - `null` / `undefined` 入参 → SAFE_DEFAULT_SIGNAL；
   - currentStage / stage 都缺失 → SAFE_DEFAULT_SIGNAL；
   - 未知 stage → SAFE_DEFAULT_SIGNAL（不抛错）；
   - 9 阶段每个 case 验证 stageIndex / progress / stageKey / totalStages；
   - 边界：第 0 阶段 progress = 0；第 8 阶段 progress = 1。
3. `SceneStageFlow.tsx`：
   - 在 props 接口中加 `mode?: SceneFusionMode`，默认 `"mission-first"`；
   - 加 `blueprintJob?: BlueprintGenerationJob | null`，默认 `null`；
   - 内部 if 分流：
     - `mode === "blueprint"` → 用 `getBlueprintSceneStageSignal(blueprintJob)` 派生 signal，调用既有 `@/lib/scene-stage-flow` helpers 时传入 blueprint 阶段表（`BLUEPRINT_SCENE_STAGES`）；
     - `mode === "mission-first"` → 走原有 mission 信号路径（既有 helpers 不变）；
   - 不破坏既有 mission-first 信号路径（AC7：空态稳定）。
4. `AutopilotRoutePage.tsx` 第 819 行：把 `<Scene3D ... mode="blueprint" />` 增加 `blueprintJob={latestJob}` 传入（`latestJob` 从 BlueprintRealtimeStore 取，或从 page-level state 中已有）。
5. 测试：
   - 扩展 `SceneStageFlow.test.tsx`：
     - mode === "blueprint" + blueprintJob 提供不同 stage，断言流线节点状态对应阶段索引；
     - mode === "mission-first" 走既有 mission 信号（既有 case 不变）；
     - mode === "blueprint" + blueprintJob === null → 流线指向第 0 阶段（AC7）。
6. commit：`feat(autopilot-scene-fusion): wave C scenestageflow blueprint stage signal`。

### Wave D：spec 收尾

**目标**：跑全量验证 + 创建 tasks.md，确保不退化。

**步骤**：

1. 创建 `tasks.md`：把 Wave A / B / C 的所有步骤拆成可勾选 task，全部勾选完成；
2. 跑 `node --run check`：确认 TS 错误数仍为 116（不扩大基线，对应工程约束 3）；
3. 跑前端测试：
   - `vitest run client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`
   - `vitest run client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
   - `vitest run client/src/components/__tests__/Scene3D.test.tsx`
   - `vitest run client/src/components/three/__tests__/MissionIsland.test.tsx`
   - `vitest run client/src/components/three/__tests__/PetWorkers.test.tsx`
   - `vitest run client/src/components/three/__tests__/SceneStageFlow.test.tsx`
   - 确保 mission-first 路径既有 case 全部通过（不退化既有 5140+ 测试，对应工程约束 4）；
4. 跑后端测试（应无变化，本 spec 不应有 server 改动）；
5. commit docs：`docs(autopilot-scene-fusion): wave D close out`。

## 测试策略

测试分为纯函数与 SSR 组件两层，互补覆盖映射桥 / 阶段信号 / mode 透传 / 双分支正确性。

### 纯函数测试（直接 import）

| 测试文件 | 期望 case 数 | 覆盖点 |
| -------- | ------------ | ------ |
| `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts` | ~10 | 7 个 FSD roleId 映射 / fallback 到 mission agent id 直读 / 空 rolePhases / FSD 优先 |
| `client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts` | ~12 | null / undefined / 缺失字段 / 未知 stage / 9 阶段映射 / 进度比例 |

### SSR 组件测试（`react-dom/server` + `vi.mock`）

| 测试文件 | 新增 case | 覆盖点 |
| -------- | --------- | ------ |
| `client/src/components/__tests__/Scene3D.test.tsx` | 1 | mode prop SSR 透传到子组件 |
| `client/src/components/three/__tests__/MissionIsland.test.tsx` | 1 | mode === "blueprint" 时返回 null（DOM 中不出现 MissionIsland 内容） |
| `client/src/components/three/__tests__/PetWorkers.test.tsx` | 2 | mode === "blueprint" 通过 mock store + FSD roleId rolePhases 验证读到映射后的 phase；mode === "mission-first" 直读 mission agent id |
| `client/src/components/three/__tests__/SceneStageFlow.test.tsx` | 3 | mode === "blueprint" + blueprintJob 不同 stage 验证流线节点状态；mode === "mission-first" 走既有 mission 信号；blueprintJob === null 时流线指向第 0 阶段（AC7） |

### 不在测试范围内

- 不引入 `@testing-library/react` / `jsdom` / `happy-dom`（违反工程约束 5）；
- 不写 PBT 测试（违反工程约束 2）；
- 不改既有 `derive-mirofish-stream-entries.test.ts`（独立 spec 已收口）；
- 不写 e2e（不在本 spec 范围）。

## 受影响文件清单

### 新增文件（4 个）

```
client/src/components/three/scene-fusion/role-id-bridge.ts
client/src/components/three/scene-fusion/blueprint-stage-signal.ts
client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts
client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts
```

### 修改文件（5 个）

```
client/src/components/Scene3D.tsx                 (加 mode prop + 透传)
client/src/components/three/PetWorkers.tsx        (加 mode prop + selector 替换)
client/src/components/three/MissionIsland.tsx     (加 mode prop + 蓝图返回 null)
client/src/components/three/SceneStageFlow.tsx    (加 mode + blueprintJob props + signal 分流)
client/src/components/stream/Scene3DFallback.tsx  (透传 mode)
```

### 修改调用方（2 个）

```
client/src/pages/autopilot/AutopilotRoutePage.tsx (传 mode="blueprint" + blueprintJob)
client/src/pages/Home.tsx                         (无变化，mode 默认 "mission-first")
```

## 受保护边界

以下文件在本 spec 严格只读，不做任何改动：

- `agent-reasoning-bridge.ts`
- `callback-receiver.ts`
- `lite-agent-runtime.ts`
- `llm-call.ts`
- `useAutopilotSandboxBridge.ts`（已成立，SandboxMonitor 联动锁）
- `MissionWallTaskPanel.tsx`（已成立，紧凑 HUD 与 2026-04-21 遮挡修复）
- `MiroFishCardStream.tsx`（独立 spec 已完成，右栏挂载点）

任何对上述文件的改动都属于范围外动作，需要单独立 spec / 单独评审，不在本 spec 内做。

## 风险缓解映射表

| requirements 风险 | 设计决策 / 实现细节 | 落地位置 |
| ----------------- | ------------------- | -------- |
| 风险 1：FSD → mission 映射不完美 | 决策 2：近似映射 + 单点函数 + 后续单点替换 | `role-id-bridge.ts` 中 `FSD_TO_MISSION` |
| 风险 2：SceneStageFlow 耦合 mission | 决策 4：信号源 prop 注入 + mode 分流 | `SceneStageFlow.tsx` 内部 if 分流 |
| 风险 3：mode 判别 | 决策 1：page-level prop drill | `Scene3D.tsx` 加 `mode` prop，由 page 决定 |
| 风险 4：9 阶段节点过多 | 决策 3：artifact_memory 复用 engineering_handoff 末尾 | `BLUEPRINT_SCENE_STAGES` 9 个节点常量 |
| 风险 5：rolePhases 空态 | 决策 2 / 决策 3：纯函数容空 | `readBlueprintRolePhase` / `getBlueprintSceneStageSignal` 容错分支 |
| 风险 6：测试退化 | 决策 6：纯函数 + SSR 两层，mission-first 默认行为不变 | 各 `__tests__` 目录 |

## 不变项

本 spec 严格保持以下不变项：

- **mission-first 路径行为**：`/tasks` / `TasksPage` / `TaskDetailView` / `MissionRuntime` 与 3D 组件的联动行为完全不变；mode 默认值 `"mission-first"`，未传 mode 的调用方走原路径；
- **SandboxMonitor 联动**：`useAutopilotSandboxBridge` 与 `SandboxMonitor` 视为既成事实，本 spec 不改；
- **MissionWallTaskPanel 紧凑 HUD**：后墙中区 HUD 收口与 2026-04-21 遮挡修复保持现状；
- **MiroFishCardStream 流式卡片**：右栏挂载点由独立 spec mirofish-stream Wave 1 已收口；
- **受保护后端文件**：`agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` 严格只读；
- **TypeScript 基线 116**：不扩大基线错误数，新增改动保持类型边界稳定；
- **既有 5140+ 测试**：mission-first 路径既有 case 全部继续通过；
- **不引入新测试依赖**：沿用 `react-dom/server` SSR + `vi.mock`，不引入 `@testing-library/react` / `jsdom` / `happy-dom`；
- **不引入 PBT**：纯函数测试只用 example-based；
- **不修改后端契约 / socket 协议**：本 spec 改动严格限定在前端 client 侧；
- **不引入 React context**：mode 通过 page-level prop drill 透传，不新增跨组件状态层；
- **中央底部 UnifiedLaunchComposer 唯一发起入口**：本 spec 不引入第二个发起器；
- **中文 JSDoc / 注释 / commit message**：promptId / prompt 字面量保持英文以匹配后端契约。
