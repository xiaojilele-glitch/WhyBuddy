import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EXPERIENCE_BLOCK_CATALOG,
  EXPERIENCE_BLOCK_RENDERERS,
  ExperienceBlockBoundary,
} from "../live-runtime/block-registry";

describe("Experience Block Catalog（二阶段目录骨架）", () => {
  it("目录中的 type/rendererKey 唯一，且所有引用都在目录合法域中", () => {
    const { blocks, pageRegions, dataKinds, eventTypes } =
      EXPERIENCE_BLOCK_CATALOG;
    expect(new Set(blocks.map(block => block.type)).size).toBe(blocks.length);
    expect(new Set(blocks.map(block => block.rendererKey)).size).toBe(
      blocks.length
    );
    for (const block of blocks) {
      expect(block.description.trim()).not.toBe("");
      expect(block.dataKinds.every(value => dataKinds.includes(value))).toBe(
        true
      );
      expect(
        block.allowedRegions.every((value: string) => Object.hasOwn(pageRegions, value))
      ).toBe(true);
      expect(block.events.every(value => eventTypes.includes(value))).toBe(
        true
      );
    }
  });

  it("目录里的每个区块都有且只有一个前端渲染登记", () => {
    expect(Object.keys(EXPERIENCE_BLOCK_RENDERERS)).toEqual(
      EXPERIENCE_BLOCK_CATALOG.blocks.map(block => block.rendererKey)
    );
  });

  it("未知区块明确提示不支持；已登记区块保留原内容", () => {
    const unknown = renderToStaticMarkup(
      <ExperienceBlockBoundary block={{ id: "x", type: "MagicWall" }} />
    );
    expect(unknown).toContain("unsupported-experience-block");
    expect(unknown).toContain("暂不支持此区块：MagicWall");

    const known = renderToStaticMarkup(
      <ExperienceBlockBoundary block={{ id: "m", type: "MetricGrid" }}>
        <span>原有指标内容</span>
      </ExperienceBlockBoundary>
    );
    expect(known).toContain("原有指标内容");
    expect(known).not.toContain("暂不支持");

    // 2026-07-28：MetricGrid 等五个区块接了真渲染器（此前是 ExistingContentAdapter
    // 占位，画一个"下一阶段接入"的灰框）。没 children 时不再是占位提示，而是
    // 按 binding 取数；binding 缺失/绑不上就出诚实空态，说清楚缺的是什么。
    const noBinding = renderToStaticMarkup(
      <ExperienceBlockBoundary block={{ id: "m", type: "MetricGrid" }} />
    );
    expect(noBinding).toContain('data-testid="metric-grid"');
    expect(noBinding).toContain("指标未绑定到有效实体");
    expect(noBinding).not.toContain("下一阶段接入");
  });
});
