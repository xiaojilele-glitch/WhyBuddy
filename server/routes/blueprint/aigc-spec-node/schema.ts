/**
 * Strict zod schema for AIGC Spec Node LLM response validation.
 *
 * Used by the AIGC Spec Node capability bridge (autopilot-capability-bridge-aigc-node)
 * to validate the structured spec-shape JSON payload returned from `ctx.llm.callJson`.
 *
 * Contract (per design §4.4 / requirements 3.1 / 3.2 / 3.3):
 * - `subsystems`: 1..10 entries, each 1..80 characters. Missing / empty / too-long → fallback.
 * - `riskNotes`: 0..10 entries, each 1..200 characters.
 * - `dataFlowSketch`: optional string up to 500 chars.
 * - `confidence`: optional number in [0, 1].
 * - Unknown top-level fields are silently stripped (zod default behavior), not
 *   treated as schema failures. This is intentional so future prompt versions
 *   can add fields forward-compatibly.
 * - No `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coercion — responses
 *   either strictly match or fall back to the templated simulated path.
 *
 * No runtime / business imports — this file is a pure schema module.
 */

import { z } from "zod";

export const AigcSpecNodeResponseSchema = z.object({
  subsystems: z.array(z.string().min(1).max(80)).min(1).max(10),
  riskNotes: z.array(z.string().min(1).max(200)).min(0).max(10),
  dataFlowSketch: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type AigcSpecNodeResponse = z.infer<typeof AigcSpecNodeResponseSchema>;
