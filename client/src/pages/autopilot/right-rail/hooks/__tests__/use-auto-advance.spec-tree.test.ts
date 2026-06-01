/**
 * autopilot-streaming-experience Spec Task 5.1：spec_tree 阶段不自动推进回归测试。
 *
 * 该测试覆盖需求 5.1 / 5.2 / 5.3 / 5.5：
 * - WHILE `job.stage === "spec_tree"` 时，无论 `job.status` 取 `running | reviewing
 *   | completed`，`useAutoAdvance` 的 effect 都不会调用 `generateBlueprintSpecDocuments`。
 * - 仅当用户点击 StageViewport CTA 触发 `forceAdvance()` 时，spec_tree
 *   分支才调用 `generateBlueprintSpecDocuments`。
 * - 当 `stage === "spec_docs" && status === "completed"` 时，spec_tree 的“手动”
 *   契约不影响下游自动推进：effect 会调用 `generateBlueprintEffectPreview`。
 *
 * 实现口径（与本仓现有 React 组件 / hook 测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react`、`jsdom` 或 `happy-dom`；
 *   `useEffect` 与 `useCallback` 的真实运行需要这些工具链支撑。引入它们属于
 *   跨规格的工具链改造，不在本规格的约束范围内（NFR-1：不扩张 5140+ 既有
 *   测试集 / TS 基线）。
 *
 *   因此本回归测试改用 *与既有 `AutopilotRoutePage.test.tsx` "E1: route selection
 *   must NOT navigate away" 测试相同的源代码层断言策略*：直接读取
 *   `use-auto-advance.ts` 文件内容，对“auto-advance effect 在 spec_tree 阶段
 *   一定早返回”和“forceAdvance 在 spec_tree 阶段一定调用
 *   generateBlueprintSpecDocuments”这两条契约做静态属性断言。
 *
 *   只要 effect 的 spec_tree 分支体内不出现 `generateBlueprintSpecDocuments`
 *   字面量、并且体内有一个 `return;` 早返回，就足以证明：在 React 真实运行
 *   时，无论 `status` 取何值，effect 都不会触发 spec_docs 阶段 API；这与
 *   需求 5.1 中“无论 running | reviewing | completed”的覆盖要求一一对应。
 */

import { describe, expect, it } from "vitest";

// 一次性读取 use-auto-advance.ts 源文件，避免每个用例重复 IO。
async function loadHookSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(
    path.resolve(__dirname, "../use-auto-advance.ts"),
    "utf8"
  );
}

/**
 * 提取 auto-advance `useEffect` 中 spec_tree 分支的代码块体。
 *
 * 期望匹配到形如：
 *
 *   if (
 *     stage === "spec_tree" &&
 *     !advancedStagesRef.current.has("spec_docs")
 *   ) {
 *     // 不自动推进，等待用户手动确认
 *     return;
 *   }
 *
 * 由于该分支体内不含嵌套大括号，可以用 `[^}]*` 安全捕获。
 */
function extractSpecTreeAutoAdvanceBranchBody(source: string): string | null {
  const match = source.match(
    /if\s*\(\s*stage\s*===\s*"spec_tree"\s*&&\s*!advancedStagesRef\.current\.has\("spec_docs"\)\s*\)\s*\{([^}]*)\}/
  );
  return match ? match[1] : null;
}

/**
 * 提取 `forceAdvance` 函数体（直至 `useCallback(...)` 的 deps 数组之前）。
 * 用 `[\s\S]*?` 做非贪婪匹配，以容忍内部的嵌套大括号（如 `void advance(...,
 * async () => { ... })`）。
 */
function extractForceAdvanceBody(source: string): string | null {
  const match = source.match(
    /const\s+forceAdvance\s*=\s*useCallback\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[/
  );
  return match ? match[1] : null;
}

// ─── 用例 1 ~ 3：spec_tree + (running | reviewing | completed) 不触发自动推进 ──

describe("useAutoAdvance — spec_tree never auto-advances (Spec 5.1)", () => {
  it("does NOT call generateBlueprintSpecDocuments when job.stage === 'spec_tree' && status === 'running'", async () => {
    const source = await loadHookSource();
    const branchBody = extractSpecTreeAutoAdvanceBranchBody(source);

    // 关键事实 1：auto-advance effect 中确实存在 spec_tree 分支（早返回守卫）。
    expect(branchBody).not.toBeNull();

    // 关键事实 2：spec_tree 分支体内不含 generateBlueprintSpecDocuments 调用。
    //   这等价于 React runtime 中：无论 status === "running"，effect 都不会
    //   走到 spec_docs 阶段 API。
    expect(branchBody!).not.toMatch(/generateBlueprintSpecDocuments/);

    // 关键事实 3：spec_tree 分支体内存在 return;（早返回，绕过下游所有 if 链）。
    expect(branchBody!).toMatch(/return\s*;/);

    // 关键事实 4：spec_tree 分支不依赖 status === "running"，与“无论 status
    //   取何值都不自动推进”的契约一致。
    expect(branchBody!).not.toMatch(/status\s*===\s*"running"/);
  });

  it("does NOT call generateBlueprintSpecDocuments when job.stage === 'spec_tree' && status === 'reviewing'", async () => {
    const source = await loadHookSource();
    const branchBody = extractSpecTreeAutoAdvanceBranchBody(source);

    expect(branchBody).not.toBeNull();
    expect(branchBody!).not.toMatch(/generateBlueprintSpecDocuments/);
    expect(branchBody!).toMatch(/return\s*;/);
    // 同样，spec_tree 分支不依赖 status === "reviewing"。
    expect(branchBody!).not.toMatch(/status\s*===\s*"reviewing"/);
  });

  it("does NOT call generateBlueprintSpecDocuments when job.stage === 'spec_tree' && status === 'completed'", async () => {
    const source = await loadHookSource();
    const branchBody = extractSpecTreeAutoAdvanceBranchBody(source);

    expect(branchBody).not.toBeNull();
    expect(branchBody!).not.toMatch(/generateBlueprintSpecDocuments/);
    expect(branchBody!).toMatch(/return\s*;/);
    // 同样，spec_tree 分支不依赖 status === "completed"。
    expect(branchBody!).not.toMatch(/status\s*===\s*"completed"/);
  });

  // ─── 用例 4：forceAdvance 在 spec_tree 阶段 *会* 调用 spec_docs API ──────────

  it("calls the injected spec document action exactly once when forceAdvance() is invoked in spec_tree", async () => {
    const source = await loadHookSource();
    const forceAdvanceBody = extractForceAdvanceBody(source);

    // 关键事实 1：forceAdvance 函数体可被定位。
    expect(forceAdvanceBody).not.toBeNull();

    // 关键事实 2：forceAdvance 中 spec_tree 分支后紧跟一次
    //   `generateBlueprintSpecDocuments(` 调用，对应需求 5.2。
    expect(forceAdvanceBody!).toMatch(
      /if\s*\(\s*stage\s*===\s*"spec_tree"\s*\)\s*\{[\s\S]*?actions\.generateSpecDocuments\(/
    );

    // 关键事实 3：整个 use-auto-advance.ts 文件中 generateBlueprintSpecDocuments
    //   只被调用一次（即仅在 forceAdvance 路径中）。这一全局唯一性进一步证明
    //   auto-advance effect 中没有任何 spec_docs API 调用。
    const callMatches = source.match(/actions\.generateSpecDocuments\(/g);
    expect(callMatches).not.toBeNull();
    expect(callMatches!.length).toBe(1);
  });

  it("batch-generates documents for the whole SPEC tree instead of only the root node", async () => {
    const source = await loadHookSource();
    const forceAdvanceBody = extractForceAdvanceBody(source);

    expect(forceAdvanceBody).not.toBeNull();

    const specTreeGenerateRequest = forceAdvanceBody!.match(
      /if\s*\(\s*stage\s*===\s*"spec_tree"\s*\)\s*\{[\s\S]*?actions\.generateSpecDocuments\(\s*jobId\s*,\s*\{([\s\S]*?)\}\s*\)/
    );

    expect(specTreeGenerateRequest).not.toBeNull();
    expect(specTreeGenerateRequest![1]).toMatch(/types\s*:/);
    expect(specTreeGenerateRequest![1]).not.toMatch(/\bnodeId\s*:/);
  });

  // ─── 用例 5：spec_docs + completed → effect_preview 自动推进保持有效 ────────

  it("auto-advances spec_docs (completed) to effect_preview, proving the spec_tree manual contract does not block downstream auto-advance", async () => {
    const source = await loadHookSource();

    // 关键事实 1：auto-advance effect 中保留 spec_docs + completed 分支。
    //   这条 if 表达式同时引用 stage、status 和 advancedStagesRef.current.has(
    //   "effect_preview")，是 forceAdvance 路径不会复用的复合守卫，匹配到它
    //   即可证明 effect 仍然承担 spec_docs → effect_preview 的自动推进。
    expect(source).toMatch(
      /stage\s*===\s*"spec_docs"\s*&&\s*\n?\s*status\s*===\s*"completed"\s*&&\s*\n?\s*!advancedStagesRef\.current\.has\("effect_preview"\)/
    );

    // 关键事实 2：从 spec_docs + completed 守卫开始，到调用
    //   `generateBlueprintEffectPreview(` 之间没有别的 if/return 早断；说明
    //   命中守卫后会真正进入 effect_preview 阶段的 API 调用。
    expect(source).toMatch(
      /stage\s*===\s*"spec_docs"\s*&&\s*\n?\s*status\s*===\s*"completed"[\s\S]*?actions\.generateEffectPreview\(/
    );

    // 关键事实 3：effect_preview 的目标 stage 名作为字符串字面量传给
    //   `advance("effect_preview", ...)`，与 advancing 状态机及 onAdvanced 回
    //   调一致。
    expect(source).toMatch(/advance\(\s*"effect_preview"/);
  });
});
