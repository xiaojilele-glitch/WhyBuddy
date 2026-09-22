/**
 * E14 我的应用画廊：卡片推导/筛选纯函数。
 * 纪律回归：不发明数据——模型缺失就是 draft，证据数如实。
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import {
  deriveAppCardDetail,
  deriveDetailFromAppSummary,
  deriveDetailFromAppRecord,
  extractSpecPages,
  orderedSpecPages,
  mergeGalleryItems,
  shouldUseSheetThumb,
  filterCards,
  formatUpdatedAt,
  formatRelativeTime,
  pageLooksFull,
  GALLERY_PAGE_SIZE,
  canOpenGalleryItem,
  applyAppPatch,
  storeRecordFor,
  shouldBlankGallery,
  sessionIsAlive,
  type SessionListItem,
} from "../AppsWorkbench";
import type { AppStoreSummary } from "../app-store-client";

const runnableState = {
  publishClosure: {
    evidencePresentCount: 6,
    blocked: false,
    perSkillEvidence: {
      datamodel: {
        modelSection: {
          entities: [
            { name: "患者", fields: [{ name: "姓名" }] },
            { name: "预约单", fields: [] },
          ],
        },
      },
      page: {
        modelSection: {
          pages: [{ id: "p1", name: "工作台" }, { id: "p2", name: "预约日历" }],
        },
      },
      rbac: { modelSection: { roles: ["dentist", "front_desk"] } },
      workflow: {
        modelSection: { nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }], transitions: [] },
      },
    },
  },
};

describe("deriveAppCardDetail", () => {
  it("闭环 6/6 + 模型齐 → runnable，计数取真模型", () => {
    const d = deriveAppCardDetail(runnableState);
    expect(d.status).toBe("runnable");
    expect(d.evidenceCount).toBe(6);
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(2);
    expect(d.flowNodes).toBe(3);
    expect(d.roles).toBe(2);
    expect(d.pageNames).toEqual(["工作台", "预约日历"]);
    expect(d.entityNames).toContain("患者");
  });

  it("证据 6/6 但无模型（确定性域）→ 不冒充可运行", () => {
    const d = deriveAppCardDetail({
      publishClosure: { evidencePresentCount: 6, blocked: false },
    });
    expect(d.status).toBe("draft");
    expect(d.entities).toBe(0);
  });

  it("停泊等待（awaitReason）→ awaiting；空状态 → draft 零计数", () => {
    expect(
      deriveAppCardDetail({ awaitReason: "route_selection", publishClosure: {} }).status
    ).toBe("awaiting");
    const empty = deriveAppCardDetail({});
    expect(empty.status).toBe("draft");
    expect(empty.evidenceCount).toBe(0);
  });

  it("blocked 闭环不算可运行", () => {
    const d = deriveAppCardDetail({
      ...runnableState,
      publishClosure: { ...runnableState.publishClosure, blocked: true },
    });
    expect(d.status).not.toBe("runnable");
  });
});

describe("filterCards", () => {
  const item = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });
  const cards = [
    { item: item("a", "宠物医院预约"), detail: deriveAppCardDetail(runnableState) },
    { item: item("b", "健身房排期"), detail: deriveAppCardDetail({}) },
    { item: item("c", "还没拉到详情"), detail: null },
  ];

  it("all 全放行；runnable/draft 按状态；详情未到不武断归类", () => {
    expect(filterCards(cards, "all", "")).toHaveLength(3);
    expect(filterCards(cards, "runnable", "").map(c => c.item.sessionId)).toEqual(["a"]);
    expect(filterCards(cards, "draft", "").map(c => c.item.sessionId)).toEqual(["b"]);
  });

  it("搜索按话题子串过滤", () => {
    expect(filterCards(cards, "all", "宠物")).toHaveLength(1);
    expect(filterCards(cards, "all", "不存在")).toHaveLength(0);
  });
});

const summary = (over: Partial<AppStoreSummary> = {}): AppStoreSummary => ({
  id: "app1",
  root_id: "app1",
  parent_id: null,
  version: 1,
  session_id: "s1",
  goal: "咖啡店管理",
  gate_passed: true,
  created_at: "2026-07-24T10:00:00Z",
  product_name: "咖营通",
  theme_id: "forest",
  theme_label: "松绿·测试",
  device: "desktop",
  landing_page_ref: "p0",
  entity_count: 3,
  page_count: 4,
  ...over,
});

describe("deriveDetailFromAppSummary", () => {
  it("App Store 摘要 → runnable 卡片详情，计数全取摘要", () => {
    const d = deriveDetailFromAppSummary(summary({ role_count: 2, ai_count: 1 }));
    expect(d.status).toBe("runnable"); // App Store 只存闭环应用
    expect(d.entities).toBe(3);
    expect(d.pages).toBe(4);
    expect(d.roles).toBe(2);
    expect(d.aiCaps).toBe(1);
    // 摘要给不出的两样保持 null，不编（点开预览才按需拉整包）。
    expect(d.model).toBeNull();
    expect(d.specPages).toBeNull();
    expect(d.identity?.productName).toBe("咖营通");
    expect(d.identity?.theme).toBe("forest");
  });

  it("★ null ≠ 0：数不出来的计数保持 null，不许落成 0", () => {
    // 0 是在断言"这个应用没有角色"，null 是"这份模型里没这一段，数不出来"。
    // 写成 `s.role_count || 0` 这条必红——那正是 2026-08-22 前的写法会犯的错。
    const d = deriveDetailFromAppSummary(summary({ role_count: null, ai_count: undefined }));
    expect(d.roles).toBeNull();
    expect(d.aiCaps).toBeNull();
  });

  it("★ 0 是合法计数，不许被当成缺失吞掉", () => {
    // `??` 和 `||` 的分水岭就在这一条：`||` 会把 0 和 undefined 一起吞成 0，
    // 于是"确实没有角色"和"数不出来"合并成同一个显示，判据也就永远咬不住。
    const d = deriveDetailFromAppSummary(summary({ role_count: 0, ai_count: 0 }));
    expect(d.roles).toBe(0);
    expect(d.aiCaps).toBe(0);
  });
});

/**
 * ★ 2026-08-22：卡片不再为了两个数字拉整包。
 *
 * 改动前每张 App Store 卡进视口就 `GET /apps/{id}`，把整包 model_json +
 * pages_json 拉下来数角色/AI——首屏 30 张卡 = 30 次请求、1.9 MB。后端把
 * role_count / ai_count 放进列表摘要之后，卡片这一趟网络整个没了。
 *
 * 这一组盯的是**接线**，不是纯函数：函数写对了不等于它被用上，本仓第三条。
 */
describe("应用卡不再拉整包", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const src = sourceWithoutComments(raw);
  const ensure = src.slice(
    src.indexOf("const ensureDetail = React.useCallback"),
    src.indexOf("const ensureFullDetail = React.useCallback")
  );

  it("ensureDetail 的 app 分支不打网络", () => {
    expect(ensure).toContain("deriveDetailFromAppSummary");
    // 反向：整段 ensureDetail 里不许再出现 getApp。
    expect(ensure).not.toContain("getApp");
    // app 分支必须先 return，别掉进下面那条会话卡的 fetch 里。
    expect(ensure).toMatch(/gi\.source === "app"[\s\S]{0,400}?return;/);
  });

  it("会话卡还得拉——它们没落进 App Store，状态只在会话档里", () => {
    // 反向的反向：一起删掉会让推演中的卡永远显示"加载中…"。
    expect(ensure).toContain("/api/sliderule/sessions/");
  });

  it("★ 整包改成点开预览才拉，且真的接在点击上", () => {
    // 只写一个 ensureFullDetail 不接线，跑出来的现象是：点开弹窗永远空白，
    // 而所有纯函数判据全绿。这就是本仓第三条说的那种"闸全绿但东西没了"。
    const full = src.slice(
      src.indexOf("const ensureFullDetail = React.useCallback"),
      src.indexOf("const loadMoreApps")
    );
    expect(full).toContain("getApp(");
    expect(full).toContain("deriveDetailFromAppRecord");
    // 接线：卡片 onClick 里必须调它，且和开弹窗在一起。
    const click = src.slice(src.indexOf("onClick={() => {"), src.indexOf("topRight={"));
    expect(click).toContain("ensureFullDetail(item)");
    expect(click).toContain("setPreviewModal(item)");
  });

  it("★ 点开的判据不能再问 model/specPages —— 那两样如今恒为 null", () => {
    // 改动前是 `detail?.model || detail?.specPages ? setPreviewModal : undefined`。
    // 卡片详情改从摘要推之后这两样永远是 null，那条判据会把每一张 App Store
    // 卡判成"点了没反应"——没有报错、没有告警、判据全绿。
    const click = src.slice(src.indexOf("onClick={() => {"), src.indexOf("topRight={"));
    expect(click).toMatch(/if\s*\(isApp\)/);
    const appBranch = click.slice(click.indexOf("if (isApp)"), click.indexOf("}", click.indexOf("setPreviewModal(item)")));
    expect(appBranch).not.toContain("detail?.model");
  });

  it("指标行：数不出来就不画那个徽标", () => {
    const metrics = src.slice(src.indexOf("metrics={"), src.indexOf("statusDot={"));
    expect(metrics).toContain("detail.roles !== null");
    expect(metrics).toContain("detail.aiCaps !== null");
  });

  it("摘要类型带上这两个可空计数（前后端同一口径）", () => {
    const client = sourceWithoutComments(
      readFileSync(new URL("../app-store-client.ts", import.meta.url), "utf8")
    );
    expect(client).toMatch(/role_count\?:\s*number \| null/);
    expect(client).toMatch(/ai_count\?:\s*number \| null/);
  });
});

describe("deriveDetailFromAppRecord", () => {
  it("完整 model_json → 全指标 + 活渲染模型（与会话卡同源口径）", () => {
    const model = {
      datamodel: { entities: [{ name: "订单" }, { name: "商品" }] },
      page: { pages: [{ id: "p0", name: "监控台" }] },
      workflow: { nodes: [{ id: "n1" }] },
      rbac: { roles: ["店长", "店员"] },
      aigc: { capabilities: [{ id: "c1" }] },
      appbundle: { appIdentity: { productName: "咖营通", theme: "forest", icon: "cart" } },
    };
    const d = deriveDetailFromAppRecord(model);
    expect(d.status).toBe("runnable");
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(1);
    expect(d.roles).toBe(2);
    expect(d.aiCaps).toBe(1);
    expect(d.identity?.icon).toBe("cart");
    expect(d.model).not.toBeNull();
  });

  it("坏 model_json（非对象）→ 不崩，退成空指标 draft", () => {
    expect(deriveDetailFromAppRecord(null).model).toBeNull();
    expect(deriveDetailFromAppRecord("nope").entities).toBe(0);
  });
});

// ── spec-first 整页 HTML 进应用中心（2026-08-14 接线）─────────────────────
//
// 有 pages_json / specFirstPages 的应用，缩略图与只读预览走 HTML 应用面
// （与推演舞台同一路），不再拿区块渲染器凑合出光板表格。这里钉判空口径、
// 页序、以及两条数据源（App Store 记录 / 会话态）都把页面带进详情。

const pagesPayload = {
  version: "spec-first-pipeline-v1",
  pages: {
    "page-orders": "<!DOCTYPE html><html><body>订单页</body></html>",
    "page-home": "<!DOCTYPE html><html><body>首页</body></html>",
  },
  navItems: [{ pageId: "page-home", label: "首页" }, { pageId: "page-orders", label: "订单" }],
  boundPages: 2,
};

describe("extractSpecPages", () => {
  it("合法载荷 → 收成 SpecPagesDetail", () => {
    const sp = extractSpecPages(pagesPayload)!;
    expect(Object.keys(sp.pages)).toHaveLength(2);
    expect(sp.boundPages).toBe(2);
    expect(sp.navItems[0].pageId).toBe("page-home");
  });

  it("部分打孔失败：成功数和失败名单都留下，不许只留开关", () => {
    const sp = extractSpecPages({
      ...pagesPayload,
      boundPages: 3,
      failedPages: { p2: "页面 p2 打孔失败" },
    })!;
    expect(sp.boundPages).toBe(3);
    expect(sp.failedPages).toEqual({ p2: "页面 p2 打孔失败" });
  });

  it("每页相位要留下——丢掉就只能靠成功数反推", () => {
    const sp = extractSpecPages({
      ...pagesPayload,
      boundPages: 3,
      pageBindStatus: { p1: "bound", p2: "failed", p3: "bound", p4: "bound" },
      failedPages: { p2: "页面 p2 打孔失败" },
    })!;
    expect(sp.pageBindStatus).toEqual({
      p1: "bound",
      p2: "failed",
      p3: "bound",
      p4: "bound",
    });
  });

  it("空壳/坏形状一律 null——空壳判成有页面会挂出一个空白 iframe", () => {
    expect(extractSpecPages(null)).toBeNull();
    expect(extractSpecPages("nope")).toBeNull();
    expect(extractSpecPages({})).toBeNull();
    expect(extractSpecPages({ pages: {} })).toBeNull();
    expect(extractSpecPages({ pages: { p1: "" } })).toBeNull();
    expect(extractSpecPages({ pages: { p1: 42 } })).toBeNull();
  });

  it("个别页坏了只丢那一页，好页留下", () => {
    const sp = extractSpecPages({ pages: { good: "<html></html>", bad: 42 } })!;
    expect(Object.keys(sp.pages)).toEqual(["good"]);
  });

  it("Python 壳的导航是 id/name，要收成 pageId", () => {
    const sp = extractSpecPages({
      pages: { p2: "<html>加工</html>" },
      navItems: [{ id: "p1", name: "拾取" }, { id: "p2", name: "加工" }],
    })!;
    expect(sp.navItems.map(n => n.pageId)).toEqual(["p1", "p2"]);
    expect(sp.navItems[0].label).toBe("拾取");
  });

  it("tablet 不许折成 desktop——折了舞台就按 1920 看现场页", () => {
    const sp = extractSpecPages({
      ...pagesPayload,
      device: "tablet",
    })!;
    expect(sp.device).toBe("tablet");
  });
});

describe("orderedSpecPages", () => {
  it("按导航排序（第一项 = 落地页），导航没提到的页兜底排后", () => {
    const sp = extractSpecPages({
      ...pagesPayload,
      pages: { ...pagesPayload.pages, "page-orphan": "<html>没进导航</html>" },
    })!;
    expect(orderedSpecPages(sp).map(p => p.pageId)).toEqual([
      "page-home",
      "page-orders",
      "page-orphan",
    ]);
  });

  it("导航引用不存在的页不炸、不出空项", () => {
    const sp = extractSpecPages({
      pages: { p1: "<html></html>" },
      navItems: [{ pageId: "ghost" }, { pageId: "p1" }],
    })!;
    expect(orderedSpecPages(sp).map(p => p.pageId)).toEqual(["p1"]);
  });
});

describe("详情把页面带进来（两条数据源同口径）", () => {
  it("App Store 记录：pages_json → detail.specPages", () => {
    const d = deriveDetailFromAppRecord({ datamodel: { entities: [{ name: "订单" }] } }, pagesPayload);
    expect(d.specPages).not.toBeNull();
    expect(Object.keys(d.specPages!.pages)).toHaveLength(2);
  });

  it("老记录没有 pages_json → null，回落区块渲染（改动前行为）", () => {
    const d = deriveDetailFromAppRecord({ datamodel: { entities: [] } });
    expect(d.specPages).toBeNull();
  });

  it("会话态：specFirstPages → detail.specPages", () => {
    const d = deriveAppCardDetail({ ...runnableState, specFirstPages: pagesPayload });
    expect(d.specPages).not.toBeNull();
  });

  it("摘要占位不含页面本体（has_pages 只是一位布尔）", () => {
    expect(deriveDetailFromAppSummary(summary({ has_pages: true })).specPages).toBeNull();
  });
});

describe("mergeGalleryItems", () => {
  const sess = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });

  it("App Store 应用 + 未落库会话草稿合流，按 session_id 去重", () => {
    const apps = [summary({ id: "app1", session_id: "s1" })];
    const sessions = [sess("s1", "咖啡店（已闭环）"), sess("s2", "健身房（在推演）")];
    const items = mergeGalleryItems(apps, sessions);
    // s1 已被 App Store 卡承载 → 不再出会话草稿卡；只剩 app1 + s2
    expect(items.map(i => i.key).sort()).toEqual(["app:app1", "session:s2"]);
    const appItem = items.find(i => i.source === "app")!;
    expect(appItem.appId).toBe("app1");
    expect(appItem.version).toBe(1);
    const draft = items.find(i => i.source === "session")!;
    expect(draft.sessionId).toBe("s2");
  });

  it("无 App Store（空）→ 全是会话卡，零回退", () => {
    const items = mergeGalleryItems([], [sess("s1", "a"), sess("s2", "b")]);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.source === "session")).toBe(true);
  });

  it("**封面三件套在这里归一** —— 两个来源，一组字段", () => {
    // 2026-08-24：会话摘要开始带 appId + 预览字段（后端 session_covers）。
    // 归一必须发生在合并处，下游只读 device/hasPreview/previewTag 一组。
    const items = mergeGalleryItems(
      [summary({ id: "app1", session_id: "s1", device: "phone", has_preview: true, preview_tag: "shot.1" })],
      [
        sess("s1", "已被应用卡承载"),
        {
          sessionId: "s2",
          goal: "应用还没翻到那一页",
          appId: "app2",
          version: 3,
          device: "desktop",
          has_preview: true,
          preview_tag: "shot.2",
        },
        sess("s3", "真的没绑应用"),
      ]
    );
    const byKey = Object.fromEntries(items.map(i => [i.key, i]));
    expect(byKey["app:app1"].device).toBe("phone");
    expect(byKey["app:app1"].hasPreview).toBe(true);
    expect(byKey["app:app1"].previewTag).toBe("shot.1");
    // ★ 会话卡也要有：认不到应用那一页的会话，靠自己的摘要贴图
    expect(byKey["session:s2"].appId).toBe("app2");
    expect(byKey["session:s2"].version).toBe(3);
    expect(byKey["session:s2"].device).toBe("desktop");
    expect(byKey["session:s2"].hasPreview).toBe(true);
    expect(byKey["session:s2"].previewTag).toBe("shot.2");
    expect(shouldUseSheetThumb(byKey["session:s2"])).toBe(true);
    // 反向：真的没绑应用的会话不许凭空长出封面
    expect(byKey["session:s3"].appId).toBeUndefined();
    expect(byKey["session:s3"].hasPreview).toBe(false);
    expect(shouldUseSheetThumb(byKey["session:s3"])).toBe(false);
  });

  it("**下游不许再回去读 summary 上的封面字段** —— 那样会话卡永远不贴图", () => {
    // 本仓第三条（同一件事两处判定，改一处就静默失效）的具象化。读
    // summary?.has_preview / summary?.device 只有 app 源有值，现象是会话卡
    // 一直画空占位，既不报错也没告警——2026-08-24 那天 66 张卡只有 14 张有图。
    const bare = sourceWithoutComments(
      readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8")
    );
    expect(bare).not.toContain("summary?.has_preview");
    expect(bare).not.toContain("summary?.preview_tag");
    expect(bare).not.toMatch(/aspectForDevice\(entry\.item\.summary/);
    // 正向：读的是归一之后那组
    expect(bare).toMatch(/aspectOf=\{entry => aspectForDevice\(entry\.item\.device\)\}/);
    expect(bare).toMatch(/previewTag=\{item\.previewTag\}/);
  });
});

/**
 * 「为啥有的卡只有『删除应用』」（2026-08-24 用户在真机上问的）。
 *
 * ## 病灶
 *
 * 菜单里「复刻 / 设为私有 / 移交官方」三条的门写的是
 * `item.source === "app"`。而上面 `mergeGalleryItems` 那条测试**早就承认了**
 * 另一种卡：应用列表一页 12 条、会话列表是全量，绑定的应用还没翻到那一页时，
 * 这张已闭环的应用就以 session 源摆在墙上（那条用例的样例名就叫「应用还没翻
 * 到那一页」）。按 source 判 = 把它当草稿，菜单只剩一条删除。
 *
 * 封面三件套 8-24 已经在合并处归一了，菜单是**漏掉的那一半**——本仓第四条。
 *
 * 判据落在「有没有 App Store 记录」上，两个方向都写：有记录要认，
 * 没记录（真草稿 / 反查还没回来）不许凭空造出三条点了会 404 的按钮。
 */
describe("storeRecordFor：卡片背后有没有 App Store 记录", () => {
  const sessionCard = {
    key: "session:s2",
    source: "session" as const,
    goal: "应用还没翻到那一页",
    sessionId: "s2",
    appId: "app2",
  };

  it("app 源自带记录 → 原样返回，不绕反查", () => {
    const card = { key: "app:app1", source: "app" as const, goal: "咖啡店", summary: summary() };
    expect(storeRecordFor(card, undefined)).toBe(card);
  });

  it("★ 会话卡反查到记录 → 整张换成 app 视图，菜单三条才亮得起来", () => {
    const bound = summary({ id: "app2", root_id: "r2", version: 3, visibility: "private" });
    const got = storeRecordFor(sessionCard, bound)!;
    expect(got.source).toBe("app");
    expect(got.appId).toBe("app2");
    expect(got.rootId).toBe("r2");
    expect(got.version).toBe(3);
    // 摘要必须换上记录里那份：菜单文案（设为公开/私有、从官方交还）就是照它渲染的。
    expect(got.summary?.visibility).toBe("private");
    // key 不变——details / boundApps 都按它索引，换了就全查不到。
    expect(got.key).toBe("session:s2");
  });

  it("★ 反向：反查还没回来（undefined）就是 null，不许先把按钮摆出来", () => {
    // 摘要里带着 appId 也不算数——那只够贴封面，不够渲染「设为公开/私有」。
    // 提前放行的现象是：菜单闪出三条，点下去 patchApp 拿 undefined 去请求。
    expect(sessionCard.appId).toBe("app2");
    expect(storeRecordFor(sessionCard, undefined)).toBeNull();
  });

  it("★ 反向：确认没有绑定应用（null）→ 仍是 null，草稿卡就该只有删除", () => {
    expect(storeRecordFor({ ...sessionCard, appId: undefined }, null)).toBeNull();
  });
});

describe("点卡：会话在就进，没了就看快照", () => {
  const me = { id: "u1", email: "a@b.c", isSuperuser: false, isVerified: true };
  const own = {
    source: "app" as const,
    sessionId: "s1",
    summary: { owner_id: "u1" },
  };
  const listed = [{ sessionId: "s1" }, { sessionId: "s2" }];

  it("自己的卡、会话还在 → 进会话", () => {
    expect(canOpenGalleryItem(own, listed, me)).toBe(true);
  });

  it("自己的卡、会话没了 → 不进死会话", () => {
    expect(canOpenGalleryItem(own, [{ sessionId: "s2" }], me)).toBe(false);
    expect(canOpenGalleryItem({ ...own, sessionId: undefined }, listed, me)).toBe(false);
  });

  it("别人的卡不进对方会话", () => {
    expect(
      canOpenGalleryItem(
        { source: "app", sessionId: "s1", summary: { owner_id: "other" } },
        listed,
        me
      )
    ).toBe(false);
  });

  it("会话草稿卡仍可进", () => {
    expect(
      canOpenGalleryItem({ source: "session", sessionId: "s2", summary: null }, listed, me)
    ).toBe(true);
  });

  it("列表没回来时不闪预览", () => {
    expect(sessionIsAlive("s1", null)).toBe(true);
    expect(sessionIsAlive("s1", [])).toBe(false);
  });
});

describe("filterCards（含 App Store 卡）", () => {
  it("App Store 摘要卡即时算 runnable，进 runnable 筛选", () => {
    const cards = [
      { item: { goal: "咖营通" }, detail: deriveDetailFromAppSummary(summary()) },
      { item: { goal: "草稿" }, detail: deriveAppCardDetail({}) },
    ];
    expect(filterCards(cards, "runnable", "")).toHaveLength(1);
    expect(filterCards(cards, "draft", "")).toHaveLength(1);
  });
});

describe("formatUpdatedAt", () => {
  it("ISO → 本地紧凑格式；坏输入回空串", () => {
    expect(formatUpdatedAt("2026-07-15T06:17:00Z")).toMatch(/^2026-07-15 \d{2}:\d{2}$/);
    expect(formatUpdatedAt("garbage")).toBe("");
    expect(formatUpdatedAt(null)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-26T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

  it("按跨度给人话，绝对时间由调用方兜底", () => {
    expect(formatRelativeTime(ago(10 * S), now)).toBe("刚刚");
    expect(formatRelativeTime(ago(5 * M), now)).toBe("5 分钟前");
    expect(formatRelativeTime(ago(3 * H), now)).toBe("3 小时前");
    expect(formatRelativeTime(ago(1 * D), now)).toBe("昨天");
    expect(formatRelativeTime(ago(4 * D), now)).toBe("4 天前");
    expect(formatRelativeTime(ago(2 * 7 * D), now)).toBe("2 周前");
    expect(formatRelativeTime(ago(90 * D), now)).toBe("3 个月前");
    expect(formatRelativeTime(ago(400 * D), now)).toBe("1 年前");
  });

  it("空/坏输入回空串", () => {
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("garbage", now)).toBe("");
  });
});

// ── 顶栏吸顶 + 卡片墙（2026-07-31）─────────────────────────────────────
// 纯 className 的改动最容易在后续重构里被无声改掉（不报错、测试也不红，
// 只是回到"筛选 chip 跟着滚没"）。这里读源码钉住几条必要条件。
describe("应用中心顶栏吸顶", () => {
  const src = readFileSync(
    new URL("../AppsWorkbench.tsx", import.meta.url),
    "utf8"
  );

  it("标题/搜索/tab/筛选整块 sticky 在滚动容器顶部", () => {
    expect(src).toMatch(/className="sticky top-0 z-30 /);
  });

  it("吸顶块必须自带背景——sticky 元素默认透明，卡片会从字底下穿过去", () => {
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/);
    expect(m).not.toBeNull();
    // 钉的是"背景走壳底色这个 token"，不是某个具体色值——底色改过一次
    // （2026-08-03 冷灰 → 白），把 hex 写进断言的话每次换色都要改测试，
    // 而真正会出事的是**忘了给背景**（sticky 默认透明，卡片从标题底下穿过去）。
    expect(m![0]).toMatch(/bg-\[var\(--sr-shell-bg,\s*#[0-9a-fA-F]{3,6}\)\]/);
  });

  it("负 margin + 同值 padding 抵掉根节点内边距，背景铺满整宽", () => {
    // 不这么做的话卡片会从左右内边距那两条缝里透出来。
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/)![0];
    for (const cls of ["-mx-6", "px-6", "-mt-5", "pt-5", "md:-mx-8", "md:px-8"]) {
      expect(m).toContain(cls);
    }
  });

  it("z-30 高于卡片菜单(z-10)与健康浮层(z-20)", () => {
    // 健康浮层在吸顶块**里面**，跟着一起吸顶；卡片菜单在下面，被盖住是对的。
    expect(src).toContain("top-11 z-20"); // 健康浮层
    expect(src).toContain("top-8 z-10"); // 卡片菜单
  });

  it("卡片墙用绝对定位容器，不再是等尺寸 grid", () => {
    expect(src).toContain('data-testid="apps-wall"');
    // 旧写法：grid-cols-2 + 每卡 aspect-video，手机档被硬拉成 16:9
    expect(src).not.toMatch(/grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">\s*\{pagedMine/);
  });
});


// ── 卡片墙：masonic 瀑布流 + 图下信息区（2026-07-31）───────────────────
describe("卡片墙走 masonic，高度由内容决定", () => {
  const src = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const scroller = readFileSync(new URL("../useScrollerIn.ts", import.meta.url), "utf8");

  it("换掉 react-photo-album——它的高度是算出来的，装不下图外文案", () => {
    // photo-album 的模型是 height = columnWidth / ratio（源码 masonry.ts），
    // 高度只能由比例反推。卡片改成「画面 + 图下信息区」之后，信息区多高取决于
    // 标题会不会换行，结构上就不该由比例决定。
    // 只禁 import——注释里为了说明取舍还会提到这个库名。
    expect(src).not.toMatch(/from "react-photo-album/);
    expect(src).not.toMatch(/import "react-photo-album/);
    expect(src).not.toContain("MasonryPhotoAlbum");
    expect(src).not.toContain("ColumnsPhotoAlbum");
    // 定位器把高度当**输入**：set(index, height)，配 ResizeObserver 量真实 DOM
    // 再回填。2026-07-31 起这一层是自建的 SpanMasonry（要支持跨列，masonic 的
    // useMasonry 把每格宽度写死成全局列宽），但"高度是输入"这条契约没变。
    expect(src).toMatch(/from "masonic"/);
    expect(src).toContain("useContainerPosition");
    expect(src).toContain("SpanMasonry");
    const positioner = readFileSync(new URL("../span-positioner.ts", import.meta.url), "utf8");
    expect(positioner).toMatch(/set\(index, height/);
    const masonry = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(masonry).toContain("ResizeObserver");
    // 钉的是**性质**不是那一行的写法：喂给定位器的高度必须来自真实 DOM 量高
    // （offsetHeight），不能是按比例算出来的。
    //
    // 2026-08-09 改过一次：原来写死 `positioner.set(index, el.offsetHeight)`，
    // 定位器改成从 ref 读、下标改成从 DOM 属性读之后这条就红了——而契约根本没变。
    // 这正是"钉实例不钉性质"的老毛病，改成钉两件事：量的是 offsetHeight、
    // 量到的值最终进了 positioner.set。
    expect(masonry).toContain("offsetHeight");
    expect(masonry).toMatch(/\.set\(index, h\b|\.set\(index, el\.offsetHeight\)/);
  });

  it("跨列：逐格宽度必须是自己算的，不能退回全局列宽", () => {
    // masonic use-masonry.js:93 把 style.width 写死成 positioner.columnWidth，
    // 跨列卡因此只能画一列宽。这里钉住"宽度来自该格自己的落位结果"。
    const masonry = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(masonry).toMatch(/width: pos\.width/);
    // 隐藏量高那一批也要用跨列后的宽度，否则量出来的高度是按一列宽换行的，偏高。
    expect(masonry).toMatch(/const w = columnWidth \* span \+ gutter \* \(span - 1\)/);
  });

  it("不用开箱的 <Masonry>——它的滚动源写死是 window", () => {
    // <Masonry> → MasonryScroller → useScroller() → @react-hook/window-scroll。
    // 本应用滚的是 .native-content，window 一格都不滚 → scrollTop 恒 0 →
    // 取件窗口锁死在首屏，往下滚只有空白。所以按官方 advanced usage 自己拼。
    expect(src).not.toMatch(/\bMasonry\b(?!Photo)\s*[,}]/);
    expect(src).toContain("useScrollerIn");
    expect(src).toContain("useContainerPosition");
  });

  it("滚动源找的是最近可滚动祖先，不是 window", () => {
    expect(scroller).toContain("findScrollParent");
    expect(scroller).toMatch(/overflowY === "auto"/);
    expect(scroller).toContain("native-content");
    // scrollTop 必须是**相对网格**的（照抄官方 use-scroller.js 最后一行），
    // 否则网格上方那段顶栏高度会被当成已滚距离。
    expect(scroller).toMatch(/Math\.max\(0,\s*raw - offset\)/);
    // 视口高度取滚动容器的 clientHeight，不是 window.innerHeight
    expect(scroller).toContain("scroller.clientHeight");
  });

  it("卡片宽高**都由布局给**，卡片不自己算", () => {
    // ⚠ 2026-08-23 这条改过三次落点，记一下省得下次又看不懂：
    //   ① 原来钉字面表达式 `Math.round(cellW / aspectForDevice(...))`；
    //   ② 中途抽成 wallCardHeight，因为纯函数落位要用同一个数；
    //   ③ 换成两端对齐行（JustifiedWall）后，高度是**布局的输出**，钉「不许
    //      自己算」，第四个参数叫 cellH；
    //   ④ 当天晚些信息行挪到画面外（等宽瀑布流 ColumnsWall），第四个参数从
    //      「格高」变成「**画面高**」——两者差一条信息行。名字不跟着改的话，
    //      下一个人照旧当格高用，画面高出一条，卡片互相压盖且**不报错**。
    // 反向判据必须剥注释再看：源码里那段"换 B 方案之前这里是 wallCardHeight"
    // 是**事故记录**，留着有用，但会让不剥注释的 grep 假红（本仓第二条踩过的
    // 同一个坑，只是这次方向相反）。
    const bare = sourceWithoutComments(src);
    expect(bare).not.toMatch(/cellW\s*\/\s*aspectForDevice/);
    expect(bare).not.toContain("wallCardHeight");
    // 参数名自带含义：拿到的是画面高，不是格高
    expect(bare).toMatch(/mediaH: number/);
    expect(src).toContain("mediaHeight={mediaH}");
    // 反向：卡片不许把信息行高再减一遍——那就成了两处真值
    expect(bare).not.toMatch(/mediaH\s*=\s*\w+\s*-\s*WALL_CAPTION_HEIGHT/);
    // 宽高比只喂给布局，不在卡片里换算成高度
    expect(src).toMatch(/aspectOf=\{entry => aspectForDevice/);
    // 外框仍然不写死尺寸：位置和宽高都由 ColumnsWall 的定位容器给。
    expect(src).not.toMatch(/style=\{\{ width: cellW, height: cellH \}\}/);
  });

  it("信息行排在画面**外**（2026-08-23 下午，用户对着花瓣的墙裁决）", () => {
    // 这条来回过两趟，两次前提都变了，别当成反复：
    //   7-31  压图上 → 排图下 → 又压回图上（用户裁决）。改回来的理由是"压在
    //         图上没有文字宽度下限"，前提是**当时是等宽瀑布流、最窄列 260px**。
    //   8-23 上午 换成等高变宽，手机卡掉到 110~133px 宽——7-31 那个"122px 放
    //         不下标题"的场景原样回来了，只是字压在图上又被 opacity-30 糊着，
    //         没人看得出来。
    //   8-23 下午 用户提"层次结构跟参考站有差距"。真机三档效果图：只把字挪出
    //         去（保持等高变宽）→ 窄卡标题只剩「构建面…」，废；等宽 + 字挪出
    //         去 → 成。于是两条一起改。
    // 正向：图外那行是深色字，白底上永远读得清
    expect(src).toMatch(/truncate text-\[13px\] font-medium text-stone-800/);
    // 画面仍然铺满它那一块（信息行在画面之外，不是把画面挤成上半截）
    expect(src).toContain("absolute inset-0 overflow-hidden");
  });

  it("**画面上没有常驻压字层** —— 反向，这条才是那个层次差距的根", () => {
    // 原来那条渐变黑带默认 opacity-30、悬停 100。它一旦回来，图又被盖一截、
    // 字又读不清（真机效果图 01 就是那个样子）。
    const bare = sourceWithoutComments(src);
    expect(bare).not.toMatch(/from-black\/85/);
    expect(bare).not.toMatch(/compact \? "text-\[12px\]" : "text-\[13\.5px\]"/);
    // 悬停浮层可以有——指标放在那儿——但静态必须是 opacity-0
    const overlay = bare.match(/className="pointer-events-none absolute inset-x-0 bottom-0 [^"]+"/)?.[0];
    expect(overlay).toBeTruthy();
    expect(overlay).toContain("opacity-0");
    expect(overlay).toContain("group-hover:opacity-100");
    // group-hover 挂在卡片壳上；壳丢了 group，悬停永远不亮。
    //
    // ⚠ 2026-08-24 从整串 className 字面量改成盯**壳上有没有 group**。
    //   原来钉死的是 `"group flex h-full w-full cursor-pointer flex-col"`
    //   一整串；卡片菜单从画面里挪到壳上时壳要加 `relative`（见 CenterCard
    //   里 topRight 那段），这条判据当场变红——而它要挡的东西一点没变。
    //   本仓第二条：盯语义，别盯某句话的字面。
    const shell = bare.match(/className="group [^"]*cursor-pointer[^"]*"/)?.[0];
    expect(shell, "卡片壳丢了 group / cursor-pointer").toBeTruthy();
    expect(shell).toContain("flex-col");
  });

  it("压在渐变上的元素不能留浅底深字", () => {
    // 版本徽标原本是 bg-slate-100 + text-slate-600（图下白底时对的），
    // 挪到黑色渐变上就反了。这条防止以后再往信息条里加浅底元素。
    expect(src).not.toMatch(/bg-slate-100 px-1\.5 text-\[10px\] font-semibold text-slate-600/);
    expect(src).not.toMatch(/inline-flex items-center text-slate-400"\s*\n\s*title=\{formatUpdatedAt/);
  });

  it("门语言标签是中文，且筛选条与卡片徽标同源", () => {
    // 2026-07-31 用户要求汉化：原文 "closed 6/6" / "blocked" 跟旁边的「推演中」
    // 混排，一排筛选条两种语言。
    //
    // 2026-08-07 用户又裁了一刀：**把 "6/6" 去掉**（原话「用户根本不关注这些，
    // 只会增加用户负担」）。代码当天就改了，这条用例没跟上，于是它红在
    // main 上好几天——每次跑全量都要重新判一遍"是不是我弄的"。
    expect(src).toContain('label: "已闭环"');
    expect(src).toContain('label: "待补充"');
    expect(src).not.toMatch(/label:\s*"closed 6\/6"/);
    expect(src).not.toMatch(/label:\s*"blocked"/);
    // 筛选条不能再各写一份字面量——此前两处分开写，改一处漏一处就会
    // 出现"筛选叫 blocked、卡片叫待补充"。
    expect(src).toContain("label={STATUS_META.runnable.label}");
    expect(src).toContain("label={STATUS_META.awaiting.label}");
    // ⚠ 2026-08-19：货架改成三个 tab 时把筛选收进「我的应用」，
    // 市场/官方那一排只剩「最近更新」。三个货架都要这排门语言。
    expect(src).not.toMatch(/tab === "mine" \? \([\s\S]*?<StatChip/);
    expect(src).not.toMatch(/label="closed 6\/6"/);
    expect(src).not.toMatch(/label="blocked"/);
    // **反过来钉：6/6 不许回来。**
    //
    // 这条原来写的是"6/6 的数字不能丢：它是六个 Skill 的证据条数，不是装饰"
    // ——那个理由在 08-07 被推翻了，而推翻的论据写在 AppsWorkbench 的注释里：
    // 那个数字**只在「已闭环」这一支出现，而这一支恒等于 6/6**，所以它从来
    // 没有承担过"还差几项"的信息量。去掉不丢信息。
    expect(src).not.toMatch(/已闭环 6\/6/);
  });

  it("aspectForDevice 保持设备事实，不带任何卡片墙的钳制", () => {
    // 它还服务运行时和 dev-harness，那里要的是真实设备比例。
    const lib = readFileSync(new URL("../../../../lib/justified-rows.ts", import.meta.url), "utf8");
    expect(lib).not.toContain("WALL_MIN_ASPECT");
  });
});

/**
 * 剥注释再匹配（CLAUDE.md 第二条：判据不许被文档字符串带偏）。
 *
 * ⚠ 2026-08-22 修：**行注释必须先剥**。原来是先剥块注释，而源码里有一句
 * `// …不打任何 /api/*。App Store 无后端 → 空。` —— 那个 `/api/*` 里的
 * `/*` 开了个**假块注释**，一路吃到 6800 多字符之外的下一个 `*` + `/`。
 * 后果不是报错，是这段源码对所有 `expect(src).not.toContain(...)` **隐身**：
 * 判据看着挺严，其实那一整段里写什么都不会红。典型的「闸全绿但东西没了」。
 */
function sourceWithoutComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("pageLooksFull", () => {
  it("满页才继续向后要，短页就是到底", () => {
    expect(GALLERY_PAGE_SIZE).toBe(12);
    expect(pageLooksFull(12, 12)).toBe(true);
    expect(pageLooksFull(13, 12)).toBe(true);
    expect(pageLooksFull(11, 12)).toBe(false);
    expect(pageLooksFull(0, 12)).toBe(false);
  });
});

describe("应用中心滚动分页接在真链路上", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const src = sourceWithoutComments(raw);
  const client = sourceWithoutComments(
    readFileSync(new URL("../app-store-client.ts", import.meta.url), "utf8")
  );

  it("首屏按页拉应用，不一次 listApps 空参把默认上限打满", () => {
    expect(src).not.toMatch(/listApps\(\s*\)/);
    // ⚠ 2026-08-22 从字面量改成盯**用意**。原来钉的是
    //   `listApps({ limit: PAGE_SIZE, offset: 0, scope: tab })` 这一串字。
    //   这条判据要挡的是「一次把全表拉下来」，不是「limit 必须写成 PAGE_SIZE」——
    //   同 tab 重拉要把已滚出来的页一并拉回（否则用户滚到第 9 页做个操作就被
    //   打回前 12 张），limit 就不再是常量了。改成：首屏那次必须带
    //   **有上限的 limit** 和 offset:0 和 scope。
    expect(raw).toMatch(/listApps\(\{\s*limit:\s*\w+,\s*offset:\s*0,\s*scope:\s*tab\s*\}\)/);
    // 上限必须存在：去掉封顶就是「一次拉全表」，正是这条判据当初要挡的。
    expect(src).toContain("PAGE_SIZE * 8");
    // ⚠ 不能写 [^)]*：中间那个 Math.max(...) 自带一个右括号。
    expect(src).toMatch(/Math\.min\([\s\S]{0,80}?PAGE_SIZE \* 8\)/);
    expect(raw).toContain("listApps({ limit: PAGE_SIZE, offset, scope: tab })");
    expect(raw).toContain("onReachEnd={onWallReachEnd}");
    expect(raw).toContain("items={wallItems}");
    expect(src).toContain("appendUniqueById");
    expect(src).toContain("wallItems = visible");
    expect(src).not.toMatch(/visible\.slice\(\s*0\s*,\s*shown/);
    expect(src).not.toMatch(/\[\.\.\.\(prev \?\? \[\]\), \.\.\.list\]/);
  });

  it("详情按卡挂载再拉，开局不许 4 工人扫全表", () => {
    expect(src).toContain("GalleryCardGate");
    expect(src).toContain("ensureDetail");
    expect(src).not.toMatch(/const queue = mergeGalleryItems/);
    expect(src).not.toMatch(/Array\.from\(\s*\{\s*length:\s*4\s*\}\s*,\s*async/);
    expect(src).not.toMatch(/queue\.shift\(\)/);
  });

  it("首屏加载走 Primer 大区单指示器，不铺 8 张空卡", () => {
    // https://primer.style/product/ui-patterns/loading
    // 大区中央一个 Spinner + 一次 status 宣告。铺 8 张等大灰块是假货架。
    expect(src).toContain("GalleryLoading");
    expect(src).toContain('role="status"');
    expect(src).toContain('testid="apps-skeleton"');
    expect(src).not.toMatch(/Array\.from\(\s*\{\s*length:\s*8\s*\}/);
    expect(src).not.toContain("function SkeletonCard");
  });

  it("listApps 默认一页 12，不许退回 200", () => {
    expect(client).toMatch(/opts\.limit \?\? 12/);
    expect(client).not.toMatch(/opts\.limit \?\? 200/);
  });
});

describe("三个货架接在真链路上", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const src = sourceWithoutComments(raw);
  const client = sourceWithoutComments(
    readFileSync(new URL("../app-store-client.ts", import.meta.url), "utf8")
  );

  it("默认应用市场，三个 tab，没有官方示例 tab", () => {
    expect(src).toContain('useState<AppShelf>("market")');
    expect(src).toContain('data-testid={`apps-tab-${t.key}`}');
    expect(src).toContain('label: "应用市场"');
    expect(src).toContain('label: "我的应用"');
    expect(src).toContain('label: "官方应用"');
    expect(src).not.toContain("apps-tab-examples");
    expect(src).toContain("复刻到我的应用");
    expect(src).toContain("设为公开");
    expect(src).toContain("设为私有");
    expect(src).toContain("移交到官方应用");
    expect(src).toContain("从官方交还");
    expect(src).not.toContain("标为官方应用");
  });

  it("列表必须带当前货架，Fork 之后切到我的应用", () => {
    // ⚠ 2026-08-22 从字面量改成盯**用意**。原来钉的是
    //   `listApps({ limit: PAGE_SIZE, offset: 0, scope: tab })` 这一串字。
    //   这条判据要挡的是「一次把全表拉下来」，不是「limit 必须写成 PAGE_SIZE」——
    //   同 tab 重拉要把已滚出来的页一并拉回（否则用户滚到第 9 页做个操作就被
    //   打回前 12 张），limit 就不再是常量了。改成：首屏那次必须带
    //   **有上限的 limit** 和 offset:0 和 scope。
    expect(raw).toMatch(/listApps\(\{\s*limit:\s*\w+,\s*offset:\s*0,\s*scope:\s*tab\s*\}\)/);
    // 上限必须存在：去掉封顶就是「一次拉全表」，正是这条判据当初要挡的。
    expect(src).toContain("PAGE_SIZE * 8");
    // ⚠ 不能写 [^)]*：中间那个 Math.max(...) 自带一个右括号。
    expect(src).toMatch(/Math\.min\([\s\S]{0,80}?PAGE_SIZE \* 8\)/);
    expect(src).toContain('setTab("mine")');
    expect(src).toContain("patchApp");
    expect(client).toContain('scope=${encodeURIComponent(opts.scope)}');
  });

  it("只有我的应用合并会话草稿，切 tab 时 apps 为空就算加载中", () => {
    expect(src).toContain('mergeGalleryItems(apps, tab === "mine" ? sessions ?? [] : [])');
    expect(src).toContain("apps === null");
    expect(src).not.toContain("apps === null && sessions === null");
  });

  it("推演收口能按会话反查 app_id——列表分页反查会漏", () => {
    expect(client).toContain("function getGeneratedAppForSession");
    expect(client).toContain("/sessions/${encodeURIComponent(id)}/generated-app");
  });

  it("删卡按血缘摘本地列表，会话草稿若已落库走删应用", () => {
    expect(src).toContain("a.root_id === gi.rootId");
    expect(src).toContain("getGeneratedAppForSession");
    expect(src).toContain("bound?.id");
    expect(src).toContain("没有从货架上拿掉");
    expect(src).toContain("delete-app-error");
  });

  it("点卡走 canOpenGalleryItem，死会话不 open(sessionId)", () => {
    expect(src).toContain("canOpenGalleryItem(item, sessions, authUser)");
    expect(src).toContain("continueOnCard");
    expect(src).toContain("在新会话继续改");
    expect(src).toContain("data-testid=\"delete-app-modal\"");
    expect(src).toContain("绑定的推演会话也会一并删除");
    expect(client).toContain("function reopenApp");
    expect(client).toContain("/apps/${encodeURIComponent(id)}/reopen");
  });
});


/**
 * 「应用市场点一下就整页刷新」（2026-08-22 真机量的）。
 *
 * ## 病灶
 *
 * 点一次「设为私有」，实测：
 *
 *     卡片数 104 → **0** → 120        整片清空过
 *     列表恢复                         6934ms
 *     网络请求                         21 个
 *
 * 21 个里包括 `/api/health`、`/api/agent-loop/health`、`/api/sliderule/llm-channel`
 * ——跟「这一个应用改了可见性」**毫无关系**。成因是所有菜单动作都走
 * `setReloadKey(k => k + 1)`，而那个 effect 的第一句是 `setApps(null)`，
 * 顺带把 `appsOffsetRef` / `appsIdsRef` / `visibleOrderRef` 全清了——
 * 滚出来的分页也一起没了。
 *
 * ⚠ 代码里**没有** `location.reload()`。判据只能落在「渲染后还剩几张卡」上，
 *   grep 源码会说这里没有整页刷新。真机探针在
 *   experiments/ui-drive/market_action_probe.mjs。
 *
 * ⚠ 最讽刺的是 `confirmDeleteApp`：它认真做了本地摘卡（注释写着「不整页
 *   刷新」），紧接着 `notifySessionsUpdated()` 广播，而本组件自己监听这个
 *   事件并 bump —— 本地那份白做。
 */
describe("菜单动作不许把整张列表推倒重来", () => {
  const APPS = [
    { id: "a1", visibility: "public", is_official: false, name: "甲" },
    { id: "a2", visibility: "public", is_official: false, name: "乙" },
    { id: "a3", visibility: "private", is_official: true, name: "丙" },
  ];

  describe("applyAppPatch", () => {
    it("只改中招那一张，其余原样", () => {
      const out = applyAppPatch(APPS, "a2", { visibility: "private" });
      expect(out?.map(a => a.visibility)).toEqual(["public", "private", "private"]);
      expect(out?.map(a => a.name)).toEqual(["甲", "乙", "丙"]);
    });

    it("服务端回什么就写什么，不许前端自己猜", () => {
      // patchApp 回的是服务端的真实状态。乐观更新猜错了，界面和后端就分叉。
      const out = applyAppPatch(APPS, "a1", { visibility: "unlisted", is_official: true });
      expect(out?.[0]).toMatchObject({ visibility: "unlisted", is_official: true });
    });

    it("反向：长度不许变——这条动作只改属性，不增不删", () => {
      expect(applyAppPatch(APPS, "a2", { visibility: "private" })?.length).toBe(3);
    });

    it("反向：id 对不上时整份原样返回，不许悄悄改别人", () => {
      const out = applyAppPatch(APPS, "不存在", { visibility: "private" });
      expect(out).toEqual(APPS);
    });

    it("反向：null 列表保持 null，不许变成空数组", () => {
      // null = 还没加载；[] = 加载完但一个都没有。两者在界面上是不同的状态。
      expect(applyAppPatch(null, "a1", { visibility: "private" })).toBeNull();
    });

    it("反向：空补丁不许把字段抹成 undefined", () => {
      const out = applyAppPatch(APPS, "a3", {});
      expect(out?.[2]).toMatchObject({ visibility: "private", is_official: true });
    });
  });

  describe("shouldBlankGallery", () => {
    it("首次加载要清空（此前没有任何卡）", () => {
      expect(shouldBlankGallery(null, "mine")).toBe(true);
    });

    it("切 tab 要清空——上一个 tab 的卡留着会串台", () => {
      expect(shouldBlankGallery("mine", "official")).toBe(true);
    });

    it("★ 同一个 tab 里重拉**不许**清空——这条就是「点一下整页刷新」的病灶", () => {
      expect(shouldBlankGallery("mine", "mine")).toBe(false);
    });
  });
});


/**
 * 接线判据：纯函数写对了 ≠ 它被调用了（2026-08-22）。
 *
 * ⚠ 上面那组 applyAppPatch / shouldBlankGallery 的单测**咬不住接线**——
 * 实测把菜单动作改回 `setReloadKey`、把清空改回无条件，184 条**照样全绿**。
 * 本仓数到第十次以上的失败形态就是这个。所以这里盯源码形状。
 *
 * ⚠ 这些断言依赖 `sourceWithoutComments`，而它同日修过一个 bug：原来先剥块
 * 注释，源码里 `// …不打任何 /api/*。` 的 `/*` 开了个假块注释，一路吃掉
 * 5980 字符真源码——那段里写什么都不会红。改成先剥行注释。
 */
describe("菜单动作的接线", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const src = sourceWithoutComments(raw);

  it("每个 patchApp 之后都就地改卡，不许再整体重拉", () => {
    const calls = [...src.matchAll(/await patchApp\(/g)];
    expect(calls.length, "菜单里应有可见性与官方位两个动作").toBeGreaterThanOrEqual(2);
    for (const m of calls) {
      const after = src.slice(m.index!, m.index! + 260);
      // ⚠ 2026-08-24 从盯 `applyAppPatch` 这一个名字改成盯**就地改卡**这件事。
      //   会话卡的记录不在 `apps` 列表里（它是反查来的，见 applyPatchedApp），
      //   只调 applyAppPatch 会一声不吭地什么都没改——所以两处缓存收口到了
      //   applyPatchedApp。只认旧名字的判据会把正确的收口判成红。
      expect(after, `patchApp 之后没有就地改卡：${after.slice(0, 90)}`).toMatch(
        /applyAppPatch|applyPatchedApp/
      );
      expect(after, `patchApp 之后又整体重拉了：${after.slice(0, 90)}`).not.toContain(
        "setReloadKey"
      );
    }
  });

  /**
   * 反向：收口函数**自己**必须两处缓存都改。
   *
   * 上面那条只保证「patchApp 之后调了 applyPatchedApp」。把 applyPatchedApp
   * 里那句 setBoundApps 删掉，上面照样全绿，而真机现象是：会话卡上点「设为
   * 私有」，接口成功了、菜单文案不翻——下次打开还写着「设为私有」。
   * 正向判据齐全、反向判据缺失，本仓第三条。
   */
  it("applyPatchedApp 必须同时改 apps 和 boundApps——只改一处就是静默失效", () => {
    const body = src.slice(src.indexOf("const applyPatchedApp"));
    const fn = body.slice(0, body.indexOf("const loadMoreApps"));
    expect(fn, "列表缓存没改").toContain("applyAppPatch(prev, appId, res)");
    expect(fn, "反查缓存没改：会话卡的记录不在 apps 里").toContain("setBoundApps");
  });

  it("三条应用动作的门是「有没有记录」，不是「source 是不是 app」", () => {
    // 病灶（2026-08-24）：门写成 `isApp &&`，于是绑定应用还没翻到那一页的
    // 闭环卡只剩「删除应用」。判据盯**门本身**，不盯菜单文案——文案在
    // 「三个货架接在真链路上」那条里已经钉过，两条一起绿才算这件事做完。
    for (const testid of ["app-fork-", "app-visibility-", "app-official-"]) {
      const at = src.indexOf(testid);
      expect(at, `${testid} 不见了`).toBeGreaterThan(-1);
      // 往回看这个按钮的显隐条件（testid 上一行就是 `{... && (`）
      const guard = src.slice(Math.max(0, at - 200), at);
      expect(guard, `${testid} 的门还写着 isApp`).not.toMatch(/\{isApp &&/);
      expect(guard, `${testid} 没有按 storeItem 把门`).toContain("storeItem");
    }
    // 删除是唯一一条不需要 App Store 记录的动作（草稿会话直接 DELETE），
    // 它的门必须仍然只有 canWrite——跟着改成 storeItem 会让草稿卡删不掉。
    expect(src).toContain("{canWrite && (");
  });

  it("反查只在展开菜单时打，不给整墙预热", () => {
    // ensureBoundApp 挂在「…」按钮的 onClick 上，且只在**展开**那一拍打。
    const at = src.indexOf("ensureBoundApp(item)");
    expect(at, "菜单没接上反查——会话卡永远只剩删除").toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 240), at)).toContain("setMenuFor");
    // 反向：别挂到卡片挂载/悬停上——那是每张卡一次请求。
    expect(src).not.toMatch(/onMouseEnter=\{[^}]*ensureBoundApp/);
    expect(src).not.toMatch(/ensureBoundApp\(entry\.item\)/);
  });

  it("清空列表必须被 shouldBlankGallery 挡着，不许裸 setApps(null)", () => {
    const blanks = [...src.matchAll(/setApps\(null\)/g)];
    expect(blanks.length, "只该有一处清空（首屏/切 tab）").toBe(1);
    const guard = src.lastIndexOf("shouldBlankGallery(", blanks[0].index!);
    expect(guard, "setApps(null) 前面找不到 shouldBlankGallery").toBeGreaterThan(-1);
    // 中间只该隔着 `xxx, tab)) {` 这么点东西；隔太远说明不在同一个 if 里
    expect(blanks[0].index! - guard).toBeLessThan(120);
  });

  it("本组件自己的广播不许让自己整体重拉", () => {
    // confirmDeleteApp 里那句本地摘卡（注释写着「不整页刷新」）就是被自己的
    // 广播打回去的。删掉 notifySidebarOnly，本条必须红。
    expect(src).toContain("notifySidebarOnly");
    expect(src).toContain("selfNotifyRef");
    // 删除/复刻/重开这三处本地已经改好了，只该通知侧栏
    const deleteBlock = src.slice(src.indexOf("const confirmDeleteApp"), src.indexOf("const continueOnCard"));
    expect(deleteBlock).toContain("notifySidebarOnly()");
    expect(deleteBlock).not.toContain("notifySessionsUpdated()");
  });

  it("滚动加载要同步已加载数，否则重拉时把用户打回第一页", () => {
    const append = src.slice(src.indexOf("appendUniqueById(prev, list"), src.indexOf("appendUniqueById(prev, list") + 320);
    expect(append).toContain("loadedCountRef.current");
  });
});

describe("project workspace card entry", () => {
  const raw = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const src = sourceWithoutComments(raw);

  it("exposes a direct project workbench action and closes the menu before navigation", () => {
    expect(src).toContain('data-testid={`app-open-project-${item.sessionId || item.appId}`}');
    const at = src.indexOf("data-testid={`app-open-project-");
    const block = src.slice(Math.max(0, at - 240), at + 520);
    expect(block).toContain('detail?.runtimeKind === "project"');
    expect(block).toContain("openProjectWorkspace(item)");
    expect(src).toContain("const openProjectWorkspace = async (gi: GalleryItem)");
    const start = src.indexOf("const openProjectWorkspace");
    const fn = src.slice(start, src.indexOf("/**", start + 10));
    expect(fn).toContain("setMenuFor(null)");
    expect(fn).toContain("canOpenGalleryItem(gi, sessions, authUser)");
    expect(fn).toContain("continueOnCard(gi)");
  });
});
