import express from "express";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createAiPptRouter } from "../routes/ai-ppt.js";

async function withServer(
  deps: Parameters<typeof createAiPptRouter>[0],
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/ai-ppt", createAiPptRouter(deps));

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
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("POST /api/ai-ppt/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/ai-ppt/nodes/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeType: "dialogue" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "nodeType must be ai_ppt",
      });
    });
  });

  it("returns deck output and downloads persisted artifact", async () => {
    const outputId = "ai-ppt-route-output";
    const fileName = "deck.json";
    const outputDir = path.join(process.cwd(), "tmp/ai-ppt-outputs", outputId);

    await rm(outputDir, { recursive: true, force: true });

    await withServer(
      {
        generateDeck: vi.fn(async () => ({
          title: "客户方案演示",
          summary: "聚焦业务问题、方案能力与交付节奏。",
          slides: [
            {
              slideNumber: 1,
              title: "背景与目标",
              bullets: ["客户当前流程分散", "期望缩短交付周期"],
            },
            {
              slideNumber: 2,
              title: "方案能力",
              bullets: ["自动化编排", "任务追踪与审计"],
            },
          ],
        })),
        createOutputId: () => outputId,
      },
      async baseUrl => {
        const response = await fetch(`${baseUrl}/api/ai-ppt/nodes/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "ai_ppt",
            input: {
              topic: "客户方案演示",
              artifact: {
                fileName,
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(body.output.status).toBe("completed");
        expect(body.output.artifact.outputId).toBe(outputId);
        expect(body.output.artifact.artifacts[0]).toMatchObject({
          name: fileName,
          downloadUrl: `/api/ai-ppt/outputs/${outputId}/${fileName}`,
        });

        const downloadResponse = await fetch(
          `${baseUrl}/api/ai-ppt/outputs/${outputId}/${fileName}`,
        );
        expect(downloadResponse.status).toBe(200);
        expect(downloadResponse.headers.get("content-type")).toContain(
          "application/json",
        );

        const payload = await downloadResponse.json();
        expect(payload.deck.title).toBe("客户方案演示");
        expect(payload.deck.slides).toHaveLength(2);
      },
    );

    await rm(outputDir, { recursive: true, force: true });
  });

  it("returns degraded output when generation fails and fallback is used", async () => {
    const outputId = "ai-ppt-route-fallback";
    const outputDir = path.join(process.cwd(), "tmp/ai-ppt-outputs", outputId);

    await rm(outputDir, { recursive: true, force: true });

    await withServer(
      {
        generateDeck: vi.fn(async () => {
          throw new Error("upstream unavailable");
        }),
        createOutputId: () => outputId,
      },
      async baseUrl => {
        const response = await fetch(`${baseUrl}/api/ai-ppt/nodes/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "ai_ppt",
            input: {
              topic: "经营周报",
              brief: "用于部门晨会同步关键指标",
              slideCount: 3,
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(body.output.status).toBe("degraded");
        expect(body.output.degraded).toBe(true);
        expect(body.output.deck.generationMode).toBe("fallback");
        expect(body.output.deck.slides).toHaveLength(3);
        expect(body.output.fallbackReason).toContain("upstream unavailable");
      },
    );

    await rm(outputDir, { recursive: true, force: true });
  });

  it("returns 404 for missing output artifact downloads", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/ai-ppt/outputs/missing-output/missing.json`,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Output artifact not found",
      });
    });
  });
});
