/**
 * 刀 1 的接线：把块矩形量测挂到画板上（2026-08-27）。
 *
 * `block-rects.ts` 是纯的、判据齐的；这个文件负责让它**真的被调用到**。
 * CLAUDE.md 第一条：函数写对了 ≠ 它被调用了。所以另有一条源码级判据
 * （`block-rects-reaches-the-live-path.test.ts`）钉着 ArtboardNode 上的挂载点。
 *
 * ## 量测时机
 *
 * 挂在 `HtmlAppSurface` 的 `onReport` 上——它在 `applyBindings` 的下一行触发
 * （html-app-surface.tsx，"填数必须在写进框之后"那段）。早一步量，表格块的
 * 高度是模板行的高度。
 *
 * ## ⚠ onReport 是**一次性**的，而且可能发在布局之前（2026-08-27 真机）
 *
 * 只挂 onReport 会漏，实测漏在第一块画板上。html-app-surface 那边是：
 *
 *     frame.addEventListener("load", onLoad);
 *     frame.srcdoc = doc;
 *     onLoad();            // ← 同步先叫一次
 *
 * `onLoad` 里有个 `wired` 闭包标志，**成功一次就不再响应后续 load**。
 * 五块画板里第一块的同步那次抢在内容落定前通过了守卫，于是它的 onReport
 * 一辈子只发这一次、且那一刻 body 里 `[data-block]` 是 0 个；另外四块的
 * 同步那次没通过，等真正的 load 才做事，所以量到了 3/6/3/7 块。
 *
 * 真机表现：五块画板里**恰好当前选中的那一块**没有块框，其余四块都对。
 * 而块框只画在选中的那块上，所以看起来是"一个框都没有"。不报错、不告警，
 * 单测 20 条全绿。
 *
 * 所以量测**不依赖宿主的那一次回调**：自己监听 iframe 的 `load`，文档一换
 * 就把观察者重新挂到新文档上。onReport 仍然接着（它是最早的一次机会），
 * 但只当作众多触发源之一，不当作唯一的。
 *
 * ## ⚠ 观察者必须挂在**当前**文档上
 *
 * 上一版把 ResizeObserver 挂在 effect 跑那一刻的 `doc.documentElement` 上。
 * srcdoc 之后文档被换掉，观察的是旧的那棵树——永远不会再触发。这跟上面
 * 那条是同一个根因的两半。
 *
 * ## 布局还会再变一次
 *
 * Tailwind Play 扫完 DOM 之后还会往 head 补注一层 utility（同一份头注里
 * "刚铺满，过一秒又缩回屏幕中间一张卡片"那段记的就是这件事）。也就是说
 * onReport 那一刻量到的矩形**可能还会再变一次**，而且不报错。
 *
 * 所以除了 onReport，还挂一个 ResizeObserver 在 iframe 的 documentElement 上：
 * 布局再动就推进 layoutEpoch，几何世代号跟着变，下一帧重量。这正是两条
 * 世代号里 `layoutEpoch` 那一项的来源。
 *
 * ## ⚠ fail-open
 *
 * 量不到（iframe 还没挂、跨源、ResizeObserver 不存在）一律**如实回空快照**，
 * 不抛、不重试、不猜一个矩形。块矩形是画布上的增强，不是闭环证据——炸了
 * 只该少一层框，不许拖垮画板本身（纪律七）。
 */

import * as React from "react";

import {
  EMPTY_BLOCK_RECTS,
  deriveGenerations,
  measureBlockRects,
  shouldAdoptSnapshot,
  type BlockRectSnapshot,
} from "./block-rects";

export interface UseBlockRectsResult {
  snapshot: BlockRectSnapshot;
  /** 内容世代号：刀 4 的绑定索引拿它当失效键（**不是**几何世代号）。 */
  contentGeneration: number;
  /** 交给 `HtmlAppSurface.onReport`。 */
  onSurfaceReport: () => void;
}

/**
 * 量这一块画板上所有块的矩形。
 *
 * @param hostRef 画板最外层的 div。iframe 在它里面（跟 pickElementAtPoint
 *                找 iframe 的走法一致——**不另写一套**）。
 * @param html    这一页的源 HTML。内容世代号只跟它走。
 * @param nodeSize 画板节点尺寸（设计分辨率原值，不含 React Flow 的 zoom）。
 * @param enabled 没挂载（还没进视口）时传 false：不量、不装观察者。
 */
export function useBlockRects(
  hostRef: React.RefObject<HTMLElement | null>,
  pageId: string,
  html: string,
  nodeSize: { width: number; height: number },
  enabled: boolean
): UseBlockRectsResult {
  const [snapshot, setSnapshot] =
    React.useState<BlockRectSnapshot>(EMPTY_BLOCK_RECTS);
  const [layoutEpoch, setLayoutEpoch] = React.useState(0);

  const { contentGeneration, geometryGeneration } = React.useMemo(
    () => deriveGenerations({ html, layoutEpoch }),
    [html, layoutEpoch]
  );

  /* 尺寸进 ref 而不是进 measure 的依赖：nodeSize 每次渲染都是新对象字面量，
     进依赖数组会让 measure 每帧换一个身份，ResizeObserver 跟着反复装拆。 */
  const nodeSizeRef = React.useRef(nodeSize);
  nodeSizeRef.current = nodeSize;
  const genRef = React.useRef(geometryGeneration);
  genRef.current = geometryGeneration;

  const measure = React.useCallback(() => {
    const frame = hostRef.current?.querySelector("iframe");
    if (!frame) return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return; // 跨源。srcdoc 同源，理论上到不了这儿。
    }
    if (!doc?.body) return;
    /* ⚠ 文档尺寸取 documentElement.clientWidth，节点尺寸取设计分辨率原值。
       这两个口径必须跟 pickElementAtPoint 一模一样，否则同一块的"高亮框"
       和"块框"会差一个比例，看着像抖。那边头注记着"缩两次"的真机账。 */
    const docSize = {
      width: doc.documentElement.clientWidth || frame.clientWidth,
      height: doc.documentElement.clientHeight || frame.clientHeight,
    };
    if (!(docSize.width > 0) || !(docSize.height > 0)) return;
    const next = measureBlockRects(
      doc.body,
      docSize,
      nodeSizeRef.current,
      genRef.current
    );
    /* ⚠ 用 shouldAdoptSnapshot，**不是** isBlockRectsStale——后者会把同一
       世代号下第二次（内容才落定）量到的正确结果丢掉。见那个函数的头注，
       2026-08-27 真机抓的。 */
    setSnapshot(prev => (shouldAdoptSnapshot(prev, next) ? next : prev));
  }, [hostRef, pageId]);

  /* 世代号变了（内容变了、或布局纪元推进了）就重量。 */
  React.useEffect(() => {
    if (!enabled) return;
    measure();
  }, [enabled, measure, geometryGeneration]);

  /*
   * 触发源接线。⚠ 三条一条都不能省，各自堵一种漏法：
   *
   *   load        —— iframe 换文档。宿主的 onReport 是一次性的，指望不上（见头注）
   *   MutationObserver —— applyBindings 往表格里克隆行；行是那时候才有的
   *   ResizeObserver   —— Tailwind Play 补注 utility 之后的二次回流
   *
   * 三条都汇到 schedule()：一帧最多量一次，别在克隆几十行的时候量几十遍。
   */
  React.useEffect(() => {
    if (!enabled) return;
    const frame = hostRef.current?.querySelector("iframe");
    if (!frame) return;

    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let raf = 0;
    let disposed = false;

    const schedule = () => {
      if (disposed) return;
      if (typeof requestAnimationFrame === "undefined") {
        measure();
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measure());
    };

    /**
     * 把观察者接到**当前**文档上。文档换过就重接。接上了回 true。
     *
     * ⚠ 接不上要**重试**，不能就地放弃（2026-08-27 真机第二个坑）。
     *   React 的 effect 是**子先于父**跑的：HtmlAppSurface（子）那一步已经
     *   把 srcdoc 赋完、`load` 也发过了，我们（父）这时候才挂监听，那一发
     *   永远等不到；而此刻 `doc.body` 往往还是空的，一 return 就再也没有
     *   第二次机会。表现跟上一个坑一模一样：**恰好第一块画板**没有块框。
     */
    const attachToDoc = (): boolean => {
      if (disposed) return true; // 已拆，不必再试
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        return true; // 跨源，fail-open，别空转重试
      }
      /*
       * ⚠ 判成功的条件是「body **有内容**」，不是「body 存在」
       *   （2026-08-27 真机第三个坑，也是同一个根因的最后一半）。
       *
       *   iframe 在 srcdoc 写进去之前就有一个 about:blank 的空 body。拿
       *   "body 存在" 当接上了，会把 MutationObserver 挂到那个**马上要被
       *   整体替换掉**的 body 上——文档一换，观察的那棵树就成了孤儿，
       *   之后 applyBindings 往新 body 里克隆多少行都不会有一次回调。
       *
       *   真机日志长这样：`attach: body= true children= 0`，然后再无下文。
       *   表现依旧是第一块画板没有块框，其余四块正常。
       */
      if (!doc?.body?.childNodes.length) return false;
      ro?.disconnect();
      mo?.disconnect();
      ro = null;
      mo = null;

      if (typeof ResizeObserver !== "undefined") {
        let first = true;
        ro = new ResizeObserver(() => {
          /* 装上去那一发是 ResizeObserver 的既定行为，不算"布局变了"。 */
          if (first) {
            first = false;
            return;
          }
          setLayoutEpoch(e => e + 1);
        });
        ro.observe(doc.documentElement);
      }
      if (typeof MutationObserver !== "undefined") {
        /* ⚠ 只观察 childList/subtree，**不看属性**：applyBindings 会往几乎
           每个元素上写属性，看属性等于每次绑定刷出上千次回调。行的增减
           （矩形真正会变的那件事）childList 就够了。 */
        mo = new MutationObserver(schedule);
        mo.observe(doc.body, { childList: true, subtree: true });
      }
      schedule();
      return true;
    };

    /* 有界重试：约 4 秒内每 100ms 试一次。⚠ 有界是关键——够不着就如实
       不画框（纪律七 fail-open），不许无限空转把标签页烧着。 */
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryAttach = () => {
      if (disposed) return;
      if (attachToDoc()) return;
      tries += 1;
      if (tries > 40) return;
      timer = setTimeout(tryAttach, 100);
    };

    const onFrameLoad = () => {
      tries = 0; // 换了新文档，重试预算也重置
      tryAttach();
    };
    frame.addEventListener("load", onFrameLoad);
    tryAttach(); // 文档已经在了就直接接上（那一次 load 可能已经错过了）

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      frame.removeEventListener("load", onFrameLoad);
      ro?.disconnect();
      mo?.disconnect();
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(raf);
    };
  }, [enabled, hostRef, html, measure, pageId]);

  return { snapshot, contentGeneration, onSurfaceReport: measure };
}
