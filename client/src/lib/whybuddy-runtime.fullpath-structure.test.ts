/**
 * WhyBuddy V5.1 Full-Path — S13/S14 structure chain + T_LEDGER (edges 61–62, 88–89).
 */

import { describe, it, expect } from "vitest";
import {
  commitArtifact,
  createInitialSessionState,
  pickNextCapabilities,
} from "./whybuddy-runtime";
import { createRawArtifact } from "./whybuddy-fullpath-fixtures";

const GATE_LEDGER = [
  "C_PROMPT:built",
  "C_REDACT:applied:0",
  "G_SCHEMA:attempt1:non_json",
  "G_SCHEMA:attempt2:non_json",
  "C_SFALL:template",
  "G_INV:attempt2:passed",
];

describe("S13/S14 · structure chain + T_LEDGER", () => {
  it("pick includes structure.decompose for tree intent", () => {
    const picks = pickNextCapabilities(
      createInitialSessionState("拆解成 SPEC Tree", "S13-pick"),
      "拆解成 SPEC Tree"
    );
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(true);
  });

  it("commitArtifact writes G_SCHEMA/G_INV to structureGateLedger + conversation T_LEDGER", () => {
    const state = createInitialSessionState("拆解权限树", "S13-ledger");
    const runId = "S13-ledger-run-0";
    const gateNote = GATE_LEDGER.join(" · ");
    const { updatedState } = commitArtifact(
      state,
      {
        ...createRawArtifact("S13-tree", "structure.decompose", "架构", "spec_tree", gateNote + "\n【SPEC Tree · template】\n[root] x"),
        payload: { gateLedger: GATE_LEDGER, schemaPassed: false, invariantPassed: true },
      },
      runId,
      false,
      []
    );

    expect((updatedState.structureGateLedger || []).length).toBeGreaterThanOrEqual(4);
    const schemaRows = (updatedState.structureGateLedger || []).filter((r) => r.gateId === "G_SCHEMA");
    const invRows = (updatedState.structureGateLedger || []).filter((r) => r.gateId === "G_INV");
    expect(schemaRows.length).toBeGreaterThan(0);
    expect(invRows.some((r) => r.status === "passed")).toBe(true);
    expect(
      (updatedState.conversation || []).some((c) =>
        /\[T_LEDGER\] G_SCHEMA phase=structure/.test(c.text || "")
      )
    ).toBe(true);
    expect(
      (updatedState.conversation || []).some((c) =>
        /\[T_LEDGER\] G_INV phase=structure/.test(c.text || "")
      )
    ).toBe(true);
  });

  it("payload gateLedger includes C_PROMPT and C_REDACT markers (edges 61–62)", () => {
    expect(GATE_LEDGER).toContain("C_PROMPT:built");
    expect(GATE_LEDGER.some((e) => e.startsWith("C_REDACT:applied"))).toBe(true);
  });
});