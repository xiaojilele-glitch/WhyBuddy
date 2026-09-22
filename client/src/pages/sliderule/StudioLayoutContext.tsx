/**
 * 对话/舞台折叠的命令中心。顶栏图标簇和分隔条折钮共用这一份。
 *
 * 状态不能只活在 StudioSplit 里：图标簇挂在舞台头条右侧，
 * 跟分隔条折钮不在同一棵子树，靠这份 context 共用折叠态。
 */
import React from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  canCollapsePart,
  maximizeIntent,
  nextStagePageHidden,
  type StudioCollapsed,
  type StudioWorkbenchMode,
} from "./studio-layout";

export type StudioLayoutApi = {
  available: boolean;
  collapsed: StudioCollapsed;
  /** 整块预览页不渲染。跟 collapsed.stage（改宽度）不是一回事。 */
  stagePageHidden: boolean;
  /**
   * 正在拖分栏缝。舞台里的同源 iframe 是按 1920×1080 画的整页，
   * 拖的时候每帧 ResizeObserver → setScale 会把拖条拖成一卡一卡。
   * 对照：VS Code sash-dragging 期间 iframe { pointer-events:none }，
   * Gutenberg ScaledBlockPreview 拖时不重算缩放，松手再量一次。
   */
  resizing: boolean;
  chatRef: React.RefObject<ImperativePanelHandle | null>;
  stageRef: React.RefObject<ImperativePanelHandle | null>;
  splitElRef: React.RefObject<HTMLDivElement | null>;
  setChatCollapsed: (next: boolean) => void;
  setStageCollapsed: (next: boolean) => void;
  setResizing: (next: boolean) => void;
  toggleChat: () => void;
  toggleStage: () => void;
  toggleStagePage: () => void;
  toggleMaximize: () => void;
  /**
   * 舞台钉死在最大化（画布档）。锁住时对话栏一直是折的，五个掰开它的口子
   * （顶栏钮 / 分隔条折钮 / 拖分隔条 / 双击还原 / 隐藏页面再显示）全部失效。
   */
  maximizeLocked: boolean;
  setMaximizeLocked: (next: boolean) => void;
  /**
   * 推演进行中。对照 v0 / bolt：生成时锁死对话+页面分栏。
   * 顶栏分段控件置灰，缝上折对话 / 隐藏页面也不许动。
   */
  layoutLocked: boolean;
  /**
   * 互斥切布局档。顶栏 分栏|全屏|画布 走这一口，不走三颗独立开关。
   * 画布进出靠 Studio 注册的 sink 改 stageView——context 看不见舞台档位。
   */
  applyWorkbenchMode: (next: StudioWorkbenchMode) => void;
  /**
   * Studio 把自己的 setStageView 接进来。顶栏切「画布」时 context 只能
   * 改折叠态，舞台渲染在 Studio 里。
   *
   * ⚠ 不用自定义事件、不把 stageView 抬到 SlideRule：那是另一条双源。
   *   sink 为空时（单测没挂 Studio）只改 maximizeLocked，picker 仍能显示。
   */
  registerCanvasSink: (sink: ((on: boolean) => void) | null) => void;
  /** 展开两侧、显示预览页、对话栏回到侧栏×2。拖过之后的一键还原。 */
  resetLayout: () => void;
  /** resetLayout 每按一次 +1。分栏可能被卸掉（藏预览页），要等重新挂上再 resize。 */
  layoutGeneration: number;
};

const StudioLayoutContext = React.createContext<StudioLayoutApi | null>(null);

export function StudioLayoutProvider({
  available,
  layoutLocked = false,
  children,
}: {
  available: boolean;
  /** 推演进行中：锁死分栏。从 SlideRule 的 isRunning 灌进来。 */
  layoutLocked?: boolean;
  children: React.ReactNode;
}) {
  const chatRef = React.useRef<ImperativePanelHandle>(null);
  const stageRef = React.useRef<ImperativePanelHandle>(null);
  const splitElRef = React.useRef<HTMLDivElement | null>(null);
  const [chatCollapsed, setChatCollapsed] = React.useState(false);
  const [stageCollapsed, setStageCollapsed] = React.useState(false);
  const [stagePageHidden, setStagePageHidden] = React.useState(false);
  const [resizing, setResizing] = React.useState(false);
  const [layoutGeneration, setLayoutGeneration] = React.useState(0);
  /**
   * ⚠ 2026-09-16 真机手机预览：react-resizable-panels 的 onDragging(true)
   * 之后如果 pointerup 丢了（触摸取消、DevTools 设备模式），
   * `data-studio-resizing` 会一直 true，dashboard.css 把 iframe
   * `pointer-events:none`——右侧应用看得一清二楚，点什么都没反应。
   * 松手/失焦/pointercancel 必须收回，不能只听库的 onDragging(false)。
   */
  React.useEffect(() => {
    if (!resizing) return;
    const stop = () => setResizing(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [resizing]);
  const [maximizeLocked, setMaximizeLocked] = React.useState(false);
  const collapsed = { chat: chatCollapsed, stage: stageCollapsed };

  /**
   * 上锁前对话栏是不是折的。解锁（离开画布档）要还原到用户自己的选择——
   * 本来就最大化着的人，退出画布不该被强行展开对话栏。
   */
  const beforeLockRef = React.useRef<boolean | null>(null);
  const layoutLockedRef = React.useRef(layoutLocked);
  layoutLockedRef.current = layoutLocked;
  const canvasSinkRef = React.useRef<((on: boolean) => void) | null>(null);

  const registerCanvasSink = React.useCallback(
    (sink: ((on: boolean) => void) | null) => {
      canvasSinkRef.current = sink;
    },
    []
  );

  /*
   * ⚠ 锁的**执行**不在这里，在 StudioSplit（2026-08-25 真机改的）。
   *
   *   第一版把 `chatRef.current?.collapse()` 的兜底 effect 放在这个 Provider 上，
   *   真机首屏**一次都没执行**：Provider 的 effect 第一次以 locked=true 跑时
   *   StudioSplit 还没挂载（画布要等页面数据到），chatRef.current 是 null，
   *   之后依赖不再变化就永远没有第二次。切档进画布反而是好的——那时
   *   分栏早挂上了。症状：钮已置灰（锁是 on 的）、对话栏却还占着半屏，
   *   看着像"锁写了但不生效"。
   *
   *   这跟仓里那条「修点选编辑整个选不中：挂监听器绑死在一个不会来的
   *   load 事件上」是同一个形状：**effect 在 ref 还没到位时跑了一次就再也不跑**。
   *   执行必须放在**拥有那个 ref 的组件**里——StudioSplit 自己的 effect 跑时
   *   Panel 必然已经挂上。判定仍在 studio-layout.needsMaximizeLockFix，
   *   只有一份。
   */

  /** 上锁记住原样、解锁还原回去。 */
  React.useEffect(() => {
    if (maximizeLocked) {
      if (beforeLockRef.current === null) {
        beforeLockRef.current = chatRef.current?.isCollapsed() ?? chatCollapsed;
      }
      return;
    }
    const before = beforeLockRef.current;
    beforeLockRef.current = null;
    // 上锁前本来就是折的 → 保持折着，不替用户做主展开。
    if (before === false) chatRef.current?.expand();
  }, [maximizeLocked]);

  React.useEffect(() => {
    if (available) return;
    setChatCollapsed(false);
    setStageCollapsed(false);
    setStagePageHidden(false);
    setResizing(false);
  }, [available]);

  const toggleStagePage = React.useCallback(() => {
    // 推演中锁死分栏：隐藏页面会把正在生成的舞台卸掉。
    if (layoutLockedRef.current) return;
    // 只翻显隐。collapse/expand 是改宽度，这里不许碰。
    setStagePageHidden(prev => nextStagePageHidden(prev));
    // ⚠ 第 5 个口子：这行以前无条件把对话栏展开。锁住时不许动，
    //   否则"隐藏页面→显示页面"走一圈就把最大化掰开了。
    if (!maximizeLocked) setChatCollapsed(false);
    setStageCollapsed(false);
  }, [maximizeLocked]);

  const toggleChat = React.useCallback(() => {
    const panel = chatRef.current;
    if (!panel) return;
    if (layoutLockedRef.current) return; // 推演中对话必须可见
    if (maximizeLocked) return; // 画布档钉死最大化
    if (panel.isCollapsed()) panel.expand();
    else if (
      canCollapsePart("chat", {
        chat: panel.isCollapsed(),
        stage: stageCollapsed,
      })
    ) {
      panel.collapse();
    }
  }, [stageCollapsed, maximizeLocked]);

  const toggleStage = React.useCallback(() => {
    const panel = stageRef.current;
    if (!panel) return;
    if (layoutLockedRef.current) return;
    if (panel.isCollapsed()) panel.expand();
    else if (
      canCollapsePart("stage", {
        chat: chatCollapsed,
        stage: panel.isCollapsed(),
      })
    ) {
      panel.collapse();
    }
  }, [chatCollapsed]);

  const toggleMaximize = React.useCallback(() => {
    const chat = chatRef.current;
    if (!chat) return;
    if (layoutLockedRef.current) return;
    const intent = maximizeIntent(
      { chat: chat.isCollapsed(), stage: stageCollapsed },
      maximizeLocked
    );
    if (intent === "maximize") chat.collapse();
    else if (intent === "restore") chat.expand();
    // "locked" / "noop" 什么都不做——按钮那边已经置灰并说明了原因。
  }, [stageCollapsed, maximizeLocked]);

  const applyWorkbenchMode = React.useCallback((next: StudioWorkbenchMode) => {
    // 推演中只许落到分栏（force-split effect 走这一口，其它档直接 return）。
    if (layoutLockedRef.current && next !== "split") return;
    setStagePageHidden(false);
    setStageCollapsed(false);
    stageRef.current?.expand();
    if (next === "canvas") {
      canvasSinkRef.current?.(true);
      setMaximizeLocked(true);
      return;
    }
    canvasSinkRef.current?.(false);
    if (next === "stage") {
      // 离开画布时 unlock effect 会按 beforeLockRef 决定是否展开。
      // 全屏要对话继续折着，所以先写成「上锁前就是折的」。
      beforeLockRef.current = true;
      setMaximizeLocked(false);
      chatRef.current?.collapse();
      return;
    }
    beforeLockRef.current = false;
    setMaximizeLocked(false);
    chatRef.current?.expand();
  }, []);

  /*
   * 推演中若页面被藏着，先挂回来。真正 expand 对话栏的执行在
   * StudioSplit（chatRef 在那儿才有值，2026-08-25 已经踩过一次）。
   */
  React.useLayoutEffect(() => {
    if (layoutLocked && stagePageHidden) setStagePageHidden(false);
  }, [layoutLocked, stagePageHidden]);

  const resetLayout = React.useCallback(() => {
    // 隐藏页面 / 最大化都算布局偏离。分栏可能此刻不在树上
    // （藏了预览页），只翻状态 + 代数；真正 resize 在 StudioSplit 里做。
    setStagePageHidden(false);
    // ⚠ 锁住时"还原默认分栏"只还原舞台与页面显隐，**不展开对话栏**。
    //   双击分隔条是第 4 个掰开最大化的口子，漏了它锁就是半个。
    if (!maximizeLocked) setChatCollapsed(false);
    setStageCollapsed(false);
    setLayoutGeneration(n => n + 1);
  }, [maximizeLocked]);

  const value = React.useMemo<StudioLayoutApi>(
    () => ({
      available,
      collapsed,
      stagePageHidden,
      resizing,
      chatRef,
      stageRef,
      splitElRef,
      setChatCollapsed,
      setStageCollapsed,
      setResizing,
      toggleChat,
      toggleStage,
      toggleStagePage,
      toggleMaximize,
      maximizeLocked,
      setMaximizeLocked,
      layoutLocked,
      applyWorkbenchMode,
      registerCanvasSink,
      resetLayout,
      layoutGeneration,
    }),
    [
      available,
      chatCollapsed,
      stageCollapsed,
      stagePageHidden,
      resizing,
      toggleChat,
      toggleStage,
      toggleStagePage,
      toggleMaximize,
      maximizeLocked,
      layoutLocked,
      applyWorkbenchMode,
      registerCanvasSink,
      resetLayout,
      layoutGeneration,
    ]
  );

  return (
    <StudioLayoutContext.Provider value={value}>
      {children}
    </StudioLayoutContext.Provider>
  );
}

export function useStudioLayout(): StudioLayoutApi | null {
  return React.useContext(StudioLayoutContext);
}
