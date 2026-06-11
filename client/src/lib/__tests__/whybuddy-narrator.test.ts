import { describe, it, expect } from "vitest";
import { FALLBACK_BANNED_RE } from "@shared/blueprint/whybuddy-deliverable-sanitize";
import { buildFallbackNarration } from "@shared/blueprint/whybuddy-deliverable-sanitize";

/** Mirrors client localNarrationFallback (truncate-only, no sanitize). */
function buildClientLocalFallback(req: {
  userText: string;
  goalStatus?: string;
  goalStatusBefore?: string;
  selectedCount: number;
  mainArtifactContent?: string | null;
  planReason?: string | null;
  skipped?: Array<{ capabilityId?: string; reason: string }>;
}): string {
  return buildFallbackNarration({
    userText: req.userText,
    goalStatus: req.goalStatus as any,
    goalStatusBefore: req.goalStatusBefore as any,
    selectedCount: req.selectedCount,
    mainArtifactContent: req.mainArtifactContent,
    planReason: req.planReason,
    skipped: req.skipped,
    sanitizeMainArtifact: false,
    mainArtifactMaxLen: 400,
  });
}

describe("whybuddy-narrator local fallback (S6)", () => {
  it("does not emit banned phrases and truncates mainArtifact to 400 chars", () => {
    const longBody = "结论段落。" + "Y".repeat(500);
    const text = buildClientLocalFallback({
      userText: "出报告",
      goalStatus: "needs_refinement",
      goalStatusBefore: "needs_refinement",
      selectedCount: 1,
      mainArtifactContent: longBody,
    });
    expect(text).not.toMatch(FALLBACK_BANNED_RE);
    expect(text).toContain("结论段落。");
    expect(text.length).toBeLessThan(longBody.length);
  });

  it("idle turn admits no new analysis (S6-6)", () => {
    const text = buildClientLocalFallback({
      userText: "继续分析",
      goalStatus: "clear",
      selectedCount: 0,
      planReason: "CONTRACT_SUFFICIENT: covered",
      skipped: [{ capabilityId: "report.write", reason: "stopped_by_contract_sufficiency" }],
    });
    expect(text).toMatch(/没有安排/);
    expect(text).not.toMatch(FALLBACK_BANNED_RE);
    expect(text).not.toContain("已收敛");
  });
});