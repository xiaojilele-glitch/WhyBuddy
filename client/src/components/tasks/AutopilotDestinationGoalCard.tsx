import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  GitBranch,
  LockKeyhole,
  PencilLine,
  RefreshCw,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type AutopilotDestinationGoalLockState =
  | "unconfirmed"
  | "locked"
  | "modified"
  | "needs-reconfirm";

export type AutopilotDestinationGoalField =
  | "goal"
  | "request"
  | "subGoals"
  | "constraints"
  | "successCriteria"
  | "deliverables";

export type AutopilotDestinationGoalSourceKind =
  | "user"
  | "mission"
  | "parser"
  | "runtime"
  | "planner"
  | "operator"
  | "system";

export interface AutopilotDestinationGoalFieldSource {
  field: AutopilotDestinationGoalField;
  source: AutopilotDestinationGoalSourceKind | string;
  label?: string | null;
  confidence?: "low" | "medium" | "high" | "unknown" | string | null;
}

export type AutopilotDestinationRouteImpactKind =
  | "none"
  | "route-replan"
  | "route-lock-risk"
  | "route-confirmation";

export interface AutopilotDestinationRouteImpact {
  kind: AutopilotDestinationRouteImpactKind;
  summary?: string | null;
  fromRouteId?: string | null;
  toRouteId?: string | null;
  affectedStageCount?: number | null;
  requiresConfirmation?: boolean | null;
}

export interface AutopilotDestinationGoalCardInput {
  id?: string | null;
  goal: string;
  request?: string | null;
  subGoals?: string[];
  constraints?: string[];
  successCriteria?: string[];
  deliverables?: string[];
  fieldSources?: AutopilotDestinationGoalFieldSource[];
  lockState?: AutopilotDestinationGoalLockState;
  confirmedAt?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
  missingInfo?: string[];
  routeImpact?: AutopilotDestinationRouteImpact | null;
}

export interface AutopilotDestinationGoalViewModel {
  id?: string | null;
  goal: string;
  request: string | null;
  subGoals: string[];
  constraints: string[];
  successCriteria: string[];
  deliverables: string[];
  fieldSources: AutopilotDestinationGoalFieldSource[];
  lockState: AutopilotDestinationGoalLockState;
  lockLabel: string;
  lockPrompt: string;
  sourceSummary: string;
  routeImpact: AutopilotDestinationRouteImpact | null;
  routeImpactLabel: string | null;
  routeImpactPrompt: string | null;
  confirmedAt?: string | null;
  modifiedAt?: string | null;
  modifiedBy?: string | null;
}

export interface AutopilotDestinationGoalEvidenceEvent {
  eventType:
    | "destination.locked"
    | "destination.modified"
    | "destination.reconfirm_requested";
  destinationId?: string | null;
  goal: string;
  summary: string;
  lockState: AutopilotDestinationGoalLockState;
  routeImpactKind?: AutopilotDestinationRouteImpactKind | null;
  occurredAt?: string | null;
}

export interface AutopilotDestinationGoalCardProps {
  destination: AutopilotDestinationGoalCardInput;
  locale?: string;
  className?: string;
}

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function copy(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en;
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return normalizeToken(value)
    .split(" ")
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`)
    .join(" ");
}

function fieldLabel(
  locale: string,
  field: AutopilotDestinationGoalField
): string {
  switch (field) {
    case "goal":
      return copy(locale, "目标", "Goal");
    case "request":
      return copy(locale, "请求", "Request");
    case "subGoals":
      return copy(locale, "子目标", "Sub-goals");
    case "constraints":
      return copy(locale, "约束", "Constraints");
    case "successCriteria":
      return copy(locale, "验收", "Success");
    case "deliverables":
      return copy(locale, "交付物", "Deliverables");
  }
}

function sourceLabel(
  locale: string,
  source: AutopilotDestinationGoalSourceKind | string
): string {
  switch (source) {
    case "user":
      return copy(locale, "用户输入", "User input");
    case "mission":
      return copy(locale, "任务记录", "Mission record");
    case "parser":
      return copy(locale, "目的地解析", "Destination parser");
    case "runtime":
      return copy(locale, "运行时", "Runtime");
    case "planner":
      return copy(locale, "路线规划器", "Route planner");
    case "operator":
      return copy(locale, "操作员", "Operator");
    case "system":
      return copy(locale, "系统", "System");
    default:
      return titleCase(source);
  }
}

function inferLockState(
  destination: AutopilotDestinationGoalCardInput
): AutopilotDestinationGoalLockState {
  if (destination.lockState) return destination.lockState;
  if (destination.missingInfo && destination.missingInfo.length > 0) {
    return "needs-reconfirm";
  }
  if (
    destination.routeImpact?.kind === "route-replan" ||
    destination.routeImpact?.kind === "route-lock-risk"
  ) {
    return "modified";
  }
  if (destination.confirmedAt) return "locked";
  return "unconfirmed";
}

function lockCopy(
  locale: string,
  state: AutopilotDestinationGoalLockState
): { label: string; prompt: string } {
  switch (state) {
    case "locked":
      return {
        label: copy(locale, "目标已锁定", "Goal locked"),
        prompt: copy(
          locale,
          "目的地已确认，路线会围绕该目标继续推进。",
          "The destination is confirmed and the route will continue around this goal."
        ),
      };
    case "modified":
      return {
        label: copy(locale, "目标已修改", "Goal modified"),
        prompt: copy(
          locale,
          "目标发生变化，建议检查路线影响后再继续。",
          "The goal changed; review the route impact before continuing."
        ),
      };
    case "needs-reconfirm":
      return {
        label: copy(locale, "需要重确认", "Needs reconfirmation"),
        prompt: copy(
          locale,
          "目的地仍有关键字段待确认，锁定前请补齐或确认。",
          "Key destination fields still need confirmation before locking."
        ),
      };
    case "unconfirmed":
      return {
        label: copy(locale, "等待锁定", "Awaiting lock"),
        prompt: copy(
          locale,
          "确认目标后，自动驾驶会固定目的地并稳定路线选择。",
          "Confirm the goal so autopilot can lock the destination and stabilize route selection."
        ),
      };
  }
}

function routeImpactCopy(
  locale: string,
  impact: AutopilotDestinationRouteImpact | null | undefined
): { label: string | null; prompt: string | null } {
  if (!impact || impact.kind === "none") {
    return { label: null, prompt: null };
  }

  const routeChange =
    impact.fromRouteId && impact.toRouteId
      ? copy(
          locale,
          `路线 ${impact.fromRouteId} -> ${impact.toRouteId}`,
          `Route ${impact.fromRouteId} -> ${impact.toRouteId}`
        )
      : null;
  const stageImpact =
    typeof impact.affectedStageCount === "number" &&
    Number.isFinite(impact.affectedStageCount)
      ? copy(
          locale,
          `影响 ${impact.affectedStageCount} 个阶段`,
          `${impact.affectedStageCount} stage(s) affected`
        )
      : null;
  const detail = [impact.summary, routeChange, stageImpact]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  switch (impact.kind) {
    case "route-replan":
      return {
        label: copy(locale, "路线需要重规划", "Route replan needed"),
        prompt:
          detail ||
          copy(
            locale,
            "目标变化会改变路线选择，请确认后触发重规划。",
            "The goal change may alter route selection; confirm before replanning."
          ),
      };
    case "route-lock-risk":
      return {
        label: copy(locale, "锁定可能影响路线", "Lock may affect route"),
        prompt:
          detail ||
          copy(
            locale,
            "锁定当前目标可能限制后续路线切换。",
            "Locking the current goal may limit later route switching."
          ),
      };
    case "route-confirmation":
      return {
        label: copy(locale, "路线需确认", "Route confirmation needed"),
        prompt:
          detail ||
          copy(
            locale,
            "目标更新后需要重新确认当前路线。",
            "The route needs confirmation after the destination update."
          ),
      };
  }
}

function sourceSummary(
  locale: string,
  sources: AutopilotDestinationGoalFieldSource[]
): string {
  if (sources.length === 0) {
    return copy(locale, "字段来源待记录", "Field sources not recorded");
  }

  const uniqueSources = Array.from(
    new Set(sources.map(source => sourceLabel(locale, source.source)))
  );
  return copy(locale, "字段来源：", "Sources: ") + uniqueSources.join(", ");
}

export function buildAutopilotDestinationGoalViewModel(
  destination: AutopilotDestinationGoalCardInput,
  locale = "en-US"
): AutopilotDestinationGoalViewModel {
  const lockState = inferLockState(destination);
  const lock = lockCopy(locale, lockState);
  const routeImpact = destination.routeImpact ?? null;
  const impact = routeImpactCopy(locale, routeImpact);

  return {
    id: destination.id,
    goal: destination.goal,
    request: destination.request?.replace(/\s+/g, " ").trim() || null,
    subGoals: uniqueNonEmpty(destination.subGoals),
    constraints: uniqueNonEmpty(destination.constraints),
    successCriteria: uniqueNonEmpty(destination.successCriteria),
    deliverables: uniqueNonEmpty(destination.deliverables),
    fieldSources: destination.fieldSources ?? [],
    lockState,
    lockLabel: lock.label,
    lockPrompt: lock.prompt,
    sourceSummary: sourceSummary(locale, destination.fieldSources ?? []),
    routeImpact,
    routeImpactLabel: impact.label,
    routeImpactPrompt: impact.prompt,
    confirmedAt: destination.confirmedAt,
    modifiedAt: destination.modifiedAt,
    modifiedBy: destination.modifiedBy,
  };
}

export function buildAutopilotDestinationGoalEvidenceEvent(
  destination: AutopilotDestinationGoalCardInput,
  locale = "en-US"
): AutopilotDestinationGoalEvidenceEvent {
  const model = buildAutopilotDestinationGoalViewModel(destination, locale);
  const eventType =
    model.lockState === "locked"
      ? "destination.locked"
      : model.lockState === "modified"
        ? "destination.modified"
        : "destination.reconfirm_requested";

  return {
    eventType,
    destinationId: model.id,
    goal: model.goal,
    summary: model.routeImpactPrompt
      ? `${model.lockLabel}: ${model.routeImpactPrompt}`
      : `${model.lockLabel}: ${model.lockPrompt}`,
    lockState: model.lockState,
    routeImpactKind: model.routeImpact?.kind ?? null,
    occurredAt: model.modifiedAt ?? model.confirmedAt ?? null,
  };
}

function LockIcon({ state }: { state: AutopilotDestinationGoalLockState }) {
  if (state === "locked") return <LockKeyhole className="size-4" />;
  if (state === "modified") return <PencilLine className="size-4" />;
  if (state === "needs-reconfirm") return <RefreshCw className="size-4" />;
  return <Compass className="size-4" />;
}

function lockTone(state: AutopilotDestinationGoalLockState): string {
  if (state === "locked") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (state === "modified") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (state === "needs-reconfirm") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function DetailList({
  label,
  values,
}: {
  label: string;
  values: string[];
}) {
  if (values.length === 0) return null;

  return (
    <p className="text-xs leading-5 text-stone-600">
      <span className="font-semibold text-stone-700">{label}:</span>{" "}
      {values.join("; ")}
    </p>
  );
}

export function AutopilotDestinationGoalCard({
  destination,
  locale = "en-US",
  className,
}: AutopilotDestinationGoalCardProps) {
  const model = buildAutopilotDestinationGoalViewModel(destination, locale);
  const showRouteImpact =
    model.routeImpactLabel !== null && model.routeImpactPrompt !== null;

  return (
    <section
      className={cn(
        "workspace-panel overflow-hidden rounded-[18px] border border-amber-100 bg-[linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,247,237,0.78))] p-4 shadow-[0_18px_48px_rgba(146,97,48,0.12)]",
        className
      )}
      data-lock-state={model.lockState}
      data-testid="autopilot-destination-goal-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            {copy(locale, "目的地锁定", "Destination lock")}
          </p>
          <h3 className="mt-1 text-lg font-semibold leading-6 text-stone-950">
            {model.goal}
          </h3>
          {model.request ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {model.request}
            </p>
          ) : null}
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            lockTone(model.lockState)
          )}
        >
          <LockIcon state={model.lockState} />
          {model.lockLabel}
        </span>
      </div>

      <div className="mt-3 rounded-[14px] border border-white/80 bg-white/65 p-3">
        <div className="flex items-start gap-2 text-sm text-stone-700">
          {model.lockState === "locked" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          )}
          <p className="leading-5">{model.lockPrompt}</p>
        </div>
        <p className="mt-2 text-xs font-semibold text-stone-500">
          {model.sourceSummary}
        </p>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <DetailList
          label={fieldLabel(locale, "subGoals")}
          values={model.subGoals}
        />
        <DetailList
          label={fieldLabel(locale, "constraints")}
          values={model.constraints}
        />
        <DetailList
          label={fieldLabel(locale, "successCriteria")}
          values={model.successCriteria}
        />
        <DetailList
          label={fieldLabel(locale, "deliverables")}
          values={model.deliverables}
        />
      </div>

      {model.fieldSources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {model.fieldSources.map((source, index) => (
            <span
              key={`${source.field}:${source.source}:${index}`}
              className="rounded-full border border-amber-200/80 bg-white/75 px-2 py-1 text-[10px] font-semibold text-amber-800"
            >
              {fieldLabel(locale, source.field)} ·{" "}
              {source.label || sourceLabel(locale, source.source)}
              {source.confidence ? ` · ${titleCase(source.confidence)}` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {showRouteImpact ? (
        <div
          className="mt-3 rounded-[14px] border border-orange-200 bg-orange-50/80 p-3 text-sm text-orange-900"
          data-testid="autopilot-destination-route-impact"
        >
          <div className="flex items-center gap-2 font-semibold">
            <GitBranch className="size-4" />
            {model.routeImpactLabel}
          </div>
          <p className="mt-1 text-xs leading-5 text-orange-800">
            {model.routeImpactPrompt}
          </p>
          {model.routeImpact?.requiresConfirmation ? (
            <p className="mt-1 text-xs font-semibold text-orange-900">
              {copy(
                locale,
                "继续前需要重新确认路线。",
                "Route reconfirmation is required before continuing."
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
