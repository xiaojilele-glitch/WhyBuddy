import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  normalizeBlueprintArtifactDiffResponse,
  normalizeBlueprintArtifactFeedbackResponse,
  normalizeBlueprintArtifactLedgerResponse,
  normalizeBlueprintArtifactReplaysResponse,
  normalizeBlueprintEngineeringLandingResponse,
  normalizeBlueprintEngineeringRunsResponse,
  normalizeBlueprintAgentCrew,
  normalizeBlueprintLatestGenerationJobResponse,
} from "@/lib/blueprint-api";

import BlueprintProgressPanel from "./BlueprintProgressPanel";

describe("BlueprintProgressPanel", () => {
  it("renders aggregate blueprint progress and per-spec status", () => {
    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        initialData={{
          generatedAt: "2026-05-06T00:00:00.000Z",
          root: ".kiro/specs",
          totalSpecs: 2,
          totalDocs: 6,
          completedTasks: 3,
          totalTasks: 5,
          specs: [
            {
              id: "blueprint-input-github-ingestion",
              phase: "intake",
              order: 1,
              title: "Input GitHub ingestion",
              summary: "Normalize user goals and GitHub sources.",
              docs: {
                requirements: true,
                design: true,
                tasks: true,
                completed: 3,
                total: 3,
                missing: [],
              },
              tasks: { completed: 1, total: 2, percent: 50 },
            },
            {
              id: "blueprint-spec-tree-workbench",
              phase: "planning",
              order: 5,
              title: "Spec tree workbench",
              summary: "Refine and persist the derived SPEC tree.",
              docs: {
                requirements: true,
                design: false,
                tasks: false,
                completed: 1,
                total: 3,
                missing: ["design", "tasks"],
              },
              tasks: { completed: 2, total: 3, percent: 67 },
            },
          ],
        }}
      />
    );

    expect(markup).toContain('data-testid="blueprint-progress-panel"');
    expect(markup).toContain("蓝图进度");
    expect(markup).toContain("SPEC 执行概览");
    expect(markup).toContain("2 项已列出");
    expect(markup).toContain("6");
    expect(markup).toContain("50%");
    expect(markup).toContain("输入与 GitHub 接入");
    expect(markup).toContain("SPEC 树工作台");
    expect(markup).toContain("设计");
  });

  it("renders clarification strategy metadata from latest job data", () => {
    const latestPayload = {
      job: {
        id: "job-strategy-1",
        request: {
          targetText: "Clarify a route-ready permissions workflow.",
          githubUrls: [],
        },
        status: "running",
        stage: "input",
        version: "blueprint-generation/v1",
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:01:00.000Z",
        artifacts: [],
        events: [],
      },
      clarification_session: {
        id: "clarification-strategy-1",
        intake_id: "intake-strategy-1",
        project_id: "project-strategy",
        strategy_id: "preview_first",
        strategyLabel: "Route readiness sweep",
        template_id: "template-route-ready-v2",
        route_dimension: "execution",
        readiness_signal: "fast_path",
        settled_by_strategy: true,
        route_ready_summary:
          "Route is ready once ownership, audit trail, and rollback boundaries are settled.",
        readiness: {
          status: "ready",
          score: 1,
          answered_required: 2,
          required_total: 2,
          missing_question_ids: [],
          readiness_signal: "fast_path",
          route_ready_summary:
            "All critical route dimensions are ready for RouteSet generation.",
        },
        questions: [
          {
            id: "question-owner",
            kind: "domain",
            prompt: "Which team owns permission rollback decisions?",
            required: true,
            route_dimension: "handoff",
            readiness_signal: "domain_assets",
            template_id: "template-route-ready-v2",
            answer_provenance: {
              source: "strategy-template",
            },
          },
          {
            id: "question-audit",
            kind: "constraint",
            prompt: "What audit signal proves a denied action was reviewed?",
            required: true,
            routeDimension: "risk",
            readinessSignal: "risk_review",
          },
        ],
        answers: [
          {
            question_id: "question-owner",
            answer: "The product decision lead owns rollback decisions.",
            route_dimension: "handoff",
            answer_provenance: {
              source: "user",
            },
          },
        ],
        created_at: "2026-05-07T00:00:00.000Z",
        updated_at: "2026-05-07T00:01:00.000Z",
      },
    };
    const latest = normalizeBlueprintLatestGenerationJobResponse(
      latestPayload as Parameters<
        typeof normalizeBlueprintLatestGenerationJobResponse
      >[0]
    );

    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        showRouteGeneration={false}
        showSpecProgress={false}
        showSpecTreePreview={false}
        showSpecDocumentWorkbench={false}
        showEffectPreviewWorkbench={false}
        showPromptPackageWorkbench={false}
        showRuntimeCapabilityBridgeWorkbench={false}
        showEngineeringLandingWorkbench={false}
        showArtifactMemoryWorkbench={false}
        initialJob={latest.job}
        initialClarificationSession={latest.clarificationSession}
      />
    );

    expect(markup).toContain(
      'data-testid="blueprint-clarification-strategy-summary"'
    );
    expect(
      markup.match(/data-testid="blueprint-clarification-strategy-question"/g)
        ?.length
    ).toBe(2);
    expect(markup).toContain("Route readiness sweep");
    expect(markup).toContain("template-route-ready-v2");
    expect(markup).toContain(
      "Route is ready once ownership, audit trail, and rollback boundaries are settled."
    );
    expect(markup).toContain("handoff");
    expect(markup).toContain("risk");
    expect(markup).toContain("Which team owns permission rollback decisions?");
    expect(markup).toContain(
      "What audit signal proves a denied action was reviewed?"
    );
  });

  it("normalizes shared latest engineering landing payloads before rendering", () => {
    const latestPayload = {
      job: {
        id: "job-latest-landing",
        request: {
          targetText: "Land the generated blueprint in a Codex workspace.",
          githubUrls: [],
        },
        status: "completed",
        stage: "engineering_landing",
        version: "blueprint-generation/v1",
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:10:00.000Z",
        artifacts: [],
        events: [],
      },
      specTree: {
        id: "spec-tree-latest",
        routeSetId: "routeset-latest",
        selectionId: "selection-latest",
        selectedRouteId: "route-primary",
        rootNodeId: "node-root",
        version: 2,
        status: "draft",
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:05:00.000Z",
        alternativeRouteIds: [],
        provenance: {
          jobId: "job-latest-landing",
          githubUrls: [],
        },
        nodes: [
          {
            id: "node-root",
            title: "Engineering landing root",
            summary: "Root node for latest landing payload.",
            type: "root",
            status: "draft",
            priority: 0,
            dependencies: [],
            outputs: [],
            children: [],
          },
        ],
      },
      promptPackages: [
        {
          id: "prompt-package-latest",
          jobId: "job-latest-landing",
          treeId: "spec-tree-latest",
          nodeIds: ["node-root"],
          targetPlatform: "codex",
          target: {
            platform: "codex",
            label: "Codex",
            executionMode: "workspace",
            guidance: "Use this package in a Codex workspace.",
          },
          title: "Codex implementation prompt package",
          summary: "Prompt package ready for a Codex handoff.",
          content: "Implement the generated blueprint.",
          sections: [],
          sourceDocumentIds: ["doc-requirements"],
          sourcePreviewIds: ["preview-latest"],
          createdAt: "2026-05-07T00:06:00.000Z",
          updatedAt: "2026-05-07T00:06:00.000Z",
          provenance: {
            jobId: "job-latest-landing",
            githubUrls: [],
            treeVersion: 2,
            nodeIds: ["node-root"],
            sourceDocumentIds: ["doc-requirements"],
            sourcePreviewIds: ["preview-latest"],
            targetPlatform: "codex",
            sourceDocumentStatus: "accepted",
            sourcePreviewStatus: "accepted",
            includeDrafts: false,
            includePreviewDrafts: false,
            sourceDocumentStatuses: {
              "doc-requirements": "accepted",
            },
            sourcePreviewStatuses: {
              "preview-latest": "completed",
            },
          },
        },
      ],
      engineeringLandingPlans: [
        {
          id: "landing-plan-latest",
          jobId: "job-latest-landing",
          treeId: "spec-tree-latest",
          status: "ready",
          title: "Engineering landing plan: Codex",
          summary: "Shared contract payload should render in the workbench.",
          promptPackageIds: ["prompt-package-latest"],
          steps: [
            {
              id: "landing-step-latest",
              title: "Capture run evidence",
              summary: "Record the Codex handoff verification result.",
              mode: "handoff",
              sourceNodeIds: ["node-root"],
              sourceDocumentIds: ["doc-requirements"],
              sourcePreviewIds: ["preview-latest"],
              promptPackageIds: ["prompt-package-latest"],
              fileScopes: ["server/tests/blueprint-routes.test.ts"],
              verificationCommands: [
                "pnpm vitest server/tests/blueprint-routes.test.ts",
              ],
              riskLevel: "medium",
            },
          ],
          handoffs: [
            {
              id: "handoff-latest",
              platform: "codex",
              title: "Platform handoff: Codex",
              summary: "Use Codex to apply the generated prompt package.",
              content:
                "Use target package.\nRun verification before handoff.",
              promptPackageId: "prompt-package-latest",
              sourceNodeIds: ["node-root"],
              verificationCommands: [
                "pnpm vitest server/tests/blueprint-routes.test.ts",
              ],
            },
          ],
          createdAt: "2026-05-07T00:07:00.000Z",
          updatedAt: "2026-05-07T00:08:00.000Z",
          provenance: {
            jobId: "job-latest-landing",
            githubUrls: [],
            treeVersion: 2,
            promptPackageIds: ["prompt-package-latest"],
            sourceNodeIds: ["node-root"],
            sourceDocumentIds: ["doc-requirements"],
            sourcePreviewIds: ["preview-latest"],
            sourceDocumentStatus: "accepted",
            sourcePreviewStatus: "accepted",
            sourceDocumentStatuses: {
              "doc-requirements": "accepted",
            },
            sourcePreviewStatuses: {
              "preview-latest": "completed",
            },
            promptPackagePlatforms: {
              "prompt-package-latest": "codex",
            },
          },
        },
      ],
      engineeringRuns: [
        {
          id: "engineering-run-latest",
          jobId: "job-latest-landing",
          landingPlanId: "landing-plan-latest",
          status: "passed",
          summary: "Codex handoff evidence was recorded.",
          logs: ["Recorded latest landing run."],
          verificationResults: [
            {
              command: "pnpm vitest server/tests/blueprint-routes.test.ts",
              status: "passed",
              output: "green",
            },
          ],
          changedFiles: ["server/tests/blueprint-routes.test.ts"],
          provenance: {
            jobId: "job-latest-landing",
            landingPlanId: "landing-plan-latest",
          },
          createdAt: "2026-05-07T00:09:00.000Z",
          updatedAt: "2026-05-07T00:09:00.000Z",
          recordedAt: "2026-05-07T00:09:00.000Z",
        },
      ],
    };
    const latest = normalizeBlueprintLatestGenerationJobResponse(
      latestPayload as unknown as Parameters<
        typeof normalizeBlueprintLatestGenerationJobResponse
      >[0]
    );
    const landingPlans = latest.landingPlans ?? [];
    const engineeringRuns = latest.engineeringRuns ?? [];

    expect(landingPlans[0]?.sourcePromptPackageIds).toEqual([
      "prompt-package-latest",
    ]);
    expect(landingPlans[0]?.handoffs[0]?.label).toBe(
      "Platform handoff: Codex"
    );
    expect(landingPlans[0]?.verificationCommands[0]?.command).toBe(
      "pnpm vitest server/tests/blueprint-routes.test.ts"
    );

    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        showRouteGeneration={false}
        showSpecProgress={false}
        showSpecTreePreview={false}
        showSpecDocumentWorkbench={false}
        showEffectPreviewWorkbench={false}
        showPromptPackageWorkbench={false}
        showRuntimeCapabilityBridgeWorkbench={false}
        showArtifactMemoryWorkbench={false}
        initialJob={latest.job}
        initialSpecTree={latest.specTree}
        initialPromptPackages={latest.promptPackages}
        initialEngineeringLandingPlans={landingPlans}
        initialEngineeringRuns={engineeringRuns}
      />
    );

    expect(markup).toContain('data-testid="engineering-landing-workbench"');
    expect(markup).toContain("Engineering landing plan: Codex");
    expect(markup).toContain("Platform handoff: Codex");
    expect(markup).toContain("Use target package.");
    expect(markup).toContain("捕获执行证据");
    expect(markup).toContain('data-testid="engineering-verification-commands"');
    expect(markup).toContain("pnpm vitest server/tests/blueprint-routes.test.ts");
    expect(markup).toContain("Codex handoff evidence was recorded.");
  });

  it("renders the latest generated RouteSet with tree and document workbenches", () => {
    const routeSet = {
      id: "routeset-1",
      requestId: "job-1",
      createdAt: "2026-05-06T00:00:00.000Z",
      primaryRouteId: "route-primary",
      nextAsset: {
        type: "spec_tree" as const,
        menu: "deduction" as const,
        description: "Use the selected RouteSet path as the SPEC tree seed.",
      },
      provenance: {
        githubUrls: ["https://github.com/example/repo"],
      },
      routes: [
        {
          id: "route-primary",
          kind: "primary" as const,
          title: "Primary SPEC asset route",
          summary: "Clarify, derive SPEC tree, then package prompts.",
          rationale: "Balanced path.",
          riskLevel: "medium" as const,
          costLevel: "medium" as const,
          complexity: "balanced" as const,
          estimatedEffort: "2-4 analysis passes",
          capabilities: [
            {
              id: "docker-analysis",
              label: "Docker analysis sandbox",
              kind: "docker" as const,
              purpose: "Analyze source in isolation.",
            },
          ],
          steps: [
            {
              id: "clarify-intent",
              title: "Clarify execution intent",
              description: "Collect target users and boundaries.",
              role: "Product strategist",
              status: "ready" as const,
            },
          ],
          outputs: ["RouteSet outline"],
        },
        {
          id: "route-alt",
          kind: "alternative" as const,
          title: "Documentation-first conservative route",
          summary: "Freeze docs before preview.",
          rationale: "Lower risk.",
          riskLevel: "low" as const,
          costLevel: "low" as const,
          complexity: "light" as const,
          estimatedEffort: "1-2 review passes",
          capabilities: [],
          steps: [],
          outputs: ["Requirements"],
        },
      ],
    };

    const engineeringLandingPlans =
      normalizeBlueprintEngineeringLandingResponse(
        {
          landing_plans: [
            {
              id: "landing-plan-1",
              job_id: "job-1",
              tree_id: "spec-tree-1",
              prompt_package_id: "prompt-package-1",
              target_platform: "cursor",
              title: "Cursor engineering landing plan",
              summary:
                "Hand off the permission system package to a Cursor workspace.",
              status: "ready",
              platform_handoffs: [
                {
                  id: "handoff-cursor",
                  platform: "cursor",
                  label: "Cursor workspace handoff",
                  summary:
                    "Open the prompt package in Cursor and apply the permission workflow.",
                  prompt_package_id: "prompt-package-1",
                  instructions: [
                    "Use the Objective and Acceptance checklist sections.",
                    "Keep audit persistence changes scoped to permission files.",
                  ],
                },
              ],
              implementation_steps: [
                {
                  id: "landing-step-schema",
                  title: "Apply permission schema",
                  summary:
                    "Implement auditable role grants and denied-action replay.",
                  status: "ready",
                  commands: ["pnpm vitest permission"],
                  prompt_package_ids: ["prompt-package-1"],
                },
              ],
              verification_commands: [
                {
                  id: "verify-permission",
                  title: "Permission tests",
                  command: "pnpm vitest permission",
                  expected: "Permission workflow tests pass.",
                },
              ],
              changed_files: ["client/src/permission.ts"],
              created_at: "2026-05-06T00:00:00.000Z",
              updated_at: "2026-05-06T00:00:00.000Z",
            },
          ],
        },
        "job-1"
      ).landingPlans;

    const engineeringRuns = normalizeBlueprintEngineeringRunsResponse(
      {
        landing_plan: {
          id: "landing-plan-1",
          job_id: "job-1",
          tree_id: "spec-tree-1",
          prompt_package_id: "prompt-package-1",
          platform: "cursor",
          title: "Cursor engineering landing plan",
          summary:
            "Hand off the permission system package to a Cursor workspace.",
          status: "ready",
        },
        engineering_runs: [
          {
            id: "engineering-run-1",
            job_id: "job-1",
            landing_plan_id: "landing-plan-1",
            status: "passed",
            summary: "Cursor handoff implemented and verified.",
            logs: ["Applied permission schema."],
            verification_results: [
              {
                id: "verification-result-1",
                title: "Permission tests",
                command: "pnpm vitest permission",
                status: "passed",
                summary: "Green test run.",
              },
            ],
            changed_files: ["client/src/permission.ts"],
            recorded_at: "2026-05-06T00:10:00.000Z",
          },
        ],
      },
      "job-1"
    ).engineeringRuns;

    const artifactLedgerEntries = normalizeBlueprintArtifactLedgerResponse(
      {
        entries: [
          {
            id: "ledger-route",
            job_id: "job-1",
            artifact_id: "artifact-route",
            artifact_type: "route_set",
            stage: "route_generation",
            title: "RouteSet generated",
            summary: "Primary SPEC asset route was generated.",
            status: "recorded",
            version: 1,
            created_at: "2026-05-06T00:00:00.000Z",
          },
          {
            id: "ledger-run",
            job_id: "job-1",
            artifact_id: "artifact-run",
            artifact_type: "engineering_run",
            stage: "engineering_landing",
            title: "Engineering run recorded",
            summary: "Cursor handoff implementation evidence was stored.",
            status: "recorded",
            version: 1,
            source_entry_ids: ["ledger-route"],
            source_artifact_ids: ["artifact-route"],
            lineage_edges: [
              {
                id: "lineage-route-run",
                from_entry_id: "ledger-route",
                to_entry_id: "ledger-run",
                kind: "derived_from",
                summary: "Run evidence derives from the RouteSet.",
              },
            ],
            created_at: "2026-05-06T00:10:00.000Z",
          },
        ],
      },
      "job-1"
    ).entries;
    const artifactReplays = normalizeBlueprintArtifactReplaysResponse(
      {
        replays: [
          {
            id: "artifact-replay-1",
            job_id: "job-1",
            title: "Permission project replay",
            summary: "Recovered RouteSet to engineering run timeline.",
            status: "ready",
            snapshots: [
              {
                id: "replay-snapshot-run",
                entry_id: "ledger-run",
                artifact_type: "engineering_run",
                stage: "engineering_landing",
                title: "Engineering run recorded",
                summary: "Cursor handoff implementation evidence was stored.",
                status: "replayed",
                lineage_edge_count: 1,
              },
            ],
            lineage_edges: [
              {
                id: "lineage-route-run",
                from_entry_id: "ledger-route",
                to_entry_id: "ledger-run",
                kind: "derived_from",
              },
            ],
            lineage_edge_count: 1,
            created_at: "2026-05-06T00:12:00.000Z",
          },
        ],
      },
      "job-1"
    ).replays;
    const artifactFeedback = [
      normalizeBlueprintArtifactFeedbackResponse(
        {
          feedback: {
            id: "artifact-feedback-1",
            job_id: "job-1",
            entry_id: "ledger-run",
            sentiment: "positive",
            status: "backfilled",
            summary: "Execution evidence approved for future SPEC evolution.",
            notes: "Bind this run back into the asset memory.",
            backfill_targets: ["spec-tree-1", "prompt-package-1"],
            created_at: "2026-05-06T00:14:00.000Z",
          },
        },
        "job-1"
      ).feedback,
    ];
    const artifactDiff = normalizeBlueprintArtifactDiffResponse(
      {
        diff: {
          id: "artifact-diff-1",
          job_id: "job-1",
          left_entry_id: "ledger-route",
          right_entry_id: "ledger-run",
          title: "Route to run diff",
          summary: "Engineering run adds implementation evidence.",
          status: "ready",
          added: 1,
          changed: 1,
        },
      },
      "job-1"
    ).diff;
    expect(artifactDiff.summary).toContain("implementation evidence");
    const agentCrew = normalizeBlueprintAgentCrew({
      id: "agent-crew-1",
      job_id: "job-1",
      stage: "runtime_capability",
      created_at: "2026-05-06T00:00:00.000Z",
      updated_at: "2026-05-06T00:07:00.000Z",
      roles: [
        {
          id: "role-runtime-executor",
          name: "Runtime Executor",
          group: "execution",
          responsibility: "Drive runtime capability invocations.",
          defaultStages: ["runtime_capability"],
          permissions: ["invoke_capability"],
          displayName: "Runtime Executor",
          displayLabelZh: "Runtime Executor",
        },
        {
          id: "role-experience-presenter",
          name: "Experience Presenter",
          group: "presentation",
          responsibility: "Keep browser preview artifacts aligned.",
          defaultStages: ["effect_preview", "runtime_capability"],
          permissions: ["publish_preview"],
          displayName: "Experience Presenter",
          displayLabelZh: "Experience Presenter",
        },
        {
          id: "role-quality-auditor",
          name: "Quality Auditor",
          group: "audit",
          responsibility: "Review runtime evidence and logs.",
          defaultStages: ["runtime_capability"],
          permissions: ["review_evidence"],
          displayName: "Quality Auditor",
          displayLabelZh: "Quality Auditor",
        },
        {
          id: "role-memory-curator",
          name: "Memory Curator",
          group: "memory",
          responsibility: "Stand by for artifact memory updates.",
          defaultStages: ["artifact_memory"],
          permissions: ["read_artifacts"],
          displayName: "Memory Curator",
          displayLabelZh: "Memory Curator",
        },
      ],
      capability_matrix: [
        {
          id: "binding-runtime-docker",
          roleId: "role-runtime-executor",
          capabilityId: "capability-docker-analysis",
          applicableStages: ["runtime_capability"],
          inputSchema: "{}",
          outputSchema: "{}",
          tools: ["docker"],
          requiresSandbox: true,
          producesArtifacts: true,
          auditRules: ["record-logs"],
          capabilityLabel: "Docker analysis sandbox",
          capabilityKind: "docker",
          roleDisplayName: "Runtime Executor",
        },
        {
          id: "binding-presenter-skill",
          roleId: "role-experience-presenter",
          capabilityId: "capability-skill-publisher",
          applicableStages: ["runtime_capability"],
          inputSchema: "{}",
          outputSchema: "{}",
          tools: ["browser-preview"],
          requiresSandbox: false,
          producesArtifacts: true,
          auditRules: ["record-preview"],
          capabilityLabel: "Skill evidence publisher",
          capabilityKind: "skill",
          roleDisplayName: "Experience Presenter",
        },
      ],
      role_timelines: [
        {
          role_id: "role-runtime-executor",
          stage: "runtime_capability",
          state: "active",
          current_action:
            "Runtime executor is invoking Docker analysis for permission boundaries.",
          capability_ids: ["capability-docker-analysis"],
          artifact_ids: ["analysis-report.md"],
          evidence_ids: ["capability-evidence-1"],
          latest_artifact: "analysis-report.md",
          latest_evidence: "capability-evidence-1",
          latest_capability: "Docker analysis sandbox",
        },
        {
          role_id: "role-experience-presenter",
          stage: "runtime_capability",
          state: "watching",
          current_action:
            "Experience presenter is watching browser preview artifacts for handoff signals.",
          capability_ids: ["capability-skill-publisher"],
          artifact_ids: ["browser-preview.svg"],
          evidence_ids: [],
          latest_artifact: "browser-preview.svg",
          latest_capability: "Skill evidence publisher",
        },
        {
          role_id: "role-quality-auditor",
          stage: "runtime_capability",
          state: "reviewing",
          current_action:
            "Quality auditor is reviewing runtime evidence and invocation logs.",
          capability_ids: ["capability-docker-analysis"],
          artifact_ids: ["analysis-report.md"],
          evidence_ids: ["capability-evidence-1"],
          latest_evidence: "capability-evidence-1",
        },
        {
          role_id: "role-memory-curator",
          stage: "runtime_capability",
          state: "sleeping",
          current_action:
            "Memory curator is sleeping until artifact memory backfill starts.",
          capability_ids: [],
          artifact_ids: [],
          evidence_ids: [],
        },
      ],
      source_ids: {
        capabilityIds: ["capability-docker-analysis", "capability-skill-publisher"],
      },
    });
    expect(agentCrew?.roleTimelines.map(role => role.state)).toEqual([
      "active",
      "watching",
      "reviewing",
      "sleeping",
    ]);

    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        initialRouteSet={routeSet}
        initialSelection={{
          id: "selection-1",
          routeSetId: "routeset-1",
          routeId: "route-primary",
          routeTitle: "Primary SPEC asset route",
          selectedAt: "2026-05-06T00:00:00.000Z",
          reason: "Balanced route.",
          mergedAlternativeRouteIds: ["route-alt"],
          status: "selected",
          provenance: {
            jobId: "job-1",
          },
        }}
        initialSpecTree={{
          id: "spec-tree-1",
          routeSetId: "routeset-1",
          selectionId: "selection-1",
          selectedRouteId: "route-primary",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          alternativeRouteIds: ["route-alt"],
          provenance: {
            jobId: "job-1",
            githubUrls: ["https://github.com/example/repo"],
          },
          nodes: [
            {
              id: "node-root",
              title: "SPEC asset tree: Permission System",
              summary: "Durable tree asset derived from the route.",
              type: "root",
              status: "draft",
              priority: 0,
              routeId: "route-primary",
              dependencies: [],
              outputs: ["SPEC tree"],
              children: ["node-docs"],
            },
            {
              id: "node-docs",
              parentId: "node-root",
              title: "Specification document generation",
              summary: "Expand requirements, design, and tasks.",
              type: "spec_document",
              status: "seed",
              priority: 1,
              routeId: "route-primary",
              dependencies: [],
              outputs: ["requirements.md", "design.md", "tasks.md"],
              children: ["node-task"],
            },
            {
              id: "node-task",
              parentId: "node-docs",
              title: "Task breakdown",
              summary: "Split the SPEC into implementation-ready chunks.",
              type: "engineering_plan",
              status: "draft",
              priority: 2,
              routeId: "route-primary",
              dependencies: ["node-docs"],
              outputs: ["task checklist"],
              children: [],
            },
          ],
        }}
        initialSpecDocuments={[
          {
            id: "doc-requirements",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-docs",
            type: "requirements",
            status: "accepted",
            version: 1,
            sourceDocumentId: "doc-source-requirements",
            title: "Requirements: Permission System",
            summary: "User-facing requirements for the permission system.",
            content: "# Requirements\n\n- Track audit evidence.",
            format: "markdown",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            provenance: {
              jobId: "job-1",
              githubUrls: ["https://github.com/example/repo"],
              treeVersion: 1,
              nodeType: "spec_document",
              nodeTitle: "Specification document generation",
              nodeSummary: "Expand requirements, design, and tasks.",
              dependencies: [],
              outputs: ["requirements.md", "design.md", "tasks.md"],
            },
          },
        ]}
        initialEffectPreviews={[
          {
            id: "preview-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-docs",
            sourceDocumentIds: ["doc-requirements"],
            status: "completed",
            summary:
              "Preview of architecture, prototype cues, and implementation progress.",
            architectureNotes: [
              "Keep policy evaluation behind an auditable service boundary.",
              "Persist review evidence with immutable timestamps.",
            ],
            prototypeNotes: [
              "Show role assignment and denied-action replay in the prototype.",
            ],
            progressPlan: [
              {
                id: "preview-step-1",
                title: "Model permission resources",
                summary: "Define roles, grants, denials, and audit joins.",
                target: "Resources are ready for implementation prompts.",
                sourceDocumentIds: ["doc-requirements"],
              },
            ],
            nodes: [],
            runtimeProjection: {
              id: "projection-1",
              jobId: "job-1",
              routeSetId: "routeset-1",
              routeId: "route-primary",
              specTreeId: "spec-tree-1",
              nodeId: "node-docs",
              effectPreviewId: "preview-1",
              sceneSnapshotId: "scene-snapshot-1",
              hudState: {
                id: "hud-1",
                status: "completed",
                stage: "effect_preview",
                title: "Permission preview HUD",
                summary: "HUD is bound to permission preview progress.",
                progressPercent: 100,
                activeNodeId: "node-docs",
                badges: ["HUD linked"],
              },
              logTimeline: [
                {
                  id: "runtime-log-1",
                  level: "success",
                  message: "Runtime projection is linked.",
                  occurredAt: "2026-05-06T00:00:00.000Z",
                  sourceDocumentIds: ["doc-requirements"],
                },
              ],
              browserPreviewId: "browser-preview-1",
              browserPreview: {
                id: "browser-preview-1",
                title: "Permission browser preview",
                summary: "Browser preview is bound to permission SPEC state.",
                routeId: "route-primary",
                nodeId: "node-docs",
                url: "/autopilot/preview/job-1/node-docs",
              },
              sourceIds: {
                routeSetId: "routeset-1",
                specTreeId: "spec-tree-1",
                nodeIds: ["node-docs"],
                specDocumentIds: ["doc-requirements"],
                effectPreviewIds: ["preview-1"],
              },
            },
            createdAt: "2026-05-06T00:00:00.000Z",
            provenance: {
              jobId: "job-1",
              githubUrls: ["https://github.com/example/repo"],
              treeVersion: 1,
              nodeType: "spec_document",
              nodeTitle: "Specification document generation",
              nodeSummary: "Expand requirements, design, and tasks.",
              sourceStatus: "accepted",
              includeDrafts: false,
              sourceDocumentStatuses: {
                "doc-requirements": "accepted",
              },
            },
          },
        ]}
        initialPromptPackages={[
          {
            id: "prompt-package-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeIds: ["node-task"],
            targetPlatform: "cursor",
            target: {
              platform: "cursor",
              label: "Cursor",
              executionMode: "workspace",
              guidance: "Use this package inside a Cursor workspace.",
            },
            title: "Cursor implementation prompt package",
            summary:
              "Copy-ready prompt package for implementing the permission system.",
            content:
              "Implement the permission system with auditable role grants, denied-action replay, and immutable review evidence.",
            sections: [
              {
                id: "section-objective",
                kind: "context",
                title: "Objective",
                content:
                  "Build the permission workflow from accepted SPEC documents and the effect preview.",
                items: [],
                nodeIds: ["node-task"],
                sourceDocumentIds: ["doc-requirements"],
                sourcePreviewIds: ["preview-1"],
              },
              {
                id: "section-acceptance",
                kind: "verification",
                title: "Acceptance checklist",
                content:
                  "Verify role assignment, denied-action replay, and audit evidence persistence.",
                items: [],
                nodeIds: ["node-task"],
                sourceDocumentIds: ["doc-requirements"],
                sourcePreviewIds: ["preview-1"],
              },
            ],
            sourceDocumentIds: ["doc-requirements"],
            sourcePreviewIds: ["preview-1"],
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            provenance: {
              jobId: "job-1",
              githubUrls: ["https://github.com/example/repo"],
              treeVersion: 1,
              nodeIds: ["node-task"],
              sourceDocumentIds: ["doc-requirements"],
              sourcePreviewIds: ["preview-1"],
              targetPlatform: "cursor",
              sourceDocumentStatus: "accepted",
              sourcePreviewStatus: "accepted",
              includeDrafts: false,
              includePreviewDrafts: false,
              sourceDocumentStatuses: {
                "doc-requirements": "accepted",
              },
              sourcePreviewStatuses: {
                "preview-1": "completed",
              },
            },
          },
        ]}
        initialCapabilities={[
          {
            id: "capability-docker-analysis",
            label: "Docker analysis sandbox",
            kind: "docker",
            purpose: "Analyze source safely in an isolated runtime.",
            description:
              "Runs repository inspection commands inside a sandboxed Docker adapter.",
            tags: ["analysis", "sandbox"],
            securityLevel: "sandboxed",
            status: "available",
            adapter: "docker-blueprint-adapter",
            inputSchema: "{\"type\":\"object\"}",
            outputTypes: ["analysis", "log"],
            supportedStages: ["runtime_capability", "engineering_landing"],
            requiresApproval: false,
            projectScoped: true,
          },
          {
            id: "capability-skill-publisher",
            label: "Skill evidence publisher",
            kind: "skill",
            purpose: "Publish reusable skill evidence for later handoff.",
            description:
              "Normalizes generated notes into runtime capability evidence.",
            tags: ["evidence"],
            securityLevel: "readonly",
            status: "requires_approval",
            adapter: "skill-blueprint-adapter",
            inputSchema: "{\"type\":\"object\"}",
            outputTypes: ["document"],
            supportedStages: ["runtime_capability"],
            requiresApproval: true,
            projectScoped: false,
          },
        ]}
        initialAgentCrew={agentCrew}
        initialCapabilityInvocations={[
          {
            id: "capability-invocation-1",
            jobId: "job-1",
            capabilityId: "capability-docker-analysis",
            capabilityLabel: "Docker analysis sandbox",
            kind: "docker",
            status: "completed",
            securityLevel: "sandboxed",
            safetyGate: {
              status: "allowed",
              reason: "Sandboxed analysis is permitted for this job.",
              requiresApproval: false,
              approved: true,
              securityLevel: "sandboxed",
            },
            requestedAt: "2026-05-06T00:06:00.000Z",
            completedAt: "2026-05-06T00:07:00.000Z",
            requestedBy: "blueprint-workbench",
            routeId: "route-primary",
            nodeId: "node-task",
            input: "Inspect permission model boundaries.",
            outputSummary:
              "Docker sandbox found auditable permission boundaries.",
            logs: ["Analyzed policy service files."],
            evidenceIds: ["capability-evidence-1"],
            durationMs: 62000,
            provenance: {
              jobId: "job-1",
              routeSetId: "routeset-1",
              routeId: "route-primary",
              specTreeId: "spec-tree-1",
              nodeId: "node-task",
              targetText: "Build a permission system.",
              githubUrls: ["https://github.com/example/repo"],
            },
          },
        ]}
        initialCapabilityEvidence={[
          {
            id: "capability-evidence-1",
            jobId: "job-1",
            invocationId: "capability-invocation-1",
            capabilityId: "capability-docker-analysis",
            capabilityLabel: "Docker analysis sandbox",
            kind: "analysis",
            status: "recorded",
            title: "Permission boundary analysis",
            summary:
              "Runtime evidence confirms permission checks have auditable service boundaries.",
            createdAt: "2026-05-06T00:07:00.000Z",
            routeSetId: "routeset-1",
            routeId: "route-primary",
            specTreeId: "spec-tree-1",
            nodeId: "node-task",
            artifacts: ["analysis-report.md"],
            logs: ["Policy service inspected."],
            tags: ["permission", "audit"],
            payloadSummary: {
              files: 3,
              riskyWrite: false,
              finding: "auditable boundary",
            },
            provenance: {
              jobId: "job-1",
              routeSetId: "routeset-1",
              routeId: "route-primary",
              specTreeId: "spec-tree-1",
              nodeId: "node-task",
              targetText: "Build a permission system.",
              githubUrls: ["https://github.com/example/repo"],
            },
          },
        ]}
        initialEngineeringLandingPlans={engineeringLandingPlans}
        initialEngineeringRuns={engineeringRuns}
        initialArtifactLedgerEntries={artifactLedgerEntries}
        initialArtifactReplays={artifactReplays}
        initialArtifactFeedback={artifactFeedback}
        initialJob={{
          id: "job-1",
          request: {
            targetText: "Build a permission system.",
            githubUrls: ["https://github.com/example/repo"],
          },
          status: "completed",
          stage: "route_generation",
          version: "blueprint-generation/v1",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          completedAt: "2026-05-06T00:00:00.000Z",
          artifacts: [],
          events: [],
        }}
      />
    );

    expect(markup).toContain('data-testid="blueprint-routeset-preview"');
    expect(markup).toContain("已选择用于推导的路线");
    expect(markup).toContain("主执行路径：SPEC 资产路线");
    expect(markup).toContain("次选路径：文档优先稳妥路线");
    expect(markup).toContain("Docker 分析沙盒");
    expect(markup).toContain('data-testid="blueprint-reset-route-selection-button"');
    expect(markup).toContain("重置路线");
    expect(markup).toContain('data-testid="blueprint-spec-tree-preview"');
    expect(markup).toContain("推导 SPEC 树工作台");
    expect(markup).toContain('data-testid="spec-tree-action-toolbar"');
    expect(markup).toContain("结构操作");
    expect(markup).toContain('data-testid="spec-tree-add-node-button"');
    expect(markup).toContain("添加子节点");
    expect(markup).toContain('data-testid="spec-tree-move-node-button"');
    expect(markup).toContain("移动节点");
    expect(markup).toContain('data-testid="spec-tree-merge-node-button"');
    expect(markup).toContain("合并节点");
    expect(markup).toContain('data-testid="spec-tree-split-node-button"');
    expect(markup).toContain("拆分节点");
    expect(markup).toContain('data-testid="spec-tree-delete-node-button"');
    expect(markup).toContain("删除节点");
    expect(markup).toContain('data-testid="spec-tree-version-timeline"');
    expect(markup).toContain("版本时间线");
    expect(markup).toContain('data-testid="spec-tree-node-list"');
    expect(markup).toContain('data-testid="spec-tree-node-detail"');
    expect(markup).toContain("SPEC 资产树：权限系统");
    expect(markup).toContain("任务拆分");
    expect(markup).toContain("保存节点");
    expect(markup).toContain("保存版本");
    expect(markup).toContain("规格文档生成");
    expect(markup).toContain('data-testid="spec-document-workbench"');
    expect(markup).toContain("规格文档工作台");
    expect(markup).toContain("生成文档");
    expect(markup).toContain('data-testid="spec-document-review-status"');
    expect(markup).toContain("已接受");
    expect(markup).toContain('data-testid="spec-document-accept-button"');
    expect(markup).toContain("接受");
    expect(markup).toContain('data-testid="spec-document-reject-button"');
    expect(markup).toContain("拒绝");
    expect(markup).toContain(
      'data-testid="spec-document-save-version-button"'
    );
    expect(markup).toContain('data-testid="spec-document-preview"');
    expect(markup).toContain("跟踪审计证据。");
    expect(markup).toContain('data-testid="effect-preview-workbench"');
    expect(markup).toContain("效果预演");
    expect(markup).toContain("已接受 SPEC 的效果预演");
    expect(markup).toContain("生成预演");
    expect(markup).toContain('data-testid="effect-preview-list"');
    expect(markup).toContain("预演详情");
    expect(markup).toContain("架构说明");
    expect(markup).toContain(
      "将策略评估保持在可审计的服务边界之后。"
    );
    expect(markup).toContain("原型说明");
    expect(markup).toContain(
      "在原型中展示角色分配和拒绝动作回放。"
    );
    expect(markup).toContain("进度规划");
    expect(markup).toContain("建模权限资源");
    expect(markup).toContain('data-testid="prompt-package-workbench"');
    expect(markup).toContain("实现提示词包");
    expect(markup).toContain('data-testid="prompt-package-platform-filter"');
    expect(markup).toContain("Cursor");
    expect(markup).toContain("Kiro");
    expect(markup).toContain("Trae");
    expect(markup).toContain("Windsurf");
    expect(markup).toContain("Codex");
    expect(markup).toContain("Claude");
    expect(markup).toContain('data-testid="prompt-package-generate-button"');
    expect(markup).toContain("生成提示词包");
    expect(markup).toContain('data-testid="prompt-package-list"');
    expect(markup).toContain("Cursor 实现提示词包");
    expect(markup).toContain('data-testid="prompt-package-sections-preview"');
    expect(markup).toContain("目标");
    expect(markup).toContain("验收清单");
    expect(markup).toContain(
      "实现具备可审计角色授权"
    );
    expect(markup).toContain("来源文档 / 预演");
    expect(markup).toContain(
      'data-testid="runtime-capability-bridge-workbench"'
    );
    expect(markup).toContain("运行时能力桥");
    expect(markup).toContain("运行时能力桥工作台");
    expect(markup).toContain('data-testid="blueprint-agent-crew-surface"');
    expect(markup).toContain('data-testid="blueprint-agent-role-row"');
    expect(markup).toContain("Active");
    expect(markup).toContain("Watching");
    expect(markup).toContain("Reviewing");
    expect(markup).toContain("Sleeping");
    expect(markup).toContain(
      "Runtime executor is invoking Docker analysis for permission boundaries."
    );
    expect(markup).toContain(
      "Experience presenter is watching browser preview artifacts for handoff signals."
    );
    expect(markup).toContain(
      "Quality auditor is reviewing runtime evidence and invocation logs."
    );
    expect(markup).toContain(
      "Memory curator is sleeping until artifact memory backfill starts."
    );
    expect(markup).toContain("browser-preview.svg");
    expect(markup).toContain('data-testid="capability-registry-list"');
    expect(markup).toContain("Docker 分析沙盒");
    expect(markup).toContain("技能证据发布器");
    expect(markup).toContain('data-testid="capability-launcher-select"');
    expect(markup).toContain('data-testid="capability-launcher-node-select"');
    expect(markup).toContain('data-testid="capability-invoke-button"');
    expect(markup).toContain("调用能力");
    expect(markup).toContain('data-testid="capability-invocation-list"');
    expect(markup).toContain(
      "Docker 沙盒发现了可审计的权限边界。"
    );
    expect(markup).toContain('data-testid="capability-evidence-list"');
    expect(markup).toContain("权限边界分析");
    expect(markup).toContain(
      "运行时证据确认权限校验具有可审计的服务边界。"
    );
    expect(markup.indexOf('data-testid="prompt-package-workbench"')).toBeLessThan(
      markup.indexOf('data-testid="runtime-capability-bridge-workbench"')
    );
    expect(
      markup.indexOf('data-testid="runtime-capability-bridge-workbench"')
    ).toBeLessThan(markup.indexOf('data-testid="engineering-landing-workbench"'));
    expect(markup).toContain('data-testid="engineering-landing-workbench"');
    expect(markup).toContain("工程落地");
    expect(markup).toContain("工程落地工作台");
    expect(markup).toContain('data-testid="engineering-landing-generate-button"');
    expect(markup).toContain("生成落地计划");
    expect(markup).toContain('data-testid="engineering-landing-plan-list"');
    expect(markup).toContain("Cursor 工程落地计划");
    expect(markup).toContain('data-testid="engineering-platform-handoffs"');
    expect(markup).toContain("Cursor 工作区交接");
    expect(markup).toContain("使用目标和验收清单部分。");
    expect(markup).toContain('data-testid="engineering-landing-steps"');
    expect(markup).toContain("应用权限模式");
    expect(markup).toContain('data-testid="engineering-verification-commands"');
    expect(markup).toContain("权限测试");
    expect(markup).toContain("pnpm vitest permission");
    expect(markup).toContain('data-testid="engineering-run-recorder"');
    expect(markup).toContain("执行记录器");
    expect(markup).toContain('data-testid="engineering-run-record-button"');
    expect(markup).toContain("记录执行");
    expect(markup).toContain('data-testid="engineering-run-list"');
    expect(markup).toContain("Cursor 交接已实现并验证。");
    expect(markup).toContain("client/src/permission.ts");
    expect(markup).toContain('data-testid="artifact-memory-workbench"');
    expect(markup).toContain("资产记忆与回放工作台");
    expect(markup).toContain('data-testid="artifact-ledger-timeline"');
    expect(markup).toContain('data-testid="artifact-ledger-stage-group"');
    expect(markup).toContain("RouteSet 已生成");
    expect(markup).toContain("工程执行记录");
    expect(markup).toContain('data-testid="artifact-replay-summary"');
    expect(markup).toContain("权限项目回放");
    expect(markup).toContain("1 条边");
    expect(markup).toContain('data-testid="artifact-diff-controls"');
    expect(markup).toContain("资产差异");
    expect(markup).toContain('data-testid="artifact-feedback-recorder"');
    expect(markup).toContain("反馈回填记录器");
    expect(markup).toContain('data-testid="artifact-feedback-list"');
    expect(markup).toContain(
      "执行证据已批准，可用于未来 SPEC 演进。"
    );
  });

  it("renders Agent Crew companion role states and latest runtime context", () => {
    const agentCrew = normalizeBlueprintAgentCrew({
      id: "agent-crew-1",
      jobId: "job-1",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:08:00.000Z",
      stage: "runtime_capability",
      roles: [
        {
          id: "role-runtime-executor",
          name: "Runtime Executor",
          group: "execution",
          displayName: "Runtime Executor",
          displayLabelZh: "Runtime Executor",
        },
        {
          id: "role-architecture-planner",
          name: "Architecture Planner",
          group: "planning",
          displayName: "Architecture Planner",
          displayLabelZh: "Architecture Planner",
        },
        {
          id: "role-quality-auditor",
          name: "Quality Auditor",
          group: "audit",
          displayName: "Quality Auditor",
          displayLabelZh: "Quality Auditor",
        },
        {
          id: "role-product-decision",
          name: "Product Decision Lead",
          group: "decision",
          displayName: "Product Decision Lead",
          displayLabelZh: "Product Decision Lead",
        },
      ],
      capabilityMatrix: [
        {
          id: "binding-docker",
          roleId: "role-runtime-executor",
          capabilityId: "capability-docker-analysis",
          capabilityLabel: "Docker analysis sandbox",
          capabilityKind: "docker",
          roleDisplayName: "Runtime Executor",
          applicableStages: ["runtime_capability"],
          inputSchema: "text/plain",
          outputSchema: "application/json",
          tools: ["docker"],
          requiresSandbox: true,
          producesArtifacts: true,
          auditRules: [],
        },
      ],
      activationPolicies: [],
      roleTimelines: [
        {
          id: "timeline-runtime",
          roleId: "role-runtime-executor",
          latestStage: "runtime_capability",
          latestPresenceState: "active",
          latestAction: "Runtime executor is invoking Docker analysis sandbox.",
          latestCapabilityId: "capability-docker-analysis",
          latestArtifactId: "artifact-capability-invocation",
          latestEvidenceId: "capability-evidence-1",
          entries: [
            {
              id: "timeline-runtime-entry",
              eventId: "event-role-runtime",
              jobId: "job-1",
              stage: "runtime_capability",
              roleId: "role-runtime-executor",
              presenceState: "active",
              type: "role.capability_invoked",
              occurredAt: "2026-05-06T00:07:00.000Z",
              summary: "Runtime executor invoked Docker analysis sandbox.",
              currentAction:
                "Runtime executor is invoking Docker analysis sandbox.",
              capabilityId: "capability-docker-analysis",
              invocationId: "capability-invocation-1",
              evidenceId: "capability-evidence-1",
              artifactId: "artifact-capability-invocation",
              sourceIds: {},
            },
          ],
        },
        {
          id: "timeline-architecture",
          roleId: "role-architecture-planner",
          latestStage: "runtime_capability",
          latestPresenceState: "watching",
          latestAction:
            "Architecture planner is watching runtime handoff signals.",
          entries: [
            {
              id: "timeline-architecture-entry",
              eventId: "event-role-architecture",
              jobId: "job-1",
              stage: "runtime_capability",
              roleId: "role-architecture-planner",
              presenceState: "watching",
              type: "role.watching",
              occurredAt: "2026-05-06T00:07:00.000Z",
              summary:
                "Architecture planner is watching runtime handoff signals.",
              currentAction:
                "Architecture planner is watching runtime handoff signals.",
              sourceIds: {},
            },
          ],
        },
        {
          id: "timeline-quality",
          roleId: "role-quality-auditor",
          latestStage: "runtime_capability",
          latestPresenceState: "reviewing",
          latestAction: "Quality auditor is reviewing capability evidence.",
          latestEvidenceId: "capability-evidence-1",
          entries: [
            {
              id: "timeline-quality-entry",
              eventId: "event-role-quality",
              jobId: "job-1",
              stage: "runtime_capability",
              roleId: "role-quality-auditor",
              presenceState: "reviewing",
              type: "role.review_completed",
              occurredAt: "2026-05-06T00:07:00.000Z",
              summary: "Quality auditor is reviewing capability evidence.",
              currentAction:
                "Quality auditor is reviewing capability evidence.",
              evidenceId: "capability-evidence-1",
              sourceIds: {},
            },
          ],
        },
        {
          id: "timeline-product",
          roleId: "role-product-decision",
          latestStage: "runtime_capability",
          latestPresenceState: "sleeping",
          latestAction: "Product decision lead is on standby.",
          entries: [
            {
              id: "timeline-product-entry",
              eventId: "event-role-product",
              jobId: "job-1",
              stage: "runtime_capability",
              roleId: "role-product-decision",
              presenceState: "sleeping",
              type: "role.completed",
              occurredAt: "2026-05-06T00:07:00.000Z",
              summary: "Product decision lead is on standby.",
              currentAction: "Product decision lead is on standby.",
              sourceIds: {},
            },
          ],
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        showRouteGeneration={false}
        showSpecProgress={false}
        showSpecTreePreview={false}
        showSpecDocumentWorkbench={false}
        showEffectPreviewWorkbench={false}
        showPromptPackageWorkbench={false}
        showEngineeringLandingWorkbench={false}
        showArtifactMemoryWorkbench={false}
        initialSpecTree={{
          id: "spec-tree-1",
          routeSetId: "routeset-1",
          selectionId: "selection-1",
          selectedRouteId: "route-primary",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          alternativeRouteIds: [],
          provenance: {
            jobId: "job-1",
            githubUrls: [],
          },
          nodes: [
            {
              id: "node-root",
              title: "Runtime node",
              summary: "Runtime capability node.",
              type: "root",
              status: "draft",
              priority: 0,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
        }}
        initialJob={{
          id: "job-1",
          request: {
            targetText: "Build runtime role surface.",
            githubUrls: [],
          },
          status: "reviewing",
          stage: "runtime_capability",
          version: "blueprint-generation/v1",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:08:00.000Z",
          artifacts: [],
          events: [],
        }}
        initialCapabilities={[
          {
            id: "capability-docker-analysis",
            label: "Docker analysis sandbox",
            kind: "docker",
            purpose: "Analyze source safely in an isolated runtime.",
            description: "Runs repository inspection commands.",
            tags: ["analysis", "sandbox"],
            securityLevel: "sandboxed",
            status: "available",
            adapter: "docker-blueprint-adapter",
            inputSchema: "{\"type\":\"object\"}",
            outputTypes: ["analysis", "log"],
            supportedStages: ["runtime_capability"],
            requiresApproval: false,
            projectScoped: true,
          },
        ]}
        initialAgentCrew={agentCrew}
        initialCapabilityInvocations={[
          {
            id: "capability-invocation-1",
            jobId: "job-1",
            capabilityId: "capability-docker-analysis",
            roleId: "role-runtime-executor",
            capabilityLabel: "Docker analysis sandbox",
            kind: "docker",
            status: "completed",
            securityLevel: "sandboxed",
            safetyGate: {
              status: "allowed",
              reason: "Sandboxed analysis is permitted.",
              requiresApproval: false,
              approved: true,
              securityLevel: "sandboxed",
            },
            requestedAt: "2026-05-06T00:06:00.000Z",
            completedAt: "2026-05-06T00:07:00.000Z",
            outputSummary:
              "Docker sandbox found auditable permission boundaries.",
            logs: ["Analyzed policy service files."],
            evidenceIds: ["capability-evidence-1"],
            durationMs: 1200,
            provenance: {
              jobId: "job-1",
              githubUrls: [],
            },
          },
        ]}
        initialCapabilityEvidence={[
          {
            id: "capability-evidence-1",
            jobId: "job-1",
            invocationId: "capability-invocation-1",
            capabilityId: "capability-docker-analysis",
            capabilityLabel: "Docker analysis sandbox",
            kind: "analysis",
            status: "recorded",
            title: "Permission boundary analysis",
            summary: "Runtime evidence confirms auditable boundaries.",
            createdAt: "2026-05-06T00:07:00.000Z",
            artifacts: [],
            logs: [],
            tags: [],
            payloadSummary: {},
            provenance: {
              jobId: "job-1",
              githubUrls: [],
            },
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="blueprint-agent-crew-surface"');
    expect(markup.match(/data-testid="blueprint-agent-role-row"/g)?.length).toBe(4);
    expect(markup).toContain("Active");
    expect(markup).toContain("Watching");
    expect(markup).toContain("Reviewing");
    expect(markup).toContain("Sleeping");
    expect(markup).toContain("Runtime executor is invoking Docker analysis sandbox.");
    expect(markup).toContain(
      "Architecture planner is watching runtime handoff signals."
    );
    expect(markup).toContain("Quality auditor is reviewing capability evidence.");
    expect(markup).toContain("Product decision lead is on standby.");
    expect(markup).toContain("权限边界分析");
    expect(markup).toContain('data-testid="agent-crew-event-stream-consumers"');
    expect(markup.match(/data-testid="agent-crew-event-stream-consumer"/g)?.length).toBe(5);
    expect(markup.match(/data-testid="agent-crew-role-event-source"/g)?.length).toBe(4);
    expect(markup).toContain("3D Scene");
    expect(markup).toContain("HUD");
    expect(markup).toContain("Logs");
    expect(markup).toContain("Browser");
    expect(markup).toContain("SPEC UI");
    expect(markup).toContain("event-role-runtime / role.capability_invoked");
    expect(markup).toContain("role.review_completed");
    expect(markup).toContain("event-role-quality / Reviewing");
  });

  it("renders runtime projection cards from initial effect previews", () => {
    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        showRouteGeneration={false}
        showSpecProgress={false}
        showSpecTreePreview={false}
        showSpecDocumentWorkbench={false}
        showPromptPackageWorkbench={false}
        showRuntimeCapabilityBridgeWorkbench={false}
        showEngineeringLandingWorkbench={false}
        showArtifactMemoryWorkbench={false}
        initialSpecTree={{
          id: "spec-tree-1",
          routeSetId: "routeset-1",
          selectionId: "selection-1",
          selectedRouteId: "route-primary",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          alternativeRouteIds: [],
          provenance: {
            jobId: "job-1",
            githubUrls: [],
          },
          nodes: [
            {
              id: "node-root",
              title: "Runtime projection root",
              summary: "Root for runtime projection preview.",
              type: "root",
              status: "draft",
              priority: 0,
              dependencies: [],
              outputs: [],
              children: ["node-preview"],
            },
            {
              id: "node-preview",
              parentId: "node-root",
              title: "Runtime projection preview",
              summary: "Preview node with runtime projection data.",
              type: "effect_preview",
              status: "ready",
              priority: 1,
              dependencies: [],
              outputs: [],
              children: [],
            },
          ],
        }}
        initialEffectPreviews={[
          {
            id: "preview-runtime-1",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-preview",
            sourceDocumentIds: [],
            status: "completed",
            summary: "Preview with runtime projection payload.",
            architectureNotes: [],
            prototypeNotes: [],
            progressPlan: [],
            nodes: [],
            createdAt: "2026-05-06T00:00:00.000Z",
            runtimeProjection: {
              id: "projection-runtime-1",
              jobId: "job-1",
              routeSetId: "routeset-1",
              routeId: "route-primary",
              specTreeId: "spec-tree-1",
              nodeId: "node-preview",
              effectPreviewId: "preview-runtime-1",
              sceneSnapshotId: "scene-snapshot-3d",
              hudState: {
                id: "hud-runtime-1",
                status: "completed",
                stage: "effect_preview",
                title: "Runtime HUD online",
                summary: "HUD shows the live runtime capability state.",
                progressPercent: 73,
                activeNodeId: "node-preview",
                badges: ["HUD linked"],
              },
              logTimeline: [
                {
                  id: "log-runtime-1",
                  level: "success",
                  message: "Runtime log timeline connected.",
                  occurredAt: "2026-05-06T00:02:00.000Z",
                  sourceDocumentIds: [],
                },
              ],
              browserPreviewId: "browser-preview-runtime",
              browserPreview: {
                id: "browser-preview-runtime",
                title: "Browser runtime preview",
                summary: "Browser preview follows runtime capability state.",
                routeId: "route-primary",
                nodeId: "node-preview",
                url: "/blueprint/previews/browser-preview-runtime",
              },
              sourceIds: {},
            },
            provenance: {
              jobId: "job-1",
              githubUrls: [],
              treeVersion: 1,
              nodeType: "effect_preview",
              nodeTitle: "Runtime projection preview",
              nodeSummary: "Preview node with runtime projection data.",
              sourceStatus: "accepted",
              includeDrafts: false,
              sourceDocumentStatuses: {},
            },
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="effect-preview-runtime-projection"');
    expect(markup.match(/data-testid="runtime-projection-card"/g)?.length).toBe(4);
    expect(markup).toContain("3D Scene");
    expect(markup).toContain("scene-snapshot-3d");
    expect(markup).toContain("HUD");
    expect(markup).toContain("HUD shows the live runtime capability state.");
    expect(markup).toContain("Logs");
    expect(markup).toContain("Runtime log timeline connected.");
    expect(markup).toContain("Browser");
    expect(markup).toContain("browser-preview-runtime");
  });

  it("renders effect preview version sync metadata from initial previews", () => {
    const markup = renderToStaticMarkup(
      <BlueprintProgressPanel
        autoLoad={false}
        showRouteGeneration={false}
        showSpecProgress={false}
        showSpecTreePreview={false}
        showSpecDocumentWorkbench={false}
        showPromptPackageWorkbench={false}
        showRuntimeCapabilityBridgeWorkbench={false}
        showEngineeringLandingWorkbench={false}
        showArtifactMemoryWorkbench={false}
        initialSpecTree={{
          id: "spec-tree-1",
          routeSetId: "routeset-1",
          selectionId: "selection-1",
          selectedRouteId: "route-primary",
          rootNodeId: "node-root",
          version: 9,
          status: "draft",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          alternativeRouteIds: [],
          provenance: {
            jobId: "job-1",
            githubUrls: [],
          },
          nodes: [
            {
              id: "node-root",
              title: "Effect preview root",
              summary: "Root for effect preview version sync.",
              type: "root",
              status: "draft",
              priority: 0,
              dependencies: [],
              outputs: [],
              children: ["node-preview"],
            },
            {
              id: "node-preview",
              parentId: "node-root",
              title: "Effect preview node",
              summary: "Preview node with version sync fields.",
              type: "effect_preview",
              status: "ready",
              priority: 1,
              dependencies: ["node-root"],
              outputs: [],
              children: [],
            },
          ],
        }}
        initialEffectPreviews={[
          {
            id: "preview-version-7",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-preview",
            sourceDocumentIds: [],
            status: "completed",
            version: 7,
            versionStatus: "current",
            refreshedFromSpecTreeVersion: 9,
            refreshedAt: "2026-05-06T00:03:00.000Z",
            nodeProgress: {
              status: "completed",
              completion: 100,
            },
            dependencyOrder: ["requirements", "design", "tasks"],
            previousPreviewIds: ["preview-version-5", "preview-version-6"],
            preservedPreviewIds: ["preview-version-5", "preview-version-6"],
            sourceSnapshotHash: "snapshot-hash-version-7",
            summary: "Preview with SPEC version sync metadata.",
            architectureNotes: [],
            prototypeNotes: [],
            progressPlan: [],
            nodes: [],
            runtimeProjection: {
              id: "projection-version-7",
              jobId: "job-1",
              routeSetId: "routeset-1",
              specTreeId: "spec-tree-1",
              nodeId: "node-preview",
              effectPreviewId: "preview-version-7",
              sceneSnapshotId: "",
              hudState: {
                id: "hud-version-7",
                status: "completed",
                stage: "effect_preview",
                title: "Version sync HUD",
                summary: "Version sync projection.",
                progressPercent: 100,
                activeNodeId: "node-preview",
                badges: [],
              },
              logTimeline: [],
              browserPreviewId: "",
              browserPreview: {
                id: "browser-version-7",
                title: "Version sync browser",
                summary: "Browser preview waits for link.",
                nodeId: "node-preview",
                url: "",
              },
              sourceIds: {},
            },
            createdAt: "2026-05-06T00:00:00.000Z",
            provenance: {
              jobId: "job-1",
              githubUrls: [],
              treeVersion: 9,
              nodeType: "effect_preview",
              nodeTitle: "Effect preview node",
              nodeSummary: "Preview node with version sync fields.",
              sourceStatus: "accepted",
              includeDrafts: false,
              sourceDocumentStatuses: {},
            },
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="effect-preview-version-sync"');
    expect(markup).toContain('data-testid="effect-preview-dependency-order"');
    expect(markup).toContain("Version 7");
    expect(markup).toContain("Current");
    expect(markup).toContain("SpecTree 9");
    expect(markup).toContain("已完成 / 100%");
    expect(markup).toContain("requirements -&gt; design -&gt; tasks");
    expect(markup).toContain("2 previous / 2 preserved");
    expect(markup).toContain("snapshot-hash-version-7");
  });
});
