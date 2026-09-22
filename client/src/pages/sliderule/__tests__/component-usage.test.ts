import { describe, expect, it } from "vitest";
import usageJson from "../generated/block-component-usage.json";
import { BASE_COMPONENTS } from "../base-components/base-catalog";
import {
  blocksUsing,
  generatedUsage,
  usageFor,
  usageStats,
} from "../component-usage";

const baseNames = new Set(BASE_COMPONENTS.map(component => component.name));

describe("real block-to-base-component usage", () => {
  it("keeps every generated dependency in the base component catalog", () => {
    for (const usage of Object.values(usageJson.blocks)) {
      for (const component of [...usage.desktop, ...usage.phone]) {
        expect(
          baseNames.has(component),
          `${component} is not present in the base component catalog`
        ).toBe(true);
      }
    }
  });

  it("keeps desktop and mobile component identities isolated", () => {
    for (const usage of Object.values(usageJson.blocks)) {
      expect(
        usage.desktop.every(component => !component.startsWith("M."))
      ).toBe(true);
      expect(
        usage.phone.every(
          component => component === "ECharts" || component.startsWith("M.")
        )
      ).toBe(true);
    }
    expect(
      usageFor(BASE_COMPONENTS.find(c => c.name === "Button")!).phoneBlocks
    ).toEqual([]);
    expect(
      usageFor(BASE_COMPONENTS.find(c => c.name === "M.Button")!).desktopBlocks
    ).toEqual([]);
  });

  it("traces renderers imported from desktop and phone batch modules", () => {
    const generated = generatedUsage();
    expect(generated.version).toBe(2);
    expect(generated.blocks.OnboardingChecklistWizard.desktop).toContain(
      "Steps"
    );
    expect(generated.blocks.OnboardingChecklistWizard.phone).toContain(
      "M.Steps"
    );
    expect(generated.blocks.ResourceBookingCalendar.desktop).toContain(
      "Calendar"
    );
    expect(generated.blocks.ResourceBookingCalendar.phone).toContain(
      "M.CalendarPicker"
    );
  });

  it("keeps every renderer in the graph without inventing a minimum dependency count", () => {
    const generated = generatedUsage();
    for (const usage of Object.values(generated.blocks)) {
      expect(Array.isArray(usage.desktop)).toBe(true);
      expect(Array.isArray(usage.phone)).toBe(true);
    }
    for (const type of generated.audit.phoneEnabledBlocks) {
      expect(generated.blocks[type], `${type} is missing from usage graph`).toBeDefined();
    }
  });

  it("builds statistics and reverse lookups from the same graph", () => {
    const stats = usageStats(BASE_COMPONENTS);
    const linked = BASE_COMPONENTS.filter(
      component => usageFor(component).allBlocks.length > 0
    );
    const unlinked = BASE_COMPONENTS.filter(
      component => usageFor(component).allBlocks.length === 0
    );
    expect(stats.total).toBe(BASE_COMPONENTS.length);
    expect(stats.desktop).toBeGreaterThan(0);
    expect(stats.phone).toBeGreaterThan(0);
    expect(stats.any + stats.unlinked).toBe(stats.total);
    expect(linked).toHaveLength(stats.any);
    expect(unlinked).toHaveLength(stats.unlinked);
    expect(new Set([...linked, ...unlinked]).size).toBe(stats.total);
    expect(blocksUsing("M.Button")).toContain("FilterBar");
  });
});
