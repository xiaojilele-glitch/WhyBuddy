/**
 * `<SubStageCard>` tests — Wave 1 / Spec 2 任务 8
 *
 * 覆盖 7 + case：
 * 1. completed 状态：边框为 `border-[#E5E5E5]` 单像素
 * 2. active 状态：边框为 `border-[#FF4500]` 加粗（`border-2`）
 * 3. pending 状态：整卡 50% 透明度（`opacity-50`）
 * 4. 序号补零：`index={4}` 渲染 `05`
 * 5. `onToggleExpanded` 点击回调触发 + 展开/收起 label 切换
 * 6. `headerRight` 自定义插槽会覆盖默认 `<StatusCapsule>`
 * 7. `anchorAttr` + `ariaCurrentStep` 一起传入时，HTML 中
 *    `data-sub-stage-placeholder="..."` 必须出现在 `aria-current="step"` 之前
 *
 * 遵循本仓库现有测试约束：不使用 `@testing-library/react` / jsdom，
 * 统一走 `react-dom/server` SSR 渲染 + 字符串 / 正则断言。
 * 对 onClick 回调采用与 `RetryInlineNotice.test.tsx` 一致的「直接调用 FC + 遍历 props
 * 树」方式。
 */

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SubStageCard, type SubStageCardProps } from "../sub-stage-card";

function invokeSubStageCard(props: SubStageCardProps): ReactElement {
  // SubStageCard 是纯 FC（无 hooks / state），可直接调用拿到 ReactElement 树
  return (SubStageCard as unknown as (p: SubStageCardProps) => ReactElement)(
    props,
  );
}

describe("<SubStageCard>", () => {
  it("renders the completed status border and default StatusCapsule", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard
        index={0}
        title="协作角色"
        status="completed"
        locale="zh-CN"
      >
        <div data-testid="body-slot">body</div>
      </SubStageCard>,
    );

    expect(markup).toContain('data-testid="autopilot-sub-stage-card"');
    expect(markup).toContain('data-sub-stage-status="completed"');
    expect(markup).toContain("border-[#E5E5E5]");
    expect(markup).not.toContain("border-2");
    expect(markup).not.toContain("opacity-50");
    // Default header right slot renders <StatusCapsule> with zh-CN completed label
    expect(markup).toContain('data-testid="autopilot-status-capsule"');
    expect(markup).toContain("构建完成");
    // Body children pass through
    expect(markup).toContain('data-testid="body-slot"');
  });

  it("renders the active status with a 2px orange border", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard
        index={1}
        title="SpecTree"
        status="active"
        locale="zh-CN"
      >
        <div>body</div>
      </SubStageCard>,
    );

    expect(markup).toContain('data-sub-stage-status="active"');
    expect(markup).toContain("border-2");
    expect(markup).toContain("border-[#FF4500]");
    expect(markup).not.toContain("opacity-50");
  });

  it("renders the pending status with 50% opacity", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard
        index={2}
        title="RuntimeCapability"
        status="pending"
        locale="zh-CN"
      >
        <div>body</div>
      </SubStageCard>,
    );

    expect(markup).toContain('data-sub-stage-status="pending"');
    expect(markup).toContain("border-[#EAEAEA]");
    expect(markup).toContain("opacity-50");
    expect(markup).not.toContain("border-2");
  });

  it("pads the sequence number to two digits (index=4 → 05)", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard index={4} title="PromptPackage" status="pending" locale="zh-CN">
        <div />
      </SubStageCard>,
    );

    expect(markup).toContain(">05<");
    expect(markup).not.toContain(">5<");
  });

  it("invokes onToggleExpanded and swaps the toggle label between 展开/收起", () => {
    const collapsedMarkup = renderToStaticMarkup(
      <SubStageCard
        index={0}
        title="协作角色"
        status="completed"
        locale="zh-CN"
        onToggleExpanded={() => {}}
        expanded={false}
      >
        <div />
      </SubStageCard>,
    );

    expect(collapsedMarkup).toContain('data-testid="autopilot-sub-stage-card-toggle"');
    expect(collapsedMarkup).toContain("展开 ↓");
    expect(collapsedMarkup).not.toContain("收起 ↑");

    const expandedMarkup = renderToStaticMarkup(
      <SubStageCard
        index={0}
        title="协作角色"
        status="completed"
        locale="zh-CN"
        onToggleExpanded={() => {}}
        expanded={true}
      >
        <div />
      </SubStageCard>,
    );
    expect(expandedMarkup).toContain("收起 ↑");
    expect(expandedMarkup).not.toContain("展开 ↓");

    // Invoke toggle callback by walking the element tree
    const onToggle = vi.fn();
    const element = invokeSubStageCard({
      index: 0,
      title: "协作角色",
      status: "completed",
      locale: "zh-CN",
      onToggleExpanded: onToggle,
      expanded: false,
      children: null,
    });

    // Root children is an array; find the footer containing the toggle button
    const rootChildren = (
      element.props as { children: ReactElement[] }
    ).children;
    const footer = rootChildren.find(
      (child) =>
        child !== null &&
        typeof child === "object" &&
        (child as ReactElement).type === "footer",
    ) as ReactElement | undefined;
    expect(footer).toBeDefined();

    const button = (footer!.props as { children: ReactElement }).children;
    expect(button.type).toBe("button");
    (button.props as { onClick: () => void }).onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("allows headerRight to override the default StatusCapsule", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard
        index={0}
        title="协作角色"
        status="active"
        locale="zh-CN"
        headerRight={
          <span data-testid="custom-header-right">CUSTOM</span>
        }
      >
        <div />
      </SubStageCard>,
    );

    expect(markup).toContain('data-testid="custom-header-right"');
    expect(markup).toContain("CUSTOM");
    // Default StatusCapsule must be absent when headerRight is provided
    expect(markup).not.toContain('data-testid="autopilot-status-capsule"');
  });

  it("renders anchorAttr before aria-current on the root article element", () => {
    const markup = renderToStaticMarkup(
      <SubStageCard
        index={0}
        title="协作角色"
        status="active"
        locale="zh-CN"
        anchorAttr={{
          name: "data-sub-stage-placeholder",
          value: "agent_crew_fabric",
        }}
        ariaCurrentStep
      >
        <div />
      </SubStageCard>,
    );

    // Must contain both attributes
    expect(markup).toContain('data-sub-stage-placeholder="agent_crew_fabric"');
    expect(markup).toContain('aria-current="step"');

    // Ordering contract required by fabric-dispatch.property.test.tsx:
    // `data-sub-stage-placeholder="X"` must appear before `aria-current="step"`
    // on the same element.
    expect(markup).toMatch(
      /data-sub-stage-placeholder="agent_crew_fabric"[^>]*aria-current="step"/,
    );
  });
});
