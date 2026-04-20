import { describe, expect, it } from "vitest";

import {
  DEBUG_AUDIT_PATH,
  DEBUG_CONFIG_PATH,
  DEBUG_HELP_PATH,
  DEBUG_LINEAGE_PATH,
  DEBUG_PERMISSIONS_PATH,
  DEBUG_PATH,
  LEGACY_LINEAGE_PATH,
  LEGACY_COMMAND_CENTER_LEGACY_PATH,
  LEGACY_COMMAND_CENTER_PATH,
  MAIN_PATH_ITEMS,
  MORE_NAV_ITEMS,
  OFFICE_PATH,
  PRIMARY_NAV_ITEMS,
  REPLAY_PATH_PREFIX,
  getCompatibilityRedirect,
  getDebugPath,
  getPrimaryNavigationId,
  getReplayPath,
  isLowFrequencyPath,
  resolveDebugTab,
} from "../navigation-config";

describe("navigation convergence config", () => {
  it("keeps the primary navigation focused on office and more", () => {
    expect(PRIMARY_NAV_ITEMS.map(item => item.id)).toEqual(["office", "more"]);
  });

  it("keeps tasks available as a secondary main path", () => {
    expect(MAIN_PATH_ITEMS.map(item => item.id)).toEqual(["office", "tasks"]);
  });

  it("maps routes into the converged primary paths", () => {
    expect(getPrimaryNavigationId("/")).toBe("office");
    expect(getPrimaryNavigationId("/tasks")).toBe("office");
    expect(getPrimaryNavigationId("/tasks/task-42")).toBe("office");
    expect(getPrimaryNavigationId(getReplayPath("mission-42"))).toBe("office");
    expect(getPrimaryNavigationId("/lineage")).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_CONFIG_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_PERMISSIONS_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_AUDIT_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_HELP_PATH)).toBe("more");
    expect(getPrimaryNavigationId("/debug/lineage")).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_PATH)).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(
      "more"
    );
  });

  it("collects low-frequency destinations in the More drawer", () => {
    expect(MORE_NAV_ITEMS.map(item => item.id)).toEqual([
      "config",
      "permissions",
      "audit",
      "help",
    ]);
    expect(MORE_NAV_ITEMS.find(item => item.id === "config")?.href).toBe(
      DEBUG_CONFIG_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "permissions")?.href).toBe(
      DEBUG_PERMISSIONS_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "audit")?.href).toBe(
      DEBUG_AUDIT_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "help")?.href).toBe(
      DEBUG_HELP_PATH
    );
  });

  it("maps debug tabs to stable debug subpaths", () => {
    expect(getDebugPath("overview")).toBe(DEBUG_PATH);
    expect(getDebugPath("config")).toBe(DEBUG_CONFIG_PATH);
    expect(getDebugPath("permissions")).toBe(DEBUG_PERMISSIONS_PATH);
    expect(getDebugPath("audit")).toBe(DEBUG_AUDIT_PATH);
    expect(getDebugPath("lineage")).toBe(DEBUG_LINEAGE_PATH);
    expect(getDebugPath("help")).toBe(DEBUG_HELP_PATH);
  });

  it("resolves debug subpaths back to the expected debug tab", () => {
    expect(resolveDebugTab(DEBUG_PATH)).toBe("overview");
    expect(resolveDebugTab(DEBUG_CONFIG_PATH)).toBe("config");
    expect(resolveDebugTab(DEBUG_PERMISSIONS_PATH)).toBe("permissions");
    expect(resolveDebugTab(DEBUG_AUDIT_PATH)).toBe("audit");
    expect(resolveDebugTab(DEBUG_LINEAGE_PATH)).toBe("lineage");
    expect(resolveDebugTab(DEBUG_HELP_PATH)).toBe("help");
    expect(resolveDebugTab(`${DEBUG_PATH}/unknown-panel`)).toBe("overview");
    expect(resolveDebugTab(`${DEBUG_HELP_PATH}?from=drawer`)).toBe("help");
    expect(resolveDebugTab("/debugg/help")).toBe("overview");
  });

  it("keeps legacy low-frequency deep links on the compatibility redirect map", () => {
    expect(getCompatibilityRedirect(LEGACY_COMMAND_CENTER_PATH)).toBe(
      OFFICE_PATH
    );
    expect(getCompatibilityRedirect(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(
      OFFICE_PATH
    );
    expect(getCompatibilityRedirect(LEGACY_LINEAGE_PATH)).toBe(
      DEBUG_LINEAGE_PATH
    );
    expect(getCompatibilityRedirect(`${LEGACY_LINEAGE_PATH}?view=full`)).toBe(
      DEBUG_LINEAGE_PATH
    );
    expect(getCompatibilityRedirect("/lineage-old")).toBeNull();
    expect(getCompatibilityRedirect("/command-center-old")).toBeNull();
    expect(getCompatibilityRedirect(DEBUG_HELP_PATH)).toBeNull();
  });

  it("builds replay deep links from a shared route helper", () => {
    expect(REPLAY_PATH_PREFIX).toBe("/replay");
    expect(getReplayPath("mission-42")).toBe("/replay/mission-42");
    expect(getReplayPath("mission/with/slash")).toBe(
      "/replay/mission/with/slash"
    );
  });

  it("treats debug, lineage, and legacy command center routes as low-frequency paths", () => {
    expect(isLowFrequencyPath(DEBUG_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_CONFIG_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_PERMISSIONS_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_AUDIT_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_HELP_PATH)).toBe(true);
    expect(isLowFrequencyPath(`${DEBUG_HELP_PATH}?from=drawer`)).toBe(true);
    expect(isLowFrequencyPath("/lineage")).toBe(true);
    expect(isLowFrequencyPath("/debug/lineage")).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_PATH)).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(true);
    expect(isLowFrequencyPath("/debugg")).toBe(false);
    expect(isLowFrequencyPath("/lineage-old")).toBe(false);
    expect(isLowFrequencyPath("/command-center-old")).toBe(false);
    expect(isLowFrequencyPath("/tasks")).toBe(false);
  });
});
