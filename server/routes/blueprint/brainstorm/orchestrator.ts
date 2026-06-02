/**
 * @description Brainstorm Orchestrator — central coordinator for multi-agent
 * brainstorm sessions managing session lifecycle, crew member instantiation,
 * mode execution (discussion/vote/division/audit), and synthesis triggering.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §2
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.6, 10.1, 10.5
 */

import crypto from "node:crypto";

import type {
  BrainstormDiagnostics,
  BrainstormRoleId,
  BrainstormSession,
  BrainstormSessionStatus,
  BranchEdge,
  BranchNode,
  CollaborationMode,
  CrewMemberInstance,
  CrewMemberOutput,
  CrewMemberState,
  SessionConfig,
} from "../../../../shared/blueprint/brainstorm-contracts";

import { getBrainstormRole } from "./role-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LLM caller function signature — injectable for testing. */
export type LLMCallerFn = (
  prompt: string,
  options: { signal?: AbortSignal },
) => Promise<string>;

/** Event emitter function signature — injectable for testing. */
export type EventEmitterFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default session timeout in milliseconds (120 seconds). */
export const BRAINSTORM_SESSION_TIMEOUT_MS = 120_000;

/** Default maximum token budget per session. */
export const BRAINSTORM_MAX_TOKENS = 50_000;

/** Default maximum tool calls per session. */
export const BRAINSTORM_MAX_TOOL_CALLS = 20;

/** Valid crew member states for invariant checking. */
export const VALID_CREW_MEMBER_STATES: CrewMemberState[] = [
  "idle",
  "thinking",
  "acting",
  "observing",
  "completed",
  "failed",
];

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class BrainstormOrchestrator {
  private sessions: Map<string, BrainstormSession> = new Map();
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private sequenceCounters: Map<string, number> = new Map();
  private totalSessionsCompleted = 0;
  private degradationCount = 0;
  private totalDurationMs = 0;

  constructor(
    private readonly llmCaller: LLMCallerFn,
    private readonly emitEvent: EventEmitterFn,
  ) {}

  // ─── Session Lifecycle ──────────────────────────────────────────────────

  /**
   * Start a new brainstorm session with the given configuration.
   * Instantiates crew members from the role registry and starts the mode execution.
   */
  async startSession(config: SessionConfig): Promise<BrainstormSession> {
    const sessionId = crypto.randomUUID();
    const crewMembers = new Map<BrainstormRoleId, CrewMemberInstance>();

    for (const roleId of config.roles) {
      const roleDef = getBrainstormRole(roleId);
      const maxIterations = roleDef?.maxIterations ?? 3;

      crewMembers.set(roleId, {
        roleId,
        state: "idle",
        iterationCount: 0,
        maxIterations,
        tokenUsage: 0,
        output: undefined,
        failureReason: undefined,
      });
    }

    const session: BrainstormSession = {
      id: sessionId,
      jobId: config.jobId,
      stageId: config.stageId,
      mode: config.mode,
      crewMembers,
      branchNodes: [],
      edges: [],
      status: "active",
      tokenBudget: config.tokenBudget ?? BRAINSTORM_MAX_TOKENS,
      tokenUsed: 0,
      toolCallCount: 0,
      toolCallLimit: config.toolCallLimit ?? BRAINSTORM_MAX_TOOL_CALLS,
      startedAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    this.sequenceCounters.set(sessionId, 0);

    // Start timeout watchdog
    this.startTimeoutWatchdog(sessionId);

    // Emit session started event
    this.emitEvent("brainstorm.session.started", {
      sessionId,
      jobId: config.jobId,
      stageId: config.stageId,
      mode: config.mode,
      roles: config.roles,
    });

    // Execute mode asynchronously (don't await for timeout to work)
    this.executeMode(session, config.stageContext).catch((err) => {
      this.handleSessionError(sessionId, err);
    });

    return session;
  }

  /**
   * Get a session by its ID.
   */
  getSession(id: string): BrainstormSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get all currently active sessions.
   */
  getActiveSessions(): BrainstormSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "active" || s.status === "synthesizing",
    );
  }

  /**
   * Get diagnostics for the brainstorm orchestrator.
   */
  getDiagnostics(): BrainstormDiagnostics {
    const activeSessions = this.getActiveSessions();
    return {
      enabled: true,
      activeSessionsCount: activeSessions.length,
      totalSessionsCompleted: this.totalSessionsCompleted,
      degradationCount: this.degradationCount,
      averageSessionDurationMs:
        this.totalSessionsCompleted > 0
          ? this.totalDurationMs / this.totalSessionsCompleted
          : 0,
      tokenBudget: BRAINSTORM_MAX_TOKENS,
      toolCallLimit: BRAINSTORM_MAX_TOOL_CALLS,
    };
  }

  // ─── Timeout Watchdog ───────────────────────────────────────────────────

  private startTimeoutWatchdog(sessionId: string): void {
    const timer = setTimeout(() => {
      this.forceTerminateSession(sessionId);
    }, BRAINSTORM_SESSION_TIMEOUT_MS);

    this.timeouts.set(sessionId, timer);
  }

  private clearTimeoutWatchdog(sessionId: string): void {
    const timer = this.timeouts.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timeouts.delete(sessionId);
    }
  }

  private forceTerminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return;

    session.status = "force_terminated";

    this.emitEvent("brainstorm.session.failed", {
      sessionId,
      reason: "Session timeout exceeded (120s force-termination)",
    });

    // Proceed to synthesis with partial results
    this.transitionToSynthesizing(session);
  }

  // ─── Mode Execution ─────────────────────────────────────────────────────

  private async executeMode(
    session: BrainstormSession,
    stageContext: string,
  ): Promise<void> {
    switch (session.mode) {
      case "discussion":
        await this.executeDiscussionMode(session, stageContext);
        break;
      case "vote":
        await this.executeVoteMode(session, stageContext);
        break;
      case "division":
        await this.executeDivisionMode(session, stageContext);
        break;
      case "audit":
        await this.executeAuditMode(session, stageContext);
        break;
    }

    // After mode execution, check if we should transition to synthesizing
    if (session.status === "active") {
      this.checkAllMembersTerminal(session);
    }
  }

  // ─── Discussion Mode ────────────────────────────────────────────────────

  /**
   * Discussion mode: sequential execution, passing each member's output
   * as context to the next member.
   */
  private async executeDiscussionMode(
    session: BrainstormSession,
    stageContext: string,
  ): Promise<void> {
    const members = Array.from(session.crewMembers.values());
    const previousOutputs: string[] = [];

    for (const member of members) {
      // Check if session was force-terminated during execution
      if (session.status !== "active") break;

      // Check token budget before iteration
      if (session.tokenUsed >= session.tokenBudget) break;

      const contextForMember =
        previousOutputs.length > 0
          ? `${stageContext}\n\nPrevious discussion context:\n${previousOutputs.join("\n---\n")}`
          : stageContext;

      await this.executeCrewMember(session, member, contextForMember);

      if (member.state === "completed" && member.output) {
        previousOutputs.push(
          `[${member.roleId}]: ${member.output.content}`,
        );
      }
    }
  }

  // ─── Vote Mode ──────────────────────────────────────────────────────────

  /**
   * Vote mode: all members receive identical prompt and execute in parallel.
   */
  private async executeVoteMode(
    session: BrainstormSession,
    stageContext: string,
  ): Promise<void> {
    const members = Array.from(session.crewMembers.values());

    const promises = members.map((member) =>
      this.executeCrewMember(session, member, stageContext).catch(() => {
        // Individual failures are handled inside executeCrewMember
      }),
    );

    await Promise.allSettled(promises);
  }

  // ─── Division Mode ──────────────────────────────────────────────────────

  /**
   * Division mode: split task into sub-tasks via LLM, then assign each to
   * a specific crew member and execute in parallel.
   */
  private async executeDivisionMode(
    session: BrainstormSession,
    stageContext: string,
  ): Promise<void> {
    const members = Array.from(session.crewMembers.values());
    const memberCount = members.length;

    // Split task into sub-tasks via LLM
    const subTasks = await this.splitTaskIntoSubTasks(
      stageContext,
      memberCount,
      session,
    );

    // Execute sub-tasks in parallel
    const promises = members.map((member, index) => {
      const subTask =
        subTasks[index] ?? `Complete your assigned portion of: ${stageContext}`;
      return this.executeCrewMember(session, member, subTask).catch(() => {
        // Individual failures handled inside executeCrewMember
      });
    });

    await Promise.allSettled(promises);
  }

  private async splitTaskIntoSubTasks(
    stageContext: string,
    memberCount: number,
    session: BrainstormSession,
  ): Promise<string[]> {
    const prompt =
      `Split the following task into exactly ${memberCount} independent sub-tasks.\n\n` +
      `Task: ${stageContext}\n\n` +
      `Respond with a JSON array of ${memberCount} strings, each being a sub-task description.\n` +
      `Example: ["sub-task 1", "sub-task 2", ...]`;

    try {
      const raw = await this.llmCaller(prompt, {});
      const parsed = this.parseSubTasks(raw, memberCount);
      if (parsed) {
        // Track token usage for the split call
        const estimatedTokens = Math.ceil((prompt.length + raw.length) / 4);
        session.tokenUsed += estimatedTokens;
        return parsed;
      }
    } catch {
      // Fall through to default
    }

    // Fallback: give everyone the full context
    return Array.from({ length: memberCount }, (_, i) =>
      `Sub-task ${i + 1} of ${memberCount}: ${stageContext}`,
    );
  }

  private parseSubTasks(raw: string, expectedCount: number): string[] | null {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return null;
        }
      }

      if (!Array.isArray(parsed)) return null;

      const tasks = parsed
        .filter((item: unknown) => typeof item === "string")
        .slice(0, expectedCount);

      return tasks.length > 0 ? tasks : null;
    } catch {
      return null;
    }
  }

  // ─── Audit Mode ─────────────────────────────────────────────────────────

  /**
   * Audit mode: execute primary member first, then pass its output to
   * the auditor for review.
   */
  private async executeAuditMode(
    session: BrainstormSession,
    stageContext: string,
  ): Promise<void> {
    const members = Array.from(session.crewMembers.values());

    // Find auditor and primary members
    const auditorIndex = members.findIndex((m) => m.roleId === "auditor");
    const primaryMembers =
      auditorIndex >= 0
        ? members.filter((_, i) => i !== auditorIndex)
        : members.slice(0, -1);
    const auditorMember =
      auditorIndex >= 0 ? members[auditorIndex] : members[members.length - 1];

    // Execute primary member(s) first
    for (const primary of primaryMembers) {
      if (session.status !== "active") break;
      if (session.tokenUsed >= session.tokenBudget) break;
      await this.executeCrewMember(session, primary, stageContext);
    }

    // Pass primary outputs to auditor
    if (session.status === "active" && session.tokenUsed < session.tokenBudget) {
      const primaryOutputs = primaryMembers
        .filter((m) => m.state === "completed" && m.output)
        .map((m) => `[${m.roleId}]: ${m.output!.content}`)
        .join("\n---\n");

      const auditContext =
        `${stageContext}\n\nReview the following outputs:\n${primaryOutputs}`;

      await this.executeCrewMember(session, auditorMember, auditContext);
    }
  }

  // ─── Crew Member Execution Loop ────────────────────────────────────────

  /**
   * Execute a single crew member's Think→Act→Observe reasoning loop.
   * Tracks iterations, token usage, and handles failure.
   */
  async executeCrewMember(
    session: BrainstormSession,
    member: CrewMemberInstance,
    context: string,
  ): Promise<void> {
    const roleDef = getBrainstormRole(member.roleId);
    const systemPrompt = roleDef?.systemPrompt ?? "You are a helpful assistant.";

    // Transition to thinking
    this.transitionMemberState(session, member, "thinking");

    // Create a node for this member's contribution
    const nodeId = this.createBranchNode(session, member, "thinking", context);

    try {
      let iterationOutput = "";

      while (member.iterationCount < member.maxIterations) {
        // Check token budget
        if (session.tokenUsed >= session.tokenBudget) {
          this.failMember(
            session,
            member,
            nodeId,
            "Token budget exceeded",
          );
          return;
        }

        // Check if session is still active
        if (session.status !== "active") {
          return;
        }

        member.iterationCount++;

        const prompt =
          `${systemPrompt}\n\nContext:\n${context}` +
          (iterationOutput
            ? `\n\nYour previous reasoning:\n${iterationOutput}`
            : "") +
          `\n\nProvide your analysis and conclusion. ` +
          `Respond with a JSON object: { "content": "your analysis", "confidence": 0.0-1.0, "needsToolCall": false }`;

        try {
          const raw = await this.llmCaller(prompt, {});
          const estimatedTokens = Math.ceil((prompt.length + raw.length) / 4);

          // Track tokens
          member.tokenUsage += estimatedTokens;
          session.tokenUsed += estimatedTokens;

          // Try to parse structured output
          const parsed = this.parseMemberOutput(raw);

          if (parsed) {
            if (parsed.needsToolCall) {
              // Transition to acting → observing cycle
              this.transitionMemberState(session, member, "acting");
              this.transitionMemberState(session, member, "observing");
              iterationOutput += `\n${parsed.content}`;
              // Continue loop for next iteration
              this.transitionMemberState(session, member, "thinking");
            } else {
              // Reasoning complete
              member.output = {
                content: parsed.content,
                confidence: parsed.confidence,
                toolInvocations: [],
                tokenUsage: member.tokenUsage,
              };
              this.transitionMemberState(session, member, "completed");
              this.updateBranchNode(session, nodeId, "completed", parsed.content, parsed.confidence);
              return;
            }
          } else {
            // Couldn't parse structured output; treat raw as content
            member.output = {
              content: raw.slice(0, 2000),
              confidence: 0.5,
              toolInvocations: [],
              tokenUsage: member.tokenUsage,
            };
            this.transitionMemberState(session, member, "completed");
            this.updateBranchNode(session, nodeId, "completed", raw.slice(0, 2000), 0.5);
            return;
          }
        } catch (err) {
          this.failMember(
            session,
            member,
            nodeId,
            err instanceof Error ? err.message : String(err),
          );
          return;
        }
      }

      // Max iterations reached — use whatever we have
      if (!member.output) {
        member.output = {
          content: iterationOutput || "Max iterations reached without conclusion.",
          confidence: 0.3,
          toolInvocations: [],
          tokenUsage: member.tokenUsage,
        };
      }
      this.transitionMemberState(session, member, "completed");
      this.updateBranchNode(
        session,
        nodeId,
        "completed",
        member.output.content,
        member.output.confidence,
      );
    } catch (err) {
      this.failMember(
        session,
        member,
        nodeId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private parseMemberOutput(
    raw: string,
  ): { content: string; confidence: number; needsToolCall: boolean } | null {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return null;
        }
      }

      if (typeof parsed !== "object" || parsed === null) return null;
      const obj = parsed as Record<string, unknown>;

      if (typeof obj.content !== "string") return null;

      const confidence =
        typeof obj.confidence === "number"
          ? Math.max(0, Math.min(1, obj.confidence))
          : 0.5;

      const needsToolCall =
        typeof obj.needsToolCall === "boolean" ? obj.needsToolCall : false;

      return { content: obj.content, confidence, needsToolCall };
    } catch {
      return null;
    }
  }

  // ─── State Transitions ──────────────────────────────────────────────────

  private transitionMemberState(
    session: BrainstormSession,
    member: CrewMemberInstance,
    newState: CrewMemberState,
  ): void {
    member.state = newState;
  }

  private failMember(
    session: BrainstormSession,
    member: CrewMemberInstance,
    nodeId: string,
    reason: string,
  ): void {
    member.state = "failed";
    member.failureReason = reason;
    this.updateBranchNode(session, nodeId, "failed", undefined, undefined);
  }

  private checkAllMembersTerminal(session: BrainstormSession): void {
    const allTerminal = Array.from(session.crewMembers.values()).every(
      (m) => m.state === "completed" || m.state === "failed",
    );

    if (allTerminal) {
      this.transitionToSynthesizing(session);
    }
  }

  private transitionToSynthesizing(session: BrainstormSession): void {
    // Only transition from active or force_terminated
    if (session.status !== "active" && session.status !== "force_terminated") {
      return;
    }

    session.status = "synthesizing";
    session.completedAt = new Date();

    this.clearTimeoutWatchdog(session.id);

    // Update diagnostics
    this.totalSessionsCompleted++;
    this.totalDurationMs +=
      session.completedAt.getTime() - session.startedAt.getTime();

    this.emitEvent("brainstorm.session.completed", {
      sessionId: session.id,
      jobId: session.jobId,
      stageId: session.stageId,
      mode: session.mode,
      status: "synthesizing",
      tokenUsed: session.tokenUsed,
    });
  }

  private handleSessionError(sessionId: string, err: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.status === "active") {
      session.status = "failed";
      session.completedAt = new Date();
      this.clearTimeoutWatchdog(sessionId);

      this.degradationCount++;

      this.emitEvent("brainstorm.degraded", {
        sessionId,
        reason: `Session failed: ${err instanceof Error ? err.message : String(err)}`,
        affectedComponent: "orchestrator",
        fallbackAction: "single-agent",
      });
    }
  }

  // ─── Branch Node Management ─────────────────────────────────────────────

  private nextSequenceNumber(sessionId: string): number {
    const current = this.sequenceCounters.get(sessionId) ?? 0;
    const next = current + 1;
    this.sequenceCounters.set(sessionId, next);
    return next;
  }

  private createBranchNode(
    session: BrainstormSession,
    member: CrewMemberInstance,
    type: "thinking" | "action" | "observation",
    title: string,
  ): string {
    const nodeId = crypto.randomUUID();
    const now = new Date().toISOString();

    const parentNode =
      session.branchNodes.length > 0
        ? session.branchNodes[session.branchNodes.length - 1]
        : null;

    const node: BranchNode = {
      id: nodeId,
      sessionId: session.id,
      parentNodeId: parentNode?.id ?? null,
      roleId: member.roleId,
      type,
      status: "active",
      title: title.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      sequenceNumber: this.nextSequenceNumber(session.id),
    };

    session.branchNodes.push(node);

    if (parentNode) {
      const edge: BranchEdge = {
        sourceNodeId: parentNode.id,
        targetNodeId: nodeId,
      };
      session.edges.push(edge);
    }

    this.emitEvent("brainstorm.node.created", {
      sessionId: session.id,
      nodeId,
      parentNodeId: node.parentNodeId,
      roleId: member.roleId,
      nodeType: type,
      status: "active",
    });

    return nodeId;
  }

  private updateBranchNode(
    session: BrainstormSession,
    nodeId: string,
    status: "completed" | "failed",
    content?: string,
    confidence?: number,
  ): void {
    const node = session.branchNodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.status = status;
    node.updatedAt = new Date().toISOString();
    if (content !== undefined) node.content = content;
    if (confidence !== undefined) node.confidence = confidence;

    this.emitEvent("brainstorm.node.updated", {
      sessionId: session.id,
      nodeId,
      status,
      content: content?.slice(0, 200),
      confidence,
    });
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Cleanup all sessions and timers. Used for graceful shutdown.
   */
  dispose(): void {
    for (const timer of this.timeouts.values()) {
      clearTimeout(timer);
    }
    this.timeouts.clear();
    this.sessions.clear();
    this.sequenceCounters.clear();
  }
}
