/**
 * autopilot-image-rendering-and-visual-system · Phase 2 / Task 20.2
 *
 * `<CodeBoundarySidebar>` 渲染示例测试。
 *
 * 验证两条核心契约（与 spec design.md / requirements.md §13.1, 13.2 对齐）：
 * 1. 节点 `codePaths` 存在时按路径渲染（路径文本出现在 DOM）。
 * 2. 节点 `codePaths` 缺失时渲染「未声明代码边界」字面量。
 *
 * 测试策略说明：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`
 *   （沿用 `client/src/pages/autopilot/right-rail/**` 既有约定，避免跨规格的工具链
 *   改造与基线扩张）。因此本文件使用 `react-dom/server` 的 `renderToStaticMarkup`
 *   做 SSR 输出 + 字符串级断言；语义上等价于
 *   `screen.getByText` / `queryAllByText` 的“文本是否出现在 DOM”查询。
 *
 * @see Requirements 13.1, 13.2
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { visualTokens } from "../../../lib/autopilot/visual-tokens-placeholder";
import {
  CODE_BOUNDARY_PLACEHOLDER_TEXT,
  CodeBoundarySidebar,
  type CodeBoundaryNode,
} from "../CodeBoundarySidebar";

describe("<CodeBoundarySidebar>", () => {
  it("renders each declared code path when a node carries `codePaths`", () => {
    const nodes: ReadonlyArray<CodeBoundaryNode> = [
      {
        nodeId: "n1",
        title: "Frontend",
        codePaths: ["client/src/App.tsx", "client/src/lib/store.ts"],
      },
    ];

    const markup = renderToStaticMarkup(
      <CodeBoundarySidebar
        nodes={nodes}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    // Sidebar shell + node container are present.
    expect(markup).toContain('data-component="code-boundary-sidebar"');
    expect(markup).toContain('data-node-id="n1"');
    expect(markup).toContain('data-has-code-paths="true"');

    // The node title renders.
    expect(markup).toContain("Frontend");

    // Path segments render; together they reconstruct the full declared paths.
    // The component groups by the first head segment ("client/") and renders
    // remaining segments as leaves; this is the rendered shape we assert.
    expect(markup).toContain("client/");
    expect(markup).toContain("src/App.tsx");
    expect(markup).toContain("src/lib/store.ts");

    // The placeholder must NOT appear when codePaths is non-empty.
    expect(markup).not.toContain(CODE_BOUNDARY_PLACEHOLDER_TEXT);
  });

  it("renders the '未声明代码边界' placeholder when a node omits `codePaths`", () => {
    const nodes: ReadonlyArray<CodeBoundaryNode> = [
      {
        nodeId: "n2",
        title: "Backend",
      },
    ];

    const markup = renderToStaticMarkup(
      <CodeBoundarySidebar
        nodes={nodes}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    // Node still mounts but is flagged as missing code paths.
    expect(markup).toContain('data-node-id="n2"');
    expect(markup).toContain('data-has-code-paths="false"');

    // The node title still renders.
    expect(markup).toContain("Backend");

    // The exact literal placeholder string is rendered.
    expect(markup).toContain("未声明代码边界");
    expect(markup).toContain(CODE_BOUNDARY_PLACEHOLDER_TEXT);
    expect(CODE_BOUNDARY_PLACEHOLDER_TEXT).toBe("未声明代码边界");
  });
});
