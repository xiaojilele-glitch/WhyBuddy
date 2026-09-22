import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTurnRoute, type TurnRouteFacts } from "@shared/blueprint/sliderule-turn-route";
import type { TurnStep, UiTurn } from "./types";
import { dedupeTurnNarrations, narrationStepsFor } from "./turn-narration";
import { mainFromRuns } from "./turn-main-artifact";
import {
  attachProjectChipsToTurns,
  chipFromControlTranscriptRow,
  chipsFromControlTranscript,
} from "./project-activity";

function logTurnTellsStory(turn: UiTurn): boolean {
  let speech = false;
  let chip = false;
  for (const step of turn.steps || []) {
    if (step.kind === "model_speech") speech = true;
    if (step.kind === "chip") chip = true;
    if (speech && chip) return true;
  }
  return false;
}

function overlayNarrationOntoLog(fromLog: UiTurn[], narrated: UiTurn[]): UiTurn[] {
  const unused = [...narrated];
  return fromLog.map(turn => {
    const idx = unused.findIndex(item => item.user && item.user === turn.user);
    const match = idx >= 0 ? unused.splice(idx, 1)[0] : undefined;
    if (!match) return turn;
    const archives = (match.steps || []).filter(step => step.kind === "llm_output");
    return {
      ...turn,
      durationMs: turn.durationMs ?? match.durationMs,
      main: turn.main ?? match.main,
      steps: archives.length ? [...turn.steps, ...archives] : turn.steps,
    };
  });
}

type ModelVersionSnap = {
  id?: string;
  turnId?: string;
  instruction?: string;
};

function modelVersionsOf(state: V5SessionState): ModelVersionSnap[] {
  const raw = (state as { modelVersions?: unknown }).modelVersions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is ModelVersionSnap => !!v && typeof v === "object");
}

function validNarrations(state: V5SessionState) {
  return (state.turnNarrations || []).filter(
    (n): n is { turnId: string; user?: string; steps: unknown[] } =>
      !!n && typeof n.turnId === "string" && Array.isArray(n.steps)
  );
}

/**
 * 刷新后内存 `uiTurns` 为空 → 右上角「架构执行记录」(依赖 latestTurn)整块消失,
 * 但画布仍在(来自持久化的 sessionState.graph)。本函数从**已持久化**的
 * decisionLedger / capabilityRuns / goal / runtimePhase / lastTurnId 派生出「最近一轮」的
 * 精简 UiTurn,让执行记录在刷新后可重建。
 *
 * 改进:优先使用 dledger.chose 作为 selectedCapabilities（ORCH 实际选定的能力列表）。
 * 这保证刷新后重建的 deriveTurnRoute 能产出与执行时一致的 C_RISK / C_SYN / C_TOOL … 树形，
 * 而不是退化成“垃圾”单轮视图。
 *
 * 取舍:多轮折叠的细节(rounds)是运行期 drive 的产物,持久化里没有逐 loop 记录,
 * 故重建为「单轮合并视图」—— deriveTurnRoute 仍能据此渲染 INTAKE→BUDGET→ORCH→C_*→
 * T_GATE→GCOV 的完整站点序列。steps/actions(逐能力叙述)同样是运行期产物,留空不影响站点。
 */
export function deriveLatestTurnFromState(
  state: V5SessionState | null | undefined
): UiTurn | null {
  if (!state) return null;
  const runs = (state.capabilityRuns || []) as Array<{
    capabilityId?: string;
    roleId?: string;
    turnId?: string;
    gateResults?: Array<{ status?: string }>;
  }>;
  const ledger = (state.decisionLedger || []) as Array<{
    id?: string;
    turnId?: string;
    source?: string;
  }>;
  if (runs.length === 0 && ledger.length === 0) return null;

  const turnId =
    state.lastTurnId ||
    runs[runs.length - 1]?.turnId ||
    ledger[ledger.length - 1]?.turnId ||
    "restored-turn";
  const turn = buildRestoredTurn(state, String(turnId), undefined);
  // M5 兜底：真机上 `lastTurnId` 和 run 的 `turnId` 本来就常对不上
  // （实测 lastTurnId=turn-17-drive-full，而 runs 里是 loop-1-closure），
  // 严格按轮筛会全落空 → 质疑按钮照旧不渲染。这里是"最近一轮"的单轮视图，
  // 会话级产物就是它的产物，回落到全部 runs 是安全的。
  if (!turn.main) {
    turn.main = mainFromRuns(state, (state.capabilityRuns || []) as Array<{ outputs?: unknown }>);
  }
  return turn;
}

/** 时间戳级 turnId（毫秒 epoch）才启用「差 ≤2ms 视为同轮」：客户端造
 * `turn-<Date.now()>`（叙述用它），服务端开局步进把它 +1 存进版本史
 * （`_advance_turn_version`）——同一轮在两份持久化里顶着差 1ms 的两个名字，
 * 按 turnId 精确对永远对不上（2026-08-18 烘焙店真机：叙述 turn-…087、
 * 版本 turn-…088，×3 轮全是如此）。
 * ⚠ 老编号（turn-3 / turn-4）是**真实相邻轮次**，差 1 绝不许合并——
 * 邻近判定只对 epoch 毫秒量级的数字开。 */
const EPOCH_MS_FLOOR = 1e12;
const SAME_TURN_STAMP_TOLERANCE_MS = 2;

function turnStampOf(turnId: string): number | null {
  const nums = String(turnId).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

function sameRestoredTurn(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = turnStampOf(a);
  const sb = turnStampOf(b);
  return (
    sa != null &&
    sb != null &&
    sa > EPOCH_MS_FLOOR &&
    sb > EPOCH_MS_FLOOR &&
    Math.abs(sa - sb) <= SAME_TURN_STAMP_TOLERANCE_MS
  );
}

function transcriptUserAnswer(row: Record<string, unknown>): string {
  const answers = row.answers;
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    const parts = Object.values(answers).flatMap(value =>
      Array.isArray(value)
        ? value.map(item => String(item || "").trim()).filter(Boolean)
        : String(value || "").trim()
          ? [String(value).trim()]
          : []
    );
    if (parts.length) return parts.join(" · ");
  }
  return String(row.text || "").trim();
}

function transcriptSpeech(row: Record<string, unknown>, id: string): TurnStep | null {
  const text = String(row.text || "").trim();
  if (!text) return null;
  return { id, kind: "model_speech", text };
}

function shellTurnFromLog(
  id: string,
  user: string,
  steps: TurnStep[],
  durationMs?: number
): UiTurn {
  const lastSpeech = [...steps]
    .reverse()
    .find((step): step is Extract<TurnStep, { kind: "model_speech" }> =>
      step.kind === "model_speech" && Boolean(step.text.trim())
    );
  return {
    id,
    user,
    status: "complete",
    durationMs,
    steps,
    routeFacts: {
      turnId: id,
      planSelectedCount: 0,
      planSource: "local_heuristic",
    } as TurnRouteFacts,
    routeExpanded: false,
    routeLitCount: 0,
    assistant: lastSpeech?.text ?? "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

/**
 * 叙述/版本史都空时，按 host 日志铺对话。
 *
 * 用户行：`turn` / 问卷 `user_answer` / `plan_approved`。
 * 助手行：`control_text` / `canned` + 工具 chip。顺序跟日志一致，
 * 不许先倒完全部散文再铺工具——SessionStory 靠这个顺序切章。
 */
export function turnsFromControlTranscript(
  state: V5SessionState | null | undefined
): UiTurn[] {
  if (!state) return [];
  const rows = Array.isArray(state.controlTranscript)
    ? state.controlTranscript
    : [];
  if (!rows.length) return [];

  type Acc = {
    id: string;
    user: string;
    steps: TurnStep[];
    startedAt: number | null;
    endedAt: number | null;
  };
  const accs: Acc[] = [];
  let current: Acc | null = null;
  const goalText = String(state.goal?.text || "").trim();

  const stampOf = (row: Record<string, unknown>): number | null => {
    const raw = Date.parse(String(row.timestamp || ""));
    return Number.isFinite(raw) ? raw : null;
  };

  const start = (id: string, user: string, stamp: number | null) => {
    current = { id, user, steps: [], startedAt: stamp, endedAt: stamp };
    accs.push(current);
  };

  const ensure = (stamp: number | null) => {
    if (current) return;
    start(
      "restored-from-log",
      goalText || "这一轮",
      stamp
    );
  };

  rows.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>;
    const kind = String(row.kind || "");
    const id = String(row.id || `ct-${index}`);
    const stamp = stampOf(row);
    if (kind === "turn" && String(row.role || "") === "user") {
      const user = String(row.text || "").trim();
      if (user) start(id, user, stamp);
      return;
    }
    if (kind === "user_answer") {
      const user = transcriptUserAnswer(row);
      if (user) start(id, user, stamp);
      return;
    }
    if (kind === "plan_approved") {
      const feedback = String(row.feedback || "").trim();
      start(id, feedback || "批准计划并执行", stamp);
      return;
    }
    const chip = chipFromControlTranscriptRow(row, index);
    if (chip) {
      ensure(stamp);
      current!.steps.push(chip);
      if (stamp != null) current!.endedAt = stamp;
      return;
    }
    if (kind === "control_text" || kind === "canned") {
      const speech = transcriptSpeech(row, id);
      if (!speech) return;
      ensure(stamp);
      current!.steps.push(speech);
      if (stamp != null) current!.endedAt = stamp;
    }
  });

  return accs
    .filter(acc => acc.user || acc.steps.length > 0)
    .map(acc =>
      shellTurnFromLog(
        acc.id,
        acc.user,
        acc.steps,
        acc.startedAt != null && acc.endedAt != null && acc.endedAt >= acc.startedAt
          ? acc.endedAt - acc.startedAt
          : undefined
      )
    );
}

/**
 * 刷新后把**整段对话**从持久化状态灌回左栏。
 *
 * 2026-08-18 真机（烘焙店那趟）：迭代发了两针精修，刷新后只剩首轮结论，
 * 后面发出去的话气泡全没了。成因不是没落盘——`modelVersions[].instruction`
 * 和 `turnNarrations[].user` 都在——是页面只调用 `deriveLatestTurnFromState`
 * 重建一轮，而且客户端 `turn-${Date.now()}` 对不上服务端 `turn-N-drive-full`，
 * 恢复轮的 `user` 经常是空串，ImUserMessage 直接 `return null`。
 *
 * ⚠ 2026-08-18 深夜二修（步伴真机整页白屏）：第一版按版本史铺气泡，
 * 而版本史里同一轮可以有多条（缺页残次交付 → 外圈第二遍补全，mv-2/mv-3
 * 同挂一个 turnId）→ 两个同 id 的 UiTurn → assistant-ui MessageRepository
 * 对重复消息 id 直接抛错，**整个页面崩掉**。上游口径一致：外部存储的
 * 消息 id 必须唯一，官方适配器都在同步前做 id 对账（assistant-ui#2380 /
 * #4037）。所以这里的输出必须**无条件保证 id 唯一**，别指望写入侧永远干净
 * ——存量会话里的脏数据已经落库了。
 *
 * 重建策略（第二版）：
 * 1. 叙述轮（turnNarrations，≤3 轮）永远出——它有真实的用户原文和逐步回放；
 *    同原文两条（引擎 turn-1 + 客户端时间戳）先收成一条，否则「永远出」
 *    会铺出双胞胎（2026-08-18 快递柜刷新）；
 * 2. 版本史先按轮去重（同 turnId 取最后一份），再只补叙述没覆盖的更早轮次
 *    （同轮判定见 sameRestoredTurn：精确匹配 + 时间戳差 ≤2ms 的跨端桥）；
 * 3. 按时间戳排序、末端 id 唯一闸——撞车的丢弃并 console.warn，绝不外泄。
 */
export function deriveTurnsFromState(
  state: V5SessionState | null | undefined
): UiTurn[] {
  if (!state) return [];
  const entries: { stamp: number | null; turn: UiTurn }[] = [];

  // 1) 版本史按轮去重：同一 turnId 只留最后一份快照（同轮多次过闸 = 同一轮）
  const versions = modelVersionsOf(state);
  const dedupedVersions: ModelVersionSnap[] = [];
  const slotByTurn = new Map<string, number>();
  for (const v of versions) {
    const key = String(v.turnId || v.id || "");
    const slot = slotByTurn.get(key);
    if (key && slot !== undefined) dedupedVersions[slot] = v;
    else {
      slotByTurn.set(key, dedupedVersions.length);
      dedupedVersions.push(v);
    }
  }

  // 2) 叙述轮永远出（用户原文 + 逐步回放都是真的）。
  //    同原文双胞胎先收成一条，否则引擎 turn-1 + 客户端时间戳会各铺一轮。
  const replayState: V5SessionState = {
    ...state,
    turnNarrations: dedupeTurnNarrations(
      validNarrations(state),
      versions.map(v => String(v.turnId || ""))
    ),
  };
  const narrated: string[] = [];
  for (const n of validNarrations(replayState)) {
    const turn = buildRestoredTurn(replayState, n.turnId, String(n.user || "").trim());
    if (!turn.user && turn.steps.length === 0) continue;
    narrated.push(n.turnId);
    entries.push({ stamp: turnStampOf(n.turnId), turn });
  }

  // 3) 版本轮只补叙述没覆盖的轮次（叙述只留最近 3 轮，更早的靠版本史）；
  //    已被叙述轮占用的叙述不许再被版本轮按原文认领（见 buildRestoredTurn）
  const claimed = new Set(narrated);
  const goalText = String(state.goal?.text || "").trim();
  for (let i = 0; i < dedupedVersions.length; i++) {
    const v = dedupedVersions[i];
    const turnId = String(v.turnId || v.id || `restored-mv-${i}`);
    if (narrated.some((nid) => sameRestoredTurn(nid, turnId))) continue;
    const instruction = String(v.instruction || "").trim();
    const user = instruction || (i === 0 ? goalText : "");
    if (!user) continue;
    entries.push({
      stamp: turnStampOf(turnId),
      turn: buildRestoredTurn(replayState, turnId, user, claimed),
    });
  }

  // 4) 时间序（无时间戳的保持插入序——sort 稳定）+ id 唯一闸
  entries.sort((a, b) =>
    a.stamp != null && b.stamp != null ? a.stamp - b.stamp : 0
  );
  const seen = new Set<string>();
  const out: UiTurn[] = [];
  for (const e of entries) {
    if (seen.has(e.turn.id)) {
      console.warn(
        `[sliderule] 恢复对话时丢弃重复轮次 id=${e.turn.id}（持久化里同一轮存了多份）`
      );
      continue;
    }
    seen.add(e.turn.id);
    out.push(e.turn);
  }
  if (out.length > 0) {
    // M5：一轮都没认到 main（本轮 runs 对不上 turnId 是常态，见
    // deriveLatestTurnFromState 里的同款说明）→ 只给**最后一轮**补一次
    // 会话级 main。绝不铺给所有轮：那样历史轮的"质疑本轮"会全部打到
    // 最新那份产物上，比没有按钮更坏。
    if (!out.some(t => Boolean(t.main))) {
      out[out.length - 1].main = mainFromRuns(
        state,
        (state.capabilityRuns || []) as Array<{ outputs?: unknown }>
      );
    }
    const fromLog = turnsFromControlTranscript(state);
    // ⚠ 2026-09-17 TicketStream：叙述轮往往只剩开口，工具在日志里。
    //   旧回放 attachProjectChips 把工具整列接到散文后面，章节面
    //   （开口切开工具组）刷新后没了。日志里顺序还在，有穿插就听日志。
    if (fromLog.some(logTurnTellsStory)) {
      return overlayNarrationOntoLog(fromLog, out);
    }
    return attachProjectChipsToTurns(
      out,
      chipsFromControlTranscript(state.controlTranscript)
    );
  }

  // ⚠ 2026-09-16 sr-20260916010238-SFDKWYM2CG：host 日志 81 条
  //   （用户原话 / 问卷 / 批准 / 工具 / 收尾），turnNarrations 和
  //   modelVersions 都是 0，capabilityRuns 也是 0。旧回放只认后三样，
  //   刷新落到「继续开发这个工程」。日志才是权威，叙述空着也要从它铺。
  const fromLog = turnsFromControlTranscript(state);
  if (fromLog.length > 0) return fromLog;

  const latest = deriveLatestTurnFromState(state);
  if (!latest) return [];
  if (!latest.user) {
    latest.user = goalText;
  }
  return attachProjectChipsToTurns(
    [latest],
    chipsFromControlTranscript(state.controlTranscript)
  );
}

function buildRestoredTurn(
  state: V5SessionState,
  turnId: string,
  userOverride: string | undefined,
  claimedNarrationIds?: Set<string>
): UiTurn {
  const runs = (state.capabilityRuns || []) as Array<{
    capabilityId?: string;
    roleId?: string;
    turnId?: string;
    outputs?: unknown;
    gateResults?: Array<{ status?: string }>;
  }>;
  const ledger = (state.decisionLedger || []) as Array<{
    id?: string;
    turnId?: string;
    source?: string;
  }>;
  const base = String(turnId).split("-r")[0];

  const belongs = (t: unknown) => {
    const s = String(t || "");
    return s === turnId || s === base || s.startsWith(`${base}-r`);
  };

  const turnRuns = runs.filter((r) => belongs(r.turnId));
  const effectiveRuns = turnRuns.length > 0 ? turnRuns : runs;

  let dledger: any = null;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (belongs(ledger[i].turnId)) {
      dledger = ledger[i];
      break;
    }
  }
  if (!dledger) dledger = ledger[ledger.length - 1] || null;

  // Prefer DLEDGER.chose (the exact "DLEDGER 选定" list that drives the C_RISK/C_SYN/C_TOOL tree)
  // This makes post-refresh / post-completion reconstruction match the live execution tree.
  let selectedCapabilities: { capabilityId: string; roleId: string }[] = [];
  if (dledger && Array.isArray(dledger.chose) && dledger.chose.length > 0) {
    selectedCapabilities = dledger.chose.map((cid: any) => ({
      capabilityId: String(cid),
      roleId: "agent", // role often not stored per chose in ledger; sufficient for C_ bucket grouping
    }));
  } else {
    selectedCapabilities = effectiveRuns.map((r) => ({
      capabilityId: String(r.capabilityId),
      roleId: String(r.roleId || "agent"),
    }));
  }
  const trustTotalCount = effectiveRuns.length;
  const trustPassedCount = effectiveRuns.filter((r) => {
    const gates = r.gateResults || [];
    return gates.length === 0 ? true : gates.every((g) => g.status === "passed");
  }).length;

  const routeFacts = {
    turnId: base,
    timestamp: new Date().toISOString(),
    goalStatusBefore: state.goal?.status,
    goalStatusAfter: state.goal?.status,
    planReason: dledger?.rationale || "restored",
    planSelectedCount: selectedCapabilities.length,
    planSource: dledger?.source === "llm" ? "llm" : "local_heuristic",
    dledgerDecisionId: dledger?.id ?? null,
    committedCount: trustPassedCount,
    trustPassedCount,
    trustTotalCount,
    runtimePhase: state.runtimePhase,
    selectedCapabilities,
    // carry full dledger for richer deriveTurnRoute (C_ buckets etc.)
    // (deriveTurnRoute only needs selectedCapabilities today, but future-proof)
  } as unknown as TurnRouteFacts;

  // E13：直播叙述已随会话持久化（turnNarrations）——优先按 turnId 取本轮
  // 步骤完整回放；没有（旧会话/持久化失败）再回落骨架轮次（steps 空）。
  //
  // ⚠ 按原文兜底配叙述时，**已被别的轮占用的叙述不许再认领**（2026-08-18
  //   步伴/烘焙店真机）：存量版本史的 instruction 被 goal 顶替过，好几轮的
  //   user 文本一模一样，按原文一配全配到同一份叙述——左栏出现两三份逐字
  //   相同的"推演过程"。宁可 steps 空着（如实：这轮的叙述已被裁掉），
  //   也不给它穿别的轮的衣服。
  let narration =
    narrationStepsFor(state, turnId) ?? narrationStepsFor(state, base);
  if (!narration) {
    const fallback = userOverride
      ? matchNarrationByUser(state, userOverride)
      : narrationStepsFor(state, null);
    if (fallback && !claimedNarrationIds?.has(fallback.turnId)) {
      narration = fallback;
    }
  }

  const user = (userOverride ?? narration?.user ?? "").trim();

  // M5：质疑按钮的守卫。**只认本轮自己的 runs**——effectiveRuns 在本轮没有
  // run 时会回落成"全部 runs"（那是 routeFacts 的单轮合并视图口径），拿它
  // 挑 main 会让每一条历史轮都认领最新那份产物，质疑打到别人身上。
  // 本轮真的没产物就老实给 null（见 deriveTurnsFromState 末尾的兜底：
  // 只给最后一轮补一次会话级 main，不铺给所有轮）。
  const main = mainFromRuns(state, turnRuns);

  return {
    id: base,
    user,
    status: "complete",
    durationMs: narration?.durationMs,
    steps: narration?.steps ?? [],
    routeFacts,
    routeExpanded: false,
    routeLitCount: deriveTurnRoute(routeFacts).length,
    assistant: "",
    assistantSource: "llm",
    main,
    actions: [],
  } as UiTurn;
}

function matchNarrationByUser(state: V5SessionState, user: string) {
  const needle = user.trim();
  if (!needle) return null;
  for (const n of validNarrations(state)) {
    if (String(n.user || "").trim() === needle) {
      return narrationStepsFor(state, n.turnId);
    }
  }
  return null;
}

export function mergePublishClosureForPersistedTurn(
  state: V5SessionState,
  pythonPublishClosure: unknown
): V5SessionState {
  const { publishClosure: _previewPublishClosure, ...rest } = state as any;
  if (pythonPublishClosure == null) return rest as V5SessionState;
  return { ...rest, publishClosure: pythonPublishClosure } as V5SessionState;
}
