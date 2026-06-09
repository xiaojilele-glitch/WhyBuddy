/**
 * Unit tests for the BrainstormWallGraph rendering logic.
 *
 * Tests layout constants, color mapping, title truncation, and adaptive scaling
 * WITHOUT requiring Three.js or dagre dependencies.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §8
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import {
  truncateTitle,
  computeAdaptiveScale,
  BRAINSTORM_NODE_COLORS,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  MAX_TITLE_LENGTH,
  CANVAS_W,
  CANVAS_H,
  drawBrainstormGraph,
  resolveBrainstormEdgeConnection,
  resolveBrainstormChallengeLabel,
  wrapBrainstormBody,
} from "../brainstorm-wall-graph-logic";
import { computeBrainstormLayout } from "../BrainstormWallGraph";
import type { LayoutResult } from "../brainstorm-wall-graph-logic";
import type { BranchNode, BranchEdge } from "@/lib/brainstorm-graph-store";

const here = dirname(fileURLToPath(import.meta.url));
const componentSource = () => readFileSync(resolve(here, "../BrainstormWallGraph.tsx"), "utf8");

// ---------------------------------------------------------------------------
// Title Truncation
// ---------------------------------------------------------------------------

describe("truncateTitle", () => {
  it("returns short titles unchanged", () => {
    expect(truncateTitle("Short")).toBe("Short");
    expect(truncateTitle("")).toBe("");
  });

  it("truncates titles exceeding 22 chars with ellipsis", () => {
    const longTitle = "This is a very long title that exceeds the limit";
    const result = truncateTitle(longTitle);
    expect(result.length).toBe(MAX_TITLE_LENGTH + 1); // 22 chars + ellipsis char
    expect(result).toMatch(/…$/);
  });

  it("handles exactly 22 character titles", () => {
    const title22 = "A".repeat(22);
    expect(truncateTitle(title22)).toBe(title22);
  });

  it("handles 23 character titles (truncated)", () => {
    const title23 = "A".repeat(23);
    const result = truncateTitle(title23);
    expect(result).toBe("A".repeat(22) + "…");
  });
});

// ---------------------------------------------------------------------------
// Adaptive Scaling
// ---------------------------------------------------------------------------

describe("computeAdaptiveScale", () => {
  it("returns 1 when graph fits within bounds", () => {
    const scale = computeAdaptiveScale(
      100, 100,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(scale).toBeLessThanOrEqual(1.5);
  });

  it("scales down when graph exceeds canvas", () => {
    const scale = computeAdaptiveScale(
      CANVAS_W * 3, CANVAS_H * 3,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.2);
  });

  it("never exceeds 1.5x scale", () => {
    const scale = computeAdaptiveScale(
      10, 10,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeLessThanOrEqual(1.5);
  });

  it("never goes below 0.2x scale", () => {
    const scale = computeAdaptiveScale(
      CANVAS_W * 100, CANVAS_H * 100,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeGreaterThanOrEqual(0.2);
  });

  it("returns 1 for zero-size graph", () => {
    const scale = computeAdaptiveScale(0, 0, CANVAS_W, CANVAS_H, BRAINSTORM_PADDING);
    expect(scale).toBe(1);
  });
});

describe("resolveBrainstormEdgeConnection", () => {
  it("uses opposite card sides for left-to-right edges", () => {
    const path = resolveBrainstormEdgeConnection(
      { x: 100, y: 200 },
      { x: 700, y: 260 },
    );

    expect(path.from.x).toBe(100 + BRAINSTORM_NODE_W / 2);
    expect(path.to.x).toBe(700 - BRAINSTORM_NODE_W / 2);
    expect(path.controlOffset).toBeGreaterThan(0);
  });

  it("uses opposite card sides for right-to-left edges instead of drawing through cards", () => {
    const path = resolveBrainstormEdgeConnection(
      { x: 900, y: 260 },
      { x: 200, y: 200 },
    );

    expect(path.from.x).toBe(900 - BRAINSTORM_NODE_W / 2);
    expect(path.to.x).toBe(200 + BRAINSTORM_NODE_W / 2);
    expect(path.controlOffset).toBeLessThan(0);
  });
});

describe("resolveBrainstormChallengeLabel", () => {
  it("keeps challenge labels short and inside the canvas", () => {
    const label = resolveBrainstormChallengeLabel(
      { x: 220, y: 180 },
      { x: 2600, y: 1120 },
      "This challenge summary is intentionally too long to fit cleanly on the wall without truncation.",
      CANVAS_W,
      CANVAS_H,
    );

    expect(label.text.length).toBeLessThanOrEqual(35);
    expect(label.x).toBeGreaterThanOrEqual(BRAINSTORM_PADDING);
    expect(label.y).toBeGreaterThanOrEqual(72);
    expect(label.x + label.width).toBeLessThanOrEqual(CANVAS_W - BRAINSTORM_PADDING);
    expect(label.y + label.height).toBeLessThanOrEqual(CANVAS_H - 72);
  });
});

// ---------------------------------------------------------------------------
// Node Color Mapping
// ---------------------------------------------------------------------------

describe("BRAINSTORM_NODE_COLORS", () => {
  it("maps all 6 node types to distinct colors", () => {
    const types = ["decision", "thinking", "action", "observation", "synthesis", "error"];
    const colors = types.map((t) => BRAINSTORM_NODE_COLORS[t as keyof typeof BRAINSTORM_NODE_COLORS]);

    // All types have colors
    for (const color of colors) {
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // All colors are unique
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Layout Constants
// ---------------------------------------------------------------------------

describe("Layout constants", () => {
  it("has correct node dimensions", () => {
    expect(BRAINSTORM_NODE_W).toBe(540);
    expect(BRAINSTORM_NODE_H).toBe(232);
    expect(BRAINSTORM_PADDING).toBe(180);
  });

  it("has correct canvas dimensions", () => {
    expect(CANVAS_W).toBe(2880);
    expect(CANVAS_H).toBe(1320);
  });

  it("MAX_TITLE_LENGTH is 22", () => {
    expect(MAX_TITLE_LENGTH).toBe(22);
  });
});

describe("computeBrainstormLayout", () => {
  it("places a decision marker as the central fanout source before role anchors", () => {
    const roles = ["decider", "planner", "architect", "executor", "auditor"] as const;
    const nodes: BranchNode[] = [
      {
        id: "decision-marker",
        sessionId: "session-runtime",
        parentNodeId: null,
        roleId: "decider",
        type: "decision",
        status: "completed",
        title: "Decision: BRAINSTORM",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      ...roles.map((role, index) => ({
        id: `role:${role}`,
        sessionId: "session-runtime",
        parentNodeId: "decision-marker",
        roleId: role,
        type: "decision" as const,
        status: "completed" as const,
        title: role,
        createdAt: new Date((index + 1) * 1000).toISOString(),
        updatedAt: new Date((index + 1) * 1000).toISOString(),
      })),
    ];
    const edges: BranchEdge[] = roles.map((role) => ({
      sourceNodeId: "decision-marker",
      targetNodeId: `role:${role}`,
    }));

    const layout = computeBrainstormLayout(nodes, edges);
    const marker = layout?.nodes.find((node) => node.id === "decision-marker");
    const roleNodes = layout?.nodes.filter((node) => node.id.startsWith("role:")) ?? [];
    const minRoleX = Math.min(...roleNodes.map((node) => node.x));

    expect(marker).toBeDefined();
    expect(marker?.y).toBeCloseTo(CANVAS_H / 2, 0);
    expect(marker?.x).toBeLessThan(minRoleX - BRAINSTORM_NODE_W * 0.6);
    expect(layout?.edges).toHaveLength(5);
  });

  it("keeps challenge and support markers near their role instead of collapsing them into the central fanout source", () => {
    const nodes: BranchNode[] = [
      ...(["decider", "planner", "architect", "executor", "auditor"] as const).map((role, index) => ({
        id: `role:${role}`,
        sessionId: "session-runtime",
        parentNodeId: index === 0 ? null : `role:${(["decider", "planner", "architect", "executor", "auditor"] as const)[index - 1]}`,
        roleId: role,
        type: "decision" as const,
        status: "completed" as const,
        title: role,
        createdAt: new Date((index + 1) * 1000).toISOString(),
        updatedAt: new Date((index + 1) * 1000).toISOString(),
      })),
      {
        id: "challenge-1",
        sessionId: "session-runtime",
        parentNodeId: "role:planner",
        roleId: "planner",
        type: "decision",
        status: "completed",
        title: "Decision: CHALLENGE",
        createdAt: new Date(7000).toISOString(),
        updatedAt: new Date(7000).toISOString(),
      },
    ];
    const edges: BranchEdge[] = [
      { sourceNodeId: "role:planner", targetNodeId: "challenge-1" },
    ];

    const layout = computeBrainstormLayout(nodes, edges);
    const planner = layout?.nodes.find((node) => node.id === "role:planner");
    const challenge = layout?.nodes.find((node) => node.id === "challenge-1");

    expect(planner).toBeDefined();
    expect(challenge).toBeDefined();
    expect(challenge?.x).toBeGreaterThan((planner?.x ?? 0));
    expect(challenge?.y).not.toBeCloseTo(CANVAS_H / 2, 0);
  });

  it("places parent→child role nodes into left-to-right topological layer columns", () => {
    const roles = ["decider", "planner", "architect", "executor", "auditor"] as const;
    const nodes: BranchNode[] = roles.map((role, index) => ({
      id: `role:${role}`,
      sessionId: "session-runtime",
      parentNodeId: index === 0 ? null : `role:${roles[index - 1]}`,
      roleId: role,
      type: "decision",
      status: "completed",
      title: role,
      createdAt: new Date(index * 1000).toISOString(),
      updatedAt: new Date(index * 1000).toISOString(),
    }));
    const edges: BranchEdge[] = [
      { sourceNodeId: "role:decider", targetNodeId: "role:planner" },
      { sourceNodeId: "role:planner", targetNodeId: "role:architect" },
      { sourceNodeId: "role:architect", targetNodeId: "role:executor" },
      { sourceNodeId: "role:executor", targetNodeId: "role:auditor" },
      { sourceNodeId: "role:auditor", targetNodeId: "role:planner" },
    ];

    const layout = computeBrainstormLayout(nodes, edges);
    const byId = new Map(layout?.nodes.map((n) => [n.id, n]));
    expect(layout).not.toBeNull();
    // Chain decider→planner→architect→executor→auditor → 5 distinct columns,
    // strictly increasing x left-to-right (cycle edge auditor→planner ignored).
    expect(byId.get("role:decider")!.x).toBeLessThan(byId.get("role:planner")!.x);
    expect(byId.get("role:planner")!.x).toBeLessThan(byId.get("role:architect")!.x);
    expect(byId.get("role:architect")!.x).toBeLessThan(byId.get("role:executor")!.x);
    expect(byId.get("role:executor")!.x).toBeLessThan(byId.get("role:auditor")!.x);
    const xs = layout!.nodes.map((n) => n.x);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(5);
  });

  it("forces synthesis to the rightmost column of the layered DAG", () => {
    const roles = ["decider", "planner", "architect", "auditor"];
    const nodes: BranchNode[] = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      sessionId: "session-1",
      parentNodeId: index === 0 ? null : `node-${index - 1}`,
      roleId: roles[index % roles.length] as BranchNode["roleId"],
      type: index === 11 ? "synthesis" : "thinking",
      status: "completed",
      title: "",
      content: `claim ${index}`,
      createdAt: new Date(index * 1000).toISOString(),
      updatedAt: new Date(index * 1000).toISOString(),
    }));
    const edges: BranchEdge[] = nodes.slice(1).map((node, index) => ({
      sourceNodeId: `node-${index}`,
      targetNodeId: node.id,
    }));

    const layout = computeBrainstormLayout(nodes, edges);

    expect(layout).not.toBeNull();
    expect(layout?.nodes).toHaveLength(12);
    expect(layout?.edges).toHaveLength(11);
    // A 12-node chain spreads across many layer columns.
    expect(new Set(layout?.nodes.map((node) => Math.round(node.x))).size).toBeGreaterThan(3);
    // Every parent→child edge carries a semantic relation label.
    expect(layout?.edges.every((e) => typeof e.label === "string" && e.label.length > 0)).toBe(true);
    // The synthesis node sits in the rightmost column.
    const synth = layout?.nodes.find((n) => n.id === "node-11");
    const maxX = Math.max(...(layout?.nodes.map((n) => n.x) ?? [0]));
    expect(synth?.x).toBeCloseTo(maxX, 0);
  });
});

describe("BrainstormWallGraph scene integration guards", () => {
  it("keeps completed brainstorm sessions visible until an explicit idle/reset state", () => {
    const source = componentSource();

    expect(source).toContain('sessionStatus === "idle" || sessionStatus === "failed"');
    expect(source).not.toContain('sessionStatus === "completed" || sessionStatus === "failed"');
  });

  it("renders slightly in front of the base blueprint wall texture", () => {
    const source = componentSource();

    expect(source).toContain("BRAINSTORM_WALL_GRAPH_POSITION");
    expect(source).toContain("BLUEPRINT_WALL_GRAPH_POSITION[2] + 0.018");
    expect(source).toContain("renderOrder={20}");
    expect(source).toContain("depthWrite={false}");
  });
});

// ---------------------------------------------------------------------------
// Canvas2D Drawing (smoke test - verify it doesn't throw)
// ---------------------------------------------------------------------------

describe("drawBrainstormGraph", () => {
  // Create a minimal canvas mock for Node.js environment
  function createMockCtx(): CanvasRenderingContext2D {
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetY: 0,
      createLinearGradient: () => ({
        addColorStop: () => {},
      }),
      fillRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      bezierCurveTo: () => {},
      fillText: () => {},
      roundRect: () => {},
      setLineDash: () => {},
    } as unknown as CanvasRenderingContext2D;
  }

  it("draws empty state without throwing", () => {
    const ctx = createMockCtx();
    expect(() => drawBrainstormGraph(ctx, null)).not.toThrow();
  });

  it("draws nodes without throwing", () => {
    const ctx = createMockCtx();
    const layout: LayoutResult = {
      nodes: [
        { id: "n1", x: 100, y: 100, title: "Decision point", type: "decision", status: "active", roleId: "planner", opacity: 1 },
        { id: "n2", x: 300, y: 100, title: "Thinking", type: "thinking", status: "completed", roleId: "architect", confidence: 0.85, opacity: 1 },
      ],
      edges: [
        { from: { x: 100, y: 100 }, to: { x: 300, y: 100 } },
      ],
      scale: 1,
    };

    expect(() => drawBrainstormGraph(ctx, layout)).not.toThrow();
  });

  it("handles fade-in opacity correctly", () => {
    const ctx = createMockCtx();
    const alphaValues: number[] = [];
    Object.defineProperty(ctx, "globalAlpha", {
      set(v: number) { alphaValues.push(v); },
      get() { return 1; },
    });

    const layout: LayoutResult = {
      nodes: [
        { id: "n1", x: 100, y: 100, title: "Test", type: "thinking", status: "active", roleId: "planner", opacity: 0.5 },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout);
    // Opacity should have been set to 0.5 at some point (for the fading node)
    expect(alphaValues).toContain(0.5);
    // And reset back to 1
    expect(alphaValues).toContain(1);
  });

  it("draws deliberation overlays without throwing", () => {
    const ctx = createMockCtx();
    const text: string[] = [];
    const dashPatterns: number[][] = [];
    (ctx.fillText as unknown as { mock?: unknown });
    (ctx as any).fillText = (value: string) => text.push(value);
    (ctx as any).setLineDash = (value: number[]) => dashPatterns.push(value);
    const layout: LayoutResult = {
      nodes: [
        { id: "planner-node", x: 100, y: 100, title: "Planner", type: "thinking", status: "active", roleId: "planner", opacity: 1 },
        { id: "architect-node", x: 400, y: 100, title: "Architect", type: "thinking", status: "active", roleId: "architect", opacity: 1 },
      ],
      edges: [],
      scale: 1,
    };

    expect(() =>
      drawBrainstormGraph(ctx, layout, CANVAS_W, CANVAS_H, {
        currentRound: 2,
        convergenceScore: 0.72,
        challengeEdges: [
          {
            challengerRoleId: "planner",
            targetRoleId: "architect",
            summary: "Clarify runtime boundary.",
            roundNumber: 2,
          },
        ],
        voteOutcome: {
          winningOption: "Option A",
          margin: 0.1,
          isNarrow: true,
          minority: ["Option B"],
        },
      }),
    ).not.toThrow();

    expect(text.some((value) => value.includes("Round 2"))).toBe(true);
    expect(text.some((value) => value.includes("Option A"))).toBe(true);
    expect(text.some((value) => value.includes("Clarify runtime boundary."))).toBe(true);
    expect(dashPatterns.some((pattern) => pattern.join(",") === "10,10")).toBe(true);
  });

  it("routes challenge overlays from the side facing the target role", () => {
    const ctx = createMockCtx();
    const moveToCalls: Array<[number, number]> = [];
    (ctx as any).moveTo = (x: number, y: number) => moveToCalls.push([x, y]);
    const layout: LayoutResult = {
      nodes: [
        { id: "role:architect", x: 900, y: 260, title: "Architect", type: "decision", status: "active", roleId: "architect", opacity: 1 },
        { id: "role:planner", x: 200, y: 220, title: "Planner", type: "decision", status: "active", roleId: "planner", opacity: 1 },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout, CANVAS_W, CANVAS_H, {
      challengeEdges: [
        {
          challengerRoleId: "architect",
          targetRoleId: "planner",
          summary: "Reverse challenge.",
          roundNumber: 1,
        },
      ],
    });

    expect(moveToCalls).toContainEqual([
      900 - BRAINSTORM_NODE_W / 2,
      260,
    ]);
  });

  it("draws challenge labels after role cards so dense branches do not cover interaction text", () => {
    const ctx = createMockCtx();
    const textCalls: string[] = [];
    (ctx as any).fillText = (value: string) => textCalls.push(value);
    const layout: LayoutResult = {
      nodes: [
        { id: "role:planner", x: 700, y: 260, title: "Planner card", type: "decision", status: "active", roleId: "planner", opacity: 1 },
        { id: "role:architect", x: 1200, y: 360, title: "Architect card", type: "decision", status: "active", roleId: "architect", opacity: 1 },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout, CANVAS_W, CANVAS_H, {
      challengeEdges: [
        {
          challengerRoleId: "planner",
          targetRoleId: "architect",
          summary: "Clarify runtime boundary.",
          roundNumber: 1,
        },
      ],
    });

    const plannerTitleIndex = textCalls.indexOf("Planner card");
    const challengeLabelIndex = textCalls.indexOf("Clarify runtime boundary.");
    expect(plannerTitleIndex).toBeGreaterThanOrEqual(0);
    expect(challengeLabelIndex).toBeGreaterThan(plannerTitleIndex);
  });
});

// ---------------------------------------------------------------------------
// Node card shows the actual debate content, not just the role label.
// ---------------------------------------------------------------------------

describe("wrapBrainstormBody", () => {
  it("returns [] for empty/whitespace input", () => {
    expect(wrapBrainstormBody("", 20, 2)).toEqual([]);
    expect(wrapBrainstormBody("   ", 20, 2)).toEqual([]);
  });

  it("keeps short text on a single line", () => {
    expect(wrapBrainstormBody("Planner card", 20, 2)).toEqual(["Planner card"]);
  });

  it("wraps into at most maxLines, truncating the last line with an ellipsis", () => {
    const lines = wrapBrainstormBody("A".repeat(100), 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("A".repeat(20));
    expect(lines[1].endsWith("…")).toBe(true);
  });
});

describe("drawBrainstormGraph node body content", () => {
  function createTextCapturingCtx(textCalls: string[]) {
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetY: 0,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      fillText: (value: string) => textCalls.push(value),
      measureText: () => ({ width: 0 }),
      roundRect: () => {},
      setLineDash: () => {},
    } as unknown as CanvasRenderingContext2D;
  }

  it("renders node.content (the real claim) on the card, not just the role", () => {
    const textCalls: string[] = [];
    const ctx = createTextCapturingCtx(textCalls);
    const layout: LayoutResult = {
      nodes: [
        {
          id: "n1",
          x: 300,
          y: 300,
          title: "spec_docs context",
          type: "thinking",
          status: "completed",
          roleId: "planner",
          content: "We should isolate the runtime behind an env gate.",
          opacity: 1,
        },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout, CANVAS_W, CANVAS_H, {});

    // The role header is still drawn for identity.
    expect(textCalls).toContain("PLANNER");
    // The actual debate content is drawn (first wrapped line), not the title.
    expect(textCalls.some((t) => t.startsWith("We should isolate"))).toBe(true);
    expect(textCalls).not.toContain("spec_docs context");
  });

  it("falls back to title when a node has no content yet", () => {
    const textCalls: string[] = [];
    const ctx = createTextCapturingCtx(textCalls);
    const layout: LayoutResult = {
      nodes: [
        {
          id: "decision-marker",
          x: 300,
          y: 300,
          title: "Decision: BRANCH",
          type: "decision",
          status: "completed",
          roleId: "decision-gate",
          opacity: 1,
        },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout, CANVAS_W, CANVAS_H, {});

    expect(textCalls.some((t) => t.startsWith("Decision: BRANCH"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Role-anchor nodes (role:<id>) surface that role's latest claim content so
// every lane-header card shows dialogue, not just a bare role label.
// ---------------------------------------------------------------------------

describe("computeBrainstormLayout role-anchor de-duplication", () => {
  function branch(
    id: string,
    roleId: BranchNode["roleId"],
    overrides: Partial<BranchNode> = {},
  ): BranchNode {
    return {
      id,
      sessionId: "s1",
      parentNodeId: null,
      roleId,
      type: "thinking",
      status: "completed",
      title: "",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      ...overrides,
    } as BranchNode;
  }

  it("drops the redundant role-anchor card once that role has a claim node", () => {
    const nodes: BranchNode[] = [
      // 3+ runtime role anchors trigger the anchor-based fan-out layout.
      branch("role:planner", "planner", { type: "decision", title: "planner" }),
      branch("role:architect", "architect", { type: "decision", title: "architect" }),
      branch("role:executor", "executor", { type: "decision", title: "executor" }),
      // A claim node carrying the planner's actual debate text.
      branch("claim-1", "planner", {
        content: "Planner proposes a phased rollout with rollback gates.",
      }),
    ];

    const layout = computeBrainstormLayout(nodes, []);
    expect(layout).not.toBeNull();
    // planner has a claim → its bare anchor card is dropped (no duplicate card).
    expect(layout!.nodes.find((n) => n.id === "role:planner")).toBeUndefined();
    // the claim node remains and carries the real content.
    const claim = layout!.nodes.find((n) => n.id === "claim-1");
    expect(claim?.content).toContain("phased rollout");
    // a role with no claim yet keeps its anchor so the participant stays visible.
    expect(layout!.nodes.find((n) => n.id === "role:executor")).toBeDefined();
  });
});
