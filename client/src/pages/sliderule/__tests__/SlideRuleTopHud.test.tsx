import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PreviewChromeLayoutButtons,
  SlideRuleResetSessionButton,
  SlideRuleTopHud,
} from "../SlideRuleTopHud";
import { StudioLayoutProvider } from "../StudioLayoutContext";

vi.mock("@/lib/deploy-target", () => ({
  IS_GITHUB_PAGES: false,
}));

describe("SlideRuleTopHud", () => {
  it("不再画整页顶栏字标（字标在侧栏）", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud isRunning={false} embedded />
    );
    expect(html).toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain("sliderule_logo_wordmark_transparent.png");
    expect(html).not.toContain("<header");
  });

  it("STATUS 状态盒与 Work/Code 胶囊均退役（Work 模式迁私有主仓）", () => {
    const html = renderToStaticMarkup(<SlideRuleTopHud isRunning={false} />);

    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    expect(html).not.toContain("STATUS");
    expect(html).not.toContain("sliderule-goal-display");
  });

  it("交付物是无字图标；重置会话已搬走，传了 onResetSession 也不许在簇里冒出来", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud
        isRunning={false}
        onOpenDeliverables={() => {}}
        onResetSession={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain(">交付物<");
    expect(html).not.toContain("rounded-full");
    // ⚠ 2026-08-24 反向判据：onResetSession 仍在 props 里（老调用点不炸），
    // 但**不渲染**。把 SlideRuleTopHud 里的按钮加回去，这条必红——否则
    // "搬走了"只是搬了个副本，右侧还留着一个，用户看到的还是两个重置。
    expect(html).not.toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain(">重置会话<");
  });

  it("重置会话是标题左侧那颗蓝钮：更大、蓝底蓝字，且真的接在 onResetSession 上", () => {
    const html = renderToStaticMarkup(
      <SlideRuleResetSessionButton isRunning={false} onResetSession={() => {}} />
    );
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).toContain('aria-label="重置会话"');
    // 放大：h-8 w-8（原簇里是 h-7 w-7），图标 h-4（原 h-3.5）
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("h-4 w-4");
    expect(html).not.toContain("h-7 w-7");
    // 蓝：品牌蓝前景 + 浅蓝底，不再是 #5c5c5c 灰
    expect(html).toContain("#1677ff");
    expect(html).toContain("#eef5ff");
    expect(html).not.toContain("#5c5c5c");
  });

  it("没给 onResetSession 就不画钮；推演中禁用", () => {
    expect(
      renderToStaticMarkup(<SlideRuleResetSessionButton isRunning={false} />)
    ).toBe("");
    const running = renderToStaticMarkup(
      <SlideRuleResetSessionButton isRunning onResetSession={() => {}} />
    );
    expect(running).toContain("disabled");
    expect(running).toContain("推演进行中，稍后再重置");
  });

  it("空会话不挂布局档分段（舞台还没登场）", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available={false}>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-layout-controls"');
    expect(html).not.toContain('data-testid="sliderule-workbench-mode"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain('data-testid="sliderule-layout-stage"');
    expect(html).not.toContain('data-testid="sliderule-layout-maximize"');
    expect(html).not.toContain('data-testid="sliderule-layout-reset"');
  });

  it("布局是互斥分段 分栏|全屏|画布，不是三颗独立开关", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-workbench-mode"');
    expect(html).toContain("primer-segmented-control");
    expect(html).toContain('data-testid="sliderule-workbench-mode-split"');
    expect(html).toContain('data-testid="sliderule-workbench-mode-stage"');
    expect(html).toContain('data-testid="sliderule-stage-view-canvas"');
    expect(html).toContain("分栏");
    expect(html).toContain("全屏");
    expect(html).toContain("画布");
    // ⚠ 2026-09-01：隐藏页面 / 最大化独立钮撤了。把它们加回来这条必红。
    expect(html).not.toContain('data-testid="sliderule-layout-stage"');
    expect(html).not.toContain('data-testid="sliderule-layout-maximize"');
    expect(html).not.toContain("隐藏页面");
    expect(html).not.toContain("打开画布");
    // ⚠ 2026-08-24 用户反馈"按钮一多看不懂啥意思"：重置布局整片撤掉。
    expect(html).not.toContain('data-testid="sliderule-layout-reset"');
    expect(html).not.toContain('aria-label="重置布局"');
    expect(html).not.toContain('data-testid="sliderule-layout-sidebar"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain("折叠舞台");
    expect(html).not.toContain("折叠会话栏");
    expect(html).not.toContain("折叠对话");
  });

  it("推演锁读 context.layoutLocked，不读 TopHud 的 isRunning prop", () => {
    /**
     * ⚠ 双源：TopHud 一直有个没用的 isRunning。若分段控件误读这个 prop，
     * SlideRule 忘了灌 layoutLocked 时单测仍绿、真机推演中还能乱切。
     * 正：Provider.layoutLocked 才置灰。反：只传 isRunning 不许锁。
     */
    const unlocked = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleTopHud isRunning />
      </StudioLayoutProvider>
    );
    expect(unlocked).toContain("分栏");
    expect(unlocked).not.toContain("推演进行中，布局锁定为分栏");

    const locked = renderToStaticMarkup(
      <StudioLayoutProvider available layoutLocked>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(locked).toContain("推演进行中，布局锁定为分栏（对话+页面）");
    expect(locked).toContain("disabled");
    expect(locked).toContain("opacity-40");
  });
});

describe("PreviewChromeLayoutButtons", () => {
  it("空会话不挂；有舞台时是全屏+隐藏，不是分段/交付物", () => {
    expect(
      renderToStaticMarkup(
        <StudioLayoutProvider available={false}>
          <PreviewChromeLayoutButtons />
        </StudioLayoutProvider>
      )
    ).toBe("");
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <PreviewChromeLayoutButtons />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="project-preview-fullscreen"');
    expect(html).toContain('aria-label="全屏"');
    expect(html).toContain('data-testid="project-preview-hide-stage"');
    expect(html).toContain('aria-label="隐藏页面"');
    expect(html).not.toContain('data-testid="sliderule-workbench-mode"');
    expect(html).not.toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain("分栏");
    expect(html).not.toContain("画布");
  });

  it("推演中两颗置灰", () => {
    const locked = renderToStaticMarkup(
      <StudioLayoutProvider available layoutLocked>
        <PreviewChromeLayoutButtons />
      </StudioLayoutProvider>
    );
    expect(locked).toContain("disabled");
    expect(locked).toContain("推演进行中，布局锁定为分栏（对话+页面）");
    expect(locked).toContain('data-testid="project-preview-fullscreen"');
  });
});
