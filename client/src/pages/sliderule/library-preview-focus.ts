import React from "react";
import { findScrollParent } from "@/pages/agent-loop/dashboard/useScrollerIn";

/**
 * 组件库预览墙抢焦点 → 整页被滚到底。
 *
 * 2026-08-19 真机：`.native-content.scrollTop` 停在 1721，焦点在
 * RecordForm 的 `#name`。两版修法都没打住——
 *
 *   1) 守卫挂在页面的 useLayoutEffect 里。ProForm 默认
 *      `autoFocusFirstInput`，render 时 clone 出带 autofocus 的 input，
 *      浏览器在 commit 插入节点时就聚焦，**早于**父级 layout effect。
 *   2) 即便赶上了 focusin，上一版把「此刻的 scrollTop」存下来再写回去。
 *      浏览器先滚到输入框（已经是 1721），守卫再「恢复」1721，等于没拦。
 *
 * 现在：document 捕获在**子树 render 之前**挂上；程序化焦点一律回到
 * 用户上次自己滚到的位置（开局是 0）。人手点过的输入框不拦。
 */
export const PREVIEW_WALL_FOCUS_GUARD =
  '[data-testid="components-wall"], [data-testid="base-wall"]';

const LibraryPreviewContext = React.createContext(false);

export function useLibraryPreview(): boolean {
  return React.useContext(LibraryPreviewContext);
}

export function shouldSuppressPreviewAutofocus(
  fromPointer: boolean,
  target: { closest?: (selector: string) => unknown }
): boolean {
  if (fromPointer) return false;
  if (typeof target.closest !== "function") return false;
  return Boolean(target.closest(PREVIEW_WALL_FOCUS_GUARD));
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  return (
    findScrollParent(el) ??
    document.querySelector<HTMLElement>(".native-content")
  );
}

const USER_SCROLL_KEYS = new Set([
  "PageDown",
  "PageUp",
  "Home",
  "End",
  "ArrowDown",
  "ArrowUp",
  " ",
  "Spacebar",
]);

export function attachPreviewFocusGuard(root: ParentNode): () => void {
  let fromPointer = false;
  let lastUserScrollTop = 0;
  let locking = false;
  /** 只有人手滚过，才更新 lastUserScrollTop。autofocus 引发的 scroll 不算。 */
  let userScrollIntent = false;
  let intentTimer: ReturnType<typeof setTimeout> | undefined;

  const markPointer = () => {
    fromPointer = true;
  };
  const clearPointer = () => {
    fromPointer = false;
  };
  const markUserScroll = () => {
    userScrollIntent = true;
    if (intentTimer !== undefined) clearTimeout(intentTimer);
    intentTimer = setTimeout(() => {
      userScrollIntent = false;
      intentTimer = undefined;
    }, 160);
  };
  const onPointerDown = (event: Event) => {
    markPointer();
    // 点滚动条时 target 就是容器自己；点卡片不算用户滚。
    const t = event.target;
    if (t instanceof HTMLElement && t.classList.contains("native-content")) {
      markUserScroll();
    }
  };
  const onKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (USER_SCROLL_KEYS.has(event.key)) markUserScroll();
  };
  const onScroll = (event: Event) => {
    if (locking) return;
    // ⚠ 2026-08-19 第二版：focusin 里先存「此刻 scrollTop」再写回去。
    // 浏览器为抢焦点滚进视野（真机 1721）发生在 focusin 之前，存下来的
    // 已经是跳完的位置，守卫等于没拦。
    if (!userScrollIntent) return;
    const t = event.target;
    if (t instanceof HTMLElement && t.scrollTop !== undefined) {
      lastUserScrollTop = t.scrollTop;
    }
  };
  const restore = (scroller: HTMLElement | null) => {
    if (scroller) scroller.scrollTop = lastUserScrollTop;
  };
  const onFocusIn = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!shouldSuppressPreviewAutofocus(fromPointer, target)) return;
    const scroller = scrollerOf(target);
    locking = true;
    target.blur();
    restore(scroller);
    // 有的浏览器在 focusin 之后才做完 scroll-into-view，再补一帧。
    requestAnimationFrame(() => {
      restore(scroller);
      locking = false;
    });
  };

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("pointerup", clearPointer, true);
  root.addEventListener("pointercancel", clearPointer, true);
  root.addEventListener("wheel", markUserScroll, { capture: true, passive: true });
  root.addEventListener("touchmove", markUserScroll, { capture: true, passive: true });
  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("scroll", onScroll, true);
  root.addEventListener("focusin", onFocusIn, true);
  return () => {
    if (intentTimer !== undefined) clearTimeout(intentTimer);
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("pointerup", clearPointer, true);
    root.removeEventListener("pointercancel", clearPointer, true);
    root.removeEventListener("wheel", markUserScroll, true);
    root.removeEventListener("touchmove", markUserScroll, true);
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("scroll", onScroll, true);
    root.removeEventListener("focusin", onFocusIn, true);
  };
}

let guardHolds = 0;
let stopDocumentGuard: (() => void) | null = null;

/** 引用计数：Strict Mode 卸挂再挂不会把别人的监听摘掉。 */
export function holdPreviewFocusGuard(): () => void {
  if (guardHolds === 0 && typeof document !== "undefined") {
    stopDocumentGuard = attachPreviewFocusGuard(document);
  }
  guardHolds += 1;
  return () => {
    guardHolds = Math.max(0, guardHolds - 1);
    if (guardHolds === 0) {
      stopDocumentGuard?.();
      stopDocumentGuard = null;
    }
  };
}

/**
 * 预览范围：第一帧 render 就挂 document 捕获（赶在子树 commit 的 autofocus 前），
 * 并让墙里的 ProForm 读到「现在是预览，别 autoFocusFirstInput」。
 */
export function LibraryPreviewScope({ children }: { children: React.ReactNode }) {
  const releaseRef = React.useRef<(() => void) | null>(null);
  if (releaseRef.current === null && typeof document !== "undefined") {
    releaseRef.current = holdPreviewFocusGuard();
  }
  React.useLayoutEffect(() => {
    return () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, []);
  return React.createElement(
    LibraryPreviewContext.Provider,
    { value: true },
    children
  );
}
