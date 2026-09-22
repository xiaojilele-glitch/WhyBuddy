/**
 * 超管全站台。入口在账号菜单 Dashboard，不在侧栏。
 * 二级仍是：总览 / 用户 / 项目 / 运行 / 失败 / 审计。
 *
 * 普通人进同一入口走 UserDashboardPage，不挂这页。
 * 旧书签 /agent-loop/admin 仍解析到这套二级路径。
 */
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  FolderKanban,
  Search,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";

import { useAuth } from "@/lib/use-auth";

import { AdminAuditPage } from "./Audit";
import { AdminFailuresPage } from "./Failures";
import { AdminOverviewPage } from "./Overview";
import { AdminProjectsPage } from "./Projects";
import { AdminRunsPage } from "./Runs";
import { AdminUsersPage } from "./Users";

export const STAFF_CONSOLE_PATH = "/agent-loop/admin";

export type StaffSection =
  | "overview"
  | "users"
  | "projects"
  | "runs"
  | "failures"
  | "audit";

type StaffNavItem = {
  id: StaffSection;
  label: string;
  keywords: string;
  icon: ReactNode;
};

export const STAFF_NAV_ITEMS: StaffNavItem[] = [
  {
    id: "overview",
    label: "总览",
    keywords: "summary 用户 项目",
    icon: <BarChart3 className="h-4 w-4" />,
  },
  {
    id: "users",
    label: "用户",
    keywords: "停用 恢复 超管 用量",
    icon: <Users className="h-4 w-4" />,
  },
  {
    id: "projects",
    label: "项目",
    keywords: "项目 应用 Projects",
    icon: <FolderKanban className="h-4 w-4" />,
  },
  {
    id: "runs",
    label: "运行",
    keywords: "执行 推演 Runs",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    id: "failures",
    label: "失败",
    keywords: "失败 错误 Failures",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  {
    id: "audit",
    label: "审计",
    keywords: "审计 日志 Audit",
    icon: <ClipboardList className="h-4 w-4" />,
  },
];

const STAFF_SECTION_IDS = new Set<string>(STAFF_NAV_ITEMS.map(item => item.id));

export function getStaffConsolePath(section: StaffSection = "overview"): string {
  return section === "overview"
    ? STAFF_CONSOLE_PATH
    : `${STAFF_CONSOLE_PATH}/${section}`;
}

export function parseStaffSection(location: string): StaffSection {
  const raw = (location || "").split(/[?#]/, 1)[0] || "";
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  if (
    path === STAFF_CONSOLE_PATH ||
    path === "/admin" ||
    path === "/agent-loop/dashboard"
  ) {
    return "overview";
  }
  const prefixes = [`${STAFF_CONSOLE_PATH}/`, "/admin/"];
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (STAFF_SECTION_IDS.has(rest)) return rest as StaffSection;
    }
  }
  return "overview";
}

function navMatches(item: StaffNavItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.label} ${item.keywords}`.toLowerCase().includes(q);
}

function useSafeLocation(): [string, (next: string) => void] {
  if (typeof window === "undefined" || typeof location === "undefined") {
    return [STAFF_CONSOLE_PATH, () => undefined];
  }
  return useLocation();
}

export function StaffConsolePage() {
  const { user, ready } = useAuth();
  const [location, setLocation] = useSafeLocation();
  const [query, setQuery] = useState("");
  const section = parseStaffSection(location);
  const visibleNav = useMemo(
    () => STAFF_NAV_ITEMS.filter(item => navMatches(item, query)),
    [query]
  );

  if (!ready) {
    return (
      <p className="px-8 py-8 text-[13px] text-[#737373]" data-testid="sliderule-staff-console">
        正在确认登录状态…
      </p>
    );
  }

  if (!user?.isSuperuser) {
    return (
      <p className="px-8 py-8 text-[13px] text-[#737373]" data-testid="sliderule-staff-console">
        管理台只对超管开放。
      </p>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)]"
      data-testid="sliderule-staff-console"
      aria-label="Dashboard"
    >
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col border-r border-black/[0.06] px-3 py-3">
          <label className="mb-2 flex items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#a3a3a3]" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索"
              data-testid="sliderule-staff-search"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#171717] outline-none placeholder:text-[#a3a3a3]"
            />
          </label>
          <div className="flex flex-col gap-0.5">
            {visibleNav.map(item => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLocation(getStaffConsolePath(item.id))}
                  data-testid={`sliderule-staff-nav-${item.id}`}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition ${
                    active
                      ? "bg-black/[0.06] text-[#171717]"
                      : "text-[#5c5c5c] hover:bg-black/[0.04] hover:text-[#171717]"
                  }`}
                >
                  <span className="opacity-70">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
            {visibleNav.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] text-[#a3a3a3]">没有匹配的项</p>
            ) : null}
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConfigProvider locale={zhCN}>
            <div className="mx-auto w-full max-w-[1280px] px-8 py-8">
            {section === "users" ? (
              <AdminUsersPage embedded />
            ) : section === "projects" ? (
              <AdminProjectsPage />
            ) : section === "runs" ? (
              <AdminRunsPage />
            ) : section === "failures" ? (
              <AdminFailuresPage />
            ) : section === "audit" ? (
              <AdminAuditPage />
            ) : (
              <AdminOverviewPage />
            )}
            </div>
            </ConfigProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
