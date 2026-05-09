/**
 * Unit tests for createAigcSpecNodeCapabilityBridge (Task 13).
 *
 * Covers all 5 error tiers plus the happy path and a redaction E2E check.
 * Every test is example-based per requirements 9.3.
 *
 * All tests run entirely in-process via a fake `ctx` constructed per-test:
 * - No real LLM calls
 * - No real HTTP requests
 * - No reliance on real process env beyond setting/unsetting the flag
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCapabilityInvocationLogs,
  buildCapabilityOutputSummary,
  deterministicCapabilityDuration,
} from "../../blueprint.js";
import type { BlueprintServiceContext } from "../context.js";
import {
  createAigcSpecNodeCapabilityBridge,
  type AigcSpecNodeCapabilityBridgeInput,
} from "./bridge.js";
import type {
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";

// ---- Fixtures ---------------------------------------------------------------

const capability: BlueprintRuntimeCapability = {
  id: "aigc-spec-node",
  label: "AIGC SPEC derivation node",
  kind: "aigc_node",
  purpose: "",
  description: "",
  tags: [],
  securityLevel: "sandboxed",
  status: "available",
  adapter: "blueprint.runtime.aigc.spec-node.simulated",
  inputSchema: "",
  outputTypes: [],
  supportedStages: ["route_generation"],
  requiresApproval: false,
  projectScoped: false,
};

const route: BlueprintRouteCandidate = {
  id: "rs-1:primary",
  kind: "primary",
  title: "Primary SPEC asset route",
  summary: "Derive the SPEC tree from the current GitHub repository.",
  rationale: "",
  riskLevel: "medium",
  costLevel: "medium",
  complexity: "balanced",
  estimatedEffort: "",
  capabilities: [
    {
      id: "aigc-spec-node",
      label: "AIGC SPEC derivation node",
      kind: "aigc_node",
      purpose: "",
    },
  ],
  steps: [],
  outputs: [],
};

const routeSet: BlueprintRouteSet = {
  id: "rs-1",
  requestId: "req-1",
  createdAt: "2026-05-09T00:00:00.000Z",
  primaryRouteId: route.id,
  routes: [route],
  nextAsset: { type: "spec_tree", menu: "deduction", description: "" },
  provenance: { githubUrls: [] },
};

function makeInput(
  overrides: Partial<AigcSpecNodeCapabilityBridgeInput> = {},
): AigcSpecNodeCapabilityBridgeInput {
  const request: BlueprintGenerationRequest = {
    targetText: "Build a release dashboard.",
    githubUrls: ["https://github.com/example/dashboard"],
  };
  return {
    capability,
    route,
    jobId: "job-1",
    request,
    routeSet,
    createdAt: "2026-05-09T00:00:00.000Z",
    invocationId: "inv-1",
    roleId: "role-runtime-executor",
    ...overrides,
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

interface BuildCtxOptions {
  callJson?: (messages: unknown, opts?: unknown) => Promise<unknown>;
  apiKey?: string;
  model?: string;
  /** By default uses a fake-clock returning monotonically increasing times. */
  now?: () => Date;
}

function buildCtx(opts: BuildCtxOptions = {}): BlueprintServiceContext {
  const logger = makeLogger();
  let calls = 0;
  const defaultNow = () => new Date(1_700_000_000_000 + calls++ * 10);

  const fakeCallJson = opts.callJson ?? vi.fn(async () => undefined);
  const getConfig = () => ({
    model: opts.model ?? "gpt-4-turbo",
    apiKey: opts.apiKey ?? "sk-test-valid",
  });

  return {
    now: opts.now ?? defaultNow,
    blueprintStores: {
      intakes: new Map(),
      clarificationSessions: new Map(),
      projectContexts: new Map(),
    },
    jobStore: {
      list: () => [],
      get: () => null,
      save: () => {},
      latest: () => null,
    },
    llm: {
      callJson: fakeCallJson as unknown as BlueprintServiceContext["llm"]["callJson"],
      getConfig: getConfig as unknown as BlueprintServiceContext["llm"]["getConfig"],
    },
    sandboxDerivationRunner: async () => ({ artifacts: [], events: [] }),
    replayStore: { listEvents: () => [], listArtifacts: () => [] },
    eventBus: { emit: () => {}, subscribe: () => () => {} },
    specsRoot: "/tmp/specs",
    logger,
  };
}

// ---- Tests ------------------------------------------------------------------

describe("createAigcSpecNodeCapabilityBridge", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path: returns real invocation when callJson yields a valid structured payload (13.1)", async () => {
    const ctx = buildCtx({
      callJson: async () => ({
        subsystems: ["Ingestion", "Aggregation", "Rendering"],
        riskNotes: ["Latency spikes"],
        confidence: 0.8,
      }),
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());

    expect(result.executionMode).toBe("real");
    expect(result.invocation.provenance.executionMode).toBe("real");
    expect(result.invocation.provenance.promptId).toBe(
      "blueprint.aigc-spec-node.v1",
    );
    expect(result.invocation.provenance.model).toBe("gpt-4-turbo");
    expect(result.invocation.provenance.responseDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(result.invocation.provenance.structuredPayloadDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(result.invocation.provenance.promptFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(result.invocation.provenance.error).toBeUndefined();
    expect(result.invocation.outputSummary).toMatch(/3\s+subsystems/);
    expect(result.invocation.outputSummary).toMatch(/1\s+risk/);
    expect(result.invocation.durationMs).toBeGreaterThanOrEqual(0);
    for (const line of result.invocation.logs) {
      // no English system prompt leak
      expect(line).not.toContain("You are");
      // no Chinese system prompt leak
      expect(line).not.toContain("你是");
    }
    // structuredPayloadRef should be attached for later evidence enrichment
    const ref = (
      result.invocation as unknown as {
        __aigcStructuredPayloadRef?: {
          digest: string;
          byteSize: number;
          summary: string;
        };
      }
    ).__aigcStructuredPayloadRef;
    expect(ref).toBeDefined();
    expect(ref?.digest).toBe(
      result.invocation.provenance.structuredPayloadDigest,
    );
    expect(ref?.byteSize).toBeGreaterThan(0);
    expect(ref?.summary).toContain("3 subsystems");
  });

  it("malformed: fallback with non-json response error when callJson returns undefined (13.2)", async () => {
    const ctx = buildCtx({ callJson: async () => undefined });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());

    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.executionMode).toBe(
      "simulated_fallback",
    );
    expect(result.invocation.provenance.error).toMatch(/non-json response/);

    // byte-identical templated fields:
    const input = `Derive route candidate ${route.title} with ${capability.label}.`;
    const expectedOutputSummary = buildCapabilityOutputSummary({
      capability,
      routeTitle: route.title,
      input,
    });
    const expectedLogs = buildCapabilityInvocationLogs(
      capability,
      expectedOutputSummary,
    );
    const expectedDuration = deterministicCapabilityDuration(capability, {
      capabilityId: capability.id,
      roleId: "role-runtime-executor",
      routeId: route.id,
      input,
    });
    expect(result.invocation.outputSummary).toBe(expectedOutputSummary);
    expect(result.invocation.logs).toEqual(expectedLogs);
    expect(result.invocation.durationMs).toBe(expectedDuration);
  });

  it("malformed: fallback when callJson returns a plain string (still non-object)", async () => {
    const ctx = buildCtx({
      callJson: async () => "not json" as unknown as undefined,
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toMatch(/non-json response/);
  });

  it("schema fail: fallback when subsystems is empty array (13.3)", async () => {
    const ctx = buildCtx({
      callJson: async () => ({ subsystems: [], riskNotes: ["r"] }),
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toMatch(
      /schema validation failed/,
    );
  });

  it("schema fail: fallback when confidence is out of range (13.3)", async () => {
    const ctx = buildCtx({
      callJson: async () => ({
        subsystems: ["a"],
        riskNotes: [],
        confidence: 2,
      }),
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toMatch(/schema/);
  });

  it("apiKey missing: never calls callJson (13.4)", async () => {
    const callJsonSpy = vi.fn();
    const ctx = buildCtx({
      callJson: callJsonSpy as unknown as BuildCtxOptions["callJson"],
      apiKey: "",
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toMatch(/llm apiKey missing/);
    expect(callJsonSpy).not.toHaveBeenCalled();
  });

  it("not enabled (tier 1): never calls callJson, uses debug logger (13.5)", async () => {
    // Clear the enabling stub from beforeEach. This test represents the
    // default out-of-the-box behavior where the env flag is absent.
    vi.unstubAllEnvs();
    const callJsonSpy = vi.fn();
    const ctx = buildCtx({
      callJson: callJsonSpy as unknown as BuildCtxOptions["callJson"],
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toBe("bridge not enabled");
    expect(callJsonSpy).not.toHaveBeenCalled();
    expect(ctx.logger.debug).toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it("timeout (tier 5): fallback with 'llm timeout' when callJson throws timeout error (13.6)", async () => {
    const ctx = buildCtx({
      callJson: async () => {
        throw new Error("Request aborted due to timeout");
      },
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toBe("llm timeout");
  });

  it("generic callJson throw: fallback with 'llm callJson threw' (tier 3 alternate path)", async () => {
    const ctx = buildCtx({
      callJson: async () => {
        throw new Error("upstream 503");
      },
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("simulated_fallback");
    expect(result.invocation.provenance.error).toMatch(
      /llm callJson threw: upstream 503/,
    );
  });

  it("redaction E2E: outputSummary and logs never contain raw sensitive markers (13.7)", async () => {
    const markerApiKey = "sk-ABCDEFGHIJKLMNOP1234567890";
    const markerEmail = "user@example.com";
    const ctx = buildCtx({
      callJson: async () => ({
        subsystems: [`Ingestion (key=${markerApiKey})`],
        riskNotes: [`contact ${markerEmail} for escalation`],
      }),
    });
    const bridge = createAigcSpecNodeCapabilityBridge(ctx);
    const result = await bridge(makeInput());
    expect(result.executionMode).toBe("real");

    const allText =
      result.invocation.outputSummary + "\n" + result.invocation.logs.join("\n");
    expect(allText).not.toContain(markerApiKey);
    expect(allText).not.toContain(markerEmail);
    // The digests are fine (they're hashes, not raw)
    expect(result.invocation.provenance.structuredPayloadDigest).toMatch(
      /^sha256:/,
    );
  });
});
