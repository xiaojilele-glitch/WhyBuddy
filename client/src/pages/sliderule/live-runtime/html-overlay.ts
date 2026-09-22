/**
 * 生成页里的抽屉 / 对话框。页面 script 已被 DOMPurify 摘掉，开和关都得
 * 宿主做。
 *
 * 对照的是状态机，不拉组件库：
 *   radix-ui/primitives Dialog
 *     defaultOpen=false
 *     Trigger onClick → onOpenChange(true)
 *     Overlay 点击 / DialogClose / Escape → onOpenChange(false)
 *     Content（面板）里的点击不关
 *   tailwindlabs/headlessui Dialog
 *     useOutsideClick 关；Panel onClick stopPropagation
 *     useEscape 关最上面那一层
 *
 * 页面 script 已被摘掉，开和关由宿主接（Radix onOpenChange）。
 * 首屏是不是打开态，由生成提示词约束静息态，不在这里事后藏。
 */

const CLOSE_LABEL = /^(关闭|取消|close|dismiss|×|✕|x)$/i;

export function isOverlayRoot(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const cls = el.classList;
  if (!cls.contains("fixed")) return false;
  const covers =
    cls.contains("inset-0") ||
    (cls.contains("top-0") &&
      cls.contains("right-0") &&
      cls.contains("bottom-0") &&
      cls.contains("left-0"));
  if (!covers) return false;
  const tokens = Array.from(cls);
  const zOk = tokens.some(t => t.startsWith("z-") && t !== "z-0" && t !== "z-10" && t !== "z-20");
  const dim = tokens.some(
    t =>
      t.startsWith("bg-black") ||
      t.startsWith("bg-gray") ||
      t.startsWith("bg-zinc") ||
      t.startsWith("bg-slate") ||
      t.startsWith("bg-neutral")
  );
  const slide = cls.contains("justify-end") || cls.contains("justify-center");
  return zOk || dim || slide;
}

export function overlayRoots(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(".fixed").forEach(el => {
    if (isOverlayRoot(el)) out.push(el);
  });
  return out;
}

export function isOverlayOpen(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return false;
  if (el.classList.contains("hidden")) return false;
  if (el.style.display === "none") return false;
  return true;
}

export function setOverlayOpen(el: HTMLElement, open: boolean): void {
  // Radix 用 data-state；关掉时不能只靠 class `hidden`——它和 `flex`
  // 特异性相同，Tailwind 源序不一定听 HTML。
  if (open) {
    el.removeAttribute("hidden");
    el.classList.remove("hidden");
    el.style.removeProperty("display");
    el.setAttribute("aria-hidden", "false");
    el.setAttribute("data-state", "open");
  } else {
    el.setAttribute("hidden", "");
    el.classList.add("hidden");
    el.style.setProperty("display", "none", "important");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-state", "closed");
  }
}

export function overlayPanel(overlay: HTMLElement): HTMLElement | null {
  const kids = Array.from(overlay.children).filter(
    (n): n is HTMLElement => n instanceof HTMLElement
  );
  if (!kids.length) return null;
  const named = kids.find(
    k =>
      /(?:^|\s)(?:w-\[|max-w-|w-96|w-80|w-72)/.test(k.className) ||
      k.classList.contains("h-full") ||
      k.classList.contains("shadow-xl") ||
      k.classList.contains("shadow-2xl")
  );
  return named ?? kids[kids.length - 1];
}

export function isBackdropClick(target: EventTarget | null, overlay: HTMLElement): boolean {
  if (!(target instanceof Node) || !overlay.contains(target)) return false;
  const panel = overlayPanel(overlay);
  if (panel && panel.contains(target) && target !== overlay) return false;
  return true;
}

export function isCloseControl(target: Element, overlay: HTMLElement): boolean {
  const btn = target.closest("button, a, [role='button']");
  if (!btn || !overlay.contains(btn)) return false;
  const label = (btn.getAttribute("aria-label") || btn.textContent || "").replace(/\s+/g, "").trim();
  if (CLOSE_LABEL.test(label)) return true;
  if (btn.querySelector('path[d*="M6 18L18 6"]')) return true;
  return false;
}

export function entityFromTrigger(el: Element): string | null {
  const action = el.closest("[data-action]");
  const entity =
    action?.getAttribute("data-entity") ||
    el.closest("[data-entity]")?.getAttribute("data-entity") ||
    el.closest("[data-rows]")?.getAttribute("data-rows") ||
    el.closest("[data-record]")?.getAttribute("data-record");
  return entity || null;
}

export function overlayForEntity(root: ParentNode, entity: string | null): HTMLElement | null {
  const all = overlayRoots(root);
  if (!all.length) return null;
  if (entity) {
    const hit = all.find(
      o => o.getAttribute("data-record") === entity || o.getAttribute("data-entity") === entity
    );
    if (hit) return hit;
  }
  return all.length === 1 ? all[0] : null;
}

function topOpenOverlay(root: ParentNode): HTMLElement | null {
  const open = overlayRoots(root).filter(isOverlayOpen);
  return open.length ? open[open.length - 1] : null;
}

/**
 * 接在 iframe document 上。返回卸载函数。
 *
 * 打开 ``openRecord`` / 点 ``data-rows`` 行时吞掉事件，避免再叠一只宿主
 * RecordFormDrawer。新建/编辑仍留给宿主表单（要校验和保存）。
 */
export function wireOverlays(doc: Document): () => void {
  // 首屏关不关是生成提示词的事（静息态）。这里只接管点开 / 点关：
  // 页面 script 已被摘掉，对照 Radix onOpenChange。

  const onClick = (ev: MouseEvent) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const open = overlayRoots(doc).filter(isOverlayOpen);
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const overlay = open[i];
      if (isCloseControl(target, overlay) || isBackdropClick(target, overlay)) {
        setOverlayOpen(overlay, false);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    if (target.closest("[data-page-id]")) return;

    const action = target.closest("[data-action]");
    const kind = action?.getAttribute("data-action") || "";
    if (kind && kind !== "openRecord") return;

    const trigger =
      kind === "openRecord" || target.closest("[data-rows]")
        ? target
        : null;
    if (!trigger) return;
    const overlay = overlayForEntity(doc, entityFromTrigger(trigger));
    if (!overlay) return;
    setOverlayOpen(overlay, true);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    const overlay = topOpenOverlay(doc);
    if (!overlay) return;
    setOverlayOpen(overlay, false);
    ev.preventDefault();
    ev.stopPropagation();
  };

  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeyDown, true);
  return () => {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}
