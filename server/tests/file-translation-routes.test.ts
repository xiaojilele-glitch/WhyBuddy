import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFileTranslationRouter } from "../routes/file-translation.js";
import { clearFileTranslationOutputStoreForTests } from "../routes/node-adapters/file-translation-node-adapter.js";

afterEach(() => {
  clearFileTranslationOutputStoreForTests();
});

async function withServer(
  deps: Parameters<typeof createFileTranslationRouter>[0],
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/file-translation", createFileTranslationRouter(deps));

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
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

describe("file translation routes", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/file-translation/nodes/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "dialogue",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "nodeType must be file_translation",
      });
    });
  });

  it("executes translation and serves the generated output artifact", async () => {
    const translateSegment = vi.fn(
      async (input: { text: string; targetLanguage: string }) =>
        `${input.targetLanguage}:${input.text}`,
    );

    await withServer({ translateSegment }, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/file-translation/nodes/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "file_translation",
            input: {
              file: {
                name: "guide.md",
                mimeType: "text/markdown; charset=utf-8",
                content: "# Intro\n\n- First\n- Second",
              },
              sourceLanguage: "en",
              targetLanguage: "zh-CN",
              artifact: {
                outputId: "route-output",
                outputFormat: "md",
              },
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.artifact.artifact.downloadUrl).toBe(
        "/api/file-translation/outputs/route-output/guide.zh-CN.md",
      );

      const downloadResponse = await fetch(
        `${baseUrl}${body.output.artifact.artifact.downloadUrl}`,
      );
      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get("content-type")).toContain(
        "text/markdown",
      );
      expect(await downloadResponse.text()).toBe(
        "# zh-CN:Intro\n\n- zh-CN:First\n- zh-CN:Second",
      );
    });
  });

  it("returns 400 when translation content is missing", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/file-translation/nodes/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "file_translation",
            input: {
              targetLanguage: "zh-CN",
            },
          }),
        },
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain(
        "File translation requires file.content, document.text, or content.",
      );
    });
  });

  it("returns 413 when the request exceeds the maxChars boundary", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/file-translation/nodes/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeType: "file_translation",
            input: {
              content: "123456789",
              targetLanguage: "zh-CN",
              limits: {
                maxChars: 5,
              },
            },
          }),
        },
      );

      expect(response.status).toBe(413);
      const body = await response.json();
      expect(body.error).toContain("exceeds maxChars limit");
    });
  });
});
