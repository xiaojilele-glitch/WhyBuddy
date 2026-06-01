# 需求文档

## 简介

本特性将 WhyBuddy 的任务驾驶舱（Task Cockpit）数据架构从"Mission + Workflow 投影层"双源模式迁移为 Mission 原生单源模式。迁移后，tasks-store 将完全从 MissionRecord 及 /api/planets 端点获取数据，消除对 WorkflowRecord 的依赖，简化数据流并降低维护成本。

## 术语表

- **MissionRecord**: 任务的核心数据记录，包含 status、progress、stages、events、artifacts 等字段
- **WorkflowRecord**: 工作流引擎的详细记录，包含 tasks、messages、organization、report 等字段
- **tasks-store**: 前端 Zustand 状态管理模块（client/src/lib/tasks-store.ts），负责合成 UI 所需的任务摘要和详情
- **MissionTaskSummary**: 任务列表视图的摘要数据结构
- **MissionTaskDetail**: 任务详情视图的完整数据结构
- **MissionPlanetOverviewItem**: /api/planets 返回的星球概览数据结构
- **MissionPlanetInteriorData**: /api/planets/:id/interior 返回的星球内部数据结构
- **MissionOrchestrator**: 服务端任务编排器，协调 Mission 执行流程
- **MissionStore**: 服务端 Mission 状态机，管理 MissionRecord 的生命周期
- **mission-client**: 前端 REST API 封装模块（client/src/lib/mission-client.ts）

## 需求

### 需求 1: Mission 原生数据源统一

**用户故事:** 作为开发者，我希望 tasks-store 完全使用 Mission 原生数据源，以便移除 Workflow 投影层并简化数据架构。

#### 验收标准

1. THE tasks-store SHALL derive MissionTaskSummary exclusively from MissionRecord fields (status, progress, stages, events, summary, waitingFor, artifacts), without reading from WorkflowRecord
2. THE tasks-store SHALL derive MissionTaskDetail exclusively from MissionRecord and its associated events/artifacts, without reading from WorkflowRecord's tasks, messages, or report fields
3. WHEN a new mission is created, THE tasks-store SHALL obtain all necessary data through /api/tasks endpoints, without calling /api/workflows endpoints
4. THE tasks-store SHALL maintain backward compatibility with existing UI components (TasksPage, TaskDetailPage, TaskPlanetInterior, CreateMissionDialog), requiring no UI component changes for data source migration
5. FOR ALL MissionTaskSummary fields that previously derived from WorkflowRecord (departmentLabels, taskCount, completedTaskCount, messageCount, activeAgentCount), THE tasks-store SHALL provide equivalent values derived from MissionRecord's stages, events, and embedded organization data

### 需求 2: /api/planets 路由实现

**用户故事:** 作为开发者，我希望实现 /api/planets 路由，以便任务驾驶舱 UI 可以通过 Mission 原生端点获取数据，不再依赖 Workflow 投影。

#### 验收标准

1. THE server SHALL implement GET /api/planets route that returns a ListMissionPlanetsResponse containing MissionPlanetOverviewItem array and MissionPlanetEdge array, derived from MissionRecord data
2. THE server SHALL implement GET /api/planets/:id route that returns a GetMissionPlanetResponse containing a single MissionPlanetOverviewItem with full detail
3. THE server SHALL implement GET /api/planets/:id/interior route that returns a GetMissionPlanetInteriorResponse containing MissionPlanetInteriorData (stages, agents, events, summary, waitingFor)
4. THE /api/planets routes SHALL derive all data from MissionStore (server/tasks/mission-store.ts), without reading from workflow database tables
5. THE /api/planets/:id/interior route SHALL return MissionPlanetInteriorStage array where each stage has valid arcStart, arcEnd, midAngle values that partition the 360-degree ring visualization evenly among stages
6. THE /api/planets/:id/interior route SHALL return MissionPlanetInteriorAgent array where each agent has a valid status, stageKey, and angle value for interior visualization positioning

### 需求 3: MissionRecord 数据丰富化

**用户故事:** 作为开发者，我希望 MissionRecord 包含任务驾驶舱 UI 所需的全部数据，以便不再需要补充数据源。

#### 验收标准

1. THE MissionRecord SHALL include an optional organization field containing the WorkflowOrganizationSnapshot when available
2. THE MissionRecord SHALL include an optional workPackages field containing task-level detail (worker assignments, deliverables, scores, feedback) when available
3. THE MissionRecord SHALL include an optional messageLog field containing recent message summaries when available
4. WHEN the workflow engine completes a stage, THE MissionOrchestrator SHALL update the corresponding MissionRecord with the latest organization, workPackages, and messageLog data
5. THE MissionRecord's stages array SHALL be updated in real-time as the workflow progresses through each stage, with status transitions (pending → running → done/failed)

### 需求 4: 前端 Mission Client 迁移

**用户故事:** 作为开发者，我希望前端 mission-client 使用新的 /api/planets 端点，以便任务驾驶舱 UI 从 Mission 原生数据源获取数据。

#### 验收标准

1. THE mission-client.ts SHALL add listPlanets(), getPlanet(id), and getPlanetInterior(id) functions that call the corresponding /api/planets endpoints
2. THE tasks-store SHALL use listPlanets() instead of listMissions() combined with workflow detail fetching for populating the task list
3. THE tasks-store SHALL use getPlanetInterior(id) instead of synthesizing interior data from workflow records for the TaskPlanetInterior component
4. WHEN the /api/planets endpoints are unavailable, THE tasks-store SHALL gracefully fall back to the existing workflow projection logic and log a warning
5. THE tasks-store refresh cycle SHALL reduce from the current multi-request pattern (list missions plus fetch each workflow detail) to a single listPlanets() call for the task list view
