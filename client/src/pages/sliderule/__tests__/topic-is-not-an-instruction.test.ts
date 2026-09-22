/**
 * 首轮话题不是指令：话题里的 hop 词不许决定跑哪一跳（2026-09-04 真机）。
 *
 * 这是 `slide-rule-python/tests/test_topic_is_not_an_instruction.py` 的
 * TS 那一半。CLAUDE.md §4：这两条是成对物，只改一条不会报错，
 * 只会有一半不生效——而**前端这一半才是真机走的那条**：
 * POST 出去的 forcedTool 就是 `inferForcedTool` 算出来的。
 *
 * 真机（社区旧物置换站，话题含「数据结构」）：点开始推演，
 * uvicorn 只留下 `[control] forced hop=structure hasSpec=0 hasPages=0`，
 * 后面连 capabilityPlan= 都没有。
 *
 * 上一轮 badec6f 加的护栏是 `if (fromText && (!explicit || isFactoryHop(explicit)))`,
 * 漏在 `!explicit`：本函数头一行注释自己写着「/推演 不得在客户端带 rehearse」，
 * 首轮 explicit 本来就是 undefined。
 */
import { describe, it, expect } from "vitest";
import { inferForcedTool, projectToolLabel } from "../useSlideRuleSession";

describe("project tool activity labels", () => {
  it("maps every project SSE tool to a readable live action", () => {
    expect(projectToolLabel("project_create")).toBe("正在创建工程");
    expect(projectToolLabel("project_patch")).toBe("正在写入工程源码");
    expect(projectToolLabel("project_write")).toBe("正在写入工程源码");
    expect(projectToolLabel("project_str_replace")).toBe("正在替换工程源码");
    expect(projectToolLabel("file_write")).toBe("正在写入工程源码");
    expect(projectToolLabel("file_read")).toBe("正在读取工程文件");
    expect(projectToolLabel("file_str_replace")).toBe("正在替换工程源码");
    expect(projectToolLabel("shell_exec")).toBe("正在执行工程命令");
    expect(projectToolLabel("browser_navigate")).toBe("正在打开预览");
    expect(projectToolLabel("idle")).toBe("正在等待用户");
    expect(projectToolLabel("write_file")).toBe("正在写入工程源码");
    expect(projectToolLabel("bash")).toBe("正在执行工程命令");
    expect(projectToolLabel("grep")).toBe("正在搜索工程源码");
    expect(projectToolLabel("project_start")).toBe("正在启动工程");
    expect(projectToolLabel("project_exec")).toBe("正在执行工程命令");
    expect(projectToolLabel("project_verify")).toBe("正在执行浏览器检查");
    expect(projectToolLabel("skill")).toBe("正在加载技能");
  });

  it("does not turn unrelated or malformed events into activity", () => {
    expect(projectToolLabel("control_text")).toBeNull();
    expect(projectToolLabel("")) .toBeNull();
    expect(projectToolLabel(null)).toBeNull();
  });
});

/** 真机那条话题，原样。 */
const TOPIC = "做一个社区旧物置换站，把物品、置换记录、押金的数据结构理清楚";

describe("首轮话题不许决定 hop", () => {
  it("话题里确实认得出 hop 词（先证明这条路通电）", () => {
    // 不设首轮边界时，文本就是会赢——下面几条才有意义。
    expect(inferForcedTool(TOPIC, undefined, undefined, undefined, false)).toBe(
      "structure"
    );
  });

  it("复刻真机那一发：首轮 + 不带 explicit → 不许是 structure", () => {
    // 这条红 = 又回到「点开始推演一件活不干」。
    expect(
      inferForcedTool(TOPIC, undefined, undefined, undefined, true)
    ).toBeUndefined();
  });

  it("首轮带了 rehearse 也不许被盖（上一轮护栏管的那支要继续管）", () => {
    expect(inferForcedTool(TOPIC, undefined, undefined, "rehearse", true)).toBe(
      "rehearse"
    );
  });

  it.each([
    "做个工具共享站，把借还的数据结构理清楚",
    "社区旧书交换平台，重点是页面生成的顺序",
    "做一个门店权限绑定管理台",
  ])("含 hop 词的话题都不劫持：%s", topic => {
    expect(
      inferForcedTool(topic, undefined, undefined, undefined, true)
    ).toBeUndefined();
  });
});

describe("反向：只掐首轮的文本 hop，别的口子不许废", () => {
  it("非首轮的人话 hop 仍然算数", () => {
    // 精修轮说「进入数据模型反推」，那是**针对交付物的指令**，必须生效。
    expect(
      inferForcedTool("进入数据模型反推", undefined, undefined, undefined, false)
    ).toBe("structure");
  });

  it("非首轮时残留 hop 仍然被人话盖掉", () => {
    expect(
      inferForcedTool("进入数据模型反推", undefined, undefined, "pages", false)
    ).toBe("structure");
  });

  it("首轮的 repair 仍然生效", () => {
    expect(inferForcedTool(TOPIC, undefined, "repair", undefined, true)).toBe(
      "repair"
    );
  });

  it("不传 firstPass = 老行为（放宽只针对显式声明首轮的调用点）", () => {
    expect(inferForcedTool(TOPIC)).toBe("structure");
  });
});

describe("调用点真的传了 firstPass", () => {
  // ⚠ §3：函数改对了、调用点不传，等于没修。
  //   剥掉注释再比对（§2）——本文件和被测文件的注释里都写着这些标识符。
  it("driveStream 那处按会话状态算首轮", async () => {
    const fs = await import("node:fs");
    const url = new URL("../useSlideRuleSession.ts", import.meta.url);
    const src = fs
      .readFileSync(url, "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).toContain("firstPassNow");
    // 口径要跟 Python 那半边一致：没 SPEC 也没页面。写死 true/false 会红。
    const decl = src.slice(src.indexOf("const firstPassNow"));
    expect(decl.slice(0, 200)).toMatch(/sfpNow\.spec/);
    expect(decl.slice(0, 200)).toMatch(/sfpNow\.pages/);
    expect(src).toMatch(/inferForcedTool\([\s\S]{0,200}firstPassNow/);
  });
});
