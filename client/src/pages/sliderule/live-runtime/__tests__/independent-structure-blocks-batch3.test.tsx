import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import {
  INDEPENDENT_STRUCTURE_BATCH3_LABELS,
  clampGridLayout,
  expressionToken,
  filterLogs,
  replayEventAt,
  traceBarPercent,
  uploadOperationForStatus,
} from "../independent-structure-blocks-batch3";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = {
  demo: [
    { id: "first", createdAt: "2026-08-11T09:00:00.000Z", values: { name: "第一项", size: 12, transferStatus: "uploading", progress: 60, parent: "", start: 0, duration: 100, status: "ok", path: "order.total", sample: "428", dataType: "number", offset: 0, eventType: "navigation", summary: "进入页面", severity: "info", x: 0, y: 0, w: 6, h: 1, time: "10:00:00", level: "info", message: "started", stream: "api" } },
    { id: "second", createdAt: "2026-08-11T09:01:00.000Z", values: { name: "第二项", size: 8, transferStatus: "failed", progress: 20, parent: "first", start: 20, duration: 60, status: "error", path: "customer.name", sample: "林雪", dataType: "string", offset: 1200, eventType: "request", summary: "请求失败", severity: "error", x: 6, y: 0, w: 6, h: 1, time: "10:00:01", level: "error", message: "timeout", stream: "worker" } },
  ],
};

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  ResumableUploadQueue: { entityRef: "demo", fileNameFieldRef: "name", fileSizeFieldRef: "size", transferStatusFieldRef: "transferStatus", transferProgressFieldRef: "progress", targets: ["uploads"] },
  DistributedTraceWaterfall: { entityRef: "demo", spanNameFieldRef: "name", spanParentFieldRef: "parent", spanStartFieldRef: "start", spanDurationFieldRef: "duration", statusFieldRef: "status" },
  ExpressionDataMapper: { entityRef: "demo", dataPathFieldRef: "path", sampleValueFieldRef: "sample", dataTypeFieldRef: "dataType", targets: ["mapping"] },
  SessionReplayScrubber: { entityRef: "demo", eventOffsetFieldRef: "offset", eventTypeFieldRef: "eventType", summaryFieldRef: "summary", severityFieldRef: "severity" },
  DashboardGridComposer: { entityRef: "demo", panelTitleFieldRef: "name", gridXFieldRef: "x", gridYFieldRef: "y", gridWidthFieldRef: "w", gridHeightFieldRef: "h", targets: ["dashboard"] },
  LiveLogTailer: { entityRef: "demo", logTimeFieldRef: "time", logLevelFieldRef: "level", logMessageFieldRef: "message", logStreamFieldRef: "stream", targets: ["logs"] },
};

describe("independent structure block batch 3", () => {
  it("keeps every declared structure family globally unique", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string; generationEnabled: boolean }> };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(structured.length);
    const entries = Object.keys(INDEPENDENT_STRUCTURE_BATCH3_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(entries.every(entry => entry.rendererStatus === "real" && entry.generationEnabled)).toBe(true);
    expect(entries.every(entry => Boolean(entry.structureDelta))).toBe(true);
    expect(new Set(entries.map(entry => entry.rendererKey)).size).toBe(entries.length);
  });

  it("renders bound data through dedicated desktop and phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH3_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { title: INDEPENDENT_STRUCTURE_BATCH3_LABELS[type], surface: "plain", expression: "{{$json.order.total}}" }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      expect(desktop, type).toContain("data-testid=");
      expect(phone, type).toContain("data-testid=\"phone-");
      expect(desktop, type).not.toContain("尚未绑定");
      expect(phone, type).not.toContain("尚未绑定");
    }
  });

  it("has six distinct non-table component signatures", () => {
    const signatures = Object.keys(INDEPENDENT_STRUCTURE_BATCH3_LABELS).map(type => {
      const usage = usageForBlock(type);
      expect(usage.desktop, type).not.toContain("Table");
      expect(usage.phone, type).not.toContain("M.Table");
      return usage.all.slice().sort().join("|");
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("enforces each new state machine and calculation boundary", () => {
    expect(uploadOperationForStatus("uploading")).toBe("pauseUpload");
    expect(uploadOperationForStatus("paused")).toBe("resumeUpload");
    expect(uploadOperationForStatus("failed")).toBe("retryUpload");
    expect(uploadOperationForStatus("complete")).toBeUndefined();
    expect(traceBarPercent(25, 50, 100)).toEqual({ left: 25, width: 50 });
    expect(expressionToken("order.total")).toBe("{{$json.order.total}}");
    expect(replayEventAt(rows.demo, "offset", 1000).id).toBe("second");
    expect(clampGridLayout({ x: 11, y: -1, w: 8, h: 9 })).toEqual({ x: 11, y: 0, w: 1, h: 4 });
    expect(filterLogs(rows.demo, "level", "error").map(row => row.id)).toEqual(["second"]);
  });
});
