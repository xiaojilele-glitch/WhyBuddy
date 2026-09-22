// @vitest-environment jsdom
/**
 * 结果卡的脸：2026-09-19 下午改抄 Cursor 文件卡。
 *
 * 编排没变：发布在卡头右侧，✓ 任务已完成 / 评分在卡外。卡面改成
 * 12px 圆角、h-9 文件头、小灰图标、近黑方钮。判断仍由
 * turn-result-card.test.ts 跑纯函数，这里只钉编排。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TurnResultCard } from "../TurnResultCard";
import type { UiTurn } from "../types";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function turnOf(over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "做一个坦克大战小游戏PC的",
    status: "complete",
    durationMs: 165_000,
    steps: [
      {
        id: "c1",
        kind: "chip",
        capabilityId: "project_create" as never,
        roleId: "system",
        label: "创建工程",
        realLlm: false,
        progressType: "completed",
      },
    ],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "做好了。",
    assistantSource: "llm",
    main: null,
    actions: [],
    ...over,
  };
}

describe("对照 Cursor 文件卡：发布在卡头，完成态在卡外", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mount(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(node);
    });
    return container;
  }

  it("工程档：发布是卡头黑钮，任务已完成不在卡片里", async () => {
    const el = await mount(
      <TurnResultCard
        turn={turnOf()}
        runtimeKind="project"
        goalText="做一个坦克大战小游戏PC的"
        projectRevision="prv-1"
        thumbnailUrl="/thumb.png"
        onOpen={() => {}}
        onRetry={() => {}}
      />
    );
    const publish = el.querySelector('[data-testid="turn-result-publish"]');
    const status = el.querySelector('[data-testid="turn-result-status"]');
    const header = el.querySelector("header");
    expect(publish?.textContent).toBe("发布");
    expect(header?.contains(publish)).toBe(true);
    expect(status?.contains(publish)).toBe(false);
    expect(status?.textContent).toContain("任务已完成");
    expect(header?.textContent).not.toContain("任务已完成");
    expect(status?.textContent).toContain("这个结果怎么样？");
    expect(el.querySelector('[data-testid="turn-result-thumb"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="turn-result-worked"]')?.textContent).toBe(
      "2m 45s"
    );
    const surface = el.querySelector('[data-result-surface="cursor"]');
    expect(surface).not.toBeNull();
    expect(surface?.className).toMatch(/rounded-\[12px\]/);
    expect(surface?.className).toMatch(/border-\[#e5e7eb\]/);
    expect(surface?.className).toMatch(
      /shadow-\[0_2px_8px_rgba\(31,35,40,0\.06\)\]/
    );
    expect(header?.className).toMatch(/\bh-9\b/);
    expect(header?.querySelector(".lucide-app-window")).not.toBeNull();
    expect(publish?.className).toMatch(/rounded-\[8px\]/);
    expect(publish?.className).not.toMatch(/rounded-full/);
    expect(el.innerHTML).not.toContain("#eef2ff");
    expect(el.innerHTML).not.toContain("#3b5bdb");
    expect(surface?.className).not.toMatch(/rounded-2xl/);
  });

  it("反向：源码不再画首字色块和胶囊发布", () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, "../TurnResultCard.tsx"), "utf8")
    );
    expect(src).toContain('data-result-surface="cursor"');
    expect(src).toContain("rounded-[12px]");
    expect(src).toContain("AppWindow");
    expect(src).not.toContain("#eef2ff");
    expect(src).not.toContain("#3b5bdb");
    expect(src).not.toContain("rounded-2xl");
    expect(src).not.toContain("title.slice(0, 1)");
    const publish = src.slice(
      src.indexOf("turn-result-publish"),
      src.indexOf("turn-result-publish") + 400
    );
    expect(publish).toContain("rounded-[8px]");
    expect(publish).not.toContain("rounded-full");
  });

  it("点缩略图等于打开，卡脚不再单挂打开钮", async () => {
    const onOpen = vi.fn();
    const el = await mount(
      <TurnResultCard
        turn={turnOf()}
        runtimeKind="project"
        goalText="坦克大战"
        projectRevision="prv-1"
        thumbnailUrl="/thumb.png"
        onOpen={onOpen}
      />
    );
    expect(el.querySelector('[data-testid="turn-result-open"]')).toBeNull();
    await act(async () => {
      el.querySelector('[data-testid="turn-result-thumb"]')!
        .closest("button")!
        .click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("反向：没图才在完成态那一行出打开，不许挂占位图", async () => {
    const el = await mount(
      <TurnResultCard
        turn={turnOf()}
        runtimeKind="project"
        goalText="坦克大战"
        projectRevision="prv-1"
        onOpen={() => {}}
      />
    );
    expect(el.querySelector('[data-testid="turn-result-thumb"]')).toBeNull();
    expect(el.querySelector('[data-testid="turn-result-open"]')?.textContent).toContain(
      "打开"
    );
    expect(el.innerHTML).not.toMatch(/placeholder\.(png|svg|jpg)/i);
  });
});
