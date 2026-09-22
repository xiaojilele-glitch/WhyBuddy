/**
 * 澄清卡上不许印内部词表。
 *
 * ⚠ 2026-08-27 真机截图逮到的：卡片把 `kind` **原样**印在问题旁边，用户看到
 *   一个孤零零的 `users`，底下按钮还写着「批量 users」。那是维度键，是给
 *   代码看的。
 *
 * 反向条同样重要：认不出的键**不显示**，而不是显示一个兜底英文——宁可少一个
 * 标签，也不要在用户脸上糊一串看不懂的字。
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ClarificationCard, kindLabel } from "../ClarificationCard";

const Q = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  prompt: "这个诊所系统主要给谁用？",
  type: "single_choice" as const,
  options: ["医生与护士", "前台导诊"],
  ...over,
});

describe("kindLabel", () => {
  it("认识的维度翻成人话", () => {
    expect(kindLabel("users")).toBe("谁用");
    expect(kindLabel("audience")).toBe("谁用");
    expect(kindLabel("platform")).toBe("在哪用");
    expect(kindLabel("scope")).toBe("本期边界");
    expect(kindLabel("scenario")).toBe("核心流程");
  });

  it("反向：认不出的键返回空串（不显示，而不是显示英文）", () => {
    expect(kindLabel("blueprint-question-xyz")).toBe("");
    expect(kindLabel("")).toBe("");
    expect(kindLabel(undefined)).toBe("");
  });

  it("事件自带 kindLabel 压过本地表", () => {
    expect(kindLabel("users", "谁在用这套系统")).toBe("谁在用这套系统");
    expect(kindLabel("blueprint-question-xyz", "本期边界")).toBe("本期边界");
  });
});

describe("卡片渲染", () => {
  const render = (q: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ClarificationCard
        questions={[Q(q) as never]}
        onSubmit={() => {}}
        onClose={() => {}}
      />
    );

  it("显示的是人话标签，不是 kind 原文", () => {
    const html = render({ kind: "users", kindLabel: "谁用" });
    expect(html).toContain("谁用");
    // ⚠ 钉的是**标签里**没有 users。整页 grep "users" 会被 class 名之类误伤，
    //   所以取标签那个节点看。
    const tag = html.slice(html.indexOf('data-testid="sliderule-clarification-kind"'));
    expect(tag.slice(0, 120)).not.toContain("users");
  });

  it("反向：认不出的 kind 干脆不画这个标签", () => {
    const html = render({ kind: "blueprint-question-xyz" });
    expect(html).not.toContain('data-testid="sliderule-clarification-kind"');
    expect(html).not.toContain("blueprint-question-xyz");
  });

  it("问题、选项、说明照常渲染（别把功能一起改没）", () => {
    const html = render({ kind: "users", context: "决定权限怎么切" });
    expect(html).toContain("这个诊所系统主要给谁用？");
    expect(html).toContain("医生与护士");
    expect(html).toContain("决定权限怎么切");
  });

  it("卡面抄 Cursor 文件卡：近黑下一步，不是蓝问卷", () => {
    const html = render({ defaultAnswer: "医生与护士" });
    expect(html).toContain('data-clarification-surface="cursor"');
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("bg-[#171717]");
    expect(html).toContain("问题");
    expect(html).toContain("推荐");
    expect(html).not.toContain("#1677ff");
    expect(html).not.toContain("#EBCEC0");
    expect(html).not.toContain("待回答问题");
    expect(html).not.toContain("批量");
  });
});
