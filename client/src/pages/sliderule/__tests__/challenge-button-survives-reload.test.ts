import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveLatestTurnFromState, deriveTurnsFromState } from "../derive-persisted-turn";

/**
 * M5 / 验收 C：「质疑」按钮刷新后还得在。
 *
 * ⚠ 2026-08-27 审查真机逮到：产品面 window.prompt 已删、预填已实现、PR-1 的
 *   单测全绿——但用户根本点不到这个按钮。两个真实会话的 DOM 实测：
 *     sliderule-rerun-turn      6   ← 同一块 JSX，渲染了
 *     sliderule-repair-gaps     1   ← 同一块 JSX，渲染了
 *     sliderule-challenge-turn  0   ← 没有
 *     全页 innerHTML 含「质疑」      false
 *   差别只在守卫：那两个看 `turn.user`，质疑看 `turn.main`（SlideRule.tsx:195/654）。
 *   而 derive-persisted-turn 重建轮次时把 `main` 写死成 null，于是质疑入口只在
 *   「当场生成那一轮的那个标签页」存在，刷新或重开会话就消失。
 *
 * PR-1 的判据全是源码级 grep（"challengeTurn 里没有 window.prompt"），
 * 一条都没落在重建出来的轮次上，所以全绿——这就是本仓第一条和第三条：
 * 装在不通电的插座上 / 名单里有名字 ≠ 埋点在。
 *
 * 判据落在 `turn.main`（按钮的渲染守卫本身），不是落在源码里有没有那个字符串。
 * 变异检查：把 derive-persisted-turn 里的 main 改回 `main: null`，本文件必须红。
 */

/** 一轮真实形状：capabilityRuns.outputs 指向 artifacts，artifacts 自己不带 turnId。 */
function seededState(): V5SessionState {
  return {
    goal: { text: "连锁宠物医院管理系统", status: "clear" },
    runtimePhase: "done",
    lastTurnId: "turn-1-drive-full",
    artifacts: [
      {
        id: "art-1-evidence.search",
        kind: "evidence",
        content: "证据",
        trustLevel: "gated_pass",
        provenance: "web:search",
        producedBy: { capabilityId: "evidence.search", roleId: "接地" },
      },
      {
        id: "art-1-report.write",
        kind: "report",
        content: "报告正文",
        trustLevel: "gated_pass",
        provenance: "llm",
        producedBy: { capabilityId: "report.write", roleId: "综合" },
      },
    ],
    capabilityRuns: [
      {
        id: "r0",
        capabilityId: "evidence.search",
        roleId: "接地",
        turnId: "turn-1-drive-full",
        outputs: ["art-1-evidence.search"],
        gateResults: [{ status: "passed" }],
      },
      {
        id: "r1",
        capabilityId: "report.write",
        roleId: "综合",
        turnId: "turn-1-drive-full",
        outputs: ["art-1-report.write"],
        gateResults: [{ status: "passed" }],
      },
    ],
    decisionLedger: [
      { id: "d1", turnId: "turn-1-drive-full", source: "llm", chose: ["evidence.search", "report.write"] },
    ],
  } as unknown as V5SessionState;
}

describe("M5：刷新后重建的轮次必须带 main（否则质疑按钮不渲染）", () => {
  it("deriveLatestTurnFromState 重建出的轮次 main 非空", () => {
    const turn = deriveLatestTurnFromState(seededState());
    expect(turn).toBeTruthy();
    expect(
      turn!.main,
      "main 为 null → SlideRule.tsx 的 `{turn.main && …质疑本轮}` 整块不渲染，" +
        "用户刷新后就再也点不到质疑"
    ).toBeTruthy();
    expect(turn!.main!.artifactId).toBeTruthy();
  });

  it("main 按 MAIN_ARTIFACT_KIND_PRIORITY 选，report 优先于 evidence", () => {
    const turn = deriveLatestTurnFromState(seededState());
    // report 在优先级表第 0 位，evidence 在第 8 位——不能随便挑一个
    expect(turn!.main!.artifactId).toBe("art-1-report.write");
    expect(turn!.main!.kind).toBe("report");
  });

  it("realLlm 沿用与实时轮同一条判定（provenance=llm → true）", () => {
    const turn = deriveLatestTurnFromState(seededState());
    expect(turn!.main!.realLlm).toBe(true);
  });

  it("整段对话重建（deriveTurnsFromState）里，有产物的那轮也带 main", () => {
    const turns = deriveTurnsFromState(seededState());
    expect(turns.length).toBeGreaterThan(0);
    expect(
      turns.some(t => Boolean(t.main)),
      "刷新后整段对话重建也必须至少有一轮可质疑"
    ).toBe(true);
  });

  it("反向：这一轮没有任何产物时 main 仍是 null，不许硬塞", () => {
    const bare = {
      lastTurnId: "turn-9",
      artifacts: [],
      capabilityRuns: [{ id: "r", capabilityId: "intent.parse", turnId: "turn-9", outputs: [] }],
      decisionLedger: [{ id: "d", turnId: "turn-9", source: "llm" }],
    } as unknown as V5SessionState;
    expect(deriveLatestTurnFromState(bare)!.main).toBeNull();
  });
});
