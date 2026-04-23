import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createOcrRecognitionRouter } from "../routes/ocr-recognition.js";

async function withServer(
  deps: Parameters<typeof createOcrRecognitionRouter>[0],
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/ocr-recognition", createOcrRecognitionRouter(deps));

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

describe("POST /api/ocr-recognition/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer({}, async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/ocr-recognition/nodes/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeType: "dialogue" }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "nodeType must be ocr_recognition",
      });
    });
  });

  it("returns OCR payload with artifact metadata and page details", async () => {
    const recognizeImages = vi.fn(async () =>
      new Map([
        [
          "receipt.png",
          {
            text: "Total: $12.00",
            fragments: [{ text: "Total: $12.00", page: 1, region: "middle" }],
            pages: [{ page: 1, text: "Total: $12.00" }],
            rawResponse: '{"text":"Total: $12.00"}',
          },
        ],
      ]),
    );
    const persistArtifacts = vi.fn(async () => ({
      outputId: "ocr-route-output",
      artifacts: [
        {
          kind: "file" as const,
          name: "ocr-results.txt",
          path: "tmp/vision-outputs/ocr-route-output/ocr-results.txt",
          mimeType: "text/plain; charset=utf-8",
          downloadUrl: "/api/vision/outputs/ocr-route-output/ocr-results.txt",
          description: "OCR output artifact (ocr-results.txt)",
        },
      ],
    }));

    await withServer(
      { recognizeImages, persistArtifacts },
      async baseUrl => {
        const response = await fetch(
          `${baseUrl}/api/ocr-recognition/nodes/execute`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nodeType: "ocr_recognition",
              input: {
                images: [
                  {
                    name: "receipt.png",
                    base64DataUrl: "data:image/png;base64,abc123",
                  },
                ],
                artifact: {
                  outputFormats: ["txt"],
                },
              },
            }),
          },
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.output.text).toBe("Total: $12.00");
        expect(body.output.pages).toEqual([{ page: 1, text: "Total: $12.00" }]);
        expect(body.output.fragments).toEqual([
          { text: "Total: $12.00", page: 1, region: "middle" },
        ]);
        expect(body.output.artifact).toMatchObject({
          outputId: "ocr-route-output",
          requestedFormats: ["txt"],
        });
      },
    );
  });

  it("returns 500 when OCR artifact persistence fails", async () => {
    await withServer(
      {
        recognizeImages: vi.fn(async () =>
          new Map([
            [
              "receipt.png",
              {
                text: "Total: $12.00",
                fragments: [],
                pages: [{ page: 1, text: "Total: $12.00" }],
                rawResponse: '{"text":"Total: $12.00"}',
              },
            ],
          ]),
        ),
        persistArtifacts: vi.fn(async () => {
          throw new Error("disk full");
        }),
      },
      async baseUrl => {
        const response = await fetch(
          `${baseUrl}/api/ocr-recognition/nodes/execute`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nodeType: "ocr_recognition",
              input: {
                images: [
                  {
                    name: "receipt.png",
                    base64DataUrl: "data:image/png;base64,abc123",
                  },
                ],
              },
            }),
          },
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toContain("disk full");
      },
    );
  });
});
