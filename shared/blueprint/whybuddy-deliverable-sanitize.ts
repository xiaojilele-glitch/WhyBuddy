/**
 * Deterministic deliverable sanitizer for WhyBuddy narration fallback (S1).
 * Single source of truth — client must NOT duplicate this logic.
 */

export type GoalStatusForNarration = "clear" | "needs_refinement" | "not_recommended" | undefined;

const ENGINEERING_CUTOFF_MARKERS = [
  "\n下一步工程化分支",
  "\nprovenance / upstream refs",
] as const;

const LINE_DROP_RE =
  /provenance|evidencerefs|mcp|sqlite|postgres|session\s*store|invalidate/i;

const TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/artifacts?/gi, "产物"],
  [/stale/gi, "已过期"],
  [/upstreams?/gi, "上游依据"],
  [/gated/gi, "已校验"],
  [/capabilityexecutor/gi, "分析能力"],
  [/capabilities/gi, "分析能力"],
  [/capability/gi, "分析能力"],
  [/trust\s*gate/gi, "信任校验"],
];

/** Strip engineering tail and internal vocabulary from raw deliverable text. */
export function sanitizeDeliverable(raw: string): string {
  let text = String(raw || "");

  let cutAt = -1;
  for (const marker of ENGINEERING_CUTOFF_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx >= 0 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
  }
  if (cutAt >= 0) text = text.slice(0, cutAt);

  text = text.replace(/【|】/g, "");

  for (const [re, repl] of TERM_REPLACEMENTS) {
    text = text.replace(re, repl);
  }

  text = text
    .split("\n")
    .filter((line) => !LINE_DROP_RE.test(line))
    .join("\n");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Mechanical goal.status → user-facing status line (transcribe only, never adjudicate). */
export function goalStatusNarrationLine(status: GoalStatusForNarration): string {
  if (status === "clear") return "当前结论状态（机械裁决）：已收敛。";
  if (status === "not_recommended") return "当前结论状态（机械裁决）：不建议推进。";
  return "当前结论状态（机械裁决）：待细化。";
}

export type SkippedCapabilitySummary = { capabilityId?: string; reason: string };

export type FallbackNarrationInput = {
  userText: string;
  goalStatus: GoalStatusForNarration;
  goalStatusBefore?: GoalStatusForNarration;
  selectedCount: number;
  interventionIntent?: string | null;
  mainArtifactContent?: string | null;
  planReason?: string | null;
  skipped?: SkippedCapabilitySummary[];
  /** Server: sanitize deliverable. Client local fallback: truncate only. */
  sanitizeMainArtifact?: boolean;
  mainArtifactMaxLen?: number;
};

/** S6-4: banned outward-reference + mechanical-count phrases in fallback templates. */
export const FALLBACK_BANNED_RE =
  /可通过|详见|请查看|证据链」查看|完成了.*项分析/;

function goalStatusChanged(
  before: GoalStatusForNarration,
  after: GoalStatusForNarration
): boolean {
  return before !== after;
}

/** Map DLEDGER skipped reasons / plan.reason to user-facing idle-turn copy (S6-6). */
export function humanizeIdleTurnReason(
  planReason?: string | null,
  skipped?: SkippedCapabilitySummary[]
): string {
  const reasons = new Set((skipped || []).map((s) => s.reason));
  if (reasons.has("blocked_by_budget") || /BUDGET_EXCEEDED/i.test(planReason || "")) {
    return "预算已达上限，系统暂不再追加分析。";
  }
  if (
    reasons.has("stopped_by_contract_sufficiency") ||
    /CONTRACT_SUFFICIENT/i.test(planReason || "")
  ) {
    return "近期分析已覆盖该方向，暂无必要重复展开。";
  }
  if (/GCOV_BLOCKED/i.test(planReason || "")) {
    return "覆盖契约仍有缺口，暂不能推进收敛。";
  }
  if (planReason) {
    return "调度器判断本轮无需新增动作。";
  }
  return "当前状态已较饱和，本轮未挑选新的分析能力。";
}

function formatMainArtifactBody(
  raw: string | null | undefined,
  opts: { sanitize?: boolean; maxLen?: number }
): string {
  if (!raw) return "";
  let text = String(raw);
  if (opts.sanitize) {
    text = sanitizeDeliverable(text);
  }
  if (opts.maxLen != null && opts.maxLen > 0) {
    text = text.slice(0, opts.maxLen);
  }
  return text.trim();
}

/** S6-6: honest template when selected.length === 0 (no outward refs, no false convergence). */
export function buildIdleTurnFallbackNarration(input: FallbackNarrationInput): string {
  const reasonLine = humanizeIdleTurnReason(input.planReason, input.skipped);
  return [
    "本轮没有安排新的分析。",
    reasonLine,
    "你可以换个角度提问，或质疑某条结论以触发重新推演。",
  ].join("\n");
}

/** Deterministic fallback narration when LLM is unavailable (HTTP 200, source: fallback). */
export function buildFallbackNarration(input: FallbackNarrationInput): string {
  if (input.selectedCount === 0) {
    return buildIdleTurnFallbackNarration(input);
  }

  const challengeHint =
    input.interventionIntent === "challenge"
      ? "你提出了质疑，我会据此重新推演相关依据。"
      : "";

  const statusLine =
    input.goalStatusBefore != null &&
    goalStatusChanged(input.goalStatusBefore, input.goalStatus)
      ? goalStatusNarrationLine(input.goalStatus)
      : "";

  const head = [challengeHint, statusLine].filter(Boolean).join("\n");

  const body = formatMainArtifactBody(input.mainArtifactContent, {
    sanitize: input.sanitizeMainArtifact !== false,
    maxLen: input.mainArtifactMaxLen,
  });

  if (body) {
    return head ? `${head}\n\n${body}` : body;
  }
  return head || "本轮分析已完成，请继续提问或质疑既有结论。";
}