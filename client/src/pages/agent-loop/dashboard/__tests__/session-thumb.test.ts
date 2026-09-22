/**
 * 侧栏会话封面。
 *
 * ⚠ 2026-08-23 这份测试整体反转过：原来钉的是"有图贴图、没图**活渲染**"，
 *   后来钉"有图贴图、没图**首字母**"。2026-09-20 首字母在真机上一排「做」，
 *   没图改钉 lucide kind。活渲染那一档仍不许回来，理由见 session-thumb.tsx。
 *
 * 下面那条反向判据是本次的重点：**光有"贴图能贴上"是不够的**，把活渲染悄悄
 * 加回来它照样绿，而那 1.4 MB 就回来了，页面看起来还更"好看"——没人会报。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppStoreSummary } from "../app-store-client";
import { appPreviewUrl } from "../app-store-client";
import {
  SessionThumb,
  indexAppsBySession,
  sessionGoalTypeKind,
  sessionRowIconKind,
  sessionRowTitle,
  sessionUsesSheet,
  shortSessionGoal,
} from "../session-thumb";

function summary(partial: Partial<AppStoreSummary>): AppStoreSummary {
  return {
    id: "app-1",
    root_id: "root-1",
    parent_id: null,
    version: 1,
    session_id: "sr-1",
    goal: "做一个社区团购站",
    gate_passed: true,
    created_at: "2026-08-19",
    product_name: "安康随访通",
    theme_id: "azure",
    theme_label: "Azure",
    device: "desktop",
    landing_page_ref: "p1",
    entity_count: 4,
    page_count: 4,
    ...partial,
  };
}

/** 剥掉注释再看源码——本仓踩过：判据 grep 的词同时出现在文档字符串里，
 *  改回去照样绿（见 CLAUDE.md 第二条）。这个模块的头注里恰好写着
 *  `GET /sessions/{id}` 和 getApp，不剥就是假绿。 */
function sourceWithoutComments(): string {
  return readFileSync(new URL("../session-thumb.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("侧栏封面：只贴图", () => {
  it("按 session_id 建索引，后到的同会话不覆盖", () => {
    const map = indexAppsBySession([
      summary({ id: "a1", session_id: "s1", product_name: "先" }),
      summary({ id: "a2", session_id: "s1", product_name: "后" }),
      summary({ id: "a3", session_id: "", product_name: "无会话" }),
    ]);
    expect(map.get("s1")?.id).toBe("a1");
    expect(map.has("")).toBe(false);
  });

  it("有图才贴图", () => {
    expect(sessionUsesSheet(summary({ has_preview: true }))).toBe(true);
    expect(sessionUsesSheet(summary({ has_preview: false }))).toBe(false);
    expect(sessionUsesSheet(summary({}))).toBe(false);
    expect(sessionUsesSheet(null)).toBe(false);
    expect(appPreviewUrl("app-1", "shot.1")).toBe(
      "/api/sliderule/apps/app-1/preview?v=shot.1"
    );
  });

  it("行标题优先产品名，没有才用 goal", () => {
    expect(sessionRowTitle("做一个站", summary({ product_name: "安康随访通" }))).toBe(
      "安康随访通"
    );
    expect(sessionRowTitle("做一个站", summary({ product_name: "" }))).toBe("做一个站");
    expect(sessionRowTitle("", null)).toBe("新会话");
  });

  it("长意图收成短标题，名为引号里的名字优先", () => {
    expect(
      shortSessionGoal(
        "构建一个名为“TicketStream”的服务台 SaaS 界面。目的：管理支持工单"
      )
    ).toBe("TicketStream");
    expect(
      sessionRowTitle(
        "构建一个名为“TicketStream”的服务台 SaaS 界面。目的：管理支持工单",
        null
      )
    ).toBe("TicketStream");
    expect(
      shortSessionGoal("做一个很长很长的意图句子超过二十二个汉字就会被收掉尾巴")
    ).toMatch(/…$/);
    expect(
      sessionRowTitle(
        "做一个很长很长的意图句子超过二十二个汉字就会被收掉尾巴",
        summary({ product_name: "" })
      )
    ).not.toContain("就会被收掉尾巴");
  });

  it("有图 → 贴 <img>，URL 带版本位", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionThumb, {
        sessionId: "s1",
        title: "安康随访通",
        app: summary({ has_preview: true, preview_tag: "shot.42" }),
      })
    );
    expect(html).toContain('data-testid="sidebar-session-thumb-sheet"');
    expect(html).toContain("/api/sliderule/apps/app-1/preview?v=shot.42");
  });

  it("没图按 Manus 类型换图标，不取标题首字", () => {
    expect(sessionGoalTypeKind("做一个PC版的飞机大战射击游戏")).toBe("game");
    expect(sessionGoalTypeKind("做一个番茄钟网页：25 分钟倒计时")).toBe("web");
    expect(sessionGoalTypeKind("做一个待办事项系统")).toBe("list");
    expect(sessionGoalTypeKind("制作一份幻灯片")).toBe("slides");
    expect(sessionGoalTypeKind("创建设计稿")).toBe("design");
    expect(sessionRowIconKind("failed", null, "做一个游戏")).toBe("alert");
    expect(sessionRowIconKind("done", summary({ device: "phone" }))).toBe("phone");
    expect(sessionRowIconKind("done", summary({ device: "desktop" }))).toBe("app");
    expect(sessionRowIconKind("done", null)).toBe("file");

    const html = renderToStaticMarkup(
      React.createElement(SessionThumb, {
        sessionId: "s1",
        title: "做一个番茄钟网页",
        goal: "做一个番茄钟网页：25 分钟倒计时",
        app: summary({ has_preview: false }),
      })
    );
    expect(html).toContain("sidebar-session-thumb-icon");
    expect(html).toContain('data-icon="web"');
    expect(html).not.toContain("native-agent-session-thumb-letter");
    expect(html).not.toContain("做");
    expect(html).not.toContain("sidebar-session-thumb-sheet");
    expect(html).not.toContain("iframe");

    const listHtml = renderToStaticMarkup(
      React.createElement(SessionThumb, {
        sessionId: "s2",
        title: "做一个待办清单",
        goal: "做一个待办清单",
        app: null,
      })
    );
    expect(listHtml).toContain('data-icon="list"');
    expect(listHtml).not.toContain("做");
  });

  it("反向：不给番茄 / 坦克单独开一种，没类型词才回落文档", () => {
    expect(sessionGoalTypeKind("番茄")).toBeNull();
    expect(sessionGoalTypeKind("坦克")).toBeNull();
    expect(sessionRowIconKind("done", null, "番茄")).toBe("file");
    const src = sourceWithoutComments();
    expect(src).not.toMatch(/番茄钟["']\s*:\s*["']timer/);
    expect(src).not.toContain('"timer"');
  });

  it("**反向：侧栏不许再拉整包**（剥注释后源码里不该有这些）", () => {
    // 这条钉的是那 1.4 MB。把活渲染加回来时，上面几条正向判据全都照样绿——
    // 页面甚至更好看，所以没人会报。只有这一条会红。
    const src = sourceWithoutComments();
    expect(src).toContain("appPreviewUrl"); // 先确认判据没打空：贴图那条还在
    expect(src).toContain("sessionRowIconKind");
    expect(src).toContain("sessionGoalTypeKind");
    expect(src).not.toContain("native-agent-session-thumb-letter");
    expect(src).not.toContain("getApp"); // 整包：model_json + pages_json
    expect(src).not.toContain("/sessions/${"); // 完整会话状态，单条约 413 KB
    expect(src).not.toContain("HtmlAppSurface");
    expect(src).not.toContain("AppRuntimeScreen");
    expect(src).not.toContain("React.lazy");
  });
});
