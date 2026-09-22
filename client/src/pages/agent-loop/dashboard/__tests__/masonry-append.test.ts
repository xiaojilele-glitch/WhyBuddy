/**
 * 下一页追加不许整墙重拍。
 *
 * 判据必须能被变异咬住：把 isKeyPrefixAppend 改成「长度变了就算追加」、
 * 或把 nextLayoutEpoch 改成「长度变了就 +1」，这两条都会红。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  appendStableItems,
  appendUniqueById,
  isKeyPrefixAppend,
  nextLayoutEpoch,
} from "../masonry-append";
import { appendStableSpanKeys, computeSpanKeys } from "../app-wall-span";
import type { GalleryItem } from "../AppsWorkbench";

function appItem(key: string, pageCount: number): GalleryItem {
  return {
    key,
    source: "app",
    goal: key,
    appId: key,
    summary: {
      id: key,
      root_id: key,
      parent_id: null,
      version: 1,
      session_id: null,
      goal: key,
      gate_passed: true,
      created_at: "2026-07-31T00:00:00Z",
      product_name: key,
      theme_id: "t",
      theme_label: "T",
      device: "desktop",
      landing_page_ref: "p",
      entity_count: 3,
      page_count: pageCount,
    },
  } as GalleryItem;
}

describe("isKeyPrefixAppend", () => {
  it("旧列表是新列表的前缀才算追加", () => {
    expect(isKeyPrefixAppend(["a", "b"], ["a", "b", "c"])).toBe(true);
    expect(isKeyPrefixAppend(["a", "b"], ["a", "b"])).toBe(true);
    expect(isKeyPrefixAppend(["a", "b"], ["a", "x", "b"])).toBe(false);
    expect(isKeyPrefixAppend(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(isKeyPrefixAppend([], ["a"])).toBe(false);
  });
});

describe("nextLayoutEpoch", () => {
  it("追加不换代，换序/缩短才换代", () => {
    expect(nextLayoutEpoch(["a"], ["a", "b"], 0)).toBe(0);
    expect(nextLayoutEpoch(["a", "b"], ["b", "a"], 0)).toBe(1);
    expect(nextLayoutEpoch(["a", "b"], ["a"], 3)).toBe(4);
    expect(nextLayoutEpoch([], ["a", "b"], 2)).toBe(2);
  });
});

describe("appendStableSpanKeys", () => {
  it("追加后第一页已经拿两列的卡必须还在", () => {
    // take 从 1 变成 2 时，全量重算会把「全表最完整的一张」收成「前半段最完整」——
    // 第一页那张宽卡换人，整墙重拍。冻结决策就是为了咬住这一下。
    const page1 = [
      appItem("p1-a", 2),
      appItem("p1-b", 2),
      appItem("p1-c", 2),
      appItem("p1-d", 2),
      appItem("p1-e", 2),
      appItem("p1-f", 2),
      appItem("p1-wide", 9),
    ];
    const first = computeSpanKeys(page1);
    expect([...first]).toEqual(["p1-wide"]);

    const page2 = [...page1, appItem("p2-steal", 10)];
    const naive = computeSpanKeys(page2);
    expect(naive.has("p1-wide"), "全量重算会丢掉第一页的宽卡——这就是重拍").toBe(false);

    const stable = appendStableSpanKeys(first, page1.map(i => i.key), page2);
    expect(stable.has("p1-wide")).toBe(true);
  });

  it("换了一面墙（不是前缀）仍走全量重算", () => {
    const a = [appItem("a1", 9), appItem("a2", 1), appItem("a3", 1), appItem("a4", 1)];
    const b = [appItem("b1", 1), appItem("b2", 9), appItem("b3", 1), appItem("b4", 1)];
    const prev = computeSpanKeys(a);
    const next = appendStableSpanKeys(prev, a.map(i => i.key), b);
    expect([...next]).toEqual([...computeSpanKeys(b)]);
    expect(next.has("a1")).toBe(false);
  });
});

describe("appendStableItems", () => {
  it("新卡按时间插进第一页时，已经露出的 key 必须还在原位", () => {
    const page1 = [
      { key: "app-new" },
      { key: "session-hot" },
      { key: "app-old" },
    ];
    // 第二页这张应用比 session-hot 新，全表重排会把它插到下标 1。
    const page2 = [
      { key: "app-new" },
      { key: "app-steal" },
      { key: "session-hot" },
      { key: "app-old" },
    ];
    const naive = page2.map(i => i.key);
    expect(naive[1]).toBe("app-steal");

    const stable = appendStableItems(
      page1.map(i => i.key),
      page2,
      i => i.key,
    );
    expect(stable.map(i => i.key)).toEqual([
      "app-new",
      "session-hot",
      "app-old",
      "app-steal",
    ]);
    expect(stable[1]!.key).not.toBe("app-steal");
  });

  it("换排序（同一批卡）仍听新序", () => {
    const prev = ["a", "b", "c"];
    const next = [{ key: "c" }, { key: "b" }, { key: "a" }];
    expect(appendStableItems(prev, next, i => i.key).map(i => i.key)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});

describe("appendUniqueById", () => {
  it("页间重叠一行时并进去是 35，concat 才是 48", () => {
    const page1 = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}` }));
    const page2 = Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 12}` }));
    // 第三页第一条是第二页最后一条——OFFSET 无决胜时的典型重叠。
    const page3 = [{ id: "a23" }, ...Array.from({ length: 11 }, (_, i) => ({ id: `a${i + 24}` }))];
    const page4 = Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 35}` }));

    let apps = appendUniqueById([], page1, a => a.id);
    apps = appendUniqueById(apps, page2, a => a.id);
    expect(apps).toHaveLength(24);
    apps = appendUniqueById(apps, page3, a => a.id);
    expect(apps).toHaveLength(35);
    expect(apps.filter(a => a.id === "a23")).toHaveLength(1);
    const naive = [...page1, ...page2, ...page3, ...page4];
    expect(naive).toHaveLength(48);
    apps = appendUniqueById(apps, page4, a => a.id);
    expect(apps.length).toBeLessThan(naive.length);
    expect(new Set(apps.map(a => a.id)).size).toBe(apps.length);
  });

  it("空 prev 就是第一页原样", () => {
    const page = [{ id: "x" }, { id: "y" }];
    expect(appendUniqueById(null, page, a => a.id)).toEqual(page);
    expect(appendUniqueById(undefined, page, a => a.id)).toEqual(page);
  });
});

describe("追加纪律接在真链路上", () => {
  it("追加只冻结序，不退回全表重算", () => {
    // ⚠ 2026-08-23 落点改过：应用中心那面墙换成两端对齐行（JustifiedWall）之后
    //   **不再有跨列**——宽度由宽高比决定，`appendStableSpanKeys` 这条随之退场
    //   （它仍服务组件库那面墙）。冻结「序」的那两条纪律没变，仍钉在这里。
    const wall = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
    const masonry = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(wall).toContain("appendStableItems");
    expect(wall).toContain("appendUniqueById");
    expect(wall).not.toContain("appendStableSpanKeys");
    // SpanMasonry 仍服务组件库那两面墙（区块高度真的要量），纪律照旧。
    expect(masonry).toContain("nextLayoutEpoch");
    expect(masonry).toContain("copyPlacements");
    expect(masonry).not.toMatch(/return `\$\{items\.length\}:/);
  });

  it("无限流只向服务端要下一页，不许 shown+=12 再自动连打", () => {
    const wallRaw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
    const masonryRaw = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(wallRaw).toContain("const wallItems = visible;");
    expect(wallRaw).toContain("void loadMoreApps();");
    expect(wallRaw).not.toContain("shouldFetchAppPage");
    expect(wallRaw).not.toContain("setShown");
    expect(wallRaw).not.toMatch(/\[\.\.\.\(prev \?\? \[\]\), \.\.\.list\]/);
    expect(wallRaw).not.toMatch(/visible\.slice\(\s*0\s*,\s*shown\s*\)/);
    // 哨兵观察者不许跟 itemCount 绑在一起——项数一变就重建 IO，立刻再喊一页。
    expect(masonryRaw).not.toMatch(/\[onReachEnd, width, itemCount, askMore/);
  });
});
