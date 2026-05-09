import express from "express";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llmMocks = vi.hoisted(() => ({
  callLLMJson: vi.fn(),
}));

vi.mock("../core/llm-client.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../core/llm-client.js")>();
  return {
    ...actual,
    callLLMJson: llmMocks.callLLMJson,
  };
});

import {
  createBlueprintRouter,
  createFileBlueprintJobStore,
  createMemoryBlueprintJobStore,
  type BlueprintRouterDeps,
  type BlueprintJobStore,
} from "../routes/blueprint.js";

const BLUEPRINT_ROUTE_TEST_COMMAND =
  "node node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts";

async function withServer(
  specsRoot: string,
  handler: (baseUrl: string) => Promise<void>,
  jobStore: BlueprintJobStore = createMemoryBlueprintJobStore(),
  routerDeps: Omit<BlueprintRouterDeps, "specsRoot" | "now" | "jobStore"> = {
    generateClarificationQuestions: async input => ({
      questions: input.templateQuestions,
      source: "template",
    }),
  }
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/blueprint",
    createBlueprintRouter({
      specsRoot,
      now: () => new Date("2026-05-06T00:00:00.000Z"),
      jobStore,
      ...routerDeps,
    })
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

async function writeSpec(
  root: string,
  name: string,
  files: Record<string, string>
): Promise<void> {
  const specRoot = path.join(root, name);
  await mkdir(specRoot, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([fileName, content]) =>
      writeFile(path.join(specRoot, fileName), content, "utf8")
    )
  );
}

async function createSelectedSpecTree(
  baseUrl: string
): Promise<Record<string, any>> {
  const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetText: "Build an editable SPEC tree workbench.",
    }),
  });
  const created = (await createResponse.json()) as Record<string, any>;

  const selectResponse = await fetch(
    `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: created.routeSet.routes[0].id,
        selectedBy: "route-reviewer",
        reason: "Use the editable SPEC workbench route.",
      }),
    }
  );

  expect(selectResponse.status).toBe(201);
  return (await selectResponse.json()) as Record<string, any>;
}

async function createAcceptedRootDocsAndPreview(
  baseUrl: string
): Promise<Record<string, any>> {
  const selected = await createSelectedSpecTree(baseUrl);
  const generateDocumentsResponse = await fetch(
    `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: selected.specTree.rootNodeId,
      }),
    }
  );
  expect(generateDocumentsResponse.status).toBe(201);
  const generatedDocuments =
    (await generateDocumentsResponse.json()) as Record<string, any>;

  for (const document of generatedDocuments.documents) {
    const reviewResponse = await fetch(
      `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "accepted",
          reviewedBy: "prompt-reviewer",
        }),
      }
    );
    expect(reviewResponse.status).toBe(200);
  }

  const previewResponse = await fetch(
    `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: selected.specTree.rootNodeId,
      }),
    }
  );
  expect(previewResponse.status).toBe(201);
  const preview = (await previewResponse.json()) as Record<string, any>;

  return {
    selected,
    documents: generatedDocuments.documents,
    preview: preview.effectPreviews[0],
  };
}

async function createRootPromptPackages(
  baseUrl: string,
  targetPlatforms: string[] = ["codex"]
): Promise<Record<string, any>> {
  const { selected, documents, preview } =
    await createAcceptedRootDocsAndPreview(baseUrl);
  const packageResponse = await fetch(
    `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: selected.specTree.rootNodeId,
        targetPlatforms,
      }),
    }
  );
  expect(packageResponse.status).toBe(201);
  const packaged = (await packageResponse.json()) as Record<string, any>;

  return {
    selected,
    documents,
    preview,
    packaged,
    promptPackages: packaged.promptPackages,
  };
}

describe("blueprint specs route", () => {
  let tempRoot = "";

  beforeEach(async () => {
    llmMocks.callLLMJson.mockReset();
    tempRoot = await mkdtemp(
      path.join(process.cwd(), "tmp", "blueprint-specs-")
    );
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("reads blueprint specs, metadata, and top-level task progress", async () => {
    await writeSpec(tempRoot, "blueprint-input-github-ingestion", {
      "requirements.md": [
        "# Requirements Document",
        "",
        "## Introduction",
        "",
        "This spec defines intake behavior.",
        "",
      ].join("\n"),
      "design.md": [
        "# Design Document: Intake Pipeline",
        "",
        "## Overview",
        "",
        "The intake pipeline normalizes inputs.",
        "",
      ].join("\n"),
      "tasks.md": [
        "# Intake Pipeline Task List",
        "",
        "- [x] 1. Capture input",
        "  - [ ] 1.1 Child task should not count",
        "- [ ] 2. Normalize input",
        "",
      ].join("\n"),
      ".config.kiro": JSON.stringify({ generationMode: "requirements-first" }),
    });

    await writeSpec(tempRoot, "blueprint-custom-config", {
      "design.md": "# Design Document: Custom Blueprint\n",
      ".config.kiro": JSON.stringify({
        name: "Custom Blueprint",
        phase: "custom",
        order: 7,
        summary: "From config",
      }),
    });

    await writeSpec(tempRoot, "blueprint-engineering-landing-bridge", {});

    await withServer(tempRoot, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/blueprint/specs`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.generatedAt).toBe("2026-05-06T00:00:00.000Z");
      expect(body.root).toContain("blueprint-specs-");
      expect(body.totalSpecs).toBe(3);
      expect(body.totalDocs).toBe(6);
      expect(body.completedTasks).toBe(1);
      expect(body.totalTasks).toBe(2);

      const specs = body.specs as Array<Record<string, unknown>>;
      const intake = specs.find(
        spec => spec.id === "blueprint-input-github-ingestion"
      );
      const custom = specs.find(spec => spec.id === "blueprint-custom-config");
      const empty = specs.find(
        spec => spec.id === "blueprint-engineering-landing-bridge"
      );

      expect(intake).toMatchObject({
        title: "Intake Pipeline",
        phase: "intake",
        order: 1,
        summary: "This spec defines intake behavior.",
        status: "ready",
      });
      expect((intake?.docs as Record<string, unknown>).requirements).toBe(true);
      expect((intake?.docs as Record<string, unknown>).design).toBe(true);
      expect((intake?.docs as Record<string, unknown>).tasks).toBe(true);
      expect((intake?.docs as Record<string, unknown>).config).toBe(true);
      expect(intake?.taskStats).toMatchObject({ completed: 1, total: 2 });

      expect(custom).toMatchObject({
        title: "Custom Blueprint",
        phase: "custom",
        order: 7,
        summary: "From config",
        status: "partial",
      });
      expect((custom?.docs as Record<string, unknown>).requirements).toBe(
        false
      );
      expect((custom?.docs as Record<string, unknown>).design).toBe(true);
      expect((custom?.docs as Record<string, unknown>).tasks).toBe(false);
      expect((custom?.docs as Record<string, unknown>).config).toBe(true);
      expect(custom?.taskStats).toMatchObject({ completed: 0, total: 0 });

      expect(empty).toMatchObject({
        title: "Engineering Landing Bridge",
        phase: "execution",
        status: "empty",
      });
      expect((empty?.docs as Record<string, unknown>).requirements).toBe(false);
      expect((empty?.docs as Record<string, unknown>).design).toBe(false);
      expect((empty?.docs as Record<string, unknown>).tasks).toBe(false);
      expect((empty?.docs as Record<string, unknown>).config).toBe(false);
    });
  });

  it("creates and reads a blueprint generation job with a RouteSet artifact", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          targetText: "Build a permission management system with RBAC.",
          githubUrls: ["https://github.com/example/permissions"],
        }),
      });

      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.job).toMatchObject({
        status: "completed",
        stage: "route_generation",
        projectId: "project-1",
        completedAt: "2026-05-06T00:00:00.000Z",
        nextAction: {
          type: "select_route",
          stage: "route_generation",
          required: true,
        },
        stageState: {
          stage: "route_generation",
          status: "completed",
          payloadKind: "route_set",
        },
      });
      expect(
        created.job.events
          .filter((event: any) => event.family === "job")
          .map((event: any) => event.type)
      ).toEqual([
        "job.created",
        "job.stage",
        "job.completed",
      ]);
      expect(
        created.job.events
          .filter((event: any) => event.family === "role")
          .map((event: any) => event.type)
      ).toEqual(
        expect.arrayContaining(["role.activated", "role.watching", "role.review_started"])
      );
      expect(created.routeSet).toMatchObject({
        requestId: created.job.id,
        primaryRouteId: expect.any(String),
        nextAsset: {
          type: "spec_tree",
          menu: "deduction",
        },
      });
      expect(created.routeSet.routes).toHaveLength(3);
      expect(created.routeSet.routes[0]).toMatchObject({
        kind: "primary",
        title: "Primary SPEC asset route",
      });
      expect(created.job.artifacts[0]).toMatchObject({
        type: "route_set",
        title: "Autopilot RouteSet",
      });
      const routeSandboxJob = created.job.artifacts.find(
        (artifact: any) => artifact.type === "sandbox_derivation_job"
      )?.payload;
      expect(routeSandboxJob).toMatchObject({
        stage: "route_generation",
        executionMode: "parallel",
        status: "completed",
        routeId: created.routeSet.primaryRouteId,
        provenance: {
          routeSetId: created.routeSet.id,
        },
      });
      expect(routeSandboxJob.durationMs).toBeGreaterThan(0);
      expect(routeSandboxJob.capabilityIds).toEqual(
        expect.arrayContaining([
          "mcp-github-source",
          "docker-analysis-sandbox",
          "aigc-spec-node",
          "role-system-architecture",
          "skill-svg-architecture",
        ])
      );
      expect(routeSandboxJob.invocationIds).toHaveLength(5);
      expect(routeSandboxJob.evidenceIds).toHaveLength(5);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      expect(latestResponse.status).toBe(200);
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.job.id).toBe(created.job.id);
      expect(latest.routeSet.id).toBe(created.routeSet.id);

      const jobResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}`
      );
      expect(jobResponse.status).toBe(200);
      const fetched = (await jobResponse.json()) as Record<string, any>;
      expect(fetched.routeSet.routes.map((route: any) => route.kind)).toEqual([
        "primary",
        "alternative",
        "alternative",
      ]);
      expect(fetched.sandboxDerivationJobs).toHaveLength(1);
      expect(fetched.capabilityInvocations).toHaveLength(5);
      expect(fetched.capabilityEvidence).toHaveLength(5);

      const eventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/events`
      );
      expect(eventsResponse.status).toBe(200);
      const eventsBody = (await eventsResponse.json()) as Record<string, any>;
      expect(eventsBody.job.id).toBe(created.job.id);
      expect(eventsBody.events).toHaveLength(created.job.events.length);
      expect(eventsBody.events.map((event: any) => event.type)).toEqual(
        created.job.events.map((event: any) => event.type)
      );

      const streamResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/events/stream`
      );
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      const streamText = await streamResponse.text();
      expect(streamText).toContain("event: job.created");
      expect(streamText).toContain("event: job.stage");
      expect(streamText).toContain("event: job.completed");
      expect(streamText).toContain("event: sandbox.job.completed");
      expect(streamText).toContain("event: done");
      expect(streamText).toContain(`id: ${created.job.events[0].id}`);

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
            reason: "Use the balanced route as the SPEC tree source.",
            mergedAlternativeRouteIds: [created.routeSet.routes[1].id],
          }),
        }
      );
      expect(selectResponse.status).toBe(201);

      const selected = (await selectResponse.json()) as Record<string, any>;
      expect(selected.job).toMatchObject({
        id: created.job.id,
        stage: "spec_tree",
        status: "reviewing",
        nextAction: {
          type: "review_spec_tree",
          stage: "spec_tree",
          required: true,
        },
        stageState: {
          stage: "spec_tree",
          status: "reviewing",
          payloadKind: "spec_tree",
        },
      });
      expect(selected.selection).toMatchObject({
        routeSetId: created.routeSet.id,
        routeId: created.routeSet.routes[0].id,
        selectedPathId: created.routeSet.routes[0].id,
        routeTitle: "Primary SPEC asset route",
        mergedAlternativeRouteIds: [created.routeSet.routes[1].id],
      });
      expect(selected.specTree).toMatchObject({
        routeSetId: created.routeSet.id,
        selectionId: selected.selection.id,
        selectedPathId: created.routeSet.routes[0].id,
        selectedRouteId: created.routeSet.routes[0].id,
        version: 1,
        status: "reviewing",
        provenance: {
          routeSetId: created.routeSet.id,
          routeId: created.routeSet.routes[0].id,
          selectionId: selected.selection.id,
          selectedPathId: created.routeSet.routes[0].id,
          specTreeId: selected.specTree.id,
        },
      });
      expect(selected.specTree.nodes[0]).toMatchObject({
        type: "root",
        routeId: created.routeSet.routes[0].id,
        metadata: {
          handoffState: "reviewing",
          confirmable: true,
          editable: true,
          resumable: true,
          routeId: created.routeSet.routes[0].id,
          selectionId: selected.selection.id,
          selectedPathId: created.routeSet.routes[0].id,
          downstreamMenus: [
            "spec_docs",
            "effect_preview",
            "prompt_packaging",
            "engineering_landing",
          ],
        },
      });
      expect(
        selected.specTree.nodes[0].metadata.previousRoleFindingCount
      ).toBeGreaterThan(0);
      expect(selected.specTree.nodes[0].metadata.reusedRoleIds).toEqual(
        expect.arrayContaining(["role-runtime-executor", "role-quality-auditor"])
      );
      expect(
        selected.specTree.nodes[0].metadata.reusedEvidenceIds.length
      ).toBeGreaterThan(0);
      expect(selected.specTree.provenance.reusedRoleFindingIds.length).toBeGreaterThan(0);
      expect(selected.specTree.provenance.reusedEvidenceIds.length).toBeGreaterThan(0);
      expect(selected.job.nextAction).toMatchObject({
        type: "review_spec_tree",
        routeId: created.routeSet.routes[0].id,
        selectionId: selected.selection.id,
        specTreeId: selected.specTree.id,
        nodeId: selected.specTree.rootNodeId,
        handoff: {
          stage: "spec_tree",
          status: "reviewing",
          confirmable: true,
          editable: true,
          resumable: true,
          routeId: created.routeSet.routes[0].id,
          selectionId: selected.selection.id,
          selectedPathId: created.routeSet.routes[0].id,
          specTreeId: selected.specTree.id,
          artifactLinks: expect.arrayContaining([
            expect.objectContaining({
              artifactType: "route_set",
              relation: "source",
            }),
            expect.objectContaining({
              artifactType: "route_selection",
              relation: "selection",
            }),
            expect.objectContaining({
              artifactType: "spec_tree",
              relation: "derived",
            }),
          ]),
        },
      });
      expect(selected.job.nextAction.actions.map((action: any) => action.id)).toEqual([
        "confirm_spec_tree",
        "fine_tune_spec_tree",
        "reselect_route",
        "merge_route",
        "enter_downstream_menus",
      ]);
      expect(
        selected.job.nextAction.actions.every(
          (action: any) =>
            action.routeId === created.routeSet.routes[0].id &&
            action.selectionId === selected.selection.id &&
            action.selectedPathId === created.routeSet.routes[0].id &&
            action.specTreeId === selected.specTree.id
        )
      ).toBe(true);
      expect(selected.job.stageState.nextAction.handoff.provenance).toMatchObject({
        routeSetId: created.routeSet.id,
        routeId: created.routeSet.routes[0].id,
        selectionId: selected.selection.id,
        selectedPathId: created.routeSet.routes[0].id,
        specTreeId: selected.specTree.id,
      });
      expect(
        selected.specTree.nodes.some(
          (node: any) => node.type === "effect_preview"
        )
      ).toBe(true);
      expect(
        selected.job.artifacts.map((artifact: any) => artifact.type)
      ).toEqual(
        expect.arrayContaining([
          "route_set",
          "sandbox_derivation_job",
          "capability_invocation",
          "capability_evidence",
          "route_selection",
          "spec_tree",
          "agent_crew",
          "role_timeline",
        ])
      );

      const treeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree`
      );
      expect(treeResponse.status).toBe(200);
      const treeBody = (await treeResponse.json()) as Record<string, any>;
      expect(treeBody.specTree.id).toBe(selected.specTree.id);

      const resetResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "DELETE",
        }
      );
      expect(resetResponse.status).toBe(200);
      const reset = (await resetResponse.json()) as Record<string, any>;
      expect(reset.job).toMatchObject({
        id: created.job.id,
        stage: "route_generation",
        status: "completed",
        nextAction: {
          type: "select_route",
          stage: "route_generation",
          required: true,
        },
        stageState: {
          stage: "route_generation",
          status: "completed",
          payloadKind: "route_set",
        },
      });
      expect(reset.routeSet.id).toBe(created.routeSet.id);
      expect(reset.job.artifacts.map((artifact: any) => artifact.type)).toEqual(
        expect.arrayContaining([
          "route_set",
          "sandbox_derivation_job",
          "capability_invocation",
          "capability_evidence",
        ])
      );

      const resetDetailsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}`
      );
      const resetDetails = (await resetDetailsResponse.json()) as Record<
        string,
        any
      >;
      expect(resetDetails.selection).toBeUndefined();
      expect(resetDetails.specTree).toBeUndefined();

      const reselectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[2].id,
            reason: "Switch to the preview-first route after rollback.",
          }),
        }
      );
      expect(reselectResponse.status).toBe(201);
      const reselected = (await reselectResponse.json()) as Record<string, any>;
      expect(reselected.selection.routeId).toBe(created.routeSet.routes[2].id);
    });
  });

  it("supports compat generation endpoints for create, details, and events", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(
        `${baseUrl}/api/blueprint/generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetText: "Keep the legacy generation contract working.",
          }),
        }
      );

      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.job.id).toBeTruthy();
      expect(created.routeSet.id).toBeTruthy();

      const detailsResponse = await fetch(
        `${baseUrl}/api/blueprint/generations/${created.job.id}`
      );
      expect(detailsResponse.status).toBe(200);
      const details = (await detailsResponse.json()) as Record<string, any>;
      expect(details.job.id).toBe(created.job.id);
      expect(details.routeSet.id).toBe(created.routeSet.id);

      const eventsResponse = await fetch(
        `${baseUrl}/api/blueprint/generations/${created.job.id}/events`
      );
      expect(eventsResponse.status).toBe(200);
      const events = (await eventsResponse.json()) as Record<string, any>;
      expect(events.job.id).toBe(created.job.id);
      expect(
        events.events
          .filter((event: any) => event.family === "job")
          .map((event: any) => event.type)
      ).toEqual([
        "job.created",
        "job.stage",
        "job.completed",
      ]);
    });
  });

  it("captures blueprint intake and normalizes duplicate GitHub URLs", async () => {
    await withServer(tempRoot, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/blueprint/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-intake",
          targetText: "Build an autopilot blueprint intake with GitHub context.",
          githubUrls: [
            "https://github.com/Example/Blueprint.git",
            "https://github.com/example/blueprint/",
            "https://github.com/example/blueprint?tab=readme-ov-file",
          ],
          domainNotes: ["RouteSet should remember reusable domain assets."],
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, any>;
      expect(body.intake).toMatchObject({
        projectId: "project-intake",
        targetText: "Build an autopilot blueprint intake with GitHub context.",
        githubUrls: ["https://github.com/example/blueprint"],
        readiness: {
          status: "ready",
        },
      });
      expect(body.intake.sources).toHaveLength(1);
      expect(body.intake.sources[0]).toMatchObject({
        id: "blueprint-source-example-blueprint",
        kind: "repository",
        normalizedUrl: "https://github.com/example/blueprint",
        owner: "example",
        repo: "blueprint",
        slug: "example/blueprint",
      });
      expect(body.intake.duplicateGithubUrls).toHaveLength(2);
      expect(
        body.intake.duplicateGithubUrls.every(
          (source: any) =>
            source.duplicateOf === "blueprint-source-example-blueprint"
        )
      ).toBe(true);
      expect(body.intake.assets.map((asset: any) => asset.kind)).toEqual(
        expect.arrayContaining([
          "product_goal",
          "github_repository",
          "domain_note",
        ])
      );

      const fetchedResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${body.intake.id}`
      );
      expect(fetchedResponse.status).toBe(200);
      const fetched = (await fetchedResponse.json()) as Record<string, any>;
      expect(fetched.intake.id).toBe(body.intake.id);

      const contextResponse = await fetch(
        `${baseUrl}/api/blueprint/projects/project-intake/context`
      );
      expect(contextResponse.status).toBe(200);
      const contextBody = (await contextResponse.json()) as Record<string, any>;
      expect(contextBody.context).toMatchObject({
        projectId: "project-intake",
        intakeIds: [body.intake.id],
        sourceIds: ["blueprint-source-example-blueprint"],
      });
      expect(contextBody.context.assets.map((asset: any) => asset.kind)).toEqual(
        expect.arrayContaining(["github_repository", "product_goal"])
      );
    });
  });

  it("records clarification answers and readiness for an intake", async () => {
    await withServer(tempRoot, async baseUrl => {
      const intakeResponse = await fetch(`${baseUrl}/api/blueprint/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-clarify",
          targetText: "Create a clarification workflow before autopilot.",
          githubUrls: ["https://github.com/example/clarifier"],
        }),
      });
      const intake = ((await intakeResponse.json()) as Record<string, any>)
        .intake;

      const sessionResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${intake.id}/clarifications`,
        {
          method: "POST",
        }
      );
      expect(sessionResponse.status).toBe(201);
      const sessionBody = (await sessionResponse.json()) as Record<string, any>;
      expect(sessionBody.session.readiness).toMatchObject({
        status: "needs_answers",
        answeredRequired: 0,
        requiredTotal: 4,
      });
      expect(sessionBody.session.questions.map((question: any) => question.kind)).toEqual(
        ["goal", "audience", "constraint", "github", "domain"]
      );

      const answers = sessionBody.session.questions
        .filter((question: any) => question.required)
        .map((question: any) => ({
          questionId: question.id,
          answer: `Answer for ${question.kind}`,
        }));
      const answerResponse = await fetch(
        `${baseUrl}/api/blueprint/clarifications/${sessionBody.session.id}/answers`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      expect(answerResponse.status).toBe(200);
      const answered = (await answerResponse.json()) as Record<string, any>;
      expect(answered.session.readiness).toMatchObject({
        status: "ready",
        answeredRequired: 4,
        requiredTotal: 4,
        missingQuestionIds: [],
      });
      expect(answered.session.answers).toHaveLength(4);

      const fetchedResponse = await fetch(
        `${baseUrl}/api/blueprint/clarifications/${sessionBody.session.id}`
      );
      expect(fetchedResponse.status).toBe(200);
      const fetched = (await fetchedResponse.json()) as Record<string, any>;
      expect(fetched.session.readiness.status).toBe("ready");
    });
  });

  it("selects strategy-based clarification templates with route readiness signals", async () => {
    await withServer(tempRoot, async baseUrl => {
      const repositoryIntakeResponse = await fetch(
        `${baseUrl}/api/blueprint/intake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "project-repository-strategy",
            targetText: "Use repository context to seed an autopilot route.",
            githubUrls: ["https://github.com/example/repository-first"],
          }),
        }
      );
      const repositoryIntake = (
        (await repositoryIntakeResponse.json()) as Record<string, any>
      ).intake;

      const defaultSessionResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${repositoryIntake.id}/clarifications`,
        { method: "POST" }
      );
      expect(defaultSessionResponse.status).toBe(201);
      const defaultSession = (
        (await defaultSessionResponse.json()) as Record<string, any>
      ).session;
      expect(defaultSession).toMatchObject({
        strategyId: "repository_first",
        templateId: "clarification-template-repository-first",
      });
      expect(defaultSession.questions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "blueprint-question-github-role",
            routeDimension: "repository",
            readinessSignal: "repository_context",
            strategyId: "repository_first",
          }),
        ])
      );

      const previewIntakeResponse = await fetch(
        `${baseUrl}/api/blueprint/intake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "project-preview-strategy",
            targetText:
              "Create a preview-first route with a visible UI prototype and risk review.",
            domainNotes: ["Prioritize the preview checkpoint before docs."],
          }),
        }
      );
      const previewIntake = (
        (await previewIntakeResponse.json()) as Record<string, any>
      ).intake;

      const previewSessionResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${previewIntake.id}/clarifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyId: "preview_first",
            templateId: "custom-preview-route-template",
          }),
        }
      );
      expect(previewSessionResponse.status).toBe(201);
      const previewSession = (
        (await previewSessionResponse.json()) as Record<string, any>
      ).session;
      expect(previewSession).toMatchObject({
        strategyId: "preview_first",
        strategyLabel: "Preview-first clarification",
        templateId: "custom-preview-route-template",
      });
      expect(previewSession.readiness).toMatchObject({
        status: "needs_answers",
        answeredRequired: 0,
        requiredTotal: 4,
        readinessSignals: expect.arrayContaining([
          "goal_defined",
          "preview_intent",
          "audience_defined",
          "constraints_defined",
          "domain_assets",
        ]),
        settledQuestionIds: ["blueprint-question-domain-assets"],
        routeDimensions: expect.arrayContaining([
          "goal",
          "preview",
          "audience",
          "risk",
          "domain",
        ]),
      });
      expect(previewSession.questions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "blueprint-question-preview-target",
            kind: "preview",
            routeDimension: "preview",
            readinessSignal: "preview_intent",
            templateId: "custom-preview-route-template",
            strategyId: "preview_first",
          }),
          expect.objectContaining({
            id: "blueprint-question-domain-assets",
            settledByStrategy: true,
            required: false,
          }),
        ])
      );
      expect(previewSession.routeReadySummary).toContain(
        "Preview-first clarification is 0/4"
      );

      const answers = previewSession.questions
        .filter((question: any) => question.required)
        .map((question: any) => ({
          questionId: question.id,
          answer: `Preview strategy answer for ${question.routeDimension}`,
        }));
      const answerResponse = await fetch(
        `${baseUrl}/api/blueprint/clarifications/${previewSession.id}/answers`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      expect(answerResponse.status).toBe(200);
      const answered = ((await answerResponse.json()) as Record<string, any>)
        .session;
      expect(answered.readiness).toMatchObject({
        status: "ready",
        answeredRequired: 4,
        requiredTotal: 4,
        missingQuestionIds: [],
      });
      expect(answered.answers[0]).toMatchObject({
        source: "user",
        provenance: {
          strategyId: "preview_first",
          templateId: "custom-preview-route-template",
        },
      });
      expect(answered.routeReadySummary).toContain(
        "ready for Route Orchestrator"
      );

      const contextResponse = await fetch(
        `${baseUrl}/api/blueprint/projects/project-preview-strategy/context`
      );
      expect(contextResponse.status).toBe(200);
      const context = ((await contextResponse.json()) as Record<string, any>)
        .context;
      const clarificationAssets = context.assets.filter(
        (asset: any) => asset.kind === "clarification"
      );
      expect(clarificationAssets.length).toBeGreaterThanOrEqual(answers.length);
      expect(clarificationAssets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tags: expect.arrayContaining([
              "clarification",
              "preview_first",
              "custom-preview-route-template",
              "preview",
              "preview_intent",
            ]),
          }),
        ])
      );

      const reopenedResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${previewIntake.id}/clarifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyId: "preview_first",
            templateId: "custom-preview-route-template",
          }),
        }
      );
      expect(reopenedResponse.status).toBe(201);
      const reopened = ((await reopenedResponse.json()) as Record<string, any>)
        .session;
      expect(reopened).toMatchObject({
        id: answered.id,
        strategyId: "preview_first",
        templateId: "custom-preview-route-template",
        routeReadySummary: answered.routeReadySummary,
      });
      expect(reopened.answers).toHaveLength(answered.answers.length);
      expect(reopened.answers[0].provenance).toMatchObject({
        strategyId: "preview_first",
        templateId: "custom-preview-route-template",
      });

      const forcedResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${previewIntake.id}/clarifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyId: "preview_first",
            templateId: "custom-preview-route-template",
            forceNew: true,
          }),
        }
      );
      expect(forcedResponse.status).toBe(201);
      const forced = ((await forcedResponse.json()) as Record<string, any>)
        .session;
      expect(forced.id).not.toBe(answered.id);
      expect(forced).toMatchObject({
        strategyId: "preview_first",
        templateId: "custom-preview-route-template",
        answers: [],
      });
    });
  });

  it("uses an LLM question planner before falling back to clarification templates", async () => {
    const generateClarificationQuestions = vi.fn(async input => ({
      source: "llm" as const,
      model: "test-clarifier-model",
      promptId: "test-clarification-prompt",
      questions: input.templateQuestions.map((question: any) =>
        question.id === "blueprint-question-goal"
          ? {
              ...question,
              prompt:
                "Which measurable browser-ready outcome should this autopilot blueprint optimize first?",
            }
          : question
      ),
    }));

    await withServer(
      tempRoot,
      async baseUrl => {
        const intakeResponse = await fetch(`${baseUrl}/api/blueprint/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "project-llm-clarification",
            targetText:
              "Build a browser-visible autopilot route with audit-safe handoff.",
            domainNotes: ["The first route must make LLM uncertainty visible."],
          }),
        });
        expect(intakeResponse.status).toBe(201);
        const intake = ((await intakeResponse.json()) as Record<string, any>)
          .intake;

        const sessionResponse = await fetch(
          `${baseUrl}/api/blueprint/intake/${intake.id}/clarifications`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              strategyId: "target_first",
              forceNew: true,
            }),
          }
        );
        expect(sessionResponse.status).toBe(201);
        const session = ((await sessionResponse.json()) as Record<string, any>)
          .session;

        expect(generateClarificationQuestions).toHaveBeenCalledTimes(1);
        expect(generateClarificationQuestions.mock.calls[0][0]).toMatchObject({
          intake: {
            id: intake.id,
            targetText:
              "Build a browser-visible autopilot route with audit-safe handoff.",
          },
          strategy: {
            id: "target_first",
          },
        });
        expect(
          generateClarificationQuestions.mock.calls[0][0].templateQuestions
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "blueprint-question-goal",
              routeDimension: "goal",
              readinessSignal: "goal_defined",
            }),
          ])
        );
        expect(session).toMatchObject({
          generationSource: "llm",
          llmModel: "test-clarifier-model",
          llmPromptId: "test-clarification-prompt",
          readiness: {
            status: "needs_answers",
          },
        });
        expect(session.questions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "blueprint-question-goal",
              prompt:
                "Which measurable browser-ready outcome should this autopilot blueprint optimize first?",
              type: "free_text",
              generationSource: "llm",
              llmModel: "test-clarifier-model",
              llmPromptId: "test-clarification-prompt",
              routeDimension: "goal",
              readinessSignal: "goal_defined",
            }),
          ])
        );
      },
      createMemoryBlueprintJobStore(),
      { generateClarificationQuestions }
    );
  });

  it("reuses the NL command clarification preview planner for default LLM blueprint questions", async () => {
    llmMocks.callLLMJson.mockResolvedValueOnce({
      needsClarification: true,
      questions: [
        {
          questionId: "timeline",
          text: "Which launch window should the blueprint optimize for?",
          type: "single_choice",
          options: ["Today", "This week", "Flexible"],
          context: "This keeps the route tradeoff aligned with the delivery window.",
        },
      ],
    });

    await withServer(
      tempRoot,
      async baseUrl => {
        const intakeResponse = await fetch(`${baseUrl}/api/blueprint/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "project-nl-preview-reuse",
            targetText:
              "Build an autopilot route for a browser-visible launch plan.",
          }),
        });
        expect(intakeResponse.status).toBe(201);
        const intake = ((await intakeResponse.json()) as Record<string, any>)
          .intake;

        const sessionResponse = await fetch(
          `${baseUrl}/api/blueprint/intake/${intake.id}/clarifications`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ forceNew: true }),
          }
        );
        expect(sessionResponse.status).toBe(201);
        const session = ((await sessionResponse.json()) as Record<string, any>)
          .session;

        expect(llmMocks.callLLMJson).toHaveBeenCalledTimes(1);
        const [messages, options] = llmMocks.callLLMJson.mock.calls[0];
        expect(messages[0].content).toContain(
          "clarification assistant for launch requests"
        );
        expect(options).toMatchObject({
          temperature: 0.2,
          maxTokens: 800,
        });
        expect(session).toMatchObject({
          generationSource: "llm",
          llmModel: process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
        });
        expect(session.questions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              prompt: "Which launch window should the blueprint optimize for?",
              type: "single_choice",
              options: ["Today", "This week", "Flexible"],
              context:
                "This keeps the route tradeoff aligned with the delivery window.",
              generationSource: "llm",
            }),
          ])
        );
      },
      createMemoryBlueprintJobStore(),
      {}
    );
  });

  it("creates a generation job from intake and clarification context", async () => {
    await withServer(tempRoot, async baseUrl => {
      const intakeResponse = await fetch(`${baseUrl}/api/blueprint/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-context-job",
          sourceId: "source-context-job",
          targetText: "Use intake context to seed the RouteSet.",
          githubUrls: ["https://github.com/example/context-job"],
        }),
      });
      const intake = ((await intakeResponse.json()) as Record<string, any>)
        .intake;

      const sessionResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${intake.id}/clarifications`,
        { method: "POST" }
      );
      const session = ((await sessionResponse.json()) as Record<string, any>)
        .session;
      const answers = session.questions
        .filter((question: any) => question.required)
        .map((question: any) => ({
          questionId: question.id,
          answer: `Resolved ${question.kind}`,
        }));
      const answerResponse = await fetch(
        `${baseUrl}/api/blueprint/clarifications/${session.id}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      const answered = ((await answerResponse.json()) as Record<string, any>)
        .session;

      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId: intake.id,
          clarificationSessionId: answered.id,
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.job.request).toMatchObject({
        intakeId: intake.id,
        clarificationSessionId: answered.id,
        projectId: "project-context-job",
        sourceId: "source-context-job",
        targetText: "Use intake context to seed the RouteSet.",
        githubUrls: ["https://github.com/example/context-job"],
      });
      expect(created.job.request.clarifications).toHaveLength(4);
      expect(created.intake.id).toBe(intake.id);
      expect(created.clarificationSession.id).toBe(answered.id);
      expect(created.projectContext).toMatchObject({
        projectId: "project-context-job",
        sourceIds: ["blueprint-source-example-context-job"],
      });
      expect(created.job.artifacts.map((artifact: any) => artifact.type)).toEqual(
        expect.arrayContaining([
          "intake",
          "github_source",
          "clarification_session",
          "project_context",
          "route_set",
          "sandbox_derivation_job",
          "capability_invocation",
          "capability_evidence",
          "agent_crew",
          "role_timeline",
        ])
      );
      expect(
        created.routeSet.routes[0].capabilities.map(
          (capability: any) => capability.id
        )
      ).toContain("mcp-github-source");
      expect(created.routeSet.provenance).toMatchObject({
        projectId: "project-context-job",
        sourceId: "source-context-job",
        githubUrls: ["https://github.com/example/context-job"],
      });
    });
  });

  it("carries structured clarification strategy into RouteSet generation", async () => {
    await withServer(tempRoot, async baseUrl => {
      const intakeResponse = await fetch(`${baseUrl}/api/blueprint/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-route-clarification",
          sourceId: "source-route-clarification",
          targetText:
            "Create a preview-first route that proves the workflow in the browser.",
          domainNotes: ["Preview signal and handoff readiness matter most."],
        }),
      });
      const intake = ((await intakeResponse.json()) as Record<string, any>)
        .intake;

      const sessionResponse = await fetch(
        `${baseUrl}/api/blueprint/intake/${intake.id}/clarifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyId: "preview_first",
            templateId: "route-preview-template",
          }),
        }
      );
      expect(sessionResponse.status).toBe(201);
      const session = ((await sessionResponse.json()) as Record<string, any>)
        .session;
      const answers = session.questions
        .filter((question: any) => question.required)
        .map((question: any) => ({
          questionId: question.id,
          answer: `Route answer for ${question.routeDimension}`,
        }));
      const answerResponse = await fetch(
        `${baseUrl}/api/blueprint/clarifications/${session.id}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      expect(answerResponse.status).toBe(200);
      const answered = ((await answerResponse.json()) as Record<string, any>)
        .session;

      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId: intake.id,
          clarificationSessionId: answered.id,
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.routeSet.provenance).toMatchObject({
        projectId: "project-route-clarification",
        sourceId: "source-route-clarification",
        clarificationSessionId: answered.id,
        clarificationStrategyId: "preview_first",
        clarificationTemplateId: "route-preview-template",
        clarificationReadinessSignals: expect.arrayContaining([
          "preview_intent",
          "goal_defined",
          "constraints_defined",
        ]),
        clarificationRouteDimensions: expect.arrayContaining([
          "preview",
          "goal",
          "risk",
        ]),
        clarificationAnsweredQuestionIds: answers.map(
          (answer: any) => answer.questionId
        ),
        clarificationRouteReadySummary: answered.routeReadySummary,
      });
      expect(created.routeSet.provenance.clarificationEvidenceIds.length).toBeGreaterThan(0);
      const primaryRoute = created.routeSet.routes.find(
        (route: any) => route.kind === "primary"
      );
      expect(primaryRoute.summary).toContain(
        "Clarification strategy: preview_first"
      );
      expect(primaryRoute.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "apply-preview_first-clarification",
            status: "ready",
          }),
        ])
      );
      expect(primaryRoute.capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "clarification-preview_first",
            kind: "role",
          }),
        ])
      );
      expect(primaryRoute.outputs).toContain(
        "Clarification route-ready summary"
      );
    });
  });

  it("updates SPEC tree nodes and saves version snapshots", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const nodeId = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.type === "route_step"
      )?.id;

      expect(nodeId).toBeTruthy();

      const patchResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-tree/nodes/${nodeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Clarify product scope and acceptance",
            summary: "Refine the entry conditions for the first route step.",
            status: "accepted",
            priority: 9,
            outputs: ["scope notes", "acceptance criteria", "scope notes"],
          }),
        }
      );

      expect(patchResponse.status).toBe(200);
      const patched = (await patchResponse.json()) as Record<string, any>;
      expect(patched.node).toMatchObject({
        id: nodeId,
        title: "Clarify product scope and acceptance",
        summary: "Refine the entry conditions for the first route step.",
        status: "accepted",
        priority: 9,
        outputs: ["scope notes", "acceptance criteria"],
      });
      expect(patched.specTree.version).toBe(2);
      expect(
        patched.job.artifacts.find(
          (artifact: any) => artifact.type === "spec_tree"
        )?.payload
      ).toMatchObject({
        version: 2,
        updatedAt: "2026-05-06T00:00:00.000Z",
      });

      const versionResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-tree/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Baseline snapshot",
            summary: "Saved after node update.",
            savedBy: "tester",
          }),
        }
      );

      expect(versionResponse.status).toBe(201);
      const versioned = (await versionResponse.json()) as Record<string, any>;
      expect(versioned.version).toMatchObject({
        treeId: patched.specTree.id,
        version: patched.specTree.version,
        title: "Baseline snapshot",
        summary: "Saved after node update.",
        savedBy: "tester",
      });
      expect(
        versioned.job.artifacts.some(
          (artifact: any) => artifact.type === "spec_tree_version"
        )
      ).toBe(true);

      const reloaded = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}`
      );
      const reloadedBody = (await reloaded.json()) as Record<string, any>;
      expect(
        reloadedBody.job.artifacts.filter(
          (artifact: any) => artifact.type === "spec_tree_version"
        )
      ).toHaveLength(1);
    });
  });

  it("reuses previous role findings in SPEC tree and document derivation", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const rootNode = selected.specTree.nodes.find(
        (node: any) => node.id === selected.specTree.rootNodeId
      );
      expect(rootNode.metadata.previousRoleFindingCount).toBeGreaterThan(0);
      expect(rootNode.metadata.reusedRoleIds).toEqual(
        expect.arrayContaining(["role-runtime-executor", "role-quality-auditor"])
      );
      expect(rootNode.metadata.reusedEvidenceIds.length).toBeGreaterThan(0);

      const generateDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            types: ["requirements"],
          }),
        }
      );
      expect(generateDocumentsResponse.status).toBe(201);
      const generated =
        (await generateDocumentsResponse.json()) as Record<string, any>;
      expect(generated.documents).toHaveLength(1);
      expect(generated.documents[0].content).toContain(
        "## Reused Role Findings"
      );
      expect(generated.documents[0].content).toContain(
        "role-runtime-executor"
      );
      expect(generated.documents[0].provenance.reusedRoleFindingIds.length).toBeGreaterThan(0);
      expect(generated.documents[0].provenance.reusedRoleIds).toEqual(
        expect.arrayContaining(["role-runtime-executor"])
      );
      expect(generated.documents[0].provenance.reusedEvidenceIds.length).toBeGreaterThan(0);
    });
  });

  it("runs SPEC tree structure actions and restores a saved version", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const rootId = selected.specTree.rootNodeId;
      const root = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.id === rootId
      );
      const initialChildCount = root.children.length;

      const baselineResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-tree/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Structure baseline",
          }),
        }
      );
      expect(baselineResponse.status).toBe(201);
      const baseline = (await baselineResponse.json()) as Record<string, any>;

      const runAction = async (request: Record<string, unknown>) => {
        const response = await fetch(
          `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-tree/actions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }
        );
        expect(response.status).toBe(200);
        return (await response.json()) as Record<string, any>;
      };

      const added = await runAction({
        action: "add_node",
        parentId: rootId,
        title: "Workbench structure API",
        summary: "Backend action contract for tree editing.",
        outputs: ["structure endpoint"],
      });
      expect(added.specTree.version).toBe(2);
      expect(added.node).toMatchObject({
        title: "Workbench structure API",
        parentId: rootId,
        status: "draft",
      });
      expect(
        added.specTree.nodes.find((node: any) => node.id === rootId).children
      ).toContain(added.node.id);

      const split = await runAction({
        action: "split_node",
        sourceNodeId: added.node.id,
        title: "Workbench split child",
        placement: "child",
        outputs: ["split output"],
      });
      expect(split.specTree.version).toBe(3);
      expect(split.node).toMatchObject({
        title: "Workbench split child",
        parentId: added.node.id,
        status: "draft",
        outputs: ["split output"],
      });

      const moved = await runAction({
        action: "move_node",
        nodeId: split.node.id,
        parentId: rootId,
        priority: 1,
      });
      expect(moved.specTree.version).toBe(4);
      expect(moved.node).toMatchObject({
        id: split.node.id,
        parentId: rootId,
        priority: 1,
      });
      expect(
        moved.specTree.nodes.find((node: any) => node.id === added.node.id)
          .children
      ).not.toContain(split.node.id);

      const merged = await runAction({
        action: "merge_nodes",
        sourceNodeId: split.node.id,
        targetNodeId: added.node.id,
      });
      expect(merged.specTree.version).toBe(5);
      expect(merged.node.outputs).toEqual(
        expect.arrayContaining(["structure endpoint", "split output"])
      );
      expect(
        merged.specTree.nodes.some((node: any) => node.id === split.node.id)
      ).toBe(false);

      const deleted = await runAction({
        action: "delete_node",
        nodeId: added.node.id,
      });
      expect(deleted.specTree.version).toBe(6);
      expect(
        deleted.specTree.nodes.some((node: any) => node.id === added.node.id)
      ).toBe(false);

      const restored = await runAction({
        action: "set_current_version",
        versionId: baseline.version.id,
      });
      expect(restored.specTree.version).toBe(7);
      expect(restored.version.id).toBe(baseline.version.id);
      expect(
        restored.specTree.nodes.find((node: any) => node.id === rootId).children
      ).toHaveLength(initialChildCount);
      expect(
        restored.specTree.nodes.some((node: any) => node.id === added.node.id)
      ).toBe(false);
      expect(restored.job.events).toHaveLength(selected.job.events.length + 7);
      expect(restored.job.events.at(-1).payload).toMatchObject({
        action: "set_current_version",
        versionId: baseline.version.id,
        version: 7,
      });
    });
  });

  it("generates and reads node-level SPEC documents from a SPEC tree", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);

      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
        }
      );

      expect(generateResponse.status).toBe(201);
      const generated = (await generateResponse.json()) as Record<string, any>;
      expect(generated.job).toMatchObject({
        id: selected.job.id,
        stage: "spec_docs",
        status: "reviewing",
        updatedAt: "2026-05-06T00:00:00.000Z",
      });
      expect(generated.documents).toHaveLength(
        selected.specTree.nodes.length * 3
      );
      expect(
        generated.documents.map((document: any) => document.type)
      ).toContain("requirements");
      expect(
        generated.documents.map((document: any) => document.type)
      ).toContain("design");
      expect(
        generated.documents.map((document: any) => document.type)
      ).toContain("tasks");

      const requirements = generated.documents.find(
        (document: any) =>
          document.type === "requirements" &&
          document.nodeId === selected.specTree.rootNodeId
      );
      expect(requirements).toMatchObject({
        jobId: selected.job.id,
        treeId: selected.specTree.id,
        nodeId: selected.specTree.rootNodeId,
        status: "draft",
        version: 1,
        sourceDocumentId: requirements.id,
        format: "markdown",
        provenance: {
          treeVersion: selected.specTree.version,
          nodeType: "root",
        },
      });
      expect(requirements.content).toContain("# Requirements:");
      expect(requirements.content).toContain("## Derived Content");

      expect(
        generated.job.artifacts.filter((artifact: any) =>
          ["requirements", "design", "tasks"].includes(artifact.type)
        )
      ).toHaveLength(generated.documents.length);

      const readResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`
      );
      expect(readResponse.status).toBe(200);
      const read = (await readResponse.json()) as Record<string, any>;
      expect(read.specTree.id).toBe(selected.specTree.id);
      expect(read.documents).toHaveLength(generated.documents.length);
      expect(read.documents[0]).toMatchObject({
        jobId: selected.job.id,
        treeId: selected.specTree.id,
      });
    });
  });

  it("saves SPEC document versions and accepts review decisions", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            types: ["requirements"],
          }),
        }
      );
      expect(generateResponse.status).toBe(201);
      const generated = (await generateResponse.json()) as Record<string, any>;
      const document = generated.documents[0];

      const versionResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            savedBy: "reviewer-1",
            reviewNote: "Ready for formal review.",
          }),
        }
      );

      expect(versionResponse.status).toBe(201);
      const versioned = (await versionResponse.json()) as Record<string, any>;
      expect(versioned.document).toMatchObject({
        id: document.id,
        sourceDocumentId: document.id,
        status: "draft",
        version: 2,
        reviewNote: "Ready for formal review.",
      });
      expect(versioned.version).toMatchObject({
        documentId: document.id,
        sourceDocumentId: document.id,
        version: 2,
        status: "draft",
        savedBy: "reviewer-1",
        reviewNote: "Ready for formal review.",
      });

      const acceptResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "accepted",
            reviewedBy: "approver-1",
            reviewNote: "Approved for landing.",
          }),
        }
      );

      expect(acceptResponse.status).toBe(200);
      const accepted = (await acceptResponse.json()) as Record<string, any>;
      expect(accepted.document).toMatchObject({
        id: document.id,
        status: "accepted",
        version: 2,
        reviewedAt: "2026-05-06T00:00:00.000Z",
        acceptedAt: "2026-05-06T00:00:00.000Z",
        reviewedBy: "approver-1",
        reviewNote: "Approved for landing.",
      });
      expect(accepted.document.rejectedAt).toBeUndefined();

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      expect(latestResponse.status).toBe(200);
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.specDocuments[0]).toMatchObject({
        id: document.id,
        status: "accepted",
        version: 2,
      });
      expect(latest.specDocumentVersions).toHaveLength(1);
      expect(latest.specDocumentVersions[0]).toMatchObject({
        sourceDocumentId: document.id,
        version: 2,
      });
    });
  });

  it("rejects SPEC document reviews with invalid status or missing documents", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            types: ["design"],
          }),
        }
      );
      const generated = (await generateResponse.json()) as Record<string, any>;
      const document = generated.documents[0];

      const rejectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "rejected",
            reviewedBy: "reviewer-2",
            reviewNote: "Needs tighter acceptance criteria.",
          }),
        }
      );
      expect(rejectResponse.status).toBe(200);
      const rejected = (await rejectResponse.json()) as Record<string, any>;
      expect(rejected.document).toMatchObject({
        id: document.id,
        status: "rejected",
        rejectedAt: "2026-05-06T00:00:00.000Z",
        reviewedBy: "reviewer-2",
      });
      expect(rejected.document.acceptedAt).toBeUndefined();

      const invalidStatusResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "published" }),
        }
      );
      expect(invalidStatusResponse.status).toBe(400);

      const missingReviewResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/missing-document/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "accepted" }),
        }
      );
      expect(missingReviewResponse.status).toBe(404);

      const missingVersionResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/missing-document/versions`,
        {
          method: "POST",
        }
      );
      expect(missingVersionResponse.status).toBe(404);
    });
  });

  it("generates effect previews from accepted SPEC documents", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const generateDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
          }),
        }
      );
      expect(generateDocumentsResponse.status).toBe(201);
      const generatedDocuments =
        (await generateDocumentsResponse.json()) as Record<string, any>;

      for (const document of generatedDocuments.documents) {
        const reviewResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "accepted",
              reviewedBy: "preview-reviewer",
            }),
          }
        );
        expect(reviewResponse.status).toBe(200);
      }

      const previewResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
          }),
        }
      );

      expect(previewResponse.status).toBe(201);
      const preview = (await previewResponse.json()) as Record<string, any>;
      expect(preview.job).toMatchObject({
        id: selected.job.id,
        stage: "effect_preview",
        status: "reviewing",
      });
      expect(preview.effectPreviews).toHaveLength(1);
      expect(preview.effectPreviews[0]).toMatchObject({
        jobId: selected.job.id,
        treeId: selected.specTree.id,
        nodeId: selected.specTree.rootNodeId,
        version: 1,
        versionStatus: "current",
        previousPreviewIds: [],
        preservedPreviewIds: [],
        refreshedFromSpecTreeVersion: selected.specTree.version,
        status: "completed",
        createdAt: "2026-05-06T00:00:00.000Z",
        nodeProgress: {
          nodeId: selected.specTree.rootNodeId,
          status: "draft",
          completionPercent: 50,
          updatedFromTreeVersion: selected.specTree.version,
        },
        provenance: {
          sourceStatus: "accepted",
          includeDrafts: false,
          treeVersion: selected.specTree.version,
          nodeType: "root",
        },
      });
      expect(preview.effectPreviews[0].sourceDocumentIds).toHaveLength(3);
      expect(preview.effectPreviews[0].architectureNotes).toHaveLength(3);
      expect(preview.effectPreviews[0].prototypeNotes).toHaveLength(3);
      expect(preview.effectPreviews[0].progressPlan).toHaveLength(3);
      expect(preview.effectPreviews[0].sourceSnapshotHash).toMatch(
        /^sha256:[a-f0-9]{16}$/
      );
      expect(preview.effectPreviews[0].dependencyOrder).toEqual([
        expect.objectContaining({
          nodeId: selected.specTree.rootNodeId,
          order: 1,
          status: "draft",
        }),
      ]);
      const runtimeProjection = preview.effectPreviews[0].runtimeProjection;
      expect(runtimeProjection).toMatchObject({
        jobId: selected.job.id,
        routeSetId: selected.routeSet.id,
        routeId: selected.specTree.selectedRouteId,
        specTreeId: selected.specTree.id,
        nodeId: selected.specTree.rootNodeId,
        effectPreviewId: preview.effectPreviews[0].id,
        sceneSnapshotId: expect.stringContaining(
          "blueprint-scene-snapshot"
        ),
        browserPreviewId: expect.stringContaining(
          "blueprint-browser-preview"
        ),
        hudState: {
          status: "completed",
          stage: "effect_preview",
          progressPercent: 100,
          activeNodeId: selected.specTree.rootNodeId,
        },
        browserPreview: {
          nodeId: selected.specTree.rootNodeId,
          routeId: selected.specTree.selectedRouteId,
          url: `/autopilot/preview/${selected.job.id}/${selected.specTree.rootNodeId}`,
        },
        sourceIds: {
          routeSetId: selected.routeSet.id,
          specTreeId: selected.specTree.id,
          nodeIds: [selected.specTree.rootNodeId],
          effectPreviewIds: [preview.effectPreviews[0].id],
        },
      });
      expect(runtimeProjection.hudState.badges).toEqual(
        expect.arrayContaining([
          "3D scene",
          "HUD",
          "log timeline",
          "browser preview",
        ])
      );
      expect(runtimeProjection.logTimeline).toHaveLength(3);
      expect(
        runtimeProjection.logTimeline.every(
          (entry: any) => entry.sourceDocumentIds.length === 3
        )
      ).toBe(true);
      expect(
        preview.job.artifacts.filter(
          (artifact: any) => artifact.type === "effect_preview"
        )
      ).toHaveLength(1);

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      const effectPreviewEntry = (ledger.entries as any[]).find(
        entry =>
          entry.artifactType === "effect_preview" &&
          entry.sourceIds.effectPreviewIds.includes(preview.effectPreviews[0].id)
      );
      expect(effectPreviewEntry).toMatchObject({
        stage: "effect_preview",
        sourceIds: {
          routeSetId: selected.routeSet.id,
          specTreeId: selected.specTree.id,
          nodeIds: [selected.specTree.rootNodeId],
          effectPreviewIds: [preview.effectPreviews[0].id],
        },
      });
      expect(effectPreviewEntry.sourceIds.specDocumentIds).toEqual(
        expect.arrayContaining(preview.effectPreviews[0].sourceDocumentIds)
      );

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.effectPreviews).toHaveLength(1);
      expect(latest.effectPreviews[0].nodeId).toBe(
        selected.specTree.rootNodeId
      );
    });
  });

  it("generates draft-source effect previews when includeDrafts is enabled", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const targetNode = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.type === "effect_preview"
      );
      expect(targetNode).toBeTruthy();

      const generateDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: targetNode.id,
            types: ["requirements"],
          }),
        }
      );
      expect(generateDocumentsResponse.status).toBe(201);

      const rejectedDefaultResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: targetNode.id,
          }),
        }
      );
      expect(rejectedDefaultResponse.status).toBe(409);

      const previewResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: targetNode.id,
            includeDrafts: true,
          }),
        }
      );

      expect(previewResponse.status).toBe(201);
      const preview = (await previewResponse.json()) as Record<string, any>;
      expect(preview.effectPreviews).toHaveLength(1);
      expect(preview.effectPreviews[0]).toMatchObject({
        nodeId: targetNode.id,
        status: "preview",
        provenance: {
          sourceStatus: "draft",
          includeDrafts: true,
        },
      });
      expect(
        Object.values(
          preview.effectPreviews[0].provenance.sourceDocumentStatuses
        )
      ).toEqual(["draft"]);
    });
  });

  it("reads and filters effect previews by nodeId", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const routeStepNode = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.type === "route_step"
      );
      expect(routeStepNode).toBeTruthy();

      const rootDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            types: ["requirements"],
          }),
        }
      );
      const rootDocuments =
        (await rootDocumentsResponse.json()) as Record<string, any>;
      const routeStepDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: routeStepNode.id,
            types: ["design"],
          }),
        }
      );
      const routeStepDocuments =
        (await routeStepDocumentsResponse.json()) as Record<string, any>;

      for (const document of rootDocuments.documents.concat(
        routeStepDocuments.documents
      )) {
        const reviewResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents/${document.id}/review`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "accepted" }),
          }
        );
        expect(reviewResponse.status).toBe(200);
      }

      const generatePreviewsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
        {
          method: "POST",
        }
      );
      expect(generatePreviewsResponse.status).toBe(201);
      const generated = (await generatePreviewsResponse.json()) as Record<
        string,
        any
      >;
      expect(generated.effectPreviews).toHaveLength(2);

      const readResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`
      );
      expect(readResponse.status).toBe(200);
      const read = (await readResponse.json()) as Record<string, any>;
      expect(read.effectPreviews).toHaveLength(2);

      const filteredResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews?nodeId=${encodeURIComponent(routeStepNode.id)}`
      );
      expect(filteredResponse.status).toBe(200);
      const filtered = (await filteredResponse.json()) as Record<string, any>;
      expect(filtered.effectPreviews).toHaveLength(1);
      expect(filtered.effectPreviews[0]).toMatchObject({
        nodeId: routeStepNode.id,
        provenance: {
          nodeTitle: routeStepNode.title,
          sourceStatus: "accepted",
        },
      });
    });
  });

  it("refreshes effect preview versions when SPEC tree progress changes and preserves older versions", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, documents, preview } =
        await createAcceptedRootDocsAndPreview(baseUrl);
      expect(preview).toMatchObject({
        version: 1,
        versionStatus: "current",
        refreshedFromSpecTreeVersion: selected.specTree.version,
        nodeProgress: {
          status: "draft",
          completionPercent: 50,
        },
      });

      const updateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-tree/nodes/${selected.specTree.rootNodeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "accepted",
            outputs: ["accepted route plan", "implementation baseline"],
          }),
        }
      );
      expect(updateResponse.status).toBe(200);
      const updated = (await updateResponse.json()) as Record<string, any>;

      const refreshedResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
          }),
        }
      );
      expect(refreshedResponse.status).toBe(201);
      const refreshed = (await refreshedResponse.json()) as Record<string, any>;
      expect(refreshed.effectPreviews).toHaveLength(2);

      const previewsByVersion = [...refreshed.effectPreviews].sort(
        (left: any, right: any) => left.version - right.version
      );
      const archivedPreview = previewsByVersion[0];
      const currentPreview = previewsByVersion[1];

      expect(archivedPreview).toMatchObject({
        id: preview.id,
        version: 1,
        versionStatus: "archived",
        versionSync: {
          versionStatus: "archived",
        },
      });
      expect(currentPreview).toMatchObject({
        version: 2,
        versionStatus: "current",
        supersedesPreviewId: preview.id,
        previousPreviewIds: [preview.id],
        preservedPreviewIds: [preview.id],
        refreshedFromSpecTreeVersion: updated.specTree.version,
        nodeProgress: {
          nodeId: selected.specTree.rootNodeId,
          status: "accepted",
          completionPercent: 100,
          outputIds: ["accepted route plan", "implementation baseline"],
          updatedFromTreeVersion: updated.specTree.version,
        },
        versionSync: {
          version: 2,
          versionStatus: "current",
          previousPreviewIds: [preview.id],
          preservedPreviewIds: [preview.id],
          refreshedFromSpecTreeVersion: updated.specTree.version,
        },
      });
      expect(currentPreview.sourceSnapshotHash).toMatch(/^sha256:[a-f0-9]{16}$/);
      expect(currentPreview.sourceSnapshotHash).not.toBe(preview.sourceSnapshotHash);
      expect(currentPreview.dependencyOrder).toEqual([
        expect.objectContaining({
          nodeId: selected.specTree.rootNodeId,
          order: 1,
          status: "accepted",
        }),
      ]);

      const packageResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            targetPlatforms: ["codex"],
          }),
        }
      );
      expect(packageResponse.status).toBe(201);
      const packaged = (await packageResponse.json()) as Record<string, any>;
      expect(packaged.promptPackages).toHaveLength(1);
      expect(packaged.promptPackages[0].sourceDocumentIds).toEqual(
        documents.map((document: any) => document.id)
      );
      expect(packaged.promptPackages[0].sourcePreviewIds).toEqual([
        currentPreview.id,
      ]);

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      const previewEntries = (ledger.entries as any[])
        .filter(entry => entry.artifactType === "effect_preview")
        .sort((left, right) => left.version - right.version);
      expect(previewEntries).toHaveLength(2);
      expect(previewEntries.map(entry => entry.version)).toEqual([1, 2]);
      expect(previewEntries[1].payloadSummary).toMatchObject({
        version: 2,
        versionStatus: "current",
        refreshedFromSpecTreeVersion: updated.specTree.version,
      });
    });
  });

  it("generates implementation prompt packages from accepted SPEC documents and previews", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, documents, preview } =
        await createAcceptedRootDocsAndPreview(baseUrl);

      const packageResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
          }),
        }
      );

      expect(packageResponse.status).toBe(201);
      const packaged = (await packageResponse.json()) as Record<string, any>;
      expect(packaged.job).toMatchObject({
        id: selected.job.id,
        stage: "prompt_packaging",
        status: "reviewing",
      });
      expect(packaged.promptPackages).toHaveLength(3);
      expect(
        packaged.promptPackages.map((promptPackage: any) =>
          promptPackage.targetPlatform
        )
      ).toEqual(expect.arrayContaining(["codex", "claude", "cursor"]));

      const codexPackage = packaged.promptPackages.find(
        (promptPackage: any) => promptPackage.targetPlatform === "codex"
      );
      expect(codexPackage).toMatchObject({
        jobId: selected.job.id,
        treeId: selected.specTree.id,
        nodeIds: [selected.specTree.rootNodeId],
        sourceDocumentIds: documents.map((document: any) => document.id),
        sourcePreviewIds: [preview.id],
        targetPlatform: "codex",
        createdAt: "2026-05-06T00:00:00.000Z",
        provenance: {
          sourceDocumentStatus: "accepted",
          sourcePreviewStatus: "accepted",
          includeDrafts: false,
          includePreviewDrafts: false,
        },
      });
      expect(codexPackage.sections.map((section: any) => section.kind)).toEqual(
        ["context", "implementation", "constraints", "verification", "handoff"]
      );
      expect(codexPackage.content).toContain("Effect preview:");
      expect(codexPackage.content).toContain("Source previews:");
      expect(
        packaged.job.artifacts.filter(
          (artifact: any) => artifact.type === "prompt_pack"
        )
      ).toHaveLength(3);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.promptPackages).toHaveLength(3);
      expect(latest.promptPackages[0]).toHaveProperty("content");
    });
  });

  it("generates multiple implementation prompt platforms and filters GET results", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected } = await createAcceptedRootDocsAndPreview(baseUrl);

      const packageResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            targetPlatforms: ["cursor", "kiro", "windsurf", "cursor"],
          }),
        }
      );
      expect(packageResponse.status).toBe(201);
      const packaged = (await packageResponse.json()) as Record<string, any>;
      expect(packaged.promptPackages).toHaveLength(3);
      expect(
        packaged.promptPackages.map((promptPackage: any) =>
          promptPackage.targetPlatform
        )
      ).toEqual(expect.arrayContaining(["cursor", "kiro", "windsurf"]));

      const kiroResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages?targetPlatform=kiro`
      );
      expect(kiroResponse.status).toBe(200);
      const kiro = (await kiroResponse.json()) as Record<string, any>;
      expect(kiro.promptPackages).toHaveLength(1);
      expect(kiro.promptPackages[0]).toMatchObject({
        targetPlatform: "kiro",
        target: { label: "Kiro" },
      });

      const multiResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages?targetPlatforms=cursor,windsurf`
      );
      expect(multiResponse.status).toBe(200);
      const multi = (await multiResponse.json()) as Record<string, any>;
      expect(multi.promptPackages).toHaveLength(2);
      expect(
        multi.promptPackages.map((promptPackage: any) =>
          promptPackage.targetPlatform
        )
      ).toEqual(expect.arrayContaining(["cursor", "windsurf"]));

      const invalidResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages?targetPlatform=unknown`
      );
      expect(invalidResponse.status).toBe(400);
    });
  });

  it("generates document-only implementation prompt packages with includeDrafts when previews are missing", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const generateDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            types: ["requirements", "tasks"],
          }),
        }
      );
      expect(generateDocumentsResponse.status).toBe(201);

      const defaultResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            targetPlatforms: ["codex"],
          }),
        }
      );
      expect(defaultResponse.status).toBe(409);

      const packageResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/prompt-packages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: selected.specTree.rootNodeId,
            targetPlatforms: ["codex"],
            includeDrafts: true,
          }),
        }
      );

      expect(packageResponse.status).toBe(201);
      const packaged = (await packageResponse.json()) as Record<string, any>;
      expect(packaged.promptPackages).toHaveLength(1);
      expect(packaged.promptPackages[0]).toMatchObject({
        targetPlatform: "codex",
        sourcePreviewIds: [],
        provenance: {
          sourceDocumentStatus: "draft",
          sourcePreviewStatus: "missing",
          includeDrafts: true,
        },
      });
      expect(packaged.promptPackages[0].content).toContain(
        "Source previews: none"
      );
    });
  });

  it("generates engineering landing plans from prompt packages and exposes latest details", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, promptPackages } = await createRootPromptPackages(
        baseUrl,
        ["codex", "kiro"]
      );
      const codexPackage = promptPackages.find(
        (promptPackage: any) => promptPackage.targetPlatform === "codex"
      );
      expect(codexPackage).toBeTruthy();

      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promptPackageId: codexPackage.id,
          }),
        }
      );

      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      expect(landed.job).toMatchObject({
        id: selected.job.id,
        stage: "engineering_landing",
        status: "reviewing",
      });
      expect(landed.engineeringLandingPlans).toHaveLength(1);

      const plan = landed.engineeringLandingPlans[0];
      expect(plan).toMatchObject({
        jobId: selected.job.id,
        treeId: selected.specTree.id,
        status: "ready",
        title: "Engineering landing plan: Codex",
        promptPackageIds: [codexPackage.id],
        provenance: {
          treeVersion: selected.specTree.version,
          sourceDocumentStatus: "accepted",
          sourcePreviewStatus: "accepted",
        },
      });
      expect(plan.steps.map((step: any) => step.mode)).toEqual([
        "automatic",
        "manual",
        "handoff",
      ]);
      expect(plan.steps[0]).toMatchObject({
        fileScopes: ["shared/blueprint/contracts.ts"],
        riskLevel: "low",
      });
      expect(plan.steps[1]).toMatchObject({
        fileScopes: ["server/routes/blueprint.ts"],
        riskLevel: "medium",
      });
      expect(plan.steps[2]).toMatchObject({
        fileScopes: ["server/tests/blueprint-routes.test.ts"],
        riskLevel: "medium",
      });
      expect(
        plan.steps.every((step: any) =>
          step.verificationCommands.includes(BLUEPRINT_ROUTE_TEST_COMMAND)
        )
      ).toBe(true);
      expect(plan.handoffs).toHaveLength(1);
      expect(plan.handoffs[0]).toMatchObject({
        platform: "codex",
        promptPackageId: codexPackage.id,
        sourceNodeIds: [selected.specTree.rootNodeId],
        verificationCommands: [BLUEPRINT_ROUTE_TEST_COMMAND],
      });
      expect(
        landed.job.artifacts.filter(
          (artifact: any) => artifact.type === "engineering_plan"
        )
      ).toHaveLength(1);

      const readResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`
      );
      expect(readResponse.status).toBe(200);
      const read = (await readResponse.json()) as Record<string, any>;
      expect(read.engineeringLandingPlans).toHaveLength(1);
      expect(read.engineeringLandingPlans[0].id).toBe(plan.id);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.engineeringLandingPlans).toHaveLength(1);
      expect(latest.engineeringLandingPlans[0].id).toBe(plan.id);
      expect(latest.engineeringRuns).toEqual([]);
    });
  });

  it("exposes crew, capability, preview, prompt, and mission event families", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, promptPackages } = await createRootPromptPackages(
        baseUrl,
        ["codex"]
      );
      const routeId = selected.selection.routeId;
      const nodeId = selected.specTree.rootNodeId;

      const invokeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "skill-svg-architecture",
            roleId: "role-experience-presenter",
            routeId,
            nodeId,
            input: "Check handoff readiness event visibility.",
          }),
        }
      );
      expect(invokeResponse.status).toBe(201);

      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promptPackageId: promptPackages[0].id,
          }),
        }
      );
      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      const plan = landed.engineeringLandingPlans[0];

      const expectedFamilies = {
        crew: "crew.context.updated",
        capability: "capability.invoked",
        preview: "preview.generated",
        prompt: "prompt.packaged",
        mission: "mission.handoff",
      };

      for (const [family, type] of Object.entries(expectedFamilies)) {
        const response = await fetch(
          `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=${family}`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, any>;
        expect(body.filters).toMatchObject({ family });
        expect(body.events.map((event: any) => event.type)).toEqual(
          expect.arrayContaining([type])
        );
        expect(
          body.events.every((event: any) => event.family === family)
        ).toBe(true);
      }

      const previewResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=preview&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(previewResponse.status).toBe(200);
      const previewEvents =
        (await previewResponse.json()) as Record<string, any>;
      expect(previewEvents.events).toEqual([
        expect.objectContaining({
          family: "preview",
          type: "preview.generated",
          nodeId,
        }),
      ]);

      const missionResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=mission&artifactId=${encodeURIComponent(landed.job.events.at(-1).artifactId)}`
      );
      expect(missionResponse.status).toBe(200);
      const missionEvents =
        (await missionResponse.json()) as Record<string, any>;
      expect(missionEvents.events).toEqual([
        expect.objectContaining({
          family: "mission",
          type: "mission.handoff",
          payload: expect.objectContaining({
            landingPlanIds: [plan.id],
            promptPackageIds: [promptPackages[0].id],
          }),
        }),
      ]);

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      const eventEntries = ledger.entries.filter(
        (entry: any) => entry.artifactType === "event"
      );
      expect(eventEntries.map((entry: any) => entry.payloadSummary.family)).toEqual(
        expect.arrayContaining(Object.keys(expectedFamilies))
      );
      expect(eventEntries.map((entry: any) => entry.summary)).toEqual(
        expect.arrayContaining(
          [
            "crew / crew.context.updated / completed",
            "capability / capability.invoked / running",
            "preview / preview.generated / completed",
            "prompt / prompt.packaged / completed",
            "mission / mission.handoff / completed",
          ]
        )
      );
    });
  });

  it("generates platform engineering handoffs with platform filters", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected } = await createRootPromptPackages(baseUrl, [
        "cursor",
        "kiro",
        "windsurf",
      ]);

      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetPlatforms: ["kiro", "windsurf"],
          }),
        }
      );

      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      expect(landed.engineeringLandingPlans).toHaveLength(2);
      const handoffPlatforms = landed.engineeringLandingPlans.map(
        (plan: any) => plan.handoffs[0].platform
      );
      expect(handoffPlatforms).toEqual(
        expect.arrayContaining(["kiro", "windsurf"])
      );
      expect(handoffPlatforms).not.toContain("cursor");

      for (const plan of landed.engineeringLandingPlans) {
        const promptPackageId = plan.promptPackageIds[0];
        const handoff = plan.handoffs[0];
        expect(plan.provenance.promptPackagePlatforms[promptPackageId]).toBe(
          handoff.platform
        );
        expect(handoff.promptPackageId).toBe(promptPackageId);
        expect(handoff.content).toContain("## Landing Steps");
        expect(handoff.content).toContain("## Verification");
        expect(handoff.content).toContain(BLUEPRINT_ROUTE_TEST_COMMAND);
      }

      const readResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`
      );
      const read = (await readResponse.json()) as Record<string, any>;
      expect(read.engineeringLandingPlans).toHaveLength(2);
    });
  });

  it("records engineering runs against landing plans and reads run artifacts", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, promptPackages } = await createRootPromptPackages(
        baseUrl,
        ["codex"]
      );
      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
        }
      );
      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      const plan = landed.engineeringLandingPlans[0];

      const runResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            landingPlanId: plan.id,
            status: "passed",
            summary: "Applied the engineering landing bridge.",
            logs: ["Contracts added", "Router endpoints added"],
            verificationResults: [
              {
                command: BLUEPRINT_ROUTE_TEST_COMMAND,
                status: "passed",
                output: "blueprint routes passed",
                durationMs: 1250,
              },
            ],
            changedFiles: [
              "shared/blueprint/contracts.ts",
              "server/routes/blueprint.ts",
              "server/tests/blueprint-routes.test.ts",
            ],
          }),
        }
      );

      expect(runResponse.status).toBe(201);
      const recorded = (await runResponse.json()) as Record<string, any>;
      expect(recorded.job).toMatchObject({
        id: selected.job.id,
        stage: "engineering_landing",
        status: "completed",
      });
      expect(recorded.engineeringLandingPlan.id).toBe(plan.id);
      expect(recorded.engineeringRun).toMatchObject({
        jobId: selected.job.id,
        landingPlanId: plan.id,
        status: "passed",
        startedAt: "2026-05-06T00:00:00.000Z",
        completedAt: "2026-05-06T00:00:00.000Z",
        summary: "Applied the engineering landing bridge.",
        changedFiles: [
          "shared/blueprint/contracts.ts",
          "server/routes/blueprint.ts",
          "server/tests/blueprint-routes.test.ts",
        ],
        promptPackageIds: [promptPackages[0].id],
        provenance: {
          treeId: selected.specTree.id,
          treeVersion: selected.specTree.version,
        },
      });
      expect(recorded.engineeringRun.verificationResults).toEqual([
        {
          command: BLUEPRINT_ROUTE_TEST_COMMAND,
          status: "passed",
          output: "blueprint routes passed",
          durationMs: 1250,
        },
      ]);
      expect(
        recorded.job.artifacts.filter(
          (artifact: any) => artifact.type === "engineering_run"
        )
      ).toHaveLength(1);
      expect(recorded.job.events[recorded.job.events.length - 1]).toMatchObject(
        {
          type: "job.completed",
          stage: "engineering_landing",
          status: "completed",
          payload: {
            landingPlanId: plan.id,
            status: "passed",
          },
        }
      );

      const runsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-runs`
      );
      expect(runsResponse.status).toBe(200);
      const runs = (await runsResponse.json()) as Record<string, any>;
      expect(runs.engineeringLandingPlans).toHaveLength(1);
      expect(runs.engineeringRuns).toHaveLength(1);
      expect(runs.engineeringRuns[0].id).toBe(recorded.engineeringRun.id);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.engineeringRuns).toHaveLength(1);
      expect(latest.engineeringRuns[0].id).toBe(recorded.engineeringRun.id);
    });
  });

  it("builds artifact ledger, replay snapshots, diffs, and feedback backfills", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, promptPackages } = await createRootPromptPackages(
        baseUrl,
        ["codex"]
      );
      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
        }
      );
      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      const plan = landed.engineeringLandingPlans[0];

      const runResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            landingPlanId: plan.id,
            status: "passed",
            summary: "Artifact memory test run.",
            verificationResults: [
              {
                command: BLUEPRINT_ROUTE_TEST_COMMAND,
                status: "passed",
              },
            ],
            changedFiles: ["server/routes/blueprint.ts"],
          }),
        }
      );
      expect(runResponse.status).toBe(201);
      const recorded = (await runResponse.json()) as Record<string, any>;

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      const entries = ledger.entries as any[];
      expect(entries.length).toBeGreaterThan(8);
      expect(entries.map(entry => entry.artifactType)).toEqual(
        expect.arrayContaining([
          "route_set",
          "spec_tree",
          "requirements",
          "effect_preview",
          "prompt_pack",
          "engineering_plan",
          "engineering_run",
          "event",
        ])
      );

      const routeEntry = entries.find(entry => entry.artifactType === "route_set");
      const runEntry = entries.find(
        entry => entry.artifactType === "engineering_run"
      );
      expect(routeEntry).toBeTruthy();
      expect(runEntry).toMatchObject({
        stage: "engineering_landing",
        sourceIds: {
          promptPackageIds: [promptPackages[0].id],
          landingPlanIds: [plan.id],
          engineeringRunIds: [recorded.engineeringRun.id],
        },
      });

      const replayResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-replay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Full artifact replay",
            tags: ["memory-test"],
          }),
        }
      );
      expect(replayResponse.status).toBe(201);
      const replayed = (await replayResponse.json()) as Record<string, any>;
      expect(replayed.replay.timelineEntries).toHaveLength(entries.length);
      expect(replayed.replay.stageCounts.engineering_landing).toBeGreaterThan(0);
      expect(replayed.replay.lineageEdges.length).toBeGreaterThan(0);
      expect(replayed.replay.artifactEvolution.routeSets[0]).toMatchObject({
        routeSetId: selected.routeSet.id,
        selectedRouteId: selected.selection.routeId,
        selectedPathId: selected.selection.routeId,
        selectionId: selected.selection.id,
        selectedBy: "route-reviewer",
        reason: "Use the editable SPEC workbench route.",
      });
      expect(replayed.replay.artifactEvolution.specTrees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            specTreeId: selected.specTree.id,
            routeId: selected.selection.routeId,
            version: selected.specTree.version,
            nodeCount: selected.specTree.nodes.length,
          }),
        ])
      );
      expect(replayed.replay.artifactEvolution.specDocuments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "requirements",
            status: "accepted",
            reviewedBy: "prompt-reviewer",
          }),
        ])
      );
      expect(replayed.replay.artifactEvolution.effectPreviews[0]).toMatchObject({
        previewId: promptPackages[0].sourcePreviewIds[0],
        versionStatus: "current",
        sourceDocumentIds: expect.arrayContaining(promptPackages[0].sourceDocumentIds),
      });
      expect(replayed.replay.artifactEvolution.promptPackages[0]).toMatchObject({
        promptPackageId: promptPackages[0].id,
        targetPlatform: "codex",
        sectionKinds: expect.arrayContaining(["handoff"]),
      });
      expect(replayed.replay.decisions.confirmations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "route_selection",
            routeId: selected.selection.routeId,
            decidedBy: "route-reviewer",
            note: "Use the editable SPEC workbench route.",
          }),
          expect.objectContaining({
            kind: "spec_document_review",
            status: "accepted",
            decidedBy: "prompt-reviewer",
          }),
        ])
      );
      expect(replayed.replay.decisions.handoffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "prompt_package",
            promptPackageIds: [promptPackages[0].id],
          }),
          expect.objectContaining({
            kind: "engineering_plan",
            landingPlanIds: [plan.id],
          }),
          expect.objectContaining({
            kind: "mission_handoff",
            landingPlanIds: [plan.id],
          }),
          expect.objectContaining({
            kind: "engineering_run",
            landingPlanIds: [plan.id],
            status: "passed",
          }),
        ])
      );

      const replaysResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-replays`
      );
      expect(replaysResponse.status).toBe(200);
      const replays = (await replaysResponse.json()) as Record<string, any>;
      expect(replays.replays).toHaveLength(1);

      const diffResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-diff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leftEntryId: routeEntry.id,
            rightEntryId: runEntry.id,
          }),
        }
      );
      expect(diffResponse.status).toBe(200);
      const diff = (await diffResponse.json()) as Record<string, any>;
      expect(diff.diff).toMatchObject({
        leftEntryId: routeEntry.id,
        rightEntryId: runEntry.id,
      });
      expect(diff.diff.changedFields.length).toBeGreaterThan(0);

      const feedbackResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: runEntry.id,
            kind: "backfill",
            message: "Execution evidence is ready for future SPEC evolution.",
            createdBy: "artifact-reviewer",
            tags: ["verified"],
            payloadSummary: {
              verified: true,
            },
          }),
        }
      );
      expect(feedbackResponse.status).toBe(201);
      const feedback = (await feedbackResponse.json()) as Record<string, any>;
      expect(feedback.feedback).toMatchObject({
        jobId: selected.job.id,
        entryId: runEntry.id,
        kind: "backfill",
        createdBy: "artifact-reviewer",
        tags: expect.arrayContaining(["verified"]),
        payloadSummary: {
          verified: true,
        },
      });

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.artifactLedgerEntries.length).toBeGreaterThan(
        entries.length
      );
      expect(latest.artifactReplays).toHaveLength(1);
      expect(latest.artifactFeedback).toHaveLength(1);
    });
  });

  it("invokes runtime capabilities and exposes ledger, latest, and run source ids", async () => {
    await withServer(tempRoot, async baseUrl => {
      const { selected, promptPackages } = await createRootPromptPackages(
        baseUrl,
        ["codex"]
      );
      const rootNodeId = selected.specTree.rootNodeId;
      const routeId = selected.selection.routeId;

      const capabilitiesResponse = await fetch(
        `${baseUrl}/api/blueprint/capabilities`
      );
      expect(capabilitiesResponse.status).toBe(200);
      const capabilityRegistry =
        (await capabilitiesResponse.json()) as Record<string, any>;
      expect(capabilityRegistry.capabilities.map((item: any) => item.kind)).toEqual(
        expect.arrayContaining(["docker", "mcp", "skill", "aigc_node", "role"])
      );
      expect(capabilityRegistry.agentCrew.roles.map((item: any) => item.group)).toEqual(
        expect.arrayContaining([
          "decision",
          "planning",
          "execution",
          "audit",
          "presentation",
          "memory",
        ])
      );
      expect(
        capabilityRegistry.agentCrew.capabilityMatrix.some(
          (binding: any) =>
            binding.roleId === "role-experience-presenter" &&
            binding.capabilityId === "skill-svg-architecture"
        )
      ).toBe(true);

      const invokeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "skill-svg-architecture",
            roleId: "role-experience-presenter",
            routeId,
            nodeId: rootNodeId,
            input: "Create deterministic architecture evidence.",
            requestedBy: "runtime-test",
            evidenceTags: ["focused"],
          }),
        }
      );
      expect(invokeResponse.status).toBe(201);
      const invoked = (await invokeResponse.json()) as Record<string, any>;
      expect(invoked.invocation).toMatchObject({
        capabilityId: "skill-svg-architecture",
        roleId: "role-experience-presenter",
        status: "completed",
        nodeId: rootNodeId,
        safetyGate: {
          status: "allowed",
          requiresApproval: false,
        },
      });
      expect(invoked.evidence).toMatchObject({
        invocationId: invoked.invocation.id,
        capabilityId: "skill-svg-architecture",
        kind: "diagram",
        status: "recorded",
      });

      const invocationListResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations?capabilityId=skill-svg-architecture`
      );
      expect(invocationListResponse.status).toBe(200);
      const invocationList =
        (await invocationListResponse.json()) as Record<string, any>;
      expect(invocationList.capabilities).toHaveLength(5);
      expect(invocationList.agentCrew.presence.map((item: any) => item.state)).toEqual(
        expect.arrayContaining(["active", "watching", "reviewing"])
      );
      expect(
        invocationList.invocations.some(
          (invocation: any) => invocation.id === invoked.invocation.id
        )
      ).toBe(true);

      const roleEventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=role&roleId=role-experience-presenter`
      );
      expect(roleEventsResponse.status).toBe(200);
      const roleEvents = (await roleEventsResponse.json()) as Record<string, any>;
      expect(roleEvents.events.map((event: any) => event.type)).toEqual(
        expect.arrayContaining(["role.capability_invoked"])
      );
      const capabilityRoleEvent = roleEvents.events.find(
        (event: any) => event.type === "role.capability_invoked"
      );
      expect(capabilityRoleEvent).toMatchObject({
        family: "role",
        jobId: selected.job.id,
        stage: "runtime_capability",
        roleId: "role-experience-presenter",
        presenceState: "active",
        capabilityId: "skill-svg-architecture",
        evidenceId: invoked.evidence.id,
        payload: {
          roleId: "role-experience-presenter",
          capabilityId: "skill-svg-architecture",
          evidenceId: invoked.evidence.id,
          sourceIds: {
            roleIds: ["role-experience-presenter"],
            capabilityIds: ["skill-svg-architecture"],
            capabilityInvocationIds: [invoked.invocation.id],
            capabilityEvidenceIds: [invoked.evidence.id],
          },
        },
      });

      const roleTimelineResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/role-timelines?roleId=role-experience-presenter&capabilityId=skill-svg-architecture`
      );
      expect(roleTimelineResponse.status).toBe(200);
      const roleTimeline =
        (await roleTimelineResponse.json()) as Record<string, any>;
      expect(roleTimeline.roleTimelines).toHaveLength(1);
      expect(roleTimeline.roleTimelines[0]).toMatchObject({
        roleId: "role-experience-presenter",
        latestPresenceState: "active",
        latestCapabilityId: "skill-svg-architecture",
        latestEvidenceId: invoked.evidence.id,
        entries: [
          expect.objectContaining({
            type: "role.capability_invoked",
            roleId: "role-experience-presenter",
            capabilityId: "skill-svg-architecture",
            evidenceId: invoked.evidence.id,
          }),
        ],
      });

      const evidenceResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-evidence?nodeId=${encodeURIComponent(rootNodeId)}`
      );
      expect(evidenceResponse.status).toBe(200);
      const evidenceList = (await evidenceResponse.json()) as Record<string, any>;
      expect(evidenceList.evidence.map((item: any) => item.id)).toContain(
        invoked.evidence.id
      );

      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
        }
      );
      expect(landingResponse.status).toBe(201);
      const landed = (await landingResponse.json()) as Record<string, any>;
      const plan = landed.engineeringLandingPlans[0];

      const runResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            landingPlanId: plan.id,
            status: "passed",
            summary: "Runtime capability bridge run.",
            promptPackageIds: [promptPackages[0].id],
            capabilityInvocationIds: [invoked.invocation.id],
            capabilityEvidenceIds: [invoked.evidence.id],
          }),
        }
      );
      expect(runResponse.status).toBe(201);
      const recorded = (await runResponse.json()) as Record<string, any>;
      expect(recorded.engineeringRun).toMatchObject({
        capabilityInvocationIds: [invoked.invocation.id],
        capabilityEvidenceIds: [invoked.evidence.id],
        provenance: {
          capabilityInvocationIds: [invoked.invocation.id],
          capabilityEvidenceIds: [invoked.evidence.id],
        },
      });

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      const entries = ledger.entries as any[];
      expect(entries.map(entry => entry.artifactType)).toEqual(
        expect.arrayContaining([
          "capability_registry",
          "role_timeline",
          "capability_invocation",
          "capability_evidence",
          "engineering_run",
        ])
      );
      const invocationEntry = entries.find(
        entry =>
          entry.artifactType === "capability_invocation" &&
          entry.payloadSummary.id === invoked.invocation.id
      );
      const evidenceEntry = entries.find(
        entry =>
          entry.artifactType === "capability_evidence" &&
          entry.sourceIds.capabilityEvidenceIds.includes(invoked.evidence.id)
      );
      const runEntry = entries.find(
        entry => entry.artifactType === "engineering_run"
      );
      expect(invocationEntry).toMatchObject({
        stage: "runtime_capability",
        sourceIds: {
          roleIds: ["role-experience-presenter"],
          nodeIds: [rootNodeId],
          capabilityIds: ["skill-svg-architecture"],
          capabilityInvocationIds: [invoked.invocation.id],
        },
      });
      expect(evidenceEntry).toMatchObject({
        stage: "runtime_capability",
        sourceIds: {
          nodeIds: [rootNodeId],
          capabilityIds: ["skill-svg-architecture"],
          capabilityInvocationIds: [invoked.invocation.id],
          capabilityEvidenceIds: [invoked.evidence.id],
        },
      });
      expect(runEntry.sourceIds).toMatchObject({
        capabilityInvocationIds: [invoked.invocation.id],
        capabilityEvidenceIds: [invoked.evidence.id],
      });

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      expect(latestResponse.status).toBe(200);
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.capabilities).toHaveLength(5);
      expect(latest.agentCrew).toMatchObject({
        stage: "runtime_capability",
      });
      expect(
        latest.agentCrew.activationPolicies.find(
          (policy: any) => policy.stage === "route_generation"
        )
      ).toMatchObject({
        activeRoleIds: expect.arrayContaining([
          "role-product-decision",
          "role-architecture-planner",
          "role-runtime-executor",
        ]),
        reviewingRoleIds: ["role-quality-auditor"],
      });
      expect(
        latest.capabilityInvocations.some(
          (item: any) => item.id === invoked.invocation.id
        )
      ).toBe(true);
      expect(
        latest.capabilityEvidence.some(
          (item: any) => item.id === invoked.evidence.id
        )
      ).toBe(true);
      expect(
        latest.roleTimelines.some(
          (timeline: any) =>
            timeline.roleId === "role-experience-presenter" &&
            timeline.entries.some(
              (entry: any) => entry.type === "role.capability_invoked"
            )
        )
      ).toBe(true);
      expect(
        latest.artifactLedgerEntries.some(
          (entry: any) => entry.stage === "runtime_capability"
        )
      ).toBe(true);
    });
  });

  it("blocks unsafe runtime capabilities unless explicitly approved", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);

      const blockedResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "mcp-github-source",
            roleId: "role-runtime-executor",
            input: "Read external repository context.",
          }),
        }
      );
      expect(blockedResponse.status).toBe(403);
      const blocked = (await blockedResponse.json()) as Record<string, any>;
      expect(blocked.message).toContain("requires approved=true");

      const approvedResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "mcp-github-source",
            roleId: "role-runtime-executor",
            input: "Read external repository context.",
            approved: true,
          }),
        }
      );
      expect(approvedResponse.status).toBe(201);
      const approved = (await approvedResponse.json()) as Record<string, any>;
      expect(approved.invocation).toMatchObject({
        capabilityId: "mcp-github-source",
        roleId: "role-runtime-executor",
        securityLevel: "networked",
        safetyGate: {
          status: "allowed",
          requiresApproval: true,
          approved: true,
        },
      });
    });
  });

  it("requires role capability bindings for runtime capability invocations", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);

      const missingRoleResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "skill-svg-architecture",
            input: "Missing crew role.",
          }),
        }
      );
      expect(missingRoleResponse.status).toBe(400);
      const missingRole = (await missingRoleResponse.json()) as Record<string, any>;
      expect(missingRole.message).toContain("roleId");

      const unboundResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "skill-svg-architecture",
            roleId: "role-product-decision",
            input: "Wrong role for SVG preview capability.",
          }),
        }
      );
      expect(unboundResponse.status).toBe(403);
      const unbound = (await unboundResponse.json()) as Record<string, any>;
      expect(unbound.message).toContain("not bound");
    });
  });

  it("records failed capability and sandbox runtime events", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const routeId = selected.selection.routeId;
      const nodeId = selected.specTree.rootNodeId;

      const blockedResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/capability-invocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityId: "mcp-github-source",
            roleId: "role-runtime-executor",
            routeId,
            nodeId,
            input: "Read external repository context without approval.",
          }),
        }
      );
      expect(blockedResponse.status).toBe(403);

      const failedCapabilityResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=capability&routeId=${encodeURIComponent(routeId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(failedCapabilityResponse.status).toBe(200);
      const failedCapability =
        (await failedCapabilityResponse.json()) as Record<string, any>;
      expect(failedCapability.events).toEqual([
        expect.objectContaining({
          type: "capability.failed",
          family: "capability",
          status: "failed",
          routeId,
          nodeId,
          roleId: "role-runtime-executor",
          capabilityId: "mcp-github-source",
          payload: expect.objectContaining({
            error: "Blueprint runtime capability approval required.",
          }),
        }),
      ]);

      const sandboxResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/sandbox-derivation-jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roleId: "role-runtime-executor",
            stage: "runtime_capability",
            routeId,
            nodeId,
            executionMode: "sequential",
            capabilities: [
              {
                capabilityId: "mcp-github-source",
                roleId: "role-runtime-executor",
                input: "Sandbox job should fail without approval.",
              },
            ],
          }),
        }
      );
      expect(sandboxResponse.status).toBe(403);

      const failedSandboxResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=sandbox&jobId=${encodeURIComponent(selected.job.id)}&routeId=${encodeURIComponent(routeId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(failedSandboxResponse.status).toBe(200);
      const failedSandbox =
        (await failedSandboxResponse.json()) as Record<string, any>;
      expect(failedSandbox.filters).toMatchObject({
        jobId: selected.job.id,
        routeId,
        nodeId,
      });
      expect(failedSandbox.events).toEqual([
        expect.objectContaining({
          type: "sandbox.job.failed",
          family: "sandbox",
          status: "failed",
          routeId,
          nodeId,
          payload: expect.objectContaining({
            error: "Blueprint runtime capability approval required.",
            executionMode: "sequential",
          }),
        }),
      ]);

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      expect(
        ledger.entries.map((entry: any) => entry.summary)
      ).toEqual(
        expect.arrayContaining([
          "capability / capability.failed / failed",
          "sandbox / sandbox.job.failed / failed",
        ])
      );
    });
  });

  it("packages sandbox derivation jobs and filters sandbox events", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const routeId = selected.selection.routeId;
      const nodeId = selected.specTree.rootNodeId;

      const createResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/sandbox-derivation-jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roleId: "role-runtime-executor",
            crewId: selected.job.artifacts.find(
              (artifact: any) => artifact.type === "agent_crew"
            )?.payload.id,
            stage: "runtime_capability",
            routeId,
            nodeId,
            executionMode: "parallel",
            capabilities: [
              {
                capabilityId: "docker-analysis-sandbox",
                roleId: "role-runtime-executor",
                input: "Inspect route shape.",
              },
              {
                capabilityId: "aigc-spec-node",
                roleId: "role-runtime-executor",
                input: "Derive SPEC nodes.",
              },
            ],
          }),
        }
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.sandboxDerivationJob).toMatchObject({
        stage: "runtime_capability",
        routeId,
        nodeId,
        executionMode: "parallel",
        status: "completed",
      });
      expect(created.sandboxDerivationJob.invocationIds).toHaveLength(2);
      expect(created.sandboxDerivationJob.evidenceIds).toHaveLength(2);
      expect(created.sandboxDerivationJob.aggregate.mainPath).toMatchObject({
        routeId,
        nodeId,
      });
      expect(created.sandboxDerivationJob.aggregate.alternatePaths.length).toBeGreaterThan(0);
      expect(
        created.sandboxDerivationJob.aggregate.evaluation.map(
          (metric: any) => metric.id
        )
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining("sandbox-eval-risk"),
          expect.stringContaining("sandbox-eval-cost"),
          expect.stringContaining("sandbox-eval-complexity"),
        ])
      );
      expect(created.sandboxDerivationJob.aggregate.outputSummary).toContain(
        "Reused"
      );
      expect(
        created.sandboxDerivationJob.logs.find((line: string) =>
          line.startsWith("reusedRoleFindingIds=")
        )
      ).toMatch(/blueprint-role-timeline-entry-/);

      const listResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/sandbox-derivation-jobs`
      );
      expect(listResponse.status).toBe(200);
      const listed = (await listResponse.json()) as Record<string, any>;
      expect(
        listed.sandboxDerivationJobs.filter(
          (job: any) => job.stage === "route_generation"
        )
      ).toHaveLength(1);
      expect(
        listed.sandboxDerivationJobs.filter(
          (job: any) => job.stage === "runtime_capability"
        )
      ).toHaveLength(1);

      const eventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=sandbox`
      );
      expect(eventsResponse.status).toBe(200);
      const events = (await eventsResponse.json()) as Record<string, any>;
      const runtimeSandboxEvents = events.events.filter(
        (event: any) => event.stage === "runtime_capability"
      );
      expect(runtimeSandboxEvents.map((event: any) => event.type)).toEqual([
        "sandbox.job.started",
        "sandbox.job.completed",
      ]);
      expect(runtimeSandboxEvents[1]).toMatchObject({
        family: "sandbox",
        routeId,
        nodeId,
        artifactId: expect.any(String),
      });

      const scopedEventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?jobId=${encodeURIComponent(selected.job.id)}&routeId=${encodeURIComponent(routeId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(scopedEventsResponse.status).toBe(200);
      const scopedEvents =
        (await scopedEventsResponse.json()) as Record<string, any>;
      expect(scopedEvents.filters).toMatchObject({
        jobId: selected.job.id,
        routeId,
        nodeId,
      });
      expect(scopedEvents.events.length).toBeGreaterThan(0);
      expect(
        scopedEvents.events.every(
          (event: any) =>
            event.jobId === selected.job.id &&
            event.routeId === routeId &&
            event.nodeId === nodeId
        )
      ).toBe(true);

      const scopedStreamResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events/stream?family=sandbox&jobId=${encodeURIComponent(selected.job.id)}&routeId=${encodeURIComponent(routeId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(scopedStreamResponse.status).toBe(200);
      const scopedStreamText = await scopedStreamResponse.text();
      expect(scopedStreamText).toContain("event: sandbox.job.started");
      expect(scopedStreamText).toContain("event: sandbox.job.completed");
      expect(scopedStreamText).toContain(`"jobId":"${selected.job.id}"`);
      expect(scopedStreamText).toContain(`"routeId":"${routeId}"`);
      expect(scopedStreamText).toContain(`"nodeId":"${nodeId}"`);

      const capabilityEventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=capability`
      );
      expect(capabilityEventsResponse.status).toBe(200);
      const capabilityEvents =
        (await capabilityEventsResponse.json()) as Record<string, any>;
      const runtimeCapabilityEvents = capabilityEvents.events.filter(
        (event: any) => event.stage === "runtime_capability"
      );
      expect(runtimeCapabilityEvents.map((event: any) => event.type)).toEqual([
        "capability.invoked",
        "capability.completed",
        "capability.invoked",
        "capability.completed",
      ]);
      expect(runtimeCapabilityEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            family: "capability",
            type: "capability.invoked",
            routeId,
            nodeId,
            capabilityId: "docker-analysis-sandbox",
          }),
          expect.objectContaining({
            family: "capability",
            type: "capability.completed",
            routeId,
            nodeId,
            capabilityId: "aigc-spec-node",
          }),
        ])
      );

      const sandboxRoleEventsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/events?family=role&roleId=role-runtime-executor`
      );
      expect(sandboxRoleEventsResponse.status).toBe(200);
      const sandboxRoleEvents =
        (await sandboxRoleEventsResponse.json()) as Record<string, any>;
      expect(sandboxRoleEvents.events.map((event: any) => event.type)).toEqual(
        expect.arrayContaining(["role.capability_invoked", "role.completed"])
      );

      const sandboxTimelineResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/role-timelines?jobId=${encodeURIComponent(selected.job.id)}&roleId=role-runtime-executor&routeId=${encodeURIComponent(routeId)}&nodeId=${encodeURIComponent(nodeId)}`
      );
      expect(sandboxTimelineResponse.status).toBe(200);
      const sandboxTimeline =
        (await sandboxTimelineResponse.json()) as Record<string, any>;
      expect(sandboxTimeline.filters).toMatchObject({
        jobId: selected.job.id,
        roleId: "role-runtime-executor",
        routeId,
        nodeId,
      });
      const runtimeEntries = sandboxTimeline.roleTimelines[0].entries.filter(
        (entry: any) =>
          entry.type === "role.capability_invoked" ||
          entry.type === "role.completed"
      );
      expect(runtimeEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "role.capability_invoked" }),
          expect.objectContaining({ type: "role.completed" }),
        ])
      );
      expect(runtimeEntries.at(-1)).toMatchObject({
        roleId: "role-runtime-executor",
        stage: "runtime_capability",
      });

      const ledgerResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-ledger`
      );
      expect(ledgerResponse.status).toBe(200);
      const ledger = (await ledgerResponse.json()) as Record<string, any>;
      expect(
        ledger.entries.some(
          (entry: any) => entry.artifactType === "sandbox_derivation_job"
        )
      ).toBe(true);
      const roleTimelineEntry = ledger.entries.find(
        (entry: any) =>
          entry.artifactType === "role_timeline" &&
          entry.sourceIds.roleIds.includes("role-runtime-executor") &&
          entry.sourceIds.nodeIds.includes(nodeId)
      );
      const crewEventEntry = ledger.entries.find(
        (entry: any) =>
          entry.artifactType === "event" &&
          entry.payloadSummary.family === "crew" &&
          entry.sourceIds.crewIds.includes(created.agentCrew.id)
      );
      expect(
        roleTimelineEntry
      ).toBeTruthy();
      expect(crewEventEntry).toBeTruthy();

      const replayResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-replay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Runtime bridge replay",
          }),
        }
      );
      expect(replayResponse.status).toBe(201);
      const replayed = (await replayResponse.json()) as Record<string, any>;
      expect(
        replayed.replay.timelineEntries.map((entry: any) => entry.artifactType)
      ).toEqual(
        expect.arrayContaining(["sandbox_derivation_job", "role_timeline", "event"])
      );
      expect(
        replayed.replay.timelineEntries.map((entry: any) => entry.entryId)
      ).toEqual(
        expect.arrayContaining([roleTimelineEntry.id, crewEventEntry.id])
      );
      expect(
        replayed.replay.lineageEdges.some(
          (edge: any) =>
            edge.sourceType === "role_timeline" ||
            edge.sourceType === "crew"
        )
      ).toBe(true);
    });
  });

  it("validates artifact memory not-found and request errors", async () => {
    await withServer(tempRoot, async baseUrl => {
      const missingLedger = await fetch(
        `${baseUrl}/api/blueprint/jobs/missing-job/artifact-ledger`
      );
      expect(missingLedger.status).toBe(404);

      const selected = await createSelectedSpecTree(baseUrl);
      const invalidDiff = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-diff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leftEntryId: "only-left",
          }),
        }
      );
      expect(invalidDiff.status).toBe(400);

      const unknownFeedback = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/artifact-feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: "unknown-entry",
            message: "Cannot bind this feedback.",
          }),
        }
      );
      expect(unknownFeedback.status).toBe(404);
    });
  });

  it("fails engineering landing generation when prompt packages are missing", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);

      const landingResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/engineering-landing`,
        {
          method: "POST",
        }
      );

      expect(landingResponse.status).toBe(409);
      const body = (await landingResponse.json()) as Record<string, any>;
      expect(body.message).toContain("No implementation prompt packages");
    });
  });

  it("fails implementation prompt package generation without a SPEC tree or usable documents", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Create prompt packages after the SPEC tree is ready.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const noTreeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/prompt-packages`,
        {
          method: "POST",
        }
      );
      expect(noTreeResponse.status).toBe(404);
      const noTree = (await noTreeResponse.json()) as Record<string, any>;
      expect(noTree.message).toContain("does not have a SPEC tree artifact yet");

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
          }),
        }
      );
      expect(selectResponse.status).toBe(201);

      const noDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/prompt-packages`,
        {
          method: "POST",
        }
      );
      expect(noDocumentsResponse.status).toBe(409);
      const noDocuments =
        (await noDocumentsResponse.json()) as Record<string, any>;
      expect(noDocuments.message).toContain("No accepted SPEC documents");
    });
  });

  it("fails effect preview generation without a SPEC tree or usable documents", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Create a route before effect preview generation.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const noTreeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/effect-previews`,
        {
          method: "POST",
        }
      );
      expect(noTreeResponse.status).toBe(404);
      const noTree = (await noTreeResponse.json()) as Record<string, any>;
      expect(noTree.message).toContain("does not have a SPEC tree artifact yet");

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
          }),
        }
      );
      expect(selectResponse.status).toBe(201);

      const noDocumentsResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/effect-previews`,
        {
          method: "POST",
        }
      );
      expect(noDocumentsResponse.status).toBe(409);
      const noDocuments =
        (await noDocumentsResponse.json()) as Record<string, any>;
      expect(noDocuments.message).toContain("No accepted SPEC documents");
    });
  });

  it("rejects SPEC document generation when no SPEC tree exists", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Create a route without selecting a SPEC tree.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-documents`,
        {
          method: "POST",
        }
      );
      expect(generateResponse.status).toBe(404);
      const body = (await generateResponse.json()) as Record<string, any>;
      expect(body.message).toContain("does not have a SPEC tree artifact yet");
    });
  });

  it("generates SPEC documents for a selected node and type set", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const targetNode = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.type === "spec_document"
      );
      expect(targetNode).toBeTruthy();

      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: targetNode.id,
            types: ["requirements", "tasks"],
          }),
        }
      );

      expect(generateResponse.status).toBe(201);
      const generated = (await generateResponse.json()) as Record<string, any>;
      expect(generated.documents).toHaveLength(2);
      expect(
        generated.documents.every(
          (document: any) => document.nodeId === targetNode.id
        )
      ).toBe(true);
      expect(generated.documents.map((document: any) => document.type)).toEqual(
        ["requirements", "tasks"]
      );

      const readResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents?nodeId=${encodeURIComponent(targetNode.id)}`
      );
      const read = (await readResponse.json()) as Record<string, any>;
      expect(read.documents).toHaveLength(2);

      const invalidTypeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: targetNode.id,
            types: ["preview"],
          }),
        }
      );
      expect(invalidTypeResponse.status).toBe(400);
    });
  });

  it("filters SPEC documents by nodeId and type", async () => {
    await withServer(tempRoot, async baseUrl => {
      const selected = await createSelectedSpecTree(baseUrl);
      const targetNode = selected.specTree.nodes.find(
        (node: Record<string, any>) => node.type === "route_step"
      );
      expect(targetNode).toBeTruthy();

      const generateResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents`,
        {
          method: "POST",
        }
      );
      expect(generateResponse.status).toBe(201);

      const filteredResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents?nodeId=${encodeURIComponent(targetNode.id)}&type=design`
      );
      expect(filteredResponse.status).toBe(200);
      const filtered = (await filteredResponse.json()) as Record<string, any>;
      expect(filtered.documents).toHaveLength(1);
      expect(filtered.documents[0]).toMatchObject({
        nodeId: targetNode.id,
        type: "design",
        title: `Design: ${targetNode.title}`,
      });

      const typeOnlyResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents?type=tasks`
      );
      expect(typeOnlyResponse.status).toBe(200);
      const typeOnly = (await typeOnlyResponse.json()) as Record<string, any>;
      expect(typeOnly.documents).toHaveLength(selected.specTree.nodes.length);
      expect(
        typeOnly.documents.every((document: any) => document.type === "tasks")
      ).toBe(true);

      const invalidTypeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${selected.job.id}/spec-documents?type=preview`
      );
      expect(invalidTypeResponse.status).toBe(400);
    });
  });

  it("rejects invalid SPEC tree node and version requests", async () => {
    await withServer(tempRoot, async baseUrl => {
      const missingJobResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/missing/spec-tree/nodes/node-1`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "No job" }),
        }
      );
      expect(missingJobResponse.status).toBe(404);

      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Create a route without selecting a SPEC tree.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const noTreePatchResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree/nodes/node-1`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "No tree yet" }),
        }
      );
      expect(noTreePatchResponse.status).toBe(404);

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
          }),
        }
      );
      expect(selectResponse.status).toBe(201);
      const selected = (await selectResponse.json()) as Record<string, any>;

      const invalidPatchResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree/nodes/${created.routeSet.routes[0].id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: -1 }),
        }
      );
      expect(invalidPatchResponse.status).toBe(400);

      const missingNodeResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree/nodes/missing-node`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Still missing" }),
        }
      );
      expect(missingNodeResponse.status).toBe(404);

      const badBodyResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree/nodes/${selected.specTree.rootNodeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      expect(badBodyResponse.status).toBe(400);

      const invalidVersionResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/spec-tree/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "[]",
        }
      );
      expect(invalidVersionResponse.status).toBe(400);
    });
  });

  it("rejects generation jobs without target text or GitHub URLs", async () => {
    await withServer(tempRoot, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toBe(
        "Provide targetText or at least one GitHub URL."
      );
    });
  });

  it("persists RouteSet selection and derived SPEC tree assets to disk", async () => {
    const storageFile = path.join(tempRoot, "assets", "jobs.json");
    const jobStore = createFileBlueprintJobStore(storageFile);

    await withServer(
      tempRoot,
      async baseUrl => {
        const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetText: "Create a future-facing SPEC asset factory.",
          }),
        });
        const created = (await createResponse.json()) as Record<string, any>;

        const selectResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              routeId: created.routeSet.routes[0].id,
            }),
          }
        );
        expect(selectResponse.status).toBe(201);
      },
      jobStore
    );

    const reloadedStore = createFileBlueprintJobStore(storageFile);
    const latest = reloadedStore.latest();
    expect(latest?.artifacts.map(artifact => artifact.type)).toEqual(
      expect.arrayContaining([
        "route_set",
        "sandbox_derivation_job",
        "capability_invocation",
        "capability_evidence",
        "route_selection",
        "spec_tree",
        "agent_crew",
        "role_timeline",
      ])
    );
    expect(latest?.stage).toBe("spec_tree");
    expect(latest?.status).toBe("reviewing");
  });

  // --- 新增：reviewing 显式化用例（任务 16，需求 4.1 / 4.3 / 4.4） ---

  it("exposes explicit handoffState='reviewing' with reviewingHandoff provenance after route selection", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Reviewing-state exposure smoke test.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
          }),
        }
      );
      expect(selectResponse.status).toBe(201);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.job.handoffState).toBe("reviewing");
      expect(latest.job.status).toBe("reviewing");
      expect(latest.job.stageState?.reviewingHandoff).toMatchObject({
        state: "reviewing",
        stage: "spec_tree",
        confirmable: true,
      });
      expect(
        typeof latest.job.stageState?.reviewingHandoff?.routeId
      ).toBe("string");
      expect(
        typeof latest.job.stageState?.reviewingHandoff?.selectedPathId
      ).toBe("string");
      expect(
        typeof latest.job.stageState?.reviewingHandoff?.enteredAt
      ).toBe("string");
    });
  });

  it("switches handoffState to 'reset' after DELETE /route-selection", async () => {
    await withServer(tempRoot, async baseUrl => {
      const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetText: "Reset handoffState smoke test.",
        }),
      });
      const created = (await createResponse.json()) as Record<string, any>;

      const selectResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: created.routeSet.routes[0].id,
          }),
        }
      );
      expect(selectResponse.status).toBe(201);

      const resetResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/${created.job.id}/route-selection`,
        {
          method: "DELETE",
        }
      );
      expect(resetResponse.status).toBe(200);

      const latestResponse = await fetch(
        `${baseUrl}/api/blueprint/jobs/latest`
      );
      const latest = (await latestResponse.json()) as Record<string, any>;
      expect(latest.job.handoffState).toBe("reset");
      expect(latest.job.stageState?.reviewingHandoff).toBeUndefined();
    });
  });

  // ==========================================================================
  // aigc-spec-node capability bridge — Real LLM path + Fallback path
  // (spec: autopilot-capability-bridge-aigc-node, task 20)
  // ==========================================================================

  describe("aigc-spec-node capability bridge", () => {
    const originalEnabled =
      process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED;
    const originalApiKey = process.env.LLM_API_KEY;
    const originalOpenAIApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.LLM_MODEL;

    // Dispatcher that routes mocked callLLMJson invocations to either the
    // aigc-spec-node domain-reasoner fake or any other (e.g. clarification)
    // planner. Identifying substrings come straight from prompt.ts:
    //   - EN: "AIGC Spec Node domain-reasoner"
    //   - ZH: "AIGC Spec Node" + CJK
    // The routeset / clarification planners in default `withServer` deps do
    // NOT reach callLLMJson, so any non-aigc dispatch here is a safety net.
    function isAigcCall(messages: any): boolean {
      try {
        const serialised =
          typeof messages === "string"
            ? messages
            : JSON.stringify(messages ?? "");
        return /AIGC Spec Node|domain-reasoner/i.test(serialised);
      } catch {
        return false;
      }
    }

    afterEach(() => {
      if (originalEnabled === undefined) {
        delete process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED;
      } else {
        process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED =
          originalEnabled;
      }
      if (originalApiKey === undefined) {
        delete process.env.LLM_API_KEY;
      } else {
        process.env.LLM_API_KEY = originalApiKey;
      }
      if (originalOpenAIApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAIApiKey;
      }
      if (originalModel === undefined) {
        delete process.env.LLM_MODEL;
      } else {
        process.env.LLM_MODEL = originalModel;
      }
      llmMocks.callLLMJson.mockReset();
    });

    it("executes aigc-spec-node through the real LLM path and surfaces provenance + structuredPayload", async () => {
      process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED = "true";
      process.env.LLM_API_KEY = "sk-test-valid-key-for-bridge-integration";
      process.env.LLM_MODEL = "gpt-4-turbo";
      llmMocks.callLLMJson.mockImplementation(async (messages: any) => {
        if (isAigcCall(messages)) {
          return {
            subsystems: [
              "Release event ingestion",
              "RBAC & tenancy",
              "Dashboard rendering",
              "Metrics aggregation",
            ],
            riskNotes: [
              "Event schema drift between GitHub Actions and GitLab CI",
              "Tenant isolation on shared data warehouse",
            ],
            dataFlowSketch:
              "CI providers push deploy events → ingestion → normaliser → time-series store → dashboard & heatmap.",
            confidence: 0.78,
          };
        }
        // Safety net: no other llm call is expected in this test path.
        return {};
      });

      await withServer(tempRoot, async baseUrl => {
        const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetText: "Build a release dashboard.",
            githubUrls: ["https://github.com/example/dashboard"],
          }),
        });
        expect(createResponse.status).toBe(201);

        const jobResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/latest`
        );
        expect(jobResponse.status).toBe(200);
        const latest = (await jobResponse.json()) as Record<string, any>;

        const aigcInvocation = latest.capabilityInvocations.find(
          (inv: any) => inv.capabilityId === "aigc-spec-node"
        );
        expect(aigcInvocation).toBeTruthy();
        expect(aigcInvocation.provenance.executionMode).toBe("real");
        expect(aigcInvocation.provenance.promptId).toBe(
          "blueprint.aigc-spec-node.v1"
        );
        expect(typeof aigcInvocation.provenance.model).toBe("string");
        expect(aigcInvocation.provenance.model.length).toBeGreaterThan(0);
        expect(aigcInvocation.provenance.responseDigest).toMatch(
          /^sha256:[a-f0-9]{64}$/
        );
        expect(aigcInvocation.provenance.structuredPayloadDigest).toMatch(
          /^sha256:[a-f0-9]{64}$/
        );
        expect(aigcInvocation.provenance.promptFingerprint).toMatch(
          /^sha256:[a-f0-9]{64}$/
        );
        expect(aigcInvocation.provenance.error).toBeUndefined();
        expect(aigcInvocation.outputSummary).toMatch(/4\s+subsystems/);
        expect(aigcInvocation.outputSummary).toMatch(/2\s+risks?/);
        expect(aigcInvocation.requestedBy).toBe(
          "aigc-spec-node-capability-bridge"
        );

        // Confirm logs never leak raw prompt / response contents.
        const logsJoined = (aigcInvocation.logs ?? []).join("\n");
        expect(logsJoined).not.toContain("You are the AIGC Spec Node");
        expect(logsJoined).not.toContain(
          "CI providers push deploy events"
        );

        // Verify adapter in sandbox + capability events.
        const eventsResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/${latest.job.id}/events`
        );
        const eventsBody = (await eventsResponse.json()) as Record<string, any>;
        const aigcSandboxCompleted = eventsBody.events.find(
          (event: any) =>
            event.type === "sandbox.job.completed" &&
            event.stage === "route_generation"
        );
        expect(aigcSandboxCompleted).toBeTruthy();
        expect(aigcSandboxCompleted.payload?.aigcAdapter).toBe(
          "blueprint.runtime.aigc.spec-node.llm"
        );

        const aigcCapabilityEvents = eventsBody.events.filter(
          (event: any) =>
            event.family === "capability" &&
            event.capabilityId === "aigc-spec-node"
        );
        const invokedEvent = aigcCapabilityEvents.find(
          (event: any) => event.type === "capability.invoked"
        );
        const completedEvent = aigcCapabilityEvents.find(
          (event: any) => event.type === "capability.completed"
        );
        const adapterFromEvents =
          invokedEvent?.payload?.adapter ?? completedEvent?.payload?.adapter;
        expect(adapterFromEvents).toBe(
          "blueprint.runtime.aigc.spec-node.llm"
        );
        expect(adapterFromEvents).not.toMatch(/\.simulated$/);
        const executionModeFromEvents =
          invokedEvent?.payload?.executionMode ??
          completedEvent?.payload?.executionMode;
        expect(executionModeFromEvents).toBe("real");

        // Evidence side: structuredPayload digest should echo the invocation.
        const aigcEvidence = latest.capabilityEvidence.find(
          (item: any) => item.invocationId === aigcInvocation.id
        );
        expect(aigcEvidence).toBeTruthy();
        expect(aigcEvidence.provenance.executionMode).toBe("real");
        expect(aigcEvidence.provenance.structuredPayloadDigest).toBe(
          aigcInvocation.provenance.structuredPayloadDigest
        );
        expect(aigcEvidence.provenance.structuredPayload).toBeTruthy();
        expect(aigcEvidence.provenance.structuredPayload.digest).toBe(
          aigcInvocation.provenance.structuredPayloadDigest
        );
        expect(
          typeof aigcEvidence.provenance.structuredPayload.byteSize
        ).toBe("number");
        expect(aigcEvidence.provenance.structuredPayload.byteSize).toBeGreaterThan(
          0
        );
        expect(
          typeof aigcEvidence.provenance.structuredPayload.summary
        ).toBe("string");
      });
    });

    it("falls back to simulated output when the LLM call throws", async () => {
      process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED = "true";
      process.env.LLM_API_KEY = "sk-test-valid-key-for-bridge-integration";
      process.env.LLM_MODEL = "gpt-4-turbo";
      llmMocks.callLLMJson.mockImplementation(async (messages: any) => {
        if (isAigcCall(messages)) {
          throw new Error("upstream 503");
        }
        return {};
      });

      await withServer(tempRoot, async baseUrl => {
        const createResponse = await fetch(`${baseUrl}/api/blueprint/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetText: "Build a release dashboard.",
            githubUrls: ["https://github.com/example/dashboard"],
          }),
        });
        expect(createResponse.status).toBe(201);

        const jobResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/latest`
        );
        expect(jobResponse.status).toBe(200);
        const latest = (await jobResponse.json()) as Record<string, any>;

        const aigcInvocation = latest.capabilityInvocations.find(
          (inv: any) => inv.capabilityId === "aigc-spec-node"
        );
        expect(aigcInvocation).toBeTruthy();
        expect(aigcInvocation.provenance.executionMode).toBe("simulated_fallback");
        expect(aigcInvocation.provenance.error).toMatch(
          /upstream 503|llm callJson threw/
        );
        expect(aigcInvocation.requestedBy).toBe(
          "route-generation-sandbox-derivation"
        );
        expect(typeof aigcInvocation.durationMs).toBe("number");
        expect(aigcInvocation.outputSummary).toBeTruthy();

        // Adapter stays on the simulated string.
        const eventsResponse = await fetch(
          `${baseUrl}/api/blueprint/jobs/${latest.job.id}/events`
        );
        const eventsBody = (await eventsResponse.json()) as Record<string, any>;
        const aigcSandboxCompleted = eventsBody.events.find(
          (event: any) =>
            event.type === "sandbox.job.completed" &&
            event.stage === "route_generation"
        );
        expect(aigcSandboxCompleted).toBeTruthy();
        expect(aigcSandboxCompleted.payload?.aigcAdapter).toBe(
          "blueprint.runtime.aigc.spec-node.simulated"
        );

        const aigcCapabilityEvents = eventsBody.events.filter(
          (event: any) =>
            event.family === "capability" &&
            event.capabilityId === "aigc-spec-node"
        );
        const invokedEvent = aigcCapabilityEvents.find(
          (event: any) => event.type === "capability.invoked"
        );
        const completedEvent = aigcCapabilityEvents.find(
          (event: any) => event.type === "capability.completed"
        );
        const adapterFromEvents =
          invokedEvent?.payload?.adapter ?? completedEvent?.payload?.adapter;
        expect(adapterFromEvents).toBe(
          "blueprint.runtime.aigc.spec-node.simulated"
        );
        const executionModeFromEvents =
          invokedEvent?.payload?.executionMode ??
          completedEvent?.payload?.executionMode;
        expect(executionModeFromEvents).toBe("simulated_fallback");

        // Evidence must not carry structuredPayload object on fallback.
        const aigcEvidence = latest.capabilityEvidence.find(
          (item: any) => item.invocationId === aigcInvocation.id
        );
        expect(aigcEvidence).toBeTruthy();
        expect(aigcEvidence.provenance.executionMode).toBe(
          "simulated_fallback"
        );
        expect(aigcEvidence.provenance.structuredPayload).toBeUndefined();
      });
    });
  });
});
