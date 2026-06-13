import React from "react";
import { autopilotTheme } from "./autopilot-theme";

/** Compact token budget label: 89000 → "89k", 12500 → "12.5k", 800 → "800". */
function formatBudgetTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
}

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  goal,
  latestUserText,
  // driveMode/set from parent (M2); for demo fall back to local if not wired in all splits
  driveMode: outerDriveMode,
  setDriveMode: outerSetDriveMode,
  marathonBudget: outerMarathonBudget,
  // optional setter if parent wants live sync (future)
  onBudgetChange,
  stop,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  isRunning: boolean;
  goal: string;
  latestUserText?: string;
  hintChips?: string[]; // kept in props for parent compatibility (no longer rendered)
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: { maxTokens: number; declaredAt: string };
  onBudgetChange?: (b: { maxTokens: number; declaredAt: string }) => void;
  stop?: () => void;
}) {
  const [localMode, setLocalMode] = React.useState<"single" | "marathon">("single");
  const driveMode = outerDriveMode || localMode;
  const setDriveMode = outerSetDriveMode || setLocalMode;
  let marathonBudget = outerMarathonBudget || (() => {
    try { return JSON.parse(localStorage.getItem("sliderule:marathonBudget") || "null"); } catch { return null; }
  })();
  // prefer outer if present
  if (outerMarathonBudget) marathonBudget = outerMarathonBudget;

  const [isModeOpen, setIsModeOpen] = React.useState(false);
  const modeRef = React.useRef(null);

  const selectMode = (mode: "single" | "marathon") => {
    if (mode === "marathon") {
      // M5 强制 UI: marathon 开时弹预算
      let budget = { maxTokens: 12000, declaredAt: new Date().toISOString() };
      try {
        const raw = localStorage.getItem("sliderule:marathonBudget");
        if (raw) budget = JSON.parse(raw);
      } catch {}
      const ans = window.prompt("M5 强制预算（marathon 开启）\n输入本 session 最大 token 上限（默认 12000）:", String(budget.maxTokens));
      if (ans) {
        const n = Math.max(2000, Math.min(80000, parseInt(ans, 10) || 12000));
        budget = { maxTokens: n, declaredAt: new Date().toISOString() };
        try { localStorage.setItem("sliderule:marathonBudget", JSON.stringify(budget)); } catch {}
        if (onBudgetChange) onBudgetChange(budget);
      }
      try { (window as any).__slideruleMarathonBudget = budget; } catch {}
    }
    setDriveMode(mode);
    setIsModeOpen(false);
  };

  // Close dropdown on outside click (Grok-like behavior)
  React.useEffect(() => {
    const handleClickOutside = (event: any) => {
      const refEl: any = modeRef.current;
      if (refEl && !refEl.contains(event && event.target)) {
        setIsModeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // chips no longer rendered (user requested removal of bottom bubbles)
  // const chips = hintChips?.length ? hintChips : DEFAULT_HINT_CHIPS;
  return (
    <div className="pointer-events-none flex w-full max-w-2xl flex-col items-center gap-2">
      {latestUserText && (
        <div
          className={
            driveMode === "marathon"
              ? autopilotTheme.latestUserBubbleMarathon
              : autopilotTheme.latestUserBubble
          }
        >
          本轮 · {latestUserText.slice(0, 72)}
          {latestUserText.length > 72 ? "…" : ""}
        </div>
      )}
      <div
        className="pointer-events-auto w-full bg-transparent p-0"
        data-testid="sliderule-composer-dock"
        data-mode={driveMode}
      >
        {/* Grok-style input bar with integrated left mode prefix (like Grok model selector).
            The mode pill is now a compact left prefix inside the bar.
            Icons: 🧠 for deep think, 🔄 for marathon/continuous.
            Dropdown improves: better left positioning, fixed width, smooth scale/fade animation, current selection check. */}
        <div
          className={`${
            driveMode === "marathon"
              ? autopilotTheme.grokInputBarMarathon
              : autopilotTheme.grokInputBar
          } border-0 ${
            driveMode === "marathon"
              ? "shadow-[0_12px_40px_rgb(79_70_229/0.08)]"
              : ""
          }`}
        >
          {/* Left mode selector prefix - integrated like Grok (pure SVG icons, smaller pill with hover scale) */}
          <div className="relative flex-shrink-0 flex items-center pl-1.5" ref={modeRef}>
            <button
              type="button"
              onClick={() => setIsModeOpen(!isModeOpen)}
              disabled={isRunning}
              className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-all duration-150 hover:scale-[1.03] active:scale-[0.985] ${
                driveMode === "marathon"
                  ? "text-indigo-600 hover:bg-indigo-100/60"
                  : "text-slate-500 hover:bg-slate-100/70"
              } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              title="切换推演模式（Grok 风格前缀下拉）"
            >
              {driveMode === "marathon" ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0120.49 15"></path>
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M12 14a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3Z"></path>
                  <path d="M12 5v8"></path>
                </svg>
              )}
              <span>{driveMode === "marathon" ? "持续推演" : "深思一轮"}</span>
              {driveMode === "marathon" && (
                <span className="text-indigo-400/80 text-[8px] font-mono tabular-nums">·{formatBudgetTokens((marathonBudget?.maxTokens) || 12000)}</span>
              )}
              <span className="ml-0.5 text-[9px] leading-none text-current/50">▾</span>
            </button>

            {/* Improved dropdown: narrower (w-48), with separator, more descriptive text, left-aligned, smooth animation */}
            <div
              className={`absolute left-0 bottom-full mb-1 w-48 origin-bottom-left rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden z-[60] text-sm transition-all duration-200 ease-out ${
                isModeOpen
                  ? "opacity-100 scale-100 translate-y-0"
                  : "opacity-0 scale-95 translate-y-2 pointer-events-none"
              }`}
            >
              <button
                type="button"
                onClick={() => selectMode("single")}
                className={`w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2 ${driveMode === "single" ? "bg-emerald-50/80" : ""}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-emerald-600">
                  <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M12 14a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3Z"></path>
                  <path d="M12 5v8"></path>
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 flex items-center gap-1.5 text-xs">
                    深思一轮
                    {driveMode === "single" && <span className="text-emerald-500 text-[10px]">✓</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-tight">想清楚一个问题就停，等你确认下一步</div>
                </div>
              </button>

              <div className="border-t border-slate-100 mx-2" />

              <button
                type="button"
                onClick={() => selectMode("marathon")}
                className={`w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2 ${driveMode === "marathon" ? "bg-indigo-50/80" : ""}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-indigo-600">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0120.49 15"></path>
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 flex items-center gap-1.5 text-xs">
                    持续推演
                    {driveMode === "marathon" && <span className="text-indigo-500 text-[10px]">✓</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-tight">自动多轮推进，直到预算/前沿尽/需要人工介入</div>
                </div>
              </button>
            </div>
          </div>

          {/* subtle divider between prefix and input */}
          <div className="w-px h-5 bg-slate-200/50 mx-0.5 flex-shrink-0" />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              driveMode === "marathon"
                ? "输入新种子继续推演，或质疑当前结果…（Shift+Enter 换行）"
                : goal
                  ? "继续补充想法，或质疑图上节点…（Shift+Enter 换行）"
                  : "描述你想推演的问题…（Shift+Enter 换行）"
            }
            rows={1}
            className={autopilotTheme.grokInput}
            style={{ minHeight: "46px" }}
            data-testid="sliderule-composer-input"
          />
          <button
            type="button"
            onClick={isRunning ? stop : sendMessage}
            disabled={!isRunning && !input.trim()}
            className={
              !isRunning && driveMode === "marathon"
                ? autopilotTheme.grokSendBtnMarathon
                : autopilotTheme.grokSendBtn
            }
          >
            {isRunning ? "停止" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}