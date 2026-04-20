import {
  BriefcaseBusiness,
  FileSearch,
  FolderKanban,
  HelpCircle,
  LayoutGrid,
  type LucideIcon,
  Settings2,
  Shield,
} from "lucide-react";

export type PrimaryNavigationId = "office" | "more";
export type MainPathId = "office" | "tasks";
export type MoreNavigationId =
  | "config"
  | "permissions"
  | "audit"
  | "help";
export type DebugTab =
  | "overview"
  | "config"
  | "permissions"
  | "audit"
  | "lineage"
  | "help";

export interface NavigationItem<TId extends string> {
  id: TId;
  icon: LucideIcon;
  href?: string;
}

export const LEGACY_COMMAND_CENTER_PATH = "/command-center";
export const LEGACY_COMMAND_CENTER_LEGACY_PATH = "/command-center/legacy";
export const DEBUG_PATH = "/debug";
export const DEBUG_CONFIG_PATH = "/debug/config";
export const DEBUG_PERMISSIONS_PATH = "/debug/permissions";
export const DEBUG_AUDIT_PATH = "/debug/audit";
export const DEBUG_LINEAGE_PATH = "/debug/lineage";
export const DEBUG_HELP_PATH = "/debug/help";
export const LEGACY_LINEAGE_PATH = "/lineage";
export const OFFICE_PATH = "/";
export const REPLAY_PATH_PREFIX = "/replay";

export function getReplayPath(missionId: string): string {
  return `${REPLAY_PATH_PREFIX}/${missionId}`;
}

function normalizeNavigationPath(path: string): string {
  const trimmed = path.trim();
  const [pathname] = trimmed.split(/[?#]/, 1);
  return pathname || "/";
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  const pathname = normalizeNavigationPath(path);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getDebugPath(tab: DebugTab): string {
  switch (tab) {
    case "config":
      return DEBUG_CONFIG_PATH;
    case "permissions":
      return DEBUG_PERMISSIONS_PATH;
    case "audit":
      return DEBUG_AUDIT_PATH;
    case "lineage":
      return DEBUG_LINEAGE_PATH;
    case "help":
      return DEBUG_HELP_PATH;
    default:
      return DEBUG_PATH;
  }
}

export function resolveDebugTab(path: string): DebugTab {
  if (matchesPathPrefix(path, DEBUG_CONFIG_PATH)) return "config";
  if (matchesPathPrefix(path, DEBUG_PERMISSIONS_PATH)) return "permissions";
  if (matchesPathPrefix(path, DEBUG_AUDIT_PATH)) return "audit";
  if (matchesPathPrefix(path, DEBUG_LINEAGE_PATH)) return "lineage";
  if (matchesPathPrefix(path, DEBUG_HELP_PATH)) return "help";
  return "overview";
}

export function getCompatibilityRedirect(path: string): string | null {
  if (matchesPathPrefix(path, LEGACY_COMMAND_CENTER_LEGACY_PATH)) {
    return OFFICE_PATH;
  }

  if (matchesPathPrefix(path, LEGACY_COMMAND_CENTER_PATH)) {
    return OFFICE_PATH;
  }

  if (matchesPathPrefix(path, LEGACY_LINEAGE_PATH)) {
    return DEBUG_LINEAGE_PATH;
  }

  return null;
}

export const PRIMARY_NAV_ITEMS: Array<NavigationItem<PrimaryNavigationId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "more",
    icon: LayoutGrid,
  },
];

export const MAIN_PATH_ITEMS: Array<NavigationItem<MainPathId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "tasks",
    icon: FolderKanban,
    href: "/tasks",
  },
];

export const MORE_NAV_ITEMS: Array<NavigationItem<MoreNavigationId>> = [
  {
    id: "config",
    icon: Settings2,
    href: DEBUG_CONFIG_PATH,
  },
  {
    id: "permissions",
    icon: Shield,
    href: DEBUG_PERMISSIONS_PATH,
  },
  {
    id: "audit",
    icon: FileSearch,
    href: DEBUG_AUDIT_PATH,
  },
  {
    id: "help",
    icon: HelpCircle,
    href: DEBUG_HELP_PATH,
  },
];

export function isLowFrequencyPath(path: string) {
  return (
    matchesPathPrefix(path, DEBUG_PATH) ||
    matchesPathPrefix(path, LEGACY_LINEAGE_PATH) ||
    matchesPathPrefix(path, LEGACY_COMMAND_CENTER_PATH)
  );
}

export function getPrimaryNavigationId(path: string): PrimaryNavigationId {
  if (isLowFrequencyPath(path)) return "more";
  return "office";
}
