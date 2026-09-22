import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import {
  INDEPENDENT_STRUCTURE_BATCH7_LABELS,
  ocrCorrectionValid,
  planCanAnalyze,
  profileHasSignal,
  provenanceCanApprove,
  rotationWindowValid,
  webhookSampleValid,
} from "../independent-structure-blocks-batch7";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = { demo: [
  { id: "root", createdAt: "2026-08-11", values: { text: "WB-2048", confidence: 96, x: 18, y: 28, width: 42, height: 9, name: "Projection", parent: "", cost: 120, count: 18420, duration: 142, type: "string", nullRatio: 2, uniqueRatio: 80, min: "0", max: "9", status: "active", from: "2026-08-01", until: "2026-09-10", fingerprint: "SHA256:AA", path: "order.id", sample: "WB-2048", required: "true", kind: "制品摘要", digest: "sha256:abc", issuer: "CI", subject: "app.tar", verify: "verified" } },
  { id: "child", createdAt: "2026-08-11", values: { text: "688", confidence: 78, x: 22, y: 48, width: 30, height: 8, name: "Hash Join", parent: "root", cost: 80, count: 420, duration: 68, type: "number", nullRatio: 0, uniqueRatio: 62, min: "1", max: "999", status: "pending", from: "2026-08-20", until: "2027-08-20", fingerprint: "SHA256:BB", path: "order.amount", sample: "688", required: "true", kind: "签名", digest: "sha256:def", issuer: "Cosign", subject: "app.sig", verify: "trusted" } },
] };

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  OcrRegionCorrectionCanvas: { entityRef: "demo", recognizedTextFieldRef: "text", confidenceFieldRef: "confidence", boxXFieldRef: "x", boxYFieldRef: "y", boxWidthFieldRef: "width", boxHeightFieldRef: "height", targets: ["document"] },
  QueryExecutionPlanInspector: { entityRef: "demo", operatorNameFieldRef: "name", operatorParentFieldRef: "parent", estimatedCostFieldRef: "cost", actualRowsFieldRef: "count", durationFieldRef: "duration", targets: ["query"] },
  ColumnProfileWorkbench: { entityRef: "demo", columnNameFieldRef: "name", columnTypeFieldRef: "type", nullRatioFieldRef: "nullRatio", uniqueRatioFieldRef: "uniqueRatio", minValueFieldRef: "min", maxValueFieldRef: "max" },
  CertificateRotationPlanner: { entityRef: "demo", certificateNameFieldRef: "name", certificateStatusFieldRef: "status", validFromFieldRef: "from", validUntilFieldRef: "until", fingerprintFieldRef: "fingerprint", targets: ["certificate"] },
  WebhookPayloadSchemaExplorer: { entityRef: "demo", fieldPathFieldRef: "path", fieldTypeFieldRef: "type", sampleValueFieldRef: "sample", requiredFieldRef: "required", targets: ["workflow"] },
  ArtifactProvenanceVerifier: { entityRef: "demo", subjectFieldRef: "subject", evidenceKindFieldRef: "kind", verificationStatusFieldRef: "verify", digestFieldRef: "digest", issuerFieldRef: "issuer", targets: ["release"] },
};

describe("independent structure block batch 7", () => {
  it("keeps structure families globally unique and explicit", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string }> };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH7_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(structured.length);
    expect(selected.every(block => block.rendererStatus === "real" && Boolean(block.structureDelta))).toBe(true);
    expect(new Set(selected.map(block => block.rendererKey)).size).toBe(6);
  });

  it("renders six desktop and six dedicated phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH7_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { surface: "plain", samplePayload: '{"order":{"id":"WB-2048"}}' }, binding: bindings[type] };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows} />);
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      expect(desktop, type).not.toContain("尚未绑定");
      expect(phone, type).not.toContain("尚未绑定");
      expect(phone, type).toContain('data-testid="phone-');
    }
  });

  it("uses six distinct non-table component signatures", () => {
    const desktop = new Set<string>(), phone = new Set<string>();
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH7_LABELS)) {
      const usage = usageForBlock(type);
      expect(usage.desktop, type).not.toContain("Table");
      expect(usage.phone, type).not.toContain("M.Table");
      desktop.add(usage.desktop.slice().sort().join("|"));
      phone.add(usage.phone.slice().sort().join("|"));
    }
    expect(desktop.size).toBe(6);
    expect(phone.size).toBe(6);
  });

  it("enforces correction, analysis, rotation, payload, and release gates", () => {
    expect(ocrCorrectionValid("", 90)).toBe(false);
    expect(ocrCorrectionValid("已校正", 76)).toBe(true);
    expect(planCanAnalyze([12, Number.NaN])).toBe(false);
    expect(profileHasSignal(5, 82)).toBe(true);
    expect(profileHasSignal(120, 82)).toBe(false);
    expect(rotationWindowValid(Date.parse("2026-09-10"), Date.parse("2026-08-20"))).toBe(true);
    expect(rotationWindowValid(Date.parse("2026-08-10"), Date.parse("2026-08-20"))).toBe(false);
    expect(webhookSampleValid("{bad json")).toBe(false);
    expect(webhookSampleValid('{"ok":true}')).toBe(true);
    expect(provenanceCanApprove(["verified", "trusted", "passed"])).toBe(true);
    expect(provenanceCanApprove(["verified", "failed"])).toBe(false);
  });
});
