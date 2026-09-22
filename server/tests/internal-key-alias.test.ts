/**
 * 内部密钥变量名归一（2026-08-04）。
 *
 * Node 读 `PYTHON_SLIDE_RULE_INTERNAL_KEY`、Python 读 `SLIDE_RULE_INTERNAL_KEY`，
 * 守的却是同一把钥匙。两边默认值恰好相同，所以"都不配"能跑——那是巧合。
 * 只配一个的话 Node 发的和 Python 认的是两个值，**每次内部调用 403**，
 * 而现象只是"整个应用没反应"，没人会往环境变量名上想。
 *
 * 这个坑是「出厂密码不许上生产」那次改动激活的：在那之前谁都不会去改这个值。
 */
import { describe, expect, it } from "vitest";

import { applyInternalKeyAlias } from "../config/internal-key-alias";

describe("内部密钥变量名归一", () => {
  it("只配通用那个时，Node 侧自动沿用——运维配一个变量就够", () => {
    const env = { SLIDE_RULE_INTERNAL_KEY: "a-real-secret" } as NodeJS.ProcessEnv;
    applyInternalKeyAlias(env);
    expect(env.PYTHON_SLIDE_RULE_INTERNAL_KEY).toBe("a-real-secret");
  });

  it("显式配了 Node 那个就不覆盖", () => {
    // Node 与 Python 之间隔着网关、两段用不同钥匙的部署，行为必须一个字不变
    const env = {
      SLIDE_RULE_INTERNAL_KEY: "shared",
      PYTHON_SLIDE_RULE_INTERNAL_KEY: "node-specific",
    } as NodeJS.ProcessEnv;
    applyInternalKeyAlias(env);
    expect(env.PYTHON_SLIDE_RULE_INTERNAL_KEY).toBe("node-specific");
  });

  it("两个都没配就什么都不做——本地开发各走各的默认值", () => {
    const env = {} as NodeJS.ProcessEnv;
    applyInternalKeyAlias(env);
    expect(env.PYTHON_SLIDE_RULE_INTERNAL_KEY).toBeUndefined();
  });

  it("空串/纯空格不算配过", () => {
    // `KEY=` 这种写法在 .env 里很常见，它表达的是"没配"，不是"配成空字符串"
    const env = {
      SLIDE_RULE_INTERNAL_KEY: "shared",
      PYTHON_SLIDE_RULE_INTERNAL_KEY: "   ",
    } as NodeJS.ProcessEnv;
    applyInternalKeyAlias(env);
    expect(env.PYTHON_SLIDE_RULE_INTERNAL_KEY).toBe("shared");

    const empty = { SLIDE_RULE_INTERNAL_KEY: "  " } as NodeJS.ProcessEnv;
    applyInternalKeyAlias(empty);
    expect(empty.PYTHON_SLIDE_RULE_INTERNAL_KEY).toBeUndefined();
  });
});
