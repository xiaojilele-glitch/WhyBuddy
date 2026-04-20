import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { OfficeCockpitTab } from "./office-task-cockpit-types";
import type { OfficeCockpitAvailability } from "./office-task-cockpit-utils";
import { resolveOfficeCockpitTab } from "./office-task-cockpit-utils";

const ALL_TABS: OfficeCockpitTab[] = [
  "launch",
  "task",
  "flow",
  "agent",
  "memory",
  "history",
];

function expectedFallback(availability: OfficeCockpitAvailability) {
  if (availability.task) return "task";
  if (availability.launch) return "launch";
  if (availability.flow) return "flow";
  if (availability.agent) return "agent";
  if (availability.memory) return "memory";
  if (availability.history) return "history";
  return "task";
}

describe("office-task-cockpit-utils (property)", () => {
  it("always returns an available tab and preserves the documented fallback order", () => {
    const availabilityArb = fc.record({
      launch: fc.boolean(),
      task: fc.boolean(),
      flow: fc.boolean(),
      agent: fc.boolean(),
      memory: fc.boolean(),
      history: fc.boolean(),
    });

    const tabArb = fc.constantFrom<OfficeCockpitTab>(...ALL_TABS);

    fc.assert(
      fc.property(tabArb, availabilityArb, (currentTab, availability) => {
        const resolved = resolveOfficeCockpitTab(currentTab, availability);
        const anyAvailable = Object.values(availability).some(Boolean);

        if (resolved === currentTab && availability[resolved]) {
          expect(availability[resolved]).toBe(true);
          return;
        }

        expect(resolved).toBe(expectedFallback(availability));
        if (anyAvailable) {
          expect(availability[resolved]).toBe(true);
        } else {
          // When nothing is available we still return a stable default.
          expect(resolved).toBe("task");
        }
      }),
      { numRuns: 200 }
    );
  });
});
