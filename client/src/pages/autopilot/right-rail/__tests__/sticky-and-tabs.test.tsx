/**
 * Unit 测试 —— Task 6：Sticky_Toggle UI + sr-announcer + tab aria-current
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 2.4、2.5（Sticky_Toggle 可见性与 aria-pressed）
 * - Requirement 8.1、8.2、8.4（tab aria-current="location" / sticky aria-pressed / sr-announcer）
 * - Requirement 9.1（sticky-toggle / sr-announcer / sub-stage-tab testid）
 *
 * 采用 Spec 3 `fabric-dispatch.property.test.tsx` 的 `renderToStaticMarkup` 断言风格，
 * 不依赖 `@testing-library/react` / jsdom。所有断言以 markup 字符串 / 正则匹配完成。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";

import { AutopilotRightRail } from "../AutopilotRightRail";
import {
  NULL_CONTEXT_FALLBACK,
  RightRailSubStageContext,
  type RightRailSubStageContextValue,
} from "../hooks/use-right-rail-sub-stage-state";
import { RAIL_SUB_STAGE_ORDER } from "../types";

/** 构造一个 fabric 阶段最小 job（stage='spec_tree' → activeSubStage='spec_tree'）。 */
function makeFabricJob(
  stage: BlueprintGenerationJob["stage"] = "spec_tree",
): BlueprintGenerationJob {
  return { id: "job-1", stage } as unknown as BlueprintGenerationJob;
}

/** 构造默认 props；子测试可覆盖部分字段。 */
function renderRail(overrides: {
  currentSubStage?: (typeof RAIL_SUB_STAGE_ORDER)[number];
  locale?: "zh-CN" | "en-US";
  context?: RightRailSubStageContextValue;
  selection?: BlueprintRouteSelection | null;
  specTree?: BlueprintSpecTree | null;
  agentCrew?: BlueprintAgentCrewSnapshot | null;
  onSubStageChange?: (next: (typeof RAIL_SUB_STAGE_ORDER)[number]) => void;
} = {}): string {
  const rail = (
    <AutopilotRightRail
      jobId="job-1"
      currentStage="fabric"
      currentSubStage={overrides.currentSubStage ?? "spec_tree"}
      job={makeFabricJob()}
      routeSet={null}
      selection={overrides.selection ?? null}
      specTree={overrides.specTree ?? null}
      agentCrew={overrides.agentCrew ?? null}
      capabilities={[]}
      capabilityInvocations={[]}
      capabilityEvidence={[]}
      effectPreviews={[]}
      locale={overrides.locale ?? "zh-CN"}
      onSubStageChange={overrides.onSubStageChange ?? (() => {})}
    />
  );
  if (overrides.context) {
    return renderToStaticMarkup(
      <RightRailSubStageContext.Provider value={overrides.context}>
        {rail}
      </RightRailSubStageContext.Provider>,
    );
  }
  return renderToStaticMarkup(rail);
}

describe("AutopilotRightRail Task 6 — sticky toggle + tabs + sr-announcer", () => {
  it("renders 8 sub-stage tabs with canonical testids", () => {
    const markup = renderRail();
    for (const sub of RAIL_SUB_STAGE_ORDER) {
      expect(markup).toContain(
        `data-testid="autopilot-right-rail-sub-stage-tab-${sub}"`,
      );
    }
  });

  it("marks the active tab with aria-current='location'", () => {
    const markup = renderRail({ currentSubStage: "runtime_capability" });
    expect(markup).toMatch(
      /data-testid="autopilot-right-rail-sub-stage-tab-runtime_capability"[^>]*aria-current="location"/,
    );
    // 非激活 tab 不应带 aria-current="location"
    expect(markup).not.toMatch(
      /data-testid="autopilot-right-rail-sub-stage-tab-spec_tree"[^>]*aria-current="location"/,
    );
  });

  it("renders the Sticky_Toggle with testid", () => {
    const markup = renderRail();
    expect(markup).toContain(
      'data-testid="autopilot-right-rail-sticky-toggle"',
    );
  });

  it("sticky toggle reflects aria-pressed=false when NULL_CONTEXT_FALLBACK (isPinned=false)", () => {
    const markup = renderRail({ context: NULL_CONTEXT_FALLBACK });
    expect(markup).toMatch(
      /data-testid="autopilot-right-rail-sticky-toggle"[^>]*aria-pressed="false"/,
    );
  });

  it("sticky toggle reflects aria-pressed=true when context.isPinned=true", () => {
    const pinnedCtx: RightRailSubStageContextValue = {
      ...NULL_CONTEXT_FALLBACK,
      isPinned: true,
      pinnedSubStage: "spec_tree",
      effectiveSubStage: "spec_tree",
    };
    const markup = renderRail({ context: pinnedCtx });
    expect(markup).toMatch(
      /data-testid="autopilot-right-rail-sticky-toggle"[^>]*aria-pressed="true"/,
    );
  });

  it("sticky toggle uses pinned-long label when pinned (zh-CN)", () => {
    const pinnedCtx: RightRailSubStageContextValue = {
      ...NULL_CONTEXT_FALLBACK,
      isPinned: true,
      pinnedSubStage: "spec_tree",
      effectiveSubStage: "spec_tree",
    };
    const markup = renderRail({ context: pinnedCtx, locale: "zh-CN" });
    expect(markup).toContain(
      "当前已暂停跟随进度，点击以恢复跟随",
    );
  });

  it("sticky toggle uses following-long label when not pinned (en-US)", () => {
    const markup = renderRail({ locale: "en-US" });
    expect(markup).toContain("Following progress; click to pin current sub-stage");
  });

  it("renders sr-announcer with aria-live='polite' and sr-only class", () => {
    const markup = renderRail();
    expect(markup).toMatch(
      /data-testid="autopilot-right-rail-sr-announcer"[^>]*aria-live="polite"/,
    );
    expect(markup).toMatch(
      /data-testid="autopilot-right-rail-sr-announcer"[^>]*class="sr-only"/,
    );
  });

  it("does NOT render sticky toggle or sub-stage tabs in non-fabric stage", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        jobId=""
        currentStage="input"
        job={null}
        routeSet={null}
        selection={null}
        specTree={null}
        agentCrew={null}
        capabilities={[]}
        capabilityInvocations={[]}
        capabilityEvidence={[]}
        effectPreviews={[]}
        locale="zh-CN"
        onSubStageChange={() => {}}
      />,
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-right-rail-sticky-toggle"',
    );
    for (const sub of RAIL_SUB_STAGE_ORDER) {
      expect(markup).not.toContain(
        `data-testid="autopilot-right-rail-sub-stage-tab-${sub}"`,
      );
    }
    // sr-announcer 始终渲染（其他 stage 下 effect 会把内容清空），root-level 存在
    expect(markup).toContain(
      'data-testid="autopilot-right-rail-sr-announcer"',
    );
  });

  it("tab labels follow locale (zh-CN vs en-US)", () => {
    const zh = renderRail({ locale: "zh-CN" });
    const en = renderRail({ locale: "en-US" });
    expect(zh).toContain("Spec 树");
    expect(en).toContain("Spec tree");
    expect(zh).toContain("智能体矩阵");
    expect(en).toContain("Agent crew");
  });
});
