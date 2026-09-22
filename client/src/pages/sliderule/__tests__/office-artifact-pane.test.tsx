// @vitest-environment jsdom
/**
 * 办公产物面只留文件和下载。预览页是控制面点名的源码，不在这里画。
 *
 * ⚠ 2026-09-20 真机右边是「创建管理员」。那是应用预览框，不是这份办公页。
 * ⚠ 2026-09-22 产物面又把 pptx 画进浏览器框。再出现文件预览框，本条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OfficeArtifactPane } from "../project-runtime/OfficeArtifactPane";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("OfficeArtifactPane", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  it("文件可以下载，产物面不打开预览，也不出现登录页", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/artifacts") && !url.includes("/art-1")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  artifactId: "art-1",
                  path: "面团启动.pptx",
                  sha256: "a".repeat(64),
                  sizeBytes: 12,
                  downloadable: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            kind: "slides",
            slides: [{ text: "面团启动会" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<OfficeArtifactPane projectId="proj-office" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="office-file-frame"]')).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("面团启动.pptx");
    expect(container.textContent).not.toContain("面团启动会");
    expect(container.querySelector('[data-testid="office-slide-stage"]')).toBeNull();
    expect(container.textContent).toContain("下载");
    expect(container.textContent).not.toContain("创建管理员");
    expect(container.textContent).not.toContain("登录");
    expect(container.querySelector('[data-testid="project-preview-frame"]')).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });

  it("表格文件也不在产物面上打开预览", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/artifacts") && !url.includes("/art-1")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  artifactId: "art-1",
                  path: "面团启动.pptx",
                  sha256: "b".repeat(64),
                  sizeBytes: 20,
                  downloadable: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            kind: "workbook",
            sheetCount: 1,
            sheets: [{ name: "清单", rows: [["预算"]] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<OfficeArtifactPane projectId="proj-office" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="office-file-frame"]')).toBeNull();
    expect(container!.querySelector("iframe")).toBeNull();
    expect(container!.textContent).not.toContain("预算");
    expect(container!.textContent).not.toContain("请下载后在 Excel");
    expect(container!.querySelector('[data-testid="office-slide-stage"]')).toBeNull();
    expect(container!.querySelectorAll('[data-testid^="office-slide-thumb-"]')).toHaveLength(0);
    expect(container!.querySelectorAll("section")).toHaveLength(0);
  });
});
