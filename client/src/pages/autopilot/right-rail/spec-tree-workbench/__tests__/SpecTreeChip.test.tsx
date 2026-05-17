/**
 * autopilot-spec-tree-workbench / Wave 0 Task 3
 *
 * SpecTreeChip 组件 SSR 单测。
 *
 * 测试策略：renderToStaticMarkup + 字符串断言（与 RoleStatusStrip /
 * CapabilityRail / FleetActivationLog 等其它 right-rail 子组件保持一致）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpecTreeChipDescriptor } from "../../derive-spec-tree-chip";

import { SpecTreeChip } from "../SpecTreeChip";

function makeDescriptor(
  partial: Partial<SpecTreeChipDescriptor> & {
    label: string;
    tone: SpecTreeChipDescriptor["tone"];
  }
): SpecTreeChipDescriptor {
  return {
    label: partial.label,
    tone: partial.tone,
    sourceTag: partial.sourceTag,
    detail: partial.detail ?? {},
    ephemeralProgress: partial.ephemeralProgress,
  };
}

describe("SpecTreeChip", () => {
  it("neutral '未生成' 渲染 label + tone class,无 sourceTag", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip descriptor={makeDescriptor({ label: "未生成", tone: "neutral" })} />
    );
    expect(markup).toContain('data-testid="spec-tree-chip"');
    expect(markup).toContain('data-tone="neutral"');
    expect(markup).toContain("未生成");
    expect(markup).not.toContain("· llm");
    expect(markup).not.toContain("· fallback");
    expect(markup).not.toContain("· template");
  });

  it("success '3/3 accepted · llm' 渲染 sourceTag 后缀", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip
        descriptor={makeDescriptor({
          label: "3/3 accepted",
          tone: "success",
          sourceTag: "llm",
        })}
      />
    );
    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain('data-source="llm"');
    expect(markup).toContain("3/3 accepted");
    expect(markup).toContain("· llm");
  });

  it("warning + fallback sourceTag", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip
        descriptor={makeDescriptor({
          label: "2/3 reviewing",
          tone: "warning",
          sourceTag: "fallback",
        })}
      />
    );
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain('data-source="fallback"');
    expect(markup).toContain("· fallback");
  });

  it("danger '3/3 rejected'", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip
        descriptor={makeDescriptor({
          label: "3/3 rejected",
          tone: "danger",
          sourceTag: "llm",
        })}
      />
    );
    expect(markup).toContain('data-tone="danger"');
    expect(markup).toContain("3/3 rejected");
  });

  it("ephemeral generating 通过 data 属性可见", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip
        descriptor={makeDescriptor({
          label: "1/3 生成中",
          tone: "info",
          ephemeralProgress: "generating",
        })}
      />
    );
    expect(markup).toContain('data-ephemeral="generating"');
    expect(markup).toContain("生成中");
  });

  it("自定义 testid 覆盖默认值", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeChip
        descriptor={makeDescriptor({ label: "x", tone: "neutral" })}
        testid="custom-chip-1"
      />
    );
    expect(markup).toContain('data-testid="custom-chip-1"');
    expect(markup).not.toContain('data-testid="spec-tree-chip"');
  });
});
