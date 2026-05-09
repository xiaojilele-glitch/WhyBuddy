/**
 * Unit tests for deriveAigcOutputSummary / buildStructuredPayloadSummary / sha256Hex
 * (autopilot-capability-bridge-aigc-node, task 10).
 *
 * Validates:
 *   - requirements.md 3.5 / 4.3 / 4.5 / 4.6
 *   - design.md §4.7
 *   - tasks.md 10.1–10.4
 */

import { describe, expect, it } from "vitest";

import { createDefaultAigcSpecNodeCapabilityPolicy } from "./policy.js";
import {
  buildStructuredPayloadSummary,
  deriveAigcOutputSummary,
  sha256Hex,
} from "./summary-derivation.js";

describe("deriveAigcOutputSummary (tasks 10.1–10.3)", () => {
  describe("pluralization (tasks 10.1 / 10.2)", () => {
    it("renders 'Identified 1 subsystem; 0 risks flagged.' for N=1, K=0 (en-US)", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [] },
        { locale: "en-US" },
      );
      expect(result).toBe("Identified 1 subsystem; 0 risks flagged.");
    });

    it("renders 'Identified 3 subsystems; 1 risk flagged.' for N=3, K=1 (en-US)", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A", "B", "C"], riskNotes: ["r"] },
        { locale: "en-US" },
      );
      expect(result).toBe("Identified 3 subsystems; 1 risk flagged.");
    });

    it("renders Chinese base sentence for zh-CN", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A", "B"], riskNotes: ["r1"] },
        { locale: "zh-CN" },
      );
      expect(result).toBe("识别 2 个关键子系统；标注 1 条风险。");
    });
  });

  describe("dataFlowSketch suffix (task 10.3)", () => {
    it("appends full sketch verbatim when under 120 chars (en-US)", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [], dataFlowSketch: "short sketch" },
        { locale: "en-US" },
      );
      expect(result.endsWith(" Data flow: short sketch")).toBe(true);
    });

    it("appends full sketch verbatim when under 120 chars (zh-CN)", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [], dataFlowSketch: "short sketch" },
        { locale: "zh-CN" },
      );
      expect(result.endsWith(" 数据流摘要：short sketch")).toBe(true);
    });

    it("truncates to 117 chars + '...' when sketch > 120 chars (en-US)", () => {
      const longSketch = "x".repeat(200);
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [], dataFlowSketch: longSketch },
        { locale: "en-US" },
      );
      expect(result).toContain(" Data flow: ");
      const tail = result.slice(
        result.indexOf(" Data flow: ") + " Data flow: ".length,
      );
      expect(tail).toBe(`${"x".repeat(117)}...`);
    });

    it("truncates to 117 chars + '...' when sketch > 120 chars (zh-CN)", () => {
      const longSketch = "x".repeat(200);
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [], dataFlowSketch: longSketch },
        { locale: "zh-CN" },
      );
      const marker = " 数据流摘要：";
      expect(result).toContain(marker);
      const tail = result.slice(result.indexOf(marker) + marker.length);
      expect(tail).toBe(`${"x".repeat(117)}...`);
    });

    it("omits data-flow suffix entirely when dataFlowSketch is undefined", () => {
      const result = deriveAigcOutputSummary(
        { subsystems: ["A"], riskNotes: [] },
        { locale: "en-US" },
      );
      expect(result).not.toContain("Data flow");
    });
  });
});

describe("buildStructuredPayloadSummary (task 10.4)", () => {
  const policy = createDefaultAigcSpecNodeCapabilityPolicy();

  it("includes subsystem count, risk count, and confidence when present", () => {
    const summary = buildStructuredPayloadSummary(
      {
        subsystems: ["A", "B", "C"],
        riskNotes: ["r1", "r2"],
        confidence: 0.78,
      },
      policy,
    );
    expect(summary).toContain("3 subsystems");
    expect(summary).toContain("2 risks");
    expect(summary).toContain("0.78");
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(
      policy.maxStructuredPayloadSummaryBytes,
    );
  });

  it("omits confidence segment when confidence is undefined", () => {
    const summary = buildStructuredPayloadSummary(
      { subsystems: ["A"], riskNotes: [] },
      policy,
    );
    expect(summary).toContain("1 subsystem");
    expect(summary).toContain("0 risks");
    expect(summary).not.toContain("confidence=");
  });

  it("trims to maxStructuredPayloadSummaryBytes when summary would exceed it", () => {
    const tightPolicy = { ...policy, maxStructuredPayloadSummaryBytes: 8 };
    const summary = buildStructuredPayloadSummary(
      {
        subsystems: ["A", "B", "C"],
        riskNotes: ["r1", "r2"],
        confidence: 0.78,
      },
      tightPolicy,
    );
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(8);
  });
});

describe("sha256Hex (task 10.4)", () => {
  it("hashes 'hello' to the canonical SHA-256 hex digest", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("produces 64 lowercase hex chars for any input", () => {
    const digest = sha256Hex("abc");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
