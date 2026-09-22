/**
 * 澄清卡答完不许再弹一遍。
 *
 * ⚠ 2026-09-01 真机：三道题都选完了，「「…」答：…」已经进会话，卡又从
 * 「待回答问题 1/3 / 已答 0/3」弹出来。停泊那一发 isRunning 也要画卡；
 * 提交过的这一发不许再画。
 *
 * 变异：
 *   · pendingClarificationItems 不再看 submittedGapIds → 截图那条红
 *   · applyAnsweredGapsToState 不关 awaitReason → runTurn 灌回磁盘红
 *   · ClarificationCard useEffect 改回 [questions] → 同 id 新数组清 picks
 *   · pendingClarifications 不再调用 pendingClarificationItems → 活路径红
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clarificationQuestionKey,
  pendingClarificationItems,
} from "../ClarificationCard";
import { applyAnsweredGapsToState } from "../useSlideRuleSession";
import type { CoverageGap, V5SessionState } from "@shared/blueprint/v5-reasoning-state";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SESSION = stripComments(
  readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
);
const CARD = stripComments(
  readFileSync(new URL("../ClarificationCard.tsx", import.meta.url), "utf8")
);

const GAPS: CoverageGap[] = [
  {
    id: "gap-q-1",
    kind: "open_question",
    label: "这套分析器主要覆盖哪个市场？",
    status: "open",
    createdAt: "2026-09-01T00:00:00.000Z",
    options: ["A股（沪深北）", "美股"],
  },
  {
    id: "gap-q-2",
    kind: "open_question",
    label: "更像哪一类工具？",
    status: "open",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "gap-q-3",
    kind: "open_question",
    label: "主要在哪一端用？",
    status: "open",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("pendingClarificationItems", () => {
  it("停泊澄清时 isRunning 也要画出题（提问那一发）", () => {
    const items = pendingClarificationItems({
      gaps: GAPS,
      awaitReason: "control_clarify",
      isRunning: true,
    });
    expect(items.map(row => row.id)).toEqual(["gap-q-1", "gap-q-2", "gap-q-3"]);
    expect(items[0].prompt).toBe("这套分析器主要覆盖哪个市场？");
  });

  it("反向：推演中但不是停泊澄清，不画卡", () => {
    expect(
      pendingClarificationItems({
        gaps: GAPS,
        awaitReason: "control_scope",
        isRunning: true,
      })
    ).toEqual([]);
  });

  it("awaitReason 已空时，残留 open 缺口不许把卡粘在后面每一轮", () => {
    expect(
      pendingClarificationItems({
        gaps: GAPS,
        awaitReason: null,
        isRunning: false,
      })
    ).toEqual([]);
  });

  it("答完提交后的这一发：isRunning + 已交 id → 空（截图那条）", () => {
    expect(
      pendingClarificationItems({
        gaps: GAPS,
        awaitReason: "control_clarify",
        isRunning: true,
        submittedGapIds: ["gap-q-1", "gap-q-2", "gap-q-3"],
      })
    ).toEqual([]);
  });

  it("反向：跑完之后若还有 open 题，再画（别把卡整个关掉）", () => {
    const items = pendingClarificationItems({
      gaps: GAPS,
      awaitReason: "control_clarify",
      isRunning: false,
      submittedGapIds: ["gap-q-1"],
    });
    expect(items.map(row => row.id)).toEqual(["gap-q-1", "gap-q-2", "gap-q-3"]);
  });

  it("新一轮不同 id 仍要出现", () => {
    const items = pendingClarificationItems({
      gaps: [
        ...GAPS,
        {
          id: "gap-q-round2",
          kind: "open_question",
          label: "第二轮才问的",
          status: "open",
          createdAt: "2026-09-01T00:01:00.000Z",
        },
      ],
      awaitReason: "control_clarify",
      isRunning: false,
      submittedGapIds: ["gap-q-1", "gap-q-2", "gap-q-3"],
    });
    expect(items.some(row => row.id === "gap-q-round2")).toBe(true);
  });
});

describe("applyAnsweredGapsToState", () => {
  const state = {
    coverageGaps: GAPS,
    awaitReason: "control_clarify",
    awaitDetail: "这套分析器主要覆盖哪个市场？",
  } as V5SessionState;

  it("把答过的缺口关上并清掉 control_clarify，磁盘灌回才不会把卡弹回来", () => {
    const next = applyAnsweredGapsToState(state, {
      answeredGapIds: ["gap-q-1", "gap-q-2", "gap-q-3"],
      answeredGaps: [
        { gapId: "gap-q-1", answer: "A股（沪深北）" },
        { gapId: "gap-q-2", answer: "AI 投研助手" },
        { gapId: "gap-q-3", answer: "Web 桌面端" },
      ],
    });
    expect(next.coverageGaps?.every(g => g.status === "resolved")).toBe(true);
    expect(next.coverageGaps?.[0].answer).toBe("A股（沪深北）");
    expect(next.awaitReason).toBeUndefined();
  });

  it("反向：没带 answeredGapIds 原样返回（提问那一发不许误关）", () => {
    const next = applyAnsweredGapsToState(state, { intent: "clarify" });
    expect(next).toBe(state);
    expect(next.awaitReason).toBe("control_clarify");
  });
});

describe("活路径接上了，不是只测 helper", () => {
  it("pendingClarifications 调用 pendingClarificationItems，并传入 submittedClarifyIds", () => {
    const pendingFn = SESSION.slice(
      SESSION.indexOf("const pendingClarifications"),
      SESSION.indexOf("const generateDeliverables")
    );
    expect(pendingFn).toContain("pendingClarificationItems(");
    expect(pendingFn).toContain("submittedGapIds: submittedClarifyIds");
  });

  it("runTurn 在 applyPersistedState 之前走 applyAnsweredGapsToState", () => {
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    const applied = runTurn.indexOf("applyAnsweredGapsToState");
    const persisted = runTurn.indexOf("applyPersistedState(preparedState)");
    expect(applied).toBeGreaterThan(0);
    expect(persisted).toBeGreaterThan(applied);
  });

  it("ClarificationCard 按 questionKey 播种，不按 questions 数组身份", () => {
    expect(CARD).toContain("clarificationQuestionKey(questions)");
    expect(CARD).toContain("[questionKey]");
    expect(CARD).not.toMatch(/\}, \[questions\]\);/);
  });

  it("同 id 的 key 稳定，换数组身份不变", () => {
    const a = GAPS.map(g => ({ id: g.id }));
    const b = GAPS.map(g => ({ id: g.id }));
    expect(a).not.toBe(b);
    expect(clarificationQuestionKey(a)).toBe(clarificationQuestionKey(b));
    expect(clarificationQuestionKey(a)).toBe("gap-q-1|gap-q-2|gap-q-3");
  });
});
