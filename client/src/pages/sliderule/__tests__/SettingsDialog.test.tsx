/**
 * 设置中心结构回归。
 *
 * 约定：renderToStaticMarkup（不跑 effect，不发真实请求）。
 * 2026-08-20：用户中心排第一且默认；推演通道留下；浏览器直连从导航撤掉。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDialog, SettingsPage, SystemPrefs } from "../SettingsDialog";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// SystemPrefs 的数据管理区读 localStorage — node 环境补一个最小 shim
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage;

describe("SettingsDialog（设置中心重构）", () => {
  it("导航：用户中心第一且默认 + 系统设置 + 推演通道；没有浏览器直连", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open onClose={() => {}} sessionId="s1" />
    );
    expect(html).toContain('data-testid="sliderule-settings-nav-account"');
    expect(html).toContain("用户中心");
    expect(html).toContain('data-testid="sliderule-settings-nav-channel"');
    expect(html).toContain('data-testid="sliderule-settings-nav-system"');
    expect(html).toContain("推演通道");
    expect(html).not.toContain('data-testid="sliderule-settings-nav-llm"');
    expect(html).not.toContain("浏览器直连");
    expect(html.indexOf("sliderule-settings-nav-account")).toBeLessThan(
      html.indexOf("sliderule-settings-nav-system")
    );
    expect(html.indexOf("sliderule-settings-nav-system")).toBeLessThan(
      html.indexOf("sliderule-settings-nav-channel")
    );
    expect(html).toContain('data-testid="sliderule-account-center"');
    expect(html).not.toContain('data-testid="sliderule-settings-user-prefs"');
    expect(html).not.toContain('data-testid="llm-channel-panel"');
  });

  it("SettingsPage 整页形态：无遮罩/关闭按钮，用户中心和推演通道在场", () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html).toContain('data-testid="sliderule-settings-page"');
    expect(html).toContain('data-testid="sliderule-settings-nav-account"');
    expect(html).toContain('data-testid="sliderule-settings-nav-channel"');
    expect(html).toContain('data-testid="sliderule-settings-nav-system"');
    expect(html).not.toContain('data-testid="sliderule-settings-nav-llm"');
    expect(html).not.toContain('data-testid="sliderule-settings-dialog"');
    expect(html).not.toContain('data-testid="sliderule-settings-close"');
  });

  it("默认分类不渲染底部「保存」", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open onClose={() => {}} sessionId="s1" />
    );
    expect(html).not.toContain('data-testid="sliderule-settings-save"');
  });

  it("关闭态不渲染任何内容", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open={false} onClose={() => {}} />
    );
    expect(html).toBe("");
  });

  it("用量统计分类在导航上（2026-08-14 加）", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open onClose={() => {}} sessionId="s1" />
    );
    expect(html).toContain('data-testid="sliderule-settings-nav-usage"');
    expect(html).toContain("用量统计");
  });

  it("系统设置：「偏好」三控件（减少动效/完成通知/Enter 行为）+ 隐私事实说明在场", () => {
    const html = renderToStaticMarkup(<SystemPrefs sessionId="s1" />);
    expect(html).toContain('data-testid="sliderule-settings-user-prefs"');
    expect(html).toContain("减少动态效果");
    expect(html).toContain("推演完成通知");
    expect(html).toContain("Enter 键行为");
    expect(html).toContain("Enter 发送");
    expect(html).toContain("Ctrl+Enter 发送");
    expect(html).toContain("Shift+Enter 始终换行；改动即时生效。");
    expect(html).toContain('data-testid="sliderule-settings-privacy-facts"');
    expect(html).toContain("你的数据存在哪里");
    expect(html).toContain("浏览器本机");
    expect(html).toContain("服务器环境变量");
    expect(html).not.toContain("浏览器直连");
  });

  it("用户中心活路径 PATCH /account/me，设置页不再挂浏览器直连面板", () => {
    const panel = stripComments(
      readFileSync(
        fileURLToPath(new URL("../AccountCenterPanel.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(panel).toContain("updateProfile");
    expect(panel).toContain("displayName");
    expect(panel).toContain("avatarUrl");
    expect(panel).toContain("sliderule-account-profile");
    expect(panel).toContain("SettingsRow");
    expect(panel).not.toContain("查看和修改您的账号信息");
    expect(panel).not.toContain("个人信息");
    const client = stripComments(
      readFileSync(
        fileURLToPath(new URL("../../../lib/auth-client.ts", import.meta.url)),
        "utf8"
      )
    );
    expect(client).toContain('method: "PATCH"');
    expect(client).toContain("/account/me");
    const settings = stripComments(
      readFileSync(
        fileURLToPath(new URL("../SettingsDialog.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(settings).toContain("AccountCenterPanel");
    expect(settings).not.toContain("LlmProviderSettings");
    expect(settings).not.toContain("浏览器直连");
  });

  it("Cursor 壳：搜索 + 中性选中，不要 Ant 蓝/套白卡片/antd Switch", () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html).toContain('data-testid="sliderule-settings-search"');
    expect(html).toContain("bg-black/[0.06]");
    expect(html).not.toContain("#1677ff");
    expect(html).not.toContain("e6f4ff");
    expect(html).not.toContain("shadow-[0_1px_8px");
    expect(html).toContain("max-w-[720px]");
    expect(html).toContain("用户中心");
    expect(html).not.toContain("查看和修改您的账号信息");

    const settings = stripComments(
      readFileSync(
        fileURLToPath(new URL("../SettingsDialog.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(settings).toContain('from "./settings-ui"');
    expect(settings).not.toContain('from "antd"');
    expect(settings).not.toContain("Switch");
    expect(settings).toContain("SettingsToggle");
    expect(settings).not.toContain("Cherry Studio");

    const channel = stripComments(
      readFileSync(
        fileURLToPath(new URL("../LlmChannelPanel.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(channel).toContain("SettingsRow");
    expect(channel).not.toContain("#1677ff");
    expect(channel).not.toContain("e6f4ff");
  });

  it("用量空态不把「没台账」说成「还没推演」，fetch 带 Cookie", () => {
    const settings = stripComments(
      readFileSync(
        fileURLToPath(new URL("../SettingsDialog.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(settings).toContain('credentials: "include"');
    expect(settings).toContain("/api/sliderule/usage");
    expect(settings).not.toContain("跑一轮推演之后");
    expect(settings).toContain("已经跑完的补不回来");
  });
});
