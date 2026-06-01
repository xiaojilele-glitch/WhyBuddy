# 设计文档：Project Domain Model

## 设计概述

Project Domain 是 Project-first 改造的底座。第一阶段目标不是引入复杂后端，而是建立稳定的前端领域模型和 `projectId` 贯穿规则，让现有任务、输入、澄清和证据逐步归档到项目。

## 数据模型草案

```ts
type ProjectStatus =
  | "draft"
  | "clarifying"
  | "spec_ready"
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "archived";

interface Project {
  id: string;
  name: string;
  goal: string;
  status: ProjectStatus;
  summary?: string;
  currentSpecId?: string;
  currentRouteId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

interface ProjectMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant" | "system" | "operator";
  kind: "chat" | "clarification" | "decision" | "status" | "spec-note";
  content: string;
  sourceMissionId?: string;
  createdAt: string;
}

interface ProjectSpec {
  id: string;
  projectId: string;
  version: number;
  title: string;
  content: string;
  status: "draft" | "reviewing" | "accepted" | "superseded";
  sourceMessageIds: string[];
  sourceEvidenceIds: string[];
  completeness?: number;
  createdAt: string;
}

interface ProjectRoute {
  id: string;
  projectId: string;
  specId?: string;
  kind: "recommended" | "fast" | "deep" | "conservative" | "custom";
  title: string;
  summary: string;
  steps: ProjectRouteStep[];
  riskLevel: "low" | "medium" | "high";
  estimate?: string;
  selectedAt?: string;
  createdAt: string;
}

interface ProjectMission {
  id: string;
  projectId: string;
  missionId: string;
  routeId?: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

interface ProjectArtifact {
  id: string;
  projectId: string;
  type: "spec" | "doc" | "svg" | "code" | "report" | "prototype" | "screenshot" | "other";
  title: string;
  path?: string;
  contentPreview?: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  createdAt: string;
}

interface ProjectEvidence {
  id: string;
  projectId: string;
  type: "log" | "decision" | "source" | "replay" | "runtime" | "artifact-link";
  title: string;
  detail: string;
  sourceMissionId?: string;
  createdAt: string;
}
```

## Store 设计

第一阶段建议新增 `project-store`，职责包括：

- `ensureReady()`
- `createProject(input)`
- `selectProject(projectId)`
- `updateProject(projectId, patch)`
- `addProjectMessage(message)`
- `addProjectSpec(spec)`
- `addProjectRoute(route)`
- `linkMission(projectId, missionId, routeId?)`
- `addProjectArtifact(artifact)`
- `addProjectEvidence(evidence)`
- `getCurrentProject()`
- `getProjectBundle(projectId)`

## 持久化策略

第一阶段使用 localStorage：

```text
whybuddy.project-store.v1
```

持久化内容包括：

- schema version
- currentProjectId
- projects
- messages
- specs
- routes
- missions
- artifacts
- evidence

## 与现有 store 的关系

- `tasks-store` 保持 mission / task 的工程状态来源。
- `project-store` 保存任务与项目的关联投影。
- `workflow-store` 保持 workflow runtime 状态。
- `nl-command-store` 提供输入和解析历史，但项目上下文应回写 `ProjectMessage`。

## 兼容策略

历史任务没有 `projectId` 时：

- 任务中心仍展示。
- 可显示为“未归档任务”。
- 用户可手动归入当前项目。
- 自动新建的任务必须尽量带上 `projectId`。

## 非目标

- 第一阶段不要求 server schema 完整迁移。
- 第一阶段不要求多用户权限。
- 第一阶段不要求项目成员协作。
- 第一阶段不要求项目附件完整文件系统化。

