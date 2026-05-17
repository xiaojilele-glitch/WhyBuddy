/**
 * autopilot-spec-tree-workbench / Wave 0 Task 2
 *
 * parseSpecDocsObservingEntries 单测。
 *
 * 覆盖范围：
 * - 成功 / 降级两种文案模板
 * - title 含特殊字符（em dash / emoji / 引号 / 反斜杠）
 * - stageId !== "spec_docs" 的事件被跳过
 * - phase !== "observing" 的事件被跳过
 * - observationSummary 缺失或非字符串被跳过
 * - 同名节点多次 observing 时,最后一条覆盖
 */

import { describe, expect, it } from "vitest";

import type {
  AgentReasoningEntry,
  AgentReasoningPhase,
} from "@shared/blueprint/agent-reasoning";

import {
  __testing__,
  parseSpecDocsObservingEntries,
} from "../parse-spec-docs-observing";

const { parseSummary } = __testing__;

// ─── 工厂 ─────────────────────────────────────────────────────────────────

function makeEntry(partial: {
  id?: string;
  stageId?: string;
  phase?: AgentReasoningPhase;
  observationSummary?: string;
  observationSuccess?: boolean;
}): AgentReasoningEntry {
  return {
    id: partial.id ?? "evt-1",
    jobId: "job-1",
    iteration: 1,
    iterationLabel: "#1",
    phase: partial.phase ?? "observing",
    timestamp: "2026-05-16T07:00:00.000Z",
    observationSummary: partial.observationSummary,
    observationSuccess: partial.observationSuccess,
    stageId: partial.stageId ?? "spec_docs",
  };
}

// ─── parseSummary 单测 ────────────────────────────────────────────────────

describe("parseSummary", () => {
  it("成功文案 → generating", () => {
    expect(parseSummary("✓ Auth Module — 规格文档已生成")).toEqual({
      title: "Auth Module",
      kind: "generating",
    });
  });

  it("降级文案 → fallback", () => {
    expect(parseSummary("⚠ Auth Module — 降级为模板")).toEqual({
      title: "Auth Module",
      kind: "fallback",
    });
  });

  it("title 含 em dash 正确提取", () => {
    // 真实 title 含 em dash：`Auth — Sub` —— 我们的 endsWith 切片策略支持这种
    expect(parseSummary("✓ Auth — Sub — 规格文档已生成")).toEqual({
      title: "Auth — Sub",
      kind: "generating",
    });
  });

  it("title 含 emoji 正确提取", () => {
    expect(parseSummary("✓ 🚀 Launcher Module — 规格文档已生成")).toEqual({
      title: "🚀 Launcher Module",
      kind: "generating",
    });
  });

  it("title 含引号 / 反斜杠正确提取", () => {
    expect(
      parseSummary('✓ "edge\\case" Module — 规格文档已生成')
    ).toEqual({
      title: '"edge\\case" Module',
      kind: "generating",
    });
  });

  it("title 含中文标点正确提取", () => {
    expect(parseSummary("⚠ 用户认证（OAuth） — 降级为模板")).toEqual({
      title: "用户认证（OAuth）",
      kind: "fallback",
    });
  });

  it("空 title 返回 null", () => {
    expect(parseSummary("✓  — 规格文档已生成")).toBeNull();
  });

  it("无前缀返回 null", () => {
    expect(parseSummary("Auth Module — 规格文档已生成")).toBeNull();
  });

  it("无后缀返回 null", () => {
    expect(parseSummary("✓ Auth Module")).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(parseSummary("")).toBeNull();
  });
});

// ─── parseSpecDocsObservingEntries 用例 ──────────────────────────────────

describe("parseSpecDocsObservingEntries", () => {
  it("空数组返回空 map", () => {
    const snapshot = parseSpecDocsObservingEntries([]);
    expect(snapshot.byNodeTitle.size).toBe(0);
  });

  it("非数组返回空 map", () => {
    // 防御性兜底，避免 store mock 提供 undefined 时崩溃
    const snapshot = parseSpecDocsObservingEntries(
      undefined as unknown as ReadonlyArray<AgentReasoningEntry>
    );
    expect(snapshot.byNodeTitle.size).toBe(0);
  });

  it("混合 stage 仅保留 stageId === 'spec_docs' 的 observing 条目", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({
        id: "1",
        stageId: "clarification",
        observationSummary: "✓ A — 规格文档已生成",
      }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        observationSummary: "✓ B — 规格文档已生成",
      }),
      makeEntry({
        id: "3",
        stageId: "intake_created",
        observationSummary: "✓ C — 规格文档已生成",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(1);
    expect(snapshot.byNodeTitle.get("B")).toBe("generating");
    expect(snapshot.byNodeTitle.get("A")).toBeUndefined();
    expect(snapshot.byNodeTitle.get("C")).toBeUndefined();
  });

  it("phase !== 'observing' 的条目被跳过", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({
        id: "1",
        stageId: "spec_docs",
        phase: "thinking",
        observationSummary: "✓ A — 规格文档已生成",
      }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        phase: "acting",
        observationSummary: "✓ B — 规格文档已生成",
      }),
      makeEntry({
        id: "3",
        stageId: "spec_docs",
        phase: "observing",
        observationSummary: "✓ C — 规格文档已生成",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(1);
    expect(snapshot.byNodeTitle.get("C")).toBe("generating");
  });

  it("observationSummary 缺失或非字符串被跳过", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({ id: "1", stageId: "spec_docs", observationSummary: undefined }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        observationSummary: "",
      }),
      makeEntry({
        id: "3",
        stageId: "spec_docs",
        observationSummary: "✓ Real — 规格文档已生成",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(1);
    expect(snapshot.byNodeTitle.get("Real")).toBe("generating");
  });

  it("同名节点多次 observing,最后一条覆盖", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({
        id: "1",
        stageId: "spec_docs",
        observationSummary: "✓ Auth — 规格文档已生成",
      }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        observationSummary: "⚠ Auth — 降级为模板",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(1);
    expect(snapshot.byNodeTitle.get("Auth")).toBe("fallback");
  });

  it("多节点并行 observing 全部保留", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({
        id: "1",
        stageId: "spec_docs",
        observationSummary: "✓ A — 规格文档已生成",
      }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        observationSummary: "✓ B — 规格文档已生成",
      }),
      makeEntry({
        id: "3",
        stageId: "spec_docs",
        observationSummary: "⚠ C — 降级为模板",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(3);
    expect(snapshot.byNodeTitle.get("A")).toBe("generating");
    expect(snapshot.byNodeTitle.get("B")).toBe("generating");
    expect(snapshot.byNodeTitle.get("C")).toBe("fallback");
  });

  it("无法识别的 summary 被静默跳过", () => {
    const snapshot = parseSpecDocsObservingEntries([
      makeEntry({
        id: "1",
        stageId: "spec_docs",
        observationSummary: "Some unrelated message",
      }),
      makeEntry({
        id: "2",
        stageId: "spec_docs",
        observationSummary: "✓ Real — 规格文档已生成",
      }),
    ]);
    expect(snapshot.byNodeTitle.size).toBe(1);
    expect(snapshot.byNodeTitle.get("Real")).toBe("generating");
  });
});
