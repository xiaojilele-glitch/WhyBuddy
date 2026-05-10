import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectState } = vi.hoisted(() => ({
  projectState: {
    currentProjectId: null as string | null,
    projects: [] as any[],
  },
}));

import AutopilotRoutePage, {
  AutopilotSpecTreeHandoffPanel,
} from "./AutopilotRoutePage";
import { AutopilotRightRail } from "./right-rail";
import { useAppStore } from "@/lib/store";

vi.mock("@/components/Scene3D", () => ({
  Scene3D: ({
    performanceProfile,
    projectId,
  }: {
    performanceProfile?: string;
    projectId?: string | null;
  }) => (
    <div
      data-testid="mock-scene-3d"
      data-performance-profile={performanceProfile}
      data-project-id={projectId ?? ""}
    />
  ),
}));

vi.mock("@/lib/project-store", () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

describe("AutopilotRoutePage", () => {
  beforeEach(() => {
    projectState.currentProjectId = null;
    projectState.projects = [];
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("renders the 3D scene, scene HUD, and sequential workflow in Chinese", () => {
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
    ];

    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain('data-testid="autopilot-route-page"');
    expect(markup).toContain('data-testid="autopilot-topbar"');
    expect(markup).toContain('data-testid="autopilot-visual-stage"');
    expect(markup).toContain('data-testid="autopilot-scene-visual"');
    expect(markup).toContain('data-testid="mock-scene-3d"');
    expect(markup).toContain('data-project-id="project-1"');
    expect(markup).not.toContain('data-testid="autopilot-experience-rail"');
    expect(markup).toContain('data-testid="autopilot-mission-hud"');
    expect(markup).toContain('data-testid="autopilot-workflow-rail"');
    expect(markup).toContain('data-testid="autopilot-workflow-steps"');
    expect(markup).toContain('data-testid="autopilot-step-input"');
    expect(markup).toContain('data-testid="autopilot-runtime-console"');
    // Spec 3: advanced workbenches fold and inline blueprint progress panel removed.
    expect(markup).not.toContain('data-testid="autopilot-advanced-workbenches"');
    expect(markup).not.toContain('data-testid="blueprint-progress-panel"');
    expect(markup).toContain("Permission System");
    expect(markup).toContain("ant-steps-horizontal");
    expect(markup).toContain("输入");
    expect(markup).toContain("澄清");
    expect(markup).toContain("编排");
    expect(markup).toContain("选择");
    expect(markup).toContain("编组");
    expect(markup).toContain("3D/HUD");
    expect(markup).not.toContain("自动驾驶画布");
    expect(markup).not.toContain(
      'data-testid="autopilot-generate-clarifications-button"'
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-generate-routeset-button"'
    );
    expect(markup).not.toContain("RouteSet generation and selection");
  });

  it("keeps the scene visible behind the operational workspace", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain("pointer-events-none absolute inset-0");
    expect(markup).toContain("bg-slate-950/82");
    expect(markup).toContain('data-autopilot-stage="input"');
    expect(markup).toContain('data-autopilot-route-state="pending"');
    expect(markup).toContain('data-autopilot-crew-state="pending"');
    expect(markup).toContain('data-testid="autopilot-runtime-console"');
    expect(markup).toContain("absolute bottom-4 left-4 right-4 z-10");
    expect(markup).toContain("absolute left-4 top-4 z-10");
    expect(markup).not.toContain("radial-gradient");
    expect(markup).not.toContain("linear-gradient(180deg");
    expect(markup).not.toContain("opacity-35");
  });

  it("switches the core chrome to English without mixing the main labels", () => {
    useAppStore.setState({ locale: "en-US" });

    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).not.toContain("Autopilot canvas");
    expect(markup).toContain("Project autopilot");
    expect(markup).toContain("ant-steps-horizontal");
    expect(markup).toContain("Input");
    expect(markup).toContain("Clarify");
    expect(markup).toContain("RouteSet");
    expect(markup).toContain("Select");
    expect(markup).toContain("Fabric");
    expect(markup).toContain("3D/HUD");
    expect(markup).toContain("Autopilot console");
    // Spec 3: advanced workbenches fold copy removed.
    expect(markup).not.toContain("Advanced asset workbenches");
    expect(markup).not.toContain(
      "Expand for SPEC, previews, prompts, capability bridge, and replay"
    );
    expect(markup).toContain("Create intake");
    expect(markup).toContain("Execution goal");
    expect(markup).toContain("GitHub URLs");
    expect(markup).not.toContain("鑷姩椹鹃┒鐢诲竷");
  });

  it("no longer renders the advanced workbenches fold (Spec 3 E2)", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    // E2: fold-removal snapshot.
    expect(markup).not.toContain('data-testid="autopilot-advanced-workbenches"');
    expect(markup).not.toContain('data-testid="blueprint-progress-panel"');
    expect(markup).not.toContain("高级资产工作台");
    expect(markup).not.toContain("Advanced asset workbenches");
    expect(markup).not.toContain(
      "展开查看 SPEC、预演、提示词、能力桥和回放"
    );
    expect(markup).not.toContain(
      "Expand for SPEC, previews, prompts, capability bridge, and replay"
    );
  });

  it("does not wire any navigation in the selection -> fabric transition (Spec 3 E1)", async () => {
    // E1: route selection must NOT navigate away from /autopilot. This is a
    // structural property: AutopilotRoutePage must not import useNavigate,
    // window.location.assign, or window.location.replace. With no @testing-library/react
    // available, we assert the property by reading the source file itself.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/useNavigate/);
    expect(source).not.toMatch(/window\.location\.assign/);
    expect(source).not.toMatch(/window\.location\.replace/);
    expect(source).not.toMatch(/window\.location\.href\s*=/);
  });

  describe("fabric stage right rail (Spec 3 T08)", () => {
    it("mounts <AutopilotRightRail> with data-testid=\"autopilot-right-rail\" under fabric stage", () => {
      const markup = renderToStaticMarkup(
        <AutopilotRightRail
          jobId="job-1"
          currentStage="fabric"
          currentSubStage="agent_crew_fabric"
          job={
            {
              id: "job-1",
              stage: "agent_crew_fabric",
            } as any
          }
          routeSet={null}
          selection={
            {
              id: "sel-1",
              routeTitle: "Primary",
            } as any
          }
          specTree={null}
          agentCrew={null}
          capabilities={[]}
          capabilityInvocations={[]}
          capabilityEvidence={[]}
          effectPreviews={[]}
          locale="zh-CN"
          onSubStageChange={() => {}}
        />
      );

      expect(markup).toContain('data-testid="autopilot-right-rail"');
      expect(markup).toContain('data-autopilot-stage="fabric"');
      expect(markup).toContain('data-autopilot-sub-stage="agent_crew_fabric"');
    });
  });

  it("explains that SPEC tree reviewing is a handoff state, not a stuck run", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecTreeHandoffPanel
        locale="en-US"
        job={
          {
            id: "job-1",
            stage: "spec_tree",
            status: "reviewing",
          } as any
        }
        selection={
          {
            routeTitle: "Primary SPEC asset route",
          } as any
        }
        specTree={
          {
            nodes: [{ id: "root" }, { id: "node-1" }],
          } as any
        }
      />
    );

    expect(markup).toContain('data-testid="autopilot-spec-tree-handoff"');
    expect(markup).toContain(
      "RouteSet selected; SPEC tree draft is waiting for review"
    );
    expect(markup).toContain("not the end");
    expect(markup).toContain("2 node");
    expect(markup).toContain('href="/specs"');
    // Spec 3 T06: CTA demoted from primary button to secondary text link.
    expect(markup).toContain("View in standalone workbench");
    expect(markup).not.toContain("Open deduction workbench");
  });

  it("uses the demoted Chinese text link for SPEC handoff CTA (Spec 3 T06 zh-CN)", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecTreeHandoffPanel
        locale="zh-CN"
        job={
          {
            id: "job-1",
            stage: "spec_tree",
            status: "reviewing",
          } as any
        }
        selection={
          {
            routeTitle: "主 SPEC 资产路线",
          } as any
        }
        specTree={
          {
            nodes: [{ id: "root" }, { id: "node-1" }],
          } as any
        }
      />
    );

    expect(markup).toContain('href="/specs"');
    expect(markup).toContain('data-testid="autopilot-open-specs-link"');
    expect(markup).toContain("在独立工作台查看");
    expect(markup).not.toContain("进入推导工作台");
  });
});
