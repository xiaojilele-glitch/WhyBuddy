/**
 * 结果卡：**有东西才出卡**，而且不许编。
 *
 * ## 病（2026-09-14，用户第二次对照 Manus 截图）
 *
 * Manus 跑完留下一张卡：应用名 + 未发布 + 用时 + 缩略图 + 发布按钮，底下
 * `✓ 任务已完成 · 复制 · 重试 · 评分`。往上滚看历史，每个任务都留着那张卡。
 * 我们跑完只有一段文字——成果散在右侧预览列，**对话流里没有任何一个
 * 「东西做好了，在这儿」的锚点**。
 *
 * ## 判据的重心在反向
 *
 * 「跑完显示一张卡」写出来很容易，危险的是它到处都出：还在跑的、没产出的、
 * 纯问答的轮次全挂一张卡，对话流就变成卡片墙。所以每条正向都配一条反向。
 *
 * 真机那一趟（`shots/baseline`，真 LLM）正好撞上 provider 的 content_filter，
 * 整轮没有任何产出——这种轮次**必须不出卡**，是下面 `test_反向_失败轮不出卡`
 * 钉的形态。
 */
import { describe, expect, it } from "vitest";
import { OFFICE_FILE } from "../deliverable-kind";
import {
  formatWorkedDuration,
  resultCardModel,
  turnDeliveredOfficeFile,
  turnDeliveredProject,
  workedLabel,
} from "../turn-result-card";
import type { TurnStep, UiTurn } from "../types";

function chip(
  tool: string,
  progressType: Extract<TurnStep, { kind: "chip" }>["progressType"] = "completed"
): Extract<TurnStep, { kind: "chip" }> {
  return {
    id: `chip-${tool}`,
    kind: "chip",
    capabilityId: tool as Extract<TurnStep, { kind: "chip" }>["capabilityId"],
    roleId: "control",
    label: tool,
    realLlm: true,
    progressType,
  };
}

function turn(over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "做一个记账小应用",
    status: "complete",
    steps: [],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "做好了。",
    assistantSource: "llm",
    main: { artifactId: "a1", kind: "page", realLlm: true },
    actions: [],
    ...over,
  };
}

describe("用时要写成人话", () => {
  it("不满一分钟说秒", () => {
    expect(formatWorkedDuration(45_000)).toBe("45s");
    expect(formatWorkedDuration(1_000)).toBe("1s");
  });

  it("过了一分钟写 2m 45s，不许让人自己把 165s 心算成两分多钟", () => {
    expect(formatWorkedDuration(165_000)).toBe("2m 45s");
    expect(formatWorkedDuration(120_000)).toBe("2m");
  });

  it("小时档也别塌成一堆分钟", () => {
    expect(formatWorkedDuration(3_600_000)).toBe("1h");
    expect(formatWorkedDuration(3_780_000)).toBe("1h 3m");
  });

  it("反向：拿不到用时就整行不出，不写 0s 也不写「未知」", () => {
    for (const bad of [undefined, null, 0, -5, NaN, Infinity, "12s"]) {
      expect(formatWorkedDuration(bad as never)).toBeNull();
      expect(workedLabel(bad as never)).toBeNull();
    }
  });

  it("标题行是「工作了 X」", () => {
    expect(workedLabel(165_000)).toBe("工作了 2m 45s");
  });
});

describe("有东西才出卡", () => {
  it("正向：HTML 档画出了页面 → 出卡", () => {
    const model = resultCardModel(turn({ durationMs: 165_000 }), {
      runtimeKind: "html-prototype",
      goalText: "记账小应用",
      hasPages: true,
    });
    expect(model).not.toBeNull();
    expect(model!.title).toBe("记账小应用");
    expect(model!.badge).toBe("HTML 原型");
    expect(model!.worked).toBe("工作了 2m 45s");
    expect(model!.canPublish).toBe(false);
  });

  it("正向：工程档这一轮写了源码且有落库版本 → 出卡，而且谈得上发布", () => {
    const model = resultCardModel(turn({ steps: [chip("project_create")] }), {
      runtimeKind: "project",
      goalText: "工单系统",
      projectRevision: "prv-abc",
    });
    expect(model!.badge).toBe("未发布");
    expect(model!.canPublish).toBe(true);
  });

  it("反向：还在跑的轮次不出卡", () => {
    expect(
      resultCardModel(turn({ status: "streaming" }), {
        runtimeKind: "html-prototype",
        hasPages: true,
      })
    ).toBeNull();
  });

  it("反向：失败轮不出卡——真机那趟 content_filter 就是这形态", () => {
    // 整轮没有任何产出：没画页面、没落库版本。挂一张「任务已完成」的卡
    // 就是伪造绿灯（§7：闭环类 fail-closed）。
    expect(
      resultCardModel(turn({ main: null }), {
        runtimeKind: "html-prototype",
        hasPages: false,
      })
    ).toBeNull();
    expect(
      resultCardModel(turn(), { runtimeKind: "project", projectRevision: "" })
    ).toBeNull();
    expect(
      resultCardModel(turn(), { runtimeKind: "project", projectRevision: null })
    ).toBeNull();
  });

  it("反向：会话已经有版本，提问/写计划轮仍不出卡——Manus 是做完才出卡", () => {
    // 2026-09-18：批准后模板落库，开场两轮（34s / 48s）被会话级 revision
    // 重绘成「任务已完成」。变异：produced 只看 projectRevision → 本条红。
    const asked = turn({ user: "做一个待办清单系统", steps: [] });
    const planned = turn({
      user: "批准计划并执行",
      steps: [chip("todo_write"), chip("project_status")],
    });
    for (const item of [asked, planned]) {
      expect(
        resultCardModel(item, {
          runtimeKind: "project",
          goalText: "做一个待办清单系统",
          projectRevision: "prv-f34225ac76324d96854a73c69bfcd33b",
        })
      ).toBeNull();
      expect(turnDeliveredProject(item)).toBe(false);
    }
  });

  it("反向：写了但失败的轮次不出卡，不许把红灯画成任务已完成", () => {
    expect(
      resultCardModel(turn({ steps: [chip("file_write", "failed")] }), {
        runtimeKind: "project",
        projectRevision: "prv-abc",
      })
    ).toBeNull();
  });

  it("反向：纯问答轮（没产出）不出卡", () => {
    expect(resultCardModel(turn({ main: null }), {})).toBeNull();
  });

  it("反向：办公计划 project_create 落下空工作区，不许画任务已完成", () => {
    // 2026-09-21 sr-20260921102816-KWETH78PZ0：5m 56s 绿灯，产物 0 份。
    const created = turn({
      user: "@office-skills 做一份5页PPT",
      steps: [chip("project_create"), chip("todo_write")],
    });
    expect(
      resultCardModel(created, {
        runtimeKind: "project",
        goalText: "做一份5页PPT",
        projectRevision: "prv-09497b738447421792bfb1537e73ebbe",
        deliverableKind: OFFICE_FILE,
        hasOfficeArtifact: false,
      })
    ).toBeNull();
    expect(turnDeliveredProject(created)).toBe(true);
    expect(turnDeliveredOfficeFile(created)).toBe(false);
  });

  it("反向：办公 bash 芯片绿了但产物库是空的，仍不出卡", () => {
    expect(
      resultCardModel(turn({ steps: [chip("bash")] }), {
        runtimeKind: "project",
        projectRevision: "prv-abc",
        deliverableKind: OFFICE_FILE,
        hasOfficeArtifact: false,
      })
    ).toBeNull();
  });

  it("正向：办公这一轮跑了 bash 且产物库有文件 → 出卡，但不谈发布", () => {
    const model = resultCardModel(turn({ steps: [chip("bash")] }), {
      runtimeKind: "project",
      goalText: "做一份5页PPT",
      projectRevision: "prv-abc",
      deliverableKind: OFFICE_FILE,
      hasOfficeArtifact: true,
    });
    expect(model).not.toBeNull();
    expect(model!.canPublish).toBe(false);
    expect(turnDeliveredOfficeFile(turn({ steps: [chip("bash")] }))).toBe(true);
  });

  it("反向：坏输入不许崩", () => {
    expect(resultCardModel(null, {})).toBeNull();
    expect(resultCardModel(undefined, {})).toBeNull();
  });
});

describe("标题：拿得到什么写什么，拿不到不编", () => {
  it("优先会话话题，其次这一轮的用户原话", () => {
    const withGoal = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true, goalText: "记账小应用",
    });
    expect(withGoal!.title).toBe("记账小应用");

    const noGoal = resultCardModel(turn({ user: "做个待办清单" }), {
      runtimeKind: "html-prototype", hasPages: true, goalText: "   ",
    });
    expect(noGoal!.title).toBe("做个待办清单");
  });

  it("反向：两个都没有时给一句中性的，不许拿工具名或 id 凑", () => {
    const bare = resultCardModel(turn({ user: "" }), {
      runtimeKind: "html-prototype", hasPages: true,
    });
    expect(bare!.title).toBe("这一轮的成果");
    expect(bare!.title).not.toContain("t1");
  });
});

describe("缩略图：拿不到就是没有", () => {
  it("反向：今天恒为 null——截图服务只在生成过程里做自检，没落成会话产物", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true,
    });
    expect(model!.thumbnailUrl).toBeNull();
  });

  it("正向：真给了地址才显示（留着入口，但不自己去别处拼）", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true,
      thumbnailUrl: "/sliderule/freeform-preview/p1.png",
    });
    expect(model!.thumbnailUrl).toBe("/sliderule/freeform-preview/p1.png");
  });

  it("反向：空白字符串当成没有，不许渲染一个断图", () => {
    const model = resultCardModel(turn(), {
      runtimeKind: "html-prototype", hasPages: true, thumbnailUrl: "   ",
    });
    expect(model!.thumbnailUrl).toBeNull();
  });
});

describe("通电：真的接在完成轮的渲染上（§3）", () => {
  it("SlideRule.tsx 必须渲染 TurnResultCard，而且喂的是真数据", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/SlideRule.tsx"), "utf8"
    );
    // ⚠ 用带边界的正则，不用 toContain。2026-09-14 变异时逮到：
    //   `toContain("<TurnResultCard")` 在改名成 `<TurnResultCardXX` 之后
    //   **照样绿**（子串还在），判据等于没写。§2 那条「把修复改回去要变红」
    //   就是这么被糊弄过去的。
    expect(src).toMatch(/<TurnResultCard[\s/>]/);
    expect(src).toContain("projectRevision={ctx.projectRevision}");
    expect(src).toContain("hasPages={Boolean(turn.main)}");
    expect(src).toContain("deliverableKind={deliverableKind}");
    expect(src).toContain("hasOfficeArtifact={hasOfficeArtifact}");
    expect(src).toMatch(/useOfficeArtifactPresent\(/);
    expect(src).not.toMatch(/hasOfficeArtifact=\{true\}/);
    // 反向：不许挂在还在跑的那一支上（那会让卡片在跑的过程中闪出来）
    const streamingBranch = src.slice(
      src.indexOf('turn.status === "streaming" ? ('),
      src.indexOf("<TurnPhaseTimeline")
    );
    expect(streamingBranch).not.toContain("<TurnResultCard");
  });

  it("出卡必须看这一轮是否写了源码，不能只看会话 revision", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/sliderule/turn-result-card.ts"),
      "utf8"
    );
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const start = code.indexOf("export function resultCardModel");
    const next = code.indexOf("export function", start + "export function resultCardModel".length);
    const fn = code.slice(start, next === -1 ? code.length : next);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(fn).toContain("turnDeliveredProject");
    expect(fn).toContain("turnDeliveredOfficeFile");
    expect(fn).toContain("hasOfficeArtifact");
    expect(fn).toContain("isOfficeFileDeliverable");
  });
});
