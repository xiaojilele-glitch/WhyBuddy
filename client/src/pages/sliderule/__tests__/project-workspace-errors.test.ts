/** HTTP error envelopes must explain authorization scope without exposing provider prose. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProjectWorkspace } from "../project-runtime/project-workspace-client";

afterEach(() => vi.unstubAllGlobals());

async function rejected(body: unknown, status: number) {
  const fetcher = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetcher);
  const result = await requestProjectWorkspace(
    "/projects/owned-project/source/patch",
    new AbortController().signal,
    { expectedRevision: "revision-1", changes: [] }
  ).catch(error => error);
  expect(fetcher).toHaveBeenCalledTimes(1);
  return result;
}

describe("workspace failure explanations", () => {
  it.each([
    { detail: "project_plan_approval_required" },
    { detail: { code: "project_plan_approval_required" } },
    // Exact envelope captured at localhost:3000 after a real owner clicked save.
    {
      message: "project_plan_approval_required",
      status: "error",
      backend: "slide-rule-python",
      source: "python",
      provenance: "backend:slide-rule-python",
      degraded: true,
    },
  ])("explains the missing plan approval in %j", async body => {
    const error = await rejected(body, 403);
    expect(error.message).toContain("请先批准当前计划");
    expect(error.message).toContain("草稿已保留");
    expect(error.message).not.toContain("账号无权");
    expect(error.code).toBe("project_plan_approval_required");
    expect(error.conflict).toBe(false);
  });

  it("retains the runtime-restart reason through the live message envelope", async () => {
    const error = await rejected(
      { message: "project_live_patch_requires_restart" },
      409
    );
    expect(error.message).toContain("请先停止应用");
    expect(error.code).toBe("project_live_patch_requires_restart");
    expect(error.conflict).toBe(true);
  });

  it("explains disabled writes without claiming the project is absent", async () => {
    const error = await rejected({ reason: "project_rollout_disabled" }, 503);
    expect(error.message).toContain("工程模式当前已关闭");
    expect(error.code).toBe("project_rollout_disabled");
  });

  it.each([401, 404])(
    "keeps the HTTP %s access boundary even with a known payload code",
    async status => {
      const error = await rejected(
        { message: "project_plan_approval_required" },
        status
      );
      expect(error.code).toBeUndefined();
      expect(error.message).not.toContain("批准");
      expect(error.message).toContain(status === 401 ? "请登录" : "工程不存在");
    }
  );

  it.each(["provider-private-detail", "toString", "__proto__"])(
    "does not expose unrecognized message %s",
    async message => {
      const error = await rejected({ message, detail: message }, 403);
      expect(error.code).toBeUndefined();
      expect(error.message).toBe("工程不存在或当前账号无权操作。");
    }
  );
});
