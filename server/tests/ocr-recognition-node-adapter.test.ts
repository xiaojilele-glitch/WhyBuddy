import { describe, expect, it, vi } from "vitest";

import { executeOcrRecognitionNode } from "../routes/node-adapters/ocr-recognition-node-adapter.js";

describe("executeOcrRecognitionNode", () => {
  it("returns OCR text, page and fragment details, and persisted artifact metadata", async () => {
    const recognizeImages = vi.fn(async () =>
      new Map([
        [
          "invoice.png",
          {
            text: "Invoice #42\nTotal: $12.00",
            fragments: [
              { text: "Invoice #42", page: 1, region: "top-left" as const },
              { text: "Total: $12.00", page: 1, region: "bottom-right" as const },
            ],
            pages: [{ page: 1, text: "Invoice #42\nTotal: $12.00" }],
            rawResponse: '{"text":"Invoice #42\\nTotal: $12.00"}',
          },
        ],
      ]),
    );
    const persistArtifacts = vi.fn(async () => ({
      outputId: "ocr-node-test",
      artifacts: [
        {
          kind: "file" as const,
          name: "ocr-results.json",
          path: "tmp/vision-outputs/ocr-node-test/ocr-results.json",
          mimeType: "application/json",
          downloadUrl: "/api/vision/outputs/ocr-node-test/ocr-results.json",
          description: "OCR output artifact (ocr-results.json)",
        },
      ],
    }));

    const result = await executeOcrRecognitionNode(
      {
        nodeType: "ocr_recognition",
        input: {
          images: [
            {
              name: "invoice.png",
              base64DataUrl: "data:image/png;base64,abc123",
            },
          ],
          artifact: {
            outputId: "ocr-node-test",
            outputFormats: ["json"],
          },
          context: {
            requestId: "ocr-1",
          },
        },
      },
      {
        recognizeImages,
        persistArtifacts,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(122),
      },
    );

    expect(recognizeImages).toHaveBeenCalledWith(
      [
        {
          name: "invoice.png",
          base64DataUrl: "data:image/png;base64,abc123",
        },
      ],
      undefined,
    );
    expect(persistArtifacts).toHaveBeenCalled();
    expect(result.output.text).toBe("Invoice #42\nTotal: $12.00");
    expect(result.output.pages).toEqual([
      { page: 1, text: "Invoice #42\nTotal: $12.00" },
    ]);
    expect(result.output.fragments).toEqual([
      { text: "Invoice #42", page: 1, region: "top-left" },
      { text: "Total: $12.00", page: 1, region: "bottom-right" },
    ]);
    expect(result.output.artifact).toMatchObject({
      outputId: "ocr-node-test",
      requestedFormats: ["json"],
    });
    expect(result.output.context).toMatchObject({
      requestId: "ocr-1",
      ocrRecognition: {
        text: "Invoice #42\nTotal: $12.00",
        results: [
          {
            name: "invoice.png",
            text: "Invoice #42\nTotal: $12.00",
          },
        ],
        artifact: {
          outputId: "ocr-node-test",
        },
      },
    });
    expect(result.output.observability).toEqual({
      eventKey: "multimodal.ocr_recognition",
      nodeType: "ocr_recognition",
      imageCount: 1,
      totalPageCount: 1,
      totalFragmentCount: 2,
      artifactPersisted: true,
      latencyMs: 22,
    });
  });

  it("preserves page information for multi-image or multi-page OCR payloads", async () => {
    const result = await executeOcrRecognitionNode(
      {
        nodeType: "ocr_recognition",
        input: {
          images: [
            {
              name: "page-1.png",
              base64DataUrl: "data:image/png;base64,page1",
            },
            {
              name: "page-2.png",
              base64DataUrl: "data:image/png;base64,page2",
            },
          ],
          artifact: {
            persistOutput: false,
          },
        },
      },
      {
        recognizeImages: vi.fn(async () =>
          new Map([
            [
              "page-1.png",
              {
                text: "第一页",
                fragments: [{ text: "第一页", page: 1, region: "top" }],
                pages: [{ page: 1, text: "第一页" }],
                rawResponse: '{"text":"第一页"}',
              },
            ],
            [
              "page-2.png",
              {
                text: "第二页",
                fragments: [{ text: "第二页", page: 2, region: "middle" }],
                pages: [{ page: 2, text: "第二页" }],
                rawResponse: '{"text":"第二页"}',
              },
            ],
          ]),
        ),
      },
    );

    expect(result.output.artifact).toBeUndefined();
    expect(result.output.pages).toEqual([
      { page: 1, text: "第一页" },
      { page: 2, text: "第二页" },
    ]);
    expect(result.output.fragments).toEqual([
      { text: "第一页", page: 1, region: "top" },
      { text: "第二页", page: 2, region: "middle" },
    ]);
  });

  it("fills missing image results with fallback payloads instead of failing the whole node", async () => {
    const result = await executeOcrRecognitionNode(
      {
        nodeType: "ocr_recognition",
        input: {
          images: [
            {
              name: "ok.png",
              base64DataUrl: "data:image/png;base64,ok",
            },
            {
              name: "missing.png",
              base64DataUrl: "data:image/png;base64,missing",
            },
          ],
        },
      },
      {
        recognizeImages: vi.fn(async () =>
          new Map([
            [
              "ok.png",
              {
                text: "正常识别",
                fragments: [{ text: "正常识别", page: 1 }],
                pages: [{ page: 1, text: "正常识别" }],
                rawResponse: '{"text":"正常识别"}',
              },
            ],
          ]),
        ),
        persistArtifacts: vi.fn(async () => ({
          outputId: "ocr-fallback",
          artifacts: [],
        })),
      },
    );

    expect(result.output.results).toHaveLength(2);
    expect(result.output.results[1].recognition).toEqual({
      text: "",
      fragments: [],
      pages: [{ page: 1, text: "" }],
      rawResponse: "fallback:missing.png",
    });
    expect(result.output.warnings[0]).toContain("missing.png");
  });
});
