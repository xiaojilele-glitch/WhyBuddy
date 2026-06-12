import { describe, it, expect } from "vitest";
import { ALL_V5_CAPABILITIES } from "../contracts.js";
import {
  buildActionTrace,
  buildProcessLabelContext,
  CAPABILITY_PROCESS_LABELS,
  getLiveAction,
  inferProcessContextFromExec,
} from "../capability-process-labels.js";

describe("CAPABILITY_PROCESS_LABELS (B1)", () => {
  it("covers every capability in ALL_V5_CAPABILITIES", () => {
    for (const id of ALL_V5_CAPABILITIES) {
      expect(CAPABILITY_PROCESS_LABELS[id], `missing label for ${id}`).toBeDefined();
      expect(CAPABILITY_PROCESS_LABELS[id].liveLabel).toBeTruthy();
    }
    expect(Object.keys(CAPABILITY_PROCESS_LABELS).length).toBe(ALL_V5_CAPABILITIES.length);
  });

  it("evidence.search tool trace distinguishes no-github-clue vs fetch-failed", () => {
    const base = buildProcessLabelContext("evidence.search", "做一个系统", "做一个系统");
    const noClue = inferProcessContextFromExec("evidence.search", base, {
      title: "外部证据检索（规则推演）",
      summary: "【来源: 会话内综合】未找到可检索的公开仓库线索，使用会话内材料。",
      content: "未发起外部网络检索。",
      provenance: "ai_generated",
    });
    const noClueTrace = buildActionTrace("evidence.search", true, noClue, {
      provenance: "ai_generated",
    });
    expect(noClueTrace?.ok).toBe(false);
    expect(noClueTrace?.label).toContain("未找到 GitHub");

    const failed = inferProcessContextFromExec("evidence.search", base, {
      title: "外部证据检索失败",
      summary: "【来源: 会话内综合】GitHub 证据收集不可用，已降级为会话内综合。",
      content: "尝试从 https://github.com/org/private 收集证据时失败。",
      provenance: "ai_generated",
    });
    const failedTrace = buildActionTrace("evidence.search", true, failed, {
      provenance: "ai_generated",
    });
    expect(failedTrace?.label).toContain("检索失败");
  });

  it("action live labels include concrete targets, not generic external-tool phrasing", () => {
    const repo = getLiveAction("repo.inspect", { repoSlug: "facebook/react" });
    expect(repo.label).toContain("facebook/react");
    expect(repo.label).not.toMatch(/调用了外部工具/);

    const mcp = getLiveAction("mcp.call", { toolName: "github-search" });
    expect(mcp.label).toContain("github-search");
    expect(mcp.label).not.toMatch(/调用了外部工具/);
  });
});