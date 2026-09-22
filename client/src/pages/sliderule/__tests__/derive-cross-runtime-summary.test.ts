import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveCrossRuntimeGraphSummary } from "../derive-cross-runtime-summary";
import type { CrossRuntimeGraph } from "@/lib/skills/orchestrator";
import {
  deriveReportExportClosureSummaryFromPublishArtifact,
  derivePublishClosureSummary,
  deriveReportExportClosureSummary,
  deriveRollbackClosureDiffSummary,
  formatClosureStatusAndTopBlockersForFinalReport,
  normalizeBlockerForRender,
  renderPublishClosureBlocker,
  selectPublishClosureSummary,
  selectRollbackClosureDiffSummary,
} from "../derive-cross-runtime-summary";

describe("deriveCrossRuntimeGraphSummary", () => {
  it("summarizes allowed and blocked runtime graph edges for the page", () => {
    const graph: CrossRuntimeGraph = {
      edges: [
        {
          sourceSkill: "datamodel",
          targetSkill: "rbac",
          state: "allowed",
          evidenceKey: "DM_EVIDENCE:leave_request:rbac",
          raw: "datamodel->rbac:allowed",
        },
        {
          sourceSkill: "rbac",
          targetSkill: "page",
          state: "blocked",
          evidenceKey: "RBAC_EVIDENCE:policy:page",
          raw: "rbac->page:blocked",
        },
      ],
      bySkill: {},
      evidenceBySkill: {
        datamodel: ["DM_EVIDENCE:leave_request:rbac"],
        rbac: ["RBAC_EVIDENCE:policy:page"],
      },
    };

    expect(deriveCrossRuntimeGraphSummary(graph, { exampleLimit: 1 })).toEqual({
      edgeCount: 2,
      allowedCount: 1,
      blockedCount: 1,
      skillCount: 3,
      evidenceCount: 2,
      examples: [
        {
          sourceSkill: "datamodel",
          targetSkill: "rbac",
          state: "allowed",
          evidenceKey: "DM_EVIDENCE:leave_request:rbac",
        },
      ],
    });
  });

  it("returns null for empty graph input", () => {
    expect(deriveCrossRuntimeGraphSummary(null)).toBeNull();
    expect(
      deriveCrossRuntimeGraphSummary({ edges: [], bySkill: {}, evidenceBySkill: {} })
    ).toBeNull();
  });

  it("summarizes AppBundle publish runtime closure for the page", () => {
    expect(
      derivePublishClosureSummary({
        blocked: false,
        blockers: [],
        perSkillEvidence: {
          datamodel: { evidencePresent: true },
          rbac: { evidencePresent: true },
          workflow: { evidencePresent: true },
          page: { evidencePresent: true },
          aigc: { evidencePresent: true },
          appbundle: { evidencePresent: true },
        } as any,
        runtimeClosure: {
          skillsChecked: ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
          versionPinsChecked: true,
          perSkill: {} as any,
        },
      })
    ).toEqual({
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      closureId: undefined,
      closureHash: undefined,
      generatedAt: undefined,
      stableDigest: undefined,
      tierCounts: {
        hard_blocker: 0,
        warning: 0,
        info: 0,
      },
      topBlockers: [],
      perSkillEvidence: {
        datamodel: { evidencePresent: true },
        rbac: { evidencePresent: true },
        workflow: { evidencePresent: true },
        page: { evidencePresent: true },
        aigc: { evidencePresent: true },
        appbundle: { evidencePresent: true },
      },
    });
  });

  it("passes refinePaintNote through for the chat bubble", () => {
    const summary = derivePublishClosureSummary({
      blocked: false,
      blockers: [],
      perSkillEvidence: { page: { evidencePresent: true } } as any,
      runtimeClosure: {
        skillsChecked: ["page"],
        versionPinsChecked: true,
        perSkill: {} as any,
      },
      refinePaintNote: "这一处没画上：结构闸说臆造字段",
    });
    expect(summary?.refinePaintNote).toBe("这一处没画上：结构闸说臆造字段");
  });

  it("passes refineReuseNote through for the left-rail header", () => {
    const summary = derivePublishClosureSummary({
      blocked: false,
      blockers: [],
      perSkillEvidence: { page: { evidencePresent: true } } as any,
      runtimeClosure: {
        skillsChecked: ["page"],
        versionPinsChecked: true,
        perSkill: {} as any,
      },
      refineReuseNote: "改了 异常条目（p3） · 沿用 3 页 · 规格、权限、流程沿用",
    });
    expect(summary?.refineReuseNote).toBe(
      "改了 异常条目（p3） · 沿用 3 页 · 规格、权限、流程沿用"
    );
  });

  it("surfaces AppBundle closure digest and tier counts for the page", () => {
    expect(
      derivePublishClosureSummary(
        {
          blocked: true,
          blockers: [
            {
              code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
              severity: "error",
              path: "page",
              message: "Missing Page runtime evidence for task view consistency.",
              affectedSkill: "page",
              ref: "page_purchase_request",
            },
          ],
          perSkillEvidence: {
            page: { evidencePresent: false },
            appbundle: { evidencePresent: true },
          } as any,
          runtimeClosure: {
            skillsChecked: ["page", "appbundle"],
            versionPinsChecked: false,
            perSkill: {} as any,
          },
          closureId: "appbundle:app_test@1.0.0:runtime-closure",
          closureHash: "feedface",
          generatedAt: "2026-07-03T00:00:00.000Z",
          stableDigest: "deadbeef",
          findingsByTier: {
            hard_blocker: [
              {
                code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                severity: "error",
                path: "page",
                message: "Missing Page runtime evidence for task view consistency.",
              },
            ],
            warning: [
              {
                code: "APPBUNDLE_RUNTIME_AIGC_OPTIONAL",
                severity: "warning",
                path: "aigc",
                message: "AIGC runtime evidence is optional for this app.",
              },
            ],
            info: [
              {
                code: "APPBUNDLE_RUNTIME_EVIDENCE_PRESENT",
                severity: "warning",
                path: "appbundle",
                message: "Runtime evidence present for appbundle.",
              },
            ],
          },
        },
        { blockerLimit: 1 }
      )
    ).toEqual({
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 1,
      skillCount: 2,
      versionPinsChecked: false,
      closureId: "appbundle:app_test@1.0.0:runtime-closure",
      closureHash: "feedface",
      generatedAt: "2026-07-03T00:00:00.000Z",
      stableDigest: "deadbeef",
      tierCounts: {
        hard_blocker: 1,
        warning: 1,
        info: 1,
      },
      topBlockers: [
        {
          code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
          path: "page",
          affectedSkill: "page",
          ref: "page_purchase_request",
        },
      ],
      perSkillEvidence: {
        page: { evidencePresent: false },
        appbundle: { evidencePresent: true },
      },
    });
  });

  it("normalizes and renders publish closure blockers for report markdown", () => {
    const normalized = normalizeBlockerForRender({
      code: "APPBUNDLE_PUBLISH_REF_MISSING",
      path: "menuEntries[0].roleRefs[2]",
      affectedSkill: "rbac",
      ref: "role:finance-admin",
    });

    expect(normalized).toEqual({
      code: "APPBUNDLE_PUBLISH_REF_MISSING",
      path: "menuEntries[0].roleRefs[2]",
      affectedSkill: "rbac",
      ref: "role:finance-admin",
    });
    expect(renderPublishClosureBlocker(normalized)).toBe(
      "APPBUNDLE_PUBLISH_REF_MISSING skill=rbac path=menuEntries[0].roleRefs[2] ref=role:finance-admin"
    );
    expect(renderPublishClosureBlocker(null)).toBe("UNKNOWN_BLOCKER");
  });

  it("positive: prefers Python publish closure over local preview closure when Python evidence present", () => {
    const preview = {
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 2,
      skillCount: 6,
      versionPinsChecked: false,
      closureHash: "preview",
      tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
      topBlockers: [{ code: "PREVIEW_BLOCKED", path: "preview" }],
    };
    const python = {
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      closureHash: "python",
      tierCounts: { hard_blocker: 0, warning: 1, info: 0 },
      topBlockers: [],
    };

    // explicit positive: when both exist, python (from /drive-full) is chosen
    const selected = selectPublishClosureSummary(python, preview);
    expect(selected?.closureHash).toBe("python");
    expect(selected?.versionPinsChecked).toBe(true);
    expect(selected?.blocked).toBe(false);
  });

  it("negative: falls back to TS preview only when Python closure absent (null/undefined)", () => {
    const preview = {
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 4,
      skillCount: 6,
      versionPinsChecked: true,
      closureHash: "preview-only",
      tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
      topBlockers: [],
    };

    expect(selectPublishClosureSummary(null, preview)?.closureHash).toBe("preview-only");
    expect(selectPublishClosureSummary(undefined, preview)?.closureHash).toBe("preview-only");
    // also when preview is null too
    expect(selectPublishClosureSummary(null, null)).toBeNull();
  });

  it("negative/fail-closed: null when no Python and no preview available", () => {
    expect(selectPublishClosureSummary(null, null)).toBeNull();
    expect(selectPublishClosureSummary(undefined, undefined)).toBeNull();
    expect(selectPublishClosureSummary(null, undefined)).toBeNull();
  });
});

describe("formatClosureStatusAndTopBlockersForFinalReport", () => {
  it("formats closed status with no top blockers (positive evidence)", () => {
    const summary = derivePublishClosureSummary({
      blocked: false,
      blockers: [],
      perSkillEvidence: {
        datamodel: { evidencePresent: true },
        rbac: { evidencePresent: true },
        workflow: { evidencePresent: true },
        page: { evidencePresent: true },
        aigc: { evidencePresent: true },
        appbundle: { evidencePresent: true },
      } as any,
      runtimeClosure: {
        skillsChecked: ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
        versionPinsChecked: true,
        perSkill: {} as any,
      },
      closureHash: "abc123",
    });
    const text = formatClosureStatusAndTopBlockersForFinalReport(summary);
    expect(text).toContain("closure status: closed");
    expect(text).toContain("top blockers: none");
    expect(text).toContain("evidence: 6/6");
    expect(text).toContain("pinsChecked: true");
    expect(text).toContain("closureHash: abc123");
  });

  it("formats blocked status with top blockers (fail-closed negative behavior)", () => {
    const summary = derivePublishClosureSummary(
      {
        blocked: true,
        blockers: [
          {
            code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
            severity: "error",
            path: "page",
            message: "Missing evidence.",
            affectedSkill: "page",
          },
          { code: "OTHER_BLOCKER", severity: "error", path: "rbac" },
        ],
        perSkillEvidence: { page: { evidencePresent: false } } as any,
        runtimeClosure: {
          skillsChecked: ["page", "rbac"],
          versionPinsChecked: false,
          perSkill: {} as any,
        },
        stableDigest: "def456",
      },
      { blockerLimit: 2 }
    );
    const text = formatClosureStatusAndTopBlockersForFinalReport(summary);
    expect(text).toContain("closure status: blocked");
    expect(text).toContain("top blockers: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED@page; OTHER_BLOCKER@rbac");
    expect(text).toContain("evidence: 0/2");
    expect(text).toContain("pinsChecked: false");
    expect(text).toContain("closureHash: n/a");
  });

  it("returns unknown status text for null/undefined (negative path)", () => {
    expect(formatClosureStatusAndTopBlockersForFinalReport(null)).toBe("closure status: unknown\ntop blockers: n/a");
    expect(formatClosureStatusAndTopBlockersForFinalReport(undefined)).toBe("closure status: unknown\ntop blockers: n/a");
  });
});

describe("deriveRollbackClosureDiffSummary", () => {
  it("summarizes matching rollback closure artifacts for compact UI display", () => {
    const summary = deriveRollbackClosureDiffSummary({
      appId: "leave-request",
      currentVersion: "1.0.0",
      targetVersion: "1.0.0",
      currentStableDigest: "digest-a",
      targetStableDigest: "digest-a",
      digestMatch: true,
      changedPerSkillRefs: [],
      evidencePresentCountCurrent: 6,
      evidencePresentCountTarget: 6,
    });

    expect(summary).toEqual({
      digestMatch: true,
      changedRefCount: 0,
      evidencePresentCountCurrent: 6,
      evidencePresentCountTarget: 6,
      degraded: false,
      currentVersion: "1.0.0",
      targetVersion: "1.0.0",
      currentStableDigest: "digest-a",
      targetStableDigest: "digest-a",
    });
  });

  it("fails closed when rollback closure diff is missing a digest match decision", () => {
    const summary = deriveRollbackClosureDiffSummary({
      appId: "leave-request",
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
      changedPerSkillRefs: ["datamodel", "page"],
      evidencePresentCountCurrent: 4,
      evidencePresentCountTarget: 6,
    } as any);

    expect(summary).toMatchObject({
      digestMatch: false,
      changedRefCount: 2,
      evidencePresentCountCurrent: 4,
      evidencePresentCountTarget: 6,
      degraded: true,
    });
    expect(deriveRollbackClosureDiffSummary(null)).toBeNull();
  });

  it("selects primary rollback closure diff summary before fallback", () => {
    const primary = { digestMatch: true, changedRefCount: 0, degraded: false };
    const fallback = { digestMatch: false, changedRefCount: 1, degraded: true };

    expect(selectRollbackClosureDiffSummary(primary, fallback)).toBe(primary);
    expect(selectRollbackClosureDiffSummary(null, fallback)).toBe(fallback);
    expect(selectRollbackClosureDiffSummary(undefined, undefined)).toBeNull();
  });
});

describe("deriveReportExportClosureSummary", () => {
  it("marks publish artifact closure as closed only with digest and full evidence", () => {
    const summary = deriveReportExportClosureSummary({
      blocked: false,
      stableDigest: "digest-closed",
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      blockerCount: 0,
      tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
      topBlockers: [],
      perSkillEvidence: {
        datamodel: { evidencePresent: true },
        rbac: { evidencePresent: true },
        workflow: { evidencePresent: true },
        page: { evidencePresent: true },
        aigc: { evidencePresent: true },
        appbundle: { evidencePresent: true },
      },
    });

    expect(summary).toEqual({
      source: "publish-artifact-closure",
      status: "closed",
      digest: "digest-closed",
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      blockerCount: 0,
    });
  });

  it("fails closed when digest or six-skill evidence is incomplete", () => {
    expect(
      deriveReportExportClosureSummary({
        blocked: false,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        blockerCount: 0,
        tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
        topBlockers: [],
      }).status
    ).toBe("blocked");

    expect(
      deriveReportExportClosureSummary({
        blocked: false,
        stableDigest: "digest-incomplete",
        evidencePresentCount: 5,
        skillCount: 6,
        versionPinsChecked: true,
        blockerCount: 0,
        tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
        topBlockers: [],
      }).status
    ).toBe("blocked");
  });

  it("returns degraded summary for absent or invalid closure input", () => {
    expect(deriveReportExportClosureSummary(null)).toEqual({
      source: "publish-artifact-closure",
      status: "degraded",
      digest: null,
      evidencePresentCount: 0,
      skillCount: 0,
      versionPinsChecked: false,
      blockerCount: 0,
    });
  });

  it("derives report/export summary from real AppBundle publish artifact fixtures", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixtureDir = resolve(here, "../../../../../slide-rule-python/tests/fixtures");
    const closed = JSON.parse(readFileSync(resolve(fixtureDir, "closed_appbundle_publish_artifact.json"), "utf8"));
    const blocked = JSON.parse(readFileSync(resolve(fixtureDir, "blocked_appbundle_publish_artifact.json"), "utf8"));

    expect(deriveReportExportClosureSummaryFromPublishArtifact(closed)).toEqual({
      source: "publish-artifact-closure",
      status: "closed",
      digest: "deadbeef120",
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      blockerCount: 0,
    });

    expect(deriveReportExportClosureSummaryFromPublishArtifact(blocked)).toMatchObject({
      source: "publish-artifact-closure",
      status: "blocked",
      digest: "badc0ded120",
      evidencePresentCount: 1,
      skillCount: 2,
      versionPinsChecked: true,
      blockerCount: 1,
    });
  });
});
