/**
 * FreeformPreviewScreen — FreeformInsight 自我校验闭环专用的隔离预览页
 * （2026-07-24，路由 /sliderule/freeform-preview/:pid）。
 *
 * 背景：generate_freeform_block 生成出一份候选 JSON 后，想真实渲染一次截图
 * 跟参考图比对（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：
 * 生成→截图→自己看→改）。候选内容这时还没写进任何 session，不能走
 * AppRuntimeScreen 那套完整应用外壳（侧边栏/顶栏/聊天面板都是噪音，只会
 * 让截图跟"这块内容区长什么样"这个问题脱节）——这个页面只渲染内容区
 * 本身，用真实的 ExperienceBlockBoundary/FreeformInsightRenderer，
 * 不是另起一套渲染逻辑，跟正式应用里看到的是同一套渲染代码。
 *
 * 内容来自后端临时预览存储（services/freeform_preview_store.py），几分钟
 * 内过期、一次性、不落盘——不是走真实 session。
 */

import React from "react";
import { ConfigProvider } from "antd";
import { ExperienceBlockBoundary } from "./block-registry";
import type { ExperienceBlockInstance } from "./block-registry";
import { resolveIdentityTheme } from "./identity-themes";
import type { RuntimeRow } from "./live-runtime";

interface FreeformPreviewPayload {
  freeformContent?: { root: Record<string, unknown> };
  themeId?: string;
  generatedTheme?: Record<string, unknown>;
  device?: string;
  entityRows?: Record<string, RuntimeRow[]>;
}

const DEVICE_CONTENT_WIDTH: Record<string, number> = {
  phone: 380,
  tablet: 900,
  desktop: 1200,
};

export default function FreeformPreviewScreen({ pid }: { pid?: string }) {
  const [payload, setPayload] = React.useState<FreeformPreviewPayload | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ok" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    if (!pid) {
      setStatus("error");
      return;
    }
    fetch(`/api/sliderule/freeform-preview/${encodeURIComponent(pid)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: FreeformPreviewPayload) => {
        if (cancelled) return;
        setPayload(data);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [pid]);

  if (status === "loading") {
    return <div data-testid="freeform-preview-loading" style={{ padding: 24 }} />;
  }
  if (status === "error" || !payload?.freeformContent) {
    return (
      <div data-testid="freeform-preview-error" style={{ padding: 24, color: "#999" }}>
        预览内容不可用或已过期
      </div>
    );
  }

  const identityTheme = resolveIdentityTheme(payload.themeId, payload.generatedTheme);
  const device = payload.device || "desktop";
  const width = DEVICE_CONTENT_WIDTH[device] ?? DEVICE_CONTENT_WIDTH.desktop;
  const block: ExperienceBlockInstance = {
    id: "freeform-preview",
    type: "FreeformInsight",
    freeformContent: payload.freeformContent,
  };

  return (
    <ConfigProvider theme={{ token: { colorPrimary: identityTheme.primary } }}>
      <div
        data-testid="freeform-preview-root"
        style={{
          width,
          minHeight: 200,
          background: identityTheme.contentBg,
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <ExperienceBlockBoundary
          block={block}
          previewId={pid}
          entityRows={payload.entityRows || {}}
          chartPalette={{ primary: identityTheme.primary, categorical: identityTheme.charts }}
        />
      </div>
    </ConfigProvider>
  );
}
