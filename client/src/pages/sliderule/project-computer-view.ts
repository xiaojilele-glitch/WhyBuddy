/**
 * 右侧「它的电脑」此刻该停在哪一档。
 *
 * ## 为什么要这个（2026-09-14，对照 Manus 整页截图）
 *
 * 2026-09-13 第一版把 `ProjectComputerPanel` 叠在预览上面、各吃一截
 * （`max-h-[38%]`）。真机上两边都看不清：终端被裁成三行，预览被挤到
 * 下半屏。Manus 右侧是**一块**电脑——干活时看终端，跑起来看预览，
 * 点了下拉就钉住。叠是第一版的权宜，不是产品形态。
 *
 * 决策抽纯函数：组件判据走静态渲染，点不了下拉；跟哪一档看的是
 * **控制面刚挑的那件工具**，不是 host 写死的课表。
 *
 * ⚠ 用户点过下拉 → 听用户的。没点过才跟当前工具。把「预览已经能打开」
 *   写成强制切档，会把正在看终端回放的人拽走。
 */

import { isOfficeFileDeliverable } from "./deliverable-kind";
import { sourcePathFromActionDetail } from "./project-runtime/preview-selection-bridge";

export const COMPUTER_VIEWS = [
  "computer",
  "preview",
  "source",
  "history",
  "data",
  "delivery",
] as const;

export type ComputerView = (typeof COMPUTER_VIEWS)[number];

export function isComputerView(value: string): value is ComputerView {
  return (COMPUTER_VIEWS as readonly string[]).includes(value);
}

/**
 * 右侧该不该是「它的电脑」，而不是 HTML 推演的接线沙盘。
 *
 * ## 为什么要这个（2026-09-15，对照 Manus 整页）
 *
 * 真机 TicketStream：计划已经批准、待办也写了 8 条，右侧却是
 * 「推演完成后这里是五系统接线沙盘」。会话 `runtimeKind` 还停在
 * `html-prototype`，因为「进入工程工作台」那颗钮 2026-09-14 卸了，
 * `onCreateProject` 在 Unified 里被写成 `_onCreateProject` 再没人叫。
 *
 * Manus 右侧从干活开始就是电脑。计划批准（或已经在创建）时，
 * 哪怕 `projectId` 还没回来，也要先铺这块壳，不许把人扔回 C4。
 *
 * ⚠ 判据必须能被变异咬住：把 `canCreateProject` 拿掉，批准后的
 *   会话会再掉回沙盘，下面那条反向必红。
 */
export function shouldShowProjectComputer(input: {
  runtimeKind?: string | null;
  projectId?: string | null;
  canCreateProject?: boolean;
  creating?: boolean;
}): boolean {
  if (input.runtimeKind === "project") return true;
  if (String(input.projectId || "").trim()) return true;
  if (input.creating) return true;
  return Boolean(input.canCreateProject);
}

/**
 * 批准计划之后要不要立刻 POST 创建工程。
 *
 * 钮卸了，这条就必须自动走。运行中不抢；已经在创建或上次失败
 * 都不重打——失败要留在台面上，不许静默空转。
 */
export function shouldAutoCreateProject(input: {
  canCreateProject: boolean;
  isRunning: boolean;
  createStatus: "idle" | "creating" | "error";
  planHasDeliverableKind?: boolean;
}): boolean {
  // ⚠ 2026-09-20 真机 sr-20260920102543-OFFICE：plan_written 丢了
  //   deliverableKind，缺省成 web-app，自动 POST 出 react-vite-tasks，
  //   右栏「创建管理员」。Copilot：没有计划合同就不要 Implement。
  return (
    input.canCreateProject &&
    !input.isRunning &&
    input.createStatus === "idle" &&
    input.planHasDeliverableKind === true
  );
}

/**
 * 没点过下拉时，右侧停在哪一档。
 *
 * ⚠ 2026-09-15 TicketStream：左栏全是「导入源码」，自动切档却只看
 *   hasActivity → 终端。终端脸只画 PTY 字节，导入不产生字节，右侧白纸。
 *   人点工具行已经走 `computerViewForAction`（写入→源码），自动切档
 *   没用——又是成对物只改一半。
 *
 *   有动作在跑 → 按这一步的档（写入看源码，命令看终端），预览再就绪也不拽走
 *   预览已经有能用的地址 → 预览
 *   有过动作但预览还没开 → 按最后一步的档，不许停在没 PTY 的白纸上
 *   什么都没有 → 预览（空会话的默认面孔，跟没接 turns 的应用中心一致）
 */
export function resolveComputerView(input: {
  userPinned: ComputerView | null;
  live: boolean;
  hasActivity: boolean;
  previewReady: boolean;
  lastTool?: string | null;
  hasConsole?: boolean;
  deliverableKind?: string | null;
}): ComputerView {
  if (input.userPinned) return input.userPinned;
  const fromTool = input.lastTool ? computerViewForAction(input.lastTool) : null;
  if (input.live) return fromTool ?? "computer";
  // ⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：办公会话跑完被钉在终端，
  //   右边只剩 Vite 登录页。当时用「办公就回预览档」补上产物面。
  // ⚠ 2026-09-22 那一档又变成宿主把 pptx 画出来。预览档只跟控制面点的
  //   预览工具走，不因为交付物是办公文件就自己切过去。Vite 仍不叫醒。
  if (input.previewReady) return "preview";
  if (input.hasActivity) {
    if (fromTool && fromTool !== "computer") return fromTool;
    if (fromTool === "computer" && input.hasConsole === false) return "source";
    return fromTool ?? "computer";
  }
  return "preview";
}

/**
 * 左栏点了哪一种工具，右侧该打开哪一档。
 *
 * ⚠ 2026-09-14 第二轮对照 Manus：左栏工具行是**开关**，不是说明书。
 *   点「写入源码」右侧打开代码，点「运行命令」打开终端，点结果卡打开预览。
 *   第一版只做了自动切档，行本身点了没反应——看起来像清单，用起来不像电脑。
 *
 * 认工具名，不解析 label。未知的 `project_*` 落到终端：那一档能摊开
 * 脱敏摘要，比把人扔进一块空预览诚实。
 *
 * ⚠ 2026-09-15 TicketStream `sr-20260915141613-WBPAY2T4V3`：左栏是
 *   创建工程 / 读取工程列表，右侧钉在终端白纸。`project_list` /
 *   `project_search` 是店里读清单，不产 PTY，却被当成未知工具落到
 *   「computer」。终端脸只画 `runtime.console`，没有字节就空着——
 *   不是壳坏了，是看错档。
 */
export function computerViewForAction(tool: string): ComputerView {
  const name = String(tool || "").trim();
  if (
    name === "project_patch" ||
    name === "project_write" ||
    name === "project_str_replace" ||
    name === "file_read" ||
    name === "file_write" ||
    name === "file_str_replace" ||
    name === "file_find_in_content" ||
    name === "file_find_by_name" ||
    name === "read_file" ||
    name === "write_file" ||
    name === "search_replace" ||
    name === "grep" ||
    name === "list_dir" ||
    name === "glob" ||
    name === "project_read" ||
    name === "project_create" ||
    name === "project_export" ||
    name === "project_list" ||
    name === "project_search"
  ) {
    return "source";
  }
  if (
    name === "project_start" ||
    name === "project_verify" ||
    name === "browser_view" ||
    name === "browser_navigate" ||
    name === "browser_restart" ||
    name === "browser_click" ||
    name === "browser_input" ||
    name === "browser_console_exec" ||
    name === "deploy_expose_port" ||
    name === "deploy_apply_deployment" ||
    name === "make_manus_page"
  ) {
    return "preview";
  }
  if (name === "project_revisions" || name === "project_restore") {
    return "history";
  }
  if (name === "project_delivery" || name === "project_verification") {
    return "delivery";
  }
  return "computer";
}

export const INSPECT_ACTION_EVENT = "sliderule:inspect-action";

export type InspectActionDetail = {
  id: string;
  tool: string;
  /**
   * 只钉这一步、不切档。电脑面板自己的前后翻用——人已经在看终端回放，
   * 翻到一条 patch 不该把整面拽去源码。
   */
  keepView?: boolean;
};

export function inspectActionDetail(value: unknown): InspectActionDetail | null {
  if (!value || typeof value !== "object") return null;
  const id = String((value as { id?: unknown }).id || "").trim();
  const tool = String((value as { tool?: unknown }).tool || "").trim();
  if (!id || !tool) return null;
  return {
    id,
    tool,
    ...((value as { keepView?: unknown }).keepView ? { keepView: true } : {}),
  };
}

export function dispatchInspectAction(detail: InspectActionDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSPECT_ACTION_EVENT, { detail }));
}

/** 从回放回到跟着最新那条走。Manus 那颗「跳到实时」。 */
export const FOLLOW_COMPUTER_EVENT = "sliderule:follow-computer";

export function dispatchFollowComputer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOLLOW_COMPUTER_EVENT));
}

const PREVIEW_ACTION_TOOLS = new Set([
  "project_start",
  "project_verify",
  "browser_view",
  "browser_navigate",
  "browser_restart",
  "browser_click",
  "browser_input",
  "browser_console_exec",
  "deploy_expose_port",
  "deploy_apply_deployment",
  "make_manus_page",
]);

/**
 * 控制面挑了预览工具、运行已经就绪：换一张票。不是「能开就开」。
 *
 * ⚠ 2026-09-19：第一版只看 runtimeReady。装依赖时 project_status 被
 *   映射成预览档，host 自己换票——那是写死流程。必须是当前这件工具
 *   就在预览家族里。应用中心不传 turns，仍是观察。
 */
export function shouldAutoOpenPreview(input: {
  hasTurns: boolean;
  view: ComputerView;
  hasTicket: boolean;
  opening: boolean;
  runtimeReady: boolean;
  lastTool?: string | null;
  deliverableKind?: string | null;
}): boolean {
  if (isOfficeFileDeliverable(input.deliverableKind)) return false;
  return (
    input.hasTurns &&
    input.view === "preview" &&
    input.runtimeReady &&
    !input.hasTicket &&
    !input.opening &&
    Boolean(input.lastTool && PREVIEW_ACTION_TOOLS.has(input.lastTool))
  );
}

/**
 * 控制面正在调预览工具、沙箱还没起来：POST /preview/wake。
 *
 * 只跟这一轮还在跑的那件预览工具。刷新旧会话看到历史 project_start
 * 不许把沙箱拉起来。写文件 / 跑命令再就绪也不许自己醒。
 */
export function shouldAutoWakePreview(input: {
  hasTurns: boolean;
  view: ComputerView;
  hasTicket: boolean;
  opening: boolean;
  starting: boolean;
  live: boolean;
  lastTool?: string | null;
  runtimeReady: boolean;
  deliverableKind?: string | null;
}): boolean {
  if (isOfficeFileDeliverable(input.deliverableKind)) return false;
  if (
    !input.hasTurns ||
    input.view !== "preview" ||
    input.hasTicket ||
    input.opening ||
    input.starting ||
    input.runtimeReady
  ) {
    return false;
  }
  if (!input.live) return false;
  return Boolean(input.lastTool && PREVIEW_ACTION_TOOLS.has(input.lastTool));
}

/**
 * 预览浏览器该打开的源码页。只认 Agent 已经做成的 make_manus_page。
 *
 * ⚠ 2026-09-22 办公预览被写成宿主流程：交付物是 office-file 就把 pptx
 *   画成一页。文件预览跟别的预览一样，是控制面点名的那一页。没点名、
 *   点了非 html、或这一步失败，宿主都不补一页。
 */
function latestPresentedPath(
  rows: readonly { tool?: string; status?: string; detail?: string }[]
): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.tool !== "make_manus_page") continue;
    if (row.status === "running") continue;
    if (row.status !== "done") return null;
    return sourcePathFromActionDetail(String(row.detail || ""));
  }
  return null;
}

export function presentedSourcePage(
  rows: readonly { tool?: string; status?: string; detail?: string }[]
): string | null {
  const path = latestPresentedPath(rows);
  if (!path || !/\.html?$/i.test(path)) return null;
  return path;
}

/** make_manus_page 点名的已收回办公文件。没点名、点了 html、或失败，都不是。 */
export function presentedOfficeFile(
  rows: readonly { tool?: string; status?: string; detail?: string }[]
): string | null {
  const path = latestPresentedPath(rows);
  if (!path || !/\.(pptx|docx|xlsx)$/i.test(path)) return null;
  return path;
}

/**
 * 办公会话的预览槽。点了 html → 源码页；点了办公文件 → 那一份；
 * 没点名 → 空，不许拿失败的网页运行来充。
 */
export function officePreviewStage(input: {
  office: boolean;
  htmlPath: string | null;
  officePath: string | null;
}): "page" | "file" | "idle" | "app" {
  if (input.htmlPath) return "page";
  if (input.office && input.officePath) return "file";
  if (input.office) return "idle";
  return "app";
}
