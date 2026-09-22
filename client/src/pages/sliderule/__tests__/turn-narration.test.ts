/**
 * E13 直播时间线持久化：打戳/回放纯函数 + derive-persisted-turn 集成。
 * 回归目标：刷新后时间线从「1 阶段 0 步」恢复为完整回放。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  stampTurnNarration,
  narrationStepsFor,
  narrationTurnIdFor,
} from "../turn-narration";
import { deriveLatestTurnFromState } from "../derive-persisted-turn";
import type { TurnStep } from "../types";

const step = (id: string, text: string): TurnStep => ({
  id,
  kind: "narration",
  text,
  source: "llm",
});

const baseState = (extra: Partial<V5SessionState> = {}): V5SessionState =>
  ({
    sessionId: "s1",
    goal: { text: "宠物医院", status: "clear" },
    ...extra,
  }) as V5SessionState;

describe("stampTurnNarration", () => {
  it("打戳合并：同轮覆盖、只留最近 3 轮", () => {
    let state = baseState();
    for (const t of ["t1", "t2", "t3", "t4"]) {
      state = stampTurnNarration(state, {
        turnId: t,
        user: `问题 ${t}`,
        steps: [step(`${t}-s1`, `叙述 ${t}`)],
      });
    }
    expect(state.turnNarrations?.map(n => n.turnId)).toEqual(["t2", "t3", "t4"]);
    // 同轮重打覆盖而非追加
    state = stampTurnNarration(state, {
      turnId: "t4",
      steps: [step("t4-s1", "新叙述"), step("t4-s2", "第二步")],
    });
    const t4 = state.turnNarrations?.find(n => n.turnId === "t4");
    expect(t4?.steps).toHaveLength(2);
    expect(state.turnNarrations).toHaveLength(3);
  });

  it("空步骤不打戳；超长文本截断，**并记下原始长度**", () => {
    const untouched = baseState();
    expect(stampTurnNarration(untouched, { turnId: "t", steps: [] })).toBe(untouched);
    const stamped = stampTurnNarration(untouched, {
      turnId: "t",
      steps: [step("s", "长".repeat(5000))],
    });
    const saved = stamped.turnNarrations?.[0].steps[0] as {
      text: string;
      textChars?: number;
    };
    expect(saved.text.length).toBeLessThanOrEqual(1201);

    // ⚠ 2026-08-23 这条是本次的重点。截断后的长度**恒等于 1201**
    // （1200 上限 + 省略号），所以"数截断后的文本"会让每个超长步骤都显示同一
    // 个数——用户指着推演列表问"这些字数为啥都一样"就是这么来的。
    // 原始长度必须另存，且必须是真数，不是那个 1201。
    expect(saved.textChars).toBe(5000);
    expect(saved.textChars).not.toBe(saved.text.length);
  });

  it("**瘦身跑两遍，textChars 还是真原长**", () => {
    // 2026-08-23 真机翻车：字段加完、单测全绿，跑新话题一看库里是
    // `text=1201 textChars=1201`。这条路本来就跑两遍——这里一次，PUT 上去后
    // Python 的 cap_turn_narrations 再一次，那时 text 已经是 1201 仍然超限，
    // 不设防就把真原长覆盖成了 1201。只跑一遍的判据抓不到。
    const once = stampTurnNarration(baseState(), {
      turnId: "t",
      steps: [step("s", "长".repeat(5000))],
    });
    const first = once.turnNarrations![0].steps[0] as { text: string; textChars?: number };
    expect(first.textChars).toBe(5000);
    expect(first.text.length).toBe(1201);

    const twice = stampTurnNarration(baseState(), {
      turnId: "t",
      steps: [first as never],
    });
    const second = twice.turnNarrations![0].steps[0] as { text: string; textChars?: number };
    expect(second.textChars).toBe(5000);
  });

  it("没超上限的步骤不加 textChars——它的 text.length 本来就是真的", () => {
    // 反向：不加这条的话，把 textChars 写成"每步都记"也全绿，而那是白占字节
    // （这份投影本来就是为了封顶体积才存在的）。
    const stamped = stampTurnNarration(baseState(), {
      turnId: "t",
      steps: [step("s", "短文本")],
    });
    const saved = stamped.turnNarrations?.[0].steps[0] as Record<string, unknown>;
    expect(saved.text).toBe("短文本");
    expect("textChars" in saved).toBe(false);
  });
});

describe("narrationTurnIdFor", () => {
  it("认服务端已写的同原文 turnId，不另起时间戳", () => {
    const state = baseState({
      lastTurnId: "turn-8-drive-full",
      turnNarrations: [
        { turnId: "turn-7", user: "台账加预约排队人数", steps: [step("a", "x")] },
      ],
    });
    expect(
      narrationTurnIdFor(state, "台账加预约排队人数", "turn-1776000000000")
    ).toBe("turn-7");
  });

  it("同原文既有引擎 turn-1 又有时间戳时盖住 turn-1", () => {
    const USER = "给小区快递柜做一套取件码核销与超时滞留提醒系统";
    const state = baseState({
      lastTurnId: "turn-2-drive-full",
      turnNarrations: [
        { turnId: "turn-1", user: USER, steps: [step("a", "引擎")] },
        { turnId: "turn-1787051749500", user: USER, steps: [step("b", "直播")] },
      ],
    });
    expect(narrationTurnIdFor(state, USER, "turn-1787051749500")).toBe("turn-1");
  });

  it("叙述还没到时认版本史 turn-1，不把 -drive-full 或时间戳当新轮", () => {
    const USER = "给小区快递柜做一套取件码核销";
    // 不给 lastTurnId：删掉版本史回退的话会落到时间戳，这条必红
    expect(
      narrationTurnIdFor(
        baseState({
          modelVersions: [{ id: "mv-1", turnId: "turn-1", instruction: USER }],
        } as Partial<V5SessionState>),
        USER,
        "turn-1787051749500"
      )
    ).toBe("turn-1");
    // 反向：没有版本史时，收尾改名仍要折回 drive 开头那格
    expect(
      narrationTurnIdFor(
        baseState({ lastTurnId: "turn-2-drive-full" }),
        "新指令",
        "turn-client"
      )
    ).toBe("turn-1");
    expect(narrationTurnIdFor(baseState(), "新指令", "turn-client")).toBe(
      "turn-client"
    );
  });

  it("精修认本轮版本号，不许盖回首轮 turn-1", () => {
    const state = baseState({
      modelVersions: [
        { id: "mv-1", turnId: "turn-1", instruction: "首轮目标" },
        { id: "mv-2", turnId: "turn-3", instruction: "滞留件列表加一键催取" },
      ],
    } as Partial<V5SessionState>);
    expect(
      narrationTurnIdFor(state, "滞留件列表加一键催取", "turn-client")
    ).toBe("turn-3");
  });
});

describe("stampTurnNarration 同原文覆盖", () => {
  it("盖住引擎 turn-1 时丢掉时间戳那条，刷新只剩一轮", () => {
    const USER = "给小区快递柜做一套取件码核销";
    let state = baseState({
      turnNarrations: [
        { turnId: "turn-1", user: USER, steps: [step("srv", "引擎 24 步")] },
        {
          turnId: "turn-1787051749500",
          user: USER,
          steps: [step("live", "直播")],
        },
      ],
    });
    state = stampTurnNarration(state, {
      turnId: "turn-1",
      user: USER,
      steps: [step("a", "指令已接收"), step("b", "界面已出"), step("c", "闭环")],
    });
    expect(state.turnNarrations?.map(n => n.turnId)).toEqual(["turn-1"]);
    expect(state.turnNarrations?.[0].steps).toHaveLength(3);
    // 反向：若还按 turnId 追加，这里会是 2 条
    expect(state.turnNarrations).toHaveLength(1);
  });
});

describe("useSlideRuleSession 打戳接线", () => {
  it("成功/失败两处打戳都认服务端 turnId", () => {
    const src = readFileSync(
      new URL("../useSlideRuleSession.ts", import.meta.url),
      "utf8"
    );
    expect(src).toContain("narrationTurnIdFor(snap, userText, turnId)");
    expect(src).toContain("narrationTurnIdFor(final, userText, turnId)");
  });
});

describe("narrationStepsFor", () => {
  it("按 turnId 精确取；缺省取最新一轮；未知 kind 的脏数据被丢弃", () => {
    const state = baseState({
      turnNarrations: [
        { turnId: "t1", user: "u1", steps: [step("a", "第一轮")] },
        {
          turnId: "t2",
          user: "u2",
          steps: [
            step("b", "第二轮"),
            { id: "evil", kind: "hax", text: "注入" },
            "garbage",
            { kind: "narration", text: "缺 id" },
          ] as unknown[],
        },
      ],
    } as Partial<V5SessionState>);
    expect(narrationStepsFor(state, "t1")?.steps).toHaveLength(1);
    const latest = narrationStepsFor(state, null);
    expect(latest?.turnId).toBe("t2");
    expect(latest?.steps).toHaveLength(1); // 只有合法 narration 步幸存
    expect(narrationStepsFor(null)).toBeNull();
    expect(narrationStepsFor(baseState())).toBeNull();
  });
});

describe("deriveLatestTurnFromState + turnNarrations（刷新回放集成）", () => {
  const stateWithRun = (narr?: V5SessionState["turnNarrations"]) =>
    baseState({
      lastTurnId: "turn-99",
      capabilityRuns: [
        { capabilityId: "risk.analysis", roleId: "架构", turnId: "turn-99" },
      ] as never,
      turnNarrations: narr,
    } as Partial<V5SessionState>);

  it("有叙述：steps 完整回放 + user 恢复（不再是 0 步骨架）", () => {
    const turn = deriveLatestTurnFromState(
      stateWithRun([
        {
          turnId: "turn-99",
          user: "社区宠物医院预约问诊系统",
          steps: [step("s1", "第 1 轮 · 正在分析风险"), step("s2", "正在起草五系统模型")],
        },
      ])
    );
    expect(turn?.steps).toHaveLength(2);
    expect(turn?.user).toContain("宠物医院");
  });

  it("旧会话无叙述：回落骨架轮次（steps 空，不崩）", () => {
    const turn = deriveLatestTurnFromState(stateWithRun(undefined));
    expect(turn).not.toBeNull();
    expect(turn?.steps).toHaveLength(0);
  });
});
