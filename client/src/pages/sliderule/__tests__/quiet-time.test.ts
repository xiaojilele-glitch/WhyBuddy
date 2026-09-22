/**
 * 长静默要有可读的等待感——这是 2026-09-14 放宽单发超时**自己开的坑**。
 *
 * 同一天把工程档的单发 LLM 读超时从 45 秒放宽到 120 秒
 * （`ControlBudget.max_request_seconds`，真机 67d437a8：模型一轮读完六个源
 * 文件之后带着 ~32K 字源码去想「接下来怎么改」，45 秒不够）。
 *
 * 放宽是对的，但 `SlideRule.tsx` 的状态文案是
 *
 *     liveAction?.label || latestStepText || "正在推演..."
 *
 * **跟时间无关**。模型在想的那一两分钟页面一动不动，跟卡死一模一样；
 * 改之前 45 秒就报错了，用户至少知道出了事。
 *
 * 判据钉三件：门槛以下干净、到点了要出、以及**它量的是静默不是回合总时长**。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUIET_HINT_AFTER_SECONDS, quietHint } from "../quiet-time";

describe("门槛：短回合一个字都不多", () => {
  it("反向：没到门槛返回 null，不是「0 秒」", () => {
    expect(quietHint(0)).toBeNull();
    expect(quietHint(3)).toBeNull();
    expect(quietHint(QUIET_HINT_AFTER_SECONDS - 0.01)).toBeNull();
  });

  it("正向：到点就出", () => {
    expect(quietHint(QUIET_HINT_AFTER_SECONDS)).toBe(`已等待 ${QUIET_HINT_AFTER_SECONDS} 秒`);
  });

  it("反向：坏输入不许崩，也不许显示 NaN", () => {
    for (const bad of [NaN, Infinity, -1, -Infinity]) {
      expect(quietHint(bad)).toBeNull();
    }
  });
});

describe("读数要像人话", () => {
  it("不满一分钟说秒", () => {
    expect(quietHint(45)).toBe("已等待 45 秒");
    expect(quietHint(59.9)).toBe("已等待 59 秒");
  });

  it("过了一分钟说分秒——120 秒那档正是要让人看见的", () => {
    expect(quietHint(72)).toBe("已等待 1 分 12 秒");
    expect(quietHint(119)).toBe("已等待 1 分 59 秒");
  });

  it("整分不说「0 秒」", () => {
    expect(quietHint(60)).toBe("已等待 1 分");
    expect(quietHint(120)).toBe("已等待 2 分");
  });
});

describe("门槛必须够得着新的 120 秒超时（§一之二）", () => {
  it("门槛大于等于单发超时 = 真机上永远看不到它", () => {
    // 工程档单发超时 120 秒。门槛要远小于它，否则等到能显示时请求已经挂了。
    expect(QUIET_HINT_AFTER_SECONDS).toBeLessThan(120);
    // 而且要留出好几跳，让用户在 120 秒里**一路看着它涨**，不是最后一秒才出现。
    expect(QUIET_HINT_AFTER_SECONDS).toBeLessThanOrEqual(30);
  });
});

describe("通电：量的是静默，而且真的接在渲染上", () => {
  const SRC = fs.readFileSync(
    path.resolve(process.cwd(), "client/src/pages/SlideRule.tsx"),
    "utf8"
  );

  it("游标跟着「有没有新动静」重置，不是从回合开头一路累加", () => {
    // 变异：把 useQuietSeconds 的 marker 换成回合 id（整轮不变）→ 一轮里
    // 跑十个工具会累加成「已等待 20 秒」，而其实一直在动。
    expect(SRC).toContain("sinceRef.current = Date.now()");
    expect(SRC).toMatch(/useEffect\(\(\) => \{\s*sinceRef\.current = Date\.now\(\);\s*setSeconds\(0\);\s*\}, \[marker, running\]\)/);
  });

  it("真的渲染出来了，不是算完就扔（§3）", () => {
    // ⚠ 2026-09-14：原来写的是 toContain("quietHint(useQuietSeconds(")。
    //   同一页别处改完跑了一次 prettier，这个调用被折成两行，判据就红了——
    //   而行为一个字没变。判据盯的是「这两个函数套着调」，不是它们排成一行，
    //   所以匹配前先把空白压掉（§2：盯语义，别盯字面）。
    const flat = SRC.replace(/\s+/g, "");
    expect(flat).toContain("quietHint(useQuietSeconds(");
    expect(SRC).toContain("{ctx.quietHint}");
  });

  it("停下来就不再计时，不许在空闲页面上一直转", () => {
    expect(SRC).toContain("if (!running) return;");
    expect(SRC).toContain("window.clearInterval(id)");
  });
});
