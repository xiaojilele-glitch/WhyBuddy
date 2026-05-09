/**
 * Unit tests for AigcSpecNodeCapabilityPolicy + applyAigcNodeCapabilityRedaction
 * (autopilot-capability-bridge-aigc-node, task 6).
 *
 * Validates the policy contract + redaction behavior documented in:
 *   - requirements.md 2.4 / 4.6 / 7.4
 *   - design.md §4.3 / §D10
 *   - tasks.md 6.1–6.6
 *
 * Every test case is example-based per requirements 9.3 (no PBT in this spec).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAigcNodeCapabilityRedaction,
  createDefaultAigcSpecNodeCapabilityPolicy,
  type AigcSpecNodeCapabilityPolicy,
} from "./policy.js";

describe("applyAigcNodeCapabilityRedaction (task 6.1–6.3)", () => {
  const policy: AigcSpecNodeCapabilityPolicy =
    createDefaultAigcSpecNodeCapabilityPolicy();

  it("redacts OpenAI-style sk-* API keys (task 6.1)", () => {
    const input = "key=sk-ABCDEFGHIJKLMNOP1234567890";
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    expect(output).not.toContain("sk-ABCDEFGHIJKLMNOP1234567890");
    expect(output).toContain("[redacted-api-key]");
  });

  it("redacts classic GitHub PAT ghp_* (task 6.1)", () => {
    const input = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    expect(output).toBe("[redacted-github-token]");
  });

  it("redacts fine-grained github_pat_* tokens (task 6.1)", () => {
    // The regex expects at least 22 chars after the prefix for fine-grained PATs.
    const input = "github_pat_abcdefghijklmnopqrstuv";
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    expect(output).toBe("[redacted-github-token]");
  });

  it("redacts email addresses (task 6.2)", () => {
    const output = applyAigcNodeCapabilityRedaction(
      "user@example.com",
      policy,
    );
    expect(output).toBe("[redacted-email]");
  });

  it("collapses Authorization: Bearer <jwt> entirely (task 6.3)", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9";
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    expect(output).toBe("Authorization: [redacted]");
    expect(output).not.toContain("Bearer");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("redacts api_key=<value> via keyword pair matching (task 6.3)", () => {
    const input = "api_key=superSecret123";
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    expect(output).toBe("api_key: [redacted]");
    expect(output).not.toContain("superSecret123");
  });

  it("returns non-string / empty inputs unchanged (defensive)", () => {
    expect(applyAigcNodeCapabilityRedaction("", policy)).toBe("");
    // TypeScript wouldn't normally let us pass undefined, but the runtime
    // guard still protects bridge call sites from upstream surprises.
    expect(
      applyAigcNodeCapabilityRedaction(
        undefined as unknown as string,
        policy,
      ),
    ).toBeUndefined();
  });
});

describe("createDefaultAigcSpecNodeCapabilityPolicy (task 6.4)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns design §4.3 defaults when env var is unset", () => {
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "");
    const p = createDefaultAigcSpecNodeCapabilityPolicy();
    expect(p.maxInvocationTimeoutMs).toBe(30_000);
    expect(p.temperature).toBe(0.2);
    expect(p.maxLogLines).toBe(20);
    expect(p.maxLogBytes).toBe(4_096);
    expect(p.maxStructuredPayloadSummaryBytes).toBe(300);
    expect(p.callJsonRetryAttempts).toBe(1);
    expect([...p.redactionKeywords]).toEqual([
      "authorization",
      "token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "bearer",
      "access_token",
      "x-github-token",
      "openai-api-key",
    ]);
    // Regex identity (exercise on known marker strings rather than inspecting source)
    expect("a@b.co".replace(p.redactedEmailPattern, "X")).toBe("X");
    expect(
      "sk-ABCDEFGHIJKLMNOP1234567890".replace(p.redactedApiKeyPattern, "X"),
    ).toBe("X");
    expect(
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB".replace(
        p.redactedGithubPatPattern,
        "X",
      ),
    ).toBe("X");
  });
});

describe("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS override (task 6.5)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honors a legal override value within [1, 30_000]", () => {
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "15000");
    const p = createDefaultAigcSpecNodeCapabilityPolicy();
    expect(p.maxInvocationTimeoutMs).toBe(15_000);
  });

  it("clamps an over-ceiling override back to 30_000", () => {
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "99999");
    const p = createDefaultAigcSpecNodeCapabilityPolicy();
    expect(p.maxInvocationTimeoutMs).toBe(30_000);
  });

  it("falls back to 30_000 when override is not numeric", () => {
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "abc");
    const p = createDefaultAigcSpecNodeCapabilityPolicy();
    expect(p.maxInvocationTimeoutMs).toBe(30_000);
  });

  it("falls back to 30_000 when override is zero or negative", () => {
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "0");
    expect(
      createDefaultAigcSpecNodeCapabilityPolicy().maxInvocationTimeoutMs,
    ).toBe(30_000);
    vi.stubEnv("BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS", "-500");
    expect(
      createDefaultAigcSpecNodeCapabilityPolicy().maxInvocationTimeoutMs,
    ).toBe(30_000);
  });
});

describe("ReDoS sentinel (task 6.6)", () => {
  it("redacts 5MB of benign text in under 200ms", () => {
    const policy = createDefaultAigcSpecNodeCapabilityPolicy();
    // 5MB of lorem-ipsum-ish text with no sensitive markers so the regex
    // replacements iterate but never match.
    const chunk = "lorem ipsum dolor sit amet consectetur adipiscing elit ";
    const target = 5 * 1024 * 1024;
    let buf = "";
    while (buf.length < target) {
      buf += chunk;
    }
    const input = buf.slice(0, target);

    const start = process.hrtime.bigint();
    const output = applyAigcNodeCapabilityRedaction(input, policy);
    const elapsedMs = Number((process.hrtime.bigint() - start) / 1_000_000n);

    expect(output.length).toBe(input.length);
    // Generous upper bound — on typical CI hardware this completes in a few
    // tens of milliseconds. A hard 200ms cap is enough to catch a future
    // regression where one of the regexes gains catastrophic backtracking.
    expect(elapsedMs).toBeLessThan(200);
  });
});
