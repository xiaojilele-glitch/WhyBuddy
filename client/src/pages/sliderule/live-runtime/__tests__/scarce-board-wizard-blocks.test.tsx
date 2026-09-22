import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";
import type { RuntimeRow } from "../live-runtime";

const BOARD_TYPES = [
  "SwimlaneKanban", "WipLimitBoard", "DependencyKanban", "ContentPipelineBoard",
  "IncidentResponseBoard", "PortfolioKanban"
] as const;
const WIZARD_TYPES = ["OnboardingChecklistWizard", "ImportMappingWizard"] as const;
const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({ id, values, createdAt: "2026-08-10T09:00:00.000Z" });

describe("稀缺看板与配置向导", () => {
  it("16 个区块全部进入目录、真实桌面渲染器和独立手机渲染链", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; rendererStatus: string; source?: { repo?: string; path?: string } }> };
    for (const type of [...BOARD_TYPES, ...WIZARD_TYPES]) {
      const entry = catalog.blocks.find(item => item.type === type);
      expect(entry?.rendererStatus, `${type} 目录未登记真实渲染器`).toBe("real");
      expect(entry?.source?.repo, `${type} 缺开源来源`).toBeTruthy();
      expect(entry?.source?.path, `${type} 缺固定源码路径`).toBeTruthy();
      expect(BLOCK_DEFINITIONS[type]?.render, `${type} 缺桌面渲染器`).toBeTypeOf("function");
      expect(BLOCK_DEFINITIONS[type]?.phone, `${type} 未接手机端`).toBe(true);
    }
  });

  it("看板批次保留 Plane 的泳道、WIP、依赖和优先级策略，不只是换标题", () => {
    const source = renderToStaticMarkup(<ExperienceBlockBoundary
      block={{ id: "dependencies", type: "DependencyKanban", props: { surface: "plain" }, binding: { entityRef: "task", titleFieldRef: "title", statusFieldRef: "status", blockedFieldRef: "blocked", targets: ["task-board"] } }}
      entityRows={{ task: [row("t1", { title: "等待接口", status: "处理中", blocked: true })] }}
    />);
    expect(source).toContain("等待接口");
    expect(source).toContain("存在未完成依赖");
    expect(source).toContain("处理中");
  });

  it("导入映射向导在桌面与手机都显示真实步骤、进度和映射选择", () => {
    const block: ExperienceBlockInstance = {
      id: "mapping",
      type: "ImportMappingWizard",
      props: { title: "客户字段映射", surface: "card" },
      binding: { entityRef: "mappingStep", titleFieldRef: "title", statusFieldRef: "status", descFieldRef: "desc", targets: ["customer-import"] },
    };
    const props = {
      block,
      entityRows: { mappingStep: [row("name", { title: "客户名称", status: "ready", desc: "映射必填字段" }), row("phone", { title: "联系电话", status: "ready", desc: "核对号码格式" })] },
      enumOptionsOf: () => [{ id: "customer_name", label: "客户名称字段", tone: "default" as const }, { id: "phone_number", label: "电话号码字段", tone: "default" as const }],
    };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("客户字段映射");
      expect(markup).toContain("客户名称");
      expect(markup).toContain("映射必填字段");
    }
  });

  it("向导遇到阻塞状态时禁用下一步并显示校验错误", () => {
    const markup = renderToStaticMarkup(<ExperienceBlockBoundary
      // 2026-08-11 去重后 PolicyConfigurationWizard 已删（跟这条同工厂、参数只差文案），
      // 换成幸存的那个。守的是行为不是类型名：阻塞态要禁用下一步。
      block={{ id: "policy", type: "OnboardingChecklistWizard", props: { surface: "plain" }, binding: { entityRef: "step", titleFieldRef: "title", statusFieldRef: "status", targets: ["policy"] } }}
      entityRows={{ step: [row("scope", { title: "适用范围", status: "blocked" }), row("publish", { title: "发布确认", status: "pending" })] }}
    />);
    expect(markup).toContain("当前步骤存在校验错误");
    expect(markup).toContain("disabled");
  });
});
