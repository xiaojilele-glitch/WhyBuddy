import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary } from "../block-registry";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";
import type { ExperienceBlockInstance } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

const BOARD_TYPES = [
  "SwimlaneKanban", "WipLimitBoard", "DependencyKanban", "ContentPipelineBoard",
  "IncidentResponseBoard", "PortfolioKanban"
] as const;

const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({
  id, values, createdAt: "2026-08-10T08:00:00.000Z",
});

function board(type: string): ExperienceBlockInstance {
  return {
    id: type,
    type,
    props: { title: `${type} 示例`, surface: "plain", wipLimit: 2 },
    binding: {
      entityRef: "work", titleFieldRef: "title", statusFieldRef: "status",
      laneFieldRef: "lane", priorityFieldRef: "priority", blockedFieldRef: "blocked",
      limitFieldRef: "limit", progressFieldRef: "progress", ownerFieldRef: "owner",
      targets: ["work"],
    },
  };
}

const rows = {
  work: [
    row("a", { title: "核对范围", status: "待处理", lane: "平台", priority: 3, blocked: false, limit: 2, progress: 40, owner: "陈晓" }),
    row("b", { title: "发布检查", status: "进行中", lane: "平台", priority: 2, blocked: true, limit: 2, progress: 80, owner: "周宁" })
  ],
};

describe("稀缺看板第一批", () => {
  it("12 种看板都有独立注册项和真实 desktop + phone 输出", () => {
    for (const type of BOARD_TYPES) {
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      const props = { block: board(type), entityRows: rows };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
      expect(desktop, type).toContain("核对范围");
      expect(desktop, type).toContain("待处理");
      expect(phone, type).toContain("核对范围");
      expect(phone, type).toContain("待处理");
      expect(phone, type).toContain("移动到其他阶段");
    }
  });

  it("WIP 和依赖边界会在渲染结果中明确反馈", () => {
    const wip = renderToStaticMarkup(<ExperienceBlockBoundary block={board("WipLimitBoard")} entityRows={rows} />);
    const dependency = renderToStaticMarkup(<ExperienceBlockBoundary block={board("DependencyKanban")} entityRows={rows} />);
    expect(wip).toContain("WIP");
    expect(wip).toContain("1/2");
    expect(dependency).toContain("存在未完成依赖");
  });

  it("目录为每个类型提供完整合法域并记录成熟来源", () => {
    const types = new Set([...BOARD_TYPES, "SavedViewManager", "ColumnChooserDrawer", "ActivityContextDrawer", "BulkActionTray"]);
    const entries = (catalogJson as { blocks: Array<Record<string, unknown>> }).blocks.filter(entry => types.has(String(entry.type) as never));
    // 数量由上面那份 types 集合派生，不写死 —— 2026-08-11 去重砍掉一批看板之后
    // 写死的 16 立刻过期，而这条判据要守的是"清单里每个都在目录里、且合法域齐全"。
    expect(entries).toHaveLength(types.size);
    for (const entry of entries) {
      expect(entry.rendererStatus).toBe("real");
      expect(entry.generationEnabled).toBe(true);
      expect(entry.propsSchema).toBeTruthy();
      expect(entry.bindingSchema).toBeTruthy();
      expect(entry.allowedRegions).toBeTruthy();
      expect(entry.pageKinds).toBeTruthy();
      expect((entry.source as { repo?: string }).repo).toBeTruthy();
    }
  });
});
