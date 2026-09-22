import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../EchartsChart", () => ({
  default: ({ option }: { option: unknown }) => <pre data-testid="option">{JSON.stringify(option)}</pre>,
}));

import { ANALYSIS_DEPENDENCY_RENDERERS } from "../analysis-dependency-blocks";
import type { ExperienceBlockRendererProps } from "../block-registry";

function props(type: keyof typeof ANALYSIS_DEPENDENCY_RENDERERS, binding: Record<string, unknown>, rows: Array<Record<string, unknown>>): ExperienceBlockRendererProps {
  return {
    block: { id: `test-${type}`, type, props: { title: type }, binding: { entityRef: "records", ...binding } },
    entityRows: { records: rows.map((values, index) => ({ id: String(index + 1), values })) },
  } as unknown as ExperienceBlockRendererProps;
}

describe("分析与依赖区块", () => {
  it("漏斗按阶段确定性聚合，不依赖输入行顺序", () => {
    const html = renderToStaticMarkup(React.createElement(
      ANALYSIS_DEPENDENCY_RENDERERS.FunnelConversionChart,
      props("FunnelConversionChart", { stageFieldRef: "stage", valueFieldRef: "count" }, [
        { stage: "访问", count: 2 }, { stage: "购买", count: 1 }, { stage: "访问", count: 3 },
      ])
    ));
    expect(html).toContain('&quot;name&quot;:&quot;访问&quot;,&quot;value&quot;:5');
    expect(html).toContain('&quot;name&quot;:&quot;购买&quot;,&quot;value&quot;:1');
  });

  it("预测序列把空值保留为 null 且禁止跨断点连线", () => {
    const html = renderToStaticMarkup(React.createElement(
      ANALYSIS_DEPENDENCY_RENDERERS.ForecastConfidenceChart,
      props("ForecastConfidenceChart", { timeFieldRef: "date", actualFieldRef: "actual", forecastFieldRef: "forecast" }, [
        { date: "2026-01-01", actual: 10, forecast: 11 },
        { date: "2026-01-02", actual: null, forecast: 12 },
      ])
    ));
    expect(html).toContain('&quot;connectNulls&quot;:false');
    expect(html).toContain('&quot;data&quot;:[10,null]');
  });

  it("透视表聚合有效数值，缺失交叉单元显示短横线而不是零", () => {
    const html = renderToStaticMarkup(React.createElement(
      ANALYSIS_DEPENDENCY_RENDERERS.QueryResultPivot,
      props("QueryResultPivot", { rowFieldRef: "region", columnFieldRef: "month", valueFieldRef: "amount" }, [
        { region: "华东", month: "一月", amount: 2 },
        { region: "华东", month: "一月", amount: 3 },
        { region: "华南", month: "二月", amount: 4 },
      ])
    ));
    expect(html).toContain("5");
    expect(html).toContain("-");
  });

  it("13 个目标均有独立桌面渲染器", () => {
    expect(Object.keys(ANALYSIS_DEPENDENCY_RENDERERS)).toHaveLength(13);
  });
});
