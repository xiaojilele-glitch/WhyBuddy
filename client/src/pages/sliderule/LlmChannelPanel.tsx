/**
 * LlmChannelPanel — 设置中心「推演通道」（服务端 LLM，真通道）。
 *
 * 这条通道驱动五系统生成 / LLM 评审 / AIGC 试跑与写回。面板读写
 * python 的 /api/sliderule/llm-channel：密钥只显示掩码（明文不离开
 * 服务端），修改立即生效并持久化在服务端本机；「测试连接」真调一次
 * 极小请求，失败原因如实展示。
 */

import React from "react";
import { toast } from "sonner";
import {
  SETTINGS_GHOST_BTN,
  SETTINGS_INPUT_CLASS,
  SETTINGS_PRIMARY_BTN,
  SettingsRow,
  SettingsSection,
} from "./settings-ui";

interface ChannelStatus {
  baseUrl: string;
  model: string;
  provider: string;
  keyMasked: string;
  keyPresent: boolean;
  overriddenFields: string[];
}

interface TestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  code?: string;
  detail?: string;
}

const FIELD_LABEL: Record<string, string> = { apiKey: "密钥", baseUrl: "Base URL", model: "模型" };

export function LlmChannelPanel() {
  const [status, setStatus] = React.useState<ChannelStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/sliderule/llm-channel");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ChannelStatus;
      setStatus(data);
      setBaseUrl(data.baseUrl);
      setModel(data.model);
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!status || saving) return;
    const payload: Record<string, string> = {};
    if (baseUrl.trim() && baseUrl.trim() !== status.baseUrl) payload.baseUrl = baseUrl.trim();
    if (model.trim() && model.trim() !== status.model) payload.model = model.trim();
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    if (Object.keys(payload).length === 0) {
      toast.info("没有需要保存的修改");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/sliderule/llm-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApiKey("");
      setTestResult(null);
      await refresh();
      toast.success("推演通道已更新", { description: "立即生效，密钥保存在服务端本机。" });
    } catch (e) {
      toast.error("保存失败", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async (field: string) => {
    try {
      const res = await fetch("/api/sliderule/llm-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
      toast.success(`已清除「${FIELD_LABEL[field] ?? field}」覆盖，回退 .env`);
    } catch (e) {
      toast.error("清除失败", { description: String(e) });
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/sliderule/llm-channel/test", { method: "POST" });
      setTestResult(
        res.ok
          ? ((await res.json()) as TestResult)
          : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() }
      );
    } catch (e) {
      setTestResult({ ok: false, code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const fieldInputClass = `${SETTINGS_INPUT_CLASS} w-[280px] font-mono`;

  if (loadError) {
    return (
      <div data-testid="llm-channel-panel">
        <SettingsSection>
          <p className="px-4 py-3.5 text-[12px] leading-5 text-red-600">
            无法读取服务端通道配置：{loadError}
            <span className="mt-1 block text-[#737373]">
              python 服务（:9700）未启动时此面板不可用——如实不可用，不显示假配置。
            </span>
          </p>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="llm-channel-panel">
      <p className="text-[13px] leading-5 text-[#737373]">
        这是服务端真通道——五系统生成、LLM 评审、运行应用的 AI 写回全走这一条。
        密钥仅保存在服务端本机（gitignored 覆盖文件），页面只显示掩码，明文不回传。
      </p>

      {!status ? (
        <SettingsSection>
          <div className="space-y-3 px-4 py-4">
            <div className="h-8 animate-pulse rounded-md bg-black/[0.04]" />
            <div className="h-8 animate-pulse rounded-md bg-black/[0.04]" />
            <div className="h-8 animate-pulse rounded-md bg-black/[0.04]" />
          </div>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="状态">
            <div
              className="flex flex-wrap items-center gap-2 px-4 py-3.5 text-[12px]"
              data-testid="llm-channel-status"
            >
              <span
                className={`rounded-md px-2 py-0.5 font-medium ${
                  status.keyPresent
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {status.keyPresent ? `密钥 ${status.keyMasked}` : "未配置密钥"}
              </span>
              <span className="rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-[#52525b]">
                {status.provider || "未知提供方"}
              </span>
              <span className="rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-[#52525b]">
                {status.model}
              </span>
              {status.overriddenFields.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => clearOverride(f)}
                  title="点击清除覆盖，回退 .env 值"
                  className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-700 transition hover:bg-amber-100"
                >
                  覆盖中：{FIELD_LABEL[f] ?? f} ×
                </button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection title="连接">
            <SettingsRow title="Base URL">
              <input
                className={fieldInputClass}
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                data-testid="llm-channel-baseurl"
              />
            </SettingsRow>
            <SettingsRow title="模型">
              <input
                className={fieldInputClass}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
                data-testid="llm-channel-model"
              />
            </SettingsRow>
            <SettingsRow
              title="API 密钥"
              description={
                status.keyPresent
                  ? `留空 = 保持现有密钥（${status.keyMasked}）`
                  : "粘贴密钥"
              }
            >
              <input
                className={fieldInputClass}
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={status.keyPresent ? status.keyMasked : "粘贴密钥"}
                data-testid="llm-channel-key"
              />
            </SettingsRow>
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className={SETTINGS_PRIMARY_BTN}
                data-testid="llm-channel-save"
              >
                {saving ? "保存中…" : "保存并生效"}
              </button>
              <button
                type="button"
                onClick={runTest}
                disabled={testing}
                className={SETTINGS_GHOST_BTN}
                data-testid="llm-channel-test"
              >
                {testing ? "真连测试中…" : "测试连接"}
              </button>
            </div>
          </SettingsSection>

          {testResult && testResult.ok && (
            <p
              className="text-[12px] text-emerald-700"
              data-testid="llm-channel-test-ok"
            >
              连接正常 · 模型{" "}
              <span className="font-mono">{testResult.model}</span> · 往返{" "}
              {((testResult.latencyMs ?? 0) / 1000).toFixed(1)}s（真实请求，非 mock）
            </p>
          )}
          {testResult && !testResult.ok && (
            <p
              className="text-[12px] text-red-600"
              data-testid="llm-channel-test-fail"
            >
              <span className="font-mono font-medium">{testResult.code}</span>
              <span className="ml-2">{testResult.detail}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
