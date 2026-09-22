/**
 * Product surface palette — neutral cool skin（换肤 D，用户裁决）:
 * cool-gray page (#f7f8fa base, #eef0f4 wells), cool ink text (#1f2329),
 * single blue accent (#1677ff, hover #0958d9, tint #e6f4ff),
 * neutral borders (#e5e7eb). Success/danger stay green/red.
 * 暖色降级为点缀：只保留品牌 logo（用户块 2026-08-18 改成 Cursor 灰底 #f3f4f6）
 * ——暖米色铺满全屏
 * 是 Claude 聊天产品的强联想；冷调更像独立的推演引擎，也与运行应用画布
 * （antd 蓝系）、技能库页面统一。
 */
export const autopilotTheme = {
  /** Full-screen canvas host — graph under floating HUD layers. */
  /* 纯平底色：与左右面板同底，底部指令条区域不再出现渐变异色带（用户反馈）。
   *
   * 2026-08-07：由写死的 #f7f8fa 改成读外壳 token --sr-shell-bg。
   * 缘由——2026-08-03 应用中心的底色被裁决改成白（dashboard.css 的
   * .native-agent-shell），而会话页这条留在冷灰 #f7f8fa 上没跟着动，
   * 于是两页切换看得出色差（用户反馈："背景颜色不一致，会话页面背景
   * 不是白色的"）。现在两边同一个 token，改一处即整壳生效。
   *
   * 回落值给 #ffffff 而不是 #f7f8fa：这个 class 只被
   * SlideRule.tsx:1151 一处用，而那处必然渲染在外壳内（token 有定义）；
   * 回落只在极端情况下生效，届时与应用中心一致比与旧值一致更重要。 */
  immersionPage:
    "relative h-screen w-screen overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)] text-[#1f2329]",
  immersionCanvas: "absolute inset-0 z-0",
  immersionOverlayTop:
    "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-2 pt-2 sm:gap-2.5 sm:px-3 sm:pt-2",
  immersionOverlayHeader: "pointer-events-auto w-full",
  /** 架构树节拍 — 顶栏下方、右对齐，预留顶栏右侧放 Dev / 导出等操作 */
  immersionOverlayArchRow: "pointer-events-none flex w-full justify-end",
  immersionHudLeft: "pointer-events-auto flex min-w-0 flex-1 flex-col gap-1.5",
  immersionHudRight:
    "pointer-events-auto w-[min(100%,600px)] shrink-0 sm:w-[min(52vw,560px)] lg:w-[min(48vw,600px)]",
  overlayTransparent: "bg-transparent",
  overlayBar:
    "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-0 py-1 text-[11px] text-stone-700",
  immersionOverlayBottom:
    "pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-1 sm:px-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]",
  glassPanel:
    "pointer-events-auto max-h-[min(70vh,520px)] w-[min(100%,340px)] overflow-hidden rounded-lg border border-[#e8eaee]/80 bg-[#ffffff]/80 px-3 py-3 shadow-[0_8px_32px_rgb(15_23_42/0.10)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  glassPanelWide:
    "pointer-events-auto max-w-[min(100%,560px)] rounded-lg border border-[#e8eaee]/80 bg-[#ffffff]/80 px-3 py-3 shadow-[0_8px_32px_rgb(15_23_42/0.10)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  composerDock:
    "rounded-lg border border-[#e8eaee]/90 bg-[#ffffff]/90 px-3 py-3 shadow-[0_12px_40px_rgb(15_23_42/0.12)] backdrop-blur-2xl sm:px-4",
  composerDockWidth: "w-full max-w-[min(100%,760px)]",

  page: "relative flex h-screen flex-col bg-[#eef0f4] text-[#1f2329]",
  header:
    "flex items-center justify-between border-b border-[#e5e7eb] bg-[#f7f8fa] px-4 py-3",
  label: "font-mono text-[10px] uppercase tracking-[0.06em] text-[#6b7280]",
  goal: "truncate text-sm font-medium tracking-tight text-[#1f2329]",
  split: "flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row",
  /** Left reasoning map takes majority width (screenshot parity with wall-fixture). */
  flowPanelWide:
    "flex min-h-[320px] min-w-0 flex-[1.35] flex-col border-b border-[#e5e7eb] bg-[#ffffff] lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanel:
    "flex min-h-[280px] min-w-0 flex-1 flex-col border-b border-[#e5e7eb] bg-[#ffffff] lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanelHeader:
    "flex shrink-0 items-center justify-between border-b border-[#e5e7eb] px-4 py-2",
  flowPanelBody: "relative min-h-0 flex-1",
  flowEmpty:
    "flex h-full items-center justify-center px-6 text-center text-sm text-stone-500",
  imPanel:
    "flex w-full min-h-0 flex-col bg-[#eef0f4] lg:w-[min(420px,34%)] xl:w-[min(440px,32%)] lg:shrink-0",
  main: "flex-1 overflow-auto px-4 py-4",
  footer: "shrink-0 border-t border-[#e5e7eb] bg-[#f7f8fa] px-4 py-3",

  emptyState:
    "rounded border border-dashed border-[#d3d8e0] bg-[#eef0f4] px-6 py-12 text-center text-sm font-medium text-stone-500",
  emptyHint: "mt-4 text-xs font-normal text-stone-400",

  userBubble:
    "max-w-[85%] rounded border border-[#e5e7eb] bg-[#ffffff] px-4 py-2.5 text-sm font-semibold leading-6 text-stone-700 shadow-[0_1px_2px_rgb(15_23_42,0.05)]",

  artifactCard:
    "group rounded border border-[#e5e7eb] bg-[#ffffff] p-3 text-sm shadow-[0_1px_2px_rgb(15_23_42,0.05)]",
  artifactTitle: "font-semibold text-stone-800",
  artifactBody:
    "mt-3 whitespace-pre-wrap text-xs leading-relaxed text-stone-600",
  artifactMeta:
    "rounded-sm bg-[#e9edf2] px-2 py-0.5 text-stone-600 ring-1 ring-inset ring-[#e5e7eb]",
  artifactExpand: "text-[11px] text-stone-400",

  actionVerify: "text-stone-600 hover:text-[#1f2329] hover:underline",
  actionChallenge: "text-amber-700 hover:text-amber-900 hover:underline",

  input:
    "flex-1 rounded border border-[#e5e7eb] bg-[#eef0f4] px-3 py-2.5 text-sm font-semibold leading-6 text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-[#1677ff]/50 focus:ring-2 focus:ring-[#1677ff]/15",
  sendBtn:
    "rounded bg-[#1677ff] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0958d9] active:scale-[0.98]",
  hintChip:
    "rounded-full border border-[#e5e7eb] bg-[#ffffff] px-2 py-0.5 text-[10px] font-medium text-stone-600 transition hover:border-[#d3d8e0] hover:bg-[#eef0f4] hover:text-stone-800",

  auditBtn:
    "rounded-full border border-[#e5e7eb]/90 bg-[#ffffff]/90 px-3 py-1.5 text-[11px] font-semibold text-stone-700 shadow-sm transition hover:bg-white",
  devLink:
    "text-[10px] !text-stone-500 transition hover:!text-stone-800 hover:underline",

  liveActionThink: "text-sm text-stone-500",
  liveActionExternal: "text-sm text-[#0958d9]",
  actionTrace:
    "mb-1 block text-[11px] text-[#1677ff] transition hover:text-[#0958d9] hover:underline",

  drawerOverlay: "flex-1 bg-[#2A2620]/30 backdrop-blur-[1px]",
  drawer:
    "flex h-full w-full max-w-xl flex-col border-l border-[#e5e7eb] bg-[#f7f8fa] shadow-2xl",
  drawerHeader:
    "flex items-center justify-between border-b border-[#e5e7eb] px-4 py-3",
  drawerTitle: "text-sm font-semibold text-[#1f2329]",
  drawerSubtitle: "text-[10px] text-stone-500",
  drawerClose: "text-stone-500 transition hover:text-stone-800",
  drawerBody: "flex-1 space-y-4 overflow-auto p-4 text-[11px] text-stone-700",
  drawerChip: "rounded bg-[#e9edf2] px-2 py-0.5 font-mono text-stone-500",
  drawerBtn:
    "rounded border border-[#e5e7eb] px-2 py-1 text-stone-600 transition hover:bg-[#eef0f4] hover:text-[#1f2329]",
  drawerBtnDanger:
    "rounded border border-rose-200 px-2 py-1 text-rose-700 transition hover:bg-rose-50",
  drawerBtnAccent:
    "rounded border border-[#d3d8e0] px-2 py-1 font-medium text-stone-800 transition hover:bg-[#eef0f4]",
  drawerPanel: "rounded border border-[#e5e7eb] bg-[#eef0f4] p-2",

  latestUserBubble:
    "pointer-events-auto max-w-full truncate rounded-full border border-[#e5e7eb] bg-[#ffffff]/90 px-3 py-1 text-[11px] text-stone-600 shadow-sm backdrop-blur",
  latestUserBubbleMarathon:
    "pointer-events-auto max-w-full truncate rounded-full border border-[#EBCEC0] bg-[#e6f4ff]/90 px-3 py-1 text-[11px] text-[#1677ff] shadow-sm backdrop-blur",
  grokInputBar:
    "pointer-events-auto flex min-h-[64px] w-full items-center gap-0 rounded-[8px] border border-[#e8eaee]/90 bg-[#ffffff]/95 px-4 py-2.5 shadow-[0_18px_52px_rgb(15_23_42/0.10)] ring-1 ring-[#e5e7eb]/50 backdrop-blur-xl",
  grokInputBarMarathon:
    "pointer-events-auto flex min-h-[64px] w-full items-center gap-0 rounded-[8px] border border-[#F3DCD0]/85 bg-[#ffffff]/95 px-4 py-2.5 shadow-[0_18px_52px_rgb(217_119_87/0.13)] ring-1 ring-[#F3DCD0]/70 backdrop-blur-xl",
  grokInput:
    "h-11 max-h-[116px] w-full min-w-0 resize-none overflow-y-auto bg-transparent px-4 py-[9px] text-[14px] leading-[22px] text-stone-800 outline-none placeholder:text-stone-400",
  grokSendBtn:
    "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#1677ff] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0958d9] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
  grokSendBtnMarathon:
    "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#0958d9] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#1677ff] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
} as const;
