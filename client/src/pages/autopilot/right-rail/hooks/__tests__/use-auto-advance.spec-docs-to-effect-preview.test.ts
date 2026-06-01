/**
 * Regression contract tests for
 * `whybuddy-rebrand-and-stage3-unblock-2026-05-28` Task A.
 *
 * The bug being prevented: stage 2 (spec_docs) finishes but the cockpit never
 * advances to stage 3 (effect_preview). Three guards introduced by Task A:
 *
 *   §A.1  default spec-docs `types` is a single document (`["requirements"]`).
 *   §A.2  on stage backtracking, `advancedStagesRef` drops post-stage entries.
 *   §A.3  initial-delay window is 800ms (down from 3000ms) and is bypassed
 *         entirely when the hook re-attaches with `job.stage` already past
 *         `clarification`.
 *
 * These tests read `use-auto-advance.ts` as text and assert the relevant
 * branches still exist. We follow the same static-source-regex approach as
 * the sibling `use-auto-advance.test.ts` so the suite stays fast and
 * deterministic, no React renderer needed.
 */
import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(
    path.resolve(__dirname, "../use-auto-advance.ts"),
    "utf8"
  );
}

describe("use-auto-advance · stage 3 unblock contract", () => {
  it("§A.1 — force-advance from spec_tree generates the requirements doc only by default", async () => {
    const source = await readSource();
    // The new client-side default is a single doc type. We tolerate either
    // a single-element array literal or any array containing only
    // "requirements" (no "design" or "tasks" baked in by default).
    const forceAdvanceMatch = source.match(
      /if\s*\(\s*stage\s*===\s*"spec_tree"\s*\)\s*\{[\s\S]*?actions\.generateSpecDocuments\(jobId,\s*\{([\s\S]*?)\}\s*\)/
    );
    expect(forceAdvanceMatch, "spec_tree force-advance branch missing").not.toBeNull();
    const optsBlock = forceAdvanceMatch![1];
    expect(optsBlock).toMatch(/types\s*:\s*\[\s*"requirements"\s*\]/);
    expect(optsBlock).not.toMatch(/"design"/);
    expect(optsBlock).not.toMatch(/"tasks"/);
  });

  it("§A.2 — advanced-stage ref is reset on stage backtracking", async () => {
    const source = await readSource();
    expect(source).toMatch(/lastJobStageRef/);
    // The reset effect must hold a stage-order array containing both
    // spec_docs and effect_preview so it can compare indices.
    expect(source).toMatch(/"spec_docs"[\s\S]{0,80}"effect_preview"/);
    expect(source).toMatch(/advancedStagesRef\.current\s*=\s*next/);
  });

  it("§A.3 — initial-delay is 800ms and is bypassed when stage is already past clarification", async () => {
    const source = await readSource();
    expect(source).toMatch(/setTimeout\([\s\S]*?800\s*\)/);
    expect(source).not.toMatch(/setTimeout\([\s\S]*?3000\s*\)/);
    // The bypass condition keys on the stage being neither "input" nor
    // "clarification" at mount time.
    expect(source).toMatch(/initialStage\s*!==\s*"input"/);
    expect(source).toMatch(/initialStage\s*!==\s*"clarification"/);
    expect(source).toMatch(/skipDelay/);
  });

  it("§ baseline — spec_docs + completed branch still calls generateEffectPreview", async () => {
    const source = await readSource();
    // The branch that fires when stage 2 finishes; we only care that this
    // exact contract survives the §A.2 / §A.3 refactors.
    expect(source).toMatch(
      /stage\s*===\s*"spec_docs"\s*&&\s*\n?\s*status\s*===\s*"completed"[\s\S]*?advance\(\s*"effect_preview"/
    );
    expect(source).toMatch(
      /actions\.generateEffectPreview\(jobId,\s*\{\s*includeDrafts:\s*true,?\s*\}/
    );
  });
});
