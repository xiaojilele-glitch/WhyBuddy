/**
 * `<MetricsRow>` tests — Wave 1 / Spec 2 任务 7
 *
 * 覆盖 3 + case：
 * 1. 默认 3 列：渲染 `grid-cols-3`
 * 2. 2 列 / 4 列可切换：正确映射到 `grid-cols-2` / `grid-cols-4`
 * 3. 每个 metric 渲染 `<dd>` value + `<dt>` label + 可选 hint
 *
 * 遵循本仓库现有测试约束：不使用 `@testing-library/react` / jsdom，
 * 统一走 `react-dom/server` SSR 渲染 + 字符串断言。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetricsRow } from "../metrics-row";

describe("<MetricsRow>", () => {
  it("defaults to 3-column grid when columns prop is omitted", () => {
    const markup = renderToStaticMarkup(
      <MetricsRow
        metrics={[
          { label: "ACTIVE", value: 3 },
          { label: "TOTAL", value: 8 },
          { label: "FAILED", value: 0 },
        ]}
      />,
    );

    expect(markup).toContain('data-testid="autopilot-metrics-row"');
    expect(markup).toContain('data-columns="3"');
    expect(markup).toContain("grid-cols-3");
    expect(markup).not.toContain("grid-cols-2");
    expect(markup).not.toContain("grid-cols-4");
    // divide-x provides vertical separators between metrics
    expect(markup).toContain("divide-x");
  });

  it("maps the columns prop to grid-cols-2 and grid-cols-4 respectively", () => {
    const twoMarkup = renderToStaticMarkup(
      <MetricsRow
        columns={2}
        metrics={[
          { label: "LEFT", value: "A" },
          { label: "RIGHT", value: "B" },
        ]}
      />,
    );
    expect(twoMarkup).toContain('data-columns="2"');
    expect(twoMarkup).toContain("grid-cols-2");
    expect(twoMarkup).not.toContain("grid-cols-3");

    const fourMarkup = renderToStaticMarkup(
      <MetricsRow
        columns={4}
        metrics={[
          { label: "Q1", value: 1 },
          { label: "Q2", value: 2 },
          { label: "Q3", value: 3 },
          { label: "Q4", value: 4 },
        ]}
      />,
    );
    expect(fourMarkup).toContain('data-columns="4"');
    expect(fourMarkup).toContain("grid-cols-4");
    expect(fourMarkup).not.toContain("grid-cols-3");
  });

  it("renders dl/dt/dd semantic tags with value, label, and optional hint", () => {
    const markup = renderToStaticMarkup(
      <MetricsRow
        metrics={[
          { label: "ROLES", value: 12, hint: "12 active agents" },
          { label: "ROUTES", value: "3/5" },
        ]}
      />,
    );

    // Semantic <dl> root + <dd>/<dt> structure (需求 3)
    expect(markup).toMatch(/<dl[^>]*/);
    expect(markup).toContain("<dd");
    expect(markup).toContain("<dt");

    // First metric full contract
    expect(markup).toContain("12");
    expect(markup).toContain("ROLES");
    expect(markup).toContain("12 active agents");
    expect(markup).toContain('data-testid="autopilot-metrics-row-hint"');

    // Second metric has no hint; the hint container should only appear once
    const hintMatches = markup.match(/autopilot-metrics-row-hint/g) ?? [];
    expect(hintMatches.length).toBe(1);

    // Values render as tabular-nums in the mono display slot
    expect(markup).toContain("tabular-nums");
    expect(markup).toContain("text-[32px]");
  });
});
