/**
 * `<StatusCapsule>` tests — Wave 1 / Spec 2 任务 6
 *
 * 覆盖 3 + case：
 * 1. 中文 completed 渲染「构建完成」
 * 2. 英文 active 渲染「RUNNING」+ 存在 `animate-pulse` 节点
 * 3. pending 拥有灰色背景 class + 正确 `data-status`
 *
 * 遵循本仓库现有测试约束：不使用 `@testing-library/react` / jsdom，
 * 统一走 `react-dom/server` SSR 渲染 + 字符串断言。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusCapsule } from "../status-capsule";

describe("<StatusCapsule>", () => {
  it("renders the zh-CN completed label '构建完成' with green background", () => {
    const markup = renderToStaticMarkup(
      <StatusCapsule status="completed" locale="zh-CN" />,
    );

    expect(markup).toContain('data-testid="autopilot-status-capsule"');
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain("构建完成");
    expect(markup).toContain("bg-[#22c55e]");
    // completed must NOT render the pulse dot
    expect(markup).not.toContain("animate-pulse");
  });

  it("renders the en-US active label 'RUNNING' with pulse dot and orange background", () => {
    const markup = renderToStaticMarkup(
      <StatusCapsule status="active" locale="en-US" />,
    );

    expect(markup).toContain('data-status="active"');
    expect(markup).toContain("RUNNING");
    expect(markup).toContain("bg-[#FF4500]");
    // active embeds the pulsing white dot (需求 2.active)
    expect(markup).toContain("animate-pulse");
  });

  it("renders the pending label with gray surface color and pending data-status", () => {
    const markup = renderToStaticMarkup(
      <StatusCapsule status="pending" locale="zh-CN" />,
    );

    expect(markup).toContain('data-status="pending"');
    expect(markup).toContain("bg-[#F5F5F5]");
    expect(markup).toContain("等待");
    // pending must NOT render the pulse dot
    expect(markup).not.toContain("animate-pulse");
  });
});
