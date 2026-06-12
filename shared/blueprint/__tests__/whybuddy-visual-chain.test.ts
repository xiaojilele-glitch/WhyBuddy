import { describe, it, expect } from "vitest";
import {
  auditPreviewReal,
  renderSpecTreeToMermaid,
  isVisualIntent,
} from "../whybuddy-visual-chain.js";

describe("whybuddy-visual-chain (S18)", () => {
  it("auditPreviewReal rejects placeholder copy", () => {
    const bad = auditPreviewReal("placeholder copy\nplaceholder copy\nlorem ipsum");
    expect(bad.passed).toBe(false);
    expect(bad.fakeSignals.length).toBeGreaterThan(0);
  });

  it("auditPreviewReal passes labeled preview", () => {
    const ok = auditPreviewReal("【预览·未验证】\n模块 A 列表页\n模块 B 配置页");
    expect(ok.passed).toBe(true);
  });

  it("renderSpecTreeToMermaid is deterministic", () => {
    const tree = "【SPEC Tree】\n[root] 权限系统: 根\n[requirement] 核心: REQ";
    const a = renderSpecTreeToMermaid(tree);
    const b = renderSpecTreeToMermaid(tree);
    expect(a).toBe(b);
    expect(a).toContain("graph TD");
  });

  it("isVisualIntent matches Chinese visual keywords", () => {
    expect(isVisualIntent("出个视觉效果图")).toBe(true);
    expect(isVisualIntent("分析风险")).toBe(false);
  });
});