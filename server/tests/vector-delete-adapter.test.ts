import { describe, expect, it, vi } from "vitest";

import type { PermissionCheckEngine } from "../permission/check-engine.js";
import type { AuditLogger } from "../permission/audit-logger.js";
import type { MetadataStore } from "../rag/store/metadata-store.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";
import { VectorDeleteAdapter } from "../web-aigc/vector-delete-adapter.js";

function makeRow(overrides: Partial<any> = {}) {
  return {
    chunk_id: "document:tenant_alpha:source-1:0",
    source_type: "document",
    source_id: "tenant_alpha:source-1",
    project_id: "proj-1",
    chunk_index: 0,
    content_hash: "hash-1",
    token_count: 10,
    code_language: null,
    function_signature: null,
    agent_id: null,
    ingested_at: "2026-04-23T00:00:00.000Z",
    last_accessed_at: "2026-04-23T00:00:00.000Z",
    storage_tier: "hot",
    metadata_json: "{}",
    ...overrides,
  };
}

function makeDeps(overrides?: {
  permissionAllowed?: boolean;
  permissionReason?: string;
  governanceOutcome?: "allowed" | "blocked" | "approval_required";
  rowsBySourceId?: any[];
  rowsById?: Record<string, any | undefined>;
  vectorDeleteError?: string;
  deletedCount?: number;
}) {
  const rowsBySourceId = overrides?.rowsBySourceId ?? [makeRow(), makeRow({
    chunk_id: "document:tenant_alpha:source-1:1",
    chunk_index: 1,
  })];
  const rowMap = new Map<string, any>();
  for (const row of rowsBySourceId) {
    rowMap.set(row.chunk_id, row);
  }
  for (const [key, value] of Object.entries(overrides?.rowsById ?? {})) {
    if (value) {
      rowMap.set(key, value);
    }
  }

  const metadataStore = {
    getBySourceId: vi.fn((sourceId: string) =>
      sourceId === "tenant_alpha:source-1" ? rowsBySourceId : [],
    ),
    getByChunkId: vi.fn((chunkId: string) => rowMap.get(chunkId)),
    deleteBatch: vi.fn(() => overrides?.deletedCount ?? rowsBySourceId.length),
  } satisfies Pick<MetadataStore, "getBySourceId" | "getByChunkId" | "deleteBatch">;

  const vectorStore = {
    delete: vi.fn(async () => {
      if (overrides?.vectorDeleteError) {
        throw new Error(overrides.vectorDeleteError);
      }
    }),
  } satisfies Pick<VectorStoreAdapter, "delete">;

  const permissionEngine = {
    checkPermission: vi.fn(() => ({
      allowed: overrides?.permissionAllowed ?? true,
      reason: overrides?.permissionReason,
      ...(overrides?.governanceOutcome
        ? {
            governance: {
              outcome: overrides.governanceOutcome,
              riskLevel: "high",
              policyId: "security-governance.vector-write-gate",
              rationale: "vector delete requires approval",
              requiresAudit: true,
            },
          }
        : {}),
    })),
  } satisfies Pick<PermissionCheckEngine, "checkPermission">;

  const auditLogger = {
    log: vi.fn(),
  } satisfies Pick<AuditLogger, "log">;

  return {
    metadataStore,
    vectorStore,
    permissionEngine,
    auditLogger,
  };
}

describe("VectorDeleteAdapter", () => {
  it("completes delete by sourceId when permission and confirmation pass", async () => {
    const deps = makeDeps();
    const adapter = new VectorDeleteAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      target: {
        sourceId: "source-1",
        sourceType: "document",
        projectId: "proj-1",
      },
      confirmation: {
        confirmed: true,
        confirmationText: "delete tenant_alpha rag_tenant_alpha_proj-1 2 source-1",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.deletedIds).toEqual([
      "document:tenant_alpha:source-1:0",
      "document:tenant_alpha:source-1:1",
    ]);
    expect(result.impact.deletedChunkCount).toBe(2);
    expect(result.impact.matchedChunkCount).toBe(2);
    expect(result.confirmation.protected).toBe(true);
    expect(deps.permissionEngine.checkPermission).toHaveBeenCalledWith(
      "agent-1",
      "database",
      "delete",
      "tenant_alpha/rag_tenant_alpha_proj-1",
      "token-1",
    );
    expect(deps.vectorStore.delete).toHaveBeenCalledWith("rag_tenant_alpha_proj-1", [
      "document:tenant_alpha:source-1:0",
      "document:tenant_alpha:source-1:1",
    ]);
    expect(deps.metadataStore.deleteBatch).toHaveBeenCalledWith([
      "document:tenant_alpha:source-1:0",
      "document:tenant_alpha:source-1:1",
    ]);
  });

  it("returns denied when permission check fails", async () => {
    const deps = makeDeps({
      permissionAllowed: false,
      permissionReason: "No allow rule found for database:delete",
    });
    const adapter = new VectorDeleteAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      target: {
        sourceId: "source-1",
      },
      confirmation: {
        confirmed: true,
        confirmationText: "delete tenant_alpha rag_tenant_alpha_proj-1 2 source-1",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.error).toContain("No allow rule found");
    expect(deps.vectorStore.delete).not.toHaveBeenCalled();
    expect(deps.auditLogger.log).toHaveBeenCalledTimes(1);
  });

  it("returns approval_required when manual approval is requested", async () => {
    const deps = makeDeps();
    const adapter = new VectorDeleteAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      target: {
        sourceId: "source-1",
      },
      confirmation: {
        confirmed: true,
        confirmationText: "delete tenant_alpha rag_tenant_alpha_proj-1 2 source-1",
      },
      requireApproval: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("approval_required");
    expect(result.governance.approval.required).toBe(true);
    expect(result.governance.approval.status).toBe("pending");
    expect(deps.vectorStore.delete).not.toHaveBeenCalled();
  });

  it("supports deleting by explicit ids without protected confirmation text", async () => {
    const singleRow = makeRow();
    const deps = makeDeps({
      rowsBySourceId: [singleRow],
      rowsById: {
        "document:tenant_alpha:source-1:0": singleRow,
      },
      deletedCount: 1,
    });
    const adapter = new VectorDeleteAdapter(deps as any);

    const result = await adapter.execute({
      agentId: "agent-1",
      token: "token-1",
      namespace: "tenant_alpha",
      collection: "rag_tenant_alpha_proj-1",
      target: {
        ids: ["document:tenant_alpha:source-1:0"],
      },
      confirmation: {
        confirmed: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.deletedIds).toEqual(["document:tenant_alpha:source-1:0"]);
    expect(result.confirmation.protected).toBe(false);
  });

  it("rejects missing protected confirmation text for multi-record deletes", async () => {
    const deps = makeDeps();
    const adapter = new VectorDeleteAdapter(deps as any);

    await expect(
      adapter.execute({
        agentId: "agent-1",
        token: "token-1",
        namespace: "tenant_alpha",
        target: {
          sourceId: "source-1",
        },
        confirmation: {
          confirmed: true,
        },
      }),
    ).rejects.toThrow(/requires confirmationText/i);
  });
});
