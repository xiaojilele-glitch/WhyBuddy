import type {
  PermissionCheckResult,
  RiskLevel,
} from "../../shared/permission/contracts.js";
import type {
  VectorUpdateActionInput,
  VectorUpdateActionResult,
} from "../../shared/web-aigc-vector-update.js";
import type { PermissionCheckEngine } from "../permission/check-engine.js";
import type { AuditLogger } from "../permission/audit-logger.js";
import type {
  MetadataStore,
  RagChunkMetadataRow,
} from "../rag/store/metadata-store.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";

export interface VectorUpdateAdapterDeps {
  metadataStore: MetadataStore;
  vectorStore?: Pick<VectorStoreAdapter, "collectionInfo" | "healthCheck">;
  permissionEngine: PermissionCheckEngine;
  auditLogger: AuditLogger;
}

const NAMESPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,127}$/;
const COLLECTION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/;

function sanitizeNamespace(namespace: string): string {
  const value = namespace.trim();
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new Error(
      "namespace must be 2-128 chars and only contain letters, numbers, colon, underscore, or hyphen",
    );
  }
  return value;
}

function namespaceToCollectionSegment(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sanitizeCollection(
  collection: string | undefined,
  namespace: string,
  projectId: string,
): string {
  const fallback = `rag_${namespaceToCollectionSegment(namespace)}_${projectId}`;
  const value = (collection ?? fallback).trim();
  if (!COLLECTION_PATTERN.test(value)) {
    throw new Error(
      "collection must be 2-128 chars and only contain letters, numbers, underscore, or hyphen",
    );
  }
  return value;
}

function namespaceResource(namespace: string, collection: string): string {
  return `${namespace}/${collection}/vector_update`;
}

function namespacedSourceId(namespace: string, sourceId: string): string {
  return `${namespace}:${sourceId}`;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function inferRiskLevel(input: VectorUpdateActionInput): RiskLevel {
  if (input.requireApproval) {
    return "critical";
  }

  return "high";
}

function buildPermissionReason(result: PermissionCheckResult): {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
} {
  return {
    allowed: result.allowed,
    reason: result.reason,
    suggestion: result.suggestion,
  };
}

function buildRollbackReason(): string {
  return "当前实现仅安全更新 MetadataStore 中的 metadata_json，不直接修改真实向量值，因此无法提供底层向量级自动回滚。";
}

function parseMetadataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore invalid metadata payload and treat as empty object
  }

  return {};
}

function buildSelection(input: VectorUpdateActionInput): {
  mode: "ids" | "sourceId";
  ids: string[];
  sourceId?: string;
} {
  const sourceId = normalizeString(
    "sourceId" in input.selection ? input.selection.sourceId : undefined,
  );
  const ids = normalizeIds("ids" in input.selection ? input.selection.ids : undefined);

  if (sourceId) {
    return {
      mode: "sourceId",
      ids: [],
      sourceId,
    };
  }

  if (ids.length > 0) {
    return {
      mode: "ids",
      ids,
    };
  }

  throw new Error("selection must provide non-empty ids or sourceId");
}

function selectRows(
  store: MetadataStore,
  namespace: string,
  input: VectorUpdateActionInput,
): {
  mode: "ids" | "sourceId";
  rows: RagChunkMetadataRow[];
  sourceId?: string;
} {
  const selection = buildSelection(input);

  if (selection.mode === "sourceId") {
    const scopedSourceId = namespacedSourceId(namespace, selection.sourceId as string);
    const rows = store
      .getBySourceId(scopedSourceId)
      .filter((row) => row.project_id === input.projectId)
      .filter((row) =>
        input.sourceType ? row.source_type === input.sourceType : true,
      );

    return {
      mode: "sourceId",
      rows,
      sourceId: selection.sourceId,
    };
  }

  const rows = selection.ids
    .map((id) => store.getByChunkId(id))
    .filter((row): row is RagChunkMetadataRow => Boolean(row))
    .filter((row) => row.project_id === input.projectId)
    .filter((row) =>
      input.sourceType ? row.source_type === input.sourceType : true,
    );

  return {
    mode: "ids",
    rows,
  };
}

async function verifyVectorStoreReadiness(
  deps: VectorUpdateAdapterDeps,
  collection: string,
): Promise<void> {
  if (!deps.vectorStore) {
    return;
  }

  const health = await deps.vectorStore.healthCheck();
  if (!health.connected) {
    throw new Error("vector store backend is not connected");
  }

  await deps.vectorStore.collectionInfo(collection);
}

function buildUpdatedRow(
  row: RagChunkMetadataRow,
  namespace: string,
  collection: string,
  input: VectorUpdateActionInput,
): RagChunkMetadataRow {
  const existingMetadata = parseMetadataJson(row.metadata_json);
  const nextMetadata = {
    ...existingMetadata,
    ...input.metadataPatch,
    namespace,
    targetCollection: collection,
    riskAction: "vector_update",
    originalSourceId:
      existingMetadata.originalSourceId ??
      (row.source_id.startsWith(`${namespace}:`)
        ? row.source_id.slice(namespace.length + 1)
        : row.source_id),
    vectorUpdate: {
      updatedAt: new Date().toISOString(),
      updatedBy: input.agentId,
      reason: normalizeString(input.reason),
      mode:
        "sourceId" in input.selection && normalizeString(input.selection.sourceId)
          ? "sourceId"
          : "ids",
      ...(input.context ? { context: input.context } : {}),
    },
  };

  return {
    ...row,
    last_accessed_at: new Date().toISOString(),
    metadata_json: JSON.stringify(nextMetadata),
  };
}

function buildGovernance(
  namespace: string,
  collection: string,
  resource: string,
  riskLevel: RiskLevel,
  permission: PermissionCheckResult,
  approvalRequired: boolean,
): VectorUpdateActionResult["governance"] {
  return {
    namespace,
    collection,
    resource,
    riskLevel,
    permission: buildPermissionReason(permission),
    approval: {
      required: approvalRequired,
      status: approvalRequired ? "pending" : "not_required",
    },
    audit: {
      logged: true,
      operation: "vector_update",
    },
    rollback: {
      supported: false,
      mode: "metadata_patch_only",
      reason: buildRollbackReason(),
    },
  };
}

export class VectorUpdateAdapter {
  constructor(private readonly deps: VectorUpdateAdapterDeps) {}

  async execute(input: VectorUpdateActionInput): Promise<VectorUpdateActionResult> {
    const namespace = sanitizeNamespace(input.namespace);
    const collection = sanitizeCollection(input.collection, namespace, input.projectId);
    const resource = namespaceResource(namespace, collection);
    const riskLevel = inferRiskLevel(input);

    const permission = this.deps.permissionEngine.checkPermission(
      input.agentId,
      "database",
      "update",
      resource,
      input.token,
    );

    if (!permission.allowed) {
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_update",
        resourceType: "database",
        action: "update",
        resource,
        result: "denied",
        reason: permission.reason ?? "Permission denied",
        governance: permission.governance,
        metadata: {
          namespace,
          collection,
          projectId: input.projectId,
          riskLevel,
          governanceHook: "permission-engine",
        },
      });

      return {
        ok: false,
        action: "vector_update",
        namespace,
        collection,
        selectionMode: "sourceId" in input.selection ? "sourceId" : "ids",
        matchedRecords: 0,
        updatedRecords: 0,
        status: permission.governance?.outcome === "approval_required"
          ? "approval_required"
          : "denied",
        governance: buildGovernance(
          namespace,
          collection,
          resource,
          permission.governance?.riskLevel ?? riskLevel,
          permission,
          permission.governance?.outcome === "approval_required",
        ),
        error: permission.reason ?? "Permission denied",
      };
    }

    if (input.requireApproval) {
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_update",
        resourceType: "database",
        action: "update",
        resource,
        result: "denied",
        reason: "High-risk vector update requires approval",
        metadata: {
          namespace,
          collection,
          projectId: input.projectId,
          riskLevel,
          governanceHook: "approval-gate",
        },
      });

      return {
        ok: false,
        action: "vector_update",
        namespace,
        collection,
        selectionMode: "sourceId" in input.selection ? "sourceId" : "ids",
        matchedRecords: 0,
        updatedRecords: 0,
        status: "approval_required",
        governance: buildGovernance(
          namespace,
          collection,
          resource,
          riskLevel,
          permission,
          true,
        ),
        error: "High-risk vector update requires approval",
      };
    }

    try {
      await verifyVectorStoreReadiness(this.deps, collection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_update",
        resourceType: "database",
        action: "update",
        resource,
        result: "error",
        reason: message,
        metadata: {
          namespace,
          collection,
          projectId: input.projectId,
          riskLevel,
          governanceHook: "vector-store-health",
        },
      });

      return {
        ok: false,
        action: "vector_update",
        namespace,
        collection,
        selectionMode: "sourceId" in input.selection ? "sourceId" : "ids",
        matchedRecords: 0,
        updatedRecords: 0,
        status: "unavailable",
        governance: buildGovernance(
          namespace,
          collection,
          resource,
          riskLevel,
          permission,
          false,
        ),
        error: message,
      };
    }

    const selection = selectRows(this.deps.metadataStore, namespace, input);
    const matchedRows = selection.rows;

    const updatedRows = matchedRows.map((row) =>
      buildUpdatedRow(row, namespace, collection, input),
    );

    if (updatedRows.length > 0) {
      this.deps.metadataStore.upsertBatch(updatedRows);
      await this.deps.metadataStore.flush();
    }

    this.deps.auditLogger.log({
      agentId: input.agentId,
      operation: "vector_update",
      resourceType: "database",
      action: "update",
      resource,
      result: "allowed",
      metadata: {
        namespace,
        collection,
        projectId: input.projectId,
        sourceType: input.sourceType,
        matchedRecords: matchedRows.length,
        updatedRecords: updatedRows.length,
        selectionMode: selection.mode,
        updatedChunkIds: updatedRows.map((row) => row.chunk_id),
        updatedSourceId: selection.sourceId,
        riskLevel,
        governanceHook: "metadata-store",
      },
    });

    return {
      ok: true,
      action: "vector_update",
      namespace,
      collection,
      selectionMode: selection.mode,
      matchedRecords: matchedRows.length,
      updatedRecords: updatedRows.length,
      status: "completed",
      governance: buildGovernance(
        namespace,
        collection,
        resource,
        riskLevel,
        permission,
        false,
      ),
      warning:
        "当前仅完成 metadata patch，不直接改写底层向量内容；如需真实向量重算，请走后续重嵌入流程。",
      ...(updatedRows.length > 0
        ? { updatedChunkIds: updatedRows.map((row) => row.chunk_id) }
        : {}),
      ...(selection.sourceId ? { updatedSourceId: selection.sourceId } : {}),
    };
  }
}
