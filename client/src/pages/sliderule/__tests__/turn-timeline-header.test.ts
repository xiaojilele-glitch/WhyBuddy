import { describe, expect, it } from "vitest";

import { turnTimelineHeader } from "../turn-timeline-header";

describe("turnTimelineHeader", () => {
  it("收口句是 N 步 · Ns，不写推演过程/阶段", () => {
    expect(
      turnTimelineHeader({ stepCount: 42, durationMs: 115000 })
    ).toBe("42 步 · 115s");
  });

  it("精修有沿用说明时不写步数", () => {
    const text = turnTimelineHeader({
      stepCount: 42,
      durationMs: 40000,
      refineReuseNote: "改了 异常条目（p3） · 沿用 3 页 · 规格、权限、流程沿用",
    });
    expect(text).toContain("改了 异常条目（p3）");
    expect(text).toContain("沿用 3 页");
    expect(text).not.toMatch(/\d+\s*步/);
    expect(text).not.toMatch(/\d+\s*阶段/);
    expect(text).toContain("40s");
    expect(text).not.toContain("推演过程");
  });
});
