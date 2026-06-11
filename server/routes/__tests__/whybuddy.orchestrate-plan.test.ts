import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";

import whybuddyRouter from "../whybuddy.js";
import * as llmClient from "../../core/llm-client.js";
import { withStubbedLlmKey } from "./helpers/with-stubbed-llm-key.js";

describe("POST /api/whybuddy/orchestrate-plan (R1-B2)", () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/whybuddy", whybuddyRouter);

  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

  const baseBody = {
    turnId: "t-orch",
    userText: "对比一下方案的运维成本",
    state: {
      sessionId: "s1",
      goal: { text: "权限系统", status: "needs_refinement" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
    },
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreLlmKey?.();
    restoreLlmKey = undefined;
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("returns 400 when turnId is missing", async () => {
    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: baseBody.state, userText: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns heuristic_fallback with reason no_api_key when key absent", async () => {
    restoreLlmKey?.();
    restoreLlmKey = undefined;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("heuristic_fallback");
    expect(body.reason).toBe("no_api_key");
    expect(body.selected.length).toBeGreaterThan(0);
  });

  it("returns llm proposal on mocked success", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
      json: {
        selected: [
          { capabilityId: "route.compare", roleId: "工程", why: "用户要对比运维成本" },
          { capabilityId: "tradeoff.evaluate", roleId: "工程" },
        ],
        rationale: "先对比路线再评估权衡",
      },
      usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
    } as any);

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("llm");
    expect(body.selected[0].capabilityId).toBe("route.compare");
    expect(body.usage?.totalTokens).toBe(80);
    expect(body.reason).toBeUndefined();
  });

  it("accepts LLM alias capability fields and normalizes ids (F0.1)", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
      json: {
        selected: [{ capability: "tradeoff_evaluate", role: "工程" }],
        rationale: "评估运维权衡",
      },
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    } as any);

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("llm");
    expect(body.selected[0].capabilityId).toBe("tradeoff.evaluate");
  });

  it("returns heuristic_fallback with reason llm_error when LLM throws", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockRejectedValueOnce(new Error("timeout"));

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("heuristic_fallback");
    expect(body.reason).toBe("llm_error");
  });

  it("returns heuristic_fallback with reason invalid_proposal when LLM returns garbage", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
      json: { selected: [{ capabilityId: "not.real", roleId: "x" }], rationale: "bad" },
    } as any);

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("heuristic_fallback");
    expect(body.reason).toBe("invalid_proposal");
  });

  it("returns heuristic_fallback with reason empty_response when rationale missing", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
      json: {
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        rationale: "",
      },
    } as any);

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("heuristic_fallback");
    expect(body.reason).toBe("empty_response");
  });
});