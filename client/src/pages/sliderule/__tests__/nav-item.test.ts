import { describe, expect, it } from "vitest";

import { navItemId, navItemName } from "../nav-item";

describe("navItemId / navItemName", () => {
  it("Python 壳用 id/name，前端夹具用 pageId/label，两套都认", () => {
    expect(navItemId({ id: "p1", name: "拾取工作台" })).toBe("p1");
    expect(navItemName({ id: "p1", name: "拾取工作台" })).toBe("拾取工作台");
    expect(navItemId({ pageId: "p1", label: "拾取工作台" })).toBe("p1");
    expect(navItemName({ pageId: "p1", label: "拾取工作台" })).toBe("拾取工作台");
  });

  it("空值不编造", () => {
    expect(navItemId(null)).toBe("");
    expect(navItemId({})).toBe("");
    expect(navItemName(undefined)).toBe("");
  });
});
