/**
 * 留档步骤显示的字数必须是**真字数**，不是截断后的长度。
 *
 * 现象（用户 2026-08-23）：推演步骤列表 12 步里 9 步整整齐齐写着「1201 字」。
 * 1201 不是字数，是 1200（落库瘦身上限）+ 1（省略号）——回放时 UI 直接数那份
 * 已经被截断的文本，于是所有超过 1200 字的步骤都显示同一个数。
 *
 * 两头都要钉：
 *   ① 传了真字数就用真字数；
 *   ② **绝不能再出现 1201** —— 只有 ① 的话，把 `chars ?? text.length` 写成
 *      `text.length` 照样绿（传进去的 chars 被忽略而已），而现象原封不动。
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LlmLiveOutput } from "../LlmLiveOutput";

/** 落库瘦身产出的形状：1200 个字 + 省略号 = 1201。 */
const TRUNCATED = "长".repeat(1200) + "…";

describe("留档步骤的字数", () => {
  it("传了 chars 就显示 chars（真字数）", () => {
    const html = renderToStaticMarkup(
      React.createElement(LlmLiveOutput, {
        title: "分析风险",
        text: TRUNCATED,
        chars: 8321,
        done: true,
      })
    );
    expect(html).toContain("8321 字");
  });

  it("**不许再出现 1201** —— 这就是用户报的那个数", () => {
    expect(TRUNCATED.length).toBe(1201); // 先确认夹具真是那个形状，判据没打空
    const html = renderToStaticMarkup(
      React.createElement(LlmLiveOutput, {
        title: "分析风险",
        text: TRUNCATED,
        chars: 8321,
        done: true,
      })
    );
    expect(html).not.toContain("1201 字");
  });

  it("直播态不传 chars：仍数 text 本身（那时它就是全文）", () => {
    const html = renderToStaticMarkup(
      React.createElement(LlmLiveOutput, { title: "起草规格", text: "一二三四五" })
    );
    expect(html).toContain("5 字");
  });

  it("轨迹默认折叠：摘要在、risk.analyze 原文不在 DOM", () => {
    const html = renderToStaticMarkup(
      React.createElement(LlmLiveOutput, {
        title: "正在分析风险",
        text: "这是 risk.analyze 不该默认露出的原文",
      })
    );
    expect(html).toContain('data-testid="sliderule-llm-draft-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="sliderule-llm-draft-body"');
    expect(html).not.toContain("这是 risk.analyze 不该默认露出的原文");
  });

  it("chars 为 0 时不被当成缺省吞掉", () => {
    // `chars || text.length` 会在 0 上回落到 text.length——用 ?? 才对。
    const html = renderToStaticMarkup(
      React.createElement(LlmLiveOutput, { title: "空输出", text: "", chars: 0 })
    );
    expect(html).toContain("0 字");
  });
});
