import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AutopilotCockpitLayout } from "./AutopilotCockpitLayout";
import {
  AutopilotFleetLiveView,
  type AutopilotFleetRole,
  type AutopilotFleetRoleCard,
  type AutopilotFleetRoleStatus,
} from "./AutopilotFleetLiveView";
import {
  AutopilotTakeoverControlPanel,
  type AutopilotTakeoverItem,
} from "./AutopilotTakeoverControlPanel";

const PANEL_CLASS = "workspace-panel rounded-[16px]";
const BLOCK_CLASS =
  "workspace-panel-inset rounded-[12px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.66)] p-3";

type UnknownRecord = Record<string, unknown>;

type AutopilotBlock = {
  value: string;
  detail?: string | null;
  badge?: string | null;
};

type ParsedAutopilotSummary = {
  destination?: AutopilotBlock | null;
  route?: AutopilotBlock | null;
  execution?: AutopilotBlock | null;
  driveState?: AutopilotBlock | null;
  fleet?: AutopilotBlock | null;
  fleetRoles?: AutopilotFleetRoleCard[];
  fleetLegacyText?: string | null;
  blockers?: AutopilotBlock | null;
  recovery?: AutopilotBlock | null;
  outputs?: AutopilotBlock | null;
  evidence?: AutopilotBlock | null;
  explanation?: AutopilotBlock | null;
  takeover?: AutopilotBlock | null;
  takeoverItems?: AutopilotTakeoverItem[];
  decision?: AutopilotBlock | null;
  costRisk?: AutopilotBlock | null;
};

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}
function t(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getPath(source: unknown, path: string): unknown {
  if (!path) return source;

  const resolvePath = (targetPath: string): unknown =>
    targetPath.split(".").reduce<unknown>((current, key) => {
      if (!isRecord(current)) return undefined;
      return current[key];
    }, source);

  if (path === "destination.constraints") {
    return (
      resolvePath("destination.constraints") ??
      resolvePath("destination.limitations") ??
      resolvePath("destination.requirements.constraints")
    );
  }

  if (path === "destination.successCriteria") {
    return (
      resolvePath("destination.successCriteria") ??
      resolvePath("destination.acceptanceCriteria") ??
      resolvePath("destination.doneCriteria") ??
      resolvePath("destination.requirements.successCriteria")
    );
  }

  return resolvePath(path);
}

function pickText(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const resolved = getPath(source, path);
    const text = asText(resolved);
    if (text) return text;
  }
  return null;
}

function pickBoolean(source: unknown, paths: string[]): boolean | null {
  for (const path of paths) {
    const resolved = getPath(source, path);
    const value = asBoolean(resolved);
    if (value !== null) return value;
  }
  return null;
}

function pickNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const resolved = getPath(source, path);
    const value = asNumber(resolved);
    if (value !== null) return value;
  }
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = value ? normalizeText(value) : null;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function textListFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.flatMap(item => {
        const directText = asText(item);
        if (directText) return [directText];
        if (!isRecord(item)) return [];

        return uniqueStrings([
          pickText(item, [
            "label",
            "title",
            "name",
            "summary",
            "value",
            "item",
            "text",
            "question",
            "objective",
            "detail",
            "filename",
            "fileName",
            "path",
            "url",
            "currentFocus",
          ]),
          pickText(item, [
            "description",
            "reason",
            "request",
            "goal",
            "prompt",
            "currentAction",
            "nextStep",
            "recovery",
            "resolution",
          ]),
        ]);
      })
    );
  }

  const directText = asText(value);
  return directText ? [directText] : [];
}

function collectTexts(source: unknown, paths: string[]): string[] {
  return uniqueStrings(
    paths.flatMap(path => textListFromValue(getPath(source, path)))
  );
}

function formatKeyLabel(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return value;

  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`)
    .join(" ");
}

function summarizeList(
  values: string[],
  maxItems = 2,
  joiner = "; "
): string | null {
  const normalized = uniqueStrings(values);
  if (normalized.length === 0) return null;

  const visible = normalized.slice(0, maxItems).join(joiner);
  const hiddenCount = normalized.length - maxItems;
  return hiddenCount > 0 ? `${visible}${joiner}+${hiddenCount}` : visible;
}

function prefixedSegment(
  label: string,
  values: string[],
  maxItems = 2
): string | null {
  const summary = summarizeList(values, maxItems);
  return summary ? `${label}: ${summary}` : null;
}

function joinSegments(values: Array<string | null | undefined>): string | null {
  const segments = uniqueStrings(values);
  return segments.length > 0 ? segments.join(" | ") : null;
}

function formatCountSummary(
  locale: string,
  count: number,
  zhUnit: string,
  enSingular: string,
  enPlural = `${enSingular}s`
): string {
  return t(
    locale,
    `${count} ${zhUnit}`,
    `${count} ${count === 1 ? enSingular : enPlural}`
  );
}

function localizeRouteMode(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "fast":
      return t(locale, "\u5feb\u901f", "Fast");
    case "standard":
      return t(locale, "\u6807\u51c6", "Standard");
    case "deep":
      return t(locale, "\u6df1\u5ea6", "Deep");
    case "custom":
      return t(locale, "\u81ea\u5b9a\u4e49", "Custom");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRouteStatus(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "pending":
      return t(locale, "\u5f85\u5f00\u59cb", "Pending");
    case "running":
      return t(locale, "\u8fdb\u884c\u4e2d", "Running");
    case "completed":
      return t(locale, "\u5df2\u5b8c\u6210", "Completed");
    case "completed_with_errors":
      return t(locale, "\u5e26\u5f02\u5e38\u5b8c\u6210", "Completed With Errors");
    case "failed":
      return t(locale, "\u5931\u8d25", "Failed");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRouteSelectionStatus(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "recommended":
      return t(locale, "Recommended", "Recommended");
    case "alternatives-available":
      return t(locale, "Alternatives Available", "Alternatives Available");
    case "user-selected":
      return t(locale, "User Selected", "User Selected");
    case "locked":
      return t(locale, "Locked", "Locked");
    case "replanned":
      return t(locale, "Replanned", "Replanned");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRouteSelectionMode(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "planner_default":
      return t(locale, "Planner Default", "Planner Default");
    case "user_selected":
      return t(locale, "User Selected", "User Selected");
    case "runtime_replanned":
      return t(locale, "Runtime Replanned", "Runtime Replanned");
    case "system_downgraded":
      return t(locale, "System Downgraded", "System Downgraded");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRouteChangeActor(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "planner":
      return t(locale, "Planner", "Planner");
    case "user":
      return t(locale, "User", "User");
    case "runtime":
      return t(locale, "Runtime", "Runtime");
    case "operator":
      return t(locale, "Operator", "Operator");
    default:
      return formatKeyLabel(value);
  }
}

function localizeDestinationTaskType(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "analysis":
      return t(locale, "Analysis", "Analysis");
    case "research":
      return t(locale, "Research", "Research");
    case "generation":
      return t(locale, "Generation", "Generation");
    case "transformation":
      return t(locale, "Transformation", "Transformation");
    case "implementation":
      return t(locale, "Implementation", "Implementation");
    case "coordination":
      return t(locale, "Coordination", "Coordination");
    case "mixed":
      return t(locale, "Mixed", "Mixed");
    case "unknown":
      return t(locale, "Unknown", "Unknown");
    default:
      return formatKeyLabel(value);
  }
}

function localizeDestinationLockState(locale: string, value: string): string {
  switch (value.trim().toLowerCase().replace(/[\s_]+/g, "-")) {
    case "locked":
    case "confirmed":
    case "goal-locked":
      return t(locale, "Goal Locked", "Goal Locked");
    case "modified":
    case "changed":
    case "updated":
      return t(locale, "Goal Modified", "Goal Modified");
    case "needs-reconfirm":
    case "needs-reconfirmation":
    case "needs-clarification":
    case "requires-confirmation":
    case "missing-info":
      return t(locale, "Needs Reconfirmation", "Needs Reconfirmation");
    case "unconfirmed":
    case "draft":
    case "pending":
      return t(locale, "Awaiting Lock", "Awaiting Lock");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRouteEvidenceEventType(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "route.recommended":
      return t(locale, "Route Recommended", "Route Recommended");
    case "route.selected":
      return t(locale, "Route Selected", "Route Selected");
    case "route.locked":
      return t(locale, "Route Locked", "Route Locked");
    case "route.replanned":
      return t(locale, "Route Replanned", "Route Replanned");
    default:
      return formatKeyLabel(value);
  }
}

function localizeDriveState(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "understanding":
      return t(locale, "\u7406\u89e3\u4e2d", "Understanding");
    case "clarifying":
      return t(locale, "\u6f84\u6e05\u4e2d", "Clarifying");
    case "planning":
      return t(locale, "\u89c4\u5212\u4e2d", "Planning");
    case "fleet-forming":
      return t(locale, "\u7f16\u961f\u4e2d", "Fleet Forming");
    case "executing":
      return t(locale, "\u6267\u884c\u4e2d", "Executing");
    case "reviewing":
      return t(locale, "\u590d\u6838\u4e2d", "Reviewing");
    case "blocked":
      return t(locale, "\u963b\u585e", "Blocked");
    case "takeover-required":
      return t(locale, "\u9700\u8981\u63a5\u7ba1", "Takeover Required");
    case "replanning":
      return t(locale, "\u91cd\u65b0\u89c4\u5212\u4e2d", "Replanning");
    case "delivered":
      return t(locale, "\u5df2\u4ea4\u4ed8", "Delivered");
    default:
      return formatKeyLabel(value);
  }
}

function localizeFleetRole(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "planner":
      return t(locale, "\u89c4\u5212\u8005", "Planner");
    case "clarifier":
      return t(locale, "\u6f84\u6e05\u8005", "Clarifier");
    case "researcher":
      return t(locale, "\u7814\u7a76\u8005", "Researcher");
    case "generator":
      return t(locale, "\u751f\u6210\u8005", "Generator");
    case "reviewer":
      return t(locale, "\u590d\u6838\u8005", "Reviewer");
    case "auditor":
      return t(locale, "\u5ba1\u8ba1\u8005", "Auditor");
    case "operator":
      return t(locale, "\u64cd\u4f5c\u5458", "Operator");
    case "executor":
      return t(locale, "\u6267\u884c\u8005", "Executor");
    case "custom":
      return t(locale, "\u81ea\u5b9a\u4e49\u89d2\u8272", "Custom Role");
    default:
      return formatKeyLabel(value);
  }
}

function localizeTakeoverType(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "clarification":
      return t(locale, "\u6f84\u6e05", "Clarification");
    case "approval":
      return t(locale, "\u5ba1\u6279", "Approval");
    case "permission":
      return t(locale, "\u6743\u9650", "Permission");
    case "budget":
      return t(locale, "\u9884\u7b97", "Budget");
    case "risk-acceptance":
      return t(locale, "\u98ce\u9669\u63a5\u53d7", "Risk Acceptance");
    case "route-selection":
      return t(locale, "\u8def\u7ebf\u9009\u62e9", "Route Selection");
    case "delivery-review":
      return t(locale, "\u4ea4\u4ed8\u590d\u6838", "Delivery Review");
    case "exception":
      return t(locale, "\u5f02\u5e38", "Exception");
    case "operator":
      return t(locale, "\u64cd\u4f5c\u5458", "Operator");
    default:
      return formatKeyLabel(value);
  }
}

function localizeTakeoverStatus(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "pending":
      return t(locale, "\u5f85\u5904\u7406", "Pending");
    case "required":
      return t(locale, "\u5fc5\u9700", "Required");
    case "resolved":
      return t(locale, "\u5df2\u89e3\u51b3", "Resolved");
    case "advisory":
      return t(locale, "\u5efa\u8bae", "Advisory");
    default:
      return formatKeyLabel(value);
  }
}

function localizeFleetStatus(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "idle":
      return t(locale, "\u7a7a\u95f2", "Idle");
    case "running":
      return t(locale, "\u8fd0\u884c\u4e2d", "Running");
    case "waiting":
      return t(locale, "\u7b49\u5f85\u4e2d", "Waiting");
    case "blocked":
      return t(locale, "\u5df2\u963b\u585e", "Blocked");
    case "failed":
      return t(locale, "\u5df2\u5931\u8d25", "Failed");
    case "done":
      return t(locale, "\u5df2\u5b8c\u6210", "Done");
    default:
      return formatKeyLabel(value);
  }
}

function localizeScale(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "low":
      return t(locale, "\u4f4e", "Low");
    case "medium":
      return t(locale, "\u4e2d", "Medium");
    case "high":
      return t(locale, "\u9ad8", "High");
    case "unknown":
      return t(locale, "\u672a\u77e5", "Unknown");
    default:
      return formatKeyLabel(value);
  }
}

function localizeRecoveryState(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "healthy":
      return t(locale, "健康", "Healthy");
    case "watching":
      return t(locale, "Watching", "Watching");
    case "recovering":
      return t(locale, "Recovering", "Recovering");
    case "takeover-required":
      return t(locale, "Takeover Required", "Takeover Required");
    case "escalated":
      return t(locale, "Escalated", "Escalated");
    default:
      return formatKeyLabel(value);
  }
}

function localizeDeviationCategory(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "none":
      return t(locale, "无偏航", "No Deviation");
    case "goal-deviation":
      return t(locale, "目标偏航", "Goal Deviation");
    case "route-deviation":
      return t(locale, "路线偏航", "Route Deviation");
    case "quality-deviation":
      return t(locale, "质量偏航", "Quality Deviation");
    case "governance-deviation":
      return t(locale, "治理偏航", "Governance Deviation");
    case "dependency-failure":
      return t(locale, "依赖失败", "Dependency Failure");
    case "state-block":
      return t(locale, "State Block", "State Block");
    case "recovery-exhausted":
      return t(locale, "恢复耗尽", "Recovery Exhausted");
    default:
      return formatKeyLabel(value);
  }
}

function localizeEvidenceTrust(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "verified":
      return t(locale, "Verified", "Verified");
    case "partial":
      return t(locale, "部分验证", "Partial");
    case "unverified":
      return t(locale, "Unverified", "Unverified");
    case "redacted":
      return t(locale, "Redacted", "Redacted");
    default:
      return formatKeyLabel(value);
  }
}

function localizeTimelineEventType(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "drive_state_change":
      return t(locale, "Drive State", "Drive State");
    case "decision":
      return t(locale, "Decision", "Decision");
    case "route_change":
      return t(locale, "Route Change", "Route Change");
    case "takeover":
      return t(locale, "Takeover", "Takeover");
    case "tool_call":
      return t(locale, "Tool Call", "Tool Call");
    case "result":
      return t(locale, "Result", "Result");
    case "operator_action":
      return t(locale, "Operator Action", "Operator Action");
    case "system":
      return t(locale, "System", "System");
    default:
      return formatKeyLabel(value);
  }
}

function localizeTimelineStatus(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "info":
      return t(locale, "信息", "Info");
    case "running":
      return t(locale, "Running", "Running");
    case "waiting":
      return t(locale, "Waiting", "Waiting");
    case "blocked":
      return t(locale, "Blocked", "Blocked");
    case "done":
      return t(locale, "Done", "Done");
    case "failed":
      return t(locale, "失败", "Failed");
    default:
      return formatKeyLabel(value);
  }
}

function projectionSource(source: unknown): unknown {
  const directProjection = getPath(source, "takeover.projection");
  if (isRecord(directProjection)) return directProjection;

  const submittedProjection = getPath(source, "takeover.submittedProjection");
  if (isRecord(submittedProjection)) return submittedProjection;

  const postSubmitProjection = getPath(source, "takeover.postSubmitProjection");
  if (isRecord(postSubmitProjection)) return postSubmitProjection;

  return null;
}

function localizeControlAction(locale: string, value: string): string {
  switch (value.trim().toLowerCase()) {
    case "run":
      return t(locale, "Run", "Run");
    case "wait":
      return t(locale, "Wait", "Wait");
    case "resume":
      return t(locale, "Resume", "Resume");
    case "retry":
      return t(locale, "Retry", "Retry");
    case "escalate":
      return t(locale, "Escalate", "Escalate");
    case "terminate":
      return t(locale, "Terminate", "Terminate");
    case "replan":
      return t(locale, "Replan", "Replan");
    default:
      return formatKeyLabel(value);
  }
}

function recordListFromPaths(source: unknown, paths: string[]): UnknownRecord[] {
  for (const path of paths) {
    const candidate = getPath(source, path);
    if (!Array.isArray(candidate)) continue;
    return candidate.filter(isRecord);
  }

  return [];
}

function roleRecordsFromSummary(source: unknown): UnknownRecord[] {
  const candidates = [
    getPath(source, "fleet.roles"),
    getPath(source, "fleet.fleetRoles"),
    getPath(source, "fleetRoles"),
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter(isRecord);
  }

  return [];
}

function roleDisplayLabel(item: UnknownRecord, locale: string): string | null {
  const title = pickText(item, ["title", "label", "name"]);
  if (title) return title;

  const roleType = pickText(item, ["roleType", "type"]);
  if (!roleType) return null;

  return roleType
    .split("/")
    .map(part => localizeFleetRole(locale, part))
    .join(" / ");
}

function roleTitlesFromSummary(source: unknown, locale: string): string[] {
  return uniqueStrings(
    roleRecordsFromSummary(source).map(item => roleDisplayLabel(item, locale))
  ).slice(0, 3);
}

function roleHighlightsFromSummary(
  source: unknown,
  locale: string,
  statuses?: string[]
): string[] {
  return uniqueStrings(
    roleRecordsFromSummary(source)
      .filter(item => {
        if (!statuses || statuses.length === 0) return true;
        const status = pickText(item, ["status"]);
        return Boolean(status && statuses.includes(status));
      })
      .map(item => {
        const name = roleDisplayLabel(item, locale);
        const focus = pickText(item, ["currentFocus", "focus", "currentAction"]);
        const status = pickText(item, ["status"]);

        if (name && focus) return `${name}: ${focus}`;
        if (name && status) {
          return `${name} (${localizeFleetStatus(locale, status)})`;
        }
        return name || focus || (status ? localizeFleetStatus(locale, status) : null);
      })
  ).slice(0, 3);
}

function boundEntityLabelsFromSummary(source: unknown): string[] {
  return uniqueStrings(
    roleRecordsFromSummary(source).flatMap(item => [
      ...textListFromValue(getPath(item, "boundAgents")),
      ...textListFromValue(getPath(item, "boundExecutors")),
    ])
  ).slice(0, 3);
}

function readFleetRoleType(value: string | null): AutopilotFleetRole {
  switch (value?.trim().toLowerCase()) {
    case "clarifier":
      return "clarifier";
    case "researcher":
      return "researcher";
    case "generator":
      return "generator";
    case "reviewer":
      return "reviewer";
    case "auditor":
      return "auditor";
    case "operator":
    case "executor":
      return "operator";
    case "planner":
    default:
      return "planner";
  }
}

function inferFleetRoleType(item: UnknownRecord): AutopilotFleetRole {
  return readFleetRoleType(
    pickText(item, ["roleType", "type", "role", "title", "label", "name"])
  );
}

function readFleetRoleStatus(value: string | null): AutopilotFleetRoleStatus {
  switch (value?.trim().toLowerCase()) {
    case "running":
    case "working":
      return "running";
    case "waiting":
      return "waiting";
    case "blocked":
      return "blocked";
    case "failed":
    case "error":
      return "failed";
    case "done":
    case "completed":
      return "done";
    case "idle":
    default:
      return "idle";
  }
}

function buildFleetRoleCardsFromSummary(source: unknown): AutopilotFleetRoleCard[] {
  return roleRecordsFromSummary(source).map((item, index) => {
    const role = inferFleetRoleType(item);
    const status = readFleetRoleStatus(pickText(item, ["status", "state"]));
    const id =
      pickText(item, ["id", "roleId", "key"]) ??
      `${role}-${index + 1}`;
    const currentFocus = pickText(item, [
      "currentFocus",
      "focus",
      "currentAction",
      "responsibility",
    ]);

    return {
      id,
      role,
      title: pickText(item, ["title", "label", "name"]) ?? undefined,
      status,
      currentFocus,
      currentAction: pickText(item, ["currentAction", "action"]),
      waitingReason: pickText(item, ["waitingReason", "waitingFor", "reason"]),
      latestArtifact: pickText(item, [
        "latestArtifact",
        "latestDeliverable",
        "artifact",
      ]),
      boundAgents: uniqueStrings([
        ...textListFromValue(getPath(item, "boundAgents")),
        ...textListFromValue(getPath(item, "boundExecutors")),
      ]),
      laneId: pickText(item, ["laneId", "lane"]),
      laneLabel: pickText(item, ["laneLabel", "laneName"]),
      takeoverAnchorId: pickText(item, [
        "takeoverAnchorId",
        "takeoverId",
        "decisionId",
      ]),
    };
  });
}

function buildFleetLegacyText(source: unknown, locale: string): string | null {
  const roleTitles = roleTitlesFromSummary(source, locale);
  const activeRoles = roleHighlightsFromSummary(source, locale, [
    "running",
    "waiting",
  ]);
  const blockedRoles = roleHighlightsFromSummary(source, locale, [
    "blocked",
    "failed",
  ]);

  return joinSegments([
    roleTitles.length > 0 ? roleTitles.join(" / ") : null,
    buildFleetCountText(source, locale),
    prefixedSegment(t(locale, "\u5728\u7ebf", "Live"), activeRoles),
    prefixedSegment(t(locale, "\u963b\u585e", "Blocked"), blockedRoles),
  ]);
}

function executionActionLabelsFromSummary(
  source: unknown,
  locale: string
): string[] {
  return uniqueStrings(
    recordListFromPaths(source, [
      "execution.availableActions",
      "currentExecution.availableActions",
      "liveExecution.availableActions",
    ]).map(item => {
      const action =
        pickText(item, ["type"]) || pickText(item, ["label"]) || null;
      return action ? localizeControlAction(locale, action) : null;
    })
  ).slice(0, 4);
}

function buildFleetCountText(source: unknown, locale: string): string | null {
  const activeCount = pickNumber(source, ["fleet.activeRoleCount"]);
  const blockedCount = pickNumber(source, ["fleet.blockedRoleCount"]);
  const roleCount = roleRecordsFromSummary(source).length || null;

  if (activeCount !== null || blockedCount !== null) {
    return joinSegments([
      activeCount !== null
        ? t(
            locale,
            `${activeCount} \u4e2a\u6d3b\u8dc3\u89d2\u8272`,
            `${activeCount} active`
          )
        : null,
      blockedCount !== null
        ? t(
            locale,
            `${blockedCount} \u4e2a\u963b\u585e\u89d2\u8272`,
            `${blockedCount} blocked`
          )
        : null,
      roleCount !== null
        ? t(locale, `${roleCount} \u4e2a\u89d2\u8272`, `${roleCount} roles`)
        : null,
    ]);
  }

  if (roleCount !== null) {
    return t(locale, `${roleCount} \u4e2a\u89d2\u8272`, `${roleCount} roles`);
  }

  return null;
}

function currentStageRecord(source: unknown): UnknownRecord | null {
  const directStage = getPath(source, "route.currentStage");
  if (isRecord(directStage)) return directStage;

  const stages = recordListFromPaths(source, [
    "route.stages",
    "execution.stages",
    "currentExecution.stages",
    "liveExecution.stages",
  ]);

  for (const stage of stages) {
    const isCurrent = asBoolean(getPath(stage, "isCurrent"));
    const status = pickText(stage, ["status"]);
    if (isCurrent || status === "running") {
      return stage;
    }
  }

  return stages[0] ?? null;
}

function routeCurrentStageLabel(source: unknown): string | null {
  const directLabel = pickText(source, [
    "route.currentStageLabel",
    "route.currentStage.label",
    "route.currentStageLabelText",
    "selectedRoute.currentStageLabel",
  ]);

  if (directLabel) return directLabel;

  const stages = getPath(source, "route.stages");
  if (!Array.isArray(stages)) return null;

  for (const stage of stages) {
    if (!isRecord(stage)) continue;
    const isCurrent = asBoolean(stage.isCurrent);
    const status = pickText(stage, ["status"]);

    if (isCurrent || status === "running") {
      return pickText(stage, ["label", "title", "name"]);
    }
  }

  return null;
}

function routeCurrentStageDetail(source: unknown): string | null {
  const stage = currentStageRecord(source);
  if (!stage) return null;

  return pickText(stage, ["detail", "summary", "reason", "description"]);
}

function routeCandidateRecordsFromSummary(source: unknown): UnknownRecord[] {
  return recordListFromPaths(source, [
    "route.candidateRoutes",
    "route.candidates",
    "candidateRoutes",
  ]);
}
function routeRecordId(item: UnknownRecord | null): string | null {
  if (!item) return null;
  return pickText(item, ["id", "routeId"]);
}

function sameRouteRecord(
  left: UnknownRecord | null,
  right: UnknownRecord | null
): boolean {
  if (!left || !right) return false;

  const leftId = routeRecordId(left);
  const rightId = routeRecordId(right);
  if (leftId && rightId) {
    return leftId === rightId;
  }

  return (
    pickText(left, ["label", "title", "name"]) ===
    pickText(right, ["label", "title", "name"])
  );
}

function routeSelectionRecord(source: unknown): UnknownRecord | null {
  const directSelected = getPath(source, "route.selected");
  if (isRecord(directSelected)) return directSelected;

  const topLevelSelected = getPath(source, "selectedRoute");
  if (isRecord(topLevelSelected)) return topLevelSelected;

  const selectedRouteId = pickText(source, [
    "route.selectedRouteId",
    "selectedRouteId",
  ]);
  const candidates = routeCandidateRecordsFromSummary(source);

  if (selectedRouteId) {
    const matched = candidates.find(
      candidate => routeRecordId(candidate) === selectedRouteId
    );
    if (matched) return matched;
  }

  return (
    candidates.find(candidate => pickBoolean(candidate, ["selected"]) === true) ||
    null
  );
}

function routeRecordById(source: unknown, routeId: string): UnknownRecord | null {
  const selected = routeSelectionRecord(source);
  if (selected && routeRecordId(selected) === routeId) {
    return selected;
  }

  const recommended = recommendedRouteRecord(source);
  if (recommended && routeRecordId(recommended) === routeId) {
    return recommended;
  }

  return (
    routeCandidateRecordsFromSummary(source).find(
      candidate => routeRecordId(candidate) === routeId
    ) || null
  );
}

function formatRouteReference(
  source: unknown,
  routeId: string | null,
  locale: string
): string | null {
  if (!routeId) return null;

  const record = routeRecordById(source, routeId);
  const label = record ? pickText(record, ["label", "title", "name"]) : null;
  const summary = record
    ? pickText(record, ["summary", "recommendationReason", "reason", "description"])
    : null;
  const display = label || summary || routeId;

  return display === routeId ? routeId : `${display} (${routeId})`;
}

function recommendedRouteRecord(source: unknown): UnknownRecord | null {
  const recommendedRouteId = pickText(source, [
    "route.recommendedRouteId",
    "recommendedRouteId",
  ]);
  const candidates = routeCandidateRecordsFromSummary(source);

  if (recommendedRouteId) {
    const matched = candidates.find(
      candidate => routeRecordId(candidate) === recommendedRouteId
    );
    if (matched) return matched;
  }

  return (
    candidates.find(
      candidate =>
        pickBoolean(candidate, ["recommended", "isRecommended"]) === true
    ) ||
    null
  );
}

function formatRouteCandidate(item: UnknownRecord, locale: string): string | null {
  const label = pickText(item, ["label", "title", "name"]);
  const summary = pickText(item, [
    "summary",
    "recommendationReason",
    "reason",
    "description",
  ]);
  const mode = pickText(item, ["mode"]);
  const status = pickText(item, ["status"]);
  const riskLevel = pickText(item, ["riskLevel"]);
  const takeoverLoad = pickText(item, [
    "takeoverLoad",
    "estimatedTakeovers.label",
    "estimatedTakeovers.relativeLevel",
  ]);
  const estimatedDuration = pickText(item, [
    "estimatedDuration",
    "estimatedDuration.label",
  ]);
  const estimatedCost = pickText(item, [
    "estimatedCost",
    "estimatedCost.label",
    "estimatedCost.relativeLevel",
  ]);
  const locked = pickBoolean(item, ["locked"]);
  const meta = uniqueStrings([
    mode ? localizeRouteMode(locale, mode) : null,
    status ? localizeRouteStatus(locale, status) : null,
    riskLevel
      ? `${t(locale, "风险", "Risk")}: ${localizeScale(locale, riskLevel)}`
      : null,
    takeoverLoad
      ? `${t(locale, "负担", "Load")}: ${localizeScale(locale, takeoverLoad)}`
      : null,
    estimatedDuration
      ? `${t(locale, "时长", "ETA")}: ${estimatedDuration}`
      : null,
    estimatedCost ? `${t(locale, "成本", "Cost")}: ${estimatedCost}` : null,
    locked ? t(locale, "Locked", "Locked") : null,
  ]);

  const base = label || summary;
  if (!base) return null;

  const metaText = meta.length > 0 ? `(${meta.join(", ")})` : null;
  if (summary && summary !== label) {
    return [base, metaText, `- ${summary}`].filter(Boolean).join(" ");
  }

  return [base, metaText].filter(Boolean).join(" ");
}

function parseDurationToMinutes(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  let totalMinutes = 0;
  let matched = false;

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?/g)) {
    totalMinutes += Number(match[1]) * 60;
    matched = true;
  }

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/g)) {
    totalMinutes += Number(match[1]);
    matched = true;
  }

  if (matched) {
    return totalMinutes;
  }

  const plainNumber = normalized.match(/^(\d+(?:\.\d+)?)$/);
  return plainNumber ? Number(plainNumber[1]) : null;
}

function parseCostToNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function buildComparableRange(
  values: string[],
  parser: (value: string) => number | null
): string | null {
  const parsed = values
    .map(display => ({
      display,
      value: parser(display),
    }))
    .filter(
      (item): item is { display: string; value: number } => item.value !== null
    );

  if (parsed.length !== values.length || parsed.length === 0) {
    return null;
  }

  parsed.sort((left, right) => left.value - right.value);
  const first = parsed[0]?.display || null;
  const last = parsed[parsed.length - 1]?.display || null;
  if (!first || !last) return null;
  return first === last ? first : `${first} -> ${last}`;
}

function summarizeRouteMetric(
  locale: string,
  labelZh: string,
  labelEn: string,
  selectedValue: string | null,
  values: Array<string | null | undefined>,
  parser: (value: string) => number | null
): string | null {
  const uniqueValues = uniqueStrings([
    selectedValue,
    ...values,
  ]);
  if (uniqueValues.length === 0) return null;

  const range = buildComparableRange(uniqueValues, parser);
  if (selectedValue && range && range !== selectedValue) {
    return `${labelEn} Summary: Selected ${selectedValue} (${range} range)`;
  }

  if (range) {
    return `${labelEn} Summary: ${range}`;
  }

  const summarized = summarizeList(uniqueValues, 3, " / ");
  if (!summarized) return null;
  return `${labelEn} Summary: ${summarized}`;
}

function summarizeRouteDifferences(
  locale: string,
  selectedCandidate: UnknownRecord | null,
  recommendedCandidate: UnknownRecord | null
): string | null {
  if (!selectedCandidate || !recommendedCandidate) return null;
  if (sameRouteRecord(selectedCandidate, recommendedCandidate)) return null;

  const selectedMode = pickText(selectedCandidate, ["mode"]);
  const recommendedMode = pickText(recommendedCandidate, ["mode"]);
  const selectedRisk = pickText(selectedCandidate, ["riskLevel"]);
  const recommendedRisk = pickText(recommendedCandidate, ["riskLevel"]);
  const selectedLoad = pickText(selectedCandidate, [
    "takeoverLoad",
    "estimatedTakeovers.label",
    "estimatedTakeovers.relativeLevel",
  ]);
  const recommendedLoad = pickText(recommendedCandidate, [
    "takeoverLoad",
    "estimatedTakeovers.label",
    "estimatedTakeovers.relativeLevel",
  ]);
  const selectedEta = pickText(selectedCandidate, [
    "estimatedDuration",
    "estimatedDuration.label",
  ]);
  const recommendedEta = pickText(recommendedCandidate, [
    "estimatedDuration",
    "estimatedDuration.label",
  ]);
  const selectedCost = pickText(selectedCandidate, [
    "estimatedCost",
    "estimatedCost.label",
    "estimatedCost.relativeLevel",
  ]);
  const recommendedCost = pickText(recommendedCandidate, [
    "estimatedCost",
    "estimatedCost.label",
    "estimatedCost.relativeLevel",
  ]);

  const differences = uniqueStrings([
    selectedMode && recommendedMode && selectedMode !== recommendedMode
      ? `${t(locale, "Mode", "Mode")}: ${localizeRouteMode(
          locale,
          selectedMode
        )} -> ${localizeRouteMode(locale, recommendedMode)}`
      : null,
    selectedRisk && recommendedRisk && selectedRisk !== recommendedRisk
      ? `${t(locale, "Risk", "Risk")}: ${localizeScale(
          locale,
          selectedRisk
        )} -> ${localizeScale(locale, recommendedRisk)}`
      : null,
    selectedLoad && recommendedLoad && selectedLoad !== recommendedLoad
      ? `${t(locale, "Load", "Load")}: ${localizeScale(
          locale,
          selectedLoad
        )} -> ${localizeScale(locale, recommendedLoad)}`
      : null,
    selectedEta && recommendedEta && selectedEta !== recommendedEta
      ? `${t(locale, "ETA", "ETA")}: ${selectedEta} -> ${recommendedEta}`
      : null,
    selectedCost && recommendedCost && selectedCost !== recommendedCost
      ? `${t(locale, "Cost", "Cost")}: ${selectedCost} -> ${recommendedCost}`
      : null,
  ]);

  if (differences.length === 0) return null;
  return `${t(locale, "Route Diff", "Route Diff")}: ${differences.join("; ")}`;
}

function takeoverOptionLabels(source: unknown): string[] {
  const options = getPath(source, "takeover.options");
  if (!Array.isArray(options)) return [];

  return uniqueStrings(
    options.flatMap(option => {
      const directText = asText(option);
      if (directText) return [directText];
      if (!isRecord(option)) return [];

      const label = pickText(option, ["label", "title", "name"]);
      const description = pickText(option, ["description", "detail", "summary"]);
      const combined =
        label && description ? `${label}: ${description}` : label || description;

      return combined ? [combined] : [];
    })
  );
}

function outputLabelsFromSummary(source: unknown): string[] {
  return uniqueStrings([
    ...collectTexts(source, ["destination.deliverables", "outputs.deliverables"]),
    ...collectTexts(source, [
      "outputs.items",
      "intermediateOutputs.items",
      "outputs.artifacts",
      "intermediateArtifacts",
      "artifacts.items",
      "artifacts",
    ]),
  ]);
}

function blockerLabelsFromSummary(source: unknown): string[] {
  return uniqueStrings([
    ...collectTexts(source, [
      "route.riskPoints",
      "blockers.items",
      "blockers.reasons",
      "blockingPoints",
      "waitingPoints",
    ]),
    ...recordListFromPaths(source, ["blockers.items"]).map(item =>
      joinSegments([
        pickText(item, ["label", "title", "name", "reason", "summary"]),
        pickText(item, ["recovery", "resolution", "nextStep"]),
      ])
    ),
  ]);
}

function routeTakeoverPointCount(source: unknown): number {
  const takeoverPointIds = getPath(source, "route.takeoverPointIds");
  if (Array.isArray(takeoverPointIds)) {
    return takeoverPointIds.filter(value => value !== null && value !== undefined)
      .length;
  }

  return asText(takeoverPointIds) ? 1 : 0;
}

function routeRemainingStepLabels(source: unknown): string[] {
  const pendingSteps = recordListFromPaths(source, [
    "explanation.remainingSteps.pendingSteps",
  ]);
  const pendingLabels = uniqueStrings(
    pendingSteps
      .filter(step => pickBoolean(step, ["isCurrent"]) !== true)
      .map(step => pickText(step, ["label", "title", "name"]))
  );
  if (pendingLabels.length > 0) {
    return pendingLabels;
  }

  const currentStepKey = pickText(source, [
    "explanation.remainingSteps.currentStepKey",
    "route.currentStageKey",
  ]);
  const mainlineSteps = recordListFromPaths(source, [
    "explanation.remainingSteps.mainlineSteps",
    "route.stages",
  ]);

  return uniqueStrings(
    mainlineSteps
      .filter(step => {
        const key = pickText(step, ["key", "id"]);
        const isCurrent =
          pickBoolean(step, ["isCurrent"]) === true ||
          (currentStepKey !== null && key === currentStepKey);
        if (isCurrent) return false;

        const status = pickText(step, ["status"]);
        return status !== "done" && status !== "failed";
      })
      .map(step => pickText(step, ["label", "title", "name"]))
  );
}

function routeRemainingStepsSummary(source: unknown, locale: string): string | null {
  const remainingLabels = routeRemainingStepLabels(source);
  const remainingCount = remainingLabels.length;
  const parallelBranchCount = pickNumber(source, [
    "explanation.remainingSteps.parallelBranchCount",
  ]);
  const replanChangeSummary = pickText(source, [
    "explanation.remainingSteps.replanChangeSummary",
  ]);

  return joinSegments([
    remainingCount > 0
      ? t(
          locale,
          `${remainingCount} steps left`,
          `${remainingCount} ${remainingCount === 1 ? "step" : "steps"} left`
        )
      : null,
    prefixedSegment(t(locale, "Remaining Steps", "Remaining Steps"), remainingLabels),
    parallelBranchCount !== null && parallelBranchCount > 0
      ? t(
          locale,
          `${parallelBranchCount} parallel branches remain`,
          `${parallelBranchCount} parallel ${
            parallelBranchCount === 1 ? "branch" : "branches"
          } remain`
        )
      : null,
    replanChangeSummary
      ? `${t(locale, "计划变更", "Plan Change")}: ${replanChangeSummary}`
      : null,
  ]);
}

function formatTimestamp(locale: string, value: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function createBlock(input: {
  value?: string | null;
  detail?: string | null;
  badge?: string | null;
}): AutopilotBlock | null {
  let value = input.value ? normalizeText(input.value) : null;
  let detail = input.detail ? normalizeText(input.detail) : null;
  let badge = input.badge ? normalizeText(input.badge) : null;

  if (!value && detail) {
    value = detail;
    detail = null;
  }

  if (!value && badge) {
    value = badge;
    badge = null;
  }

  if (!value) return null;
  if (detail === value) detail = null;
  if (badge === value) badge = null;

  return { value, detail, badge };
}

function parseDestination(source: unknown, locale: string): AutopilotBlock | null {
  const missingInfoDetailRecords = recordListFromPaths(source, [
    "destination.missingInfoDetails",
    "destination.missing_info_details",
    "destination.missingDetails",
    "destination.clarificationDetails",
    "destination.clarification_details",
  ]);
  const value = pickText(source, [
    "destination.goal",
    "destination.summary",
    "destination.title",
    "destination.label",
    "destination.request",
    "destination.text",
    "destinationSummary",
  ]);

  const request = pickText(source, [
    "destination.request",
    "destination.context",
    "destination.detail",
    "destination.description",
  ]);
  const confidence = pickText(source, [
    "destination.confidence.level",
    "destination.confidence",
    "destination.goalConfidence",
    "destination.readiness",
  ]);
  const confidenceReason = pickText(source, [
    "destination.confidence.reason",
    "destination.confidenceReason",
  ]);
  const confidenceSignals = collectTexts(source, [
    "destination.confidence.signals",
    "destination.confidenceSignals",
  ]);
  const taskType = pickText(source, ["destination.taskType"]);
  const lockState = pickText(source, [
    "destination.lockState",
    "destination.lock_state",
    "destination.goalLockState",
    "destination.goal_lock_state",
    "destination.lock.state",
    "destination.status",
  ]);
  const confirmedAt = formatTimestamp(
    locale,
    pickText(source, [
      "destination.confirmedAt",
      "destination.confirmed_at",
      "destination.lockedAt",
      "destination.locked_at",
      "destination.lock.confirmedAt",
      "destination.lock.confirmed_at",
      "destination.lock.lockedAt",
      "destination.lock.locked_at",
    ])
  );
  const modifiedAt = formatTimestamp(
    locale,
    pickText(source, [
      "destination.modifiedAt",
      "destination.modified_at",
      "destination.updatedAt",
      "destination.updated_at",
      "destination.changedAt",
      "destination.changed_at",
      "destination.lock.modifiedAt",
      "destination.lock.modified_at",
    ])
  );
  const auxiliaryTaskTypes = collectTexts(source, [
    "destination.auxiliaryTaskTypes",
  ]).map(value => localizeDestinationTaskType(locale, value));
  const missingInfoDetails = missingInfoDetailRecords.map(item => ({
    entry: pickText(item, [
      "item",
      "label",
      "question",
      "prompt",
      "missingInfo",
      "missing_info",
    ]),
    impact: pickText(item, ["impact", "impactSummary", "impact_summary"]),
    blocking: pickBoolean(item, ["blocking"]),
    clarification: pickText(item, [
      "clarification",
      "suggestedClarification",
      "suggested_clarification",
      "question",
      "prompt",
    ]),
  }));
  const missingInfo = uniqueStrings([
    ...collectTexts(source, [
      "destination.missingInfo",
      "destination.missingInformation",
      "destination.missing_info",
      "destination.missing_information",
      "destination.openQuestions",
      "destination.open_questions",
    ]),
    ...missingInfoDetails
      .map(item => item.entry)
      .filter((item): item is string => Boolean(item)),
  ]);
  const structuredMissingInfo = uniqueStrings(
    missingInfoDetailRecords.map(item => {
      const entry = pickText(item, [
        "item",
        "label",
        "question",
        "prompt",
        "missingInfo",
        "missing_info",
      ]);
      const impact = pickText(item, ["impact", "impactSummary", "impact_summary"]);
      const blocking = pickBoolean(item, ["blocking"]);

      return joinSegments([
        entry,
        impact ? `${t(locale, "Impact", "Impact")}: ${impact}` : null,
        blocking === true ? t(locale, "Blocking", "Blocking") : null,
      ]);
    })
  );
  const suggestedClarifications = uniqueStrings([
    ...collectTexts(source, [
      "destination.suggestedClarifications",
      "destination.clarifications",
      "destination.clarificationQuestions",
      "destination.missingInfoClarifications",
      "destination.missingInfoQuestions",
      "destination.suggested_clarifications",
      "destination.clarification_questions",
      "destination.questions",
    ]),
    ...missingInfoDetails
      .map(item => item.clarification)
      .filter((item): item is string => Boolean(item)),
  ]);
  const subGoals = collectTexts(source, [
    "destination.subGoals",
    "destination.subgoals",
    "destination.sub_goals",
    "destination.objectives",
    "destination.goals",
  ]);
  const constraints = collectTexts(source, [
    "destination.constraints",
    "destination.constraintList",
    "destination.constraint_list",
    "destination.requirements",
    "destination.guardrails",
    "destination.limitations",
    "destination.requirements.constraints",
    "destination.parser.constraints",
    "mappedMissionContext.reviewInput.constraints",
    "mappedWorkflowInput.plannerInput.constraints",
  ]);
  const successCriteria = collectTexts(source, [
    "destination.successCriteria",
    "destination.success_criteria",
    "destination.acceptanceCriteria",
    "destination.acceptance_criteria",
    "destination.doneCriteria",
    "destination.done_criteria",
    "destination.requirements.successCriteria",
    "destination.parser.successCriteria",
    "mappedMissionContext.reviewInput.successCriteria",
    "mappedWorkflowInput.plannerInput.successCriteria",
  ]);
  const deliverables = collectTexts(source, [
    "destination.deliverables",
    "destination.outputs",
    "destination.artifacts",
    "destination.parser.deliverables",
    "normalizedGoal.expectedDeliverables",
    "outputs.deliverables",
  ]);
  const blockingReason = pickText(source, [
    "blockingReason",
    "destination.blockingReason",
    "destination.blocking_reason",
    "destination.blocker",
    "destination.blockedReason",
    "destination.blocked_reason",
    "destination.blockedBy",
    "destination.impact",
    "destination.impactSummary",
    "destination.impact_summary",
  ]);
  const structuredMissingInfoImpact =
    missingInfoDetails.find(item => item.blocking === true && item.impact)?.impact ||
    missingInfoDetails.find(item => item.impact)?.impact ||
    null;
  const missingInfoImpact =
    blockingReason ||
    structuredMissingInfoImpact ||
    (missingInfo.length > 0
      ? t(
          locale,
          "Missing destination info may keep route selection and execution waiting on human clarification.",
          "Missing destination info may keep route selection and execution waiting on human clarification."
        )
      : null);

  const detail = joinSegments([
    request && request !== value ? request : null,
    prefixedSegment(t(locale, "Sub-goals", "Sub-goals"), subGoals, 3),
    confidence
      ? `${t(locale, "Confidence", "Confidence")}: ${localizeScale(locale, confidence)}`
      : null,
    confidenceReason
      ? `${t(locale, "Reason", "Reason")}: ${confidenceReason}`
      : null,
    taskType
      ? `${t(locale, "Task Type", "Task Type")}: ${localizeDestinationTaskType(locale, taskType)}`
      : null,
    lockState
      ? `${t(locale, "Lock State", "Lock State")}: ${localizeDestinationLockState(locale, lockState)}`
      : null,
    confirmedAt ? `${t(locale, "Confirmed", "Confirmed")}: ${confirmedAt}` : null,
    modifiedAt ? `${t(locale, "Modified", "Modified")}: ${modifiedAt}` : null,
    auxiliaryTaskTypes.length > 0
      ? `${t(locale, "Aux Types", "Aux Types")}: ${summarizeList(auxiliaryTaskTypes, 3) ?? ""}`
      : null,
    prefixedSegment(t(locale, "Signals", "Signals"), confidenceSignals),
    prefixedSegment(
      t(locale, "\u7ea6\u675f", "Constraints"),
      constraints,
      3
    ),
    prefixedSegment(
      t(locale, "\u9a8c\u6536", "Success"),
      successCriteria,
      3
    ),
    prefixedSegment(
      t(locale, "\u4ea4\u4ed8\u7269", "Deliverables"),
      deliverables
    ),
    prefixedSegment(
      t(locale, "澄清建议", "Clarifications"),
      suggestedClarifications
    ),
    prefixedSegment(t(locale, "待澄清项", "Missing Detail"), structuredMissingInfo),
    missingInfo.length > 0
      ? `${t(locale, "缺失信息", "Missing")}: ${summarizeList(missingInfo, 2) ?? ""}`
      : null,
    missingInfoImpact
      ? `${t(locale, "影响", "Impact")}: ${missingInfoImpact}`
      : null,
  ]);

  return createBlock({
    value,
    detail,
    badge: missingInfo.length > 0 ? t(locale, "Needs Info", "Needs Info") : null,
  });
}

function parseRoute(source: unknown, locale: string): AutopilotBlock | null {
  const selectedCandidate = routeSelectionRecord(source);
  const recommendedCandidate = recommendedRouteRecord(source);
  const candidateRoutes = routeCandidateRecordsFromSummary(source);
  const selectionStatus = pickText(source, [
    "route.selection.status",
    "route.selectionStatus",
  ]);
  const selectionMode = pickText(source, [
    "route.selection.mode",
    "route.selectionMode",
  ]);
  const selectionChangedBy = pickText(source, [
    "route.selection.changedBy",
    "route.changedBy",
  ]);
  const rawSelectionChangedReason = pickText(source, [
    "route.selection.changedReason",
    "route.changeReason",
    "route.selected.reason",
    "selectedRoute.reason",
  ]);
  const selectionChangedAt = formatTimestamp(
    locale,
    pickText(source, ["route.selection.changedAt", "route.changedAt"])
  );
  const selectionCanSwitch = pickBoolean(source, [
    "route.selection.canSwitch",
    "route.canSwitch",
  ]);
  const rawSwitchRequiresConfirmation = pickBoolean(source, [
    "route.selection.switchRequiresConfirmation",
    "route.switchRequiresConfirmation",
  ]);
  const switchRequiresConfirmation = rawSwitchRequiresConfirmation;
  const routeEvidenceLastEventType = pickText(source, [
    "route.evidence.lastEventType",
  ]);
  const routeEvidenceLastEventAt = formatTimestamp(
    locale,
    pickText(source, ["route.evidence.lastEventAt"])
  );
  const routeEvidenceEvents = uniqueStrings(
    recordListFromPaths(source, ["route.evidence.events"])
      .map(item => {
        const type = pickText(item, ["eventType"]);
        const actor = pickText(item, ["actor"]);
        const reason = pickText(item, ["reason"]);
        const toRouteId = pickText(item, ["toRouteId"]);
        const fromRouteId = pickText(item, ["fromRouteId"]);
        const at = formatTimestamp(locale, pickText(item, ["at"]));
        const segments = uniqueStrings([
          type ? localizeRouteEvidenceEventType(locale, type) : null,
          actor ? localizeRouteChangeActor(locale, actor) : null,
          toRouteId
            ? `${t(locale, "目标路线", "To")}: ${toRouteId}`
            : null,
          fromRouteId
            ? `${t(locale, "来源路线", "From")}: ${fromRouteId}`
            : null,
          reason,
          at,
        ]);
        return segments.length > 0 ? segments.join(", ") : null;
      })
      .slice(0, 2)
  );
  const replanActive = pickBoolean(source, ["route.replan.active"]);
  const replanReason = pickText(source, ["route.replan.reason"]);
  const replanFromRouteId = pickText(source, ["route.replan.fromRouteId"]);
  const replanToRouteId = pickText(source, ["route.replan.toRouteId"]);
  const replanTriggeredBy = pickText(source, ["route.replan.triggeredBy"]);
  const routeMode = pickText(source, [
    "route.selected.mode",
    "route.current.mode",
    "route.mode",
    "selectedRoute.mode",
    "routeMode",
  ]) || pickText(selectedCandidate, ["mode"]);
  const routeStatus = pickText(source, [
    "route.status",
    "route.current.status",
    "route.selected.status",
    "selectedRoute.status",
  ]) || pickText(selectedCandidate, ["status"]);
  const currentStageLabel = routeCurrentStageLabel(source);
  const progress = pickNumber(source, ["route.progress", "selectedRoute.progress"]);
  const riskPoints = collectTexts(source, ["route.riskPoints"]);
  const riskPointCount = riskPoints.length;
  const takeoverPointCount = routeTakeoverPointCount(source);
  const selectedRouteDetail = selectedCandidate
    ? formatRouteCandidate(selectedCandidate, locale)
    : null;
  const recommendedRouteDetail =
    recommendedCandidate && !sameRouteRecord(recommendedCandidate, selectedCandidate)
      ? formatRouteCandidate(recommendedCandidate, locale)
      : null;
  const alternativeRouteDetails = uniqueStrings(
    candidateRoutes
      .filter(
        candidate =>
          !sameRouteRecord(candidate, selectedCandidate) &&
          !sameRouteRecord(candidate, recommendedCandidate)
      )
      .map(candidate => formatRouteCandidate(candidate, locale))
  );
  const routeLocked =
    pickBoolean(source, [
      "route.selection.locked",
      "route.selectionLocked",
      "route.locked",
      "route.selected.locked",
      "selectedRoute.locked",
    ]) ??
    (selectedCandidate ? pickBoolean(selectedCandidate, ["locked"]) : null);
  const explicitDetail = pickText(source, [
    "route.selected.summary",
    "route.selected.reason",
    "route.selected.description",
    "selectedRoute.summary",
    "selectedRoute.reason",
    "selectedRoute.description",
    "route.current.summary",
    "route.current.reason",
    "route.summary",
    "route.reason",
    "route.description",
    "route.detail",
  ]) || pickText(selectedCandidate, ["summary", "reason", "description"]);
  const value =
    pickText(source, [
      "route.selected.title",
      "route.selected.label",
      "route.selected.name",
      "route.current.title",
      "route.current.label",
      "route.current.name",
      "route.title",
      "route.label",
      "route.name",
      "selectedRoute.title",
      "selectedRoute.label",
      "selectedRoute.name",
      "routeSummary",
      "route",
    ]) ||
    pickText(selectedCandidate, ["label", "title", "name"]) ||
    currentStageLabel;
  const switchabilityDetail =
    selectionCanSwitch === true
      ? t(
          locale,
          switchRequiresConfirmation === true
            ? "\u53ef\u5207\u6362\uff0c\u9700\u786e\u8ba4"
            : "\u53ef\u5207\u6362",
          switchRequiresConfirmation === true
            ? "Route can switch with confirmation"
            : "Route can switch"
        )
      : switchRequiresConfirmation === true
        ? t(locale, "\u5207\u6362\u9700\u786e\u8ba4", "Switch requires confirmation")
        : null;
  const selectionChangedReason = joinSegments([
    rawSelectionChangedReason,
    switchabilityDetail,
  ]);
  const routeDiffSummary = summarizeRouteDifferences(
    locale,
    selectedCandidate,
    recommendedCandidate
  );
  const selectedEta = pickText(selectedCandidate, [
    "estimatedDuration",
    "estimatedDuration.label",
  ]);
  const selectedCost = pickText(selectedCandidate, [
    "estimatedCost",
    "estimatedCost.label",
    "estimatedCost.relativeLevel",
  ]);
  const routeEtaSummary = summarizeRouteMetric(
    locale,
    "时长",
    "ETA",
    selectedEta,
    candidateRoutes.map(candidate =>
      pickText(candidate, ["estimatedDuration", "estimatedDuration.label"])
    ),
    parseDurationToMinutes
  );
  const routeCostSummary = summarizeRouteMetric(
    locale,
    "成本",
    "Cost",
    selectedCost,
    candidateRoutes.map(candidate =>
      pickText(candidate, [
        "estimatedCost",
        "estimatedCost.label",
        "estimatedCost.relativeLevel",
      ])
    ),
    parseCostToNumber
  );
  const remainingStepsSummary = routeRemainingStepsSummary(source, locale);
  const projection = projectionSource(source);
  const projectedRoute = pickText(projection, [
    "route.label",
    "route.title",
    "route.summary",
    "route.selectedRouteId",
    "route.id",
    "selectedRouteId",
    "routeId",
  ]);
  const projectedRouteStatus = pickText(projection, [
    "route.status",
    "route.selectionStatus",
    "routeSelectionStatus",
  ]);
  const projectedRouteEvidence = pickText(projection, [
    "route.evidenceEventId",
    "route.eventId",
    "evidenceEventId",
  ]);

  const detail = joinSegments([
    explicitDetail,
    selectedRouteDetail
      ? `${t(locale, "Selected", "Selected")}: ${selectedRouteDetail}`
      : null,
    recommendedRouteDetail
      ? `${t(locale, "Recommended", "Recommended")}: ${recommendedRouteDetail}`
      : null,
    prefixedSegment(t(locale, "Alternatives", "Alternatives"), alternativeRouteDetails),
    routeDiffSummary,
    joinSegments([
      routeEtaSummary,
      routeCostSummary,
    ]),
    joinSegments([
      riskPointCount > 0
        ? formatCountSummary(locale, riskPointCount, "risk point", "risk point")
        : null,
      takeoverPointCount > 0
        ? formatCountSummary(
            locale,
            takeoverPointCount,
            "takeover point",
            "takeover point"
          )
        : null,
    ]),
    remainingStepsSummary,
    projectedRoute
      ? joinSegments([
          `${t(locale, "Takeover projection", "Takeover projection")}: ${projectedRoute}`,
          projectedRouteStatus
            ? `${t(locale, "Status", "Status")}: ${localizeRouteStatus(
                locale,
                projectedRouteStatus
              )}`
            : null,
          projectedRouteEvidence
            ? `${t(locale, "Evidence", "Evidence")}: ${projectedRouteEvidence}`
            : null,
        ])
      : null,
    selectionStatus
      ? `${t(locale, "Selection", "Selection")}: ${localizeRouteSelectionStatus(
          locale,
          selectionStatus
        )}`
      : null,
    selectionMode
      ? `${t(locale, "Selection Mode", "Selection Mode")}: ${localizeRouteSelectionMode(
          locale,
          selectionMode
        )}`
      : null,
    selectionChangedBy
      ? `${t(locale, "Changed By", "Changed By")}: ${localizeRouteChangeActor(
          locale,
          selectionChangedBy
        )}`
      : null,
    selectionChangedAt
      ? `${t(locale, "Changed", "Changed")}: ${selectionChangedAt}`
      : null,
    switchRequiresConfirmation === true
      ? t(locale, "Switch requires confirmation", "Switch requires confirmation")
      : null,
    selectionChangedReason
      ? `${t(locale, "Selection Reason", "Selection Reason")}: ${selectionChangedReason}`
      : null,
    replanActive
      ? joinSegments([
          t(locale, "Replan active", "Replan active"),
          replanReason
            ? `${t(locale, "Reason", "Reason")}: ${replanReason}`
            : null,
          replanTriggeredBy
            ? `${t(locale, "Triggered By", "Triggered By")}: ${localizeRouteChangeActor(
                locale,
                replanTriggeredBy
              )}`
            : null,
          replanFromRouteId
            ? `${t(locale, "From", "From")}: ${replanFromRouteId}`
            : null,
          replanToRouteId
            ? `${t(locale, "目标路线", "To")}: ${replanToRouteId}`
            : null,
        ])
      : null,
    routeEvidenceLastEventType
      ? joinSegments([
          `${t(locale, "Route Evidence", "Route Evidence")}: ${localizeRouteEvidenceEventType(
            locale,
            routeEvidenceLastEventType
          )}`,
          routeEvidenceLastEventAt
            ? `${t(locale, "时间", "At")}: ${routeEvidenceLastEventAt}`
            : null,
        ])
      : null,
    prefixedSegment(t(locale, "路线事件", "Route Events"), routeEvidenceEvents),
    currentStageLabel && currentStageLabel !== value
      ? `${t(locale, "\u5f53\u524d\u9636\u6bb5", "Stage")}: ${currentStageLabel}`
      : null,
    progress !== null
      ? t(locale, `\u8fdb\u5ea6 ${progress}%`, `${progress}% complete`)
      : null,
    routeLocked ? t(locale, "Route locked", "Route locked") : null,
    routeStatus
      ? `${t(locale, "\u72b6\u6001", "Status")}: ${localizeRouteStatus(locale, routeStatus)}`
      : null,
    prefixedSegment(t(locale, "\u98ce\u9669", "Risk"), riskPoints),
  ]);

  const badge = routeMode
    ? localizeRouteMode(locale, routeMode)
    : routeStatus
      ? localizeRouteStatus(locale, routeStatus)
      : null;

  return createBlock({ value, detail, badge });
}

function parseExecution(source: unknown, locale: string): AutopilotBlock | null {
  const currentStageLabel =
    pickText(source, [
      "execution.currentStepLabel",
      "currentExecution.currentStepLabel",
      "liveExecution.currentStepLabel",
      "execution.currentStageLabel",
      "execution.stageLabel",
      "currentExecution.currentStageLabel",
      "liveExecution.currentStageLabel",
    ]) || routeCurrentStageLabel(source);
  const explicitValue = pickText(source, [
    "execution.title",
    "execution.label",
    "execution.summary",
    "currentExecution.title",
    "currentExecution.label",
    "currentExecution.summary",
    "liveExecution.title",
    "liveExecution.label",
    "liveExecution.summary",
  ]);
  const explicitDetail = pickText(source, [
    "execution.detail",
    "execution.description",
    "currentExecution.detail",
    "currentExecution.description",
    "liveExecution.detail",
    "liveExecution.description",
  ]);
  const stageDetail = routeCurrentStageDetail(source);
  const progress = pickNumber(source, [
    "execution.progress",
    "currentExecution.progress",
    "liveExecution.progress",
    "route.progress",
  ]);
  const activeRoles = roleHighlightsFromSummary(source, locale, [
    "running",
    "waiting",
  ]);
  const executorJobId = pickText(source, [
    "execution.executorJobId",
    "currentExecution.executorJobId",
    "bindings.executorJobId",
  ]);
  const parallelBranches = collectTexts(source, [
    "execution.parallelBranches",
    "execution.branches",
    "parallel.branches",
    "parallel.items",
  ]);
  const parallelBranchCount = pickNumber(source, [
    "execution.parallelBranchCount",
    "currentExecution.parallelBranchCount",
    "liveExecution.parallelBranchCount",
  ]);
  const blockedReasons = collectTexts(source, [
    "execution.blockedReasons",
    "currentExecution.blockedReasons",
    "liveExecution.blockedReasons",
  ]);
  const intermediateDeliverables = collectTexts(source, [
    "execution.intermediateDeliverables",
    "currentExecution.intermediateDeliverables",
    "liveExecution.intermediateDeliverables",
  ]);
  const availableActions = executionActionLabelsFromSummary(source, locale);
  const badgeKey =
    pickText(source, [
      "execution.currentStepStatus",
      "currentExecution.currentStepStatus",
      "liveExecution.currentStepStatus",
      "execution.status",
      "currentExecution.status",
      "liveExecution.status",
    ]) ||
    pickText(currentStageRecord(source), ["status"]) ||
    null;
  const fallbackValue =
    activeRoles.length > 0 ||
    parallelBranches.length > 0 ||
    parallelBranchCount !== null ||
    blockedReasons.length > 0 ||
    intermediateDeliverables.length > 0 ||
    availableActions.length > 0 ||
    executorJobId
      ? t(locale, "\u5f53\u524d\u6267\u884c", "Live execution")
      : null;

  return createBlock({
    value: explicitValue || currentStageLabel || fallbackValue,
    detail: joinSegments([
      explicitDetail,
      stageDetail &&
      stageDetail !== explicitValue &&
      stageDetail !== currentStageLabel
        ? stageDetail
        : null,
      progress !== null
        ? t(locale, `\u8fdb\u5ea6 ${progress}%`, `${progress}% complete`)
        : null,
      prefixedSegment(t(locale, "\u5728\u7ebf\u89d2\u8272", "Live"), activeRoles),
      executorJobId
        ? `${t(locale, "\u6267\u884c\u4f5c\u4e1a", "Executor job")}: ${executorJobId}`
        : null,
      parallelBranchCount !== null && parallelBranches.length === 0
        ? t(
            locale,
            `${parallelBranchCount} \u4e2a\u5e76\u884c\u5206\u652f`,
            `${parallelBranchCount} parallel branches`
          )
        : null,
      prefixedSegment(
        t(locale, "\u5e76\u884c\u5206\u652f", "Parallel"),
        parallelBranches
      ),
      prefixedSegment(t(locale, "\u963b\u585e", "Blocked"), blockedReasons),
      prefixedSegment(
        t(locale, "\u4e2d\u95f4\u4ea7\u7269", "Intermediates"),
        intermediateDeliverables
      ),
      prefixedSegment(t(locale, "\u52a8\u4f5c", "Actions"), availableActions),
    ]),
    badge: badgeKey ? localizeRouteStatus(locale, badgeKey) : null,
  });
}

function parseDriveState(source: unknown, locale: string): AutopilotBlock | null {
  const stateLabel = pickText(source, [
    "driveState.label",
    "driveState.title",
    "driveState.name",
    "driveState.value",
    "currentDriveState.label",
    "currentDriveState.title",
    "currentDriveState.value",
  ]);
  const stateKey = pickText(source, [
    "driveState.key",
    "driveState.state",
    "currentDriveState.key",
    "currentDriveState.state",
    "driveState",
    "drive_state",
  ]);
  const currentStageLabel =
    pickText(source, [
      "driveState.currentStageLabel",
      "currentDriveState.currentStageLabel",
    ]) || routeCurrentStageLabel(source);
  const riskLevel = pickText(source, [
    "driveState.riskLevel",
    "currentDriveState.riskLevel",
  ]);
  const confidence = pickText(source, [
    "driveState.confidence",
    "currentDriveState.confidence",
  ]);
  const projection = projectionSource(source);
  const projectedDriveState = pickText(projection, [
    "driveState.label",
    "driveState.state",
    "driveState.key",
    "state",
  ]);
  const projectedDriveReason = pickText(projection, [
    "driveState.reason",
    "driveState.detail",
    "driveState.summary",
    "reason",
  ]);
  const projectedDriveEvidence = pickText(projection, [
    "driveState.evidenceEventId",
    "driveState.eventId",
    "evidenceEventId",
  ]);

  const detail = joinSegments([
    pickText(source, [
      "driveState.detail",
      "driveState.summary",
      "driveState.reason",
      "driveState.description",
      "currentDriveState.detail",
      "currentDriveState.summary",
    ]),
    currentStageLabel
      ? `${t(locale, "\u5f53\u524d\u9636\u6bb5", "Stage")}: ${currentStageLabel}`
      : null,
    pickBoolean(source, ["driveState.blocked", "currentDriveState.blocked"])
      ? t(locale, "\u5df2\u963b\u585e", "Blocked")
      : null,
    pickBoolean(source, [
        "driveState.waitingForUser",
        "currentDriveState.waitingForUser",
      ])
      ? t(locale, "\u7b49\u5f85\u7528\u6237", "Waiting for user")
      : null,
    riskLevel
      ? `${t(locale, "\u98ce\u9669", "Risk")}: ${localizeScale(locale, riskLevel)}`
      : null,
    confidence
      ? `${t(locale, "\u7f6e\u4fe1\u5ea6", "Confidence")}: ${localizeScale(
          locale,
          confidence
        )}`
      : null,
    projectedDriveState
      ? joinSegments([
          `${t(locale, "Takeover projection", "Takeover projection")}: ${localizeDriveState(
            locale,
            projectedDriveState
          )}`,
          projectedDriveReason,
          projectedDriveEvidence
            ? `${t(locale, "Evidence", "Evidence")}: ${projectedDriveEvidence}`
            : null,
        ])
      : null,
  ]);

  return createBlock({
    value: stateLabel || (stateKey ? localizeDriveState(locale, stateKey) : null),
    detail,
  });
}

function parseFleet(source: unknown, locale: string): AutopilotBlock | null {
  const roleTitles = roleTitlesFromSummary(source, locale);
  const activeRoles = roleHighlightsFromSummary(source, locale, ["running", "waiting"]);
  const blockedRoles = roleHighlightsFromSummary(source, locale, [
    "blocked",
    "failed",
  ]);
  const boundEntities = boundEntityLabelsFromSummary(source);
  const explicitValue = pickText(source, [
    "fleet.roleSummary",
    "fleet.title",
    "fleet.label",
    "fleet.summary",
    "fleetRole",
    "fleetRoleLabel",
    "fleetRoleSummary",
  ]);
  const detail = joinSegments([
    pickText(source, ["fleet.detail", "fleet.statusSummary", "fleet.description"]),
    buildFleetCountText(source, locale),
    prefixedSegment(t(locale, "\u5728\u7ebf", "Live"), activeRoles),
    prefixedSegment(t(locale, "\u963b\u585e", "Blocked"), blockedRoles),
    prefixedSegment(t(locale, "\u7ed1\u5b9a", "Bound"), boundEntities),
  ]);

  return createBlock({
    value: explicitValue || (roleTitles.length > 0 ? roleTitles.join(" / ") : null),
    detail,
  });
}

function parseBlockers(source: unknown, locale: string): AutopilotBlock | null {
  const blockers = blockerLabelsFromSummary(source);
  const reason = pickText(source, [
    "blockers.reason",
    "blockers.summary",
    "takeover.reason",
    "takeover.detail",
    "takeover.description",
  ]);
  const prompt = pickText(source, ["blockers.prompt", "takeover.prompt"]);
  const recovery = collectTexts(source, [
    "blockers.recovery",
    "blockers.nextActions",
    "blockers.resolutionHints",
  ]);
  const explicitValue = pickText(source, [
    "blockers.title",
    "blockers.label",
    "blockingSummary",
  ]);
  const takeoverType = pickText(source, ["takeover.type", "blockers.type"]);
  const isBlocked = pickBoolean(source, ["driveState.blocked", "takeover.blocking"]);
  const waitingForUser = pickBoolean(source, [
    "driveState.waitingForUser",
    "takeover.required",
  ]);
  const fallbackValue = explicitValue
    ? explicitValue
    : takeoverType && waitingForUser
      ? t(
          locale,
          `${localizeTakeoverType(locale, takeoverType)}\u963b\u585e`,
          `${localizeTakeoverType(locale, takeoverType)} gate`
        )
      : isBlocked
        ? t(locale, "\u6267\u884c\u53d7\u963b", "Execution blocked")
        : blockers.length > 0
          ? t(locale, "\u963b\u585e\u70b9", "Blocking points")
          : null;
  const urgency = pickText(source, ["takeover.urgency", "blockers.urgency"]);

  return createBlock({
    value: fallbackValue,
    detail: joinSegments([
      reason,
      prompt && prompt !== reason ? prompt : null,
      prefixedSegment(t(locale, "\u963b\u585e\u9879", "Blockers"), blockers),
      prefixedSegment(t(locale, "\u6062\u590d", "Recovery"), recovery),
    ]),
    badge: urgency ? localizeScale(locale, urgency) : null,
  });
}

function parseRecovery(source: unknown, locale: string): AutopilotBlock | null {
  const explicitValue = pickText(source, [
    "recovery.label",
    "recovery.title",
    "recovery.summary",
  ]);
  const state = pickText(source, ["recovery.state"]);
  const deviationCategory = pickText(source, ["recovery.deviationCategory"]);
  const reason = pickText(source, [
    "recovery.reason",
    "recovery.detail",
    "recovery.description",
  ]);
  const attemptedActions = collectTexts(source, ["recovery.attemptedActions"]).map(
    action => localizeControlAction(locale, action)
  );
  const suggestedActions = collectTexts(source, ["recovery.suggestedActions"]).map(
    action => localizeControlAction(locale, action)
  );
  const needsHuman = pickBoolean(source, ["recovery.needsHuman"]);
  const canAutoRecover = pickBoolean(source, ["recovery.canAutoRecover"]);

  return createBlock({
    value: explicitValue || (state ? localizeRecoveryState(locale, state) : reason),
    detail: joinSegments([
      reason,
      prefixedSegment(
        t(locale, "Attempted", "Attempted"),
        attemptedActions
      ),
      prefixedSegment(
        t(locale, "Suggested", "Suggested"),
        suggestedActions
      ),
      needsHuman
        ? t(locale, "Human handoff required", "Human handoff required")
        : null,
      canAutoRecover === true
        ? t(locale, "Auto recovery available", "Auto recovery available")
        : null,
      canAutoRecover === false && state && state !== "healthy"
        ? t(locale, "Auto recovery unavailable", "Auto recovery unavailable")
        : null,
    ]),
    badge:
      deviationCategory && deviationCategory !== "none"
        ? localizeDeviationCategory(locale, deviationCategory)
        : state
          ? localizeRecoveryState(locale, state)
          : null,
  });
}

function parseOutputs(source: unknown, locale: string): AutopilotBlock | null {
  const deliverables = collectTexts(source, [
    "destination.deliverables",
    "outputs.deliverables",
  ]);
  const outputs = outputLabelsFromSummary(source);
  const explicitValue = pickText(source, [
    "outputs.title",
    "outputs.label",
    "outputs.summary",
    "intermediateOutputs.summary",
    "artifacts.summary",
    "outputsOverview",
  ]);
  const explicitDetail = pickText(source, [
    "outputs.detail",
    "outputs.description",
    "intermediateOutputs.detail",
    "artifacts.detail",
  ]);

  return createBlock({
    value: explicitValue || summarizeList(outputs, 2),
    detail: joinSegments([
      explicitDetail,
      prefixedSegment(t(locale, "\u4ea4\u4ed8\u7269", "Deliverables"), deliverables),
      prefixedSegment(
        t(locale, "\u4e2d\u95f4\u4ea7\u7269", "Intermediates"),
        outputs.filter(item => !deliverables.includes(item))
      ),
    ]),
  });
}

function formatEvidenceTimelineItem(
  item: UnknownRecord,
  locale: string
): string | null {
  const label = pickText(item, ["label", "title", "name"]);
  const detail = pickText(item, ["detail", "summary", "reason", "description"]);
  const type = pickText(item, ["type"]);
  const status = pickText(item, ["status"]);
  const source = pickText(item, ["source"]);
  const meta = uniqueStrings([
    type ? localizeTimelineEventType(locale, type) : null,
    status ? localizeTimelineStatus(locale, status) : null,
    source,
  ]);

  const base = label || detail;
  if (!base) return null;

  const metaText = meta.length > 0 ? `(${meta.join(", ")})` : null;
  if (detail && detail !== label) {
    return [base, metaText, `- ${detail}`].filter(Boolean).join(" ");
  }

  return [base, metaText].filter(Boolean).join(" ");
}

function formatExplanationCurrentStateSegment(
  source: unknown,
  locale: string
): string | null {
  const driveState = pickText(source, ["explanation.currentState.driveState"]);
  const missionStatus = pickText(source, ["explanation.currentState.missionStatus"]);
  const currentStageLabel = pickText(source, [
    "explanation.currentState.currentStageLabel",
  ]);
  const workflowStatus = pickText(source, [
    "explanation.currentState.workflowStatus",
  ]);
  const workflowStage = pickText(source, [
    "explanation.currentState.workflowStage",
  ]);
  const routeSelectionStatus = pickText(source, [
    "explanation.currentState.routeSelectionStatus",
  ]);
  const selectedRouteId = pickText(source, [
    "explanation.currentState.selectedRouteId",
  ]);
  const correlationTimelineId = pickText(source, [
    "explanation.currentState.correlationTimelineId",
  ]);

  return joinSegments([
    driveState
      ? `${t(locale, "State", "State")}: ${localizeDriveState(locale, driveState)}`
      : null,
    missionStatus
      ? `${t(locale, "Mission", "Mission")}: ${formatKeyLabel(missionStatus)}`
      : null,
    workflowStatus
      ? `${t(locale, "Workflow", "Workflow")}: ${formatKeyLabel(workflowStatus)}`
      : null,
    workflowStage
      ? `${t(locale, "Workflow Stage", "Workflow Stage")}: ${formatKeyLabel(workflowStage)}`
      : null,
    currentStageLabel
      ? `${t(locale, "Stage", "Stage")}: ${currentStageLabel}`
      : null,
    routeSelectionStatus
      ? `${t(locale, "Route Selection", "Route Selection")}: ${localizeRouteSelectionStatus(
          locale,
          routeSelectionStatus
        )}`
      : null,
    selectedRouteId
      ? `${t(locale, "Selected Route", "Selected Route")}: ${selectedRouteId}`
      : null,
    correlationTimelineId
      ? `${t(locale, "Timeline", "Timeline")}: ${correlationTimelineId}`
      : null,
  ]);
}

function formatExplanationRecommendationDetail(
  item: UnknownRecord,
  locale: string
): string | null {
  const summary = pickText(item, ["summary", "detail", "reason"]);
  const kind = pickText(item, ["kind"]);
  const source = pickText(item, ["source"]);
  const routeId = pickText(item, ["routeId"]);
  const actionType = pickText(item, ["actionType"]);
  const takeoverType = pickText(item, ["takeoverType"]);
  const decisionId = pickText(item, ["decisionId"]);
  const routeSelectionStatus = pickText(item, ["routeSelectionStatus"]);
  const correlationTimelineId = pickText(item, ["correlationTimelineId"]);
  const meta = uniqueStrings([
    kind ? formatKeyLabel(kind) : null,
    source ? formatKeyLabel(source) : null,
    actionType ? localizeControlAction(locale, actionType) : null,
    takeoverType ? localizeTakeoverType(locale, takeoverType) : null,
    routeSelectionStatus
      ? `${t(locale, "选择", "Selection")}: ${localizeRouteSelectionStatus(
          locale,
          routeSelectionStatus
        )}`
      : null,
    routeId ? `${t(locale, "路线", "Route")}: ${routeId}` : null,
      decisionId ? `${t(locale, "决策", "Decision")}: ${decisionId}` : null,
    correlationTimelineId
      ? `${t(locale, "Timeline", "Timeline")}: ${correlationTimelineId}`
      : null,
  ]);

  if (!summary && meta.length === 0) return null;

  return [summary, meta.length > 0 ? `(${meta.join(", ")})` : null]
    .filter(Boolean)
    .join(" ");
}

function parseEvidence(source: unknown, locale: string): AutopilotBlock | null {
  const eventCount = pickNumber(source, ["evidence.eventCount"]);
  const artifactCount = pickNumber(source, ["evidence.artifactCount"]);
  const explicitValue = pickText(source, [
    "evidence.title",
    "evidence.label",
    "evidence.summary",
    "evidenceOverview",
  ]);
  const lastSignal = pickText(source, [
    "evidence.lastSignal",
    "evidence.detail",
    "evidence.latest.summary",
  ]);
  const latestEventType = pickText(source, [
    "evidence.latestEventType",
    "evidence.latest.type",
  ]);
  const updatedAt = formatTimestamp(
    locale,
    pickText(source, ["evidence.updatedAt", "evidence.latest.updatedAt"])
  );
  const trustLevel = pickText(source, ["evidence.trustLevel"]);
  const evidenceSources = collectTexts(source, [
    "evidence.sources",
    "evidence.entries",
    "evidence.inputs",
  ]);
  const evidenceGaps = collectTexts(source, ["evidence.gaps"]);
  const timelinePreview = uniqueStrings(
    recordListFromPaths(source, ["evidence.timeline"])
      .map(item => formatEvidenceTimelineItem(item, locale))
      .slice(0, 2)
  );
  const correlationRefs = uniqueStrings([
    pickText(source, ["evidence.correlation.workflowId"])
      ? `${t(locale, "Workflow", "Workflow")}: ${pickText(source, [
          "evidence.correlation.workflowId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.replayId"])
      ? `${t(locale, "Replay", "Replay")}: ${pickText(source, [
          "evidence.correlation.replayId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.sessionId"])
      ? `${t(locale, "Session", "Session")}: ${pickText(source, [
          "evidence.correlation.sessionId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.selectedRouteId"])
      ? `${t(locale, "Selected Route", "Selected Route")}: ${pickText(source, [
          "evidence.correlation.selectedRouteId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.recommendedRouteId"])
      ? `${t(locale, "Recommended Route", "Recommended Route")}: ${pickText(source, [
          "evidence.correlation.recommendedRouteId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.currentStepKey"])
      ? `${t(locale, "Current Step", "Current Step")}: ${formatKeyLabel(
          pickText(source, ["evidence.correlation.currentStepKey"]) ?? ""
        )}`
      : null,
  ]);
  const routeIds = textListFromValue(getPath(source, "evidence.correlation.routeIds"));
  const routeStageKeys = textListFromValue(
    getPath(source, "evidence.correlation.routeStageKeys")
  );
  const runtimeEventIds = textListFromValue(
    getPath(source, "evidence.correlation.runtimeEventIds")
  );
  const decisionIds = textListFromValue(
    getPath(source, "evidence.correlation.decisionIds")
  );
  const operatorActionIds = textListFromValue(
    getPath(source, "evidence.correlation.operatorActionIds")
  );
  const auditEventIds = textListFromValue(
    getPath(source, "evidence.correlation.auditEventIds")
  );
  const lineageIds = textListFromValue(
    getPath(source, "evidence.correlation.lineageIds")
  );
  const correlationCounts = uniqueStrings([
    routeIds.length > 0 ? `${t(locale, "Routes", "Routes")}: ${routeIds.length}` : null,
    routeStageKeys.length > 0
      ? `${t(locale, "Stages", "Stages")}: ${routeStageKeys.length}`
      : null,
    runtimeEventIds.length > 0
      ? `${t(locale, "Runtime Events", "Runtime Events")}: ${runtimeEventIds.length}`
      : null,
    decisionIds.length > 0
      ? `${t(locale, "Decisions", "Decisions")}: ${decisionIds.length}`
      : null,
    operatorActionIds.length > 0
      ? `${t(locale, "Operator Actions", "Operator Actions")}: ${operatorActionIds.length}`
      : null,
    auditEventIds.length > 0
      ? `${t(locale, "Audit Events", "Audit Events")}: ${auditEventIds.length}`
      : null,
    lineageIds.length > 0
      ? `${t(locale, "Lineage", "Lineage")}: ${lineageIds.length}`
      : null,
  ]);
  const countSummary = joinSegments([
    eventCount !== null
      ? t(locale, `${eventCount} \u6761\u4e8b\u4ef6`, `${eventCount} events`)
      : null,
    artifactCount !== null
      ? t(locale, `${artifactCount} \u4e2a\u4ea7\u7269`, `${artifactCount} artifacts`)
      : null,
  ]);
  const projection = projectionSource(source);
  const projectionMarker = pickText(projection, [
    "marker",
    "projectionMarker",
    "status",
  ]);
  const projectionEventId = pickText(projection, [
    "evidence.eventId",
    "evidence.evidenceEventId",
    "evidenceEventId",
    "eventId",
  ]);
  const projectionRouteId = pickText(projection, [
    "route.selectedRouteId",
    "route.id",
    "selectedRouteId",
    "routeId",
  ]);
  const projectionDriveState = pickText(projection, [
    "driveState.state",
    "driveState.key",
    "state",
  ]);
  const projectionDetail =
    projectionMarker || projectionEventId || projectionRouteId || projectionDriveState
      ? joinSegments([
          `${t(locale, "Takeover projection", "Takeover projection")}: ${
            projectionMarker || t(locale, "recorded", "recorded")
          }`,
          projectionEventId
            ? `${t(locale, "Event", "Event")}: ${projectionEventId}`
            : null,
          projectionRouteId
            ? `${t(locale, "Route", "Route")}: ${projectionRouteId}`
            : null,
          projectionDriveState
            ? `${t(locale, "State", "State")}: ${localizeDriveState(
                locale,
                projectionDriveState
              )}`
            : null,
        ])
      : null;

  return createBlock({
    value: explicitValue || countSummary || lastSignal,
    detail: joinSegments([
      lastSignal && lastSignal !== explicitValue && lastSignal !== countSummary
        ? lastSignal
        : null,
      trustLevel
        ? `${t(locale, "Trust", "Trust")}: ${localizeEvidenceTrust(
            locale,
            trustLevel
          )}`
        : null,
      latestEventType
        ? `${t(locale, "\u6700\u65b0\u4e8b\u4ef6", "Latest")}: ${localizeTimelineEventType(locale, latestEventType)}`
        : null,
      updatedAt
        ? `${t(locale, "\u66f4\u65b0\u65f6\u95f4", "Updated")}: ${updatedAt}`
        : null,
      prefixedSegment(t(locale, "\u8bc1\u636e\u6765\u6e90", "Sources"), evidenceSources),
      prefixedSegment(t(locale, "缺口", "Gaps"), evidenceGaps),
      prefixedSegment(t(locale, "Timeline", "Timeline"), timelinePreview),
      projectionDetail,
    ]),
    badge: latestEventType
      ? localizeTimelineEventType(locale, latestEventType)
      : trustLevel
        ? localizeEvidenceTrust(locale, trustLevel)
      : null,
  });
}

function parseExplanation(source: unknown, locale: string): AutopilotBlock | null {
  const current = pickText(source, [
    "explanation.current",
    "explanation.summary",
    "explanation.label",
    "explanation.title",
    "explanationOverview",
  ]);
  const nextSteps = collectTexts(source, ["explanation.nextSteps"]);
  const recommendationReasons = collectTexts(source, [
    "explanation.recommendationReasons",
  ]);
  const riskSummary = collectTexts(source, ["explanation.riskSummary"]);
  const evidenceHints = collectTexts(source, ["explanation.evidenceHints"]);
  const telemetrySignals = collectTexts(source, ["explanation.telemetrySignals"]);
  const fallbackValue =
    current || summarizeList(recommendationReasons, 1) || summarizeList(nextSteps, 1);

  return createBlock({
    value: fallbackValue,
    detail: joinSegments([
      current && current !== fallbackValue ? current : null,
      prefixedSegment(t(locale, "Next", "Next"), nextSteps),
      prefixedSegment(t(locale, "原因", "Why"), recommendationReasons),
      prefixedSegment(t(locale, "风险", "Risk"), riskSummary),
      prefixedSegment(t(locale, "证据提示", "Evidence"), evidenceHints),
      prefixedSegment(t(locale, "信号", "Signals"), telemetrySignals),
    ]),
  });
}

function buildTakeoverValue(source: unknown, locale: string): string | null {
  const explicitValue = pickText(source, [
    "takeover.label",
    "takeover.title",
    "takeover.summary",
    "takeoverSummary",
  ]);
  if (explicitValue) return explicitValue;

  const type = pickText(source, ["takeover.type"]);
  const required = pickBoolean(source, ["takeover.required"]);
  const blocking = pickBoolean(source, ["takeover.blocking"]);

  if (type && (required || blocking)) {
    return t(
      locale,
      `${localizeTakeoverType(locale, type)}\u63a5\u7ba1`,
      `${localizeTakeoverType(locale, type)} required`
    );
  }
  if (type) {
    return localizeTakeoverType(locale, type);
  }
  if (required || blocking) {
    return t(locale, "\u9700\u8981\u63a5\u7ba1", "Takeover required");
  }
  if (required === false) {
    return t(locale, "\u65e0\u9700\u63a5\u7ba1", "No takeover required");
  }

  return null;
}

function parseTakeover(source: unknown, locale: string): AutopilotBlock | null {
  const status = pickText(source, [
    "takeover.status",
    "takeover.state",
    "takeoverStatus",
  ]);
  const urgency = pickText(source, ["takeover.urgency"]);
  const decisionId = pickText(source, ["takeover.decisionId", "decisionId"]);
  const required = pickBoolean(source, ["takeover.required"]);
  const blocking = pickBoolean(source, ["takeover.blocking"]);
  const options = takeoverOptionLabels(source);
  const reason = pickText(source, [
    "takeover.reason",
    "takeover.detail",
    "takeover.description",
    "takeoverReason",
    "takeoverRequiredReason",
  ]);
  const prompt = pickText(source, ["takeover.prompt"]);

  return createBlock({
    value: buildTakeoverValue(source, locale),
    detail: joinSegments([
      reason,
      prompt && prompt !== reason ? prompt : null,
      decisionId ? `${t(locale, "决策", "Decision")}: ${decisionId}` : null,
      required === true ? t(locale, "Action required", "Action required") : null,
      blocking === true
        ? t(locale, "阻塞当前路线", "Blocking route progression")
        : null,
      prefixedSegment(t(locale, "\u9009\u9879", "Options"), options),
    ]),
    badge: status
      ? localizeTakeoverStatus(locale, status)
      : urgency
        ? localizeScale(locale, urgency)
        : null,
  });
}

function parseDecisionHandoff(
  detail: MissionTaskDetail,
  source: unknown,
  locale: string
): AutopilotBlock | null {
  const decision = isRecord(detail.decision) ? detail.decision : null;
  const decisionId =
    pickText(source, ["takeover.decisionId"]) ||
    asText(decision?.decisionId) ||
    null;
  const prompt =
    pickText(source, ["takeover.prompt", "decision.prompt"]) ||
    detail.decisionPrompt ||
    asText(decision?.prompt);
  const type =
    pickText(source, ["takeover.type", "decision.type"]) ||
    asText(decision?.type);
  const options = uniqueStrings([
    ...takeoverOptionLabels(source),
    ...textListFromValue(detail.decisionPresets).slice(0, 3),
  ]);
  const hasWaitingDecision =
    detail.status === "waiting" &&
    (Boolean(decision) || detail.decisionPresets.length > 0 || Boolean(prompt));

  if (!hasWaitingDecision && !decisionId && !prompt) {
    return null;
  }

  return createBlock({
    value: hasWaitingDecision
      ? t(locale, "DecisionPanel owns waiting task / DecisionPanel 接管等待任务", "DecisionPanel owns waiting task")
      : t(locale, "Decision handoff", "Decision handoff"),
    detail: joinSegments([
      prompt,
      decisionId ? `${t(locale, "决策", "Decision")}: ${decisionId}` : null,
      decisionId && locale === "zh-CN" ? `Decision: ${decisionId}` : null,
      type ? `${t(locale, "Type", "Type")}: ${formatKeyLabel(type)}` : null,
      prefixedSegment(t(locale, "Options", "Options"), options),
      hasWaitingDecision
        ? t(
            locale,
            "The right rail shows a read-only takeover summary; DecisionPanel keeps the single submission surface to avoid duplicate actions.",
            "The right rail shows a read-only takeover summary; DecisionPanel keeps the single submission surface to avoid duplicate actions."
          )
        : null,
    ]),
    badge: hasWaitingDecision ? t(locale, "等待处理", "Waiting") : null,
  });
}

function parseDecisionTakeoverItems(
  detail: MissionTaskDetail,
  source: unknown
): AutopilotTakeoverItem[] {
  const decision = isRecord(detail.decision) ? detail.decision : null;
  const prompt =
    pickText(source, ["takeover.prompt", "decision.prompt"]) ||
    detail.decisionPrompt ||
    asText(decision?.prompt);
  const decisionId =
    pickText(source, ["takeover.decisionId"]) ||
    asText(decision?.decisionId) ||
    (prompt ? `${detail.id}:decision` : null);
  const hasWaitingDecision =
    detail.status === "waiting" &&
    (Boolean(decision) || detail.decisionPresets.length > 0 || Boolean(prompt));

  if (!hasWaitingDecision || !decisionId) return [];

  const projection = projectionSource(source);
  const projectionEventId = pickText(projection, [
    "evidence.eventId",
    "evidence.evidenceEventId",
    "evidenceEventId",
    "eventId",
  ]);
  const projectionRouteId = pickText(projection, [
    "route.selectedRouteId",
    "route.id",
    "selectedRouteId",
    "routeId",
  ]);
  const projectionDriveState = pickText(projection, [
    "driveState.state",
    "driveState.key",
    "state",
  ]);
  const evidenceRefs = uniqueStrings([
    projectionRouteId ? `Route: ${projectionRouteId}` : null,
    projectionDriveState ? `Drive: ${formatKeyLabel(projectionDriveState)}` : null,
  ]);

  return [
    {
      id: decisionId,
      lane: "current",
      type: "decision",
      status: "requested",
      reason:
        prompt ||
        pickText(source, ["takeover.reason", "takeover.detail"]) ||
        "DecisionPanel owns the waiting task submission.",
      recommendedAction:
        "Submit the decision in DecisionPanel; this takeover queue is read-only.",
      blocking: true,
      evidenceEventId: projectionEventId,
      evidenceRefs,
    },
  ];
}

function parseCostRisk(source: unknown, locale: string): AutopilotBlock | null {
  const routeRiskPoints = collectTexts(source, ["route.riskPoints"]);
  const explanationRisks = collectTexts(source, ["explanation.riskSummary"]);
  const evidenceGaps = collectTexts(source, ["evidence.gaps"]);
  const selectedRouteCost = pickText(source, [
    "route.selected.estimatedCost",
    "route.selectedRoute.estimatedCost",
  ]);
  const selectedRouteDuration = pickText(source, [
    "route.selected.estimatedDuration",
    "route.selectedRoute.estimatedDuration",
  ]);
  const routeRiskLevel = pickText(source, [
    "route.selected.riskLevel",
    "route.selectedRoute.riskLevel",
    "driveState.riskLevel",
  ]);
  const takeoverLoad = pickText(source, [
    "route.selected.takeoverLoad",
    "route.selectedRoute.takeoverLoad",
    "takeover.urgency",
  ]);
  const candidateCosts = uniqueStrings(
    recordListFromPaths(source, ["route.candidateRoutes"])
      .map(candidate => pickText(candidate, ["estimatedCost"]))
      .filter((value): value is string => Boolean(value))
  );
  const candidateDurations = uniqueStrings(
    recordListFromPaths(source, ["route.candidateRoutes"])
      .map(candidate => pickText(candidate, ["estimatedDuration"]))
      .filter((value): value is string => Boolean(value))
  );
  const riskSummary = uniqueStrings([
    ...routeRiskPoints,
    ...explanationRisks,
    ...evidenceGaps,
  ]);

  if (
    !selectedRouteCost &&
    !selectedRouteDuration &&
    !routeRiskLevel &&
    !takeoverLoad &&
    candidateCosts.length === 0 &&
    candidateDurations.length === 0 &&
    riskSummary.length === 0
  ) {
    return null;
  }

  return createBlock({
    value:
      routeRiskLevel || selectedRouteCost || selectedRouteDuration
        ? t(locale, "Right rail cost/risk summary / 右栏成本/风险摘要", "Right rail cost/risk summary")
        : summarizeList(riskSummary, 1),
    detail: joinSegments([
      routeRiskLevel
        ? `${t(locale, "Risk", "Risk")}: ${localizeScale(locale, routeRiskLevel)}`
        : null,
      takeoverLoad
        ? `${t(locale, "Takeover Load", "Takeover Load")}: ${localizeScale(
            locale,
            takeoverLoad
          )}`
        : null,
      selectedRouteCost
        ? `${t(locale, "Selected Cost", "Selected Cost")}: ${selectedRouteCost}`
        : null,
      selectedRouteDuration
        ? `${t(locale, "Selected ETA", "Selected ETA")}: ${selectedRouteDuration}`
        : null,
      prefixedSegment(t(locale, "Cost Range", "Cost Range"), candidateCosts, 4),
      prefixedSegment(
        t(locale, "ETA Range", "ETA Range"),
        candidateDurations,
        4
      ),
      prefixedSegment(t(locale, "Risk Signals", "Risk Signals"), riskSummary, 3),
    ]),
    badge: routeRiskLevel ? localizeScale(locale, routeRiskLevel) : null,
  });
}

function enhanceEvidenceBlock(
  source: unknown,
  locale: string,
  block: AutopilotBlock | null
): AutopilotBlock | null {
  if (!block) return block;

  const timelineId = pickText(source, ["evidence.correlation.timelineId"]);
  const routeIds = textListFromValue(getPath(source, "evidence.correlation.routeIds"));
  const routeStageKeys = textListFromValue(
    getPath(source, "evidence.correlation.routeStageKeys")
  );
  const runtimeEventIds = textListFromValue(
    getPath(source, "evidence.correlation.runtimeEventIds")
  );
  const decisionIds = textListFromValue(
    getPath(source, "evidence.correlation.decisionIds")
  );
  const operatorActionIds = textListFromValue(
    getPath(source, "evidence.correlation.operatorActionIds")
  );
  const auditEventIds = textListFromValue(
    getPath(source, "evidence.correlation.auditEventIds")
  );
  const lineageIds = textListFromValue(
    getPath(source, "evidence.correlation.lineageIds")
  );
  const correlationRefs = uniqueStrings([
    pickText(source, ["evidence.correlation.workflowId"])
      ? `${t(locale, "Workflow", "Workflow")}: ${pickText(source, [
          "evidence.correlation.workflowId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.replayId"])
      ? `${t(locale, "Replay", "Replay")}: ${pickText(source, [
          "evidence.correlation.replayId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.sessionId"])
      ? `${t(locale, "Session", "Session")}: ${pickText(source, [
          "evidence.correlation.sessionId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.selectedRouteId"])
      ? `${t(locale, "Selected Route", "Selected Route")}: ${pickText(source, [
          "evidence.correlation.selectedRouteId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.recommendedRouteId"])
      ? `${t(locale, "Recommended Route", "Recommended Route")}: ${pickText(source, [
          "evidence.correlation.recommendedRouteId",
        ])}`
      : null,
    pickText(source, ["evidence.correlation.currentStepKey"])
      ? `${t(locale, "Current Step", "Current Step")}: ${formatKeyLabel(
          pickText(source, ["evidence.correlation.currentStepKey"]) ?? ""
        )}`
      : null,
  ]);
  const correlationCounts = uniqueStrings([
    routeIds.length > 0
      ? `${t(locale, "Routes", "Routes")}: ${routeIds.length}`
      : null,
    routeStageKeys.length > 0
      ? `${t(locale, "Stages", "Stages")}: ${routeStageKeys.length}`
      : null,
    runtimeEventIds.length > 0
      ? `${t(locale, "Runtime Events", "Runtime Events")}: ${runtimeEventIds.length}`
      : null,
    decisionIds.length > 0
      ? `${t(locale, "Decisions", "Decisions")}: ${decisionIds.length}`
      : null,
    operatorActionIds.length > 0
      ? `${t(locale, "Operator Actions", "Operator Actions")}: ${operatorActionIds.length}`
      : null,
    auditEventIds.length > 0
      ? `${t(locale, "Audit Events", "Audit Events")}: ${auditEventIds.length}`
      : null,
    lineageIds.length > 0
      ? `${t(locale, "Lineage", "Lineage")}: ${lineageIds.length}`
      : null,
  ]);
  const detail = joinSegments([
    block.detail,
    prefixedSegment(t(locale, "关联", "Correlation"), correlationRefs, 6),
    timelineId ? `${t(locale, "Timeline", "Timeline")}: ${timelineId}` : null,
    prefixedSegment(t(locale, "Decision IDs", "Decision IDs"), decisionIds, 2),
    prefixedSegment(
      t(locale, "Operator IDs", "Operator IDs"),
      operatorActionIds,
      2
    ),
    prefixedSegment(t(locale, "Audit IDs", "Audit IDs"), auditEventIds, 2),
    prefixedSegment(t(locale, "Lineage IDs", "Lineage IDs"), lineageIds, 2),
    prefixedSegment(t(locale, "索引", "Indexed"), correlationCounts, 7),
  ]);

  return createBlock({
    value: block.value,
    detail,
    badge: block.badge,
  });
}

function enhanceExplanationBlock(
  source: unknown,
  locale: string,
  block: AutopilotBlock | null
): AutopilotBlock | null {
  const currentStateSummary = pickText(source, ["explanation.currentState.summary"]);
  const currentStateDetail = formatExplanationCurrentStateSegment(source, locale);
  const currentStateSources = uniqueStrings(
    collectTexts(source, ["explanation.currentState.sources"]).map(item =>
      formatKeyLabel(item)
    )
  );
  const currentStateUpdatedAt = formatTimestamp(
    locale,
    pickText(source, ["explanation.currentState.updatedAt"])
  );
  const recommendationDetails = uniqueStrings(
    recordListFromPaths(source, ["explanation.recommendationDetails"]).map(item =>
      formatExplanationRecommendationDetail(item, locale)
    )
  );
  const remainingCurrentStep = pickText(source, [
    "explanation.remainingSteps.currentStepLabel",
  ]);
  const remainingPendingSteps = routeRemainingStepLabels(source);
  const remainingParallelBranchCount = pickNumber(source, [
    "explanation.remainingSteps.parallelBranchCount",
  ]);
  const replanChangeSummary = pickText(source, [
    "explanation.remainingSteps.replanChangeSummary",
  ]);
  const detail = joinSegments([
    currentStateSummary,
    currentStateDetail,
    prefixedSegment(t(locale, "来源", "Sources"), currentStateSources, 3),
    currentStateUpdatedAt
      ? `${t(locale, "更新时间", "Updated")}: ${currentStateUpdatedAt}`
      : null,
    prefixedSegment(t(locale, "建议", "Recommendations"), recommendationDetails, 3),
    remainingCurrentStep
      ? `${t(locale, "当前步骤", "Current step")}: ${remainingCurrentStep}`
      : null,
    prefixedSegment(t(locale, "待办", "Pending"), remainingPendingSteps),
    remainingParallelBranchCount !== null && remainingParallelBranchCount > 0
      ? `${t(locale, "并行分支", "Parallel branches")}: ${remainingParallelBranchCount}`
      : null,
    replanChangeSummary
      ? `${t(locale, "计划变更", "Plan Change")}: ${replanChangeSummary}`
      : null,
    block?.detail,
  ]);
  const value =
    block?.value ||
    currentStateSummary ||
    summarizeList(recommendationDetails, 1) ||
    summarizeList(remainingPendingSteps, 1);

  return createBlock({
    value,
    detail,
    badge: block?.badge,
  });
}

function parseAutopilotSummary(
  detail: MissionTaskDetail,
  locale: string
): ParsedAutopilotSummary | null {
  const raw = (detail as MissionTaskDetail & { autopilotSummary?: unknown })
    .autopilotSummary;

  if (!isRecord(raw)) {
    return null;
  }

  const decision = parseDecisionHandoff(detail, raw, locale);
  const decisionPanelOwnsWaitingTask =
    detail.status === "waiting" && Boolean(decision);
  const takeoverItems = parseDecisionTakeoverItems(detail, raw);
  const parsed = {
    destination: parseDestination(raw, locale),
    route: parseRoute(raw, locale),
    execution: parseExecution(raw, locale),
    driveState: parseDriveState(raw, locale),
    fleet: parseFleet(raw, locale),
    fleetRoles: buildFleetRoleCardsFromSummary(raw),
    fleetLegacyText: buildFleetLegacyText(raw, locale),
    blockers: decisionPanelOwnsWaitingTask ? null : parseBlockers(raw, locale),
    recovery: parseRecovery(raw, locale),
    outputs: parseOutputs(raw, locale),
    evidence: enhanceEvidenceBlock(raw, locale, parseEvidence(raw, locale)),
    explanation: enhanceExplanationBlock(raw, locale, parseExplanation(raw, locale)),
    takeover: decisionPanelOwnsWaitingTask ? null : parseTakeover(raw, locale),
    takeoverItems,
    decision,
    costRisk: parseCostRisk(raw, locale),
  };

  return Object.values(parsed).some(Boolean) ? parsed : null;
}

function SummaryBlock({
  title,
  block,
  testId,
  wide: _wide,
}: {
  title: string;
  block: AutopilotBlock;
  testId: string;
  wide?: boolean;
}) {
  return (
    <section className={BLOCK_CLASS} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
          {title}
        </div>
        {block.badge ? (
          <span className="workspace-status workspace-tone-info bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
            {block.badge}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium leading-6 text-stone-900">
        {block.value}
      </div>
      {block.detail ? (
        <div className="mt-1 text-[11px] leading-5 text-stone-500">
          {block.detail}
        </div>
      ) : null}
    </section>
  );
}

function SummaryGroup({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="space-y-3" data-testid={testId}>
      {children}
    </div>
  );
}

function FleetSummaryBlock({
  locale,
  summary,
}: {
  locale: string;
  summary: ParsedAutopilotSummary;
}) {
  if (!summary.fleet) return null;

  if (summary.fleetRoles && summary.fleetRoles.length > 0) {
    return (
      <div
        className="space-y-2"
        data-testid="task-autopilot-fleet"
        data-fleet-source="AutopilotFleetLiveView"
      >
        {summary.fleetLegacyText ? (
          <div
            className="sr-only"
            data-testid="task-autopilot-fleet-legacy-summary"
          >
            {summary.fleetLegacyText}
          </div>
        ) : null}
        <AutopilotFleetLiveView
          className="rounded-[12px] p-3 shadow-none"
          roles={summary.fleetRoles}
          takeoverAnchorId="task-autopilot-takeover"
        />
      </div>
    );
  }

  return (
    <SummaryBlock
      title={t(locale, "\u7f16\u961f", "Fleet")}
      block={summary.fleet}
      testId="task-autopilot-fleet"
    />
  );
}

function SummarySingleBlockSlot({
  title,
  block,
  testId,
  groupTestId,
}: {
  title: string;
  block?: AutopilotBlock | null;
  testId: string;
  groupTestId: string;
}) {
  if (!block) return null;

  return (
    <SummaryGroup testId={groupTestId}>
      <SummaryBlock title={title} block={block} testId={testId} />
    </SummaryGroup>
  );
}

function LiveDriveSlot({
  locale,
  summary,
}: {
  locale: string;
  summary: ParsedAutopilotSummary;
}) {
  return (
    <SummaryGroup testId="task-autopilot-cockpit-drive-fleet-outputs">
      {summary.execution ? (
        <SummaryBlock
          title={t(locale, "\u5f53\u524d\u6267\u884c", "Live Execution")}
          block={summary.execution}
          testId="task-autopilot-execution"
        />
      ) : null}
      {summary.driveState ? (
        <SummaryBlock
          title={t(locale, "\u9a7e\u9a76\u72b6\u6001", "Drive State")}
          block={summary.driveState}
          testId="task-autopilot-drive-state"
        />
      ) : null}
      <FleetSummaryBlock locale={locale} summary={summary} />
      {summary.outputs ? (
        <SummaryBlock
          title={t(locale, "\u4e2d\u95f4\u4ea7\u7269", "Outputs")}
          block={summary.outputs}
          testId="task-autopilot-outputs"
        />
      ) : null}
    </SummaryGroup>
  );
}

function TakeoverSlot({
  locale,
  summary,
}: {
  locale: string;
  summary: ParsedAutopilotSummary;
}) {
  return (
    <SummaryGroup testId="task-autopilot-cockpit-decision-takeover">
      {summary.decision ? (
        <SummaryBlock
          title={t(locale, "DecisionPanel", "DecisionPanel")}
          block={summary.decision}
          testId="task-autopilot-decision-handoff"
        />
      ) : null}
      {summary.takeoverItems && summary.takeoverItems.length > 0 ? (
        <AutopilotTakeoverControlPanel
          className="shadow-none"
          items={summary.takeoverItems}
        />
      ) : null}
      {summary.takeover ? (
        <SummaryBlock
          title={t(locale, "\u63a5\u7ba1", "Takeover")}
          block={summary.takeover}
          testId="task-autopilot-takeover"
        />
      ) : null}
      {summary.blockers ? (
        <SummaryBlock
          title={t(locale, "\u963b\u585e\u70b9", "Blockers")}
          block={summary.blockers}
          testId="task-autopilot-blockers"
        />
      ) : null}
      {summary.recovery ? (
        <SummaryBlock
          title={t(locale, "Recovery", "Recovery")}
          block={summary.recovery}
          testId="task-autopilot-recovery"
        />
      ) : null}
    </SummaryGroup>
  );
}

function EvidenceSlot({
  locale,
  summary,
}: {
  locale: string;
  summary: ParsedAutopilotSummary;
}) {
  return (
    <SummaryGroup testId="task-autopilot-cockpit-evidence-cost-risk">
      {summary.costRisk ? (
        <SummaryBlock
          title={t(locale, "Cost / Risk", "Cost / Risk")}
          block={summary.costRisk}
          testId="task-autopilot-cost-risk"
        />
      ) : null}
      {summary.evidence ? (
        <SummaryBlock
          title={t(locale, "\u8bc1\u636e", "Evidence")}
          block={summary.evidence}
          testId="task-autopilot-evidence"
        />
      ) : null}
      {summary.explanation ? (
        <SummaryBlock
          title={t(locale, "Explanation", "Explanation")}
          block={summary.explanation}
          testId="task-autopilot-explanation"
        />
      ) : null}
    </SummaryGroup>
  );
}

export function TaskAutopilotPanel({
  detail,
}: {
  detail: MissionTaskDetail;
}) {
  const { locale } = useI18n();
  const parsedSummary = parseAutopilotSummary(detail, locale);

  if (!parsedSummary) {
    return null;
  }
  const summary = parsedSummary;
  const renderedSummary: ParsedAutopilotSummary = summary;

  return (
    <Card className={PANEL_CLASS} data-testid="task-autopilot-panel">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Sparkles className="size-4 text-teal-600" />
          {t(locale, "\u81ea\u52a8\u9a7e\u9a76\u6458\u8981", "Autopilot Summary")}
        </CardTitle>
        <CardDescription>
          {t(
            locale,
            "\u57fa\u4e8e\u5f53\u524d\u4efb\u52a1\u7684 autopilotSummary\uff0c\u5feb\u901f\u67e5\u770b\u76ee\u7684\u5730\u3001\u8def\u7ebf\u9009\u62e9\u3001\u5f53\u524d\u6267\u884c\u3001\u9a7e\u9a76\u72b6\u6001\u3001\u7f16\u961f\u3001\u963b\u585e\u3001\u6062\u590d\u3001\u4e2d\u95f4\u4ea7\u7269\u3001\u8bc1\u636e\u3001\u89e3\u91ca\u4e0e\u63a5\u7ba1\u4fe1\u53f7\u3002",
            "A quick view of the current destination, route selection, live execution, drive state, fleet, blockers, recovery, outputs, evidence, explanation, and takeover signal."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <AutopilotCockpitLayout
          className="rounded-[24px] p-3"
          destination={
            <SummarySingleBlockSlot
              title={t(locale, "\u76ee\u7684\u5730", "Destination")}
              block={renderedSummary.destination}
              testId="task-autopilot-destination"
              groupTestId="task-autopilot-cockpit-destination-route"
            />
          }
          route={
            <SummarySingleBlockSlot
              title={t(locale, "\u8def\u7ebf", "Route")}
              block={renderedSummary.route}
              testId="task-autopilot-route"
              groupTestId="task-autopilot-cockpit-route"
            />
          }
          liveDrive={<LiveDriveSlot locale={locale} summary={renderedSummary} />}
          takeover={<TakeoverSlot locale={locale} summary={renderedSummary} />}
          evidence={<EvidenceSlot locale={locale} summary={renderedSummary} />}
        />
        {false ? (
        <div className="hidden" aria-hidden="true" data-testid="task-autopilot-legacy-grid-shadow">
          {renderedSummary.destination ? null : null}
          {renderedSummary.route ? null : null}
          {renderedSummary.execution ? null : null}
          {renderedSummary.driveState ? null : null}
          {renderedSummary.fleet ? null : null}
          {renderedSummary.blockers ? null : null}
          {renderedSummary.recovery ? (
            <SummaryBlock
              title={t(locale, "恢复", "Recovery")}
              block={renderedSummary.recovery}
              testId="task-autopilot-recovery"
            />
          ) : null}
          {renderedSummary.outputs ? (
            <SummaryBlock
              title={t(locale, "\u4e2d\u95f4\u4ea7\u7269", "Outputs")}
              block={renderedSummary.outputs}
              testId="task-autopilot-outputs"
              wide
            />
          ) : null}
          {renderedSummary.evidence ? (
            <SummaryBlock
              title={t(locale, "\u8bc1\u636e", "Evidence")}
              block={renderedSummary.evidence}
              testId="task-autopilot-evidence"
            />
          ) : null}
          {renderedSummary.explanation ? (
            <SummaryBlock
              title={t(locale, "解释", "Explanation")}
              block={renderedSummary.explanation}
              testId="task-autopilot-explanation"
              wide
            />
          ) : null}
          {renderedSummary.takeover ? (
            <SummaryBlock
              title={t(locale, "\u63a5\u7ba1", "Takeover")}
              block={renderedSummary.takeover}
              testId="task-autopilot-takeover"
            />
          ) : null}
        </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
