/**
 * 卡片缩略图采集（2026-08-02）。
 *
 * ## 这一层在干嘛
 *
 * 应用中心的卡片缩略图有三级来源，靠前的更可信：
 *
 *   ① shot  —— 应用真实渲染出来之后截的图，**就是应用本身**（这个模块产出的）
 *   ② sheet —— 生成时给设计 LLM 排版式用的那张首页参照板，是示意图
 *   ③ 活渲染 —— 前两级都没有时，卡片现挂一个真的 AppRuntimeScreen
 *
 * 采集发生在两处：
 *
 *   · ③ 首页活渲染（有预算）——既然那次昂贵的渲染已经发生了，就地采下来，
 *     于是「这次活渲染是最后一次」。
 *   · 推演收口（无预算、可覆盖）——舞台上的落地页已经渲染好了，SnapDOM
 *     拍同源 iframe 存成 shot。下次进应用中心贴的是图，不再给每张卡挂一个
 *     Tailwind iframe。
 *
 * 为什么不放在服务端起个无头浏览器去截：那等于把同一个应用再渲染一遍，还要背
 * 上沙盒/容器/浏览器安装那一整套运维面。副作用还是白赚的——**存量应用会被自动
 * 补上**：它们没有会话可供服务端打开（会话不跨重启存活），但只要有人看见过那
 * 张卡，它就有图了。
 *
 * ## 采集引擎：SnapDOM，不是 html2canvas
 *
 * ⚠ 2026-08-20：html2canvas 1.4.1 停在 2022，README 仍写 experimental；它自己
 * 重画 CSS，Tailwind 的 flex/grid/`::before`/CSS 变量是已知翻车点。我们还曾把
 * iframe 的 **body** 交给它——页面的 Tailwind Play 样式在 iframe `<head>` 里，
 * 只克隆 body 等于把样式表丢掉。真机上看得到、截出来是白底或没排版。
 *
 * GitHub 上这条链已经踩完了，别再发明：
 *
 *   · monday.com 工程博文 / modern-screenshot `clone-iframe.ts`：同源 iframe
 *     采 `contentDocument.documentElement`，不是 body（head 里的样式才进树）。
 *   · SnapDOM（`@zumer/snapdom`，LobeHub / 腾讯 tmagic-editor / Trilium 在用）
 *     对同源 iframe 走 `rasterizeIframe`：内部就是
 *     `toPng(contentDocument.documentElement)`，并 pin 视口（#449——整页
 *     scrollHeight 压进卡片会糊成一条）。#371 同样是「拍 body 丢 head 伪元素」。
 *
 * 所以这里把 **iframe 元素**交给 snapdom，让它走那条已经修过的路；老区块渲染
 * 没有 iframe，仍采缩放之前那一层。`embedFonts: false` 跟当年 skipFonts 同一
 * 取向——中文 webfont 内联会把主线程拖死，缩略图用系统字体即可。
 *
 * ## 为什么截的是缩放之前那一层
 *
 * 活渲染是把 1440×810（或手机档 405×720）的画布用 CSS transform 缩到 309px
 * 宽的卡片里。直接截卡片只能得到 309px 宽的糊图；截 transform 之前那一层拿到
 * 的是画布原尺寸，再乘 pixelRatio，才是一张能用的缩略图。iframe 用 offsetWidth
 * （布局尺寸），不受父级 transform 影响。
 *
 * ## 节流的纪律
 *
 * 单张实测约 3.6s，且最后合成那一下是同步的。所以：**全局串行**（一次只采一
 * 张）、**只采进了视口的**、**每次访问最多采几张**。缩略图是锦上添花，绝不能
 * 为了它把正在浏览的人卡住——这跟当初把活渲染分批挂载是同一个取向
 * （见 lib/mount-scheduler.ts）。
 */

import { aspectForDevice } from "./justified-rows";

/** 采集链的去向日志（与 studio-landing-shot 同一个前缀，便于一起 grep）。 */
function capnote(message: string): void {
  try {
    console.info(`[landing-shot] ${message}`);
  } catch {
    /* 打日志本身不许成为故障源 */
  }
}

/** 目标画幅：跟参照板出图、跟卡片比例三者对齐（见 justified-rows 的 DEVICE_ASPECT）。 */
const SHOT_CANVAS: Record<string, { w: number; h: number }> = {
  desktop: { w: 1280, h: 720 },
  tablet: { w: 1280, h: 720 },
  phone: { w: 720, h: 1280 },
};

/**
 * 一次访问最多采几张。
 *
 * 不设上限的话，第一次打开一个有 200 张卡的墙 = 200 次各 3.6s 的采集，
 * 页面全程发烫。设成 3：一次访问补 3 张，多来几次就补完了，而用户在任何一次
 * 访问里最多只付 3 次的代价。
 */
const MAX_PER_VISIT = 3;

/** 采完之后等一拍再采下一张，把主线程还给滚动和输入。 */
const GAP_MS = 400;

let capturedThisVisit = 0;
/** 全局串行锁：一次只采一张。 */
let chain: Promise<unknown> = Promise.resolve();
/** 本次访问已经处理过的 app_id——失败的也记，避免对着同一张卡反复重试。 */
const attempted = new Set<string>();

/** 测试用：把模块状态清回初始。生产代码不要调。 */
export function __resetCaptureStateForTests(): void {
  capturedThisVisit = 0;
  chain = Promise.resolve();
  attempted.clear();
}

export function captureBudgetLeft(): number {
  return Math.max(0, MAX_PER_VISIT - capturedThisVisit);
}

/**
 * 把采到的画布按目标画幅裁一刀。
 *
 * 从**左上角**切，不是居中裁。
 *
 * 2026-08-03 起画布与目标画幅同比（手机档 405×720 与 720×1280 都是 9:16），
 * 这一刀实际切不掉任何东西。留着不是冗余：
 *   · 画布尺寸与出图尺寸是两张表，谁先动都可能再次分叉，这里是最后一道兜底；
 *   · 兜底的方向必须是**留头去尾**——手机档一旦又变窄长，居中裁会把顶部那条
 *     应用标题栏切掉，而缩略图恰恰要那一截。
 * 这也跟活渲染那条路（AppRuntimeScreen 的 scaleFit="width"）看到的是同一块画面。
 */
function cropToAspect(
  src: HTMLCanvasElement,
  device: string | null | undefined
): HTMLCanvasElement {
  const target = SHOT_CANVAS[(device || "").trim().toLowerCase()] ?? SHOT_CANVAS.desktop;
  const targetAspect = target.w / target.h;

  let cw = src.width;
  let ch = Math.round(cw / targetAspect);
  if (ch > src.height) {
    ch = src.height;
    cw = Math.round(ch * targetAspect);
  }
  const out = document.createElement("canvas");
  out.width = target.w * 2;
  out.height = target.h * 2;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0, cw, ch, 0, 0, out.width, out.height);
  return out;
}

/**
 * WebP 编码质量。与服务端 thumb_image.WEBP_QUALITY 保持一致（0~1 vs 0~100）。
 *
 * 参照：Next.js Image 默认 75、thumbor 默认 80、imgproxy 默认 80。取 0.82 是
 * 因为这些是**界面截图**——大片纯色加细字，比照片更吃量化噪声，稍高一档更稳。
 */
const WEBP_QUALITY = 0.82;

/**
 * 采出来的画面编码成 blob。
 *
 * **直接出 WebP，不出 PNG**（2026-08-02）。实测同样分辨率下 805KB PNG →
 * 43KB WebP，小 19 倍，而分辨率一个像素不减。这条省的是两段流量：回传时的
 * 上行，以及之后每个访客看这张卡的下行（后者才是大头——应用中心一次首屏
 * 23 张卡，10.7MB → 约 0.9MB）。
 *
 * 服务端也会再压一次（thumb_image.to_webp），那是给参照板那一路和历史存量用的；
 * 已经是 WebP 的它会原样放行，不会重复编码掉画质。
 *
 * canvas.toBlob 对不认识的 type 会**静默回落成 PNG**（规范如此），所以这里
 * 显式检查一次实际拿到的类型——回落了就如实按 PNG 走，不假装省了带宽。
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
}

/** 浏览器空闲时再动手——采集是给缩略图用的，永远排在用户交互后面。 */
function whenIdle(): Promise<void> {
  return new Promise(resolve => {
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: unknown) => number })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 3000 });
    else setTimeout(resolve, GAP_MS);
  });
}

export interface CaptureRequest {
  /** 落库记录 id——回传按它写。 */
  appId: string;
  /** 活渲染的外层容器（data-testid="app-thumb-live" / app-thumb-html）。 */
  container: HTMLElement;
  /** 这个应用设计的档位，决定目标画幅。 */
  device?: string | null;
  /**
   * 推演刚结束、舞台已经渲染好：这一张必须采，不受 MAX_PER_VISIT 限制。
   *
   * 首页那条预算是防「200 张卡齐射」；推演收口只有一张，不该被首页的配额挤掉。
   */
  bypassBudget?: boolean;
  /**
   * 覆盖已有 shot。推演收口必须换图（这一版跟上一版长得不一样）；
   * 首页众包补图默认仍幂等——已经有图就别让路过的访客把图改掉。
   */
  replace?: boolean;
}

/** 回传地址。replace 才能覆盖已有 shot，默认路径保持幂等。 */
export function previewUploadUrl(appId: string, replace?: boolean): string {
  const base = `/api/sliderule/apps/${encodeURIComponent(appId)}/preview`;
  return replace ? `${base}?replace=1` : base;
}

/**
 * 真正该采的那一层 DOM。
 *
 * spec-first 页面跑在同源 iframe 里（html-app-surface）。对着父容器采，框内是
 * 空白——文档不在那棵树上。把 **iframe 元素**交给 SnapDOM：它内部采
 * `contentDocument.documentElement`（head 里的 Tailwind 才在树上），并 pin
 * 视口，不会把整页长滚动压进一张卡。
 *
 * 老区块渲染没有 iframe，仍采缩放之前那一层（卡片上的 transform 会把
 * 1440 画布压成 309px，直接采卡片是糊的）。
 */
export function resolveCaptureNode(container: HTMLElement): {
  kind: "iframe" | "dom";
  node: HTMLElement;
  iframe?: HTMLIFrameElement;
} | null {
  const iframe = container.querySelector<HTMLIFrameElement>(
    '[data-testid="html-app-surface"]'
  );
  const doc = iframe?.contentDocument ?? null;
  const body = doc?.body ?? null;
  const root = doc?.documentElement ?? null;
  if (
    iframe &&
    root &&
    body &&
    (body.childElementCount > 0 || Boolean((body.textContent || "").trim())) &&
    (body.offsetWidth > 0 || body.scrollWidth > 0 || iframe.clientWidth > 0)
  ) {
    return { kind: "iframe", node: iframe, iframe };
  }
  const scaled = container.querySelector<HTMLElement>("[style*='transform']");
  const node = (scaled?.firstElementChild as HTMLElement | null) ?? scaled;
  if (!node || !node.offsetWidth || !node.offsetHeight) return null;
  return { kind: "dom", node };
}

/**
 * 节点 → canvas。**导出给画布档的「导出 PNG」复用**（2026-08-25）。
 *
 * ⚠ 别在画布那边另写一份 snapdom 调用：dpr / embedFonts / backgroundColor /
 *   fast 这四个参数是这个仓踩出来的（见本文件头注里 iframe 那条），
 *   抄一份过去就是同一件事两套写法，改一处忘一处。要改一起改。
 */
export async function captureNodeToCanvas(
  node: HTMLElement
): Promise<HTMLCanvasElement> {
  return nodeToCanvas(node);
}

async function nodeToCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  const { snapdom } = await import("@zumer/snapdom");
  const iframe = node.tagName === "IFRAME";
  return snapdom.toCanvas(node, {
    dpr: 2,
    embedFonts: false,
    backgroundColor: iframe ? "#ffffff" : "#f0f2f5",
    fast: true,
  });
}

/**
 * 采一张并回传。**从不抛**——调用方在渲染路径上，采集失败只该意味着"这张卡
 * 这次没补上图"，下次再说。
 *
 * 返回是否真的存进去了（预算用完 / 已采过 / 找不到节点 / 回传被服务端跳过
 * 都会返回 false）。
 */
export function captureAndUpload(req: CaptureRequest): Promise<boolean> {
  const { appId, container, device, bypassBudget, replace } = req;
  if (!appId || !container) return Promise.resolve(false);
  if (!bypassBudget) {
    if (attempted.has(appId)) return Promise.resolve(false);
    if (capturedThisVisit >= MAX_PER_VISIT) return Promise.resolve(false);
    attempted.add(appId);
    capturedThisVisit += 1;
  }

  const run = chain.then(async () => {
    try {
      await whenIdle();
      const resolved = resolveCaptureNode(container);
      if (!resolved) {
        // iframe 还没编完 / 没内容 / 宽高为 0 都落这里。
        capnote(`找不到可采的节点（app=${appId}）——画面还没渲染好就来采了`);
        return false;
      }

      const canvas = await nodeToCanvas(resolved.node);
      const blob = await canvasToBlob(cropToAspect(canvas, device));
      if (!blob) {
        capnote(`画布转 blob 失败（app=${appId}）`);
        return false;
      }

      const res = await fetch(previewUploadUrl(appId, replace), {
        method: "POST",
        // 按 blob 实际类型报，不写死——toBlob 不认 webp 时会静默回落成 PNG。
        headers: { "Content-Type": blob.type || "image/webp" },
        body: blob,
      });
      if (!res.ok) {
        // 403 = 内部 key 没注入；404 = 看不见这个应用（私有/未登录）；
        // 413 = 图太大；415 = 类型不认。每一种的修法都不一样，必须报出来。
        capnote(`回传被拒 HTTP ${res.status}（app=${appId}, replace=${Boolean(replace)}）`);
        return false;
      }
      const json = (await res.json().catch(() => null)) as
        | { stored?: boolean; reason?: string }
        | null;
      if (!json?.stored) {
        capnote(`服务端没存（app=${appId}）：${json?.reason || "未说明"}`);
        return false;
      }
      capnote(`已存入（app=${appId}, ${blob.size} 字节 ${blob.type}）`);
      return true;
    } catch (err) {
      // 采集是增强项：任何异常都只意味着这次没补上图——但不许连原因都不说。
      capnote(`采集抛异常（app=${appId}）：${String(err).slice(0, 200)}`);
      return false;
    }
  });

  // 串行：下一张要等这一张彻底结束（成功与否都算），中间再空一拍。
  chain = run.then(() => new Promise(r => setTimeout(r, GAP_MS)));
  return run;
}

/** 这个档位的目标画幅宽高比——给测试用，确保跟卡片比例是同一份定义。 */
export function shotAspectForDevice(device: string | null | undefined): number {
  const target = SHOT_CANVAS[(device || "").trim().toLowerCase()] ?? SHOT_CANVAS.desktop;
  return target.w / target.h;
}

/** 断言用：采集画幅必须跟卡片比例一致，否则贴上去会被 object-fit: cover 裁。 */
export function shotMatchesCardAspect(device: string | null | undefined): boolean {
  return Math.abs(shotAspectForDevice(device) - aspectForDevice(device)) < 1e-6;
}
