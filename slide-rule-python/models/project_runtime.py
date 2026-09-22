"""Server-owned contracts for persistent source projects and runtime operations.

The project revision is independent from a sandbox: an expired provider instance
must never erase the source or make evidence for an older tree look current.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ManifestFile(ProjectContract):
    path: str
    sha256: str
    sizeBytes: int


class ProjectManifest(ProjectContract):
    schemaVersion: Literal[1] = 1
    treeHash: str
    totalBytes: int
    files: list[ManifestFile]


class Project(ProjectContract):
    projectId: str
    sessionId: str
    ownerId: str
    runtimeKind: Literal["project"] = "project"
    currentRevision: str
    createdAt: str
    updatedAt: str
    revisionCount: int = 1
    sourceBytesStored: int = 0
    sourceProjectId: str | None = None
    sourceRevision: str | None = None


class ProjectRevision(ProjectContract):
    revision: str
    projectId: str
    parentRevision: str | None = None
    treeHash: str
    manifest: ProjectManifest
    templateVersion: str
    planRef: str
    specRevision: str | None = None
    createdAt: str


class ProjectSourceIndex(ProjectContract):
    projectId: str
    revision: str
    currentRevision: str
    files: list[ManifestFile]


class ProjectSourceFile(ProjectContract):
    projectId: str
    revision: str
    path: str
    sha256: str
    content: str


class ProjectRevisionSummary(ProjectContract):
    revision: str
    parentRevision: str | None = None
    treeHash: str
    templateVersion: str
    createdAt: str


class ProjectRevisionPage(ProjectContract):
    projectId: str
    currentRevision: str
    revisions: list[ProjectRevisionSummary]
    nextCursor: str | None


class ProjectForkResult(ProjectContract):
    projectId: str
    sessionId: str
    revision: str


class ProjectDataBackup(ProjectContract):
    backupId: str
    projectId: str
    version: int
    parentBackupId: str | None
    sha256: str
    sizeBytes: int
    sourceRevision: str
    dataSchemaVersion: Literal[1]
    createdAt: str


class ProjectDataSnapshot(ProjectContract):
    backup: ProjectDataBackup | None
    backups: list[ProjectDataBackup]
    checkpointIntervalSeconds: int
    recoveryPolicy: Literal["last-checkpoint"]


class ProjectDataRestoreResult(ProjectContract):
    backup: ProjectDataBackup


class ProjectAcceptanceProfile(ProjectContract):
    profileId: str
    suiteVersion: str
    requirements: list[str]
    outsideScope: list[str]
    dataRecovery: str


class ProjectRelease(ProjectContract):
    releaseId: str
    projectId: str
    revision: str
    verificationId: str
    profileId: str
    planRef: str
    treeHash: str
    lockfileHash: str
    buildHash: str
    createdAt: str
    downloadPath: str
    deployed: Literal[False] = False
    effectiveStatus: Literal["ready", "stale"] | None = None


class ProjectDeploymentStatus(ProjectContract):
    status: Literal["not_configured"] = "not_configured"
    publicUrl: None = None


class ProjectDeliveryStatus(ProjectContract):
    projectId: str
    revision: str
    eligible: bool
    profile: ProjectAcceptanceProfile
    blockedReasons: list[str]
    verificationId: str | None
    releases: list[ProjectRelease]
    deployment: ProjectDeploymentStatus


class ProjectReleaseResult(ProjectContract):
    release: ProjectRelease


class WorkspaceLease(ProjectContract):
    workspaceId: str
    projectId: str
    generation: int
    leaseOwner: str
    expiresAt: float
    sandboxId: str | None = None
    mountedRevision: str | None = None
    provider: Literal["e2b"] = "e2b"
    processRefs: dict[str, Any] = Field(default_factory=dict)


OperationStatus = Literal[
    "queued", "running", "waiting_user", "completed", "failed",
    "cancelling", "cancelled", "interrupted",
]


class ProjectSourceCommand(ProjectContract):
    projectId: str
    revision: str | None
    operationId: str | None
    status: OperationStatus

RuntimeStatus = Literal["provisioning", "syncing", "installing", "executing", "starting", "ready", "stopping", "stopped", "expired", "failed", "reconciling"]


class RuntimeInstance(ProjectContract):
    runtimeId: str
    workspaceId: str
    projectId: str
    revision: str
    status: RuntimeStatus
    port: int
    previewUrl: str | None = None
    processId: str | None = None
    health: str | None = None
    lastHeartbeat: str
    expiresAt: float | None = None
    errorCode: str | None = None


class PreviewDescriptor(ProjectContract):
    kind: Literal["project"] = "project"
    projectId: str
    runtimeId: str
    revision: str
    status: RuntimeStatus
    entryUrl: str | None = None
    expiresAt: str | None = None
    capabilities: list[str] = Field(default_factory=list)


class ProjectOperation(ProjectContract):
    operationId: str
    projectId: str
    sessionId: str
    kind: str
    idempotencyKey: str
    requestHash: str
    expectedRevision: str
    approvalRef: str
    status: OperationStatus = "queued"
    input: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    leaseGeneration: int | None = None
    leaseOwner: str | None = None
    cancelRequested: bool = False
    lastAccessAt: float | None = None
    runtime: RuntimeInstance | None = None
    stateVersion: int = 0
    pendingEvent: dict[str, Any] | None = None
    createdAt: str
    updatedAt: str


class RuntimeEvent(ProjectContract):
    schemaVersion: Literal[1] = 1
    eventId: str
    sessionId: str
    projectId: str
    operationId: str
    seq: int
    type: str
    timestamp: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ProjectOperationView(ProjectContract):
    """Public operation fields; lease, dispatch and outbox data stay private."""

    operationId: str
    projectId: str
    sessionId: str
    kind: str
    expectedRevision: str
    status: OperationStatus
    cancelRequested: bool
    lastAccessAt: float | None
    stateVersion: int
    createdAt: str
    updatedAt: str


class RuntimeView(ProjectContract):
    runtimeId: str
    workspaceId: str
    projectId: str
    revision: str
    status: RuntimeStatus
    port: int
    health: str | None
    lastHeartbeat: str
    expiresAt: float | None
    errorCode: str | None


class ProjectOperationSnapshot(ProjectContract):
    operation: ProjectOperationView
    runtime: RuntimeView | None
    lastSeq: int


class RuntimeEventView(ProjectContract):
    schemaVersion: Literal[1]
    sessionId: str
    projectId: str
    operationId: str
    seq: int
    type: str
    timestamp: str
    payload: dict[str, Any]


class RuntimeEventPage(ProjectContract):
    events: list[RuntimeEventView]
    nextSeq: int
    hasMore: bool


VerificationStatus = Literal["running", "passed", "failed", "blocked", "cancelled"]


class VerificationAssertion(ProjectContract):
    # ⚠ 2026-09-17：not_run 与 detail 都是那趟生产验收（pvr-1247974…）逼出来的。
    #   收据当时只有 10 条断言、名单是 13 条，缺的三条是被全局超时切掉的——
    #   而"被切掉"和"这套判据本来就更短"在收据里没有区别。not_run 让它有区别。
    #   detail 字段**早就在这儿**，只是从产出侧到这儿一路没人填，
    #   三个 null 让"超时还是真失败"只能靠猜（§3：写对了 ≠ 被调用了）。
    #   detail 是封闭词表，不是自由文本：收据的每个字节都来自模型生成的沙盒应用。
    id: str = Field(min_length=1, max_length=120)
    status: Literal["passed", "failed", "not_run"]
    expected: str | None = Field(default=None, max_length=1200)
    actual: str | None = Field(default=None, max_length=1200)
    detail: Literal["timeout", "assertion", "error"] | None = None


class VerificationArtifactRef(ProjectContract):
    artifactId: str
    sha256: str
    mediaType: Literal["image/png"] = "image/png"
    sizeBytes: int
    label: str


class VerificationBuildEvidence(ProjectContract):
    kind: Literal["production"] = "production"
    revision: str
    treeHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    lockfileHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["passed", "failed", "blocked", "cancelled"]
    installExitCode: int | None = Field(default=None, ge=0, le=255, strict=True)
    buildExitCode: int | None = Field(default=None, ge=0, le=255, strict=True)
    outputHash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    outputFileCount: int = Field(default=0, ge=0, le=5000, strict=True)
    outputBytes: int = Field(default=0, ge=0, le=104857600, strict=True)
    serverKind: Literal["static-dist", "tasks-node"]
    startedAt: str
    completedAt: str


class VerificationRecord(ProjectContract):
    verificationId: str
    operationId: str
    runtimeOperationId: str
    projectId: str
    revision: str
    treeHash: str
    runtimeId: str
    specRevision: str | None
    planRef: str
    suiteVersion: str
    # Explicit requirements approved with the session.  The fixed browser
    # suite does not claim these until matching assertions are implemented.
    acceptanceRequirements: list[str] = Field(default_factory=list)
    runnerVersion: str = "whybuddy-browser-v1:pw1.61.1"
    status: VerificationStatus = "running"
    assertions: list[VerificationAssertion] = Field(default_factory=list)
    build: VerificationBuildEvidence | None = None
    artifactRefs: list[VerificationArtifactRef] = Field(default_factory=list)
    createdAt: str
    startedAt: str
    completedAt: str | None = None
    errorCode: str | None = None


class VerificationSnapshot(ProjectContract):
    verification: VerificationRecord
    effectiveStatus: Literal["running", "passed", "failed", "blocked", "cancelled", "stale"]
    deliveryEligible: bool = False
