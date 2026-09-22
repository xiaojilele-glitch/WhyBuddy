import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import {
  cvssBaseComplete, faceCandidateCanAssign, INDEPENDENT_STRUCTURE_BATCH8_LABELS,
  inventoryLocationCanRemove, patternCoverageValid, reconciliationCanConfirm, variantDraftValid,
} from "../independent-structure-blocks-batch8";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = { demo: [
  { id: "statement", createdAt: "2026-08-11", values: { kind: "statement", title: "银行入账", amount: 300, date: "2026-08-11", score: 100, code: "AV", label: "攻击向量", group: "Base", metric: "N", pattern: "request <*> failed", count: 20, coverage: 60, sample: "request 42 failed", attribute: "颜色", option: "红", sku: "SKU-RED", price: 199, enabled: "true", location: "华东仓", stocked: 100, reserved: 10, incoming: 20, person: "林女士", image: "/brand/logo.png", similarity: 96, current: "unknown", hidden: "false" } },
  { id: "voucher", createdAt: "2026-08-11", values: { kind: "voucher", title: "销售凭证", amount: 300, date: "2026-08-11", score: 96, code: "AC", label: "攻击复杂度", group: "Base", metric: "L", pattern: "retry <*> times", count: 12, coverage: 40, sample: "retry 3 times", attribute: "尺码", option: "M", sku: "SKU-M", price: 209, enabled: "true", location: "华南仓", stocked: 80, reserved: 0, incoming: 0, person: "陈晓雨", image: "/brand/logo.png", similarity: 90, current: "unknown", hidden: "false" } },
  { id: "metric-pr", createdAt: "2026-08-11", values: { kind: "voucher", title: "凭证 2", amount: 0, date: "2026-08-11", score: 80, code: "PR", label: "所需权限", group: "Base", metric: "N", attribute: "颜色", option: "蓝", sku: "SKU-BLU", price: 219, enabled: "true", person: "王若溪", image: "/brand/logo.png", similarity: 82, current: "unknown", hidden: "false" } },
  { id: "metric-ui", createdAt: "2026-08-11", values: { kind: "voucher", title: "凭证 3", amount: 0, date: "2026-08-11", score: 70, code: "UI", label: "用户交互", group: "Base", metric: "R", attribute: "尺码", option: "L", sku: "SKU-L", price: 229, enabled: "true", person: "周宁", image: "/brand/logo.png", similarity: 76, current: "unknown", hidden: "false" } },
] };

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  BankTransactionReconciliationMatcher: { entityRef: "demo", recordKindFieldRef: "kind", recordTitleFieldRef: "title", amountFieldRef: "amount", dateFieldRef: "date", matchScoreFieldRef: "score", targets: ["bank"] },
  CvssVectorCalculator: { entityRef: "demo", metricCodeFieldRef: "code", metricLabelFieldRef: "label", metricGroupFieldRef: "group", metricValueFieldRef: "metric", targets: ["finding"] },
  LogPatternClusterExplorer: { entityRef: "demo", patternFieldRef: "pattern", patternCountFieldRef: "count", coverageFieldRef: "coverage", sampleLogFieldRef: "sample" },
  ProductVariantMatrixBuilder: { entityRef: "demo", attributeGroupFieldRef: "attribute", attributeValueFieldRef: "option", skuFieldRef: "sku", priceFieldRef: "price", enabledFieldRef: "enabled", targets: ["product"] },
  InventoryLocationLevelTuner: { entityRef: "demo", locationNameFieldRef: "location", stockedFieldRef: "stocked", reservedFieldRef: "reserved", incomingFieldRef: "incoming", enabledFieldRef: "enabled", targets: ["inventory"] },
  FaceIdentityAssignmentPanel: { entityRef: "demo", personNameFieldRef: "person", faceImageFieldRef: "image", similarityFieldRef: "similarity", currentPersonFieldRef: "current", hiddenFieldRef: "hidden", targets: ["face"] },
};

describe("independent structure block batch 8", () => {
  it("keeps structure families globally unique and explicit", () => {
    const catalog = catalogJson as { blocks: Array<{ type: string; structureFamily?: string; structureDelta?: string; rendererKey: string; rendererStatus: string }> };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH8_LABELS).map(type => catalog.blocks.find(block => block.type === type)!);
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(structured.length);
    expect(selected.every(block => block.rendererStatus === "real" && Boolean(block.structureDelta))).toBe(true);
    expect(new Set(selected.map(block => block.rendererKey)).size).toBe(6);
  });

  it("renders six desktop and six dedicated phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH8_LABELS)) {
      const block: ExperienceBlockInstance = { id: type, type, props: { surface: "plain" }, binding: bindings[type] };
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
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH8_LABELS)) {
      const usage = usageForBlock(type);
      expect(usage.desktop, type).not.toContain("Table");
      expect(usage.phone, type).not.toContain("M.Table");
      desktop.add(usage.desktop.slice().sort().join("|"));
      phone.add(usage.phone.slice().sort().join("|"));
    }
    expect(desktop.size).toBe(6);
    expect(phone.size).toBe(6);
  });

  it("enforces the six source-derived state gates", () => {
    expect(reconciliationCanConfirm(300, 300)).toBe(true);
    expect(reconciliationCanConfirm(299, 300)).toBe(false);
    expect(cvssBaseComplete(["N", "L", "N", "R"])).toBe(true);
    expect(cvssBaseComplete(["N", "L", ""])).toBe(false);
    expect(patternCoverageValid(100)).toBe(true);
    expect(patternCoverageValid(120)).toBe(false);
    expect(variantDraftValid(["A", "B"])).toBe(true);
    expect(variantDraftValid(["A", "A"])).toBe(false);
    expect(inventoryLocationCanRemove(0, 0)).toBe(true);
    expect(inventoryLocationCanRemove(1, 0)).toBe(false);
    expect(faceCandidateCanAssign("person-a", "person-b")).toBe(true);
    expect(faceCandidateCanAssign("person-a", "person-a")).toBe(false);
  });
});
