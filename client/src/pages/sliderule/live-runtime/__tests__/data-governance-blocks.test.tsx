import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { DATA_GOVERNANCE_LABELS } from "../data-governance-blocks";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const row = (id: string, status: string) => ({ id, createdAt: "2026-08-10T09:00:00.000Z", values: { title: `任务${id}`, source: `源${id}`, target: `目标${id}`, status, message: `说明${id}`, value: `值${id}`, parent: "", time: `2026-08-0${id}`, oldValue: "旧值", newValue: "新值", allowed: "inherit" } });
const binding = { entityRef: "items", titleFieldRef: "title", sourceFieldRef: "source", targetFieldRef: "target", statusFieldRef: "status", messageFieldRef: "message", valueFieldRef: "value", parentFieldRef: "parent", timeFieldRef: "time", oldValueFieldRef: "oldValue", newValueFieldRef: "newValue", allowedFieldRef: "allowed", targets: ["data"] };
const block = (type: string): ExperienceBlockInstance => ({ id: type, type, props: { title: DATA_GOVERNANCE_LABELS[type], surface: "card" }, binding });
const entityRows = { items: [row("1", "success"), row("2", "failed")] };

describe("数据治理与同步最佳实践区块", () => {
  it("12 个类型进入真实目录和双端渲染链", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; rendererStatus: string; generationEnabled: boolean; source?: { repo?: string; path?: string } }> };
    for (const type of Object.keys(DATA_GOVERNANCE_LABELS)) {
      const entry = catalog.blocks.find(item => item.type === type);
      expect(entry?.rendererStatus, type).toBe("real");
      expect(entry?.generationEnabled, type).toBe(true);
      expect(entry?.source?.repo, type).toBeTruthy();
      expect(entry?.source?.path, type).toBeTruthy();
      expect(BLOCK_DEFINITIONS[type]?.render, type).toBeTypeOf("function");
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
    }
  });

  it("桌面和手机都展示治理数据而不是占位壳", () => {
    for (const type of ["SchemaMappingPanel", "RetryQueuePanel", "RecordChangePreview", "WebhookDeliveryPanel"]) {
      const props = { block: block(type), entityRows };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
      expect(desktop).toContain(DATA_GOVERNANCE_LABELS[type]);
      expect(phone).toContain(DATA_GOVERNANCE_LABELS[type]);
      if (type === "SchemaMappingPanel") expect(desktop).toContain("源1");
      else expect(desktop).toContain("任务1");
    }
  });

  it("错误阻止导入，重试载荷入口只针对失败项", () => {
    const validation = renderToStaticMarkup(<ExperienceBlockBoundary block={block("ImportValidationPanel")} entityRows={entityRows} />);
    const retry = renderToStaticMarkup(<ExperienceBlockBoundary block={block("RetryQueuePanel")} entityRows={entityRows} />);
    expect(validation).toContain("1 个错误");
    expect(validation).toContain("disabled");
    expect(retry).toContain("1 个失败项可重试");
    expect(retry).toContain("仅重试失败项");
  });
});
