import { describe, expect, it } from "vitest";

import { BlueprintEventName } from "../index.js";
import type {
  BlueprintAgentCrew,
  BlueprintArtifactMemoryEntry,
  BlueprintClarificationSession,
  BlueprintEffectPreview,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  BlueprintImplementationPromptPackage,
  BlueprintIntake,
  BlueprintReviewSpecDocumentResponse,
  BlueprintRouteSet,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "../index.js";

/**
 * `shared/blueprint/index.ts` barrel 的 smoke 测试。
 *
 * 这里只做一件事：确认 8 个子域 `types.ts` re-export 的代表性符号可以通过 barrel 拿到，
 * 并且 `BlueprintEventName` 常量也可以从 barrel 取到。
 *
 * 任何子域 re-export 出错都会让这个文件在编译期立刻失败。
 */
describe("shared/blueprint/index.ts barrel", () => {
  it("re-exports BlueprintEventName runtime constants", () => {
    expect(BlueprintEventName.JobCreated).toBe("job.created");
    expect(BlueprintEventName.RouteSelected).toBe("route.selected");
    expect(BlueprintEventName.SpecTreeUpdated).toBe("spec.tree.updated");
  });

  it("can be used to type-annotate representative subdomain objects", () => {
    // 这些 `as` 仅用于让 TS 校验类型引用能被解析到；运行期不构造它们。
    const intake = undefined as unknown as BlueprintIntake;
    const clarification = undefined as unknown as BlueprintClarificationSession;
    const job = undefined as unknown as BlueprintGenerationJob;
    const event = undefined as unknown as BlueprintGenerationEvent;
    const crew = undefined as unknown as BlueprintAgentCrew;
    const routeSet = undefined as unknown as BlueprintRouteSet;
    const specTree = undefined as unknown as BlueprintSpecTree;
    const specDocument = undefined as unknown as BlueprintSpecDocument;
    const specDocumentReview =
      undefined as unknown as BlueprintReviewSpecDocumentResponse;
    const preview = undefined as unknown as BlueprintEffectPreview;
    const prompt = undefined as unknown as BlueprintImplementationPromptPackage;
    const ledger = undefined as unknown as BlueprintArtifactMemoryEntry;

    expect(
      [
        intake,
        clarification,
        job,
        event,
        crew,
        routeSet,
        specTree,
        specDocument,
        specDocumentReview,
        preview,
        prompt,
        ledger,
      ].every(value => value === undefined)
    ).toBe(true);
  });
});


describe("RoleCapabilityPackage barrel re-export（autopilot-role-container-loader Task 2.3）", () => {
  it("可从 @shared/blueprint 直接拿到 RoleCapabilityPackage 类型", () => {
    // 纯类型断言：让 TS 校验 barrel 可以解析到 RoleCapabilityPackage 符号。
    // 若任务 2 的 re-export 丢失，本文件会在 compile 期失败。
    const pkg: import("../index.js").RoleCapabilityPackage = {
      alwaysBound: [{ kind: "mcp", id: "github" }],
      onDemand: {
        aigcNodes: [{ kind: "aigc_node", id: "summary-gen" }],
      },
      resourceBudget: {
        provisionTimeoutMs: 20_000,
        maxConcurrentAigcNodes: 2,
        orchestrationMode: "serial",
      },
      containerImage: "lobster-executor:ai",
    };
    const binding: import("../index.js").RoleCapabilityPackageBinding = {
      kind: "skill",
      id: "summarize",
      optional: true,
    };
    const budget: import("../index.js").RoleResourceBudget = {
      memoryMiB: 1024,
    };

    // 运行期 smoke：字段可读且 shape 稳定。
    expect(pkg.alwaysBound?.[0]?.id).toBe("github");
    expect(pkg.onDemand?.aigcNodes?.[0]?.kind).toBe("aigc_node");
    expect(binding.optional).toBe(true);
    expect(budget.memoryMiB).toBe(1024);
  });
});

describe("BlueprintHandoffState / BlueprintReviewingHandoff", () => {
  it("BlueprintHandoffState 覆盖 5 个显式值", () => {
    const expected: import("../index.js").BlueprintHandoffState[] = [
      "idle",
      "reviewing",
      "confirmed",
      "reset",
      "failed",
    ];
    // 运行期仅验证枚举字面量可在 TS 里逐项赋值，防止未来误改为 union 缩小。
    expect(expected).toHaveLength(5);
  });

  it("BlueprintReviewingHandoff 至少包含被选中路径的 provenance 字段", () => {
    const sample = {
      state: "reviewing",
      stage: "spec_tree",
      selectedPathId: "path-a",
      routeId: "route-a",
      specTreeId: "tree-a",
      enteredAt: "2026-05-07T12:00:00.000Z",
      confirmable: true,
    } satisfies import("../index.js").BlueprintReviewingHandoff;
    expect(sample.state).toBe("reviewing");
    expect(sample.confirmable).toBe(true);
    expect(sample.selectedPathId).toBe("path-a");
    expect(sample.routeId).toBe("route-a");
    expect(sample.specTreeId).toBe("tree-a");
  });
});
