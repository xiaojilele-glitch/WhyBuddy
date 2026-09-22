/**
 * 流断了之后该不该本地兜底（2026-08-10）。
 *
 * ## 起因：实测撞上的双开
 *
 * 一趟线上推演的首发 POST 流在第 2 分钟被对端重置
 * （`curl: (56) Recv failure: Connection reset by peer`），而服务端一路跑到
 * seq 1812 正常收尾、闭环 6/6 —— 断的只是观察通道。
 *
 * 当时前端的守卫条件是 `resumeRun && !result && !settled && !aborted`，
 * 开头就要求 resumeRun，也就是**只护住续播分支**。首发流断线时：
 *
 *     resumeRun          = 假   → 守卫跳过
 *     runSettledReason   = null（服务端好好的，没宣布终局）→ 第二道也跳过
 *     → 落进 SlideRuleRuntime.driveReasoningSession，整轮在浏览器里重跑
 *
 * 而那段代码自己的注释写着："绝不能落进本地引擎兜底——那会把整轮在前端
 * 重跑一遍，与后台 run 双开。"守卫是为续播写的，没延伸到首发。
 *
 * 正确判据是**后端 run 到底建起来没有**（onRunId 触发过没有），不是"这次是
 * 不是续播"。
 */

import { describe, it, expect } from "vitest";
import { classifyStreamFallback } from "@/lib/sliderule-marathon-driver";

const base = {
  resuming: false,
  sawRunId: false,
  gotResult: false,
  settledReason: null as "complete" | "cancelled" | "error" | null,
  locallyAborted: false,
};

describe("classifyStreamFallback", () => {
  it("首发流断线但 run 已建起来 → 报中断，不许本地重跑", () => {
    // 这条就是实测撞上的那一种；改之前它会走 local_fallback
    expect(classifyStreamFallback({ ...base, sawRunId: true })).toBe(
      "report_interrupted"
    );
  });

  it("续播流断线 → 报中断（原来就护住的那一种，别改坏）", () => {
    expect(classifyStreamFallback({ ...base, resuming: true })).toBe(
      "report_interrupted"
    );
  });

  it("连 run 都没建起来 → 本地兜底是正当降级", () => {
    // Python 后端没起 / 直接 500：这条路必须留着，否则用户什么都得不到
    expect(classifyStreamFallback(base)).toBe("local_fallback");
  });

  it("拿回结果了就没这回事", () => {
    for (const extra of [{}, { sawRunId: true }, { resuming: true }]) {
      expect(
        classifyStreamFallback({ ...base, ...extra, gotResult: true })
      ).toBe("settled");
    }
  });

  it("用户自己按了停止 → 不算中断", () => {
    expect(
      classifyStreamFallback({ ...base, sawRunId: true, locallyAborted: true })
    ).toBe("settled");
  });

  it("服务端宣布终局 → 不算中断", () => {
    for (const reason of ["complete", "cancelled", "error"] as const) {
      expect(
        classifyStreamFallback({ ...base, sawRunId: true, settledReason: reason })
      ).toBe("settled");
    }
  });

  it("本地中止优先于 sawRunId —— 用户按停止不该弹「连接中断」", () => {
    expect(
      classifyStreamFallback({
        ...base,
        resuming: true,
        sawRunId: true,
        locallyAborted: true,
      })
    ).toBe("settled");
  });

  it("穷举：只要 run 存在且未终局未中止，一律不落本地兜底", () => {
    for (const resuming of [true, false]) {
      for (const sawRunId of [true, false]) {
        const v = classifyStreamFallback({ ...base, resuming, sawRunId });
        const runExists = resuming || sawRunId;
        expect(v).toBe(runExists ? "report_interrupted" : "local_fallback");
      }
    }
  });
});
