/**
 * 元素结构路径：在**两个不同的 iframe** 之间指认同一个元素。
 *
 * 2026-08-25 用户要求：画布档 Ctrl+Click 页面里的某个元素，直接进那个元素的
 * 点选编辑。难点不在交互，在**两边的 DOM 不是同一份**：
 *
 *   · 画布里的 iframe 是**打过孔、填了真数据**的（HtmlAppSurface + applyBindings）
 *   · 点选编辑里的 iframe 渲染的是**源 HTML**（不跑绑定运行时）
 *
 * html-binding-runtime 会 `cloneNode` 往表格里克隆行和单元格（见那边
 * ROW_TPL / cellTpl 几处）。也就是说画布里看到的表格行，**源 HTML 里根本
 * 没有对应的元素**——那种元素本来就没得编辑。
 *
 * ⚠ 所以路径必须**带标签名并在解析时逐级校验**。只记下标的话：
 *   · 点到克隆行 → 源里 tbody 只有一行，children[5] 取到 undefined（还好）
 *   · 点到克隆单元格 → children[3] 可能**恰好存在但是别的东西**，
 *     于是静默选中一个不相干的元素，用户改完保存，改错了地方还不知道。
 *   后者正是本仓最忌的形状：闸全绿、东西错了。校验标签把它挡在门外。
 */

export interface PathStep {
  /** 小写标签名。解析时校验，对不上就整条判失败。 */
  tag: string;
  /** 在父节点的**元素子节点**里排第几（不数文本节点）。 */
  index: number;
}

/**
 * 从 root 到 el 的路径。el 不在 root 里（或就是 root）时回 null。
 *
 * ⚠ 只数元素子节点，不数文本/注释节点：两边 iframe 的空白文本节点数量
 *   会因为 sanitize / 格式化不同而分叉，数进去必错。
 */
export function elementPath(el: Element, root: Element): PathStep[] | null {
  if (el === root) return null;
  const out: PathStep[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, cur);
    if (index < 0) return null;
    out.push({ tag: cur.tagName.toLowerCase(), index });
    cur = parent;
  }
  if (cur !== root) return null;
  return out.reverse();
}

/**
 * 按路径在另一棵树上找回那个元素。找不到、或任何一级标签对不上，回 null。
 *
 * ⚠ **不许**在对不上的时候"就近找一个"。调用方拿到 null 要如实告诉用户
 *   定位不到，而不是随便选一个凑数。
 */
export function resolveElementPath(
  root: Element,
  path: readonly PathStep[]
): Element | null {
  if (!path.length) return null;
  let cur: Element = root;
  for (const step of path) {
    const next = cur.children[step.index];
    if (!next) return null;
    if (next.tagName.toLowerCase() !== step.tag) return null;
    cur = next;
  }
  return cur;
}

/** 路径序列化成字符串，好走 props / 事件详情。 */
export function encodeElementPath(path: readonly PathStep[]): string {
  return path.map(s => `${s.tag}:${s.index}`).join("/");
}

export function decodeElementPath(text: string): PathStep[] {
  if (!text) return [];
  const out: PathStep[] = [];
  for (const chunk of text.split("/")) {
    const at = chunk.lastIndexOf(":");
    if (at <= 0) return [];
    const tag = chunk.slice(0, at);
    const index = Number(chunk.slice(at + 1));
    if (!tag || !Number.isInteger(index) || index < 0) return [];
    out.push({ tag, index });
  }
  return out;
}
