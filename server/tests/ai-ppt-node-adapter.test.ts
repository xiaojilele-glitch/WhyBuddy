import { describe, expect, it, vi } from "vitest";

import { executeAiPptNode } from "../routes/node-adapters/ai-ppt-node-adapter.js";

describe("executeAiPptNode", () => {
  it("returns generated deck output and persisted artifact metadata", async () => {
    const generateDeck = vi.fn(async () => ({
      title: "季度经营复盘",
      summary: "聚焦经营表现、问题分析与下阶段动作。",
      slides: [
        {
          slideNumber: 1,
          title: "经营表现总览",
          bullets: ["收入增长 18%", "续费率稳定在 92%"],
          speakerNotes: "先讲整体，再展开重点异常。",
        },
        {
          slideNumber: 2,
          title: "下一步动作",
          bullets: ["聚焦高潜客户", "推进自动化交付"],
        },
      ],
    }));
    const persistOutput = vi.fn(async () => ({
      outputId: "ai-ppt-node-output",
      artifacts: [
        {
          kind: "file" as const,
          name: "ai-ppt-node-output.ppt.json",
          path: "tmp/ai-ppt-outputs/ai-ppt-node-output/ai-ppt-node-output.ppt.json",
          mimeType: "application/json",
          downloadUrl:
            "/api/ai-ppt/outputs/ai-ppt-node-output/ai-ppt-node-output.ppt.json",
          description: "AI PPT output artifact (ai-ppt-node-output.ppt.json)",
        },
      ],
    }));

    const result = await executeAiPptNode(
      {
        nodeType: "ai_ppt",
        input: {
          topic: "季度经营复盘",
          brief: "输出给管理层的季度汇报材料",
          audience: "管理层",
          slideCount: 5,
          context: {
            traceId: "ppt-1",
          },
        },
      },
      {
        generateDeck,
        persistOutput,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145),
      },
    );

    expect(generateDeck).toHaveBeenCalledWith({
      topic: "季度经营复盘",
      brief: "输出给管理层的季度汇报材料",
      audience: "管理层",
      slideCount: 5,
    });
    expect(persistOutput).toHaveBeenCalled();
    expect(result.output.status).toBe("completed");
    expect(result.output.degraded).toBe(false);
    expect(result.output.deck.generationMode).toBe("generated");
    expect(result.output.deck.title).toBe("季度经营复盘");
    expect(result.output.artifact).toMatchObject({
      outputId: "ai-ppt-node-output",
    });
    expect(result.output.context).toMatchObject({
      traceId: "ppt-1",
      aiPpt: {
        title: "季度经营复盘",
        slideCount: 2,
        generationMode: "generated",
      },
    });
    expect(result.output.observability).toEqual({
      eventKey: "content.ai_ppt",
      nodeType: "ai_ppt",
      slideCount: 2,
      artifactPersisted: true,
      degraded: false,
      latencyMs: 45,
    });
  });

  it("falls back to a local deck when generation fails", async () => {
    const result = await executeAiPptNode(
      {
        nodeType: "ai_ppt",
        input: {
          topic: "新品发布会",
          brief: "突出产品定位、差异化与发布节奏",
          slideCount: 4,
        },
      },
      {
        generateDeck: vi.fn(async () => {
          throw new Error("provider timeout");
        }),
        persistOutput: vi.fn(async (deck) => ({
          outputId: "ai-ppt-fallback",
          artifacts: [
            {
              kind: "file" as const,
              name: "ai-ppt-fallback.ppt.json",
              path: "tmp/ai-ppt-outputs/ai-ppt-fallback/ai-ppt-fallback.ppt.json",
              mimeType: "application/json",
              downloadUrl:
                "/api/ai-ppt/outputs/ai-ppt-fallback/ai-ppt-fallback.ppt.json",
              description: "AI PPT output artifact (ai-ppt-fallback.ppt.json)",
            },
          ],
        })),
      },
    );

    expect(result.output.status).toBe("degraded");
    expect(result.output.degraded).toBe(true);
    expect(result.output.deck.generationMode).toBe("fallback");
    expect(result.output.deck.slides).toHaveLength(4);
    expect(result.output.fallbackReason).toContain("provider timeout");
    expect(result.output.warnings).toContain(
      "AI PPT 生成器失败，已自动回退到本地模板页纲。",
    );
    expect(result.output.artifact?.artifacts[0].downloadUrl).toContain(
      "/api/ai-ppt/outputs/ai-ppt-fallback/",
    );
  });

  it("rejects empty generation input", async () => {
    await expect(
      executeAiPptNode({
        nodeType: "ai_ppt",
        input: {},
      }),
    ).rejects.toThrow(/requires topic, brief, or sourcetext/i);
  });
});
