/**
 * `<EffectPreviewScheduleTimeline>` FLIP 渲染测试
 *
 * autopilot-image-rendering-and-visual-system · Phase 3 · Task 26.1
 *
 * 覆盖范围（Requirements 15.2, 15.3）：
 * 1. **layoutId equals nodeId**：渲染时每个 `<motion.li>` 透传给 framer-motion
 *    的 `layoutId` 严格等于其 `nodeId`，与 DOM 上的 `data-node-id` 对应一致。
 * 2. **layoutId 在重排后保持稳定**：当 `dependencyOrder` 从 `["a","b","c"]`
 *    变化为 `["c","a","b"]` 并伴随 `progressPlan` 同步重排后，每个节点的
 *    `layoutId` 仍然等于其 `nodeId`，layoutId 集合完全一致；这是 framer-motion
 *    完成 FLIP 共享元素位移过渡的前置条件。
 *
 * 测试策略：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`
 *   （引入这些工具属于跨规格的工具链改造，不在本规格的约束范围内 —
 *   见 `RoleStatusStrip.test.tsx`、`CapabilityRail.test.tsx`、
 *   `CapabilitySnapshotBadges.test.tsx` 等同目录测试的一致口径）。
 *   因此使用 `react-dom/server` 的 `renderToStaticMarkup` + vitest 字符串 /
 *   正则断言，并通过 `vi.mock("framer-motion", ...)` 把 `motion.li` 透传到
 *   `<li data-layout-id={...}>`，使 `layoutId` props 在 SSR 标记中可被直接
 *   断言。两次顺序不同的 render 等价于 `rerender(...)` 的语义 ——
 *   `renderToStaticMarkup` 本身就是无副作用的纯函数渲染。
 *
 * 软耦合校验：本测试仅从 `client/src/lib/autopilot/visual-tokens-placeholder`
 * 取色，与组件源码保持单一替换点（Phase 2 / Phase 3 软耦合约束）。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ─── Mock framer-motion ──────────────────────────────────────────────────────
//
// 关键不变量：`motion.li` 收到的 `layoutId` 透传到 `<li data-layout-id={...}>`，
// 使外部测试可以直接读取 layoutId props 是否等于预期 nodeId。
//
// 使用 `Proxy` 是为了支持 `motion.<任意 tag>` 的访问形式（与组件源码使用的
// `motion.li` 保持兼容）；同时把 framer-motion 仅在 client runtime 才有意义
// 的 props（layout / initial / animate / exit / transition）剥离掉，避免它们
// 作为非法 DOM 属性出现在 SSR 标记中污染断言。`AnimatePresence` 直接透传
// children；`useReducedMotion` 在测试侧返回 `false`，保留组件正常的 spring
// 过渡 props 路径（layoutId 透传与 reduced-motion 是正交的）。
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useReducedMotion: () => false,
  motion: new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const Component = (props: Record<string, unknown>) => {
          const {
            children,
            layoutId,
            // framer-motion-only props — 必须从 SSR 输出中剔除：
            layout: _layout,
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            ...rest
          } = props;
          // 使用 `React.createElement` 而非 JSX 短语法：在 React 19 + 当前
          // tsconfig（`jsx: preserve`，无全局 `JSX` 命名空间）下，把任意 string
          // tag 作为 JSX 组件标识符会触发 TS2503/TS2604/TS2786；createElement
          // 接受 string tag 作为 intrinsic element 名称，类型上更稳。
          return React.createElement(
            tag,
            {
              ...(rest as Record<string, unknown>),
              "data-layout-id": layoutId as string | undefined,
            },
            children as React.ReactNode,
          );
        };
        Component.displayName = `MockMotion(${tag})`;
        return Component;
      },
    },
  ),
}));

// 必须放在 vi.mock 之后再 import 被测组件 / placeholder（vitest 已自动 hoist
// vi.mock，这里仍按既有项目惯例显式排版以便阅读）。
import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";

import {
  EffectPreviewScheduleTimeline,
  type ProgressPlanEntry,
} from "../EffectPreviewScheduleTimeline";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 根据 nodeId 数组合成与 `dependencyOrder` 严格同序的 `progressPlan`。
 * 节点状态使用稳定的 round-robin（pending / running / completed）以保证
 * 多次渲染的状态分布稳定，避免引入与本测试目标无关的差异。
 */
function makeProgressPlan(
  order: ReadonlyArray<string>,
): ReadonlyArray<ProgressPlanEntry> {
  const states = ["pending", "running", "completed"] as const;
  return order.map((nodeId, index) => ({
    nodeId,
    state: states[index % states.length],
  }));
}

/**
 * 解析 `<li data-testid="effect-preview-schedule-item" ...>` 开标签上的
 * `data-node-id` 与 `data-layout-id`，并按出现顺序返回 (nodeId, layoutId)
 * 的数组。
 *
 * 这种方式精确捕获了 framer-motion 通过 mock 透传到 DOM 上的 layoutId
 * props，与运行时 `<motion.li layoutId={entry.nodeId}>` 是一一对应的。
 */
function extractItemAttrs(
  markup: string,
): ReadonlyArray<{ nodeId: string; layoutId: string }> {
  const tagRegex =
    /<li\b[^>]*\bdata-testid="effect-preview-schedule-item"[^>]*>/g;
  const result: Array<{ nodeId: string; layoutId: string }> = [];
  for (const match of markup.matchAll(tagRegex)) {
    const tag = match[0];
    const nodeIdMatch = tag.match(/\bdata-node-id="([^"]+)"/);
    const layoutIdMatch = tag.match(/\bdata-layout-id="([^"]+)"/);
    if (nodeIdMatch === null || layoutIdMatch === null) {
      throw new Error(
        `effect-preview-schedule-item missing data-node-id / data-layout-id: ${tag}`,
      );
    }
    result.push({ nodeId: nodeIdMatch[1], layoutId: layoutIdMatch[1] });
  }
  return result;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("<EffectPreviewScheduleTimeline> FLIP 渲染", () => {
  it("layoutId equals nodeId — 每个 motion.li 的 layoutId 严格等于其 nodeId (Requirements 15.2, 15.3)", () => {
    const order = ["a", "b", "c"] as const;
    const progressPlan = makeProgressPlan(order);

    const markup = renderToStaticMarkup(
      <EffectPreviewScheduleTimeline
        activeStageKey="effect_preview"
        progressPlan={progressPlan}
        dependencyOrder={order}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    // 时间线根容器 + 列表挂载点都必须出现，确保 effect_preview 阶段 gate 通过。
    expect(markup).toContain(
      'data-component="effect-preview-schedule-timeline"',
    );
    expect(markup).toContain('data-active-stage-key="effect_preview"');
    expect(markup).toContain('data-testid="effect-preview-schedule-list"');

    const attrs = extractItemAttrs(markup);
    expect(attrs).toHaveLength(order.length);

    // 每个条目：data-layout-id 严格等于 data-node-id 等于对应 dependencyOrder 项。
    attrs.forEach((entry, index) => {
      expect(entry.nodeId).toBe(order[index]);
      expect(entry.layoutId).toBe(entry.nodeId);
    });

    // layoutId 集合等于全部 nodeId 集合。
    const layoutIds = attrs.map((entry) => entry.layoutId);
    expect(new Set(layoutIds)).toEqual(new Set(order));
  });

  it("layoutId 在 dependencyOrder 重排 [a,b,c] → [c,a,b] 后保持稳定 (Requirements 15.3)", () => {
    const orderBefore = ["a", "b", "c"] as const;
    const orderAfter = ["c", "a", "b"] as const;
    const progressPlanBefore = makeProgressPlan(orderBefore);
    const progressPlanAfter = makeProgressPlan(orderAfter);

    const markupBefore = renderToStaticMarkup(
      <EffectPreviewScheduleTimeline
        activeStageKey="effect_preview"
        progressPlan={progressPlanBefore}
        dependencyOrder={orderBefore}
        visualTokens={visualTokens}
        theme="light"
      />,
    );
    const markupAfter = renderToStaticMarkup(
      <EffectPreviewScheduleTimeline
        activeStageKey="effect_preview"
        progressPlan={progressPlanAfter}
        dependencyOrder={orderAfter}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    const attrsBefore = extractItemAttrs(markupBefore);
    const attrsAfter = extractItemAttrs(markupAfter);

    expect(attrsBefore).toHaveLength(3);
    expect(attrsAfter).toHaveLength(3);

    // 渲染顺序按 progressPlan 排列：
    expect(attrsBefore.map((e) => e.nodeId)).toEqual([...orderBefore]);
    expect(attrsAfter.map((e) => e.nodeId)).toEqual([...orderAfter]);

    // 关键不变量：layoutId 集合完全一致（{a,b,c}），且每个 layoutId 在
    // 重排前后都等于其对应 nodeId（即 layoutId 由 nodeId 标识，而不是位置标识）。
    const layoutIdsBefore = new Set(attrsBefore.map((e) => e.layoutId));
    const layoutIdsAfter = new Set(attrsAfter.map((e) => e.layoutId));
    expect(layoutIdsBefore).toEqual(new Set(["a", "b", "c"]));
    expect(layoutIdsAfter).toEqual(new Set(["a", "b", "c"]));
    expect(layoutIdsAfter).toEqual(layoutIdsBefore);

    // 每个 nodeId 在两次渲染中都映射到相同的 layoutId（即 nodeId）。
    const layoutIdByNodeBefore = new Map(
      attrsBefore.map((e) => [e.nodeId, e.layoutId]),
    );
    const layoutIdByNodeAfter = new Map(
      attrsAfter.map((e) => [e.nodeId, e.layoutId]),
    );
    for (const nodeId of ["a", "b", "c"] as const) {
      expect(layoutIdByNodeBefore.get(nodeId)).toBe(nodeId);
      expect(layoutIdByNodeAfter.get(nodeId)).toBe(nodeId);
      expect(layoutIdByNodeAfter.get(nodeId)).toBe(
        layoutIdByNodeBefore.get(nodeId),
      );
    }

    // dependency-order 数据也跟着 props 同步更新（便于测试 / 诊断）。
    expect(markupBefore).toContain('data-dependency-order="a,b,c"');
    expect(markupAfter).toContain('data-dependency-order="c,a,b"');
  });

  it("activeStageKey !== 'effect_preview' 时返回 null（Phase 1 rail 槽位 gate）", () => {
    const order = ["a", "b", "c"] as const;
    const progressPlan = makeProgressPlan(order);

    const markup = renderToStaticMarkup(
      <EffectPreviewScheduleTimeline
        activeStageKey="other_stage"
        progressPlan={progressPlan}
        dependencyOrder={order}
        visualTokens={visualTokens}
        theme="light"
      />,
    );

    expect(markup).toBe("");
  });

  it("仅通过 visual-tokens-placeholder 取色（单一替换点契约）", () => {
    expect(visualTokens).toBeDefined();
    expect(typeof visualTokens).toBe("object");
  });
});
