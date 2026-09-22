// @vitest-environment jsdom
/**
 * 工程源码档必须是 CodeMirror，不是 textarea。
 *
 * 2026-09-15 对照 Manus TicketStream：右侧是带行号、高亮的编辑器。
 * 草稿/保存那组用例把编辑器 mock 成 textarea（jsdom 里打字方便），
 * 所以通电必须另测：面板源码懒加载真正的编辑器，挂出来有行号槽。
 */
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectSourceEditor from "../project-runtime/ProjectSourceEditor";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relative: string) =>
  stripComments(
    readFileSync(resolve(__dirname, "../project-runtime", relative), "utf8")
  );

describe("通电：工程源码面接到 CodeMirror", () => {
  it("面板懒加载 ProjectSourceEditor，正文不再是 textarea", () => {
    const panel = read("ProjectWorkspacePanel.tsx");
    expect(panel).toMatch(
      /React\.lazy\(\s*\(\)\s*=>\s*import\("\.\/ProjectSourceEditor"\)/
    );
    expect(panel).toMatch(/LazySourceEditor/);
    expect(panel).toMatch(/project-source-crumbs/);
    expect(panel).toMatch(/project-source-tab/);
    expect(panel, "改回去用 textarea 当编辑器，这条必红").not.toMatch(
      /<textarea\b/
    );
  });

  it("编辑器自己静态引进 CodeMirror 和高亮语言包", () => {
    const editor = read("ProjectSourceEditor.tsx");
    expect(editor).toMatch(/@uiw\/react-codemirror/);
    expect(editor).toMatch(/githubLight/);
    expect(editor).toMatch(/lineNumbers:\s*true/);
    expect(editor).toMatch(/@codemirror\/lang-javascript/);
  });
});

describe("渲染后：行号槽在，不是白纸 textarea", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    if (
      typeof Range !== "undefined" &&
      typeof Range.prototype.getClientRects !== "function"
    ) {
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      Range.prototype.getBoundingClientRect = () =>
        new DOMRect(0, 0, 0, 0);
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("tsx 文件挂出 CodeMirror 行号，没有 textarea", async () => {
    await act(async () =>
      root.render(
        <div style={{ height: 240 }}>
          <ProjectSourceEditor
            path="src/App.tsx"
            value={'import React from "react";\nexport function App() {\n  return <div/>;\n}\n'}
            onChange={() => undefined}
          />
        </div>
      )
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector(".cm-gutters"),
      "行号槽必须在——没有它就是还在用白纸"
    ).toBeTruthy();
    expect(container.querySelector(".cm-lineNumbers")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector('[data-testid="project-source-editor"]')
        ?.getAttribute("data-editor-path")
    ).toBe("src/App.tsx");
  });
});
