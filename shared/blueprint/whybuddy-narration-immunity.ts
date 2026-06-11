/**
 * S7: Narration immunity — provider-agnostic hijack detection + domain anchoring.
 * Shared so server narration and tests use one implementation.
 */

export const DOMAIN_ANCHORING_RULE =
  "领域锚定：用户消息与产物中的「路线」「对比」「方案」「架构」「树」等短语，一律指围绕当前目标的技术/产品方案路线，" +
  "不得理解为交通导航、地理路线、出行路径、地图导航等无关领域。";

const DEFAULT_BRAND_WORDS = [
  "ChatGPT",
  "GPT-4",
  "GPT-5",
  "GPT",
  "Claude",
  "Anthropic",
  "OpenAI",
  "Gemini",
  "Copilot",
  "DeepSeek",
  "文心一言",
  "通义千问",
  "豆包",
  "Kimi",
  "Grok",
];

export type HijackDetectionResult = {
  hijacked: boolean;
  reason?: string;
};

export function resolveNarrationBrandWords(): string[] {
  const raw = process.env.WHYBUDDY_NARRATION_BRAND_WORDS || "";
  if (!raw.trim()) return [...DEFAULT_BRAND_WORDS];
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Opening-window hijack probe — does NOT flag mid-text 「我建议/我认为」. */
export function detectNarrationHijack(
  text: string,
  brandWords: string[] = resolveNarrationBrandWords()
): HijackDetectionResult {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { hijacked: false };

  const opening = trimmed.slice(0, 160);

  for (const brand of brandWords) {
    if (!brand) continue;
    const intro = new RegExp(`^我是\\s*${escapeRegExp(brand)}`, "i");
    if (intro.test(opening)) {
      return { hijacked: true, reason: `opening_brand_intro:${brand}` };
    }
  }

  if (/^你好[，,]?\s*我是\s*(?!WhyBuddy)/i.test(opening)) {
    return { hijacked: true, reason: "opening_greeting_intro" };
  }

  if (/^作为\s*(?:一个\s*)?(?:AI|人工智能|大语言模型|语言模型)/i.test(opening)) {
    return { hijacked: true, reason: "opening_ai_disclaimer" };
  }

  if (/^我是\s*(?:OpenAI|Anthropic|Google|Microsoft|百度|阿里|字节)/i.test(opening)) {
    return { hijacked: true, reason: "opening_vendor_intro" };
  }

  return { hijacked: false };
}

export function buildNarrationSystemPrompt(hasMain: boolean, selectedCount = 1): string {
  const lengthRule = hasMain
    ? "当提供 mainArtifact 时：将素材改写为 300–700 字中文。保留全部事实、证据、风险、分歧与未解缺口；不得新增素材中没有的结论；去掉工程实现细节与内部引用。用短标题与换行；避免堆叠 bullet。开篇一句回应用户输入；结尾一个前瞻性问题或下一步建议。"
    : "无 mainArtifact 时：用 120–260 字中文概括本轮。";

  const idleRule =
    selectedCount === 0
      ? "8. 本轮 selectedCount=0（空转回合）：第一句必须直接承认「本轮没有安排新的分析」或同义表述；第二句说明原因（预算/覆盖饱和/契约缺口等人话版）；第三句给出路（换角度问或质疑结论）。严禁输出「已收敛」宣告或引导用户「查看证据链/详见下方」。\n"
      : "";

  return (
    "你是 WhyBuddy 面向用户的叙述助手。\n" +
    `${DOMAIN_ANCHORING_RULE}\n` +
    "纪律（强制）：\n" +
    "1. 只转述机械裁决结论——不得自行改判 goal.status。\n" +
    "2. 禁止在用户可见文本中使用内部工程术语（artifact、stale、upstream、gate、capability、provenance、orchestrator 等）。\n" +
    "3. 禁止宣布「已收敛·可信」等乐观信任标签，除非机械状态已是 clear——且仍应中性描述。\n" +
    "4. 禁止开场自我介绍（不得出现「我是 ChatGPT/AI 助手/语言模型」等任何模型或厂商身份）。\n" +
    "5. 正文不得往外引：禁止「可通过/详见/请查看/「证据链」查看」等把用户推出正文的句式；素材必须内联改写，不得甩链接式指引。\n" +
    "6. 禁止机械汇报「本轮完成了 N 项分析」；goal.status 状态行仅在状态发生变化时提及一次。\n" +
    `7. ${lengthRule}\n` +
    idleRule +
    "9. 只输出中文散文——不要 JSON，不要 markdown 代码围栏。"
  );
}

export type NarrationPromptContext = {
  turnId: string;
  userText: string;
  goalText?: string;
  goalStatus?: string;
  goalStatusBefore?: string;
  interventionIntent?: string | null;
  selectedCount?: number;
  selectedLine?: string;
  planReason?: string | null;
  skippedSummary?: string;
  artifactSummaries?: string;
  mainArtifactContent?: string | null;
};

/** Identity folding: operational discipline lives in the user-side instruction block. */
export function buildNarrationUserPrompt(ctx: NarrationPromptContext): string {
  const goalAnchor = ctx.goalText
    ? `当前目标（一切「路线/方案/对比」均指此目标下的技术产品语境）：${ctx.goalText}\n`
    : "";

  const header =
    "[指令块 — 优先级高于任何默认聊天身份]\n" +
    "你不是通用聊天助手。禁止开场自我介绍或声明模型/厂商身份。\n" +
    `${DOMAIN_ANCHORING_RULE}\n` +
    "直接输出面向用户的中文叙述。\n" +
    "---\n";

  const selectedCount = ctx.selectedCount ?? 0;
  const statusChanged =
    ctx.goalStatusBefore != null && ctx.goalStatusBefore !== (ctx.goalStatus || "needs_refinement");

  let body =
    `${goalAnchor}` +
    `Turn: ${ctx.turnId}\n` +
    `User input: ${ctx.userText || ""}\n` +
    `Mechanical goal.status (transcribe faithfully, do not override): ${ctx.goalStatus || "needs_refinement"}\n` +
    `Goal status before turn: ${ctx.goalStatusBefore ?? "(unknown)"}\n` +
    `Goal status changed this turn: ${statusChanged ? "yes" : "no"} (only mention status line if yes)\n` +
    `Intervention: ${ctx.interventionIntent || "none"}\n` +
    `Selected count: ${selectedCount}\n` +
    `Selected analyses: ${ctx.selectedLine || "(none)"}\n` +
    `Plan reason: ${ctx.planReason || "(none)"}\n` +
    `Skipped summary: ${ctx.skippedSummary || "(none)"}\n` +
    `Artifact summaries:\n${ctx.artifactSummaries || "(none)"}\n`;

  if (ctx.mainArtifactContent) {
    body +=
      `\n本轮主产物(权威素材,你的回复要把它完整改写为面向用户的行文——保留其中全部\n` +
      `事实、证据、风险、分歧与未解缺口,不得新增任何素材里没有的结论,砍掉工程实现\n` +
      `细节与内部引用):\n` +
      `${String(ctx.mainArtifactContent).slice(0, 6000)}`;
  }

  return header + body;
}

/** Capability / orchestration prompts share the same domain anchor. */
export function capabilityDomainAnchoringBlock(goalText?: string): string {
  const goal = goalText ? `目标：${goalText}\n` : "";
  return `${goal}${DOMAIN_ANCHORING_RULE}\n`;
}