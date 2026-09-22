import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { COLLABORATION_CONTENT_LABELS } from "../collaboration-content-blocks";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const row = (id: string, values: Record<string, unknown>) => ({ id, createdAt: "2026-08-10T09:00:00.000Z", values });
const binding = { entityRef: "items", titleFieldRef: "title", statusFieldRef: "status", messageFieldRef: "message", memberFieldRef: "member", parentFieldRef: "parent", countFieldRef: "count", timeFieldRef: "time", targets: ["content"] };
const block = (type: string): ExperienceBlockInstance => ({ id: type, type, props: { title: COLLABORATION_CONTENT_LABELS[type], surface: "card" }, binding });
const entityRows = { items: [row("one", { title: "第一项", status: "pending", message: "说明", member: "王明", parent: "", count: 10, time: "2026-08-10" }), row("two", { title: "第二项", status: "active", message: "补充", member: "李华", parent: "one", count: 20, time: "2026-08-09" })] };

describe("协作与内容最佳实践区块", () => {
  it("12 个类型都有真实目录、桌面渲染器和手机渲染链", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; rendererStatus: string; generationEnabled: boolean; source?: { repo?: string; path?: string } }> };
    for (const type of Object.keys(COLLABORATION_CONTENT_LABELS)) {
      const entry = catalog.blocks.find(item => item.type === type);
      expect(entry?.rendererStatus, type).toBe("real");
      expect(entry?.generationEnabled, type).toBe(true);
      expect(entry?.source?.repo, type).toBeTruthy();
      expect(entry?.source?.path, type).toBeTruthy();
      expect(BLOCK_DEFINITIONS[type]?.render, type).toBeTypeOf("function");
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
    }
  });

  it("桌面和手机都渲染真实协作内容", () => {
    for (const type of ["MentionComposer", "VersionComparePanel", "AssignmentQueuePanel", "WatcherManagerPanel"]) {
      const props = { block: block(type), entityRows };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
      expect(desktop).toContain(COLLABORATION_CONTENT_LABELS[type]);
      expect(phone).toContain(COLLABORATION_CONTENT_LABELS[type]);
      if (type === "VersionComparePanel" || type === "AssignmentQueuePanel") expect(desktop).toContain("第一项");
      if (type === "WatcherManagerPanel") expect(desktop).toContain("王明");
    }
  });

  it("版本对比坚持两条输入，提及正文没有内容时禁止发布", () => {
    const version = renderToStaticMarkup(<ExperienceBlockBoundary block={block("VersionComparePanel")} entityRows={entityRows} />);
    const mention = renderToStaticMarkup(<ExperienceBlockBoundary block={block("MentionComposer")} entityRows={entityRows} />);
    expect(version).toContain("请选择恰好两个版本");
    expect(version).toContain("disabled");
    expect(mention).toContain("候选人仅用于补全");
    expect(mention).toContain("disabled");
  });
});
