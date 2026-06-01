import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState, locationState, projectState } = vi.hoisted(() => ({
  authState: {
    currentUser: null as {
      id: string;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
      role: "user" | "admin" | "super_admin";
      status: "active" | "disabled";
      emailVerified: boolean;
      createdAt: string;
    } | null,
  },
  locationState: {
    current: "/projects",
    setLocation: vi.fn(),
  },
  projectState: {
    currentProjectId: "project-1" as string | null,
  },
}));

import { useAuthStore } from "@/lib/auth-store";

import { AppSidebar } from "../AppSidebar";

vi.mock("wouter", () => ({
  useLocation: () => [locationState.current, locationState.setLocation],
}));

vi.mock("@/lib/project-store", () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

vi.mock("@/lib/auth-store", () => {
  const useAuthStore = ((selector: (state: typeof authState) => unknown) =>
    selector(authState)) as typeof import("@/lib/auth-store").useAuthStore;

  useAuthStore.getState = () =>
    ({
      ...authState,
      resetForTest: () => {
        authState.currentUser = null;
      },
    }) as ReturnType<typeof useAuthStore.getState>;

  useAuthStore.setState = partial => {
    Object.assign(
      authState,
      typeof partial === "function" ? partial(authState as never) : partial
    );
  };

  return { useAuthStore };
});

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "en-US",
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
  beforeEach(() => {
    useAuthStore.getState().resetForTest();
    locationState.current = "/projects";
    locationState.setLocation.mockClear();
    projectState.currentProjectId = "project-1";
  });

  it("uses relative full-height layout when rendered inside UE overlay chrome", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} embedded />
    );

    const aside = markup.match(/<aside[^>]*>/)?.[0] ?? "";

    expect(aside).toContain('data-sidebar-mode="embedded"');
    expect(aside).toContain("relative");
    expect(aside).toContain("h-full");
    expect(aside).not.toContain("fixed");
    expect(aside).not.toContain("left-0 top-0 bottom-0");
  });

  it("marks embedded sidebar as a transparent glass surface for the home scene", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} embedded />
    );

    const aside = markup.match(/<aside[^>]*>/)?.[0] ?? "";

    expect(aside).toContain('data-sidebar-tone="glass"');
    expect(aside).toContain('data-sidebar-mode="embedded"');
    expect(aside).toContain("background:linear-gradient");
    expect(aside).toContain("width:248px");
    expect(aside).toContain("rgba(255, 255, 255, 0.9)");
    expect(aside).toContain("rgba(236, 249, 255, 0.36)");
    expect(aside).not.toContain("rgba(22, 35, 63");
    expect(aside).not.toContain("text-white");
  });

  it("renders the embedded active item as a bright future-glass control", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} embedded />
    );

    expect(markup).toContain('data-sidebar-nav-tone="glass"');
    expect(markup).toContain('data-sidebar-nav-state="active"');

    const activeButton =
      markup.match(/<button[^>]*data-sidebar-nav-state="active"[^>]*>/)?.[0] ??
      "";

    expect(activeButton).toContain("bg-white/86");
    expect(activeButton).toContain("rounded-[18px]");
    expect(activeButton).toContain("border-sky-200/82");
    expect(activeButton).toContain("shadow-[0_18px_40px_rgba(14,165,233,0.18)");
    expect(markup).toContain('data-sidebar-nav-icon=""');
    expect(markup).toContain("bg-sky-400");
    expect(markup).not.toContain("bg-slate-900");
    expect(activeButton).not.toContain("bg-emerald-50");
  });

  it("keeps fixed sidebar light, fixed, and expanded near the reference width", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} />
    );

    const aside = markup.match(/<aside[^>]*>/)?.[0] ?? "";

    expect(aside).toContain('data-sidebar-tone="light"');
    expect(aside).toContain('data-sidebar-mode="fixed"');
    expect(aside).toContain("fixed");
    expect(aside).toContain("width:248px");
    expect(aside).toContain("background:linear-gradient");
    expect(aside).toContain("rgba(255, 255, 255, 0.98)");
    expect(aside).toContain("rgba(244, 251, 255, 0.94)");
    expect(markup).toContain('/brand/transLogo.png');
    expect(markup).toContain("WhyBuddy");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it("shows the signed-in user in the lower sidebar instead of placeholder task counts", () => {
    useAuthStore.setState({
      currentUser: {
        id: "user-1",
        email: "operator@example.com",
        displayName: "Operator One",
        avatarUrl: null,
        role: "admin",
        status: "active",
        emailVerified: true,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} embedded />
    );

    expect(markup).toContain('data-sidebar-user-card="glass"');
    expect(markup).toContain("Operator One");
    expect(markup).toContain("operator@example.com");
    expect(markup).toContain("Admin");
    expect(markup).toContain("Signed in");
    expect(markup).not.toContain("OK 0");
    expect(markup).not.toContain("Run 0");
    expect(markup).not.toContain("Idle 0");
  });

  it("keeps collapsed sidebar usable and exposes collapsed aria state", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar collapsed onToggleCollapse={() => {}} />
    );

    const aside = markup.match(/<aside[^>]*>/)?.[0] ?? "";

    expect(aside).toContain('data-sidebar-tone="light"');
    expect(aside).toContain("width:64px");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("keeps the project-space sidebar focused on the single project entry", () => {
    useAuthStore.setState({
      currentUser: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: null,
        role: "user",
        status: "active",
        emailVerified: true,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} />
    );

    expect(markup).toContain(">Projects<");
    expect(markup).not.toContain(">Admin<");
    expect(markup).not.toContain(">Tasks<");
    expect(markup).not.toContain(">Autopilot<");
    expect(markup).not.toContain(">Settings<");
    expect(markup).not.toContain("/admin");
  });

  it("switches to project-internal workbench navigation after entering a project", () => {
    locationState.current = "/autopilot";

    useAuthStore.setState({
      currentUser: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: null,
        role: "user",
        status: "active",
        emailVerified: true,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const markup = renderToStaticMarkup(
      <AppSidebar collapsed={false} onToggleCollapse={() => {}} />
    );

    expect(markup).toContain(">Autopilot<");
    expect(markup).toContain(">Tasks<");
    expect(markup).not.toContain(">Projects<");
    expect(markup).toContain(">Knowledge<");
    expect(markup).toContain(">Data<");
    expect(markup).toContain(">Dashboard<");
    expect(markup).toContain(">Marketplace<");
    expect(markup).toContain(">Notifications<");
    expect(markup).toContain(">Settings<");
    expect(markup).toContain('data-sidebar-nav-state="active"');
    expect(markup).toContain('aria-current="page"');
  });
});
