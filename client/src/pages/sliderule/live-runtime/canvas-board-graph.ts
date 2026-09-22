/**
 * 画布上的**关系**与**素材**：连线怎么来、素材图怎么来。全是纯函数，单测钉着。
 *
 * ## 连线为什么不是"读 data-page-id 画出来"（2026-08-25 量过才知道）
 *
 * 第一版设计是"页面 HTML 里有 `data-page-id` 链接就画一条边"。听着天经地义，
 * 拿三个真机会话量了一遍：
 *
 *     团购 5 页    每页都链到全部 5 页 → 20 条有向边
 *     销售 CRM 4 页 每页都链到全部 4 页 → 12 条有向边
 *
 * 因为这些应用的左侧菜单是**共享外壳**，每页都带着整份菜单。全画出来就是
 * 完全图——`SystemLinkageGraph` 头注早就写过这个形状："上一版把全网铺开再靠
 * 点选压暗，看起来就是毛线团"。
 *
 * 那只画**页内跳转**（不在 nav/aside/header/footer 里的链接）呢？用标签栈
 * 又量了一遍：**三个会话全是 0 条**。也就是说这些应用真的就是扁平 hub 结构，
 * 页面之间没有"流"。
 *
 * ## 那派生一条数据流边呢？也量了，也几乎是空的
 *
 * 规则是有依据的：`page.modelSection` 里每页声明 `fieldBindings`（实体.字段）
 * 与 `actionPermissions`（实体:操作），于是"写某实体的页 → 读同实体的页"
 * 就是一条有证据的数据流。实测：
 *
 *     团购    1 条（p2 活动管理 → p1 团长工作台，group_activity）
 *     销售 CRM 0 条
 *     投资打卡 0 条
 *
 * **一个只会画出 0~1 条线的功能不叫功能。** 所以派生边留着（有就画，是真的），
 * 但它不是主角，而且没有的时候要**如实说没有**，不许静静地什么都不画让用户
 * 以为坏了。
 *
 * ## 主角是手画的连线
 *
 * 既然产物里客观上没有流，那"这两页之间应该能跳过去"就只能是**人的意图**。
 * 参考工具（截图里那个）的节点菜单第一项就叫「编辑连线」，也是这个道理。
 *
 * ⚠ 但手画的线**不许只是装饰**。画完能一键落回一句话（页面作用域的精修指令，
 *   走 refine_page_scope 那条既有链路），它才是"在设计，而不是在涂鸦"。
 *   这条是这个功能成立的前提，删了它就该把整条连线一起删掉。
 *
 * ## 素材图
 *
 * 从各页 HTML 里把 `<img src>` 扒出来去重。真机量到的比想象中有用：
 * 团购 5 页共 9 张图，**8 张是 placehold.co 占位图**——这件事在页面档里
 * 一页一页翻是看不出来的，摊在画布上一眼就看见。所以占位图要单独标出来，
 * 这是这一档最实的产出之一。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import { layoutDevice } from "../product-archetypes";
import { parseBlocksFromHtml, type BlockIdentity } from "./page-blocks";

/* ------------------------------------------------------------------ 连线 */

export type BoardLinkKind = "dataflow" | "manual";

export interface BoardLink {
  id: string;
  /** 源画板的 pageId */
  from: string;
  /** 目标画板的 pageId */
  to: string;
  kind: BoardLinkKind;
  /** 边上的标注：派生边是实体名，手画边是用户写的（缺省"跳转"） */
  label: string;
}

/** 非读操作一律算"写"。approve/submit/export 这些都会改变对方看到的东西。 */
function isWriteOp(op: string): boolean {
  return op.trim().toLowerCase() !== "read";
}

function entityOfBinding(binding: string): string {
  const s = String(binding || "").trim();
  const dot = s.indexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

/** 实体 id → 人话名。查不到就回 id（如实，不编）。 */
export function entityLabel(
  model: FiveSystemModel | null | undefined,
  id: string
): string {
  const hit = (model?.datamodel?.entities ?? []).find(e => e?.id === id);
  return (hit?.name || "").trim() || id;
}

/**
 * 派生数据流边：**写某实体的页 → 读同实体的页**。
 *
 * ⚠ 真机上这通常是 0~1 条（见文件头注）。调用方必须处理"一条都没有"，
 *   而且要如实告诉用户是"没有"而不是"没画出来"。
 *
 * 自环（同一页既写又读）不画——那不是页面之间的关系。
 * 同一对页面因多个实体产生多条边时合成一条，标注用顿号连起来：
 * 两页之间画三条平行线只是噪声。
 */
export function deriveDataflowLinks(
  model: FiveSystemModel | null | undefined,
  pageIds: readonly string[]
): BoardLink[] {
  const known = new Set(pageIds);
  const writers = new Map<string, Set<string>>();
  const readers = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!k) return;
    const s = m.get(k) ?? new Set<string>();
    s.add(v);
    m.set(k, s);
  };

  for (const page of model?.page?.pages ?? []) {
    const pid = String(page?.id || "");
    if (!pid || !known.has(pid)) continue;
    // 绑了字段就是读得到——不需要再要一条 read 权限来证明。
    for (const b of page.fieldBindings ?? [])
      add(readers, entityOfBinding(b), pid);
    for (const perm of page.actionPermissions ?? []) {
      const raw = String(perm || "");
      const i = raw.indexOf(":");
      if (i <= 0) continue;
      const ent = raw.slice(0, i).trim();
      const op = raw.slice(i + 1);
      add(isWriteOp(op) ? writers : readers, ent, pid);
    }
  }

  /** from>to 的实体清单，最后合成一条边。 */
  const pairs = new Map<string, { from: string; to: string; ents: string[] }>();
  for (const [ent, ws] of writers) {
    for (const w of ws) {
      for (const r of readers.get(ent) ?? []) {
        if (r === w) continue;
        const key = `${w}->${r}`;
        const slot = pairs.get(key) ?? { from: w, to: r, ents: [] };
        if (!slot.ents.includes(ent)) slot.ents.push(ent);
        pairs.set(key, slot);
      }
    }
  }

  // 输出顺序跟 pageIds 的顺序走，跟画板排布同序——不然每次渲染边的次序会飘。
  const order = (id: string) => {
    const i = pageIds.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...pairs.values()]
    .sort((a, b) => order(a.from) - order(b.from) || order(a.to) - order(b.to))
    .map(p => ({
      id: `df:${p.from}->${p.to}`,
      from: p.from,
      to: p.to,
      kind: "dataflow" as const,
      ents: p.ents,
      label: p.ents.map(e => entityLabel(model, e)).join("、"),
    }))
    .map(({ ents: _ents, ...link }) => link);
}

/* --------------------------------------------------- 手画连线的存取 */

/** 一个会话一份。⚠ 带上 sessionId：不带的话换会话会看到上一个应用的连线。 */
export function manualLinksStorageKey(
  sessionId: string | null | undefined
): string {
  return `sliderule:canvas-links:${sessionId || "anon"}`;
}

/** 一个会话最多存这么多条。手画的东西没有上限就会有人画出一屏乱麻。 */
export const MANUAL_LINK_CAP = 60;

/**
 * 解析存下来的手画连线。
 *
 * ⚠ **必须按当前页面清单过滤**：重新推演之后 pageId 会变（或某页没生成出来），
 *   存档里指向不存在页面的线如果照单全收，React Flow 会拿到指向空节点的边，
 *   轻则不画重则报错——而存档是用户自己的浏览器里躺着的旧数据，永远会有。
 */
export function readManualLinks(
  raw: string | null | undefined,
  pageIds: readonly string[]
): BoardLink[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // 存档坏了当没有，不炸画布
  }
  if (!Array.isArray(parsed)) return [];
  const known = new Set(pageIds);
  const out: BoardLink[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const from = String(rec.from ?? "");
    const to = String(rec.to ?? "");
    if (!from || !to || from === to) continue;
    if (!known.has(from) || !known.has(to)) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `mn:${key}`,
      from,
      to,
      kind: "manual",
      label: String(rec.label ?? "").trim() || "跳转",
    });
    if (out.length >= MANUAL_LINK_CAP) break;
  }
  return out;
}

export function writeManualLinks(links: readonly BoardLink[]): string {
  return JSON.stringify(
    links
      .filter(l => l.kind === "manual")
      .map(l => ({ from: l.from, to: l.to, label: l.label }))
  );
}

/** 加一条。自环、重复、超上限都静静忽略（返回原数组，调用方不用判）。 */
export function addManualLink(
  links: readonly BoardLink[],
  from: string,
  to: string,
  label = "跳转"
): BoardLink[] {
  if (!from || !to || from === to) return links as BoardLink[];
  const id = `mn:${from}->${to}`;
  if (links.some(l => l.id === id)) return links as BoardLink[];
  if (links.filter(l => l.kind === "manual").length >= MANUAL_LINK_CAP) {
    return links as BoardLink[];
  }
  return [...links, { id, from, to, kind: "manual", label }];
}

export function removeLink(
  links: readonly BoardLink[],
  id: string
): BoardLink[] {
  return links.filter(l => l.id !== id);
}

/**
 * 把一条连线翻译成**页面作用域的精修指令**。
 *
 * ⚠ 指令里必须同时出现两页的**人话名**，因为后端判作用域那一步
 *   （services/refine_page_scope.py）是拿指令文本去点名页面的。只写 pageId
 *   （"在 p1 加个入口去 p3"）它点不到，会退回全量重画——那正是那个模块存在
 *   要解决的问题。
 */
export function linkToRefineInstruction(
  link: Pick<BoardLink, "from" | "to" | "label">,
  nameOf: (pageId: string) => string
): string {
  const from = nameOf(link.from);
  const to = nameOf(link.to);
  const what = (link.label || "跳转").trim();
  return `在「${from}」这一页加一个能跳到「${to}」的入口（${what}），其余页面不要改。`;
}

/* ------------------------------------------------------------------ 素材 */

export interface CanvasAsset {
  /** 原始 src */
  url: string;
  /** 用到它的页面（按传入页序） */
  pageIds: string[];
  /** 占位图（placehold.co / via.placeholder / dummyimage 之类） */
  placeholder: boolean;
  /** 画布上显示的短名 */
  label: string;
  /**
   * 这张图的每一处**用途**（同一个 URL 在不同地方可能是完全不同的东西）。
   *
   * ⚠ 这条是 2026-08-25 量真机数据量出来的，不是设计洁癖。生产库 24 个应用里，
   *   被多处引用的图有 18 组，其中 **10 组的 alt 互不相同**——最狠的一条是
   *   `placehold.co/40x40/e2e8f0/cbd5e1` 在同一个应用里用了 5 处，alt 分别是
   *   蚂蚁集团 / 比亚迪 / 字节 / 腾讯 / 小红书的 logo。按 URL 一键全换 =
   *   五家公司挂同一个 logo，比留着灰块更糟。
   *   所以卡片仍按 URL（屏幕上它确实就是同一张灰图），但**替换按 use 走**。
   */
  uses: AssetUse[];
}

/** 一处用途 = 一个 <img>。alt 既是"这是什么"的说明，也是搜替换图的检索词。 */
export interface AssetUse {
  pageId: string;
  /** 解码后的 alt（空字符串表示这张图没写 alt） */
  alt: string;
}

const PLACEHOLDER_HOSTS = [
  "placehold.co",
  "placehold.it",
  "via.placeholder.com",
  "placeholder.com",
  "dummyimage.com",
  "placekitten.com",
  "picsum.photos",
];

/** 是不是占位图。⚠ 判 host，不判整串——URL 里带 "placeholder" 字样的真实图不算。 */
export function isPlaceholderAsset(url: string): boolean {
  const s = String(url || "");
  const m = s.match(/^https?:\/\/([^/?#]+)/i);
  const host = (m?.[1] || "").toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  return PLACEHOLDER_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/** 画布上给图起的短名：文件名优先，没有文件名就用 host + 尺寸段。 */
export function assetLabel(url: string): string {
  const s = String(url || "").trim();
  if (!s) return "图片";
  if (s.startsWith("data:")) return "内嵌图片";
  const noQuery = s.split(/[?#]/)[0]!;
  const tail = noQuery.slice(noQuery.lastIndexOf("/") + 1);
  if (tail && /\.[a-z0-9]{2,5}$/i.test(tail)) return tail;
  const host = (s.match(/^https?:\/\/([^/?#]+)/i)?.[1] || "").replace(
    /^www\./,
    ""
  );
  return [host, tail].filter(Boolean).join("/") || s.slice(0, 40);
}

/**
 * 整个 `<img>` 标签。
 *
 * ⚠ 提取和替换**必须共用这一条**。上一版提取只匹配 `src=`、不看标签边界，
 *   要配 alt 就得另写一条正则——两条正则对"什么算一个 img"迟早给出不同结论，
 *   结果就是画布上扒得出来、按它去换却换不掉（本仓最忌的静默半失效）。
 */
const IMG_TAG_RE = /<img\b[^>]*>/gi;

/** 从一个标签里取属性值。跟 python 侧 stock_images._attr 同款语义。 */
function tagAttr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(
    tag
  );
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
}

/**
 * 最小实体解码。**不建 DOM**——这个文件要能在 jsdom 之外（判据、node 脚本）跑，
 * 而且提取和匹配走同一个函数才保证两边对同一段 alt 得出同一个字符串。
 */
export function decodeEntities(text: string): string {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * 把各页 HTML 里的 `<img>` 扒出来，按 src 去重、按 (src, alt) 记用途。
 *
 * ⚠ 用正则而不是 DOMParser：这个函数要能在 jsdom 之外（判据、node 脚本）跑，
 *   而且这里只取属性、不建 DOM、不执行任何东西——没有把模型写的 HTML 挂进
 *   文档的风险。真要解析结构才用 DOMParser。
 *
 * ⚠ 只认 `<img>`。CSS 背景图（background-image:url(...)）真机三个会话量下来
 *   是 0 处，为它多写一条正则等于多一处会分叉的判定。哪天真有了再加，
 *   连同判据一起加。
 */
export function extractPageAssets(
  pages: ReadonlyArray<{ pageId: string; html?: string }>
): CanvasAsset[] {
  const byUrl = new Map<string, CanvasAsset>();
  for (const page of pages) {
    const html = page.html ?? "";
    IMG_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMG_TAG_RE.exec(html))) {
      const tag = m[0];
      const url = tagAttr(tag, "src").trim();
      if (!url) continue;
      const alt = tagAttr(tag, "alt").trim();
      const hit = byUrl.get(url);
      if (hit) {
        if (!hit.pageIds.includes(page.pageId)) hit.pageIds.push(page.pageId);
        hit.uses.push({ pageId: page.pageId, alt });
      } else {
        byUrl.set(url, {
          url,
          pageIds: [page.pageId],
          placeholder: isPlaceholderAsset(url),
          label: assetLabel(url),
          uses: [{ pageId: page.pageId, alt }],
        });
      }
    }
  }
  // 用得多的排前面；同样多的按第一次出现的顺序（Map 保序）。
  return [...byUrl.values()].sort(
    (a, b) => b.pageIds.length - a.pageIds.length
  );
}

/** 一组"同一个意思"的用途：同 URL 同 alt，换图可以一起换。 */
export interface AssetUseGroup {
  url: string;
  alt: string;
  pageIds: string[];
  count: number;
}

/**
 * 把一张图的用途按 alt 归组——**这就是「换图」的操作单位**。
 *
 * 归组之后：alt 一致的多处会收成一组（点一次换掉全部，正是用户要的
 * "换掉所有引用它的页面"），alt 不同的会分开列（避免五家公司同一个 logo）。
 */
export function assetUseGroups(asset: CanvasAsset): AssetUseGroup[] {
  const byAlt = new Map<string, AssetUseGroup>();
  for (const use of asset.uses) {
    const hit = byAlt.get(use.alt);
    if (hit) {
      hit.count += 1;
      if (!hit.pageIds.includes(use.pageId)) hit.pageIds.push(use.pageId);
    } else {
      byAlt.set(use.alt, {
        url: asset.url,
        alt: use.alt,
        pageIds: [use.pageId],
        count: 1,
      });
    }
  }
  return [...byAlt.values()].sort((a, b) => b.count - a.count);
}

/**
 * 把一页 HTML 里 (src === url 且 alt === alt) 的那些 `<img>` 换成新地址。
 * 返回换过的 HTML 和换掉几处。**纯函数**，不碰 DOM、不发请求。
 *
 * ⚠ src 和 alt **两个都要对上**才换。只按 src 换会把同一个占位图的其它
 *   用途一起改掉（真机上那是 5 家公司的 logo）；只按 alt 换会跨到别的图上。
 */
export function replaceAssetUseInHtml(
  html: string,
  target: { url: string; alt: string },
  nextUrl: string
): { html: string; replaced: number } {
  const source = String(html || "");
  const next = String(nextUrl || "").trim();
  if (!next) return { html: source, replaced: 0 };
  let replaced = 0;
  const out = source.replace(IMG_TAG_RE, tag => {
    if (tagAttr(tag, "src").trim() !== target.url) return tag;
    if (tagAttr(tag, "alt").trim() !== target.alt) return tag;
    replaced += 1;
    // 只换 src 这一个属性，标签里其余东西（alt/class/loading/data-*）原样留着。
    return tag.replace(
      /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i,
      (_all, _q, dq) =>
        `src=${dq === undefined ? "'" : '"'}${escapeAttr(next)}${dq === undefined ? "'" : '"'}`
    );
  });
  return { html: out, replaced };
}

/** 写进属性值之前把引号和 & 转义掉——URL 里带 & 的很常见（?a=1&b=2）。 */
function escapeAttr(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 一次换图要落库的改动。空数组 = 一处都没换到（调用方必须当失败处理）。 */
export interface AssetReplacementPatch {
  pageId: string;
  html: string;
  replaced: number;
}

/**
 * 算出换一张图要改哪几页、各自的新 HTML。**纯函数**——真正落库是调用方的事。
 *
 * ⚠ 返回空数组是有意义的信号：说明画布上看到的那张图跟页面 HTML 已经对不上了
 *   （比如别处刚改过）。调用方**不许**把它当成"换成功了但没什么要改的"，
 *   那正是本仓最忌的"闸全绿但东西没了"。
 */
export function planAssetReplacement(
  pages: ReadonlyArray<{ pageId: string; html?: string }>,
  target: { url: string; alt: string; pageIds?: readonly string[] },
  nextUrl: string
): AssetReplacementPatch[] {
  const scope = target.pageIds && target.pageIds.length ? target.pageIds : null;
  const out: AssetReplacementPatch[] = [];
  for (const page of pages) {
    if (scope && !scope.includes(page.pageId)) continue;
    const res = replaceAssetUseInHtml(page.html ?? "", target, nextUrl);
    if (res.replaced > 0) {
      out.push({ pageId: page.pageId, html: res.html, replaced: res.replaced });
    }
  }
  return out;
}

/* ------------------------------------------------- 素材在画布上的排布 */

export interface AssetBox {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 素材卡的画布尺寸与间距。跟画板同一个坐标系（不随缩放变）。 */
/**
 * ⚠ 2026-08-25 真机把 260 改成 420：素材卡跟 1920 宽的画板同框，260 在适应
 * 画布（19%）下只有 49 屏幕 px——图看不清、标签也没地方放（见
 * canvas-board-layout.labelMaxCssWidth 那条）。420 在同样缩放下 ≈ 80px，
 * 缩略图认得出、标签截断后还能读出前几个字。
 * 再大就会把外接盒撑高、把画板本身的缩放预算吃掉。
 */
export const ASSET_TILE = { w: 420, h: 420, gap: 72 } as const;

/**
 * 素材铺在画板**下方**，同一条基线左对齐。
 *
 * ⚠ 放下面而不是旁边：放旁边会把画板的外接盒撑宽，"适应画布"就再也框不住
 *   页面本身了（素材是附属信息，不该跟主体抢缩放预算）。
 *
 * 每行放几张按画板区的总宽度算，至少 1 张。
 */
export function layoutAssets(
  assets: ReadonlyArray<CanvasAsset>,
  boardsArea: { x: number; y: number; w: number; h: number },
  tile = ASSET_TILE
): AssetBox[] {
  if (assets.length === 0) return [];
  const perRow = Math.max(
    1,
    Math.floor((boardsArea.w + tile.gap) / (tile.w + tile.gap))
  );
  // 与画板底边留一整块画板间距的呼吸，别贴着。
  const top = boardsArea.y + boardsArea.h + tile.gap * 3;
  return assets.map((a, i) => ({
    url: a.url,
    x: boardsArea.x + (i % perRow) * (tile.w + tile.gap),
    y: top + Math.floor(i / perRow) * (tile.h + tile.gap),
    w: tile.w,
    h: tile.h,
  }));
}

/* ------------------------------------------------------------ 属性面板 */

export interface BoardFacts {
  pageId: string;
  name: string;
  /** workbench / kanban / dashboard…；模型没说就是空 */
  kind: string;
  device: "desktop" | "phone" | "tablet";
  viewport: { w: number; h: number };
  /** 已接数据 / 尚未接数据 / 未通过校验 */
  status: "bound" | "unbound" | "missing";
  /** 实体 → 字段名清单（人话名在渲染侧查） */
  bindings: Array<{ entity: string; entityName: string; fields: string[] }>;
  actions: string[];
  linksOut: BoardLink[];
  linksIn: BoardLink[];
  assets: CanvasAsset[];
  /** 这一页引的图里有几张还是占位图 */
  placeholderAssets: number;
  /** HTML 字节数——"这页有多重"最直白的读数 */
  htmlBytes: number;
  /**
   * 这一页是由哪几块拼起来的（`data-block`，Python 那边划的）。
   *
   * ⚠ 跟这个面板上其余每一行一样：**读出来的，不是算出来的**。块的划分和
   *   起名都在后端，前端只负责把标读回来——两边各判一套就会分叉，而分叉的
   *   那天不会有任何报错。
   */
  blocks: BlockIdentity[];
}

/**
 * 属性面板要显示的全部事实。**纯函数**，因为面板上每一行都是判据能咬的东西。
 *
 * ⚠ 这里只做"把已有的事实汇到一处"，不做任何推断。面板上不许出现推断出来的
 *   数字——本仓第五条纪律：判据要落在用户真正看到的东西上，而用户看到的每一
 *   行都会被当成事实。
 */
export function boardFacts(
  page: {
    pageId: string;
    name?: string;
    html?: string;
    bound?: boolean;
    missing?: boolean;
    device?: "desktop" | "phone" | "tablet";
  },
  model: FiveSystemModel | null | undefined,
  links: readonly BoardLink[],
  assets: readonly CanvasAsset[],
  viewport: { w: number; h: number },
  labelOf: (page: { pageId: string; name?: string; html?: string }) => string
): BoardFacts {
  const def = (model?.page?.pages ?? []).find(
    p => String(p?.id) === page.pageId
  );
  const byEntity = new Map<string, string[]>();
  for (const b of def?.fieldBindings ?? []) {
    const raw = String(b || "");
    const dot = raw.indexOf(".");
    const ent = dot > 0 ? raw.slice(0, dot) : raw;
    const field = dot > 0 ? raw.slice(dot + 1) : "";
    const list = byEntity.get(ent) ?? [];
    if (field && !list.includes(field)) list.push(field);
    byEntity.set(ent, list);
  }
  const mine = assets.filter(a => a.pageIds.includes(page.pageId));
  return {
    pageId: page.pageId,
    name: labelOf(page),
    kind: String(def?.kind || "").trim(),
    device: layoutDevice(page.device) as "desktop" | "phone" | "tablet",
    viewport,
    status: page.missing ? "missing" : page.bound ? "bound" : "unbound",
    bindings: [...byEntity.entries()].map(([entity, fields]) => ({
      entity,
      entityName: entityLabel(model, entity),
      fields,
    })),
    actions: (def?.actionPermissions ?? []).map(String),
    linksOut: links.filter(l => l.from === page.pageId),
    linksIn: links.filter(l => l.to === page.pageId),
    assets: mine,
    placeholderAssets: mine.filter(a => a.placeholder).length,
    htmlBytes: new TextEncoder().encode(page.html ?? "").length,
    blocks: parseBlocksFromHtml(page.html),
  };
}
