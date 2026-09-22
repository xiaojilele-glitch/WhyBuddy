import { describe, expect, it } from "vitest";
import { deriveTurnPhases } from "../derive-turn-phases";
import {
  compactVerb,
  formatCharMeta,
  groupsFromPhases,
  parseActivityLine,
  turnTimelineHeader,
} from "../activity-rows";

const STEPS = [
  "指令已接收 · 启动推理",
  "第 1 轮 · ⚡ 正在全网检索外部证据",
  "第 1 轮 · 正在澄清需求",
  "🖋 LLM 正在起草五系统模型（实时输出见下方）...",
  "⚙ 数据模型 系统画面生成中...",
  "✓ 数据模型 证据落地 · LLM 生成",
  "✗ 页面 证据缺失（fail-closed）",
];

describe("activity-rows（Cursor 活动行语法）", () => {
  it("把装饰日志收成 动词 + 目标 + 次要数字，不把原文当标题", () => {
    expect(parseActivityLine("⚙ 数据模型 系统画面生成中...")).toEqual({
      status: "running",
      verb: "生成画面",
      target: "数据模型",
    });
    expect(parseActivityLine("✓ 数据模型 证据落地 · LLM 生成")).toEqual({
      status: "done",
      verb: "落地",
      target: "数据模型",
      meta: "LLM 生成",
    });
    expect(parseActivityLine("✗ 页面 证据缺失（fail-closed）")).toEqual({
      status: "failed",
      verb: "缺失",
      target: "页面",
    });
    expect(parseActivityLine("第 1 轮 · 正在澄清需求")).toEqual({
      status: "running",
      verb: "澄清需求",
      target: "第 1 轮",
    });
    expect(parseActivityLine("指令已接收 · 启动推理")).toEqual({
      status: "done",
      verb: "接收意图",
    });
    expect(
      parseActivityLine("最新定义：传承人 · 已产出 1201 字符")
    ).toEqual({
      status: "done",
      verb: "起草",
      target: "传承人",
      meta: "1201 字",
    });
    expect(
      parseActivityLine("closed 6/6 — 六系统证据齐备，版本钉扎已检查")
    ).toEqual({
      status: "done",
      verb: "闭环",
      meta: "6/6",
    });
    expect(formatCharMeta(467)).toBe("467 字");
    expect(compactVerb("正在分析风险")).toBe("分析风险");
  });

  it("人话标签剥完不许露出 specfirst 机器 id", () => {
    expect(compactVerb("LLM 正在定这个应用的设计语言")).toBe(
      "定这个应用的设计语言"
    );
    expect(compactVerb("LLM 正在定这个应用的设计语言")).not.toMatch(
      /specfirst/
    );
    expect(
      parseActivityLine("🖋 LLM 正在定这个应用的设计语言（实时输出见下方）...")
        .verb
    ).not.toMatch(/specfirst/);
  });

  it("完成后 running 行要落成 done；失败行不许被洗绿", () => {
    const groups = groupsFromPhases(
      deriveTurnPhases({ stepTexts: STEPS, streaming: false })
    );
    const verbs = groups.flatMap(g => g.rows.map(r => r.verb));
    expect(verbs).toContain("生成画面");
    expect(verbs).toContain("落地");
    expect(verbs).toContain("缺失");
    expect(groups.flatMap(g => g.rows).every(r => r.status !== "running")).toBe(
      true
    );
    expect(groups.flatMap(g => g.rows).find(r => r.verb === "缺失")?.status).toBe(
      "failed"
    );
  });

  it("收口句是 N 步 · Ns，不写推演过程/阶段", () => {
    expect(
      turnTimelineHeader({ stepCount: 42, durationMs: 115000 })
    ).toBe("42 步 · 115s");
    expect(turnTimelineHeader({ stepCount: 42, durationMs: 115000 })).not.toContain(
      "推演过程"
    );
    expect(turnTimelineHeader({ stepCount: 42, durationMs: 115000 })).not.toContain(
      "阶段"
    );
    expect(turnTimelineHeader({ stepCount: 42, durationMs: 115000 })).not.toContain(
      "用时"
    );
  });

  it("精修有沿用说明时不写步数", () => {
    const text = turnTimelineHeader({
      stepCount: 42,
      durationMs: 40000,
      refineReuseNote: "改了 异常条目（p3） · 沿用 3 页 · 规格、权限、流程沿用",
    });
    expect(text).toContain("改了 异常条目（p3）");
    expect(text).toContain("沿用 3 页");
    expect(text).not.toMatch(/\d+\s*步/);
    expect(text).not.toMatch(/\d+\s*阶段/);
    expect(text).toContain("40s");
    expect(text).not.toContain("用时");
    expect(text).not.toContain("推演过程");
  });
});
