import { describe, expect, it, vi } from "vitest";

import { MetadataStore, type RagChunkMetadataRow } from "../rag/store/metadata-store.js";
import type { PermissionCheckEngine } from "../permission/check-engine.js";
import type { AuditLogger } from "../permission/audit-logger.js";
import { VectorUpdateAdapter } from "../web-aigc/vector-update-adapter.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";

function makeRow(overrides: Partial<RagChunkMetadataRow> = {}): RagChunkMetadataRow {
  return {
    chunk_id: "document:tenant_alpha:doc-1:0",
    source_type: "document",
    source_id: "tenant_alpha:doc-1",
    project_id: "proj-1",
    chunk_index: 0,
    content_hash: "hash-1",
    token_count: 128,
    code_language: null,
    function_signature: null,
    agent_id: null,
    ingested_at: "2026-04-23T00:00:00.000Z",
    last_accessed_at: "2026-04-23T00:00:00.000Z",
    storage_tier: "hot",
    metadata_json: JSON.stringify({
      namespace: "tenant_alpha",
      originalSourceId: "doc-1",
      reviewStatus: "pending",
    }),
    ...overrides,
  };
}

function createMetadataStore(rows: RagChunkMetadataRow[]): MetadataStore {
  const store = new MetadataStore(`C:/temp/vector-update-${Date.now()}-${Math.random()}.json`);
  store.upsertBatch(rows);
  return store;
}

function makeDeps(overrides?: {
  permissionAllowed?: boolean;
  permissionReason?: string;
  governance?: Record<string, unknown>;
  vectorStoreConnected?: boolean;
  collectionInfoError?: string;
}) {
  const metadataStore = createMetadataStore([
    makeRow(),
    makeRow({
      chunk_id: "document:tenant_alpha:doc-1:1",
      chunk_index: 1,
    }),
    makeRow({
      chunk_id: "document:tenant_alpha:doc-2:0",
      source_id: "tenant_alpha:doc-2",
      metadata_json: JSON.stringify({
        namespace: "tenant_alpha",
        originalSourceId: "doc-2",
        reviewStatus: "draft",
      }),
    }),
  ]);

  const permissionEngine = {
    checkPermission: vi.fn(() => ({
      allowed: overrides?.permissionAllowed ?? true,
      reason: overrides?.permissionReason,
      governance: overrides?.governance,
    })),
  } satisfies Pick<PermissionCheckEngine, "checkPermission">;

  const auditLogger = {
    log: vi.fn(),
  } satisfies Pick<AuditLogger, "log">;

  const vectorStore = {
    healthCheck: vi.fn(async () => ({
      connected: overrides?.vectorStoreConnected ?? true,
      backend: "mock-qdrant",
      latencyMs: 4,
    })),
    collectionInfo: vi.fn(async () => {
      if (overrides?.collectionInfoError) {
        throw new Error(overrides.collectionInfoError);
      }

      return {
        name: "rag_tenant_alpha_proj-1",
        vectorCount: 3,
        dimension: 1536,
        status: "ready",
      };
    }),
  } satisfies Pick<VectorStoreAdapter, "healthCheck" | "collectionInfo">;

  return {
    metadataStore,
    permissionEngine,
    auditLogger,
    vectorStore,
  };
}

describe("VectorUpdateAdapter", () => {
  it("updates metadata rows selected by sourceId and records governance info", async () => {
    const deps = makeDeps();
    const adapter = new VectorUpdateAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      projectId: "proj-1",
      selection: {
        sourceId: "doc-1",
      },
      metadataPatch: {
        reviewStatus: "approved",
        reviewer: "ops",
      },
      reason: "批量审核通过",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.selectionMode).toBe("sourceId");
    expect(result.matchedRecords).toBe(2);
    expect(result.updatedRecords).toBe(2);
    expect(result.updatedSourceId).toBe("doc-1");
    expect(result.warning).toContain("metadata patch");
    expect(deps.permissionEngine.checkPermission).toHaveBeenCalledWith(
      "agent-1",
      "database",
      "update",
      "tenant_alpha/rag_tenant_alpha_proj-1/vector_update",
      "token-1",
    );
    const updated = deps.metadataStore.getBySourceId("tenant_alpha:doc-1");
    expect(updated).toHaveLength(2);
    const parsed = JSON.parse(updated[0].metadata_json);
    expect(parsed.reviewStatus).toBe("approved");
    expect(parsed.reviewer).toBe("ops");
    expect(parsed.riskAction).toBe("vector_update");
  });

  it("updates rows selected by ids", async () => {
    const deps = makeDeps();
    const adapter = new VectorUpdateAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      projectId: "proj-1",
      selection: {
        ids: ["document:tenant_alpha:doc-2:0"],
      },
      metadataPatch: {
        reviewStatus: "archived",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.selectionMode).toBe("ids");
    expect(result.updatedChunkIds).toEqual(["document:tenant_alpha:doc-2:0"]);
    const updated = deps.metadataStore.getByChunkId("document:tenant_alpha:doc-2:0");
    expect(updated).toBeDefined();
    expect(JSON.parse(updated!.metadata_json).reviewStatus).toBe("archived");
  });

  it("returns approval_required when governance blocks vector writes", async () => {
    const deps = makeDeps({
      permissionAllowed: false,
      permissionReason: "Vector store write operations require manual approval before they can be executed.",
      governance: {
        outcome: "approval_required",
        riskLevel: "critical",
        policyId: "security-governance.vector-write-gate",
        rationale: "Vector store write operations require manual approval before they can be executed.",
        requiresAudit: true,
      },
    });
    const adapter = new VectorUpdateAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      projectId: "proj-1",
      selection: {
        sourceId: "doc-1",
      },
      metadataPatch: {
        reviewStatus: "approved",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("approval_required");
    expect(result.governance.approval.required).toBe(true);
    expect(deps.auditLogger.log).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when vector store readiness check fails", async () => {
    const deps = makeDeps({
      collectionInfoError: "collection missing",
    });
    const adapter = new VectorUpdateAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      projectId: "proj-1",
      selection: {
        sourceId: "doc-1",
      },
      metadataPatch: {
        reviewStatus: "approved",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("collection missing");
  });
});
