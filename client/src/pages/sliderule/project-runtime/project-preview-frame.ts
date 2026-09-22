/**
 * 预览框盖层：票到了 ≠ 人看见了页面。
 *
 * ⚠ 2026-09-19 坦克大战：`entryUrl` 一到就把空 iframe 甩上去。
 *   票的入口是 `/_whybuddy/authorize?ticket=…`，网关兑完 303 到 `/`，
 *   响应体是空的；再走隧道拉 Vite。这段 host 什么都不盖，地址栏还
 *   把一次性票摊在脸上。人看见的就是白屏很久。
 *
 * load 只收盖层。票兑没兑成仍是中继说了算——`useProjectPreview`
 * 写过：iframe load 不能证明 redemption。
 */

export function previewAddressPath(entryUrl: string): string {
  try {
    const url = new URL(entryUrl);
    if (url.pathname === "/_whybuddy/authorize") return "/";
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return entryUrl;
  }
}

export function previewIsAuthorizeEntry(entryUrl: string): boolean {
  try {
    return new URL(entryUrl).pathname === "/_whybuddy/authorize";
  } catch {
    return false;
  }
}

/**
 * title / 已发布主机的外开地址。授权入口只剥票，不拿来当 href。
 *
 * ⚠ 2026-09-19 真机两记：
 *   1. `href={entryUrl}` 把 iframe 已兑过的票再兑一次 → preview_expired。
 *   2. 改成 `${origin}/` 以为能吃 iframe 的 cookie。HTTPS 网关种的是
 *      `SameSite=None; Partitioned`（CHIPS）。iframe 兑票锁在工作台分区，
 *      新标签是顶层第一方，带不走，网关 401。外开必须另开一张票，
 *      在顶层兑；iframe 那张不许动。
 */
export function previewOpenUrl(entryUrl: string): string {
  try {
    const url = new URL(entryUrl);
    if (url.pathname === "/_whybuddy/authorize") return `${url.origin}/`;
    return url.href;
  } catch {
    return entryUrl;
  }
}

export function previewAddressTitle(entryUrl: string): string {
  return previewOpenUrl(entryUrl);
}

export function previewFrameCovered(input: {
  entryUrl: string | null;
  frameReady: boolean;
}): boolean {
  return Boolean(input.entryUrl) && !input.frameReady;
}

/**
 * 授权入口那一次 load 只说明兑票的 303 回来了，页面还是空的。
 *
 * ⚠ 2026-09-19 飞机大战：`src` 属性仍是票，iframe 已经跟到空 `/`，
 *   盖层按第一次 load 揭开，人看见白屏；自己刷新才是带 cookie 的
 *   `origin/`。兑完再把框指到 `previewOpenUrl`，那一次 load 才揭。
 *   花掉的票不许再兑。
 */
export function previewFrameAfterLoad(input: {
  entryUrl: string;
  loadedSrc: string;
}): { nextSrc: string; ready: boolean } {
  if (previewIsAuthorizeEntry(input.loadedSrc)) {
    return { nextSrc: previewOpenUrl(input.entryUrl), ready: false };
  }
  return { nextSrc: input.loadedSrc, ready: true };
}
