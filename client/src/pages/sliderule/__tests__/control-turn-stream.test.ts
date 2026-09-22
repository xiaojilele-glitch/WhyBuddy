/**
 * 产品新烧 POST /control-turn-stream；续播 GET /runs/{id}/stream。
 *
 * 反向：
 *   · 把产品路径改回 POST /drive-full-stream → 剥注释后计数不再是 0
 *   · 删掉 postControlTurnStream 里的 installedSkillsDrivePayload → 六字段红
 *   · pythonDrive 空结果再挂 driveReasoningSession → 本文件红
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { consumeControlStreamResponse } from "../../../lib/sliderule-marathon-driver";

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

describe("干预字段一路带到 POST（三段都得接上）", () => {
  /*
   * ⚠ 这条钉的是**中间那一段**：runTurn 把 intervention 上的
   *   targetArtifactId / answeredGapIds 交给 driveStream。
   *   两头各有自己的判据——
   *     客户端出口：control-post-carries-intervention.test.ts（真 fetch body）
   *     服务端入口：test_challenge_and_gaps_reach_state.py（真 HTTP + 真状态）
   *   ——唯独中间这一段只存在于 hook 里，测不动，所以在源码上钉。
   *   2026-08-27 断的正是这一段：两头都写好了，中间没接。
   */
  const runTurn = SESSION.slice(
    SESSION.indexOf("const runTurn = async"),
    SESSION.indexOf("const requestRehearsal = async")
  );

  it("runTurn 把 targetArtifactId / answeredGapIds 交给 driveStream", () => {
    expect(runTurn).toContain("intervention?.targetArtifactId");
    expect(runTurn).toContain("intervention?.answeredGapIds");
    expect(runTurn).toContain("intervention?.answeredGaps");
    const opts = runTurn.slice(runTurn.indexOf("driveStream(preparedState"));
    expect(opts).toContain("targetArtifactId:");
    expect(opts).toContain("answeredGapIds:");
  });

  it("反向：这两样只能挂在**新烧**那一支，续播不许带", () => {
    const resume = runTurn.slice(
      runTurn.indexOf("resumeDriveFullStream"),
      runTurn.indexOf("driveStream(preparedState")
    );
    expect(resume).not.toContain("targetArtifactId");
    expect(resume).not.toContain("answeredGapIds");
  });
});

describe("产品客户端不得再 POST 工厂流", () => {
  it("useSlideRuleSession 剥注释后 POST /drive-full-stream 与 /drive-full 都是 0", () => {
    expect(countNeedle(SESSION, "/drive-full-stream")).toBe(0);
    expect(countNeedle(SESSION, "/drive-full")).toBe(0);
    expect(SESSION).toContain("postControlTurnStream");
    expect(SESSION).not.toContain("driveFullViaPythonStream");
  });

  it("续播仍是 GET /runs/{id}/stream", () => {
    expect(DRIVER).toContain("/api/sliderule/runs/");
    expect(DRIVER).toContain("/stream?since=0");
    const resumeFn = DRIVER.slice(
      DRIVER.indexOf("export async function resumeDriveFullStream"),
      DRIVER.indexOf("type FactoryStreamAcc")
    );
    expect(resumeFn).not.toContain("control-turn-stream");
    expect(resumeFn.toLowerCase()).not.toContain('method: "post"');
    const pythonDrive = SESSION.slice(
      SESSION.indexOf("const pythonDrive = resumeRun"),
      SESSION.indexOf("classifyStreamFallback")
    );
    expect(pythonDrive.indexOf("resumeDriveFullStream")).toBeGreaterThanOrEqual(
      0
    );
    expect(pythonDrive.indexOf("resumeDriveFullStream")).toBeLessThan(
      pythonDrive.indexOf("driveStream(")
    );
  });

  it("runTurn python 空结果不得回落 driveReasoningSession", () => {
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("控制面未返回结果");
    const nullArm = runTurn.slice(runTurn.indexOf("if (!pythonDrive)"));
    expect(nullArm).toContain("throw new Error");
    expect(nullArm).not.toContain("driveReasoningSession");
    expect(runTurn).not.toContain("driveReasoningSession");
  });

  it("删掉 driveFullViaPythonStream 之后产品 POST 仍带 installedSkillsDrivePayload", () => {
    expect(SESSION).not.toContain("driveFullViaPythonStream");
    const postFn = DRIVER.slice(
      DRIVER.indexOf("export async function postControlTurnStream"),
      DRIVER.indexOf("export async function consumeControlStreamResponse")
    );
    expect(postFn).toContain("installedSkillsDrivePayload()");
    expect(postFn).not.toContain("selectedSkillsDrivePayload()");
    expect(postFn).toContain("mentionedSkillSlugs");
    expect(postFn).toContain("selectedSkills");
    expect(postFn).toContain("pickedConnectorIds");
    expect(postFn).toContain("sessionId: state.sessionId");
    expect(postFn).toContain("userText");
    expect(postFn).toContain("preferredDevice");
    expect(postFn).toContain("productArchetype");
    expect(postFn).toContain("opts.productArchetype");
    expect(postFn).toContain("opts.tools");
    expect(postFn).toContain("designSystemId");
    expect(postFn).toContain("/api/sliderule/control-turn-stream");
    expect(postFn).toContain("toolAnswer");
    expect(postFn).toContain("opts.toolAnswer");
    expect(postFn).toContain("reuseCharter");
    expect(postFn).toContain("productCharter");
    expect(postFn).toContain("opts.reuseCharter !== undefined");
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).not.toContain("loadCharterReuseNext()");
  });

  it("反向：输入条不许再接 SkillSelectBar；POST 点名不是勾选存档", () => {
    expect(DOCK).not.toContain("SkillSelectBar");
    expect(DOCK).not.toContain("skill-select-bar");
    expect(DOCK).toContain("installedSkillSlashItems");
    expect(DOCK).toContain("applySkillSlashPick");
    const postFn = DRIVER.slice(
      DRIVER.indexOf("export async function postControlTurnStream"),
      DRIVER.indexOf("export async function consumeControlStreamResponse")
    );
    expect(postFn).not.toContain("selectedSkillsDrivePayload()");
    expect(postFn).toContain("mentionedSkillSlugs");
    expect(postFn).toContain("selectedSkills");
  });
});

describe("开始推演 / 质疑 / /推演", () => {


  it("control_clarify 只喂澄清卡，停泊时 isRunning 也要画出来", () => {
    const clarifyCase = DRIVER.slice(
      DRIVER.indexOf('case "control_clarify"'),
      DRIVER.indexOf('case "control_plan_approval"')
    );
    expect(clarifyCase).toContain("onControlClarify");
    expect(clarifyCase).not.toContain("onControlAskUser");
    const pendingFn = SESSION.slice(
      SESSION.indexOf("const pendingClarifications"),
      SESSION.indexOf("const generateDeliverables")
    );
    expect(pendingFn).toContain("pendingClarificationItems");
    expect(pendingFn).toContain("submittedClarifyIds");
    expect(pendingFn).toContain("submittedGapIds");
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("applyAnsweredGapsToState");
    const clarifyFn = SESSION.slice(
      SESSION.indexOf("const answerClarifications"),
      SESSION.indexOf("runTurn: requestRehearsal")
    );
    expect(clarifyFn).toContain("setSubmittedClarifyIds");
    expect(clarifyFn).toContain("applyAnsweredGapsToState");
    const factoryPost = DRIVER.slice(
      DRIVER.indexOf("export async function driveFullViaPythonStream"),
      DRIVER.indexOf("export async function resumeDriveFullStream")
    );
    expect(factoryPost).not.toContain("opts.tools");
  });





  it("reload 从 transcript 恢复 ask options", () => {
    const hydrate = SESSION.slice(
      SESSION.indexOf('hydrated.awaitReason === "control_ask"'),
      SESSION.indexOf("options.initialGoal")
    );
    expect(hydrate).toContain("ask_user");
    expect(hydrate).toContain("options");
    expect(hydrate).toContain("pendingAskRef.current");
  });
});

describe("consumeControlStreamResponse 与工厂 case 共用", () => {
  it("handoff 之后走 applyFactoryStreamEvent，不复制 skill_start switch", () => {
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    expect(consume).toContain("applyFactoryStreamEvent");
    expect(consume).toContain("control_ask_user");
    expect(consume).toContain("control_clarify");
    expect(consume).toContain("control_plan_approval");
    expect(consume).toContain("control_handoff_factory");
    expect(consume).toContain("handedOff && !factoryDone");
    expect(consume).toContain('type: "factory_complete"');
    const skillStartCases = countNeedle(consume, 'case "skill_start"');
    expect(skillStartCases).toBe(0);
  });

  it("第一发 complete 不许当场 onRunSettled——那是时间片，不是整轮终局", () => {
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    const start = consume.lastIndexOf('case "complete"');
    const complete = consume.slice(start, consume.indexOf("default:", start));
    expect(complete).toContain("sawTerminal = true");
    expect(complete).not.toContain('onRunSettled?.("complete")');
    expect(complete).not.toContain("break outer");
  });

  it("刷新接回包含 waiting_continue / waiting_operation", () => {
    expect(SESSION).toContain(
      '["queued", "running", "waiting_continue", "waiting_operation"]'
    );
  });

  it("control_ask_user 回调后 complete 结束，不丢问题", async () => {
    const asked: Array<{ question: string }> = [];
    const skills: string[] = [];
    const events = [
      { type: "control_ask_user", question: "你想做什么应用？", options: [] },
      {
        type: "complete",
        state: {
          sessionId: "s1",
          goal: { text: "", status: "needs_refinement" },
          awaitReason: "control_ask",
        },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const out = await consumeControlStreamResponse(res, {
      onControlAskUser: ev => asked.push({ question: ev.question }),
      onSkillActivated: id => skills.push(String(id)),
    });
    expect(asked).toEqual([{ question: "你想做什么应用？" }]);
    expect(skills).toEqual([]);
    expect(out?.finalState?.awaitReason).toBe("control_ask");
  });

  it("control_ask_user 不经 onControlHostText，避免盖掉已经开口的话", async () => {
    const host: string[] = [];
    const events = [
      { type: "control_text", text: "我是面团，可以把一句话推演成能点的应用。" },
      {
        type: "control_ask_user",
        question: "想做什么应用，说一句就行。",
        options: [],
      },
      { type: "complete", state: { sessionId: "s1", awaitReason: "control_ask" } },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    await consumeControlStreamResponse(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      { onControlHostText: text => host.push(text) }
    );
    expect(host).toEqual(["我是面团，可以把一句话推演成能点的应用。"]);
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    const askCase = consume.slice(
      consume.indexOf('case "control_ask_user"'),
      consume.indexOf('case "control_clarify"')
    );
    expect(askCase).not.toContain("onControlHostText");
  });

  it("control_clarify 只喂澄清卡，不叠一张 ask，事件自带 kindLabel", async () => {
    const clarified: Array<{
      label?: string;
      productStep?: number;
      questions: Array<{ kindLabel?: string | null }>;
    }> = [];
    const asked: unknown[] = [];
    const events = [
      {
        type: "control_clarify",
        label: "澄清与取证",
        productStep: 1,
        questions: [
          {
            id: "g1",
            prompt: "这个诊所系统主要给谁用？",
            kind: "users",
            kindLabel: "谁用",
          },
        ],
      },
      {
        type: "complete",
        state: {
          sessionId: "s1",
          awaitReason: "control_clarify",
        },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    await consumeControlStreamResponse(res, {
      onControlClarify: ev => clarified.push(ev),
      onControlAskUser: ev => asked.push(ev),
    });
    expect(asked).toEqual([]);
    expect(clarified).toHaveLength(1);
    expect(clarified[0].label).toBe("澄清与取证");
    expect(clarified[0].productStep).toBe(1);
    expect(clarified[0].questions[0].kindLabel).toBe("谁用");
  });

  it("为什么停：结构化字段一路带到回调，四种停法在前端分得开", async () => {
    /* ⚠ 服务端 2026-08-27 起把停止原因当数据发（抄 grok 的
       StopCancelledReason + CancelledBy + turn_hook 的 cancellation_context）。
       只加服务端字段、消费侧照旧 `String(event.text)`，就是本仓第四条：
       生成侧改了、消费侧没改，四种停法在前端**仍然长得一模一样**。
       变异：把 driver 里 control_text 那支的第二个参数删掉 → 本条红。 */
    const seen: Array<[string, unknown]> = [];
    const events = [
      {
        type: "control_text",
        text: "来回想了好几轮还没定下来",
        stopReason: "tool_rounds",
        stoppedBy: "runtime",
        limit: 8,
        used: 8,
      },
      { type: "complete", state: { sessionId: "s1" } },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    await consumeControlStreamResponse(res, {
      onControlText: (t, stop) => seen.push([t, stop]),
    });
    expect(seen).toHaveLength(1);
    const [, stop] = seen[0] as [string, Record<string, unknown>];
    expect(stop).toEqual({
      stopReason: "tool_rounds",
      stoppedBy: "runtime",
      limit: 8,
      used: 8,
    });
  });

  it("反向：正常的一句话不许凭空长出 stop 字段", async () => {
    /* 没有这条，把 stop 写成恒 `{stopReason:"unknown"}` 也能让上一条绿——
       那样每一句普通回复都变成"停了"（CLAUDE.md §3）。 */
    const seen: Array<unknown> = [];
    const body =
      `data: ${JSON.stringify({ type: "control_text", text: "你好" })}\n\n` +
      `data: ${JSON.stringify({ type: "complete", state: { sessionId: "s1" } })}\n\n`;
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    await consumeControlStreamResponse(res, {
      onControlText: (_t, stop) => seen.push(stop),
    });
    expect(seen).toEqual([undefined]);
  });

  it("hook 把 stop 接住了——不接就是只改了生成侧", () => {
    /* 变异：把 useSlideRuleSession 里 `if (stop) lastControlStopRef...` 删掉
       → 本条红。 */
    expect(SESSION).toContain("onControlText: (text, stop) =>");
    expect(SESSION).toContain("lastControlStopRef.current = stop");
  });

  it("control_tool_result 人话只进 onControlText 一次，不得双写", async () => {
    const texts: string[] = [];
    const tools: unknown[] = [];
    const events = [
      {
        type: "control_tool_result",
        tool: "inspect_model",
        ok: true,
        digest: "appName: 请假审批",
        human: "当前模型摘要（有界，不是原始五系统 JSON）。",
      },
      {
        type: "complete",
        state: {
          sessionId: "s1",
          goal: { text: "请假系统", status: "clear" },
        },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    await consumeControlStreamResponse(res, {
      onControlText: text => texts.push(text),
      onControlToolResult: event => tools.push(event),
    });
    expect(tools).toHaveLength(1);
    expect(texts).toEqual(["当前模型摘要（有界，不是原始五系统 JSON）。"]);
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    expect(consume).toContain("onControlToolResult");
    expect(consume).toContain("onControlText");
    const streamOpts = SESSION.slice(
      SESSION.indexOf("onControlText:"),
      SESSION.indexOf("onControlAskUser:")
    );
    expect(streamOpts).not.toContain("onControlToolResult");
  });

  it("handoff 后未改名的工厂 complete 不断流（抄 grok ToolLoop::Continue）", async () => {
    const texts: string[] = [];
    const settled: string[] = [];
    const events = [
      { type: "control_handoff_factory", runId: "run-1" },
      { type: "complete", state: { sessionId: "s1", goal: { text: "工厂态" } } },
      { type: "control_text", text: "页面已经出来，要改哪一页说一声。" },
      {
        type: "complete",
        state: { sessionId: "s1", goal: { text: "请假系统", status: "clear" } },
      },
      { type: "control_run_settled", status: "completed", error: null },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const out = await consumeControlStreamResponse(res, {
      onControlText: text => texts.push(text),
      onRunSettled: reason => settled.push(reason),
    });
    expect(texts).toContain("页面已经出来，要改哪一页说一声。");
    expect(settled).toEqual(["complete"]);
    expect(out?.finalState?.goal?.text).toBe("请假系统");
  });

  it("factory_complete 不断流，后面的控制面文字还能读到", async () => {
    const texts: string[] = [];
    const events = [
      { type: "control_handoff_factory", runId: "run-1" },
      { type: "factory_complete", state: { sessionId: "s1" } },
      {
        type: "control_tool_result",
        tool: "rehearse",
        human: "工厂摘要",
      },
      { type: "control_text", text: "页面已经出来，要改哪一页说一声。" },
      {
        type: "complete",
        state: { sessionId: "s1", goal: { text: "请假系统", status: "clear" } },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const out = await consumeControlStreamResponse(res, {
      onControlText: text => texts.push(text),
    });
    expect(texts).toContain("工厂摘要");
    expect(texts).toContain("页面已经出来，要改哪一页说一声。");
    expect(out?.finalState?.goal?.text).toBe("请假系统");
  });

  it("工具摘要人话不进 onControlHostText（那才是主 Agent 开口）", async () => {
    const host: string[] = [];
    const events = [
      { type: "control_handoff_factory", runId: "run-1" },
      { type: "factory_complete", state: { sessionId: "s1" } },
      { type: "control_tool_result", tool: "rehearse", human: "当前模型摘要（有界，不是原始五系统 JSON）。" },
      { type: "control_text", text: "页面已经出来，要改哪一页说一声。" },
      { type: "complete", state: { sessionId: "s1" } },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    await consumeControlStreamResponse(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      { onControlHostText: text => host.push(text) }
    );
    expect(host).toEqual(["页面已经出来，要改哪一页说一声。"]);
  });

  it("提问事件把问题写进 hostSpeechRef（左栏才有回答）", () => {
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    const ask = runTurn.slice(
      runTurn.indexOf("onControlAskUser:"),
      runTurn.indexOf("onControlClarify:")
    );
    expect(ask).toContain("hostSpeechRef.current");
    expect(ask).toContain("!hostSpeechRef.current");
  });

  it("工厂后的 control_text 写进本轮 assistant（主 Agent 开口）", () => {
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("hostSpeechRef");
    expect(runTurn).toContain("assistantSource = \"llm\"");
  });
});
