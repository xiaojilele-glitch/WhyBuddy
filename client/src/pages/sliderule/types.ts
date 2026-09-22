import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import type { TurnRouteFacts } from "@shared/blueprint/sliderule-turn-route";
import type { NarrationFallbackReason } from "@/lib/sliderule-narrator";

export type WhyArtifact = {
  id: string;
  kind: string;
  capability: V5CapabilityId;
  role: string;
  content: string;
  trustLevel: "untrusted" | "gated_pass" | "audited";
  realLlm?: boolean;
};

/** S8: pure UI progressive slice — not persisted in V5SessionState. */
/**
 * 左栏那一行工具 chip。
 *
 * ⚠ 2026-09-20：单独具名，是为了让 chipFromControlTranscriptRow 能把返回类型
 *   收窄到它。此前那个函数声明返回整个 TurnStep 联合，而它其实只产 chip，
 *   于是调用方取 `.progressType` 一律 TS2339（ProjectTaskChecklist.test.tsx:368
 *   就是这么红的）——类型比实现宽，代价全让调用方付。
 */
export type TurnChipStep = {
      id: string;
      kind: "chip";
      /**
       * ⚠ 工程档的 chip 装的是**控制面工具名**（`project_create` /
       *   `file_write` 等），不是五系统能力池里的 id。产线本来就这么写，
       *   只是靠 4 处 `as never` 绕过这个字段的类型——生产侧硬转、消费侧
       *   (`isProjectChip`) 再拿 `isProjectWorkbenchTool` 重新解析，
       *   正是 §4 那种「同一件事两处实现」的逃生口。
       *
       *   模板字面量放宽到**恰好**等于 isProjectChip 认的那一集，
       *   那 4 处 as never 就可以去掉，判据也不必再陪着转。
       */
      capabilityId: V5CapabilityId | `project_${string}` | `file_${string}`;
      roleId: string;
      label: string;
      realLlm: boolean;
      loopTurnId?: string;
      progressType?:
        | "thinking"
        | "acting"
        | "observing"
        | "completed"
        | "failed";
      /**
       * 工程动作的**结构化**细节（真实命令 / 版本迁移 / 退出码 / 错误码），
       * 由 `projectActionDetail` 从工具结果事件里取。
       *
       * ⚠ 存在的理由是「不要去解析 label 里的文字」：本仓在前缀匹配和
       * 锚点窗口上栽过多次，文案一改判据就哑。见 `project-activity.ts` 头注。
       */
      projectDetail?: string;
      /**
       * 这一步对应的远端操作 id。服务端 `control_tool_result` 一直带着它；
       * 2026-09-18 起 `control_tool_start` 在 execute 返回后也会补一发。
       * 前端此前全程丢掉——于是拿不到它就订阅不了沙箱命令行输出
       * （`useSandboxLog`）。2026-09-14 补上。
       */
      operationId?: string;
    };

export type TurnStep =
  | {
      id: string;
      kind: "narration";
      text: string;
      source: "llm" | "fallback";
      isFinal?: boolean;
    }
  /**
   * 模型在动手之前对用户说的那段话（`control_text`）。
   *
   * ⚠ 故意**不复用** `narration`：narration 会被 `linesFromTurnSteps` 收进
   * 左栏活动列表，模型散文进去就变成跟「第 1 轮 · 正在执行 planning」同等
   * 分量的一行，正是要修的那个观感。这个 kind 不被 `textFromStep` 和
   * `linesFromTurnSteps` 认领，所以只在正文里以段落出现，不会双渲染。
   */
  | {
      id: string;
      kind: "model_speech";
      text: string;
      round?: number;
    }
  /**
   * 自动续跑那一轮的**显式标记**（服务端 `control_continuation` 事件）。
   *
   * ⚠ 存在的唯一理由是「认标记不认话」：自动续跑没有用户文本，靠匹配机器
   * 排的句子来识别续跑那条路在这里必然断。见 turn-continuation.ts 的
   * `turnHasContinuationMark` 头注。
   *
   * 它不进左栏活动列表（linesFromTurnSteps 不认它），也不算一步——它是这一轮
   * 的一个属性，不是一个动作。
   */
  | {
      id: string;
      kind: "continuation_mark";
      attempt: number;
      blockedReasons?: string[];
    }
  | TurnChipStep
  | {
      id: string;
      kind: "step_narration";
      text: string;
      capabilityId: V5CapabilityId;
      roleId?: string;
      realLlm: boolean;
      loopTurnId?: string;
      capabilityRunId?: string;
      runIndex?: number;
    }
  | {
      id: string;
      kind: "capability_fail";
      capabilityId: V5CapabilityId;
      roleId: string;
      loopTurnId: string;
      capabilityRunId: string;
      runIndex: number;
      message: string;
    }
  | {
      /** 思考流留档（2026-07-10 用户裁决）：推演结束后 LLM 每步的完整
       *  输出保留成可折叠记录（Claude 式），不再随 llmDraft 清空消失。 */
      id: string;
      kind: "llm_output";
      /** 人话标题（"LLM 正在分析风险"→"分析风险"归档态） */
      title: string;
      text: string;
      /**
       * `text` 被落库瘦身截断**之前**的长度（见 turn-narration.slimStep）。
       *
       * 只有截过的步骤才有这个键。没有它 = `text` 就是全文，直接数它。
       * 存在的理由：截断后的长度恒等于 1201（1200 上限 + 省略号），拿它当
       * 字数显示，一排步骤会整整齐齐写着同一个数——用户 2026-08-23 报的
       * 就是这个。
       */
      textChars?: number;
      /** true = 五系统 JSON（代码块面板）；false = 纯文字思考流 */
      formatJson: boolean;
    };

/** Product page turn — progressive conversation (user bubble + step stream). */
export type UiTurn = {
  id: string;
  user: string;
  /** E16 收口句：本轮真实用时（完成时打点；恢复轮取自 turnNarrations） */
  durationMs?: number;
  status: "streaming" | "complete";
  steps: TurnStep[];
  /** S9: runtime-recorded facts for turn-route projection. */
  routeFacts: TurnRouteFacts;
  routeExpanded: boolean;
  routeLitCount: number;
  assistant: string;
  assistantSource: "llm" | "fallback";
  narrationReason?: NarrationFallbackReason;
  main: { artifactId: string; kind: string; realLlm: boolean } | null;
  actions: ActionTrace[];
};

export type SlideRuleExecutorMode =
  | "pilot"
  | "server-llm"
  | "default"
  | "demo"
  | "browser-llm";

/** Extended persisted session state including publishClosure evidence (for frontend session store adapter).
 *  publishClosure?: PublishClosureSummary | null is carried explicitly by useSlideRuleSession adapter + python schema.
 *  Optional for legacy session compat (old sessions missing key load/restore with undefined, no breakage).
 */

/** @deprecated Engineering cockpit only — product page uses UiTurn. */
export type ChatTurn = {
  id: string;
  user: string;
  selected: Array<{ cap: V5CapabilityId; role: string }>;
  reason: string;
  artifacts: WhyArtifact[];
};
