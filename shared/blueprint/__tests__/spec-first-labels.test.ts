import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  humanReasoningStepLabel,
  SPEC_FIRST_LIVE_LABELS,
} from "../spec-first-labels.js";

describe("spec-first 人话（Actions name vs id）", () => {
  it("内部 id 不许漏到左栏", () => {
    expect(humanReasoningStepLabel("specfirst.design")).toBe(
      "定这个应用的设计语言"
    );
    expect(humanReasoningStepLabel("specfirst.design")).not.toMatch(
      /specfirst\./
    );
    expect(humanReasoningStepLabel("intent.parse")).toBe("正在理解你的目标");
  });

  it("SSE 已经是人话时不再套「正在执行」", () => {
    expect(humanReasoningStepLabel("定这个应用的设计语言")).toBe(
      "定这个应用的设计语言"
    );
    expect(humanReasoningStepLabel("定这个应用的设计语言")).not.toContain(
      "正在执行"
    );
  });

  it("未知点号 id 才回落正在执行", () => {
    expect(humanReasoningStepLabel("unknown.cap")).toBe("正在执行 unknown.cap");
  });

  it("工厂 hop 账本身份翻人话，不许 factory.structure 上脸", () => {
    expect(humanReasoningStepLabel("factory.structure")).toBe(
      "从界面反推数据模型与关联关系"
    );
    expect(humanReasoningStepLabel("factory.structure")).not.toMatch(
      /factory\./
    );
    expect(humanReasoningStepLabel("factory.pages")).toBe(
      "逐页画界面（并发）"
    );
    expect(humanReasoningStepLabel("factory.closure")).toBe(
      "完整性检查与发布闭环"
    );
  });

  it("Python 那份键这里都有——漏一个就是下一处漏词", () => {
    const py = readFileSync(
      fileURLToPath(
        new URL(
          "../../../slide-rule-python/services/turn_narration.py",
          import.meta.url
        )
      ),
      "utf8"
    );
    const block = py.slice(
      py.indexOf("_SPEC_FIRST_LABELS"),
      py.indexOf("_SKILL_LABELS")
    );
    const keys = [...block.matchAll(/"(specfirst\.[a-z]+)"/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(SPEC_FIRST_LIVE_LABELS[key], `缺 ${key}`).toBeTruthy();
    }
  });
});
