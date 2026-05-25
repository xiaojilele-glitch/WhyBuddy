/**
 * Builder-level integration test for clarification dedup.
 *
 * 关联设计文档与任务：
 *   `.kiro/specs/spec-first-stage-process-artifact-split-uniform/` Batch 1 / Task 1.7
 *   design.md Component 4 / Sequence 2 / Example 2
 *
 * **Validates: Requirements 2.3**
 * **Property: P8**
 *
 * 这是用户可见的「澄清提交后右栏出现两张卡片」bug 的对外保险测试 ——
 * 在 builder 层（`buildPreflightArtifactEntries`）做端到端断言，避免
 * 依赖 router / store / API / 全页面渲染：
 *
 * - Case A（去重主路径）：同一 sessionId 下，本地 rich payload + 服务端
 *   sparse payload 必须合并为 1 条 `clarification_session`，`id` 取本地
 *   可读形态 `clarification-session-S-123`；`payload.questions / answers`
 *   保留自本地，服务端只有的 `summary` 字段被填补进合并 payload。
 * - Case B（regression-prevention）：当本地与服务端落到不同 sessionId 时，
 *   两条 `clarification_session` 必须都通过，证明去重是按身份（sessionId）
 *   而非按 type 折叠。
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

import { buildPreflightArtifactEntries } from "../build-preflight-artifact-entries";

// ---------------------------------------------------------------------------
// Fixture builders — 与 design.md Example 2 形态一致
// ---------------------------------------------------------------------------

const SESSION_ID = "S-123";
const SERVER_ARTIFACT_ID = "blueprint-artifact-9f2c";

/**
 * 构造一份满足 `BlueprintClarificationSession` 必填字段的本地 session。
 *
 * 字段精度：
 * - `id` 是本测试的核心 logicalKey 来源（落在 `payload.id` 兜底分支）；
 * - `questions` / `answers` 提供小而真实的内容，用于验证「合并后这些
 *   rich 字段没有被服务端 sparse payload 擦除」；
 * - 其余必填字段填稳定默认，避免与逻辑去重无关的字段干扰断言。
 */
function buildClarificationSession(
  overrides: Partial<BlueprintClarificationSession> = {},
): BlueprintClarificationSession {
  return {
    id: SESSION_ID,
    intakeId: "intake-1",
    questions: [
      {
        id: "q1",
        kind: "goal",
        prompt: "目标用户是哪些人？",
        required: true,
        sourceIds: [],
        evidenceIds: [],
      },
      {
        id: "q2",
        kind: "audience",
        prompt: "成功的衡量指标是什么？",
        required: true,
        sourceIds: [],
        evidenceIds: [],
      },
    ],
    answers: [
      {
        questionId: "q1",
        answer: "蓝图生成产品的内部研发同学",
      },
      {
        questionId: "q2",
        answer: "首屏可读且无重复卡片",
      },
    ],
    readiness: {
      status: "ready",
      score: 1,
      answeredRequired: 2,
      requiredTotal: 2,
      missingQuestionIds: [],
    },
    createdAt: "2026-05-22T10:00:00Z",
    updatedAt: "2026-05-22T10:00:00Z",
    ...overrides,
  };
}

/**
 * 构造一个最小但合法的 `BlueprintGenerationJob`，artifacts 列表由调用方
 * 显式提供（让测试聚焦 artifact 级别的合并断言，不被 job 其它字段干扰）。
 */
function buildJob(
  artifacts: BlueprintGenerationArtifact[],
): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "running",
    stage: "clarification",
    version: "v1",
    createdAt: "2026-05-22T09:59:00Z",
    updatedAt: "2026-05-22T10:00:01Z",
    artifacts,
    events: [],
  };
}

/**
 * 构造一条服务端推送的 clarification_session artifact：
 * - `id` 是后端 `createId(...)` 风格的随机字符串（与本地 readable id 不同）；
 * - `payload` 仅含 `sessionId` 与一个 server-only `summary` 字段，模拟
 *   sparse payload。
 */
function buildServerClarificationArtifact(args: {
  sessionId: string;
  artifactId?: string;
  serverSummaryField?: string;
}): BlueprintGenerationArtifact {
  return {
    id: args.artifactId ?? SERVER_ARTIFACT_ID,
    type: "clarification_session",
    title: "Clarification session",
    summary: "Server-pushed clarification artifact",
    createdAt: "2026-05-22T10:00:01Z",
    payload: {
      sessionId: args.sessionId,
      summary: args.serverSummaryField ?? "Server-only summary field",
    },
  };
}

// ---------------------------------------------------------------------------
// Case A：dedup 主路径（用户可见 bug 的对外保险）
// ---------------------------------------------------------------------------

describe("buildPreflightArtifactEntries — clarification dedup", () => {
  it("collapses local + server clarification artifacts with the same sessionId into a single entry whose id and rich payload come from the local representative", () => {
    const clarificationSession = buildClarificationSession();
    const latestJob = buildJob([
      buildServerClarificationArtifact({ sessionId: SESSION_ID }),
    ]);

    const output = buildPreflightArtifactEntries({
      sub: "clarification",
      intake: null,
      projectContext: null,
      clarificationSession,
      routeSet: null,
      selection: null,
      specTree: null,
      job: latestJob,
    });

    // 仅对 clarification_session 做 type-级别断言，避免被未来其它 sub 数据污染。
    const clarifications = output.filter(
      (artifact) => artifact.type === "clarification_session",
    );
    expect(clarifications.length).toBe(1);

    const merged = clarifications[0];

    // representative 是本地：可读 id 与本地 createdAt 不被服务端的随机 id /
    // 稍晚 timestamp 覆盖。
    expect(merged.id).toBe(`clarification-session-${SESSION_ID}`);
    expect(merged.createdAt).toBe(clarificationSession.createdAt);

    const payload = merged.payload as Record<string, unknown>;

    // 本地 rich payload 字段在合并后被保留：questions / answers 不被
    // 服务端 sparse payload 擦除（这是 Bug 的核心反退化点）。
    expect(payload.questions).toEqual(clarificationSession.questions);
    expect(payload.answers).toEqual(clarificationSession.answers);

    // 服务端 sparse payload 中独有的 `summary` 字段被合并进来，证明
    // 「server fills missing keys」语义生效；同时 sessionId 对齐 SESSION_ID
    // （此处本地 / 服务端值一致，不构成键冲突）。
    expect(payload.summary).toBe("Server-only summary field");
    expect(payload.sessionId).toBe(SESSION_ID);
  });

  // -------------------------------------------------------------------------
  // Case B：身份不同时不要折叠（regression-prevention）
  // -------------------------------------------------------------------------

  it("does NOT collapse local and server clarification artifacts that target different sessionIds — dedup is identity-based, not type-based", () => {
    const clarificationSession = buildClarificationSession({ id: "S-123" });
    const latestJob = buildJob([
      buildServerClarificationArtifact({
        sessionId: "S-999",
        artifactId: "blueprint-artifact-other",
      }),
    ]);

    const output = buildPreflightArtifactEntries({
      sub: "clarification",
      intake: null,
      projectContext: null,
      clarificationSession,
      routeSet: null,
      selection: null,
      specTree: null,
      job: latestJob,
    });

    const clarifications = output.filter(
      (artifact) => artifact.type === "clarification_session",
    );
    expect(clarifications.length).toBe(2);

    // 两个独立 sessionId 都被保留（分别落在 `clar:S-123` 与 `clar:S-999`）。
    const ids = clarifications.map((artifact) => artifact.id);
    expect(ids).toContain("clarification-session-S-123");
    expect(ids).toContain("blueprint-artifact-other");
  });
});
