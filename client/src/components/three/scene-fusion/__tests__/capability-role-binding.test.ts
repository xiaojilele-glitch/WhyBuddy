/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — capability→role binding tests
 *
 * Pure Vitest coverage for `capability-role-binding.ts`. No Three.js, no React,
 * no DOM: every assertion targets the deterministic binding helper and the
 * display-meta / status helpers.
 *
 * Coverage (Requirement 12):
 * - loader-id binding (`role-container-loader:<roleId>`)
 * - capability-type heuristic binding
 * - single-active-role fallback (and its EXACTLY-one guard)
 * - unowned capabilities are omitted (audit-only)
 * - per-role chip ordering by confidence then capabilityId
 * - display meta (human names, not machine ids) + icon keys
 * - chip status collapse
 * - determinism / order-independence
 */

import { describe, expect, it } from "vitest";

import type { CapabilityStatus, RolePhase } from "@/lib/blueprint-realtime-store";

import {
  capabilityDisplayMeta,
  deriveCapabilityRoleBindings,
  parseRoleContainerLoaderRoleId,
  toChipStatus,
  MAX_ROLE_CAPABILITY_CHIPS,
  type RoleCapabilityChip,
} from "../capability-role-binding";

const LOCALE = "en-US" as const;

function chipsFor(
  map: Map<string, RoleCapabilityChip[]>,
  roleId: string
): RoleCapabilityChip[] {
  return map.get(roleId) ?? [];
}

// ---------------------------------------------------------------------------
// parseRoleContainerLoaderRoleId
// ---------------------------------------------------------------------------

describe("parseRoleContainerLoaderRoleId", () => {
  it("parses the owner roleId from a loader id", () => {
    expect(parseRoleContainerLoaderRoleId("role-container-loader:spec-architect")).toBe(
      "spec-architect"
    );
  });

  it("returns null for non-loader ids and empty suffixes", () => {
    expect(parseRoleContainerLoaderRoleId("aigc-spec-node")).toBeNull();
    expect(parseRoleContainerLoaderRoleId("role-container-loader:")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toChipStatus
// ---------------------------------------------------------------------------

describe("toChipStatus", () => {
  const cases: Array<[CapabilityStatus, string]> = [
    ["invoking", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["idle", "idle"],
  ];
  it.each(cases)("collapses %s to %s", (status, expected) => {
    expect(toChipStatus(status)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// capabilityDisplayMeta
// ---------------------------------------------------------------------------

describe("capabilityDisplayMeta", () => {
  it("returns human names + icon keys for well-known capabilities", () => {
    expect(capabilityDisplayMeta("aigc-spec-node", LOCALE)).toEqual({
      displayName: "Spec Node",
      iconKey: "spec-node",
    });
    expect(capabilityDisplayMeta("docker-analysis-sandbox", LOCALE)).toEqual({
      displayName: "Sandbox",
      iconKey: "sandbox",
    });
    expect(capabilityDisplayMeta("mcp-github-source", LOCALE)).toEqual({
      displayName: "GitHub Source",
      iconKey: "github",
    });
    expect(capabilityDisplayMeta("role-container-loader:spec-architect", LOCALE)).toEqual({
      displayName: "Role Container",
      iconKey: "container",
    });
  });

  it("humanizes unknown ids and uses the generic icon", () => {
    expect(capabilityDisplayMeta("some-unknown-thing", LOCALE)).toEqual({
      displayName: "Some Unknown Thing",
      iconKey: "capability",
    });
  });
});

// ---------------------------------------------------------------------------
// deriveCapabilityRoleBindings — loader-id
// ---------------------------------------------------------------------------

describe("deriveCapabilityRoleBindings loader-id", () => {
  it("binds role-container-loader:<roleId> directly to that role (authoritative)", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        "role-container-loader:spec-architect": "invoking",
      },
      rolePhases: { "spec-architect": "acting", "repository-analyst": "idle" },
      locale: LOCALE,
    });

    const chips = chipsFor(map, "spec-architect");
    expect(chips).toHaveLength(1);
    expect(chips[0].ownerSource).toBe("loader-id");
    expect(chips[0].inferred).toBe(false);
    expect(chips[0].status).toBe("running");
    // Not attributed to any other role.
    expect(map.has("repository-analyst")).toBe(false);
  });

  it("does NOT bind a loader id whose role is not on stage (stays unowned, NOT re-attributed)", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        "role-container-loader:ghost-role": "invoking",
      },
      rolePhases: { "spec-architect": "acting" },
      locale: LOCALE,
    });
    // ghost-role is off-stage. This id already names an authoritative role, so
    // it must stay UNOWNED rather than being re-attributed to the only active
    // role (spec-architect). The map should be empty.
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveCapabilityRoleBindings — event-role (authoritative owner)
// ---------------------------------------------------------------------------

describe("deriveCapabilityRoleBindings event-role owner", () => {
  it("binds a capability to its real event owner over the heuristic guess", () => {
    // aigc-spec-node would heuristically bind to spec-architect, but the real
    // event owner is role-runtime-executor. The real owner must win.
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "aigc-spec-node": "invoking" },
      capabilityOwners: {
        "aigc-spec-node": { roleId: "role-runtime-executor", updatedAt: 1 },
      },
      rolePhases: {
        "role-runtime-executor": "acting",
        "spec-architect": "observing",
      },
      locale: LOCALE,
    });

    const chips = chipsFor(map, "role-runtime-executor");
    expect(chips).toHaveLength(1);
    expect(chips[0].ownerSource).toBe("event-role");
    expect(chips[0].inferred).toBe(false);
    // The heuristic target must NOT receive it.
    expect(map.has("spec-architect")).toBe(false);
  });

  it("leaves a capability unowned when its real event owner is off-stage", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "aigc-spec-node": "invoking" },
      capabilityOwners: {
        "aigc-spec-node": { roleId: "off-stage-role", updatedAt: 1 },
      },
      rolePhases: { "spec-architect": "observing" },
      locale: LOCALE,
    });
    // Owner off-stage stays audit-only; do not infer a different scene role.
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveCapabilityRoleBindings — heuristic
// ---------------------------------------------------------------------------

describe("deriveCapabilityRoleBindings capability-type heuristic", () => {
  it("binds docker/github capabilities to repository-analyst (inferred)", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        "docker-analysis-sandbox": "completed",
        "mcp-github-source": "completed",
      },
      rolePhases: {
        "repository-analyst": "observing",
        "spec-architect": "observing",
      },
      locale: LOCALE,
    });

    const chips = chipsFor(map, "repository-analyst");
    expect(chips.map((c) => c.displayName).sort()).toEqual([
      "GitHub Source",
      "Sandbox",
    ]);
    expect(chips.every((c) => c.ownerSource === "capability-heuristic")).toBe(true);
    expect(chips.every((c) => c.inferred)).toBe(true);
    expect(map.has("spec-architect")).toBe(false);
  });

  it("binds aigc-spec-node to spec-architect", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "aigc-spec-node": "invoking" },
      rolePhases: { "spec-architect": "acting", "memory-curator": "idle" },
      locale: LOCALE,
    });
    expect(chipsFor(map, "spec-architect")[0].displayName).toBe("Spec Node");
    expect(chipsFor(map, "spec-architect")[0].ownerSource).toBe("capability-heuristic");
  });
});

// ---------------------------------------------------------------------------
// deriveCapabilityRoleBindings — single active role fallback
// ---------------------------------------------------------------------------

describe("deriveCapabilityRoleBindings single active-role fallback", () => {
  it("attaches an unbindable capability to the only active role (inferred)", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "mystery-capability": "invoking" },
      rolePhases: { "spec-architect": "acting", "memory-curator": "idle" },
      locale: LOCALE,
    });

    const chips = chipsFor(map, "spec-architect");
    expect(chips).toHaveLength(1);
    expect(chips[0].ownerSource).toBe("active-role");
    expect(chips[0].inferred).toBe(true);
    // The idle role never receives an inferred capability.
    expect(map.has("memory-curator")).toBe(false);
  });

  it("does NOT use the fallback when more than one role is active (audit-only)", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "mystery-capability": "invoking" },
      rolePhases: { "spec-architect": "acting", "memory-curator": "thinking" },
      locale: LOCALE,
    });
    // Two active roles → ambiguous → capability stays unowned (omitted).
    expect(map.size).toBe(0);
  });

  it("does NOT use the fallback when zero roles are active", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: { "mystery-capability": "invoking" },
      rolePhases: { "spec-architect": "idle", "memory-curator": "completed" },
      locale: LOCALE,
    });
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ordering + determinism
// ---------------------------------------------------------------------------

describe("deriveCapabilityRoleBindings ordering + determinism", () => {
  it("orders a role's chips by confidence (event-role > loader-id > heuristic) then id", () => {
    const map = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        // heuristic owner = spec-architect
        "aigc-spec-node": "completed",
        // loader-id owner = spec-architect (authoritative-by-id)
        "role-container-loader:spec-architect": "invoking",
        // event-role owner = spec-architect (most authoritative)
        "mcp-custom-tool": "invoking",
      },
      capabilityOwners: {
        "mcp-custom-tool": { roleId: "spec-architect", updatedAt: 1 },
      },
      rolePhases: { "spec-architect": "acting" },
      locale: LOCALE,
    });

    const chips = chipsFor(map, "spec-architect");
    expect(chips).toHaveLength(3);
    expect(chips[0].ownerSource).toBe("event-role");
    expect(chips[1].ownerSource).toBe("loader-id");
    expect(chips[2].ownerSource).toBe("capability-heuristic");
  });

  it("produces identical bindings regardless of capabilityStatuses key order", () => {
    const rolePhases: Record<string, RolePhase> = {
      "repository-analyst": "acting",
      "spec-architect": "observing",
    };
    const a = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        "aigc-spec-node": "completed",
        "docker-analysis-sandbox": "completed",
      },
      rolePhases,
      locale: LOCALE,
    });
    const b = deriveCapabilityRoleBindings({
      capabilityStatuses: {
        "docker-analysis-sandbox": "completed",
        "aigc-spec-node": "completed",
      },
      rolePhases,
      locale: LOCALE,
    });

    const norm = (m: Map<string, RoleCapabilityChip[]>) =>
      JSON.stringify(
        [...m.entries()].sort(([x], [y]) => x.localeCompare(y))
      );
    expect(norm(a)).toBe(norm(b));
  });

  it("keeps the constant usable for an overflow indicator", () => {
    // Sanity: the cap is a small positive integer the renderer slices on.
    expect(MAX_ROLE_CAPABILITY_CHIPS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_ROLE_CAPABILITY_CHIPS)).toBe(true);
  });
});
