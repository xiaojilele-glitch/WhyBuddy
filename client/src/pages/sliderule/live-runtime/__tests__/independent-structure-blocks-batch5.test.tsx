import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { INDEPENDENT_STRUCTURE_BATCH5_LABELS, conditionTreeValid, cropCanApply, joinCanRun, pivotCanPreview, polygonCanSave, routeCanPublish } from "../independent-structure-blocks-batch5";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = { demo: [
  { id: "one", createdAt: "2026-08-11T10:00:00Z", values: { name: "第一项", x: 15, y: 20, status: "ready", eta: "09:00", type: "string", shelf: "rows", group: "A", logic: "and", field: "amount", operator: "greater_than", compare: "100", image: "/brand/logo.png", side: "left", dataset: "orders", column: "customer_id" } },
  { id: "two", createdAt: "2026-08-11T10:01:00Z", values: { name: "第二项", x: 75, y: 20, status: "ready", eta: "09:30", type: "metric", shelf: "values", group: "B", logic: "or", field: "level", operator: "equals", compare: "gold", image: "/brand/logo.png", side: "right", dataset: "customers", column: "id" } },
  { id: "three", createdAt: "2026-08-11T10:02:00Z", values: { name: "第三项", x: 50, y: 80, status: "ready", eta: "10:00", type: "date", shelf: "columns", group: "B", logic: "or", field: "active", operator: "equals", compare: "true", image: "/brand/logo.png", side: "right", dataset: "customers", column: "name" } },
] };
const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  GeofenceVertexEditor: { entityRef: "demo", vertexNameFieldRef: "name", longitudeFieldRef: "x", latitudeFieldRef: "y", targets: ["map"] },
  RouteStopSequencer: { entityRef: "demo", stopNameFieldRef: "name", longitudeFieldRef: "x", latitudeFieldRef: "y", stopStatusFieldRef: "status", etaFieldRef: "eta", targets: ["route"] },
  PivotShelfComposer: { entityRef: "demo", fieldNameFieldRef: "name", fieldTypeFieldRef: "type", defaultShelfFieldRef: "shelf", targets: ["pivot"] },
  BooleanRuleTreeBuilder: { entityRef: "demo", conditionGroupFieldRef: "group", groupLogicFieldRef: "logic", conditionFieldFieldRef: "field", operatorFieldRef: "operator", compareValueFieldRef: "compare", targets: ["rules"] },
  ImageCropTransformStudio: { entityRef: "demo", assetNameFieldRef: "name", imageUrlFieldRef: "image", targets: ["asset"] },
  DatasetJoinBuilder: { entityRef: "demo", datasetSideFieldRef: "side", datasetNameFieldRef: "dataset", columnNameFieldRef: "column", columnTypeFieldRef: "type", targets: ["query"] },
};

describe("independent structure block batch 5", () => {
  it("keeps all structure families globally unique and explicit", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string }> };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(structured.length);
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH5_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(selected.every(block => block.rendererStatus === "real" && Boolean(block.structureDelta))).toBe(true);
    expect(new Set(selected.map(block => block.rendererKey)).size).toBe(6);
  });
  it("renders six real desktop and phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH5_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { surface: "plain" }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />), phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true); expect(desktop, type).not.toContain("尚未绑定"); expect(phone, type).not.toContain("尚未绑定"); expect(phone, type).toContain("data-testid=\"phone-");
    }
  });
  it("uses distinct non-table dependencies", () => {
    const desktop = new Set<string>(), phone = new Set<string>();
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH5_LABELS)) { const usage = usageForBlock(type); expect(usage.desktop, type).not.toContain("Table"); expect(usage.phone, type).not.toContain("M.Table"); desktop.add(usage.desktop.slice().sort().join("|")); phone.add(usage.phone.slice().sort().join("|")); }
    expect(desktop.size).toBe(6); expect(phone.size).toBe(6);
  });
  it("enforces each new state boundary", () => {
    expect(polygonCanSave([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(false); expect(polygonCanSave([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }])).toBe(true);
    expect(routeCanPublish(["ready", "blocked"])).toBe(false); expect(routeCanPublish(["ready", "ready"])).toBe(true);
    expect(pivotCanPreview({ rows: ["a"], columns: [], values: [] })).toBe(false); expect(pivotCanPreview({ rows: ["a"], columns: [], values: ["b"] })).toBe(true);
    expect(conditionTreeValid([{ field: "amount", operator: "gt", compare: "" }])).toBe(false); expect(cropCanApply(72, 68)).toBe(true); expect(cropCanApply(0, 68)).toBe(false); expect(joinCanRun("left", "right")).toBe(true); expect(joinCanRun("", "right")).toBe(false);
  });
});
