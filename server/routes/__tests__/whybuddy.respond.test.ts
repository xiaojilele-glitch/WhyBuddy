import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";

import whybuddyRouter from "../whybuddy.js";
import * as llmClient from "../../core/llm-client.js";
import { withStubbedLlmKey } from "./helpers/with-stubbed-llm-key.js";
import { FALLBACK_BANNED_RE } from "../../../shared/blueprint/whybuddy-deliverable-sanitize.js";

describe("POST /api/whybuddy/respond", () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/whybuddy", whybuddyRouter);

  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

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
    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { sessionId: "s1", goal: { text: "x" } } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns fallback narration with HTTP 200 when LLM is unavailable", async () => {
    restoreLlmKey?.();
    restoreLlmKey = undefined;
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-fb",
        userText: "分析风险",
        state: { sessionId: "s1", goal: { text: "权限", status: "needs_refinement" } },
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        mainArtifact: {
          kind: "report",
          title: "报告",
          content:
            "结论：建议推进。主要风险在数据范围越权与审计链路延迟，需要补齐角色继承与字段级授权策略。" +
            "\n下一步工程化分支：\n- secret branch",
        },
      }),
    });

    if (orig) process.env.LLM_API_KEY = orig;
    if (origOpen) process.env.OPENAI_API_KEY = origOpen;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.reason).toBe("no_api_key");
    expect(body.text).not.toMatch(FALLBACK_BANNED_RE);
    expect(body.text).not.toMatch(/artifact|provenance|capability/i);
    expect(body.text).not.toContain("下一步工程化分支");
    expect(body.text).toContain("结论：建议推进");
    expect(body.text.length).toBeGreaterThan(20);
  });

  it("returns fallback with reason hijacked when LLM self-intro detected (S7)", async () => {
    vi.spyOn(llmClient, "callLLM").mockResolvedValue({
      content: "我是 ChatGPT，很高兴为你分析权限方案。",
      usage: undefined,
    } as any);

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-hijack",
        userText: "路线对比一下",
        state: { sessionId: "s1", goal: { text: "权限系统", status: "clear" } },
        selected: [{ capabilityId: "route.compare", roleId: "工程" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.reason).toBe("hijacked");
    expect(body.text).not.toMatch(FALLBACK_BANNED_RE);
  });

  it("returns idle-turn fallback when selected is empty (S6-6)", async () => {
    restoreLlmKey?.();
    restoreLlmKey = undefined;
    const orig = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-idle",
        userText: "再来一轮",
        state: { sessionId: "s1", goal: { text: "权限", status: "clear" } },
        selected: [],
        planReason: "BUDGET_EXCEEDED: turn cap",
        skipped: [{ capabilityId: "risk.analyze", reason: "blocked_by_budget" }],
      }),
    });

    if (orig) process.env.LLM_API_KEY = orig;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.text).toMatch(/没有安排/);
    expect(body.text).not.toMatch(FALLBACK_BANNED_RE);
    expect(body.text).not.toContain("已收敛");
    expect(body.text).not.toContain("证据链");
  });

  it("route.generate turn: fallback body exceeds header-only template (S6-4)", async () => {
    restoreLlmKey?.();
    restoreLlmKey = undefined;
    const orig = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;

    const mainContent = "【route.generate 模拟输出】\n" + "Z".repeat(200);
    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-route",
        userText: "路线对比一下",
        state: { sessionId: "s1", goal: { text: "权限", status: "needs_refinement" } },
        selected: [{ capabilityId: "route.generate", roleId: "架构" }],
        mainArtifact: { kind: "route_options", title: "路线", content: mainContent },
        goalStatusBefore: "needs_refinement",
      }),
    });

    if (orig) process.env.LLM_API_KEY = orig;

    const body = await res.json();
    expect(body.text).not.toMatch(FALLBACK_BANNED_RE);
    expect(body.text.length).toBeGreaterThan(80);
    expect(body.text).toContain("route");
  });

  it("returns llm narration when callLLM succeeds", async () => {
    vi.spyOn(llmClient, "callLLM").mockResolvedValue({
      content: "这是面向用户的推演说明，结尾你想先澄清哪条边界？",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    } as any);

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-llm",
        userText: "出报告",
        state: { sessionId: "s1", goal: { text: "权限", status: "clear" } },
        artifacts: [{ kind: "report", title: "报告", summary: "摘要" }],
        mainArtifact: { kind: "report", title: "报告", content: "结论：可推进。" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("llm");
    expect(body.text).toContain("推演说明");
  });
});