/**
 * 块身份的**读侧**（2026-08-27）。
 *
 * 一页交付页是若干块拼出来的：指标卡、图表、表格、表单、列表……
 * 划块和起名在 Python 那边（`services/page_blocks.py`，抄 grok-build
 * `xai-grok-config/src/managed_text/` 的 item 寻址），随 HTML 一起送到前端，
 * 落在开标签的 `data-block` / `data-block-kind` 上。
 *
 * ## ⚠ 这里**只读，不判**
 *
 * CLAUDE.md 第四条那口井：`scan_bindings` 用标签栈、JS 用 `querySelectorAll`，
 * 同一份 HTML 两个结论。所以块的类型（`data-block-kind`）一律**读属性**，
 * 不在 JS 里按 `<table>`/`<img>` 再判一遍——判两遍就会分叉，而且分叉的那天
 * 不会有任何报错，只是画布上这一块的名字跟后端改的那一块对不上。
 *
 * ## ⚠ 属性得先活着穿过消毒
 *
 * 两份 DOMPurify 白名单都要放行 `BLOCK_ATTRS`（跟 `data-shell`、
 * `data-page-id` 一个待遇）。漏了不会报错——块标被静默剥掉，画布上一块都
 * 认不出来，而 HTML 看着完全正常。判据在两边的 surface 测试里各钉一条。
 */

export const BLOCK_MARK_ATTR = "data-block";
export const BLOCK_KIND_ATTR = "data-block-kind";

/** 给两份消毒白名单 import 的那一份——**不手抄**（照 BINDING_ATTRS 的先例）。 */
export const BLOCK_ATTRS: readonly string[] = [BLOCK_MARK_ATTR, BLOCK_KIND_ATTR];

/** 跟 Python `BLOCK_KINDS` 一字不差。跨语言看门测试钉着。 */
export const BLOCK_KINDS = [
  "chart",
  "table",
  "form",
  "detail",
  "metric",
  "list",
  "media",
  "card",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/** 跟 Python `KIND_LABEL_CN` 一字不差。 */
export const KIND_LABEL_CN: Record<BlockKind, string> = {
  chart: "图表",
  table: "表格",
  form: "表单",
  detail: "详情",
  metric: "指标",
  list: "列表",
  media: "图文",
  card: "卡片",
};

export interface BlockIdentity {
  /**
   * 页内唯一的可寻址名字（`待指派工单`）。后端按它切块改写。
   *
   * ⚠ 这是**地址**，不是显示文本。后端每一遍打标都原样保留它，
   *   而 `kind` 会随 HTML 重算——所以显示要用 `kindLabel`+`label`，
   *   不要拿名字去猜类型。
   */
  name: string;
  kind: BlockKind;
  /** 给人看的那半。当前跟 name 相同，留一个字段是为了以后换名字方案时不动调用方。 */
  label: string;
  kindLabel: string;
}

function normalizeKind(raw: string | null): BlockKind {
  return (BLOCK_KINDS as readonly string[]).includes(raw ?? "")
    ? (raw as BlockKind)
    : "card";
}

/**
 * 从块的宿主元素读出身份。没有 `data-block` 就不是块，回 null。
 *
 * ⚠ 导出是给 `block-rects.ts` 用的（刀 1 量矩形时要 元素 + 身份 成对拿）。
 *   它**不许**自己再从属性拼一份身份——拼两份就会在 kind 归一化上分叉。
 */
export function identityOf(el: Element): BlockIdentity | null {
  const name = el.getAttribute(BLOCK_MARK_ATTR);
  if (!name) return null;
  const kind = normalizeKind(el.getAttribute(BLOCK_KIND_ATTR));
  return { name, kind, label: name, kindLabel: KIND_LABEL_CN[kind] };
}

/**
 * 从任意元素往上找它所属的那一块。找不到回 null。
 *
 * ⚠ **不许"就近找一个"兜底**（element-path 里那条同款纪律）：不在任何块里
 *   的元素就是不在——壳里的菜单、面包屑本来就没有块身份。随便挂一个上去，
 *   用户点菜单会以为自己选中了正文里的某一块。
 */
export function closestBlock(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute?.(BLOCK_MARK_ATTR)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

/** 这个元素所属那一块的身份。不属于任何块时回 null。 */
export function blockIdentity(el: Element | null): BlockIdentity | null {
  const host = closestBlock(el);
  return host ? identityOf(host) : null;
}

/**
 * 一页上所有块的**宿主元素**，文档顺序。认块的规则只有这一处。
 *
 * ⚠ 嵌套的块直接跳过：Python 那边保证块互不嵌套，真出现了说明这份 HTML
 *   被人手改过（或者消毒把外层剥了），这时候宁可少列一块，也不能把同一段
 *   内容算成两块——数出来的块数会跟后端对不上。
 *
 * ⚠ 重名的只取第一个：`name` 是**页内唯一的地址**，重名说明这份 HTML 有问题。
 *   两个都收下的话，刀 1 会给同一个地址量出两个矩形，画布上一块套一块。
 */
export function listBlockElements(root: ParentNode | null): HTMLElement[] {
  if (!root) return [];
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(`[${BLOCK_MARK_ATTR}]`));
  const out: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const el of nodes) {
    if (el.parentElement && closestBlock(el.parentElement)) continue;
    const name = el.getAttribute(BLOCK_MARK_ATTR);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(el);
  }
  return out;
}

/**
 * 一页上的所有块，文档顺序。
 *
 * ⚠ 这是 `listBlockElements` 的一层薄映射，**不重写筛选规则**：块清单（检视器）
 *   和块矩形（刀 1）必须数出同样多的块。各写一份的话，某天嵌套/重名的处理
 *   一边改了另一边没改，表现是画布上的框比清单多一个或少一个，而且不报错。
 */
export function listBlocks(root: ParentNode | null): BlockIdentity[] {
  const out: BlockIdentity[] = [];
  for (const el of listBlockElements(root)) {
    const id = identityOf(el);
    if (id) out.push(id);
  }
  return out;
}

/**
 * 从一页的**源 HTML** 里读出块清单。
 *
 * ⚠ 走 `DOMParser` + 上面那份 `listBlocks`，**不另写一套正则**：同一份 HTML
 *   两套解析必然分叉（本仓 `scan_bindings` 用标签栈、JS 用 querySelectorAll
 *   那口井）。这里只负责把字符串变成一棵树，认块的规则只有一份。
 *
 * ⚠ 没有 DOMParser 的环境（node 侧工具、老浏览器）回空数组，不抛——
 *   块清单是检视器上的一行，缺了就少一行，不许拖垮面板（纪律七 fail-open）。
 */
export function parseBlocksFromHtml(html: string | null | undefined): BlockIdentity[] {
  const text = html || "";
  if (!text || typeof DOMParser === "undefined") return [];
  try {
    return listBlocks(new DOMParser().parseFromString(text, "text/html"));
  } catch {
    return [];
  }
}
