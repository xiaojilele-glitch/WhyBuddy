/**
 * 质疑指向哪件产物、澄清卡答掉了哪几个缺口 —— **必须真的进 POST body**。
 *
 * 2026-08-27 评审逮到的断链是同一个形状：客户端 `challenge-composer` 认真
 * 解析出 `targetArtifactId`，`runTurn` 也收到了，就是**没进 body**；服务端
 * 于是三个 target 全空，失效级联整段跳过（staleArtifactIds 一个不加），
 * 而流里照样说「已按质疑失效相关产物」。澄清卡同理：`answeredGapIds` 拼好了
 * 没人发，服务端也没有第二条路径消费它。
 *
 * ⚠ 判据打在**真的 fetch body 上**，不是 grep 源码里有没有这个词。
 *   grep 版把字段名写进注释就能养绿（本仓踩过：判据里的标识符同时出现在
 *   文档字符串里，变异后照样绿）。
 *
 * ⚠ 每条正向都配一条反向：没有这两样时**不许**往 body 里塞空键。
 *   带 `targetArtifactId: undefined` 会被 JSON.stringify 丢掉看似无害，
 *   但带 `answeredGapIds: []` 会让服务端把"这次没答"当成"答了一批空的"。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { postControlTurnStream } from "../sliderule-marathon-driver";

const STATE = { sessionId: "s-1", goal: { text: "请假系统" } } as never;

/** 只回一个 complete，够 postControlTurnStream 走完。 */
function stubStreamFetch(): { body: () => Record<string, unknown> } {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      const chunk = `data: ${JSON.stringify({
        type: "complete",
        state: { sessionId: "s-1" },
      })}\n\n`;
      const bytes = new TextEncoder().encode(chunk);
      let done = false;
      return {
        ok: true,
        status: 200,
        clone: () => ({ json: async () => ({}) }),
        json: async () => ({}),
        body: {
          getReader: () => ({
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: bytes };
            },
          }),
        },
      };
    })
  );
  return { body: () => calls[calls.length - 1] ?? {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("控制面 POST 带上干预字段", () => {
  it("质疑：targetArtifactId 进 body", async () => {
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "这个结论依据不够", {
      forcedTool: "challenge",
      targetArtifactId: "art-1",
    });
    expect(stub.body().targetArtifactId).toBe("art-1");
    expect(stub.body().forcedTool).toBe("challenge");
  });

  it("澄清卡：answeredGapIds 进 body", async () => {
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "主管审批", {
      answeredGapIds: ["g1", "g2"],
    });
    expect(stub.body().answeredGapIds).toEqual(["g1", "g2"]);
  });

  it("反向：没有这两样时不许往 body 里塞空键", async () => {
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "随便聊一句", {});
    expect(Object.keys(stub.body())).not.toContain("targetArtifactId");
    expect(Object.keys(stub.body())).not.toContain("answeredGapIds");
  });

  it("澄清卡：answeredGaps 带着答案原文一起发", async () => {
    /* ⚠ 只发 id 的话服务端只能把缺口置 resolved——闸绿了，而生成侧一个字
       都没多知道（clarification_prompt_block 靠 gap.answer 取料）。
       澄清这条链 2026-08-27 之前就断在这儿：问了等于没问。 */
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "答完了", {
      answeredGapIds: ["g1"],
      answeredGaps: [{ gapId: "g1", answer: "要，挂号即缴费" }],
    });
    expect(stub.body().answeredGaps).toEqual([
      { gapId: "g1", answer: "要，挂号即缴费" },
    ]);
  });

  it("反向：空数组也不算答过（不许发一个空的 answeredGapIds）", async () => {
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "随便聊一句", { answeredGapIds: [] });
    expect(Object.keys(stub.body())).not.toContain("answeredGapIds");
    expect(Object.keys(stub.body())).not.toContain("answeredGaps");
  });

  it("六字段照旧齐全（加字段不许挤掉原有的）", async () => {
    const stub = stubStreamFetch();
    await postControlTurnStream(STATE, "x", { targetArtifactId: "art-1" });
    for (const key of [
      "sessionId",
      "userText",
      "installedSkills",
      "activeConnectors",
      "preferredDevice",
      "designSystemId",
    ]) {
      expect(Object.keys(stub.body())).toContain(key);
    }
  });
});
