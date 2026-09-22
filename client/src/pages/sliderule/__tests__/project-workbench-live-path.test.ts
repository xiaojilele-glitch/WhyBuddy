/**
 * 批准计划后的工程工作台必须接在 Unified 通电的那条链上。
 *
 * 2026-09-15 真机 TicketStream：计划已批准、待办 8 条，右侧却是
 * 接线沙盘。原因是 2026-09-14 卸掉「进入工程工作台」时，把
 * `onCreateProject` 写成 `_onCreateProject` 再没人叫。
 *
 * 判据盯剥掉注释的源码。把创建改回 `_onCreateProject`、或把
 * `shouldAutoCreateProject` 从页面拿掉，下面必红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("批准计划后自动创建工程接在 Unified 上", () => {
  it("页面真的调用 shouldAutoCreateProject / shouldShowProjectComputer，不再把创建吞掉", () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
    );
    expect(src).toContain("shouldAutoCreateProject");
    expect(src).toContain("planWrittenHasDeliverableKind");
    expect(src).toContain("planHasDeliverableKind");
    expect(src).toContain("shouldShowProjectComputer");
    expect(src).toContain("createProjectRef.current");
    expect(src).not.toMatch(/onCreateProject:\s*_onCreateProject/);
    expect(src).not.toMatch(/canCreateProject:\s*_canCreateProject/);
  });
});
