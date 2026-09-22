/**
 * 顶栏布局开关必须接在通电的那条链上。
 * 只测 helper 会假绿：把 Provider 从 SlideRuleUnified 摘掉，
 * studio-layout.test 照样过，真机右上角还是没有页面显隐。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("workbench chrome live-path wiring", () => {
  it("SlideRuleUnified 包了 StudioLayoutProvider，空会话 available=false", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("StudioLayoutProvider");
    expect(src).toContain("available={showStudioChrome}");
    expect(src).toContain("isStudioChromeShown");
    expect(src).toContain("showStudioChrome");
    expect(src).not.toContain("available={!isHomeEmpty}");
  });

  it("DashboardApp 外壳带 ShellSidebarProvider 和 data-sidebar-collapsed", () => {
    const src = stripComments(
      readFileSync(
        new URL("../../agent-loop/dashboard/DashboardApp.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(src).toContain("ShellSidebarProvider");
    expect(src).toContain("data-sidebar-collapsed");
  });

  it("顶栏走互斥布局档，左边会话栏/对话键不存在", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleTopHud.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("useStudioLayout");
    expect(src).toContain("applyWorkbenchMode");
    expect(src).toContain("STUDIO_WORKBENCH_MODE_OPTIONS");
    expect(src).toContain("sliderule-workbench-mode");
    const segmented = src.slice(
      src.indexOf("function StudioWorkbenchModePicker"),
      src.indexOf("export function PreviewChromeLayoutButtons")
    );
    const layout = stripComments(
      readFileSync(new URL("../studio-layout.ts", import.meta.url), "utf8")
    );
    expect(layout).toContain('label: "分栏"');
    expect(layout).toContain('label: "全屏"');
    expect(layout).toContain('label: "画布"');
    // ⚠ 2026-09-01：分段控件里隐藏页面 / 最大化独立钮撤了。缝上折钮还在。
    // 2026-09-20 两颗图标是另一个导出，不许算进这一簇。
    expect(segmented).not.toContain("toggleStagePage");
    expect(segmented).not.toContain("sliderule-layout-maximize");
    expect(segmented).not.toContain("sliderule-layout-stage");
    expect(segmented).not.toContain("隐藏页面");
    expect(src).not.toContain("sliderule-layout-maximize");
    expect(src).not.toContain("sliderule-layout-stage");
    // ⚠ 2026-08-24：重置布局按钮撤了（用户："按钮一多看不懂啥意思"）。
    // 判据翻面前先剥注释——SlideRuleTopHud 的模块头正好把"重置布局"
    // 和 resetLayout 写进了事故记录里，不剥的话下面三条 not 永远假红。
    expect(src).not.toContain("sliderule-layout-reset");
    expect(src).not.toContain("studio?.resetLayout");
    expect(src).not.toContain("重置布局");
    // 重置会话也不在这个簇里了，它是 SlideRuleResetSessionButton
    expect(src).toContain("SlideRuleResetSessionButton");
    expect(src).not.toContain("useShellSidebar");
    expect(src).not.toContain("sliderule-layout-sidebar");
    expect(src).not.toContain("sliderule-layout-chat");
    expect(src).not.toContain("studio?.toggleStage}");
    expect(src).not.toContain("studio?.toggleChat");
  });

  it("隐藏页面卸掉舞台，toggleStagePage 不许碰 panel.collapse", () => {
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(studio).toContain("isStagePageShown");
    expect(studio).toContain('from "./studio-layout"');
    expect(studio).toContain("stagePageHidden");
    // ⚠ 2026-08-20 真机：只 grep 函数名会假绿——调用写了、import 漏了，
    // 页面 ReferenceError。变异：删掉这条 import，下面必红。

    const ctx = stripComments(
      readFileSync(
        new URL("../StudioLayoutContext.tsx", import.meta.url),
        "utf8"
      )
    );
    // ⚠ 依赖数组不再恒为 []（画布档锁住最大化后它依赖 maximizeLocked），
    //   正则要放开这一段，否则切片取不到、判据变成"expected undefined"，
    //   看着像功能坏了其实是判据自己僵在旧写法上。
    const pageToggle = ctx.match(
      /const toggleStagePage[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(pageToggle).toBeTruthy();
    expect(pageToggle).toContain("nextStagePageHidden");
    expect(pageToggle).not.toContain("collapse");
    expect(pageToggle).not.toContain("expand");
    expect(pageToggle).not.toContain("stageRef");
  });

  it("分栏缝走 Primer muted 发丝线，不是投影或 6px 槽", () => {
    const src = stripComments(
      readFileSync(new URL("../StudioSplit.tsx", import.meta.url), "utf8")
    );
    const handle = src.slice(
      src.indexOf("sliderule-studio-split-handle"),
      src.indexOf("sliderule-studio-split-toggle-chat")
    );
    expect(handle).toContain("w-px");
    expect(handle).toContain("#d1d9e0b3");
    expect(handle).not.toContain("linear-gradient");
    expect(handle).not.toContain("bg-[#e5e7eb]");
    expect(handle).not.toContain("w-1.5");
    expect(src).toContain(
      "onDragging={phone ? undefined : layout.setResizing}"
    );
    expect(src).toContain(
      'data-studio-resizing={layout.resizing ? "true" : undefined}'
    );
    expect(src).toContain("[@media(pointer:coarse)]:after:w-0");

    const css = stripComments(
      readFileSync(
        new URL("../../agent-loop/dashboard/dashboard.css", import.meta.url),
        "utf8"
      )
    );
    const sidebar = css.slice(
      css.indexOf(".native-agent-sidebar {"),
      css.indexOf(".native-agent-shell[data-sidebar-collapsed")
    );
    expect(sidebar).toContain("border-right: 1px solid var(--sr-border-muted");
    expect(sidebar).toContain("#d1d9e0b3");
    expect(sidebar).toContain("var(--sr-sidebar-bg");
    expect(sidebar).not.toContain("var(--sr-shell-bg");
    expect(sidebar).not.toContain("linear-gradient");
    expect(css).not.toContain(".native-agent-main::before");
    expect(css).toContain("--sr-border-muted: #d1d9e0b3");
    expect(css).toContain("--sr-sidebar-bg: #e8e9ed");
    expect(css).toContain("--sr-shell-bg: #f4f4f6");
    /* 侧栏选中项：同色压深，不要白底胶囊 + Ant 蓝（2026-08-20 设置页截图） */
    const navActive = css.slice(
      css.indexOf(".native-agent-nav-item-active {"),
      css.indexOf(".native-agent-nav-item-active:hover")
    );
    expect(navActive).toContain("rgba(15, 23, 42, 0.07)");
    expect(navActive).toContain("color: #171717");
    expect(navActive).not.toContain("#ffffff");
    expect(navActive).not.toContain("#1d4ed8");
    const dragCss = css.slice(css.indexOf('[data-studio-resizing="true"]'));
    expect(dragCss).toContain("pointer-events: none");
    expect(dragCss).toContain("contain: strict");

    const layout = stripComments(
      readFileSync(new URL("../StudioLayoutContext.tsx", import.meta.url), "utf8")
    );
    expect(layout).toContain('addEventListener("pointerup"');
    expect(layout).toContain('addEventListener("pointercancel"');
    expect(layout).toContain('addEventListener("blur"');
    expect(layout).toContain("setResizing(false)");
  });

  it("拖分栏时冻结舞台缩放，不每帧 setScale", () => {
    const split = stripComments(
      readFileSync(new URL("../StudioSplit.tsx", import.meta.url), "utf8")
    );
    expect(split).toContain(
      "onDragging={phone ? undefined : layout.setResizing}"
    );

    const stage = stripComments(
      readFileSync(
        new URL("../live-runtime/SpecPageLiveStage.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(stage).toContain("studioLayout?.resizing ?? false");
    expect(stage).toContain("PHONE_STAGE_MAX_SCALE");
    expect(stage).not.toContain('className="ml-auto rounded-full');

    const scale = stripComments(
      readFileSync(
        new URL("../live-runtime/canvas-scale.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(scale).toContain("if (pausedRef.current) return");
    expect(scale).toContain("requestAnimationFrame");
  });

  it("对话栏默认走侧栏×2，重置布局只剩缝上双击这一条路", () => {
    /**
     * ⚠ 2026-08-20：只改 helper 不接线会假绿。把 defaultSize 写回 38、
     * 缝上不调 resetLayout，这条必须红。
     *
     * ⚠ 2026-08-24：顶栏那颗「重置布局」按钮已撤。撤按钮**不等于**撤功能——
     * 双击这条路是它唯一的入口了，所以下面 onDoubleClick 那条判据从
     * "顺带钉一下"升级成"最后一道闸"：它红了就是功能真的没了。
     */
    const split = stripComments(
      readFileSync(new URL("../StudioSplit.tsx", import.meta.url), "utf8")
    );
    expect(split).toContain("studioChatDefaultPercent");
    expect(split).toContain("studioChatDefaultPx");
    expect(split).toContain("studioPhoneStageDefaultPercent");
    // 手机档不许拖分栏。⚠ 钉**语义**不钉整串：画布档锁死最大化之后这里是
    //   `disabled={phone || layout.maximizeLocked}`，写死整串会在加第二个
    //   条件时假红（本仓踩过：判据盯字面、实现换了说法就打空）。
    expect(split).toMatch(/disabled=\{phone\b/);
    expect(split).toContain("onDoubleClick={phone ? undefined : resetLayout}");
    expect(split).toContain("sliderule-studio-split-v2");
    expect(split).toContain("layoutGeneration");
    expect(split).not.toContain("defaultSize={38}");
    expect(split).not.toContain("defaultSize={62}");
    expect(split).not.toMatch(/CHAT_DEFAULT\s*=\s*38/);

    const ctx = stripComments(
      readFileSync(
        new URL("../StudioLayoutContext.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(ctx).toContain("resetLayout");
    expect(ctx).toContain("layoutGeneration");
    expect(ctx).toContain("setStagePageHidden(false)");
    expect(ctx).not.toContain("studioChatDefaultPercent");
  });

  it("角色切换箭头有右边距，不用系统原生贴边三角", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const roleAt = src.indexOf("sliderule-stage-role");
    const role = src.slice(roleAt, roleAt + 900);
    expect(roleAt).toBeGreaterThan(-1);
    expect(role).toContain("appearance-none");
    expect(role).toContain("pr-8");
    expect(role).toContain("right-2.5");
    expect(role).toContain("ChevronDown");
    expect(role).not.toContain("bg-white px-3 text-[12px]");
  });

  it("舞台档位不是黑底白字", () => {
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const arch = stripComments(
      readFileSync(new URL("../ArchitectureStage.tsx", import.meta.url), "utf8")
    );
    expect(studio).not.toContain("bg-[#1f2328]");
    expect(arch).not.toContain("bg-[#1f2328]");
    const gears = studio.slice(
      studio.indexOf("sliderule-stage-gears"),
      studio.indexOf("sliderule-xray-toggle")
    );
    expect(gears).toContain("bg-[#f4f4f5]");
    expect(gears).toContain("shadow-sm");
    expect(gears).toContain("bg-white");
    expect(gears).not.toContain("text-white");
  });

  it("图标簇挂在标题右侧同一行，不占整页顶栏", () => {
    /**
     * Primer PageHeader：标题在左、Trailing actions 在右，同一行。
     * 窄列用 nowrap + 图标，不要 flex-col 再叠一行工具条。
     */
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    // ⚠ 2026-09-20：chromeSlot 只接两颗图标，不许把 TopHud 分段加回去。
    expect(page).not.toContain("<SlideRuleTopHud");
    expect(page).toContain("<PreviewChromeLayoutButtons");
    expect(page).not.toContain("chromeSlot={null}");
    expect(page).not.toContain("immersionOverlayHeader");

    const hud = stripComments(
      readFileSync(new URL("../SlideRuleTopHud.tsx", import.meta.url), "utf8")
    );
    const pair = hud.slice(hud.indexOf("export function PreviewChromeLayoutButtons"));
    expect(pair).toContain("applyWorkbenchMode");
    expect(pair).toContain("toggleStagePage");
    expect(pair).toContain("project-preview-fullscreen");
    expect(pair).toContain("project-preview-hide-stage");
    expect(pair).toContain("显示页面");
    expect(pair).not.toContain("sliderule-workbench-mode");
    expect(pair).not.toContain("sliderule-deliverables-open");
    expect(pair).not.toContain(".collapse(");
    expect(pair).not.toContain("panel.collapse");

    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const barAt = studio.indexOf("sliderule-app-stage-bar");
    const barOpen = studio.slice(Math.max(0, barAt - 180), barAt + 90);
    expect(barOpen).toContain("border-[#d1d9e0b3]");
    expect(barOpen).toContain("primer-page-header");
    expect(barOpen).toContain("min-w-0");
    expect(barOpen).not.toContain("flex-col");
    expect(studio).toContain("compact={isPhoneStage}");

    const titleAt = studio.indexOf("sliderule-app-stage-bar");
    const gearsAt = studio.indexOf("sliderule-stage-gears");
    const titleCluster = studio.slice(titleAt, gearsAt);
    expect(titleCluster).toContain("sliderule-stage-model-draft");
    expect(titleCluster).toContain("起草中");
    expect(titleCluster).not.toContain("运行中");
    expect(titleCluster).not.toContain("bg-emerald-50");
    // ⚠ 2026-09-01：长标题省略号 + 截断才出 tooltip。变异回裸 span truncate、
    //   或不走 TruncatedText（无条件 native title）必红。
    expect(titleCluster).toContain("<TruncatedText");
    expect(titleCluster).toContain("sliderule-app-stage-title");
    expect(titleCluster).not.toContain(
      'min-w-0 truncate text-[12px] font-semibold text-stone-600'
    );

    const gearsTag = studio.slice(
      studio.lastIndexOf("<div", gearsAt),
      studio.indexOf(">", gearsAt) + 1
    );
    expect(gearsTag).toContain("ml-auto");
    expect(gearsTag).toContain("min-w-0");
    expect(gearsTag).toContain("overflow-x-auto");
    expect(gearsTag).not.toContain("shrink-0");
    const stageBodyAt = studio.indexOf("flex min-h-0 flex-1 gap-3", gearsAt);
    const gears = studio.slice(gearsAt, stageBodyAt);
    expect(gears).toContain("flex shrink-0 items-center gap-1");
    // ⚠ 2026-08-28：「透视」改叫「关联」。
    // ⚠ 2026-09-01：独立「打开画布」撤了，画布进 chromeSlot 里那组互斥分段。
    //   顺序：私有 → 关联 → 点选编辑 → {chromeSlot=分栏|全屏|画布}。
    expect(gears).toContain("关联");
    expect(gears).not.toContain("打开画布");
    expect(gears.indexOf("关联")).toBeLessThan(gears.indexOf("{chromeSlot}"));
    // ⚠ 2026-08-24：重置会话搬到标题左侧了，右侧这排不许再有它。
    expect(gears).not.toContain("resetSlot");
    expect(gears).not.toContain("sliderule-stage-role");
    expect(studio).toContain("metaTrailing={roleControl}");

    const boardAt = studio.lastIndexOf('stageView === "board"');
    const boardTab = studio.slice(boardAt, boardAt + 900);
    expect(boardTab).toContain("<ArchitectureStage");
    expect(boardTab).not.toContain("trailing=");
  });

  it("顶栏沙盘档已撤，但沙盘本身没死：透视栏「打开沙盘」仍是活入口", () => {
    /**
     * ⚠ 2026-08-24：这条是"闸全绿但东西没了"的正脸。用户要撤的是顶栏那片
     * 重复 tab，**不是**沙盘功能。只 grep `not.toContain('["board", "沙盘"]')`
     * 会假绿——把 stageView === "board" 那支渲染或 XrayPanel 的
     * onOpenSandbox 一并删掉，判据照样全绿，而沙盘再也打不开。
     * 所以撤的那条配一条"它还接在别的入口上"。
     */
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    // 撤掉的：顶栏那片 tab
    expect(studio).not.toContain('["board", "沙盘"]');
    expect(studio).not.toContain("sliderule-stage-view-board");
    // 没撤的：沙盘那支渲染 + 透视栏入口，且入口真的指向 board
    expect(studio).toContain('stageView === "board"');
    expect(studio).toContain("onOpenSandbox");
    expect(studio).toContain('onOpenSandbox={() => setStageView("board")}');
    expect(studio).toContain("关联");
    expect(studio).not.toContain(">游标<");

    const panel = stripComments(
      readFileSync(new URL("../XrayPanel.tsx", import.meta.url), "utf8")
    );
    expect(panel).toContain("打开沙盘");
    expect(panel).toContain("onOpenSandbox");
    // 反向：清单底「五系统联动总图」点进去是 Checks 抽屉，沙盘仍然失踪
    expect(panel).not.toContain("五系统联动总图");
  });
});
