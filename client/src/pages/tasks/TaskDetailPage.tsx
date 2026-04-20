import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Play } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { TaskDetailView } from "@/components/tasks/TaskDetailView";
import { getReplayPath } from "@/components/navigation-config";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

export default function TaskDetailPage({
  taskId = null,
  onBack,
  className,
}: {
  taskId?: string | null;
  onBack?: () => void;
  className?: string;
}) {
  const { copy } = useI18n();
  const ensureReady = useTasksStore(state => state.ensureReady);
  const selectTask = useTasksStore(state => state.selectTask);
  const setDecisionNote = useTasksStore(state => state.setDecisionNote);
  const launchDecision = useTasksStore(state => state.launchDecision);
  const submitOperatorAction = useTasksStore(state => state.submitOperatorAction);
  const refresh = useTasksStore(state => state.refresh);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const decisionNotes = useTasksStore(state => state.decisionNotes);
  const operatorActionLoadingByMissionId = useTasksStore(
    state => state.operatorActionLoadingByMissionId
  );
  const loading = useTasksStore(state => state.loading);
  const error = useTasksStore(state => state.error);
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );
  const [, setLocation] = useLocation();

  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  useEffect(() => {
    if (taskId) {
      selectTask(taskId);
    }
  }, [selectTask, taskId]);

  const activeTaskId = taskId || selectedTaskId;
  const detail = activeTaskId ? detailsById[activeTaskId] || null : null;
  const decisionNote = activeTaskId ? decisionNotes[activeTaskId] || "" : "";

  async function handleLaunchDecision(presetId: string) {
    if (!activeTaskId) return;
    setLaunchingPresetId(presetId);
    try {
      await launchDecision(activeTaskId, presetId);
    } finally {
      setLaunchingPresetId(null);
    }
  }

  async function handleSubmitOperatorAction(payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) {
    if (!activeTaskId) return;
    try {
      await submitOperatorAction(activeTaskId, {
        action: payload.action,
        reason: payload.reason,
      });
      toast.success(
        copy.tasks.listPage.actionSuccess(
          copy.tasks.statuses.action[
            payload.action === "mark-blocked" ? "markBlocked" : payload.action
          ]
        )
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy.tasks.listPage.actionError;
      toast.error(message);
      throw error;
    }
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.1),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.1),transparent_22%),linear-gradient(180deg,#fffdf8,#f3ecdf)] px-4 py-4 md:px-6",
        className
      )}
    >
      <div className="mx-auto max-w-[1580px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-stone-200/80 bg-white/80 px-5 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
              {copy.tasks.detailPage.eyebrow}
            </div>
            <div className="mt-1 text-sm text-stone-600">
              {copy.tasks.detailPage.description}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading && !detail ? (
              <LoaderCircle className="size-4 animate-spin text-stone-500" />
            ) : null}
            {activeTaskId ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white/80"
                onClick={() => setLocation(getReplayPath(activeTaskId))}
              >
                <Play className="size-4" />
                {copy.tasks.detailPage.replay}
              </Button>
            ) : null}
            {onBack ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white/80"
                onClick={onBack}
              >
                <ArrowLeft className="size-4" />
                {copy.tasks.detailPage.back}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mb-4 rounded-[22px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,245,0.96),rgba(249,239,227,0.92))] px-5 py-4 text-sm leading-6 text-stone-700 shadow-[0_18px_40px_rgba(112,84,51,0.06)]">
          {copy.tasks.detailPage.runtimeEvidenceHandoff}
        </div>

        {error ? (
          <div className="mb-4">
            <RetryInlineNotice
              title={copy.chat.errorTitle}
              description={error}
              actionLabel={copy.tasks.listPage.refresh}
              onRetry={() =>
                void refresh({ preferredTaskId: activeTaskId || null })
              }
            />
          </div>
        ) : null}

        <TaskDetailView
          detail={detail}
          decisionNote={decisionNote}
          onDecisionNoteChange={value => {
            if (!activeTaskId) return;
            setDecisionNote(activeTaskId, value);
          }}
          onLaunchDecision={handleLaunchDecision}
          launchingPresetId={launchingPresetId}
          onSubmitOperatorAction={handleSubmitOperatorAction}
          operatorActionLoading={
            activeTaskId
              ? operatorActionLoadingByMissionId[activeTaskId] ?? {}
              : {}
          }
          onDecisionSubmitted={() =>
            void refresh({ preferredTaskId: activeTaskId })
          }
          deferRuntimeEvidence
        />
      </div>
    </div>
  );
}
