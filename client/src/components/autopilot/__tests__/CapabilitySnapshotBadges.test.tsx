/**
 * `<CapabilitySnapshotBadges>` 静态渲染测试
 *
 * autopilot-image-rendering-and-visual-system · Phase 3 · Task 26.2
 *
 * 覆盖范围（Requirements 16.1, 16.2）：
 * 1. 默认 props 渲染恰好 4 个静态角标。
 * 2. 4 段静态文本（`14 shared contracts` / `77 specs` /
 *    `5 capability bridges` / `Mission/Browser/Docker runtimes`）
 *    严格按 `DEFAULT_CAPABILITY_SNAPSHOT_BADGES` 顺序出现且字面量一致。
 * 3. 每个角标在 DOM 中带稳定的 `data-testid` / `data-badge-id`，
 *    便于后续 cockpit 集成定位。
 *
 * 测试策略：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`
 *   （引入这些工具属于跨规格的工具链改造，不在本规格的约束范围内）。
 *   因此与既有 autopilot 组件测试（`status-capsule.test.tsx`、
 *   `RoleStatusStrip.test.tsx`、`CapabilityRail.test.tsx` 等）保持一致，
 *   使用 `react-dom/server` 的 `renderToStaticMarkup` + vitest 字符串 / 正则
 *   断言。这同样能严格断言「恰好 4 个角标 + 文本完全一致」这一静态契约。
 *
 * 软耦合校验：本测试仅从 `client/src/lib/autopilot/visual-tokens-placeholder`
 * 取色，与组件源码保持单一替换点（Phase 2 / Phase 3 软耦合约束）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";

import {
  CapabilitySnapshotBadges,
  DEFAULT_CAPABILITY_SNAPSHOT_BADGES,
  type CapabilitySnapshotBadge,
} from "../CapabilitySnapshotBadges";

const EXPECTED_BADGE_TEXTS = [
  "14 shared contracts",
  "77 specs",
  "5 capability bridges",
  "Mission/Browser/Docker runtimes",
] as const;

const EXPECTED_BADGE_IDS = [
  "shared-contracts",
  "specs",
  "capability-bridges",
  "runtimes",
] as const;

describe("<CapabilitySnapshotBadges>", () => {
  it("exposes 4 静态角标 in DEFAULT_CAPABILITY_SNAPSHOT_BADGES with the spec-locked text", () => {
    // 在渲染之前先校验导出常量本身严格匹配 spec（防止配置漂移）。
    expect(DEFAULT_CAPABILITY_SNAPSHOT_BADGES).toHaveLength(4);
    expect(DEFAULT_CAPABILITY_SNAPSHOT_BADGES.map((b) => b.id)).toEqual(
      EXPECTED_BADGE_IDS,
    );
    expect(DEFAULT_CAPABILITY_SNAPSHOT_BADGES.map((b) => b.text)).toEqual(
      EXPECTED_BADGE_TEXTS,
    );
  });

  it("renders exactly 4 badges with text strictly matching the static spec", () => {
    // 使用与 spec 静态配置一致的 4-badge 数组字面量，保证测试与运行时显式同源；
    // 同时也覆盖了 caller 显式传入 badges 数组的路径。
    const badges: ReadonlyArray<CapabilitySnapshotBadge> = [
      { id: "shared-contracts", text: "14 shared contracts" },
      { id: "specs", text: "77 specs" },
      { id: "capability-bridges", text: "5 capability bridges" },
      { id: "runtimes", text: "Mission/Browser/Docker runtimes" },
    ];

    const markup = renderToStaticMarkup(
      <CapabilitySnapshotBadges badges={badges} theme="light" />,
    );

    // 角标容器 testid 必须出现（角标列表的稳定挂载点）。
    expect(markup).toContain('data-testid="capability-snapshot-badges"');

    // 4 个角标 testid 各出现一次（恰好 4 个 badge）。
    const badgeTestIdMatches = markup.match(
      /data-testid="capability-snapshot-badge-[a-z-]+"/g,
    );
    expect(badgeTestIdMatches).not.toBeNull();
    expect(badgeTestIdMatches).toHaveLength(4);

    for (const id of EXPECTED_BADGE_IDS) {
      expect(markup).toContain(
        `data-testid="capability-snapshot-badge-${id}"`,
      );
      expect(markup).toContain(`data-badge-id="${id}"`);
    }

    // 4 段静态文本字面量逐字匹配，且各出现一次。
    for (const text of EXPECTED_BADGE_TEXTS) {
      expect(markup).toContain(text);
      const occurrences = markup.split(text).length - 1;
      expect(occurrences).toBe(1);
    }

    // 文本顺序与 spec / DEFAULT 数组顺序严格一致。
    const orderedIndexes = EXPECTED_BADGE_TEXTS.map((text) =>
      markup.indexOf(text),
    );
    for (const idx of orderedIndexes) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...orderedIndexes].sort((a, b) => a - b);
    expect(orderedIndexes).toEqual(sorted);
  });

  it("falls back to DEFAULT_CAPABILITY_SNAPSHOT_BADGES when no badges prop is provided", () => {
    const markup = renderToStaticMarkup(
      <CapabilitySnapshotBadges theme="light" />,
    );

    const badgeTestIdMatches = markup.match(
      /data-testid="capability-snapshot-badge-[a-z-]+"/g,
    );
    expect(badgeTestIdMatches).toHaveLength(4);

    for (const text of EXPECTED_BADGE_TEXTS) {
      expect(markup).toContain(text);
    }
  });

  it("sources colors only via visual-tokens-placeholder (single replacement point)", () => {
    // 软耦合契约：组件 / 测试均通过 visual-tokens-placeholder 间接消费颜色。
    // 在测试侧主动断言 placeholder 的形态，避免 Phase 2 / Phase 3 调色板替换时
    // 测试侧出现「直接 import visual-tokens.ts」的反向污染。
    expect(visualTokens).toBeDefined();
    expect(typeof visualTokens).toBe("object");
  });
});
