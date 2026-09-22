/**
 * SSE 事件词表：Python 发什么，前端就得认什么（2026-08-28 架构对账查出来的）。
 *
 * ## 这条挡的是什么
 *
 * 前端的事件 switch 收尾是 `default: return "continue"`——**不认识的类型静默
 * 丢弃，连一行日志都没有**。所以后端加一个事件、前端忘了接，表现是「功能写完
 * 了、上线了、什么都没发生」，而且没有任何一处报错。
 *
 * 这正是本仓数过十次以上的形状，只是换到了跨进程的接缝上（CLAUDE.md §4：
 * 生成侧 / 消费侧，改一半必然静默失效）。
 *
 * ## 逮到的现场
 *
 * 2026-08-28 全量对账：Python 发 29 种、前端认 19 种。差集里 5 个是真的：
 *
 *     control_clarify / phase_change / reasoning_step_result / run_started
 *         —— 前端确实不需要，但**从来没人声明过"不需要"**
 *     recovery
 *         —— 当天刚加的，发了一条「没人答、我按默认继续了」的结构化事件，
 *            而前端没人听。等于"我替你做了个决定"发进虚空，而那条恢复配方
 *            （抄 claw-code）的全部意义就是让人知道。
 *            修法不是再加个监听，是**去掉那条没人听的通道**——把恢复信息
 *            并进已经有人听的 run_pause_ended 里。一条通道、一处处理。
 *
 * ## 判据的形状：白名单，不是「全都要接」
 *
 * 「每个事件都必须被处理」是错的——有些后端事件前端真的不需要。但**"不需要"
 * 得是一次明写的决定，不能是忘了**。所以维护一份"有意不接"的名单：加新事件
 * 时要么接上，要么写进名单说明为什么，两者都不做就当场红。
 *
 * 这跟 grok-build 那条「单一来源，两处解析不许漂」是同一个思路
 * （`response_timeout_env_secs` 的注释：single source for this parse —
 * the shell's env tier calls it too, so the two resolutions can't drift）。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** 剥注释再扫：本仓踩过"判据 grep 到的词其实在注释里"。 */
function stripComments(src: string, py = false): string {
  return src
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return py
        ? !t.startsWith("#")
        : !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** 后端发事件的地方。加了新的发射点要写进来——漏了这条判据就管不到它。 */
const EMITTERS = [
  "../../../../../slide-rule-python/services/v5_full_driver.py",
  "../../../../../slide-rule-python/services/rehearsal_control.py",
  "../../../../../slide-rule-python/services/run_registry.py",
];

/**
 * 前端**有意不接**的后端事件。加进这份名单等于签字：我知道它存在，确认不需要。
 *
 * ⚠ 每一条都要写清为什么。名单是用来逼人做决定的，不是用来让判据变绿的。
 */
const INTENTIONALLY_IGNORED: Record<string, string> = {
  // 起跑信号：runId 走 onRunId 那条专门的路拿，不从事件流里认
  run_started: "runId 由 onRunId 回调给出，事件本身前端不用",
  // 阶段词：左栏显示的是 reasoning_step 的人话标签，不是机器阶段名
  phase_change: "左栏只展示人话标签（reasoning_step），机器阶段名不上屏",
  reasoning_step_result: "步骤结果并进 reasoning_step 的展示，不单独渲染",
  // 控制面澄清走的是 control-turn-stream 那条流，不是工厂流
  control_clarify: "控制面事件，工厂流上不会出现（跨流类型，扫描误收）",
};

/** JSON-schema 里的类型词，不是事件——扫描噪音，排除掉。 */
const NOISE = new Set([
  "array",
  "boolean",
  "function",
  "object",
  "string",
  "number",
  "integer",
  "null",
]);

function emitted(): Set<string> {
  const out = new Set<string>();
  for (const rel of EMITTERS) {
    /**
     * ⚠ 读不到就**当场炸**，不许 catch 掉继续。
     *
     * 第一版写的是 `try { … } catch { continue }`，而路径少了一层——于是
     * "后端发了哪些事件"是个**空集合**，第一条判据 `orphans == []` 空过。
     * 判据打空是本仓点名的形状（CLAUDE.md §2：断言直接打空）。
     * 判据读不到它要量的东西时，必须红，不能绿。
     */
    const src = readFileSync(resolve(__dirname, rel), "utf8");
    for (const m of stripComments(src, true).matchAll(/"type":\s*"([a-z_]+)"/g)) {
      if (!NOISE.has(m[1])) out.add(m[1]);
    }
  }
  return out;
}

function handled(): Set<string> {
  const src = readFileSync(
    resolve(__dirname, "../../../lib/sliderule-marathon-driver.ts"),
    "utf8"
  );
  return new Set(
    [...stripComments(src).matchAll(/case\s+"([a-z_]+)"/g)].map(m => m[1])
  );
}

describe("后端发的事件，前端要么接、要么明写不接", () => {
  it("判据自己没打空（先钉住它真的量到了东西）", () => {
    /**
     * ⚠ 这条必须排第一。没有它，路径写错 / 文件改名 / 正则失配都会让
     *   下面几条**空过**——绿灯，而什么都没验。
     */
    expect(emitted().size).toBeGreaterThan(10);
    expect(handled().size).toBeGreaterThan(10);
  });

  it("没有既不接、也没写进名单的事件", () => {
    const orphans = [...emitted()]
      .filter(t => !handled().has(t))
      .filter(t => !(t in INTENTIONALLY_IGNORED))
      .sort();
    expect(orphans).toEqual([]);
  });

  it("名单里的每一条都有理由，且不是空话", () => {
    for (const [k, why] of Object.entries(INTENTIONALLY_IGNORED)) {
      expect(why.length, `${k} 的理由太短，等于没写`).toBeGreaterThan(8);
    }
  });

  it("名单不许养僵尸：写了不接、后端却早就不发了", () => {
    /**
     * ⚠ 反向判据。名单只增不减的话，几年后它会变成一份"曾经有过的事件"清单，
     *   读的人分不出哪些还活着——而分不出的名单等于没有名单。
     */
    const gone = Object.keys(INTENTIONALLY_IGNORED).filter(
      t => !emitted().has(t) && !handled().has(t)
    );
    expect(gone).toEqual([]);
  });

  it("暂停那条链上的两个事件都真的接了（不许再发进虚空）", () => {
    const h = handled();
    expect(h.has("run_pause_started")).toBe(true);
    expect(h.has("run_pause_ended")).toBe(true);
    // recovery 已经并进 ended，不该再作为独立事件存在
    expect(emitted().has("recovery")).toBe(false);
  });
});
