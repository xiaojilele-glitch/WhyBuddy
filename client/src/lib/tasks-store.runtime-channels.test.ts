import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionPlanetOverviewItem, MissionRecord } from "@shared/mission/contracts";
import { MISSION_SOCKET_EVENT, MISSION_SOCKET_TYPES } from "@shared/mission/socket";
import type { ExecutorEvent } from "@shared/executor/contracts";

const mockListMissions = vi.fn();
const mockListPlanets = vi.fn();
const mockGetPlanetInterior = vi.fn();
const mockGetMission = vi.fn();
const mockSocketOn = vi.fn();
const mockSocketOff = vi.fn();
const mockSocketDisconnect = vi.fn();

vi.mock("./mission-client", () => ({
  cancelMission: vi.fn(),
  createMission: vi.fn(),
  getMission: (...args: unknown[]) => mockGetMission(...args),
  getPlanet: vi.fn(),
  getPlanetInterior: (...args: unknown[]) => mockGetPlanetInterior(...args),
  listMissionEvents: vi.fn(),
  listMissions: (...args: unknown[]) => mockListMissions(...args),
  listPlanets: (...args: unknown[]) => mockListPlanets(...args),
  submitMissionDecision: vi.fn(),
  submitMissionOperatorAction: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: mockSocketOn,
    off: mockSocketOff,
    disconnect: mockSocketDisconnect,
  })),
}));

vi.mock("./sandbox-store", () => ({
  useSandboxStore: {
    getState: () => ({
      initSocket: vi.fn(),
    }),
  },
}));

vi.mock("./store", () => ({
  useAppStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ runtimeMode: "advanced" }),
      subscribe: vi.fn(),
    }
  ),
}));

const now = Date.now();

function makeMission(
  id: string,
  overrides?: Partial<MissionRecord>
): MissionRecord {
  return {
    id,
    kind: "analysis",
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    status: "running",
    progress: 65,
    currentStageKey: "execute",
    stages: [
      { key: "receive", label: "Receive", status: "done" },
      { key: "execute", label: "Execute", status: "running" },
    ],
    createdAt: now - 10_000,
    updatedAt: now,
    events: [],
    artifacts: [],
    operatorState: "active",
    operatorActions: [],
    attempt: 1,
    ...overrides,
  };
}

function makePlanet(
  id: string,
  overrides?: Partial<MissionPlanetOverviewItem>
): MissionPlanetOverviewItem {
  return {
    id,
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    kind: "analysis",
    status: "running",
    progress: 65,
    complexity: 3,
    radius: 48,
    position: { x: 0, y: 0 },
    createdAt: now - 10_000,
    updatedAt: now,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    tags: ["Platform"],
    taskUrl: `/tasks/${id}`,
    ...overrides,
  };
}

async function loadStoreWithMission(mission: MissionRecord) {
  vi.resetModules();
  mockSocketOn.mockReset();
  mockSocketOff.mockReset();
  mockSocketDisconnect.mockReset();
  mockGetMission.mockResolvedValue({ ok: true, task: mission });
  mockListPlanets.mockResolvedValue({
    ok: true,
    planets: [makePlanet(mission.id)],
    edges: [],
  });
  mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
  mockGetPlanetInterior.mockRejectedValue(new Error("no interior"));

  const mod = await import("./tasks-store");
  const { useTasksStore } = mod;

  useTasksStore.setState({
    ready: false,
    loading: false,
    error: null,
    missionSocketConnected: false,
    selectedTaskId: null,
    tasks: [],
    detailsById: {},
    decisionNotes: {},
    cancellingMissionIds: {},
    operatorActionLoadingByMissionId: {},
    lastDecisionLaunch: null,
  });

  await useTasksStore.getState().refresh();
  return useTasksStore;
}

function findSocketHandler() {
  return mockSocketOn.mock.calls.find(call => call[0] === MISSION_SOCKET_EVENT)?.[1];
}

function findConnectHandler() {
  return mockSocketOn.mock.calls.find(call => call[0] === "connect")?.[1];
}

function findDisconnectHandler() {
  return mockSocketOn.mock.calls.find(call => call[0] === "disconnect")?.[1];
}

describe("tasks-store runtime channel summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      setTimeout,
      clearTimeout,
    });
  });

  it("derives a more readable callback summary from mission executor state", async () => {
    const useTasksStore = await loadStoreWithMission(
      makeMission("mission-1", {
        status: "waiting",
        events: [
          {
            type: "log",
            source: "executor",
            message: "Waiting for callback approval from runtime gateway.",
            time: now - 1_000,
          },
        ],
        executor: {
          name: "lobster",
          jobId: "job-42",
          requestId: "req-7",
          status: "waiting",
          lastEventType: "job.waiting",
          lastEventAt: now - 2_000,
        },
      })
    );

    const detail = useTasksStore.getState().detailsById["mission-1"];
    expect(detail.runtimeChannels.callback.status).toBe("waiting");
    expect(detail.runtimeChannels.callback.label).toBe("Callback waiting");
    expect(detail.runtimeChannels.callback.detail).toContain("Callback waiting");
    expect(detail.runtimeChannels.callback.detail).toContain("Job job-42.");
    expect(detail.runtimeChannels.callback.detail).toContain("Request req-7.");
    expect(detail.runtimeChannels.callback.eventSummary).toContain(
      "Waiting for callback approval from runtime gateway."
    );
  });

  it("updates callback runtime channel from executor socket relays", async () => {
    const useTasksStore = await loadStoreWithMission(
      makeMission("mission-2", {
        executor: {
          name: "lobster",
          jobId: "job-84",
          status: "running",
        },
      })
    );

    const socketHandler = findSocketHandler();
    expect(socketHandler).toBeTypeOf("function");

    const executorEvent: ExecutorEvent = {
      version: "2026-03-28",
      eventId: "event-1",
      missionId: "mission-2",
      jobId: "job-84",
      executor: "lobster",
      type: "job.screenshot",
      status: "running",
      occurredAt: new Date(now).toISOString(),
      message: "Screenshot captured for browser live panel",
      summary: "Browser live frame captured successfully.",
    };

    socketHandler({
      type: MISSION_SOCKET_TYPES.executorEvent,
      missionId: "mission-2",
      event: executorEvent,
    });

    const detail = useTasksStore.getState().detailsById["mission-2"];
    expect(detail.runtimeChannels.callback.status).toBe("active");
    expect(detail.runtimeChannels.callback.label).toBe("Relay screenshot update");
    expect(detail.runtimeChannels.callback.detail).toContain("Relay screenshot update");
    expect(detail.runtimeChannels.callback.detail).toContain("Job job-84.");
    expect(detail.runtimeChannels.callback.eventType).toBe("job.screenshot");
    expect(detail.runtimeChannels.callback.eventSummary).toContain(
      "Browser live frame captured successfully."
    );
  });

  it("keeps socket runtime channels in sync with connect and disconnect events", async () => {
    const useTasksStore = await loadStoreWithMission(makeMission("mission-3"));

    const connectHandler = findConnectHandler();
    const disconnectHandler = findDisconnectHandler();
    expect(connectHandler).toBeTypeOf("function");
    expect(disconnectHandler).toBeTypeOf("function");

    connectHandler();
    expect(useTasksStore.getState().detailsById["mission-3"].runtimeChannels.socket).toMatchObject({
      status: "connected",
      label: "Socket connected",
    });

    disconnectHandler();
    expect(useTasksStore.getState().detailsById["mission-3"].runtimeChannels.socket).toMatchObject({
      status: "disconnected",
      label: "Socket disconnected",
    });
  });
});
