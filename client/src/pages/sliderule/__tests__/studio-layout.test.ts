import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canCollapsePart,
  guessStudioSplitWidthPx,
  isPhoneStudioDevice,
  isStageMaximized,
  isStagePageShown,
  isStudioChromeShown,
  maximizeIntent,
  needsMaximizeLockFix,
  needsRunningSplitFix,
  nextStagePageHidden,
  resolveWorkbenchMode,
  STUDIO_CHAT_FALLBACK_PERCENT,
  STUDIO_CHAT_MAX_PERCENT,
  STUDIO_CHAT_MIN_PERCENT,
  STUDIO_CHAT_SIDEBAR_MULTIPLIER,
  STUDIO_WORKBENCH_MODE_OPTIONS,
  studioChatDefaultPercent,
  studioChatDefaultPx,
  studioPhoneChatDefaultPercent,
  studioPhoneStageDefaultPercent,
  studioPhoneStageDefaultPx,
  studioStageDefaultPercent,
  needsEmptySessionRestore,
  workbenchModeForDisplay,
} from "../studio-layout";
import {
  SHELL_SIDEBAR_RAIL_PX,
  SHELL_SIDEBAR_WIDTH_PX,
} from "../shell-sidebar-layout";

describe("studio-layout（VS Code 分栏对照）", () => {
  it("两侧不能同时折没：折一个时另一个不许再折", () => {
    expect(canCollapsePart("chat", { chat: false, stage: false })).toBe(true);
    expect(canCollapsePart("stage", { chat: false, stage: false })).toBe(true);
    expect(canCollapsePart("chat", { chat: false, stage: true })).toBe(false);
    expect(canCollapsePart("stage", { chat: true, stage: false })).toBe(false);
  });

  it("最大化 = 只留舞台；舞台已经没了则不能最大化", () => {
    expect(isStageMaximized({ chat: true, stage: false })).toBe(true);
    expect(isStageMaximized({ chat: false, stage: false })).toBe(false);
    expect(isStageMaximized({ chat: false, stage: true })).toBe(false);
    expect(maximizeIntent({ chat: false, stage: false })).toBe("maximize");
    expect(maximizeIntent({ chat: true, stage: false })).toBe("restore");
    expect(maximizeIntent({ chat: false, stage: true })).toBe("noop");
  });

  it("预览页是显隐：藏起来整块不渲染，不是把宽度收成 0", () => {
    expect(nextStagePageHidden(false)).toBe(true);
    expect(nextStagePageHidden(true)).toBe(false);
    expect(isStagePageShown(true, false)).toBe(true);
    expect(isStagePageShown(true, true)).toBe(false);
    expect(isStagePageShown(false, false)).toBe(false);
    expect(isStagePageShown(false, true)).toBe(false);
    expect(isStudioChromeShown(true)).toBe(false);
    expect(isStudioChromeShown(false)).toBe(true);
  });
});

describe("对话栏默认 = 左侧菜单 ×2", () => {
  it("像素就是侧栏宽的二倍，不是拍的 38%", () => {
    /**
     * ⚠ 2026-08-20 City Walk：用户要默认等于左侧菜单宽度的二倍。
     * 改回 38 或倍数改成 1，这条必须红。
     */
    expect(STUDIO_CHAT_SIDEBAR_MULTIPLIER).toBe(2);
    expect(studioChatDefaultPx()).toBe(SHELL_SIDEBAR_WIDTH_PX * 2);
    expect(studioChatDefaultPx()).toBe(504);
  });

  it("CSS 侧栏宽和 TS 常量是同一个数", () => {
    const css = readFileSync(
      new URL("../../agent-loop/dashboard/dashboard.css", import.meta.url),
      "utf8"
    );
    const block = css.slice(
      css.indexOf(".native-agent-sidebar {"),
      css.indexOf(".native-agent-shell[data-sidebar-collapsed")
    );
    expect(block).toContain(`flex: 0 0 ${SHELL_SIDEBAR_WIDTH_PX}px`);
    expect(block).toContain(`width: ${SHELL_SIDEBAR_WIDTH_PX}px`);
  });

  it("百分比按分栏容器折，量不到就回落，不能越出拖动上下限", () => {
    const split = 1920 - SHELL_SIDEBAR_WIDTH_PX;
    expect(studioChatDefaultPercent(split)).toBeCloseTo((504 / split) * 100);
    expect(studioStageDefaultPercent(split)).toBeCloseTo(
      100 - studioChatDefaultPercent(split)
    );
    expect(studioChatDefaultPercent(0)).toBe(STUDIO_CHAT_FALLBACK_PERCENT);
    expect(studioChatDefaultPercent(-1)).toBe(STUDIO_CHAT_FALLBACK_PERCENT);
    expect(studioChatDefaultPercent(100)).toBe(STUDIO_CHAT_MAX_PERCENT);
    expect(studioChatDefaultPercent(10_000)).toBe(STUDIO_CHAT_MIN_PERCENT);
    expect(guessStudioSplitWidthPx(1920)).toBe(1920 - SHELL_SIDEBAR_WIDTH_PX);
    expect(guessStudioSplitWidthPx(1920, true)).toBe(1920 - SHELL_SIDEBAR_RAIL_PX);
  });
});

describe("手机预览列默认 = 左侧菜单 ×3", () => {
  it("是菜单×3，且**不再**跟桌面对话栏共用同一个数", () => {
    /**
     * ⚠ 2026-08-20：用户要手机视图宽 = 菜单两倍且不可拖。
     * ⚠ 2026-08-24：用户改口要三倍（「目前移动端是左侧菜单的两倍宽度，改成3倍吧」）。
     *
     * 这条测试的重点不是那个 756，是**下面那条 not.toBe**：原实现是
     * `studioPhoneStageDefaultPx() { return studioChatDefaultPx() }`，两条独立的
     * 用户裁决焊在一个数上。谁要是图省事再把它接回对话栏，756 照样对、这条也照样绿
     * ——直到有人改对话栏倍数，手机列跟着连坐。所以正反两条一起钉：
     *   正：手机列 = 菜单 ×3
     *   反：它和对话栏不是同一个数（对话栏仍是 ×2，没被这次改动波及）
     */
    const split = 1920 - SHELL_SIDEBAR_WIDTH_PX;
    expect(studioPhoneStageDefaultPx()).toBe(SHELL_SIDEBAR_WIDTH_PX * 3);
    expect(studioPhoneStageDefaultPx()).toBe(756);

    // 反向：桌面对话栏没被连坐，仍是菜单 ×2
    expect(studioChatDefaultPx()).toBe(504);
    expect(studioPhoneStageDefaultPx()).not.toBe(studioChatDefaultPx());

    // 百分比要跟着像素算，不是照抄对话栏的
    expect(studioPhoneStageDefaultPercent(split)).toBeCloseTo(
      (756 / split) * 100
    );
    expect(studioPhoneStageDefaultPercent(split)).toBeGreaterThan(
      studioChatDefaultPercent(split)
    );
    // 两列互补，加起来是满的
    expect(
      studioPhoneStageDefaultPercent(split) +
        studioPhoneChatDefaultPercent(split)
    ).toBeCloseTo(100);

    expect(isPhoneStudioDevice("phone")).toBe(true);
    expect(isPhoneStudioDevice("desktop")).toBe(false);
    expect(isPhoneStudioDevice(undefined)).toBe(false);
  });
});

describe("画布档锁死最大化", () => {
  it("锁住时按最大化钮不是 restore，而是 locked", () => {
    // ⚠ 不锁的时候语义一个都不许变（下面三条是回归护栏）
    expect(maximizeIntent({ chat: false, stage: false }, false)).toBe(
      "maximize"
    );
    expect(maximizeIntent({ chat: true, stage: false }, false)).toBe("restore");
    expect(maximizeIntent({ chat: false, stage: true }, false)).toBe("noop");
    // 锁住：已经最大化了也不给"还原分栏"
    expect(maximizeIntent({ chat: true, stage: false }, true)).toBe("locked");
    expect(maximizeIntent({ chat: false, stage: false }, true)).toBe("locked");
  });

  it("locked 参数不传时行为跟以前一模一样（老调用点不受影响）", () => {
    expect(maximizeIntent({ chat: false, stage: false })).toBe("maximize");
    expect(maximizeIntent({ chat: true, stage: false })).toBe("restore");
  });

  it("舞台整个折掉时 noop 优先于 locked", () => {
    // 没有舞台可最大化，这时说"锁住了"会跟"隐藏页面"打架
    expect(maximizeIntent({ chat: false, stage: true }, true)).toBe("noop");
  });

  it("对话栏被掰开就要纠正，已经折着就不动", () => {
    expect(needsMaximizeLockFix({ chat: false, stage: false }, true)).toBe(
      true
    );
    // 反向：已经是最大化的不许反复纠正（会跟 react-resizable-panels 打架）
    expect(needsMaximizeLockFix({ chat: true, stage: false }, true)).toBe(
      false
    );
  });

  it("没上锁时永远不纠正", () => {
    expect(needsMaximizeLockFix({ chat: false, stage: false }, false)).toBe(
      false
    );
    expect(needsMaximizeLockFix({ chat: true, stage: false }, false)).toBe(
      false
    );
  });

  it("舞台折掉时不纠正——那时没有舞台可最大化", () => {
    expect(needsMaximizeLockFix({ chat: false, stage: true }, true)).toBe(
      false
    );
  });
});

/**
 * 2026-08-27 用户报的死角：舞台最大化 → 对话栏塌成 0% → 存进 localStorage →
 * 点「新建会话」继承它 → 新会话右侧只有一句占位、左侧作曲家 18px，无路可走。
 *
 * 真机复现（1500×950）：
 *   最大化后   layout=[0,100]  composer w=18  input w=8
 *   新建会话后 layout=[0,100]  composer w=18  input w=8   ← 继承了
 *
 * 判据落在判定函数上（执行侧的通电判据见 StudioSplit 那条）。
 * 变异：把 `return collapsed.chat` 改成 `return false`，本组必须红。
 */
describe("needsEmptySessionRestore（空会话不许把对话栏折着）", () => {
  const folded = { chat: true, stage: false };
  const open = { chat: false, stage: false };

  it("空会话 + 对话栏折着 → 还原", () => {
    expect(needsEmptySessionRestore(folded, true, false)).toBe(true);
  });

  it("反向：会话有内容时不替用户做主（看成品时最大化是合理的）", () => {
    expect(needsEmptySessionRestore(folded, false, false)).toBe(false);
  });

  it("反向：对话栏本来就开着就别动它（免得跟拖动/折叠打架）", () => {
    expect(needsEmptySessionRestore(open, true, false)).toBe(false);
  });

  it("反向：画布档的最大化锁优先，不跟它抢", () => {
    expect(needsEmptySessionRestore(folded, true, true)).toBe(false);
  });
});

/**
 * 通电：光有判定函数不算数——它得真的接在 chatRef 上，且 isHomeEmpty 要
 * 一路串到 StudioSplit。本仓第一条和第三条：装在不通电的插座上 /
 * 名单里有名字 ≠ 埋点在。
 *
 * 剥注释后匹配（判据 grep 标识符而那个词同时出现在注释里 = 变异后照样绿，
 * 本仓已经踩过）。
 */
/**
 * 2026-09-01：三颗独立开关（打开画布 / 隐藏页面 / 最大化）收成互斥档。
 * 对照 Primer SegmentedControl + VS Code layoutService。
 *
 * 变异：把 resolve 的 canvas 优先拿掉、把推演锁改成仍显示画布、
 * 把 needsRunningSplitFix 改成永远 false，本组必须红。
 */
describe("工作台布局档（分栏 | 全屏 | 画布）", () => {
  const open = { chat: false, stage: false };
  const maximized = { chat: true, stage: false };

  it("三档有字，不用「页面」——那个字已经被页面/代码占用", () => {
    expect(STUDIO_WORKBENCH_MODE_OPTIONS.map(o => o.id)).toEqual([
      "split",
      "stage",
      "canvas",
    ]);
    expect(STUDIO_WORKBENCH_MODE_OPTIONS.map(o => o.label)).toEqual([
      "分栏",
      "全屏",
      "画布",
    ]);
    for (const opt of STUDIO_WORKBENCH_MODE_OPTIONS) {
      expect(opt.label).not.toContain("页面");
    }
  });

  it("画布优先于全屏：锁着最大化时选中片是画布，不是全屏", () => {
    expect(
      resolveWorkbenchMode({
        maximizeLocked: true,
        collapsed: maximized,
        stagePageHidden: false,
      })
    ).toBe("canvas");
    expect(
      resolveWorkbenchMode({
        maximizeLocked: false,
        collapsed: maximized,
        stagePageHidden: false,
      })
    ).toBe("stage");
    expect(
      resolveWorkbenchMode({
        maximizeLocked: false,
        collapsed: open,
        stagePageHidden: false,
      })
    ).toBe("split");
  });

  it("隐藏页面不是第四档：藏着时仍报分栏（缝上折钮还在，顶栏不另做一片）", () => {
    expect(
      resolveWorkbenchMode({
        maximizeLocked: false,
        collapsed: open,
        stagePageHidden: true,
      })
    ).toBe("split");
  });

  it("推演中显示档强制分栏，控件锁住而不是藏起来", () => {
    expect(workbenchModeForDisplay("canvas", true)).toEqual({
      mode: "split",
      locked: true,
    });
    expect(workbenchModeForDisplay("stage", true)).toEqual({
      mode: "split",
      locked: true,
    });
    // 反向：没在推演，画布就是画布
    expect(workbenchModeForDisplay("canvas", false)).toEqual({
      mode: "canvas",
      locked: false,
    });
  });

  it("已经是分栏就别反复扳；画布/全屏在推演中要扳回来", () => {
    expect(needsRunningSplitFix(true, "canvas")).toBe(true);
    expect(needsRunningSplitFix(true, "stage")).toBe(true);
    expect(needsRunningSplitFix(true, "split")).toBe(false);
    expect(needsRunningSplitFix(false, "canvas")).toBe(false);
    // 藏着页面时 resolve 仍报 split，但舞台被卸掉了，推演中必须挂回来
    expect(needsRunningSplitFix(true, "split", true)).toBe(true);
    expect(needsRunningSplitFix(true, "split", false)).toBe(false);
  });
});

describe("通电：空会话还原真的接在活路径上", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const read = (rel: string) =>
    strip(readFileSync(new URL(rel, import.meta.url), "utf8"));

  it("StudioSplit 用判定函数并调 chatRef.expand（不是自己重写条件）", () => {
    const src = read("../StudioSplit.tsx");
    expect(src).toContain("needsEmptySessionRestore");
    const at = src.indexOf("needsEmptySessionRestore(collapsed");
    expect(at, "判定没用在 effect 里").toBeGreaterThan(-1);
    expect(src.slice(at, at + 260)).toContain("chatRef.current?.expand()");
  });

  it("isHomeEmpty 一路串到 StudioSplit（少一段就是半条线）", () => {
    expect(read("../../SlideRule.tsx")).toContain("sessionEmpty={isHomeEmpty}");
    const studio = read("../SlideRuleStudio.tsx");
    expect(studio).toContain("sessionEmpty={sessionEmpty}");
    const split = read("../StudioSplit.tsx");
    expect(split).toContain("sessionEmpty?: boolean;");
  });
});

/**
 * 2026-09-01 通电：互斥布局档必须接在活路径上。
 * 只测 helper 会假绿——把 layoutLocked={isRunning} 从 SlideRule 摘掉，
 * 上面那组纯函数照样过，真机推演中三颗开关还是能乱按。
 */
describe("通电：互斥布局档真的接在活路径上", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const read = (rel: string) =>
    strip(readFileSync(new URL(rel, import.meta.url), "utf8"));

  it("SlideRule 把 isRunning 灌进 Provider.layoutLocked", () => {
    const src = read("../../SlideRule.tsx");
    expect(src).toContain("layoutLocked={isRunning}");
    // 反向：空会话 available 那条不许被改去顶替 layoutLocked
    expect(src).toContain("available={showStudioChrome}");
  });

  it("StudioSplit 用判定函数扳回分栏（不是 Provider——chatRef 首屏是 null）", () => {
    const split = read("../StudioSplit.tsx");
    expect(split).toContain("needsRunningSplitFix");
    const at = split.indexOf("needsRunningSplitFix(");
    expect(at, "判定没用在 effect 里").toBeGreaterThan(-1);
    expect(split.slice(at, at + 420)).toContain('applyWorkbenchMode("split")');
    // 反向：Provider 里不许再留一份执行（同一件事两处实现 = 半个锁）
    const ctx = read("../StudioLayoutContext.tsx");
    expect(ctx).not.toContain("needsRunningSplitFix");
  });

  it("P3-④ applyWorkbenchMode 先展开舞台，不许只翻 stageCollapsed", () => {
    /**
     * ⚠ 执行单 P3-④：翻 stageCollapsed 但不 expand 面板，两栏可能同时塌掉。
     * 变异：删掉 stageRef.current?.expand()，本条必红。
     */
    const ctx = read("../StudioLayoutContext.tsx");
    const start = ctx.indexOf("const applyWorkbenchMode");
    expect(start, "找不到 applyWorkbenchMode").toBeGreaterThan(-1);
    const fn = ctx.slice(start, ctx.indexOf("}, []);", start) + 8);
    expect(fn).toContain("setStageCollapsed(false)");
    expect(fn).toContain("stageRef.current?.expand()");
    expect(fn.indexOf("stageRef.current?.expand()")).toBeLessThan(
      fn.indexOf('if (next === "canvas")')
    );
  });

  it("顶栏分段走 applyWorkbenchMode；Studio 把 stageView 接进 sink", () => {
    const hud = read("../SlideRuleTopHud.tsx");
    const segmented = hud.slice(
      hud.indexOf("function StudioWorkbenchModePicker"),
      hud.indexOf("export function PreviewChromeLayoutButtons")
    );
    expect(segmented).toContain("applyWorkbenchMode");
    expect(segmented).toContain("sliderule-workbench-mode");
    expect(segmented).toContain("primer-segmented-control");
    // 反向：三颗独立开关不许回来（两颗图标是另一个导出）
    expect(segmented).not.toContain("sliderule-layout-stage");
    expect(segmented).not.toContain("sliderule-layout-maximize");
    expect(segmented).not.toContain("toggleStagePage");
    expect(segmented).not.toContain("toggleMaximize");
    expect(hud).not.toContain("sliderule-layout-stage");
    expect(hud).not.toContain("sliderule-layout-maximize");
    expect(hud).not.toContain("toggleMaximize");

    const studio = read("../SlideRuleStudio.tsx");
    expect(studio).toContain("registerCanvasSink");
    expect(studio).toContain('if (on) return "canvas"');
    expect(studio).toContain("<SpecPageCanvasStage");
    // 反向：独立「打开画布」钮撤了，画布渲染还在
    expect(studio).not.toContain("打开画布");
    expect(studio).not.toContain('data-testid="sliderule-stage-view-canvas"');
  });
});
