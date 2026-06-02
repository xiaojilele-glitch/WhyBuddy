import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueprintRouter } from "../blueprint";

describe("blueprint diagnostics brainstorm entry", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("includes brainstorm diagnostics without replacing the runtime diagnostics snapshot", () => {
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    process.env.BRAINSTORM_STAGE_ROUTE_GENERATION_ENABLED = "true";

    const router = createBlueprintRouter({
      blueprintServiceContext: {
        now: () => new Date("2026-06-02T00:00:00.000Z"),
        runtimeDiagnostics: {
          snapshot: vi.fn(() => ({ bridges: { docker: { mode: "disabled" } } })),
        },
        brainstormContext: null,
      } as any,
    });
    const diagnosticsLayer = (router as any).stack.find(
      (layer: any) => layer.route?.path === "/diagnostics",
    );
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status: vi.fn(function (this: typeof res, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: typeof res, body: unknown) {
        this.body = body;
        return this;
      }),
    };

    diagnosticsLayer.route.stack[0].handle({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      bridges: { docker: { mode: "disabled" } },
      brainstorm: {
        enabled: false,
        activeSessionsCount: 0,
        totalSessionsCompleted: 0,
        degradationCount: 0,
        averageSessionDurationMs: 0,
        tokenBudget: 0,
        toolCallLimit: 0,
        perStageConfig: {
          route_generation: true,
          spec_tree: false,
          spec_docs: false,
          effect_preview: false,
          prompt_packaging: false,
          engineering_handoff: false,
        },
      },
    });
  });
});
