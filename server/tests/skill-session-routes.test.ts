import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import {
  createBlueprintBackedSkillSessionStore,
  createSkillSessionRouter,
  type SkillBlueprintClient,
} from "../routes/skill-session.js";

async function withSessionServer(
  client: SkillBlueprintClient,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/skill/session",
    createSkillSessionRouter({
      store: createBlueprintBackedSkillSessionStore({ client }),
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
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

function createFakeBlueprintClient(): SkillBlueprintClient {
  const clarificationSession = {
    id: "clar-session-1",
    intakeId: "intake-1",
    projectId: "project-1",
    questions: [
      {
        id: "clarify-target-user",
        kind: "audience",
        prompt: "你更想优先验证哪类用户？",
        required: true,
        sourceIds: [],
        evidenceIds: [],
        type: "single_choice",
        options: ["consumer", "business"],
      },
    ],
    answers: [],
    readiness: {
      status: "needs_answers",
      score: 0,
      answeredRequired: 0,
      requiredTotal: 1,
      missingQuestionIds: ["clarify-target-user"],
    },
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
  };

  return {
    async createIntake(request) {
      return {
        intake: {
          id: "intake-1",
          projectId: "project-1",
          targetText: request.targetText,
          githubUrls: [],
          sources: [],
          duplicateGithubUrls: [],
          domainNotes: [],
          assets: [],
          evidence: [],
          readiness: clarificationSession.readiness,
          createdAt: "2026-05-30T00:00:00.000Z",
          updatedAt: "2026-05-30T00:00:00.000Z",
        },
      };
    },
    async createClarificationSession() {
      return { session: structuredClone(clarificationSession) };
    },
    async answerClarification(sessionId, answers) {
      expect(sessionId).toBe("clar-session-1");
      expect(answers).toEqual([
        {
          questionId: "clarify-target-user",
          answer: "consumer",
          source: "user",
        },
      ]);

      return {
        session: {
          ...structuredClone(clarificationSession),
          answers,
          readiness: {
            status: "ready",
            score: 1,
            answeredRequired: 1,
            requiredTotal: 1,
            missingQuestionIds: [],
          },
          updatedAt: "2026-05-30T00:01:00.000Z",
        },
      };
    },
    async createGenerationJob(request) {
      expect(request.intakeId).toBe("intake-1");
      expect(request.clarificationSessionId).toBe("clar-session-1");

      return {
        job: {
          id: "job-1",
          request,
          status: "reviewing",
          stage: "route_generation",
          projectId: "project-1",
          version: "1",
          createdAt: "2026-05-30T00:01:30.000Z",
          updatedAt: "2026-05-30T00:01:30.000Z",
          artifacts: [
            {
              id: "artifact-route-set",
              type: "route_set",
              title: "Autopilot RouteSet",
              summary: "RouteSet ready.",
              createdAt: "2026-05-30T00:01:30.000Z",
              payload: {
                id: "route-set-1",
                requestId: "job-1",
                createdAt: "2026-05-30T00:01:30.000Z",
                primaryRouteId: "route-full",
                routes: [
                  {
                    id: "route-fast",
                    kind: "alternative",
                    title: "快速验证路线",
                    summary: "先做最小验证产物",
                    description: "快速验证",
                    stage: "route_generation",
                    priority: 2,
                    complexity: "moderate",
                    costLevel: "medium",
                    riskLevel: "medium",
                    reasoning: [],
                    steps: [],
                    capabilityUsages: [],
                    deliverables: [],
                  },
                  {
                    id: "route-full",
                    kind: "primary",
                    title: "完整规格路线",
                    summary: "产出规格文档和提示词",
                    description: "完整规格",
                    stage: "route_generation",
                    priority: 1,
                    complexity: "complex",
                    costLevel: "high",
                    riskLevel: "medium",
                    reasoning: [],
                    steps: [],
                    capabilityUsages: [],
                    deliverables: [],
                  },
                ],
                nextAsset: {
                  type: "spec_tree",
                  menu: "deduction",
                  description: "Move to spec tree.",
                },
                provenance: {
                  projectId: "project-1",
                  githubUrls: [],
                },
              },
            },
          ],
          events: [],
        },
        routeSet: {
          id: "route-set-1",
          requestId: "job-1",
          createdAt: "2026-05-30T00:01:30.000Z",
          primaryRouteId: "route-full",
          routes: [
            {
              id: "route-fast",
              kind: "alternative",
              title: "快速验证路线",
              summary: "先做最小验证产物",
              description: "快速验证",
              stage: "route_generation",
              priority: 2,
              complexity: "moderate",
              costLevel: "medium",
              riskLevel: "medium",
              reasoning: [],
              steps: [],
              capabilityUsages: [],
              deliverables: [],
            },
            {
              id: "route-full",
              kind: "primary",
              title: "完整规格路线",
              summary: "产出规格文档和提示词",
              description: "完整规格",
              stage: "route_generation",
              priority: 1,
              complexity: "complex",
              costLevel: "high",
              riskLevel: "medium",
              reasoning: [],
              steps: [],
              capabilityUsages: [],
              deliverables: [],
            },
          ],
          nextAsset: {
            type: "spec_tree",
            menu: "deduction",
            description: "Move to spec tree.",
          },
          provenance: {
            projectId: "project-1",
            githubUrls: [],
          },
        },
      };
    },
    async selectRoute(jobId, request) {
      expect(jobId).toBe("job-1");
      expect(request.routeId).toBe("route-full");

      return {
        job: {
          id: "job-1",
          request: {
            intakeId: "intake-1",
            clarificationSessionId: "clar-session-1",
            targetText: "测试 respond",
          },
          status: "reviewing",
          stage: "spec_tree",
          projectId: "project-1",
          version: "1",
          createdAt: "2026-05-30T00:01:30.000Z",
          updatedAt: "2026-05-30T00:02:00.000Z",
          artifacts: [],
          events: [],
        },
        routeSet: {
          id: "route-set-1",
          requestId: "job-1",
          createdAt: "2026-05-30T00:01:30.000Z",
          primaryRouteId: "route-full",
          routes: [],
          nextAsset: {
            type: "spec_tree",
            menu: "deduction",
            description: "Move to spec tree.",
          },
          provenance: {
            projectId: "project-1",
            githubUrls: [],
          },
        },
        selection: {
          id: "selection-1",
          routeSetId: "route-set-1",
          routeId: "route-full",
          selectedPathId: "route-full",
          routeTitle: "完整规格路线",
          selectedAt: "2026-05-30T00:02:00.000Z",
          mergedAlternativeRouteIds: [],
          status: "selected",
          provenance: {
            jobId: "job-1",
            projectId: "project-1",
          },
        },
        specTree: {
          id: "spec-tree-1",
          routeSetId: "route-set-1",
          selectionId: "selection-1",
          selectedRouteId: "route-full",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-30T00:02:00.000Z",
          updatedAt: "2026-05-30T00:02:00.000Z",
          alternativeRouteIds: [],
          nodes: [
            {
              id: "node-root",
              title: "首页体验",
              summary: "定义首页主流程",
              type: "feature",
              status: "draft",
              priority: 1,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
          provenance: {
            jobId: "job-1",
            projectId: "project-1",
            githubUrls: [],
          },
        },
      };
    },
    async generateSpecDocuments(jobId) {
      expect(jobId).toBe("job-1");
      return {
        job: {
          id: "job-1",
          request: {
            intakeId: "intake-1",
            clarificationSessionId: "clar-session-1",
            targetText: "测试 respond",
          },
          status: "reviewing",
          stage: "spec_docs",
          projectId: "project-1",
          version: "1",
          createdAt: "2026-05-30T00:01:30.000Z",
          updatedAt: "2026-05-30T00:02:30.000Z",
          artifacts: [],
          events: [],
        },
        specTree: {
          id: "spec-tree-1",
          routeSetId: "route-set-1",
          selectionId: "selection-1",
          selectedRouteId: "route-full",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-30T00:02:00.000Z",
          updatedAt: "2026-05-30T00:02:00.000Z",
          alternativeRouteIds: [],
          nodes: [
            {
              id: "node-root",
              title: "首页体验",
              summary: "定义首页主流程",
              type: "feature",
              status: "draft",
              priority: 1,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
          provenance: {
            jobId: "job-1",
            projectId: "project-1",
            githubUrls: [],
          },
        },
        documents: [
          {
            id: "doc-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-root",
            type: "design",
            status: "draft",
            version: 1,
            sourceDocumentId: "doc-1",
            title: "首页体验设计",
            summary: "首页规格",
            content: "# 首页体验设计\n\n这里是规格正文。",
            format: "markdown",
            createdAt: "2026-05-30T00:02:30.000Z",
            updatedAt: "2026-05-30T00:02:30.000Z",
            provenance: {
              jobId: "job-1",
              projectId: "project-1",
              githubUrls: [],
              treeVersion: 1,
              nodeType: "feature",
              nodeTitle: "首页体验",
              nodeSummary: "定义首页主流程",
              dependencies: [],
              outputs: [],
            },
          },
        ],
      };
    },
    async generateEffectPreviews(jobId) {
      expect(jobId).toBe("job-1");
      return {
        job: {
          id: "job-1",
          request: {
            intakeId: "intake-1",
            clarificationSessionId: "clar-session-1",
            targetText: "测试 respond",
          },
          status: "reviewing",
          stage: "effect_preview",
          projectId: "project-1",
          version: "1",
          createdAt: "2026-05-30T00:01:30.000Z",
          updatedAt: "2026-05-30T00:02:45.000Z",
          artifacts: [],
          events: [],
        },
        specTree: {
          id: "spec-tree-1",
          routeSetId: "route-set-1",
          selectionId: "selection-1",
          selectedRouteId: "route-full",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-30T00:02:00.000Z",
          updatedAt: "2026-05-30T00:02:00.000Z",
          alternativeRouteIds: [],
          nodes: [
            {
              id: "node-root",
              title: "首页体验",
              summary: "定义首页主流程",
              type: "feature",
              status: "draft",
              priority: 1,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
          provenance: {
            jobId: "job-1",
            projectId: "project-1",
            githubUrls: [],
          },
        },
        effectPreviews: [
          {
            id: "preview-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-root",
            version: 1,
            versionStatus: "current",
            previousPreviewIds: [],
            preservedPreviewIds: [],
            refreshedFromSpecTreeVersion: 1,
            refreshedAt: "2026-05-30T00:02:45.000Z",
            sourceSnapshotHash: "hash",
            sourceDocumentIds: ["doc-1"],
            status: "draft",
            createdAt: "2026-05-30T00:02:45.000Z",
            summary: "首页主视觉预演",
            architectureNotes: [],
            prototypeNotes: [],
            progressPlan: [],
            nodes: [],
            runtimeProjection: {
              id: "runtime-1",
              jobId: "job-1",
              routeSetId: "route-set-1",
              specTreeId: "spec-tree-1",
              nodeId: "node-root",
              effectPreviewId: "preview-1",
              sceneSnapshotId: "scene-1",
              hudState: {
                title: "HUD",
                status: "running",
                primaryMetric: "spec",
                secondaryMetric: "preview",
              },
              logTimeline: [],
              browserPreviewId: "browser-1",
              browserPreview: {
                id: "browser-1",
                title: "首页预览",
                summary: "浏览器预览",
                nodeId: "node-root",
                url: "https://example.com",
              },
              sourceIds: {},
            },
            imageBase64ByNodeId: {
              "node-root": {
                b64: "ZmFrZQ==",
                mimeType: "image/png",
                promptUsed: "cinematic AI product homepage, glowing dashboard, 16:9",
                generatedAt: "2026-05-30T00:02:45.000Z",
              },
            },
            provenance: {
              jobId: "job-1",
              projectId: "project-1",
              githubUrls: [],
              treeVersion: 1,
              nodeType: "feature",
              nodeTitle: "首页体验",
              nodeSummary: "定义首页主流程",
              sourceStatus: "ready",
              includeDrafts: true,
              sourceDocumentStatuses: { "doc-1": "draft" },
            },
          },
        ],
      };
    },
    async generatePromptPackages(jobId) {
      expect(jobId).toBe("job-1");
      return {
        job: {
          id: "job-1",
          request: {
            intakeId: "intake-1",
            clarificationSessionId: "clar-session-1",
            targetText: "测试 respond",
          },
          status: "completed",
          stage: "prompt_packaging",
          projectId: "project-1",
          version: "1",
          createdAt: "2026-05-30T00:01:30.000Z",
          updatedAt: "2026-05-30T00:03:00.000Z",
          completedAt: "2026-05-30T00:03:00.000Z",
          artifacts: [],
          events: [],
        },
        specTree: {
          id: "spec-tree-1",
          routeSetId: "route-set-1",
          selectionId: "selection-1",
          selectedRouteId: "route-full",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-30T00:02:00.000Z",
          updatedAt: "2026-05-30T00:02:00.000Z",
          alternativeRouteIds: [],
          nodes: [
            {
              id: "node-root",
              title: "首页体验",
              summary: "定义首页主流程",
              type: "feature",
              status: "draft",
              priority: 1,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
          provenance: {
            jobId: "job-1",
            projectId: "project-1",
            githubUrls: [],
          },
        },
        promptPackages: [
          {
            id: "prompt-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeIds: ["node-root"],
            sourceDocumentIds: ["doc-1"],
            sourcePreviewIds: ["preview-1"],
            targetPlatform: "trae",
            target: {
              platform: "trae",
              label: "Trae",
              summary: "Trae prompt package",
            },
            title: "Trae 提示词包",
            summary: "用于落地实现",
            content: "Prompt package content",
            sections: [],
            createdAt: "2026-05-30T00:03:00.000Z",
            provenance: {
              jobId: "job-1",
              projectId: "project-1",
              githubUrls: [],
              treeVersion: 1,
              nodeIds: ["node-root"],
              sourceDocumentIds: ["doc-1"],
              sourcePreviewIds: ["preview-1"],
              targetPlatform: "trae",
              sourceDocumentStatus: "draft_only",
              sourcePreviewStatus: "draft_only",
              includeDrafts: true,
              includePreviewDrafts: true,
              sourceDocumentStatuses: { "doc-1": "draft" },
              sourcePreviewStatuses: { "preview-1": "draft" },
            },
          },
        ],
      };
    },
  };
}

describe("skill session routes", () => {
  it("starts a session and returns a running snapshot", async () => {
    await withSessionServer(createFakeBlueprintClient(), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "我想做一个 AI 剧本共创平台" }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("running");
      expect(body.snapshot.stage).toBe("clarification");
      expect(body.sessionId).toMatch(/^skill_sess_/);
    });
  });

  it("returns the same session from snapshot", async () => {
    await withSessionServer(createFakeBlueprintClient(), async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 session snapshot" }),
      });
      const startBody = await startResponse.json();

      const snapshotResponse = await fetch(
        `${baseUrl}/api/skill/session/${startBody.sessionId}/snapshot`,
      );
      const snapshotBody = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotBody.sessionId).toBe(startBody.sessionId);
      expect(snapshotBody.snapshot.stage).toBe("clarification");
    });
  });

  it("returns a decision_required event from the agent stream", async () => {
    await withSessionServer(createFakeBlueprintClient(), async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 agent stream" }),
      });
      const startBody = await startResponse.json();

      const streamResponse = await fetch(
        `${baseUrl}/api/skill/session/${startBody.sessionId}/agent-stream`,
      );
      const streamBody = await streamResponse.json();

      expect(streamResponse.status).toBe(200);
      expect(streamBody.events.at(-1).type).toBe("decision_required");
      expect(streamBody.events.at(-1).waitingForUser).toBe(true);
    });
  });

  it("accepts a clarification answer and transitions to route selection", async () => {
    await withSessionServer(createFakeBlueprintClient(), async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 respond" }),
      });
      const startBody = await startResponse.json();

      const respondResponse = await fetch(`${baseUrl}/api/skill/session/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: startBody.sessionId,
          stepId: "clarify-target-user",
          answer: { selected: "consumer" },
        }),
      });
      const respondBody = await respondResponse.json();

      expect(respondResponse.status).toBe(200);
      expect(respondBody.status).toBe("waiting_for_user");
      expect(respondBody.decision.stepId).toBe("route-selection");
      expect(respondBody.snapshot.stage).toBe("route_selection");
    });
  });

  it("accepts a route selection and returns the completed artifact package", async () => {
    await withSessionServer(createFakeBlueprintClient(), async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 respond" }),
      });
      const startBody = await startResponse.json();

      const clarificationResponse = await fetch(
        `${baseUrl}/api/skill/session/respond`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: startBody.sessionId,
            stepId: "clarify-target-user",
            answer: { selected: "consumer" },
          }),
        },
      );
      const clarificationBody = await clarificationResponse.json();

      const routeResponse = await fetch(`${baseUrl}/api/skill/session/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: startBody.sessionId,
          stepId: clarificationBody.decision.stepId,
          answer: { selected: "route-full" },
        }),
      });
      const routeBody = await routeResponse.json();

      expect(routeResponse.status).toBe(200);
      expect(routeBody.status).toBe("completed");
      expect(routeBody.result.selectedRoute).toEqual({
        id: "route-full",
        label: "完整规格路线",
      });
      expect(routeBody.result.specDocument.markdown).toContain("首页体验设计");
      expect(routeBody.result.imagePrompts).toEqual([
        {
          id: "preview-1:node-root",
          label: "首页体验",
          prompt: "cinematic AI product homepage, glowing dashboard, 16:9",
          imageSize: "landscape_16_9",
        },
      ]);
    });
  });
});
