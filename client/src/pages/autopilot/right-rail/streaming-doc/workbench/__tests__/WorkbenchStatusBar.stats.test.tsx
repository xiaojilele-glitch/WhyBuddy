/**
 * `autopilot-spec-documents-workbench-v2` Phase 2 / Task 7 — 顶部统计 badge 与文档类型卡片 SSR 测试。
 *
 * 沿用本仓既有 `react-dom/server` `renderToStaticMarkup` + `vi.mock` 的测试模式，
 * 不引入 `@testing-library/react` / `jsdom` / `happy-dom`。
 *
 * 覆盖范围：
 * a. 当 `docStats` 提供非零值时：三个统计 badge 渲染正确数字；三张 DocType 卡片
 *    渲染正确 `generated / completed` 文案。
 * b. 当 `docStats` 未传（undefined）时：badge 显示 `0`，完成率显示 `0%`，
 *    卡片显示 `0 / 0`。
 * c. 当 `docStats.completionRate` 为 0.6667 时：完成率 badge 显示 `67%`（四舍五入）。
 * d. 所有六个 testid（`stat-docs`、`stat-tasks`、`stat-completion`、
 *    `doctype-card-requirements`、`doctype-card-design`、`doctype-card-tasks`）
 *    均出现在 SSR markup 中。
 * e. 不出现 `<ul>`、`<ol>` 或 `*-list` testid。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 预先 mock blueprint-realtime-store，避免下游子组件在内部消费它时产生副作用。
vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: [] as unknown[] },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import {
  WorkbenchStatusBar,
  type WorkbenchStatusBarProps,
} from "../WorkbenchStatusBar";
import type { DocStats } from "../derive-doc-stats";

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<WorkbenchStatusBarProps> = {}
): WorkbenchStatusBarProps {
  return {
    title: "测试蓝图",
    subtitle: "测试副标题",
    generating: null,
    onExport: () => {},
    onReview: () => {},
    onRefresh: () => {},
    exportDisabled: false,
    locale: "zh-CN",
    ...overrides,
  };
}

function makeDocStats(overrides: Partial<DocStats> = {}): DocStats {
  return {
    totalDocs: 0,
    targetDocs: 0,
    totalTasks: 0,
    targetTasks: 0,
    completionRate: 0,
    byType: {
      requirements: { generated: 0, completed: 0 },
      design: { generated: 0, completed: 0 },
      tasks: { generated: 0, completed: 0 },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("WorkbenchStatusBar — stats badges & DocType cards (Phase 2 / Task 7)", () => {
  it("(a) renders correct numbers in stat badges and DocType cards when docStats has non-zero values", () => {
    const docStats = makeDocStats({
      totalDocs: 9,
      targetDocs: 12,
      totalTasks: 3,
      targetTasks: 4,
      completionRate: 0.5,
      byType: {
        requirements: { generated: 3, completed: 2 },
        design: { generated: 3, completed: 1 },
        tasks: { generated: 3, completed: 0 },
      },
    });

    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ docStats })} />
    );

    // Stat badges
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-docs"[^>]*>9 \/ 12</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-tasks"[^>]*>3 \/ 4</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-completion"[^>]*>50%</
    );

    // DocType cards
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-requirements"');
    expect(markup).toContain("3 / 2");
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-design"');
    expect(markup).toContain("3 / 1");
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-tasks"');
    expect(markup).toContain("3 / 0");
  });

  it("(b) renders 0 / 0, 0%, and 0 / 0 when docStats is undefined (not passed)", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ docStats: undefined })} />
    );

    // Stat badges default to 0
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-docs"[^>]*>0 \/ 0</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-tasks"[^>]*>0 \/ 0</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-completion"[^>]*>0%</
    );

    // DocType cards default to 0 / 0
    expect(markup).toContain("0 / 0");
  });

  it("(c) rounds completionRate 0.6667 to 67%", () => {
    const docStats = makeDocStats({
      totalDocs: 3,
      targetDocs: 3,
      totalTasks: 1,
      targetTasks: 1,
      completionRate: 0.6667,
      byType: {
        requirements: { generated: 1, completed: 1 },
        design: { generated: 1, completed: 1 },
        tasks: { generated: 1, completed: 0 },
      },
    });

    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ docStats })} />
    );

    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-completion"[^>]*>67%</
    );
  });

  it("(d) all six testids are present in the SSR markup", () => {
    const docStats = makeDocStats({
      totalDocs: 6,
      targetDocs: 6,
      totalTasks: 2,
      targetTasks: 2,
      completionRate: 0.33,
      byType: {
        requirements: { generated: 2, completed: 1 },
        design: { generated: 2, completed: 0 },
        tasks: { generated: 2, completed: 1 },
      },
    });

    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ docStats })} />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-stat-docs"');
    expect(markup).toContain('data-testid="autopilot-workbench-stat-tasks"');
    expect(markup).toContain('data-testid="autopilot-workbench-stat-completion"');
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-requirements"');
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-design"');
    expect(markup).toContain('data-testid="autopilot-workbench-doctype-card-tasks"');
  });

  it("(e) does not render <ul>, <ol>, or *-list testids", () => {
    const docStats = makeDocStats({
      totalDocs: 3,
      targetDocs: 3,
      totalTasks: 1,
      targetTasks: 1,
      completionRate: 1,
      byType: {
        requirements: { generated: 1, completed: 1 },
        design: { generated: 1, completed: 1 },
        tasks: { generated: 1, completed: 1 },
      },
    });

    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ docStats })} />
    );

    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);
  });

  it("(f) uses compact spacing and truncation guards for narrow right-rail rendering", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...makeProps({
          title: "A very long blueprint title that should never push the action buttons out of the rail",
          subtitle: "A long subtitle that should stay clipped within the status bar",
          docStats: makeDocStats({
            totalDocs: 123,
            targetDocs: 456,
            totalTasks: 78,
            targetTasks: 90,
            completionRate: 0.73,
          }),
        })}
      />
    );

    // whybuddy-3d-real-role-driven-scene-2026-05-29: the status bar's own card
    // chrome (border + shadow + px-2.5 py-2 padding) was removed so the header
    // sits flush in the rail. The inner action buttons (h-7) and the stat /
    // doctype grids still carry the compact spacing + truncation guards.
    expect(markup).toContain("h-7");
    expect(markup).toContain("mt-2 grid grid-cols-3 gap-1.5");
    expect(markup).toContain("min-w-0");
    expect(markup).toContain("truncate");
  });
});
