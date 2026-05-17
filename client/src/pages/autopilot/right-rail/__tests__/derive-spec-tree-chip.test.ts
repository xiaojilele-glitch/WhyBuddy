/**
 * autopilot-spec-tree-workbench / Wave 0 Task 1
 *
 * deriveSpecTreeChip 纯函数单测。
 *
 * 覆盖范围：
 * 1. 5 档 tone 优先级（neutral → info → warning → success → danger）
 * 2. source 严重级（template > fallback > llm）
 * 3. ephemeral "generating" 在 docs 不全时优先；docs 已全时被忽略
 * 4. 1 / 2 / 3 份文档情形下的 X/3 reviewing label
 * 5. 任一份 rejected 触发 danger tone
 * 6. fallback / template source 把 reviewing 的 tone 升级为 warning
 *
 * 测试策略：纯节点环境，不依赖 React，因此可以直接 import 与跑断言。
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

import { deriveSpecTreeChip } from "../derive-spec-tree-chip";

// ─── 工厂函数 ─────────────────────────────────────────────────────────────

function makeDoc(
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocumentStatus = "draft",
  generationSource:
    | BlueprintSpecDocument["provenance"]["generationSource"]
    | undefined = "llm"
): BlueprintSpecDocument {
  return {
    id: `doc-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-1",
    type,
    status,
    title: `${type} title`,
    summary: `${type} summary`,
    content: "",
    format: "markdown",
    createdAt: "2026-05-16T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "module",
      nodeTitle: "node-1",
      nodeSummary: "summary",
      dependencies: [],
      outputs: [],
      generationSource,
    },
  } as BlueprintSpecDocument;
}

// ─── 用例 ─────────────────────────────────────────────────────────────────

describe("deriveSpecTreeChip", () => {
  // ── tone 优先级 ───────────────────────────────────────────────────────

  it("空 docs + 无 ephemeral → neutral '未生成'", () => {
    const chip = deriveSpecTreeChip([]);
    expect(chip.label).toBe("未生成");
    expect(chip.tone).toBe("neutral");
    expect(chip.sourceTag).toBeUndefined();
    expect(chip.detail).toEqual({});
  });

  it("空 docs + ephemeral generating → info '生成中'", () => {
    const chip = deriveSpecTreeChip([], "generating");
    expect(chip.label).toBe("生成中");
    expect(chip.tone).toBe("info");
    expect(chip.ephemeralProgress).toBe("generating");
  });

  it("1 份 docs + ephemeral generating → info '1/3 生成中'", () => {
    const chip = deriveSpecTreeChip(
      [makeDoc("requirements", "reviewing", "llm")],
      "generating"
    );
    expect(chip.label).toBe("1/3 生成中");
    expect(chip.tone).toBe("info");
    expect(chip.ephemeralProgress).toBe("generating");
  });

  it("3 份 accepted docs + ephemeral generating → ephemeral 被忽略,success", () => {
    const chip = deriveSpecTreeChip(
      [
        makeDoc("requirements", "accepted", "llm"),
        makeDoc("design", "accepted", "llm"),
        makeDoc("tasks", "accepted", "llm"),
      ],
      "generating"
    );
    expect(chip.label).toBe("3/3 accepted");
    expect(chip.tone).toBe("success");
    expect(chip.sourceTag).toBe("llm");
    // ephemeral 不应出现，因为 docs 已全
    expect(chip.ephemeralProgress).toBeUndefined();
  });

  it("任一份 rejected → danger 'X/3 rejected'", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "accepted", "llm"),
      makeDoc("design", "rejected", "llm"),
      makeDoc("tasks", "draft", "llm"),
    ]);
    expect(chip.label).toBe("3/3 rejected");
    expect(chip.tone).toBe("danger");
  });

  it("3 份均 accepted → success '3/3 accepted'", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "accepted", "llm"),
      makeDoc("design", "accepted", "llm"),
      makeDoc("tasks", "accepted", "llm"),
    ]);
    expect(chip.label).toBe("3/3 accepted");
    expect(chip.tone).toBe("success");
    expect(chip.sourceTag).toBe("llm");
  });

  it("1 份 draft → info '1/3 reviewing'", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "draft", "llm"),
    ]);
    expect(chip.label).toBe("1/3 reviewing");
    expect(chip.tone).toBe("info");
    expect(chip.sourceTag).toBe("llm");
  });

  it("2 份 reviewing → info '2/3 reviewing'", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", "llm"),
      makeDoc("design", "reviewing", "llm"),
    ]);
    expect(chip.label).toBe("2/3 reviewing");
    expect(chip.tone).toBe("info");
  });

  it("3 份混合 reviewing/accepted → info '3/3 reviewing'", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "accepted", "llm"),
      makeDoc("design", "reviewing", "llm"),
      makeDoc("tasks", "draft", "llm"),
    ]);
    expect(chip.label).toBe("3/3 reviewing");
    expect(chip.tone).toBe("info");
  });

  // ── source 严重级 ──────────────────────────────────────────────────────

  it("混合 llm + fallback → sourceTag 取 fallback,tone 升级为 warning", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", "llm"),
      makeDoc("design", "reviewing", "llm_fallback"),
    ]);
    expect(chip.sourceTag).toBe("fallback");
    expect(chip.tone).toBe("warning");
    expect(chip.label).toBe("2/3 reviewing");
  });

  it("混合 llm + template → sourceTag 取 template,tone warning", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", "llm"),
      makeDoc("design", "reviewing", "template"),
    ]);
    expect(chip.sourceTag).toBe("template");
    expect(chip.tone).toBe("warning");
  });

  it("混合 fallback + template → sourceTag 取 template", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", "llm_fallback"),
      makeDoc("design", "reviewing", "template"),
    ]);
    expect(chip.sourceTag).toBe("template");
    expect(chip.tone).toBe("warning");
  });

  it("3 份均 accepted + 含 template → success 但 sourceTag template", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "accepted", "llm"),
      makeDoc("design", "accepted", "template"),
      makeDoc("tasks", "accepted", "llm"),
    ]);
    expect(chip.label).toBe("3/3 accepted");
    expect(chip.tone).toBe("success");
    expect(chip.sourceTag).toBe("template");
  });

  // ── ephemeral fallback 信号 ────────────────────────────────────────────

  it("1 份 reviewing(llm) + ephemeral fallback → tone 升级 warning", () => {
    const chip = deriveSpecTreeChip(
      [makeDoc("requirements", "reviewing", "llm")],
      "fallback"
    );
    expect(chip.tone).toBe("warning");
    expect(chip.ephemeralProgress).toBe("fallback");
  });

  // ── detail 结构 ────────────────────────────────────────────────────────

  it("detail 中包含每份现存 doc 的 status + source", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", "llm"),
      makeDoc("design", "accepted", "template"),
    ]);
    expect(chip.detail.requirements).toEqual({
      status: "reviewing",
      source: "llm",
    });
    expect(chip.detail.design).toEqual({
      status: "accepted",
      source: "template",
    });
    // tasks 不存在
    expect(chip.detail.tasks).toBeUndefined();
  });

  it("undefined generationSource 折算为 llm", () => {
    const chip = deriveSpecTreeChip([
      makeDoc("requirements", "reviewing", undefined),
    ]);
    expect(chip.detail.requirements?.source).toBe("llm");
    expect(chip.sourceTag).toBe("llm");
  });
});
