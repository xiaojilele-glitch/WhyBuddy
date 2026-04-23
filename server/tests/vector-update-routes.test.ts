import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createVectorUpdateRouter } from "../routes/vector-update.js";

async function withServer(
  handler: (baseUrl: string, executeMock: ReturnType<typeof vi.fn>) => Promise<void>,
): Promise<void> {
  const executeMock = vi.fn();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/vector-update",
    createVectorUpdateRouter({
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
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl, executeMock);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("POST /api/vector-update", () => {
  it("returns 400 when request is incomplete", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vector-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  it("returns 200 when adapter completes vector update", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
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

      const response = await fetch(`${baseUrl}/api/vector-update`, {
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
      expect(executeMock).toHaveBeenCalledTimes(1);
    });
  });

  it("returns 403 when adapter requires approval", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: false,
        action: "vector_update",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        selectionMode: "sourceId",
        matchedRecords: 0,
        updatedRecords: 0,
        status: "approval_required",
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1/vector_update",
          riskLevel: "critical",
          permission: { allowed: false },
          approval: { required: true, status: "pending" },
          audit: { logged: true, operation: "vector_update" },
          rollback: {
            supported: false,
            mode: "metadata_patch_only",
            reason: "metadata only",
          },
        },
      });

      const response = await fetch(`${baseUrl}/api/vector-update`, {
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

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.status).toBe("approval_required");
    });
  });

  it("returns 503 when adapter reports unavailable backend", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: false,
        action: "vector_update",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        selectionMode: "ids",
        matchedRecords: 0,
        updatedRecords: 0,
        status: "unavailable",
        error: "vector store backend is not connected",
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

      const response = await fetch(`${baseUrl}/api/vector-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-1",
          token: "token-1",
          namespace: "tenant_alpha",
          projectId: "proj-1",
          selection: {
            ids: ["document:tenant_alpha:doc-1:0"],
          },
          metadataPatch: {
            reviewStatus: "approved",
          },
        }),
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("unavailable");
    });
  });
});
