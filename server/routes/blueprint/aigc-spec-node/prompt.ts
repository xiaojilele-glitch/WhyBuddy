/**
 * Locale-aware, deterministic prompt builder for the AIGC Spec Node
 * capability bridge. Same input → byte-identical userMessage + promptFingerprint.
 *
 * Per design §4.5 / requirements 2.2 / 2.5 / 2.7 / 7.2:
 * - `AIGC_SPEC_NODE_PROMPT_ID` is the stable version identifier, written into
 *   `BlueprintCapabilityInvocation.provenance.promptId`.
 * - `buildAigcSpecNodePrompt` is pure: no runtime business imports, no network,
 *   no model/provider hard-coding.
 * - Only runtime dependency allowed is `node:crypto` for SHA-256 fingerprinting.
 *
 * The `userPayload` object literal uses a fixed key insertion order
 * (`promptId` / `route` / `intake` / `clarification` / `projectContext` /
 * `outputSchema`) so that `JSON.stringify(..., null, 2)` produces byte-identical
 * output across repeated calls with the same input. `clarification.answers` are
 * sorted by `questionId` via a non-mutating copy; `projectContext` is omitted
 * entirely when both `request.projectId` and `request.sourceId` are missing.
 */

import { createHash } from "node:crypto";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
} from "../../../../shared/blueprint/index.js";

export const AIGC_SPEC_NODE_PROMPT_ID = "blueprint.aigc-spec-node.v1";

export interface AigcSpecNodePromptPayload {
  promptId: string;
  systemMessage: string;
  userMessage: string;
  /** Deterministic object used to render userMessage; exposed for tests. */
  userPayload: Record<string, unknown>;
  /** SHA-256 hex of systemMessage + "\n\n" + userMessage, formatted as "sha256:<hex>". */
  promptFingerprint: string;
}

export interface BuildAigcSpecNodePromptInput {
  request: BlueprintGenerationRequest;
  clarificationSession?: BlueprintClarificationSession;
  route: BlueprintRouteCandidate;
  locale: "zh-CN" | "en-US";
}

const SYSTEM_MESSAGE_ZH = `你是 /autopilot 沙箱派生管线中的 AIGC Spec Node 领域推理器。

给定用户的目标描述、澄清问答摘要与可选领域上下文，请对目标进行 SPEC-shape 领域推理，识别关键子系统、勾勒数据流、标注风险边界，并以严格 JSON 形式返回。

约束：
1. 必须返回合法 JSON，不得包含 Markdown 代码块围栏、不得返回任何解释性前置文字。
2. JSON 根对象必须包含：
   - "subsystems": string[]，1 到 10 项，每项 1 到 80 字符；识别目标中可分解出的关键子系统 / 模块 / 能力域。
   - "riskNotes": string[]，0 到 10 项，每项 1 到 200 字符；指出可能的风险、约束或不确定性。
3. JSON 根对象可选包含：
   - "dataFlowSketch": string，不超过 500 字符；用一段话描述跨子系统的主要数据流动。
   - "confidence": number，0 到 1 之间；自评本次推理的置信度。
4. 不得引入其他顶层字段，不得使用嵌套外部引用。
5. 只基于用户提供的 intake / clarification / projectContext 内容进行推理；不得引入用户未提供的机密、外部 URL、或幻构实例。`;

const SYSTEM_MESSAGE_EN = `You are the AIGC Spec Node domain-reasoner inside the /autopilot sandbox derivation pipeline.

Given the user's goal, clarification answers summary, and optional domain context, perform SPEC-shape domain reasoning over the goal: identify key subsystems, sketch data flow, flag risk boundaries, and return the result as strict JSON.

Constraints:
1. Return a single JSON object. Do NOT wrap in Markdown code fences. Do NOT include any prose before or after.
2. The root object MUST include:
   - "subsystems": string[] with 1 to 10 entries, each 1 to 80 characters; name the key subsystems / modules / capability areas that decompose the goal.
   - "riskNotes": string[] with 0 to 10 entries, each 1 to 200 characters; call out risks, constraints, or uncertainties.
3. The root object MAY include:
   - "dataFlowSketch": string up to 500 characters summarising the primary cross-subsystem data flow.
   - "confidence": number in [0, 1] for self-evaluation.
4. Do not introduce additional top-level fields. Do not reference external URLs or hallucinated systems.
5. Reason ONLY from the provided intake / clarification / projectContext; do not inject secrets, credentials, or unrelated examples.`;

const OUTPUT_SCHEMA_DESCRIPTOR = {
  subsystems: "string[] 1..10 entries, each 1..80 chars",
  riskNotes: "string[] 0..10 entries, each 1..200 chars",
  dataFlowSketch: "string up to 500 chars (optional)",
  confidence: "number in [0, 1] (optional)",
} as const;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildAigcSpecNodePrompt(
  input: BuildAigcSpecNodePromptInput,
): AigcSpecNodePromptPayload {
  const systemMessage =
    input.locale === "zh-CN" ? SYSTEM_MESSAGE_ZH : SYSTEM_MESSAGE_EN;

  const githubUrls = Array.isArray(input.request.githubUrls)
    ? [...input.request.githubUrls]
    : [];

  const userPayload: Record<string, unknown> = {
    promptId: AIGC_SPEC_NODE_PROMPT_ID,
    route: {
      id: input.route.id,
      title: input.route.title,
      summary: input.route.summary,
    },
    intake: {
      targetText: input.request.targetText,
      githubUrls,
    },
  };

  if (input.clarificationSession) {
    const rawAnswers = Array.isArray(input.clarificationSession.answers)
      ? input.clarificationSession.answers
      : [];
    // Non-mutating sort via `.slice()` copy — never mutate the original session
    // so callers can continue to reuse the clarification session elsewhere.
    const answersSorted = rawAnswers
      .slice()
      .sort((a, b) => a.questionId.localeCompare(b.questionId))
      .map((entry) => ({
        questionId: entry.questionId,
        answer: entry.answer,
      }));
    userPayload.clarification = {
      strategyId: input.clarificationSession.strategyId,
      templateId: input.clarificationSession.templateId,
      answers: answersSorted,
    };
  }

  if (input.request.projectId || input.request.sourceId) {
    userPayload.projectContext = {
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
    };
  }

  userPayload.outputSchema = OUTPUT_SCHEMA_DESCRIPTOR;

  const userMessage = JSON.stringify(userPayload, null, 2);
  const promptFingerprint = `sha256:${sha256Hex(`${systemMessage}\n\n${userMessage}`)}`;

  return {
    promptId: AIGC_SPEC_NODE_PROMPT_ID,
    systemMessage,
    userMessage,
    userPayload,
    promptFingerprint,
  };
}
