/**
 * Unit tests for buildAigcSpecNodePrompt + AIGC_SPEC_NODE_PROMPT_ID
 * (autopilot-capability-bridge-aigc-node, task 8).
 *
 * Validates:
 *   - requirements.md 2.2 / 2.5 / 2.7 / 7.2
 *   - design.md §4.5
 *   - tasks.md 8.1–8.6
 *
 * Every test case is example-based per requirements 9.3.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
} from "../../../../shared/blueprint/index.js";

import {
  AIGC_SPEC_NODE_PROMPT_ID,
  buildAigcSpecNodePrompt,
} from "./prompt.js";

const baseRoute: BlueprintRouteCandidate = {
  id: "rs-abc:primary",
  kind: "primary",
  title: "Primary SPEC asset route",
  summary: "Derive the SPEC tree from the current GitHub repository.",
  rationale: "",
  riskLevel: "medium",
  costLevel: "medium",
  complexity: "balanced",
  estimatedEffort: "",
  capabilities: [],
  steps: [],
  outputs: [],
};

function makeClarificationSession(
  answers: Array<{ questionId: string; answer: string }> = [],
): BlueprintClarificationSession {
  return {
    id: "sess-1",
    intakeId: "intake-1",
    strategyId: "target_first",
    templateId: "target-first-v1",
    questions: [],
    answers: answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
    })),
    readiness: {
      status: "ready",
      score: 1,
      answeredRequired: answers.length,
      requiredTotal: answers.length,
      missingQuestionIds: [],
    },
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

describe("AIGC_SPEC_NODE_PROMPT_ID (task 8.4)", () => {
  it("is frozen to blueprint.aigc-spec-node.v1", () => {
    expect(AIGC_SPEC_NODE_PROMPT_ID).toBe("blueprint.aigc-spec-node.v1");
  });
});

describe("buildAigcSpecNodePrompt – determinism (task 8.1)", () => {
  it("produces byte-identical userMessage and promptFingerprint for identical inputs", () => {
    const request: BlueprintGenerationRequest = {
      targetText: "build a dashboard",
      githubUrls: ["url1", "url2"],
      projectId: "proj-1",
      sourceId: "src-1",
    };
    const session = makeClarificationSession([
      { questionId: "q-a", answer: "A" },
      { questionId: "q-b", answer: "B" },
    ]);

    const a = buildAigcSpecNodePrompt({
      request,
      clarificationSession: session,
      route: baseRoute,
      locale: "en-US",
    });
    const b = buildAigcSpecNodePrompt({
      request,
      clarificationSession: session,
      route: baseRoute,
      locale: "en-US",
    });

    expect(a.userMessage).toBe(b.userMessage);
    expect(a.promptFingerprint).toBe(b.promptFingerprint);
    expect(a.systemMessage).toBe(b.systemMessage);
  });
});

describe("buildAigcSpecNodePrompt – locale (task 8.2)", () => {
  const request: BlueprintGenerationRequest = { targetText: "t" };

  it("emits a CJK systemMessage when locale is zh-CN", () => {
    const result = buildAigcSpecNodePrompt({
      request,
      route: baseRoute,
      locale: "zh-CN",
    });
    expect(result.systemMessage).toMatch(/[\u4e00-\u9fa5]/);
  });

  it("emits an English-only systemMessage when locale is en-US", () => {
    const result = buildAigcSpecNodePrompt({
      request,
      route: baseRoute,
      locale: "en-US",
    });
    expect(result.systemMessage.startsWith("You are")).toBe(true);
    expect(result.systemMessage).not.toMatch(/[\u4e00-\u9fa5]/);
  });
});

describe("buildAigcSpecNodePrompt – answer sort (task 8.3)", () => {
  it("sorts clarification.answers by questionId ascending", () => {
    const result = buildAigcSpecNodePrompt({
      request: {},
      clarificationSession: makeClarificationSession([
        { questionId: "q-b", answer: "B" },
        { questionId: "q-a", answer: "A" },
      ]),
      route: baseRoute,
      locale: "en-US",
    });
    const clarification = (
      result.userPayload as {
        clarification?: { answers: Array<{ questionId: string }> };
      }
    ).clarification;
    expect(clarification).toBeDefined();
    expect(clarification?.answers.map((a) => a.questionId)).toEqual([
      "q-a",
      "q-b",
    ]);
  });

  it("does not mutate the original answers array", () => {
    const original = [
      { questionId: "q-b", answer: "B" },
      { questionId: "q-a", answer: "A" },
    ];
    const session = makeClarificationSession(original);
    // Capture identity of first entry before the call so we can assert the
    // session's own answers array order is preserved.
    const firstBefore = session.answers[0];
    buildAigcSpecNodePrompt({
      request: {},
      clarificationSession: session,
      route: baseRoute,
      locale: "en-US",
    });
    expect(session.answers[0]).toBe(firstBefore);
    expect(session.answers.map((a) => a.questionId)).toEqual(["q-b", "q-a"]);
  });
});

describe("buildAigcSpecNodePrompt – promptId & fingerprint (tasks 8.4 / 8.5)", () => {
  it("returns promptId equal to AIGC_SPEC_NODE_PROMPT_ID", () => {
    const result = buildAigcSpecNodePrompt({
      request: {},
      route: baseRoute,
      locale: "en-US",
    });
    expect(result.promptId).toBe(AIGC_SPEC_NODE_PROMPT_ID);
  });

  it("produces a promptFingerprint in sha256:<hex64> form", () => {
    const result = buildAigcSpecNodePrompt({
      request: { targetText: "abc" },
      route: baseRoute,
      locale: "en-US",
    });
    expect(result.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fingerprint equals sha256(systemMessage + \\n\\n + userMessage)", () => {
    const result = buildAigcSpecNodePrompt({
      request: { targetText: "abc" },
      route: baseRoute,
      locale: "en-US",
    });
    const expected =
      "sha256:" +
      createHash("sha256")
        .update(`${result.systemMessage}\n\n${result.userMessage}`, "utf8")
        .digest("hex");
    expect(result.promptFingerprint).toBe(expected);
  });
});

describe("buildAigcSpecNodePrompt – userMessage content (task 8.6)", () => {
  it("contains targetText and githubUrls in input order", () => {
    const result = buildAigcSpecNodePrompt({
      request: {
        targetText: "build a dashboard",
        githubUrls: ["url1", "url2"],
      },
      route: baseRoute,
      locale: "en-US",
    });
    expect(result.userMessage).toContain("build a dashboard");
    const url1Pos = result.userMessage.indexOf("url1");
    const url2Pos = result.userMessage.indexOf("url2");
    expect(url1Pos).toBeGreaterThan(-1);
    expect(url2Pos).toBeGreaterThan(url1Pos);
  });

  it("omits clarification key entirely when clarificationSession is undefined", () => {
    const result = buildAigcSpecNodePrompt({
      request: { targetText: "t" },
      route: baseRoute,
      locale: "en-US",
    });
    expect("clarification" in result.userPayload).toBe(false);
    // Also absent from the serialised userMessage
    expect(result.userMessage).not.toMatch(/"clarification"\s*:/);
  });

  it("omits projectContext key when both projectId and sourceId are missing", () => {
    const result = buildAigcSpecNodePrompt({
      request: { targetText: "t" },
      route: baseRoute,
      locale: "en-US",
    });
    expect("projectContext" in result.userPayload).toBe(false);
  });

  it("includes projectContext when projectId is present", () => {
    const result = buildAigcSpecNodePrompt({
      request: { projectId: "p-1" },
      route: baseRoute,
      locale: "en-US",
    });
    expect("projectContext" in result.userPayload).toBe(true);
  });
});
