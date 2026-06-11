import { describe, it, expect } from "vitest";
import { ALL_V5_CAPABILITIES } from "../contracts.js";
import {
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_DEFAULT_ROLES,
  assertFullCapabilityCatalogCoverage,
} from "../whybuddy-capability-catalog.js";
import { V5_ROLE_IDS } from "../whybuddy-role-map.js";

describe("whybuddy-capability-catalog (R1-B8)", () => {
  it("covers every capability in ALL_V5_CAPABILITIES", () => {
    assertFullCapabilityCatalogCoverage();
    expect(Object.keys(CAPABILITY_DESCRIPTIONS).length).toBe(ALL_V5_CAPABILITIES.length);
    expect(Object.keys(CAPABILITY_DEFAULT_ROLES).length).toBe(ALL_V5_CAPABILITIES.length);
  });

  it("default roles are valid V5 role ids", () => {
    for (const id of ALL_V5_CAPABILITIES) {
      expect(V5_ROLE_IDS).toContain(CAPABILITY_DEFAULT_ROLES[id]);
    }
  });

  it("descriptions are concise one-liners", () => {
    for (const id of ALL_V5_CAPABILITIES) {
      const desc = CAPABILITY_DESCRIPTIONS[id];
      expect(desc.length).toBeGreaterThan(0);
      expect(desc.length).toBeLessThanOrEqual(30);
    }
  });
});