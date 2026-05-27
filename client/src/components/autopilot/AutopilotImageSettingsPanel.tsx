/**
 * autopilot-image-rendering-and-visual-system · Phase 1 / Task 10.1
 *
 * `AutopilotImageSettingsPanel`：在 autopilot 面板中以只读形式展示
 * `IMAGE_GEN_*` 当前生效配置，让运维者在调试出图问题时可以快速判断
 * 「是配置缺失还是上游失败」。
 *
 * 行为约束（参见 spec requirements.md §10 与 task 10.1）：
 *
 * - 只展示 server 下发的 view-model；本组件不读取 `process.env`，也不
 *   持有 / 上传 API key 真值。`apiKey` 字段进入组件后立刻经过 `maskApiKey`
 *   脱敏，未脱敏的字符串永远不会出现在 DOM。
 * - 脱敏算法：
 *     - `apiKey === null` 或 `apiKey.length < 14` → 渲染字面量「未配置」并禁用重试按钮。
 *     - `apiKey.length >= 14` → 渲染
 *       `apiKey.slice(0, 8) + "•".repeat(apiKey.length - 14) + apiKey.slice(-6)`，
 *       中间填充字符为 U+2022 BULLET。
 * - 当 `settings.lastUpstreamCode === "AGENT_DOMAIN_MISMATCH"` 时额外渲染
 *   「请确认 IMAGE_GEN_BASE_URL 与当前 key 绑定的代理域一致」提示区。
 * - 颜色取色统一从 `visual-tokens-placeholder` 单一替换点导入；
 *   组件内 **禁止** 出现 `#` / `rgb()` / `hsl()` / `oklch()` 等颜色字面量。
 *
 * 文件路径：`client/src/components/autopilot/AutopilotImageSettingsPanel.tsx`
 *
 * @see Requirements 10.1, 10.2, 10.3, 17.1
 */

import { type ReactElement } from "react";

import { resolveToken } from "@/lib/autopilot/visual-tokens-placeholder";

/**
 * Server 下发的 image 设置视图模型。
 *
 * 注意：`apiKey` 是 **未脱敏** 的真值（`null` 表示未配置）。
 * 脱敏由组件本身完成，DOM 上永远只出现脱敏后的字符串。
 */
export interface ImageSettingsViewModel {
  /** `IMAGE_GEN_BASE_URL` 当前生效值；`null` 表示未配置。 */
  readonly baseUrl: string | null;
  /** `IMAGE_GEN_MODEL` 当前生效值，例如 `gpt-image-2`。 */
  readonly model: string;
  /** `IMAGE_GEN_PATH` 当前生效值，例如 `/v1/images/generations`。 */
  readonly path: string;
  /** `IMAGE_GEN_DEFAULT_SIZE` 当前生效值，例如 `1K`。 */
  readonly defaultSize: string;
  /** `IMAGE_GEN_DEFAULT_ASPECT` 当前生效值，例如 `1:1`。 */
  readonly defaultAspect: string;
  /** `IMAGE_GEN_TIMEOUT_MS` 当前生效值，单位毫秒。 */
  readonly timeoutMs: number;
  /**
   * 未脱敏的 API key。`null` 或长度 `< 14` 时面板会显示「未配置」并禁用重试按钮。
   *
   * ⚠️ 视图模型在到达本组件之前，应当通过 server route / store 派生层
   * 完成「仅在受信任前端持有」的边界检查；本组件本身不会把 `apiKey`
   * 真值写入 DOM 或 outgoing 请求。
   */
  readonly apiKey: string | null;
  /**
   * 最近一次 upstream 调用的错误码（可选）。当等于
   * `"AGENT_DOMAIN_MISMATCH"` 时面板会展开额外的代理域不匹配提示。
   */
  readonly lastUpstreamCode?: string;
}

/**
 * `AutopilotImageSettingsPanel` 组件 props。
 *
 * - `settings`：server 下发的 image 设置视图模型。
 * - `theme`：当前主题，决定从 OKLCH 调色板读取 `light` 还是 `dark` 分支。
 * - `onRetry`：可选的重试回调。`apiKey` 缺失或长度 < 14 时按钮 `disabled`，
 *   即便父组件传入了 `onRetry` 也永远不会被触发。
 */
export interface AutopilotImageSettingsPanelProps {
  readonly settings: ImageSettingsViewModel;
  readonly theme: "light" | "dark";
  readonly onRetry?: () => void;
}

/** API key 脱敏的最小长度阈值：低于此值一律视为未配置。 */
export const MASKED_API_KEY_MIN_LENGTH = 14;

/** 未配置状态下面板渲染的字面量。 */
export const UNCONFIGURED_API_KEY_TEXT = "未配置";

/**
 * 脱敏所用的中间填充字符（U+2022 BULLET）。
 *
 * 选用单一字符是为了让属性测试可以断言「中间字符全部相同且数量 === length - 14」。
 */
export const MASKED_API_KEY_FILL_CHAR = "\u2022";

/** upstream 触发额外提示的错误码字面量。 */
export const AGENT_DOMAIN_MISMATCH_CODE = "AGENT_DOMAIN_MISMATCH";

/** 代理域不匹配时展开的额外提示文本。 */
export const AGENT_DOMAIN_MISMATCH_HINT_TEXT =
  "请确认 IMAGE_GEN_BASE_URL 与当前 key 绑定的代理域一致";

/**
 * 把原始 API key 转换为脱敏后的展示文本。
 *
 * 算法（与 spec Property 9 严格对齐）：
 * - `apiKey === null` 或 `apiKey.length < 14` → 返回字面量 `"未配置"`。
 * - 否则返回
 *   `apiKey.slice(0, 8) + "•".repeat(apiKey.length - 14) + apiKey.slice(-6)`，
 *   中间填充字符为 U+2022 BULLET，数量恰好为 `apiKey.length - 14`。
 */
export function maskApiKey(apiKey: string | null): string {
  if (apiKey === null || apiKey.length < MASKED_API_KEY_MIN_LENGTH) {
    return UNCONFIGURED_API_KEY_TEXT;
  }
  const head = apiKey.slice(0, 8);
  const tail = apiKey.slice(-6);
  const fill = MASKED_API_KEY_FILL_CHAR.repeat(
    apiKey.length - MASKED_API_KEY_MIN_LENGTH,
  );
  return head + fill + tail;
}

/**
 * 判断 API key 是否被视为「已配置」（即满足脱敏长度阈值）。
 *
 * 暴露为模块级 helper，便于父组件 / 测试在组件外做相同的禁用判断。
 */
export function isApiKeyConfigured(apiKey: string | null): boolean {
  return apiKey !== null && apiKey.length >= MASKED_API_KEY_MIN_LENGTH;
}

/**
 * 单行 label + value 的轻量组件，避免在 panel 主体重复 markup。
 */
function SettingRow({
  label,
  value,
  testId,
  labelColor,
  valueColor,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
  readonly labelColor: string;
  readonly valueColor: string;
}): ReactElement {
  return (
    <div
      data-testid={testId}
      data-role="setting-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(8rem, max-content) 1fr",
        columnGap: "0.75rem",
        alignItems: "baseline",
        minWidth: 0,
      }}
    >
      <span
        data-role="setting-label"
        style={{ color: labelColor, fontWeight: 500 }}
      >
        {label}
      </span>
      <span
        data-role="setting-value"
        style={{
          color: valueColor,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          wordBreak: "break-all",
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * `AutopilotImageSettingsPanel` — image 配置只读视图与脱敏 API key 展示。
 */
export function AutopilotImageSettingsPanel(
  props: AutopilotImageSettingsPanelProps,
): ReactElement {
  const { settings, theme, onRetry } = props;

  // 颜色取色：所有颜色字面量都通过 `resolveToken` 间接出现，
  // 组件源码里不出现任何 `#` / `rgb()` / `hsl()` / `oklch(` 字面量。
  const labelColor = resolveToken("backend-core", theme);
  const valueColor = resolveToken("frontend", theme);
  const accentColor = resolveToken("entry", theme);
  const warningColor = resolveToken("business-loop", theme);
  const mutedColor = resolveToken("data-state", theme);

  const apiKeyConfigured = isApiKeyConfigured(settings.apiKey);
  const maskedApiKey = maskApiKey(settings.apiKey);

  const showAgentDomainMismatch =
    settings.lastUpstreamCode === AGENT_DOMAIN_MISMATCH_CODE;

  // 显式禁用 onClick：即使父组件传入了 onRetry，未配置状态也不应触发。
  const retryDisabled = !apiKeyConfigured;
  const handleRetry = () => {
    if (retryDisabled) {
      return;
    }
    onRetry?.();
  };

  return (
    <section
      data-testid="autopilot-image-settings-panel"
      data-component="autopilot-image-settings-panel"
      data-theme={theme}
      data-api-key-configured={apiKeyConfigured ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: 0,
        color: valueColor,
      }}
    >
      <header
        data-role="panel-header"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          minWidth: 0,
          color: accentColor,
          fontWeight: 600,
        }}
      >
        <span data-role="panel-title">Image generation settings</span>
        <span data-role="panel-subtitle" style={{ color: mutedColor }}>
          {apiKeyConfigured ? "configured" : "未配置"}
        </span>
      </header>

      <div
        data-role="panel-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          rowGap: "0.5rem",
          minWidth: 0,
        }}
      >
        <SettingRow
          testId="setting-row-base-url"
          label="IMAGE_GEN_BASE_URL"
          value={settings.baseUrl ?? UNCONFIGURED_API_KEY_TEXT}
          labelColor={labelColor}
          valueColor={settings.baseUrl === null ? mutedColor : valueColor}
        />
        <SettingRow
          testId="setting-row-model"
          label="IMAGE_GEN_MODEL"
          value={settings.model}
          labelColor={labelColor}
          valueColor={valueColor}
        />
        <SettingRow
          testId="setting-row-path"
          label="IMAGE_GEN_PATH"
          value={settings.path}
          labelColor={labelColor}
          valueColor={valueColor}
        />
        <SettingRow
          testId="setting-row-default-size"
          label="IMAGE_GEN_DEFAULT_SIZE"
          value={settings.defaultSize}
          labelColor={labelColor}
          valueColor={valueColor}
        />
        <SettingRow
          testId="setting-row-default-aspect"
          label="IMAGE_GEN_DEFAULT_ASPECT"
          value={settings.defaultAspect}
          labelColor={labelColor}
          valueColor={valueColor}
        />
        <SettingRow
          testId="setting-row-timeout-ms"
          label="IMAGE_GEN_TIMEOUT_MS"
          value={`${settings.timeoutMs} ms`}
          labelColor={labelColor}
          valueColor={valueColor}
        />
        <div
          data-testid="setting-row-api-key"
          data-role="setting-row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(8rem, max-content) 1fr",
            columnGap: "0.75rem",
            alignItems: "baseline",
            minWidth: 0,
          }}
        >
          <span
            data-role="setting-label"
            style={{ color: labelColor, fontWeight: 500 }}
          >
            IMAGE_GEN_API_KEY
          </span>
          <span
            data-testid="masked-api-key"
            data-role="setting-value"
            data-api-key-configured={apiKeyConfigured ? "true" : "false"}
            style={{
              color: apiKeyConfigured ? valueColor : mutedColor,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              wordBreak: "break-all",
              minWidth: 0,
            }}
          >
            {maskedApiKey}
          </span>
        </div>
      </div>

      <footer
        data-role="panel-footer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "0.5rem",
          minWidth: 0,
        }}
      >
        <button
          type="button"
          data-testid="retry-button"
          data-role="retry-button"
          aria-label="重试"
          disabled={retryDisabled}
          onClick={handleRetry}
          style={{
            color: retryDisabled ? mutedColor : accentColor,
            borderColor: retryDisabled ? mutedColor : accentColor,
            borderWidth: 1,
            borderStyle: "solid",
            borderRadius: "9999px",
            padding: "0.25rem 0.75rem",
            background: "transparent",
            cursor: retryDisabled ? "not-allowed" : "pointer",
            opacity: retryDisabled ? 0.6 : 1,
            fontWeight: 500,
          }}
        >
          重试
        </button>
      </footer>

      {showAgentDomainMismatch ? (
        <aside
          data-testid="agent-domain-mismatch-warning"
          data-role="agent-domain-mismatch-warning"
          role="note"
          style={{
            color: warningColor,
            borderColor: warningColor,
            borderWidth: 1,
            borderStyle: "solid",
            borderRadius: "0.375rem",
            padding: "0.5rem 0.75rem",
            background: "transparent",
            minWidth: 0,
          }}
        >
          <span data-role="warning-code" style={{ fontWeight: 600 }}>
            {AGENT_DOMAIN_MISMATCH_CODE}
          </span>
          <span data-role="warning-separator" aria-hidden="true">
            {": "}
          </span>
          <span data-role="warning-message">
            {AGENT_DOMAIN_MISMATCH_HINT_TEXT}
          </span>
        </aside>
      ) : null}
    </section>
  );
}

export default AutopilotImageSettingsPanel;
