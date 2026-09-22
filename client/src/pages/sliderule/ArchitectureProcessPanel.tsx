import React, { useEffect, useRef } from "react";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { autopilotTheme } from "./autopilot-theme";
import { TurnRouteTimeline } from "./TurnRouteTimeline";
import type { TurnRouteFacts } from "@shared/blueprint/sliderule-turn-route";
import type { TurnStep } from "./types";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import { ThinkingOrbMark } from "./ThinkingOrbMark";
import type {
  CrossRuntimeGraphSummary,
  PublishClosureSummary,
} from "./derive-cross-runtime-summary";

/**
 * V5.1 架构树时间线（INTAKE / ORCH / C_* / ↩ 回边）+ SKILL LINKAGE 摘要。
 *
 * variant="overlay"（默认）：历史用法 — 右上透明浮层（?im=dev 工程视图等）。
 * variant="rail"：统一页右栏「推演过程」视图 — 撑满容器宽度，空态给出诚实提示。
 */
export function ArchitectureProcessPanel({
  liveAction,
  latestTurn,
  sessionId,
  isRunning,
  onRetryCapability,
  onToggleRoute,
  crossRuntimeGraph,
  publishClosure,
  onSelectSkillLinkage,
  onSelectClosureBlocker,
  variant = "overlay",
}: {
  liveAction: LiveAction | null;
  latestTurn?: {
    id: string;
    routeFacts: TurnRouteFacts;
    steps: TurnStep[];
    actions: ActionTrace[];
    status: "streaming" | "complete";
    routeLitCount: number;
    routeExpanded: boolean;
  } | null;
  sessionId: string;
  isRunning: boolean;
  onRetryCapability?: (params: {
    loopTurnId: string;
    capabilityId: import("@shared/blueprint/contracts").V5CapabilityId;
    roleId: string;
    runIndex: number;
  }) => void;
  onToggleRoute?: () => void;
  crossRuntimeGraph?: CrossRuntimeGraphSummary | null;
  publishClosure?: PublishClosureSummary | null;
  onSelectSkillLinkage?: (edge: CrossRuntimeGraphSummary["examples"][number]) => void;
  onSelectClosureBlocker?: (blocker: PublishClosureSummary["topBlockers"][number]) => void;
  variant?: "overlay" | "rail";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const streaming = latestTurn?.status === "streaming";
  const publishClosureBlockers = publishClosure?.topBlockers ?? [];
  const publishClosureFailClosed =
    !!publishClosure?.blocked && publishClosureBlockers.length === 0;

  const scrollSignature = latestTurn
    ? (() => {
        const last = latestTurn.steps[latestTurn.steps.length - 1];
        const lastBody =
          last && "text" in last
            ? last.text.length
            : last && "label" in last
            ? last.label.length
            : last && "message" in last
            ? last.message.length
            : 0;
        return [
          latestTurn.id,
          latestTurn.routeLitCount,
          latestTurn.steps.length,
          latestTurn.actions.length,
          latestTurn.status,
          last?.id ?? "",
          lastBody,
          liveAction?.label ?? "",
        ].join("|");
      })()
    : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [latestTurn?.id]);

  useEffect(() => {
    if (!latestTurn) return;
    if (!streaming && !atBottomRef.current) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      atBottomRef.current = true;
    });
  }, [scrollSignature, streaming, latestTurn]);

  if (!latestTurn && !crossRuntimeGraph && !publishClosure) {
    if (variant === "rail") {
      return (
        <div
          data-testid="sliderule-arch-process-panel"
          data-variant="rail"
          className="flex h-full items-center justify-center px-6 text-center text-xs text-stone-400"
          aria-label="架构树节拍"
        >
          发送意图后，这里实时显示执行时间线（INTAKE → 六系统 → Commit Gate）与 SKILL LINKAGE。
        </div>
      );
    }
    return null;
  }

  return (
    <div
      ref={scrollRef}
      className={
        variant === "rail"
          ? "pointer-events-auto h-full w-full overflow-y-auto"
          : `${autopilotTheme.immersionHudRight} ${autopilotTheme.overlayTransparent} max-h-[min(78vh,720px)] overflow-y-auto`
      }
      data-testid="sliderule-arch-process-panel"
      data-variant={variant}
      aria-label="架构树节拍"
    >
      {liveAction && streaming && (
        <p
          className={`m-0 mb-2 px-1 text-xs ${
            liveAction.external ? "text-[#0958d9]" : "text-stone-600"
          }`}
        >
          {!liveAction.external && (
            <span className="mr-1.5 inline-flex align-middle" aria-hidden>
              <ThinkingOrbMark label={liveAction.label} size={20} />
            </span>
          )}
          {liveAction.label}
        </p>
      )}

      {latestTurn && (
        <TurnRouteTimeline
          facts={latestTurn.routeFacts}
          steps={latestTurn.steps}
          actions={latestTurn.actions}
          sessionId={sessionId}
          expanded={streaming || latestTurn.routeExpanded}
          onToggle={onToggleRoute ?? (() => {})}
          litCount={latestTurn.routeLitCount}
          streaming={streaming}
          liveAction={streaming ? liveAction : null}
          surfaceMode="product"
          immersionOverlay
          retrying={isRunning}
          onRetryCapability={onRetryCapability}
        />
      )}
      {(crossRuntimeGraph || publishClosure) && (
        <section
          className="mt-3 rounded-sm border border-[#e5e7eb]/80 bg-white/70 px-3 py-2 text-[10px] text-stone-600 shadow-sm"
          data-testid="sliderule-cross-runtime-graph"
          aria-label="Skill 运行时联动"
        >
          {crossRuntimeGraph && (
            <>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="font-mono font-semibold uppercase tracking-wide text-stone-500">
                  Skill linkage
                </span>
                <span className="font-mono text-stone-500">
                  {crossRuntimeGraph.edgeCount} edges / {crossRuntimeGraph.skillCount} skills
                </span>
              </div>
              <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9px]">
                <span className="text-emerald-700">
                  allowed {crossRuntimeGraph.allowedCount}
                </span>
                {crossRuntimeGraph.blockedCount > 0 && (
                  <span className="text-rose-700">blocked {crossRuntimeGraph.blockedCount}</span>
                )}
                <span className="text-stone-500">evidence {crossRuntimeGraph.evidenceCount}</span>
              </div>
              <div className="space-y-0.5">
                {crossRuntimeGraph.examples.map((edge) => (
                  <div
                    key={`${edge.sourceSkill}-${edge.targetSkill}-${edge.state}-${edge.evidenceKey ?? ""}`}
                    data-testid="sliderule-skill-linkage-row"
                    data-source-skill={edge.sourceSkill}
                    data-target-skill={edge.targetSkill}
                    data-state={edge.state}
                    data-evidence-key={edge.evidenceKey ?? ""}
                    className="truncate"
                    title={edge.evidenceKey ?? `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`}
                  >
                    <button
                      type="button"
                      data-testid="sliderule-skill-linkage-source"
                      data-skill={edge.sourceSkill}
                      className="m-0 inline cursor-pointer border-0 bg-transparent p-0 font-mono text-stone-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-stone-400"
                      aria-label={`选择来源 Skill ${edge.sourceSkill}`}
                      onClick={() => onSelectSkillLinkage?.(edge)}
                    >
                      {edge.sourceSkill}
                    </button>
                    <span className="px-1 text-stone-400">-&gt;</span>
                    <button
                      type="button"
                      data-testid="sliderule-skill-linkage-target"
                      data-skill={edge.targetSkill}
                      className="m-0 inline cursor-pointer border-0 bg-transparent p-0 font-mono text-stone-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-stone-400"
                      aria-label={`选择目标 Skill ${edge.targetSkill}`}
                      onClick={() => onSelectSkillLinkage?.(edge)}
                    >
                      {edge.targetSkill}
                    </button>
                    <span className="pl-1 text-stone-400">{edge.state}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {publishClosure && (
            <div
              className="mt-2 border-t border-[#e5e7eb]/80 pt-2"
              data-testid="sliderule-publish-closure"
              data-state={publishClosure.blocked ? "blocked" : "closed"}
              data-fail-closed={publishClosureFailClosed ? "true" : "false"}
            >
              <div className="flex items-center justify-between gap-3 font-mono text-[9px]">
                <span className={publishClosure.blocked ? "text-rose-700" : "text-emerald-700"}>
                  publish {publishClosure.blocked ? "blocked" : "closed"}
                </span>
                <span className="text-stone-500">
                  {publishClosure.evidencePresentCount}/{publishClosure.skillCount} evidence
                </span>
                <span className="text-stone-500">
                  pins {publishClosure.versionPinsChecked ? "checked" : "missing"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9px] text-stone-500">
                {publishClosure.stableDigest && (
                  <span title={publishClosure.closureId ?? publishClosure.stableDigest}>
                    digest {publishClosure.stableDigest}
                  </span>
                )}
                {publishClosure.closureHash && (
                  <span title={publishClosure.closureHash}>hash {publishClosure.closureHash}</span>
                )}
                <span className="text-rose-700">
                  hard {publishClosure.tierCounts.hard_blocker}
                </span>
                <span className="text-amber-700">warn {publishClosure.tierCounts.warning}</span>
                <span className="text-stone-500">info {publishClosure.tierCounts.info}</span>
              </div>
              {publishClosureBlockers.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {publishClosureBlockers.map((blocker) => {
                    const affectedSkill = blocker.affectedSkill ?? "";
                    const blockerRef = blocker.ref ?? blocker.path;
                    return (
                      <div
                        key={`${blocker.code}-${blocker.path}`}
                        data-testid="sliderule-publish-closure-blocker"
                        data-skill={affectedSkill}
                        data-ref={blocker.ref ?? ""}
                        data-path={blocker.path}
                        className="truncate font-mono text-[9px] text-rose-700"
                        title={[
                          blocker.code,
                          affectedSkill ? `skill=${affectedSkill}` : null,
                          blocker.ref ? `ref=${blocker.ref}` : null,
                          `path=${blocker.path}`,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      >
                        {blocker.code} /{" "}
                        <button
                          type="button"
                          data-testid="sliderule-closure-blocker-skill"
                          data-skill={affectedSkill}
                          className="m-0 inline cursor-pointer border-0 bg-transparent p-0 font-mono text-rose-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-stone-400"
                          aria-label={`选择受影响 Skill ${affectedSkill || "unknown"}`}
                          onClick={() => onSelectClosureBlocker?.(blocker)}
                        >
                          {affectedSkill || "unknown"}
                        </button>
                        {" / "}
                        <button
                          type="button"
                          data-testid="sliderule-closure-blocker-ref"
                          data-ref={blocker.ref ?? ""}
                          className="m-0 inline cursor-pointer border-0 bg-transparent p-0 font-mono text-rose-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-stone-400"
                          aria-label={`选择引用 ${blockerRef}`}
                          onClick={() => onSelectClosureBlocker?.(blocker)}
                        >
                          {blockerRef}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {publishClosureFailClosed && (
                <div
                  data-testid="publish-closure-fail-closed"
                  className="mt-1 truncate font-mono text-[9px] text-rose-700"
                  title="blocked publish closure did not include topBlockers"
                >
                  fail-closed: blocked with no topBlockers
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
    </div>
  );
}
