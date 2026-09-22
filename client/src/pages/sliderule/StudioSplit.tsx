/**
 * 对话栏 / 舞台之间的分隔：可左右拖、可折叠。
 *
 * 2026-08-18 之前是写死 38% / 62% 一条发丝线。用户要 Cursor 那种
 * 能拖宽窄、能折掉一侧的分隔——固定比例在真机上要么对话挤、要么图看不清。
 *
 * 2026-08-20 City Walk：默认不再是 38/62。对话栏默认 = 左侧菜单宽度 ×2
 * （见 studio-layout.studioChatDefaultPercent）。拖过的比例经 autoSaveId
 * 记住；顶栏「重置布局」和缝上双击走同一条 resetLayout。
 *
 * 同日晚：手机预览对调——舞台列 = 菜单×2 且缝不可拖（contain 会把
 * 390×844 放到 110%）。桌面仍可拖，autoSaveId 互不覆盖。
 * 两侧不能同时折没：折一个时另一个的折钮禁用，否则整页只剩一条缝。
 *
 * 缝本身占 1px 布局（hover 热区用 after 加宽，不把缝画成 6px 槽）。
 *
 * 2026-08-20：GitHub Primer 分栏的标准答案是 1px muted 线，不是投影。
 * primer/css PageLayout → border: $border-width solid $Layout-divider-color
 * primer primitives --borderColor-muted = #d1d9e0b3（半透明，比实心 #e5e7eb 软）
 * Primer box-shadow 文档写明投影只给 overlay / 浮层，不分栏区域。
 * VS Code sash.css 也是静止透明、hover 才显色——可拖的那条缝同样不画阴影。
 * 上一版 20px 向右渐变在真机上像刀口，比发丝线更尖锐。
 *
 * 缝上的右箭头跟顶栏一样：隐藏整块预览页，不是把舞台宽度收成 0。
 *
 * 2026-08-20：生成完应用后拖这条缝会卡。不是缝本身（已经是
 * react-resizable-panels，库在拖时给 Panel 加 pointer-events:none），
 * 是舞台同源 iframe 按 1920×1080 整页缩放——ResizeObserver 每帧
 * setScale 会把 React 提交和 iframe 合成拖成一顿一顿。
 * 对照 bvaughn/react-resizable-panels#64、VS Code sash-dragging、
 * Gutenberg ScaledBlockPreview：拖的时候冻结缩放、iframe 不接指针，
 * 松手再量一次。onDragging 是 v3 公开的口。
 */
import React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStudioLayout } from "./StudioLayoutContext";
import {
  STUDIO_CHAT_MAX_PERCENT,
  STUDIO_CHAT_MIN_PERCENT,
  guessStudioSplitWidthPx,
  isPhoneStudioDevice,
  studioChatDefaultPercent,
  studioChatDefaultPx,
  studioPhoneChatDefaultPercent,
  studioPhoneStageDefaultPercent,
  studioPhoneStageDefaultPx,
  studioStageDefaultPercent,
  needsMaximizeLockFix,
  needsEmptySessionRestore,
  needsRunningSplitFix,
  resolveWorkbenchMode,
} from "./studio-layout";

function splitDefaults(device?: "desktop" | "phone" | "tablet") {
  const splitPx =
    typeof window !== "undefined"
      ? guessStudioSplitWidthPx(window.innerWidth)
      : 0;
  if (isPhoneStudioDevice(device)) {
    return {
      chat: studioPhoneChatDefaultPercent(splitPx),
      stage: studioPhoneStageDefaultPercent(splitPx),
    };
  }
  return {
    chat: studioChatDefaultPercent(splitPx),
    stage: studioStageDefaultPercent(splitPx),
  };
}

function SplitFallback({
  chat,
  stage,
  device,
}: {
  chat: React.ReactNode;
  stage: React.ReactNode;
  device?: "desktop" | "phone" | "tablet";
}) {
  const phone = isPhoneStudioDevice(device);
  return (
    <div className="flex h-full w-full" data-testid="sliderule-studio-split">
      <div
        className="min-h-0 min-w-0"
        style={{ flex: phone ? "1 1 0" : `0 1 ${studioChatDefaultPx()}px` }}
      >
        {chat}
      </div>
      <div className="w-px shrink-0 bg-[#d1d9e0b3]" aria-hidden />
      <div
        className="min-h-0 min-w-0"
        style={{
          flex: phone ? `0 0 ${studioPhoneStageDefaultPx()}px` : "1 1 0",
        }}
      >
        {stage}
      </div>
    </div>
  );
}

export function StudioSplit({
  chat,
  stage,
  device,
  sessionEmpty = false,
}: {
  chat: React.ReactNode;
  stage: React.ReactNode;
  device?: "desktop" | "phone" | "tablet";
  /** 会话里还没有任何轮次。空会话的舞台没东西可看，不许把作曲家折着。 */
  sessionEmpty?: boolean;
}) {
  const layout = useStudioLayout();
  if (!layout)
    return <SplitFallback chat={chat} stage={stage} device={device} />;
  return (
    <StudioSplitLive
      layout={layout}
      chat={chat}
      stage={stage}
      device={device}
      sessionEmpty={sessionEmpty}
    />
  );
}

function StudioSplitLive({
  layout,
  chat,
  stage,
  device,
  sessionEmpty = false,
}: {
  layout: NonNullable<ReturnType<typeof useStudioLayout>>;
  chat: React.ReactNode;
  stage: React.ReactNode;
  device?: "desktop" | "phone" | "tablet";
  sessionEmpty?: boolean;
}) {
  const {
    chatRef,
    stageRef,
    splitElRef,
    collapsed,
    setChatCollapsed,
    setStageCollapsed,
    toggleChat,
    toggleStagePage,
    resetLayout,
    layoutGeneration,
  } = layout;

  const phone = isPhoneStudioDevice(device);
  const defaults = splitDefaults(device);

  const applyDefaults = React.useCallback(() => {
    const chatPanel = chatRef.current;
    const stagePanel = stageRef.current;
    if (chatPanel?.isCollapsed()) chatPanel.expand();
    if (stagePanel?.isCollapsed()) stagePanel.expand();
    const splitPx =
      splitElRef.current?.clientWidth ||
      (typeof window !== "undefined"
        ? guessStudioSplitWidthPx(window.innerWidth)
        : 0);
    if (phone) {
      chatPanel?.resize(studioPhoneChatDefaultPercent(splitPx));
      stagePanel?.resize(studioPhoneStageDefaultPercent(splitPx));
      return;
    }
    chatPanel?.resize(studioChatDefaultPercent(splitPx));
    stagePanel?.resize(studioStageDefaultPercent(splitPx));
  }, [phone, chatRef, stageRef, splitElRef]);

  React.useEffect(() => {
    if (!layoutGeneration) return;
    applyDefaults();
  }, [layoutGeneration, applyDefaults]);

  /**
   * 画布档锁死最大化的**执行点**。
   *
   * ⚠ 必须在这里，不能在 StudioLayoutContext 里（2026-08-25 真机踩过，
   *   见那边的注释）：Provider 的 effect 首屏是在分栏挂载**之前**跑的，
   *   chatRef 还是 null，collapse 静静地没执行，而依赖不再变就没有第二次。
   *   这个组件自己的 effect 跑时 Panel 必然已挂上，ref 一定有值。
   *
   * ⚠ 判定用 needsMaximizeLockFix，别在这儿重写条件——同一件事两处实现，
   *   改一处忘一处就是半个锁。
   */
  React.useEffect(() => {
    if (layout.stagePageHidden) return; // 页面都藏了，没有舞台可最大化
    if (!needsMaximizeLockFix(collapsed, layout.maximizeLocked)) return;
    chatRef.current?.collapse();
  }, [
    layout.maximizeLocked,
    layout.stagePageHidden,
    collapsed.chat,
    collapsed.stage,
    chatRef,
  ]);

  /*
   * 空会话把对话栏还原开。
   *
   * ⚠ 2026-08-27 用户报的死角：舞台最大化后 layout=[0,100]，对话栏塌成 0%，
   *   作曲家只剩 18px。这个比例经 autoSaveId 存进 localStorage，点「新建会话」
   *   照样继承——新会话右侧只有一句「推演完成后这里是五系统接线沙盘」，
   *   左边又打不了字，刷新也回不来。真机复现（1500×950）：
   *     最大化后   composer w=18 input w=8
   *     新建会话后 composer w=18 input w=8   ← 继承了
   *
   * ⚠ 跟上面那条锁一样，执行必须在**拥有 chatRef 的组件**里：Provider 的
   *   effect 首屏跑在分栏挂载之前，ref 还是 null（2026-08-25 已经踩过一次）。
   *   判定用 needsEmptySessionRestore，别在这儿重写条件。
   */
  React.useEffect(() => {
    if (!needsEmptySessionRestore(collapsed, sessionEmpty, layout.maximizeLocked))
      return;
    chatRef.current?.expand();
  }, [sessionEmpty, collapsed.chat, layout.maximizeLocked, chatRef]);

  /**
   * 推演一开始把布局扳回分栏。
   *
   * ⚠ 必须在这里，不能在 Provider 里（跟 needsMaximizeLockFix 同一条）：
   *   Provider 首屏 chatRef 是 null，collapse/expand 静静地没执行。
   *   判定用 needsRunningSplitFix，已经是分栏就别反复 expand。
   */
  React.useLayoutEffect(() => {
    const mode = resolveWorkbenchMode({
      maximizeLocked: layout.maximizeLocked,
      collapsed,
      stagePageHidden: layout.stagePageHidden,
    });
    if (
      !needsRunningSplitFix(
        layout.layoutLocked,
        mode,
        layout.stagePageHidden
      )
    ) {
      return;
    }
    layout.applyWorkbenchMode("split");
  }, [
    layout.layoutLocked,
    layout.maximizeLocked,
    layout.stagePageHidden,
    collapsed.chat,
    collapsed.stage,
    layout.applyWorkbenchMode,
  ]);

  return (
    <div ref={splitElRef} className="h-full w-full min-h-0 min-w-0">
      <PanelGroup
        key={phone ? "phone" : "desktop"}
        direction="horizontal"
        autoSaveId={phone ? undefined : "sliderule-studio-split-v2"}
        className="h-full w-full"
        data-testid="sliderule-studio-split"
        data-split-locked={phone ? "phone" : undefined}
        data-studio-resizing={layout.resizing ? "true" : undefined}
      >
        <Panel
          id="sliderule-chat"
          ref={chatRef}
          defaultSize={defaults.chat}
          minSize={STUDIO_CHAT_MIN_PERCENT}
          maxSize={STUDIO_CHAT_MAX_PERCENT}
          collapsible
          collapsedSize={0}
          onCollapse={() => setChatCollapsed(true)}
          onExpand={() => setChatCollapsed(false)}
          className="min-h-0 min-w-0"
        >
          {chat}
        </Panel>

        <PanelResizeHandle
          data-testid="sliderule-studio-split-handle"
          /* 画布档锁死最大化时连拖都不许——第 3 个掰开它的口子。
             ⚠ 2026-09-16：after 热区向右伸进预览。鼠标 10px 没事，
             手指/设备模式会把 TicketStream 左侧导航吃掉——粗指针把
             热区收成 0，缝本身 1px 还在。 */
          disabled={phone || layout.maximizeLocked}
          className={`group relative z-20 flex w-px shrink-0 items-center justify-center bg-[#d1d9e0b3] outline-none after:absolute after:inset-y-0 after:-left-1 after:w-2.5 after:content-[''] [@media(pointer:coarse)]:after:w-0 ${
            phone
              ? "cursor-default"
              : "hover:bg-[#d1d9e0] data-[resize-handle-active]:bg-[#d1d9e0]"
          }`}
          onDragging={phone ? undefined : layout.setResizing}
          onDoubleClick={phone ? undefined : resetLayout}
          title={
            phone
              ? "手机预览宽度已锁定为菜单栏两倍"
              : "拖动调整宽度 · 双击恢复默认"
          }
        >
          <div
            className="relative z-10 flex flex-col gap-px rounded-md border border-[#e5e7eb] bg-white p-px opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[resize-handle-active]:opacity-100"
            onPointerDown={event => event.stopPropagation()}
          >
            <button
              type="button"
              data-testid="sliderule-studio-split-toggle-chat"
              aria-label={collapsed.chat ? "展开对话" : "折叠对话"}
              disabled={
                collapsed.stage ||
                layout.maximizeLocked ||
                layout.layoutLocked
              }
              onClick={toggleChat}
              className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5] disabled:opacity-30"
            >
              {collapsed.chat ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              data-testid="sliderule-studio-split-toggle-stage"
              aria-label="隐藏页面"
              disabled={layout.layoutLocked}
              onClick={toggleStagePage}
              className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5] disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </PanelResizeHandle>

        <Panel
          id="sliderule-stage"
          ref={stageRef}
          defaultSize={defaults.stage}
          minSize={24}
          collapsible
          collapsedSize={0}
          onCollapse={() => setStageCollapsed(true)}
          onExpand={() => setStageCollapsed(false)}
          className="min-h-0 min-w-0"
        >
          {stage}
        </Panel>
      </PanelGroup>
    </div>
  );
}
