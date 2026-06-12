import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormGraphTelemetry } from "@shared/blueprint/brainstorm-reasoning-graph";
import { deriveStatusBarFacts } from "./derive-status-bar";
import { autopilotTheme } from "./autopilot-theme";
import type { WhyBuddyExecutorMode } from "./types";
import type { ProjectionDensity } from "./whybuddy-projection-constants";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import * as WhyBuddyRuntime from "@/lib/whybuddy-runtime";
import {
  loadByokPool,
  saveByokPool,
  clearByokPool,
  validateByokPool,
  maskKey,
  PRESET_ENDPOINTS,
  PRESET_MODELS,
  type ByokPresetId,
} from "@/lib/whybuddy-byok-config";
import { getByokDispatcher } from "@/lib/whybuddy-byok-dispatcher";

export function WhyBuddyTopHud({
  state,
  goal,
  turnCount,
  isRunning,
  driveLoopCount,
  telemetry,
  executorMode,
  projectionDensity,
  onProjectionDensityChange,
  onResetSession,
}: {
  state: V5SessionState;
  goal: string;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  telemetry?: BrainstormGraphTelemetry | null;
  executorMode?: WhyBuddyExecutorMode;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  onResetSession?: () => void;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    immersion: true,
    executorMode,
  });

  // B4: GitHub Pages BYOK key config UI (visible only in Pages mode)
  const [byokDraft, setByokDraft] = React.useState(() => {
    const p = loadByokPool();
    const e = p?.entries?.[0];
    return { preset: (e?.presetId as ByokPresetId) || "openai", key: e ? "********" : "" };
  });

  const currentByok = React.useMemo(() => loadByokPool(), [byokDraft]); // re-eval on draft change for demo

  const saveByok = () => {
    if (!byokDraft.key || byokDraft.key === "********") {
      alert("请输入有效 API Key");
      return;
    }
    const endpoint = PRESET_ENDPOINTS[byokDraft.preset] || "";
    const model = PRESET_MODELS[byokDraft.preset] || "gpt-4o-mini";
    const existing = loadByokPool() || { version: 1 as const, entries: [], dispatch: "least-busy" as const, raceMode: false };
    const newEntry = {
      id: `user-key-${Date.now()}`,
      label: `${byokDraft.preset} (BYOK)`,
      presetId: byokDraft.preset,
      endpoint,
      model,
      apiKey: byokDraft.key,
      enabled: true,
    };
    // Support true multi-key: append instead of replace (advance B4)
    const pool = {
      ...existing,
      entries: [...(existing.entries || []), newEntry],
    };
    if (!validateByokPool(pool).ok) {
      alert("配置无效，请检查 preset/key");
      return;
    }
    saveByokPool(pool);
    if (IS_GITHUB_PAGES && WhyBuddyRuntime.useBrowserLlmCapabilityExecutor) {
      WhyBuddyRuntime.useBrowserLlmCapabilityExecutor();
    }
    setByokDraft({ ...byokDraft, key: "********" });
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
    alert("Key 已添加到本机 localStorage pool（零服务器，支持多 key）。下一轮推演将使用 browser-llm (production baseline)。配置变更立即生效（下一 turn）。");
  };

  const clearByok = () => {
    clearByokPool();
    setByokDraft({ preset: "openai", key: "" });
    if (IS_GITHUB_PAGES && WhyBuddyRuntime.usePilotRealExecutor) {
      WhyBuddyRuntime.usePilotRealExecutor();
    }
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
    alert("已清除 BYOK 配置，回退到 pilot 模板演示。");
  };

  // Per-key remove for true multi-key support
  const removeByokEntry = (id: string) => {
    const pool = loadByokPool();
    if (!pool || !pool.entries) return;
    const newEntries = pool.entries.filter((e: any) => e.id !== id);
    const newPool = { ...pool, entries: newEntries };
    saveByokPool(newPool);
    // bump draft to re-render list
    setByokDraft({ ...byokDraft, key: byokDraft.key });
    if (IS_GITHUB_PAGES && newEntries.length === 0 && WhyBuddyRuntime.usePilotRealExecutor) {
      WhyBuddyRuntime.usePilotRealExecutor();
    }
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
  };

  // Edit: load the entry's values into the draft form so user can modify preset/key and Add/Save (append or re-configure)
  const editByokEntry = (e: any) => {
    setByokDraft({ preset: e.presetId as ByokPresetId, key: "********" });
    // Optional: remove the old one first so re-save replaces it (user intent for "edit")
    // For safety we just load; user can Clear or remove if they want exact replace.
    alert(`Loaded ${e.presetId} for edit. Change values and click Add/Save (it will add; use × to remove old duplicate if needed).`);
  };

  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="whybuddy-status-bar"
    >
      <div
        className={`${autopilotTheme.overlayTransparent} flex w-full items-center gap-3 border-b border-slate-900/[0.06] pb-1.5`}
      >
        <div
          className={`${autopilotTheme.overlayBar} min-w-0 flex-1 border-b-0 pb-0`}
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            STATUS
          </span>
          {IS_GITHUB_PAGES && (
            <span
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-800 ring-1 ring-inset ring-indigo-200/80"
              data-testid="whybuddy-pages-demo-badge"
            >
              GitHub Pages 演示
            </span>
          )}
          <span
            data-testid="whybuddy-conclusion-badge"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
          >
            {facts.conclusionLabel}
          </span>
          <span
            data-testid="whybuddy-grounding-badge"
            title={facts.groundingHint || facts.groundingLabel}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.groundingClassName}`}
          >
            {facts.groundingLabel}
          </span>
          <span
            data-testid="whybuddy-executor-mode"
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
          >
            {facts.executorModeLabel}
          </span>
          {facts.groundingHint && (
            <span
              className="hidden text-[10px] text-amber-700 lg:inline"
              data-testid="whybuddy-grounding-hint"
            >
              {facts.groundingHint}
            </span>
          )}
          <span className="hidden h-3 w-px bg-slate-300 sm:inline-block" aria-hidden />
          {/* K6.5: 详略开关可发现性提示 - 首次或切换时建议切详模式看溯源链 (ev/phase/tree 子节点) */}
          {projectionDensity === "compact" && onProjectionDensityChange && (
            <span
              className="ml-1 hidden text-[9px] text-amber-600 lg:inline cursor-pointer hover:underline"
              title="切详模式看证据/阶段/树溯源链"
              onClick={() => onProjectionDensityChange("detailed")}
            >
              [切详看溯源]
            </span>
          )}

          {/* B4: BYOK 配置入口 (仅 Pages 模式可见) - advanced multi-key */}
          {IS_GITHUB_PAGES && (
            <span className="ml-2 flex flex-col gap-0.5 text-[9px] text-slate-300">
              <span>BYOK (multi-key pool):</span>
              {currentByok?.entries?.length ? (
                currentByok.entries.map((e, i) => {
                  const snap = getByokDispatcher().snapshot().entries.find(s => s.id === e.id) || { inFlight: 0, totalTokens: 0, cooledUntil: null, enabled: e.enabled };
                  return (
                    <span key={i} className="text-[8px] text-emerald-300 flex items-center gap-1" title={`Key ${i+1}: ${e.label} (masked)`}>
                      {e.presetId} {e.label} ({maskKey(e.apiKey)}) inFlight:{snap.inFlight} tokens:{snap.totalTokens} {snap.cooledUntil ? 'cooled' : ''}
                      <button
                        onClick={() => removeByokEntry(e.id)}
                        className="ml-1 rounded bg-rose-800/70 px-0.5 text-[7px] text-white hover:bg-rose-600"
                        title="Remove this key"
                      >
                        ×
                      </button>
                      <button
                        onClick={() => editByokEntry(e)}
                        className="rounded bg-sky-800/70 px-0.5 text-[7px] text-white hover:bg-sky-600"
                        title="Load for edit (change preset/key then Add/Save)"
                      >
                        ✎
                      </button>
                    </span>
                  );
                })
              ) : <span className="text-amber-400">not set</span>}
              <div className="flex items-center gap-1">
                <select
                  value={byokDraft.preset}
                  onChange={(e) => setByokDraft({ ...byokDraft, preset: e.target.value as any })}
                  className="rounded bg-slate-800 px-1 text-[8px] text-white"
                >
                  {Object.keys(PRESET_ENDPOINTS).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  <option value="custom">custom</option>
                </select>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={byokDraft.key === "********" ? "" : byokDraft.key}
                  onChange={(e) => setByokDraft({ ...byokDraft, key: e.target.value })}
                  className="w-16 rounded bg-slate-800 px-1 text-[8px] text-white"
                />
                <button onClick={saveByok} className="rounded bg-emerald-700 px-1 text-white text-[8px]">Add/Save</button>
                <button onClick={clearByok} className="rounded bg-rose-700 px-1 text-white text-[8px]">Clear All</button>
              </div>
              <span className="text-[7px] text-amber-400" title="Keys only in localStorage. Snapshot from dispatcher.">
                (本机, snapshot: in-flight/tokens)
              </span>
            </span>
          )}
          {/* M7: basic audit drawer entry - shows raw mechanism info for the curious (hides from default user language) */}
          {IS_GITHUB_PAGES && (
            <button
              onClick={() => {
                const raw = {
                  lastStop: state.goal?.status,
                  gates: (state.gates || []).slice(-3),
                  ledgerSample: (state.decisionLedger || []).slice(-2),
                  note: "Full raw in real audit; mechanisms hidden by default per M7"
                };
                alert("审计抽屉 (M7):\n" + JSON.stringify(raw, null, 2) + "\n(实际应为可折叠面板，信息等量不删)");
              }}
              className="ml-2 rounded bg-slate-700 px-1 text-[8px] text-white"
              title="审计抽屉：查看机制原文（T_LEDGER, gates, stop reasons 等）。默认 UI 已翻译为用户语言。"
            >
              审计
            </button>
          )}
          <span className="font-mono text-[10px] text-slate-400">话题</span>
          <span
            className={`min-w-0 max-w-[min(36vw,280px)] truncate font-medium text-slate-800 sm:max-w-[min(42vw,360px)] ${
              !goal ? "text-slate-400" : ""
            }`}
            data-testid="whybuddy-goal-display"
            title={goal}
          >
            {goal || "输入想法，架构图从 INTAKE 展开…"}
          </span>
          <span className="hidden h-3 w-px bg-slate-300 md:inline-block" aria-hidden />
          <InlineMetric label="可信" value={facts.trustedArtifactCount} />
          <InlineMetric label="缺口" value={facts.openGapCount} />
          <InlineMetric label="环" value={facts.driveLoopCount} />
          <InlineMetric label="调用" value={facts.capabilityRunCount} />
          {telemetry?.sourceCount != null && (
            <InlineMetric label="来源" value={telemetry.sourceCount} />
          )}
          {telemetry?.activeRoleCount != null && (
            <InlineMetric label="角色" value={telemetry.activeRoleCount} />
          )}
          <span className="text-slate-400">
            阶段{" "}
            <span className="font-mono font-semibold text-slate-700">{facts.phaseLabel}</span>
          </span>
          {facts.dataReady && (
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              dataReady
            </span>
          )}
          {onProjectionDensityChange && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/80"
              data-testid="whybuddy-density-toggle"
            >
              {(["compact", "detailed"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onProjectionDensityChange(mode)}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
                    projectionDensity === mode
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {mode === "compact" ? "简" : "详"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid="whybuddy-header-actions"
        >
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="whybuddy-reset-session"
              className={autopilotTheme.auditBtn}
              title={isRunning ? "推演进行中，请稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
            >
              重置会话
            </button>
          )}
          <a href="/whybuddy/dev" className={autopilotTheme.devLink}>
            Dev
          </a>
        </div>
      </div>
    </header>
  );
}

function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="tabular-nums text-slate-600">
      <span className="text-slate-400">{label} </span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </span>
  );
}