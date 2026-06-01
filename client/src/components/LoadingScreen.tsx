import type { CSSProperties } from "react";

import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import {
  BRAND_HEADLINE_EN,
  BRAND_HEADLINE_ZH,
  BRAND_NAME_DISPLAY,
  BRAND_TAGLINE_EN,
  BRAND_TAGLINE_ZH,
} from "@shared/brand";

/**
 * MiroFish-aligned loading screen — replaces the pixel-art holographic
 * variant per whybuddy-rebrand-and-stage3-unblock-2026-05-28 §D.1.
 *
 * Visual language (matches client/src/styles/mirofish-tokens.css):
 *   - bg: #FFFFFF
 *   - fg: #000000
 *   - accent: #FF4500 (single use: progress bar fill + status pip)
 *   - border: 1px solid #E5E5E5
 *   - radius: 2px max
 *   - shadow: none
 *   - typography: DM Sans / Noto Sans SC (display) + JetBrains Mono (data)
 *
 * Behavior unchanged: consumes useAppStore.loadingProgress and shows a
 * locale-aware copy block. Same `data-testid="loading-screen"` so existing
 * tests still find it.
 */

const RAIL_STEPS = ["INIT", "SYNC", "CONFIG", "FINALIZE"] as const;

const CHINESE_COPY = {
  brandHeadline: BRAND_HEADLINE_ZH,
  brandTagline: BRAND_TAGLINE_ZH,
  title: "正在准备工作台",
  subtitle: "端侧资源加载完成后即可开始",
  progress: "同步组件、令牌与样式资源…",
  progressLabel: "PIXEL SYNC",
  systemLabel: "SYSTEM",
  onlineLabel: "ONLINE",
  versionLabel: "VER. 1.0.0",
};

const ENGLISH_COPY = {
  brandHeadline: BRAND_HEADLINE_EN,
  brandTagline: BRAND_TAGLINE_EN,
  title: "Preparing your workbench",
  subtitle: "Edge resources are loading. We'll be ready in a moment.",
  progress: "Syncing components, tokens and stylesheets…",
  progressLabel: "PIXEL SYNC",
  systemLabel: "SYSTEM",
  onlineLabel: "ONLINE",
  versionLabel: "VER. 1.0.0",
};

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function StatusRail({ copy }: { copy: typeof CHINESE_COPY }) {
  return (
    <aside
      className="relative flex min-h-[420px] flex-col justify-between border border-[#E5E5E5] bg-white p-7 text-left lg:min-h-[520px]"
      style={{ borderRadius: "2px" }}
      data-testid="loading-status-rail"
    >
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-black/60">
          {copy.systemLabel}
        </p>
        <div
          className="mt-5 inline-flex items-center gap-2 border border-[#FF4500] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF4500]"
          style={{ borderRadius: "2px" }}
        >
          <span className="size-2 rounded-full bg-[#FF4500]" />
          {copy.onlineLabel}
        </div>
      </div>

      <div className="relative my-10 pl-1">
        <span className="absolute left-[8px] top-3 h-[calc(100%-24px)] w-px bg-[#E5E5E5]" />
        <div className="flex flex-col gap-7">
          {RAIL_STEPS.map((step, index) => (
            <div key={step} className="relative flex items-center gap-5">
              <span
                className={`relative z-10 size-3 rounded-full border-2 ${
                  index < 3
                    ? "border-[#FF4500] bg-[#FF4500]"
                    : "border-black/30 bg-white"
                }`}
              />
              <span
                className={`font-mono text-[12px] font-bold uppercase tracking-[0.18em] ${
                  index < 3 ? "text-black/80" : "text-black/40"
                }`}
              >
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-black/40">
        {copy.versionLabel}
      </p>
    </aside>
  );
}

function BrandWordmark({ copy }: { copy: typeof CHINESE_COPY }) {
  return (
    <div
      aria-label={copy.brandHeadline}
      className="relative mx-auto flex w-full flex-col items-start gap-3"
      data-testid="loading-brand-wordmark"
    >
      <img
        src="/brand/logo.png"
        alt="WhyBuddy"
        className="h-16 w-auto object-contain"
      />
      <h1
        className="font-display text-[clamp(3.5rem,8vw,5.5rem)] font-medium leading-[0.95] tracking-tight text-black"
      >
        {BRAND_NAME_DISPLAY}
      </h1>
      <p className="font-display text-base font-normal leading-7 tracking-normal text-black/60">
        {copy.brandTagline}
      </p>
    </div>
  );
}

export function LoadingScreen() {
  const loadingProgress = useAppStore(state => state.loadingProgress);
  const { locale } = useI18n();
  const progress = clampProgress(loadingProgress);
  const copy = locale === "zh-CN" ? CHINESE_COPY : ENGLISH_COPY;

  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-[100svh] items-center justify-center bg-white px-4 py-6 text-black sm:px-6 lg:py-10"
      data-testid="loading-screen"
    >
      <main className="relative z-10 flex w-full max-w-[1280px] flex-col items-stretch">
        <section
          className="grid w-full gap-6 border border-[#E5E5E5] bg-white p-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8 lg:p-8"
          style={{ borderRadius: "2px" }}
          data-testid="loading-wide-card"
        >
          <StatusRail copy={copy} />

          <div
            className="relative flex min-h-[420px] flex-col justify-between border border-[#E5E5E5] bg-white p-8 lg:min-h-[520px] lg:p-10"
            style={{ borderRadius: "2px" }}
          >
            <BrandWordmark copy={copy} />

            <div className="mt-10 flex flex-col gap-3">
              <h2
                className="font-display text-2xl font-medium leading-tight tracking-tight text-black"
              >
                {copy.title}
              </h2>
              <p className="font-display text-sm font-normal leading-6 tracking-normal text-black/60">
                {copy.subtitle}
              </p>
            </div>

            <div
              className="mt-8 w-full border border-[#E5E5E5] bg-white p-5"
              style={
                {
                  borderRadius: "2px",
                  "--loading-progress": `${progress}%`,
                } as CSSProperties
              }
            >
              <div className="mb-4 flex items-center justify-between gap-4 font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-black/70">
                <span>{copy.progressLabel}</span>
                <span className="text-[#FF4500] tracking-normal">
                  {progress}%
                </span>
              </div>
              <div
                className="relative h-1.5 overflow-hidden bg-[#E5E5E5]"
                style={{ borderRadius: "2px" }}
              >
                <div
                  className="h-full bg-[#FF4500] transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%`, borderRadius: "2px" }}
                />
              </div>
              <p className="mt-4 font-display text-sm font-normal leading-6 tracking-normal text-black/60">
                {copy.progress}
              </p>
            </div>
          </div>
        </section>

        <footer
          className="mt-6 flex items-center justify-between gap-5 border border-[#E5E5E5] bg-white px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.32em] text-black/60"
          style={{ borderRadius: "2px" }}
        >
          <span>WHYBUDDY</span>
          <span className="text-black/30">·</span>
          <span>{copy.brandHeadline}</span>
        </footer>
      </main>
    </div>
  );
}
