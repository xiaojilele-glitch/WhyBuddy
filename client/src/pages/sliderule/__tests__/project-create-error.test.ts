/**
 * 工程创建失败文案必须吃真机那份信封。
 *
 * 把 `message` 那一行删掉只留 `detail`，下面「真机信封」必红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectCreateFailureText } from "../project-create-error";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("projectCreateFailureText", () => {
  it("真机信封走 message，不是只认 detail", () => {
    expect(
      projectCreateFailureText({
        backend: "slide-rule-python",
        degraded: true,
        message: "project_initial_plan_changed",
        status: "error",
      })
    ).toContain("另一份计划");
    expect(
      projectCreateFailureText({ detail: "project_rollout_disabled" })
    ).toContain("未启用");
    expect(projectCreateFailureText({ message: "nope" })).toContain("刷新");
  });

  it("创建失败走抽出来的那份，hook 里不再只认 detail", () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, "../useSlideRuleSession.ts"), "utf8")
    );
    expect(src).toContain("projectCreateFailureText");
    expect(src).not.toMatch(/payload\?\.detail\s*===\s*"project_rollout_disabled"/);
  });
});
