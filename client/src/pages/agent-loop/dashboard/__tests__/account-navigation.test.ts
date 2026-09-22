import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("../DashboardApp.tsx", import.meta.url),
  "utf8"
);
const accountPanelSource = readFileSync(
  new URL("../AccountPanel.tsx", import.meta.url),
  "utf8"
);
const dashboardCss = readFileSync(
  new URL("../dashboard.css", import.meta.url),
  "utf8"
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function cssBlocks(src: string, selector: string): string[] {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  return [...stripComments(src).matchAll(re)].map(m => m[1]);
}

describe("侧栏账号导航", () => {
  /*
   * ⚠ 2026-08-26 这条曾经钉「扩展中心在主导航 + 账号菜单」。
   *   2026-09-19 工厂货架从主导航摘掉：装了也不进控制面。
   *   正向：应用市场还在。反向：扩展中心 / 组件库 / 账号快捷入口不许回来。
   */
  it("主导航留应用市场和技能商店，扩展中心和组件库不进菜单", () => {
    const nav = stripComments(dashboardSource);
    const groups = nav.slice(
      nav.indexOf("export const NAV_GROUPS"),
      nav.indexOf("const NAV_ITEM_TESTID")
    );
    expect(groups).toContain('label: "应用市场"');
    expect(groups).toContain('label: "技能"');
    expect(groups).toContain('key: "skills"');
    expect(groups).not.toContain('label: "扩展中心"');
    expect(groups).not.toContain('label: "组件库"');
    expect(groups).not.toContain('key: "components"');
    expect(groups).not.toContain('label: "设置"');
    expect(groups).not.toContain('label: "系统"');
    expect(groups).not.toContain('label: "管理台"');
    expect(groups).not.toContain('key: "settings"');
    expect(groups).not.toContain('key: "admin"');
    expect(accountPanelSource).not.toContain('data-testid="account-skills"');
    expect(accountPanelSource).not.toContain(
      'onClick={go("/agent-loop/skills")}'
    );
  });

  it("Dashboard / 设置 / 帮助进账号菜单，不走旧 /admin 整页刷新", () => {
    const panel = stripComments(accountPanelSource);
    expect(panel).toContain('data-testid="account-dashboard"');
    expect(panel).toContain(">Dashboard<");
    expect(panel).toContain('data-testid="account-settings"');
    expect(panel).toContain(">设置<");
    expect(panel).toContain('data-testid="account-help"');
    expect(panel).toContain(">帮助<");
    expect(panel).toContain("onOpenView");
    expect(panel).not.toContain("window.location.href = href");
    expect(panel).not.toContain('data-testid="account-admin"');
    expect(panel).not.toContain('onClick={go("/admin")}');
    expect(panel).not.toContain('go("/agent-loop/settings")');
  });

  it("没有下级时不画假箭头；有下级时整行都能开合", () => {
    const src = stripComments(dashboardSource);
    const at = src.indexOf("if (item.children)");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(at, at + 220);
    expect(around).toContain("prev === item.key ? null : item.key");
    expect(around).not.toMatch(/if \(item\.children\) setOpenKey\(item\.key\)/);
  });
});

describe("侧栏底栏 · Cursor 尺度", () => {
  it("底栏只留账号触发行，帮助不在 dock 里重复", () => {
    const start = dashboardSource.indexOf("native-agent-footer");
    const end = dashboardSource.indexOf("</aside>");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dock = dashboardSource.slice(start, end);
    expect(dock).toContain("<AccountPanel");
    expect(dock).not.toContain("sidebar-help-docs");
    expect(stripComments(dock)).not.toContain("帮助文档");
    expect(dock).not.toContain("RightOutlined");
    expect(accountPanelSource).toContain('className="native-agent-user');
  });

  it("账号行不是描边卡片", () => {
    const user = cssBlocks(dashboardCss, ".native-agent-user");
    expect(user.length).toBeGreaterThan(0);
    expect(user.some(b => /border:\s*1px/.test(b))).toBe(false);
    expect(user.some(b => /border:\s*0/.test(b))).toBe(true);

    const userCss = user.join(" ");
    expect(userCss).toMatch(/padding:\s*6px var\(--dock-pad\)/);
    expect(userCss).toMatch(/height:\s*auto/);
    expect(userCss).not.toMatch(/(?<![a-z-])height:\s*36px/);

    const footer = cssBlocks(dashboardCss, ".native-agent-footer");
    expect(footer.some(b => /border-top/.test(b))).toBe(true);
    expect(footer.some(b => /--dock-slot:\s*20px/.test(b))).toBe(true);
    expect(footer.some(b => /padding:\s*8px 0 0/.test(b))).toBe(true);
    expect(footer.some(b => /padding:\s*10px 0 4px/.test(b))).toBe(false);
  });

  it("头像占 dock 槽，账号行不再写已登录", () => {
    expect(accountPanelSource).toContain("native-agent-dock-slot");
    expect(stripComments(accountPanelSource)).not.toContain("已登录");
  });

  it("超管档位写 Admin，头像是纯色圆不是蓝青渐变", () => {
    const panel = stripComments(accountPanelSource);
    expect(panel).toContain(">Admin<");
    expect(panel).not.toContain("管理员");
    const avatar = cssBlocks(dashboardCss, ".native-agent-user-avatar").join(" ");
    expect(avatar).not.toMatch(/linear-gradient/);
    expect(avatar).toMatch(/background:\s*#e4e4e7/);
    expect(avatar).toMatch(/color:\s*#52525b/);
    const name = cssBlocks(dashboardCss, ".native-agent-user-name").join(" ");
    expect(name).not.toMatch(/#0f172a/);
    expect(name).toMatch(/#52525b/);
  });
});

describe("侧栏图标左轨", () => {
  /*
   * ⚠ 2026-09-20 真机：技能图标 left=24，新建会话/缩略图 left=20。
   * 后置「样式版」又写了一遍 nav-item { padding:0 12px; height:44px }，
   * 把 8-26 压过的 36 行高盖掉。正向：三区读同一条 --rail-pad。
   * 反向：不许再出现第二份 12/44 覆盖。
   */
  it("导航会话底栏读同一条 8px 左轨，后置样式版不许把导航改高", () => {
    const sidebar = cssBlocks(dashboardCss, ".native-agent-sidebar").join(" ");
    expect(sidebar).toMatch(/--rail-pad:\s*8px/);
    expect(sidebar).toMatch(/--rail-icon:\s*16px/);

    const nav = cssBlocks(dashboardCss, ".native-agent-nav-item");
    expect(nav.length).toBe(1);
    expect(nav[0]).toMatch(/padding:\s*0 var\(--rail-pad\)/);
    expect(nav[0]).toMatch(/height:\s*36px/);
    expect(nav[0]).not.toMatch(/height:\s*44px/);
    expect(nav[0]).not.toMatch(/padding:\s*0 12px/);

    const sessions = cssBlocks(dashboardCss, ".native-agent-sessions").join(" ");
    expect(sessions).toMatch(/--session-pad:\s*var\(--rail-pad\)/);
    expect(sessions).toMatch(/--session-icon:\s*var\(--rail-icon\)/);

    const footer = cssBlocks(dashboardCss, ".native-agent-footer").join(" ");
    expect(footer).toMatch(/--dock-pad:\s*var\(--rail-pad\)/);
  });
});
