import type {
  PermissionCheckResult,
  RiskLevel,
} from "../../shared/permission/contracts.js";
import type {
  VectorDeleteActionInput,
  VectorDeleteActionResult,
} from "../../shared/web-aigc-vector-delete.js";
import type { AuditLogger } from "../permission/audit-logger.js";
import type { PermissionCheckEngine } from "../permission/check-engine.js";
import type {
  MetadataStore,
  RagChunkMetadataRow,
} from "../rag/store/metadata-store.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";

export interface VectorDeleteAdapterDeps {
  metadataStore: MetadataStore;
  vectorStore: VectorStoreAdapter;
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
  projectId?: string,
): string {
  const fallbackProjectId = (projectId ?? "global").trim() || "global";
  const fallback = `rag_${namespaceToCollectionSegment(namespace)}_${fallbackProjectId}`;
  const value = (collection ?? fallback).trim();
  if (!COLLECTION_PATTERN.test(value)) {
    throw new Error(
      "collection must be 2-128 chars and only contain letters, numbers, underscore, or hyphen",
    );
  }
  return value;
}

function namespaceResource(namespace: string, collection: string): string {
  return `${namespace}/${collection}`;
}

function namespacedSourceId(namespace: string, sourceId: string): string {
  return `${namespace}:${sourceId}`;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeConfirmationText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
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

function inferRiskLevel(
  input: VectorDeleteActionInput,
  matchedRows: RagChunkMetadataRow[],
): RiskLevel {
  if (input.requireApproval) {
    return "high";
  }

  if (matchedRows.length >= 10) {
    return "high";
  }

  return matchedRows.length > 0 ? "medium" : "low";
}

function resolveMatchedRows(
  input: VectorDeleteActionInput,
  namespace: string,
  metadataStore: MetadataStore,
): RagChunkMetadataRow[] {
  const target = input.target ?? {};
  const byIds = Array.isArray(target.ids)
    ? target.ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map(id => id.trim())
    : [];

  if (byIds.length > 0) {
    return byIds
      .map(id => metadataStore.getByChunkId(id))
      .filter((row): row is RagChunkMetadataRow => Boolean(row));
  }

  if (typeof target.sourceId === "string" && target.sourceId.trim().length > 0) {
    const scopedSourceId = namespacedSourceId(namespace, target.sourceId.trim());
    return metadataStore
      .getBySourceId(scopedSourceId)
      .filter(row =>
        (!target.projectId || row.project_id === target.projectId) &&
        (!target.sourceType || row.source_type === target.sourceType),
      );
  }

  throw new Error("target.ids or target.sourceId is required");
}

function assertConfirmation(
  input: VectorDeleteActionInput,
  namespace: string,
  collection: string,
  matchedRows: RagChunkMetadataRow[],
): { protected: boolean; confirmationText?: string } {
  const confirmation = input.confirmation;
  if (!confirmation || confirmation.confirmed !== true) {
    throw new Error("vector delete requires confirmation.confirmed=true");
  }

  const expectedSourceToken =
    typeof input.target?.sourceId === "string" && input.target.sourceId.trim().length > 0
      ? input.target.sourceId.trim()
      : undefined;
  const expectedCountToken = String(matchedRows.length);
  const normalizedText = normalizeConfirmationText(confirmation.confirmationText);
  const requiresText = matchedRows.length > 1 || Boolean(expectedSourceToken);

  if (!requiresText) {
    return {
      protected: false,
      ...(normalizedText ? { confirmationText: normalizedText } : {}),
    };
  }

  if (!normalizedText) {
    throw new Error("vector delete requires confirmationText for multi-record deletes");
  }

  const hasNamespace = normalizedText.includes(namespace);
  const hasCollection = normalizedText.includes(collection);
  const hasCount = normalizedText.includes(expectedCountToken);
  const hasSource = expectedSourceToken ? normalizedText.includes(expectedSourceToken) : true;

  if (!hasNamespace || !hasCollection || !hasCount || !hasSource) {
    throw new Error(
      "confirmationText must include namespace, collection, delete count, and sourceId when deleting multiple records",
    );
  }

  return {
    protected: true,
    confirmationText: normalizedText,
  };
}

export class VectorDeleteAdapter {
  constructor(private readonly deps: VectorDeleteAdapterDeps) {}

  async execute(input: VectorDeleteActionInput): Promise<VectorDeleteActionResult> {
    const namespace = sanitizeNamespace(input.namespace);
    const matchedRows = resolveMatchedRows(input, namespace, this.deps.metadataStore);
    const projectId = input.target?.projectId ?? matchedRows[0]?.project_id;
    const collection = sanitizeCollection(input.collection, namespace, projectId);
    const resource = namespaceResource(namespace, collection);
    const confirmation = assertConfirmation(input, namespace, collection, matchedRows);
    const riskLevel = inferRiskLevel(input, matchedRows);

    const permission = this.deps.permissionEngine.checkPermission(
      input.agentId,
      "database",
      "delete",
      resource,
      input.token,
    );

    const buildResult = (
      overrides: Partial<VectorDeleteActionResult>,
    ): VectorDeleteActionResult => {
      const deletedIds = matchedRows.map(row => row.chunk_id);
      const matchedSourceIds = dedupeStrings(matchedRows.map(row => row.source_id));
      const affectedProjectIds = dedupeStrings(matchedRows.map(row => row.project_id));
      const affectedSourceTypes = dedupeStrings(matchedRows.map(row => row.source_type)) as VectorDeleteActionResult["impact"]["affectedSourceTypes"];
      const remainingChunkCount =
        typeof input.target?.sourceId === "string" && input.target.sourceId.trim().length > 0
          ? Math.max(
              0,
              this.deps.metadataStore.getBySourceId(
                namespacedSourceId(namespace, input.target.sourceId.trim()),
              ).length -
                (overrides.impact?.deletedChunkCount ?? 0),
            )
          : 0;

      return {
        ok: false,
        action: "vector_delete",
        namespace,
        collection,
        status: "failed",
        deletedIds: [],
        ...(typeof input.target?.sourceId === "string" && input.target.sourceId.trim().length > 0
          ? { sourceId: input.target.sourceId.trim() }
          : {}),
        ...(input.target?.sourceType ? { sourceType: input.target.sourceType } : {}),
        governance: {
          namespace,
          collection,
          resource,
          riskLevel,
          permission: buildPermissionReason(permission),
          approval: {
            required: false,
            status: "not_required",
          },
        },
        impact: {
          requestedDeleteCount:
            Array.isArray(input.target?.ids) && input.target.ids.length > 0
              ? input.target.ids.length
              : matchedRows.length,
          matchedChunkCount: matchedRows.length,
          deletedChunkCount: 0,
          remainingChunkCount,
          matchedSourceIds,
          affectedProjectIds,
          affectedSourceTypes,
        },
        confirmation: {
          confirmed: true,
          ...(confirmation.confirmationText
            ? { confirmationText: confirmation.confirmationText }
            : {}),
          protected: confirmation.protected,
        },
        ...overrides,
      };
    };

    if (!permission.allowed) {
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_delete",
        resourceType: "database",
        action: "delete",
        resource,
        result: "denied",
        reason: permission.reason ?? "Permission denied",
        metadata: {
          namespace,
          collection,
          matchedChunkCount: matchedRows.length,
          matchedChunkIds: matchedRows.map(row => row.chunk_id),
          sourceId: input.target?.sourceId,
          sourceType: input.target?.sourceType,
          riskLevel,
          governanceHook: "permission-engine",
        },
      });

      return buildResult({
        status: "denied",
        error: permission.reason ?? "Permission denied",
      });
    }

    if (input.requireApproval || permission.governance?.outcome === "approval_required") {
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_delete",
        resourceType: "database",
        action: "delete",
        resource,
        result: "denied",
        reason: "High-risk vector delete requires approval",
        governance: permission.governance,
        metadata: {
          namespace,
          collection,
          matchedChunkCount: matchedRows.length,
          matchedChunkIds: matchedRows.map(row => row.chunk_id),
          sourceId: input.target?.sourceId,
          sourceType: input.target?.sourceType,
          riskLevel,
          governanceHook: input.requireApproval ? "manual-approval-gate" : "governance-policy",
        },
      });

      return buildResult({
        status: "approval_required",
        error: "High-risk vector delete requires approval",
        governance: {
          namespace,
          collection,
          resource,
          riskLevel,
          permission: buildPermissionReason(permission),
          approval: {
            required: true,
            status: "pending",
          },
        },
      });
    }

    if (matchedRows.length === 0) {
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_delete",
        resourceType: "database",
        action: "delete",
        resource,
        result: "allowed",
        metadata: {
          namespace,
          collection,
          matchedChunkCount: 0,
          sourceId: input.target?.sourceId,
          sourceType: input.target?.sourceType,
          riskLevel,
          governanceHook: "no-op-delete",
        },
      });

      return buildResult({
        ok: true,
        status: "completed",
      });
    }

    const deletedIds = matchedRows.map(row => row.chunk_id);

    try {
      await this.deps.vectorStore.delete(collection, deletedIds);
      const deletedChunkCount = this.deps.metadataStore.deleteBatch(deletedIds);

      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_delete",
        resourceType: "database",
        action: "delete",
        resource,
        result: "allowed",
        metadata: {
          namespace,
          collection,
          deletedChunkCount,
          deletedChunkIds: deletedIds,
          sourceId: input.target?.sourceId,
          sourceType: input.target?.sourceType,
          projectIds: dedupeStrings(matchedRows.map(row => row.project_id)),
          riskLevel,
          governanceHook: "permission-engine",
        },
      });

      return buildResult({
        ok: true,
        status: "completed",
        deletedIds,
        impact: {
          ...buildResult({}).impact,
          deletedChunkCount,
          remainingChunkCount:
            typeof input.target?.sourceId === "string" && input.target.sourceId.trim().length > 0
              ? this.deps.metadataStore.getBySourceId(
                  namespacedSourceId(namespace, input.target.sourceId.trim()),
                ).length
              : 0,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.auditLogger.log({
        agentId: input.agentId,
        operation: "vector_delete",
        resourceType: "database",
        action: "delete",
        resource,
        result: "error",
        reason: message,
        metadata: {
          namespace,
          collection,
          matchedChunkCount: matchedRows.length,
          matchedChunkIds: deletedIds,
          sourceId: input.target?.sourceId,
          sourceType: input.target?.sourceType,
          riskLevel,
          governanceHook: "vector-store-delete",
        },
      });

      return buildResult({
        status: "failed",
        error: message,
      });
    }
  }
}
