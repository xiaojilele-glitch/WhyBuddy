import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionTaskDetail, MissionTaskSummary } from "../tasks-store";
import { useSandboxStore } from "../sandbox-store";
import { resolveSandboxMonitorMission } from "../../components/three/sandbox-monitor-helpers";

type SocketHandler = (...args: any[]) => void;

const socketHandlers = new Map<string, SocketHandler>();
const socketEmit = vi.fn();
const mockSocket = {
  on: vi.fn((event: string, handler: SocketHandler) => {
    socketHandlers.set(event, handler);
    return mockSocket;
  }),
  emit: socketEmit,
};

function makeMission(
  overrides?: Partial<MissionTaskSummary>
): MissionTaskSummary {
  return {
    id: "mission-1",
    title: "Mission One",
    kind: "chat",
    sourceText: "Mission source",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 52,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    summary: "Mission summary",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: 1_710_000_000_000,
    updatedAt: 1_710_000_000_100,
    startedAt: 1_710_000_000_000,
    completedAt: null,
    departmentLabels: [],
    taskCount: 1,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    ...overrides,
  };
}

function makeDetail(id: string): MissionTaskDetail {
  return {
    ...makeMission({
      id,
      title: `Mission ${id}`,
      updatedAt: 1_710_000_000_300,
    }),
    workflow: {
      id: `wf-${id}`,
      directive: `Directive ${id}`,
      status: "running",
      current_stage: "execute",
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date(1_710_000_000_000).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    runtimeChannels: {
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Mission socket is connected and can receive live runtime updates.",
      },
      callback: {
        status: "active",
        label: "Relay job.running",
        detail: "Last runtime relay at now. Job job-1.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
  };
}

describe("sandbox-store active mission recovery", () => {
  beforeEach(() => {
    socketHandlers.clear();
    socketEmit.mockReset();
    useSandboxStore.getState().reset();
    useSandboxStore.getState().initSocket(mockSocket as any);
  });

  it("requests log history when the restored selected mission becomes active", () => {
    const tasks = [makeMission({ id: "mission-1" }), makeMission({ id: "mission-2" })];
    const detailsById = {
      "mission-2": makeDetail("mission-2"),
    };

    const { displayMission } = resolveSandboxMonitorMission(
      tasks,
      detailsById,
      "mission-2"
    );

    useSandboxStore.getState().setActiveMission(displayMission?.id ?? null);

    expect(useSandboxStore.getState().activeMissionId).toBe("mission-2");
    expect(socketEmit).toHaveBeenCalledWith("request_log_history", {
      missionId: "mission-2",
    });
  });

  it("re-requests log history for the restored mission after socket reconnect", () => {
    useSandboxStore.getState().setActiveMission("mission-2");
    socketEmit.mockClear();

    const connectHandler = socketHandlers.get("connect");
    expect(connectHandler).toBeTypeOf("function");

    connectHandler?.();

    expect(socketEmit).toHaveBeenCalledWith("request_log_history", {
      missionId: "mission-2",
    });
  });
});
