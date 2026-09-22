import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  deriveStatusBarFacts,
  idleRehearsalCursor,
  rehearsalClockShowSteps,
  type ContextHudFacts,
  type RehearsalClockCursor,
  type RehearsalClockView,
} from "./derive-status-bar";
import type { FactoryDecisionView } from "./derive-factory-decision";
import type { SlideRuleExecutorMode } from "./types";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";

export function RehearsalClockHud({
  clock,
  hud,
  show,
  showSteps = true,
  decision = null,
}: {
  clock: RehearsalClockView;
  hud: ContextHudFacts;
  show?: boolean;
  /** 刷新后 cursor 丢了：只留证据/token 行，不画六格全 pending。 */
  showSteps?: boolean;
  /** 最近一次工厂选材。没有账本就不画——不许伪造一条。 */
  decision?: FactoryDecisionView | null;
}) {
  if (!show) return null;
  const live = clock.steps.find((s) => s.status === "current");
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="sliderule-rehearsal-hud">
      {showSteps ? (
        <div
          className="flex flex-wrap items-center gap-1"
          data-testid="sliderule-rehearsal-clock"
          aria-label={
            live
              ? `推演进度 ${live.label}（${clock.steps.length} 步）`
              : "推演进度"
          }
        >
          {clock.steps.map((step) => (
            <span
              key={step.id}
              data-testid={`sliderule-rehearsal-step-${step.id}`}
              data-step={step.id}
              data-skippable={step.skippable ? "true" : "false"}
              data-status={step.status}
              aria-current={step.status === "current" ? "step" : undefined}
              title={step.label}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${
                step.status === "current"
                  ? "bg-[#e6f4ff] font-semibold text-[#1677ff] ring-[#91caff]/80"
                  : step.status === "done"
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200/80"
                    : step.status === "skipped"
                      ? "bg-[#f4f4f5] text-stone-400 ring-[#e5e7eb]/80"
                      : "bg-white text-stone-500 ring-[#e5e7eb]/80"
              }`}
            >
              <span className="font-mono">{step.id}</span>
              <span className="max-w-[9rem] truncate">{step.label}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] text-stone-600">
        {decision?.loopIndex != null ? (
          <span data-testid="sliderule-factory-loop" className="tabular-nums text-stone-500">
            第 {decision.loopIndex}
            {decision.maxLoops != null ? `/${decision.maxLoops}` : ""} 轮
          </span>
        ) : null}
        {clock.wallClockCopy ? (
          <span data-testid="sliderule-wall-clock" className="text-stone-500">
            {clock.wallClockCopy}
          </span>
        ) : null}
        <span data-testid="sliderule-context-hud" className="flex items-baseline gap-4">
          <span data-testid="sliderule-hud-evidence" className="tabular-nums">
            <span className="text-stone-400">证据 </span>
            <span className="font-mono font-semibold text-stone-800">
              {hud.gatedEvidenceCount}
            </span>
          </span>
          <span
            data-testid="sliderule-hud-tokens"
            data-token-known={hud.hasServerTokenFacts ? "true" : "false"}
            className="tabular-nums"
          >
            <span className="text-stone-400">额度 </span>
            <span className="font-mono font-semibold text-stone-800">
              {hud.hasServerTokenFacts ? hud.narrativeTokens : "—"}
            </span>
          </span>
        </span>
      </div>
      {decision ? (
        <div
          data-testid="sliderule-factory-decision"
          data-source={decision.source}
          data-degraded={decision.degraded ? "true" : "false"}
          className={`mt-0.5 text-[11px] leading-[1.45] ${
            decision.degraded ? "text-amber-800" : "text-stone-600"
          }`}
        >
          {decision.degraded ? (
            <div data-testid="sliderule-factory-decision-degraded" className="font-medium">
              选材回落规则版，不是模型挑的
            </div>
          ) : (
            <div data-testid="sliderule-factory-decision-source">模型挑的</div>
          )}
          {decision.saw.length > 0 ? (
            <div data-testid="sliderule-factory-decision-saw">
              规则给的 {decision.saw.join("、")}
            </div>
          ) : null}
          {decision.chose.length > 0 ? (
            <div data-testid="sliderule-factory-decision-chose">
              这一跳 {decision.chose.join("、")}
            </div>
          ) : null}
          {decision.rationale ? (
            <div data-testid="sliderule-factory-decision-rationale">
              {decision.rationale}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SlideRuleStatusBar({
  state,
  turnCount,
  isRunning,
  driveLoopCount,
  closureReason,
  executorMode,
  publishClosure,
  rehearsalCursor,
}: {
  state: V5SessionState;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  closureReason?: string | null;
  executorMode?: SlideRuleExecutorMode;
  publishClosure?: PublishClosureSummary | null;
  rehearsalCursor?: RehearsalClockCursor;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    closureReason,
    executorMode,
    publishClosure,
    rehearsalCursor: rehearsalCursor ?? idleRehearsalCursor(),
  });
  const hasClockProgress = facts.rehearsalClock.steps.some(
    (s) => s.status !== "pending"
  );
  const showHud =
    isRunning ||
    hasClockProgress ||
    !!publishClosure ||
    facts.hud.gatedEvidenceCount > 0 ||
    facts.hud.hasServerTokenFacts;

  return (
    <div
      className="border-b border-[#e5e7eb]/80 bg-[#eef0f4]/90 px-4 py-1.5"
      data-testid="sliderule-status-bar"
      aria-label="推演状态"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-600">
        <img
          src={`${import.meta.env.BASE_URL}assets/sliderule_icon_flat_transparent.png`}
          alt="SlideRule"
          className="mr-1 inline-block h-3.5 w-3.5 opacity-60 align-middle"
          title="SlideRule"
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          STATUS
        </span>
        <span
          data-testid="sliderule-conclusion-badge"
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
        >
          {facts.conclusionLabel}
        </span>
        <span
          data-testid="sliderule-grounding-badge"
          title={facts.groundingHint || facts.groundingLabel}
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${facts.groundingClassName}`}
        >
          {facts.groundingLabel}
        </span>
        <span
          data-testid="sliderule-executor-mode"
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
        >
          {facts.executorModeLabel}
        </span>
        {facts.publishClosureLabel && (
          <span
            data-testid="sliderule-publish-closure-badge"
            data-fail-closed={facts.publishClosureFailClosed ? "true" : "false"}
            title={facts.publishClosureHint}
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset ${facts.publishClosureClassName}`}
          >
            {facts.publishClosureLabel}
          </span>
        )}
        <span>
          <span className="text-stone-400">轮次 </span>
          <span className="font-mono font-semibold text-stone-700">{facts.turnCount}</span>
        </span>
        <span>
          <span className="text-stone-400">阶段 </span>
          <span className="font-mono text-stone-700">{facts.phaseLabel}</span>
        </span>
        {facts.groundingHint && (
          <span className="text-amber-700" data-testid="sliderule-grounding-hint">
            {facts.groundingHint}
          </span>
        )}
        {facts.parkHint && (
          <span className="text-stone-500" title={facts.goalSnippet}>
            {facts.parkHint}
          </span>
        )}
        {facts.dataReady && (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            dataReady
          </span>
        )}
      </div>
      <div className="mt-1.5">
        <RehearsalClockHud
          clock={facts.rehearsalClock}
          hud={facts.hud}
          decision={facts.factoryDecision}
          show={showHud}
          showSteps={rehearsalClockShowSteps(facts.rehearsalClock)}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px]">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.trustedArtifactCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">可信产物</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.openGapCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">缺口</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.driveLoopCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">调度环</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-base font-bold text-stone-800">
            {facts.capabilityRunCount}
          </span>
          <span className="font-semibold uppercase tracking-wide text-stone-400">能力调用</span>
        </div>
      </div>
    </div>
  );
}
