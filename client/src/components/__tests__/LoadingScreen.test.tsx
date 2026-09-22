import { BRAND_NAME_DISPLAY, BRAND_TAGLINE_ZH } from "@shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appState } = vi.hoisted(() => ({
  appState: {
    locale: "zh-CN",
    loadingProgress: 67,
    setLocale: () => {},
    toggleLocale: () => {},
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

import { LoadingScreen } from "../LoadingScreen";

/**
 * MiroFish-aligned LoadingScreen contract — see
 * sliderule-rebrand-and-stage3-unblock-2026-05-28 §D.1.
 *
 * The pixel-art / hologram skin was replaced with a flat MiroFish surface:
 *   - white background, #FF4500 single-accent
 *   - 1px solid #E5E5E5 borders (no gradients, no shadows)
 *   - 字标渲染当前品牌资产与文案（品牌名走 shared/brand.ts，不写死）
 *   - status rail still shows INIT / SYNC / CONFIG / FINALIZE
 *   - progress bar still binds to --loading-progress and the percent label
 *
 * `data-testid="loading-screen"`, `loading-status-rail`, and
 * `loading-wide-card` are preserved so existing higher-level tests (Home
 * smoke etc.) keep matching. `loading-pixel-field` and
 * `loading-simple-logo` were removed by the skin swap and replaced with
 * `loading-brand-wordmark`.
 */
describe("LoadingScreen — MiroFish skin", () => {
  beforeEach(() => {
    appState.locale = "zh-CN";
    appState.loadingProgress = 67;
  });

  it("renders the MiroFish-aligned bootstrap composition", () => {
    const markup = renderToStaticMarkup(<LoadingScreen />);

    // — Surface anchors that other tests rely on
    expect(markup).toContain('data-testid="loading-screen"');
    expect(markup).toContain('data-testid="loading-wide-card"');
    expect(markup).toContain('data-testid="loading-status-rail"');
    expect(markup).toContain('data-testid="loading-brand-wordmark"');

    // 品牌名不写死在断言里：它由 shared/brand.ts 决定（2026-08-03 换成面团 AI）。
    // 写死的话每次换名都要改测试，而这条真正要守的是"字标渲染的是当前品牌名"，
    // 不是"品牌名等于某个具体字符串"。
    expect(markup).toContain(BRAND_NAME_DISPLAY);
    expect(markup).toContain("/brand/miantuan-mark.png");
    expect(markup).not.toContain("Duan" + "yun");
    expect(markup).not.toContain("Cube Pets " + "Office");

    // 标语同样走常量，理由同上（品牌名那条）
    expect(markup).toContain(BRAND_TAGLINE_ZH);

    // — Status rail labels
    expect(markup).toContain("SYSTEM");
    expect(markup).toContain("ONLINE");
    expect(markup).toContain("INIT");
    expect(markup).toContain("SYNC");
    expect(markup).toContain("CONFIG");
    expect(markup).toContain("FINALIZE");
    expect(markup).toContain("VER. 1.0.0");

    // — Progress
    expect(markup).toContain("PIXEL SYNC");
    expect(markup).toContain("67%");
    expect(markup).toContain("--loading-progress:67%");

    // — MiroFish accent stays as the single accent color
    expect(markup).toContain("#FF4500");

    // — Pixel-field / simple-logo were removed by the skin swap
    expect(markup).not.toContain('data-testid="loading-pixel-field"');
    expect(markup).not.toContain('data-testid="loading-simple-logo"');
    // — No gradients survive (MiroFish: no gradients)
    expect(markup).not.toContain("linear-gradient(90deg,#ff4d4f");
  });
});
