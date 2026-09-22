/**
 * 工厂 hop 人话 → 唯一工具名。跟 Python closed_tools.factory_hop_from_text
 * 同一把尺子。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOSED_TOOLS,
  FACTORY_HOP_LABELS,
  closedToolFromText,
  factoryCapabilityId,
  factoryHopFromText,
  hopFromFactoryCapability,
  isFactoryHop,
  isFactoryWriteTool,
  isProjectWorkbenchTool,
  looksLikeClosedToolCommand,
  looksLikeFactoryHopCommand,
} from "../factory-hops";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("factoryHopFromText", () => {
  it("收尾卡标签是唯一一跳", () => {
    expect(factoryHopFromText("进入数据模型反推（Structure）")).toBe(
      "structure"
    );
    expect(factoryHopFromText("进入权限绑定（bind）")).toBe("bind");
    expect(factoryHopFromText("直接执行闭环发布（closure）")).toBe("closure");
    expect(factoryHopFromText("直接执行闭环发布")).toBe("closure");
    expect(factoryHopFromText("继续画页面")).toBe("pages");
  });

  it("新产品名即使带闭环发布也不认成 hop", () => {
    expect(factoryHopFromText("闭环发布管理系统")).toBeUndefined();
    expect(factoryHopFromText("做一个闭环发布管理系统")).toBeUndefined();
    expect(looksLikeFactoryHopCommand("闭环发布管理系统")).toBe(false);
    expect(looksLikeFactoryHopCommand("给社区图书馆做借还书系统")).toBe(false);
  });

  it("多跳句子是 hop 指令，但没有唯一 forcedTool", () => {
    const text = "继续进行数据模型反推（structure）与权限绑定（bind）";
    expect(factoryHopFromText(text)).toBeUndefined();
    expect(looksLikeFactoryHopCommand(text)).toBe(true);
  });

  it("闭集括号名全表都认，含 refine；旧五件套解析器看不见", () => {
    // ⚠ 2026-09-07 真机水果店：点「精修（refine）」forcedTool 空。
    // 先证明旧尺子确实不认——下面几条才不是空跑。
    expect(factoryHopFromText("精修（refine）")).toBeUndefined();
    expect(closedToolFromText("精修（refine）")).toBe("refine");
    expect(closedToolFromText("refine")).toBe("refine");
    expect(closedToolFromText("质疑（challenge）")).toBe("challenge");
    expect(closedToolFromText("进入权限绑定（bind）")).toBe("bind");
    expect(looksLikeClosedToolCommand("精修（refine）")).toBe(true);
    expect(closedToolFromText("闭环发布管理系统")).toBeUndefined();
    expect(looksLikeClosedToolCommand("闭环发布管理系统")).toBe(false);
    // 文本里的 rehearse 不得 yolo 点火（跟 /推演 同一条）。
    expect(closedToolFromText("开始推演（rehearse）")).toBeUndefined();
    expect(closedToolFromText("file_write")).toBeUndefined();
    expect(closedToolFromText("shell_exec")).toBeUndefined();
    expect(CLOSED_TOOLS).toContain("refine");
    expect(CLOSED_TOOLS).toContain("file_write");
    expect(CLOSED_TOOLS).toContain("shell_exec");
    expect(CLOSED_TOOLS).toContain("idle");
    expect(CLOSED_TOOLS).toContain("write_file");
    expect(CLOSED_TOOLS).toContain("grep");
    expect(isProjectWorkbenchTool("write_file")).toBe(true);
    expect(isProjectWorkbenchTool("bash")).toBe(true);
    expect(isProjectWorkbenchTool("file_write")).toBe(true);
    expect(isProjectWorkbenchTool("shell_exec")).toBe(true);
    expect(isProjectWorkbenchTool("browser_navigate")).toBe(true);
    expect(isProjectWorkbenchTool("project_patch")).toBe(true);
    expect(isProjectWorkbenchTool("skill")).toBe(true);
    expect(isProjectWorkbenchTool("intent.parse")).toBe(false);
    // 反向：把 skill 从白名单拿掉，上面那句和这段源码钉都会红。
    const hops = stripComments(
      readFileSync(resolve(__dirname, "../factory-hops.ts"), "utf8")
    );
    const fn = hops.slice(
      hops.indexOf("export function isProjectWorkbenchTool"),
      hops.indexOf("const TEXT_FORCED_SKIP")
    );
    expect(fn).toMatch(/"skill"/);
  });

  it("账本身份按 hop 分开，不是共用信封", () => {
    expect(factoryCapabilityId("structure")).toBe("factory.structure");
    expect(hopFromFactoryCapability("factory.structure")).toBe("structure");
    expect(hopFromFactoryCapability("appbundle.runtimeClosure")).toBeUndefined();
    expect(FACTORY_HOP_LABELS.structure).toContain("数据模型");
    expect(isFactoryHop("pages")).toBe(true);
    expect(isFactoryHop("rehearse")).toBe(false);
    expect(isFactoryHop("refine")).toBe(false);
  });

  it("WRITE 才亮钟：问候/提问不是工厂", () => {
    expect(isFactoryWriteTool("spec")).toBe(true);
    expect(isFactoryWriteTool("rehearse")).toBe(true);
    expect(isFactoryWriteTool("refine")).toBe(true);
    expect(isFactoryWriteTool("ask_user")).toBe(false);
    expect(isFactoryWriteTool("inspect_model")).toBe(false);
    expect(isFactoryWriteTool("")).toBe(false);
  });
});
