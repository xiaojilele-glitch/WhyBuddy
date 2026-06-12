import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import * as WhyBuddyRuntime from "@/lib/whybuddy-runtime";
import { fetchNarration } from "@/lib/whybuddy-narrator";
import { pickMainArtifactByKind } from "@shared/blueprint/whybuddy-main-artifact";
import type { UserIntervention, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTurnRoute } from "@shared/blueprint/whybuddy-turn-route";
import { resolveImSurfaceMode } from "./im-surface-mode";
import type { SchedulingDecision } from "@shared/blueprint/v5-reasoning-state";
import { challengeTargetLabel } from "./challenge-target-label";
import { buildTurnRoundsFromDrive } from "./turn-round-facts";
import { createUiCapabilityExecutor, mapArtifactsToWhyArtifacts } from "./ui-capability-executor";
import { createHttpWhyBuddySessionStore } from "@/lib/whybuddy-http-store";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { loadByokPool, validateByokPool } from "@/lib/whybuddy-byok-config";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { TurnStep, UiTurn, WhyArtifact, WhyBuddyExecutorMode } from "./types";
import * as Marathon from "@/lib/whybuddy-marathon-driver";
import {
  createGithubPagesWhyBuddySeedSession,
  createGithubPagesWhyBuddySessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "./github-pages-whybuddy-demo";

const DEFAULT_SESSION_ID = "whybuddy-v51-product";

function createEmptySessionState(sessionId: string): V5SessionState {
  const base = WhyBuddyRuntime.createInitialSessionState(
    WhyBuddyRuntime.EMPTY_SESSION_GOAL_TEXT,
    sessionId
  );
  return WhyBuddyRuntime.deriveNodeStatus ? WhyBuddyRuntime.deriveNodeStatus(base) : base;
}

function sanitizeLegacyEmptySeed(state: V5SessionState): V5SessionState {
  if (!WhyBuddyRuntime.isLegacyEmptySessionSeed(state)) return state;
  const cleared = createEmptySessionState(state.sessionId || DEFAULT_SESSION_ID);
  return { ...cleared, sessionId: state.sessionId || DEFAULT_SESSION_ID };
}

async function persistSession(state: V5SessionState): Promise<V5SessionState> {
  return WhyBuddyRuntime.saveSessionState(state);
}

function resolveExecutorMode(): WhyBuddyExecutorMode {
  if (IS_GITHUB_PAGES) {
    const pool = loadByokPool();
    if (pool && validateByokPool(pool).ok && pool.entries.some((e) => e.enabled && e.apiKey)) {
      return "browser-llm";
    }
    return "demo";
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("executor") === "pilot") return "pilot";
  if (params.get("executor") === "default") return "default";
  // V5.1 product default: real server LLM executor (override with ?executor=pilot for offline).
  return "server-llm";
}

function resolveMaxLoopsPerMessage(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("maxLoops");
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return WhyBuddyRuntime.PRODUCT_PREVIEW_MAX_LOOPS_PER_MESSAGE;
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
  const [uiTurns, setUiTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [liveAction, setLiveAction] = useState<LiveAction | null>(null);
  const [nextGateShouldFail, setNextGateShouldFail] = useState(false);
  const [executorMode, setExecutorMode] = useState<WhyBuddyExecutorMode>("server-llm");
  const [sessionState, setSessionState] = useState(() =>
    createEmptySessionState(sessionId)
  );
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // M2: drive mode (persisted for session; default "single" per spec)
  const [driveMode, setDriveMode] = useState<WhyBuddyRuntime.WhyBuddyDriveMode>(() => {
    try {
      return (localStorage.getItem("whybuddy:driveMode") as any) || "single";
    } catch {
      return "single";
    }
  });

  // persist on change
  useEffect(() => {
    try { localStorage.setItem("whybuddy:driveMode", driveMode); } catch {}
  }, [driveMode]);

  // M1: per-turn abort controller for graceful stop.
  const abortControllerRef = useRef<AbortController | null>(null);

  const goal = useMemo(() => {
    const fromState = sessionState.goal?.text?.trim();
    if (fromState) return fromState;
    const lastUser = [...uiTurns].reverse().find((t) => t.user.trim())?.user.trim();
    return lastUser || "";
  }, [sessionState.goal?.text, uiTurns]);

  useEffect(() => {
    const prev = WhyBuddyRuntime.getCapabilityExecutor?.();
    const prevStore = WhyBuddyRuntime.getWhyBuddySessionStore?.();
    const mode = resolveExecutorMode();
    setExecutorMode(mode);

    if (IS_GITHUB_PAGES && WhyBuddyRuntime.setWhyBuddySessionStore) {
      WhyBuddyRuntime.setWhyBuddySessionStore(createGithubPagesWhyBuddySessionStore());
      const pool = loadByokPool();
      if (pool && validateByokPool(pool).ok && pool.entries.some((e) => e.enabled && e.apiKey)) {
        WhyBuddyRuntime.useBrowserLlmCapabilityExecutor?.();
      } else {
        WhyBuddyRuntime.usePilotRealExecutor?.();
      }
    } else if (mode === "server-llm" && WhyBuddyRuntime.setWhyBuddySessionStore) {
      // B-5: product default uses durable Http store (survives refresh via server JSON file).
      WhyBuddyRuntime.setWhyBuddySessionStore(createHttpWhyBuddySessionStore());
    }

    if (!IS_GITHUB_PAGES) {
      if (mode === "server-llm" && WhyBuddyRuntime.useServerLlmCapabilityExecutor) {
        WhyBuddyRuntime.useServerLlmCapabilityExecutor?.();
      } else if (mode === "default") {
        WhyBuddyRuntime.useDefaultExecutor?.();
      } else {
        WhyBuddyRuntime.usePilotRealExecutor?.();
      }
    }

    return () => {
      if (prevStore && WhyBuddyRuntime.setWhyBuddySessionStore) {
        WhyBuddyRuntime.setWhyBuddySessionStore(prevStore);
      }
      if (prev && WhyBuddyRuntime.setCapabilityExecutor) {
        WhyBuddyRuntime.setCapabilityExecutor(prev);
      } else {
        WhyBuddyRuntime.useDefaultExecutor?.();
      }
    };
  }, []);

  // B4: live BYOK config change (storage or custom event) -> re-apply executor + mode without full refresh
  useEffect(() => {
    const reapplyByok = () => {
      if (!IS_GITHUB_PAGES) return;
      const mode = resolveExecutorMode();
      setExecutorMode(mode);
      if (mode === "browser-llm" && WhyBuddyRuntime.useBrowserLlmCapabilityExecutor) {
        WhyBuddyRuntime.useBrowserLlmCapabilityExecutor?.();
      } else {
        WhyBuddyRuntime.usePilotRealExecutor?.();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("whybuddy:llm-pool")) reapplyByok();
    };
    const onCustom = () => reapplyByok();
    window.addEventListener("storage", onStorage);
    window.addEventListener("byok-config-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("byok-config-changed", onCustom);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: V5SessionState;
      if (IS_GITHUB_PAGES) {
        const store = WhyBuddyRuntime.getWhyBuddySessionStore();
        loaded = await loadOrSeedGithubPagesDemoSession(store, sessionId);
      } else {
        loaded = await WhyBuddyRuntime.loadOrCreateSessionState(sessionId);
        if (WhyBuddyRuntime.isLegacyEmptySessionSeed(loaded)) {
          loaded = await persistSession(sanitizeLegacyEmptySeed(loaded));
        }
      }
      if (!cancelled) {
        setSessionState(loaded);
        setSessionHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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
    if (!userText.trim()) return;

    if (isRunning) {
      // M1: stop instead of send when running
      abortControllerRef.current?.abort();
      setIsRunning(false);
      return;
    }

    const turnId = `turn-${Date.now()}`;
    const controller = new AbortController();
    abortControllerRef.current = controller;
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
      const loadedState = sanitizeLegacyEmptySeed(
        await WhyBuddyRuntime.loadOrCreateSessionState(sessionState.sessionId || sessionId)
      );

      const goalStatusBefore = loadedState.goal?.status;
      const staleArtifactIdsBefore = [...(loadedState.staleArtifactIds || [])];

      const { preparedState } = WhyBuddyRuntime.intakeMessage(loadedState, {
        turnId,
        userText: userText.trim(),
        intervention,
      });

      const activeGoalText = preparedState.goal?.text?.trim() || userText.trim();
      applyPersistedState(preparedState);

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

      const firstLoopPlanCountRef = { value: 0 };
      const driveLoopsRef: WhyBuddyRuntime.DriveReasoningResult["loops"] = [];

      const imMode = resolveImSurfaceMode();
      const actionsAcc: ActionTrace[] = [];
      const uiExecutor = createUiCapabilityExecutor(WhyBuddyRuntime.getCapabilityExecutor(), {
        userText: userText.trim(),
        goalText: activeGoalText,
        emitImSteps: imMode !== "minimal",
        onStep: appendStep,
        onActionTrace: (trace) => {
          actionsAcc.push(trace);
          setUiTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
            )
          );
        },
        setLiveAction,
      });

      // M2: for this wave, always direct drive (skeleton marathon-driver.ts ready for full loop in future waves; mode is UI + persist only)
      // driveMode available for future: if (driveMode === "marathon") { use Marathon... }
      const drive = await WhyBuddyRuntime.driveReasoningSession(preparedState, {
        turnSeedId: turnId,
        userText: userText.trim(),
        intervention,
        router: IS_GITHUB_PAGES
          ? WhyBuddyRuntime.createDeterministicRouter()
          : WhyBuddyRuntime.createServerReasoningRouter(),
        executor: uiExecutor,
        maxLoopsPerMessage: resolveMaxLoopsPerMessage(),
        abortSignal: controller.signal, // M1
        onCapabilityRound: (payload) => {
          if (!payload.gateFailed && !payload.execFailed) return;
          const message = payload.gateFailed
            ? payload.gateMessage === "ground"
              ? "外部证据未接地 · 本轮为规则推演"
              : `提交闸未通过${payload.gateMessage ? ` · ${payload.gateMessage}` : ""}`
            : "能力执行失败，可重试";
          appendStep({
            id: `${payload.loopTurnId}-fail-gate-${payload.runIndex}`,
            kind: "capability_fail",
            capabilityId: payload.capabilityId,
            roleId: payload.roleId,
            loopTurnId: payload.loopTurnId,
            capabilityRunId: payload.runId,
            runIndex: payload.runIndex,
            message,
          });
        },
        onLoopComplete: async ({
          state,
          plan,
          loopTurnId,
          committedArtifactIds,
          stopSignal,
        }) => {
          driveLoopsRef.push({
            loopTurnId,
            plan,
            committedArtifactIds,
            stopSignal,
          });
          const derived = WhyBuddyRuntime.deriveNodeStatus
            ? WhyBuddyRuntime.deriveNodeStatus(state)
            : state;
          const loopPersisted = await persistSession(derived);
          applyPersistedState(loopPersisted);
          if (driveLoopsRef.length === 1) {
            firstLoopPlanCountRef.value = plan.selected.length;
          }
          const partialRounds = buildTurnRoundsFromDrive(loopPersisted.decisionLedger, {
            loops: driveLoopsRef,
            stopReason: "budget_exhausted",
          });
          const partialFacts = {
            turnId,
            timestamp: turnTimestamp,
            interventionIntent: intervention?.intent ?? null,
            challengeTargetLabel: challengeTargetLabel(challengeArt),
            goalStatusBefore,
            goalStatusAfterInvalidate: preparedState.goal?.status,
            staleArtifactIdsBefore,
            staleArtifactIdsAfter: [...(loopPersisted.staleArtifactIds || [])],
            rounds: partialRounds,
            selectedCapabilities: driveLoopsRef.flatMap((l) =>
              l.plan.selected.map((s) => ({
                capabilityId: String(s.capabilityId),
                roleId: String(s.roleId || "agent"),
              }))
            ),
          };
          patchRoute(
            { rounds: partialRounds },
            deriveTurnRoute(partialFacts).length
          );
        },
      });

      let final = drive.finalState;
      final = await persistSession(final);
      applyPersistedState(final);

      // M1 cleanup
      abortControllerRef.current = null;
      setIsRunning(false);

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

      const committedIds = drive.loops.flatMap((l) => l.committedArtifactIds);
      const committed = mapArtifactsToWhyArtifacts(final, committedIds);

      const loopTurnIds = new Set(drive.loops.map((l) => l.loopTurnId));
      const runsThisTurn = (final.capabilityRuns || []).filter((r) =>
        loopTurnIds.has(r.turnId)
      );
      const trustTotalCount = runsThisTurn.length || committed.length;
      const trustPassedCount =
        runsThisTurn.length > 0
          ? runsThisTurn.filter((r) =>
              (r.gateResults || []).every((g) => g.status === "passed")
            ).length
          : committed.filter(
              (a) => a.trustLevel === "gated_pass" || a.trustLevel === "audited"
            ).length;
      const trustGroundFailedCount = runsThisTurn.filter((r) =>
        (r.gateResults || []).some(
          (g) => g.gateId === "ground" && g.status === "failed"
        )
      ).length;

      const selectedCapabilities = drive.loops.flatMap((l) =>
        l.plan.selected.map((s) => ({
          capabilityId: String(s.capabilityId),
          roleId: String(s.roleId || "agent"),
        }))
      );

      const completeRouteFacts = {
        turnId,
        timestamp: turnTimestamp,
        interventionIntent: intervention?.intent ?? null,
        challengeTargetLabel: challengeTargetLabel(challengeArt),
        goalStatusBefore,
        goalStatusAfterInvalidate: preparedState.goal?.status,
        staleArtifactIdsBefore,
        staleArtifactIdsAfter: [...(final.staleArtifactIds || [])],
        planReason,
        planSelectedCount,
        planSource,
        planOrchestrateReason,
        dledgerDecisionId: dledger?.id ?? null,
        rounds,
        selectedCapabilities,
        committedCount: committed.length,
        trustPassedCount,
        trustTotalCount,
        trustGroundFailedCount,
        goalStatusAfter: final.goal?.status,
        runtimePhase: final.runtimePhase,
        closureReason: drive.stopReason,
      };

      patchRoute(
        {
          planReason,
          planSelectedCount,
          planSource,
          planOrchestrateReason,
          dledgerDecisionId: dledger?.id ?? null,
          rounds,
          committedCount: committed.length,
          trustPassedCount,
          trustTotalCount,
          trustGroundFailedCount,
          goalStatusAfter: final.goal?.status,
          runtimePhase: final.runtimePhase,
          closureReason: drive.stopReason,
        },
        deriveTurnRoute(completeRouteFacts).length
      );

      const main = pickMainArtifact(committed);
      const mainArt = main ? committed.find((a) => a.id === main.artifactId) : undefined;

      let assistantText = "";
      let assistantSource: UiTurn["assistantSource"] = "fallback";
      let narrationReason: UiTurn["narrationReason"];

      if (imMode === "minimal") {
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
        assistantText = narration.text;
        assistantSource = narration.source;
        narrationReason = narration.reason;
        appendStep({
          id: `${turnId}-final`,
          kind: "narration",
          text: narration.text,
          source: narration.source,
          isFinal: true,
        });
      }

      setUiTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          return {
            ...t,
            status: "complete",
            routeFacts: completeRouteFacts,
            routeExpanded: imMode !== "minimal",
            routeLitCount: deriveTurnRoute(completeRouteFacts).length,
            assistant: assistantText,
            assistantSource,
            narrationReason,
            main,
            actions: actionsAcc,
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

  const retryCapability = useCallback(
    async (
      turnId: string,
      params: {
        loopTurnId: string;
        capabilityId: V5CapabilityId;
        roleId: string;
        runIndex: number;
      }
    ) => {
      if (isRunning) return;

      const turn = uiTurns.find((t) => t.id === turnId);
      if (!turn) return;

      setIsRunning(true);

      const stripFailSteps = (steps: TurnStep[]) =>
        steps.filter(
          (s) =>
            !(
              s.kind === "capability_fail" &&
              s.loopTurnId === params.loopTurnId &&
              s.capabilityId === params.capabilityId &&
              s.runIndex === params.runIndex
            )
        );

      const appendStep = (step: TurnStep) => {
        setUiTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const base = stripFailSteps(t.steps);
            return { ...t, steps: [...base, step] };
          })
        );
      };

      try {
        let loaded = await WhyBuddyRuntime.loadOrCreateSessionState(
          sessionState.sessionId || sessionId
        );
        loaded = sanitizeLegacyEmptySeed(loaded);

        const goalText = loaded.goal?.text?.trim() || turn.user.trim();
        const uiExecutor = createUiCapabilityExecutor(
          WhyBuddyRuntime.getCapabilityExecutor(),
          {
            userText: turn.user.trim(),
            goalText,
            emitImSteps: true,
            onStep: appendStep,
            onActionTrace: (trace) => {
              setUiTurns((prev) =>
                prev.map((t) =>
                  t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
                )
              );
            },
            setLiveAction,
          }
        );

        const result = await WhyBuddyRuntime.retrySingleCapability(loaded, {
          ...params,
          executor: uiExecutor,
        });

        let final = await persistSession(result.state);
        applyPersistedState(final);

        const loopTurnIds = new Set(
          (turn.routeFacts.rounds || []).map((r) => r.loopTurnId)
        );
        if (loopTurnIds.size === 0) {
          loopTurnIds.add(params.loopTurnId);
        }
        const runsThisTurn = (final.capabilityRuns || []).filter((r) =>
          loopTurnIds.has(r.turnId)
        );
        const trustTotalCount = runsThisTurn.length;
        const trustPassedCount = runsThisTurn.filter((r) =>
          (r.gateResults || []).every((g) => g.status === "passed")
        ).length;
        const trustGroundFailedCount = runsThisTurn.filter((r) =>
          (r.gateResults || []).some(
            (g) => g.gateId === "ground" && g.status === "failed"
          )
        ).length;

        const committedIds = (final.artifacts || [])
          .filter((a) => {
            const runId = a.producedBy?.capabilityRunId || "";
            return [...loopTurnIds].some((lt) => runId.startsWith(`${lt}-run-`));
          })
          .map((a) => a.id);
        const committed = mapArtifactsToWhyArtifacts(final, committedIds);
        const main = pickMainArtifact(committed);

        setUiTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const routeFacts = {
              ...t.routeFacts,
              committedCount: committed.length,
              trustPassedCount,
              trustTotalCount,
              trustGroundFailedCount,
              goalStatusAfter: final.goal?.status,
              runtimePhase: final.runtimePhase,
            };
            return {
              ...t,
              routeFacts,
              routeLitCount: deriveTurnRoute(routeFacts).length,
              main: main ?? t.main,
            };
          })
        );
      } finally {
        setIsRunning(false);
        setLiveAction(null);
      }
    },
    [isRunning, uiTurns, sessionState.sessionId, sessionId, applyPersistedState]
  );

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

  const resetSession = useCallback(async () => {
    if (isRunning) return;
    const sid = sessionState.sessionId || sessionId;
    if (IS_GITHUB_PAGES) {
      const store = WhyBuddyRuntime.getWhyBuddySessionStore();
      await store.deleteSession?.(sid);
      const seeded = await store.save(createGithubPagesWhyBuddySeedSession());
      setSessionState(seeded);
    } else {
      if (WhyBuddyRuntime.deleteWhyBuddySession) {
        await WhyBuddyRuntime.deleteWhyBuddySession(sid);
      }
      const fresh = sanitizeLegacyEmptySeed(
        await WhyBuddyRuntime.loadOrCreateSessionState(
          sid,
          WhyBuddyRuntime.EMPTY_SESSION_GOAL_TEXT
        )
      );
      setSessionState(fresh);
    }
    setUiTurns([]);
    setInput("");
    setLiveAction(null);
    setNextGateShouldFail(false);
  }, [isRunning, sessionState.sessionId, sessionId]);

  return {
    goal,
    sessionHydrated,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    executorMode,
    driveMode,
    setDriveMode,
    sendMessage,
    runTurn,
    challengeTurn,
    resetSession,
    toggleRouteExpanded,
    retryCapability,
  };
}