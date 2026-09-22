import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { INDEPENDENT_STRUCTURE_BATCH4_LABELS, flameWidthPercent, mergeResolved, nextRotation, policyDecision, streamConfigurationValid } from "../independent-structure-blocks-batch4";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = { demo: [
  { id: "one", createdAt: "2026-08-11T09:00:00Z", values: { name: "第一项", parent: "", depth: 0, total: 100, self: 10, path: "a.ts", base: "a", ours: "b", theirs: "c", effect: "allow", reason: "role", type: "input", required: "required", page: 1, image: "/brand/logo.png", namespace: "sales", mode: "incremental", cursor: "updated_at", pk: "id" } },
  { id: "two", createdAt: "2026-08-11T09:01:00Z", values: { name: "第二项", parent: "one", depth: 1, total: 60, self: 20, path: "b.ts", base: "x", ours: "y", theirs: "z", effect: "deny", reason: "scope", type: "select", required: "optional", page: 2, image: "/brand/miantuan-mark.png", namespace: "sales", mode: "incremental", cursor: "", pk: "id" } },
] };
const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  FlameGraphProfiler: { entityRef: "demo", functionNameFieldRef: "name", profileParentFieldRef: "parent", profileDepthFieldRef: "depth", totalSamplesFieldRef: "total", selfSamplesFieldRef: "self" },
  ThreeWayMergeResolver: { entityRef: "demo", conflictPathFieldRef: "path", baseContentFieldRef: "base", oursContentFieldRef: "ours", theirsContentFieldRef: "theirs", targets: ["merge"] },
  PolicyDecisionSimulator: { entityRef: "demo", policyNameFieldRef: "name", policyEffectFieldRef: "effect", policyReasonFieldRef: "reason", targets: ["auth"] },
  FormCanvasBuilder: { entityRef: "demo", fieldLabelFieldRef: "name", fieldTypeFieldRef: "type", requiredFieldRef: "required", targets: ["form"] },
  PdfPageOrganizer: { entityRef: "demo", pageNumberFieldRef: "page", thumbnailFieldRef: "image", targets: ["pdf"] },
  StreamReplicationConfigurator: { entityRef: "demo", namespaceFieldRef: "namespace", streamNameFieldRef: "name", syncModeFieldRef: "mode", cursorFieldRef: "cursor", primaryKeyFieldRef: "pk", targets: ["sync"] },
};

describe("independent structure block batch 4", () => {
  it("keeps all structure families globally unique and explicit", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string }> };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(structured.length);
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH4_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(selected.every(block => block.rendererStatus === "real" && Boolean(block.structureDelta))).toBe(true);
    expect(new Set(selected.map(block => block.rendererKey)).size).toBe(6);
  });
  it("renders six real desktop and phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH4_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { surface: "plain" }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />), phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true); expect(desktop, type).not.toContain("尚未绑定"); expect(phone, type).not.toContain("尚未绑定"); expect(phone, type).toContain("data-testid=\"phone-");
    }
  });
  it("uses distinct non-table dependencies", () => {
    const signatures = Object.keys(INDEPENDENT_STRUCTURE_BATCH4_LABELS).map(type => { const usage = usageForBlock(type); expect(usage.desktop, type).not.toContain("Table"); expect(usage.phone, type).not.toContain("M.Table"); return usage.all.slice().sort().join("|"); });
    expect(new Set(signatures).size).toBe(6);
  });
  it("enforces each new state boundary", () => {
    expect(flameWidthPercent(25, 100)).toBe(25); expect(mergeResolved(["a", "b"], { a: "ours" })).toBe(false); expect(mergeResolved(["a", "b"], { a: "ours", b: "theirs" })).toBe(true); expect(policyDecision(["allow", "deny"])).toBe("deny"); expect(nextRotation(270)).toBe(0); expect(streamConfigurationValid("incremental", "")).toBe(false); expect(streamConfigurationValid("full_refresh", "")).toBe(true);
  });
});
