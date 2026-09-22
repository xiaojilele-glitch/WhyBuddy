/**
 * 推演中补的话：排队、可撤、按 grok 的规则合并。
 *
 * 真机实测的老形态（2026-08-27）：推演中点发送，输入框清空、**整页搜不到这
 * 句话**、几分钟后它自己发出去。机制是通的，人是懵的。而且旧写法是覆盖——
 * 连补两句，第一句被悄悄顶掉。
 *
 * 2026-09-09 照 grok `xai-prompt-queue/src/combine.rs` 重写合并规则：
 *   · `is_synthetic` —— 系统自己生成的回执**永不参与合并**
 *   · `combine_prefix_len` —— 只合并**开头连续可合并的一段**，剩下的留队列
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  canMergeFront,
  combinePrefix,
  enqueueTurn,
  removeQueued,
  type QueuedTurn,
} from "../midrun-queue";

/** 用户打的那种条目。 */
const q = (...texts: string[]): QueuedTurn[] => texts.map(text => ({ text }));
/** 系统生成的那种。 */
const syn = (text: string): QueuedTurn => ({ text, synthetic: true });

describe("enqueueTurn", () => {
  it("累积，不覆盖", () => {
    const a = enqueueTurn([], "登录页改成工号");
    const b = enqueueTurn(a, "预约列表加改期按钮");
    expect(b).toEqual(q("登录页改成工号", "预约列表加改期按钮"));
  });

  it("反向：空白不入队（点了发送但没打字）", () => {
    expect(enqueueTurn([], "   ")).toEqual([]);
    expect(enqueueTurn(q("x"), "")).toEqual(q("x"));
  });

  it("反向：跟上一条一模一样不重复入队（连点两下发送）", () => {
    expect(enqueueTurn(q("改成工号"), "改成工号")).toEqual(q("改成工号"));
    // 但隔了一条之后再说同样的话是有效的（用户在强调）
    expect(enqueueTurn(q("改成工号", "别的"), "改成工号")).toEqual(
      q("改成工号", "别的", "改成工号")
    );
  });

  it("同一句话、一条是用户打的一条是系统生成的，不算重复", () => {
    /* 两者语义不同（一个是需求，一个是回执），去重把系统那条吞掉会让
       forcedTool 那一发丢掉它的载体。 */
    const out = enqueueTurn(q("继续"), "继续", { synthetic: true });
    expect(out).toEqual([{ text: "继续" }, syn("继续")]);
  });

  it("不改原数组（React state 必须换引用才重渲染）", () => {
    const src = q("a");
    const out = enqueueTurn(src, "b");
    expect(src).toEqual(q("a"));
    expect(out).not.toBe(src);
  });
});

describe("removeQueued", () => {
  it("撤掉指定那条", () => {
    expect(removeQueued(q("a", "b", "c"), 1)).toEqual(q("a", "c"));
  });

  it("反向：越界/脏下标原样返回，不抛", () => {
    expect(removeQueued(q("a"), 5)).toEqual(q("a"));
    expect(removeQueued(q("a"), -1)).toEqual(q("a"));
    expect(removeQueued(q("a"), 1.5 as number)).toEqual(q("a"));
  });
});

describe("combinePrefix（抄 grok combine_prefix_len）", () => {
  it("合成一条，不是逐条各发一轮", () => {
    const out = combinePrefix(q("登录页改工号", "加改期按钮"));
    expect(out.text).toBe("登录页改工号\n加改期按钮");
    expect(out.rest).toEqual([]);
  });

  it("反向：空队列合成空串（调用方据此不发）", () => {
    expect(combinePrefix([]).text).toBe("");
    expect(combinePrefix(q("  ", "")).text).toBe("");
  });

  it("**合成品不许跟用户的话粘一起**", () => {
    /* grok：`Synthetic / auto-wake origins never combine.`
       改造前用户排队的真需求会跟系统的「假设已确认。继续画页面。」合成一条，
       模型收到的是「登录页改成工号\n假设已确认。继续画页面。」——
       把系统的指令当成用户说的话。 */
    const out = combinePrefix([...q("登录页改成工号"), syn("假设已确认。继续画页面。")]);
    expect(out.text).toBe("登录页改成工号");
    expect(out.rest).toEqual([syn("假设已确认。继续画页面。")]);
  });

  it("合成品在队头就自己单独走一轮（grok: 头不能合就只取头）", () => {
    const out = combinePrefix([syn("假设已确认。继续画页面。"), ...q("再改个标题")]);
    expect(out.text).toBe("假设已确认。继续画页面。");
    expect(out.rest).toEqual(q("再改个标题"));
  });

  it("只合并**开头连续的**一段，后面的留着下一次", () => {
    const out = combinePrefix([...q("甲", "乙"), syn("回执"), ...q("丙")]);
    expect(out.text).toBe("甲\n乙");
    expect(out.rest).toEqual([syn("回执"), ...q("丙")]);
  });

  it("剩下的最终会被发出去（flush 挂在回合完成上，是个 drain 循环）", () => {
    let list: QueuedTurn[] = [...q("甲"), syn("回执"), ...q("乙")];
    const sent: string[] = [];
    for (let i = 0; i < 5 && list.length > 0; i += 1) {
      const out = combinePrefix(list);
      sent.push(out.text);
      list = out.rest;
    }
    expect(sent).toEqual(["甲", "回执", "乙"]);
    expect(list).toEqual([]);
  });

  it("canMergeFront：空文本和合成品都不能当头", () => {
    expect(canMergeFront({ text: "甲" })).toBe(true);
    expect(canMergeFront({ text: "  " })).toBe(false);
    expect(canMergeFront(syn("回执"))).toBe(false);
    expect(canMergeFront(undefined)).toBe(false);
  });

  it("分隔符仍是 \\n，没跟 grok 换成 \\n\\n", () => {
    /* ⚠ 换分隔符会改变模型看到的正文，而"哪种更好"没有真机数据支持。
       重构不许顺手改产品行为——要换是另一个决定，换的时候得跑真话题量。 */
    expect(combinePrefix(q("甲", "乙")).text).toBe("甲\n乙");
  });
});

describe("接线（三段都得接上）", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const SESSION = read("../useSlideRuleSession.ts");
  const DOCK = read("../ComposerDock.tsx");
  const PAGE = read("../../SlideRule.tsx");

  it("hook：入队用 enqueueTurn（累积），flush 用 combinePrefix（前缀合并）", () => {
    expect(SESSION).toContain("enqueueTurn(queuedTurnRef.current, text, opts)");
    expect(SESSION).toContain("combinePrefix(queuedTurnRef.current)");
    /* ⚠ 反向：老写法是**覆盖**，连补两句第一句被悄悄顶掉。
       这行回来 = 第二次无声丢失。 */
    expect(SESSION).not.toContain("queuedTurnRef.current = text;");
    /* ⚠ 反向：flush 之后不许无条件清空——那会把没合并的那几条丢掉。
       钉的是**解构本身的形状**，不是松散子串：第一版只查
       `queuedTurnRef.current = rest;`，而变异「另起一个空 rest」把那行
       原样留着照样绿。这里没法写成行为判据——本仓这两个队列测试都是源码
       断言，没有能驱动 hook 的运行时夹具；要加得先搭 renderHook 那一套。
       所以退而求其次：把 rest 的**来源**钉死在 combinePrefix 的返回值上。 */
    expect(SESSION).toContain("const { text, rest } = combinePrefix(");
    expect(SESSION).not.toMatch(/const rest[^=]*=\s*\[\]/);
  });

  it("**系统那条回执真的标了 synthetic**（不标 = 这次改造白做）", () => {
    expect(SESSION).toContain("{ text: human, synthetic: true, toolAnswer }");
    expect(SESSION).not.toContain("假设已确认。继续画页面。");
  });

  it("hook：队列导出去了，否则永远画不出来", () => {
    expect(SESSION).toContain("queuedTurns,");
    expect(SESSION).toContain("removeQueuedTurn,");
  });

  it("重置会话必须清队列（遗留的补充会劫持后来无关的一发）", () => {
    expect(SESSION).toContain("queuedTurnRef.current = [];");
  });

  it("输入条：画出来并且撤得掉", () => {
    expect(DOCK).toContain('data-testid="sliderule-queued-turns"');
    expect(DOCK).toContain('data-testid="sliderule-queued-remove"');
    expect(DOCK).toContain("本轮结束后发出");
  });

  it("页面：真的把队列传给了输入条（不传 = 组件永远收到空数组）", () => {
    expect(PAGE).toContain("queuedTurns={queuedTurns}");
    expect(PAGE).toContain("onRemoveQueued={removeQueuedTurn}");
  });
});
