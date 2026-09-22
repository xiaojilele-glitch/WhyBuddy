/**
 * 预览「还在」：看得见才报 /touch。
 *
 * 抄 CodeSandbox `onFocusChange`（标签页看得见才连）+ E2B `setTimeout`
 * （有证明就从现在重算安静钟）。我们这边证明打到已经通电的
 * `POST /project-operations/{id}/touch`，不新开通道。
 *
 * ⚠ 2026-09-19 坦克大战 `sr-20260919072444-11CSR1RSM6`：沙箱从就绪
 *   空倒 5 分钟，`lastAccessAt` 全程 None。人盯着画面、打坦克，host
 *   都听不见。轮询 GET 续命是服务端禁止的——只许显式 touch。
 *
 * 60s 远低于默认 idle 300s，不是把死钟改长。切走 / 藏起立刻停报。
 */

export const PREVIEW_PRESENCE_MS = 60_000;

export function shouldKeepPreviewAlive(input: {
  view: string;
  hasTicket: boolean;
  operationId?: string | null;
  visible: boolean;
}): boolean {
  return (
    input.view === "preview" &&
    Boolean(input.hasTicket) &&
    Boolean(String(input.operationId || "").trim()) &&
    input.visible
  );
}
