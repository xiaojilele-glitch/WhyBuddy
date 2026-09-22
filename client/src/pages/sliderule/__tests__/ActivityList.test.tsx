import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityList } from "../ActivityList";
import { deriveStageBands } from "../stage-authority";
import type { TurnStep } from "../types";

const STEPS = [
  "指令已接收 · 启动推理",
  "第 1 轮 · 正在澄清需求",
  "⚙ 数据模型 系统画面生成中...",
  "✓ 数据模型 证据落地 · LLM 生成",
];

function narrSteps(texts: string[]): TurnStep[] {
  return texts.map((text, i) => ({
    id: `s${i}`,
    kind: "narration",
    text,
    source: "fallback",
  }));
}

describe("ActivityList", () => {
  it("完成态是一行缩略，展开后是整齐活动行，不是装饰日志", () => {
    const groups = deriveStageBands({
      steps: narrSteps(STEPS),
      streaming: false,
    });
    const html = renderToStaticMarkup(
      <ActivityList
        groups={groups}
        streaming={false}
        header="4 步 · 12s"
        closureMeta="6/6"
      />
    );
    expect(html).toContain('data-testid="sliderule-turn-steps-toggle"');
    expect(html).toContain("4 步 · 12s");
    expect(html).toContain("6/6");
    expect(html).not.toContain("推演过程");
    expect(html).not.toContain("Brain");
    expect(html).not.toContain('data-testid="sliderule-activity-row"');
    expect(html).not.toContain("系统画面生成中");
    expect(html).not.toContain("指令已接收");
  });

  it("流式时直接铺活动行，并标出闸 / 规则选 / 配方", () => {
    const groups = deriveStageBands({
      steps: narrSteps(STEPS),
      streaming: true,
    });
    const html = renderToStaticMarkup(
      <ActivityList groups={groups} streaming header="4 步" />
    );
    expect(html).toContain('data-testid="sliderule-activity-row"');
    expect(html).toContain("生成画面");
    expect(html).toContain("数据模型");
    expect(html).toContain("澄清需求");
    expect(html).toContain("接收意图");
    expect(html).toContain("规则选");
    expect(html).toContain("配方");
    expect(html).toContain('data-authority="agent"');
    expect(html).toContain('data-authority="recipe"');
    expect(html).not.toContain("系统画面生成中");
    expect(html).not.toContain("正在澄清需求");
    expect(html).not.toContain("指令已接收");
    expect(html).not.toContain('data-testid="sliderule-turn-steps-toggle"');
  });

  /**
   * ⚠ 2026-09-05 重写。这条判据原本要的是**已经删掉的设计**：
   *   一上来铺一份 7 格 pending 骨架（`RECIPE_CORE` 翻译表），没走到的步骤
   *   先灰着。那份骨架在 2026-09-02 `7afc6a9`「控制面 WRITE 交回 host：
   *   开始推演只点火 spec，一跳一件」里被**有意删掉**了，注释写着
   *   「配方步只认事件上的 specfirst.* id，查表翻译已删」。
   *
   *   代码改了、判据没跟着改，于是它红了三天没人管——而**一条长期红着的
   *   判据比没有更坏**：它训练所有人把红当背景色。
   *
   *   现在按 09-02 那个决定重写：配方轨只认事件上真到过的 specfirst.*，
   *   一格都不发明。反向那半（正文块不进阶段名单）是原判据里对的部分，留着。
   */
  it("配方轨只认真到过的 specfirst.*，不发明 pending 骨架", () => {
    const groups = deriveStageBands({
      steps: [
        {
          id: "s1",
          kind: "chip",
          capabilityId: "intent.parse",
          roleId: "system",
          label: "第 1 轮 · 正在澄清需求",
          realLlm: false,
        },
        {
          id: "s2",
          kind: "chip",
          capabilityId: "intent.parse",
          roleId: "system",
          label: "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
          realLlm: true,
        },
      ],
      streaming: true,
      planSource: "llm",
    });
    const html = renderToStaticMarkup(
      <ActivityList groups={groups} streaming header="2 步" />
    );
    expect(html).toContain("Agent 选");
    expect(html).toContain("起草规格");
    // ★ 没到过的步骤不许凭空出现：没有 pending 骨架，也没有 bind 那一格。
    expect(html).not.toContain('data-status="pending"');
    expect(html).not.toContain('data-stage-id="specfirst.bind"');
    expect(html).not.toContain("接上数据");
    // 正文块（chip 的人话）不进阶段名单——这半是原判据里对的部分。
    expect(html).not.toContain("正在澄清需求");
  });
});
