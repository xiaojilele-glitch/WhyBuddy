import { ChevronsLeft } from "lucide-react";
import { useLocation } from "wouter";

import {
  getActiveSidebarId,
  getSidebarNavItems,
  resolveSidebarHref,
  type SidebarNavigationItem,
} from "@/components/navigation-config";
import { SidebarStatusBlock } from "@/components/SidebarStatusBlock";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/lib/auth-store";
import { useProjectStore } from "@/lib/project-store";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@shared/auth";

type SidebarTone = "light" | "glass";

function SidebarHeader({
  collapsed,
  tone,
  locale,
}: {
  collapsed: boolean;
  tone: SidebarTone;
  locale: string;
}) {
  const glass = tone === "glass";
  const subtitle =
    locale === "zh-CN"
      ? "办公空间协同决策智能体平台"
      : "Collaborative agent office platform";

  return (
    <div
      className={cn(
        "flex h-[92px] shrink-0 items-center gap-3 px-4",
        collapsed && "justify-center px-2"
      )}
    >
      <span
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[15px] border bg-white shadow-sm",
          glass
            ? "border-white/80 shadow-[0_14px_34px_rgba(14,165,233,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]"
            : "border-sky-100 shadow-[0_14px_34px_rgba(14,165,233,0.14),inset_0_1px_0_rgba(255,255,255,0.96)]"
        )}
      >
        <img
          src="/brand/transLogo.png"
          alt="WhyBuddy"
          className="relative size-9 object-contain"
        />
      </span>
      {!collapsed ? (
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-[13px] font-black uppercase tracking-[0.16em]",
              glass ? "text-slate-700" : "text-slate-800"
            )}
          >
            WhyBuddy
          </span>
          <span className="mt-1.5 block truncate text-[11px] font-semibold leading-none text-slate-500">
            {subtitle}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function SidebarNavItem({
  item,
  href,
  active,
  collapsed,
  label,
  comingSoonLabel,
  onNavigate,
  tone,
}: {
  item: SidebarNavigationItem;
  href?: string;
  active: boolean;
  collapsed: boolean;
  label: string;
  comingSoonLabel: string;
  onNavigate: (href: string) => void;
  tone: SidebarTone;
}) {
  const isDisabled = item.disabled || !href;
  const Icon = item.icon;
  const glass = tone === "glass";

  const content = (
    <button
      type="button"
      onClick={() => {
        if (!isDisabled && href) {
          onNavigate(href);
        }
      }}
      disabled={isDisabled}
      aria-current={active ? "page" : undefined}
      data-sidebar-nav-state={active ? "active" : "idle"}
      data-sidebar-nav-tone={tone}
      className={cn(
        "group relative flex min-h-[52px] w-full items-center gap-3 overflow-hidden rounded-[18px] border px-3.5 py-3 text-[14px] font-bold transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30",
        collapsed && "size-12 justify-center px-0",
        glass &&
          "border-white/0 text-slate-500 hover:border-white/72 hover:bg-white/54 hover:text-slate-900 hover:shadow-[0_16px_30px_rgba(14,165,233,0.1),inset_0_1px_0_rgba(255,255,255,0.88)]",
        active
          ? "border-sky-200/82 bg-white/86 text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.18),0_6px_18px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.96)] hover:bg-white hover:text-slate-950"
          : !isDisabled &&
              !glass &&
              "border-transparent text-slate-500 hover:border-sky-100 hover:bg-white/70 hover:text-slate-900 hover:shadow-[0_12px_26px_rgba(14,165,233,0.1),inset_0_1px_0_rgba(255,255,255,0.86)]",
        isDisabled && "cursor-not-allowed text-slate-400 opacity-75"
      )}
    >
      <span
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-[13px] border transition-all duration-200",
          active
            ? "border-sky-200 bg-sky-50 text-sky-700 shadow-[0_0_0_4px_rgba(14,165,233,0.1)]"
            : "border-slate-200/70 bg-white/64 text-slate-500 group-hover:border-sky-100 group-hover:bg-sky-50/80 group-hover:text-sky-700",
          isDisabled && "border-slate-200 bg-slate-50 text-slate-300"
        )}
        data-sidebar-nav-icon=""
      >
        <Icon className="size-[17px] shrink-0" />
      </span>
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {active ? (
        <>
          <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.68)]" />
          <span className="pointer-events-none absolute inset-y-2 right-2 w-12 rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.22),transparent_68%)]" />
        </>
      ) : null}
    </button>
  );

  if (collapsed) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {label}
            {isDisabled ? (
              <span className="ml-1 text-xs opacity-60">
                ({comingSoonLabel})
              </span>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{content}</li>;
}

function getUserInitials(user: CurrentUser | null) {
  const source =
    user?.displayName?.trim() || user?.email.split("@")[0] || "Guest";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : source.slice(0, 2);

  return initials.toUpperCase();
}

function getUserRoleLabel(
  role: CurrentUser["role"] | undefined,
  isZh: boolean
) {
  if (!role) return isZh ? "访客" : "Guest";
  if (role === "super_admin") return isZh ? "超级管理员" : "Super Admin";
  if (role === "admin") return isZh ? "管理员" : "Admin";
  return isZh ? "普通用户" : "User";
}

function getUserStatusLabel(user: CurrentUser | null, isZh: boolean) {
  if (!user) return isZh ? "未登录" : "Signed out";
  if (user.status === "disabled") return isZh ? "已停用" : "Disabled";
  if (!user.emailVerified) return isZh ? "邮箱未验证" : "Email unverified";
  return isZh ? "已登录" : "Signed in";
}

function SidebarUserBlock({
  collapsed,
  tone,
  locale,
  currentUser,
}: {
  collapsed: boolean;
  tone: SidebarTone;
  locale: string;
  currentUser: CurrentUser | null;
}) {
  const glass = tone === "glass";
  const isZh = locale === "zh-CN";
  const displayName =
    currentUser?.displayName?.trim() ||
    currentUser?.email ||
    (isZh ? "未登录用户" : "Guest user");
  const email = currentUser?.email ?? (isZh ? "请先登录" : "Sign in required");
  const initials = getUserInitials(currentUser);
  const roleLabel = getUserRoleLabel(currentUser?.role, isZh);
  const statusLabel = getUserStatusLabel(currentUser, isZh);
  const avatar = (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border text-xs font-black text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
        glass ? "border-white/72 bg-white/56" : "border-sky-100 bg-sky-50"
      )}
    >
      {currentUser?.avatarUrl ? (
        <img
          src={currentUser.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );

  if (collapsed) {
    return (
      <div
        className="mx-auto mb-3 flex justify-center"
        data-sidebar-user-card={tone}
      >
        <Tooltip>
          <TooltipTrigger asChild>{avatar}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-semibold">{displayName}</span>
            <br />
            <span className="text-xs opacity-80">{email}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-[18px] border bg-white/58 px-3 py-3 shadow-[0_12px_28px_rgba(14,165,233,0.08),inset_0_1px_0_rgba(255,255,255,0.8)]",
        glass && "bg-white/42"
      )}
      data-sidebar-user-card={tone}
      style={{
        borderColor: glass
          ? "rgba(255, 255, 255, 0.6)"
          : "rgba(186, 230, 253, 0.72)",
      }}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-slate-800">
          {displayName}
        </div>
        <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
          {email}
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          <span className="truncate rounded-full border border-white/70 bg-white/52 px-2 py-0.5 text-[10px] font-black text-slate-600">
            {roleLabel}
          </span>
          <span className="truncate rounded-full bg-emerald-50/82 px-2 py-0.5 text-[10px] font-black text-emerald-600">
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  embedded?: boolean;
}

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  embedded = false,
}: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { locale, copy } = useI18n();
  const currentUser = useAuthStore(state => state.currentUser);
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const activeId = getActiveSidebarId(location);
  const sidebarTone: SidebarTone = embedded ? "glass" : "light";
  const isZh = locale === "zh-CN";
  const sidebarCopy = copy.sidebar;
  const visibleNavItems = getSidebarNavItems(location);

  const labelMap: Record<string, string> = {
    autopilot: isZh ? "自动驾驶" : sidebarCopy.autopilot,
    specs: isZh ? "推导" : "Deduction",
    tasks: isZh ? "任务中心" : sidebarCopy.tasks,
    projects: isZh ? "项目空间" : sidebarCopy.projects,
    knowledge: isZh ? "知识库" : sidebarCopy.knowledge,
    datasource: isZh ? "数据源" : sidebarCopy.datasource,
    dashboard: isZh ? "数据看板" : sidebarCopy.dashboard,
    marketplace: isZh ? "智能体市场" : sidebarCopy.marketplace,
    notifications: isZh ? "通知中心" : sidebarCopy.notifications,
    settings: isZh ? "设置与集成" : sidebarCopy.settings,
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r text-slate-800 backdrop-blur-2xl transition-[width] duration-[250ms] ease-in-out",
        sidebarTone === "glass"
          ? "shadow-[18px_0_58px_rgba(14,165,233,0.1),inset_-1px_0_0_rgba(255,255,255,0.72)]"
          : "shadow-[10px_0_34px_rgba(14,165,233,0.1),inset_-1px_0_0_rgba(255,255,255,0.86)]",
        embedded ? "relative h-full" : "fixed bottom-0 left-0 top-0 z-40"
      )}
      data-sidebar-mode={embedded ? "embedded" : "fixed"}
      data-sidebar-tone={sidebarTone}
      style={{
        width: collapsed ? 64 : 248,
        background: embedded
          ? "linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 252, 255, 0.66) 58%, rgba(236, 249, 255, 0.36) 100%)"
          : "linear-gradient(90deg, rgba(255, 255, 255, 0.98) 0%, rgba(244, 251, 255, 0.94) 100%)",
        borderColor: embedded
          ? "rgba(186, 230, 253, 0.48)"
          : "rgba(186, 230, 253, 0.68)",
        color: "#1e293b",
      }}
    >
      <SidebarHeader collapsed={collapsed} tone={sidebarTone} locale={locale} />

      <nav
        className={cn(
          "relative flex-1 overflow-y-auto py-4",
          collapsed ? "px-2" : "px-3.5"
        )}
        aria-label="Main navigation"
      >
        {!collapsed ? (
          <span className="pointer-events-none absolute bottom-8 left-[31px] top-5 w-px bg-gradient-to-b from-transparent via-sky-100/80 to-transparent" />
        ) : null}
        <ul role="list" className="relative flex flex-col gap-2.5">
          {visibleNavItems.map(item => {
            const href = resolveSidebarHref(item, location, currentProjectId);

            return (
              <SidebarNavItem
                key={item.id}
                item={item}
                href={href}
                active={item.id === activeId}
                collapsed={collapsed}
                label={labelMap[item.id] ?? item.id}
                comingSoonLabel={sidebarCopy.comingSoon}
                onNavigate={setLocation}
                tone={sidebarTone}
              />
            );
          })}
        </ul>
      </nav>

      <div className="flex shrink-0 justify-end px-3 py-1.5">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? sidebarCopy.expand : sidebarCopy.collapse}
          className="rounded-[13px] border border-transparent p-1.5 text-slate-500 transition-colors hover:border-sky-100 hover:bg-white/70 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"
        >
          <ChevronsLeft
            className={cn(
              "size-4 transition-transform duration-200",
              collapsed && "rotate-180"
            )}
          />
        </button>
      </div>

      <SidebarStatusBlock collapsed={collapsed} tone={sidebarTone} />

      <SidebarUserBlock
        collapsed={collapsed}
        tone={sidebarTone}
        locale={locale}
        currentUser={currentUser}
      />
    </aside>
  );
}
