/**
 * D1 acceptance — dialogue capability LLM branches on /execute-capability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";

import slideruleRouter from "../sliderule.js";
import * as blueprintRoutes from "../blueprint.js";
import * as llmClient from "../../core/llm-client.js";
import { withStubbedLlmKey } from "./helpers/with-stubbed-llm-key.js";
import { buildDialogueUserPrompt } from "../../sliderule/dialogue-exec-map.js";
import { resetSlideRuleCapabilityPoolCache } from "../../sliderule/pool-json-llm.js";
import { DOMAIN_ANCHORING_RULE } from "../../../shared/blueprint/sliderule-narration-immunity.js";

const GOAL = "做一个权限管理系统（支持 RBAC + 数据范围）";

function healthyArtifact(
  id: string,
  kind: string,
  content: string,
  title?: string
) {
  return {
    id,
    kind,
    title: title || id,
    summary: content.slice(0, 80),
    content,
    trustLevel: "gated_pass" as const,
    provenance: "ai_generated" as const,
    producedBy: { capabilityRunId: `run-${id}`, capabilityId: "intent.clarify", roleId: "产品" },
    passedGates: ["commit"],
  };
}

function baseState(extra: Record<string, unknown> = {}) {
  return {
    sessionId: "d1-test",
    goal: { text: GOAL, status: "needs_refinement" },
    artifacts: [],
    staleArtifactIds: [],
    conversation: [],
    ...extra,
  };
}

describe("D1 dialogue execute-capability", () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/sliderule", slideruleRouter);

  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // 本文件 mock 的是 Node 侧 llm-client / blueprint 生成器，测的是 Node 兼容路径。
    // 默认后端是 python，会把 execute-capability 委托给 Python，mock 完全不生效，
    // Python 再去打真网关 → 502。显式选 legacy 才能测到这些 mock 想覆盖的分支。
    vi.stubEnv("SLIDERULE_V5_BACKEND", "legacy");
    vi.stubEnv("SLIDERULE_CAPABILITY_POOL_ENABLED", "0");
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS", "");
    resetSlideRuleCapabilityPoolCache();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    vi.spyOn(blueprintRoutes, "generateClarificationQuestionsWithLlm").mockRejectedValue(
      new Error("test: skip v4 clarify generator")
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/sliderule`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreLlmKey?.();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  const dialogueCaps = [
    "intent.clarify",
    "route.generate",
    "route.compare",
    "requirement.write",
  ] as const;

  it("D1-A1: four branches send domain anchor + capability-specific upstream filter", async () => {
    const state = baseState({
      artifacts: [
        healthyArtifact("cl1", "clarification", "用户希望按部门隔离数据范围"),
        healthyArtifact("risk1", "risk", "存在越权与审计缺口"),
        healthyArtifact("ev1", "evidence", "行业案例显示 RBAC 常见"),
        healthyArtifact("route1", "route_options", "路线一:策略表\n路线二:视图方案"),
        healthyArtifact("syn1", "synthesis", "综合判断倾向策略表"),
        healthyArtifact("dec1", "decision", "先收敛 MVP 范围"),
      ],
      conversation: [
        { id: "c1", role: "user", text: "运维人力怎么估?" },
        { id: "c2", role: "user", text: "先按两人月估算" },
      ],
    });

    for (const capabilityId of dialogueCaps) {
      const spy = vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
        json: {
          title: `${capabilityId} 标题`,
          summary: "摘要",
          content: "围绕权限管理目标的具体推演正文,无自我介绍。",
        },
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });

      const inputArtifactIds =
        capabilityId === "route.compare" ? ["route1"] : [];

      const res = await fetch(`${base}/execute-capability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilityId,
          state,
          inputArtifactIds,
          roleId: "产品",
          turnId: `d1-${capabilityId}`,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provenance).toBe("llm");

      const call = spy.mock.calls[0];
      const system = String(call?.[0]?.[0]?.content || "");
      const user = String(call?.[0]?.[1]?.content || "");
      expect(system).toContain("你是 SlideRule 的推演引擎");
      expect(user).toContain(DOMAIN_ANCHORING_RULE);

      if (capabilityId === "intent.clarify") {
        expect(user).toContain("clarification");
        expect(user).toContain("decision");
        expect(user).toContain("运维人力怎么估");
        expect(user).not.toContain('"kind":"route_options"');
      }
      if (capabilityId === "route.generate") {
        expect(user).toContain("clarification");
        expect(user).toContain("risk");
        expect(user).toContain("evidence");
        expect(user).toContain("任务:生成实现路线");
      }
      if (capabilityId === "route.compare") {
        expect(user).toContain("route_options");
        expect(user).toContain("任务:路线对比裁决");
        const routeIdx = user.indexOf("route1");
        const riskIdx = user.indexOf("risk1");
        expect(routeIdx).toBeGreaterThanOrEqual(0);
        if (riskIdx >= 0) expect(routeIdx).toBeLessThan(riskIdx);
      }
      if (capabilityId === "requirement.write") {
        expect(user).toContain("route_options");
        expect(user).toContain("synthesis");
        expect(user).toContain("任务:需求文档草案");
      }

      spy.mockRestore();
    }
  });

  it("D1-A1 unit: buildDialogueUserPrompt filters only healthy non-stale artifacts", () => {
    const state = baseState({
      artifacts: [
        healthyArtifact("ok", "clarification", "健康澄清"),
        { ...healthyArtifact("stale", "risk", "过期风险"), trustLevel: "gated_pass" },
      ],
      staleArtifactIds: ["stale"],
    });
    const prompt = buildDialogueUserPrompt({
      capabilityId: "route.generate",
      state: state as any,
      turnId: "t1",
      roleId: "架构",
    });
    expect(prompt).toContain("ok");
    expect(prompt).not.toContain("过期风险");
  });

  it("D1-A2: hijacked LLM content throws llm_execution_failed (client falls back to pilot)", async () => {
    vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
      json: {
        title: "澄清",
        summary: "摘要",
        content: "你好，我是 OuYi 助手，接下来为您分析权限方案。",
      },
      usage: undefined,
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await fetch(`${base}/execute-capability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: "intent.clarify",
        state: baseState(),
        inputArtifactIds: [],
        roleId: "产品",
        turnId: "d1-hijack",
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("llm_execution_failed");

    errSpy.mockRestore();
  });

  it("D1-A4 plumbing: route.compare prompt references route_options upstream", async () => {
    const routes = healthyArtifact(
      "routes-main",
      "route_options",
      "路线一:策略表\n**思路**:集中管理\n路线二:视图\n**思路**:快速上线"
    );
    const prompt = buildDialogueUserPrompt({
      capabilityId: "route.compare",
      state: baseState({ artifacts: [routes] }) as any,
      inputArtifactIds: ["routes-main"],
      roleId: "工程",
      turnId: "d1-chain",
    });
    expect(prompt).toContain("路线一");
    expect(prompt).toContain("任务:路线对比裁决");
    expect(prompt).not.toContain("任务:生成实现路线");
  });
});