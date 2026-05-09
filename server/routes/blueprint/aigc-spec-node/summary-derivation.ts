/**
 * Pure summary helpers for the AIGC Spec Node capability bridge.
 *
 * Exports:
 * - `deriveAigcOutputSummary` — builds the locale-aware one-liner placed
 *   on `BlueprintCapabilityInvocation.outputSummary` (real path).
 * - `buildStructuredPayloadSummary` — builds the short human-readable
 *   summary embedded inside `evidence.provenance.structuredPayload.summary`,
 *   trimmed to `policy.maxStructuredPayloadSummaryBytes`.
 * - `sha256Hex` — utility for computing lowercase hex digests.
 *
 * No runtime business imports. Only `node:crypto` is used for hashing.
 * Types are imported via `import type` (erased at runtime).
 *
 * See design §4.7, requirements 3.5 / 4.3 / 4.5 / 4.6.
 */

import { createHash } from "node:crypto";

import type { AigcSpecNodeCapabilityPolicy } from "./policy.js";
import type { AigcSpecNodeResponse } from "./schema.js";

const DATA_FLOW_SKETCH_MAX_LEN = 120;
const DATA_FLOW_SKETCH_TRUNCATED_LEN = 117;

export function deriveAigcOutputSummary(
  data: AigcSpecNodeResponse,
  options: { locale: "zh-CN" | "en-US" },
): string {
  const n = data.subsystems.length;
  const k = data.riskNotes.length;

  if (options.locale === "zh-CN") {
    const base = `识别 ${n} 个关键子系统；标注 ${k} 条风险。`;
    if (data.dataFlowSketch) {
      const sketch = truncateSketch(data.dataFlowSketch);
      return `${base} 数据流摘要：${sketch}`;
    }
    return base;
  }

  // en-US (default)
  const subsystemLabel = n === 1 ? "subsystem" : "subsystems";
  const riskLabel = k === 1 ? "risk" : "risks";
  const base = `Identified ${n} ${subsystemLabel}; ${k} ${riskLabel} flagged.`;
  if (data.dataFlowSketch) {
    const sketch = truncateSketch(data.dataFlowSketch);
    return `${base} Data flow: ${sketch}`;
  }
  return base;
}

function truncateSketch(sketch: string): string {
  if (sketch.length <= DATA_FLOW_SKETCH_MAX_LEN) {
    return sketch;
  }
  return `${sketch.slice(0, DATA_FLOW_SKETCH_TRUNCATED_LEN)}...`;
}

export function buildStructuredPayloadSummary(
  data: AigcSpecNodeResponse,
  policy: AigcSpecNodeCapabilityPolicy,
): string {
  const n = data.subsystems.length;
  const k = data.riskNotes.length;

  const parts: string[] = [
    `${n} ${n === 1 ? "subsystem" : "subsystems"}`,
    `${k} ${k === 1 ? "risk" : "risks"}`,
  ];
  if (typeof data.confidence === "number") {
    parts.push(`confidence=${data.confidence.toFixed(2)}`);
  }
  const joined = parts.join(", ");

  // Byte-budget trim (UTF-8). Summaries are ASCII in practice, but be safe
  // against future locale-aware extensions.
  const limit = policy.maxStructuredPayloadSummaryBytes;
  if (Buffer.byteLength(joined, "utf8") <= limit) {
    return joined;
  }
  // Walk back one char at a time until we fit. Summaries are tiny, so
  // a simple loop is fine.
  let out = joined;
  while (Buffer.byteLength(out, "utf8") > limit && out.length > 0) {
    out = out.slice(0, -1);
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
