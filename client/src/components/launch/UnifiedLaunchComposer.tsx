import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Splitter } from "antd";
import { RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { LaunchAttachmentSection } from "@/components/launch/LaunchAttachmentSection";
import { LaunchOperatorActionRail } from "@/components/launch/LaunchOperatorActionRail";
import { LaunchRuntimeMeta } from "@/components/launch/LaunchRuntimeMeta";
import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { GlowButton } from "@/components/ui/GlowButton";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { evaluateLaunchRoute } from "@/lib/launch-router";
import {
  selectTaskHubLaunchSession,
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
  type TaskHubCreateMission,
} from "@/lib/nl-command-store";
import { useAppStore } from "@/lib/store";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import type { WorkflowLaunchResult } from "@/lib/workflow-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  submitUnifiedClarification,
  submitUnifiedLaunch,
} from "@/lib/unified-launch-coordinator";
import { cn } from "@/lib/utils";
import {
  MAX_WORKFLOW_ATTACHMENTS,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
} from "@/lib/tasks-store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function getUnifiedLaunchRouteHint(
  locale: string,
  kind: "clarify" | "mission" | "workflow" | "upgrade-required"
) {
  switch (kind) {
    case "workflow":
      return t(
        locale,
        "已识别为附件/高级编排请求，提交后会进入 workflow 并尽快回落到任务焦点。",
        "Detected as an attachment-heavy or advanced launch. Submission enters workflow first, then returns to the task focus."
      );
    case "upgrade-required":
      return t(
        locale,
        "这条请求需要高级执行环境。提交时会先提示切换到高级模式。",
        "This request needs the advanced runtime. Submission prompts a runtime upgrade first."
      );
    case "clarify":
      return t(
        locale,
        "当前信息还不完整，提交后会先补问关键信息。",
        "The request is still underspecified. Submission asks for the missing details first."
      );
    default:
      return t(
        locale,
        "已识别为快速任务指令，提交后会直接创建 mission。",
        "Detected as a direct task command. Submission creates a mission immediately."
      );
  }
}

export function getUnifiedLaunchSubmitLabel(
  locale: string,
  options: {
    kind: "clarify" | "mission" | "workflow" | "upgrade-required";
    submitting: boolean;
  }
) {
  if (options.submitting) {
    return t(locale, "提交中...", "Submitting...");
  }
  if (options.kind === "upgrade-required") {
    return t(locale, "切到高级执行", "Switch to advanced");
  }
  if (options.kind === "workflow") {
    return t(locale, "智能发起", "Smart launch");
  }
  if (options.kind === "clarify") {
    return t(locale, "先澄清", "Clarify first");
  }
  return t(locale, "创建任务", "Create task");
}

export interface UnifiedWorkflowResolution extends WorkflowLaunchResult {
  directive: string;
  attachmentCount: number;
  requestedAt: number;
}

export function UnifiedLaunchComposer({
  createMission,
  activeTaskTitle,
  activeTaskDetail,
  operatorActionLoading,
  onSubmitOperatorAction,
  onTaskResolved,
  onWorkflowResolved,
  onOpenCreateDialog,
  onRefresh,
  refreshing = false,
  compact = false,
  bare = false,
  dense = false,
  hideHeader = false,
  hideInputLabel = false,
  hideClarificationPanel = false,
  className,
}: {
  createMission: TaskHubCreateMission;
  activeTaskTitle?: string | null;
  activeTaskDetail?: MissionTaskDetail | null;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onSubmitOperatorAction?: (payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) => void | Promise<void>;
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onWorkflowResolved?: (result: UnifiedWorkflowResolution) => void;
  onOpenCreateDialog?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  compact?: boolean;
  bare?: boolean;
  dense?: boolean;
  hideHeader?: boolean;
  hideInputLabel?: boolean;
  hideClarificationPanel?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const taskHubSession = useNLCommandStore(
    useShallow(selectTaskHubLaunchSession)
  );
  const setDraftText = useNLCommandStore(state => state.setDraftText);
  const clearError = useNLCommandStore(state => state.clearError);
  const {
    draftText,
    currentDialog,
    currentCommand,
    commands,
    loading: loadingCommand,
  } = taskHubSession;
  const loadingWorkflow = useWorkflowStore(state => state.isSubmitting);
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDense = dense;
  const isCompact = compact;
  const isBare = bare;
  const submitting = loadingCommand || loadingWorkflow || isPreparingFiles;

  const decision = useMemo(
    () =>
      evaluateLaunchRoute({
        text: draftText,
        attachments,
        runtimeMode,
      }),
    [attachments, draftText, runtimeMode]
  );
  const commandHistory = useMemo(
    () => commands.map(command => command.commandText),
    [commands]
  );

  const submitLabel = useMemo(() => {
    return getUnifiedLaunchSubmitLabel(locale, {
      kind: decision.kind,
      submitting,
    });
  }, [decision.kind, locale, submitting]);
  const hasActiveClarification = currentDialog?.status === "active";

  async function handleSubmit(commandText: string) {
    clearError();
    if (!commandText.trim() || submitting) {
      return;
    }

    if (decision.kind === "upgrade-required") {
      if (!CAN_USE_ADVANCED_RUNTIME) {
        toast(
          t(
            locale,
            "当前部署只支持前端预览，无法切换到高级执行。",
            "This deployment only supports frontend preview and cannot switch to advanced execution."
          )
        );
        return;
      }

      await setRuntimeMode("advanced");
      toast.success(
        t(
          locale,
          "已切换到高级执行模式，再次提交即可真实执行。",
          "Switched to advanced runtime. Submit again to run for real."
        )
      );
      return;
    }

    try {
      const result = await submitUnifiedLaunch({
        text: commandText,
        attachments,
        runtimeMode,
        userId: "current-user",
        priority: "medium",
      });

      if (result.route === "workflow") {
        onWorkflowResolved?.({
          workflowId: result.workflowId,
          missionId: result.missionId,
          deduped: result.deduped,
          directive: commandText,
          attachmentCount: attachments.length,
          requestedAt: Date.now(),
        });
        setAttachments([]);
        setAttachmentError(null);
        setDraftText("");
        toast.success(
          t(
            locale,
            result.missionId
              ? "已进入高级编排，并成功关联任务焦点。"
              : "已进入高级编排，正在等待任务焦点回落。",
            result.missionId
              ? "Advanced workflow started and linked back to the mission focus."
              : "Advanced workflow started and is waiting to link back to a mission."
          )
        );
        return;
      }

      if (
        result.route === "mission" &&
        result.status === "created" &&
        result.missionId
      ) {
        onTaskResolved?.({
          commandId: result.commandId,
          commandText,
          missionId: result.missionId,
          relatedMissionIds: [result.missionId],
          autoSelectedMissionId: result.missionId,
          status: "created",
          createdAt: Date.now(),
        });
        setAttachments([]);
        setAttachmentError(null);
        toast.success(
          t(
            locale,
            "智能入口已直接创建任务，并自动聚焦到新任务。",
            "The smart launcher created a mission directly and focused the new task."
          )
        );
        return;
      }

      toast(
        t(
          locale,
          "先补完下方问题，系统再继续创建任务。",
          "Answer the questions below and the system will continue creating the mission."
        )
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(locale, "统一发起失败。", "Unified launch failed.")
      );
    }
  }

  async function handleClarificationAnswer(
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) {
    if (!currentCommand) {
      return;
    }

    try {
      const result = await submitUnifiedClarification({
        commandId: currentCommand.commandId,
        answer: {
          questionId,
          text,
          selectedOptions,
          timestamp: Date.now(),
        },
      });

      if (
        result?.route === "mission" &&
        result.status === "created" &&
        result.missionId
      ) {
        onTaskResolved?.({
          commandId: result.commandId,
          commandText: currentCommand.commandText,
          missionId: result.missionId,
          relatedMissionIds: [result.missionId],
          autoSelectedMissionId: result.missionId,
          status: "created",
          createdAt: Date.now(),
        });
        toast.success(
          t(
            locale,
            "补充信息已完成，任务已经进入主队列。",
            "Clarification is complete and the mission has entered the queue."
          )
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(locale, "补充信息提交失败。", "Failed to submit clarification.")
      );
    }
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    setIsPreparingFiles(true);
    try {
      const prepared = await prepareWorkflowAttachments(files);
      let overflowed = false;
      setAttachments(current => {
        const seen = new Set(
          current.map(item => `${item.name}:${item.size}:${item.mimeType}`)
        );
        const next = [...current];
        for (const item of prepared) {
          const key = `${item.name}:${item.size}:${item.mimeType}`;
          if (seen.has(key)) {
            continue;
          }
          if (next.length >= MAX_WORKFLOW_ATTACHMENTS) {
            overflowed = true;
            break;
          }
          next.push(item);
          seen.add(key);
        }
        return next;
      });
      if (overflowed) {
        setAttachmentError(
          t(
            locale,
            `最多附件 ${MAX_WORKFLOW_ATTACHMENTS} 个，超出的文件已忽略。`,
            `Only ${MAX_WORKFLOW_ATTACHMENTS} attachments are allowed. Extra files were skipped.`
          )
        );
      }
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : t(locale, "文件准备失败。", "Failed to prepare files.")
      );
    } finally {
      setIsPreparingFiles(false);
    }
  }

  const composerInputShell = (
    <div className="rounded-[18px] border border-stone-200/80 bg-white/82 p-3">
      <CommandInput
        onSubmit={handleSubmit}
        loading={submitting}
        commandHistory={commandHistory}
        value={draftText}
        onTextChange={setDraftText}
        hideLabel={hideInputLabel}
        dense={isDense}
        rows={isCompact ? 2 : 3}
        placeholder={t(
          locale,
          "直接描述目标、约束、交付物，必要时附上文件；系统会自动判断走快速任务、澄清还是高级编排...",
          "Describe the goal, constraints, deliverable, and attach files if needed. The system decides between mission, clarification, and workflow..."
        )}
        submitLabel={submitLabel}
        sendingLabel={submitLabel}
        hideSubmitButton
      />

      <LaunchRuntimeMeta
        locale={locale}
        runtimeMode={runtimeMode}
        attachmentCount={attachments.length}
        isPreparingFiles={isPreparingFiles}
        maxAttachments={MAX_WORKFLOW_ATTACHMENTS}
        onPickFiles={() => fileInputRef.current?.click()}
        operatorActionRail={
          activeTaskDetail ? (
            <LaunchOperatorActionRail
              detail={activeTaskDetail}
              loadingByAction={operatorActionLoading}
              onSubmitAction={onSubmitOperatorAction}
              trailingAction={
                <GlowButton
                  type="button"
                  disabled={!draftText.trim() || submitting}
                  className="h-8 shrink-0 rounded-full px-3 text-xs font-semibold shadow-[0_10px_24px_rgba(94,139,114,0.18)]"
                  onClick={() => void handleSubmit(draftText)}
                >
                  <Send className="size-3.5" />
                  {submitLabel}
                </GlowButton>
              }
            />
          ) : undefined
        }
        onSubmit={() => void handleSubmit(draftText)}
        submitLabel={submitLabel}
        submitDisabled={!draftText.trim() || submitting}
      />
    </div>
  );

  return (
    <section
      className={cn(
        !isBare &&
          "rounded-[24px] border border-stone-200/70 bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(247,240,233,0.88))] shadow-[0_18px_40px_rgba(98,73,48,0.08)]",
        isBare ? "p-1" : isDense ? "p-3" : "p-4",
        className
      )}
    >
      {!hideHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              <Sparkles className="size-4" />
              {t(locale, "统一智能发起", "Unified smart launch")}
            </div>
            <div className="mt-1 text-sm text-stone-700">
              {activeTaskTitle
                ? t(
                    locale,
                    `围绕当前焦点“${activeTaskTitle}”发起任务或高级编排。`,
                    `Launch tasks or advanced workflows around the current focus "${activeTaskTitle}".`
                  )
                : t(
                    locale,
                    "用一个输入框发起任务、附件编排或执行请求。",
                    "Use one input to launch tasks, attachment workflows, or runtime requests."
                  )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenCreateDialog ? (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenCreateDialog}
              >
                {t(locale, "新建任务", "New task")}
              </Button>
            ) : null}
            {onRefresh ? (
              <Button
                type="button"
                variant="outline"
                disabled={refreshing}
                onClick={onRefresh}
              >
                <RefreshCw
                  className={cn("size-4", refreshing && "animate-spin")}
                />
                {t(locale, "刷新", "Refresh")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          hideHeader ? "" : isDense ? "mt-3" : "mt-4",
          isBare ? "space-y-2" : "space-y-3"
        )}
      >
        <LaunchAttachmentSection
          attachments={attachments}
          attachmentError={attachmentError}
          onRemoveAttachment={attachmentId =>
            setAttachments(current =>
              current.filter(item => item.id !== attachmentId)
            )
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={event => void handleFilesSelected(event)}
        />

        {hasActiveClarification && currentDialog && !hideClarificationPanel ? (
          <Splitter
            layout="vertical"
            lazy
            className={cn(
              "launch-clarification-splitter min-h-0 rounded-[20px] border border-stone-200/75 bg-[linear-gradient(180deg,rgba(255,252,248,0.74),rgba(247,240,233,0.64))] p-2 shadow-[0_14px_34px_rgba(98,73,48,0.08)]",
              isDense ? "gap-2" : "gap-3"
            )}
          >
            <Splitter.Panel
              min={84}
              defaultSize="42%"
              collapsible={{ end: true, showCollapsibleIcon: true }}
            >
              <div className="min-h-0 overflow-y-auto pr-1">
                <ClarificationPanel
                  dialog={currentDialog}
                  onAnswer={handleClarificationAnswer}
                  className="border-amber-200/80 bg-amber-50/70"
                />
              </div>
            </Splitter.Panel>
            <Splitter.Panel min={168}>{composerInputShell}</Splitter.Panel>
          </Splitter>
        ) : (
          composerInputShell
        )}
      </div>
    </section>
  );
}
