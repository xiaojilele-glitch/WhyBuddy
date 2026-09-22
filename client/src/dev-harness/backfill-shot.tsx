/**
 * 存量应用补封面用的渲染 + 采集（给 scripts/backfill-app-shots.mjs 调）。
 *
 * ## 为什么住在源码树里，而不是脚本里内联
 *
 * 第一版把这段写在 Playwright 的 `page.evaluate` 内联里，`import('react')`
 * 直接炸：裸模块名只有**经过 Vite 转换的模块**才会被改写，内联 eval 不是。
 * 挪进来之后 Vite 正常转换，顺带还能过 tsc。
 *
 * ## 它跟线上收口采集是同一段代码
 *
 * 落地页怎么挑（landingPageFromSpec）、怎么渲（HtmlAppSurface + 同一套绑定
 * 数据源）、怎么采怎么回传（captureAndUpload，bypassBudget + replace），
 * 全部复用 studio-landing-shot 那条路。**不另写一份**——另写一份的后果是
 * 补出来的图跟收口采的图不是一个画幅/一个观感，而且不会有人发现。
 *
 * ⚠ 只在开发/运维脚本里用。应用本身不 import 它，所以不会进生产包。
 */
import React from "react";
import { createRoot } from "react-dom/client";

import { captureAndUpload } from "@/lib/thumb-capture";
import { landingPageFromSpec } from "@/pages/sliderule/studio-landing-shot";
import { specPageViewport } from "@/pages/sliderule/live-runtime/canvas-scale";
import { deriveBindingSource } from "@/pages/sliderule/live-runtime/derive-binding-source";
import { seedRuntimeState } from "@/pages/sliderule/live-runtime/demo-seed";
import { initRuntimeState } from "@/pages/sliderule/live-runtime/live-runtime";
import { HtmlAppSurface } from "@/pages/sliderule/live-runtime/html-app-surface";
import type { FiveSystemModel } from "@/pages/sliderule/system-screens/five-system-model";

export interface BackfillRequest {
  appId: string;
  pagesJson: unknown;
  modelJson: unknown;
  /** false = dry-run：照常渲染采集，但把回传拦下来只报大小，不写库。 */
  apply: boolean;
  /** 渲染完等多久再采。默认与 studio-landing-shot 的 SETTLE_MS 同量级。 */
  settleMs?: number;
}

export interface BackfillResult {
  skip?: string;
  stored?: boolean;
  device?: string;
  bytes?: number | null;
  type?: string | null;
}

export async function renderAndCapture(req: BackfillRequest): Promise<BackfillResult> {
  const { appId, pagesJson, modelJson, apply, settleMs = 2500 } = req;
  const landing = landingPageFromSpec(
    pagesJson as Parameters<typeof landingPageFromSpec>[0],
    null
  );
  if (!landing) return { skip: "没有可渲染的落地页" };

  const model =
    modelJson && typeof modelJson === "object" && Object.keys(modelJson).length > 0
      ? (modelJson as FiveSystemModel)
      : null;
  const source = deriveBindingSource(
    model,
    model ? seedRuntimeState(initRuntimeState(model), model) : null
  );
  const vp = specPageViewport(landing.device);

  const host = document.createElement("div");
  host.setAttribute("data-backfill-host", "1");
  // 离屏挂载：跟 studio-landing-shot 一样，不打扰正在看的人。
  host.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${vp.w}px;height:${vp.h}px;` +
    `overflow:hidden;background:#fff;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    React.createElement(HtmlAppSurface, {
      html: landing.html,
      source,
      fillPhone: landing.device === "phone",
      className: "bg-white",
    })
  );
  await new Promise(r => setTimeout(r, settleMs));

  // ⚠ 用可变容器而不是 `let posted = null`：赋值发生在下面 fetch 的闭包里，
  //   TS 的控制流分析看不见，会把读取点收窄成 never（实测报
  //   "Property 'bytes' does not exist on type 'never'"）。对象属性不吃这套收窄。
  const captured: { value: { bytes: number | null; type: string | null } | null } = {
    value: null,
  };
  const originalFetch = window.fetch;
  if (!apply) {
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? "");
      if (url.includes("/preview")) {
        const body = init?.body as Blob | undefined;
        captured.value = { bytes: body?.size ?? null, type: body?.type ?? null };
        return new Response(JSON.stringify({ stored: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }

  try {
    const stored = await captureAndUpload({
      appId,
      container: host,
      device: landing.device,
      // 收口那条路同款：不占首页配额、且必须覆盖旧图。
      bypassBudget: true,
      replace: true,
    });
    const sent = captured.value;
    return { stored, device: landing.device, bytes: sent?.bytes ?? null, type: sent?.type ?? null };
  } finally {
    if (!apply) window.fetch = originalFetch;
    root.unmount();
    host.remove();
  }
}
