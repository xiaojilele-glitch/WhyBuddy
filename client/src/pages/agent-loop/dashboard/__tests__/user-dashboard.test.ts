/**
 * 本人 Dashboard 只吃归属过滤后的接口。变异：改去打 admin 清单必红。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const page = readFileSync(
  new URL("../UserDashboardPage.tsx", import.meta.url),
  "utf8"
);
const dashboard = readFileSync(
  new URL("../DashboardApp.tsx", import.meta.url),
  "utf8"
);

describe("UserDashboardPage", () => {
  it("正向：本人项目 / 会话 / 用量", () => {
    expect(page).toContain('listApps({ limit: 12, offset: 0, scope: "mine" })');
    expect(page).toContain("fetchSessionsList()");
    expect(page).toContain("/api/sliderule/usage");
    expect(page).toContain("进行中的项目");
    expect(page).toContain("最近运行");
    expect(page).toContain("用量");
    expect(page).toContain('data-testid="user-dashboard-page"');
    expect(page).toContain('data-testid="user-dashboard-stats"');
  });

  it("反向：不吃全站 admin 接口，也不复用 admin store", () => {
    const body = stripComments(page);
    expect(body).not.toContain("/account/admin");
    expect(body).not.toContain("/api/admin");
    expect(body).not.toContain("useAdminStore");
    expect(body).not.toContain("STAFF_USERS_PATH");
    expect(body).not.toContain("STAFF_APPS_PATH");
    expect(body).not.toContain("STAFF_SESSIONS_PATH");
    expect(body).not.toContain("最近用户");
  });

  it("超管才挂 StaffConsole，普通人走 UserDashboard", () => {
    const src = stripComments(page);
    expect(src).toContain("user?.isSuperuser");
    expect(src).toContain("<StaffConsolePage");
    expect(src).toContain("<UserDashboardPage");
    expect(stripComments(dashboard)).toContain("AccountDashboardPage");
    expect(stripComments(dashboard)).not.toContain("agent-nav-admin");
    expect(stripComments(dashboard)).not.toContain("<StaffConsolePage");
  });
});
