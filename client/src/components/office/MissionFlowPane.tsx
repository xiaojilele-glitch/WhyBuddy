import {
  AlertTriangle,
  ArrowRightCircle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Sparkles,
} from "lucide-react";

import { CompactPlanetInterior } from "@/components/tasks/CompactPlanetInterior";
import {
  compactText,
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";
import type { AppLocale } from "@/lib/locale";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

import {
  buildMissionFlowSteps,
  type MissionFlowStepKey,
  type MissionFlowStepState,
} from "./mission-flow-pane-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

const FLOW_COPY: Record<
  MissionFlowStepKey,
  { zhLabel: string; enLabel: string; zhHint: string; enHint: string }
> = {
  plan: {
    zhLabel: "计划",
    enLabel: "Plan",
    zhHint: "拆解任务、确认范围与执行路径",
    enHint: "Break down the task and lock scope and execution path.",
  },
  execute: {
    zhLabel: "执行",
    enLabel: "Execute",
    zhHint: "运行任务、产出信号与工件",
    enHint: "Run the mission and produce signals and artifacts.",
  },
  review: {
    zhLabel: "评审",
    enLabel: "Review",
    zhHint: "处理阻塞、决策、验收与收尾",
    enHint: "Handle blockers, decisions, acceptance, and wrap-up.",
  },
};

function stepTone(state: MissionFlowStepState) {
  switch (state) {
    case "completed":
      return "border-emerald-200/80 bg-emerald-50/88 text-emerald-900";
    case "active":
      return "border-amber-200/90 bg-[linear-gradient(180deg,rgba(255,248,236,0.96),rgba(255,239,216,0.92))] text-stone-900 shadow-[0_14px_28px_rgba(184,111,69,0.14)]";
    case "failed":
      return "border-rose-200/85 bg-rose-50/88 text-rose-900";
    default:
      return "border-stone-200/80 bg-white/74 text-stone-600";
  }
}

function StepIcon({ state }: { state: MissionFlowStepState }) {
  if (state === "completed") {
    return <CheckCircle2 className="size-4" />;
  }
  if (state === "failed") {
    return <AlertTriangle className="size-4" />;
  }
  if (state === "active") {
    return <LoaderCircle className="size-4 animate-spin" />;
  }
  return <Clock3 className="size-4" />;
}

export function MissionFlowPane({
  locale,
  detail,
  summary,
  pendingDirective,
  pendingAttachmentCount = 0,
  className,
}: {
  locale: AppLocale;
  detail: MissionTaskDetail | null;
  summary: MissionTaskSummary | null;
  pendingDirective?: string | null;
  pendingAttachmentCount?: number;
  className?: string;
}) {
  const steps = buildMissionFlowSteps(detail);
  const focusTitle =
    detail?.title ||
    pendingDirective ||
    t(
      locale,
      "等待把任务焦点落到首页主线区",
      "Waiting to pin a mission into the home flow."
    );
  const statusLabel = detail
    ? missionStatusLabel(detail.status, locale)
    : pendingDirective
      ? t(locale, "团队准备中", "Team preparing")
      : t(locale, "待命", "Idle");
  const statusTone = detail
    ? missionStatusTone(detail.status)
    : "workspace-tone-neutral";
  const blockerSummary =
    compactText(
      detail?.blocker?.reason ||
        detail?.waitingFor ||
        (pendingDirective
          ? t(
              locale,
              "当前在补齐创建前上下文，完成后会自动继续创建任务。",
              "The system is collecting the remaining context before it can create the mission."
            )
          : t(
              locale,
              "当前没有阻塞信号，选中任务后这里会显示下一条需要人工关注的信息。",
              "No blocker is active. Select a task and this card will surface the next human-facing issue."
            )),
      180
    ) || t(locale, "暂无阻塞信息", "No blocker summary yet");
  const resultSummary =
    compactText(
      detail?.summary ||
        detail?.artifacts[0]?.description ||
        detail?.artifacts[0]?.title ||
        summary?.summary ||
        pendingDirective ||
        t(
          locale,
          "任务结果摘要会随着执行推进显示在这里。",
          "The outcome summary will stay visible here as the mission advances."
        ),
      180
    ) || t(locale, "暂无结果摘要", "No outcome summary yet");
  const latestSignal =
    compactText(
      detail?.lastSignal ||
        detail?.timeline[0]?.description ||
        t(
          locale,
          "运行时还没有返回新的推进信号。",
          "The runtime has not produced a fresh progress signal yet."
        ),
      180
    ) || t(locale, "暂无执行信号", "No recent signal yet");

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/34 bg-[linear-gradient(180deg,rgba(255,252,248,0.72),rgba(246,238,229,0.62))] shadow-[0_22px_48px_rgba(99,73,45,0.12)] backdrop-blur-md",
        className
      )}
    >
      <div className="shrink-0 border-b border-stone-200/60 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              {t(locale, "任务主线", "Mission flow")}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "workspace-status !px-2 !py-1 !text-[10px] font-semibold",
                  statusTone
                )}
              >
                {statusLabel}
              </span>
              <span className="workspace-status workspace-tone-neutral !px-2 !py-1 !text-[10px] font-semibold">
                {detail
                  ? t(
                      locale,
                      `进度 ${detail.progress}%`,
                      `Progress ${detail.progress}%`
                    )
                  : t(locale, "等待任务焦点", "Waiting for mission focus")}
              </span>
              {detail?.decision ? (
                <span className="workspace-status workspace-tone-warning !px-2 !py-1 !text-[10px] font-semibold">
                  {t(locale, "待决策", "Decision pending")}
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 max-w-3xl text-[22px] font-semibold tracking-tight text-stone-900">
              {focusTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {t(
                locale,
                "首页中间区只负责回答一件事：任务现在推进到哪里、为什么卡住、下一步该看什么。",
                "The center column answers one question first: where the mission is now, why it is blocked, and what to inspect next."
              )}
            </p>
          </div>

          {detail?.stages?.length ? (
            <CompactPlanetInterior detail={detail} className="mx-0 w-[220px]" />
          ) : (
            <div className="flex w-[220px] flex-col justify-between rounded-[20px] border border-dashed border-stone-300/80 bg-white/62 p-4 text-sm text-stone-500">
              <div className="inline-flex size-10 items-center justify-center rounded-full bg-[#f7eadb] text-[#c98257]">
                <Sparkles className="size-5" />
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  {t(locale, "当前焦点", "Current focus")}
                </div>
                <div className="mt-2 text-sm leading-6 text-stone-700">
                  {pendingDirective
                    ? t(
                        locale,
                        "团队组织正在准备中，完成后会自动把焦点钉回任务主线。",
                        "The team is still preparing. Focus will snap back to the mission flow once it is ready."
                      )
                    : t(
                        locale,
                        "选中左侧任务后，这里会显示主线进度环和当前阶段。",
                        "Select a task on the left to show the progress ring and live stage here."
                      )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.95fr)]">
          <div className="space-y-3">
            <section className="rounded-[18px] border border-stone-200/80 bg-white/76 p-3 shadow-[0_10px_24px_rgba(99,73,45,0.07)]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t(locale, "主阶段", "Primary stages")}
                  </div>
                  <div className="mt-1 text-sm text-stone-600">
                    {t(
                      locale,
                      "用 plan -> execute -> review 收口首页第一视觉，不再让用户自己拼当前阶段。",
                      "Use plan -> execute -> review to anchor the first-screen narrative."
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {steps.map((step, index) => {
                  const copy = FLOW_COPY[step.key];
                  return (
                    <div
                      key={step.key}
                      className={cn(
                        "relative rounded-[16px] border p-3 transition-all",
                        stepTone(step.state)
                      )}
                    >
                      {index < steps.length - 1 ? (
                        <div className="absolute right-[-10px] top-1/2 hidden -translate-y-1/2 text-stone-300 md:block">
                          <ArrowRightCircle className="size-5" />
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                          {locale === "zh-CN" ? copy.zhLabel : copy.enLabel}
                        </span>
                        <StepIcon state={step.state} />
                      </div>
                      <div className="mt-2 text-sm leading-6 opacity-85">
                        {locale === "zh-CN" ? copy.zhHint : copy.enHint}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {detail?.stages?.length ? (
              <section className="rounded-[18px] border border-stone-200/80 bg-white/76 p-3 shadow-[0_10px_24px_rgba(99,73,45,0.07)]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "细分阶段", "Stage breakdown")}
                </div>
                <div className="mt-1 text-sm text-stone-600">
                  {t(
                    locale,
                    "保留更细的运行阶段，但只作为主线下方的支撑信息。",
                    "Keep the detailed runtime stages, but only as supporting context under the main flow."
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {detail.stages.map(stage => (
                    <div
                      key={stage.key}
                      className="rounded-[14px] border border-stone-200/75 bg-stone-50/80 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-stone-900">
                            {stage.label}
                          </div>
                          <div className="mt-0.5 text-xs leading-5 text-stone-500">
                            {compactText(
                              stage.detail ||
                                t(
                                  locale,
                                  "该阶段暂无补充描述。",
                                  "No extra detail is available for this stage yet."
                                ),
                              100
                            )}
                          </div>
                        </div>
                        <span className="workspace-status workspace-tone-neutral !px-2 !py-1 !text-[10px] font-semibold">
                          {stage.progress}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200/85">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            stage.status === "failed"
                              ? "bg-rose-400"
                              : stage.status === "done"
                                ? "bg-emerald-500"
                                : stage.status === "running"
                                  ? "bg-[#c98257]"
                                  : "bg-stone-300"
                          )}
                          style={{ width: `${Math.max(stage.progress, 4)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="space-y-3">
            <section className="rounded-[18px] border border-stone-200/80 bg-white/76 p-3 shadow-[0_10px_24px_rgba(99,73,45,0.07)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "当前阻塞", "Current blocker")}
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-700">
                {blockerSummary}
              </div>
            </section>

            <section className="rounded-[18px] border border-stone-200/80 bg-white/76 p-3 shadow-[0_10px_24px_rgba(99,73,45,0.07)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "结果摘要", "Outcome snapshot")}
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-700">
                {resultSummary}
              </div>
              {pendingAttachmentCount > 0 ? (
                <div className="mt-2 text-xs text-stone-500">
                  {t(
                    locale,
                    `已挂入 ${pendingAttachmentCount} 个附件上下文。`,
                    `${pendingAttachmentCount} attachment contexts are already linked.`
                  )}
                </div>
              ) : null}
            </section>

            <section className="rounded-[18px] border border-stone-200/80 bg-white/76 p-3 shadow-[0_10px_24px_rgba(99,73,45,0.07)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "最新信号", "Latest signal")}
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-700">
                {latestSignal}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
