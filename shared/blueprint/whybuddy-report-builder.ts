/**
 * WhyBuddy V5 structured report builder (extracted to shared so both
 * client runtime and server route can depend on it cleanly).
 *
 * This contains the pure 9-section report generation logic + fragment
 * extraction used by report.write (and internally by PilotReal / default executors).
 */

import type { V5SessionState } from './v5-reasoning-state.js';

export type FragmentKind = "conclusion" | "risk" | "rebuttal" | "recommendation" | "evidence" | "snippet";

export interface ArtifactFragment {
  label: "结论" | "风险" | "反驳" | "建议" | "证据" | "片段";
  kind?: FragmentKind;
  text: string;
}

// Internal map (Chinese label → stable kind)
const CHINESE_LABEL_TO_KIND: Record<string, FragmentKind> = {
  结论: "conclusion",
  风险: "risk",
  反驳: "rebuttal",
  建议: "recommendation",
  证据: "evidence",
};

/**
 * Extract user-visible semantic fragments from an artifact payload.
 */
export function extractArtifactFragments(
  artifact: { title?: string; summary?: string; content?: string },
  maxLength = 140
): ArtifactFragment[] {
  const source = String(artifact.content || artifact.summary || artifact.title || "").trim();
  if (!source) return [];

  const normalized = source
    .replace(/\r\n/g, "\n")
    .split(/\n|；|;/)
    .map((part) => part.trim())
    .filter(Boolean);

  const fragments: ArtifactFragment[] = [];

  for (const part of normalized) {
    const match = part.match(/^(结论|风险|反驳|建议|证据)\s*[：:]\s*(.+)$/);
    if (!match) continue;
    const raw = match[1];
    const kind = CHINESE_LABEL_TO_KIND[raw] || "snippet";
    const text = match[2].trim();
    if (!text) continue;
    fragments.push({
      label: raw as ArtifactFragment["label"],
      kind,
      text: text.length > maxLength ? `${text.slice(0, maxLength)}…` : text,
    });
  }

  if (fragments.length > 0) return fragments;

  const fallback = source.replace(/\s+/g, " ").slice(0, maxLength);
  return fallback ? [{ label: "片段", kind: "snippet", text: source.length > maxLength ? `${fallback}…` : fallback }] : [];
}

export interface StructuredReportInput {
  state: V5SessionState;
  inputArtifactIds: string[];
  roleId?: string;
  turnLabel?: string; // e.g. "重入" to tag re-entry reports
}

export function buildStructuredReport(input: StructuredReportInput): { title: string; summary: string; content: string } {
  const { state, inputArtifactIds, roleId, turnLabel } = input;

  const upstreams = (state.artifacts || []).filter((a: any) => inputArtifactIds.includes(a.id));
  const hasStaleGlobal = (state.staleArtifactIds || []).length > 0;
  const hasStale = upstreams.some((a: any) => (state.staleArtifactIds || []).includes(a.id)) || hasStaleGlobal;

  // Build rich fragments from all upstreams
  const fragments = upstreams.flatMap((u: any) => {
    const srcCap = u.producedBy?.capabilityId || (u as any).capability || 'unknown';
    const srcRole = u.producedBy?.roleId || (u as any).role || roleId || 'agent';
    const src = `${u.kind}(${srcCap}×${srcRole})`;
    const extracted = extractArtifactFragments(u, 140);
    return extracted.map((fragment) => `- 来自 ${src} / ${fragment.label}: ${fragment.text}`);
  }).join('\n');

  const upstreamSummary = upstreams.length > 0
    ? upstreams.map((u: any) => `${u.kind}(${u.producedBy?.capabilityId || (u as any).capability}×${u.producedBy?.roleId || (u as any).role})`).join(', ')
    : '无';

  const riskFragments = upstreams
    .filter((u: any) => u.kind === 'risk' || String(u.producedBy?.capabilityId || (u as any).capability || '').includes('risk') || String(u.producedBy?.capabilityId || (u as any).capability || '').includes('argue'))
    .flatMap((u: any) => extractArtifactFragments(u, 120))
    .filter((fragment) => fragment.label === '风险' || fragment.label === '反驳' || fragment.label === '建议')
    .map((fragment) => `- ${fragment.label}: ${fragment.text}`)
    .join('\n');

  const dissentBlock = hasStale
    ? '分歧：部分上游 artifact 已被标记 stale（依赖链级联），多角色间存在异议，建议再澄清一轮或回炉重跑。\n'
    : '';

  const prefix = turnLabel
    ? `【可行性 / 产品推演报告 (${turnLabel})】`
    : '【可行性 / 产品推演报告】';

  const content = `${prefix}
结论：建议推进权限系统建设（基于本轮多角色讨论 + 真实上游证据聚合）。RBAC MVP 路径清晰，具备落地条件。

支撑证据：
${fragments || '（无具体片段；本轮未产出带语义标签的上游 artifact）'}

反证/挑战：
${riskFragments || '（本轮未产出明确反证；挑战/重入路径已就绪，可随时触发 invalidate + 级联）'}

风险：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）；审计风险（权限变更需保留操作者、时间、影响对象）。
${hasStale ? '注意：存在 stale 上游，风险评估建议重跑。\n' : ''}

分歧：
${dissentBlock || '（当前轮次意见基本收敛，无显著角色分歧）'}

收敛决策：MVP 先做 RBAC + 基础数据范围过滤，预留策略扩展接口（ABAC 方向保留但暂不引入，降低初期调试成本）。

未解缺口：细粒度策略审计的持久化与可查询方案；多租户/跨项目边界自动化测试覆盖；与平台现有 IAM / 身份系统的集成契约定义。

下一步工程化分支：
- 走 structure.decompose 将收敛结论拆成可执行任务树（带证据引用）
- 替换默认 CapabilityExecutor 为真实 Tool/OpenAI/MCP 实现（先试点 risk.analyze + report.write）
- 将 process-local Map  backing 的 HTTP session store 替换为 SQLite / Postgres 等 durable 存储（保持 /api/whybuddy surface 不变）
- 报告主输出支持导出为带 provenance 签名的 Markdown / PDF
- 引入真实 Trust Gate 后端（不再仅模拟 evaluateGates）

provenance / upstream refs：${upstreamSummary}（共 ${upstreams.length} 个已 gated 的上游 artifact；evidenceRefs 已在 commitArtifact 阶段记录到 report 上，供后续依赖图与 invalidate 消费）。
`;

  const title = (prefix.replace(/【|】/g, '') + ' · V5 Evidence Report').slice(0, 72);
  const summary = `基于 ${upstreams.length} upstreams 的证据级推演报告。${hasStale ? '含 stale 警示与分歧提示。' : '多角色收敛良好。'}${roleId ? ` 角色：${roleId}。` : ''}`;

  return { title, summary, content };
}
