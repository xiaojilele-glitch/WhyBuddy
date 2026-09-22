import { describe, expect, it } from "vitest";
import { projectToolStillOpen } from "../project-activity";

/**
 * 工具回执什么时候算「还开着」。
 *
 * ⚠ 2026-09-20 review 抓到的 §4「只改一半」：后端
 *   project_tools.py:109 每个回执都带 `commandFinished`，
 *   而**服务中的 runtime.start 永远停在 status=running**
 *   （服务中的沙盒不会进 completed，等它进终态就是等它死）。
 *   前端只看终态集合，于是 project_start 成功后那条 chip
 *   永远转「正在启动工程」。后端加这个字段就是为了治它，前端一直没读。
 */
describe("projectToolStillOpen", () => {
  it("服务中的 runtime.start：status 还是 running，但 commandFinished=true 就算完成", () => {
    // 这就是真机上 project_start 成功之后的原样形状。
    expect(projectToolStillOpen({
      ok: true, status: "running", commandFinished: true,
    })).toBe(false);
  });

  it("反向：同一条回执拿掉 commandFinished，就会退回永远转圈——证明修的是它", () => {
    expect(projectToolStillOpen({ ok: true, status: "running" })).toBe(true);
  });

  it("真在跑的命令：commandFinished=false，仍算开着", () => {
    expect(projectToolStillOpen({
      ok: true, status: "running", commandFinished: false,
    })).toBe(true);
  });

  it("只认显式 true——旧事件没有这个字段时不改行为", () => {
    for (const value of [undefined, null, "true", 1, {}]) {
      expect(projectToolStillOpen({
        ok: true, status: "running", commandFinished: value as never,
      })).toBe(true);
    }
  });

  it("终态照旧算完成，不依赖新字段", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(projectToolStillOpen({ ok: true, status })).toBe(false);
    }
  });

  it("失败回执和空输入仍然不算开着", () => {
    expect(projectToolStillOpen({ ok: false, status: "running", commandFinished: false })).toBe(false);
    expect(projectToolStillOpen({ ok: true, status: "" })).toBe(false);
    expect(projectToolStillOpen(null)).toBe(false);
    expect(projectToolStillOpen(undefined)).toBe(false);
  });
});
