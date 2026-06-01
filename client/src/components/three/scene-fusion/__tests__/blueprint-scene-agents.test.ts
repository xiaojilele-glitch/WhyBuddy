import { describe, expect, it } from "vitest";

import type { RolePhase } from "@/lib/blueprint-realtime-store";

import {
  createBlueprintSceneData,
  deriveBlueprintAgentPatrol,
  deriveBlueprintFlowRoutes,
} from "../blueprint-scene-agents";

describe("blueprint scene agents", () => {
  it("uses mission agent ids so blueprint role phases can animate visible canvas slots", () => {
    const data = createBlueprintSceneData("zh-CN");

    expect(data.sceneAgents.map(agent => agent.id)).toEqual([
      "agent-ceo",
      "agent-manager-research",
      "agent-manager-design",
      "agent-manager-engineering",
      "agent-worker-research",
      "agent-worker-design",
      "agent-worker-engineering",
    ]);
  });

  it("derives visible task routes from real autopilot role ids", () => {
    const data = createBlueprintSceneData("zh-CN");
    const configMap = Object.fromEntries(
      data.sceneAgents.map(agent => [agent.id, agent])
    );
    const rolePhases: Record<string, RolePhase> = {
      "spec-author": "acting",
      "repository-analyst": "thinking",
      "runtime-quality-auditor": "reviewing",
    };

    const routes = deriveBlueprintFlowRoutes(rolePhases, configMap);

    expect(routes.map(route => route.key)).toEqual([
      "blueprint-flow-agent-manager-research-agent-manager-design-0",
      "blueprint-flow-agent-manager-design-agent-worker-design-1",
      "blueprint-flow-agent-worker-design-agent-manager-engineering-2",
      "blueprint-flow-agent-manager-engineering-agent-worker-engineering-3",
    ]);
    expect(routes.every(route => route.from && route.to)).toBe(true);
    expect(routes.every(route => route.visualWeight === "active")).toBe(true);
  });

  it("keeps a default command route alive before realtime role events arrive", () => {
    const data = createBlueprintSceneData("zh-CN");
    const configMap = Object.fromEntries(
      data.sceneAgents.map(agent => [agent.id, agent])
    );

    const routes = deriveBlueprintFlowRoutes({}, configMap);

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      key: "blueprint-default-flow-agent-ceo-agent-manager-research",
      opacity: 0.24,
      visualWeight: "subtle",
    });
  });

  it("gives every blueprint role visible patrol displacement, not only tiny idle bobbing", () => {
    const data = createBlueprintSceneData("zh-CN");
    const agent = data.sceneAgents.find(
      item => item.id === "agent-worker-design"
    );
    expect(agent).toBeDefined();

    const idleMotion = deriveBlueprintAgentPatrol({
      agentId: agent!.id,
      basePosition: agent!.position,
      baseRotation: agent!.rotation,
      time: 1.25,
    });
    const activeMotion = deriveBlueprintAgentPatrol({
      agentId: agent!.id,
      basePosition: agent!.position,
      baseRotation: agent!.rotation,
      time: 1.25,
      rolePhase: "acting",
    });

    const idlePlanarDistance = Math.hypot(
      idleMotion.position[0] - agent!.position[0],
      idleMotion.position[2] - agent!.position[2]
    );
    const activePlanarDistance = Math.hypot(
      activeMotion.position[0] - agent!.position[0],
      activeMotion.position[2] - agent!.position[2]
    );

    expect(idlePlanarDistance).toBeGreaterThanOrEqual(0.28);
    expect(activePlanarDistance).toBeGreaterThan(idlePlanarDistance);
    expect(activeMotion.rotation[1]).not.toBe(agent!.rotation[1]);
  });
});
