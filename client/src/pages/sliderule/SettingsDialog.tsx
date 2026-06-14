import React from "react";
import { Cpu, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import type { ProjectionDensity } from "./sliderule-projection-constants";
import { LlmProviderSettings } from "./LlmProviderSettings";
import {
  loadProvidersConfig,
  saveProvidersConfig,
  type LlmProvidersConfig,
} from "@/lib/sliderule-llm-providers";

type CategoryId = "llm" | "system";

type MarathonBudget = { maxTokens: number; declaredAt: string };

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: MarathonBudget;
  setMarathonBudget?: (b: MarathonBudget) => void;
};

const NAV_ITEMS: Array<{ id: CategoryId; label: string; icon: React.ReactNode }> = [
  { id: "llm", label: "语言模型", icon: <Cpu className="h-4 w-4" /> },
  { id: "system", label: "系统设置", icon: <SlidersHorizontal className="h-4 w-4" /> },
];

/**
 * SlideRule 设置中心（Cherry Studio 风格三栏）。
 * 语言模型分类 = provider-centric BYOK 配置（保存编译成执行器消费的扁平池）；
 * 系统设置分类 = 推演偏好（投影密度 / 默认模式 / 持续推演预算）。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onClose } = props;
  const [category, setCategory] = React.useState<CategoryId>("llm");
  const [draft, setDraft] = React.useState<LlmProvidersConfig | null>(null);
  // Capture the snapshot we loaded when the dialog was opened (for dirty check + no-op Save guard).
  const initialLlmDraftRef = React.useRef<LlmProvidersConfig | null>(null);

  React.useEffect(() => {
    if (open) {
      setCategory("llm");
      const loaded = loadProvidersConfig();
      setDraft(loaded);
      // Deep copy for comparison (simple + sufficient for this config shape).
      initialLlmDraftRef.current = loaded ? JSON.parse(JSON.stringify(loaded)) : null;
    } else {
      initialLlmDraftRef.current = null;
    }
  }, [open]);

  const isLlmDirty = React.useMemo(() => {
    if (!draft || !initialLlmDraftRef.current) return false;
    return JSON.stringify(draft) !== JSON.stringify(initialLlmDraftRef.current);
  }, [draft]);

  if (!open) return null;

  const guardedClose = () => {
    if (isLlmDirty) {
      const ok = window.confirm("有未保存的更改，确定要关闭吗？（更改将丢失）");
      if (!ok) return;
    }
    onClose();
  };

  const handleSave = () => {
    if (!draft) return;
    // Only persist + toast when there is a meaningful change (avoids "设置已保存" spam on no-op).
    if (!isLlmDirty) {
      onClose();
      return;
    }
    saveProvidersConfig(draft);
    // After a real save, treat current draft as the new baseline so further accidental Save is no-op.
    initialLlmDraftRef.current = JSON.parse(JSON.stringify(draft));
    const enabled = draft.providers.filter((p) => p.enabled).length ?? 0;
    toast.success("设置已保存", {
      description: enabled > 0 ? `已启用 ${enabled} 个厂商，下一轮推演生效。` : "未启用厂商，使用服务端 LLM。",
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm" onClick={guardedClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4" onClick={guardedClose}>
        <div
          className="relative flex h-[min(86vh,760px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgb(15_23_42/0.28)]"
          data-testid="sliderule-settings-dialog"
          role="dialog"
          aria-label="设置"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={guardedClose}
            className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
            data-testid="sliderule-settings-close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex min-h-0 flex-1">
            {/* 左栏：分类导航 */}
            <nav className="flex w-[190px] shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center gap-2 px-2 py-1">
                <img
                  src="/assets/sliderule_logo_wordmark_transparent.png"
                  alt="SlideRule"
                  className="h-5"
                  title="SlideRule 设置"
                />
              </div>
              {NAV_ITEMS.map((item) => {
                const active = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    data-testid={`sliderule-settings-nav-${item.id}`}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                      active
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-600 hover:bg-white hover:text-slate-800"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* 内容区 */}
            <div className="flex min-w-0 flex-1 flex-col">
              {category === "llm" ? (
                draft ? (
                  <LlmProviderSettings draft={draft} setDraft={setDraft} />
                ) : null
              ) : (
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <SystemPrefs {...props} />
                </div>
              )}
            </div>
          </div>

          {/* 底部操作 */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button
              onClick={guardedClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              关闭
            </button>
            <button
              onClick={handleSave}
              disabled={!isLlmDirty}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
              data-testid="sliderule-settings-save"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────── 系统设置（推演偏好） ───────────────────────────────────

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange?: (v: T) => void;
}) {
  return (
    <div className="flex max-w-md gap-1 rounded-lg bg-slate-100 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(opt.value)}
          title={opt.hint}
          className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === opt.value ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SystemPrefs(props: SettingsDialogProps) {
  const {
    projectionDensity,
    onProjectionDensityChange,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
  } = props;
  const budget = marathonBudget?.maxTokens ?? 12000;
  const labelClass = "mb-1.5 block text-[12px] font-semibold text-slate-600";

  return (
    <div className="max-w-xl space-y-6" data-testid="sliderule-settings-prefs">
      <div>
        <label className={labelClass}>投影密度</label>
        <Segmented
          value={projectionDensity}
          onChange={onProjectionDensityChange}
          options={[
            { value: "compact", label: "简", hint: "精简投影，只显示关键节点" },
            { value: "detailed", label: "详", hint: "展开证据/阶段/树的溯源链" },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-slate-400">控制推演图节点展开的详略程度。</p>
      </div>

      <div>
        <label className={labelClass}>默认推演模式</label>
        <Segmented
          value={driveMode}
          onChange={setDriveMode}
          options={[
            { value: "single", label: "深思一轮", hint: "想清楚一个问题就停，等你确认下一步" },
            { value: "marathon", label: "持续推演", hint: "自动多轮推进，直到预算/前沿尽/需要人工介入" },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-slate-400">与底部输入框的模式选择同步。</p>
      </div>

      <div>
        <label className={labelClass}>持续推演 token 预算</label>
        <input
          type="number"
          min={1000}
          step={1000}
          value={budget}
          disabled={!setMarathonBudget}
          onChange={(ev) => {
            const n = Number.parseInt(ev.target.value, 10);
            if (Number.isFinite(n) && n > 0) {
              setMarathonBudget?.({ maxTokens: n, declaredAt: new Date().toISOString() });
            }
          }}
          className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          data-testid="sliderule-settings-budget"
        />
        <p className="mt-1.5 text-[11px] text-slate-400">
          持续推演模式单条消息的 token 上限，达到后停在等待人工介入。
        </p>
      </div>
    </div>
  );
}
