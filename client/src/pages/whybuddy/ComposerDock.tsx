import React from "react";
import { autopilotTheme } from "./autopilot-theme";

const DEFAULT_HINT_CHIPS = [
  "路线对比一下",
  "澄清权限边界",
  "分析安全风险",
  "生成可行性报告",
];

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  goal,
  latestUserText,
  hintChips,
  driveMode,
  setDriveMode,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  isRunning: boolean;
  goal: string;
  latestUserText?: string;
  hintChips?: string[];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
}) {
  const chips = hintChips?.length ? hintChips : DEFAULT_HINT_CHIPS;
  return (
    <div className="pointer-events-none flex w-full max-w-2xl flex-col items-center gap-2">
      {latestUserText && (
        <div className="pointer-events-auto max-w-full rounded-full border border-white/70 bg-white/80 px-4 py-1.5 text-center text-[11px] text-slate-500 shadow-sm backdrop-blur-md">
          本轮 · {latestUserText.slice(0, 72)}
          {latestUserText.length > 72 ? "…" : ""}
        </div>
      )}
      <div
        className={`pointer-events-auto w-full ${autopilotTheme.composerDock}`}
        data-testid="whybuddy-composer-dock"
      >
        {/* M2 mode selector (claude-like): deep-thought single vs continuous marathon/autopilot */}
        {setDriveMode && (
          <div className="mb-1 flex gap-1 text-[10px]">
            <button
              onClick={() => setDriveMode("single")}
              className={`rounded px-2 py-0.5 ${driveMode !== "marathon" ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"}`}
              disabled={isRunning}
              title="深思一轮（默认）：想清楚一个问题就停，等你"
            >
              深思一轮
            </button>
            <button
              onClick={() => setDriveMode("marathon")}
              className={`rounded px-2 py-0.5 ${driveMode === "marathon" ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-300"}`}
              disabled={isRunning}
              title="持续推演（自动驾驶）：收敛后自动开新前沿，直到你停 / 预算顶 / 前沿尽"
            >
              持续推演
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={
              goal
                ? "继续补充想法，或质疑图上节点…"
                : "描述你想推演的问题…"
            }
            className={autopilotTheme.input}
            data-testid="whybuddy-composer-input"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!isRunning && !input.trim()}
            className={autopilotTheme.sendBtn}
          >
            {isRunning ? "停止" : "发送"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {chips.map((hint) => (
            <button
              key={hint}
              type="button"
              disabled={isRunning}
              onClick={() => setInput(hint)}
              className={autopilotTheme.hintChip}
            >
              {hint}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}