/**
 * R2-B: deliberation capability routing via POST /api/whybuddy/execute-capability
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../routes/blueprint/brainstorm/pool-llm-caller.js", () => ({
  createPoolBackedBrainstormCaller: vi.fn(() => null),
}));
import express from "express";
import { createServer } from "node:http";

import whybuddyRouter from "../whybuddy.js";
import * as deliberationProtocol from "../../routes/blueprint/brainstorm/deliberation-protocol.js";
import * as llmClient from "../../core/llm-client.js";

describe("POST /api/whybuddy/execute-capability — deliberation (R2)", () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/whybuddy", whybuddyRouter);

  let server: any;
  let base: string;
  const origKey = process.env.LLM_API_KEY;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (origKey) process.env.LLM_API_KEY = origKey;
    else delete process.env.LLM_API_KEY;
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rebuttal.resolve without upstream Critique degrades to rule artifact (R2-B4)", async () => {
    const delibSpy = vi.spyOn(deliberationProtocol, "executeDeliberation");

    const res = await fetch(`${base}/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "rebuttal.resolve",
        state: {
          sessionId: "r2-miss",
          goal: { text: "权限系统" },
          artifacts: [{ id: "a1", kind: "evidence", content: "no payload here" }],
        },
        inputArtifactIds: ["a1"],
        turnId: "r2-miss",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe("ai_generated");
    expect(body.degraded).toBe(true);
    expect(body.degradedReason).toBe("missing_upstream_critique");
    expect(body.content).toMatch(/未找到可消解的 Critique/i);
    expect(delibSpy).not.toHaveBeenCalled();
  });

  it("rebuttal.resolve with upstream Critique payload returns structured bundle (R2-B5)", async () => {
    vi.spyOn(llmClient, "callLLM").mockImplementation(async (messages: any) => {
      const prompt = String(messages?.[0]?.content || "");
      if (prompt.includes("adjudicator")) {
        return {
          content: JSON.stringify({
            consensusReached: false,
            convergenceScore: 0.45,
            unresolvedCritiqueIds: ["crit-1"],
            rationale: "核心分歧仍在",
          }),
          usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 },
        } as any;
      }
      return {
        content: JSON.stringify({
          rebuttal: "我接受部分质疑，但核心方案仍成立。",
          stance: "defend",
        }),
        usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
      } as any;
    });

    const critique = {
      id: "crit-1",
      challengerRoleId: "auditor",
      targetRoleId: "architect",
      targetClaim: "RBAC 足够覆盖数据范围",
      critique: "缺少租户级隔离策略",
      severity: "high",
      roundNumber: 1,
      resolved: false,
    };

    const res = await fetch(`${base}/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "rebuttal.resolve",
        state: {
          sessionId: "r2-hit",
          goal: { text: "权限系统" },
          artifacts: [
            {
              id: "crit-art",
              kind: "risk",
              content: "质疑",
              payload: [critique],
            },
          ],
        },
        inputArtifactIds: ["crit-art"],
        turnId: "r2-hit",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe("llm");
    expect(body.payload?.rebuttals).toBeDefined();
    expect(body.payload?.adjudication).toBeDefined();
    expect(body.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("counter.argue passes minRounds:1 config to executeDeliberation (R2 M1)", async () => {
    const delibSpy = vi.spyOn(deliberationProtocol, "executeDeliberation").mockImplementation(
      async (input) => {
        expect(input.config).toEqual({ minRounds: 1, maxRounds: 1 });
        return {
          rounds: [],
          finalConvergenceScore: 0,
          consensusAchieved: false,
          totalChallenges: 0,
          unresolvedChallenges: [],
          dissentingOpinions: [],
        };
      }
    );

    vi.spyOn(llmClient, "callLLM").mockResolvedValue({
      content: JSON.stringify({ critique: "风险未覆盖", severity: "medium" }),
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    } as any);

    const res = await fetch(`${base}/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "counter.argue",
        state: { sessionId: "r2-ca", goal: { text: "分析权限方案" } },
        inputArtifactIds: [],
        roleId: "挑刺",
        turnId: "r2-ca",
        deliberationMaxRounds: 1,
      }),
    });

    expect(res.status).toBe(200);
    expect(delibSpy).toHaveBeenCalled();
    const body = await res.json();
    expect(body.title).toMatch(/反驳论证/);
  });
});