import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { INDEPENDENT_STRUCTURE_LABELS } from "../independent-structure-blocks";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = {
  demo: [
    { id: "one", createdAt: "2026-08-11T09:00:00.000Z", values: { name: "第一项", role: "owner", status: "complete", group: "核心组", severity: "critical", required: true, url: "/brand/logo.png", due: 1200, health: "healthy" } },
    { id: "two", createdAt: "2026-08-11T09:01:00.000Z", values: { name: "第二项", role: "reviewer", status: "failed", group: "核心组", severity: "warning", required: false, url: "/brand/miantuan-mark.png", due: 800, health: "degraded" } },
  ],
};
const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  SignatureFieldCanvas: { entityRef: "demo", nameFieldRef: "name", roleFieldRef: "role", statusFieldRef: "status", targets: ["document"] },
  AlertGroupAccordion: { entityRef: "demo", titleFieldRef: "name", groupFieldRef: "group", statusFieldRef: "status", severityFieldRef: "severity", targets: ["alerts"] },
  EvidenceCollectionWorkspace: { entityRef: "demo", titleFieldRef: "name", requiredFieldRef: "required", statusFieldRef: "status", targets: ["review"] },
  AssetReviewLightbox: { entityRef: "demo", nameFieldRef: "name", urlFieldRef: "url", typeFieldRef: "role" },
  PaymentAllocationWorkbench: { entityRef: "demo", titleFieldRef: "name", invoiceDueFieldRef: "due", targets: ["payment"] },
  DeploymentRolloutTrack: { entityRef: "demo", titleFieldRef: "name", statusFieldRef: "status", rolloutHealthFieldRef: "health", targets: ["deployment"] },
};

describe("independent structure block batch", () => {
  it("requires a unique structural family and an explicit delta for every block", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererStatus: string }> };
    const entries = Object.keys(INDEPENDENT_STRUCTURE_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(entries.every(entry => entry.rendererStatus === "real")).toBe(true);
    expect(entries.every(entry => Boolean(entry.structureDelta))).toBe(true);
    expect(new Set(entries.map(entry => entry.structureFamily)).size).toBe(entries.length);
  });

  it("registers dedicated desktop and phone rendering for all six types", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { title: INDEPENDENT_STRUCTURE_LABELS[type], surface: "plain" }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      expect(desktop, type).toContain(`data-testid="${BLOCK_DEFINITIONS[type].render === undefined ? "missing" : type.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}"`);
      expect(phone, type).toContain("data-testid=\"phone-");
      expect(desktop, type).not.toContain("尚未绑定");
      expect(phone, type).not.toContain("尚未绑定");
    }
  });

  it("does not use Table as the primary shortcut for any block", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_LABELS)) {
      expect(usageForBlock(type).desktop, type).not.toContain("Table");
      expect(usageForBlock(type).phone, type).not.toContain("M.Table");
    }
  });

  it("keeps the six renderer component signatures distinct", () => {
    const signatures = Object.keys(INDEPENDENT_STRUCTURE_LABELS).map(type => usageForBlock(type).all.slice().sort().join("|"));
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
