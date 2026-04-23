import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createWebAigcRiskActionRouter } from "../routes/web-aigc-risk-actions.js";

async function withServer(
  handler: (baseUrl: string, executeMock: ReturnType<typeof vi.fn>) => Promise<void>,
): Promise<void> {
  const executeMock = vi.fn();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/rag/risk-actions",
    createWebAigcRiskActionRouter({
      vectorInsertAdapter: {
        execute: executeMock,
      } as any,
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl, executeMock);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("Web-AIGC risk action routes", () => {
  it("returns 400 when vector insert request is incomplete", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/rag/risk-actions/vector-insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });

      expect(response.status).toBe(400);
    });
  });

  it("returns 403 when adapter denies the action", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: false,
        action: "vector_insert",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        sourceId: "source-1",
        sourceType: "document",
        insertedRecords: 0,
        deduplicated: false,
        status: "denied",
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1",
          riskLevel: "medium",
          permission: { allowed: false, reason: "Denied" },
          approval: { required: false, status: "not_required" },
        },
      });

      const response = await fetch(`${baseUrl}/api/rag/risk-actions/vector-insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
          namespace: "tenant_alpha",
          payload: {
            sourceType: "document",
            sourceId: "source-1",
            projectId: "proj-1",
            content: "hello world",
            metadata: {},
            timestamp: "2026-04-22T00:00:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.status).toBe("denied");
    });
  });

  it("returns 200 when adapter completes the action", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: true,
        action: "vector_insert",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        sourceId: "source-1",
        sourceType: "document",
        insertedRecords: 3,
        deduplicated: false,
        status: "completed",
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1",
          riskLevel: "medium",
          permission: { allowed: true },
          approval: { required: false, status: "not_required" },
        },
      });

      const response = await fetch(`${baseUrl}/api/rag/risk-actions/vector-insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
          namespace: "tenant_alpha",
          payload: {
            sourceType: "document",
            sourceId: "source-1",
            projectId: "proj-1",
            content: "hello world",
            metadata: {},
            timestamp: "2026-04-22T00:00:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("completed");
      expect(executeMock).toHaveBeenCalledTimes(1);
    });
  });

  it("returns 503 when adapter is unavailable", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: false,
        action: "vector_insert",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        sourceId: "source-1",
        sourceType: "document",
        insertedRecords: 0,
        deduplicated: false,
        status: "unavailable",
        error: "metadata store unavailable",
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1",
          riskLevel: "medium",
          permission: { allowed: true },
          approval: { required: false, status: "not_required" },
        },
      });

      const response = await fetch(`${baseUrl}/api/rag/risk-actions/vector-insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
          namespace: "tenant_alpha",
          payload: {
            sourceType: "document",
            sourceId: "source-1",
            projectId: "proj-1",
            content: "hello world",
            metadata: {},
            timestamp: "2026-04-22T00:00:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("unavailable");
    });
  });

  it("routes vector-update requests when the adapter is wired", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValueOnce({
        ok: true,
        action: "vector_update",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        selectionMode: "sourceId",
        matchedRecords: 2,
        updatedRecords: 2,
        status: "completed",
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1/vector_update",
          riskLevel: "high",
          permission: { allowed: true },
          approval: { required: false, status: "not_required" },
          audit: { logged: true, operation: "vector_update" },
          rollback: {
            supported: false,
            mode: "metadata_patch_only",
            reason: "metadata only",
          },
        },
      });

      const app = express();
      app.use(express.json());
      app.use(
        "/api/rag/risk-actions",
        createWebAigcRiskActionRouter({
          vectorInsertAdapter: {
            execute: vi.fn(),
          } as any,
          vectorUpdateAdapter: {
            execute: executeMock,
          } as any,
        }),
      );

      const server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1", (error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const address = server.address() as AddressInfo;
      const scopedBaseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const response = await fetch(`${scopedBaseUrl}/api/rag/risk-actions/vector-update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe("completed");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it("routes vector-delete requests when the adapter is wired", async () => {
    const insertMock = vi.fn();
    const deleteMock = vi.fn().mockResolvedValue({
      ok: true,
      action: "vector_delete",
      namespace: "tenant_alpha",
      collection: "rag_tenant_alpha_proj-1",
      status: "completed",
      deletedIds: ["document:tenant_alpha:doc-1:0"],
      governance: {
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        resource: "tenant_alpha/rag_tenant_alpha_proj-1",
        riskLevel: "medium",
        permission: { allowed: true },
        approval: { required: false, status: "not_required" },
      },
      impact: {
        requestedDeleteCount: 1,
        matchedChunkCount: 1,
        deletedChunkCount: 1,
        remainingChunkCount: 0,
        matchedSourceIds: ["tenant_alpha:doc-1"],
        affectedProjectIds: ["proj-1"],
        affectedSourceTypes: ["document"],
      },
      confirmation: {
        confirmed: true,
        protected: false,
      },
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/api/rag/risk-actions",
      createWebAigcRiskActionRouter({
        vectorInsertAdapter: {
          execute: insertMock,
        } as any,
        vectorDeleteAdapter: {
          execute: deleteMock,
        } as any,
      }),
    );

    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/rag/risk-actions/vector-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
          namespace: "tenant_alpha",
          target: {
            ids: ["document:tenant_alpha:doc-1:0"],
          },
          confirmation: {
            confirmed: true,
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("completed");
      expect(deleteMock).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
