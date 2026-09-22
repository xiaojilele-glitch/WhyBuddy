import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/skill-store-client", () => ({
  fetchSkillCatalog: async () => [
    {
      id: "sliderule",
      slug: "sliderule",
      name: "SlideRule 出 SPEC",
      description: "出规格，不是写应用默认技能。",
      version: "1.0.0",
      license: "MIT",
      category: "规格",
      installed: false,
    },
  ],
  postSkillInstall: async () => undefined,
  postSkillUninstall: async () => undefined,
}));

const SAMPLE = [
  {
    id: "sliderule",
    slug: "sliderule",
    name: "SlideRule 出 SPEC",
    description: "出规格，不是写应用默认技能。",
    version: "1.0.0",
    category: "规格",
    installed: false,
  },
  {
    id: "office-skills",
    slug: "office-skills",
    name: "Office 出文件",
    description: "做 Word、Excel、PPT、PDF。",
    version: "1.0.0",
    category: "办公",
    installed: false,
  },
  {
    id: "mcp-builder",
    slug: "mcp-builder",
    name: "MCP builder",
    description: "按指南搭 MCP 服务器。",
    version: "1.0.0",
    category: "开发工具",
    installed: false,
  },
  {
    id: "webapp-testing",
    slug: "webapp-testing",
    name: "Webapp testing",
    description: "用 Playwright 测本地网页。",
    version: "1.0.0",
    category: "测试",
    installed: true,
  },
];

describe("SkillStorePage", () => {
  it("不写 localStorage 安装，也不引用 featured-skills", async () => {
    const src = readFileSync(new URL("../SkillStorePage.tsx", import.meta.url), "utf8");
    const code = src
      .split(/\r?\n/)
      .filter(line => !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toContain("sliderule:installed-skills");
    expect(code).not.toContain("featured-skills");
    expect(code).toContain("postSkillInstall");
    expect(code).toContain("目录加载中");
    expect(code).toContain("setLoading(false)");
    expect(code).not.toContain("上传技能");
    expect(code).not.toContain("MarketRow");
    expect(code).not.toContain("layout=\"gallery\"");
    expect(code).not.toContain("subtitle");
  });

  it("列出完整包而不是语义档案墙", async () => {
    const { SkillStorePage } = await import("../SkillStorePage");
    const html = renderToStaticMarkup(<SkillStorePage />);
    expect(html).toContain("data-testid=\"skill-store-page\"");
    expect(html).toContain("skill-store-search");
    expect(html).toContain("skill-store-tab-all");
    expect(html).not.toContain("data-layout=\"gallery\"");
    expect(html).not.toContain("挑完整技能包");
    expect(html).not.toContain("xl:grid-cols-4");
    expect(html).not.toContain("上传技能");
  });

  it("货架按索引分类铺三列扁卡，不造空分类", async () => {
    const { SkillStoreGrid } = await import("../SkillStorePage");
    const html = renderToStaticMarkup(
      <SkillStoreGrid skills={SAMPLE} busy={null} onToggle={() => undefined} />,
    );
    expect(html).toContain("data-testid=\"market-card-grid\"");
    expect(html).toContain("xl:grid-cols-3");
    expect(html).not.toContain("xl:grid-cols-4");
    expect(html).toContain("data-testid=\"skill-store-section-规格\"");
    expect(html).toContain("data-testid=\"skill-store-section-办公\"");
    expect(html).toContain("data-testid=\"skill-store-section-开发工具\"");
    expect(html).toContain("data-testid=\"skill-store-section-测试\"");
    expect(html.indexOf("skill-store-section-规格")).toBeLessThan(
      html.indexOf("skill-store-section-办公"),
    );
    expect(html).toContain("data-testid=\"skill-store-row-sliderule\"");
    expect(html).toContain("data-testid=\"skill-store-row-office-skills\"");
    expect(html).toContain("+ 安装");
    expect(html).toContain("已装");
    expect(html).not.toContain("界面设计");
    expect(html).not.toContain("内容创作");
  });
});
