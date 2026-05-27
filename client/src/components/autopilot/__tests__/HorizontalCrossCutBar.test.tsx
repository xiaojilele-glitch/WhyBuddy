/**
 * autopilot-image-rendering-and-visual-system · Phase 2 · Task 20.1
 *
 * `<HorizontalCrossCutBar>` 渲染与主题切换示例测试。
 *
 * 覆盖契约（与 spec design.md / requirements.md §12.1, 12.3, 17.1 对齐）：
 * 1. 传入 `N` 节点数组时，DOM 必须恰好包含 `N` 个节点 + `N-1` 条连接线
 *    （这里取 `N = 3`，断言 3 节点 + 2 连接线）。
 * 2. 切换 `theme` prop 后，节点 inline `style` 的 `color` 必须等于
 *    `resolveToken("business-loop", newTheme)`（业务闭环语义色 + 当前主题）。
 *
 * 测试策略说明：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`
 *   （沿用 `CodeBoundarySidebar.test.tsx` / `CapabilitySnapshotBadges.test.tsx`
 *   既有约定，避免跨规格的工具链改造）。因此本文件使用
 *   `react-dom/server` 的 `renderToStaticMarkup` 做 SSR 输出 + 字符串/正则
 *   断言；语义上等价于 `screen.getAllByTestId(...).length` 等查询。
 *
 * 软耦合校验：仅从 `@/lib/autopilot/visual-tokens-placeholder` 取色，
 * 与组件源码保持单一替换点（Phase 2 软耦合约束）。
 *
 * @see Requirements 12.1, 12.3, 17.1
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  resolveToken,
  visualTokens,
} from "@/lib/autopilot/visual-tokens-placeholder";

import {
  HorizontalCrossCutBar,
  type CrossCutNode,
} from "../HorizontalCrossCutBar";

const THREE_NODES: ReadonlyArray<CrossCutNode> = [
  { id: "n1", label: "BlueprintEventBus" },
  { id: "n2", label: "BlueprintSocketRelay" },
  { id: "n3", label: "useBlueprintRealtimeStore" },
];

describe("<HorizontalCrossCutBar>", () => {
  it("renders exactly 3 nodes and 2 connectors when given a 3-node array", () => {
    const markup = renderToStaticMarkup(
      <HorizontalCrossCutBar
        nodes={THREE_NODES}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    // Container shell mounts with the stable testid.
    expect(markup).toContain('data-testid="horizontal-cross-cut-bar"');

    // 3 节点 testids each appear exactly once.
    const nodeMatches = markup.match(/data-testid="cross-cut-node"/g);
    expect(nodeMatches).not.toBeNull();
    expect(nodeMatches).toHaveLength(3);

    // Each node's stable id is present once on a `data-node-id` attribute.
    for (const node of THREE_NODES) {
      expect(markup).toContain(`data-node-id="${node.id}"`);
      expect(markup).toContain(node.label);
    }

    // N-1 = 2 connector SVGs are rendered between the nodes.
    const connectorMatches = markup.match(
      /data-testid="cross-cut-connector"/g,
    );
    expect(connectorMatches).not.toBeNull();
    expect(connectorMatches).toHaveLength(2);
  });

  it("reflects the business-loop color for the active theme and updates on theme switch", () => {
    const lightExpected = resolveToken("business-loop", "light");
    const darkExpected = resolveToken("business-loop", "dark");

    // Sanity: light vs dark must actually differ — otherwise the assertion below is vacuous.
    expect(lightExpected).not.toBe(darkExpected);

    const lightMarkup = renderToStaticMarkup(
      <HorizontalCrossCutBar
        nodes={THREE_NODES}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    // Light theme: container reports its theme attribute and node inline style uses the
    // light business-loop color.
    expect(lightMarkup).toContain('data-theme="light"');
    expect(lightMarkup).toContain(`color:${lightExpected}`);
    // Dark color must NOT leak into the light render.
    expect(lightMarkup).not.toContain(`color:${darkExpected}`);

    const darkMarkup = renderToStaticMarkup(
      <HorizontalCrossCutBar
        nodes={THREE_NODES}
        visualTokens={visualTokens}
        theme="dark"
      />,
    );

    // After switching theme, the inline color must equal resolveToken("business-loop", "dark").
    expect(darkMarkup).toContain('data-theme="dark"');
    expect(darkMarkup).toContain(`color:${darkExpected}`);
    // Light color must NOT leak into the dark render.
    expect(darkMarkup).not.toContain(`color:${lightExpected}`);
  });
});
