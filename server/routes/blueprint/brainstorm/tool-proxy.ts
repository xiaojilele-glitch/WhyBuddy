/**
 * @description Brainstorm Tool Proxy — unified interface for tool invocations
 * within brainstorm sessions. Validates permissions, enforces limits,
 * routes to capability bridges, and handles Docker degradation.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §4
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import crypto from "node:crypto";

import type {
  BrainstormRoleId,
  ToolCategory,
  ToolInvocationRecord,
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolPermissionScope,
} from "../../../../shared/blueprint/brainstorm-contracts";

import { getBrainstormRole } from "./role-registry";
import { BRAINSTORM_MAX_TOOL_CALLS } from "./orchestrator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Capability bridge function signature — injectable for testing. */
export type CapabilityBridgeFn = (
  toolId: string,
  params: Record<string, unknown>,
) => Promise<{ success: boolean; output?: unknown; error?: string }>;

/** Event emitter function signature — injectable for testing. */
export type EventEmitterFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => void;

/** Configuration for the BrainstormToolProxy. */
export interface ToolProxyConfig {
  /** Per-session tool call limit. Defaults to BRAINSTORM_MAX_TOOL_CALLS. */
  sessionToolCallLimit?: number;
  /** Whether Docker bridge is reachable. Defaults to true. */
  dockerReachable?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Proxy
// ---------------------------------------------------------------------------

export class BrainstormToolProxy {
  private sessionToolCounts: Map<string, number> = new Map();
  private memberToolCounts: Map<string, number> = new Map();
  private invocationRecords: ToolInvocationRecord[] = [];
  private readonly sessionToolCallLimit: number;
  private dockerReachable: boolean;

  constructor(
    private readonly bridges: Record<ToolCategory, CapabilityBridgeFn>,
    private readonly emitEvent: EventEmitterFn,
    config?: ToolProxyConfig,
  ) {
    this.sessionToolCallLimit =
      config?.sessionToolCallLimit ?? BRAINSTORM_MAX_TOOL_CALLS;
    this.dockerReachable = config?.dockerReachable ?? true;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Invoke a tool through the proxy with permission validation and limit enforcement.
   */
  async invoke(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();

    // 1. Check per-session tool call limit
    const sessionCount = this.getSessionToolCount(request.sessionId);
    if (sessionCount >= this.sessionToolCallLimit) {
      const result: ToolInvocationResult = {
        success: false,
        error: `Session tool call limit exceeded (${this.sessionToolCallLimit})`,
        durationMs: Date.now() - startTime,
      };
      this.emitEvent("brainstorm.tool.failed", {
        sessionId: request.sessionId,
        roleId: request.roleId,
        toolCategory: request.toolCategory,
        toolId: request.toolId,
        error: result.error,
        requestId,
      });
      return result;
    }

    // 2. Validate permissions
    const permissionError = this.validatePermissions(request);
    if (permissionError) {
      const result: ToolInvocationResult = {
        success: false,
        error: permissionError,
        durationMs: Date.now() - startTime,
      };
      this.emitEvent("brainstorm.tool.failed", {
        sessionId: request.sessionId,
        roleId: request.roleId,
        toolCategory: request.toolCategory,
        toolId: request.toolId,
        error: permissionError,
        requestId,
      });
      return result;
    }

    // 3. Check per-member call count
    const memberKey = `${request.sessionId}:${request.roleId}`;
    const memberCount = this.memberToolCounts.get(memberKey) ?? 0;
    const scope = this.getPermissionScope(request.roleId);
    if (scope && memberCount >= scope.maxCallsPerMember) {
      const error = `Member tool call limit exceeded for role "${request.roleId}" (max: ${scope.maxCallsPerMember})`;
      const result: ToolInvocationResult = {
        success: false,
        error,
        durationMs: Date.now() - startTime,
      };
      this.emitEvent("brainstorm.tool.failed", {
        sessionId: request.sessionId,
        roleId: request.roleId,
        toolCategory: request.toolCategory,
        toolId: request.toolId,
        error,
        requestId,
      });
      return result;
    }

    // 4. Route to appropriate bridge (with Docker fallback)
    let bridgeResult: { success: boolean; output?: unknown; error?: string };

    if (request.toolCategory === "docker" && !this.dockerReachable) {
      // Docker unreachable fallback
      bridgeResult = this.simulateDockerResponse(request);
      this.emitEvent("brainstorm.degraded", {
        sessionId: request.sessionId,
        reason: "Docker bridge unreachable, using simulated response",
        affectedComponent: "tool-proxy",
        fallbackAction: "simulated-docker-response",
      });
    } else {
      const bridge = this.bridges[request.toolCategory];
      if (!bridge) {
        const result: ToolInvocationResult = {
          success: false,
          error: `No capability bridge registered for category "${request.toolCategory}"`,
          durationMs: Date.now() - startTime,
        };
        this.emitEvent("brainstorm.tool.failed", {
          sessionId: request.sessionId,
          roleId: request.roleId,
          toolCategory: request.toolCategory,
          toolId: request.toolId,
          error: result.error,
          requestId,
        });
        return result;
      }

      try {
        bridgeResult = await bridge(request.toolId, request.params);
      } catch (err) {
        bridgeResult = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // 5. Increment counters
    this.sessionToolCounts.set(request.sessionId, sessionCount + 1);
    this.memberToolCounts.set(memberKey, memberCount + 1);

    // 6. Record invocation
    const durationMs = Date.now() - startTime;
    const record: ToolInvocationRecord = {
      requestId,
      toolCategory: request.toolCategory,
      toolId: request.toolId,
      success: bridgeResult.success,
      durationMs,
    };
    this.invocationRecords.push(record);

    // 7. Emit event
    const result: ToolInvocationResult = {
      success: bridgeResult.success,
      output: bridgeResult.output,
      error: bridgeResult.error,
      durationMs,
    };

    if (bridgeResult.success) {
      this.emitEvent("brainstorm.tool.completed", {
        sessionId: request.sessionId,
        roleId: request.roleId,
        toolCategory: request.toolCategory,
        toolId: request.toolId,
        durationMs,
        requestId,
      });
    } else {
      this.emitEvent("brainstorm.tool.failed", {
        sessionId: request.sessionId,
        roleId: request.roleId,
        toolCategory: request.toolCategory,
        toolId: request.toolId,
        error: bridgeResult.error,
        durationMs,
        requestId,
      });
    }

    return result;
  }

  // ─── Permission Validation ────────────────────────────────────────────────

  /**
   * Validate a tool invocation request against the role's permission scope.
   * Returns an error message if permission is denied, or null if allowed.
   */
  validatePermissions(request: ToolInvocationRequest): string | null {
    const scope = this.getPermissionScope(request.roleId);
    if (!scope) {
      return `Unknown role: "${request.roleId}"`;
    }

    // Check category
    if (!scope.allowedCategories.includes(request.toolCategory)) {
      return `Permission denied: role "${request.roleId}" cannot use tool category "${request.toolCategory}". Allowed: [${scope.allowedCategories.join(", ")}]`;
    }

    // Check specific tool IDs if configured
    if (
      scope.allowedToolIds &&
      scope.allowedToolIds.length > 0 &&
      !scope.allowedToolIds.includes(request.toolId)
    ) {
      return `Permission denied: tool "${request.toolId}" not in allowedToolIds for role "${request.roleId}"`;
    }

    return null;
  }

  // ─── Query Methods ────────────────────────────────────────────────────────

  /**
   * Get the permission scope for a given role.
   */
  getPermissionScope(roleId: BrainstormRoleId): ToolPermissionScope | undefined {
    const role = getBrainstormRole(roleId);
    return role?.toolPermissions;
  }

  /**
   * Get the total tool call count for a session.
   */
  getSessionToolCount(sessionId: string): number {
    return this.sessionToolCounts.get(sessionId) ?? 0;
  }

  /**
   * Get the tool call count for a specific member in a session.
   */
  getMemberToolCount(sessionId: string, roleId: BrainstormRoleId): number {
    return this.memberToolCounts.get(`${sessionId}:${roleId}`) ?? 0;
  }

  /**
   * Check if a session is within its tool call limit.
   */
  isWithinLimit(sessionId: string): boolean {
    return this.getSessionToolCount(sessionId) < this.sessionToolCallLimit;
  }

  /**
   * Get all invocation records.
   */
  getInvocationRecords(): ToolInvocationRecord[] {
    return [...this.invocationRecords];
  }

  /**
   * Set Docker reachability state (for runtime detection).
   */
  setDockerReachable(reachable: boolean): void {
    this.dockerReachable = reachable;
  }

  /**
   * Check if Docker is currently reachable.
   */
  isDockerReachable(): boolean {
    return this.dockerReachable;
  }

  // ─── Docker Fallback ──────────────────────────────────────────────────────

  private simulateDockerResponse(
    request: ToolInvocationRequest,
  ): { success: boolean; output?: unknown; error?: string } {
    return {
      success: true,
      output: {
        simulated: true,
        message: `Simulated Docker response for tool "${request.toolId}"`,
        note: "Docker bridge is unreachable; result is synthetic.",
      },
    };
  }
}
