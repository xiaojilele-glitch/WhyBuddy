/**
 * autopilot-mirofish-stream / Wave 0 — 6 类卡片 SSR 测试
 *
 * 用 renderToStaticMarkup + 字符串断言（与本仓既有 right-rail 子组件测试一致,
 * 不引入 @testing-library/react）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ArtifactCreatedCard,
  CapabilityInvocationCard,
  formatTimestampHHMMSS,
  NodeCompletedCard,
  ReasoningCard,
  RouteDecisionCard,
  SystemNoteCard,
} from "../cards";

const BASE_TS = "2026-05-17T13:42:05.000Z";

// ─── formatTimestampHHMMSS ─────────────────────────────────────────────

describe("formatTimestampHHMMSS", () => {
  it("合法 ISO timestamp 折算为 HH:MM:SS", () => {
    // 注意：会按本地时区算,所以只断言长度 + 分隔符
    const result = formatTimestampHHMMSS(BASE_TS);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("非法 timestamp 返回 --:--:--", () => {
    expect(formatTimestampHHMMSS("not-a-date")).toBe("--:--:--");
    expect(formatTimestampHHMMSS("")).toBe("--:--:--");
  });
});

// ─── ReasoningCard ─────────────────────────────────────────────────────

describe("ReasoningCard", () => {
  it("thinking phase 渲染 thought + info tone", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-1",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "info",
          phase: "thinking",
          iterationLabel: "#1",
          thought: "正在分析路线节点结构",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-tone="info"');
    expect(markup).toContain('data-phase="thinking"');
    expect(markup).toContain("thinking · #1");
    expect(markup).toContain("正在分析路线节点结构");
  });

  it("acting phase 渲染 → toolId", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-2",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "info",
          phase: "acting",
          iterationLabel: "#1",
          actionToolId: "llm.spec_tree_derivation",
        }}
      />
    );
    expect(markup).toContain('data-phase="acting"');
    expect(markup).toContain("→ llm.spec_tree_derivation");
  });

  it("observing(success=true) 渲染 ✓ + success tone", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-3",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "success",
          phase: "observing",
          iterationLabel: "#1",
          observationSuccess: true,
          observationSummary: "SPEC 树派生完成：4 个节点",
        }}
      />
    );
    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain("✓ SPEC 树派生完成");
  });

  it("observing(success=false) 渲染 ✗ + warning tone", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-4",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "warning",
          phase: "observing",
          iterationLabel: "#1",
          observationSuccess: false,
          observationSummary: "SPEC 树 LLM 派生回退",
        }}
      />
    );
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain("✗ SPEC 树 LLM 派生回退");
  });

  it("error phase 渲染 error 文本 + danger tone", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-5",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "danger",
          phase: "error",
          iterationLabel: "#1",
          error: "LLM 调用失败",
        }}
      />
    );
    expect(markup).toContain('data-tone="danger"');
    expect(markup).toContain("LLM 调用失败");
  });

  // whybuddy-3d-real-role-driven-scene-2026-05-29 reasoning-detail 2026-05-31：
  // 一条同时携带 thought / action / observation 的 entry 应把三段都展开显示，
  // 而不是 fallback-pick-one 只显示 thought。
  it("一条 entry 同时带 thought + action + observation 时三段都展开", () => {
    const markup = renderToStaticMarkup(
      <ReasoningCard
        entry={{
          id: "evt-6",
          kind: "reasoning",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "success",
          phase: "observing",
          iterationLabel: "#2",
          thought: "需要先派生 SPEC 树再校验节点",
          actionToolId: "llm.spec_tree_derivation",
          observationSuccess: true,
          observationSummary: "SPEC 树派生完成：26 个节点",
          reason: "节点数量符合预期",
        }}
      />
    );
    // thought / action / observation / reason 同屏可见
    expect(markup).toContain("需要先派生 SPEC 树再校验节点");
    expect(markup).toContain("→ llm.spec_tree_derivation");
    expect(markup).toContain("✓ SPEC 树派生完成：26 个节点");
    expect(markup).toContain("节点数量符合预期");
    // 标签行附带 HH:MM:SS 时间
    expect(markup).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

// ─── NodeCompletedCard ─────────────────────────────────────────────────

describe("NodeCompletedCard", () => {
  it("全 llm source → success tone + ' · llm' 标记", () => {
    const markup = renderToStaticMarkup(
      <NodeCompletedCard
        entry={{
          id: "node-completed-n-1",
          kind: "node_completed",
          stageId: "spec_docs",
          timestamp: BASE_TS,
          tone: "success",
          nodeId: "n-1",
          nodeTitle: "Auth Module",
          documentTypes: ["requirements", "design", "tasks"],
          generationSource: "llm",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-node-completed"');
    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain('data-node-id="n-1"');
    expect(markup).toContain("✓ Auth Module");
    expect(markup).toContain("requirements / design / tasks");
    expect(markup).toContain("· llm");
  });

  it("fallback source → warning tone", () => {
    const markup = renderToStaticMarkup(
      <NodeCompletedCard
        entry={{
          id: "node-completed-n-2",
          kind: "node_completed",
          stageId: "spec_docs",
          timestamp: BASE_TS,
          tone: "warning",
          nodeId: "n-2",
          nodeTitle: "Profile",
          documentTypes: ["requirements", "design", "tasks"],
          generationSource: "fallback",
        }}
      />
    );
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain('data-source="fallback"');
    expect(markup).toContain("· fallback");
  });

  it("undefined source 不显示 source 标签", () => {
    const markup = renderToStaticMarkup(
      <NodeCompletedCard
        entry={{
          id: "node-completed-n-3",
          kind: "node_completed",
          stageId: "spec_docs",
          timestamp: BASE_TS,
          tone: "success",
          nodeId: "n-3",
          nodeTitle: "Settings",
          documentTypes: ["requirements", "design", "tasks"],
        }}
      />
    );
    expect(markup).not.toContain("· llm");
    expect(markup).not.toContain("· fallback");
    expect(markup).not.toContain("· template");
  });
});

// ─── RouteDecisionCard ─────────────────────────────────────────────────

describe("RouteDecisionCard", () => {
  it("primary 路线 + 含 reason", () => {
    const markup = renderToStaticMarkup(
      <RouteDecisionCard
        entry={{
          id: "route-decision-sel-1",
          kind: "route_decision",
          stageId: "route_selection",
          timestamp: BASE_TS,
          tone: "info",
          routeId: "route-1",
          routeTitle: "Standard route",
          reason: "Most stable path",
          routeKind: "primary",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-route-decision"');
    expect(markup).toContain('data-route-kind="primary"');
    expect(markup).toContain("选择路线：Standard route");
    expect(markup).toContain("Most stable path");
    expect(markup).toContain("· primary");
  });

  it("alternative 路线", () => {
    const markup = renderToStaticMarkup(
      <RouteDecisionCard
        entry={{
          id: "route-decision-sel-2",
          kind: "route_decision",
          stageId: "route_selection",
          timestamp: BASE_TS,
          tone: "info",
          routeId: "route-2",
          routeTitle: "Quick route",
          routeKind: "alternative",
        }}
      />
    );
    expect(markup).toContain('data-route-kind="alternative"');
    expect(markup).toContain("· alternative");
  });
});

// ─── CapabilityInvocationCard ──────────────────────────────────────────

describe("CapabilityInvocationCard", () => {
  it("invoking 状态 → info tone", () => {
    const markup = renderToStaticMarkup(
      <CapabilityInvocationCard
        entry={{
          id: "capability-docker-analysis-sandbox-invoking",
          kind: "capability_invocation",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "info",
          capabilityId: "docker-analysis-sandbox",
          status: "invoking",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-capability"');
    expect(markup).toContain('data-tone="info"');
    expect(markup).toContain('data-capability-status="invoking"');
    expect(markup).toContain("docker-analysis-sandbox");
    expect(markup).toContain("capability · invoking");
  });

  it("failed 状态 → danger tone", () => {
    const markup = renderToStaticMarkup(
      <CapabilityInvocationCard
        entry={{
          id: "capability-mcp-github-source-failed",
          kind: "capability_invocation",
          stageId: "intake_created",
          timestamp: BASE_TS,
          tone: "danger",
          capabilityId: "mcp-github-source",
          status: "failed",
        }}
      />
    );
    expect(markup).toContain('data-tone="danger"');
    expect(markup).toContain("capability · failed");
  });
});

// ─── ArtifactCreatedCard ───────────────────────────────────────────────

describe("ArtifactCreatedCard", () => {
  it("spec_tree artifact (en-US 保持英文 title)", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCreatedCard
        locale="en-US"
        entry={{
          id: "artifact-1",
          kind: "artifact_created",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "neutral",
          artifactId: "artifact-1",
          artifactType: "spec_tree",
          title: "Derived SPEC tree",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).toContain('data-tone="neutral"');
    expect(markup).toContain('data-artifact-type="spec_tree"');
    expect(markup).toContain("Derived SPEC tree");
    expect(markup).toContain("artifact · spec_tree");
  });

  // 自动驾驶 3D 场景融合 follow-up i18n（2026-05-13）：
  // 默认 / zh-CN 时 artifact title 应通过 blueprintCopy 翻译表落到中文。
  it("spec_tree artifact (zh-CN 默认走 blueprintCopy 翻译)", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCreatedCard
        entry={{
          id: "artifact-zh",
          kind: "artifact_created",
          stageId: "spec_tree",
          timestamp: BASE_TS,
          tone: "neutral",
          artifactId: "artifact-zh",
          artifactType: "spec_tree",
          title: "Derived SPEC tree",
        }}
      />
    );
    expect(markup).toContain("已推导 SPEC 树");
    expect(markup).not.toContain("Derived SPEC tree");
  });

  it("requirements doc artifact", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCreatedCard
        entry={{
          id: "artifact-2",
          kind: "artifact_created",
          stageId: "spec_docs",
          timestamp: BASE_TS,
          tone: "neutral",
          artifactId: "artifact-2",
          artifactType: "requirements",
          title: "Auth req",
        }}
      />
    );
    expect(markup).toContain('data-artifact-type="requirements"');
    expect(markup).toContain("artifact · requirements");
    expect(markup).toContain("Auth req");
  });
});

// ─── SystemNoteCard ─────────────────────────────────────────────────────

describe("SystemNoteCard", () => {
  it("info tone 用 ℹ icon", () => {
    const markup = renderToStaticMarkup(
      <SystemNoteCard
        entry={{
          id: "sys-1",
          kind: "system_note",
          timestamp: BASE_TS,
          tone: "info",
          message: "等待路线生成",
        }}
      />
    );
    expect(markup).toContain('data-testid="mirofish-card-system-note"');
    expect(markup).toContain("等待路线生成");
    // ℹ icon
    expect(markup).toContain("ℹ");
  });

  it("warning tone 用 ⚠ icon + 显示 hint", () => {
    const markup = renderToStaticMarkup(
      <SystemNoteCard
        entry={{
          id: "sys-2",
          kind: "system_note",
          timestamp: BASE_TS,
          tone: "warning",
          message: "事件流出现间断",
          hint: "可能因网络波动重连",
        }}
      />
    );
    expect(markup).toContain('data-tone="warning"');
    expect(markup).toContain("⚠");
    expect(markup).toContain("事件流出现间断");
    expect(markup).toContain("可能因网络波动重连");
  });
});
