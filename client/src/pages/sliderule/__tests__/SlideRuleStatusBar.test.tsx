import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { SlideRuleStatusBar } from "../SlideRuleStatusBar";
import { idleRehearsalCursor, startRehearsalCursor } from "../derive-status-bar";

function state(): V5SessionState {
  return {
    sessionId: "status-bar-closure-test",
    goal: { text: "publish closure badge", status: "clear" },
    artifacts: [],
    capabilityRuns: [],
    coverageGaps: [],
  } as unknown as V5SessionState;
}

function render(closure?: PublishClosureSummary | null): string {
  return renderToStaticMarkup(
    <SlideRuleStatusBar
      state={state()}
      turnCount={1}
      isRunning={false}
      executorMode="server-llm"
      publishClosure={closure}
    />,
  );
}

describe("SlideRuleStatusBar publish closure badge", () => {
  it("renders publish closed with evidence details", () => {
    const html = render({
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      tierCounts: { hard_blocker: 0, warning: 1, info: 2 },
      topBlockers: [],
    });

    expect(html).toContain('data-testid="sliderule-publish-closure-badge"');
    expect(html).toContain("publish closed");
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain('title="6/6 evidence - pins checked - hard 0 - warn 1 - info 2"');
  });

  it("renders publish blocked with blocker evidence as non-fail-closed", () => {
    const html = render({
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 4,
      skillCount: 6,
      versionPinsChecked: false,
      tierCounts: { hard_blocker: 2, warning: 1, info: 0 },
      topBlockers: [{ code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", path: "page" }],
    });

    expect(html).toContain("publish blocked");
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain("hard 2");
  });

  it("marks blocked closure without blocker details as fail-closed", () => {
    const html = render({
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 0,
      skillCount: 6,
      versionPinsChecked: false,
      tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
      topBlockers: [],
    });

    expect(html).toContain("publish blocked");
    expect(html).toContain('data-fail-closed="true"');
  });

  it("omits publish closure badge when closure summary is absent", () => {
    expect(render(null)).not.toContain('data-testid="sliderule-publish-closure-badge"');
    expect(render(undefined)).not.toContain('data-testid="sliderule-publish-closure-badge"');
  });
});

const FORBIDDEN_ETA = ["8–9", "8-9", "8 分钟", "约 2 分钟", "20 分钟"];

describe("推演钟 + 证据 HUD（产品 DOM）", () => {
  it("运行中渲染工厂步、不含默认跳过的澄清格，墙上钟没有假分钟数", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={state()}
        turnCount={1}
        isRunning
        executorMode="server-llm"
        rehearsalCursor={startRehearsalCursor()}
      />
    );
    expect(html).toContain('data-testid="sliderule-rehearsal-clock"');
    expect(html).not.toContain('data-testid="sliderule-rehearsal-step-1"');
    expect(html).toContain('data-testid="sliderule-rehearsal-step-2"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("起草 SPEC");
    expect(html).toContain("大约数分钟，第一页会先出现");
    expect(html).toContain('data-testid="sliderule-hud-evidence"');
    expect(html).toContain('data-testid="sliderule-hud-tokens"');
    for (const eta of FORBIDDEN_ETA) {
      expect(html, `产品 DOM 不许出现 ETA ${eta}`).not.toContain(eta);
    }
  });

  it("廉价回合跑着：不铺六格、不说大约数分钟", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={state()}
        turnCount={1}
        isRunning
        executorMode="server-llm"
        rehearsalCursor={idleRehearsalCursor()}
      />
    );
    expect(html).not.toContain('data-testid="sliderule-rehearsal-step-2"');
    expect(html).not.toContain("大约数分钟，第一页会先出现");
    expect(html).not.toContain("起草 SPEC");
  });

  it("非 server 的 costLedger 行不进 HUD token 列", () => {
    const s = state();
    s.costLedger = [
      {
        id: "server-row",
        turnId: "t1",
        capabilityRunId: "r1",
        capabilityId: "spec_tree",
        estimatedTokens: 41,
        source: "server",
        createdAt: "2026-08-27T00:00:00.000Z",
      },
      {
        id: "guess-row",
        turnId: "t1",
        capabilityRunId: "r2",
        capabilityId: "risk.analyze",
        estimatedTokens: 8888,
        source: "estimated",
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={s}
        turnCount={1}
        isRunning
        rehearsalCursor={startRehearsalCursor()}
      />
    );
    const tokenAt = html.indexOf('data-testid="sliderule-hud-tokens"');
    expect(tokenAt).toBeGreaterThan(-1);
    const tokenSlice = html.slice(tokenAt, tokenAt + 280);
    expect(tokenSlice).toContain("41");
    expect(tokenSlice).toContain('data-token-known="true"');
    expect(tokenSlice).not.toContain("8888");
    expect(html).not.toContain("8888");
  });

  it("停跑后第 2 步是 done 不是 current；澄清格不占钟", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={state()}
        turnCount={1}
        isRunning={false}
        rehearsalCursor={startRehearsalCursor()}
      />
    );
    expect(html).toContain('data-testid="sliderule-rehearsal-step-2"');
    expect(html).not.toContain('data-testid="sliderule-rehearsal-step-1"');
    const step2 = html.slice(
      html.indexOf('data-testid="sliderule-rehearsal-step-2"'),
      html.indexOf('data-testid="sliderule-rehearsal-step-3"')
    );
    expect(step2).toContain('data-status="done"');
    expect(step2).not.toContain("aria-current");
    expect(html).not.toContain('aria-current="step"');
  });

  it("没有 server 账时 token 列是 — 不是 0", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={state()}
        turnCount={1}
        isRunning
        rehearsalCursor={startRehearsalCursor()}
      />
    );
    const tokenAt = html.indexOf('data-testid="sliderule-hud-tokens"');
    const tokenSlice = html.slice(tokenAt, tokenAt + 280);
    expect(tokenSlice).toContain('data-token-known="false"');
    expect(tokenSlice).toContain("—");
    expect(tokenSlice).not.toContain(">0<");
  });

  it("刷新后无 cursor 仍画出闭环证据行", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStatusBar
        state={state()}
        turnCount={1}
        isRunning={false}
        publishClosure={{
          blocked: true,
          blockerCount: 1,
          evidencePresentCount: 0,
          skillCount: 6,
          versionPinsChecked: false,
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
          topBlockers: [],
        }}
      />
    );
    expect(html).toContain('data-testid="sliderule-context-hud"');
    expect(html).toContain('data-testid="sliderule-hud-evidence"');
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
  });
});
