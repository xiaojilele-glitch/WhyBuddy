// @vitest-environment jsdom
/**
 * 下一步建议的脸：2026-09-19 对照 Manus。
 *
 * 白底描边行叠三条 = 一张白卡。Manus 是空圈 + 整句 + 箭头，贴在对话底上。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextStepSuggestions } from "../NextStepSuggestions";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("对照 Manus：透明底，不要白卡", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("行上没有白底和描边，聊天图标和箭头都在", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onPick = vi.fn();
    await act(async () => {
      root!.render(
        <NextStepSuggestions
          state={{
            controlTodo: [
              { id: "1", status: "pending", content: "初始化 React + Vite 项目并配置像素级画布与基础架构" },
              { id: "2", status: "pending", content: "开发 8-bit Web Audio 程序化音效合成器" },
            ],
          }}
          onPick={onPick}
        />
      );
    });
    const rows = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="next-step-suggestion"]'
      ),
    ];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className, "行上不许再铺白底").not.toMatch(/bg-white/);
      expect(row.className, "行上不许再描边，描了就是卡").not.toMatch(
        /border-\[#ececee\]/
      );
      expect(row.className).not.toMatch(/rounded-xl border/);
      expect(
        row.querySelector("svg.lucide-message-square"),
        "左边是聊天信息图标"
      ).not.toBeNull();
      expect(row.querySelector("svg.lucide-circle-arrow-right")).toBeNull();
      expect(row.querySelector('img[src="/brand/miantuan-mark.png"]')).toBeNull();
    }
    expect(
      container.querySelector("svg.lucide-arrow-right"),
      "对照 Manus：右侧有箭头"
    ).not.toBeNull();
    await act(async () => rows[0]!.click());
    expect(onPick).toHaveBeenCalledWith(
      "初始化 React + Vite 项目并配置像素级画布与基础架构"
    );
  });
});
