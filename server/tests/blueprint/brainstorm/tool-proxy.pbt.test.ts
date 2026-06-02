/**
 * Brainstorm Tool Proxy Property-Based Tests
 *
 * Properties 10 and 11
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §4
 */

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type {
  BrainstormRoleId,
  ToolCategory,
  ToolInvocationRequest,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BrainstormToolProxy,
  type CapabilityBridgeFn,
  type EventEmitterFn,
} from "../../../routes/blueprint/brainstorm/tool-proxy";
import { getBrainstormRole } from "../../../routes/blueprint/brainstorm/role-registry";
import { BRAINSTORM_MAX_TOOL_CALLS } from "../../../routes/blueprint/brainstorm/orchestrator";

// ─── Valid domain values ────────────────────────────────────────────────────

const ALL_ROLE_IDS: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];

const ALL_TOOL_CATEGORIES: ToolCategory[] = ["docker", "mcp", "github", "skills"];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const arbRoleId: fc.Arbitrary<BrainstormRoleId> = fc.constantFrom(...ALL_ROLE_IDS);

const arbToolCategory: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  ...ALL_TOOL_CATEGORIES,
);

const arbToolId: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/);

const arbRequest: fc.Arbitrary<ToolInvocationRequest> = fc
  .record({
    roleId: arbRoleId,
    toolCategory: arbToolCategory,
    toolId: arbToolId,
  })
  .map((r) => ({
    sessionId: "pbt-session",
    roleId: r.roleId,
    toolCategory: r.toolCategory,
    toolId: r.toolId,
    params: {},
  }));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockBridges(): Record<ToolCategory, CapabilityBridgeFn> {
  return {
    docker: vi.fn().mockResolvedValue({ success: true, output: "docker" }),
    mcp: vi.fn().mockResolvedValue({ success: true, output: "mcp" }),
    github: vi.fn().mockResolvedValue({ success: true, output: "github" }),
    skills: vi.fn().mockResolvedValue({ success: true, output: "skills" }),
  };
}

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

// ─── Property 10: Tool permission validation ────────────────────────────────
// **Validates: Requirements 4.2**

describe("Property 10: Tool permission validation", () => {
  it("requests with disallowed categories are always rejected", async () => {
    await fc.assert(
      fc.asyncProperty(arbRoleId, arbToolCategory, arbToolId, async (roleId, category, toolId) => {
        const role = getBrainstormRole(roleId);
        if (!role) return; // skip unknown roles

        const allowed = role.toolPermissions.allowedCategories.includes(category);

        const proxy = new BrainstormToolProxy(makeMockBridges(), makeMockEmitter(), {
          sessionToolCallLimit: 1000,
        });

        const request: ToolInvocationRequest = {
          sessionId: `pbt-${roleId}-${category}`,
          roleId,
          toolCategory: category,
          toolId,
          params: {},
        };

        const result = await proxy.invoke(request);

        if (!allowed) {
          // Disallowed category must always be rejected
          expect(result.success).toBe(false);
          expect(result.error).toContain("Permission denied");
        } else {
          // Allowed category should succeed (bridge returns success)
          expect(result.success).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Tool call limit enforcement ───────────────────────────────
// **Validates: Requirements 4.5**

describe("Property 11: Tool call limit enforcement", () => {
  it("total tool invocations never exceed BRAINSTORM_MAX_TOOL_CALLS", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        async (limit, attemptCount) => {
          const proxy = new BrainstormToolProxy(makeMockBridges(), makeMockEmitter(), {
            sessionToolCallLimit: limit,
          });

          const sessionId = "pbt-limit-session";
          let successCount = 0;

          for (let i = 0; i < attemptCount; i++) {
            const request: ToolInvocationRequest = {
              sessionId,
              roleId: "architect", // has all categories allowed
              toolCategory: "mcp",
              toolId: `tool-${i}`,
              params: {},
            };

            const result = await proxy.invoke(request);
            if (result.success) {
              successCount++;
            }
          }

          // The number of successful tool invocations should never exceed the limit
          expect(successCount).toBeLessThanOrEqual(limit);
          expect(proxy.getSessionToolCount(sessionId)).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 100 },
    );
  });
});
