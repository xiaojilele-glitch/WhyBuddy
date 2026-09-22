// Generated from models/project_runtime.py. Run pnpm run project:contracts:emit.

export type ManifestFile = {
  "path": string;
  "sha256": string;
  "sizeBytes": number;
};

export type PreviewDescriptor = {
  "kind"?: "project";
  "projectId": string;
  "runtimeId": string;
  "revision": string;
  "status": "provisioning" | "syncing" | "installing" | "executing" | "starting" | "ready" | "stopping" | "stopped" | "expired" | "failed" | "reconciling";
  "entryUrl"?: string | null;
  "expiresAt"?: string | null;
  "capabilities"?: Array<string>;
};

export type Project = {
  "projectId": string;
  "sessionId": string;
  "ownerId": string;
  "runtimeKind"?: "project";
  "currentRevision": string;
  "createdAt": string;
  "updatedAt": string;
  "revisionCount"?: number;
  "sourceBytesStored"?: number;
  "sourceProjectId"?: string | null;
  "sourceRevision"?: string | null;
};

export type ProjectAcceptanceProfile = {
  "profileId": string;
  "suiteVersion": string;
  "requirements": Array<string>;
  "outsideScope": Array<string>;
  "dataRecovery": string;
};

export type ProjectDataBackup = {
  "backupId": string;
  "projectId": string;
  "version": number;
  "parentBackupId": string | null;
  "sha256": string;
  "sizeBytes": number;
  "sourceRevision": string;
  "dataSchemaVersion": 1;
  "createdAt": string;
};

export type ProjectDataRestoreResult = {
  "backup": ProjectDataBackup;
};

export type ProjectDataSnapshot = {
  "backup": ProjectDataBackup | null;
  "backups": Array<ProjectDataBackup>;
  "checkpointIntervalSeconds": number;
  "recoveryPolicy": "last-checkpoint";
};

export type ProjectDeliveryStatus = {
  "projectId": string;
  "revision": string;
  "eligible": boolean;
  "profile": ProjectAcceptanceProfile;
  "blockedReasons": Array<string>;
  "verificationId": string | null;
  "releases": Array<ProjectRelease>;
  "deployment": ProjectDeploymentStatus;
};

export type ProjectDeploymentStatus = {
  "status"?: "not_configured";
  "publicUrl"?: null;
};

export type ProjectForkResult = {
  "projectId": string;
  "sessionId": string;
  "revision": string;
};

export type ProjectManifest = {
  "schemaVersion"?: 1;
  "treeHash": string;
  "totalBytes": number;
  "files": Array<ManifestFile>;
};

export type ProjectOperation = {
  "operationId": string;
  "projectId": string;
  "sessionId": string;
  "kind": string;
  "idempotencyKey": string;
  "requestHash": string;
  "expectedRevision": string;
  "approvalRef": string;
  "status"?: "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelling" | "cancelled" | "interrupted";
  "input"?: {
  [key: string]: unknown;
};
  "result"?: {
  [key: string]: unknown;
} | null;
  "leaseGeneration"?: number | null;
  "leaseOwner"?: string | null;
  "cancelRequested"?: boolean;
  "lastAccessAt"?: number | null;
  "runtime"?: RuntimeInstance | null;
  "stateVersion"?: number;
  "pendingEvent"?: {
  [key: string]: unknown;
} | null;
  "createdAt": string;
  "updatedAt": string;
};

export type ProjectOperationSnapshot = {
  "operation": ProjectOperationView;
  "runtime": RuntimeView | null;
  "lastSeq": number;
};

export type ProjectOperationView = {
  "operationId": string;
  "projectId": string;
  "sessionId": string;
  "kind": string;
  "expectedRevision": string;
  "status": "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelling" | "cancelled" | "interrupted";
  "cancelRequested": boolean;
  "lastAccessAt": number | null;
  "stateVersion": number;
  "createdAt": string;
  "updatedAt": string;
};

export type ProjectRelease = {
  "releaseId": string;
  "projectId": string;
  "revision": string;
  "verificationId": string;
  "profileId": string;
  "planRef": string;
  "treeHash": string;
  "lockfileHash": string;
  "buildHash": string;
  "createdAt": string;
  "downloadPath": string;
  "deployed"?: false;
  "effectiveStatus"?: "ready" | "stale" | null;
};

export type ProjectReleaseResult = {
  "release": ProjectRelease;
};

export type ProjectRevision = {
  "revision": string;
  "projectId": string;
  "parentRevision"?: string | null;
  "treeHash": string;
  "manifest": ProjectManifest;
  "templateVersion": string;
  "planRef": string;
  "specRevision"?: string | null;
  "createdAt": string;
};

export type ProjectRevisionPage = {
  "projectId": string;
  "currentRevision": string;
  "revisions": Array<ProjectRevisionSummary>;
  "nextCursor": string | null;
};

export type ProjectRevisionSummary = {
  "revision": string;
  "parentRevision"?: string | null;
  "treeHash": string;
  "templateVersion": string;
  "createdAt": string;
};

export type ProjectSourceCommand = {
  "projectId": string;
  "revision": string | null;
  "operationId": string | null;
  "status": "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelling" | "cancelled" | "interrupted";
};

export type ProjectSourceFile = {
  "projectId": string;
  "revision": string;
  "path": string;
  "sha256": string;
  "content": string;
};

export type ProjectSourceIndex = {
  "projectId": string;
  "revision": string;
  "currentRevision": string;
  "files": Array<ManifestFile>;
};

export type RuntimeEvent = {
  "schemaVersion"?: 1;
  "eventId": string;
  "sessionId": string;
  "projectId": string;
  "operationId": string;
  "seq": number;
  "type": string;
  "timestamp": string;
  "payload"?: {
  [key: string]: unknown;
};
};

export type RuntimeEventPage = {
  "events": Array<RuntimeEventView>;
  "nextSeq": number;
  "hasMore": boolean;
};

export type RuntimeEventView = {
  "schemaVersion": 1;
  "sessionId": string;
  "projectId": string;
  "operationId": string;
  "seq": number;
  "type": string;
  "timestamp": string;
  "payload": {
  [key: string]: unknown;
};
};

export type RuntimeInstance = {
  "runtimeId": string;
  "workspaceId": string;
  "projectId": string;
  "revision": string;
  "status": "provisioning" | "syncing" | "installing" | "executing" | "starting" | "ready" | "stopping" | "stopped" | "expired" | "failed" | "reconciling";
  "port": number;
  "previewUrl"?: string | null;
  "processId"?: string | null;
  "health"?: string | null;
  "lastHeartbeat": string;
  "expiresAt"?: number | null;
  "errorCode"?: string | null;
};

export type RuntimeView = {
  "runtimeId": string;
  "workspaceId": string;
  "projectId": string;
  "revision": string;
  "status": "provisioning" | "syncing" | "installing" | "executing" | "starting" | "ready" | "stopping" | "stopped" | "expired" | "failed" | "reconciling";
  "port": number;
  "health": string | null;
  "lastHeartbeat": string;
  "expiresAt": number | null;
  "errorCode": string | null;
};

export type VerificationArtifactRef = {
  "artifactId": string;
  "sha256": string;
  "mediaType"?: "image/png";
  "sizeBytes": number;
  "label": string;
};

export type VerificationAssertion = {
  "id": string;
  "status": "passed" | "failed" | "not_run";
  "expected"?: string | null;
  "actual"?: string | null;
  "detail"?: "timeout" | "assertion" | "error" | null;
};

export type VerificationBuildEvidence = {
  "kind"?: "production";
  "revision": string;
  "treeHash": string;
  "lockfileHash": string;
  "status": "passed" | "failed" | "blocked" | "cancelled";
  "installExitCode"?: number | null;
  "buildExitCode"?: number | null;
  "outputHash"?: string | null;
  "outputFileCount"?: number;
  "outputBytes"?: number;
  "serverKind": "static-dist" | "tasks-node";
  "startedAt": string;
  "completedAt": string;
};

export type VerificationRecord = {
  "verificationId": string;
  "operationId": string;
  "runtimeOperationId": string;
  "projectId": string;
  "revision": string;
  "treeHash": string;
  "runtimeId": string;
  "specRevision": string | null;
  "planRef": string;
  "suiteVersion": string;
  "acceptanceRequirements"?: Array<string>;
  "runnerVersion"?: string;
  "status"?: "running" | "passed" | "failed" | "blocked" | "cancelled";
  "assertions"?: Array<VerificationAssertion>;
  "build"?: VerificationBuildEvidence | null;
  "artifactRefs"?: Array<VerificationArtifactRef>;
  "createdAt": string;
  "startedAt": string;
  "completedAt"?: string | null;
  "errorCode"?: string | null;
};

export type VerificationSnapshot = {
  "verification": VerificationRecord;
  "effectiveStatus": "running" | "passed" | "failed" | "blocked" | "cancelled" | "stale";
  "deliveryEligible"?: boolean;
};

export type WorkspaceLease = {
  "workspaceId": string;
  "projectId": string;
  "generation": number;
  "leaseOwner": string;
  "expiresAt": number;
  "sandboxId"?: string | null;
  "mountedRevision"?: string | null;
  "provider"?: "e2b";
  "processRefs"?: {
  [key: string]: unknown;
};
};
