/**
 * Unit tests for `mergeLogicalArtifacts` representative selection and
 * payload-key conflict resolution.
 *
 * 关联设计文档：
 *   `.kiro/specs/spec-first-stage-process-artifact-split-uniform/design.md`
 *   Component 4 + Algorithmic Pseudocode (`mergeLogicalArtifacts`).
 *
 * **Validates: Requirements 2.3, 4.1, 4.2, 4.6**
 *
 * 覆盖事实：
 * - Case A：`[localArtifact, serverArtifact]` 顺序入参，二者均为
 *   `clarification_session` 且 `payload.sessionId` 一致 → 输出 1 条，
 *   representative 取自本地（`id` / `type` / `createdAt` 全部来自本地）。
 * - Case B：payload 键冲突 — 本地 `{ sessionId, questions, answers }` vs
 *   服务端 `{ sessionId, summary }` → 合并后 payload 同时包含 `questions /
 *   answers / summary`，且 `sessionId` 取本地值（local wins）。
 * - Case C：空数组与非数组输入均返回 `[]`，不抛错。
 * - Bonus（保持成本低廉）：单条入参原样返回；不同 logicalKey 的两条按
 *   首次出现顺序保留。
 */

import { describe, expect, it } from "vitest";

import type { BlueprintGenerationArtifact } from "@shared/blueprint/contracts";

import { mergeLogicalArtifacts } from "../merge-logical-artifacts";

// ---------------------------------------------------------------------------
// Fixture builders — 与设计文档 Example 2 的形态一致
// ---------------------------------------------------------------------------

const SESSION_ID = "S-123";

/**
 * 本地合成 artifact：
 * - `id` 为可读形态 `clarification-session-${sessionId}`；
 * - `payload` 同时携带 `id`（来自 `BlueprintClarificationSession.id`）和
 *   `sessionId`（让本测试在 logicalKey 维度与服务端 artifact 必然碰撞，
 *   避免依赖 `parseSessionFromArtifactId` 兜底路径）。
 */
function buildLocalClarificationArtifact(
  payloadOverride?: Record<string, unknown>,
): BlueprintGenerationArtifact {
  return {
    id: `clarification-session-${SESSION_ID}`,
    type: "clarification_session",
    title: "澄清会话",
    summary: "本地合成澄清会话摘要",
    createdAt: "2026-05-22T10:00:00Z",
    payload: payloadOverride ?? {
      id: SESSION_ID,
      sessionId: SESSION_ID,
      questions: [
        { id: "q1", text: "目标用户是哪些人？" },
        { id: "q2", text: "成功的衡量指标是什么？" },
      ],
      answers: [
        { questionId: "q1", text: "蓝图生成产品的内部研发同学" },
        { questionId: "q2", text: "首屏可读且无重复卡片" },
      ],
    },
  };
}

/**
 * 服务端推送的 artifact：
 * - `id` 为后端 `createId(...)` 生成的随机 id；
 * - `payload` 仅含 `sessionId`，可附额外只在服务端出现的 `summary` 字段以
 *   覆盖 Case B 的 payload-key 合并语义。
 */
function buildServerClarificationArtifact(
  payloadOverride?: Record<string, unknown>,
): BlueprintGenerationArtifact {
  return {
    id: "blueprint-artifact-9f2c",
    type: "clarification_session",
    title: "Clarification session",
    summary: "Server-pushed clarification artifact",
    createdAt: "2026-05-22T10:00:01Z",
    payload: payloadOverride ?? { sessionId: SESSION_ID },
  };
}

// ---------------------------------------------------------------------------
// Case A：representative id / type / createdAt 取本地
// ---------------------------------------------------------------------------

describe("mergeLogicalArtifacts — representative selection", () => {
  it("collapses local + server clarification artifacts with the same sessionId into a single entry whose id, type, and createdAt come from the local representative", () => {
    const local = buildLocalClarificationArtifact();
    const server = buildServerClarificationArtifact();

    const output = mergeLogicalArtifacts([local, server]);

    expect(output.length).toBe(1);
    const [merged] = output;

    // representative wins on id / type — 不被服务端的随机 id / 英文 title 覆盖
    expect(merged.id).toBe(`clarification-session-${SESSION_ID}`);
    expect(merged.type).toBe("clarification_session");

    // createdAt 取较早者；本地 10:00:00 < 服务端 10:00:01
    expect(merged.createdAt).toBe("2026-05-22T10:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// Case B：payload key 冲突 — 本地 wins on conflicting key，服务端补齐缺失键
// ---------------------------------------------------------------------------

describe("mergeLogicalArtifacts — payload key conflict", () => {
  it("merges payload keys from both sides while letting the local representative win on conflicting keys", () => {
    // 双方共享同一个 `sessionId` 才会落到相同的 LogicalArtifactKey
    // (`clar:S-123`)，从而真正进入合并路径；这是「同 logicalKey 下 payload
    // 浅合并」语义的前提。
    const local = buildLocalClarificationArtifact({
      sessionId: SESSION_ID,
      questions: [{ id: "q1", text: "目标用户是哪些人？" }],
      answers: [{ questionId: "q1", text: "蓝图生成产品的内部研发同学" }],
    });
    const server = buildServerClarificationArtifact({
      sessionId: SESSION_ID,
      summary: "Server-only summary field",
    });

    const output = mergeLogicalArtifacts([local, server]);

    expect(output.length).toBe(1);
    const [merged] = output;

    // payload 的 unknown 类型在测试中收窄为 record 后逐字段断言
    const payload = merged.payload as Record<string, unknown>;

    // 来自服务端 sparse payload 的字段被合并进来
    expect(payload).toHaveProperty("summary", "Server-only summary field");

    // 来自本地 rich payload 的字段被保留（不会被服务端的 sparse payload 擦除）
    expect(payload).toHaveProperty("questions");
    expect(payload).toHaveProperty("answers");

    // 关键不变量：sessionId 等于本地值，本地在键冲突时获胜
    expect(payload.sessionId).toBe(SESSION_ID);
  });
});

// ---------------------------------------------------------------------------
// Case C：空 / 非数组输入
// ---------------------------------------------------------------------------

describe("mergeLogicalArtifacts — empty input", () => {
  it("returns [] for an empty array without throwing", () => {
    expect(() => mergeLogicalArtifacts([])).not.toThrow();
    expect(mergeLogicalArtifacts([])).toEqual([]);
  });

  it("returns [] for a non-array (defensive guard) without throwing", () => {
    // merge-logical-artifacts.ts 用 `Array.isArray(artifacts)` 进行运行时守卫；
    // 这里通过 `as never` 显式绕过类型，验证非数组输入不会抛错。
    expect(() => mergeLogicalArtifacts(undefined as never)).not.toThrow();
    expect(mergeLogicalArtifacts(undefined as never)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bonus — 单条直通 + 不同 logicalKey 保序
// ---------------------------------------------------------------------------

describe("mergeLogicalArtifacts — pass-through and ordering", () => {
  it("returns a single-artifact input as a one-entry list with the same id and type", () => {
    const local = buildLocalClarificationArtifact();
    const output = mergeLogicalArtifacts([local]);

    expect(output.length).toBe(1);
    expect(output[0].id).toBe(local.id);
    expect(output[0].type).toBe(local.type);
  });

  it("preserves first-seen order for two artifacts with distinct logical keys", () => {
    const clarification = buildLocalClarificationArtifact();
    const intake: BlueprintGenerationArtifact = {
      id: "intake-456",
      type: "intake",
      title: "Intake",
      summary: "Intake artifact",
      createdAt: "2026-05-22T09:59:00Z",
      payload: { intakeId: "I-456" },
    };

    const output = mergeLogicalArtifacts([clarification, intake]);

    expect(output.length).toBe(2);
    expect(output[0].id).toBe(clarification.id);
    expect(output[1].id).toBe(intake.id);
  });
});
