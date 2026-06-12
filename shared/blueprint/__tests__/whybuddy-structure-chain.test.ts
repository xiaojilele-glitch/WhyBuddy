import { describe, it, expect } from "vitest";
import {
  buildStructurePrompt,
  redactStructurePrompt,
  structurePromptChainComplete,
  parseStructureGateLedger,
  structureGateLedgerConversationLines,
  validateSpecTreeInvariants,
  collectStructureUpstreamSummary,
} from "../whybuddy-structure-chain.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

describe("whybuddy-structure-chain (S13)", () => {
  it("C_PROMPT→C_REDACT: prompt chain markers and redaction", () => {
    const prompt = buildStructurePrompt({
      goalText: "拆解权限系统",
      upstreamSummary: "- [evidence] 片段",
      turnId: "t-prompt",
    });
    const poisoned = `${prompt}\nsecret: sk-abcdefghijklmnopqrstuvwxyz123456`;
    const { redacted, redactionCount } = redactStructurePrompt(poisoned);
    expect(structurePromptChainComplete(prompt, redacted)).toBe(true);
    expect(redactionCount).toBeGreaterThan(0);
    expect(redacted).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(redacted).toContain("[REDACTED_KEY]");
  });

  it("parseStructureGateLedger → T_LEDGER conversation lines (edges 88–89)", () => {
    const entries = [
      "C_PROMPT:built",
      "C_REDACT:applied:1",
      "G_SCHEMA:attempt1:failed",
      "G_SCHEMA:attempt2:passed",
      "G_INV:attempt2:passed",
    ];
    const checks = parseStructureGateLedger(entries, { turnId: "t-ledger", runId: "t-ledger-run-0" });
    expect(checks.filter((c) => c.gateId === "G_SCHEMA")).toHaveLength(2);
    expect(checks.find((c) => c.gateId === "G_INV")?.status).toBe("passed");
    const lines = structureGateLedgerConversationLines(checks);
    expect(lines.some((l) => /\[T_LEDGER\] G_SCHEMA/.test(l))).toBe(true);
    expect(lines.some((l) => /\[T_LEDGER\] G_INV/.test(l))).toBe(true);
    expect(lines.every((l) => /phase=structure/.test(l))).toBe(true);
  });

  it("collectStructureUpstreamSummary honors inputArtifactIds and excludes stale", () => {
    const state = {
      sessionId: "st-up",
      goal: { text: "拆解", status: "needs_refinement" },
      artifacts: [
        {
          id: "wanted",
          kind: "evidence",
          title: "Wanted",
          summary: "keep",
          trustLevel: "gated_pass",
          provenance: "ai_generated",
        },
        {
          id: "noise",
          kind: "risk",
          title: "Noise",
          summary: "drop",
          trustLevel: "gated_pass",
          provenance: "ai_generated",
        },
        {
          id: "stale-one",
          kind: "report",
          title: "Stale",
          summary: "stale",
          trustLevel: "gated_pass",
          provenance: "ai_generated",
        },
      ],
      staleArtifactIds: ["stale-one"],
    } as V5SessionState;

    const scoped = collectStructureUpstreamSummary(state, ["wanted"]);
    expect(scoped).toContain("Wanted");
    expect(scoped).not.toContain("Noise");
    expect(scoped).not.toContain("Stale");
  });

  it("validateSpecTreeInvariants rejects double root", () => {
    const inv = validateSpecTreeInvariants([
      { id: "a", type: "root", title: "A", summary: "a", evidenceRef: "g" },
      { id: "b", type: "root", title: "B", summary: "b", evidenceRef: "g" },
    ]);
    expect(inv.passed).toBe(false);
  });
});