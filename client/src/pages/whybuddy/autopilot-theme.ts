/**
 * Product surface palette aligned with AutopilotRoutePage:
 * light gray page (#f4f6f8), white chrome, slate controls.
 */
export const autopilotTheme = {
  page: "relative flex h-screen flex-col bg-[#f4f6f8] text-slate-950",
  header: "flex items-center justify-between border-b border-[#E5E5E5] bg-white px-4 py-3",
  label: "font-mono text-[10px] uppercase tracking-[0.06em] text-[#666]",
  goal: "truncate text-sm font-medium tracking-tight text-black",
  split: "flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row",
  flowPanel:
    "flex min-h-[280px] min-w-0 flex-1 flex-col border-b border-[#E5E5E5] bg-white lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanelHeader:
    "flex shrink-0 items-center justify-between border-b border-[#E5E5E5] px-4 py-2",
  flowPanelBody: "relative min-h-0 flex-1",
  flowEmpty:
    "flex h-full items-center justify-center px-6 text-center text-sm text-slate-500",
  imPanel: "flex w-full min-h-0 flex-col bg-[#f4f6f8] lg:w-[420px] xl:w-[480px]",
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
} as const;