/**
 * 管理台在侧栏一级（超管才有），二级是总览/用户/项目/运行/失败/审计。
 * 写回设置级联或对所有人露出侧栏项，这两条要红。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AuthUser } from "@/lib/auth-client";

import {
  parseStaffSection,
  STAFF_NAV_ITEMS,
  StaffConsolePage,
} from "../StaffConsolePage";

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as AuthUser | null,
    ready: true,
  },
}));

vi.mock("@/lib/use-auth", () => ({
  useAuth: () => ({
    user: authState.user,
    ready: authState.ready,
    capabilities: {
      loggedIn: Boolean(authState.user),
      isSuperuser: Boolean(authState.user?.isSuperuser),
      can: {
        browse: true,
        viewApp: true,
        fork: Boolean(authState.user),
        drive: Boolean(authState.user),
        manageOwn: Boolean(authState.user),
      },
    },
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  displayName: "User One",
  isSuperuser: false,
  isVerified: true,
  createdAt: "2026-08-21T00:00:00.000Z",
};

describe("parseStaffSection", () => {
  it("认工作台路径和旧 /admin 书签", () => {
    expect(parseStaffSection("/agent-loop/admin")).toBe("overview");
    expect(parseStaffSection("/agent-loop/dashboard")).toBe("overview");
    expect(parseStaffSection("/agent-loop/admin/users")).toBe("users");
    expect(parseStaffSection("/agent-loop/admin/audit")).toBe("audit");
    expect(parseStaffSection("/admin")).toBe("overview");
    expect(parseStaffSection("/admin/users")).toBe("users");
    expect(parseStaffSection("/agent-loop/settings")).toBe("overview");
  });
});

describe("StaffConsolePage", () => {
  beforeEach(() => {
    authState.user = null;
    authState.ready = true;
  });

  it("普通用户看不到二级菜单", () => {
    authState.user = user;
    const html = renderToStaticMarkup(<StaffConsolePage />);
    expect(html).toContain("管理台只对超管开放");
    expect(html).not.toContain('data-testid="sliderule-staff-nav-users"');
  });

  it("超管二级就是总览/用户/项目/运行/失败/审计", () => {
    authState.user = { ...user, isSuperuser: true };
    const html = renderToStaticMarkup(<StaffConsolePage />);
    expect(html).toContain('data-testid="sliderule-staff-console"');
    expect(STAFF_NAV_ITEMS.map(item => item.label)).toEqual([
      "总览",
      "用户",
      "项目",
      "运行",
      "失败",
      "审计",
    ]);
    expect(html).not.toContain(">Projects<");
    expect(html).not.toContain(">Audit<");
    for (const item of STAFF_NAV_ITEMS) {
      expect(html).toContain(`data-testid="sliderule-staff-nav-${item.id}"`);
      expect(html).toContain(item.label);
    }
    expect(html).toContain('data-testid="admin-overview-page"');
    expect(html).not.toContain('data-testid="admin-users-page"');
  });

  it("总览对照 ant-design-pro 工作台：指标在页头横排，不是内容区竖卡", () => {
    const overview = readFileSync(new URL("../Overview.tsx", import.meta.url), "utf8");
    expect(overview).toContain("extraContent");
    expect(overview).toContain("<Statistic");
    expect(overview).toContain("Card.Grid");
    expect(overview).toContain("xl={16}");
    expect(overview).toContain("xl={8}");
    expect(overview).toContain("进行中的项目");
    expect(overview.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")).not.toContain(
      "StatisticCard"
    );
    authState.user = { ...user, isSuperuser: true };
    const html = renderToStaticMarkup(<StaffConsolePage />);
    expect(html).toContain('data-testid="admin-overview-stats"');
    expect(html).toContain("进行中的项目");
    expect(html).toContain("最近运行");
    expect(html).toContain("最近用户");
  });
});

describe("管理台入口不在设置里", () => {
  it("设置页没有管理台分组，全站台只在超管 Dashboard 里", () => {
    const settings = readFileSync(
      new URL("../../sliderule/SettingsDialog.tsx", import.meta.url),
      "utf8"
    );
    const dashboard = readFileSync(
      new URL("../../agent-loop/dashboard/DashboardApp.tsx", import.meta.url),
      "utf8"
    );
    const account = readFileSync(
      new URL("../../agent-loop/dashboard/AccountPanel.tsx", import.meta.url),
      "utf8"
    );
    const userDash = readFileSync(
      new URL("../../agent-loop/dashboard/UserDashboardPage.tsx", import.meta.url),
      "utf8"
    );
    expect(settings).not.toContain("STAFF_NAV_ITEMS");
    expect(settings).not.toContain("AdminUsersPage");
    expect(dashboard).toContain("AccountDashboardPage");
    expect(dashboard).not.toContain("agent-nav-admin");
    expect(account).toContain("account-dashboard");
    expect(userDash).toContain("isSuperuser");
    expect(userDash).toContain("StaffConsolePage");
  });
});
