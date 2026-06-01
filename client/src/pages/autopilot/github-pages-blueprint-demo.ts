import type { ApiRequestError } from "@/lib/api-client";
import type {
  BlueprintAgentCrewSnapshot,
  BlueprintArtifactLedgerEntry,
  BlueprintArtifactReplay,
  BlueprintEffectPreviewSnapshot,
  BlueprintEngineeringLandingPlan,
  BlueprintEngineeringRun,
  BlueprintGenerationJobResult,
  BlueprintLatestGenerationJobSnapshot,
  BlueprintGenerateEngineeringLandingRequest,
  BlueprintGeneratePromptPackagesRequest,
  BlueprintPromptPackage,
  CreateBlueprintClarificationSessionResult,
  CreateBlueprintIntakeResult,
  FetchBlueprintProjectContextResult,
  FetchLatestBlueprintJobResult,
  GenerateBlueprintEffectPreviewResult,
  GenerateBlueprintEngineeringLandingResult,
  GenerateBlueprintPromptPackagesResult,
  GenerateBlueprintSpecDocumentsResult,
  SaveBlueprintClarificationAnswersResult,
  SelectBlueprintRouteResult,
} from "@/lib/blueprint-api";
import type {
  BlueprintAgentRole,
  BlueprintArtifactPayloadSummary,
  BlueprintCapabilityBinding,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationAnswer,
  BlueprintClarificationSession,
  BlueprintGenerateEffectPreviewsRequest,
  BlueprintGenerateSpecDocumentsRequest,
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationEventFamily,
  BlueprintGenerationEventType,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintGithubSource,
  BlueprintIntake,
  BlueprintIntakeRequest,
  BlueprintProjectDomainContext,
  BlueprintRolePresenceState,
  BlueprintRouteCandidate,
  BlueprintRouteSelection,
  BlueprintRouteSelectionRequest,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface GithubPagesBlueprintDemoRuntimeOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  now?: () => string;
}

export interface GithubPagesBlueprintDemoRuntime {
  fetchLatestGenerationJob: () => Promise<FetchLatestBlueprintJobResult>;
  fetchProjectContext: (
    projectId: string
  ) => Promise<FetchBlueprintProjectContextResult>;
  createIntake: (
    request: BlueprintIntakeRequest
  ) => Promise<CreateBlueprintIntakeResult>;
  createClarificationSession: (
    intakeId: string,
    request?: Record<string, unknown>
  ) => Promise<CreateBlueprintClarificationSessionResult>;
  saveClarificationAnswers: (
    clarificationId: string,
    request: { answers: BlueprintClarificationAnswer[]; answeredBy?: string },
    method?: "POST" | "PATCH"
  ) => Promise<SaveBlueprintClarificationAnswersResult>;
  createGenerationJob: (
    request: BlueprintGenerationRequest
  ) => Promise<BlueprintGenerationJobResult>;
  selectRoute: (
    jobId: string,
    request: BlueprintRouteSelectionRequest
  ) => Promise<SelectBlueprintRouteResult>;
  generateSpecDocuments: (
    jobId: string,
    request: BlueprintGenerateSpecDocumentsRequest
  ) => Promise<GenerateBlueprintSpecDocumentsResult>;
  generateEffectPreviews: (
    jobId: string,
    request: BlueprintGenerateEffectPreviewsRequest
  ) => Promise<GenerateBlueprintEffectPreviewResult>;
  generatePromptPackages: (
    jobId: string,
    request: BlueprintGeneratePromptPackagesRequest
  ) => Promise<GenerateBlueprintPromptPackagesResult>;
  generateEngineeringLanding: (
    jobId: string,
    request?: BlueprintGenerateEngineeringLandingRequest
  ) => Promise<GenerateBlueprintEngineeringLandingResult>;
}

interface GithubPagesBlueprintDemoState {
  sequence: number;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  projectContext?: BlueprintProjectDomainContext;
  job?: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  selection?: BlueprintRouteSelection;
  specTree?: BlueprintSpecTree;
  capabilities: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrewSnapshot;
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  promptPackages: BlueprintPromptPackage[];
  landingPlans: BlueprintEngineeringLandingPlan[];
  engineeringRuns: BlueprintEngineeringRun[];
  artifactEntries: BlueprintArtifactLedgerEntry[];
  artifactReplays: BlueprintArtifactReplay[];
}

const DEFAULT_STORAGE_KEY = "whybuddy:autopilot:pages-blueprint-demo";

function makeApiError(message: string, endpoint: string): ApiRequestError {
  return {
    kind: "error",
    source: "storage",
    endpoint,
    message,
    detail: message,
    retryable: false,
  };
}

function readStorage(options: GithubPagesBlueprintDemoRuntimeOptions): StorageLike | null {
  if (options.storage !== undefined) return options.storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createEmptyState(): GithubPagesBlueprintDemoState {
  return {
    sequence: 0,
    capabilities: buildDefaultCapabilities(),
    capabilityInvocations: [],
    capabilityEvidence: [],
    effectPreviews: [],
    promptPackages: [],
    landingPlans: [],
    engineeringRuns: [],
    artifactEntries: [],
    artifactReplays: [],
  };
}

function loadState(
  storage: StorageLike | null,
  storageKey: string
): GithubPagesBlueprintDemoState {
  if (!storage) return createEmptyState();
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw) as Partial<GithubPagesBlueprintDemoState>;
    return {
      ...createEmptyState(),
      ...parsed,
      capabilities: parsed.capabilities?.length
        ? parsed.capabilities
        : buildDefaultCapabilities(),
      capabilityInvocations: parsed.capabilityInvocations ?? [],
      capabilityEvidence: parsed.capabilityEvidence ?? [],
      effectPreviews: parsed.effectPreviews ?? [],
      promptPackages: parsed.promptPackages ?? [],
      landingPlans: parsed.landingPlans ?? [],
      engineeringRuns: parsed.engineeringRuns ?? [],
      artifactEntries: parsed.artifactEntries ?? [],
      artifactReplays: parsed.artifactReplays ?? [],
    };
  } catch {
    storage.removeItem(storageKey);
    return createEmptyState();
  }
}

function persistState(
  storage: StorageLike | null,
  storageKey: string,
  state: GithubPagesBlueprintDemoState
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Static Pages mode must never block the UI on storage quota/privacy errors.
  }
}

function createClock(options: GithubPagesBlueprintDemoRuntimeOptions): () => string {
  return options.now ?? (() => new Date().toISOString());
}

function nextId(state: GithubPagesBlueprintDemoState, prefix: string): string {
  state.sequence += 1;
  return `pages-${prefix}-${String(state.sequence).padStart(4, "0")}`;
}

function normalizeGithubUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseGithubSource(url: string, index: number): BlueprintGithubSource {
  const normalizedUrl = normalizeGithubUrl(url);
  const match = normalizedUrl.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  const owner = match?.[1] ?? "demo";
  const repo = (match?.[2] ?? `repository-${index + 1}`).replace(/\.git$/i, "");
  return {
    id: `pages-github-source-${index + 1}`,
    kind: "repository",
    url,
    normalizedUrl,
    owner,
    repo,
    slug: `${owner}/${repo}`,
    branch: "main",
    evidenceIds: [`pages-evidence-github-${index + 1}`],
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function summarizeTarget(targetText: string | undefined, githubUrls: string[]): string {
  const normalized = targetText?.replace(/\s+/g, " ").trim();
  if (normalized) {
    return normalized.length > 96 ? `${normalized.slice(0, 93).trim()}...` : normalized;
  }
  return githubUrls[0]?.replace(/^https:\/\/github\.com\//i, "GitHub ") ?? "Pages demo target";
}

function buildProjectContext(input: {
  state: GithubPagesBlueprintDemoState;
  now: string;
  projectId?: string;
  intake?: BlueprintIntake;
  targetText?: string;
  githubUrls?: string[];
}): BlueprintProjectDomainContext {
  const projectId = input.projectId ?? "github-pages-demo-project";
  const githubUrls = input.githubUrls ?? input.intake?.githubUrls ?? [];
  const sources = input.intake?.sources ?? githubUrls.map(parseGithubSource);
  const targetText = input.targetText ?? input.intake?.targetText ?? "";
  const evidence = [
    ...(targetText
      ? [
          {
            id: "pages-evidence-target",
            kind: "intake_text" as const,
            label: "Target",
            summary: summarizeTarget(targetText, githubUrls),
            value: targetText,
            createdAt: input.now,
          },
        ]
      : []),
    ...sources.map((source, index) => ({
      id: `pages-evidence-github-${index + 1}`,
      kind: "github_url" as const,
      label: `GitHub ${source.slug}`,
      summary: `Static Pages demo source normalized from ${source.normalizedUrl}.`,
      value: source.normalizedUrl,
      sourceId: source.id,
      createdAt: input.now,
    })),
  ];
  const assets = [
    {
      id: "pages-asset-product-goal",
      kind: "product_goal" as const,
      title: "Autopilot target",
      summary: summarizeTarget(targetText, githubUrls),
      sourceIds: sources.map(source => source.id),
      evidenceIds: evidence.map(item => item.id),
      tags: ["pages", "autopilot", "demo"],
      createdAt: input.now,
    },
    ...sources.map(source => ({
      id: `pages-asset-${source.owner}-${source.repo}`,
      kind: "github_repository" as const,
      title: source.slug,
      summary: `Repository context available to the static Pages simulator.`,
      sourceIds: [source.id],
      evidenceIds: source.evidenceIds,
      tags: ["github", "static-demo"],
      createdAt: input.now,
    })),
  ];
  return {
    projectId,
    updatedAt: input.now,
    intakeIds: input.intake ? [input.intake.id] : [],
    sourceIds: sources.map(source => source.id),
    assets,
    evidence,
  };
}

function buildDefaultCapabilities(): BlueprintRuntimeCapability[] {
  return [
    {
      id: "docker-analysis-sandbox",
      label: "Docker analysis sandbox",
      kind: "docker",
      purpose: "Simulate isolated repository analysis for static Pages.",
      description: "Static demo adapter mirroring the Docker analysis sandbox contract.",
      tags: ["runtime", "sandbox", "pages-demo"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.docker.pages-demo",
      inputSchema: "text/plain",
      outputTypes: ["log", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "mcp-github-source",
      label: "GitHub source reader",
      kind: "mcp",
      purpose: "Represent repository source inspection without a backend MCP server.",
      description: "Browser-side static projection of repository evidence.",
      tags: ["runtime", "mcp", "github", "pages-demo"],
      securityLevel: "networked",
      status: "available",
      adapter: "blueprint.runtime.mcp.github.pages-demo",
      inputSchema: "application/json",
      outputTypes: ["document", "log"],
      supportedStages: ["route_generation", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "aigc-spec-node",
      label: "AIGC SPEC derivation node",
      kind: "aigc_node",
      purpose: "Derive SPEC tree candidates in the static simulator.",
      description: "Deterministic AIGC-node projection for Pages demos.",
      tags: ["runtime", "aigc", "spec", "pages-demo"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.aigc.spec-node.pages-demo",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "role-system-architecture",
      label: "System architecture role",
      kind: "role",
      purpose: "Review architecture risks and handoff readiness.",
      description: "Static specialist-role projection for Pages demos.",
      tags: ["runtime", "role", "architecture"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.role.system-architecture.pages-demo",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "safety"],
      supportedStages: ["route_generation", "prompt_packaging", "runtime_capability"],
      requiresApproval: false,
      projectScoped: false,
    },
    {
      id: "skill-svg-architecture",
      label: "SVG architecture skill",
      kind: "skill",
      purpose: "Produce preview and diagram evidence.",
      description: "Static skill projection for visual architecture evidence.",
      tags: ["runtime", "skill", "diagram"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.skill.svg-architecture.pages-demo",
      inputSchema: "text/markdown",
      outputTypes: ["diagram", "document"],
      supportedStages: ["effect_preview", "runtime_capability"],
      requiresApproval: false,
      projectScoped: false,
    },
  ];
}

function buildAgentRoles(): BlueprintAgentRole[] {
  return [
    {
      id: "role-product-decision",
      name: "Product Decision Lead",
      group: "decision",
      responsibility: "Clarify product intent and route selection criteria.",
      defaultStages: ["input", "clarification", "route_generation", "spec_tree"],
      permissions: ["read_domain_context", "select_route"],
      displayName: "Product Decision Lead",
      displayLabelZh: "Product Decision",
    },
    {
      id: "role-architecture-planner",
      name: "Architecture Planner",
      group: "planning",
      responsibility: "Plan RouteSet structure, SPEC tree shape, and module boundaries.",
      defaultStages: ["route_generation", "spec_tree", "engineering_landing"],
      permissions: ["plan_routes", "shape_spec_tree"],
      displayName: "Architecture Planner",
      displayLabelZh: "Architecture Planner",
    },
    {
      id: "role-runtime-executor",
      name: "Runtime Executor",
      group: "execution",
      responsibility: "Invoke sandbox, source, AIGC, and skill capabilities.",
      defaultStages: ["route_generation", "spec_tree", "effect_preview"],
      permissions: ["invoke_bound_capabilities", "record_logs"],
      displayName: "Runtime Executor",
      displayLabelZh: "Runtime Executor",
    },
    {
      id: "role-quality-auditor",
      name: "Quality Auditor",
      group: "audit",
      responsibility: "Review consistency, risk, and evidence completeness.",
      defaultStages: ["clarification", "route_generation", "spec_tree"],
      permissions: ["review_artifacts", "request_evidence"],
      displayName: "Quality Auditor",
      displayLabelZh: "Quality Auditor",
    },
    {
      id: "role-experience-presenter",
      name: "Experience Presenter",
      group: "presentation",
      responsibility: "Translate progress into HUD, logs, and previews.",
      defaultStages: ["route_generation", "effect_preview", "prompt_packaging"],
      permissions: ["summarize_progress", "render_preview_state"],
      displayName: "Experience Presenter",
      displayLabelZh: "Experience Presenter",
    },
    {
      id: "role-memory-curator",
      name: "Memory Curator",
      group: "memory",
      responsibility: "Persist artifact lineage, evidence, replay, and handoff context.",
      defaultStages: ["input", "clarification", "route_generation", "spec_tree"],
      permissions: ["write_artifact_memory", "link_lineage"],
      displayName: "Memory Curator",
      displayLabelZh: "Memory Curator",
    },
  ];
}

function buildCapabilityMatrix(capabilities: BlueprintRuntimeCapability[]): BlueprintCapabilityBinding[] {
  const capabilityById = new Map(capabilities.map(capability => [capability.id, capability]));
  const roleById = new Map(buildAgentRoles().map(role => [role.id, role]));
  const bindings: ReadonlyArray<readonly [string, string, string]> = [
    ["role-runtime-executor", "docker-analysis-sandbox", "docker.analysis.sandbox"],
    ["role-runtime-executor", "mcp-github-source", "mcp.github.source"],
    ["role-runtime-executor", "aigc-spec-node", "aigc.spec.derivation"],
    ["role-architecture-planner", "role-system-architecture", "role.system.architecture"],
    ["role-quality-auditor", "role-system-architecture", "role.audit.architecture"],
    ["role-experience-presenter", "skill-svg-architecture", "skill.svg.architecture"],
    ["role-memory-curator", "aigc-spec-node", "memory.artifact.retrieval"],
  ];
  return bindings
    .flatMap(([roleId, capabilityId, nodeId]) => {
      const capability = capabilityById.get(capabilityId);
      const role = roleById.get(roleId);
      if (!capability || !role) return [];
      return [{
        id: `pages-binding-${roleId}-${capabilityId}`,
        roleId,
        capabilityId,
        nodeId,
        applicableStages: capability.supportedStages,
        inputSchema: capability.inputSchema,
        outputSchema: "application/json",
        tools: capability.tags,
        requiresSandbox: capability.securityLevel === "sandboxed",
        producesArtifacts: true,
        auditRules: ["static-pages-demo", "preserve-visible-evidence"],
        capabilityLabel: capability.label,
        capabilityKind: capability.kind,
        roleDisplayName: role.displayName,
      }];
    });
}

function resolveRoleState(roleId: string, stage: BlueprintGenerationJob["stage"]): BlueprintRolePresenceState {
  if (stage === "route_generation") {
    if (
      ["role-product-decision", "role-architecture-planner", "role-runtime-executor"].includes(roleId)
    ) {
      return "active";
    }
    if (roleId === "role-quality-auditor") return "reviewing";
    return "watching";
  }
  if (stage === "spec_tree") {
    if (["role-architecture-planner", "role-runtime-executor"].includes(roleId)) return "active";
    if (roleId === "role-quality-auditor") return "reviewing";
    return "watching";
  }
  if (stage === "clarification") {
    return roleId === "role-product-decision" ? "active" : "watching";
  }
  return roleId === "role-memory-curator" ? "watching" : "sleeping";
}

function buildAgentCrewSnapshot(input: {
  jobId: string;
  stage: BlueprintGenerationJob["stage"];
  createdAt: string;
  capabilities: BlueprintRuntimeCapability[];
  artifactIds?: string[];
  evidenceIds?: string[];
}): BlueprintAgentCrewSnapshot {
  const roles = buildAgentRoles();
  const capabilityMatrix = buildCapabilityMatrix(input.capabilities);
  const roleTimelines = roles.map(role => {
    const state = resolveRoleState(role.id, input.stage);
    const capabilityIds = capabilityMatrix
      .filter(binding => binding.roleId === role.id)
      .map(binding => binding.capabilityId);
    const capabilityLabels = capabilityMatrix
      .filter(binding => binding.roleId === role.id)
      .map(binding => binding.capabilityLabel);
    return {
      id: `pages-role-timeline-${input.jobId}-${role.id}`,
      jobId: input.jobId,
      roleId: role.id,
      roleName: role.name,
      displayName: role.displayName,
      displayLabel: role.displayLabelZh,
      group: role.group,
      stage: input.stage,
      state,
      currentAction:
        state === "sleeping"
          ? `${role.displayName} is on standby.`
          : `${role.displayName} is ${state} for ${input.stage}.`,
      capabilityIds,
      capabilityLabels,
      artifactIds: input.artifactIds ?? [],
      evidenceIds: input.evidenceIds ?? [],
      latestArtifact: input.artifactIds?.[0],
      latestEvidence: input.evidenceIds?.[0],
      latestCapability: capabilityIds[0],
      entryCount: 1,
      entries: [],
    };
  });
  return {
    id: `pages-agent-crew-${input.jobId}`,
    jobId: input.jobId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    stage: input.stage,
    roles,
    capabilityMatrix,
    activationPolicies: [],
    presence: roleTimelines,
    roleTimelines,
    sourceIds: {
      capabilityIds: input.capabilities.map(capability => capability.id),
      artifactIds: input.artifactIds ?? [],
      evidenceIds: input.evidenceIds ?? [],
    },
  };
}

function mapEventFamily(type: BlueprintGenerationEventType): BlueprintGenerationEventFamily {
  const prefix = type.split(".")[0] as BlueprintGenerationEventFamily;
  return [
    "job",
    "clarification",
    "route",
    "spec",
    "preview",
    "prompt",
    "mission",
    "evidence",
    "role",
    "capability",
    "crew",
    "sandbox",
  ].includes(prefix)
    ? prefix
    : "job";
}

function createEvent(input: {
  state: GithubPagesBlueprintDemoState;
  jobId: string;
  projectId?: string;
  type: BlueprintGenerationEventType;
  stage: BlueprintGenerationJob["stage"];
  status: BlueprintGenerationJob["status"];
  message: string;
  occurredAt: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  artifactId?: string;
  capabilityId?: string;
  evidenceId?: string;
  payload?: unknown;
}): BlueprintGenerationEvent {
  return {
    id: nextId(input.state, "event"),
    jobId: input.jobId,
    projectId: input.projectId,
    type: input.type,
    family: mapEventFamily(input.type),
    stage: input.stage,
    status: input.status,
    message: input.message,
    occurredAt: input.occurredAt,
    routeId: input.routeId,
    selectionId: input.selectionId,
    specTreeId: input.specTreeId,
    nodeId: input.nodeId,
    artifactId: input.artifactId,
    capabilityId: input.capabilityId,
    evidenceId: input.evidenceId,
    payload: input.payload,
  };
}

function createArtifact(
  state: GithubPagesBlueprintDemoState,
  type: BlueprintGenerationArtifact["type"],
  title: string,
  summary: string,
  createdAt: string,
  payload?: unknown
): BlueprintGenerationArtifact {
  return {
    id: nextId(state, "artifact"),
    type,
    title,
    summary,
    createdAt,
    payload,
  };
}

function buildRouteSet(input: {
  state: GithubPagesBlueprintDemoState;
  request: BlueprintGenerationRequest;
  createdAt: string;
}): BlueprintRouteSet {
  const routeSetId = nextId(input.state, "routeset");
  const primaryRouteId = `${routeSetId}:primary`;
  const target = summarizeTarget(input.request.targetText, input.request.githubUrls ?? []);
  const capabilityUsage = (ids: string[]) =>
    ids.map(id => {
      const capability = input.state.capabilities.find(item => item.id === id) ?? input.state.capabilities[0];
      return {
        id: capability.id,
        label: capability.label,
        kind: capability.kind,
        purpose: capability.purpose,
      };
    });
  const makeRoute = (
    id: string,
    kind: BlueprintRouteCandidate["kind"],
    title: string,
    summary: string,
    riskLevel: BlueprintRouteCandidate["riskLevel"],
    costLevel: BlueprintRouteCandidate["costLevel"],
    complexity: BlueprintRouteCandidate["complexity"],
    capabilityIds: string[]
  ): BlueprintRouteCandidate => ({
    id,
    kind,
    title,
    summary,
    rationale: `${title} keeps ${target} moving through a deterministic static Pages demonstration.`,
    riskLevel,
    costLevel,
    complexity,
    estimatedEffort:
      complexity === "deep" ? "3 focused implementation passes" : "1 focused implementation pass",
    capabilities: capabilityUsage(capabilityIds),
    steps: [
      {
        id: `${id}:clarify`,
        title: "Clarify intent",
        description: "Capture target, repository signals, and acceptance boundaries.",
        role: "Product Decision Lead",
        status: "ready",
      },
      {
        id: `${id}:derive`,
        title: "Derive SPEC tree",
        description: "Map route evidence into durable requirements, design, and task nodes.",
        role: "Architecture Planner",
        status: "ready",
      },
      {
        id: `${id}:handoff`,
        title: "Prepare handoff",
        description: "Expose reviewable assets in the right rail without backend fetches.",
        role: "Runtime Executor",
        status: "ready",
      },
    ],
    outputs: ["RouteSet", "SPEC tree seed", "Capability evidence", "Review handoff"],
  });

  return {
    id: routeSetId,
    requestId: input.request.intakeId ?? routeSetId,
    createdAt: input.createdAt,
    primaryRouteId,
    routes: [
      makeRoute(
        primaryRouteId,
        "primary",
        "Primary SPEC asset route",
        `Build the shortest reviewable SPEC-first path for ${target}.`,
        "low",
        "medium",
        "balanced",
        ["mcp-github-source", "docker-analysis-sandbox", "aigc-spec-node"]
      ),
      makeRoute(
        `${routeSetId}:docs-first`,
        "alternative",
        "Documentation-first conservative route",
        "Freeze requirements and task evidence before preview work.",
        "low",
        "low",
        "light",
        ["aigc-spec-node", "role-system-architecture"]
      ),
      makeRoute(
        `${routeSetId}:preview-first`,
        "alternative",
        "Preview-first exploratory route",
        "Surface effect previews early, then backfill SPEC documents from the chosen direction.",
        "medium",
        "medium",
        "deep",
        ["skill-svg-architecture", "docker-analysis-sandbox", "role-system-architecture"]
      ),
    ],
    nextAsset: {
      type: "spec_tree",
      menu: "deduction",
      description: "Use the selected RouteSet path as the source asset for SPEC tree review.",
    },
    provenance: {
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      clarificationSessionId: input.request.clarificationSessionId,
      generationSource: "template",
      promptId: "github-pages.blueprint.routeset.v1",
      model: "static-pages-demo",
    },
  };
}

function createCapabilitySnapshots(input: {
  state: GithubPagesBlueprintDemoState;
  jobId: string;
  projectId?: string;
  request: BlueprintGenerationRequest;
  routeSet: BlueprintRouteSet;
  createdAt: string;
}): {
  invocations: BlueprintCapabilityInvocation[];
  evidence: BlueprintCapabilityEvidence[];
} {
  const selectedCapabilities = [
    "mcp-github-source",
    "docker-analysis-sandbox",
    "aigc-spec-node",
    "role-system-architecture",
    "skill-svg-architecture",
  ]
    .map(id => input.state.capabilities.find(capability => capability.id === id))
    .filter((capability): capability is BlueprintRuntimeCapability => Boolean(capability));
  const invocations = selectedCapabilities.map((capability, index) => {
    const route = input.routeSet.routes[index % input.routeSet.routes.length];
    const invocation: BlueprintCapabilityInvocation = {
      id: nextId(input.state, "capability-invocation"),
      jobId: input.jobId,
      capabilityId: capability.id,
      roleId:
        capability.kind === "role"
          ? "role-architecture-planner"
          : capability.kind === "skill"
            ? "role-experience-presenter"
            : "role-runtime-executor",
      capabilityLabel: capability.label,
      kind: capability.kind,
      status: "completed",
      securityLevel: capability.securityLevel,
      safetyGate: {
        status: "allowed",
        reason: `${capability.label} allowed in the static Pages simulator.`,
        requiresApproval: false,
        approved: true,
        securityLevel: capability.securityLevel,
      },
      requestedAt: input.createdAt,
      completedAt: input.createdAt,
      requestedBy: "github-pages-demo",
      routeId: route.id,
      input: `Static Pages simulation for ${route.title}.`,
      outputSummary: `${capability.label} produced deterministic evidence for ${route.title}.`,
      logs: [
        `[pages-demo] ${capability.id} started`,
        `[pages-demo] ${capability.id} completed without backend API`,
      ],
      evidenceIds: [],
      durationMs: 120 + index * 35,
      provenance: {
        jobId: input.jobId,
        projectId: input.projectId,
        sourceId: input.request.sourceId,
        routeSetId: input.routeSet.id,
        routeId: route.id,
        roleId:
          capability.kind === "role"
            ? "role-architecture-planner"
            : capability.kind === "skill"
              ? "role-experience-presenter"
              : "role-runtime-executor",
        targetText: input.request.targetText,
        githubUrls: input.request.githubUrls ?? [],
        executionMode: "simulated_fallback",
        artifactUrl: `pages-demo://${input.jobId}/${capability.id}`,
      },
    };
    return invocation;
  });
  const evidence: BlueprintCapabilityEvidence[] = invocations.map(invocation => {
    const capability = input.state.capabilities.find(item => item.id === invocation.capabilityId)!;
    const payloadSummary: BlueprintArtifactPayloadSummary = {
      invocationId: invocation.id,
      capabilityId: capability.id,
      durationMs: invocation.durationMs,
      staticPages: true,
    };
    const kind: BlueprintCapabilityEvidence["kind"] =
      capability.kind === "skill"
        ? "diagram"
        : capability.kind === "role"
          ? "safety"
          : "analysis";
    return {
      id: nextId(input.state, "capability-evidence"),
      jobId: input.jobId,
      invocationId: invocation.id,
      capabilityId: capability.id,
      capabilityLabel: capability.label,
      kind,
      status: "recorded",
      title: `Static evidence: ${capability.label}`,
      summary: `${capability.label} evidence is generated locally for the GitHub Pages demo.`,
      createdAt: input.createdAt,
      routeSetId: input.routeSet.id,
      routeId: invocation.routeId,
      artifacts: [`pages-demo:${invocation.id}`],
      logs: invocation.logs,
      tags: uniqueStrings(["pages-demo", capability.kind, ...capability.tags]),
      payloadSummary,
      provenance: {
        jobId: input.jobId,
        projectId: input.projectId,
        sourceId: input.request.sourceId,
        routeSetId: input.routeSet.id,
        routeId: invocation.routeId,
        targetText: input.request.targetText,
        githubUrls: input.request.githubUrls ?? [],
        executionMode: "simulated_fallback",
        artifactUrl: `pages-demo://${input.jobId}/${capability.id}`,
      },
    };
  });
  return {
    invocations: invocations.map(invocation => ({
      ...invocation,
      evidenceIds: evidence
        .filter(item => item.invocationId === invocation.id)
        .map(item => item.id),
    })),
    evidence,
  };
}

function buildSpecTree(input: {
  state: GithubPagesBlueprintDemoState;
  job: BlueprintGenerationJob;
  routeSet: BlueprintRouteSet;
  selection: BlueprintRouteSelection;
  selectedRoute: BlueprintRouteCandidate;
  createdAt: string;
}): BlueprintSpecTree {
  const treeId = nextId(input.state, "spec-tree");
  const rootNodeId = `${treeId}:root`;
  const nodes: BlueprintSpecTreeNode[] = [
    {
      id: rootNodeId,
      title: "Autopilot static Pages blueprint",
      summary: `Root SPEC tree for ${summarizeTarget(input.job.request.targetText, input.job.request.githubUrls ?? [])}.`,
      type: "root",
      status: "draft",
      priority: 0,
      routeId: input.selectedRoute.id,
      dependencies: [],
      outputs: ["requirements.md", "design.md", "tasks.md"],
      children: [`${treeId}:requirements`, `${treeId}:runtime`, `${treeId}:handoff`],
      metadata: { staticPages: true },
    },
    {
      id: `${treeId}:requirements`,
      parentId: rootNodeId,
      title: "Requirements and acceptance",
      summary: "Capture target, repository boundaries, and static demo acceptance criteria.",
      type: "spec_document",
      status: "draft",
      priority: 1,
      routeId: input.selectedRoute.id,
      routeStepId: input.selectedRoute.steps[0]?.id,
      dependencies: [],
      outputs: ["requirements.md"],
      children: [],
    },
    {
      id: `${treeId}:runtime`,
      parentId: rootNodeId,
      title: "Browser runtime simulator",
      summary: "Keep Pages mode on local deterministic state and avoid backend blueprint API calls.",
      type: "spec_document",
      status: "draft",
      priority: 2,
      routeId: input.selectedRoute.id,
      routeStepId: input.selectedRoute.steps[1]?.id,
      dependencies: [`${treeId}:requirements`],
      outputs: ["github-pages-blueprint-demo.ts"],
      children: [],
    },
    {
      id: `${treeId}:handoff`,
      parentId: rootNodeId,
      title: "Review handoff and right rail evidence",
      summary: "Expose selected route, SPEC tree, capabilities, evidence, and replay data from local state.",
      type: "engineering_plan",
      status: "draft",
      priority: 3,
      routeId: input.selectedRoute.id,
      routeStepId: input.selectedRoute.steps[2]?.id,
      dependencies: [`${treeId}:runtime`],
      outputs: ["right-rail snapshot", "artifact replay"],
      children: [],
    },
    {
      id: `${treeId}:verification`,
      parentId: rootNodeId,
      title: "Static smoke verification",
      summary: "Build Pages, serve under repository base path, click through intake, route generation, and selection.",
      type: "engineering_plan",
      status: "draft",
      priority: 4,
      routeId: input.selectedRoute.id,
      dependencies: [`${treeId}:handoff`],
      outputs: ["browser smoke evidence"],
      children: [],
    },
  ];
  return {
    id: treeId,
    routeSetId: input.routeSet.id,
    selectionId: input.selection.id,
    selectedPathId: input.selection.selectedPathId,
    selectedRouteId: input.selectedRoute.id,
    rootNodeId,
    version: 1,
    status: "reviewing",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    alternativeRouteIds: input.selection.mergedAlternativeRouteIds,
    nodes,
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.selectedRoute.id,
      selectionId: input.selection.id,
      selectedPathId: input.selection.selectedPathId,
      specTreeId: treeId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      reusedEvidenceIds: input.state.capabilityEvidence.map(item => item.id),
      generationSource: "template",
      promptId: "github-pages.blueprint.spec-tree.v1",
      model: "static-pages-demo",
    },
  };
}

const SPEC_DOCUMENT_TYPES: BlueprintSpecDocumentType[] = [
  "requirements",
  "design",
  "tasks",
];

function buildSpecDocuments(input: {
  state: GithubPagesBlueprintDemoState;
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  request: BlueprintGenerateSpecDocumentsRequest;
  createdAt: string;
}): BlueprintSpecDocument[] {
  const requestedTypes =
    input.request.types && input.request.types.length > 0
      ? input.request.types
      : SPEC_DOCUMENT_TYPES;
  const selectedTypes = SPEC_DOCUMENT_TYPES.filter(type =>
    requestedTypes.includes(type)
  );
  const targetNodes = input.request.nodeId
    ? input.specTree.nodes.filter(node => node.id === input.request.nodeId)
    : input.specTree.nodes.filter(node => node.id !== input.specTree.rootNodeId);
  const nodes = targetNodes.length > 0 ? targetNodes : [input.specTree.nodes[0]];

  return nodes.flatMap(node =>
    selectedTypes.map(type => {
      const titlePrefix =
        type === "requirements"
          ? "Requirements"
          : type === "design"
            ? "Design"
            : "Tasks";
      const id = nextId(input.state, `spec-${type}`);
      return {
        id,
        jobId: input.job.id,
        treeId: input.specTree.id,
        nodeId: node.id,
        type,
        status: "accepted",
        version: 1,
        sourceDocumentId: id,
        title: `${titlePrefix}: ${node.title}`,
        summary: `${titlePrefix} document generated locally for ${node.title}.`,
        content: [
          `# ${titlePrefix}: ${node.title}`,
          "",
          `Static GitHub Pages demo document for ${summarizeTarget(
            input.job.request.targetText,
            input.job.request.githubUrls ?? []
          )}.`,
          "",
          "## Scope",
          node.summary,
          "",
          "## Acceptance",
          "- The Autopilot Pages flow advances without backend blueprint APIs.",
          "- The right rail receives a job snapshot, SPEC tree, documents, preview, prompts, and landing assets from browser state.",
          "- Dev/server mode keeps using the normal blueprint API path.",
        ].join("\n"),
        format: "markdown",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        acceptedAt: input.createdAt,
        reviewedAt: input.createdAt,
        reviewedBy: "github-pages-demo",
        reviewNote: "Accepted automatically in the deterministic Pages demo.",
        provenance: {
          jobId: input.job.id,
          projectId: input.job.projectId,
          sourceId: input.job.sourceId,
          targetText: input.job.request.targetText,
          githubUrls: input.job.request.githubUrls ?? [],
          treeVersion: input.specTree.version,
          nodeType: node.type,
          nodeTitle: node.title,
          nodeSummary: node.summary,
          dependencies: node.dependencies,
          outputs: node.outputs,
          reusedEvidenceIds: input.state.capabilityEvidence.map(item => item.id),
          generationSource: "template",
          promptId: "github-pages.blueprint.spec-documents.v1",
          model: "static-pages-demo",
        },
      } satisfies BlueprintSpecDocument;
    })
  );
}

function findSelectedRoute(
  routeSet: BlueprintRouteSet | undefined,
  selection: BlueprintRouteSelection | undefined
): BlueprintRouteCandidate | null {
  if (!routeSet) return null;
  const selectedId = selection?.routeId ?? routeSet.primaryRouteId;
  return routeSet.routes.find(route => route.id === selectedId) ?? routeSet.routes[0] ?? null;
}

function withoutArtifactTypes(
  artifacts: BlueprintGenerationArtifact[],
  types: BlueprintGenerationArtifact["type"][]
): BlueprintGenerationArtifact[] {
  return artifacts.filter(artifact => !types.includes(artifact.type));
}

function buildPagesEngineeringRuns(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  landingPlans: BlueprintEngineeringLandingPlan[];
  createdAt: string;
}): BlueprintEngineeringRun[] {
  return [
    {
      id: `pages-engineering-run-${input.job.id}`,
      jobId: input.job.id,
      landingPlanId:
        input.landingPlans[0]?.id ?? `pages-landing-plan-${input.job.id}`,
      status: "passed",
      summary: "Static Pages simulator completed the browser-only handoff flow.",
      logs: [
        "static runtime: spec documents generated",
        "static runtime: effect preview generated",
        "static runtime: prompt package generated",
        "static runtime: engineering landing generated",
      ],
      verificationResults: [
        {
          id: `pages-run-result-${input.job.id}`,
          title: "Pages full-flow smoke",
          command: "github-pages-blueprint-demo runtime",
          status: "passed",
          summary:
            "Route selection, SPEC documents, preview, prompt package, and landing assets are available without backend API calls.",
        },
      ],
      changedFiles: [
        "client/src/pages/autopilot/github-pages-blueprint-demo.ts",
        "client/src/pages/autopilot/AutopilotRoutePage.tsx",
      ],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      provenance: {
        jobId: input.job.id,
        specTreeId: input.specTree.id,
        staticPages: true,
      },
    },
  ];
}

function buildEffectPreviews(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  routeSet: BlueprintRouteSet;
  selectedRoute: BlueprintRouteCandidate;
  createdAt: string;
}): BlueprintEffectPreviewSnapshot[] {
  const node = input.specTree.nodes.find(item => item.id !== input.specTree.rootNodeId) ?? input.specTree.nodes[0];
  return [
    {
      id: `pages-effect-preview-${input.job.id}`,
      jobId: input.job.id,
      treeId: input.specTree.id,
      nodeId: node.id,
      version: 1,
      versionStatus: "current",
      previousPreviewIds: [],
      preservedPreviewIds: [],
      refreshedFromSpecTreeVersion: input.specTree.version,
      refreshedAt: input.createdAt,
      sourceSnapshotHash: `pages-${input.specTree.id}`,
      sourceDocumentIds: [],
      status: "preview",
      createdAt: input.createdAt,
      summary: `Static preview projection for ${input.selectedRoute.title}.`,
      architectureNotes: [
        "Pages mode uses browser-side state for blueprint data.",
        "Backend blueprint endpoints remain reserved for dev and production server mode.",
      ],
      prototypeNotes: ["The route workbench can complete without network APIs."],
      progressPlan: [
        {
          id: `pages-preview-milestone-${input.job.id}`,
          title: "Static flow verified",
          summary: "Intake, RouteSet, selection, and SPEC tree are present in local snapshot.",
          target: "GitHub Pages",
          sourceDocumentIds: [],
        },
      ],
      nodes: [],
      runtimeProjection: {
        id: `pages-runtime-projection-${input.job.id}`,
        jobId: input.job.id,
        projectId: input.job.projectId,
        routeSetId: input.routeSet.id,
        routeId: input.selectedRoute.id,
        specTreeId: input.specTree.id,
        nodeId: node.id,
        effectPreviewId: `pages-effect-preview-${input.job.id}`,
        sceneSnapshotId: `pages-scene-${input.job.id}`,
        hudState: {
          id: `pages-hud-${input.job.id}`,
          status: "preview",
          stage: "effect_preview",
          title: "Static Pages demo",
          summary: "Full Autopilot simulation is backed by browser state.",
          progressPercent: 100,
          activeNodeId: node.id,
          badges: ["GitHub Pages", "No backend", "Route selected"],
        },
        logTimeline: [
          {
            id: `pages-preview-log-${input.job.id}`,
            level: "success",
            message: "Static Pages Autopilot flow produced reviewable assets.",
            occurredAt: input.createdAt,
            sourceDocumentIds: [],
          },
        ],
        browserPreviewId: `pages-browser-preview-${input.job.id}`,
        browserPreview: {
          id: `pages-browser-preview-${input.job.id}`,
          title: "Autopilot Pages demo",
          summary: "Browser-only full flow preview.",
          routeId: input.selectedRoute.id,
          nodeId: node.id,
          url: "#/autopilot",
        },
        sourceIds: {
          routeSetId: input.routeSet.id,
          specTreeId: input.specTree.id,
          nodeIds: [node.id],
          effectPreviewIds: [`pages-effect-preview-${input.job.id}`],
        },
      },
      nodeProgress: {
        nodeId: node.id,
        status: node.status,
        completionPercent: 100,
        dependencyIds: node.dependencies,
        outputIds: node.outputs,
        updatedFromTreeVersion: input.specTree.version,
      },
      dependencyOrder: input.specTree.nodes.map(item => item.id),
      provenance: {
        jobId: input.job.id,
        projectId: input.job.projectId,
        sourceId: input.job.sourceId,
        targetText: input.job.request.targetText,
        githubUrls: input.job.request.githubUrls ?? [],
        treeVersion: input.specTree.version,
        nodeType: node.type,
        nodeTitle: node.title,
        nodeSummary: node.summary,
        sourceStatus: "draft",
        includeDrafts: true,
        sourceDocumentStatuses: {},
        generationSource: "template",
        promptId: "github-pages.blueprint.preview.v1",
        model: "static-pages-demo",
      },
    },
  ];
}

function buildPromptPackages(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  effectPreviewIds: string[];
  createdAt: string;
}): BlueprintPromptPackage[] {
  return [
    {
      id: `pages-prompt-package-${input.job.id}`,
      jobId: input.job.id,
      treeId: input.specTree.id,
      nodeIds: input.specTree.nodes.map(node => node.id),
      targetPlatform: "codex",
      target: {
        platform: "codex",
        label: "Workspace implementation",
        executionMode: "agent",
        guidance: "Apply the Pages runtime simulator changes and run focused smoke checks.",
      },
      title: "Static Pages Autopilot handoff prompt",
      summary: "Implementation prompt package generated by the browser-only Pages simulator.",
      content: "Keep Pages mode on deterministic local blueprint state and preserve backend mode.",
      sections: [],
      sourceDocumentIds: [],
      sourcePreviewIds: input.effectPreviewIds,
      createdAt: input.createdAt,
      provenance: {
        jobId: input.job.id,
        treeId: input.specTree.id,
        staticPages: true,
      },
    },
  ];
}

function buildLandingPlans(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  promptPackages: BlueprintPromptPackage[];
  createdAt: string;
}): BlueprintEngineeringLandingPlan[] {
  return [
    {
      id: `pages-landing-plan-${input.job.id}`,
      jobId: input.job.id,
      treeId: input.specTree.id,
      promptPackageId: input.promptPackages[0]?.id,
      promptPackageIds: input.promptPackages.map(item => item.id),
      sourcePromptPackageIds: input.promptPackages.map(item => item.id),
      platform: "codex",
      title: "Static Pages runtime landing plan",
      summary: "Wire browser-only blueprint simulation and verify with Pages build smoke.",
      status: "ready",
      handoffs: [],
      steps: [
        {
          id: `pages-landing-step-${input.job.id}`,
          title: "Verify Pages smoke",
          summary: "Serve dist/public under /whybuddy/ and click through the Autopilot flow.",
          status: "ready",
          owner: "autopilot",
          target: "GitHub Pages",
          commands: ["npm run build:pages", "node scripts/pages-autopilot-smoke.mjs"],
          sourcePromptPackageIds: input.promptPackages.map(item => item.id),
          sourceNodeIds: input.specTree.nodes.map(node => node.id),
          sourceDocumentIds: [],
          sourcePreviewIds: [],
          fileScopes: ["client/src/pages/autopilot"],
          riskLevel: "low",
        },
      ],
      verificationCommands: [
        {
          id: `pages-verification-${input.job.id}`,
          title: "Pages build",
          command: "npm run build:pages",
          summary: "Static bundle compiles under GitHub Pages base path.",
          expected: "exit 0",
          platform: "codex",
        },
      ],
      changedFiles: ["client/src/pages/autopilot/github-pages-blueprint-demo.ts"],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      provenance: {
        jobId: input.job.id,
        treeId: input.specTree.id,
        staticPages: true,
      },
    },
  ];
}

function buildArtifactEntries(input: {
  state: GithubPagesBlueprintDemoState;
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  selection?: BlueprintRouteSelection;
  specTree?: BlueprintSpecTree;
  createdAt: string;
}): BlueprintArtifactLedgerEntry[] {
  const artifacts = input.job.artifacts.filter(artifact =>
    [
      "route_set",
      "route_selection",
      "spec_tree",
      "requirements",
      "design",
      "tasks",
      "effect_preview",
      "prompt_pack",
      "engineering_plan",
      "engineering_run",
      "agent_crew",
      "capability_evidence",
    ].includes(artifact.type)
  );
  return artifacts.map((artifact, index) => ({
    id: `pages-ledger-${artifact.id}`,
    jobId: input.job.id,
    artifactId: artifact.id,
    artifactType: artifact.type,
    stage: input.job.stage,
    title: artifact.title,
    summary: artifact.summary,
    status: "recorded",
    version: 1,
    sourceEntryIds: index > 0 ? [`pages-ledger-${artifacts[index - 1].id}`] : [],
    sourceArtifactIds: index > 0 ? [artifacts[index - 1].id] : [],
    targetEntryIds: [],
    lineageEdges: [],
    lineageEdgeCount: 0,
    createdAt: artifact.createdAt,
    updatedAt: input.createdAt,
    recordedAt: input.createdAt,
    payload: artifact.payload,
    metadata: {
      staticPages: true,
      routeSetId: input.routeSet?.id,
      selectionId: input.selection?.id,
      specTreeId: input.specTree?.id,
    },
  }));
}

function buildArtifactReplays(input: {
  job: BlueprintGenerationJob;
  entries: BlueprintArtifactLedgerEntry[];
  createdAt: string;
}): BlueprintArtifactReplay[] {
  if (input.entries.length === 0) return [];
  return [
    {
      id: `pages-replay-${input.job.id}`,
      jobId: input.job.id,
      entryId: input.entries[0].id,
      stage: input.job.stage,
      title: "Static Pages artifact replay",
      summary: "Replay assembled from local browser snapshot artifacts.",
      status: "ready",
      snapshots: input.entries.map(entry => ({
        id: `pages-replay-snapshot-${entry.id}`,
        entryId: entry.id,
        artifactType: entry.artifactType,
        stage: entry.stage,
        title: entry.title,
        summary: entry.summary,
        status: entry.status,
        createdAt: entry.createdAt,
        lineageEdgeCount: entry.lineageEdgeCount,
      })),
      lineageEdges: [],
      lineageEdgeCount: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  ];
}

function buildLatestSnapshot(state: GithubPagesBlueprintDemoState): BlueprintLatestGenerationJobSnapshot {
  return {
    job: state.job ?? null,
    routeSet: state.routeSet,
    selection: state.selection,
    specTree: state.specTree,
    intake: state.intake,
    clarificationSession: state.clarificationSession,
    projectContext: state.projectContext,
    effectPreviews: state.effectPreviews,
    promptPackages: state.promptPackages,
    capabilities: state.capabilities,
    agentCrew: state.agentCrew ?? null,
    roleTimelines: state.agentCrew?.roleTimelines ?? [],
    capabilityInvocations: state.capabilityInvocations,
    capabilityEvidence: state.capabilityEvidence,
    landingPlans: state.landingPlans,
    engineeringRuns: state.engineeringRuns,
    artifactLedgerEntries: state.artifactEntries,
    artifactReplays: state.artifactReplays,
    artifactFeedback: [],
  };
}

export function createGithubPagesBlueprintDemoRuntime(
  options: GithubPagesBlueprintDemoRuntimeOptions = {}
): GithubPagesBlueprintDemoRuntime {
  const storage = readStorage(options);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const now = createClock(options);
  const state = loadState(storage, storageKey);
  const persist = () => persistState(storage, storageKey, state);

  return {
    async fetchLatestGenerationJob() {
      return { ok: true, data: buildLatestSnapshot(state) };
    },

    async fetchProjectContext(projectId: string) {
      const timestamp = now();
      state.projectContext = buildProjectContext({
        state,
        now: timestamp,
        projectId,
        intake: state.intake,
      });
      persist();
      return { ok: true, data: { projectContext: state.projectContext } };
    },

    async createIntake(request: BlueprintIntakeRequest) {
      const timestamp = now();
      const githubUrls = uniqueStrings((request.githubUrls ?? []).map(normalizeGithubUrl));
      const sources = githubUrls.map(parseGithubSource);
      const targetText = request.targetText?.trim();
      const intake: BlueprintIntake = {
        id: nextId(state, "intake"),
        projectId: request.projectId,
        sourceId: request.sourceId,
        targetText,
        githubUrls,
        sources,
        duplicateGithubUrls: [],
        domainNotes: request.domainNotes ?? [],
        assets: [],
        evidence: [],
        readiness: {
          status: "needs_answers",
          score: 0.66,
          answeredRequired: 0,
          requiredTotal: 2,
          missingQuestionIds: ["pages-goal", "pages-output"],
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const projectContext = buildProjectContext({
        state,
        now: timestamp,
        projectId: request.projectId,
        intake,
        targetText,
        githubUrls,
      });
      state.intake = {
        ...intake,
        assets: projectContext.assets,
        evidence: projectContext.evidence,
      };
      state.clarificationSession = undefined;
      state.job = undefined;
      state.routeSet = undefined;
      state.selection = undefined;
      state.specTree = undefined;
      state.projectContext = projectContext;
      state.agentCrew = undefined;
      state.capabilityInvocations = [];
      state.capabilityEvidence = [];
      state.effectPreviews = [];
      state.promptPackages = [];
      state.landingPlans = [];
      state.engineeringRuns = [];
      state.artifactEntries = [];
      state.artifactReplays = [];
      persist();
      return {
        ok: true,
        data: {
          intake: state.intake,
          projectContext,
        },
      };
    },

    async createClarificationSession(intakeId: string) {
      const intake = state.intake;
      if (!intake || intake.id !== intakeId) {
        return {
          ok: false,
          error: makeApiError("Static Pages demo intake was not found.", `/pages-demo/intakes/${intakeId}/clarifications`),
        };
      }
      const timestamp = now();
      const answers: BlueprintClarificationAnswer[] = [
        {
          questionId: "pages-goal",
          answer: intake.targetText || summarizeTarget(undefined, intake.githubUrls),
          answeredAt: timestamp,
          answeredBy: "github-pages-demo",
          source: "intake",
        },
        {
          questionId: "pages-output",
          answer: "Generate a reviewable RouteSet, SPEC tree, right rail evidence, and static smoke signal.",
          answeredAt: timestamp,
          answeredBy: "github-pages-demo",
          source: "strategy_default",
        },
      ];
      const clarificationSession: BlueprintClarificationSession = {
        id: nextId(state, "clarification"),
        intakeId: intake.id,
        projectId: intake.projectId,
        strategyId: "fast_execution",
        strategyLabel: "Static Pages fast path",
        templateId: "github-pages.blueprint.clarification.v1",
        routeReadySummary:
          "Static Pages simulator has enough intent, source, and output boundaries to derive routes.",
        readinessSignals: ["goal_defined", "repository_context", "output_preference", "fast_path"],
        generationSource: "template",
        questions: [
          {
            id: "pages-goal",
            kind: "goal",
            prompt: "What should the Autopilot flow prove?",
            required: true,
            sourceIds: intake.sources.map(source => source.id),
            evidenceIds: intake.evidence.map(item => item.id),
            type: "free_text",
            routeDimension: "goal",
            readinessSignal: "goal_defined",
            templateId: "github-pages.blueprint.clarification.v1",
            strategyId: "fast_execution",
            settledByStrategy: true,
            defaultAnswer: answers[0].answer,
            generationSource: "template",
          },
          {
            id: "pages-output",
            kind: "execution",
            prompt: "Which output proves the Pages path is connected?",
            required: true,
            sourceIds: intake.sources.map(source => source.id),
            evidenceIds: intake.evidence.map(item => item.id),
            type: "free_text",
            routeDimension: "output",
            readinessSignal: "output_preference",
            templateId: "github-pages.blueprint.clarification.v1",
            strategyId: "fast_execution",
            settledByStrategy: true,
            defaultAnswer: answers[1].answer,
            generationSource: "template",
          },
        ],
        answers,
        readiness: {
          status: "ready",
          score: 1,
          answeredRequired: 2,
          requiredTotal: 2,
          missingQuestionIds: [],
          readinessSignals: ["goal_defined", "repository_context", "output_preference", "fast_path"],
          settledQuestionIds: ["pages-goal", "pages-output"],
          routeDimensions: ["goal", "repository", "output", "execution"],
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.clarificationSession = clarificationSession;
      state.intake = {
        ...intake,
        readiness: clarificationSession.readiness,
        updatedAt: timestamp,
      };
      state.projectContext = buildProjectContext({
        state,
        now: timestamp,
        projectId: intake.projectId,
        intake: state.intake,
      });
      persist();
      return {
        ok: true,
        data: {
          intake: state.intake,
          clarificationSession,
          projectContext: state.projectContext,
        },
      };
    },

    async saveClarificationAnswers(clarificationId, request) {
      if (!state.clarificationSession || state.clarificationSession.id !== clarificationId) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo clarification session was not found.",
            `/pages-demo/clarifications/${clarificationId}/answers`
          ),
        };
      }
      const timestamp = now();
      const merged = new Map(
        state.clarificationSession.answers.map(answer => [answer.questionId, answer])
      );
      for (const answer of request.answers) {
        merged.set(answer.questionId, {
          ...answer,
          answeredAt: answer.answeredAt ?? timestamp,
          answeredBy: answer.answeredBy ?? request.answeredBy ?? "autopilot",
          source: answer.source ?? "user",
        });
      }
      state.clarificationSession = {
        ...state.clarificationSession,
        answers: [...merged.values()],
        readiness: {
          ...state.clarificationSession.readiness,
          status: "ready",
          score: 1,
          answeredRequired: state.clarificationSession.readiness.requiredTotal,
          missingQuestionIds: [],
        },
        updatedAt: timestamp,
      };
      if (state.intake) {
        state.intake = {
          ...state.intake,
          readiness: state.clarificationSession.readiness,
          updatedAt: timestamp,
        };
      }
      persist();
      return {
        ok: true,
        data: {
          intake: state.intake,
          clarificationSession: state.clarificationSession,
          projectContext: state.projectContext,
        },
      };
    },

    async createGenerationJob(request: BlueprintGenerationRequest) {
      const timestamp = now();
      const jobId = nextId(state, "job");
      const normalizedRequest: BlueprintGenerationRequest = {
        ...request,
        mode: request.mode ?? "autopilot_route",
        targetText: request.targetText ?? state.intake?.targetText,
        githubUrls:
          request.githubUrls && request.githubUrls.length > 0
            ? request.githubUrls.map(normalizeGithubUrl)
            : state.intake?.githubUrls ?? [],
        intakeId: request.intakeId ?? state.intake?.id,
        clarificationSessionId:
          request.clarificationSessionId ?? state.clarificationSession?.id,
        clarifications:
          request.clarifications ?? state.clarificationSession?.answers ?? [],
        domainContext: request.domainContext ?? state.projectContext,
      };
      const routeSet = buildRouteSet({ state, request: normalizedRequest, createdAt: timestamp });
      const capabilitySnapshots = createCapabilitySnapshots({
        state,
        jobId,
        projectId: normalizedRequest.projectId,
        request: normalizedRequest,
        routeSet,
        createdAt: timestamp,
      });
      const routeSetArtifact = createArtifact(
        state,
        "route_set",
        "Autopilot RouteSet",
        "Primary and alternative routes prepared for SPEC tree derivation.",
        timestamp,
        routeSet
      );
      const capabilityArtifacts = capabilitySnapshots.evidence.map(evidence =>
        createArtifact(
          state,
          "capability_evidence",
          evidence.title,
          evidence.summary,
          timestamp,
          evidence
        )
      );
      const agentCrew = buildAgentCrewSnapshot({
        jobId,
        stage: "route_generation",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: [routeSetArtifact.id, ...capabilityArtifacts.map(item => item.id)],
        evidenceIds: capabilitySnapshots.evidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew initialized for the static Pages RouteSet.",
        timestamp,
        agentCrew
      );
      const job: BlueprintGenerationJob = {
        id: jobId,
        request: normalizedRequest,
        status: "completed",
        stage: "route_generation",
        projectId: normalizedRequest.projectId,
        sourceId: normalizedRequest.sourceId,
        version: normalizedRequest.version ?? "github-pages-blueprint-demo/v1",
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...(state.intake
            ? [
                createArtifact(
                  state,
                  "intake",
                  "Blueprint Intake",
                  "Static Pages intake captured in browser state.",
                  timestamp,
                  state.intake
                ),
              ]
            : []),
          ...(state.clarificationSession
            ? [
                createArtifact(
                  state,
                  "clarification_session",
                  "Clarification Session",
                  "Static Pages clarification is route-ready.",
                  timestamp,
                  state.clarificationSession
                ),
              ]
            : []),
          ...(state.projectContext
            ? [
                createArtifact(
                  state,
                  "project_context",
                  "Project Domain Context",
                  "Static Pages project context derived from browser inputs.",
                  timestamp,
                  state.projectContext
                ),
              ]
            : []),
          routeSetArtifact,
          ...capabilitySnapshots.invocations.map(invocation =>
            createArtifact(
              state,
              "capability_invocation",
              `Capability invocation: ${invocation.capabilityLabel}`,
              invocation.outputSummary,
              timestamp,
              invocation
            )
          ),
          ...capabilityArtifacts,
          agentCrewArtifact,
          createArtifact(
            state,
            "capability_registry",
            "Runtime capability registry",
            "Static Pages runtime capabilities available without backend fetch.",
            timestamp,
            {
              capabilities: state.capabilities,
              agentCrew,
            }
          ),
        ],
        events: [
          createEvent({
            state,
            jobId,
            projectId: normalizedRequest.projectId,
            type: "job.created",
            stage: "route_generation",
            status: "running",
            message: "Static Pages blueprint generation started.",
            occurredAt: timestamp,
          }),
          createEvent({
            state,
            jobId,
            projectId: normalizedRequest.projectId,
            type: "route.generated",
            stage: "route_generation",
            status: "completed",
            message: "Static Pages RouteSet generated.",
            occurredAt: timestamp,
            artifactId: routeSetArtifact.id,
            payload: {
              routeSetId: routeSet.id,
              primaryRouteId: routeSet.primaryRouteId,
              routeCount: routeSet.routes.length,
              staticPages: true,
            },
          }),
          ...capabilitySnapshots.invocations.map(invocation =>
            createEvent({
              state,
              jobId,
              projectId: normalizedRequest.projectId,
              type: "capability.completed",
              stage: "route_generation",
              status: "completed",
              message: `${invocation.capabilityLabel} completed in static Pages mode.`,
              occurredAt: timestamp,
              routeId: invocation.routeId,
              capabilityId: invocation.capabilityId,
              evidenceId: invocation.evidenceIds[0],
            })
          ),
          createEvent({
            state,
            jobId,
            projectId: normalizedRequest.projectId,
            type: "job.completed",
            stage: "route_generation",
            status: "completed",
            message: "Static Pages RouteSet is ready for selection.",
            occurredAt: timestamp,
            artifactId: routeSetArtifact.id,
          }),
        ],
        stageState: {
          stage: "route_generation",
          status: "completed",
          payloadKind: "route_set",
          artifactIds: [routeSetArtifact.id, agentCrewArtifact.id],
          nextAction: {
            type: "select_route",
            label: "Select a route for SPEC tree derivation.",
            stage: "route_generation",
            artifactId: routeSetArtifact.id,
            required: true,
          },
        },
        nextAction: {
          type: "select_route",
          label: "Select a route for SPEC tree derivation.",
          stage: "route_generation",
          artifactId: routeSetArtifact.id,
          required: true,
        },
      };
      state.job = job;
      state.routeSet = routeSet;
      state.selection = undefined;
      state.specTree = undefined;
      state.agentCrew = agentCrew;
      state.capabilityInvocations = capabilitySnapshots.invocations;
      state.capabilityEvidence = capabilitySnapshots.evidence;
      state.effectPreviews = [];
      state.promptPackages = [];
      state.landingPlans = [];
      state.engineeringRuns = [];
      state.artifactEntries = buildArtifactEntries({
        state,
        job,
        routeSet,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return {
        ok: true,
        data: {
          job,
          routeSet,
          intake: state.intake,
          clarificationSession: state.clarificationSession,
          projectContext: state.projectContext,
        },
      };
    },

    async selectRoute(jobId: string, request: BlueprintRouteSelectionRequest) {
      if (!state.job || state.job.id !== jobId || !state.routeSet) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo job was not found.",
            `/pages-demo/jobs/${jobId}/route-selection`
          ),
        };
      }
      const selectedRoute = state.routeSet.routes.find(route => route.id === request.routeId);
      if (!selectedRoute) {
        return {
          ok: false,
          error: makeApiError(
            `Static Pages demo route ${request.routeId} was not found.`,
            `/pages-demo/jobs/${jobId}/route-selection`
          ),
        };
      }
      const timestamp = now();
      const selection: BlueprintRouteSelection = {
        id: nextId(state, "selection"),
        routeSetId: state.routeSet.id,
        routeId: selectedRoute.id,
        selectedPathId: selectedRoute.id,
        routeTitle: selectedRoute.title,
        selectedAt: timestamp,
        selectedBy: request.selectedBy,
        reason: request.reason,
        mergedAlternativeRouteIds: (request.mergedAlternativeRouteIds ?? []).filter(routeId =>
          state.routeSet?.routes.some(route => route.id === routeId && route.kind === "alternative")
        ),
        status: "selected",
        provenance: {
          jobId: state.job.id,
          projectId: state.job.projectId,
          sourceId: state.job.sourceId,
        },
      };
      const specTree = buildSpecTree({
        state,
        job: state.job,
        routeSet: state.routeSet,
        selection,
        selectedRoute,
        createdAt: timestamp,
      });
      const routeSelectionArtifact = createArtifact(
        state,
        "route_selection",
        `Selected route: ${selectedRoute.title}`,
        "Static Pages selected route for SPEC tree derivation.",
        timestamp,
        selection
      );
      const specTreeArtifact = createArtifact(
        state,
        "spec_tree",
        "Derived SPEC tree",
        "Initial durable SPEC tree generated from the selected static Pages route.",
        timestamp,
        specTree
      );
      const agentCrew = buildAgentCrewSnapshot({
        jobId: state.job.id,
        stage: "spec_tree",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: [routeSelectionArtifact.id, specTreeArtifact.id],
        evidenceIds: state.capabilityEvidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew aligned to SPEC tree stage in static Pages mode.",
        timestamp,
        agentCrew
      );
      const updatedJob: BlueprintGenerationJob = {
        ...state.job,
        status: "reviewing",
        stage: "spec_tree",
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...state.job.artifacts.filter(
            artifact =>
              artifact.type !== "route_selection" &&
              artifact.type !== "spec_tree" &&
              artifact.type !== "agent_crew"
          ),
          routeSelectionArtifact,
          specTreeArtifact,
          agentCrewArtifact,
        ],
        events: [
          ...state.job.events,
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "route.selected",
            stage: "spec_tree",
            status: "running",
            message: `Selected ${selectedRoute.title} in static Pages mode.`,
            occurredAt: timestamp,
            routeId: selectedRoute.id,
            selectionId: selection.id,
            artifactId: routeSelectionArtifact.id,
          }),
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "job.completed",
            stage: "spec_tree",
            status: "reviewing",
            message: "Static Pages SPEC tree draft is ready for review.",
            occurredAt: timestamp,
            routeId: selectedRoute.id,
            selectionId: selection.id,
            specTreeId: specTree.id,
            nodeId: specTree.rootNodeId,
            artifactId: specTreeArtifact.id,
          }),
        ],
        stageState: {
          stage: "spec_tree",
          status: "reviewing",
          payloadKind: "spec_tree",
          artifactIds: [routeSelectionArtifact.id, specTreeArtifact.id, agentCrewArtifact.id],
          nextAction: {
            type: "review_spec_tree",
            label: "Review the generated SPEC tree before document generation.",
            stage: "spec_tree",
            routeId: selectedRoute.id,
            selectionId: selection.id,
            specTreeId: specTree.id,
            nodeId: specTree.rootNodeId,
            artifactId: specTreeArtifact.id,
            required: true,
          },
        },
        nextAction: {
          type: "review_spec_tree",
          label: "Review the generated SPEC tree before document generation.",
          stage: "spec_tree",
          routeId: selectedRoute.id,
          selectionId: selection.id,
          specTreeId: specTree.id,
          nodeId: specTree.rootNodeId,
          artifactId: specTreeArtifact.id,
          required: true,
        },
      };
      state.job = updatedJob;
      state.selection = selection;
      state.specTree = specTree;
      state.agentCrew = agentCrew;
      state.effectPreviews = buildEffectPreviews({
        job: updatedJob,
        specTree,
        routeSet: state.routeSet,
        selectedRoute,
        createdAt: timestamp,
      });
      state.promptPackages = buildPromptPackages({
        job: updatedJob,
        specTree,
        effectPreviewIds: state.effectPreviews.map(item => item.id),
        createdAt: timestamp,
      });
      state.landingPlans = buildLandingPlans({
        job: updatedJob,
        specTree,
        promptPackages: state.promptPackages,
        createdAt: timestamp,
      });
      state.engineeringRuns = [
        {
          id: `pages-engineering-run-${updatedJob.id}`,
          jobId: updatedJob.id,
          landingPlanId: state.landingPlans[0]?.id ?? `pages-landing-plan-${updatedJob.id}`,
          status: "passed",
          summary: "Static Pages simulator prepared browser-only handoff assets.",
          logs: ["npm run build:pages", "pages static Autopilot smoke"],
          verificationResults: [
            {
              id: `pages-run-result-${updatedJob.id}`,
              title: "Pages smoke",
              command: "browser static smoke",
              status: "passed",
              summary: "Route selection and SPEC tree are available without backend API calls.",
            },
          ],
          changedFiles: ["client/src/pages/autopilot/github-pages-blueprint-demo.ts"],
          createdAt: timestamp,
          updatedAt: timestamp,
          provenance: {
            jobId: updatedJob.id,
            specTreeId: specTree.id,
            staticPages: true,
          },
        },
      ];
      state.artifactEntries = buildArtifactEntries({
        state,
        job: updatedJob,
        routeSet: state.routeSet,
        selection,
        specTree,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job: updatedJob,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return {
        ok: true,
        data: {
          job: updatedJob,
          routeSet: state.routeSet,
          selection,
          specTree,
        },
      };
    },

    async generateSpecDocuments(
      jobId: string,
      request: BlueprintGenerateSpecDocumentsRequest
    ) {
      if (!state.job || state.job.id !== jobId || !state.specTree) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo SPEC tree was not found.",
            `/pages-demo/jobs/${jobId}/spec-documents`
          ),
        };
      }
      const timestamp = now();
      const documents = buildSpecDocuments({
        state,
        job: state.job,
        specTree: state.specTree,
        request,
        createdAt: timestamp,
      });
      const documentArtifacts = documents.map(document =>
        createArtifact(
          state,
          document.type,
          document.title,
          document.summary,
          timestamp,
          document
        )
      );
      const specTree = {
        ...state.specTree,
        status: "accepted",
        updatedAt: timestamp,
        nodes: state.specTree.nodes.map(node => ({
          ...node,
          status:
            request.nodeId && node.id !== request.nodeId
              ? node.status
              : "accepted",
        })),
      } satisfies BlueprintSpecTree;
      const agentCrew = buildAgentCrewSnapshot({
        jobId: state.job.id,
        stage: "spec_docs",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: documentArtifacts.map(artifact => artifact.id),
        evidenceIds: state.capabilityEvidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew accepted SPEC documents in static Pages mode.",
        timestamp,
        agentCrew
      );
      const updatedJob: BlueprintGenerationJob = {
        ...state.job,
        status: "completed",
        stage: "spec_docs",
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...withoutArtifactTypes(state.job.artifacts, [
            "requirements",
            "design",
            "tasks",
            "agent_crew",
          ]),
          ...documentArtifacts,
          agentCrewArtifact,
        ],
        events: [
          ...state.job.events,
          ...documents.map(document =>
            createEvent({
              state,
              jobId: state.job!.id,
              projectId: state.job!.projectId,
              type: "spec.node_completed",
              stage: "spec_docs",
              status: "completed",
              message: `${document.title} generated in static Pages mode.`,
              occurredAt: timestamp,
              specTreeId: specTree.id,
              nodeId: document.nodeId,
              artifactId:
                documentArtifacts.find(artifact => artifact.payload === document)
                  ?.id ?? documentArtifacts[0]?.id,
              payload: {
                documentId: document.id,
                documentType: document.type,
                staticPages: true,
              },
            })
          ),
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "job.completed",
            stage: "spec_docs",
            status: "completed",
            message: "Static Pages SPEC documents are ready.",
            occurredAt: timestamp,
            specTreeId: specTree.id,
            artifactId: documentArtifacts[0]?.id,
          }),
        ],
        stageState: {
          stage: "spec_docs",
          status: "completed",
          payloadKind: "spec_documents",
          artifactIds: [
            ...documentArtifacts.map(artifact => artifact.id),
            agentCrewArtifact.id,
          ],
          nextAction: {
            type: "review_preview",
            label: "Generate static effect preview.",
            stage: "spec_docs",
            specTreeId: specTree.id,
            artifactId: documentArtifacts[0]?.id,
            required: false,
          },
        },
        nextAction: {
          type: "review_preview",
          label: "Generate static effect preview.",
          stage: "spec_docs",
          specTreeId: specTree.id,
          artifactId: documentArtifacts[0]?.id,
          required: false,
        },
      };
      state.job = updatedJob;
      state.specTree = specTree;
      state.agentCrew = agentCrew;
      state.artifactEntries = buildArtifactEntries({
        state,
        job: updatedJob,
        routeSet: state.routeSet,
        selection: state.selection,
        specTree,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job: updatedJob,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return { ok: true, data: { job: updatedJob, specTree, documents } };
    },

    async generateEffectPreviews(
      jobId: string,
      _request: BlueprintGenerateEffectPreviewsRequest
    ) {
      if (!state.job || state.job.id !== jobId || !state.specTree || !state.routeSet) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo SPEC document snapshot was not found.",
            `/pages-demo/jobs/${jobId}/effect-previews`
          ),
        };
      }
      const selectedRoute = findSelectedRoute(state.routeSet, state.selection);
      if (!selectedRoute) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo selected route was not found.",
            `/pages-demo/jobs/${jobId}/effect-previews`
          ),
        };
      }
      const timestamp = now();
      const effectPreviews = buildEffectPreviews({
        job: state.job,
        specTree: state.specTree,
        routeSet: state.routeSet,
        selectedRoute,
        createdAt: timestamp,
      });
      const previewArtifacts = effectPreviews.map(preview =>
        createArtifact(
          state,
          "effect_preview",
          "Static effect preview",
          preview.summary,
          timestamp,
          preview
        )
      );
      const agentCrew = buildAgentCrewSnapshot({
        jobId: state.job.id,
        stage: "effect_preview",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: previewArtifacts.map(artifact => artifact.id),
        evidenceIds: state.capabilityEvidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew generated effect preview in static Pages mode.",
        timestamp,
        agentCrew
      );
      const updatedJob: BlueprintGenerationJob = {
        ...state.job,
        status: "completed",
        stage: "effect_preview",
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...withoutArtifactTypes(state.job.artifacts, [
            "effect_preview",
            "agent_crew",
          ]),
          ...previewArtifacts,
          agentCrewArtifact,
        ],
        events: [
          ...state.job.events,
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "preview.generated",
            stage: "effect_preview",
            status: "completed",
            message: "Static Pages effect preview generated.",
            occurredAt: timestamp,
            specTreeId: state.specTree.id,
            nodeId: effectPreviews[0]?.nodeId,
            artifactId: previewArtifacts[0]?.id,
            payload: {
              previewIds: effectPreviews.map(item => item.id),
              staticPages: true,
            },
          }),
        ],
        stageState: {
          stage: "effect_preview",
          status: "completed",
          payloadKind: "preview",
          artifactIds: [
            ...previewArtifacts.map(artifact => artifact.id),
            agentCrewArtifact.id,
          ],
          nextAction: {
            type: "review_prompt_package",
            label: "Generate implementation prompt package.",
            stage: "effect_preview",
            specTreeId: state.specTree.id,
            artifactId: previewArtifacts[0]?.id,
            required: false,
          },
        },
        nextAction: {
          type: "review_prompt_package",
          label: "Generate implementation prompt package.",
          stage: "effect_preview",
          specTreeId: state.specTree.id,
          artifactId: previewArtifacts[0]?.id,
          required: false,
        },
      };
      state.job = updatedJob;
      state.agentCrew = agentCrew;
      state.effectPreviews = effectPreviews;
      state.artifactEntries = buildArtifactEntries({
        state,
        job: updatedJob,
        routeSet: state.routeSet,
        selection: state.selection,
        specTree: state.specTree,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job: updatedJob,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return {
        ok: true,
        data: {
          job: updatedJob,
          specTree: state.specTree,
          effectPreviews,
        },
      };
    },

    async generatePromptPackages(
      jobId: string,
      _request: BlueprintGeneratePromptPackagesRequest
    ) {
      if (!state.job || state.job.id !== jobId || !state.specTree) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo effect preview snapshot was not found.",
            `/pages-demo/jobs/${jobId}/prompt-packages`
          ),
        };
      }
      const timestamp = now();
      const effectPreviews =
        state.effectPreviews.length > 0
          ? state.effectPreviews
          : buildEffectPreviews({
              job: state.job,
              specTree: state.specTree,
              routeSet: state.routeSet!,
              selectedRoute: findSelectedRoute(state.routeSet, state.selection)!,
              createdAt: timestamp,
            });
      const promptPackages = buildPromptPackages({
        job: state.job,
        specTree: state.specTree,
        effectPreviewIds: effectPreviews.map(item => item.id),
        createdAt: timestamp,
      });
      const promptArtifacts = promptPackages.map(promptPackage =>
        createArtifact(
          state,
          "prompt_pack",
          promptPackage.title,
          promptPackage.summary,
          timestamp,
          promptPackage
        )
      );
      const agentCrew = buildAgentCrewSnapshot({
        jobId: state.job.id,
        stage: "prompt_packaging",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: promptArtifacts.map(artifact => artifact.id),
        evidenceIds: state.capabilityEvidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew packaged implementation prompts in static Pages mode.",
        timestamp,
        agentCrew
      );
      const updatedJob: BlueprintGenerationJob = {
        ...state.job,
        status: "completed",
        stage: "prompt_packaging",
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...withoutArtifactTypes(state.job.artifacts, [
            "prompt_pack",
            "agent_crew",
          ]),
          ...promptArtifacts,
          agentCrewArtifact,
        ],
        events: [
          ...state.job.events,
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "prompt.packaged",
            stage: "prompt_packaging",
            status: "completed",
            message: "Static Pages prompt package generated.",
            occurredAt: timestamp,
            specTreeId: state.specTree.id,
            artifactId: promptArtifacts[0]?.id,
            payload: {
              promptPackageIds: promptPackages.map(item => item.id),
              staticPages: true,
            },
          }),
        ],
        stageState: {
          stage: "prompt_packaging",
          status: "completed",
          payloadKind: "prompt_package",
          artifactIds: [
            ...promptArtifacts.map(artifact => artifact.id),
            agentCrewArtifact.id,
          ],
          nextAction: {
            type: "review_engineering_handoff",
            label: "Generate engineering landing plan.",
            stage: "prompt_packaging",
            specTreeId: state.specTree.id,
            artifactId: promptArtifacts[0]?.id,
            required: false,
          },
        },
        nextAction: {
          type: "review_engineering_handoff",
          label: "Generate engineering landing plan.",
          stage: "prompt_packaging",
          specTreeId: state.specTree.id,
          artifactId: promptArtifacts[0]?.id,
          required: false,
        },
      };
      state.job = updatedJob;
      state.agentCrew = agentCrew;
      state.effectPreviews = effectPreviews;
      state.promptPackages = promptPackages;
      state.artifactEntries = buildArtifactEntries({
        state,
        job: updatedJob,
        routeSet: state.routeSet,
        selection: state.selection,
        specTree: state.specTree,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job: updatedJob,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return {
        ok: true,
        data: {
          job: updatedJob,
          specTree: state.specTree,
          promptPackages,
        },
      };
    },

    async generateEngineeringLanding(
      jobId: string,
      _request: BlueprintGenerateEngineeringLandingRequest = {}
    ) {
      if (!state.job || state.job.id !== jobId || !state.specTree) {
        return {
          ok: false,
          error: makeApiError(
            "Static Pages demo prompt package snapshot was not found.",
            `/pages-demo/jobs/${jobId}/engineering-landing`
          ),
        };
      }
      const timestamp = now();
      const promptPackages =
        state.promptPackages.length > 0
          ? state.promptPackages
          : buildPromptPackages({
              job: state.job,
              specTree: state.specTree,
              effectPreviewIds: state.effectPreviews.map(item => item.id),
              createdAt: timestamp,
            });
      const landingPlans = buildLandingPlans({
        job: state.job,
        specTree: state.specTree,
        promptPackages,
        createdAt: timestamp,
      });
      const engineeringRuns = buildPagesEngineeringRuns({
        job: state.job,
        specTree: state.specTree,
        landingPlans,
        createdAt: timestamp,
      });
      const landingArtifacts = landingPlans.map(plan =>
        createArtifact(
          state,
          "engineering_plan",
          plan.title,
          plan.summary,
          timestamp,
          plan
        )
      );
      const runArtifacts = engineeringRuns.map(run =>
        createArtifact(
          state,
          "engineering_run",
          "Static Pages engineering run",
          run.summary,
          timestamp,
          run
        )
      );
      const agentCrew = buildAgentCrewSnapshot({
        jobId: state.job.id,
        stage: "engineering_landing",
        createdAt: timestamp,
        capabilities: state.capabilities,
        artifactIds: [
          ...landingArtifacts.map(artifact => artifact.id),
          ...runArtifacts.map(artifact => artifact.id),
        ],
        evidenceIds: state.capabilityEvidence.map(item => item.id),
      });
      const agentCrewArtifact = createArtifact(
        state,
        "agent_crew",
        "Agent Crew fabric",
        "Agent Crew completed engineering landing in static Pages mode.",
        timestamp,
        agentCrew
      );
      const updatedJob: BlueprintGenerationJob = {
        ...state.job,
        status: "completed",
        stage: "engineering_landing",
        updatedAt: timestamp,
        completedAt: timestamp,
        artifacts: [
          ...withoutArtifactTypes(state.job.artifacts, [
            "engineering_plan",
            "engineering_run",
            "agent_crew",
          ]),
          ...landingArtifacts,
          ...runArtifacts,
          agentCrewArtifact,
        ],
        events: [
          ...state.job.events,
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "mission.handoff",
            stage: "engineering_landing",
            status: "completed",
            message: "Static Pages engineering landing plan generated.",
            occurredAt: timestamp,
            specTreeId: state.specTree.id,
            artifactId: landingArtifacts[0]?.id,
            payload: {
              landingPlanIds: landingPlans.map(item => item.id),
              engineeringRunIds: engineeringRuns.map(item => item.id),
              staticPages: true,
            },
          }),
          createEvent({
            state,
            jobId: state.job.id,
            projectId: state.job.projectId,
            type: "job.completed",
            stage: "engineering_landing",
            status: "completed",
            message: "Static Pages Autopilot full flow completed.",
            occurredAt: timestamp,
            specTreeId: state.specTree.id,
            artifactId: landingArtifacts[0]?.id,
          }),
        ],
        stageState: {
          stage: "engineering_landing",
          status: "completed",
          payloadKind: "engineering_landing",
          artifactIds: [
            ...landingArtifacts.map(artifact => artifact.id),
            ...runArtifacts.map(artifact => artifact.id),
            agentCrewArtifact.id,
          ],
          nextAction: {
            type: "none",
            label: "Static Pages Autopilot flow is complete.",
            stage: "engineering_landing",
            specTreeId: state.specTree.id,
            artifactId: landingArtifacts[0]?.id,
            required: false,
          },
        },
        nextAction: {
          type: "none",
          label: "Static Pages Autopilot flow is complete.",
          stage: "engineering_landing",
          specTreeId: state.specTree.id,
          artifactId: landingArtifacts[0]?.id,
          required: false,
        },
      };
      state.job = updatedJob;
      state.agentCrew = agentCrew;
      state.promptPackages = promptPackages;
      state.landingPlans = landingPlans;
      state.engineeringRuns = engineeringRuns;
      state.artifactEntries = buildArtifactEntries({
        state,
        job: updatedJob,
        routeSet: state.routeSet,
        selection: state.selection,
        specTree: state.specTree,
        createdAt: timestamp,
      });
      state.artifactReplays = buildArtifactReplays({
        job: updatedJob,
        entries: state.artifactEntries,
        createdAt: timestamp,
      });
      persist();
      return {
        ok: true,
        data: {
          job: updatedJob,
          specTree: state.specTree,
          landingPlans,
        },
      };
    },
  };
}

let singletonRuntime: GithubPagesBlueprintDemoRuntime | null = null;

export function getGithubPagesBlueprintDemoRuntime(): GithubPagesBlueprintDemoRuntime {
  singletonRuntime ??= createGithubPagesBlueprintDemoRuntime();
  return singletonRuntime;
}
