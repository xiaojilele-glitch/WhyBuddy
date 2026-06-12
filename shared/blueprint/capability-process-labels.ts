import type { V5CapabilityId } from "./contracts.js";
import { ALL_V5_CAPABILITIES } from "./contracts.js";
import { extractGithubRepoSlug, findGithubUrlInTexts } from "./whybuddy-github-context.js";

export type ProcessCapabilityKind = "think" | "action" | "deliver";

export type EvidenceFallbackReason = "no_github_clue" | "evidence_fetch_failed";

export type ProcessLabelContext = {
  repoSlug?: string;
  toolName?: string;
  skillName?: string;
  evidenceCount?: number;
  fileCount?: number;
  /** S15 evidence.search / repo.inspect: why external seam did not ground (for tool trace copy). */
  evidenceFallbackReason?: EvidenceFallbackReason;
};

export type CapabilityProcessEntry = {
  kind: ProcessCapabilityKind;
  liveLabel: string | ((ctx: ProcessLabelContext) => string);
  traceTemplate?: string | ((ctx: ProcessLabelContext, ok: boolean) => string);
};

export const EXTERNAL_ACTION_CAPABILITIES = new Set<V5CapabilityId>([
  "evidence.search",
  "repo.inspect",
  "mcp.call",
  "skill.invoke",
  "memory.recall",
]);

export const CAPABILITY_PROCESS_LABELS: Record<V5CapabilityId, CapabilityProcessEntry> = {
  "intent.parse": { kind: "think", liveLabel: "正在理解你的目标" },
  "intent.clarify": { kind: "think", liveLabel: "正在澄清需求" },
  "context.collect": { kind: "think", liveLabel: "正在整理上下文" },
  "source.classify": { kind: "think", liveLabel: "正在归类信息来源" },
  "gap.ask": { kind: "think", liveLabel: "正在定位信息缺口" },
  "question.expand": { kind: "think", liveLabel: "正在展开关键问题" },
  "assumption.validate": { kind: "think", liveLabel: "正在校验假设" },
  "route.generate": { kind: "think", liveLabel: "正在生成可行路线" },
  "route.compare": { kind: "think", liveLabel: "正在对比路线" },
  "tradeoff.evaluate": { kind: "think", liveLabel: "正在权衡取舍" },
  "scenario.simulate": { kind: "think", liveLabel: "正在模拟场景" },
  "execution.prepare": { kind: "think", liveLabel: "正在准备执行方案" },
  "risk.analyze": { kind: "think", liveLabel: "正在分析风险" },
  "counter.argue": { kind: "think", liveLabel: "正在寻找反方观点" },
  "argument.expand": { kind: "think", liveLabel: "正在展开论证" },
  "critique.generate": { kind: "think", liveLabel: "正在自我挑刺" },
  "rebuttal.resolve": { kind: "think", liveLabel: "正在消解分歧" },
  "evidence.search": {
    kind: "action",
    liveLabel: "⚡ 正在检索外部证据",
    traceTemplate: (ctx, ok) => {
      if (ok) {
        return `检索了外部证据${ctx.evidenceCount != null ? `（${ctx.evidenceCount} 条）` : ""}`;
      }
      if (ctx.evidenceFallbackReason === "no_github_clue") {
        return "未找到 GitHub 仓库线索，使用会话内综合（未发起外部检索）";
      }
      return "外部证据检索失败，本轮未引入外部证据";
    },
  },
  "repo.inspect": {
    kind: "action",
    liveLabel: (ctx) =>
      ctx.repoSlug
        ? `⚡ 正在检查代码仓库 ${ctx.repoSlug}…`
        : "⚡ 正在检查代码仓库…",
    traceTemplate: (ctx, ok) =>
      ok
        ? `检查了代码仓库 ${ctx.repoSlug || ""}${ctx.fileCount != null ? `（${ctx.fileCount} 个文件）` : ""}`.trim()
        : "代码仓库检索失败，本轮未引入外部证据",
  },
  "mcp.call": {
    kind: "action",
    liveLabel: (ctx) => `⚡ 正在调用 ${ctx.toolName || "外部工具"}…`,
    traceTemplate: (ctx, ok) =>
      ok ? `调用了 ${ctx.toolName || "外部工具"}` : `${ctx.toolName || "外部工具"} 调用失败，本轮未引入外部证据`,
  },
  "skill.invoke": {
    kind: "action",
    liveLabel: (ctx) => `⚡ 正在调用技能 ${ctx.skillName || "未命名"}…`,
    traceTemplate: (ctx, ok) =>
      ok
        ? `调用了技能 ${ctx.skillName || "未命名"}`
        : `技能 ${ctx.skillName || "未命名"} 调用失败，本轮未引入外部证据`,
  },
  "memory.recall": {
    kind: "action",
    liveLabel: "⚡ 正在回忆历史会话",
    traceTemplate: (_ctx, ok) => (ok ? "引用了历史会话" : "历史会话检索失败，本轮未引入外部证据"),
  },
  "structure.decompose": { kind: "deliver", liveLabel: "正在拆解结构" },
  "document.draft": { kind: "deliver", liveLabel: "正在起草文档" },
  "requirement.write": { kind: "deliver", liveLabel: "正在编写需求" },
  "design.write": { kind: "deliver", liveLabel: "正在编写设计" },
  "task.write": { kind: "deliver", liveLabel: "正在编写任务清单" },
  "ux.preview": { kind: "deliver", liveLabel: "正在生成交互预览" },
  "outcome.visualize": { kind: "deliver", liveLabel: "正在生成效果预览" },
  "instruction.package": { kind: "deliver", liveLabel: "正在打包执行指令" },
  "synthesis.merge": { kind: "deliver", liveLabel: "正在综合各方结论" },
  "report.write": { kind: "deliver", liveLabel: "正在撰写可行性报告" },
  "traceability.matrix": { kind: "deliver", liveLabel: "正在构建追溯矩阵" },
  "handoff.package": { kind: "deliver", liveLabel: "正在打包交接材料" },
};

export type LiveAction = { label: string; external: boolean };
export type ActionTrace = { label: string; ok: boolean; target?: string; turnId?: string };

function resolveLabel(
  value: string | ((ctx: ProcessLabelContext) => string),
  ctx: ProcessLabelContext
): string {
  return typeof value === "function" ? value(ctx) : value;
}

export function buildProcessLabelContext(
  capabilityId: V5CapabilityId,
  userText: string,
  goalText: string
): ProcessLabelContext {
  const repoUrl = findGithubUrlInTexts(userText, goalText);
  const repoSlug = repoUrl ? extractGithubRepoSlug(repoUrl) : undefined;

  const toolMatch = userText.match(/(?:调用|使用)\s*([A-Za-z0-9_.-]+)\s*(?:工具|MCP)/i);
  const skillMatch = userText.match(/(?:技能|skill)[：:\s]+([^\s，,。.]+)/i);

  return {
    repoSlug,
    toolName: toolMatch?.[1],
    skillName: skillMatch?.[1],
  };
}

export function getLiveAction(
  capabilityId: V5CapabilityId,
  ctx: ProcessLabelContext
): LiveAction {
  const entry = CAPABILITY_PROCESS_LABELS[capabilityId];
  const label = resolveLabel(entry.liveLabel, ctx);
  return { label, external: entry.kind === "action" };
}

export function isExternalProvenance(provenance?: string): boolean {
  return (
    provenance === "mcp:github" ||
    provenance === "web:search" ||
    provenance === "repo:static" ||
    provenance === "llm"
  );
}

export function inferProcessContextFromExec(
  capabilityId: V5CapabilityId,
  base: ProcessLabelContext,
  exec?: { content?: string; title?: string; summary?: string; provenance?: string } | null
): ProcessLabelContext {
  const ctx = { ...base };
  if (!exec) return ctx;

  try {
    const parsed = JSON.parse(exec.content || "");
    if (parsed?.repository && !ctx.repoSlug) {
      ctx.repoSlug = String(parsed.repository);
    }
    if (Array.isArray(parsed)) ctx.evidenceCount = parsed.length;
    if (typeof parsed?.workflowCount === "number") ctx.fileCount = parsed.workflowCount;
    if (typeof parsed?.detectedStack?.length === "number") {
      ctx.fileCount = parsed.detectedStack.length;
    }
  } catch {
    /* not json */
  }

  if (capabilityId === "mcp.call" && exec.title) {
    const m = exec.title.match(/:\s*(.+)$/);
    if (m) ctx.toolName = m[1].trim();
  }
  if (capabilityId === "skill.invoke" && exec.title) {
    const m = exec.title.match(/:\s*(.+)$/);
    if (m) ctx.skillName = m[1].trim();
  }

  if (
    (capabilityId === "evidence.search" || capabilityId === "repo.inspect") &&
    exec.provenance !== "mcp:github" &&
    exec.provenance !== "web:search" &&
    exec.provenance !== "repo:static"
  ) {
    const blob = `${exec.summary || ""} ${exec.content || ""} ${exec.title || ""}`;
    if (/全网检索.*不可用|Web Search.*failed|web_search_failed/i.test(blob)) {
      ctx.evidenceFallbackReason = "evidence_fetch_failed";
    } else if (/GitHub 证据收集不可用|收集证据时失败|仓库检索失败|repo_fetch_failed|evidence_fetch_failed/i.test(blob)) {
      ctx.evidenceFallbackReason = "evidence_fetch_failed";
    } else if (
      /未找到可检索的公开仓库|未找到 GitHub|未发起外部网络检索|未引入外部仓库|no_github_clue/i.test(blob)
    ) {
      ctx.evidenceFallbackReason = "no_github_clue";
    } else if (!ctx.repoSlug) {
      ctx.evidenceFallbackReason = "no_github_clue";
    } else {
      ctx.evidenceFallbackReason = "evidence_fetch_failed";
    }
  }

  return ctx;
}

export function buildActionTrace(
  capabilityId: V5CapabilityId,
  ok: boolean,
  ctx: ProcessLabelContext,
  exec?: { provenance?: string } | null
): ActionTrace | null {
  const entry = CAPABILITY_PROCESS_LABELS[capabilityId];
  if (entry.kind !== "action" || !entry.traceTemplate) return null;

  const externalOk =
    ok && exec != null && (isExternalProvenance(exec.provenance) || capabilityId === "memory.recall");
  const effectiveOk = EXTERNAL_ACTION_CAPABILITIES.has(capabilityId)
    ? externalOk
    : ok;

  const raw =
    typeof entry.traceTemplate === "function"
      ? entry.traceTemplate(ctx, effectiveOk)
      : entry.traceTemplate;
  const label = effectiveOk ? `${raw} ✓` : raw;
  const target =
    ctx.repoSlug || ctx.toolName || ctx.skillName || undefined;

  return { label, ok: effectiveOk, target };
}

/** Guard: every pool capability must have a process label (B1). */
export function assertFullProcessLabelCoverage(): void {
  for (const id of ALL_V5_CAPABILITIES) {
    if (!CAPABILITY_PROCESS_LABELS[id]) {
      throw new Error(`Missing CAPABILITY_PROCESS_LABELS entry for ${id}`);
    }
  }
}