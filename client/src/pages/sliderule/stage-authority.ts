/**
 * 左栏阶段权属。对照 BettaFish 的「阶段事件 ≠ 正文」，不拉它的仓。
 *
 * 2026-08-18：V6.0 控制面是 Agent 选下一步，画页是写死配方。
 * 左栏若混成一张无规则清单，两种活就看不出来。
 * 这里只分权属，不装论坛互辩——仓里没有主持人，FLOWB 还要剥 debate。
 *
 * 真机坑：marathon 曾把 reasoning_step 的 **label**（人话）传给
 * onReasoningStep；现在优先传 **stage**（机器 id），左栏再翻人话。
 * 配方步仍会顶着 round 前缀进来。必须按文案/能力 id 认，不能只看「第 N 轮」。
 */

import type { PlanSourceValue } from "@shared/blueprint/sliderule-turn-route";
import type { TurnStep } from "./types";
import {
  type ActivityGroup,
  type ActivityRowModel,
  type ActivityStatus,
  type StageAuthority,
  parseActivityLine,
} from "./activity-rows";

export type { StageAuthority };

export type StageLine = {
  text: string;
  capabilityId?: string;
};

/** 配方步只认事件上的 specfirst.* id。查表翻译已删（对齐 xai-grok-session-events）。 */
const SPECFIRST_ID = /\bspecfirst\.[a-z]+\b/;

const INTAKE_NEEDLES = ["指令已接收", "上一话题已闭环"];

/**
 * 开场三行：每一轮 runTurn 都会重演的那几条。
 *
 * ⚠ 2026-09-05 真机 sr-20260905004750 第 3 轮（用户原文「假设已确认。继续画
 *   页面。」）开头逐字：
 *
 *     intent.parse｜指令已接收 · 启动推理
 *     intent.parse｜编排 pages → structure → bind
 *     planning    ｜第 1 轮 · 正在执行 planning
 *     intent.parse｜编排 pages
 *
 *   续跑本来就是接着上一跳走，路线上一轮已经摆过了。再演一遍，屏幕上就是
 *   「怎么又从头推演了一遍」——用户当天指着这一处说「切换很不自然」。
 *
 *   只在**续跑轮**少画（`continuation`）。首轮照旧全画：那时候用户确实需要
 *   看见它接了活、编排了什么路线。
 */
const OPENING_NEEDLES = ["编排 "];

const CLOSURE_NEEDLES = ["本话题已闭环", "发布闭环"];

/** 画页/证据，但不是具名配方阶段（BettaFish 里当 chunk，不进阶段轨）。 */
const PAINT_CHUNK_NEEDLES = [
  "系统画面生成",
  "证据落地",
  "证据缺失",
  "最新定义：",
  "界面已出",
  "生成五系统模型",
  "重做模型",
  "首页参照图",
  "读取配色",
  "设计页面版式",
];

export function shortStageId(id: string): string {
  return id.split(".").pop() || id;
}

export function pickBadge(planSource?: PlanSourceValue): string {
  return planSource === "llm" ? "Agent 选" : "规则选";
}

function haystack(line: StageLine): string {
  return `${line.capabilityId || ""} ${line.text}`;
}

function isClosureLine(line: StageLine): boolean {
  return (
    /^\s*(closed|blocked)\b/i.test(line.text) ||
    CLOSURE_NEEDLES.some(n => haystack(line).includes(n))
  );
}

function isIntakeLine(line: StageLine): boolean {
  return INTAKE_NEEDLES.some(n => haystack(line).includes(n));
}

/** 一条 step 是不是开场（见 OPENING_NEEDLES 头注）。给折叠续跑用。 */
export function isOpeningStep(step: TurnStep): boolean {
  const lines = linesFromTurnSteps([step]);
  return lines.length > 0 && lines.every(isOpeningLine);
}

/** 续跑轮里要少画的那几条（见 OPENING_NEEDLES 头注）。 */
export function isOpeningLine(line: StageLine): boolean {
  if (isIntakeLine(line)) return true;
  if ((line.capabilityId || "").trim() === "planning") return true;
  return OPENING_NEEDLES.some(n => line.text.includes(n));
}

export function classifyStageLine(line: StageLine): StageAuthority {
  if (isIntakeLine(line) || isClosureLine(line)) return "gate";
  const hay = haystack(line);
  if (
    SPECFIRST_ID.test(hay) ||
    PAINT_CHUNK_NEEDLES.some(n => hay.includes(n))
  ) {
    return "recipe";
  }
  return "agent";
}

export function matchRecipeStage(line: StageLine): string | undefined {
  const hay = haystack(line);
  const hit = hay.match(SPECFIRST_ID);
  return hit ? hit[0] : undefined;
}

export function linesFromTurnSteps(steps: TurnStep[]): StageLine[] {
  const out: StageLine[] = [];
  for (const step of steps) {
    if (step.kind === "narration" || step.kind === "step_narration") {
      if (step.text) {
        out.push({
          text: step.text,
          capabilityId: (step as { capabilityId?: string }).capabilityId,
        });
      }
    } else if (step.kind === "chip") {
      if (step.label) out.push({ text: step.label, capabilityId: step.capabilityId });
    } else if (step.kind === "capability_fail") {
      if (step.message) {
        out.push({ text: step.message, capabilityId: step.capabilityId });
      }
    }
  }
  return out;
}

function rowFromLine(
  line: StageLine,
  index: number,
  bandStatus: "running" | "done",
  last: boolean
): ActivityRowModel {
  const parsed = parseActivityLine(line.text);
  let status: ActivityStatus = parsed.status;
  if (status !== "failed") {
    if (bandStatus === "done") status = "done";
    else if (last) status = "running";
    else status = "done";
  }
  const stageId = matchRecipeStage(line);
  return {
    id: `${classifyStageLine(line)}-${index}`,
    ...parsed,
    status,
    target: parsed.target || (stageId ? shortStageId(stageId) : undefined),
    authority: classifyStageLine(line),
    stageId,
  };
}

function recipeTrackRows(
  lines: StageLine[],
  streaming: boolean
): ActivityRowModel[] {
  // 只渲染已经到过的阶段。不发明一份 7 格 pending 骨架（那就是 RECIPE_CORE 翻译表）。
  const rows: ActivityRowModel[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const id = matchRecipeStage(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const parsed = parseActivityLine(line.text);
    rows.push({
      id,
      status: "done",
      verb: parsed.verb || line.text,
      target: shortStageId(id),
      authority: "recipe",
      stageId: id,
    });
  }
  if (streaming && rows.length > 0) {
    rows[rows.length - 1] = { ...rows[rows.length - 1], status: "running" };
  }
  return rows;
}

/**
 * 「（实时输出见下方）」那几条是**指路条，不是活动**。
 *
 * ⚠ 2026-09-05 真机 sr-20260905004750 第 2 轮，同一件事上报了两遍：
 *
 *     evidence.search｜第 1 轮 · ⚡ 正在全网检索外部证据
 *     intent.parse   ｜🖋 LLM 正在全网检索外部证据（实时输出见下方）...
 *
 *   `parseActivityLine` 把两条都归成 verb=「全网检索外部证据」，左栏于是
 *   列两遍。真机上「全网检索外部证据 / 分析风险 / 自我挑刺 / 撰写可行性报告」
 *   四条全是这个形状——用户看到的「同一个栏里重复 5 条」就是它。
 *
 *   指路条指的那份东西（LLM 实时输出）本来就另有面板在渲染，所以它自己
 *   不必再占一行。**但不许无脑丢**：同 verb 的正主不在时它就是唯一的记录，
 *   那时候留着。丢了会变成「跑了但左栏没记」——本仓最忌的那类。
 */
function isLiveOutputPointer(line: StageLine): boolean {
  return line.text.includes("（实时输出见下方）");
}

function dropRedundantPointers(lines: StageLine[]): StageLine[] {
  const verbOf = (l: StageLine) => parseActivityLine(l.text).verb;
  const anchored = new Set(
    lines.filter(l => !isLiveOutputPointer(l)).map(verbOf)
  );
  return lines.filter(l => !(isLiveOutputPointer(l) && anchored.has(verbOf(l))));
}

/**
 * 连着两条一模一样的，合成一条。
 *
 * ⚠ 2026-09-05 真机：同一批「🖼 界面已出：p5（1/5）… p4（5/5）」连着出现两遍，
 *   编号和顺序逐字相同（id 全是 `turn-…-stream-N`，即两遍都来自前端
 *   `onSpecPage`——同一页第二次到达时 `setSpecPages` 是**覆盖**，而
 *   `appendStreamStep` 是**追加**，只改了一半）。
 *   源头那处一并修了；这里兜住的是"任何来源的连续重复"。
 *
 * ⚠ 只合**相邻**的。跨开的重复是真的跑了两轮（第 1 轮 / 第 2 轮 各一次），
 *   合掉就把"它重跑过"这个事实抹了。
 */
function collapseAdjacentRepeats(lines: StageLine[]): StageLine[] {
  const out: StageLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.text === line.text &&
      (prev.capabilityId || "") === (line.capabilityId || "")
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * 同一条路线不许说两遍。
 *
 * ⚠ 2026-09-05 真机 sr-20260905004750 第 2 轮：
 *
 *     intent.parse｜编排 spec → pages → structure → bind
 *     planning    ｜第 1 轮 · 正在执行 planning
 *     intent.parse｜编排 spec → pages → structure → bind      ← 逐字相同
 *
 *   隔着一行，所以「只合相邻」那条兜不住；用户原话里那 5 条重复，这是最后一条。
 *
 * ⚠ **只对「编排」这一类下手，不做通用的全局去重。** 同一份夹具里
 *   `specfirst.pages｜逐页画界面（并发）` 出现了 3 次——那是真的画了三轮，
 *   通用去重会把「它重跑过」这个事实抹掉。「编排 X → Y → Z」不一样：
 *   它是**一句路线声明**，不是一次活动，说第二遍永远不带新消息。
 */
function collapseRepeatedRoutePlans(lines: StageLine[]): StageLine[] {
  const seen = new Set<string>();
  return lines.filter(line => {
    if (!OPENING_NEEDLES.some(n => line.text.includes(n))) return true;
    const key = `${line.capabilityId || ""}\u0000${line.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deriveStageBands(args: {
  steps: TurnStep[];
  streaming: boolean;
  planSource?: PlanSourceValue;
  extraTexts?: string[];
  /** 这一轮是不是上一跳的续跑（见 turn-continuation.isContinuationTurn）。 */
  continuation?: boolean;
}): ActivityGroup[] {
  const raw = [
    ...linesFromTurnSteps(args.steps),
    ...(args.extraTexts || []).map(text => ({ text })),
  ];
  // ⚠ 2026-09-05 真机（宠物疫苗那趟）：续跑轮**刚开头的那十几秒里只有开场**，
  //   全滤掉之后一条不剩 → `ActivityList` 返回 null → 左栏整个空白。
  //   量到的原话是「带 0 条，行 0」——比"重演开场"更坏：屏幕上什么都没有，
  //   用户不知道它还在不在跑。
  //
  //   我先前那条反向判据（「不许把整条时间线清空」）没咬住，因为它喂的那份
  //   载荷里**已经有真活了**，那种情况下这个坑压根不成立——正是本仓
  //   §一之二：判据自己构造了护栏需要的那个输入，而真机不喂。
  //
  //   所以：**开场只在有别的可看时才省掉**。滤空了就照原样画。
  const trimmed = args.continuation ? raw.filter(l => !isOpeningLine(l)) : raw;
  const lines = collapseRepeatedRoutePlans(
    collapseAdjacentRepeats(
      dropRedundantPointers(trimmed.length > 0 ? trimmed : raw)
    )
  );
  if (lines.length === 0) return [];

  const buckets = {
    intake: [] as StageLine[],
    agent: [] as StageLine[],
    recipe: [] as StageLine[],
    closure: [] as StageLine[],
  };
  for (const line of lines) {
    const authority = classifyStageLine(line);
    if (authority === "gate") {
      (isClosureLine(line) ? buckets.closure : buckets.intake).push(line);
    } else {
      buckets[authority].push(line);
    }
  }

  const groups: ActivityGroup[] = [];
  const pushBand = (
    id: string,
    authority: StageAuthority,
    title: string,
    badge: string,
    rows: ActivityRowModel[]
  ) => {
    if (rows.length === 0) return;
    const running = args.streaming && rows.some(r => r.status === "running");
    groups.push({
      id,
      title,
      badge,
      authority,
      status: running ? "running" : "done",
      rows,
    });
  };

  const stream = args.streaming ? "running" : "done";
  pushBand(
    "gate-in",
    "gate",
    "入站",
    "闸",
    buckets.intake.map((line, i) =>
      rowFromLine(line, i, stream, false)
    )
  );
  pushBand(
    "agent",
    "agent",
    "选材",
    pickBadge(args.planSource),
    buckets.agent.map((line, i) =>
      rowFromLine(
        line,
        i,
        stream,
        args.streaming && i === buckets.agent.length - 1 && buckets.recipe.length === 0
      )
    )
  );
  if (buckets.recipe.length > 0) {
    const named = buckets.recipe.some(line => matchRecipeStage(line));
    const rows = named
      ? recipeTrackRows(buckets.recipe, args.streaming)
      : buckets.recipe.map((line, i) =>
          rowFromLine(
            line,
            i,
            stream,
            args.streaming && i === buckets.recipe.length - 1
          )
        );
    pushBand("recipe", "recipe", "画应用", "配方", rows);
  }
  pushBand(
    "gate-out",
    "gate",
    "闭环",
    "闸",
    buckets.closure.map((line, i) =>
      rowFromLine(line, i, stream, false)
    )
  );
  return groups;
}
