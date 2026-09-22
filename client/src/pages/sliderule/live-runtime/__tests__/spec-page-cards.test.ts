/**
 * 画布不许出现「12 张卡对应 6 个页面」。
 *
 * ## 病灶（真机 sr-20260906111901，自习室占座）
 *
 *     65~110s   spec_page × 6   p3 p1 p2 p6 p5 p4       bound=false   第 3 步素颜
 *     110.4s    spec_page × 6   同样六个 p*              bound=false   3.5 外壳统一
 *     225.3s    spec_page × 6   seat_hogging_report …    bound=true    6.5 打完孔
 *
 * 服务端第 4.5 步把草稿 id 改成语义 id，前端按 pageId 认卡，认不出第三批是
 * 同一批页 → 追加 → 12 张卡、12 条「🖼 界面已出」，前 6 张素颜未打孔点不动。
 *
 * ## 判据钉的是什么
 *
 * 下面第一条是**真机重演**：按那三批的真实顺序喂进去，钉住"卡片总数 6"。
 * 它是这次修复的唯一验收口——其余各条都是把它拆细，好在它红的时候知道
 * 哪一半坏了。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renameAnnouncedPage,
  renameSpecPageCard,
  upsertSpecPageCard,
} from "../spec-page-cards";

interface Card {
  pageId: string;
  html: string;
  current: number;
  total: number;
  bound: boolean;
}

const card = (pageId: string, bound = false, html = `<main>${pageId}</main>`): Card => ({
  pageId,
  html,
  current: 1,
  total: 6,
  bound,
});

/** 真机那六页的改名表（服务端 `pageIdAliases` 原样）。 */
const ALIASES: Record<string, string> = {
  p1: "seat_selection",
  p2: "my_reservations_and_credit",
  p3: "seat_hogging_report",
  p4: "area_and_timeslot_mgmt",
  p5: "violation_ticket_audit",
  p6: "operations_and_reports",
};

const load = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("真机重演：三批页面 + 一次改名", () => {
  it("卡片总数是 6，不是 12", () => {
    let cards: Card[] = [];
    const announced = new Set<string>();
    const chips: string[] = [];

    // 左栏芯片的播报规则跟 hook 里一致：没播报过才播报。
    const arrive = (c: Card) => {
      cards = upsertSpecPageCard(cards, c);
      if (!announced.has(c.pageId)) {
        announced.add(c.pageId);
        chips.push(c.pageId);
      }
    };

    // 批 1：第 3 步素颜页，到达顺序就是真机那个乱序
    for (const pid of ["p3", "p1", "p2", "p6", "p5", "p4"]) arrive(card(pid));
    expect(cards).toHaveLength(6);

    // 批 2：3.5 外壳统一后重发，html 变大（外壳统一了），id 没变
    for (const pid of ["p3", "p1", "p2", "p6", "p5", "p4"]) {
      arrive(card(pid, false, `<header>占座系统</header><main>${pid}</main>`));
    }
    expect(cards).toHaveLength(6);

    // 第 4.5 步：改名。**必须在批 3 之前**（服务端让它跟页面走同一条队列）
    for (const [from, to] of Object.entries(ALIASES)) {
      cards = renameSpecPageCard(cards, from, to);
      renameAnnouncedPage(announced, from, to);
    }

    // 批 3：6.5 打完孔重发，用的是语义 id
    for (const pid of Object.values(ALIASES)) arrive(card(pid, true));

    expect(cards).toHaveLength(6);
    expect(cards.map(c => c.pageId).sort()).toEqual(Object.values(ALIASES).sort());
    // 全都打过孔了——没有一张是"素颜孤儿"
    expect(cards.every(c => c.bound)).toBe(true);
    // 左栏芯片同样 6 条，不是 12
    expect(chips).toHaveLength(6);
  });

  it("改名事件缺席时会退回病灶——证明这条判据真的在测东西", () => {
    // 反向对照。没有这一条，上面那条在"改名压根没生效"时也可能因为别的原因
    // 绿掉，我们就不知道它究竟钉住了什么。
    let cards: Card[] = [];
    for (const pid of ["p3", "p1", "p2", "p6", "p5", "p4"]) {
      cards = upsertSpecPageCard(cards, card(pid));
    }
    for (const pid of Object.values(ALIASES)) {
      cards = upsertSpecPageCard(cards, card(pid, true));
    }
    expect(cards).toHaveLength(12); // ← 这就是真机上看到的那 12 张
    expect(cards.filter(c => !c.bound)).toHaveLength(6); // 6 张素颜孤儿
  });
});

describe("认卡：覆盖，不是追加", () => {
  it("同一页第二次到达就覆盖，后到的那份赢", () => {
    const first = card("p1", false);
    const second = card("p1", true, "<main>打过孔</main>");
    const out = upsertSpecPageCard([first], second);
    expect(out).toHaveLength(1);
    expect(out[0].bound).toBe(true);
    expect(out[0].html).toBe("<main>打过孔</main>");
  });

  it("没见过的页才追加，且不动已有那些", () => {
    const out = upsertSpecPageCard([card("p1"), card("p2")], card("p3"));
    expect(out.map(c => c.pageId)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("改名：只换键，内容不动", () => {
  it("HTML 一个字都不变（照 grok requires_reparse => false）", () => {
    const before = card("p1", false, "<main>选座</main>");
    const out = renameSpecPageCard([before], "p1", "seat_selection");
    expect(out[0].pageId).toBe("seat_selection");
    expect(out[0].html).toBe("<main>选座</main>");
    expect(out[0].bound).toBe(false);
    expect(out[0].current).toBe(before.current);
    expect(out[0].total).toBe(before.total);
  });

  it("位置不变，别的卡一根头发都不许动", () => {
    const list = [card("p1"), card("p2"), card("p3")];
    const out = renameSpecPageCard(list, "p2", "my_reservations");
    expect(out.map(c => c.pageId)).toEqual(["p1", "my_reservations", "p3"]);
    // 同一性：没被改名的那两张还是原来那个对象，不许无谓重建
    expect(out[0]).toBe(list[0]);
    expect(out[2]).toBe(list[2]);
  });

  it("新键已经有卡了就丢掉旧那张，不留两张同名", () => {
    // 会走到这一支的两种情况：改名事件被重放（断线重连从 since=0）、
    // 两个旧 id 指到同一个新 id。
    const out = renameSpecPageCard(
      [card("p1"), card("seat_selection", true)],
      "p1",
      "seat_selection"
    );
    expect(out).toHaveLength(1);
    expect(out[0].pageId).toBe("seat_selection");
    expect(out[0].bound).toBe(true); // 留下的是打过孔那张
  });

  it.each([
    ["改成自己", "p1", "p1"],
    ["缺 from", "", "seat_selection"],
    ["缺 to", "p1", ""],
    ["没有这张卡", "p9", "whatever"],
  ])("%s → 原样返回同一个引用（调用方据此跳过重渲染）", (_why, from, to) => {
    const list = [card("p1"), card("p2")];
    expect(renameSpecPageCard(list, from, to)).toBe(list);
  });
});

describe("左栏芯片跟着改键", () => {
  it("改完之后问新 id 是已播报——所以 6.5 那批不会再播一遍", () => {
    const announced = new Set(["p1"]);
    expect(renameAnnouncedPage(announced, "p1", "seat_selection")).toBe(true);
    expect(announced.has("seat_selection")).toBe(true);
    expect(announced.has("p1")).toBe(false);
  });

  it("没播报过 from 就不许凭空把 to 塞进去", () => {
    // 塞进去的后果是**少一条**：这一页真到达时会被当成"播报过了"，
    // 左栏永远不出现它。方向跟重复相反，同样是错。
    const announced = new Set<string>(["p2"]);
    expect(renameAnnouncedPage(announced, "p1", "seat_selection")).toBe(false);
    expect(announced.has("seat_selection")).toBe(false);
    expect([...announced]).toEqual(["p2"]);
  });

  it.each([
    ["改成自己", "p1", "p1"],
    ["缺一头", "p1", ""],
  ])("%s 不算改名", (_why, from, to) => {
    const announced = new Set(["p1"]);
    expect(renameAnnouncedPage(announced, from, to)).toBe(false);
    expect([...announced]).toEqual(["p1"]);
  });
});

describe("接线：不许是没人叫的死代码", () => {
  const hook = load("../../useSlideRuleSession.ts");
  const driver = load("../../../../lib/sliderule-marathon-driver.ts");

  // ⚠ 钉**调用形状**，不是钉"名字出现过"。变异检查逼出来的：把
  //   `setSpecPages(prev => renameSpecPageCard(prev, from, to))` 改成
  //   `void renameSpecPageCard;`——函数成了死代码、真机照样出 12 张卡，
  //   而只 grep 名字的判据一片绿。两刀都是这么漏的。
  it.each([
    ["收到页面就 upsert", /setSpecPages\(\s*prev\s*=>\s*upsertSpecPageCard\(prev,\s*page\)/],
    [
      "收到改名就改卡的键",
      /setSpecPages\(\s*prev\s*=>\s*renameSpecPageCard\(prev,\s*from,\s*to\)/,
    ],
    ["收到改名就改芯片的键", /renameAnnouncedPage\(\s*announcedPages,\s*from,\s*to\s*\)/],
  ])("hook 真的调了：%s", (_what, shape) => {
    expect(hook).toMatch(shape);
  });

  it("hook 里不许再留一份手写的认卡逻辑", () => {
    // 两套并存是最糟的中间态：看着改了，实际说不清哪套在起作用。
    expect(hook).not.toMatch(/findIndex\(\s*p\s*=>\s*p\.pageId/);
  });

  it("驱动器把 spec_page_renamed 派发到 onSpecPageRenamed", () => {
    expect(driver).toContain('case "spec_page_renamed"');
    expect(driver).toContain("onSpecPageRenamed");
  });

  it("hook 接了 onSpecPageRenamed 这个回调", () => {
    expect(hook).toContain("onSpecPageRenamed:");
  });
});
