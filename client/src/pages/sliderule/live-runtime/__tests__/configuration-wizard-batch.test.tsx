import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import {
  CONFIGURATION_WIZARD_POLICIES,
  CONFIGURATION_WIZARD_RENDERERS,
} from "../configuration-wizard-batch";
import {
  BLOCK_DEFINITIONS,
  ExperienceBlockBoundary,
  type ExperienceBlockInstance,
} from "../block-registry";
import type { RuntimeRow } from "../live-runtime";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";
import { PHONE_CONFIGURATION_WIZARD_RENDERERS } from "../phone-mobile/PhoneConfigurationWizardBatch";

const TYPES = [
  "BulkOperationWizard",
  "ApprovalRoutingWizard",
  "DataRetentionWizard",
  "RecoveryPlanWizard",
] as const;

const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({
  id,
  values,
  createdAt: "2026-08-10T09:00:00.000Z",
});

function block(type: (typeof TYPES)[number]): ExperienceBlockInstance {
  return {
    id: `test-${type}`,
    type,
    props: { title: "高级配置", surface: "plain" },
    binding: {
      entityRef: "step",
      titleFieldRef: "title",
      statusFieldRef: "status",
      descFieldRef: "desc",
      targets: ["delivery"],
    },
  };
}

describe("advanced configuration wizard batch", () => {
  it("registers 16 unique catalog contracts and both renderer chains", () => {
    const catalog = catalogJson as {
      version: number;
      blocks: Array<{
        type: string;
        rendererStatus: string;
        events: string[];
        allowedRegions: string[];
        bindingSchema: { required: string[] };
        source?: { repo?: string; path?: string; took?: string };
      }>;
    };
    for (const type of TYPES) {
      const entries = catalog.blocks.filter(item => item.type === type);
      expect(entries, `${type} must be unique`).toHaveLength(1);
      const entry = entries[0];
      expect(entry.rendererStatus).toBe("real");
      expect(entry.events).toEqual(["stepChange", "submitRequest"]);
      expect(entry.bindingSchema.required).toEqual([
        "entityRef",
        "titleFieldRef",
        "statusFieldRef",
        "targets",
      ]);
      expect(entry.source?.repo).toBeTruthy();
      expect(entry.source?.path).toBeTruthy();
      expect(entry.source?.took).toBeTruthy();
      expect(BLOCK_DEFINITIONS[type]?.render).toBeTypeOf("function");
      expect(BLOCK_DEFINITIONS[type]?.phone).toBe(true);
      expect(CONFIGURATION_WIZARD_RENDERERS[type]).toBeTypeOf("function");
      expect(PHONE_CONFIGURATION_WIZARD_RENDERERS[type]).toBeTypeOf("function");
    }
  });

  it("gives every policy a distinct backend operation", () => {
    const operations = TYPES.map(
      type => CONFIGURATION_WIZARD_POLICIES[type].operation
    );
    expect(new Set(operations).size).toBe(TYPES.length);
  });

  it("renders independent desktop ProForm and mobile Steps controls", () => {
    const props = {
      block: block("DataRetentionWizard"),
      entityRows: {
        step: [
          row("version", {
            title: "版本兼容性",
            status: "ready",
            desc: "核对 Schema 差异",
          }),
          row("cutover", { title: "迁移窗口", status: "pending" }),
        ],
      },
      enumOptionsOf: () => [
        { id: "safe", label: "兼容迁移", tone: "default" as const },
      ],
    };
    const desktop = renderToStaticMarkup(
      <ExperienceBlockBoundary {...props} />
    );
    const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
    for (const markup of [desktop, phone]) {
      expect(markup).toContain("版本兼容性");
      expect(markup).toContain("核对 Schema 差异");
      expect(markup).toContain("下一步");
    }
    expect(desktop).toContain("ant-form");
    expect(desktop).toContain("配置选项");
    expect(phone).toContain("adm-steps");
    expect(phone).toContain("adm-selector");
    expect(phone).toContain("adm-button");
    expect(phone).toContain("adm-text-area");
  });

  it("blocks bulk operations without a real selection", () => {
    const markup = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={block("BulkOperationWizard")}
        entityRows={{
          step: [
            row("scope", { title: "选择范围", status: "ready" }),
            row("confirm", { title: "确认变更", status: "pending" }),
          ],
        }}
      />
    );
    expect(markup).toContain("没有选中任何记录");
    expect(markup).toContain("disabled");
  });

  it("keeps blocked data-repair steps in place", () => {
    const props = {
      block: block("ApprovalRoutingWizard"),
      entityRows: {
        step: [
          row("validate", { title: "规则校验", status: "blocked" }),
          row("repair", { title: "执行修复", status: "pending" }),
        ],
      },
      enumOptionsOf: () => [
        { id: "normalize", label: "标准化修复", tone: "default" as const },
      ],
    };
    for (const markup of [
      renderToStaticMarkup(<ExperienceBlockBoundary {...props} />),
      renderToStaticMarkup(<PhoneExperienceBlock {...props} />),
    ]) {
      expect(markup).toContain("当前步骤被阻塞");
      expect(markup).toContain("disabled");
    }
  });
});
