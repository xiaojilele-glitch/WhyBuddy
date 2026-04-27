import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type AutopilotDriveMainState =
  | "understanding"
  | "clarifying"
  | "planning"
  | "fleet-forming"
  | "executing"
  | "reviewing"
  | "delivered";

export type AutopilotDriveExceptionState =
  | "blocked"
  | "takeover-required"
  | "replanning"
  | "failed";

export type AutopilotDriveState =
  | AutopilotDriveMainState
  | AutopilotDriveExceptionState;

export type AutopilotReplanMode =
  | "runtime_replanned"
  | "system_downgraded"
  | "user_selected";

export type AutopilotDriveReplanBanner = {
  mode: AutopilotReplanMode;
  fromRoute?: string | null;
  toRoute?: string | null;
  reason?: string | null;
  triggeredBy?: string | null;
  impact?: string | null;
  evidenceEventId?: string | null;
  evidenceHref?: string | null;
  routeEvidenceLabel?: string | null;
};

export type AutopilotDriveStateTimelineProps = {
  currentState: AutopilotDriveState | string;
  exceptionStates?: AutopilotDriveExceptionState[];
  completedStates?: AutopilotDriveMainState[];
  stateDetails?: Partial<Record<AutopilotDriveState | string, string>>;
  nextStep?: string | null;
  remainingSteps?: string[];
  replan?: AutopilotDriveReplanBanner | null;
  className?: string;
};

const MAIN_RAIL: AutopilotDriveMainState[] = [
  "understanding",
  "clarifying",
  "planning",
  "fleet-forming",
  "executing",
  "reviewing",
  "delivered",
];

const EXCEPTION_RAIL: AutopilotDriveExceptionState[] = [
  "blocked",
  "takeover-required",
  "replanning",
  "failed",
];

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function t(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en;
}

function formatUnknownDriveState(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`)
    .join(" ");
}

function driveStateLabel(locale: string, state: AutopilotDriveState | string): string {
  switch (state) {
    case "understanding":
      return t(locale, "理解中", "Understanding");
    case "clarifying":
      return t(locale, "澄清中", "Clarifying");
    case "planning":
      return t(locale, "规划中", "Planning");
    case "fleet-forming":
      return t(locale, "车队编组", "Fleet Forming");
    case "executing":
      return t(locale, "执行中", "Executing");
    case "reviewing":
      return t(locale, "复核中", "Reviewing");
    case "delivered":
      return t(locale, "已交付", "Delivered");
    case "blocked":
      return t(locale, "已阻塞", "Blocked");
    case "takeover-required":
      return t(locale, "需要接管", "Takeover Required");
    case "replanning":
      return t(locale, "重新规划", "Replanning");
    case "failed":
      return t(locale, "执行失败", "Failed");
    default:
      return formatUnknownDriveState(state) || t(locale, "未知状态", "Unknown State");
  }
}

function replanModeLabel(locale: string, mode: AutopilotReplanMode): string {
  switch (mode) {
    case "runtime_replanned":
      return t(locale, "运行时重规划", "Runtime Replanned");
    case "system_downgraded":
      return t(locale, "系统降级", "System Downgraded");
    case "user_selected":
      return t(locale, "用户选择", "User Selected");
  }
}

function stateToneClass({
  active,
  completed,
  exception,
}: {
  active: boolean;
  completed: boolean;
  exception: boolean;
}): string {
  if (exception && active) {
    return "border-amber-300 bg-amber-50 text-amber-900 shadow-[0_10px_26px_rgba(217,119,6,0.14)]";
  }

  if (exception) {
    return "border-amber-200 bg-white/72 text-amber-800";
  }

  if (active) {
    return "border-teal-300 bg-teal-50 text-teal-950 shadow-[0_10px_26px_rgba(13,148,136,0.14)]";
  }

  if (completed) {
    return "border-emerald-200 bg-emerald-50/70 text-emerald-900";
  }

  return "border-[var(--workspace-panel-border)] bg-white/64 text-stone-600";
}

export function AutopilotDriveStateTimeline({
  currentState,
  exceptionStates = [],
  completedStates = [],
  stateDetails = {},
  nextStep,
  remainingSteps = [],
  replan,
  className,
}: AutopilotDriveStateTimelineProps) {
  const { locale } = useI18n();
  const activeExceptionStates = new Set<AutopilotDriveExceptionState>([
    ...exceptionStates,
    ...(EXCEPTION_RAIL.includes(currentState as AutopilotDriveExceptionState)
      ? [currentState as AutopilotDriveExceptionState]
      : []),
  ]);
  const completed = new Set(completedStates);

  return (
    <section
      className={cn(
        "workspace-panel rounded-[18px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.72)] p-4",
        className
      )}
      data-testid="autopilot-drive-state-timeline"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {t(locale, "驾驶状态时间线", "Drive State Timeline")}
          </div>
          <div className="mt-1 text-sm font-semibold text-stone-900">
            {t(locale, "当前", "Current")}: {driveStateLabel(locale, currentState)}
          </div>
        </div>
        {activeExceptionStates.size > 0 ? (
          <span className="workspace-status bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
            {t(locale, "异常", "Exception")}
          </span>
        ) : null}
      </div>

      <ol
        className="mt-4 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0"
        aria-label="main drive rail"
        data-mobile-timeline="horizontal-scroll"
        data-testid="drive-state-main-rail"
      >
        {MAIN_RAIL.map((state, index) => {
          const active = currentState === state;
          const detail = stateDetails[state];

          return (
            <li
              key={state}
              className={cn(
                "relative min-w-[148px] snap-start rounded-[14px] border px-3 py-2 transition-colors sm:min-w-0",
                stateToneClass({
                  active,
                  completed: completed.has(state),
                  exception: false,
                })
              )}
              data-current={active ? "true" : undefined}
              data-testid={`drive-state-${state}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/80 text-[10px] font-semibold">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold">
                  {driveStateLabel(locale, state)}
                </span>
              </div>
              {detail ? (
                <div className="mt-1 text-[11px] leading-4 opacity-75">{detail}</div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {nextStep || remainingSteps.length > 0 ? (
        <div
          className="mt-3 rounded-[14px] border border-[var(--workspace-panel-border)] bg-white/68 px-3 py-2"
          data-testid="drive-state-next-steps"
        >
          {nextStep ? (
            <div className="text-xs font-semibold text-stone-900">
              {t(locale, "下一步", "Next Step")}: {nextStep}
            </div>
          ) : null}
          {remainingSteps.length > 0 ? (
            <div className="mt-1 text-[11px] leading-5 text-stone-600">
              {t(locale, "剩余步骤", "Remaining Steps")}:{" "}
              {remainingSteps.join("; ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {replan ? (
        <div
          className="mt-3 rounded-[16px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.9),rgba(255,251,235,0.82))] p-3 text-slate-900 shadow-[0_12px_30px_rgba(14,116,144,0.10)]"
          data-replan-mode={replan.mode}
          data-testid="drive-state-replan-banner"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-800">
              {t(locale, "重规划", "Replan")}
            </div>
            <span className="workspace-status bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800">
              {replanModeLabel(locale, replan.mode)}
            </span>
          </div>
          <div className="mt-2 grid gap-2 text-[11px] leading-5 sm:grid-cols-2">
            {replan.routeEvidenceLabel ||
            replan.evidenceEventId ||
            replan.evidenceHref ? (
              <div
                className="sm:col-span-2 rounded-[12px] border border-sky-100 bg-white/70 px-2 py-1.5"
                data-testid="drive-state-replan-evidence"
              >
                <span className="font-semibold">
                  {t(locale, "路线证据", "Route Evidence")}:
                </span>{" "}
                {replan.evidenceHref ? (
                  <a
                    className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                    href={replan.evidenceHref}
                  >
                    {replan.routeEvidenceLabel ||
                      replan.evidenceEventId ||
                      replan.evidenceHref}
                  </a>
                ) : (
                  <span>
                    {replan.routeEvidenceLabel ||
                      replan.evidenceEventId ||
                      t(locale, "已关联", "Linked")}
                  </span>
                )}
                {replan.evidenceEventId ? (
                  <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                    {replan.evidenceEventId}
                  </span>
                ) : null}
              </div>
            ) : null}
            {replan.fromRoute ? (
              <div>
                <span className="font-semibold">
                  {t(locale, "原路线", "From Route")}:
                </span>{" "}
                {replan.fromRoute}
              </div>
            ) : null}
            {replan.toRoute ? (
              <div>
                <span className="font-semibold">
                  {t(locale, "目标路线", "To Route")}:
                </span>{" "}
                {replan.toRoute}
              </div>
            ) : null}
            {replan.triggeredBy ? (
              <div>
                <span className="font-semibold">
                  {t(locale, "触发方", "Triggered By")}:
                </span>{" "}
                {replan.triggeredBy}
              </div>
            ) : null}
            {replan.reason ? (
              <div>
                <span className="font-semibold">
                  {t(locale, "原因", "Reason")}:
                </span>{" "}
                {replan.reason}
              </div>
            ) : null}
            {replan.impact ? (
              <div className="sm:col-span-2">
                <span className="font-semibold">
                  {t(locale, "影响", "Impact")}:
                </span>{" "}
                {replan.impact}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0"
        aria-label="exception drive rail"
        data-mobile-timeline="exception-horizontal-scroll"
        data-testid="drive-state-exception-rail"
      >
        {EXCEPTION_RAIL.map(state => {
          const active = activeExceptionStates.has(state);
          const detail = stateDetails[state];

          return (
            <div
              key={state}
              className={cn(
                "min-w-[168px] snap-start rounded-[14px] border px-3 py-2 sm:min-w-0",
                stateToneClass({
                  active,
                  completed: false,
                  exception: true,
                }),
                !active && "opacity-70"
              )}
              data-current={currentState === state ? "true" : undefined}
              data-testid={`drive-exception-${state}`}
            >
              <div className="text-xs font-semibold">
                {driveStateLabel(locale, state)}
              </div>
              <div className="mt-1 text-[11px] leading-4 opacity-75">
                {detail ??
                  (active
                    ? t(locale, "异常状态已触发", "Exception state is active")
                    : t(locale, "未触发", "Not active"))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
