/**
 * 侧栏展开/收起。对照 ChatGPT：收起是图标轨，最近会话点开浮层。
 *
 * ⚠ 2026-08-18 折成宽 0 且顶栏钮撤了，只能强制摊开。2026-09-20 反过来。
 * 正向：钮在侧栏里、折叠是 56px、context 读 localStorage。
 * 反向：不许再 width:0 / 强制摊开。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SHELL_SIDEBAR_RAIL_PX } from "../shell-sidebar-layout";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const dashboard = stripComments(
  readFileSync(
    new URL("../../agent-loop/dashboard/DashboardApp.tsx", import.meta.url),
    "utf8"
  )
);
const sessions = stripComments(
  readFileSync(
    new URL("../../agent-loop/dashboard/SidebarSessions.tsx", import.meta.url),
    "utf8"
  )
);
const css = stripComments(
  readFileSync(
    new URL("../../agent-loop/dashboard/dashboard.css", import.meta.url),
    "utf8"
  )
);
const ctx = stripComments(
  readFileSync(new URL("../ShellSidebarContext.tsx", import.meta.url), "utf8")
);

describe("侧栏 ChatGPT 式展开收起", () => {
  it("展开收起键在侧栏顶，不在顶栏", () => {
    expect(dashboard).toContain('data-testid="sidebar-collapse-toggle"');
    expect(dashboard).toContain("展开侧栏");
    expect(dashboard).toContain("收起侧栏");
    expect(dashboard).toContain("native-agent-brand-row");
    const hud = stripComments(
      readFileSync(new URL("../SlideRuleTopHud.tsx", import.meta.url), "utf8")
    );
    expect(hud).not.toContain("sidebar-collapse-toggle");
    expect(hud).not.toContain("useShellSidebar");
  });

  it("收起是 56px 图标轨，不是折没", () => {
    const at = css.indexOf(
      '.native-agent-shell[data-sidebar-collapsed="true"] .native-agent-sidebar'
    );
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at) + 1);
    expect(block).toContain(`flex: 0 0 ${SHELL_SIDEBAR_RAIL_PX}px`);
    expect(block).toContain(`width: ${SHELL_SIDEBAR_RAIL_PX}px`);
    expect(block).not.toMatch(/width:\s*0/);
    expect(block).not.toMatch(/opacity:\s*0/);
    expect(block).not.toMatch(/pointer-events:\s*none/);
    expect(block).not.toMatch(/flex-basis:\s*0/);
    // antd 图标也是 span。藏 > span 会把应用市场/技能图标一起藏掉。
    expect(css).not.toMatch(
      /data-sidebar-collapsed="true"\] \.native-agent-nav-item > span,/
    );
    expect(css).toContain(
      'data-sidebar-collapsed="true"] .native-agent-nav-item > .native-agent-rail-copy'
    );
  });

  it("最近会话在收起态走浮层，展开不再强制摊开", () => {
    expect(sessions).toContain("sidebar-session-recents");
    expect(sessions).toContain("native-agent-session-flyout");
    expect(sessions).toContain("useShellSidebar");
    expect(ctx).toContain("readShellSidebarCollapsed");
    expect(ctx).not.toContain("writeShellSidebarCollapsed(false)");
    expect(ctx).not.toContain("setCollapsed(false)");
  });
});
