/**
 * S19 · Delivery chain after goal clear (V5.1).
 * C_TREE → C_DOC → C_ACC → C_PACK → C_HAND → T_MERGE → DONE
 */

import type { V5CapabilityId } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";
import { renderSpecTreeToMermaid } from "./whybuddy-visual-chain.js";

export function isDeliveryIntent(userText: string): boolean {
  const t = userText.trim();
  return /落地|交付|打包|ship|handoff|验收包/.test(t);
}

export function isReviewPassIntent(userText: string): boolean {
  return /评审通过|通过交付|可以交付|批准交付|RV通过/.test(userText.trim());
}

/** S20 · RV reject → same recycle as INTERV challenge. */
export function isReviewRejectIntent(userText: string): boolean {
  return /评审打回|打回重审|不通过交付|退回修改|RV打回/.test(userText.trim());
}

/** S20 · RV gate: lighter than full ship — trusted report + clear goal. */
export function evaluateReviewPassGate(state: V5SessionState): {
  passed: boolean;
  reason: string;
} {
  const report = latestTrustedReport(state);
  const passed = Boolean(report) && state.goal?.status === "clear";
  return {
    passed,
    reason: passed ? "RV pass: trusted report + clear goal" : "RV blocked: missing trusted report or goal not clear",
  };
}

export function latestTrustedReport(state: V5SessionState) {
  const stale = new Set(state.staleArtifactIds || []);
  const reports = (state.artifacts || []).filter(
    (a) =>
      a.kind === "report" &&
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stale.has(a.id)
  );
  return reports[reports.length - 1];
}

export function isPreviewDissatisfiedIntent(userText: string): boolean {
  return /不满意|重新预演|预演不行|效果不对|ITER|换个预览/.test(userText.trim());
}

/** Ordered ship pipeline capabilities (mechanical). */
export const DELIVERY_PIPELINE: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [
  { capabilityId: "document.draft", roleId: "工程" },
  { capabilityId: "traceability.matrix", roleId: "综合" },
  { capabilityId: "task.write", roleId: "产品" },
  { capabilityId: "handoff.package", roleId: "工程" },
];

export function pickDeliveryCapabilities(
  state: V5SessionState
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  if (state.goal?.status !== "clear") return [];
  const done = new Set(
    trustedArtifacts(state)
      .map((a) => a.producedBy?.capabilityId)
      .filter(Boolean)
  );
  return DELIVERY_PIPELINE.filter((p) => !done.has(p.capabilityId));
}

export function hasSpecTreeArtifact(state: V5SessionState): boolean {
  return trustedArtifacts(state).some((a) => a.kind === "spec_tree");
}

/** Prepend structure.decompose when user asks for tree before delivery. */
export function pickStructureBeforeDelivery(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];
  if (
    (/拆解|spec tree|结构树/i.test(userText) || isDeliveryIntent(userText)) &&
    !hasSpecTreeArtifact(state)
  ) {
    picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }
  return picks;
}

/** Required sections in handoff.package content (S19 mechanical checklist). */
export const HANDOFF_PACKAGE_MARKERS = [
  "report.md",
  "handoff.zip",
  "接口契约",
  "验收用例",
  "未决项",
  "台账导出",
] as const;

export function handoffPackageHasRequiredSections(content: string): boolean {
  return HANDOFF_PACKAGE_MARKERS.every((m) => content.includes(m));
}

export function traceabilityMatrixHasFiveColumns(content: string): boolean {
  const headers = ["需求", "设计", "任务", "证据", "用例"];
  return headers.every((h) => content.includes(h));
}

export function traceabilityMatrixReferencesIds(
  content: string,
  artifactIds: string[]
): boolean {
  return artifactIds.length === 0 || artifactIds.every((id) => content.includes(id));
}

export function trustedArtifacts(state: V5SessionState) {
  const stale = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  );
}

/** S19 edge 97: handoff bundles traceability.matrix artifact. */
export function handoffBundlesMatrixArtifact(content: string, matrixId: string): boolean {
  return content.includes("C_MATRIX→C_HAND") && content.includes(matrixId);
}

/** S19 edge 98: handoff bundles deterministic mermaid render (C_VISREND). */
export function handoffBundlesVisualRender(
  content: string,
  artifactId?: string
): boolean {
  const hasSection = /C_VISREND→C_HAND/.test(content) && /```mermaid/.test(content);
  return artifactId ? hasSection && content.includes(artifactId) : hasSection;
}

/** S19 edge 99: handoff bundles visual preview with source + provenance labels. */
export function handoffBundlesVisualPreview(
  content: string,
  opts?: { artifactId?: string; sourceCap?: string }
): boolean {
  const hasSection =
    /C_VISGEN→C_HAND/.test(content) &&
    /预览·未验证/.test(content) &&
    /provenance=/.test(content) &&
    /source=/.test(content);
  if (!opts) return hasSection;
  if (opts.artifactId && !content.includes(opts.artifactId)) return false;
  if (opts.sourceCap && !content.includes(`source=${opts.sourceCap}`)) return false;
  return hasSection;
}

/** Build structured handoff.package body for runtime / server executors. */
export function buildHandoffPackageContent(state: V5SessionState): string {
  const goal = state.goal?.text || "目标";
  const trusted = trustedArtifacts(state);
  const report = trusted.filter((a) => a.kind === "report").pop();
  const openGaps = (state.coverageGaps || []).filter((g) => g.status === "open");
  const runCount = (state.capabilityRuns || []).length;
  const ledgerExports = (state.flowBoundaryLedger || []).length;

  const matrices = trusted.filter((a) => a.producedBy?.capabilityId === "traceability.matrix");
  const previews = trusted.filter((a) => a.kind === "preview");
  const mermaidRenders = previews.filter(
    (a) =>
      a.producedBy?.capabilityId === "outcome.visualize" &&
      /```mermaid/.test(String(a.content || ""))
  );
  const visualPreviews = previews.filter(
    (a) =>
      a.producedBy?.capabilityId === "ux.preview" ||
      (a.producedBy?.capabilityId === "outcome.visualize" && !mermaidRenders.includes(a))
  );

  const matrixSection =
    matrices.length > 0
      ? matrices
          .map(
            (m) =>
              `附: 可追溯矩阵 (C_MATRIX→C_HAND)\n` +
              `matrixId: ${m.id}\n` +
              String(m.content || m.summary || "").slice(0, 600)
          )
          .join("\n\n")
      : "";

  const trees = trusted.filter((a) => a.kind === "spec_tree");
  const visrendSection = (() => {
    const blocks: string[] = [];
    for (const art of mermaidRenders) {
      blocks.push(
        `附: 视觉渲染 (C_VISREND→C_HAND)\n` +
          `artifactId: ${art.id} · provenance=${art.provenance}\n` +
          String(art.content || "").slice(0, 800)
      );
    }
    if (blocks.length === 0 && trees.length > 0) {
      const tree = trees[trees.length - 1];
      const mermaid = renderSpecTreeToMermaid(String(tree.content || ""));
      blocks.push(
        `附: 视觉渲染 (C_VISREND→C_HAND)\n` +
          `artifactId: ${tree.id} · provenance=rendered · source=spec_tree\n` +
          `\`\`\`mermaid\n${mermaid}\n\`\`\``
      );
    }
    return blocks.join("\n\n");
  })();

  const visgenSection =
    visualPreviews.length > 0
      ? visualPreviews
          .map(
            (p) =>
              `附: 视觉预览 (C_VISGEN→C_HAND · 标来源)\n` +
              `artifactId: ${p.id} · source=${p.producedBy?.capabilityId} · provenance=${p.provenance}\n` +
              String(p.content || p.summary || "").slice(0, 600)
          )
          .join("\n\n")
      : "";

  const bundledSections = [matrixSection, visrendSection, visgenSection].filter(Boolean).join("\n\n");

  return (
    `【Handoff Package】\n` +
    `report.md: ${report?.title || "报告摘要"}\n` +
    `handoff.zip: bundle\n` +
    `接口契约草稿: OpenAPI sketch · REST endpoints\n` +
    `验收用例: EARS-1..EARS-${Math.max(1, trusted.length)}\n` +
    `未决项: ${openGaps.length} open gap(s)\n` +
    `台账导出: ${runCount} capabilityRuns · ${ledgerExports} flowBoundary checks\n` +
    `目标: ${goal}\n` +
    `结论: ${state.goal?.status}\n` +
    `报告摘要:\n${String(report?.content || report?.summary || "").slice(0, 800)}` +
    (bundledSections ? `\n\n--- bundled artifacts ---\n${bundledSections}` : "")
  );
}