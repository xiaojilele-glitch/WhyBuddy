/**
 * Brainstorm Tool Proxy Unit Tests
 *
 * Tests permission validation, tool call limit enforcement,
 * Docker fallback behavior, and event emission.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §4
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { describe, expect, it, vi } from "vitest";

import type {
  ToolCategory,
  ToolInvocationRequest,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BrainstormToolProxy,
  type CapabilityBridgeFn,
  type EventEmitterFn,
} from "../../../routes/blueprint/brainstorm/tool-proxy";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockBridges(): Record<ToolCategory, CapabilityBridgeFn> {
  return {
    docker: vi.fn().mockResolvedValue({ success: true, output: "docker result" }),
    mcp: vi.fn().mockResolvedValue({ success: true, output: "mcp result" }),
    github: vi.fn().mockResolvedValue({ success: true, output: "github result" }),
    skills: vi.fn().mockResolvedValue({ success: true, output: "skills result" }),
  };
}

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

function makeRequest(
  overrides?: Partial<ToolInvocationRequest>,
): ToolInvocationRequest {
  return {
    sessionId: "session-1",
    roleId: "architect",
    toolCategory: "docker",
    toolId: "run-container",
    params: { command: "echo hello" },
    ...overrides,
  };
}

// ─── Permission Validation Tests ────────────────────────────────────────────

describe("BrainstormToolProxy - Permission Validation", () => {
  it("allows tool invocation when category is in role's allowedCategories", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    // Architect allows: docker, mcp, github, skills
    const request = makeRequest({ roleId: "architect", toolCategory: "docker" });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(true);
    expect(result.output).toBe("docker result");
  });

  it("rejects tool invocation when category is NOT in role's allowedCategories", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    // Decider only allows: mcp, github
    const request = makeRequest({ roleId: "decider", toolCategory: "docker" });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
    expect(result.error).toContain("docker");
  });

  it("rejects when role is auditor and requests docker", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    // Auditor only allows: mcp, github
    const request = makeRequest({ roleId: "auditor", toolCategory: "docker" });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
  });

  it("allows planner to use mcp", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    // Planner allows: mcp, github, skills
    const request = makeRequest({ roleId: "planner", toolCategory: "mcp" });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(true);
  });

  it("allows executor to use all categories", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    const categories: ToolCategory[] = ["docker", "mcp", "github", "skills"];
    for (const cat of categories) {
      const request = makeRequest({
        roleId: "executor",
        toolCategory: cat,
        sessionId: `session-${cat}`,
      });
      const result = await proxy.invoke(request);
      expect(result.success).toBe(true);
    }
  });
});

// ─── Tool Call Limit Enforcement Tests ──────────────────────────────────────

describe("BrainstormToolProxy - Tool Call Limit Enforcement", () => {
  it("enforces per-session tool call limit", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      sessionToolCallLimit: 3,
    });

    const request = makeRequest({ roleId: "architect", toolCategory: "mcp" });

    // First 3 calls should succeed
    for (let i = 0; i < 3; i++) {
      const result = await proxy.invoke(request);
      expect(result.success).toBe(true);
    }

    // 4th call should be rejected
    const result = await proxy.invoke(request);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Session tool call limit exceeded");
  });

  it("enforces per-member tool call limit (maxCallsPerMember)", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      sessionToolCallLimit: 100,
    });

    // Decider has maxCallsPerMember = 5
    const request = makeRequest({ roleId: "decider", toolCategory: "mcp" });

    for (let i = 0; i < 5; i++) {
      const result = await proxy.invoke(request);
      expect(result.success).toBe(true);
    }

    // 6th call should be rejected due to member limit
    const result = await proxy.invoke(request);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Member tool call limit exceeded");
  });

  it("tracks different sessions independently", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      sessionToolCallLimit: 2,
    });

    const request1 = makeRequest({
      sessionId: "session-A",
      roleId: "architect",
      toolCategory: "mcp",
    });
    const request2 = makeRequest({
      sessionId: "session-B",
      roleId: "architect",
      toolCategory: "mcp",
    });

    // 2 calls to session A
    await proxy.invoke(request1);
    await proxy.invoke(request1);

    // Session A at limit
    const rejectedA = await proxy.invoke(request1);
    expect(rejectedA.success).toBe(false);

    // Session B should still work
    const resultB = await proxy.invoke(request2);
    expect(resultB.success).toBe(true);
  });

  it("reports correct session tool count", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    expect(proxy.getSessionToolCount("session-1")).toBe(0);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));
    expect(proxy.getSessionToolCount("session-1")).toBe(1);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "github" }));
    expect(proxy.getSessionToolCount("session-1")).toBe(2);
  });

  it("isWithinLimit returns correct boolean", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      sessionToolCallLimit: 2,
    });

    expect(proxy.isWithinLimit("session-1")).toBe(true);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));
    expect(proxy.isWithinLimit("session-1")).toBe(true);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));
    expect(proxy.isWithinLimit("session-1")).toBe(false);
  });
});

// ─── Docker Fallback Tests ──────────────────────────────────────────────────

describe("BrainstormToolProxy - Docker Fallback", () => {
  it("returns simulated response when Docker is unreachable", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      dockerReachable: false,
    });

    const request = makeRequest({
      roleId: "architect",
      toolCategory: "docker",
      toolId: "run-analysis",
    });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      simulated: true,
      message: expect.stringContaining("run-analysis"),
    });
    // Should not call the actual docker bridge
    expect(bridges.docker).not.toHaveBeenCalled();
  });

  it("emits brainstorm.degraded event when Docker fallback is used", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      dockerReachable: false,
    });

    const request = makeRequest({
      roleId: "architect",
      toolCategory: "docker",
    });
    await proxy.invoke(request);

    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.degraded",
      expect.objectContaining({
        reason: expect.stringContaining("Docker bridge unreachable"),
        affectedComponent: "tool-proxy",
      }),
    );
  });

  it("routes normally when Docker is reachable", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      dockerReachable: true,
    });

    const request = makeRequest({
      roleId: "architect",
      toolCategory: "docker",
    });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(true);
    expect(result.output).toBe("docker result");
    expect(bridges.docker).toHaveBeenCalled();
  });

  it("setDockerReachable toggles the fallback behavior", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      dockerReachable: true,
    });

    // Initially reachable
    expect(proxy.isDockerReachable()).toBe(true);

    // Set unreachable
    proxy.setDockerReachable(false);
    expect(proxy.isDockerReachable()).toBe(false);

    const request = makeRequest({
      roleId: "architect",
      toolCategory: "docker",
    });
    const result = await proxy.invoke(request);
    expect(result.output).toMatchObject({ simulated: true });
  });
});

// ─── Event Emission Tests ───────────────────────────────────────────────────

describe("BrainstormToolProxy - Event Emission", () => {
  it("emits brainstorm.tool.completed on successful invocation", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    const request = makeRequest({ roleId: "architect", toolCategory: "mcp" });
    await proxy.invoke(request);

    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.tool.completed",
      expect.objectContaining({
        sessionId: "session-1",
        roleId: "architect",
        toolCategory: "mcp",
        toolId: "run-container",
      }),
    );
  });

  it("emits brainstorm.tool.failed on permission denial", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    const request = makeRequest({ roleId: "decider", toolCategory: "docker" });
    await proxy.invoke(request);

    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.tool.failed",
      expect.objectContaining({
        sessionId: "session-1",
        roleId: "decider",
        toolCategory: "docker",
        error: expect.stringContaining("Permission denied"),
      }),
    );
  });

  it("emits brainstorm.tool.failed when bridge throws", async () => {
    const bridges = makeMockBridges();
    (bridges.mcp as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("MCP connection failed"),
    );
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    const request = makeRequest({ roleId: "architect", toolCategory: "mcp" });
    const result = await proxy.invoke(request);

    expect(result.success).toBe(false);
    expect(result.error).toBe("MCP connection failed");
    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.tool.failed",
      expect.objectContaining({
        error: "MCP connection failed",
      }),
    );
  });

  it("emits brainstorm.tool.failed when session limit exceeded", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter, {
      sessionToolCallLimit: 1,
    });

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));
    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));

    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.tool.failed",
      expect.objectContaining({
        error: expect.stringContaining("Session tool call limit exceeded"),
      }),
    );
  });
});

// ─── Invocation Records ─────────────────────────────────────────────────────

describe("BrainstormToolProxy - Invocation Records", () => {
  it("stores invocation records for successful calls", async () => {
    const bridges = makeMockBridges();
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));

    const records = proxy.getInvocationRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      toolCategory: "mcp",
      toolId: "run-container",
      success: true,
    });
    expect(records[0].requestId).toBeDefined();
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stores invocation records for failed bridge calls", async () => {
    const bridges = makeMockBridges();
    (bridges.mcp as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Tool not found",
    });
    const emitter = makeMockEmitter();
    const proxy = new BrainstormToolProxy(bridges, emitter);

    await proxy.invoke(makeRequest({ roleId: "architect", toolCategory: "mcp" }));

    const records = proxy.getInvocationRecords();
    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
  });
});
