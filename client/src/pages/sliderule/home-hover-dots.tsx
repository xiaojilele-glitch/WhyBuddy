/**
 * 推演页（/agent-loop/sliderule）的鼠标点阵：空欢迎和工作台同一张网。
 *
 * ⚠ 2026-08-20 真机：interactive-dot-grid 那套 canvas 每帧 `beginPath`+`arc`
 * 几万个点——间距收到 8px 之后欢迎页明显卡。Stitch / grid-cursor 的做法是
 * **GPU 铺点**：`radial-gradient` 当 repeating tile，鼠标只改 CSS 变量驱动
 * `mask-image`。密多少都不进 JS 循环。不要 Stitch 粉紫光晕。
 *
 * 挂点在 SlideRuleStudio，不在 HomeEmptyState / 空线程门闩——Empty 会被
 * Viewport 裁成中缝，开聊后门闩会把点卸掉。
 */
import React from "react";

/** quadratic falloff: t = clamp(1 - dist/radius), influence = t² */
export function cursorInfluence(dist: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = Math.max(0, 1 - dist / radius);
  return t * t;
}

export const HOME_HOVER_DOT = {
  // 上一版 spacing 24、点 1.35/7.5。用户要再密 2/3、再小 2/3 → 间距和半径剩 1/3。
  spacing: 24 / 3,
  dotMin: 1.35 / 3,
  // 悬停点太大时 8px 格里会糊成一坨灰。只比底网略大。
  dotMax: (1.35 / 3) * 1.8,
  // 真机 200px 光斑像一块饼。收到约 72。
  radiusEffect: 72,
  // 2026-08-20 全宽铺开后用户要再淡一半（相对加浓那版的 2/3 再 /2）。
  baseAlpha: (0.2 * 2) / 3 / 2,
  maxAlpha: (0.78 * 2) / 3 / 2,
  /** warm gray，不是紫 */
  color: "88,84,80",
  smoothing: 0.18,
} as const;

export function dotTileCss(radiusPx: number, alpha: number): string {
  const r = Math.max(0.35, radiusPx);
  return `radial-gradient(circle, rgba(${HOME_HOVER_DOT.color},${alpha}) ${r}px, transparent ${r + 0.4}px)`;
}

export interface HomeHoverDotGrid {
  destroy: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyLayer(el: HTMLElement, radius: number, alpha: number): void {
  const { spacing } = HOME_HOVER_DOT;
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.pointerEvents = "none";
  el.style.backgroundImage = dotTileCss(radius, alpha);
  el.style.backgroundRepeat = "repeat";
  el.style.backgroundSize = `${spacing}px ${spacing}px`;
}

/** 挂两层 CSS 点阵。失败则空操作——增强类 fail-open。 */
export function mountHomeHoverDotGrid(container: HTMLElement): HomeHoverDotGrid {
  if (typeof window === "undefined") return { destroy() {} };
  const { dotMin, dotMax, baseAlpha, maxAlpha, radiusEffect } = HOME_HOVER_DOT;
  const idle = document.createElement("div");
  const hover = document.createElement("div");
  hover.setAttribute("data-testid", "sliderule-home-hover-spot");
  applyLayer(idle, dotMin, baseAlpha);
  applyLayer(hover, dotMax, maxAlpha);
  const mask =
    `radial-gradient(${radiusEffect}px circle at var(--mx) var(--my), #000 0%, transparent 100%)`;
  hover.style.opacity = "0";
  hover.style.maskImage = mask;
  hover.style.webkitMaskImage = mask;
  hover.style.transition = prefersReducedMotion() ? "none" : "opacity 120ms ease";
  container.style.setProperty("--mx", "-9999px");
  container.style.setProperty("--my", "-9999px");
  container.appendChild(idle);
  container.appendChild(hover);

  const onMouseMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    hover.style.opacity = inside ? "1" : "0";
    container.style.setProperty("--mx", `${x}px`);
    container.style.setProperty("--my", `${y}px`);
  };
  const onMouseLeave = () => {
    hover.style.opacity = "0";
    container.style.setProperty("--mx", "-9999px");
    container.style.setProperty("--my", "-9999px");
  };

  // 层 pointer-events:none，必须听 window。减少动画也跟手，只关 opacity 过渡。
  window.addEventListener("mousemove", onMouseMove, { passive: true });
  document.documentElement.addEventListener("mouseleave", onMouseLeave);

  return {
    destroy() {
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      idle.remove();
      hover.remove();
    },
  };
}

export function HomeHoverDots(): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grid = mountHomeHoverDotGrid(el);
    return () => grid.destroy();
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="sliderule-home-hover-dots"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    />
  );
}
