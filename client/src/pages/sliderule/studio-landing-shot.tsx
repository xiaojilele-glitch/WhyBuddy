/**
 * 推演收口把落地页截成图，存进应用中心卡片。
 *
 * 首页曾经给每张 spec-first 卡挂一个 Tailwind iframe 活渲染——同屏几十张
 * 把主线程打满。正确的时机是推演刚结束：舞台上的页面已经渲染过一遍，
 * SnapDOM 拍同源 iframe（内部采 documentElement，见 lib/thumb-capture.ts），
 * POST 成 shot。下次进应用市场贴的是 <img>。
 *
 * 采的是**落地页**（导航第一项），不是用户此刻在舞台上翻到的那一页。所以
 * 另挂一个屏幕外的 HtmlAppSurface，不打扰正在看的人。
 *
 * fail-open：找不到 app_id、iframe 没编完、回传 4xx，都不挡推演收口。
 */

import React from "react";

import { captureAndUpload } from "@/lib/thumb-capture";
import { getGeneratedAppForSession } from "@/pages/agent-loop/dashboard/app-store-client";
import { specPageViewport } from "./live-runtime/canvas-scale";
import { deriveBindingSource } from "./live-runtime/derive-binding-source";
import { HtmlAppSurface } from "./live-runtime/html-app-surface";
import { seedRuntimeState } from "./live-runtime/demo-seed";
import { initRuntimeState, type RuntimeState } from "./live-runtime/live-runtime";
import { navItemId } from "./nav-item";
import type { FiveSystemModel } from "./system-screens/five-system-model";
import type { SpecPageLive } from "./live-runtime/SpecPageLiveStage";

/** 推演从 true 掉到 false 才采。打开一份已经跑完的会话不要再截一次。 */
export function rehearsalJustFinished(wasRunning: boolean, running: boolean): boolean {
  return wasRunning && !running;
}

export function landingPageFromSpec(
  specFirstPages:
    | {
        pages?: Record<string, string>;
        navItems?: unknown[];
        device?: "desktop" | "phone" | "tablet";
      }
    | null
    | undefined,
  specPages?: readonly Pick<SpecPageLive, "html" | "pageId" | "device">[] | null
): { html: string; device?: "desktop" | "phone" | "tablet" } | null {
  const pages = specFirstPages?.pages;
  const nav = Array.isArray(specFirstPages?.navItems) ? specFirstPages!.navItems : [];
  if (pages && typeof pages === "object") {
    for (const item of nav) {
      const id = navItemId(item);
      const html = id && typeof pages[id] === "string" ? pages[id].trim() : "";
      if (html) {
        return { html, device: specFirstPages?.device };
      }
    }
    for (const html of Object.values(pages)) {
      if (typeof html === "string" && html.trim()) {
        return { html: html.trim(), device: specFirstPages?.device };
      }
    }
  }
  const first = specPages?.find(p => (p.html || "").trim());
  if (first) {
    return { html: first.html.trim(), device: first.device };
  }
  return null;
}

const SETTLE_MS = 2000;

/**
 * 采集链每一步的去向都打一行。
 *
 * ⚠ 2026-08-23：这条链原本**全程静默**——查不到 app_id、落地页为空、找不到
 * 采集节点、回传非 2xx，一律 return / 吞异常，没有任何一处出声。现象就是
 * "应用好好的，就是没有封面"，没人知道该去哪儿看。同一条纪律见
 * services/freeform_block.py 的 `no silent caps`：一张都没生的时候必须说清
 * 是"没配 key"还是"通道不吃图"，否则现象只是"首页长得比较素"。
 */
export function capnote(message: string): void {
  try {
    console.info(`[landing-shot] ${message}`);
  } catch {
    /* 打日志本身不许成为故障源 */
  }
}

export function StudioLandingShot({
  sessionId,
  running,
  specFirstPages,
  specPages,
  model,
  runtime,
}: {
  sessionId?: string;
  running: boolean;
  specFirstPages?: {
    pages?: Record<string, string>;
    navItems?: unknown[];
    device?: "desktop" | "phone" | "tablet";
  } | null;
  specPages?: SpecPageLive[];
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
}): React.ReactElement | null {
  const wasRunning = React.useRef(false);
  const pending = React.useRef(false);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [job, setJob] = React.useState<{
    appId: string;
    html: string;
    device?: "desktop" | "phone" | "tablet";
  } | null>(null);

  React.useEffect(() => {
    if (rehearsalJustFinished(wasRunning.current, running)) {
      pending.current = true;
    }
    wasRunning.current = running;
  }, [running]);

  React.useEffect(() => {
    if (!pending.current || running || !sessionId) return;
    const landing = landingPageFromSpec(specFirstPages, specPages);
    if (!landing) {
      // ⚠ 不清 pending：页面可能比 running 晚一拍到，靠 deps 里的
      // specFirstPages/specPages 变化再进来一次。
      capnote("落地页还没拿到（specFirstPages/specPages 都是空的），等下一次变化");
      return;
    }
    pending.current = false;
    let cancelled = false;
    void (async () => {
      let row = await getGeneratedAppForSession(sessionId);
      if (!row?.id) {
        capnote(`第 1 次查 app_id 没查到（session=${sessionId}），800ms 后重试`);
        await new Promise(r => setTimeout(r, 800));
        row = await getGeneratedAppForSession(sessionId);
      }
      if (cancelled) return capnote("组件已卸载，放弃采集");
      if (!row?.id) {
        // 这里是本仓最典型的静默失效点：pending 已经清掉，不会再有第三次。
        return capnote(
          `两次都没查到 app_id（session=${sessionId}）——本次推演的封面**永久丢弃**，` +
            `不会再重试。落库比收口慢就会走到这里。`
        );
      }
      capnote(`拿到 app_id=${row.id}，挂离屏画面准备采集`);
      setJob({ appId: row.id, html: landing.html, device: landing.device });
    })();
    return () => {
      cancelled = true;
    };
  }, [running, sessionId, specFirstPages, specPages]);

  const source = React.useMemo(
    () =>
      deriveBindingSource(
        model ?? null,
        model ? runtime ?? seedRuntimeState(initRuntimeState(model), model) : null
      ),
    [model, runtime]
  );

  React.useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !hostRef.current) return;
      void captureAndUpload({
        appId: job.appId,
        container: hostRef.current,
        device: job.device,
        bypassBudget: true,
        replace: true,
      }).finally(() => {
        if (!cancelled) setJob(null);
      });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job]);

  if (!job) return null;

  const viewport = specPageViewport(job.device);
  return (
    <div
      ref={hostRef}
      aria-hidden
      data-testid="studio-landing-shot"
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: viewport.w,
        height: viewport.h,
        overflow: "hidden",
        pointerEvents: "none",
        background: "#fff",
      }}
    >
      <HtmlAppSurface html={job.html} source={source} fillPhone={job.device === "phone"} className="bg-white" />
    </div>
  );
}
