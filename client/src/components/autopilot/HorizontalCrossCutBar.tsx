/**
 * autopilot-image-rendering-and-visual-system · Phase 2 · Task 17.1
 *
 * `HorizontalCrossCutBar` — 跨切关注点链路条
 *
 * 用于在 spec 视图中水平展示一条跨切关注点链路（如
 * `BlueprintEventBus → BlueprintSocketRelay → useBlueprintRealtimeStore`），
 * 按 `nodes` 数组的原始顺序渲染 `N` 个节点与 `N-1` 条连接线。
 *
 * 颜色取色契约：
 * - 文本颜色取自 `visualTokens["business-loop"][theme]`。
 * - 连接线颜色取自 `visualTokens["data-state"][theme]`。
 * - 取色统一通过 `visual-tokens-placeholder` 的 `resolveToken(key, theme)` 完成；
 *   组件内部 **禁止** 出现 `#`、`rgb(`、`hsl(`、`oklch(` 等颜色字面量。
 * - 主题切换由 React 通过 `theme` prop 变化驱动重渲染，无需额外副作用。
 *
 * 文件路径：`client/src/components/autopilot/HorizontalCrossCutBar.tsx`
 *
 * @see Requirements 12.1, 12.2, 12.3, 17.1, 18.3
 */

import type * as React from "react";

import {
  resolveToken,
  type VisualTokenSet,
} from "@/lib/autopilot/visual-tokens-placeholder";

/**
 * 跨切链路上的单个节点。
 *
 * 字段语义：
 * - `id`：节点稳定标识，用于 React `key` 与 `data-node-id` testid 定位。
 * - `label`：节点展示文本（链路条的可读内容）。
 * - `description`：可选的悬停说明，挂在 `title` 上以便鼠标悬停查看。
 */
export interface CrossCutNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * `HorizontalCrossCutBar` 组件 props。
 *
 * - `nodes`：链路节点序列，按数组顺序水平展示。
 * - `visualTokens`：视觉令牌集合，由消费方从 `visual-tokens-placeholder` 注入。
 * - `theme`：当前主题，决定从 `OklchPair` 中取 `light` 还是 `dark` 分支。
 */
export interface HorizontalCrossCutBarProps {
  readonly nodes: ReadonlyArray<CrossCutNode>;
  readonly visualTokens: VisualTokenSet;
  readonly theme: "light" | "dark";
}

/**
 * 水平展示跨切关注点链路。
 *
 * 实现要点：
 * - 节点文本与连接线 SVG 都通过 inline `style={{ color }}` / `stroke=` 应用最终色值，
 *   保证主题切换通过 React 重渲染立刻生效。
 * - 连接线使用单一 `<svg>` 内 `<line>` + `<polygon>` 表达「→」箭头，
 *   两段图形共享同一 stroke / fill 取色，避免色值漂移。
 * - 节点为空数组时仍然渲染容器（保留 `data-testid` 锚点），便于测试断言挂载状态。
 *
 * 取色实现：
 * - 同时通过两条路径派生色值：`visualTokens[key][theme]` 与 `resolveToken(key, theme)`。
 *   在默认占位实现下二者等价；保留 `visualTokens` prop 作为未来注入自定义色板的入口。
 */
export function HorizontalCrossCutBar({
  nodes,
  visualTokens,
  theme,
}: HorizontalCrossCutBarProps): React.ReactElement {
  // 优先消费传入的 visualTokens prop，使 prop 在默认占位实现下也保持「真实使用」语义；
  // 在 prop 缺失对应键的极端情况下回落到全局 resolveToken 取色，保持组件可渲染。
  const nodeColor =
    visualTokens["business-loop"]?.[theme] ?? resolveToken("business-loop", theme);
  const lineColor =
    visualTokens["data-state"]?.[theme] ?? resolveToken("data-state", theme);

  return (
    <div
      data-testid="horizontal-cross-cut-bar"
      data-theme={theme}
      role="list"
      aria-label="cross-cut chain"
      className="flex w-full flex-row flex-nowrap items-center gap-2 overflow-x-auto"
    >
      {nodes.map((node, index) => {
        const isLast = index === nodes.length - 1;
        return (
          <div
            key={node.id}
            className="flex shrink-0 flex-row items-center gap-2"
          >
            <span
              data-testid="cross-cut-node"
              data-node-id={node.id}
              role="listitem"
              title={node.description}
              style={{ color: nodeColor, borderColor: nodeColor }}
              className="whitespace-nowrap rounded-md border px-3 py-1 text-sm font-medium"
            >
              {node.label}
            </span>
            {!isLast && (
              <svg
                data-testid="cross-cut-connector"
                aria-hidden="true"
                width="32"
                height="12"
                viewBox="0 0 32 12"
                className="shrink-0"
                style={{ color: lineColor }}
              >
                <line
                  x1="0"
                  y1="6"
                  x2="24"
                  y2="6"
                  stroke={lineColor}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <polygon points="24,2 32,6 24,10" fill={lineColor} />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
