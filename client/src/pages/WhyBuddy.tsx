/**
 * WhyBuddy — V5 Capability Pool Experience (新路由)
 *
 * 严格遵循 V5 闭环（修复版）：
 * - 所有入站必须走单门 INTAKE（load/derive/classify → ControlSignal → ORCH）
 * - 收敛后进入 AWAIT 歇脚点（runtimePhase: "awaiting"），状态常驻
 * - 聊天框是操纵杆；能力池动态选；(capability, role) 对
 * - 画面临时，状态常驻（内存 prototype 模拟 per-session 常驻）
 * - 消灭"两道门"：打字和节点挑战统一经 intakeMessage
 *
 * 页面绝不直连 orchestrateReasoningTurn；全部经 WhyBuddyRuntime.intakeMessage + markAwaiting。
 *
 * 后续可接真实后端 V5SessionState（带 sessionId） / orchestrate... / 持久化 STORE。
 *
 * 参考：@docs/WhyBuddyV5闭环总图_完整版_修复闭环.md
 */

import React, { useState, useMemo } from "react";
import { ReasoningFlowSurface } from "@/components/autopilot/ReasoningFlowSurface";
import { REASONING_GRAPH_FIXTURE } from "@/dev-harness/reasoning-graph-fixture";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import { STAGE_TO_V5_CAPABILITIES, ALL_V5_CAPABILITIES, CAPABILITY_OUTPUT_KIND } from "@shared/blueprint/contracts";
import type { BrainstormReasoningGraph, BrainstormReasoningNode } from "@shared/blueprint";
import * as WhyBuddyRuntime from "@/lib/whybuddy-runtime";
import type { UserIntervention } from "@shared/blueprint/v5-reasoning-state";

// 简单角色池示例（与 V5 文档对齐）
const ROLES = ["产品", "架构", "安全", "工程", "挑刺", "综合"] as const;

type WhyArtifact = {
  id: string;
  kind: string;
  capability: V5CapabilityId;
  role: string;
  content: string;
  trustLevel: "untrusted" | "gated_pass" | "audited";
};

type ChatTurn = {
  id: string;
  user: string;
  selected: Array<{ cap: V5CapabilityId; role: string }>;
  reason: string;
  artifacts: WhyArtifact[];
};

export default function WhyBuddy() {
  // V5 pilot phase: opt the demo into richer PilotRealCapabilityExecutor for risk.analyze + report.write.
  // Pilot is now strictly scoped to this page's lifecycle (mount activates, unmount restores prior/default).
  // This ensures "默认仍是 simulator，pilot 仅 demo opt-in" is literally true for any other consumer
  // of the runtime in the same frontend process. commitArtifact still owns Trust Gate + producedBy binding;
  // 9-section schema and all closed-loop invariants are untouched.
  React.useEffect(() => {
    const prev = WhyBuddyRuntime.getCapabilityExecutor?.();

    // Default remains PilotReal for demo/smoke stability (deterministic richer outputs).
    // Real server LLM (aligned with /autopilot getAIConfig + callLLMJson) is explicit opt-in.
    // Usage: /whybuddy?executor=server-llm   (or add your own dev toggle that calls useServerLlmCapabilityExecutor)
    const params = new URLSearchParams(window.location.search);
    const wantServer = params.get('executor') === 'server-llm';

    if (wantServer && WhyBuddyRuntime.useServerLlmCapabilityExecutor) {
      WhyBuddyRuntime.useServerLlmCapabilityExecutor?.();
    } else {
      WhyBuddyRuntime.usePilotRealExecutor?.();
    }

    return () => {
      if (prev && WhyBuddyRuntime.setCapabilityExecutor) {
        WhyBuddyRuntime.setCapabilityExecutor(prev);
      } else {
        WhyBuddyRuntime.useDefaultExecutor?.();
      }
    };
  }, []);

  // V5: ensure clean product identity, no old autopilot title leaking
  React.useEffect(() => {
    const prevTitle = document.title;
    document.title = "WhyBuddy · V5 Capability Pool";
    return () => { document.title = prevTitle; };
  }, []);
  const [goal, setGoal] = useState("做一个权限管理系统（支持 RBAC + 数据范围）");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pinnedArtifact, setPinnedArtifact] = useState<WhyArtifact | null>(null);
  const [nextGateShouldFail, setNextGateShouldFail] = useState(false); // for demo commit gate fail path

  // 动态 reasoning graph（复用 fixture 作为 base，每次能力运行可追加节点）
  const [dynamicGraph, setDynamicGraph] = useState<BrainstormReasoningGraph>(() => ({
    ...REASONING_GRAPH_FIXTURE,
    nodes: [...REASONING_GRAPH_FIXTURE.nodes],
    edges: [...REASONING_GRAPH_FIXTURE.edges],
  }));

  // V5: the page now uses the thin runtime as source of truth for the closed loop.
  // We keep UI-friendly local state (chatTurns for history, dynamicGraph for the surface)
  // but all decisions, state mutations, gate logic, and invalidation go through the runtime.
  //
  // Initial bootstrap uses the pure create (sync) so the first paint is instant.
  // Subsequent loads/saves go through the (now async) store so that HttpWhyBuddySessionStore
  // can be swapped in later without changing call sites in the async handlers.

  const [sessionState, setSessionState] = useState(() =>
    WhyBuddyRuntime.deriveNodeStatus
      ? WhyBuddyRuntime.deriveNodeStatus(
          WhyBuddyRuntime.createInitialSessionState("做一个权限管理系统（支持 RBAC + 数据范围）", "whybuddy-main-proto")
        )
      : WhyBuddyRuntime.createInitialSessionState("做一个权限管理系统（支持 RBAC + 数据范围）", "whybuddy-main-proto")
  );

  // 当前可用能力池（V5 全量）
  const availableCapabilities = useMemo(() => ALL_V5_CAPABILITIES, []);

  // Knife 8: decision challenge handler (single door, re-uses existing intake/orch/markAwait flow)
  const challengeDecision = async (decId: string) => {
    const text = window.prompt('质疑这条调度决策的原因？', '质疑这条调度决策，请重新考虑') || '质疑这条调度决策，请重新考虑';
    const turnId = `turn-ch-${Date.now()}`;

    const loadedState = await WhyBuddyRuntime.loadOrCreateSessionState(
      sessionState.sessionId || "whybuddy-main-proto",
      goal
    );
    const intv: any = { intent: 'challenge', targetDecisionId: decId, text };
    const { preparedState, context } = WhyBuddyRuntime.intakeMessage(loadedState, {
      turnId,
      userText: text,
      intervention: intv,
    });

    const { newState: afterOrch } = WhyBuddyRuntime.orchestrateReasoningTurn(preparedState, context);

    // Minimal re-entry surface: update state (DLEDGER will have "reconsider" rationale from runtime),
    // mark AWAIT, add a note turn so user sees the challenge took effect.
    let final = await WhyBuddyRuntime.saveSessionState(
      WhyBuddyRuntime.markAwaiting(afterOrch, turnId)
    );
    final = WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(final) : final;

    setSessionState(final);
    setDynamicGraph(final.graph || dynamicGraph);

    setChatTurns((prev) => [...prev, {
      id: turnId,
      user: `[decision challenge on ${decId}] ${text}`,
      selected: [],
      reason: 're-entry from DLEDGER decision challenge (runtime reconsider)',
      artifacts: [],
    }]);
  };

  // Knife 10: waive a coverage gap (v1 minimal: prompt for reason, call helper, derive+save+set)
  const waiveGap = async (gapId: string) => {
    const reason = window.prompt('Waive reason?', 'user waived (demo)') || 'user waived (demo)';
    let working = WhyBuddyRuntime.waiveCoverageGap(sessionState, gapId, reason);
    working = WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(working) : working;
    working = await WhyBuddyRuntime.saveSessionState(working);
    setSessionState(working);
    // Note: gaps live on sessionState; the Control Surface will re-render on next state update.
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userText = input.trim();
    const turnId = `turn-${Date.now()}`;

    // 必须先按 sessionId load，再走单门 INTAKE（按 修复闭环.md）：load/derive + classify (new_goal 仅空) + 准备
    const loadedState = await WhyBuddyRuntime.loadOrCreateSessionState(
      sessionState.sessionId || "whybuddy-main-proto",
      goal
    );
    const { preparedState, context, controlSignal } = WhyBuddyRuntime.intakeMessage(loadedState, {
      turnId,
      userText,
    });
    // 控制信号分类结果（new_goal / refine 等）目前主要用于可观测；orchestrate 仍用 context 里的 intervention 决定路径
    // console.debug('[INTAKE]', controlSignal);

    const { newState: afterOrch, plan } = WhyBuddyRuntime.orchestrateReasoningTurn(preparedState, context);

    // Build raw artifacts. Report content is generated later at commit time using freshInputs + actual upstream artifacts.
    const rawArtifacts: WhyArtifact[] = plan.selected.map((sel: any, idx: number) => {
      const cap = sel.capabilityId as V5CapabilityId;
      const outputKind = CAPABILITY_OUTPUT_KIND[cap] ?? "decision";
      // Default content for non-report; make more semantic for key V5 capabilities so that
      // when persisted and later aggregated into report/synthesis, the fragments are actually useful.
      let content: string;
      if (cap === "risk.analyze") {
        content = `${sel.roleId} 通过 risk.analyze 贡献了：\n风险：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）。\n风险：审计风险（权限变更需保留操作者、时间、影响对象）。`;
      } else if (cap === "counter.argue") {
        content = `${sel.roleId} 通过 counter.argue 贡献了：\n反驳：过早引入 ABAC 会增加策略调试成本。\n建议：MVP 先采用 RBAC + scoped data filter，保留策略接口。`;
      } else {
        content = `${sel.roleId || "agent"} 通过 ${cap} 贡献了新洞察/证据/方案`;
      }
      return {
        id: `${turnId}-art-${idx}`,
        kind: outputKind,
        capability: cap,
        role: sel.roleId || "agent",
        content,
        trustLevel: "untrusted",
      };
    });

    // Commit one-by-one, re-resolving inputs from the *latest* workingState before each commit.
    // This makes same-turn dependency (risk → synthesis → report) real.
    let workingState = afterOrch;
    const committedArtifacts: WhyArtifact[] = [];

    // Sequential loop (was forEach) because we must re-resolve freshInputs from the *latest*
    // workingState after each prior commit in the same turn, and we now await the swappable
    // CapabilityExecutor (default still wraps simulateCapabilityExecution).
    for (let idx = 0; idx < rawArtifacts.length; idx++) {
      const raw = rawArtifacts[idx];
      const runId = `${turnId}-run-${idx}`;
      // Only force upstreams (risk/counter) when flag set, so report can demonstrate "fails because of bad upstream"
      const isUpstream = raw.capability.includes("risk") || raw.capability.includes("argue");
      const forceFail = nextGateShouldFail && isUpstream;

      // Re-resolve inputs right before commit using current state (after previous artifacts in this round)
      const freshInputs = WhyBuddyRuntime.findInputsForCapability(workingState, raw.capability);

      // Route through the official CapabilityExecutor (injected default keeps exact prior simulator behavior).
      // Interface is async to allow real MCP/LLM/agent later; page awaits at the per-artifact commit sites.
      const exec = await WhyBuddyRuntime.executeCapability({
        capabilityId: raw.capability,
        state: workingState,
        inputArtifactIds: freshInputs,
        roleId: raw.role,
        turnId,
      });
      // IMPORTANT: no more post-processing override for report.write / synthesis.merge.
      // The CapabilityExecutor (Default now calls buildStructuredReport for report.write)
      // is the single source for the main output content. Page trusts exec.content and passes it
      // through to commitArtifact. This keeps the swappable executor contract honest and makes
      // the 9-section evidence report the real V5 deliverable.
      let content = exec ? exec.content : raw.content;

      const { updatedState, committed } = WhyBuddyRuntime.commitArtifact(
        workingState,
        {
          id: raw.id,
          kind: raw.kind as any,
          provenance: "ai_generated",
          producedBy: {
            capabilityRunId: runId,
            capabilityId: raw.capability,
            roleId: raw.role,
          },
          // Pass the (possibly freshly aggregated) content so that runtime state.artifacts
          // actually stores the enhanced report/synthesis text for future upstream reads.
          title: content ? content.split('\n')[0]?.slice(0, 80) : undefined,
          summary: content ? content.slice(0, 200) : undefined,
          content,
        } as any,
        runId,
        forceFail,
        freshInputs
      );
      workingState = updatedState;
      committedArtifacts.push({
        ...raw,
        content,  // use the (possibly freshly built) content
        trustLevel: committed ? (committed.trustLevel as any) : "untrusted",
      });
    }

    const turn: ChatTurn = {
      id: turnId,
      user: userText,
      selected: plan.selected.map((s: any) => ({ cap: s.capabilityId, role: s.roleId || "agent" })),
      reason: plan.reason,
      artifacts: committedArtifacts,
    };

    // 先把本轮真正产出的 artifact 精确回写到对应 graph node（run 级绑定闭环）
    workingState = WhyBuddyRuntime.enrichGraphNodesAfterCommit(workingState, turnId);
    // 显式 derive 确保单一真相（load-first 精神）
    workingState = WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(workingState) : workingState;

    // Update graph from runtime (nodes created with stable turnId + 现在带 producedArtifactId)
    setDynamicGraph(workingState.graph);

    // 收敛后让位 → AWAIT 歇脚点（外圈闭合可被 runtime 证明：ORCH → AWAIT → 下一条 INTAKE）
    workingState = await WhyBuddyRuntime.saveSessionState(
      WhyBuddyRuntime.markAwaiting(workingState, turnId)
    );

    setSessionState(workingState);
    setChatTurns((prev) => [...prev, turn]);
    setInput("");
    setNextGateShouldFail(false);
  };

  /**
   * Shared re-entry execution helper.
   * Both card challenge and graph-node click go through this so they use the
   * exact same commitArtifact payload shape and contract.
   * This eliminates the duplication that caused the tsc error (wrong UI-local
   * fields like `capability`/`role`/`trustLevel` being passed instead of the
   * proper `producedBy` + `provenance` shape expected by the runtime).
   */
  async function runReentryTurn(intervention: UserIntervention, turnId: string, forceFail = false) {
    const { preparedState, context } = WhyBuddyRuntime.intakeMessage(
      await WhyBuddyRuntime.loadOrCreateSessionState(
        sessionState.sessionId || "whybuddy-main-proto",
        goal
      ),
      {
        turnId,
        userText: intervention.text,
        intervention,
      }
    );

    const { newState: afterOrch, plan: rePlan } = WhyBuddyRuntime.orchestrateReasoningTurn(
      preparedState,
      context
    ) as any;

    const rawNew: WhyArtifact[] = (rePlan.selected || []).map((sel: any, idx: number) => {
      const cap = sel.capabilityId as V5CapabilityId;
      const outputKind = CAPABILITY_OUTPUT_KIND[cap] ?? "risk";
      let reContent: string;
      if (cap === "risk.analyze") {
        reContent = `【重入】${sel.roleId || "agent"} 通过 risk.analyze 贡献了：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）；审计风险（权限变更需保留操作者、时间、影响对象）。`;
      } else if (cap === "counter.argue") {
        reContent = `【重入】${sel.roleId || "agent"} 通过 counter.argue 贡献了：反驳过早引入 ABAC（会增加策略调试成本）；建议 MVP 先采用 RBAC + scoped data filter，保留策略接口。`;
      } else {
        reContent = `【重入】${sel.roleId || "agent"} 针对干预通过 ${cap} 提供了反证/补充`;
      }
      return {
        id: `${turnId}-art-${idx}`,
        kind: outputKind,
        capability: cap,
        role: sel.roleId || "挑刺",
        content: reContent,
        trustLevel: "untrusted",
      };
    });

    let working = afterOrch;
    const committedNew: WhyArtifact[] = [];

    // Sequential (was forEach) to preserve same-turn freshInputs re-resolution contract + await the
    // CapabilityExecutor (default still simulates; real impls will be async without changing loop shape).
    for (let idx = 0; idx < rawNew.length; idx++) {
      const raw = rawNew[idx];
      const runId = `${turnId}-run-${idx}`;
      const freshInputs = WhyBuddyRuntime.findInputsForCapability(working, raw.capability);

      const exec = await WhyBuddyRuntime.executeCapability({
        capabilityId: raw.capability,
        state: working,
        inputArtifactIds: freshInputs,
        roleId: raw.role,
        turnId,
      });
      // No post-override for report/synthesis in re-entry either. Executor (with buildStructuredReport
      // for report.write) is authoritative. Re-entry reports will carry the same 9-section schema
      // (the builder sees the current state + freshInputs at reentry time, including any new stale marks).
      let content = exec ? exec.content : raw.content;

      // Correct payload shape expected by runtime commitArtifact
      // (matches the shape already used in the sendMessage path)
      const payload = {
        id: raw.id,
        kind: raw.kind as any,
        provenance: "ai_generated",
        producedBy: { capabilityRunId: runId, capabilityId: raw.capability, roleId: raw.role },
        title: content ? content.split('\n')[0]?.slice(0, 80) : undefined,
        summary: content ? content.slice(0, 200) : undefined,
        content,
      };

      const { updatedState, committed } = WhyBuddyRuntime.commitArtifact(
        working,
        payload as any,
        runId,
        forceFail,
        freshInputs
      );

      working = updatedState;
      if (committed) {
        committedNew.push({ ...raw, content, trustLevel: committed.trustLevel as any });
      } else {
        committedNew.push({ ...raw, content, trustLevel: "untrusted" });
      }
    }

    const reentryTurn: ChatTurn = {
      id: turnId,
      user: intervention.text,
      selected: rePlan.selected.map((s: any) => ({ cap: s.capabilityId, role: s.roleId || "agent" })),
      reason: "用户干预（卡片或节点）→ 失效/补充 → Orchestrator 重新挑选能力",
      artifacts: committedNew,
    };

    working = WhyBuddyRuntime.enrichGraphNodesAfterCommit(working, turnId);
    working = WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(working) : working;

    setDynamicGraph(working.graph);

    working = await WhyBuddyRuntime.saveSessionState(
      WhyBuddyRuntime.markAwaiting(working, turnId)
    );

    setSessionState(working);
    setChatTurns((prev) => [...prev, reentryTurn]);
  }

  const challenge = (turn: ChatTurn, artifact: WhyArtifact) => {
    const intervention: UserIntervention = {
      targetArtifactId: artifact.id,
      intent: "challenge",
      text: `针对 ${artifact.capability}（${artifact.role}）的结论我不满意，请重新分析或补充证据。`,
    };
    const turnId = `challenge-${Date.now()}`;
    runReentryTurn(intervention, turnId, nextGateShouldFail);
  };

  const handleGraphNodeClick = (node: BrainstormReasoningNode) => {
    // Node-specific resolution: prefer the enriched producedArtifactId for exact
    // run/artifact binding (the whole point of the previous binding work).
    // Fall back to targetNodeId so the runtime's invalidate logic can still match.
    const producedArtifactId = (node as any).producedArtifactId as string | undefined;

    const intervention: UserIntervention = {
      ...(producedArtifactId
        ? { targetArtifactId: producedArtifactId }
        : { targetNodeId: node.id }),
      intent: "challenge",
      text: `针对图中节点「${node.title || (node as any).capabilityId || node.id}」的结论我不满意，请重新分析或补充证据。`,
    };

    const turnId = `node-challenge-${Date.now()}`;
    runReentryTurn(intervention, turnId, nextGateShouldFail);
  };

  const currentGraphForSurface = useMemo(() => dynamicGraph, [dynamicGraph]);

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      {/* V5 顶部状态条（唯一常驻） */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-2 text-sm shadow-sm">
        <div className="flex items-center gap-4">
          <div className="font-semibold text-xl tracking-tight">WhyBuddy</div>
          <div className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">V5 Capability Pool</div>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div><span className="text-slate-500">目标：</span><span className="font-medium">{goal}</span></div>
          <div><span className="text-slate-500">轮次：</span><span className="font-mono font-semibold">{chatTurns.length}</span></div>
          <div className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">phase: <span className="font-mono">{(sessionState as any).runtimePhase || 'idle'}</span></div>
          <div className="text-[10px] font-mono text-slate-500">session: {(sessionState as any).sessionId}</div>
          <button
            onClick={async () => {
              let sessions: any[] = [];
              const lister = (WhyBuddyRuntime as any).listWhyBuddySessions;
              if (lister) {
                const res = lister();
                sessions = res && typeof res.then === 'function' ? await res : (res || []);
              }
              console.log('[V5 Sessions]', sessions);
              alert(`Active V5 sessions: ${sessions.length}\n` + sessions.map((s: any) => `${s.sessionId} (${s.artifactCount} arts, ${s.phase || 'idle'})`).join('\n'));
            }}
            className="text-[9px] px-1 border rounded hover:bg-slate-100"
            title="List current V5 sessions from the runtime store (demo)"
          >
            sessions
          </button>
          <button
            onClick={() => {
              const ledger = WhyBuddyRuntime.getSessionLedger ? WhyBuddyRuntime.getSessionLedger(sessionState) : [];
              console.log('[V5 Ledger]', ledger);
              alert(`Ledger entries: ${ledger.length}\n` + ledger.slice(-5).map((l: any) => `${l.capabilityId} @ ${l.trustLevel} (${l.gateSummary})`).join('\n'));
            }}
            className="text-[9px] px-1 border rounded hover:bg-slate-100"
            title="Show simulated T_LEDGER audit trail for this session"
          >
            ledger
          </button>
          <div><span className="text-slate-500">已调用能力：</span><span className="font-medium">{[...new Set(chatTurns.flatMap(t => t.selected.map(s => s.cap)))].length}</span></div>
          {/* Knife 8: V5.1 coverage / cost / decisions summary (surface runtime ledgers) */}
          {(() => {
            const gate: any = (sessionState as any).coverageGate;
            const covGaps: any[] = (sessionState as any).coverageGaps || [];
            const open = covGaps.filter(g => g.status === 'open').length;
            const wvd = covGaps.filter(g => g.status === 'waived').length;
            const covTxt = gate ? `${gate.passed ? 'passed' : 'blocked'} / open ${open} / waived ${wvd}` : 'n/a';
            const csts: any[] = (sessionState as any).costLedger || [];
            const tok = csts.reduce((s: number, c: any) => s + (c.estimatedTokens || 0), 0);
            const decs: any[] = WhyBuddyRuntime.getDecisionLedger ? WhyBuddyRuntime.getDecisionLedger(sessionState) : [];
            return (
              <>
                <div>coverage: <span className="font-mono">{covTxt}</span></div>
                <div>cost: <span className="font-mono">{tok} tok / {csts.length} runs</span></div>
                <div>decisions: <span className="font-mono">{decs.length}</span></div>
              </>
            );
          })()}
          <button
            onClick={async () => {
              setChatTurns([]);
              setDynamicGraph({ ...REASONING_GRAPH_FIXTURE, nodes: [...REASONING_GRAPH_FIXTURE.nodes], edges: [...REASONING_GRAPH_FIXTURE.edges] });
              const resetSession = await WhyBuddyRuntime.saveSessionState(
                WhyBuddyRuntime.createInitialSessionState(goal, `whybuddy-reset-${Date.now()}`)
              );
              setSessionState(resetSession);
              setPinnedArtifact(null);
              setNextGateShouldFail(false);
            }}
            className="rounded border px-2 py-1 hover:bg-slate-100"
          >
            重置会话
          </button>
          <button
            onClick={() => {
              const result = WhyBuddyRuntime.verifyV5ClosedLoop(sessionState);
              const phase = (sessionState as any).runtimePhase || 'unknown';
              alert(`V5 Closed Loop Verify: ${result.passed ? 'PASSED ✅' : 'FAILED ❌'}\n${result.details}\n\nruntimePhase: ${phase} (AWAIT 闭环观测)\n(检查：报告是否引用了真实上游 + 相关 capabilityRun 是否存在)`);
              console.log('[V5 Verify]', result, 'phase=', phase);
            }}
            className="rounded border px-2 py-1 text-emerald-600 hover:bg-emerald-50"
            title="运行轻量 behavioral test，钉住 risk→counter→synthesis→report 闭环链（推荐在 combo 轮后点击）"
          >
            Verify Chain
          </button>
          <button
            onClick={() => {
              const refreshed = WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(sessionState) : sessionState;
              setSessionState(refreshed);
              setDynamicGraph(refreshed.graph);
              console.log('[V5] Derived view refreshed from current artifacts/stale');
            }}
            className="rounded border px-2 py-1 text-amber-600 hover:bg-amber-50 text-[9px]"
            title="Re-derive graph node statuses from artifacts + stale (single source of truth demo)"
          >
            Refresh Derived
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 聊天操纵杆 + 历史（主要交互） */}
        <div className="flex w-full flex-col border-r bg-white md:w-5/12">
          <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
            {chatTurns.length === 0 && (
              <div className="text-center text-slate-400 mt-10">
                欢迎来到 WhyBuddy V5。<br />
                在下方输入你的目标或质疑，系统会从丰富的能力池中动态挑选 (capability × role) 进行推演。<br />
                没有固定阶段，一切由当前状态和你的输入驱动。
              </div>
            )}

            {chatTurns.map((turn, idx) => (
              <div key={turn.id} className="rounded-lg border p-3 shadow-sm">
                <div className="mb-1 text-xs text-slate-500">第 {idx + 1} 轮 · 用户输入</div>
                <div className="font-medium">{turn.user}</div>

                <div className="mt-2 text-[11px] text-slate-500">Orchestrator 挑选：</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {turn.selected.map((s, i) => (
                    <span key={i} className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                      {s.cap} × {s.role}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-xs italic text-slate-600">{turn.reason}</div>

                {/* 本轮产生的 artifact（临时黑板） */}
                <div className="mt-3 space-y-2">
                  {turn.artifacts.map((art) => (
                    <div key={art.id} className="rounded border bg-slate-50 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{art.capability} <span className="text-slate-400">by {art.role}</span></span>
                        {sessionState.staleArtifactIds.includes(art.id) ? (
                          <span className="text-[10px] text-orange-600 font-bold">stale</span>
                        ) : (
                          <span className={`text-[10px] ${art.trustLevel === "untrusted" ? "text-rose-600 font-bold" : "text-emerald-600"}`}>
                            {art.trustLevel}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[9px] text-slate-500 font-mono">run: {(art as any).producedBy?.capabilityRunId || 'n/a'} | id: {art.id}</div>
                      <div className="mt-1 text-slate-700">{art.content}</div>
                      {sessionState.staleArtifactIds.includes(art.id) && (
                        <div className="mt-1 text-[10px] text-orange-500">已失效（依赖的上游被挑战，依赖链级联）</div>
                      )}
                      {art.trustLevel === "untrusted" && !sessionState.staleArtifactIds.includes(art.id) && (
                        <div className="mt-1 text-[10px] text-rose-500">Commit Gate 失败 / 已拒绝（未进入可信状态）</div>
                      )}
                      <button
                        onClick={() => challenge(turn, art)}
                        className="mt-1 text-[10px] text-rose-600 hover:underline"
                      >
                        挑战此结论（触发重入 + 级联 stale）
                      </button>
                      <button
                        onClick={() => setPinnedArtifact(art)}
                        className="ml-2 text-[10px] text-blue-600 hover:underline"
                      >
                        Pin 到主画布
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Knife 8: V5.1 Control Surface — surface DLEDGER / GCOV gaps / Cost for visibility + actionable challenge */}
          <div className="border-t bg-slate-50 p-2 text-[11px]">
            <div className="font-semibold text-slate-600 mb-1">V5.1 Control Surface (runtime ledgers)</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(() => {
                const decs: any[] = WhyBuddyRuntime.getDecisionLedger ? WhyBuddyRuntime.getDecisionLedger(sessionState) : [];
                const recent = [...decs].slice(-3).reverse();
                return (
                  <>
                    <div>decisions: <span className="font-mono">{decs.length}</span></div>
                  </>
                );
              })()}
            </div>

            {/* Knife 10: interactive gaps list with waive action for open gaps (v1 prompt) */}
            <div className="mt-1">
              <div className="text-slate-500 mb-0.5">Coverage Gaps (open gaps are actionable):</div>
              {(() => {
                const covGaps: any[] = (sessionState as any).coverageGaps || [];
                if (!covGaps.length) return <div className="text-slate-400">no gaps</div>;
                return covGaps.map((g: any, i: number) => (
                  <div key={i} className="text-[10px] leading-tight mb-0.5">
                    {g.label} [{g.status}]
                    {g.status === 'open' && (
                      <button
                        onClick={() => waiveGap(g.id)}
                        className="ml-2 rounded border px-1 text-amber-600 hover:bg-amber-50"
                        title="waive this gap (v1: prompt for reason; runtime helper + derive + save)"
                      >
                        waive
                      </button>
                    )}
                    {g.status === 'waived' && g.waivedReason && (
                      <span className="ml-1 text-slate-400">(waived: {g.waivedReason})</span>
                    )}
                    {g.status === 'resolved' && g.resolvedByArtifactId && (
                      <span className="ml-1 text-emerald-600">(resolved)</span>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Recent decisions with challenge buttons (last 3) */}
            <div className="mt-1">
              <div className="text-slate-500 mb-0.5">Recent DLEDGER decisions (click to challenge → single-door re-entry):</div>
              {(() => {
                const decs: any[] = WhyBuddyRuntime.getDecisionLedger ? WhyBuddyRuntime.getDecisionLedger(sessionState) : [];
                const recent = [...decs].slice(-3).reverse();
                if (!recent.length) return <div className="text-slate-400">no decisions yet</div>;
                return recent.map((d: any, i: number) => (
                  <div key={i} className="border-l-2 pl-1 mb-0.5 text-[10px] leading-tight">
                    {d.id} · chose: {(d.chose || []).join(', ')} · {d.status === 'challenged' ? <span className="text-amber-600">challenged</span> : ''}
                    <button
                      onClick={() => challengeDecision(d.id)}
                      className="ml-2 rounded border px-1 text-blue-600 hover:bg-blue-50"
                      title="构造 targetDecisionId challenge intervention，走单门 INTAKE + ORCH reconsider"
                    >
                      challenge
                    </button>
                    <div className="text-slate-400 truncate">{(d.rationale || '').slice(0, 80)}...</div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* 聊天输入（操纵杆） */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="输入目标、质疑或指令，例如：这个权限方案风险太高，让安全 Agent 再反驳；或者先出个工程 MVP 方案"
                className="flex-1 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <button
                onClick={sendMessage}
                className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
              >
                发送
              </button>
              <button
                onClick={() => setNextGateShouldFail(true)}
                className="rounded border border-rose-300 px-2 py-2 text-xs text-rose-600 hover:bg-rose-50"
                title="下次让上游 risk/counter 失败，report 会因引用 untrusted upstream 自动 gate fail"
              >
                下次让上游失败 (演示 report 因 bad upstream 自动失败)
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
              {["路线对比一下", "澄清权限边界", "分析安全风险", "拆解成 SPEC Tree", "生成可行性报告", "效果预览"].map((hint, i) => (
                <button
                  key={i}
                  onClick={() => setInput(hint)}
                  className="rounded-full border px-2 py-0.5 text-slate-500 hover:bg-slate-100"
                >
                  {hint}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              能力池示例（{availableCapabilities.length} 个）：{availableCapabilities.slice(0, 6).join(" · ")} ... <br />
              点击“下次让上游失败” 按钮，然后发送包含报告的消息，即可演示上游失败 → report 因引用 untrusted upstream 自动 gate fail 的路径（V5 护城河核心）。
            </div>
          </div>
        </div>

        {/* 动态主画布（V5 临时黑板区，可展示最新 reasoning graph + pinned artifact） */}
        <div className="flex flex-1 flex-col overflow-hidden border-t md:border-t-0">
          <div className="border-b bg-white px-4 py-2 text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>动态推演画布（复用 ReasoningFlowSurface · 随能力调用实时更新）</span>
            <span className="text-[10px] text-slate-400">点击节点可针对该结论发起挑战（与卡片等效精确重入）</span>
            {pinnedArtifact && (
              <button onClick={() => setPinnedArtifact(null)} className="text-rose-600">取消 Pin</button>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {/* 主 reasoning graph */}
            <div className="mb-4 rounded border bg-white p-2 shadow-sm" style={{ height: 420 }}>
              <div className="mb-1 text-xs font-medium text-slate-600">当前 Reasoning Graph（capability invocation）</div>
              <ReasoningFlowSurface
                graph={currentGraphForSurface}
                initialScale={0.75}
                className="h-full w-full"
                showChrome={false}
                onNodeClick={handleGraphNodeClick}
              />
            </div>

            {/* Pinned 或最新 artifact 详情 */}
            <div className="rounded border bg-white p-3 text-sm shadow-sm">
              <div className="font-medium mb-2">当前焦点 Artifact</div>
              {pinnedArtifact ? (
                <div>
                  <div className="text-xs text-emerald-600">{pinnedArtifact.capability} × {pinnedArtifact.role}</div>
                  <div className="text-[9px] text-slate-500 font-mono">run: {(pinnedArtifact as any).producedBy?.capabilityRunId || 'n/a'} | id: {pinnedArtifact.id}</div>
                  <div>{pinnedArtifact.content}</div>
                </div>
              ) : chatTurns.length > 0 ? (
                <div className="text-slate-500 text-xs">点击聊天中的 “Pin 到主画布” 查看详情。所有 artifact 都来自真实能力运行（模拟），并带有 trustLevel。</div>
              ) : (
                <div className="text-slate-400">发送第一条消息后，这里会显示最新产生的结构化输出。</div>
              )}
            </div>
          </div>

          <div className="border-t bg-white p-2 text-[10px] text-slate-400">
            V5 原则演示：没有“下一步”按钮。所有推进都来自聊天输入驱动的动态能力选择。黑板可随对话更新（画面临时），背后的 graph/state 常驻。
          </div>
        </div>
      </div>
    </div>
  );
}
