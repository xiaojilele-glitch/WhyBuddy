/**
 * 闭环对话总结（方案 A · 零 LLM 模板）回归：
 * 事实全部来自五系统模型 + 闭环证据；blocked 如实说缺口，不装闭环。
 */
import { describe, it, expect } from "vitest";
import {
  summarizeClosureForChat,
  type FiveSystemModel,
} from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      { id: "pet", name: "宠物档案", fields: [{ id: "a" }, { id: "b" }, { id: "c" }] },
      { id: "booking", name: "预约单", fields: [{ id: "d" }] },
    ],
  },
  rbac: { roles: ["owner", "host"], permissions: ["p1", "p2", "p3"], menus: [] },
  workflow: {
    nodes: [
      { id: "n1", name: "提交", phase: "申请" },
      { id: "n2", name: "审核", phase: "审批" },
    ],
    transitions: [{ from: "n1", to: "n2" }],
  },
  page: {
    pages: [{ id: "pg", name: "档案页", fieldBindings: ["pet.a", "pet.b"] }],
  },
  aigc: { capabilities: [{ id: "cap1", name: "生成建议" }] },
  appbundle: { pageBindings: [{ pageRef: "pg", workflowRef: "wf1" }] },
};

describe("summarizeClosureForChat", () => {
  it("闭环成功：话题 + 五系统统计 + 绑定数 + 下一步指引", () => {
    const text = summarizeClosureForChat(MODEL, {
      goalText: "做一个宠物寄养预约平台",
      blocked: false,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
    });
    expect(text).toContain("「做一个宠物寄养预约平台」");
    expect(text).toContain("证据 6/6");
    expect(text).toContain("版本已钉扎");
    expect(text).toContain("2 实体 · 4 字段");
    expect(text).toContain("2 节点 · 1 转移 · 2 阶段");
    expect(text).toContain("2 角色 · 3 权限");
    expect(text).toContain("1 页 · 2 处字段绑定");
    expect(text).toContain("1 项可写回");
    expect(text).toContain("页面↔流程绑定 1 处");
    expect(text).toContain("透视");
    expect(text).toContain("沙盘");
    expect(text).not.toContain("「游标」");
  });

  it("blocked：如实说缺口，不装闭环、不给统计", () => {
    const text = summarizeClosureForChat(MODEL, {
      goalText: "做一个宠物寄养预约平台",
      blocked: true,
      evidencePresentCount: 3,
      skillCount: 6,
    });
    expect(text).toContain("未收口");
    expect(text).toContain("3/6");
    expect(text).not.toContain("实体");
  });

  it("模型缺失（如空会话恢复）：按未收口处理", () => {
    const text = summarizeClosureForChat(null, {
      blocked: false,
      evidencePresentCount: 0,
      skillCount: 6,
    });
    expect(text).toContain("未收口");
    expect(text).toContain("0/6");
  });

  it("goalText 超长截断 24 字，空 goal 用「本话题」", () => {
    const long = "这是一个非常非常非常非常非常非常非常非常长的目标描述超过二十四个字了绝对";
    const t1 = summarizeClosureForChat(MODEL, {
      goalText: long,
      blocked: false,
      evidencePresentCount: 6,
      skillCount: 6,
    });
    expect(t1).toContain(`「${long.slice(0, 24)}」`);
    const t2 = summarizeClosureForChat(MODEL, {
      blocked: false,
      evidencePresentCount: 6,
      skillCount: 6,
    });
    expect(t2).toContain("本话题");
  });
});
