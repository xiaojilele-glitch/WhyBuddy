import type { MissionTaskDetail, MissionTaskStatus } from "@/lib/tasks-store";

export type MissionFlowStepKey = "plan" | "execute" | "review";
export type MissionFlowStepState =
  | "pending"
  | "active"
  | "completed"
  | "failed";

export interface MissionFlowStepSummary {
  key: MissionFlowStepKey;
  state: MissionFlowStepState;
}

const FLOW_ORDER: MissionFlowStepKey[] = ["plan", "execute", "review"];

const PLAN_HINTS = [
  "receive",
  "understand",
  "plan",
  "planning",
  "direction",
  "scope",
  "brief",
  "provision",
];

const REVIEW_HINTS = [
  "review",
  "verify",
  "audit",
  "approve",
  "approval",
  "final",
  "finalize",
  "summary",
  "handoff",
];

function includesAny(source: string, hints: string[]) {
  return hints.some(hint => source.includes(hint));
}

export function resolveMissionFlowCurrentStep(input: {
  currentStageKey?: string | null;
  status?: MissionTaskStatus | null;
}): MissionFlowStepKey {
  const normalizedStage = input.currentStageKey?.trim().toLowerCase() ?? "";

  if (includesAny(normalizedStage, REVIEW_HINTS)) {
    return "review";
  }

  if (includesAny(normalizedStage, PLAN_HINTS)) {
    return "plan";
  }

  if (normalizedStage.length > 0) {
    return "execute";
  }

  if (input.status === "queued") {
    return "plan";
  }

  if (input.status === "done" || input.status === "cancelled") {
    return "review";
  }

  return "execute";
}

export function buildMissionFlowSteps(
  detail: Pick<MissionTaskDetail, "currentStageKey" | "status"> | null
): MissionFlowStepSummary[] {
  if (!detail) {
    return FLOW_ORDER.map(key => ({ key, state: "pending" }));
  }

  if (detail.status === "done" || detail.status === "cancelled") {
    return FLOW_ORDER.map(key => ({ key, state: "completed" }));
  }

  const currentStep = resolveMissionFlowCurrentStep(detail);
  const activeIndex = FLOW_ORDER.indexOf(currentStep);

  return FLOW_ORDER.map((key, index) => {
    if (index < activeIndex) {
      return { key, state: "completed" };
    }

    if (index > activeIndex) {
      return { key, state: "pending" };
    }

    return {
      key,
      state: detail.status === "failed" ? "failed" : "active",
    };
  });
}
