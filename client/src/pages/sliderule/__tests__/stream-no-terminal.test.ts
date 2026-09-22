import { readFileSync } from "node:fs";
/**
 * 流没收尾 = 协议违规，要有名字，不许当成"完成"。
 *
 * 抄的标准答案：xai-tool-runtime（grok-build）`dispatch.rs`
 *   /// The returned stream MUST end with exactly one `Terminal` item.
 *   /// A stream that ends without a `Terminal` is a protocol violation by
 *   /// the implementation; the default surfaces this as
 *   /// `ToolError::Custom { code: "stream_no_terminal", ... }`
 * 那边的 `call_terminal` 遇到无终局的流返回 Err，而不是把攒到一半的东西
 * 当结果交出去。
 *
 * 本仓今天的形状（2026-08-27 审查）：两个消费者里
 *     if (done) break;                          // 流断了，没收到 complete
 *     ...
 *     if (verdict === "complete") break outer;  // 正常收尾
 *     ...
 *     return finishDriveStream(acc, opts);      // ← 两条路同一个出口
 * 断掉的流只要之前某个事件带过 state，就会被 finishDriveStream 包成一个
 * 看着正常的结果返回。而 classifyStreamFallback 第一行就是
 *     if (input.gotResult) return "settled";
 * ——于是断流在**已有的两道双开守卫上游**就被判成了"已收尾"，守卫根本没
 * 机会生效（它们只在 gotResult 为假时才看 sawRunId / settledReason）。
 *
 * 这跟 2026-08-10 那次事故（POST 流第 2 分钟被 reset、服务端一路跑到
 * seq 1812 正常收尾、前端把整轮重跑）是同一条根：**消费者分不清
 * "收尾了" 和 "断了"**。那次修的是下游症状，这次把区分放回消费者并命名。
 *
 * 终局事件集合（applyFactoryStreamEvent）：complete 成功收尾；
 * run_cancelled / error 走 abort（已经返回 null，是诚实的）。
 * 一个都没见到就 done = 违规。
 */
import { describe, expect, it } from "vitest";

import {
  classifyStreamFallback,
  consumeControlStreamResponse,
  consumeDriveStreamResponse,
  STREAM_NO_TERMINAL,
} from "../../../lib/sliderule-marathon-driver";

const STATE = {
  sessionId: "s1",
  goal: { text: "请假系统", status: "clear" },
};

function sse(events: unknown[]): Response {
  const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("工厂流：没有终局就不许当成收尾", () => {
  it("正向：带 complete 的流照常返回结果（别把好路也堵了）", async () => {
    const out = await consumeDriveStreamResponse(
      sse([
        { type: "skill_start", capabilityId: "spec_tree" },
        { type: "complete", state: STATE },
      ]),
      {}
    );
    expect(out?.finalState?.sessionId).toBe("s1");
  });

  it("反向：流里有 state 但没 complete → 不返回结果", async () => {
    const out = await consumeDriveStreamResponse(
      sse([
        { type: "skill_start", capabilityId: "spec_tree" },
        // 服务端在这里被 reset：state 已经随某个事件到过前端，但没收尾
        { type: "publish_closure", state: STATE, publishClosure: { blocked: false } },
      ]),
      {}
    );
    expect(
      out,
      "断流被包成了结果——攒到一半的 state 会被当作本轮终态"
    ).toBeNull();
  });

  it("反向：断流要报出名字，不是静静返回 null", async () => {
    const seen: string[] = [];
    await consumeDriveStreamResponse(
      sse([{ type: "publish_closure", state: STATE }]),
      { onStreamNoTerminal: (code: string) => seen.push(code) }
    );
    expect(seen).toEqual([STREAM_NO_TERMINAL]);
  });

  it("正向：正常收尾不许误报 no-terminal", async () => {
    const seen: string[] = [];
    await consumeDriveStreamResponse(
      sse([{ type: "complete", state: STATE }]),
      { onStreamNoTerminal: (code: string) => seen.push(code) }
    );
    expect(seen).toEqual([]);
  });
});

describe("控制面流：同一条纪律（成对改，不许只改一半）", () => {
  it("正向：control_text + complete 照常返回", async () => {
    const out = await consumeControlStreamResponse(
      sse([
        { type: "control_text", text: "你好" },
        { type: "complete", state: STATE },
      ]),
      {}
    );
    expect(out?.finalState?.sessionId).toBe("s1");
  });

  it("反向：便宜轮说到一半断了 → 不返回结果、报名字", async () => {
    const seen: string[] = [];
    const out = await consumeControlStreamResponse(
      sse([
        { type: "control_text", text: "你好" },
        { type: "publish_closure", state: STATE },
      ]),
      { onStreamNoTerminal: (code: string) => seen.push(code) }
    );
    expect(out).toBeNull();
    expect(seen).toEqual([STREAM_NO_TERMINAL]);
  });

  it("反向：handoff 之后工厂段断了，同样不算收尾", async () => {
    const out = await consumeControlStreamResponse(
      sse([
        { type: "control_handoff_factory", runId: "run-1" },
        { type: "skill_start", capabilityId: "spec_tree" },
        { type: "publish_closure", state: STATE },
      ]),
      {}
    );
    expect(out).toBeNull();
  });
});

describe("classifyStreamFallback：gotResult 不再单独决定 settled", () => {
  const base = {
    resuming: false,
    sawRunId: true,
    gotResult: false,
    settledReason: null as "complete" | "cancelled" | "error" | null,
    locallyAborted: false,
  };

  it("反向：拿到结果但没见终局 → 不许判 settled", () => {
    expect(
      classifyStreamFallback({ ...base, gotResult: true, sawTerminal: false }),
      "断流攒出的半截结果被判成已收尾——两道双开守卫在这一行上游就被绕过了"
    ).not.toBe("settled");
  });

  it("正向：拿到结果且见过终局 → settled", () => {
    expect(
      classifyStreamFallback({ ...base, gotResult: true, sawTerminal: true })
    ).toBe("settled");
  });

  it("正向：本地主动停止仍是 settled（用户点了停止，不是断线）", () => {
    expect(
      classifyStreamFallback({ ...base, locallyAborted: true, sawTerminal: false })
    ).toBe("settled");
  });

  it("正向：服务端宣布过终局仍是 settled", () => {
    expect(
      classifyStreamFallback({ ...base, settledReason: "cancelled", sawTerminal: false })
    ).toBe("settled");
  });

  it("兼容：没传 sawTerminal 的老调用点保持原语义（不许悄悄变严）", () => {
    expect(classifyStreamFallback({ ...base, gotResult: true })).toBe("settled");
  });
});

/**
 * 通电：光有 STREAM_NO_TERMINAL 和 sawTerminal 参数不算数。
 *
 * `sawTerminal` 省略时按 true 处理（兼容老调用点），所以**产品调用点不传
 * false 这条修复就是零效果** —— 本仓第一条：装在不通电的插座上。
 * 这几条钉住那根线真的接上了。
 *
 * 变异：把 useSlideRuleSession 里 onStreamNoTerminal 那行删掉 → 必红。
 */
describe("通电：产品路径真的把 no-terminal 传下去了", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const SESSION = strip(
    readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
  );

  it("runTurn 订阅了 onStreamNoTerminal", () => {
    expect(SESSION).toContain("onStreamNoTerminal");
  });

  it("classifyStreamFallback 调用点显式传了 sawTerminal", () => {
    const at = SESSION.indexOf("classifyStreamFallback({");
    expect(at, "找不到 classifyStreamFallback 调用点").toBeGreaterThan(-1);
    const call = SESSION.slice(at, at + 420);
    expect(
      call,
      "调用点没传 sawTerminal —— 默认 true 会让这条修复完全不生效"
    ).toContain("sawTerminal");
  });

  it("传下去的是运行期实际观测，不是写死的字面量", () => {
    const at = SESSION.indexOf("classifyStreamFallback({");
    const call = SESSION.slice(at, at + 420);
    expect(/sawTerminal:\s*(true|false)\s*[,}]/.test(call)).toBe(false);
  });
});
