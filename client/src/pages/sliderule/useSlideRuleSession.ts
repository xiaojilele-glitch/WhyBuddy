import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  ActionTrace,
  LiveAction,
} from "@shared/blueprint/capability-process-labels";
import * as SlideRuleRuntime from "@/lib/sliderule-runtime";
import { fetchNarration } from "@/lib/sliderule-narrator";
import { controlStopLine } from "./control-stop";
import { visiblePlanTodo } from "./plan-todo-dock";
import {
  latestPlanDeliverableKind,
  projectTemplateForDeliverable,
} from "./deliverable-kind";
import { projectCreateFailureText } from "./project-create-error";
import { pickMainArtifact } from "./turn-main-artifact";
import type {
  CoverageGap,
  UserIntervention,
  V5SessionState,
} from "@shared/blueprint/v5-reasoning-state";
import {
  pendingClarificationItems,
  type ClarificationItem,
} from "./ClarificationCard";
import { deriveTurnRoute } from "@shared/blueprint/sliderule-turn-route";
import { resolveImSurfaceMode } from "./im-surface-mode";
import type { SchedulingDecision } from "@shared/blueprint/v5-reasoning-state";
import { challengeTargetLabel } from "./challenge-target-label";
import { buildTurnRoundsFromDrive } from "./turn-round-facts";
import { narrationTurnIdFor, stampTurnNarration } from "./turn-narration";
import { deriveTurnsFromState } from "./derive-persisted-turn";
import {
  saveActiveRun,
  loadActiveRun,
  clearActiveRun,
} from "./active-run-store";
import {
  createUiCapabilityExecutor,
  mapArtifactsToWhyArtifacts,
} from "./ui-capability-executor";
import { mergePublishClosureForPersistedTurn } from "./derive-persisted-turn";
import { notifyDriveComplete } from "./user-prefs";
import {
  renameAnnouncedPage,
  renameSpecPageCard,
  upsertSpecPageCard,
} from "./live-runtime/spec-page-cards";
import { createHttpSlideRuleSessionStore } from "@/lib/sliderule-http-store";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { loadByokPool, validateByokPool } from "@/lib/sliderule-byok-config";
import { describeDriveAuthFailure } from "@/lib/auth-client";
import {
  DEFAULT_SESSION_ID,
  assertDriveSessionMatchesShell,
} from "@/lib/sliderule-session-id";
import { useAuth } from "@/lib/use-auth";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import {
  humanReasoningStepLabel,
  SPEC_FIRST_LIVE_LABELS,
} from "@shared/blueprint/spec-first-labels";
import type {
  TurnStep,
  UiTurn,
  WhyArtifact,
  SlideRuleExecutorMode,
} from "./types";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import * as Marathon from "@/lib/sliderule-marathon-driver";
import {
  advanceRehearsalCursor,
  idleRehearsalCursor,
  startRehearsalCursor,
  type RehearsalClockCursor,
} from "./derive-status-bar";
import {
  createGithubPagesSlideRuleSeedSession,
  createGithubPagesSlideRuleSessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "./github-pages-sliderule-demo";
import {
  CHALLENGE_PREFILL_EVENT,
  dispatchChallengePrefill,
  latestMainArtifactIdFromTurns,
  resolveChallengeSend,
} from "./challenge-composer";
import type { ControlQuestionWire, ControlPlanApprovalWire } from "@/lib/sliderule-marathon-driver";
import type { QuestionnaireOutcome } from "./QuestionnaireCard";
import type { PlanApprovalOutcome } from "./PlanApprovalPanel";
import {
  FACTORY_HOP_LABELS,
  closedToolFromText,
  factoryHopFromText,
  isFactoryHop,
  isFactoryWriteTool,
  isProjectWorkbenchTool,
} from "@/lib/factory-hops";
import { isContinuationTurn } from "@/pages/sliderule/turn-continuation";
import {
  attachProjectChipsToTurns,
  projectActionDetail,
  projectToolStillOpen,
  turnsHaveProjectChips,
} from "./project-activity";
import {
  controlUserTextForSlash,
  forcedToolForRehearsalVerb,
  parseRehearsalSlash,
} from "./composer-slash";
import {
  enqueueTurn,
  combinePrefix,
  type QueuedTurn,
  removeQueued,
} from "./midrun-queue";
type QueuedToolAnswer = {
  kind: string;
  text: string;
  reqId?: string;
  // 只传选择和手写内容；模型看到的措辞由服务端按 outcome 生成。
  outcome?: QuestionnaireOutcome["outcome"] | PlanApprovalOutcome["outcome"];
  feedback?: string;
  answers?: Record<string, string[]>;
  notes?: Record<string, string>;
};

type QueuedControlTurn = QueuedTurn & {
  toolAnswer?: QueuedToolAnswer;
  planApproval?: ControlPlanApprovalWire;
};

/** 昂贵按钮的 forcedTool。/推演 不得在客户端带 rehearse——未确认卡由服务端 park。 */
export function inferForcedTool(
  userText: string,
  intervention?: UserIntervention,
  mode?: "repair",
  explicit?: string,
  firstPass?: boolean
): string | undefined {
  // 人话点明某一跳：只许盖掉上一跳留下的 factory hop（pages 等残留），
  // 不许盖掉 rehearse / refine / restore_version 这类显式意图。
  // 2026-09-03 真机：确认继续钉 pages，随后 Structure 仍 POST pages。
  // 2026-09-04：文本提到 explicit 之前修过头——话题含「结构」时，
  // 开始推演的 rehearse 被劫持成 structure。
  //
  // ⚠ 2026-09-04 真机（社区旧物置换站）：上面那条护栏首轮**根本不生效**。
  //   本函数头一行注释自己写着「/推演 不得在客户端带 rehearse」——首轮
  //   explicit 就是 undefined，`!explicit` 于是反而放行了文本，
  //   POST 出去 forcedTool=structure，后端 `hasSpec=0 hasPages=0` 直接卡住。
  //   护栏挡的是「显式意图被文本盖掉」，挡不住「压根没有显式意图」。
  //   首轮那句是**产品话题**，不是针对交付物的指令：还没有东西可反推。
  const fromText = firstPass
    ? undefined
    : closedToolFromText(userText) || factoryHopFromText(userText);
  if (fromText && (!explicit || isFactoryHop(explicit))) return fromText;
  if (explicit) return explicit;
  if (mode === "repair") return "repair";
  if (intervention?.intent === "challenge") return "challenge";
  const slash = forcedToolForRehearsalVerb(parseRehearsalSlash(userText));
  if (slash) return slash;
  return undefined;
}

/** `/回退` 默认上一版。空 versionId 在服务端是静默 no-op。 */
export function previousModelVersionId(state: {
  modelVersions?: Array<{ id?: string } | null> | null;
  currentModelVersionId?: string | null;
}): string | undefined {
  const versions = Array.isArray(state.modelVersions) ? state.modelVersions : [];
  const ids = versions
    .map(v => (v && typeof v.id === "string" ? v.id : ""))
    .filter(Boolean);
  if (!ids.length) return undefined;
  const current = String(state.currentModelVersionId || "");
  const idx = current ? ids.indexOf(current) : ids.length - 1;
  if (idx > 0) return ids[idx - 1];
  return undefined;
}

// 105 Python full-path: product /agent-loop/sliderule + /sliderule use this hook + http store.
// Sessions: Node thin-compat proxy. Turns/evidence/report: delegated to slide-rule-python (python-rag provenance).
// Smoke (updated) starts here and asserts the path.

function createEmptySessionState(sessionId: string): V5SessionState {
  const base = SlideRuleRuntime.createInitialSessionState(
    SlideRuleRuntime.EMPTY_SESSION_GOAL_TEXT,
    sessionId
  );
  return SlideRuleRuntime.deriveNodeStatus
    ? SlideRuleRuntime.deriveNodeStatus(base)
    : base;
}

function sanitizeLegacyEmptySeed(state: V5SessionState): V5SessionState {
  if (!SlideRuleRuntime.isLegacyEmptySessionSeed(state)) return state;
  const cleared = createEmptySessionState(
    state.sessionId || DEFAULT_SESSION_ID
  );
  return { ...cleared, sessionId: state.sessionId || DEFAULT_SESSION_ID };
}

/** Mirror scope_authority.plan_execution_authorized; the server still authorizes every write. */
function hasApprovedProjectPlan(state: V5SessionState): boolean {
  const rows = (state.controlTranscript || []).filter(row => row && typeof row === "object") as Array<Record<string, unknown>>;
  const planRows = rows.filter(row => typeof row.kind === "string" && row.kind.startsWith("plan_"));
  const plan = [...rows].reverse().find(row => row.kind === "plan_written");
  const latest = planRows[planRows.length - 1];
  if (!plan || !latest || latest.kind !== "plan_approved") return false;
  if (typeof plan.planId !== "string" || !plan.planId.trim()
    || typeof plan.planContent !== "string" || !plan.planContent.trim()
    || typeof plan.revision !== "number" || !Number.isInteger(plan.revision) || plan.revision < 1) return false;
  if (["planId", "revision", "planContent"].some(key => latest[key] !== plan[key])) return false;
  const approval = [...planRows.slice(0, -1)].reverse().find(row => row.kind === "plan_approval");
  if (!approval || !approval.reqId) return false;
  return ["reqId", "planId", "revision", "planContent"].every(key => latest[key] === approval[key]);
}

const PROJECT_CONVERSION_REQUIRED = "当前会话已有 HTML 应用，请新建会话创建工程，或通过显式转换迁移。";

function projectCreationBlockedReason(state: V5SessionState): string | null {
  if (state.runtimeKind === "project") return null;
  // Mirrors project_authority.has_generated_application. The create endpoint
  // rejects these sessions; changing runtimeKind would discard their old app.
  const source = state as V5SessionState & {
    specFirstPages?: { pages?: unknown[] | Record<string, unknown> };
    modelVersions?: unknown[];
    currentModelVersionId?: string;
  };
  const pages = source.specFirstPages?.pages;
  if ((pages && Object.keys(pages).length > 0) || source.modelVersions?.length || source.currentModelVersionId) {
    return PROJECT_CONVERSION_REQUIRED;
  }
  const appKinds = new Set(["app_model", "model", "page", "html", "prototype", "five_system_model"]);
  return (state.artifacts || []).some(artifact => appKinds.has(artifact.kind)
    || Boolean(artifact.payload && typeof artifact.payload === "object" && "html" in artifact.payload && artifact.payload.html))
    ? PROJECT_CONVERSION_REQUIRED : null;
}

// Project tools are emitted by the control SSE stream. Keep the UI wording
// close to the actual tool name so the right hand workbench reflects real
// activity rather than a fabricated percentage.
const PROJECT_TOOL_LABELS: Record<string, string> = {
  project_create: "正在创建工程",
  project_list: "正在读取工程列表",
  project_read: "正在读取工程文件",
  project_search: "正在搜索工程源码",
  project_patch: "正在写入工程源码",
  project_write: "正在写入工程源码",
  project_str_replace: "正在替换工程源码",
  file_read: "正在读取工程文件",
  file_write: "正在写入工程源码",
  file_str_replace: "正在替换工程源码",
  file_find_in_content: "正在搜索工程源码",
  file_find_by_name: "正在按名查找工程文件",
  shell_exec: "正在执行工程命令",
  shell_view: "正在读取工程日志",
  shell_wait: "正在等待工程命令",
  shell_write_to_process: "正在写入进程",
  shell_kill_process: "正在停止工程",
  browser_view: "正在查看预览",
  browser_navigate: "正在打开预览",
  browser_restart: "正在重启预览",
  browser_click: "正在点击页面",
  browser_input: "正在输入页面",
  browser_move_mouse: "正在移动指针",
  browser_press_key: "正在按键",
  browser_select_option: "正在选择选项",
  browser_scroll_up: "正在向上滚动",
  browser_scroll_down: "正在向下滚动",
  browser_console_exec: "正在执行页面脚本",
  browser_console_view: "正在读取控制台",
  deploy_expose_port: "正在启动工程",
  deploy_apply_deployment: "正在公开部署",
  make_manus_page: "正在展示页面",
  message_notify_user: "正在通知用户",
  message_ask_user: "正在询问用户",
  info_search_web: "正在检索资料",
  idle: "正在等待用户",
  skill: "正在加载技能",
  read_file: "正在读取工程文件",
  write_file: "正在写入工程源码",
  search_replace: "正在替换工程源码",
  bash: "正在执行工程命令",
  grep: "正在搜索工程源码",
  list_dir: "正在读取工程列表",
  glob: "正在按名查找工程文件",
  project_start: "正在启动工程",
  project_exec: "正在执行工程命令",
  project_status: "正在读取工程运行状态",
  project_logs: "正在读取工程日志",
  project_cancel: "正在停止工程",
  project_verify: "正在执行浏览器检查",
};

export function projectToolLabel(tool: unknown): string | null {
  const key = String(tool || "").trim();
  return PROJECT_TOOL_LABELS[key] ?? (isProjectWorkbenchTool(key) ? `正在执行 ${key}` : null);
}

/** Build the server-owned approval reference without changing the session projection. */
async function approvedPlanReference(state: V5SessionState): Promise<string | null> {
  const rows = (state.controlTranscript || []).filter(row => row && typeof row === "object") as Array<Record<string, unknown>>;
  const plan = [...rows].reverse().find(row => row.kind === "plan_written");
  const approved = [...rows].reverse().find(row => row.kind === "plan_approved");
  if (!hasApprovedProjectPlan(state) || !plan || !approved || !plan.planId || !plan.planContent || typeof plan.revision !== "number") return null;
  if (["planId", "revision", "planContent"].some(key => approved[key] !== plan[key])) return null;
  const bytes = new TextEncoder().encode(String(plan.planContent));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${String(plan.planId)}:${String(plan.revision)}:${hash}`;
}

/**
 * Frontend session store adapter for Python evidence projection persistence.
 * Explicitly carries the (python /drive-full) publishClosure and skillRuntimeGraph evidence
 * projections through load/save roundtrips. Old sessions without the keys remain compatible.
 * No network/DB/provider calls; pure local shape passthrough + defaults.
 * Positive: when present on loaded or drive-final, preserved on persist.
 * Fail-closed negative: missing fields stay absent (preview may still apply).
 */
function preservePythonEvidenceProjection(
  state: V5SessionState
): V5SessionState {
  const pc = (state as any).publishClosure;
  const sg = (state as any).skillRuntimeGraph;
  // spec-first 的整页 HTML 跟上面两个同一个道理：它是**交付物本身**，
  // 掉了的话刷新之后右侧就只剩老链路的区块页（用户 08-14 报的那个现象的
  // 持久化版本）。⚠ 这个函数是"存回去"那一侧，漏列一个键 = 存一次丢一次，
  // 而且不会有任何一处报错。
  const sp = (state as any).specFirstPages;
  if (pc === undefined && sg === undefined && sp === undefined) return state;
  const next: any = { ...state };
  if (pc !== undefined) next.publishClosure = pc;
  if (sg !== undefined) next.skillRuntimeGraph = sg;
  if (sp !== undefined) next.specFirstPages = sp;
  return next as V5SessionState;
}

async function persistSession(state: V5SessionState): Promise<V5SessionState> {
  const toSave = preservePythonEvidenceProjection(state);
  return SlideRuleRuntime.saveSessionState(toSave);
}

/**
 * Persist-as-authority gate before igniting `/drive-full-stream`.
 *
 * ⚠ 2026-08 M5/PR-1：旧实现 `catch { 仍继续驱动 }` 让质疑在落盘失败后
 * 照样 POST。Python `drive_full_stream` 以已持久化会话为权威起点，质疑
 * 静默丢失、证据链假装跑过——闭环类必须 fail-closed。
 *
 * 非挑战意图保持 fail-open（请求体兜底）：一次落盘抖动不许拖垮整轮推演。
 */
/**
 * 澄清卡提交后、runTurn 从磁盘灌回会话之前，先把答过的缺口在内存里关上。
 *
 * ⚠ 2026-09-01：乐观关缺口只写 React state，runTurn 开头
 * `loadOrCreateSessionState` 再 `applyPersistedState` 会把 open +
 * control_clarify 灌回来，卡从 1/3 已答 0/3 再弹一遍。必须接在
 * applyPersistedState 前面那一次赋值上，删掉就回到截图。
 */
export function applyAnsweredGapsToState(
  state: V5SessionState,
  intervention?: {
    answeredGapIds?: string[];
    answeredGaps?: Array<{ gapId: string; answer: string }>;
  }
): V5SessionState {
  const ids = (intervention?.answeredGapIds || []).map(id => String(id));
  if (!ids.length) return state;
  const answered = new Set(ids);
  const answersById = new Map(
    (intervention?.answeredGaps || []).map(row => [
      String(row.gapId),
      String(row.answer || ""),
    ])
  );
  const now = new Date().toISOString();
  const coverageGaps = (state.coverageGaps || []).map(gap =>
    answered.has(gap.id)
      ? {
          ...gap,
          status: "resolved" as const,
          answer: answersById.get(gap.id) || gap.answer,
          updatedAt: now,
        }
      : gap
  );
  const stillOpenClarify = coverageGaps.some(
    gap => gap.status === "open" && gap.kind === "open_question"
  );
  if (state.awaitReason !== "control_clarify" || stillOpenClarify) {
    return { ...state, coverageGaps };
  }
  return {
    ...state,
    coverageGaps,
    awaitReason: undefined,
    awaitDetail: undefined,
  };
}

export async function persistPreparedStateForDrive(opts: {
  persist: () => Promise<unknown>;
  intent?: UserIntervention["intent"] | null;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await opts.persist();
    return { ok: true };
  } catch (error) {
    if (opts.intent === "challenge") {
      return { ok: false, error };
    }
    return { ok: true };
  }
}

async function prepareVisibleResetSessionState(
  sessionId: string,
  deleteSession?: (sessionId: string) => Promise<void>,
  saveSession: (
    state: V5SessionState
  ) => Promise<V5SessionState> = persistSession
): Promise<V5SessionState> {
  try {
    await deleteSession?.(sessionId);
  } catch {
    // Reset must remain visible even when the backend delete route is unavailable.
  }

  const empty = sanitizeLegacyEmptySeed(createEmptySessionState(sessionId));
  try {
    return await saveSession(empty);
  } catch {
    return empty;
  }
}

/** 已闭环会话：goal 已 clear / 相位 done / 发布闭环证据齐 6。 */
function isClosedSessionState(state: V5SessionState): boolean {
  if (state.goal?.status === "clear") return true;
  if ((state as any).runtimePhase === "done") return true;
  const pc: any = (state as any).publishClosure;
  return (
    !!pc && pc.blocked === false && Number(pc.evidencePresentCount ?? 0) >= 6
  );
}

/**
 * 新应用意图启发式。用于"已闭环话题里输入新想法"的自动开新话题——intake 的
 * new_goal 只认空会话，否则新意图落进旧话题，gate 已通过会秒回 closed 6/6
 * （零推演，用户误读为造假）。两种命中方式：
 *   1. 动词（做/搭建/设计/构建/开发…）+ 载体名词（系统/应用/平台…）；
 *   2. 裸名词短语（「智能财务自动化办公系统」）：无标点、以载体名词收尾、
 *      不以修改类动词开头（把/改/优化…是对旧话题的 refine，不能误开新话题）。
 */
export function looksLikeNewAppIntent(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 6) return false;
  // D5 修复（2026-07-27 迭代体验审查）：增量修饰排除必须先于动词判定——
  // 此前"给工单系统做一个统计报表页面"因命中 动词+载体名词 被当成新应用,
  // 直接删会话重开(含全部改版史,不可恢复)。任何以增量介词/修改动词开头,
  // 或明确"在现有基础上"的表述,都是对旧话题的迭代,绝不能当新意图。
  if (
    /^(给|为|在|把|将|改|修改|调整|优化|完善|去掉|删除|增加|加上|补充|重新|再|请|帮我改|基于)/.test(
      t
    )
  )
    return false;
  if (/(基础上|现有|这个应用|这个系统|当前版本|刚才|上面)/.test(t)) return false;
  const noun = /(系统|应用|平台|工具|app|小程序|管理端|门户|网站)/i;
  if (!noun.test(t)) return false;
  const verb =
    /(做一?个|搭建|设计一?个|构建|开发一?个|建一?个|来一?个|帮我做|我想要|我要做|create|build|design)/i;
  if (verb.test(t)) return true;
  return /^[一-龥A-Za-z0-9\s·\-]{3,38}(系统|应用|平台|门户|网站|小程序)$/.test(
    t
  );
}

function hasReadyByokPool(): boolean {
  const pool = loadByokPool();
  return !!(
    pool &&
    validateByokPool(pool).ok &&
    pool.entries.some(e => e.enabled && e.apiKey)
  );
}

function resolveExecutorMode(): SlideRuleExecutorMode {
  if (IS_GITHUB_PAGES) {
    return hasReadyByokPool() ? "browser-llm" : "demo";
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("executor") === "pilot") return "pilot";
  if (params.get("executor") === "default") return "default";
  // BYOK override: a valid local key pool drives browser-direct LLM even on localhost.
  // Empty / invalid pool falls back to the V5.1 product default (server LLM).
  if (hasReadyByokPool()) return "browser-llm";
  return "server-llm";
}

function resolveMaxLoopsPerMessage(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("maxLoops");
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SlideRuleRuntime.PRODUCT_PREVIEW_MAX_LOOPS_PER_MESSAGE;
}

function latestDledgerForTurn(
  ledger: SchedulingDecision[] | undefined,
  turnId: string
): SchedulingDecision | null {
  const arr = ledger || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].turnId === turnId) return arr[i];
  }
  return null;
}


export type UseSlideRuleSessionOptions = {
  sessionId?: string;
  initialGoal?: string;
  documentTitle?: string;
};

export function useSlideRuleSession(options: UseSlideRuleSessionOptions = {}) {
  const { refresh: refreshAuth, user: authUser, ready: authReady } = useAuth();
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const [uiTurns, setUiTurns] = useState<UiTurn[]>([]);
  const uiTurnsRef = useRef<UiTurn[]>([]);
  uiTurnsRef.current = uiTurns;
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  /**
   * 运行闸用 ref。stop() 立刻把 isRunning 画面松开，但本轮 finally 还没到；
   * 只读 state 会在那窗口里再开一发，和还没卸完的工厂叠在一起。
   */
  const isRunningRef = useRef(false);
  /**
   * 运行中发送排队到下一轮控制面。
   *
   * ⚠ 2026-08-27：上一版 send 在 isRunning 时直接 stop()——发送键变成停止，
   * 用户打了「转向请假」再回车，工厂被杀掉。队列 fail-closed：等本轮
   * finally 再 POST 一发控制面，不许假装改了飞行中的 spec。
   * Stop 不清队列（用户先打新方向再停旧跑，那句就是下一发）。
   * resetSession 必须清掉——否则遗留队列会劫持后来无关的发送。
   */
  /*
   * ⚠ 2026-08-27：从「一个看不见的 ref、后来居上覆盖」改成「一条可见的队列」。
   *   老形态真机实测：推演中点发送，输入框清空、**整页搜不到这句话**、
   *   几分钟后它自己发出去；连补两句第一句还会被悄悄顶掉。
   *   机制通、人是懵的——ref 同步判定照旧留着（setState 异步，连点会漏），
   *   另加 state 只为了让它**看得见、撤得掉**。
   */
  const queuedTurnRef = useRef<QueuedControlTurn[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedControlTurn[]>([]);
  const pushQueuedTurn = (text: string, opts?: { synthetic?: boolean }) => {
    const next = enqueueTurn(queuedTurnRef.current, text, opts);
    queuedTurnRef.current = next;
    setQueuedTurns(next);
  };
  const removeQueuedTurn = useCallback((index: number) => {
    const plan = queuedTurnRef.current[index]?.planApproval;
    const next = removeQueued(queuedTurnRef.current, index);
    queuedTurnRef.current = next;
    setQueuedTurns(next);
    if (plan && !pendingAskRef.current && !pendingPlanApprovalRef.current) {
      handledRequestIdsRef.current.delete(plan.reqId);
      pendingPlanApprovalRef.current = plan;
      setPendingPlanApproval(plan);
    }
  }, []);
  // Preserve the server stop reason for truthful control-plane status.
  const lastControlStopRef = useRef<import("@/lib/sliderule-marathon-driver").ControlStop | null>(
    null
  );
  const requestRehearsalRef = useRef<
    (userText: string) => Promise<void>
  >(async () => {});
  /**
   * 版本回退/前进是否有请求在飞（2026-08-16 线上实测）。
   *
   * `isRunning` 只挡"推演中"，挡不住"上一次回退还没回来"。真机上用户连点
   * ◀ 好几下，三个并发 POST 全部被后端接受——按钮既不置灰也没有任何反馈。
   *
   * ⚠ 用 ref 而不只是 state 做判据：setState 是异步的，连点两下之间
   * React 可能还没重渲染，读 state 会读到旧值，闸形同虚设。ref 同步生效，
   * state 只负责让按钮变灰。
   */
  const [isRestoring, setIsRestoring] = useState(false);
  const restoringRef = useRef(false);
  const [liveAction, setLiveAction] = useState<LiveAction | null>(null);
  const [nextGateShouldFail, setNextGateShouldFail] = useState(false);
  const [executorMode, setExecutorMode] =
    useState<SlideRuleExecutorMode>("server-llm");
  const [sessionState, setSessionState] = useState(() =>
    createEmptySessionState(sessionId)
  );
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const controlActivityRef = useRef(0);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [driveFullStatus, setDriveFullStatus] = useState<
    | "idle"
    | "loading"
    | "python_success"
    | "timeout"
    | "python_unavailable"
    | "control_failed"
    | "fallback"
  >("idle");
  const [submittedClarifyIds, setSubmittedClarifyIds] = useState<string[]>([]);
  const [pendingAsk, setPendingAsk] = useState<{
    question: string;
    options?: string[];
    /** 抄 grok `AskUserQuestion`：一发几道题。缺席 = 服务端还是老形状。 */
    questions?: ControlQuestionWire[];
    reqId?: string;
  } | null>(null);
  const [pendingPlanApproval, setPendingPlanApproval] =
    useState<ControlPlanApprovalWire | null>(null);
  const pendingPlanApprovalRef =
    useRef<ControlPlanApprovalWire | null>(null);
  const handledRequestIdsRef = useRef(new Set<string>());
  const pendingAskRef = useRef(pendingAsk);
  pendingAskRef.current = pendingAsk;
  /**
   * 点芯片时第一发可能还在收 SSE（isRunning=true）。sendMessage 会清
   * pendingAsk，好让 finally 的 flush 不被 overlay 挡住——回执必须先
   * 盖到这枚章上，否则 POST 只有 forcedTool、没有 toolAnswer
   * （2026-09-08 真机：点「开始起草规范（spec）」）。
   */
  const pendingToolAnswerRef = useRef<QueuedToolAnswer | undefined>(undefined);

  const overlayBlocksQueueFlush = () =>
    Boolean(pendingAskRef.current || pendingPlanApprovalRef.current);
  const pendingForcedToolRef = useRef<string | undefined>(undefined);
  const flushQueuedControlTurn = () => {
    if (isRunningRef.current) return;
    if (overlayBlocksQueueFlush()) return;
    /* ⚠ 合成**一条**再发：三句补充发三轮 = 烧三次工厂，而且前两轮的产物
       立刻被后一轮推翻。用户补的是同一件事的三个细节。 */
    // 抄 grok `combine_prefix_len`：只发**开头连续可合并的一段**，
    // 剩下的（比如系统合成的那条）留在队列里。这一条发出去的回合完成时
    // 会再 flush 一次——flush 挂在回合完成上，天然是个 drain 循环。
    const queuedAnswer = queuedTurnRef.current[0]?.toolAnswer;
    const { text, rest } = combinePrefix(queuedTurnRef.current);
    queuedTurnRef.current = rest;
    setQueuedTurns(rest);
    if (text) {
      if (queuedAnswer) pendingToolAnswerRef.current = queuedAnswer;
      void requestRehearsalRef.current(text);
    }
  };

  /**
   * 问答卡提交。抄 grok `AskUserQuestion` 那四条路径。
   *
   * ⚠ 这里**只送结构**，不拼给模型看的话。回喂措辞归服务端
   *   （`services/user_questions.py` 的四条 format），前端换个说法不该改变
   *   模型看到的东西——本仓 §四那张「生成侧 / 消费侧」的表。
   *
   * ⚠ `text` 仍要给一句人话：它进 transcript、进左栏气泡，是**用户视角**的
   *   记录。两者不是一回事，别拿同一份糊弄过去。
   */
  const submitQuestionnaire = useCallback(
    (result: QuestionnaireOutcome) => {
      const pending = pendingAskRef.current;
      if (!pending) return;
      const rows = pending.questions || [];
      const reqId = pending.reqId;
      if (reqId && handledRequestIdsRef.current.has(reqId)) return;
      if (reqId) handledRequestIdsRef.current.add(reqId);
      const label = (qid: string) =>
        rows.find(r => r.id === qid)?.question || qid;
      let human = "";
      if (result.outcome === "accepted") {
        const parts = Object.entries(result.answers).map(
          ([qid, picks]) => `${label(qid)}：${picks.join("、")}`
        );
        human = parts.length ? parts.join("；") : "（没有选）";
      } else if (result.outcome === "cancelled") {
        human = "这些我不答，你自己定";
      } else {
        human = "别再问了，直接开始";
      }
      const toolAnswer: QueuedToolAnswer = {
        kind: "ask_user",
        text: human,
        ...(reqId ? { reqId } : {}),
        outcome: result.outcome,
        ...("answers" in result ? { answers: result.answers } : {}),
        ...("notes" in result ? { notes: result.notes } : {}),
      };
      // 回执先解当前提问，再处理排队的补充。答案跟条目同生共死，不能留在
      // 全局 ref 等下一条无关消息误取；出队时才给 runTurn 盖章。
      queuedTurnRef.current = [
        { text: human, synthetic: true, toolAnswer },
        ...queuedTurnRef.current,
      ];
      setQueuedTurns(queuedTurnRef.current);
      pendingAskRef.current = null;
      setPendingAsk(null);
      flushQueuedControlTurn();
    },
    []
  );

  const submitPlanApproval = useCallback((result: PlanApprovalOutcome) => {
    const pending = pendingPlanApprovalRef.current;
    if (
      !pending ||
      result.reqId !== pending.reqId ||
      handledRequestIdsRef.current.has(result.reqId)
    ) return;
    handledRequestIdsRef.current.add(result.reqId);
    const feedback = result.feedback?.trim();
    const human =
      result.outcome === "approved"
        ? "批准计划并执行"
        : result.outcome === "abandoned"
          ? "退出计划"
          : feedback || "请修改计划";
    const toolAnswer: QueuedToolAnswer = {
      kind: "plan_approval",
      reqId: pending.reqId,
      outcome: result.outcome,
      text: human,
      ...(feedback ? { feedback } : {}),
    };
    queuedTurnRef.current = [
      { text: human, synthetic: true, toolAnswer, planApproval: pending },
      ...queuedTurnRef.current,
    ];
    setQueuedTurns(queuedTurnRef.current);
    pendingPlanApprovalRef.current = null;
    setPendingPlanApproval(null);
    flushQueuedControlTurn();
  }, []);

  // SSE-driven: which of the 6 skill systems is currently executing on Python side.
  // null = none active (before run starts or after completion).
  const [activeSkillId, setActiveSkillId] = useState<SkillId | null>(null);

  // Accumulated per-skill content from SSE skill_result events (raw model/mermaid).
  const [skillContents, setSkillContents] = useState<
    Partial<Record<SkillId, string>>
  >({});
  const [latestMermaid, setLatestMermaid] = useState<string | null>(null);
  // spec-first 第 3 步的页面（2026-08-14）：一页好了就上屏，不等整轮跑完。
  //
  // 这一轮 8~9 分钟，此前右侧从头转到尾。第一份能直接打开的 HTML 在第二
  // 分钟就到了，比最终模型早四五分钟——那四五分钟的转圈不是"还没算出来"，
  // 是"算出来了没往外发"。
  //
  // ⚠ 按 pageId 去重覆盖，不是一味 push：同一页在第 6.5 步打完孔会**再来
  //   一次**（bound=true）。push 的话右侧会出现两份同名页，而后一份才是
  //   接上了数据的那份。
  const [specPages, setSpecPages] = useState<
    Array<{
      pageId: string;
      html: string;
      current: number;
      total: number;
      bound: boolean;
      // desktop 横屏 / phone 竖屏（2026-08-14）：画布视口据此选
      device?: "desktop" | "phone" | "tablet";
    }>
  >([]);
  // LLM 实时草稿（llm_delta 累积）：运行中在左栏流式展示，新一轮开始时清空。
  // 每一步（risk.analyze / report.write / 五系统起草…）各自一份缓冲，展示最近
  // 更新的那份；label 记录当前来源。只是观测投影——真实模型仍以闭环证据为准。
  const [llmDraft, setLlmDraft] = useState<string>("");
  const [llmDraftLabel, setLlmDraftLabel] = useState<string | null>(null);
  // E16.1 多流分窗：后端并行 LLM 子调用交错到达时，单槽展示会来回切换
  // （用户实测"打架"）——按 label 保序分窗，各流独立生长
  const [llmStreams, setLlmStreams] = useState<
    Array<{ label: string; text: string }>
  >([]);
  // 产品六步钟：SSE 投影，不另开进度 API。ref 同步推进，避免心跳闭包读到旧 cursor。
  const rehearsalCursorRef = useRef<RehearsalClockCursor>(idleRehearsalCursor());
  const [rehearsalCursor, setRehearsalCursor] = useState<RehearsalClockCursor>(
    idleRehearsalCursor()
  );
  const applyRehearsalEvent = (
    event: string | null | undefined,
    productStep?: number | null
  ) => {
    const next = advanceRehearsalCursor(
      rehearsalCursorRef.current,
      event,
      productStep
    );
    rehearsalCursorRef.current = next;
    setRehearsalCursor(next);
  };

  // 产品面恒 single（用户裁决 2026-07-10：模式选择器已删——drive-full-stream
  // 一条消息推到闭环，马拉松是浏览器端遗留且丢实时流）。初始化不再读
  // localStorage：历史上选过 marathon 的用户回正，不会被无 UI 可退的旧偏好
  // 困在马拉松分支。setDriveMode 保留给 Dev 工程面运行时切换。
  const [driveMode, setDriveMode] =
    useState<SlideRuleRuntime.SlideRuleDriveMode>("single");

  // M5: marathon budget (real costLedger + 强制 declared). Persisted.
  const [marathonBudget, setMarathonBudget] = useState<{
    maxTokens: number;
    declaredAt: string;
  }>(() => {
    try {
      const raw = localStorage.getItem("sliderule:marathonBudget");
      return raw
        ? JSON.parse(raw)
        : { maxTokens: 12000, declaredAt: new Date().toISOString() };
    } catch {
      return { maxTokens: 12000, declaredAt: new Date().toISOString() };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "sliderule:marathonBudget",
        JSON.stringify(marathonBudget)
      );
    } catch {}
  }, [marathonBudget]);

  // M1: per-turn abort controller for graceful stop.
  const abortControllerRef = useRef<AbortController | null>(null);
  // 质疑按钮只预填作曲家；发送时才带 intent: "challenge" 整轮 runTurn。
  const pendingChallengeRef = useRef<{ artifactId: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ artifactId?: string; text?: string }>)
        .detail;
      if (detail?.artifactId) {
        pendingChallengeRef.current = { artifactId: detail.artifactId };
      }
      if (typeof detail?.text === "string") {
        setInput(detail.text);
      }
    };
    window.addEventListener(CHALLENGE_PREFILL_EVENT, handler);
    return () => window.removeEventListener(CHALLENGE_PREFILL_EVENT, handler);
  }, []);

  const goal = useMemo(() => {
    const fromState = sessionState.goal?.text?.trim();
    if (fromState) return fromState;
    // 2026-09-13: while approval was still running, the latest bubble renamed
    // the project to "批准计划并执行". Python confirms the goal during approval;
    // until that snapshot arrives, use the original request, not a tool reply.
    const originalRequest = sessionState.controlTranscript?.find(
      row => row.role === "user" && row.kind === "turn" && row.text?.trim()
    )?.text?.trim();
    if (originalRequest) return originalRequest;
    const firstUser = uiTurns
      .find(t => t.user.trim() && !isContinuationTurn(t.user))
      ?.user.trim();
    return firstUser || "";
  }, [sessionState.goal?.text, sessionState.controlTranscript, uiTurns]);

  useEffect(() => {
    const prev = SlideRuleRuntime.getCapabilityExecutor?.();
    const prevStore = SlideRuleRuntime.getSlideRuleSessionStore?.();
    const mode = resolveExecutorMode();
    setExecutorMode(mode);

    if (IS_GITHUB_PAGES && SlideRuleRuntime.setSlideRuleSessionStore) {
      SlideRuleRuntime.setSlideRuleSessionStore(
        createGithubPagesSlideRuleSessionStore()
      );
      const pool = loadByokPool();
      if (
        pool &&
        validateByokPool(pool).ok &&
        pool.entries.some(e => e.enabled && e.apiKey)
      ) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    } else if (
      (mode === "server-llm" || mode === "browser-llm") &&
      SlideRuleRuntime.setSlideRuleSessionStore
    ) {
      // B-5: product default uses durable Http store (survives refresh via server JSON file).
      // browser-llm on localhost only swaps the LLM executor; the durable store still applies.
      SlideRuleRuntime.setSlideRuleSessionStore(
        createHttpSlideRuleSessionStore()
      );
    }

    if (!IS_GITHUB_PAGES) {
      if (
        mode === "browser-llm" &&
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor
      ) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else if (
        mode === "server-llm" &&
        SlideRuleRuntime.useServerLlmCapabilityExecutor
      ) {
        SlideRuleRuntime.useServerLlmCapabilityExecutor?.();
      } else if (mode === "default") {
        SlideRuleRuntime.useDefaultExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    }

    return () => {
      if (prevStore && SlideRuleRuntime.setSlideRuleSessionStore) {
        SlideRuleRuntime.setSlideRuleSessionStore(prevStore);
      }
      if (prev && SlideRuleRuntime.setCapabilityExecutor) {
        SlideRuleRuntime.setCapabilityExecutor(prev);
      } else {
        SlideRuleRuntime.useDefaultExecutor?.();
      }
    };
  }, []);

  // B4: live BYOK config change (storage or custom event) -> re-apply executor + mode without full refresh
  useEffect(() => {
    const reapplyByok = () => {
      // Re-resolve on any deploy target: adding/removing BYOK keys live-switches the executor
      // Pages: browser-llm -> pilot demo; localhost: browser-llm -> server-llm.
      const mode = resolveExecutorMode();
      setExecutorMode(mode);
      if (
        mode === "browser-llm" &&
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor
      ) {
        SlideRuleRuntime.useBrowserLlmCapabilityExecutor?.();
      } else if (
        mode === "server-llm" &&
        SlideRuleRuntime.useServerLlmCapabilityExecutor
      ) {
        SlideRuleRuntime.useServerLlmCapabilityExecutor?.();
      } else {
        SlideRuleRuntime.usePilotRealExecutor?.();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes("sliderule:llm-pool")) reapplyByok();
    };
    const onCustom = () => reapplyByok();
    window.addEventListener("storage", onStorage);
    window.addEventListener("byok-config-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("byok-config-changed", onCustom);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The empty shell is intentionally browsable without an account. Session
    // hydration is login-gated, so do not call the persisted-session endpoint
    // for anonymous visitors (it only returns a noisy 404). Mark hydration
    // complete with the in-memory empty state and wait for auth before trying
    // the durable store.
    if (authReady === false) return () => { cancelled = true; };
    // Some isolated hook tests provide the historical { refresh }-only auth
    // stub. Treat an omitted readiness/user pair as the old behavior; the real
    // provider always supplies an explicit ready boolean.
    if (authReady === true && !authUser) {
      setSessionHydrated(true);
      return () => { cancelled = true; };
    }
    (async () => {
      let loaded: V5SessionState;
      try {
        if (IS_GITHUB_PAGES) {
          const store = SlideRuleRuntime.getSlideRuleSessionStore();
          loaded = await loadOrSeedGithubPagesDemoSession(store, sessionId);
        } else {
          loaded = await SlideRuleRuntime.loadOrCreateSessionState(sessionId);
          if (SlideRuleRuntime.isLegacyEmptySessionSeed(loaded)) {
            // E30 惰性创建：空种子只在内存清洗，不落库——否则每个新 id 都
            // 往会话库塞一条「新会话」空壳（用户实测 bug）。首条消息才建档。
            loaded = sanitizeLegacyEmptySeed(loaded);
          }
        }
      } catch (e) {
        // E33 水合失败兜底：如实落回空会话态并宣布水合结束——加载幕布
        // 挂在 sessionHydrated 上，绝不能因加载链路异常而永远盖着屏
        console.warn("[sliderule] session hydration failed:", e);
        if (!cancelled) setSessionHydrated(true);
        return;
      }
      if (!cancelled) {
        const hydrated = preservePythonEvidenceProjection(loaded);
        sessionStateRef.current = hydrated;
        setSessionState(hydrated);
        setSessionHydrated(true);
        // 刷新后内存 uiTurns 是空的。版本史/叙述里有用户逐轮发出的话，
        // 不在这里灌回去，左栏就只剩首轮结论（2026-08-18 烘焙店真机）。
        const restored = deriveTurnsFromState(hydrated);
        if (restored.length > 0) setUiTurns(restored);
        if (hydrated.awaitReason === "control_plan_approval") {
          const lastPlan = [...(hydrated.controlTranscript || [])]
            .reverse()
            .find(row => row.kind === "plan_approval");
          if (
            typeof lastPlan?.reqId === "string" &&
            lastPlan.reqId &&
            typeof lastPlan.planContent === "string"
          ) {
            const pending = {
              reqId: lastPlan.reqId,
              planContent: lastPlan.planContent,
            };
            pendingPlanApprovalRef.current = pending;
            setPendingPlanApproval(pending);
          }
        }
        if (hydrated.awaitReason === "control_ask" && hydrated.awaitDetail) {
          const rows = hydrated.controlTranscript || [];
          const lastAsk = [...rows]
            .reverse()
            .find(row => row && (row.kind === "ask_user" || row.kind === "ask_user_question"));
          const rawOptions = lastAsk?.options;
          const options = Array.isArray(rawOptions)
            ? rawOptions.map(item => String(item))
            : undefined;
          const reqId =
            typeof lastAsk?.reqId === "string" && lastAsk.reqId
              ? lastAsk.reqId
              : undefined;
          const parkedAsk = {
            question: hydrated.awaitDetail,
            options,
            reqId,
            ...(Array.isArray(lastAsk?.questions) && lastAsk.questions.length
              ? { questions: lastAsk.questions as ControlQuestionWire[] }
              : {}),
          };
          pendingAskRef.current = parkedAsk;
          setPendingAsk(parkedAsk);
        }
        if (hydrated.awaitReason === "control_clarify") {
          // ClarificationCard 读 coverageGaps。这里只把钟拨到第 1 步，
          // 别再做一张 pendingAsk——两张卡叠在一起是 2026-08-27 真机事故。
          applyRehearsalEvent("intent.clarify", 1);
        }
        // 演示预填：空会话（未推演过）时输入框直接放好项目意图，
        // 访客只需点「发送」即可看全程推演（模板回放）。
        if (
          options.initialGoal &&
          !hydrated.goal?.text?.trim() &&
          (hydrated.artifacts?.length ?? 0) === 0
        ) {
          setInput(current => current || options.initialGoal || "");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, options.initialGoal, authReady, authUser]);

  useEffect(() => {
    if (!options.documentTitle) return;
    const prevTitle = document.title;
    document.title = options.documentTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [options.documentTitle]);

  const applyPersistedState = useCallback((state: V5SessionState) => {
    // finally 会同步出队，可能早于 React 下一次渲染；下一条消息必须看新终态。
    sessionStateRef.current = state;
    setSessionState(state);
  }, []);

  // E25：显式取消 = 真正杀掉服务端后台 run（不再只是断开本地连接）
  const cancelActiveRunOnServer = useCallback(() => {
    const sid = sessionState.sessionId || sessionId;
    const record = loadActiveRun(sid);
    if (!record) return;
    const resource = record.kind === "control" ? "control-runs" : "runs";
    fetch(`/api/sliderule/${resource}/${encodeURIComponent(record.runId)}`, {
      method: "DELETE",
    }).catch(() => {});
    clearActiveRun(sid);
  }, [sessionState.sessionId, sessionId]);

  const runTurn = async (
    userText: string,
    intervention?: UserIntervention,
    // E25 续播：附着到既有后台 run（刷新/断线后自动接回），不重新发起推演
    resumeRun?: { runId: string; kind?: "control" },
    // E26 缺口修复轮：只重跑覆盖门标红的能力，已 PASS 产物原样复用
    mode?: "repair",
    forcedTool?: string
  ) => {
    if (!userText.trim()) return;

    if (isRunningRef.current) {
      // 运行中再入是排队层的事，这里 fail-closed 拒第二发，不杀工厂。
      // ⚠ 不许在这里把 pendingForcedToolRef 清掉：确认继续排队等 finally
      //   flush，flag 必须留到下一次真正进闸的 runTurn。
      return;
    }

    // 抄 grok NeedUserAnswer：问卷和计划审批是当前请求的回执，
    // 不是用户又说了一句。新气泡会把「精修（refine）」画成原话。
    const pendingNeed = pendingAskRef.current;
    const stamped = pendingToolAnswerRef.current;
    pendingToolAnswerRef.current = undefined;
    const parkedAsk =
      sessionStateRef.current.awaitReason === "control_ask" || Boolean(pendingNeed);
    const toolAnswer = pendingNeed
      ? {
          kind: "ask_user",
          text: userText.trim(),
          ...(pendingNeed.reqId ? { reqId: pendingNeed.reqId } : {}),
        }
      : stamped
        ? {
            kind: stamped.kind,
            text: stamped.text || userText.trim(),
            ...(stamped.reqId ? { reqId: stamped.reqId } : {}),
            ...(stamped.outcome ? { outcome: stamped.outcome } : {}),
            ...(stamped.answers ? { answers: stamped.answers } : {}),
            ...(stamped.notes ? { notes: stamped.notes } : {}),
            ...(stamped.feedback ? { feedback: stamped.feedback } : {}),
          }
        : parkedAsk
          ? { kind: "ask_user", text: userText.trim() }
          : /^「[^」]+」答：/.test(userText)
            ? { kind: "clarify", text: userText.trim() }
            : undefined;
    if (pendingNeed) {
      pendingAskRef.current = null;
      setPendingAsk(null);
    }
    // 续播 / 芯片 typed 答案不另起用户气泡（「精修（refine）」不是人新说的一句）。
    // 开放回执（停在「想做什么应用」时打的字）必须看见——第 3 格是纸条，
    // 不是把字吞掉（2026-09-09 真机：sdgdfgfd 发出去左栏空白）。
    const skipUserBubble =
      Boolean(resumeRun) || isContinuationTurn(userText);
    const hop = forcedTool || pendingForcedToolRef.current;
    pendingForcedToolRef.current = undefined;
    // 跟后面 POST 的 inferForcedTool 同一把尺子。问候/提问不是 WRITE，
    // 钟保持 idle——抄 grok：Progress 跟工具走，不是一按发送就铺六格。
    const sfpAtStart =
      (
        sessionState as {
          specFirstPages?: { spec?: unknown; pages?: Record<string, unknown> };
        }
      ).specFirstPages || {};
    const firstPassAtStart =
      !sfpAtStart.spec && Object.keys(sfpAtStart.pages || {}).length === 0;
    const earlyTool = toolAnswer?.kind === "plan_approval" ? undefined : inferForcedTool(
      userText,
      intervention,
      mode,
      hop,
      firstPassAtStart
    );
    const factoryLit = isFactoryWriteTool(earlyTool);

    let turnId = `turn-${Date.now()}`;
    const turnStartMs = Date.now(); // E16 收口句：本轮真实计时
    const controller = new AbortController();
    abortControllerRef.current = controller;
    controlActivityRef.current += 1;
    isRunningRef.current = true;
    setIsRunning(true);
    // ⚠ 必须跟 setIsRunning(true) 同一拍清掉上一轮「汇合过闸」。
    // 廉价回合用 idle，不许 startRehearsalCursor 把第 2 格点成 current
    // （2026-09-08 真机：发「你好」右栏演规划第一轮）。
    if (factoryLit) {
      rehearsalCursorRef.current = startRehearsalCursor();
      setRehearsalCursor(startRehearsalCursor());
    } else {
      rehearsalCursorRef.current = idleRehearsalCursor();
      setRehearsalCursor(idleRehearsalCursor());
    }

    // E13：直播步骤同步攒进本地数组——轮次落定时随 PUT 写进
    // state.turnNarrations（刷新后回放时间线；setUiTurns 是异步状态，
    // 落定时刻从它读不到完整清单）
    const collectedSteps: TurnStep[] = [];
    /** 本轮已经在左栏报过的页面。同一页第二次到达不再追加一条芯片。 */
    const announcedPages = new Set<string>();
    const hostSpeechRef = { current: "" };
    const controlFailureRef = { current: "" };
    lastControlStopRef.current = null;
    const appendStep = (step: TurnStep) => {
      collectedSteps.push(step);
      setUiTurns(prev =>
        prev.map(t =>
          t.id === turnId ? { ...t, steps: [...t.steps, step] } : t
        )
      );
    };

    const turnTimestamp = new Date().toISOString();

    const patchRoute = (
      patch: Partial<UiTurn["routeFacts"]>,
      litCount?: number
    ) => {
      setUiTurns(prev =>
        prev.map(t => {
          if (t.id !== turnId) return t;
          const routeFacts = { ...t.routeFacts, ...patch };
          const derived = deriveTurnRoute(routeFacts);
          return {
            ...t,
            routeFacts,
            routeLitCount: litCount ?? derived.length,
          };
        })
      );
    };

    // 续播 / 提问回执都不是用户又说了一句。新气泡会把
    // 「（续播上一轮推演）」或「精修（refine）」画成原话。
    if (skipUserBubble) {
      const last = uiTurnsRef.current[uiTurnsRef.current.length - 1];
      if (last) {
        turnId = last.id;
        setUiTurns(prev =>
          prev.map(t => (t.id === turnId ? { ...t, status: "streaming" } : t))
        );
      } else {
        setUiTurns(prev => [
          ...prev,
          {
            id: turnId,
            user: "",
            status: "streaming",
            steps: [],
            routeFacts: { turnId, timestamp: turnTimestamp },
            routeExpanded: true,
            routeLitCount: 1,
            assistant: "",
            assistantSource: "fallback",
            main: null,
            actions: [],
          },
        ]);
      }
    } else {
      setUiTurns(prev => [
        ...prev,
        {
          id: turnId,
          user: userText.trim(),
          status: "streaming",
          steps: [],
          routeFacts: { turnId, timestamp: turnTimestamp },
          routeExpanded: true,
          routeLitCount: 1,
          assistant: "",
          assistantSource: "fallback",
          main: null,
          actions: [],
        },
      ]);
    }

    try {
      const driveSid = assertDriveSessionMatchesShell(
        sessionState.sessionId,
        sessionId
      );
      const loadedState = {
        ...preservePythonEvidenceProjection(
          sanitizeLegacyEmptySeed(
            await SlideRuleRuntime.loadOrCreateSessionState(driveSid)
          )
        ),
        sessionId: driveSid,
      };

      // PR-3：禁用已闭环会话上 looksLikeNewAppIntent 自动重置。
      // 静默清会话会让范围卡上点「开始推演」同意的是一份已经不在的旧话题。
      // M7 控制面会显式问「新应用还是变体？」再决定是否重置。
      // 闭环后追问仍明示，避免秒回 closed 6/6 被读成假装推演。
      let workingState = loadedState;
      let closedTopicFollowUp = false;
      if (
        !IS_GITHUB_PAGES &&
        !intervention &&
        !resumeRun &&
        // E26 修复轮是对本话题缺口的补跑，永远不是新话题/闭环后追问
        mode !== "repair" &&
        isClosedSessionState(loadedState)
      ) {
        closedTopicFollowUp = true;
      }

      const goalStatusBefore = workingState.goal?.status;
      const staleArtifactIdsBefore = [...(workingState.staleArtifactIds || [])];

      // M1：cheap 回合禁止把问候/inspect/search 写进 conversation。
      // 控制面 POST 以已持久化会话为权威起点；质疑失效在 Python 做。
      // 续播同样不 intake。
      let preparedState = applyAnsweredGapsToState(
        workingState,
        intervention
      );

      const activeGoalText =
        preparedState.goal?.text?.trim() || userText.trim();
      applyPersistedState(preparedState);

      const challengeArt = intervention?.targetArtifactId
        ? (loadedState.artifacts || []).find(
            a => a.id === intervention.targetArtifactId
          )
        : undefined;

      patchRoute(
        {
          goalStatusBefore,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
          goalStatusAfterInvalidate: preparedState.goal?.status,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
        },
        deriveTurnRoute({
          turnId,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
          goalStatusBefore,
          goalStatusAfterInvalidate: preparedState.goal?.status,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(preparedState.staleArtifactIds || [])],
        }).length
      );

      if (factoryLit) {
        setLiveAction({ label: "正在规划本轮动作...", external: false });
      } else {
        setLiveAction({ label: "正在想…", external: false });
      }

      const firstLoopPlanCountRef = { value: 0 };
      const driveLoopsRef: SlideRuleRuntime.DriveReasoningResult["loops"] = [];

      const imMode = resolveImSurfaceMode();
      const actionsAcc: ActionTrace[] = [];
      const uiExecutor = createUiCapabilityExecutor(
        SlideRuleRuntime.getCapabilityExecutor(),
        {
          userText: userText.trim(),
          goalText: activeGoalText,
          emitImSteps: imMode !== "minimal",
          onStep: appendStep,
          onActionTrace: trace => {
            actionsAcc.push(trace);
            setUiTurns(prev =>
              prev.map(t =>
                t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
              )
            );
          },
          setLiveAction,
        }
      );

      // Immediate reaction so user sees something right after pressing send (before any network)
      if (closedTopicFollowUp) {
        appendStep({
          id: `${turnId}-closed-followup`,
          kind: "chip",
          capabilityId: "intent.parse" as any,
          roleId: "system",
          label:
            "本话题已闭环，此轮按旧话题追问处理 · 要开始新应用请点右上角重置会话",
          realLlm: false,
          loopTurnId: turnId,
          progressType: "thinking",
        });
      }
      // ⚠ 2026-09-05：续跑的一轮**不报开场**。
      // ⚠ 2026-09-08：问候/提问也不是开场。抄 grok Progress 跟工具走——
      //   只有 WRITE（rehearse/spec/pages/…）才报「规划第一轮」。
      //   「你好」对 isContinuationTurn 是新原话，旧代码于是无条件演开工，
      //   模型其实只问了一句「我是面团的薄控制面」。
      if (factoryLit) {
        if (!isContinuationTurn(userText) && !toolAnswer) {
          appendStep({
            id: `${turnId}-intake`,
            kind: "chip",
            capabilityId: "intent.parse" as any,
            roleId: "system",
            label: "指令已接收 · 启动推理",
            realLlm: false,
            loopTurnId: turnId,
            progressType: "thinking",
          });
          setLiveAction({ label: "规划第一轮能力与路线...", external: false });
        } else {
          const writeHop = earlyTool || hop;
          const hopLabel = isFactoryHop(writeHop)
            ? FACTORY_HOP_LABELS[writeHop]
            : "";
          setLiveAction({
            label: hopLabel ? `接着上一跳：${hopLabel}` : "接着上一跳往下走",
            external: false,
          });
        }
      }

      // M2/M3/M4/M5/M6: driveMode selects single vs marathon thin layer.
      // Product path for marathon now uses driveMarathon (with budget enforcement and real M3/M6 ledger append).
      // Live callbacks forwarded to inner drives for UI updates.
      const driveOpts = {
        turnSeedId: turnId,
        userText: userText.trim(),
        intervention,
        router: IS_GITHUB_PAGES
          ? SlideRuleRuntime.createDeterministicRouter()
          : SlideRuleRuntime.createServerReasoningRouter(),
        executor: uiExecutor,
        maxLoopsPerMessage: resolveMaxLoopsPerMessage(),
        abortSignal: controller.signal, // M1
        onCapabilityRound: (payload: any) => {
          if (!payload.gateFailed && !payload.execFailed) return;
          const message = payload.gateFailed
            ? payload.gateMessage === "ground"
              ? "外部证据未接地 - 本轮转为规则推演"
              : `提交闸未通过${payload.gateMessage ? ` - ${payload.gateMessage}` : ""}`
            : "能力执行失败，可以重试";
          appendStep({
            id: `${payload.loopTurnId}-fail-gate-${payload.runIndex}`,
            kind: "capability_fail",
            capabilityId: payload.capabilityId,
            roleId: payload.roleId,
            loopTurnId: payload.loopTurnId,
            capabilityRunId: payload.runId,
            runIndex: payload.runIndex,
            message,
          });
        },
        onLoopComplete: async (p: any) => {
          const { state, plan, loopTurnId, committedArtifactIds, stopSignal } =
            p || {};
          driveLoopsRef.push({
            loopTurnId,
            plan,
            committedArtifactIds,
            stopSignal,
          });
          const derived = SlideRuleRuntime.deriveNodeStatus
            ? SlideRuleRuntime.deriveNodeStatus(state)
            : state;
          const loopPersisted = await persistSession(derived);
          applyPersistedState(loopPersisted);
          if (driveLoopsRef.length === 1) {
            firstLoopPlanCountRef.value = plan.selected.length;
          }
          const partialRounds = buildTurnRoundsFromDrive(
            loopPersisted.decisionLedger,
            {
              loops: driveLoopsRef,
              stopReason: "budget_exhausted",
            }
          );
          const partialFacts = {
            turnId,
            timestamp: turnTimestamp,
            interventionIntent: intervention?.intent ?? null,
            challengeTargetLabel: challengeTargetLabel(challengeArt),
            goalStatusBefore,
            goalStatusAfterInvalidate: preparedState.goal?.status,
            staleArtifactIdsBefore,
            staleArtifactIdsAfter: [...(loopPersisted.staleArtifactIds || [])],
            rounds: partialRounds,
            selectedCapabilities: driveLoopsRef.flatMap((l: any) =>
              l.plan.selected.map((s: any) => ({
                capabilityId: String(s.capabilityId),
                roleId: String(s.roleId || "agent"),
              }))
            ),
          };
          patchRoute(
            { rounds: partialRounds },
            deriveTurnRoute(partialFacts).length
          );
        },
      };

      let drive: any;
      let usedMarathonDriver = false;
      let driveErrored = false;
      try {
        if (driveMode === "marathon") {
          const { driveMarathon } =
            await import("@/lib/sliderule-marathon-driver");
          const marathonRes = await driveMarathon(
            preparedState,
            userText.trim(),
            {
              stopSignal: controller.signal,
              budget: {
                maxTokens: marathonBudget?.maxTokens || 12000,
                declaredAt: new Date().toISOString(),
              },
              policy: {
                autoConfirmRoute: "primary",
                autoWaiveNonBlockingGaps: true,
              },
              executor: driveOpts.executor,
              onCapabilityRound: driveOpts.onCapabilityRound,
              onLoopComplete: driveOpts.onLoopComplete,
              router: driveOpts.router,
              maxLoopsPerMessage: driveOpts.maxLoopsPerMessage,
            }
          );
          drive = {
            finalState: marathonRes.finalState,
            stopReason: marathonRes.stopReason,
            loops: [],
            publishClosure: marathonRes.publishClosure,
          };
          usedMarathonDriver = true;
        } else {
          const { classifyDriveFullStatus, postControlTurnStream } =
            await import("@/lib/sliderule-marathon-driver");
          setDriveFullStatus("loading");
          // PYTHON_AUTHORITY: /drive-full-stream 以已持久化会话为权威起点（防伪造，
          // 见 routes/sliderule_full.py drive_full_stream）。intake 后的 goal 必须先
          // 落盘，否则 Python 侧以旧的空 goal 推演，闭环 fail-closed 成 0/6。
          if (!resumeRun) {
            const persisted = await persistPreparedStateForDrive({
              persist: () => persistSession(preparedState),
              intent: intervention?.intent,
            });
            if (!persisted.ok) {
              const errMsg =
                persisted.error instanceof Error
                  ? persisted.error.message
                  : String(persisted.error ?? "persist failed");
              appendStep({
                id: `${turnId}-persist-fail`,
                kind: "capability_fail",
                capabilityId: "intent.parse" as any,
                roleId: "system",
                loopTurnId: turnId,
                capabilityRunId: `${turnId}-persist-fail`,
                runIndex: 0,
                message: `质疑未生效：会话未能保存，未启动推演（${errMsg.slice(0, 120)}）`,
              });
              setUiTurns(prev =>
                prev.map(t =>
                  t.id === turnId
                    ? {
                        ...t,
                        status: "complete",
                        durationMs: Date.now() - turnStartMs,
                        assistant: "质疑未生效：会话未能保存，未启动推演",
                        assistantSource: "fallback",
                      }
                    : t
                )
              );
              applyPersistedState(workingState);
              setDriveFullStatus("idle");
              return;
            }
            try {
              // 话题刚落盘：通知侧栏重拉列表，标题从"新会话"实时变成话题
              const { notifySessionsUpdated } =
                await import("@/pages/agent-loop/dashboard/SidebarSessions");
              notifySessionsUpdated();
            } catch {
              // 侧栏刷新失败不挡已经落盘的推演
            }
          }
          // Claude 式左栏实时叙事：把 SSE 事件翻成人话喂进本轮 steps
          // （TurnStepsDisclosure 流式显示最近几步，可展开全程）。
          // 此前这些事件只点亮右栏缩略图，左栏推演全程只有一枚 intake chip。
          const { CAPABILITY_PROCESS_LABELS } =
            await import("@shared/blueprint/capability-process-labels");
          const SKILL_STREAM_LABELS: Record<string, string> = {
            dataModel: "数据模型",
            workflow: "工作流",
            rbac: "角色权限",
            page: "页面",
            aigc: "AI 能力",
            appBundle: "应用装配",
          };
          let streamStepSeq = 0;
          /**
           * 把一条 SSE 事件翻成左栏的一枚 chip。
           *
           * ⚠ `capabilityId` 必须由调用方给真的（2026-08-16 线上实测）。
           *
           * 此前这里写死 `"intent.parse" as any`，于是真机一轮 79 条步骤
           * **每一条都标着 intent.parse、realLlm 全 false**，而那一轮实际跑了
           * 27 个能力（gap.ask 9.1s · structure.decompose 12.1s ·
           * appbundle.runtimeClosure 148.3s …）。用户看到的是"正在理解你的
           * 目标"滚了七十多遍——屏幕上像卡在第一步，实际早跑到生成应用了。
           *
           * 那个 `as any` 就是记号：类型要一个能力 id，而这里没有，于是拿第一个
           * 顶上。真正的信息一直在调用点手里（onReasoningStep 的第一个参数就是
           * 能力 id），只是没往下传。
           *
           * 默认值保留 intent.parse：确实说不出属于哪个能力的系统提示（"指令已
           * 接收"之类）维持原样，不为了消灭 `as any` 而编一个假的归属。
           */
          const appendStreamStep = (
            label: string,
            opts?: {
              capabilityId?: string;
              realLlm?: boolean;
              progressType?: "thinking" | "acting" | "observing" | "completed" | "failed";
              /** 工程动作的结构化细节；见 types.ts 上 projectDetail 的说明。 */
              projectDetail?: string;
              /** 远端操作 id；「它的电脑」靠它订阅命令行输出。 */
              operationId?: string;
            }
          ) => {
            streamStepSeq += 1;
            appendStep({
              id: `${turnId}-stream-${streamStepSeq}`,
              kind: "chip",
              capabilityId: (opts?.capabilityId || "intent.parse") as any,
              roleId: "system",
              label,
              realLlm: Boolean(opts?.realLlm),
              loopTurnId: turnId,
              progressType: opts?.progressType || "thinking",
              ...(opts?.projectDetail ? { projectDetail: opts.projectDetail } : {}),
              ...(opts?.operationId ? { operationId: opts.operationId } : {}),
            });
          };
          /**
           * 模型动手之前对用户说的那段话，进正文段落而不是芯片行。
           *
           * ⚠ 不复用 `appendStreamStep`：那个产 `kind: "chip"`，会被
           * `linesFromTurnSteps` 收进左栏活动列表，于是模型散文跟
           * 「第 1 轮 · 正在执行 planning」排成同等分量的一行——正是
           * 这次要修的观感。见 `model-speech.ts` 头注。
           */
          const appendModelSpeech = (text: string) => {
            streamStepSeq += 1;
            appendStep({
              id: `${turnId}-speech-${streamStepSeq}`,
              kind: "model_speech",
              text,
            });
          };
          setLlmDraft("");
          setLlmDraftLabel(null);
          setLlmStreams([]);
          if (factoryLit) {
            rehearsalCursorRef.current = startRehearsalCursor();
            setRehearsalCursor(startRehearsalCursor());
          }
          // ⚠ 新一轮清空：不清的话右侧会先亮上一轮的页面，而用户刚说的是
          //   "改成 XXX"——看着像改完了，其实一个字都还没动。
          setSpecPages([]);
          // 每一步 LLM 想法各自缓冲：并行批里不同能力的增量交织到达，
          // 按标签分开累积，展示最近更新的那条（不互相覆盖内容）。
          const llmDraftBuffers = new Map<string, string>();
          // key → 后端给的人话。收尾归档（llm_output）时还要用一次。
          const llmStageLabels = new Map<string, string>();
          // spec-first 流式步的实时输出。对照 GitHub Actions 的 name vs id：
          // SSE `label` 是机器 id，左栏只许出现人话。
          //
          // ⚠ 2026-08-30：这里原本有一张 `SPEC_FIRST_LLM_LABELS` 手抄表（7 条）。
          //   它自己的注释写着病灶：「跟后端 delta_emitter 传的 label 是同一份
          //   词汇的两半，而它俩隔着一条 SSE，谁也编译不到谁。漏一个的后果不是
          //   报错，是左栏冒出 'LLM 正在执行 specfirst.design'」——2026-08-19
          //   安康随访通就是这么漏的。
          //
          //   **表删了。** 后端事件现在自带 `stageLabel`（来自
          //   slide-rule-python/services/data/pipeline_stages.json 那本账），
          //   抄的是 grok 的 typed session events：前端不该有翻译表，
          //   事件自己带人话。后端加一步，左栏自动显示，不用改这里。
          //
          //   非 spec-first 的 key（five-system-model / 能力 id）仍走下面的兜底，
          //   那些不是流水线阶段，不在阶段账本里。
          const humanLlmLabel = (key: string, stageLabel?: string): string => {
            // 后端账本给的人话优先——这是唯一真相源。
            if (stageLabel) return `LLM 正在${stageLabel}`;
            if (key === "five-system-model") return "LLM 正在起草五系统模型";
            if (key === "closure.summary") return "LLM 正在整理推演总结";
            // 不流式的步（pages / bind）也会走 reasoning_step，人话表兜住。
            if (SPEC_FIRST_LIVE_LABELS[key]) {
              return `LLM 正在${SPEC_FIRST_LIVE_LABELS[key]}`;
            }
            const entry = (
              CAPABILITY_PROCESS_LABELS as Record<
                string,
                { liveLabel?: unknown }
              >
            )[key];
            const live =
              typeof entry?.liveLabel === "function"
                ? (entry.liveLabel as (ctx: object) => string)({})
                : (entry?.liveLabel as string | undefined);
            return live
              ? `LLM ${live.replace(/^⚡\s*/, "")}`
              : `LLM 正在执行 ${key}`;
          };
          // GitHub Pages 静态演示：无 Python 后端，同一套 SSE 回调改走
          // 模板回放（真实 LLM 推演一次性捕获，见 github-pages-demo-playback.ts），
          // 避免必失败的 /drive-full-stream 请求 + 空结果收尾。
          const driveStream = IS_GITHUB_PAGES
            ? (await import("./github-pages-demo-playback"))
                .driveGithubPagesDemoPlayback
            : postControlTurnStream;
          // E25：发起与续播共用同一组回调——同一事件词表喂同一 UI
          const resolvedSid = assertDriveSessionMatchesShell(
            preparedState.sessionId || sessionState.sessionId,
            sessionId
          );
          let runSettledReason:
            | "complete"
            | "cancelled"
            | "error"
            | null = null;
          // 后端 run 到底建起来没有（2026-08-10 加）。
          //
          // 它是"流断了之后能不能落本地兜底"的**唯一正确判据**：
          //   见过 runId  → 后端已经有一个 run 在跑 → 本地再跑一遍就是双开；
          //   没见过      → 连 run 都没建起来（Python 后端没起/直接 500）→
          //                 本地兜底是正当降级，那条路必须留着。
          //
          // 下面那道守卫原来只写了 `resumeRun &&`，只护住了续播分支。首发流
          // 中途断线时 resumeRun 是假、runSettledReason 也是 null（服务端好好
          // 的，压根没宣布终局），两道守卫全跳过，直接落进本地引擎——正是
          // 那段注释明令禁止的"与后台 run 双开"。
          //
          // 实测踩到过：2026-08-10 一趟推演的 POST 流在第 2 分钟被对端 reset，
          // 而服务端一路跑到 seq 1812 正常收尾。前端在那一刻会把整轮重跑一遍。
          const clockLitRef = { current: factoryLit };
          const ensureFactoryClock = (tool?: string) => {
            if (clockLitRef.current) return;
            if (tool && tool !== "factory" && !isFactoryWriteTool(tool)) return;
            clockLitRef.current = true;
            rehearsalCursorRef.current = startRehearsalCursor();
            setRehearsalCursor(startRehearsalCursor());
          };
          let sawRunId = false;
          // 这条流见过终局事件吗。消费者读到 done 却没收到 complete /
          // run_cancelled / error 就是协议违规（见 driver 的
          // STREAM_NO_TERMINAL 头注），不能跟"正常收尾"走同一条出口。
          let sawTerminal = true;
          const streamOpts = {
              stopSignal: controller.signal,
              turnId,
              ...(mode === "repair" ? { mode } : {}),
              onControlRunId: (runId: string) => {
                sawRunId = true;
                saveActiveRun(resolvedSid, {
                  runId, kind: "control", userText: userText.trim(),
                  startedAt: new Date().toISOString(),
                });
              },
              onRunId: (runId: string) => {
                sawRunId = true;
                ensureFactoryClock("factory");
                if (loadActiveRun(resolvedSid)?.kind === "control") return;
                // 后端 run 书签：刷新/跳页回来据此续播接回
                saveActiveRun(resolvedSid, {
                  runId,
                  userText: userText.trim(),
                  startedAt: new Date().toISOString(),
                });
              },
              onControlContinuation: event => {
                // 显式标记落成一个 step：`turnHasContinuationMark` 认它，
                // 折叠因此在「没有用户文本」的自动续跑上也成立。
                streamStepSeq += 1;
                appendStep({
                  id: `${turnId}-continuation-${streamStepSeq}`,
                  kind: "continuation_mark",
                  attempt: event.attempt,
                  ...(event.blockedReasons.length
                    ? { blockedReasons: event.blockedReasons.slice(0, 6) }
                    : {}),
                });
              },
              onControlToolStart: (tool: string, summary?: string, operationId?: string) => {
                ensureFactoryClock(tool);
                const projectLabel = projectToolLabel(tool);
                if (projectLabel) {
                  // 开场就带上「在对什么动手」（服务端脱敏摘要），动作进行中的
                  // 那几十秒界面不再是哑的。拿不到就不带，不自己拼。
                  // execute 刚返回时会再来一发带 operationId，合进开着的行，
                  // 「它的电脑」才能订上正在打字的 PTY。
                  const detail = String(summary || "").trim();
                  const op = String(operationId || "").trim();
                  setLiveAction({
                    label: detail ? `${projectLabel}：${detail}` : projectLabel,
                    external: true,
                  });
                  appendStreamStep(projectLabel, {
                    capabilityId: tool,
                    progressType: "acting",
                    ...(detail ? { projectDetail: detail } : {}),
                    ...(op ? { operationId: op } : {}),
                  });
                  return;
                }
                if (isFactoryWriteTool(tool)) {
                  const label = isFactoryHop(tool)
                    ? FACTORY_HOP_LABELS[tool]
                    : tool;
                  setLiveAction({ label, external: false });
                }
              },
              onControlToolResult: (event: Record<string, unknown>) => {
                const tool = projectToolLabel(event.tool);
                if (!tool) return;
                const ok = event.ok !== false;
                const stillOpen = projectToolStillOpen(event);
                const detail = typeof event.error === "string"
                  ? event.error
                  : typeof event.message === "string" ? event.message : "";
                const label = !ok
                  ? `${tool.replace(/^正在/, "执行失败：")}`
                  : stillOpen
                    ? tool
                    : `${tool.replace(/^正在/, "已")}`;
                setLiveAction({ label: detail ? `${label}（${detail}）` : label, external: true });
                // 后端把整个工具返回体摊进了事件（`**body`）：command / exitCode /
                // revision / parentRevision / errorCode 都在。原来只读 ok/error，
                // 其余全扔，于是工程动作流只剩「已运行命令」这种没有信息量的行。
                appendStreamStep(detail ? `${label}：${detail}` : label, {
                  capabilityId: String(event.tool || ""),
                  progressType: !ok ? "failed" : stillOpen ? "acting" : "completed",
                  projectDetail: projectActionDetail(event),
                  // 「它的电脑」靠它订阅沙箱命令行输出；服务端一直在发，
                  // 前端此前丢掉了（见 types.ts 上 operationId 的说明）。
                  ...(typeof event.operationId === "string" && event.operationId
                    ? { operationId: event.operationId }
                    : {}),
                });
              },
              onControlProjectState: (project: {
                sessionId: string; runtimeKind: "project"; projectId: string; projectRevision: string;
              }) => {
                // 2026-09-13: project_create persisted successfully while the
                // live shell stayed on HTML until the long model turn ended.
                // Consume only the server's durable references; keep the
                // current conversation and running turn, and perform no GET.
                if (controller.signal.aborted || project.sessionId !== resolvedSid
                    || projectEntrySessionRef.current !== resolvedSid
                    || sessionStateRef.current.sessionId !== resolvedSid) return;
                preparedState = { ...preparedState, ...project };
                applyPersistedState({ ...sessionStateRef.current, ...project });
              },
              onControlState: (state: V5SessionState) => {
                if (controller.signal.aborted || state.sessionId !== resolvedSid
                    || projectEntrySessionRef.current !== resolvedSid) return;
                preparedState = preservePythonEvidenceProjection(state);
                applyPersistedState(preparedState);
              },
              onStreamNoTerminal: () => {
                // 断流：书签**不清**——后端 run 多半还在跑，书签是刷新后
                // 自动接回的唯一线索（跟 onRunSettled 相反，那里才清）。
                sawTerminal = false;
              },
              onRunSettled: (
                reason: "complete" | "cancelled" | "error"
              ) => {
                // 服务端宣布 run 终局才清书签；纯断连（刷新/跳页）不清——
                // run 还在后台跑，书签是下次进入自动续播的唯一线索
                runSettledReason = reason;
                clearActiveRun(resolvedSid);
              },
              onLlmDelta: (text: string, label?: string, stageLabel?: string) => {
                const key = label || "five-system-model";
                if (stageLabel) llmStageLabels.set(key, stageLabel);
                const firstSight = !llmDraftBuffers.has(key);
                llmDraftBuffers.set(
                  key,
                  (llmDraftBuffers.get(key) || "") + text
                );
                if (firstSight) {
                  const human = humanLlmLabel(key, stageLabel);
                  // 这一条是真·LLM 在吐字（onLlmDelta 就是流式增量），
                  // realLlm 打真的——左栏靠它把"模型在想"和"系统在报进度"
                  // 用不同颜色分开（TurnRouteTimeline 那个 text-[#0958d9]）。
                  appendStreamStep(`🖋 ${human}（实时输出见下方）...`, {
                    realLlm: true,
                  });
                  setLiveAction({ label: `${human}...`, external: false });
                }
                setLlmDraftLabel(key);
                setLlmDraft(llmDraftBuffers.get(key) || "");
                setLlmStreams(
                  Array.from(llmDraftBuffers, ([label, text]) => ({
                    label,
                    text,
                  }))
                );
              },
              onQualityNotice: note => {
                appendStreamStep(note.text);
                setSessionState(prev => {
                  const sp =
                    prev.specFirstPages && typeof prev.specFirstPages === "object"
                      ? { ...prev.specFirstPages }
                      : {};
                  const prevNotes = Array.isArray((sp as { qualityNotices?: unknown }).qualityNotices)
                    ? ([...(sp as { qualityNotices: unknown[] }).qualityNotices] as Array<{
                        kind: string;
                        text: string;
                      }>)
                    : [];
                  if (prevNotes.some(n => n.text === note.text)) return prev;
                  return {
                    ...prev,
                    specFirstPages: {
                      ...sp,
                      qualityNotices: [...prevNotes, note],
                    },
                  };
                });
              },
              onSpecPage: page => {
                applyRehearsalEvent(
                  "spec_page_html",
                  (page as { productStep?: number }).productStep ?? 3
                );
                // 同一页第二次到达（第 6.5 步打完孔）——覆盖，不是追加。
                // 规则跟下面的改名住在同一个模块里：它们是同一条"按 pageId
                // 认卡"规则的两半，分开放迟早只改一半（见那边头注）。
                setSpecPages(prev => upsertSpecPageCard(prev, page));
                // ⚠ 2026-09-05：上面那行「覆盖，不是追加」的纪律，下面这行
                //   **没跟上**——页面覆盖了，左栏却又追加一条一模一样的芯片。
                //   真机 sr-20260905004750 第 3 轮：五页的「🖼 界面已出」连着
                //   出现两遍，编号顺序逐字相同（id 全是 turn-…-stream-N，
                //   两遍都来自这里）。这就是本仓 §4「只改一半必然静默失效」：
                //   不报错、不告警，只是左栏多出一份。
                // ⚠ 判「第一次到达」不能读 setSpecPages 的更新函数里的标记：
                //   那个函数是渲染时才跑的，读的时候它还没执行过——写成那样
                //   等于永远都算第一次，什么都没修。用本轮作用域的集合，同步。
                if (!announcedPages.has(page.pageId)) {
                  announcedPages.add(page.pageId);
                  appendStreamStep(
                    `🖼 界面已出：${page.pageId}（${page.current}/${page.total}）`
                  );
                }
              },
              // 服务端第 4.5 步把草稿 id 改成语义 id（p1 → seat_selection）。
              //
              // ⚠ 上面那句「同一页第二次到达——覆盖，不是追加」的前提是
              //   **pageId 一直没变**。改名一发生这个前提就破了：第 6.5 步把
              //   同样六页再推一遍、但 id 已经换了，`findIndex` 找不到，于是走
              //   `[...prev, page]` 追加。真机 sr-20260906111901 的后果是画布
              //   12 张卡对应 6 个页面，前 6 张素颜、未打孔、点不动，左栏
              //   「🖼 界面已出」也出了 12 条。
              //
              // ⚠ 这条事件**一定先于**改名后那批 spec_page 到达（服务端让改名
              //   和页面走同一条队列，先后由队列保证）。所以这里只做一件事：
              //   把已有那张卡的键换掉，让后面那批页照常覆盖它。
              //   照 grok FileEvent::Renamed 的 `requires_reparse() => false
              //   // Only path update needed`——只换键，HTML 一个字都不动。
              onSpecPageRenamed: ({ from, to }) => {
                setSpecPages(prev => renameSpecPageCard(prev, from, to));
                // ⚠ 芯片集合必须跟着改键，否则 6.5 那批用新 id 一问
                //   `has(to)` 是 false，左栏再追加一遍「界面已出」——就是
                //   2026-09-05 那个"只改一半"的坑，换个入口重演一次。
                renameAnnouncedPage(announcedPages, from, to);
              },
              onReasoningStep: (capabilityId, loop, productStep) => {
                applyRehearsalEvent(capabilityId, productStep);
                const human = humanReasoningStepLabel(capabilityId);
                const label =
                  typeof loop === "number"
                    ? `第 ${loop + 1} 轮 · ${human}`
                    : human;
                // 真实能力 id 就在第一个参数上——这里是那 65 条 chip 的
                // 主要来源，写死 intent.parse 的代价全在这一行上。
                appendStreamStep(label, { capabilityId: capabilityId });
                setLiveAction({ label: human, external: false });
              },
              onSkillActivated: (skillId, _label) => {
                applyRehearsalEvent(skillId);
                setActiveSkillId(skillId);
                const name = SKILL_STREAM_LABELS[skillId] || skillId;
                appendStreamStep(`⚙ ${name} 系统画面生成中...`);
                setLiveAction({
                  label: `${name} 系统生成中...`,
                  external: false,
                });
              },
              onSkillCompleted: (skillId, _hasError, detail) => {
                const name = SKILL_STREAM_LABELS[skillId] || skillId;
                appendStreamStep(
                  _hasError
                    ? `✗ ${name} 证据缺失（fail-closed）`
                    : `✓ ${name} 证据落地${
                        detail?.artifactId?.startsWith("llm-linkage-")
                          ? " · LLM 生成"
                          : ""
                      }`
                );
                // Accumulate per-skill content for the right-panel screens:
                // mermaid (cross-skill edge projection) first, then the gate-PASSED
                // five-system model section as a fenced JSON block. The screens'
                // extractMermaid/extractFlow read the leading mermaid; the
                // five-system-model parser reads the fenced JSON. Deterministic
                // domains carry no modelSection — screens degrade honestly.
                const mermaid = detail?.mermaid ?? null;
                const modelSection = detail?.modelSection ?? null;
                const parts: string[] = [];
                if (mermaid) parts.push(mermaid);
                if (modelSection && typeof modelSection === "object") {
                  // skillId → model key: dataModel→datamodel, appBundle→appbundle, rest identity.
                  const modelKey = skillId.toLowerCase();
                  try {
                    parts.push(
                      "```json\n" +
                        JSON.stringify({ [modelKey]: modelSection }) +
                        "\n```"
                    );
                  } catch {
                    // unserializable — keep mermaid-only content
                  }
                }
                if (parts.length > 0) {
                  const content = parts.join("\n\n");
                  setSkillContents(prev => ({ ...prev, [skillId]: content }));
                }
                if (mermaid) {
                  setLatestMermaid(mermaid);
                }
              },
              onProgressHeartbeat: (stage, _label, productStep) => {
                if (stage) applyRehearsalEvent(stage, productStep);
              },
              onFactoryPlan: (tools, workflow, productSteps, decision) => {
                setSessionState(prev => {
                  const goal = {
                    text: "",
                    status: "needs_refinement" as const,
                    ...(prev.goal && typeof prev.goal === "object"
                      ? prev.goal
                      : {}),
                  };
                  goal.tools = tools;
                  // ⚠ tools 与 productSteps 必须同进同出：只写 tools 的话，
                  //   减完菜那轮钟面会按上一轮的格子画（表删掉之后没人兜底了）。
                  if (productSteps && productSteps.length > 0) {
                    goal.productSteps = productSteps;
                  }
                  if (workflow) goal.workflow = workflow;
                  // 开局那一发没有 decision。有理由才进账本——缺席不许伪造。
                  if (!decision?.rationale && !(decision?.chose || []).length) {
                    return { ...prev, goal };
                  }
                  const loop = decision?.loop ?? 0;
                  const entry = {
                    id: `dec-${loop}-agentic-pick${
                      decision?.source === "heuristic_fallback" ? "-fallback" : ""
                    }`,
                    turnId: `loop-${loop}`,
                    saw: decision?.saw || [],
                    chose: decision?.chose || [],
                    skipped: [] as Array<{ capabilityId: string; reason: string }>,
                    addresses: [] as string[],
                    rationale: decision?.rationale || "",
                    alternativesRejected: [] as string[],
                    createdAt: new Date().toISOString(),
                    source: decision?.source,
                  };
                  const ledger = [...(prev.decisionLedger || [])].filter(
                    d => d.id !== entry.id
                  );
                  ledger.push(entry);
                  return { ...prev, goal, decisionLedger: ledger };
                });
                appendStreamStep(`编排 ${tools.join(" → ")}`);
              },
              onControlTodo: payload => {
                // 2026-09-15：清单写进 state，浮层读同一份。再往左栏
                // 塞 `📋 ${line}` 就是用户对照 Manus 圈出来的「嵌在聊天里」。
                const todos = visiblePlanTodo(payload.todos);
                setSessionState(prev => {
                  const next = { ...prev, controlTodo: todos };
                  sessionStateRef.current = next;
                  return next;
                });
              },
              onControlText: (text, stop) => {
                // 结构化的「为什么停」先落下来再渲染文字：拿它区分"我们的闸拦的"
                // （再试可能有用）和"网关挂了"（再试一百次也一样）。
                // 服务端已经把 stoppedBy 推导好了，这里不许再推一遍（§4）。
                if (stop) lastControlStopRef.current = stop;
                if (stop && ["llm_unavailable", "unknown"].includes(stop.stopReason)) controlFailureRef.current = text.trim();
                if (!text.trim()) return;
                // 「为什么停」留在左栏时间线里——用户已经习惯去那儿找停因，
                // 把它挪进正文段落等于换了个地方藏。
                if (stop) {
                  // ⚠ 带上 limit/used：服务端特意量了这两个数，以前只写进
                  //   lastControlStopRef 就没了下文（见 control-stop.ts 头注）。
                  appendStreamStep(controlStopLine(text, stop));
                  return;
                }
                // 动手之前的开口走正文段落（model-speech 头注）。
                appendModelSpeech(text);
              },
              onControlHostText: text => {
                hostSpeechRef.current = text.trim();
              },
              onControlAskUser: event => {
                if (event.reqId && handledRequestIdsRef.current.has(event.reqId)) return;
                const previousPlan = pendingPlanApprovalRef.current;
                if (previousPlan) handledRequestIdsRef.current.add(previousPlan.reqId);
                pendingPlanApprovalRef.current = null;
                setPendingPlanApproval(null);
                const next = {
                  question: event.question,
                  options: event.options,
                  ...(event.questions?.length ? { questions: event.questions } : {}),
                  ...(event.reqId ? { reqId: event.reqId } : {}),
                };
                pendingAskRef.current = next;
                setPendingAsk(next);
                const q = String(event.question || "").trim();
                // 已经有 control_text 开口时不要盖成同一句提问。
                if (q && !hostSpeechRef.current) hostSpeechRef.current = q;
                setLiveAction(null);
              },
              onControlClarify: event => {
                // ⚠ 2026-08-31 真机：事件发了、消费侧没有 case，左栏空转
                // 「规划第一轮能力与路线…」，ClarificationCard 要等 isRunning
                // 翻 false 才读 coverageGaps。事件自己带题，当场画卡。
                setLiveAction(null);
                applyRehearsalEvent(
                  "intent.clarify",
                  event.productStep ?? 1
                );
                const questions = Array.isArray(event.questions)
                  ? event.questions
                  : [];
                const now = new Date().toISOString();
                const incoming: CoverageGap[] = questions.flatMap(
                  (row, index) => {
                    const prompt = String(row.prompt || "").trim();
                    if (!prompt) return [];
                    const clarifyType: CoverageGap["clarifyType"] =
                      row.type === "multi_choice" ||
                      row.type === "single_choice" ||
                      row.type === "free_text"
                        ? row.type
                        : undefined;
                    return [
                      {
                        id: String(row.id || `gap-q-live-${index}`),
                        kind: "open_question",
                        label: prompt,
                        status: "open",
                        createdAt: now,
                        reason: "control_plane_clarify",
                        clarifyType,
                        options: Array.isArray(row.options)
                          ? row.options.map(item => String(item))
                          : undefined,
                        defaultAnswer: row.defaultAnswer
                          ? String(row.defaultAnswer)
                          : undefined,
                        context: row.context
                          ? String(row.context)
                          : undefined,
                        clarifyKind: row.kind ? String(row.kind) : undefined,
                        kindLabel: row.kindLabel
                          ? String(row.kindLabel)
                          : undefined,
                      },
                    ];
                  }
                );
                setSessionState(prev => {
                  const existing = prev.coverageGaps || [];
                  const seen = new Set(existing.map(gap => gap.id));
                  return {
                    ...prev,
                    awaitReason: "control_clarify",
                    awaitDetail: String(
                      questions[0]?.prompt || prev.awaitDetail || ""
                    ),
                    coverageGaps: [
                      ...existing,
                      ...incoming.filter(gap => !seen.has(gap.id)),
                    ],
                  };
                });
              },
              onControlPlanApproval: (event: ControlPlanApprovalWire) => {
                if (handledRequestIdsRef.current.has(event.reqId)) return;
                const previousPlan = pendingPlanApprovalRef.current;
                if (previousPlan && previousPlan.reqId !== event.reqId) {
                  handledRequestIdsRef.current.add(previousPlan.reqId);
                }
                if (pendingAskRef.current?.reqId) {
                  handledRequestIdsRef.current.add(pendingAskRef.current.reqId);
                }
                pendingAskRef.current = null;
                setPendingAsk(null);
                pendingPlanApprovalRef.current = event;
                setPendingPlanApproval(event);
                setLiveAction(null);
              },
          } satisfies import("@/lib/sliderule-marathon-driver").DriveFullStreamOpts;
          // 续播只 GET /runs/{id}/stream，禁止 POST control-turn-stream。
          // 首轮 = 会话里既没 SPEC 也没页面。跟后端 resolve_forced_tool 的
          // first_pass 同一个口径（§4 成对物，两边必须一起判）。
          const sfpNow =
            (preparedState as { specFirstPages?: { spec?: unknown; pages?: Record<string, unknown> } })
              .specFirstPages || {};
          const firstPassNow =
            !sfpNow.spec && Object.keys(sfpNow.pages || {}).length === 0;
          const inferredTool = toolAnswer?.kind === "plan_approval" ? undefined : inferForcedTool(
            userText,
            intervention,
            mode,
            hop || forcedTool,
            firstPassNow
          );
          const postedText =
            controlUserTextForSlash(
              userText,
              String(
                (preparedState as { goal?: { text?: string } }).goal?.text ||
                  ""
              )
            ) || userText.trim();
          const restoreId =
            inferredTool === "restore_version"
              ? previousModelVersionId(preparedState)
              : undefined;
          const pythonDrive = resumeRun
            ? resumeRun.kind === "control"
              ? await (await import("@/lib/sliderule-marathon-driver"))
                  .resumeControlTurnStream(resumeRun.runId, streamOpts)
              : await (
                await import("@/lib/sliderule-marathon-driver")
              ).resumeDriveFullStream(resumeRun.runId, streamOpts)
            : await driveStream(preparedState, postedText, {
                ...streamOpts,
                forcedTool: inferredTool,
                ...(toolAnswer ? { toolAnswer } : {}),
                ...(inferredTool === "pages" ? { tools: ["pages"] } : {}),
                ...(restoreId ? { versionId: restoreId } : {}),
                /* ⚠ 质疑指向哪件产物、澄清卡答掉了哪几个缺口，**必须跟着
                   POST 走**。2026-08-27 评审：这两样在客户端都算好了，
                   `intervention` 也一路传到这儿，就是没进 body——于是
                   服务端拿不到 target，失效级联整段跳过，而流里照样说
                   「已按质疑失效」；澄清卡同理，答完一个缺口都不关。 */
                ...(intervention?.targetArtifactId
                  ? { targetArtifactId: intervention.targetArtifactId }
                  : {}),
                ...(intervention?.answeredGapIds?.length
                  ? { answeredGapIds: intervention.answeredGapIds }
                  : {}),
                ...(intervention?.answeredGaps?.length
                  ? { answeredGaps: intervention.answeredGaps }
                  : {}),
              });
          // 流断了但 run 未终局（网络抖动/代理超时，非本地停止）：
          // 绝不能落进本地引擎兜底——那会把整轮在前端重跑一遍，与后台
          // run 双开。如实报中断，书签还在，刷新可再次自动接回。
          //
          // 判据抽在 sliderule-marathon-driver.classifyStreamFallback，那里
          // 有单测（这个回调本身测不动）。要点：**首发流**断线时 resumeRun
          // 是假，但只要 onRunId 触发过，后端那个 run 就实实在在在跑——
          // 只护续播分支等于把最常见的那种断线放进了兜底。
          const streamVerdict = (
            await import("@/lib/sliderule-marathon-driver")
          ).classifyStreamFallback({
            resuming: Boolean(resumeRun),
            sawRunId,
            gotResult: Boolean(pythonDrive),
            settledReason: runSettledReason,
            locallyAborted: controller.signal.aborted,
            sawTerminal,
          });
          if (streamVerdict === "report_interrupted") {
            throw new Error(
              "推演连接中断，后台仍在进行——刷新页面可再次接回"
            );
          }
          // 服务端宣布取消（他处停止/孤儿回收）且非本地主动停止：同样
          // 不进本地兜底重跑，按中断收尾。
          if (
            !pythonDrive &&
            runSettledReason === "cancelled" &&
            !controller.signal.aborted
          ) {
            throw new Error("推演已在服务端停止");
          }
          // 思考流留档（2026-07-10 用户裁决）：推演结束后每步 LLM 的完整
          // 输出保留成可折叠记录（Claude 的"Thought for Xs"），不随 llmDraft
          // 清空消失。closure.summary 不留档——它本身就是本轮总结正文，留档
          // 会和答案重复。
          let archiveSeq = 0;
          for (const [key, buf] of llmDraftBuffers) {
            if (key === "closure.summary" || !buf.trim()) continue;
            appendStep({
              id: `${turnId}-llm-archive-${++archiveSeq}`,
              kind: "llm_output",
              title: humanLlmLabel(key, llmStageLabels.get(key)).replace(/^LLM 正在/, ""),
              text: buf,
              formatJson: key === "five-system-model",
            });
          }
          // A failed control stream never invoked the legacy drive-full
          // fallback. Keep its failure distinct in the visible status too.
          setDriveFullStatus(
            !pythonDrive && (!resumeRun || resumeRun.kind === "control")
              ? "control_failed"
              : classifyDriveFullStatus(pythonDrive)
          );
          if (!pythonDrive) {
            throw new Error(
              controller.signal.aborted ? "已停止"
                : controlFailureRef.current || "控制面未返回结果"
            );
          }
          drive = {
            finalState: pythonDrive.finalState,
            stopReason: pythonDrive.stopReason || "completed",
            loops: pythonDrive.loops || [],
            publishClosure: pythonDrive.publishClosure,
          };
          usedMarathonDriver = false;
        }
      } catch (driveErr: any) {
        driveErrored = true;
        // Graceful: don't leave the turn dangling as "streaming" forever.
        const errMsg = driveErr?.message || String(driveErr);
        // 推演需要登录：**不是故障，不能按"已降级显示"说**（2026-08-03 线上实测修）。
        //
        // 现场形状：匿名在 miantuan.ai 点发送 → drive-full-stream 401 → 前端把
        // 401 当"服务不可用"回落本地引擎 → 那条路去打 legacy 的
        // /execute-capability → 500 thin_proxy_violation。用户看到的是转圈转到底
        // 加一个跟登录毫无关系的 500，而后端其实早把话说清楚了（"请先登录后再推演"）。
        //
        // 真正的修复在驱动层：401 抛 DriveAuthRequiredError 而不是 return null，
        // 于是**本地兜底那一步在 try 里就被跳过了**（见 sliderule-marathon-driver）。
        // 走到这里时兜底已经不会发生，所以这里不需要再 throw——re-throw 只会连
        // 带跳过下面的半程落盘与收尾。只把话说对就够。
        const needsLogin = Boolean(driveErr?.needsLogin);
        let stepMessage = `执行已中断：${errMsg.slice(0, 140)}`;
        let bannerMsg = errMsg.slice(0, 200);
        if (needsLogin) {
          // 侧栏账号是启动时的缓存，这次 401 不会自动刷新。再问一次 /me，
          // 人还在就不要叫用户去登录——2026-08-20 真机左下角 Admin 还亮着。
          const described = await describeDriveAuthFailure(errMsg);
          stepMessage = described.step;
          bannerMsg = described.banner;
          void refreshAuth();
        }
        appendStep({
          id: `${turnId}-drive-${needsLogin ? "auth" : "err"}`,
          kind: "capability_fail",
          capabilityId: "intent.parse" as any,
          roleId: "system",
          loopTurnId: turnId,
          capabilityRunId: `${turnId}-drive-err`,
          runIndex: 0,
          message: stepMessage,
        });
        // A failed model turn may have already changed the durable goal, plan
        // and project. Never PUT its old intake snapshot: the server correctly
        // treats a changed goal as a plan revocation (2026-09-13 real browser).
        // Keep local failure narration; the server owns the durable failure.
        try {
          let snap = SlideRuleRuntime.deriveNodeStatus
            ? SlideRuleRuntime.deriveNodeStatus(preparedState)
            : preparedState;
          // E13：失败轮也留半程时间线（刷新后能看到断在哪一步）
          snap = stampTurnNarration(snap, {
            turnId: narrationTurnIdFor(snap, userText, turnId),
            user: userText,
            steps: collectedSteps,
            durationMs: Date.now() - turnStartMs,
          });
          applyPersistedState(snap);
        } catch {}
        setUiTurns(prev =>
          prev.map(t =>
            t.id === turnId
              ? {
                  ...t,
                  status: "complete",
                  durationMs: Date.now() - turnStartMs,
                  assistant: `推演中断：${bannerMsg}（可重试或换指令）`,
                  assistantSource: "fallback",
                }
              : t
          )
        );
        // fall through to finally cleanup
        drive = { finalState: preparedState, stopReason: "error", loops: [] };
      }

      let final = (drive && drive.finalState) || preparedState;
      final = mergePublishClosureForPersistedTurn(
        final,
        (drive as any)?.publishClosure
      );
      // E13：轮次落定。turnId 必须盖住引擎的 turn-1，不能用本函数开头
      // 的 `turn-${Date.now()}`——2026-08-18 快递柜刷新出双胞胎。
      final = stampTurnNarration(final, {
        turnId: narrationTurnIdFor(final, userText, turnId),
        user: userText,
        steps: collectedSteps,
        durationMs: Date.now() - turnStartMs,
      });
      if (driveErrored) {
        applyPersistedState(final);
      } else {
        try {
          final = await persistSession(final);
          applyPersistedState(final);
        } catch (pErr) {
          // non-fatal for UI
          applyPersistedState(final);
        }
      }
      if (driveErrored && toolAnswer?.kind === "plan_approval") {
        // A failed response does not tell us whether approval was accepted.
        // Reload the server's waiting state before allowing the same request again.
        try {
          const latest = await SlideRuleRuntime.getSlideRuleSessionStore().load(sessionId);
          if (latest) {
            applyPersistedState(latest);
            const plan = [...(latest.controlTranscript || [])]
              .reverse()
              .find(row => row.kind === "plan_approval");
            if (
              latest.awaitReason === "control_plan_approval" &&
              typeof plan?.reqId === "string" && plan.reqId &&
              typeof plan.planContent === "string" && plan.planContent.trim()
            ) {
              const pending = { reqId: plan.reqId, planContent: plan.planContent };
              handledRequestIdsRef.current.delete(plan.reqId);
              pendingPlanApprovalRef.current = pending;
              setPendingPlanApproval(pending);
            }
          }
        } catch {
          // Keep the interrupted turn visible when the session is also unreachable.
        }
      }
      // 推演落定：侧栏列表刷新（话题/最近活跃时间）
      import("@/pages/agent-loop/dashboard/SidebarSessions")
        .then(m => m.notifySessionsUpdated())
        .catch(() => {});

      // M1 cleanup
      abortControllerRef.current = null;
      setIsRunning(false);

      // M3/M6 real: if marathon + converged, use real digest (buildStructuredReport) + frontier.propose (prompt+rationale+ledger)
      // + K1 supply + superseded already handled inside propose/create in driver if full loop used.
      // Here we call the pure helpers (exported) so UI sees prompt/rationale immediately, and auto-seed next if not exhausted.
      let marathonAutoSeed: string | null = null;
      let lastDigestNote = "";
      if (
        driveMode === "marathon" &&
        (drive.stopReason === "convergence_signal" ||
          drive.stopReason === "coverage_sufficient")
      ) {
        try {
          const recentIds = (final.artifacts || [])
            .slice(-6)
            .map((a: any) => a.id);
          const { createRoundDigest, proposeFrontier } =
            await import("@/lib/sliderule-marathon-driver");
          const digest = createRoundDigest(final, recentIds);
          const proposal = await proposeFrontier(final, digest, []);
          // Append visible evidence of real M3 (prompt + rationale + ledger) into last assistant for demo thickness
          lastDigestNote = `\n\n【M6 真实 digest 过质量门 + 9 段结构化报告】${digest.title}\n${(digest.content || "").slice(0, 380)}...\n\n【M3 真实 frontier.propose (prompt+rationale+ledger)】\nseed: ${proposal.seed}\nprompt(节选): ${proposal.prompt.slice(0, 220)}...\nrationale: ${proposal.rationale}\nledgerEntry: ${JSON.stringify(proposal.ledgerEntry).slice(0, 180)}`;
          marathonAutoSeed = proposal.seed;
          // M6 superseded sync + M4 policy attach (for hud + audit visibility)
          if (!final.supersededArtifactIds) final.supersededArtifactIds = [];
          final.supersededArtifactIds = [
            ...new Set([
              ...(final.supersededArtifactIds || []),
              ...((digest as any).supersededIds || recentIds),
            ]),
          ];
          (final as any).autopilotPolicy = {
            autoConfirmRoute: "primary",
            autoWaiveNonBlockingGaps: true,
            declaredAt: new Date().toISOString(),
            source: "hybrid-marathon-post",
          };
          final = await persistSession(final);
          applyPersistedState(final);
        } catch (e) {
          marathonAutoSeed = `auto-seed from convergence (M3 helper fallback)`;
        }
        setUiTurns(prev => {
          const last = prev[prev.length - 1];
          if (!last) return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              assistant:
                (last.assistant || "") +
                (lastDigestNote ||
                  `\n\n[M3/M6] 持续推演已自动生成下一条前沿线索（见 ledger）。`),
            },
          ];
        });
      }

      // M4 demo complete: if marathon await_human (G_READY) or policy path, fire real Notification (user permission)
      if (
        !driveErrored &&
        driveMode === "marathon" &&
        (drive.stopReason === "await_ready" ||
          drive.stopReason === "coverage_sufficient") /* after auto */
      ) {
        try {
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification("面团 AI 持续推演", {
              body: "本轮已收敛或需要人工确认。点击后可继续 marathon。",
            });
          } else if (
            typeof Notification !== "undefined" &&
            Notification.permission !== "denied"
          ) {
            Notification.requestPermission().then(p => {
              if (p === "granted")
                new Notification("SlideRule Marathon", {
                  body: "可以恢复自动驾驶。",
                });
            });
          }
        } catch {}
      }

      if (driveErrored) {
        // Error already surfaced a completed turn + snapshot state in catch handler.
        // Skip all success post-processing (would reference possibly bad dummy drive data).
      } else {
        const firstLoop = drive.loops[0];
        const lastLoop = drive.loops[drive.loops.length - 1];
        firstLoopPlanCountRef.value = firstLoop?.plan.selected.length ?? 0;

        const rounds = buildTurnRoundsFromDrive(final.decisionLedger, drive);
        const displayLoopId = firstLoop?.loopTurnId ?? turnId;
        const dledger = latestDledgerForTurn(
          final.decisionLedger,
          displayLoopId
        );
        const planSource = dledger?.source ?? "local_heuristic";
        const planError = firstLoop?.plan?.error || lastLoop?.plan?.error;
        const planOrchestrateReason =
          planSource === "local_heuristic"
            ? "orchestrate_unreachable"
            : planError
              ? `python_${planError}`
              : null;
        // planError / python_* from Python-owned degraded (planner_timeout etc) propagated for UI status visibility (allowed pages file)
        const planReason =
          firstLoop?.plan.reason ??
          lastLoop?.plan.reason ??
          firstLoop?.plan?.message;
        const planSelectedCount = firstLoop?.plan.selected.length ?? 0;

        // M4 complete resume demo: after real frontier (M3), auto-continue 1 round in marathon to show "持续推演" thickness (user aborts via stop anytime; M1 signal respected).
        // Real digest/propose already injected above; this gives multi-round without extra clicks for video/demo.
        if (
          driveMode === "marathon" &&
          marathonAutoSeed &&
          (drive.stopReason === "convergence_signal" ||
            drive.stopReason === "coverage_sufficient") &&
          !usedMarathonDriver
        ) {
          // 已点过「开始推演」的续跑，不是点火。走内层 runTurn，别再出范围卡。
          setTimeout(() => {
            runTurn(marathonAutoSeed!).catch(() => {});
          }, 80);
        }

        const committedIds = drive.loops.flatMap(
          (l: any) => l.committedArtifactIds
        );
        const committed = mapArtifactsToWhyArtifacts(final, committedIds);

        const loopTurnIds = new Set(drive.loops.map((l: any) => l.loopTurnId));
        const runsThisTurn = (final.capabilityRuns || []).filter((r: any) =>
          loopTurnIds.has(r.turnId)
        );
        const trustTotalCount = runsThisTurn.length || committed.length;
        const trustPassedCount =
          runsThisTurn.length > 0
            ? runsThisTurn.filter((r: any) =>
                (r.gateResults || []).every((g: any) => g.status === "passed")
              ).length
            : committed.filter(
                (a: any) =>
                  a.trustLevel === "gated_pass" || a.trustLevel === "audited"
              ).length;
        const trustGroundFailedCount = runsThisTurn.filter((r: any) =>
          (r.gateResults || []).some(
            (g: any) => g.gateId === "ground" && g.status === "failed"
          )
        ).length;

        const selectedCapabilities = drive.loops.flatMap((l: any) =>
          l.plan.selected.map((s: any) => ({
            capabilityId: String(s.capabilityId),
            roleId: String(s.roleId || "agent"),
          }))
        );

        // Prefer the exact DLEDGER.chose list for selectedCapabilities. This ensures the
        // final routeFacts (and thus the right-upper C_RISK/C_SYN/C_TOOL tree in TurnRouteTimeline)
        // matches what ORCH actually scheduled, even for completed turns and after refresh.
        const finalSelected =
          dledger && Array.isArray(dledger.chose) && dledger.chose.length > 0
            ? dledger.chose.map((cid: any) => ({
                capabilityId: String(cid),
                roleId: "agent",
              }))
            : selectedCapabilities;

        const completeRouteFacts = {
          turnId,
          timestamp: turnTimestamp,
          interventionIntent: intervention?.intent ?? null,
          challengeTargetLabel: challengeTargetLabel(challengeArt),
          goalStatusBefore,
          goalStatusAfterInvalidate: preparedState.goal?.status,
          staleArtifactIdsBefore,
          staleArtifactIdsAfter: [...(final.staleArtifactIds || [])],
          planReason,
          planSelectedCount: finalSelected.length,
          planSource,
          planOrchestrateReason,
          dledgerDecisionId: dledger?.id ?? null,
          rounds,
          selectedCapabilities: finalSelected,
          committedCount: committed.length,
          trustPassedCount,
          trustTotalCount,
          trustGroundFailedCount,
          goalStatusAfter: final.goal?.status,
          runtimePhase: final.runtimePhase,
          closureReason: drive.stopReason,
        };

        patchRoute(
          {
            planReason,
            planSelectedCount,
            planSource,
            planOrchestrateReason,
            dledgerDecisionId: dledger?.id ?? null,
            rounds,
            committedCount: committed.length,
            trustPassedCount,
            trustTotalCount,
            trustGroundFailedCount,
            goalStatusAfter: final.goal?.status,
            runtimePhase: final.runtimePhase,
            closureReason: drive.stopReason,
          },
          deriveTurnRoute(completeRouteFacts).length
        );

        const main = pickMainArtifact(committed);
        const mainArt = main
          ? committed.find(a => a.id === main.artifactId)
          : undefined;

        let assistantText = "";
        let assistantSource: UiTurn["assistantSource"] = "fallback";
        let narrationReason: UiTurn["narrationReason"];

        if (imMode === "minimal") {
          const narration = await fetchNarration({
            state: final,
            turnId,
            userText: userText.trim(),
            intervention: intervention ? { intent: intervention.intent } : null,
            selected: drive.loops.flatMap((l: any) =>
              l.plan.selected.map((s: any) => ({
                capabilityId: s.capabilityId,
                roleId: s.roleId,
              }))
            ),
            artifacts: committed.map((a: any) => ({
              kind: a.kind,
              title: a.content.split("\n")[0]?.slice(0, 80),
              summary: a.content.slice(0, 200),
              realLlm: a.realLlm,
            })),
            mainArtifact: mainArt
              ? {
                  kind: mainArt.kind,
                  title: mainArt.content.split("\n")[0],
                  content: mainArt.content,
                }
              : null,
            goalStatusBefore,
            planReason: planReason ?? "",
            skipped: dledger?.skipped,
          });
          assistantText = narration.text;
          assistantSource = narration.source;
          narrationReason = narration.reason;
          appendStep({
            id: `${turnId}-final`,
            kind: "narration",
            text: narration.text,
            source: narration.source,
            isFinal: true,
          });
        }

        if (lastDigestNote) {
          assistantText = (assistantText || "") + lastDigestNote;
        }
        const hostSpeech = hostSpeechRef.current.trim();
        if (hostSpeech) {
          assistantText = assistantText
            ? `${assistantText}\n\n${hostSpeech}`
            : hostSpeech;
          assistantSource = "llm";
        }

        setUiTurns(prev =>
          prev.map(t => {
            if (t.id !== turnId) return t;
            return {
              ...t,
              status: "complete",
              durationMs: Date.now() - turnStartMs,
              routeFacts: completeRouteFacts,
              routeExpanded: imMode !== "minimal",
              routeLitCount: deriveTurnRoute(completeRouteFacts).length,
              assistant: assistantText,
              assistantSource,
              narrationReason,
              main,
              actions: actionsAcc,
            };
          })
        );
        // 推演完成通知：偏好开 + 已授权 + 用户切走标签页 才弹（user-prefs 内判定）
        notifyDriveComplete(userText.trim());
      } // end of else (success path for live drive updates)
      setNextGateShouldFail(false);
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
      setLiveAction(null);
      setActiveSkillId(null); // clear highlighted skill thumbnail after run ends
      flushQueuedControlTurn();
    }
  };

  /**
   * 点火闸。所有产品入口（sendMessage / resend / repair / challenge /
   * 澄清答卡 / 续播）都走这里，而不是 ComposerDock.doSend。
   * 新烧一律 POST /control-turn-stream；执行授权由服务端计划审批掌管。
   */
  const requestRehearsal = async (
    userText: string,
    intervention?: UserIntervention,
    resumeRun?: { runId: string; kind?: "control" },
    mode?: "repair"
  ) => {
    await runTurn(userText, intervention, resumeRun, mode);
  };
  requestRehearsalRef.current = async (userText: string) => {
    await requestRehearsal(userText);
  };

  const dismissAsk = () => {
    pendingAskRef.current = null;
    setPendingAsk(null);
    flushQueuedControlTurn();
  };

  const stop = useCallback(() => {
    // E25：停止 = 杀服务端 run + 断本地流（否则后台照跑白烧 LLM）
    // ⚠ 不清 queuedTurnRef：用户打了新方向再停旧跑，那句是下一发控制面。
    cancelActiveRunOnServer();
    abortControllerRef.current?.abort();
    setIsRunning(false);
    setLiveAction(null);
  }, [cancelActiveRunOnServer]);

  // E25 推演断线重生：刷新/跳页回来，若本会话仍有在跑的后台 run →
  // 自动续播接回（事件日志从头补播重建本轮 UI，追平后接实时尾流）。
  const resumeAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    // Anonymous visitors can browse the empty shell, but they have no durable
    // control/run bookmark to resume. Do not probe login-gated endpoints here:
    // the old unconditional probe produced noisy 401/404 console errors on
    // every fresh anonymous visit and made a healthy page look broken.
    if (!sessionHydrated || !authReady || !authUser || IS_GITHUB_PAGES
        || sessionState.sessionId !== sessionId || resumeAttemptedRef.current === sessionId) {
      return;
    }
    if (isRunning) return;
    const sid = sessionState.sessionId || sessionId;
    resumeAttemptedRef.current = sid;
    const activity = controlActivityRef.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && projectEntrySessionRef.current === sid
      && sessionStateRef.current.sessionId === sid && controlActivityRef.current === activity
      && !isRunningRef.current;
    const record = loadActiveRun(sid);
    void (async () => {
      try {
        const controlResponse = await fetch(
          `/api/sliderule/control-runs/latest?sessionId=${encodeURIComponent(sid)}`,
          { credentials: "include" }
        );
        if (controlResponse.ok) {
          const { run } = await controlResponse.json();
          if (!isCurrent()) return;
          if (run?.runId && run.sessionId === sid && run.status === "failed") {
            // A failed run has no active bookmark after settlement. Its text
            // lives in the existing durable SSE log. Restore that explanation
            // only: the old complete/project events may predate source edits
            // made after this run, so they must never replace today's session.
            let failureText = "";
            const replayedChips: TurnStep[] = [];
            let replaySeq = 0;
            await Marathon.resumeControlTurnStream(String(run.runId), {
              onControlText: (text, stop) => {
                if (stop && ["llm_unavailable", "unknown"].includes(stop.stopReason)) {
                  failureText = text.trim();
                }
              },
              // ⚠ 2026-09-15 TicketStream：失败 run 的 SSE 日志里有
              //   project_* 全过程，turnNarrations 却只留下开口。刷新
              //   只回放失败说明 → 左栏执行步骤整列没了。工具事件只
              //   用来补 chip，complete/state 仍不许盖今天的工程投影。
              onControlToolStart: (tool, summary, operationId) => {
                const label = projectToolLabel(tool);
                if (!label) return;
                replaySeq += 1;
                const detail = String(summary || "").trim();
                const op = String(operationId || "").trim();
                replayedChips.push({
                  id: `replay-${run.runId}-${replaySeq}`,
                  kind: "chip",
                  capabilityId: tool as `project_${string}`,
                  roleId: "system",
                  label,
                  realLlm: false,
                  progressType: "acting",
                  ...(detail ? { projectDetail: detail } : {}),
                  ...(op ? { operationId: op } : {}),
                });
              },
              onControlToolResult: event => {
                const tool = projectToolLabel(event.tool);
                if (!tool) return;
                replaySeq += 1;
                const ok = event.ok !== false;
                const stillOpen = projectToolStillOpen(event);
                const detail = projectActionDetail(event);
                replayedChips.push({
                  id: `replay-${run.runId}-${replaySeq}`,
                  kind: "chip",
                  capabilityId: String(event.tool || "") as `project_${string}`,
                  roleId: "system",
                  label: !ok
                    ? `${tool.replace(/^正在/, "执行失败：")}`
                    : stillOpen
                      ? tool
                      : `${tool.replace(/^正在/, "已")}`,
                  realLlm: false,
                  progressType: !ok ? "failed" : stillOpen ? "acting" : "completed",
                  ...(detail ? { projectDetail: detail } : {}),
                  ...(typeof event.operationId === "string" && event.operationId
                    ? { operationId: event.operationId }
                    : {}),
                });
              },
            });
            if (!isCurrent()) return;
            const explanation = failureText || (run.error === "llm_unavailable"
              ? "模型服务未完成上一轮请求，现有工程已保留。"
              : "上一轮任务执行失败，现有工程已保留。请查看运行记录后继续。");
            const noticeId = `control-failure-${run.runId}`;
            setUiTurns(prev => {
              const history = prev.length > 0 ? prev : deriveTurnsFromState(sessionStateRef.current);
              const kept = history.filter(turn => turn.id !== noticeId);
              const withChips = turnsHaveProjectChips(kept)
                ? kept
                : attachProjectChipsToTurns(kept, replayedChips);
              return [...withChips, {
                id: noticeId, user: "", status: "complete", steps: [],
                routeFacts: { turnId: noticeId, timestamp: new Date().toISOString() },
                routeExpanded: false, routeLitCount: 0,
                assistant: explanation, assistantSource: "fallback", main: null, actions: [],
              }];
            });
            if (record?.runId === run.runId) clearActiveRun(sid);
            return;
          }
          if (run?.runId && (["queued", "running", "waiting_continue", "waiting_operation"].includes(run.status) ||
              (record?.kind === "control" && record.runId === run.runId))) {
            await requestRehearsal(record?.userText || "继续上一轮任务", undefined,
              { runId: String(run.runId), kind: "control" });
            return;
          }
        } else if (record?.kind === "control" && controlResponse.status >= 500) {
          return;
        }
        if (!isCurrent()) return;
        const res = await fetch(
          `/api/sliderule/runs/active?sessionId=${encodeURIComponent(sid)}`
        );
        const body = res.ok ? await res.json() : null;
        if (!isCurrent()) return;
        const active = body?.active;
        if (active && active.status === "running" && active.runId) {
          await requestRehearsal(record?.userText || "（续播上一轮推演）", undefined, {
            runId: String(active.runId),
          });
        } else {
          // run 已完结/服务端已无此 run：清书签（终态已由轮边界落库覆盖）
          if (record) clearActiveRun(sid);
        }
      } catch {
        // 后端暂不可达：书签保留，下次进入再试
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionState.sessionId, sessionHydrated, authReady, authUser]);

  const resolveInteractiveGate = (gateNodeId: string, choice: string | null) => {
    // Pragmatic bridge to existing text-driven G_CONFIRM logic in intakeMessage.
    // "选择方案 ..." triggers userPicksRoute (clears await_confirm, proceeds with choice).
    // Reject text triggers userRejectsRouteSelection (stales route_options, re-compare).
    const text = choice ? "选择方案 A" : "都不行，重新对比路线";

    // G_CONFIRM 路线点选不是点火闸（本 PR ClarificationCard / 答卡也不当闸）。
    void runTurn(text);
  };

  // textOverride：迭代环（重新推演/编辑重跑）程序化重发用。typeof 守卫是刻意的——
  // 既有调用点 onClick={sendMessage} 会把 MouseEvent 当第一参传进来，不能误当文本。
  const sendMessage = async (textOverride?: unknown) => {
    const text = (
      typeof textOverride === "string" ? textOverride : input
    ).trim();
    if (!text) {
      /**
       * 空输入 + 队列里还压着东西 + 没在跑 → 把队列发出去。
       *
       * ⚠ 2026-08-28 真机（截图那场）：推演跑完之后点伴随式澄清的「改成 X」，
       *   那句话 pushQueuedTurn 进队列，而 flushQueuedControlTurn 的五个调用点
       *   全是「某件事结束时」（推演 finally ×2、关范围卡、先改范围、关提问）
       *   ——**没有一处对应"空闲时排进来"**。于是它挂在「本轮结束后发出」下面
       *   永远等下去，因为"本轮"早就结束了。用户看到的是点了没反应。
       *
       *   抄 grok-build：提问/请求是张欠条，submit / cancel / 被顶掉三条出路
       *   每条都得把它兑现，没有哪条路能让它悬着
       *   （acp_handler/interactions.rs 的 response_tx 纪律）。队列同理——
       *   空闲时那条出路就是这颗发送键。
       *
       * ⚠ 走 flushQueuedControlTurn 而不是自己拼：它带着停泊卡的门禁
       *   （overlayBlocksQueueFlush）和"合成一条再发"的纪律，绕开就会
       *   三句补充烧三次工厂。
       */
      if (!isRunningRef.current && queuedTurnRef.current.length > 0) {
        flushQueuedControlTurn();
      }
      return;
    }
    const pendingPlan = pendingPlanApprovalRef.current;
    if (pendingPlan) {
      setInput("");
      submitPlanApproval({ reqId: pendingPlan.reqId, outcome: "cancelled", feedback: text });
      return;
    }
    // 运行中发送排队，不许 stop()。sliderule:resend-prompt 也走这里。
    if (isRunningRef.current) {
      const hop = factoryHopFromText(text);
      if (hop) {
        // 收尾卡 / 人话 hop 是 typed 答案，盖掉确认留下的 pages。
        pendingForcedToolRef.current = hop;
      }
      const pendingNeed = pendingAskRef.current;
      const answer = pendingNeed ? {
        kind: "ask_user", text, ...(pendingNeed.reqId ? { reqId: pendingNeed.reqId } : {}),
      } : undefined;
      if (pendingNeed?.reqId) handledRequestIdsRef.current.add(pendingNeed.reqId);
      pendingAskRef.current = null;
      setPendingAsk(null);
      if (answer) {
        queuedTurnRef.current = [{ text, synthetic: true, toolAnswer: answer }, ...queuedTurnRef.current];
        setQueuedTurns(queuedTurnRef.current);
      } else {
        pushQueuedTurn(text);
      }
      setInput("");
      return;
    }
    setInput("");
    // ⚠ 意图只看文本。pending 不能短接到 challenge：质疑后改写作曲家 /
    // 编辑重跑 / 重新推演 / 重置会话都会留下 leftover ref。
    const pending = pendingChallengeRef.current;
    pendingChallengeRef.current = null;
    const resolved = resolveChallengeSend({
      text,
      pendingArtifactId: pending?.artifactId,
      latestMainArtifactId: latestMainArtifactIdFromTurns(uiTurns),
    });
    if (resolved.intent === "challenge") {
      await requestRehearsal(text, {
        targetArtifactId: resolved.targetArtifactId,
        intent: "challenge",
        text,
      });
      return;
    }
    await requestRehearsal(text);
  };

  // E26 缺口修复轮：闭环被拦截后「哪里缺补哪里」——服务端只重跑覆盖门
  // 标红的能力（evidence.search 等），已 PASS 的产物与五系统模型原样复用。
  const repairGaps = async () => {
    if (isRunning) return;
    await requestRehearsal("补齐证据缺口", undefined, undefined, "repair");
  };

  // E29 版本前进/回退：服务端移动版本指针并重建闭环（追加式历史，不改史），
  // 返回的新状态直接应用；SSE 残留的 skillContents 清空，屏幕改读闭环里的模型。
  const restoreModelVersion = async (versionId: string) => {
    if (isRunning) return;
    // 连点闸：ref 同步判定（见 restoringRef 的声明），state 只管按钮置灰。
    if (restoringRef.current) return;
    restoringRef.current = true;
    setIsRestoring(true);
    const sid = sessionState.sessionId || sessionId;
    try {
      const res = await fetch(
        `/api/sliderule/sessions/${encodeURIComponent(sid)}/model-versions/${encodeURIComponent(versionId)}/restore`,
        { method: "POST" }
      );
      let body:
        | { state?: unknown; reason?: string; detail?: string; restored?: boolean }
        | null = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      // ⚠ 先判 restored，再判 res.ok（2026-08-16 线上实测）。
      //
      // 后端对"已经是这一版"返回的是 **HTTP 200 + restored:false + 完整
      // state**。原来的 `if (res.ok && body?.state)` 会在这里直接 return，
      // 于是下面那句"已经是当前版本"永远走不到——无效点击零反馈。
      // 这段代码自己的注释写着「点了没反应还不知道为什么是最差的体验」，
      // 而它正被这个短路造出来。
      if (res.ok && body?.restored === false) {
        const why =
          body.reason === "already_current"
            ? "已经是当前版本"
            : body.detail || body.reason || "未生效";
        notifyRestoreFailure(why);
        return;
      }
      if (res.ok && body?.state) {
        setSkillContents({});
        setLatestMermaid(null);
        applyPersistedState(body.state as V5SessionState);
        return;
      }
      // D11 修复（2026-07-27）：失败不再静默——404/409/already_current 都
      // 给用户一句人话，点了没反应还不知道为什么是最差的体验。
      const reason =
        body?.reason === "already_current"
          ? "已经是当前版本"
          : body?.detail || body?.reason || `回退失败（HTTP ${res.status}）`;
      notifyRestoreFailure(reason);
    } catch {
      notifyRestoreFailure("后端不可达，请稍后重试");
    } finally {
      // finally 不能省：上面每条分支都有 return，写在末尾的话
      // 成功路径永远解不开闸，第二次回退就再也点不动了。
      restoringRef.current = false;
      setIsRestoring(false);
    }
  };

  const forkVariant = async () => {
    if (isRunning || IS_GITHUB_PAGES) return;
    try {
      const { postControlTurnStream } = await import(
        "@/lib/sliderule-marathon-driver"
      );
      let forkFailed = "";
      const out = await postControlTurnStream(
        sessionState,
        "从这里分一个变体",
        {
          forcedTool: "fork_variant",
          onControlToolResult: event => {
            if (event.tool === "fork_variant" && event.ok === false) {
              forkFailed = String(event.error || "分变体未生效");
            }
          },
        }
      );
      if (out?.finalState) {
        setSessionState(preservePythonEvidenceProjection(out.finalState));
      }
      if (forkFailed) notifyRestoreFailure(forkFailed);
    } catch {
      notifyRestoreFailure("分变体未生效");
    }
  };

  /** 版本切换失败的可见反馈：在对话流末尾追加一条系统提示 turn。 */
  const notifyRestoreFailure = (reason: string) => {
    const noticeId = `restore-fail-${Date.now()}`;
    setUiTurns(prev => [
      ...prev,
      {
        id: noticeId,
        user: "",
        status: "complete" as const,
        steps: [],
        routeFacts: { turnId: noticeId, timestamp: new Date().toISOString() },
        routeExpanded: false,
        routeLitCount: 0,
        assistant: `⚠ 版本切换未生效：${reason}`,
        assistantSource: "fallback" as const,
        main: null,
        actions: [],
      },
    ]);
  };

  const toggleRouteExpanded = useCallback((turnId: string) => {
    setUiTurns(prev =>
      prev.map(t =>
        t.id === turnId ? { ...t, routeExpanded: !t.routeExpanded } : t
      )
    );
  }, []);

  const retryCapability = useCallback(
    async (
      turnId: string,
      params: {
        loopTurnId: string;
        capabilityId: V5CapabilityId;
        roleId: string;
        runIndex: number;
      }
    ) => {
      if (isRunningRef.current) return;

      const turn = uiTurns.find(t => t.id === turnId);
      if (!turn) return;

      isRunningRef.current = true;
      setIsRunning(true);

      const stripFailSteps = (steps: TurnStep[]) =>
        steps.filter(
          s =>
            !(
              s.kind === "capability_fail" &&
              s.loopTurnId === params.loopTurnId &&
              s.capabilityId === params.capabilityId &&
              s.runIndex === params.runIndex
            )
        );

      const appendStep = (step: TurnStep) => {
        setUiTurns(prev =>
          prev.map(t => {
            if (t.id !== turnId) return t;
            const base = stripFailSteps(t.steps);
            return { ...t, steps: [...base, step] };
          })
        );
      };

      try {
        let loaded = await SlideRuleRuntime.loadOrCreateSessionState(
          sessionState.sessionId || sessionId
        );
        loaded = preservePythonEvidenceProjection(
          sanitizeLegacyEmptySeed(loaded)
        );

        const goalText = loaded.goal?.text?.trim() || turn.user.trim();
        const uiExecutor = createUiCapabilityExecutor(
          SlideRuleRuntime.getCapabilityExecutor(),
          {
            userText: turn.user.trim(),
            goalText,
            emitImSteps: true,
            onStep: appendStep,
            onActionTrace: trace => {
              setUiTurns(prev =>
                prev.map(t =>
                  t.id === turnId ? { ...t, actions: [...t.actions, trace] } : t
                )
              );
            },
            setLiveAction,
          }
        );

        const result = await SlideRuleRuntime.retrySingleCapability(loaded, {
          ...params,
          executor: uiExecutor,
        });

        let final = await persistSession(result.state);
        applyPersistedState(final);

        const loopTurnIds = new Set(
          (turn.routeFacts.rounds || []).map(r => r.loopTurnId)
        );
        if (loopTurnIds.size === 0) {
          loopTurnIds.add(params.loopTurnId);
        }
        const runsThisTurn = (final.capabilityRuns || []).filter((r: any) =>
          loopTurnIds.has(r.turnId)
        );
        const trustTotalCount = runsThisTurn.length;
        const trustPassedCount = runsThisTurn.filter((r: any) =>
          (r.gateResults || []).every((g: any) => g.status === "passed")
        ).length;
        const trustGroundFailedCount = runsThisTurn.filter((r: any) =>
          (r.gateResults || []).some(
            (g: any) => g.gateId === "ground" && g.status === "failed"
          )
        ).length;

        const committedIds = (final.artifacts || [])
          .filter((a: any) => {
            const runId = a.producedBy?.capabilityRunId || "";
            return [...loopTurnIds].some((lt: any) =>
              runId.startsWith(`${lt}-run-`)
            );
          })
          .map((a: any) => a.id);
        const committed = mapArtifactsToWhyArtifacts(final, committedIds);
        const main = pickMainArtifact(committed);

        setUiTurns(prev =>
          prev.map(t => {
            if (t.id !== turnId) return t;
            const routeFacts = {
              ...t.routeFacts,
              committedCount: committed.length,
              trustPassedCount,
              trustTotalCount,
              trustGroundFailedCount,
              goalStatusAfter: final.goal?.status,
              runtimePhase: final.runtimePhase,
            };
            return {
              ...t,
              routeFacts,
              routeLitCount: deriveTurnRoute(routeFacts).length,
              main: main ?? t.main,
            };
          })
        );
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
        setLiveAction(null);
        flushQueuedControlTurn();
      }
    },
    [uiTurns, sessionState.sessionId, sessionId, applyPersistedState]
  );

  // 无理由：只预填作曲家（产品面禁止 window.prompt）。有理由：整轮
  // runTurn + intent challenge，不是局部重跑。
  const challengeTurn = async (artifactId: string, reason?: string) => {
    const text = (reason && reason.trim()) || "";
    if (!text) {
      pendingChallengeRef.current = { artifactId };
      dispatchChallengePrefill({ artifactId });
      return;
    }
    pendingChallengeRef.current = null;
    await requestRehearsal(text, {
      targetArtifactId: artifactId,
      intent: "challenge",
      text,
    });
  };

  const resetSession = useCallback(async () => {
    if (isRunning) return;
    pendingChallengeRef.current = null;
    const sid = sessionState.sessionId || sessionId;
    if (IS_GITHUB_PAGES) {
      const store = SlideRuleRuntime.getSlideRuleSessionStore();
      await store.deleteSession?.(sid);
      const seeded = await store.save(createGithubPagesSlideRuleSeedSession());
      setSessionState(seeded);
    } else {
      const fresh = await prepareVisibleResetSessionState(
        sid,
        SlideRuleRuntime.deleteSlideRuleSession,
        persistSession
      );
      setSessionState(fresh);
    }
    setUiTurns([]);
    // 演示模式重置后回到「预填意图 + 一键发送」的初始体验
    setInput(IS_GITHUB_PAGES ? options.initialGoal || "" : "");
    setLiveAction(null);
    setNextGateShouldFail(false);
    setDriveFullStatus("idle");
    rehearsalCursorRef.current = idleRehearsalCursor();
    setRehearsalCursor(idleRehearsalCursor());
    setLlmStreams([]);
    /* 重置会话必须清队列——遗留的补充会劫持后来无关的一发 */
    queuedTurnRef.current = [];
    setQueuedTurns([]);
    pendingPlanApprovalRef.current = null;
    setPendingPlanApproval(null);
    pendingAskRef.current = null;
    setPendingAsk(null);
    handledRequestIdsRef.current.clear();
    pendingToolAnswerRef.current = undefined;
    pendingForcedToolRef.current = undefined;
    setSubmittedClarifyIds([]);
  }, [isRunning, sessionState.sessionId, sessionId, options.initialGoal]);

  const [projectCreateState, setProjectCreateState] = useState<{
    status: "idle" | "creating" | "error";
    error: string | null;
  }>({ status: "idle", error: null });
  const projectCreationRef = useRef<object | null>(null);
  const projectEntrySessionRef = useRef(sessionId);
  projectEntrySessionRef.current = sessionId;
  useEffect(() => {
    setProjectCreateState({ status: "idle", error: null });
    return () => { projectCreationRef.current = null; };
  }, [sessionId]);
  const projectCreateBlockedReason = projectCreationBlockedReason(sessionState);
  const canCreateProject = sessionHydrated && sessionState.sessionId === sessionId
    && sessionState.runtimeKind !== "project" && !projectCreateBlockedReason && hasApprovedProjectPlan(sessionState);
  const createProjectFromApprovedPlan = useCallback(async (templateId?: "react-vite" | "react-vite-tasks") => {
    if (isRunningRef.current || projectCreationRef.current) return false;
    const state = sessionStateRef.current;
    const chosenTemplate = templateId ?? projectTemplateForDeliverable(
      latestPlanDeliverableKind(state.controlTranscript as Array<Record<string, unknown>> | undefined)
    );
    const sid = state.sessionId || sessionId;
    if (!sessionHydrated || sid !== projectEntrySessionRef.current) return false;
    if (state.runtimeKind === "project") return Boolean(state.projectId && state.projectRevision);
    // 2026-09-13: state-only locking happened after the digest await, allowing
    // two clicks to POST twice. A request token also prevents an old response
    // from replacing the shell after switching sessions or unmounting.
    const request = {};
    projectCreationRef.current = request;
    const isCurrent = () => projectCreationRef.current === request && projectEntrySessionRef.current === sid;
    setProjectCreateState({ status: "creating", error: null });
    let created = false;
    try {
      const blockedReason = projectCreationBlockedReason(state);
      if (blockedReason) throw new Error(blockedReason);
      const approvalRef = await approvedPlanReference(state);
      if (!isCurrent()) return false;
      if (!approvalRef) throw new Error("请先批准当前计划后再创建工程。");
      const response = await fetch(`/api/sliderule/sessions/${encodeURIComponent(sid)}/project`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalRef, templateId: chosenTemplate }),
      });
      if (!response.ok) {
        let detail = "工程创建未完成，请刷新状态后重试。";
        try {
          detail = projectCreateFailureText(await response.json());
        } catch { /* keep safe generic message */ }
        throw new Error(detail);
      }
      created = true;
      const receipt = await response.json();
      if (!isCurrent()) return false;
      const project = receipt?.project;
      if (project?.sessionId !== sid || typeof project?.projectId !== "string" || !project.projectId) {
        throw new Error("invalid_project_receipt");
      }
      const loaded = await SlideRuleRuntime.loadOrCreateSessionState(sid);
      if (!isCurrent()) return false;
      if (loaded.sessionId !== sid || loaded.runtimeKind !== "project" || loaded.projectId !== project.projectId || !loaded.projectRevision) {
        throw new Error("project_projection_not_restored");
      }
      const hydrated = preservePythonEvidenceProjection(loaded);
      sessionStateRef.current = hydrated;
      setSessionState(hydrated);
      const restored = deriveTurnsFromState(hydrated);
      if (restored.length > 0) setUiTurns(restored);
      setProjectCreateState({ status: "idle", error: null });
      return true;
    } catch (error) {
      if (isCurrent()) setProjectCreateState({ status: "error", error: created
        ? "工程创建请求已完成，但未能读取工程状态。请刷新当前会话后重试。"
        : error instanceof Error ? error.message : "工程创建未完成，请稍后重试。" });
      return false;
    } finally {
      if (projectCreationRef.current === request) projectCreationRef.current = null;
    }
  }, [sessionId, sessionHydrated]);

  // G_READY clarification cards: unanswered open_question gaps with V4-style structured options.
  const pendingClarifications = useMemo<ClarificationItem[]>(
    () =>
      pendingClarificationItems({
        gaps: sessionState.coverageGaps,
        awaitReason: sessionState.awaitReason,
        isRunning,
        submittedGapIds: submittedClarifyIds,
      }),
    [
      sessionState.coverageGaps,
      sessionState.awaitReason,
      isRunning,
      submittedClarifyIds,
    ]
  );

  // Generate deliverables by sending one intent through the existing S19 pipeline.
  const generateDeliverables = useCallback(() => {
    if (isRunning) return;
    void requestRehearsal(
      "打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包",
      {
        intent: "generate_plan",
        text: "打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包",
      }
    );
  }, [isRunning, requestRehearsal]);

  const answerClarifications = useCallback(
    (answers: Array<{ gapId: string; answer: string }>) => {
      if (!answers.length) return;
      const answeredGapIds = answers.map(a => a.gapId);
      const answeredGaps = answers.map(a => ({
        gapId: a.gapId,
        answer: a.answer,
      }));
      setSubmittedClarifyIds(answeredGapIds);
      setSessionState(prev =>
        applyAnsweredGapsToState(prev, { answeredGapIds, answeredGaps })
      );
      const byId = new Map(
        (sessionState.coverageGaps || []).map(g => [g.id, g.label] as const)
      );
      const supplement = answers
        .map(a => `「${byId.get(a.gapId) || a.gapId}」答：${a.answer}`)
        .join("\n");
      void requestRehearsal(supplement, {
        intent: "clarify",
        text: supplement,
        answeredGapIds,
        /* ⚠ 答案本身也要发过去：服务端把它写在缺口上，开工时原样进生成
           提示词。只发 id 的话缺口是关了，模型什么都没多知道——澄清白问。 */
        answeredGaps,
      });
    },
    [sessionState.coverageGaps, requestRehearsal]
  );

  return {
    goal,
    sessionHydrated,
    uiTurns,
    input,
    setInput,
    pendingClarifications,
    answerClarifications,
    /** 推演中补的话（排队到下一轮）。看得见、撤得掉——见 midrun-queue 头注。 */
    queuedTurns,
    removeQueuedTurn,
    generateDeliverables,
    isRunning,
    /** 版本切换请求在飞。名字带 Version 是给消费方看的——那边同名 prop 直传按钮。 */
    isRestoringVersion: isRestoring,
    liveAction,
    sessionState,
    executorMode,
    driveMode,
    setDriveMode,
    stop,
    // M5: real marathon budget, surfaced to the HUD for synchronization.
    marathonBudget,
    setMarathonBudget: (b: { maxTokens: number; declaredAt: string }) =>
      setMarathonBudget(b),
    driveFullStatus,
    // SSE live skill highlight — which of the 6 systems is currently executing.
    activeSkillId,
    // Accumulated per-skill content from SSE events (for system screen renderers).
    skillContents,
    latestMermaid,
    // spec-first 第 3 步逐页产出的 HTML（运行中实时上屏；新一轮清空）
    specPages,
    // LLM 实时草稿（运行中流式累积；新一轮清空）+ 当前来源标签
    //（能力 id 或 "five-system-model"，用于左栏实时块的动态标题）。
    llmDraft,
    llmDraftLabel,
    llmStreams,
    rehearsalCursor,
    sendMessage,
    repairGaps,
    restoreModelVersion,
    forkVariant,
    runTurn: requestRehearsal,
    requestRehearsal,
    pendingPlanApproval,
    submitPlanApproval,
    pendingAsk,
    submitQuestionnaire,
    dismissAsk,
    challengeTurn,
    resetSession,
    createProjectFromApprovedPlan,
    canCreateProject,
    projectCreateBlockedReason,
    projectCreateState,
    toggleRouteExpanded,
    retryCapability,
    resolveInteractiveGate,
  };
}

export const __sessionEvidenceTestHelpers = {
  preservePythonEvidenceProjection,
  prepareVisibleResetSessionState,
  persistPreparedStateForDrive,
  applyAnsweredGapsToState,
};
