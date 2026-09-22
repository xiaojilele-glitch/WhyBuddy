/**
 * 连接器层静态渲染回归（2026-08-26 Cursor 列表市场）。
 *
 * 这一页最容易烂掉的方式不是版式，是**摆出一堆点了没反应的东西**：
 * 效果图上 24 个连接器，我们只有后端报上来的那几个。所以正向断言都配
 * 反向的——尤其"卡片数 === 传入清单"和"没有新建钮"。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectorsPanel } from "../ConnectorsPanel";
import type { ConnectorSpec } from "../connectors-client";

function spec(over: Partial<ConnectorSpec> & { id: string }): ConnectorSpec {
  return {
    name: over.id,
    description: `落成实体「${over.id}」的连接器`,
    entityId: `${over.id}_e`,
    entityName: over.id,
    source: "Open-Meteo",
    category: "出行生活",
    icon: over.id,
    available: true,
    args: [],
    fields: [],
    ...over,
  };
}

const WEATHER = spec({
  id: "weather",
  name: "天气",
  category: "出行生活",
  icon: "weather",
});
const STOCK = spec({
  id: "stock",
  name: "股票行情",
  category: "金融",
  icon: "chart",
  source: "新浪财经",
});

const noop = () => {};

function render(
  over: Partial<React.ComponentProps<typeof ConnectorsPanel>> = {}
) {
  return renderToStaticMarkup(
    <ConnectorsPanel
      connectors={[WEATHER, STOCK]}
      loading={false}
      attachedIds={[]}
      onUse={noop}
      onDetach={noop}
      {...over}
    />
  );
}

describe("连接器列表市场", () => {
  it("是列表不是四列墙；全部/已添加是互斥 tab；计数照实数", () => {
    const h = render();
    expect(h).toContain('data-testid="connectors-featured-list"');
    expect(h).toContain('data-testid="connector-view-all"');
    expect(h).toContain('data-testid="connector-mine"');
    expect(h).not.toContain("xl:grid-cols-4");
    expect(h).toContain("2 个");
    expect(h).toContain('data-connector="weather"');
    expect(h).toContain('data-connector="stock"');
  });

  it("反向：没有「新建」、没有页内二次菜单、不摆我们没有的连接器", async () => {
    const h = render();
    expect(h).not.toContain("新建");
    expect(h).not.toContain("钉钉");
    expect(h).not.toContain("飞书");
    expect(h).not.toContain("Notion");
    const src = await import("../ConnectorsPanel?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).not.toContain('data-testid="capability-tab"');
    expect(src).toContain("from \"./marketplace-chrome\"");
  });

  it("分类条不重复「全部/精选」；已添加在全部右侧", () => {
    const h = render();
    const cats = [...h.matchAll(/data-cat="([^"]+)"/g)].map(m => m[1]);
    expect(cats).toEqual(["出行生活", "金融"]);
    expect(cats).not.toContain("精选");
    expect(cats).not.toContain("全部");
    const allPos = h.indexOf('data-testid="connector-view-all"');
    const minePos = h.indexOf('data-testid="connector-mine"');
    const catsPos = h.indexOf('data-testid="connector-cats"');
    expect(minePos).toBeGreaterThan(allPos);
    expect(catsPos).toBeGreaterThan(minePos);
  });

  it("「已添加」只列出这一轮挂着的，不把全部再铺一遍", () => {
    const all = render({ attachedIds: ["weather"] });
    expect(all).toContain('data-connector="weather"');
    expect(all).toContain('data-connector="stock"');
    const mine = render({ attachedIds: ["weather"], initialMine: true });
    expect(mine).toContain('data-connector="weather"');
    expect(mine).not.toContain('data-connector="stock"');
    const empty = render({ attachedIds: [], initialMine: true });
    expect(empty).toContain("这一轮还没挂任何连接器");
    expect(empty).not.toContain('data-testid="connectors-featured-list"');
  });
});
