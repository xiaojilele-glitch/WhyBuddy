/**
 * 菜单点击要扛得住「页面在生成中途被改名」。
 *
 * ## 事故（2026-08-28）
 *
 * 真机 sr-20260827191954（社区连锁药房）四个菜单项**全点不动**，且没有任何
 * 一处报错。量出来的现场：
 *
 *     pages 字典的键 = remote_rx_audit / store_rx_dispense / ...   ← 语义 id
 *     navItems 的 id = 同上                                        ← 对
 *     HTML 里的孔    = p1 / p2 / p3 / p4                            ← 错
 *
 * 成因在 spec_first_pipeline 第 4.5 步：它把「以页面 id 作键或存页面 id」的
 * 七样载体都改了名，**唯独改不到已经烧进 HTML 正文的 data-page-id**——那是
 * 第 3.5 步 unify_shell 按当时的草稿 id 打的孔。宿主 resolveActivePageId 查
 * 不到就静默回落当前页，表现就是「点了没反应」。
 *
 * 同一天验过的另外两场：sr-20260827201847 五个孔全废；sr-20260822124211 页键
 * 本身还是 p1/p2、孔对得上、菜单是好的——所以这是第 4.5 步引入的**回归**。
 *
 * ## 判据为什么落在这儿
 *
 * 「量渲染后的东西，不量源码」（纪律五）：下面第二条把交付 HTML 里的孔**全部
 * 抠出来**，逐个要求它解析得到一份真交付页——那正是用户手指点下去会发生的
 * 事。只断言「别名表存下来了」是不够的：名单里有名字 ≠ 埋点在（纪律三）。
 *
 * 反向判据也写在这里（第三条）：解析不出来必须返回 null，**不许兜底回落到
 * 某一页**——静默回落正是这个 bug 的表现形态，不能把它当成修复。
 */

import { describe, expect, it } from "vitest";

import { livePagesFromSpec, type SpecFirstPagesBlob } from "../spec-live-pages";
import { aliasIdsFor, canonicalPageId } from "../page-id-alias";
import { resolveActivePageId } from "../live-runtime/SpecPageLiveStage";

/** 真机那四页的 id 与人话名，一字不改。 */
const REAL = [
  ["remote_rx_audit", "药师远程审方工作台"],
  ["store_rx_dispense", "门店处方与发药看板"],
  ["store_transfer_collab", "门店缺药调拨协作台"],
  ["network_dispatch_center", "全网库存与调拨调度中心"],
] as const;

/** 侧栏的形状照真机抠出来的那份：孔是 p1..p4，标签是语义名。 */
function deliveredHtml(currentIndex: number): string {
  const links = REAL.map(([, name], i) => {
    const cur = i === currentIndex ? ' aria-current="page"' : "";
    return `<a data-page-id="p${i + 1}"${cur}><span>${name}</span></a>`;
  }).join("\n");
  return `<!DOCTYPE html><html><body><aside><nav>${links}</nav></aside><main>正文</main></body></html>`;
}

/** 落库产物：页键是语义 id，孔却是草稿 id——第 4.5 步改键之后的真实状态。 */
function blobAfterRename(withAliases: boolean): SpecFirstPagesBlob {
  const pages: Record<string, string> = {};
  REAL.forEach(([id], i) => {
    pages[id] = deliveredHtml(i);
  });
  const aliases: Record<string, string> = {};
  REAL.forEach(([id], i) => {
    aliases[`p${i + 1}`] = id;
  });
  return {
    pages,
    navItems: REAL.map(([id, name]) => ({ id, name })),
    device: "desktop",
    // withAliases=false 就是修复之前的产物形状（老存档也长这样）
    pageIdAliases: withAliases ? aliases : null,
  };
}

/** 把一段交付 HTML 里的菜单孔全抠出来。 */
function holesIn(html: string): string[] {
  return [...html.matchAll(/data-page-id="([^"]*)"/g)].map(m => m[1]);
}

describe("页面改名之后，菜单仍然点得动", () => {
  it("每一个菜单孔都解析得到一份真交付页（真机形态，端到端）", () => {
    const pages = livePagesFromSpec(blobAfterRename(true));
    const deliveredIds = new Set(pages.map(p => p.pageId));

    const holes = [...new Set(pages.flatMap(p => holesIn(p.html)))];
    // 前提先钉住：孔确实跟页键不是一套，否则这条判据在验一个不存在的问题
    expect(holes).toEqual(["p1", "p2", "p3", "p4"]);
    expect(holes.some(h => deliveredIds.has(h))).toBe(false);

    const dangling = holes.filter(h => canonicalPageId(h, pages) === null);
    expect(dangling).toEqual([]);

    // 点第二项，必须落在「门店处方与发药看板」那一页上——不是回落，是真切过去
    expect(canonicalPageId("p2", pages)).toBe("store_rx_dispense");
  });

  it("没有别名表时确实是坏的——这条钉住上面那条不是在验空气", () => {
    const pages = livePagesFromSpec(blobAfterRename(false));
    const holes = [...new Set(pages.flatMap(p => holesIn(p.html)))];
    const dangling = holes.filter(h => canonicalPageId(h, pages) === null);
    expect(dangling).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("解析不出来返回 null，不许兜底回落到某一页（反向判据）", () => {
    const pages = livePagesFromSpec(blobAfterRename(true));
    expect(canonicalPageId("p9", pages)).toBeNull();
    expect(canonicalPageId("", pages)).toBeNull();
    // 当前 id 优先于别名：新页恰好叫了某个旧 id 时不许指错人
    const shadowed = [
      { pageId: "p1", aliasIds: [] as string[] },
      { pageId: "real", aliasIds: ["p1"] },
    ];
    expect(canonicalPageId("p1", shadowed)).toBe("p1");
  });

  it("跨轮二次改名：中间那个 id 不是交付页，链仍要跟到终点", () => {
    // 精修轮的真实形状：首轮 p1→draft2，第二轮 draft2→final，落库时合并成
    // 一张表。draft2 **不是**交付页，没有页面对象可挂——链必须在展平这一步
    // 跟完，写在解析侧永远走不到第二跳（这条判据咬出过一次真实现漏洞）。
    const merged = { p1: "draft2", draft2: "final" };
    expect(aliasIdsFor("final", merged).sort()).toEqual(["draft2", "p1"]);
    const pages = [{ pageId: "final", aliasIds: aliasIdsFor("final", merged) }];
    expect(canonicalPageId("p1", pages)).toBe("final");
    expect(canonicalPageId("draft2", pages)).toBe("final");
  });

  it("别名表带环时不死循环，也不瞎认", () => {
    const cyclic = { x: "y", y: "x" };
    expect(aliasIdsFor("x", cyclic)).toEqual([]);
    expect(aliasIdsFor("y", cyclic)).toEqual([]);
  });

  it("resolveActivePageId 也认别名——jsdom 跑不了 srcdoc，这是唯一测得着的接缝", () => {
    const pages = livePagesFromSpec(blobAfterRename(true));
    // 手动点过旧 id：要收敛到当前 id，而不是被当成没选过回落落地页
    expect(resolveActivePageId("p3", pages, { running: false })).toBe(
      "store_transfer_collab"
    );
    // 没选过、跑完了：行为不变，落导航第一项
    expect(resolveActivePageId(null, pages, { running: false })).toBe(
      "remote_rx_audit"
    );
    // 认不出来的 id 不许赖着：照旧走回落，不返回那个野 id
    expect(resolveActivePageId("p9", pages, { running: false })).toBe(
      "remote_rx_audit"
    );
  });
});
