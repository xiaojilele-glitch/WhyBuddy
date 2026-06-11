import { describe, it, expect } from "vitest";
import {
  buildFallbackNarration,
  buildIdleTurnFallbackNarration,
  FALLBACK_BANNED_RE,
} from "../whybuddy-deliverable-sanitize.js";

describe("buildFallbackNarration (S6)", () => {
  it("does not emit banned outward-reference or mechanical-count phrases", () => {
    const text = buildFallbackNarration({
      userText: "分析风险",
      goalStatus: "clear",
      goalStatusBefore: "needs_refinement",
      selectedCount: 2,
      mainArtifactContent: "结论：建议推进。\n下一步工程化分支：\n- secret branch",
    });
    expect(text).not.toMatch(FALLBACK_BANNED_RE);
    expect(text).not.toContain("下一步工程化分支");
    expect(text).toContain("结论：建议推进");
  });

  it("omits goal status line when status unchanged", () => {
    const text = buildFallbackNarration({
      userText: "继续",
      goalStatus: "clear",
      goalStatusBefore: "clear",
      selectedCount: 1,
      mainArtifactContent: "路线 A 更适合当前团队规模。",
    });
    expect(text).not.toContain("当前结论状态");
  });

  it("includes goal status line only when status changed", () => {
    const text = buildFallbackNarration({
      userText: "收敛",
      goalStatus: "clear",
      goalStatusBefore: "needs_refinement",
      selectedCount: 1,
      mainArtifactContent: "综合报告正文。",
    });
    expect(text).toContain("当前结论状态");
  });

  it("route.generate / intent.clarify turns: body longer than header-only template", () => {
    for (const kind of ["route_options", "clarification"] as const) {
      const body = "X".repeat(120);
      const text = buildFallbackNarration({
        userText: kind === "route_options" ? "路线对比一下" : "目标再澄清",
        goalStatus: "needs_refinement",
        goalStatusBefore: "needs_refinement",
        selectedCount: 1,
        mainArtifactContent: `【${kind} 模拟输出】\n${body}`,
      });
      const headOnly = buildFallbackNarration({
        userText: "x",
        goalStatus: "needs_refinement",
        goalStatusBefore: "needs_refinement",
        selectedCount: 1,
        mainArtifactContent: null,
      });
      expect(text.length).toBeGreaterThan(headOnly.length);
    }
  });

  it("idle turn admits no new analysis and avoids banned phrases (S6-6)", () => {
    const text = buildIdleTurnFallbackNarration({
      userText: "再来一轮",
      goalStatus: "clear",
      selectedCount: 0,
      planReason: "BUDGET_EXCEEDED: turn cap",
      skipped: [{ capabilityId: "risk.analyze", reason: "blocked_by_budget" }],
    });
    expect(text).toMatch(/没有安排/);
    expect(text).not.toMatch(FALLBACK_BANNED_RE);
    expect(text).not.toContain("已收敛");
    expect(text).not.toContain("证据链");
    expect(text).toContain("预算已达上限");
  });
});