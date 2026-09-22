/**
 * 舞台上的页面清单：落库 HTML + 导航里有、成品却缺的页。
 *
 * ⚠ 2026-08-20 Foclip：spec 四页，校验杀掉 p1/p4，侧栏仍列出四项。
 * 点「拾取工作台」时宿主 pages 里没有 p1，resolveActivePageId 回落最新
 * 页——点击像没发生。缺页必须仍能切过去，且不能冒充成品。
 */
import { navItemId, navItemName } from "./nav-item";
import { aliasIdsFor } from "./page-id-alias";
import { pageIsBoundFromSpec } from "./spec-page-bound";
import type { SpecPageLive } from "./live-runtime/SpecPageLiveStage";

export type SpecFirstPagesBlob = {
  pages?: Record<string, string>;
  navItems?: unknown[];
  device?: "desktop" | "phone" | "tablet";
  boundPages?: number;
  failedPages?: Record<string, unknown> | null;
  pageBindStatus?: Record<string, unknown> | null;
  /** 页面 id 别名表（旧 id → 新 id），第 4.5 步改键时记的。
   *  见 canonicalPageId 的头注：菜单孔烧的是改名前的 id。 */
  pageIdAliases?: Record<string, string> | null;
  /** ⚠ kind 必有：生产侧（Python spec_first_pipeline / marathon driver）一直必填，
   *  四处声明里只有这里和 ArchitectureStage 写成可选，对不上就往下传报 TS2322。 */
  qualityNotices?: Array<{ kind: string; text: string }>;
  capabilityPlan?: { tools?: string[] } | null;
} | null;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function missingPageHtml(opts: {
  pageId: string;
  name: string;
  reason: string;
  nav: Array<{ pageId: string; name: string }>;
  device?: "desktop" | "phone" | "tablet";
}): string {
  const links = opts.nav
    .map(item => {
      const current = item.pageId === opts.pageId ? ' aria-current="page"' : "";
      return `<a data-page-id="${escapeHtml(item.pageId)}"${current}><span>${escapeHtml(item.name || item.pageId)}</span></a>`;
    })
    .join("\n");
  const title = escapeHtml(opts.name || opts.pageId);
  const reason = escapeHtml(opts.reason || "生成校验未通过，这一页没有成品 HTML。");
  /**
   * ⚠ 2026-08-21 素材雷达：缺页骨架原来是桌面 aside+main、没有底、没有
   * 白底。塞进手机黑 iframe 就是「点创作黑屏」。手机必须自己带 header +
   * 底栏 + bg-white，菜单还能切回去。
   */
  if (opts.device === "phone") {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-white text-slate-800 flex flex-col h-full">
<header class="px-4 pb-3 border-b border-slate-100">
<div class="text-sm font-semibold">${title}</div>
</header>
<main class="flex-1 bg-white p-4" data-missing-page="${escapeHtml(opts.pageId)}">
<h1 class="text-base font-semibold">${title}</h1>
<p>这一页没有成品界面。菜单可以点进来，但内容不会假装还在另一页上。</p>
<p>${reason}</p>
</main>
<nav class="flex justify-around border-t border-slate-200 bg-white">${links}</nav>
</body></html>`;
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-white text-slate-800">
<aside><nav>${links}</nav></aside>
<main data-missing-page="${escapeHtml(opts.pageId)}">
<h1>${title}</h1>
<p>这一页没有成品界面。菜单可以点进来，但内容不会假装还在另一页上。</p>
<p>${reason}</p>
</main>
</body></html>`;
}

export function specNavEntries(spec: SpecFirstPagesBlob): Array<{ pageId: string; name: string }> {
  const nav = Array.isArray(spec?.navItems) ? spec!.navItems! : [];
  const out: Array<{ pageId: string; name: string }> = [];
  const seen = new Set<string>();
  for (const item of nav) {
    const id = navItemId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ pageId: id, name: navItemName(item) || id });
  }
  return out;
}

/** 导航顺序优先，落库有、导航没提到的页排后面。缺页也留在名单里。 */
export function specLivePageIds(spec: SpecFirstPagesBlob): string[] {
  const pages = spec?.pages && typeof spec.pages === "object" ? spec.pages : {};
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of specNavEntries(spec)) {
    ids.push(item.pageId);
    seen.add(item.pageId);
  }
  for (const id of Object.keys(pages)) {
    if (!seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}

export function livePagesFromSpec(
  specFirstPages: SpecFirstPagesBlob,
  specPages: SpecPageLive[] = []
): SpecPageLive[] {
  const settled = specFirstPages?.pages || null;
  if (!settled || Object.keys(settled).length === 0) return specPages;

  const nav = specNavEntries(specFirstPages);
  const ids = specLivePageIds(specFirstPages);
  const realCount = ids.filter(id => typeof settled[id] === "string" && settled[id]!.trim()).length;
  return ids.map((id, i) => {
    const html = typeof settled[id] === "string" ? settled[id] : "";
    const missing = !html.trim();
    const name = nav.find(n => n.pageId === id)?.name || id;
    const reason = String(specFirstPages?.failedPages?.[id] ?? "");
    return {
      pageId: id,
      // 人话名往下带（画布档的画板标题）。这里本来就算出来了，此前只喂给
      // missingPageHtml 就丢掉——画布上五块画板全叫 p1…p5 就是丢在这儿。
      name,
      html: missing ? missingPageHtml({ pageId: id, name, reason, nav: nav.length ? nav : ids.map(pid => ({ pageId: pid, name: pid })), device: specFirstPages?.device }) : html,
      current: i + 1,
      total: realCount,
      bound: missing ? false : pageIsBoundFromSpec(id, specFirstPages),
      device: specFirstPages?.device,
      missing,
      // 这一页背过的旧 id（菜单孔里烧的多半是其中之一）。挂在页面对象上
      // 而不是另立一份平行清单——照 friendly_id 的 has_many :slugs。
      aliasIds: aliasIdsFor(id, specFirstPages?.pageIdAliases),
    };
  });
}
