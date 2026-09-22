import React from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExperienceBlockBoundary,
  type ExperienceBlockInstance,
  type ExperienceBlockRendererProps,
} from "../block-registry";

function render(
  block: ExperienceBlockInstance,
  props: Omit<ExperienceBlockRendererProps, "block"> = {}
) {
  return renderToStaticMarkup(
    <ExperienceBlockBoundary block={block} {...props} />
  );
}

describe("experience blocks use Ant Design primitives", () => {
  it("renders FilterBar as QueryFilter with Ant Design form controls", () => {
    const html = render(
      {
        id: "filters",
        type: "FilterBar",
        props: { title: "Check-in Filters", showDateRange: true },
      },
      {
        filterState: { enumFilters: {} },
        filterFieldOptions: [
          {
            id: "status",
            label: "Status",
            options: [{ value: "open", label: "Open" }],
          },
        ],
        dateRangeField: { id: "created_at", label: "Created at" },
      }
    );

    expect(html).toContain("ant-pro-query-filter");
    expect(html).toContain("ant-picker");
    expect(html).toContain("ant-select");
    expect(html).not.toContain('type="date"');
  });

  it("renders WorkflowTimeline with Ant Design Steps instead of hand-drawn cards", () => {
    const html = render(
      {
        id: "workflow",
        type: "WorkflowTimeline",
        props: { title: "Exception Recovery" },
      },
      {
        workflow: {
          nodes: [
            { id: "detect", name: "Detect", assigneeRole: "front_desk" },
            { id: "verify", name: "Verify", assigneeRole: "manager" },
          ],
          transitions: [
            { from: "detect", to: "verify", condition: "manual review" },
          ],
        },
      }
    );

    expect(html).toContain("ant-steps");
    expect(html).toContain("ant-steps-item");
    expect(html).not.toContain("anticon-arrow-right");
  });

  it("renders QuickActionPanel with ProCard", () => {
    const html = render(
      { id: "actions", type: "QuickActionPanel", props: { title: "Actions" } },
      { pageActions: [{ id: "create", label: "Create", permitted: true }] }
    );

    expect(html).toContain("ant-pro-card");
    expect(html).toContain("ant-btn");
  });

  it("renders MetricGrid with StatisticCard", () => {
    const html = render(
      {
        id: "metrics",
        type: "MetricGrid",
        props: { title: "Overview" },
        binding: { entityRef: "orders", aggregate: "count" },
      },
      {
        entityRows: {
          orders: [
            { id: "1", values: {}, createdAt: "2026-01-01" },
            { id: "2", values: {}, createdAt: "2026-01-01" },
          ],
        },
      }
    );

    expect(html).toContain("ant-pro-statistic-card");
    expect(html).not.toContain("bg-stone-50");
  });
});

describe("phone experience blocks use Ant Design Mobile", () => {
  const blockRegistrySource = fs.readFileSync(
    path.resolve(__dirname, "../block-registry.tsx"),
    "utf8"
  );
  const screenSource = fs.readFileSync(
    path.resolve(__dirname, "../AppRuntimeScreen.tsx"),
    "utf8"
  );
  const phoneRendererPath = path.resolve(
    __dirname,
    "../phone-mobile/PhoneExperienceBlock.tsx"
  );
  const phoneSource = fs.existsSync(phoneRendererPath)
    ? fs.readFileSync(phoneRendererPath, "utf8")
    : "";

  it("configures QueryFilter itself with responsive desktop column spans", () => {
    expect(blockRegistrySource).toContain(
      "span={{ xs: 24, sm: 24, md: 12, lg: 12, xl: 8, xxl: 8 }}"
    );
    expect(blockRegistrySource).toContain('style: { width: "100%" }');
  });

  it("lazy-loads a dedicated phone renderer from the mobile chunk", () => {
    expect(screenSource).toContain(
      'import("./phone-mobile/PhoneExperienceBlock")'
    );
    expect(screenSource).toContain("<LazyPhoneExperienceBlock");
  });

  it("implements mobile blocks with antd-mobile and no desktop component imports", () => {
    expect(phoneSource).toContain('from "antd-mobile"');
    expect(phoneSource).not.toContain('from "antd"');
    expect(phoneSource).not.toContain("@ant-design/pro-components");
    for (const blockType of [
      "FilterBar",
      "MetricGrid",
      "WorkflowTimeline",
      "QuickActionPanel",
    ]) {
      expect(phoneSource).toContain(`case "${blockType}"`);
    }
  });
});
