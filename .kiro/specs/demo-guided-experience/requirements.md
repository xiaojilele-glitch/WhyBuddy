# 需求文档：Demo Guided Experience（演示引导体验）

## 简介

为 WhyBuddy 多智能体可视化教学平台构建演示回放引擎与引导体验层。该模块负责将预录演示数据（来自 demo-data-engine 的 DemoDataBundle）通过现有 UI 组件（WorkflowPanel、Scene3D、ChatPanel）进行回放，提供零配置的"Live Demo"入口，并通过 Mission Store（tasks-store）原生接口驱动 3D 场景动画、对话气泡、消息流转、阶段指示器以及记忆系统和进化引擎的可视化展示。

本文档覆盖五大需求模块：
- **演示回放引擎** — 按时间线调度预录事件，驱动前端状态更新
- **Mission Store 集成** — 通过原生数据路径写入演示数据
- **无 API Key 依赖** — 首次访问即可体验完整演示
- **3D 场景联动** — 宠物角色动画与工作流进度同步
- **记忆系统与进化展示** — 三级记忆和能力评分可视化

## 术语表

- **Demo_Playback_Engine**：演示回放引擎，负责按时间线调度预录数据中的 DemoTimedEvent，驱动前端状态更新
- **Demo_Data_Bundle**：预录演示数据包（来自 demo-data-engine），包含完整 mission 执行的所有快照数据
- **DemoTimedEvent**：带时间戳偏移量的事件包装，包含 timestampOffset 和 AgentEvent
- **Mission_Store**：前端 Zustand 状态管理层（tasks-store.ts），Mission 的原生数据源
- **Workflow_Store**：工作流状态管理层（workflow-store.ts），管理 UI 状态和事件处理
- **Scene3D**：3D 办公场景主组件，使用 React Three Fiber 渲染宠物角色和办公环境
- **WorkflowPanel**：工作流进度面板组件，展示阶段进度、任务列表、记忆和进化信息
- **Organization_Snapshot**：动态组织快照（WorkflowOrganizationSnapshot），描述 CEO → Manager → Worker 的层级结构
- **RuntimeEventBus**：本地事件总线（local-event-bus.ts），用于在浏览器运行时模式下分发 RuntimeEvent
- **MissionRecord**：Mission 记录类型，包含 id、kind、title、status 等字段

---

## 需求

### 需求 3：演示回放引擎

**用户故事：** 作为用户，我希望打开演示页面后自动开始回放预录数据，以便在 30 秒内看到完整的工作流执行过程。

#### 验收标准

3.1. WHEN 用户进入 Demo 模式, THE Demo_Playback_Engine SHALL 在 2 秒内开始回放预录数据

3.2. THE Demo_Playback_Engine SHALL 按照 DemoTimedEvent 的 timestampOffset 顺序发射事件，驱动前端状态更新

3.3. THE Demo_Playback_Engine SHALL 在 30 秒内完成从 direction 到 evolution 全部十阶段的回放

3.4. WHEN 回放进行中, THE Demo_Playback_Engine SHALL 通过 Mission_Store 的原生接口更新数据，使 WorkflowPanel 和 Scene3D 自动响应

3.5. THE Demo_Playback_Engine SHALL 支持暂停和恢复回放操作

3.6. WHEN 回放完成, THE Demo_Playback_Engine SHALL 将工作流状态设置为 completed，并保持最终状态可查看

3.7. IF 回放过程中发生异常, THEN THE Demo_Playback_Engine SHALL 记录错误日志并将工作流状态设置为 failed，同时在 UI 上显示错误提示


### 需求 4：Mission Store 集成

**用户故事：** 作为开发者，我希望演示数据通过 Mission 原生数据源（tasks-store）流转，以便消除 workflow 投影层的额外依赖。

#### 验收标准

4.1. THE Demo_Playback_Engine SHALL 通过 Mission_Store 的标准接口写入演示数据，使用与真实 mission 相同的数据路径

4.2. WHEN 演示数据写入 Mission_Store, THE Mission_Store SHALL 触发与真实 mission 相同的 UI 更新（WorkflowPanel 进度条、阶段标签、任务列表）

4.3. THE Demo_Playback_Engine SHALL 创建一条 MissionRecord，其 kind 字段标记为 "demo"，以区分演示数据和真实 mission 数据

4.4. WHEN 演示模式激活, THE Mission_Store SHALL 将演示 mission 设置为当前选中任务，使 UI 自动聚焦到演示内容

4.5. WHEN 演示模式退出, THE Demo_Playback_Engine SHALL 清理所有演示数据，恢复 Mission_Store 到演示前的状态

### 需求 5：无 API Key 依赖

**用户故事：** 作为首次访问的用户，我希望无需配置任何 API Key 就能体验完整的演示流程。

#### 验收标准

5.1. WHEN 用户处于 Frontend Mode 且未配置 API Key, THE Demo_Playback_Engine SHALL 使用预录数据驱动演示，完全绕过 LLM 调用

5.2. THE Demo_Playback_Engine SHALL 在回放过程中不发起任何网络请求到 LLM 服务端点

5.3. WHEN 用户首次打开页面, THE 系统 SHALL 在首页提供明显的"Live Demo"入口按钮，引导用户进入演示模式

5.4. THE Demo_Playback_Engine SHALL 在浏览器离线状态下正常运行演示回放

### 需求 6：3D 场景联动

**用户故事：** 作为用户，我希望在演示过程中看到 3D 场景中的宠物角色随工作流进度联动，以便直观理解多智能体协作过程。

#### 验收标准

6.1. WHEN Demo_Playback_Engine 发射 agent_active 事件, THE Scene3D SHALL 更新对应宠物角色的动画状态（idle → analyzing/planning/executing/reviewing/revising）

6.2. WHEN Demo_Playback_Engine 发射 message_sent 事件, THE Scene3D SHALL 在发送方角色上方显示对话气泡，展示消息预览内容

6.3. WHEN Demo_Playback_Engine 发射 stage_change 事件, THE Scene3D SHALL 更新场景中的阶段指示器，反映当前工作流阶段

6.4. WHEN Demo_Playback_Engine 发射 score_assigned 事件, THE Scene3D SHALL 在对应 Worker 角色上方显示评分动画

6.5. THE Scene3D SHALL 在演示开始时根据 Organization_Snapshot 动态生成角色布局，反映 CEO → Manager → Worker 的层级关系

### 需求 7：记忆系统与进化展示

**用户故事：** 作为用户，我希望在演示过程中看到三级记忆系统和进化引擎的运作过程，以便理解智能体的记忆和成长机制。

#### 验收标准

7.1. WHEN Demo_Playback_Engine 回放到 execution 阶段, THE WorkflowPanel SHALL 展示短期记忆写入过程（LLM 交互日志的追加）

7.2. WHEN Demo_Playback_Engine 回放到 summary 阶段, THE WorkflowPanel SHALL 展示中期记忆的生成（工作流摘要的物化）

7.3. WHEN Demo_Playback_Engine 回放到 evolution 阶段, THE WorkflowPanel SHALL 展示长期记忆的更新（SOUL.md 补丁的应用和学习行为的追加）

7.4. THE WorkflowPanel SHALL 在记忆面板中以时间线形式展示记忆写入事件，每条记忆标注类型（短期/中期/长期）和关联的 Agent

7.5. WHEN Demo_Playback_Engine 回放到 evolution 阶段, THE WorkflowPanel SHALL 展示每个 Agent 的能力评分变化（old_score → new_score），包含 accuracy、completeness、actionability、format 四个维度

7.6. THE WorkflowPanel SHALL 以动画形式展示评分变化过程（数值从旧值平滑过渡到新值）
