import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_ID } from "@/lib/sliderule-session-id";
import { decideNewSessionAction, isBlankSessionMeta } from "../SidebarSessions";

/**
 * 用户报「点新建会话，右侧的显示有问题」。追下去两条独立的因：
 *  1. 舞台最大化后对话栏塌成 0%，新会话继承 → 打不了字
 *     （判据在 sliderule/__tests__/studio-layout.test.ts）。
 *  2. 新建会话**根本没新建**——本文件这条。
 *
 * 真机实测（1500×950，同一账号）：点「新建会话」后 DOM 里仍有
 * turnAnswers=3 / userBubbles=3，说明复用了上一条会话。
 *
 * E28 的空判据是 `!meta.goal`，而 PR-4 之后便宜轮刻意不写 goal（KD17）。
 * 变异：把 isBlankSessionMeta 里的 phase 判断删掉，本文件必须红。
 */
describe("isBlankSessionMeta（新建会话该复用谁）", () => {
  it("真正全新的会话可复用：goal 空 + phase=idle", () => {
    expect(isBlankSessionMeta({ goal: "", phase: "idle" })).toBe(true);
  });

  it("不在列表里（刚建未落盘）当作空", () => {
    expect(isBlankSessionMeta(undefined)).toBe(true);
    expect(isBlankSessionMeta(null)).toBe(true);
  });

  it("phase 缺失也当作空（老会话/降级读，别把人卡在建不了新会话）", () => {
    expect(isBlankSessionMeta({ goal: "" })).toBe(true);
    expect(isBlankSessionMeta({ goal: "", phase: null })).toBe(true);
  });

  it("关键反向：有便宜轮历史的会话不许被复用（goal 空但 phase=awaiting）", () => {
    expect(
      isBlankSessionMeta({ goal: "", phase: "awaiting" }),
      "问候/搜索/ask_user 都不写 goal——只看 goal 就会把用户丢回上一条会话"
    ).toBe(false);
  });

  it("反向：跑过工厂的会话不许被复用", () => {
    expect(isBlankSessionMeta({ goal: "", phase: "done" })).toBe(false);
    expect(isBlankSessionMeta({ goal: "", phase: "failed" })).toBe(false);
    expect(isBlankSessionMeta({ goal: "连锁宠物医院", phase: "idle" })).toBe(false);
  });

  it("当前这条空着 → 复用；聊过 / 默认 id → 铸新", () => {
    expect(
      decideNewSessionAction({
        activeId: "sr-idle",
        activeMeta: { goal: "", phase: "idle" },
      })
    ).toBe("reuse-active");
    expect(
      decideNewSessionAction({
        activeId: "sr-just-minted",
        activeMeta: undefined,
      }),
      "刚建未落盘：再点新建不许再铸一条"
    ).toBe("reuse-active");
    expect(
      decideNewSessionAction({
        activeId: "sr-cheap-turns",
        activeMeta: { goal: "", phase: "awaiting" },
      }),
      "问候/搜索之后 goal 仍空——必须铸新，不许复用"
    ).toBe("create");
    expect(
      decideNewSessionAction({
        activeId: "sr-done",
        activeMeta: { goal: "连锁宠物医院", phase: "idle" },
      })
    ).toBe("create");
    expect(
      decideNewSessionAction({
        activeId: DEFAULT_SESSION_ID,
        activeMeta: { goal: "", phase: "idle" },
      })
    ).toBe("create");
  });

  it("通电：按钮只复用当前空会话，不扫列表里别的空壳", () => {
    const src = readFileSync(
      new URL("../SidebarSessions.tsx", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const from = src.indexOf('data-testid="sidebar-session-new"');
    expect(from, "找不到新建会话按钮").toBeGreaterThan(-1);
    const to = src.indexOf("新建会话", from);
    expect(to, "找不到按钮文案收尾").toBeGreaterThan(from);
    const handler = src.slice(from, to);
    expect(handler).toContain("decideNewSessionAction");
    expect(handler).toContain("createSessionId");
    expect(handler).toContain("creatingSessionRef");
    expect(
      /isBlankSessionMeta\(\s*s\s*\)/.test(handler),
      "又在扫列表里别的空壳了——那会把聊过的会话当新建"
    ).toBe(false);
    expect(
      /\.find\(\s*\(?s\)?\s*=>\s*!s\.goal\s*\)/.test(handler),
      "还留着 `list.find(s => !s.goal)`：那条分支会挑中有便宜轮历史的会话"
    ).toBe(false);
  });
});
