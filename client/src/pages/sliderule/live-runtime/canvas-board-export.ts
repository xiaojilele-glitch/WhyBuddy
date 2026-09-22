/**
 * 画板导出：PNG 与 HTML。
 *
 * ## PNG 走仓里已有的那条采集链路，不另起一套
 *
 * `client/lib/thumb-capture.ts` 里那套 snapdom 调用是踩出来的（iframe 要交
 * **iframe 元素本身**给 snapdom，dpr/embedFonts/backgroundColor/fast 四个参数
 * 各有来历，见那份文件的头注）。这里只借 `captureNodeToCanvas`，参数一个都
 * 不自己写——同一件事两套写法是本仓第四条纪律点名的形状。
 *
 * ## 都是 fail-open
 *
 * 导出属于增强类（第七条纪律）：采集失败只该是"这次没导出成"，
 * 不许把画布拖崩。所以两个函数都**不抛**，返回成功与否，调用方据此提示。
 *
 * ⚠ 但"不抛"不等于"静静地什么都不发生"。调用方必须把 false 显示出来
 *   ——用户点了导出却什么都没下载，比报个错更让人以为是自己点错了。
 */

import { captureNodeToCanvas } from "@/lib/thumb-capture";

/** 文件名里不能出现的字符，连同空白一起压成下划线。 */
export function safeFileName(name: string, fallback = "page"): string {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * 触发一次下载。
 *
 * ⚠ objectURL 必须**在下载真的开始之后**再撤销。第一版写成同步 revoke，
 *   Chrome 上大文件（整页 HTML 上百 KB）偶发下下来是 0 字节——点击派发是同步的，
 *   但读取是异步的。给一帧再撤。
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

/**
 * 把一块画板导出成 PNG。
 *
 * `boardEl` 是画板那层容器；里面那个 iframe 才是要采的东西——直接采容器
 * 会把手势层和描边一起采进去，而且 snapdom 对 iframe 有专门的处理路径
 * （见 thumb-capture 头注），采外层等于绕开它。
 */
export async function exportBoardPng(
  boardEl: HTMLElement | null,
  name: string
): Promise<boolean> {
  try {
    if (!boardEl) return false;
    const iframe = boardEl.querySelector("iframe");
    const node = (iframe as HTMLElement | null) ?? boardEl;
    if (!node.clientWidth || !node.clientHeight) return false;
    const canvas = await captureNodeToCanvas(node);
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), "image/png")
    );
    if (!blob) return false;
    downloadBlob(blob, `${safeFileName(name)}.png`);
    return true;
  } catch {
    // fail-open：导出炸了不拖垮画布
    return false;
  }
}

/**
 * 把一页的交付 HTML 原文存成文件。
 *
 * ⚠ 存的是 `page.html`（落库那份原文），**不是** iframe 里那份文档——后者被
 *   注入了 Tailwind script 与预览覆盖样式，是"给人看的"，导出去别人打开会
 *   多一堆我们注进去的东西。这条跟 ClickEditStage 存库时那条约束同源，
 *   那边的头注写得更细。
 */
export function exportBoardHtml(html: string, name: string): boolean {
  try {
    if (!html || !html.trim()) return false;
    downloadBlob(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `${safeFileName(name)}.html`
    );
    return true;
  } catch {
    return false;
  }
}
