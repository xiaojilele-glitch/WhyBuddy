/**
 * SlideRule product view (/sliderule): ONE unified surface (studio skeleton).
 *
 * - Single header row: brand/topic + STATUS summary + actions (交付物/重置会话/Dev)
 * - Left column: conversation; composer sits under the thread (not a page-wide overlay)
 * - Right rail: ArchitectureStage (sandbox / C4) + drawer inspector / Checks
 *
 * The old chat/reasoning/studio surface toggle was removed (2026-07): one page,
 * one mental model. The v4 pan/zoom reasoning canvas is gone from this page;
 * ?im=dev still opens the split engineering cockpit with the flow canvas.
 */

import { BRAND_NAME_FULL } from "@shared/brand";
import {
  DEFAULT_SESSION_ID,
  applySessionToHistory,
  hrefFromWindow,
  resolveActiveSessionId,
  sessionIdFromHref,
} from "@/lib/sliderule-session-id";
import { quietHint } from "./sliderule/quiet-time";
import { TurnResultCard } from "./sliderule/TurnResultCard";
import { useProjectThumbnail } from "./sliderule/project-runtime/useProjectThumbnail";
import { NextStepSuggestions } from "./sliderule/NextStepSuggestions";
import { PlanTodoDock } from "./sliderule/PlanTodoDock";
import { deriveProjectActivity } from "./sliderule/project-activity";
import { isOfficeFileDeliverable, latestPlanDeliverableKind, planWrittenHasDeliverableKind } from "./sliderule/deliverable-kind";
import { useOfficeArtifactPresent } from "./sliderule/project-runtime/office-artifacts-client";
import {
  shouldAutoCreateProject,
  shouldShowProjectComputer,
} from "./sliderule/project-computer-view";
import { useAuth } from "@/lib/use-auth";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  getExternalStoreMessages,
  useExternalStoreRuntime,
  useMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ArrowDown, Plus } from "lucide-react";
import type { BrainstormReasoningNode } from "@shared/blueprint";
import { ReasoningFlowSurface } from "@/components/autopilot/ReasoningFlowSurface";
import { useSlideRuleSession } from "./sliderule/useSlideRuleSession";
import { autopilotTheme } from "./sliderule/autopilot-theme";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";
import { LlmLiveOutput } from "./sliderule/LlmLiveOutput";
import { RollingText } from "./sliderule/RollingText";
import { ThinkingOrbMark } from "./sliderule/ThinkingOrbMark";
import { turnTimelineHeader } from "./sliderule/activity-rows";
import { ActivityList } from "./sliderule/ActivityList";
import { deriveStageBands } from "./sliderule/stage-authority";
import {
  foldContinuationTurns,
  turnHasContinuationMark,
  turnIsContinuation,
} from "./sliderule/turn-continuation";

/** llm_delta 来源标签 → 实时块标题（能力 id / "five-system-model" / "closure.summary"）。 */
function llmDraftTitle(label: string | null | undefined): string {
  if (!label || label === "five-system-model") return "五系统模型起草中";
  if (label === "closure.summary") return "正在整理推演总结";
  const entry = (
    CAPABILITY_PROCESS_LABELS as Record<string, { liveLabel?: unknown }>
  )[label];
  const live =
    typeof entry?.liveLabel === "function"
      ? (entry.liveLabel as (ctx: object) => string)({})
      : (entry?.liveLabel as string | undefined);
  return live ? live.replace(/^⚡\s*/, "") : `正在执行 ${label}`;
}
import { narrationFallbackHint } from "@/lib/sliderule-narrator";
import { TurnRouteTimeline } from "./sliderule/TurnRouteTimeline";
import { deriveSlideRuleReasoningViewModel } from "./sliderule/derive-reasoning-view-model";
import {
  deriveCrossRuntimeGraphSummary,
  derivePublishClosureSummary,
  selectPublishClosureSummary,
  type CrossRuntimeGraphSummary,
  type PublishClosureSummary,
} from "./sliderule/derive-cross-runtime-summary";
import { resolveImSurfaceMode } from "./sliderule/im-surface-mode";
import { deriveSettledFiveSystemModel } from "./sliderule/system-screens/five-system-model";
import {
  assistantTextForTurn,
  turnDidFactoryWork,
} from "./sliderule/assistant-text-for-turn";
import {
  answerAlreadySpoken,
  renderableModelSpeech,
} from "./sliderule/model-speech";
import { ensureReadableChatMarkdown } from "./sliderule/readable-chat-markdown";
import { SlideRuleStatusBar } from "./sliderule/SlideRuleStatusBar";
import {
  deriveStatusBarFacts,
  idleRehearsalCursor,
  type ContextHudFacts,
  type RehearsalClockCursor,
  type RehearsalClockView,
} from "./sliderule/derive-status-bar";
import type { FactoryDecisionView } from "./sliderule/derive-factory-decision";
import {
  PreviewChromeLayoutButtons,
  SlideRuleResetSessionButton,
} from "./sliderule/SlideRuleTopHud";
import { StudioLayoutProvider } from "./sliderule/StudioLayoutContext";
import { isStudioChromeShown } from "./sliderule/studio-layout";
import {
  ACTIVE_SESSION_KEY,
  SESSION_CHANGED_EVENT,
} from "./agent-loop/dashboard/SidebarSessions";
import {
  ClarificationCard,
  type ClarificationItem,
} from "./sliderule/ClarificationCard";
import { DeliverablesPanel } from "./sliderule/DeliverablesPanel";
import { ComposerDock } from "./sliderule/ComposerDock";
import { dispatchChallengePrefill } from "./sliderule/challenge-composer";
import { HomeInspiration } from "./sliderule/home-inspiration";
import { composerEnterHintLabel } from "./sliderule/user-prefs";
import { EXAMPLE_INTENT_TEXTS } from "./sliderule/example-intents";
import type { UiTurn } from "./sliderule/types";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { rememberActiveProjectId } from "@/lib/skill-store-client";
import {
  GITHUB_PAGES_DEMO_SESSION_ID,
  GITHUB_PAGES_DEMO_GOAL,
} from "./sliderule/github-pages-sliderule-demo";

import {
  deriveLineageHighlightNodeIds,
  graphNodeIdForArtifact,
} from "./sliderule/derive-lineage-highlight";

import {
  downloadSlideRuleDeliveryMd,
  serializeSlideRuleDeliveryMd,
} from "./sliderule/serialize-sliderule-delivery-md";
import { downloadSlideRuleDeliveryHtml } from "./sliderule/serialize-sliderule-delivery-html";
import {
  deriveLatestTurnFromState,
  deriveTurnsFromState,
} from "./sliderule/derive-persisted-turn";
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  SLIDERULE_TERMINAL_NODE_ID,
  type ProjectionDensity,
} from "./sliderule/sliderule-projection-constants";
import {
  fetchJsonSafe,
  isPythonBackendFailure,
  isDegradedApiError,
  getLegacyFallbackReason,
} from "@/lib/api-client";
import { deriveApplication, slideRule } from "@/lib/skills/slideRule";
import { Spin } from "antd";
import { SlideRuleStudio } from "./sliderule/SlideRuleStudio";
import { Response } from "@/components/ai/response";
import { SessionStory } from "./sliderule/SessionStory";

// Python full-path E2E wiring (105): /agent-loop/sliderule and /sliderule
// render this component, while turn/evidence/report calls surface Python
// provenance through the delegated /api/sliderule path.

const HINT_CHIPS_SPLIT = [
  "Compare routes",
  "澄清权限边界",
  "分析安全风险",
  "Break into SPEC Tree",
  "Generate feasibility report",
  "效果预览",
];

function LiveActionIndicator({ liveAction }: { liveAction: LiveAction }) {
  return (
    <div
      className={
        liveAction.external
          ? autopilotTheme.liveActionExternal
          : autopilotTheme.liveActionThink
      }
    >
      {!liveAction.external && (
        <span className="mr-2 inline-flex align-middle" aria-hidden>
          <ThinkingOrbMark label={liveAction.label} size={20} />
        </span>
      )}
      {liveAction.label}
    </div>
  );
}

function TurnFootnote({
  turn,
  sessionId,
  onChallenge,
}: {
  turn: UiTurn;
  sessionId: string;
  onChallenge: (artifactId: string) => void;
}) {
  const parts: React.ReactNode[] = [];

  parts.push(
    <a
      key="evidence"
      href={`/sliderule/dev?session=${encodeURIComponent(sessionId)}`}
      className="text-stone-500 hover:text-stone-700 hover:underline"
    >
      Evidence chain
    </a>
  );

  if (turn.main) {
    parts.push(
      <button
        key="challenge"
        type="button"
        data-testid="sliderule-challenge-turn"
        onClick={() => onChallenge(turn.main!.artifactId)}
        className="text-stone-500 hover:text-stone-700 hover:underline"
      >
        质疑这轮结论
      </button>
    );
    parts.push(
      <span key="source" className="text-stone-400">
        {turn.main.realLlm ? "真实推演" : "规则推演"}
      </span>
    );
  }

  if (turn.assistantSource === "fallback") {
    const fallbackHint =
      narrationFallbackHint(turn.narrationReason) ||
      "叙述服务暂不可用，本条为系统模板回复（产物与结论状态不受影响）";
    parts.push(
      <span key="fallback" className="text-stone-400" title={fallbackHint}>
        模板回复
      </span>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-stone-500">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-stone-300">·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

function textFromStep(
  step: UiTurn["steps"][number] | null | undefined
): string {
  if (!step) return "";
  if (step.kind === "narration" || step.kind === "step_narration")
    return step.text;
  if (step.kind === "chip") return step.label;
  if (step.kind === "capability_fail") return step.message;
  return "";
}

/**
 * ModelSpeechBlocks — 模型动手之前对用户说的那几段话。
 *
 * 排在活动列表**上面**：先说「我要做什么、为什么」，再铺机械步骤——对照
 * Manus 的那一列。不是芯片、不进时间线，理由见 `model-speech.ts` 头注。
 */
function ModelSpeechBlocks({ turn }: { turn: UiTurn }) {
  const speech = React.useMemo(() => renderableModelSpeech(turn), [turn.steps]);
  if (speech.length === 0) return null;
  return (
    <div
      className="min-w-0 space-y-2 text-[14px] leading-[1.7] text-[#171717]"
      data-testid="sliderule-model-speech"
      data-speech-count={speech.length}
    >
      {speech.map(item => (
        <p
          key={item.id}
          className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {item.text}
        </p>
      ))}
    </div>
  );
}

/**
 * TurnPhaseTimeline — 左栏活动列表。
 * 权属分带（选材 / 画应用 / 闸），对照 BettaFish「阶段 ≠ 正文」，
 * 不装论坛。运行中铺最近动作；完成后收成「N 步 · Ns」。
 */
function TurnPhaseTimeline({
  turn,
  llmDraft = "",
  publishClosure,
}: {
  turn: UiTurn;
  llmDraft?: string;
  publishClosure?: PublishClosureSummary | null;
}) {
  const streaming = turn.status === "streaming";
  const extraTexts: string[] = [];
  if (llmDraft)
    extraTexts.push(`最新定义：起草中 · 已产出 ${llmDraft.length} 字符`);
  if (publishClosure && !streaming) {
    extraTexts.push(
      publishClosure.blocked
        ? `blocked ${publishClosure.evidencePresentCount}/${publishClosure.skillCount}`
        : `closed ${publishClosure.evidencePresentCount}/${publishClosure.skillCount}`
    );
  }
  const groups = React.useMemo(
    () =>
      deriveStageBands({
        steps: turn.steps,
        streaming,
        planSource: turn.routeFacts.planSource,
        extraTexts,
        // 续跑轮不重演开场（接收意图 / 编排 / planning）——见
        // turn-continuation 头注：一跳一件是有意的，重画开场不是。
        continuation: turnIsContinuation(turn),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      turn.steps.map(textFromStep).join("\n"),
      streaming,
      llmDraft,
      publishClosure,
      turn.routeFacts.planSource,
      // ⚠ 少一条依赖 = 续跑轮切换时不重算，左栏还是旧的那份。
      turn.user,
      // ⚠ 2026-09-13：自动续跑认的是 `continuation_mark` step，而上面那条
      //   `turn.steps.map(textFromStep)` 对这个 kind 返回空串（textFromStep
      //   不认它，那是有意的——标记不是一步动作）。只加函数不加依赖，标记
      //   到达时 memo 不重算，折叠**静默不生效**：又是「改了一半」。
      turnHasContinuationMark(turn),
    ]
  );
  const stepTexts = turn.steps.map(textFromStep).filter(Boolean);
  if (groups.length === 0) return null;

  return (
    <ActivityList
      groups={groups}
      streaming={streaming}
      header={turnTimelineHeader({
        stepCount: stepTexts.length,
        durationMs: turn.durationMs,
        refineReuseNote: publishClosure?.refineReuseNote,
      })}
      closureMeta={
        publishClosure
          ? `${publishClosure.evidencePresentCount}/${publishClosure.skillCount}`
          : null
      }
    />
  );
}

// 快速开始：三个完整场景，点击把意图填进输入框（fill-prompt 不变）。
// 2026-08-20 空态输入对照 Cursor / Continue：圆角卡片 + 字在上工具在下，
// 不要 Stitch 粉紫光晕。底部灵感仍是一句导去应用中心 Fork，不画卡。
// 上一版 Cursor 新会话太瘦；再上一版 logo + 主张句 + 投影卡又太像落地页
// （测试仍禁止那些旧文案）。
const QUICK_STARTS: ReadonlyArray<{
  label: string;
  fill: string;
}> = [
  { label: "采购审批应用", fill: EXAMPLE_INTENT_TEXTS[0] },
  { label: "员工入职流程", fill: EXAMPLE_INTENT_TEXTS[1] },
  {
    label: "客户管理系统",
    fill: "做一个客户管理系统，包含客户档案、跟进记录、销售漏斗和分级权限",
  },
];

function fillPrompt(text: string) {
  window.dispatchEvent(
    new CustomEvent("sliderule:fill-prompt", { detail: { text } })
  );
}

function HomeEmptyState({
  isRunning,
  composerSlot,
  clarifySlot,
  todoSlot,
  runtimeKind,
}: {
  isRunning: boolean;
  /** 空态时唯一的 ComposerDock 挪进首页流（开聊后贴在会话流底部，二选一渲染） */
  composerSlot?: React.ReactNode;
  /** 澄清卡叠在输入框上方（absolute），不能当 flex 孩子——会把输入顶走 */
  clarifySlot?: React.ReactNode;
  /** 待办卡跟输入条走；空清单时组件自己不画 */
  todoSlot?: React.ReactNode;
  runtimeKind?: "html-prototype" | "project";
}) {
  // ⚑ E41 官方示例的「点模板卡 → 暂存起手意图 → 空态预填」消费端
  //   已随示例库一起下架（2026-08-14，用户裁决清除四个官方示例）——
  //   没有生产者再往 sliderule:pending-template-intent 写值。
  return (
    <div
      className="relative flex min-h-full flex-1 flex-col"
      data-testid="sliderule-empty-state"
    >
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-7 px-1 py-6">
        {/* ⚠ 2026-09-14：空态不再挂「工程模式可用 · 确认计划后创建工程」。
            人来写意图，不是来读运行时徽章。工程未启用的告警仍在开聊后的
            HTML 兼容条上，空态这里只留问候。
            ⚠ 2026-09-20：空态问候换过两轮。「想做什么？」像盘问；
            「我能为你做什么？」照搬 Manus。现在用日常口气。 */}
        <div className="flex w-full flex-wrap items-center justify-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight text-[#171717] sm:text-[28px]">
            {runtimeKind === "project"
              ? "继续开发这个工程"
              : "今天做点什么？"}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isRunning}
              data-testid="sliderule-empty-upload"
              onClick={() =>
                window.dispatchEvent(new Event("sliderule:open-file-picker"))
              }
              className="inline-flex items-center gap-1 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-[13px] text-[#333] transition hover:bg-[#e8eaed] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              上传资料
            </button>
            <button
              type="button"
              disabled={isRunning}
              data-testid="sliderule-empty-example"
              onClick={() => fillPrompt(QUICK_STARTS[0].fill)}
              className="inline-flex items-center gap-1 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-[13px] text-[#333] transition hover:bg-[#e8eaed] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              从示例开始
            </button>
          </div>
        </div>

        {composerSlot && (
          <div
            className="relative w-full max-w-[680px]"
            data-testid="sliderule-hero-composer"
          >
            {clarifySlot}
            {todoSlot}
            {composerSlot}
          </div>
        )}

        <div className="flex max-w-[680px] flex-wrap justify-center gap-2">
          {QUICK_STARTS.map(({ label, fill }) => (
            <button
              key={label}
              type="button"
              disabled={isRunning}
              data-testid={`sliderule-quick-start-${label}`}
              title={fill}
              onClick={() => fillPrompt(fill)}
              className="rounded-full bg-[#f3f4f6] px-3.5 py-1.5 text-[13px] text-[#444] transition hover:bg-[#e8eaed] disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
        <p
          className="text-center text-[12px] leading-5 text-[#a1a1aa]"
          data-testid="sliderule-empty-enter-hint"
        >
          {composerEnterHintLabel()}
        </p>
      </div>

      <div className="relative z-10">
        <HomeInspiration />
      </div>
    </div>
  );
}

/**
 * ClaudeChatSurface — 统一页左栏对话区（Claude 风格轻量 prose 布局）。
 * 头部动作（交付物 / 重置会话 / Dev）由页面唯一顶栏承担；这里只负责对话流与
 * 唯一空态（问候 + Cursor 卡片输入 + chips + 灵感一句）。
 */
// --- assistant-ui 迁移（左栏 IM 地基）--------------------------------------
// 滚动跟随 / 消息列表 / 空态分支由 Thread 原语接管（Viewport 自带贴底跟随，
// 替换此前手写的 stick-to-bottom）；语义时间线、实时流、结论块是差异化
// 内容，保留为自定义消息渲染，不外包给通用库。

/** uiTurns（用户+助手成对）→ 扁平消息项；turn 原对象随消息绑定回取。 */
type ImItem = { id: string; role: "user" | "assistant"; turn: UiTurn };

/**
 * uiTurns → 外部存储消息数组。**id 必须唯一**：assistant-ui 的
 * MessageRepository 对重复消息 id 直接抛错，React 边界接住后整页只剩
 * "An unexpected error occurred"（2026-08-18 步伴真机：版本史同轮存了两份
 * → 恢复出两个同 id 轮次 → 白屏）。源头已在 deriveTurnsFromState 收口，
 * 这里是适配层的最后一道对账——上游官方适配器同样在同步前做 id 对账
 * （assistant-ui#2380 / #4037），任何未来的新造轮路径撞了 id，也只该丢一条
 * 消息并留告警，不该崩掉整个页面。同 id 保留**后出现**的那条（更新）。
 */
export function buildImItems(uiTurns: UiTurn[]): ImItem[] {
  const flat = foldContinuationTurns(uiTurns).flatMap(turn => [
    ...(turn.user
      ? ([{ id: `${turn.id}-user`, role: "user", turn }] as ImItem[])
      : []),
    { id: `${turn.id}-assistant`, role: "assistant" as const, turn },
  ]);
  const seen = new Set<string>();
  const keep: ImItem[] = [];
  for (let i = flat.length - 1; i >= 0; i--) {
    if (seen.has(flat[i].id)) {
      console.warn(
        `[sliderule] 消息 id 撞车，丢弃先出现的一条以保住页面：${flat[i].id}`
      );
      continue;
    }
    seen.add(flat[i].id);
    keep.push(flat[i]);
  }
  return keep.reverse();
}

/** 轮次之外的渲染上下文（草稿流/闭环/话题），经 context 传给自定义消息组件——
 *  组件定义在模块层保持身份稳定（每帧重建会让 Messages 整列重挂）。 */
/**
 * 距上一次「有动静」过了多少秒。`marker` 变了就重置。
 *
 * ⚠ 纯粹的展示逻辑留在组件层，可判据的那部分在 `quiet-time.ts`（`quietHint`）。
 *   这里只负责把秒数喂过去：一秒一跳的 setInterval 只在运行中挂着，
 *   停下来就清掉，不让它在空闲页面上一直转。
 */
function useQuietSeconds(marker: string, running: boolean): number {
  const [seconds, setSeconds] = React.useState(0);
  const sinceRef = React.useRef(Date.now());
  React.useEffect(() => {
    sinceRef.current = Date.now();
    setSeconds(0);
  }, [marker, running]);
  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSeconds((Date.now() - sinceRef.current) / 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return running ? seconds : 0;
}

const ImSurfaceContext = React.createContext<{
  publishClosure?: PublishClosureSummary | null;
  llmDraft: string;
  llmDraftLabel: string | null;
  /** E16.1 多流分窗：并行 LLM 子调用各占一个稳定窗口（修"打架来回切换"） */
  llmStreams: Array<{ label: string; text: string }>;
  goalText?: string;
  thinkingText: string;
  /** 静默久了才出现的「已等待 N 秒」；没到门槛是 null（见 quiet-time.ts）。 */
  quietHint: string | null;
  /** 工程档已落库的源码版本；结果卡靠它判断「这一轮真的产出了东西」。 */
  projectRevision?: string | null;
  /** 后续建议要读的那一小块（模型自己的待办）。整个 state 不进 context。 */
  sessionState?: {
    controlTodo?: Array<{ id?: string; status?: string; content?: string }>;
  } | null;
  /**
   * 最近一次验收跑出来的截图。
   *
   * ⚠ 2026-09-14：第一版是把 projectId 交给每张结果卡、卡片自己 useProjectThumbnail。
   *   会话里有几轮就有几张卡，于是**同一个工程的 /verification 被重复 GET 几次**，
   *   拿回来的还是同一份。取数提到这儿只发一次，卡片只管画。
   */
  thumbnailUrl?: string | null;
  isRunning: boolean;
  onChallenge: (id: string) => void;
  /** E26：最新一轮的 id——「补齐缺口」只挂在被闸拦截的最新轮上 */
  latestTurnId?: string | null;
  runtimeKind?: "html-prototype" | "project";
  turns?: UiTurn[];
  deliverableKind?: string;
  hasOfficeArtifact?: boolean;
}>({
  llmDraft: "",
  llmDraftLabel: null,
  llmStreams: [],
  thinkingText: "",
  quietHint: null,
  projectRevision: null,
  sessionState: null,
  thumbnailUrl: null,
  isRunning: false,
  onChallenge: () => {},
  latestTurnId: null,
  runtimeKind: "html-prototype",
  turns: [],
  deliverableKind: "web-app",
  hasOfficeArtifact: false,
});

const convertImMessage = (m: ImItem): ThreadMessageLike => ({
  id: m.id,
  role: m.role,
  // 文本部件只为 assistant-ui 的消息模型成立（复制/无障碍语义用真文本）；
  // 实际渲染由自定义组件对着原 turn 输出，不读部件。
  content: [
    { type: "text", text: m.role === "user" ? (m.turn.user ?? "") : "" },
  ],
});

/** 从 assistant-ui 消息取回绑定的原始 turn（ExternalStore 转换时自动绑定）。 */
function useImTurn(): ImItem | null {
  const message = useMessage();
  const items = getExternalStoreMessages<ImItem>(message as never);
  return items[0] ?? null;
}

function ImUserMessage() {
  const item = useImTurn();
  // 没有用户文本的轮次不渲染气泡（系统提示 / 空恢复轮）
  if (!item?.turn.user) return null;
  const text = item.turn.user;
  return (
    <div className="group mb-3 flex flex-col items-end">
      {/* 2026-08-18：用户块改 Cursor 灰底，不是品牌蓝气泡。
          上一版 #e6f4ff 在对话流里像消费级聊天，跟侧栏/空会话那套对不上。 */}
      <div
        data-testid="sliderule-user-bubble"
        className="max-w-[560px] rounded-[10px] bg-[#f3f4f6] px-3 py-2 text-[13.5px] leading-6 text-[#171717]"
      >
        {text}
      </div>
      {/* 迭代环：意图原文回填输入条，改半句再推（悬停显现，不抢注意力） */}
      <button
        type="button"
        data-testid="sliderule-edit-rerun"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("sliderule:fill-prompt", { detail: { text } })
          );
        }}
        className="mt-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-stone-400 opacity-0 transition-opacity hover:bg-[#f3f4f6] hover:text-stone-600 focus:opacity-100 group-hover:opacity-100"
      >
        编辑重跑
      </button>
    </div>
  );
}

function ImAssistantMessage() {
  const item = useImTurn();
  const ctx = React.useContext(ImSurfaceContext);
  if (!item) return null;
  const { turn } = item;
  const {
    publishClosure,
    llmDraft,
    llmStreams,
    goalText,
    thinkingText,
    onChallenge,
    runtimeKind,
    turns,
    deliverableKind,
    hasOfficeArtifact,
  } = ctx;
  const rawAnswer = assistantTextForTurn(turn, publishClosure, goalText, {
    runtimeKind,
  });
  // 完成轮故事面已经画过同一句开口，收尾再印就是用户圈出来的重影。
  const answer = ensureReadableChatMarkdown(
    answerAlreadySpoken(rawAnswer, turn) ? "" : rawAnswer
  );
  const resultCard = (
    <TurnResultCard
      turn={turn}
      runtimeKind={runtimeKind}
      goalText={goalText}
      projectRevision={ctx.projectRevision}
      /* ⚠ 只挂在**最新那一轮**上：验收截图拍的是工程此刻的样子，
           贴到三轮之前那张卡上就是张张牛头不对马嘴的图。 */
      thumbnailUrl={
        turn.id === ctx.latestTurnId ? ctx.thumbnailUrl : null
      }
      hasPages={Boolean(turn.main)}
      deliverableKind={deliverableKind}
      hasOfficeArtifact={hasOfficeArtifact}
      onOpen={() => {
        window.dispatchEvent(
          new CustomEvent("sliderule:open-deliverable")
        );
      }}
      onRetry={() => {
        if (!turn.user) return;
        window.dispatchEvent(
          new CustomEvent("sliderule:resend-prompt", {
            detail: { text: turn.user },
          })
        );
      }}
    />
  );
  return (
    <div className="mb-3 min-w-0 max-w-[640px]">
      {turn.status === "streaming" ? (
        <div className="space-y-1.5">
          {/* ⚠ 流式 / 完成是成对物（§4）。工程档两支都走 SessionStory，
              只改完成轮 = 跑的时候又变回三桶并排。 */}
          {runtimeKind === "project" ? (
            <SessionStory
              turn={turn}
              streaming
              productSlot={null}
              deliverableKind={deliverableKind}
            />
          ) : (
            <ModelSpeechBlocks turn={turn} />
          )}
          <div className="flex items-center gap-2 text-[13px] text-stone-500">
            <ThinkingOrbMark label={thinkingText} size={20} />
            {/* 状态文案翻滚过渡（anime.js）——不再生硬跳变 */}
            <RollingText text={thinkingText} className="min-w-0 flex-1" />
            {/* 静默久了才出现。短回合一个字都不多（quiet-time.ts 头注）。 */}
            {ctx.quietHint ? (
              <span className="shrink-0 tabular-nums text-stone-400">
                {ctx.quietHint}
              </span>
            ) : null}
          </div>
          {/* 工程档的动作流是上面那列勾；六步钟/阶段带是 HTML 推演的词汇，
              两套并排会把对话做成看板。 */}
          {runtimeKind !== "project" ? (
            <TurnPhaseTimeline
              turn={turn}
              llmDraft={llmDraft}
              publishClosure={publishClosure}
            />
          ) : null}
          {/* LLM 实时想法默认折叠（PR-2）：点开才见 risk.analyze 原文。
              现在在哪一步看上面的六步钟，不靠散文。 */}
          {llmStreams.map(stream => (
            <LlmLiveOutput
              key={stream.label}
              title={llmDraftTitle(stream.label)}
              text={stream.text}
              formatJson={stream.label === "five-system-model"}
            />
          ))}
        </div>
      ) : (
        /* 14px 正文（用户裁决：再小一号，信息密度优先） */
        <div
          className="space-y-1.5 text-[14px] leading-6 text-[#171717]"
          data-testid="sliderule-assistant-text"
        >
          {/* 完成后同样保留开口：它是这一轮「为什么这么做」的唯一记录，
              收尾总结替代不了过程里的判断。工程档走章节面——往上滚
              过程还在，不再只挂 latestTurn。 */}
          {runtimeKind === "project" ? (
            <SessionStory
              turn={turn}
              streaming={false}
              productSlot={resultCard}
              deliverableKind={deliverableKind}
            />
          ) : (
            <>
              <ModelSpeechBlocks turn={turn} />
              {/* 结果卡：这一轮真的产出了东西才出（判断在 turn-result-card.ts）。
                  没有它的话，成果只活在右侧预览列里——往上滚看历史什么都不剩。 */}
              {resultCard}
            </>
          )}
          {/* 后续建议贴着结果，不混进输入条的通用提示（NextStepSuggestions 头注）。
              只挂在最新一轮：历史轮次的「下一步」早就过期了。 */}
          {(
            ctx.latestTurnId
              ? turn.id === ctx.latestTurnId
              : turn.id === turns?.at(-1)?.id
          ) ? (
            <NextStepSuggestions
              state={ctx.sessionState}
              onPick={text => {
                window.dispatchEvent(
                  new CustomEvent("sliderule:fill-prompt", { detail: { text } })
                );
              }}
            />
          ) : null}
          {runtimeKind !== "project" ? (
            <TurnPhaseTimeline turn={turn} publishClosure={publishClosure} />
          ) : null}
          {/* 思考流留档：推演中每步 LLM 的完整输出，完成后保留成可折叠
              记录（Claude 式）——想法不消失，要看随时点开 */}
          {turn.steps.some(s => s.kind === "llm_output") && (
            <div className="space-y-1.5" data-testid="sliderule-llm-archives">
              {turn.steps.map(s =>
                s.kind === "llm_output" ? (
                  <LlmLiveOutput
                    key={s.id}
                    title={s.title}
                    text={s.text}
                    // 留档的 text 可能被落库瘦身截过；真字数在 textChars 里
                    chars={s.textChars}
                    formatJson={s.formatJson}
                    done
                  />
                ) : null
              )}
            </div>
          )}
          {/* E16 降级视觉词汇：中断/失败半成品带琥珀标记，不和正常回答长一个样 */}
          {turn.assistantSource === "fallback" &&
          answer.startsWith("推演中断") ? (
            <div className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
              {answer}
            </div>
          ) : (
            /* E16：正文走 streamdown——加粗、表格、代码块真渲染，
               不再裸奔星号（此前 whitespace-pre-wrap 纯文本）。
               data-answer-present：Response 在 SSR/静态渲染下产出为空
               （客户端才填充），测试以此属性断言"回答已就位"。 */
            <div
              className="max-w-none overflow-visible pb-1 text-[14px] leading-[1.7] text-[#171717]"
              data-testid="sliderule-turn-answer"
              data-host-speech={
                turn.assistantSource === "llm" ? "true" : "false"
              }
              data-answer-present={answer ? "true" : "false"}
            >
              <Response
                parseIncompleteMarkdown={false}
                className="h-auto w-full overflow-visible"
              >
                {answer}
              </Response>
            </div>
          )}
          {/* ⚠ 2026-09-14 用户指着工程档这两处说没用了：
              「质疑本轮 / 重新推演」和输入条上的「路线对比一下」。
              结果卡已经有重试；那几个芯片是 HTML 推演的词。工程档不画。 */}
          {runtimeKind !== "project" && (turn.main || turn.user) && (
            <div className="flex flex-wrap items-center gap-1 text-[12px] text-stone-400">
              {/* E26：闭环被闸拦截（证据缺口）→ 主动作是「哪里缺补哪里」——
                  服务端只重跑覆盖门标红的能力，已 PASS 产物原样复用；
                  旁边的「重新推演」保持整轮重推语义，两个按钮各说各话 */}
              {publishClosure?.blocked && turn.id === ctx.latestTurnId && (
                <button
                  type="button"
                  data-testid="sliderule-repair-gaps"
                  disabled={ctx.isRunning}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("sliderule:repair-gaps")
                    );
                  }}
                  className="rounded-md px-1.5 py-0.5 font-medium text-[#1264a3] hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
                  title="只重跑证据缺口对应的能力，已完成的产物原样保留"
                >
                  补齐缺口
                </button>
              )}
              {turn.main && (
                <button
                  type="button"
                  data-testid="sliderule-challenge-turn"
                  onClick={() => onChallenge(turn.main!.artifactId)}
                  className="rounded-md px-1.5 py-0.5 hover:bg-[#f3f4f6] hover:text-stone-600"
                >
                  质疑本轮
                </button>
              )}
              {/* 迭代环：同题重发（基于当前推演状态再推一次，非回滚重放） */}
              {turn.user && (turn.main || turnDidFactoryWork(turn)) && (
                <button
                  type="button"
                  data-testid="sliderule-rerun-turn"
                  disabled={ctx.isRunning}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("sliderule:resend-prompt", {
                        detail: { text: turn.user },
                      })
                    );
                  }}
                  className="rounded-md px-1.5 py-0.5 hover:bg-[#f3f4f6] hover:text-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
                  title="以同一句意图基于当前推演状态整轮重推"
                >
                  重新推演
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// export：仅供测试静态渲染（页面内唯一消费方仍是本文件）
export function ClaudeChatSurface({
  uiTurns,
  isRunning,
  liveAction,
  latestTurn,
  publishClosure,
  llmDraft = "",
  llmDraftLabel = null,
  llmStreams = [],
  goalText,
  onChallenge,
  composerSlot,
  clarifySlot,
  rehearsalClock = null,
  hud = null,
  factoryDecision = null,
  projectCapabilities: _projectCapabilities = null,
  runtimeKind,
  projectRevision = null,
  controlTodo = null,
  projectId = null,
  deliverableKind = "web-app",
}: {
  uiTurns: UiTurn[];
  isRunning: boolean;
  liveAction: LiveAction | null;
  latestTurn: UiTurn | null;
  publishClosure?: PublishClosureSummary | null;
  /** LLM 实时草稿（llm_delta 累积；仅运行中展示尾部）。 */
  llmDraft?: string;
  /** 当前草稿来源：能力 id 或 "five-system-model"（决定实时块标题）。 */
  llmDraftLabel?: string | null;
  /** E16.1 多流分窗：活跃 LLM 子调用流（按首现顺序，运行中展示）。 */
  llmStreams?: Array<{ label: string; text: string }>;
  rehearsalClock?: RehearsalClockView | null;
  hud?: ContextHudFacts | null;
  /** 最近一次工厂选材。没有账本就不传——HUD 不许伪造。 */
  factoryDecision?: FactoryDecisionView | null;
  projectCapabilities?: {
    mode?: string;
    blockers?: string[];
    configured?: boolean;
    canExecute?: boolean;
  } | null;
  runtimeKind?: "html-prototype" | "project";
  /** 工程档已落库的源码版本；结果卡靠它判断有没有真的产出。 */
  projectRevision?: string | null;
  /** 模型自己的待办；浮层和后续建议行读它，不进聊天正文。 */
  controlTodo?: Array<{
    id?: string;
    status?: string;
    content?: string;
  }> | null;
  /** 结果卡缩略图要用。 */
  projectId?: string | null;
  /** 批准计划上的交付物类别；办公文件章节不标「构建网页」。 */
  deliverableKind?: string;
  /** 会话话题（恢复的轮次没有 turn.user，总结用它兜底） */
  goalText?: string;
  onChallenge: (id: string) => void;
  /** 空态嵌进首页流；开聊后改贴在会话流底部（同一受控组件二选一） */
  composerSlot?: React.ReactNode;
  /** 澄清卡跟输入条走：空态进首页流，开聊后贴在输入条上方 */
  clarifySlot?: React.ReactNode;
}) {
  const latestStepText = latestTurn
    ? textFromStep(latestTurn.steps.at(-1))
    : "";
  // 「多久没动静了」。⚠ 量的是**静默**不是回合总时长——游标跟着
  //   thinkingText 走，有新动静就重置（见 quiet-time.ts 头注）。
  //   2026-09-14 工程档单发超时放宽到 120 秒之后，没有它的话模型思考
  //   一两分钟的页面和卡死长得一模一样。
  const quietHintText = quietHint(
    useQuietSeconds(latestStepText + "|" + (liveAction?.label || ""), isRunning)
  );
  const thinkingText =
    liveAction?.label ||
    latestStepText ||
    (publishClosure
      ? publishClosure.blocked
        ? "发布闭环被阻塞，等待下一步修正"
        : "发布闭环完成"
      : "正在推演...");

  const items = useMemo<ImItem[]>(() => buildImItems(uiTurns), [uiTurns]);
  const isEmptyThread = uiTurns.length === 0 && !isRunning;
  // 浮层只展示控制面刚挑的动作，不拿它改 controlTodo。
  const todoAction = useMemo(() => {
    const rows = deriveProjectActivity(uiTurns);
    const last = rows[rows.length - 1];
    return last
      ? { id: last.id, tool: last.tool, detail: last.detail }
      : null;
  }, [uiTurns]);

  const runtime = useExternalStoreRuntime<ImItem>({
    messages: items,
    isRunning,
    convertMessage: convertImMessage,
    // 输入条是自定义 ComposerDock（语音/优化提示词/示例填充），不走 Thread 原语的
    // Composer——onNew 是适配器必填项，但当前没有 UI 会触发它。
    onNew: async () => {},
  });

  // 验收截图整个会话只取一次（见 context 里 thumbnailUrl 的头注）。
  const verifiedThumbnail = useProjectThumbnail(
    runtimeKind === "project" ? projectId : null
  );
  const hasOfficeArtifact = useOfficeArtifactPresent(
    runtimeKind === "project" && isOfficeFileDeliverable(deliverableKind)
      ? projectId
      : null,
    isRunning
  );
  const ctxValue = useMemo(
    () => ({
      publishClosure,
      llmDraft,
      llmDraftLabel,
      llmStreams,
      goalText,
      thinkingText,
      quietHint: quietHintText,
      projectRevision,
      sessionState: controlTodo ? { controlTodo } : null,
      thumbnailUrl: verifiedThumbnail,
      isRunning,
      onChallenge,
      latestTurnId: latestTurn?.id ?? null,
      runtimeKind,
      turns: uiTurns,
      deliverableKind,
      hasOfficeArtifact,
    }),
    [
      publishClosure,
      llmDraft,
      llmDraftLabel,
      llmStreams,
      goalText,
      thinkingText,
      quietHintText,
      projectRevision,
      controlTodo,
      verifiedThumbnail,
      isRunning,
      onChallenge,
      latestTurn?.id,
      runtimeKind,
      uiTurns,
      deliverableKind,
      hasOfficeArtifact,
    ]
  );

  // ⚠ 2026-09-15：六步钟不再挂在对话列顶上。用户圈了那条「2 起草 SPEC …
  //   6 汇合过闸」说移除——人在看它在想什么，不是来读工厂 hop 日历。
  //   组件还在，工程面 StatusBar / 单测仍直接渲染。
  void rehearsalClock;
  void factoryDecision;
  void hud;

  // 手机问卷固定到视口后会跨出对话栏，不能让右侧舞台截获按钮点击。
  return (
    <div className="relative z-30 flex h-full flex-col overflow-hidden bg-transparent text-[#1f2329] sm:z-0">
      {/* 点阵改挂 SlideRuleStudio 外壳（空态+开聊同一张网）。这里铺实心底
          会把那层点挡住——2026-08-20 已经踩过一次。 */}
      {/* Chat area — Viewport 自带贴底跟随（增量到达自动滚底、回翻停住） */}
      <AssistantRuntimeProvider runtime={runtime}>
        <ImSurfaceContext.Provider value={ctxValue}>
          <ThreadPrimitive.Root className="relative z-10 flex min-h-0 flex-1 flex-col">
            {/* E16 智能滚动补件：用户上滚回看时出「回到底部」胶囊
                （Viewport 本身已带贴底跟随；贴底时该按钮自动 disabled → 隐藏） */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <ThreadPrimitive.ScrollToBottom
                data-testid="sliderule-scroll-to-bottom"
                className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-medium text-stone-600 shadow-md transition hover:bg-stone-50 disabled:hidden"
              >
                <ArrowDown className="h-3 w-3" />
                回到底部
              </ThreadPrimitive.ScrollToBottom>
              <ThreadPrimitive.Viewport className="mx-auto flex min-h-0 min-w-0 w-full max-w-[720px] flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-1 pt-3 [scrollbar-gutter:stable] sm:px-5">
                <ThreadPrimitive.Empty>
                  {/* 空态：问候 + 输入 + chips + 底栏一句。chips 走 fill-prompt，
                    灵感句只导去应用中心，不造假功能入口。 */}
                  <HomeEmptyState
                    isRunning={isRunning}
                    runtimeKind={runtimeKind}
                    composerSlot={isEmptyThread ? composerSlot : undefined}
                    clarifySlot={isEmptyThread ? clarifySlot : undefined}
                    todoSlot={
                      isEmptyThread ? (
                        <PlanTodoDock items={controlTodo} action={todoAction} />
                      ) : undefined
                    }
                  />
                </ThreadPrimitive.Empty>
                <div className="py-0">
                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage: ImUserMessage,
                      AssistantMessage: ImAssistantMessage,
                    }}
                  />
                </div>
              </ThreadPrimitive.Viewport>
            </div>
            {!isEmptyThread && (composerSlot || clarifySlot) ? (
              <div
                className="pointer-events-auto shrink-0 bg-transparent px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-1 sm:px-5"
                data-testid="sliderule-composer-footer"
              >
                {/* Cursor / LobeChat：输入条浮在对话列里，不要横切 border-t 把步骤和输入割开。 */}
                <div className="relative mx-auto w-full max-w-[720px]">
                  {clarifySlot}
                  <PlanTodoDock items={controlTodo} action={todoAction} />
                  {composerSlot}
                </div>
              </div>
            ) : null}
          </ThreadPrimitive.Root>
        </ImSurfaceContext.Provider>
      </AssistantRuntimeProvider>

      {/* 底部六系统标签行已移除（用户反馈：终端用户不关心内部 skill 名，
          只添乱）——闭环状态在每轮回答的 closed x/6 pill 与右栏看板已有，
          交付物入口由顶栏承担。 */}
    </div>
  );
}

function DriveFullStatusBanner({
  status,
  className = "",
}: {
  status?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "control_failed"
    | "fallback";
  className?: string;
}) {
  // "loading" 不再展示：正常运行时左栏已有思考行 + 实时步骤流，这条横幅
  // 是纯重复（用户去重审查）；横幅只保留异常态（timeout/unavailable/fallback）。
  //
  // ⚠ 2026-09-17 TicketStream：control_failed 也不挂。顶上一句
  // 「本轮执行已中断，详见会话中的具体原因」，会话里已经有琥珀卡
  // 「推演中断：控制面未返回结果（可重试或换指令）」。横幅自己都在
  // 指会话——钉两条就是重复。
  if (
    !status ||
    status === "idle" ||
    status === "python_success" ||
    status === "loading" ||
    status === "control_failed"
  )
    return null;
  const text =
    status === "timeout"
      ? "/drive-full timeout"
      : status === "python_unavailable"
        ? "/drive-full Python unavailable"
        : "/drive-full fallback";
  return (
    <div
      data-testid="sliderule-drive-full-status"
      data-status={status}
      className={`pointer-events-auto rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 shadow-sm ${className}`}
      title={text}
    >
      {text}
    </div>
  );
}

export function deriveNoIntentRuntimeProjection({
  pythonPublishClosure,
  pythonSkillRuntimeGraph,
}: {
  pythonPublishClosure?: PublishClosureSummary | null;
  pythonSkillRuntimeGraph?: unknown;
}): {
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} {
  const runtimeCross = pythonSkillRuntimeGraph
    ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
        exampleLimit: 5,
      })
    : null;
  const closure = pythonPublishClosure ?? null;
  return {
    crossRuntimeGraph:
      runtimeCross ||
      (closure
        ? {
            edgeCount: 0,
            allowedCount: 0,
            blockedCount: 0,
            skillCount: closure.skillCount || 0,
            evidenceCount: closure.evidencePresentCount || 0,
            examples: [],
          }
        : null),
    publishClosure: closure,
  };
}

export function deriveImmediatePythonRuntimeProjection({
  pythonPublishClosure,
  pythonSkillRuntimeGraph,
}: {
  pythonPublishClosure?: PublishClosureSummary | null;
  pythonSkillRuntimeGraph?: unknown;
}): {
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} | null {
  if (!pythonPublishClosure && !pythonSkillRuntimeGraph) return null;
  return deriveNoIntentRuntimeProjection({
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  });
}

export async function loadPythonRuntimeProjectionFromSession(
  sessionId: string,
  fetcher: typeof fetch = fetch
): Promise<{
  crossRuntimeGraph: CrossRuntimeGraphSummary | null;
  publishClosure: PublishClosureSummary | null;
} | null> {
  const response = await fetcher(
    `/api/sliderule/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const state =
    body?.state && typeof body.state === "object" ? body.state : body;
  return deriveImmediatePythonRuntimeProjection({
    pythonPublishClosure: state?.publishClosure ?? null,
    pythonSkillRuntimeGraph: state?.skillRuntimeGraph ?? null,
  });
}

/**
 * SlideRuleUnified — 唯一产品界面（studio 骨架，无模式切换）。
 *
 * - 顶部单行 header：Cursor 式布局图标簇 + 交付物/重置会话。
 * - 左栏：对话流；输入条贴在会话下面（不是整页底部浮层）。
 * - 右栏：ArchitectureStage（沙盘/架构图）+ 抽屉 inspector / Checks。
 *
 * 旧的 pan/zoom 推理画布（v4 面）已从本页移除；工程画布仍可经 ?im=dev 进入
 * SlideRuleSplitEngineering 查看。
 */
function SlideRuleUnified({
  goal,
  uiTurns,
  input,
  setInput,
  isRunning,
  liveAction,
  sessionState,
  sendMessage,
  pendingPlanApproval = null,
  submitPlanApproval,
  pendingAsk = null,
  onSubmitQuestionnaire,
  queuedTurns = [],
  removeQueuedTurn,
  dismissAsk,
  challengeTurn: _challengeTurn,
  restoreModelVersion,
  forkVariant,
  isRestoringVersion,
  resetSession,
  retryCapability,
  toggleRouteExpanded,
  onEvidenceRefClick,
  latestTurn,
  executorMode,
  driveMode,
  setDriveMode,
  pendingClarifications,
  answerClarifications,
  generateDeliverables,
  onExportDeliverables,
  stop,
  deliverablesOpen,
  setDeliverablesOpen,
  openDeliverables,
  embedded = false,
  pythonApiError,
  pythonStatusMsg,
  retryPythonBackend,
  crossRuntimeGraph,
  publishClosure,
  driveFullStatus,
  projectCapabilities = null,
  onCreateProject,
  canCreateProject = false,
  projectCreateBlockedReason: _projectCreateBlockedReason,
  projectCreateState,
  activeSkillId = null,
  skillContents = {},
  latestMermaid = null,
  specPages = [],
  llmDraft = "",
  llmDraftLabel = null,
  llmStreams = [],
  rehearsalCursor,
}: {
  goal: string;
  uiTurns: UiTurn[];
  input: string;
  setInput: (v: string) => void;
  isRunning: boolean;
  liveAction: LiveAction | null;
  sessionState: ReturnType<typeof useSlideRuleSession>["sessionState"];
  sendMessage: (textOverride?: string) => void;
  pendingPlanApproval?:
    import("@/lib/sliderule-marathon-driver").ControlPlanApprovalWire | null;
  submitPlanApproval?: (
    result: import("./sliderule/PlanApprovalPanel").PlanApprovalOutcome
  ) => void;
  pendingAsk?: {
    question: string;
    options?: string[];
    /** 抄 grok `AskUserQuestion`：一发几道题，每项带解释。 */
    questions?: import("@/lib/sliderule-marathon-driver").ControlQuestionWire[];
  } | null;
  /** 问答卡提交：四条路径（选完 / 你自己定 / 别再问了）。 */
  onSubmitQuestionnaire?: (
    result: import("./sliderule/QuestionnaireCard").QuestionnaireOutcome
  ) => void;
  dismissAsk?: () => void;
  challengeTurn: (id: string) => void;
  restoreModelVersion: (versionId: string) => void;
  forkVariant?: () => void;
  isRestoringVersion: boolean;
  resetSession: () => void;
  retryCapability: ReturnType<typeof useSlideRuleSession>["retryCapability"];
  toggleRouteExpanded: (turnId: string) => void;
  onEvidenceRefClick: (artifactId: string) => void;
  latestTurn: UiTurn | null;
  executorMode: ReturnType<typeof useSlideRuleSession>["executorMode"];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  /** 推演中补的话（排队到下一轮）。看得见、撤得掉——见 midrun-queue 头注。 */
  /** 队列条目带 synthetic 标记（grok is_synthetic：合成品永不参与合并）。 */
  queuedTurns?: { text: string; synthetic?: boolean }[];
  removeQueuedTurn?: (index: number) => void;
  pendingClarifications?: ClarificationItem[];
  answerClarifications?: (
    answers: Array<{ gapId: string; answer: string }>
  ) => void;
  generateDeliverables: () => void;
  onExportDeliverables: () => void;
  stop?: () => void;
  deliverablesOpen: boolean;
  setDeliverablesOpen: (open: boolean) => void;
  openDeliverables: () => void;
  embedded?: boolean;
  pythonApiError?: any;
  pythonStatusMsg?: string;
  retryPythonBackend?: () => void;
  crossRuntimeGraph?: CrossRuntimeGraphSummary | null;
  publishClosure?: PublishClosureSummary | null;
  driveFullStatus?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "control_failed"
    | "fallback";
  projectCapabilities?: {
    mode?: string;
    blockers?: string[];
    configured?: boolean;
    canExecute?: boolean;
  } | null;
  onCreateProject?: () => void;
  canCreateProject?: boolean;
  projectCreateBlockedReason?: string | null;
  projectCreateState?: {
    status: "idle" | "creating" | "error";
    error: string | null;
  };
  /** SSE-driven active skill highlighting for the right rail */
  activeSkillId?: import("@/lib/sliderule-marathon-driver").SkillId | null;
  skillContents?: Partial<
    Record<import("@/lib/sliderule-marathon-driver").SkillId, string>
  >;
  latestMermaid?: string | null;
  /** spec-first 第 3 步逐页产出的 HTML（推演中右侧实时渲染）。 */
  specPages?: import("./sliderule/live-runtime/SpecPageLiveStage").SpecPageLive[];
  /** LLM 实时草稿（llm_delta 累积）+ 当前来源标签。 */
  llmDraft?: string;
  llmDraftLabel?: string | null;
  llmStreams?: Array<{ label: string; text: string }>;
  rehearsalCursor?: RehearsalClockCursor;
}) {
  const sessionId = sessionState.sessionId || DEFAULT_SESSION_ID;

  // Clarification cards can be hidden; they reappear when pending questions change.
  const clarifications = pendingClarifications ?? [];
  const clarifyKey = clarifications.map(c => c.id).join("|");
  const [clarifyHidden, setClarifyHidden] = useState(false);

  useEffect(() => {
    setClarifyHidden(false);
  }, [clarifyKey]);

  // ⚠ 2026-09-15：2026-09-14 卸掉「进入工程工作台」之后，批准计划
  //   的会话再也没人调用 onCreateProject。真机 TicketStream 待办 8 条、
  //   计划已批准，右侧却是接线沙盘。钮可以不挂，创建必须自己走。
  const createStatus = projectCreateState?.status ?? "idle";
  const projectSurface = shouldShowProjectComputer({
    runtimeKind: sessionState.runtimeKind,
    projectId: sessionState.projectId,
    canCreateProject,
    creating: createStatus === "creating",
  });
  const deliverableKind = latestPlanDeliverableKind(
    sessionState.controlTranscript as Array<Record<string, unknown>> | undefined
  );
  useEffect(() => {
    rememberActiveProjectId(sessionState.projectId);
  }, [sessionState.projectId]);
  const createProjectRef = useRef(onCreateProject);
  createProjectRef.current = onCreateProject;
  useEffect(() => {
    if (
      !shouldAutoCreateProject({
        canCreateProject,
        isRunning,
        createStatus,
        planHasDeliverableKind: planWrittenHasDeliverableKind(
          sessionState.controlTranscript as Array<Record<string, unknown>> | undefined
        ),
      })
    ) {
      return;
    }
    createProjectRef.current?.();
  }, [canCreateProject, isRunning, createStatus, sessionState.controlTranscript]);
  // KD19：作曲家只留**一张**「要不要烧」的决策面。范围卡 / ask 停泊时
  // 澄清卡让位——2026-08-27 真机截图里两张卡叠在一起，背后那张问的还是
  // 上一轮的 goal（服务端那半在 rehearsal_control._retire_stale_control_questions）。
  // 只是让位不是关掉：没有停泊时它照旧出现（见同名测试的反向判据）。
  const parkedDecisionSurface =
    Boolean(pendingPlanApproval) || Boolean(pendingAsk);
  const showClarify =
    clarifications.length > 0 &&
    !clarifyHidden &&
    !parkedDecisionSurface &&
    !!answerClarifications;

  // Conversation column: live turns during/after a run. After reload uiTurns is
  // empty — rebuild the **whole** thread from persisted versions/narrations.
  // ⚠ 2026-08-18 真机：只灌 latestTurn 一轮，后面迭代发出的话刷新后全没了。
  const restoredTurns = useMemo(
    () => (uiTurns.length === 0 ? deriveTurnsFromState(sessionState) : []),
    [uiTurns.length, sessionState]
  );
  const conversationTurns = uiTurns.length > 0 ? uiTurns : restoredTurns;

  const rehearsalFacts = useMemo(
    () =>
      deriveStatusBarFacts(sessionState, {
        turnCount: conversationTurns.length,
        isRunning,
        publishClosure,
        rehearsalCursor: rehearsalCursor ?? idleRehearsalCursor(),
        executorMode,
      }),
    [
      sessionState,
      conversationTurns.length,
      isRunning,
      publishClosure,
      rehearsalCursor,
      executorMode,
    ]
  );

  // 空态（无轮次且未在跑）时 ComposerDock 渲染在首页
  // hero 里；否则贴在左栏会话流底部。二选一，永远只有一个输入条实例。
  const isHomeEmpty =
    conversationTurns.length === 0 &&
    !isRunning &&
    sessionState.runtimeKind !== "project";

  // 入站判定的语境：「这个会话里到底有没有一个成形的应用」。
  //
  // 判据是解析得到的五系统模型（跟右侧舞台能否跑起应用同一个判据），不是
  // Boolean(goal)——用户敲完目标、推演还没出模型时 goal 已经有值，但应用并
  // 不存在；那会儿把语境报成"已有应用"，后端就会拿 iteration 那套规则域去判
  // 一句其实是首轮真需求的话。
  const settledModel = useMemo(
    () =>
      deriveSettledFiveSystemModel(
        skillContents,
        publishClosure?.perSkillEvidence,
        {
          versions: (
            sessionState as {
              modelVersions?: Array<{ id?: string; model?: unknown }>;
            }
          ).modelVersions,
          currentId: (sessionState as { currentModelVersionId?: string | null })
            .currentModelVersionId,
        }
      ),
    [skillContents, publishClosure?.perSkillEvidence, sessionState]
  );
  const showStudioChrome = isStudioChromeShown(isHomeEmpty);

  return (
    <StudioLayoutProvider available={showStudioChrome} layoutLocked={isRunning}>
      <div className={`${autopilotTheme.immersionPage} flex flex-col`}>
        {/* 还没推演：顶栏整条不挂（交付物/重置也占一条底边，空态看着像少了一截）。 */}
        {showStudioChrome &&
        !IS_GITHUB_PAGES &&
        (pythonApiError || pythonStatusMsg) ? (
          <div
            className="mb-2 inline-flex rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 shadow-sm"
            title={pythonStatusMsg}
          >
            Python backend: {pythonStatusMsg || "degraded/timeout"} ·
            <button
              type="button"
              onClick={retryPythonBackend}
              className="ml-2 underline"
            >
              Retry
            </button>
            {getLegacyFallbackReason(pythonApiError) && (
              <span className="ml-2 text-amber-600">fallback active</span>
            )}
            {isDegradedApiError(pythonApiError) && (
              <span className="ml-1">(degraded envelope)</span>
            )}
          </div>
        ) : null}
        {showStudioChrome ? (
          <DriveFullStatusBanner
            status={driveFullStatus}
            className="mb-2 inline-flex"
          />
        ) : null}
        {/* ⚠ 2026-09-14：开聊后也不挂「当前：HTML 推演兼容模式」。
            真机圈了三处壳——左上这颗、右上分栏/全屏/交付物、输入框上
            已收口/再核对。人在看推演，不是来读运行时徽章。
            进入工程工作台 / 未启用告警跟着这条一起卸，不再占顶。 */}

        {/* Studio body — 图标簇在舞台头条右侧，不再独占整页顶栏。 */}
        {
          <div className="relative z-0 min-h-0 flex-1">
            <SlideRuleStudio
              runtimeKind={projectSurface ? "project" : sessionState.runtimeKind}
              projectId={sessionState.projectId}
              projectRevision={sessionState.projectRevision}
              projectCreateError={projectCreateState?.error ?? null}
              deliverableKind={deliverableKind}
              sessionEmpty={isHomeEmpty}
              turns={conversationTurns}
              chatSlot={
                <ClaudeChatSurface
                  uiTurns={conversationTurns}
                  isRunning={isRunning}
                  goalText={goal}
                  liveAction={liveAction}
                  latestTurn={latestTurn}
                  publishClosure={publishClosure}
                  llmDraft={isRunning ? llmDraft : ""}
                  llmStreams={isRunning ? llmStreams : []}
                  llmDraftLabel={llmDraftLabel}
                  rehearsalClock={rehearsalFacts.rehearsalClock}
                  hud={rehearsalFacts.hud}
                  factoryDecision={rehearsalFacts.factoryDecision}
                  projectCapabilities={projectCapabilities}
                  runtimeKind={
                    projectSurface ? "project" : sessionState.runtimeKind
                  }
                  projectRevision={sessionState.projectRevision}
                  controlTodo={sessionState.controlTodo}
                  projectId={sessionState.projectId}
                  deliverableKind={deliverableKind}
                  onChallenge={id =>
                    dispatchChallengePrefill({ artifactId: id })
                  }
                  composerSlot={
                    <ComposerDock
                      input={input}
                      setInput={setInput}
                      sendMessage={sendMessage}
                      isRunning={isRunning}
                      sessionId={sessionId}
                      goal={goal}
                      hintChips={[]}
                      statusPill={null}
                      stop={stop}
                      hero={isHomeEmpty}
                      pendingPlanApproval={pendingPlanApproval}
                      onSubmitPlanApproval={submitPlanApproval}
                      pendingAsk={pendingAsk}
                      onSubmitQuestionnaire={onSubmitQuestionnaire}
                      onDismissAsk={dismissAsk}
                      onAnswerAsk={text => sendMessage(text)}
                      queuedTurns={queuedTurns}
                      onRemoveQueued={removeQueuedTurn}
                    />
                  }
                  clarifySlot={
                    showClarify ? (
                      <ClarificationCard
                        questions={clarifications}
                        onSubmit={answers => answerClarifications?.(answers)}
                        onClose={() => setClarifyHidden(true)}
                      />
                    ) : null
                  }
                />
              }
              activeSkillId={activeSkillId}
              publishClosure={publishClosure}
              latestMermaid={latestMermaid}
              skillContents={skillContents}
              skillRuntimeGraph={
                (
                  sessionState as {
                    skillRuntimeGraph?:
                      | import("./sliderule/system-screens/five-system-model").SkillRuntimeGraphLike
                      | null;
                  }
                ).skillRuntimeGraph ?? null
              }
              sessionId={sessionId}
              appTitle={goal ? goal.slice(0, 24) : undefined}
              // 用户还没输入时不显示右侧舞台：欢迎页独占全宽，首条消息后舞台登场
              stageVisible={
                projectSurface ||
                conversationTurns.length > 0 ||
                isRunning
              }
              // 推演中右侧实时渲染：部分五系统模型 → 应用实时长出来；没成形前只报"推演中"
              isRunning={isRunning}
              llmDraft={isRunning ? llmDraft : ""}
              llmDraftLabel={llmDraftLabel}
              liveActionLabel={isRunning ? (liveAction?.label ?? null) : null}
              // spec-first 第 3 步的页面：一页好了就上屏。恒传（不按 isRunning
              // 掐）——掐掉的话闭环那一瞬间页面会先消失、再由应用舞台接管，
              // 中间闪一下空白。舞台判定在 Studio 里一处做完。
              specPages={specPages}
              // 落库的那份：刷新之后右侧还能是新链路的页面，而不是掉回区块页
              specFirstPages={
                (
                  sessionState as {
                    specFirstPages?: {
                      pages?: Record<string, string>;
                    } | null;
                  }
                ).specFirstPages ?? null
              }
              modelVersions={
                (
                  sessionState as {
                    modelVersions?: Array<{
                      id: string;
                      instruction?: string;
                      model?: unknown;
                    }>;
                  }
                ).modelVersions ?? []
              }
              currentModelVersionId={
                (sessionState as { currentModelVersionId?: string | null })
                  .currentModelVersionId ?? null
              }
              onRestoreVersion={restoreModelVersion}
              onForkVariant={forkVariant}
              isRestoringVersion={isRestoringVersion}
              /* ⚠ 2026-09-20 Trae 右上两颗：全屏 + 隐藏右栏。只挂这两颗，
                 不把 SlideRuleTopHud 分段 / 交付物加回去。推演中 layoutLocked
                 仍置灰。Xray / HUD 单测仍直接渲染 TopHud。 */
              chromeSlot={
                showStudioChrome ? <PreviewChromeLayoutButtons /> : null
              }
              /* 重置会话不再走 chromeSlot：那条槽落在舞台头条**右侧**图标簇里。
               2026-08-24 用户反馈要它在标题左边、更大、更蓝，所以单独一条槽。 */
              resetSlot={
                showStudioChrome ? (
                  <SlideRuleResetSessionButton
                    isRunning={isRunning}
                    onResetSession={resetSession}
                  />
                ) : null
              }
              className="h-full"
            />
            {/* 右栏「推演过程」标签页已移除：左栏对话流本身就是实时推演过程
            （步骤流 + LLM 实时草稿），右栏只保留系统画面（用户反馈去重）。 */}
          </div>
        }

        {/* 设置弹窗已收敛到侧栏「设置」整页（SettingsPage），HUD 不再挂设置入口 */}
        <DeliverablesPanel
          open={deliverablesOpen}
          onClose={() => setDeliverablesOpen(false)}
          sessionState={sessionState}
          isRunning={isRunning}
          onGenerate={() => generateDeliverables()}
          onExportMd={() => onExportDeliverables()}
          onEvidenceRefClick={onEvidenceRefClick}
          publishClosure={publishClosure}
        />
      </div>
    </StudioLayoutProvider>
  );
}

function SlideRuleSplitEngineering({
  goal,
  uiTurns,
  input,
  setInput,
  isRunning,
  liveAction,
  sessionState,
  sendMessage,
  challengeTurn: _challengeTurn,
  resetSession,
  toggleRouteExpanded,
  retryCapability,
  reasoningViewModel,
  graphNodeCount,
  graphRevision,
  handleGraphNodeClick,
  handleNodeEditSubmit,
  handleResolveInteractiveGate,
  handleTerminalAction,
  focusNodeId,
  lineageHighlightIds,
  onEvidenceRefClick,
  projectionDensity,
  onProjectionDensityChange,
  imSurfaceMode,
  latestTurn,
  latestTurnId,
  executorMode,
  driveMode,
  setDriveMode,
  generateDeliverables,
  onExportDeliverables,
  stop,
  deliverablesOpen,
  setDeliverablesOpen,
  openDeliverables,
  publishClosure,
  driveFullStatus,
  rehearsalCursor,
}: {
  goal: string;
  uiTurns: UiTurn[];
  input: string;
  setInput: (v: string) => void;
  isRunning: boolean;
  liveAction: LiveAction | null;
  sessionState: ReturnType<typeof useSlideRuleSession>["sessionState"];
  sendMessage: () => void;
  challengeTurn: (id: string) => void;
  resetSession: () => void;
  toggleRouteExpanded: (id: string) => void;
  retryCapability: ReturnType<typeof useSlideRuleSession>["retryCapability"];
  reasoningViewModel: ReturnType<typeof deriveSlideRuleReasoningViewModel>;
  graphNodeCount: number;
  graphRevision: string;
  handleGraphNodeClick: (node: BrainstormReasoningNode) => void;
  handleNodeEditSubmit: (node: BrainstormReasoningNode, text: string) => void;
  handleResolveInteractiveGate?: (
    gateNodeId: string,
    choice: string | null
  ) => void;
  handleTerminalAction: (action: "report" | "lineage" | "export") => void;
  focusNodeId: string | null;
  lineageHighlightIds: string[];
  onEvidenceRefClick: (artifactId: string) => void;
  projectionDensity: ProjectionDensity;
  onProjectionDensityChange: (density: ProjectionDensity) => void;
  imSurfaceMode: ReturnType<typeof resolveImSurfaceMode>;
  latestTurn: UiTurn | null;
  latestTurnId: string | null;
  executorMode: ReturnType<typeof useSlideRuleSession>["executorMode"];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  generateDeliverables: () => void;
  onExportDeliverables: () => void;
  stop?: () => void;
  deliverablesOpen: boolean;
  setDeliverablesOpen: (open: boolean) => void;
  openDeliverables: () => void;
  publishClosure?: PublishClosureSummary | null;
  driveFullStatus?:
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "control_failed"
    | "fallback";
  rehearsalCursor?: RehearsalClockCursor;
}) {
  const imScrollRef = useRef<HTMLElement>(null);
  const imBottomRef = useRef<HTMLDivElement>(null);
  const imAtBottomRef = useRef(true);

  const imScrollSignature = useMemo(
    () =>
      uiTurns
        .map(t => {
          const last = t.steps[t.steps.length - 1];
          const lastBody =
            last && "text" in last
              ? last.text.length
              : last && "label" in last
                ? last.label.length
                : 0;
          return `${t.id}:${t.status}:${t.routeLitCount}:${t.steps.length}:${t.actions.length}:${last?.id ?? ""}:${lastBody}`;
        })
        .join("|"),
    [uiTurns]
  );

  useEffect(() => {
    const el = imScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      imAtBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isRunning && !imAtBottomRef.current) return;
    requestAnimationFrame(() => {
      imBottomRef.current?.scrollIntoView({ block: "end" });
      if (imScrollRef.current) {
        imScrollRef.current.scrollTop = imScrollRef.current.scrollHeight;
      }
      imAtBottomRef.current = true;
    });
  }, [imScrollSignature, isRunning, uiTurns.length]);

  return (
    <div className={autopilotTheme.page}>
      <header className={autopilotTheme.header}>
        <img
          src={`${import.meta.env.BASE_URL}assets/sliderule_icon_flat_transparent.png`}
          alt="SlideRule"
          className="mr-2 h-5 w-5 shrink-0 self-center opacity-70"
          title="SlideRule"
        />
        <div className="min-w-0 flex-1">
          <div className={autopilotTheme.label}>我的想法</div>
          <div
            className={`${autopilotTheme.goal} ${!goal ? "text-stone-400" : ""}`}
            data-testid="sliderule-goal-display"
          >
            {goal || "Enter an idea to start SlideRule."}
          </div>
        </div>
        <div className="flex items-center gap-3 pl-4">
          <button
            type="button"
            onClick={openDeliverables}
            data-testid="sliderule-deliverables-open"
            className={autopilotTheme.auditBtn}
            title="Deliverables (report / spec tree / docs / prompt pack / architecture / handoff)"
          >
            Deliverables
          </button>
          <button
            type="button"
            onClick={resetSession}
            disabled={isRunning}
            data-testid="sliderule-reset-session"
            className={autopilotTheme.auditBtn}
            title={
              isRunning
                ? "SlideRule is running; reset later."
                : "Clear this conversation and restart."
            }
          >
            重置会话
          </button>
          {/* E28：Dev 入口移除（用户裁决），/sliderule/dev 仍可直接访问 */}
        </div>
      </header>

      <DriveFullStatusBanner
        status={driveFullStatus}
        className="mx-6 mt-2 inline-flex"
      />

      <SlideRuleStatusBar
        state={sessionState}
        turnCount={uiTurns.length}
        isRunning={isRunning}
        driveLoopCount={
          latestTurn?.routeFacts.rounds?.length ??
          (latestTurn && latestTurn.routeFacts.planSelectedCount ? 1 : 0)
        }
        closureReason={latestTurn?.routeFacts.closureReason ?? null}
        executorMode={executorMode}
        publishClosure={publishClosure}
        rehearsalCursor={rehearsalCursor}
      />

      <div className={autopilotTheme.split}>
        <section className={autopilotTheme.flowPanelWide} aria-label="推演路径">
          <div className={autopilotTheme.flowPanelHeader}>
            <span className={autopilotTheme.label}>推演路径</span>
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              {isRunning && liveAction ? (
                <LiveActionIndicator liveAction={liveAction} />
              ) : (
                <span className="text-[10px] text-stone-400">
                  {graphNodeCount > 0
                    ? `${graphNodeCount} nodes - click to inspect`
                    : "发送消息后展开推理地图"}
                </span>
              )}
            </div>
          </div>
          <div className={`${autopilotTheme.flowPanelBody} relative`}>
            {graphNodeCount > 0 ? (
              <ReasoningFlowSurface
                viewModel={reasoningViewModel}
                initialScale={0.82}
                graphRevision={graphRevision}
                className="absolute inset-0"
                showChrome
                onNodeClick={handleGraphNodeClick}
                onNodeEditSubmit={handleNodeEditSubmit}
                onResolveInteractiveGate={handleResolveInteractiveGate}
                externalHighlightedIds={lineageHighlightIds}
                focusNodeId={focusNodeId}
                onTerminalAction={handleTerminalAction}
                terminalCanExport={reasoningViewModel.terminalMeta?.canExport}
              />
            ) : (
              <div className={autopilotTheme.flowEmpty}>
                Send the first message to unfold the reasoning path here.
              </div>
            )}
          </div>
        </section>

        <section className={autopilotTheme.imPanel} aria-label="对话">
          <main ref={imScrollRef} className={autopilotTheme.main}>
            <div className="space-y-6">
              {uiTurns.length === 0 && (
                <div className={autopilotTheme.emptyState}>
                  Welcome to SlideRule V5.
                  <p className={autopilotTheme.emptyHint}>
                    Enter a goal or challenge below; the system dynamically
                    selects capability x role steps. There are no fixed stages;
                    current state and your input drive the route.
                  </p>
                </div>
              )}
              {uiTurns.map(turn => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className={autopilotTheme.userBubble}>{turn.user}</div>
                  </div>
                  <div className="rounded border border-[#e5e7eb]/80 bg-white px-4 py-4 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                    {/* M7 close-out: turn-route is hidden by default in marathon mode; single mode remains visible and toggle can expand it. */}
                    {(driveMode !== "marathon" || turn.routeExpanded) && (
                      <TurnRouteTimeline
                        facts={turn.routeFacts}
                        steps={turn.steps}
                        actions={turn.actions}
                        sessionId={sessionState.sessionId || DEFAULT_SESSION_ID}
                        expanded={
                          turn.routeExpanded || turn.status === "streaming"
                        }
                        onToggle={() => toggleRouteExpanded(turn.id)}
                        litCount={turn.routeLitCount}
                        streaming={turn.status === "streaming"}
                        liveAction={
                          turn.id === latestTurnId &&
                          turn.status === "streaming"
                            ? liveAction
                            : null
                        }
                        surfaceMode={imSurfaceMode}
                        retrying={isRunning}
                        onRetryCapability={params =>
                          retryCapability(turn.id, params)
                        }
                        reasoningEvents={sessionState.reasoningEvents}
                      />
                    )}
                    {driveMode === "marathon" && !turn.routeExpanded && (
                      <div
                        className="cursor-pointer text-[10px] text-stone-400"
                        onClick={() => toggleRouteExpanded(turn.id)}
                        title="Marathon route details are hidden; click to expand."
                      >
                        Continuing SlideRule. Click to expand route.
                      </div>
                    )}
                    {turn.status === "complete" && (
                      <TurnFootnote
                        turn={turn}
                        sessionId={sessionState.sessionId || DEFAULT_SESSION_ID}
                        onChallenge={id =>
                          dispatchChallengePrefill({ artifactId: id })
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
              <div ref={imBottomRef} className="h-px shrink-0" aria-hidden />
            </div>
          </main>

          <footer className={autopilotTheme.footer}>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e =>
                  e.key === "Enter" && !e.shiftKey && sendMessage()
                }
                placeholder="Engineering path IM..."
                disabled={isRunning}
                className={autopilotTheme.input}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className={autopilotTheme.sendBtn}
              >
                {isRunning ? "Stop" : "Send"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HINT_CHIPS_SPLIT.map(hint => (
                <button
                  key={hint}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setInput(hint)}
                  className={autopilotTheme.hintChip}
                >
                  {hint}
                </button>
              ))}
            </div>
          </footer>
        </section>
      </div>

      <DeliverablesPanel
        open={deliverablesOpen}
        onClose={() => setDeliverablesOpen(false)}
        sessionState={sessionState}
        isRunning={isRunning}
        onGenerate={() => generateDeliverables()}
        onExportMd={() => onExportDeliverables()}
        onEvidenceRefClick={onEvidenceRefClick}
        publishClosure={publishClosure}
      />
    </div>
  );
}

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * 会话壳（Claude 式）：管理"当前会话 id"，切换/新建时以 key=sessionId
 * 整树重挂——hook 对新 id 走 loadOrCreateSessionState 完整水合，
 * 运行时排练数据（localStorage 按 id 分键）自动隔离，零状态串味。
 * 会话选择入口在侧栏（SidebarSessions），通过 window 事件通知这里。
 *
 * ⚠ 2026-09-15：地址栏 `?session=` 是权威。只听 localStorage 时，刷新 /
 *   应用中心整页跳会掉进兜底桶，用户说「丢会话」。
 */
export default function SlideRule({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const stored = readStoredSessionId();
    if (IS_GITHUB_PAGES) {
      // 静态演示只认画廊示例种子（E18，pages-demo-*）；其余残留 id
      // 一律回落主演示，防止演示被指到不存在的空会话上
      return stored?.startsWith("pages-demo-")
        ? stored
        : GITHUB_PAGES_DEMO_SESSION_ID;
    }
    return resolveActiveSessionId({
      urlSession:
        typeof window !== "undefined"
          ? sessionIdFromHref(hrefFromWindow(window))
          : null,
      stored,
    });
  });

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    } catch {
      /* 隐私模式：地址栏仍是权威 */
    }
    applySessionToHistory(
      window.history,
      hrefFromWindow(window),
      activeSessionId,
      "replace"
    );
  }, [activeSessionId]);

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    const onChanged = (ev: Event) => {
      const id = (ev as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (id) setActiveSessionId(id);
    };
    const onPop = () => {
      setActiveSessionId(
        resolveActiveSessionId({
          urlSession: sessionIdFromHref(hrefFromWindow(window)),
          stored: readStoredSessionId(),
        })
      );
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return (
    <SlideRuleSessionBody
      key={activeSessionId}
      embedded={embedded}
      activeSessionId={activeSessionId}
    />
  );
}

function SlideRuleSessionBody({
  embedded,
  activeSessionId,
}: {
  embedded: boolean;
  activeSessionId: string;
}) {
  const { user: authUser, ready: authReady } = useAuth();
  const {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    executorMode,
    sendMessage,
    pendingPlanApproval,
    submitPlanApproval,
    createProjectFromApprovedPlan,
    canCreateProject,
    projectCreateBlockedReason,
    projectCreateState,
    pendingAsk,
    submitQuestionnaire,
    queuedTurns,
    removeQueuedTurn,
    dismissAsk,
    repairGaps,
    restoreModelVersion,
    forkVariant,
    isRestoringVersion,
    challengeTurn,
    resetSession,
    toggleRouteExpanded,
    retryCapability,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
    resolveInteractiveGate,
    pendingClarifications,
    answerClarifications,
    generateDeliverables,
    stop,
    driveFullStatus,
    activeSkillId,
    skillContents,
    latestMermaid,
    specPages,
    llmDraft,
    llmDraftLabel,
    llmStreams,
    rehearsalCursor,
    sessionHydrated,
  } = useSlideRuleSession({
    // E18：Pages 下 activeSessionId 也可能是画廊示例（pages-demo-*，
    // 会话壳已做过准入回落），不再钉死主演示
    sessionId: activeSessionId,
    documentTitle: IS_GITHUB_PAGES ? `${BRAND_NAME_FULL} · 演示` : undefined,
    // 「点发送看回放」的预填只属于主演示空会话；画廊示例自带完整终态
    initialGoal:
      IS_GITHUB_PAGES && activeSessionId === GITHUB_PAGES_DEMO_SESSION_ID
        ? GITHUB_PAGES_DEMO_GOAL
        : undefined,
  });

  // 浏览器标签标题跟随当前会话话题（像 Claude 的标签页那样一眼识别会话）
  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    document.title = goal
      ? `${goal.slice(0, 24)} · ${BRAND_NAME_FULL}`
      : `新会话 · ${BRAND_NAME_FULL}`;
  }, [goal]);

  // E33.5 加载官方组件化（用户裁决：弃自定义骨架屏，用 antd 官方 Spin）：
  // index.html 纯 CSS 转圈只盖 React 挂载前的空窗（main.tsx 挂载即摘），
  // 会话水合期由下方 Spin fullscreen 接管——两段都是圆环转圈，视觉连续。

  // 迭代环：消息上的「重新推演」经事件总线把该轮意图原文程序化重发
  // （与空态示例卡的 fill-prompt 同一套事件模式，免去跨层 prop 钻孔）。
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) void sendMessageRef.current(text);
    };
    window.addEventListener("sliderule:resend-prompt", handler);
    return () => window.removeEventListener("sliderule:resend-prompt", handler);
  }, []);

  // E26：闭环被闸拦截后的「补齐缺口」——修复轮只重跑覆盖门标红的能力
  const repairGapsRef = useRef(repairGaps);
  repairGapsRef.current = repairGaps;
  useEffect(() => {
    const handler = () => void repairGapsRef.current();
    window.addEventListener("sliderule:repair-gaps", handler);
    return () => window.removeEventListener("sliderule:repair-gaps", handler);
  }, []);

  // Python backend error/timeout/degraded/legacy status + retry for core SlideRule workflow (105)
  const [pythonApiError, setPythonApiError] = useState<any>(null);
  const [pythonStatusMsg, setPythonStatusMsg] = useState<string>("");
  const [projectCapabilities, setProjectCapabilities] = useState<{
    mode?: string;
    blockers?: string[];
    configured?: boolean;
    canExecute?: boolean;
  } | null>(null);
  useEffect(() => {
    // 工程能力属于登录后资源状态；匿名空态不发受保护请求，避免预期 401
    // 污染浏览器日志。失败时保持 fail-closed，不显示可启动按钮。
    setProjectCapabilities(null);
    if (!authReady || !authUser) return;
    let cancelled = false;
    void fetchJsonSafe<{
      mode?: string;
      blockers?: string[];
      configured?: boolean;
      canExecute?: boolean;
    }>("/api/sliderule/project-capabilities").then(result => {
      if (!cancelled && result.ok) setProjectCapabilities(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);
  const probePythonBackend = useCallback(async () => {
    // GitHub Pages 静态演示无后端：探测必 404（控制台噪音 + 无意义请求），
    // 且状态条本就在 Pages 下不渲染（见 !IS_GITHUB_PAGES 分支），直接跳过。
    if (IS_GITHUB_PAGES) return;
    try {
      const res = await fetchJsonSafe<{ status?: string }>(
        "/api/sliderule/health"
      );
      if (!res.ok) {
        setPythonApiError(res.error);
        setPythonStatusMsg(
          `Python backend ${res.error.kind}${res.error.status ? " " + res.error.status : ""}: ${res.error.message} ${getLegacyFallbackReason(res.error) || ""}`
        );
      } else {
        setPythonApiError(null);
        setPythonStatusMsg("");
      }
    } catch {
      setPythonApiError({
        kind: "degraded",
        message: "probe failed",
        source: "network",
        retryable: true,
      } as any);
      setPythonStatusMsg("Python backend probe unreachable; retry available");
    }
  }, []);
  useEffect(() => {
    // probe once on mount for visibility of python failure states in main workflow
    probePythonBackend();
  }, [probePythonBackend]);

  const retryPythonBackend = useCallback(() => {
    setPythonStatusMsg("retrying Python backend...");
    probePythonBackend();
  }, [probePythonBackend]);

  const imSurfaceMode = useMemo(() => resolveImSurfaceMode(), []);
  const isImmersion = imSurfaceMode !== "engineering";
  // Rebuild the thread from persisted session state after refresh when uiTurns is empty.
  const restoredTurns = useMemo(
    () => (uiTurns.length === 0 ? deriveTurnsFromState(sessionState) : []),
    [uiTurns.length, sessionState]
  );
  const latestTurn =
    uiTurns.length > 0
      ? uiTurns[uiTurns.length - 1]
      : (restoredTurns[restoredTurns.length - 1] ??
        deriveLatestTurnFromState(sessionState));
  const latestTurnId = latestTurn?.id ?? null;

  const [projectionDensity, setProjectionDensity] = useState<ProjectionDensity>(
    () => {
      try {
        const stored = localStorage.getItem(PROJECTION_DENSITY_STORAGE_KEY);
        return stored === "detailed" ? "detailed" : "compact";
      } catch {
        return "compact";
      }
    }
  );
  // 三态视图切换的唯一入口（HUD 按钮）已随统一 Studio 界面下线（无消费方，见
  // SlideRuleUnified 注释）；reasoningViewModel 仍按 viewMode 分支，engineering
  // 画布（?im=dev）里固定按 overview 粒度渲染。
  const viewMode = "overview" as const;

  const [lineageHighlightIds, setLineageHighlightIds] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [deliverablesOpen, setDeliverablesOpen] = useState(false);
  const openDeliverables = useCallback(() => setDeliverablesOpen(true), []);
  // pythonPublishClosure: authoritative Python-produced evidence from /drive-full (persisted in sessionState);
  // used by select to prefer over TS preview. See useEffect below for the prefer/fallback decision.
  const sessionEvidence = sessionState as {
    publishClosure?: PublishClosureSummary | null;
    skillRuntimeGraph?: unknown;
  };
  const pythonPublishClosure = sessionEvidence.publishClosure ?? null;
  const pythonSkillRuntimeGraph = sessionEvidence.skillRuntimeGraph ?? null;
  // Seed initial from python /drive-full for immediate visibility of pass-through at root render
  // (useEffect will refine with derive result; static smoke renders use the initial).
  const initialProjection = deriveNoIntentRuntimeProjection({
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
  });
  const [crossRuntimeGraph, setCrossRuntimeGraph] =
    useState<CrossRuntimeGraphSummary | null>(
      initialProjection.crossRuntimeGraph
    );
  const [publishClosure, setPublishClosure] =
    useState<PublishClosureSummary | null>(pythonPublishClosure ?? null);
  const visiblePythonRuntimeProjection = deriveImmediatePythonRuntimeProjection(
    {
      pythonPublishClosure,
      pythonSkillRuntimeGraph,
    }
  );
  const visibleCrossRuntimeGraph =
    visiblePythonRuntimeProjection?.crossRuntimeGraph ?? crossRuntimeGraph;
  const visiblePublishClosure =
    visiblePythonRuntimeProjection?.publishClosure ?? publishClosure;

  useEffect(() => {
    if (
      visiblePythonRuntimeProjection ||
      pythonPublishClosure ||
      pythonSkillRuntimeGraph
    )
      return;
    // Anonymous visitors do not own a durable session. Avoid probing the
    // login-gated session endpoint merely to discover that the empty shell has
    // no persisted projection; this used to produce a visible 404 in the
    // browser console on every fresh visit.
    if (!authReady || !authUser) return;
    // Pages 演示的会话全部在 localStorage，后端 sessions API 不存在，跳过投影回捞。
    if (IS_GITHUB_PAGES) return;
    let cancelled = false;
    loadPythonRuntimeProjectionFromSession(
      sessionState.sessionId || DEFAULT_SESSION_ID
    )
      .then(projection => {
        if (cancelled || !projection) return;
        setCrossRuntimeGraph(projection.crossRuntimeGraph);
        setPublishClosure(projection.publishClosure);
      })
      .catch(() => {
        // Missing persisted projection is a valid fail-closed state; local preview can still render.
      });
    return () => {
      cancelled = true;
    };
  }, [
    sessionState.sessionId,
    visiblePythonRuntimeProjection,
    pythonPublishClosure,
    pythonSkillRuntimeGraph,
    authReady,
    authUser,
  ]);

  useEffect(() => {
    const intent = goal || latestTurn?.user || "";
    const immediatePythonProjection = deriveImmediatePythonRuntimeProjection({
      pythonPublishClosure,
      pythonSkillRuntimeGraph,
    });
    if (immediatePythonProjection) {
      setCrossRuntimeGraph(immediatePythonProjection.crossRuntimeGraph);
      setPublishClosure(immediatePythonProjection.publishClosure);
    }
    if (!intent.trim()) {
      if (!immediatePythonProjection) {
        setCrossRuntimeGraph(null);
        setPublishClosure(null);
      }
      return;
    }
    let cancelled = false;
    // DataModel field changes (deriveDataModelChangedRefs + createDataModelPageBindingImpactEvidence)
    // -> .pageBindingImpactEvidence on datamodel resolve() surface
    // -> DM_PAGE_BINDING_IMPACT_EVIDENCE added to runtimeEvidence ONLY on positive (fail-closed negatives excluded)
    // -> flows via orchestrator crossRuntimeGraph + slideRule.publishGate().runtimeClosure (AppBundle evaluate)
    // -> derive*Summary -> UI publishClosure/crossRuntimeGraph. This is the 119 DM->Page binding runtime closure path.
    //
    // NOTE — generate() 降级行为 (P4):
    // deriveApplication() 内部调用每个 Skill 的 generate(intent)。
    // 当前 appBundleSkill.generate() 只识别"采购/purchase"和"请假/leave"两个意图词；
    // 其他意图会抛出 Error，被 deriveApplication 的 try/catch 降级为空 crossRuntimeGraph。
    // 此处的结果 (result.spec.skills) 已包含五系统 resolve 产出——publishGate 仍能正常校验闭包。
    // 待 LLM generate() 实现后，覆盖面将从fixture扩展到任意意图，不需要修改此处。
    deriveApplication(intent)
      .then(result => {
        if (cancelled) return;
        // Page field binding evidence closed in publish/runtime via create+evaluate against real DM SSOT in closure path (119).
        // publishGate receives the skills (containing datamodel model + page) so runtimeClosure now computes
        // Page->datamodel field binding evidence using real upstream SSOT surface (no temp private field).
        const publishGate = slideRule.publishGate(result.spec.skills);
        const runtimeCross = pythonSkillRuntimeGraph
          ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
              exampleLimit: 5,
            })
          : null;
        setCrossRuntimeGraph(
          runtimeCross ||
            deriveCrossRuntimeGraphSummary(result.crossRuntimeGraph, {
              exampleLimit: 5,
            })
        );
        const previewClosure = derivePublishClosureSummary(
          publishGate.runtimeClosure,
          { blockerLimit: 3 }
        );
        // Core page selection logic (119 objective):
        // Prefer Python-produced closure evidence (from persisted sessionState via Python /drive-full)
        // when present. Fall back to local TS previewClosure ONLY when Python one is absent.
        // This is the explicit prefer-python-over-preview behavior required for frontend.
        const preferredClosure = selectPublishClosureSummary(
          pythonPublishClosure,
          previewClosure
        );
        setPublishClosure(preferredClosure);
      })
      .catch(() => {
        if (!cancelled) {
          setCrossRuntimeGraph(
            pythonSkillRuntimeGraph
              ? deriveCrossRuntimeGraphSummary(pythonSkillRuntimeGraph as any, {
                  exampleLimit: 5,
                })
              : null
          );
          // fail-closed: on derive error, still select python (if present from session) else null;
          // never fabricate a preview here.
          setPublishClosure(
            selectPublishClosureSummary(pythonPublishClosure, null)
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [goal, latestTurn?.user, pythonPublishClosure, pythonSkillRuntimeGraph]);

  const reasoningViewModel = useMemo(
    () =>
      deriveSlideRuleReasoningViewModel(sessionState, {
        liveAction: isRunning ? liveAction : null,
        density: projectionDensity,
        viewMode,
        latestUiTurn: latestTurn,
        lineageHighlightIds,
      }),
    [
      sessionState,
      isRunning,
      liveAction,
      projectionDensity,
      viewMode,
      latestTurn,
      lineageHighlightIds,
    ]
  );
  const graphNodeCount = reasoningViewModel.visibleNodes.length;
  const graphRevision = `${sessionState.sessionId}-${graphNodeCount}-${sessionState.artifacts?.length ?? 0}-${projectionDensity}-${isRunning}`;

  // Focus terminal only when it newly appears within the current session.
  // On refresh, keep the first frame stable and let fit frame the whole graph.
  const terminalMountedRef = useRef(false);
  const prevTerminalIdRef = useRef<string | null>(null);
  useEffect(() => {
    const tid = reasoningViewModel.terminalNode?.id ?? null;
    const wasMounted = terminalMountedRef.current;
    const prevTid = prevTerminalIdRef.current;
    prevTerminalIdRef.current = tid;
    terminalMountedRef.current = true;
    if (!wasMounted) return; // Do not focus on initial mount or refresh.
    if (tid && tid !== prevTid) setFocusNodeId(SLIDERULE_TERMINAL_NODE_ID);
  }, [reasoningViewModel.terminalNode?.id]);

  const handleProjectionDensityChange = useCallback(
    (density: ProjectionDensity) => {
      setProjectionDensity(density);
      if (density === "compact") {
        setLineageHighlightIds([]);
      }
      try {
        localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, density);
      } catch {
        /* ignore */
      }
    },
    []
  );

  // Plain node clicks no longer open challenge dialogs; edits are handled inline.
  // Keep this callback side-effect free for future selection/focus hooks.
  const handleGraphNodeClick = useCallback(
    (_node: BrainstormReasoningNode) => {},
    []
  );

  // ?im=dev 仍是 /sliderule 产品页可达面（同一路由 + query），不是独立
  // Dev 页。节点编辑走作曲家预填，不立刻点火；persist fail-closed 在
  // sendMessage → runTurn 的 challenge 闸上（与质疑本轮同一条）。
  const handleNodeEditSubmit = useCallback(
    (node: BrainstormReasoningNode, text: string) => {
      const producedArtifactId = (node as { producedArtifactId?: string })
        .producedArtifactId;
      if (producedArtifactId && text.trim()) {
        dispatchChallengePrefill({
          artifactId: producedArtifactId,
          targetLabel: text.trim(),
        });
      }
    },
    []
  );

  const handleResolveInteractiveGate = useCallback(
    (gateNodeId: string, choice: string | null) => {
      resolveInteractiveGate(gateNodeId, choice);
    },
    [resolveInteractiveGate]
  );

  const handleTerminalAction = useCallback(
    (action: "report" | "lineage" | "export") => {
      if (action === "report") {
        openDeliverables();
        return;
      }
      if (action === "lineage") {
        if (projectionDensity === "compact") {
          setProjectionDensity("detailed");
          try {
            localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, "detailed");
          } catch {
            /* ignore */
          }
        }
        const ids = deriveLineageHighlightNodeIds(sessionState);
        setLineageHighlightIds(ids);
        if (ids[0]) setFocusNodeId(ids[0]);
        return;
      }
      if (action === "export" && reasoningViewModel.terminalMeta?.canExport) {
        // 交付口换成 HTML 载体（2026-08-14）：新链路画出来的整套页面打成
        // 一个自包含文件，推演说明并进去当一页。
        //
        // ⚠ **没有页面时如实回落 .md**，不产出一个空壳包。老链路今天还在跑
        //   （spec-first 挂了会显式回落），那一轮本来就没有 HTML 可交——
        //   交一个点开什么都没有的文件，比不交更糟：它看着像交付成功了。
        // ⚠ 不 await：这个处理器不是 async，而且导出本来就该是"点了就走"。
        //   拉本地那份 Tailwind（400KB、同源）失败时 downloadSlideRuleDeliveryHtml
        //   自己会 fail-open（包照出，只是没样式），拿不到页面才回落 .md。
        void downloadSlideRuleDeliveryHtml(sessionState, {
          appTitle: goal ? goal.slice(0, 40) : undefined,
          notesMd: serializeSlideRuleDeliveryMd(sessionState),
        }).then(ok => {
          if (!ok) downloadSlideRuleDeliveryMd(sessionState);
        });
      }
    },
    [
      sessionState,
      reasoningViewModel.terminalMeta?.canExport,
      projectionDensity,
      openDeliverables,
    ]
  );

  const handleEvidenceRefClick = useCallback(
    (artifactId: string) => {
      if (projectionDensity === "compact") {
        setProjectionDensity("detailed");
        try {
          localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, "detailed");
        } catch {
          /* ignore */
        }
      }
      const nodeId = graphNodeIdForArtifact(sessionState, artifactId);
      if (nodeId) {
        setLineageHighlightIds([nodeId]);
        setFocusNodeId(nodeId);
      }
    },
    [sessionState, projectionDensity]
  );

  const shared = {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    sendMessage,
    pendingPlanApproval,
    submitPlanApproval,
    pendingAsk,
    onSubmitQuestionnaire: submitQuestionnaire,
    queuedTurns,
    removeQueuedTurn,
    dismissAsk,
    restoreModelVersion,
    forkVariant,
    isRestoringVersion,
    challengeTurn,
    resetSession,
    retryCapability,
    toggleRouteExpanded,
    reasoningViewModel,
    graphNodeCount,
    graphRevision,
    handleGraphNodeClick,
    handleNodeEditSubmit,
    handleResolveInteractiveGate,
    handleTerminalAction,
    focusNodeId,
    lineageHighlightIds,
    onEvidenceRefClick: handleEvidenceRefClick,
    projectionDensity,
    onProjectionDensityChange: handleProjectionDensityChange,
    imSurfaceMode,
    latestTurn,
    latestTurnId,
    executorMode,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
    pendingClarifications,
    answerClarifications,
    generateDeliverables,
    stop,
    onExportDeliverables: () => downloadSlideRuleDeliveryMd(sessionState),
    deliverablesOpen,
    setDeliverablesOpen,
    openDeliverables,
    embedded,
    pythonApiError,
    pythonStatusMsg,
    retryPythonBackend,
    crossRuntimeGraph: visibleCrossRuntimeGraph,
    publishClosure: visiblePublishClosure,
    driveFullStatus,
    projectCapabilities,
    onCreateProject: () => void createProjectFromApprovedPlan(),
    canCreateProject,
    projectCreateBlockedReason,
    projectCreateState,
    activeSkillId,
    skillContents,
    latestMermaid,
    specPages,
    llmDraft,
    llmDraftLabel,
    llmStreams,
    rehearsalCursor,
  };

  if (isImmersion) {
    return (
      <div
        data-testid="sliderule-root"
        data-python-provenance="via-delegation"
        data-paths="/agent-loop/sliderule /sliderule"
        data-backend="python-fullpath-e2e"
        data-runtime-publish-closure={
          visiblePublishClosure ? "present" : "absent"
        }
        data-runtime-skill-graph={
          visibleCrossRuntimeGraph ? "present" : "absent"
        }
      >
        {/* E33.5 水合期加载：antd 官方 Spin（用户裁决，不用自定义骨架） */}
        {!sessionHydrated && (
          <Spin
            fullscreen
            size="large"
            tip="正在准备工作台"
            data-testid="sliderule-hydration-spin"
          />
        )}
        <SlideRuleUnified {...shared} />
      </div>
    );
  }

  return (
    <div
      data-testid="sliderule-root"
      data-python-provenance="via-delegation"
      data-paths="/agent-loop/sliderule /sliderule"
      data-backend="python-fullpath-e2e"
      data-runtime-publish-closure={
        visiblePublishClosure ? "present" : "absent"
      }
      data-runtime-skill-graph={visibleCrossRuntimeGraph ? "present" : "absent"}
    >
      <SlideRuleSplitEngineering {...shared} />
    </div>
  );
}
