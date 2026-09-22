/**
 * 阶段权属。正向：Agent 选的和配方轨能拆开。
 * 反向：只看「第 N 轮」前缀会把配方吞进选材——那是真机 SSE 的样子。
 */
import { describe, expect, it } from "vitest";
import type { TurnStep } from "../types";
import {
  classifyStageLine,
  deriveStageBands,
  matchRecipeStage,
  pickBadge,
} from "../stage-authority";

function chip(label: string, capabilityId = "intent.parse"): TurnStep {
  return {
    id: label,
    kind: "chip",
    // 测试夹具：真机 marathon 会把人话 label 塞进这个字段。
    capabilityId: capabilityId as never,
    roleId: "system",
    label,
    realLlm: false,
  };
}

function narr(text: string): TurnStep {
  return { id: text, kind: "narration", text, source: "fallback" };
}

describe("stage-authority", () => {
  it("第 N 轮包着配方文案仍是配方，不能只看前缀", () => {
    const live = {
      text: "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
      capabilityId: "specfirst.spec",
    };
    expect(classifyStageLine(live)).toBe("recipe");
    expect(matchRecipeStage(live)).toBe("specfirst.spec");
    expect(
      classifyStageLine({ text: "第 1 轮 · 正在澄清需求", capabilityId: "intent.parse" })
    ).toBe("agent");
  });

  it("planSource=llm 标 Agent 选，否则规则选", () => {
    expect(pickBadge("llm")).toBe("Agent 选");
    expect(pickBadge("local_heuristic")).toBe("规则选");
    expect(pickBadge(undefined)).toBe("规则选");
  });

  it("选材和画应用拆成两条带，未到的配方步是 pending", () => {
    const groups = deriveStageBands({
      steps: [
        narr("指令已接收 · 启动推理"),
        chip("第 1 轮 · 正在澄清需求", "intent.parse"),
        chip(
          "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
          "specfirst.spec"
        ),
      ],
      streaming: true,
      planSource: "llm",
    });
    expect(groups.map(g => g.authority)).toEqual(["gate", "agent", "recipe"]);
    expect(groups.find(g => g.authority === "agent")?.badge).toBe("Agent 选");
    expect(groups.find(g => g.authority === "recipe")?.badge).toBe("配方");
    const recipe = groups.find(g => g.authority === "recipe")!;
    expect(recipe.rows.find(r => r.stageId === "specfirst.spec")?.status).toBe(
      "running"
    );
    expect(recipe.rows.find(r => r.stageId === "specfirst.bind")).toBeUndefined();
    expect(groups.find(g => g.authority === "agent")?.rows.some(r => r.verb === "澄清需求")).toBe(
      true
    );
  });

  it("只有选材时不发明一份配方轨", () => {
    const groups = deriveStageBands({
      steps: [chip("第 1 轮 · 正在澄清需求")],
      streaming: true,
    });
    expect(groups.some(g => g.authority === "recipe")).toBe(false);
    expect(groups.some(g => g.rows.some(r => r.status === "pending"))).toBe(false);
  });

  it("GEN5 证据行进画应用，但不铺一份没见过的 spec-first 轨", () => {
    const groups = deriveStageBands({
      steps: [chip("⚙ 数据模型 系统画面生成中...")],
      streaming: true,
    });
    const recipe = groups.find(g => g.authority === "recipe");
    expect(recipe).toBeTruthy();
    expect(recipe!.rows.some(r => r.verb === "生成画面")).toBe(true);
    expect(recipe!.rows.some(r => r.stageId === "specfirst.bind")).toBe(false);
  });

  it("界面已出是正文块，不许把配方轨拨回 pages", () => {
    const groups = deriveStageBands({
      steps: [
        chip("第 2 轮 · 正在执行 给界面接上数据", "specfirst.bind"),
        chip("🖼 界面已出：p1（1/4）"),
      ],
      streaming: true,
    });
    const recipe = groups.find(g => g.authority === "recipe")!;
    expect(recipe.rows.find(r => r.stageId === "specfirst.bind")?.status).toBe(
      "running"
    );
    expect(recipe.rows.find(r => r.stageId === "specfirst.pages")).toBeUndefined();
  });
});
