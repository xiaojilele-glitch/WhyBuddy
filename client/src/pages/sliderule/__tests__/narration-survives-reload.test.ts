/**
 * 刷新之后，模型的开口和工程动作细节要还在。
 *
 * ## 修的是什么（2026-09-13）
 *
 * 前两件（模型开口走正文段落 / 工程动作流带真实细节）都只在**直播时**成立：
 * 刷新一下，开口整段消失、动作行退回没有信息量的样子。
 *
 * 数据其实一路都在：
 *   · 前端 `appendStep` 攒进 collectedSteps，轮末随 PUT 写进 turnNarrations
 *   · 落库瘦身两侧都是整对象透传（TS `slimStep` 的 `{...step}`、
 *     Python `_slim_step` 的 `dict(step)`）
 *   · schema 两侧都宽松（TS `steps: unknown[]`、Python `Dict[str, Any]`）
 *
 * **唯独 `narrationStepsFor` 的 KNOWN_KINDS 白名单没有 model_speech**，
 * 回放时被静静丢掉。§3 的教科书形态：正向齐全、反向缺失，不报错不告警。
 *
 * ## 判据怎么写
 *
 * ⚠ 跑**真实的落库 → 回放往返**（`stampTurnNarration` → `narrationStepsFor`），
 *   不自己拼一份 turnNarrations。自己拼的判据证明不了「真机那条路会不会丢」——
 *   这正是 §1.2 那条最贵的教训。
 */
import { describe, expect, it } from "vitest";
import { narrationStepsFor, stampTurnNarration } from "../turn-narration";
import { renderableModelSpeech } from "../model-speech";
import { deriveProjectActivity } from "../project-activity";
import type { TurnStep, UiTurn } from "../types";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

const SPEECH =
  "我会采用「浅蓝工作台 + 白色卡片 + 橙色优先级」作为视觉方向，接着初始化项目。";

const STEPS: TurnStep[] = [
  { id: "s1", kind: "model_speech", text: SPEECH },
  {
    id: "s2",
    kind: "chip",
    capabilityId: "project_exec" as never,
    roleId: "system",
    label: "正在执行工程命令",
    realLlm: false,
    progressType: "acting",
  },
  {
    id: "s3",
    kind: "chip",
    capabilityId: "project_exec" as never,
    roleId: "system",
    label: "已执行工程命令",
    realLlm: false,
    progressType: "completed",
    projectDetail: "pnpm run build",
  },
];

/** 走真实落库函数，拿到的就是真机 PUT 上去的那份形状。 */
function roundTrip(steps: TurnStep[]): TurnStep[] {
  const base = { sessionId: "s-1", turnNarrations: [] } as unknown as V5SessionState;
  const stored = stampTurnNarration(base, {
    turnId: "turn-1759000000000",
    user: "构建一个服务台",
    steps,
  });
  return narrationStepsFor(stored, "turn-1759000000000")?.steps ?? [];
}

function turnOf(steps: TurnStep[]): UiTurn {
  return {
    id: "turn-1759000000000",
    user: "构建一个服务台",
    status: "complete",
    steps,
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

describe("落库 → 回放 往返", () => {
  it("正向：模型开口活下来了", () => {
    const restored = roundTrip(STEPS);
    expect(restored.some(step => step.kind === "model_speech")).toBe(true);
    // 不止「对象还在」，还要真的能被正文取出来渲染。
    expect(renderableModelSpeech(turnOf(restored)).map(s => s.text)).toEqual([
      SPEECH,
    ]);
  });

  it("正向：工程动作的结构化细节活下来了", () => {
    const rows = deriveProjectActivity([turnOf(roundTrip(STEPS))]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tool: "project_exec",
      status: "done",
      detail: "pnpm run build",
    });
  });

  it("反向：白名单仍在干活——未知 kind 照样丢掉", () => {
    const restored = roundTrip([
      ...STEPS,
      { id: "x", kind: "totally_unknown", text: "垃圾" } as unknown as TurnStep,
    ]);
    expect(restored.some(step => String(step.kind) === "totally_unknown")).toBe(
      false
    );
  });

  it("反向：没有 id 的步骤照样丢掉（形状校验没被放松）", () => {
    const restored = roundTrip([
      { kind: "model_speech", text: "没有 id" } as unknown as TurnStep,
    ]);
    expect(restored.some(step => step.kind === "model_speech")).toBe(false);
  });
});
