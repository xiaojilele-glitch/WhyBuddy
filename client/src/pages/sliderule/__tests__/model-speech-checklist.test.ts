/**
 * 整份活儿清单一轮只留最新那一份。
 *
 * ## 这条判据来自真机测量（2026-09-14）
 *
 * 工程档跑完一轮，量渲染后的 DOM（§5：不量源码）：
 *
 *     sliderule-model-speech   437px
 *       ├ p  48px  「· 待办清单偏好：简洁清爽…」
 *       ├ p  24px  「先查看工程当前状态和源码，确认还差哪些补丁。」
 *       ├ p 143px  ● 创建工程 project_create … ◐ 确认运行就绪 …   ← 清单
 *       ├ p  48px  「运行已就绪。按计划把筛选改成顶部三段按钮…」
 *       └ p 143px  ● 创建工程 project_create … ● 确认运行就绪 …   ← 同一份清单
 *
 * 286px = 这块的 65%、整轮 799px 的 36%，全花在把同一份清单重印。
 * 起因在提示词：每轮都把渲染好的清单喂给模型（`rehearsal_control:2985`
 * 「你列的活儿清单（用户看得见）」），模型就在叙述里照抄。轮数越多印得越多。
 */
import { describe, expect, it } from "vitest";
import {
  isChecklistSnapshot,
  keepLatestChecklist,
  renderableModelSpeech,
} from "../model-speech";

const speech = (...texts: string[]) =>
  texts.map((text, i) => ({ kind: "model_speech" as const, id: `s${i}`, text }));
/** 真机那一份的形状。 */
const LIST_A = "● 创建工程 project_create (react-vite-tasks)\n◐ 确认运行就绪 project_status\n○ 按需补丁 UI/筛选/鉴权对齐";
const LIST_B = "● 创建工程 project_create (react-vite-tasks)\n● 确认运行就绪 project_status\n◐ 按需补丁 UI/筛选/鉴权对齐";

describe("认不认得出「这段是整份清单」", () => {
  it("正向：四种状态记号都认", () => {
    expect(isChecklistSnapshot("○ 甲\n◐ 乙\n● 丙\n✕ 丁")).toBe(true);
  });

  it("正向：只剩一条也算——模型真的会只重印剩下那条", () => {
    expect(isChecklistSnapshot("◐ 按需补丁 UI/筛选/鉴权对齐")).toBe(true);
  });

  it("正向：抄 grok 回喂带 id 的那一行也认（● t1: 文案）", () => {
    expect(isChecklistSnapshot("◐ t1: 初始化坦克大战工程\n○ t2: 写游戏循环")).toBe(
      true
    );
  });

  it("反向：夹了散文的不算（那是它在解释，不是在重印）", () => {
    expect(isChecklistSnapshot("先查看工程当前状态。\n● 创建工程")).toBe(false);
  });

  it("反向：普通散文、空串、光秃秃一个记号，都不算", () => {
    expect(isChecklistSnapshot("运行已就绪。按计划把筛选改成顶部三段按钮。")).toBe(false);
    expect(isChecklistSnapshot("")).toBe(false);
    expect(isChecklistSnapshot("   ")).toBe(false);
    expect(isChecklistSnapshot("●")).toBe(false);
  });
});

describe("一轮只留最新那一份", () => {
  it("⚠ 真机那一发：两份清单只剩后一份，散文一句不少、顺序不动", () => {
    const out = keepLatestChecklist(
      speech("· 待办清单偏好：简洁清爽", "先查看工程当前状态和源码。", LIST_A,
             "运行已就绪。按计划把筛选改成顶部三段按钮。", LIST_B)
    );
    expect(out.map(s => s.text)).toEqual([
      "· 待办清单偏好：简洁清爽",
      "先查看工程当前状态和源码。",
      "运行已就绪。按计划把筛选改成顶部三段按钮。",
      LIST_B,
    ]);
  });

  it("留的是**最后**那一份（当前状态），不是第一份", () => {
    const out = keepLatestChecklist(speech(LIST_A, LIST_B));
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(LIST_B);
  });

  it("反向：辅助函数不许一份都不剩——浮层读的是另一份，这里只证明还能认出", () => {
    expect(keepLatestChecklist(speech(LIST_A, LIST_B, LIST_A))).toHaveLength(1);
    expect(keepLatestChecklist(speech(LIST_A))).toHaveLength(1);
  });

  it("反向：一份清单都没有时，散文一条都不许被顺走", () => {
    const prose = speech("甲", "乙", "丙");
    expect(keepLatestChecklist(prose)).toEqual(prose);
  });

  it("⚠ 逐字去重咬不住这两份——状态记号变了，所以必须是另一条判据", () => {
    // 这条钉的是「为什么不能靠 dedupeAdjacentSpeech」。
    expect(LIST_A).not.toBe(LIST_B);
  });
});

describe("接在真跑的那条路上（§1）", () => {
  it("renderableModelSpeech 把清单从对话里拿掉，散文留下", () => {
    const turn = {
      steps: speech("先查看工程当前状态。", LIST_A, "运行已就绪。", LIST_B),
    } as never;
    const out = renderableModelSpeech(turn);
    expect(out.filter(s => isChecklistSnapshot(s.text))).toHaveLength(0);
    expect(out.map(s => s.text)).toEqual([
      "先查看工程当前状态。",
      "运行已就绪。",
    ]);
  });
});
