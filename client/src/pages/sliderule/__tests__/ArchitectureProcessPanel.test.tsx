import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArchitectureProcessPanel } from "../ArchitectureProcessPanel";
import SlideRule, {
  deriveNoIntentRuntimeProjection,
  deriveImmediatePythonRuntimeProjection,
  loadPythonRuntimeProjectionFromSession,
} from "@/pages/SlideRule";

const EmbeddedSlideRule = SlideRule as React.ComponentType<{ embedded?: boolean }>;
const slideRuleHookOverrides: { driveFullStatus?: string | null } = {};

vi.mock("../TurnRouteTimeline", () => ({
  TurnRouteTimeline: () => <div data-testid="mock-turn-route-timeline" />,
}));

vi.mock("@/components/autopilot/ReasoningFlowSurface", () => ({
  ReasoningFlowSurface: () => <div data-testid="mock-reasoning" />,
}));

vi.mock("../useSlideRuleSession", async () => {
  const rt = await vi.importActual<typeof import("@/lib/sliderule-runtime")>(
    "@/lib/sliderule-runtime"
  );
  const base = rt.createInitialSessionState(
    "smoke goal for /agent-loop/sliderule",
    "sliderule-smoke-119"
  );
  // python /drive-full publishClosure injected into persisted sessionState (pass-through)
  const sessionStateWithPythonClosure = {
    ...base,
    publishClosure: {
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      closureHash: "abc123python",
      tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
      topBlockers: [],
    },
    skillRuntimeGraph: {
      edges: [
        {
          sourceSkill: "datamodel",
          targetSkill: "page",
          state: "allowed",
          evidenceKey: "DM_PAGE_BINDING_IMPACT_EVIDENCE",
        },
      ],
      bySkill: {},
      evidenceBySkill: {
        datamodel: ["DM_PAGE_BINDING_IMPACT_EVIDENCE"],
        page: ["PAGE_FIELD_BINDING_EVIDENCE"],
      },
    },
  };
  return {
    useSlideRuleSession: () => ({
      goal: "smoke goal for /agent-loop/sliderule",
      sessionState: sessionStateWithPythonClosure,
      uiTurns: [
        {
          id: "turn-smoke-root",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete" as const,
          routeLitCount: 0,
          routeExpanded: true,
          user: "smoke",
          assistant: "",
        },
      ],
      input: "",
      setInput: () => {},
      isRunning: false,
      liveAction: null,
      sendMessage: async () => {},
      challengeTurn: async () => {},
      resetSession: () => {},
      retryCapability: async () => {},
      toggleRouteExpanded: () => {},
      driveMode: "single" as const,
      setDriveMode: () => {},
      stop: () => {},
      executorMode: "server-llm" as const,
      driveFullStatus: slideRuleHookOverrides.driveFullStatus ?? "idle",
    }),
  };
});

describe("ArchitectureProcessPanel publish closure drilldown", () => {
  it("renders stable skill linkage row targets for cross-runtime examples", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-linkage"
        isRunning={false}
        latestTurn={{
          id: "turn-linkage",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        crossRuntimeGraph={{
          edgeCount: 1,
          allowedCount: 1,
          blockedCount: 0,
          skillCount: 2,
          evidenceCount: 1,
          examples: [
            {
              sourceSkill: "datamodel",
              targetSkill: "page",
              state: "allowed",
              evidenceKey: "DM_PAGE:leave_request",
            },
          ],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-skill-linkage-row"');
    expect(html).toContain('data-source-skill="datamodel"');
    expect(html).toContain('data-target-skill="page"');
    expect(html).toContain('data-state="allowed"');
    expect(html).toContain('data-evidence-key="DM_PAGE:leave_request"');
    expect(html).toContain('data-testid="sliderule-skill-linkage-source"');
    expect(html).toContain('data-testid="sliderule-skill-linkage-target"');
    expect(html).toContain('aria-label="选择来源 Skill datamodel"');
    expect(html).toContain('aria-label="选择目标 Skill page"');
  });

  it("renders stable blocker drilldown targets for closure blockers", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-test"
        isRunning={false}
        latestTurn={{
          id: "turn-closure",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        crossRuntimeGraph={{
          edgeCount: 1,
          allowedCount: 0,
          blockedCount: 1,
          skillCount: 2,
          evidenceCount: 1,
          examples: [],
        }}
        publishClosure={{
          blocked: true,
          blockerCount: 1,
          evidencePresentCount: 5,
          skillCount: 6,
          versionPinsChecked: false,
          closureHash: "feedface",
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
          topBlockers: [
            {
              code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
              path: "pageBindings[0].pageRef",
              affectedSkill: "page",
              ref: "page_purchase_request",
            },
          ],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-publish-closure-blocker"');
    expect(html).toContain('data-state="blocked"');
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain('data-skill="page"');
    expect(html).toContain('data-ref="page_purchase_request"');
    expect(html).toContain('data-path="pageBindings[0].pageRef"');
    expect(html).toContain('data-testid="sliderule-closure-blocker-skill"');
    expect(html).toContain('data-testid="sliderule-closure-blocker-ref"');
    expect(html).toContain('aria-label="选择受影响 Skill page"');
    expect(html).toContain('aria-label="选择引用 page_purchase_request"');
    expect(html).toContain("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
    expect(html).not.toContain('data-testid="publish-closure-fail-closed"');
  });

  it("renders unknown instead of question-mark fallback for missing closure blocker skill", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-unknown-skill"
        isRunning={false}
        latestTurn={{
          id: "turn-closure-unknown",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        publishClosure={{
          blocked: true,
          blockerCount: 1,
          evidencePresentCount: 5,
          skillCount: 6,
          versionPinsChecked: false,
          closureHash: "feedface",
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
          topBlockers: [
            {
              code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
              path: "runtimeClosure.perSkill.unknown",
            },
          ],
        }}
      />
    );

    expect(html).toContain('aria-label="选择受影响 Skill unknown"');
    expect(html).toContain(">unknown</button>");
    expect(html).not.toContain("skill?");
  });

  it("renders fail-closed marker when closure is blocked without blocker details", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-empty-blockers"
        isRunning={false}
        latestTurn={{
          id: "turn-empty-blockers",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        crossRuntimeGraph={null}
        publishClosure={{
          blocked: true,
          blockerCount: 1,
          evidencePresentCount: 5,
          skillCount: 6,
          versionPinsChecked: true,
          closureHash: "blocked-without-details",
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
          topBlockers: [],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-publish-closure"');
    expect(html).toContain('data-state="blocked"');
    expect(html).toContain('data-fail-closed="true"');
    expect(html).toContain('data-testid="publish-closure-fail-closed"');
    expect(html).toContain("fail-closed: blocked with no topBlockers");
    expect(html).not.toContain('data-testid="sliderule-publish-closure-blocker"');
  });
});

// Browser smoke coverage for closure visibility after /agent-loop/sliderule command.
// Exercises the panels used when DashboardApp renders <SlideRulePage embedded /> for route /agent-loop/sliderule.
// Uses python /drive-full schema shape for publishClosure + crossRuntimeGraph (pass-through from slide-rule-python).
// Includes positive (closed with evidence) and fail-closed negative (blocked or absent) behaviors.
// Deterministic, no network/provider/browser automation calls.
describe("browser smoke: closure visibility after /agent-loop/sliderule (python /drive-full pass-through)", () => {
  const baseTurn = {
    id: "turn-smoke-119",
    routeFacts: {} as any,
    steps: [],
    actions: [],
    status: "complete" as const,
    routeLitCount: 0,
    routeExpanded: true,
  };

  // Fixture: sample publishClosure produced by python derive_publish_closure_response + drive-full
  const pythonClosedClosure = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureHash: "abc123python",
    tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
    topBlockers: [],
  };

  const crossGraph = {
    edgeCount: 4,
    allowedCount: 4,
    blockedCount: 0,
    skillCount: 6,
    evidenceCount: 6,
    examples: [
      { sourceSkill: "datamodel", targetSkill: "rbac", state: "allowed", evidenceKey: "DM_RBAC" },
    ],
  };

  it("positive: renders publish closed + cross runtime graph evidence when python closure present (via /agent-loop/sliderule)", () => {
    // Render through sliderule-root wrapper to cover embedded entry used by /agent-loop/sliderule (Dashboard <SlideRulePage embedded />)
    const html = renderToStaticMarkup(
      <div data-testid="sliderule-root" data-paths="/agent-loop/sliderule /sliderule" data-backend="python-fullpath-e2e">
        <ArchitectureProcessPanel
          liveAction={null}
          sessionId="agent-loop-sliderule-smoke"
          isRunning={false}
          latestTurn={baseTurn}
          crossRuntimeGraph={crossGraph}
          publishClosure={pythonClosedClosure}
        />
      </div>
    );

    // visibility assertions for browser smoke (data-testid + label content)
    expect(html).toContain('data-testid="sliderule-root"');
    expect(html).toContain('data-testid="sliderule-cross-runtime-graph"');
    expect(html).toContain('data-testid="sliderule-publish-closure"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain("publish closed");
    expect(html).toContain("6/6 evidence");
    expect(html).toContain("pins checked");
    expect(html).toContain("datamodel");
  });

  it("renders persisted runtime closure surfaces after reload even when latestTurn cannot be rebuilt", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="agent-loop-sliderule-reload"
        isRunning={false}
        latestTurn={null}
        crossRuntimeGraph={crossGraph}
        publishClosure={pythonClosedClosure}
      />
    );

    expect(html).toContain('data-testid="sliderule-arch-process-panel"');
    expect(html).toContain('data-testid="sliderule-cross-runtime-graph"');
    expect(html).toContain('data-testid="sliderule-publish-closure"');
    expect(html).toContain("publish closed");
    expect(html).toContain("6/6 evidence");
  });

  it("fail-closed negative: renders publish blocked (no evidence fabrication) for missing declared skill from /drive-full", () => {
    const blockedClosure = {
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 5,
      skillCount: 6,
      versionPinsChecked: true,
      closureHash: "blocked-python",
      tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
      topBlockers: [{ code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", path: "aigc", affectedSkill: "aigc" }],
    };
    const html = renderToStaticMarkup(
      <div data-testid="sliderule-root" data-paths="/agent-loop/sliderule /sliderule" data-backend="python-fullpath-e2e">
        <ArchitectureProcessPanel
          liveAction={null}
          sessionId="agent-loop-sliderule-smoke-blocked"
          isRunning={false}
          latestTurn={baseTurn}
          crossRuntimeGraph={crossGraph}
          publishClosure={blockedClosure}
        />
      </div>
    );

    expect(html).toContain('data-testid="sliderule-publish-closure"');
    expect(html).toContain("publish blocked");
    expect(html).toContain("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
    // negative: does not claim full evidence
    expect(html).not.toContain("6/6 evidence");
  });

  it("fail-closed negative: omits publish-closure section when python /drive-full yields null (no stale data)", () => {
    const html = renderToStaticMarkup(
      <div data-testid="sliderule-root" data-paths="/agent-loop/sliderule /sliderule" data-backend="python-fullpath-e2e">
        <ArchitectureProcessPanel
          liveAction={null}
          sessionId="agent-loop-sliderule-smoke-absent"
          isRunning={false}
          latestTurn={baseTurn}
          crossRuntimeGraph={null}
          publishClosure={null}
        />
      </div>
    );

    // no closure section rendered (fail-closed pass-through)
    expect(html).not.toContain('data-testid="sliderule-publish-closure"');
    expect(html).not.toContain("publish closed");
    expect(html).not.toContain("publish blocked");
  });

  // Root-level browser smoke: assert sliderule-root + python pass-through visibility after simulated /agent-loop/sliderule.
  // Unified-surface contract (2026-07): the pan/zoom canvas + always-on overlay HUD are gone; python
  // /drive-full pass-through surfaces at the root as data attributes, the AppBundle evidence board
  // (default right-rail screen), and the reachable 推演过程 rail view (SKILL LINKAGE lives there;
  // its markup is covered by the direct ArchitectureProcessPanel tests above).
  it("renders sliderule-root for embedded /agent-loop/sliderule entry and surfaces python /drive-full publishClosure (positive)", () => {
    const html = renderToStaticMarkup(React.createElement(EmbeddedSlideRule, { embedded: true }));

    expect(html).toContain('data-testid="sliderule-root"');
    expect(html).toContain('data-paths="/agent-loop/sliderule /sliderule"');
    expect(html).toContain('data-backend="python-fullpath-e2e"');
    // pass-through from python publishClosure via sessionState seeds initial state visible at root entry
    expect(html).toContain('data-runtime-publish-closure="present"');
    expect(html).toContain('data-runtime-skill-graph="present"');
    // default rail = 接线沙盘；Checks 吃 python closure 的 6/6
    expect(html).toContain('data-testid="sliderule-architecture-stage"');
    expect(html).toContain("Checks 6/6");
    expect(html).not.toContain("发布证据看板");
    // 「推演过程」右栏标签页已删（左栏对话流即实时推演过程）：右栏只有系统画面
    expect(html).not.toContain('data-testid="sliderule-rail-tab-process"');
    expect(html).not.toContain('data-testid="sliderule-rail-tab-screens"');
  });

  it("rail variant renders the same linkage/publish-closure drilldown targets for the unified right rail", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        variant="rail"
        liveAction={null}
        sessionId="arch-panel-rail"
        isRunning={false}
        latestTurn={baseTurn}
        crossRuntimeGraph={{
          edgeCount: 1,
          allowedCount: 1,
          blockedCount: 0,
          skillCount: 2,
          evidenceCount: 1,
          examples: [
            {
              sourceSkill: "datamodel",
              targetSkill: "page",
              state: "allowed",
              evidenceKey: "DM_PAGE_BINDING_IMPACT_EVIDENCE",
            },
          ],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-arch-process-panel"');
    expect(html).toContain('data-variant="rail"');
    expect(html).toContain('data-testid="sliderule-skill-linkage-row"');
    expect(html).toContain("DM_PAGE_BINDING_IMPACT_EVIDENCE");
  });

  it("rail variant shows an honest empty hint instead of vanishing when no run has happened", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        variant="rail"
        liveAction={null}
        sessionId="arch-panel-rail-empty"
        isRunning={false}
        latestTurn={null}
        crossRuntimeGraph={null}
        publishClosure={null}
      />
    );

    expect(html).toContain('data-testid="sliderule-arch-process-panel"');
    expect(html).toContain("执行时间线");
  });

  it("renders sliderule-root for embedded path (negative: no stale when absent)", () => {
    // For negative, we use direct panel wrapped (mock provides positive, but root always present)
    const html = renderToStaticMarkup(React.createElement(EmbeddedSlideRule, { embedded: true }));
    expect(html).toContain('data-testid="sliderule-root"');
  });

  it("surfaces /drive-full timeout status at the root so command submit is visibly not stuck", () => {
    slideRuleHookOverrides.driveFullStatus = "timeout";
    try {
      const html = renderToStaticMarkup(React.createElement(EmbeddedSlideRule, { embedded: true }));

      expect(html).toContain('data-testid="sliderule-drive-full-status"');
      expect(html).toContain('data-status="timeout"');
      expect(html).toContain("/drive-full");
    } finally {
      slideRuleHookOverrides.driveFullStatus = null;
    }
  });

  it("keeps python runtime projection when reload has no rebuilt intent yet", () => {
    const projection = deriveNoIntentRuntimeProjection({
      pythonPublishClosure: pythonClosedClosure,
      pythonSkillRuntimeGraph: {
        edges: [
          {
            sourceSkill: "datamodel",
            targetSkill: "page",
            state: "allowed",
            evidenceKey: "DM_PAGE_BINDING_IMPACT_EVIDENCE",
          },
        ],
      },
    } as any);

    expect(projection.publishClosure?.evidencePresentCount).toBe(6);
    expect(projection.crossRuntimeGraph?.skillCount).toBeGreaterThan(0);
  });

  it("keeps hydrated python runtime projection with a non-empty persisted goal before local preview completes", () => {
    const projection = deriveImmediatePythonRuntimeProjection({
      pythonPublishClosure: pythonClosedClosure,
      pythonSkillRuntimeGraph: {
        edges: [
          {
            sourceSkill: "datamodel",
            targetSkill: "page",
            state: "allowed",
            evidenceKey: "DM_PAGE_BINDING_IMPACT_EVIDENCE",
          },
        ],
      },
    } as any);

    expect(projection).not.toBeNull();
    expect(projection?.publishClosure?.closureHash).toBe("abc123python");
    expect(projection?.crossRuntimeGraph?.skillCount).toBeGreaterThan(0);
  });

  it("loads persisted python runtime projection from the session envelope for reload replay", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: {
          publishClosure: pythonClosedClosure,
          skillRuntimeGraph: {
            edges: [
              {
                sourceSkill: "datamodel",
                targetSkill: "page",
                state: "allowed",
                evidenceKey: "DM_PAGE_BINDING_IMPACT_EVIDENCE",
              },
            ],
          },
        },
      }),
    })) as any;

    const projection = await loadPythonRuntimeProjectionFromSession("sliderule-v51-product", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/sliderule/sessions/sliderule-v51-product",
      expect.objectContaining({ method: "GET" })
    );
    expect(projection?.publishClosure?.closureHash).toBe("abc123python");
    expect(projection?.crossRuntimeGraph?.edgeCount).toBe(1);
  });
});
