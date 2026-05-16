import { describe, expect, it } from "vitest";

import {
  BlueprintEventName,
  resolveBlueprintEventFamily,
  type BlueprintGenerationEventFamily,
  type BlueprintGenerationEventType,
} from "../events.js";

/**
 * 事件目录的 co-located 单测。
 *
 * 这里不追求语义行为覆盖，只做两件事：
 * 1. 锁定 `BlueprintEventName` 常量与 `BlueprintGenerationEventType` union 之间的同构关系。
 * 2. 验证 `resolveBlueprintEventFamily` 与 12 个家族定义一致。
 *
 * 本文件是 example-based 断言，不是 PBT。
 */

const KNOWN_FAMILIES: ReadonlySet<BlueprintGenerationEventFamily> = new Set([
  "job",
  "clarification",
  "route",
  "spec",
  "preview",
  "prompt",
  "mission",
  "evidence",
  "role",
  "capability",
  "crew",
  "sandbox",
]);

describe("BlueprintEventName", () => {
  it("ships 12 families, matching the design inventory", () => {
    expect(KNOWN_FAMILIES.size).toBe(12);
  });

  it("每个常量值都是合法的 BlueprintGenerationEventType", () => {
    const values = Object.values(BlueprintEventName);
    const uniqueValues = new Set(values);

    expect(uniqueValues.size).toBe(values.length);
    for (const value of values) {
      const family = value.split(".")[0] as BlueprintGenerationEventFamily;
      expect(KNOWN_FAMILIES.has(family)).toBe(true);
    }
  });

  it("常量键名使用 PascalCase，不与事件名混用", () => {
    for (const key of Object.keys(BlueprintEventName)) {
      expect(key).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(key).not.toContain(".");
    }
  });

  it("exposes RoleSleeping constant matching role.sleeping", () => {
    expect(BlueprintEventName.RoleSleeping).toBe("role.sleeping");
  });

  it("`role.agent.thinking` 仍按首段 `.` 归入 role 家族", () => {
    // `autopilot-agent-reasoning-stream` spec Task 2.4：单独一条聚焦断言，
    // 防止后续把 `resolveBlueprintEventFamily` 改成字面量映射时漏掉
    // 带两个 `.` 的子家族事件，导致 `BlueprintSocketRelay.DEFAULT_RELAY_FAMILIES`
    // 过滤出错。
    expect(resolveBlueprintEventFamily("role.agent.thinking")).toBe("role");
  });

  it("resolveBlueprintEventFamily 返回事件名的首段", () => {
    const samples: Array<{ type: BlueprintGenerationEventType; family: BlueprintGenerationEventFamily }> = [
      { type: BlueprintEventName.JobCreated, family: "job" },
      { type: BlueprintEventName.ClarificationAnswered, family: "clarification" },
      { type: BlueprintEventName.RouteSelected, family: "route" },
      { type: BlueprintEventName.SpecTreeVersioned, family: "spec" },
      { type: BlueprintEventName.SpecDocumentReviewed, family: "spec" },
      { type: BlueprintEventName.PreviewGenerated, family: "preview" },
      { type: BlueprintEventName.PromptPackaged, family: "prompt" },
      { type: BlueprintEventName.MissionHandoff, family: "mission" },
      { type: BlueprintEventName.EvidenceRecorded, family: "evidence" },
      { type: BlueprintEventName.RoleCapabilityInvoked, family: "role" },
      { type: BlueprintEventName.CapabilityFailed, family: "capability" },
      { type: BlueprintEventName.CrewContextUpdated, family: "crew" },
      { type: BlueprintEventName.SandboxJobCompleted, family: "sandbox" },
      { type: BlueprintEventName.RoleSleeping, family: "role" },
      // `autopilot-role-container-loader` spec Task 1.4：新增 4 条角色容器
      // 生命周期事件，仍归入 `role` 家族，不扩展 12 家族目录。
      { type: BlueprintEventName.RoleContainerProvisioning, family: "role" },
      { type: BlueprintEventName.RoleContainerReady, family: "role" },
      { type: BlueprintEventName.RoleContainerTeardown, family: "role" },
      { type: BlueprintEventName.RoleContainerFailed, family: "role" },
      // `autopilot-agent-reasoning-stream` spec Task 2.4：新增 7 条 Agent ReAct
      // 事件，按首段 `.` 截取仍归入 `role` 家族；这里逐条断言以防 family
      // resolver 改动后悄悄把它们漂移到其它家族。
      { type: BlueprintEventName.RoleAgentIterationStarted, family: "role" },
      { type: BlueprintEventName.RoleAgentThinking, family: "role" },
      { type: BlueprintEventName.RoleAgentActing, family: "role" },
      { type: BlueprintEventName.RoleAgentObserving, family: "role" },
      { type: BlueprintEventName.RoleAgentIterationCompleted, family: "role" },
      { type: BlueprintEventName.RoleAgentError, family: "role" },
      { type: BlueprintEventName.RoleAgentCompleted, family: "role" },
    ];

    for (const sample of samples) {
      expect(resolveBlueprintEventFamily(sample.type)).toBe(sample.family);
    }
  });

  it("覆盖当前 contracts 里已有的 21 个历史事件名", () => {
    const legacyEventNames: BlueprintGenerationEventType[] = [
      "job.created",
      "job.stage",
      "job.completed",
      "job.failed",
      "crew.context.updated",
      "capability.invoked",
      "capability.completed",
      "capability.failed",
      "role.activated",
      "role.watching",
      "role.capability_invoked",
      "role.review_started",
      "role.review_completed",
      "role.completed",
      "preview.generated",
      "prompt.packaged",
      "mission.handoff",
      "sandbox.job.started",
      "sandbox.job.completed",
      "sandbox.job.failed",
    ];

    const enumValues = new Set<BlueprintGenerationEventType>(
      Object.values(BlueprintEventName) as BlueprintGenerationEventType[]
    );

    for (const name of legacyEventNames) {
      expect(enumValues.has(name)).toBe(true);
    }
  });
});
