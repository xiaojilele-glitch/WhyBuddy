// @vitest-environment jsdom
/**
 * 续跑的一轮不许重演开场；同一件事不许在左栏列两遍。
 *
 * ## 事故（2026-09-05 真机 + 用户裁决）
 *
 * 伴随式澄清的设计是「停住 → 人选 → 注入 → 接着跑」，后端那半是好的。
 * 但「一跳一件」（2026-09-02 `7afc6a9`）决定了续跑只能再开一轮，而**每一轮
 * 都从头演一遍开场**。用户指着这一处说：「这块的切换很不自然，看着又跟
 * 重新推演的感觉似的」。
 *
 * ⚠ 判据全部照**真机原样载荷**写（§一之二）：下面这些 label / capabilityId
 *   逐字抄自 sr-20260905004750 的 `turnNarrations`，不是自己拼一份。
 *   自己拼的判据只能证明"我抄对了"。
 */
import { describe, expect, it } from "vitest";

import { deriveStageBands } from "../stage-authority";
import { isContinuationTurn } from "../turn-continuation";
import type { TurnStep } from "../types";

let seq = 0;
const chip = (capabilityId: string, label: string): TurnStep =>
  ({
    id: `s${++seq}`,
    kind: "chip",
    capabilityId,
    roleId: "system",
    label,
    realLlm: false,
  }) as unknown as TurnStep;

/** 真机 sr-20260905004750 第 3 轮（user =「假设已确认。继续画页面。」）的开头。 */
const REAL_CONTINUATION: TurnStep[] = [
  chip("intent.parse", "指令已接收 · 启动推理"),
  chip("intent.parse", "编排 pages → structure → bind"),
  chip("planning", "第 1 轮 · 正在执行 planning"),
  chip("intent.parse", "编排 pages"),
  chip("factory.pages", "第 1 轮 · 逐页画界面（并发）"),
  chip("specfirst.design", "定这个应用的设计语言"),
];

/** 真机第 2 轮里那段「同一件事上报两遍」。 */
const REAL_DOUBLE_REPORT: TurnStep[] = [
  chip("evidence.search", "第 1 轮 · ⚡ 正在全网检索外部证据"),
  chip("risk.analyze", "第 1 轮 · 正在分析风险"),
  chip("critique.generate", "第 1 轮 · 正在自我挑刺"),
  chip("report.write", "第 1 轮 · 正在撰写可行性报告"),
  chip("intent.parse", "🖋 LLM 正在全网检索外部证据（实时输出见下方）..."),
  chip("intent.parse", "🖋 LLM 正在自我挑刺（实时输出见下方）..."),
  chip("intent.parse", "🖋 LLM 正在分析风险（实时输出见下方）..."),
  chip("intent.parse", "🖋 LLM 正在撰写可行性报告（实时输出见下方）..."),
];

const allVerbs = (steps: TurnStep[], continuation: boolean) =>
  deriveStageBands({ steps, streaming: false, continuation })
    .flatMap(g => g.rows)
    .map(r => r.verb);

describe("认出续跑", () => {
  it("确认伴随式假设那句是续跑", () => {
    expect(isContinuationTurn("假设已确认。继续画页面。")).toBe(true);
  });

  it("盯半句不盯整句（措辞改了还得认出来）", () => {
    expect(isContinuationTurn("假设已确认，接着往下走")).toBe(true);
  });

  it("工厂跳的指令也是续跑", () => {
    expect(isContinuationTurn("进入数据模型反推（Structure）")).toBe(true);
  });

  it("闭集芯片是 typed 答案，不是新话题", () => {
    // ⚠ 2026-09-07 真机水果店：点「精修（refine）」左栏画成用户原话。
    expect(isContinuationTurn("精修（refine）")).toBe(true);
    expect(isContinuationTurn("refine")).toBe(true);
  });

  it("刷新续播那句用户没说过，也是续跑", () => {
    expect(isContinuationTurn("（续播上一轮推演）")).toBe(true);
  });

  it("澄清卡交卷不是新话题", () => {
    expect(
      isContinuationTurn(
        "「请问这个收银台主要是给谁在什么设备上使用的？」答：电脑网页收银台"
      )
    ).toBe(true);
  });

  it("★ 反向配对：新话题不是续跑", () => {
    expect(isContinuationTurn("做一个社区食堂的每日菜单和预订台账")).toBe(false);
    expect(isContinuationTurn("")).toBe(false);
    expect(isContinuationTurn(null)).toBe(false);
  });
});

describe("续跑轮不重演开场", () => {
  it("开场那三样都不再画：接收意图 / 编排 / planning", () => {
    const verbs = allVerbs(REAL_CONTINUATION, true);
    expect(verbs).not.toContain("接收意图");
    expect(verbs.some(v => v.startsWith("编排"))).toBe(false);
    expect(verbs.some(v => v.includes("planning"))).toBe(false);
  });

  it("真正干的活还在（少画的只是开场）", () => {
    const verbs = allVerbs(REAL_CONTINUATION, true);
    expect(verbs).toContain("逐页画界面（并发）");
    expect(verbs).toContain("定这个应用的设计语言");
  });

  it("★ 反向配对：首轮照旧全画", () => {
    // 首轮那几行是真信息——它接了活、编排了这条路线。一起藏掉就是另一种坏。
    const verbs = allVerbs(REAL_CONTINUATION, false);
    expect(verbs).toContain("接收意图");
    expect(verbs.some(v => v.startsWith("编排"))).toBe(true);
  });

  /**
   * ★ 2026-09-05 真机咬出来的：**续跑轮开头那十几秒里只有开场**。
   *
   * 宠物疫苗那趟量到「带 0 条，行 0」——全滤掉之后一条不剩，左栏整个空白。
   * 比"重演开场"更坏：屏幕上什么都没有，用户不知道它还在不在跑。
   *
   * ⚠ 我先前那条「不许把整条时间线清空」没咬住，因为它喂的载荷里**已经有
   *   真活了**，那种情况下这个坑压根不成立——§一之二 的标准形状：判据自己
   *   构造了护栏需要的那个输入，而真机不喂。这一条专喂真机那一帧。
   */
  it("★ 只有开场时不许滤空（真机那一帧）", () => {
    const openingOnly: TurnStep[] = [
      chip("intent.parse", "指令已接收 · 启动推理"),
      chip("intent.parse", "编排 pages → structure → bind"),
      chip("planning", "第 1 轮 · 正在执行 planning"),
    ];
    const groups = deriveStageBands({
      steps: openingOnly,
      streaming: true,
      continuation: true,
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.flatMap(g => g.rows).length).toBeGreaterThan(0);
  });

  it("★ 反向配对：一有别的可看，开场就该省掉", () => {
    // 否则上一条会退化成「永远不滤」，等于这个修复没做。
    const withWork: TurnStep[] = [
      chip("intent.parse", "指令已接收 · 启动推理"),
      chip("planning", "第 1 轮 · 正在执行 planning"),
      chip("specfirst.design", "定这个应用的设计语言"),
    ];
    expect(allVerbs(withWork, true)).not.toContain("接收意图");
  });

  it("★ 续跑轮不许把整条时间线清空", () => {
    const groups = deriveStageBands({
      steps: REAL_CONTINUATION,
      streaming: false,
      continuation: true,
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.flatMap(g => g.rows).length).toBeGreaterThan(0);
  });
});

describe("同一件事只列一遍", () => {
  it("「实时输出见下方」的指路条不再单占一行", () => {
    const verbs = allVerbs(REAL_DOUBLE_REPORT, false);
    const n = verbs.filter(v => v === "全网检索外部证据").length;
    expect(n).toBe(1);
    expect(verbs.filter(v => v === "分析风险")).toHaveLength(1);
    expect(verbs.filter(v => v === "自我挑刺")).toHaveLength(1);
    expect(verbs.filter(v => v === "撰写可行性报告")).toHaveLength(1);
  });

  it("★ 正主不在时，指路条得留着（不许跑了却没记）", () => {
    const only = [chip("intent.parse", "🖋 LLM 正在分析风险（实时输出见下方）...")];
    expect(allVerbs(only, false)).toContain("分析风险");
  });

  it("连着两条一模一样的合成一条", () => {
    const doubled: TurnStep[] = [
      chip("ux.preview", "🖼 界面已出：p5（1/5）"),
      chip("ux.preview", "🖼 界面已出：p5（1/5）"),
      chip("ux.preview", "🖼 界面已出：p2（2/5）"),
    ];
    expect(allVerbs(doubled, false)).toHaveLength(2);
  });

  it("★ 反向配对：隔开的重复是真跑了两轮，不许合", () => {
    // 「第 1 轮 / 第 2 轮 各画一次」是事实，合掉就把"它重跑过"抹了。
    const twoRounds: TurnStep[] = [
      chip("factory.pages", "第 1 轮 · 逐页画界面（并发）"),
      chip("specfirst.design", "定这个应用的设计语言"),
      chip("factory.pages", "第 2 轮 · 逐页画界面（并发）"),
    ];
    expect(allVerbs(twoRounds, false)).toHaveLength(3);
  });
});

describe("接在真链路上", () => {
  it("★ §1：SlideRule 真的把 continuation 传进去了", () => {
    // 光有参数不算数——装在不通电的插座上是本仓最贵的那条。
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = (
      fs.readFileSync(path.resolve(__dirname, "../../SlideRule.tsx"), "utf8") as string
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // ⚠ 2026-09-13 起必须是**认标记**那一版：自动续跑没有用户文本，
    //   `isContinuationTurn(turn.user)` 在它身上恒为 false，折叠会静默失效。
    expect(src).toMatch(/continuation:\s*turnIsContinuation\(turn\)/);
    expect(src).not.toMatch(/continuation:\s*isContinuationTurn\(turn\.user\)/);
    // memo 依赖漏了 turn.user = 切换时不重算，左栏还是旧的那份
    expect(src).toMatch(/turn\.user,/);
    // ⚠ 同理：标记是 step，而 textFromStep 不认这个 kind（有意的），所以
    //   `turn.steps.map(textFromStep)` 那条依赖在标记到达时**不会变**。
    //   少这一条 = 折叠不重算，等于白改。
    expect(src).toMatch(/turnHasContinuationMark\(turn\),/);
  });
});

/**
 * 拿**真机那一发的原样载荷**再验一遍。
 *
 * ⚠ 本仓 §一之二：护栏的判据必须喂真机那一发的原样载荷，不许自己拼一个。
 *   上面那些 REAL_* 是我照着日志抄的，抄错了判据也发现不了；这一段直接读
 *   `fixtures/real-turn-narrations.json`——sr-20260905004750 三轮的全部 chip
 *   （用户当天截图里那一次），是从会话状态里导出来的，不是手写的。
 */
import realTurns from "./fixtures/real-turn-narrations.json";

describe("喂真机原样载荷", () => {
  const turnOf = (userNeedle: string) => {
    const t = (realTurns as Array<{ user: string; steps: Array<{ capabilityId: string; label: string }> }>)
      .find(x => x.user.includes(userNeedle));
    if (!t) throw new Error(`真机夹具里没有这一轮：${userNeedle}`);
    return t;
  };
  const toSteps = (t: { steps: Array<{ capabilityId: string; label: string }> }): TurnStep[] =>
    t.steps.map((s, i) =>
      ({
        id: `r${i}`,
        kind: "chip",
        capabilityId: s.capabilityId,
        roleId: "system",
        label: s.label,
        realLlm: false,
      }) as unknown as TurnStep
    );

  it("真机那一轮续跑：开场三样全不画", () => {
    const t = turnOf("假设已确认");
    const verbs = allVerbs(toSteps(t), true);
    expect(verbs).not.toContain("接收意图");
    expect(verbs.some(v => v.startsWith("编排"))).toBe(false);
    expect(verbs.some(v => v.includes("planning"))).toBe(false);
    // 真干的活还在
    expect(verbs).toContain("逐页画界面（并发）");
  });

  it("真机那一轮：五页的「界面已出」不再各列两遍", () => {
    const t = turnOf("假设已确认");
    const raw = t.steps.filter(s => s.label.includes("界面已出")).length;
    // 夹具本身就带着那个 bug（每页两条），判据先证明它真的在
    expect(raw).toBeGreaterThan(10);
    const verbs = allVerbs(toSteps(t), true);
    const shown = verbs.filter(v => v.includes("界面已出")).length;
    expect(shown).toBeLessThan(raw);
  });

  it("★ 真机首轮：同一条路线不许说两遍（用户列的第 5 条）", () => {
    const t = turnOf("打造社区食堂");
    const raw = t.steps.filter(s => s.label.includes("编排 spec")).length;
    expect(raw).toBe(2);                       // 夹具里确实说了两遍
    const verbs = allVerbs(toSteps(t), false);
    expect(verbs.filter(v => v.startsWith("编排"))).toHaveLength(1);
  });

  it("★ 反向配对：隔开的同名活动不许被这条规则合掉", () => {
    // 「编排」是一句路线声明，说两遍没新消息；**一次活动跑了两遍是事实**，
    // 合掉就把「它重跑过」抹了。所以这条规则只许对「编排」下手，不许做成通用去重。
    //
    // ⚠ 第一版这条判据是拿夹具里的 `逐页画界面（并发）×3` 写的，**咬不住**：
    //   那三条里有两条进了配方带，而配方带本来就按 stage id 去重，
    //   通用去重与否结果都是 >1。改成直接构造：同一条活动隔开出现两次。
    const doubled: TurnStep[] = [
      chip("factory.pages", "逐页画界面（并发）"),
      chip("critique.generate", "自我挑刺"),
      chip("factory.pages", "逐页画界面（并发）"),
    ];
    expect(allVerbs(doubled, false).filter(v => v === "逐页画界面（并发）")).toHaveLength(2);
  });

  it("真机首轮：同一件事上报两遍的四条，各只剩一条", () => {
    const t = turnOf("打造社区食堂");
    const verbs = allVerbs(toSteps(t), false);
    for (const v of ["全网检索外部证据", "分析风险", "自我挑刺", "撰写可行性报告"]) {
      expect(verbs.filter(x => x === v)).toHaveLength(1);
    }
  });

  it("★ 反向配对：真机首轮不是续跑，开场照旧画", () => {
    const t = turnOf("打造社区食堂");
    expect(isContinuationTurn(t.user)).toBe(false);
    expect(allVerbs(toSteps(t), false)).toContain("接收意图");
  });
});

/**
 * 续跑接在上一段后面——不另起一个气泡、不另起一张卡。
 *
 * ⚠ 2026-09-05 用户第二次指出来：我第一版只做了「少画开场」，没做
 *   「接在上一段后面」。结果那一轮只剩一条 `接收意图`，看着还是重新开始；
 *   全滤掉又变成一片空白。两头都不对，因为少的那一半才是关键：
 *   **它不该是一块新的。**
 */
describe("续跑接在上一段后面", () => {
  const turn = (
    id: string,
    user: string,
    labels: Array<[string, string]>,
    status: "streaming" | "complete" = "complete"
  ) =>
    ({
      id,
      user,
      status,
      steps: labels.map(([cap, label], i) =>
        ({
          id: `${id}-${i}`,
          kind: "chip",
          capabilityId: cap,
          roleId: "system",
          label,
          realLlm: false,
        }) as unknown as TurnStep
      ),
      routeFacts: { turnId: id },
      routeExpanded: false,
      routeLitCount: 0,
      assistant: "",
      assistantSource: "llm" as const,
      main: null,
      actions: [],
    }) as unknown as import("../types").UiTurn;

  const FIRST = turn("t1", "做一个社区图书角的借书还书登记", [
    ["intent.parse", "指令已接收 · 启动推理"],
    ["specfirst.spec", "起草规格：成功判据、需求节点与页面清单"],
  ]);
  /** 真机那一轮开头逐字（sr-20260905004750 第 3 轮）。 */
  const CONT = turn(
    "t2",
    "假设已确认。继续画页面。",
    [
      ["intent.parse", "指令已接收 · 启动推理"],
      ["intent.parse", "编排 pages → structure → bind"],
      ["planning", "第 1 轮 · 正在执行 planning"],
      ["specfirst.design", "定这个应用的设计语言"],
    ],
    "streaming"
  );

  it("两轮折成一块", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    expect(foldContinuationTurns([FIRST, CONT])).toHaveLength(1);
  });

  it("气泡留的是人真说过的那句，不是机器排的那句", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    const [merged] = foldContinuationTurns([FIRST, CONT]);
    expect(merged.user).toBe("做一个社区图书角的借书还书登记");
    expect(merged.user).not.toContain("假设已确认");
  });

  it("上一段的步骤还在，续跑的活接在后面", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    const [merged] = foldContinuationTurns([FIRST, CONT]);
    const labels = merged.steps.map(s => (s as { label?: string }).label);
    expect(labels).toContain("起草规格：成功判据、需求节点与页面清单");
    expect(labels).toContain("定这个应用的设计语言");
  });

  it("★ 续跑那半的开场三样一条都不带进来", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    const [merged] = foldContinuationTurns([FIRST, CONT]);
    const labels = merged.steps.map(s => String((s as { label?: string }).label));
    // 上一段自己那条「指令已接收」留着（它是首轮的真开场）
    expect(labels.filter(l => l.includes("指令已接收"))).toHaveLength(1);
    expect(labels.some(l => l.startsWith("编排 "))).toBe(false);
    expect(labels.some(l => l.includes("执行 planning"))).toBe(false);
  });

  it("状态跟着新的那一跳走（还在跑就还是 streaming）", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    const [merged] = foldContinuationTurns([FIRST, CONT]);
    expect(merged.status).toBe("streaming");
  });

  it("★ 反向配对：新话题不折（那是两件事，必须两块）", async () => {
    const { foldContinuationTurns } = await import("../turn-continuation");
    const another = turn("t3", "再做一个快递代收登记", [
      ["intent.parse", "指令已接收 · 启动推理"],
    ]);
    expect(foldContinuationTurns([FIRST, another])).toHaveLength(2);
  });

  it("★ 反向配对：续跑排在第一条时没得可折，不许把它吃掉", async () => {
    // 刷新后只恢复了最近几轮就会这样。折不了就原样留着，
    // 少画开场那条路（deriveStageBands）继续兜。
    const { foldContinuationTurns } = await import("../turn-continuation");
    expect(foldContinuationTurns([CONT])).toHaveLength(1);
  });

  it("续播 / 澄清答句 / bind 跳都折进原话题，不许再开一块", async () => {
    /**
     * ⚠ 2026-09-07 真机 sr-20260907170712：左栏先是「（续播上一轮推演）」，
     * 再把澄清问答演一遍，bind 跳折进那句答。变异：不认续播/答句，本条红。
     */
    const { foldContinuationTurns } = await import("../turn-continuation");
    const resume = turn("t-resume", "（续播上一轮推演）", [
      ["intent.parse", "指令已接收 · 启动推理"],
    ]);
    const clarify = turn(
      "t-clarify",
      "「请问这个收银台主要是给谁在什么设备上使用的？」答：电脑网页收银台",
      [["intent.parse", "指令已接收 · 启动推理"]]
    );
    const bind = turn("t-bind", "进入权限绑定（bind）", [
      ["specfirst.structure", "从界面反推数据模型与关联关系"],
    ]);
    const folded = foldContinuationTurns([FIRST, resume, CONT, clarify, bind]);
    expect(folded).toHaveLength(1);
    expect(folded[0].user).toBe("做一个社区图书角的借书还书登记");
    expect(folded[0].user).not.toContain("续播");
    expect(folded[0].user).not.toContain("答：");
    const labels = folded[0].steps.map(s => String((s as { label?: string }).label));
    expect(labels).toContain("从界面反推数据模型与关联关系");
    expect(labels).toContain("定这个应用的设计语言");
  });

  it("★ 续播不插用户气泡（接在 runTurn 上，不是只改折叠）", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = (
      fs.readFileSync(
        path.resolve(__dirname, "../useSlideRuleSession.ts"),
        "utf8"
      ) as string
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const from = src.indexOf("let turnId = ");
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf("try {", from) + 40);
    expect(src).toContain("toolAnswer");
    expect(body).toContain("if (skipUserBubble)");
    expect(body).toContain("user: \"\"");
    expect(body).toMatch(/if \(last\)/);
    const runTurn = src.slice(
      src.indexOf("const runTurn = async"),
      src.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("pendingToolAnswerRef");
    expect(runTurn).toContain('awaitReason === "control_ask"');
    expect(runTurn).toContain("parkedAsk");
    expect(runTurn).toContain('kind: "ask_user"');
    expect(runTurn).not.toContain('kind: "assumptions"');
    expect(runTurn).toContain('kind: "clarify"');
    expect(runTurn).toContain("skipUserBubble");
    expect(runTurn).toContain("isContinuationTurn(userText)");
    expect(runTurn).not.toMatch(
      /skipUserBubble = Boolean\(resumeRun\) \|\| Boolean\(toolAnswer\)/
    );
    expect(runTurn).toContain("...(toolAnswer ? { toolAnswer } : {})");
    const sendFn = src.slice(
      src.indexOf("const sendMessage = async"),
      src.indexOf("const repairGaps = async")
    );
    expect(sendFn).toContain("toolAnswer: answer");
    expect(sendFn.indexOf("const answer = pendingNeed")).toBeLessThan(
      sendFn.indexOf("pendingAskRef.current = null")
    );
    expect(sendFn).not.toContain("pendingToolAnswerRef.current =");
  });

  it("★ §1 接在真链路上：气泡列表真的走了折叠", () => {
    // 光有折叠函数不算数——`buildImItems` 不调它，屏幕上照样两个气泡。
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = (
      fs.readFileSync(path.resolve(__dirname, "../../SlideRule.tsx"), "utf8") as string
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/foldContinuationTurns\(uiTurns\)/);
  });
});

/**
 * 状态条也不许说「规划第一轮」。
 *
 * ⚠ 2026-09-05，用户第三次指着同一处：「是伴随式澄清选择完之后」。
 *   前面几刀把左栏的行折进了上一段，但这两样是**另一路**——
 *   `指令已接收 · 启动推理` 这条芯片、和状态条上的
 *   「规划第一轮能力与路线…」，是每一轮 runTurn **无条件**发的
 *   （useSlideRuleSession:1293），折叠管不着。右栏于是照样写着
 *   "正在规划第一轮"，看着就是从头再来。
 *
 *   续跑没有"第一轮"可规划：这一跳接着上一跳走，路线上一轮就定了。
 */
describe("续跑的状态条不许报开场", () => {
  const code = () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    return (
      fs.readFileSync(
        path.resolve(__dirname, "../useSlideRuleSession.ts"),
        "utf8"
      ) as string
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  };

  /** 取出 `if (...) { … }` 真正的那一对花括号之间的内容。 */
  const blockAfter = (src: string, needle: string) => {
    const at = src.indexOf(needle);
    if (at < 0) return "";
    let i = src.indexOf("{", at);
    if (i < 0) return "";
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) return src.slice(i + 1, j);
      }
    }
    return "";
  };

  it("开场芯片和「规划第一轮」都在 factoryLit 且不是续跑那个块**里面**", () => {
    const src = code();
    const inner = blockAfter(
      src,
      "if (!isContinuationTurn(userText) && !toolAnswer)"
    );
    expect(inner).not.toBe("");
    expect(inner).toContain("指令已接收 · 启动推理");
    expect(inner).toContain("规划第一轮能力与路线");
    const planAt = src.indexOf("规划第一轮能力与路线");
    const factoryIf = src.lastIndexOf("if (factoryLit)", planAt);
    expect(factoryIf, "规划第一轮必须包在 factoryLit 里").toBeGreaterThan(-1);
    expect(factoryIf).toBeLessThan(planAt);
  });

  it("续跑那一支要说清这一跳在干什么，不许留空", () => {
    const src = code();
    expect(src).toMatch(/接着上一跳/);
    // 说得出跳名就说跳名（FACTORY_HOP_LABELS），说不出才用兜底那句
    expect(src).toContain("FACTORY_HOP_LABELS");
  });

  it("★ 反向配对：新话题照旧报开场", () => {
    // 首轮那两样是真信息——它接了活、正在规划路线。一起藏掉是另一种坏。
    const src = code();
    expect(src).toContain("指令已接收 · 启动推理");
    expect(src).toContain("规划第一轮能力与路线...");
  });
});
