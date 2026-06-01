import { describe, expect, it } from "vitest";

import { executeSimilarityMatchNode } from "../routes/node-adapters/similarity-match-node-adapter.js";

describe("executeSimilarityMatchNode", () => {
  it("returns a matched branch with hybrid scoring and lightweight hash-vector fallback", async () => {
    const result = await executeSimilarityMatchNode({
      nodeType: "similarity_match",
      input: {
        query: "whybuddy agent orchestration",
        candidates: [
          {
            candidateId: "workflow",
            text: "whybuddy workflow orchestration and agent routing",
            metadata: { source: "spec" },
          },
          {
            candidateId: "weather",
            text: "today weather forecast for shanghai downtown",
          },
        ],
        options: {
          mode: "hybrid",
          threshold: 0.45,
          topK: 2,
        },
        context: {
          workflowId: "wf-sim-1",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.strategy.mode).toBe("hybrid");
    expect(result.output.strategy.usedHashVectorFallback).toBe(true);
    expect(result.output.bestMatch?.candidateId).toBe("workflow");
    expect(result.output.bestMatch?.score).toBeGreaterThan(0.45);
    expect(result.output.summary).toMatchObject({
      matched: true,
      matchedCount: 1,
      threshold: 0.45,
    });
    expect(result.output.branch).toEqual({
      selected: "matched",
      conditions: {
        matched: true,
        not_matched: false,
      },
    });
    expect(result.output.result.branch.selected).toBe("matched");
    expect(result.output.matches.map(item => item.candidateId)).toEqual(["workflow"]);
    expect(result.output.context).toEqual({
      workflowId: "wf-sim-1",
    });
    expect(result.output.observability).toMatchObject({
      eventKey: "external.similarity_match",
      nodeType: "similarity_match",
      mode: "hybrid",
      threshold: 0.45,
      candidateCount: 2,
      matchedCount: 1,
    });
    expect(result.output.warnings).toContain(
      "Vector comparison reused the lightweight hash-vector strategy because explicit vectors were not supplied for all inputs.",
    );
  });

  it("supports explicit vector comparison in vector mode", async () => {
    const result = await executeSimilarityMatchNode({
      nodeType: "similarity_match",
      input: {
        queryVector: [1, 0, 0],
        candidates: [
          {
            candidateId: "alpha",
            vector: [0.99, 0.01, 0],
          },
          {
            candidateId: "beta",
            vector: [0, 1, 0],
          },
        ],
        options: {
          mode: "vector",
          threshold: 0.9,
        },
      },
    });

    expect(result.output.strategy).toMatchObject({
      mode: "vector",
      usedExplicitQueryVector: true,
      usedExplicitCandidateVectors: true,
      usedHashVectorFallback: false,
    });
    expect(result.output.bestMatch?.candidateId).toBe("alpha");
    expect(result.output.bestMatch?.vectorScore).toBeGreaterThan(0.99);
    expect(result.output.bestMatch?.textScore).toBe(0);
    expect(result.output.summary.matched).toBe(true);
    expect(result.output.branch.selected).toBe("matched");
  });

  it("returns a not_matched branch when the top score stays below the threshold", async () => {
    const result = await executeSimilarityMatchNode({
      nodeType: "similarity_match",
      input: {
        query: "cube office workflow runtime",
        candidates: [
          {
            candidateId: "finance",
            text: "quarterly tax filing and accounting calendar",
          },
          {
            candidateId: "travel",
            text: "flight booking notes and luggage allowance",
          },
        ],
        options: {
          mode: "text",
          threshold: 0.95,
        },
      },
    });

    expect(result.output.summary).toMatchObject({
      matched: false,
      matchedCount: 0,
      threshold: 0.95,
    });
    expect(result.output.matches).toEqual([]);
    expect(result.output.branch).toEqual({
      selected: "not_matched",
      conditions: {
        matched: false,
        not_matched: true,
      },
    });
  });

  it("rejects requests without query text or queryVector", async () => {
    await expect(
      executeSimilarityMatchNode({
        nodeType: "similarity_match",
        input: {
          candidates: [
            {
              candidateId: "alpha",
              text: "whybuddy",
            },
          ],
        },
      }),
    ).rejects.toThrow(/requires query text or queryVector/i);
  });

  it("rejects requests without comparable candidates", async () => {
    await expect(
      executeSimilarityMatchNode({
        nodeType: "similarity_match",
        input: {
          query: "whybuddy",
          candidates: [
            {
              candidateId: "empty",
              metadata: { ignored: true },
            },
          ],
        },
      }),
    ).rejects.toThrow(/at least one comparable candidate/i);
  });
});
