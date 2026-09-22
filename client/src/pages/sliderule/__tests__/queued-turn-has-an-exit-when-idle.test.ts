/**
 * 排队的那句话必须有一条真走得到的出路。
 *
 * ## 事故（2026-08-28，截图那场）
 *
 * 推演跑完（51 步 · 220s，结论 closed）之后，用户点伴随式澄清卡上的
 * 「改成 X」。那句话 `pushQueuedTurn` 进了中途排队，面板上挂着一行
 * 「本轮结束后发出（1）」——**然后就永远挂在那儿**。
 *
 * 查 `flushQueuedControlTurn` 的全部五个调用点：
 *
 *     推演 finally ×2 / 关范围卡 / 先改范围 / 关提问
 *
 * 全是「某件事结束时」，**没有一处对应"空闲时排进来"**。而"本轮"早已结束，
 * 所以那句话等不到自己的发出时机。用户看到的是：点了，没反应，一行字挂着。
 *
 * ## 抄的标准答案：grok-build
 *
 * `xai-grok-pager/src/app/acp_handler/interactions.rs`
 *
 *     /// The pager does NOT respond immediately — the response is sent later
 *     /// when the user submits, cancels, or is replaced by another question.
 *     /// If a question is already active, the old one is cancelled first
 *     /// (`Cancelled` is sent on its stashed `response_tx`).
 *
 * 提问是张欠条：提交 / 取消 / 被新问题顶掉，**三条出路每条都把它兑现**，
 * 没有哪条路能让它悬着。队列同理——承诺了会发出去，就得有一条路真走得到。
 * 空闲时那条路定成了发送键（用户 2026-08-28 裁决：不自动开跑，不偷偷花钱）。
 *
 * ## 判据落在哪
 *
 * 「按钮亮了」不等于「话发得出去」（纪律三：函数写对了 ≠ 它被调用了）。
 * 所以除了纯函数判定，最后一条直接盯 `sendMessage` 的空输入分支有没有真的
 * 接上 flush——那是这条链唯一的出口。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isComposerSendBlocked,
  queuedTurnsHeading,
} from "../ComposerDock";

/** 截图那一刻的现场：跑完了、输入框空着、队列里压着一条。 */
const IDLE_WITH_QUEUE = {
  isRunning: false,
  input: "",
  attachments: [] as Array<{ extractStatus?: "pending" | "ready" | "failed" }>,
  queuedCount: 1,
};

describe("空闲时排进队列的那句话，得有出路", () => {
  it("跑完 + 空输入 + 队列有货 → 发送键可用（真机形态）", () => {
    expect(isComposerSendBlocked(IDLE_WITH_QUEUE)).toBe(false);
  });

  it("队列空着时空输入照旧灰 —— 别把这条一起放开了（反向判据）", () => {
    expect(
      isComposerSendBlocked({ ...IDLE_WITH_QUEUE, queuedCount: 0 })
    ).toBe(true);
    // 老调用点不传 queuedCount，行为必须跟从前一模一样
    const { queuedCount: _drop, ...withoutCount } = IDLE_WITH_QUEUE;
    expect(isComposerSendBlocked(withoutCount)).toBe(true);
  });

  it("推演中不放行：那时候队列本来就有出口（这一轮结束）", () => {
    expect(
      isComposerSendBlocked({ ...IDLE_WITH_QUEUE, isRunning: true })
    ).toBe(true);
  });

  it("停泊卡开着时仍然一律挡住 —— 队列不许绕过门禁", () => {
    expect(isComposerSendBlocked({ ...IDLE_WITH_QUEUE, askOpen: true })).toBe(
      true
    );
    expect(
      isComposerSendBlocked({ ...IDLE_WITH_QUEUE, isRefining: true })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        ...IDLE_WITH_QUEUE,
        attachments: [{ extractStatus: "pending" }],
      })
    ).toBe(true);
  });

  it("有正文时行为不变（这次改动不许碰正常发送）", () => {
    expect(
      isComposerSendBlocked({ ...IDLE_WITH_QUEUE, input: "改一下登录", queuedCount: 0 })
    ).toBe(false);
    expect(
      isComposerSendBlocked({
        ...IDLE_WITH_QUEUE,
        input: "改一下登录",
        isRunning: true,
        queuedCount: 0,
      })
    ).toBe(false);
  });
});

describe("抬头说的是这一刻真会发生的事", () => {
  it("跑完之后不许再说「本轮结束后发出」——本轮已经没有了", () => {
    expect(queuedTurnsHeading(1, true)).toContain("本轮结束后发出");
    const done = queuedTurnsHeading(1, false);
    expect(done).not.toContain("本轮结束后发出");
    expect(done).toContain("点发送");
  });



  it("两个抬头都得带上条数：光说状态不说几条等于没说", () => {
    expect(queuedTurnsHeading(2, true)).toContain("2");
    expect(queuedTurnsHeading(2, false)).toContain("2");
  });
});

describe("按钮亮了 ≠ 话发得出去", () => {
  /**
   * ⚠ 纪律三的反向判据。上面全绿而这一条红，就是「判定放行了，但空输入
   *   那条分支仍旧 `if (!text) return;` 直接走人」——用户点了发送，队列
   *   原地不动，跟修之前一模一样。
   */
  it("sendMessage 的空输入分支真的接上了 flushQueuedControlTurn", () => {
    const src = readFileSync(
      resolve(__dirname, "../useSlideRuleSession.ts"),
      "utf8"
    );
    // 先剥注释再找：本仓踩过"判据 grep 到的词其实在注释里"
    const code = src
      .split("\n")
      .filter(line => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    const at = code.indexOf("const sendMessage");
    expect(at).toBeGreaterThan(-1);
    // 空输入分支在 sendMessage 开头，只看紧跟着的那一小段
    const head = code.slice(at, at + 700);
    expect(head).toContain("flushQueuedControlTurn()");
    expect(head).toContain("queuedTurnRef.current.length > 0");
    // 且必须限定在"没在跑"：推演中空输入点发送不该把队列提前打出去
    expect(head).toContain("!isRunningRef.current");
  });
});
