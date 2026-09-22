/**
 * 斜杠推演动词走控制面；运行中发送排队，停止是另一颗方块。
 *
 * 判据必须能被变异咬住：
 *   · 只改 doSend、sendMessage 仍 stop() → 本文件 sendMessage 那条红
 *   · 发送键 title 再变回「停止」→ 查询发送钮的那条红
 *   · 队列 flush 挪到 isRunningRef=false 之前 → 第二发被 runTurn 拒掉
 *   · resetSession 不清 queuedTurnRef → 遗留队列劫持后来无关发送
 *   · /推演 客户端带 forcedTool rehearse → 空会话 yolo 点火
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  controlUserTextForSlash,
  forcedToolForRehearsalVerb,
  parseRehearsalSlash,
} from "../composer-slash";
import {
  inferForcedTool,
  previousModelVersionId,
} from "../useSlideRuleSession";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SESSION = stripComments(
  readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
);
const DRIVER = stripComments(
  readFileSync(
    new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url),
    "utf8"
  )
);
const DOCK = stripComments(
  readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
);
const MENU = stripComments(
  readFileSync(new URL("../ComposerSlashMenu.tsx", import.meta.url), "utf8")
);
const PAGE = stripComments(
  readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
);

function countNeedle(src: string, needle: string): number {
  let n = 0;
  let from = 0;
  while (from <= src.length) {
    const at = src.indexOf(needle, from);
    if (at < 0) return n;
    n += 1;
    from = at + needle.length;
  }
  return n;
}

const sendMessageFn = SESSION.slice(
  SESSION.indexOf("const sendMessage"),
  SESSION.indexOf("const repairGaps")
);
const doSend = DOCK.slice(
  DOCK.indexOf("const doSend = React.useCallback"),
  DOCK.indexOf("const slashPool")
);
const runTurn = SESSION.slice(
  SESSION.indexOf("const runTurn = async"),
  SESSION.indexOf("const requestRehearsal = async")
);
const stopFn = SESSION.slice(
  SESSION.indexOf("const stop ="),
  SESSION.indexOf("resumeAttemptedRef")
);
const resetFn = SESSION.slice(
  SESSION.indexOf("const resetSession"),
  SESSION.indexOf("const pendingClarifications")
);
const retryFn = SESSION.slice(
  SESSION.indexOf("const retryCapability"),
  SESSION.indexOf("const challengeTurn")
);
const sendBtn = DOCK.slice(
  DOCK.indexOf("const sendButton ="),
  DOCK.indexOf("return (", DOCK.indexOf("const sendButton ="))
);
const stopBtn = DOCK.slice(
  DOCK.indexOf("const stopButton"),
  DOCK.indexOf("const sendButton =")
);

describe("sendMessage 运行中排队，不许 stop", () => {
  it("活路径 sendMessage 在 isRunningRef 时入队并 return，不调用 stop", () => {
    expect(sendMessageFn).toContain("isRunningRef.current");
    /* ⚠ 2026-08-27：这里原来钉的是**字面** `queuedTurnRef.current = text`。
       队列从"一个看不见的 ref、后来居上覆盖"改成"可见、可撤、会累积"之后
       那句合法地变了，判据就红了——而它想说的（运行中入队、不 stop）
       一件没变。本仓第二条：盯语义，别盯某句话的字面。 */
    expect(sendMessageFn).toContain("pushQueuedTurn(text)");
    expect(sendMessageFn).toContain("requestRehearsal");
    // 反向：把 stop() 加回 sendMessage（只改 doSend 不够）这条必红。
    expect(sendMessageFn).not.toContain("stop()");
    expect(sendMessageFn).not.toContain("stop(");
    const queueArm = sendMessageFn.slice(
      sendMessageFn.indexOf("if (isRunningRef.current)"),
      sendMessageFn.indexOf("await requestRehearsal")
    );
    expect(queueArm).toContain("pushQueuedTurn(text)");
    expect(queueArm).not.toContain("requestRehearsal");
    expect(queueArm).toContain("return");
  });

  it("sliderule:resend-prompt 走 sendMessage，不走 doSend", () => {
    const resendListen = 'addEventListener("sliderule:resend-prompt"';
    expect(PAGE).toContain(resendListen);
    const resend = PAGE.slice(
      PAGE.indexOf(resendListen) - 280,
      PAGE.indexOf(resendListen) + 160
    );
    expect(resend).toContain("sendMessageRef.current");
    expect(resend).not.toContain("doSend");
    expect(resend).not.toContain("stop(");
  });

  it("doSend 运行中仍调 sendMessage，不改成 stop", () => {
    expect(doSend).toContain("sendMessage");
    expect(doSend).not.toContain("stop(");
    expect(doSend).not.toContain("isRunning ? stop");
    expect(doSend).toContain("isComposerSendBlocked");
  });
});

describe("本轮 finally 才 flush 一发控制面", () => {
  it("runTurn 再入 fail-closed 拒第二发，finally 先松闸再 flush", () => {
    const reentry = runTurn.slice(
      runTurn.indexOf("if (isRunningRef.current)"),
      runTurn.indexOf("const turnId")
    );
    expect(reentry).toContain("return");
    expect(reentry).not.toContain("stop(");
    expect(reentry).not.toContain("queuedTurnRef");

    const fin = runTurn.slice(runTurn.lastIndexOf("} finally {"));
    expect(fin.indexOf("isRunningRef.current = false")).toBeGreaterThanOrEqual(0);
    expect(fin.indexOf("isRunningRef.current = false")).toBeLessThan(
      fin.indexOf("flushQueuedControlTurn()")
    );
    expect(SESSION).toContain("requestRehearsalRef.current(text)");
    expect(SESSION).toContain("await requestRehearsal(userText)");
  });

  it("retryCapability finally 同样 flush，避免能力重试把队列吞掉", () => {
    const fin = retryFn.slice(retryFn.lastIndexOf("} finally {"));
    expect(fin.indexOf("isRunningRef.current = false")).toBeLessThan(
      fin.indexOf("flushQueuedControlTurn()")
    );
  });

  it("Stop 保留队列；resetSession 必须清掉", () => {
    expect(stopFn).toContain("cancelActiveRunOnServer");
    // 同上：清队列现在写成 `= []`（队列是数组了），语义不变
    expect(stopFn).not.toContain("queuedTurnRef.current = []");
    expect(resetFn).toContain("queuedTurnRef.current = []");
  });
});

describe("发送键不是停止；停止是独立方块", () => {
  it("发送钮 title/aria 在运行中是排队，查询发送钮不得读到停止", () => {
    expect(sendBtn).toContain('data-testid="sliderule-composer-send"');
    expect(sendBtn).toContain("onClick={doSend}");
    expect(sendBtn).toContain('isRunning ? "排队" : "发送"');
    expect(sendBtn).toContain('"排队"');
    expect(sendBtn).toContain("ArrowUp");
    // 反向：发送再变成停止，title/role 这条必红。
    expect(sendBtn).not.toContain("停止");
    expect(sendBtn).not.toContain("onClick={stop");
    expect(sendBtn).not.toContain("isRunning ? stop");
    expect(sendBtn).not.toContain("Square");
  });

  it("停止是另一颗 data-testid=sliderule-composer-stop 的方块", () => {
    expect(stopBtn).toContain('data-testid="sliderule-composer-stop"');
    expect(stopBtn).toContain('title="停止"');
    expect(stopBtn).toContain('aria-label="停止"');
    expect(stopBtn).toContain("Square");
    expect(stopBtn).toContain("stop?.()");
    expect(stopBtn).not.toContain("doSend");
    expect(stopBtn).not.toContain("sliderule-composer-send");
    // 发送/停止都在卡片底栏里。变异把它们再拎到胶囊外必红。
    expect(DOCK).not.toContain("{hero ? null : stopButton}");
    expect(DOCK).not.toContain("{hero ? null : sendButton}");
    const sendCluster = DOCK.slice(
      DOCK.indexOf("col-start-4 row-start-2"),
      DOCK.indexOf("{slash ?")
    );
    expect(sendCluster).toContain("{refineButton}");
    expect(sendCluster).toContain("{stopButton}");
    expect(sendCluster).toContain("{sendButton}");
  });

  it("输入框推演中仍可打字（停泊卡才锁）", () => {
    const inputAt = DOCK.indexOf('data-testid="sliderule-composer-input"');
    const ta = DOCK.slice(DOCK.lastIndexOf("disabled={", inputAt), inputAt);
    /*
     * ⚠ 2026-08-27：这条原来钉的是**整句字面**
     *   `disabled={Boolean(pendingScope) || Boolean(pendingAsk)}`。
     *   放开"开放式提问可以打字回答"时那句合法地变了，判据就红了——而它
     *   想说的两件事一件没变。本仓第二条：盯语义，别盯某句话的字面。
     *   现在钉语义：范围卡照锁、推演中不锁；提问那半边由
     *   `askBlocksTyping`（open-ask-is-answerable.test.ts）说了算。
     */
    expect(ta).not.toContain("pendingScope");
    expect(ta).toContain("askBlocksTyping(pendingAsk)");
    expect(ta).not.toContain("isRunning");
  });
});

describe("斜杠动词走控制面，客户端 /推演 不得 yolo", () => {
  it("inferForcedTool 是 runTurn 真正传给控制面的那一处", () => {
    expect(runTurn).toContain("inferForcedTool(");
    expect(runTurn).toContain("forcedTool: inferredTool");
    expect(inferForcedTool("/推演")).toBeUndefined();
    expect(inferForcedTool("/推演 请假系统")).toBeUndefined();
    expect(inferForcedTool("/精修")).toBe("refine");
    expect(inferForcedTool("/精修 把按钮改红")).toBe("refine");
    expect(inferForcedTool("/质疑")).toBe("challenge");
    expect(inferForcedTool("/范围")).toBe("enter_plan_mode");
    expect(inferForcedTool("/回退")).toBe("restore_version");
    expect(inferForcedTool("转向请假")).toBeUndefined();
    expect(inferForcedTool("https://miantuan.ai")).toBeUndefined();
    // 反向：把 /推演 映射成 rehearse，空会话会跳过停泊直接点火。
    expect(inferForcedTool("/推演")).not.toBe("rehearse");
    // 收尾卡点下去是 typed 答案：标签里的 Structure = structure。
    expect(inferForcedTool("进入数据模型反推（Structure）")).toBe("structure");
    expect(inferForcedTool("进入权限绑定（bind）")).toBe("bind");
    expect(inferForcedTool("闭环发布管理系统")).toBeUndefined();
    // ⚠ 2026-09-07 真机水果店：芯片「精修（refine）」必须 POST refine，
    // 不许当新话题让控制面重猜。首轮没有交付物时仍不算。
    expect(inferForcedTool("精修（refine）")).toBe("refine");
    expect(inferForcedTool("refine")).toBe("refine");
    expect(
      inferForcedTool("精修（refine）", undefined, undefined, "bind")
    ).toBe("refine");
    expect(
      inferForcedTool("精修（refine）", undefined, undefined, undefined, true)
    ).toBeUndefined();
    expect(inferForcedTool("开始推演（rehearse）")).toBeUndefined();
    expect(
      inferForcedTool("进入数据模型反推（Structure）", undefined, undefined, "pages")
    ).toBe("structure");
    expect(
      inferForcedTool("假设已确认。继续画页面。", undefined, undefined, "pages")
    ).toBe("pages");
    expect(
      inferForcedTool("做一个门店客户数据结构管理台", undefined, undefined, "rehearse")
    ).toBe("rehearse");
    expect(
      inferForcedTool("把权限绑定那一栏改成扫码", undefined, undefined, "refine")
    ).toBe("refine");
    expect(forcedToolForRehearsalVerb(parseRehearsalSlash("/推演"))).toBeUndefined();
  });

  it("确认范围才带 rehearse；推断函数本身不含这个字面", () => {
    const inferFn = SESSION.slice(
      SESSION.indexOf("export function inferForcedTool"),
      SESSION.indexOf("export function previousModelVersionId")
    );
    expect(inferFn).toContain("parseRehearsalSlash");
    expect(inferFn).toContain("forcedToolForRehearsalVerb");
    expect(inferFn).toContain("closedToolFromText");
    expect(inferFn).not.toContain('"rehearse"');
    expect(inferFn).not.toContain('"/推演"');
    expect(SESSION).not.toContain("confirmControlScope");
  });

  it("ComposerDock 斜杠池接计划 + 已装技能；选中计划补全命令不进芯片", () => {
    const pool = DOCK.slice(
      DOCK.indexOf("const slashPool"),
      DOCK.indexOf("const partnerById")
    );
    expect(pool).toContain("COMPOSER_SLASH_REHEARSAL_ITEMS");
    expect(pool).toContain("installedSkillSlashItems");
    // 反向：整份工厂目录进池，空会话又会冒出推演/精修
    expect(pool).not.toContain("REHEARSAL_SLASH_ITEMS");
    expect(pool).not.toContain("BUILTIN_PARTNERS");
    expect(pool).not.toContain("loadInstalledSkills");
    expect(pool).not.toContain("listConnectors");
    const pick = DOCK.slice(
      DOCK.indexOf("const pickCapability"),
      DOCK.indexOf("const removeCapability")
    );
    expect(pick).toContain('item.kind === "rehearsal"');
    expect(pick).toContain("applyRehearsalSlashPick");
    expect(pick).toContain('item.kind === "skill"');
    expect(pick).toContain("applySkillSlashPick");
    expect(MENU).toContain('rehearsal: "计划"');
    expect(MENU).not.toContain('rehearsal: "推演"');
    expect(MENU).toContain('["rehearsal", "partner", "connector", "skill"]');
  });
});

describe("停泊 overlay 时 flush 不得清卡", () => {
  it("flushQueuedControlTurn 在 pendingScopeRef/pendingAskRef 时 return，队列留下", () => {
    const flushFn = SESSION.slice(
      SESSION.indexOf("const overlayBlocksQueueFlush"),
      SESSION.indexOf("const submitQuestionnaire")
    );
    expect(flushFn).toContain("pendingPlanApprovalRef.current");
    expect(flushFn).toContain("pendingAskRef.current");
    expect(flushFn).toContain("if (overlayBlocksQueueFlush()) return");
    expect(flushFn.indexOf("overlayBlocksQueueFlush()")).toBeGreaterThanOrEqual(
      0
    );
    /* ⚠ 2026-09-09：这一行原来钉的是 `queuedTurnRef.current = []`。
       合并规则照 grok 改成前缀合并之后，flush 里写的是
       `queuedTurnRef.current = rest`（没合并的那几条要留着），
       旧字面 indexOf 变成 -1，判据在量一个不存在的位置。
       **意图没变**：overlay 闸必须排在动队列**之前**。键跟着新写法走。 */
    expect(flushFn.indexOf("overlayBlocksQueueFlush()")).toBeLessThan(
      flushFn.indexOf("queuedTurnRef.current = rest")
    );
    expect(flushFn.indexOf("overlayBlocksQueueFlush()")).toBeLessThan(
      flushFn.indexOf("requestRehearsalRef.current")
    );
  });

  it("确认/先改范围/关掉提问之后才 flush，确认前不得清卡", () => {
    const dismissAskFn = SESSION.slice(
      SESSION.indexOf("const dismissAsk"),
      SESSION.indexOf("const stop =")
    );
    expect(dismissAskFn).toContain("pendingAskRef.current = null");
    expect(dismissAskFn.indexOf("pendingAskRef.current = null")).toBeLessThan(
      dismissAskFn.indexOf("flushQueuedControlTurn()")
    );
  });
});

describe("/回退 带上一版 versionId；/范围 复述不是斜杠令牌", () => {
  it("runTurn 把 previousModelVersionId 写进 POST versionId", () => {
    expect(runTurn).toContain("previousModelVersionId");
    expect(runTurn).toContain("versionId: restoreId");
    expect(runTurn).toContain("controlUserTextForSlash");
    const postFn = DRIVER.slice(
      DRIVER.indexOf("export async function postControlTurnStream"),
      DRIVER.indexOf("export async function consumeControlStreamResponse")
    );
    expect(postFn).toContain("opts.versionId");
    expect(postFn).toContain("versionId: opts.versionId");
    expect(
      previousModelVersionId({
        modelVersions: [{ id: "v1" }, { id: "v2" }],
        currentModelVersionId: "v2",
      })
    ).toBe("v1");
    expect(
      previousModelVersionId({
        modelVersions: [{ id: "v1" }],
        currentModelVersionId: "v1",
      })
    ).toBeUndefined();
    expect(previousModelVersionId({ modelVersions: [] })).toBeUndefined();
  });

  it("活路径 /范围 发给控制面的不是斜杠令牌", () => {
    expect(controlUserTextForSlash("/范围", "请假系统")).toBe("请假系统");
    expect(inferForcedTool("/范围")).toBe("enter_plan_mode");
    expect(inferForcedTool("/回退")).toBe("restore_version");
  });
});

describe("产品源码剥注释后不得 POST 工厂流", () => {
  it("本 PR 改动的文件剥注释后 /drive-full-stream 与 /drive-full 都是 0", () => {
    expect(countNeedle(SESSION, "/drive-full-stream")).toBe(0);
    expect(countNeedle(SESSION, "/drive-full")).toBe(0);
    expect(countNeedle(DOCK, "/drive-full-stream")).toBe(0);
    expect(countNeedle(DOCK, "/drive-full")).toBe(0);
    expect(SESSION).toContain("postControlTurnStream");
    expect(SESSION).not.toContain("driveFullViaPythonStream");
  });
});
