import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import {
  INDEPENDENT_STRUCTURE_BATCH2_LABELS,
  calculateBinUsagePercent,
  canPublishTrafficAllocation,
  isRetryableNodeStatus,
  pickScanMatches,
  resolveQueryDraft,
  selectUrgentSlaRow,
} from "../independent-structure-blocks-batch2";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = {
  demo: [
    { id: "first", createdAt: "2026-08-11T09:00:00.000Z", values: { title: "第一项", status: "complete", parent: "", message: "ok", query: "select 1", count: 1, aisle: "A", used: 0, capacity: 0, weight: 60, deadline: "2026-08-12T10:00:00+08:00", owner: "Lin", bin: "A-01", scanCode: "SKU-1", picked: 0 } },
    { id: "second", createdAt: "2026-08-11T09:01:00.000Z", values: { title: "第二项", status: "failed", parent: "first", message: "timeout", query: "select 2", count: 2, aisle: "B", used: 75, capacity: 100, weight: 40, deadline: "2026-08-11T10:00:00+08:00", owner: "Zhou", bin: "B-02", scanCode: "SKU-2", picked: 1 } },
  ],
};

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  WorkflowNodeDebugger: { entityRef: "demo", titleFieldRef: "title", statusFieldRef: "status", nodeParentFieldRef: "parent", nodeMessageFieldRef: "message", targets: ["workflow"] },
  QueryNotebookComposer: { entityRef: "demo", titleFieldRef: "title", queryFieldRef: "query", statusFieldRef: "status", resultCountFieldRef: "count", targets: ["query"] },
  WarehouseBinHeatmap: { entityRef: "demo", nameFieldRef: "title", aisleFieldRef: "aisle", binUsedFieldRef: "used", binCapacityFieldRef: "capacity" },
  ExperimentTrafficAllocator: { entityRef: "demo", nameFieldRef: "title", variantWeightFieldRef: "weight", targets: ["experiment"] },
  SlaBreachClock: { entityRef: "demo", titleFieldRef: "title", slaDeadlineFieldRef: "deadline", statusFieldRef: "status", slaOwnerFieldRef: "owner", targets: ["ticket"] },
  WarehousePickRouteScanner: { entityRef: "demo", titleFieldRef: "title", pickBinFieldRef: "bin", scanCodeFieldRef: "scanCode", pickedQuantityFieldRef: "picked", targets: ["pick"] },
};

describe("independent structure block batch 2", () => {
  it("requires one unique structure family, renderer and delta per type", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string; generationEnabled: boolean }> };
    const entries = Object.keys(INDEPENDENT_STRUCTURE_BATCH2_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(entries.every(entry => entry.rendererStatus === "real" && entry.generationEnabled)).toBe(true);
    expect(entries.every(entry => Boolean(entry.structureDelta))).toBe(true);
    expect(new Set(entries.map(entry => entry.structureFamily)).size).toBe(entries.length);
    expect(new Set(entries.map(entry => entry.rendererKey)).size).toBe(entries.length);
  });

  it("renders real bound data through dedicated desktop and phone routes", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH2_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { title: INDEPENDENT_STRUCTURE_BATCH2_LABELS[type], surface: "plain" }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      expect(desktop, type).toContain("data-testid=");
      expect(phone, type).toContain("data-testid=\"phone-");
      expect(desktop, type).not.toContain("尚未绑定");
      expect(phone, type).not.toContain("尚未绑定");
    }
  });

  it("keeps every structure non-table and component signatures distinct", () => {
    const signatures = Object.keys(INDEPENDENT_STRUCTURE_BATCH2_LABELS).map(type => {
      const usage = usageForBlock(type);
      expect(usage.desktop, type).not.toContain("Table");
      expect(usage.phone, type).not.toContain("M.Table");
      return usage.all.slice().sort().join("|");
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("enforces the state gates instead of inventing successful state", () => {
    expect(isRetryableNodeStatus("complete")).toBe(false);
    expect(isRetryableNodeStatus("failed")).toBe(true);
    expect(resolveQueryDraft("select changed", "select stored")).toBe("select changed");
    expect(calculateBinUsagePercent(12, 0)).toBe(0);
    expect(calculateBinUsagePercent(130, 100)).toBe(100);
    expect(canPublishTrafficAllocation([45, 35, 10])).toBe(false);
    expect(canPublishTrafficAllocation([45, 35, 20])).toBe(true);
    expect(pickScanMatches(" wrong ", "SKU-1")).toBe(false);
    expect(pickScanMatches(" SKU-1 ", "SKU-1")).toBe(true);
    expect(selectUrgentSlaRow(rows.demo, "deadline").id).toBe("second");
  });
});
