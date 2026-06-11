import { useState, useEffect, useCallback } from "react";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import * as WhyBuddyRuntime from "@/lib/whybuddy-runtime";
import { fetchNarration } from "@/lib/whybuddy-narrator";
import { pickMainArtifactByKind } from "@shared/blueprint/whybuddy-main-artifact";
import type { UserIntervention, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTurnRoute } from "@shared/blueprint/whybuddy-turn-route";
import type { SchedulingDecision } from "@shared/blueprint/v5-reasoning-state";
import { challengeTargetLabel } from "./challenge-target-label";
import { buildTurnRoundsFromDrive } from "./turn-round-facts";
import { createUiCapabilityExecutor, mapArtifactsToWhyArtifacts } from "./ui-capability-executor";
import type { TurnStep, UiTurn, WhyArtifact, WhyBuddyExecutorMode } from "./types";

const DEFAULT_GOAL = "做一个权限管理系统（支持 RBAC + 数据范围）";
const DEFAULT_SESSION_ID = "whybuddy-main-proto";
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

function latestDledgerForTurn(
  ledger: SchedulingDecision[] | undefined,
  turnId: string
): SchedulingDecision | null {
  const arr = ledger || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].turnId === turnId) return arr[i];
  }
  return null;
}

function pickMainArtifact(committed: WhyArtifact[]): UiTurn["main"] {
  const art = pickMainArtifactByKind(committed);
  if (art) {
    return { artifactId: art.id, kind: art.kind, realLlm: Boolean(art.realLlm) };
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

  const runTurn = async (userText: string, intervention?: UserIntervention) => {
    if (!userText.trim() || isRunning) return;

    const turnId = `turn-${Date.now()}`;
    setIsRunning(true);

    const appendStep = (step: TurnStep) => {
      setUiTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, steps: [...t.steps, step] } : t))
      );
    };

    const turnTimestamp = new Date().toISOString();

    const patchRoute = (
      patch: Partial<UiTurn["routeFacts"]>,
      litCount?: number
    ) => {
      setUiTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const routeFacts = { ...t.routeFacts, ...patch };
          const derived = deriveTurnRoute(routeFacts);
          return {
            ...t,
            routeFacts,
            routeLitCount: litCount ?? derived.length,
          };
        })
      );
    };

    setUiTurns((prev) => [
      ...prev,
      {
        id: turnId,
        user: userText.trim(),
        status: "streaming",
        steps: [],
        routeFacts: { turnId, timestamp: turnTimestamp },
        routeExpanded: true,
        routeLitCount: 1,
        assistant: "",
        assistantSource: "fallback",
        main: null,
        actions: [],
      },
    ]);

    try {
      const loadedState = await WhyBuddyRuntime.loadOrCreateSessionState(
        sessionState.sessionId || sessionId,
        goal
      );
      const goalStatusBefore = loadedState.goal?.status;
      const staleArtifactIdsBefore = [...(loadedState.staleArtifactIds || [])];

      const { preparedState } = WhyBuddyRuntime.intakeMessage(loadedState, {
        turnId,
        userText: userText.trim(),
        intervention,
      });

      const challengeArt = intervention?.targetArtifactId
        ? (loadedState.artifacts || []).find((a) => a.id === intervention.targetArtifactId)
        : undefined;

      patchRoute(
        {
          goalStatusBefore,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
          goalStatusAfterInvalidate: preparedState.goal?.status,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
        },
        deriveTurnRoute({
          turnId,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
          goalStatusBefore,
          goalStatusAfterInvalidate: preparedState.goal?.status,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
        }).length
      );

      setLiveAction({ label: "正在规划本轮动作…", external: false });

      const actionTraces: ActionTrace[] = [];
      const firstLoopPlanCountRef = { value: 0 };

      const onExecStep = (step: TurnStep) => {
        appendStep(step);
        setUiTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const execLit = deriveTurnRoute({
              ...t.routeFacts,
              planSelectedCount: firstLoopPlanCountRef.value,
            }).findIndex((s) => s.kind === "execution");
            return {
              ...t,
              routeLitCount: Math.max(t.routeLitCount, execLit + 1),
            };
          })
        );
      };

      const uiExecutor = createUiCapabilityExecutor(WhyBuddyRuntime.getCapabilityExecutor(), {
        userText: userText.trim(),
        goalText: goal,
        onStep: onExecStep,
        onActionTrace: (trace) => actionTraces.push(trace),
        setLiveAction,
      });

      const drive = await WhyBuddyRuntime.driveReasoningSession(preparedState, {
        turnSeedId: turnId,
        userText: userText.trim(),
        intervention,
        router: WhyBuddyRuntime.createServerReasoningRouter(),
        executor: uiExecutor,
      });

      let final = drive.finalState;
      final = await persistSession(final);
      applyPersistedState(final);

      const firstLoop = drive.loops[0];
      const lastLoop = drive.loops[drive.loops.length - 1];
      firstLoopPlanCountRef.value = firstLoop?.plan.selected.length ?? 0;

      const rounds = buildTurnRoundsFromDrive(final.decisionLedger, drive);
      const displayLoopId = firstLoop?.loopTurnId ?? turnId;
      const dledger = latestDledgerForTurn(final.decisionLedger, displayLoopId);
      const planSource = dledger?.source ?? "local_heuristic";
      const planOrchestrateReason =
        planSource === "local_heuristic" ? "orchestrate_unreachable" : null;
      const planReason = firstLoop?.plan.reason ?? lastLoop?.plan.reason;
      const planSelectedCount = firstLoop?.plan.selected.length ?? 0;

      patchRoute(
        {
          planReason,
          planSelectedCount,
          planSource,
          planOrchestrateReason,
          dledgerDecisionId: dledger?.id ?? null,
          rounds,
        },
        deriveTurnRoute({
          turnId,
          timestamp: turnTimestamp,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
          goalStatusBefore,
          goalStatusAfterInvalidate: preparedState.goal?.status,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
          planReason,
          planSelectedCount,
          planSource,
          planOrchestrateReason,
          dledgerDecisionId: dledger?.id ?? null,
          rounds,
        }).filter((s) => s.kind !== "execution" && s.kind !== "trust_gate" && s.kind !== "verdict" && s.kind !== "await").length
      );

      const committedIds = drive.loops.flatMap((l) => l.committedArtifactIds);
      const committed = mapArtifactsToWhyArtifacts(final, committedIds);
      const actions = actionTraces;

      const trustTotalCount = committed.length;
      const trustPassedCount = committed.filter(
        (a) => a.trustLevel === "gated_pass" || a.trustLevel === "audited"
      ).length;

      patchRoute({
        committedCount: trustTotalCount,
        trustPassedCount,
        trustTotalCount,
        goalStatusAfter: final.goal?.status,
        runtimePhase: final.runtimePhase,
      });

      const main = pickMainArtifact(committed);
      const mainArt = main ? committed.find((a) => a.id === main.artifactId) : undefined;

      const narration = await fetchNarration({
        state: final,
        turnId,
        userText: userText.trim(),
        intervention: intervention ? { intent: intervention.intent } : null,
        selected: drive.loops.flatMap((l) =>
          l.plan.selected.map((s) => ({
            capabilityId: s.capabilityId,
            roleId: s.roleId,
          }))
        ),
        artifacts: committed.map((a) => ({
          kind: a.kind,
          title: a.content.split("\n")[0]?.slice(0, 80),
          summary: a.content.slice(0, 200),
          realLlm: a.realLlm,
        })),
        mainArtifact: mainArt
          ? { kind: mainArt.kind, title: mainArt.content.split("\n")[0], content: mainArt.content }
          : null,
        goalStatusBefore,
        planReason: planReason ?? "",
        skipped: dledger?.skipped,
      });

      appendStep({
        id: `${turnId}-final`,
        kind: "narration",
        text: narration.text,
        source: narration.source,
        isFinal: true,
      });

      setUiTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const routeFacts = {
            ...t.routeFacts,
            goalStatusAfter: final.goal?.status,
            runtimePhase: final.runtimePhase ?? "awaiting",
          };
          return {
            ...t,
            status: "complete",
            routeFacts,
            routeExpanded: false,
            routeLitCount: deriveTurnRoute(routeFacts).length,
            assistant: narration.text,
            assistantSource: narration.source,
            narrationReason: narration.reason,
            main,
            actions,
          };
        })
      );
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

  const toggleRouteExpanded = useCallback((turnId: string) => {
    setUiTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, routeExpanded: !t.routeExpanded } : t
      )
    );
  }, []);

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
    toggleRouteExpanded,
  };
}