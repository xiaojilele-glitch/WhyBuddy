import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MissionPlanetInteriorData,
  MissionPlanetOverviewItem,
  MissionRecord,
} from "@shared/mission/contracts";
import type {
  GetMissionPlanetInteriorResponse,
  ListMissionPlanetsResponse,
  ListMissionsResponse,
} from "@shared/mission/api";

const mockListPlanets = vi.fn<() => Promise<ListMissionPlanetsResponse>>();
const mockListMissions = vi.fn<() => Promise<ListMissionsResponse>>();
const mockGetPlanetInterior = vi.fn<() => Promise<GetMissionPlanetInteriorResponse>>();

vi.mock("./mission-client", () => ({
  cancelMission: vi.fn(),
  createMission: vi.fn(),
  getMission: vi.fn(),
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
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
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

function makeMission(id: string, overrides?: Partial<MissionRecord>): MissionRecord {
  return {
    id,
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    kind: "general",
    status: "running",
    progress: 50,
    stages: [
      { key: "receive", label: "Receive", status: "done" },
      { key: "planning", label: "Planning", status: "running" },
      { key: "execution", label: "Execution", status: "pending" },
    ],
    events: [],
    artifacts: [],
    createdAt: now - 10_000,
    updatedAt: now,
    ...overrides,
  } as MissionRecord;
}

function makePlanet(
  id: string,
  overrides?: Partial<MissionPlanetOverviewItem>
): MissionPlanetOverviewItem {
  return {
    id,
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    kind: "general",
    status: "running",
    progress: 50,
    complexity: 3,
    radius: 45,
    position: { x: 0, y: 0 },
    createdAt: now - 10_000,
    updatedAt: now,
    currentStageKey: "planning",
    currentStageLabel: "Planning",
    tags: ["Engineering"],
    taskUrl: `/tasks/${id}`,
    ...overrides,
  };
}

function makeInterior(): MissionPlanetInteriorData {
  return {
    stages: [
      {
        key: "receive",
        label: "Receive",
        status: "done",
        progress: 100,
        arcStart: 0,
        arcEnd: 120,
        midAngle: 60,
      },
      {
        key: "planning",
        label: "Planning",
        status: "running",
        progress: 50,
        arcStart: 120,
        arcEnd: 240,
        midAngle: 180,
      },
      {
        key: "execution",
        label: "Execution",
        status: "pending",
        progress: 0,
        arcStart: 240,
        arcEnd: 360,
        midAngle: 300,
      },
    ],
    agents: [
      {
        id: "mission-core",
        name: "Mission Core",
        role: "orchestrator",
        sprite: "cube-brain",
        status: "working",
        stageKey: "planning",
        stageLabel: "Planning",
        angle: 180,
      },
    ],
    events: [],
  };
}

describe("tasks-store planet hydration via public store behavior", () => {
  let useTasksStore: typeof import("./tasks-store").useTasksStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import("./tasks-store");
    useTasksStore = mod.useTasksStore;
    useTasksStore.setState({
      ready: false,
      loading: false,
      error: null,
      selectedTaskId: null,
      tasks: [],
      detailsById: {},
      decisionNotes: {},
      cancellingMissionIds: {},
      operatorActionLoadingByMissionId: {},
      lastDecisionLaunch: null,
    });
  });

  it("refresh loads summaries and details through the public store", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockRejectedValue(new Error("not selected"));

    await useTasksStore.getState().refresh();

    const state = useTasksStore.getState();
    expect(mockListPlanets).toHaveBeenCalledWith(200);
    expect(mockListMissions).toHaveBeenCalledWith(200);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("m1");
    expect(state.detailsById).toHaveProperty("m1");
  });

  it("uses the currently selected task to fetch planet interior data", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    useTasksStore.setState({ selectedTaskId: "m1" });
    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet,
      interior: makeInterior(),
    });

    await useTasksStore.getState().refresh();

    const state = useTasksStore.getState();
    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m1");
    expect(state.selectedTaskId).toBe("m1");
    expect(state.detailsById.m1.stages).toHaveLength(3);
    expect(state.detailsById.m1.agents).toHaveLength(1);
  });

  it("falls back to mission-native detail when planet interior loading fails", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    useTasksStore.setState({ selectedTaskId: "m1" });
    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockRejectedValue(new Error("Network error"));

    await useTasksStore.getState().refresh();

    const state = useTasksStore.getState();
    expect(state.detailsById.m1).toBeDefined();
    expect(state.detailsById.m1.stages.length).toBeGreaterThan(0);
    expect(state.ready).toBe(true);
  });

  it("honors preferredTaskId and keeps summaries sorted by updatedAt descending", async () => {
    const olderPlanet = makePlanet("m1", { updatedAt: now - 5_000 });
    const newerPlanet = makePlanet("m2", { updatedAt: now });
    const olderMission = makeMission("m1", { updatedAt: now - 5_000 });
    const newerMission = makeMission("m2", { updatedAt: now });

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [olderPlanet, newerPlanet],
      edges: [],
    });
    mockListMissions.mockResolvedValue({
      ok: true,
      tasks: [olderMission, newerMission],
    });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet: newerPlanet,
      interior: makeInterior(),
    });

    await useTasksStore.getState().refresh({ preferredTaskId: "m2" });

    const state = useTasksStore.getState();
    expect(state.selectedTaskId).toBe("m2");
    expect(state.tasks.map((task) => task.id)).toEqual(["m2", "m1"]);
    expect(mockGetPlanetInterior).toHaveBeenCalledTimes(1);
    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m2");
  });

  it("restores the persisted task focus when store selection is empty", async () => {
    const olderPlanet = makePlanet("m1", { updatedAt: now - 5_000 });
    const newerPlanet = makePlanet("m2", { updatedAt: now });
    const olderMission = makeMission("m1", { updatedAt: now - 5_000 });
    const newerMission = makeMission("m2", { updatedAt: now });
    const getItemSpy =
      typeof window !== "undefined"
        ? vi
            .spyOn(window.sessionStorage, "getItem")
            .mockImplementation(key =>
              key === "cube-office:selected-task-id" ? "m2" : null
            )
        : null;

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [olderPlanet, newerPlanet],
      edges: [],
    });
    mockListMissions.mockResolvedValue({
      ok: true,
      tasks: [olderMission, newerMission],
    });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet: newerPlanet,
      interior: makeInterior(),
    });

    try {
      await useTasksStore.getState().refresh();
    } finally {
      getItemSpy?.mockRestore();
    }

    const state = useTasksStore.getState();
    expect(state.selectedTaskId).toBe("m2");
    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m2");
  });
});
