import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createSimilarityMatchRouter } from "../routes/similarity-match.js";

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/similarity-match", createSimilarityMatchRouter());

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe("POST /api/similarity-match/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/similarity-match/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dialogue",
          input: {
            query: "cube",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType must be similarity_match");
    });
  });

  it("returns matched downstream-ready output for a valid request", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/similarity-match/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "similarity_match",
          input: {
            query: "whybuddy workflow",
            candidates: [
              {
                candidateId: "workflow",
                text: "whybuddy workflow orchestration",
              },
              {
                candidateId: "music",
                text: "daily piano practice checklist",
              },
            ],
            options: {
              mode: "hybrid",
              threshold: 0.4,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.nodeType).toBe("similarity_match");
      expect(body.output.bestMatch.candidateId).toBe("workflow");
      expect(body.output.summary.matched).toBe(true);
      expect(body.output.branch.selected).toBe("matched");
      expect(body.output.result.branch.selected).toBe("matched");
      expect(body.output.observability).toMatchObject({
        eventKey: "external.similarity_match",
        nodeType: "similarity_match",
        mode: "hybrid",
        candidateCount: 2,
        matchedCount: 1,
      });
    });
  });

  it("returns 400 when candidates are missing", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/similarity-match/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "similarity_match",
          input: {
            query: "whybuddy workflow",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("requires candidates");
    });
  });
});
