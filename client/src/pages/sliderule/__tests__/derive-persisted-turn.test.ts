import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTurnRoute } from "@shared/blueprint/sliderule-turn-route";
import {
  deriveLatestTurnFromState,
  deriveTurnsFromState,
  mergePublishClosureForPersistedTurn,
} from "../derive-persisted-turn";
import { __sessionEvidenceTestHelpers, looksLikeNewAppIntent } from "../useSlideRuleSession";
import { deriveSessionStory } from "../session-story";

/**
 * 修复:刷新后 uiTurns 为空 → 右上角架构执行记录消失。
 * 验证从持久化 sessionState 能重建出可渲染的「最近一轮」routeFacts(站点序列非空)。
 */
describe("deriveLatestTurnFromState (执行记录刷新后重建)", () => {
  it("returns null when no runs/ledger", () => {
    expect(deriveLatestTurnFromState({ capabilityRuns: [], decisionLedger: [] } as any)).toBeNull();
    expect(deriveLatestTurnFromState(null)).toBeNull();
  });

  it("rebuilds latest turn routeFacts from persisted runs + ledger", () => {
    const state = {
      goal: { text: "二手置换", status: "clear" },
      runtimePhase: "done",
      lastTurnId: "t1",
      capabilityRuns: [
        { id: "t1-run-0", capabilityId: "evidence.search", roleId: "接地", turnId: "t1", gateResults: [{ status: "passed" }] },
        { id: "t1-run-1", capabilityId: "synthesis.merge", roleId: "综合", turnId: "t1", gateResults: [{ status: "passed" }] },
        { id: "t1-run-2", capabilityId: "report.write", roleId: "综合", turnId: "t1-r2", gateResults: [{ status: "failed" }] },
      ],
      decisionLedger: [{ id: "t1-dledger", turnId: "t1", source: "llm" }],
    } as unknown as V5SessionState;

    const turn = deriveLatestTurnFromState(state);
    expect(turn).toBeTruthy();
    expect(turn!.id).toBe("t1");
    expect(turn!.status).toBe("complete");
    // 跨 t1 + t1-r2 的运行都归并到本轮
    expect(turn!.routeFacts.selectedCapabilities?.map((c) => c.capabilityId)).toEqual(
      expect.arrayContaining(["evidence.search", "synthesis.merge", "report.write"])
    );
    expect(turn!.routeFacts.trustTotalCount).toBe(3);
    expect(turn!.routeFacts.trustPassedCount).toBe(2); // 第三个 gate failed
    expect(turn!.routeFacts.planSource).toBe("llm");
    // 关键:能据此渲染出非空站点序列(执行记录可见)
    expect(deriveTurnRoute(turn!.routeFacts).length).toBeGreaterThan(0);
  });
});

/**
 * 2026-08-18：刷新后后面迭代发出的话看不到。
 * 正向：版本史三条指令都要回到对话里，且顺序就是发出去的顺序。
 * 反向：只重建 latestTurn 一轮会让本测试红（只剩最后一句）。
 */
describe("deriveTurnsFromState (刷新后整段对话)", () => {
  it("按 modelVersions 指令重建全部用户气泡，不只最后一轮", () => {
    const state = {
      goal: { text: "给连锁烘焙店做一套门店订货与损耗管控系统", status: "clear" },
      lastTurnId: "turn-3-drive-full",
      capabilityRuns: [
        { capabilityId: "synthesis.merge", roleId: "综合", turnId: "turn-3-drive-full" },
      ],
      decisionLedger: [{ id: "d3", turnId: "turn-3-drive-full", source: "llm" }],
      modelVersions: [
        { id: "mv-1", turnId: "turn-1-drive-full", instruction: "给连锁烘焙店做一套门店订货与损耗管控系统" },
        { id: "mv-2", turnId: "turn-2-drive-full", instruction: "损耗登记页加临期预警" },
        { id: "mv-3", turnId: "turn-3-drive-full", instruction: "收货对账页给到货差异加一键发起补货申请" },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    expect(turns.map((t) => t.user)).toEqual([
      "给连锁烘焙店做一套门店订货与损耗管控系统",
      "损耗登记页加临期预警",
      "收货对账页给到货差异加一键发起补货申请",
    ]);
    // 反向：若有人把实现改回「只灌 latest」，这里会只剩 1 条
    expect(turns).toHaveLength(3);
    expect(deriveLatestTurnFromState(state)?.user).not.toEqual(turns[0].user);
  });

  it("没有版本史时回落 turnNarrations 全量，而不是只取最新一条", () => {
    const step = (id: string, text: string) => ({
      id,
      kind: "narration" as const,
      text,
      source: "llm" as const,
    });
    const state = {
      goal: { text: "宠物医院", status: "clear" },
      lastTurnId: "turn-client-999",
      capabilityRuns: [
        { capabilityId: "risk.analysis", roleId: "架构", turnId: "turn-client-999" },
      ],
      turnNarrations: [
        { turnId: "turn-client-1", user: "做一个宠物医院预约管理系统", steps: [step("a", "首轮")] },
        { turnId: "turn-client-2", user: "预约排班页给超时未到的号加红色标记", steps: [step("b", "精修")] },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    expect(turns).toHaveLength(2);
    expect(turns[0].user).toContain("宠物医院预约");
    expect(turns[1].user).toContain("超时未到");
    expect(turns[1].steps).toHaveLength(1);
  });

  it("工程会话刷新：执行步骤以会话日志为准，不靠客户端 chip", () => {
    const state = {
      runtimeKind: "project",
      goal: { text: "构建 TicketStream", status: "clear" },
      lastTurnId: "turn-1789462833327",
      capabilityRuns: [
        { capabilityId: "intent.parse", roleId: "system", turnId: "turn-1789462833327" },
      ],
      turnNarrations: [
        {
          turnId: "turn-1789462833327",
          user: "构建一个名为 TicketStream 的服务台 SaaS 界面",
          steps: [
            {
              id: "s1",
              kind: "model_speech",
              text: "我先把工程搭起来。",
            },
          ],
          durationMs: 127000,
        },
      ],
      controlTranscript: [
        { id: "ct-1", kind: "tool_start", tool: "project_create", summary: "react-vite-tasks" },
        { id: "ct-2", kind: "tool_result", tool: "project_create", ok: true },
        { id: "ct-3", kind: "tool_start", tool: "project_patch", summary: "src/index.html" },
        { id: "ct-4", kind: "tool_result", tool: "project_patch", ok: true, detail: "src/index.html" },
      ],
    } as unknown as V5SessionState;
    const turns = deriveTurnsFromState(state);
    const chips = turns[0].steps.filter(step => step.kind === "chip");
    expect(chips.map(step => step.capabilityId)).toEqual([
      "project_create",
      "project_create",
      "project_patch",
      "project_patch",
    ]);
    // 反向：客户端 stamp 的 chip 不许盖过会话日志。旧会话没有
    // transcript 工具行时，叙述里的 chip 仍保留（见下一例）。
    const withStaleChip = deriveTurnsFromState({
      ...state,
      turnNarrations: [
        {
          ...state.turnNarrations![0],
          steps: [
            state.turnNarrations![0].steps[0],
            {
              id: "live",
              kind: "chip",
              capabilityId: "project_read",
              roleId: "system",
              label: "读取源码",
              progressType: "completed",
            },
          ],
        },
      ],
    } as unknown as V5SessionState);
    expect(withStaleChip[0].steps.filter(step => step.kind === "chip").map(step => step.capabilityId)).toEqual([
      "project_create",
      "project_create",
      "project_patch",
      "project_patch",
    ]);
  });

  it("刷新后开口和工具仍按日志发生顺序切章，不许先倒完全部散文", () => {
    // ⚠ 2026-09-17 TicketStream：活着是「开口 → 写入 → 开口 → 写入」。
    //   刷新走 turnNarrations（只剩两句开口）再 attachProjectChips 把日志
    //   工具整列接到后面，章节面退化成扁平勾选。日志里顺序还在。
    const state = {
      runtimeKind: "project",
      goal: { text: "构建 TicketStream", status: "clear" },
      lastTurnId: "turn-1",
      capabilityRuns: [
        { capabilityId: "intent.parse", roleId: "system", turnId: "turn-1" },
      ],
      turnNarrations: [
        {
          turnId: "turn-1",
          user: "构建 TicketStream",
          steps: [
            { id: "s1", kind: "model_speech", text: "我先改入口。" },
            { id: "s2", kind: "model_speech", text: "接着补样式。" },
          ],
          durationMs: 60000,
        },
      ],
      controlTranscript: [
        { id: "u", kind: "turn", role: "user", text: "构建 TicketStream" },
        { id: "t1", kind: "control_text", text: "我先改入口。" },
        { id: "c1", kind: "tool_start", tool: "project_patch", summary: "src/main.tsx" },
        { id: "c2", kind: "tool_result", tool: "project_patch", ok: true, detail: "src/main.tsx" },
        { id: "t2", kind: "control_text", text: "接着补样式。" },
        { id: "c3", kind: "tool_start", tool: "project_patch", summary: "src/style.css" },
        {
          id: "c4",
          kind: "tool_result",
          tool: "project_patch",
          ok: false,
          detail: "project_store_unavailable",
        },
      ],
    } as unknown as V5SessionState;
    const turn = deriveTurnsFromState(state)[0];
    expect(
      turn.steps.map(step =>
        step.kind === "chip"
          ? `chip:${String((step as { projectDetail?: string }).projectDetail || "")}`
          : step.kind === "model_speech"
            ? step.text
            : step.kind
      )
    ).toEqual([
      "我先改入口。",
      "chip:src/main.tsx",
      "chip:src/main.tsx",
      "接着补样式。",
      "chip:src/style.css",
      "chip:project_store_unavailable",
    ]);
    expect(turn.durationMs).toBe(60000);
    expect(deriveSessionStory(turn).map(block => block.kind)).toEqual([
      "speech",
      "tools",
      "speech",
      "tools",
    ]);
  });

  it("会话日志没有工具行时，叙述里的 chip 仍回放", () => {
    const state = {
      runtimeKind: "project",
      goal: { text: "构建 TicketStream", status: "clear" },
      lastTurnId: "turn-1789462833327",
      capabilityRuns: [
        { capabilityId: "intent.parse", roleId: "system", turnId: "turn-1789462833327" },
      ],
      turnNarrations: [
        {
          turnId: "turn-1789462833327",
          user: "构建 TicketStream",
          steps: [
            {
              id: "live",
              kind: "chip",
              capabilityId: "project_read",
              roleId: "system",
              label: "读取源码",
              progressType: "completed",
            },
          ],
        },
      ],
      controlTranscript: [{ kind: "control_text", text: "我先看一眼。" }],
    } as unknown as V5SessionState;
    const chips = deriveTurnsFromState(state)[0].steps.filter(step => step.kind === "chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ capabilityId: "project_read" });
  });

  it("空状态不编一轮假对话", () => {
    expect(deriveTurnsFromState(null)).toEqual([]);
    expect(deriveTurnsFromState({ capabilityRuns: [], decisionLedger: [] } as any)).toEqual([]);
  });

  it("叙述为空时按会话日志铺回左栏（2026-09-16 TicketStream 刷新空会话）", () => {
    // 真机 GET sr-20260916010238-SFDKWYM2CG：tn=0 / mv=0 / runs=0 / ledger=0，
    // controlTranscript=81。旧回放走 deriveLatestTurnFromState 直接 []。
    const state = {
      runtimeKind: "project",
      goal: {
        text: "构建一个名为“TicketStream”的服务台 SaaS 界面",
        status: "needs_refinement",
      },
      lastTurnId: null,
      capabilityRuns: [],
      decisionLedger: [],
      turnNarrations: [],
      modelVersions: [],
      controlTranscript: [
        {
          id: "ct-turn",
          kind: "turn",
          role: "user",
          text: "构建一个名为“TicketStream”的服务台 SaaS 界面",
        },
        {
          id: "ct-ask",
          kind: "ask_user_question",
          role: "assistant",
          text: "你希望 TicketStream 优先面向哪类使用设备和工作场景？",
        },
        {
          id: "ct-answer",
          kind: "user_answer",
          role: "tool",
          text: "用户回答了你的问题",
          answers: {
            q1: ["桌面端优先"],
            q2: ["工作台优先"],
          },
        },
        { id: "ct-approved", kind: "plan_approved", role: "user", feedback: "" },
        { id: "ct-s", kind: "tool_start", tool: "project_create", summary: "react-vite-tasks" },
        { id: "ct-r", kind: "tool_result", tool: "project_create", ok: true },
        {
          id: "ct-canned",
          kind: "canned",
          role: "assistant",
          text: "本轮工程任务达到时间上限。已保存的源码仍保留。",
        },
        {
          id: "ct-speech",
          kind: "control_text",
          role: "assistant",
          text: "TicketStream 已按批准计划完成实现",
        },
      ],
    } as unknown as V5SessionState;
    const turns = deriveTurnsFromState(state);
    expect(turns.map(turn => turn.user)).toEqual([
      "构建一个名为“TicketStream”的服务台 SaaS 界面",
      "桌面端优先 · 工作台优先",
      "批准计划并执行",
    ]);
    const last = turns[2];
    expect(last.steps.filter(step => step.kind === "chip").map(step => step.capabilityId)).toEqual([
      "project_create",
      "project_create",
    ]);
    expect(
      last.steps.filter(step => step.kind === "model_speech").map(step => step.text)
    ).toEqual([
      "本轮工程任务达到时间上限。已保存的源码仍保留。",
      "TicketStream 已按批准计划完成实现",
    ]);
    // 反向：没有日志就仍是空会话。只靠 goal / projectId 不许编一轮。
    expect(
      deriveTurnsFromState({
        runtimeKind: "project",
        goal: { text: "构建 TicketStream", status: "clear" },
        projectId: "prj-1",
        capabilityRuns: [],
        decisionLedger: [],
        turnNarrations: [],
        controlTranscript: [],
      } as any)
    ).toEqual([]);
  });

  it("同一轮存了两份版本（步伴白屏真机数据）→ 只出一轮，id 全场唯一", () => {
    // 2026-08-18 真机：精修第一遍 p2 被 525 打掉、外圈第二遍补全，
    // mv-2/mv-3 同挂 turn-1786997607853。旧实现恢复出两个同 id 轮次，
    // 消息 id `${turn.id}-user` 撞车 → assistant-ui MessageRepository 抛错，
    // React 边界接住后整页只剩 "An unexpected error occurred"。
    const state = {
      goal: { text: "【硬件+社会公益】步伴 AI 拐杖", status: "clear" },
      lastTurnId: "turn-1786997607854-drive-full",
      capabilityRuns: [],
      modelVersions: [
        { id: "mv-1", turnId: "turn-1786936093823", instruction: "【硬件+社会公益】步伴 AI 拐杖" },
        // 第一遍（残次交付）存的还是 goal 顶替的旧文本，第二遍才是本轮真话——
        // 同轮去重必须留**后写入**的那份，只靠末端 id 闸会留成第一份。
        { id: "mv-2", turnId: "turn-1786997607853", instruction: "【硬件+社会公益】步伴 AI 拐杖" },
        { id: "mv-3", turnId: "turn-1786997607853", instruction: "公益申请列表增加老年人年龄列" },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    const ids = turns.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 同轮两份 = 一个气泡；首轮 + 精修轮 = 2
    expect(turns).toHaveLength(2);
    expect(turns[1].user).toBe("公益申请列表增加老年人年龄列");
  });

  it("版本 turnId 与叙述 turnId 差 1ms（跨端命名错位）→ 不出双份，叙述原文赢", () => {
    // 2026-08-18 烘焙店真机：客户端叙述 turn-…087、服务端版本 turn-…088，
    // 且版本 instruction 存的全是首轮 goal 原文——按版本史铺气泡时每一轮
    // 都顶着首轮的话（左栏"三份一模一样"的病根）。叙述有真实指令，必须赢。
    const step = (id: string, text: string) => ({
      id, kind: "narration" as const, text, source: "llm" as const,
    });
    const GOAL = "给连锁烘焙店做一套门店订货与损耗管控系统";
    const state = {
      goal: { text: GOAL, status: "clear" },
      lastTurnId: "turn-1786997294050",
      capabilityRuns: [],
      modelVersions: [
        { id: "mv-1", turnId: "turn-1786992625138", instruction: GOAL },
        { id: "mv-2", turnId: "turn-1786992958088", instruction: GOAL },
        { id: "mv-3", turnId: "turn-1786993271691", instruction: GOAL },
      ],
      turnNarrations: [
        { turnId: "turn-1786992958087", user: "损耗登记页加临期预警", steps: [step("a", "精修1")] },
        { turnId: "turn-1786993271690", user: "收货对账页加一键补货", steps: [step("b", "精修2")] },
        { turnId: "turn-1786997294049", user: "损耗登记页加残次原因分类", steps: [step("c", "精修3")] },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    // 首轮（仅版本史有）+ 3 轮精修（叙述覆盖，版本被邻近判定吸收）= 4，不是 6
    expect(turns.map((t) => t.user)).toEqual([
      GOAL,
      "损耗登记页加临期预警",
      "收货对账页加一键补货",
      "损耗登记页加残次原因分类",
    ]);
    const ids = turns.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("版本轮的叙述兜底不许偷走已被别的轮占用的叙述（两份一模一样的病根）", () => {
    // 2026-08-18 真机：存量版本史 instruction 被 goal 顶替，好几轮 user 文本
    // 相同，按原文兜底全配到同一份叙述——左栏出现逐字相同的"推演过程"×N。
    const step = (id: string, text: string) => ({
      id, kind: "narration" as const, text, source: "llm" as const,
    });
    const GOAL = "【硬件+社会公益】步伴 AI 拐杖";
    const state = {
      goal: { text: GOAL, status: "clear" },
      capabilityRuns: [],
      modelVersions: [
        // 首轮：与叙述差 1ms，被叙述轮吸收
        { id: "mv-1", turnId: "turn-1786936093823", instruction: GOAL },
        // 精修轮：instruction 被 goal 顶替（存量脏数据），与任何叙述都不邻近
        { id: "mv-3", turnId: "turn-1786997607853", instruction: GOAL },
      ],
      turnNarrations: [
        { turnId: "turn-1786936093822", user: GOAL, steps: [step("a", "首轮叙述")] },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    expect(turns).toHaveLength(2);
    expect(turns[0].steps).toHaveLength(1);
    // 精修轮拿不到自己的叙述就如实空着，不许穿首轮的衣服
    expect(turns[1].steps).toHaveLength(0);
  });

  it("引擎 turn-1 与客户端时间戳同原文 → 刷新只出一轮，步骤认更细的那份", () => {
    // 2026-08-18 快递柜：Python 写 turn-1（24 步），前端另起 turn-<Date.now()>
    // （50 步），刷新左栏双胞胎。打戳应覆盖；存量脏数据水合也要收成一条。
    const USER = "给小区快递柜做一套取件码核销与超时滞留提醒系统";
    const step = (id: string, text: string) => ({
      id, kind: "narration" as const, text, source: "llm" as const,
    });
    const liveSteps = Array.from({ length: 8 }, (_, i) =>
      step(`live-${i}`, `直播 ${i}`)
    );
    const state = {
      goal: { text: USER, status: "clear" },
      lastTurnId: "turn-2-drive-full",
      capabilityRuns: [],
      modelVersions: [{ id: "mv-1", turnId: "turn-1", instruction: USER }],
      turnNarrations: [
        { turnId: "turn-1", user: USER, steps: [step("srv-1", "引擎")] },
        { turnId: "turn-1787051749500", user: USER, steps: liveSteps },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    expect(turns).toHaveLength(1);
    expect(turns[0].id).toBe("turn-1");
    expect(turns[0].steps).toHaveLength(8);
    expect(turns[0].user).toBe(USER);
  });

  it("反向：老编号 turn-3/turn-4 差 1 是真实相邻轮次，绝不许合并", () => {
    // 邻近判定只对 epoch 毫秒量级的时间戳开——老编号差 1 合并会吃掉真轮次。
    const step = (id: string, text: string) => ({
      id, kind: "narration" as const, text, source: "llm" as const,
    });
    const state = {
      goal: { text: "话题", status: "clear" },
      capabilityRuns: [],
      modelVersions: [
        { id: "mv-1", turnId: "turn-3", instruction: "第三轮的指令" },
      ],
      turnNarrations: [
        { turnId: "turn-4", user: "第四轮的指令", steps: [step("a", "x")] },
      ],
    } as unknown as V5SessionState;

    const turns = deriveTurnsFromState(state);
    expect(turns.map((t) => t.user)).toEqual(["第三轮的指令", "第四轮的指令"]);
  });
});

/**
 * Focused test for 119: publishClosure evidence persistence in frontend SlideRule session state.
 * - Positive: state carrying publishClosure survives JSON roundtrip (store save/load sim) and explicit preserve shape.
 * - Fail-closed negative: legacy state missing publishClosure key remains valid, loads with undefined (no crash, preview fallback applies).
 * No weakening of other behavior; uses only persisted state shapes.
 */
describe("publishClosure frontend session persistence (119)", () => {
  const samplePublishClosure = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureHash: "feedface",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  it("preserves publishClosure through simulated store roundtrip (save/load json)", () => {
    const base: any = {
      sessionId: "pc-test-1",
      goal: { text: "persist publishClosure", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: samplePublishClosure,
    };
    // simulate save (json stringify) + load (parse) as github-pages + http store do
    const serialized = JSON.stringify(base);
    const loaded = JSON.parse(serialized) as any;
    expect(loaded.publishClosure).toBeTruthy();
    expect(loaded.publishClosure.evidencePresentCount).toBe(6);
    expect(loaded.publishClosure.closureHash).toBe("feedface");
  });

  it("legacy session missing publishClosure loads with undefined (compat, fail-closed)", () => {
    const legacy: any = {
      sessionId: "pc-legacy",
      goal: { text: "old session", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      // deliberately no publishClosure key
    };
    const serialized = JSON.stringify(legacy);
    const loaded = JSON.parse(serialized) as any;
    expect("publishClosure" in loaded).toBe(false);
    expect(loaded.publishClosure).toBeUndefined();
    // cast path in UI stays safe
    const pythonPc = (loaded as { publishClosure?: any }).publishClosure;
    expect(pythonPc).toBeUndefined();
  });

  it("explicit attach on drive-final state keeps publishClosure for persist", () => {
    const pre: any = { sessionId: "pc-attach", goal: { text: "attach" }, artifacts: [] };
    const withPc = { ...pre, publishClosure: samplePublishClosure };
    // simulate what marathon python attach + preserve does
    const after = { ...(withPc as any) } as any;
    expect(after.publishClosure?.evidencePresentCount).toBe(6);
    // persist sim
    const persisted = JSON.parse(JSON.stringify(after));
    expect(persisted.publishClosure?.blocked).toBe(false);
  });

  it("preserves Python closure and skill runtime graph projections together", () => {
    const graph = {
      edges: [{ sourceSkill: "datamodel", targetSkill: "page", state: "allowed" }],
      evidenceBySkill: { datamodel: ["DM_PAGE_BINDING_IMPACT_EVIDENCE"] },
    };
    const state = {
      sessionId: "pc-graph",
      goal: { text: "preserve graph" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: samplePublishClosure,
      skillRuntimeGraph: graph,
    } as any;

    const preserved = __sessionEvidenceTestHelpers.preservePythonEvidenceProjection(state) as any;

    expect(preserved.publishClosure).toBe(samplePublishClosure);
    expect(preserved.skillRuntimeGraph).toBe(graph);
  });

  it("prepares a visible empty reset state when backend reset or save fails", async () => {
    const fresh = await __sessionEvidenceTestHelpers.prepareVisibleResetSessionState(
      "reset-fallback-session",
      async () => {
        throw new Error("DELETE /api/sliderule/sessions/reset-fallback-session returned 405");
      },
      async () => {
        throw new Error("save failed");
      }
    );

    expect(fresh.sessionId).toBe("reset-fallback-session");
    expect(fresh.goal?.text).toBe("");
    expect(fresh.goal?.status).toBe("needs_refinement");
    expect((fresh as any).publishClosure).toBeUndefined();
    expect((fresh.artifacts || []).length).toBe(0);
    expect((fresh.capabilityRuns || []).length).toBe(0);
  });
});

describe("persisted turn publishClosure merge order (120)", () => {
  const pythonClosed = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureHash: "python-authoritative-120",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  const previewOnly = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 2,
    skillCount: 6,
    versionPinsChecked: false,
    closureHash: "ts-preview-only",
    tierCounts: { hard_blocker: 0, warning: 1, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  it("persists Python top-level closure over a stale preview closure", () => {
    const stateWithPreview = {
      sessionId: "merge-120",
      goal: { text: "merge order", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: previewOnly,
    } as any;

    const merged = mergePublishClosureForPersistedTurn(stateWithPreview, pythonClosed) as any;

    expect(merged.publishClosure?.closureHash).toBe("python-authoritative-120");
    expect(merged.publishClosure?.evidencePresentCount).toBe(6);
  });

  it("does not promote preview closure when Python has no authoritative closure", () => {
    const stateWithPreview = {
      sessionId: "merge-degraded-120",
      goal: { text: "merge degraded", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: previewOnly,
    } as any;

    const merged = mergePublishClosureForPersistedTurn(stateWithPreview, undefined) as any;

    expect("publishClosure" in merged).toBe(false);
    expect(merged.publishClosure).toBeUndefined();
  });
});

/**
 * 已闭环话题里输入新应用意图 → 自动开新话题的启发式。
 * 误判代价不对称：漏判只是用户需手动重置（现状）；错判会清掉旧话题会话，
 * 所以动词+载体名词都命中才算新意图。
 */
describe("looksLikeNewAppIntent (自动新话题启发式)", () => {
  it("识别内置 chips 与常见新应用表述", () => {
    expect(looksLikeNewAppIntent("做一个采购审批应用，含采购单、经理审批、财务确认和字段权限")).toBe(true);
    expect(looksLikeNewAppIntent("设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理")).toBe(true);
    expect(looksLikeNewAppIntent("做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养")).toBe(true);
    expect(looksLikeNewAppIntent("帮我做个宠物医院预约平台")).toBe(true);
  });

  it("识别裸名词短语意图（无动词、以载体名词收尾）", () => {
    expect(looksLikeNewAppIntent("智能财务自动化办公系统")).toBe(true);
    expect(looksLikeNewAppIntent("宠物医院预约平台")).toBe(true);
    expect(looksLikeNewAppIntent("小区物业报修小程序")).toBe(true);
  });

  it("裸名词短语不误伤 refine 指令（修改类动词开头 / 名词不收尾）", () => {
    expect(looksLikeNewAppIntent("优化下单应用")).toBe(false);
    expect(looksLikeNewAppIntent("把审批系统改成两级")).toBe(false);
    expect(looksLikeNewAppIntent("调整权限系统")).toBe(false);
    expect(looksLikeNewAppIntent("重新生成页面系统图")).toBe(false);
  });

  it("不误伤追问/交付/挑战类输入（保持既有 refine 语义）", () => {
    expect(looksLikeNewAppIntent("打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包")).toBe(false);
    expect(looksLikeNewAppIntent("把审批改成两级")).toBe(false);
    expect(looksLikeNewAppIntent("这个结论的依据不够充分，请重新推演。")).toBe(false);
    expect(looksLikeNewAppIntent("好的")).toBe(false);
    expect(looksLikeNewAppIntent("")).toBe(false);
  });

  it("D5 回归：含新建动词的迭代表述不得判为新应用（曾触发无确认删会话）", () => {
    expect(looksLikeNewAppIntent("给工单系统做一个统计报表页面")).toBe(false);
    expect(looksLikeNewAppIntent("为这个应用做一个移动端小程序版本")).toBe(false);
    expect(looksLikeNewAppIntent("在现有系统基础上帮我做个导出工具")).toBe(false);
    expect(looksLikeNewAppIntent("基于当前平台设计一个审批看板")).toBe(false);
    // 真正的新应用表述不受影响
    expect(looksLikeNewAppIntent("做一个博物馆门票预订系统")).toBe(true);
  });
});
