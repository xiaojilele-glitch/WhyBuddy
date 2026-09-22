/**
 * 外壳会话栏折叠。对照 ChatGPT：收起留下图标轨，最近会话点开是浮层。
 *
 * 推演页嵌在 /agent-loop/sliderule 里，会话栏在 DashboardApp，
 * 展开/收起键也在侧栏顶上——跨树，靠这份 context + localStorage。
 *
 * ⚠ 2026-08-18 曾经折成宽 0。顶栏那颗键撤了之后没有展开入口，
 * 只好强制摊开，还写了「不要留半残侧栏」。2026-09-20 用户对照
 * ChatGPT 要回展开收起：钮回到侧栏里，收起是 56px 图标轨，
 * 不是裁成 48px 还露半截字的半残栏，也不是宽 0。
 */

export const SHELL_SIDEBAR_KEY = "sliderule:shell-sidebar-collapsed";

/**
 * 展开态侧栏宽。与 `dashboard.css` `.native-agent-sidebar` 的
 * `width` / `flex: 0 0 252px` 同数。改一处忘一处会让「对话栏 = 侧栏×2」
 * 对不上真机菜单。
 */
export const SHELL_SIDEBAR_WIDTH_PX = 252;

/** 收起态图标轨宽。与 `dashboard.css` 折叠规则同数。 */
export const SHELL_SIDEBAR_RAIL_PX = 56;

export function shellSidebarOccupiedPx(collapsed: boolean): number {
  return collapsed ? SHELL_SIDEBAR_RAIL_PX : SHELL_SIDEBAR_WIDTH_PX;
}

export function readShellSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SHELL_SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShellSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SHELL_SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* 隐私模式：记不住就本页有效 */
  }
}
