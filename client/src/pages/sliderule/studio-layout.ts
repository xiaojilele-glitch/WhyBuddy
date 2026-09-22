/**
 * 工作台分栏策略。对照 VS Code workbench layoutService，不拉 vscode 仓。
 *
 * microsoft/vscode `src/vs/workbench/services/layout/browser/layoutService.ts`：
 *   toggleSidebarVisibility / toggleAuxiliaryBar / toggleMaximizeEditorGroup
 * 两侧不能同时折没——本仓 2026-08-18 的 StudioSplit 已经踩过：
 * 两个都 collapse 只剩一条缝，整页废了。
 *
 * 映射到 /agent-loop/sliderule：
 *   会话栏 ≈ Side Bar
 *   对话   ≈ Editor
 *   舞台   ≈ Auxiliary Bar
 *   最大化 ≈ 折对话、舞台铺满（再按还原）
 */

import {
  SHELL_SIDEBAR_WIDTH_PX,
  shellSidebarOccupiedPx,
} from "./shell-sidebar-layout";

export type StudioPart = "chat" | "stage";

export type StudioCollapsed = {
  chat: boolean;
  stage: boolean;
};

export function canCollapsePart(
  part: StudioPart,
  collapsed: StudioCollapsed
): boolean {
  return part === "chat" ? !collapsed.stage : !collapsed.chat;
}

export function isStageMaximized(collapsed: StudioCollapsed): boolean {
  return collapsed.chat && !collapsed.stage;
}

export type MaximizeIntent = "maximize" | "restore" | "noop" | "locked";

/**
 * 按一下最大化钮会发生什么。
 *
 * `locked` = 画布档把舞台钉死在最大化（2026-08-25 用户指着这颗钮说"锁死"）。
 * 画布是"把一轮产出摊开看全套"的视角，旁边留半屏对话等于把画布挤成一条缝——
 * 那一档就不该有"还原分栏"这个选项。
 *
 * ⚠ 锁住时返回 "locked" 而不是直接不给按钮：**按了没反应是本仓最忌的形状**。
 *   钮要留在原位、置灰、并说清为什么（顶栏 title 写"画布档固定最大化"）。
 */
export function maximizeIntent(
  collapsed: StudioCollapsed,
  locked = false
): MaximizeIntent {
  if (collapsed.stage) return "noop";
  if (locked) return "locked";
  return collapsed.chat ? "restore" : "maximize";
}

/**
 * 锁住时当前布局还需不需要纠正。
 *
 * ⚠ 掰开最大化的口子有五个，只堵顶栏那颗钮等于没锁（第四条纪律的经典形状）：
 *     1) 顶栏最大化钮   2) 分隔条上的折叠对话钮   3) 拖分隔条
 *     4) 双击分隔条还原  5) 隐藏页面再显示（那条会把 chatCollapsed 重置成 false）
 *   所以判定放在这个纯函数里，由 context 的 effect 统一兜底，谁把它掰开都会被扳回来。
 *
 * 舞台被整个折掉（collapsed.stage）时不纠正：那时压根没有舞台可最大化，
 * 硬扳只会跟"隐藏页面"打架。
 */
export function needsMaximizeLockFix(
  collapsed: StudioCollapsed,
  locked: boolean
): boolean {
  if (!locked) return false;
  if (collapsed.stage) return false;
  return !collapsed.chat;
}

/**
 * 空会话不许把对话栏折着。
 *
 * ⚠ 2026-08-27 用户报的死角：舞台最大化后 `layout` 是 `[0, 100]`，对话栏
 *   塌成 0%——作曲家只剩 18px 宽（输入框 8px），点不动也打不了字。这个比例
 *   经 autoSaveId 存进 localStorage，**点「新建会话」也继承它**：新会话右侧
 *   本来就没东西，只显示一句「推演完成后这里是五系统接线沙盘」，左边又没有
 *   输入口——整个界面无路可走，刷新也回不来。
 *
 *   最大化本身没错（看成品应用时正需要），错在**空会话没有可看的舞台**，
 *   却仍把唯一的入口折着。
 *
 * 只在三个条件同时成立时还原，不替用户做主：
 *   · 会话是空的（有内容时用户可能就是想专心看舞台）；
 *   · 对话栏确实折着；
 *   · 没上画布档的最大化锁（那是另一条规则，不跟它抢）。
 *
 * 判定放这里、执行放 StudioSplit——跟 needsMaximizeLockFix 同一条纪律：
 * Provider 的 effect 首屏跑在分栏挂载之前，ref 还是 null。
 */
export function needsEmptySessionRestore(
  collapsed: StudioCollapsed,
  sessionEmpty: boolean,
  locked: boolean
): boolean {
  if (!sessionEmpty) return false;
  if (locked) return false;
  return collapsed.chat;
}

/**
 * 舞台页是显隐，不是宽度。
 *
 * 2026-08-18 真机：顶栏右侧栏图标走了 `panel.collapse()`，那是改 flex
 * 尺寸（宽变成 0），用户原话「不是控制它的宽度的」。隐藏 = 整块不渲染，
 * 对话铺满；再按一次按默认分栏重新挂上。
 */
export function nextStagePageHidden(hidden: boolean): boolean {
  return !hidden;
}

/**
 * 对话栏默认宽 = 左侧菜单的二倍。
 *
 * ⚠ 2026-08-20 City Walk：38/62 百分比让对话栏比侧栏宽一截，用户指着
 * 说默认要菜单宽度的二倍。百分比跟窗口走，会漂；用侧栏像素 ×2 再折成
 * 分栏百分比。量不到容器时回落 30%（约 1920−252 工作区上的 504px）。
 */
export const STUDIO_CHAT_SIDEBAR_MULTIPLIER = 2;
export const STUDIO_CHAT_MIN_PERCENT = 20;
export const STUDIO_CHAT_MAX_PERCENT = 72;
export const STUDIO_CHAT_FALLBACK_PERCENT = 30;

export function studioChatDefaultPx(): number {
  return SHELL_SIDEBAR_WIDTH_PX * STUDIO_CHAT_SIDEBAR_MULTIPLIER;
}

export function studioChatDefaultPercent(splitWidthPx: number): number {
  if (!(splitWidthPx > 0)) return STUDIO_CHAT_FALLBACK_PERCENT;
  const pct = (studioChatDefaultPx() / splitWidthPx) * 100;
  return Math.min(
    STUDIO_CHAT_MAX_PERCENT,
    Math.max(STUDIO_CHAT_MIN_PERCENT, pct)
  );
}

export function studioStageDefaultPercent(splitWidthPx: number): number {
  return 100 - studioChatDefaultPercent(splitWidthPx);
}

/**
 * 手机预览列默认宽 = 左侧菜单 ×3，且不可拖。
 *
 * 桌面把「菜单×2」给对话栏、舞台吃剩余。手机机框只有 390 CSS 像素，
 * 舞台再吃 70% 会把 contain 拉到 110%，对话被挤成一条。对调：预览列
 * 锁死一个像素宽，对话吃剩余。
 *
 * ⚠ 2026-08-20：用户原话「手机端视图默认给个宽度，菜单那块的两倍，不可拖拽」。
 * 改回跟桌面同一套 38/62、或仍让手机舞台可拖，这条必须红。
 *
 * ⚠ 2026-08-24：用户改口要 ×3（原话「目前移动端是左侧菜单的两倍宽度，改成3倍吧」）。
 * **这里原先是 `return studioChatDefaultPx()`——直接复用对话栏那份**，看着省事，
 * 实则把两条独立的用户裁决焊死在一个数上：桌面对话栏的 ×2 是 2026-08-20 另一次
 * 拍板（「默认要菜单宽度的二倍」），手机列要 ×3 不该动它。所以这次先解耦成自己的
 * 倍数常量，再改数。想省一行改回复用对话栏的，下次只要有一边要动就会连坐。
 */
export const STUDIO_PHONE_STAGE_SIDEBAR_MULTIPLIER = 3;

/** 量不到容器时的回落：756 / (1920−252) ≈ 45%，与 ×3 同步算出来的，别单独调。 */
export const STUDIO_PHONE_STAGE_FALLBACK_PERCENT = 45;

export function studioPhoneStageDefaultPx(): number {
  return SHELL_SIDEBAR_WIDTH_PX * STUDIO_PHONE_STAGE_SIDEBAR_MULTIPLIER;
}

export function studioPhoneStageDefaultPercent(splitWidthPx: number): number {
  if (!(splitWidthPx > 0)) return STUDIO_PHONE_STAGE_FALLBACK_PERCENT;
  const pct = (studioPhoneStageDefaultPx() / splitWidthPx) * 100;
  return Math.min(
    STUDIO_CHAT_MAX_PERCENT,
    Math.max(STUDIO_CHAT_MIN_PERCENT, pct)
  );
}

export function studioPhoneChatDefaultPercent(splitWidthPx: number): number {
  return 100 - studioPhoneStageDefaultPercent(splitWidthPx);
}

export function isPhoneStudioDevice(device?: string | null): boolean {
  return device === "phone";
}

/** 猜分栏容器宽：视口减去侧栏占位。收起是图标轨，不是 0。 */
export function guessStudioSplitWidthPx(
  viewportWidth: number,
  sidebarCollapsed = false
): number {
  return Math.max(0, viewportWidth - shellSidebarOccupiedPx(sidebarCollapsed));
}

/** 空会话或用户藏了预览页：右侧整块不渲染。不是把宽度收成 0。 */
export function isStagePageShown(
  stageVisible: boolean,
  stagePageHidden: boolean
): boolean {
  return stageVisible && !stagePageHidden;
}

/**
 * 还没开始推演时顶栏整条不挂。
 *
 * ⚠ 2026-08-20 空态：舞台折钮已经靠 `available=false` 藏了，但交付物 /
 * 重置仍占一条带底边的栏，用户指着右上角说不要。变异：只藏图标、留那条
 * 底边，看起来还在。
 */
export function isStudioChromeShown(isHomeEmpty: boolean): boolean {
  return !isHomeEmpty;
}

/**
 * 工作台布局档。对照三处成熟开源，不自己发明第三套开关：
 *
 *   1) microsoft/vscode `layoutService.ts`
 *      toggleSidebarVisibility / toggleAuxiliaryBar / toggleMaximizeEditorGroup
 *      ——布局是互斥的 part 组合，不跟编辑器的 Preview|Raw 混在一排独立开关里。
 *   2) primer/react `SegmentedControl`
 *      2–5 个**有字**的互斥片，`aria-pressed`，一次只选一档。
 *      GitHub 自己的 Code | Preview | Blame 就是这个控件。
 *      本仓 2026-08-24 已经踩过「一排灰图标分不清」——重置布局整颗撤掉。
 *   3) v0 / bolt / Lovable：生成过程中锁死「对话 + 预览」分栏。
 *      生成的东西写在对话里，把对话折没等于让用户盯着一块空白舞台。
 *
 * 三档：
 *   split  = 对话 + 舞台并排（VS Code 默认 editor + auxiliaryBar）
 *   stage  = 舞台铺满（toggleMaximizeEditorGroup）
 *   canvas = 画布工作方式（另一套手势；进这档同时钉死最大化）
 *
 * ⚠ 不把「隐藏页面」做成第四档：推演中几乎不需要只看对话，缝上的折钮还在。
 *   第四档还会跟「页面/代码」的「页面」撞名——2026-08-28 把画布从那组拿出去
 *   就是因为两类东西并排放会让人以为可以随便来回切。
 *
 * ⚠ 「页面」这两个字已经被页面/代码占用。这三档的字是 分栏 / 全屏 / 画布。
 */
export type StudioWorkbenchMode = "split" | "stage" | "canvas";

export const STUDIO_WORKBENCH_MODE_OPTIONS = [
  {
    id: "split" as const,
    label: "分栏",
    title: "对话和页面并排",
  },
  {
    id: "stage" as const,
    label: "全屏",
    title: "只看页面，对话折起",
  },
  {
    id: "canvas" as const,
    label: "画布",
    title: "把所有页面摊开成画板",
  },
];

/**
 * 从折叠态 + 画布锁还原当前布局档。
 *
 * 画布优先：画布已经 maximizeLocked，不能被「全屏」盖住——否则选中片写着
 * 「全屏」、舞台却是画布，正是用户说的「识别困难」。
 */
export function resolveWorkbenchMode(input: {
  maximizeLocked: boolean;
  collapsed: StudioCollapsed;
  stagePageHidden: boolean;
}): StudioWorkbenchMode {
  if (input.maximizeLocked) return "canvas";
  if (!input.stagePageHidden && isStageMaximized(input.collapsed)) return "stage";
  return "split";
}

/**
 * 推演中锁定分栏。生成需要对话可见。
 *
 * ⚠ 锁住时控件留在原位、置灰、title 说清原因——凭空消失是本仓最忌的形状
 *   （maximizeIntent 的 locked 同款，2026-08-25 写过一次）。
 *   显示档强制是 split：实际状态由 Provider 的 effect 扳回去，
 *   选中片不许还停在「画布」上。
 */
export function workbenchModeForDisplay(
  mode: StudioWorkbenchMode,
  layoutLocked: boolean
): { mode: StudioWorkbenchMode; locked: boolean } {
  if (layoutLocked) return { mode: "split", locked: true };
  return { mode, locked: false };
}

/**
 * 推演开始时要不要把布局扳回分栏。
 *
 * 判定放纯函数、执行放 StudioSplit——跟 needsMaximizeLockFix 同一条纪律
 * （2026-08-25：Provider 的 effect 首屏 chatRef 是 null）。
 * 已经是分栏就别反复 expand，免得跟拖动打架。
 *
 * `stagePageHidden`：藏着页面时 resolve 仍报 split，但舞台被卸掉了，
 * 推演中必须挂回来，否则分栏只剩对话。
 */
export function needsRunningSplitFix(
  layoutLocked: boolean,
  mode: StudioWorkbenchMode,
  stagePageHidden = false
): boolean {
  if (!layoutLocked) return false;
  if (stagePageHidden) return true;
  return mode !== "split";
}
