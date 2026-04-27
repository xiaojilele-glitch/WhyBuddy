import { ChevronsLeft } from "lucide-react";
import { useLocation } from "wouter";

import {
  getActiveSidebarId,
  SIDEBAR_NAV_ITEMS,
  type SidebarNavigationItem,
} from "@/components/navigation-config";
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
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4" style={{ borderColor: "var(--sidebar-border)" }}>
      <span className="text-lg font-bold" style={{ color: "var(--sidebar-primary)" }}>
        ◆
      </span>
      {!collapsed && (
        <span className="truncate text-sm font-semibold" style={{ color: "var(--sidebar-foreground)" }}>
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
        active && "text-[var(--sidebar-primary-foreground)]",
        !active && !isDisabled && "hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]",
        isDisabled && "cursor-not-allowed opacity-50",
      )}
      style={active ? { backgroundColor: "var(--sidebar-primary)", color: "var(--sidebar-primary-foreground)" } : { color: "var(--sidebar-foreground)" }}
    >
      {/* Active indicator bar */}
      {active && (
        <span
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r"
          style={{ backgroundColor: "var(--sidebar-primary-foreground)" }}
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
      style={{ borderColor: "var(--sidebar-border)" }}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ backgroundColor: "var(--sidebar-accent)", color: "var(--sidebar-accent-foreground)" }}
      >
        U
      </div>
      {!collapsed && (
        <span className="truncate text-sm" style={{ color: "var(--sidebar-foreground)" }}>
          User
        </span>
      )}
    </div>
  );
}

function SidebarTaskStats() {
  return (
    <div
      className="flex shrink-0 items-center justify-around border-t px-4 py-2 text-xs"
      style={{ borderColor: "var(--sidebar-border)", color: "var(--sidebar-foreground)" }}
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
}

export function AppSidebar({ collapsed, onToggleCollapse }: AppSidebarProps) {
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
      className="fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r transition-[width] duration-[250ms] ease-in-out"
      style={{
        width: collapsed ? 64 : 240,
        backgroundColor: "var(--sidebar)",
        borderColor: "var(--sidebar-border)",
        color: "var(--sidebar-foreground)",
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
          className="rounded-md p-1.5 transition-colors hover:bg-[var(--sidebar-accent)]"
          style={{ color: "var(--sidebar-foreground)" }}
        >
          <ChevronsLeft
            className={cn("size-4 transition-transform duration-200", collapsed && "rotate-180")}
          />
        </button>
      </div>

      {/* User Info */}
      <SidebarUserBlock collapsed={collapsed} />

      {/* Task Stats (hidden when collapsed) */}
      {!collapsed && <SidebarTaskStats />}
    </aside>
  );
}
