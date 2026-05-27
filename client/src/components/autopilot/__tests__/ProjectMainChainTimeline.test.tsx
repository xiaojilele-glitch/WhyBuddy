/**
 * Feature: autopilot-image-rendering-and-visual-system
 * Property 10: ProjectMainChainTimeline state-to-class mapping & step ordering
 *
 * 对应 spec：`.kiro/specs/autopilot-image-rendering-and-visual-system/`
 * - Requirements 14.1 / 14.2 / 14.3（6 步固定顺序；status -> class 唯一映射；
 *   `is-active` 至多一个）
 *
 * 测试策略（与本仓既有 client 组件测试保持一致）：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，引入这些
 *   工具属于跨规格的工具链改造（NFR：不扩张工具链）。`ProjectMainChainTimeline`
 *   是纯函数组件（无 state / 无 effect / 无 ref / 无 context），因此使用
 *   `react-dom/server` 的 `renderToStaticMarkup` 进行 SSR 字符串级断言即可
 *   完整覆盖 Property 10 的 3 个不变量；不需要 mount / cleanup。
 *
 * 三个属性：
 *   A. label ordering — 任意 length=6 的 `steps`（status 任意），渲染输出中 6 个
 *      步骤的 `data-step-key` 必须严格等于
 *      `["Project","Clarification","Spec","Route","Execution","Evidence"]`，
 *      且每个步骤的 label `<span data-role="step-label">…</span>` 文本与对应 key 一致。
 *   B. statusClass 唯一映射 — 5 个状态 (pending / running / completed / blocked / failed)
 *      映射到 5 个互不相同的 class 字符串。这是表驱动断言，无需 PBT 随机化，
 *      用 example test 一次性断言。
 *   C. 至多一个 `is-active` — 任意 `activeKey`（undefined、6 个有效 key 之一、或越界字符串），
 *      渲染输出中带 `is-active` class 的步骤数 ≤ 1。
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as fc from "fast-check";

import {
  MAIN_CHAIN_STATUS_CLASS,
  MAIN_CHAIN_STEP_ORDER,
  ProjectMainChainTimeline,
  type MainChainStep,
  type MainChainStepKey,
  type MainChainStepStatus,
} from "../ProjectMainChainTimeline";
import {
  visualTokens,
  type VisualTokenSet,
} from "../../../lib/autopilot/visual-tokens-placeholder";

/* ─── Helpers ─── */

const STEP_KEYS: readonly MainChainStepKey[] = [
  "Project",
  "Clarification",
  "Spec",
  "Route",
  "Execution",
  "Evidence",
];

const STATUSES: readonly MainChainStepStatus[] = [
  "pending",
  "running",
  "completed",
  "blocked",
  "failed",
];

const TOKENS: VisualTokenSet = visualTokens;

const stepKeyArb: fc.Arbitrary<MainChainStepKey> = fc.constantFrom<MainChainStepKey>(
  ...STEP_KEYS,
);

const statusArb: fc.Arbitrary<MainChainStepStatus> =
  fc.constantFrom<MainChainStepStatus>(...STATUSES);

const themeArb: fc.Arbitrary<"light" | "dark"> = fc.constantFrom("light", "dark");

/**
 * length-6 `steps` 数组：每个位置的 status 随机；6 个 key 严格按规范顺序。
 * 这与 Property A 的语义一致 — 我们不打算 PBT 化输入顺序（组件本就忽略输入顺序），
 * 而是 PBT 化 status 组合，确保任何 status 组合都不会影响 6 步标签序列。
 */
const stepsArb: fc.Arbitrary<readonly MainChainStep[]> = fc
  .tuple(statusArb, statusArb, statusArb, statusArb, statusArb, statusArb)
  .map(([s0, s1, s2, s3, s4, s5]) => [
    { key: STEP_KEYS[0], status: s0 } as const,
    { key: STEP_KEYS[1], status: s1 } as const,
    { key: STEP_KEYS[2], status: s2 } as const,
    { key: STEP_KEYS[3], status: s3 } as const,
    { key: STEP_KEYS[4], status: s4 } as const,
    { key: STEP_KEYS[5], status: s5 } as const,
  ]);

/**
 * 提取 markup 中所有 `data-step-key="X"` 的 X，按出现顺序返回。
 */
function extractStepKeyOrder(markup: string): string[] {
  const re = /data-step-key="([^"]+)"/g;
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

/**
 * 提取 markup 中所有步骤 label `<span data-role="step-label">X</span>` 的 X，按出现顺序返回。
 */
function extractStepLabelOrder(markup: string): string[] {
  const re = /<span data-role="step-label">([^<]+)<\/span>/g;
  const labels: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    labels.push(m[1]);
  }
  return labels;
}

/**
 * 数 markup 中 `<li …>` 节点 className 同时包含 `is-active` 的数量。
 *
 * 直接 `.match(/is-active/g)` 容易把 `data-active="true"` 也算进去，
 * 因此精确地用 `class="…is-active…"` 模式匹配 className 出现位置。
 */
function countIsActiveClass(markup: string): number {
  const re = /class="[^"]*\bis-active\b[^"]*"/g;
  const all = markup.match(re);
  return all == null ? 0 : all.length;
}

/* ─── Property A: 6 步标签序列恒等 ─── */

/**
 * **Validates: Requirements 14.1**
 *
 * 任意 status 组合（length=6）下，组件渲染必须输出 6 个步骤，且步骤的
 * `data-step-key` 与 label 顺序严格等于
 * `["Project","Clarification","Spec","Route","Execution","Evidence"]`。
 */
describe("ProjectMainChainTimeline · Property 10A — label ordering", () => {
  it("renders 6 steps in canonical order regardless of status combination", () => {
    fc.assert(
      fc.property(stepsArb, themeArb, (steps, theme) => {
        const markup = renderToStaticMarkup(
          <ProjectMainChainTimeline
            steps={steps}
            visualTokens={TOKENS}
            theme={theme}
          />,
        );

        const keys = extractStepKeyOrder(markup);
        const labels = extractStepLabelOrder(markup);

        // 严格等于规范 6 元组
        expect(keys).toEqual([...MAIN_CHAIN_STEP_ORDER]);
        expect(labels).toEqual([...MAIN_CHAIN_STEP_ORDER]);

        // 也覆盖 spec 中的字面值，确保未来若改动 MAIN_CHAIN_STEP_ORDER 也会被捕获
        expect(keys).toEqual([
          "Project",
          "Clarification",
          "Spec",
          "Route",
          "Execution",
          "Evidence",
        ]);
      }),
      { numRuns: 100 },
    );
  });

  it("ignores input array ordering and still renders canonical 6-tuple", () => {
    // 显式构造一个被打乱顺序的 steps，验证组件仍按规范顺序渲染
    const shuffled: MainChainStep[] = [
      { key: "Evidence", status: "completed" },
      { key: "Project", status: "running" },
      { key: "Spec", status: "blocked" },
      { key: "Clarification", status: "failed" },
      { key: "Route", status: "pending" },
      { key: "Execution", status: "pending" },
    ];

    const markup = renderToStaticMarkup(
      <ProjectMainChainTimeline
        steps={shuffled}
        visualTokens={TOKENS}
        theme="light"
      />,
    );

    expect(extractStepKeyOrder(markup)).toEqual([
      "Project",
      "Clarification",
      "Spec",
      "Route",
      "Execution",
      "Evidence",
    ]);
  });
});

/* ─── Property B: statusClass 唯一映射 ─── */

/**
 * **Validates: Requirements 14.2**
 *
 * 5 种 status 各自映射到一个独立的 CSS class，pairwise 不重复。
 * 这是有限离散域 (5 elements)，使用 example 表驱动断言更精准；不需要 fc.assert。
 */
describe("ProjectMainChainTimeline · Property 10B — statusClass uniqueness", () => {
  it("maps 5 statuses to 5 pairwise-distinct class strings", () => {
    const classes = STATUSES.map((s) => MAIN_CHAIN_STATUS_CLASS[s]);

    // 5 个状态 -> 5 个 class
    expect(classes).toHaveLength(5);
    // 每个 class 都是非空字符串
    for (const c of classes) {
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(0);
    }
    // pairwise 唯一：去重后大小不变
    expect(new Set(classes).size).toBe(classes.length);
    // 锁定具体取值（便于审查；如需调整必须同时改 spec/design.md）
    expect(MAIN_CHAIN_STATUS_CLASS).toEqual({
      pending: "is-pending",
      running: "is-running",
      completed: "is-completed",
      blocked: "is-blocked",
      failed: "is-failed",
    });
  });

  it("renders the corresponding statusClass on each rendered step", () => {
    // 每种 status 都让某一步落到，断言渲染输出的 class 包含该 statusClass
    const steps: MainChainStep[] = [
      { key: "Project", status: "pending" },
      { key: "Clarification", status: "running" },
      { key: "Spec", status: "completed" },
      { key: "Route", status: "blocked" },
      { key: "Execution", status: "failed" },
      { key: "Evidence", status: "pending" },
    ];
    const markup = renderToStaticMarkup(
      <ProjectMainChainTimeline
        steps={steps}
        visualTokens={TOKENS}
        theme="dark"
      />,
    );

    for (const status of STATUSES) {
      expect(markup).toContain(MAIN_CHAIN_STATUS_CLASS[status]);
    }
  });
});

/* ─── Property C: 至多一个 is-active ─── */

/**
 * **Validates: Requirements 14.3**
 *
 * 任意 `activeKey`（undefined / 6 个有效 key / 越界字符串）下，渲染输出中带
 * `is-active` class 的步骤数 ≤ 1：
 * - undefined → 0
 * - 命中 6 个 key 之一 → 恰好 1
 * - 越界字符串 → 0
 */
describe("ProjectMainChainTimeline · Property 10C — at most one is-active", () => {
  /**
   * activeKey 候选生成器：
   *   - 33% undefined
   *   - 33% 6 个合法 key 之一
   *   - 33% 越界字符串（任意非 6 个 key 的字符串）
   */
  const activeKeyArb: fc.Arbitrary<MainChainStepKey | undefined> = fc.oneof(
    fc.constant<undefined>(undefined),
    stepKeyArb,
    // 越界 string 用 cast 强行进入；组件运行时只做 `=== key` 等值比较，因此
    // 任何不命中的字符串都应让 is-active 数为 0。
    fc
      .string({ minLength: 0, maxLength: 16 })
      .filter((s) => !STEP_KEYS.includes(s as MainChainStepKey))
      .map((s) => s as unknown as MainChainStepKey),
  );

  it("renders at most one step with `is-active` class", () => {
    fc.assert(
      fc.property(stepsArb, activeKeyArb, themeArb, (steps, activeKey, theme) => {
        const markup = renderToStaticMarkup(
          <ProjectMainChainTimeline
            steps={steps}
            activeKey={activeKey}
            visualTokens={TOKENS}
            theme={theme}
          />,
        );

        const activeCount = countIsActiveClass(markup);

        // 核心不变量：≤ 1
        expect(activeCount).toBeLessThanOrEqual(1);

        // 进一步收紧：合法 key 必产生恰好 1；undefined / 越界字符串必产生 0
        if (activeKey != null && STEP_KEYS.includes(activeKey)) {
          expect(activeCount).toBe(1);
        } else {
          expect(activeCount).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("renders 0 active steps when activeKey is undefined", () => {
    const steps: MainChainStep[] = STEP_KEYS.map((key) => ({
      key,
      status: "running" as const,
    }));
    const markup = renderToStaticMarkup(
      <ProjectMainChainTimeline
        steps={steps}
        visualTokens={TOKENS}
        theme="light"
      />,
    );
    expect(countIsActiveClass(markup)).toBe(0);
  });

  it("renders exactly 1 active step when activeKey hits a canonical key", () => {
    const steps: MainChainStep[] = STEP_KEYS.map((key) => ({
      key,
      status: "pending" as const,
    }));
    for (const target of STEP_KEYS) {
      const markup = renderToStaticMarkup(
        <ProjectMainChainTimeline
          steps={steps}
          activeKey={target}
          visualTokens={TOKENS}
          theme="light"
        />,
      );
      expect(countIsActiveClass(markup)).toBe(1);
      // 断言带 is-active 的那一步正是 target
      const activeMatch = markup.match(
        new RegExp(
          `data-step-key="${target}"[^>]*data-active="true"|data-active="true"[^>]*data-step-key="${target}"`,
        ),
      );
      expect(activeMatch).not.toBeNull();
    }
  });
});
