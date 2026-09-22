/**
 * 刀 3 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * 后端 16 条判据全绿，但前端没有入口的话这一刀就是零——「后端能力齐了，
 * UI 上没有那颗按钮」正是计划文档里写的那个状态。这个文件钉住那颗按钮
 * 到底接没接上。
 *
 * ⚠ 判据先剥注释。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const STAGE = stripComments(
  readFileSync(resolve(__dirname, "../SpecPageCanvasStage.tsx"), "utf8")
);
const PANEL = stripComments(
  readFileSync(resolve(__dirname, "../CanvasBlockPanel.tsx"), "utf8")
);
const CLIENT = stripComments(
  readFileSync(
    resolve(__dirname, "../../../agent-loop/dashboard/app-store-client.ts"),
    "utf8"
  )
);

describe("「重写这一块」这条链路是通的", () => {
  it("网络层打的是 ai-edit-block（不是 ai-edit-element）", () => {
    expect(CLIENT).toContain("/ai-edit-block");
    expect(CLIENT).toContain("export async function aiEditBlock(");
  });

  it("整页 HTML 由调用方传上去（后端不自己读库）", () => {
    // 连改两块时第二次要带着第一次的改动；后端读库会把第一块的改动悄悄丢掉。
    expect(CLIENT).toMatch(/body:\s*JSON\.stringify\(\{\s*pageHtml,\s*blockName,\s*instruction\s*\}\)/);
  });

  it("舞台真的调了 aiEditBlock，并把它接到面板上", () => {
    expect(STAGE).toContain("aiEditBlock(");
    expect(STAGE).toContain("<CanvasBlockPanel");
    expect(STAGE).toMatch(/onRewrite=\{[\s\S]{0,120}rewriteBlock\(/);
  });

  it("块节点点得中（selectable:false 之后选择要自己接）", () => {
    expect(STAGE).toContain("ctx?.onPickBlock(box.pageId, box.name);");
  });

  it("面板上那颗按钮存在，且没有输入时是禁用的", () => {
    expect(PANEL).toContain('data-testid="sliderule-block-panel-rewrite"');
    expect(PANEL).toMatch(/disabled=\{!canEdit \|\| busy \|\| !instruction\.trim\(\)\}/);
  });
});

describe("⚠ 改完先预览，不直接落库", () => {
  it("面板拿到新页面只 onPreview，落库要用户点「保存这一页」", () => {
    // 重写一整块是最需要能反悔的操作。绕开"未保存可以放弃"这条纪律，
    // 用户就没有退路了。
    expect(PANEL).toMatch(/const html = await onRewrite\([\s\S]{0,120}onPreview\(html\)/);
    expect(PANEL).toContain('data-testid="sliderule-block-panel-save"');
    expect(PANEL).toMatch(/await onSave\(pending\)/);
  });

  it("舞台侧：onPreview 只更新画布，onSave 才走存库那条", () => {
    expect(STAGE).toMatch(/onPreview=\{html => onPagesReplaced\?\.\(/);
    expect(STAGE).toMatch(/onSave=\{html => applyElementEdit\(/);
  });

  it("反向：rewriteBlock 自己不许存库", () => {
    const i = STAGE.indexOf("const rewriteBlock = React.useCallback(");
    expect(i).toBeGreaterThan(-1);
    const bodySrc = STAGE.slice(i, STAGE.indexOf("const replaceAsset", i));
    expect(bodySrc).toContain("aiEditBlock(");
    expect(bodySrc).not.toContain("updateAppPage");
    expect(bodySrc).not.toContain("applyElementEdit");
  });
});

describe("反向判据", () => {
  it("没有 appId 时如实说原因，**不把按钮藏起来**", () => {
    // 藏起来用户只会觉得功能没了。
    expect(PANEL).toContain("这个会话还没存成应用");
    // 舞台侧：canEdit 跟着 appId 走（没存成应用就是真的改不了）
    expect(STAGE).toContain("canEdit={!!appId}");
  });

  it("闸打回的原话原样给用户看（fail-closed 要让人看见为什么被拦）", () => {
    expect(PANEL).toContain('data-testid="sliderule-block-panel-error"');
    expect(CLIENT).toMatch(/改块失败（HTTP \$\{res\.status\}）/);
  });

  it("孤岛块显示「无影响」，不是空着", () => {
    // 风险台账 #05。真机基线 15 块里有 7 块是纯视觉块。
    expect(PANEL).toContain("无影响（没有别的块跟它相关）");
    expect(PANEL).toContain("没接数据（纯视觉块）");
    expect(PANEL).toContain("impactedBy(");
  });

  it("同源字段那一段必须写明「改数据模型才一起变」", () => {
    // 不说清楚，用户会以为改一处自动同步了（风险台账 #03）。
    expect(PANEL).toContain("改数据模型才一起变");
  });

  it("降级成静态卡时如实说，不让用户以为内容就长那样", () => {
    expect(PANEL).toContain("已降级为静态卡");
  });

  it("元素面板和块面板不同时出现（挤在一起谁也看不清）", () => {
    expect(STAGE).toContain("{pickedBlock && !picked ? (");
  });
});
