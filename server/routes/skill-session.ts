import { randomUUID } from "node:crypto";
import express from "express";

import type {
  BlueprintClarificationAnswer,
  BlueprintClarificationQuestion,
  BlueprintClarificationSession,
  BlueprintCreateGenerationJobResponse,
  BlueprintEffectPreview,
  BlueprintEffectPreviewsResponse,
  BlueprintGenerateEffectPreviewsRequest,
  BlueprintGenerateImplementationPromptPackagesRequest,
  BlueprintGenerateSpecDocumentsRequest,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintImplementationPromptPackage,
  BlueprintImplementationPromptPackagesResponse,
  BlueprintIntake,
  BlueprintIntakeRequest,
  BlueprintRouteSelection,
  BlueprintRouteSelectionRequest,
  BlueprintRouteSet,
  BlueprintSelectRouteResponse,
  BlueprintSpecDocument,
  BlueprintSpecDocumentsResponse,
  BlueprintSpecTree,
} from "../../shared/blueprint/index.js";

export type SkillSessionStatus =
  | "running"
  | "waiting_for_user"
  | "completed"
  | "failed";
export type SkillDecisionType = "single_select" | "multi_select" | "text_input";
export type SkillAgentStatus = "working" | "blocked" | "completed";

export interface SkillAgentCard {
  id: string;
  name: string;
  role: string;
  status: SkillAgentStatus;
  summary: string;
}

export interface SkillDecision {
  stepId: string;
  type: SkillDecisionType;
  title: string;
  description: string;
  required: boolean;
  options?: Array<{ id: string; label: string; description: string }>;
}

export interface SkillSnapshot {
  stage: string;
  summary: string;
  waitingForUser: boolean;
  agents: SkillAgentCard[];
}

export interface SkillAgentStreamEvent {
  sequence: number;
  type: "agent_status" | "decision_required";
  timestamp: string;
  stage: string;
  agent: Omit<SkillAgentCard, "summary">;
  summary: string;
  waitingForUser: boolean;
}

interface SkillResultPackage {
  input: string;
  clarifications: Array<{ stepId: string; answer: string }>;
  selectedRoute: { id: string; label: string } | null;
  specTree: { title: string; nodes: unknown[] };
  specDocument: { title: string; markdown: string };
  imagePrompts: Array<{
    id: string;
    label: string;
    prompt: string;
    imageSize: string;
  }>;
}

interface BlueprintSkillState {
  intake: BlueprintIntake | null;
  clarificationSession: BlueprintClarificationSession | null;
  job: BlueprintGenerationJob | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  documents: BlueprintSpecDocument[];
  effectPreviews: BlueprintEffectPreview[];
  promptPackages: BlueprintImplementationPromptPackage[];
}

interface SkillSessionRecord {
  sessionId: string;
  input: string;
  status: SkillSessionStatus;
  snapshot: SkillSnapshot;
  decision: SkillDecision | null;
  events: SkillAgentStreamEvent[];
  result: SkillResultPackage | null;
  clarifications: Array<{ stepId: string; answer: string }>;
  state: BlueprintSkillState;
}

export type SkillSessionErrorCode =
  | "INVALID_INPUT"
  | "INVALID_ANSWER"
  | "SESSION_NOT_FOUND"
  | "STATE_CONFLICT"
  | "RUNTIME_FAILURE";

interface SkillSessionError {
  code: SkillSessionErrorCode;
  message: string;
}

interface SkillEnvelope {
  ok: boolean;
  sessionId: string | null;
  status: SkillSessionStatus;
  snapshot: SkillSnapshot | null;
  decision: SkillDecision | null;
  result: SkillResultPackage | null;
  error: SkillSessionError | null;
}

interface SkillAgentStreamEnvelope {
  ok: boolean;
  sessionId: string | null;
  cursor: number;
  events: SkillAgentStreamEvent[];
  error: SkillSessionError | null;
}

export interface SkillBlueprintClient {
  createIntake(
    request: BlueprintIntakeRequest,
  ): Promise<{ intake: BlueprintIntake; projectContext?: unknown }>;
  createClarificationSession(
    intakeId: string,
  ): Promise<{ session: BlueprintClarificationSession }>;
  answerClarification(
    sessionId: string,
    answers: BlueprintClarificationAnswer[],
  ): Promise<{ session: BlueprintClarificationSession }>;
  createGenerationJob(
    request: BlueprintGenerationRequest,
  ): Promise<BlueprintCreateGenerationJobResponse>;
  selectRoute(
    jobId: string,
    request: BlueprintRouteSelectionRequest,
  ): Promise<BlueprintSelectRouteResponse>;
  generateSpecDocuments(
    jobId: string,
    request?: BlueprintGenerateSpecDocumentsRequest,
  ): Promise<BlueprintSpecDocumentsResponse>;
  generateEffectPreviews(
    jobId: string,
    request?: BlueprintGenerateEffectPreviewsRequest,
  ): Promise<BlueprintEffectPreviewsResponse>;
  generatePromptPackages(
    jobId: string,
    request?: BlueprintGenerateImplementationPromptPackagesRequest,
  ): Promise<BlueprintImplementationPromptPackagesResponse>;
}

export interface SkillSessionStore {
  start(input: string): Promise<SkillSessionRecord>;
  get(sessionId: string): SkillSessionRecord | null;
  respond(
    sessionId: string,
    stepId: string,
    selected: string,
  ): Promise<SkillSessionRecord>;
}

class SkillSessionOperationError extends Error {
  readonly statusCode: number;
  readonly sessionId: string | null;
  readonly detail: SkillSessionError;

  constructor(
    statusCode: number,
    detail: SkillSessionError,
    sessionId: string | null = null,
  ) {
    super(detail.message);
    this.name = "SkillSessionOperationError";
    this.statusCode = statusCode;
    this.sessionId = sessionId;
    this.detail = detail;
  }
}

function isOperationError(error: unknown): error is SkillSessionOperationError {
  return error instanceof SkillSessionOperationError;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildEmptyState(): BlueprintSkillState {
  return {
    intake: null,
    clarificationSession: null,
    job: null,
    routeSet: null,
    selection: null,
    specTree: null,
    documents: [],
    effectPreviews: [],
    promptPackages: [],
  };
}

function createFallbackAgent(
  id: string,
  name: string,
  role: string,
  status: SkillAgentStatus,
  summary: string,
): SkillAgentCard {
  return { id, name, role, status, summary };
}

function normalizeAgentStatus(state: string | undefined): SkillAgentStatus {
  if (state === "sleeping" || state === "blocked") {
    return "blocked";
  }
  if (state === "completed") {
    return "completed";
  }
  return "working";
}

function toSkillStage(record: SkillSessionRecord): string {
  if (record.result) return "completed";
  if (record.decision?.stepId === "route-selection") return "route_selection";
  if (record.decision?.stepId === "review-spec-tree") return "spec_tree";
  if (record.decision) return "clarification";

  switch (record.state.job?.stage) {
    case "route_generation":
      return "route_selection";
    case "spec_tree":
      return "spec_tree";
    case "spec_docs":
      return "spec_documents";
    case "effect_preview":
      return "effect_preview";
    case "prompt_packaging":
      return "prompt_package";
    case "engineering_handoff":
    case "engineering_landing":
      return "engineering_handoff";
    default:
      return record.state.clarificationSession ? "clarification" : "intake";
  }
}

function buildClarificationDecision(
  question: BlueprintClarificationQuestion,
): SkillDecision {
  const type: SkillDecisionType =
    question.type === "multi_choice"
      ? "multi_select"
      : question.type === "free_text"
        ? "text_input"
        : "single_select";

  return {
    stepId: question.id,
    type,
    title: question.prompt,
    description: question.context ?? "请先完成这一项澄清。",
    required: question.required,
    options: Array.isArray(question.options)
      ? question.options.map(option => ({
          id: option,
          label: option,
          description: "",
        }))
      : undefined,
  };
}

function buildRouteSelectionDecision(routeSet: BlueprintRouteSet): SkillDecision {
  return {
    stepId: "route-selection",
    type: "single_select",
    title: "请选择推进路线",
    description: "不同路线会影响输出粒度和优先级。",
    required: true,
    options: routeSet.routes.map(route => ({
      id: route.id,
      label: route.title,
      description: route.summary,
    })),
  };
}

function buildSpecTreeReviewDecision(specTree: BlueprintSpecTree): SkillDecision {
  const rootNode = specTree.nodes.find(node => node.id === specTree.rootNodeId);
  return {
    stepId: "review-spec-tree",
    type: "single_select",
    title: rootNode
      ? `请审阅 SPEC Tree：${rootNode.title}`
      : "请审阅生成的 SPEC Tree",
    description: "确认树结构后，才继续生成规格文档、预演和实现提示词。",
    required: true,
    options: [
      {
        id: "confirm",
        label: "确认进入文档生成",
        description: "当前 SPEC Tree 可接受，继续生成规格文档和提示词。",
      },
      {
        id: "need-adjustment",
        label: "需要调整",
        description: "先停在 SPEC Tree 审阅阶段，稍后再继续。",
      },
    ],
  };
}

function pickPendingQuestion(
  session: BlueprintClarificationSession,
): BlueprintClarificationQuestion | null {
  const answeredIds = new Set(session.answers.map(answer => answer.questionId));
  const requiredQuestion = session.questions.find(
    question => question.required && !answeredIds.has(question.id),
  );
  if (requiredQuestion) return requiredQuestion;
  return session.questions.find(question => !answeredIds.has(question.id)) ?? null;
}

function buildAgentCardsFromJob(job: BlueprintGenerationJob | null): SkillAgentCard[] {
  if (!job) return [];

  const roleTimelineArtifact = [...job.artifacts]
    .reverse()
    .find(artifact => artifact.type === "role_timeline");
  const timelineCollection = roleTimelineArtifact?.payload as
    | {
        timelines?: Array<{
          roleId: string;
          roleDisplayName?: string;
          roleDisplayLabelZh?: string;
          latestPresenceState?: string;
          latestAction?: string;
          entries?: Array<{ summary?: string }>;
        }>;
      }
    | undefined;
  const timelines = Array.isArray(timelineCollection?.timelines)
    ? timelineCollection.timelines
    : [];
  if (timelines.length > 0) {
    return timelines.slice(0, 6).map(timeline => ({
      id: timeline.roleId,
      name:
        timeline.roleDisplayLabelZh ??
        timeline.roleDisplayName ??
        timeline.roleId,
      role: timeline.roleId,
      status:
        job.status === "completed"
          ? "completed"
          : normalizeAgentStatus(timeline.latestPresenceState),
      summary:
        timeline.latestAction ??
        timeline.entries?.at(-1)?.summary ??
        `${timeline.roleId} is active in ${job.stage}.`,
    }));
  }

  const agentCrewArtifact = [...job.artifacts]
    .reverse()
    .find(artifact => artifact.type === "agent_crew");
  const crew = agentCrewArtifact?.payload as
    | {
        roles?: Array<{
          id: string;
          name?: string;
          displayName?: string;
          displayLabelZh?: string;
        }>;
        presence?: Array<{ roleId: string; state: string }>;
      }
    | undefined;
  const roles = Array.isArray(crew?.roles) ? crew.roles : [];
  const presence = Array.isArray(crew?.presence) ? crew.presence : [];
  const roleById = new Map(roles.map(role => [role.id, role]));
  if (presence.length > 0) {
    return presence.slice(0, 6).map(item => {
      const role = roleById.get(item.roleId);
      return {
        id: item.roleId,
        name:
          role?.displayLabelZh ??
          role?.displayName ??
          role?.name ??
          item.roleId,
        role: item.roleId,
        status: job.status === "completed" ? "completed" : normalizeAgentStatus(item.state),
        summary: `${item.roleId} is ${item.state} during ${job.stage}.`,
      };
    });
  }

  return [];
}

function buildAgents(record: SkillSessionRecord): SkillAgentCard[] {
  const jobAgents = buildAgentCardsFromJob(record.state.job);
  if (jobAgents.length > 0) return jobAgents;

  if (record.decision?.stepId === "route-selection") {
    return [
      createFallbackAgent(
        "planner",
        "规划师",
        "planner",
        "blocked",
        "候选路线已准备好，等待用户选择。",
      ),
    ];
  }

  if (record.decision?.stepId === "review-spec-tree") {
    return [
      createFallbackAgent(
        "architect",
        "架构师",
        "architect",
        "blocked",
        "SPEC Tree 已生成，等待用户审阅后继续。",
      ),
    ];
  }

  if (record.state.clarificationSession) {
    return [
      createFallbackAgent(
        "clarifier",
        "澄清师",
        "clarifier",
        record.decision ? "blocked" : "working",
        record.decision
          ? "澄清问题已生成，等待用户回答。"
          : "正在整理澄清信息。",
      ),
    ];
  }

  return [
    createFallbackAgent(
      "intake",
      "输入分析器",
      "intake",
      "working",
      "正在准备蓝图上下文。",
    ),
  ];
}

function buildSummary(record: SkillSessionRecord): string {
  if (record.result) {
    return "完整产物包已生成，可直接交给 Skill 展示。";
  }
  if (record.decision?.stepId === "route-selection") {
    const count = record.state.routeSet?.routes.length ?? 0;
    return `规划师已生成 ${count} 条候选路线，等待用户选择。`;
  }
  if (record.decision?.stepId === "review-spec-tree") {
    const count = record.state.specTree?.nodes.length ?? 0;
    return `SPEC Tree 已生成，包含 ${count} 个节点，等待用户审阅。`;
  }
  if (record.decision) {
    return "澄清问题已生成，等待用户回答。";
  }
  if (record.state.job) {
    switch (record.state.job.stage) {
      case "spec_tree":
        return "已进入 SPEC Tree 推导阶段。";
      case "spec_docs":
        return "正在生成规格文档。";
      case "effect_preview":
        return "正在生成效果预演与生图提示词。";
      case "prompt_packaging":
        return "正在整理 Trae 可消费的提示词包。";
      default:
        return `蓝图流程正在 ${record.state.job.stage} 阶段推进。`;
    }
  }
  return "会话已创建。";
}

function buildSnapshot(record: SkillSessionRecord): SkillSnapshot {
  return {
    stage: toSkillStage(record),
    summary: buildSummary(record),
    waitingForUser: record.decision !== null,
    agents: buildAgents(record),
  };
}

function buildSpecDocumentPayload(
  documents: BlueprintSpecDocument[],
  fallbackInput: string,
): { title: string; markdown: string } {
  if (documents.length === 0) {
    return {
      title: `${fallbackInput} 规格草案`,
      markdown: "# 规格文档\n\n当前流程尚未生成规格文档。",
    };
  }

  return {
    title: documents[0]?.title ?? `${fallbackInput} 规格草案`,
    markdown: documents
      .map(document => `# ${document.title}\n\n${document.content}`)
      .join("\n\n"),
  };
}

function buildImagePromptPayload(
  previews: BlueprintEffectPreview[],
  documents: BlueprintSpecDocument[],
): SkillResultPackage["imagePrompts"] {
  const documentTitleByNodeId = new Map(documents.map(document => [document.nodeId, document.title]));
  const prompts: SkillResultPackage["imagePrompts"] = [];

  for (const preview of previews) {
    const promptMap = preview.imageBase64ByNodeId ?? {};
    for (const [nodeId, imageRecord] of Object.entries(promptMap)) {
      if (!imageRecord.promptUsed) continue;
      prompts.push({
        id: `${preview.id}:${nodeId}`,
        label: preview.provenance.nodeTitle ?? documentTitleByNodeId.get(nodeId) ?? nodeId,
        prompt: imageRecord.promptUsed,
        imageSize: "landscape_16_9",
      });
    }
  }

  return prompts;
}

function buildResultPackage(record: SkillSessionRecord): SkillResultPackage {
  const specDocument = buildSpecDocumentPayload(record.state.documents, record.input);
  const routeLabel =
    record.state.selection?.routeTitle ??
    record.state.routeSet?.routes.find(route => route.id === record.state.selection?.routeId)?.title ??
    null;

  return {
    input: record.input,
    clarifications: record.clarifications,
    selectedRoute: record.state.selection
      ? {
          id: record.state.selection.routeId,
          label: routeLabel ?? record.state.selection.routeId,
        }
      : null,
    specTree: {
      title:
        record.state.specTree?.nodes.find(node => node.id === record.state.specTree?.rootNodeId)
          ?.title ??
        record.state.documents[0]?.title ??
        record.input,
      nodes:
        record.state.specTree?.nodes.map(node => ({
          id: node.id,
          title: node.title,
          type: node.type,
          status: node.status,
        })) ??
        record.state.documents.map(document => ({
          id: document.nodeId,
          title: document.title,
          type: document.type,
        })),
    },
    specDocument,
    imagePrompts: buildImagePromptPayload(
      record.state.effectPreviews,
      record.state.documents,
    ),
  };
}

function appendEvent(
  record: SkillSessionRecord,
  event: Omit<SkillAgentStreamEvent, "sequence" | "timestamp">,
): void {
  record.events.push({
    sequence: record.events.length + 1,
    timestamp: nowIso(),
    ...event,
  });
}

function refreshProjection(record: SkillSessionRecord): void {
  record.snapshot = buildSnapshot(record);
}

function createInitialRecord(sessionId: string, input: string): SkillSessionRecord {
  return {
    sessionId,
    input,
    status: "running",
    snapshot: {
      stage: "intake",
      summary: "会话已创建。",
      waitingForUser: false,
      agents: [],
    },
    decision: null,
    events: [],
    result: null,
    clarifications: [],
    state: buildEmptyState(),
  };
}

async function safelyGenerateEffectPreviews(
  client: SkillBlueprintClient,
  jobId: string,
): Promise<BlueprintEffectPreviewsResponse | null> {
  try {
    return await client.generateEffectPreviews(jobId, { includeDrafts: true });
  } catch {
    return null;
  }
}

async function continueFromApprovedSpecTree(
  record: SkillSessionRecord,
  client: SkillBlueprintClient,
): Promise<void> {
  if (!record.state.job) {
    throw new SkillSessionOperationError(409, {
      code: "STATE_CONFLICT",
      message: "spec tree review is not ready yet",
    }, record.sessionId);
  }

  const documentResponse = await client.generateSpecDocuments(record.state.job.id, {});
  record.state.job = documentResponse.job;
  record.state.documents = documentResponse.documents;

  const previewResponse = await safelyGenerateEffectPreviews(client, record.state.job.id);
  if (previewResponse) {
    record.state.job = previewResponse.job;
    record.state.effectPreviews = previewResponse.effectPreviews;
  }

  const promptPackageResponse = await client.generatePromptPackages(record.state.job.id, {
    targetPlatforms: ["trae"],
    includeDrafts: true,
    includePreviewDrafts: true,
  });
  record.state.job = promptPackageResponse.job;
  record.state.promptPackages = promptPackageResponse.promptPackages;
  record.decision = null;
  record.status = "completed";
  record.result = buildResultPackage(record);
  refreshProjection(record);
  appendEvent(record, {
    type: "agent_status",
    stage: "spec_documents",
    agent: {
      id: "architect",
      name: "架构师",
      role: "architect",
      status: "completed",
    },
    summary: `已生成 ${record.state.documents.length} 份规格文档。`,
    waitingForUser: false,
  });
  appendEvent(record, {
    type: "agent_status",
    stage: "completed",
    agent: {
      id: "packager",
      name: "打包器",
      role: "packager",
      status: "completed",
    },
    summary: "完整产物包已生成。",
    waitingForUser: false,
  });
}

export function createBlueprintBackedSkillSessionStore(deps: {
  client: SkillBlueprintClient;
}): SkillSessionStore {
  const sessions = new Map<string, SkillSessionRecord>();

  return {
    async start(input: string): Promise<SkillSessionRecord> {
      const sessionId = `skill_sess_${randomUUID()}`;
      const record = createInitialRecord(sessionId, input);

      const intakeResponse = await deps.client.createIntake({ targetText: input });
      record.state.intake = intakeResponse.intake;

      const clarificationResponse = await deps.client.createClarificationSession(
        intakeResponse.intake.id,
      );
      record.state.clarificationSession = clarificationResponse.session;

      const pendingQuestion = pickPendingQuestion(clarificationResponse.session);
      record.decision = pendingQuestion
        ? buildClarificationDecision(pendingQuestion)
        : null;
      refreshProjection(record);
      appendEvent(record, {
        type: "agent_status",
        stage: record.snapshot.stage,
        agent: {
          id: "clarifier",
          name: "澄清师",
          role: "clarifier",
          status: record.decision ? "working" : "completed",
        },
        summary: "已基于真实 intake 创建澄清会话。",
        waitingForUser: false,
      });
      if (record.decision) {
        appendEvent(record, {
          type: "decision_required",
          stage: record.snapshot.stage,
          agent: {
            id: "clarifier",
            name: "澄清师",
            role: "clarifier",
            status: "blocked",
          },
          summary: record.snapshot.summary,
          waitingForUser: true,
        });
      }

      sessions.set(sessionId, record);
      return record;
    },

    get(sessionId: string): SkillSessionRecord | null {
      return sessions.get(sessionId) ?? null;
    },

    async respond(
      sessionId: string,
      stepId: string,
      selected: string,
    ): Promise<SkillSessionRecord> {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new SkillSessionOperationError(404, {
          code: "SESSION_NOT_FOUND",
          message: "session does not exist or has expired",
        }, sessionId);
      }

      if (!record.decision || record.decision.stepId !== stepId) {
        throw new SkillSessionOperationError(409, {
          code: "STATE_CONFLICT",
          message: "session is not waiting for the provided stepId",
        }, sessionId);
      }

      if (stepId === "route-selection") {
        if (!record.state.job || !record.state.routeSet) {
          throw new SkillSessionOperationError(409, {
            code: "STATE_CONFLICT",
            message: "route selection is not ready yet",
          }, sessionId);
        }

        const selectionResponse = await deps.client.selectRoute(record.state.job.id, {
          routeId: selected,
          selectedBy: "skill-session",
        });
        record.state.job = selectionResponse.job;
        record.state.routeSet = selectionResponse.routeSet;
        record.state.selection = selectionResponse.selection;
        record.state.specTree = selectionResponse.specTree;
        record.decision = buildSpecTreeReviewDecision(selectionResponse.specTree);
        record.status = "waiting_for_user";
        record.result = null;
        refreshProjection(record);
        appendEvent(record, {
          type: "agent_status",
          stage: "spec_tree",
          agent: {
            id: "architect",
            name: "架构师",
            role: "architect",
            status: "working",
          },
          summary: "已生成 SPEC Tree，等待用户审阅。",
          waitingForUser: false,
        });
        appendEvent(record, {
          type: "decision_required",
          stage: "spec_tree",
          agent: {
            id: "architect",
            name: "架构师",
            role: "architect",
            status: "blocked",
          },
          summary: record.snapshot.summary,
          waitingForUser: true,
        });

        return record;
      }

      if (stepId === "review-spec-tree") {
        if (!record.state.specTree) {
          throw new SkillSessionOperationError(409, {
            code: "STATE_CONFLICT",
            message: "spec tree review is not ready yet",
          }, sessionId);
        }

        if (selected === "need-adjustment") {
          record.status = "waiting_for_user";
          record.result = null;
          refreshProjection(record);
          appendEvent(record, {
            type: "decision_required",
            stage: "spec_tree",
            agent: {
              id: "architect",
              name: "架构师",
              role: "architect",
              status: "blocked",
            },
            summary: "当前 Skill facade 还未接入 SPEC Tree 在线调整，审阅保持打开。",
            waitingForUser: true,
          });
          return record;
        }

        if (selected !== "confirm") {
          throw new SkillSessionOperationError(400, {
            code: "INVALID_ANSWER",
            message: "review-spec-tree only accepts confirm or need-adjustment",
          }, sessionId);
        }

        await continueFromApprovedSpecTree(record, deps.client);
        return record;
      }

      const clarificationSession = record.state.clarificationSession;
      if (!clarificationSession) {
        throw new SkillSessionOperationError(409, {
          code: "STATE_CONFLICT",
          message: "clarification session is not ready",
        }, sessionId);
      }

      const answerResponse = await deps.client.answerClarification(
        clarificationSession.id,
        [
          {
            questionId: stepId,
            answer: selected,
            source: "user",
          },
        ],
      );
      record.state.clarificationSession = answerResponse.session;
      record.clarifications.push({ stepId, answer: selected });

      const nextQuestion = pickPendingQuestion(answerResponse.session);
      if (nextQuestion) {
        record.decision = buildClarificationDecision(nextQuestion);
        record.status = "waiting_for_user";
        record.result = null;
        refreshProjection(record);
        appendEvent(record, {
          type: "decision_required",
          stage: record.snapshot.stage,
          agent: {
            id: "clarifier",
            name: "澄清师",
            role: "clarifier",
            status: "blocked",
          },
          summary: record.snapshot.summary,
          waitingForUser: true,
        });
        return record;
      }

      const generationResponse = await deps.client.createGenerationJob({
        intakeId: record.state.intake?.id,
        clarificationSessionId: answerResponse.session.id,
        targetText: record.input,
      });
      record.state.job = generationResponse.job;
      record.state.routeSet = generationResponse.routeSet ?? null;
      record.decision = generationResponse.routeSet
        ? buildRouteSelectionDecision(generationResponse.routeSet)
        : null;
      record.status = record.decision ? "waiting_for_user" : "running";
      record.result = null;
      refreshProjection(record);
      appendEvent(record, {
        type: "agent_status",
        stage: "route_selection",
        agent: {
          id: "planner",
          name: "规划师",
          role: "planner",
          status: record.decision ? "working" : "completed",
        },
        summary: "已通过真实 blueprint job 生成候选路线。",
        waitingForUser: false,
      });
      if (record.decision) {
        appendEvent(record, {
          type: "decision_required",
          stage: "route_selection",
          agent: {
            id: "planner",
            name: "规划师",
            role: "planner",
            status: "blocked",
          },
          summary: record.snapshot.summary,
          waitingForUser: true,
        });
      }

      return record;
    },
  };
}

function successEnvelope(record: SkillSessionRecord): SkillEnvelope {
  return {
    ok: true,
    sessionId: record.sessionId,
    status: record.status,
    snapshot: record.snapshot,
    decision: record.decision,
    result: record.result,
    error: null,
  };
}

function errorEnvelope(
  status: SkillSessionStatus,
  error: SkillSessionError,
  sessionId: string | null = null,
): SkillEnvelope {
  return {
    ok: false,
    sessionId,
    status,
    snapshot: null,
    decision: null,
    result: null,
    error,
  };
}

function agentStreamErrorEnvelope(error: SkillSessionError): SkillAgentStreamEnvelope {
  return {
    ok: false,
    sessionId: null,
    cursor: 0,
    events: [],
    error,
  };
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failure and fall back to status text.
  }

  return response.statusText || `HTTP ${response.status}`;
}

async function postJson<TResponse>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<TResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  return (await response.json()) as TResponse;
}

export function createBlueprintHttpClient(deps: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): SkillBlueprintClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl.replace(/\/$/, "");
  const blueprintBase = `${baseUrl}/api/blueprint`;

  return {
    createIntake(request) {
      return postJson<{ intake: BlueprintIntake }>(
        fetchImpl,
        `${blueprintBase}/intake`,
        request,
      );
    },
    createClarificationSession(intakeId) {
      return postJson<{ session: BlueprintClarificationSession }>(
        fetchImpl,
        `${blueprintBase}/intake/${intakeId}/clarifications`,
        {},
      );
    },
    answerClarification(sessionId, answers) {
      return postJson<{ session: BlueprintClarificationSession }>(
        fetchImpl,
        `${blueprintBase}/clarifications/${sessionId}/answers`,
        { answers },
      );
    },
    createGenerationJob(request) {
      return postJson<BlueprintCreateGenerationJobResponse>(
        fetchImpl,
        `${blueprintBase}/jobs`,
        request,
      );
    },
    selectRoute(jobId, request) {
      return postJson<BlueprintSelectRouteResponse>(
        fetchImpl,
        `${blueprintBase}/jobs/${jobId}/route-selection`,
        request,
      );
    },
    generateSpecDocuments(jobId, request = {}) {
      return postJson<BlueprintSpecDocumentsResponse>(
        fetchImpl,
        `${blueprintBase}/jobs/${jobId}/spec-documents`,
        request,
      );
    },
    generateEffectPreviews(jobId, request = { includeDrafts: true }) {
      return postJson<BlueprintEffectPreviewsResponse>(
        fetchImpl,
        `${blueprintBase}/jobs/${jobId}/effect-previews`,
        request,
      );
    },
    generatePromptPackages(
      jobId,
      request = {
        targetPlatforms: ["trae"],
        includeDrafts: true,
        includePreviewDrafts: true,
      },
    ) {
      return postJson<BlueprintImplementationPromptPackagesResponse>(
        fetchImpl,
        `${blueprintBase}/jobs/${jobId}/prompt-packages`,
        request,
      );
    },
  };
}

export function createSkillSessionRouter(deps: { store: SkillSessionStore }) {
  const router = express.Router();

  router.post("/start", async (request, response) => {
    const input =
      typeof request.body?.input === "string" ? request.body.input.trim() : "";
    if (!input) {
      response.status(400).json(
        errorEnvelope("failed", {
          code: "INVALID_INPUT",
          message: "input is required",
        }),
      );
      return;
    }

    try {
      const record = await deps.store.start(input);
      response.json(successEnvelope(record));
    } catch (error) {
      const detail = isOperationError(error)
        ? error.detail
        : {
            code: "RUNTIME_FAILURE" as const,
            message: error instanceof Error ? error.message : String(error),
          };
      const statusCode = isOperationError(error) ? error.statusCode : 500;
      const sessionId = isOperationError(error) ? error.sessionId : null;
      response.status(statusCode).json(errorEnvelope("failed", detail, sessionId));
    }
  });

  router.get("/:id/snapshot", (request, response) => {
    const record = deps.store.get(request.params.id);
    if (!record) {
      response.status(404).json(
        errorEnvelope("failed", {
          code: "SESSION_NOT_FOUND",
          message: "session does not exist or has expired",
        }),
      );
      return;
    }

    response.json(successEnvelope(record));
  });

  router.get("/:id/agent-stream", (request, response) => {
    const record = deps.store.get(request.params.id);
    if (!record) {
      response.status(404).json(
        agentStreamErrorEnvelope({
          code: "SESSION_NOT_FOUND",
          message: "session does not exist or has expired",
        }),
      );
      return;
    }

    response.json({
      ok: true,
      sessionId: record.sessionId,
      cursor: record.events.length,
      events: record.events,
      error: null,
    } satisfies SkillAgentStreamEnvelope);
  });

  router.post("/respond", async (request, response) => {
    const sessionId =
      typeof request.body?.sessionId === "string" ? request.body.sessionId : "";
    const stepId =
      typeof request.body?.stepId === "string" ? request.body.stepId : "";
    const selected =
      typeof request.body?.answer?.selected === "string"
        ? request.body.answer.selected.trim()
        : "";

    if (!sessionId || !stepId || !selected) {
      response.status(400).json(
        errorEnvelope(
          "failed",
          {
            code: "INVALID_ANSWER",
            message: "sessionId, stepId, and answer.selected are required",
          },
          sessionId || null,
        ),
      );
      return;
    }

    try {
      const record = await deps.store.respond(sessionId, stepId, selected);
      response.json(successEnvelope(record));
    } catch (error) {
      const detail = isOperationError(error)
        ? error.detail
        : {
            code: "RUNTIME_FAILURE" as const,
            message: error instanceof Error ? error.message : String(error),
          };
      const statusCode = isOperationError(error) ? error.statusCode : 500;
      const errorSessionId = isOperationError(error) ? error.sessionId : sessionId;
      response
        .status(statusCode)
        .json(errorEnvelope("failed", detail, errorSessionId));
    }
  });

  return router;
}
