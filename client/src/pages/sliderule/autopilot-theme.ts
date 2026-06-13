/**
 * Product surface palette aligned with AutopilotRoutePage:
 * light gray page (#f4f6f8), white chrome, slate controls.
 */
export const autopilotTheme = {
  /** Full-screen canvas host — graph under floating HUD layers. */
  immersionPage: "relative h-screen w-screen overflow-hidden bg-[#eef1f4] text-slate-950",
  immersionCanvas: "absolute inset-0 z-0",
  immersionOverlayTop:
    "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 sm:gap-2.5 sm:p-4",
  immersionOverlayHeader: "pointer-events-auto w-full",
  /** 架构树节拍 — 顶栏下方、右对齐，预留顶栏右侧放 Dev / 导出等操作 */
  immersionOverlayArchRow: "pointer-events-none flex w-full justify-end",
  immersionHudLeft:
    "pointer-events-auto flex min-w-0 flex-1 flex-col gap-1.5",
  immersionHudRight:
    "pointer-events-auto w-[min(100%,600px)] shrink-0 sm:w-[min(52vw,560px)] lg:w-[min(48vw,600px)]",
  overlayTransparent: "bg-transparent",
  overlayBar:
    "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-900/[0.06] pb-1.5 text-[11px] text-slate-700",
  immersionOverlayBottom:
    "pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 pt-2 sm:pb-6",
  glassPanel:
    "pointer-events-auto max-h-[min(70vh,520px)] w-[min(100%,340px)] overflow-hidden rounded-2xl border border-white/70 bg-white/75 px-3 py-3 shadow-[0_8px_32px_rgb(15_23_42/0.12)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  glassPanelWide:
    "pointer-events-auto max-w-[min(100%,560px)] rounded-2xl border border-white/70 bg-white/75 px-3 py-3 shadow-[0_8px_32px_rgb(15_23_42/0.12)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  composerDock:
    "rounded-2xl border border-white/80 bg-white/88 px-3 py-3 shadow-[0_12px_40px_rgb(15_23_42/0.14)] backdrop-blur-2xl sm:px-4",

  page: "relative flex h-screen flex-col bg-[#f4f6f8] text-slate-950",
  header: "flex items-center justify-between border-b border-[#E5E5E5] bg-white px-4 py-3",
  label: "font-mono text-[10px] uppercase tracking-[0.06em] text-[#666]",
  goal: "truncate text-sm font-medium tracking-tight text-black",
  split: "flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row",
  /** Left reasoning map takes majority width (screenshot parity with wall-fixture). */
  flowPanelWide:
    "flex min-h-[320px] min-w-0 flex-[1.35] flex-col border-b border-[#E5E5E5] bg-white lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanel:
    "flex min-h-[280px] min-w-0 flex-1 flex-col border-b border-[#E5E5E5] bg-white lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanelHeader:
    "flex shrink-0 items-center justify-between border-b border-[#E5E5E5] px-4 py-2",
  flowPanelBody: "relative min-h-0 flex-1",
  flowEmpty:
    "flex h-full items-center justify-center px-6 text-center text-sm text-slate-500",
  imPanel: "flex w-full min-h-0 flex-col bg-[#f4f6f8] lg:w-[min(420px,34%)] xl:w-[min(440px,32%)] lg:shrink-0",
  main: "flex-1 overflow-auto px-4 py-4",
  footer: "shrink-0 border-t border-[#E5E5E5] bg-white px-4 py-3",

  emptyState:
    "rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm font-medium text-slate-500",
  emptyHint: "mt-4 text-xs font-normal text-slate-400",

  userBubble:
    "max-w-[85%] rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold leading-6 text-slate-700 shadow-[0_1px_2px_rgb(0,0,0,0.04)]",

  artifactCard:
    "group rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-[0_1px_2px_rgb(0,0,0,0.04)]",
  artifactTitle: "font-semibold text-slate-800",
  artifactBody: "mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600",
  artifactMeta:
    "rounded-md bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-inset ring-slate-200",
  artifactExpand: "text-[11px] text-slate-400",

  actionVerify: "text-slate-600 hover:text-slate-900 hover:underline",
  actionChallenge: "text-amber-700 hover:text-amber-900 hover:underline",

  input:
    "flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/10",
  sendBtn:
    "rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 active:scale-[0.98]",
  hintChip:
    "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800",

  auditBtn:
    "rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50",
  devLink: "text-[10px] text-slate-500 transition hover:text-slate-800 hover:underline",

  liveActionThink: "text-sm text-slate-500",
  liveActionExternal: "text-sm text-violet-500",
  actionTrace:
    "mb-1 block text-[11px] text-violet-400 transition hover:text-violet-600 hover:underline",

  drawerOverlay: "flex-1 bg-slate-950/30 backdrop-blur-[1px]",
  drawer: "flex h-full w-full max-w-xl flex-col border-l border-[#E5E5E5] bg-white shadow-2xl",
  drawerHeader: "flex items-center justify-between border-b border-[#E5E5E5] px-4 py-3",
  drawerTitle: "text-sm font-semibold text-slate-900",
  drawerSubtitle: "text-[10px] text-slate-500",
  drawerClose: "text-slate-500 transition hover:text-slate-800",
  drawerBody: "flex-1 space-y-4 overflow-auto p-4 text-[11px] text-slate-700",
  drawerChip: "rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-500",
  drawerBtn:
    "rounded border border-slate-200 px-2 py-1 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900",
  drawerBtnDanger:
    "rounded border border-rose-200 px-2 py-1 text-rose-700 transition hover:bg-rose-50",
  drawerBtnAccent:
    "rounded border border-slate-300 px-2 py-1 font-medium text-slate-800 transition hover:bg-slate-50",
  drawerPanel: "rounded-lg border border-slate-200 bg-slate-50 p-2",

  latestUserBubble:
    "pointer-events-auto max-w-full truncate rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] text-slate-600 shadow-sm backdrop-blur",
  latestUserBubbleMarathon:
    "pointer-events-auto max-w-full truncate rounded-full border border-indigo-200 bg-indigo-50/90 px-3 py-1 text-[11px] text-indigo-700 shadow-sm backdrop-blur",
  grokInputBar:
    "pointer-events-auto flex w-full items-end gap-1.5 rounded-[24px] border border-slate-200 bg-white/95 px-2.5 py-2 shadow-[0_12px_40px_rgb(15_23_42/0.12)] backdrop-blur-xl",
  grokInputBarMarathon:
    "pointer-events-auto flex w-full items-end gap-1.5 rounded-[24px] border border-indigo-200 bg-indigo-50/80 px-2.5 py-2 shadow-[0_12px_40px_rgb(79_70_229/0.10)] backdrop-blur-xl",
  grokInput:
    "max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400",
  grokSendBtn:
    "shrink-0 rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
  grokSendBtnMarathon:
    "shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
} as const;