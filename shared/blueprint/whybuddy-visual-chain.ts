/**
 * S18 · Visual generation + audit chain (V5.1).
 * C_VISGEN → T_AUDIT · C_VISREND (deterministic Mermaid from SPEC tree)
 */

import type { V5CapabilityId } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";

export type PreviewAuditResult = {
  passed: boolean;
  reason: string;
  fakeSignals: string[];
};

export function isVisualIntent(userText: string): boolean {
  return /视觉|出图|预览图|效果图|ux\.preview|模块图|界面图|mermaid/i.test(userText.trim());
}

export function isMermaidRenderIntent(userText: string): boolean {
  return /mermaid|结构图渲染|visrend|树图渲染/i.test(userText.trim());
}

/** Mechanical fake-preview detector (T_AUDIT / check_previews_real). */
export function auditPreviewReal(content: string): PreviewAuditResult {
  const text = String(content || "");
  const fakeSignals: string[] = [];
  const lower = text.toLowerCase();

  if (/lorem ipsum|placeholder|占位|复制充数|fake preview|stock image/i.test(text)) {
    fakeSignals.push("placeholder_copy");
  }
  if (/【预览·未验证】/.test(text) === false && /preview|预览/.test(text)) {
    fakeSignals.push("missing_unverified_label");
  }
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const uniq = new Set(lines);
  if (lines.length >= 6 && uniq.size <= Math.ceil(lines.length * 0.4)) {
    fakeSignals.push("duplicate_line_padding");
  }
  if (lower.includes("brainstorm console") || lower.includes("challengeedges")) {
    fakeSignals.push("protocol_noise_in_preview");
  }

  const passed = fakeSignals.length === 0;
  return {
    passed,
    reason: passed ? "preview audit passed" : `preview audit failed: ${fakeSignals.join(", ")}`,
    fakeSignals,
  };
}

/** Deterministic SPEC tree → Mermaid (C_VISREND). Same input → same bytes. */
export function renderSpecTreeToMermaid(treeContent: string): string {
  const lines = String(treeContent || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /\[.+\]/.test(l));

  const nodes: Array<{ id: string; label: string }> = [];
  for (const line of lines) {
    const m = line.match(/\[(\w+)\]\s*([^:]+)/);
    if (!m) continue;
    const id = m[1].replace(/[^a-zA-Z0-9_]/g, "_");
    const label = m[2].trim().slice(0, 40).replace(/"/g, "'");
    nodes.push({ id, label });
  }

  if (nodes.length === 0) {
    return "graph TD\n  root[\"SPEC Tree\"]";
  }

  const body = nodes
    .map((n, i) => {
      const next = nodes[i + 1];
      const edge = next ? `  ${n.id} --> ${next.id}` : "";
      return `  ${n.id}[\"${n.label}\"]${edge ? `\n${edge}` : ""}`;
    })
    .join("\n");

  return `graph TD\n${body}`;
}

export function pickVisualCapabilities(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];
  const hasDoc = (state.artifacts || []).some(
    (a) => a.kind === "doc" && (a.trustLevel === "gated_pass" || a.trustLevel === "audited")
  );
  const hasTree = (state.artifacts || []).some((a) => a.kind === "spec_tree");

  if (isMermaidRenderIntent(userText) && hasTree) {
    picks.push({ capabilityId: "outcome.visualize", roleId: "工程" });
  }
  if (isVisualIntent(userText) || (hasDoc && /预览|效果/.test(userText))) {
    picks.push({ capabilityId: "ux.preview", roleId: "产品" });
  }
  return picks;
}