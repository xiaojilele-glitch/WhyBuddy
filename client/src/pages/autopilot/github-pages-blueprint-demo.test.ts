import { describe, expect, it } from "vitest";

import {
  createGithubPagesBlueprintDemoRuntime,
  type GithubPagesBlueprintDemoRuntime,
} from "./github-pages-blueprint-demo";

async function runDemoFlow(runtime: GithubPagesBlueprintDemoRuntime) {
  const intake = await runtime.createIntake({
    targetText: "Ship an Autopilot GitHub Pages static full-flow demo",
    githubUrls: ["https://github.com/openai/openai-node"],
  });
  expect(intake.ok).toBe(true);
  if (!intake.ok) throw new Error(intake.error.message);

  const clarification = await runtime.createClarificationSession(
    intake.data.intake.id,
    {}
  );
  expect(clarification.ok).toBe(true);
  if (!clarification.ok) throw new Error(clarification.error.message);

  const routeJob = await runtime.createGenerationJob({
    mode: "autopilot_route",
    targetText: intake.data.intake.targetText,
    githubUrls: intake.data.intake.githubUrls,
    intakeId: intake.data.intake.id,
    clarificationSessionId: clarification.data.clarificationSession.id,
    clarifications: clarification.data.clarificationSession.answers,
    domainContext: clarification.data.projectContext,
  });
  expect(routeJob.ok).toBe(true);
  if (!routeJob.ok) throw new Error(routeJob.error.message);

  const selected = await runtime.selectRoute(routeJob.data.job.id, {
    routeId: routeJob.data.routeSet?.primaryRouteId ?? "",
    selectedBy: "autopilot",
    reason: "Selected from the static Pages demo flow.",
  });
  expect(selected.ok).toBe(true);
  if (!selected.ok) throw new Error(selected.error.message);

  return {
    intake: intake.data,
    clarification: clarification.data,
    routeJob: routeJob.data,
    selected: selected.data,
    latest: await runtime.fetchLatestGenerationJob(),
  };
}

describe("github-pages-blueprint-demo", () => {
  it("runs the static Pages Autopilot flow from intake to selected SPEC tree without backend APIs", async () => {
    const runtime = createGithubPagesBlueprintDemoRuntime();

    const result = await runDemoFlow(runtime);

    expect(result.routeJob.job.stage).toBe("route_generation");
    expect(result.routeJob.routeSet?.routes).toHaveLength(3);
    expect(result.selected.job.stage).toBe("spec_tree");
    expect(result.selected.selection.routeId).toBe(
      result.routeJob.routeSet?.primaryRouteId
    );
    expect(result.selected.specTree.nodes.length).toBeGreaterThanOrEqual(5);
    expect(result.selected.specTree.provenance.githubUrls).toContain(
      "https://github.com/openai/openai-node"
    );
    expect(result.latest.ok).toBe(true);
    if (!result.latest.ok) throw new Error(result.latest.error.message);
    expect(result.latest.data.job?.id).toBe(result.selected.job.id);
    expect(result.latest.data.routeSet?.id).toBe(result.selected.routeSet.id);
    expect(result.latest.data.selection?.id).toBe(result.selected.selection.id);
    expect(result.latest.data.specTree?.id).toBe(result.selected.specTree.id);
    expect(result.latest.data.capabilities?.length).toBeGreaterThanOrEqual(5);
    expect(result.latest.data.capabilityInvocations?.length).toBeGreaterThan(0);
    expect(result.latest.data.capabilityEvidence?.length).toBeGreaterThan(0);
  });

  it("runs the full static Pages Autopilot flow through downstream landing assets without backend APIs", async () => {
    const runtime = createGithubPagesBlueprintDemoRuntime();
    const result = await runDemoFlow(runtime);
    const jobId = result.selected.job.id;

    const specDocs = await runtime.generateSpecDocuments(jobId, {
      types: ["requirements", "design", "tasks"],
    });
    expect(specDocs.ok).toBe(true);
    if (!specDocs.ok) throw new Error(specDocs.error.message);
    expect(specDocs.data.job.stage).toBe("spec_docs");
    expect(specDocs.data.job.status).toBe("completed");
    expect(specDocs.data.documents.length).toBeGreaterThanOrEqual(3);
    expect(
      new Set(specDocs.data.documents.map(document => document.type))
    ).toEqual(new Set(["requirements", "design", "tasks"]));

    const effectPreview = await runtime.generateEffectPreviews(jobId, {});
    expect(effectPreview.ok).toBe(true);
    if (!effectPreview.ok) throw new Error(effectPreview.error.message);
    expect(effectPreview.data.job.stage).toBe("effect_preview");
    expect(effectPreview.data.effectPreviews.length).toBeGreaterThan(0);

    const promptPackages = await runtime.generatePromptPackages(jobId, {});
    expect(promptPackages.ok).toBe(true);
    if (!promptPackages.ok) throw new Error(promptPackages.error.message);
    expect(promptPackages.data.job.stage).toBe("prompt_packaging");
    expect(promptPackages.data.promptPackages.length).toBeGreaterThan(0);

    const engineeringLanding = await runtime.generateEngineeringLanding(jobId, {});
    expect(engineeringLanding.ok).toBe(true);
    if (!engineeringLanding.ok) {
      throw new Error(engineeringLanding.error.message);
    }
    expect(engineeringLanding.data.job?.stage).toBe("engineering_landing");
    expect(engineeringLanding.data.landingPlans.length).toBeGreaterThan(0);

    const latest = await runtime.fetchLatestGenerationJob();
    expect(latest.ok).toBe(true);
    if (!latest.ok) throw new Error(latest.error.message);
    expect(latest.data.job?.stage).toBe("engineering_landing");
    expect(latest.data.specTree?.id).toBe(result.selected.specTree.id);
    expect(latest.data.effectPreviews?.length).toBeGreaterThan(0);
    expect(latest.data.promptPackages?.length).toBeGreaterThan(0);
    expect(latest.data.landingPlans?.length).toBeGreaterThan(0);
    expect(latest.data.engineeringRuns?.length).toBeGreaterThan(0);
    expect(latest.data.artifactLedgerEntries?.length).toBeGreaterThan(0);
    expect(latest.data.artifactReplays?.length).toBeGreaterThan(0);
  });

  it("persists the latest static demo snapshot across runtime instances", async () => {
    const storage = new Map<string, string>();
    const storageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const first = createGithubPagesBlueprintDemoRuntime({
      storage: storageLike,
      now: () => "2026-05-22T00:00:00.000Z",
    });

    const result = await runDemoFlow(first);
    expect(result.latest.ok).toBe(true);
    if (!result.latest.ok) throw new Error(result.latest.error.message);

    const second = createGithubPagesBlueprintDemoRuntime({
      storage: storageLike,
      now: () => "2026-05-22T00:01:00.000Z",
    });
    const latest = await second.fetchLatestGenerationJob();

    expect(latest.ok).toBe(true);
    if (!latest.ok) throw new Error(latest.error.message);
    expect(latest.data.job?.id).toBe(result.latest.data.job?.id);
    expect(latest.data.specTree?.id).toBe(result.latest.data.specTree?.id);
  });

  it("loads an existing Pages job without stale metadata as fresh", async () => {
    const storage = new Map<string, string>();
    const storageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    storageLike.setItem(
      "whybuddy:autopilot:pages-blueprint-demo",
      JSON.stringify({
        sequence: 42,
        job: {
          id: "legacy-pages-job",
          projectId: "github-pages-demo-project",
          mode: "autopilot_route",
          status: "completed",
          stage: "effect_preview",
          requestedBy: "github-pages-demo",
          request: {
            mode: "autopilot_route",
            targetText: "Legacy Pages job",
            githubUrls: ["https://github.com/openai/openai-node"],
          },
          artifacts: [
            {
              id: "legacy-spec-tree",
              type: "spec_tree",
              title: "Legacy SPEC tree",
              summary: "Saved before stale metadata existed.",
              createdAt: "2026-05-22T00:00:00.000Z",
            },
            {
              id: "legacy-requirements",
              type: "requirements",
              title: "Legacy requirements",
              summary: "Saved before stale metadata existed.",
              createdAt: "2026-05-22T00:00:00.000Z",
            },
            {
              id: "legacy-preview",
              type: "effect_preview",
              title: "Legacy preview",
              summary: "Saved before stale metadata existed.",
              createdAt: "2026-05-22T00:00:00.000Z",
            },
          ],
          events: [],
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:01:00.000Z",
        },
      })
    );

    const runtime = createGithubPagesBlueprintDemoRuntime({
      storage: storageLike,
      now: () => "2026-05-24T00:00:00.000Z",
    });

    const latest = await runtime.fetchLatestGenerationJob();

    expect(latest.ok).toBe(true);
    if (!latest.ok) throw new Error(latest.error.message);
    expect(latest.data.job?.id).toBe("legacy-pages-job");
    expect(latest.data.job?.artifacts).toHaveLength(3);
    expect(
      latest.data.job?.artifacts.filter(
        artifact => artifact.staleSince || artifact.invalidatedBy
      )
    ).toEqual([]);
  });
});
