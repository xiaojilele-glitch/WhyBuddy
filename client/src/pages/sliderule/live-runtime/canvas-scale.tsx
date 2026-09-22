/**
 * 缩放画布：固定设计分辨率 + CSS transform 等比缩放，右下角一枚自述标识。
 *
 * ## 为什么单独抽一个文件（2026-08-14）
 *
 * 这套东西原本整份长在 AppRuntimeScreen 里，只有区块页用得上。spec-first
 * 那条链路的页面（SpecPageLiveStage）此前是**直接铺满容器**的：容器多宽就
 * 多宽，于是同一份 HTML 在不同宽度的窗口里是不同的版式——而它偏偏是
 * 照着固定视口画出来的（见下面 SPEC_PAGE_VIEWPORT 的注释）。
 *
 * 两处要的是同一件事，所以**抽出来共用而不是复制一份**。这份仓库在
 * 「同一个东西写两遍必然分叉」上栽过太多次（手写 uses 声明、前端手抄区域
 * 词汇、pageKinds 两处数字打架），缩放系数这种"改一处忘一处就悄悄不一致"
 * 的东西尤其不该抄。
 *
 * ⚠ 抽出来的是**机制**，不是尺寸：两条链路的设计分辨率不同，各自传各自的
 *   （见下面两个常量）。把尺寸也统一掉是另一个决定，不在这次范围内。
 */

import React from "react";
import { deviceViewportCss } from "../product-archetypes";

/**
 * 缩放模式（2026-07-30 补 "width"）。
 *
 *   contain — min(w/W, h/H)：保证整个应用可见，代价是宽高比不匹配时留边。
 *             应用舞台要这个：用户要看全。
 *   width   — w/W：**只按宽度算，高度由内容推导**。画布与卡片同比时用。
 *   cover   — max(w/W, h/H)：铺满盒子，多出来的裁掉。应用中心卡片要这个。
 *
 * ⚠ 2026-08-20：spec-first 手机画布改回 390×844（0.462），卡片墙仍是
 * 9:16（0.5625）。width 把 16:9 画布缩进竖卡时，缩放高度远矮于卡片，
 * 顶上缩成一小块、下面全白——真机应用市场就是这样。cover 跟
 * object-fit:cover / session-thumb 同一几何。
 *
 * 为什么加这一档：作品墙那版设计里卡片大中小交错、宽高比五花八门，用 contain
 * 的结果是每张卡两侧一大片灰（实测 778×272 的卡里应用只有 484px 宽，
 * 383×130 的卡里只有 230px）。
 *
 * 做法照 WordPress Gutenberg 的 ScaledBlockPreview
 * （packages/block-editor/src/components/block-preview/auto.js）：
 *     const scale = containerWidth / viewportWidth;
 *     const aspectRatio = containerWidth / (contentHeight * scale);
 * 它也是缩放真实渲染的组件树（不是 iframe、不是截图），跟这里同一个问题。
 * 关键在**宽度定缩放、高度跟着内容走**，而不是把内容塞进一个固定尺寸的盒子
 * ——后者必然要么留边要么裁切。调用方据此把容器高度设成 designH×scale。
 */
export type ScaleFitMode = "contain" | "width" | "cover";

/**
 * spec-first 那条链路的设计分辨率。
 *
 * **1920×1080 不是随手挑的圆整数**：这些页面的唯一参照渲染器
 * `experiments/visual-first/render_pages.cjs` 就是用
 * `viewport: { width: 1920, height: 1080 }` 截的图，而 V6.0 那次
 * 「有图 / 无图哪个好」的裁决，用户看的正是那批 1920 宽的截图
 * （架构图 ⚑3：判据是渲染出来用眼睛看）。
 *
 * 也就是说：**页面是照着 1920 画的，验收也是在 1920 下做的**。画布用别的
 * 宽度，等于让用户看一个从没被验收过的版式——1440 下 Tailwind 的
 * `xl:` 断点（1280）还在，但 `2xl:`（1536）整档失效，多列栅格会塌成少列。
 *
 * ⚠ 2026-08-20 晚试过 1920×1920，用户看完改回 16:9。高改成 1920 这条必须红。
 */
export const SPEC_PAGE_VIEWPORT = { w: 1920, h: 1080 } as const;

/**
 * 移动端竖屏的设计分辨率（2026-08-20 改成 CSS 像素）。
 *
 * ⚠ 第一版写成 1080×1920（桌面的转置）。那是物理像素，不是布局视口。
 * 真机（选题库那趟）：舞台机框是 1080 宽，模型却按 v0 / screenshot-to-code
 * 的习惯输出 `max-w-md mx-auto`（~448px）「机模」，整页缩在框中间一块
 * 暗色卡片上——用户画红框说「没有占满手机尺寸」。同时 Tailwind `lg:`
 * （1024）在 1080 下生效，移动页看起来还是 PC。
 *
 * 改成 Playwright `devices['iPhone 14']` / Chrome DevTools 同款
 * **390×844 CSS 像素**（不是 1080 物理像素）。390 < sm(640)，`md:`/`lg:`
 * 都不会着火。老区块链路 AppRuntimeScreen 的 405×720 是给 9:16 出图卡片
 * 用的，别跟这条 spec-first 画布混成一个数。
 */
export const SPEC_PAGE_VIEWPORT_PHONE = { w: 390, h: 844 } as const;

/**
 * 按设备取 spec 页画布视口。数字从账本 `viewportCss` 读。
 *
 * ⚠ 2026-08-30 夜：写成 `phone ? 390 : 1920`，dropdown 选了平板，
 * 舞台徽标仍是 1920×1080 · 58%。不许再手写二分。
 */
export function specPageViewport(device?: string | null): { w: number; h: number } {
  return deviceViewportCss(device);
}

/**
 * 手机舞台默认缩放。contain 会按列高把 390×844 放大到 110%+，真机看起来
 * 比真机还大。封顶 80%；容器更窄时仍按 contain 再缩小。
 *
 * ⚠ 2026-08-20：用户指着 110% 说默认 80% 合适。改回 1 或拿掉封顶必须红。
 */
export const PHONE_STAGE_MAX_SCALE = 0.8;

export function clampCanvasScale(raw: number, maxScale?: number): number {
  if (maxScale == null || !(maxScale > 0)) return raw;
  return Math.min(raw, maxScale);
}

/**
 * 容器实测尺寸 → 等比缩放系数。纯函数，ResizeObserver 只负责喂数。
 *
 * ⚠ 只在 ResizeObserver 里量，不监听 window.resize：容器被侧栏折叠、抽屉
 *   推挤而变形时 window 尺寸一动不动，靠 resize 事件会漏掉一整类变化。
 */
export function computeScaleToFit(
  containerW: number,
  containerH: number,
  designW: number,
  designH: number,
  mode: ScaleFitMode = "contain"
): number | null {
  if (containerW <= 0 || designW <= 0) return null;
  if (mode === "width") return containerW / designW;
  if (containerH <= 0 || designH <= 0) return null;
  const byW = containerW / designW;
  const byH = containerH / designH;
  return mode === "cover" ? Math.max(byW, byH) : Math.min(byW, byH);
}

/** 拖分栏时跳过亚像素抖动，避免每帧 setState。 */
export const SCALE_EPSILON = 0.001;

export function scaleNeedsCommit(prev: number, next: number): boolean {
  return Math.abs(next - prev) >= SCALE_EPSILON;
}

/**
 * 容器实测尺寸 → 等比缩放系数。
 *
 * ⚠ 只在 ResizeObserver 里量，不监听 window.resize：容器被侧栏折叠、抽屉
 *   推挤而变形时 window 尺寸一动不动，靠 resize 事件会漏掉一整类变化。
 *
 * ⚠ 2026-08-20：拖分栏时 paused=true。舞台 iframe 是 1920×1080 整页，
 *   每帧 setScale 会把 React 提交拖成卡顿。对照 Gutenberg ScaledBlockPreview
 *   和 VS Code sash：拖的时候不重算，松手再量。ResizeObserver 回调还要
 *   rAF 合并——同一帧多次 entry 只提交一次。
 */
export function useScaleToFit(
  designW: number,
  designH: number,
  mode: ScaleFitMode = "contain",
  paused = false,
  /** 从容器里扣掉的边（机框描边、下巴）。box-shadow 描边不算进 layout，
   *  不扣的话 12px 外圈会被 overflow:hidden 切掉顶。 */
  pad: { x: number; y: number } = { x: 0, y: 0 },
  maxScale?: number
): {
  ref: React.RefObject<HTMLDivElement | null>;
  scale: number;
} {
  const initial = maxScale && maxScale > 0 ? maxScale : 1;
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(initial);
  const scaleRef = React.useRef(initial);
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;
  const padX = pad.x;
  const padY = pad.y;

  const commit = React.useCallback((next: number) => {
    if (!scaleNeedsCommit(scaleRef.current, next)) return;
    scaleRef.current = next;
    setScale(next);
  }, []);

  const readScale = React.useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const raw = computeScaleToFit(
      Math.max(0, el.clientWidth - padX),
      Math.max(0, el.clientHeight - padY),
      designW,
      designH,
      mode
    );
    if (raw == null) return null;
    return clampCanvasScale(raw, maxScale);
  }, [designW, designH, mode, padX, padY, maxScale]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      if (pausedRef.current) return;
      const next = readScale();
      if (next == null) return;
      commit(next);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(schedule);
      ro.observe(el);
      // ⚠ 2026-09-19：必须先 observe 再量。react-resizable-panels 的
      //   autoSaveId 会在首屏 defaultSize（约 70%）之后把栏收成记下的
      //   比例。先量再订的话，订上之前那一缩 ResizeObserver 收不到，
      //   工程预览会停在 58%、1920 画板比可见栏还宽。
      measure();
      const settle = requestAnimationFrame(() => {
        requestAnimationFrame(measure);
      });
      return () => {
        ro.disconnect();
        cancelAnimationFrame(settle);
        if (raf) cancelAnimationFrame(raf);
      };
    }
    measure();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [readScale, commit]);

  React.useEffect(() => {
    if (paused) return;
    const next = readScale();
    if (next != null) commit(next);
  }, [paused, readScale, commit]);

  return { ref, scale };
}

/**
 * 右下角那枚「1920×1080 · 52%」。
 *
 * 它是**可交互运行时**的自述——告诉你当前看到的是固定设计分辨率按容器
 * 等比缩下来的结果，而不是一张按屏幕宽度重排过的响应式页面。少了它，
 * 用户会把"字怎么这么小"当成设计问题去改，而那只是缩放。
 */
export function ScaleBadge({
  w,
  h,
  scale,
  testId,
}: {
  w: number;
  h: number;
  scale: number;
  testId?: string;
}): React.ReactElement {
  return (
    <span
      className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] text-white/90"
      title={`固定 ${w}×${h} 设计分辨率，按容器等比缩放显示`}
      data-testid={testId}
    >
      {w}×{h} · {Math.round(scale * 100)}%
    </span>
  );
}
