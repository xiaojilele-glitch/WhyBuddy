/**
 * 画布连线与素材的判据。
 *
 * 每条都对着一次真机观察写，且都试过把实现改回去确认变红（本仓第二条纪律）。
 * 改这个文件之前先读 canvas-board-graph.ts 的头注——尤其是"为什么连线以手画
 * 为主"那一段，那是拿三个真机会话量出来的结论，不是设计偏好。
 */
import { describe, expect, it } from "vitest";

import {
  MANUAL_LINK_CAP,
  addManualLink,
  assetLabel,
  boardFacts,
  deriveDataflowLinks,
  entityLabel,
  extractPageAssets,
  isPlaceholderAsset,
  layoutAssets,
  linkToRefineInstruction,
  manualLinksStorageKey,
  readManualLinks,
  removeLink,
  writeManualLinks,
  assetUseGroups,
  decodeEntities,
  planAssetReplacement,
  replaceAssetUseInHtml,
  type BoardLink,
} from "../canvas-board-graph";
import type { FiveSystemModel } from "../../system-screens/five-system-model";

/** 真机 sr-20260822032723（社区团购团长后台）的 page/datamodel 切片。 */
const TUANGOU = {
  datamodel: {
    entities: [
      { id: "group_activity", name: "团购活动" },
      { id: "group_buying_order", name: "团购订单" },
      { id: "commission_flow", name: "佣金流水" },
    ],
  },
  page: {
    pages: [
      {
        id: "p1",
        name: "团长工作台",
        kind: "workbench",
        fieldBindings: [
          "group_activity.activity_title",
          "group_activity.activity_status",
        ],
        actionPermissions: ["group_activity:read"],
      },
      {
        id: "p2",
        name: "活动管理",
        kind: "workbench",
        fieldBindings: ["group_activity.price_info"],
        actionPermissions: [
          "group_activity:create",
          "group_activity:read",
          "group_activity:update",
        ],
      },
      {
        id: "p3",
        name: "订单核销页",
        kind: "workbench",
        fieldBindings: ["group_buying_order.pickup_code"],
        actionPermissions: [
          "group_buying_order:read",
          "group_buying_order:update",
        ],
      },
      {
        id: "p4",
        name: "佣金明细",
        kind: "workbench",
        fieldBindings: ["commission_flow.change_amount"],
        actionPermissions: ["commission_flow:read"],
      },
    ],
  },
} as unknown as FiveSystemModel;

const IDS = ["p1", "p2", "p3", "p4"];

describe("派生数据流边：写这个实体的页 → 读它的页", () => {
  it("真机团购那趟只应该派生出 p2 → p1 一条", () => {
    // ⚠ 这个"1"是真机量出来的，不是凑的。它同时也是**这个功能不能只靠派生**
    //   的证据（另两个会话是 0 条）——见 canvas-board-graph 头注。
    const links = deriveDataflowLinks(TUANGOU, IDS);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ from: "p2", to: "p1", kind: "dataflow" });
  });

  it("边上标的是实体的人话名，不是 id", () => {
    expect(deriveDataflowLinks(TUANGOU, IDS)[0]!.label).toBe("团购活动");
  });

  it("自环不画：p3 既写又读 group_buying_order，但那不是页面之间的关系", () => {
    const links = deriveDataflowLinks(TUANGOU, IDS);
    expect(links.some(l => l.from === l.to)).toBe(false);
    expect(links.some(l => l.from === "p3")).toBe(false);
  });

  it("只有人读、没人写的实体不产生边（commission_flow）", () => {
    expect(deriveDataflowLinks(TUANGOU, IDS).some(l => l.to === "p4")).toBe(
      false
    );
  });

  it("同一对页面因多个实体产生的边合成一条，标注顿号连起来", () => {
    const model = {
      datamodel: {
        entities: [
          { id: "a", name: "甲" },
          { id: "b", name: "乙" },
        ],
      },
      page: {
        pages: [
          { id: "p1", actionPermissions: ["a:update", "b:update"] },
          { id: "p2", actionPermissions: ["a:read", "b:read"] },
        ],
      },
    } as unknown as FiveSystemModel;
    const links = deriveDataflowLinks(model, ["p1", "p2"]);
    expect(links).toHaveLength(1);
    expect(links[0]!.label).toBe("甲、乙");
  });

  it("绑了字段就算读得到——不必再要一条 read 权限来证明", () => {
    const model = {
      datamodel: { entities: [{ id: "a", name: "甲" }] },
      page: {
        pages: [
          { id: "p1", actionPermissions: ["a:update"] },
          { id: "p2", fieldBindings: ["a.f1"] },
        ],
      },
    } as unknown as FiveSystemModel;
    expect(deriveDataflowLinks(model, ["p1", "p2"])).toHaveLength(1);
  });

  it("read 之外的动作都算写（approve/submit 也会改变对方看到的东西）", () => {
    const model = {
      page: {
        pages: [
          { id: "p1", actionPermissions: ["a:approve"] },
          { id: "p2", actionPermissions: ["a:read"] },
        ],
      },
    } as unknown as FiveSystemModel;
    expect(deriveDataflowLinks(model, ["p1", "p2"])[0]).toMatchObject({
      from: "p1",
      to: "p2",
    });
  });

  it("模型里有、当前页面清单里没有的页不进图", () => {
    expect(deriveDataflowLinks(TUANGOU, ["p1"])).toHaveLength(0);
  });

  it("没有模型时不炸、也不编", () => {
    expect(deriveDataflowLinks(null, IDS)).toEqual([]);
    expect(deriveDataflowLinks(undefined, [])).toEqual([]);
  });

  it("实体查不到名字就回 id（如实）", () => {
    expect(entityLabel(TUANGOU, "unknown_entity")).toBe("unknown_entity");
    expect(entityLabel(null, "x")).toBe("x");
  });
});

describe("手画连线的存取", () => {
  const key = manualLinksStorageKey("sr-abc");

  it("存档键带 sessionId——不带就会看到上一个应用的连线", () => {
    expect(key).toContain("sr-abc");
    expect(manualLinksStorageKey(null)).not.toBe(key);
  });

  it("加一条、去一条", () => {
    const one = addManualLink([], "p1", "p3");
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      from: "p1",
      to: "p3",
      kind: "manual",
      label: "跳转",
    });
    expect(removeLink(one, one[0]!.id)).toHaveLength(0);
  });

  it("自环与重复静静忽略（返回原数组，调用方不用判）", () => {
    const one = addManualLink([], "p1", "p3");
    expect(addManualLink(one, "p1", "p1")).toBe(one);
    expect(addManualLink(one, "p1", "p3")).toBe(one);
  });

  it("有上限——手画的东西不设上限就会有人画出一屏乱麻", () => {
    let links: BoardLink[] = [];
    for (let i = 0; i < MANUAL_LINK_CAP + 5; i++) {
      links = addManualLink(links, `a${i}`, `b${i}`);
    }
    expect(links).toHaveLength(MANUAL_LINK_CAP);
  });

  it("存下去再读回来是同一份", () => {
    const links = addManualLink(addManualLink([], "p1", "p3"), "p2", "p4");
    expect(readManualLinks(writeManualLinks(links), IDS)).toHaveLength(2);
  });

  it("**按当前页面清单过滤**：存档里指向已经不存在的页要丢掉", () => {
    // ⚠ 重新推演之后 pageId 会变。照单全收会让 React Flow 拿到指向空节点的边。
    const raw = JSON.stringify([
      { from: "p1", to: "p3" },
      { from: "p1", to: "ghost" },
      { from: "gone", to: "p2" },
    ]);
    const read = readManualLinks(raw, IDS);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ from: "p1", to: "p3" });
  });

  it("存档坏了当没有，不炸画布", () => {
    expect(readManualLinks("{不是 JSON", IDS)).toEqual([]);
    expect(readManualLinks("null", IDS)).toEqual([]);
    expect(readManualLinks('{"a":1}', IDS)).toEqual([]);
    expect(readManualLinks(null, IDS)).toEqual([]);
  });

  it("只存手画的，派生边不写进存档（下次模型变了会自己重算）", () => {
    const mixed = [
      ...deriveDataflowLinks(TUANGOU, IDS),
      ...addManualLink([], "p1", "p3"),
    ];
    expect(JSON.parse(writeManualLinks(mixed))).toHaveLength(1);
  });
});

describe("连线落回一句话（这条线不许只是装饰）", () => {
  const nameOf = (id: string) =>
    ({ p1: "团长工作台", p3: "订单核销页" })[id] ?? id;

  it("指令里必须出现两页的**人话名**", () => {
    // ⚠ 后端 refine_page_scope 是拿指令文本点名页面的。只写 pageId 它点不到，
    //   会退回全量重画——那正是那个模块存在要解决的问题。
    const text = linkToRefineInstruction(
      { from: "p1", to: "p3", label: "跳转" },
      nameOf
    );
    expect(text).toContain("团长工作台");
    expect(text).toContain("订单核销页");
    expect(text).not.toContain("p1");
    expect(text).not.toContain("p3");
  });

  it("指令要求其余页面别动（否则一句话会把整个应用重画一遍）", () => {
    const text = linkToRefineInstruction(
      { from: "p1", to: "p3", label: "跳转" },
      nameOf
    );
    // 盯语义不盯字面：还在要求"只改这一页"。
    expect(text).toMatch(/其余|其他|不要改|别改/);
  });
});

describe("素材图", () => {
  const pages = [
    {
      pageId: "p1",
      html: `<img src="https://placehold.co/40x40"><img src='https://placehold.co/120x120'><img class="x" src="/local/logo.png">`,
    },
    { pageId: "p2", html: `<img src="https://placehold.co/40x40">` },
    { pageId: "p3", html: `<div>没有图</div>` },
  ];

  it("按 URL 去重，记住哪几页在用", () => {
    const assets = extractPageAssets(pages);
    expect(assets.map(a => a.url)).toEqual([
      "https://placehold.co/40x40",
      "https://placehold.co/120x120",
      "/local/logo.png",
    ]);
    expect(assets[0]!.pageIds).toEqual(["p1", "p2"]);
  });

  it("用得多的排前面（一眼看见哪张图是全局的）", () => {
    expect(extractPageAssets(pages)[0]!.pageIds.length).toBe(2);
  });

  it("单双引号都认，src 在任意属性位置都认", () => {
    const a = extractPageAssets([
      {
        pageId: "p",
        html: `<img alt="a" data-x='1' src='q.png' loading="lazy">`,
      },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]!.url).toBe("q.png");
  });

  it("占位图判 host，不判整串", () => {
    expect(isPlaceholderAsset("https://placehold.co/40x40")).toBe(true);
    expect(isPlaceholderAsset("https://via.placeholder.com/80")).toBe(true);
    // ⚠ 真实图片的 URL 里带 placeholder 字样不算占位图。
    expect(
      isPlaceholderAsset("https://cdn.example.com/img/placeholder-hero.jpg")
    ).toBe(false);
    expect(isPlaceholderAsset("/local/logo.png")).toBe(false);
    expect(isPlaceholderAsset("")).toBe(false);
  });

  it("短名：有文件名用文件名，没有就 host + 尾段", () => {
    expect(assetLabel("https://cdn.x.com/a/b/hero.png?v=2")).toBe("hero.png");
    expect(assetLabel("https://placehold.co/120x120")).toBe(
      "placehold.co/120x120"
    );
    expect(assetLabel("data:image/png;base64,AAAA")).toBe("内嵌图片");
    expect(assetLabel("")).toBe("图片");
  });

  it("素材铺在画板**下方**，不撑宽画板的外接盒", () => {
    // ⚠ 放旁边会把外接盒撑宽，"适应画布"就再也框不住页面本身了。
    const area = { x: 0, y: 0, w: 4000, h: 2400 };
    const boxes = layoutAssets(extractPageAssets(pages), area);
    expect(boxes.every(b => b.y > area.y + area.h)).toBe(true);
    expect(
      boxes.every(b => b.x >= area.x && b.x + b.w <= area.x + area.w)
    ).toBe(true);
  });

  it("每行放几张按画板区宽度算，至少 1 张", () => {
    const assets = extractPageAssets(pages);
    const wide = layoutAssets(assets, { x: 0, y: 0, w: 4000, h: 100 });
    const narrow = layoutAssets(assets, { x: 0, y: 0, w: 10, h: 100 });
    expect(new Set(wide.map(b => b.y)).size).toBe(1);
    expect(new Set(narrow.map(b => b.y)).size).toBe(assets.length);
  });

  it("没有素材时不排布", () => {
    expect(layoutAssets([], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });
});

describe("属性面板的事实（只汇总，不推断）", () => {
  const labelOf = (p: { pageId: string; name?: string }) => p.name || p.pageId;
  const page = {
    pageId: "p1",
    name: "团长工作台",
    html: "<html><img src='https://placehold.co/40x40'></html>",
    bound: true,
    device: "desktop" as const,
  };
  const assets = extractPageAssets([page]);

  it("把模型里的字段绑定按实体归拢，并给出人话名", () => {
    const f = boardFacts(
      page,
      TUANGOU,
      [],
      assets,
      { w: 1920, h: 1080 },
      labelOf
    );
    expect(f.bindings).toEqual([
      {
        entity: "group_activity",
        entityName: "团购活动",
        fields: ["activity_title", "activity_status"],
      },
    ]);
  });

  it("状态三档如实：已接数据 / 尚未接数据 / 未通过校验", () => {
    const v = { w: 1920, h: 1080 };
    expect(boardFacts(page, TUANGOU, [], [], v, labelOf).status).toBe("bound");
    expect(
      boardFacts({ ...page, bound: false }, TUANGOU, [], [], v, labelOf).status
    ).toBe("unbound");
    // ⚠ missing 压倒 bound：没交出成品的页不许显示"已接数据"。
    expect(
      boardFacts({ ...page, missing: true }, TUANGOU, [], [], v, labelOf).status
    ).toBe("missing");
  });

  it("连线分进/出两拨", () => {
    const links = [
      { id: "a", from: "p1", to: "p3", kind: "manual" as const, label: "跳转" },
      {
        id: "b",
        from: "p2",
        to: "p1",
        kind: "dataflow" as const,
        label: "团购活动",
      },
    ];
    const f = boardFacts(
      page,
      TUANGOU,
      links,
      [],
      { w: 1920, h: 1080 },
      labelOf
    );
    expect(f.linksOut.map(l => l.id)).toEqual(["a"]);
    expect(f.linksIn.map(l => l.id)).toEqual(["b"]);
  });

  it("只算**这一页**用到的素材，并数出其中的占位图", () => {
    const shared = extractPageAssets([
      page,
      { pageId: "p9", html: "<img src='/real.png'>" },
    ]);
    const f = boardFacts(
      page,
      TUANGOU,
      [],
      shared,
      { w: 1920, h: 1080 },
      labelOf
    );
    expect(f.assets).toHaveLength(1);
    expect(f.placeholderAssets).toBe(1);
  });

  it("体积按 UTF-8 字节算（中文页不能按字符数糊弄）", () => {
    const f = boardFacts(
      { pageId: "p", html: "中文" },
      null,
      [],
      [],
      { w: 1, h: 1 },
      labelOf
    );
    expect(f.htmlBytes).toBe(6);
  });

  it("模型里没有这一页时给空清单，不炸", () => {
    const f = boardFacts(
      { pageId: "ghost" },
      TUANGOU,
      [],
      [],
      { w: 1, h: 1 },
      labelOf
    );
    expect(f.bindings).toEqual([]);
    expect(f.actions).toEqual([]);
    expect(f.kind).toBe("");
  });
});

/* ============================================================ 换图（use 级） */

/**
 * 真机切片 eb9af6d8a0（2026-08-25 从生产库扒的）：**同一个占位图 URL 在同一个
 * 应用里当了 5 家公司的 logo**。这组数据是"换图不能按 URL 换"的全部理由——
 * 没有它，按 URL 全换的实现看起来完全合理。
 */
const 五家公司 = [
  {
    pageId: "p1",
    html:
      `<img src="https://placehold.co/40x40/e2e8f0/cbd5e1" alt="Tencent tech company corporate badge" class="rounded">` +
      `<img src="https://placehold.co/40x40/e2e8f0/cbd5e1" alt="BYD company tech automotive logo badge">`,
  },
  {
    pageId: "p2",
    html:
      `<img src="https://placehold.co/40x40/e2e8f0/cbd5e1" alt="Ant Group fintech corporate badge">` +
      `<img src="https://placehold.co/600x400" alt="hero">`,
  },
];

/** 真机切片 1674f484：同一个头像图在 5 页，alt 全一样——这种才该一键全换。 */
const 同一头像 = [
  {
    pageId: "p1",
    html: `<img src="https://placehold.co/40x40" alt="administrator avatar portrait">`,
  },
  {
    pageId: "p2",
    html: `<img src="https://placehold.co/40x40" alt="administrator avatar portrait">`,
  },
  {
    pageId: "p3",
    html: `<img src="https://placehold.co/32x32" alt="site logo">`,
  },
];

describe("素材：用途（use）与换图", () => {
  it("同一个 URL 的每一处 <img> 都记成一条 use，alt 跟着走", () => {
    const [asset] = extractPageAssets(五家公司);
    expect(asset!.url).toBe("https://placehold.co/40x40/e2e8f0/cbd5e1");
    expect(asset!.uses).toHaveLength(3);
    expect(asset!.uses.map(u => u.alt)).toEqual([
      "Tencent tech company corporate badge",
      "BYD company tech automotive logo badge",
      "Ant Group fintech corporate badge",
    ]);
    // 卡片仍按 URL 去重（屏幕上它确实就是同一张灰图）
    expect(asset!.pageIds).toEqual(["p1", "p2"]);
  });

  it("alt 不同 → 分成不同的用途组（这就是不能按 URL 全换的那条）", () => {
    const [asset] = extractPageAssets(五家公司);
    const groups = assetUseGroups(asset!);
    expect(groups).toHaveLength(3);
    expect(groups.every(g => g.count === 1)).toBe(true);
  });

  it("alt 相同 → 收成一组，一次换掉所有页（用户要的「全换」在这里）", () => {
    const [asset] = extractPageAssets(同一头像);
    const groups = assetUseGroups(asset!);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.pageIds).toEqual(["p1", "p2"]);
  });

  it("换图只动 (src, alt) 都对上的那一处", () => {
    const r = replaceAssetUseInHtml(
      五家公司[0]!.html,
      {
        url: "https://placehold.co/40x40/e2e8f0/cbd5e1",
        alt: "Tencent tech company corporate badge",
      },
      "https://live.staticflickr.com/1/tencent.jpg"
    );
    expect(r.replaced).toBe(1);
    expect(r.html).toContain("https://live.staticflickr.com/1/tencent.jpg");
    // ⚠ 反向判据：比亚迪那张**必须原样留着**。没有这条，"按 src 全换"
    //   的实现照样让上面那条正向判据变绿。
    expect(r.html).toContain(
      `src="https://placehold.co/40x40/e2e8f0/cbd5e1" alt="BYD company tech automotive logo badge"`
    );
  });

  it("只换 src，标签里其它属性原样留着", () => {
    const r = replaceAssetUseInHtml(
      `<img class="rounded" src="a.png" alt="x" loading="lazy" data-field="u.avatar">`,
      { url: "a.png", alt: "x" },
      "b.png"
    );
    expect(r.html).toContain(`class="rounded"`);
    expect(r.html).toContain(`loading="lazy"`);
    // data-* 掉了会被 DOMPurify 白名单那条纪律反咬——绑定就是靠它
    expect(r.html).toContain(`data-field="u.avatar"`);
    expect(r.html).toContain(`src="b.png"`);
  });

  it("alt 对不上就不换（只按 src 换会换错）", () => {
    const r = replaceAssetUseInHtml(
      `<img src="a.png" alt="猫">`,
      { url: "a.png", alt: "狗" },
      "b.png"
    );
    expect(r.replaced).toBe(0);
    expect(r.html).toBe(`<img src="a.png" alt="猫">`);
  });

  it("新地址里的 & 要转义（Openverse 回的地址常带 query）", () => {
    const r = replaceAssetUseInHtml(
      `<img src="a.png" alt="x">`,
      { url: "a.png", alt: "x" },
      "https://images.rawpixel.com/i?w=800&h=600"
    );
    expect(r.html).toContain("w=800&amp;h=600");
    expect(r.html).not.toContain("w=800&h=600");
  });

  it("单引号写法也认，并且换完仍是单引号", () => {
    const r = replaceAssetUseInHtml(
      `<img src='a.png' alt='x'>`,
      { url: "a.png", alt: "x" },
      "b.png"
    );
    expect(r.replaced).toBe(1);
    expect(r.html).toContain(`src='b.png'`);
  });

  it("alt 里的 HTML 实体解码后再比（&amp; 和 & 是同一个 alt）", () => {
    expect(decodeEntities("A &amp; B")).toBe("A & B");
    const [asset] = extractPageAssets([
      { pageId: "p", html: `<img src="a.png" alt="A &amp; B">` },
    ]);
    expect(asset!.uses[0]!.alt).toBe("A & B");
    const r = replaceAssetUseInHtml(
      `<img src="a.png" alt="A &amp; B">`,
      { url: "a.png", alt: "A & B" },
      "b.png"
    );
    expect(r.replaced).toBe(1);
  });

  it("planAssetReplacement 只回真的改过的页", () => {
    const patches = planAssetReplacement(
      同一头像,
      {
        url: "https://placehold.co/40x40",
        alt: "administrator avatar portrait",
      },
      "https://live.staticflickr.com/1/a.jpg"
    );
    expect(patches.map(p => p.pageId)).toEqual(["p1", "p2"]);
    // 反向：没引这张图的 p3 不该出现在补丁里（否则等于白写一次库）
    expect(patches.some(p => p.pageId === "p3")).toBe(false);
    expect(patches.every(p => p.replaced === 1)).toBe(true);
  });

  it("一处都没换到时回空数组——调用方必须当失败处理，不许当成功", () => {
    const patches = planAssetReplacement(
      同一头像,
      { url: "https://placehold.co/40x40", alt: "对不上的 alt" },
      "https://live.staticflickr.com/1/a.jpg"
    );
    expect(patches).toEqual([]);
  });

  it("提取和替换共用同一条标签正则：扒得出来的每一处都换得掉", () => {
    // ⚠ 这条钉的是纪律四（同一件事两处实现）。上一版提取只匹配 src=，
    //   要配 alt 就得另写一条正则——两条正则迟早分叉，症状是画布上列得出
    //   这张图、点换图却"换了 0 处"。
    const pages = [...五家公司, ...同一头像];
    for (const asset of extractPageAssets(pages)) {
      for (const group of assetUseGroups(asset)) {
        const patches = planAssetReplacement(pages, group, "https://x/new.jpg");
        expect(patches.reduce((n, p) => n + p.replaced, 0)).toBe(group.count);
      }
    }
  });
});
