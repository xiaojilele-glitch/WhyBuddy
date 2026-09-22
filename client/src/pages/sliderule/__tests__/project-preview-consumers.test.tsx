// @vitest-environment jsdom
/** Real Studio and the application's actual modal body consume the same HTTP
 * surface. Residual HTML/model data must not choose an alternate renderer or
 * trigger its connector, seed or landing-shot effects for a project artifact.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideRuleStudio } from "../SlideRuleStudio";
import {
  AppArtifactPreview,
  deriveAppCardDetail,
} from "@/pages/agent-loop/dashboard/AppsWorkbench";
import { selectProjectMode } from "./fixtures/select-project-mode";

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
const emptyVerification = {
  operationId: null,
  operationStatus: null,
  snapshot: null,
};
function expectObservationOnly() {
  const urls = new Set(
    fetcher.mock.calls
      .map(([url]) => String(url))
      .filter(url => !url.includes("/generated-app"))
  );
  expect(urls).toEqual(
    new Set(["/api/sliderule/projects/project-one/preview"])
  );
  expect(
    fetcher.mock.calls
      .filter(([url]) => !String(url).includes("/generated-app"))
      .every(([, init]) => init?.method === "GET")
  ).toBe(true);
  expect(
    container.querySelector('[data-testid="project-verification-panel"]'),
    "预览画布不挂验收条，观察态也不许先去拉 /verification"
  ).toBeNull();
}
const stored = {
  runtimeKind: "project",
  projectId: "project-one",
  projectRevision: "revision-one",
  specFirstPages: {
    pages: { home: "<html><body>HISTORICAL HTML</body></html>" },
  },
  publishClosure: {
    evidencePresentCount: 6,
    blocked: false,
    perSkillEvidence: {
      datamodel: { modelSection: { entities: [{ id: "tasks" }] } },
    },
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith("/verification")
        ? emptyVerification
        : {
            operationId: "operation-one",
            available: true,
            reason: null,
            descriptor: {
              kind: "project",
              projectId: "project-one",
              runtimeId: "runtime-one",
              revision: "revision-one",
              status: "failed",
              entryUrl: null,
            },
          }
    )
  );
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("both project artifact consumers", () => {
  it.each(["studio", "session-app"])(
    "%s follows the server's current source despite a stale session projection",
    async consumer => {
      let verificationView: object = emptyVerification;
      fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/verification"))
          return Response.json(verificationView);
        if (url.endsWith("/verify")) {
          verificationView = {
            operationId: "verification-op",
            operationStatus: "queued",
            snapshot: null,
          };
          return Response.json({
            operationId: "verification-op",
            status: "queued",
          });
        }
        return Response.json(
          init?.method === "POST"
            ? {
                projectId: "project-one",
                operationId: "operation-one",
                runtimeId: "runtime-one",
                revision: "revision-two",
                entryUrl: "https://preview.example/entry?ticket=current-source",
                ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
              }
            : {
                operationId: "operation-one",
                available: true,
                reason: null,
                descriptor: {
                  kind: "project",
                  projectId: "project-one",
                  runtimeId: "runtime-one",
                  revision: "revision-two",
                  status: "ready",
                },
              }
        );
      });
      await act(async () =>
        root.render(
          consumer === "studio" ? (
            <SlideRuleStudio
              chatSlot={<p>conversation</p>}
              activeSkillId={null}
              runtimeKind="project"
              projectId={stored.projectId}
              projectRevision={stored.projectRevision}
            />
          ) : (
            <AppArtifactPreview
              detail={deriveAppCardDetail(stored)}
              previewKey="session:one"
              appTitle="Task board"
            />
          )
        )
      );
      const button = container.querySelector<HTMLButtonElement>(
        '[data-testid="project-preview-open"]'
      ) ?? container.querySelector<HTMLButtonElement>(
        '[data-testid="project-preview-wake"]'
      )!;
      expect(button.disabled).toBe(false);
      expect(container.textContent).toContain("预览已暂停");
      expect(container.querySelector("iframe")).toBeNull();
      await act(async () => button.click());
      expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
        "current-source"
      );
      expect(
        fetcher.mock.calls.filter(
          ([url, init]) =>
            init?.method === "POST" && String(url).includes("/preview-ticket")
        ),
        "换票只有一发；/touch 是还在，不算第二张票"
      ).toHaveLength(1);
      await act(async () => selectProjectMode(container, "交付"));
      const checkButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="project-verification-start"]'
      )!;
      expect(checkButton.disabled).toBe(false);
      await act(async () => checkButton.click());
      const verificationCalls = fetcher.mock.calls.filter(([url]) =>
        url.endsWith("/verify")
      );
      expect(verificationCalls).toHaveLength(1);
      expect(verificationCalls[0][0]).toBe(
        "/api/sliderule/project-operations/operation-one/verify"
      );
      expect(JSON.parse(verificationCalls[0][1].body).expectedRevision).toBe(
        "revision-two"
      );
      expect(
        container.querySelector('[data-testid="project-verification-status"]')
          ?.textContent
      ).toBe("已排队");
    }
  );

  it("an app reference without an explicit current-session policy stays pinned to its saved version", async () => {
    fetcher.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith("/verification")
          ? emptyVerification
          : {
              operationId: "operation-one",
              available: true,
              reason: null,
              descriptor: {
                kind: "project",
                projectId: "project-one",
                runtimeId: "runtime-one",
                revision: "revision-two",
                status: "ready",
              },
            }
      )
    );
    const detail = {
      ...deriveAppCardDetail(stored),
      projectRevisionMode: undefined,
    };
    await act(async () =>
      root.render(
        <AppArtifactPreview
          detail={detail}
          previewKey="app:historical"
          appTitle="Saved version"
        />
      )
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="project-preview-open"]'
      )!.disabled
    ).toBe(true);
    expect(container.textContent).toContain("运行版本与当前工程不同");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each([false, true])(
    "Studio preserves the project stage with old HTML and running=%s",
    async running => {
      await act(async () =>
        root.render(
          <SlideRuleStudio
            chatSlot={<p>conversation</p>}
            activeSkillId={null}
            runtimeKind="project"
            projectId={stored.projectId}
            projectRevision={stored.projectRevision}
            sessionId="session-one"
            isRunning={running}
            liveActionLabel={running ? "正在启动工程" : null}
            specFirstPages={stored.specFirstPages}
          />
        )
      );
      expect(container.textContent).toContain("应用运行失败");
      expect(
        container.querySelector('[data-testid="sandbox-preview-surface"]')
      ).not.toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      if (running) {
        expect(container.querySelector('[data-testid="project-live-action"]')?.textContent)
          .toContain("正在启动工程");
      } else {
        expect(container.querySelector('[data-testid="project-live-action"]')).toBeNull();
      }
      expect(container.textContent).not.toContain("HISTORICAL HTML");
      expectObservationOnly();
      expect(localStorage.length).toBe(0);
    }
  );

  it("App center keeps project references, suppresses old closure success, and consumes the shared preview", async () => {
    const detail = deriveAppCardDetail(stored);
    expect(detail.projectId).toBe(stored.projectId);
    expect(detail.projectRevision).toBe(stored.projectRevision);
    expect(detail.status).not.toBe("runnable");
    expect(detail.evidenceCount).toBe(0);
    expect(detail.model).toBeNull();
    expect(detail.specPages).toBeNull();
    await act(async () =>
      root.render(
        <AppArtifactPreview
          detail={detail}
          previewKey="session-one"
          appTitle="任务管理"
        />
      )
    );
    expect(container.textContent).toContain("应用运行失败");
    expect(container.textContent).toContain(
      "历史版本、源码和复刻操作可在下方工作区面板中使用"
    );
    expect(container.textContent).not.toContain("HISTORICAL HTML");
    expect(container.querySelector("iframe")).toBeNull();
    expectObservationOnly();
  });

  it("project modal type wins even if another caller supplies both project and HTML data", async () => {
    const detail = {
      ...deriveAppCardDetail(stored),
      specPages: { ...stored.specFirstPages, navItems: [], boundPages: 0 },
    };
    await act(async () =>
      root.render(
        <AppArtifactPreview
          detail={detail}
          previewKey="session-one"
          appTitle="任务管理"
        />
      )
    );
    expect(
      container.querySelector('[data-testid="sandbox-preview-surface"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("HISTORICAL HTML");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
