import { describe, expect, it } from "vitest";

import { pageFreeformOwnsContent } from "../app-runtime-schema";

describe("marketing landing rendering ownership", () => {
  it("lets a marketing landing design own the page even when its data view kind is workbench", () => {
    expect(
      pageFreeformOwnsContent({
        presentation: "marketing-landing",
        view: { kind: "workbench" },
        freeformOverview: { root: { tag: "div" } },
      })
    ).toBe(true);
  });

  it("keeps a normal workbench on the business data renderer", () => {
    expect(
      pageFreeformOwnsContent({
        presentation: "application",
        view: { kind: "workbench" },
        freeformOverview: { root: { tag: "div" } },
      })
    ).toBe(false);
  });
});
