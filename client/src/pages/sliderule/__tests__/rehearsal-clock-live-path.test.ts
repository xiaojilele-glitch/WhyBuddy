/**
 * 产品六步钟必须接在通电的 SSE 投影上。
 *
 * 只测 mapInternalEventToProductStep 会假绿：表写对了、session 没调用
 * advanceRehearsalCursor，真机钟永远停在默认第 2 步。
 *
 * ⚠ 先剥注释再匹配。本文件和被查文件都写着 spec_tree / applyRehearsalEvent，
 * 不剥的话把调用点删了判据照样绿。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  // ⚠ 必须剥行尾注释。只剥整行 // 的话，把调用改成
  // `onReasoningStep: () => { // applyRehearsalEvent(capabilityId)` 仍绿。
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function load(rel: string): string {
  return stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));
}

/**
 * 取一个 handler 的**完整**函数体，按大括号配平找结尾。
 *
 * ⚠ 2026-09-04：原来是 `src.slice(at, at + span)` 固定字符窗。阶段 2 给
 *   `onFactoryPlan` 加了写决策账本那一段，handler 从约 900 字符涨到约 2000，
 *   最后一行 `appendStreamStep(\`编排 …\`)` 被挤出 1800 的窗外 → 判据红，
 *   而代码一个字都没错。**改成配平找结尾，handler 再长也不会假红。**
 *
 *   固定窗还有个更坏的方向：窗太长会把下一个 handler 的内容也框进来，
 *   于是「A 里有 X」实际断言的是「A 或它后面那个里有 X」——假绿。
 */
function handlerSlice(src: string, name: string): string {
  const at = src.indexOf(`${name}:`);
  expect(at, `${name} 不见了 —— 判据锚点失效`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  expect(open, `${name} 后面没有函数体`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`${name} 的函数体没有配平的右大括号`);
}

describe("M8 推演钟不查翻译表", () => {
  it("翻译表已经删掉", () => {
    const src = load("../derive-status-bar.ts");
    expect(src).not.toContain("export const REHEARSAL_MODULE_TO_STEP");
    expect(src).not.toContain("REHEARSAL_EVENT_ALIASES");
    expect(src).toMatch(/mapInternalEventToProductStep[\s\S]*return null/);
  });

  it("第 1 步 skippable: true 写在步骤表里", () => {
    const src = load("../derive-status-bar.ts");
    const steps = src.slice(
      src.indexOf("export const REHEARSAL_PRODUCT_STEPS"),
      src.indexOf("export type RehearsalClockCursor")
    );
    expect(steps).toMatch(/id:\s*1[\s\S]*skippable:\s*true/);
  });

  it("墙上钟文案只有「大约数分钟」，派生层不写假分钟数", () => {
    const src = load("../derive-status-bar.ts");
    expect(src).toContain('"大约数分钟，第一页会先出现"');
    expect(src).not.toContain("8 分钟");
    expect(src).not.toContain("约 2 分钟");
    expect(src).not.toContain("20 分钟");
    expect(src).not.toMatch(/8–9/);
  });

  it("HUD token 只认 source === server（删掉这行比较必红）", () => {
    const src = load("../derive-status-bar.ts");
    const fn = src.slice(
      src.indexOf("export function deriveContextHudFacts"),
      src.indexOf("export type StatusBarFacts")
    );
    expect(fn).toMatch(/row\.source\s*(?:!==|===)\s*"server"/);
    expect(fn).toContain("publishClosure?.evidencePresentCount ?? 0");
    expect(fn).toContain("hasServerTokenFacts");
    expect(fn).not.toContain("search_evidence");
  });
});

describe("SSE 投影接在 useSlideRuleSession（删调用点必红）", () => {
  it("reasoning_step / 页 sink / skill_start / heartbeat 都推进钟", () => {
    const src = load("../useSlideRuleSession.ts");
    expect(handlerSlice(src, "onReasoningStep")).toContain(
      "applyRehearsalEvent(capabilityId, productStep)"
    );
    expect(handlerSlice(src, "onSpecPage")).toContain("productStep");
    expect(handlerSlice(src, "onSkillActivated")).toContain(
      "applyRehearsalEvent(skillId)"
    );
    expect(handlerSlice(src, "onProgressHeartbeat")).toContain(
      "applyRehearsalEvent(stage, productStep)"
    );
    expect(handlerSlice(src, "onControlClarify")).toContain(
      "event.productStep ?? 1"
    );
  });

  it("runTurn 里 setIsRunning(true) 同一拍就重置钟（idle 或 start）", () => {
    const src = load("../useSlideRuleSession.ts");
    const runAt = src.indexOf("const runTurn = async");
    expect(runAt, "runTurn 不见了").toBeGreaterThan(-1);
    const runningAt = src.indexOf("setIsRunning(true)", runAt);
    expect(runningAt, "runTurn 的 setIsRunning(true) 不见了").toBeGreaterThan(runAt);
    const idleAt = src.indexOf("idleRehearsalCursor()", runningAt);
    const startAt = src.indexOf("startRehearsalCursor()", runningAt);
    expect(idleAt, "廉价回合必须 idle 掉上一轮汇合过闸").toBeGreaterThan(runningAt);
    expect(startAt, "WRITE 仍要 startRehearsalCursor").toBeGreaterThan(runningAt);
    const between = src.slice(runningAt, Math.min(idleAt, startAt));
    expect(
      between.length,
      "重置钟被挪到 persist/intake 之后了"
    ).toBeLessThan(500);
    expect(between).not.toContain("await ");
    expect(src).not.toContain("/rehearsal-progress");
    expect(src).not.toContain("/progress-clock");
    expect(src).not.toContain("POST /api/sliderule/progress");
  });

  it("规划第一轮只在 factoryLit 里，问候不点钟", () => {
    const src = load("../useSlideRuleSession.ts");
    const runTurn = src.slice(
      src.indexOf("const runTurn = async"),
      src.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("factoryLit");
    expect(runTurn).toContain("isFactoryWriteTool");
    expect(runTurn).toContain("正在想…");
    expect(runTurn).toContain("ensureFactoryClock");
    expect(runTurn).toContain("onControlToolStart");
    const planAt = runTurn.indexOf("规划第一轮能力与路线");
    expect(planAt).toBeGreaterThan(-1);
    const factoryIf = runTurn.lastIndexOf("if (factoryLit)", planAt);
    expect(factoryIf, "规划第一轮必须在 factoryLit 块里").toBeGreaterThan(-1);
    expect(runTurn.indexOf("if (factoryLit)")).toBeGreaterThan(-1);
  });
});

describe("轨迹折叠接在 LlmLiveOutput（不是死字段）", () => {
  it("collapsed 钉 useState(true)；改回 done||looksJson 必红", () => {
    const src = load("../LlmLiveOutput.tsx");
    // ⚠ 必须钉 collapsed 这一行。只 grep useState(true) 会命中 following
    // 的初值，把 collapsed 改回 done||looksJson 仍绿。
    expect(src).toMatch(
      /\[\s*collapsed\s*,\s*setCollapsed\s*\]\s*=\s*React\.useState\(\s*true\s*\)/
    );
    expect(src).not.toMatch(/useState\(\s*done/);
    expect(src).not.toMatch(/useState\(\s*looksJson/);
  });

  it("session 不再往 llmStreams 塞 collapsed（折叠不靠死字段）", () => {
    const src = load("../useSlideRuleSession.ts");
    const at = src.indexOf("setLlmStreams(");
    expect(at, "setLlmStreams 不见了").toBeGreaterThan(-1);
    // 取「从首次 setLlmStreams 到 onSpecPage」这一段：里面是按 label 攒流。
    const slice = src.slice(at, src.indexOf("onSpecPage"));
    expect(slice).not.toMatch(/collapsed\s*:/);
  });
});

describe("产品面挂上了钟（不是只写了组件）", () => {
  it("ClaudeChatSurface 不再把六步钟挂在对话顶上", () => {
    // 2026-09-15：用户圈了顶上那条 hop 日历说移除。工程面 StatusBar 仍吃钟。
    const src = load("../../SlideRule.tsx");
    const surface = src.slice(
      src.indexOf("export function ClaudeChatSurface"),
      src.indexOf("function DriveFullStatusBanner")
    );
    expect(surface).not.toContain("<RehearsalClockHud");
    expect(surface).not.toContain("sliderule-rehearsal-clock");
  });

  it("Unified 把 rehearsalFacts 喂给对话列", () => {
    const src = load("../../SlideRule.tsx");
    expect(src).toContain("rehearsalClock={rehearsalFacts.rehearsalClock}");
    expect(src).toContain("hud={rehearsalFacts.hud}");
    expect(src).toContain("factoryDecision={rehearsalFacts.factoryDecision}");
  });

  it("工程面 StatusBar 吃 rehearsalCursor", () => {
    const src = load("../../SlideRule.tsx");
    expect(src).toContain("rehearsalCursor={rehearsalCursor}");
    const bar = load("../SlideRuleStatusBar.tsx");
    expect(bar).toContain("<RehearsalClockHud");
    expect(bar).toContain("data-skippable=");
  });
});

describe("已有 SSE progress_heartbeat 投影，不另开 API", () => {
  it("marathon driver 把 heartbeat 交给 onProgressHeartbeat", () => {
    const src = load("../../../lib/sliderule-marathon-driver.ts");
    const at = src.indexOf('case "progress_heartbeat"');
    expect(at, "progress_heartbeat 分发不见了").toBeGreaterThan(-1);
    const slice = src.slice(at, at + 280);
    expect(slice).toContain("opts.onProgressHeartbeat");
    expect(slice).not.toContain("appendStreamStep");
  });

  it("factory_plan 写进 goal.tools，钟才跟编排走", () => {
    const driver = load("../../../lib/sliderule-marathon-driver.ts");
    expect(driver).toContain('case "factory_plan"');
    expect(driver).toContain("opts.onFactoryPlan");
    expect(driver).toContain("event.rationale");
    const session = load("../useSlideRuleSession.ts");
    const plan = handlerSlice(session, "onFactoryPlan");
    expect(plan).toContain("goal.tools = tools");
    expect(plan).toContain("goal.productSteps = productSteps");
    expect(plan).toContain("appendStreamStep");
    expect(plan).toContain("decisionLedger");
    expect(plan).toContain("decision?.rationale");
  });
});

describe("选材决策上屏（2026-09-04 阶段 2）", () => {
  it("HUD 有账本才画决策，回落说人话", () => {
    const bar = load("../SlideRuleStatusBar.tsx");
    expect(bar).toContain("sliderule-factory-decision");
    expect(bar).toContain("选材回落规则版，不是模型挑的");
    expect(bar).toContain("decision.degraded");
    expect(bar).toContain("sliderule-factory-loop");
  });
});
