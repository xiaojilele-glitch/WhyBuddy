import { useState, useEffect, useCallback } from "react";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import { CAPABILITY_OUTPUT_KIND } from "@shared/blueprint/contracts";
import {
  buildActionTrace,
  buildProcessLabelContext,
  getLiveAction,
  inferProcessContextFromExec,
  isExternalProvenance,
  type ActionTrace,
  type LiveAction,
} from "@shared/blueprint/capability-process-labels";
import * as WhyBuddyRuntime from "@/lib/whybuddy-runtime";
import { fetchNarration } from "@/lib/whybuddy-narrator";
import { fetchOrchestratePlan } from "@/lib/whybuddy-orchestrator";
import type { Artifact, UserIntervention, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { UiTurn, WhyArtifact, WhyBuddyExecutorMode } from "./types";

const DEFAULT_GOAL = "做一个权限管理系统（支持 RBAC + 数据范围）";
const DEFAULT_SESSION_ID = "whybuddy-main-proto";
const MAIN_KIND_PRIORITY = ["report", "synthesis", "risk"] as const;

function initialSessionState(goal: string, sessionId: string): V5SessionState {
  const base = WhyBuddyRuntime.createInitialSessionState(goal, sessionId);
  return WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(base) : base;
}

async function persistSession(state: V5SessionState): Promise<V5SessionState> {
  const derived = WhyBuddyRuntime.deriveNodeStatus
    ? WhyBuddyRuntime.deriveNodeStatus(state)
    : state;
  return WhyBuddyRuntime.saveSessionState(derived);
}

function resolveExecutorMode(): WhyBuddyExecutorMode {
  const params = new URLSearchParams(window.location.search);
  if (params.get("executor") === "server-llm") return "server-llm";
  if (params.get("executor") === "default") return "default";
  return "pilot";
}

function pickMainArtifact(committed: WhyArtifact[]): UiTurn["main"] {
  for (const kind of MAIN_KIND_PRIORITY) {
    const art = committed.find((a) => a.kind === kind);
    if (art) {
      return { artifactId: art.id, kind: art.kind, realLlm: Boolean(art.realLlm) };
    }
  }
  return null;
}

export type UseWhyBuddySessionOptions = {
  sessionId?: string;
  initialGoal?: string;
  documentTitle?: string;
};

export function useWhyBuddySession(options: UseWhyBuddySessionOptions = {}) {
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const [goal] = useState(options.initialGoal ?? DEFAULT_GOAL);
  const [uiTurns, setUiTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [liveAction, setLiveAction] = useState<LiveAction | null>(null);
  const [nextGateShouldFail, setNextGateShouldFail] = useState(false);
  const [executorMode, setExecutorMode] = useState<WhyBuddyExecutorMode>("pilot");
  const [sessionState, setSessionState] = useState(() =>
    initialSessionState(options.initialGoal ?? DEFAULT_GOAL, sessionId)
  );

  useEffect(() => {
    const prev = WhyBuddyRuntime.getCapabilityExecutor?.();
    const mode = resolveExecutorMode();
    setExecutorMode(mode);

    if (mode === "server-llm" && WhyBuddyRuntime.useServerLlmCapabilityExecutor) {
      WhyBuddyRuntime.useServerLlmCapabilityExecutor?.();
    } else if (mode === "default") {
      WhyBuddyRuntime.useDefaultExecutor?.();
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

  useEffect(() => {
    if (!options.documentTitle) return;
    const prevTitle = document.title;
    document.title = options.documentTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [options.documentTitle]);

  const applyPersistedState = useCallback((state: V5SessionState) => {
    setSessionState(state);
  }, []);

  const commitSelectedArtifacts = async (
    workingState: V5SessionState,
    turnId: string,
    planSelected: Array<{ capabilityId: V5CapabilityId; roleId?: string }>,
    processCtx: { userText: string; goalText: string },
    contentPrefix = ""
  ): Promise<{ working: V5SessionState; committed: WhyArtifact[]; actions: ActionTrace[] }> => {
    const actionTraces: ActionTrace[] = [];
    const rawArtifacts: WhyArtifact[] = planSelected.map((sel, idx) => {
      const cap = sel.capabilityId;
      const outputKind = CAPABILITY_OUTPUT_KIND[cap] ?? "decision";
      let content: string;
      if (cap === "risk.analyze") {
        content = `${contentPrefix}${sel.roleId || "agent"} 通过 risk.analyze 贡献了：\n风险：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）。\n风险：审计风险（权限变更需保留操作者、时间、影响对象）。`;
      } else if (cap === "counter.argue") {
        content = `${contentPrefix}${sel.roleId || "agent"} 通过 counter.argue 贡献了：\n反驳：过早引入 ABAC 会增加策略调试成本。\n建议：MVP 先采用 RBAC + scoped data filter，保留策略接口。`;
      } else {
        content = `${contentPrefix}${sel.roleId || "agent"} 通过 ${cap} 贡献了新洞察/证据/方案`;
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

    let working = workingState;
    const committedArtifacts: WhyArtifact[] = [];

    for (let idx = 0; idx < rawArtifacts.length; idx++) {
      const raw = rawArtifacts[idx];
      const runId = `${turnId}-run-${idx}`;
      const isUpstream = raw.capability.includes("risk") || raw.capability.includes("argue");
      const forceFail = nextGateShouldFail && isUpstream;
      const freshInputs = WhyBuddyRuntime.findInputsForCapability(working, raw.capability);
      const labelCtx = buildProcessLabelContext(raw.capability, processCtx.userText, processCtx.goalText);
      setLiveAction(getLiveAction(raw.capability, labelCtx));

      let exec: Awaited<ReturnType<typeof WhyBuddyRuntime.executeCapability>> | null = null;
      let execThrew = false;
      try {
        exec = await WhyBuddyRuntime.executeCapability({
          capabilityId: raw.capability,
          state: working,
          inputArtifactIds: freshInputs,
          roleId: raw.role,
          turnId,
        });
      } catch {
        execThrew = true;
      }

      const enrichedCtx = inferProcessContextFromExec(raw.capability, labelCtx, exec);
      const trace = buildActionTrace(raw.capability, !execThrew, enrichedCtx, exec);
      if (trace) actionTraces.push(trace);

      const content = exec ? exec.content : raw.content;
      const provenance = (exec?.provenance as Artifact["provenance"]) || "ai_generated";
      const realLlm =
        isExternalProvenance(exec?.provenance) ||
        exec?.provenance === "llm" ||
        exec?.provenance === "llm_fallback" ||
        String(exec?.summary || "").includes("server-llm");

      const { updatedState, committed } = WhyBuddyRuntime.commitArtifact(
        working,
        {
          id: raw.id,
          kind: raw.kind as any,
          provenance,
          producedBy: {
            capabilityRunId: runId,
            capabilityId: raw.capability,
            roleId: raw.role,
          },
          title: content ? content.split("\n")[0]?.slice(0, 80) : undefined,
          summary: content ? content.slice(0, 200) : undefined,
          content,
          ...(exec?.payload !== undefined ? { payload: exec.payload } : {}),
        } as any,
        runId,
        forceFail,
        freshInputs
      );

      working = updatedState;
      committedArtifacts.push({
        ...raw,
        content,
        trustLevel: committed ? (committed.trustLevel as WhyArtifact["trustLevel"]) : "untrusted",
        realLlm,
      });
    }

    return { working, committed: committedArtifacts, actions: actionTraces };
  };

  const runTurn = async (userText: string, intervention?: UserIntervention) => {
    if (!userText.trim() || isRunning) return;

    const turnId = `turn-${Date.now()}`;
    setIsRunning(true);

    try {
      const loadedState = await WhyBuddyRuntime.loadOrCreateSessionState(
        sessionState.sessionId || sessionId,
        goal
      );
      const { preparedState, context } = WhyBuddyRuntime.intakeMessage(loadedState, {
        turnId,
        userText: userText.trim(),
        intervention,
      });

      setLiveAction({ label: "正在规划本轮动作…", external: false });

      const planResponse = await fetchOrchestratePlan({
        state: preparedState,
        turnId,
        userText: userText.trim(),
        intervention: intervention
          ? {
              intent: intervention.intent,
              targetArtifactId: intervention.targetArtifactId,
              targetDecisionId: intervention.targetDecisionId,
            }
          : null,
      });

      let stateForOrch = preparedState;
      let orchContext = context;
      if (planResponse) {
        orchContext = {
          ...context,
          proposedPlan: {
            selected: planResponse.selected,
            rationale: planResponse.rationale,
            source: planResponse.source,
          },
        };
        if (planResponse.usage) {
          stateForOrch = WhyBuddyRuntime.recordCapabilityRunCost(
            stateForOrch,
            {
              id: `${turnId}-orch-plan`,
              capabilityId: "orchestrate.plan" as any,
              turnId,
              inputs: [],
              outputs: [],
              gateResults: [],
            } as any,
            { source: "server", usage: planResponse.usage }
          );
        }
      }

      const { newState: afterOrch, plan } = WhyBuddyRuntime.orchestrateReasoningTurn(
        stateForOrch,
        orchContext
      );

      if (plan.selected.length > 0) {
        const first = plan.selected[0] as { capabilityId: V5CapabilityId; roleId?: string };
        setLiveAction(
          getLiveAction(
            first.capabilityId,
            buildProcessLabelContext(first.capabilityId, userText.trim(), goal)
          )
        );
      }

      const { working, committed, actions } = await commitSelectedArtifacts(
        afterOrch,
        turnId,
        plan.selected.map((s: any) => ({
          capabilityId: s.capabilityId as V5CapabilityId,
          roleId: s.roleId,
        })),
        { userText: userText.trim(), goalText: goal }
      );

      let final = WhyBuddyRuntime.enrichGraphNodesAfterCommit(working, turnId);
      final = await persistSession(WhyBuddyRuntime.markAwaiting(final, turnId));
      applyPersistedState(final);

      const main = pickMainArtifact(committed);
      const mainArt = main ? committed.find((a) => a.id === main.artifactId) : undefined;

      const narration = await fetchNarration({
        state: final,
        turnId,
        userText: userText.trim(),
        intervention: intervention ? { intent: intervention.intent } : null,
        selected: plan.selected.map((s: any) => ({
          capabilityId: s.capabilityId,
          roleId: s.roleId,
        })),
        artifacts: committed.map((a) => ({
          kind: a.kind,
          title: a.content.split("\n")[0]?.slice(0, 80),
          summary: a.content.slice(0, 200),
          realLlm: a.realLlm,
        })),
        mainArtifact: mainArt
          ? { kind: mainArt.kind, title: mainArt.content.split("\n")[0], content: mainArt.content }
          : null,
      });

      const turn: UiTurn = {
        id: turnId,
        user: userText.trim(),
        assistant: narration.text,
        assistantSource: narration.source,
        narrationReason: narration.reason,
        main,
        actions,
      };

      setUiTurns((prev) => [...prev, turn]);
      setNextGateShouldFail(false);
    } finally {
      setIsRunning(false);
      setLiveAction(null);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await runTurn(text);
  };

  const challengeTurn = async (artifactId: string) => {
    const reason =
      window.prompt("你想如何质疑这轮结论？", "这个结论的依据不够充分，请重新推演。") ||
      "这个结论的依据不够充分，请重新推演。";
    await runTurn(reason, {
      targetArtifactId: artifactId,
      intent: "challenge",
      text: reason,
    });
  };

  return {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    executorMode,
    sendMessage,
    runTurn,
    challengeTurn,
  };
}