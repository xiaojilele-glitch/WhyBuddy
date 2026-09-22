/**
 * 左栏步骤必须标真实能力（2026-08-16 线上实测）。
 *
 * ## 这条防的是"屏幕上像卡在第一步"
 *
 * 真机证据 —— 会话 `sr-20260816095147`（「步伴 AI 拐杖」）：
 *
 *     第 1 轮  79 条步骤，capabilityId 全是 intent.parse，realLlm 全 false
 *     第 2 轮  67 条步骤，同上
 *
 * 而那两轮实际跑了 **27 个能力**：gap.ask 9.1s · structure.decompose 12.1s ·
 * evidence.search 12.0s · risk.analyze 11.6s · critique.generate 9.4s ·
 * appbundle.runtimeClosure **148.3s / 204.8s**（真正在生成应用）…
 *
 * 用户看到的是"正在理解你的目标"滚了七十多遍。屏幕上像卡在第一步，
 * 实际早跑到生成应用了——**进度线在说谎**。
 *
 * 成因是 `appendStreamStep` 把 `capabilityId` 写死成 `"intent.parse" as any`，
 * 而真实能力 id 一直在调用点手里（`onReasoningStep` 的第一个参数）。
 *
 * ## 为什么是源码判据
 *
 * `appendStreamStep` 是 `useSlideRuleSession` 内部的闭包，没有导出、也没有
 * 不启动整个 hook 就能触达的路径。仓里对这种形态有先例
 * （`test_enrich_stage_visibility.py` 从 pipeline 源码捞 `_stage()` 实参）。
 *
 * ⚠ **先剥注释再匹配**。本会话踩过一次：判据 grep 源码里的标识符，而那个词
 * 同时出现在文档字符串里，于是变异注入后测试照样绿——判据等于没有。
 * 上面这段注释里就写着 `"intent.parse"`，不剥就必然假绿。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../useSlideRuleSession.ts", import.meta.url));

/** 剥掉块注释与行注释——判据只看真正会执行的代码。 */
function code(): string {
  return readFileSync(SRC, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 取出 appendStreamStep 的函数体（从声明到它自己的收尾 `};`）。 */
function appendStreamStepBody(src: string): string {
  const at = src.indexOf("const appendStreamStep");
  expect(at, "appendStreamStep 不见了 —— 判据锚点失效，先修判据").toBeGreaterThan(-1);
  const end = src.indexOf("\n          };", at);
  expect(end, "找不到 appendStreamStep 的收尾").toBeGreaterThan(at);
  return src.slice(at, end);
}

describe("左栏步骤的能力归属", () => {
  it("appendStreamStep 用调用方给的能力 id，不是写死一个", () => {
    const body = appendStreamStepBody(code());
    expect(
      body,
      "appendStreamStep 又把 capabilityId 写死了 —— 79 条步骤会重新变成同一个能力"
    ).toContain("opts?.capabilityId");
  });

  it("onReasoningStep 必须把真实能力 id 传下去", () => {
    const src = code();
    const at = src.indexOf("onReasoningStep:");
    expect(at, "onReasoningStep 不见了 —— 判据锚点失效").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(
      handler,
      "onReasoningStep 手里就有能力 id 却没往下传 —— 这是那 65 条 chip 的主要来源"
    ).toMatch(/appendStreamStep\([^)]*\{[^}]*capabilityId/s);
    expect(
      handler,
      "内部 id 必须先翻人话，不能直接「正在执行 specfirst.design」"
    ).toContain("humanReasoningStepLabel");
  });

  it("LLM 流式那条要标 realLlm，否则左栏两种事分不开", () => {
    const src = code();
    const at = src.indexOf("onLlmDelta:");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(
      handler,
      "onLlmDelta 是真·模型在吐字，realLlm 必须为真（TurnRouteTimeline 靠它上色）"
    ).toMatch(/appendStreamStep\([^)]*realLlm:\s*true/s);
  });

  it("realLlm 不再恒为 false", () => {
    const body = appendStreamStepBody(code());
    expect(
      body,
      "realLlm 写死 false 的话，模型在想和系统报进度在左栏长得一模一样"
    ).not.toMatch(/realLlm:\s*false/);
  });
});

describe("marathon reasoning_step 传机器 id", () => {
  it("有 stage 就传 stage，不把人话当能力 id", () => {
    const marathon = readFileSync(
      fileURLToPath(new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url)),
      "utf-8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const at = marathon.indexOf('case "reasoning_step"');
    expect(at).toBeGreaterThan(-1);
    const handler = marathon.slice(at, at + 500);
    expect(handler).toMatch(/event\.stage/);
    expect(handler).toMatch(/onReasoningStep/);
  });
});
