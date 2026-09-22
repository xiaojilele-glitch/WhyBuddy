/**
 * Cursor 风格设置件：分组行（左标题说明 / 右控件），中性选中，不要 Ant 蓝。
 *
 * ⚠ 2026-08-20：设置中心原先 Cherry Studio / TRAE 白卡片 + `#1677ff` 导航。
 * 用户要 Cursor Settings 那种密度和排版。控件色跟外壳走近黑，不跟 Ant Design。
 */
import React from "react";

export const SETTINGS_INPUT_CLASS =
  "h-8 max-w-full rounded-md border border-black/[0.08] bg-[#fafafa] px-2.5 text-[13px] text-[#171717] outline-none transition placeholder:text-[#a3a3a3] focus:border-black/20 focus:bg-white";

export const SETTINGS_PRIMARY_BTN =
  "inline-flex h-8 items-center rounded-md bg-[#171717] px-3.5 text-[13px] font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40";

export const SETTINGS_GHOST_BTN =
  "inline-flex h-8 items-center rounded-md border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-[#3f3f46] transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

export const SETTINGS_DANGER_BTN =
  "inline-flex h-8 items-center rounded-md border border-red-200 bg-white px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";

export function SettingsPane({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`mx-auto w-full px-8 py-8 ${wide ? "max-w-[1100px]" : "max-w-[720px]"}`}
    >
      <h1 className="mb-6 text-[22px] font-semibold tracking-tight text-[#171717]">
        {title}
      </h1>
      <div className="space-y-8">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  testId,
  children,
}: {
  title?: string;
  testId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section data-testid={testId}>
      {title ? (
        <h2 className="mb-2 px-0.5 text-[12px] font-medium text-[#737373]">
          {title}
        </h2>
      ) : null}
      <div className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.08] bg-white">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  align = "center",
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "start";
}): React.ReactElement {
  return (
    <div
      className={`flex justify-between gap-6 px-4 py-[14px] ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[#171717]">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-5 text-[#737373]">
            {description}
          </div>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

export function SettingsToggle({
  checked,
  onChange,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-[#171717]" : "bg-[#d4d4d4]"
      }`}
    >
      <span
        className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-[left] ${
          checked ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange?: (v: T) => void;
}): React.ReactElement {
  return (
    <div className="inline-flex max-w-full gap-0.5 rounded-lg bg-black/[0.05] p-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(opt.value)}
          title={opt.hint}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${
            value === opt.value
              ? "bg-white text-[#171717] shadow-sm"
              : "text-[#737373] hover:text-[#171717]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
