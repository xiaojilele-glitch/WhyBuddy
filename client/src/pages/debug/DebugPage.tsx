import {
  Bug,
  GitBranch,
  HelpCircle,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { AuditPanel } from "@/components/AuditPanel";
import {
  getDebugPath,
  resolveDebugTab,
  type DebugTab,
} from "@/components/navigation-config";
import { LineageWorkspaceContent } from "@/components/lineage/LineageWorkspaceContent";
import { PermissionPanel } from "@/components/permissions/PermissionPanel";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export default function DebugPage() {
  const { locale, copy } = useI18n();
  const [location, setLocation] = useLocation();
  const setConfigOpen = useAppStore(state => state.setConfigOpen);
  const activeTabFromPath = useMemo(
    () => resolveDebugTab(location),
    [location]
  );
  const [activeTab, setActiveTab] = useState<DebugTab>(activeTabFromPath);

  useEffect(() => {
    setActiveTab(activeTabFromPath);
  }, [activeTabFromPath]);

  useEffect(() => {
    setConfigOpen(activeTab === "config");
    return () => setConfigOpen(false);
  }, [activeTab, setConfigOpen]);

  const handleTabChange = (nextTab: DebugTab) => {
    setActiveTab(nextTab);
    setLocation(getDebugPath(nextTab));
  };

  return (
    <WorkspacePageShell
      eyebrow={t(locale, "内部调试面", "Internal Debug Surface")}
      title={t(locale, "低频治理与调试入口", "Low-frequency Governance Tools")}
      description={t(
        locale,
        "这个页面不作为普通用户主路径暴露，只承接内部调试、治理与低频工具访问。",
        "This route is intentionally hidden from the normal primary flow and only holds internal debugging, governance, and low-frequency tools."
      )}
    >
      <WorkspacePanel strong className="p-5">
        <div className="grid gap-4 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => handleTabChange("lineage")}
            className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "数据血缘", "Data Lineage")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "血缘能力已开始并入隐藏调试面；旧 `/lineage` 深链继续兼容跳转到这里。",
                    "Lineage has started moving into the hidden debug surface, while the old `/lineage` deep link now redirects here for compatibility."
                  )}
                </div>
              </div>
              <GitBranch className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("config")}
            className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "运行时配置", "Runtime Configuration")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "模型来源、运行时与浏览器同步等低频操作继续通过配置面板管理。",
                    "Keep runtime mode, model source, and browser-sync controls in the configuration panel."
                  )}
                </div>
              </div>
              <Settings2 className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>

          <div className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "调试说明", "Debug Notes")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "本轮先收口入口心智，不要求把所有低频工具完全迁入同一页；这里先提供隐藏壳与统一落点。",
                    "This pass prioritizes navigation convergence rather than fully migrating every low-frequency tool into one page."
                  )}
                </div>
              </div>
              <Bug className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleTabChange("help")}
            className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "使用说明", "Usage Notes")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "原先留在 More 抽屉里的帮助说明也已并入这里，普通主路径不再单独弹出低频引导模态。",
                    "The help content that used to stay in the More drawer now also lives here, so the normal primary path no longer opens a separate low-frequency guidance modal."
                  )}
                </div>
              </div>
              <HelpCircle className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="p-5">
        <div className="flex flex-wrap gap-2">
          {([
            ["overview", t(locale, "概览", "Overview")],
            ["config", t(locale, "配置", "Config")],
            ["permissions", t(locale, "权限", "Permissions")],
            ["audit", t(locale, "审计", "Audit")],
            ["lineage", t(locale, "血缘", "Lineage")],
            ["help", t(locale, "帮助", "Help")],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => handleTabChange(id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === id
                  ? "bg-[#5E8B72] text-white"
                  : "bg-white/70 text-[var(--workspace-text-muted)] hover:bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "overview" ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/44 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text-strong)]">
                <ShieldCheck className="size-4 text-[var(--studio-sage-strong)]" />
                {t(locale, "权限与治理", "Permissions and Governance")}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--workspace-text-muted)]">
                {t(
                  locale,
                  "权限矩阵、审计链路与运行时配置都属于低频治理能力，应从普通主路径退场，收敛到这里或其他隐藏入口。",
                  "Permission matrices, audit trails, and runtime governance are low-frequency capabilities and should live behind this internal surface instead of the normal primary path."
                )}
              </p>
            </div>

            <div className="rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/44 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text-strong)]">
                <GitBranch className="size-4 text-[var(--studio-accent-strong)]" />
                {t(locale, "深链保留", "Deep-link Compatibility")}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--workspace-text-muted)]">
                {t(
                  locale,
                  "像 `/lineage` 这类旧路径仍可保留兼容跳转，但普通用户不再从主导航直接进入，主承接面改为 `/debug/lineage`。",
                  "Legacy deep links such as `/lineage` can remain as compatibility redirects, but they should no longer be promoted through the normal primary navigation. The primary surface now lives at `/debug/lineage`."
                )}
              </p>
            </div>
          </div>
        ) : null}

        {activeTab === "lineage" ? (
          <div className="mt-5">
            <LineageWorkspaceContent embedded />
          </div>
        ) : null}

        {activeTab === "config" ? (
          <div className="mt-5 rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70 px-4 py-4 text-sm leading-6 text-[var(--workspace-text-muted)]">
            {t(
              locale,
              "运行时、模型来源与浏览器同步配置已经从 More 抽屉收口到这个隐藏调试面。当前会继续复用全局配置侧板，而不是在这里再挂一份独立配置页。",
              "Runtime mode, model source, and browser-sync controls have been pulled out of the More drawer and collected under this hidden debug surface. This route reuses the shared global configuration panel instead of mounting a second standalone config page here."
            )}
          </div>
        ) : null}

        {activeTab === "permissions" ? (
          <div className="mt-5 h-[640px] overflow-hidden rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70">
            <PermissionPanel />
          </div>
        ) : null}

        {activeTab === "audit" ? (
          <div className="mt-5 h-[640px] overflow-hidden rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70">
            <AuditPanel />
          </div>
        ) : null}

        {activeTab === "help" ? (
          <div className="mt-5 grid gap-4">
            <div className="rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70 px-5 py-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text-strong)]">
                <HelpCircle className="size-4 text-[var(--studio-accent-strong)]" />
                {copy.toolbar.helpTitle}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--workspace-text-muted)]">
                {copy.toolbar.helpDescription}
              </p>
            </div>

            <div className="grid gap-3">
              {copy.toolbar.quickTips.map((tip: string) => (
                <div
                  key={tip}
                  className="rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/70 px-5 py-4 text-sm leading-6 text-[var(--workspace-text-muted)]"
                >
                  {tip}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </WorkspacePanel>

    </WorkspacePageShell>
  );
}
