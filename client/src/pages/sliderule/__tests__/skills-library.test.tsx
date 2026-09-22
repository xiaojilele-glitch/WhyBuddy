/**
 * 技能库静态渲染回归。
 *
 * 原本这里有 5 条断言锁的是「社区技能」层：合规标注、渠道分档筛选、
 * 索引表格行、语义档案安装钮。该层连同 889 条论坛索引、855 份完整
 * SKILL.md 正文、543 份语义档案一并下架（协议敞口 + 装了绑不上 aigc
 * 硬契约），断言随之移除，并留一条哨兵防止数据被重新引入。
 *
 * 2026-08-26 第二次：四列卡片墙换成 Cursor 列表市场。tab / 统计卡 /
 * 一行四个那批断言换成列表结构，并且每条正向断言都配一条反向的——
 * 这一页历史上出过两次"名单里有名字但埋点没了"。
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsLibraryPage } from "../SkillsLibraryPage";
import { CapabilityLibraryPage } from "../CapabilityLibraryPage";

import featuredSkills from "@/data/featured-skills.json";

const ITEMS = (
  featuredSkills as {
    items: Array<{ id: string; name: string; author: string; category: string }>;
  }
).items;

/** node 环境没有 localStorage；已安装那一段只能靠它喂。 */
function stubStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(() => stubStorage());

describe("SkillsLibraryPage · 目录", () => {
  const html = () => renderToStaticMarkup(<SkillsLibraryPage />);

  it("是列表市场，不是四列卡片墙；行上是真数据（名字/作者/分类）", () => {
    const h = html();
    expect(h).toContain('data-testid="skills-featured-list"');
    expect(h).not.toContain("xl:grid-cols-4");
    expect(h).not.toContain('data-testid="skills-featured-grid"');
    const first = ITEMS[0];
    expect(h).toContain(`data-testid="featured-skill-${first.id}"`);
    expect(h).toContain(`${first.category} · ${first.author}`);
    expect(h).toContain('data-testid="skill-meta"');
    expect(h).toContain('data-testid="skills-search"');
    expect(h).toContain('data-testid="skills-mine"');
    expect(h).toContain(`${ITEMS.length} 项`);
  });

  it("旧版式的卡片墙、段标题、二次菜单都已撤掉", () => {
    const h = html();
    expect(h).not.toContain('data-testid="skills-tab-featured"');
    expect(h).not.toContain('data-testid="skills-tab-installed"');
    expect(h).not.toContain('data-testid="skills-stat-精选技能"');
    expect(h).not.toContain('data-testid="skills-section-featured"');
    expect(h).not.toContain('data-testid="capability-tab"');
    // 换上的是 Cursor 那种全部 / 已安装
    expect(h).toContain('data-testid="skills-view-all"');
    expect(h).toContain('data-testid="skills-mine"');
  });

  it("分类条只列数据里真有的分类 —— 效果图上那几个我们没有的不许摆", () => {
    const h = html();
    expect(h).toContain('data-testid="skills-cats"');
    const cats = [...h.matchAll(/data-cat="([^"]+)"/g)].map(m => m[1]);
    const real = new Set(ITEMS.map(i => i.category));
    // 「全部」只出现在 view tab 上一次，分类条不再铺一颗同名的
    expect(cats).not.toContain("全部");
    expect(h).toContain('data-testid="skills-view-all"');
    // 顺序：全部 → 已安装（我的）→ 分类。两排等于又把全部铺一遍。
    const allPos = h.indexOf('data-testid="skills-view-all"');
    const minePos = h.indexOf('data-testid="skills-mine"');
    const catsPos = h.indexOf('data-testid="skills-cats"');
    expect(minePos).toBeGreaterThan(allPos);
    expect(catsPos).toBeGreaterThan(minePos);
    expect(h).toContain('class="contents"');
    for (const c of cats) {
      expect(real.has(c), `分类条上的「${c}」在数据里一条技能都没有`).toBe(true);
    }
    expect(cats.length).toBe(real.size);
    // 效果图上的分类（我们没有对应技能），摆上去点进去必然是空的
    for (const fake of ["金融", "法律", "办公协作", "设计开发"]) {
      expect(h).not.toContain(`data-cat="${fake}"`);
    }
  });

  it("没有「新建技能」/ Popular / 假下载数——没有的东西不摆", () => {
    const h = html();
    expect(h).not.toContain("新建技能");
    expect(h).not.toContain("Add Skill");
    expect(h).not.toContain("Popular");
    expect(h).not.toMatch(/data-testid="skill-downloads"/);
  });

  it("每张卡都标出消费通道 —— 装之前就该知道装了会发生什么", () => {
    const h = html();
    expect(h).toContain('data-testid="skill-channel-aigc"');
    expect(h).toContain('data-testid="skill-channel-experience"');
    // unbound 的 31 条已于 2026-07-27 下架（装了不产出任何东西），目录里
    // 不该再有；渲染代码仍支持这个通道，存量安装记录要靠它兜底。
    expect(h).not.toContain('data-testid="skill-channel-unbound"');
    // 「精选」金标只说来源不说用途，已被通道标替掉
    expect(h).not.toContain(">精选<");
  });

  it("图标是真图稿，每张卡一个，且没有一个落到兜底星", () => {
    const h = html();
    const icons = [...h.matchAll(/data-testid="skill-icon"/g)];
    expect(icons.length).toBe(ITEMS.length);
    expect(h).not.toContain('data-art="fallback"');
    expect(h).toContain("linearGradient");
  });

  it("反向：字母头像已经不在了（换成图稿不是「两套并存」）", async () => {
    const src = await import("../SkillsLibraryPage?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).not.toContain("avatarToneOf");
    expect(src).toContain("SkillIcon");
  });

  it("哨兵：社区技能的四份数据不得被重新引入", async () => {
    // 直接 import 已删的 JSON 会在编译期失败，这里断言源码不再引用它们——
    // 重新加回来必须是显式决定（连带重新承担协议敞口），不能悄悄回归。
    const src = await import("../SkillsLibraryPage?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).not.toContain("trae-skills-index.json");
    expect(src).not.toContain("skill-semantics.json");
  });

  it("扩展中心根上没有二次菜单——切层只走侧栏", async () => {
    const src = await import("../CapabilityLibraryPage?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).toContain('data-testid="capability-library"');
    expect(src).not.toContain('data-testid="capability-tab"');
    const h = renderToStaticMarkup(<CapabilityLibraryPage />);
    expect(h).toContain('data-testid="capability-library"');
    expect(h).toContain('data-layer="skills"');
    expect(h).not.toContain('data-testid="capability-tab"');
  });

  it("三层共用 marketplace-chrome，不再各画一套壳", async () => {
    const files = await Promise.all([
      import("../SkillsLibraryPage?raw"),
      import("../ConnectorsPanel?raw"),
      import("../PartnersPanel?raw"),
    ]);
    for (const m of files) {
      const src = (m as unknown as { default: string }).default;
      expect(src).toContain("from \"./marketplace-chrome\"");
      expect(src).not.toContain("xl:grid-cols-4");
    }
  });
});

describe("SkillsLibraryPage · 我的技能", () => {
  it("一条没装时：只出空态引导，不再把全部技能也铺一遍", () => {
    const h = renderToStaticMarkup(<SkillsLibraryPage initialMine />);
    expect(h).toContain("还没安装技能");
    expect(h).not.toContain('data-testid="skills-featured-list"');
    expect(h).toContain('data-testid="skills-installed"');
  });

  it("装过之后：已安装段列出它，卡上有试跑入口，目录里那张也翻成已装", () => {
    const target = ITEMS[0];
    stubStorage({
      "sliderule:installed-skills": JSON.stringify([
        {
          repo: `trae-market/${target.id}`,
          url: "",
          license: "官方市场",
          name: target.name,
          description: "装过的那条",
          ioHints: [],
          installedAt: "2026-08-26T00:00:00.000Z",
          kind: "semantic",
          channel: "experience",
        },
      ]),
    });
    const allView = renderToStaticMarkup(<SkillsLibraryPage />);
    // 全部列表里同一行要翻成"已安装"，否则用户会以为没装上又装一遍
    const card = allView.slice(
      allView.indexOf(`data-testid="featured-skill-${target.id}"`)
    );
    expect(card.slice(0, 280)).toContain('data-installed="1"');
    const other = ITEMS.find(i => i.id !== target.id)!;
    const otherCard = allView.slice(
      allView.indexOf(`data-testid="featured-skill-${other.id}"`)
    );
    expect(otherCard.slice(0, 280)).toContain('data-installed="0"');
    // 已安装 tab 才出现试跑入口——全部列表不再把已装的再铺一段
    expect(allView).not.toContain(
      `data-testid="installed-skill-trae-market/${target.id}"`
    );

    const mine = renderToStaticMarkup(<SkillsLibraryPage initialMine />);
    expect(mine).toContain(
      `data-testid="installed-skill-trae-market/${target.id}"`
    );
    expect(mine).toContain('data-testid="skills-installed"');
    expect(mine).toContain('data-testid="installed-skill-toggle"');
  });

  it("已安装的卡用的是目录里那条的分类图稿，不是兜底星", () => {
    const target = ITEMS[0];
    stubStorage({
      "sliderule:installed-skills": JSON.stringify([
        {
          repo: `trae-market/${target.id}`,
          url: "",
          license: "官方市场",
          name: target.name,
          description: "装过的那条",
          ioHints: [],
          installedAt: "2026-08-26T00:00:00.000Z",
          kind: "semantic",
        },
      ]),
    });
    const h = renderToStaticMarkup(<SkillsLibraryPage initialMine />);
    const seg = h.slice(h.indexOf('data-testid="skills-installed"'));
    expect(seg).toContain(`data-art="${target.category}"`);
    expect(seg.slice(0, 900)).not.toContain('data-art="fallback"');
  });
});
