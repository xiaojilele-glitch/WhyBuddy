// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectDeliveryPanel } from "../project-runtime/ProjectDeliveryPanel";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { selectProjectMode } from "./fixtures/select-project-mode";

let root: Root, container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>, view: any;
const release = {
  releaseId: "release-one",
  projectId: "p1",
  revision: "r1",
  treeHash: "a".repeat(64),
  verificationId: "v1",
  profileId: "whybuddy-tasks-acceptance@1",
  planRef: "plan1",
  lockfileHash: "b".repeat(64),
  buildHash: "c".repeat(64),
  createdAt: "2026-09-13",
  downloadPath: "/api/sliderule/projects/p1/releases/release-one/download",
  deployed: false,
  effectiveStatus: "ready",
};
const response = (data: unknown, status = 200) =>
  Response.json(data, { status });
const posts = () =>
  fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent === name
  )!;
async function render(projectId = "p1") {
  await act(async () =>
    root.render(<ProjectDeliveryPanel projectId={projectId} />)
  );
}
async function click(name: string) {
  await act(async () => button(name).click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  view = {
    projectId: "p1",
    revision: "r1",
    eligible: true,
    verificationId: "v1",
    profile: {
      profileId: "whybuddy-tasks-acceptance@1",
      suiteVersion: "react-vite-tasks@1",
      requirements: ["Create, edit and filter tasks through a real API"],
      outsideScope: ["Additional user requirements", "Production deployment"],
      dataRecovery:
        "Last durable checkpoint; normal stop checkpoints after stopping the application",
    },
    blockedReasons: [],
    releases: [],
    deployment: { status: "not_configured", publicUrl: null },
  };
  fetcher = vi.fn(async (_path, init) => {
    if (init?.method === "POST") {
      view.releases = [release];
      return response({ release });
    }
    return response(view);
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:release"),
      revokeObjectURL: vi.fn(),
    })
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reads explicit acceptance scope without dispatching or claiming production deployment", async () => {
  await render();
  expect(button("准备交付包").disabled).toBe(false);
  expect(posts()).toHaveLength(0);
  expect(container.textContent).toContain("通过真实接口新增、编辑和筛选任务");
  expect(container.textContent).toContain("本验收范围之外的追加需求");
  expect(container.textContent).toContain("生产部署尚未配置");
});
it("settles a delivery read failure and retries without retaining earlier eligibility", async () => {
  await render();
  expect(button("准备交付包").disabled).toBe(false);
  let rejectRead!: (reason: Error) => void;
  let resolveRetry!: (value: Response) => void;
  const failedRead = new Promise<Response>((_, reject) => {
    rejectRead = reject;
  });
  const retryRead = new Promise<Response>(resolve => {
    resolveRetry = resolve;
  });
  let reads = 0;
  fetcher.mockImplementation(async () =>
    ++reads === 1 ? failedRead : retryRead
  );
  await click("更新交付状态");
  expect(container.textContent).toContain("正在读取交付状态。");
  expect(container.textContent).not.toContain("可以准备交付包");
  expect(button("准备交付包").disabled).toBe(true);
  await act(async () => rejectRead(new TypeError("offline")));
  expect(
    container
      .querySelector('[data-testid="project-delivery-panel"]')
      ?.getAttribute("aria-busy")
  ).toBe("false");
  expect(container.textContent).not.toContain("正在读取交付状态。");
  expect(container.textContent).toContain("交付状态暂不可用");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("准备交付包").disabled).toBe(true);
  await click("准备交付包");
  expect(posts()).toHaveLength(0);
  await click("更新交付状态");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("正在读取交付状态。");
  expect(button("准备交付包").disabled).toBe(true);
  view.eligible = false;
  view.verificationId = null;
  view.blockedReasons = ["project_verification_required"];
  await act(async () => resolveRetry(response(view)));
  expect(container.textContent).not.toContain("正在读取交付状态。");
  expect(container.textContent).toContain("尚无独立浏览器检查记录");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("准备交付包").disabled).toBe(true);
  expect(posts()).toHaveLength(0);
});

it("does not apply an old delivery failure after switching projects", async () => {
  const original = fetcher.getMockImplementation()!;
  let rejectRead!: (reason: Error) => void;
  let oldSignal: AbortSignal | undefined;
  const oldRead = new Promise<Response>((_, reject) => {
    rejectRead = reject;
  });
  fetcher.mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("/projects/p1/delivery")) {
      oldSignal = args[1]?.signal;
      return oldRead;
    }
    return original(...args);
  });
  await render();
  expect(container.textContent).toContain("正在读取交付状态。");
  view.projectId = "p2";
  await render("p2");
  expect(oldSignal?.aborted).toBe(true);
  expect(button("准备交付包").disabled).toBe(false);
  await act(async () => rejectRead(new TypeError("late failure")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("正在读取交付状态。");
  expect(button("准备交付包").disabled).toBe(false);
  expect(posts()).toHaveLength(0);
});

it("prepares one source-and-evidence-bound release and shows its saved receipt", async () => {
  await render();
  await click("准备交付包");
  expect(JSON.parse(posts()[0][1].body)).toMatchObject({
    expectedRevision: "r1",
    verificationId: "v1",
  });
  expect(container.textContent).toContain("交付包已准备好");
  expect(container.textContent).toContain("尚未部署");
  expect(button("下载交付包")).toBeTruthy();
});
it("keeps the same idempotency key after unknown preparation result", async () => {
  const original = fetcher.getMockImplementation()!;
  let first = true;
  fetcher.mockImplementation(async (...args) => {
    if (args[1]?.method === "POST" && first) {
      first = false;
      throw new TypeError("network");
    }
    return original(...args);
  });
  await render();
  await click("准备交付包");
  await click("准备交付包");
  expect(JSON.parse(posts()[0][1].body).idempotencyKey).toBe(
    JSON.parse(posts()[1][1].body).idempotencyKey
  );
});
it("blocks preparation when the server has a verification gap", async () => {
  view.eligible = false;
  view.blockedReasons = ["project_current_business_verification_required"];
  await render();
  expect(button("准备交付包").disabled).toBe(true);
  expect(container.textContent).toContain("当前源码版本尚未通过任务业务检查");
  expect(posts()).toHaveLength(0);
});
it.each([
  "foreign-project",
  "external-download",
  "deployed-lie",
  "contradictory-eligibility",
])("rejects %s DTO instead of displaying a trusted release", async defect => {
  view.releases = [{ ...release }];
  if (defect === "foreign-project") view.releases[0].projectId = "other";
  if (defect === "external-download")
    view.releases[0].downloadPath = "https://evil.example/archive";
  if (defect === "deployed-lie") view.releases[0].deployed = true;
  if (defect === "contradictory-eligibility")
    view.blockedReasons = ["project_verification_required"];
  await render();
  expect(button("准备交付包").disabled).toBe(true);
  expect(button("下载交付包")).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("正在读取交付状态。");
  expect(container.textContent).toContain("交付状态暂不可用");
});
it("downloads historical ZIP with owner credentials and labels its scope as stale", async () => {
  view.releases = [{ ...release, effectiveStatus: "stale" }];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (...args) =>
    String(args[0]).endsWith("/download")
      ? new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { "Content-Type": "application/zip" },
        })
      : original(...args)
  );
  await render();
  expect(container.textContent).toContain("历史交付包");
  await click("下载交付包");
  expect(URL.createObjectURL).toHaveBeenCalled();
  const request = fetcher.mock.calls.find(([url]) =>
    String(url).endsWith("/download")
  )!;
  expect(request[0]).toBe(
    "/api/sliderule/projects/p1/releases/release-one/download"
  );
  expect(request[1]).toMatchObject({
    credentials: "include",
    cache: "no-store",
  });
});
it("is wired into the shared Studio and app-center preview surface", async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (...args) =>
    String(args[0]).endsWith("/preview")
      ? response({
          operationId: null,
          descriptor: null,
          available: false,
          reason: null,
        })
      : String(args[0]).endsWith("/verification")
        ? response({ operationId: null, operationStatus: null, snapshot: null })
        : original(...args)
  );
  await act(async () =>
    root.render(<SandboxPreviewSurface projectId="p1" revisionMode="current" />)
  );
  await act(async () => selectProjectMode(container, "交付"));
  expect(
    container.querySelector('[data-testid="project-delivery-panel"]')
  ).not.toBeNull();
  expect(container.textContent).toContain("本次验收范围");
});
