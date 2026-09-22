/**
 * 技能图标图稿。
 *
 * 两个重点：
 *   1. **兜底**——认不出的分类要画一颗中性的星，不空白、不破图、不抛。
 *   2. **哨兵**——数据里每个真实分类都得有自己的图稿。新增分类忘了配图
 *      时这条会红；不然页面上会静悄悄冒出一片一模一样的星，而"全都长一样"
 *      恰恰是没人会去报的那种 bug。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SkillIcon, hasSkillArt } from "../skill-art/skill-icons";
import featuredSkills from "@/data/featured-skills.json";

const ITEMS = (featuredSkills as { items: Array<{ category: string }> }).items;
const CATEGORIES = [...new Set(ITEMS.map(i => i.category))];

describe("认得出的图稿", () => {
  it("数据里每个分类都有自己的图稿，没有一个落到兜底", () => {
    expect(CATEGORIES.length).toBeGreaterThan(1);
    for (const cat of CATEGORIES) {
      expect(hasSkillArt(cat), `分类「${cat}」没有配图稿`).toBe(true);
      expect(renderToStaticMarkup(<SkillIcon category={cat} />)).toContain(
        `data-art="${cat}"`
      );
    }
  });

  it("每个分类画的是不同的图——同一张图配十个名字等于没配", () => {
    const seen = new Map<string, string>();
    for (const cat of CATEGORIES) {
      const svg = renderToStaticMarkup(<SkillIcon category={cat} />);
      const dup = [...seen.entries()].find(([, html]) => html === svg);
      expect(dup?.[0], `「${cat}」跟「${dup?.[0]}」画得一模一样`).toBeUndefined();
      seen.set(cat, svg);
    }
  });

  it("是真图稿（多色 svg），不是字体图标也不是字母头像", () => {
    const html = renderToStaticMarkup(<SkillIcon category={CATEGORIES[0]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("linearGradient");
    expect(html).toMatch(/stop-color|stopColor/i);
  });

  it("渐变 id 各不相同 —— 一页几十张卡同时在 DOM 里，id 撞了后面全套第一张的色", () => {
    const ids = CATEGORIES.flatMap(cat =>
      [
        ...renderToStaticMarkup(<SkillIcon category={cat} />).matchAll(
          /<linearGradient id="([^"]+)"/g
        ),
      ].map(m => m[1])
    );
    expect(ids.length).toBe(CATEGORIES.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("兜底", () => {
  it("商店「办公」货架有自己的图稿，不落到星", () => {
    expect(hasSkillArt("办公")).toBe(true);
    expect(renderToStaticMarkup(<SkillIcon category="办公" />)).toContain(
      'data-art="办公"'
    );
  });

  it("认不出的分类 → 画星，不空白也不抛", () => {
    const html = renderToStaticMarkup(<SkillIcon category="还没配图稿的分类" />);
    expect(html).toContain('data-art="fallback"');
    expect(html).toContain("<svg");
    expect(hasSkillArt("还没配图稿的分类")).toBe(false);
  });

  it("没有分类（已安装的存量记录里就没存分类）同样兜底", () => {
    expect(renderToStaticMarkup(<SkillIcon />)).toContain('data-art="fallback"');
    expect(hasSkillArt(undefined)).toBe(false);
  });
});
