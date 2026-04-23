import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createVectorDeleteRouter } from "../routes/vector-delete.js";

async function withServer(
  handler: (baseUrl: string, executeMock: ReturnType<typeof vi.fn>) => Promise<void>,
): Promise<void> {
  const executeMock = vi.fn();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/vector-delete",
    createVectorDeleteRouter({
      vectorDeleteAdapter: {
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

describe("Vector delete routes", () => {
  it("returns 400 when required fields are missing", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/vector-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });

      expect(response.status).toBe(400);
    });
  });

  it("returns 409 when adapter requires approval", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: false,
        action: "vector_delete",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        status: "approval_required",
        deletedIds: [],
        governance: {
          namespace: "tenant_alpha",
          collection: "rag_tenant_alpha_proj-1",
          resource: "tenant_alpha/rag_tenant_alpha_proj-1",
          riskLevel: "high",
          permission: { allowed: true },
          approval: { required: true, status: "pending" },
        },
        impact: {
          requestedDeleteCount: 2,
          matchedChunkCount: 2,
          deletedChunkCount: 0,
          remainingChunkCount: 2,
          matchedSourceIds: ["tenant_alpha:source-1"],
          affectedProjectIds: ["proj-1"],
          affectedSourceTypes: ["document"],
        },
        confirmation: {
          confirmed: true,
          protected: true,
          confirmationText: "delete tenant_alpha rag_tenant_alpha_proj-1 2 source-1",
        },
      });

      const response = await fetch(`${baseUrl}/api/vector-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.status).toBe("approval_required");
    });
  });

  it("returns 200 when delete completes", async () => {
    await withServer(async (baseUrl, executeMock) => {
      executeMock.mockResolvedValue({
        ok: true,
        action: "vector_delete",
        namespace: "tenant_alpha",
        collection: "rag_tenant_alpha_proj-1",
        status: "completed",
        deletedIds: ["document:tenant_alpha:source-1:0"],
        sourceId: "source-1",
        sourceType: "document",
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
          matchedSourceIds: ["tenant_alpha:source-1"],
          affectedProjectIds: ["proj-1"],
          affectedSourceTypes: ["document"],
        },
        confirmation: {
          confirmed: true,
          protected: false,
        },
      });

      const response = await fetch(`${baseUrl}/api/vector-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("completed");
      expect(executeMock).toHaveBeenCalledTimes(1);
    });
  });
});
