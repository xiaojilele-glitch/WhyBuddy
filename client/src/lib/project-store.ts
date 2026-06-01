import { nanoid } from "nanoid";
import { create } from "zustand";

import {
  buildMissionPlanFromRoute,
  buildProjectRoutePlan,
} from "./project-route-planner";
import { buildInitialProjectSpecDraft } from "./project-spec-draft";
import { IS_GITHUB_PAGES } from "./deploy-target";
import {
  GITHUB_PAGES_DEMO_MISSION_IDS,
  GITHUB_PAGES_DEMO_PROJECT_IDS,
} from "./github-pages-demo-data";

export const PROJECT_STORE_SCHEMA_VERSION = 1;
export const PROJECT_STORE_STORAGE_KEY = "whybuddy.project-store.v1";
// Legacy/demo boundary: this localStorage snapshot is only a browser-side
// transition cache for Project-first UX. Real project ownership and permission
// checks must come from the authenticated server session plus MySQL projects.

export type ProjectStatus =
  | "draft"
  | "clarifying"
  | "spec_ready"
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "archived";

export interface Project {
  id: string;
  ownerUserId?: string;
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

export type ProjectMessageRole = "user" | "assistant" | "system" | "operator";
export type ProjectMessageKind =
  | "chat"
  | "clarification"
  | "decision"
  | "status"
  | "spec-note";

export interface ProjectMessage {
  id: string;
  projectId: string;
  role: ProjectMessageRole;
  kind: ProjectMessageKind;
  content: string;
  sourceMissionId?: string;
  createdAt: string;
}

export type ProjectClarificationScope =
  | "goal"
  | "user"
  | "domain"
  | "tech"
  | "delivery"
  | "risk"
  | "runtime";

export type ProjectClarificationAnswerType =
  | "text"
  | "single"
  | "multi"
  | "boolean";

export interface ProjectClarificationQuestion {
  id: string;
  projectId: string;
  text: string;
  reason: string;
  scope: ProjectClarificationScope;
  answerType: ProjectClarificationAnswerType;
  options?: string[];
  required: boolean;
  defaultAssumption?: string;
  sourceCommandId?: string;
  sourceQuestionId?: string;
  sourceMessageId?: string;
  answeredAt?: string;
  answer?: string;
  skippedAt?: string;
  createdAt: string;
}

export type ProjectSpecStatus =
  | "draft"
  | "reviewing"
  | "accepted"
  | "superseded";

export type ProjectSpecCompletenessBand =
  | "empty"
  | "partial"
  | "usable"
  | "complete";

export interface ProjectSpecCompleteness {
  score: number;
  band: ProjectSpecCompletenessBand;
  missingFields: string[];
  sourceCoverage: {
    messages: number;
    evidence: number;
    artifacts: number;
  };
}

export interface ProjectSpec {
  id: string;
  projectId: string;
  version: number;
  title: string;
  content: string;
  status: ProjectSpecStatus;
  sourceMessageIds: string[];
  sourceEvidenceIds: string[];
  sourceArtifactIds: string[];
  completeness?: number;
  completenessDetail?: ProjectSpecCompleteness;
  supersedesSpecId?: string;
  supersededBySpecId?: string;
  acceptedAt?: string;
  confirmedBy?: "user" | "system";
  confirmationNote?: string;
  confirmationEvidenceId?: string;
  supersededAt?: string;
  diffSummary?: string;
  createdAt: string;
}

export type ProjectRouteKind =
  | "recommended"
  | "fast"
  | "deep"
  | "conservative"
  | "custom";

export type ProjectRouteRiskLevel = "low" | "medium" | "high";

export interface ProjectRouteStep {
  id: string;
  title: string;
  description?: string;
  role?: string;
  status?: "pending" | "running" | "done" | "blocked";
}

export interface ProjectRoute {
  id: string;
  projectId: string;
  specId?: string;
  kind: ProjectRouteKind;
  title: string;
  summary: string;
  steps: ProjectRouteStep[];
  riskLevel: ProjectRouteRiskLevel;
  estimate?: string;
  selectedAt?: string;
  createdAt: string;
}

export type ProjectMissionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProjectMission {
  id: string;
  projectId: string;
  missionId: string;
  specId?: string;
  routeId?: string;
  status: ProjectMissionStatus;
  createdAt: string;
  updatedAt: string;
}

export type ProjectArtifactType =
  | "spec"
  | "doc"
  | "svg"
  | "code"
  | "report"
  | "prototype"
  | "screenshot"
  | "dataset"
  | "diff"
  | "other";

export interface ProjectArtifact {
  id: string;
  projectId: string;
  type: ProjectArtifactType;
  title: string;
  path?: string;
  contentPreview?: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  createdAt: string;
}

export type ProjectEvidenceType =
  | "message"
  | "clarification"
  | "decision"
  | "route"
  | "runtime"
  | "log"
  | "source"
  | "artifact-link"
  | "failure"
  | "replay";

export interface ProjectEvidence {
  id: string;
  projectId: string;
  type: ProjectEvidenceType;
  title: string;
  detail: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  sourceRouteId?: string;
  createdAt: string;
}

export interface ProjectBundle {
  project: Project;
  messages: ProjectMessage[];
  clarificationQuestions: ProjectClarificationQuestion[];
  specs: ProjectSpec[];
  routes: ProjectRoute[];
  missions: ProjectMission[];
  artifacts: ProjectArtifact[];
  evidence: ProjectEvidence[];
}

interface ProjectStoreSnapshot {
  schemaVersion: number;
  currentProjectId: string | null;
  currentProjectIdsByOwner: Record<string, string | null>;
  projects: Project[];
  messages: ProjectMessage[];
  clarificationQuestions: ProjectClarificationQuestion[];
  specs: ProjectSpec[];
  routes: ProjectRoute[];
  missions: ProjectMission[];
  artifacts: ProjectArtifact[];
  evidence: ProjectEvidence[];
}

export interface CreateProjectInput {
  name?: string;
  goal: string;
  summary?: string;
  status?: ProjectStatus;
}

export interface AddProjectMessageInput {
  projectId?: string;
  role: ProjectMessageRole;
  kind?: ProjectMessageKind;
  content: string;
  sourceMissionId?: string;
  createEvidence?: boolean;
  evidenceTitle?: string;
}

export interface AddProjectClarificationQuestionInput {
  projectId?: string;
  text: string;
  reason?: string;
  scope?: ProjectClarificationScope;
  answerType?: ProjectClarificationAnswerType;
  options?: string[];
  required?: boolean;
  defaultAssumption?: string;
  sourceCommandId?: string;
  sourceQuestionId?: string;
  sourceMessageId?: string;
}

export interface AnswerProjectClarificationQuestionInput {
  projectId?: string;
  questionId: string;
  answer?: string;
  skipped?: boolean;
}

export interface AddProjectSpecInput {
  projectId?: string;
  title: string;
  content: string;
  status?: ProjectSpecStatus;
  sourceMessageIds?: string[];
  sourceEvidenceIds?: string[];
  sourceArtifactIds?: string[];
  completeness?: number;
  completenessDetail?: ProjectSpecCompleteness;
  supersedesSpecId?: string;
  diffSummary?: string;
  makeCurrent?: boolean;
}

export interface CreateInitialProjectSpecDraftInput {
  projectId?: string;
  title?: string;
  makeCurrent?: boolean;
}

export interface AcceptProjectSpecConfirmationInput {
  confirmedBy?: "user" | "system";
  note?: string;
  sourceMessageIds?: string[];
  sourceEvidenceIds?: string[];
  createEvidence?: boolean;
}

export interface AddProjectRouteInput {
  projectId?: string;
  specId?: string;
  kind: ProjectRouteKind;
  title: string;
  summary: string;
  steps?: ProjectRouteStep[];
  riskLevel?: ProjectRouteRiskLevel;
  estimate?: string;
  selected?: boolean;
}

export interface GenerateProjectRoutePlanInput {
  projectId?: string;
  selectKind?: ProjectRouteKind;
}

export interface ReplanProjectRoutePlanInput
  extends GenerateProjectRoutePlanInput {
  reason?: string;
  action?: "failed" | "replanned";
  sourceMissionId?: string;
  sourceSpecId?: string;
  sourceRouteId?: string;
  createEvidence?: boolean;
}

export interface LinkProjectMissionInput {
  projectId?: string;
  missionId: string;
  specId?: string;
  routeId?: string;
  status?: ProjectMissionStatus;
  createEvidence?: boolean;
}

export interface CreateMissionPlanFromRouteInput {
  projectId?: string;
  routeId?: string;
  missionId?: string;
}

export interface AddProjectArtifactInput {
  projectId?: string;
  type: ProjectArtifactType;
  title: string;
  path?: string;
  contentPreview?: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
}

export interface AddProjectEvidenceInput {
  projectId?: string;
  type: ProjectEvidenceType;
  title: string;
  detail: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  sourceRouteId?: string;
}

export interface RecordProjectRouteEvidenceInput {
  action?: "selected" | "adjusted" | "replanned";
  note?: string;
  sourceMissionId?: string;
  createEvidence?: boolean;
}

export interface ProjectStoreState extends ProjectStoreSnapshot {
  activeOwnerUserId: string | null;
  ready: boolean;
  ensureReady: () => void;
  reset: () => void;
  setActiveOwner: (userId: string | null) => void;
  setActiveOwnerForTest: (userId: string | null) => void;
  createProject: (input: CreateProjectInput) => Project;
  selectProject: (projectId: string | null) => void;
  updateProject: (
    projectId: string,
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "goal"
        | "status"
        | "summary"
        | "currentSpecId"
        | "currentRouteId"
      >
    >
  ) => Project | null;
  archiveProject: (projectId: string) => Project | null;
  addProjectMessage: (input: AddProjectMessageInput) => ProjectMessage | null;
  addProjectClarificationQuestion: (
    input: AddProjectClarificationQuestionInput
  ) => ProjectClarificationQuestion | null;
  answerProjectClarificationQuestion: (
    input: AnswerProjectClarificationQuestionInput
  ) => ProjectClarificationQuestion | null;
  addProjectSpec: (input: AddProjectSpecInput) => ProjectSpec | null;
  createInitialProjectSpecDraft: (
    input?: CreateInitialProjectSpecDraftInput
  ) => ProjectSpec | null;
  acceptProjectSpec: (
    projectId: string,
    specId: string,
    confirmation?: AcceptProjectSpecConfirmationInput
  ) => ProjectSpec | null;
  supersedeProjectSpec: (
    projectId: string,
    specId: string,
    replacementSpecId?: string
  ) => ProjectSpec | null;
  addProjectRoute: (input: AddProjectRouteInput) => ProjectRoute | null;
  generateProjectRoutePlan: (
    input?: GenerateProjectRoutePlanInput
  ) => ProjectRoute[];
  replanProjectRoutePlan: (
    input?: ReplanProjectRoutePlanInput
  ) => ProjectRoute[];
  createMissionPlanFromRoute: (
    input?: CreateMissionPlanFromRouteInput
  ) => ProjectMission | null;
  selectProjectRoute: (
    projectId: string,
    routeId: string,
    evidence?: RecordProjectRouteEvidenceInput
  ) => ProjectRoute | null;
  linkMissionToProject: (
    input: LinkProjectMissionInput
  ) => ProjectMission | null;
  updateProjectMissionStatus: (
    missionId: string,
    status: ProjectMissionStatus
  ) => ProjectMission | null;
  addProjectArtifact: (
    input: AddProjectArtifactInput
  ) => ProjectArtifact | null;
  addProjectEvidence: (
    input: AddProjectEvidenceInput
  ) => ProjectEvidence | null;
  getVisibleProjects: () => Project[];
  getCurrentProject: () => Project | null;
  getProjectBundle: (projectId: string) => ProjectBundle | null;
  getProjectClarificationQuestions: (
    projectId: string
  ) => ProjectClarificationQuestion[];
  getProjectSpecs: (projectId: string) => ProjectSpec[];
  getCurrentProjectSpec: (projectId: string) => ProjectSpec | null;
  getMissionProjectLink: (missionId: string) => ProjectMission | null;
  getProjectIdForMission: (missionId: string) => string | null;
}

function projectMissionEvidenceTitle(
  status: ProjectMissionStatus,
  isCreated: boolean
) {
  if (isCreated) return "Mission created";
  switch (status) {
    case "completed":
      return "Mission completed";
    case "failed":
      return "Mission failed";
    case "cancelled":
      return "Mission cancelled";
    case "running":
      return "Mission running";
    case "waiting":
      return "Mission waiting";
    default:
      return "Mission status updated";
  }
}

function projectMissionEvidenceType(
  status: ProjectMissionStatus
): ProjectEvidenceType {
  if (status === "failed") return "failure";
  if (status === "completed" || status === "cancelled") return "runtime";
  return "runtime";
}

function emptySnapshot(): ProjectStoreSnapshot {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    currentProjectId: null,
    currentProjectIdsByOwner: {},
    projects: [],
    messages: [],
    clarificationQuestions: [],
    specs: [],
    routes: [],
    missions: [],
    artifacts: [],
    evidence: [],
  };
}

function nowIso() {
  return new Date().toISOString();
}

function createGitHubPagesDemoSnapshot(): ProjectStoreSnapshot {
  const createdAt = "2026-05-04T01:00:00.000Z";
  const updatedAt = "2026-05-04T03:30:00.000Z";
  const mainProjectId = GITHUB_PAGES_DEMO_PROJECT_IDS.aigcComic;
  const authProjectId = GITHUB_PAGES_DEMO_PROJECT_IDS.authAdmin;
  const dataProjectId = GITHUB_PAGES_DEMO_PROJECT_IDS.dataOps;
  const mainSpecId = "demo-spec-aigc-comic-v1";
  const authSpecId = "demo-spec-auth-admin-v1";
  const dataSpecId = "demo-spec-data-ops-v1";
  const mainRouteId = "demo-route-aigc-comic-standard";
  const authRouteId = "demo-route-auth-admin-conservative";
  const dataRouteId = "demo-route-data-ops-fast";
  const mainMessageId = "demo-message-aigc-comic-goal";
  const authMessageId = "demo-message-auth-admin-goal";
  const dataMessageId = "demo-message-data-ops-goal";
  const mainEvidenceId = "demo-evidence-aigc-goal";
  const authEvidenceId = "demo-evidence-auth-goal";
  const dataEvidenceId = "demo-evidence-data-goal";
  const mainArtifactId = "demo-artifact-aigc-spec";
  const authArtifactId = "demo-artifact-auth-architecture";
  const dataArtifactId = "demo-artifact-data-dashboard";

  const specs: ProjectSpec[] = [
    {
      id: mainSpecId,
      projectId: mainProjectId,
      version: 1,
      title: "AI漫剧生成平台 MVP Spec",
      content:
        "# AI漫剧生成平台\n\n目标是把脚本理解、分镜规划、角色设定、素材生成、审核和交付串成一条可接管的自动驾驶链路。首版重点展示项目空间、自动驾驶驾驶舱、任务中心和产物归档。",
      status: "reviewing",
      sourceMessageIds: [mainMessageId],
      sourceEvidenceIds: [mainEvidenceId],
      sourceArtifactIds: [mainArtifactId],
      completeness: 0.82,
      completenessDetail: deriveProjectSpecCompleteness({
        title: "AI漫剧生成平台 MVP Spec",
        content:
          "脚本、分镜、角色设定、素材生成、审核、交付和接管流程均已形成首版范围。",
        sourceMessageIds: [mainMessageId],
        sourceEvidenceIds: [mainEvidenceId],
        sourceArtifactIds: [mainArtifactId],
      }),
      createdAt,
    },
    {
      id: authSpecId,
      projectId: authProjectId,
      version: 1,
      title: "权限管理系统 Spec",
      content:
        "# 权限管理系统\n\n围绕邮箱登录、验证码、RBAC、资源授权、审计日志和项目级数据隔离建立后台管理系统。",
      status: "draft",
      sourceMessageIds: [authMessageId],
      sourceEvidenceIds: [authEvidenceId],
      sourceArtifactIds: [authArtifactId],
      completeness: 0.68,
      completenessDetail: deriveProjectSpecCompleteness({
        title: "权限管理系统 Spec",
        content: "邮箱登录、验证码、RBAC、资源授权、审计日志和项目级数据隔离。",
        sourceMessageIds: [authMessageId],
        sourceEvidenceIds: [authEvidenceId],
        sourceArtifactIds: [authArtifactId],
      }),
      createdAt,
    },
    {
      id: dataSpecId,
      projectId: dataProjectId,
      version: 1,
      title: "数据运营驾驶舱 Spec",
      content:
        "# 数据运营驾驶舱\n\n汇总增长、留存、成本和异常告警，形成可筛选、可追踪、可导出的运营看板。",
      status: "accepted",
      sourceMessageIds: [dataMessageId],
      sourceEvidenceIds: [dataEvidenceId],
      sourceArtifactIds: [dataArtifactId],
      completeness: 0.95,
      completenessDetail: deriveProjectSpecCompleteness({
        title: "数据运营驾驶舱 Spec",
        content: "增长、留存、成本和异常告警的运营看板范围已确认。",
        sourceMessageIds: [dataMessageId],
        sourceEvidenceIds: [dataEvidenceId],
        sourceArtifactIds: [dataArtifactId],
      }),
      acceptedAt: "2026-05-04T02:40:00.000Z",
      confirmedBy: "user",
      createdAt,
    },
  ];

  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    currentProjectId: mainProjectId,
    currentProjectIdsByOwner: {
      [ownerSelectionKey(null)]: mainProjectId,
    },
    projects: [
      {
        id: mainProjectId,
        name: "AI漫剧生成平台",
        goal: "搭建从脚本、分镜、角色设定到短剧成片的自动驾驶生成平台。",
        status: "executing",
        summary:
          "展示项目空间、自动驾驶驾驶舱、任务中心和产物归档如何围绕同一个项目运转。",
        currentSpecId: mainSpecId,
        currentRouteId: mainRouteId,
        createdAt,
        updatedAt,
      },
      {
        id: authProjectId,
        name: "权限管理系统",
        goal: "实现邮箱验证码登录、项目级权限、资源授权和后台审计。",
        status: "clarifying",
        summary: "重点确认认证合同、角色模型、资源粒度、审计范围和部署约束。",
        currentSpecId: authSpecId,
        currentRouteId: authRouteId,
        createdAt: "2026-05-04T01:12:00.000Z",
        updatedAt: "2026-05-04T02:55:00.000Z",
      },
      {
        id: dataProjectId,
        name: "数据运营驾驶舱",
        goal: "把增长、留存、成本和异常告警集中到一个可追踪的运营看板。",
        status: "completed",
        summary: "已完成指标模型、筛选视图、导出路径和异常告警的首版演示闭环。",
        currentSpecId: dataSpecId,
        currentRouteId: dataRouteId,
        createdAt: "2026-05-04T01:24:00.000Z",
        updatedAt: "2026-05-04T03:10:00.000Z",
      },
    ],
    messages: [
      {
        id: mainMessageId,
        projectId: mainProjectId,
        role: "user",
        kind: "chat",
        content:
          "我要做一个 AI 漫剧生成平台，能从一句需求开始自动澄清、规划、生成素材并沉淀产物。",
        createdAt,
      },
      {
        id: "demo-message-aigc-next-step",
        projectId: mainProjectId,
        role: "assistant",
        kind: "status",
        content:
          "已形成演示路径：先确认目标和交付物，再生成 Spec，随后进入自动驾驶执行。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
        createdAt: "2026-05-04T01:30:00.000Z",
      },
      {
        id: authMessageId,
        projectId: authProjectId,
        role: "user",
        kind: "chat",
        content: "权限系统需要真实邮箱登录、验证码、RBAC 和审计日志。",
        createdAt: "2026-05-04T01:12:00.000Z",
      },
      {
        id: dataMessageId,
        projectId: dataProjectId,
        role: "user",
        kind: "chat",
        content: "运营团队需要一个可以直接看增长、留存、成本和异常的驾驶舱。",
        createdAt: "2026-05-04T01:24:00.000Z",
      },
    ],
    clarificationQuestions: [
      {
        id: "demo-question-aigc-output",
        projectId: mainProjectId,
        text: "首版交付物更偏向可演示原型，还是端到端真实生成链路？",
        reason: "交付物定位会影响自动驾驶任务的执行深度和验证方式。",
        scope: "delivery",
        answerType: "single",
        options: ["可演示原型", "真实生成链路", "两者都要"],
        required: true,
        defaultAssumption: "先以可演示原型为主，保留真实链路接入点。",
        sourceMessageId: mainMessageId,
        createdAt: "2026-05-04T01:08:00.000Z",
      },
      {
        id: "demo-question-auth-scope",
        projectId: authProjectId,
        text: "权限模型是否需要支持部门继承和跨项目授权？",
        reason: "这会决定 RBAC 是否需要扩展到策略模型。",
        scope: "domain",
        answerType: "multi",
        options: ["部门继承", "跨项目授权", "仅简单 RBAC"],
        required: true,
        defaultAssumption: "先支持简单 RBAC，预留策略扩展。",
        sourceMessageId: authMessageId,
        createdAt: "2026-05-04T01:18:00.000Z",
      },
    ],
    specs,
    routes: [
      {
        id: mainRouteId,
        projectId: mainProjectId,
        specId: mainSpecId,
        kind: "recommended",
        title: "演示优先自动驾驶路线",
        summary:
          "先跑通项目空间、自动驾驶页和任务中心，再补充真实生成链路接入。",
        steps: [
          {
            id: "demo-route-aigc-step-1",
            title: "澄清目标与交付物",
            description: "确认首版演示边界、输入输出和需要用户接管的节点。",
            role: "Planner",
            status: "done",
          },
          {
            id: "demo-route-aigc-step-2",
            title: "生成 Spec 与任务路径",
            description: "把项目目标转为可执行任务和产物清单。",
            role: "Spec Agent",
            status: "running",
          },
          {
            id: "demo-route-aigc-step-3",
            title: "归档演示产物",
            description: "沉淀 SVG、报告和运行证据，供项目空间回看。",
            role: "Archive Agent",
            status: "pending",
          },
        ],
        riskLevel: "medium",
        estimate: "1-2 days",
        selectedAt: "2026-05-04T01:28:00.000Z",
        createdAt: "2026-05-04T01:26:00.000Z",
      },
      {
        id: authRouteId,
        projectId: authProjectId,
        specId: authSpecId,
        kind: "conservative",
        title: "认证合同优先路线",
        summary: "先稳定共享认证合同和邮件验证码，再推进权限管理与审计。",
        steps: [
          {
            id: "demo-route-auth-step-1",
            title: "确认共享认证合同",
            status: "running",
          },
          {
            id: "demo-route-auth-step-2",
            title: "接入真实邮件验证码",
            status: "pending",
          },
        ],
        riskLevel: "medium",
        estimate: "2-3 days",
        selectedAt: "2026-05-04T02:15:00.000Z",
        createdAt: "2026-05-04T02:12:00.000Z",
      },
      {
        id: dataRouteId,
        projectId: dataProjectId,
        specId: dataSpecId,
        kind: "fast",
        title: "指标看板快速路线",
        summary: "用静态指标和筛选交互完成首版展示，再接入实时数据。",
        steps: [
          {
            id: "demo-route-data-step-1",
            title: "整理指标分组",
            status: "done",
          },
          {
            id: "demo-route-data-step-2",
            title: "完成看板原型",
            status: "done",
          },
        ],
        riskLevel: "low",
        estimate: "done",
        selectedAt: "2026-05-04T02:45:00.000Z",
        createdAt: "2026-05-04T02:20:00.000Z",
      },
    ],
    missions: [
      {
        id: "demo-project-mission-aigc-clarify",
        projectId: mainProjectId,
        missionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
        specId: mainSpecId,
        routeId: mainRouteId,
        status: "running",
        createdAt: "2026-05-04T01:30:00.000Z",
        updatedAt,
      },
      {
        id: "demo-project-mission-aigc-render",
        projectId: mainProjectId,
        missionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcRender,
        specId: mainSpecId,
        routeId: mainRouteId,
        status: "waiting",
        createdAt: "2026-05-04T02:00:00.000Z",
        updatedAt: "2026-05-04T03:20:00.000Z",
      },
      {
        id: "demo-project-mission-auth-spec",
        projectId: authProjectId,
        missionId: GITHUB_PAGES_DEMO_MISSION_IDS.authSpec,
        specId: authSpecId,
        routeId: authRouteId,
        status: "waiting",
        createdAt: "2026-05-04T02:18:00.000Z",
        updatedAt: "2026-05-04T03:00:00.000Z",
      },
      {
        id: "demo-project-mission-data-dashboard",
        projectId: dataProjectId,
        missionId: GITHUB_PAGES_DEMO_MISSION_IDS.dataDashboard,
        specId: dataSpecId,
        routeId: dataRouteId,
        status: "completed",
        createdAt: "2026-05-04T02:25:00.000Z",
        updatedAt: "2026-05-04T03:05:00.000Z",
      },
    ],
    artifacts: [
      {
        id: mainArtifactId,
        projectId: mainProjectId,
        type: "doc",
        title: "MVP Spec 草案",
        path: "docs/demo/aigc-comic-mvp-spec.md",
        contentPreview: "项目空间、自动驾驶、任务中心、产物归档的演示范围。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
        sourceSpecId: mainSpecId,
        createdAt: "2026-05-04T02:05:00.000Z",
      },
      {
        id: authArtifactId,
        projectId: authProjectId,
        type: "svg",
        title: "登录与权限架构图",
        path: "docs/demo/auth-admin-architecture.svg",
        contentPreview: "邮箱验证码、会话、项目权限和审计链路。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.authSpec,
        sourceSpecId: authSpecId,
        createdAt: "2026-05-04T02:44:00.000Z",
      },
      {
        id: dataArtifactId,
        projectId: dataProjectId,
        type: "prototype",
        title: "运营看板演示原型",
        path: "docs/demo/data-ops-dashboard.html",
        contentPreview: "增长、留存、成本和异常告警的首版看板。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.dataDashboard,
        sourceSpecId: dataSpecId,
        createdAt: "2026-05-04T03:02:00.000Z",
      },
    ],
    evidence: [
      {
        id: mainEvidenceId,
        projectId: mainProjectId,
        type: "message",
        title: "目标输入",
        detail: "用户希望从一句需求开始驱动 AI 漫剧生成平台的自动驾驶流程。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
        sourceSpecId: mainSpecId,
        createdAt,
      },
      {
        id: "demo-evidence-aigc-route",
        projectId: mainProjectId,
        type: "route",
        title: "路线已选择",
        detail: "选择演示优先自动驾驶路线，先突出项目级执行体验。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.aigcClarify,
        sourceSpecId: mainSpecId,
        sourceRouteId: mainRouteId,
        createdAt: "2026-05-04T01:28:00.000Z",
      },
      {
        id: authEvidenceId,
        projectId: authProjectId,
        type: "decision",
        title: "认证范围确认中",
        detail: "邮箱验证码登录已经进入真实服务接入阶段，权限模型仍需确认。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.authSpec,
        sourceSpecId: authSpecId,
        sourceRouteId: authRouteId,
        createdAt: "2026-05-04T02:20:00.000Z",
      },
      {
        id: dataEvidenceId,
        projectId: dataProjectId,
        type: "artifact-link",
        title: "看板演示完成",
        detail: "指标分组、筛选和导出入口已形成展示闭环。",
        sourceMissionId: GITHUB_PAGES_DEMO_MISSION_IDS.dataDashboard,
        sourceSpecId: dataSpecId,
        sourceRouteId: dataRouteId,
        createdAt: "2026-05-04T03:05:00.000Z",
      },
    ],
  };
}

function maybeSeedGitHubPagesDemoSnapshot(
  snapshot: ProjectStoreSnapshot
): ProjectStoreSnapshot {
  if (!IS_GITHUB_PAGES || snapshot.projects.length > 0) {
    return snapshot;
  }

  const demoSnapshot = createGitHubPagesDemoSnapshot();
  persistSnapshot(demoSnapshot);
  return demoSnapshot;
}

function createId(prefix: string) {
  return `${prefix}-${nanoid(10)}`;
}

function getSafeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeOwnerSelections(
  value: unknown
): Record<string, string | null> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | null] =>
        typeof entry[0] === "string" &&
        (typeof entry[1] === "string" || entry[1] === null)
    )
  );
}

function normalizeProjectOwner(project: Project): Project {
  const ownerUserId = project.ownerUserId?.trim();
  return {
    ...project,
    ownerUserId: ownerUserId || undefined,
  };
}

export function migrateProjectStoreSnapshot(
  value: unknown
): ProjectStoreSnapshot {
  if (!isRecord(value)) {
    return emptySnapshot();
  }

  const currentProjectId =
    typeof value.currentProjectId === "string" ? value.currentProjectId : null;

  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    currentProjectId,
    currentProjectIdsByOwner: normalizeOwnerSelections(
      value.currentProjectIdsByOwner
    ),
    projects: asArray<Project>(value.projects).map(normalizeProjectOwner),
    messages: asArray<ProjectMessage>(value.messages),
    clarificationQuestions: asArray<ProjectClarificationQuestion>(
      value.clarificationQuestions
    ),
    specs: asArray<ProjectSpec>(value.specs).map(spec => ({
      ...spec,
      sourceMessageIds: spec.sourceMessageIds ?? [],
      sourceEvidenceIds: spec.sourceEvidenceIds ?? [],
      sourceArtifactIds: spec.sourceArtifactIds ?? [],
      completenessDetail:
        spec.completenessDetail ??
        deriveProjectSpecCompleteness({
          title: spec.title,
          content: spec.content,
          sourceMessageIds: spec.sourceMessageIds ?? [],
          sourceEvidenceIds: spec.sourceEvidenceIds ?? [],
          sourceArtifactIds: spec.sourceArtifactIds ?? [],
        }),
    })),
    routes: asArray<ProjectRoute>(value.routes),
    missions: asArray<ProjectMission>(value.missions),
    artifacts: asArray<ProjectArtifact>(value.artifacts),
    evidence: asArray<ProjectEvidence>(value.evidence),
  };
}

function normalizeSnapshot(value: unknown): ProjectStoreSnapshot {
  return migrateProjectStoreSnapshot(value);
}

function loadSnapshot(): ProjectStoreSnapshot {
  const storage = getSafeLocalStorage();
  if (!storage) return emptySnapshot();

  try {
    const raw = storage.getItem(PROJECT_STORE_STORAGE_KEY);
    return raw ? normalizeSnapshot(JSON.parse(raw)) : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

function persistSnapshot(state: ProjectStoreSnapshot) {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(
      PROJECT_STORE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        currentProjectId: state.currentProjectId,
        currentProjectIdsByOwner: state.currentProjectIdsByOwner,
        projects: state.projects,
        messages: state.messages,
        clarificationQuestions: state.clarificationQuestions,
        specs: state.specs,
        routes: state.routes,
        missions: state.missions,
        artifacts: state.artifacts,
        evidence: state.evidence,
      } satisfies ProjectStoreSnapshot)
    );
  } catch {
    // Ignore storage failures in preview, SSR, or private browsing contexts.
  }
}

function toSnapshot(state: ProjectStoreState): ProjectStoreSnapshot {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    currentProjectId: state.currentProjectId,
    currentProjectIdsByOwner: state.currentProjectIdsByOwner,
    projects: state.projects,
    messages: state.messages,
    clarificationQuestions: state.clarificationQuestions,
    specs: state.specs,
    routes: state.routes,
    missions: state.missions,
    artifacts: state.artifacts,
    evidence: state.evidence,
  };
}

function compactText(value: string, maxLength = 42) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function deriveProjectName(input: CreateProjectInput) {
  const explicit = input.name?.trim();
  if (explicit) return explicit;
  return compactText(input.goal, 36) || "Untitled project";
}

function resolveProjectId(
  state: ProjectStoreState,
  projectId?: string
): string | null {
  const resolved = projectId ?? state.currentProjectId;
  if (!resolved) return null;
  return state.projects.some(
    project =>
      project.id === resolved &&
      canAccessProject(project, state.activeOwnerUserId)
  )
    ? resolved
    : null;
}

function ownerSelectionKey(userId: string | null): string {
  return userId ?? "__legacy__";
}

function canAccessProject(
  project: Project,
  ownerUserId: string | null
): boolean {
  if (!ownerUserId) return true;
  return project.ownerUserId === ownerUserId;
}

function getVisibleProjectsForOwner(
  projects: Project[],
  ownerUserId: string | null
): Project[] {
  return ownerUserId
    ? projects.filter(project => project.ownerUserId === ownerUserId)
    : projects;
}

function findVisibleProject(
  projects: Project[],
  projectId: string | null | undefined,
  ownerUserId: string | null
): Project | null {
  if (!projectId) return null;
  return (
    projects.find(
      project =>
        project.id === projectId && canAccessProject(project, ownerUserId)
    ) ?? null
  );
}

function resolveCurrentProjectIdForOwner(
  state: Pick<
    ProjectStoreState,
    | "activeOwnerUserId"
    | "currentProjectId"
    | "currentProjectIdsByOwner"
    | "projects"
  >
): string | null {
  const ownerKey = ownerSelectionKey(state.activeOwnerUserId);
  const ownerSelection = state.currentProjectIdsByOwner[ownerKey] ?? null;
  const preferred = ownerSelection ?? state.currentProjectId;
  if (findVisibleProject(state.projects, preferred, state.activeOwnerUserId)) {
    return preferred;
  }
  return (
    getVisibleProjectsForOwner(state.projects, state.activeOwnerUserId)[0]
      ?.id ?? null
  );
}

function claimLegacyProjectsForOwner(
  projects: Project[],
  ownerUserId: string | null
): Project[] {
  if (!ownerUserId) return projects;
  return projects.map(project =>
    project.ownerUserId ? project : { ...project, ownerUserId }
  );
}

function touchProject(project: Project, timestamp: string): Project {
  return {
    ...project,
    updatedAt: timestamp,
  };
}

function clampCompletenessScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function deriveProjectSpecCompleteness(input: {
  title?: string;
  content?: string;
  sourceMessageIds?: string[];
  sourceEvidenceIds?: string[];
  sourceArtifactIds?: string[];
}): ProjectSpecCompleteness {
  const missingFields: string[] = [];
  if (!input.title?.trim()) missingFields.push("title");
  if (!input.content?.trim()) missingFields.push("content");
  if (!input.sourceMessageIds?.length) missingFields.push("message-source");
  if (!input.sourceEvidenceIds?.length && !input.sourceArtifactIds?.length) {
    missingFields.push("evidence-or-artifact-source");
  }

  const score = clampCompletenessScore(1 - missingFields.length / 4);
  const band: ProjectSpecCompletenessBand =
    score >= 0.95
      ? "complete"
      : score >= 0.7
        ? "usable"
        : score > 0
          ? "partial"
          : "empty";

  return {
    score,
    band,
    missingFields,
    sourceCoverage: {
      messages: input.sourceMessageIds?.length ?? 0,
      evidence: input.sourceEvidenceIds?.length ?? 0,
      artifacts: input.sourceArtifactIds?.length ?? 0,
    },
  };
}

export interface ProjectSpecVersionDiffSummary {
  projectId: string;
  fromSpecId: string | null;
  toSpecId: string;
  fromVersion: number | null;
  toVersion: number;
  summary: string;
}

export function summarizeProjectSpecVersionDiff(
  previous: ProjectSpec | null,
  next: ProjectSpec
): ProjectSpecVersionDiffSummary {
  const summary =
    next.diffSummary?.trim() ||
    (previous
      ? `Spec v${next.version} updates v${previous.version}.`
      : `Spec v${next.version} is the first project spec.`);

  return {
    projectId: next.projectId,
    fromSpecId: previous?.id ?? null,
    toSpecId: next.id,
    fromVersion: previous?.version ?? null,
    toVersion: next.version,
    summary,
  };
}

function sortSpecsByVersion(specs: ProjectSpec[]) {
  return [...specs].sort((a, b) => a.version - b.version);
}

function commit(
  set: (
    partial:
      | ProjectStoreState
      | Partial<ProjectStoreState>
      | ((
          state: ProjectStoreState
        ) => ProjectStoreState | Partial<ProjectStoreState>),
    replace?: false
  ) => void,
  updater: (state: ProjectStoreState) => Partial<ProjectStoreState>
) {
  set(state => {
    const patch = updater(state);
    const next = { ...state, ...patch };
    persistSnapshot(toSnapshot(next));
    return patch;
  });
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  ...emptySnapshot(),
  activeOwnerUserId: null,
  ready: false,

  ensureReady: () => {
    if (get().ready) return;
    const snapshot = maybeSeedGitHubPagesDemoSnapshot(loadSnapshot());
    set({
      ...snapshot,
      currentProjectId: resolveCurrentProjectIdForOwner({
        ...snapshot,
        activeOwnerUserId: get().activeOwnerUserId,
      }),
      ready: true,
    });
  },

  reset: () => {
    const snapshot = emptySnapshot();
    const storage = getSafeLocalStorage();
    try {
      storage?.removeItem(PROJECT_STORE_STORAGE_KEY);
    } catch {
      // Ignore storage reset failures.
    }
    set({
      ...snapshot,
      activeOwnerUserId: null,
      ready: true,
    });
  },

  setActiveOwner: userId => {
    get().ensureReady();
    const activeOwnerUserId = userId?.trim() || null;
    commit(set, state => {
      const projects = claimLegacyProjectsForOwner(
        state.projects,
        activeOwnerUserId
      );
      const currentProjectId = resolveCurrentProjectIdForOwner({
        ...state,
        projects,
        activeOwnerUserId,
      });
      return {
        activeOwnerUserId,
        projects,
        currentProjectId,
        currentProjectIdsByOwner: {
          ...state.currentProjectIdsByOwner,
          [ownerSelectionKey(activeOwnerUserId)]: currentProjectId,
        },
      };
    });
  },

  setActiveOwnerForTest: userId => {
    get().setActiveOwner(userId);
  },

  createProject: input => {
    get().ensureReady();
    const timestamp = nowIso();
    const ownerUserId = get().activeOwnerUserId ?? undefined;
    const project: Project = {
      id: createId("project"),
      ownerUserId,
      name: deriveProjectName(input),
      goal: input.goal.trim(),
      status: input.status ?? "draft",
      summary: input.summary?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    commit(set, state => ({
      currentProjectId: project.id,
      currentProjectIdsByOwner: {
        ...state.currentProjectIdsByOwner,
        [ownerSelectionKey(state.activeOwnerUserId)]: project.id,
      },
      projects: [...state.projects, project],
    }));

    return project;
  },

  selectProject: projectId => {
    get().ensureReady();
    const state = get();
    const resolved = projectId
      ? (state.projects.find(
          project =>
            project.id === projectId &&
            canAccessProject(project, state.activeOwnerUserId)
        )?.id ?? null)
      : null;
    commit(set, current => ({
      currentProjectId: resolved,
      currentProjectIdsByOwner: {
        ...current.currentProjectIdsByOwner,
        [ownerSelectionKey(current.activeOwnerUserId)]: resolved,
      },
    }));
  },

  updateProject: (projectId, patch) => {
    get().ensureReady();
    const timestamp = nowIso();
    let updatedProject: Project | null = null;

    commit(set, state => ({
      projects: state.projects.map(project => {
        if (project.id !== projectId) return project;
        updatedProject = {
          ...project,
          ...patch,
          name:
            patch.name?.trim() || patch.name === ""
              ? patch.name.trim()
              : (patch.name ?? project.name),
          goal:
            patch.goal?.trim() || patch.goal === ""
              ? patch.goal.trim()
              : (patch.goal ?? project.goal),
          summary:
            patch.summary?.trim() || patch.summary === ""
              ? patch.summary.trim() || undefined
              : (patch.summary ?? project.summary),
          updatedAt: timestamp,
        };
        return updatedProject;
      }),
    }));

    return updatedProject;
  },

  archiveProject: projectId => {
    get().ensureReady();
    const timestamp = nowIso();
    let archivedProject: Project | null = null;

    commit(set, state => ({
      currentProjectId:
        state.currentProjectId === projectId ? null : state.currentProjectId,
      projects: state.projects.map(project => {
        if (project.id !== projectId) return project;
        archivedProject = {
          ...project,
          status: "archived",
          archivedAt: timestamp,
          updatedAt: timestamp,
        };
        return archivedProject;
      }),
    }));

    return archivedProject;
  },

  addProjectMessage: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const timestamp = nowIso();
    const message: ProjectMessage = {
      id: createId("project-message"),
      projectId,
      role: input.role,
      kind: input.kind ?? "chat",
      content: input.content,
      sourceMissionId: input.sourceMissionId,
      createdAt: timestamp,
    };

    commit(set, current => ({
      messages: [...current.messages, message],
      evidence:
        input.createEvidence === true
          ? [
              ...current.evidence,
              {
                id: createId("project-evidence"),
                projectId,
                type: "message",
                title:
                  input.evidenceTitle?.trim() ||
                  (input.role === "user"
                    ? "User input captured"
                    : "Project message captured"),
                detail: input.content,
                sourceMissionId: input.sourceMissionId,
                createdAt: timestamp,
              },
            ]
          : current.evidence,
      projects: current.projects.map(project =>
        project.id === projectId ? touchProject(project, timestamp) : project
      ),
    }));

    return message;
  },

  addProjectClarificationQuestion: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const text = input.text.trim();
    if (!text) return null;

    const timestamp = nowIso();
    const question: ProjectClarificationQuestion = {
      id: createId("project-clarification"),
      projectId,
      text,
      reason: input.reason?.trim() || "",
      scope: input.scope ?? "goal",
      answerType: input.answerType ?? "text",
      options: input.options
        ?.filter(option => option.trim())
        .map(option => option.trim()),
      required: input.required ?? true,
      defaultAssumption: input.defaultAssumption?.trim() || undefined,
      sourceCommandId: input.sourceCommandId,
      sourceQuestionId: input.sourceQuestionId,
      sourceMessageId: input.sourceMessageId,
      createdAt: timestamp,
    };

    commit(set, current => ({
      clarificationQuestions: [...current.clarificationQuestions, question],
      projects: current.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              status:
                project.status === "draft" ? "clarifying" : project.status,
            }
          : project
      ),
    }));

    return question;
  },

  answerProjectClarificationQuestion: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const question = state.clarificationQuestions.find(
      item => item.projectId === projectId && item.id === input.questionId
    );
    if (!question) return null;

    const inputAnswer = input.answer?.trim();
    const defaultAssumption = question.defaultAssumption?.trim();
    const answer = input.skipped
      ? inputAnswer || defaultAssumption
      : inputAnswer;
    if (!answer) return null;
    if (input.skipped && question.required && !defaultAssumption) return null;

    const timestamp = nowIso();
    let answeredQuestion: ProjectClarificationQuestion | null = null;

    commit(set, current => ({
      clarificationQuestions: current.clarificationQuestions.map(question => {
        if (
          question.projectId !== projectId ||
          question.id !== input.questionId
        ) {
          return question;
        }

        answeredQuestion = {
          ...question,
          answer,
          answeredAt: input.skipped ? question.answeredAt : timestamp,
          skippedAt: input.skipped ? timestamp : undefined,
        };
        return answeredQuestion;
      }),
      projects: current.projects.map(project =>
        project.id === projectId ? touchProject(project, timestamp) : project
      ),
    }));

    return answeredQuestion;
  },

  addProjectSpec: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const timestamp = nowIso();
    const projectSpecs = state.specs.filter(
      spec => spec.projectId === projectId
    );
    const previousCurrentSpec =
      (state.projects.find(project => project.id === projectId)?.currentSpecId
        ? (state.specs.find(
            spec =>
              spec.id ===
              state.projects.find(project => project.id === projectId)
                ?.currentSpecId
          ) ?? null)
        : null) ??
      sortSpecsByVersion(projectSpecs).at(-1) ??
      null;
    const version =
      projectSpecs.reduce(
        (maxVersion, spec) => Math.max(maxVersion, spec.version),
        0
      ) + 1;
    const sourceMessageIds = input.sourceMessageIds ?? [];
    const sourceEvidenceIds = input.sourceEvidenceIds ?? [];
    const sourceArtifactIds = input.sourceArtifactIds ?? [];
    const completenessDetail =
      input.completenessDetail ??
      deriveProjectSpecCompleteness({
        title: input.title,
        content: input.content,
        sourceMessageIds,
        sourceEvidenceIds,
        sourceArtifactIds,
      });
    const spec: ProjectSpec = {
      id: createId("project-spec"),
      projectId,
      version,
      title: input.title,
      content: input.content,
      status: input.status ?? "draft",
      sourceMessageIds,
      sourceEvidenceIds,
      sourceArtifactIds,
      completeness: input.completeness ?? completenessDetail.score,
      completenessDetail,
      supersedesSpecId: input.supersedesSpecId ?? previousCurrentSpec?.id,
      diffSummary: input.diffSummary,
      createdAt: timestamp,
    };

    commit(set, current => ({
      specs: [
        ...current.specs.map(
          (existingSpec): ProjectSpec =>
            existingSpec.id === spec.supersedesSpecId
              ? {
                  ...existingSpec,
                  status:
                    existingSpec.status === "accepted"
                      ? existingSpec.status
                      : "superseded",
                  supersededBySpecId: spec.id,
                  supersededAt:
                    existingSpec.status === "accepted"
                      ? existingSpec.supersededAt
                      : timestamp,
                }
              : existingSpec
        ),
        spec,
      ],
      projects: current.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              currentSpecId:
                input.makeCurrent === false ? project.currentSpecId : spec.id,
              status:
                project.status === "draft" || project.status === "clarifying"
                  ? "spec_ready"
                  : project.status,
            }
          : project
      ),
    }));

    return spec;
  },

  createInitialProjectSpecDraft: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input?.projectId);
    if (!projectId) return null;
    const project = state.projects.find(item => item.id === projectId);
    if (!project) return null;

    return get().addProjectSpec(
      buildInitialProjectSpecDraft({
        project,
        messages: state.messages,
        clarificationQuestions: state.clarificationQuestions,
        title: input?.title,
        makeCurrent: input?.makeCurrent,
      })
    );
  },

  acceptProjectSpec: (projectId, specId, confirmation) => {
    get().ensureReady();
    const timestamp = nowIso();
    const confirmationNote = confirmation?.note?.trim();
    const confirmationSourceEvidenceIds = confirmation?.sourceEvidenceIds ?? [];
    const confirmationSourceMessageIds = confirmation?.sourceMessageIds ?? [];
    const evidenceId =
      confirmationNote && confirmation?.createEvidence !== false
        ? createId("project-evidence")
        : null;
    let acceptedSpec: ProjectSpec | null = null;

    commit(set, state => ({
      specs: state.specs.map(spec => {
        if (spec.projectId !== projectId) return spec;
        if (spec.id !== specId) {
          return spec.status === "accepted"
            ? {
                ...spec,
                status: "superseded",
                supersededAt: spec.supersededAt ?? timestamp,
                supersededBySpecId: spec.supersededBySpecId ?? specId,
              }
            : spec;
        }

        acceptedSpec = {
          ...spec,
          status: "accepted",
          acceptedAt: spec.acceptedAt ?? timestamp,
          confirmedBy: confirmation?.confirmedBy ?? "user",
          confirmationNote: confirmationNote || spec.confirmationNote,
          confirmationEvidenceId: evidenceId ?? spec.confirmationEvidenceId,
          sourceMessageIds: Array.from(
            new Set([...spec.sourceMessageIds, ...confirmationSourceMessageIds])
          ),
          sourceEvidenceIds: Array.from(
            new Set([
              ...spec.sourceEvidenceIds,
              ...confirmationSourceEvidenceIds,
              ...(evidenceId ? [evidenceId] : []),
            ])
          ),
        };
        return acceptedSpec;
      }),
      evidence: evidenceId
        ? [
            ...state.evidence,
            {
              id: evidenceId,
              projectId,
              type: "decision",
              title: "Spec accepted",
              detail: confirmationNote || "User accepted the project spec.",
              createdAt: timestamp,
            },
          ]
        : state.evidence,
      projects: state.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              currentSpecId: specId,
              status:
                project.status === "draft" || project.status === "clarifying"
                  ? "spec_ready"
                  : project.status,
            }
          : project
      ),
    }));

    return acceptedSpec;
  },

  supersedeProjectSpec: (projectId, specId, replacementSpecId) => {
    get().ensureReady();
    const timestamp = nowIso();
    let supersededSpec: ProjectSpec | null = null;

    commit(set, state => ({
      specs: state.specs.map(spec => {
        if (spec.projectId !== projectId || spec.id !== specId) return spec;
        supersededSpec = {
          ...spec,
          status: "superseded",
          supersededAt: spec.supersededAt ?? timestamp,
          supersededBySpecId: replacementSpecId ?? spec.supersededBySpecId,
        };
        return supersededSpec;
      }),
      projects: state.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              currentSpecId:
                project.currentSpecId === specId
                  ? replacementSpecId
                  : project.currentSpecId,
            }
          : project
      ),
    }));

    return supersededSpec;
  },

  addProjectRoute: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const timestamp = nowIso();
    const route: ProjectRoute = {
      id: createId("project-route"),
      projectId,
      specId: input.specId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      steps: input.steps ?? [],
      riskLevel: input.riskLevel ?? "medium",
      estimate: input.estimate,
      selectedAt: input.selected ? timestamp : undefined,
      createdAt: timestamp,
    };

    commit(set, current => ({
      routes: [...current.routes, route],
      projects: current.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              currentRouteId: input.selected
                ? route.id
                : project.currentRouteId,
              status:
                project.status === "spec_ready" || project.status === "draft"
                  ? "planning"
                  : project.status,
            }
          : project
      ),
    }));

    return route;
  },

  generateProjectRoutePlan: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input?.projectId);
    if (!projectId) return [];
    const project = state.projects.find(item => item.id === projectId);
    if (!project) return [];

    const currentSpec = get().getCurrentProjectSpec(projectId);
    const recentMessages = state.messages
      .filter(message => message.projectId === projectId)
      .slice(-5);
    const plan = buildProjectRoutePlan({
      project,
      currentSpec,
      recentMessages,
    });

    return plan.candidates
      .map(candidate =>
        get().addProjectRoute({
          projectId,
          specId: candidate.specId,
          kind: candidate.kind,
          title: candidate.title,
          summary: candidate.summary,
          steps: candidate.steps,
          riskLevel: candidate.riskLevel,
          estimate: candidate.estimate,
          selected: candidate.kind === input?.selectKind,
        })
      )
      .filter((route): route is ProjectRoute => Boolean(route));
  },

  replanProjectRoutePlan: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input?.projectId);
    if (!projectId) return [];
    const project = state.projects.find(item => item.id === projectId);
    if (!project) return [];

    const sourceMission = input?.sourceMissionId
      ? (state.missions.find(
          mission =>
            mission.projectId === projectId &&
            mission.missionId === input.sourceMissionId
        ) ?? null)
      : null;
    const sourceRouteId =
      input?.sourceRouteId ?? sourceMission?.routeId ?? project.currentRouteId;
    const sourceRoute = sourceRouteId
      ? (state.routes.find(
          route => route.projectId === projectId && route.id === sourceRouteId
        ) ?? null)
      : null;
    const sourceSpecId =
      input?.sourceSpecId ?? sourceMission?.specId ?? sourceRoute?.specId;
    const selectKind =
      input?.selectKind ??
      sourceRoute?.kind ??
      ("recommended" as ProjectRouteKind);

    const routes = get().generateProjectRoutePlan({
      projectId,
      selectKind,
    });
    const selectedRoute =
      routes.find(route => route.kind === selectKind) ?? routes[0] ?? null;

    if (selectedRoute && input?.createEvidence !== false) {
      const action = input?.action ?? "replanned";
      const reason = input?.reason?.trim();
      get().addProjectEvidence({
        projectId,
        type: "route",
        title:
          action === "failed"
            ? "Route replanned after failure"
            : "Route replanned",
        detail:
          reason ||
          `${selectedRoute.title} was generated to replace the previous project route.`,
        sourceMissionId: input?.sourceMissionId,
        sourceSpecId: sourceSpecId ?? selectedRoute.specId,
        sourceRouteId: sourceRouteId ?? selectedRoute.id,
      });
    }

    return routes;
  },

  selectProjectRoute: (projectId, routeId, evidenceInput) => {
    get().ensureReady();
    const timestamp = nowIso();
    let selectedRoute: ProjectRoute | null = null;
    const action = evidenceInput?.action ?? "selected";
    const shouldCreateEvidence =
      Boolean(evidenceInput) && evidenceInput?.createEvidence !== false;
    const evidenceId = shouldCreateEvidence
      ? createId("project-evidence")
      : null;

    commit(set, state => ({
      routes: state.routes.map(route => {
        if (route.projectId !== projectId) return route;
        if (route.id !== routeId) {
          return {
            ...route,
            selectedAt: undefined,
          };
        }
        selectedRoute = {
          ...route,
          selectedAt: route.selectedAt ?? timestamp,
        };
        return selectedRoute;
      }),
      evidence:
        evidenceId && selectedRoute
          ? [
              ...state.evidence,
              {
                id: evidenceId,
                projectId,
                type: "route",
                title: `Route ${action}`,
                detail:
                  evidenceInput?.note?.trim() ||
                  `${selectedRoute.title} was ${action} for project execution.`,
                sourceMissionId: evidenceInput?.sourceMissionId,
                sourceSpecId: selectedRoute.specId,
                sourceRouteId: selectedRoute.id,
                createdAt: timestamp,
              },
            ]
          : state.evidence,
      projects: state.projects.map(project =>
        project.id === projectId
          ? {
              ...touchProject(project, timestamp),
              currentRouteId: routeId,
              status:
                project.status === "spec_ready" ? "planning" : project.status,
            }
          : project
      ),
    }));

    return selectedRoute;
  },

  createMissionPlanFromRoute: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input?.projectId);
    if (!projectId) return null;

    const route =
      (input?.routeId
        ? state.routes.find(
            item => item.projectId === projectId && item.id === input.routeId
          )
        : null) ??
      state.routes.find(
        item =>
          item.projectId === projectId &&
          item.id ===
            state.projects.find(project => project.id === projectId)
              ?.currentRouteId
      ) ??
      state.routes.find(
        item => item.projectId === projectId && Boolean(item.selectedAt)
      ) ??
      null;
    if (!route) return null;

    const plan = buildMissionPlanFromRoute({
      route,
      missionId: input?.missionId,
    });

    return get().linkMissionToProject({
      projectId: plan.projectId,
      missionId: plan.missionId,
      specId: plan.specId,
      routeId: plan.routeId,
      status: plan.status,
    });
  },

  linkMissionToProject: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId || !input.missionId) return null;

    const timestamp = nowIso();
    const existing = state.missions.find(
      mission => mission.missionId === input.missionId
    );
    let linkedMission: ProjectMission;

    if (existing) {
      const previousStatus = existing.status;
      linkedMission = {
        ...existing,
        projectId,
        specId: input.specId ?? existing.specId,
        routeId: input.routeId ?? existing.routeId,
        status: input.status ?? existing.status,
        updatedAt: timestamp,
      };
      const statusChanged = previousStatus !== linkedMission.status;
      const shouldRecordTerminalEvidence =
        input.createEvidence !== false &&
        statusChanged &&
        (linkedMission.status === "completed" ||
          linkedMission.status === "failed" ||
          linkedMission.status === "cancelled");
      commit(set, current => ({
        missions: current.missions.map(mission =>
          mission.id === existing.id ? linkedMission : mission
        ),
        evidence: shouldRecordTerminalEvidence
          ? [
              ...current.evidence,
              {
                id: createId("project-evidence"),
                projectId,
                type: projectMissionEvidenceType(linkedMission.status),
                title: projectMissionEvidenceTitle(linkedMission.status, false),
                detail: `Mission ${linkedMission.missionId} changed from ${previousStatus} to ${linkedMission.status}.`,
                sourceMissionId: linkedMission.missionId,
                sourceSpecId: linkedMission.specId,
                sourceRouteId: linkedMission.routeId,
                createdAt: timestamp,
              },
            ]
          : current.evidence,
        projects: current.projects.map(project =>
          project.id === projectId
            ? { ...touchProject(project, timestamp), status: "executing" }
            : project
        ),
      }));
      return linkedMission;
    }

    linkedMission = {
      id: createId("project-mission"),
      projectId,
      missionId: input.missionId,
      specId: input.specId,
      routeId: input.routeId,
      status: input.status ?? "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    commit(set, current => ({
      missions: [...current.missions, linkedMission],
      evidence:
        input.createEvidence === false
          ? current.evidence
          : [
              ...current.evidence,
              {
                id: createId("project-evidence"),
                projectId,
                type: "runtime",
                title: projectMissionEvidenceTitle(linkedMission.status, true),
                detail: `Mission ${linkedMission.missionId} was linked to the project with status ${linkedMission.status}.`,
                sourceMissionId: linkedMission.missionId,
                sourceSpecId: linkedMission.specId,
                sourceRouteId: linkedMission.routeId,
                createdAt: timestamp,
              },
            ],
      projects: current.projects.map(project =>
        project.id === projectId
          ? { ...touchProject(project, timestamp), status: "executing" }
          : project
      ),
    }));

    return linkedMission;
  },

  updateProjectMissionStatus: (missionId, status) => {
    get().ensureReady();
    const timestamp = nowIso();
    let updatedMission: ProjectMission | null = null;
    let previousStatus: ProjectMissionStatus | null = null;

    commit(set, state => ({
      missions: state.missions.map(mission => {
        if (mission.missionId !== missionId) return mission;
        previousStatus = mission.status;
        updatedMission = {
          ...mission,
          status,
          updatedAt: timestamp,
        };
        return updatedMission;
      }),
      evidence:
        updatedMission &&
        previousStatus !== status &&
        (status === "completed" ||
          status === "failed" ||
          status === "cancelled")
          ? [
              ...state.evidence,
              {
                id: createId("project-evidence"),
                projectId: updatedMission.projectId,
                type: projectMissionEvidenceType(status),
                title: projectMissionEvidenceTitle(status, false),
                detail: `Mission ${missionId} changed from ${previousStatus} to ${status}.`,
                sourceMissionId: missionId,
                sourceSpecId: updatedMission.specId,
                sourceRouteId: updatedMission.routeId,
                createdAt: timestamp,
              },
            ]
          : state.evidence,
    }));

    return updatedMission;
  },

  addProjectArtifact: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const timestamp = nowIso();
    const artifact: ProjectArtifact = {
      id: createId("project-artifact"),
      projectId,
      type: input.type,
      title: input.title,
      path: input.path,
      contentPreview: input.contentPreview,
      sourceMissionId: input.sourceMissionId,
      sourceSpecId: input.sourceSpecId,
      createdAt: timestamp,
    };

    commit(set, current => ({
      artifacts: [...current.artifacts, artifact],
      projects: current.projects.map(project =>
        project.id === projectId ? touchProject(project, timestamp) : project
      ),
    }));

    return artifact;
  },

  addProjectEvidence: input => {
    get().ensureReady();
    const state = get();
    const projectId = resolveProjectId(state, input.projectId);
    if (!projectId) return null;

    const timestamp = nowIso();
    const evidence: ProjectEvidence = {
      id: createId("project-evidence"),
      projectId,
      type: input.type,
      title: input.title,
      detail: input.detail,
      sourceMissionId: input.sourceMissionId,
      sourceSpecId: input.sourceSpecId,
      sourceRouteId: input.sourceRouteId,
      createdAt: timestamp,
    };

    commit(set, current => ({
      evidence: [...current.evidence, evidence],
      projects: current.projects.map(project =>
        project.id === projectId ? touchProject(project, timestamp) : project
      ),
    }));

    return evidence;
  },

  getVisibleProjects: () => {
    get().ensureReady();
    const state = get();
    return getVisibleProjectsForOwner(state.projects, state.activeOwnerUserId);
  },

  getCurrentProject: () => {
    get().ensureReady();
    const state = get();
    return findVisibleProject(
      state.projects,
      state.currentProjectId,
      state.activeOwnerUserId
    );
  },

  getProjectBundle: projectId => {
    get().ensureReady();
    const state = get();
    const project = findVisibleProject(
      state.projects,
      projectId,
      state.activeOwnerUserId
    );
    if (!project) return null;

    return {
      project,
      messages: state.messages.filter(item => item.projectId === projectId),
      clarificationQuestions: state.clarificationQuestions.filter(
        item => item.projectId === projectId
      ),
      specs: state.specs.filter(item => item.projectId === projectId),
      routes: state.routes.filter(item => item.projectId === projectId),
      missions: state.missions.filter(item => item.projectId === projectId),
      artifacts: state.artifacts.filter(item => item.projectId === projectId),
      evidence: state.evidence.filter(item => item.projectId === projectId),
    };
  },

  getProjectClarificationQuestions: projectId => {
    get().ensureReady();
    const state = get();
    if (
      !findVisibleProject(state.projects, projectId, state.activeOwnerUserId)
    ) {
      return [];
    }
    return get().clarificationQuestions.filter(
      question => question.projectId === projectId
    );
  },

  getProjectSpecs: projectId => {
    get().ensureReady();
    const state = get();
    if (
      !findVisibleProject(state.projects, projectId, state.activeOwnerUserId)
    ) {
      return [];
    }
    return sortSpecsByVersion(
      get().specs.filter(spec => spec.projectId === projectId)
    );
  },

  getCurrentProjectSpec: projectId => {
    get().ensureReady();
    const state = get();
    const project = findVisibleProject(
      state.projects,
      projectId,
      state.activeOwnerUserId
    );
    if (!project) return null;
    if (project.currentSpecId) {
      return (
        state.specs.find(spec => spec.id === project.currentSpecId) ?? null
      );
    }
    return (
      sortSpecsByVersion(
        state.specs.filter(
          spec => spec.projectId === projectId && spec.status !== "superseded"
        )
      ).at(-1) ?? null
    );
  },

  getMissionProjectLink: missionId => {
    get().ensureReady();
    const state = get();
    const mission =
      state.missions.find(item => item.missionId === missionId) ?? null;
    if (!mission) return null;
    return findVisibleProject(
      state.projects,
      mission.projectId,
      state.activeOwnerUserId
    )
      ? mission
      : null;
  },

  getProjectIdForMission: missionId => {
    get().ensureReady();
    return get().getMissionProjectLink(missionId)?.projectId ?? null;
  },
}));

export function selectCurrentProject(state: ProjectStoreState) {
  return findVisibleProject(
    state.projects,
    state.currentProjectId,
    state.activeOwnerUserId
  );
}

export function selectVisibleProjects(state: ProjectStoreState): Project[] {
  return getVisibleProjectsForOwner(state.projects, state.activeOwnerUserId);
}

export function selectProjectBundle(
  state: ProjectStoreState,
  projectId: string | null
): ProjectBundle | null {
  if (!projectId) return null;
  const project = findVisibleProject(
    state.projects,
    projectId,
    state.activeOwnerUserId
  );
  if (!project) return null;

  return {
    project,
    messages: state.messages.filter(item => item.projectId === projectId),
    clarificationQuestions: state.clarificationQuestions.filter(
      item => item.projectId === projectId
    ),
    specs: state.specs.filter(item => item.projectId === projectId),
    routes: state.routes.filter(item => item.projectId === projectId),
    missions: state.missions.filter(item => item.projectId === projectId),
    artifacts: state.artifacts.filter(item => item.projectId === projectId),
    evidence: state.evidence.filter(item => item.projectId === projectId),
  };
}

export function selectProjectSpecs(
  state: ProjectStoreState,
  projectId: string | null
): ProjectSpec[] {
  if (!projectId) return [];
  if (!findVisibleProject(state.projects, projectId, state.activeOwnerUserId)) {
    return [];
  }
  return sortSpecsByVersion(
    state.specs.filter(spec => spec.projectId === projectId)
  );
}

export function selectCurrentProjectSpec(
  state: ProjectStoreState,
  projectId: string | null
): ProjectSpec | null {
  if (!projectId) return null;
  const project = findVisibleProject(
    state.projects,
    projectId,
    state.activeOwnerUserId
  );
  if (!project) return null;
  if (project.currentSpecId) {
    return state.specs.find(spec => spec.id === project.currentSpecId) ?? null;
  }
  return (
    sortSpecsByVersion(
      state.specs.filter(
        spec => spec.projectId === projectId && spec.status !== "superseded"
      )
    ).at(-1) ?? null
  );
}
