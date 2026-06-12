/**
 * S13/S14 · structure.decompose chain (shared).
 * C_PROMPT → C_REDACT → C_LLM → G_SCHEMA → G_INV → C_SFALL → C_TREE
 */

import { z } from "zod";
import type { StructureGateCheck, V5SessionState } from "./v5-reasoning-state.js";

export const STRUCTURE_PROMPT_MARKERS = [
  "C_PROMPT",
  "output_schema",
  "invariants:",
  "upstream_digest",
] as const;

const SpecTreeNodeShapeSchema = z.object({
  id: z.string().min(1).max(64),
  parentId: z.string().max(64).optional(),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  type: z.enum(["root", "requirement", "design", "task", "evidence"]),
  evidenceRef: z.string().max(200).optional(),
});

export const SpecTreeShapeSchema = z.object({
  nodes: z.array(SpecTreeNodeShapeSchema).min(1).max(40),
});

export type SpecTreeNode = z.infer<typeof SpecTreeNodeShapeSchema>;
export type SpecTreeResponse = z.infer<typeof SpecTreeShapeSchema>;

const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "[REDACTED_KEY]" },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]+/gi, replacement: "Bearer [REDACTED]" },
  { pattern: /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9._-]{8,}/gi, replacement: "api_key=[REDACTED]" },
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[REDACTED_EMAIL]",
  },
];

/** C_PROMPT — build LLM instruction package for structure.decompose. */
export function buildStructurePrompt(args: {
  goalText: string;
  upstreamSummary: string;
  turnId?: string;
}): string {
  const goal = args.goalText || "目标";
  const upstream = args.upstreamSummary || "(none)";
  return (
    `【C_PROMPT · structure.decompose】\n` +
    `goal: ${goal}\n` +
    `turn: ${args.turnId || "n/a"}\n` +
    `upstream_digest:\n${upstream}\n` +
    `output_schema: nodes[]{id,parentId?,title,summary,type,evidenceRef}\n` +
    `invariants: single_root,no_cycles,parent_reachable,evidence_on_nodes`
  );
}

/** C_REDACT — strip secrets before C_LLM (S13 edge 62). */
export function redactStructurePrompt(prompt: string): {
  redacted: string;
  redactionCount: number;
} {
  let redacted = prompt;
  let redactionCount = 0;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches?.length) {
      redactionCount += matches.length;
      redacted = redacted.replace(pattern, replacement);
    }
  }
  return { redacted, redactionCount };
}

export function structurePromptChainComplete(prompt: string, redacted: string): boolean {
  return (
    STRUCTURE_PROMPT_MARKERS.every((m) => prompt.includes(m)) &&
    redacted.includes("C_PROMPT") &&
    !/sk-[a-zA-Z0-9]{20,}/.test(redacted)
  );
}

/** S14 · mechanical invariant check (G_INV). */
export function validateSpecTreeInvariants(nodes: SpecTreeNode[]): {
  passed: boolean;
  reason: string;
} {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) return { passed: false, reason: "duplicate id" };
    seen.add(n.id);
  }
  const roots = nodes.filter((n) => n.type === "root");
  if (roots.length !== 1) return { passed: false, reason: "exactly one root required" };
  const rootId = roots[0].id;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type === "root") continue;
    if (!n.parentId || !byId.has(n.parentId)) {
      return { passed: false, reason: "parent unreachable" };
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(id: string): boolean {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const n = byId.get(id);
    if (n?.parentId && !dfs(n.parentId)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  if (!dfs(rootId)) return { passed: false, reason: "cycle detected" };
  for (const n of nodes) {
    if (n.type !== "evidence" && !n.evidenceRef) {
      return { passed: false, reason: "each node needs evidenceRef" };
    }
  }
  return { passed: true, reason: "invariants ok" };
}

export function buildTemplateTree(goalText: string): SpecTreeResponse {
  const slug = goalText.slice(0, 40) || "product";
  return {
    nodes: [
      { id: "root", type: "root", title: slug, summary: `SPEC root for ${slug}`, evidenceRef: "goal:text" },
      { id: "req-1", parentId: "root", type: "requirement", title: "核心需求", summary: "MVP 功能范围", evidenceRef: "upstream:clarification" },
      { id: "des-1", parentId: "req-1", type: "design", title: "架构约束", summary: "RBAC + 审计", evidenceRef: "upstream:risk" },
      { id: "task-1", parentId: "des-1", type: "task", title: "交付任务", summary: "第一周可执行项", evidenceRef: "upstream:synthesis" },
      { id: "ev-1", parentId: "task-1", type: "evidence", title: "验收证据", summary: "EARS 用例占位", evidenceRef: "upstream:report" },
    ],
  };
}

export function formatTreeContent(
  tree: SpecTreeResponse,
  meta: { source: string; gateNote?: string }
): string {
  const lines = tree.nodes.map((n) => {
    const indent = n.type === "root" ? "" : n.parentId === "root" ? "├─ " : "│  └─ ";
    return `${indent}[${n.type}] ${n.title}: ${n.summary} (evidence: ${n.evidenceRef || "n/a"})`;
  });
  const header = meta.gateNote ? `${meta.gateNote}\n` : "";
  return `${header}【SPEC Tree · ${meta.source}】\n${lines.join("\n")}`;
}

export function collectStructureUpstreamSummary(
  state: V5SessionState,
  inputArtifactIds: string[]
): string {
  const stale = new Set(state.staleArtifactIds || []);
  const trusted = (state.artifacts || []).filter(
    (a) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  );
  const pool =
    inputArtifactIds.length > 0
      ? trusted.filter((a) => inputArtifactIds.includes(a.id))
      : trusted;
  return pool
    .slice(-6)
    .map((a) => `- [${a.kind}] ${a.title}: ${String(a.summary || "").slice(0, 120)}`)
    .join("\n");
}

/** Parse executor gateLedger strings into durable StructureGateCheck rows (T_LEDGER). */
export function parseStructureGateLedger(
  entries: string[],
  ctx: { turnId: string; runId: string }
): StructureGateCheck[] {
  const createdAt = new Date().toISOString();
  return entries.map((entry, idx) => {
    const parts = entry.split(":");
    const gateId = parts[0] || "unknown";
    let attempt: number | undefined;
    let status: StructureGateCheck["status"] = "passed";
    let reason: string | undefined;

    if (gateId === "G_SCHEMA" || gateId === "G_INV") {
      const attemptPart = parts[1] || "";
      if (attemptPart.startsWith("attempt")) {
        attempt = parseInt(attemptPart.slice("attempt".length), 10) || undefined;
      }
      const outcome = parts[2];
      status = outcome === "passed" ? "passed" : "failed";
      reason = parts.slice(3).join(":") || (outcome !== "passed" ? outcome : undefined);
    } else if (gateId === "C_SFALL") {
      status = "failed";
      reason = parts[1];
    } else if (gateId === "C_REDACT") {
      reason = parts[1] ? `redactions=${parts[1]}` : undefined;
    }

    return {
      id: `sg-${ctx.runId}-${idx}`,
      turnId: ctx.turnId,
      runId: ctx.runId,
      gateId,
      attempt,
      status,
      reason,
      createdAt,
    };
  });
}

export function structureGateLedgerConversationLines(
  checks: StructureGateCheck[]
): string[] {
  return checks
    .filter((c) => c.gateId === "G_SCHEMA" || c.gateId === "G_INV")
    .map(
      (c) =>
        `[T_LEDGER] ${c.gateId} phase=structure attempt=${c.attempt ?? 0} status=${c.status}` +
        (c.reason ? ` reason=${c.reason}` : "")
    );
}

export type StructureDecomposeResult = {
  title: string;
  summary: string;
  content: string;
  provenance: string;
  payload: {
    schemaPassed: boolean;
    invariantPassed: boolean;
    gateLedger: string[];
    promptExcerpt?: string;
    redactedExcerpt?: string;
  };
};

/** Core S13/S14 pipeline after prompt/redact (LLM injected). */
export async function runStructureDecomposePipeline(args: {
  goalText: string;
  userPrompt: string;
  gateLedgerPrefix: string[];
  systemPrompt: string;
  llmCall: (attempt: number) => Promise<Record<string, unknown> | null>;
}): Promise<StructureDecomposeResult> {
  const gateLedger = [...args.gateLedgerPrefix];
  let schemaPassed = false;
  let invariantPassed = false;

  for (let attempt = 0; attempt <= 1; attempt++) {
    const json = await args.llmCall(attempt);
    if (!json) {
      gateLedger.push(`G_SCHEMA:attempt${attempt + 1}:non_json`);
      continue;
    }
    const parsed = SpecTreeShapeSchema.safeParse(json);
    if (!parsed.success) {
      gateLedger.push(`G_SCHEMA:attempt${attempt + 1}:failed`);
      continue;
    }
    schemaPassed = true;
    gateLedger.push(`G_SCHEMA:attempt${attempt + 1}:passed`);

    const inv = validateSpecTreeInvariants(parsed.data.nodes);
    if (!inv.passed) {
      gateLedger.push(`G_INV:attempt${attempt + 1}:failed:${inv.reason}`);
      continue;
    }
    invariantPassed = true;
    gateLedger.push(`G_INV:attempt${attempt + 1}:passed`);

    const provenance: "llm" | "llm_fallback" = attempt === 0 ? "llm" : "llm_fallback";
    return {
      title: "SPEC Tree",
      summary: `结构拆解完成 (${provenance})`,
      content: formatTreeContent(parsed.data, { source: provenance, gateNote: gateLedger.join(" · ") }),
      provenance: provenance === "llm" ? "llm" : "llm_fallback",
      payload: {
        schemaPassed,
        invariantPassed,
        gateLedger,
        promptExcerpt: args.userPrompt.slice(0, 200),
      },
    };
  }

  gateLedger.push("C_SFALL:template");
  const tree = buildTemplateTree(args.goalText);
  invariantPassed = validateSpecTreeInvariants(tree.nodes).passed;
  return {
    title: "SPEC Tree (deterministic fallback)",
    summary: "Schema/不变量失败 · 走确定性兜底树",
    content: formatTreeContent(tree, { source: "template", gateNote: gateLedger.join(" · ") }),
    provenance: "template",
    payload: {
      schemaPassed,
      invariantPassed,
      gateLedger,
      promptExcerpt: args.userPrompt.slice(0, 200),
    },
  };
}