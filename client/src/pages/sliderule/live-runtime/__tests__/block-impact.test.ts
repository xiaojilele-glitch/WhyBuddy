// @vitest-environment jsdom
/**
 * 刀 4（影响面）的判据（2026-08-27）。
 *
 * 这一刀最容易做成花架子：线画满了、看着很厉害、没人看得懂。所以判据盯的
 * 不是"有没有线"，而是：
 *
 *   · **真联动**和**仅同源**分得开吗（混成一类 = 骗人）
 *   · 孤岛块显示成「无影响」而不是「未计算」（风险台账 #05）
 *   · 不该亮的块不许亮（第三条：正向判据齐全、反向判据缺失）
 */
import { describe, expect, it } from "vitest";

import {
  IMPACT_DIM_EDGE,
  IMPACT_DIM_NODE,
  buildImpactEdges,
  impactEdgeDimmed,
  impactFocus,
  impactNodeDimmed,
  impactedBy,
  islandBlockKeys,
  isRealLinkage,
  scanBlockBindings,
  REAL_LINKAGE_KINDS,
} from "../block-impact";
import { blockKey } from "../block-rects";

const B = (name: string, inner: string, kind = "card") =>
  `<div data-block="${name}" data-block-kind="${kind}">${inner}</div>`;

/**
 * ⚠ 表格夹具必须**带 `<table>`**。
 *
 * 写夹具时踩过：`<div data-block><tbody data-rows=...>` 里的 tbody/tr/td 会被
 * HTML 解析器**直接丢掉**（不在 table 里的表格元素不合法）——扫出来是空的，
 * 看着像扫描器写坏了，其实是夹具不合法。
 *
 * 这正是 CLAUDE.md 第四条那口井的活样本：Python 的 `scan_bindings` 用正则
 * 标签栈，**看得见**这个 tbody；浏览器的 DOMParser 看不见。同一份 HTML
 * 两个结论。我们这一侧以浏览器为准（画布上画什么线，看的是真实渲染的树）。
 */
const TBL = (rows: string) => `<table><tbody ${rows}</tbody></table>`;

describe("扫出每一块用到了什么", () => {
  it("data-field 带上它所在的实体作用域", () => {
    const [b] = scanBlockBindings(
      "p1",
      B(
        "待办",
        TBL('data-rows="prescription"><tr><td data-field="rx_no">x</td></tr>')
      )
    );
    expect(b.fields).toEqual(["prescription.rx_no"]);
  });

  it("作用域开在**块外面**也算得出（详情页那种写法）", () => {
    // ⚠ 漏了这条，外层 data-record + 内层 data-field 的页面一个字段都扫不出，
    //   影响面上整块显示成「无影响」——不报错。
    const html =
      '<section data-record="prescription">' +
      B("处方详情", '<span data-field="rx_no">A-1</span>') +
      "</section>";
    const [b] = scanBlockBindings("p1", html);
    expect(b.fields).toEqual(["prescription.rx_no"]);
  });

  it("动作、跳转、素材各归各的", () => {
    const [b] = scanBlockBindings(
      "p1",
      B(
        "操作区",
        '<button data-action="submit_rx">交</button>' +
          '<a data-page-id="p2">去审核</a>' +
          '<img src="https://x/y.png">'
      )
    );
    expect(b.actions).toEqual(["submit_rx"]);
    expect(b.navTargets).toEqual(["p2"]);
    expect(b.assets).toEqual(["https://x/y.png"]);
  });

  it("图表的实体+维度也算字段引用", () => {
    const [b] = scanBlockBindings(
      "p1",
      B("趋势", '<div data-chart="line" data-entity="rx" data-dimension="day"></div>', "chart")
    );
    expect(b.fields).toEqual(["rx.day"]);
  });

  it("反向：没有绑定的纯视觉块，四项都是空数组（**不是** null）", () => {
    // 真机基线 15 块里有 7 块是这种。空数组 = 「无影响」，null = 「未计算」，
    // 界面上必须分得开。
    const [b] = scanBlockBindings("p1", B("装饰", "<h2>欢迎</h2>"));
    expect(b.fields).toEqual([]);
    expect(b.actions).toEqual([]);
    expect(b.navTargets).toEqual([]);
    expect(b.assets).toEqual([]);
  });

  it("块 key 跨页唯一", () => {
    const a = scanBlockBindings("p1", B("统计概览", "x"))[0];
    const b = scanBlockBindings("p2", B("统计概览", "x"))[0];
    expect(a.key).not.toBe(b.key);
  });
});

describe("⚠ 真联动 和 仅同源 必须分得开", () => {
  it("三类真联动的口径只有一份", () => {
    // 变异：把 "field" 混进 REAL_LINKAGE_KINDS，这条红。
    expect([...REAL_LINKAGE_KINDS]).toEqual(["nav", "action", "asset"]);
    expect(isRealLinkage("field")).toBe(false);
    for (const k of REAL_LINKAGE_KINDS) expect(isRealLinkage(k)).toBe(true);
  });

  it("共用字段 → field 类；共用动作 → action 类。同一对块两条都画", () => {
    // ⚠ 合并成一条等于把"改了会跟着变"和"改了不会跟着变"说成同一件事。
    const all = [
      ...scanBlockBindings(
        "p1",
        B("甲", '<b data-rows="rx" data-field="no"></b><i data-action="go"></i>')
      ),
      ...scanBlockBindings(
        "p1",
        B("乙", '<b data-rows="rx" data-field="no"></b><i data-action="go"></i>')
      ),
    ];
    const edges = buildImpactEdges(all);
    const kinds = edges.map(e => e.kind).sort();
    expect(kinds).toEqual(["action", "field"]);
  });
});

describe("造线", () => {
  const page = (pid: string, blocks: string) => scanBlockBindings(pid, blocks);

  it("跳转线从块指到**目标页**", () => {
    const all = page("p1", B("菜单", '<a data-page-id="p2">去</a>'));
    const [e] = buildImpactEdges(all);
    expect(e.kind).toBe("nav");
    expect(e.from).toBe(blockKey("p1", "菜单"));
    expect(e.to).toBe("p2");
  });

  it("反向：跳到自己这一页的不画（否则几十条自环）", () => {
    const all = page("p1", B("菜单", '<a data-page-id="p1">当前页</a>'));
    expect(buildImpactEdges(all)).toEqual([]);
  });

  it("两块共用 3 个字段只画 1 条，共用项全在 shared 里（不丢信息）", () => {
    const mk = (n: string) =>
      B(
        n,
        '<b data-rows="rx" data-field="no"></b>' +
          '<b data-rows="rx" data-field="pt"></b>' +
          '<b data-rows="rx" data-field="dt"></b>'
      );
    const all = [...page("p1", mk("甲")), ...page("p1", mk("乙"))];
    const edges = buildImpactEdges(all);
    expect(edges).toHaveLength(1);
    expect(edges[0].shared).toEqual(["rx.dt", "rx.no", "rx.pt"]);
  });

  it("三块共用同一字段 → 3 条（两两，无序去重）", () => {
    const mk = (n: string) => B(n, '<b data-rows="rx" data-field="no"></b>');
    const all = [
      ...page("p1", mk("甲")),
      ...page("p1", mk("乙")),
      ...page("p2", mk("丙")),
    ];
    expect(buildImpactEdges(all)).toHaveLength(3);
  });

  it("跨页共用也连（这正是摊开的理由）", () => {
    const mk = (n: string) => B(n, '<b data-rows="rx" data-field="no"></b>');
    const edges = buildImpactEdges([
      ...page("p1", mk("甲")),
      ...page("p2", mk("乙")),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBe(blockKey("p1", "甲"));
    expect(edges[0].to).toBe(blockKey("p2", "乙"));
  });

  it("反向：一块自己用两次同一个字段，不跟自己连", () => {
    const all = page(
      "p1",
      B("甲", '<b data-rows="rx" data-field="no"></b><b data-rows="rx" data-field="no"></b>')
    );
    expect(buildImpactEdges(all)).toEqual([]);
  });
});

describe("⚠ 反查：选中一块，谁跟着变", () => {
  const mkAll = () => [
    ...scanBlockBindings(
      "p1",
      B("处方表", TBL('data-rows="rx"><tr><td data-field="no"></td></tr>'), "table")
    ),
    ...scanBlockBindings(
      "p1",
      B("处方卡", '<div data-record="rx"><span data-field="no"></span></div>')
    ),
    ...scanBlockBindings(
      "p2",
      B("审核台", TBL('data-rows="rx"><tr><td data-field="no"></td></tr>'), "table") +
        B("交单", '<button data-action="submit"></button>')
    ),
    ...scanBlockBindings("p2", B("装饰条", "<h2>欢迎</h2>")),
  ];

  it("正向：改 rx.no，那 3 块点亮（含跨页那一块）", () => {
    const edges = buildImpactEdges(mkAll());
    const hit = impactedBy(edges, blockKey("p1", "处方表"));
    expect([...hit.sameField].sort()).toEqual(
      [blockKey("p1", "处方卡"), blockKey("p2", "审核台")].sort()
    );
  });

  it("反向：没用这个字段的块**不许亮**（缺了这条，全亮也是绿的）", () => {
    // CLAUDE.md 第三条点名的形态。
    const edges = buildImpactEdges(mkAll());
    const hit = impactedBy(edges, blockKey("p1", "处方表"));
    expect(hit.sameField.has(blockKey("p2", "装饰条"))).toBe(false);
    expect(hit.sameField.has(blockKey("p2", "交单"))).toBe(false);
    expect(hit.real.size).toBe(0);
  });

  it("孤岛块回**空集**，不是 null——「无影响」不是「未计算」", () => {
    // 风险台账 #05。同 grok registry.rs 那条"绑定掉光的记录不删"。
    const edges = buildImpactEdges(mkAll());
    const hit = impactedBy(edges, blockKey("p2", "装饰条"));
    expect(hit.real).toBeInstanceOf(Set);
    expect(hit.sameField).toBeInstanceOf(Set);
    expect(hit.real.size).toBe(0);
    expect(hit.sameField.size).toBe(0);
  });

  it("真联动和仅同源分两个集合回（界面要分色）", () => {
    const all = [
      ...scanBlockBindings("p1", B("甲", '<img src="a.png"><b data-rows="rx" data-field="n"></b>')),
      ...scanBlockBindings("p1", B("乙", '<img src="a.png">')),
      ...scanBlockBindings("p1", B("丙", '<b data-rows="rx" data-field="n"></b>')),
    ];
    const hit = impactedBy(buildImpactEdges(all), blockKey("p1", "甲"));
    expect([...hit.real]).toEqual([blockKey("p1", "乙")]);
    expect([...hit.sameField]).toEqual([blockKey("p1", "丙")]);
  });
});

describe("选中点亮：邻域集合（刀 4 开整）", () => {
  const mkAll = () => [
    ...scanBlockBindings(
      "p1",
      B("处方表", TBL('data-rows="rx"><tr><td data-field="no"></td></tr>'), "table")
    ),
    ...scanBlockBindings(
      "p1",
      B("处方卡", '<div data-record="rx"><span data-field="no"></span></div>')
    ),
    ...scanBlockBindings(
      "p2",
      B("审核台", TBL('data-rows="rx"><tr><td data-field="no"></td></tr>'), "table") +
        B("交单", '<button data-action="submit"></button>')
    ),
    ...scanBlockBindings("p2", B("装饰条", "<h2>欢迎</h2>")),
  ];

  it("没选中时不点亮、不压暗（全画是概览）", () => {
    const focus = impactFocus(buildImpactEdges(mkAll()), null);
    expect(focus.active).toBe(false);
    expect(focus.island).toBe(false);
    expect(focus.litKeys.size).toBe(0);
    expect(focus.litEdgeIds.size).toBe(0);
    expect(impactEdgeDimmed(focus, "anything")).toBe(false);
    expect(impactNodeDimmed(focus, "anything")).toBe(false);
  });

  it("正向：改 rx.no 那 3 块进 litKeys（含跨页、含自己）", () => {
    const all = mkAll();
    const edges = buildImpactEdges(all);
    const me = blockKey("p1", "处方表");
    const focus = impactFocus(edges, me);
    expect(focus.active).toBe(true);
    expect(focus.island).toBe(false);
    expect(focus.litKeys.has(me)).toBe(true);
    expect(focus.litKeys.has(blockKey("p1", "处方卡"))).toBe(true);
    expect(focus.litKeys.has(blockKey("p2", "审核台"))).toBe(true);
  });

  it("反向：没用这个字段的块不许亮（缺了这条，全亮也是绿的）", () => {
    const edges = buildImpactEdges(mkAll());
    const focus = impactFocus(edges, blockKey("p1", "处方表"));
    expect(focus.litKeys.has(blockKey("p2", "装饰条"))).toBe(false);
    expect(focus.litKeys.has(blockKey("p2", "交单"))).toBe(false);
    expect(impactNodeDimmed(focus, blockKey("p2", "装饰条"))).toBe(true);
    expect(impactNodeDimmed(focus, blockKey("p2", "交单"))).toBe(true);
  });

  it("反向：不与选中块相连的线不进 litEdgeIds", () => {
    const edges = buildImpactEdges(mkAll());
    const me = blockKey("p1", "处方表");
    const focus = impactFocus(edges, me);
    for (const e of edges) {
      const incident = e.from === me || e.to === me;
      expect(focus.litEdgeIds.has(e.id), e.id).toBe(incident);
      expect(impactEdgeDimmed(focus, e.id)).toBe(!incident);
    }
  });

  it("孤岛：litKeys 只有自己，island 为真", () => {
    const me = blockKey("p2", "装饰条");
    const focus = impactFocus(buildImpactEdges(mkAll()), me);
    expect(focus.island).toBe(true);
    expect([...focus.litKeys]).toEqual([me]);
    expect(focus.litEdgeIds.size).toBe(0);
  });

  it("孤岛名单含装饰条，不含处方表", () => {
    const all = mkAll();
    const islands = islandBlockKeys(all, buildImpactEdges(all));
    expect(islands.has(blockKey("p2", "装饰条"))).toBe(true);
    expect(islands.has(blockKey("p1", "处方表"))).toBe(false);
    expect(islands.has(blockKey("p2", "交单"))).toBe(true);
  });

  it("压暗不是藏起来：透明度 > 0（裁决：两类都常驻画）", () => {
    expect(IMPACT_DIM_EDGE).toBeGreaterThan(0);
    expect(IMPACT_DIM_NODE).toBeGreaterThan(0);
    expect(IMPACT_DIM_EDGE).toBeLessThan(1);
    expect(IMPACT_DIM_NODE).toBeLessThan(1);
  });
});

describe("fail-open", () => {
  it("空 HTML / 垃圾输入回空数组，不抛", () => {
    expect(scanBlockBindings("p1", "")).toEqual([]);
    expect(scanBlockBindings("p1", null)).toEqual([]);
    expect(scanBlockBindings("p1", "<<<>>")).toEqual([]);
  });

  it("没有块的页面回空数组", () => {
    expect(scanBlockBindings("p1", "<div>没有块标</div>")).toEqual([]);
  });
});
