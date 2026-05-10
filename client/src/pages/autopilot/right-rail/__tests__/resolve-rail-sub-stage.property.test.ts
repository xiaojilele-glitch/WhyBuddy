/**
 * Autopilot 驾驶舱右栏收敛 — `resolveRailSubStage` 属性测试（Spec 1 PBT）
 *
 * 本文件合并任务 2.1 / 2.2 / 2.3 三条 fast-check 属性测试：
 * - P1 Total function          ← Requirement 2.1
 * - P2 Monotonicity             ← Requirement 2.3
 * - P3 Idempotence              ← Requirement 2.2、Requirement 2.5
 *
 * 三条性质共用同一组 arbitraries（currentStage、job.stage、可选 job）。为了一字不差复刻
 * design.md「现状对照 → BlueprintGenerationJob.stage 枚举」段落列出的 13 个值（其中
 * `"route_selection"` 与 `"agent_crew_fabric"` 是 spec 层的过渡态，`shared/blueprint/contracts.ts`
 * 当前的 `BlueprintGenerationStage` 联合类型仅包含 11 个枚举值且不含这两个过渡态），本文件
 * 使用一次 `as fc.Arbitrary<BlueprintGenerationStage>` 在生成侧做宽化到 `resolveRailSubStage`
 * 的入口类型；resolver 内部 `JobStageLike = string` 兜底，运行期安全。
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BlueprintGenerationJob, BlueprintGenerationStage } from "@shared/blueprint/contracts";

import { resolveRailSubStage } from "../resolve-rail-sub-stage";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotTimelineStage,
  type ResolveRailSubStageInput,
} from "../types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbTimelineStage: fc.Arbitrary<AutopilotTimelineStage> = fc.constantFrom(
  "input",
  "clarification",
  "routeset",
  "selection",
  "fabric",
);

/**
 * 对齐 design.md 列出的 13 个 `BlueprintGenerationJob.stage` 过渡值；其中 `"route_selection"` /
 * `"agent_crew_fabric"` 不属于当前 `BlueprintGenerationStage` 枚举（而属 spec 层语义），
 * 这里通过单次宽化 cast 覆盖 resolver switch 的所有分支。
 */
const arbJobStage: fc.Arbitrary<BlueprintGenerationStage> = fc.constantFrom(
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "agent_crew_fabric",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
) as fc.Arbitrary<BlueprintGenerationStage>;

/**
 * resolver 仅消费 `job?.stage`，因此 PBT 只需要构造最小 `{ stage }` shape；通过 double cast 承接
 * `ResolveRailSubStageInput.job` 的 `BlueprintGenerationJob | null` 类型。
 */
const arbJobOrNull = fc.oneof(
  fc.constant(null),
  arbJobStage.map((stage) => ({ stage }) as unknown as BlueprintGenerationJob),
);

const arbInput: fc.Arbitrary<ResolveRailSubStageInput> = fc.record({
  currentStage: arbTimelineStage,
  job: arbJobOrNull,
  selection: fc.constant(null),
  specTree: fc.constant(null),
  agentCrew: fc.constant(null),
});

// ---------------------------------------------------------------------------
// Monotonicity helpers（P2）
// ---------------------------------------------------------------------------

/**
 * `BlueprintGenerationJob.stage` 的自然推进序列（与 design.md「资 Resolver 规则」段落顺序一致）。
 * 宽化 cast 同样是为了覆盖 spec 层过渡态；运行期 resolver 接受 `string`。
 */
const BLUEPRINT_STAGE_PROGRESSION: readonly BlueprintGenerationStage[] = [
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "agent_crew_fabric",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
] as unknown as readonly BlueprintGenerationStage[];

function subStageIndex(stage: BlueprintGenerationStage): number {
  const sub = resolveRailSubStage({
    currentStage: "fabric",
    job: { stage } as unknown as BlueprintGenerationJob,
    selection: null,
    specTree: null,
    agentCrew: null,
  });
  return sub === undefined ? -1 : RAIL_SUB_STAGE_ORDER.indexOf(sub);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveRailSubStage (Spec 1 PBT)", () => {
  // -------------------------------------------------------------------------
  // P1 — total function
  // **Validates: Requirement 2.1**
  // -------------------------------------------------------------------------
  it("P1 - total function: always returns undefined (non-fabric) or a member of RAIL_SUB_STAGE_ORDER (fabric)", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = resolveRailSubStage(input);
        if (input.currentStage !== "fabric") {
          expect(result).toBeUndefined();
        } else {
          expect(result).toBeDefined();
          expect(RAIL_SUB_STAGE_ORDER).toContain(result!);
        }
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // P2 — monotonicity
  // **Validates: Requirement 2.3**
  // -------------------------------------------------------------------------
  it("P2 - monotonicity: advancing job.stage through BLUEPRINT_STAGE_PROGRESSION does not rewind sub-stage index", () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.integer({ min: 0, max: BLUEPRINT_STAGE_PROGRESSION.length - 1 }),
            { minLength: 2, maxLength: BLUEPRINT_STAGE_PROGRESSION.length },
          )
          .map((indices) => [...indices].sort((a, b) => a - b)),
        (sortedIndices) => {
          const stages = sortedIndices.map((i) => BLUEPRINT_STAGE_PROGRESSION[i]);
          const subIndices = stages.map(subStageIndex);
          for (let i = 1; i < subIndices.length; i++) {
            expect(subIndices[i]).toBeGreaterThanOrEqual(subIndices[i - 1]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // P3 — idempotence
  // **Validates: Requirement 2.2、Requirement 2.5**
  // -------------------------------------------------------------------------
  it("P3 - idempotence: same input always yields the same result", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r1 = resolveRailSubStage(input);
        const r2 = resolveRailSubStage(input);
        const r3 = resolveRailSubStage(input);
        expect(r1).toBe(r2);
        expect(r2).toBe(r3);
      }),
      { numRuns: 200 },
    );
  });
});
