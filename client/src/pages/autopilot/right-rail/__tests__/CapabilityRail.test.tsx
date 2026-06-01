/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — CapabilityRail 回归测试。
 *
 * 顶部「全量能力 status pills」已移除（信息由 3D 角色桌前 chips 承载），
 * `CapabilityRail` 现在只渲染 `CapabilityBridgePanel`（详细调用明细）。
 *
 * 因此本测试改为：
 *  1. 断言 CapabilityRail 不再渲染顶部 pills（无 `data-testid="capability-rail"`、
 *     无 `data-capability-id` badge、无 capabilityId 平铺）。
 *  2. 断言它委托给 CapabilityBridgePanel：无调用数据时整体返回 null，
 *     有调用数据时渲染 BridgePanel 内容。
 *
 * 测试策略与本仓既有 right-rail 测试一致：`react-dom/server`
 * `renderToStaticMarkup` + `vi.mock`。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseCapabilityBridgeStateReturn } from "../capability-panel/types";

// ─── 受控的 bridge 调用状态 ───────────────────────────────────────────────

let mockedBridgeState: UseCapabilityBridgeStateReturn = {
  invocations: [],
  activeInvocations: [],
  summary: { total: 0, running: 0, completed: 0, failed: 0 },
};

function setMockedBridgeState(next: Partial<UseCapabilityBridgeStateReturn>): void {
  mockedBridgeState = {
    invocations: next.invocations ?? [],
    activeInvocations: next.activeInvocations ?? [],
    summary:
      next.summary ?? { total: 0, running: 0, completed: 0, failed: 0 },
  };
}

function resetMockedBridgeState(): void {
  mockedBridgeState = {
    invocations: [],
    activeInvocations: [],
    summary: { total: 0, running: 0, completed: 0, failed: 0 },
  };
}

// The panel reads its data from useCapabilityBridgeState; mock that so we can
// drive "no data → null" vs "has data → renders" without a live store/socket.
vi.mock("../capability-panel/useCapabilityBridgeState", () => ({
  useCapabilityBridgeState: () => mockedBridgeState,
}));

// useAppStore (locale) — minimal mock.
vi.mock("@/lib/store", () => ({
  useAppStore: (selector?: (s: { locale: string }) => unknown) => {
    const snapshot = { locale: "zh-CN" };
    return selector ? selector(snapshot) : snapshot;
  },
}));

import { CapabilityRail } from "../CapabilityRail";

// ─── SSR 契约 ──────────────────────────────────────────────────────────────

describe("CapabilityRail render contract (3D-migration cleanup)", () => {
  beforeEach(() => {
    resetMockedBridgeState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedBridgeState();
  });

  it("never renders the legacy top capability pills row", () => {
    setMockedBridgeState({
      invocations: [
        {
          id: "docker-analysis-sandbox",
          bridgeType: "docker",
          name: "docker-analysis-sandbox",
          status: "completed",
          startedAt: 0,
          stageIndex: 0,
        },
      ],
      summary: { total: 1, running: 0, completed: 1, failed: 0 },
    });

    const markup = renderToStaticMarkup(<CapabilityRail />);

    // The removed pills row used these markers — they must be gone.
    expect(markup).not.toContain('data-testid="capability-rail"');
    expect(markup).not.toContain("data-capability-id");
    expect(markup).not.toContain("flex flex-wrap gap-1.5");
  });

  it("returns null (no markup) when the bridge panel has no invocations", () => {
    setMockedBridgeState({});

    const markup = renderToStaticMarkup(<CapabilityRail />);

    // CapabilityBridgePanel returns null when there are no invocations, so the
    // whole CapabilityRail collapses to empty markup.
    expect(markup).toBe("");
  });

  it("renders the detailed bridge panel when invocations exist", () => {
    setMockedBridgeState({
      invocations: [
        {
          id: "docker-analysis-sandbox",
          bridgeType: "docker",
          name: "docker-analysis-sandbox",
          status: "completed",
          startedAt: 0,
          completedAt: 0,
          durationMs: 0,
          stageIndex: 0,
        },
      ],
      summary: { total: 1, running: 0, completed: 1, failed: 0 },
    });

    const markup = renderToStaticMarkup(<CapabilityRail />);

    // Non-empty: the detailed audit panel renders (capabilityId shows in the
    // detail row, NOT as a top pill).
    expect(markup).not.toBe("");
    expect(markup).toContain("docker-analysis-sandbox");
  });
});
