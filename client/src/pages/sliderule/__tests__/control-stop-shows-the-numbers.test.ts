/**
 * 「为什么停」要把服务端量到的数**显示出来**，不是存进一个没人读的 ref。
 *
 * ## 病（2026-09-14 复审）
 *
 * `rehearsal_control` 挂 limit/used 时的注释：
 *
 *   ⚠ limit/used 不是装饰：光说「打转了」没法行动，说「同一件 inspect_model
 *     连了 4 轮、紧档上限就是 4」才知道该不该调这个数。
 *
 * 前端收到之后只有 `lastControlStopRef.current = stop`。全仓三处引用——
 * 声明、清空、赋值，**一处读都没有**。而当时的判据还钉了一条
 * `toContain("lastControlStopRef.current = stop")`：正向有、反向没有，
 * 正是 §3「名单里有名字 ≠ 埋点在」。
 *
 * 所以这份判据两头都钉：文案要带上数（正向）、要真的接在渲染那一处（通电）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { controlStopLine } from "../control-stop";
import type { ControlStop } from "@/lib/sliderule-marathon-driver";

const stop = (over: Partial<ControlStop> = {}): ControlStop => ({
  stopReason: "stationarity",
  stoppedBy: "runtime",
  limit: 4,
  used: 4,
  ...over,
});

describe("量出来的数必须落到文案上", () => {
  it("正向：带上 已用/上限 和量纲，以及是谁拦的", () => {
    const line = controlStopLine("我在同一步上打转了，先停下没点火。", stop());
    expect(line).toContain("4/4次");
    expect(line).toContain("我们的闸");
    // 服务端那句人话一个字不许改——这里只**补**，不重写（§4）。
    expect(line.startsWith("我在同一步上打转了，先停下没点火。")).toBe(true);
  });

  it("核心：两道打转闸靠这个数才分得开", () => {
    // 老闸：整轮签名，紧档上限 4。新闸：同一次调用同一份结果，上限 5。
    // 两者共用同一句罐头文案，**唯一的区别就是这个 limit**。
    const older = controlStopLine("我在同一步上打转了。", stop({ limit: 4, used: 4 }));
    const newer = controlStopLine("我在同一步上打转了。", stop({ limit: 5, used: 5 }));
    expect(older).not.toEqual(newer);
    expect(older).toContain("4/4");
    expect(newer).toContain("5/5");
  });

  it("量纲跟着停因走：4 轮 / 4 次 / 8000token / 45秒 不是一回事", () => {
    expect(controlStopLine("x", stop({ stopReason: "tool_rounds", limit: 8, used: 8 })))
      .toContain("8/8轮");
    expect(controlStopLine("x", stop({ stopReason: "token_budget", limit: 64000, used: 64488 })))
      .toContain("64488/64000token");
    expect(controlStopLine("x", stop({ stopReason: "wall_clock", limit: 180, used: 181 })))
      .toContain("181/180秒");
  });

  it("反向：没有数就原样返回，不许缀一个空括号", () => {
    // llm_unavailable 的 text 自己就带着「ReadTimeout after 45.2s (budget 45s)」，
    // 再补一个空括号只是噪声。
    const text = "ReadTimeout after 45.2s (budget 45s) 本轮工程任务已停止；";
    const line = controlStopLine(text, stop({
      stopReason: "llm_unavailable", stoppedBy: "provider",
      limit: undefined, used: undefined,
    }));
    expect(line).toBe(text);
    expect(line).not.toContain("（");
  });

  it("反向：没有 stop 的普通文案不许被加工", () => {
    expect(controlStopLine("你好。", null)).toBe("你好。");
    expect(controlStopLine("你好。", undefined)).toBe("你好。");
  });

  it("反向：模型侧和我们的闸要分得开——决定「再试一次有没有用」", () => {
    expect(controlStopLine("x", stop({ stoppedBy: "provider" }))).toContain("模型侧");
    expect(controlStopLine("x", stop({ stoppedBy: "runtime" }))).toContain("我们的闸");
    // 认不出来的来源不许硬编一个名字
    const odd = controlStopLine("x", stop({ stoppedBy: "unknown" }));
    expect(odd).toContain("4/4次");
    expect(odd).not.toContain("我们的闸");
    expect(odd).not.toContain("模型侧");
  });
});

describe("通电：真的接在渲染那一处", () => {
  it("停因走 controlStopLine，不许退回裸 text", () => {
    // 变异：把调用点改回 `appendStreamStep(text)` → 本条红。
    // 只测纯函数的话，那个变异**照样全绿**——这正是 §3 要补的反向。
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/sliderule/useSlideRuleSession.ts"),
      "utf8"
    );
    expect(src).toContain("appendStreamStep(controlStopLine(text, stop))");
    expect(src).not.toContain("if (stop) {\n                  appendStreamStep(text);");
  });
});
