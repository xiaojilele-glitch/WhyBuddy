import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFileTranslationOutputStoreForTests,
  executeFileTranslationNode,
  getFileTranslationOutput,
} from "../routes/node-adapters/file-translation-node-adapter.js";

afterEach(() => {
  clearFileTranslationOutputStoreForTests();
});

describe("executeFileTranslationNode", () => {
  it("translates structured markdown content and registers an output artifact", async () => {
    const translateSegment = vi.fn(
      async (input: { text: string; targetLanguage: string; kind: string }) =>
        `${input.targetLanguage}:${input.kind}:${input.text}`,
    );

    const result = await executeFileTranslationNode(
      {
        nodeType: "file_translation",
        input: {
          file: {
            name: "guide.md",
            mimeType: "text/markdown; charset=utf-8",
            content: "# Overview\n\n- Alpha\n- Beta\n\nClosing note.",
          },
          sourceLanguage: "en",
          targetLanguage: "zh-CN",
          preserveStructure: true,
          artifact: {
            outputId: "translation-node-output",
            outputFormat: "md",
          },
          context: {
            requestId: "ft-node-1",
          },
        },
      },
      {
        translateSegment,
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(34),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.output.translation.structurePreserved).toBe(true);
    expect(result.output.translation.text).toBe(
      "# zh-CN:heading:Overview\n\n- zh-CN:list_item:Alpha\n- zh-CN:list_item:Beta\n\nzh-CN:paragraph:Closing note.",
    );
    expect(result.output.translation.segments.map(segment => segment.kind)).toEqual([
      "heading",
      "blank",
      "list_item",
      "list_item",
      "blank",
      "paragraph",
    ]);
    expect(result.output.artifact).toMatchObject({
      outputId: "translation-node-output",
      format: "md",
      artifact: {
        name: "guide.zh-CN.md",
        mimeType: "text/markdown; charset=utf-8",
        downloadUrl:
          "/api/file-translation/outputs/translation-node-output/guide.zh-CN.md",
      },
    });
    expect(result.output.context).toMatchObject({
      requestId: "ft-node-1",
      fileTranslation: {
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
        structurePreserved: true,
      },
    });
    expect(result.output.observability).toEqual({
      eventKey: "content.file_translation",
      nodeType: "file_translation",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      segmentCount: 6,
      inputChars: 41,
      artifactPersisted: true,
      latencyMs: 24,
    });
    expect(translateSegment).toHaveBeenCalledTimes(4);

    const storedOutput = getFileTranslationOutput(
      "translation-node-output",
      "guide.zh-CN.md",
    );
    expect(storedOutput?.content).toBe(result.output.translation.text);
  });

  it("supports document text input and json output artifacts", async () => {
    const result = await executeFileTranslationNode({
      nodeType: "file_translation",
      input: {
        document: {
          title: "meeting-notes",
          text: "Summary line\nSecond line",
        },
        sourceLanguage: "en",
        targetLanguage: "ja-JP",
        preserveStructure: false,
        artifact: {
          outputId: "translation-json-output",
          outputFormat: "json",
        },
      },
    });

    expect(result.output.translation.structurePreserved).toBe(false);
    expect(result.output.translation.text).toBe(
      "[ja-JP] Summary line\n[ja-JP] Second line",
    );
    expect(result.output.artifact).toMatchObject({
      outputId: "translation-json-output",
      format: "json",
      artifact: {
        name: "meeting-notes.ja-JP.json",
        mimeType: "application/json; charset=utf-8",
      },
    });

    const storedOutput = getFileTranslationOutput(
      "translation-json-output",
      "meeting-notes.ja-JP.json",
    );
    expect(JSON.parse(storedOutput?.content || "{}")).toMatchObject({
      translation: {
        targetLanguage: "ja-JP",
        structurePreserved: false,
      },
    });
  });

  it("rejects oversized content when maxChars is exceeded", async () => {
    await expect(
      executeFileTranslationNode({
        nodeType: "file_translation",
        input: {
          content: "123456789",
          targetLanguage: "zh-CN",
          limits: {
            maxChars: 5,
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: "File translation content exceeds maxChars limit (9 > 5).",
    });
  });
});
