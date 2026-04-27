import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type AutopilotFleetRole =
  | "planner"
  | "clarifier"
  | "researcher"
  | "generator"
  | "reviewer"
  | "auditor"
  | "operator";

export type AutopilotFleetRoleStatus =
  | "idle"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "done";

export type AutopilotFleetRoleCard = {
  id: string;
  role: AutopilotFleetRole;
  title?: string;
  status: AutopilotFleetRoleStatus;
  currentFocus?: string | null;
  currentAction?: string | null;
  waitingReason?: string | null;
  latestArtifact?: string | null;
  boundAgents?: string[];
  laneId?: string | null;
  laneLabel?: string | null;
  takeoverAnchorId?: string | null;
};

export type AutopilotFleetLiveViewProps = {
  roles: AutopilotFleetRoleCard[];
  takeoverAnchorId?: string;
  onOpenTakeover?: (role: AutopilotFleetRoleCard) => void;
  className?: string;
};

type FleetLane = {
  id: string;
  label: string;
  roles: AutopilotFleetRoleCard[];
};

const ROLE_ORDER: AutopilotFleetRole[] = [
  "planner",
  "clarifier",
  "researcher",
  "generator",
  "reviewer",
  "auditor",
  "operator",
];

function roleLabel(role: AutopilotFleetRole): string {
  switch (role) {
    case "planner":
      return "Planner";
    case "clarifier":
      return "Clarifier";
    case "researcher":
      return "Researcher";
    case "generator":
      return "Generator";
    case "reviewer":
      return "Reviewer";
    case "auditor":
      return "Auditor";
    case "operator":
      return "Operator";
  }
}

function statusLabel(status: AutopilotFleetRoleStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "done":
      return "Done";
  }
}

function statusTone(status: AutopilotFleetRoleStatus): string {
  switch (status) {
    case "running":
      return "border-teal-300 bg-teal-50 text-teal-950";
    case "blocked":
      return "border-amber-300 bg-amber-50 text-amber-950 shadow-[0_10px_26px_rgba(217,119,6,0.14)]";
    case "failed":
      return "border-rose-300 bg-rose-50 text-rose-950";
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
    case "waiting":
      return "border-sky-200 bg-sky-50 text-sky-950";
    case "idle":
      return "border-[var(--workspace-panel-border)] bg-white/64 text-stone-700";
  }
}

function derivedLaneId(role: AutopilotFleetRole): string {
  switch (role) {
    case "planner":
    case "clarifier":
      return "planning";
    case "researcher":
    case "generator":
      return "production";
    case "reviewer":
    case "auditor":
    case "operator":
      return "governance";
  }
}

function derivedLaneLabel(laneId: string): string {
  switch (laneId) {
    case "planning":
      return "Planning lane";
    case "production":
      return "Production lane";
    case "governance":
      return "Governance lane";
    default:
      return laneId
        .split(/[-_]/)
        .filter(Boolean)
        .map(token => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
        .join(" ");
  }
}

function sortRoles(roles: AutopilotFleetRoleCard[]): AutopilotFleetRoleCard[] {
  return [...roles].sort((left, right) => {
    const leftIndex = ROLE_ORDER.indexOf(left.role);
    const rightIndex = ROLE_ORDER.indexOf(right.role);
    return leftIndex - rightIndex;
  });
}

function groupRolesByLane(roles: AutopilotFleetRoleCard[]): FleetLane[] {
  const lanes = new Map<string, FleetLane>();

  for (const role of sortRoles(roles)) {
    const laneId = role.laneId?.trim() || derivedLaneId(role.role);
    const laneLabel = role.laneLabel?.trim() || derivedLaneLabel(laneId);
    const lane = lanes.get(laneId) ?? {
      id: laneId,
      label: laneLabel,
      roles: [],
    };
    lane.roles.push(role);
    lanes.set(laneId, lane);
  }

  return Array.from(lanes.values());
}

function roleBindingSummary(
  agents: string[],
  role: AutopilotFleetRole
): string {
  if (agents.length === 0) {
    return "No bound agents";
  }

  return `${agents.length} ${roleLabel(role)} binding${agents.length === 1 ? "" : "s"}`;
}

export function AutopilotFleetLiveView({
  roles,
  takeoverAnchorId = "autopilot-takeover-panel",
  onOpenTakeover,
  className,
}: AutopilotFleetLiveViewProps) {
  useI18n();
  const lanes = groupRolesByLane(roles);
  const blockedCount = roles.filter(role => role.status === "blocked").length;
  const runningCount = roles.filter(role => role.status === "running").length;

  return (
    <section
      className={cn(
        "workspace-panel rounded-[18px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.72)] p-4",
        className
      )}
      data-testid="autopilot-fleet-live-view"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Fleet Live View
          </div>
          <div className="mt-1 text-sm font-semibold text-stone-900">
            Roles: {roles.length}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className="workspace-status bg-teal-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-800">
            Running: {runningCount}
          </span>
          {blockedCount > 0 ? (
            <span className="workspace-status bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
              Blocked: {blockedCount}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        data-testid="fleet-lanes"
      >
        {lanes.map(lane => (
          <section
            key={lane.id}
            className="rounded-[18px] border border-[var(--workspace-panel-border)] bg-white/45 p-3"
            data-lane-id={lane.id}
            data-testid={`fleet-lane-${lane.id}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">
                {lane.label}
              </div>
              <span className="workspace-status bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                {lane.roles.length}
              </span>
            </div>

            <div className="grid gap-3">
              {lane.roles.map(role => {
                const label = role.title || roleLabel(role.role);
                const agents = role.boundAgents ?? [];
                const roleTakeoverAnchorId =
                  role.takeoverAnchorId?.trim() || takeoverAnchorId;

                return (
                  <article
                    key={role.id}
                    className={cn(
                      "rounded-[16px] border p-3",
                      statusTone(role.status)
                    )}
                    data-status={role.status}
                    data-testid={`fleet-role-${role.role}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{label}</div>
                        {role.title ? (
                          <div className="mt-0.5 text-[11px] opacity-70">
                            {roleLabel(role.role)}
                          </div>
                        ) : null}
                      </div>
                      <span className="workspace-status bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]">
                        {statusLabel(role.status)}
                      </span>
                    </div>

                    <div className="mt-3 text-[11px] leading-5">
                      <span className="font-semibold">Current Focus:</span>{" "}
                      {role.currentFocus || "Waiting for assignment"}
                    </div>

                    {role.currentAction ? (
                      <div className="mt-1 text-[11px] leading-5">
                        <span className="font-semibold">Current Action:</span>{" "}
                        {role.currentAction}
                      </div>
                    ) : null}

                    {role.waitingReason ? (
                      <div className="mt-1 text-[11px] leading-5">
                        <span className="font-semibold">Waiting Reason:</span>{" "}
                        {role.waitingReason}
                      </div>
                    ) : null}

                    {role.latestArtifact ? (
                      <div className="mt-1 text-[11px] leading-5">
                        <span className="font-semibold">Latest Artifact:</span>{" "}
                        {role.latestArtifact}
                      </div>
                    ) : null}

                    {role.status === "blocked" ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <a
                          className="workspace-status bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900"
                          data-takeover-anchor={roleTakeoverAnchorId}
                          data-testid={`fleet-role-${role.role}-takeover-link`}
                          href={`#${roleTakeoverAnchorId}`}
                        >
                          Open takeover
                        </a>
                        {onOpenTakeover ? (
                          <button
                            className="workspace-status bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900"
                            data-testid={`fleet-role-${role.role}-takeover-callback`}
                            type="button"
                            onClick={() => onOpenTakeover(role)}
                          >
                            Focus takeover
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-medium">
                        {roleBindingSummary(agents, role.role)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
