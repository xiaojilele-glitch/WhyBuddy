/**
 * Task 1.3 — Deterministic_Provider assembly property tests.
 * Feature: whybuddy-llm-autonomous-reasoning (Requirements 13.1, 13.3, 13.4, 13.5)
 */
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import {
  assembleProvidersForBuildTarget,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  isTestBuildTarget,
} from "../whybuddy-runtime";
import {
  assembleProvidersForBuildTarget as assembleServerProviders,
  createDeterministicRouter as createServerDeterministicRouter,
  isTestBuildTarget as isServerTestBuildTarget,
} from "../../../../server/whybuddy/deterministic-provider.js";

const PBT_OPTS = { numRuns: 100 };

describe("Task 1.3: Deterministic_Provider assembly", () => {
  it("BUILD_TARGET=test defaults to deterministic stand-ins (client)", () => {
    fc.assert(
      fc.property(fc.constant("test"), (buildTarget) => {
        const assembled = assembleProvidersForBuildTarget({ buildTarget });
        expect(assembled.deterministic).toBe(true);
        expect(isTestBuildTarget(buildTarget)).toBe(true);
      }),
      PBT_OPTS
    );
  });

  it("BUILD_TARGET=test defaults to deterministic stand-ins (server)", () => {
    const assembled = assembleServerProviders({ buildTarget: "test" });
    expect(assembled.deterministic).toBe(true);
    expect(isServerTestBuildTarget("test")).toBe(true);
  });

  it("explicit router injection overrides default assembly", () => {
    const custom = createDeterministicRouter([
      { selected: [], rationale: "x", source: "heuristic_fallback", converged: true },
    ]);
    const assembled = assembleProvidersForBuildTarget({
      buildTarget: "test",
      router: custom,
    });
    expect(assembled.router).toBe(custom);
  });

  it("createDeterministicRouter performs zero real-LLM calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network blocked"));

    const router = createDeterministicRouter();
    const res = await router.proposePlan({
      state: {
        sessionId: "s",
        goal: { text: "对比运维成本", status: "needs_refinement" },
        artifacts: [],
        staleArtifactIds: [],
        decisionLedger: [],
        capabilityRuns: [],
      } as any,
      turnId: "t-det",
      userText: "对比运维成本",
    });

    expect(res.source).toBe("heuristic_fallback");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("createDeterministicCapabilityExecutor performs zero network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network blocked"));

    const executor = createDeterministicCapabilityExecutor();
    const res = await executor.executeCapability({
      capabilityId: "risk.analyze",
      state: {
        sessionId: "s",
        goal: { text: "风险", status: "needs_refinement" },
        artifacts: [],
        staleArtifactIds: [],
        decisionLedger: [],
        capabilityRuns: [],
      } as any,
      inputArtifactIds: [],
      roleId: "安全",
      turnId: "t-exec",
    });

    expect(res.content.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("useReal=true under test target assembles non-default router slot", () => {
    const realRouter = createServerDeterministicRouter();
    const assembled = assembleServerProviders({
      buildTarget: "test",
      useReal: true,
      realRouter,
    });
    expect(assembled.deterministic).toBe(false);
    expect(assembled.router).toBe(realRouter);
  });
});