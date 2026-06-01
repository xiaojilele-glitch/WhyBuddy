import { useMemo, type FC } from "react";

import { StaleBadge } from "@/pages/autopilot/stage-edit";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

import {
  ArtifactCreatedCard,
  ReasoningCard,
} from "./mirofish-stream/cards";
import type {
  MiroFishArtifactCreatedEntry,
  MiroFishReasoningEntry,
} from "./mirofish-stream/mirofish-stream-types";

export interface ProcessArtifactSplitPanelProps {
  locale: AppLocale;
  job?: BlueprintGenerationJob | null;
  artifacts?: readonly BlueprintGenerationArtifact[];
  stageFilter?: string | readonly string[];
  artifactTypes?: readonly string[];
  reasoningEntries?: readonly AgentReasoningEntry[];
  fallbackExecutionEntries?: readonly ProcessArtifactFallbackExecutionEntry[];
  executionTitle?: string;
  artifactTitle?: string;
  /**
   * When any lane is empty, render a stable placeholder card instead of the
   * legacy single-line `<EmptyLane>` text. Defaults to `true`.
   *
   * Task 2.2 will swap the empty-branch rendering between
   * `<ExecutionPlaceholderCard>` / `<ArtifactPlaceholderCard>` (when this is
   * `true`) and the historical `<EmptyLane>` (when this is `false`).
   *
   * Both lane containers
   * (`data-testid="autopilot-process-execution-lane"` and
   * `data-testid="autopilot-process-artifact-lane"`) remain in the DOM
   * regardless of this flag — the conditional only swaps the inner empty
   * content.
   *
   * `WorkbenchExecutionPanel` does NOT need to pass this prop; it inherits
   * the new placeholder behavior via the `true` default (per design.md
   * Component 3 and Requirement 3.4–3.5: workbench accepts the new visual
   * baseline; non-empty data is non-regression).
   */
  showEmptyPlaceholder?: boolean;
  /**
   * Custom label for the execution lane placeholder/empty content. When
   * omitted, the locale default (`EMPTY_EXECUTION_TEXT[locale]`) is used.
   */
  emptyExecutionLabel?: string;
  /**
   * Custom label for the artifact lane placeholder/empty content. When
   * omitted, the locale default (`EMPTY_ARTIFACT_TEXT[locale]`) is used.
   */
  emptyArtifactLabel?: string;
}

export interface ProcessArtifactFallbackExecutionEntry {
  id: string;
  stageId?: string;
  text: string;
  timestamp?: string;
  phase?: AgentReasoningEntry["phase"];
  tone?: MiroFishReasoningEntry["tone"];
}

type ArtifactEntryWithStale = MiroFishArtifactCreatedEntry & {
  staleSince?: string | null;
  invalidatedBy?: BlueprintGenerationArtifact["invalidatedBy"] | null;
};

const EMPTY_EXECUTION_TEXT: Record<AppLocale, string> = {
  "zh-CN": "暂无执行过程",
  "en-US": "No execution events yet",
};

const EMPTY_ARTIFACT_TEXT: Record<AppLocale, string> = {
  "zh-CN": "暂无产物",
  "en-US": "No artifacts yet",
};

const PLACEHOLDER_EXECUTION_TEXT: Record<AppLocale, string> = {
  "zh-CN": "等待执行流…",
  "en-US": "Waiting for execution…",
};

const PLACEHOLDER_ARTIFACT_TEXT: Record<AppLocale, string> = {
  "zh-CN": "产物生成中…",
  "en-US": "Generating artifacts…",
};

const DEFAULT_EXECUTION_TITLE: Record<AppLocale, string> = {
  "zh-CN": "执行流",
  "en-US": "Execution",
};

const DEFAULT_ARTIFACT_TITLE: Record<AppLocale, string> = {
  "zh-CN": "产物流",
  "en-US": "Artifacts",
};

export const ProcessArtifactSplitPanel: FC<ProcessArtifactSplitPanelProps> = ({
  locale,
  job,
  artifacts,
  stageFilter,
  artifactTypes,
  reasoningEntries,
  fallbackExecutionEntries = [],
  executionTitle,
  artifactTitle,
  showEmptyPlaceholder = true,
  emptyExecutionLabel,
  emptyArtifactLabel,
}) => {
  // Resolve empty-lane labels: when placeholder mode is active, use the
  // placeholder-specific text; otherwise fall back to the legacy empty text.
  const executionLabel = emptyExecutionLabel ?? (showEmptyPlaceholder ? PLACEHOLDER_EXECUTION_TEXT[locale] : EMPTY_EXECUTION_TEXT[locale]);
  const artifactLabel = emptyArtifactLabel ?? (showEmptyPlaceholder ? PLACEHOLDER_ARTIFACT_TEXT[locale] : EMPTY_ARTIFACT_TEXT[locale]);
  const storeReasoningEntries = useBlueprintRealtimeStore(
    (state) => state.agentReasoning.entries
  );
  const sourceReasoningEntries = reasoningEntries ?? storeReasoningEntries;
  const scopedReasoningEntries = useMemo(
    () =>
      job?.id
        ? sourceReasoningEntries.filter(entry => entry.jobId === job.id)
        : sourceReasoningEntries,
    [sourceReasoningEntries, job?.id]
  );
  const filterSet = useMemo(
    () =>
      stageFilter === undefined
        ? undefined
        : new Set(typeof stageFilter === "string" ? [stageFilter] : stageFilter),
    [stageFilter]
  );
  const artifactTypeSet = useMemo(
    () => (artifactTypes ? new Set(artifactTypes) : undefined),
    [artifactTypes]
  );

  const artifactCards = useMemo(
    () => deriveArtifactEntries(artifacts ?? job?.artifacts ?? [], artifactTypeSet),
    [artifacts, job?.artifacts, artifactTypeSet]
  );
  const reasoningCards = useMemo(
    () => deriveReasoningCards(scopedReasoningEntries, filterSet),
    [scopedReasoningEntries, filterSet]
  );
  const fallbackReasoningCards = useMemo(
    () =>
      deriveFallbackReasoningCards(
        fallbackExecutionEntries.length > 0
          ? fallbackExecutionEntries
          : deriveArtifactFallbackExecutionEntries(artifactCards, locale),
        filterSet
      ),
    [artifactCards, fallbackExecutionEntries, filterSet, locale]
  );
  const executionCards =
    reasoningCards.length > 0 ? reasoningCards : fallbackReasoningCards;

  return (
    <section
      data-testid="autopilot-process-artifact-split-panel"
      className="grid min-h-0 min-w-0 gap-3 overflow-hidden border border-[#E5E5E5] bg-white p-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start"
      style={{ borderRadius: "0px" }}
    >
      <div
        data-testid="autopilot-process-execution-lane"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-[#EEEEEE] bg-[#FAFAFA] p-3"
        style={{ borderRadius: "0px" }}
      >
        <LaneTitle glyph="■">
          {executionTitle ?? DEFAULT_EXECUTION_TITLE[locale]}
        </LaneTitle>
        {executionCards.length > 0 ? (
          <div className="mt-3 grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1">
            {executionCards.map((entry, index) => (
              <ReasoningCard
                key={`${entry.id}-${index}`}
                entry={entry}
                locale={locale}
              />
            ))}
          </div>
        ) : showEmptyPlaceholder ? (
          <ExecutionPlaceholderCard label={executionLabel} />
        ) : (
          <EmptyLane testId="autopilot-process-execution-empty">
            {executionLabel}
          </EmptyLane>
        )}
      </div>

      <div
        data-testid="autopilot-process-artifact-lane"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-[#EEEEEE] bg-white p-3"
        style={{ borderRadius: "0px" }}
      >
        <LaneTitle glyph="◇">
          {artifactTitle ?? DEFAULT_ARTIFACT_TITLE[locale]}
        </LaneTitle>
        {artifactCards.length > 0 ? (
          <div className="mt-3 grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1">
            {artifactCards.map((entry, index) => (
              <div
                key={`${entry.id}-${index}`}
                data-testid="autopilot-process-artifact-card-frame"
                className="min-w-0 overflow-hidden"
              >
                <StaleBadge
                  staleSince={entry.staleSince}
                  invalidatedBy={entry.invalidatedBy}
                  locale={locale}
                />
                <ArtifactCreatedCard entry={entry} locale={locale} />
              </div>
            ))}
          </div>
        ) : showEmptyPlaceholder ? (
          <ArtifactPlaceholderCard label={artifactLabel} />
        ) : (
          <EmptyLane testId="autopilot-process-artifact-empty">
            {artifactLabel}
          </EmptyLane>
        )}
      </div>
    </section>
  );
};

export default ProcessArtifactSplitPanel;

/**
 * mirofish .panel-header — JetBrains Mono 0.8rem #999, with leading
 * glyph ("■" for execution, "◇" for artifact).
 */
const LaneTitle: FC<{ children: string; glyph?: string }> = ({
  children,
  glyph = "■",
}) => (
  <div className="font-mono text-[12.8px] uppercase tracking-[0.04em] text-[#999] flex items-center gap-2">
    <span className="text-[#FF4500]" aria-hidden="true">
      {glyph}
    </span>
    {children}
  </div>
);

const EmptyLane: FC<{ children: string; testId: string }> = ({
  children,
  testId,
}) => (
  <p
    data-testid={testId}
    className="mt-3 border border-dashed border-[#E5E5E5] bg-white px-3 py-3 font-mono text-[11px] text-[#666]"
    style={{ borderRadius: "0px" }}
  >
    {children}
  </p>
);

const ExecutionPlaceholderCard: FC<{ label: string }> = ({ label }) => (
  <div
    data-testid="autopilot-process-execution-placeholder"
    aria-busy="true"
    className="mt-3 border border-[#EEEEEE] bg-white px-3 py-4 font-mono text-[11px] text-[#999]"
    style={{ borderRadius: "0px" }}
  >
    {label}
  </div>
);

const ArtifactPlaceholderCard: FC<{ label: string }> = ({ label }) => (
  <div
    data-testid="autopilot-process-artifact-placeholder"
    aria-busy="true"
    className="mt-3 border border-[#EEEEEE] bg-white px-3 py-4 font-mono text-[11px] text-[#999]"
    style={{ borderRadius: "0px" }}
  >
    {label}
  </div>
);

function deriveReasoningCards(
  entries: readonly AgentReasoningEntry[],
  filterSet: ReadonlySet<string> | undefined
): MiroFishReasoningEntry[] {
  return entries
    .filter((entry) => {
      if (entry.phase === "iteration_started" || entry.phase === "iteration_completed") {
        return false;
      }
      if (filterSet && entry.stageId && !filterSet.has(entry.stageId)) {
        return false;
      }
      return true;
    })
    .map((entry) => ({
      id: entry.id,
      kind: "reasoning" as const,
      stageId: entry.stageId,
      timestamp: entry.timestamp,
      tone: entry.phase === "error"
        ? "danger"
        : entry.phase === "observing"
          ? entry.observationSuccess === false
            ? "warning"
            : "success"
          : entry.phase === "completed"
            ? "success"
            : "info",
      phase: entry.phase,
      iterationLabel: entry.iterationLabel,
      thought: entry.thought,
      actionToolId: entry.actionToolId,
      observationSummary: entry.observationSummary,
      observationSuccess: entry.observationSuccess,
      reason: entry.reason,
      error: entry.error,
    }));
}

function deriveFallbackReasoningCards(
  entries: readonly ProcessArtifactFallbackExecutionEntry[],
  filterSet: ReadonlySet<string> | undefined
): MiroFishReasoningEntry[] {
  return entries
    .filter((entry) => !filterSet || !entry.stageId || filterSet.has(entry.stageId))
    .map((entry, index) => ({
      id: entry.id,
      kind: "reasoning" as const,
      stageId: entry.stageId,
      timestamp: entry.timestamp ?? new Date(index).toISOString(),
      tone: entry.tone ?? "success",
      phase: entry.phase ?? "completed",
      iterationLabel: "",
      observationSuccess: true,
      observationSummary: entry.text,
    }));
}

function deriveArtifactFallbackExecutionEntries(
  entries: readonly ArtifactEntryWithStale[],
  locale: AppLocale
): ProcessArtifactFallbackExecutionEntry[] {
  if (entries.length === 0) {
    return [];
  }

  const titles = entries
    .map((entry) => entry.title || entry.artifactType)
    .filter(Boolean);
  const firstTitles = titles.slice(0, 3).join(locale === "zh-CN" ? "、" : ", ");
  const remainder = Math.max(0, titles.length - 3);
  const suffix =
    remainder > 0
      ? locale === "zh-CN"
        ? ` 等 ${titles.length} 个产物`
        : ` and ${remainder} more`
      : "";
  const text =
    locale === "zh-CN"
      ? `阶段已产出：${firstTitles}${suffix}`
      : `Stage produced: ${firstTitles}${suffix}`;

  return [
    {
      id: `artifact-fallback-${entries.map((entry) => entry.id).join("-")}`,
      text,
      timestamp: entries[entries.length - 1]?.timestamp,
      phase: "completed",
      tone: "success",
    },
  ];
}

function deriveArtifactEntries(
  artifacts: readonly BlueprintGenerationArtifact[],
  artifactTypeSet: ReadonlySet<string> | undefined
): ArtifactEntryWithStale[] {
  return artifacts
    .filter((artifact) => !artifactTypeSet || artifactTypeSet.has(artifact.type))
    .map((artifact, index) => ({
      id: artifact.id,
      kind: "artifact_created" as const,
      stageId: undefined,
      timestamp:
        typeof artifact.createdAt === "string" && artifact.createdAt.length > 0
          ? artifact.createdAt
          : new Date(index).toISOString(),
      tone: "neutral" as const,
      artifactId: artifact.id,
      artifactType: artifact.type,
      title: artifact.title,
      staleSince: artifact.staleSince,
      invalidatedBy: artifact.invalidatedBy,
    }));
}
