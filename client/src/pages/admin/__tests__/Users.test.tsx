/**
 * 超管用户表必须接在 Python 身份接口上。
 * 把停用按钮改去打 /api/admin 或删掉 停用，这条要红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("AdminUsersPage", () => {
  it("自己不能停、普通用户能停，用量列在场", () => {
    const src = readFileSync(new URL("../Users.tsx", import.meta.url), "utf8");
    expect(src).toContain("停用");
    expect(src).toContain("恢复");
    expect(src).toContain("不能停用自己");
    expect(src).toContain("不能停用其他超管");
    expect(src).toContain("estimatedTokens");
    expect(src).toContain("admin-users-search");
    expect(src).toContain("self || superuser");
    expect(src).toContain("staffSeenAt");
    expect(src).toContain("最后活动");
  });

  it("列表走 ProTable，长文本省略号和分页是组件自带的", () => {
    const page = readFileSync(new URL("../Users.tsx", import.meta.url), "utf8");
    const projects = readFileSync(new URL("../Projects.tsx", import.meta.url), "utf8");
    const runs = readFileSync(new URL("../Runs.tsx", import.meta.url), "utf8");
    expect(page).toContain("ProTable");
    expect(page).toContain("ellipsis");
    expect(page).toContain("staffPagination");
    expect(projects).toContain("ProTable");
    expect(projects).toContain("ellipsis: true");
    expect(runs).toContain("ProTable");
    expect(page).not.toContain("StaffPager");
    expect(projects).not.toContain("StaffEllipsis");
  });
});

describe("staff users live path", () => {
  it("页面和 store 都打 Python 身份接口", () => {
    const page = readFileSync(new URL("../Users.tsx", import.meta.url), "utf8");
    const store = readFileSync(
      new URL("../../../lib/admin-store.ts", import.meta.url),
      "utf8"
    );
    expect(page).toContain("/api/sliderule/account/admin/users");
    expect(store).toContain("STAFF_USERS_PATH");
    expect(store).toContain("/api/sliderule/account/admin/users");
    expect(store).toContain('method: "PATCH"');
    expect(store).toContain("lastActiveAt");
    const loadUsers = store.slice(
      store.indexOf("async loadUsers"),
      store.indexOf("async loadProjects")
    );
    expect(loadUsers).not.toContain("/api/admin/users");
    const loadOverview = stripComments(
      store.slice(
        store.indexOf("async loadOverview"),
        store.indexOf("async setUserActive")
      )
    );
    expect(loadOverview).toContain("fetchStaffUsers");
    expect(loadOverview).toContain("STAFF_APPS_PATH");
    expect(loadOverview).toContain("STAFF_SESSIONS_PATH");
    expect(loadOverview).toContain("inventorySummary");
    expect(loadOverview).not.toContain("/api/admin/users");
    expect(loadOverview).not.toContain("/api/admin/summary");
    expect(loadOverview).not.toContain("/api/admin/projects");
    const loadProjects = stripComments(
      store.slice(
        store.indexOf("async loadProjects"),
        store.indexOf("async loadRuns")
      )
    );
    expect(loadProjects).toContain("STAFF_APPS_PATH");
    expect(loadProjects).not.toContain("/api/admin/projects");
    const consoleSrc = readFileSync(
      new URL("../StaffConsolePage.tsx", import.meta.url),
      "utf8"
    );
    expect(consoleSrc).toContain("AdminUsersPage");
    expect(consoleSrc).toContain('section === "users"');
    expect(consoleSrc).not.toContain("SettingsDialog");
    const projects = readFileSync(
      new URL("../Projects.tsx", import.meta.url),
      "utf8"
    );
    expect(stripComments(projects)).not.toContain("/api/admin/projects");
    expect(projects).toContain("admin-projects-search");
    const runs = readFileSync(new URL("../Runs.tsx", import.meta.url), "utf8");
    expect(stripComments(runs)).not.toContain("/api/admin/runs");
    expect(runs).toContain("admin-runs-search");
  });
});
