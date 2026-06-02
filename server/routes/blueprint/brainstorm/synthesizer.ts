/**
 * @description Brainstorm Synthesizer — aggregates all crew member outputs
 * into a single coherent synthesis result using an LLM call with fallback
 * to highest-confidence selection.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §5
 * Requirements: 8.1, 8.2, 8.5
 */

import type {
  BrainstormRoleId,
  SynthesisInput,
  SynthesisResult,
} from "../../../../shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LLM caller function signature — injectable for testing. */
export type LLMCallerFn = (
  prompt: string,
  options: { signal?: AbortSignal },
) => Promise<string>;

/** Event emitter function signature — injectable for testing. */
export type EventEmitterFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => void;

// ---------------------------------------------------------------------------
// Synthesizer
// ---------------------------------------------------------------------------

export class BrainstormSynthesizer {
  constructor(
    private readonly llmCaller: LLMCallerFn,
    private readonly emitEvent: EventEmitterFn,
  ) {}

  /**
   * Synthesize all crew member outputs into a single coherent result.
   * On LLM failure, falls back to selecting the highest-confidence output.
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    try {
      const prompt = this.buildSynthesisPrompt(input);
      const raw = await this.llmCaller(prompt, {});
      const parsed = this.parseSynthesisResult(raw, input);

      if (parsed) {
        return parsed;
      }

      // Parse failed — fall through to fallback
      return this.fallback(input);
    } catch {
      // LLM call failed — use fallback
      return this.fallback(input);
    }
  }

  // ─── Prompt Building ──────────────────────────────────────────────────────

  private buildSynthesisPrompt(input: SynthesisInput): string {
    const crewOutputsText = input.crewOutputs
      .map(
        (o) =>
          `[${o.roleId}] (confidence: ${o.confidence.toFixed(2)}):\n${o.content}`,
      )
      .join("\n\n---\n\n");

    return (
      `You are a synthesis engine for a multi-agent brainstorm session.\n` +
      `Collaboration mode: ${input.mode}\n\n` +
      `Stage context:\n${input.stageContext}\n\n` +
      `Crew member outputs:\n${crewOutputsText}\n\n` +
      `Synthesize the above outputs into a single coherent decision.\n` +
      `Respond with a JSON object matching this exact schema:\n` +
      `{\n` +
      `  "decision": "string - the final synthesized decision or recommendation",\n` +
      `  "confidence": number between 0 and 1,\n` +
      `  "reasoningPoints": [{ "roleId": "string", "point": "string" }],\n` +
      `  "dissentingOpinions": [{ "roleId": "string", "opinion": "string" }],\n` +
      `  "tokenUsage": number (estimated tokens used for this synthesis)\n` +
      `}\n\n` +
      `Rules:\n` +
      `- confidence must be between 0 and 1\n` +
      `- reasoningPoints must include at least one entry per crew member\n` +
      `- dissentingOpinions should capture any minority views that differ from the decision\n` +
      `- tokenUsage should be your estimate of tokens consumed`
    );
  }

  // ─── Response Parsing ─────────────────────────────────────────────────────

  private parseSynthesisResult(
    raw: string,
    input: SynthesisInput,
  ): SynthesisResult | null {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return null;
        }
      }

      if (typeof parsed !== "object" || parsed === null) return null;
      const obj = parsed as Record<string, unknown>;

      // Validate required fields
      if (typeof obj.decision !== "string" || obj.decision.length === 0) {
        return null;
      }

      const confidence =
        typeof obj.confidence === "number"
          ? Math.max(0, Math.min(1, obj.confidence))
          : 0.5;

      const reasoningPoints = this.parseReasoningPoints(
        obj.reasoningPoints,
        input,
      );
      const dissentingOpinions = this.parseDissentingOpinions(
        obj.dissentingOpinions,
      );

      const tokenUsage =
        typeof obj.tokenUsage === "number" && obj.tokenUsage >= 0
          ? Math.round(obj.tokenUsage)
          : Math.ceil((raw.length + this.buildSynthesisPrompt(input).length) / 4);

      return {
        decision: obj.decision,
        confidence,
        reasoningPoints,
        dissentingOpinions,
        tokenUsage,
      };
    } catch {
      return null;
    }
  }

  private parseReasoningPoints(
    raw: unknown,
    input: SynthesisInput,
  ): Array<{ roleId: BrainstormRoleId; point: string }> {
    if (!Array.isArray(raw)) {
      // Fallback: derive one reasoning point per crew output
      return input.crewOutputs.map((o) => ({
        roleId: o.roleId,
        point: o.content.slice(0, 200),
      }));
    }

    const points: Array<{ roleId: BrainstormRoleId; point: string }> = [];
    for (const item of raw) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).roleId === "string" &&
        typeof (item as Record<string, unknown>).point === "string"
      ) {
        points.push({
          roleId: (item as Record<string, unknown>).roleId as BrainstormRoleId,
          point: (item as Record<string, unknown>).point as string,
        });
      }
    }

    return points.length > 0
      ? points
      : input.crewOutputs.map((o) => ({
          roleId: o.roleId,
          point: o.content.slice(0, 200),
        }));
  }

  private parseDissentingOpinions(
    raw: unknown,
  ): Array<{ roleId: BrainstormRoleId; opinion: string }> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const opinions: Array<{ roleId: BrainstormRoleId; opinion: string }> = [];
    for (const item of raw) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).roleId === "string" &&
        typeof (item as Record<string, unknown>).opinion === "string"
      ) {
        opinions.push({
          roleId: (item as Record<string, unknown>).roleId as BrainstormRoleId,
          opinion: (item as Record<string, unknown>).opinion as string,
        });
      }
    }

    return opinions;
  }

  // ─── Fallback ─────────────────────────────────────────────────────────────

  /**
   * Fallback: select the crew output with the highest confidence score.
   * Emits a degradation event.
   */
  private fallback(input: SynthesisInput): SynthesisResult {
    this.emitEvent("brainstorm.degraded", {
      sessionId: input.sessionId,
      reason: "Synthesis LLM call failed, using highest-confidence fallback",
      affectedComponent: "synthesizer",
      fallbackAction: "highest-confidence-selection",
    });

    // Sort by confidence descending and pick the best
    const sorted = [...input.crewOutputs].sort(
      (a, b) => b.confidence - a.confidence,
    );
    const best = sorted[0];

    if (!best) {
      // Edge case: no crew outputs at all
      return {
        decision: "No crew outputs available for synthesis.",
        confidence: 0,
        reasoningPoints: [],
        dissentingOpinions: [],
        tokenUsage: 0,
      };
    }

    return {
      decision: best.content,
      confidence: best.confidence,
      reasoningPoints: [{ roleId: best.roleId, point: best.content }],
      dissentingOpinions: sorted.slice(1).map((o) => ({
        roleId: o.roleId,
        opinion: o.content,
      })),
      tokenUsage: 0,
    };
  }
}
