/**
 * BrainstormWallGraph — pure logic module (no dagre / Three.js dependencies).
 *
 * Exports the testable rendering logic:
 * - Title truncation
 * - Adaptive scaling
 * - Node type → color mapping
 * - Canvas2D drawing (operates on pre-computed layout)
 *
 * This module is separated from BrainstormWallGraph.tsx to enable testing
 * without dagre/Three.js dependencies in the test environment.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §8
 * Requirements: 7.1, 7.3, 7.5, 7.7
 */

import type { BranchNodeType } from "@shared/blueprint/brainstorm-contracts";
import type {
  ChallengeEdge,
  VoteOutcomeView,
} from "@/lib/brainstorm-graph-store";

// ---------------------------------------------------------------------------
// Constants (exported for testing)
// ---------------------------------------------------------------------------

/** Canvas resolution width */
export const CANVAS_W = 2880;
/** Canvas resolution height */
export const CANVAS_H = 1320;

/** Node card width in layout units */
export const BRAINSTORM_NODE_W = 540;
/** Node card height in layout units */
export const BRAINSTORM_NODE_H = 232;
/** Canvas padding */
export const BRAINSTORM_PADDING = 180;

/** Node type → color mapping (6 distinct colors for 6 types) */
export const BRAINSTORM_NODE_COLORS: Record<BranchNodeType, string> = {
  decision: "#0d9488",    // teal
  thinking: "#6366f1",    // indigo
  action: "#f59e0b",      // amber
  observation: "#ec4899", // pink
  synthesis: "#10b981",   // emerald
  error: "#ef4444",       // red
};

/** Maximum title length before truncation */
export const MAX_TITLE_LENGTH = 22;

// ---------------------------------------------------------------------------
// Layout Types
// ---------------------------------------------------------------------------

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  title: string;
  type: string;
  status: string;
  roleId: string;
  confidence?: number;
  opacity: number;
  /**
   * The node's actual debate text (a crew member's claim, a synthesis decision,
   * a decision-marker rationale, ...). Carried from `BranchNode.content` so the
   * wall card can show the real content instead of just the role label.
   */
  content?: string;
}

export interface LayoutEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Semantic relation label drawn at the edge midpoint (主张 / 质疑 / 反驳 / 收敛 …). */
  label?: string;
  /** Edge relation kind — drives color and the default label. */
  relation?: "sequence" | "claim" | "critique" | "support" | "synthesis";
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  scale: number;
}

export interface BrainstormDeliberationOverlay {
  currentRound?: number | null;
  convergenceScore?: number | null;
  challengeEdges?: ChallengeEdge[];
  voteOutcome?: VoteOutcomeView | null;
}

export interface BrainstormEdgeConnection {
  from: { x: number; y: number };
  to: { x: number; y: number };
  controlOffset: number;
}

export interface BrainstormChallengeLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResolvedChallengeLabel extends BrainstormChallengeLabel {
  textColor: string;
  borderColor: string;
}

// ---------------------------------------------------------------------------
// Title Truncation
// ---------------------------------------------------------------------------

/**
 * Truncates a title to MAX_TITLE_LENGTH characters, adding ellipsis if needed.
 */
export function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return title.slice(0, MAX_TITLE_LENGTH) + "…";
}

/**
 * Wrap a node's debate text into up to `maxLines` lines for the wall card.
 * Character-based (CJK-safe: Chinese has no spaces) — greedily fills each line
 * with `maxCharsPerLine` characters; if the text overflows the last line, the
 * last line ends with an ellipsis. Returns `[]` for empty input.
 */
export function wrapBrainstormBody(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const lines: string[] = [];
  let rest = normalized;
  while (rest.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1 && rest.length > maxCharsPerLine) {
      // Last allowed line and still overflowing → truncate with ellipsis.
      lines.push(rest.slice(0, Math.max(0, maxCharsPerLine - 1)) + "…");
      rest = "";
    } else {
      lines.push(rest.slice(0, maxCharsPerLine));
      rest = rest.slice(maxCharsPerLine);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Adaptive Scaling
// ---------------------------------------------------------------------------

/**
 * Compute adaptive scale factor to fit the graph within wall bounds.
 */
export function computeAdaptiveScale(
  graphWidth: number,
  graphHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number
): number {
  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  if (graphWidth <= 0 || graphHeight <= 0) return 1;

  const scaleX = availableWidth / graphWidth;
  const scaleY = availableHeight / graphHeight;
  // Don't scale up beyond 1.5x, and don't scale below 0.2x
  return Math.max(0.2, Math.min(scaleX, scaleY, 1.5));
}

export function resolveBrainstormEdgeConnection(
  from: { x: number; y: number },
  to: { x: number; y: number },
): BrainstormEdgeConnection {
  const direction = to.x >= from.x ? 1 : -1;
  const fromX = from.x + direction * (BRAINSTORM_NODE_W / 2);
  const toX = to.x - direction * (BRAINSTORM_NODE_W / 2);
  const distance = Math.max(120, Math.abs(toX - fromX));

  return {
    from: { x: fromX, y: from.y },
    to: { x: toX, y: to.y },
    controlOffset: direction * distance * 0.42,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function labelOverlapsNode(label: BrainstormChallengeLabel, node: LayoutNode): boolean {
  const nodeLeft = node.x - BRAINSTORM_NODE_W / 2;
  const nodeRight = node.x + BRAINSTORM_NODE_W / 2;
  const nodeTop = node.y - BRAINSTORM_NODE_H / 2;
  const nodeBottom = node.y + BRAINSTORM_NODE_H / 2;
  return (
    label.x < nodeRight &&
    label.x + label.width > nodeLeft &&
    label.y < nodeBottom &&
    label.y + label.height > nodeTop
  );
}

function avoidBrainstormChallengeLabelObstacles(
  label: BrainstormChallengeLabel,
  nodes: LayoutNode[],
  canvasHeight: number,
): BrainstormChallengeLabel {
  if (!nodes.some((node) => labelOverlapsNode(label, node))) return label;
  const offsets = [-132, 132, -240, 240, -348, 348];
  for (const offset of offsets) {
    const candidate = {
      ...label,
      y: clamp(label.y + offset, 72, canvasHeight - 72 - label.height),
    };
    if (!nodes.some((node) => labelOverlapsNode(candidate, node))) {
      return candidate;
    }
  }
  return label;
}

export function resolveBrainstormChallengeLabel(
  from: { x: number; y: number },
  to: { x: number; y: number },
  summary: string,
  canvasWidth: number = CANVAS_W,
  canvasHeight: number = CANVAS_H,
): BrainstormChallengeLabel {
  const trimmed = summary.trim() || "Runtime role interaction";
  const text = trimmed.length > 34 ? `${trimmed.slice(0, 33)}…` : trimmed;
  const width = clamp(80 + text.length * 12, 240, 520);
  const height = 48;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 + (from.y <= to.y ? -132 : 132);

  return {
    text,
    width,
    height,
    x: clamp(midX - width / 2, BRAINSTORM_PADDING, canvasWidth - BRAINSTORM_PADDING - width),
    y: clamp(midY - height / 2, 72, canvasHeight - 72 - height),
  };
}

// ---------------------------------------------------------------------------
// Canvas2D Rendering
// ---------------------------------------------------------------------------

export function drawBrainstormGraph(
  ctx: CanvasRenderingContext2D,
  layout: LayoutResult | null,
  canvasWidth: number = CANVAS_W,
  canvasHeight: number = CANVAS_H,
  deliberation: BrainstormDeliberationOverlay = {},
): void {
  // Background
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  gradient.addColorStop(0, "#f0fdf9");
  gradient.addColorStop(1, "#ecfdf5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Grid decoration dots
  ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
  for (let x = 90; x < canvasWidth; x += 150) {
    for (let y = 90; y < canvasHeight; y += 150) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!layout || layout.nodes.length === 0) {
    // Empty state
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Brainstorm 协作图", canvasWidth / 2, canvasHeight / 2 - 36);
    ctx.font = "39px system-ui, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("等待协作会话…", canvasWidth / 2, canvasHeight / 2 + 42);
    return;
  }

  if (deliberation.currentRound !== null && deliberation.currentRound !== undefined) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const score = typeof deliberation.convergenceScore === "number"
      ? ` · ${(deliberation.convergenceScore * 100).toFixed(0)}%`
      : "";
    ctx.fillText(`Round ${deliberation.currentRound}${score}`, 96, 42);
  }

  // Draw edges (bezier dashed lines)
  ctx.lineWidth = 5;
  ctx.setLineDash([18, 12]);

  for (const edge of layout.edges) {
    const connection = resolveBrainstormEdgeConnection(edge.from, edge.to);

    ctx.strokeStyle = "rgba(45, 212, 191, 0.55)";
    ctx.beginPath();
    ctx.moveTo(connection.from.x, connection.from.y);
    ctx.bezierCurveTo(
      connection.from.x + connection.controlOffset,
      connection.from.y,
      connection.to.x - connection.controlOffset,
      connection.to.y,
      connection.to.x,
      connection.to.y
    );
    ctx.stroke();

    // Arrow dot
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(45, 212, 191, 0.7)";
    ctx.beginPath();
    ctx.arc(connection.to.x, connection.to.y, 9, 0, Math.PI * 2);
    ctx.fill();

    // Semantic relation label at the edge midpoint (主张 / 迭代 / 收敛 …) so the
    // flow reads as a labeled DAG rather than bare connectors.
    if (edge.label) {
      const midX = (connection.from.x + connection.to.x) / 2;
      const midY = (connection.from.y + connection.to.y) / 2 - 14;
      ctx.font = "20px system-ui, sans-serif";
      const padX = 12;
      const textW = ctx.measureText(edge.label).width;
      const boxW = textW + padX * 2;
      const boxH = 30;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(45, 212, 191, 0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#0f766e";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(edge.label, midX, midY);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    }
    ctx.setLineDash([18, 12]);
  }

  ctx.setLineDash([]);

  const nodeByRole = new Map<string, LayoutNode>();
  for (const node of layout.nodes) {
    const current = nodeByRole.get(node.roleId);
    if (!current || node.id === `role:${node.roleId}`) {
      nodeByRole.set(node.roleId, node);
    }
  }
  const challengeEdges = deliberation.challengeEdges ?? [];
  const challengeLabels: ResolvedChallengeLabel[] = [];
  for (const challenge of challengeEdges) {
    const from = nodeByRole.get(challenge.challengerRoleId);
    const to = nodeByRole.get(challenge.targetRoleId);
    if (!from || !to) continue;
    const connection = resolveBrainstormEdgeConnection(from, to);
    const arcLift = from.y <= to.y ? -96 : 96;
    const isSupport = challenge.kind === "support";
    const lineColor = isSupport ? "rgba(14, 165, 233, 0.78)" : "rgba(244, 63, 94, 0.78)";
    const labelColor = isSupport ? "#0369a1" : "#be123c";
    const borderColor = isSupport ? "rgba(14, 165, 233, 0.36)" : "rgba(244, 63, 94, 0.36)";
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(connection.from.x, connection.from.y);
    ctx.bezierCurveTo(
      connection.from.x + connection.controlOffset,
      connection.from.y + arcLift,
      connection.to.x - connection.controlOffset,
      connection.to.y + arcLift,
      connection.to.x,
      connection.to.y,
    );
    ctx.stroke();
    ctx.setLineDash([]);
    const label = avoidBrainstormChallengeLabelObstacles(
      resolveBrainstormChallengeLabel(
        from,
        to,
        challenge.summary,
        canvasWidth,
        canvasHeight,
      ),
      layout.nodes,
      canvasHeight,
    );
    challengeLabels.push({
      ...label,
      textColor: labelColor,
      borderColor,
    });
  }

  // Draw nodes
  for (const node of layout.nodes) {
    const x = node.x - BRAINSTORM_NODE_W / 2;
    const y = node.y - BRAINSTORM_NODE_H / 2;
    const typeColor = BRAINSTORM_NODE_COLORS[node.type as BranchNodeType] ?? "#64748b";

    // Apply opacity for fade-in animation
    ctx.globalAlpha = node.opacity;

    // Shadow
    ctx.shadowColor = "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;

    // Card background
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(x, y, BRAINSTORM_NODE_W, BRAINSTORM_NODE_H, 18);
    ctx.fill();

    // Border
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Left color bar
    ctx.fillStyle = typeColor;
    ctx.beginPath();
    ctx.roundRect(x, y, 12, BRAINSTORM_NODE_H, [18, 0, 0, 18]);
    ctx.fill();

    // Status dot
    const statusColor =
      node.status === "completed" ? "#10b981" :
      node.status === "active" ? "#3b82f6" :
      node.status === "failed" ? "#ef4444" : "#94a3b8";
    ctx.fillStyle = statusColor;
    ctx.beginPath();
    ctx.arc(x + BRAINSTORM_NODE_W - 36, y + 36, 12, 0, Math.PI * 2);
    ctx.fill();

    // Role label (small header so the speaker stays identifiable)
    ctx.fillStyle = typeColor;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(node.roleId.toUpperCase().replace(/_/g, " "), x + 36, y + 22);

    // Body = the node's ACTUAL debate text (a crew member's claim, a synthesis
    // decision, a decision-marker rationale, ...). Falls back to the structural
    // `title` when no content has arrived yet. Wrapped to up to 4 lines so the
    // card shows a fuller paragraph (≈ 80 chars) rather than a one-line snippet.
    const bodyText =
      node.content && node.content.trim().length > 0 ? node.content : node.title;
    const bodyLines = wrapBrainstormBody(bodyText, 20, 4);
    ctx.fillStyle = "#1e293b";
    ctx.font = "26px system-ui, sans-serif";
    let bodyY = y + 58;
    for (const line of bodyLines) {
      ctx.fillText(line, x + 36, bodyY);
      bodyY += 36;
    }

    // Confidence indicator (if present) — moved to the top-right so it never
    // collides with the multi-line body.
    if (node.confidence !== undefined) {
      ctx.fillStyle = "#64748b";
      ctx.font = "22px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `conf: ${(node.confidence * 100).toFixed(0)}%`,
        x + BRAINSTORM_NODE_W - 30,
        y + 22,
      );
      ctx.textAlign = "left";
    }

    // Reset opacity
    ctx.globalAlpha = 1;
  }

  // Labels are drawn after cards so role-to-role interactions stay visible
  // even when the curve crosses dense role branches.
  for (const label of challengeLabels) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.beginPath();
    ctx.roundRect(label.x, label.y, label.width, label.height, 14);
    ctx.fill();
    ctx.strokeStyle = label.borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = label.textColor;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label.text, label.x + 20, label.y + label.height / 2);
  }

  if (deliberation.voteOutcome) {
    const vote = deliberation.voteOutcome;
    const x = canvasWidth - 720;
    const y = 42;
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.beginPath();
    ctx.roundRect(x, y, 620, vote.isNarrow ? 166 : 126, 18);
    ctx.fill();
    ctx.strokeStyle = vote.isNarrow ? "#f43f5e" : "#14b8a6";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Vote: ${vote.winningOption}`, x + 28, y + 24);
    ctx.fillStyle = "#475569";
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText(`Margin ${(vote.margin * 100).toFixed(0)}%`, x + 28, y + 72);
    if (vote.isNarrow) {
      ctx.fillStyle = "#be123c";
      ctx.font = "bold 22px system-ui, sans-serif";
      const minority = vote.minority?.join(", ") ?? "minority noted";
      ctx.fillText(`Dissent: ${minority}`, x + 28, y + 112);
    }
  }
}
