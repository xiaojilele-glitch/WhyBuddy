import { fetchJsonSafe, type ApiRequestError } from "./api-client";
import type {
  BlueprintCreateGenerationJobResponse,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityEvidenceKind,
  BlueprintCapabilityEvidenceResponse,
  BlueprintCapabilityEvidenceStatus,
  BlueprintCapabilityInvocation,
  BlueprintCapabilityInvocationRequest,
  BlueprintCapabilityInvocationStatus,
  BlueprintCapabilityInvocationsResponse,
  BlueprintCapabilityRegistryResponse,
  BlueprintCapabilitySafetyGate,
  BlueprintCapabilitySafetyGateStatus,
  BlueprintAgentCrew,
  BlueprintAgentRole,
  BlueprintCapabilityBinding,
  BlueprintClarificationAnswer,
  BlueprintClarificationReadinessSignalId,
  BlueprintClarificationRouteDimension,
  BlueprintClarificationSession,
  BlueprintClarificationStrategyId,
  BlueprintEffectPreview,
  BlueprintEffectPreviewMilestone,
  BlueprintEffectPreviewsResponse,
  BlueprintFetchCapabilityEvidenceRequest,
  BlueprintFetchCapabilityInvocationsRequest,
  BlueprintGenerationRequest,
  BlueprintGenerationEventsResponse,
  BlueprintGenerateEffectPreviewsRequest,
  BlueprintGenerateImplementationPromptPackagesRequest,
  BlueprintGenerateSpecDocumentsRequest,
  BlueprintInvokeCapabilityResponse,
  BlueprintImplementationPromptItem,
  BlueprintImplementationPromptSectionKind,
  BlueprintImplementationPromptTarget,
  BlueprintImplementationPromptTargetPlatform,
  BlueprintIntake,
  BlueprintIntakeRequest,
  BlueprintLatestGenerationJobResponse,
  BlueprintProjectDomainContext,
  BlueprintResetRouteSelectionResponse,
  BlueprintRouteSelectionRequest,
  BlueprintReviewSpecDocumentRequest,
  BlueprintReviewSpecDocumentResponse,
  BlueprintSaveSpecDocumentVersionResponse,
  BlueprintSelectRouteResponse,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentsResponse,
  BlueprintSaveSpecTreeVersionResponse,
  BlueprintGenerationJob,
  BlueprintSpecTree,
  BlueprintSpecTreeActionRequest,
  BlueprintSpecTreeActionResponse,
  BlueprintUpdateSpecTreeNodeRequest,
  BlueprintUpdateSpecTreeNodeResponse,
  BlueprintGithubSource,
  BlueprintRuntimeCapability,
  BlueprintRuntimeCapabilityKind,
  BlueprintRuntimeCapabilitySecurityLevel,
  BlueprintRuntimeCapabilityStatus,
  BlueprintRolePresenceState,
  BlueprintRoleTimelineEntry,
} from "@shared/blueprint/contracts";

export type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintSpecTreeActionRequest,
  BlueprintSpecTreeActionResponse,
  BlueprintRuntimeCapability,
} from "@shared/blueprint/contracts";

export type BlueprintEffectPreviewRuntimeProjection =
  BlueprintEffectPreview["runtimeProjection"];
export type BlueprintEffectPreviewHudState =
  BlueprintEffectPreviewRuntimeProjection["hudState"];
export type BlueprintEffectPreviewLogEntry =
  BlueprintEffectPreviewRuntimeProjection["logTimeline"][number];
export type BlueprintEffectPreviewBrowserPreview =
  BlueprintEffectPreviewRuntimeProjection["browserPreview"];

export interface BlueprintEffectPreviewRuntimeProjectionContext {
  previewId?: string;
  jobId?: string;
  projectId?: string;
  routeSetId?: string;
  routeId?: string;
  treeId?: string;
  nodeId?: string;
  title?: string;
  summary?: string;
  status?: BlueprintEffectPreview["status"];
}

export interface BlueprintEffectPreviewNodeProgressSnapshot {
  nodeId?: string;
  status?: string;
  completion?: number;
  completionPercent?: number;
  dependencyIds?: string[];
  outputIds?: string[];
  updatedFromTreeVersion?: BlueprintEffectPreviewVersionValue;
}

export type BlueprintEffectPreviewVersionValue = number | string;

type BlueprintEffectPreviewVersionSnapshotFields =
  | "version"
  | "versionStatus"
  | "supersedesPreviewId"
  | "previousPreviewIds"
  | "preservedPreviewIds"
  | "refreshedFromSpecTreeVersion"
  | "refreshedAt"
  | "sourceSnapshotHash"
  | "nodeProgress"
  | "dependencyOrder"
  | "versionSync";

export type BlueprintEffectPreviewSnapshot = Omit<
  BlueprintEffectPreview,
  BlueprintEffectPreviewVersionSnapshotFields
> & {
  version?: BlueprintEffectPreviewVersionValue;
  supersedesPreviewId?: string;
  versionStatus?: string;
  refreshedFromSpecTreeVersion?: BlueprintEffectPreviewVersionValue;
  refreshedAt?: string;
  nodeProgress?: BlueprintEffectPreviewNodeProgressSnapshot;
  dependencyOrder?: string[];
  previousPreviewIds?: string[];
  preservedPreviewIds?: string[];
  sourceSnapshotHash?: string;
};

export interface BlueprintEffectPreviewsSnapshotResponse
  extends Omit<BlueprintEffectPreviewsResponse, "effectPreviews"> {
  effectPreviews: BlueprintEffectPreviewSnapshot[];
}

export const BLUEPRINT_SPECS_ENDPOINT = "/api/blueprint/specs";
export const BLUEPRINT_JOBS_ENDPOINT = "/api/blueprint/jobs";
export const BLUEPRINT_GENERATIONS_ENDPOINT = "/api/blueprint/generations";
export const BLUEPRINT_CAPABILITIES_ENDPOINT = "/api/blueprint/capabilities";
export const BLUEPRINT_INTAKE_ENDPOINT = "/api/blueprint/intake";
export const BLUEPRINT_PROJECTS_ENDPOINT = "/api/blueprint/projects";

export interface BlueprintDocumentProgress {
  requirements: boolean;
  design: boolean;
  tasks: boolean;
  completed: number;
  total: number;
  missing: string[];
}

export interface BlueprintTaskProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface BlueprintSpecProgress {
  id: string;
  phase: string;
  order: number;
  title: string;
  summary: string;
  docs: BlueprintDocumentProgress;
  tasks: BlueprintTaskProgress;
}

export interface BlueprintSpecsProgress {
  generatedAt: string;
  root: string;
  totalSpecs: number;
  totalDocs: number;
  completedTasks: number;
  totalTasks: number;
  specs: BlueprintSpecProgress[];
}

export type FetchBlueprintSpecsResult =
  | { ok: true; data: BlueprintSpecsProgress }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintJobEventsResult =
  | { ok: true; data: BlueprintGenerationEventsResponse }
  | { ok: false; error: ApiRequestError };

export interface BlueprintClarificationStrategyMetadata {
  strategyId?: BlueprintClarificationStrategyId;
  strategyLabel?: string;
  templateId?: string;
  routeDimension?: BlueprintClarificationRouteDimension;
  readinessSignal?: BlueprintClarificationReadinessSignalId;
  settledByStrategy?: boolean;
  answerProvenance?: unknown;
  routeReadySummary?: string;
}

export type BlueprintClarificationStrategyQuestion =
  BlueprintClarificationSession["questions"][number] &
    BlueprintClarificationStrategyMetadata;

export type BlueprintClarificationStrategyAnswer =
  BlueprintClarificationSession["answers"][number] &
    BlueprintClarificationStrategyMetadata;

export type BlueprintClarificationStrategyReadiness =
  BlueprintClarificationSession["readiness"] &
    Pick<
      BlueprintClarificationStrategyMetadata,
      "readinessSignal" | "routeReadySummary"
    >;

export interface BlueprintClarificationStrategySession
  extends Omit<
      BlueprintClarificationSession,
      "questions" | "answers" | "readiness"
    >,
    BlueprintClarificationStrategyMetadata {
  questions: BlueprintClarificationStrategyQuestion[];
  answers: BlueprintClarificationStrategyAnswer[];
  readiness: BlueprintClarificationStrategyReadiness;
}

export interface BlueprintCreateGenerationJobSnapshotResponse
  extends Omit<
    BlueprintCreateGenerationJobResponse,
    "intake" | "clarificationSession" | "projectContext"
  > {
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationStrategySession;
  projectContext?: BlueprintProjectDomainContext;
}

export type BlueprintGenerationJobResult =
  | { ok: true; data: BlueprintCreateGenerationJobSnapshotResponse }
  | { ok: false; error: ApiRequestError };

export interface BlueprintIntakeResponse {
  intake: BlueprintIntake;
  clarificationSession?: BlueprintClarificationStrategySession;
  projectContext?: BlueprintProjectDomainContext;
}

export interface BlueprintIntakesResponse {
  intakes: BlueprintIntake[];
  projectContext?: BlueprintProjectDomainContext;
}

export interface BlueprintClarificationSessionResponse {
  intake?: BlueprintIntake;
  clarificationSession: BlueprintClarificationStrategySession;
  projectContext?: BlueprintProjectDomainContext;
}

export interface BlueprintClarificationAnswersRequest {
  answers: BlueprintClarificationAnswer[];
  answeredBy?: string;
}

export interface BlueprintProjectContextResponse {
  projectContext: BlueprintProjectDomainContext;
}

export type CreateBlueprintIntakeResult =
  | { ok: true; data: BlueprintIntakeResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintIntakesResult =
  | { ok: true; data: BlueprintIntakesResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintIntakeResult =
  | { ok: true; data: BlueprintIntakeResponse }
  | { ok: false; error: ApiRequestError };

export type CreateBlueprintClarificationSessionResult =
  | { ok: true; data: BlueprintClarificationSessionResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintClarificationSessionResult =
  | { ok: true; data: BlueprintClarificationSessionResponse }
  | { ok: false; error: ApiRequestError };

export type SaveBlueprintClarificationAnswersResult =
  | { ok: true; data: BlueprintClarificationSessionResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintProjectContextResult =
  | { ok: true; data: BlueprintProjectContextResponse }
  | { ok: false; error: ApiRequestError };

export type SelectBlueprintRouteResult =
  | { ok: true; data: BlueprintSelectRouteResponse }
  | { ok: false; error: ApiRequestError };

export type ResetBlueprintRouteSelectionResult =
  | { ok: true; data: BlueprintResetRouteSelectionResponse }
  | { ok: false; error: ApiRequestError };

export type UpdateBlueprintSpecTreeNodeResult =
  | { ok: true; data: BlueprintUpdateSpecTreeNodeResponse }
  | { ok: false; error: ApiRequestError };

export type SaveBlueprintSpecTreeVersionResult =
  | { ok: true; data: BlueprintSaveSpecTreeVersionResponse }
  | { ok: false; error: ApiRequestError };

export type RunBlueprintSpecTreeActionResult =
  | { ok: true; data: BlueprintSpecTreeActionResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintSpecDocumentsResult =
  | { ok: true; data: BlueprintSpecDocumentsResponse }
  | { ok: false; error: ApiRequestError };

export type GenerateBlueprintSpecDocumentsResult =
  | { ok: true; data: BlueprintSpecDocumentsResponse }
  | { ok: false; error: ApiRequestError };

export type BlueprintSpecDocumentReviewDecision = Extract<
  BlueprintSpecDocumentStatus,
  "accepted" | "rejected" | "reviewing"
>;

export interface BlueprintSaveSpecDocumentVersionRequest {
  savedBy?: string;
  reviewNote?: string;
}

export type ReviewBlueprintSpecDocumentResult =
  | { ok: true; data: BlueprintReviewSpecDocumentResponse }
  | { ok: false; error: ApiRequestError };

export type SaveBlueprintSpecDocumentVersionResult =
  | { ok: true; data: BlueprintSaveSpecDocumentVersionResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintEffectPreviewsResult =
  | { ok: true; data: BlueprintEffectPreviewsSnapshotResponse }
  | { ok: false; error: ApiRequestError };

export type GenerateBlueprintEffectPreviewResult =
  | { ok: true; data: BlueprintEffectPreviewsSnapshotResponse }
  | { ok: false; error: ApiRequestError };

export type BlueprintPromptTargetPlatform =
  BlueprintImplementationPromptTargetPlatform;

export interface BlueprintPromptPackageSection {
  id: string;
  kind?: BlueprintImplementationPromptSectionKind;
  title: string;
  content: string;
  summary?: string;
  items?: BlueprintImplementationPromptItem[];
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}

export interface BlueprintPromptPackage {
  id: string;
  jobId: string;
  treeId: string;
  nodeIds: string[];
  targetPlatform: BlueprintPromptTargetPlatform;
  target: BlueprintImplementationPromptTarget;
  title: string;
  summary: string;
  content: string;
  sections: BlueprintPromptPackageSection[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  createdAt: string;
  updatedAt?: string;
  provenance?: Record<string, unknown>;
  nodeId?: string;
  previewId?: string;
  platform?: BlueprintPromptTargetPlatform;
  status?: string;
}

export interface BlueprintPromptPackagesResponse {
  job?: BlueprintGenerationJob | null;
  specTree?: BlueprintSpecTree | null;
  promptPackages: BlueprintPromptPackage[];
}

export type BlueprintGeneratePromptPackagesRequest =
  BlueprintGenerateImplementationPromptPackagesRequest;

export interface BlueprintEngineeringVerificationCommand {
  id: string;
  title: string;
  command: string;
  summary?: string;
  expected?: string;
  platform?: BlueprintPromptTargetPlatform;
}

export interface BlueprintEngineeringPlatformHandoff {
  id: string;
  platform: BlueprintPromptTargetPlatform;
  label: string;
  summary: string;
  content?: string;
  promptPackageId?: string;
  sourcePromptPackageIds: string[];
  nodeIds: string[];
  instructions: string[];
}

export interface BlueprintEngineeringLandingStep {
  id: string;
  title: string;
  summary: string;
  status?: string;
  owner?: string;
  target?: string;
  commands: string[];
  sourcePromptPackageIds: string[];
  sourceNodeIds?: string[];
  sourceDocumentIds?: string[];
  sourcePreviewIds?: string[];
  fileScopes?: string[];
  riskLevel?: string;
}

export interface BlueprintEngineeringLandingPlan {
  id: string;
  jobId: string;
  treeId: string;
  promptPackageId?: string;
  sourcePromptPackageIds: string[];
  platform: BlueprintPromptTargetPlatform;
  title: string;
  summary: string;
  status: string;
  handoffs: BlueprintEngineeringPlatformHandoff[];
  steps: BlueprintEngineeringLandingStep[];
  verificationCommands: BlueprintEngineeringVerificationCommand[];
  changedFiles: string[];
  createdAt: string;
  updatedAt?: string;
  provenance?: Record<string, unknown>;
}

export type BlueprintEngineeringRunStatus =
  | "planned"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "completed"
  | "skipped"
  | "unknown";

export interface BlueprintEngineeringVerificationResult {
  id: string;
  title: string;
  command: string;
  status: string;
  summary?: string;
  output?: string;
}

export interface BlueprintEngineeringRun {
  id: string;
  jobId: string;
  landingPlanId: string;
  status: BlueprintEngineeringRunStatus;
  summary: string;
  logs: string[];
  verificationResults: BlueprintEngineeringVerificationResult[];
  changedFiles: string[];
  createdAt: string;
  updatedAt?: string;
  recordedAt?: string;
  provenance?: Record<string, unknown>;
}

export interface BlueprintEngineeringLandingResponse {
  job?: BlueprintGenerationJob | null;
  specTree?: BlueprintSpecTree | null;
  landingPlans: BlueprintEngineeringLandingPlan[];
}

export interface BlueprintEngineeringRunsResponse {
  job?: BlueprintGenerationJob | null;
  landingPlan?: BlueprintEngineeringLandingPlan | null;
  engineeringLandingPlans?: BlueprintEngineeringLandingPlan[];
  engineeringRuns: BlueprintEngineeringRun[];
}

export interface BlueprintCreateEngineeringRunResponse {
  job?: BlueprintGenerationJob | null;
  landingPlan?: BlueprintEngineeringLandingPlan | null;
  engineeringRun: BlueprintEngineeringRun;
}

export interface BlueprintGenerateEngineeringLandingRequest {
  promptPackageId?: string;
  platform?: BlueprintPromptTargetPlatform;
}

export interface BlueprintCreateEngineeringRunRequest {
  landingPlanId: string;
  status: BlueprintEngineeringRunStatus;
  summary: string;
  logs?: string[];
  verificationResults?:
    | string[]
    | Array<Partial<BlueprintEngineeringVerificationResult>>;
  changedFiles?: string[];
}

export interface BlueprintArtifactLineageEdge {
  id: string;
  sourceEntryId: string;
  targetEntryId: string;
  kind: string;
  summary?: string;
}

export interface BlueprintArtifactLedgerEntry {
  id: string;
  jobId: string;
  artifactId?: string;
  artifactType: string;
  stage: string;
  title: string;
  summary: string;
  status: string;
  version?: number;
  sourceEntryIds: string[];
  sourceArtifactIds: string[];
  targetEntryIds: string[];
  lineageEdges: BlueprintArtifactLineageEdge[];
  lineageEdgeCount: number;
  createdAt: string;
  updatedAt?: string;
  recordedAt?: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface BlueprintArtifactReplaySnapshot {
  id: string;
  entryId?: string;
  artifactType: string;
  stage: string;
  title: string;
  summary: string;
  status: string;
  createdAt?: string;
  lineageEdgeCount: number;
}

export interface BlueprintArtifactReplay {
  id: string;
  jobId: string;
  entryId?: string;
  stage?: string;
  title: string;
  summary: string;
  status: string;
  snapshots: BlueprintArtifactReplaySnapshot[];
  lineageEdges: BlueprintArtifactLineageEdge[];
  lineageEdgeCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface BlueprintArtifactDiffChange {
  id: string;
  kind: string;
  path: string;
  title: string;
  summary: string;
  before?: string;
  after?: string;
}

export interface BlueprintArtifactDiff {
  id: string;
  jobId: string;
  leftEntryId: string;
  rightEntryId: string;
  title: string;
  summary: string;
  status: string;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  changes: BlueprintArtifactDiffChange[];
  createdAt?: string;
}

export interface BlueprintArtifactFeedback {
  id: string;
  jobId: string;
  entryId: string;
  sentiment: string;
  status: string;
  summary: string;
  notes: string;
  backfillTargets: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface BlueprintArtifactLedgerResponse {
  job?: BlueprintGenerationJob | null;
  entries: BlueprintArtifactLedgerEntry[];
}

export interface BlueprintArtifactReplayResponse {
  job?: BlueprintGenerationJob | null;
  replay: BlueprintArtifactReplay;
}

export interface BlueprintArtifactReplaysResponse {
  job?: BlueprintGenerationJob | null;
  replays: BlueprintArtifactReplay[];
}

export interface BlueprintArtifactDiffResponse {
  job?: BlueprintGenerationJob | null;
  diff: BlueprintArtifactDiff;
}

export interface BlueprintArtifactFeedbackResponse {
  job?: BlueprintGenerationJob | null;
  feedback: BlueprintArtifactFeedback;
}

export interface BlueprintReplayArtifactRequest {
  entryId?: string;
  stage?: string;
}

export interface BlueprintDiffArtifactsRequest {
  leftEntryId: string;
  rightEntryId: string;
}

export interface BlueprintRecordArtifactFeedbackRequest {
  entryId: string;
  sentiment?: string;
  status?: string;
  summary: string;
  notes?: string;
}

export type BlueprintInvokeRuntimeCapabilityRequest =
  BlueprintCapabilityInvocationRequest;

export interface BlueprintCapabilityRegistrySnapshot {
  capabilities: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrewSnapshot | null;
}

export interface BlueprintJobCapabilitiesResponse {
  job?: BlueprintGenerationJob | null;
  routeSet?: BlueprintCapabilityInvocationsResponse["routeSet"];
  specTree?: BlueprintCapabilityInvocationsResponse["specTree"];
  capabilities: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrewSnapshot | null;
}

export interface BlueprintAgentCrewRoleTimeline {
  id: string;
  jobId: string;
  roleId: string;
  roleName: string;
  displayName: string;
  displayLabel: string;
  group: string;
  stage: string;
  state: BlueprintRolePresenceState;
  currentAction: string;
  capabilityIds: string[];
  capabilityLabels: string[];
  artifactIds: string[];
  evidenceIds: string[];
  latestArtifact?: string;
  latestEvidence?: string;
  latestCapability?: string;
  entryCount: number;
  entries: BlueprintRoleTimelineEntry[];
}

export interface BlueprintAgentCrewSnapshot {
  id: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  stage: string;
  roles: BlueprintAgentRole[];
  capabilityMatrix: BlueprintCapabilityBinding[];
  activationPolicies: BlueprintAgentCrew["activationPolicies"];
  presence: BlueprintAgentCrewRoleTimeline[];
  roleTimelines: BlueprintAgentCrewRoleTimeline[];
  sourceIds: Record<string, unknown>;
}

export interface BlueprintCapabilityInvocationsSnapshotResponse
  extends Omit<BlueprintCapabilityInvocationsResponse, "agentCrew"> {
  agentCrew?: BlueprintAgentCrewSnapshot | null;
}

export interface BlueprintInvokeCapabilitySnapshotResponse
  extends Omit<BlueprintInvokeCapabilityResponse, "agentCrew"> {
  agentCrew?: BlueprintAgentCrewSnapshot | null;
}

export type BlueprintLatestGenerationJobSnapshot = Omit<
  BlueprintLatestGenerationJobResponse,
  | "effectPreviews"
  | "promptPackages"
  | "engineeringLandingPlans"
  | "engineeringRuns"
  | "agentCrew"
  | "roleTimelines"
  | "artifactLedgerEntries"
  | "artifactReplays"
  | "artifactFeedback"
> & {
  effectPreviews?: BlueprintEffectPreviewSnapshot[];
  promptPackages?: BlueprintPromptPackage[];
  capabilities?: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrewSnapshot | null;
  roleTimelines?: BlueprintAgentCrewRoleTimeline[];
  clarificationSession?: BlueprintClarificationStrategySession;
  runtimeProjection?: BlueprintEffectPreviewRuntimeProjection;
  capabilityInvocations?: BlueprintCapabilityInvocation[];
  capabilityEvidence?: BlueprintCapabilityEvidence[];
  landingPlans?: BlueprintEngineeringLandingPlan[];
  engineeringRuns?: BlueprintEngineeringRun[];
  artifactLedgerEntries?: BlueprintArtifactLedgerEntry[];
  artifactReplays?: BlueprintArtifactReplay[];
  artifactFeedback?: BlueprintArtifactFeedback[];
};

export type FetchLatestBlueprintJobResult =
  | { ok: true; data: BlueprintLatestGenerationJobSnapshot }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintPromptPackagesResult =
  | { ok: true; data: BlueprintPromptPackagesResponse }
  | { ok: false; error: ApiRequestError };

export type GenerateBlueprintPromptPackagesResult =
  | { ok: true; data: BlueprintPromptPackagesResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintCapabilitiesResult =
  | { ok: true; data: BlueprintCapabilityRegistrySnapshot }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintJobCapabilitiesResult =
  | { ok: true; data: BlueprintJobCapabilitiesResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintCapabilityInvocationsResult =
  | { ok: true; data: BlueprintCapabilityInvocationsSnapshotResponse }
  | { ok: false; error: ApiRequestError };

export type InvokeBlueprintCapabilityResult =
  | { ok: true; data: BlueprintInvokeCapabilitySnapshotResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintCapabilityEvidenceResult =
  | { ok: true; data: BlueprintCapabilityEvidenceResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintEngineeringLandingResult =
  | { ok: true; data: BlueprintEngineeringLandingResponse }
  | { ok: false; error: ApiRequestError };

export type GenerateBlueprintEngineeringLandingResult =
  | { ok: true; data: BlueprintEngineeringLandingResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintEngineeringRunsResult =
  | { ok: true; data: BlueprintEngineeringRunsResponse }
  | { ok: false; error: ApiRequestError };

export type CreateBlueprintEngineeringRunResult =
  | { ok: true; data: BlueprintCreateEngineeringRunResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintArtifactLedgerResult =
  | { ok: true; data: BlueprintArtifactLedgerResponse }
  | { ok: false; error: ApiRequestError };

export type ReplayBlueprintArtifactResult =
  | { ok: true; data: BlueprintArtifactReplayResponse }
  | { ok: false; error: ApiRequestError };

export type FetchBlueprintArtifactReplaysResult =
  | { ok: true; data: BlueprintArtifactReplaysResponse }
  | { ok: false; error: ApiRequestError };

export type DiffBlueprintArtifactsResult =
  | { ok: true; data: BlueprintArtifactDiffResponse }
  | { ok: false; error: ApiRequestError };

export type RecordBlueprintArtifactFeedbackResult =
  | { ok: true; data: BlueprintArtifactFeedbackResponse }
  | { ok: false; error: ApiRequestError };

type RawBlueprintSpecsResponse = Record<string, unknown> & {
  specs?: unknown;
};

type RawBlueprintSpec = Record<string, unknown>;

const DOC_KEYS = ["requirements", "design", "tasks"] as const;
const CLARIFICATION_STRATEGY_IDS = [
  "target_first",
  "repository_first",
  "risk_first",
  "document_first",
  "preview_first",
  "fast_execution",
] as const satisfies readonly BlueprintClarificationStrategyId[];
const CLARIFICATION_ROUTE_DIMENSIONS = [
  "goal",
  "audience",
  "risk",
  "repository",
  "domain",
  "document",
  "preview",
  "output",
  "execution",
  "handoff",
] as const satisfies readonly BlueprintClarificationRouteDimension[];
const CLARIFICATION_READINESS_SIGNALS = [
  "goal_defined",
  "audience_defined",
  "constraints_defined",
  "repository_context",
  "domain_assets",
  "document_intent",
  "preview_intent",
  "output_preference",
  "risk_review",
  "fast_path",
] as const satisfies readonly BlueprintClarificationReadinessSignalId[];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "complete" ||
      normalized === "done"
    );
  }
  return false;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => asString(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|;/)
      .map(item => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeStringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  const normalized = asString(value).toLowerCase().replace(/[-\s]+/g, "_");
  return allowed.includes(normalized as T) ? (normalized as T) : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readDocumentFlag(
  docs: Record<string, unknown> | null,
  key: (typeof DOC_KEYS)[number]
): boolean {
  if (!docs) return false;

  const direct = docs[key];
  if (typeof direct === "boolean" || typeof direct === "string") {
    return asBoolean(direct);
  }

  const nested = asRecord(direct);
  if (nested) {
    return asBoolean(
      nested.complete ?? nested.completed ?? nested.exists ?? nested.present
    );
  }

  return false;
}

function normalizeDocs(spec: RawBlueprintSpec): BlueprintDocumentProgress {
  const docsValue = spec.docs ?? spec.documents;
  const docsRecord = Array.isArray(docsValue) ? null : asRecord(docsValue);
  const docList: unknown[] | null = Array.isArray(docsValue) ? docsValue : null;

  const flags = DOC_KEYS.reduce<Record<(typeof DOC_KEYS)[number], boolean>>(
    (acc, key) => {
      acc[key] =
        readDocumentFlag(docsRecord, key) ||
        Boolean(docList?.some(item => asString(item).toLowerCase() === key));
      return acc;
    },
    { requirements: false, design: false, tasks: false }
  );

  const total = asNumber(spec.totalDocs, DOC_KEYS.length);
  const completed = asNumber(
    spec.completedDocs,
    DOC_KEYS.filter(key => flags[key]).length
  );
  const missing = DOC_KEYS.filter(key => !flags[key]);

  return {
    ...flags,
    completed,
    total: Math.max(total, completed, 0),
    missing,
  };
}

function normalizeTasks(spec: RawBlueprintSpec): BlueprintTaskProgress {
  const tasksRecord = asRecord(spec.tasks ?? spec.taskProgress);
  const completed = asNumber(
    spec.completedTasks ?? tasksRecord?.completed ?? tasksRecord?.done,
    0
  );
  const total = asNumber(
    spec.totalTasks ?? tasksRecord?.total,
    Array.isArray(spec.tasks) ? spec.tasks.length : 0
  );
  const percent =
    total > 0
      ? (completed / total) * 100
      : asNumber(spec.taskPercent ?? tasksRecord?.percent, 0);

  return {
    completed,
    total: Math.max(total, completed, 0),
    percent: clampPercent(percent),
  };
}

function normalizeSpec(spec: unknown, index: number): BlueprintSpecProgress {
  const record = asRecord(spec) ?? {};
  const slug = asString(
    record.slug ?? record.id ?? record.path,
    `spec-${index + 1}`
  );
  const title = asString(record.title ?? record.name, slug);

  return {
    id: slug,
    phase: asString(record.phase, "Unassigned"),
    order: asNumber(record.order ?? record.priority, index + 1),
    title,
    summary: asString(
      record.summary ?? record.description,
      "No summary available."
    ),
    docs: normalizeDocs(record),
    tasks: normalizeTasks(record),
  };
}

export function normalizeBlueprintSpecsResponse(
  payload: RawBlueprintSpecsResponse
): BlueprintSpecsProgress {
  const rawSpecs = Array.isArray(payload.specs) ? payload.specs : [];
  const specs = rawSpecs
    .map(normalizeSpec)
    .sort(
      (left, right) =>
        left.order - right.order || left.title.localeCompare(right.title)
    );

  const completedTasks = asNumber(
    payload.completedTasks,
    specs.reduce((sum, spec) => sum + spec.tasks.completed, 0)
  );
  const totalTasks = asNumber(
    payload.totalTasks,
    specs.reduce((sum, spec) => sum + spec.tasks.total, 0)
  );

  return {
    generatedAt: asString(payload.generatedAt),
    root: asString(payload.root),
    totalSpecs: asNumber(payload.totalSpecs, specs.length),
    totalDocs: asNumber(
      payload.totalDocs,
      specs.reduce((sum, spec) => sum + spec.docs.completed, 0)
    ),
    completedTasks,
    totalTasks: Math.max(totalTasks, completedTasks, 0),
    specs,
  };
}

function normalizeEffectPreviewPlanStep(
  value: unknown,
  index: number
): BlueprintEffectPreviewMilestone {
  const record = asRecord(value);
  if (!record) {
    const text = asString(value, `Progress step ${index + 1}`);
    return {
      id: `step-${index + 1}`,
      title: text,
      summary: text,
      target: text,
      sourceDocumentIds: [],
    };
  }

  const title = asString(
    record.title ?? record.name ?? record.label,
    `Progress step ${index + 1}`
  );

  return {
    id: asString(record.id ?? record.key, `step-${index + 1}`),
    title,
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      title
    ),
    target: asString(record.target ?? record.outcome, title),
    sourceDocumentIds: asStringArray(
      record.sourceDocumentIds ?? record.source_document_ids
    ),
  };
}

function normalizeEffectPreviewStatus(
  value: unknown
): BlueprintEffectPreview["status"] {
  const normalized = asString(value).toLowerCase();
  return normalized === "completed" ? "completed" : "preview";
}

function normalizeEffectPreviewVersionValue(
  value: unknown
): BlueprintEffectPreviewVersionValue | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value.trim();
  }
  return undefined;
}

function normalizeEffectPreviewNodeProgress(
  value: unknown
): BlueprintEffectPreviewNodeProgressSnapshot | undefined {
  const record = asRecord(value);
  if (!record) {
    const status = asString(value);
    return status ? { status } : undefined;
  }

  const status = asString(record.status ?? record.state);
  const completion = normalizeEffectPreviewVersionValue(
    record.completion ??
      record.completionPercent ??
      record.completion_percent ??
      record.percent ??
      record.progress
  );

  return status || typeof completion !== "undefined"
    ? {
        status: status || undefined,
        completion:
          typeof completion === "number" ? clampPercent(completion) : undefined,
      }
    : undefined;
}

function normalizeBlueprintEffectPreviewLogEntry(
  value: unknown,
  index: number,
  fallbackSourceDocumentIds: string[]
): BlueprintEffectPreviewLogEntry {
  const record = asRecord(value);
  if (!record) {
    const message = asString(value, `Runtime log ${index + 1}`);
    return {
      id: `runtime-log-${index + 1}`,
      level: "info",
      message,
      occurredAt: "",
      sourceDocumentIds: fallbackSourceDocumentIds,
    };
  }

  const normalizedLevel = asString(record.level ?? record.severity).toLowerCase();
  const level: BlueprintEffectPreviewLogEntry["level"] =
    normalizedLevel === "warning" ||
    normalizedLevel === "success" ||
    normalizedLevel === "info"
      ? normalizedLevel
      : "info";

  return {
    id: asString(record.id ?? record.entryId ?? record.entry_id, `runtime-log-${index + 1}`),
    level,
    message: asString(
      record.message ?? record.summary ?? record.detail ?? record.text,
      `Runtime log ${index + 1}`
    ),
    occurredAt: asString(
      record.occurredAt ?? record.occurred_at ?? record.createdAt ?? record.created_at
    ),
    sourceDocumentIds: asStringArray(
      record.sourceDocumentIds ??
        record.source_document_ids ??
        record.documentIds ??
        record.document_ids
    ),
  };
}

export function normalizeBlueprintEffectPreviewRuntimeProjection(
  value: unknown,
  context: BlueprintEffectPreviewRuntimeProjectionContext = {}
): BlueprintEffectPreviewRuntimeProjection {
  const record = asRecord(value) ?? {};
  const sceneRecord = asRecord(record.scene ?? record.sceneSnapshot);
  const hudRecord = asRecord(record.hudState ?? record.hud_state ?? record.hud);
  const logValue =
    record.logTimeline ??
    record.log_timeline ??
    record.logs ??
    record.log ??
    record.timeline;
  const browserRecord = asRecord(
    record.browserPreview ?? record.browser_preview ?? record.browser
  );
  const browserPreviewId = asString(
    record.browserPreviewId ??
      record.browser_preview_id ??
      browserRecord?.id ??
      browserRecord?.previewId ??
      browserRecord?.preview_id
  );
  const sceneSnapshotId = asString(
    record.sceneSnapshotId ??
      record.scene_snapshot_id ??
      sceneRecord?.id ??
      sceneRecord?.snapshotId ??
      sceneRecord?.snapshot_id
  );
  const nodeId = asString(record.nodeId ?? record.node_id, context.nodeId);
  const routeId = asString(record.routeId ?? record.route_id, context.routeId);
  const title = asString(
    hudRecord?.title ?? record.title ?? browserRecord?.title,
    context.title ?? "Runtime projection"
  );
  const summary = asString(
    hudRecord?.summary ??
      record.summary ??
      browserRecord?.summary ??
      sceneRecord?.summary,
    context.summary ?? "Runtime projection is waiting for preview data."
  );
  const fallbackSourceDocumentIds = asStringArray(
    record.sourceDocumentIds ??
      record.source_document_ids ??
      sceneRecord?.sourceDocumentIds ??
      sceneRecord?.source_document_ids
  );
  const logTimeline = asUnknownArray(logValue).map((item, index) =>
    normalizeBlueprintEffectPreviewLogEntry(
      item,
      index,
      fallbackSourceDocumentIds
    )
  );
  const status = normalizeEffectPreviewStatus(
    hudRecord?.status ?? record.status ?? context.status
  );
  const sourceIds = asRecord(record.sourceIds ?? record.source_ids) ?? {};

  return {
    id: asString(
      record.id ?? record.projectionId ?? record.projection_id,
      context.previewId ? `${context.previewId}-runtime-projection` : "runtime-projection"
    ),
    jobId: asString(record.jobId ?? record.job_id, context.jobId),
    projectId:
      asString(record.projectId ?? record.project_id, context.projectId) ||
      undefined,
    routeSetId: asString(record.routeSetId ?? record.route_set_id, context.routeSetId),
    routeId: routeId || undefined,
    specTreeId: asString(
      record.specTreeId ?? record.spec_tree_id ?? record.treeId ?? record.tree_id,
      context.treeId
    ),
    nodeId,
    effectPreviewId: asString(
      record.effectPreviewId ?? record.effect_preview_id ?? record.previewId,
      context.previewId
    ),
    sceneSnapshotId,
    hudState: {
      id: asString(hudRecord?.id ?? hudRecord?.stateId ?? hudRecord?.state_id, "runtime-hud"),
      status,
      stage: "effect_preview",
      title,
      summary,
      progressPercent: clampPercent(
        asNumber(
          hudRecord?.progressPercent ??
            hudRecord?.progress_percent ??
            hudRecord?.progress ??
            record.progressPercent ??
            record.progress_percent,
          0
        )
      ),
      activeNodeId: asString(
        hudRecord?.activeNodeId ?? hudRecord?.active_node_id ?? nodeId,
        nodeId
      ),
      badges: asStringArray(hudRecord?.badges ?? record.badges),
    },
    logTimeline,
    browserPreviewId,
    browserPreview: {
      id: browserPreviewId || "runtime-browser-preview",
      title: asString(browserRecord?.title ?? record.browserTitle, title),
      summary: asString(
        browserRecord?.summary ?? record.browserSummary,
        summary
      ),
      routeId:
        asString(browserRecord?.routeId ?? browserRecord?.route_id, routeId) ||
        undefined,
      nodeId: asString(browserRecord?.nodeId ?? browserRecord?.node_id, nodeId),
      url: asString(
        browserRecord?.url ??
          browserRecord?.href ??
          record.browserPreviewUrl ??
          record.browser_preview_url
      ),
    },
    sourceIds: sourceIds as BlueprintEffectPreviewRuntimeProjection["sourceIds"],
  };
}

export function normalizeBlueprintEffectPreview(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintEffectPreviewSnapshot {
  const record = asRecord(value) ?? {};
  const title = asString(
    record.title ?? record.name,
    `Effect preview ${index + 1}`
  );
  const planValue =
    record.progressPlan ??
    record.progress_plan ??
    record.plan ??
    record.steps ??
    record.tasks;

  const sourceDocumentIds = asStringArray(
    record.sourceDocumentIds ??
      record.source_document_ids ??
      record.documentIds ??
      record.document_ids ??
      record.specDocumentIds
  );
  const id = asString(
    record.id ?? record.previewId ?? record.preview_id,
    `effect-preview-${index + 1}`
  );
  const jobId = asString(record.jobId ?? record.job_id, fallbackJobId);
  const treeId = asString(record.treeId ?? record.tree_id);
  const nodeId = asString(record.nodeId ?? record.node_id);
  const status = normalizeEffectPreviewStatus(record.status);
  const version = normalizeEffectPreviewVersionValue(record.version);
  const refreshedFromSpecTreeVersion = normalizeEffectPreviewVersionValue(
    record.refreshedFromSpecTreeVersion ??
      record.refreshed_from_spec_tree_version ??
      record.specTreeVersion ??
      record.spec_tree_version
  );
  const versionStatus = asString(
    record.versionStatus ?? record.version_status ?? record.status
  );
  const nodeProgress = normalizeEffectPreviewNodeProgress(
    record.nodeProgress ??
      record.node_progress ??
      ((record.nodeStatus ??
        record.node_status ??
        record.nodeCompletion ??
        record.node_completion) !== undefined
        ? {
            status: record.nodeStatus ?? record.node_status,
            completion: record.nodeCompletion ?? record.node_completion,
          }
        : undefined)
  );

  return {
    id,
    jobId,
    treeId,
    nodeId,
    sourceDocumentIds,
    status,
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    summary: asString(record.summary ?? record.description, title),
    architectureNotes: asStringArray(
      record.architectureNotes ??
        record.architecture_notes ??
        record.architecture ??
        record.architectureCues
    ),
    prototypeNotes: asStringArray(
      record.prototypeNotes ??
        record.prototype_notes ??
        record.prototype ??
        record.prototypeCues
    ),
    progressPlan: Array.isArray(planValue)
      ? planValue.map(normalizeEffectPreviewPlanStep)
      : asStringArray(planValue).map((item, stepIndex) =>
          normalizeEffectPreviewPlanStep(item, stepIndex)
        ),
    nodes: Array.isArray(record.nodes)
      ? (record.nodes as BlueprintEffectPreview["nodes"])
      : [],
    runtimeProjection: normalizeBlueprintEffectPreviewRuntimeProjection(
      record.runtimeProjection ?? record.runtime_projection ?? record.projection,
      {
        previewId: id,
        jobId,
        treeId,
        nodeId,
        title,
        summary: asString(record.summary ?? record.description, title),
        status,
      }
    ),
    provenance:
      (record.provenance as BlueprintEffectPreview["provenance"] | undefined) ??
      {
        jobId,
        githubUrls: [],
        treeVersion: asNumber(record.treeVersion ?? record.tree_version, 0),
        nodeType: "effect_preview",
        nodeTitle: title,
        nodeSummary: asString(record.summary ?? record.description, title),
        sourceStatus: "mixed",
        includeDrafts: false,
        sourceDocumentStatuses: {},
      },
    version,
    supersedesPreviewId:
      asString(
        record.supersedesPreviewId ?? record.supersedes_preview_id
      ) || undefined,
    versionStatus: versionStatus || undefined,
    refreshedFromSpecTreeVersion,
    refreshedAt:
      asString(record.refreshedAt ?? record.refreshed_at) || undefined,
    nodeProgress,
    dependencyOrder: asStringArray(
      record.dependencyOrder ?? record.dependency_order
    ),
    previousPreviewIds: asStringArray(
      record.previousPreviewIds ?? record.previous_preview_ids
    ),
    preservedPreviewIds: asStringArray(
      record.preservedPreviewIds ?? record.preserved_preview_ids
    ),
    sourceSnapshotHash:
      asString(record.sourceSnapshotHash ?? record.source_snapshot_hash) ||
      undefined,
  };
}

export function normalizeBlueprintEffectPreviewsResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintEffectPreviewsSnapshotResponse {
  const record = asRecord(payload) ?? {};
  const rawPreviews =
    record.previews ??
    record.effectPreviews ??
    record.effect_previews ??
    record.items ??
    [];
  const effectPreviews = Array.isArray(rawPreviews)
    ? rawPreviews.map((item, index) =>
        normalizeBlueprintEffectPreview(item, index, fallbackJobId)
      )
    : [];

  return {
    job: record.job as BlueprintEffectPreviewsResponse["job"],
    specTree: record.specTree as BlueprintEffectPreviewsResponse["specTree"],
    effectPreviews,
  };
}

const PROMPT_TARGET_PLATFORMS: BlueprintPromptTargetPlatform[] = [
  "cursor",
  "kiro",
  "trae",
  "windsurf",
  "codex",
  "claude",
];

function normalizePromptTargetPlatform(
  value: unknown
): BlueprintPromptTargetPlatform {
  const normalized = asString(value, "cursor")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  return PROMPT_TARGET_PLATFORMS.includes(
    normalized as BlueprintPromptTargetPlatform
  )
    ? (normalized as BlueprintPromptTargetPlatform)
    : "cursor";
}

function normalizePromptSectionKind(
  value: unknown
): BlueprintImplementationPromptSectionKind | undefined {
  const normalized = asString(value).toLowerCase();
  const kinds: BlueprintImplementationPromptSectionKind[] = [
    "context",
    "implementation",
    "constraints",
    "verification",
    "handoff",
  ];
  return kinds.includes(normalized as BlueprintImplementationPromptSectionKind)
    ? (normalized as BlueprintImplementationPromptSectionKind)
    : undefined;
}

function promptTargetLabel(platform: BlueprintPromptTargetPlatform): string {
  if (platform === "kiro") return "Kiro";
  if (platform === "trae") return "Trae";
  if (platform === "windsurf") return "Windsurf";
  if (platform === "codex") return "Codex";
  if (platform === "claude") return "Claude";
  return "Cursor";
}

function normalizePromptTarget(
  value: unknown,
  platform: BlueprintPromptTargetPlatform
): BlueprintImplementationPromptTarget {
  const record = asRecord(value);
  const rawExecutionMode = asString(
    record?.executionMode ?? record?.execution_mode
  );
  const executionMode = (
    rawExecutionMode === "agent" ||
    rawExecutionMode === "chat" ||
    rawExecutionMode === "workspace"
      ? rawExecutionMode
      : platform === "claude"
        ? "chat"
        : platform === "cursor"
          ? "workspace"
          : "agent"
  ) as BlueprintImplementationPromptTarget["executionMode"];

  return {
    platform,
    label: asString(record?.label ?? record?.name, promptTargetLabel(platform)),
    executionMode,
    guidance: asString(
      record?.guidance ?? record?.description,
      "Use this implementation prompt package with the selected coding tool."
    ),
  };
}

function normalizeBlueprintPromptPackageSection(
  value: unknown,
  index: number
): BlueprintPromptPackageSection {
  const record = asRecord(value);
  if (!record) {
    const content = asString(value, "");
    return {
      id: `section-${index + 1}`,
      title: `Section ${index + 1}`,
      content,
      nodeIds: [],
      sourceDocumentIds: [],
      sourcePreviewIds: [],
    };
  }

  const title = asString(
    record.title ?? record.name ?? record.heading,
    `Section ${index + 1}`
  );

  return {
    id: asString(record.id ?? record.key, `section-${index + 1}`),
    kind: normalizePromptSectionKind(record.kind),
    title,
    content: asString(record.content ?? record.body ?? record.prompt, ""),
    summary: asString(record.summary ?? record.description),
    items: Array.isArray(record.items)
      ? (record.items as BlueprintImplementationPromptItem[])
      : [],
    nodeIds: asStringArray(record.nodeIds ?? record.node_ids),
    sourceDocumentIds: asStringArray(
      record.sourceDocumentIds ?? record.source_document_ids
    ),
    sourcePreviewIds: asStringArray(
      record.sourcePreviewIds ??
        record.source_preview_ids ??
        record.effectPreviewIds ??
        record.effect_preview_ids
    ),
  };
}

export function normalizeBlueprintPromptPackage(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintPromptPackage {
  const record = asRecord(value) ?? {};
  const targetRecord = asRecord(record.target);
  const platform = normalizePromptTargetPlatform(
    record.targetPlatform ??
      record.target_platform ??
      targetRecord?.platform ??
      record.platform
  );
  const target = normalizePromptTarget(record.target, platform);
  const sectionsValue =
    record.sections ?? record.promptSections ?? record.prompt_sections ?? [];
  const sections = Array.isArray(sectionsValue)
    ? sectionsValue.map(normalizeBlueprintPromptPackageSection)
    : [];
  const nodeIds = asStringArray(
    record.nodeIds ?? record.node_ids ?? record.nodeId ?? record.node_id
  );
  const sourceDocumentIds = asStringArray(
    record.sourceDocumentIds ?? record.source_document_ids
  );
  const sourcePreviewIds = asStringArray(
    record.sourcePreviewIds ??
      record.source_preview_ids ??
      record.effectPreviewIds ??
      record.effect_preview_ids
  );
  const content = asString(
    record.content ?? record.prompt ?? record.promptContent,
    sections.map(section => section.content).filter(Boolean).join("\n\n")
  );
  const title = asString(
    record.title ?? record.name,
    `${platform} implementation prompt package`
  );

  return {
    id: asString(record.id ?? record.packageId, `prompt-package-${index + 1}`),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    treeId: asString(record.treeId ?? record.tree_id),
    nodeIds,
    targetPlatform: platform,
    target,
    nodeId: asString(record.nodeId ?? record.node_id, nodeIds[0] ?? ""),
    previewId: asString(
      record.previewId ??
        record.preview_id ??
        record.effectPreviewId ??
        sourcePreviewIds[0]
    ),
    platform,
    title,
    summary: asString(record.summary ?? record.description, title),
    content,
    sections,
    sourceDocumentIds,
    sourcePreviewIds,
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    provenance: (asRecord(record.provenance) ??
      undefined) as BlueprintPromptPackage["provenance"],
    status: asString(record.status, "draft"),
  };
}

export function normalizeBlueprintPromptPackagesResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintPromptPackagesResponse {
  const record = asRecord(payload) ?? {};
  const rawPackages =
    record.promptPackages ??
    record.prompt_packages ??
    record.packages ??
    record.items ??
    [];
  const promptPackages = Array.isArray(rawPackages)
    ? rawPackages.map((item, index) =>
        normalizeBlueprintPromptPackage(item, index, fallbackJobId)
      )
    : [];

  return {
    job: record.job as BlueprintPromptPackagesResponse["job"],
    specTree: record.specTree as BlueprintPromptPackagesResponse["specTree"],
    promptPackages,
  };
}

const RUNTIME_CAPABILITY_KINDS = [
  "docker",
  "mcp",
  "skill",
  "aigc_node",
  "role",
] as const;
const RUNTIME_CAPABILITY_SECURITY_LEVELS = [
  "readonly",
  "sandboxed",
  "write_enabled",
  "networked",
] as const;
const RUNTIME_CAPABILITY_STATUSES = [
  "available",
  "disabled",
  "requires_approval",
] as const;
const CAPABILITY_INVOCATION_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
] as const;
const CAPABILITY_SAFETY_GATE_STATUSES = ["allowed", "blocked"] as const;
const CAPABILITY_EVIDENCE_KINDS = [
  "analysis",
  "diagram",
  "document",
  "log",
  "safety",
] as const;
const CAPABILITY_EVIDENCE_STATUSES = [
  "recorded",
  "blocked",
  "failed",
] as const;
const BLUEPRINT_ROLE_PRESENCE_STATES = [
  "active",
  "watching",
  "reviewing",
  "sleeping",
] as const;

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number]
): T[number] {
  const normalized = asString(value).toLowerCase();
  return options.includes(normalized) ? normalized : fallback;
}

function normalizeRuntimeCapabilityKind(
  value: unknown
): BlueprintRuntimeCapabilityKind {
  return normalizeEnum(value, RUNTIME_CAPABILITY_KINDS, "skill");
}

function normalizeRuntimeCapabilitySecurityLevel(
  value: unknown
): BlueprintRuntimeCapabilitySecurityLevel {
  return normalizeEnum(value, RUNTIME_CAPABILITY_SECURITY_LEVELS, "sandboxed");
}

function normalizeRuntimeCapabilityStatus(
  value: unknown
): BlueprintRuntimeCapabilityStatus {
  return normalizeEnum(value, RUNTIME_CAPABILITY_STATUSES, "available");
}

function normalizeCapabilityInvocationStatus(
  value: unknown
): BlueprintCapabilityInvocationStatus {
  return normalizeEnum(value, CAPABILITY_INVOCATION_STATUSES, "queued");
}

function normalizeCapabilitySafetyGateStatus(
  value: unknown
): BlueprintCapabilitySafetyGateStatus {
  return normalizeEnum(value, CAPABILITY_SAFETY_GATE_STATUSES, "allowed");
}

function normalizeCapabilityEvidenceKind(
  value: unknown
): BlueprintCapabilityEvidenceKind {
  return normalizeEnum(value, CAPABILITY_EVIDENCE_KINDS, "analysis");
}

function normalizeCapabilityEvidenceStatus(
  value: unknown
): BlueprintCapabilityEvidenceStatus {
  return normalizeEnum(value, CAPABILITY_EVIDENCE_STATUSES, "recorded");
}

function normalizeBlueprintRolePresenceState(
  value: unknown
): BlueprintRolePresenceState {
  return normalizeEnum(value, BLUEPRINT_ROLE_PRESENCE_STATES, "sleeping");
}

export function normalizeBlueprintRuntimeCapability(
  value: unknown,
  index: number
): BlueprintRuntimeCapability {
  const record = asRecord(value) ?? {};
  const id = asString(
    record.id ?? record.capabilityId ?? record.capability_id,
    `runtime-capability-${index + 1}`
  );
  const label = asString(record.label ?? record.title ?? record.name, id);
  const kind = normalizeRuntimeCapabilityKind(record.kind ?? record.type);
  const securityLevel = normalizeRuntimeCapabilitySecurityLevel(
    record.securityLevel ?? record.security_level ?? record.security
  );

  return {
    id,
    label,
    kind,
    purpose: asString(record.purpose ?? record.summary, label),
    description: asString(
      record.description ?? record.detail ?? record.summary,
      "Runtime capability registered."
    ),
    tags: asStringArray(record.tags),
    securityLevel,
    status: normalizeRuntimeCapabilityStatus(record.status ?? record.state),
    adapter: asString(record.adapter ?? record.adapterId ?? record.adapter_id),
    inputSchema: asString(
      record.inputSchema ?? record.input_schema ?? record.schema,
      "{}"
    ),
    outputTypes: asStringArray(
      record.outputTypes ?? record.output_types ?? record.outputs
    ),
    supportedStages: asStringArray(
      record.supportedStages ?? record.supported_stages ?? record.stages
    ) as BlueprintRuntimeCapability["supportedStages"],
    requiresApproval: asBoolean(
      record.requiresApproval ??
        record.requires_approval ??
        (securityLevel === "write_enabled" || securityLevel === "networked")
    ),
    projectScoped: asBoolean(record.projectScoped ?? record.project_scoped),
  };
}

function normalizeCapabilityRegistryList(payload: unknown): BlueprintRuntimeCapability[] {
  const record = asRecord(payload) ?? {};
  const rawCapabilities =
    record.capabilities ??
    record.registry ??
    record.runtimeCapabilities ??
    record.runtime_capabilities ??
    record.items ??
    [];
  return asUnknownArray(rawCapabilities).map((item, index) =>
    normalizeBlueprintRuntimeCapability(item, index)
  );
}

export function normalizeBlueprintCapabilityRegistryResponse(
  payload: unknown
): BlueprintCapabilityRegistrySnapshot {
  const record = asRecord(payload) ?? {};

  return {
    capabilities: normalizeCapabilityRegistryList(payload),
    agentCrew: normalizeBlueprintAgentCrew(record.agentCrew ?? record.agent_crew),
  };
}

export function normalizeBlueprintJobCapabilitiesResponse(
  payload: unknown
): BlueprintJobCapabilitiesResponse {
  const record = asRecord(payload) ?? {};

  return {
    job: record.job as BlueprintJobCapabilitiesResponse["job"],
    routeSet: record.routeSet as BlueprintJobCapabilitiesResponse["routeSet"],
    specTree: record.specTree as BlueprintJobCapabilitiesResponse["specTree"],
    agentCrew: normalizeBlueprintAgentCrew(record.agentCrew ?? record.agent_crew),
    capabilities: normalizeCapabilityRegistryList(payload),
  };
}

function normalizeBlueprintAgentCrewRoleTimeline(
  value: unknown,
  index: number,
  rolesById: Map<string, BlueprintAgentRole>,
  capabilitiesById: Map<string, string>,
  fallbackStage: string
): BlueprintAgentCrewRoleTimeline {
  const record = asRecord(value) ?? {};
  const rawEntries = asUnknownArray(record.entries);
  const latestEntry = asRecord(rawEntries.at(-1));
  const roleValue = asRecord(record.role);
  const roleId = asString(
    record.roleId ?? record.role_id ?? roleValue?.id ?? record.id,
    `role-${index + 1}`
  );
  const role = rolesById.get(roleId);
  const capabilityIds = uniqueStrings(
    asStringArray(
      record.capabilityIds ??
        record.capability_ids ??
        record.latestCapabilityId ??
        record.latest_capability_id ??
        latestEntry?.capabilityId ??
        latestEntry?.capability_id ??
        record.capabilities ??
        record.capability
    )
  );
  const artifactIds = uniqueStrings(
    asStringArray(
      record.artifactIds ??
        record.artifact_ids ??
        record.latestArtifactId ??
        record.latest_artifact_id ??
        latestEntry?.artifactId ??
        latestEntry?.artifact_id ??
        record.artifacts ??
        record.latestArtifact ??
        record.latest_artifact
    )
  );
  const evidenceIds = uniqueStrings(
    asStringArray(
      record.evidenceIds ??
        record.evidence_ids ??
        record.latestEvidenceId ??
        record.latest_evidence_id ??
        latestEntry?.evidenceId ??
        latestEntry?.evidence_id ??
        record.evidence ??
        record.latestEvidence ??
        record.latest_evidence
    )
  );
  const latestCapability = asString(
      record.latestCapability ??
      record.latest_capability ??
      record.latestCapabilityId ??
      record.latest_capability_id ??
      latestEntry?.capabilityId ??
      latestEntry?.capability_id ??
      record.capabilityLabel ??
      record.capability_label,
    capabilityIds
      .map(capabilityId => capabilitiesById.get(capabilityId) ?? capabilityId)
      .filter(Boolean)[0] ?? ""
  );
  const stage = asString(
    record.latestStage ??
      record.latest_stage ??
      record.stage ??
      latestEntry?.stage ??
      record.phase,
    fallbackStage
  );
  const state = normalizeBlueprintRolePresenceState(
    record.latestPresenceState ??
      record.latest_presence_state ??
      record.presenceState ??
      record.presence_state ??
      latestEntry?.presenceState ??
      latestEntry?.presence_state ??
      record.state ??
      record.status
  );
  const currentAction = asString(
    record.latestAction ??
      record.latest_action ??
      record.currentAction ??
      record.current_action ??
      latestEntry?.currentAction ??
      latestEntry?.current_action ??
      record.action ??
      record.summary,
    "Standing by for the next blueprint action."
  );
  const jobId = asString(
    record.jobId ?? record.job_id ?? latestEntry?.jobId ?? latestEntry?.job_id
  );
  const entries = rawEntries.map((entryValue, entryIndex) => {
    const entry = asRecord(entryValue) ?? {};
    const entryType = asString(
      entry.type ?? entry.eventType ?? entry.event_type,
      "role.watching"
    ) as BlueprintRoleTimelineEntry["type"];
    return {
      id: asString(
        entry.id ?? entry.entryId ?? entry.entry_id,
        `${roleId}-entry-${entryIndex + 1}`
      ),
      eventId: asString(
        entry.eventId ?? entry.event_id,
        `${roleId}-event-${entryIndex + 1}`
      ),
      jobId: asString(entry.jobId ?? entry.job_id, jobId),
      projectId:
        asString(entry.projectId ?? entry.project_id) || undefined,
      crewId: asString(entry.crewId ?? entry.crew_id) || undefined,
      stage: asString(entry.stage ?? entry.phase, stage) as BlueprintRoleTimelineEntry["stage"],
      roleId: asString(entry.roleId ?? entry.role_id, roleId),
      presenceState: normalizeBlueprintRolePresenceState(
        entry.presenceState ?? entry.presence_state ?? entry.state ?? state
      ),
      type: entryType,
      occurredAt: asString(
        entry.occurredAt ??
          entry.occurred_at ??
          entry.createdAt ??
          entry.created_at,
        asString(record.updatedAt ?? record.updated_at)
      ),
      summary: asString(
        entry.summary ?? entry.message ?? entry.currentAction ?? entry.current_action,
        currentAction
      ),
      currentAction:
        asString(entry.currentAction ?? entry.current_action) || undefined,
      capabilityId:
        asString(entry.capabilityId ?? entry.capability_id) || undefined,
      invocationId:
        asString(entry.invocationId ?? entry.invocation_id) || undefined,
      evidenceId:
        asString(entry.evidenceId ?? entry.evidence_id) || undefined,
      artifactId:
        asString(entry.artifactId ?? entry.artifact_id) || undefined,
      routeId: asString(entry.routeId ?? entry.route_id) || undefined,
      selectionId:
        asString(entry.selectionId ?? entry.selection_id) || undefined,
      specTreeId:
        asString(entry.specTreeId ?? entry.spec_tree_id) || undefined,
      nodeId: asString(entry.nodeId ?? entry.node_id) || undefined,
      sourceIds:
        (asRecord(entry.sourceIds ?? entry.source_ids) ??
          {}) as BlueprintRoleTimelineEntry["sourceIds"],
    } satisfies BlueprintRoleTimelineEntry;
  });

  return {
    id: asString(record.id ?? record.timelineId ?? record.timeline_id, roleId),
    jobId,
    roleId,
    roleName: asString(
      record.roleName ?? record.role_name ?? roleValue?.name ?? role?.name,
      roleId
    ),
    displayName: asString(
      record.displayName ??
        record.display_name ??
        roleValue?.displayName ??
        roleValue?.display_name ??
        role?.displayName,
      role?.name ?? roleId
    ),
    displayLabel: asString(
      record.displayLabel ??
        record.display_label ??
        record.displayLabelZh ??
        record.display_label_zh ??
        roleValue?.displayLabel ??
        roleValue?.display_label ??
        roleValue?.displayLabelZh ??
        roleValue?.display_label_zh ??
        role?.displayLabelZh ??
        role?.displayName,
      role?.name ?? roleId
    ),
    group: asString(
      record.group ?? roleValue?.group ?? role?.group,
      "execution"
    ),
    stage,
    state,
    currentAction,
    capabilityIds,
    capabilityLabels: capabilityIds.map(
      capabilityId => capabilitiesById.get(capabilityId) ?? capabilityId
    ),
    artifactIds,
    evidenceIds,
    latestArtifact: asString(
      record.latestArtifact ?? record.latest_artifact,
      artifactIds[0] ?? ""
    ),
    latestEvidence: asString(
      record.latestEvidence ?? record.latest_evidence,
      evidenceIds[0] ?? ""
    ),
    latestCapability,
    entryCount: asNumber(record.entryCount ?? record.entry_count, entries.length),
    entries,
  };
}

export function normalizeBlueprintAgentCrew(
  value: unknown
): BlueprintAgentCrewSnapshot | null {
  const record = asRecord(value);
  if (!record) return null;

  const roles = asUnknownArray(record.roles).map(
    role => (asRecord(role) ?? {}) as unknown as BlueprintAgentRole
  );
  const rolesById = new Map(roles.map(role => [role.id, role]));
  const capabilityMatrix = asUnknownArray(
    record.capabilityMatrix ?? record.capability_matrix ?? record.bindings
  ).map(
    binding => (asRecord(binding) ?? {}) as unknown as BlueprintCapabilityBinding
  );
  const capabilitiesById = new Map(
    capabilityMatrix.map(binding => [
      binding.capabilityId,
      binding.capabilityLabel || binding.capabilityId,
    ])
  );
  const fallbackStage = asString(record.stage ?? record.phase);
  const rawRoleTimelines =
    record.roleTimelines ??
    record.role_timelines ??
    record.timelines ??
    record.roleTimeline ??
    record.role_timeline ??
    record.presence ??
    [];
  const roleTimelines = asUnknownArray(rawRoleTimelines).map((item, index) =>
    normalizeBlueprintAgentCrewRoleTimeline(
      item,
      index,
      rolesById,
      capabilitiesById,
      fallbackStage
    )
  );

  return {
    id: asString(record.id, "blueprint-agent-crew"),
    jobId: asString(record.jobId ?? record.job_id),
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    stage: fallbackStage,
    roles,
    capabilityMatrix,
    activationPolicies: asUnknownArray(
      record.activationPolicies ?? record.activation_policies
    ) as BlueprintAgentCrew["activationPolicies"],
    presence: roleTimelines,
    roleTimelines,
    sourceIds:
      asRecord(record.sourceIds ?? record.source_ids) ??
      ({} as Record<string, unknown>),
  } as BlueprintAgentCrewSnapshot;
}

function normalizeBlueprintCapabilitySafetyGate(
  value: unknown,
  fallbackSecurityLevel: BlueprintRuntimeCapabilitySecurityLevel
): BlueprintCapabilitySafetyGate {
  const record = asRecord(value) ?? {};
  const securityLevel = normalizeRuntimeCapabilitySecurityLevel(
    record.securityLevel ?? record.security_level ?? fallbackSecurityLevel
  );

  return {
    status: normalizeCapabilitySafetyGateStatus(record.status ?? record.state),
    reason: asString(record.reason ?? record.summary),
    requiresApproval: asBoolean(
      record.requiresApproval ?? record.requires_approval
    ),
    approved: asBoolean(record.approved ?? record.isApproved),
    securityLevel,
  };
}

export function normalizeBlueprintCapabilityInvocation(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintCapabilityInvocation {
  const record = asRecord(value) ?? {};
  const capabilityRecord = asRecord(record.capability);
  const capabilityId = asString(
    record.capabilityId ??
      record.capability_id ??
      capabilityRecord?.id ??
      record.capability,
    `capability-${index + 1}`
  );
  const securityLevel = normalizeRuntimeCapabilitySecurityLevel(
    record.securityLevel ??
      record.security_level ??
      capabilityRecord?.securityLevel ??
      capabilityRecord?.security_level
  );
  const routeId = asString(record.routeId ?? record.route_id);
  const nodeId = asString(record.nodeId ?? record.node_id);

  return {
    id: asString(
      record.id ?? record.invocationId ?? record.invocation_id,
      `capability-invocation-${index + 1}`
    ),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    capabilityId,
    roleId: asString(record.roleId ?? record.role_id, "role-runtime-executor"),
    capabilityLabel: asString(
      record.capabilityLabel ??
        record.capability_label ??
        capabilityRecord?.label ??
        capabilityRecord?.name,
      capabilityId
    ),
    kind: normalizeRuntimeCapabilityKind(record.kind ?? capabilityRecord?.kind),
    status: normalizeCapabilityInvocationStatus(record.status ?? record.state),
    securityLevel,
    safetyGate: normalizeBlueprintCapabilitySafetyGate(
      record.safetyGate ?? record.safety_gate,
      securityLevel
    ),
    requestedAt: asString(
      record.requestedAt ?? record.requested_at ?? record.createdAt
    ),
    completedAt: asString(record.completedAt ?? record.completed_at),
    requestedBy: asString(record.requestedBy ?? record.requested_by),
    routeId: routeId || undefined,
    nodeId: nodeId || undefined,
    input: asString(record.input ?? record.prompt ?? record.request),
    outputSummary: asString(
      record.outputSummary ??
        record.output_summary ??
        record.summary ??
        record.resultSummary,
      "Capability invocation recorded."
    ),
    logs: asStringArray(record.logs ?? record.log),
    evidenceIds: asStringArray(
      record.evidenceIds ?? record.evidence_ids ?? record.evidence
    ),
    durationMs: asNumber(record.durationMs ?? record.duration_ms, 0),
    provenance: {
      jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
      projectId: asString(record.projectId ?? record.project_id) || undefined,
      sourceId: asString(record.sourceId ?? record.source_id) || undefined,
      routeSetId:
        asString(record.routeSetId ?? record.route_set_id) || undefined,
      routeId: routeId || undefined,
      specTreeId:
        asString(record.specTreeId ?? record.spec_tree_id) || undefined,
      nodeId: nodeId || undefined,
      roleId: asString(record.roleId ?? record.role_id) || undefined,
      targetText: asString(record.targetText ?? record.target_text) || undefined,
      githubUrls: asStringArray(record.githubUrls ?? record.github_urls),
    },
  };
}

export function normalizeBlueprintCapabilityInvocationsResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintCapabilityInvocationsSnapshotResponse {
  const record = asRecord(payload) ?? {};
  const rawInvocations =
    record.invocations ??
    record.capabilityInvocations ??
    record.capability_invocations ??
    record.items ??
    [];

  return {
    job: record.job as BlueprintCapabilityInvocationsResponse["job"],
    routeSet: record.routeSet as BlueprintCapabilityInvocationsResponse["routeSet"],
    specTree: record.specTree as BlueprintCapabilityInvocationsResponse["specTree"],
    capabilities: normalizeCapabilityRegistryList(payload),
    agentCrew: normalizeBlueprintAgentCrew(record.agentCrew ?? record.agent_crew),
    invocations: asUnknownArray(rawInvocations).map((item, index) =>
      normalizeBlueprintCapabilityInvocation(item, index, fallbackJobId)
    ),
  };
}

export function normalizeBlueprintCapabilityEvidence(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintCapabilityEvidence {
  const record = asRecord(value) ?? {};
  const capabilityRecord = asRecord(record.capability);
  const invocationRecord = asRecord(record.invocation);
  const capabilityId = asString(
    record.capabilityId ??
      record.capability_id ??
      capabilityRecord?.id ??
      invocationRecord?.capabilityId ??
      invocationRecord?.capability_id,
    `capability-${index + 1}`
  );
  const routeId = asString(record.routeId ?? record.route_id);
  const nodeId = asString(record.nodeId ?? record.node_id);

  return {
    id: asString(
      record.id ?? record.evidenceId ?? record.evidence_id,
      `capability-evidence-${index + 1}`
    ),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    invocationId: asString(
      record.invocationId ?? record.invocation_id ?? invocationRecord?.id
    ),
    capabilityId,
    capabilityLabel: asString(
      record.capabilityLabel ??
        record.capability_label ??
        capabilityRecord?.label ??
        capabilityRecord?.name,
      capabilityId
    ),
    kind: normalizeCapabilityEvidenceKind(record.kind ?? record.type),
    status: normalizeCapabilityEvidenceStatus(record.status ?? record.state),
    title: asString(record.title ?? record.name, `Evidence ${index + 1}`),
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      "Capability evidence recorded."
    ),
    createdAt: asString(record.createdAt ?? record.created_at),
    routeSetId: asString(record.routeSetId ?? record.route_set_id) || undefined,
    routeId: routeId || undefined,
    specTreeId: asString(record.specTreeId ?? record.spec_tree_id) || undefined,
    nodeId: nodeId || undefined,
    artifacts: asStringArray(record.artifacts ?? record.artifactIds),
    logs: asStringArray(record.logs ?? record.log),
    tags: asStringArray(record.tags),
    payloadSummary:
      (asRecord(record.payloadSummary ?? record.payload_summary) ??
        {}) as BlueprintCapabilityEvidence["payloadSummary"],
    provenance: {
      jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
      projectId: asString(record.projectId ?? record.project_id) || undefined,
      sourceId: asString(record.sourceId ?? record.source_id) || undefined,
      routeSetId:
        asString(record.routeSetId ?? record.route_set_id) || undefined,
      routeId: routeId || undefined,
      specTreeId:
        asString(record.specTreeId ?? record.spec_tree_id) || undefined,
      nodeId: nodeId || undefined,
      targetText: asString(record.targetText ?? record.target_text) || undefined,
      githubUrls: asStringArray(record.githubUrls ?? record.github_urls),
    },
  };
}

export function normalizeBlueprintCapabilityEvidenceResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintCapabilityEvidenceResponse {
  const record = asRecord(payload) ?? {};
  const rawEvidence =
    record.evidence ??
    record.capabilityEvidence ??
    record.capability_evidence ??
    record.items ??
    [];

  return {
    job: record.job as BlueprintCapabilityEvidenceResponse["job"],
    routeSet: record.routeSet as BlueprintCapabilityEvidenceResponse["routeSet"],
    specTree: record.specTree as BlueprintCapabilityEvidenceResponse["specTree"],
    evidence: asUnknownArray(rawEvidence).map((item, index) =>
      normalizeBlueprintCapabilityEvidence(item, index, fallbackJobId)
    ),
  };
}

export function normalizeBlueprintInvokeCapabilityResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintInvokeCapabilitySnapshotResponse {
  const record = asRecord(payload) ?? {};
  const capabilityValue = record.capability ?? {};
  const invocationValue = record.invocation ?? record.capabilityInvocation ?? {};
  const evidenceValue = record.evidence ?? record.capabilityEvidence ?? {};

  return {
    job: record.job as BlueprintInvokeCapabilityResponse["job"],
    routeSet: record.routeSet as BlueprintInvokeCapabilityResponse["routeSet"],
    specTree: record.specTree as BlueprintInvokeCapabilityResponse["specTree"],
    capability: normalizeBlueprintRuntimeCapability(capabilityValue, 0),
    agentCrew: normalizeBlueprintAgentCrew(record.agentCrew ?? record.agent_crew),
    invocation: normalizeBlueprintCapabilityInvocation(
      invocationValue,
      0,
      fallbackJobId
    ),
    evidence: normalizeBlueprintCapabilityEvidence(
      evidenceValue,
      0,
      fallbackJobId
    ),
  };
}

function asCommandStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        const record = asRecord(item);
        return asString(
          record?.command ?? record?.cmd ?? record?.script ?? record?.value ?? item
        );
      })
      .filter(Boolean);
  }

  return asStringArray(value);
}

function normalizeBlueprintEngineeringVerificationCommand(
  value: unknown,
  index: number,
  fallbackPlatform: BlueprintPromptTargetPlatform
): BlueprintEngineeringVerificationCommand {
  const record = asRecord(value);
  if (!record) {
    const command = asString(value, `Verification command ${index + 1}`);
    return {
      id: `verification-command-${index + 1}`,
      title: command,
      command,
      platform: fallbackPlatform,
    };
  }

  const command = asString(
    record.command ?? record.cmd ?? record.script ?? record.value,
    `Verification command ${index + 1}`
  );
  const title = asString(
    record.title ?? record.label ?? record.name ?? record.check,
    command
  );

  return {
    id: asString(record.id ?? record.key, `verification-command-${index + 1}`),
    title,
    command,
    summary: asString(record.summary ?? record.description ?? record.detail),
    expected: asString(
      record.expected ?? record.expectedResult ?? record.expected_result
    ),
    platform: normalizePromptTargetPlatform(
      record.platform ?? record.targetPlatform ?? record.target_platform ?? fallbackPlatform
    ),
  };
}

function normalizeBlueprintEngineeringPlatformHandoff(
  value: unknown,
  index: number,
  fallbackPlatform: BlueprintPromptTargetPlatform,
  fallbackPromptPackageId = ""
): BlueprintEngineeringPlatformHandoff {
  const record = asRecord(value);
  if (!record) {
    const summary = asString(value, `Platform handoff ${index + 1}`);
    return {
      id: `handoff-${index + 1}`,
      platform: fallbackPlatform,
      label: promptTargetLabel(fallbackPlatform),
      summary,
      promptPackageId: fallbackPromptPackageId || undefined,
      sourcePromptPackageIds: fallbackPromptPackageId
        ? [fallbackPromptPackageId]
        : [],
      nodeIds: [],
      instructions: [summary],
    };
  }

  const platform = normalizePromptTargetPlatform(
    record.platform ?? record.targetPlatform ?? record.target_platform ?? fallbackPlatform
  );
  const promptPackageId = asString(
    record.promptPackageId ??
      record.prompt_package_id ??
      record.packageId ??
      record.package_id,
    fallbackPromptPackageId
  );
  const sourcePromptPackageIds = asStringArray(
    record.sourcePromptPackageIds ??
      record.source_prompt_package_ids ??
      record.promptPackageIds ??
      record.prompt_package_ids ??
      promptPackageId
  );
  const label = asString(
    record.label ?? record.title ?? record.name,
    `${promptTargetLabel(platform)} handoff`
  );

  return {
    id: asString(record.id ?? record.key, `handoff-${index + 1}`),
    platform,
    label,
    summary: asString(
      record.summary ?? record.description ?? record.guidance,
      label
    ),
    content: asString(record.content ?? record.prompt ?? record.body),
    promptPackageId: promptPackageId || undefined,
    sourcePromptPackageIds,
    nodeIds: asStringArray(
      record.nodeIds ?? record.node_ids ?? record.sourceNodeIds ?? record.source_node_ids
    ),
    instructions: asStringArray(
      record.instructions ??
        record.content ??
        record.notes ??
        record.guidance ??
        record.checklist ??
        record.steps
    ),
  };
}

function normalizeBlueprintEngineeringLandingStep(
  value: unknown,
  index: number
): BlueprintEngineeringLandingStep {
  const record = asRecord(value);
  if (!record) {
    const title = asString(value, `Landing step ${index + 1}`);
    return {
      id: `landing-step-${index + 1}`,
      title,
      summary: title,
      commands: [],
      sourcePromptPackageIds: [],
    };
  }

  const title = asString(
    record.title ?? record.name ?? record.label,
    `Landing step ${index + 1}`
  );

  return {
    id: asString(record.id ?? record.key, `landing-step-${index + 1}`),
    title,
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      title
    ),
    status: asString(record.status ?? record.state),
    owner: asString(record.owner ?? record.role),
    target: asString(record.target ?? record.outcome),
    sourceNodeIds: asStringArray(
      record.sourceNodeIds ?? record.source_node_ids ?? record.nodeIds ?? record.node_ids
    ),
    commands: asCommandStringArray(
      record.commands ??
        record.verificationCommands ??
        record.verification_commands ??
        record.command ??
        record.cmd
    ),
    sourcePromptPackageIds: asStringArray(
      record.sourcePromptPackageIds ??
        record.source_prompt_package_ids ??
        record.promptPackageIds ??
        record.prompt_package_ids
    ),
    sourceDocumentIds: asStringArray(
      record.sourceDocumentIds ?? record.source_document_ids
    ),
    sourcePreviewIds: asStringArray(
      record.sourcePreviewIds ?? record.source_preview_ids
    ),
    fileScopes: asStringArray(record.fileScopes ?? record.file_scopes),
    riskLevel: asString(record.riskLevel ?? record.risk_level),
  };
}

export function normalizeBlueprintEngineeringLandingPlan(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintEngineeringLandingPlan {
  const record = asRecord(value) ?? {};
  const targetRecord = asRecord(record.target);
  const provenance = asRecord(record.provenance);
  const provenancePlatforms = asRecord(provenance?.promptPackagePlatforms);
  const platform = normalizePromptTargetPlatform(
    record.platform ??
      record.targetPlatform ??
      record.target_platform ??
      (provenancePlatforms ? Object.values(provenancePlatforms)[0] : undefined) ??
      targetRecord?.platform
  );
  const promptPackageId = asString(
    record.promptPackageId ??
      record.prompt_package_id ??
      record.packageId ??
      record.package_id
  );
  const sourcePromptPackageIds = asStringArray(
    record.sourcePromptPackageIds ??
      record.source_prompt_package_ids ??
      record.promptPackageIds ??
      record.prompt_package_ids ??
      promptPackageId
  );
  const title = asString(
    record.title ?? record.name,
    `${promptTargetLabel(platform)} engineering landing plan`
  );
  const handoffsValue =
    record.handoffs ??
    record.platformHandoffs ??
    record.platform_handoffs ??
    record.handOffs ??
    record.hand_offs ??
    [];
  const stepsValue =
    record.steps ??
    record.implementationSteps ??
    record.implementation_steps ??
    record.landingSteps ??
    record.landing_steps ??
    record.plan ??
    [];
  const verificationValue =
    record.verificationCommands ??
    record.verification_commands ??
    record.verification ??
    record.commands ??
    record.checks ??
    (Array.isArray(stepsValue)
      ? stepsValue.flatMap(step => {
          const stepRecord = asRecord(step);
          return asCommandStringArray(
            stepRecord?.verificationCommands ??
              stepRecord?.verification_commands ??
              stepRecord?.checks
          );
        })
      : []) ??
    [];

  return {
    id: asString(record.id ?? record.planId, `engineering-landing-${index + 1}`),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    treeId: asString(record.treeId ?? record.tree_id),
    promptPackageId: promptPackageId || undefined,
    sourcePromptPackageIds,
    platform,
    title,
    summary: asString(record.summary ?? record.description, title),
    status: asString(record.status ?? record.state, "draft"),
    handoffs: Array.isArray(handoffsValue)
      ? handoffsValue.map((item, handoffIndex) =>
          normalizeBlueprintEngineeringPlatformHandoff(
            item,
            handoffIndex,
            platform,
            promptPackageId
          )
        )
      : asStringArray(handoffsValue).map((item, handoffIndex) =>
          normalizeBlueprintEngineeringPlatformHandoff(
            item,
            handoffIndex,
            platform,
            promptPackageId
          )
        ),
    steps: Array.isArray(stepsValue)
      ? stepsValue.map(normalizeBlueprintEngineeringLandingStep)
      : asStringArray(stepsValue).map((item, stepIndex) =>
          normalizeBlueprintEngineeringLandingStep(item, stepIndex)
        ),
    verificationCommands: Array.isArray(verificationValue)
      ? verificationValue.map((item, commandIndex) =>
          normalizeBlueprintEngineeringVerificationCommand(
            item,
            commandIndex,
            platform
          )
        )
      : asStringArray(verificationValue).map((item, commandIndex) =>
          normalizeBlueprintEngineeringVerificationCommand(
            item,
            commandIndex,
            platform
          )
        ),
    changedFiles: asStringArray(
      record.changedFiles ??
        record.changed_files ??
        record.files ??
        record.filePaths ??
        record.file_paths ??
        (Array.isArray(stepsValue)
          ? stepsValue.flatMap(step => {
              const stepRecord = asRecord(step);
              return asStringArray(
                stepRecord?.fileScopes ??
                  stepRecord?.file_scopes ??
                  stepRecord?.files
              );
            })
          : [])
    ),
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    provenance: (provenance ??
      undefined) as BlueprintEngineeringLandingPlan["provenance"],
  };
}

export function normalizeBlueprintEngineeringLandingResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintEngineeringLandingResponse {
  const record = asRecord(payload) ?? {};
  const rawPlans =
    record.landingPlans ??
    record.landing_plans ??
    record.engineeringLandingPlans ??
    record.engineering_landing_plans ??
    record.plans ??
    record.items ??
    [];
  const landingPlans = Array.isArray(rawPlans)
    ? rawPlans.map((item, index) =>
        normalizeBlueprintEngineeringLandingPlan(item, index, fallbackJobId)
      )
    : [];

  return {
    job: record.job as BlueprintEngineeringLandingResponse["job"],
    specTree: record.specTree as BlueprintEngineeringLandingResponse["specTree"],
    landingPlans,
  };
}

function normalizeBlueprintEngineeringRunStatus(
  value: unknown
): BlueprintEngineeringRunStatus {
  const normalized = asString(value, "planned").toLowerCase().replace(/\s+/g, "_");
  const statuses: BlueprintEngineeringRunStatus[] = [
    "planned",
    "running",
    "passed",
    "failed",
    "blocked",
    "completed",
    "skipped",
    "unknown",
  ];
  return statuses.includes(normalized as BlueprintEngineeringRunStatus)
    ? (normalized as BlueprintEngineeringRunStatus)
    : "unknown";
}

function normalizeBlueprintEngineeringVerificationResult(
  value: unknown,
  index: number
): BlueprintEngineeringVerificationResult {
  const record = asRecord(value);
  if (!record) {
    const summary = asString(value, `Verification result ${index + 1}`);
    return {
      id: `verification-result-${index + 1}`,
      title: summary,
      command: "",
      status: "unknown",
      summary,
    };
  }

  const command = asString(record.command ?? record.cmd ?? record.script);
  const title = asString(
    record.title ?? record.label ?? record.name ?? record.check ?? command,
    `Verification result ${index + 1}`
  );

  return {
    id: asString(record.id ?? record.key, `verification-result-${index + 1}`),
    title,
    command,
    status: asString(record.status ?? record.result ?? record.outcome, "unknown"),
    summary: asString(record.summary ?? record.description ?? record.detail),
    output: asString(record.output ?? record.logs ?? record.log),
  };
}

export function normalizeBlueprintEngineeringRun(
  value: unknown,
  index: number,
  fallbackJobId = "",
  fallbackLandingPlanId = ""
): BlueprintEngineeringRun {
  const record = asRecord(value) ?? {};
  const verificationValue =
    record.verificationResults ??
    record.verification_results ??
    record.results ??
    record.checks ??
    [];

  return {
    id: asString(record.id ?? record.runId, `engineering-run-${index + 1}`),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    landingPlanId: asString(
      record.landingPlanId ??
        record.landing_plan_id ??
        record.planId ??
        record.plan_id,
      fallbackLandingPlanId
    ),
    status: normalizeBlueprintEngineeringRunStatus(
      record.status ?? record.state ?? record.result
    ),
    summary: asString(
      record.summary ?? record.description ?? record.resultSummary,
      "Engineering run recorded."
    ),
    logs: asStringArray(record.logs ?? record.log ?? record.notes),
    verificationResults: Array.isArray(verificationValue)
      ? verificationValue.map(normalizeBlueprintEngineeringVerificationResult)
      : asStringArray(verificationValue).map((item, resultIndex) =>
          normalizeBlueprintEngineeringVerificationResult(item, resultIndex)
        ),
    changedFiles: asStringArray(
      record.changedFiles ??
        record.changed_files ??
        record.files ??
        record.filePaths ??
        record.file_paths
    ),
    createdAt: asString(
      record.createdAt ?? record.created_at ?? record.recordedAt ?? record.recorded_at
    ),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    recordedAt: asString(record.recordedAt ?? record.recorded_at),
    provenance: (asRecord(record.provenance) ??
      undefined) as BlueprintEngineeringRun["provenance"],
  };
}

export function normalizeBlueprintEngineeringRunsResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintEngineeringRunsResponse {
  const record = asRecord(payload) ?? {};
  const rawPlans =
    record.engineeringLandingPlans ??
    record.engineering_landing_plans ??
    record.landingPlans ??
    record.landing_plans ??
    [];
  const engineeringLandingPlans = Array.isArray(rawPlans)
    ? rawPlans.map((item, index) =>
        normalizeBlueprintEngineeringLandingPlan(item, index, fallbackJobId)
      )
    : [];
  const landingPlanValue =
    record.landingPlan ??
    record.landing_plan ??
    record.engineeringLandingPlan ??
    record.engineering_landing_plan ??
    engineeringLandingPlans[0];
  const landingPlan = landingPlanValue
    ? normalizeBlueprintEngineeringLandingPlan(
        landingPlanValue,
        0,
        fallbackJobId
      )
    : null;
  const rawRuns =
    record.engineeringRuns ??
    record.engineering_runs ??
    record.runs ??
    record.items ??
    [];
  const engineeringRuns = Array.isArray(rawRuns)
    ? rawRuns.map((item, index) =>
        normalizeBlueprintEngineeringRun(
          item,
          index,
          fallbackJobId,
          landingPlan?.id
        )
      )
    : [];

  return {
    job: record.job as BlueprintEngineeringRunsResponse["job"],
    landingPlan,
    engineeringLandingPlans,
    engineeringRuns,
  };
}

export function normalizeBlueprintCreateEngineeringRunResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintCreateEngineeringRunResponse {
  const record = asRecord(payload) ?? {};
  const landingPlanValue =
    record.landingPlan ??
    record.landing_plan ??
    record.engineeringLandingPlan ??
    record.engineering_landing_plan;
  const landingPlan = landingPlanValue
    ? normalizeBlueprintEngineeringLandingPlan(
        landingPlanValue,
        0,
        fallbackJobId
      )
    : null;
  const runValue =
    record.engineeringRun ??
    record.engineering_run ??
    record.run ??
    (Array.isArray(record.engineeringRuns) ? record.engineeringRuns[0] : null) ??
    record;

  return {
    job: record.job as BlueprintCreateEngineeringRunResponse["job"],
    landingPlan,
    engineeringRun: normalizeBlueprintEngineeringRun(
      runValue,
      0,
      fallbackJobId,
      landingPlan?.id
    ),
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeBlueprintArtifactLineageEdge(
  value: unknown,
  index: number,
  fallbackSourceEntryId = "",
  fallbackTargetEntryId = ""
): BlueprintArtifactLineageEdge {
  const record = asRecord(value);
  if (!record) {
    const summary = asString(value, `Lineage edge ${index + 1}`);
    return {
      id: `lineage-edge-${index + 1}`,
      sourceEntryId: fallbackSourceEntryId,
      targetEntryId: fallbackTargetEntryId,
      kind: "derived",
      summary,
    };
  }

  const sourceEntryId = asString(
    record.sourceEntryId ??
      record.source_entry_id ??
      record.fromEntryId ??
      record.from_entry_id ??
      record.source ??
      record.from,
    fallbackSourceEntryId
  );
  const targetEntryId = asString(
    record.targetEntryId ??
      record.target_entry_id ??
      record.toEntryId ??
      record.to_entry_id ??
      record.target ??
      record.to,
    fallbackTargetEntryId
  );
  const kind = asString(record.kind ?? record.type ?? record.relation, "derived");

  return {
    id: asString(
      record.id ?? record.edgeId ?? record.edge_id,
      `lineage-edge-${index + 1}`
    ),
    sourceEntryId,
    targetEntryId,
    kind,
    summary: asString(record.summary ?? record.description ?? record.label),
  };
}

function readArtifactLineageEdges(
  record: Record<string, unknown>,
  fallbackTargetEntryId: string,
  sourceEntryIds: string[]
): BlueprintArtifactLineageEdge[] {
  const rawEdges =
    record.lineageEdges ??
    record.lineage_edges ??
    record.provenanceEdges ??
    record.provenance_edges ??
    record.edges ??
    [];
  const explicitEdges = asUnknownArray(rawEdges).map((item, index) =>
    normalizeBlueprintArtifactLineageEdge(
      item,
      index,
      "",
      fallbackTargetEntryId
    )
  );

  if (explicitEdges.length) return explicitEdges;

  return sourceEntryIds.map((sourceEntryId, index) => ({
    id: `lineage-edge-${index + 1}`,
    sourceEntryId,
    targetEntryId: fallbackTargetEntryId,
    kind: "source",
    summary: "Source artifact lineage.",
  }));
}

export function normalizeBlueprintArtifactLedgerEntry(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintArtifactLedgerEntry {
  const record = asRecord(value) ?? {};
  const artifactRecord = asRecord(record.artifact ?? record.asset);
  const id = asString(record.id ?? record.entryId ?? record.entry_id, `artifact-entry-${index + 1}`);
  const artifactId = asString(
    record.artifactId ??
      record.artifact_id ??
      record.assetId ??
      record.asset_id ??
      artifactRecord?.id
  );
  const artifactType = asString(
    record.artifactType ??
      record.artifact_type ??
      record.type ??
      record.kind ??
      artifactRecord?.type,
    "artifact"
  );
  const sourceEntryIds = uniqueStrings(
    asStringArray(
      record.sourceEntryIds ??
        record.source_entry_ids ??
        record.parentEntryIds ??
        record.parent_entry_ids ??
        record.previousEntryIds ??
        record.previous_entry_ids
    )
  );
  const sourceArtifactIds = uniqueStrings(
    asStringArray(
      record.sourceArtifactIds ??
        record.source_artifact_ids ??
        record.parentArtifactIds ??
        record.parent_artifact_ids ??
        record.sourceIds ??
        record.source_ids
    )
  );
  const targetEntryIds = uniqueStrings(
    asStringArray(
      record.targetEntryIds ??
        record.target_entry_ids ??
        record.childEntryIds ??
        record.child_entry_ids ??
        record.derivedEntryIds ??
        record.derived_entry_ids
    )
  );
  const lineageEdges = readArtifactLineageEdges(record, id, sourceEntryIds);
  const versionNumber = asNumber(
    record.version ?? record.revision ?? record.snapshotVersion ?? record.snapshot_version,
    Number.NaN
  );

  return {
    id,
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    artifactId: artifactId || undefined,
    artifactType,
    stage: asString(
      record.stage ??
        record.phase ??
        record.jobStage ??
        record.job_stage ??
        artifactRecord?.stage,
      "artifact_memory"
    ),
    title: asString(
      record.title ?? record.name ?? record.label ?? artifactRecord?.title,
      artifactId || `Artifact entry ${index + 1}`
    ),
    summary: asString(
      record.summary ??
        record.description ??
        record.detail ??
        artifactRecord?.summary,
      "Artifact ledger entry recorded."
    ),
    status: asString(
      record.status ?? record.state ?? artifactRecord?.status,
      "recorded"
    ),
    version: Number.isFinite(versionNumber) ? versionNumber : undefined,
    sourceEntryIds,
    sourceArtifactIds,
    targetEntryIds,
    lineageEdges,
    lineageEdgeCount: asNumber(
      record.lineageEdgeCount ??
        record.lineage_edge_count ??
        record.edgeCount ??
        record.edge_count,
      lineageEdges.length + sourceArtifactIds.length
    ),
    createdAt: asString(
      record.createdAt ??
        record.created_at ??
        record.recordedAt ??
        record.recorded_at ??
        artifactRecord?.createdAt ??
        artifactRecord?.created_at
    ),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    recordedAt: asString(record.recordedAt ?? record.recorded_at),
    payload: record.payload ?? artifactRecord?.payload ?? record.snapshot,
    metadata: (asRecord(record.metadata ?? record.meta ?? record.provenance) ??
      undefined) as BlueprintArtifactLedgerEntry["metadata"],
  };
}

export function normalizeBlueprintArtifactLedgerResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactLedgerResponse {
  const record = asRecord(payload) ?? {};
  const rawEntries =
    record.entries ??
    record.ledgerEntries ??
    record.ledger_entries ??
    record.artifactLedgerEntries ??
    record.artifact_ledger_entries ??
    record.artifacts ??
    record.items ??
    [];
  const entries = asUnknownArray(rawEntries).map((item, index) =>
    normalizeBlueprintArtifactLedgerEntry(item, index, fallbackJobId)
  );

  return {
    job: record.job as BlueprintArtifactLedgerResponse["job"],
    entries,
  };
}

function normalizeBlueprintArtifactReplaySnapshot(
  value: unknown,
  index: number
): BlueprintArtifactReplaySnapshot {
  const record = asRecord(value);
  if (!record) {
    const title = asString(value, `Replay snapshot ${index + 1}`);
    return {
      id: `replay-snapshot-${index + 1}`,
      artifactType: "artifact",
      stage: "artifact_memory",
      title,
      summary: title,
      status: "recorded",
      lineageEdgeCount: 0,
    };
  }

  const sourceEntryIds = asStringArray(
    record.sourceEntryIds ?? record.source_entry_ids ?? record.parentEntryIds
  );
  const edgeCountFallback =
    asUnknownArray(record.lineageEdges ?? record.lineage_edges ?? record.edges)
      .length + sourceEntryIds.length;
  const entryId = asString(record.entryId ?? record.entry_id ?? record.ledgerEntryId);

  return {
    id: asString(record.id ?? record.snapshotId ?? record.snapshot_id, `replay-snapshot-${index + 1}`),
    entryId: entryId || undefined,
    artifactType: asString(
      record.artifactType ?? record.artifact_type ?? record.type ?? record.kind,
      "artifact"
    ),
    stage: asString(record.stage ?? record.phase ?? record.jobStage, "artifact_memory"),
    title: asString(record.title ?? record.name ?? record.label, `Replay snapshot ${index + 1}`),
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      "Replay snapshot recorded."
    ),
    status: asString(record.status ?? record.state, "recorded"),
    createdAt: asString(record.createdAt ?? record.created_at ?? record.recordedAt),
    lineageEdgeCount: asNumber(
      record.lineageEdgeCount ?? record.lineage_edge_count ?? record.edgeCount,
      edgeCountFallback
    ),
  };
}

export function normalizeBlueprintArtifactReplay(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintArtifactReplay {
  const record = asRecord(value) ?? {};
  const entryId = asString(
    record.entryId ?? record.entry_id ?? record.ledgerEntryId ?? record.ledger_entry_id
  );
  const rawSnapshots =
    record.snapshots ??
    record.timeline ??
    record.entries ??
    record.steps ??
    record.items ??
    [];
  const snapshots = asUnknownArray(rawSnapshots).map(
    normalizeBlueprintArtifactReplaySnapshot
  );
  const lineageEdges = asUnknownArray(
    record.lineageEdges ??
      record.lineage_edges ??
      record.provenanceEdges ??
      record.provenance_edges ??
      record.edges
  ).map((item, edgeIndex) =>
    normalizeBlueprintArtifactLineageEdge(item, edgeIndex, "", entryId)
  );

  return {
    id: asString(record.id ?? record.replayId ?? record.replay_id, `artifact-replay-${index + 1}`),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    entryId: entryId || undefined,
    stage: asString(record.stage ?? record.phase),
    title: asString(record.title ?? record.name ?? record.label, `Artifact replay ${index + 1}`),
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      snapshots.length
        ? `${snapshots.length} replay snapshots available.`
        : "Replay snapshot is ready."
    ),
    status: asString(record.status ?? record.state, "recorded"),
    snapshots,
    lineageEdges,
    lineageEdgeCount: asNumber(
      record.lineageEdgeCount ?? record.lineage_edge_count ?? record.edgeCount,
      lineageEdges.length ||
        snapshots.reduce((sum, snapshot) => sum + snapshot.lineageEdgeCount, 0)
    ),
    createdAt: asString(record.createdAt ?? record.created_at ?? record.recordedAt),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
  };
}

export function normalizeBlueprintArtifactReplayResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactReplayResponse {
  const record = asRecord(payload) ?? {};
  const replayValue =
    record.replay ??
    record.artifactReplay ??
    record.artifact_replay ??
    record.item ??
    (Array.isArray(record.replays) ? record.replays[0] : null) ??
    record;

  return {
    job: record.job as BlueprintArtifactReplayResponse["job"],
    replay: normalizeBlueprintArtifactReplay(replayValue, 0, fallbackJobId),
  };
}

export function normalizeBlueprintArtifactReplaysResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactReplaysResponse {
  const record = asRecord(payload) ?? {};
  const rawReplays =
    record.replays ??
    record.artifactReplays ??
    record.artifact_replays ??
    record.items ??
    [];
  const replays = asUnknownArray(rawReplays).map((item, index) =>
    normalizeBlueprintArtifactReplay(item, index, fallbackJobId)
  );

  return {
    job: record.job as BlueprintArtifactReplaysResponse["job"],
    replays,
  };
}

function normalizeBlueprintArtifactDiffChange(
  value: unknown,
  index: number,
  fallbackKind = "changed"
): BlueprintArtifactDiffChange {
  const record = asRecord(value);
  if (!record) {
    const summary = asString(value, `Artifact diff change ${index + 1}`);
    return {
      id: `artifact-diff-change-${index + 1}`,
      kind: fallbackKind,
      path: "",
      title: summary,
      summary,
    };
  }

  const kind = asString(
    record.kind ?? record.type ?? record.changeType ?? record.change_type,
    fallbackKind
  );
  const path = asString(record.path ?? record.key ?? record.field ?? record.property);
  const title = asString(
    record.title ?? record.label ?? record.name ?? path,
    `Artifact diff change ${index + 1}`
  );

  return {
    id: asString(record.id ?? record.changeId ?? record.change_id, `artifact-diff-change-${index + 1}`),
    kind,
    path,
    title,
    summary: asString(record.summary ?? record.description ?? record.detail, title),
    before: asString(record.before ?? record.left ?? record.previous),
    after: asString(record.after ?? record.right ?? record.next),
  };
}

function countDiffItems(value: unknown, fallback = 0): number {
  return Array.isArray(value) ? value.length : asNumber(value, fallback);
}

export function normalizeBlueprintArtifactDiff(
  value: unknown,
  fallbackJobId = ""
): BlueprintArtifactDiff {
  const record = asRecord(value) ?? {};
  const stats = asRecord(record.stats ?? record.counts);
  const rawChanges =
    record.changes ??
    record.items ??
    [
      ...asUnknownArray(record.added).map(item => ({
        ...(asRecord(item) ?? { summary: item }),
        kind: "added",
      })),
      ...asUnknownArray(record.removed).map(item => ({
        ...(asRecord(item) ?? { summary: item }),
        kind: "removed",
      })),
      ...asUnknownArray(record.changed).map(item => ({
        ...(asRecord(item) ?? { summary: item }),
        kind: "changed",
      })),
    ];
  const changes = asUnknownArray(rawChanges).map((item, index) =>
    normalizeBlueprintArtifactDiffChange(item, index)
  );
  const added = countDiffItems(
    record.addedCount ?? record.added_count ?? record.added ?? stats?.added,
    changes.filter(change => change.kind === "added").length
  );
  const removed = countDiffItems(
    record.removedCount ?? record.removed_count ?? record.removed ?? stats?.removed,
    changes.filter(change => change.kind === "removed").length
  );
  const changed = countDiffItems(
    record.changedCount ?? record.changed_count ?? record.changed ?? stats?.changed,
    changes.filter(change => change.kind === "changed").length
  );

  return {
    id: asString(record.id ?? record.diffId ?? record.diff_id, "artifact-diff"),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    leftEntryId: asString(
      record.leftEntryId ?? record.left_entry_id ?? record.leftId ?? record.left_id
    ),
    rightEntryId: asString(
      record.rightEntryId ?? record.right_entry_id ?? record.rightId ?? record.right_id
    ),
    title: asString(record.title ?? record.name, "Artifact diff"),
    summary: asString(
      record.summary ?? record.description ?? record.detail,
      `${added} added, ${removed} removed, ${changed} changed.`
    ),
    status: asString(record.status ?? record.state, "compared"),
    added,
    removed,
    changed,
    unchanged: countDiffItems(
      record.unchangedCount ??
        record.unchanged_count ??
        record.unchanged ??
        stats?.unchanged,
      0
    ),
    changes,
    createdAt: asString(record.createdAt ?? record.created_at),
  };
}

export function normalizeBlueprintArtifactDiffResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactDiffResponse {
  const record = asRecord(payload) ?? {};
  const diffValue =
    record.diff ?? record.artifactDiff ?? record.artifact_diff ?? record.comparison ?? record;

  return {
    job: record.job as BlueprintArtifactDiffResponse["job"],
    diff: normalizeBlueprintArtifactDiff(diffValue, fallbackJobId),
  };
}

export function normalizeBlueprintArtifactFeedback(
  value: unknown,
  index: number,
  fallbackJobId = ""
): BlueprintArtifactFeedback {
  const record = asRecord(value) ?? {};

  return {
    id: asString(record.id ?? record.feedbackId ?? record.feedback_id, `artifact-feedback-${index + 1}`),
    jobId: asString(record.jobId ?? record.job_id, fallbackJobId),
    entryId: asString(record.entryId ?? record.entry_id ?? record.ledgerEntryId),
    sentiment: asString(record.sentiment ?? record.mood ?? record.rating, "neutral"),
    status: asString(record.status ?? record.state ?? record.outcome, "recorded"),
    summary: asString(
      record.summary ?? record.title ?? record.description,
      "Artifact feedback recorded."
    ),
    notes: asString(record.notes ?? record.note ?? record.comment ?? record.detail),
    backfillTargets: asStringArray(
      record.backfillTargets ??
        record.backfill_targets ??
        record.targets ??
        record.targetIds ??
        record.target_ids
    ),
    createdAt: asString(record.createdAt ?? record.created_at ?? record.recordedAt),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
  };
}

function normalizeBlueprintArtifactFeedbackList(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactFeedback[] {
  const record = asRecord(payload) ?? {};
  const rawFeedback =
    record.artifactFeedback ??
    record.artifact_feedback ??
    record.feedbackEntries ??
    record.feedback_entries ??
    record.feedback ??
    [];
  return asUnknownArray(rawFeedback).map((item, index) =>
    normalizeBlueprintArtifactFeedback(item, index, fallbackJobId)
  );
}

export function normalizeBlueprintArtifactFeedbackResponse(
  payload: unknown,
  fallbackJobId = ""
): BlueprintArtifactFeedbackResponse {
  const record = asRecord(payload) ?? {};
  const feedbackValue =
    record.feedback ??
    record.artifactFeedback ??
    record.artifact_feedback ??
    record.item ??
    record;

  return {
    job: record.job as BlueprintArtifactFeedbackResponse["job"],
    feedback: normalizeBlueprintArtifactFeedback(feedbackValue, 0, fallbackJobId),
  };
}

export function normalizeBlueprintLatestGenerationJobResponse(
  payload: BlueprintLatestGenerationJobResponse
): BlueprintLatestGenerationJobSnapshot {
  const record = asRecord(payload) ?? {};
  const job = asRecord(record.job);
  const fallbackJobId = asString(job?.id);
  const effectPreviews = normalizeBlueprintEffectPreviewsResponse(
    payload,
    fallbackJobId
  ).effectPreviews;
  const rawRuntimeProjection =
    record.runtimeProjection ?? record.runtime_projection ?? record.projection;
  const agentCrew = normalizeBlueprintAgentCrew(
    record.agentCrew ?? record.agent_crew
  );
  const rawRoleTimelines = asUnknownArray(
    record.roleTimelines ?? record.role_timelines
  );
  const roleTimelines = rawRoleTimelines.length
    ? rawRoleTimelines.map(
        (item, index) =>
          normalizeBlueprintAgentCrewRoleTimeline(
            item,
            index,
            new Map((agentCrew?.roles ?? []).map(role => [role.id, role])),
            new Map(
              (agentCrew?.capabilityMatrix ?? []).map(binding => [
                binding.capabilityId,
                binding.capabilityLabel || binding.capabilityId,
              ])
            ),
            agentCrew?.stage ?? ""
          )
      )
    : agentCrew?.roleTimelines ?? [];
  return {
    ...payload,
    effectPreviews,
    promptPackages: normalizeBlueprintPromptPackagesResponse(
      payload,
      fallbackJobId
    ).promptPackages,
    capabilities: normalizeBlueprintCapabilityRegistryResponse(payload)
      .capabilities,
    agentCrew: agentCrew
      ? {
          ...agentCrew,
          roleTimelines,
          presence: roleTimelines.length ? roleTimelines : agentCrew.presence,
        }
      : null,
    roleTimelines,
    clarificationSession:
      record.clarificationSession || record.clarification_session
        ? normalizeBlueprintClarificationSession(
            record.clarificationSession ?? record.clarification_session
          )
        : undefined,
    runtimeProjection: rawRuntimeProjection
      ? normalizeBlueprintEffectPreviewRuntimeProjection(rawRuntimeProjection, {
          jobId: fallbackJobId,
          previewId: effectPreviews[0]?.id,
          treeId: effectPreviews[0]?.treeId,
          nodeId: effectPreviews[0]?.nodeId,
          title: effectPreviews[0]?.summary,
          summary: effectPreviews[0]?.summary,
          status: effectPreviews[0]?.status,
        })
      : undefined,
    capabilityInvocations: normalizeBlueprintCapabilityInvocationsResponse(
      payload,
      fallbackJobId
    ).invocations,
    capabilityEvidence: normalizeBlueprintCapabilityEvidenceResponse(
      payload,
      fallbackJobId
    ).evidence,
    landingPlans: normalizeBlueprintEngineeringLandingResponse(
      payload,
      fallbackJobId
    ).landingPlans,
    engineeringRuns: normalizeBlueprintEngineeringRunsResponse(
      payload,
      fallbackJobId
    ).engineeringRuns,
    artifactLedgerEntries: normalizeBlueprintArtifactLedgerResponse(
      payload,
      fallbackJobId
    ).entries,
    artifactReplays: normalizeBlueprintArtifactReplaysResponse(
      payload,
      fallbackJobId
    ).replays,
    artifactFeedback: normalizeBlueprintArtifactFeedbackList(
      payload,
      fallbackJobId
    ),
  };
}

function normalizeBlueprintCreateGenerationJobResponse(
  payload: unknown
): BlueprintCreateGenerationJobSnapshotResponse {
  const record = asRecord(payload) ?? {};
  return {
    ...(payload as BlueprintCreateGenerationJobResponse),
    intake: record.intake ? normalizeBlueprintIntake(record.intake) : undefined,
    clarificationSession:
      record.clarificationSession || record.clarification_session
        ? normalizeBlueprintClarificationSession(
            record.clarificationSession ?? record.clarification_session
          )
        : undefined,
    projectContext: record.projectContext
      ? normalizeBlueprintProjectDomainContext(record.projectContext)
      : record.project_context
        ? normalizeBlueprintProjectDomainContext(record.project_context)
        : undefined,
  };
}

function normalizeBlueprintGithubSource(value: unknown): BlueprintGithubSource {
  const record = asRecord(value) ?? {};
  return {
    id: asString(record.id ?? record.sourceId ?? record.source_id, "github-source"),
    kind: "repository",
    url: asString(record.url ?? record.githubUrl ?? record.github_url),
    normalizedUrl: asString(record.normalizedUrl ?? record.normalized_url ?? record.url),
    owner: asString(record.owner ?? record.repoOwner ?? record.repo_owner),
    repo: asString(record.repo ?? record.repository ?? record.name),
    slug: asString(record.slug ?? record.fullName ?? record.full_name),
    branch: asString(record.branch ?? record.ref ?? record.defaultBranch),
    path: asString(record.path ?? record.filePath ?? record.file_path),
    evidenceIds: asStringArray(
      record.evidenceIds ?? record.evidence_ids ?? record.evidence ?? []
    ),
    duplicateOf: asString(record.duplicateOf ?? record.duplicate_of),
  };
}

function normalizeBlueprintIntake(value: unknown): BlueprintIntake {
  const record = asRecord(value) ?? {};
  const sources = asUnknownArray(record.sources ?? record.githubSources ?? []);
  const duplicateSources = asUnknownArray(
    record.duplicateGithubUrls ?? record.duplicateGithubSources ?? []
  );

  return {
    id: asString(record.id ?? record.intakeId ?? record.intake_id, "intake"),
    projectId: asString(record.projectId ?? record.project_id),
    sourceId: asString(record.sourceId ?? record.source_id),
    targetText: asString(record.targetText ?? record.target_text),
    githubUrls: asStringArray(record.githubUrls ?? record.github_urls),
    sources: sources.map(item => normalizeBlueprintGithubSource(item)),
    duplicateGithubUrls: duplicateSources.map(item =>
      normalizeBlueprintGithubSource(item)
    ),
    domainNotes: asStringArray(record.domainNotes ?? record.domain_notes),
    assets: asUnknownArray(record.assets ?? record.domainAssets ?? []).map(
      item => (asRecord(item) ?? {}) as unknown as BlueprintIntake["assets"][number]
    ),
    evidence: asUnknownArray(record.evidence ?? record.domainEvidence ?? []).map(
      item => (asRecord(item) ?? {}) as unknown as BlueprintIntake["evidence"][number]
    ),
    readiness: {
      status: asString(
        asRecord(record.readiness)?.status ??
          record.readinessStatus ??
          record.readiness_status,
        "needs_answers"
      ) as BlueprintIntake["readiness"]["status"],
      score: asNumber(asRecord(record.readiness)?.score ?? record.readinessScore ?? record.readiness_score),
      answeredRequired: asNumber(
        asRecord(record.readiness)?.answeredRequired ??
          record.answeredRequired ??
          record.answered_required
      ),
      requiredTotal: asNumber(
        asRecord(record.readiness)?.requiredTotal ??
          record.requiredTotal ??
          record.required_total
      ),
      missingQuestionIds: asStringArray(
        asRecord(record.readiness)?.missingQuestionIds ??
          record.missingQuestionIds ??
          record.missing_question_ids
      ),
    },
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
  };
}

function normalizeBlueprintClarificationQuestion(
  value: unknown
): BlueprintClarificationStrategyQuestion {
  const record = asRecord(value) ?? {};
  const routeDimension = normalizeStringEnum(
    record.routeDimension ?? record.route_dimension,
    CLARIFICATION_ROUTE_DIMENSIONS
  );
  const readinessSignal = normalizeStringEnum(
    record.readinessSignal ?? record.readiness_signal,
    CLARIFICATION_READINESS_SIGNALS
  );
  return {
    id: asString(record.id ?? record.questionId ?? record.question_id, "question"),
    kind: asString(record.kind, "goal") as BlueprintClarificationSession["questions"][number]["kind"],
    prompt: asString(record.prompt ?? record.question ?? record.text),
    required: asBoolean(record.required ?? record.isRequired ?? record.is_required),
    sourceIds: asStringArray(record.sourceIds ?? record.source_ids),
    evidenceIds: asStringArray(record.evidenceIds ?? record.evidence_ids),
    strategyId: normalizeStringEnum(
      record.strategyId ?? record.strategy_id,
      CLARIFICATION_STRATEGY_IDS
    ),
    strategyLabel: asString(record.strategyLabel) || undefined,
    templateId: asString(record.templateId ?? record.template_id) || undefined,
    routeDimension,
    readinessSignal,
    settledByStrategy:
      record.settledByStrategy !== undefined ||
      record.settled_by_strategy !== undefined
        ? asBoolean(record.settledByStrategy ?? record.settled_by_strategy)
        : undefined,
    answerProvenance:
      record.answerProvenance ?? record.answer_provenance ?? undefined,
    routeReadySummary:
      asString(record.routeReadySummary ?? record.route_ready_summary) ||
      undefined,
  };
}

function normalizeBlueprintClarificationSession(
  value: unknown
): BlueprintClarificationStrategySession {
  const record = asRecord(value) ?? {};
  const routeDimension = normalizeStringEnum(
    record.routeDimension ?? record.route_dimension,
    CLARIFICATION_ROUTE_DIMENSIONS
  );
  const readinessSignal = normalizeStringEnum(
    record.readinessSignal ?? record.readiness_signal,
    CLARIFICATION_READINESS_SIGNALS
  );
  return {
    id: asString(record.id ?? record.sessionId ?? record.session_id, "clarification-session"),
    intakeId: asString(record.intakeId ?? record.intake_id),
    projectId: asString(record.projectId ?? record.project_id),
    strategyId: normalizeStringEnum(
      record.strategyId ?? record.strategy_id,
      CLARIFICATION_STRATEGY_IDS
    ),
    strategyLabel: asString(record.strategyLabel) || undefined,
    templateId: asString(record.templateId ?? record.template_id) || undefined,
    routeDimension,
    readinessSignal,
    settledByStrategy:
      record.settledByStrategy !== undefined ||
      record.settled_by_strategy !== undefined
        ? asBoolean(record.settledByStrategy ?? record.settled_by_strategy)
        : undefined,
    answerProvenance:
      record.answerProvenance ?? record.answer_provenance ?? undefined,
    routeReadySummary:
      asString(record.routeReadySummary ?? record.route_ready_summary) ||
      undefined,
    questions: asUnknownArray(record.questions ?? record.clarificationQuestions ?? []).map(
      item => normalizeBlueprintClarificationQuestion(item)
    ),
    answers: asUnknownArray(record.answers ?? record.clarificationAnswers ?? []).map(
      item => {
        const answerRecord = asRecord(item) ?? {};
        const answerProvenance = asRecord(
          answerRecord.provenance ??
            answerRecord.answerProvenance ??
            answerRecord.answer_provenance
        );
        return {
          questionId: asString(
            answerRecord.questionId ?? answerRecord.question_id,
            "question"
          ),
          answer: asString(answerRecord.answer ?? answerRecord.value),
          answeredAt:
            asString(answerRecord.answeredAt ?? answerRecord.answered_at) ||
            undefined,
          answeredBy:
            asString(answerRecord.answeredBy ?? answerRecord.answered_by) ||
            undefined,
          source: asString(answerRecord.source) as BlueprintClarificationAnswer["source"],
          strategyId: normalizeStringEnum(
            answerRecord.strategyId ??
              answerRecord.strategy_id ??
              answerProvenance?.strategyId ??
              answerProvenance?.strategy_id,
            CLARIFICATION_STRATEGY_IDS
          ),
          strategyLabel: asString(answerRecord.strategyLabel) || undefined,
          templateId:
            asString(
              answerRecord.templateId ??
                answerRecord.template_id ??
                answerProvenance?.templateId ??
                answerProvenance?.template_id
            ) || undefined,
          routeDimension: normalizeStringEnum(
            answerRecord.routeDimension ??
              answerRecord.route_dimension ??
              answerProvenance?.routeDimension ??
              answerProvenance?.route_dimension,
            CLARIFICATION_ROUTE_DIMENSIONS
          ),
          readinessSignal: normalizeStringEnum(
            answerRecord.readinessSignal ??
              answerRecord.readiness_signal ??
              answerProvenance?.readinessSignal ??
              answerProvenance?.readiness_signal,
            CLARIFICATION_READINESS_SIGNALS
          ),
          settledByStrategy:
            answerRecord.settledByStrategy !== undefined ||
            answerRecord.settled_by_strategy !== undefined
              ? asBoolean(
                  answerRecord.settledByStrategy ??
                    answerRecord.settled_by_strategy
                )
              : undefined,
          answerProvenance:
            answerRecord.provenance ??
            answerRecord.answerProvenance ??
            answerRecord.answer_provenance ??
            undefined,
          provenance: answerRecord.provenance as BlueprintClarificationAnswer["provenance"],
          routeReadySummary:
            asString(
              answerRecord.routeReadySummary ??
                answerRecord.route_ready_summary
            ) || undefined,
        };
      }
    ),
    readiness: {
      status: asString(
        asRecord(record.readiness)?.status ??
          record.readinessStatus ??
          record.readiness_status,
        "needs_answers"
      ) as BlueprintClarificationSession["readiness"]["status"],
      score: asNumber(asRecord(record.readiness)?.score ?? record.readinessScore ?? record.readiness_score),
      answeredRequired: asNumber(
        asRecord(record.readiness)?.answeredRequired ??
          record.answeredRequired ??
          record.answered_required
      ),
      requiredTotal: asNumber(
        asRecord(record.readiness)?.requiredTotal ??
          record.requiredTotal ??
          record.required_total
      ),
      missingQuestionIds: asStringArray(
        asRecord(record.readiness)?.missingQuestionIds ??
          record.missingQuestionIds ??
          record.missing_question_ids
      ),
      readinessSignal:
        normalizeStringEnum(
          asRecord(record.readiness)?.readinessSignal ??
            asRecord(record.readiness)?.readiness_signal ??
            record.readinessSignal ??
            record.readiness_signal,
          CLARIFICATION_READINESS_SIGNALS
        ),
      routeReadySummary:
        asString(
          asRecord(record.readiness)?.routeReadySummary ??
            asRecord(record.readiness)?.route_ready_summary ??
            record.routeReadySummary ??
            record.route_ready_summary
        ) || undefined,
    },
    createdAt: asString(record.createdAt ?? record.created_at),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
  };
}

function normalizeBlueprintProjectDomainContext(
  value: unknown
): BlueprintProjectDomainContext {
  const record = asRecord(value) ?? {};
  return {
    projectId: asString(record.projectId ?? record.project_id),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    intakeIds: asStringArray(record.intakeIds ?? record.intake_ids),
    sourceIds: asStringArray(record.sourceIds ?? record.source_ids),
    assets: asUnknownArray(record.assets ?? []).map(
      item => (asRecord(item) ?? {}) as unknown as BlueprintProjectDomainContext["assets"][number]
    ),
    evidence: asUnknownArray(record.evidence ?? []).map(
      item => (asRecord(item) ?? {}) as unknown as BlueprintProjectDomainContext["evidence"][number]
    ),
  };
}

function normalizeBlueprintIntakeResponse(payload: unknown): BlueprintIntakeResponse {
  const record = asRecord(payload) ?? {};
  const intakeValue = record.intake ?? record.data ?? record;
  return {
    intake: normalizeBlueprintIntake(intakeValue),
    clarificationSession: record.clarificationSession
      ? normalizeBlueprintClarificationSession(record.clarificationSession)
      : record.clarification_session
        ? normalizeBlueprintClarificationSession(record.clarification_session)
        : undefined,
    projectContext: record.projectContext
      ? normalizeBlueprintProjectDomainContext(record.projectContext)
      : record.project_context
        ? normalizeBlueprintProjectDomainContext(record.project_context)
        : undefined,
  };
}

function normalizeBlueprintIntakesResponse(payload: unknown): BlueprintIntakesResponse {
  const record = asRecord(payload) ?? {};
  const rawIntakes = record.intakes ?? record.items ?? record.data ?? [];
  return {
    intakes: asUnknownArray(rawIntakes).map(item => normalizeBlueprintIntake(item)),
    projectContext: record.projectContext
      ? normalizeBlueprintProjectDomainContext(record.projectContext)
      : record.project_context
        ? normalizeBlueprintProjectDomainContext(record.project_context)
        : undefined,
  };
}

function normalizeBlueprintClarificationSessionResponse(
  payload: unknown
): BlueprintClarificationSessionResponse {
  const record = asRecord(payload) ?? {};
  const sessionValue = record.clarificationSession ?? record.session ?? record.data ?? record;
  return {
    intake: record.intake ? normalizeBlueprintIntake(record.intake) : undefined,
    clarificationSession: normalizeBlueprintClarificationSession(sessionValue),
    projectContext: record.projectContext
      ? normalizeBlueprintProjectDomainContext(record.projectContext)
      : record.project_context
        ? normalizeBlueprintProjectDomainContext(record.project_context)
        : undefined,
  };
}

function normalizeBlueprintProjectContextResponse(
  payload: unknown
): BlueprintProjectContextResponse {
  const record = asRecord(payload) ?? {};
  const contextValue = record.projectContext ?? record.context ?? record.data ?? record;
  return {
    projectContext: normalizeBlueprintProjectDomainContext(contextValue),
  };
}

export async function fetchBlueprintSpecsProgress(): Promise<FetchBlueprintSpecsResult> {
  const result = await fetchJsonSafe<RawBlueprintSpecsResponse>(
    BLUEPRINT_SPECS_ENDPOINT
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintSpecsResponse(result.data),
  };
}

export async function createBlueprintIntake(
  request: BlueprintIntakeRequest
): Promise<CreateBlueprintIntakeResult> {
  const result = await fetchJsonSafe<unknown>(BLUEPRINT_INTAKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: normalizeBlueprintIntakeResponse(result.data) };
}

export async function fetchBlueprintIntakes(): Promise<FetchBlueprintIntakesResult> {
  const result = await fetchJsonSafe<unknown>(BLUEPRINT_INTAKE_ENDPOINT);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: normalizeBlueprintIntakesResponse(result.data) };
}

export async function fetchBlueprintIntake(
  intakeId: string
): Promise<FetchBlueprintIntakeResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_INTAKE_ENDPOINT}/${encodeURIComponent(intakeId)}`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: normalizeBlueprintIntakeResponse(result.data) };
}

export async function createBlueprintClarificationSession(
  intakeId: string,
  request: Record<string, unknown> = {}
): Promise<CreateBlueprintClarificationSessionResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_INTAKE_ENDPOINT}/${encodeURIComponent(intakeId)}/clarifications`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintClarificationSessionResponse(result.data),
  };
}

export async function fetchBlueprintClarificationSession(
  clarificationId: string
): Promise<FetchBlueprintClarificationSessionResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_INTAKE_ENDPOINT}/clarifications/${encodeURIComponent(clarificationId)}`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintClarificationSessionResponse(result.data),
  };
}

export async function saveBlueprintClarificationAnswers(
  clarificationId: string,
  request: BlueprintClarificationAnswersRequest,
  method: "POST" | "PATCH" = "POST"
): Promise<SaveBlueprintClarificationAnswersResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_INTAKE_ENDPOINT}/clarifications/${encodeURIComponent(clarificationId)}/answers`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintClarificationSessionResponse(result.data),
  };
}

export async function fetchBlueprintProjectContext(
  projectId: string
): Promise<FetchBlueprintProjectContextResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_PROJECTS_ENDPOINT}/${encodeURIComponent(projectId)}/context`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintProjectContextResponse(result.data),
  };
}

export async function createBlueprintGenerationJob(
  request: BlueprintGenerationRequest
): Promise<BlueprintGenerationJobResult> {
  const result = await fetchJsonSafe<unknown>(
    BLUEPRINT_JOBS_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCreateGenerationJobResponse(result.data),
  };
}

export async function createBlueprintGenerationCompatJob(
  request: BlueprintGenerationRequest
): Promise<BlueprintGenerationJobResult> {
  const result = await fetchJsonSafe<unknown>(
    BLUEPRINT_GENERATIONS_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCreateGenerationJobResponse(result.data),
  };
}

export async function fetchBlueprintJobEvents(
  jobId: string
): Promise<FetchBlueprintJobEventsResult> {
  const result = await fetchJsonSafe<BlueprintGenerationEventsResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/events`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export function fetchBlueprintJobEventStreamUrl(jobId: string): string {
  return `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/events/stream`;
}

export async function fetchLatestBlueprintGenerationJob(): Promise<FetchLatestBlueprintJobResult> {
  const result = await fetchJsonSafe<BlueprintLatestGenerationJobResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/latest`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintLatestGenerationJobResponse(result.data),
  };
}

export async function selectBlueprintRoute(
  jobId: string,
  request: BlueprintRouteSelectionRequest
): Promise<SelectBlueprintRouteResult> {
  const result = await fetchJsonSafe<BlueprintSelectRouteResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/route-selection`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function resetBlueprintRouteSelection(
  jobId: string
): Promise<ResetBlueprintRouteSelectionResult> {
  const result = await fetchJsonSafe<BlueprintResetRouteSelectionResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/route-selection`,
    {
      method: "DELETE",
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function updateBlueprintSpecTreeNode(
  jobId: string,
  nodeId: string,
  request: BlueprintUpdateSpecTreeNodeRequest
): Promise<UpdateBlueprintSpecTreeNodeResult> {
  const result = await fetchJsonSafe<BlueprintUpdateSpecTreeNodeResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-tree/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function saveBlueprintSpecTreeVersion(
  jobId: string,
  request?: { title?: string; summary?: string }
): Promise<SaveBlueprintSpecTreeVersionResult> {
  const result = await fetchJsonSafe<BlueprintSaveSpecTreeVersionResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-tree/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request ?? {}),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function runBlueprintSpecTreeAction(
  jobId: string,
  request: BlueprintSpecTreeActionRequest
): Promise<RunBlueprintSpecTreeActionResult> {
  const result = await fetchJsonSafe<BlueprintSpecTreeActionResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-tree/actions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function fetchBlueprintSpecDocuments(
  jobId: string
): Promise<FetchBlueprintSpecDocumentsResult> {
  const result = await fetchJsonSafe<BlueprintSpecDocumentsResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-documents`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function generateBlueprintSpecDocuments(
  jobId: string,
  request: BlueprintGenerateSpecDocumentsRequest
): Promise<GenerateBlueprintSpecDocumentsResult> {
  const result = await fetchJsonSafe<BlueprintSpecDocumentsResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-documents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function reviewBlueprintSpecDocument(
  jobId: string,
  documentId: string,
  request: BlueprintReviewSpecDocumentRequest
): Promise<ReviewBlueprintSpecDocumentResult> {
  const result = await fetchJsonSafe<BlueprintReviewSpecDocumentResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-documents/${encodeURIComponent(documentId)}/review`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function saveBlueprintSpecDocumentVersion(
  jobId: string,
  documentId: string,
  request: BlueprintSaveSpecDocumentVersionRequest = {}
): Promise<SaveBlueprintSpecDocumentVersionResult> {
  const result = await fetchJsonSafe<BlueprintSaveSpecDocumentVersionResponse>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/spec-documents/${encodeURIComponent(documentId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}

export async function fetchBlueprintEffectPreviews(
  jobId: string
): Promise<FetchBlueprintEffectPreviewsResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/effect-previews`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintEffectPreviewsResponse(result.data, jobId),
  };
}

export async function generateBlueprintEffectPreview(
  jobId: string,
  request: BlueprintGenerateEffectPreviewsRequest
): Promise<GenerateBlueprintEffectPreviewResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/effect-previews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintEffectPreviewsResponse(result.data, jobId),
  };
}

export async function fetchBlueprintPromptPackages(
  jobId: string
): Promise<FetchBlueprintPromptPackagesResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/prompt-packages`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintPromptPackagesResponse(result.data, jobId),
  };
}

export async function generateBlueprintPromptPackages(
  jobId: string,
  request: BlueprintGeneratePromptPackagesRequest
): Promise<GenerateBlueprintPromptPackagesResult> {
  const wireRequest = (() => {
    const legacyRequest = request as BlueprintGeneratePromptPackagesRequest & {
      platforms?: BlueprintPromptTargetPlatform[];
      previewId?: string;
    };
    const body: Record<string, unknown> = { ...legacyRequest };
    if (!body.targetPlatforms && Array.isArray(legacyRequest.platforms)) {
      body.targetPlatforms = legacyRequest.platforms;
    }
    delete body.platforms;
    delete body.previewId;
    return body;
  })();

  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/prompt-packages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wireRequest),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintPromptPackagesResponse(result.data, jobId),
  };
}

function capabilityQueryString(
  request?:
    | BlueprintFetchCapabilityInvocationsRequest
    | BlueprintFetchCapabilityEvidenceRequest
): string {
  const params = new URLSearchParams();
  if (request?.capabilityId) params.set("capabilityId", request.capabilityId);
  if (request?.nodeId) params.set("nodeId", request.nodeId);
  if (request?.routeId) params.set("routeId", request.routeId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchBlueprintCapabilities(): Promise<FetchBlueprintCapabilitiesResult> {
  const result = await fetchJsonSafe<unknown>(
    BLUEPRINT_CAPABILITIES_ENDPOINT
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCapabilityRegistryResponse(result.data),
  };
}

export async function fetchBlueprintJobCapabilities(
  jobId: string
): Promise<FetchBlueprintJobCapabilitiesResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/capabilities`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintJobCapabilitiesResponse(result.data),
  };
}

export async function fetchBlueprintCapabilityInvocations(
  jobId: string,
  request: BlueprintFetchCapabilityInvocationsRequest = {}
): Promise<FetchBlueprintCapabilityInvocationsResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/capability-invocations${capabilityQueryString(request)}`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCapabilityInvocationsResponse(result.data, jobId),
  };
}

export async function invokeBlueprintCapability(
  jobId: string,
  request: BlueprintInvokeRuntimeCapabilityRequest
): Promise<InvokeBlueprintCapabilityResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/capability-invocations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintInvokeCapabilityResponse(result.data, jobId),
  };
}

export async function fetchBlueprintCapabilityEvidence(
  jobId: string,
  request: BlueprintFetchCapabilityEvidenceRequest = {}
): Promise<FetchBlueprintCapabilityEvidenceResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/capability-evidence${capabilityQueryString(request)}`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCapabilityEvidenceResponse(result.data, jobId),
  };
}

export async function fetchBlueprintEngineeringLanding(
  jobId: string
): Promise<FetchBlueprintEngineeringLandingResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/engineering-landing`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintEngineeringLandingResponse(result.data, jobId),
  };
}

export async function generateBlueprintEngineeringLanding(
  jobId: string,
  request: BlueprintGenerateEngineeringLandingRequest = {}
): Promise<GenerateBlueprintEngineeringLandingResult> {
  const body: BlueprintGenerateEngineeringLandingRequest = {};
  if (request.promptPackageId) body.promptPackageId = request.promptPackageId;
  if (request.platform) body.platform = request.platform;

  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/engineering-landing`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintEngineeringLandingResponse(result.data, jobId),
  };
}

export async function fetchBlueprintEngineeringRuns(
  jobId: string
): Promise<FetchBlueprintEngineeringRunsResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/engineering-runs`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintEngineeringRunsResponse(result.data, jobId),
  };
}

export async function createBlueprintEngineeringRun(
  jobId: string,
  request: BlueprintCreateEngineeringRunRequest
): Promise<CreateBlueprintEngineeringRunResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/engineering-runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintCreateEngineeringRunResponse(result.data, jobId),
  };
}

export async function fetchBlueprintArtifactLedger(
  jobId: string
): Promise<FetchBlueprintArtifactLedgerResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/artifact-ledger`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintArtifactLedgerResponse(result.data, jobId),
  };
}

export async function replayBlueprintArtifact(
  jobId: string,
  request: BlueprintReplayArtifactRequest = {}
): Promise<ReplayBlueprintArtifactResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/artifact-replay`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintArtifactReplayResponse(result.data, jobId),
  };
}

export async function fetchBlueprintArtifactReplays(
  jobId: string
): Promise<FetchBlueprintArtifactReplaysResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/artifact-replays`
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintArtifactReplaysResponse(result.data, jobId),
  };
}

export async function diffBlueprintArtifacts(
  jobId: string,
  request: BlueprintDiffArtifactsRequest
): Promise<DiffBlueprintArtifactsResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/artifact-diff`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintArtifactDiffResponse(result.data, jobId),
  };
}

export async function recordBlueprintArtifactFeedback(
  jobId: string,
  request: BlueprintRecordArtifactFeedbackRequest
): Promise<RecordBlueprintArtifactFeedbackResult> {
  const result = await fetchJsonSafe<unknown>(
    `${BLUEPRINT_JOBS_ENDPOINT}/${encodeURIComponent(jobId)}/artifact-feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    data: normalizeBlueprintArtifactFeedbackResponse(result.data, jobId),
  };
}
