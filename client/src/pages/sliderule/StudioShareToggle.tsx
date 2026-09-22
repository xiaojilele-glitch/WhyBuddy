/**
 * 舞台顶栏的「私有 / 开放」开关。
 *
 * 应用中心卡片菜单里早就有（patchApp visibility），会话页顶上没有——
 * 用户原话「私有和开放没有看到在哪里」。跟应用中心共用同一份接口，
 * 改完两边读的是同一条记录。
 */
import React from "react";
import { Globe, Lock } from "lucide-react";

import {
  getGeneratedAppForSession,
  patchApp,
  type AppStoreSummary,
} from "@/pages/agent-loop/dashboard/app-store-client";

export function StudioShareToggle({
  sessionId,
  running = false,
  compact = false,
}: {
  sessionId?: string;
  running?: boolean;
  /** 窄列（手机预览）只留图标。Primer：Trailing action 在 narrow 收成图标。 */
  compact?: boolean;
}): React.ReactElement | null {
  const [app, setApp] = React.useState<AppStoreSummary | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void getGeneratedAppForSession(sessionId).then(row => {
      if (!cancelled) setApp(row);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, running]);

  if (!sessionId) return null;

  const ready = Boolean(app?.id);
  const isPrivate = app?.visibility !== "public" && app?.visibility !== "unlisted";
  const label = isPrivate ? "私有" : "开放";

  return (
    <button
      type="button"
      data-testid="sliderule-share-toggle"
      aria-pressed={!isPrivate}
      aria-label={label}
      disabled={busy || !ready}
      title={
        !ready
          ? "生成完成后才能改可见性，默认私有"
          : isPrivate
            ? "当前私有，点一下开放到应用市场"
            : "当前开放，点一下改回私有"
      }
      className={`flex h-7 items-center rounded-md border text-[12px] font-medium transition ${
        isPrivate
          ? "border-[#e5e7eb] bg-white text-stone-600 hover:bg-[#f8f9fb]"
          : "border-transparent bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
      } ${compact ? "w-7 justify-center" : "gap-1.5 px-2.5"}`}
      onClick={() => {
        if (!app?.id) return;
        const next = isPrivate ? "public" : "private";
        setBusy(true);
        void patchApp(app.id, { visibility: next })
          .then(ok => {
            if (ok) setApp({ ...app, visibility: next });
          })
          .finally(() => setBusy(false));
      }}
    >
      {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
      {compact ? null : label}
    </button>
  );
}
