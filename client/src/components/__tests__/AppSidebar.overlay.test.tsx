import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "../AppSidebar";

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    copy: {
      sidebar: {
        autopilot: "Autopilot",
        tasks: "Tasks",
        projects: "Projects",
        knowledge: "Knowledge",
        datasource: "Data",
        dashboard: "Dashboard",
        marketplace: "Marketplace",
        notifications: "Notifications",
        settings: "Settings",
        comingSoon: "soon",
        expand: "Expand sidebar",
        collapse: "Collapse sidebar",
      },
    },
  }),
}));

vi.mock("../SidebarStatusBlock", () => ({
  SidebarStatusBlock: ({ collapsed }: { collapsed: boolean }) => (
    <div data-testid="sidebar-status" data-collapsed={collapsed} />
  ),
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("AppSidebar overlay embedding", () => {
  it("uses relative full-height layout when rendered inside UE overlay chrome", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} embedded />,
    );

    const aside = markup.match(/<aside[^>]*>/)?.[0] ?? "";

    expect(aside).toContain('data-sidebar-mode="embedded"');
    expect(aside).toContain("relative");
    expect(aside).toContain("h-full");
    expect(aside).not.toContain("fixed");
    expect(aside).not.toContain("left-0 top-0 bottom-0");
  });
});
