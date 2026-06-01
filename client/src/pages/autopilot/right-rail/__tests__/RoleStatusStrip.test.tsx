/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 1
 * 回归测试：RoleStatusStrip。
 *
 * 测试策略与本仓既有 right-rail 测试（`AutopilotRightRail.subtimeline-mount.test.tsx`）
 * 保持一致：本仓 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，引入这些
 * 工具属于跨规格的工具链改造；因此使用 `react-dom/server` `renderToStaticMarkup` +
 * `vi.mock` 替换 `useBlueprintRealtimeStore` 的方式做 SSR 层断言。
 *
 * 覆盖三类契约（与上文规格一一对应）：
 *  1. rolePhases 为空时返回 null，不出现 `data-testid="role-status-strip"`。
 *  2. rolePhases 非空时渲染所有 roleId 与对应相位颜色（thinking → animate-pulse；
 *     acting → bg-amber-100；completed → bg-emerald-50）。
 *  3. roleId 字母序稳定排序：不论 store 注入顺序如何，输出 markup 中 `analyzer`
 *     必须先于 `planner` 出现。
 *
 * 第四个 source-level 断言用于锁定 `<RoleStatusStrip />` 已经被挂载在
 * `AutopilotRightRail.tsx` 的 fabric 分支（`data-stage-placeholder="fabric"` 所在的
 * `<aside>` return 块）内，避免后续重构把它误移到非 fabric 分支或丢失挂载。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RolePhase } from "@/lib/blueprint-realtime-store";

// ─── 受控的 rolePhases 状态 ───────────────────────────────────────────────

let mockedRolePhases: Record<string, RolePhase> = {};

function setMockedRolePhases(next: Record<string, RolePhase>): void {
  mockedRolePhases = { ...next };
}

function resetMockedRolePhases(): void {
  mockedRolePhases = {};
}

// ─── Mock `@/lib/blueprint-realtime-store` ────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: { rolePhases: Record<string, RolePhase> }) => unknown
  ) => {
    const snapshot = { rolePhases: mockedRolePhases };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { RoleStatusStrip } from "../RoleStatusStrip";

// ─── Layer 1：SSR 契约 ─────────────────────────────────────────────────────

describe("RoleStatusStrip render contract", () => {
  beforeEach(() => {
    resetMockedRolePhases();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedRolePhases();
  });

  it("returns null when rolePhases is empty (folded state)", () => {
    setMockedRolePhases({});

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    // 折叠态：返回 null → markup 为空字符串，且不可能含有 testid。
    expect(markup).not.toContain('data-testid="role-status-strip"');
    expect(markup).toBe("");
  });

  it("renders one badge per role with phase-specific color classes", () => {
    setMockedRolePhases({
      planner: "thinking",
      analyzer: "acting",
      reviewer: "completed",
    });

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    expect(markup).toContain('data-testid="role-status-strip"');
    expect(markup).toContain("planner");
    expect(markup).toContain("analyzer");
    expect(markup).toContain("reviewer");

    // 相位颜色：thinking → animate-pulse + bg-blue-50
    expect(markup).toContain("animate-pulse");
    // acting → bg-amber-100
    expect(markup).toContain("bg-amber-100");
    // completed → bg-emerald-50（注意：completed 与 observing 都用 emerald 家族，
    // 但 completed 是 -50（更浅），observing 是 -100；这里锁定 -50 以区分。）
    expect(markup).toContain("bg-emerald-50");

    // 容器布局 class
    expect(markup).toContain("flex flex-wrap gap-1.5");
  });

  it("sorts roles alphabetically regardless of insertion order", () => {
    // 故意以非字母序注入；迭代顺序按 ES2015 规范保留插入序，
    // 因此如果组件未排序，markup 中 planner 会先于 analyzer。
    setMockedRolePhases({
      reviewer: "completed",
      planner: "thinking",
      analyzer: "acting",
    });

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    // autopilot-i18n-consistency: roleIds are now localized via resolveRoleLabel.
    // Default locale is zh-CN, so we check for Chinese labels.
    // Sort order is still by raw roleId (alphabetical): analyzer < planner < reviewer
    const analyzerIdx = markup.indexOf(">分析师<");
    const plannerIdx = markup.indexOf(">规划师<");
    const reviewerIdx = markup.indexOf(">评审员<");

    // 三个 badge 都必须出现（以本地化标签形式）
    expect(analyzerIdx).toBeGreaterThan(-1);
    expect(plannerIdx).toBeGreaterThan(-1);
    expect(reviewerIdx).toBeGreaterThan(-1);

    // 字母序（按 raw roleId 排序）：analyzer < planner < reviewer
    expect(analyzerIdx).toBeLessThan(plannerIdx);
    expect(plannerIdx).toBeLessThan(reviewerIdx);
  });
});

// ─── Layer 2：源代码层 — RoleStatusStrip 已从右栏移除 ──────────────────────

describe("AutopilotRightRail no longer mounts <RoleStatusStrip />", () => {
  it("does not reference <RoleStatusStrip /> anywhere in the rail (moved to 3D scene)", async () => {
    // whybuddy-3d-real-role-driven-scene-2026-05-29: role identity / phase
    // status is now carried by the real 3D agents (pet body + nameplate + bob
    // animation), so the duplicate role chip strip was removed from the right
    // rail. The RoleStatusStrip component itself is kept (Layer 1 render
    // contract above still holds) but is no longer mounted by AutopilotRightRail.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8"
    );

    // Neither the JSX mount nor the import should remain.
    expect(source).not.toMatch(/<RoleStatusStrip\b/);
    expect(source).not.toMatch(/import\s*\{\s*RoleStatusStrip\s*\}/);
  });
});
