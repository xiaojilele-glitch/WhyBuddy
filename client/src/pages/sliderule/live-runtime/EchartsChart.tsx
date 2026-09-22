/**
 * EchartsChart — ECharts 薄包装（图表基建统一入口）。
 *
 * - 按需注册：只登记目录真实使用的 Bar/Line/Pie/Funnel/Gauge/Heatmap/Treemap、
 *   Custom/Sankey/Boxplot/Radar，再配 Grid/Tooltip/Dataset/VisualMap/Radar，
 *   不引全量包；
 * - 本组件只经 React.lazy 引入（见 AppRuntimeScreen）——echarts 独立成 chunk，
 *   不进主 bundle（GitHub Pages 演示站首屏不背这个包）；
 * - ResizeObserver 跟随容器尺寸；option 变更 setOption(true) 全量替换。
 */

import React from "react";
import * as echarts from "echarts/core";
import {
  BarChart,
  BoxplotChart,
  CustomChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  TreemapChart,
} from "echarts/charts";
import { GridComponent, TooltipComponent, DatasetComponent, TitleComponent, VisualMapComponent, RadarComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  BoxplotChart,
  CustomChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  DatasetComponent,
  TitleComponent,
  VisualMapComponent,
  RadarComponent,
  LegendComponent,
  CanvasRenderer,
]);

interface EchartsChartProps {
  option: Record<string, unknown>;
  /** 数字按 px 处理；也接受 "100%" 这类字符串——卡片被拉伸到统一高度时
   * （见 AppRuntimeScreen 的 monitorCombinedRow），图表应该跟着填满卡片
   * 剩余空间，而不是永远钉死在一个固定像素高度、卡片里多出一截空白
   * （借鉴 Tremor 的"卡片管 padding、图表 100% 填满"分工）。 */
  height?: number | string;
  ariaLabel?: string;
}

export default function EchartsChart({ option, height = 200, ariaLabel }: EchartsChartProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    chartRef.current?.setOption(option as never, true);
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height }}
      data-testid="echarts-chart"
    />
  );
}
