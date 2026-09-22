/**
 * 伙伴层静态渲染回归（2026-08-26 按效果图重做版式）。
 *
 * 这一页最容易烂掉的方式不是版式，是**摆出一堆点了没反应的东西**：
 * 效果图上有四十个职业名的伙伴，我们只有 3 个真的能一键装配起来的。
 * 所以每条正向断言都配一条反向的——尤其"缺依赖时按不动**并且说出缺什么**"
 * 和"不许出现我们没有的伙伴"。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PartnersPanel } from "../PartnersPanel";
import { BUILTIN_PARTNERS, type Partner } from "../partners";
import type { ConnectorSpec } from "../connectors-client";

function spec(over: Partial<ConnectorSpec> & { id: string }): ConnectorSpec {
  return {
    name: over.id,
    description: "",
    entityId: `${over.id}_e`,
    entityName: over.id,
    source: "x",
    category: "未分类",
    icon: over.id,
    available: true,
    args: [],
    fields: [],
    ...over,
  };
}

const WEATHER = spec({ id: "weather", category: "出行生活", icon: "weather" });
const STOCK = spec({ id: "stock", category: "金融", icon: "chart" });

const noop = () => {};

function render(over: Partial<React.ComponentProps<typeof PartnersPanel>> = {}) {
  return renderToStaticMarkup(
    <PartnersPanel
      custom={[]}
      connectors={[WEATHER, STOCK]}
      skillKeys={[]}
      attachedKeys={[]}
      turnCaps={[]}
      onUse={noop}
      onSave={noop}
      onDelete={noop}
      {...over}
    />
  );
}

describe("伙伴墙", () => {
  it("是列表不是四列墙；内置的三个都在，计数照实数", () => {
    const h = render();
    expect(h).not.toContain("xl:grid-cols-4");
    for (const p of BUILTIN_PARTNERS) {
      expect(h).toContain(`data-partner="${p.id}"`);
    }
    expect(h).toContain(`${BUILTIN_PARTNERS.length} 个`);
    expect(h).toContain('data-testid="partner-search"');
    expect(h).toContain('data-testid="partner-mine"');
    expect(h).toContain('data-testid="partner-view-all"');
  });

  it("反向：效果图上那几十个我们没有的伙伴，一个都不许摆", () => {
    const h = render();
    for (const fake of [
      "数据分析师",
      "PPT 制作专家",
      "UI 设计师",
      "AI 画师",
      "HR 招聘助手",
    ]) {
      expect(h, `摆了一个接不上任何东西的「${fake}」`).not.toContain(fake);
    }
    // 卡片数 === 真伙伴数，不多不少
    const cards = [...h.matchAll(/data-testid="partner-card"/g)];
    expect(cards.length).toBe(BUILTIN_PARTNERS.length);
  });

  it("头像由它接的连接器拼出来（两样都接的出双图），不是人像照片", () => {
    const h = render();
    expect(h).toContain('data-icons="weather"');
    expect(h).toContain('data-icons="chart"');
    // 晨会看板接了天气 + 行情
    expect(h).toContain('data-icons="weather+chart"');
    // 反向：整页没有任何外链图片（人像是最容易被"补"进来的东西）
    expect(h).not.toContain("<img");
  });

  it("依赖齐 → 按得动且不显示「还缺」；缺了 → 按不动且说出缺什么", () => {
    const ok = render();
    expect(ok).not.toContain('data-testid="partner-missing"');
    /* ⚠ 判据钉 `disabled=""` 这个**属性**，不能钉 "disabled" 这个词——
       按钮的 class 里有 tailwind 的 `disabled:cursor-not-allowed`，
       钉词的话正反两种情况都命中，这条断言等于没写（第一版就栽在这）。 */
    expect(ok).not.toMatch(/data-testid="partner-use"[^>]*?disabled=""/);

    // 后端只报上来天气：接行情的两个伙伴必须瘫掉并说明
    const partial = render({ connectors: [WEATHER] });
    expect(partial).toContain('data-testid="partner-missing"');
    expect(partial).toContain("还缺：股票行情");
    expect(partial).toMatch(/data-testid="partner-use"[^>]*?disabled=""/);
    expect(partial).toContain('data-ready="0"');
    // 天气那个还是好的——不能一缺就全瘫
    expect(partial).toContain('data-partner="weather-desk"');
    expect(
      partial.slice(partial.indexOf('data-partner="weather-desk"'), partial.indexOf('data-partner="weather-desk"') + 120)
    ).toContain('data-ready="1"');
  });

  it("分类条从连接器自己声明的 category 汇出来；只有一种时不画", () => {
    const h = render();
    const cats = [...h.matchAll(/data-cat="([^"]+)"/g)].map(m => m[1]);
    expect(cats).toEqual(["出行生活", "金融"]);
    expect(cats).not.toContain("全部");
    expect(h).toContain('data-testid="partner-view-all"');
    const allPos = h.indexOf('data-testid="partner-view-all"');
    const minePos = h.indexOf('data-testid="partner-mine"');
    const catsPos = h.indexOf('data-testid="partner-cats"');
    expect(minePos).toBeGreaterThan(allPos);
    expect(catsPos).toBeGreaterThan(minePos);
    // 效果图上的分类我们一个伙伴都对不上，不许摆
    for (const fake of ["办公提效", "产品研发", "电商运营", "人力资源"]) {
      expect(h).not.toContain(`data-cat="${fake}"`);
    }
    // 只剩一个连接器时，全部伙伴只有一种分类 → 这条筛选条什么也筛不动，不画
    const one = render({ connectors: [WEATHER] });
    expect(one).not.toContain('data-testid="partner-cats"');
  });
});

describe("存成我的伙伴（把半截活接上）", () => {
  it("这一轮没挂能力 → 按不动；挂了 → 能按", () => {
    /* ⚠ 钉的是开标签上的 disabled 属性，不是 class 里的 disabled:cursor。
       属性顺序不保证：antd Button 把 data-testid 放前面，原生 button 把
       disabled 放前面——按「testid 在前」写正则，换标签就假红。 */
    const saveOpen = (h: string) =>
      h.match(/<button\b[^>]*data-testid="partner-save-open"[^>]*>/)?.[0] ?? "";
    expect(saveOpen(render())).toMatch(/\bdisabled=/);

    const withCaps = render({
      turnCaps: [
        { key: "weather", kind: "connector", name: "天气", description: "" },
      ],
    });
    expect(saveOpen(withCaps)).not.toMatch(/\bdisabled=/);
  });

  it("空态那句话有对应的入口 —— 它曾经教了一条走不通的路", async () => {
    const src = await import("../PartnersPanel?raw").then(
      m => (m as unknown as { default: string }).default
    );
    // 空态在教"回这里存"，那就必须真的存得下来：入口 + 真正的构造函数
    expect(src).toContain("存成伙伴");
    expect(src).toContain("partnerFromCurrent");
  });

  it("我攒的伙伴：单独一段、可删；内置的不给删钮", () => {
    const mine: Partner = {
      id: "p-1",
      name: "我的小队",
      description: "天气 + 股票行情",
      needs: [
        { kind: "connector", key: "weather", name: "天气" },
        { kind: "connector", key: "stock", name: "股票行情" },
      ],
      opener: "做一张板",
    };
    const h = render({ custom: [mine] });
    expect(h).toContain('data-testid="partners-mine"');
    expect(h).toContain('data-partner="p-1"');
    // 删钮只出现一次 —— 内置那三个不给删
    const dels = [...h.matchAll(/data-testid="partner-delete"/g)];
    expect(dels.length).toBe(1);
    expect(h).toContain(`${BUILTIN_PARTNERS.length + 1} 个`);
  });

  it("「我的伙伴」只看自己攒的：内置那段整段收起", () => {
    const all = render();
    expect(all).toContain('data-testid="partners-builtin"');
    expect(all).toContain('data-testid="partner-view-all"');
    // 互斥 tab：切到「我的」内置那段整段不在，不是再点一次「我的」就切回去
    const mine = render({ initialMine: true });
    expect(mine).not.toContain('data-testid="partners-builtin"');
    expect(mine).toContain("还没攒过伙伴");
    expect(mine).not.toContain('data-partner="weather-desk"');
  });
});

describe("已挂上", () => {
  it("这一轮已经挂着它全部依赖时，圆钮翻成已挂；只挂了一半不算", () => {
    const flag = (h: string, id: string) =>
      /data-attached="(\d)"/.exec(
        h.slice(h.indexOf(`data-partner="${id}"`))
      )?.[1];

    const full = render({
      attachedKeys: ["connector:weather", "connector:stock"],
    });
    expect(flag(full, "weather-market")).toBe("1");
    expect(flag(full, "weather-desk")).toBe("1");

    // 晨会看板要两样，只挂了天气 → 不算已挂（半套等于没装配起来）
    const half = render({ attachedKeys: ["connector:weather"] });
    expect(flag(half, "weather-market")).toBe("0");
    expect(flag(half, "weather-desk")).toBe("1");
  });
});
