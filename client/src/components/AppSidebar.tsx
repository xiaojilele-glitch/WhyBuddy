import { ChevronsLeft } from "lucide-react";
import { useLocation } from "wouter";

import {
  getActiveSidebarId,
  SIDEBAR_NAV_ITEMS,
  type SidebarNavigationItem,
} from "@/components/navigation-config";
import { SidebarStatusBlock } from "@/components/SidebarStatusBlock";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SidebarHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <span className="text-lg font-bold text-white/90">
        ◆
      </span>
      {!collapsed && (
        <span className="truncate text-sm font-semibold text-white/90">
          Cube Pets
        </span>
      )}
    </div>
  );
}

function SidebarNavItem({
  item,
  active,
  collapsed,
  label,
  comingSoonLabel,
  onNavigate,
}: {
  item: SidebarNavigationItem;
  active: boolean;
  collapsed: boolean;
  label: string;
  comingSoonLabel: string;
  onNavigate: (href: string) => void;
}) {
  const isDisabled = item.disabled || !item.href;
  const Icon = item.icon;

  const content = (
    <button
      type="button"
      onClick={() => {
        if (!isDisabled && item.href) {
          onNavigate(item.href);
        }
      }}
      disabled={isDisabled}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active && "bg-white/15 text-white",
        !active && !isDisabled && "text-white/70 hover:bg-white/10 hover:text-white/90",
        isDisabled && "cursor-not-allowed opacity-40 text-white/40",
      )}
    >
      {/* Active indicator bar */}
      {active && (
        <span
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-white"
        />
      )}
      <Icon className="size-5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {label}
            {isDisabled && <span className="ml-1 text-xs opacity-60">({comingSoonLabel})</span>}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{content}</li>;
}

function SidebarUserBlock({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t px-4 py-3"
      style={{ borderColor: "rgba(255,255,255,0.08)" }}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white/80"
      >
        U
      </div>
      {!collapsed && (
        <span className="truncate text-sm text-white/70">
          User
        </span>
      )}
    </div>
  );
}

function SidebarTaskStats() {
  return (
    <div
      className="flex shrink-0 items-center justify-around border-t px-4 py-2 text-xs text-white/50"
      style={{ borderColor: "rgba(255,255,255,0.08)" }}
    >
      <span>✓ 0</span>
      <span>▶ 0</span>
      <span>◻ 0</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
  const { copy } = useI18n();
  const activeId = getActiveSidebarId(location);
  const sidebarCopy = copy.sidebar;

  const labelMap: Record<string, string> = {
    autopilot: sidebarCopy.autopilot,
    tasks: sidebarCopy.tasks,
    projects: sidebarCopy.projects,
    knowledge: sidebarCopy.knowledge,
    datasource: sidebarCopy.datasource,
    dashboard: sidebarCopy.dashboard,
    marketplace: sidebarCopy.marketplace,
    notifications: sidebarCopy.notifications,
    settings: sidebarCopy.settings,
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r transition-[width] duration-[250ms] ease-in-out backdrop-blur-xl",
        embedded ? "relative h-full" : "fixed bottom-0 left-0 top-0 z-40",
      )}
      data-sidebar-mode={embedded ? "embedded" : "fixed"}
      style={{
        width: collapsed ? 64 : 240,
        backgroundColor: "rgba(22, 35, 63, 0.88)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        color: "rgba(255, 255, 255, 0.9)",
      }}
    >
      {/* Logo / Brand */}
      <SidebarHeader collapsed={collapsed} />

      {/* Navigation Items */}
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="主导航">
        <ul role="list" className="flex flex-col gap-0.5">
          {SIDEBAR_NAV_ITEMS.map(item => (
            <SidebarNavItem
              key={item.id}
              item={item}
              active={item.id === activeId}
              collapsed={collapsed}
              label={labelMap[item.id] ?? item.id}
              comingSoonLabel={sidebarCopy.comingSoon}
              onNavigate={setLocation}
            />
          ))}
        </ul>
      </nav>

      {/* Collapse Toggle */}
      <div className="flex shrink-0 justify-end px-2 py-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? sidebarCopy.expand : sidebarCopy.collapse}
          className="rounded-md p-1.5 transition-colors hover:bg-white/10"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          <ChevronsLeft
            className={cn("size-4 transition-transform duration-200", collapsed && "rotate-180")}
          />
        </button>
      </div>

      {/* Status Indicators */}
      <SidebarStatusBlock collapsed={collapsed} />

      {/* User Info */}
      <SidebarUserBlock collapsed={collapsed} />

      {/* Task Stats (hidden when collapsed) */}
      {!collapsed && <SidebarTaskStats />}
    </aside>
  );
}
